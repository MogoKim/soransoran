import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/brand'
import { BOARD_REGISTRY } from '@/lib/board-registry'



/**
 * sitemap — 최소 유지
 *
 * 정본(m3 §3): sitemap · robots · canonical 정책은 단순하게 유지한다.
 * 글 상세 URL 은 DB 연결 후 추가한다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  return [
    { url: SITE.url, lastModified: now, changeFrequency: 'daily', priority: 1 },
    ...BOARD_REGISTRY.map((board) => ({
      url: `${SITE.url}${board.href}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ]
}
