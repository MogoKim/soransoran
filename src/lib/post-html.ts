import 'server-only'
import sanitize from 'sanitize-html'
import { isOwnPublicUrl } from '@/lib/r2-public'
import { isHtmlContent, plainTextToHtml } from '@/lib/post-content-format'

export { isHtmlContent, plainTextToHtml, toEditorHtml } from '@/lib/post-content-format'

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
 *
 * 🔴 링크(a)는 https 절대 주소만이다. 그리고 target·rel 을 우리가 덮어쓴다.
 *    rel 없이 target="_blank" 만 주면 열린 창이 window.opener 로 원래 탭을 조종할 수 있다.
 *    사람이 적어 보낸 rel 을 믿지 않고, 여기서 항상 다시 쓴다.
 *
 * 🔴 위험한 주소는 태그만 벗기고 글자는 남긴다.
 *    `<a href="javascript:…">눌러보세요</a>` 에서 문장까지 지우면
 *    쓴 사람은 자기 글이 사라진 것을 나중에야 안다. 링크만 죽이고 말은 남긴다.
 *
 * 🔴 img 는 우리 R2 주소만이다. "https 면 통과" 로 두면 업로드 정책이 통째로 무의미해진다 —
 *    사람이 외부 이미지 주소를 본문에 직접 넣는 순간 4MB·6장 제한도, WebP 변환도,
 *    로그인 검사도, 나중에 만들 정리 정책도 지나지 않는다.
 *    남의 서버에 걸린 사진은 그쪽이 지우면 우리 글에서 깨지고, 바꿔치기하면
 *    우리 글에 다른 그림이 뜬다. 우리가 통제할 수 없는 것을 본문에 담지 않는다.
 */

/**
 * 외부 링크에 항상 붙는 값.
 *
 * 🔴 noopener 가 핵심이다. 없으면 새 창이 window.opener 로 원래 탭의 주소를
 *    바꿀 수 있다(tabnabbing). noreferrer 는 어디서 왔는지 흘리지 않는다.
 * 🔴 nofollow — 우리 글의 링크가 남의 검색 순위를 밀어 주지 않는다.
 *    회원이 링크를 붙이는 자리는 스팸이 가장 먼저 노리는 곳이다.
 */
const LINK_REL = 'nofollow noopener noreferrer'
const LINK_TARGET = '_blank'

/**
 * 이 주소로 링크를 걸어도 되는가. 되면 정규화한 주소를, 아니면 null.
 *
 * 🔴 문자열 검사로 하지 않는다. URL 파서에 맡긴다 —
 *    "https:/\/evil.com" 이나 " javascript:alert(1)" 처럼 눈으로 거르기 어려운 것들이 있다.
 * 🔴 상대경로·빈 값은 파서가 던진다. javascript:·data:·blob: 은 파서를 지나므로
 *    protocol 을 직접 본다.
 */
export function safeLinkHref(href: string | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

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
    // 링크
    'a',
    // 사진
    'img',
    // 유튜브 — Tiptap 이 div[data-youtube-video] 로 iframe 을 감싼다
    'div', 'iframe',
  ],
  allowedAttributes: {
    // 🔴 세 가지뿐이다. class·style·onclick 이 들어올 자리를 만들지 않는다.
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'class'],
    iframe: ['src', 'allowfullscreen', 'frameborder', 'allow', 'width', 'height'],
    div: ['class', 'data-youtube-video'],
  },
  /**
   * 🔴 링크는 여기서 판정하고 속성을 다시 쓴다.
   *
   *    안전한 주소  → a 로 남기고 target·rel 을 우리 값으로 덮어쓴다
   *    위험한 주소  → span 으로 바꾼다. span 은 allowedTags 에 없으므로
   *                  sanitize 가 태그를 벗기고 **글자만 남긴다** — 문장은 살아남는다
   *
   * 🔴 exclusiveFilter 를 쓰지 않는 이유가 이것이다. 그쪽은 내용까지 지운다.
   *    img·iframe 은 지워야 맞지만(빈 액자가 남는다) 링크는 글의 일부다.
   */
  transformTags: {
    a: (_tagName, attribs): sanitize.Tag => {
      const href = safeLinkHref(attribs.href)
      if (!href) return { tagName: 'span', attribs: {} }
      return { tagName: 'a', attribs: { href, target: LINK_TARGET, rel: LINK_REL } }
    },
  },
  // 🔴 style 을 열지 않는다. 인라인 스타일은 CSS 인젝션 표면이고,
  //    1차 툴바에는 굵게밖에 없어 쓸 일도 없다.
  allowedStyles: {},
  allowedIframeHostnames: [...ALLOWED_IFRAME_HOSTS],
  // 🔴 http 를 허용하지 않는다. 혼합 콘텐츠는 브라우저가 막아 빈 자리만 남는다.
  allowedSchemes: ['https'],
  // 🔴 a 도 https 만. transformTags 가 이미 걸렀지만 두 겹으로 둔다 —
  //    나중에 transformTags 를 고치는 사람이 이 줄을 함께 보게 된다.
  allowedSchemesByTag: { img: ['https'], a: ['https'] },
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
    const src = frame.attribs.src
    if (frame.tag === 'img') {
      // 🔴 우리 R2 주소가 아니면 태그째 지운다.
      //    외부 https · blob: · data: · 상대경로가 전부 여기서 걸린다.
      //    src 만 떼고 태그를 남기면 화면에 깨진 액자가 뜬다.
      return !src || !isOwnPublicUrl(src)
    }
    if (frame.tag === 'iframe') {
      // 유튜브 호스트 검사는 allowedIframeHostnames 가 이미 했다.
      // 여기서는 그 검사에 걸려 src 를 잃은 빈 상자를 치운다.
      return !src || !src.startsWith('https://')
    }
    return false
  },
}

/** 에디터가 만든 HTML 을 저장·표시 가능한 형태로 거른다. */
export function sanitizePostHtml(dirty: string): string {
  return sanitize(dirty, OPTIONS)
}

/**
 * 기존 글(평문)과 새 글(HTML)이 한 컬럼에 섞인다. 마이그레이션으로 옛 글을
 * HTML 로 바꾸지 않는다 — 26 건을 한 번에 치환하다 실패하면 되돌릴 근거가 없다.
 * 대신 읽을 때 어느 쪽인지 판별한다(post-content-format.ts).
 */

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
 * 요약에서 지우는 주소 표기.
 *
 * 🔴 태그를 떼는 것만으로는 부족하다. 본문에 주소를 그냥 적거나
 *    주소를 붙여넣어 링크가 되면(autolink) **링크 글자 자체가 주소**다.
 *    그러면 목록 카드에 "https://…" 가 그대로 뜬다 — QA 에서 실제로 잡혔다.
 *
 * 🔴 www. 로 시작하는 것도 본다. 스킴이 없어도 사람 눈에는 주소다.
 */
const URL_IN_TEXT = /(?:https?:\/\/|www\.)\S+/gi

/**
 * 한 줄로 눌러 낸 요약 — 목록 미리보기·검색 description 이 쓴다.
 *
 * 🔴 줄바꿈을 공백으로 눌러야 2줄 말줄임(line-clamp)이 예측 가능해진다.
 *
 * 🔴 주소를 지우고 사람이 쓴 문장만 남긴다.
 *    목록은 "무슨 이야기인가" 를 훑는 자리다. 주소 한 줄이 두 줄 미리보기의
 *    절반을 먹으면 정작 무슨 글인지 보이지 않는다.
 *    링크에 글자가 달려 있으면(예: "기사 제목") 그 글자는 그대로 남는다 —
 *    태그를 떼는 단계에서 이미 글자만 남았기 때문이다.
 *
 * 🔴 길이·금칙어 검사에는 이것을 쓰지 않는다(postContentToText).
 *    거기서 주소를 지우면 content-guard 의 링크 도배 판정이 무력해진다.
 */
export function postContentToSummary(content: string): string {
  return postContentToText(content)
    .replace(URL_IN_TEXT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
