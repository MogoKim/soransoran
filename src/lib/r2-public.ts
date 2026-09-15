/**
 * 우리 사진이 놓인 곳의 주소 — 서버·브라우저 양쪽이 같은 값을 본다.
 *
 * 🔴 r2.ts 에서 떼어 냈다. 그쪽은 S3 클라이언트를 만드는 server-only 모듈이라
 *    "이 주소가 우리 것인가" 하나를 묻자고 함께 끌어올 수 없다.
 *    같은 판단을 두 곳에 적으면 한쪽만 고쳐지는 날이 온다.
 *
 * 🔴 NEXT_PUBLIC_ 이라 브라우저 번들에 값이 들어간다.
 *    공개 읽기 주소이므로 숨길 것이 아니다 — 사진을 보는 사람이 어차피 받는 주소다.
 *
 * ──────────────────────────────────────────────────────────────
 * 🔴 전환기 — 공개 주소 두 개를 함께 인정한다 (2026-09-15)
 *
 *    R2 bucket 하나에 공개 주소가 둘 붙어 있다.
 *      · pub-a1dbda…r2.dev   Cloudflare 개발용 주소. 지금까지 쓰던 것
 *      · img.soransoran.com  custom domain. 앞으로 쓸 것
 *    같은 bucket 이라 어느 쪽으로 받아도 **바이트가 같다**(객체 4개 실측 확인).
 *
 *    🔴 그런데 **이미 저장된 글 본문에 옛 주소가 절대 URL 로 박혀 있다.**
 *       허용 주소를 새 것 하나로 바꾸면 그 글들이 이렇게 된다.
 *         · sanitizePostHtml 의 exclusiveFilter 가 `<img>` 를 **태그째 지운다**
 *         · firstImageUrl 이 null 을 돌려줘 **thumbnailUrl 까지 비워진다**
 *       글을 한 번만 수정해도 사진이 영구히 사라진다. 그래서 둘 다 통과시킨다.
 *
 *    🔴 "둘 다" 는 **정확히 이 두 origin** 이다. 와일드카드(*.r2.dev)를 쓰지 않는다 —
 *       그것은 남의 bucket 까지 여는 문이다.
 *
 *    🔴 **읽기는 둘, 쓰기는 하나.** 새 URL 을 만드는 쪽은 환경변수 한 곳만 본다.
 *       새로 저장되는 주소가 두 갈래로 갈리면 나중에 어느 쪽이 정본인지 알 수 없다.
 *
 *    🔴 안정화 뒤 r2.dev 를 목록에서 뺀다. 빼기 전에 옛 주소가 본문에 남아 있지
 *       않은지 먼저 센다 — 2026-09-15 기준 Post.content 2건 · Post.thumbnailUrl 2건.
 * ──────────────────────────────────────────────────────────────
 */

/**
 * 전환기에 인정하는 공개 origin. **정확히 둘.**
 *
 * 🔴 hostname 이 아니라 origin 으로 둔다. scheme 과 port 까지 붙잡아야
 *    `http://…`(평문)와 `https://…:8443`(다른 포트)이 함께 걸러진다.
 */
export const ALLOWED_PUBLIC_ORIGINS = [
  'https://pub-a1dbda7462b84a98a36e29bd46ca7434.r2.dev',
  'https://img.soransoran.com',
] as const

/**
 * 새 URL 을 만들 때 쓰는 주소. 환경변수 하나가 정한다.
 *
 * 🔴 허용 목록과 역할이 다르다. 목록은 "읽을 때 받아 주는 범위",
 *    이 값은 "쓸 때 고르는 한 곳" 이다. 전환 스위치가 여기다.
 */
const PUBLIC_URL = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')

/** 미설정이면 주소를 만들지 않는다 — 열어 두는 쪽이 훨씬 위험하다. */
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
 *
 * 🔴 허용 목록과 **정확히 일치**할 때만 통과시킨다. 부분 문자열·접미사 비교를 쓰면
 *    `img.soransoran.com.evil.io` 나 `evil-img.soransoran.com` 이 새어 들어온다.
 *
 * 🔴 이 판정은 **환경변수를 보지 않는다.** env 가 어느 쪽을 가리키든
 *    이미 저장된 두 주소를 모두 읽을 수 있어야 하기 때문이다.
 */
export function isOwnPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const allowed: readonly string[] = ALLOWED_PUBLIC_ORIGINS
    return allowed.includes(parsed.origin)
  } catch {
    // 상대경로·blob:·data: 는 여기서 걸린다(blob:/data: 는 파싱되지만 origin 이 다르다).
    return false
  }
}

/**
 * bucket key → 공개 URL. 미설정이면 null.
 *
 * 🔴 toR2Key 의 반대 방향이다. DB 에는 **key 만** 저장하므로
 *    (URL 을 저장하면 도메인을 바꾸는 날 전부 깨진다) 화면에 보여 줄 때 여기서 조립한다.
 *
 * 🔴 **환경변수가 가리키는 한 곳으로만 만든다.** env 가 옛 주소면 옛 URL 이,
 *    새 주소면 새 URL 이 나온다.
 *
 * 🔴 만든 주소를 허용 목록으로 되검사한다. env 에 목록 밖 주소가 들어가면
 *    URL 을 만들지 않는다(fail closed) — 오타 하나로 엉뚱한 호스트를 가리키지 않는다.
 *
 * 🔴 key 를 믿지 않는다. 앞 슬래시·역슬래시·`..` 가 섞인 값이 오면
 *    origin 밖을 가리킬 수 있다 — 그런 key 로는 주소를 만들지 않는다.
 */
export function publicUrlFromKey(key: string | null | undefined): string | null {
  if (!PUBLIC_URL || !ORIGIN || !key) return null
  const trimmed = key.trim()
  if (trimmed !== key) return null
  if (trimmed === '' || trimmed.startsWith('/') || trimmed.includes('\\')) return null
  if (trimmed.includes('..') || trimmed.includes('?') || trimmed.includes('#')) return null
  const url = `${PUBLIC_URL}/${trimmed}`
  return isOwnPublicUrl(url) ? url : null
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
