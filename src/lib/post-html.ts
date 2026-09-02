import 'server-only'
import sanitize from 'sanitize-html'

/**
 * 글 본문 HTML — 저장·렌더 양쪽이 보는 유일한 규칙.
 *
 * 🔴 sanitize 없이 dangerouslySetInnerHTML 을 쓰지 않는다.
 *    본문은 사용자가 적는 것이고, 에디터가 만든 HTML 이라는 보장은 화면에만 있다.
 *    서버 액션은 주소만 알면 누구나 부를 수 있으므로 저장 시점에 한 번,
 *    화면에 낼 때 또 한 번 거른다. 저장된 것을 믿지 않는다.
 *
 * 🔴 우나어 sanitize.ts 를 그대로 가져오지 않았다.
 *    그쪽은 동영상 파일(video·source)·인라인 글자 크기(span style)·매거진용
 *    확장 목록까지 열려 있다. 1차 범위에 없는 것을 미리 열어 두면
 *    "쓰지 않는데 통과하는 태그" 가 남는다 — 나중에 닫는 일은 열 때보다 어렵다.
 *
 * 🔴 iframe 은 유튜브 3개 호스트만이다. 다른 곳을 열려면 이 목록을 고쳐야 하고,
 *    고치는 순간 이 주석이 보인다. 그것이 목적이다.
 */

/** 유튜브 임베드만 허용한다. 타사 영상·임의 embed 는 1차 범위 밖이다. */
export const ALLOWED_IFRAME_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
] as const

const OPTIONS: sanitize.IOptions = {
  allowedTags: [
    // 글의 뼈대
    'p', 'br', 'strong', 'b', 'em', 'i',
    // 사진
    'img',
    // 유튜브 — Tiptap 이 div[data-youtube-video] 로 iframe 을 감싼다
    'div', 'iframe',
  ],
  allowedAttributes: {
    img: ['src', 'alt', 'width', 'height', 'class'],
    iframe: ['src', 'allowfullscreen', 'frameborder', 'allow', 'width', 'height'],
    div: ['class', 'data-youtube-video'],
  },
  // 🔴 style 을 열지 않는다. 인라인 스타일은 CSS 인젝션 표면이고,
  //    1차 툴바에는 굵게밖에 없어 쓸 일도 없다.
  allowedStyles: {},
  allowedIframeHostnames: [...ALLOWED_IFRAME_HOSTS],
  // 🔴 http 를 허용하지 않는다. 혼합 콘텐츠는 브라우저가 막아 빈 자리만 남는다.
  allowedSchemes: ['https'],
  allowedSchemesByTag: { img: ['https'] },
  // 빈 문단은 사람이 만든 여백이다. 지우면 쓴 사람의 리듬이 사라진다.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  /**
   * 🔴 주소를 잃은 img·iframe 을 남기지 않는다.
   *    sanitize 는 허용하지 않는 주소를 만나면 src 만 떼고 태그는 남긴다.
   *    그대로 두면 화면에 깨진 액자와 빈 검정 상자가 뜬다 —
   *    올리다 만 사진(blob:)·타사 영상·http 이미지가 전부 여기로 온다.
   *
   * 🔴 상대 주소도 막는다. 우리 사진은 언제나 절대 https 주소다.
   *    "/admin/..." 같은 값이 들어오면 우리 화면을 우리 글 안에 그리게 된다.
   */
  exclusiveFilter: (frame) => {
    if (frame.tag !== 'img' && frame.tag !== 'iframe') return false
    const src = frame.attribs.src
    return !src || !src.startsWith('https://')
  },
}

/** 에디터가 만든 HTML 을 저장·표시 가능한 형태로 거른다. */
export function sanitizePostHtml(dirty: string): string {
  return sanitize(dirty, OPTIONS)
}

/**
 * 이 본문이 에디터가 만든 HTML 인가.
 *
 * 🔴 기존 글(평문)과 새 글(HTML)이 한 컬럼에 섞인다. 마이그레이션으로
 *    옛 글을 HTML 로 바꾸지 않는다 — 26 건을 한 번에 치환하다 실패하면
 *    되돌릴 근거가 없다. 대신 읽을 때 어느 쪽인지 판별한다.
 *
 * 🔴 "< 가 들어 있으면 HTML" 로 보지 않는다.
 *    평문에도 "<3" 이나 "가격 < 만원" 같은 글자가 들어온다.
 *    Tiptap 이 내는 것은 항상 블록 태그로 시작하므로 그것만 본다.
 */
const HTML_HEAD = /^\s*<(?:p|div|img|iframe|figure|ul|ol|blockquote|h[1-6])[\s>/]/i

export function isHtmlContent(content: string): boolean {
  return HTML_HEAD.test(content)
}

/**
 * 평문을 HTML 로 바꾼다 — 옛 글의 줄바꿈을 지키는 자리.
 *
 * 🔴 이스케이프를 먼저 하고 <br> 을 넣는다. 순서가 바뀌면
 *    본문에 적힌 "<br>" 글자가 진짜 줄바꿈이 된다.
 *
 * 🔴 빈 줄을 문단(<p>)으로 나누지 않는다. 줄바꿈 하나에 <br> 하나다.
 *    <p> 로 나누면 문단 여백(0.6em×2)이 붙어, 지금까지 whitespace-pre-wrap 으로
 *    보이던 빈 줄(1.85em)보다 간격이 좁아진다. 26 건이 전부 조금씩 달라 보인다 —
 *    "안 깨진다" 로는 부족하고 어제와 같아 보여야 한다.
 *
 * 🔴 \r\n 을 먼저 \n 으로 맞춘다. 실제 글에 섞여 있다(실측).
 *    그대로 두면 \r 이 HTML 에 남고 줄 수 계산도 어긋난다.
 */
export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `<p>${escaped.replace(/\n/g, '<br />')}</p>`
}

/**
 * 화면에 낼 최종 HTML. 평문이든 HTML 이든 여기를 지난다.
 *
 * 🔴 렌더하는 모든 자리(고객 상세·어드민)가 이 함수 하나만 쓴다.
 *    화면마다 sanitize 를 따로 부르면 한 곳을 고쳐도 나머지가 따라오지 않는다 —
 *    post-visibility 3축을 한 곳에 모은 것과 같은 이유다.
 */
export function toSafePostHtml(content: string): string {
  return isHtmlContent(content)
    ? sanitizePostHtml(content)
    : plainTextToHtml(content)
}

/**
 * 본문에서 글자만 뽑는다 — 길이 검사·미리보기·description 용.
 *
 * 🔴 길이·금칙어를 HTML 그대로 재면 안 된다.
 *    이미지 URL 하나가 100 자를 넘어 사진 몇 장이면 5000 자 상한에 걸리고,
 *    content-guard 의 URL 개수 판정(3개)은 사진 세 장에서 "링크가 너무 많습니다" 가 된다.
 *    사람이 쓴 글자만 세는 것이 원래 의도다.
 */
export function postContentToText(content: string): string {
  if (!isHtmlContent(content)) return content
  return sanitize(
    // 🔴 블록 태그를 먼저 공백으로 바꾼다.
    //    그냥 태그를 떼면 "<p>첫 문단</p><p>둘째 문단</p>" 이 "첫 문단둘째 문단" 이 된다 —
    //    목록 미리보기에서 문장이 붙어 읽히지 않는다. 실제로 그렇게 나왔다.
    content.replace(/<\/(?:p|div|h[1-6]|li|blockquote)>|<br\s*\/?>/gi, ' '),
    { allowedTags: [], allowedAttributes: {} },
  )
    // 🔴 &amp; 를 마지막에 푼다. 먼저 풀면 "&amp;lt;" 가 "&lt;" 를 거쳐 "<" 가 된다.
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

/**
 * 한 줄로 눌러 낸 요약 — 목록 미리보기·검색 description 이 쓴다.
 *
 * 🔴 줄바꿈을 공백으로 눌러야 2줄 말줄임(line-clamp)이 예측 가능해진다.
 *    길이 검사에는 이것을 쓰지 않는다 — 거기서는 사람이 쓴 공백을 그대로 세야 한다.
 */
export function postContentToSummary(content: string): string {
  return postContentToText(content).replace(/\s+/g, ' ').trim()
}

/**
 * 목록 미리보기용 본문 요약.
 *
 * 🔴 date.ts 에 있던 것을 여기로 옮겼다. 본문 형식(평문/HTML)을 아는 것은
 *    이 파일이고, 태그를 빼는 규칙이 두 곳에 생기면 언젠가 한쪽이 낡는다.
 *    줄 수 제한은 그대로 CSS(line-clamp)가 맡는다.
 */
export function toPreview(content: string, max = 140): string {
  const flat = postContentToSummary(content)
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
