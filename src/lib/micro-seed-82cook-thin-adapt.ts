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

/**
 * 🔴 **정본 데이터 디렉터리** — 한 곳에서만 정의한다.
 *
 *    러너와 어댑터가 각자 문자열을 들고 있으면 한쪽만 바뀐다. 실제로 그렇게 됐다:
 *    러너는 `readdirSync(DATA_DIR)` 로 얻은 **파일 이름만** 넘겼고,
 *    어댑터는 `--input` 을 받으면 그 문자열을 **그대로** 열었다.
 *    cwd 에는 그런 파일이 없으니 ENOENT 가 났고, 그 실패가 빈 배열로 삼켜졌다.
 */
export const DATA_DIR_NAME = '.microseed-data'

/** thin 입력 한 개를 정본 디렉터리 기준으로 푼 결과 */
export type ThinInputResolution =
  | { ok: true; path: string }
  | { ok: false; reason: string }

/**
 * `--input` 한 항목을 **읽을 수 있는 경로**로 바꾼다.
 *
 * 🔴 **맨 이름과 `.microseed-data/…` 를 둘 다 받는다.** 러너는 맨 이름을 넘기고
 *    사람은 경로째 붙여 넣는다. 한쪽만 받으면 나머지 한쪽이 조용히 0행이 된다.
 * 🔴 **이미 디렉터리로 시작하면 다시 붙이지 않는다** — `.microseed-data/.microseed-data/…`
 *    는 없는 경로이고, 없는 경로는 또 0행이 된다.
 * 🔴 **디렉터리 밖은 거부한다.** 절대경로·`..` 는 받지 않는다 — 이 도구가 읽어도 되는 것은
 *    수집물뿐이고, 입력 문자열이 그 경계를 넓히면 안 된다.
 */
export function resolveThinInput(raw: string, dataDir: string = DATA_DIR_NAME): ThinInputResolution {
  const t = raw.trim()
  if (t === '') return { ok: false, reason: '빈 경로다' }
  if (t.includes('\u0000')) return { ok: false, reason: 'NUL 이 들어 있다' }
  if (t.startsWith('/')) return { ok: false, reason: `절대경로는 받지 않는다 — ${dataDir}/ 아래만 읽는다` }
  const segs: string[] = []
  for (const seg of t.split('/')) {
    if (seg === '' || seg === '.') continue
    // 🔴 `..` 은 한 칸도 허용하지 않는다 — 경계를 계산으로 판단하지 않는다
    if (seg === '..') return { ok: false, reason: `${dataDir}/ 밖이다 — 거부한다` }
    segs.push(seg)
  }
  if (segs.length === 0) return { ok: false, reason: `${dataDir}/ 아래 파일이 아니다` }
  const full = segs[0] === dataDir ? segs : [dataDir, ...segs]
  if (full.length < 2) return { ok: false, reason: `${dataDir}/ 아래 파일이 아니다` }
  return { ok: true, path: full.join('/') }
}

/**
 * JSONL 본문을 판다 — 🔴 **정상 0행과 읽기 실패를 섞지 않는다.**
 *
 *    빈 배열은 "없다" 와 "못 읽었다" 를 구분하지 못한다. 그 구분이 사라지면
 *    끊긴 파이프라인이 조용한 날처럼 보이고, 실제로 하루를 그렇게 보냈다.
 */
export type JsonlParse =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; line: number; reason: string }

export function parseJsonl(text: string): JsonlParse {
  const rows: Record<string, unknown>[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const t = (lines[i] ?? '').trim()
    if (t === '') continue
    let v: unknown
    try { v = JSON.parse(t) } catch { return { ok: false, line: i + 1, reason: 'JSON 이 아니다' } }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      return { ok: false, line: i + 1, reason: '객체가 아니다' }
    }
    rows.push(v as Record<string, unknown>)
  }
  return { ok: true, rows }
}

/** 사본 이름 규칙 — 🔴 두 벌이 한 짝이다 */
export const ADAPT_PREFIX = '82cook-adapt-'
export const DETAIL_SUFFIX = '.detail.jsonl'
export const RAW_DETAIL_SUFFIX = '.raw-detail.jsonl'

export type AdaptArtifacts = { detail: boolean; rawDetail: boolean }

/** 디렉터리에 있는 이름들에서 회차별로 어떤 사본이 있는지 모은다 */
export function adaptArtifactsOf(names: readonly string[]): Map<string, AdaptArtifacts> {
  const out = new Map<string, AdaptArtifacts>()
  const touch = (k: string): AdaptArtifacts => {
    const had = out.get(k)
    if (had !== undefined) return had
    const made: AdaptArtifacts = { detail: false, rawDetail: false }
    out.set(k, made)
    return made
  }
  for (const n of names) {
    if (!n.startsWith(ADAPT_PREFIX)) continue
    // 🔴 raw-detail 을 먼저 본다 — `.raw-detail.jsonl` 은 `.detail.jsonl` 로 끝나지 않지만
    //    순서를 명시해 두어야 접미를 바꿀 때 한쪽으로 쏠리지 않는다
    if (n.endsWith(RAW_DETAIL_SUFFIX)) {
      touch(n.slice(ADAPT_PREFIX.length, n.length - RAW_DETAIL_SUFFIX.length)).rawDetail = true
    } else if (n.endsWith(DETAIL_SUFFIX)) {
      touch(n.slice(ADAPT_PREFIX.length, n.length - DETAIL_SUFFIX.length)).detail = true
    }
  }
  return out
}

/**
 * 🔴 **두 벌이 다 있어야 완료다.** 한쪽만 있으면 완료로 세지 않는다 —
 *    detail 만 있고 raw-detail 이 없으면 raw-review 화면이 그 회차를 영영 못 본다.
 *    다음 회차가 다시 만들게 두는 편이 낫다. 별도 checkpoint 를 만들지 않는 이유이기도 하다:
 *    **산출물 자체가 진행 상태다.**
 */
export function completedAdaptKeys(names: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const [k, a] of adaptArtifactsOf(names)) if (a.detail && a.rawDetail) out.add(k)
  return out
}

/** 한쪽만 난 회차 — 다음 회차가 다시 처리한다 */
export function partialAdaptKeys(names: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const [k, a] of adaptArtifactsOf(names)) if (a.detail !== a.rawDetail) out.add(k)
  return out
}

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
