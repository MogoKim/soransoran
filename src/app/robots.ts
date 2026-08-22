import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/brand'



/**
 * robots
 *
 * 🔴 preview 기간에는 색인을 막는다.
 *    미완성 사이트를 검색엔진이 먼저 보면 초기 신뢰가 깎인다.
 *    production 배포일(go 판정 후)에 SORAN_ALLOW_INDEXING=true 로 해제한다.
 *
 * 🔴 우나어의 robots 를 복사하지 않았다.
 *    우나어에는 googleBot 전용 noindex(E0 정책)가 있으나
 *    소란소란은 그 정책의 대상이 아니다. 단순하게 유지한다.
 */
export default function robots(): MetadataRoute.Robots {
  const allowIndexing = process.env.SORAN_ALLOW_INDEXING === 'true'

  if (!allowIndexing) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] }],
    sitemap: `${SITE.url}/sitemap.xml`,
  }
}
