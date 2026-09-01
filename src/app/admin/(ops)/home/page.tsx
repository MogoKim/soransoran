import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { getPopularDiscoveryPosts } from '@/lib/queries/posts'
import { popularityScore } from '@/lib/popularity'
import { getAllMagazineArticles } from '@/lib/magazine'
import { formatKst } from '@/lib/admin-format'
import { HOME_MAGAZINE_COUNT, HOME_POPULAR_COUNT } from '@/lib/home-exposure'
import { isOverrideActive } from '@/lib/home-exposure-rules'
import { DISCOVERY_ELIGIBLE_WHERE } from '@/lib/post-visibility'
import AdminHomeOverrideForm from '@/components/admin/AdminHomeOverrideForm'
import AdminHomeOverrideControls from '@/components/admin/AdminHomeOverrideControls'

/**
 * 홈 노출 — 지금 무엇이 떴는지 보고, 예외를 얹는다.
 *
 * 🔴 자동 인기 점수를 대체하지 않는다. 예외는 그 위의 한 겹이다.
 *    점수는 popularity.ts 가 그대로 매기고, 여기서는 빼거나(HIDE) 앞에 세울(PIN) 뿐이다.
 *
 * 🔴 홈과 같은 함수·같은 상수를 쓴다 (getPopularDiscoveryPosts · HOME_POPULAR_COUNT).
 *    따로 조회하면 화면과 다른 목록을 보게 되어 이 화면이 거짓말이 된다.
 *
 * 🔴 숨김은 홈에서만이다. Post.status 를 바꾸지 않는다 —
 *    글을 내리는 것은 /admin/content 의 일이다.
 *
 * 🔴 매거진 rail 과 /best 는 이번 범위가 아니다. 매거진은 읽기만 한다.
 */
export const metadata: Metadata = { title: '홈 노출' }
export const dynamic = 'force-dynamic'

/** 제목 검색 결과 상한. 더 보여줘도 고르기만 어려워진다. */
const SEARCH_LIMIT = 10

const BOARD_LABEL: Record<string, string> = {
  MENOPAUSE: '갱년기톡',
  FREE: '자유',
  MAGAZINE: '매거진',
}

export default async function AdminHomeExposurePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const { q } = await searchParams
  const query = (q ?? '').trim()
  const now = new Date()

  const [posts, overrides] = await Promise.all([
    getPopularDiscoveryPosts(HOME_POPULAR_COUNT),
    prisma.homeExposureOverride.findMany({
      where: { surface: 'HOME_POPULAR', isActive: true },
      select: {
        id: true,
        action: true,
        position: true,
        expiresAt: true,
        isActive: true,
        createdAt: true,
        post: { select: { id: true, title: true, boardType: true } },
      },
      orderBy: [{ action: 'asc' }, { position: 'asc' }],
    }),
  ])

  // 만료된 행은 지우지 않고 화면에서만 뺀다 — 이력은 남는다
  const live = overrides.filter((o) => isOverrideActive(o, now))
  const pinned = live.filter((o) => o.action === 'PIN')
  const hiddenRows = live.filter((o) => o.action === 'HIDE')

  const results = query
    ? await prisma.post.findMany({
        where: {
          boardType: { in: ['MENOPAUSE', 'FREE'] },
          ...DISCOVERY_ELIGIBLE_WHERE,
          title: { contains: query, mode: 'insensitive' },
        },
        select: { id: true, title: true, boardType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: SEARCH_LIMIT,
      })
    : []

  const articles = getAllMagazineArticles()
  const magazine = [
    ...articles.filter((a) => a.heroImage),
    ...articles.filter((a) => !a.heroImage),
  ].slice(0, HOME_MAGAZINE_COUNT)

  return (
    <main>
      <h1 className="pt-8 text-xl font-bold text-content-primary">홈 노출</h1>
      <p className="mt-1 text-sm text-content-muted">
        자동 인기 점수 위에 고정·숨김만 얹습니다. 글 자체는 바뀌지 않습니다.
      </p>

      {/* ── 1) 지금 홈에 뜬 목록 ─────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-sm font-bold text-content-primary">
          지금 뜨는 이야기 {posts.length}건
        </h2>
        <p className="mt-1 text-sm text-content-muted">
          점수 = (댓글 수 + 1) / (경과시간h + 4)^0.8 · 고정·숨김이 반영된 결과입니다
        </p>

        {posts.length === 0 ? (
          <p className="py-8 text-sm text-content-muted">홈에 뜬 글이 없습니다.</p>
        ) : (
          <ol className="mt-2 flex list-none flex-col gap-2 p-0">
            {posts.map((post, index) => {
              const pin = pinned.find((o) => o.post.id === post.id)
              return (
                <li
                  key={post.id}
                  className="rounded-lg border border-subtle bg-surface-card p-3"
                >
                  <Link
                    href={`/admin/content/${post.id}`}
                    className="font-bold text-content-primary no-underline"
                  >
                    {index + 1}. {post.title}
                  </Link>
                  <p className="mt-1 text-sm text-content-muted">
                    {BOARD_LABEL[post.boardType] ?? post.boardType} · 댓글{' '}
                    {post._count.comments} · {formatKst(post.createdAt)} · 점수{' '}
                    {popularityScore(post, now).toFixed(3)}
                    {pin ? ' · 고정됨' : ''}
                  </p>
                  {pin ? null : <AdminHomeOverrideForm postId={post.id} compact />}
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {/* ── 2) 고정된 글 ────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-sm font-bold text-content-primary">고정 {pinned.length}건</h2>
        {pinned.length === 0 ? (
          <p className="py-4 text-sm text-content-muted">고정한 글이 없습니다.</p>
        ) : (
          <ol className="mt-2 flex list-none flex-col gap-2 p-0">
            {pinned.map((o, index) => (
              <li key={o.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <Link
                  href={`/admin/content/${o.post.id}`}
                  className="font-bold text-content-primary no-underline"
                >
                  {index + 1}. {o.post.title}
                </Link>
                <p className="mt-1 text-sm text-content-muted">
                  {BOARD_LABEL[o.post.boardType] ?? o.post.boardType} ·{' '}
                  {o.expiresAt ? `${formatKst(o.expiresAt)}까지` : '수동 해제까지'}
                </p>
                <AdminHomeOverrideControls overrideId={o.id} canMove={pinned.length > 1} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── 3) 홈에서 숨긴 글 ───────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-sm font-bold text-content-primary">
          홈에서 숨김 {hiddenRows.length}건
        </h2>
        <p className="mt-1 text-sm text-content-muted">
          홈에서만 빠집니다. 글은 게시판에 그대로 있습니다.
        </p>
        {hiddenRows.length === 0 ? (
          <p className="py-4 text-sm text-content-muted">숨긴 글이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {hiddenRows.map((o) => (
              <li key={o.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <Link
                  href={`/admin/content/${o.post.id}`}
                  className="font-bold text-content-primary no-underline"
                >
                  {o.post.title}
                </Link>
                <p className="mt-1 text-sm text-content-muted">
                  {BOARD_LABEL[o.post.boardType] ?? o.post.boardType} ·{' '}
                  {o.expiresAt ? `${formatKst(o.expiresAt)}까지` : '수동 해제까지'}
                </p>
                <AdminHomeOverrideControls overrideId={o.id} canMove={false} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 4) 글 검색 ─────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-sm font-bold text-content-primary">글 찾기</h2>
        <form action="/admin/home" method="get" className="mt-2 flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="제목으로 찾기"
            className="min-h-[52px] flex-1 rounded-lg border border-subtle bg-surface-card px-3 text-content-primary"
          />
          <button
            type="submit"
            className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-cta px-4 font-bold text-cta-text transition duration-150 hover:brightness-95 active:scale-[0.98]"
          >
            찾기
          </button>
        </form>

        {query ? (
          results.length === 0 ? (
            <p className="py-4 text-sm text-content-muted">찾는 글이 없습니다.</p>
          ) : (
            <ul className="mt-2 flex list-none flex-col gap-2 p-0">
              {results.map((r) => (
                <li key={r.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                  <Link
                    href={`/admin/content/${r.id}`}
                    className="font-bold text-content-primary no-underline"
                  >
                    {r.title}
                  </Link>
                  <p className="mt-1 text-sm text-content-muted">
                    {BOARD_LABEL[r.boardType] ?? r.boardType} · {formatKst(r.createdAt)}
                  </p>
                  <AdminHomeOverrideForm postId={r.id} />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      {/* ── 5) 매거진 (읽기 전용) ───────────────────────── */}
      <section className="mt-6">
        <h2 className="text-sm font-bold text-content-primary">홈 매거진 {magazine.length}건</h2>
        <p className="mt-1 text-sm text-content-muted">
          대표 이미지가 있는 글이 앞입니다. 이 자리는 조정 기능이 없습니다.
        </p>
        <ol className="mt-2 flex list-none flex-col gap-2 p-0">
          {magazine.map((article, index) => (
            <li key={article.slug} className="rounded-lg border border-subtle bg-surface-card p-3">
              <p className="m-0 font-bold text-content-primary">
                {index + 1}. {article.title}
              </p>
              <p className="mt-1 text-sm text-content-muted">
                {article.publishedAt} · 대표 이미지 {article.heroImage ? '있음' : '없음'}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
