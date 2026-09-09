/**
 * 공급 Autopilot v1 fixture (§4-AU)
 *
 * 🔴 네트워크 0 · LLM 0 · DB 0 · 파일 write 0. 순수 판정만 검사한다.
 */

import { readFileSync } from 'node:fs'

import {
  AUTOPILOT_KILL_SWITCH_ENV, CHILD_KILL_SWITCH_ENV, COLLECT_CAP, COLLECT_MIN,
  LOCK_TTL_MS, STAGES, DB_WRITE_STAGES, LLM_STAGES, NETWORK_STAGES,
  collectCapFor, judgeRun, planStages, lockDecision, nextStage, shouldStopRun,
  verifyRun, fmtCount, resumeDecision, stageInputArgs, missingArtifacts, newFiles, upstreamOf,
  attemptOf, runStages, supersedes, adaptKeyOf, planStaleLock, mayWriteRunState,
  judgeStageFailure, STAGE_SOURCE, judgeSourceBlocked, REMOTE_FAILURE_CLASSES,
  type GuardProbe, type BreakerMark,
  type Artifacts, type Checkpoint, type ExecResult, type Stage,
  type StageOutcome, type StockSnapshot,
} from '../src/lib/supply-autopilot'
import { STOCK_TARGET } from '../src/lib/micro-seed-supply-autofill'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

const stock = (usable: number, human = 0, machine = 0): StockSnapshot => ({
  usable, human, machine, shortfall: Math.max(0, STOCK_TARGET - usable),
})
const NOW = new Date('2026-09-07T12:00:00.000Z')
const full = { live: true, killOpen: true, childKillOpen: true, lock: 'free' as const }

console.log('\n══ 공급 Autopilot v1 fixture ══\n')

// ── ① 재고가 스위치보다 앞이다 ──
check('🟢 재고 14 → no-op', (() => {
  const v = judgeRun({ ...full, stock: stock(14, 5, 9) })
  return !v.ok && v.code === 'NOOP_STOCK_OK'
})())
check('🟢 재고가 목표를 넘어도 no-op', (() => {
  const v = judgeRun({ ...full, stock: stock(20) })
  return !v.ok && v.code === 'NOOP_STOCK_OK'
})())
check('🔴 재고가 차 있으면 kill switch 가 열려 있어도 밖으로 나가지 않는다', (() => {
  const v = judgeRun({ ...full, stock: stock(14) })
  return !v.ok && v.code === 'NOOP_STOCK_OK'
})())
check('🟢 재고 13 → 돈다 · 부족 1', (() => {
  const v = judgeRun({ ...full, stock: stock(13) })
  return v.ok && v.shortfall === 1
})())
check('🟢 재고 5 → 부족 9', (() => {
  const v = judgeRun({ ...full, stock: stock(5, 5, 0) })
  return v.ok && v.shortfall === 9
})())

// ── ② 이중 스위치 ──
check('🔴 dry-run 이 기본이다 — --live 없으면 돌지 않는다', (() => {
  const v = judgeRun({ ...full, live: false, stock: stock(5) })
  return !v.ok && v.code === 'DRY_RUN'
})())
check('🔴 --live 하나로는 열리지 않는다', (() => {
  const v = judgeRun({ ...full, killOpen: false, stock: stock(5) })
  return !v.ok && v.code === 'NO_KILL_SWITCH'
})())
check('🔴 하위 수집 스위치가 없으면 시작하지 않는다 — 반쪽 상태를 남기지 않는다', (() => {
  const v = judgeRun({ ...full, childKillOpen: false, stock: stock(5) })
  return !v.ok && v.code === 'NO_CHILD_KILL_SWITCH'
})())
check('🔴 kill switch 이름이 바뀌지 않았다', AUTOPILOT_KILL_SWITCH_ENV === 'SORAN_SUPPLY_AUTOPILOT_ENABLED')
check('🔴 하위 kill switch 는 기존 thin 것을 그대로 쓴다',
  CHILD_KILL_SWITCH_ENV === 'SORAN_82COOK_THIN_DETAIL_ENABLED')

// ── ③ 동시 실행 · stale ──
check('🔴 앞 회차가 돌면 이번 회차는 돌지 않는다', (() => {
  const v = judgeRun({ ...full, lock: 'busy', stock: stock(5) })
  return !v.ok && v.code === 'LOCKED'
})())
check('🟢 lock 이 없으면 free', lockDecision(null, NOW) === 'free')
check('🟢 방금 잡은 lock 은 busy', lockDecision(
  { runId: 'r', pid: 1, startedAt: new Date(NOW.getTime() - 60_000).toISOString() }, NOW) === 'busy')
check('🔴 TTL 을 넘긴 lock 은 stale — 죽은 lock 이 영원히 막지 않는다', lockDecision(
  { runId: 'r', pid: 1, startedAt: new Date(NOW.getTime() - LOCK_TTL_MS - 1).toISOString() }, NOW) === 'stale')
check('🔴 시각을 못 읽는 lock 은 stale', lockDecision({ runId: '', pid: 0, startedAt: '' }, NOW) === 'stale')
check('🔴 재고 no-op 이 lock 판정보다 앞이다 — 재고가 차면 lock 이 잡혀도 조용하다', (() => {
  const v = judgeRun({ ...full, lock: 'busy', stock: stock(14) })
  return !v.ok && v.code === 'NOOP_STOCK_OK'
})())

// ── ④ 수집량 ──
check('🟢 부족 9 → 36건 연다', collectCapFor(9) === 36)
check('🔴 상한 50 을 넘지 않는다', collectCapFor(14) === COLLECT_CAP && collectCapFor(999) === COLLECT_CAP)
check('🔴 하한 10 을 지킨다 — 1건 부족하다고 1건만 열면 못 채운다', collectCapFor(1) === COLLECT_MIN)
check('🟢 부족 0 이면 0건', collectCapFor(0) === 0)
check('🔴 상한은 하위 스크립트 BATCH_CAP 과 같은 50', COLLECT_CAP === 50)

// ── ⑤ 단계 계획 ──
const plan = planStages({ collectCap: 36, shortfall: 9 })
check('🟢 6단계다', plan.length === 6)
check('🔴 순서가 수집 → 카페 얇게 → 변환 → 판정 → 초안 → 보충이다',
  plan.map((p) => p.stage).join(',') === 'collect,cafeThin,adapt,judge,draft,fill')
// 🔴 네이버 얇은 변환은 밖으로도 모델로도 나가지 않는다 — 순서에 넣는 비용이 없다
check('🔴 cafeThin 은 네트워크·LLM·DB 를 쓰지 않는다', (() => {
  const st = plan.find((x) => x.stage === 'cafeThin')
  return st !== undefined && !st.network && !st.llm && !st.dbWrite
})())
check('🔴 cafeThin 은 --apply 만 받는다', (() => {
  const st = plan.find((x) => x.stage === 'cafeThin')
  return st !== undefined && st.args.join(' ') === '--apply'
})())
check('🔴 STAGES 상수와 계획 순서가 같다', plan.map((p) => p.stage).join(',') === STAGES.join(','))
check('🔴 수집은 --live 와 --cap 을 둘 다 받는다', (() => {
  const a = plan[0].args.join(' ')
  return a.includes('--live') && a.includes('--cap=36')
})())
check('🔴 보충은 목표까지만 — 상한이 부족분과 같다', (plan.find((x) => x.stage === 'fill')?.args.join(' ') ?? '') === '--apply --up-to=9')
check('🔴 판정·초안은 --call --apply 계약을 지킨다',
  (plan.find((x) => x.stage === 'judge')?.args.join(' ') ?? '') === '--call --apply'
  && (plan.find((x) => x.stage === 'draft')?.args.join(' ') ?? '') === '--call --apply')
check('🔴 --apply 단독으로 판정기를 부르지 않는다',
  !plan.some((p) => (p.stage === 'judge' || p.stage === 'draft') && !p.args.includes('--call')))
check('🔴 밖으로 나가는 단계는 수집 하나뿐이다',
  plan.filter((p) => p.network).map((p) => p.stage).join(',') === 'collect')
check('🔴 DB 에 쓰는 단계는 보충 하나뿐이다',
  plan.filter((p) => p.dbWrite).map((p) => p.stage).join(',') === 'fill')
check('🔴 모델을 부르는 단계는 판정·초안뿐이다',
  plan.filter((p) => p.llm).map((p) => p.stage).join(',') === 'judge,draft')
check('🔴 상수 표와 계획이 어긋나지 않는다', (() => (
  NETWORK_STAGES.join(',') === 'collect' && LLM_STAGES.join(',') === 'judge,draft'
  && DB_WRITE_STAGES.join(',') === 'fill'
))())
check('🟢 부족 1건이어도 보충 상한은 1이다', planStages({ collectCap: 10, shortfall: 1 }).find((x) => x.stage === 'fill')?.args.includes('--up-to=1') === true)

// ── ⑥ 부분 실패 ──
const okOutcome = (stage: string): StageOutcome => ({
  stage: stage as StageOutcome['stage'], status: 'ok', exitCode: 0,
  startedAt: '', endedAt: '', note: '',
})
check('🟢 아무것도 안 돌았으면 첫 단계부터', nextStage(plan, [])?.stage === 'collect')
check('🟢 수집이 끝나면 카페 얇은 변환', nextStage(plan, [okOutcome('collect')])?.stage === 'cafeThin')
check('🟢 카페 변환이 끝나면 검수용 변환',
  nextStage(plan, [okOutcome('collect'), okOutcome('cafeThin')])?.stage === 'adapt')
check('🔴 이번 회차 안에서는 실패 뒤로 가지 않는다', (() => {
  const done: StageOutcome[] = [okOutcome('collect'),
    { ...okOutcome('adapt'), status: 'failed', exitCode: 1 }]
  return shouldStopRun(done)
})())
check('🟢 실패가 없으면 계속 간다', !shouldStopRun([okOutcome('collect'), okOutcome('adapt')]))
check('🔴 실패한 단계는 끝난 것이 아니라 미완료다 — 다음 회차가 거기서 잇는다', (() => {
  const done: StageOutcome[] = [okOutcome('collect'), okOutcome('cafeThin'),
    { ...okOutcome('adapt'), status: 'failed', exitCode: 1 }]
  return nextStage(plan, done)?.stage === 'adapt'
})())
check('🟢 전부 끝나면 null', nextStage(plan, STAGES.map((s) => okOutcome(s))) === null)

// ── ⑥-b 재개 — 🔴 실패 단계별 시나리오 ──
const A = (over: Partial<Checkpoint> = {}): Checkpoint => ({
  runId: '20260907-210000', startedAt: '2026-09-07T12:00:00.000Z',
  status: 'running', completedAt: null, shortfall: 9, collectCap: 36,
  stock: { before: stock(5, 5, 0), after: null }, stages: [], artifacts: {},
  ...over,
})
const failedAt = (stage: Stage, okBefore: readonly string[]): StageOutcome[] => [
  ...okBefore.map((x) => okOutcome(x)),
  { ...okOutcome(stage), status: 'failed', exitCode: 1 },
]
const ART: Artifacts = {
  collect: ['.microseed-data/82cook-thin-R1.thin-detail.jsonl', '.microseed-data/82cook-thin-R1.thin-detail.tsv'],
  cafeThin: ['.microseed-data/navercafe-thin-wgang-R1.thin-detail.jsonl'],
  adapt: ['.microseed-data/82cook-adapt-R1.detail.jsonl', '.microseed-data/82cook-adapt-R1.raw-detail.jsonl'],
  judge: ['.microseed-data/auto-judge-R2.shadow.jsonl'],
  draft: ['.microseed-data/auto-draft-R3.candidates.json', '.microseed-data/auto-draft-R3.picks.jsonl'],
}
const allExist = (): boolean => true

// ① adapt 실패 → adapt 부터 재개 · collect 재호출 0
check('🔴 ① adapt 실패 → 다음 회차는 adapt 부터', (() => {
  const cp = A({ stages: failedAt('adapt', ['collect', 'cafeThin']), artifacts: { collect: ART.collect, cafeThin: ART.cafeThin } })
  const r = resumeDecision({ checkpoint: cp, plan })
  return r.kind === 'resume' && r.from === 'adapt'
})())
check('🔴 ① adapt 재개 시 collect 를 다시 부르지 않는다', (() => {
  const cp = A({ stages: failedAt('adapt', ['collect', 'cafeThin']), artifacts: { collect: ART.collect, cafeThin: ART.cafeThin } })
  const r = resumeDecision({ checkpoint: cp, plan })
  // 재개 지점부터 남은 단계에 collect 가 없어야 한다
  const rest = plan.slice(plan.findIndex((x) => x.stage === (r.kind === 'resume' ? r.from : 'collect')))
  return !rest.some((x) => x.stage === 'collect')
})())
check('🔴 ① adapt 는 82cook 과 네이버 얇은 파일을 **함께** 받는다 — 한쪽만 넘기면 그 소스가 빠진다', (() => {
  const a = stageInputArgs('adapt', ART)
  return a.length === 1
    && a[0].includes('82cook-thin-R1.thin-detail.jsonl')
    && a[0].includes('navercafe-thin-wgang-R1.thin-detail.jsonl')
})())
check('🔴 cafeThin 은 앞 단계에서 이어받지 않는다 — launchd 수집물을 스스로 찾는다',
  stageInputArgs('cafeThin', ART).length === 0)
check('🔴 네이버를 안 돌린 날에도 adapt 가 82cook 것만으로 이어진다', (() => {
  const a = stageInputArgs('adapt', { collect: ART.collect })
  return a.length === 1 && a[0].includes('82cook-thin-R1')
})())
check('🔴 cafeThin 재개는 앞 산출물이 없어도 fail closed 가 아니다 — 네이버를 안 돌린 날이 그렇다',
  missingArtifacts({ from: 'cafeThin', artifacts: {}, exists: () => false }).length === 0)

// ② judge 실패 → judge 부터 재개
check('🔴 ② judge 실패 → 다음 회차는 judge 부터', (() => {
  const cp = A({ stages: failedAt('judge', ['collect', 'cafeThin', 'adapt']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  return r.kind === 'resume' && r.from === 'judge'
})())
check('🔴 ② judge 재개 시 collect · cafeThin · adapt 를 다시 부르지 않는다', (() => {
  const cp = A({ stages: failedAt('judge', ['collect', 'cafeThin', 'adapt']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  if (r.kind !== 'resume') return false
  const rest = plan.slice(plan.findIndex((x) => x.stage === r.from))
  return !rest.some((x) => ['collect', 'cafeThin', 'adapt'].includes(x.stage))
})())
check('🔴 ② judge 는 adapt 가 만든 두 파일을 함께 받는다', (() => {
  const a = stageInputArgs('judge', ART)
  return a.length === 1
    && a[0].includes('82cook-adapt-R1.detail.jsonl')
    && a[0].includes('82cook-adapt-R1.raw-detail.jsonl')
})())

// ③ draft 실패 → draft 부터 재개
check('🔴 ③ draft 실패 → 다음 회차는 draft 부터', (() => {
  const cp = A({ stages: failedAt('draft', ['collect', 'cafeThin', 'adapt', 'judge']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  return r.kind === 'resume' && r.from === 'draft'
})())
check('🔴 ③ draft 재개 시 앞 네 단계를 다시 부르지 않는다', (() => {
  const cp = A({ stages: failedAt('draft', ['collect', 'cafeThin', 'adapt', 'judge']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  if (r.kind !== 'resume') return false
  const rest = plan.slice(plan.findIndex((x) => x.stage === r.from))
  return !rest.some((x) => ['collect', 'cafeThin', 'adapt', 'judge'].includes(x.stage))
})())
check('🔴 ③ draft 는 그 회차의 shadow 만 받는다', (() => {
  const a = stageInputArgs('draft', ART)
  return a.length === 1 && a[0] === '--input=.microseed-data/auto-judge-R2.shadow.jsonl'
})())

// ④ fill 실패 → fill 부터 재개 · 새 원천 수집 0
check('🔴 ④ fill 실패 → 다음 회차는 fill 부터', (() => {
  const cp = A({ stages: failedAt('fill', ['collect', 'cafeThin', 'adapt', 'judge', 'draft']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  return r.kind === 'resume' && r.from === 'fill'
})())
check('🔴 ④ fill 재개 시 새 원천을 수집하지 않는다', (() => {
  const cp = A({ stages: failedAt('fill', ['collect', 'cafeThin', 'adapt', 'judge', 'draft']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  if (r.kind !== 'resume') return false
  const rest = plan.slice(plan.findIndex((x) => x.stage === r.from))
  return rest.length === 1 && rest[0].stage === 'fill' && !rest.some((x) => x.network)
})())
check('🔴 ④ fill 은 그 회차의 candidates 만 받는다 — picks 는 넘기지 않는다', (() => {
  const a = stageInputArgs('fill', ART)
  return a.length === 1 && a[0] === '--input=.microseed-data/auto-draft-R3.candidates.json'
})())

// ⑤ 죽은 lock 회수 + checkpoint 재개는 별개다
check('🔴 ⑤ 죽은 lock 을 걷어내도 미완료 checkpoint 는 재개 대상으로 남는다', (() => {
  const dead = lockDecision(
    { runId: 'x', pid: 1, startedAt: new Date(NOW.getTime() - LOCK_TTL_MS - 1).toISOString() }, NOW)
  const cp = A({ stages: failedAt('judge', ['collect', 'cafeThin', 'adapt']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  return dead === 'stale' && r.kind === 'resume' && r.from === 'judge'
})())
check('🔴 ⑤ 강제 종료로 단계 기록이 없는 회차도 collect 부터 이어진다 — 산출물이 없으니 누락도 없다', (() => {
  const cp = A({ stages: [], artifacts: {} })
  const r = resumeDecision({ checkpoint: cp, plan })
  return r.kind === 'resume' && r.from === 'collect'
    && missingArtifacts({ from: 'collect', artifacts: {}, exists: allExist }).length === 0
})())

// ⑥ artifact 누락 → fail closed
check('🔴 ⑥ 이어받을 파일이 사라지면 fail closed', (() => {
  const gone = missingArtifacts({
    from: 'judge', artifacts: ART, exists: (f) => !f.includes('82cook-adapt'),
  })
  return gone.length === 2
})())
check('🔴 ⑥ 앞 단계 산출물 기록 자체가 없으면 fail closed', (() => {
  const gone = missingArtifacts({ from: 'draft', artifacts: { collect: ART.collect, cafeThin: ART.cafeThin }, exists: allExist })
  return gone.length === 1 && gone[0].includes('judge')
})())
check('🟢 ⑥ 파일이 다 있으면 통과', missingArtifacts({ from: 'fill', artifacts: ART, exists: allExist }).length === 0)
check('🔴 ⑥ 재개 지점의 앞 단계를 정확히 본다', (() => (
  upstreamOf('collect') === null && upstreamOf('cafeThin') === 'collect'
  && upstreamOf('adapt') === 'cafeThin' && upstreamOf('judge') === 'adapt'
  && upstreamOf('draft') === 'judge' && upstreamOf('fill') === 'draft'
))())

// ⑦ 완료 회차는 재사용하지 않는다
check('🔴 ⑦ done 인 회차는 재개하지 않는다 — 같은 후보를 두 번 적재하지 않는다', (() => {
  const cp = A({
    status: 'done', completedAt: '2026-09-07T13:00:00.000Z',
    stages: STAGES.map((x) => okOutcome(x)), artifacts: ART,
  })
  return resumeDecision({ checkpoint: cp, plan }).kind === 'fresh'
})())
check('🟢 ⑦ checkpoint 가 없으면 새로 시작한다', resumeDecision({ checkpoint: null, plan }).kind === 'fresh')
check('🔴 ⑦ 단계가 다 끝났는데 running 으로 남은 기록은 재개하지 않는다', (() => {
  const cp = A({ stages: STAGES.map((x) => okOutcome(x)), artifacts: ART })
  return resumeDecision({ checkpoint: cp, plan }).kind === 'fresh'
})())

// ⑧ 새로 생긴 파일만 그 단계 것으로 센다
check('🟢 ⑧ 단계 전후 차이로 산출물을 알아낸다', (() => {
  const made = newFiles(['a', 'b'], ['a', 'b', 'c', 'd'])
  return made.length === 2 && made[0] === 'c'
})())
check('🔴 ⑧ 앞 회차 파일을 이번 단계 것으로 세지 않는다', newFiles(['old'], ['old']).length === 0)

// ⑩ 이미 처리한 원천 재수집 방지는 하위 계약이다 — 러너가 그것을 무력화하지 않는다
check('🔴 ⑩ 재개는 collect 를 건너뛰므로 같은 원천을 다시 열지 않는다', (() => {
  const cp = A({ stages: failedAt('fill', ['collect', 'cafeThin', 'adapt', 'judge', 'draft']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  if (r.kind !== 'resume') return false
  const rest = plan.slice(plan.findIndex((x) => x.stage === r.from))
  return rest.every((x) => !x.network)
})())
check('🔴 ⑩ 재개해도 계획은 앞 회차 것이다 — 상한이 달라지지 않는다', (() => {
  const cp = A({ shortfall: 9, collectCap: 36 })
  const p2 = planStages({ collectCap: cp.collectCap, shortfall: cp.shortfall })
  return (p2.find((x) => x.stage === 'fill')?.args.join(' ') ?? '') === '--apply --up-to=9'
})())

// ══════════════════════════════════════════════════════════════════
// 러너 수준 — 🔴 **실제 호출 순서와 횟수를 본다.**
//
// 2026-09-07 결함: 재개하면서 shouldStopRun(cp.stages) 를 루프 첫 줄에 뒀다.
// cp.stages 에는 지난 회차의 failed 가 그대로 있어서, 이어받은 단계를
// **한 번도 부르지 않고** 즉시 멈췄다. 판정 함수만 검사하던 fixture 는 그것을 못 봤다.
// ══════════════════════════════════════════════════════════════════

/** 가짜 실행기 — 어떤 단계를 몇 번 불렀는지 세고, 지정한 단계에서만 실패시킨다 */
const fakeExec = (failOn: readonly Stage[] = []) => {
  const calls: Stage[] = []
  const fn = async (stage: Stage): Promise<ExecResult> => {
    calls.push(stage)
    const bad = failOn.includes(stage)
    return {
      ok: !bad, exitCode: bad ? 1 : 0, spawnError: '',
      made: [`.microseed-data/made-by-${stage}.out`],
    }
  }
  return { calls, fn }
}
const CLOCK = (): string => '2026-09-07T12:00:00.000Z'
const failedOutcome = (stage: Stage): StageOutcome => ({
  stage, status: 'failed', exitCode: 1, startedAt: '', endedAt: '', note: '🔴 실패',
})

/** 지난 회차가 `stage` 에서 끊긴 checkpoint */
const brokenAt = (stage: Stage): Checkpoint => {
  const i = STAGES.indexOf(stage)
  // 🔴 ART 를 그대로 넘기면 runStages 가 그 객체를 덮어써 다음 검사가 오염된다
  return A({
    stages: [...STAGES.slice(0, i).map((x) => okOutcome(x)), failedOutcome(stage)],
    artifacts: JSON.parse(JSON.stringify(ART)) as Artifacts,
  })
}

// 🔴 사용자가 짚은 실측 그대로 — 이것이 false 여야 재개가 시작된다
check('🔴 [실측] collect ok + adapt failed 를 이어받아도 루프가 즉시 멈추지 않는다', (() => {
  const stages = [okOutcome('collect'), failedOutcome('adapt')]
  const loopStopsImmediately = shouldStopRun(attemptOf(stages, stages.length))
  return loopStopsImmediately === false
})())
check('🔴 [대조] 이력 전체를 넘기면 멈춘다 — 그래서 attempt 몫만 넘겨야 한다', (() => {
  const stages = [okOutcome('collect'), failedOutcome('adapt')]
  return shouldStopRun(stages) === true
})())
check('🟢 attempt 경계 이후 기록만 본다', (() => {
  const stages = [okOutcome('collect'), failedOutcome('adapt'), okOutcome('adapt')]
  const mine = attemptOf(stages, 2)
  return mine.length === 1 && mine[0].stage === 'adapt' && mine[0].status === 'ok'
})())

// ── 재개 4종: 실제로 그 단계를 부르고, 앞 단계는 부르지 않는다 ──
for (const broken of ['adapt', 'judge', 'draft', 'fill'] as const) {
  const idx = STAGES.indexOf(broken)
  const before = STAGES.slice(0, idx)
  const expected = STAGES.slice(idx)

  // 성공 재개
  {
    const cp = brokenAt(broken)
    const past = cp.stages.length
    const ex = fakeExec()
    const r = await runStages({ plan, checkpoint: cp, exec: ex.fn, now: CLOCK })
    check(`🔴 [러너] ${broken} 재개 — ${broken} 부터 끝까지 부른다`,
      ex.calls.join(',') === expected.join(','))
    for (const b of before) {
      check(`🔴 [러너] ${broken} 재개 — ${b} 를 다시 부르지 않는다 (호출 0)`,
        ex.calls.filter((c) => c === b).length === 0)
    }
    check(`🔴 [러너] ${broken} 재개 — 마지막까지 성공하면 status=done`, r.status === 'done')
    check(`🔴 [러너] ${broken} 재개 — exit 0`, r.exitCode === 0)
    check(`🔴 [러너] ${broken} 재개 — 과거 실패 기록은 checkpoint 에 남는다`,
      cp.stages.slice(0, past).some((x) => x.status === 'failed' && x.stage === broken))
    check(`🔴 [러너] ${broken} 재개 — failedStage 에 과거 실패가 오지 않는다`, r.failedStage === null)
    check(`🔴 [러너] ${broken} 재개 — completedAt 이 찍힌다`, cp.completedAt !== null)
  }

  // 같은 자리에서 또 실패
  {
    const cp = brokenAt(broken)
    const ex = fakeExec([broken])
    const r = await runStages({ plan, checkpoint: cp, exec: ex.fn, now: CLOCK })
    check(`🔴 [러너] ${broken} 재개 — 이번에도 실패하면 그 단계까지만 부른다`,
      ex.calls.join(',') === broken)
    const after = STAGES.slice(idx + 1)
    check(`🔴 [러너] ${broken} 재개 — 뒤 단계 호출 0`,
      after.every((a) => !ex.calls.includes(a)))
    check(`🔴 [러너] ${broken} 재개 — status=running 유지`, r.status === 'running')
    check(`🔴 [러너] ${broken} 재개 — exit 1`, r.exitCode === 1)
    check(`🔴 [러너] ${broken} 재개 — failedStage 는 이번 실패다`, r.failedStage === broken)
    check(`🔴 [러너] ${broken} 재개 — completedAt 은 비어 있다`, cp.completedAt === null)
  }
}

// ── 새 회차(빈 checkpoint) ──
{
  const cp = A()
  const ex = fakeExec()
  const r = await runStages({ plan, checkpoint: cp, exec: ex.fn, now: CLOCK })
  check('🟢 [러너] 새 회차는 collect 부터 다섯 단계를 부른다', ex.calls.join(',') === STAGES.join(','))
  check('🟢 [러너] 새 회차 완주 → status=done · exit 0', r.status === 'done' && r.exitCode === 0)
}
{
  const cp = A()
  const ex = fakeExec(['collect'])
  const r = await runStages({ plan, checkpoint: cp, exec: ex.fn, now: CLOCK })
  check('🔴 [러너] 첫 단계 실패 → 그 하나만 부른다', ex.calls.join(',') === 'collect')
  check('🔴 [러너] 첫 단계 실패 → running · exit 1', r.status === 'running' && r.exitCode === 1)
}

// ── 이미 끝난 회차를 다시 돌려도 아무 단계도 부르지 않는다 ──
{
  const cp = A({ stages: STAGES.map((x) => okOutcome(x)), artifacts: JSON.parse(JSON.stringify(ART)) as Artifacts })
  const ex = fakeExec()
  const r = await runStages({ plan, checkpoint: cp, exec: ex.fn, now: CLOCK })
  check('🔴 [러너] 이미 다 성공한 회차는 한 단계도 다시 부르지 않는다', ex.calls.length === 0)
  check('🔴 [러너] 그 경우 status=done · exit 0', r.status === 'done' && r.exitCode === 0)
}

// ── 과거 실패 + 이번 성공이 섞여도 done 으로 간다 ──
{
  const cp = A({
    stages: [okOutcome('collect'), failedOutcome('adapt'), failedOutcome('adapt')],
    artifacts: JSON.parse(JSON.stringify(ART)) as Artifacts,
  })
  const ex = fakeExec()
  const r = await runStages({ plan, checkpoint: cp, exec: ex.fn, now: CLOCK })
  check('🔴 [러너] 두 번 실패한 이력이 있어도 이번에 성공하면 done', r.status === 'done')
  check('🔴 [러너] 그 경우에도 collect 는 다시 부르지 않는다', !ex.calls.includes('collect'))
  check('🔴 [러너] 과거 실패 2건이 감사 기록으로 남는다',
    cp.stages.filter((x) => x.status === 'failed').length === 2)
}

// ── exact input 이 실제 호출 인자에 실린다 ──
{
  const cp = brokenAt('judge')
  const ex: { calls: { stage: Stage; args: string[] }[] } = { calls: [] }
  const r = await runStages({
    plan, checkpoint: cp, now: CLOCK,
    exec: async (stage, args) => {
      ex.calls.push({ stage, args: [...args] })
      return { ok: true, exitCode: 0, spawnError: '', made: [`.microseed-data/x-${stage}.out`] }
    },
  })
  const judgeCall = ex.calls.find((c) => c.stage === 'judge')
  check('🔴 [러너] judge 호출에 앞 회차 adapt 산출물이 --input 으로 실린다',
    judgeCall !== undefined && judgeCall.args.some((a) => a.startsWith('--input=')
      && a.includes('82cook-adapt-R1.detail.jsonl')))
  check('🔴 [러너] fill 호출에 상한이 그대로 실린다',
    ex.calls.find((c) => c.stage === 'fill')?.args.includes('--up-to=9') === true)
  check('🟢 [러너] 그 회차도 done', r.status === 'done')
}

// ── 재고가 먼저 찼을 때 ──
check('🔴 DB 가 목표를 채웠으면 미완료 회차를 잇지 않는다', supersedes({ usable: 14 }))
check('🟢 재고가 모자라면 종결하지 않는다', !supersedes({ usable: 13 }))
check('🔴 dry-run 은 checkpoint 와 데이터 디렉터리를 바꾸지 않는다',
  !mayWriteRunState({ live: false, killOpen: true, childKillOpen: true }))
check('🔴 전체 kill switch 가 닫히면 실행 상태를 바꾸지 않는다',
  !mayWriteRunState({ live: true, killOpen: false, childKillOpen: true }))
check('🔴 수집 kill switch 가 닫히면 실행 상태를 바꾸지 않는다',
  !mayWriteRunState({ live: true, killOpen: true, childKillOpen: false }))
check('🟢 live + 두 스위치가 모두 열릴 때만 실행 상태를 바꾼다',
  mayWriteRunState({ live: true, killOpen: true, childKillOpen: true }))
check('🔴 superseded 는 재개 대상이 아니다 — 영구 running 기록을 남기지 않는다', (() => {
  const cp = A({ status: 'superseded', stages: [okOutcome('collect'), failedOutcome('adapt')] })
  // findUnfinished 는 status==='running' 만 집으므로 superseded 는 애초에 잡히지 않는다
  return cp.status !== 'running'
})())

// ══════════════════════════════════════════════════════════════════
// 🔴 시간축 — 네이버 thin 은 러너가 시작하기 **전에** 이미 있다
//    09:20 remonterrace · 13:20 wgang · 21:10 러너.
//    "실행 중 새로 생긴 파일" 로만 세면 그 둘이 adapt 입력에서 통째로 빠진다.
// ══════════════════════════════════════════════════════════════════
const PRE_R = '.microseed-data/navercafe-thin-remonterrace-20260907-092000.thin-detail.jsonl'
const PRE_W = '.microseed-data/navercafe-thin-wgang-20260907-132000.thin-detail.jsonl'
const NEW_82 = '.microseed-data/82cook-thin-20260907-211000.thin-detail.jsonl'
const NEW_CAFE = '.microseed-data/navercafe-thin-remonterrace-20260907-211500.thin-detail.jsonl'

// A. 세 갈래가 모두 adapt --input 에 들어간다
check('🔴 [A] 미리 있던 remonterrace · wgang 과 이번 회차 82cook 이 **모두** adapt 입력에 들어간다', (() => {
  const a = stageInputArgs('adapt', { collect: [NEW_82], preexisting: [PRE_R, PRE_W] })
  return a.length === 1
    && a[0].includes('82cook-thin-20260907-211000')
    && a[0].includes('navercafe-thin-remonterrace-20260907-092000')
    && a[0].includes('navercafe-thin-wgang-20260907-132000')
})())
check('🔴 [A] 82cook 이 생겨도 미리 있던 네이버 파일이 밀려나지 않는다', (() => {
  const a = stageInputArgs('adapt', { collect: [NEW_82], preexisting: [PRE_R, PRE_W] })
  return (a[0].match(/\.thin-detail\.jsonl/g) ?? []).length === 3
})())
check('🔴 [A] 네 갈래(82cook · 역사변환 · 미리있던 둘)가 전부 들어간다', (() => {
  const a = stageInputArgs('adapt', {
    collect: [NEW_82], cafeThin: [NEW_CAFE], preexisting: [PRE_R, PRE_W],
  })
  return (a[0].match(/\.thin-detail\.jsonl/g) ?? []).length === 4
})())
check('🔴 [A] 같은 파일이 두 갈래에 있어도 한 번만 넘어간다 — adapt 가 두 번 읽지 않는다', (() => {
  const a = stageInputArgs('adapt', { collect: [NEW_82], cafeThin: [NEW_82], preexisting: [NEW_82] })
  return (a[0].match(/\.thin-detail\.jsonl/g) ?? []).length === 1
})())
check('🟢 [A] 미리 있던 것이 없으면 종전대로다', (() => {
  const a = stageInputArgs('adapt', { collect: [NEW_82] })
  return a.length === 1 && a[0] === `--input=${NEW_82}`
})())
check('🔴 [A] 82cook 이 하나도 없어도 네이버만으로 adapt 가 돈다', (() => {
  const a = stageInputArgs('adapt', { preexisting: [PRE_R, PRE_W] })
  return a.length === 1 && a[0].includes('remonterrace') && a[0].includes('wgang')
})())

// D. 같은 runId 의 두 카페가 서로를 막지 않는다
// 🔴 키 로직을 fixture 가 복제하지 않는다 — 실제 함수를 부른다.
//    복제하면 한쪽만 고쳐졌을 때 fixture 가 통과해 버린다
check('🔴 [D] 같은 runId 를 가진 remonterrace 와 wgang 이 서로 다른 키다', (() => {
  const r = adaptKeyOf('.microseed-data/navercafe-thin-remonterrace-R9.thin-detail.jsonl')
  const w = adaptKeyOf('.microseed-data/navercafe-thin-wgang-R9.thin-detail.jsonl')
  return r !== w && r.includes('remonterrace') && w.includes('wgang')
})())
check('🔴 [D] 82cook 키는 종전 그대로다 — 기존 산출물과 어긋나지 않는다',
  adaptKeyOf('.microseed-data/82cook-thin-20260907-113234.thin-detail.jsonl') === '20260907-113234')
check('🔴 [D] 두 카페가 adapt 입력에 나란히 들어간다', (() => {
  const a = stageInputArgs('adapt', {
    preexisting: [
      '.microseed-data/navercafe-thin-remonterrace-R9.thin-detail.jsonl',
      '.microseed-data/navercafe-thin-wgang-R9.thin-detail.jsonl',
    ],
  })
  return (a[0].match(/\.thin-detail\.jsonl/g) ?? []).length === 2
})())

// E. adapt 실패 후 재개는 **같은 입력 파일**로
check('🔴 [E] 재개해도 checkpoint 에 박힌 preexisting 을 그대로 쓴다', (() => {
  const cp = A({
    stages: failedAt('adapt', ['collect', 'cafeThin']),
    artifacts: { collect: [NEW_82], preexisting: [PRE_R, PRE_W] },
  })
  const r = resumeDecision({ checkpoint: cp, plan })
  if (r.kind !== 'resume' || r.from !== 'adapt') return false
  const a = stageInputArgs('adapt', cp.artifacts)
  return (a[0].match(/\.thin-detail\.jsonl/g) ?? []).length === 3
})())
check('🔴 [E] adapt 재개에 새 수집이 끼지 않는다', (() => {
  const cp = A({
    stages: failedAt('adapt', ['collect', 'cafeThin']),
    artifacts: { collect: [NEW_82], preexisting: [PRE_R] },
  })
  const r = resumeDecision({ checkpoint: cp, plan })
  if (r.kind !== 'resume') return false
  const rest = plan.slice(plan.findIndex((x) => x.stage === r.from))
  return !rest.some((x) => x.stage === 'collect' || x.network)
})())

// ── ⑦ 정합 ──
const base = {
  postBefore: 38, postAfter: 38,
  stockBefore: stock(5, 5, 0), stockAfter: stock(14, 5, 9),
  queuedMachine: 9, queuedNonMachine: 0,
}
check('🟢 5 → 14 · Post 불변 · 기계 9건이면 통과', verifyRun(base).ok)
check('🔴 Post 가 늘면 그것만으로 사고다', (() => {
  const v = verifyRun({ ...base, postAfter: 39 })
  return !v.ok && v.problems.some((p) => p.includes('Post'))
})())
check('🔴 Post 가 줄어도 사고다', !verifyRun({ ...base, postAfter: 37 }).ok)
check('🔴 목표를 넘겨 적재하면 잡는다', (() => {
  const v = verifyRun({ ...base, stockAfter: stock(15, 5, 10), queuedMachine: 10 })
  return !v.ok && v.problems.some((p) => p.includes('목표'))
})())
check('🔴 기계가 아닌 행이 섞이면 잡는다', (() => {
  const v = verifyRun({ ...base, stockAfter: stock(14, 6, 8), queuedMachine: 8, queuedNonMachine: 1 })
  return !v.ok
})())
check('🔴 적재했다는 수와 늘어난 재고가 다르면 잡는다', (() => {
  const v = verifyRun({ ...base, queuedMachine: 5 })
  return !v.ok && v.problems.some((p) => p.includes('다르다'))
})())
check('🔴 재고가 줄면 잡는다', !verifyRun({ ...base, stockAfter: stock(4, 4, 0), queuedMachine: 0 }).ok)
check('🟢 아무것도 안 늘어도(0건 보충) 정합은 통과한다 — no-op 은 사고가 아니다',
  verifyRun({ postBefore: 38, postAfter: 38, stockBefore: stock(5, 5, 0),
    stockAfter: stock(5, 5, 0), queuedMachine: 0, queuedNonMachine: 0 }).ok)

// ── ⑧ 화면 ──
check('🟢 못 센 값은 0 이 아니라 —', fmtCount(null) === '—' && fmtCount(0) === '0')

// ── ⑨ 러너가 스스로 발행·판정을 만들지 않는다 ──
const code = ((): string => {
  const raw = readFileSync('scripts/supply-autopilot.mts', 'utf-8')
  // 🔴 주석을 지우고 본다 — 설명 문구가 자기 자신을 잡는 일이 반복됐다
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
})()
// 🔴 화면 문구에 'persona 배정 0' 이 있으므로 낱말이 아니라 **호출**을 본다
check('🔴 러너가 Post 를 만들지 않는다',
  !/\bpost\.(create|createMany|update)\b|publishOne|assignPersona/i.test(code))
check('🔴 러너가 큐에 직접 쓰지 않는다 — 적재는 supply-autofill 의 일이다',
  !/originalPostApprovalQueue\.(create|update|delete)/.test(code))
check('🔴 러너가 자체 판정을 만들지 않는다', !/safetyFilter|judgeOne|checkDraft|expandSeed/.test(code))
check('🔴 러너가 pacing 상수를 건드리지 않는다',
  !/DAILY_PUBLISH_CAP|POST_CAP_PER_WEEK|MIN_DAYS_BETWEEN_POSTS/.test(code))
// 🔴 러너는 네이버 **수집물**을 얇게 바꾸는 스크립트를 부를 뿐, 네이버에 접속하지 않는다.
//    접속은 launchd 가 부르는 수집기의 일이고 그쪽은 세션을 쓴다.
check('🔴 러너가 네이버에 직접 접속하지 않는다',
  !/cafe\.naver\.com|playwright|chromium|storage-state|SESSION/i.test(code))
check('🔴 러너가 Raw SQL 을 쓰지 않는다', !/\$queryRaw|\$executeRaw/.test(code))
check('🔴 러너가 부르는 스크립트는 기존 6개뿐이다', (() => {
  const hits = [...code.matchAll(/scripts\/[a-z0-9-]+\.mts/g)].map((m) => m[0])
  const want = new Set([
    'scripts/micro-seed-82cook-thin-detail.mts', 'scripts/micro-seed-navercafe-thin.mts',
    'scripts/micro-seed-82cook-thin-adapt.mts',
    'scripts/micro-seed-auto-judge.mts', 'scripts/micro-seed-auto-draft.mts',
    'scripts/micro-seed-supply-autofill.mts',
  ])
  return hits.length > 0 && hits.every((h) => want.has(h))
})())
// 🔴 재고가 차 있어도 수집물이 방치되지 않는다
check('🔴 no-op 이어도 미처리 수집물·얇은 파일을 밀어두지 않는다',
  /pendingRawCafeFiles\(\)/.test(code) && /pendingThinFiles\(\)/.test(code)
  && /STAGE_SCRIPT\.cafeThin/.test(code))
check('🔴 checkpoint 는 임시 파일 후 rename 이다', /renameSync/.test(code))

// ── ⑧ spawn 실패가 러너를 매달지 않는다 ──
check("🔴 ⑧ spawn 의 error 를 받는다 — 안 받으면 Promise 가 안 끝나고 lock 을 쥔 채 매달린다",
  /\.on\('error'/.test(code))
check('🔴 ⑧ 같은 실행이 두 번 resolve 되지 않는다', /settled/.test(code))
check('🔴 ⑧ spawn 이 던져도 잡는다', /catch \(e\)/.test(code) && /spawn 이 던졌다/.test(code))
check('🔴 ⑧ 시작 실패는 exit 0 이 아니다 — 그 단계 failed 로 기록한다',
  /r\.code === 0 && r\.spawnError === ''/.test(code))
check('🔴 ⑧ 루프 판정을 러너가 따로 만들지 않는다 — runStages 하나뿐이다',
  /runStages\(/.test(code) && !/for \(;;\)/.test(code))
check('🔴 ⑧ 러너가 과거 실패로 이번 실행을 중단시키지 않는다 — cp.stages 전체를 중단 조건으로 쓰지 않는다',
  !/shouldStopRun\(cp\.stages\)/.test(code))
check('🔴 ⑧ 최종 exit 은 이번 실행 결과다', /loop\.exitCode === 0/.test(code))
check('🔴 ⑧ 끝나면 lock 을 놓는다 — 다음 회차를 영구 차단하지 않는다', /rmSync\(lockPath/.test(code))

// ── ⑨-b 재개 계약이 러너에 실제로 있다 ──
check('🔴 미완료 회차를 찾는다', /findUnfinished/.test(code))
check('🔴 재개 판정을 쓴다', /resumeDecision/.test(code))
check('🔴 앞 단계 산출물을 exact input 으로 넘긴다', /stageInputArgs/.test(code))
check('🔴 산출물이 없으면 fail closed — 새 수집으로 넘어가지 않는다',
  /missingArtifacts/.test(code) && /process\.exit\(1\)/.test(code))
check('🔴 terminal 상태를 기록한다', /cp\.status = /.test(code) && /'done'/.test(code))
check('🔴 죽은 lock 을 걷어낼 때 checkpoint 를 지우지 않는다', (() => {
  // rmSync 대상이 lockPath 뿐이어야 한다
  const targets = [...code.matchAll(/rmSync\(([^,)]+)/g)].map((m) => m[1].trim())
  return targets.length > 0 && targets.every((t) => t === 'lockPath')
})())
check('🔴 재개할 때 계획을 다시 세우지 않는다 — 앞 회차의 shortfall 을 쓴다',
  /unfinished\.cp\.collectCap/.test(code) && /unfinished\.cp\.shortfall/.test(code))
check('🔴 lock 은 끝나면 지운다', /rmSync\(lockPath/.test(code))

// B·C. 러너 코드가 dry-run 에서 쓰지 않는지 / live 에서만 처리하는지
// ══════════════════════════════════════════════════════════════════
// 🔴 실행 게이트 — judgeRun 은 재고가 차 있으면 **스위치를 보기 전에** NOOP 을 돌려준다.
//    그 뒤 유지보수 경로가 --live 만 보면 kill switch 를 내렸는데도 파일을 쓴다.
// ══════════════════════════════════════════════════════════════════
const GATE = { live: true, killOpen: true, childKillOpen: true }

// B. 두 환경 스위치 조합 전수 — 둘 다 true 인 한 경우에만 열린다
for (const killOpen of [true, false]) {
  for (const childKillOpen of [true, false]) {
    const want = killOpen && childKillOpen
    check(`🔴 [B] live=true · kill=${killOpen} · child=${childKillOpen} → ${want ? '쓸 수 있다' : '쓸 수 없다'}`,
      mayWriteRunState({ live: true, killOpen, childKillOpen }) === want)
  }
}
// A. live 인데 스위치가 닫혀 있으면 쓰지 않는다
check('🔴 [A] live=true · 두 스위치 모두 닫힘 → 쓸 수 없다',
  !mayWriteRunState({ live: true, killOpen: false, childKillOpen: false }))
check('🔴 [A] 하위 스위치만 닫혀도 쓸 수 없다',
  !mayWriteRunState({ live: true, killOpen: true, childKillOpen: false }))
// C. dry-run 은 스위치가 다 열려 있어도 쓰지 않는다
check('🔴 [C] --live 가 없으면 스위치가 다 열려도 쓸 수 없다',
  !mayWriteRunState({ live: false, killOpen: true, childKillOpen: true }))
check('🟢 세 게이트가 다 열릴 때만 쓴다', mayWriteRunState(GATE))

check('🔴 [B] no-op 유지보수가 --live 가 아니라 canWriteState 정본을 본다', (() => {
  const seg = /if \(pendingRaw > 0 \|\| pendingThin\.length > 0\) \{([\s\S]*?)\n        \}/.exec(code)
  if (seg === null) return false
  const body = seg[1]
  const gate = body.indexOf('if (!canWriteState)')
  const firstApply = body.indexOf("'--apply'")
  // 🔴 게이트가 --apply 보다 앞에 있어야 한다
  return gate !== -1 && firstApply !== -1 && gate < firstApply
})())
check('🔴 [B] no-op 유지보수가 --live 단독 분기를 쓰지 않는다', (() => {
  const seg = /if \(pendingRaw > 0 \|\| pendingThin\.length > 0\) \{([\s\S]*?)\n        \}/.exec(code)
  return seg !== null && !/if \(!LIVE\) \{/.test(seg[1])
})())
check('🔴 [E] 유지보수 실패를 기록한다 — 로그만 남기고 넘어가지 않는다',
  /maintenanceFailed = true/.test(code))
check('🔴 [E] 유지보수가 실패하면 exit 1 이다', (() => (
  /if \(maintenanceFailed\) \{[\s\S]{0,120}process\.exit\(1\)/.test(code)
))())
check('🔴 [E] cafeThin 실패와 adapt 실패를 **둘 다** 잡는다',
  (code.match(/maintenanceFailed = true/g) ?? []).length === 2)
check('🔴 [D] 유지보수는 cafeThin · adapt 만 부른다 — judge · draft · fill 은 부르지 않는다', (() => {
  const seg = /if \(pendingRaw > 0 \|\| pendingThin\.length > 0\) \{([\s\S]*?)\n        \}/.exec(code)
  if (seg === null) return false
  const body = seg[1]
  return /STAGE_SCRIPT\.cafeThin/.test(body) && /STAGE_SCRIPT\.adapt/.test(body)
    && !/STAGE_SCRIPT\.judge|STAGE_SCRIPT\.draft|STAGE_SCRIPT\.fill/.test(body)
})())
check('🔴 [F] 재실행 시 이미 사본이 있는 것은 다시 넘기지 않는다 — 키로 거른다', (() => {
  // pendingThinFiles 가 82cook-adapt-<key> 를 보고 거른다
  const fn = /function pendingThinFiles\(\)[\s\S]*?\n\}/.exec(code)
  return fn !== null && /82cook-adapt-/.test(fn[0]) && /adaptKeyOf/.test(fn[0])
})())
// 🔴 옛 검사는 "파일 어딘가에 canWriteState 조건문 하나만 있어도" 통과했다.
//    조건이 **어느 write 앞에** 있는지를 못 보므로 stale lock 삭제가 게이트 밖에 있는 것을 놓쳤다.
//    아래는 **호출 하나하나가 게이트 안에 있는지**를 본다.
//    (실제 파일로 확인하는 행동 테스트는 supply-autopilot-lock-check — DB 접속이 필요해 로컬 전용)
check('🔴 "돌지 않는다" 경로의 디스크 변경이 전부 게이트 안에 있다', (() => {
  // 🔴 위험한 곳은 **돌지 않기로 한 뒤**다. judgeRun 이 통과시킨 실행 경로는
  //    이미 세 스위치를 다 본 뒤이므로 별도 게이트가 필요 없다.
  const head = code.indexOf('if (!verdict.ok) {')
  if (head === -1) return false
  let depth = 0
  let end = head
  for (let i = code.indexOf('{', head); i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  const seg = code.slice(head, end)
  // 이 구간 안의 canWriteState 블록 범위
  const blocks: [number, number][] = []
  const re = /if \(canWriteState[^)]*\) \{/g
  for (let m = re.exec(seg); m !== null; m = re.exec(seg)) {
    let d = 0
    let i = m.index + m[0].length - 1
    for (; i < seg.length; i += 1) {
      if (seg[i] === '{') d += 1
      else if (seg[i] === '}') { d -= 1; if (d === 0) break }
    }
    blocks.push([m.index, i])
  }
  const inside = (pos: number): boolean => blocks.some(([a, b]) => pos > a && pos < b)
  const writes = [...seg.matchAll(/\b(rmSync|writeAtomic|writeFileSync|mkdirSync)\s*\(/g)]
  return writes.every((w) => inside(w.index))
})())
// 🔴 운영 러너가 추출된 함수를 **실제로 쓴다.** 판단이 두 곳에 있으면
//    테스트가 통과해도 러너는 다른 길로 갈 수 있다
check('🔴 러너가 planStaleLock 을 쓴다', /planStaleLock\(\{/.test(code))
check('🔴 러너가 applyStaleLockPlan 으로 집행한다', /applyStaleLockPlan\(lockPlan/.test(code))
check('🔴 러너가 lock 삭제를 직접 판단하지 않는다 — canWriteState 분기를 lock 자리에 두지 않는다', (() => {
  const stale = code.indexOf("decision === 'stale' && existing !== null")
  if (stale === -1) return false
  const seg = code.slice(stale, stale + 700)
  // rmSync 는 applyStaleLockPlan 에 넘기는 콜백 안에만 있어야 한다
  return /applyStaleLockPlan\(lockPlan, \(\) => \{ rmSync\(lockPath/.test(seg)
})())
// 🔴 lock 테스트가 운영을 발동할 수 없다는 것도 여기서 고정한다
check('🔴 lock 테스트가 실제 러너를 돌리지 않는다', (() => {
  const t = readFileSync('scripts/supply-autopilot-lock-check.mts', 'utf-8')
  const upto = t.slice(0, t.lastIndexOf('SELF_CHECK_BEGIN'))
  return !/child_process|execFileSync|spawnSync/.test(upto)
})())

// 🔴 판단은 lib 에 있다 — 러너는 canWrite 를 넘길 뿐이다
check('🔴 러너가 게이트 상태를 그대로 넘긴다', /canWrite: canWriteState/.test(code))
check('🔴 게이트가 닫히면 지우지 않는다고 말한다 (lib 문구)', (() => {
  const lib = readFileSync('src/lib/supply-autopilot.ts', 'utf-8')
  return /지우지 않는다 — 게이트가 닫혀 있다/.test(lib)
})())
check('🔴 lib 이 preserve 를 실제로 돌려준다',
  planStaleLock({ stale: true, canWrite: false, runId: 'r', pid: 1 }).action === 'preserve')
check('🔴 [B·C] 게이트가 닫히면 예정 파일만 보여준다',
  /쓰지 않는다 — 예정 파일만 보여준다/.test(code))
check('🔴 [B·C] 왜 막혔는지 화면에 남긴다 — 조용히 건너뛰지 않는다',
  /막힌 이유/.test(code))
check('🔴 [C] live no-op 에서 하는 일은 파일 변환뿐이다 — judge · draft · fill 을 부르지 않는다', (() => {
  const seg = /if \(pendingRaw > 0 \|\| pendingThin\.length > 0\) \{([\s\S]*?)\n        \}/.exec(code)
  if (seg === null) return false
  const body = seg[1]
  return /STAGE_SCRIPT\.cafeThin/.test(body) && /STAGE_SCRIPT\.adapt/.test(body)
    && !/STAGE_SCRIPT\.judge|STAGE_SCRIPT\.draft|STAGE_SCRIPT\.fill/.test(body)
})())
check('🔴 [C] 같은 회차를 다시 돌려도 이미 사본이 있는 것은 다시 넘기지 않는다 — 키로 거른다',
  /pendingThinFiles\(\)/.test(code) && /82cook-adapt-/.test(code))
check('🔴 회차 시작 시 preexisting 을 checkpoint 에 박는다',
  /artifacts: preexisting\.length > 0 \? \{ preexisting \} : \{\}/.test(code))
check('🔴 처리 여부를 runId 단독으로 보지 않는다', /adaptKeyOf/.test(code))


// ─────────────────────────────────────────────────────────
// 🔴 한 source 의 네트워크 장애가 **다른 source 의 공급을 세우지 않는다** (2026-09-09 Wave B)
//
//    실측: 82cook 이 이 망에서 ECONNREFUSED 였는데, `collect` 가 첫 단계라
//    뒤 단계를 전부 돌리지 않았다 — 받아 둔 네이버 thin 이 그대로 묵었다.
// ─────────────────────────────────────────────────────────
{
  const blocked = judgeStageFailure({ stage: 'collect', sourceBlocked: true })
  const bug = judgeStageFailure({ stage: 'collect', sourceBlocked: false })
  const local = judgeStageFailure({ stage: 'judge', sourceBlocked: true })
  check('🔴 네트워크 단계가 source 차단으로 실패하면 **건너뛴다**', blocked.action === 'skip')
  check('🔴 그 이유를 화면 문구로 남긴다 — 조용히 넘어가지 않는다',
    /건너뜀/.test(blocked.note) && /다음 회차에 다시 시도/.test(blocked.note))
  check('🔴 source 차단이 아니면(스크립트 버그 등) 예전처럼 **멈춘다**', bug.action === 'stop')
  check('🔴 로컬 단계는 건너뛰지 않는다 — 차단 판정이 있어도 멈춘다', local.action === 'stop')
  check('🔴 어느 source 를 볼지 코드가 정해 둔다 — 러너가 즉흥으로 고르지 않는다',
    STAGE_SOURCE.collect === '82cook' && STAGE_SOURCE.judge === undefined)

  // 🔴 **행동으로 본다** — 건너뛴 뒤 로컬 단계가 실제로 돌았는가
  const plan = planStages({ collectCap: 10, shortfall: 5 })
  const cp: Checkpoint = {
    runId: 'r1', startedAt: 't0', status: 'running', completedAt: null,
    stages: [], artifacts: {}, stock: { before: 0, after: null }, plan: { shortfall: 5, collectCap: 10 },
  } as unknown as Checkpoint
  const called: Stage[] = []
  const loop = await runStages({
    plan, checkpoint: cp, now: () => 't',
    exec: async (stage) => {
      called.push(stage)
      // 🔴 82cook 만 막힌 상황을 그대로 재현한다
      return stage === 'collect'
        ? { ok: false, exitCode: 1, spawnError: '', made: [], sourceBlocked: true }
        : { ok: true, exitCode: 0, spawnError: '', made: [] }
    },
  })
  check('🔴 [행동] collect 가 막혀도 뒤 단계가 전부 돈다',
    called.join(',') === 'collect,cafeThin,adapt,judge,draft,fill')
  check('🔴 [행동] 그 회차는 failed 가 아니다', loop.exitCode === 0 || cp.status !== 'failed')
  check('🔴 [행동] collect 는 ok 가 아니라 skipped 로 남는다',
    cp.stages.find((x) => x.stage === 'collect')?.status === 'skipped')
  check('🔴 [행동] 건너뛴 단계는 무한히 다시 불리지 않는다', called.filter((c) => c === 'collect').length === 1)
  check('🔴 [행동] 이 회차는 done 으로 닫힌다 — 다음 회차가 새로 시작한다', cp.status === 'done')
  check('🔴 [행동] 건너뜀은 전체 이력에서 성공이 아니다 — 다음 회차가 collect 부터 다시 본다',
    nextStage(plan, cp.stages)?.stage === 'collect')

  // 🔴 대조군 — sourceBlocked 가 아니면 옛 동작 그대로 멈춰야 한다
  const cp2 = { ...cp, stages: [], artifacts: {}, status: 'running' } as unknown as Checkpoint
  const called2: Stage[] = []
  await runStages({
    plan, checkpoint: cp2, now: () => 't',
    exec: async (stage) => {
      called2.push(stage)
      return stage === 'collect'
        ? { ok: false, exitCode: 1, spawnError: '', made: [], sourceBlocked: false }
        : { ok: true, exitCode: 0, spawnError: '', made: [] }
    },
  })
  check('🔴 [대조군] source 차단이 아니면 collect 에서 멈춘다 — 뒤 단계 0',
    called2.join(',') === 'collect')
  check('🔴 [대조군] 그때는 failed 로 남는다',
    cp2.stages.find((x) => x.stage === 'collect')?.status === 'failed')
}

  /**
   * 🔴 **판정을 소스 정규식으로 보지 않는다** (2026-09-09 Codex 지적).
   *    앞선 fixture 는 "그 조건식이 코드에 있는가" 를 봤다 — 조건식 **자체가 틀렸으므로**
   *    그 검사는 틀린 것을 지키고 있었다. 그래서 행동으로 본다.
   */
  const mark = (o: Partial<BreakerMark>): BreakerMark => {
    return { status: 'closed', consecutive: 0, openedAt: null, ...o }
  }
  const probe = (o: Partial<GuardProbe>): GuardProbe => {
    // 🔴 기본값은 "도서관에서 남은 과거 기록" 이다 — 과거만으로는 차단이 아니어야 한다
    return {
      readable: true, preblocked: false, halfOpen: false, blockedReason: '',
      breakers: { NETWORK: mark({ consecutive: 3 }) },
      ...o,
    }
  }
  const judge = (o: {
    spawnError?: string; before?: GuardProbe | null; after?: GuardProbe | null
  }): { blocked: boolean; reason: string } => judgeSourceBlocked({
    spawnError: o.spawnError ?? '',
    before: o.before === undefined ? probe({}) : o.before,
    after: o.after === undefined ? probe({}) : o.after,
  })

  // A. 🔴 NETWORK 3→0 (수집 성공) + exit 1 → STOP
  {
    const v = judge({
      before: probe({ breakers: { NETWORK: mark({ consecutive: 3 }) } }),
      after: probe({ breakers: { NETWORK: mark({ consecutive: 0 }) } }),
    })
    check('🔴 [A] 연속 실패가 **줄어든 것**(성공)을 새 실패로 읽지 않는다 → STOP',
      !v.blocked && v.reason.includes('복구 방향'))
  }
  // B. NETWORK 3→4 → SKIP
  {
    const v = judge({
      before: probe({ breakers: { NETWORK: mark({ consecutive: 3 }) } }),
      after: probe({ breakers: { NETWORK: mark({ consecutive: 4 }) } }),
    })
    check('🔴 [B] 연속 실패가 **늘어나면** 이번 회차의 source 실패로 본다 → SKIP',
      v.blocked && v.reason.includes('NETWORK'))
  }
  // C. half-open + guard 불변 → STOP
  {
    const ho = probe({ halfOpen: true, breakers: { NETWORK: mark({ status: 'half-open', consecutive: 3, openedAt: 100 }) } })
    const v = judge({ before: ho, after: ho })
    check('🔴 [C] half-open 이어도 전후가 같으면 멈춘다', !v.blocked && v.reason.includes('똑같다'))
    check('🔴 [C] half-open 은 사전 차단이 아니다 — 두드려 봐야 한다', !ho.preblocked && ho.halfOpen)
  }
  // D. half-open probe 실패로 openedAt 갱신 → SKIP
  {
    const v = judge({
      before: probe({ halfOpen: true, breakers: { NETWORK: mark({ status: 'half-open', consecutive: 3, openedAt: 100 }) } }),
      after: probe({ breakers: { NETWORK: mark({ status: 'open', consecutive: 4, openedAt: 200 }) } }),
    })
    check('🔴 [D] half-open 시험이 실패해 openedAt 이 앞으로 가면 SKIP', v.blocked)
  }
  // E. breaker open · 예산 소진 → 사전 차단
  {
    const openV = judge({ before: probe({ preblocked: true, blockedReason: 'NETWORK open' }) })
    const budgetV = judge({ before: probe({ preblocked: true, blockedReason: '예산 소진 400/400' }) })
    check('🔴 [E] 실행 전 open 이면 사전 차단으로 건너뛴다',
      openV.blocked && openV.reason.includes('실행 전부터'))
    check('🔴 [E] 예산 소진도 사전 차단이다', budgetV.blocked)
  }
  // F. spawnError → STOP
  {
    const v = judge({ spawnError: 'ENOENT npx', before: probe({ preblocked: true, blockedReason: 'NETWORK open' }) })
    check('🔴 [F] spawnError 는 guard 상태와 무관하게 멈춘다',
      !v.blocked && v.reason.includes('spawn 실패'))
  }
  // G. guard missing / malformed → STOP
  {
    const miss = judge({ before: null, after: null })
    const bad = judge({ before: probe({ readable: false }) })
    check('🔴 [G] guard 를 못 읽으면 멈춘다 (fail-closed)',
      !miss.blocked && !bad.blocked && miss.reason.includes('판단 근거가 없으므로'))
  }
  // 🔴 **openedAt 도 방향을 본다** — 사라지거나 뒤로 가는 것은 복구다
  {
    const cleared = judge({
      before: probe({ breakers: { NETWORK: mark({ status: 'open', consecutive: 5, openedAt: 500 }) } }),
      after: probe({ breakers: { NETWORK: mark({ status: 'closed', consecutive: 0, openedAt: null }) } }),
    })
    check('🔴 openedAt 이 사라지고 닫히면 복구다 — 실패로 읽지 않는다', !cleared.blocked)
    const backwards = judge({
      before: probe({ breakers: { NETWORK: mark({ status: 'open', consecutive: 5, openedAt: 500 }) } }),
      after: probe({ breakers: { NETWORK: mark({ status: 'open', consecutive: 5, openedAt: 200 }) } }),
    })
    check('🔴 openedAt 이 **뒤로** 가면 이번 회차의 새 실패가 아니다', !backwards.blocked)
    const forward = judge({
      before: probe({ breakers: { NETWORK: mark({ status: 'open', consecutive: 5, openedAt: 500 }) } }),
      after: probe({ breakers: { NETWORK: mark({ status: 'open', consecutive: 5, openedAt: 900 }) } }),
    })
    check('🔴 openedAt 이 **앞으로** 가면 이번 회차가 다시 실패한 것이다', forward.blocked)
    const born = judge({
      before: probe({ breakers: { NETWORK: mark({ consecutive: 0, openedAt: null }) } }),
      after: probe({ breakers: { NETWORK: mark({ status: 'open', consecutive: 1, openedAt: 900 }) } }),
    })
    check('🔴 openedAt 이 새로 생기면 이번 회차의 실패다', born.blocked)
  }

  // 🔴 원인이 특정되지 않는 분류(OTHER)는 증거가 아니다
  {
    const v = judge({
      before: probe({ breakers: { OTHER: mark({ consecutive: 0 }) } }),
      after: probe({ breakers: { OTHER: mark({ consecutive: 1 }) } }),
    })
    check('🔴 OTHER 증가만으로는 source 탓으로 돌리지 않는다', !v.blocked)
    check('🔴 remote 분류 목록이 OTHER 를 빼고 정의돼 있다',
      REMOTE_FAILURE_CLASSES.includes('NETWORK') && !REMOTE_FAILURE_CLASSES.includes('OTHER'))
  }

  // 🔴 **러너가 실제로 그렇게 동작한다** — 판정부만 옳고 러너가 안 부르면 무력하다
  check('🔴 러너가 실행 **전** 지문을 뜬다', /const probeBefore = NETWORK_STAGES\.includes\(stage\)/.test(code))
  check('🔴 러너가 judgeSourceBlocked 에 spawnError·before·after 를 넘긴다',
    /judgeSourceBlocked\(\{ spawnError: r\.spawnError, before: probeBefore, after \}\)/.test(code))
  check('🔴 [E·러너] 사전 차단이면 자식을 띄우지 않고 돌아온다', (() => {
    const seg = /if \(probeBefore !== null && probeBefore\.readable && probeBefore\.preblocked\)([\s\S]*?)\n      \}/.exec(code)
    if (seg === null) return false
    // 🔴 그 분기 안에서 run(...) 을 부르지 않고 sourceBlocked 로 돌아와야 한다
    return !/await run\(/.test(seg[1]) && /sourceBlocked: true/.test(seg[1])
  })())
  check('🔴 러너가 옛 문자열 지문(marks) 비교를 더는 쓰지 않는다',
    !/marks\[b\.cls\] = /.test(code) && /breakers\[b\.cls\] = \{ status: b\.status/.test(code))
  check('🔴 half-open 은 사전 차단에 넣지 않는다',
    /const open = snap\.breakers\.filter\(\(b\) => b\.status === 'open'\)/.test(code))
  check('🔴 지문을 못 읽으면 readable:false 로 남긴다 — 예외를 삼켜 정상으로 만들지 않는다',
    /readable: false, preblocked: false/.test(code))

  // 🔴 **루프 전체 행동** — 판정이 실제로 뒤 단계 실행 여부를 가르는가
  {
    const mkCp = (): Checkpoint => ({
      runId: 'r', startedAt: 't0', status: 'running', completedAt: null,
      stages: [], artifacts: {}, stock: { before: 0, after: null }, plan: { shortfall: 5, collectCap: 10 },
    } as unknown as Checkpoint)
    const plan2 = planStages({ collectCap: 10, shortfall: 5 })
    const runWith = async (collect: () => ExecResult): Promise<{ cp: Checkpoint; called: Stage[] }> => {
      const cp = mkCp()
      const called: Stage[] = []
      await runStages({
        plan: plan2, checkpoint: cp, now: () => 't',
        exec: async (stage) => {
          called.push(stage)
          return stage === 'collect' ? collect() : { ok: true, exitCode: 0, spawnError: '', made: [] }
        },
      })
      return { cp, called }
    }
    const failWith = (blocked: boolean, spawnError = ''): ExecResult =>
      ({ ok: false, exitCode: spawnError === '' ? 1 : null, spawnError, made: [], sourceBlocked: blocked })

    // A-행동: 3→0 (수집 성공 뒤 로컬 오류) → 뒤 단계 0
    const A = await runWith(() => failWith(judge({
      before: probe({ breakers: { NETWORK: mark({ consecutive: 3 }) } }),
      after: probe({ breakers: { NETWORK: mark({ consecutive: 0 }) } }),
    }).blocked))
    check('🔴 [A·행동] 3→0 이면 뒤 단계 호출 0', A.called.join(',') === 'collect')
    check('🔴 [A·행동] collect 는 failed 로 남는다',
      A.cp.stages.find((x) => x.stage === 'collect')?.status === 'failed')

    // B-행동: 3→4 → 뒤 단계 전부 실행
    const B = await runWith(() => failWith(judge({
      before: probe({ breakers: { NETWORK: mark({ consecutive: 3 }) } }),
      after: probe({ breakers: { NETWORK: mark({ consecutive: 4 }) } }),
    }).blocked))
    check('🔴 [B·행동] 이번 NETWORK 실패면 collect 만 건너뛰고 뒤 단계가 전부 돈다',
      B.called.join(',') === 'collect,cafeThin,adapt,judge,draft,fill')
    check('🔴 [B·행동] collect 는 skipped 다',
      B.cp.stages.find((x) => x.stage === 'collect')?.status === 'skipped')
    check('🔴 [H] 건너뛴 collect 는 다음 회차가 다시 시도한다',
      nextStage(plan2, B.cp.stages)?.stage === 'collect')

    // F-행동: spawnError → 뒤 단계 0
    const F = await runWith(() => failWith(judge({
      spawnError: 'ENOENT npx',
      before: probe({ preblocked: true, blockedReason: 'NETWORK open' }),
    }).blocked, 'ENOENT npx'))
    check('🔴 [F·행동] spawnError 면 과거 기록이 있어도 뒤 단계 0', F.called.join(',') === 'collect')

    // E-행동: 사전 차단 → collect 만 건너뛰고 뒤 단계는 계속
    const E = await runWith(() => failWith(
      judge({ before: probe({ preblocked: true, blockedReason: 'NETWORK open' }) }).blocked))
    check('🔴 [E·행동] 사전 차단이면 collect 만 건너뛰고 뒤 단계가 돈다',
      E.called.join(',') === 'collect,cafeThin,adapt,judge,draft,fill')

    // C-행동: half-open + 전후 불변 → 뒤 단계 0
    const ho = probe({
      halfOpen: true,
      breakers: { NETWORK: mark({ status: 'half-open', consecutive: 3, openedAt: 100 }) },
    })
    const C = await runWith(() => failWith(judge({ before: ho, after: ho }).blocked))
    check('🔴 [C·행동] half-open 이어도 전후가 같으면 뒤 단계 0', C.called.join(',') === 'collect')

    // I. 기존 Wave B 계약 회귀
    check('🔴 [I] --up-to 계약 회귀 0',
      (plan2.find((x) => x.stage === 'fill')?.args.join(' ') ?? '') === '--apply --up-to=5')
    const okRun = await runWith(() => ({ ok: true, exitCode: 0, spawnError: '', made: [] }))
    check('🔴 [I] 정상 실행은 6단계 전부 돌고 done 이다',
      okRun.called.join(',') === 'collect,cafeThin,adapt,judge,draft,fill' && okRun.cp.status === 'done')
  }

  check('🔴 러너가 verifyRun 에 **capacity 목표**를 넘긴다 — 기본값 14 로 판정하지 않는다',
    /target: CAPACITY_LIMITS\.target,/.test(code))
  check('🔴 [판정부] 목표를 넘기면 그 목표로 본다', (() => {
    const base = {
      postBefore: 1, postAfter: 1,
      stockBefore: { usable: 13, human: 3, machine: 10 },
      stockAfter: { usable: 25, human: 3, machine: 22 },
      queuedMachine: 12, queuedNonMachine: 0,
    } as unknown as Parameters<typeof verifyRun>[0]
    const d3 = verifyRun({ ...base, target: 42 })
    const dflt = verifyRun(base)
    // 🔴 목표 42 면 정상, 목표를 안 주면 기본값(14)이라 "넘겼다" 고 잡힌다
    return d3.ok && !dflt.ok && dflt.problems.some((p) => p.includes('넘겨 적재했다'))
  })())

console.log(`\n─────────────────────────────────────────────────────────`)
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
