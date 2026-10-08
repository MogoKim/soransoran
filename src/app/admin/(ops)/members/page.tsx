import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst, REAL_MEMBER_WHERE } from '@/lib/admin-format'
import MemberAdminTabs from '@/components/admin/MemberAdminTabs'
import {
  AdminPageHeader,
  AdminBadge,
  AdminEmptyState,
  AdminTable,
  AdminTableRow,
  AdminCell,
} from '@/components/admin/AdminUi'

/**
 * 회원 목록 — 가볍게 훑고 상세로 넘어간다.
 *
 * 🔴 목록에 개인정보를 뿌리지 않는다.
 *    이메일·전화번호·생년은 상세에서만 본다. 목록은 어깨너머로도 보이는 화면이다.
 *
 * 🔴 실회원만 싣는다 — REAL_MEMBER_WHERE.
 *    페르소나도 User 행을 갖지만 차단하거나 상세를 열 대상이 아니다.
 *
 * 🔴 총계는 count 로 센다. 이 페이지가 실은 수(take 100)를 총계처럼 말하지 않는다.
 *
 * 🔴 신고 수는 "이 회원이 신고한 수" 다. 신고당한 수가 아니다 —
 *    Report 는 글·댓글을 가리키지 회원을 가리키지 않는다. 상세에서 글 기준으로 센다.
 *    라벨을 "신고함" 으로 적는 이유가 이것이다. 목록에서 뒤집혀 읽히면
 *    멀쩡한 회원이 문제 회원으로 보인다.
 */
export const metadata: Metadata = { title: '회원 관리' }
export const dynamic = 'force-dynamic'

const TAKE = 100

/**
 * 데스크탑 열 폭. 머리줄과 각 줄이 같은 값을 써야 칸이 맞는다.
 * 이름은 남는 폭을 먹고, 나머지는 내용 길이에 맞춰 고정한다.
 */
const COLS = 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8.5rem_10rem_8rem]'

export default async function AdminMembersPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const [total, members] = await Promise.all([
    prisma.user.count({ where: REAL_MEMBER_WHERE }),
    prisma.user.findMany({
      where: REAL_MEMBER_WHERE,
      select: {
        id: true,
        name: true,
        nickname: true,
        email: true,
        isOnboarded: true,
        isAdmin: true,
        isBlocked: true,
        createdAt: true,
        _count: { select: { posts: true, comments: true, reports: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: TAKE,
    }),
  ])

  /**
   * 신고당한 수 — Report 는 회원이 아니라 글·댓글을 가리킨다.
   * 목록에 이 값이 없으면 운영자가 "문제 회원인가" 를 알려고 상세를 하나씩 열어야 했다.
   * _count.reports 는 "이 회원이 신고한 수" 라 뜻이 정반대다.
   */
  const reportedRows = members.length
    ? await prisma.report.findMany({
        where: {
          OR: [
            { post: { authorId: { in: members.map((m) => m.id) } } },
            { comment: { authorId: { in: members.map((m) => m.id) } } },
          ],
        },
        select: {
          status: true,
          post: { select: { authorId: true } },
          comment: { select: { authorId: true } },
        },
      })
    : []

  const reportedAgainst = new Map<string, { total: number; pending: number }>()
  for (const r of reportedRows) {
    const authorId = r.post?.authorId ?? r.comment?.authorId
    if (!authorId) continue
    const cur = reportedAgainst.get(authorId) ?? { total: 0, pending: 0 }
    cur.total += 1
    if (r.status === 'PENDING') cur.pending += 1
    reportedAgainst.set(authorId, cur)
  }

  return (
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader
        title="회원 관리"
        description={
          total > members.length
            ? `카카오로 가입한 ${total}명 · 최근 가입순 ${members.length}명 표시`
            : `카카오로 가입한 ${total}명 · 최근 가입순`
        }
      />

      {/* 🔴 이 목록의 total 은 가입 미완료·남성·관리자까지 센 수다. 고객 수·연령 구성은 「고객 구성」 탭이 센다 */}
      <MemberAdminTabs current="members" />

      {members.length === 0 ? (
        <AdminEmptyState>
          카카오로 가입한 회원이 아직 없습니다. 페르소나 계정은 여기 나오지 않습니다.
        </AdminEmptyState>
      ) : (
        <AdminTable
          columns={COLS}
          head={
            <>
              <span>닉네임 · 카카오 이름</span>
              <span>이메일</span>
              <span>가입일</span>
              <span>활동</span>
              <span>상태</span>
            </>
          }
        >
          {members.map((m) => {
            const against = reportedAgainst.get(m.id)
            return (
              <AdminTableRow key={m.id} href={`/admin/members/${m.id}`} columns={COLS}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-bold text-content-primary">
                    {m.nickname ?? '(닉네임 없음)'}
                  </span>
                  <span className="truncate text-xs text-content-muted">
                    {m.name ?? '(카카오 이름 없음)'}
                  </span>
                </span>

                <AdminCell label="이메일" className="truncate">
                  {m.email ?? <span className="text-content-muted">없음</span>}
                </AdminCell>

                {/* 날짜는 곁다리다 — 작게 두고 자릿수를 맞춘다 */}
                <AdminCell label="가입" tone="meta" className="tabular-nums">
                  {formatKst(m.createdAt)}
                </AdminCell>

                <AdminCell label="활동">
                  글 {m._count.posts} · 댓글 {m._count.comments}
                </AdminCell>

                <span className="flex flex-wrap items-center gap-1">
                  {m.isBlocked ? <AdminBadge tone="danger">차단됨</AdminBadge> : null}
                  {against?.pending ? (
                    <AdminBadge tone="warning">신고 {against.pending}건 미처리</AdminBadge>
                  ) : against?.total ? (
                    <AdminBadge>신고당함 {against.total}</AdminBadge>
                  ) : null}
                  {m.isAdmin ? <AdminBadge tone="brand">운영자</AdminBadge> : null}
                  {!m.isOnboarded ? <AdminBadge>온보딩 전</AdminBadge> : null}
                </span>
              </AdminTableRow>
            )
          })}
        </AdminTable>
      )}

    </main>
  )
}
