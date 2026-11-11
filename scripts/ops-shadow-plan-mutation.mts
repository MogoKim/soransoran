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
  cyc: 'scripts/lib/ops-shadow-cycle.mts',
  sel: 'src/lib/ops-shadow-observer.ts',
  obs: 'scripts/ops-shadow-observer.mts',
  /** 🔴 무단 소비자 반례용 — observer 를 참조하면 안 되는 controller(변이 동안만 바뀌고 원본 해시로 복원된다) */
  ctl: 'scripts/stage-controller.mts',
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
  { name: '공용 사이클 — 정제하지 않은 관측을 기록 · 해시',
    edits: [{ file: F.cyc, find: '      recorded = sanitizeObservation(observation)', replace: '      recorded = observation as never' }] },
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
  // ── Phase 2 observer ──
  { name: 'observer — 진입점이 가드를 걸지 않는다',
    edits: [{ file: F.obs, find: '\ninstallShadowCallGuard()\n', replace: '\n' }] },
  { name: 'observer — 미래 주입 시각을 받는다',
    edits: [{ file: F.obs, find: ' || now.getTime() > realNow.getTime()', replace: '' }] },
  { name: '공용 사이클 — 가드 없이도 돈다',
    edits: [{ file: F.cyc, find: "  if (!isShadowGuardInstalled()) throw new Error('OPS_SHADOW_GUARD_MISSING — installShadowCallGuard() 를 먼저 부른다')\n", replace: '' }] },
  { name: '공용 사이클 — 자연 회차 cycle id 를 입력 해시로(관측 시각이 열쇠에 섞인다)',
    edits: [{ file: F.cyc, find: "source.kind === 'naturalRun' ? source.key : cycleHash", replace: 'cycleHash' }] },
  { name: '공용 사이클 — dayClose id 를 결과 해시로(마감 뒤 측정값마다 새 줄)',
    edits: [{ file: F.cyc, find: "cycleIdOf('dayClose', kstDate, naturalRunKeyOf(writer.runId, writer.completedAt))", replace: "cycleIdOf('dayClose', kstDate, closeHash)" }] },
  { name: '공용 사이클 — backfill 도 결정 · 장부 · DB 를 읽고 계획 · 관측을 싣는다',
    edits: [{ file: F.cyc, find: "  if (source.kind === 'naturalRun' && source.mode === 'backfill') return writeBackfillMarker(o, source)\n", replace: '' }] },
  { name: 'observer — 관측 시각을 회차 완료 시각으로',
    edits: [{ file: F.obs, find: "      now, clock: nowFlag === null ? 'real' : 'injected',", replace: "      now: new Date(w.completedAt), clock: nowFlag === null ? 'real' : 'injected'," }] },
  { name: 'observer — 단일 실행 잠금 없이 tick 을 돈다(경계에서 backfill 이 causal 을 앞지른다)',
    edits: [{ file: F.obs, find: 'const lock = acquireObserverLock(outDir)\n', replace: 'const lock = { acquired: true as const, holderPid: 0, release: (): void => {} }\n' }] },
  { name: '잠금 — 살아 있는 남의 잠금을 죽은 것으로 본다',
    edits: [{ file: F.io, find: "  if (pid !== null && pidAlive(pid)) return { acquired: false, reason: 'busy', holderPid: pid }\n", replace: '' }] },
  { name: '잠금 — 잡으려는 쪽이 정리 claim 을 무시한다',
    edits: [{ file: F.io, find: '  if (claimRaw !== null) {', replace: "  if (claimRaw === 'never') {" }] },
  { name: '잠금 — 주인이 죽은 정리 claim 을 건너뛰고 진행한다',
    edits: [{ file: F.io, find: '  if (claimRaw !== null) {', replace: '  if (claimRaw !== null && pidAlive(pidOfRaw(claimRaw) ?? -1)) {' }] },
  { name: '잠금 — 정리자가 같은 tick 에 잡는다',
    edits: [{ file: F.io, find: '  return cleanupStaleObserverLock(d, seen)\n',
      replace: "  const c = cleanupStaleObserverLock(d, seen)\n  if (c.acquired || c.reason !== 'cleaned') return c\n  return linkExclusive(d, lockPath, mine) ? { acquired: true, release: () => { unlinkIfRaw(lockPath, mine) } } : c\n" }] },
  { name: '잠금 — 옛 경합: 지우고 바로 다시 건다(claim 없이)',
    edits: [{ file: F.io, find: '  return cleanupStaleObserverLock(d, seen)\n',
      replace: "  unlinkSync(lockPath)\n  return linkExclusive(d, lockPath, mine) ? { acquired: true, release: () => { unlinkIfRaw(lockPath, mine) } } : { acquired: false, reason: 'raced', holderPid: null }\n" }] },
  { name: '잠금 — 정리자가 재검증하지 않는다',
    edits: [{ file: F.io, find: '    if (now !== seenRaw || (pid !== null && pidAlive(pid))) return', replace: '    if (pid !== null && pidAlive(pid)) return' }] },
  { name: '잠금 — release 가 원문을 확인하지 않는다',
    edits: [{ file: F.io, find: '  if (linkExclusive(d, lockPath, mine)) return { acquired: true, release: () => { unlinkIfRaw(lockPath, mine) } }',
      replace: '  if (linkExclusive(d, lockPath, mine)) return { acquired: true, release: () => { unlinkSync(lockPath) } }' }] },
  { name: '주입 시각 — 손 실행이 격리 계약 없이 --now 를 받는다',
    edits: [{ file: F.cli, find: 'if (nowFlag !== null && injectedClockProblems(process.env).length > 0) {', replace: 'if (nowFlag === "never" && injectedClockProblems(process.env).length > 0) {' }] },
  { name: '주입 시각 — observer 가 격리 계약 없이 --now 를 받는다',
    edits: [{ file: F.obs, find: 'if (nowFlag !== null && injectedClockProblems(process.env).length > 0) {', replace: 'if (nowFlag === "never" && injectedClockProblems(process.env).length > 0) {' }] },
  { name: '주입 시각 — 실제 계정 홈을 받는다',
    edits: [{ file: F.io, find: "  if (home === realHome) out.push(", replace: "  if (home === 'never' + realHome) out.push(" }] },
  { name: '주입 시각 — DIRECT_URL 을 보지 않는다',
    edits: [{ file: F.io, find: "  if (!isolated(env.DIRECT_URL)) out.push('DIRECT_URL 이 localhost 의 soran_test 가 아니다')\n", replace: '' }] },
  { name: '배포 겹침 — 배포 잠금이 있어도 tick 을 돈다',
    edits: [{ file: F.obs, find: 'if (deployLockPresent()) {', replace: 'if (deployLockPresent() && false) {' }] },
  { name: '소유 경계 — controller 가 observer 를 참조한다(허용 목록 밖 소비자)',
    edits: [{ file: F.ctl, find: '#!/usr/bin/env tsx\n', replace: "#!/usr/bin/env tsx\n// import { selectObserverWork } from '../src/lib/ops-shadow-observer'\n" }] },
  { name: '가드 — 중첩 설치를 받는다',
    edits: [{ file: F.io, find: "  if (guardInstalled) throw new Error('OPS_SHADOW_GUARD_NESTED — 가드가 이미 걸려 있다')\n", replace: '' }] },
  { name: '가드 — 남의 세대 · 두 번째 되돌리기를 받는다',
    edits: [{ file: F.io, find: "    if (!guardInstalled || guardGeneration !== generation) throw new Error('OPS_SHADOW_GUARD_RESTORE_MISUSE — 이미 풀렸거나 다른 설치의 되돌리기다')\n", replace: '    void generation\n' }] },
  { name: '선택기 — 열쇠에 tick 시각을 넣는다',
    edits: [{ file: F.sel, find: '      const key = naturalRunKeyOf(r.runId, r.completedAt!)', replace: '      const key = naturalRunKeyOf(r.runId, i.now.toISOString())' }] },
  { name: '선택기 — 자연 회차 권위를 우회한다(시작 시각으로 대체)',
    edits: [{ file: F.sel, find: "      if (r.naturalAt === null) return 'notNatural'\n", replace: '' },
      { file: F.sel, find: '      const natural = strictIsoMs(r.naturalAt)', replace: '      const natural = strictIsoMs(r.naturalAt ?? r.startedAt)' },
      { file: F.sel, find: '        runId: r.runId, completedAt: r.completedAt!, naturalAt: r.naturalAt,', replace: '        runId: r.runId, completedAt: r.completedAt!, naturalAt: r.naturalAt ?? r.startedAt,' }] },
  { name: '선택기 — stale 회차가 다른 회차를 막는다',
    edits: [{ file: F.sel, find: '  pending.sort(', replace: "  if (classes.some((c) => c.cls === 'stale')) pending.length = 0\n  pending.sort(" }] },
  { name: '선택기 — 오래 멈춘 회차를 stale 로 가르지 않는다',
    edits: [{ file: F.sel, find: "return nowMs - start < SUPPLY_RUN_WINDOW_MS ? 'running' : 'stale'", replace: "return 'running'" }] },
  { name: '선택기 — 늦게 본 회차도 causal 로',
    edits: [{ file: F.sel, find: "mode: nowMs - end <= OBSERVER_CAUSAL_LAG_MS ? 'causal' : 'backfill',", replace: "mode: 'causal' as const," }] },
  { name: '선택기 — 미래 완료를 받는다',
    edits: [{ file: F.sel, find: "      if (end > nowMs) return 'future'\n", replace: '' }] },
  { name: '선택기 — lookback 을 없앤다',
    edits: [{ file: F.sel, find: "      if (nowMs - end > OBSERVER_LOOKBACK_MS) return 'tooOld'\n", replace: '' }] },
  { name: '선택기 — 장부에 있는 회차를 또 고른다',
    edits: [{ file: F.sel, find: "      if (i.seenCycleIds.has(cycleId)) return 'seen'\n", replace: '' }] },
  { name: '선택기 — 완료 순서 대신 runId 역순',
    edits: [{ file: F.sel, find: '  pending.sort((a, b) => (Date.parse(a.completedAt) - Date.parse(b.completedAt)) || (a.runId < b.runId ? -1 : 1))',
      replace: '  pending.sort((a, b) => (a.runId < b.runId ? 1 : -1))' }] },
  { name: '선택기 — tick 상한을 없앤다',
    edits: [{ file: F.sel, find: '  return { work: pending.slice(0, take),', replace: '  return { work: pending,' }] },
  { name: '선택기 — 기록 날짜를 완료 시각의 날짜로',
    edits: [{ file: F.sel, find: '      const kstDate = kstDateOf(natural)', replace: '      const kstDate = kstDateOf(end)' }] },
  { name: 'writer — 자연 회차 권위를 우회한다',
    edits: [{ file: F.plan, find: '  const natural = inSlot.filter((r) => r.naturalAt !== null)', replace: '  const natural = inSlot' }] },
  { name: 'writer — follow-up 회차를 시작 시각으로 슬롯 귀속',
    edits: [{ file: F.plan, find: '  const slotAt = (r: SupplyRunView): number => Date.parse(r.naturalAt ?? r.startedAt)', replace: '  const slotAt = (r: SupplyRunView): number => Date.parse(r.startedAt)' }] },
  { name: 'IO — 자연 회차 판정을 trigger 문자열로(정본 우회)',
    edits: [{ file: F.io, find: 'naturalAt: naturalScheduledRunEvidenceAt(r.runTokenShadow, r.startedAt)', replace: "naturalAt: (r.runTokenShadow as { trigger?: unknown } | null)?.trigger === 'scheduled' ? r.startedAt : null" }] },
  { name: 'IO — 깨진 장부 줄을 건너뛴다',
    edits: [{ file: F.io, find: "      try { id = (JSON.parse(line) as { cycleId?: unknown }).cycleId } catch { throw new Error(`OPS_SHADOW_CORRUPT: ${path}`) }\n      if (typeof id === 'string') out.add(id)",
      replace: "      try { id = (JSON.parse(line) as { cycleId?: unknown }).cycleId } catch { continue }\n      if (typeof id === 'string') out.add(id)" }] },
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
