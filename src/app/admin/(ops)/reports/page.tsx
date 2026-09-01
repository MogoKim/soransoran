import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst, isRealMember } from '@/lib/admin-format'
import { REPORT_REASONS } from '@/lib/report-reasons'
import AdminActionButton from '@/components/admin/AdminActionButton'
import AdminCommentEditForm from '@/components/admin/AdminCommentEditForm'
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
      author: {
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
      },
    },
  },
  comment: {
    select: {
      id: true,
      content: true,
      isDeleted: true,
      postId: true,
      author: {
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
      },
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

  return (
    <li className="rounded-lg border border-subtle bg-surface-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-brand-ink">
          {REASON_LABEL.get(report.reason) ?? report.reason}
        </span>
        <span
          className={
            report.status === 'PENDING'
              ? 'rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-state-danger'
              : 'rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted'
          }
        >
          {STATUS_LABEL[report.status] ?? report.status}
        </span>
        <span className="text-xs text-content-muted">{formatKst(report.createdAt)}</span>
        {report.reviewedAt ? (
          <span className="text-xs text-content-muted">확인 {formatKst(report.reviewedAt)}</span>
        ) : null}
      </div>

      {/* 누가 썼는가 — 조치 대상이다. 신고자보다 먼저 온다. */}
      {author ? (
        <p className="mt-2 text-sm text-content-primary">
          작성자:{' '}
          {authorIsMember ? (
            <Link href={`/admin/members/${author.id}`} className="text-link">
              {displayName(author)}
            </Link>
          ) : (
            // 회원 상세가 열리지 않는 계정이다. 링크를 걸면 404 로 보낸다.
            <span>{displayName(author)}</span>
          )}
          {author.isBlocked ? (
            <span className="ml-1 text-xs font-bold text-state-danger">차단됨</span>
          ) : null}
          {author.isAdmin ? <span className="ml-1 text-xs text-content-muted">운영자</span> : null}
          {authorIsMember ? null : (
            <span className="ml-1 text-xs text-content-muted">
              {author.persona ? '페르소나' : '시스템 계정'}
            </span>
          )}
        </p>
      ) : null}

      {report.post ? (
        <div className="mt-2">
          <p className="m-0 text-sm text-content-primary">
            대상 글{postDeleted ? ' (삭제 상태)' : postHidden ? ' (숨김 상태)' : ''}:{' '}
            <Link href={`/admin/content/${report.post.id}`} className="text-link">
              {report.post.title}
            </Link>
          </p>
          {/* 🔴 제목만으로는 욕설인지 광고인지 판단할 수 없다. 발췌를 함께 싣는다. */}
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-soft p-2 text-sm text-content-primary">
            {report.post.content.slice(0, EXCERPT)}
            {report.post.content.length > EXCERPT ? '…' : ''}
          </p>
        </div>
      ) : report.comment ? (
        <div className="mt-2">
          <p className="m-0 text-sm text-content-primary">
            대상 댓글{report.comment.isDeleted ? ' (숨김 상태)' : ''}:
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-soft p-2 text-sm text-content-primary">
            {report.comment.content}
          </p>
          {targetPostId ? (
            <Link href={`/admin/content/${targetPostId}`} className="text-sm text-link">
              글에서 보기
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-content-muted">대상이 이미 사라졌습니다.</p>
      )}

      {report.detail ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-content-muted">
          신고 내용: {report.detail}
        </p>
      ) : null}

      <p className="mt-2 text-xs text-content-muted">
        신고자:{' '}
        <Link href={`/admin/members/${report.reporter.id}`} className="text-link">
          {displayName(report.reporter)}
        </Link>
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {report.status === 'PENDING' ? (
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
            tone="danger"
            run={async () => {
              'use server'
              return setReportStatus(report.id, 'PENDING')
            }}
          />
        )}

        {/* 가리기와 되돌리기를 같은 자리에 둔다 — 잘못 가렸을 때 화면을 옮기지 않게 한다.
            🔴 DELETED 는 둘 다 렌더하지 않는다. 삭제는 이 화면이 만드는 상태도,
               되돌리는 상태도 아니다 — setPostHidden 이 서버에서 거절한다. */}
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
              label="대상 글 숨기기"
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
              label="대상 댓글 숨기기"
              tone="danger"
              confirmText="이 댓글을 숨길까요? 내용은 남고 화면에서만 가려집니다."
              run={async () => {
                'use server'
                return setCommentHidden(report.comment!.id, true)
              }}
            />
          )
        ) : null}

        {/* 접혀 있다가 "댓글 수정" 을 눌러야 열린다 — 컴포넌트가 그렇게 만들어져 있다. */}
        {report.comment ? (
          <AdminCommentEditForm commentId={report.comment.id} content={report.comment.content} />
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
      </div>
    </li>
  )
}

export default async function AdminReportsPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const { pendingCount, pending, handled } = await loadReports()

  return (
    <main>
      <h1 className="pt-8 text-xl font-bold text-content-primary">신고 관리</h1>
      <p className="mt-1 text-sm text-content-muted">
        미처리 {pendingCount}건 · 처리분 최근 {handled.length}건 · 한 번에 {TAKE}건까지 싣습니다
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-bold text-content-primary">
          미처리 {pendingCount}건 <span className="text-content-muted">(오래된 순)</span>
        </h2>
        {pending.length === 0 ? (
          <p className="py-8 text-center text-content-muted">미처리 신고가 없습니다.</p>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-3 p-0">
            {pending.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </ul>
        )}
      </section>

      {/* 🔴 처리분은 접어 둔다. 펼친 채 두면 미처리가 처리분 100건 위의 한 줄이 된다. */}
      <section className="mt-8 border-t border-subtle pt-6">
        {handled.length === 0 ? (
          <h2 className="text-sm font-bold text-content-primary">처리분 없음</h2>
        ) : (
          <details>
            <summary className="min-h-[52px] cursor-pointer list-none py-3 text-sm font-bold text-content-primary">
              처리분 {handled.length}건 보기 <span className="text-content-muted">(최신순)</span>
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
