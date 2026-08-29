/**
 * 브랜드 상수 — CSS 밖에서 색이 필요한 곳의 단일 지점
 *
 * Next.js metadata(viewport.themeColor)와 manifest 는 CSS 변수를 해석하지 못한다.
 * 따라서 그 두 곳만 이 파일의 상수를 쓴다.
 *
 * 🔴 색상 hex 의 정의 위치는 두 곳뿐이다.
 *      1) src/app/globals.css   — 화면에 그려지는 모든 색
 *      2) 이 파일               — metadata · manifest · next/og (CSS 변수 미해석)
 *    컴포넌트에서는 절대 hex 를 쓰지 않는다. semantic token 만 쓴다.
 *
 * 색을 교체할 때는 이 두 파일만 고치면 된다.
 */
export const BRAND = {
  /** 브랜드 시그니처 — theme-color · OG 장식 면 · 아이콘 배경 */
  color: '#ff6f61',
  /** 페이지 배경 — manifest background_color · OG 배경 */
  background: '#fff8f6',
  /** 읽는 브랜드색 — OG 워드마크 */
  ink: '#ff6f61',
  /** 본문 텍스트 — OG 카피 */
  text: '#2f2624',
  /** 아이콘 글자색 · CTA 위 글자 */
  onBrand: '#ffffff',
  /** 주요 액션 — global-error 처럼 CSS 가 없을 수 있는 화면의 인라인 스타일용 */
  cta: '#b64235',
  /** 보조 텍스트 — 위와 동일 */
  muted: '#6f5e59',
} as const

/** 환경변수가 하나도 없을 때의 최종 기준 URL */
const DEFAULT_SITE_URL = 'https://soransoran.com'

/**
 * 사이트 기준 URL 해석
 *
 * 🔴 `??` 를 쓰면 안 된다. `??` 는 null/undefined 만 fallback 하므로
 *    빈 문자열("")이나 공백("   ")은 그대로 통과한다.
 *    Vercel 은 값이 비어 있어도 키를 주입하므로 실제로 ""가 들어오고,
 *    그 값이 `new URL("")` 에 도달하면 빌드가 다음과 같이 깨진다.
 *
 *      TypeError: Invalid URL  input: ''
 *      Failed to collect page data for /_not-found
 *
 * 그래서 아래 순서로 "유효한 절대 URL"이 될 때까지만 채택한다.
 *   1) NEXT_PUBLIC_APP_URL   — 명시적으로 지정한 값(운영 도메인)
 *   2) VERCEL_URL 계열       — preview 배포에서 자기 자신의 주소
 *   3) DEFAULT_SITE_URL      — 최종 fallback
 *
 * 반환값은 항상 trailing slash 가 없는 origin 형태다.
 * (`${SITE.url}${board.href}` 조합에서 `//community` 가 되는 것을 막는다)
 */
function normalizeUrl(raw: string | undefined, { assumeHttps = false } = {}): string | null {
  const value = raw?.trim()
  if (!value) return null

  const candidate = assumeHttps && !/^https?:\/\//i.test(value) ? `https://${value}` : value

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    // origin 만 쓴다 — path/query/trailing slash 를 제거해 조합 시 중복을 막는다
    return parsed.origin
  } catch {
    return null
  }
}

function resolveSiteUrl(): string {
  return (
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    // Vercel preview: 호스트만 주므로 https 를 붙여 해석한다
    normalizeUrl(process.env.NEXT_PUBLIC_VERCEL_URL, { assumeHttps: true }) ??
    normalizeUrl(process.env.VERCEL_URL, { assumeHttps: true }) ??
    DEFAULT_SITE_URL
  )
}

export const SITE = {
  name: '소란소란',
  title: '소란소란 - 40대 50대 여성을 위한 커뮤니티',
  tagline: '40대 50대 여성이 이야기하는 곳',
  description:
    '갱년기, 몸과 마음, 사는 이야기. 40대 50대 여성이 서로의 이야기를 나누는 곳입니다.',
  /** 항상 유효한 절대 URL. trailing slash 없음 */
  url: resolveSiteUrl(),
} as const
