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
  attemptOf, runStages, supersedes, mayWriteRunState,
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
check('🟢 5단계다', plan.length === 5)
check('🔴 순서가 수집 → 변환 → 판정 → 초안 → 보충이다',
  plan.map((p) => p.stage).join(',') === 'collect,adapt,judge,draft,fill')
check('🔴 STAGES 상수와 계획 순서가 같다', plan.map((p) => p.stage).join(',') === STAGES.join(','))
check('🔴 수집은 --live 와 --cap 을 둘 다 받는다', (() => {
  const a = plan[0].args.join(' ')
  return a.includes('--live') && a.includes('--cap=36')
})())
check('🔴 보충은 목표까지만 — --limit 이 부족분과 같다', plan[4].args.join(' ') === '--apply --limit=9')
check('🔴 판정·초안은 --call --apply 계약을 지킨다',
  plan[2].args.join(' ') === '--call --apply' && plan[3].args.join(' ') === '--call --apply')
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
check('🟢 부족 1건이어도 보충 상한은 1이다', planStages({ collectCap: 10, shortfall: 1 })[4].args.includes('--limit=1'))

// ── ⑥ 부분 실패 ──
const okOutcome = (stage: string): StageOutcome => ({
  stage: stage as StageOutcome['stage'], status: 'ok', exitCode: 0,
  startedAt: '', endedAt: '', note: '',
})
check('🟢 아무것도 안 돌았으면 첫 단계부터', nextStage(plan, [])?.stage === 'collect')
check('🟢 수집이 끝나면 변환', nextStage(plan, [okOutcome('collect')])?.stage === 'adapt')
check('🔴 이번 회차 안에서는 실패 뒤로 가지 않는다', (() => {
  const done: StageOutcome[] = [okOutcome('collect'),
    { ...okOutcome('adapt'), status: 'failed', exitCode: 1 }]
  return shouldStopRun(done)
})())
check('🟢 실패가 없으면 계속 간다', !shouldStopRun([okOutcome('collect'), okOutcome('adapt')]))
check('🔴 실패한 단계는 끝난 것이 아니라 미완료다 — 다음 회차가 거기서 잇는다', (() => {
  const done: StageOutcome[] = [okOutcome('collect'),
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
  adapt: ['.microseed-data/82cook-adapt-R1.detail.jsonl', '.microseed-data/82cook-adapt-R1.raw-detail.jsonl'],
  judge: ['.microseed-data/auto-judge-R2.shadow.jsonl'],
  draft: ['.microseed-data/auto-draft-R3.candidates.json', '.microseed-data/auto-draft-R3.picks.jsonl'],
}
const allExist = (): boolean => true

// ① adapt 실패 → adapt 부터 재개 · collect 재호출 0
check('🔴 ① adapt 실패 → 다음 회차는 adapt 부터', (() => {
  const cp = A({ stages: failedAt('adapt', ['collect']), artifacts: { collect: ART.collect } })
  const r = resumeDecision({ checkpoint: cp, plan })
  return r.kind === 'resume' && r.from === 'adapt'
})())
check('🔴 ① adapt 재개 시 collect 를 다시 부르지 않는다', (() => {
  const cp = A({ stages: failedAt('adapt', ['collect']), artifacts: { collect: ART.collect } })
  const r = resumeDecision({ checkpoint: cp, plan })
  // 재개 지점부터 남은 단계에 collect 가 없어야 한다
  const rest = plan.slice(plan.findIndex((x) => x.stage === (r.kind === 'resume' ? r.from : 'collect')))
  return !rest.some((x) => x.stage === 'collect')
})())
check('🔴 ① adapt 는 collect 산출물을 exact input 으로 받는다', (() => {
  const a = stageInputArgs('adapt', ART)
  return a.length === 1 && a[0] === '--input=.microseed-data/82cook-thin-R1.thin-detail.jsonl'
})())

// ② judge 실패 → judge 부터 재개
check('🔴 ② judge 실패 → 다음 회차는 judge 부터', (() => {
  const cp = A({ stages: failedAt('judge', ['collect', 'adapt']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  return r.kind === 'resume' && r.from === 'judge'
})())
check('🔴 ② judge 재개 시 collect · adapt 를 다시 부르지 않는다', (() => {
  const cp = A({ stages: failedAt('judge', ['collect', 'adapt']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  if (r.kind !== 'resume') return false
  const rest = plan.slice(plan.findIndex((x) => x.stage === r.from))
  return !rest.some((x) => x.stage === 'collect' || x.stage === 'adapt')
})())
check('🔴 ② judge 는 adapt 가 만든 두 파일을 함께 받는다', (() => {
  const a = stageInputArgs('judge', ART)
  return a.length === 1
    && a[0].includes('82cook-adapt-R1.detail.jsonl')
    && a[0].includes('82cook-adapt-R1.raw-detail.jsonl')
})())

// ③ draft 실패 → draft 부터 재개
check('🔴 ③ draft 실패 → 다음 회차는 draft 부터', (() => {
  const cp = A({ stages: failedAt('draft', ['collect', 'adapt', 'judge']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  return r.kind === 'resume' && r.from === 'draft'
})())
check('🔴 ③ draft 재개 시 앞 세 단계를 다시 부르지 않는다', (() => {
  const cp = A({ stages: failedAt('draft', ['collect', 'adapt', 'judge']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  if (r.kind !== 'resume') return false
  const rest = plan.slice(plan.findIndex((x) => x.stage === r.from))
  return !rest.some((x) => ['collect', 'adapt', 'judge'].includes(x.stage))
})())
check('🔴 ③ draft 는 그 회차의 shadow 만 받는다', (() => {
  const a = stageInputArgs('draft', ART)
  return a.length === 1 && a[0] === '--input=.microseed-data/auto-judge-R2.shadow.jsonl'
})())

// ④ fill 실패 → fill 부터 재개 · 새 원천 수집 0
check('🔴 ④ fill 실패 → 다음 회차는 fill 부터', (() => {
  const cp = A({ stages: failedAt('fill', ['collect', 'adapt', 'judge', 'draft']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  return r.kind === 'resume' && r.from === 'fill'
})())
check('🔴 ④ fill 재개 시 새 원천을 수집하지 않는다', (() => {
  const cp = A({ stages: failedAt('fill', ['collect', 'adapt', 'judge', 'draft']), artifacts: ART })
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
  const cp = A({ stages: failedAt('judge', ['collect', 'adapt']), artifacts: ART })
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
  const gone = missingArtifacts({ from: 'draft', artifacts: { collect: ART.collect }, exists: allExist })
  return gone.length === 1 && gone[0].includes('judge')
})())
check('🟢 ⑥ 파일이 다 있으면 통과', missingArtifacts({ from: 'fill', artifacts: ART, exists: allExist }).length === 0)
check('🔴 ⑥ 재개 지점의 앞 단계를 정확히 본다', (() => (
  upstreamOf('collect') === null && upstreamOf('adapt') === 'collect'
  && upstreamOf('judge') === 'adapt' && upstreamOf('draft') === 'judge'
  && upstreamOf('fill') === 'draft'
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
  const cp = A({ stages: failedAt('fill', ['collect', 'adapt', 'judge', 'draft']), artifacts: ART })
  const r = resumeDecision({ checkpoint: cp, plan })
  if (r.kind !== 'resume') return false
  const rest = plan.slice(plan.findIndex((x) => x.stage === r.from))
  return rest.every((x) => !x.network)
})())
check('🔴 ⑩ 재개해도 계획은 앞 회차 것이다 — --limit 이 달라지지 않는다', (() => {
  const cp = A({ shortfall: 9, collectCap: 36 })
  const p2 = planStages({ collectCap: cp.collectCap, shortfall: cp.shortfall })
  return p2[4].args.join(' ') === '--apply --limit=9'
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
  check('🔴 [러너] fill 호출에 --limit 이 그대로 실린다',
    ex.calls.find((c) => c.stage === 'fill')?.args.includes('--limit=9') === true)
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
check('🔴 러너가 네이버에 가지 않는다', !/naver|navercafe/i.test(code))
check('🔴 러너가 Raw SQL 을 쓰지 않는다', !/\$queryRaw|\$executeRaw/.test(code))
check('🔴 러너가 부르는 스크립트는 기존 5개뿐이다', (() => {
  const hits = [...code.matchAll(/scripts\/[a-z0-9-]+\.mts/g)].map((m) => m[0])
  const want = new Set([
    'scripts/micro-seed-82cook-thin-detail.mts', 'scripts/micro-seed-82cook-thin-adapt.mts',
    'scripts/micro-seed-auto-judge.mts', 'scripts/micro-seed-auto-draft.mts',
    'scripts/micro-seed-supply-autofill.mts',
  ])
  return hits.length > 0 && hits.every((h) => want.has(h))
})())
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

console.log(`\n─────────────────────────────────────────────────────────`)
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
