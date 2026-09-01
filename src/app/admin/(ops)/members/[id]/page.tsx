import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst, orDash, REAL_MEMBER_WHERE } from '@/lib/admin-format'
import AdminActionButton from '@/components/admin/AdminActionButton'
import { setMemberBlocked } from '@/lib/actions/admin'

/**
 * 회원 상세 — 카카오에서 받아 저장한 값을 전부 보여준다.
 *
 * 🔴 개인정보는 이 화면에만 둔다. 목록으로 새어 나가지 않게 한다.
 * 🔴 긴 값(id·이메일·전화번호)은 break-all 로 접는다 — 모바일에서 가로 스크롤이 생기면
 *    옆 칸을 덮어 읽을 수 없다.
 * 🔴 실회원이 아니면 notFound 다 — 목록과 같은 기준(REAL_MEMBER_WHERE)을 쓴다.
 *    목록에서 뺀 사람이 주소만 알면 열리는 상태가 가장 위험하다.
 *    페르소나 User 를 여기서 열면 차단 버튼까지 보이게 된다.
 *
 * 🔴 isAdmin 을 화면에서 바꾸지 않는다. 권한 부여는 어드민의 일이 아니다.
 */
export const metadata: Metadata = { title: '회원 상세' }
export const dynamic = 'force-dynamic'

const TAKE = 20

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-subtle py-3 first:border-t-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-sm text-content-muted sm:w-40">{label}</dt>
      <dd className="m-0 break-all text-sm text-content-primary">{value}</dd>
    </div>
  )
}

export default async function AdminMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const { id } = await params

  // findUnique 는 id 외 조건을 받지 못한다. 실회원 조건을 함께 걸려면 findFirst 다.
  const member = await prisma.user.findFirst({
    where: { id, ...REAL_MEMBER_WHERE },
    select: {
      id: true,
      name: true,
      nickname: true,
      email: true,
      image: true,
      providerId: true,
      gender: true,
      birthyear: true,
      phoneNumber: true,
      profileConsentAt: true,
      marketingConsentAt: true,
      isOnboarded: true,
      isAdmin: true,
      isBlocked: true,
      firstGreetingAt: true,
      firstGreetingPostId: true,
      createdAt: true,
      updatedAt: true,
      posts: {
        select: { id: true, title: true, status: true, createdAt: true, _count: { select: { reports: true } } },
        orderBy: { createdAt: 'desc' },
        take: TAKE,
      },
      comments: {
        select: { id: true, content: true, postId: true, isDeleted: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: TAKE,
      },
      reports: {
        select: { id: true, reason: true, status: true, postId: true, commentId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: TAKE,
      },
    },
  })

  if (!member) notFound()

  // 신고당한 내역 — Report 는 회원이 아니라 글·댓글을 가리킨다. 그래서 대상 기준으로 센다.
  const reportedAgainst = await prisma.report.findMany({
    where: {
      OR: [{ post: { authorId: member.id } }, { comment: { authorId: member.id } }],
    },
    select: {
      id: true,
      reason: true,
      status: true,
      postId: true,
      commentId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: TAKE,
  })

  return (
    <main>
      <Link href="/admin/members" className="mt-6 inline-flex min-h-[52px] items-center text-link">
        ← 목록으로
      </Link>

      <h1 className="text-xl font-bold text-content-primary">
        {member.nickname ?? member.name ?? '회원'}
      </h1>

      <section className="mt-4 rounded-lg border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-bold text-content-primary">가입 정보</h2>
        <dl className="mt-2 flex flex-col">
          <Row label="회원 id" value={member.id} />
          <Row label="소란소란 닉네임" value={orDash(member.nickname)} />
          <Row label="카카오 이름" value={orDash(member.name)} />
          <Row label="이메일" value={orDash(member.email)} />
          <Row label="프로필 이미지" value={orDash(member.image)} />
          <Row label="providerId" value={orDash(member.providerId)} />
          <Row label="성별" value={orDash(member.gender)} />
          <Row label="출생연도" value={orDash(member.birthyear)} />
          <Row label="전화번호" value={orDash(member.phoneNumber)} />
          <Row label="프로필 동의" value={formatKst(member.profileConsentAt)} />
          <Row label="마케팅 동의" value={formatKst(member.marketingConsentAt)} />
          <Row label="온보딩" value={member.isOnboarded ? '완료' : '전'} />
          <Row label="관리자" value={member.isAdmin ? '예' : '아니오'} />
          <Row label="차단" value={member.isBlocked ? '차단됨' : '정상'} />
          <Row label="첫 인사" value={formatKst(member.firstGreetingAt)} />
          <Row label="첫 인사 글 id" value={orDash(member.firstGreetingPostId)} />
          <Row label="가입일" value={formatKst(member.createdAt)} />
          <Row label="수정일" value={formatKst(member.updatedAt)} />
        </dl>
      </section>

      <section className="mt-4">
        <h2 className="text-sm font-bold text-content-primary">
          작성 글 {member.posts.length}건
        </h2>
        {member.posts.length === 0 ? (
          <p className="py-4 text-sm text-content-muted">작성한 글이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {member.posts.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/content/${p.id}`}
                  className="flex min-h-[52px] flex-col gap-1 rounded-lg border border-subtle bg-surface-card p-3 no-underline"
                >
                  <span className="font-bold text-content-primary">{p.title}</span>
                  <span className="text-sm text-content-muted">
                    {formatKst(p.createdAt)} · {p.status}
                    {p._count.reports > 0 ? ` · 신고 ${p._count.reports}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-sm font-bold text-content-primary">
          작성 댓글 {member.comments.length}건
        </h2>
        {member.comments.length === 0 ? (
          <p className="py-4 text-sm text-content-muted">작성한 댓글이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {member.comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <p className="m-0 whitespace-pre-wrap text-sm text-content-primary">
                  {c.content}
                </p>
                <p className="mt-1 text-xs text-content-muted">
                  {formatKst(c.createdAt)}
                  {c.isDeleted ? ' · 숨김' : ''} ·{' '}
                  <Link href={`/admin/content/${c.postId}`} className="text-link">
                    글 보기
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-sm font-bold text-content-primary">
          신고한 내역 {member.reports.length}건
        </h2>
        {member.reports.length === 0 ? (
          <p className="py-4 text-sm text-content-muted">신고한 내역이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {member.reports.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-subtle bg-surface-card p-3 text-sm text-content-primary"
              >
                {r.reason} · {r.status} · {formatKst(r.createdAt)} ·{' '}
                {r.postId ? (
                  <Link href={`/admin/content/${r.postId}`} className="text-link">
                    대상 글
                  </Link>
                ) : (
                  <span className="break-all text-content-muted">댓글 {r.commentId}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-sm font-bold text-content-primary">
          신고당한 내역 {reportedAgainst.length}건
        </h2>
        {reportedAgainst.length === 0 ? (
          <p className="py-4 text-sm text-content-muted">신고당한 내역이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {reportedAgainst.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-subtle bg-surface-card p-3 text-sm text-content-primary"
              >
                {r.reason} · {r.status} · {formatKst(r.createdAt)} ·{' '}
                {r.postId ? (
                  <Link href={`/admin/content/${r.postId}`} className="text-link">
                    대상 글
                  </Link>
                ) : (
                  <span className="break-all text-content-muted">댓글 {r.commentId}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 border-t border-subtle pt-4">
        <h2 className="text-sm font-bold text-content-primary">조치</h2>
        <p className="mt-1 text-sm text-content-muted">
          차단하면 이 회원은 로그인 후에도 글·댓글을 쓸 수 없습니다. 글은 지워지지 않습니다.
        </p>
        <div className="mt-3">
          {member.isBlocked ? (
            <AdminActionButton
              label="차단 해제"
              run={async () => {
                'use server'
                return setMemberBlocked(member.id, false)
              }}
            />
          ) : (
            <AdminActionButton
              label="회원 차단"
              tone="danger"
              disabled={member.isAdmin}
              confirmText="이 회원을 차단할까요? 글은 지워지지 않습니다."
              run={async () => {
                'use server'
                return setMemberBlocked(member.id, true)
              }}
            />
          )}
        </div>
      </section>
    </main>
  )
}
