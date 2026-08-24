import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/brand'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import { getAllMagazineArticles } from '@/lib/magazine'
import { prisma } from '@/lib/prisma'
import { SEARCH_INDEXABLE_WHERE } from '@/lib/post-visibility'
import type { BoardType } from '@prisma/client'

/**
 * sitemap — 최소 유지
 *
 * 정본(m3 §3): sitemap · robots · canonical 정책은 단순하게 유지한다.
 * URL 기준은 SITE.url 이라 배포별 vercel.app 주소가 새지 않는다.
 *
 * ⚠️ SORAN_ALLOW_INDEXING 이 꺼져 있으면 robots 가 전체를 차단하므로
 *    sitemap 에 글이 들어 있어도 색인되지 않는다. 색인 허용은 별도 판단이다.
 *
 * 🔴 Micro Seed 제외 — SEARCH_INDEXABLE_WHERE 가 유일한 판정 지점이다 (C-2).
 *    여기서 status/isMicroSeed 를 직접 비교하지 마라. 우나어는 그렇게 해서
 *    제외 조건이 49곳/9파일로 흩어졌다.
 */
export const dynamic = 'force-dynamic'

/** DB 조회가 실패해도 sitemap 자체는 200 으로 나가야 한다 */
async function getPublishedPosts() {
  try {
    return await prisma.post.findMany({
      where: {
        ...SEARCH_INDEXABLE_WHERE,
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
    // 🔴 커뮤니티 board list 는 Micro Seed 운영기 동안 sitemap 에서 제외한다.
    //    목록 카드에 Micro Seed 제목·본문 일부가 실리므로, 목록 페이지를 색인시키면
    //    글 단위 noindex 로도 막지 못하는 발췌 노출이 생긴다.
    //    board list 페이지 자체도 noindex, follow 다(community/[boardSlug]/page.tsx).
    //    개별 글은 여전히 아래 postEntries 로 색인 대상에 들어간다 — 유입 경로는 유지된다.
    //    Micro Seed 분리 렌더가 가능해지면 재검토한다(정본 TODO-17).
    // 베스트는 모아보기 로직이 없어 계속 제외한다.
    {
      url: `${SITE.url}/magazine`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    },
  ]

  const magazineEntries: MetadataRoute.Sitemap = getAllMagazineArticles().map((article) => ({
    url: `${SITE.url}/magazine/${article.slug}`,
    lastModified: new Date(article.publishedAt),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))

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

  return [...staticEntries, ...magazineEntries, ...postEntries]
}
