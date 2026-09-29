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
 * 🔴 고정·숨김은 홈 첫 화면에만 걸린다. /best 는 자기 순위 키(queries/best.ts loadBestPage)를
 *    써서 이 예외를 타지 않는다. 운영자가 이것을 "글 내리기" 로 오해하면
 *    지워야 할 글을 홈에서만 빼고 끝낸다 — 글을 내리는 것은 /admin/content 의 일이다.
 *
 * 화면은 네 구역이고 무게가 다르다.
 *   1) 지금 걸린 예외 — 운영자가 손댄 것. 가장 먼저 본다.
 *   2) 지금 홈에 뜬 글 — 실제 결과. 표로 훑고 그 자리에서 건다.
 *   3) 홈에 없는 글 찾기 — 필요할 때만 쓰는 보조 도구.
 *   4) 매거진 — 조정 기능이 없다. 읽기만 한다.
 */
export const metadata: Metadata = { title: '홈 노출' }
export const dynamic = 'force-dynamic'

/** 제목 검색 결과 상한. 더 보여줘도 고르기만 어려워진다. */
const SEARCH_LIMIT = 10

/** 곧 만료 = 30분 이내. 운영자가 "다시 걸어야 하나" 를 미리 알게 한다. */
const SOON_MINUTES = 30

/** 데스크탑 열 폭. 머리줄과 각 줄이 같은 값을 써야 칸이 맞는다. */
const PIN_COLS = 'lg:grid-cols-[5.5rem_minmax(0,1fr)_11rem_auto]'
const HOME_COLS = 'lg:grid-cols-[2rem_minmax(0,1fr)_13rem_auto]'

function minutesLeft(expiresAt: Date | null, now: Date): number | null {
  if (!expiresAt) return null
  return Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 60000))
}

function untilLabel(expiresAt: Date | null, now: Date): string {
  const m = minutesLeft(expiresAt, now)
  if (m === null) return '해제할 때까지'
  const left = m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`
  return `${formatKst(expiresAt)} · ${left} 남음`
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
  const soonExpiring = live.filter((o) => {
    const m = minutesLeft(o.expiresAt, now)
    return m !== null && m <= SOON_MINUTES
  }).length

  const pinnedIds = new Set(pinned.map((o) => o.post.id))

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
      <AdminPageHeader title="홈 노출" />

      {/* 상단 요약 — 상태와 범위를 한 줄로. 큰 박스를 두지 않는다. */}
      <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-content-primary">
          고정 <strong>{pinned.length}</strong> · 숨김 <strong>{hiddenRows.length}</strong>
        </span>
        {soonExpiring > 0 ? (
          <AdminBadge tone="warning">{SOON_MINUTES}분 내 만료 {soonExpiring}</AdminBadge>
        ) : (
          <span className="text-content-muted">곧 만료 없음</span>
        )}
        <span className="text-content-muted">
          홈 첫 화면에만 적용됩니다 · 게시판·상세·베스트는 그대로
        </span>
      </p>

      {/* ── 1) 지금 걸린 예외 ───────────────────────────── */}
      <AdminSection title="지금 걸린 예외" className="mt-5">
        {live.length === 0 ? (
          <div className="mt-2">
            <AdminEmptyState>
              걸린 예외가 없습니다. 홈은 자동 인기 점수만으로 채워지고 있습니다.
            </AdminEmptyState>
          </div>
        ) : (
          <div className="mt-2">
            <div
              className={`hidden border-b border-subtle px-2 pb-1.5 text-xs text-content-muted lg:grid lg:gap-3 ${PIN_COLS}`}
            >
              <span>상태</span>
              <span>글</span>
              <span>언제까지</span>
              <span className="text-right">조작</span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:gap-0">
              {[...pinned, ...hiddenRows].map((o, index) => {
                const isPin = o.action === 'PIN'
                return (
                  <li
                    key={o.id}
                    className={`rounded-lg border border-subtle bg-surface-card p-3 lg:grid lg:min-h-[44px] lg:items-center lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-2 lg:py-1.5 ${PIN_COLS}`}
                  >
                    <span className="flex items-center gap-1">
                      <AdminStatusBadge kind="override" value={o.action} />
                      {isPin ? (
                        <span className="text-xs text-content-muted">{index + 1}번</span>
                      ) : null}
                    </span>

                    <Link
                      href={`/admin/content/${o.post.id}`}
                      className="mt-1 block min-w-0 truncate text-sm font-bold text-content-primary no-underline lg:mt-0"
                    >
                      <span className="mr-1 text-xs font-normal text-content-muted">
                        {boardLabel(o.post.boardType)}
                      </span>
                      {o.post.title}
                    </Link>

                    <span className="mt-1 block text-xs text-content-muted lg:mt-0">
                      {untilLabel(o.expiresAt, now)}
                    </span>

                    <div className="mt-2 lg:mt-0">
                      <AdminHomeOverrideControls
                        overrideId={o.id}
                        canMove={isPin && pinned.length > 1}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </AdminSection>

      {/* ── 2) 지금 홈에 뜬 글 ──────────────────────────── */}
      <AdminSection
        title={`지금 홈에 뜬 글 ${posts.length}건`}
        description="고정·숨김이 반영된 실제 결과입니다. 점수 = (댓글 수 + 1) / (경과시간h + 4)^0.8"
        className="mt-6"
      >
        {posts.length === 0 ? (
          <div className="mt-2">
            <AdminEmptyState>홈에 뜬 글이 없습니다.</AdminEmptyState>
          </div>
        ) : (
          <div className="mt-2">
            <div
              className={`hidden border-b border-subtle px-2 pb-1.5 text-xs text-content-muted lg:grid lg:gap-3 ${HOME_COLS}`}
            >
              <span>#</span>
              <span>글</span>
              <span>댓글 · 작성 · 점수</span>
              <span className="text-right">고정 · 숨김</span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:gap-0">
              {posts.map((post, index) => (
                <li
                  key={post.id}
                  className={`rounded-lg border border-subtle bg-surface-card p-3 lg:grid lg:min-h-[44px] lg:items-center lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-2 lg:py-1.5 ${HOME_COLS}`}
                >
                  <span className="text-xs font-bold text-content-muted">{index + 1}</span>

                  <Link
                    href={`/admin/content/${post.id}`}
                    className="mt-1 block min-w-0 truncate text-sm font-bold text-content-primary no-underline lg:mt-0"
                  >
                    <span className="mr-1 text-xs font-normal text-content-muted">
                      {boardLabel(post.boardType)}
                    </span>
                    {post.title}
                  </Link>

                  <span className="mt-1 block text-xs text-content-muted lg:mt-0">
                    댓글 {post._count.comments} · {formatKst(post.createdAt)} ·{' '}
                    {popularityScore(post, now).toFixed(3)}
                  </span>

                  {/* 이미 고정된 글에는 조작 폼을 다시 주지 않는다 — 해제는 위 패널의 일이다. */}
                  <div className="mt-2 lg:mt-0">
                    {pinnedIds.has(post.id) ? (
                      <p className="m-0 text-xs text-content-muted lg:text-right">
                        고정됨 · 위에서 해제
                      </p>
                    ) : (
                      <AdminHomeOverrideForm postId={post.id} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </AdminSection>

      {/* ── 3) 홈에 없는 글 찾기 ────────────────────────── */}
      <AdminSection
        title="홈에 없는 글 찾기"
        description="갱년기톡·자유게시판의 공개된 글만 나옵니다."
        className="mt-6"
      >
        <form action="/admin/home" method="get" className="mt-2 flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="제목으로 찾기"
            className="min-h-[52px] flex-1 rounded-lg border border-subtle bg-surface-card px-3 text-sm text-content-primary lg:min-h-[36px] lg:max-w-sm"
          />
          <button
            type="submit"
            className="inline-flex min-h-[52px] items-center justify-center rounded-lg border border-interactive px-3 text-sm font-bold text-content-primary transition duration-150 hover:bg-surface-soft active:scale-[0.98] lg:min-h-[36px]"
          >
            찾기
          </button>
        </form>

        {query ? (
          results.length === 0 ? (
            <div className="mt-2">
              <AdminEmptyState>
                「{query}」로 찾은 글이 없습니다. 숨긴 글과 매거진은 여기 나오지 않습니다.
              </AdminEmptyState>
            </div>
          ) : (
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0 lg:gap-0">
              {results.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-subtle bg-surface-card p-3 lg:flex lg:min-h-[44px] lg:items-center lg:justify-between lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-2 lg:py-1.5"
                >
                  <Link
                    href={`/admin/content/${r.id}`}
                    className="block min-w-0 truncate text-sm font-bold text-content-primary no-underline"
                  >
                    <span className="mr-1 text-xs font-normal text-content-muted">
                      {boardLabel(r.boardType)}
                    </span>
                    {r.title}
                    <span className="ml-2 text-xs font-normal text-content-muted">
                      {formatKst(r.createdAt)}
                    </span>
                  </Link>
                  <div className="mt-2 shrink-0 lg:mt-0">
                    <AdminHomeOverrideForm postId={r.id} />
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </AdminSection>

      {/* ── 4) 매거진 (읽기 전용) ───────────────────────── */}
      <AdminSection
        title="매거진 홈 노출"
        description="대표 이미지가 있는 글이 앞입니다. 이 자리는 조정 기능이 없습니다."
        className="mt-6 border-t border-subtle pt-4"
      >
        <ol className="m-0 mt-2 flex list-none flex-col p-0">
          {magazine.map((article, index) => (
            <li
              key={article.slug}
              className="flex min-h-[36px] items-center gap-2 border-b border-subtle px-2 py-1.5 text-sm last:border-b-0"
            >
              <span className="text-xs text-content-muted">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-content-primary">{article.title}</span>
              <span className="shrink-0 text-xs text-content-muted">{article.publishedAt}</span>
              {article.heroImage ? null : <AdminBadge tone="warning">이미지 없음</AdminBadge>}
            </li>
          ))}
        </ol>
      </AdminSection>
    </main>
  )
}
