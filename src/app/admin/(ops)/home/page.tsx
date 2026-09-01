import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { getPopularDiscoveryPosts } from '@/lib/queries/posts'
import { popularityScore } from '@/lib/popularity'
import { getAllMagazineArticles } from '@/lib/magazine'
import { formatKst } from '@/lib/admin-format'
import { HOME_MAGAZINE_COUNT, HOME_POPULAR_COUNT } from '@/lib/home-exposure'

/**
 * 홈 노출 확인 — 읽기 전용.
 *
 * 🔴 고정·제외·순서 조정을 두지 않는다(1.5차).
 *    지금 홈 인기글은 댓글 수 + 최신성 자동 점수다. 수동 배치를 먼저 넣으면
 *    자동 점수와 두 축이 생겨 "왜 이게 떴나" 를 아무도 설명하지 못하게 된다.
 *
 * 🔴 개수도 홈과 같은 상수를 읽는다 — home-exposure.ts.
 *    여기에 숫자를 따로 적어 두면 홈에는 20개가 떠 있는데 운영자는 5개만 보고
 *    "문제 글이 없다" 고 판단하게 된다. 실제로 그렇게 어긋나 있었다.
 *
 * 🔴 홈과 같은 함수를 쓴다 — getPopularDiscoveryPosts.
 *    여기서 따로 조회하면 화면과 다른 목록을 보게 되고, 그 순간 이 화면은 거짓말이 된다.
 *
 * 문제 글은 /admin/content/[id] 에서 숨긴다. 여기서 조치하지 않는다.
 */
export const metadata: Metadata = { title: '홈 노출' }
export const dynamic = 'force-dynamic'


export default async function AdminHomeExposurePage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const posts = await getPopularDiscoveryPosts(HOME_POPULAR_COUNT)
  const now = new Date()

  // 매거진은 파일 기반이라 DB 조회가 없다. 홈과 같은 규칙(그림 있는 글 우선)을 그대로 쓴다.
  const articles = getAllMagazineArticles()
  const magazine = [
    ...articles.filter((a) => a.heroImage),
    ...articles.filter((a) => !a.heroImage),
  ].slice(0, HOME_MAGAZINE_COUNT)

  return (
    <main>
      <h1 className="pt-8 text-xl font-bold text-content-primary">홈 노출</h1>
      <p className="mt-1 text-sm text-content-muted">
        읽기 전용입니다. 고정·제외·순서 조정은 아직 없습니다.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-bold text-content-primary">지금 뜨는 이야기 {posts.length}건</h2>
        <p className="mt-1 text-sm text-content-muted">
          점수 = (댓글 수 + 1) / (경과시간h + 4)^0.8 · 갱년기톡 최소 노출을 보장합니다
        </p>

        {posts.length === 0 ? (
          <p className="py-8 text-sm text-content-muted">홈에 뜬 글이 없습니다.</p>
        ) : (
          <ol className="mt-2 flex list-none flex-col gap-2 p-0">
            {posts.map((post, index) => (
              <li key={post.id}>
                <Link
                  href={`/admin/content/${post.id}`}
                  className="flex min-h-[52px] flex-col gap-1 rounded-lg border border-subtle bg-surface-card p-3 no-underline"
                >
                  <span className="font-bold text-content-primary">
                    {index + 1}. {post.title}
                  </span>
                  <span className="text-sm text-content-muted">
                    {post.boardType} · 댓글 {post._count.comments} · {formatKst(post.createdAt)} ·
                    점수 {popularityScore(post, now).toFixed(3)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold text-content-primary">홈 매거진 {magazine.length}건</h2>
        <p className="mt-1 text-sm text-content-muted">
          대표 이미지가 있는 글을 앞에 세우고 그다음 최신순입니다
        </p>
        <ol className="mt-2 flex list-none flex-col gap-2 p-0">
          {magazine.map((article, index) => (
            <li
              key={article.slug}
              className="rounded-lg border border-subtle bg-surface-card p-3"
            >
              <p className="m-0 font-bold text-content-primary">
                {index + 1}. {article.title}
              </p>
              <p className="mt-1 text-sm text-content-muted">
                {article.publishedAt} · 대표 이미지 {article.heroImage ? '있음' : '없음'} ·{' '}
                <Link href={`/magazine/${article.slug}`} className="text-link">
                  고객 화면
                </Link>
              </p>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-6 text-sm text-content-muted">
        문제가 있는 글은 목록에서 눌러 <strong>게시글 상세</strong>로 간 뒤 숨김 처리합니다.
      </p>
    </main>
  )
}
