/**
 * 주소 판정 — 서버와 브라우저가 **같은 답**을 봐야 하는 순수 규칙.
 *
 * 🔴 post-html.ts 에서 떼어 냈다. 그쪽은 `import 'server-only'` 라
 *    브라우저 번들이 끌어올 수 없다. 히어로 배너 링크는 어드민 입력칸(브라우저)과
 *    서버 액션이 **같은 함수**로 판정해야 하므로, 판정만 여기로 옮긴다.
 *    r2-public.ts 를 r2.ts 에서 떼어 낸 것과 같은 판단이다.
 *
 * 🔴 판정을 두 곳에 적지 않는다. post-html.safeLinkHref 는 이제 이 파일을 부른다 —
 *    본문 링크와 배너 링크가 서로 다른 주소를 안전하다고 말하는 날이 오지 않게 한다.
 *
 * 🔴 문자열 검사로 하지 않는다. URL 파서에 맡긴다 —
 *    "https:/\/evil.com" 이나 " javascript:alert(1)" 처럼 눈으로 거르기 어려운 것들이 있다.
 *    javascript:·data:·blob: 은 파서를 지나므로 protocol 을 직접 본다.
 */

/**
 * 내부 경로를 파싱할 때 쓰는 가상의 바탕 주소.
 *
 * 🔴 실제로 존재하지 않아야 한다. `.invalid` 는 RFC 2606 이 "절대 등록되지 않는다" 고
 *    못 박은 TLD 라, 실수로 네트워크 요청이 나가더라도 닿을 곳이 없다.
 * 🔴 이 값은 비교용일 뿐 어디에도 노출되지 않는다.
 */
const INTERNAL_BASE = 'https://internal.invalid'

/**
 * 주소에 섞이면 안 되는 글자.
 *
 * 🔴 URL 파서는 tab·LF·CR 을 **조용히 지우고** 파싱한다.
 *    "/com\tmunity" 같은 값이 파서를 지나 "/community" 가 되는 식이라,
 *    파서에 넘기기 전에 여기서 먼저 막는다.
 * 🔴 역슬래시는 따로 막는다 — 브라우저에 따라 "/" 로 취급되어
 *    "/\evil.com" 이 protocol-relative 처럼 동작한다.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/
const BACKSLASH = /\\/

/**
 * https 절대 주소인가. 맞으면 정규화한 주소를, 아니면 null.
 *
 * 🔴 http 를 통과시키지 않는다. 혼합 콘텐츠는 브라우저가 막아 빈 자리만 남는다.
 * 🔴 상대경로·빈 값은 파서가 던진다. javascript:·data:·blob: 은 파서를 지나므로
 *    protocol 을 직접 본다.
 *
 * 🔴 이 함수의 동작은 post-html.safeLinkHref 의 원래 구현 그대로다.
 *    글 본문 링크가 이 함수에 걸려 있으므로 판정을 바꾸면 기존 글의 링크가 바뀐다.
 */
export function safeHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * 우리 사이트 안의 경로인가. 맞으면 정규화한 경로를, 아니면 null.
 *
 * 통과하는 것
 *   /community/free · /magazine/slug?q=1#top · /   (슬래시로 시작하는 우리 경로)
 *
 * 막는 것
 *   //evil.com        protocol-relative — "/" 로 시작하지만 브라우저는 밖으로 나간다
 *   /\evil.com        역슬래시 — 일부 브라우저가 "/" 로 읽는다
 *   https://…         절대 주소는 내부 경로가 아니다 (kind 가 다르다)
 *   community/free    슬래시 없이 시작하면 상대경로다 — 어디에 붙느냐로 뜻이 달라진다
 *   제어문자 포함      파서가 지워 버려 다른 경로가 된다
 *
 * 🔴 startsWith('/') 로 끝내지 않는다. "//evil.com" 이 그 검사를 지나간다.
 *    가상의 바탕 주소에 붙여 파싱한 뒤 **origin 이 그대로인지**로 판정한다 —
 *    밖으로 나가는 값은 여기서 origin 이 바뀌어 걸린다.
 *
 * 🔴 정규화한 값을 돌려준다. "/a/../b" 는 "/b" 가 되어 저장된다 —
 *    저장된 값과 실제로 이동할 곳이 달라지지 않게 한다.
 */
export function safeInternalPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (CONTROL_CHARS.test(raw)) return null
  if (BACKSLASH.test(raw)) return null
  if (!raw.startsWith('/')) return null
  // "//" 로 시작하면 파서가 host 로 읽는다. origin 비교로도 걸리지만 뜻을 분명히 적어 둔다.
  if (raw.startsWith('//')) return null

  try {
    const url = new URL(raw, INTERNAL_BASE)
    if (url.origin !== INTERNAL_BASE) return null
    const path = `${url.pathname}${url.search}${url.hash}`
    // 파싱 결과가 슬래시로 시작하지 않는 경우는 없어야 하지만, 두 겹으로 둔다.
    return path.startsWith('/') ? path : null
  } catch {
    return null
  }
}
