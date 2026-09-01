import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst, orDash, REAL_MEMBER_WHERE } from '@/lib/admin-format'
import AdminActionButton from '@/components/admin/AdminActionButton'
import { setMemberBlocked } from '@/lib/actions/admin'
import {
  AdminPageHeader,
  AdminSection,
  AdminBadge,
  AdminEmptyState,
  AdminQuote,
  AdminActionGroup,
  AdminFieldList,
  AdminField,
  AdminStatusBadge,
} from '@/components/admin/AdminUi'
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
 * 🔴 "신고한" 과 "신고당한" 을 붙여 두지 않는다. 두 목록이 나란히 있으면
 *    한 글자 차이로 뒤집혀 읽힌다 — 신고를 많이 한 사람이 문제 회원으로 보인다.
 *    신고당한 쪽만 위로 올리고, 신고한 쪽은 개인정보 앞에 따로 둔다.
 *
 * 🔴 개인정보는 이 화면에만 두고, 접어 둔다.
 *    전화번호·이메일은 볼 일이 있을 때만 펴서 본다 — 어깨너머로 보이는 화면이다.
 *    긴 값은 break-all 로 접는다(AdminField). 모바일에서 가로 스크롤이 생기면
 *    옆 칸을 덮어 읽을 수 없다.
 *
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

/** 목록 제목 — 총계와 "최근 N건 표시" 를 구분해 적는다. */
function countLabel(total: number, shown: number): string | undefined {
  return total > shown ? `최근 ${shown}건만 표시` : undefined
}

/** 신고 한 줄 — 신고한 내역과 신고당한 내역이 같은 모양이어야 헷갈리지 않는다. */
function ReportRow({
  reason,
  status,
  createdAt,
  postId,
  commentId,
}: {
  reason: string
  status: string
  createdAt: Date
  postId: string | null
  commentId: string | null
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-subtle bg-surface-card p-3 text-sm text-content-primary">
      <AdminBadge tone="brand">{reason}</AdminBadge>
      <AdminStatusBadge kind="report" value={status} />
      <span className="text-content-muted">{formatKst(createdAt)}</span>
      {postId ? (
        <Link href={`/admin/content/${postId}`} className="text-link">
          대상 글 보기
        </Link>
      ) : commentId ? (
        <span className="text-content-muted">대상: 댓글</span>
      ) : (
        <span className="text-content-muted">대상 없음</span>
      )}
    </li>
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
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader
        backHref="/admin/members"
        title={member.nickname ?? member.name ?? '회원'}
        badges={
          <>
            {member.isBlocked ? <AdminBadge tone="danger">차단됨</AdminBadge> : null}
            {member.isAdmin ? <AdminBadge tone="brand">운영자</AdminBadge> : null}
            {!member.isOnboarded ? <AdminBadge>온보딩 전</AdminBadge> : null}
            <AdminBadge>가입 {formatKst(member.createdAt)}</AdminBadge>
          </>
        }
      />

      {/* 🔴 판단 요약 — 이 화면에서 가장 먼저 읽혀야 하는 것. */}
      <section className="mt-4 rounded-lg border border-subtle bg-surface-card p-4">
        <h2 className="m-0 text-sm font-bold text-content-primary">운영 판단</h2>
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
            <dd className="m-0 text-lg font-bold text-content-primary">{member._count.posts}건</dd>
          </div>
          <div>
            <dt className="text-xs text-content-muted">작성 댓글</dt>
            <dd className="m-0 text-lg font-bold text-content-primary">
              {member._count.comments}건
            </dd>
          </div>
        </dl>

        {hiddenPosts > 0 ? (
          <p className="mt-3 text-sm text-state-danger">
            최근 글 {member.posts.length}건 중 {hiddenPosts}건이 가려져 있습니다.
          </p>
        ) : null}

        <AdminActionGroup
          label={member.isBlocked ? '되돌리기' : '위험한 조치'}
          hint={
            member.isAdmin
              ? '운영자는 차단할 수 없습니다.'
              : member.isBlocked
                ? '해제하면 다시 글과 댓글을 쓸 수 있습니다.'
                : '차단하면 로그인해도 글·댓글을 쓸 수 없습니다. 이미 쓴 글은 지워지지 않습니다.'
          }
        >
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
        </AdminActionGroup>
      </section>

      <AdminSection
        title={`신고당한 내역 ${reportedAgainstTotal}건`}
        description={countLabel(reportedAgainstTotal, reportedAgainst.length)}
      >
        {reportedAgainst.length === 0 ? (
          <AdminEmptyState>이 회원의 글·댓글이 신고된 적이 없습니다.</AdminEmptyState>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {reportedAgainst.map((r) => (
              <ReportRow key={r.id} {...r} />
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        title={`작성 글 ${member._count.posts}건`}
        description={countLabel(member._count.posts, member.posts.length)}
      >
        {member.posts.length === 0 ? (
          <AdminEmptyState>작성한 글이 없습니다.</AdminEmptyState>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {member.posts.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/content/${p.id}`}
                  className="flex min-h-[52px] flex-col gap-1 rounded-lg border border-subtle bg-surface-card p-3 no-underline"
                >
                  <span className="break-words font-bold text-content-primary">{p.title}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-content-muted">
                    {formatKst(p.createdAt)}
                    {p.status !== 'PUBLISHED' ? (
                      <AdminStatusBadge kind="post" value={p.status} />
                    ) : null}
                    {p._count.reports > 0 ? (
                      <AdminBadge tone="danger">신고 {p._count.reports}건</AdminBadge>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        title={`작성 댓글 ${member._count.comments}건`}
        description={countLabel(member._count.comments, member.comments.length)}
      >
        {member.comments.length === 0 ? (
          <AdminEmptyState>작성한 댓글이 없습니다.</AdminEmptyState>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {member.comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <p className="m-0 whitespace-pre-wrap break-words text-sm text-content-primary">
                  {c.content}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-content-muted">
                  <span>{formatKst(c.createdAt)}</span>
                  {c.isDeleted ? <AdminBadge tone="danger">숨김</AdminBadge> : null}
                  <Link href={`/admin/content/${c.postId}`} className="text-link">
                    글에서 보기
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        title={`이 회원이 신고한 내역 ${member._count.reports}건`}
        description={countLabel(member._count.reports, member.reports.length)}
      >
        {member.reports.length === 0 ? (
          <AdminEmptyState>이 회원이 신고한 내역이 없습니다.</AdminEmptyState>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {member.reports.map((r) => (
              <ReportRow key={r.id} {...r} />
            ))}
          </ul>
        )}
      </AdminSection>

      {/* 🔴 개인정보는 접어 둔다. 볼 일이 있을 때만 편다. */}
      <section className="mt-8 border-t border-subtle pt-6">
        <details>
          <summary className="min-h-[52px] cursor-pointer list-none py-3 text-sm font-bold text-content-primary">
            가입 정보 보기{' '}
            <span className="font-normal text-content-muted">
              (이메일·전화번호 등 개인정보)
            </span>
          </summary>
          <AdminFieldList>
            <AdminField label="소란소란 닉네임" value={orDash(member.nickname)} />
            <AdminField label="카카오 이름" value={orDash(member.name)} />
            <AdminField label="이메일" value={orDash(member.email)} />
            <AdminField label="전화번호" value={orDash(member.phoneNumber)} />
            <AdminField label="성별" value={orDash(member.gender)} />
            <AdminField label="출생연도" value={orDash(member.birthyear)} />
            <AdminField label="프로필 동의" value={formatKst(member.profileConsentAt)} />
            <AdminField label="마케팅 동의" value={formatKst(member.marketingConsentAt)} />
            <AdminField label="온보딩" value={member.isOnboarded ? '완료' : '전'} />
            <AdminField label="첫 인사" value={formatKst(member.firstGreetingAt)} />
            <AdminField label="가입일" value={formatKst(member.createdAt)} />
            <AdminField label="정보 수정일" value={formatKst(member.updatedAt)} />
          </AdminFieldList>

          {/* 🔴 raw id 는 한 겹 더 접는다. 평소 판단에 쓰이지 않고 자리만 차지한다. */}
          <details className="mt-2">
            <summary className="min-h-[52px] cursor-pointer list-none py-3 text-xs text-content-muted">
              내부 식별자 보기
            </summary>
            <AdminFieldList>
              <AdminField label="회원 id" value={member.id} />
              <AdminField label="providerId" value={orDash(member.providerId)} />
              <AdminField label="첫 인사 글 id" value={orDash(member.firstGreetingPostId)} />
              <AdminField label="프로필 이미지" value={orDash(member.image)} />
              <AdminField label="관리자" value={member.isAdmin ? '예' : '아니오'} />
            </AdminFieldList>
          </details>
        </details>
      </section>

      {member.isBlocked ? (
        <AdminQuote>
          차단된 회원입니다. 글과 댓글은 그대로 남아 있고, 새로 쓰는 것만 막혀 있습니다.
        </AdminQuote>
      ) : null}
    </main>
  )
}
