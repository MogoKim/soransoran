import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import MagazineBody from '@/components/features/MagazineBody'
import { getMagazineArticleBySlug, getRelatedMagazineArticles } from '@/lib/magazine'
import { MAGAZINE_CLUSTER_LABELS } from '@/content/magazine/types'

// 다른 route 와 같이 동적 렌더한다. 콘텐츠가 TS 데이터라 조회 비용이 없다.
export const dynamic = 'force-dynamic'

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const article = getMagazineArticleBySlug(params.slug)
  if (!article) return {}

  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: `/magazine/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.description,
      type: 'article',
    },
  }
}

export default function MagazineArticlePage({ params }: { params: { slug: string } }) {
  const article = getMagazineArticleBySlug(params.slug)
  if (!article) notFound()

  const related = getRelatedMagazineArticles(article)

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <nav className="py-2">
          <Link href="/magazine" className="inline-flex min-h-[52px] items-center text-sm text-link">
            ← 매거진
          </Link>
        </nav>

        <article className="pb-6">
          <h1 className="text-2xl font-bold leading-snug text-content-primary">{article.title}</h1>

          <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
            <span className="font-bold text-brand-ink">
              {MAGAZINE_CLUSTER_LABELS[article.cluster]}
            </span>
            <span aria-hidden>·</span>
            <span>소란소란 편집팀</span>
            <span aria-hidden>·</span>
            <span>{article.publishedAt}</span>
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
