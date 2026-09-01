import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst, orDash, REAL_MEMBER_WHERE } from '@/lib/admin-format'
import AdminActionButton from '@/components/admin/AdminActionButton'
import { setMemberBlocked } from '@/lib/actions/admin'
import type { Prisma } from '@prisma/client'

/**
 * 회원 상세 — 이 사람을 계속 둬도 되는지 판단하는 화면이다.
 *
 * 🔴 판단 요약이 먼저 온다. 신고당한 횟수와 차단 버튼을 맨 위에 둔다.
 *    개인정보 18줄을 먼저 읽게 하면 "상습범인가" 를 알기까지 화면을 다 내려야 한다 —
 *    신고 처리 중에 들어오는 화면이라 그 시간이 그대로 처리 지연이 된다.
 *
 * 🔴 개수는 _count 로 센다. take 20 으로 잘린 배열 길이를 총계라고 말하면
 *    50 번 신고당한 사람이 "20건" 으로 보인다 — 가장 위험한 회원이 가장 덜 위험해 보인다.
 *    목록은 최근 20건만 싣고, 그렇다고 화면에 적는다.
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

/** 각 목록에 싣는 최근 건수. 총계는 따로 센다. */
const TAKE = 20

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-subtle py-3 first:border-t-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-sm text-content-muted sm:w-40">{label}</dt>
      <dd className="m-0 break-all text-sm text-content-primary">{value}</dd>
    </div>
  )
}

/** 목록 제목 — 총계와 "최근 N건 표시" 를 구분해 적는다. */
function SectionHeading({ label, total, shown }: { label: string; total: number; shown: number }) {
  return (
    <h2 className="text-sm font-bold text-content-primary">
      {label} {total}건
      {total > shown ? (
        <span className="ml-1 font-normal text-content-muted">(최근 {shown}건 표시)</span>
      ) : null}
    </h2>
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
      // 🔴 목록 길이가 아니라 이 값이 총계다.
      _count: { select: { posts: true, comments: true, reports: true } },
      posts: {
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          _count: { select: { reports: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: TAKE,
      },
      comments: {
        select: { id: true, content: true, postId: true, isDeleted: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: TAKE,
      },
      reports: {
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
      },
    },
  })

  if (!member) notFound()

  // 신고당한 내역 — Report 는 회원이 아니라 글·댓글을 가리킨다. 그래서 대상 기준으로 센다.
  // 🔴 as const 를 붙이지 않는다. OR 이 readonly 배열이 되어 Prisma where 가 받지 못한다.
  const REPORTED_AGAINST_WHERE: Prisma.ReportWhereInput = {
    OR: [{ post: { authorId: member.id } }, { comment: { authorId: member.id } }],
  }

  // 🔴 총계와 미처리 수를 따로 센다. 목록 20건 안에 미처리가 없어도 밀린 신고는 있을 수 있다.
  const [reportedAgainstTotal, reportedAgainstPending, reportedAgainst] = await Promise.all([
    prisma.report.count({ where: REPORTED_AGAINST_WHERE }),
    prisma.report.count({ where: { ...REPORTED_AGAINST_WHERE, status: 'PENDING' } }),
    prisma.report.findMany({
      where: REPORTED_AGAINST_WHERE,
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
    }),
  ])

  const hiddenPosts = member.posts.filter((p) => p.status !== 'PUBLISHED').length

  return (
    <main>
      <Link href="/admin/members" className="mt-6 inline-flex min-h-[52px] items-center text-link">
        ← 목록으로
      </Link>

      <h1 className="text-xl font-bold text-content-primary">
        {member.nickname ?? member.name ?? '회원'}
        {member.isBlocked ? (
          <span className="ml-2 align-middle text-sm font-bold text-state-danger">차단됨</span>
        ) : null}
        {member.isAdmin ? (
          <span className="ml-2 align-middle text-sm text-content-muted">운영자</span>
        ) : null}
      </h1>

      {/* 🔴 판단 요약 — 이 화면에서 가장 먼저 읽혀야 하는 것. */}
      <section className="mt-4 rounded-lg border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-bold text-content-primary">운영 판단</h2>
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-content-muted">신고당함</dt>
            <dd
              className={
                reportedAgainstTotal > 0
                  ? 'm-0 text-lg font-bold text-state-danger'
                  : 'm-0 text-lg font-bold text-content-primary'
              }
            >
              {reportedAgainstTotal}건
            </dd>
          </div>
          <div>
            <dt className="text-xs text-content-muted">그중 미처리</dt>
            <dd
              className={
                reportedAgainstPending > 0
                  ? 'm-0 text-lg font-bold text-state-danger'
                  : 'm-0 text-lg font-bold text-content-primary'
              }
            >
              {reportedAgainstPending}건
            </dd>
          </div>
          <div>
            <dt className="text-xs text-content-muted">작성 글</dt>
            <dd className="m-0 text-lg font-bold text-content-primary">
              {member._count.posts}건
              {hiddenPosts > 0 ? (
                <span className="ml-1 text-xs font-normal text-content-muted">
                  최근 숨김 {hiddenPosts}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-content-muted">작성 댓글</dt>
            <dd className="m-0 text-lg font-bold text-content-primary">
              {member._count.comments}건
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-sm text-content-muted">
          차단하면 이 회원은 로그인 후에도 글·댓글을 쓸 수 없습니다. 글은 지워지지 않습니다.
        </p>
        <div className="mt-2">
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

      <section className="mt-4">
        <SectionHeading
          label="신고당한 내역"
          total={reportedAgainstTotal}
          shown={reportedAgainst.length}
        />
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

      <section className="mt-4">
        <SectionHeading label="작성 글" total={member._count.posts} shown={member.posts.length} />
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
        <SectionHeading
          label="작성 댓글"
          total={member._count.comments}
          shown={member.comments.length}
        />
        {member.comments.length === 0 ? (
          <p className="py-4 text-sm text-content-muted">작성한 댓글이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {member.comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <p className="m-0 whitespace-pre-wrap text-sm text-content-primary">{c.content}</p>
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
        <SectionHeading
          label="신고한 내역"
          total={member._count.reports}
          shown={member.reports.length}
        />
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

      <section className="mt-6 border-t border-subtle pt-4">
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
    </main>
  )
}
