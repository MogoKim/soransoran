import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst, REAL_MEMBER_WHERE } from '@/lib/admin-format'

/**
 * 회원 목록 — 가볍게 본다.
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
      <h1 className="pt-8 text-xl font-bold text-content-primary">회원 관리</h1>
      <p className="mt-1 text-sm text-content-muted">
        가입 회원 총 {total}명 · 최근 가입순 {members.length}명 표시 · 이름을 누르면 상세로
        갑니다
      </p>

      {members.length === 0 ? (
        <p className="py-16 text-center text-content-muted">회원이 없습니다.</p>
      ) : (
        <ul className="mt-6 flex list-none flex-col gap-3 p-0">
          {members.map((m) => (
            <li key={m.id}>
              <Link
                href={`/admin/members/${m.id}`}
                className="flex min-h-[52px] flex-col gap-1 rounded-lg border border-subtle bg-surface-card p-4 no-underline"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-content-primary">
                    {m.nickname ?? '(닉네임 없음)'}
                  </span>
                  <span className="text-sm text-content-muted">{m.name ?? '(이름 없음)'}</span>
                  {m.isAdmin ? (
                    <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-brand-ink">
                      관리자
                    </span>
                  ) : null}
                  {m.isBlocked ? (
                    <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-state-danger">
                      차단
                    </span>
                  ) : null}
                  {!m.isOnboarded ? (
                    <span className="rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted">
                      온보딩 전
                    </span>
                  ) : null}
                </span>
                <span className="text-sm text-content-muted">
                  가입 {formatKst(m.createdAt)} · 글 {m._count.posts} · 댓글 {m._count.comments} ·
                  신고함 {m._count.reports}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
