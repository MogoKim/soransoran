import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { getHomePopularPosts } from '@/lib/queries/posts'
import { popularityScore } from '@/lib/popularity'
import { getAllMagazineArticles } from '@/lib/magazine'
import { boardLabel, formatKst } from '@/lib/admin-format'
import { HOME_MAGAZINE_COUNT, HOME_POPULAR_COUNT } from '@/lib/home-exposure'
import { isOverrideActive } from '@/lib/home-exposure-rules'
import { DISCOVERY_ELIGIBLE_WHERE } from '@/lib/post-visibility'
import AdminHomeOverrideForm from '@/components/admin/AdminHomeOverrideForm'
import AdminHomeOverrideControls from '@/components/admin/AdminHomeOverrideControls'
import {
  AdminPageHeader,
  AdminSection,
  AdminBadge,
  AdminStatusBadge,
  AdminEmptyState,
} from '@/components/admin/AdminUi'

/**
 * 홈 노출 — 지금 무엇이 떴는지 보고, 예외를 얹는다.
 *
 * 🔴 자동 인기 점수를 대체하지 않는다. 예외는 그 위의 한 겹이다.
 *    점수는 popularity.ts 가 그대로 매기고, 여기서는 빼거나(HIDE) 앞에 세울(PIN) 뿐이다.
 *
 * 🔴 홈과 같은 함수·같은 상수를 쓴다 (getHomePopularPosts · HOME_POPULAR_COUNT).
 *    따로 조회하면 화면과 다른 목록을 보게 되어 이 화면이 거짓말이 된다.
 *
 * 🔴 "홈에만 영향" 을 화면에서 반복해 말한다.
 *    고정·숨김은 홈(/) 한 곳에만 걸린다 — 글 자체도, 게시판 목록도, /best 도 그대로다.
 *    /best 는 getPopularDiscoveryPosts(순수 점수)를 쓰고 이 예외를 타지 않는다.
 *    운영자가 이것을 "글 내리기" 로 오해하면 지워야 할 글을 홈에서만 빼고 끝낸다.
 *    글을 내리는 것은 /admin/content 의 일이다(Post.status).
 *
 * 🔴 매거진 rail 은 읽기만 한다. 조정 기능이 없다는 것을 화면에 적는다.
 */
export const metadata: Metadata = { title: '홈 노출' }
export const dynamic = 'force-dynamic'

/** 제목 검색 결과 상한. 더 보여줘도 고르기만 어려워진다. */
const SEARCH_LIMIT = 10

/** 만료까지 남은 시간을 사람이 읽는 말로. 지난 것은 화면에 오지 않는다. */
function untilLabel(expiresAt: Date | null, now: Date): string {
  if (!expiresAt) return '해제할 때까지'
  const minutes = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 60000))
  const left = minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`
  return `${formatKst(expiresAt)}까지 (${left} 남음)`
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
    getHomePopularPosts(HOME_POPULAR_COUNT),
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
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader
        title="홈 노출"
        description="고정·숨김은 홈 첫 화면에만 걸립니다. 글 자체도, 게시판 목록도, 베스트도 그대로입니다."
        badges={
          <>
            <AdminBadge tone={pinned.length > 0 ? 'brand' : 'muted'}>
              고정 {pinned.length}건
            </AdminBadge>
            <AdminBadge tone={hiddenRows.length > 0 ? 'brand' : 'muted'}>
              홈에서 숨김 {hiddenRows.length}건
            </AdminBadge>
          </>
        }
      />

      {/* ── 1) 걸려 있는 예외 — 지금 무엇이 손대져 있나 ─────── */}
      <AdminSection
        title="지금 걸린 예외"
        description="시간이 지나면 저절로 풀립니다. 미리 풀려면 해제를 누릅니다."
      >
        {pinned.length === 0 && hiddenRows.length === 0 ? (
          <AdminEmptyState>
            걸린 예외가 없습니다. 홈은 지금 자동 인기 점수만으로 채워지고 있습니다.
          </AdminEmptyState>
        ) : (
          <ol className="mt-2 flex list-none flex-col gap-2 p-0">
            {pinned.map((o, index) => (
              <li key={o.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <p className="m-0 flex flex-wrap items-center gap-2">
                  <AdminStatusBadge kind="override" value="PIN" />
                  <AdminBadge>{index + 1}번</AdminBadge>
                  <AdminBadge>{boardLabel(o.post.boardType)}</AdminBadge>
                </p>
                <Link
                  href={`/admin/content/${o.post.id}`}
                  className="mt-1 block break-words font-bold text-content-primary no-underline"
                >
                  {o.post.title}
                </Link>
                <p className="mt-1 text-sm text-content-muted">{untilLabel(o.expiresAt, now)}</p>
                <AdminHomeOverrideControls overrideId={o.id} canMove={pinned.length > 1} />
              </li>
            ))}
            {hiddenRows.map((o) => (
              <li key={o.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <p className="m-0 flex flex-wrap items-center gap-2">
                  <AdminStatusBadge kind="override" value="HIDE" />
                  <AdminBadge>{boardLabel(o.post.boardType)}</AdminBadge>
                </p>
                <Link
                  href={`/admin/content/${o.post.id}`}
                  className="mt-1 block break-words font-bold text-content-primary no-underline"
                >
                  {o.post.title}
                </Link>
                <p className="mt-1 text-sm text-content-muted">
                  {untilLabel(o.expiresAt, now)} · 게시판에는 그대로 있습니다
                </p>
                <AdminHomeOverrideControls overrideId={o.id} canMove={false} />
              </li>
            ))}
          </ol>
        )}
      </AdminSection>

      {/* ── 2) 지금 홈에 뜬 목록 ─────────────────────────── */}
      <AdminSection
        title={`지금 홈에 뜬 글 ${posts.length}건`}
        description="고정·숨김이 반영된 실제 결과입니다. 점수 = (댓글 수 + 1) / (경과시간h + 4)^0.8"
      >
        {posts.length === 0 ? (
          <AdminEmptyState>홈에 뜬 글이 없습니다.</AdminEmptyState>
        ) : (
          <ol className="mt-2 grid list-none grid-cols-1 gap-2 p-0 xl:grid-cols-2">
            {posts.map((post, index) => {
              const pin = pinned.find((o) => o.post.id === post.id)
              return (
                <li key={post.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                  <p className="m-0 flex flex-wrap items-center gap-2">
                    <AdminBadge>{index + 1}번째</AdminBadge>
                    <AdminBadge>{boardLabel(post.boardType)}</AdminBadge>
                    {pin ? <AdminBadge tone="brand">고정됨</AdminBadge> : null}
                  </p>
                  <Link
                    href={`/admin/content/${post.id}`}
                    className="mt-1 block break-words font-bold text-content-primary no-underline"
                  >
                    {post.title}
                  </Link>
                  <p className="mt-1 text-sm text-content-muted">
                    댓글 {post._count.comments} · {formatKst(post.createdAt)} · 점수{' '}
                    {popularityScore(post, now).toFixed(3)}
                  </p>
                  {pin ? null : <AdminHomeOverrideForm postId={post.id} compact />}
                </li>
              )
            })}
          </ol>
        )}
      </AdminSection>

      {/* ── 3) 글 검색 — 홈에 없는 글을 올릴 때 ──────────── */}
      <AdminSection
        title="홈에 없는 글 찾아 고정하기"
        description="제목으로 찾습니다. 갱년기톡·자유게시판의 공개된 글만 나옵니다."
      >
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
            <AdminEmptyState>
              「{query}」로 찾은 글이 없습니다. 숨긴 글과 매거진은 여기 나오지 않습니다.
            </AdminEmptyState>
          ) : (
            <ul className="mt-2 flex list-none flex-col gap-2 p-0">
              {results.map((r) => (
                <li key={r.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                  <p className="m-0 flex flex-wrap items-center gap-2">
                    <AdminBadge>{boardLabel(r.boardType)}</AdminBadge>
                  </p>
                  <Link
                    href={`/admin/content/${r.id}`}
                    className="mt-1 block break-words font-bold text-content-primary no-underline"
                  >
                    {r.title}
                  </Link>
                  <p className="mt-1 text-sm text-content-muted">{formatKst(r.createdAt)}</p>
                  <AdminHomeOverrideForm postId={r.id} />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </AdminSection>

      {/* ── 4) 매거진 (읽기 전용) ───────────────────────── */}
      <AdminSection
        title={`홈 매거진 ${magazine.length}건`}
        description="대표 이미지가 있는 글이 앞입니다. 이 자리는 조정 기능이 없습니다."
      >
        <ol className="mt-2 flex list-none flex-col gap-2 p-0">
          {magazine.map((article, index) => (
            <li key={article.slug} className="rounded-lg border border-subtle bg-surface-card p-3">
              <p className="m-0 flex flex-wrap items-center gap-2">
                <AdminBadge>{index + 1}번째</AdminBadge>
                <AdminBadge tone={article.heroImage ? 'muted' : 'danger'}>
                  대표 이미지 {article.heroImage ? '있음' : '없음'}
                </AdminBadge>
              </p>
              <p className="mt-1 break-words font-bold text-content-primary">{article.title}</p>
              <p className="mt-1 text-sm text-content-muted">{article.publishedAt}</p>
            </li>
          ))}
        </ol>
      </AdminSection>
    </main>
  )
}
