#!/usr/bin/env tsx
/**
 * 🔴 **ops shadow 변이 하네스** (2026-11-11) — 방어 하나를 지운 판마다 `ops-shadow-plan-check` 가 FAIL 해야 한다.
 *    살아남는 변이가 있으면 그 방어는 검사가 지키지 않는 죽은 방어다. 끝나면 원본 해시를 복원·확인한다.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const F = {
  plan: 'src/lib/ops-shadow-plan.ts',
  io: 'scripts/lib/ops-shadow-io.mts',
  cli: 'scripts/ops-shadow-plan.mts',
}
type Edit = { file: string; find: string; replace: string }
const MUTATIONS: { name: string; edits: Edit[] }[] = [
  { name: '부작용 가드 — fetch 차단 제거',
    edits: [{ file: F.io, find: "  globalThis.fetch = (() => { throw new Error('OPS_SHADOW_NO_NETWORK') }) as typeof fetch", replace: '  void realFetch' }] },
  { name: '부작용 가드 — 자식 프로세스 차단 제거',
    edits: [{ file: F.io, find: "    cp[fn] = () => { throw new Error(`OPS_SHADOW_NO_CHILD_PROCESS: ${fn}`) }", replace: '    void cp' }] },
  { name: '부작용 가드 — DB 쓰기 차단 제거',
    edits: [{ file: F.io, find: "            if (typeof op === 'string' && WRITE_OPS.has(op)) {", replace: '            if (op === Symbol.iterator) {' }] },
  { name: '부작용 가드 — raw · 트랜잭션 차단 제거',
    edits: [{ file: F.io, find: "      if (typeof prop === 'string' && BLOCKED_ROOT.has(prop)) {", replace: "      if (prop === Symbol.iterator) {" }] },
  { name: '부작용 가드 — CLI 가 가드를 걸지 않는다',
    edits: [{ file: F.cli, find: '\ninstallShadowCallGuard()\n', replace: '\n' }] },
  { name: '속도 상한 제거 — 천장을 하루 예산으로',
    edits: [{ file: F.plan, find: '  const ceiling = paceCeilingUsdOf(env, obs.slotsDueSoFar)\n', replace: '  const ceiling = env.supplyDailyUsd\n' }] },
  { name: '멱등성 제거 — 같은 사이클을 또 쓴다',
    edits: [{ file: F.io, find: '      if (id === record.cycleId) return { written: false, path }', replace: '      void id' }] },
  { name: '권위 재사용 제거 — 유료 원천 수를 손 공식으로(묶음 천장 없음)',
    edits: [{ file: F.plan, find: '  const paid = paidSourcesFor({ deficit, yieldHigh: obs.sourceYieldHigh, cap: env.worksetCapPerRun })',
      replace: "  const paid = deficit <= 0 ? { sources: 0, basis: 'noDemand' as const } : obs.sourceYieldHigh !== null && obs.sourceYieldHigh > 0 ? { sources: Math.ceil(deficit / obs.sourceYieldHigh), basis: 'measuredYield' as const } : { sources: deficit * 3, basis: 'boundedRecovery' as const }" }] },
  { name: '권위 재사용 제거 — 부족분을 슬롯 수로(eligible READY 무시)',
    edits: [{ file: F.plan, find: '  const demand = judgeJitDemand(obs.jit)', replace: '  const demand = { ...judgeJitDemand(obs.jit), upTo: obs.jit?.slots ?? 0 }' }] },
  { name: '지출 권위 입력 — 정산 보류를 넘기지 않는다',
    edits: [{ file: F.plan, find: '    settleHold: obs.ledger.settleHold,', replace: '    settleHold: null,' }] },
  { name: '지출 권위 입력 — 미해결 예약을 넘기지 않는다',
    edits: [{ file: F.plan, find: '    unresolved: obs.ledger.unresolved,', replace: '    unresolved: [],' }] },
  { name: 'Persona — 화자 모름을 통과시킨다',
    edits: [{ file: F.plan, find: "  if (obs.attemptableSpeakers === null) return none('speakersUnknown')", replace: '  if (obs.attemptableSpeakers === null) limitedBy.push(\'speakersUnknown\')' },
      { file: F.plan, find: "  if (obs.attemptableSpeakers < n) { n = Math.max(0, obs.attemptableSpeakers); limitedBy.push('speakers') }",
        replace: "  if (obs.attemptableSpeakers !== null && obs.attemptableSpeakers < n) limitedBy.push('speakers')" },
      { file: F.plan, find: 'n < Math.min(paid.sources, env.batchMaxSources, obs.freshSourceCandidates, obs.attemptableSpeakers)', replace: 'n < Math.min(paid.sources, env.batchMaxSources, obs.freshSourceCandidates)' }] },
  { name: '회차 진행 중에도 가상 회차를 연다',
    edits: [{ file: F.plan, find: "  if (obs.supplyRunInProgress) return none('supplyRunInProgress')", replace: '' }] },
  { name: 'writer — 실패 상태도 완료로 본다',
    edits: [{ file: F.plan, find: "    if (r.status !== 'done' || r.completedAt === null) return", replace: '    if (r.completedAt === null) return' }] },
  { name: 'writer — 깨진 시작 시각을 받는다',
    edits: [{ file: F.plan, find: '    if (start === null) return', replace: '    if (start === -1) return' }] },
  { name: 'writer — 미래 완료(미래 시작 포함)를 받는다',
    edits: [{ file: F.plan, find: '    if (end === null || end < start || end > nowMs) return', replace: '    if (end === null || end < start!) return' }] },
  { name: 'writer — 시작보다 이른 완료를 받는다',
    edits: [{ file: F.plan, find: '    if (end === null || end < start || end > nowMs) return', replace: '    if (end === null || end > nowMs) return' }] },
  { name: 'writer — 깨진 회차 기록을 무시한다',
    edits: [{ file: F.plan, find: '  if (blockedBy !== undefined) return', replace: "  if (blockedBy === 'never') return" }] },
  { name: '잠금 제거 — 확인과 덧붙이기를 잠금 없이',
    edits: [{ file: F.io, find: '  return withLedgerLock(d, () => appendLocked(path, record))', replace: '  return appendLocked(path, record)' }] },
  { name: '정제 제거 — 보류 사유 문장을 기록한다',
    edits: [{ file: F.plan, find: '      settleHold: o.ledger.settleHold !== null,', replace: '      settleHold: o.ledger.settleHold as never,' }] },
  { name: '정제 제거 — 예약 원문을 기록한다',
    edits: [{ file: F.plan, find: '      unresolved: { count: o.ledger.unresolved.length, codes: [...new Set(o.ledger.unresolved.map((u) => u.code))].sort() },',
      replace: '      unresolved: o.ledger.unresolved as never,' }] },
  { name: '정제 제거 — 지출 판정 사유 문장을 기록한다',
    edits: [{ file: F.plan, find: '  v.ok ? { ok: true, code: null, remainingUsd: v.remainingUsd } : { ok: false, code: v.code, remainingUsd: null }', replace: '  v as never' }] },
  { name: 'CLI — 정제하지 않은 관측을 기록 · 해시',
    edits: [{ file: F.cli, find: '  const recorded = sanitizeObservation(observation)', replace: '  const recorded = observation' }] },
  { name: 'CLI — 미래 주입 시각을 받는다',
    edits: [{ file: F.cli, find: ' || now.getTime() > realNow.getTime()', replace: '' }] },
  { name: '비용 표본 — 미정산 회차를 받는다',
    edits: [{ file: F.plan, find: '    if (ev.some((e) => e.unsettled > 0)) return null\n', replace: '' }] },
  { name: '비용 표본 — 깨진 장부 날을 받는다',
    edits: [{ file: F.plan, find: '    if (days.get(r.ledgerDate) !== true) return null\n', replace: '' }] },
  { name: '회차 id — 달력 round-trip 검사 제거',
    edits: [{ file: F.plan, find: '  return same ? t : null', replace: '  return same || true ? t : null' }] },
  { name: '회차 기록 판독 — 달력 밖 id 를 받는다',
    edits: [{ file: F.io, find: '    if (runIdStartMs(m[1]!) === null || r === null', replace: '    if (r === null' }] },
  { name: '비용 표본 — judge 증거 없는 회차를 받는다(draft 만으로 단가)',
    edits: [{ file: F.plan, find: '    if (judge === undefined || judge.settled + judge.blocked === 0) return null\n', replace: '' },
      { file: F.plan, find: '    const ev = [judge, draft]', replace: '    const ev = judge === undefined ? [draft] : [judge, draft]' }] },
  { name: '비용 표본 — draft 증거 없는 회차를 받는다(judge 만으로 단가)',
    edits: [{ file: F.plan, find: '    if (draft === undefined || draft.settled + draft.blocked === 0) return null\n', replace: '' },
      { file: F.plan, find: '    const ev = [judge, draft]', replace: '    const ev = draft === undefined ? [judge] : [judge, draft]' }] },
  { name: '봉투 상한 — controller 의도로 상한을 판정한다',
    edits: [{ file: F.plan, find: '    overCap: auto === null ? null : auto > env.publishHardCapPerDay,', replace: '    overCap: auto === null ? null : auto > (plan.controllerIntent?.target ?? env.publishHardCapPerDay),' }] },
  { name: '봉투 상한 — 계획 상한을 controller 목표로',
    edits: [{ file: F.plan, find: "  const base = { version: OPS_SHADOW_VERSION, kstDate, publishCap: env.publishHardCapPerDay, authority: 'none' as const }",
      replace: "  const base = { version: OPS_SHADOW_VERSION, kstDate, publishCap: decision?.releaseDailyTarget ?? env.publishHardCapPerDay, authority: 'none' as const }" }] },
  { name: '요청 상한 — 단계 예산 대신 무제한',
    edits: [{ file: F.plan, find: '    const budget = judgeStageBudget(k)', replace: "    const budget = { ok: true as const, perStage: { judge: 999, draft: 999 }, total: 999 }" }] },
  { name: '신선 원천 — 지난 슬롯 유효도 센다(관측 시각 무시)',
    edits: [{ file: F.plan, find: '    if (c.slotAgesH.some((age, i) => age !== null && slotMs[i]! > now.getTime())) n += 1',
      replace: '    if (c.slotAgesH.some((age) => age !== null)) n += 1' }] },
  { name: '신선 원천 — 정본 판독기 대신 느슨한 판독',
    edits: [{ file: F.plan, find: "  if (!read.ok || read.version !== 'v2') return null\n  const t = read.trace",
      replace: "  void read\n  const t = raw as typeof read extends { trace: infer X } ? X : never" }] },
]

const sha = (f: string): string => createHash('sha256').update(readFileSync(join(ROOT, f))).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
/**
 * 🔴 **강제 종료 대비 백업** (2026-11-11 실사고) — 하네스가 변이 중에 죽으면 `finally` 가 돌지 않아 변이 코드가 남는다.
 *    시작 전에 원본을 저장소 밖에 적어 두고, 앞 실행이 남긴 백업이 있으면 그것으로 먼저 되돌린 뒤 시작한다.
 */
const BACKUP = join(tmpdir(), `ops-shadow-mutation-backup-${createHash('sha256').update(ROOT).digest('hex').slice(0, 12)}`)
if (existsSync(BACKUP)) {
  for (const f of files) {
    const b = join(BACKUP, f.replace(/\//g, '__'))
    if (existsSync(b)) writeFileSync(join(ROOT, f), readFileSync(b, 'utf-8'), 'utf-8')
  }
  console.log(`  ⚠️ 앞 실행이 남긴 백업으로 원본을 되돌렸다 — ${BACKUP}`)
}
mkdirSync(BACKUP, { recursive: true })
for (const f of files) writeFileSync(join(BACKUP, f.replace(/\//g, '__')), readFileSync(join(ROOT, f), 'utf-8'), 'utf-8')
const original = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf-8')]))
const hashes = new Map(files.map((f) => [f, sha(f)]))
let caught = 0
let survived = 0
let invalid = 0
try {
  for (const m of MUTATIONS) {
    const next = new Map(original)
    let ok = true
    for (const e of m.edits) {
      const t = next.get(e.file)!
      if (t.split(e.find).length !== 2) { ok = false; break }
      next.set(e.file, t.replace(e.find, e.replace))
    }
    if (!ok) { invalid += 1; console.log(`  ⚠️ 무효 — 지점을 찾지 못했다: ${m.name}`); continue }
    for (const [f, t] of next) writeFileSync(join(ROOT, f), t, 'utf-8')
    // 🔴 빠른 검사만 반복한다 — 실제 20초 잠금 대기 · 동시 프로세스는 원본 check 에서 1회(구조 검사가 변이를 잡는다)
    const r = spawnSync(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'scripts/ops-shadow-plan-check.mts'), '--fast'], { cwd: ROOT, encoding: 'utf-8' })
    for (const [f, t] of original) writeFileSync(join(ROOT, f), t, 'utf-8')
    if (r.status !== 0) { caught += 1; console.log(`  ✅ 잡음 — ${m.name}`) } else { survived += 1; console.log(`  🔴 살아남음 — ${m.name}`) }
  }
} finally {
  for (const [f, t] of original) writeFileSync(join(ROOT, f), t, 'utf-8')
}
const restored = files.every((f) => sha(f) === hashes.get(f))
if (restored) rmSync(BACKUP, { recursive: true, force: true })
console.log(`\n${survived === 0 && invalid === 0 && restored ? '✅' : '🔴'} 변이 ${MUTATIONS.length}개 — 잡음 ${caught} · 살아남음 ${survived} · 무효 ${invalid} · 원본 해시 복원 ${restored ? '확인' : '실패'}`)
process.exit(survived === 0 && invalid === 0 && restored ? 0 : 1)
