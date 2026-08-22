import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/brand'
import { BOARD_REGISTRY, COMMUNITY_BOARDS } from '@/lib/board-registry'
import { prisma } from '@/lib/prisma'
import type { BoardType } from '@prisma/client'

/**
 * sitemap — 최소 유지
 *
 * 정본(m3 §3): sitemap · robots · canonical 정책은 단순하게 유지한다.
 * URL 기준은 SITE.url 이라 배포별 vercel.app 주소가 새지 않는다.
 *
 * ⚠️ SORAN_ALLOW_INDEXING 이 꺼져 있으면 robots 가 전체를 차단하므로
 *    sitemap 에 글이 들어 있어도 색인되지 않는다. 색인 허용은 별도 판단이다.
 */
export const dynamic = 'force-dynamic'

/** DB 조회가 실패해도 sitemap 자체는 200 으로 나가야 한다 */
async function getPublishedPosts() {
  try {
    return await prisma.post.findMany({
      where: {
        status: 'PUBLISHED',
        boardType: { in: COMMUNITY_BOARDS.map((b) => b.type as BoardType) },
      },
      select: { id: true, boardType: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })
  } catch {
    return []
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticEntries: MetadataRoute.Sitemap = [
    { url: SITE.url, lastModified: now, changeFrequency: 'daily', priority: 1 },
    ...BOARD_REGISTRY.map((board) => ({
      url: `${SITE.url}${board.href}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ]

  const posts = await getPublishedPosts()
  const hrefByType = new Map(COMMUNITY_BOARDS.map((b) => [b.type as string, b.href as string]))

  const postEntries: MetadataRoute.Sitemap = posts.flatMap((post) => {
    const href = hrefByType.get(post.boardType)
    if (!href) return []
    return [
      {
        url: `${SITE.url}${href}/${post.id}`,
        lastModified: post.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      },
    ]
  })

  return [...staticEntries, ...postEntries]
}
