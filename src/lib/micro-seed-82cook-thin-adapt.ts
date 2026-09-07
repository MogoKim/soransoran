/**
 * 82cook thin → 검수 화면 어댑터 판정 — 🔴 **순수 변환만. 파일도 네트워크도 DB 도 없다** (§4-AQ)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AQ
 *
 * 🔴 **왜 필요한가.** `thin-detail` 로 82cook 50건을 읽었는데
 *    **하류가 그 파일을 보지 못했다.**
 *
 *    ```
 *    만든 것    ….thin-detail.jsonl
 *    검수 화면  .detail.jsonl · .raw-detail.jsonl 만 읽는다
 *    '….thin-detail.jsonl'.endsWith('.detail.jsonl')  →  false   ← 'n-detail' 이지 '.detail' 이 아니다
 *    ```
 *
 *    새 접미를 만들면서 **하류가 그걸 모른다는 것을 놓쳤다.** 데이터는 온전한데 안 보였다.
 *
 * 🔴 **접미를 `.detail.jsonl` 로 바꾸지 않는 이유.** 그러면 하류가 바로 읽지만,
 *    **저장 정책이 다른 두 종류가 같은 접미를 갖게 된다.**
 *    `raw-detail` 이 굳이 접미를 나눈 이유가 그것이다 —
 *    *"어느 줄이 어떤 규칙으로 저장됐는지 파일만 보고는 알 수 없다"*.
 *    그래서 원본은 그대로 두고 **읽을 수 있는 사본**을 따로 낸다.
 *
 * 🔴 **화면 둘이 요구하는 키가 다르다.**
 *    소스·SRN 검수는 `access`, raw-review 는 `accessStatus` 를 본다.
 *    한 파일로는 둘 다 만족시킬 수 없어 **두 벌**을 낸다.
 */

/** 🔴 전문 키 — 어느 출력에도 만들지 않는다 (thin 계약 그대로) */
export const FORBIDDEN_KEYS: readonly string[] = [
  'rawBody', 'body', 'sourceBody', 'bodyText', 'content', 'rawComments', 'html', 'bodyHtml',
] as const

/** 소스·SRN 검수 화면(`.detail.jsonl`)이 읽는 키 */
export const DETAIL_KEYS: readonly string[] = [
  'runId', 'axis', 'access', 'sourceSite', 'sourceArticleId', 'url', 'score', 'lane',
  'bodyLength', 'lengthBasis', 'imageCount', 'commentCount',
  'safetyVerdict', 'safetyReasons', 'assetAxes', 'reason', 'title', 'bodyHead',
] as const

/** raw-review 화면(`.raw-detail.jsonl`)이 읽는 키 */
export const RAW_DETAIL_KEYS: readonly string[] = [
  'sourceArticleId', 'sourceSite', 'url', 'title', 'score', 'lane',
  'accessStatus', 'bodyLength', 'bodyHead', 'axis',
  'safetyVerdict', 'safetyReasons', 'imageCount', 'commentCount', 'runId', 'fetchedAt',
] as const

/** 화면이 후보로 올리는 축 */
export const SOURCE_AXIS = 'seedOriginality'
export const RAW_AXIS = 'rawOriginality'
export const SRN_AXIS = 'shortRawNoindex'

/**
 * 🔴 **없는 값을 지어내지 않는다.** thin 이 안 재는 것은 정직하게 기본값을 둔다.
 *    `access` 는 예외다 — thin 은 읽기에 성공한 것만 본문 길이가 0 보다 크므로,
 *    그 사실로부터 유도한다(아래 `accessOf`).
 */
export const DEFAULT_IMAGE_COUNT = 0
export const DEFAULT_LENGTH_BASIS = 'body'
export const DEFAULT_LANE = 'originalRaw'

export type ThinRow = {
  sourceArticleId?: string
  sourceSite?: string
  url?: string
  title?: string
  commentCount?: number
  score?: number
  bodyLength?: number
  bodyHead?: string
  axis?: string
  safetyVerdict?: string
  safetyReasons?: string
  reason?: string
  runId?: string
  fetchedAt?: string
}

const S = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''))
const N = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * 🔴 **읽기 성공 여부를 지어내지 않는다.**
 *
 * thin 러너는 404 를 만나면 `bodyLength = 0` 으로 남긴다.
 * 그걸 전부 `ok` 로 적으면 **읽지 못한 글이 판단 대상이 된다**(§4-S 위반).
 * 그래서 길이로부터 유도한다 — 0 이면 읽지 못한 것이다.
 */
export function accessOf(r: ThinRow): 'ok' | 'failed' {
  return N(r.bodyLength) > 0 ? 'ok' : 'failed'
}

/** 소스·SRN 검수용 행 — 🔴 전문 키 없음 */
export function toDetailRecord(r: ThinRow): Record<string, unknown> {
  return {
    runId: S(r.runId),
    axis: S(r.axis),
    access: accessOf(r),
    sourceSite: S(r.sourceSite),
    sourceArticleId: S(r.sourceArticleId),
    url: S(r.url),
    score: N(r.score),
    lane: DEFAULT_LANE,
    bodyLength: N(r.bodyLength),
    lengthBasis: DEFAULT_LENGTH_BASIS,
    imageCount: DEFAULT_IMAGE_COUNT,
    commentCount: N(r.commentCount),
    safetyVerdict: S(r.safetyVerdict),
    safetyReasons: S(r.safetyReasons),
    // 🔴 thin 은 사연 축을 재지 않았다. 빈 값이 "없다" 가 아니라 "안 쟀다" 임을 reason 이 말한다
    assetAxes: '',
    reason: S(r.reason),
    title: S(r.title),
    bodyHead: S(r.bodyHead),
  }
}

/** raw-review 용 행 — 🔴 키 이름이 `accessStatus` 다 */
export function toRawDetailRecord(r: ThinRow): Record<string, unknown> {
  return {
    sourceArticleId: S(r.sourceArticleId),
    sourceSite: S(r.sourceSite),
    url: S(r.url),
    title: S(r.title),
    score: N(r.score),
    lane: DEFAULT_LANE,
    accessStatus: accessOf(r),
    bodyLength: N(r.bodyLength),
    bodyHead: S(r.bodyHead),
    axis: S(r.axis),
    safetyVerdict: S(r.safetyVerdict),
    safetyReasons: S(r.safetyReasons),
    imageCount: DEFAULT_IMAGE_COUNT,
    commentCount: N(r.commentCount),
    runId: S(r.runId),
    fetchedAt: S(r.fetchedAt),
  }
}

export type AdaptStats = {
  total: number
  /** 소스 검수에 후보로 뜰 것 */
  sourceCandidates: number
  /** raw-review 에 후보로 뜰 것 */
  rawCandidates: number
  /** SRN 경로 — 🔴 별도 집계만 한다. 발행 후보화하지 않는다 */
  srn: number
  /** 🔴 어느 화면에도 안 뜨는 것 */
  dropped: number
  /** 읽지 못한 것 */
  unreadable: number
}

/**
 * 화면에 무엇이 뜰지 미리 센다 — 🔴 **화면의 조건과 같은 식으로 센다.**
 *
 * 두 화면 모두 `축 + access=ok + safety=pass` 를 요구한다.
 * `drop` · `hardExclude` 는 어느 쪽에도 오르지 않는다.
 */
export function statsOf(rows: readonly ThinRow[]): AdaptStats {
  const eligible = (r: ThinRow, axis: string): boolean =>
    S(r.axis) === axis && accessOf(r) === 'ok' && S(r.safetyVerdict) === 'pass'
  return {
    total: rows.length,
    sourceCandidates: rows.filter((r) => eligible(r, SOURCE_AXIS)).length,
    rawCandidates: rows.filter((r) => eligible(r, RAW_AXIS)).length,
    srn: rows.filter((r) => eligible(r, SRN_AXIS)).length,
    dropped: rows.filter((r) =>
      S(r.axis) === 'drop' || S(r.safetyVerdict) === 'hardExclude').length,
    unreadable: rows.filter((r) => accessOf(r) !== 'ok').length,
  }
}

/**
 * 출력 직전 마지막 관문 — 🔴 **전문 키와 계약 밖 키를 둘 다 막는다.**
 */
export function violatesAdapt(
  row: Record<string, unknown>, allowed: readonly string[], bodyHeadChars: number,
): string[] {
  const bad: string[] = []
  for (const k of FORBIDDEN_KEYS) {
    if (k in row) bad.push(`🔴 전문 키 ${k} 가 있다`)
  }
  for (const k of Object.keys(row)) {
    if (!allowed.includes(k)) bad.push(`🔴 계약에 없는 키 ${k}`)
  }
  const head = row.bodyHead
  if (typeof head === 'string' && head.length > bodyHeadChars) {
    bad.push(`🔴 bodyHead ${head.length}자 — ${bodyHeadChars}자를 넘는다`)
  }
  return bad
}
