import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { boardLabel, formatKst } from '@/lib/admin-format'
import {
  AdminPageHeader,
  AdminBadge,
  AdminStatusBadge,
  AdminEmptyState,
  AdminTable,
  AdminTableRow,
  AdminCell,
  AdminRangeNote,
} from '@/components/admin/AdminUi'
import AdminListFilter from '@/components/admin/AdminListFilter'

/**
 * 게시글 목록.
 *
 * 🔴 노출 판정 where 를 쓰지 않는다. 어드민은 숨긴 글도 봐야 한다 —
 *    숨긴 글이 목록에서 사라지면 되돌릴 방법이 없다.
 * 🔴 신고 수는 대상 글의 Report 수다. 상태와 무관하게 전부 센다.
 *
 * 🔴 한 줄에서 판단이 끝나게 한다 — 게시판 · 상태 · 신고 수 · 제목 · 작성자 · 댓글 수.
 *    신고와 숨김은 눈에 걸려야 하므로 제목 위에 배지로 올린다.
 */
export const metadata: Metadata = { title: '게시글 관리' }
export const dynamic = 'force-dynamic'

const TAKE = 100

/** 데스크탑 열 폭. 머리줄과 각 줄이 같은 값을 써야 칸이 맞는다. */
const COLS = 'lg:grid-cols-[minmax(0,1fr)_5rem_7rem_8.5rem_9rem]'

export default async function AdminContentPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const [total, posts] = await Promise.all([
    prisma.post.count(),
    prisma.post.findMany({
      select: {
        id: true,
        title: true,
        boardType: true,
        status: true,
        createdAt: true,
        author: { select: { id: true, nickname: true, name: true } },
        _count: { select: { comments: true, reports: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: TAKE,
    }),
  ])

  return (
    <div>
      <AdminPageHeader
        group="운영"
        title="게시글"
        description={
          total > posts.length
            ? `전체 ${total}건 · 최신순 ${posts.length}건 표시 · 숨긴 글도 함께 보입니다`
            : `전체 ${total}건 · 최신순 · 숨긴 글도 함께 보입니다`
        }
      />

      {posts.length === 0 ? (
        <AdminEmptyState>아직 올라온 글이 없습니다.</AdminEmptyState>
      ) : (
        /* 🔴 거르기는 불러온 최신 {TAKE}건 안에서만 한다 — 조회·정렬·take 는 그대로다(Phase 1).
              서버 검색·페이지는 Phase 2 에서 실제로 연결될 때 붙인다. 가짜 페이지 버튼은 그리지 않는다. */
        <AdminListFilter
          searchLabel="제목 · 작성자 찾기"
          searchPlaceholder="불러온 글 안에서 찾기"
          chips={[
            { key: 'all', label: '전체', count: posts.length },
            { key: 'PUBLISHED', label: '공개', count: posts.filter((p) => p.status === 'PUBLISHED').length },
            { key: 'HIDDEN', label: '숨김', count: posts.filter((p) => p.status === 'HIDDEN').length },
            { key: 'DELETED', label: '삭제됨', count: posts.filter((p) => p.status === 'DELETED').length },
            { key: 'reported', label: '신고 있음', count: posts.filter((p) => p._count.reports > 0).length },
          ]}
        >
          <AdminRangeNote>
            {total > posts.length
              ? `전체 ${total}건 중 최신 ${posts.length}건을 불러왔습니다. 거르기와 찾기는 이 범위 안에서만 됩니다.`
              : `전체 ${total}건을 불러왔습니다.`}
          </AdminRangeNote>
        <AdminTable
          columns={COLS}
          head={
            <>
              <span>제목</span>
              <span>게시판</span>
              <span>작성자</span>
              <span>작성일</span>
              <span>상태</span>
            </>
          }
        >
          {posts.map((p) => (
            <AdminTableRow
              key={p.id}
              href={`/admin/content/${p.id}`}
              columns={COLS}
              filterKey={`${p.status}${p._count.reports > 0 ? ' reported' : ''}`}
              searchText={`${p.title} ${p.author.nickname ?? p.author.name ?? ''}`}
              /* 🔴 행 전체를 분홍으로 칠하지 않는다. 목록의 절반이 가려진 글일 때
                 화면이 온통 분홍이 되어 오히려 아무것도 눈에 안 띈다. 얇은 왼쪽 선만 둔다. */
              accent={p.status === 'PUBLISHED' ? undefined : 'muted'}
            >
              {/* 🔴 모바일에서는 두 줄까지 보여 준다. 한 줄 말줄임이면 제목이 늘
                     "…하는데 어떻게 해야…" 로 끝나 무슨 글인지 알 수 없었다.
                     데스크탑은 열 폭이 정해져 있어 한 줄을 유지한다. */}
              <span className="line-clamp-2 min-w-0 font-bold text-content-primary lg:truncate">
                {p.title}
              </span>

              <AdminCell label="게시판">{boardLabel(p.boardType)}</AdminCell>

              <AdminCell label="작성자">
                {p.author.nickname ?? p.author.name ?? '회원'}
              </AdminCell>

              {/* 날짜는 곁다리다 — 작게 두고 자릿수를 맞춘다 */}
              <AdminCell label="작성" tone="meta" className="tabular-nums">
                {formatKst(p.createdAt)}
              </AdminCell>

              {/* 🔴 가려진 글과 신고 있는 글이 눈에 걸려야 한다. 나머지는 조용히 둔다. */}
              <span className="flex flex-wrap items-center gap-1">
                {p.status !== 'PUBLISHED' ? (
                  <AdminStatusBadge kind="post" value={p.status} />
                ) : null}
                {p._count.reports > 0 ? (
                  <AdminBadge tone="danger">신고 {p._count.reports}</AdminBadge>
                ) : null}
                <span className="text-xs text-content-muted">댓글 {p._count.comments}</span>
              </span>
            </AdminTableRow>
          ))}
        </AdminTable>
        </AdminListFilter>
      )}

    </div>
  )
}
