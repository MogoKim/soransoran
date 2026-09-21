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

/**
 * 🔴 **"사람이 봤다" 와 "지금 나갈 수 있다" 는 다른 사실이다** (2026-09-21 7차 보정).
 *
 *    앞판은 창 안의 **사람 검토 이력 11건**을 그대로 "사람 READY 11건" 으로 적었다.
 *    그 11건에는 이미 발행된 글, 거절된 글, **지금 레인 계약과 어긋나는 글**이 섞여 있다.
 *    실제로 지금 나갈 수 있는 것은 4건이다 — 화면이 세 배 가까이 부풀어 있었다.
 *
 *    그래서 두 수를 **따로** 들고 다닌다. 하나로 합치면 어느 쪽 뜻인지 알 수 없다.
 */
export type LaneReadySplit = {
  /** 🔴 사람이 검토한 이력 — 발행 가능성과 무관하다 */
  humanReviewHistoryAll: number
  humanReviewHistoryInWindow: number
  /** 지금 레인 계약에 맞는 행 */
  laneContract: number
  /** 그중 거절되지 않은 것 */
  laneNotRejected: number
  /** 그중 아직 발행되지 않은 것 */
  laneUnpublished: number
  /** 🔴 **발행기가 실제로 고르는 수** — 이것이 READY 재고다 */
  lanePublishable: number
}

/** 🔴 거절·기한경과는 READY 가 아니다 */
export const LANE_ALIVE_STATUSES = ['APPROVED', 'EDITED', 'PUBLISHED'] as const

export type LaneRow = {
  id: string
  status: string
  createdPostId: string | null
  /** 사람이 검토했는가 — 🔴 발행 가능성과 무관한 사실이다 */
  humanDecided: boolean
  /** 지금 레인 계약에 맞는가 */
  contractOk: boolean
  decidedAt: Date | null
}

/**
 * 🔴 **READY 재고를 한 곳에서 만든다.** CLI 안에 인라인으로 두면
 *    거절된 글이나 계약 불일치를 섞어도 fixture 가 물어볼 방법이 없다 —
 *    실제로 그 상태로 한 판을 냈다.
 */
export function laneReadyOf(input: {
  rows: readonly LaneRow[]
  /** 🔴 발행기가 실제로 고른 id — 부르는 쪽이 정본 selector 로 만든다 */
  publishableIds: readonly string[]
  sinceMs: number
}): LaneReadySplit {
  const history = input.rows.filter((r) => r.humanDecided)
  const contract = input.rows.filter((r) => r.contractOk)
  const alive = contract.filter(
    (r) => (LANE_ALIVE_STATUSES as readonly string[]).includes(r.status),
  )
  const unpublished = alive.filter((r) => r.createdPostId === null || r.createdPostId === '')
  const unpublishedIds = new Set(unpublished.map((r) => r.id))
  /**
   * 🔴 **고른 것이 미발행 집합 밖이면 세지 않는다.** 밖에 있다는 것은 두 판정이
   *    어긋났다는 뜻이고, 그때 큰 쪽을 믿으면 재고가 부풀어 오른다.
   */
  const publishable = input.publishableIds.filter((id) => unpublishedIds.has(id)).length
  return {
    humanReviewHistoryAll: history.length,
    humanReviewHistoryInWindow: history.filter(
      (r) => (r.decidedAt?.getTime() ?? 0) >= input.sinceMs,
    ).length,
    laneContract: contract.length,
    laneNotRejected: alive.length,
    laneUnpublished: unpublished.length,
    lanePublishable: publishable,
  }
}

export function describeLaneReady(r: LaneReadySplit): string[] {
  return [
    `🔴 현재 레인 READY 재고 ${r.lanePublishable}건`
    + ` (계약 ${r.laneContract} → 미거절 ${r.laneNotRejected} → 미발행 ${r.laneUnpublished}`
    + ` → 발행기 통과 ${r.lanePublishable})`,
    `사람 검토 이력 ${r.humanReviewHistoryInWindow}건(창 안) · ${r.humanReviewHistoryAll}건(전체)`
    + ' — 🔴 **READY 재고가 아니다.** 발행된 것·거절된 것·계약이 어긋난 것이 섞여 있다',
  ]
}

/**
 * 🔴 **검토 이력을 READY 로 적으면 안 된다.** 두 수가 같아지는 것을 막는 것이 아니라,
 *    **READY 자리에 이력 수를 넣었는지**를 본다.
 */
export function laneReadyMisreported(r: LaneReadySplit, reportedReady: number): boolean {
  return reportedReady !== r.lanePublishable
}

/**
 * 🔴 **단계마다 자기 시각을 쓴다** (2026-09-21 7차 보정).
 *
 *    앞판은 세 단계 모두 `Queue.createdAt` 하나를 마지막 시각으로 돌려썼다.
 *    그러면 **다른 행이 새로 적재되기만 해도** 사람 검토·배정·발행이 방금 일어난 것처럼
 *    보인다 — 세 칸이 동시에 초록이 되고, 실제로는 아무도 아무것도 하지 않았다.
 */
export type StageTimes = {
  humanReadyAtMs: number | null
  personaMatchAtMs: number | null
  publishAtMs: number | null
  candidateAtMs: number | null
}

export function latestMs(xs: readonly (Date | null)[]): number | null {
  const ms = xs.filter((d): d is Date => d !== null).map((d) => d.getTime())
  return ms.length === 0 ? null : Math.max(...ms)
}

/**
 * 🔴 **발행 시각은 Post 의 것이다.**
 *
 *    타입만으로는 못 막는다 — 큐 행으로 `{ postId, createdAt }` 를 지어내면 모양이 같다.
 *    그래서 **큐가 실제로 가리키는 Post id 집합**을 함께 받아, 그 밖의 시각은 버린다.
 *    큐 행 id 는 그 집합에 없으므로 지어낸 시각은 한 건도 남지 않는다.
 */
export type PostTime = { postId: string; createdAt: Date }

export function stageTimesOf(input: {
  /** 사람이 결정한 시각들 */
  decidedAts: readonly (Date | null)[]
  /** Persona 를 배정한 시각들 */
  matchedAts: readonly (Date | null)[]
  /** 🔴 **Post** 가 생긴 시각들 — 큐 행의 시각이 아니다 */
  postTimes: readonly PostTime[]
  /** 🔴 큐가 가리키는 Post id — **이 밖의 시각은 발행 시각이 아니다** */
  linkedPostIds: readonly string[]
  /** 큐에 적재된 시각들 */
  queueCreatedAts: readonly Date[]
}): StageTimes {
  const linked = new Set(input.linkedPostIds)
  const realPosts = input.postTimes.filter((p) => linked.has(p.postId))
  return {
    humanReadyAtMs: latestMs(input.decidedAts),
    personaMatchAtMs: latestMs(input.matchedAts),
    publishAtMs: latestMs(realPosts.map((p) => p.createdAt)),
    candidateAtMs: latestMs(input.queueCreatedAts),
  }
}

/**
 * 🔴 **작업 묶음·의미 검수는 자기 정본 파일이 답한다** (2026-09-21 7차 보정).
 *
 *    앞판은 judge/draft 파일의 **시각**을 빌려 이 두 칸의 상태를 말했다.
 *    그것은 "judge 가 돌았다" 는 근거이지 "묶음이 몇 건이었나" 도
 *    "검수가 몇 건 끝났나" 도 아니다. 파일이 없거나 깨졌을 때만 `unmeasured` 다.
 */
export type WorksetManifest = {
  kind: string
  version: string
  runId: string
  takenAt: string
  limit: number
  sourceIds: readonly string[]
}

export const WORKSET_KIND = 'supply-workset'

/** 🔴 모양이 아니면 읽지 않는다 — 깨진 파일을 0 으로 세지 않는다 */
export function readWorksetManifest(v: unknown): WorksetManifest | null {
  if (v === null || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.kind !== WORKSET_KIND) return null
  if (typeof o.runId !== 'string' || typeof o.takenAt !== 'string') return null
  if (!Array.isArray(o.sourceIds)) return null
  const ids = o.sourceIds.filter((x): x is string => typeof x === 'string')
  if (ids.length !== o.sourceIds.length) return null
  return {
    kind: o.kind, version: typeof o.version === 'string' ? o.version : '(모름)',
    runId: o.runId, takenAt: o.takenAt,
    limit: typeof o.limit === 'number' ? o.limit : ids.length,
    sourceIds: ids,
  }
}

/**
 * 🔴 **`review.semanticCompletion.complete === true` 만 완료다.**
 *    파일이 있다고 검수가 끝난 것이 아니고, 초안이 있다고 끝난 것도 아니다.
 */
export type SemanticTally = { total: number; complete: number; incomplete: number; unknown: number }

export function tallySemanticCompletion(artifacts: unknown): SemanticTally | null {
  if (!Array.isArray(artifacts)) return null
  const t: SemanticTally = { total: 0, complete: 0, incomplete: 0, unknown: 0 }
  for (const a of artifacts) {
    t.total += 1
    if (a === null || typeof a !== 'object') { t.unknown += 1; continue }
    const review = (a as Record<string, unknown>).review
    if (review === null || typeof review !== 'object') { t.unknown += 1; continue }
    const sc = (review as Record<string, unknown>).semanticCompletion
    if (sc === null || typeof sc !== 'object') { t.unknown += 1; continue }
    const complete = (sc as Record<string, unknown>).complete
    // 🔴 boolean 이 아니면 모른다 — true 로 읽지 않는다
    if (complete === true) t.complete += 1
    else if (complete === false) t.incomplete += 1
    else t.unknown += 1
  }
  return t
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
