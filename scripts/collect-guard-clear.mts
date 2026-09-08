#!/usr/bin/env tsx
/**
 * 수집 차단기 사람 해제 — 🔴 **기본은 dry-run. DB 0 · 네트워크 0 · 파일 삭제 0**
 *
 * 사용법
 *   npm run collect:guard-status
 *   npm run collect:guard-clear -- --source=82cook --class=FORBIDDEN
 *   npm run collect:guard-clear -- --source=82cook --class=FORBIDDEN --apply --reason "..."
 *
 * 🔴 **왜 도구가 필요한가.**
 *    `FORBIDDEN`(403) 차단기는 쿨다운으로 풀리지 않는다 — 사람이 확인해야 닫힌다.
 *    그런데 여는 방법이 "상태 파일을 지우거나 JSON 을 손으로 고친다" 뿐이면,
 *    사람은 **차단기 전체를 날리고** 그날 쓴 예산 기록까지 함께 잃는다.
 *    그 절차를 운영 절차로 두지 않는다.
 *
 * 🔴 이 도구가 하지 않는 것
 *      · 상태 파일 삭제 · 예산 초기화 · 다른 분류 해제 · 여러 소스 동시 해제
 *      · 열리지 않은 차단기 "해제" · 네트워크 요청 · DB 접근
 *
 * 🔴 fail-closed — `--source` · `--class` · (`--apply` 일 때) `--reason` 이 없으면 멈춘다.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  BREAKER, FAILURE_CLASSES, breakerOf, budgetOf, clearByHuman, guardSnapshot,
  type FailureClass, type SourceId,
} from '../src/lib/collect-guard'
import { SOURCE_FACTS } from '../src/lib/collect-schedule'
import {
  guardPath, readGuard, reaperAnomaly, reaperAnomalyMessage, saveGuard, withGuardLock,
} from './lib/collect-guard-store.mjs'

/** 🔴 allowlist — 임의 문자열을 받지 않는다 */
const SOURCES: readonly SourceId[] = SOURCE_FACTS.map((f) => f.id)
const AUDIT_LOG = join('.microseed-data', 'collect-guard-audit.log')

const argv = process.argv.slice(2)
const arg = (k: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit === undefined ? null : (hit.split('=').slice(1).join('=') || null)
}
const APPLY = argv.includes('--apply')
const STATUS_ONLY = argv.includes('--status')
const REASON_AT = argv.indexOf('--reason')
const REASON = REASON_AT >= 0 ? (argv[REASON_AT + 1] ?? null) : null

const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

const now = new Date()

// ── ① 상태만 보여주기 ──
if (STATUS_ONLY || (arg('source') === null && arg('class') === null && !APPLY)) {
  console.log('\n══ 수집 보호장치 상태 (read-only) ══\n')
  for (const id of SOURCES) {
    /**
     * 🔴 **남은 회수 잠금(reaper)은 운영 이상이다.** 자동 회수하지 않으므로
     *    사람이 보지 않으면 그 source 의 수집이 조용히 멈춘 채로 있는다.
     *    복구 절차: `docs/operations/2026-09-08-d10-activation-prep.md` §12
     */
    const anomaly = reaperAnomaly(id, now.getTime())
    if (anomaly !== null) {
      console.log(`  🔔 ${id}  회수 잠금(reaper) 남음`)
      console.log(`       ${reaperAnomalyMessage(anomaly)}`)
    }
    const path = guardPath(id)
    if (!existsSync(path)) { console.log(`  ⚪ ${id}  상태 파일 없음 — 아직 한 번도 돌지 않았다`); continue }
    const st = readGuard(id, now)
    const snap = guardSnapshot(st, now.getTime())
    const b = budgetOf(st)
    console.log(`  ${snap.healthy ? '🟢' : '🔴'} ${id}  예산 ${b.used}/${b.limit} (${st.budgetDay})`)
    for (const br of snap.breakers) {
      if (br.status === 'closed' && br.consecutive === 0) continue
      console.log(`       ${br.cls.padEnd(11)} ${br.status.padEnd(10)} 연속 ${br.consecutive}회`
        + (br.probing ? ' · 시험 요청 진행 중' : '')
        + (br.requiresHuman ? ' · 🔴 사람이 확인해야 닫힌다' : br.retryAt === null ? '' : ` · 재시도 ${new Date(br.retryAt).toISOString()}`))
    }
    if (snap.needsHuman.length > 0) {
      console.log(`       🔔 사람 해제 필요: ${snap.needsHuman.join(' · ')}`)
      console.log(`          npm run collect:guard-clear -- --source=${id} --class=${snap.needsHuman[0]} --apply --reason "..."`)
    }
  }
  console.log('\n  🔴 이 명령은 아무것도 바꾸지 않았다.\n')
  process.exit(0)
}

// ── ② 인자 게이트 — 🔴 파일을 열기 전에 막는다 ──
const rawSource = arg('source')
if (rawSource === null) fail('--source 가 필요합니다 (allowlist: ' + SOURCES.join(' · ') + ')')
if (!(SOURCES as readonly string[]).includes(rawSource!)) {
  fail(`--source "${rawSource}" 는 허용 목록에 없습니다 (${SOURCES.join(' · ')})`)
}
const SOURCE = rawSource as SourceId

const rawClass = arg('class')
if (rawClass === null) fail('--class 가 필요합니다 (' + FAILURE_CLASSES.join(' · ') + ')')
if (!(FAILURE_CLASSES as readonly string[]).includes(rawClass!)) {
  fail(`--class "${rawClass}" 는 허용 목록에 없습니다 (${FAILURE_CLASSES.join(' · ')})`)
}
const CLS = rawClass as FailureClass

const path = guardPath(SOURCE)
if (!existsSync(path)) fail(`${path} 이 없습니다 — 열린 차단기가 없습니다`)

const before = readGuard(SOURCE, now)
const status = breakerOf(before, CLS, now.getTime())

console.log(`\n══ 차단기 해제 — ${SOURCE} · ${CLS} — ${APPLY ? '🔴 실제 적용' : 'dry-run (write 0)'} ══\n`)
console.log(`  지금 상태   ${status} · 연속 ${before.failures[CLS].consecutive}회`
  + ` · openedAt ${before.failures[CLS].openedAt === null ? '—' : new Date(before.failures[CLS].openedAt!).toISOString()}`)
console.log(`  예산        ${budgetOf(before).used}/${budgetOf(before).limit} (${before.budgetDay}) — 🔴 건드리지 않습니다`)
console.log(`  다른 분류    ${FAILURE_CLASSES.filter((c) => c !== CLS).map((c) => `${c}=${breakerOf(before, c, now.getTime())}`).join(' · ')} — 🔴 건드리지 않습니다`)

// 🔴 열리지 않은 차단기는 "해제" 하지 않는다 — 아무 일도 안 하면서 했다고 기록하지 않는다
if (status === 'closed') {
  fail(`${CLS} 차단기는 이미 닫혀 있습니다 — 해제할 것이 없습니다`)
}
if (!BREAKER[CLS].requiresHuman) {
  console.log(`\n  🟡 ${CLS} 는 쿨다운으로 스스로 닫힙니다 (${Math.round(BREAKER[CLS].cooldownMs / 60000)}분).`)
  console.log('     그래도 사람이 앞당겨 열 수 있지만, **왜 지금 여는지**를 남겨야 합니다.')
}

const after = clearByHuman(before, CLS, now.getTime())
console.log(`\n  적용 후     ${breakerOf(after, CLS, now.getTime())} · 연속 0회`)

if (!APPLY) {
  console.log('\n🟡 적용하지 않았습니다 — --apply 와 --reason 이 필요합니다.')
  console.log(`   실제 적용: npm run collect:guard-clear -- --source=${SOURCE} --class=${CLS} --apply --reason "..."\n`)
  process.exit(0)
}
if (REASON === null || REASON.trim() === '') {
  fail('--reason "..." 이 필요합니다 — 왜 지금 여는지 남기지 않으면 다음 사람이 같은 판단을 반복합니다')
}

// ── ③ 적용 — 🔴 잠금 안에서 읽고 고치고 쓴다. 파일을 지우지 않는다 ──
await withGuardLock(SOURCE, () => {
  const fresh = readGuard(SOURCE, now)
  if (breakerOf(fresh, CLS, now.getTime()) === 'closed') {
    throw new Error('잠금 안 재확인 실패 — 그 사이에 차단기가 닫혔습니다')
  }
  saveGuard(clearByHuman(fresh, CLS, now.getTime()))
})

// 🔴 해제 이력은 **append-only** 로 따로 남긴다. 상태 파일이 덮여도 사라지지 않는다
mkdirSync(dirname(AUDIT_LOG), { recursive: true })
appendFileSync(AUDIT_LOG, `${JSON.stringify({
  at: now.toISOString(), source: SOURCE, cls: CLS,
  fromStatus: status, reason: REASON, pid: process.pid,
})}\n`, 'utf-8')

const done = readGuard(SOURCE, now)
console.log(`\n  ✅ ${SOURCE} · ${CLS} 해제 — ${breakerOf(done, CLS, now.getTime())}`)
console.log(`  예산 ${budgetOf(done).used}/${budgetOf(done).limit} — 🔴 그대로입니다`)
console.log(`  이력 ${AUDIT_LOG} 에 append 했습니다`)
console.log('  🔴 켰다고 수집이 도는 것이 아닙니다 — 다음 회차에 job 이 돌 때 시도합니다\n')
