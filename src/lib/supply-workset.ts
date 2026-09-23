import {
  AUTO_DECISIONS, HARD_BLOCK, hardGate, holdBeforeAsking,
  type AutoDecision, type JudgeInput,
} from './micro-seed-auto-judge'
import {
  artifactRetryable, MACHINE_OUTCOMES, type IncompleteCause,
} from './content-core/review'
import {
  readGenerationContract, sameGenerationContract,
  type ContractBase, type GenerationContract,
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
 *
 * `seeded`    판정이 통과시켰다 — 생성으로 간다
 * `terminal`  이 원천은 끝났다 — 다음 회차에서 뺀다
 * `rawLane`   판정이 **다른 레인(원문 그대로)** 으로 보냈다 — 이 생성 레인에서는 끝이다
 * `retryable` 못 물어봤거나 못 끝냈다 — 다시 본다
 * `candidate` 초안이 나왔다 — 적재되면 큐 형제로 걸린다
 * `unknown`   읽지 못했다 — 결론이 아니다. 영구 제외하지 않는다
 */
export const OUTCOME_STATES = [
  'seeded', 'terminal', 'rawLane', 'retryable', 'candidate', 'unknown',
] as const
export type OutcomeState = (typeof OUTCOME_STATES)[number]

/**
 * 🔴 **이 생성 레인에서 끝난 상태.** 다음 회차 선택에서 뺀다 —
 *    `terminal` 은 결론이고, `rawLane` 은 애초에 이 레인의 일이 아니다.
 */
export const CONCLUDED_STATES = ['terminal', 'rawLane'] as const satisfies readonly OutcomeState[]

/** 🔴 단계 순위 — **같은 시각이면 생성이 판정보다 뒤다** */
export const STAGE_RANK = Object.freeze({ judge: 0, draft: 1 } as const)
export type OutcomeStage = keyof typeof STAGE_RANK

export type PriorOutcome = {
  sourceArticleId: string
  /**
   * 🔴 **이번에 실패한 화자** (2026-09-23). 다음 시도에서 그 사람을 다시 고르지 않는다.
   *    `null` 이면 화자와 무관한 실패다(예산·파싱).
   */
  failedPersonaCode?: string | null
  /**
   * 🔴 **실패한 자리도 나른다** (2026-09-23 마스터 지적). 사람만 빼면 다음 계획기가
   *    **같은 1인칭 계획**을 또 세운다 — 자리를 바꿔야 하는 실패가 있다.
   */
  failedStance?: string | null
  /** 🔴 왜 실패했나 — 코드로 분기한다. 문자열을 파싱하지 않는다 */
  failedCause?: string | null
  /**
   * 🔴 **명시 시각을 epoch 로 바꾼 값.** 판정은 `decidedAt`, 생성은 `generatedAt` 이다.
   *
   *    🔴 파일 이름을 쓰지 않는다 — `auto-draft-20260920…` 이 문자열로는
   *    `auto-judge-20260907…` 보다 **앞선다**. 13일 뒤 결과가 옛것으로 밀렸다(실측).
   *    🔴 문자열끼리 견주지도 않는다 — `…T00:00:00.000Z` 와 `…T09:00:00+09:00` 은
   *    같은 순간인데 글자로는 다르다.
   */
  atMs: number
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
  /** 🔴 `null` 은 **모양을 읽지 못했다** 는 뜻이다 — 재시도도 결론도 아니다 */
  retryable: boolean | null
  generatedAt: string
  /** 🔴 그 회차가 고른 화자 — 다음 시도에서 제외하려면 필요하다 (2026-09-23) */
  personaCode?: string
  /** 🔴 그 회차가 고른 자리 — 자리를 바꿔야 하는 실패가 있다 */
  stance?: string
  /** 🔴 실패 사유 코드 */
  cause?: string
}

const SEMANTIC_OK = 'ok'

/** 🔴 있을 법한 회차 시각의 범위 — 벗어나면 기록으로 세지 않는다 */
const AT_MIN_MS = Date.UTC(2000, 0, 1)
const AT_MAX_MS = Date.UTC(2100, 0, 1)

/**
 * 🔴 **엄격한 ISO 시각만 받는다.** `not-a-time` · `2026-02-31` · 시간대 없는 값은
 *    전부 `null` 이다 — `Date.parse` 는 이런 것을 관대하게 받아 주어서,
 *    잘못된 시각 하나가 원천을 영구 제외하는 결론으로 굳었다(2026-09-20 실측).
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export function parseInstantMs(raw: unknown): number | null {
  const v = S(raw)
  if (!ISO_INSTANT.test(v)) return null
  const ms = Date.parse(v)
  if (!Number.isFinite(ms)) return null
  // 🔴 `2026-02-31` 은 정규식을 통과한다 — 날짜를 되돌려 적어 보고 같은지 본다
  const [y, mo, d] = v.slice(0, 10).split('-').map(Number) as [number, number, number]
  const roundTrip = new Date(Date.UTC(y, mo - 1, d))
  if (roundTrip.getUTCMonth() !== mo - 1 || roundTrip.getUTCDate() !== d) return null
  if (ms < AT_MIN_MS || ms >= AT_MAX_MS) return null
  return ms
}

/**
 * 🔴 **판정 결과 네 가지를 빠짐없이 처리한다.** 정본 목록(`AUTO_DECISIONS`)을
 *    그대로 쓰고 `switch` 로 받는다 — 정본에 다섯 번째가 생기면 **컴파일이 깨진다**.
 *    앞판은 목록을 여기서 다시 적으면서 `AUTO_RAW` 를 빠뜨렸고, 그래서 정상 판정이
 *    `unknown` 으로 새어 회차마다 다시 올라왔다(2026-09-20 실측).
 */
function seededState(decision: AutoDecision): OutcomeState {
  switch (decision) {
    case 'AUTO_SEED': return 'seeded'
    // 🔴 원문 그대로 레인으로 갔다 — Content Core 생성 대상이 아니다. 여기서 끝이다
    case 'AUTO_RAW': return 'rawLane'
    case 'AUTO_HOLD': return 'terminal'
    case 'AUTO_DROP': return 'terminal'
    default: {
      const never: never = decision
      return never
    }
  }
}

/**
 * 🔴 **지난 판정 한 줄을 상태로 바꾼다.** 지금 입력·지금 judge 계약이 아니면 `null` —
 *    이 원천에 대한 결론이 아니다.
 */
export function judgementOutcome(
  j: PriorJudgementRow, currentInputHash: string, canon: WorksetCanon,
): PriorOutcome | null {
  const id = S(j.sourceArticleId)
  const atMs = parseInstantMs(j.decidedAt)
  if (id === '' || atMs === null) return null
  if (S(j.inputHash) !== currentInputHash) return null
  if (S(j.ruleVersion) !== canon.ruleVersion) return null
  if (S(j.promptVersion) !== canon.promptVersion) return null
  if (S(j.model) !== canon.judgeModel) return null
  const decision = S(j.decision)
  const known = (AUTO_DECISIONS as readonly string[]).includes(decision)
  const state: OutcomeState =
    // 🔴 모르는 값은 결론이 아니다 — 영구 제외하지 않는다
    !known ? 'unknown'
      // 🔴 못 물어본 것은 결론이 아니다
      : S(j.semanticStatus) !== SEMANTIC_OK ? 'retryable'
        : seededState(decision as AutoDecision)
  return { sourceArticleId: id, atMs, stage: 'judge', state }
}

/**
 * 🔴 **지난 artifact 한 장을 상태로 바꾼다.** 스키마 판과 **생성 계약**이 둘 다
 *    지금과 같아야 한다 — `artifactVersion` 하나로는 프롬프트·모델·자산 판이 바뀐 것을 못 본다.
 */
export function artifactOutcome(
  a: PriorArtifactRow, currentContract: GenerationContract, artifactVersion: string,
): PriorOutcome | null {
  const id = S(a.sourceArticleId)
  const atMs = parseInstantMs(a.generatedAt)
  if (id === '' || atMs === null) return null
  if (S(a.artifactVersion) !== artifactVersion) return null
  if (!sameGenerationContract(a.contract, currentContract)) return null
  const outcome = S(a.outcome)
  const state: OutcomeState =
    // 🔴 모양을 읽지 못했으면(`retryable === null`) 결론이 아니다
    a.retryable === null || !(MACHINE_OUTCOMES as readonly string[]).includes(outcome) ? 'unknown'
      : a.retryable ? 'retryable'
        : outcome === 'adopt' ? 'candidate' : 'terminal'
  return {
    sourceArticleId: id, atMs, stage: 'draft', state,
    failedPersonaCode: state === 'retryable' ? (S(a.personaCode) || null) : null,
    failedStance: state === 'retryable' ? (S(a.stance) || null) : null,
    failedCause: state === 'retryable' ? (S(a.cause) || null) : null,
  }
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
/** 🔴 검수 완료 기록에서 실패 사유 코드만 꺼낸다 */
function readCause(review: unknown): unknown {
  if (review === null || typeof review !== 'object') return ''
  const c = (review as Record<string, unknown>).semanticCompletion
  if (c === null || typeof c !== 'object') return ''
  return (c as Record<string, unknown>).cause
}

export function artifactRecordOutcome(
  raw: Record<string, unknown>, hashOf: ReadonlyMap<string, string>,
  base: ContractBase, artifactVersion: string,
): PriorOutcome | null {
  const hash = hashOf.get(S(raw.sourceArticleId))
  if (hash === undefined) return null
  const review = raw.review
  return artifactOutcome({
    sourceArticleId: S(raw.sourceArticleId), artifactVersion: S(raw.artifactVersion),
    // 🔴 계약 칸이 하나라도 빠진 옛 artifact 는 `null` — 지금 계약과 같을 수 없다
    contract: readGenerationContract(raw.contract),
    outcome: S((review as Record<string, unknown> | undefined)?.machineOutcome),
    // 🔴 모양을 읽지 못하면 `null` 이고, 그러면 `unknown` 이다
    retryable: artifactRetryable(review),
    generatedAt: S(raw.generatedAt),
    /**
     * 🔴 **그 회차가 고른 화자와 실패 사유** (2026-09-23).
     *    다음 시도에서 같은 사람을 다시 고르지 않으려면 여기서 꺼내야 한다.
     */
    personaCode: S((raw.plan as Record<string, unknown> | undefined)?.personaCode),
    stance: S((raw.plan as Record<string, unknown> | undefined)?.stance),
    cause: S(readCause(review)),
  }, { ...base, sourceInputHash: hash }, artifactVersion)
}

/** 🔴 원천마다 **가장 최신** 하나 — 시각이 같으면 단계 순위로 가른다 */
export function latestOutcomes(rows: readonly PriorOutcome[]): Map<string, PriorOutcome> {
  const out = new Map<string, PriorOutcome>()
  for (const r of rows) {
    const cur = out.get(r.sourceArticleId)
    if (cur === undefined) { out.set(r.sourceArticleId, r); continue }
    const newer = r.atMs > cur.atMs
      || (r.atMs === cur.atMs && STAGE_RANK[r.stage] >= STAGE_RANK[cur.stage])
    if (newer) out.set(r.sourceArticleId, r)
  }
  return out
}

/**
 * 🔴 **다음 회차에서 뺄 원천.** 최신 상태가 이 레인에서 끝난 것만이다.
 *
 *    `retryable` · `unknown` 은 다시 본다 — 결론이 아니라 못 물어본 것이다.
 *    `candidate` 는 큐 형제로 걸린다 — 여기서 빼면 적재가 실패한 회차를 되살릴 수 없다.
 */
export function concludedSourceIds(rows: readonly PriorOutcome[]): Set<string> {
  const out = new Set<string>()
  for (const [id, v] of latestOutcomes(rows)) {
    if ((CONCLUDED_STATES as readonly OutcomeState[]).includes(v.state)) out.add(id)
  }
  return out
}

/**
 * 🔴 **지금 계약으로 이미 한 번 돌려 본 원천과 그 시각.** 결론이 나지 않았어도
 *    **다시 볼 수는 있다** — 그래서 빼지 않는다. 대신 자리를 나눠 쓴다.
 *
 * 🔴 `Set` 이 아니라 시각을 함께 준다 — **오래 기다린 것부터** 집어야
 *    신규가 계속 들어오는 상황에서도 유한 회차 안에 차례가 온다.
 */
export function attemptedOutcomes(rows: readonly PriorOutcome[]): Map<string, PriorOutcome> {
  return latestOutcomes(rows)
}

/** 🔴 `#` 뒤 조각을 뗀 원문 id — 큐 형제 판정은 이 값으로 한다 */
export const baseIdOf = (id: string): string => id.split('#')[0] ?? id

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const N = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** 시각 하나로 — 🔴 둘 다 없으면 빈 문자열이고, 정렬에서 맨 뒤로 간다 */
const timeKeyOf = (r: WorksetRow): string =>
  r.sourcePostedAt !== '' ? r.sourcePostedAt : r.sourceListedAt

/**
 * 🔴 **재시도 자리 하나는 남겨 둔다** (2026-09-20 보정).
 *
 *    "안 본 것 먼저" 만으로 정렬하면, 신규 원천이 회차마다 상한만큼 들어오는 한
 *    재시도 원천의 차례는 **영영 오지 않는다**(실측: 신규 5건 × 10회차, 0회 선택).
 *    그래서 상한 5 에서 신규는 최대 4, 재시도에 최소 1 을 남긴다.
 */
export const WORKSET_RETRY_RESERVE = 1

/**
 * 🔴 **상한이 1 이면 자리를 나눌 수 없다.** 그때는 **기다린 시간**이 정한다 —
 *    재시도 원천의 마지막 결과가 이만큼 지났으면 그 한 자리를 가져간다.
 *    회차가 갈수록 기다린 시간은 늘기만 하므로 차례는 유한 회차 안에 반드시 온다.
 *    🔴 지난 결과 시각과 `takenAt` 만으로 정해진다 — 따로 저장하는 상태가 없다.
 */
export const WORKSET_RETRY_STARVE_MS = 6 * 60 * 60 * 1000

/**
 * 🔴 **묶음을 고른다.** AI 를 부르기 전에 끝난다 — 이 함수는 순수하다.
 *
 * 🔴 자리를 둘로 나눈다: **한 번도 안 본 원천**과 **이미 본 원천(재시도)**.
 *    한쪽이 다른 쪽을 굶기지 않는 것이 이 함수의 계약이다.
 *
 * 🔴 같은 입력이면 같은 결과다. 사람이 대조할 수 있어야 한다.
 */
export function selectWorkset(input: {
  /** post-adapt 상세 행 — 🔴 같은 id 가 여러 번 오면 **뒤에 온 것**이 최신이다 */
  rows: readonly WorksetRow[]
  /** 사람이 이미 판정한 원천 */
  humanDecided: ReadonlySet<string>
  /** 큐에 미발행 형제가 있는 원문 (base id) */
  queuePending: ReadonlySet<string>
  /**
   * 🔴 **이 레인에서 끝난 원천** (`concludedSourceIds`). 이것이 없으면 HOLD/DROP 이
   *    댓글 수 상위 자리를 영구 점유해 다음 회차가 같은 것만 보게 된다.
   *    🔴 **재시도해야 하는 것은 여기 넣지 않는다** (예산·상한에 막힌 것 등).
   */
  concluded: ReadonlySet<string>
  /**
   * 🔴 **지금 계약으로 이미 돌려 본 원천과 그 마지막 시각** (`attemptedOutcomes`).
   *    빼지 않는다 — 자리를 나눠 쓰고, 그 안에서는 **오래 기다린 것부터** 집는다.
   */
  attempted: ReadonlyMap<string, PriorOutcome>
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
    if (input.concluded.has(r.sourceArticleId)) { dropped.terminal += 1; continue }
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

  /** 🔴 값이 같으면 순서도 같아야 한다 — 마지막 열쇠는 언제나 id 다 */
  const byWeight = (a: WorksetRow, b: WorksetRow): number =>
    N(b.commentCount) - N(a.commentCount)
    || timeKeyOf(b).localeCompare(timeKeyOf(a))
    || a.sourceArticleId.localeCompare(b.sourceArticleId)

  const fresh = eligible.filter((r) => !input.attempted.has(r.sourceArticleId)).sort(byWeight)
  const retry = eligible.filter((r) => input.attempted.has(r.sourceArticleId))
    // 🔴 **오래 기다린 것부터.** 그 다음은 신규와 같은 저울을 쓴다
    .sort((a, b) =>
      (input.attempted.get(a.sourceArticleId)?.atMs ?? 0)
      - (input.attempted.get(b.sourceArticleId)?.atMs ?? 0)
      || byWeight(a, b))

  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 0
  /**
   * 🔴 **재시도에 남길 자리.** 상한이 2 이상이면 한 자리를 늘 남기고,
   *    상한이 1 이면 **가장 오래 기다린 재시도**가 기준을 넘었을 때만 그 자리를 가져간다.
   */
  const waitedMs = retry.length === 0 ? 0
    : input.takenAt.getTime() - (input.attempted.get(retry[0]!.sourceArticleId)?.atMs ?? 0)
  const reserve = retry.length === 0 ? 0
    : limit >= WORKSET_RETRY_RESERVE + 1 ? WORKSET_RETRY_RESERVE
      : waitedMs >= WORKSET_RETRY_STARVE_MS ? limit : 0

  const freshPicked = fresh.slice(0, Math.max(0, limit - reserve))
  // 🔴 신규가 자리를 다 못 채우면 재시도가 남은 칸을 쓴다 — 자리를 비워 두지 않는다
  const retryPicked = retry.slice(0, Math.max(0, limit - freshPicked.length))
  const picked = [...freshPicked, ...retryPicked]

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
  | {
      ok: true
      sourceIds: ReadonlySet<string>
      limit: number
      /** 🔴 이 묶음을 집은 시각(ms) — 관제가 단계 상태를 이 값으로 판정한다 */
      takenAtMs: number
    }
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
  /**
   * 🔴 **`takenAt` 이 시각이 아니면 받지 않는다** (2026-09-21 보정).
   *
   *    이 값은 "이 묶음을 언제 집었나" 의 유일한 근거이고, 관제가 단계 상태를
   *    그 시각으로 판정한다. 읽을 수 없는 값이면 **묶음이 없는 것**으로 다뤄야지
   *    "시각만 모르는 정상 묶음" 으로 두면 안 된다 — 그러면 멎은 단계가 계속 초록이다.
   */
  const takenAtMs = parseInstantMs(o.takenAt)
  if (takenAtMs === null) {
    return { ok: false, code: 'SHAPE', reason: `takenAt 을 읽을 수 없다 (${String(o.takenAt)})` }
  }
  return { ok: true, sourceIds: new Set(ids), limit, takenAtMs }
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

// ─────────────────────────────────────────────────────────
// 🔴 **같은 사람으로 같은 실패를 되풀이하지 않는다** (2026-09-23)
//
//   앞판은 `retryable` 표시만 했다. 그러면 다음 회차가 **같은 Persona** 로 같은 글을
//   또 만들고 또 실패한다 — 유료 호출만 쓰고 끝난다.
// ─────────────────────────────────────────────────────────

/** 🔴 같은 원천·같은 계약에서 허용하는 최대 시도 수. 넘으면 결론이다 */
export const REPLAN_ATTEMPT_MAX = 3

/**
 * 🔴 **화자를 바꾸면 달라질 수 있는 실패만 화자 탓이다** (2026-09-23).
 *
 *    예산·응답 없음·파싱 실패는 **누구를 골랐든 똑같이** 났다. 그것으로 사람을
 *    제외하면 멀쩡한 화자가 하나씩 타서, 장애 한 번에 원천이 `EXHAUSTED` 로 굳는다.
 *    시도 수 상한도 같은 이유로 **이 사유들만** 센다.
 */
export const PERSONA_REPLAN_CAUSES = [
  'personaTransformFailed', 'loadBearingMismatch',
] as const satisfies readonly IncompleteCause[]

const personaAttributable = (cause: string | null | undefined): boolean =>
  (PERSONA_REPLAN_CAUSES as readonly string[]).includes((cause ?? '').trim())

export type ReplanPlan =
  | { ok: true; excluded: string[]; attempt: number }
  /** 🔴 더 시도하지 않는다 — 적격 경로가 없거나 상한을 넘었다 */
  | { ok: false; code: 'EXHAUSTED' | 'ATTEMPT_CAP'; reason: string; excluded: string[] }

/**
 * 🔴 **다음 시도에 누구를 뺄지 정한다.**
 *    · 화자 때문에 실패한 사람은 제외한다
 *    · 남은 적격자가 없으면 `EXHAUSTED` — 무한 반복하지 않는다
 *    · 시도 상한을 넘으면 `ATTEMPT_CAP`
 */
export function planReplan(input: {
  /** 같은 원천·같은 계약의 지난 시도들 (오래된 순) */
  attempts: ReadonlyArray<{
    failedPersonaCode?: string | null; failedStance?: string | null; failedCause?: string | null
  }>
  /** 지금 쓸 수 있는 화자 전체 */
  eligible: readonly string[]
  attemptMax?: number
}): ReplanPlan {
  const max = input.attemptMax ?? REPLAN_ATTEMPT_MAX
  /**
   * 🔴 **화자 탓인 실패만 센다.** 나머지는 재시도 표시로 이미 처리된다 —
   *    여기서 또 세면 예산 장애가 화자를 태운다.
   */
  const blamed = input.attempts.filter((a) => personaAttributable(a.failedCause))
  const excluded = [...new Set(
    blamed.map((a) => (a.failedPersonaCode ?? '').trim()).filter((c) => c !== ''),
  )]
  const attempt = blamed.length + 1
  if (blamed.length >= max) {
    return { ok: false, code: 'ATTEMPT_CAP', reason: `같은 계약에서 ${max}번 시도했다`, excluded }
  }
  const left = input.eligible.filter((c) => !excluded.includes(c))
  if (left.length === 0) {
    return {
      ok: false, code: 'EXHAUSTED',
      reason: `적격 화자 ${input.eligible.length}명이 모두 실패했다`, excluded,
    }
  }
  return { ok: true, excluded, attempt }
}
