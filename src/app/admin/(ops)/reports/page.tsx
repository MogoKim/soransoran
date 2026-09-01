import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { boardLabel, formatKst, isRealMember, postStatusLabel } from '@/lib/admin-format'
import { REPORT_REASONS } from '@/lib/report-reasons'
import AdminActionButton from '@/components/admin/AdminActionButton'
import AdminCommentEditForm from '@/components/admin/AdminCommentEditForm'
import {
  AdminPageHeader,
  AdminSection,
  AdminBadge,
  AdminEmptyState,
  AdminQuote,
  AdminActionGroup,
} from '@/components/admin/AdminUi'
import {
  setReportStatus,
  setPostHidden,
  setCommentHidden,
  setMemberBlocked,
} from '@/lib/actions/admin'

/**
 * 신고 관리 — 이 화면에서 판단하고 조치까지 끝낸다.
 *
 * 🔴 "확인함/처리함" 과 "글을 가림" 을 한 버튼으로 묶지 않는다.
 *    신고가 타당한지와 글을 내릴지는 다른 판단이다. 묶으면 되돌릴 수 없다.
 *    화면에서도 둘을 다른 묶음으로 나눠 둔다 — 급할수록 손이 먼저 나가는 자리다.
 *
 * 🔴 처리 사유를 남기지 않는다 — Report 에 사유 컬럼이 없다(1차 스키마 무변경).
 *    필요해지면 컬럼을 먼저 만든다.
 *
 * 🔴 삭제하지 않는다. 글은 HIDDEN, 댓글은 isDeleted 로만 가린다.
 *
 * 🔴 최신 N건을 받아 그 안에서 PENDING 을 고르지 않는다.
 *    신고가 쌓이면 오래된 미처리가 N건 밖으로 밀려 화면에서 사라진다 —
 *    가장 오래 방치된 건이 가장 먼저 안 보이게 된다.
 *    PENDING 과 처리분을 각각 따로 조회한다.
 *
 * 🔴 미처리 수는 count 로 센다. 실은 목록의 길이가 아니다.
 *
 * 🔴 판단 재료를 화면 안에 둔다.
 *    누가 썼는지 · 무슨 내용인지를 보러 다른 화면으로 나가야 하면
 *    신고 하나에 화면을 세 번 옮기게 된다. 대상 작성자와 원문 발췌를
 *    카드 안에 싣는다. 글 신고인데 제목만 보이던 것이 가장 큰 구멍이었다.
 *
 * 🔴 카드 안의 순서가 판단 순서다 —
 *    무슨 신고인가(사유·상태) → 무엇이 신고됐나(대상·원문) →
 *    누가 썼나(작성자) → 누가 신고했나 → 무엇을 할까(조치).
 *    모바일에서 카드가 길어져도 위에서 아래로 읽으면 결론이 난다.
 *
 * 🔴 조치도 화면 안에서 끝낸다 — 가리기 · 되돌리기 · 댓글 수정 · 회원 차단.
 *    서버 액션은 이미 있는 것만 쓴다. 새로 만들지 않는다.
 *
 * 미처리는 오래된 순이다 — 가장 오래 기다린 신고가 맨 위로 온다.
 * 처리분은 최신순으로 아래에 접어 둔다. 섞으면 미처리가 묻힌다.
 */
export const metadata: Metadata = { title: '신고 관리' }
export const dynamic = 'force-dynamic'

/** 한 번에 싣는 최대 건수 — 미처리·처리분 각각에 적용한다 */
const TAKE = 100

/**
 * 카드 안에 싣는 글 본문 길이.
 *
 * 🔴 전문을 싣지 않는다. 신고 열 건이면 화면이 글 열 편이 되어 목록이 아니게 된다.
 *    판단에 필요한 만큼만 보이고, 더 볼 사람은 글 상세로 간다.
 */
const EXCERPT = 300

const REASON_LABEL = new Map<string, string>(REPORT_REASONS.map((r) => [r.value, r.label]))

const STATUS_LABEL: Record<string, string> = {
  PENDING: '미처리',
  REVIEWED: '확인함',
  RESOLVED: '처리 완료',
}

/**
 * 미처리와 처리분이 같은 필드를 읽는다. 두 번 적으면 한쪽만 고쳐지는 날이 온다.
 *
 * 🔴 대상 작성자(post.author · comment.author)를 함께 가져온다.
 *    Report 에는 피신고자 컬럼이 없다 — 관계를 타고 가면 스키마를 바꾸지 않아도 된다.
 */
const AUTHOR_SELECT = {
  select: {
    id: true,
    nickname: true,
    name: true,
    isAdmin: true,
    isBlocked: true,
    // 🔴 실회원 판정 재료. isRealMember 가 이 둘을 본다 — 빠뜨리면 타입이 막는다.
    accounts: { where: { provider: 'kakao' }, select: { id: true }, take: 1 },
    persona: { select: { id: true } },
  },
} as const

const SELECT = {
  id: true,
  postId: true,
  commentId: true,
  reason: true,
  detail: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  reporter: { select: { id: true, nickname: true, name: true } },
  post: {
    select: {
      id: true,
      title: true,
      content: true,
      status: true,
      boardType: true,
      author: AUTHOR_SELECT,
    },
  },
  comment: {
    select: {
      id: true,
      content: true,
      isDeleted: true,
      postId: true,
      author: AUTHOR_SELECT,
    },
  },
} as const

async function loadReports() {
  const [pendingCount, pending, handled] = await Promise.all([
    prisma.report.count({ where: { status: 'PENDING' } }),
    prisma.report.findMany({
      where: { status: 'PENDING' },
      select: SELECT,
      orderBy: { createdAt: 'asc' },
      take: TAKE,
    }),
    prisma.report.findMany({
      where: { status: { not: 'PENDING' } },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
      take: TAKE,
    }),
  ])
  return { pendingCount, pending, handled }
}

type ReportRow = Awaited<ReturnType<typeof loadReports>>['pending'][number]
type TargetAuthor = NonNullable<ReportRow['post']>['author']

function displayName(user: { nickname: string | null; name: string | null }): string {
  return user.nickname ?? user.name ?? '회원'
}

/** 신고 카드 하나 — 판단 재료와 조치를 한 자리에 둔다. */
function ReportCard({ report }: { report: ReportRow }) {
  const targetPostId = report.post?.id ?? report.comment?.postId ?? null

  /**
   * 🔴 status 를 세 값으로 나눠 본다. `!== 'PUBLISHED'` 로 묶으면 DELETED 가
   *    "숨김" 으로 보이고 "글 다시 공개" 버튼까지 뜬다 — 눌러도 서버가 막아
   *    반드시 실패하는 버튼이 된다. /admin/content/[id] 도 DELETED 를 따로 가른다.
   */
  const postDeleted = report.post?.status === 'DELETED'
  const postHidden = report.post?.status === 'HIDDEN'

  // 글 신고면 글 작성자, 댓글 신고면 댓글 작성자다. 둘 다 없으면 대상이 사라진 것이다.
  const author: TargetAuthor | null = report.post?.author ?? report.comment?.author ?? null

  /**
   * 🔴 조치 대상이 될 수 있는 사람인가.
   *    페르소나·시스템 계정은 회원 상세가 열리지 않는다(REAL_MEMBER_WHERE).
   *    그쪽에서 막아 둔 차단을 이 화면이 열어 주면 안 된다 — 차단해 놓고
   *    해제하러 갈 화면이 없어진다. 신고는 그대로 보이되 조치 버튼만 가린다.
   */
  const authorIsMember = author ? isRealMember(author) : false

  const isPending = report.status === 'PENDING'

  return (
    <li className="rounded-lg border border-subtle bg-surface-card p-4">
      {/* ① 무슨 신고인가 */}
      <div className="flex flex-wrap items-center gap-2">
        <AdminBadge tone={isPending ? 'danger' : 'muted'}>
          {STATUS_LABEL[report.status] ?? report.status}
        </AdminBadge>
        <AdminBadge tone="brand">{REASON_LABEL.get(report.reason) ?? report.reason}</AdminBadge>
        <AdminBadge>{report.post ? '글 신고' : report.comment ? '댓글 신고' : '대상 없음'}</AdminBadge>
        <span className="text-xs text-content-muted">{formatKst(report.createdAt)}</span>
        {report.reviewedAt ? (
          <span className="text-xs text-content-muted">확인 {formatKst(report.reviewedAt)}</span>
        ) : null}
      </div>

      {/* ② 무엇이 신고됐나 */}
      {report.post ? (
        <div className="mt-3">
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-content-primary">
            <AdminBadge>{boardLabel(report.post.boardType)}</AdminBadge>
            {report.post.status !== 'PUBLISHED' ? (
              <AdminBadge tone="danger">{postStatusLabel(report.post.status)}</AdminBadge>
            ) : null}
            <Link href={`/admin/content/${report.post.id}`} className="break-words text-link">
              {report.post.title}
            </Link>
          </p>
          {/* 🔴 제목만으로는 욕설인지 광고인지 판단할 수 없다. 발췌를 함께 싣는다. */}
          <AdminQuote>
            {report.post.content.slice(0, EXCERPT)}
            {report.post.content.length > EXCERPT ? '…' : ''}
          </AdminQuote>
        </div>
      ) : report.comment ? (
        <div className="mt-3">
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-content-primary">
            <span>댓글 원문</span>
            {report.comment.isDeleted ? <AdminBadge tone="danger">숨김</AdminBadge> : null}
            {targetPostId ? (
              <Link href={`/admin/content/${targetPostId}`} className="text-link">
                글에서 보기
              </Link>
            ) : null}
          </p>
          <AdminQuote>{report.comment.content}</AdminQuote>
        </div>
      ) : (
        <p className="mt-3 text-sm text-content-muted">
          대상이 이미 사라졌습니다. 처리 완료로 닫아도 됩니다.
        </p>
      )}

      {report.detail ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-content-muted">
          신고자가 남긴 말: {report.detail}
        </p>
      ) : null}

      {/* ③ 누가 썼나 · ④ 누가 신고했나 */}
      <dl className="mt-3 flex flex-col gap-1 text-sm">
        {author ? (
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-content-muted">작성자</dt>
            <dd className="m-0 flex flex-wrap items-center gap-1 text-content-primary">
              {authorIsMember ? (
                <Link href={`/admin/members/${author.id}`} className="text-link">
                  {displayName(author)}
                </Link>
              ) : (
                // 회원 상세가 열리지 않는 계정이다. 링크를 걸면 404 로 보낸다.
                <span>{displayName(author)}</span>
              )}
              {author.isBlocked ? <AdminBadge tone="danger">차단됨</AdminBadge> : null}
              {author.isAdmin ? <AdminBadge>운영자</AdminBadge> : null}
              {authorIsMember ? null : (
                <AdminBadge>{author.persona ? '페르소나' : '시스템 계정'}</AdminBadge>
              )}
            </dd>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-content-muted">신고자</dt>
          <dd className="m-0 text-content-primary">
            <Link href={`/admin/members/${report.reporter.id}`} className="text-link">
              {displayName(report.reporter)}
            </Link>
          </dd>
        </div>
      </dl>

      {/* ⑤ 무엇을 할까 — 안전한 것과 위험한 것을 나눈다 */}
      <AdminActionGroup label="신고 처리">
        {isPending ? (
          <AdminActionButton
            label="확인함으로 표시"
            run={async () => {
              'use server'
              return setReportStatus(report.id, 'REVIEWED')
            }}
          />
        ) : null}

        {report.status !== 'RESOLVED' ? (
          <AdminActionButton
            label="처리 완료"
            run={async () => {
              'use server'
              return setReportStatus(report.id, 'RESOLVED')
            }}
          />
        ) : (
          <AdminActionButton
            label="미처리로 되돌리기"
            run={async () => {
              'use server'
              return setReportStatus(report.id, 'PENDING')
            }}
          />
        )}
      </AdminActionGroup>

      {/* 🔴 DELETED 는 글 버튼을 둘 다 렌더하지 않는다. 삭제는 이 화면이 만드는 상태도,
             되돌리는 상태도 아니다 — setPostHidden 이 서버에서 거절한다. */}
      {postDeleted ? (
        <p className="mt-3 text-xs text-content-muted">
          삭제 상태인 글이라 공개 상태는 여기서 바꾸지 않습니다.
        </p>
      ) : null}

      {(report.post && !postDeleted) || report.comment || (author && authorIsMember) ? (
        <AdminActionGroup
          label={postHidden || report.comment?.isDeleted ? '되돌리기 · 위험한 조치' : '위험한 조치'}
          hint="가린 글·댓글은 지워지지 않습니다. 차단해도 쓴 글은 남습니다."
        >
          {report.post && !postDeleted ? (
            postHidden ? (
              <AdminActionButton
                label="글 다시 공개"
                run={async () => {
                  'use server'
                  return setPostHidden(report.post!.id, false)
                }}
              />
            ) : (
              <AdminActionButton
                label="글 숨기기"
                tone="danger"
                confirmText="이 글을 숨길까요? 고객 화면에서 바로 사라집니다."
                run={async () => {
                  'use server'
                  return setPostHidden(report.post!.id, true)
                }}
              />
            )
          ) : null}

          {report.comment ? (
            report.comment.isDeleted ? (
              <AdminActionButton
                label="댓글 다시 보이기"
                run={async () => {
                  'use server'
                  return setCommentHidden(report.comment!.id, false)
                }}
              />
            ) : (
              <AdminActionButton
                label="댓글 숨기기"
                tone="danger"
                confirmText="이 댓글을 숨길까요? 내용은 남고 화면에서만 가려집니다."
                run={async () => {
                  'use server'
                  return setCommentHidden(report.comment!.id, true)
                }}
              />
            )
          ) : null}

          {/* 🔴 회원 차단은 글·댓글을 지우지 않는다. 운영자는 차단하지 않는다.
              🔴 실회원이 아니면 버튼 자체를 렌더하지 않는다 — 페르소나·시스템 계정을
                 차단하면 해제하러 갈 회원 상세가 없다(REAL_MEMBER_WHERE 로 notFound). */}
          {author && authorIsMember ? (
            author.isBlocked ? (
              <AdminActionButton
                label="작성자 차단 해제"
                run={async () => {
                  'use server'
                  return setMemberBlocked(author.id, false)
                }}
              />
            ) : (
              <AdminActionButton
                label="작성자 차단"
                tone="danger"
                disabled={author.isAdmin}
                confirmText="이 회원을 차단할까요? 글과 댓글은 지워지지 않습니다."
                run={async () => {
                  'use server'
                  return setMemberBlocked(author.id, true)
                }}
              />
            )
          ) : null}
        </AdminActionGroup>
      ) : null}

      {/* 접혀 있다가 "댓글 수정" 을 눌러야 열린다 — 컴포넌트가 그렇게 만들어져 있다. */}
      {report.comment ? (
        <AdminActionGroup label="댓글 고치기" hint="고쳐도 작성자에게 알림이 가지 않습니다.">
          <AdminCommentEditForm commentId={report.comment.id} content={report.comment.content} />
        </AdminActionGroup>
      ) : null}
    </li>
  )
}

export default async function AdminReportsPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const { pendingCount, pending, handled } = await loadReports()

  return (
    <main>
      <AdminPageHeader
        title="신고"
        description="오래 기다린 신고가 맨 위입니다. 이 화면에서 판단하고 조치까지 끝냅니다."
      />

      <AdminSection title={`미처리 ${pendingCount}건`} description="오래된 순">
        {pending.length === 0 ? (
          <AdminEmptyState>
            미처리 신고가 없습니다. 새 신고가 들어오면 여기 맨 위에 쌓입니다.
          </AdminEmptyState>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-3 p-0">
            {pending.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </ul>
        )}
      </AdminSection>

      {/* 🔴 처리분은 접어 둔다. 펼친 채 두면 미처리가 처리분 100건 위의 한 줄이 된다. */}
      <section className="mt-8 border-t border-subtle pt-6">
        {handled.length === 0 ? (
          <h2 className="m-0 text-sm font-bold text-content-primary">처리한 신고 없음</h2>
        ) : (
          <details>
            <summary className="min-h-[52px] cursor-pointer list-none py-3 text-sm font-bold text-content-primary">
              처리한 신고 {handled.length}건 보기{' '}
              <span className="font-normal text-content-muted">(최신순)</span>
            </summary>
            <ul className="mt-2 flex list-none flex-col gap-3 p-0">
              {handled.map((report) => (
                <ReportCard key={report.id} report={report} />
              ))}
            </ul>
          </details>
        )}
      </section>
    </main>
  )
}
