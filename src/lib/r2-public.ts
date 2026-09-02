/**
 * 우리 사진이 놓인 곳의 주소 — 서버·브라우저 양쪽이 같은 값을 본다.
 *
 * 🔴 r2.ts 에서 떼어 냈다. 그쪽은 S3 클라이언트를 만드는 server-only 모듈이라
 *    "이 주소가 우리 것인가" 하나를 묻자고 함께 끌어올 수 없다.
 *    같은 판단을 두 곳에 적으면 한쪽만 고쳐지는 날이 온다.
 *
 * 🔴 NEXT_PUBLIC_ 이라 브라우저 번들에 값이 들어간다.
 *    공개 읽기 주소이므로 숨길 것이 아니다 — 사진을 보는 사람이 어차피 받는 주소다.
 */
const PUBLIC_URL = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')

/** 미설정이면 어떤 주소도 우리 것이 아니다 — 열어 두는 쪽이 훨씬 위험하다. */
function publicOrigin(): string | null {
  if (!PUBLIC_URL) return null
  try {
    return new URL(PUBLIC_URL).origin
  } catch {
    return null
  }
}

const ORIGIN = publicOrigin()

/**
 * 우리 R2 의 공개 주소인가.
 *
 * 🔴 startsWith 로 보지 않는다. "https://our-cdn.com.evil.io/..." 가
 *    "https://our-cdn.com" 으로 시작하는 것처럼 보인다. origin 을 통째로 견준다.
 *
 * 🔴 https 만 본다. URL 파서가 origin 을 같게 보더라도 스킴이 다르면 우리 것이 아니다.
 */
export function isOwnPublicUrl(url: string): boolean {
  if (!ORIGIN) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.origin === ORIGIN
  } catch {
    // 상대경로·blob:·data: 는 여기서 걸린다(blob:/data: 는 파싱되지만 origin 이 다르다).
    return false
  }
}

/** 우리 공개 주소 → bucket key. 우리 것이 아니면 null. */
export function toR2Key(url: string): string | null {
  if (!isOwnPublicUrl(url)) return null
  try {
    const path = new URL(url).pathname.replace(/^\/+/, '')
    if (!path || path.includes('..')) return null
    return path
  } catch {
    return null
  }
}
