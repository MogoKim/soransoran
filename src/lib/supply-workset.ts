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
import {
  AUTOFILL_SITE_PREFIX, MACHINE_SITE_PREFIX, baseArticleId, isOurSite,
} from './micro-seed-supply-autofill'
import { SUPPLY_WORKSET_PER_RUN } from './supply-schedule-contract'
/** 🔴 원천 기회 판정 정본 — 유료 생성 전에 예정 슬롯 기준으로 같은 함수를 부른다 */
import {
  compareReleaseRank, judgeSlotRelease, parseEvidence,
  type SlotReleaseVerdict, type SourceEvidenceRecord,
} from './source-slot-release'

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
export const WORKSET_VERSION = 'workset-v1'

/** 🔴 회차 파일 이름 — 러너와 검사가 **같은 함수**를 쓴다 */
export const worksetFileName = (runId: string): string => `supply-workset-${runId}.json`
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
    assignment: 'pending', driver: 'pending', tieBreak: r.sourceArticleId,
  })
}

export const WORKSET_DROPS = [
  'humanDecided', 'queueSibling', 'alreadyQueued', 'carriedOver', 'hardBlocked', 'preGated', 'terminal',
  'slotIneligible', 'slotUnknown',
] as const
export type WorksetDrop = (typeof WORKSET_DROPS)[number]

export const WORKSET_DROP_LABEL: Readonly<Record<WorksetDrop, string>> = {
  humanDecided: '사람이 이미 판정한 원천',
  queueSibling: '같은 원문의 미발행 형제가 큐에 있다',
  alreadyQueued: '같은 원문으로 이미 큐 행이나 글이 있다 (발행된 것 포함 — 두 번째 글을 만들지 않는다)',
  carriedOver: '적재에 실패한 앞 회차 후보가 이월로 적재된다 — 다시 만들지 않는다',
  hardBlocked: 'deterministic hard block',
  preGated: '접근·안전 조건을 충족하지 않는다',
  terminal: '앞 회차가 이미 끝낸 원천 (HOLD·DROP·생성 hard HOLD)',
  slotIneligible: '🔴 예정 슬롯에서 원천 가치가 없다 (원문 나이 ≥ 72h) — 유료 생성 0',
  slotUnknown: '🔴 원천 증거를 모른다 (게시 시각 · 반응 · 원천 상대 표본 없음) — 유료 생성 0',
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
  /**
   * 🔴 **기록이 회차를 적어 두었으면 그것을 쓴다.** `runAt` 을 읽지 못하면 회차를 모르는 것이지
   *    기록이 틀린 것은 아니다 — 결론은 그대로 두고 회차만 비운다(뒤에서 회차 기록으로 찾는다).
   */
  const runAtMs = j.runAt === undefined ? null : parseInstantMs(j.runAt)
  const runId = S(j.runId)
  return {
    sourceArticleId: id, atMs, stage: 'judge', state,
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
    suggestedPersonaCodes: state === 'retryable'
      ? (a.suggestedPersonaCodes ?? []).map((x) => S(x)).filter((x) => x !== '') : [],
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
    // 🔴 판정 러너가 적은 회차 칸 — 옛 줄에는 없다(없으면 넘기지 않는다)
    ...(typeof raw.runAt === 'string' ? { runAt: raw.runAt } : {}),
    ...(typeof raw.runId === 'string' ? { runId: raw.runId } : {}),
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
    suggestedPersonaCodes: (() => {
      const v = (raw.plan as Record<string, unknown> | undefined)?.suggestedPersonaCodes
      return Array.isArray(v) ? v.map((x) => S(x)).filter((x) => x !== '') : []
    })(),
    cause: S(readCause(review)),
  }, { ...base, sourceInputHash: hash }, artifactVersion)
}

/**
 * 🔴 원천마다 **가장 최신** 하나 — 순서는 `isLaterOutcome` 하나가 정한다.
 *    같은 회차 안에서는 단계 순서(생성이 판정 뒤), 회차 사이에서는 회차 시각이다.
 */
export function latestOutcomes(rows: readonly PriorOutcome[]): Map<string, PriorOutcome> {
  const out = new Map<string, PriorOutcome>()
  for (const r of rows) {
    const cur = out.get(r.sourceArticleId)
    if (cur === undefined || isLaterOutcome(r, cur)) out.set(r.sourceArticleId, r)
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

/** 🔴 원천 키 — 사이트 + (`#` 조각을 뗀) 원문 id */
export const sourceKeyOf = (site: string, articleId: string): string =>
  `${site.trim()}\u0000${baseIdOf(articleId.trim())}`

/**
 * 🔴 **큐 행 · 글 한 줄 → 원래 원천.**
 *    · 우리 synthetic 행(`publish-candidate:` · `publish-candidate:auto:`): 접두를 떼면 원래 사이트,
 *      id 는 `<원래id>-<해시8>` 이므로 정본 `baseArticleId` 로 되돌린다
 *    · 그 밖의 행(legacy · 글): 사이트는 그대로, id 가 `사이트:id` 모양이면 앞을 뗀다(운영 글 실측)
 *    🔴 id 가 비면 `null` — 빈 키로 전부를 막지 않는다
 */
export function originalSourceOf(
  site: string | null | undefined, articleId: string | null | undefined,
): { site: string; id: string } | null {
  const s0 = S(site)
  const id0 = S(articleId)
  if (id0 === '') return null
  if (isOurSite(s0)) {
    const s = s0.startsWith(MACHINE_SITE_PREFIX) ? s0.slice(MACHINE_SITE_PREFIX.length)
      : s0.slice(AUTOFILL_SITE_PREFIX.length)
    return { site: s, id: baseIdOf(baseArticleId(id0)) }
  }
  const id = s0 !== '' && id0.startsWith(`${s0}:`) ? id0.slice(s0.length + 1) : id0
  return id === '' ? null : { site: s0, id: baseIdOf(id) }
}

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

/**
 * 🔴 **묶음을 고른다.** AI 를 부르기 전에 끝난다 — 이 함수는 순수하다.
 *
 * 🔴 자리를 둘로 나눈다: **한 번도 안 본 원천**과 **이미 본 원천(재시도)**.
 *    한쪽이 다른 쪽을 굶기지 않는 것이 이 함수의 계약이다.
 *
 * 🔴 **그 전에 축으로 자리를 나눈다** (2026-09-28, `worksetAxisQuota`).
 *    상한 10 → raw 최대 2 · seed 가 충분하면 seed 8 이상 (상한 5 → 1 · 4). raw 는 빼지 않고,
 *    seed 가 모자란 자리를 raw 로 전부 채우지도 않는다(빈 자리는 비워 둔다).
 *    신규/재시도 나눔과 각 줄의 순서(댓글 수 · 오래 기다린 것부터)는 축 자리 **안에서** 그대로다.
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
  concluded: ReadonlySet<string>
  /**
   * 🔴 **지금 계약으로 이미 돌려 본 원천과 그 마지막 시각** (`attemptedOutcomes`).
   *    빼지 않는다 — 자리를 나눠 쓰고, 그 안에서는 **오래 기다린 것부터** 집는다.
   */
  attempted: ReadonlyMap<string, PriorOutcome>
  /**
   * 🔴 **정본 원천 기회 판정 — 예정 슬롯 기준 · 유료 생성 전** (`judgeSlotRelease` · 참여 동력 · 배정은 `pending`).
   *    eligible 이 아니면 고르지 않는다. 순서도 이 판정의 rank 다. 부르는 쪽이 넣는다 — 기본값이 없다.
   */
  releaseOf: (r: WorksetRow) => SlotReleaseVerdict
  limit: number
  runId: string
  takenAt: Date
}): WorksetPlan {
  const dropped: Record<WorksetDrop, number> = {
    humanDecided: 0, queueSibling: 0, alreadyQueued: 0, carriedOver: 0, hardBlocked: 0, preGated: 0, terminal: 0,
    slotIneligible: 0, slotUnknown: 0,
  }
  const releaseById = new Map<string, SlotReleaseVerdict>()
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
    // 🔴 발행된 형제까지 — 같은 원문으로 두 번째 글을 만들지 않는다
    if (hasSource(input.queuedSources, r.sourceSite, r.sourceArticleId)) { dropped.alreadyQueued += 1; continue }
    // 🔴 적재 실패 후보는 이월이 적재한다 — 다시 만들지 않는다
    if (hasSource(input.carriedOver, r.sourceSite, r.sourceArticleId)) { dropped.carriedOver += 1; continue }
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
    /**
     * 🔴 **예정 슬롯에서 eligible 인가 — 정본 판정 하나** (2026-09-30). 오래된 원문을 오늘 수집했어도,
     *    반응 증거가 없어도, 원천 상대 표본이 없어도 유료 생성에 들어가지 않는다.
     */
    const v = input.releaseOf(r)
    if (v.verdict !== 'eligible') {
      if (v.verdict === 'unknown') dropped.slotUnknown += 1
      else dropped.slotIneligible += 1
      continue
    }
    releaseById.set(r.sourceArticleId, v)
    eligible.push(r)
  }

  /** 🔴 정본 rank 사전식 비교 — 합산 점수 없음 · 마지막 열쇠는 id 다 */
  const byWeight = (a: WorksetRow, b: WorksetRow): number =>
    compareReleaseRank(releaseById.get(a.sourceArticleId)!.rank, releaseById.get(b.sourceArticleId)!.rank)
    || a.sourceArticleId.localeCompare(b.sourceArticleId)

  const fresh = eligible.filter((r) => !input.attempted.has(r.sourceArticleId)).sort(byWeight)
  const prior = (r: WorksetRow): PriorOutcome | undefined => input.attempted.get(r.sourceArticleId)
  const retry = eligible.filter((r) => input.attempted.has(r.sourceArticleId))
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

  /**
   * 🔴 **축별 자리를 먼저 정한다** (2026-09-28). 신규/재시도 자리 나눔은 그 **안에서** 그대로 돈다.
   *    원천이 전부 seed 이면 quota 가 `{ seed: limit, raw: 0 }` 이 되어 앞판과 **같은 결과**다.
   */
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

  /**
   * 🔴 **재시도에 남길 자리.** 상한이 2 이상이면 한 자리를 늘 남기고,
   *    상한이 1 이면 **가장 오래 기다린 재시도**가 기준을 넘었을 때만 그 자리를 가져간다.
   *    🔴 기준은 **자리가 있는 축의** 재시도 가운데 가장 오래 기다린 것이다.
   */
  /** 🔴 상한 1 의 굶김 기준은 **차례와 무관하게** 가장 오래 기다린 재시도다 */
  const oldestMs = retryOpen.reduce((m, r) => Math.min(m, prior(r) === undefined ? 0 : runClockOf(prior(r)!)),
    Number.POSITIVE_INFINITY)
  const waitedMs = retryOpen.length === 0 ? 0 : input.takenAt.getTime() - oldestMs
  const reserve = retryOpen.length === 0 ? 0
    : limit >= 2 ? worksetRetryReserve(limit)
      : waitedMs >= WORKSET_RETRY_STARVE_MS ? limit : 0

  /**
   * 🔴 ① 재시도 자리를 **먼저** 잡는다 — 오래 기다린 순서 그대로, 축 자리가 남은 것만.
   *    신규가 먼저 축 자리를 다 채워 버리면 남긴 재시도 자리가 비어 버린다(재시도 굶김).
   */
  const reserved = new Set<string>()
  for (const r of retryOpen) {
    if (reserved.size >= reserve) break
    if (take(r)) reserved.add(r.sourceArticleId)
  }
  // 🔴 ② 신규 — 댓글 수 순서 그대로, 남긴 재시도 자리를 빼고 축 자리 안에서
  const freshPicked: WorksetRow[] = []
  for (const r of freshOpen) {
    if (freshPicked.length >= limit - reserved.size) break
    if (take(r)) freshPicked.push(r)
  }
  // 🔴 ③ 신규가 자리를 다 못 채우면 재시도가 남은 칸을 쓴다 — 축 자리 안에서만
  const retryIds = new Set(reserved)
  for (const r of retryOpen) {
    if (freshPicked.length + retryIds.size >= limit) break
    if (retryIds.has(r.sourceArticleId)) continue
    if (take(r)) retryIds.add(r.sourceArticleId)
  }
  // 🔴 재시도는 **오래 기다린 순서** 그대로 적는다 — 먼저 잡은 자리가 앞에 오는 것이 아니다
  const retryPicked = retryOpen.filter((r) => retryIds.has(r.sourceArticleId))
  const picked = [...freshPicked, ...retryPicked]
  const pickedByAxis: Record<WorksetAxis, number> = {
    seed: picked.filter((r) => worksetAxisOf(r) === 'seed').length,
    raw: picked.filter((r) => worksetAxisOf(r) === 'raw').length,
  }

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
    axis: { eligible: eligibleByAxis, quota, picked: pickedByAxis },
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
