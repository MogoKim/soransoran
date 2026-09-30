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
 *       🔴 (Lane B) 기록은 **모든 중첩 칸**을 먼저 확인한다(`parseEvidence`) — 손상은 예외가 아니라
 *       `EVIDENCE_INVALID` + 손상 위치(`issue`)다. 게시 · 수집 코드 다음에 중첩 시각의 순서 · 미래를 본다.
 *    ④ 반응 증거 — 수집 때 관측이 없으면 unknown. 있으면 **같은 원천 · 같은 관측 나이 구간** 안 백분위로만 비교한다
 *       (원천 규모가 raw 수를 부풀리지 못하게). velocity 는 실제 반복 관측 2개 이상일 때만.
 *       🔴 (Lane B) 백분위는 **후보 자신을 뺀** 표본에 서로 다른 값이 둘 이상일 때만 선다(`relativePosition`) —
 *       표본 0 · 1 · 한 점 분포는 정규화 신뢰도가 없다 → unknown. 새 최소 수 · 최소 조회수는 없다
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
 * 🔴 **정규화 방법 판** — 스냅샷이 이 판이 아니면 판정은 `RESPONSE_UNNORMALIZED` 로 읽는다.
 *    `leave-one-out-spread-v1` (2026-09-30 Lane B): 앞판(판 표시 없음)은 **후보 자신을 비교 표본에 넣었고**
 *    표본이 자기 1건 · 전부 같은 값이어도 백분위 0.5 를 냈다 — 비교할 것이 없는데 "중간" 이라고 말했다(재현).
 *    이제 ① 자기 자신을 빼고 ② 남은 표본에 서로 다른 값이 둘 이상일 때만 백분위를 낸다(`relativePosition`).
 *    🔴 새 최소 표본 수 · 최소 조회수가 아니다 — "분포가 한 점이면 그 안의 자리는 정의되지 않는다" 는 정의다.
 */
export const SOURCE_STATS_METHOD = 'leave-one-out-spread-v1'

/**
 * 🔴 **원천 상대 반응 — 적재 시점 스냅샷** (B-design §7). 같은 원천 · 같은 관측 나이 구간의 최근 표본 안에서
 *    이 글의 반응이 몇 백분위인가. 표본이 없으면 백분위도 없다(null) — 지어내지 않는다.
 */
export type SourceStatsSnapshot = {
  basis: 'list-artifacts'
  /** 🔴 정규화 방법 판 — `SOURCE_STATS_METHOD` 가 아니면 판정이 정규화되지 않은 것으로 읽는다 */
  method: string
  sourceKey: string
  /** 관측 나이 구간 라벨(`<3h` · `3-6h` …) */
  bucket: string
  /** 비교한 표본 수 — 글 기준 · 🔴 후보 자신은 빼고 센다 */
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

/**
 * 🔴 같은 시각의 관측은 하나로 — 한 번 본 것을 두 번 본 것으로 세지 않는다.
 *    🔴 파일에서 온 배열이라 원소가 객체라는 보장이 없다 — 객체가 아닌 원소는 관측이 아니다(던지지 않는다).
 */
function distinctObservations(xs: readonly unknown[]): SourceObservation[] {
  const byAt = new Map<string, SourceObservation>()
  for (const x of xs) {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) continue
    const o = x as Record<string, unknown>
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

/**
 * 🔴 **원천 상대 자리 — 정규화 신뢰도가 있을 때만** (leave-one-out-spread-v1).
 *    `sample` 은 **후보 자신을 뺀** 같은 원천 · 같은 관측 나이 구간의 값이다.
 *    서로 다른 값이 둘 미만이면(표본 0 · 1 · 전부 같은 값) 분포에 모양이 없다 — 그 안의 자리를 말하지 않는다(null).
 *    🔴 크기 기준(최소 n · 최소 조회수)을 만들지 않는다. 극단치는 순위 기반이라 자기 한 칸만 움직인다.
 */
export function relativePosition(value: number | null, sample: readonly number[]): number | null {
  if (value === null || new Set(sample).size < 2) return null
  return percentileOf(value, sample)
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
    // 🔴 후보 자신은 비교 표본이 아니다 — 자기와 비교하면 표본 1건이 "중간(0.5)" 을 만든다(재현)
    if (o.articleKey === input.articleKey) continue
    const prev = latest.get(o.articleKey)
    if (prev === undefined || prev.observedAt < o.observedAt) latest.set(o.articleKey, o)
  }
  const rows = [...latest.values()]
  const comments = rows.map((r) => r.comments).filter((x): x is number => x !== null)
  const views = rows.map((r) => r.views).filter((x): x is number => x !== null)
  return {
    basis: 'list-artifacts', method: SOURCE_STATS_METHOD, sourceKey: input.sourceKey, bucket, n: rows.length,
    commentsPct: relativePosition(input.comments, comments),
    viewsPct: relativePosition(input.views, views),
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

/**
 * 🔴 **읽기 결과 — 실패면 어디가 왜 틀렸는지(`issue`)를 함께 낸다.**
 *    `issue` 는 **경로와 종류만** 담는다(`observations[0]:not-object`) — 값 · 원문 · 식별자는 싣지 않는다.
 *    감사(release 도장 · `declineReason`) · 운영 진단(보류 줄)이 이 문자열로 손상 위치를 식별한다.
 */
export type EvidenceRead =
  | { ok: true; record: SourceEvidenceRecord }
  | { ok: false; code: 'EVIDENCE_MISSING' | 'EVIDENCE_INVALID'; issue: string | null }

/**
 * 🔴 **`gateResults` 에서 기록을 읽는다.** 칸이 없으면 모르는 것이다(이 판 이전 적재 · 사람 후보 · backfill 없음).
 *    기록 자체(모든 중첩 칸의 타입 · 범위 · 순서)를 확인할 뿐 판정은 `judgeSlotRelease` 가 한다.
 */
export function readSourceEvidence(gateResults: unknown): EvidenceRead {
  if (gateResults === null || typeof gateResults !== 'object' || Array.isArray(gateResults)) {
    return { ok: false, code: 'EVIDENCE_MISSING', issue: null }
  }
  const rec = (gateResults as Record<string, unknown>)[SOURCE_EVIDENCE_KEY]
  if (rec === undefined || rec === null) return { ok: false, code: 'EVIDENCE_MISSING', issue: null }
  return parseEvidence(rec)
}

/** 🔴 관측 나이 구간 라벨 — `observationBucketOf` 가 낼 수 있는 값만 */
const BUCKET_LABELS: ReadonlySet<string> = new Set(
  OBSERVATION_AGE_EDGES_H.map((hi, k) => (k === 0 ? `<${hi}h` : `${OBSERVATION_AGE_EDGES_H[k - 1]}-${hi}h`)),
)
const HEX64 = /^[0-9a-f]{64}$/
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
/** 🔴 센 수 — 음 아닌 안전 정수 또는 null. NaN · Infinity · 소수 · 문자열은 손상이다 */
const isCountOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)
const isPctOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
const isStrOrNull = (v: unknown): boolean => v === null || typeof v === 'string'
/** 🔴 정규 ISO(`toISOString()`) — 적재기가 이 모양으로만 쓴다 */
const canonicalIso = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) || d.toISOString() !== v ? null : d
}

/**
 * 🔴 **기록 한 개(이미 꺼낸 값)를 끝까지 확인한다** — 공급 묶음 · 기회 스냅샷 · 발행 계획 · 발행 트랜잭션이 같은 확인을 지난다.
 *
 *    앞판은 판 · `observations` 배열 여부 · `provenance` 객체 여부만 봤다. 그래서 `observations: [null]` 은
 *    판정 안에서 **TypeError 로 러너를 죽였고**, `response: "x"` · 댓글 `NaN` · 표본 `n: -1` 은 **eligible** 로 통과했다(재현).
 *    이제 모든 중첩 칸을 본다. 첫 문제에서 멈추고 `issue` 에 경로와 종류를 적는다.
 *
 *    · 게시 · 수집 시각은 **문자열이면 받는다** — 손상 · 미래 · 순서는 판정이 고유 코드로 낸다(POSTED_CORRUPT …)
 *    · 목록 · 초안 · 관측 · 표본 창 시각은 정규 ISO 이거나 null 이어야 한다 · 표본 창은 끝 ≥ 시작
 *    · 표본의 원천은 기록의 원천과 같아야 한다 — 🔴 다른 원천 표본으로 정규화하면 원천 규모가 raw 수를 부풀린다
 *    · 시각 **순서**(게시보다 이른 관측 · 판정 시각보다 미래)는 `evidenceTimeIssue` 가 본다 — 판정 시각이 필요하고,
 *      게시 · 수집 시각의 고유 코드(POSTED_AFTER_CAPTURE …)가 먼저 나와야 해서 판정 안에서 그 뒤에 부른다
 */
export function parseEvidence(rec: unknown): EvidenceRead {
  const bad = (issue: string): EvidenceRead => ({ ok: false, code: 'EVIDENCE_INVALID', issue })
  if (!isObj(rec)) return bad('record:not-object')
  const r = rec
  if (r.version !== SOURCE_EVIDENCE_VERSION) return bad('version:mismatch')
  for (const k of ['postedAt', 'capturedAt'] as const) {
    if (!(r[k] === null || (typeof r[k] === 'string' && (r[k] as string).length <= 64))) return bad(`${k}:type`)
  }
  for (const k of ['listedAt', 'draftedAt'] as const) {
    if (r[k] !== null && canonicalIso(r[k]) === null) return bad(`${k}:corrupt`)
  }
  if (!(r.sourceKey === null || (typeof r.sourceKey === 'string' && r.sourceKey.trim() !== ''))) return bad('sourceKey:type')
  if (!isStrOrNull(r.participationDriver)) return bad('participationDriver:type')

  // ── 반응 ──
  if (r.response !== null) {
    if (!isObj(r.response)) return bad('response:not-object')
    for (const k of ['views', 'comments', 'listRank', 'listPage'] as const) {
      if (!isCountOrNull(r.response[k])) return bad(`response.${k}:not-count`)
    }
    if (r.response.observedAt !== null && canonicalIso(r.response.observedAt) === null) return bad('response.observedAt:corrupt')
  }

  // ── 반복 관측 ──
  if (!Array.isArray(r.observations)) return bad('observations:not-array')
  for (let i = 0; i < r.observations.length; i += 1) {
    const o: unknown = r.observations[i]
    if (!isObj(o)) return bad(`observations[${i}]:not-object`)
    if (canonicalIso(o.observedAt) === null) return bad(`observations[${i}].observedAt:corrupt`)
    if (!isCountOrNull(o.views)) return bad(`observations[${i}].views:not-count`)
    if (!isCountOrNull(o.comments)) return bad(`observations[${i}].comments:not-count`)
  }

  // ── 원천 상대 표본 ──
  if (r.sourceStats !== null) {
    const s = r.sourceStats
    if (!isObj(s)) return bad('sourceStats:not-object')
    if (s.basis !== 'list-artifacts') return bad('sourceStats.basis:mismatch')
    if (!(s.method === undefined || typeof s.method === 'string')) return bad('sourceStats.method:type')
    if (typeof s.sourceKey !== 'string' || s.sourceKey !== r.sourceKey) return bad('sourceStats.sourceKey:cross-source')
    if (typeof s.bucket !== 'string' || !BUCKET_LABELS.has(s.bucket)) return bad('sourceStats.bucket:unknown')
    if (!(typeof s.n === 'number' && Number.isSafeInteger(s.n) && s.n >= 0)) return bad('sourceStats.n:not-count')
    if (!isPctOrNull(s.commentsPct)) return bad('sourceStats.commentsPct:out-of-range')
    if (!isPctOrNull(s.viewsPct)) return bad('sourceStats.viewsPct:out-of-range')
    const from = canonicalIso(s.windowFrom)
    const to = canonicalIso(s.windowTo)
    if (from === null || to === null) return bad('sourceStats.window:corrupt')
    if (to.getTime() < from.getTime()) return bad('sourceStats.window:end-before-start')
  }

  // ── 출처 ──
  if (!isObj(r.provenance)) return bad('provenance:not-object')
  for (const k of ['articleIdHash', 'dedupKeyHash'] as const) {
    const v = r.provenance[k]
    if (!(v === null || (typeof v === 'string' && HEX64.test(v)))) return bad(`provenance.${k}:not-hash`)
  }
  if (!isStrOrNull(r.provenance.artifactId)) return bad('provenance.artifactId:type')
  return { ok: true, record: r as unknown as SourceEvidenceRecord }
}

/**
 * 🔴 **중첩 시각의 순서 · 미래 — 모양을 지난 기록에서만** (끝 < 시작 · 미래 시각). 문제가 없으면 null.
 *    · 게시 시각보다 이른 목록 · 반응 · 반복 관측 시각 — 올라오기 전에 볼 수 없다(`…:before-posted`)
 *    · 판정 시각보다 미래인 목록 · 반응 · 관측 · 표본 창 끝(`…:future`)
 *    허용 오차는 판정과 같은 `SOURCE_CLOCK_SKEW_MS` 다. 경로와 종류만 돌려준다(값 없음).
 */
export function evidenceTimeIssue(ev: SourceEvidenceRecord, now: Date): string | null {
  const posted = canonicalIso(ev.postedAt)
  const timed: [string, unknown][] = [
    ['listedAt', ev.listedAt],
    ['response.observedAt', ev.response?.observedAt ?? null],
    ...ev.observations.map((o, i): [string, unknown] => [`observations[${i}].observedAt`, o.observedAt]),
    ['sourceStats.windowTo', ev.sourceStats?.windowTo ?? null],
  ]
  for (const [path, v] of timed) {
    const d = canonicalIso(v)
    if (d === null) continue
    if (path !== 'sourceStats.windowTo' && posted !== null && posted.getTime() - d.getTime() > SOURCE_CLOCK_SKEW_MS) return `${path}:before-posted`
    if (d.getTime() - now.getTime() > SOURCE_CLOCK_SKEW_MS) return `${path}:future`
  }
  return null
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
  EVIDENCE_INVALID: '원문 증거 기록의 판 · 모양 · 중첩 칸이 손상됐다(어디가 왜 — 판정의 issue)',
  POSTED_MISSING: '원문 게시 시각을 모른다',
  POSTED_CORRUPT: '원문 게시 시각이 손상됐다',
  CAPTURED_MISSING: '원문 수집 시각을 모른다 — 게시가 수집보다 앞인지 확인할 수 없다',
  CAPTURED_CORRUPT: '원문 수집 시각이 손상됐다',
  CAPTURED_IN_FUTURE: '원문 수집 시각이 판정 시각보다 미래다',
  POSTED_AFTER_CAPTURE: '게시 시각이 수집 시각보다 늦다 — 올라오기 전에 볼 수 없다',
  POSTED_IN_FUTURE: '게시 시각이 판정 시각보다 미래다',
  SOURCE_TOO_OLD_AT_SLOT: `예정 슬롯에서 원문 나이가 ${SOURCE_AGE_LIMIT_HOURS}시간 이상이다`,
  RESPONSE_UNOBSERVED: '수집 때 관측한 반응이 없다',
  RESPONSE_UNNORMALIZED: '같은 원천 · 같은 관측 나이의 비교 표본이 없거나 한 점이다(자기 제외 서로 다른 값 2개 미만 · 옛 정규화 판) — raw 수로 비교하지 않는다',
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
  /**
   * 🔴 **손상 위치** — `EVIDENCE_INVALID` 일 때 경로와 종류(`observations[0]:not-object`). 그 밖에는 null.
   *    값 · 원문 · 식별자를 싣지 않는다 — 감사 도장 · 운영 진단이 그대로 옮겨 적는다.
   */
  issue: string | null
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
  const out = (verdict: ReleaseVerdictKind, reason: ReleaseReason | null, issue: string | null = null): SlotReleaseVerdict => ({
    verdict, reasons: reason === null ? [] : [reason], issue,
    expires: reason !== null && EXPIRING_REASONS.includes(reason),
    pending, rank, evidenceVersion,
    slotAt: i.slotAt.toISOString(), evaluatedAt: i.now.toISOString(),
  })

  // ① 영구 hard gate — 결과만 받는다
  if (!i.hardGates.ok) return out('ineligible', 'HARD_GATE')

  // ② 원문 시각
  // 🔴 모든 중첩 칸을 확인한 기록만 판정에 들어온다 — 손상은 예외가 아니라 닫힌 사유(EVIDENCE_INVALID + issue)다
  const read = i.evidence !== undefined ? parseEvidence(i.evidence) : readSourceEvidence(i.gateResults)
  if (!read.ok) return out('unknown', read.code, read.issue)
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
  // 🔴 중첩 시각(목록 · 반응 · 반복 관측 · 표본 창)의 순서 · 미래 — 게시 · 수집 고유 코드 다음이다
  const timeIssue = evidenceTimeIssue(ev, i.now)
  if (timeIssue !== null) return out('unknown', 'EVIDENCE_INVALID', timeIssue)

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
  // 🔴 지금 정규화 판(`SOURCE_STATS_METHOD`)이 아닌 스냅샷은 자기 포함 · 한 점 표본의 0.5 를 담았을 수 있다 — 믿지 않는다
  if (stats === null || stats.method !== SOURCE_STATS_METHOD || stats.n === 0
    || (stats.commentsPct === null && stats.viewsPct === null)) {
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
  /** 🔴 손상 위치(경로 · 종류) — 감사가 EXPIRED 행의 원인을 식별한다 */
  issue: string | null
  evidenceVersion: string | null
}

export function releaseStampOf(v: SlotReleaseVerdict): ReleaseStamp {
  return {
    contract: RELEASE_CONTRACT, verdict: v.verdict, slotAt: v.slotAt, evaluatedAt: v.evaluatedAt,
    reasons: [...v.reasons], issue: v.issue, evidenceVersion: v.evidenceVersion,
  }
}

/**
 * 🔴 **발행 기록(`PersonaActivityLog` kind=post) 한 줄의 시각** — 발행 트랜잭션이 `publishedAt` · `createdAt` 을
 *    둘 다 트랜잭션 시계(txNow)로 쓴다. 도장의 `slotAt` · `evaluatedAt` 도 같은 txNow 다.
 */
export type PublishLogTimes = { publishedAt: Date | null; createdAt: Date }

/**
 * 🔴 **발행 사건 시각 — 정본 helper 하나.** 글 하나의 발행 기록이 **정확히 한 줄**이고
 *    그 줄의 `publishedAt` 과 `createdAt` 이 **정확히 같을 때만** 그 시각이다. 아니면 null(모른다).
 *    🔴 허용 오차 · 보정이 없다 — 같은 트랜잭션의 같은 사건이면 같은 값이다.
 *    기록이 둘 이상이면 어느 쪽이 도장과 같은 사건인지 말할 수 없다(중복 자체는 단계 증거가 따로 잡는다).
 */
export function publishEventAtOf(logs: readonly PublishLogTimes[]): Date | null {
  if (logs.length !== 1) return null
  const l = logs[0]!
  if (l.publishedAt === null || l.publishedAt.getTime() !== l.createdAt.getTime()) return null
  return l.publishedAt
}

/** 🔴 도장의 칸 — 정확히 이 일곱 개다(`releaseStampOf` 가 쓰는 모양). 더 있거나 모자라면 이 계약이 아니다 */
const RELEASE_STAMP_FIELDS: readonly string[] = ['contract', 'verdict', 'slotAt', 'evaluatedAt', 'reasons', 'issue', 'evidenceVersion']
const RELEASE_REASON_SET: ReadonlySet<string> = new Set(RELEASE_REASONS)

export type ReleaseStampStatus = 'STAMPED_ELIGIBLE' | 'MISSING' | 'STALE'

/**
 * 🔴 **release 도장 검증 — 정본은 이 함수 하나다.** 모든 소비자(단계 증거 · 사전점검 지연 · 깔때기 · 검사)가 이것만 부른다.
 *
 *    앞판은 `contract` · `verdict` 두 칸만 봤다. 그래서 `{contract:'source-slot-v1', verdict:'eligible'}` 두 칸짜리나
 *    `slotAt:'x'` · `reasons:['HARD_GATE']` · `issue:'broken'` · `evidenceVersion:null` 도장이 증명으로 세어졌다(재현).
 *    이제 **완전한 계약**을 본다 — 첫 문제에서 멈추고 `issue` 에 칸과 종류를 적는다(값 없음):
 *      ① 칸 모양 — 정확히 일곱 칸 · `contract` 정확 일치
 *      ② `verdict === 'eligible'` · `reasons` 가 빈 배열 · `issue === null` · `evidenceVersion === SOURCE_EVIDENCE_VERSION`
 *      ③ `slotAt` · `evaluatedAt` 가 정규 ISO(`toISOString()` 모양)
 *      ④ **같은 사건** — 두 시각이 `publishEventAt`(발행 기록 시각, `publishEventAtOf`)과 **정확히 같다**.
 *         발행 사건 시각을 모르면(null) 증명이 아니다
 *
 *    · `STAMPED_ELIGIBLE` 위 넷을 전부 지난 도장
 *    · `MISSING`          도장이 없다(이 계약 이전 발행 · 우회 발행)
 *    · `STALE`            도장은 있지만 완전한 지금 계약 · 같은 사건의 증명이 아니다
 */
export function releaseStampCheck(
  gateResults: unknown, publishEventAt: Date | null,
): { status: ReleaseStampStatus; issue: string | null } {
  const stale = (issue: string): { status: ReleaseStampStatus; issue: string } => ({ status: 'STALE', issue })
  if (!isObj(gateResults)) return { status: 'MISSING', issue: null }
  const s = gateResults[RELEASE_STAMP_KEY]
  if (s === undefined || s === null) return { status: 'MISSING', issue: null }
  if (!isObj(s)) return stale('stamp:not-object')
  const keys = Object.keys(s)
  if (keys.length !== RELEASE_STAMP_FIELDS.length || !RELEASE_STAMP_FIELDS.every((k) => keys.includes(k))) return stale('stamp:fields')
  if (s.contract !== RELEASE_CONTRACT) return stale('contract:mismatch')
  if (s.verdict !== 'eligible') return stale('verdict:not-eligible')
  if (!Array.isArray(s.reasons) || !s.reasons.every((x) => typeof x === 'string' && RELEASE_REASON_SET.has(x))) return stale('reasons:type')
  if (s.reasons.length !== 0) return stale('reasons:not-empty')
  if (s.issue !== null) return stale('issue:not-null')
  if (s.evidenceVersion !== SOURCE_EVIDENCE_VERSION) return stale('evidenceVersion:mismatch')
  const slotAt = canonicalIso(s.slotAt)
  const evaluatedAt = canonicalIso(s.evaluatedAt)
  if (slotAt === null) return stale('slotAt:corrupt')
  if (evaluatedAt === null) return stale('evaluatedAt:corrupt')
  if (publishEventAt === null) return stale('publishEvent:unknown')
  if (slotAt.getTime() !== publishEventAt.getTime()) return stale('slotAt:not-publish-event')
  if (evaluatedAt.getTime() !== publishEventAt.getTime()) return stale('evaluatedAt:not-publish-event')
  return { status: 'STAMPED_ELIGIBLE', issue: null }
}

/** 🔴 상태만 — `releaseStampCheck` 의 얇은 창(검증을 다시 하지 않는다) */
export function releaseStampStatusOf(gateResults: unknown, publishEventAt: Date | null): ReleaseStampStatus {
  return releaseStampCheck(gateResults, publishEventAt).status
}

/** 사람이 읽는 한 줄 — 코드와 수만 */
export function describeRelease(v: SlotReleaseVerdict): string {
  const r = v.rank
  const f = (x: number | null): string => (x === null ? '—' : String(x))
  return `${v.verdict}${v.reasons.length > 0 ? ` [${v.reasons.join(',')}${v.issue === null ? '' : ` @${v.issue}`}]` : ''}`
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
