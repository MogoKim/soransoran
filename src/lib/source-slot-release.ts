/**
 * 🔴 **원천 기회 → 공개 슬롯 판정 — 정본은 이 파일 하나다** (2026-09-30 · source-slot-v1)
 *
 *   정본 계약(Sep 30 founder resync): 모든 단계가 같은 질문 하나에 답한다 —
 *   > 이 원천 기회가 **예정된 공개 슬롯에서도** 대화할 가치가 충분한가?
 *
 * 🔴 **이 파일이 대신한 옛 정본들 (실행 경로에서 지웠다)**
 *    · `supply-freshness.ts` — `freshnessOf`(일 단위) · `judgeCandidate` · `orderForPublish` ·
 *      `TIMELY_MARKERS`/`classifyTopic`(키워드 이벤트 분기) · `TTL_DAYS` 3단 · evergreen 28일
 *    · `supply-candidates.ageDaysAt` — 초안 시각(`sourceCapturedAt`)을 원문 시각처럼 쓴 floor 일 나이
 *    · `supply-workset` 의 원시 댓글 수 정렬(`byWeight`) — 원천 규모·관측 나이 보정 없음
 *    · `d100-stock-reader.dayAge` — 위 규칙의 복제본
 *    · 발행 트랜잭션에 없던 재판정 — 이제 같은 함수를 트랜잭션 시계로 다시 부른다
 *
 * 🔴 **판정 순서 — 첫 실패에서 멈춘다(원인 코드는 닫힌 enum)**
 *    ① 영구 hard gate — **새로 구현하지 않는다.** 기존 함수의 결과를 입력으로 받는다. 실패 → ineligible
 *    ② 원문 시각 — 게시 시각만 믿는다. 없음 · 손상 · 미래 · 수집보다 늦음 → **unknown**(fail-closed).
 *       수집 시각 · 초안 시각 · 목록 시각으로 **대신하지 않는다**(A1 §6: 네이버 `sourceListedAt` 은 회차 시작 시각 하나라
 *       수집 시각과 같은 뜻이다 — 게시 시각의 대용이 될 수 없다).
 *    ③ 슬롯 시점 나이(시간) — `slotAt − postedAt`. 상한은 **기존 hot 72h 하나**. 이벤트·키워드·상시 분기 없음
 *    ④ 반응 증거 — 수집 때 관측이 없으면 unknown. 있으면 **같은 원천 · 같은 관측 나이 구간** 안 백분위로만 비교한다
 *       (원천 규모가 raw 수를 부풀리지 못하게). velocity 는 실제 반복 관측 2개 이상일 때만
 *    ⑤ 참여 동력 — 판정기가 낸 `communityAngle` 이 없으면 unknown (새 가중치 없음 · 존재만 본다)
 *    ⑥ Persona 배정 — 기존 판정(`judgeAutoAssignment` · `planBatch`)의 결과를 입력으로 받는다. 불가 → ineligible
 *
 * 🔴 **rank 는 합산 점수가 아니다.** 가중치 없이 성분을 사전식으로 비교한다(`compareReleaseRank`).
 * 🔴 **순수 함수다.** DB · 파일 · env · 시각 조회 0 — 시각은 인자로 받는다.
 * 🔴 원문 URL · 닉네임 · 본문을 싣지 않는다 — 시각 · 수 · 해시 · 판정기 요약 한 줄뿐이다.
 */
import { createHash } from 'node:crypto'

// ─────────────────────────────────────────────────────────
// 🔴 상수 — 새 숫자를 만들지 않는다
// ─────────────────────────────────────────────────────────

/** 🔴 `gateResults` 안의 칸 — 적재기가 쓰고, 선택기 · 발행 트랜잭션 · 단계 증거가 읽는다 */
export const SOURCE_EVIDENCE_KEY = 'sourceEvidence'
export const SOURCE_EVIDENCE_VERSION = 'source-evidence-v1'

/** 🔴 발행 트랜잭션이 같은 트랜잭션에서 남기는 도장 — 단계 증거 조항 7 이 읽는다 */
export const RELEASE_STAMP_KEY = 'release'
export const RELEASE_CONTRACT = 'source-slot-v1'

/**
 * 🔴 **원문 나이 상한 72시간 — 기존 hot 경계 그대로다.**
 *    옛 판정 `floor(경과일) ≤ TTL_DAYS.hot(2)` 는 정확히 `경과시간 < 72h` 이다. 숫자를 새로 만들지 않았다.
 *    바뀐 것은 기준 시각(초안 시각 → 원문 게시 시각)과 비교 시점(지금 → 예정 슬롯)뿐이다.
 *    🔴 현재성/상시 분기(7일 · 28일)는 지웠다 — 이벤트 · 키워드로 나이를 늘리지 않는다.
 */
export const SOURCE_AGE_LIMIT_HOURS = 72

/**
 * 🔴 **허용 시계 오차 10분** — 게시 라벨은 분 단위(`15:32` · `방금 전`)이고 수집기 · DB · 러너 시계가 다르다.
 *    이 안쪽의 "미래" 는 오차로 본다. 이보다 크면 손상이다 — 추측으로 고치지 않는다.
 */
export const SOURCE_CLOCK_SKEW_MS = 10 * 60_000

/**
 * 🔴 **관측 나이 구간(시간) — 반응을 같은 나이끼리만 비교한다.**
 *    근거: A1 §3 실측 — 조회수 중앙값이 관측 나이 <3h · 3–6h · 6–12h 사이에서 2.6~3배 달라졌다
 *    (원천 사이 차이보다 컸다). 같은 구간을 그대로 쓰고, 그 뒤를 12–24h · 24–72h(나이 상한)로 닫는다.
 *    🔴 가중치가 아니다 — 비교 모집단을 나누는 경계일 뿐이다.
 */
export const OBSERVATION_AGE_EDGES_H: readonly number[] = [3, 6, 12, 24, SOURCE_AGE_LIMIT_HOURS]

const HOUR_MS = 3_600_000

// ─────────────────────────────────────────────────────────
// 🔴 원문 증거 기록 (source-evidence-v1) — 스키마 변경 없이 `gateResults` 에 산다
// ─────────────────────────────────────────────────────────

/** 🔴 수집 때 본 반응 한 번 — 없으면 null. 0 과 "안 셌다" 를 섞지 않는다 */
export type SourceResponse = {
  views: number | null
  comments: number | null
  listRank: number | null
  listPage: number | null
  /** 🔴 이 수를 본 시각(목록 회차 시각) — 없으면 null */
  observedAt: string | null
}

/** 🔴 같은 원문을 **실제로 다시 본** 관측 — 목록 회차가 달라야 한다 */
export type SourceObservation = { observedAt: string; views: number | null; comments: number | null }

/**
 * 🔴 **원천 상대 반응 — 적재 시점 스냅샷** (B-design §7). 같은 원천 · 같은 관측 나이 구간의 최근 표본 안에서
 *    이 글의 반응이 몇 백분위인가. 표본이 없으면 백분위도 없다(null) — 지어내지 않는다.
 */
export type SourceStatsSnapshot = {
  basis: 'list-artifacts'
  sourceKey: string
  /** 관측 나이 구간 라벨(`<3h` · `3-6h` …) */
  bucket: string
  /** 비교한 표본 수 — 글 기준 */
  n: number
  commentsPct: number | null
  viewsPct: number | null
  windowFrom: string
  windowTo: string
}

export type SourceProvenance = {
  /** sha256(`site::articleId`) — 원문 id 를 그대로 싣지 않는다 */
  articleIdHash: string | null
  /** 사람 검토가 artifact 한 장을 찾는 불투명 열쇠 */
  artifactId: string | null
  dedupKeyHash: string | null
}

export type SourceEvidenceRecord = {
  version: typeof SOURCE_EVIDENCE_VERSION
  /** 🔴 정규 ISO 이거나 null. 못 읽는 값은 받은 글자 그대로(64자) — "없다" 와 "손상" 을 구분한다 */
  postedAt: string | null
  listedAt: string | null
  capturedAt: string | null
  sourceKey: string | null
  response: SourceResponse | null
  observations: SourceObservation[]
  sourceStats: SourceStatsSnapshot | null
  provenance: SourceProvenance
  /** 🔴 판정기가 낸 참여 동력(`communityAngle`) — 없으면 null */
  participationDriver: string | null
  /** 🔴 초안 시각 — **신선도에 쓰지 않는다.** 감사용으로만 남긴다 */
  draftedAt: string | null
}

/** 🔴 시각 문자열이 **시간대까지 적힌 ISO** 인가 — `new Date('2026')` 같은 관대한 해석을 받지 않는다 */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

/** 🔴 적재용 시각 정규화 — 읽을 수 있으면 `toISOString()`, 못 읽으면 받은 글자(64자), 없으면 null */
export function normalizeEvidenceTime(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s === '') return null
  if (!ISO_WITH_ZONE.test(s)) return s.slice(0, 64)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s.slice(0, 64) : d.toISOString()
}

const countOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null

const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * 🔴 **적재용 기록을 만든다 — 받은 값을 옮길 뿐 지어내지 않는다.**
 *    게시 시각이 비었다고 수집 · 목록 · 초안 시각을 넣지 않는다. 반응이 비었다고 0 을 넣지 않는다.
 */
export function buildSourceEvidence(input: {
  postedAt?: unknown; listedAt?: unknown; capturedAt?: unknown
  sourceSite?: unknown; sourceArticleId?: unknown; artifactId?: unknown; dedupKey?: unknown
  response?: Partial<Record<keyof SourceResponse, unknown>> | null
  observations?: readonly SourceObservation[]
  sourceStats?: SourceStatsSnapshot | null
  participationDriver?: unknown
  draftedAt?: unknown
}): SourceEvidenceRecord {
  const site = strOrNull(input.sourceSite)
  const id = strOrNull(input.sourceArticleId)
  const r = input.response ?? null
  const response: SourceResponse | null = r === null ? null : {
    views: countOrNull(r.views), comments: countOrNull(r.comments),
    listRank: countOrNull(r.listRank), listPage: countOrNull(r.listPage),
    observedAt: normalizeEvidenceTime(r.observedAt),
  }
  const observed = response !== null && (response.views !== null || response.comments !== null)
  const dk = strOrNull(input.dedupKey)
  return {
    version: SOURCE_EVIDENCE_VERSION,
    postedAt: normalizeEvidenceTime(input.postedAt),
    listedAt: normalizeEvidenceTime(input.listedAt),
    capturedAt: normalizeEvidenceTime(input.capturedAt),
    sourceKey: site,
    // 🔴 수 하나 없이 시각만 있는 관측은 "관측 없음" 이다
    response: observed ? response : null,
    observations: distinctObservations(input.observations ?? []),
    sourceStats: input.sourceStats ?? null,
    provenance: {
      articleIdHash: site === null || id === null ? null : sha256Hex(`${site}::${id}`),
      artifactId: strOrNull(input.artifactId),
      dedupKeyHash: dk === null ? null : sha256Hex(dk),
    },
    participationDriver: strOrNull(input.participationDriver),
    draftedAt: normalizeEvidenceTime(input.draftedAt),
  }
}

/** 🔴 같은 시각의 관측은 하나로 — 한 번 본 것을 두 번 본 것으로 세지 않는다 */
function distinctObservations(xs: readonly SourceObservation[]): SourceObservation[] {
  const byAt = new Map<string, SourceObservation>()
  for (const o of xs) {
    const at = normalizeEvidenceTime(o.observedAt)
    if (at === null || strictIso(at) === 'corrupt' || strictIso(at) === null) continue
    byAt.set(at, { observedAt: at, views: countOrNull(o.views), comments: countOrNull(o.comments) })
  }
  return [...byAt.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt))
}

// ─────────────────────────────────────────────────────────
// 🔴 원천 상대 반응 — 순수 계산
// ─────────────────────────────────────────────────────────

/** 🔴 관측 나이(시간) → 구간 라벨. 나이를 모르거나 상한 밖이면 null */
export function observationBucketOf(ageH: number | null): string | null {
  if (ageH === null || !Number.isFinite(ageH) || ageH < 0) return null
  let lo = 0
  for (const hi of OBSERVATION_AGE_EDGES_H) {
    if (ageH < hi) return lo === 0 ? `<${hi}h` : `${lo}-${hi}h`
    lo = hi
  }
  return null
}

/** 🔴 중앙 순위 백분위 — (작은 수 + 같은 수의 절반) / n. 표본이 없으면 null */
export function percentileOf(value: number | null, sample: readonly number[]): number | null {
  if (value === null || sample.length === 0) return null
  let below = 0
  let equal = 0
  for (const x of sample) {
    if (x < value) below += 1
    else if (x === value) equal += 1
  }
  return Math.round(((below + equal / 2) / sample.length) * 10_000) / 10_000
}

/** 🔴 목록 관측 한 줄 — 고정글은 넣지 않는다(자리가 반응이 아니다) */
export type ListObservation = {
  sourceKey: string
  articleKey: string
  postedAt: string | null
  observedAt: string
  views: number | null
  comments: number | null
}

/**
 * 🔴 **스냅샷을 만든다.** 비교 모집단 = 같은 원천 · 관측 나이 같은 구간 · 창 `[at − 72h, at]` 안의 관측,
 *    **글마다 가장 최근 하나**(많이 보인 글이 표본을 독차지하지 않게). 창 길이도 나이 상한과 같은 72h 다.
 *    이 글의 관측 나이를 모르면(게시 시각 모름) 구간을 정할 수 없다 → null.
 */
export function sourceStatsSnapshot(input: {
  sourceKey: string
  articleKey: string
  postedAt: string | null
  observedAt: string | null
  comments: number | null
  views: number | null
  sample: readonly ListObservation[]
  at: Date
}): SourceStatsSnapshot | null {
  const posted = strictIso(input.postedAt)
  const observed = strictIso(input.observedAt)
  if (!(posted instanceof Date) || !(observed instanceof Date)) return null
  const bucket = observationBucketOf((observed.getTime() - posted.getTime()) / HOUR_MS)
  if (bucket === null) return null
  const toMs = input.at.getTime()
  const fromMs = toMs - SOURCE_AGE_LIMIT_HOURS * HOUR_MS
  const latest = new Map<string, ListObservation>()
  for (const o of input.sample) {
    if (o.sourceKey !== input.sourceKey) continue
    const om = strictIso(o.observedAt)
    const pm = strictIso(o.postedAt)
    if (!(om instanceof Date) || !(pm instanceof Date)) continue
    if (om.getTime() < fromMs || om.getTime() > toMs) continue
    if (observationBucketOf((om.getTime() - pm.getTime()) / HOUR_MS) !== bucket) continue
    const prev = latest.get(o.articleKey)
    if (prev === undefined || prev.observedAt < o.observedAt) latest.set(o.articleKey, o)
  }
  const rows = [...latest.values()]
  const comments = rows.map((r) => r.comments).filter((x): x is number => x !== null)
  const views = rows.map((r) => r.views).filter((x): x is number => x !== null)
  return {
    basis: 'list-artifacts', sourceKey: input.sourceKey, bucket, n: rows.length,
    commentsPct: percentileOf(input.comments, comments),
    viewsPct: percentileOf(input.views, views),
    windowFrom: new Date(fromMs).toISOString(), windowTo: input.at.toISOString(),
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 기록 읽기 — 발행 쪽은 정규형만 믿는다
// ─────────────────────────────────────────────────────────

/** 🔴 정규형(`toISOString()`)만 받는다 — 적재기가 그렇게 쓴다. 나머지는 손상이다 */
function strictIso(s: unknown): Date | 'corrupt' | null {
  if (s === null || s === undefined) return null
  if (typeof s !== 'string') return 'corrupt'
  if (s.trim() === '') return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime()) || d.toISOString() !== s) return 'corrupt'
  return d
}

export type EvidenceRead =
  | { ok: true; record: SourceEvidenceRecord }
  | { ok: false; code: 'EVIDENCE_MISSING' | 'EVIDENCE_INVALID' }

/**
 * 🔴 **`gateResults` 에서 기록을 읽는다.** 칸이 없으면 모르는 것이다(이 판 이전 적재 · 사람 후보 · backfill 없음).
 *    기록 자체(버전 · 모양)를 확인할 뿐 판정은 `judgeSlotRelease` 가 한다.
 */
export function readSourceEvidence(gateResults: unknown): EvidenceRead {
  if (gateResults === null || typeof gateResults !== 'object' || Array.isArray(gateResults)) {
    return { ok: false, code: 'EVIDENCE_MISSING' }
  }
  const rec = (gateResults as Record<string, unknown>)[SOURCE_EVIDENCE_KEY]
  if (rec === undefined || rec === null) return { ok: false, code: 'EVIDENCE_MISSING' }
  return parseEvidence(rec)
}

/** 🔴 기록 한 개(이미 꺼낸 값)를 확인한다 — 공급 쪽 묶음 선택도 같은 확인을 지난다 */
export function parseEvidence(rec: unknown): EvidenceRead {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, code: 'EVIDENCE_INVALID' }
  const r = rec as Record<string, unknown>
  if (r.version !== SOURCE_EVIDENCE_VERSION) return { ok: false, code: 'EVIDENCE_INVALID' }
  const obs = Array.isArray(r.observations) ? r.observations : null
  const prov = r.provenance
  if (obs === null || prov === null || typeof prov !== 'object') return { ok: false, code: 'EVIDENCE_INVALID' }
  return { ok: true, record: r as unknown as SourceEvidenceRecord }
}

// ─────────────────────────────────────────────────────────
// 🔴 판정
// ─────────────────────────────────────────────────────────

export const RELEASE_REASONS = [
  'HARD_GATE',
  'EVIDENCE_MISSING', 'EVIDENCE_INVALID',
  'POSTED_MISSING', 'POSTED_CORRUPT', 'CAPTURED_MISSING', 'CAPTURED_CORRUPT',
  'CAPTURED_IN_FUTURE', 'POSTED_AFTER_CAPTURE', 'POSTED_IN_FUTURE',
  'SOURCE_TOO_OLD_AT_SLOT',
  'RESPONSE_UNOBSERVED', 'RESPONSE_UNNORMALIZED',
  'DRIVER_UNKNOWN',
  'NO_PERSONA_AT_SLOT',
] as const
export type ReleaseReason = (typeof RELEASE_REASONS)[number]

export const RELEASE_REASON_LABEL: Readonly<Record<ReleaseReason, string>> = {
  HARD_GATE: '영구 hard gate 실패(안전 · 품질 계약 · 독창성 · 중복 …)',
  EVIDENCE_MISSING: '원문 증거 기록이 없다(이 계약 이전 적재 · 사람 후보 — backfill 없음)',
  EVIDENCE_INVALID: '원문 증거 기록의 판 · 모양이 다르다',
  POSTED_MISSING: '원문 게시 시각을 모른다',
  POSTED_CORRUPT: '원문 게시 시각이 손상됐다',
  CAPTURED_MISSING: '원문 수집 시각을 모른다 — 게시가 수집보다 앞인지 확인할 수 없다',
  CAPTURED_CORRUPT: '원문 수집 시각이 손상됐다',
  CAPTURED_IN_FUTURE: '원문 수집 시각이 판정 시각보다 미래다',
  POSTED_AFTER_CAPTURE: '게시 시각이 수집 시각보다 늦다 — 올라오기 전에 볼 수 없다',
  POSTED_IN_FUTURE: '게시 시각이 판정 시각보다 미래다',
  SOURCE_TOO_OLD_AT_SLOT: `예정 슬롯에서 원문 나이가 ${SOURCE_AGE_LIMIT_HOURS}시간 이상이다`,
  RESPONSE_UNOBSERVED: '수집 때 관측한 반응이 없다',
  RESPONSE_UNNORMALIZED: '같은 원천 · 같은 관측 나이의 비교 표본이 없다 — raw 수로 비교하지 않는다',
  DRIVER_UNKNOWN: '참여 동력(판정기 communityAngle)이 없다',
  NO_PERSONA_AT_SLOT: '그 슬롯에 배정할 Persona 가 없다(기존 배정 판정)',
}

/** 🔴 원천 가치가 사라진 이유 — 이 코드들만 행을 만료시킨다(hard gate · Persona 는 만료 사유가 아니다) */
export const EXPIRING_REASONS: readonly ReleaseReason[] = [
  'EVIDENCE_MISSING', 'EVIDENCE_INVALID',
  'POSTED_MISSING', 'POSTED_CORRUPT', 'CAPTURED_MISSING', 'CAPTURED_CORRUPT',
  'CAPTURED_IN_FUTURE', 'POSTED_AFTER_CAPTURE', 'POSTED_IN_FUTURE',
  'SOURCE_TOO_OLD_AT_SLOT', 'RESPONSE_UNOBSERVED', 'RESPONSE_UNNORMALIZED', 'DRIVER_UNKNOWN',
]

export type ReleaseVerdictKind = 'eligible' | 'ineligible' | 'unknown'

/** 🔴 비교 성분 — 합산하지 않는다. 비교는 `compareReleaseRank` 하나다 */
export type ReleaseRank = {
  /** 같은 원천 · 같은 관측 나이 안 댓글 백분위 — 대화 신호가 먼저다 */
  commentsPct: number | null
  /** 같은 모집단 안 조회 백분위 — 같은 댓글 백분위끼리만 가른다 */
  viewsPct: number | null
  /** 예정 슬롯에서의 원문 나이(시간) — 어린 것이 먼저 */
  ageAtSlotH: number | null
  /** 실제 반복 관측 2개 이상일 때만 — 시간당 댓글 증가 */
  velocity: number | null
  /** 마지막 열쇠 — 같은 입력이면 같은 순서 */
  tieBreak: string
}

export type HardGateInput = { ok: boolean; codes: readonly string[] }
export type AssignmentInput =
  | { ok: true }
  | { ok: false; route: 'defer' | 'exception'; codes: readonly string[] }

export type SlotReleaseInput = {
  /** `gateResults` 전체 또는 이미 꺼낸 `sourceEvidence` — 둘 중 하나 */
  gateResults?: unknown
  evidence?: unknown
  slotAt: Date
  /** 판정 시각 — 미래 판정의 기준이다 */
  now: Date
  hardGates: HardGateInput
  /**
   * 🔴 Persona 배정 결과 — **유료 생성 전**(공급 묶음)에는 아직 없다: `'pending'`.
   *    발행 계획 · 발행 트랜잭션은 반드시 결과를 넘긴다(검사가 호출부를 본다).
   */
  assignment: AssignmentInput | 'pending'
  /**
   * 🔴 참여 동력도 **유료 판정(judge)이 만든다** — 공급 묶음 선택은 그 앞이라 `'pending'` 으로만 둘 수 있다.
   *    발행 쪽 호출부는 이 칸을 쓰지 않는다.
   */
  driver?: 'pending'
  tieBreak: string
}

export type SlotReleaseVerdict = {
  verdict: ReleaseVerdictKind
  /** 🔴 첫 실패 하나 — 코드만(문구 · 원문 없음) */
  reasons: ReleaseReason[]
  /** 🔴 원천 가치가 사라져 행을 만료시킬 사유인가 — hard gate · Persona 는 아니다 */
  expires: boolean
  /** 🔴 아직 없는 입력(공급 묶음 선택에서만) */
  pending: ('driver' | 'assignment')[]
  rank: ReleaseRank
  evidenceVersion: string | null
  slotAt: string
  evaluatedAt: string
}

/**
 * 🔴 **정본 판정.** 공급 묶음 · 발행 계획 · 발행 트랜잭션 · 단계 증거 · 관제가 이 함수 하나를 부른다.
 */
export function judgeSlotRelease(i: SlotReleaseInput): SlotReleaseVerdict {
  const rank: ReleaseRank = { commentsPct: null, viewsPct: null, ageAtSlotH: null, velocity: null, tieBreak: i.tieBreak }
  const pending: ('driver' | 'assignment')[] = []
  let evidenceVersion: string | null = null
  const out = (verdict: ReleaseVerdictKind, reason: ReleaseReason | null): SlotReleaseVerdict => ({
    verdict, reasons: reason === null ? [] : [reason],
    expires: reason !== null && EXPIRING_REASONS.includes(reason),
    pending, rank, evidenceVersion,
    slotAt: i.slotAt.toISOString(), evaluatedAt: i.now.toISOString(),
  })

  // ① 영구 hard gate — 결과만 받는다
  if (!i.hardGates.ok) return out('ineligible', 'HARD_GATE')

  // ② 원문 시각
  const read = i.evidence !== undefined ? parseEvidence(i.evidence) : readSourceEvidence(i.gateResults)
  if (!read.ok) return out('unknown', read.code)
  const ev = read.record
  evidenceVersion = ev.version
  const posted = strictIso(ev.postedAt)
  if (posted === null) return out('unknown', 'POSTED_MISSING')
  if (posted === 'corrupt') return out('unknown', 'POSTED_CORRUPT')
  const captured = strictIso(ev.capturedAt)
  if (captured === null) return out('unknown', 'CAPTURED_MISSING')
  if (captured === 'corrupt') return out('unknown', 'CAPTURED_CORRUPT')
  if (captured.getTime() - i.now.getTime() > SOURCE_CLOCK_SKEW_MS) return out('unknown', 'CAPTURED_IN_FUTURE')
  if (posted.getTime() - captured.getTime() > SOURCE_CLOCK_SKEW_MS) return out('unknown', 'POSTED_AFTER_CAPTURE')
  if (posted.getTime() - i.now.getTime() > SOURCE_CLOCK_SKEW_MS) return out('unknown', 'POSTED_IN_FUTURE')

  // ③ 슬롯 시점 나이 — 시간 단위 · floor 없음
  const ageAtSlotH = Math.max(0, i.slotAt.getTime() - posted.getTime()) / HOUR_MS
  rank.ageAtSlotH = Math.round(ageAtSlotH * 1000) / 1000
  if (!(ageAtSlotH < SOURCE_AGE_LIMIT_HOURS)) return out('ineligible', 'SOURCE_TOO_OLD_AT_SLOT')

  // ④ 반응 증거 — 관측이 없으면 모른다 · 원천 상대로만 비교한다
  const resp = ev.response
  if (resp === null || (resp.comments === null && resp.views === null)) return out('unknown', 'RESPONSE_UNOBSERVED')
  const stats = ev.sourceStats
  rank.commentsPct = stats?.commentsPct ?? null
  rank.viewsPct = stats?.viewsPct ?? null
  rank.velocity = velocityOf(ev.observations)
  if (stats === null || stats.n === 0 || (stats.commentsPct === null && stats.viewsPct === null)) {
    return out('unknown', 'RESPONSE_UNNORMALIZED')
  }

  // ⑤ 참여 동력
  if (i.driver === 'pending') pending.push('driver')
  else if ((ev.participationDriver ?? '').trim() === '') return out('unknown', 'DRIVER_UNKNOWN')

  // ⑥ Persona
  if (i.assignment === 'pending') pending.push('assignment')
  else if (!i.assignment.ok) return out('ineligible', 'NO_PERSONA_AT_SLOT')

  return out('eligible', null)
}

/**
 * 🔴 **velocity — 실제로 다시 본 관측이 2개 이상일 때만.** 한 번 본 수를 시간으로 나눠 속도라 부르지 않는다.
 *    시간당 댓글 증가(첫 관측 → 마지막 관측). 댓글을 둘 다 못 셌으면 null.
 */
export function velocityOf(observations: readonly SourceObservation[]): number | null {
  const xs = distinctObservations(observations)
  if (xs.length < 2) return null
  const a = xs[0]!
  const b = xs[xs.length - 1]!
  if (a.comments === null || b.comments === null) return null
  const hours = (Date.parse(b.observedAt) - Date.parse(a.observedAt)) / HOUR_MS
  if (!(hours > 0)) return null
  return Math.round(((b.comments - a.comments) / hours) * 1000) / 1000
}

const desc = (a: number | null, b: number | null): number =>
  (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : b - a)
const asc = (a: number | null, b: number | null): number =>
  (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : a - b)

/**
 * 🔴 **사전식 비교 — 가중치 없음.** 댓글 백분위 ↓ → 조회 백분위 ↓ → 슬롯 나이 ↑ → velocity ↓(없으면 뒤) → tieBreak.
 *    모르는 성분은 언제나 뒤다.
 */
export function compareReleaseRank(a: ReleaseRank, b: ReleaseRank): number {
  return desc(a.commentsPct, b.commentsPct)
    || desc(a.viewsPct, b.viewsPct)
    || asc(a.ageAtSlotH, b.ageAtSlotH)
    || desc(a.velocity, b.velocity)
    || a.tieBreak.localeCompare(b.tieBreak)
}

// ─────────────────────────────────────────────────────────
// 🔴 발행 도장 — 발행 트랜잭션이 같은 트랜잭션에서 쓴다 · 단계 증거가 읽는다
// ─────────────────────────────────────────────────────────

export type ReleaseStamp = {
  contract: typeof RELEASE_CONTRACT
  verdict: ReleaseVerdictKind
  slotAt: string
  evaluatedAt: string
  reasons: ReleaseReason[]
  evidenceVersion: string | null
}

export function releaseStampOf(v: SlotReleaseVerdict): ReleaseStamp {
  return {
    contract: RELEASE_CONTRACT, verdict: v.verdict, slotAt: v.slotAt, evaluatedAt: v.evaluatedAt,
    reasons: [...v.reasons], evidenceVersion: v.evidenceVersion,
  }
}

/**
 * 🔴 **이 행이 지금 계약으로 나갔는가** — 단계 증거 조항 7.
 *    · `STAMPED_ELIGIBLE` 지금 계약 · eligible 도장
 *    · `MISSING`          도장이 없다(이 계약 이전 발행 · 우회 발행)
 *    · `STALE`            다른 계약 판이거나 eligible 이 아닌 도장
 */
export function releaseStampStatusOf(gateResults: unknown): 'STAMPED_ELIGIBLE' | 'MISSING' | 'STALE' {
  if (gateResults === null || typeof gateResults !== 'object' || Array.isArray(gateResults)) return 'MISSING'
  const s = (gateResults as Record<string, unknown>)[RELEASE_STAMP_KEY]
  if (s === undefined || s === null || typeof s !== 'object' || Array.isArray(s)) return 'MISSING'
  const r = s as Record<string, unknown>
  return r.contract === RELEASE_CONTRACT && r.verdict === 'eligible' ? 'STAMPED_ELIGIBLE' : 'STALE'
}

/** 사람이 읽는 한 줄 — 코드와 수만 */
export function describeRelease(v: SlotReleaseVerdict): string {
  const r = v.rank
  const f = (x: number | null): string => (x === null ? '—' : String(x))
  return `${v.verdict}${v.reasons.length > 0 ? ` [${v.reasons.join(',')}]` : ''}`
    + ` · 댓글pct ${f(r.commentsPct)} · 조회pct ${f(r.viewsPct)} · 슬롯나이 ${f(r.ageAtSlotH)}h · velocity ${f(r.velocity)}`
    + (v.pending.length > 0 ? ` · 대기 ${v.pending.join('·')}` : '')
}

// ─────────────────────────────────────────────────────────
// 🔴 슬롯 짝짓기 — JIT 수요 · 증명일 기회가 같은 함수를 쓴다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **기회 하나** — 어느 슬롯에서 eligible 인가는 부르는 쪽이 **정본 판정으로** 넘긴다(`validAt`).
 *    `personaCode` 가 있으면 같은 날 두 슬롯을 한 사람이 받지 못한다(모든 단계 최소 간격 ≥ 1일).
 */
export type SlotOpportunity = {
  key: string
  validAt: (slotAt: Date) => boolean
  personaCode?: string | null
}

/**
 * 🔴 **슬롯을 시각순으로 채운다 — 가장 먼저 가치가 사라지는 기회부터.** (마감이 이른 것 우선 · 순수)
 *    각 슬롯에서 아직 쓰지 않은 · 그 슬롯에 eligible 인 · 같은 날 Persona 가 겹치지 않는 기회 중
 *    **마지막으로 eligible 인 슬롯이 가장 이른 것**을 고른다. 합산 점수 없음.
 *    반환: 채운 슬롯 수와 슬롯별 짝(없으면 null).
 */
export function matchOpportunitiesToSlots(
  slots: readonly Date[], opportunities: readonly SlotOpportunity[],
): { filled: number; bySlot: (string | null)[] } {
  const sorted = [...slots].map((d, i) => ({ d, i })).sort((a, b) => a.d.getTime() - b.d.getTime())
  const valid = opportunities.map((o) => sorted.map((s) => o.validAt(s.d)))
  const lastValid = valid.map((v) => v.lastIndexOf(true))
  const used = new Set<number>()
  const personasByDay = new Map<string, Set<string>>()
  const bySlot: (string | null)[] = slots.map(() => null)
  let filled = 0
  sorted.forEach((s, k) => {
    const day = new Date(s.d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
    const taken = personasByDay.get(day) ?? new Set<string>()
    let pick = -1
    for (let j = 0; j < opportunities.length; j += 1) {
      if (used.has(j) || !valid[j]![k]) continue
      const code = opportunities[j]!.personaCode ?? null
      if (code !== null && taken.has(code)) continue
      if (pick < 0 || lastValid[j]! < lastValid[pick]!
        || (lastValid[j] === lastValid[pick] && opportunities[j]!.key < opportunities[pick]!.key)) pick = j
    }
    if (pick < 0) return
    used.add(pick)
    const code = opportunities[pick]!.personaCode ?? null
    if (code !== null) { taken.add(code); personasByDay.set(day, taken) }
    bySlot[s.i] = opportunities[pick]!.key
    filled += 1
  })
  return { filled, bySlot }
}
