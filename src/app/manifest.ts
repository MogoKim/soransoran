import type { MetadataRoute } from 'next'
import { BRAND, SITE } from '@/lib/brand'

/**
 * PWA manifest
 *
 * 🔴 prefer_related_applications 를 두지 않는다. 켜는 순간 설치 화면이
 *    스토어 앱 설치를 권하게 되고, 웹으로 들어온 사람이 앱 설치 앞에서 멈춘다.
 *
 * ── 아이콘 (2026-09-21 신규 브랜드) ────────────────────────────
 *   /icon.png          32×32    src/app/icon.png       (Next.js app 규약)
 *   /apple-icon.png    180×180  src/app/apple-icon.png (Next.js app 규약)
 *   /brand/icon-192.png 192×192 public/brand/          설치 화면
 *   /brand/icon-512.png 512×512 public/brand/          스플래시·스토어 면
 *
 * 🔴 **purpose 를 적지 않는다 = 'any' 다. maskable 을 선언하지 않는다.**
 *    maskable 은 "가운데 지름 80% 원 안에 내용이 다 들어온다"는 약속이다.
 *    실측(512px 기준): 심볼 가로 점유 85.2% · 중심에서 최대 반경 92.6% ·
 *    심볼 픽셀의 57.4% 가 안전영역 밖이다. 선언하면 안드로이드가 원형·물방울로
 *    잘라낼 때 맞댄 손 바깥의 팔이 잘린다.
 *    🔴 통과시키려고 선언하지 않는다 — 선언은 사실의 진술이다.
 *       maskable 이 필요하면 심볼을 80% 안으로 넣은 **전용 자산**을 따로 만든다.
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
      { src: '/icon.png', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
