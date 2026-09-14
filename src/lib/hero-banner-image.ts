import { publicUrlFromKey } from '@/lib/r2-public'

/**
 * 배너 이미지 key → next/image 가 실제로 그릴 수 있는 주소.
 *
 * 🔴 next.config.js 의 remotePatterns 에 **등록된 host 하나**만 통과시킨다.
 *    next/image 는 등록되지 않은 host 를 받으면 렌더 중에 던지고,
 *    그러면 배너 한 장 때문에 어드민 화면 전체가 하얗게 된다.
 *    여기서 미리 걸러 "미리보기를 표시할 수 없습니다" 로 내려앉게 한다.
 *
 * 🔴 두 곳(이 파일 · next.config.js)에 같은 host 문자열이 있다.
 *    next.config.js 는 빌드 설정이라 import 할 수 없어 피할 수 없는 중복이다 —
 *    그래서 검증 스크립트가 두 값이 같은지 본다(check:hero-banner).
 *
 * 🔴 부채: r2.dev 는 Cloudflare 개발용 주소다. PR 3 전에 img.soransoran.com 으로
 *    옮긴다. 그때 이 상수 · next.config.js · NEXT_PUBLIC_R2_PUBLIC_URL 셋을 함께 바꾼다.
 */
export const HERO_BANNER_IMAGE_HOST = 'pub-a1dbda7462b84a98a36e29bd46ca7434.r2.dev'

export function heroBannerImageUrl(key: string | null | undefined): string | null {
  const url = publicUrlFromKey(key)
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== HERO_BANNER_IMAGE_HOST) return null
    if (!parsed.pathname.startsWith('/hero-banners/')) return null
    return url
  } catch {
    return null
  }
}
