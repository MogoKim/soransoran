import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import MagazineBody from '@/components/features/MagazineBody'
import { getMagazineArticleBySlug, getRelatedMagazineArticles } from '@/lib/magazine'
import { formatMagazinePublishedDate } from '@/lib/magazine-date'
import { MAGAZINE_CLUSTER_LABELS, type MagazineArticle } from '@/content/magazine/types'
import { SITE } from '@/lib/brand'

// 다른 route 와 같이 동적 렌더한다. 콘텐츠가 TS 데이터라 조회 비용이 없다.
export const dynamic = 'force-dynamic'

/**
 * 구조화 데이터 — 검색엔진이 이 글을 Article 로, 위치를 breadcrumb 로 읽게 한다.
 *
 * ⚠️ 공개 관문을 우회하지 않는다.
 *    이 함수는 getMagazineArticleBySlug() 가 돌려준 글만 받는다.
 *    그 함수가 예약·차단·미래 글에 undefined 를 주므로, 미공개 글의 구조화 데이터가
 *    새어 나갈 경로가 없다.
 */
function buildStructuredData(article: MagazineArticle) {
  const url = `${SITE.url}/magazine/${article.slug}`

  // hero 가 없는 글도 있다. 빈 문자열을 넣지 않고 키 자체를 생략한다.
  const image = article.heroImage
    ? {
        image: {
          '@type': 'ImageObject',
          url: `${SITE.url}${article.heroImage.src}`,
          width: article.heroImage.width,
          height: article.heroImage.height,
          caption: article.heroImage.alt,
        },
      }
    : {}

  const publisher = { '@type': 'Organization', name: SITE.name, url: SITE.url }

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    // 수정 이력을 따로 두지 않는다. 두 개의 진실을 만들지 않기 위해서다.
    dateModified: article.publishedAt,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    publisher,
    author: { '@type': 'Organization', name: SITE.name },
    ...image,
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '홈', item: SITE.url },
      { '@type': 'ListItem', position: 2, name: '매거진', item: `${SITE.url}/magazine` },
      { '@type': 'ListItem', position: 3, name: article.title, item: url },
    ],
  }

  return [articleLd, breadcrumbLd]
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const article = getMagazineArticleBySlug(params.slug)
  if (!article) return {}

  // hero 가 없는 글도 있으므로 이미지 블록은 있을 때만 만든다.
  const shareImages = article.heroImage
    ? [
        {
          url: article.heroImage.src,
          width: article.heroImage.width,
          height: article.heroImage.height,
          alt: article.heroImage.alt,
        },
      ]
    : undefined

  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: `/magazine/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.description,
      type: 'article',
      publishedTime: article.publishedAt,
      images: shareImages,
    },
    twitter: {
      card: shareImages ? 'summary_large_image' : 'summary',
      title: article.title,
      description: article.description,
      images: shareImages,
    },
  }
}

export default function MagazineArticlePage({ params }: { params: { slug: string } }) {
  const article = getMagazineArticleBySlug(params.slug)
  if (!article) notFound()

  const related = getRelatedMagazineArticles(article)
  const structuredData = buildStructuredData(article)

  return (
    <PageShell>
      {/* 값은 전부 TS 데이터 파일(articles.ts)에서 온다. 사용자 입력이 들어오는 경로가 없다. */}
      {structuredData.map((data) => (
        <script
          key={data['@type']}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}

      <main className="mx-auto max-w-3xl px-4 pb-16">
        <nav className="py-2">
          <Link href="/magazine" className="inline-flex min-h-[52px] items-center text-sm text-link">
            ← 매거진
          </Link>
        </nav>

        {/* 커뮤니티 상세와 같은 면 규칙이다 — 오래 읽는 화면은 흰 면 위에 둔다 */}
        <article className="rounded-2xl border border-subtle bg-surface-card px-4 py-5 sm:px-6 sm:py-6">
          <h1 className="text-2xl font-bold leading-snug text-content-primary">{article.title}</h1>

          <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
            <span className="font-bold text-brand-ink">
              {MAGAZINE_CLUSTER_LABELS[article.cluster]}
            </span>
            <span aria-hidden>·</span>
            <span>소란소란 편집팀</span>
            <span aria-hidden>·</span>
            <span>{formatMagazinePublishedDate(article.publishedAt)}</span>
          </p>

          {article.heroImage ? (
            <Image
              src={article.heroImage.src}
              alt={article.heroImage.alt}
              width={article.heroImage.width}
              height={article.heroImage.height}
              className="mt-5 h-auto w-full rounded-lg"
              priority
            />
          ) : null}

          <div className="mt-5">
            <MagazineBody article={article} />
          </div>
        </article>

        {related.length > 0 ? (
          <section className="mt-8 border-t border-subtle pt-6">
            <h2 className="text-lg font-bold text-content-primary">함께 읽어보세요</h2>
            <ul className="mt-3 flex list-none flex-col gap-2 p-0">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/magazine/${item.slug}`}
                    className="flex min-h-[52px] items-center text-content-primary no-underline"
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </PageShell>
  )
}
