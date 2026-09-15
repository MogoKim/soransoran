import { publicUrlFromKey } from '@/lib/r2-public'

/**
 * 배너 이미지 key → next/image 가 실제로 그릴 수 있는 주소.
 *
 * 🔴 next.config.js 의 remotePatterns 에 **등록된 host** 만 통과시킨다.
 *    next/image 는 등록되지 않은 host 를 받으면 렌더 중에 던지고,
 *    그러면 배너 한 장 때문에 어드민 화면 전체가 하얗게 된다.
 *    여기서 미리 걸러 "미리보기를 표시할 수 없습니다" 로 내려앉게 한다.
 *
 * 🔴 두 곳(이 파일 · next.config.js)에 같은 host 문자열이 있다.
 *    next.config.js 는 빌드 설정이라 import 할 수 없어 피할 수 없는 중복이다 —
 *    그래서 검증 스크립트가 두 목록이 같은지 본다(check:hero-banner).
 *
 * 🔴 전환기라 host 가 둘이다 (2026-09-15). r2-public 의 허용 origin 과 같은 이유다 —
 *    env 를 새 주소로 바꾸기 **전에** 코드가 두 주소를 모두 그릴 수 있어야
 *    어드민 미리보기가 한순간도 깨지지 않는다.
 *
 * 🔴 경로는 여전히 `/hero-banners/` 하나다. 같은 bucket 에 회원 사진(posts/)이
 *    함께 있는데, 그쪽은 글 본문에서 sanitize 를 지나 `<img>` 로 나가고
 *    next/image 를 타지 않는다. 여기서 함께 열면 쓰지 않는 문이 하나 더 생긴다.
 *
 * 🔴 안정화 뒤 r2.dev 를 목록에서 뺀다. 그때 next.config.js 도 같이 줄인다.
 */
export const HERO_BANNER_IMAGE_HOSTS = [
  'pub-a1dbda7462b84a98a36e29bd46ca7434.r2.dev',
  'img.soransoran.com',
] as const

/** 배너 이미지가 놓일 수 있는 경로. 이 아래만 next/image 로 나간다. */
export const HERO_BANNER_IMAGE_PATH_PREFIX = '/hero-banners/'

export function heroBannerImageUrl(key: string | null | undefined): string | null {
  const url = publicUrlFromKey(key)
  if (!url) return null
  try {
    const parsed = new URL(url)
    // 🔴 정확히 일치로만 맞춘다 — endsWith 를 쓰면 evil-img.soransoran.com 이 통과한다.
    const hosts: readonly string[] = HERO_BANNER_IMAGE_HOSTS
    if (!hosts.includes(parsed.hostname)) return null
    if (!parsed.pathname.startsWith(HERO_BANNER_IMAGE_PATH_PREFIX)) return null
    return url
  } catch {
    return null
  }
}
