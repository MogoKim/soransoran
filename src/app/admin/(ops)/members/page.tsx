import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst, REAL_MEMBER_WHERE } from '@/lib/admin-format'
import {
  AdminPageHeader,
  AdminCard,
  AdminBadge,
  AdminEmptyState,
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

  return (
    <main>
      <AdminPageHeader
        title="회원"
        description={
          total > members.length
            ? `카카오로 가입한 ${total}명 · 최근 가입순 ${members.length}명 표시`
            : `카카오로 가입한 ${total}명 · 최근 가입순`
        }
      />

      {members.length === 0 ? (
        <AdminEmptyState>
          카카오로 가입한 회원이 아직 없습니다. 페르소나 계정은 여기 나오지 않습니다.
        </AdminEmptyState>
      ) : (
        <ul className="mt-6 flex list-none flex-col gap-3 p-0">
          {members.map((m) => (
            <li key={m.id}>
              <AdminCard href={`/admin/members/${m.id}`}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-bold text-content-primary">
                    {m.nickname ?? m.name ?? '(이름 없음)'}
                  </span>
                  {m.nickname && m.name ? (
                    <span className="break-words text-sm text-content-muted">{m.name}</span>
                  ) : null}
                  {m.isBlocked ? <AdminBadge tone="danger">차단됨</AdminBadge> : null}
                  {m.isAdmin ? <AdminBadge tone="brand">운영자</AdminBadge> : null}
                  {!m.isOnboarded ? <AdminBadge>온보딩 전</AdminBadge> : null}
                </span>
                <span className="text-sm text-content-muted">
                  가입 {formatKst(m.createdAt)}
                </span>
                <span className="text-sm text-content-muted">
                  글 {m._count.posts} · 댓글 {m._count.comments} · 신고함 {m._count.reports}
                </span>
              </AdminCard>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
