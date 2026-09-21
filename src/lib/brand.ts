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
import { BRAND_NAME } from './brand-name'

export const BRAND = {
  /** 브랜드 시그니처 — theme-color · OG 장식 면 · 아이콘 배경 (= --brand) */
  color: '#fa4601',
  /**
   * 페이지 배경 — manifest background_color · OG 배경 (= --surface-app)
   *
   * 🔴 이전에는 이 값만 폐기된 옛 바탕색에 남아 화면과 갈려 있었다(KNOWN_DRIFT).
   *    웜 모노크롬 전환에서 --surface-app 과 같은 값으로 맞췄고,
   *    check:brand-colors 의 정식 PAIR 로 올려 다시 갈라지면 CI 가 잡는다.
   */
  background: '#fbfaf9',
  /**
   * 큰 글씨 브랜드색 (= --brand-ink)
   *
   * 🟡 **읽는 코드는 없다.** 화면의 --brand-ink 가 혼자 움직이는지 보는 짝으로 남긴다.
   *    소비처가 없다고 지우면 그 감시도 함께 사라진다 — check:brand-colors 의 정식 PAIR 다.
   */
  ink: '#fa4601',
  /**
   * 진한 주황 (= --brand-strong)
   *
   * 🕘 **2026-09-21 까지는 두 색 워드마크의 뒤 조각이었다.** global-error 와 next/og 가
   *    CSS 변수를 해석하지 못해 그 자리에서 이 값을 직접 썼다.
   *    로고가 이미지로 바뀌면서 **읽는 코드는 0 이 됐다.**
   *
   * 🔴 그래도 지우지 않는다. --brand-strong 은 화면에서 작은 글씨 브랜드 텍스트·배지가
   *    여전히 쓰는 토큰이고(카드 위 5.49:1), 이 상수는 그 값이 혼자 움직이는지 보는
   *    정식 PAIR 다. ink 와 같은 이유다 — 감시를 지우려고 짝을 지우지 않는다.
   */
  strong: '#c43300',
  /** 본문 텍스트 — OG 카피 (= --text-primary) */
  text: '#241e1b',
  /**
   * 고객 primary CTA 의 글자·아이콘 (= --cta-content)
   *
   * 🔴 CSS 변수를 쓸 수 없는 자리(global-error)에서도 화면과 같은 흰 내용을 쓴다.
   *    이 색은 **크기 계약과 한 몸**이다 — #fa4601 위 3.53:1 이라
   *    큰 굵은 글씨(18.66px+700)로만 통과한다. 작은 버튼에 쓰지 않는다.
   */
  onBrand: '#ffffff',
  /**
   * 대표 행동 면 — global-error 처럼 CSS 가 없을 수 있는 화면의 인라인 스타일용.
   * 🔴 짝은 --cta 다. 화면 CTA 와 같은 색이어야 CSS 유무로 버튼색이 갈리지 않는다.
   *    판독은 면이 아니라 onBrand(먹색 글씨)로 맞춘다 — 4.65:1.
   */
  cta: '#fa4601',
  /** 보조 텍스트 — 위와 동일 (= --text-muted) */
  muted: '#6e625c',
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
  name: BRAND_NAME,
  title: `${BRAND_NAME} - 40대 50대 여성을 위한 커뮤니티`,
  tagline: '40대 50대 여성이 이야기하는 곳',
  description:
    '갱년기, 몸과 마음, 사는 이야기. 40대 50대 여성이 서로의 이야기를 나누는 곳입니다.',
  /** 항상 유효한 절대 URL. trailing slash 없음 */
  url: resolveSiteUrl(),
} as const
