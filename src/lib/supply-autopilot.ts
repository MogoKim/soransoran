/**
 * 공급 Autopilot v1 — 순수 판정 (§4-AU)
 *
 * 🔴 **여기에 새 판정도 새 생성도 없다.** 이 파일이 정하는 것은 딱 셋이다.
 *   ① 돌 것인가 (재고 · 스위치 · lock)
 *   ② 어떤 순서로 무엇을 돌릴 것인가
 *   ③ 끝나고 무엇이 어긋났는가
 *
 * 실제 수집 · 판정 · 생성 · 적재는 **기존 스크립트가 그대로** 한다.
 * 그 안의 robots · 간격 · 상한 · 저장 계약 · 안전성 게이트를 이 파일이
 * 다시 구현하면, 고칠 곳이 두 곳이 되고 언젠가 한쪽만 고쳐진다.
 */

import { STOCK_TARGET } from './micro-seed-supply-autofill'

/** 🔴 전체 kill switch. plist 를 지우지 않고도 멈출 수 있어야 한다 */
export const AUTOPILOT_KILL_SWITCH_ENV = 'SORAN_SUPPLY_AUTOPILOT_ENABLED'

/** 하위 단계가 각자 요구하는 스위치 — 러너가 미리 확인해 중간에 멈추지 않게 한다 */
export const CHILD_KILL_SWITCH_ENV = 'SORAN_82COOK_THIN_DETAIL_ENABLED'

/** 🔴 한 번에 밖으로 나가는 상한. 하위 스크립트의 BATCH_CAP 과 같은 값이다 */
export const COLLECT_CAP = 50
export const COLLECT_MIN = 10

/** lock 이 이보다 오래되면 죽은 것으로 본다 — 90분. 한 회차 최장 소요의 3배 남짓 */
export const LOCK_TTL_MS = 90 * 60 * 1000

export const LOCK_FILE = 'supply-autopilot.lock'

/**
 * 🔴 `cafeThin` 이 `collect` 와 `adapt` 사이에 있다.
 *
 * 네이버 카페는 launchd 가 따로 수집한다(09:20 · 13:20). 그 산출물이 `adapt` 가 집는
 * 형태가 되려면 얇은 변환을 한 번 거쳐야 하는데, 그것을 사람이 치고 있었다 —
 * 치지 않으면 수집물이 그대로 쌓이기만 했다.
 * 네트워크에도 모델에도 나가지 않는 단계라 순서에 넣는 비용이 거의 없다.
 */
export const STAGES = ['collect', 'cafeThin', 'adapt', 'judge', 'draft', 'fill'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABEL: Record<Stage, string> = {
  collect: '82cook thin 수집',
  cafeThin: '네이버 카페 수집물 얇은 변환',
  adapt: '검수용 변환',
  judge: 'AI 자동 판정',
  draft: 'AI 초안 생성 · 품질 게이트',
  fill: 'Queue 재고 보충',
}

/** 🔴 밖으로 나가는 단계. 이 단계만 kill switch 와 robots 를 요구한다 */
export const NETWORK_STAGES: readonly Stage[] = ['collect']
/** 🔴 모델을 부르는 단계 */
export const LLM_STAGES: readonly Stage[] = ['judge', 'draft']
/** 🔴 DB 에 쓰는 단계 — 하나뿐이다. 나머지는 전부 파일까지다 */
export const DB_WRITE_STAGES: readonly Stage[] = ['fill']

export type StockSnapshot = {
  usable: number
  human: number
  machine: number
  shortfall: number
}

export type RunBlock =
  | { code: 'NOOP_STOCK_OK'; reason: string }
  | { code: 'DRY_RUN'; reason: string }
  | { code: 'NO_KILL_SWITCH'; reason: string }
  | { code: 'NO_CHILD_KILL_SWITCH'; reason: string }
  | { code: 'LOCKED'; reason: string }

export type RunGo = {
  ok: true
  shortfall: number
  /** 이번 회차에 열 원천 수 */
  collectCap: number
}

export type RunVerdict = RunGo | ({ ok: false } & RunBlock)

/**
 * 수집량 — 🔴 부족분과 같은 수만 열면 모자란다.
 *
 * 2026-09-07 실측: 열기 50 → AUTO_SEED 24 → 채택 16 → 적재 가능 9.
 * 원천 하나가 큐 한 줄이 되지 않는다. 그래서 부족분의 4배를 열되
 * 상한 50 · 하한 10 을 지킨다 — 상한은 하위 스크립트도 다시 막는다.
 */
export function collectCapFor(shortfall: number): number {
  if (shortfall <= 0) return 0
  return Math.min(COLLECT_CAP, Math.max(COLLECT_MIN, shortfall * 4))
}

/**
 * 돌 것인가 — 🔴 **재고가 먼저다.**
 *
 * 스위치가 열려 있어도 재고가 차 있으면 밖으로 나가지 않는다.
 * "매일 도는 것" 과 "매일 남의 서버를 두드리는 것" 은 다른 일이다.
 */
export function judgeRun(input: {
  live: boolean
  killOpen: boolean
  childKillOpen: boolean
  stock: StockSnapshot
  lock: LockDecision
  target?: number
}): RunVerdict {
  const target = input.target ?? STOCK_TARGET

  // ① 재고 — 스위치보다 앞이다
  if (input.stock.usable >= target) {
    return {
      ok: false, code: 'NOOP_STOCK_OK',
      reason: `재고 ${input.stock.usable}건 ≥ 목표 ${target}건 — 수집하지 않는다`,
    }
  }

  // ② lock — 두 회차가 같은 원천을 동시에 열지 않는다
  if (input.lock === 'busy') {
    return { ok: false, code: 'LOCKED', reason: '앞 회차가 아직 돈다' }
  }

  const shortfall = Math.max(0, target - input.stock.usable)

  // ③ dry-run 이 기본이다
  if (!input.live) {
    return {
      ok: false, code: 'DRY_RUN',
      reason: `dry-run — 부족 ${shortfall}건. 실행하려면 --live 와 ${AUTOPILOT_KILL_SWITCH_ENV}=true 가 둘 다 필요하다`,
    }
  }

  // ④ 두 스위치 — --live 하나로는 열지 않는다
  if (!input.killOpen) {
    return {
      ok: false, code: 'NO_KILL_SWITCH',
      reason: `${AUTOPILOT_KILL_SWITCH_ENV}=true 가 없다 — --live 하나로는 열지 않는다`,
    }
  }

  // ⑤ 하위 스위치를 **미리** 본다 — 수집만 하고 멈추면 반쪽 상태가 남는다
  if (!input.childKillOpen) {
    return {
      ok: false, code: 'NO_CHILD_KILL_SWITCH',
      reason: `${CHILD_KILL_SWITCH_ENV}=true 가 없다 — 수집 단계가 열리지 않는다`,
    }
  }

  return { ok: true, shortfall, collectCap: collectCapFor(shortfall) }
}

export type StagePlan = {
  stage: Stage
  label: string
  /** 하위 스크립트에 넘길 인자. 🔴 러너가 조립하지 않는다 — 여기서 정한다 */
  args: readonly string[]
  network: boolean
  llm: boolean
  dbWrite: boolean
}

/**
 * 무엇을 어떤 순서로 — 🔴 **기존 명령 그대로**다.
 * 인자를 여기서 한 번에 정해두면 러너가 즉흥으로 플래그를 붙일 수 없다.
 */
export function planStages(input: { collectCap: number; shortfall: number }): StagePlan[] {
  const mk = (stage: Stage, args: readonly string[]): StagePlan => ({
    stage, label: STAGE_LABEL[stage], args,
    network: NETWORK_STAGES.includes(stage),
    llm: LLM_STAGES.includes(stage),
    dbWrite: DB_WRITE_STAGES.includes(stage),
  })
  return [
    mk('collect', ['--live', `--cap=${input.collectCap}`]),
    // 🔴 네트워크 0 · LLM 0 · DB 0. 이미 수집된 파일만 얇게 바꾼다
    mk('cafeThin', ['--apply']),
    mk('adapt', ['--apply']),
    mk('judge', ['--call', '--apply']),
    mk('draft', ['--call', '--apply']),
    // 🔴 목표까지만. 부족분을 넘겨 적재하지 않는다
    mk('fill', ['--apply', `--limit=${input.shortfall}`]),
  ]
}

export type LockDecision = 'free' | 'busy' | 'stale'
export type LockRecord = { runId: string; pid: number; startedAt: string }

/**
 * lock 판정 — 🔴 **죽은 lock 이 영원히 막으면 자동화가 아니다.**
 *
 * 프로세스가 살아 있는지까지 보는 것은 러너의 몫이고(플랫폼 의존),
 * 여기서는 시간만 본다. TTL 을 넘긴 lock 은 stale 이다.
 */
export function lockDecision(
  rec: LockRecord | null, now: Date, ttlMs: number = LOCK_TTL_MS,
): LockDecision {
  if (rec === null) return 'free'
  const t = Date.parse(rec.startedAt)
  // 🔴 시각을 못 읽는 lock 은 믿을 수 없다 — 붙잡아 두지 말고 stale 로 본다
  if (!Number.isFinite(t)) return 'stale'
  return now.getTime() - t > ttlMs ? 'stale' : 'busy'
}

/**
 * 죽은 lock 을 어떻게 할 것인가 — 🔴 **삭제도 write 다.**
 *
 * 게이트가 닫혔는데 lock 을 지우면 "파일 write 0" 이 거짓말이 되고,
 * dry-run 이나 스위치가 내려간 실행이 남의 lock 을 걷어내고 끝나는 셈이 된다.
 * 판정은 그대로 stale 로 두되(계획 계산은 free 처럼 진행한다) 디스크는 건드리지 않는다.
 *
 * 🔴 이 판단을 러너 안에 두면 **테스트가 러너를 통째로 돌려야** 확인할 수 있다.
 *    그 테스트는 실제 수집·모델·DB 를 건드릴 수 있다 — 재고가 모자란 날 돌리면 그렇게 된다.
 *    그래서 판단만 떼어 두고, 삭제 함수는 인자로 받는다.
 */
export type StaleLockPlan = {
  action: 'remove' | 'preserve' | 'none'
  lines: string[]
}

export function planStaleLock(input: {
  stale: boolean
  canWrite: boolean
  runId: string
  pid: number
}): StaleLockPlan {
  if (!input.stale) return { action: 'none', lines: [] }
  const who = `(runId ${input.runId || '?'} · pid ${input.pid})`
  if (input.canWrite) {
    return {
      action: 'remove',
      lines: [
        `① lock  🟡 죽은 lock 을 걷어낸다 ${who}`,
        '        🔴 checkpoint 는 지우지 않는다 — 재개 근거다',
      ],
    }
  }
  return {
    action: 'preserve',
    lines: [
      `① lock  🟡 죽은 lock 이 있다 ${who}`,
      '        🔴 지우지 않는다 — 게이트가 닫혀 있다 (파일 write 0 · 삭제 0)',
    ],
  }
}

/**
 * 계획대로 집행한다 — 🔴 삭제 함수를 **주입**받는다.
 * 테스트는 임시 디렉터리의 임시 파일과 자기 삭제 함수를 넘긴다.
 */
export function applyStaleLockPlan(
  plan: StaleLockPlan, remove: () => void,
): { removed: boolean } {
  if (plan.action === 'remove') { remove(); return { removed: true } }
  return { removed: false }
}

export type StageOutcome = {
  stage: Stage
  status: 'ok' | 'failed' | 'skipped'
  exitCode: number | null
  startedAt: string
  endedAt: string
  note: string
}

/**
 * 🔴 단계가 만든 파일. **다음 회차가 "그 파일" 을 이어받기 위한 것**이다.
 *
 * 이름이 아니라 경로를 남긴다. `.microseed-data` 에는 다른 회차의 산출물도 쌓이고,
 * 하위 스크립트는 대개 "가장 최근 파일" 을 집는다 — 재개할 때 그 습성에 맡기면
 * 앞 회차가 만든 것 대신 남의 것을 먹는다.
 */
export type Artifacts = { [K in Stage]?: string[] } & {
  /**
   * 🔴 **회차 시작 전에 이미 있던 미처리 thin 파일.**
   *
   * 네이버는 09:20 · 13:20 에 launchd 가 긁고, 공급 러너는 21:10 에 돈다.
   * 그 파일들은 러너가 시작하기 **전에** 이미 존재하므로 "실행 중 새로 생긴 파일"
   * 로는 절대 잡히지 않는다 — 그대로 두면 adapt 입력에서 통째로 빠진다.
   * 그래서 회차 시작 시 한 번 계산해 checkpoint 에 박아 둔다(재개 시 같은 파일을 쓴다).
   */
  preexisting?: string[]
}

/**
 * 🔴 terminal 상태를 명시한다. `running` 인 채로 남은 것만 재개 대상이다.
 *
 * `superseded` 는 **DB 가 먼저 목표를 채운** 경우다 — 사람이 손으로 채웠거나
 * 다른 경로로 큐가 찼을 때. 이때 남은 회차를 잇겠다고 네트워크로 나가면
 * 목표를 넘겨 적재한다. 그렇다고 `running` 으로 두면 영구히 재개 대상으로 남는다.
 */
export type RunStatus = 'running' | 'done' | 'failed' | 'superseded'

export type Checkpoint = {
  runId: string
  startedAt: string
  status: RunStatus
  completedAt: string | null
  /** 이 회차가 세운 계획 — 재개할 때 새로 세우지 않는다 */
  shortfall: number
  collectCap: number
  stock: { before: StockSnapshot; after: StockSnapshot | null }
  stages: StageOutcome[]
  artifacts: Artifacts
}

/**
 * 다음에 돌 단계 — 🔴 **성공한 단계 다음부터**다.
 *
 * 실패한 단계는 "끝난 것" 이 아니라 **미완료** 다. 다음 회차는 거기서 다시 시작한다.
 * 그래서 실패 기록은 건너뛰기의 근거가 되지 않는다 — `ok` 만 센다.
 */
export function nextStage(plan: readonly StagePlan[], done: readonly StageOutcome[]): StagePlan | null {
  const doneSet = new Set(done.filter((d) => d.status === 'ok').map((d) => d.stage))
  return plan.find((p) => !doneSet.has(p.stage)) ?? null
}

/**
 * 여기서 멈출 것인가 — 🔴 **넘긴 목록 안에 실패가 있으면 멈춘다.**
 *
 * 🔴 **무엇을 넘기느냐가 전부다.** 재개할 때 `cp.stages` 전체를 넘기면
 *    지난 회차의 실패 기록 때문에 이번 실행이 첫 줄에서 멈춘다 —
 *    재시도하려고 이어받은 단계를 정작 한 번도 부르지 않는다.
 *    그래서 호출부는 **이번 attempt 몫만** 잘라 넘겨야 한다 (`attemptOf`).
 */
export function shouldStopRun(done: readonly StageOutcome[]): boolean {
  return done.some((d) => d.status === 'failed')
}

/**
 * 이번 실행이 새로 만든 기록만 — 🔴 **과거 실패는 감사 기록이지 중단 사유가 아니다.**
 *
 * 재개는 "지난번에 실패한 그 단계를 다시 해보는 것" 이다.
 * 그 실패 기록을 중단 조건으로 읽으면 재개라는 말이 성립하지 않는다.
 */
export function attemptOf(stages: readonly StageOutcome[], attemptFrom: number): StageOutcome[] {
  return stages.slice(Math.max(0, attemptFrom))
}

/**
 * DB 가 먼저 목표를 채웠는가 — 🔴 남은 회차를 잇지 말고 종결한다.
 *
 * 이어서 돌면 목표를 넘겨 적재하고, 안 돌리고 두면 영구 `running` 이 된다.
 * 둘 다 나쁘다. 그래서 **종결**한다 — 이 회차의 산출물은 다음 회차가 다시 쓸 수 있다.
 */
export function supersedes(input: { usable: number; target?: number }): boolean {
  return input.usable >= (input.target ?? STOCK_TARGET)
}

/**
 * 실행 상태 파일을 바꿔도 되는가.
 *
 * dry-run과 kill switch가 닫힌 실행은 관찰만 해야 한다. 재고가 이미 찼더라도
 * checkpoint를 종결하거나 데이터 디렉터리를 만드는 것은 live 실행에서만 한다.
 */
export function mayWriteRunState(input: {
  live: boolean
  killOpen: boolean
  childKillOpen: boolean
}): boolean {
  return input.live && input.killOpen && input.childKillOpen
}

/**
 * 재개할 것인가 — 🔴 **미완료 회차가 있으면 새 수집보다 그것이 먼저다.**
 *
 * 중간에서 끊긴 회차를 두고 새로 collect 부터 시작하면 앞 회차의 수집분 ·
 * 판정 결과 · 초안이 주인 없이 쌓인다. 모델을 두 번 부르고, 남의 서버를 두 번 두드리고,
 * 그러고도 큐는 안 찬다. **끊긴 자리에서 잇는 것이 무인 반복의 최소 조건이다.**
 */
export type ResumeDecision =
  | { kind: 'fresh'; reason: string }
  | { kind: 'resume'; from: Stage; reason: string }

export function resumeDecision(input: {
  checkpoint: Checkpoint | null
  plan: readonly StagePlan[]
}): ResumeDecision {
  const cp = input.checkpoint
  if (cp === null) return { kind: 'fresh', reason: '미완료 회차가 없다' }
  // 🔴 terminal 은 재개 대상이 아니다. 끝난 회차를 다시 열면 같은 후보를 두 번 적재한다
  if (cp.status === 'done') return { kind: 'fresh', reason: `앞 회차 ${cp.runId} 는 끝났다` }
  const next = nextStage(input.plan, cp.stages)
  if (next === null) {
    // 단계는 다 돌았는데 status 가 running 인 기록 — 정합이 깨진 것이다. 새로 시작한다
    return { kind: 'fresh', reason: `앞 회차 ${cp.runId} 는 단계가 모두 끝나 있다` }
  }
  return {
    kind: 'resume', from: next.stage,
    reason: `앞 회차 ${cp.runId} 가 ${next.stage} 에서 끊겼다 — 새 수집보다 먼저 잇는다`,
  }
}

/**
 * 단계가 이어받을 입력 — 🔴 **"가장 최근 파일" 에 맡기지 않는다.**
 *
 * 하위 스크립트 대부분은 지정이 없으면 디렉터리에서 최신 파일을 집는다.
 * 재개할 때 그 습성에 맡기면 앞 회차 산출물 대신 다른 회차의 것을 먹는다 —
 * 그러면 수집한 것과 판정한 것과 적재한 것이 서로 다른 판이 된다.
 */
export function stageInputArgs(stage: Stage, artifacts: Artifacts): string[] {
  const pick = (from: Stage, suffixes: readonly string[]): string[] => {
    const hits = (artifacts[from] ?? []).filter((f) => suffixes.some((x) => f.endsWith(x)))
    return hits.length === 0 ? [] : [`--input=${hits.join(',')}`]
  }
  switch (stage) {
    // 수집은 이어받을 것이 없다 — 스스로 목록에서 고른다
    case 'collect': return []
    // 🔴 82cook 과 네이버가 **둘 다** 만든 얇은 파일을 함께 넘긴다.
    //    한쪽만 넘기면 그 회차에 수집한 다른 소스가 통째로 빠진다
    case 'adapt': {
      const thin = (f: string): boolean => f.endsWith('.thin-detail.jsonl')
      // 🔴 세 갈래를 **모두** 넣는다. 하나라도 빠지면 그 소스가 그 회차에서 통째로 사라진다.
      //    · collect     이번 회차 82cook
      //    · cafeThin    이번 회차가 역사 raw 를 새로 변환한 것
      //    · preexisting 정기 수집(09:20 · 13:20)이 러너 시작 **전에** 만들어 둔 것
      const all = [
        ...(artifacts.collect ?? []).filter(thin),
        ...(artifacts.cafeThin ?? []).filter(thin),
        ...(artifacts.preexisting ?? []).filter(thin),
      ]
      // 🔴 중복 제거 — 같은 파일을 두 번 넘기면 adapt 가 두 번 읽는다
      const uniq = [...new Set(all)]
      return uniq.length === 0 ? [] : [`--input=${uniq.join(',')}`]
    }
    // 수집물은 스스로 찾는다 — 앞 단계가 만든 것이 아니라 launchd 가 남긴 것이다
    case 'cafeThin': return []
    case 'judge': return pick('adapt', ['.detail.jsonl', '.raw-detail.jsonl'])
    case 'draft': return pick('judge', ['.shadow.jsonl'])
    case 'fill': return pick('draft', ['.candidates.json'])
    default: return []
  }
}

/** 그 단계가 이어받아야 할 앞 단계 — 없으면 null */
export function upstreamOf(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage)
  return i <= 0 ? null : STAGES[i - 1]
}

/**
 * 이어받을 파일이 실제로 있는가 — 🔴 **없으면 fail closed 다.**
 *
 * 앞 회차의 산출물이 사라졌는데 조용히 새 수집으로 넘어가면,
 * 사람은 "이어서 돌았다" 고 읽고 실제로는 처음부터 다시 돈 것이 된다.
 * 그 착각 위에서 비용과 요청 수를 판단하게 된다.
 */
export function missingArtifacts(input: {
  from: Stage
  artifacts: Artifacts
  exists: (path: string) => boolean
}): string[] {
  const up = upstreamOf(input.from)
  // 수집부터 재개하는 것은 이어받을 것이 없으니 누락도 없다
  if (up === null) return []
  // 🔴 cafeThin 은 launchd 수집물을 스스로 찾는다. 앞 단계가 넘겨주는 것이 없으므로
  //    "앞 단계 산출물이 없다" 가 실패 사유가 되면 안 된다 — 네이버를 안 돌린 날이 그렇다
  if (input.from === 'cafeThin') return []
  const listed = input.artifacts[up] ?? []
  if (listed.length === 0) return [`${up} 단계의 산출물 기록이 없다`]
  return listed.filter((f) => !input.exists(f)).map((f) => `${f} 가 없다`)
}

/**
 * 실행 후 새로 생긴 파일만 골라낸다 — 🔴 하위 스크립트가 자기 runId 를 쓰기 때문이다.
 * 러너가 파일명을 정할 수 없으니, 전후 목록의 차이로 알아낸다.
 */
export function newFiles(before: readonly string[], after: readonly string[]): string[] {
  const seen = new Set(before)
  return after.filter((f) => !seen.has(f)).sort()
}

/** 한 단계를 실제로 돌린 결과. 🔴 어떻게 돌렸는지는 러너가 안다 — 여기는 결과만 본다 */
export type ExecResult = {
  ok: boolean
  exitCode: number | null
  spawnError: string
  /** 그 단계가 만든 파일 */
  made: string[]
}

export type ExecFn = (stage: Stage, args: readonly string[]) => Promise<ExecResult>

export type LoopResult = {
  /** 실제로 부른 단계와 인자 — 🔴 "무엇을 몇 번 불렀나" 가 재개의 증거다 */
  calls: { stage: Stage; args: string[] }[]
  status: RunStatus
  /** 🔴 이번 attempt 에서 실패한 단계. 과거 실패는 여기 오지 않는다 */
  failedStage: Stage | null
  exitCode: 0 | 1
}

/**
 * 단계 루프 — 🔴 **재개의 핵심이 여기 있어서 순수 함수로 뺐다.**
 *
 * 2026-09-07 결함: 재개하면서 `shouldStopRun(cp.stages)` 를 루프 첫 줄에 뒀다.
 * `cp.stages` 에는 **지난 회차의 failed 가 그대로 들어 있다.** 그래서 이어받은
 * 단계를 한 번도 부르지 않고 즉시 멈췄고, 재시도에 성공해도 과거 실패 때문에
 * status 가 계속 `running` 이며 exit 은 1 이었다 — **완료 상태로 갈 수 없었다.**
 *
 * 계약:
 *   · `nextStage` 는 **전체 이력**의 ok 를 본다 → 성공한 단계를 다시 돌리지 않는다
 *   · 중단·terminal·exit 은 **이번 attempt** 만 본다 → 과거 실패는 감사 기록으로 남는다
 *
 * 러너가 아니라 이 함수가 판정을 쥐고 있으므로, fixture 가 가짜 `exec` 를 주입해
 * **호출 순서와 횟수까지** 검사할 수 있다.
 */
export async function runStages(input: {
  plan: readonly StagePlan[]
  checkpoint: Checkpoint
  exec: ExecFn
  now: () => string
  /** 단계 사이에 checkpoint 를 저장한다 — 중간에 죽어도 어디까지 됐는지 남는다 */
  save?: () => void
  inputArgsFor?: (stage: Stage, artifacts: Artifacts) => string[]
  onStage?: (stage: Stage, args: readonly string[]) => void
}): Promise<LoopResult> {
  const cp = input.checkpoint
  const inputArgsFor = input.inputArgsFor ?? stageInputArgs
  const save = input.save ?? ((): void => {})
  // 🔴 여기가 경계다. 이 지점 이후에 쌓인 기록만 "이번 실행" 이다
  const attemptFrom = cp.stages.length
  const calls: { stage: Stage; args: string[] }[] = []

  for (;;) {
    // 🔴 이번 attempt 몫만 본다. cp.stages 전체를 보면 재개가 첫 줄에서 죽는다
    if (shouldStopRun(attemptOf(cp.stages, attemptFrom))) break
    // 🔴 전체 이력 기준 — 이미 성공한 단계는 다시 돌리지 않는다
    const step = nextStage(input.plan, cp.stages)
    if (step === null) break

    const args = [...step.args, ...inputArgsFor(step.stage, cp.artifacts)]
    input.onStage?.(step.stage, args)
    const startedAt = input.now()
    const r = await input.exec(step.stage, args)
    calls.push({ stage: step.stage, args })
    if (r.made.length > 0) cp.artifacts[step.stage] = r.made
    cp.stages.push({
      stage: step.stage, status: r.ok ? 'ok' : 'failed', exitCode: r.exitCode,
      startedAt, endedAt: input.now(),
      note: r.ok ? '' : (r.spawnError !== '' ? `🔴 ${r.spawnError}` : '🔴 실패 — 뒤 단계로 가지 않는다'),
    })
    save()
    if (!r.ok) break
  }

  const mine = attemptOf(cp.stages, attemptFrom)
  const failed = mine.find((x) => x.status === 'failed') ?? null
  // 🔴 전체 이력 기준으로 남은 단계가 없으면 끝난 것이다 — 과거에 실패했더라도
  const allDone = nextStage(input.plan, cp.stages) === null
  const status: RunStatus = failed !== null ? 'running' : (allDone ? 'done' : 'running')
  cp.status = status
  cp.completedAt = status === 'done' ? input.now() : null
  save()
  return {
    calls, status, failedStage: failed?.stage ?? null,
    exitCode: status === 'done' ? 0 : 1,
  }
}

/**
 * 🔴 얇은 파일 하나의 **처리 identity**. runId 단독으로는 안 된다.
 *
 * 09:20 remonterrace 와 13:20 wgang 이 같은 runId 를 가질 수 있다.
 * runId 로만 판단하면 한쪽이 다른 쪽을 "이미 했다" 로 막고 산출물 이름도 겹쳐 덮어쓴다.
 *
 *   82cook-thin-<runId>.thin-detail.jsonl           → <runId>
 *   navercafe-thin-<cafe>-<runId>.thin-detail.jsonl → <cafe>-<runId>
 *
 * 82cook 키는 종전과 같아 기존 산출물과 어긋나지 않는다.
 * 🔴 러너 · adapt · fixture 가 **이 하나**를 쓴다. 복제하면 한쪽만 고쳐진다.
 */
export function adaptKeyOf(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.thin-detail\.jsonl$/, '')
  return base.replace(/^82cook-thin-/, '').replace(/^navercafe-thin-/, '')
}

export type RunProblem = string

/**
 * 끝나고 무엇이 어긋났는가 — 🔴 **Post 가 늘었으면 그것만으로 사고다.**
 * 이 러너는 발행하지 않는다. 발행은 auto-publish 의 일이다.
 */
export function verifyRun(input: {
  postBefore: number
  postAfter: number
  stockBefore: StockSnapshot
  stockAfter: StockSnapshot
  target?: number
  queuedMachine: number
  queuedNonMachine: number
}): { ok: boolean; problems: RunProblem[] } {
  const target = input.target ?? STOCK_TARGET
  const problems: RunProblem[] = []

  if (input.postAfter !== input.postBefore) {
    problems.push(`🔴 Post 가 ${input.postBefore} → ${input.postAfter} 로 변했다 — 이 러너는 발행하지 않는다`)
  }
  if (input.stockAfter.usable < input.stockBefore.usable) {
    problems.push(`🔴 재고가 줄었다 ${input.stockBefore.usable} → ${input.stockAfter.usable}`)
  }
  if (input.stockAfter.usable > target) {
    problems.push(`🔴 목표 ${target}건을 넘겨 적재했다 (${input.stockAfter.usable}건)`)
  }
  if (input.queuedNonMachine > 0) {
    problems.push(`🔴 기계가 아닌 행이 ${input.queuedNonMachine}건 적재됐다`)
  }
  const grew = input.stockAfter.machine - input.stockBefore.machine
  if (grew !== input.queuedMachine) {
    problems.push(`🔴 적재했다는 수(${input.queuedMachine})와 늘어난 기계 재고(${grew})가 다르다`)
  }
  return { ok: problems.length === 0, problems }
}

/** 화면 한 줄 요약 — 🔴 못 센 값은 0 이 아니라 null 로 두고 '—' 로 찍는다 */
export function fmtCount(n: number | null): string {
  return n === null ? '—' : String(n)
}
