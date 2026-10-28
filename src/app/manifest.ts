import type { MetadataRoute } from 'next'
import { BRAND, SITE } from '@/lib/brand'

/**
 * PWA manifest
 *
 * 🔴 prefer_related_applications 를 두지 않는다. 켜는 순간 설치 화면이
 *    스토어 앱 설치를 권하게 되고, 웹으로 들어온 사람이 앱 설치 앞에서 멈춘다.
 *
 * ── 아이콘 ────────────────────────────────────────────────
 *   전부 창업자가 지정한 최신 asset/Favicon.png 에서 만든다. 생성·재현: scripts/generate-app-icons.mjs
 *   /brand/icon-192.png          192×192  any       원본 전체 축소
 *   /brand/icon-512.png          512×512  any       원본 전체 축소
 *   /brand/icon-maskable-192.png 192×192  maskable  원본 0.90배 + 모서리 아이보리로 끝까지 채움
 *   /brand/icon-maskable-512.png 512×512  maskable  같음
 *
 * 🔴 `/icon.png` · `/apple-icon.png` 를 여기 적지 않는다. (2026-10-19 S-PWA)
 *    Next.js 는 쿼리 없는 이 두 주소를 `immutable, max-age=1년` 으로 내보낸다. HTML 은 `?hash` 를
 *    붙여 최신을 받지만 manifest 는 쿼리 없는 주소를 쓴다. Chrome 이 설치 아이콘으로 180 을 고르면
 *    1년 캐시에 남은 옛 그림(2026-08 의 3원 심볼 등)이 그대로 나왔다. 두 파일은 탭 favicon 과
 *    iPhone 홈 아이콘으로 그대로 남는다 — manifest 에서만 뺀다.
 *
 * 🔴 any 와 maskable 을 나눈다. 원본은 내용이 반지름의 약 84% 까지 나가 maskable 안전 원(80%)을
 *    넘는다. 그대로 maskable 로 선언하면 원형 마스크에서 잘리고, 줄인 그림을 any 로 쓰면 마스크가
 *    없는 자리에서 로고가 괜히 작아진다. maskable 만 줄이는 것은 창업자 승인 한정 예외다
 *    (generate-app-icons.mjs 머리말). 안전 원 안에 드는지는 check:brand-assets 가 픽셀로 잰다.
 *
 * 🔴 theme_color 는 브랜드 주황이 아니라 페이지 바탕(BRAND.background)이다.
 *    설치형 PWA 의 상태표시줄이 콘텐츠보다 눈에 띄면 안 된다. 브랜드색은 화면 안의
 *    로고·링크·버튼에만 둔다. 일반 브라우저의 theme-color 는 layout 에서 선언하지 않는다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.tagline,
    start_url: '/',
    display: 'standalone',
    background_color: BRAND.background,
    theme_color: BRAND.background,
    orientation: 'portrait-primary',
    lang: 'ko',
    categories: ['social', 'lifestyle'],
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
