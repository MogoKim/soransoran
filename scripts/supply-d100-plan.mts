#!/usr/bin/env tsx
/**
 * D100 공급 계획 — 🔴 **read-only. 네트워크 0 · LLM 0 · DB write 0**
 *
 * 🔴 이 명령이 답하는 것은 하나다: **"승인 가능한 글이 하루에 몇 건 늘어나는가,
 *    그리고 목표에 얼마나 모자라는가."**
 *
 *    "회차를 몇 번 돌렸나" · "요청을 몇 번 보냈나" 는 공급이 아니다.
 *    그 수로 능력을 선언하면 재고가 비어 있는 날에도 능력이 있다고 적히게 된다.
 *
 * 🔴 **수율을 코드 상수로 확정하지 않는다.** 회차 원장(`collect-runs/*.jsonl`)과 DB 에서
 *    다시 센다. 원장이 없을 때만 `SOURCE_BASELINE`(날짜가 붙은 마지막 관측)을 쓰고,
 *    그 사실을 표에 그대로 적는다.
 *
 * 사용법
 *   npm run supply:d100-plan            실측(원장 + DB)
 *   npm run supply:d100-plan -- --stock=250   모의 재고(DB 조회 없이)
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import {
  APPROVED_PER_DAY_FLOOR, APPROVED_PER_DAY_TARGET, SOURCE_BASELINE,
  STOCK_BANDS, judgeStockBand, judgeSupplyGap, planBacklogSweep,
  planSourceRequests, stockEta, type SourceBaseline,
} from '../src/lib/supply-stock-plan'

const argv = process.argv.slice(2)
const simArg = argv.find((a) => a.startsWith('--stock='))
const SIM = simArg === undefined ? null : Number(simArg.slice('--stock='.length))

console.log('\n══ D100 공급 계획 (🔴 read-only · 네트워크 0 · DB write 0) ══\n')

// ─────────────────────────────────────────────────────────
// 🔴 ① 회차 원장에서 다시 센다 — 코드 상수를 믿지 않는다
// ─────────────────────────────────────────────────────────
const LEDGER_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'collect-runs')

type LedgerFact = { runs: number; ok: number; failed: number; detail: number; newUnique: number }

/** 🔴 못 읽으면 `null` 이다. 0 으로 보정하면 "관측했더니 0" 과 구별되지 않는다 */
function readLedger(sourceId: string, sinceMs: number): LedgerFact | null {
  const file = sourceId.replace(/:/g, '-')
  const path = join(LEDGER_DIR, `${file}.jsonl`)
  if (!existsSync(path)) return null
  const byRun = new Map<string, Record<string, unknown>>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (t === '') continue
    try {
      const d = JSON.parse(t) as Record<string, unknown>
      if (d.status === 'started') continue
      if (Date.parse(String(d.startedAt)) < sinceMs) continue
      byRun.set(String(d.runId), d)
    } catch { /* 🔴 깨진 줄은 건너뛴다 — 회차 하나 때문에 표 전체를 버리지 않는다 */ }
  }
  if (byRun.size === 0) return null
  const num = (d: Record<string, unknown>, k: string): number =>
    typeof d[k] === 'number' ? (d[k] as number) : 0
  let ok = 0; let failed = 0; let detail = 0; let newUnique = 0
  for (const d of byRun.values()) {
    if (d.status === 'ok') ok += 1
    if (d.status === 'failed') failed += 1
    detail += num(d, 'detailRequests')
    newUnique += num(d, 'newUniqueThinRows')
  }
  return { runs: byRun.size, ok, failed, detail, newUnique }
}

const DAY = 86_400_000
const since24 = Date.now() - DAY

/** 🔴 원장이 있으면 그 값으로 baseline 을 덮어쓴다. 없으면 baseline 을 그대로 쓴다 */
type Measured = { m: SourceBaseline; from: '원장(24h)' | `baseline(${string})`; ledger: LedgerFact | null }
const measured: Measured[] = SOURCE_BASELINE.map((b) => {
  const l = readLedger(b.id, since24)
  if (l === null) return { m: b, from: `baseline(${b.observedAt})` as const, ledger: null }
  return {
    m: { ...b, observedAt: new Date().toISOString().slice(0, 10), window: '24h', thinNewPerDay: l.newUnique },
    from: '원장(24h)', ledger: l,
  }
})

// ─────────────────────────────────────────────────────────
// 🔴 ② 재고와 순증가는 DB 에서 센다
// ─────────────────────────────────────────────────────────
const db = await (async (): Promise<{ usable: number; net7: number | null }> => {
  if (SIM !== null && Number.isInteger(SIM) && SIM >= 0) {
    console.log(`  🟡 모의 재고 ${SIM}건 — DB 를 읽지 않는다\n`)
    return { usable: SIM, net7: null }
  }
  await loadEnvLocal()
  const prisma = new PrismaClient()
  try {
    return {
      usable: await prisma.originalPostApprovalQueue.count({ where: { status: 'APPROVED' } }),
      net7: await prisma.originalPostApprovalQueue.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * DAY) } },
      }),
    }
  } finally {
    await prisma.$disconnect()
  }
})()

const reading = judgeStockBand(db.usable)
console.log(`  재고   승인 가능(APPROVED 미발행) ${db.usable}건`
  + (db.net7 === null ? '' : ` · 최근 7일 Queue **생성** ${db.net7}건(= ${(db.net7 / 7).toFixed(1)}/day)`))
console.log('         🔴 생성 건수는 APPROVED **순증가**가 아니다 — 순증가는 미측정이다')
console.log(`  정책   ${reading.reason}`)
console.log(`  목표   승인 가능 순증가 ${APPROVED_PER_DAY_FLOOR}~${APPROVED_PER_DAY_TARGET}/day`)
console.log(`  재고선 초기 ${STOCK_BANDS.bootstrap} · 최소 ${STOCK_BANDS.min} · 권장 ${STOCK_BANDS.target}`
  + '  (🔴 runtime 이 보는 것은 권장선 하나다)')

// ─────────────────────────────────────────────────────────
console.log('\n── ① 24h 관측값 (원장에서 다시 셌다)')
console.log('   source                   출처          회차 ok/fail  상세  신규')
for (const x of measured) {
  const l = x.ledger
  console.log(`   ${x.m.id.padEnd(24)} ${x.from.padEnd(13)}`
    + (l === null ? '   —     —      —     —  🔴 원장 없음'
      : `${String(l.runs).padStart(5)} ${`${l.ok}/${l.failed}`.padStart(6)}`
        + `${String(l.detail).padStart(6)}${String(l.newUnique).padStart(6)}`))
}

console.log('\n── ② 관측 — 🔴 **신규 thin** 과 **APPROVED 순증가**는 다른 수다')
console.log('   🔴 아래 표는 전부 **신규 thin** 이다. thin 은 아직 DB 에 들어가지도 않은 수집물이고,')
console.log('      그 사이에 adapt·judge·draft·fill 이 있다. APPROVED 순증가는 **미측정**이다.')
console.log('   🔴 그리고 이 관측은 **목록 몇 페이지를 읽던 회차인가**에 딸려 있다 —')
console.log('      source 가 하루에 내놓는 양의 상한이 아니다.')
console.log('   source                   등록  관측 thin  잡히는 몫   잔여목록  관측조건')
const gap = judgeSupplyGap(measured.map((x) => x.m), APPROVED_PER_DAY_TARGET)
for (const x of measured) {
  const c = gap.perSource.find((y) => y.id === x.m.id)!
  console.log(`   ${x.m.id.padEnd(24)} ${(x.m.scheduled ? '✅' : '🔴').padEnd(4)}`
    + ` ${(x.m.thinNewPerDay === null ? '🔴 미관측' : String(x.m.thinNewPerDay)).padStart(9)}`
    + ` ${(c.thinPerDay === null ? '🔴 미관측' : String(c.thinPerDay)).padStart(10)}`
    + ` ${(x.m.eligibleBacklog === null ? '—' : String(x.m.eligibleBacklog)).padStart(9)}`
    + ` ${`목록 ${x.m.pages ?? '?'}p`.padStart(9)}`)
  console.log(`      └ ${x.m.evidence}`)
  if (c.throttled === true) console.log(`      └ ${c.reason}`)
}
console.log(`\n   등록 + 관측    신규 thin ${gap.thinScheduledPerDay}/day`)
console.log(`   전체 관측      신규 thin ${gap.thinAllPerDay}/day`)
console.log(`   🔴 미관측      ${gap.unconfirmed.length === 0 ? '없음' : gap.unconfirmed.join(' · ')}`
  + ' (합계에 넣지 않았다)')
console.log(`   🔴 1회성 잔여  ${gap.backlogOnce}건 (유량이 아니다)`)
console.log(`   🔴 APPROVED 순증가/day  ${gap.approvedPerDay === null ? '**미측정**' : gap.approvedPerDay}`
  + ' — 상태별 시점 스냅숏이 없다')
console.log(`   🔴 부족분      최소 ${gap.thinShortfallFloorPerDay}/day (목표 ${gap.wantPerDay} APPROVED 기준 **하한**)`)
console.log(`      └ ${gap.reason}`)

console.log('\n── ③ 관측에서 역산한 요청량')
for (const x of measured) {
  const r = planSourceRequests(x.m)
  console.log(`   ${r.id.padEnd(24)} ${r.detailPerRun === null ? '🔴 역산 불가'
    : `하루 ${r.runsPerDay}회 × 상세 ${r.detailPerRun}건 → 신규 thin ${r.coversThinPerDay}/day`}`)
  console.log(`      └ ${r.reason}`)
}

console.log('\n── ④ 밀린 목록 1회성 수거 (정상 상태와 별개다)')
for (const x of measured.filter((y) => (y.m.listRowsPerPage ?? 0) > 0)) {
  console.log(`   ${x.m.id.padEnd(24)} ${planBacklogSweep({ m: x.m, toPages: 5, overDays: 5 }).reason}`)
}

console.log('\n── ⑤ 재고까지 얼마나 모자란가')
console.log('   🔴 **며칠 걸리는지는 내지 않는다.** 그러려면 APPROVED 순증가/day 가 있어야 하고,')
console.log('      그것은 상태별 시점 스냅숏에서만 나온다 — 지금은 없다.')
console.log('      앞선 판은 신규 thin 수를 순증가로 써서 "n일" 을 찍었다. 그것은 "thin 1건 =')
console.log('      APPROVED 1건" 을 가정한 값이었다. 주석에 "가정" 이라 적어도 표에 남는 건 숫자다.')
for (const e of stockEta(db.usable)) {
  console.log(`   ${String(STOCK_BANDS[e.band]).padStart(4)}건까지  모자란 ${String(e.need).padStart(4)}건`
    + `  ·  걸리는 날 ${e.days === null ? '🔴 미측정' : `${e.days}일`}`)
}
console.log(`   └ ${stockEta(db.usable)[0]!.note}`)
console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — 네트워크 0 · LLM 0 · DB write 0\n')
