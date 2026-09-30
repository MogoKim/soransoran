import type { MetadataRoute } from 'next'
import { BRAND, SITE } from '@/lib/brand'

/**
 * PWA manifest
 *
 * 🔴 prefer_related_applications 를 두지 않는다. 켜는 순간 설치 화면이
 *    스토어 앱 설치를 권하게 되고, 웹으로 들어온 사람이 앱 설치 앞에서 멈춘다.
 *
 * ── 아이콘 (2026-09-29 원본 통일) ────────────────────────────
 *   네 파일 모두 창업자 원본 asset/Favicon.png(1254×1254) **전체를 변경 없이 축소**한 것이다.
 *   생성·재현: scripts/generate-app-icons.mjs
 *   /icon.png           96×96    src/app/icon.png       (Next.js app 규약 · 탭·검색 결과)
 *   /apple-icon.png     180×180  src/app/apple-icon.png (Next.js app 규약 · iPhone/iPad 홈)
 *   /brand/icon-192.png 192×192  public/brand/          Android/PWA 설치
 *   /brand/icon-512.png 512×512  public/brand/          Android/PWA 고해상도·스플래시
 *
 * 🔴 **purpose 를 적지 않는다 = 'any' 다. maskable 을 선언하지 않는다.**
 *    maskable 은 "가운데 지름 80% 원 안에 내용이 다 들어온다"는 약속이다.
 *    실측(512px · 2026-09-29): 내용 픽셀의 1.2% 가 그 원 밖이고 중심에서 최대 반경 83.5% 다
 *    (가운데 빛 끝 · 좌우 빛 표시 · 아랫줄 "소란" 의 아래 모서리). 선언하면 안드로이드가
 *    원형으로 자를 때 그 부분이 잘린다.
 *    🔴 통과시키려고 선언하지 않는다 — 선언은 사실의 진술이다.
 *       원본을 줄이거나 여백을 넣어 맞추는 것도 원본 변경이라 하지 않는다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.tagline,
    start_url: '/',
    display: 'standalone',
    background_color: BRAND.background,
    theme_color: BRAND.color,
    orientation: 'portrait-primary',
    lang: 'ko',
    categories: ['social', 'lifestyle'],
    icons: [
      { src: '/icon.png', sizes: '96x96', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
