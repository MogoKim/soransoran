/**
 * 82cook 얇은 상세 판정 — 🔴 **순수 판정만. 네트워크도 파일도 DB 도 없다** (§4-AP)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AP
 *
 * 🔴 **왜 기존 `collect-82cook --fetch` 를 쓰지 않나.**
 *    그 경로는 `rawBody` **전문을 디스크에 저장한다.** Micro Seed 레인은 원문 그대로
 *    발행하는 레인이라 전문이 필요하지만, 우리가 채우려는 것은 **다시 쓰는 레인**이다.
 *    전문이 남으면 사람이 그 문장을 참고하게 되고(§4-AF ⑤), 남의 글이 우리 디스크에 쌓인다.
 *    388건을 그 경로로 읽으면 전문 388개가 남는다.
 *
 * 🔴 **그래서 얇게 읽는다.** 본문은 메모리에서 판정하고, 남기는 것은
 *    마스킹한 앞 `BODY_HEAD_CHARS` 자와 길이·축·안전 판정뿐이다.
 *    `raw-detail` 이 네이버 카페에 대해 하는 것과 같은 계약을 82cook 에 적용한다.
 *
 * 🔴 **이 파일은 무엇을 열지만 정한다.** 여는 것도 저장도 러너의 일이다.
 */

/**
 * 🔴 이 레인이 저장할 수 있는 것 — 여기 없는 키는 파일에 나가지 않는다
 *
 * 🔴 **세 시각을 더한다** (2026-09-17). 수집기는 `sourcePostedAt` 을 이미 100% 뽑는데
 *    (실측 remonterrace 222/222 · wgang 82/82) 이 목록에 없어서 **첫 변환에서 버려졌다.**
 *    그래서 하류의 신선도 판정이 `sourceCapturedAt`(= 우리가 본 시각)으로 떨어졌고,
 *    2020년 글이 "오늘 들어온 글" 로 잡혔다. 값을 새로 만드는 것이 아니라 **안 버리는 것**이다.
 */
export const THIN_COLUMNS: readonly string[] = [
  'sourceArticleId', 'sourceSite', 'url', 'title',
  'commentCount', 'score', 'bodyLength', 'bodyHead',
  'axis', 'safetyVerdict', 'safetyReasons', 'reason',
  'runId', 'fetchedAt',
  /**
   * 🔴 `sourceListedAt` 은 **목록 관측과 잇는 열쇠**다 — 반응(조회 · 댓글 · 자리)은 여기 복사하지 않는다.
   *    (2026-09-30 Lane B) 반응의 정본은 목록 artifact 한 곳이다(`source-list-observations`). 앞판은 조회수 ·
   *    자리를 이 행 · 상세 행 · 생성 봉투로 세 번 복사했고, 네이버의 "댓글 수 못 읽음" 이 여기서 0 으로 굳었다.
   */
  'sourcePostedAt', 'sourceListedAt', 'sourceCapturedAt',
] as const

/**
 * 🔴 **전문 컬럼 금지 목록.** 하나라도 나가면 이 레인의 존재 이유가 사라진다.
 *    fixture 가 산출 행에 이 키가 없는지 검사한다.
 */
export const FORBIDDEN_COLUMNS: readonly string[] = [
  'rawBody', 'body', 'sourceBody', 'bodyText', 'content', 'rawComments', 'html', 'bodyHtml',
] as const

/** 요청 간격 — 🔴 창업자 지정 3~5초. 기존 detail-fetch(2.5~4.5초)보다 느슨하게 잡는다 */
export const PACE_MIN_MS = 3000
export const PACE_MAX_MS = 5000

/** 1차 batch — 🔴 상한이지 목표가 아니다 */
export const BATCH_CAP = 50

/** 댓글 기준 두 단계 — 10+ 를 먼저 채우고 모자라면 5+ 로 내려간다 */
export const COMMENT_TIER_HIGH = 10
export const COMMENT_TIER_LOW = 5

export type ListRow = {
  sourceArticleId?: string
  sourceSite?: string
  sourceUrl?: string
  originalTitle?: string
  sourceCommentCount?: number
  sourceViewCount?: number
  sourceExcludeReason?: string
  sourcePoliticsExcluded?: boolean
  qualityFlags?: readonly string[] | Record<string, unknown>
  /** 🔴 목록 줄의 세 시각 (2026-09-30 Lane B `buildListRow`) — 옛 줄에는 없다(모른다) */
  sourcePostedAt?: string | null
  sourceListedAt?: string
  sourceCapturedAt?: string
}

export type SkipCode =
  | 'NOT_82COOK' | 'HAS_BODY' | 'EXCLUDED' | 'POLITICS' | 'FLAG_POLITICS'
  | 'FLAG_MEDICAL' | 'LOW_COMMENT' | 'NO_ID' | 'TITLE_POLITICS' | 'TITLE_SAFETY'

export const SKIP_LABEL: Record<SkipCode, string> = {
  NOT_82COOK: '82cook 이 아니다 (네이버는 브라우저·세션이 든다)',
  HAS_BODY: '이미 본문을 읽었다',
  EXCLUDED: '목록에서 이미 제외됐다 (고정글 등)',
  POLITICS: '정치로 제외됐다',
  FLAG_POLITICS: '정치·실명 플래그가 있다',
  FLAG_MEDICAL: '의료·광고성 플래그가 있다',
  LOW_COMMENT: `댓글이 ${COMMENT_TIER_LOW}개 미만이다`,
  NO_ID: '글 id 가 없다',
  TITLE_POLITICS: '🔴 제목이 정치·진영 이슈다 (플래그가 안 붙은 것도 잡는다)',
  TITLE_SAFETY: '🔴 제목 안전 판정에서 걸렀다',
}

export type Skip = { id: string; code: SkipCode }

/** 플래그가 배열로도 객체로도 온다 — 두 모양을 다 받는다 */
export function flagsOf(r: ListRow): string[] {
  const q = r.qualityFlags
  if (Array.isArray(q)) return q.map((x) => String(x))
  if (q !== null && typeof q === 'object') {
    return Object.entries(q).filter(([, v]) => v === true).map(([k]) => k)
  }
  return []
}

const N = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * 제목 판정 — 🔴 **주입받는다.** 정치·안전 판정의 정본은 기존 lib 이고,
 *    여기서 규칙을 새로 쓰면 판단이 두 곳이 된다.
 */
export type TitleJudge = {
  isPolitics: (title: string) => boolean
  isBlocked: (title: string) => boolean
}

export type PlanInput = {
  rows: readonly ListRow[]
  /** 이미 본문을 읽은 글 id */
  hasBody: ReadonlySet<string>
  cap?: number
  /** 없으면 제목 판정을 건너뛴다 — fixture 가 순수 판정만 볼 때 쓴다 */
  judge?: TitleJudge
}

export type Plan = {
  targets: ListRow[]
  skipped: Skip[]
  /** 댓글 10+ 로 채운 수 */
  high: number
  /** 댓글 5~9 로 채운 수 */
  low: number
}

/**
 * 열 것을 고른다 — 🔴 **댓글 많은 것부터, 두 단계로.**
 *
 * 🔴 **정치·실명과 의료·광고성은 자동 경로에서 뺀다.** 거부가 아니라 자동에서만 빼는 것이다 —
 *    자동 경로에는 사람이 없고, 사람이 볼 때는 넘기면 되지만 기계는 그냥 읽는다.
 *    목록 파일에는 그대로 남아 있고 `--id` 로 지정하면 언제든 열린다.
 *
 * 🔴 **정렬이 고정이라야 dry-run 에서 본 것이 그대로 열린다.**
 *    댓글수 내림차순 → 조회수 내림차순 → id 오름차순. 입력 순서가 달라도 결과가 같다.
 */
export function planThinFetch(input: PlanInput): Plan {
  const cap = input.cap ?? BATCH_CAP
  const skipped: Skip[] = []
  const push = (id: string, code: SkipCode): void => { skipped.push({ id, code }) }
  const ok: ListRow[] = []

  for (const r of input.rows) {
    const id = S(r.sourceArticleId)
    if (id === '') { push('(id 없음)', 'NO_ID'); continue }
    if (S(r.sourceSite) !== '82cook') { push(id, 'NOT_82COOK'); continue }
    if (input.hasBody.has(id)) { push(id, 'HAS_BODY'); continue }
    if (S(r.sourceExcludeReason) !== '') { push(id, 'EXCLUDED'); continue }
    if (r.sourcePoliticsExcluded === true) { push(id, 'POLITICS'); continue }
    const flags = flagsOf(r)
    if (flags.includes('politicalOrPublicFigure')) { push(id, 'FLAG_POLITICS'); continue }
    if (flags.includes('medicalOrAdLikely')) { push(id, 'FLAG_MEDICAL'); continue }
    if (N(r.sourceCommentCount) < COMMENT_TIER_LOW) { push(id, 'LOW_COMMENT'); continue }
    // 🔴 플래그만으로는 모자란다. 목록 수집 당시 플래그가 안 붙은 정치 글이 남아 있다
    //    (2026-09-07 실측: 50건 대상에 조국·이준석·정청래·극우 제목이 10건 넘게 섞였다).
    //    §13 은 정치·진영 이슈를 **어느 레인으로도** 가져가지 않는다고 못박았다.
    const title = S(r.originalTitle)
    if (input.judge !== undefined) {
      if (input.judge.isPolitics(title)) { push(id, 'TITLE_POLITICS'); continue }
      if (input.judge.isBlocked(title)) { push(id, 'TITLE_SAFETY'); continue }
    }
    ok.push(r)
  }

  ok.sort((a, b) =>
    N(b.sourceCommentCount) - N(a.sourceCommentCount)
    || N(b.sourceViewCount) - N(a.sourceViewCount)
    || S(a.sourceArticleId).localeCompare(S(b.sourceArticleId)))

  const targets = ok.slice(0, cap)
  return {
    targets, skipped,
    high: targets.filter((r) => N(r.sourceCommentCount) >= COMMENT_TIER_HIGH).length,
    low: targets.filter((r) => {
      const c = N(r.sourceCommentCount)
      return c >= COMMENT_TIER_LOW && c < COMMENT_TIER_HIGH
    }).length,
  }
}

/**
 * 🔴 **세 시각은 서로 다른 것을 뜻한다. 하나로 뭉치지 않는다** (2026-09-17).
 *
 * ```
 * sourcePostedAt    원문이 그 게시판에 올라온 시각    ← source 가 화면에 보여 준 값
 * sourceListedAt    우리가 목록에서 그 줄을 본 시각
 * sourceCapturedAt  우리가 그 글을 가져온 시각
 * ```
 *
 * 🔴 **`sourcePostedAt` 은 "사건이 일어난 시각" 이 아니다.** 어제 방송된 이야기를
 *    오늘 누가 쓰면 `sourcePostedAt` 은 오늘이다. 글이 올라온 시각일 뿐이고,
 *    화면·문서·주석 어디에서도 사건 시각이라고 적지 않는다.
 *
 * 🔴 **모르면 빈 문자열이다.** `''` 는 "없다" 가 아니라 **"모른다"** 이고,
 *    하류가 그것을 아는 채로 판단해야 한다. 0 이나 지금 시각으로 채우지 않는다.
 */
export type SourceTimes = {
  /** 원문이 올라온 시각 (ISO) — 🔴 사건 시각이 아니다. 모르면 `''` */
  sourcePostedAt: string
  /** 우리가 목록에서 본 시각 (ISO). 모르면 `''` */
  sourceListedAt: string
  /** 우리가 가져온 시각 (ISO). 모르면 `''` */
  sourceCapturedAt: string
}

/** 🔴 값이 없을 때의 정본 — 빈 문자열 셋. `null` 과 `undefined` 를 섞지 않는다 */
export const NO_SOURCE_TIMES: SourceTimes = Object.freeze({
  sourcePostedAt: '', sourceListedAt: '', sourceCapturedAt: '',
})

export type ThinRow = {
  sourceArticleId: string
  sourceSite: string
  url: string
  title: string
  commentCount: number
  score: number
  bodyLength: number
  bodyHead: string
  axis: string
  safetyVerdict: string
  safetyReasons: string
  reason: string
  runId: string
  fetchedAt: string
} & SourceTimes

/**
 * 저장할 행을 만든다 — 🔴 **전문은 인자로만 받고 결과에 남지 않는다.**
 *
 * `bodyLength` 는 **자르기 전** 길이다. 얼마나 긴 글이었는지는 판단에 쓰이고,
 * 그 숫자만으로는 원문을 복원할 수 없다.
 */
export function toThinRow(input: {
  id: string; url: string; title: string; commentCount: number; score: number
  /** 🔴 마스킹까지 끝난 본문. 여기서 자른다 */
  maskedBody: string
  bodyHeadChars: number
  axis: string; safetyVerdict: string; safetyReasons: readonly string[]
  reason: string; runId: string; fetchedAt: string
  /**
   * 🔴 어느 소스에서 왔는지. 기본은 82cook 이다.
   *
   * 네이버 카페도 **같은 얇은 계약**으로 저장한다 (§4-AV) — 계약을 하나로 두지 않으면
   * 한쪽만 전문을 남기게 되고, 그 한쪽이 이 레인의 존재 이유를 무너뜨린다.
   */
  sourceSite?: string
  /**
   * 🔴 수집물이 이미 들고 있는 세 시각. 없으면 전부 `''`(모른다) 다 — **없는 값을 지어내지 않는다.**
   *    (2026-09-30 Lane B) 82cook 목록 줄도 이제 게시 · 목록 시각을 싣는다(`buildListRow`) — 러너가 넘긴다.
   */
  times?: Partial<SourceTimes>
}): ThinRow {
  const t = input.times ?? {}
  return {
    sourceArticleId: input.id,
    sourceSite: input.sourceSite ?? '82cook',
    sourcePostedAt: (t.sourcePostedAt ?? '').trim(),
    sourceListedAt: (t.sourceListedAt ?? '').trim(),
    sourceCapturedAt: (t.sourceCapturedAt ?? '').trim(),
    url: input.url,
    title: input.title,
    commentCount: input.commentCount,
    score: input.score,
    // 🔴 자르기 전 길이 — 자른 뒤 길이를 쓰면 전부 300 으로 보여 쓸모가 없다
    bodyLength: input.maskedBody.length,
    bodyHead: input.maskedBody.slice(0, input.bodyHeadChars),
    axis: input.axis,
    safetyVerdict: input.safetyVerdict,
    safetyReasons: input.safetyReasons.join('|'),
    reason: input.reason,
    runId: input.runId,
    fetchedAt: input.fetchedAt,
  }
}

/** 행에 전문이 섞였는지 — 🔴 저장 직전 마지막 관문 */
export function violatesStorage(row: Record<string, unknown>, bodyHeadChars: number): string[] {
  const bad: string[] = []
  for (const k of FORBIDDEN_COLUMNS) {
    if (k in row) bad.push(`🔴 전문 컬럼 ${k} 가 있다`)
  }
  for (const k of Object.keys(row)) {
    if (!THIN_COLUMNS.includes(k)) bad.push(`🔴 계약에 없는 컬럼 ${k}`)
  }
  const head = row.bodyHead
  if (typeof head === 'string' && head.length > bodyHeadChars) {
    bad.push(`🔴 bodyHead ${head.length}자 — ${bodyHeadChars}자를 넘는다`)
  }
  return bad
}

export type FetchGate = { ok: true } | { ok: false; reason: string }

/**
 * 밖으로 나가도 되는가 — 🔴 **스위치가 없으면 요청 자체를 만들지 않는다.**
 *
 * 남의 서버에 보내는 요청이라 "실수로 돌았다" 가 성립하면 안 된다.
 */
export function judgeLive(input: {
  live: boolean
  targets: number
  cap: number
  robotsAllowed: boolean
}): FetchGate {
  if (!input.live) return { ok: false, reason: 'dry-run — --live 가 없다. 네트워크 요청 0' }
  if (input.targets === 0) return { ok: false, reason: '열 대상이 0건이다' }
  if (input.targets > input.cap) {
    return { ok: false, reason: `대상 ${input.targets}건이 상한 ${input.cap}건을 넘는다` }
  }
  if (!input.robotsAllowed) return { ok: false, reason: '🔴 robots.txt 가 막는 경로가 있다' }
  return { ok: true }
}

/** 요청 간격 — 🔴 고정이 아니라 범위다. 같은 간격으로 두드리면 패턴이 남는다 */
export function paceMs(rand: number): number {
  const r = Math.min(Math.max(rand, 0), 0.999999)
  return PACE_MIN_MS + Math.floor(r * (PACE_MAX_MS - PACE_MIN_MS))
}
