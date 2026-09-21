/**
 * 공급 깔때기 **칸 모형** — 🔴 순수 함수. 파일도 DB 도 읽지 않는다
 *
 * 🔴 **한 칸이 멈추면 아래 칸은 전부 굶는다.** 그래서 "무엇이 모자란가" 가 아니라
 *    **"어느 칸에서 끊겼는가"** 를 먼저 답해야 한다. 그 자리를 이 파일이 정한다.
 *
 * 🔴 **섞지 않는 세 가지**
 *      ① 목록 출현 수 — 회차마다 같은 글이 다시 잡힌다. **고유 신규 글 수가 아니다**
 *      ② backlog — 예전에 쌓인 것. 하루 유입과 더하지 않는다
 *      ③ 한 번의 canary — 그것을 일수로 나누면 일간 처리량처럼 보이지만 아니다
 */

export const PIPELINE_STAGES = [
  'sourceList', 'sourceDetail', 'adapt', 'workset', 'judge', 'draft',
  'semanticReview', 'candidate', 'humanReady', 'personaMatch', 'publish', 'comment',
] as const
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const STAGE_LABEL: Readonly<Record<PipelineStage, string>> = {
  sourceList: '원천 목록', sourceDetail: '원천 상세(본문)', adapt: 'adapt',
  workset: '작업 묶음', judge: 'judge', draft: 'draft', semanticReview: '의미 검수',
  candidate: '후보(큐 적재)', humanReady: '사람 READY', personaMatch: 'Persona 배정',
  publish: '발행', comment: '댓글',
}

/**
 * 🔴 세 가지뿐이다.
 *    `running`     최근 창 안에 산출물이 있다
 *    `stopped`     돌 수 있는데 최근 산출물이 없다 · 또는 스위치가 꺼져 있다
 *    `unmeasured`  🔴 **볼 근거가 없다** — 0 이 아니다
 */
export const STAGE_STATUSES = ['running', 'stopped', 'unmeasured'] as const
export type StageStatus = (typeof STAGE_STATUSES)[number]

export type StageEvidence = {
  stage: PipelineStage
  /**
   * 🔴 이 칸의 산출물이 마지막으로 생긴 시각(ms). **근거가 없으면 `null`** —
   *    "오래 전" 이 아니라 "본 적이 없다" 다.
   */
  lastAtMs: number | null
  /** 🔴 최근 창 안의 산출량. 재지 못했으면 `null` */
  recentCount: number | null
  /** 그 수가 무엇을 센 것인가 — 🔴 이름을 흐리지 않는다 */
  unit: string
  /** 스위치가 꺼져 있는가. 스위치가 없는 칸은 `null` */
  switchedOff: boolean | null
  /** 🔴 이 칸의 산출물이 며칠 안에 있어야 "돌고 있다" 인가 */
  staleAfterDays: number
}

export type StageFact = StageEvidence & {
  status: StageStatus
  /** 🔴 다음 칸으로 넘어가지 못한 이유 — 넘어갔으면 `null` */
  blockedReason: string | null
}

export function judgeStageStatus(e: StageEvidence, nowMs: number): StageStatus {
  if (e.switchedOff === true) return 'stopped'
  if (e.lastAtMs === null) {
    // 🔴 근거가 아예 없다. "안 돈다" 라고 단정할 수도 없다
    return e.recentCount === null ? 'unmeasured' : 'stopped'
  }
  const ageDays = (nowMs - e.lastAtMs) / 86_400_000
  return ageDays <= e.staleAfterDays ? 'running' : 'stopped'
}

/**
 * 🔴 **끊긴 자리를 찾는다.** 위 칸이 돌고 있는데 이 칸이 멎었으면 여기가 병목이다.
 *    위 칸도 멎었으면 이 칸을 고쳐도 소용없다 — 가장 위의 멎은 칸부터 고친다.
 */
export function firstBrokenStage(facts: readonly StageFact[]): StageFact | null {
  for (const f of facts) if (f.status !== 'running') return f
  return null
}

export function buildStageFacts(input: {
  evidence: readonly StageEvidence[]
  nowMs: number
  /** 칸별 "못 넘어간 이유" — 부르는 쪽이 아는 사실을 넣는다 */
  reasons?: Partial<Record<PipelineStage, string>>
}): StageFact[] {
  const out: StageFact[] = []
  let upstreamRunning = true
  for (const e of input.evidence) {
    const status = judgeStageStatus(e, input.nowMs)
    /**
     * 🔴 **이유를 하나만 고르지 않는다** (2026-09-21 보정).
     *
     *    발행 칸은 위 칸이 멎은 데다 **자기 러너도 내려가 있다**. 앞엣것만 적으면
     *    "위만 고치면 된다" 로 읽히는데, 위를 고쳐도 이 칸은 여전히 안 돈다.
     */
    const given = input.reasons?.[e.stage] ?? null
    const parts: string[] = []
    if (status !== 'running') {
      if (given !== null) parts.push(given)
      if (e.switchedOff === true && given === null) parts.push('스위치가 꺼져 있다')
      if (!upstreamRunning) parts.push('위 칸이 멎어 입력이 오지 않는다')
      if (status === 'unmeasured') parts.push('🔴 볼 근거가 없다 — 0 이 아니다')
      if (parts.length === 0) parts.push('입력은 있는데 산출물이 없다')
    }
    out.push({ ...e, status, blockedReason: parts.length === 0 ? null : parts.join(' · ') })
    if (status !== 'running') upstreamRunning = false
  }
  return out
}

/**
 * 🔴 **한 번의 회차를 일수로 나누지 않는다** (2026-09-21 6차 보정).
 *
 *    canary 를 한 번 돌려 3건이 나왔을 때 그것을 14 로 나누면 `0.2/day` 가 된다.
 *    그 숫자는 "하루에 0.2건 만들어진다" 로 읽히지만, 실제로는 **하루도 정상 가동한 적이 없다.**
 *    회차가 하나뿐이면 일간 값을 내지 않고 **그 회차의 값 그대로** 보고한다.
 */
export const MIN_RUNS_FOR_DAILY_RATE = 2

export type RateReading =
  | { kind: 'daily'; perDay: number; runs: number; days: number }
  | { kind: 'singleRun'; count: number; at: string | null }
  | { kind: 'unmeasured'; reason: string }

export function rateOf(input: {
  count: number
  runs: number
  days: number
  lastAt?: string | null
}): RateReading {
  if (input.days <= 0) return { kind: 'unmeasured', reason: '창 길이가 없다' }
  if (input.runs === 0) return { kind: 'unmeasured', reason: '회차 기록이 없다' }
  if (input.runs < MIN_RUNS_FOR_DAILY_RATE) {
    // 🔴 일간 값으로 일반화하지 않는다
    return { kind: 'singleRun', count: input.count, at: input.lastAt ?? null }
  }
  return {
    kind: 'daily',
    perDay: Math.round((input.count / input.days) * 10) / 10,
    runs: input.runs, days: input.days,
  }
}

export function showRate(r: RateReading): string {
  if (r.kind === 'daily') return `${r.perDay}/day (${r.runs}회차 · ${r.days}일)`
  if (r.kind === 'singleRun') {
    return `🔴 회차 1번 ${r.count}건${r.at === null ? '' : ` (${r.at})`} — 일간 값으로 읽지 않는다`
  }
  return `unmeasured — ${r.reason}`
}

/**
 * 🔴 **backlog 와 하루 유입을 가른다.** 큐에 221건이 있다는 것과
 *    하루에 몇 건 들어온다는 것은 다른 사실이고, 더하면 둘 다 뜻을 잃는다.
 */
export type BacklogSplit = {
  /** 지금 쌓여 있는 전체 */
  backlog: number
  /** 그중 지금 계약에 맞는 것 */
  backlogUsable: number
  /** 🔴 계약이 달라 못 쓰는 것 — "오래된 것" 과 다르다 */
  backlogContractMismatch: number
  /** 최근 창의 유입 */
  inflow: RateReading
}

export function describeBacklog(b: BacklogSplit): string[] {
  const out = [
    `backlog ${b.backlog}건 (지금 계약에 맞는 것 ${b.backlogUsable}건`
    + ` · 🔴 계약이 달라 못 쓰는 것 ${b.backlogContractMismatch}건)`,
    `유입 ${showRate(b.inflow)}`,
  ]
  if (b.backlogContractMismatch > 0) {
    out.push('🔴 계약 불일치는 "오래돼서" 가 아니다 — 같은 창 안에 만들어졌어도 지금 규칙과 어긋나면 못 쓴다')
  }
  return out
}
