/**
 * 본문이 평문인지 HTML 인지 가르고, 평문을 HTML 로 바꾼다.
 *
 * 🔴 post-html.ts 에서 떼어 냈다. 그쪽은 sanitize-html 을 쓰는 server-only 모듈인데,
 *    글쓰기 폼(브라우저)도 "임시저장된 것이 평문인가" 를 물어야 한다.
 *    여기에는 의존성이 없다 — 서버·브라우저 어디서든 쓸 수 있다.
 *
 * 🔴 sanitize 는 여기서 하지 않는다. 형식을 가르는 일과 위험을 거르는 일은 다르다.
 *    브라우저에서 부를 수 있는 모듈에 sanitize 를 두면 "여기서 걸렀으니 안전하다" 는
 *    착각이 생긴다 — 서버가 다시 걸러야 한다는 사실이 흐려진다.
 */

/**
 * 이 본문이 에디터가 만든 HTML 인가.
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
 * 에디터에 처음 넣을 값.
 *
 * 🔴 평문을 그대로 Tiptap 에 넣으면 줄바꿈이 사라진다.
 *    Tiptap 은 HTML 을 파싱하므로 문자열 안의 \n 은 HTML 공백과 같이 취급되어
 *    한 문단으로 접힌다. 화면에서 접힌 것을 그대로 저장하면 옛 글의 줄이
 *    "고치기만 눌렀는데" 사라진다 — 지우는 것과 다름없다.
 *
 * 🔴 이미 HTML 인 글은 손대지 않는다. 다시 감싸면 문단이 겹친다.
 */
export function toEditorHtml(content: string): string {
  return isHtmlContent(content) ? content : plainTextToHtml(content)
}
