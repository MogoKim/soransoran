import type { MetadataRoute } from 'next'
import { BRAND, SITE } from '@/lib/brand'

/**
 * PWA manifest
 *
 * 🔴 prefer_related_applications 를 두지 않는다. 켜는 순간 설치 화면이
 *    스토어 앱 설치를 권하게 되고, 웹으로 들어온 사람이 앱 설치 앞에서 멈춘다.
 *
 * icons 는 app/icon.png · apple-icon.png 를 가리킨다.
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
    ],
  }
}
