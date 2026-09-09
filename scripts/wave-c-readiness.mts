#!/usr/bin/env tsx
/**
 * Wave C(공개 d3 승격) 준비도 — 🔴 **read-only. DB write 0 · 네트워크 0 · 승격 0**
 *
 * 🔴 이 도구는 **올리지 않는다.** 조건이 다 맞았는지 하나의 판정으로 말하고,
 *    올릴 때 무엇을 해야 하는지(롤백 포함)를 함께 적는다. 실제 승격은 사람이 한다.
 *
 * 사용법
 *   npm run wave-c:readiness            준비도 판정
 *   npm run wave-c:readiness -- --plan  승격·롤백 계획도 함께 출력
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { budgetOf, guardSnapshot, type SourceId } from '../src/lib/collect-guard'
import { readStock } from '../src/lib/micro-seed-supply-autofill'
import { derive as deriveProfile } from '../src/lib/scale-profile'
import { installFromEnv } from '../src/lib/scale-runtime'
import {
  judgeCheckpointFreshness, judgePromotionFreshness, judgeSlotEvidence, parseSuccessRuns,
} from '../src/lib/runtime-evidence'
import { judgeWaveC, planPromotion, WAVE_C_CONDITIONS } from '../src/lib/wave-c-readiness'
import { readGuard } from './lib/collect-guard-store.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const WANT_PLAN = process.argv.includes('--plan')
/** 🔴 Wave B 계약 — 두 카페 모두 하루 4회다 */
const NAVER_EXPECTED: Readonly<Record<string, number>> = {
  'navercafe:remonterrace': 4,
  'navercafe:wgang': 4,
}
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'soransoran')
const LOG_OF: Readonly<Record<string, string>> = {
  'navercafe:remonterrace': 'navercafe-collect-remonterrace-multi.log',
  'navercafe:wgang': 'navercafe-collect-wgang-multi.log',
}
/** 🔴 Wave B 로 정한 예정 슬롯. 증거는 이 시각들에 하나씩 붙어야 한다 */
const SLOTS_OF: Readonly<Record<string, { hour: number; minute: number }[]>> = {
  'navercafe:remonterrace': [{ hour: 4, minute: 20 }, { hour: 10, minute: 20 }, { hour: 16, minute: 20 }, { hour: 22, minute: 20 }],
  'navercafe:wgang': [{ hour: 2, minute: 50 }, { hour: 8, minute: 50 }, { hour: 14, minute: 50 }, { hour: 20, minute: 50 }],
}
/** 🔴 공급 회차(supply-autopilot)의 예약 슬롯 — launchd StartCalendarInterval 과 같아야 한다 */
const SUPPLY_SLOTS: readonly { hour: number; minute: number }[] = [{ hour: 21, minute: 10 }]
const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
const MANIFEST_FILE = join(CANON_DIR, 'runtime-manifest.json')

await loadEnvLocal()
const scale = installFromEnv(process.env)
const capD = deriveProfile(scale.capacityProfile)
const prisma = new PrismaClient()
const now = new Date()

console.log('\n══ Wave C 준비도 — 공개 d3 승격 (read-only · 승격 0) ══\n')
console.log(`  지금 설정  capacity=${scale.capacityStage} · release=${scale.releaseStage}`)

// ── ① 재고 — 🔴 러너와 **같은 함수**로 센다. 여기서 따로 세면 두 숫자가 갈린다 ──
const queueRows = await prisma.originalPostApprovalQueue.findMany({
  select: {
    status: true, createdPostId: true, promptVersion: true, model: true,
    gateResults: true, rawContent: { select: { sourceSite: true } },
  },
})
const stock = readStock(
  queueRows.map((r) => ({
    status: r.status, createdPostId: r.createdPostId,
    promptVersion: r.promptVersion, model: r.model,
    sourceSite: r.rawContent?.sourceSite ?? '', gateResults: r.gateResults,
  })),
  { warn: capD.stockWarn, min: capD.stockMin, target: capD.stockTarget },
)

// ── 🔴 runtime 배포 기록 — 무엇이 언제부터 돌고 있는가 ──
type Manifest = { sha?: string; deployedAt?: string }
const manifest: Manifest | null = existsSync(MANIFEST_FILE)
  ? ((): Manifest | null => { try { return JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8')) as Manifest } catch { return null } })()
  : null
const deployedAt = manifest?.deployedAt === undefined ? null : Date.parse(manifest.deployedAt)
const runtimeSha = manifest?.sha ?? null

/**
 * ── ② Naver 다회 슬롯 — 🔴 **회차 증거**로 센다 (2026-09-09 Codex 지적)
 *
 *    옛 판은 로그의 `thin-detail.jsonl` **글자 수**를 셌다. 그래서 전환 이전 성공까지 세고,
 *    같은 회차가 여러 줄이면 부풀고, "오늘" 만 보니 자정에 0 으로 되돌아갔다.
 *    지금은 runId 의 시각을 읽어 **전환 이후 고유 회차**를 예정 슬롯에 하나씩 붙인다.
 */
const naverRuns: Record<string, { expected: number; succeeded: number }> = {}
const slotDetail: string[] = []
for (const [id, expected] of Object.entries(NAVER_EXPECTED)) {
  const path = join(LOG_DIR, LOG_OF[id]!)
  const body = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  const v = judgeSlotEvidence({
    runs: parseSuccessRuns(body),
    slots: SLOTS_OF[id]!,
    // 🔴 배포 기록이 없으면 "언제부터" 를 모른다 — 그때는 아무 회차도 인정하지 않는다
    since: deployedAt ?? Number.MAX_SAFE_INTEGER,
    now: now.getTime(),
    expected,
  })
  naverRuns[id] = { expected, succeeded: v.succeeded }
  slotDetail.push(`${id} ${v.succeeded}/${v.expected} (지나간 슬롯 ${v.elapsed})`)
}

// ── ③ 보호장치 ──
const guardProblems: string[] = []
for (const id of Object.keys(NAVER_EXPECTED) as SourceId[]) {
  try {
    const snap = guardSnapshot(readGuard(id, now), now.getTime())
    for (const b of snap.breakers) {
      if (b.status !== 'closed') guardProblems.push(`${id} ${b.cls} ${b.status}`)
    }
    if (budgetOf(readGuard(id, now)).exhausted) guardProblems.push(`${id} 예산 소진`)
  } catch { guardProblems.push(`${id} 보호장치 상태를 읽지 못했다`) }
}

/**
 * ── ④ 마지막 공급 회차 checkpoint — 🔴 **전환 이후의 done 이어야 한다**
 *
 *    옛 코드로 돈 회차의 `done` 을 증거로 쓰면, 지금 돌고 있는 것과 다른 것을 보고
 *    공개 발행량을 3배로 올리게 된다.
 */
const dataDir = './.microseed-data'
type CpFile = { status?: string; startedAt?: string; completedAt?: string | null; runtimeSha?: string }
let cpFacts: { status: string | null; startedAt: string | null; completedAt: string | null; runtimeSha?: string | null } | null = null
try {
  const cps = readdirSync(dataDir).filter((f) => f.startsWith('supply-autopilot-') && f.endsWith('.state.json')).sort()
  const latest = cps[cps.length - 1]
  if (latest !== undefined) {
    const j = JSON.parse(readFileSync(join(dataDir, latest), 'utf-8')) as CpFile
    cpFacts = {
      status: j.status ?? null,
      startedAt: j.startedAt ?? null,
      completedAt: j.completedAt ?? null,
      runtimeSha: j.runtimeSha ?? null,
    }
  }
} catch { cpFacts = null }
// 🔴 예약 슬롯까지 대조한다 — 손으로 돌린 회차를 정기 회차 증거로 쓰지 않는다
const cpVerdict = judgeCheckpointFreshness({
  cp: cpFacts, deployedAt, runtimeSha, now: now.getTime(), slots: SUPPLY_SLOTS,
})
const lastCheckpoint = cpVerdict.ok ? 'done' : `막힘 — ${cpVerdict.reason}`

// ── ⑤ 예약 실행 격리 — 🔴 관측을 **요구**한다. 없으면 성립이 아니다 ──
const runtimeIsolated = ((): boolean => {
  try { execFileSync('npx', ['tsx', 'scripts/runtime-isolation-check.mts', '--require-runtime'], { stdio: 'ignore' }); return true }
  catch { return false }
})()

const verdict = judgeWaveC({
  stock: stock.usable,
  stockTarget: capD.stockTarget,
  naverRuns,
  guardProblems,
  lastCheckpoint,
  releaseStage: scale.releaseStage,
  runtimeIsolated,
})

console.log(`\n  조건 ${WAVE_C_CONDITIONS.length}개 + 격리 1개\n`)
for (const p of verdict.passed) console.log(`   ✅ ${p}`)
for (const b of verdict.blockers) console.log(`   🔴 ${b}`)
/**
 * 🔴 승격은 **지금 origin/main 이 배포된 뒤에만** 허용한다.
 *
 *    옛 판은 로컬 `origin/main` 을 그대로 읽었다. fetch 를 안 한 저장소에서는 그게
 *    며칠 전 ref 일 수 있고, 그러면 **뒤처진 runtime 이 "최신" 으로 보인다.**
 *    그래서 원격에 직접 물어본다. 🔴 이것은 live crawl 도 DB write 도 아니다 —
 *    우리 저장소의 ref 하나를 읽을 뿐이고, 로컬 ref 를 바꾸지도 않는다.
 */
const localOriginMain = ((): string | null => {
  try { return execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf-8' }).trim() } catch { return null }
})()
const remoteMain = ((): string | null => {
  try {
    const out = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf-8', timeout: 20_000 }).trim()
    const sha = out.split(/\s+/)[0] ?? ''
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null
  } catch { return null }
})()
// 🔴 원격을 못 읽으면 최신인지 알 수 없다 — 모르면 NOT_READY 다(fail-closed)
const originMain = remoteMain
const lagRaw = runtimeSha === null || originMain === null ? null
  : ((): string | null => {
    try { return execFileSync('git', ['rev-list', '--count', `${runtimeSha}..${originMain}`], { encoding: 'utf-8' }).trim() } catch { return null }
  })()
const fresh = remoteMain === null
  ? { fresh: false, lag: null, detail: '원격 main 을 읽지 못했다 — 최신 여부를 확인할 수 없다(fail-closed)' }
  : judgePromotionFreshness({ runtimeSha, originMainSha: originMain, lag: lagRaw === null ? null : Number(lagRaw) })

console.log(`\n  ${verdict.summary}`)
console.log(`  슬롯 증거  ${slotDetail.join(' · ')}`)
console.log(`  배포 기록  ${manifest === null ? '🔴 없다' : `${(runtimeSha ?? '?').slice(0, 7)} @ ${manifest.deployedAt ?? '?'}`}`)
console.log(`  로컬 origin/main ${(localOriginMain ?? '?').slice(0, 7)}`
  + `  ·  원격 main ${remoteMain === null ? '🔴 읽지 못함' : remoteMain.slice(0, 7)}`
  + (localOriginMain !== null && remoteMain !== null && localOriginMain !== remoteMain
    ? '  🔴 로컬 ref 가 원격과 다르다 — 로컬만 보면 오판한다' : ''))
console.log(`  승격 신선도 ${fresh.fresh ? '🟢 최신' : '🟡 ' + fresh.detail}`)
if (!fresh.fresh) console.log('  🔴 최신 origin/main 이 runtime 에 배포되기 전에는 승격하지 않는다')
console.log('  🔴 회차 증거로 판정한다 — 자정이 지나도 최근 슬롯의 증거는 유지된다')

if (WANT_PLAN) {
  const plan = planPromotion({ from: scale.releaseStage, to: 'd3' })
  console.log('\n══ 승격 계획 (🔴 이 도구는 실행하지 않는다) ══\n')
  for (const s of plan.steps) console.log(`   ${s}`)
  console.log('\n  ── 되돌리기 (올리기 전에 먼저 읽는다)')
  for (const r of plan.rollback) console.log(`   ${r}`)
  console.log('\n  ── 발행 전후 검증')
  for (const v of plan.verify) console.log(`   · ${v}`)
}

console.log('\n  🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 승격 0 · 발행 0\n')
await prisma.$disconnect()
// 🔴 준비되지 않은 것을 exit 0 으로 감추지 않는다
process.exit(verdict.ready && fresh.fresh ? 0 : 1)
