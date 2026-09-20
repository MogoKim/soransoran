import { HARD_BLOCK, hardGate, holdBeforeAsking, type JudgeInput } from './micro-seed-auto-judge'
import { artifactRetryable } from './content-core/review'
import {
  sameGenerationContract, type ContractBase, type GenerationContract,
} from './content-core/pipeline'

/**
 * 공급 회차의 **작업 묶음** — 🔴 AI 를 부르기 전에 **코드가** 정한다 (2026-09-20)
 *
 * 🔴 **왜 생겼나 — 2026-09-20 canary 실측.**
 *    `adapt` 가 3일치 backlog 를 풀어 판정 대상이 609건이 됐고, `judge` 가 회차
 *    공동 상한 15회를 **전부** 써 버려 `draft` 는 **한 번도 불리지 못했다.**
 *    $0.029949 를 쓰고 후보는 0건이었다.
 *
 * 🔴 **원인은 상한 값이 아니라 구조였다.** 판정에는 원천 수 제한이 없어서,
 *    상한을 40 으로 올려도 판정이 40 을 쓰고 생성은 여전히 0 이다.
 *    backlog 전체를 미리 판정해 비우는 것도 답이 아니다 — 매번 되풀이된다.
 *
 * 🔴 그래서 **세로로 자른다.** adapt 뒤에 N 건을 고르고, 그 N 건만
 *    판정 → 생성 → 적재까지 끝까지 보낸다. 고르지 않은 것은 **그대로 남는다** —
 *    지우지도, 판정하지도, 완료로 적지도 않는다. 다음 회차가 다시 집는다.
 *
 * 🔴 **새 점수 체계를 만들지 않는다.** 지금 있는 반응 신호(댓글 수)와 시각만 쓴다.
 *    AI 점수 호출도, 낱말 사전도 없다.
 */

/** 🔴 manifest 판 — 모양이 바뀌면 올린다. 옛 파일을 새 판으로 읽지 않는다 */
export const WORKSET_KIND = 'supply-workset'
export const WORKSET_VERSION = 'workset-v1'

/** 🔴 회차 파일 이름 — 러너와 검사가 **같은 함수**를 쓴다 */
export const worksetFileName = (runId: string): string => `supply-workset-${runId}.json`

/**
 * 🔴 **단계마다 원천 하나에 몇 번까지 허용하는가.**
 *    `judge` 는 의미 판정 1회, 생성은 Content Core 세 단계(`V2_CALL_CAP`)다.
 *    🔴 이 값들의 합이 `TOTAL_PER_SOURCE` 를 넘으면 실행 전에 거부한다 —
 *       합이 전체보다 크면 어느 단계든 남의 몫을 먹을 수 있다는 뜻이다.
 */
export const WORKSET_STAGE_PER_SOURCE = Object.freeze({ judge: 1, draft: 3 } as const)
export type WorksetStage = keyof typeof WORKSET_STAGE_PER_SOURCE
export const WORKSET_TOTAL_PER_SOURCE = 4

/** 기본 묶음 크기 — 🔴 `--workset-limit` 이 없으면 이 값이다 */
export const WORKSET_DEFAULT_LIMIT = 5

/**
 * 🔴 고를 후보 한 줄. `input` 은 **판정기와 같은 정규화**를 지난 값이다 —
 *    `mergeJudgeRows` 가 만든 것을 그대로 받는다. 여기서 다시 파싱하지 않는다.
 */
export type WorksetRow = {
  sourceArticleId: string
  sourceSite: string
  /** 지금 있는 반응 신호 — 🔴 새로 만들지 않는다 */
  commentCount: number
  /** 원문이 올라온 시각 · 목록에서 본 시각 (없으면 빈 문자열) */
  sourcePostedAt: string
  sourceListedAt: string
  /** 🔴 정본 게이트에 그대로 넘길 판정 입력 */
  input: JudgeInput
}

export const WORKSET_DROPS = [
  'humanDecided', 'queueSibling', 'hardBlocked', 'preGated', 'terminal',
] as const
export type WorksetDrop = (typeof WORKSET_DROPS)[number]

export const WORKSET_DROP_LABEL: Readonly<Record<WorksetDrop, string>> = {
  humanDecided: '사람이 이미 판정한 원천',
  queueSibling: '같은 원문의 미발행 형제가 큐에 있다',
  hardBlocked: 'deterministic hard block',
  preGated: '접근·안전 조건을 충족하지 않는다',
  terminal: '앞 회차가 이미 끝낸 원천 (HOLD·DROP·생성 hard HOLD)',
}

export type Workset = {
  kind: typeof WORKSET_KIND
  version: typeof WORKSET_VERSION
  runId: string
  takenAt: string
  limit: number
  /** 🔴 이번 회차가 끝까지 보낼 원천 — 이 목록이 계약이다 */
  sourceIds: string[]
}

export type WorksetPlan = {
  workset: Workset
  picked: WorksetRow[]
  /** 고르지 않은 이유별 수 — 🔴 사람이 "왜 5건뿐인가" 를 볼 수 있게 */
  dropped: Record<WorksetDrop, number>
  /** 조건은 맞지만 이번 묶음에 못 들어간 것 — 🔴 **그대로 남는다** */
  deferred: number
}

/**
 * 🔴 **한 원천의 지난 결과 하나.** 판정이든 생성이든 같은 모양으로 본다 —
 *    두 벌로 두면 "어느 쪽이 최신인가" 를 비교할 수 없다.
 */
export const OUTCOME_STATES = ['seeded', 'terminal', 'retryable', 'candidate', 'unknown'] as const
export type OutcomeState = (typeof OUTCOME_STATES)[number]

/** 🔴 단계 순위 — **같은 시각이면 생성이 판정보다 뒤다** */
export const STAGE_RANK = Object.freeze({ judge: 0, draft: 1 } as const)
export type OutcomeStage = keyof typeof STAGE_RANK

export type PriorOutcome = {
  sourceArticleId: string
  /**
   * 🔴 **명시 시각.** 판정은 `decidedAt`, 생성은 `generatedAt` 이다.
   *    🔴 파일 이름을 쓰지 않는다 — `auto-draft-20260920…` 이 문자열로는
   *    `auto-judge-20260907…` 보다 **앞선다**. 13일 뒤 결과가 옛것으로 밀렸다(실측).
   */
  at: string
  stage: OutcomeStage
  state: OutcomeState
}

export type WorksetCanon = {
  ruleVersion: string
  promptVersion: string
  judgeModel: string
}

/** 🔴 지난 판정 한 줄 — 파일에서 읽은 그대로 */
export type PriorJudgementRow = {
  sourceArticleId: string
  inputHash: string
  ruleVersion: string
  promptVersion: string
  model: string
  decision: string
  semanticStatus: string
  decidedAt: string
}

/** 🔴 지난 artifact 한 장 — 파일에서 읽은 그대로 */
export type PriorArtifactRow = {
  sourceArticleId: string
  artifactVersion: string
  contract: GenerationContract | null
  outcome: string
  retryable: boolean
  generatedAt: string
}

const AUTO_DECISIONS = ['AUTO_SEED', 'AUTO_HOLD', 'AUTO_DROP'] as const
const MACHINE_OUTCOMES = ['adopt', 'hold', 'drop'] as const
const SEMANTIC_OK = 'ok'

/**
 * 🔴 **지난 판정 한 줄을 상태로 바꾼다.** 지금 입력·지금 judge 계약이 아니면 `null` —
 *    이 원천에 대한 결론이 아니다.
 */
export function judgementOutcome(
  j: PriorJudgementRow, currentInputHash: string, canon: WorksetCanon,
): PriorOutcome | null {
  const id = S(j.sourceArticleId)
  if (id === '' || S(j.decidedAt) === '') return null
  if (S(j.inputHash) !== currentInputHash) return null
  if (S(j.ruleVersion) !== canon.ruleVersion) return null
  if (S(j.promptVersion) !== canon.promptVersion) return null
  if (S(j.model) !== canon.judgeModel) return null
  const status = S(j.semanticStatus)
  const decision = S(j.decision)
  const state: OutcomeState =
    // 🔴 모르는 값은 결론이 아니다 — 영구 제외하지 않는다
    !(AUTO_DECISIONS as readonly string[]).includes(decision) ? 'unknown'
      : status !== SEMANTIC_OK ? 'retryable'
        : decision === 'AUTO_SEED' ? 'seeded' : 'terminal'
  return { sourceArticleId: id, at: S(j.decidedAt), stage: 'judge', state }
}

/**
 * 🔴 **지난 artifact 한 장을 상태로 바꾼다.** 스키마 판과 **생성 계약**이 둘 다
 *    지금과 같아야 한다 — `artifactVersion` 하나로는 프롬프트·모델·자산 판이 바뀐 것을 못 본다.
 */
export function artifactOutcome(
  a: PriorArtifactRow, currentContract: GenerationContract, artifactVersion: string,
): PriorOutcome | null {
  const id = S(a.sourceArticleId)
  if (id === '' || S(a.generatedAt) === '') return null
  if (S(a.artifactVersion) !== artifactVersion) return null
  if (!sameGenerationContract(a.contract, currentContract)) return null
  const outcome = S(a.outcome)
  const state: OutcomeState =
    !(MACHINE_OUTCOMES as readonly string[]).includes(outcome) ? 'unknown'
      : a.retryable ? 'retryable'
        : outcome === 'adopt' ? 'candidate' : 'terminal'
  return { sourceArticleId: id, at: S(a.generatedAt), stage: 'draft', state }
}

/**
 * 🔴 **판정 파일 한 줄을 그대로 상태로.** 러너와 검사가 **같은 함수**를 쓴다 —
 *    읽는 코드를 두 벌로 두면 검사가 구현을 흉내 내는 것으로 끝난다.
 *    🔴 지금 회차 대상이 아닌 원천(`hashOf` 에 없는 id)은 `null` 이다.
 */
export function shadowRecordOutcome(
  raw: Record<string, unknown>, hashOf: ReadonlyMap<string, string>, canon: WorksetCanon,
): PriorOutcome | null {
  const hash = hashOf.get(S(raw.sourceArticleId))
  if (hash === undefined) return null
  return judgementOutcome({
    sourceArticleId: S(raw.sourceArticleId), inputHash: S(raw.inputHash),
    ruleVersion: S(raw.ruleVersion), promptVersion: S(raw.promptVersion), model: S(raw.model),
    decision: S(raw.decision), semanticStatus: S(raw.semanticStatus),
    decidedAt: S(raw.decidedAt),
  }, hash, canon)
}

/** 🔴 **artifact 한 장을 그대로 상태로.** 위와 같은 이유로 여기 하나만 둔다 */
export function artifactRecordOutcome(
  raw: Record<string, unknown>, hashOf: ReadonlyMap<string, string>,
  base: ContractBase, artifactVersion: string,
): PriorOutcome | null {
  const hash = hashOf.get(S(raw.sourceArticleId))
  if (hash === undefined) return null
  const review = (raw.review ?? {}) as Record<string, unknown>
  const c = raw.contract
  return artifactOutcome({
    sourceArticleId: S(raw.sourceArticleId), artifactVersion: S(raw.artifactVersion),
    // 🔴 계약 칸이 없는 옛 artifact 는 `null` — 지금 계약과 같을 수 없다
    contract: typeof c === 'object' && c !== null ? c as GenerationContract : null,
    outcome: S(review.machineOutcome), retryable: artifactRetryable(review),
    generatedAt: S(raw.generatedAt),
  }, { ...base, sourceInputHash: hash }, artifactVersion)
}

/** 🔴 원천마다 **가장 최신** 하나 — 시각이 같으면 단계 순위로 가른다 */
export function latestOutcomes(rows: readonly PriorOutcome[]): Map<string, PriorOutcome> {
  const out = new Map<string, PriorOutcome>()
  for (const r of rows) {
    const cur = out.get(r.sourceArticleId)
    if (cur === undefined) { out.set(r.sourceArticleId, r); continue }
    const newer = r.at > cur.at
      || (r.at === cur.at && STAGE_RANK[r.stage] >= STAGE_RANK[cur.stage])
    if (newer) out.set(r.sourceArticleId, r)
  }
  return out
}

/**
 * 🔴 **다음 회차에서 뺄 원천.** 최신 상태가 `terminal` 인 것만이다.
 *
 *    `retryable` · `unknown` 은 다시 본다 — 결론이 아니라 못 물어본 것이다.
 *    `candidate` 는 큐 형제로 걸린다 — 여기서 빼면 적재가 실패한 회차를 되살릴 수 없다.
 */
export function terminalSourceIds(rows: readonly PriorOutcome[]): Set<string> {
  const out = new Set<string>()
  for (const [id, v] of latestOutcomes(rows)) if (v.state === 'terminal') out.add(id)
  return out
}

/**
 * 🔴 **지금 계약으로 이미 한 번 돌려 본 원천.** 결론이 나지 않았어도(재시도·모름·
 *    채택했지만 적재까지 못 간 것) **다시 볼 수는 있다** — 그래서 빼지 않는다.
 *
 * 🔴 대신 **뒤로 보낸다.** 안 그러면 댓글 수 상위에 있는 이 원천들이 회차마다
 *    같은 자리를 차지해 한 번도 안 본 backlog 가 영영 올라오지 못한다.
 */
export function attemptedSourceIds(rows: readonly PriorOutcome[]): Set<string> {
  return new Set(latestOutcomes(rows).keys())
}

/** 🔴 `#` 뒤 조각을 뗀 원문 id — 큐 형제 판정은 이 값으로 한다 */
export const baseIdOf = (id: string): string => id.split('#')[0] ?? id

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const N = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** 시각 하나로 — 🔴 둘 다 없으면 빈 문자열이고, 정렬에서 맨 뒤로 간다 */
const timeKeyOf = (r: WorksetRow): string =>
  r.sourcePostedAt !== '' ? r.sourcePostedAt : r.sourceListedAt

/**
 * 🔴 **묶음을 고른다.** AI 를 부르기 전에 끝난다 — 이 함수는 순수하다.
 *
 * 🔴 순서: **안 본 것 먼저** → 댓글 수 많은 순 → 시각 최신 순 → id 오름차순(안정).
 *    같은 입력이면 같은 결과다. 사람이 대조할 수 있어야 한다.
 */
export function selectWorkset(input: {
  /** post-adapt 상세 행 — 🔴 같은 id 가 여러 번 오면 **뒤에 온 것**이 최신이다 */
  rows: readonly WorksetRow[]
  /** 사람이 이미 판정한 원천 */
  humanDecided: ReadonlySet<string>
  /** 큐에 미발행 형제가 있는 원문 (base id) */
  queuePending: ReadonlySet<string>
  /**
   * 🔴 **앞 회차가 이미 끝낸 원천.** 이것이 없으면 terminal HOLD/DROP 이 댓글 수
   *    상위 자리를 영구 점유해 다음 회차가 같은 것만 보게 된다 —
   *    회차 간 진행이 멈춘다 (2026-09-20 검토에서 잡힌 결함).
   *    🔴 **재시도해야 하는 것은 여기 넣지 않는다** (예산·상한에 막힌 것 등).
   */
  terminal: ReadonlySet<string>
  /**
   * 🔴 **지금 계약으로 이미 돌려 본 원천** (`attemptedSourceIds`). 빼지 않고 **뒤로** 보낸다 —
   *    한 번도 안 본 원천이 먼저다. 이것이 회차 간 진행을 보장한다.
   */
  attempted: ReadonlySet<string>
  limit: number
  runId: string
  takenAt: Date
}): WorksetPlan {
  const dropped: Record<WorksetDrop, number> = {
    humanDecided: 0, queueSibling: 0, hardBlocked: 0, preGated: 0, terminal: 0,
  }
  // 🔴 같은 원천이 여러 파일에 있으면 **마지막 행**만 남긴다
  const byId = new Map<string, WorksetRow>()
  for (const r of input.rows) {
    const id = S(r.sourceArticleId)
    if (id === '') continue
    byId.set(id, { ...r, sourceArticleId: id })
  }

  const eligible: WorksetRow[] = []
  for (const r of byId.values()) {
    if (input.humanDecided.has(r.sourceArticleId)) { dropped.humanDecided += 1; continue }
    if (input.queuePending.has(baseIdOf(r.sourceArticleId))) { dropped.queueSibling += 1; continue }
    if (input.terminal.has(r.sourceArticleId)) { dropped.terminal += 1; continue }
    /**
     * 🔴 **판정기 정본 게이트를 그대로 부른다** — 여기서 규칙을 새로 만들지 않는다.
     *    `access`·`safety` 를 손으로 비교하던 앞판은 판정기와 어긋날 수 있었다.
     */
    if (hardGate(r.input).some((c) => (HARD_BLOCK as readonly string[]).includes(c))) {
      dropped.hardBlocked += 1; continue
    }
    /**
     * 🔴 **물어봐도 HOLD 인 것은 묶음에 넣지 않는다.** 판정기가 모델 답을 받고
     *    나서 보던 사유를 `holdBeforeAsking` 하나로 모았다 — 같은 함수를 부른다.
     */
    if (holdBeforeAsking(r.input).length > 0) { dropped.preGated += 1; continue }
    eligible.push(r)
  }

  const tried = (r: WorksetRow): number => (input.attempted.has(r.sourceArticleId) ? 1 : 0)
  eligible.sort((a, b) =>
    // 🔴 한 번도 안 본 원천이 먼저다 — 결론 안 난 것이 상위 자리를 되풀이 점유하지 못한다
    tried(a) - tried(b)
    || N(b.commentCount) - N(a.commentCount)
    || timeKeyOf(b).localeCompare(timeKeyOf(a))
    || a.sourceArticleId.localeCompare(b.sourceArticleId))

  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 0
  const picked = eligible.slice(0, limit)
  return {
    workset: {
      kind: WORKSET_KIND, version: WORKSET_VERSION,
      runId: input.runId, takenAt: input.takenAt.toISOString(), limit,
      sourceIds: picked.map((r) => r.sourceArticleId),
    },
    picked,
    dropped,
    // 🔴 조건은 맞는데 이번에 못 들어간 것 — 다음 회차가 집는다
    deferred: Math.max(0, eligible.length - picked.length),
  }
}

export type WorksetFail = 'MISSING' | 'PARSE' | 'KIND' | 'VERSION' | 'RUN_MISMATCH' | 'SHAPE' | 'OVER_LIMIT'
export type WorksetRead =
  | { ok: true; sourceIds: ReadonlySet<string>; limit: number }
  | { ok: false; code: WorksetFail; reason: string }

/**
 * 🔴 **fail-closed.** 하나라도 어긋나면 `ok: false` 다 —
 *    "못 읽었으니 전부 판정한다" 로 두면 이 배선이 있으나 마나가 된다.
 */
export function readWorkset(raw: unknown, expectRunId: string): WorksetRead {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, code: 'PARSE', reason: 'JSON 객체가 아니다' }
  }
  const o = raw as Record<string, unknown>
  if (o.kind !== WORKSET_KIND) return { ok: false, code: 'KIND', reason: `다른 파일이다 (${String(o.kind)})` }
  if (o.version !== WORKSET_VERSION) {
    return { ok: false, code: 'VERSION', reason: `옛 판이다 (${String(o.version)})` }
  }
  if (S(o.runId) !== expectRunId) {
    return { ok: false, code: 'RUN_MISMATCH', reason: `다른 회차 파일이다 (${S(o.runId)} ≠ ${expectRunId})` }
  }
  const limit = typeof o.limit === 'number' && Number.isInteger(o.limit) && o.limit > 0 ? o.limit : -1
  if (limit < 0) return { ok: false, code: 'SHAPE', reason: 'limit 이 양의 정수가 아니다' }
  if (!Array.isArray(o.sourceIds)) return { ok: false, code: 'SHAPE', reason: 'sourceIds 가 배열이 아니다' }
  const ids = o.sourceIds.map(S).filter((x) => x !== '')
  if (ids.length !== o.sourceIds.length) return { ok: false, code: 'SHAPE', reason: '빈 id 가 섞여 있다' }
  // 🔴 파일이 상한을 넘겨 적혀 있으면 받지 않는다 — 여기서 새는 것이 가장 위험하다
  if (ids.length > limit) {
    return { ok: false, code: 'OVER_LIMIT', reason: `${ids.length}건 > 상한 ${limit}건` }
  }
  return { ok: true, sourceIds: new Set(ids), limit }
}

export type StageBudget = {
  ok: true
  /** 단계별 요청 상한 — 🔴 각 단계가 **자기 몫만** 쓴다 */
  perStage: Readonly<Record<WorksetStage, number>>
  total: number
}
export type StageBudgetFail = { ok: false; reason: string }

/**
 * 🔴 **단계별 상한을 나눈다.** 한 회차 상한을 두 단계가 나눠 쓰면,
 *    먼저 오는 쪽이 전부 가져가고 뒤 단계가 굶는다 — 2026-09-20 canary 가 그 모양이었다.
 *
 * 🔴 합이 전체를 넘으면 **실행 전에 거부**한다. 넘는다는 것은 어느 단계든
 *    남의 몫을 먹을 수 있다는 뜻이고, 그러면 나눈 의미가 없다.
 */
export function judgeStageBudget(limit: number): StageBudget | StageBudgetFail {
  if (!Number.isInteger(limit) || limit <= 0) {
    return { ok: false, reason: `workset 상한이 양의 정수가 아니다 (${String(limit)})` }
  }
  const perStage = {
    judge: limit * WORKSET_STAGE_PER_SOURCE.judge,
    draft: limit * WORKSET_STAGE_PER_SOURCE.draft,
  } as const
  const total = limit * WORKSET_TOTAL_PER_SOURCE
  const sum = perStage.judge + perStage.draft
  if (sum > total) {
    return { ok: false, reason: `단계별 상한 합 ${sum}회 > 회차 전체 상한 ${total}회 — 실행하지 않는다` }
  }
  return { ok: true, perStage, total }
}
