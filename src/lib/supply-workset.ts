import {
  AUTO_DECISIONS, HARD_BLOCK, hardGate, holdBeforeAsking, RAW_AXIS,
  type AutoDecision, type JudgeInput,
} from './micro-seed-auto-judge'
import {
  artifactRetryable, MACHINE_OUTCOMES, type IncompleteCause,
} from './content-core/review'
import {
  readGenerationContract, sameGenerationContract,
  type ContractBase, type GenerationContract,
} from './content-core/pipeline'
/** 🔴 원래 원천 복원(`originalSourceOf`)은 synthetic 사이트 접두의 주인인 적재 모듈에 있다 — 옮겼을 뿐 두 벌이 아니다 */
import { originalSourceOf } from './micro-seed-supply-autofill'
export { originalSourceOf }
import { SUPPLY_WORKSET_PER_RUN } from './supply-schedule-contract'
/** 🔴 원천 identity 정본 — (sourceSite, sourceArticleId). 여기서 다시 내보낸다(옮겼을 뿐 두 벌이 아니다) */
import { baseIdOf, sourceIdentityOf, sourceKeyOf, sourceOfKey } from './source-identity'
export { baseIdOf, sourceIdentityOf, sourceKeyOf, sourceOfKey }
/** 🔴 원천 기회 판정 정본 — 유료 생성 전에 예정 슬롯 기준으로 같은 함수를 부른다 */
import {
  articleIdHashOf, compareReleaseRank, judgeSlotRelease, matchOpportunitiesToSlots, parseEvidence,
  type ReleaseRank, type SlotReleaseVerdict, type SourceEvidenceRecord,
} from './source-slot-release'
/** 🔴 갱년기 코어 언급 — 정본 `MENOPAUSE_RE` 하나(동률에서만 쓰는 선호 · 새 낱말 0) */
import { mentionsMenopause } from './original-post-persona-match'

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
 * 🔴 **새 점수 체계를 만들지 않는다.** 순서는 원천 기회 정본(`judgeSlotRelease`)의 rank 하나다 —
 *    원천 상대 반응 백분위 → 예정 슬롯 나이 → velocity(반복 관측이 있을 때만). AI 점수 호출도, 낱말 사전도 없다.
 * 🔴 **예정 슬롯에서 eligible 이 아닌 원천은 유료 생성에 들어가지 않는다** (2026-09-30 · source-slot-v1).
 *    앞판은 원시 댓글 수 순(`byWeight`)으로 골랐다 — 원천 규모 · 관측 나이 보정이 없고 나이 상한도 없었다(A1 ④).
 */

/** 🔴 manifest 판 — 모양이 바뀌면 올린다. 옛 파일을 새 판으로 읽지 않는다 */
export const WORKSET_KIND = 'supply-workset'
/**
 * 🔴 `workset-v2` (2026-09-30 야간 P0-B) — 묶음은 원문 id 목록(`sourceIds`)이 아니라 **(사이트, id) 쌍**(`sources`)이다.
 *    v1 은 같은 id 두 사이트를 구분하지 못했다. v1 파일은 판이 달라 읽지 않는다(fail-closed · 회차 안에서만 쓰는 파일이다).
 */
export const WORKSET_VERSION = 'workset-v2'
/**
 * 🔴 옛 판 — **개수만** 읽는다(관제 · 수율 창이 지난 7일 파일을 센다). 원천 열쇠는 없다(`sourceKeys: null`) —
 *    판정 러너는 열쇠가 없는 묶음으로 돌지 않는다(`micro-seed-auto-judge` 가 멈춘다).
 */
export const WORKSET_VERSION_LEGACY = 'workset-v1'

/** 🔴 회차 파일 이름 — 러너와 검사가 **같은 함수**를 쓴다 */
export const worksetFileName = (runId: string): string => `supply-workset-${runId}.json`

/** 🔴 JIT 공급 계약 · 의도 — 정본은 `supply-intent`(적재 모듈과 순환하지 않게 따로 둔다). 여기서 다시 내보낸다 */
import {
  SUPPLY_JIT_CONTRACT, WORKSET_VERSION_JIT, SUPPLY_INTENT_KEY, readSupplyIntent, type SupplyIntent,
} from './supply-intent'
export { SUPPLY_JIT_CONTRACT, WORKSET_VERSION_JIT, SUPPLY_INTENT_KEY, readSupplyIntent, type SupplyIntent }

/** 🔴 묶음 파일 이름 모양 — 회차 id 를 꺼낸다(수율 창을 세는 쪽이 쓴다) */
export const WORKSET_FILE_RE = /^supply-workset-(\d{8}-\d{6})\.json$/

// ─────────────────────────────────────────────────────────
// 🔴 원천 기회 스냅샷 — 초안이 아직 없는 slot-valid 원천 (2026-09-30)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 공급 러너가 회차마다 적는다 — **생성 전 판정(예정 슬롯 · 참여 동력 · 배정 대기)이 eligible 인 원천의 증거 기록**.
 *    다음 단계 preflight 가 "증명일 슬롯을 채울 기회가 있는가" 를 이 파일과 READY 로 센다.
 *    🔴 원문 제목 · 본문 · URL 없음 — `source-evidence-v1` 기록뿐이다(해시 · 시각 · 수).
 */
export const OPPORTUNITY_KIND = 'supply-opportunities'
export const OPPORTUNITY_VERSION = 'opportunities-v1'
export const opportunitiesFileName = (runId: string): string => `supply-opportunities-${runId}.json`
export const OPPORTUNITY_FILE_RE = /^supply-opportunities-\d{8}-\d{6}\.json$/

export type OpportunitySnapshot = {
  kind: typeof OPPORTUNITY_KIND
  version: typeof OPPORTUNITY_VERSION
  runId: string
  takenAt: string
  /** 예정 슬롯(판정 기준) */
  slotAt: string
  evidence: SourceEvidenceRecord[]
}

/** 🔴 모양이 틀리면 `null` — 부르는 쪽이 다음 파일을 본다(지어내지 않는다) */
export function readOpportunitySnapshot(raw: unknown): OpportunitySnapshot | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.kind !== OPPORTUNITY_KIND || r.version !== OPPORTUNITY_VERSION) return null
  if (typeof r.runId !== 'string' || typeof r.takenAt !== 'string' || !Number.isFinite(Date.parse(r.takenAt))) return null
  if (typeof r.slotAt !== 'string' || !Array.isArray(r.evidence)) return null
  const evidence: SourceEvidenceRecord[] = []
  for (const e of r.evidence) {
    const p = parseEvidence(e)
    if (p.ok) evidence.push(p.record)
  }
  return { kind: OPPORTUNITY_KIND, version: OPPORTUNITY_VERSION, runId: r.runId, takenAt: r.takenAt, slotAt: r.slotAt, evidence }
}

/**
 * 🔴 **단계마다 원천 하나에 몇 번까지 허용하는가.**
 *    `judge` 는 의미 판정 1회, 생성은 Content Core 세 단계(`V2_CALL_CAP`)다.
 *    🔴 이 값들의 합이 `TOTAL_PER_SOURCE` 를 넘으면 실행 전에 거부한다 —
 *       합이 전체보다 크면 어느 단계든 남의 몫을 먹을 수 있다는 뜻이다.
 */
export const WORKSET_STAGE_PER_SOURCE = Object.freeze({ judge: 1, draft: 3 } as const)
export type WorksetStage = keyof typeof WORKSET_STAGE_PER_SOURCE
export const WORKSET_TOTAL_PER_SOURCE = 4

/**
 * 기본 묶음 크기 — 🔴 `--workset-limit` 이 없으면 이 값이다.
 *
 * 🔴 **5 → 10** (2026-09-28 공급 가속 P0). 회차 요청 상한도 같이 움직인다 —
 *    judge 10 · draft 30 · 합 40 (`judgeStageBudget`). 계약 정본은 `SUPPLY_WORKSET_PER_RUN` 이고
 *    검사가 두 값이 같은지 본다.
 */
export const WORKSET_DEFAULT_LIMIT = 10

/**
 * 🔴 **묶음 크기 천장.** `--workset-limit` 으로도 이보다 크게 부를 수 없다 —
 *    `judgeStageBudget` 이 거부한다. 손으로 100 을 넣어 judge 100 · draft 300 이 나가는 길을 닫는다.
 */
export const WORKSET_MAX_LIMIT = SUPPLY_WORKSET_PER_RUN

/**
 * 🔴 `--workset-limit=N` 을 읽는다 — 러너와 검사가 **같은 함수**를 쓴다.
 *    없으면 기본값, 양의 정수가 아니거나 천장을 넘으면 `-1`(러너가 실행 전에 멈춘다).
 */
export function resolveWorksetLimit(argv: readonly string[]): number {
  const hit = argv.find((a) => a.startsWith('--workset-limit='))
  if (hit === undefined) return WORKSET_DEFAULT_LIMIT
  const raw = hit.slice('--workset-limit='.length)
  if (!/^\d+$/.test(raw)) return -1
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n > 0 && n <= WORKSET_MAX_LIMIT ? n : -1
}

/**
 * 🔴 고를 후보 한 줄. `input` 은 **판정기와 같은 정규화**를 지난 값이다 —
 *    `mergeJudgeRows` 가 만든 것을 그대로 받는다. 여기서 다시 파싱하지 않는다.
 */
export type WorksetRow = {
  sourceArticleId: string
  sourceSite: string
  /** 지금 있는 반응 신호 — 🔴 새로 만들지 않는다(화면 한 줄용) */
  commentCount: number
  /** 원문이 올라온 시각 · 목록에서 본 시각 (없으면 빈 문자열) */
  sourcePostedAt: string
  sourceListedAt: string
  /** 🔴 정본 게이트에 그대로 넘길 판정 입력 */
  input: JudgeInput
  /**
   * 🔴 **원천 증거 기록**(source-evidence-v1) — 러너가 상세 파일 · 목록 관측으로 만든다. 없으면 null(모름 → 고르지 않는다).
   */
  evidence: SourceEvidenceRecord | null
}

/**
 * 🔴 **생성 전 원천 기회 판정** — 정본 `judgeSlotRelease` 를 예정 슬롯(다음 열린 슬롯)으로 부른다.
 *    참여 동력 · 배정은 아직 없다(`pending`). 증거가 없으면 모른다(EVIDENCE_MISSING) — 고르지 않는다.
 */
export function preGenerationRelease(r: WorksetRow, slotAt: Date, now: Date): SlotReleaseVerdict {
  return judgeSlotRelease({
    evidence: r.evidence ?? undefined, gateResults: r.evidence === null ? {} : undefined,
    slotAt, now, hardGates: { ok: true, codes: [] },
    assignment: 'pending', driver: 'pending', tieBreak: sourceKeyOf(r.sourceSite, r.sourceArticleId),
  })
}

export const WORKSET_DROPS = [
  'identityMissing', 'humanDecided', 'queueSibling', 'alreadyQueued', 'carriedOver', 'hardBlocked', 'preGated', 'terminal',
  'slotIneligible', 'slotUnknown', 'slotUnassigned', 'rawNotAutoConsumed',
] as const
export type WorksetDrop = (typeof WORKSET_DROPS)[number]

export const WORKSET_DROP_LABEL: Readonly<Record<WorksetDrop, string>> = {
  identityMissing: '🔴 원천 사이트 · id 중 하나를 모른다 — 다른 원천과 합칠 수 없어 고르지 않는다',
  humanDecided: '사람이 이미 판정한 원천',
  queueSibling: '같은 원문의 미발행 형제가 큐에 있다',
  alreadyQueued: '같은 원문으로 이미 큐 행이나 글이 있다 (발행된 것 포함 — 두 번째 글을 만들지 않는다)',
  carriedOver: '적재에 실패한 앞 회차 후보가 이월로 적재된다 — 다시 만들지 않는다',
  hardBlocked: 'deterministic hard block',
  preGated: '접근·안전 조건을 충족하지 않는다',
  terminal: '앞 회차가 이미 끝낸 원천 (HOLD·DROP·생성 hard HOLD)',
  slotIneligible: '🔴 예정 슬롯에서 원천 가치가 없다 (원문 나이 ≥ 72h) — 유료 생성 0',
  slotUnknown: '🔴 원천 증거를 모른다 (게시 시각 · 반응 · 원천 상대 표본 없음) — 유료 생성 0',
  slotUnassigned: '🔴 부족 슬롯에 연결되지 않거나 이번 유료 상한 밖이다 — 유료 생성 0',
  rawNotAutoConsumed: '🔴 원문 그대로(raw) 축 — 자동 소비자가 없다(AUTO_RAW 는 사람 검토 레인으로만 간다) · 자동 유료 묶음 0',
}

export type Workset = {
  kind: typeof WORKSET_KIND
  version: typeof WORKSET_VERSION | typeof WORKSET_VERSION_JIT
  runId: string
  takenAt: string
  limit: number
  /**
   * 🔴 이번 회차가 끝까지 보낼 원천 — 이 목록이 계약이다. **(사이트, id) 쌍**으로 적는다 —
   *    원문 id 만으로는 원천이 아니다(`source-identity`). 파일에는 원래 두 칸을 각각 남긴다.
   */
  sources: { sourceSite: string; sourceArticleId: string; slotAt?: string; ageAtSlotH?: number }[]
  /**
   * 🔴 **JIT 계약 표식** (2026-10-04 P0-2 보정) — `workset-v3` 에만 있다. 그 판은 원천마다 `slotAt`(배정된 부족 슬롯)과
   *    `ageAtSlotH`(그 슬롯 시점 원문 나이 · 정본 판정 rank)를 **필수로** 적는다. 원문 · 작성자 없음.
   */
  contract?: typeof SUPPLY_JIT_CONTRACT
}

export type WorksetPlan = {
  workset: Workset
  picked: WorksetRow[]
  /** 고르지 않은 이유별 수 — 🔴 사람이 "왜 5건뿐인가" 를 볼 수 있게 */
  dropped: Record<WorksetDrop, number>
  /** 조건은 맞지만 이번 묶음에 못 들어간 것 — 🔴 **그대로 남는다** */
  deferred: number
  /** 🔴 JIT 선택 사실(`input.jit` 일 때만) — 채울 수 있는 최대 슬롯 · 실제로 덮은 슬롯 · 재시도 예약 */
  jit?: JitSelectionFacts
  /**
   * 🔴 **축별 수** (2026-09-28) — 적격 · 이번 자리(quota) · 실제로 고른 수.
   *    사람이 "왜 raw 가 1건뿐인가 · 왜 자리가 비었나" 를 로그에서 바로 본다.
   */
  axis: Readonly<Record<'eligible' | 'quota' | 'picked', Readonly<Record<WorksetAxis, number>>>>
}

// ─────────────────────────────────────────────────────────
// 🔴 **축별 자리** (2026-09-28)
//
//   생성 레인은 판정이 `AUTO_SEED` 를 준 원천만 읽는다(`micro-seed-auto-draft` 의 입력).
//   `rawOriginality` 축 원천은 판정이 `AUTO_RAW`(다른 레인) 이거나, 모델이 SEED 라고
//   답하면 정책이 `axisMismatch` HOLD 로 바꾼다 — **어느 쪽이든 이 레인에서 초안이 0 이다.**
//
//   실측(2026-09-21~27, 39회차 195자리): raw 85자리 → AUTO_RAW 23 · HOLD 62(그중 axisMismatch 61)
//   · 초안 0 · 채택 0. seed 110자리 → AUTO_SEED 90 · 초안 50 · 채택 33.
//   댓글 수만 보고 고르니 raw 가 43% 자리를 먹었고, 마지막 두 회차는 5자리 중 3자리가 raw 였다.
//
//   🔴 **raw 를 영구 제외하지 않는다.** raw 레인의 판정도 이 회차가 내는 결론이고,
//      제외하면 raw 원천은 영영 판정되지 않는다. 대신 **자리를 제한한다.**
// ─────────────────────────────────────────────────────────

/** 🔴 원천의 축 — 판정기 정본(`RAW_AXIS`) 하나로 가른다 */
export const WORKSET_AXES = ['seed', 'raw'] as const
export type WorksetAxis = (typeof WORKSET_AXES)[number]

/**
 * 🔴 **raw 한 자리당 묶음 크기.** 기본 상한 10 → raw 최대 2 · seed 최소 8 (seed 가 있으면).
 *    (상한 5 였을 때는 raw 최대 1 · seed 최소 4 — 같은 규칙이다)
 *
 *    다른 상한은 비례로 늘린다 — `floor(limit / 5)` 자리를 raw 에 **남기고**, 그만큼이 raw 의 상한이다.
 *      limit 5 → raw ≤1 (1 자리 보장)   limit 10 → raw ≤2 (2 자리 보장)   limit 7 → raw ≤1
 *    🔴 상한이 5 보다 작으면(1~4) raw 한 자리가 20% 를 넘는다. 그래서 **자리를 남기지 않고**,
 *       seed 가 채우지 못한 자리에만 raw 가 **최대 1** 건 들어온다 — 그래도 raw 가 판정 대상에서
 *       빠지지는 않는다.
 */
export const WORKSET_RAW_SLOT_EVERY = 5

/**
 * 🔴 **축 판정은 정본 값 하나로.** `rawOriginality` 만 raw 다.
 *    묶음에 들어오는 원천은 `holdBeforeAsking`(→ `preSemanticGate`)을 통과했으므로
 *    축이 `seedOriginality` 아니면 `rawOriginality` 둘 중 하나다 — 그 밖의 값은 여기 오지 않는다.
 */
export const worksetAxisOf = (r: WorksetRow): WorksetAxis =>
  S(r.input.axis) === RAW_AXIS ? 'raw' : 'seed'

export type WorksetAxisCaps = {
  /** raw 가 가질 수 있는 최대 자리 */
  rawCap: number
  /** raw 가 있으면 **seed 가 많아도** raw 에 남기는 자리 */
  rawReserve: number
}

/** 🔴 상한 → raw 자리. 러너 · 검사 · 재현이 **같은 함수**를 쓴다 */
export function worksetAxisCaps(limit: number): WorksetAxisCaps {
  const n = Number.isInteger(limit) && limit > 0 ? limit : 0
  if (n === 0) return { rawCap: 0, rawReserve: 0 }
  const share = Math.floor(n / WORKSET_RAW_SLOT_EVERY)
  return { rawCap: Math.max(1, share), rawReserve: share }
}

/**
 * 🔴 **이번 회차의 축별 자리.**
 *    ① raw 가 있으면 `rawReserve` 만큼 먼저 남긴다 (raw 영구 제외 금지)
 *    ② seed 는 나머지를 **전부** 쓸 수 있다
 *    ③ seed 가 모자라 빈 자리는 raw 가 `rawCap` 까지만 채운다 —
 *       🔴 **그 이상은 비워 둔다.** seed 가 없다고 묶음을 raw 로 채우면 초안 0 짜리 판정만 는다.
 */
export function worksetAxisQuota(
  limit: number, available: Readonly<Record<WorksetAxis, number>>,
): Record<WorksetAxis, number> {
  const n = Number.isInteger(limit) && limit > 0 ? limit : 0
  const caps = worksetAxisCaps(n)
  const reserved = Math.min(caps.rawReserve, available.raw)
  const seed = Math.min(available.seed, n - reserved)
  const raw = Math.min(caps.rawCap, available.raw, n - seed)
  return { seed, raw }
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
  /** 🔴 원천 열쇠(`sourceKeyOf`) — 지난 결과를 원천에 붙이는 **유일한** 열쇠다 */
  sourceKey: string
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
  /**
   * 🔴 **다음 회차가 반드시 써야 하는 후보** (2026-09-23 마스터 P0-3).
   *    비면 제한이 없다는 뜻이다 — "아무나" 가 아니라 "이번엔 제한이 없다" 다.
   */
  suggestedPersonaCodes?: readonly string[]
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
  /**
   * 🔴 **이 기록을 낸 파이프라인 회차** (2026-09-28 시계 역전 보정).
   *
   *    판정은 `decidedAt` 을 **벽시계**로 적고, 생성은 `generatedAt` 을 **회차 시각(RUN_AT)** 으로 적는다.
   *    그래서 같은 회차 안에서 판정이 생성보다 5~10초 **늦어** 보였다 — 판정 뒤에 돈 생성의
   *    terminal·candidate 가 `seeded` 에 가려져 재시도 풀에 남았다(운영 33원천, 20260924-051500 이후).
   *
   *    `atMs` 는 기록 자체의 시각 그대로 두고, **순서는 이 값으로** 정한다:
   *      · `atMs`  그 회차의 시각(RUN_AT). 같은 회차면 같은 값이다 → 단계 순서(판정 < 생성)가 가른다
   *      · `id`    회차 id — 사람이 대조하는 표지. 모르면 `null`
   *    🔴 없으면 기록 자체의 시각(`atMs`)이 곧 그 회차의 시각이다(손으로 부른 단독 실행).
   *    🔴 파일 이름에서 읽지 않는다 — 기록의 칸(`runId`·`runAt`)이나 회차 기록의 단계 구간에서만 온다.
   */
  run?: { id: string | null; atMs: number }
  stage: OutcomeStage
  state: OutcomeState
}

/** 🔴 순서를 정하는 시각 — 회차 시각이 있으면 그것, 없으면 기록 자체의 시각 */
export const runClockOf = (o: PriorOutcome): number => o.run?.atMs ?? o.atMs

/**
 * 🔴 **`r` 가 `cur` 보다 뒤인가.** 비교 규칙은 이 함수 하나다.
 *    ① 회차 시각이 다르면 뒤 회차가 이긴다 — 다음 회차의 판정은 앞 회차의 생성보다 뒤다
 *    ② 같은 회차(같은 회차 시각)면 **단계 순서** — 생성은 언제나 판정 뒤다. 벽시계를 보지 않는다
 *    ③ 같은 단계면 기록 시각, 그것도 같으면 뒤에 읽은 것
 */
export function isLaterOutcome(r: PriorOutcome, cur: PriorOutcome): boolean {
  const a = runClockOf(r)
  const b = runClockOf(cur)
  if (a !== b) return a > b
  if (r.stage !== cur.stage) return STAGE_RANK[r.stage] > STAGE_RANK[cur.stage]
  return r.atMs >= cur.atMs
}

export type WorksetCanon = {
  ruleVersion: string
  promptVersion: string
  judgeModel: string
}

/** 🔴 지난 판정 한 줄 — 파일에서 읽은 그대로 */
export type PriorJudgementRow = {
  /** 🔴 원천 사이트 — 이 판(P0-B) 전 판정 기록에는 없다 → `shadowRecordOutcome` 의 호환 경계가 정한다 */
  sourceSite: string
  sourceArticleId: string
  inputHash: string
  ruleVersion: string
  promptVersion: string
  model: string
  decision: string
  semanticStatus: string
  decidedAt: string
  /**
   * 🔴 **그 판정을 낸 회차** (2026-09-28). 판정 러너가 적는다 — `runId` 는 `--run-id`,
   *    `runAt` 은 회차 시각(`SORAN_RUN_AT`). 옛 기록에는 없다 → 회차 기록의 단계 구간으로 찾는다.
   */
  runId?: string
  runAt?: string
}

/** 🔴 지난 artifact 한 장 — 파일에서 읽은 그대로 */
export type PriorArtifactRow = {
  /** 🔴 원천 사이트 — 이 판(P0-B) 전 artifact 에는 없다 → `artifactRecordOutcome` 의 호환 경계가 정한다 */
  sourceSite: string
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
  /** 🔴 그 회차가 지목한 후보 — 다음 회차를 강제한다 */
  suggestedPersonaCodes?: readonly string[]
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
  const key = sourceIdentityOf(j.sourceSite, id)
  const atMs = parseInstantMs(j.decidedAt)
  // 🔴 사이트를 모르는 줄은 어느 원천의 결론도 아니다 — 호환 경계(`shadowRecordOutcome`)가 사이트를 정한 뒤에만 온다
  if (key === null || atMs === null) return null
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
  /**
   * 🔴 **기록이 회차를 적어 두었으면 그것을 쓴다.** `runAt` 을 읽지 못하면 회차를 모르는 것이지
   *    기록이 틀린 것은 아니다 — 결론은 그대로 두고 회차만 비운다(뒤에서 회차 기록으로 찾는다).
   */
  const runAtMs = j.runAt === undefined ? null : parseInstantMs(j.runAt)
  const runId = S(j.runId)
  return {
    sourceKey: key, sourceArticleId: id, atMs, stage: 'judge', state,
    ...(runAtMs === null ? {} : { run: { id: runId === '' ? null : runId, atMs: runAtMs } }),
  }
}

/**
 * 🔴 **지난 artifact 한 장을 상태로 바꾼다.** 스키마 판과 **생성 계약**이 둘 다
 *    지금과 같아야 한다 — `artifactVersion` 하나로는 프롬프트·모델·자산 판이 바뀐 것을 못 본다.
 */
export function artifactOutcome(
  a: PriorArtifactRow, currentContract: GenerationContract, artifactVersion: string,
): PriorOutcome | null {
  const id = S(a.sourceArticleId)
  const key = sourceIdentityOf(a.sourceSite, id)
  const atMs = parseInstantMs(a.generatedAt)
  if (key === null || atMs === null) return null
  if (S(a.artifactVersion) !== artifactVersion) return null
  if (!sameGenerationContract(a.contract, currentContract)) return null
  const outcome = S(a.outcome)
  const state: OutcomeState =
    // 🔴 모양을 읽지 못했으면(`retryable === null`) 결론이 아니다
    a.retryable === null || !(MACHINE_OUTCOMES as readonly string[]).includes(outcome) ? 'unknown'
      : a.retryable ? 'retryable'
        : outcome === 'adopt' ? 'candidate' : 'terminal'
  return {
    sourceKey: key, sourceArticleId: id, atMs, stage: 'draft', state,
    failedPersonaCode: state === 'retryable' ? (S(a.personaCode) || null) : null,
    failedStance: state === 'retryable' ? (S(a.stance) || null) : null,
    suggestedPersonaCodes: state === 'retryable'
      ? (a.suggestedPersonaCodes ?? []).map((x) => S(x)).filter((x) => x !== '') : [],
    failedCause: state === 'retryable' ? (S(a.cause) || null) : null,
  }
}

/**
 * 🔴 **사이트 칸 호환 경계 — 지난 기록을 원천 하나에 붙이는 한 곳** (2026-09-30 야간 P0-B).
 *
 *    `hashOf` 는 **원천 열쇠(`sourceKeyOf`) → 지금 입력 지문**이다.
 *    · 기록에 사이트가 있으면: 그 열쇠 하나만 본다. 지금 대상이 아니면 `null`.
 *    · 기록에 사이트가 없으면(이 판 전 판정 · artifact): **묵시적으로 합치지 않는다.** 같은 id 를 가진 지금 대상
 *      원천마다 기록을 대 보고(`outcomeAt`), **입력 지문 · 계약이 맞아 결론이 나는 원천이 정확히 하나일 때만**
 *      그 원천의 기록으로 인정한다. 둘 이상이면(같은 id · 같은 지문 — 어느 쪽 기록인지 증명할 수 없다) 버린다.
 *      🔴 지문은 제목 · 본문 앞머리로 만든다 — 다른 사이트의 다른 글은 지문이 달라 여기서 갈린다.
 *    🔴 버린 기록은 결론이 아니다 — 그 원천은 다시 볼 수 있다(깨진 기록 하나가 원천을 영구 제외하지 않는 기존 태도와 같다).
 */
function resolveSourceOutcome(
  raw: Record<string, unknown>, hashOf: ReadonlyMap<string, string>,
  outcomeAt: (site: string, hash: string) => PriorOutcome | null,
): PriorOutcome | null {
  const id = baseIdOf(S(raw.sourceArticleId))
  if (id === '') return null
  const site = S(raw.sourceSite)
  if (site !== '') {
    const hash = hashOf.get(sourceKeyOf(site, id))
    return hash === undefined ? null : outcomeAt(site, hash)
  }
  const hits: PriorOutcome[] = []
  for (const [key, hash] of hashOf) {
    const src = sourceOfKey(key)
    if (src === null || src.id !== id) continue
    const o = outcomeAt(src.site, hash)
    if (o !== null) hits.push(o)
  }
  return hits.length === 1 ? hits[0]! : null
}

/**
 * 🔴 **판정 파일 한 줄을 그대로 상태로.** 러너와 검사가 **같은 함수**를 쓴다 —
 *    읽는 코드를 두 벌로 두면 검사가 구현을 흉내 내는 것으로 끝난다.
 *    🔴 지금 회차 대상이 아닌 원천(`hashOf` 에 없는 열쇠)은 `null` 이다. 사이트 칸 호환은 `resolveSourceOutcome`.
 */
export function shadowRecordOutcome(
  raw: Record<string, unknown>, hashOf: ReadonlyMap<string, string>, canon: WorksetCanon,
): PriorOutcome | null {
  return resolveSourceOutcome(raw, hashOf, (site, hash) => judgementOutcome({
    sourceSite: site, sourceArticleId: S(raw.sourceArticleId), inputHash: S(raw.inputHash),
    ruleVersion: S(raw.ruleVersion), promptVersion: S(raw.promptVersion), model: S(raw.model),
    decision: S(raw.decision), semanticStatus: S(raw.semanticStatus),
    decidedAt: S(raw.decidedAt),
    // 🔴 판정 러너가 적은 회차 칸 — 옛 줄에는 없다(없으면 넘기지 않는다)
    ...(typeof raw.runAt === 'string' ? { runAt: raw.runAt } : {}),
    ...(typeof raw.runId === 'string' ? { runId: raw.runId } : {}),
  }, hash, canon))
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
  const review = raw.review
  return resolveSourceOutcome(raw, hashOf, (site, hash) => artifactOutcome({
    sourceSite: site, sourceArticleId: S(raw.sourceArticleId), artifactVersion: S(raw.artifactVersion),
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
    suggestedPersonaCodes: (() => {
      const v = (raw.plan as Record<string, unknown> | undefined)?.suggestedPersonaCodes
      return Array.isArray(v) ? v.map((x) => S(x)).filter((x) => x !== '') : []
    })(),
    cause: S(readCause(review)),
  }, { ...base, sourceInputHash: hash }, artifactVersion))
}

/**
 * 🔴 원천마다 **가장 최신** 하나 — 순서는 `isLaterOutcome` 하나가 정한다.
 *    같은 회차 안에서는 단계 순서(생성이 판정 뒤), 회차 사이에서는 회차 시각이다.
 */
export function latestOutcomes(rows: readonly PriorOutcome[]): Map<string, PriorOutcome> {
  // 🔴 원천 열쇠로 모은다 — 같은 id 다른 사이트의 결과가 서로를 가리지 않는다
  const out = new Map<string, PriorOutcome>()
  for (const r of rows) {
    const cur = out.get(r.sourceKey)
    if (cur === undefined || isLaterOutcome(r, cur)) out.set(r.sourceKey, r)
  }
  return out
}

// ─────────────────────────────────────────────────────────
// 🔴 **회차 찾기** — 옛 판정 기록에는 회차 칸이 없다 (2026-09-28)
//
//   판정 러너가 `runId`·`runAt` 을 적기 시작한 것은 이 PR 부터다. 그 전 기록은
//   **공급 러너의 회차 기록**(`supply-process-<runId>.run.json`)으로 찾는다 —
//   그 기록의 칸(`runId`·`startedAt`·단계별 `startedAt`/`endedAt`)만 읽는다. 파일 이름은 보지 않는다.
//
//   판정 기록의 `decidedAt` 은 판정 단계가 도는 동안의 벽시계다. 그래서 **그 회차 판정 단계의
//   시작~끝 구간 안**에 있으면 그 회차의 판정이다. 고정 초(fudge)를 더하지 않는다 — 실제 구간이다.
//   🔴 어느 구간에도 없으면(손으로 부른 판정) 회차를 모른다 — 기록 자체의 시각이 그 회차의 시각이다.
// ─────────────────────────────────────────────────────────

export type RunWindow = {
  runId: string
  /**
   * 회차 시각(RUN_AT) — 자식에게 넘긴 값이고, 생성의 `generatedAt` · 판정의 `runAt` 과 같다.
   *    🔴 **작업 묶음 manifest 의 `takenAt` 이 있으면 그것이다.** 2026-09-26 전 러너는 회차 기록의
   *       `startedAt` 을 따로 `new Date()` 로 적어 RUN_AT 과 1ms 어긋났다(실측 20260924-051500).
   *       manifest 는 처음부터 RUN_AT 을 적었다 — 그래서 manifest 가 정본이고, 없을 때만 `startedAt` 이다.
   */
  runAtMs: number
  /** 그 회차 판정 단계가 돈 구간 — 없으면 `null` (판정을 돌리지 않은 회차) */
  judge: { startMs: number; endMs: number } | null
  /** 그 회차 생성 단계가 돈 구간 — 2026-09-23 전 생성은 `generatedAt` 을 벽시계로 적었다 */
  draft: { startMs: number; endMs: number } | null
}

/** 한 단계의 구간 — 🔴 여러 번이거나(없어야 한다) 모양이 틀리면 `null` (모르는 것이다) */
function stageSpan(stages: readonly unknown[], stage: string, floorMs: number): { startMs: number; endMs: number } | null {
  const hits = stages.filter((s): s is Record<string, unknown> =>
    s !== null && typeof s === 'object'
    && (s as Record<string, unknown>).stage === stage
    && ((s as Record<string, unknown>).source ?? null) === null
    && (s as Record<string, unknown>).status !== 'skipped')
  if (hits.length !== 1) return null
  const startMs = parseInstantMs(hits[0]!.startedAt)
  const endMs = parseInstantMs(hits[0]!.endedAt)
  if (startMs === null || endMs === null || endMs < startMs || startMs < floorMs) return null
  return { startMs, endMs }
}

/**
 * 🔴 **회차 기록 한 장(+ 그 회차 manifest) → 구간.** 모양이 틀리면 `null` — 틀린 기록으로 회차를 지어내지 않는다.
 *    manifest 는 **같은 runId 칸**일 때만 쓴다(`kind` · `runId` · `takenAt` 칸). 파일 이름은 보지 않는다.
 */
export function runWindowOf(raw: unknown, manifest?: unknown): RunWindow | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const runId = S(o.runId)
  const startedMs = parseInstantMs(o.startedAt)
  if (runId === '' || startedMs === null) return null
  const m = manifest !== null && typeof manifest === 'object' ? manifest as Record<string, unknown> : null
  const takenMs = m !== null && m.kind === WORKSET_KIND && S(m.runId) === runId ? parseInstantMs(m.takenAt) : null
  const runAtMs = takenMs ?? startedMs
  const stages = Array.isArray(o.stages) ? o.stages : []
  const floor = Math.min(runAtMs, startedMs)
  return { runId, runAtMs, judge: stageSpan(stages, 'judge', floor), draft: stageSpan(stages, 'draft', floor) }
}

/**
 * 🔴 **회차 칸이 없는 기록에 회차를 붙인다.** 순수 함수 — 러너와 검사가 같은 것을 부른다.
 *
 *    판정  기록 칸이 없고 `decidedAt` 이 어느 회차의 **판정 구간** 안이면 → 그 회차
 *    생성  `generatedAt` 이 어느 회차의 회차 시각과 **같거나**(2026-09-23 이후), 그 회차의
 *          **생성 구간** 안이면(그 전 — 벽시계로 적었다) → 그 회차
 *    붙이면 순서를 정하는 시각은 **그 회차의 회차 시각**이다 — 같은 회차의 판정과 생성이 같은 값을 갖고,
 *    그러면 단계 순서(`isLaterOutcome`)가 가른다.
 *    🔴 이미 회차 칸이 있는 기록은 건드리지 않는다 — 기록이 적은 것이 우선이다.
 *    🔴 두 회차에 동시에 걸리면(겹칠 수 없다) 붙이지 않는다 — 모르는 것을 안다고 하지 않는다.
 */
export function attributeRuns(
  rows: readonly PriorOutcome[], runs: readonly RunWindow[],
): PriorOutcome[] {
  const inSpan = (sp: { startMs: number; endMs: number } | null, ms: number): boolean =>
    sp !== null && sp.startMs <= ms && ms <= sp.endMs
  return rows.map((r) => {
    if (r.run !== undefined) return r
    const hits = r.stage === 'judge'
      ? runs.filter((w) => inSpan(w.judge, r.atMs))
      : runs.filter((w) => w.runAtMs === r.atMs || inSpan(w.draft, r.atMs))
    if (hits.length !== 1) return r
    return { ...r, run: { id: hits[0]!.runId, atMs: hits[0]!.runAtMs } }
  })
}

/**
 * 🔴 **다음 회차에서 뺄 원천.** 최신 상태가 이 레인에서 끝난 것만이다.
 *
 *    `retryable` · `unknown` 은 다시 본다 — 결론이 아니라 못 물어본 것이다.
 *    `candidate` 는 여기서 빼지 않는다 — 큐·글에 이미 있으면 `queuedSources` 가, 적재가 실패했으면
 *    이월(`carriedOver`)이 묶음에서 뺀다(2026-09-28). 둘 다 아니면(기한 밖 등) 다시 볼 수 있다.
 */
export function concludedSourceKeys(rows: readonly PriorOutcome[]): Set<string> {
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


// ─────────────────────────────────────────────────────────
// 🔴 **같은 원문으로 두 번째 글을 만들지 않는다** (2026-09-28 공급 가속 P0-C)
//
//   앞판은 큐의 **미발행** 형제만 막았다(`queuePending`). 형제가 발행되고 나면 그 원천은
//   `candidate` 상태로 재시도 풀에 남아 있다가 다시 뽑혀 **판정 → 생성 → 적재** 를 또 돌았다 —
//   같은 원문에서 두 번째 글이 나갈 수 있는 길이었다.
//   이제 **큐 행(상태 무관)이나 글(Post)이 하나라도 있으면** 그 원천을 고르지 않는다.
//   적재가 **실패한** 후보만 #587 이월(`carryOver`)로 되살린다 — 다시 만들지 않는다.
// ─────────────────────────────────────────────────────────

/** 🔴 큐·글에 이미 있는 원천. `bySiteId` 는 사이트까지 맞춘 키, `byId` 는 사이트를 모르는 행용 */
export type SourceKeySet = { bySiteId: ReadonlySet<string>; byId: ReadonlySet<string> }

export const EMPTY_SOURCE_KEYS: SourceKeySet = Object.freeze({
  bySiteId: new Set<string>(), byId: new Set<string>(),
})


/**
 * 🔴 **이미 큐·글에 있는 원천 집합.** 큐 행은 **상태를 보지 않는다** — 미발행·발행·거절 모두다.
 *    발행된 것을 빼면 그 원천이 다시 뽑혀 두 번째 글이 나간다(이 절이 막는 길).
 */
export function queuedSourceKeysOf(rows: readonly {
  sourceSite: string | null | undefined; sourceArticleId: string | null | undefined
}[]): SourceKeySet {
  const bySiteId = new Set<string>()
  const byId = new Set<string>()
  for (const r of rows) {
    const o = originalSourceOf(r.sourceSite, r.sourceArticleId)
    if (o === null) continue
    bySiteId.add(sourceKeyOf(o.site, o.id))
    byId.add(o.id)
  }
  return { bySiteId, byId }
}

/**
 * 🔴 **이 행의 원천이 집합에 있는가.** 행의 사이트를 모르면(빈 값) id 만으로 본다 —
 *    모르는 사이트를 이유로 중복을 통과시키지 않는다(보수 쪽).
 */
export function hasSource(keys: SourceKeySet, site: string, articleId: string): boolean {
  const s = S(site)
  const id = baseIdOf(S(articleId))
  if (id === '') return false
  return s === '' ? keys.byId.has(id) : keys.bySiteId.has(sourceKeyOf(s, id))
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * 🔴 **사람이 이미 판정한 원천 색인** (2026-09-30 야간 P0-B) — 판정 러너 · 공급 러너가 같은 함수를 쓴다.
 *    승인 파일 행은 (사이트, id) 로 모은다. 사이트가 없는 옛 행은 **그 id 의 모든 원천**을 사람 판정으로 본다 —
 *    막는 쪽 집합이라 모르는 사이트를 이유로 사람이 본 글을 기계가 다시 판정하지 않게 한다(보수 쪽 · `hasSource` 와 같은 태도).
 */
export type HumanDecisionIndex = { bySource: ReadonlyMap<string, string>; byIdOnly: ReadonlyMap<string, string> }

export const EMPTY_HUMAN_DECISIONS: HumanDecisionIndex = Object.freeze({ bySource: new Map(), byIdOnly: new Map() })

export function humanDecisionIndexOf(rows: readonly Record<string, unknown>[]): HumanDecisionIndex {
  const bySource = new Map<string, string>()
  const byIdOnly = new Map<string, string>()
  for (const r of rows) {
    const id = baseIdOf(S(r.sourceArticleId))
    if (id === '') continue
    const key = sourceIdentityOf(r.sourceSite, id)
    if (key === null) byIdOnly.set(id, S(r.decision))
    else bySource.set(key, S(r.decision))
  }
  return { bySource, byIdOnly }
}

/** 🔴 이 원천의 사람 판정 — 없으면 `null` */
export function humanDecisionFor(ix: HumanDecisionIndex, site: string, articleId: string): string | null {
  const id = baseIdOf(S(articleId))
  const key = sourceIdentityOf(site, id)
  if (key !== null && ix.bySource.has(key)) return ix.bySource.get(key)!
  return ix.byIdOnly.get(id) ?? null
}

/**
 * 🔴 **재시도 자리를 남겨 둔다** (2026-09-20 보정 · 2026-09-28 비례).
 *
 *    "안 본 것 먼저" 만으로 정렬하면, 신규 원천이 회차마다 상한만큼 들어오는 한
 *    재시도 원천의 차례는 **영영 오지 않는다**(실측: 신규 5건 × 10회차, 0회 선택).
 *    그래서 재시도에 자리를 남긴다 — **상한 5 자리마다 1** (최소 1).
 *      limit 2~9 → 1   limit 10 → 2
 *    🔴 상한 10 에서 1 자리로 두면 묶음이 두 배가 돼도 재시도 몫은 그대로라 재시도가 두 배로 밀린다.
 *    🔴 상한 1 은 자리를 나눌 수 없다 — 기다린 시간(`WORKSET_RETRY_STARVE_MS`)이 정한다.
 */
export const WORKSET_RETRY_RESERVE_EVERY = 5

export function worksetRetryReserve(limit: number): number {
  if (!Number.isInteger(limit) || limit < 2) return 0
  return Math.max(1, Math.floor(limit / WORKSET_RETRY_RESERVE_EVERY))
}

/**
 * 🔴 **재시도 안의 차례** (2026-09-28). 작은 값이 먼저다.
 *
 *    0 `seeded`  판정은 통과했는데 **초안이 없다** — 판정 캐시가 있어 다시 물어도 판정은 공짜에 가깝고,
 *                곧장 초안까지 간다. 재시도 가운데 **후보가 나올 가능성이 가장 크다**
 *    1 생성 단계 결과(`retryable`·`unknown`·`candidate`) — 판정은 이미 통과했다
 *    2 판정 단계 `retryable`·`unknown` — 판정부터 다시 물어야 한다
 *    🔴 같은 차례 안에서는 **오래 기다린 것부터**(회차 시각) — 굶김을 막는 규칙은 그대로다.
 */
export function retryTierOf(o: PriorOutcome | undefined): number {
  if (o === undefined) return 2
  if (o.stage === 'judge' && o.state === 'seeded') return 0
  if (o.stage === 'draft') return 1
  return 2
}

/**
 * 🔴 **상한이 1 이면 자리를 나눌 수 없다.** 그때는 **기다린 시간**이 정한다 —
 *    재시도 원천의 마지막 결과가 이만큼 지났으면 그 한 자리를 가져간다.
 *    회차가 갈수록 기다린 시간은 늘기만 하므로 차례는 유한 회차 안에 반드시 온다.
 *    🔴 지난 결과 시각과 `takenAt` 만으로 정해진다 — 따로 저장하는 상태가 없다.
 */
export const WORKSET_RETRY_STARVE_MS = 6 * 60 * 60 * 1000

export type SelectWorksetInput = {
  /** post-adapt 상세 행 — 🔴 같은 id 가 여러 번 오면 **뒤에 온 것**이 최신이다 */
  rows: readonly WorksetRow[]
  /** 사람이 이미 판정한 원천 — 🔴 `humanDecisionIndexOf` (사이트까지 맞춘다) */
  humanDecided: HumanDecisionIndex
  /** 큐에 미발행 형제가 있는 원천 — 🔴 원천 열쇠 집합(`pendingSourceKeysOf`) */
  queuePending: ReadonlySet<string>
  /**
   * 🔴 **큐 행(상태 무관)이나 글이 이미 있는 원천** (`queuedSourceKeysOf`, 2026-09-28).
   *    발행된 원천을 다시 뽑아 두 번째 글을 만들지 않는다. 비워 두는 기본값이 없다 — 부르는 쪽이 정한다.
   */
  queuedSources: SourceKeySet
  /**
   * 🔴 **이번 회차 적재가 이월로 다시 먹는 후보의 원천** (#587). 적재가 실패한 후보는
   *    **다시 만들지 않고** 그 후보를 적재한다 — 여기서 빼지 않으면 같은 원천을 유료로 또 만든다.
   */
  carriedOver: SourceKeySet
  /**
   * 🔴 **이 레인에서 끝난 원천** (`concludedSourceIds`). 이것이 없으면 HOLD/DROP 이
   *    댓글 수 상위 자리를 영구 점유해 다음 회차가 같은 것만 보게 된다.
   *    🔴 **재시도해야 하는 것은 여기 넣지 않는다** (예산·상한에 막힌 것 등).
   */
  concluded: ReadonlySet<string>  // 🔴 원천 열쇠 집합(`concludedSourceKeys`)
  /**
   * 🔴 **지금 계약으로 이미 돌려 본 원천과 그 마지막 시각** (`attemptedOutcomes`).
   *    빼지 않는다 — 자리를 나눠 쓰고, 그 안에서는 **오래 기다린 것부터** 집는다.
   */
  attempted: ReadonlyMap<string, PriorOutcome>  // 🔴 원천 열쇠 → 마지막 결과
  /**
   * 🔴 **정본 원천 기회 판정 — 예정 슬롯 기준 · 유료 생성 전** (`judgeSlotRelease` · 참여 동력 · 배정은 `pending`).
   *    eligible 이 아니면 고르지 않는다. 순서도 이 판정의 rank 다. 부르는 쪽이 넣는다 — 기본값이 없다.
   */
  releaseOf: (r: WorksetRow) => SlotReleaseVerdict
  limit: number
  runId: string
  takenAt: Date
  /**
   * 🔴 **JIT 공급 회차** (2026-10-10 P0-B1) — 주면 `selectJitWorkset` 하나가 고르고 배정한다(`workset-v3`).
   *    `slots` 는 자동 READY 가 덮지 못한 부족 슬롯, `cap` 은 이번 회차 유료 원천 상한(`paidSourcesFor`)이다.
   *    주지 않으면 옛 판(v2 — 슬롯 없이 손으로 부르는 경로 · 검사)이다. 🔴 v2 는 JIT 근거로 세지 않는다.
   */
  jit?: JitSelectionInput
  /**
   * 🔴 **선택 관측 기록기** (2026-10-10 P0-B0) — 주면 단계별 결과를 적기만 한다. 주지 않으면 기록 0.
   *    선택 결과(슬롯 · 묶음 · 순서 · 재시도)는 주든 안 주든 같다 — 검사가 digest 로 대조한다.
   */
  trace?: WorksetTraceSink
}

/**
 * 🔴 **선택 관측 기록기** — 반환값이 없다. 선택 변수(자리 · 집합 · 순서)를 읽기만 하고 바꾸지 않는다.
 *    `key` 는 원천 열쇠(`sourceIdentityOf`) — 파일로 나갈 때는 해시만 남는다(`supply-selection-trace`).
 */
export type WorksetTraceSink = {
  /** 생성 가능 판정 한 줄 — `drop` 이 null 이면 통과 · `verdict` 는 슬롯 판정까지 갔을 때만 */
  eligibility(e: { row: WorksetRow; key: string | null; drop: WorksetDrop | null; verdict: SlotReleaseVerdict | null }): void
  /** JIT 선택 한 줄 — 고른 원천은 배정 슬롯과 묶음 안 순서를 함께 적는다 */
  jit(e: { key: string; step: JitSelectStep; slotAt: Date | null; position: number | null; retryReserved: boolean }): void
}

/** 🔴 생성 가능 판정에 쓰는 입력 — 묶음 선택과 기회 스냅샷이 **같은 값**을 넘긴다 */
export type WorksetEligibilityInput = Pick<SelectWorksetInput,
  'rows' | 'humanDecided' | 'queuePending' | 'queuedSources' | 'carriedOver' | 'concluded' | 'releaseOf' | 'trace'>

export type WorksetEligibility = {
  /** 🔴 지금 실제로 생성 가능한 원천(상한 적용 전) — 마지막 행 기준 · 사이트 · id 정리됨 */
  eligible: WorksetRow[]
  /** 원천 열쇠 → 생성 전 판정(eligible 만) */
  releaseByKey: Map<string, SlotReleaseVerdict>
  dropped: Record<WorksetDrop, number>
  /** 원천 열쇠 — `eligible` 의 행에만 정의된다 */
  keyOf: (r: WorksetRow) => string
}

/**
 * 🔴 **생성 가능 원천 — 정본 판정 하나** (2026-10-01 Lane B). 묶음 선택(`selectWorkset`)과
 *    원천 기회 스냅샷(공급 러너 → preflight)이 **이 함수 하나**를 부른다. 두 번째 판정을 만들지 않는다.
 *    빼는 것: 사이트 · id 모름 · 사람 판정 · 큐 형제 · 이미 큐/글 · 이월 · 끝난 원천 · hard block ·
 *    물어봐도 HOLD · 예정 슬롯 ineligible · unknown. 앞판 스냅샷은 슬롯 판정만 거쳐 끝난 · 큐 원천까지 셌다.
 */
export function worksetEligibility(input: WorksetEligibilityInput): WorksetEligibility {
  const dropped: Record<WorksetDrop, number> = {
    identityMissing: 0, humanDecided: 0, queueSibling: 0, alreadyQueued: 0, carriedOver: 0, hardBlocked: 0, preGated: 0, terminal: 0,
    slotIneligible: 0, slotUnknown: 0, slotUnassigned: 0, rawNotAutoConsumed: 0,
  }
  const releaseByKey = new Map<string, SlotReleaseVerdict>()
  /**
   * 🔴 같은 원천이 여러 파일에 있으면 **마지막 행**만 남긴다 — 원천은 **(사이트, id)** 다.
   *    앞판은 id 하나로 모아 같은 id 두 사이트 중 한쪽을 지웠다(P0-B). 사이트나 id 를 모르면 고르지 않는다.
   */
  const byKey = new Map<string, WorksetRow>()
  const keyOf = new Map<WorksetRow, string>()
  /** 🔴 빼는 자리 하나 — 수를 세고, 기록기가 있으면 같은 사유를 적는다(선택에는 영향 없음) */
  const drop = (r: WorksetRow, key: string | null, d: WorksetDrop, v: SlotReleaseVerdict | null = null): void => {
    dropped[d] += 1
    input.trace?.eligibility({ row: r, key, drop: d, verdict: v })
  }
  for (const r of input.rows) {
    const key = sourceIdentityOf(r.sourceSite, r.sourceArticleId)
    if (key === null) { drop(r, null, 'identityMissing'); continue }
    byKey.set(key, { ...r, sourceArticleId: S(r.sourceArticleId), sourceSite: S(r.sourceSite) })
  }
  for (const [key, r] of byKey) keyOf.set(r, key)
  const K = (r: WorksetRow): string => keyOf.get(r)!

  const eligible: WorksetRow[] = []
  for (const r of byKey.values()) {
    if (humanDecisionFor(input.humanDecided, r.sourceSite, r.sourceArticleId) !== null) { drop(r, K(r), 'humanDecided'); continue }
    if (input.queuePending.has(K(r))) { drop(r, K(r), 'queueSibling'); continue }
    // 🔴 발행된 형제까지 — 같은 원문으로 두 번째 글을 만들지 않는다
    if (hasSource(input.queuedSources, r.sourceSite, r.sourceArticleId)) { drop(r, K(r), 'alreadyQueued'); continue }
    // 🔴 적재 실패 후보는 이월이 적재한다 — 다시 만들지 않는다
    if (hasSource(input.carriedOver, r.sourceSite, r.sourceArticleId)) { drop(r, K(r), 'carriedOver'); continue }
    if (input.concluded.has(K(r))) { drop(r, K(r), 'terminal'); continue }
    /**
     * 🔴 **판정기 정본 게이트를 그대로 부른다** — 여기서 규칙을 새로 만들지 않는다.
     *    `access`·`safety` 를 손으로 비교하던 앞판은 판정기와 어긋날 수 있었다.
     */
    if (hardGate(r.input).some((c) => (HARD_BLOCK as readonly string[]).includes(c))) {
      drop(r, K(r), 'hardBlocked'); continue
    }
    /**
     * 🔴 **물어봐도 HOLD 인 것은 묶음에 넣지 않는다.** 판정기가 모델 답을 받고
     *    나서 보던 사유를 `holdBeforeAsking` 하나로 모았다 — 같은 함수를 부른다.
     */
    if (holdBeforeAsking(r.input).length > 0) { drop(r, K(r), 'preGated'); continue }
    /**
     * 🔴 **예정 슬롯에서 eligible 인가 — 정본 판정 하나** (2026-09-30). 오래된 원문을 오늘 수집했어도,
     *    반응 증거가 없어도, 원천 상대 표본이 없어도 유료 생성에 들어가지 않는다.
     */
    const v = input.releaseOf(r)
    if (v.verdict !== 'eligible') {
      drop(r, K(r), v.verdict === 'unknown' ? 'slotUnknown' : 'slotIneligible', v)
      continue
    }
    releaseByKey.set(K(r), v)
    eligible.push(r)
    input.trace?.eligibility({ row: r, key: K(r), drop: null, verdict: v })
  }

  return { eligible, releaseByKey, dropped, keyOf: K }
}

/**
 * 🔴 **재시도에 남길 자리 수 — 옛 판 · JIT 판이 같은 함수를 쓴다.**
 *    상한 2 이상이면 `worksetRetryReserve`(상한 10 → 2), 상한 1 이면 가장 오래 기다린 재시도가
 *    `WORKSET_RETRY_STARVE_MS` 를 넘었을 때만 1 이다. 재시도가 없으면 0.
 */
export function retryReserveFor(limit: number, retryClocksMs: readonly number[], takenAt: Date): number {
  if (retryClocksMs.length === 0 || !(limit > 0)) return 0
  if (limit >= 2) return worksetRetryReserve(limit)
  const oldest = Math.min(...retryClocksMs)
  return takenAt.getTime() - oldest >= WORKSET_RETRY_STARVE_MS ? limit : 0
}

/**
 * 🔴 **묶음을 고른다.** AI 를 부르기 전에 끝난다 — 이 함수는 순수하다.
 *
 * 🔴 **JIT 공급 회차(`input.jit`)는 `selectJitWorkset` 하나가 고른다** (2026-10-10 P0-B1).
 *    아래 옛 판의 축 자리 · 재시도 예약석 · 순위 자르기를 JIT 하류에서 **다시 하지 않는다**.
 *
 * 옛 판(v2 — 슬롯 없이 손으로 부르는 경로 · 검사)은 그대로다:
 * 🔴 자리를 둘로 나눈다: **한 번도 안 본 원천**과 **이미 본 원천(재시도)**.
 *    한쪽이 다른 쪽을 굶기지 않는 것이 이 함수의 계약이다.
 * 🔴 **그 전에 축으로 자리를 나눈다** (2026-09-28, `worksetAxisQuota`).
 *    상한 10 → raw 최대 2 · seed 가 충분하면 seed 8 이상 (상한 5 → 1 · 4).
 *
 * 🔴 같은 입력이면 같은 결과다. 사람이 대조할 수 있어야 한다.
 */
export function selectWorkset(input: SelectWorksetInput): WorksetPlan {
  if (input.jit !== undefined) return selectJitWorkset(input, input.jit)
  const base = worksetEligibility(input)
  const { releaseByKey, dropped, keyOf: K } = base
  const eligible = base.eligible

  /** 🔴 정본 rank 사전식 비교 — 합산 점수 없음 · 마지막 열쇠는 원천 열쇠다 */
  const byWeight = (a: WorksetRow, b: WorksetRow): number =>
    compareReleaseRank(releaseByKey.get(K(a))!.rank, releaseByKey.get(K(b))!.rank)
    || K(a).localeCompare(K(b))

  const fresh = eligible.filter((r) => !input.attempted.has(K(r))).sort(byWeight)
  const prior = (r: WorksetRow): PriorOutcome | undefined => input.attempted.get(K(r))
  const retry = eligible.filter((r) => input.attempted.has(K(r)))
    /**
     * 🔴 **차례(`retryTierOf`) → 오래 기다린 것부터 → 신규와 같은 저울.**
     *    판정은 통과했는데 초안이 없는 원천(`seeded`)이 판정부터 다시 물어야 하는 원천보다 먼저다.
     *    🔴 기다린 시간은 **회차 시각**으로 잰다(`runClockOf`) — 최신을 가르는 시각과 같은 값이다.
     */
    .sort((a, b) =>
      retryTierOf(prior(a)) - retryTierOf(prior(b))
      || (prior(a) === undefined ? 0 : runClockOf(prior(a)!)) - (prior(b) === undefined ? 0 : runClockOf(prior(b)!))
      || byWeight(a, b))

  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 0

  const count = (axis: WorksetAxis): number => eligible.filter((r) => worksetAxisOf(r) === axis).length
  const eligibleByAxis: Record<WorksetAxis, number> = { seed: count('seed'), raw: count('raw') }
  const quota = worksetAxisQuota(limit, eligibleByAxis)
  const used: Record<WorksetAxis, number> = { seed: 0, raw: 0 }
  const hasRoom = (r: WorksetRow): boolean => used[worksetAxisOf(r)] < quota[worksetAxisOf(r)]
  const take = (r: WorksetRow): boolean => {
    if (!hasRoom(r)) return false
    used[worksetAxisOf(r)] += 1
    return true
  }
  // 🔴 자리가 0 인 축의 원천은 이번 회차 후보가 아니다 — 재시도 자리도 그 축으로 새지 않는다
  const freshOpen = fresh.filter(hasRoom)
  const retryOpen = retry.filter(hasRoom)

  const reserve = retryReserveFor(limit, retryOpen.map((r) => (prior(r) === undefined ? 0 : runClockOf(prior(r)!))), input.takenAt)

  // 🔴 ① 재시도 자리를 **먼저** 잡는다 — 오래 기다린 순서 그대로, 축 자리가 남은 것만
  const reserved = new Set<string>()
  for (const r of retryOpen) {
    if (reserved.size >= reserve) break
    if (take(r)) reserved.add(K(r))
  }
  // 🔴 ② 신규 — 순위 그대로, 남긴 재시도 자리를 빼고 축 자리 안에서
  const freshPicked: WorksetRow[] = []
  for (const r of freshOpen) {
    if (freshPicked.length >= limit - reserved.size) break
    if (take(r)) freshPicked.push(r)
  }
  // 🔴 ③ 신규가 자리를 다 못 채우면 재시도가 남은 칸을 쓴다 — 축 자리 안에서만
  const retryIds = new Set(reserved)
  for (const r of retryOpen) {
    if (freshPicked.length + retryIds.size >= limit) break
    if (retryIds.has(K(r))) continue
    if (take(r)) retryIds.add(K(r))
  }
  // 🔴 재시도는 **오래 기다린 순서** 그대로 적는다 — 먼저 잡은 자리가 앞에 오는 것이 아니다
  const retryPicked = retryOpen.filter((r) => retryIds.has(K(r)))
  const picked = [...freshPicked, ...retryPicked]
  const pickedByAxis: Record<WorksetAxis, number> = {
    seed: picked.filter((r) => worksetAxisOf(r) === 'seed').length,
    raw: picked.filter((r) => worksetAxisOf(r) === 'raw').length,
  }

  return {
    workset: {
      kind: WORKSET_KIND, version: WORKSET_VERSION,
      runId: input.runId, takenAt: input.takenAt.toISOString(), limit,
      sources: picked.map((r) => ({ sourceSite: r.sourceSite, sourceArticleId: r.sourceArticleId })),
    },
    picked,
    dropped,
    // 🔴 조건은 맞는데 이번에 못 들어간 것 — 다음 회차가 집는다
    deferred: Math.max(0, eligible.length - picked.length),
    axis: { eligible: eligibleByAxis, quota, picked: pickedByAxis },
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 **JIT 공급 선택 — 최대 슬롯 보존 → 정본 순위 → 결정적 동률** (2026-10-10 P0-B1)
//
//   앞판은 `assignSourceSlots` 가 마감 임박 순(EDF)으로 **먼저 골라** 잘랐고, 순위 · 축 자리 · 재시도 예약석은
//   그 뒤에서 거의 작동하지 않았다. 08:15 · 12:15 실측: 더 어린 미선택 후보를 두고 오래된 후보를 배정한 사례 10 ·
//   배정한 raw 를 축 자리가 버려 선택 8 · 9 / 상한 10. 72시간 공급 원천 나이 p50 41.4h · 당일 0%.
//
//   이제 한 함수가 고르고 배정한다:
//     ① 생성 가능 판정(그대로) → raw 축은 자동 소비자가 없어 뺀다(마스터 결정 · 자료는 그대로 남는다)
//     ② 부족 슬롯 어디에도 연결되지 않는 원천은 뺀다
//     ③ 채울 수 있는 최대 슬롯 수 M — 원천마다 서로 다른 슬롯 하나(증대 경로) · 목표 = min(상한, M)
//     ④ 재시도(기존 차례 → 오래 기다린 것 → 순위)를 예약 수만큼 먼저, 그다음 정본 순위대로 —
//        **넣어도 서로 다른 슬롯 짝이 유지될 때만** 넣는다. 짝 가능 집합은 matroid 라 어떤 순서로 넣어도
//        멈출 때 크기는 목표와 같다(최대 슬롯 보존). 같은 순서 안에서는 가장 좋은 집합이다(교환 역전 0)
//     ⑤ 상한이 남으면 같은 순서로 더 산다(재고 수율 대비 — 앞판의 다음 바퀴와 같은 자리)
//     ⑥ 고른 집합에만 EDF 로 실제 슬롯을 배정한다 — **EDF 는 더 이상 무엇을 살지 정하지 않는다**
//   🔴 합산 점수 · 가중치 · 품질 구간 · 할당량 없음.
// ─────────────────────────────────────────────────────────

export type JitSelectionInput = { slots: readonly Date[]; now: Date; cap: number }

/** 🔴 JIT 선택에서 원천이 들어가거나 멈춘 자리 — 원인이 다르면 값도 다르다 */
export const JIT_SELECT_STEPS = [
  'RAW_EXCLUDED', 'SLOT_UNLINKABLE', 'SELECTED_COVER', 'SELECTED_EXTRA', 'CAP_REACHED',
] as const
export type JitSelectStep = (typeof JIT_SELECT_STEPS)[number]

export type JitSelectionFacts = {
  slots: number
  cap: number
  /** 부족 슬롯 하나 이상에 연결되는 자동 seed 원천 */
  linkable: number
  rawExcluded: number
  unlinkable: number
  /** 🔴 원천마다 서로 다른 슬롯 하나로 덮을 수 있는 최대 슬롯 수 */
  maxFillableSlots: number
  /** min(상한, 최대 슬롯) — 선택이 반드시 덮어야 하는 슬롯 수 */
  coverTarget: number
  coveredSlots: number
  retryReserve: number
  retryReserved: number
}

/** 🔴 순위 비교 입력 — 정본 rank(같은 기준 슬롯) · 동률에서만 쓰는 선호 두 개 · 결정적 열쇠 */
export type SupplyRankKey = { rank: ReleaseRank; menopause: boolean; wgang: boolean; key: string }

/** 🔴 정본 원천 이름 — 동률에서만 쓰는 출처 선호 */
export const WGANG_SOURCE_SITE = 'navercafe:wgang'

/**
 * 🔴 **공급 순위 — 정본 `compareReleaseRank` 그대로**(댓글 백분위 → 조회 백분위 → 슬롯 나이 → velocity),
 *    그것이 동률일 때만 갱년기 → wgang → 원천 열쇠(코드 포인트 순). 정본 함수는 바꾸지 않는다(발행 선택도 쓴다).
 */
export function compareSupplyRank(a: SupplyRankKey, b: SupplyRankKey): number {
  return compareReleaseRank({ ...a.rank, tieBreak: '' }, { ...b.rank, tieBreak: '' })
    || Number(b.menopause) - Number(a.menopause)
    || Number(b.wgang) - Number(a.wgang)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

/**
 * 🔴 **원천마다 서로 다른 슬롯 하나 — 증대 경로.** `valid[i][j]`: 원천 i 가 슬롯 j 에서 eligible.
 *    `tryAdd(i)` 는 원천 i 를 넣을 수 있으면 짝을 고쳐 넣고 true, 아니면 **아무것도 바꾸지 않고** false.
 */
export function slotMatcher(valid: readonly (readonly boolean[])[], nSlots: number): {
  tryAdd: (i: number) => boolean
  slotOf: (i: number) => number | null
} {
  const owner: number[] = Array.from({ length: nSlots }, () => -1)
  const augment = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < nSlots; j += 1) {
      if (valid[i]?.[j] !== true || seen[j]) continue
      seen[j] = true
      if (owner[j] === -1 || augment(owner[j]!, seen)) { owner[j] = i; return true }
    }
    return false
  }
  return {
    tryAdd: (i) => augment(i, Array.from({ length: nSlots }, () => false)),
    slotOf: (i) => { const j = owner.indexOf(i); return j < 0 ? null : j },
  }
}

/** 🔴 채울 수 있는 최대 슬롯 수 — 넣는 순서와 무관하다 */
export function maxSlotMatching(valid: readonly (readonly boolean[])[], nSlots: number): number {
  const m = slotMatcher(valid, nSlots)
  let n = 0
  for (let i = 0; i < valid.length; i += 1) if (m.tryAdd(i)) n += 1
  return n
}

function selectJitWorkset(input: SelectWorksetInput, jit: JitSelectionInput): WorksetPlan {
  const base = worksetEligibility(input)
  const { dropped, keyOf: K } = base
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 0
  const cap = Math.min(limit, Number.isInteger(jit.cap) && jit.cap > 0 ? jit.cap : 0)
  // 🔴 슬롯은 시각이 정체성이다 — 같은 시각이 두 번 오면 한 슬롯이다(시각순)
  const slots = [...new Map(jit.slots.map((d) => [d.getTime(), d])).values()].sort((a, b) => a.getTime() - b.getTime())
  const n = slots.length
  const note = (key: string, step: JitSelectStep, slotAt: Date | null = null, position: number | null = null, retryReserved = false): void =>
    input.trace?.jit({ key, step, slotAt, position, retryReserved })

  type Cand = { r: WorksetRow; key: string; valid: boolean[]; sk: SupplyRankKey; prior: PriorOutcome | undefined }
  const pool: Cand[] = []
  let rawExcluded = 0
  let unlinkable = 0
  for (const r of base.eligible) {
    const key = K(r)
    if (worksetAxisOf(r) === 'raw') { rawExcluded += 1; dropped.rawNotAutoConsumed += 1; note(key, 'RAW_EXCLUDED'); continue }
    const valid = slots.map((d) => preGenerationRelease(r, d, jit.now).verdict === 'eligible')
    const first = valid.indexOf(true)
    if (first < 0) { unlinkable += 1; dropped.slotUnassigned += 1; note(key, 'SLOT_UNLINKABLE'); continue }
    // 🔴 순위는 모든 후보가 **같은 기준 슬롯**(가장 이른 부족 슬롯)에서 잰 정본 rank — 나이를 서로 비교할 수 있다
    const atFirst = preGenerationRelease(r, slots[0]!, jit.now)
    const rank = atFirst.verdict === 'eligible' ? atFirst.rank : preGenerationRelease(r, slots[first]!, jit.now).rank
    pool.push({
      r, key, valid, prior: input.attempted.get(key),
      sk: {
        rank, key,
        menopause: mentionsMenopause(`${r.input.title ?? ''}\n${r.input.bodyHead ?? ''}`),
        wgang: r.sourceSite === WGANG_SOURCE_SITE,
      },
    })
  }

  const byRank = [...pool].sort((a, b) => compareSupplyRank(a.sk, b.sk))
  const retries = pool.filter((c) => c.prior !== undefined).sort((a, b) =>
    retryTierOf(a.prior) - retryTierOf(b.prior) || runClockOf(a.prior!) - runClockOf(b.prior!) || compareSupplyRank(a.sk, b.sk))
  const reserve = Math.min(cap, retryReserveFor(cap, retries.map((c) => runClockOf(c.prior!)), input.takenAt))
  const idx = new Map(pool.map((c, i) => [c, i]))
  const valid = pool.map((c) => c.valid)
  const maxFillable = maxSlotMatching(valid, n)
  const coverTarget = Math.min(cap, maxFillable)

  // ④ 덮기 — 재시도 예약 먼저, 그다음 순위. 짝이 유지될 때만 넣는다
  const m = slotMatcher(valid, n)
  const cover: Cand[] = []
  const reserved = new Set<Cand>()
  for (const c of retries) {
    if (reserved.size >= reserve || cover.length >= coverTarget) break
    if (m.tryAdd(idx.get(c)!)) { cover.push(c); reserved.add(c) }
  }
  for (const c of byRank) {
    if (cover.length >= coverTarget) break
    if (reserved.has(c)) continue
    if (m.tryAdd(idx.get(c)!)) cover.push(c)
  }
  // ⑤ 남는 상한 — 재시도 예약을 마저 채우고 순위 순
  const taken = new Set<Cand>(cover)
  const extra: Cand[] = []
  const seats = cap - cover.length
  for (const c of retries) {
    if (reserved.size >= reserve || extra.length >= seats) break
    if (taken.has(c)) continue
    extra.push(c); reserved.add(c); taken.add(c)
  }
  for (const c of byRank) {
    if (extra.length >= seats) break
    if (taken.has(c)) continue
    extra.push(c); taken.add(c)
  }

  // ⑥ 배정 — 고른 집합에만 EDF(마감이 이른 것이 이른 슬롯). 덮기 집합은 한 바퀴에 전부 짝지어진다
  const slotIndex = new Map(slots.map((d, j) => [d.getTime(), j]))
  const edfRounds = (set: readonly Cand[]): Map<Cand, Date> => {
    const out = new Map<Cand, Date>()
    let left = [...set]
    while (left.length > 0) {
      const byKey = new Map(left.map((c) => [c.key, c]))
      const r = matchOpportunitiesToSlots(slots, left.map((c) => ({ key: c.key, validAt: (d: Date) => c.valid[slotIndex.get(d.getTime())!] === true })))
      if (r.filled === 0) break
      r.bySlot.forEach((k, j) => { if (k !== null) out.set(byKey.get(k)!, slots[j]!) })
      left = left.filter((c) => !out.has(c))
    }
    return out
  }
  const coverSlots = edfRounds(cover)
  // 🔴 EDF 가 덮기 집합을 한 바퀴에 다 짝짓지 못하면(나이 외 슬롯 의존 판정이 생긴 경우) 증대 경로의 짝을 쓴다
  const coverFirstRound = new Set([...coverSlots.values()].map((d) => d.getTime())).size === cover.length
  const assigned = new Map<Cand, Date>(coverFirstRound ? coverSlots : cover.map((c) => [c, slots[m.slotOf(idx.get(c)!)!]!]))
  for (const [c, d] of edfRounds(extra)) assigned.set(c, d)

  const picked = [...cover, ...extra]
  picked.forEach((c, i) => {
    note(c.key, i < cover.length ? 'SELECTED_COVER' : 'SELECTED_EXTRA', assigned.get(c) ?? null, i, reserved.has(c))
  })
  for (const c of pool) if (!taken.has(c)) { dropped.slotUnassigned += 1; note(c.key, 'CAP_REACHED') }

  const eligibleByAxis: Record<WorksetAxis, number> = {
    seed: base.eligible.length - rawExcluded, raw: rawExcluded,
  }
  return {
    workset: {
      kind: WORKSET_KIND, version: WORKSET_VERSION_JIT,
      runId: input.runId, takenAt: input.takenAt.toISOString(), limit,
      sources: picked.map((c) => {
        const d = assigned.get(c)!
        return {
          sourceSite: c.r.sourceSite, sourceArticleId: c.r.sourceArticleId,
          slotAt: d.toISOString(), ageAtSlotH: preGenerationRelease(c.r, d, jit.now).rank.ageAtSlotH ?? 0,
        }
      }),
      contract: SUPPLY_JIT_CONTRACT,
    },
    picked: picked.map((c) => c.r),
    dropped,
    deferred: Math.max(0, pool.length - picked.length),
    axis: { eligible: eligibleByAxis, quota: { seed: cap, raw: 0 }, picked: { seed: picked.length, raw: 0 } },
    jit: {
      slots: n, cap, linkable: pool.length, rawExcluded, unlinkable,
      maxFillableSlots: maxFillable, coverTarget,
      coveredSlots: new Set(cover.map((c) => assigned.get(c)!.getTime())).size,
      retryReserve: reserve, retryReserved: reserved.size,
    },
  }
}

export type WorksetFail = 'MISSING' | 'PARSE' | 'KIND' | 'VERSION' | 'RUN_MISMATCH' | 'SHAPE' | 'OVER_LIMIT'
export type WorksetRead =
  | {
      ok: true
      /**
       * 🔴 원천 열쇠(`sourceKeyOf`) 집합 — 판정 · 생성이 이 열쇠로 대 본다.
       *    옛 판(v1 · 사이트 없음)이면 `null` — 개수만 믿을 수 있다. 판정 게이트로 쓰지 않는다
       */
      sourceKeys: ReadonlySet<string> | null
      /** 🔴 묶음의 원천 수 — 관제 · 수율 창이 센다 */
      count: number
      limit: number
      /** 🔴 이 묶음을 집은 시각(ms) — 관제가 단계 상태를 이 값으로 판정한다 */
      takenAtMs: number
      /**
       * 🔴 **JIT 계약 의도** — `workset-v3` 에서만 원천 열쇠 → 의도. 옛 판이면 `null`(legacy — 근거로 세지 않는다)
       */
      intents: ReadonlyMap<string, SupplyIntent> | null
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
  const legacy = o.version === WORKSET_VERSION_LEGACY
  const jit = o.version === WORKSET_VERSION_JIT
  if (o.version !== WORKSET_VERSION && !legacy && !jit) {
    return { ok: false, code: 'VERSION', reason: `모르는 판이다 (${String(o.version)})` }
  }
  if (S(o.runId) !== expectRunId) {
    return { ok: false, code: 'RUN_MISMATCH', reason: `다른 회차 파일이다 (${S(o.runId)} ≠ ${expectRunId})` }
  }
  const limit = typeof o.limit === 'number' && Number.isInteger(o.limit) && o.limit > 0 ? o.limit : -1
  if (limit < 0) return { ok: false, code: 'SHAPE', reason: 'limit 이 양의 정수가 아니다' }
  let ids: string[]
  if (legacy) {
    // 🔴 옛 판 — 원문 id 목록뿐이다. 개수만 센다(열쇠를 지어내지 않는다)
    if (!Array.isArray(o.sourceIds)) return { ok: false, code: 'SHAPE', reason: 'sourceIds 가 배열이 아니다' }
    ids = o.sourceIds.map(S).filter((x) => x !== '')
    if (ids.length !== o.sourceIds.length) return { ok: false, code: 'SHAPE', reason: '빈 id 가 섞여 있다' }
  } else {
    if (!Array.isArray(o.sources)) return { ok: false, code: 'SHAPE', reason: 'sources 가 배열이 아니다' }
    // 🔴 원천마다 사이트 · id 가 둘 다 있어야 한다 — 하나라도 비면 묶음 전체를 받지 않는다
    const keys = o.sources.map((x: unknown) => (x !== null && typeof x === 'object'
      ? sourceIdentityOf((x as Record<string, unknown>).sourceSite, (x as Record<string, unknown>).sourceArticleId) : null))
    if (keys.some((k) => k === null)) return { ok: false, code: 'SHAPE', reason: '사이트 · id 가 빈 원천이 섞여 있다' }
    ids = keys as string[]
    if (new Set(ids).size !== ids.length) return { ok: false, code: 'SHAPE', reason: '같은 원천이 두 번 적혀 있다' }
  }
  // 🔴 JIT 판 — 계약 표식 · 원천마다 예정 슬롯 · 슬롯 시점 나이가 필수다. 하나라도 비면 묶음 전체를 받지 않는다
  let intents: Map<string, SupplyIntent> | null = null
  if (jit) {
    if (o.contract !== SUPPLY_JIT_CONTRACT) return { ok: false, code: 'SHAPE', reason: `JIT 계약 표식이 다르다 (${String(o.contract)})` }
    intents = new Map()
    for (const [k, x] of (o.sources as Record<string, unknown>[]).entries()) {
      const slotAt = x.slotAt
      const age = x.ageAtSlotH
      if (typeof slotAt !== 'string' || parseInstantMs(slotAt) === null) {
        return { ok: false, code: 'SHAPE', reason: `${k}번째 원천의 slotAt 이 시각이 아니다` }
      }
      if (typeof age !== 'number' || !Number.isFinite(age) || age < 0) {
        return { ok: false, code: 'SHAPE', reason: `${k}번째 원천의 ageAtSlotH 가 없다` }
      }
      intents.set(ids[k]!, {
        contract: SUPPLY_JIT_CONTRACT, runId: expectRunId,
        sourceHash: articleIdHashOf(S(x.sourceSite), S(x.sourceArticleId)), intendedSlotAt: slotAt, ageAtSlotH: age,
      })
    }
  }
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
  return { ok: true, sourceKeys: legacy ? null : new Set(ids), count: ids.length, limit, takenAtMs, intents }
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
  // 🔴 천장 위는 거부한다 — 무제한 호출의 길을 두지 않는다
  if (limit > WORKSET_MAX_LIMIT) {
    return { ok: false, reason: `workset 상한 ${limit} > 천장 ${WORKSET_MAX_LIMIT} — 실행하지 않는다` }
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
