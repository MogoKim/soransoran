import type { MetadataRoute } from 'next'
import { BRAND, SITE } from '@/lib/brand'

/**
 * PWA manifest
 *
 * 🔴 우나어 public/manifest.json 을 복사하지 않았다.
 *    우나어 manifest 에는 prefer_related_applications: true 와
 *    com.agenotmatter.app 이 들어 있어, 복사하면 소란소란 PWA 가
 *    우나어 안드로이드 앱 설치를 유도하게 된다.
 *
 * icons 는 브랜드 자산 확보 후 채운다. 지금은 빈 배열이다.
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
    icons: [],
  }
}
