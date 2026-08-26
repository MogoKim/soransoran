/**
 * 82cook 후보 수집 — 순수 파싱 · 정책 상수
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §6-7-A · §6-10
 *
 * 🔴 이 파일은 네트워크를 타지 않는다. fetch 도 파일 쓰기도 없다.
 *    문자열을 받아 문자열·객체를 돌려줄 뿐이라 fixture 가 네트워크 없이 전부 검증한다.
 *
 * 🔴 우나어 agents/cook82 · agents/cafe 코드를 가져오지 않았다
 *    가져온 것은 **셀렉터 지식**뿐이다. 그쪽의 랜덤 지연(봇 탐지 회피)과
 *    Chrome 위장 User-Agent, 네이버 로그인 쿠키 경로는 의도적으로 배제했다.
 *    우리는 정직한 식별자로 공개 페이지만 읽는다.
 */
import { createHash } from 'node:crypto'
import { assessCandidate, type QualityAssessment } from './micro-seed-quality.mjs'

/**
 * 🔴 sourceSite 정본. 헌법 §5-2-1 · §6-7-A 가 `82cook` 으로 정했고
 *    fixture 4곳(validate · read · plan · plan-guarded)이 같은 값을 쓴다.
 *    우나어 디렉터리명이 `cook82` 라고 해서 그 값을 새로 만들지 않는다.
 */
export const SOURCE_SITE = '82cook'

/** 자유게시판. §6-9-D 화이트리스트와 무관한 **출처** 게시판 이름이다 */
export const BOARD_NO = 15
export const BOARD_NAME = '자유게시판'

export const LIST_URL = (page: number) =>
  `https://www.82cook.com/entiz/enti.php?bn=${BOARD_NO}&page=${page}`
export const ARTICLE_URL = (articleId: string) =>
  `https://www.82cook.com/entiz/read.php?bn=${BOARD_NO}&num=${articleId}`
export const ROBOTS_URL = 'https://www.82cook.com/robots.txt'

/**
 * 🔴 정직한 식별자를 쓴다.
 *    우나어 collector 는 Chrome 문자열로 위장한다. 그건 rate limit 이 아니라
 *    "우리가 아닌 척" 하는 것이고, 커뮤니티 신뢰를 목적으로 두는 이 레인과 방향이 반대다.
 *    차단당하면 차단당하는 것이 맞다 — 숨어서 계속 읽을 일이 아니다.
 */
export const USER_AGENT = 'soransoran-microseed/1.0 (+https://soransoran.com)'

/**
 * 요청 간 **고정** 간격.
 *
 * 🔴 랜덤 jitter 를 쓰지 않는다. 우나어는 randomDelay(2500, 0.8~1.5) 로 흔드는데
 *    그건 부하 분산이 아니라 탐지 회피 패턴이다. 고정 간격이 상대 서버에도 예측 가능하다.
 */
export const DELAY_MS = 2000

// ─────────────────────────────────────────────────────────
// robots.txt
// ─────────────────────────────────────────────────────────

export type RobotsRules = {
  /** `User-agent: *` 섹션의 Disallow 목록 (원문 그대로) */
  disallow: string[]
}

/**
 * robots.txt 에서 `User-agent: *` 섹션만 읽는다.
 *
 * 🔴 우리를 지목한 규칙이 따로 없으면 `*` 를 따른다. Googlebot 예외를
 *    우리 것으로 착각하지 않는다 — 우리는 검색엔진이 아니다.
 */
export function parseRobotsTxt(text: string): RobotsRules {
  const disallow: string[] = []
  let inStar = false
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'user-agent') {
      inStar = value === '*'
      continue
    }
    if (inStar && key === 'disallow' && value) disallow.push(value)
  }
  return { disallow }
}

/**
 * 경로(쿼리 포함)가 허용되는가.
 *
 * 🔴 빈 Disallow 는 "전부 허용" 이다 (robots 규약). 여기서는 파싱 단계에서
 *    빈 값을 담지 않으므로 목록에 없으면 허용이다.
 * 🔴 접두 일치로 본다 — robots 규약의 기본 매칭이다.
 */
export function isPathAllowed(pathWithQuery: string, rules: RobotsRules): boolean {
  return !rules.disallow.some((d) => pathWithQuery.startsWith(d))
}

/** 절대 URL → robots 매칭에 쓰는 경로+쿼리 */
export function toRobotsPath(url: string): string {
  const u = new URL(url)
  return `${u.pathname}${u.search}`
}

// ─────────────────────────────────────────────────────────
// dedupKey (§6-10)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 표준을 유지한다: `sha256:{hex}` of `${sourceSite}::${sourceArticleId}`
 *    접두어 `sha256:` 을 붙이는 것까지가 표준이다 — 순수 hex 는 폐기됐다.
 */
export function computeDedupKey(sourceSite: string, sourceArticleId: string): string {
  const digest = createHash('sha256').update(`${sourceSite}::${sourceArticleId}`, 'utf8').digest('hex')
  return `sha256:${digest}`
}

// ─────────────────────────────────────────────────────────
// HTML 파싱
// ─────────────────────────────────────────────────────────

export type ListItem = {
  sourceArticleId: string
  sourceUrl: string
  originalTitle: string
  /** 🔴 목록에서 읽는다. 상세를 열어 세면 댓글 본문에 닿는다 — 수집 대상이 아니다 */
  sourceCommentCount: number
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
}

/** HTML 엔티티를 문자로. 숫자 참조도 푼다 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&(nbsp|amp|lt|gt|quot|apos);|&#39;/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

/**
 * 목록 HTML → 후보들. 부작용 없음.
 *
 * 구조: `<td class="title"> … <a href="read.php?bn=15&num=NNN&page=N">제목</a> … <em>댓글수</em>`
 * 같은 글에 photolink 앵커가 하나 더 붙는 행이 있어 **num 기준으로 중복을 접는다.**
 */
export function parseListHtml(html: string): ListItem[] {
  const out = new Map<string, ListItem>()
  const cellRe = /<td class="title"[^>]*>([\s\S]*?)<\/td>/g
  let cell: RegExpExecArray | null
  while ((cell = cellRe.exec(html)) !== null) {
    const body = cell[1]
    // photolink 앵커(제목이 숫자뿐)를 건너뛰고 제목 앵커를 고른다
    const anchors = [...body.matchAll(/<a\s+href="(read\.php\?bn=\d+&num=(\d+)[^"]*)"([^>]*)>([\s\S]*?)<\/a>/g)]
    const titleAnchor = anchors.find((a) => !/class="photolink"/.test(a[3]))
    if (!titleAnchor) continue

    const articleId = titleAnchor[2]
    const title = decodeEntities(titleAnchor[4].replace(/<[^>]+>/g, '')).trim()
    if (!articleId || !title) continue

    const em = body.match(/<em>(\d+)<\/em>/)
    out.set(articleId, {
      sourceArticleId: articleId,
      sourceUrl: ARTICLE_URL(articleId),
      originalTitle: title,
      sourceCommentCount: em ? Number(em[1]) : 0,
    })
  }
  return [...out.values()]
}

/**
 * `<div id="articleBody">` 본문을 **태그 균형**으로 잘라낸다.
 *
 * 🔴 non-greedy 정규식(`[\s\S]*?</div>`)을 쓰지 않는다. 본문에 중첩 div 가 하나라도
 *    있으면 거기서 잘려 본문 일부만 가져온다 — 그 상태로 발행되면 원문이 훼손된다.
 */
export function extractArticleBodyHtml(html: string): string | null {
  const open = html.match(/<div[^>]*id="articleBody"[^>]*>/)
  if (!open || open.index === undefined) return null
  const start = open.index + open[0].length
  let depth = 1
  const tagRe = /<(\/?)div\b[^>]*>/g
  tagRe.lastIndex = start
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(html)) !== null) {
    depth += m[1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(start, m.index)
  }
  return null
}

/**
 * 본문 HTML → 텍스트.
 *
 * 🔴 이미지를 가져오지 않는다. `<img>` 는 흔적 없이 제거한다 —
 *    URL 조차 남기지 않는다(정책: 이미지 포함 원문 재발행 금지).
 * 🔴 링크는 텍스트만 남기고 href 를 버린다. 원문 밖으로 나가는 경로를 만들지 않는다.
 */
export function htmlToText(bodyHtml: string): string {
  let s = bodyHtml
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<img\b[^>]*>/gi, '')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/p\s*>/gi, '\n\n')
  s = s.replace(/<\/(div|li|tr|h[1-6])\s*>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/[ \t]+\n/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/** 상세 HTML → 제목 (목록 제목과 대조용) */
export function parseArticleTitle(html: string): string | null {
  const m = html.match(/<h4[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/h4>/)
  if (!m) return null
  const t = decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim()
  return t || null
}

/**
 * 수집 1건의 산출물 — 앞 9필드는 Micro Seed 스키마와 같은 이름을 쓴다.
 *
 * 🔴 뒤 2필드(qualityFlags · qualitySignals)는 **선별 보조 정보**다.
 *    importer 는 이 둘을 읽지 않는다(필드를 골라 읽는 구조다).
 *    DB 원장에도 Sheet 17열에도 들어가지 않는다 — 사람이 고르는 것을 돕는 데서 끝난다.
 */
export type CollectedCandidate = {
  sourceSite: string
  sourceUrl: string
  sourceArticleId: string
  sourceBoardName: string
  sourceCommentCount: number
  originalTitle: string
  rawBody: string
  sourceCapturedAt: string
  dedupKey: string
  /** 선별 보조 플래그. 🔴 거부 근거가 아니다 */
  qualityFlags: QualityAssessment['flags']
  /** 플래그가 붙은 근거. 사람이 검증할 수 있어야 한다 */
  qualitySignals: QualityAssessment['signals'] & { stage: QualityAssessment['stage'] }
}

/**
 * 목록 항목 + 상세 본문 → 산출물. 순수 함수 (capturedAt 을 인자로 받는다)
 *
 * 🔴 품질 판정을 **여기 안에서** 한다. 호출부에서 감싸지 않는다 —
 *    목록 경로와 상세 경로가 같은 정규화 지점을 지나야 한 쪽만 빠지는 일이 없다.
 *    rawBody 가 빈 목록 단계에서는 assessCandidate 가 본문 플래그를 매기지 않는다.
 */
export function buildCollected(item: ListItem, rawBody: string, capturedAtIso: string): CollectedCandidate {
  const quality = assessCandidate({
    originalTitle: item.originalTitle,
    sourceCommentCount: item.sourceCommentCount,
    rawBody,
  })
  return {
    sourceSite: SOURCE_SITE,
    sourceUrl: item.sourceUrl,
    sourceArticleId: item.sourceArticleId,
    sourceBoardName: BOARD_NAME,
    sourceCommentCount: item.sourceCommentCount,
    originalTitle: item.originalTitle,
    rawBody,
    sourceCapturedAt: capturedAtIso,
    dedupKey: computeDedupKey(SOURCE_SITE, item.sourceArticleId),
    qualityFlags: quality.flags,
    qualitySignals: { ...quality.signals, stage: quality.stage },
  }
}
