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
 * 🔴 한 줄에서 판단이 끝나게 한다 — 제목 · 게시판 · 작성자 · 작성일 · 댓글 · 신고 · 상태.
 *    댓글 · 신고는 따로 열을 두고 오른쪽 정렬 숫자로 둔다 — 세로로 훑어 신고 있는 글이 바로 걸린다
 *    (Admin Golden Master · 2026-10-22). 신고 0 은 흐린 「–」, 1 이상은 빨간 문구 배지다.
 *    정상 「공개」는 글자로만 두고, 색은 숨김 · 신고처럼 손댈 것에만 남긴다.
 */
export const metadata: Metadata = { title: '게시글 관리' }
export const dynamic = 'force-dynamic'

const TAKE = 100

/**
 * 데스크탑 열 폭. 머리줄과 각 줄이 같은 값을 써야 칸이 맞는다.
 * 🔴 1024~1279 는 게시판 · 댓글 열을 접는다(WIDE 칸). 신고 열은 남긴다 — 손댈 것을 가리지 않는다.
 */
const COLS =
  'lg:grid-cols-[minmax(0,1fr)_7.5rem_9.5rem_4.5rem_5.5rem] xl:grid-cols-[minmax(0,1fr)_6rem_7.5rem_9.5rem_4rem_4.5rem_5.5rem]'
/** 1280 이상에서만 열이 되는 칸 — 모바일에서는 메타 줄에 그대로 보인다 */
const WIDE = 'lg:hidden xl:inline'

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
        group="콘텐츠 운영"
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
              <span className={WIDE}>게시판</span>
              <span>작성자</span>
              <span>작성일</span>
              <span className={`text-right ${WIDE}`}>댓글</span>
              <span className="text-right">신고</span>
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
                     데스크탑은 열 폭이 정해져 있어 한 줄을 유지하고, 전체 제목은 title 로 뜬다. */}
              <span title={p.title} className="line-clamp-2 min-w-0 font-semibold text-content-primary lg:truncate">
                {p.title}
              </span>

              {/* 모바일은 메타 칸을 한 줄로 모은다. 데스크탑은 lg:contents 로 각 칸이 표의 열이 된다 */}
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:contents">
              <AdminCell label="게시판" className={WIDE}>{boardLabel(p.boardType)}</AdminCell>

              <AdminCell label="작성자">
                {p.author.nickname ?? p.author.name ?? '회원'}
              </AdminCell>

              {/* 날짜는 곁다리다 — 작게 두고 자릿수를 맞춘다 */}
              <AdminCell label="작성" tone="meta" className="whitespace-nowrap tabular-nums">
                {formatKst(p.createdAt)}
              </AdminCell>

              <AdminCell label="댓글" className={`tabular-nums lg:text-right ${WIDE}`}>
                {p._count.comments}
              </AdminCell>

              {/* 🔴 신고 있는 글이 눈에 걸려야 한다. 0 은 데스크탑에서 흐린 「–」, 모바일에서는 빼 둔다 */}
              <span className="lg:text-right">
                {p._count.reports > 0 ? (
                  <AdminBadge tone="danger">신고 {p._count.reports}</AdminBadge>
                ) : (
                  <span aria-hidden="true" className="hidden text-xs text-content-muted lg:inline">
                    –
                  </span>
                )}
              </span>

              {/* 🔴 가려진 글만 색이 있다. 정상 「공개」는 글자로만 둔다 */}
              <span className="flex flex-wrap items-center gap-1">
                <AdminStatusBadge kind="post" value={p.status} />
              </span>
              </span>
            </AdminTableRow>
          ))}
        </AdminTable>
        </AdminListFilter>
      )}

    </div>
  )
}
