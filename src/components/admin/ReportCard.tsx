import Link from 'next/link'
import { boardLabel, formatKst, isRealMember } from '@/lib/admin-format'
import { REPORT_REASONS } from '@/lib/report-reasons'
import AdminActionButton from '@/components/admin/AdminActionButton'
import AdminCommentEditForm from '@/components/admin/AdminCommentEditForm'
import PostBody from '@/components/features/PostBody'
import {
  AdminBadge,
  AdminStatusBadge,
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
 * 신고 카드 하나 — 판단 재료와 조치를 한 자리에 둔다.
 *
 * 🔴 페이지에서 떼어 냈다. reports/page.tsx 가 400 줄을 넘겨 조회와 화면이 뒤엉켰다.
 *    여기는 화면만 맡는다 — 조회는 페이지가, DB write 는 넘겨받은 액션이 한다.
 *
 * 🔴 서버 컴포넌트다. 조치는 기존 액션을 그대로 부른다 —
 *    새로 만들지 않는다. 'use server' 인라인 함수를 감싸서 props 로 넘기면
 *    client 컴포넌트(AdminActionButton)에 전달될 때 그것이 더 이상 server action 이
 *    아니게 되어 호출이 깨진다. 그래서 여기서 직접 만든다.
 */

const REASON_LABEL = new Map<string, string>(REPORT_REASONS.map((r) => [r.value, r.label]))

/**
 * 카드 안에 싣는 글 본문 길이.
 *
 * 🔴 카드 하나가 화면을 다 먹지 않게 한다. 신고 열 건이면 화면이 글 열 편이 되어
 *    목록이 아니게 된다. 글자 수로 자르는 대신 높이를 묶어 안에서 스크롤한다 —
 *    본문이 HTML 이 된 뒤로는 글자 수로 자르면 태그 한가운데가 잘린다.
 */

type Author = {
  id: string
  nickname: string | null
  name: string | null
  isAdmin: boolean
  isBlocked: boolean
  accounts: { id: string }[]
  persona: { id: string } | null
  /** 🔴 운영용 작성자가 붙어 있으면 실회원이 아니다 — `isRealMember` 가 요구한다 */
  operatorWriter: { id: string } | null
}

export type ReportCardData = {
  id: string
  reason: string
  detail: string | null
  status: string
  createdAt: Date
  reviewedAt: Date | null
  reporter: { id: string; nickname: string | null; name: string | null }
  post: {
    id: string
    title: string
    content: string
    status: string
    boardType: 'MENOPAUSE' | 'FREE' | 'MAGAZINE'
    author: Author
  } | null
  comment: {
    id: string
    content: string
    isDeleted: boolean
    postId: string
    /** 🔴 비회원 댓글은 null 이다. 회원이 비회원 댓글을 신고하면 이 자리가 빈다. */
    author: Author | null
    guestNickname?: string | null
  } | null
}

function displayName(user: { nickname: string | null; name: string | null }): string {
  return user.nickname ?? user.name ?? '회원'
}

export default function ReportCard({ report }: { report: ReportCardData }) {
  const targetPostId = report.post?.id ?? report.comment?.postId ?? null

  /**
   * 🔴 status 를 세 값으로 나눠 본다. `!== 'PUBLISHED'` 로 묶으면 DELETED 가
   *    "숨김" 으로 보이고 "글 다시 공개" 버튼까지 뜬다 — 눌러도 서버가 막아
   *    반드시 실패하는 버튼이 된다. /admin/content/[id] 도 DELETED 를 따로 가른다.
   */
  const postDeleted = report.post?.status === 'DELETED'
  const postHidden = report.post?.status === 'HIDDEN'

  // 글 신고면 글 작성자, 댓글 신고면 댓글 작성자다. 둘 다 없으면 대상이 사라진 것이다.
  const author: Author | null = report.post?.author ?? report.comment?.author ?? null
  // 대상은 있는데 작성자만 없다 = 비회원 댓글. "대상이 사라졌다" 와 구분해 적는다.
  const guestName = !author && report.comment ? (report.comment.guestNickname ?? '비회원') : null

  /**
   * 🔴 조치 대상이 될 수 있는 사람인가.
   *    페르소나·시스템 계정은 회원 상세가 열리지 않는다(REAL_MEMBER_WHERE).
   *    그쪽에서 막아 둔 차단을 이 화면이 열어 주면 안 된다 — 차단해 놓고
   *    해제하러 갈 화면이 없어진다. 신고는 그대로 보이되 조치 버튼만 가린다.
   */
  const authorIsMember = author ? isRealMember(author) : false
  const isPending = report.status === 'PENDING'

  const hasRiskyAction =
    (report.post && !postDeleted) || Boolean(report.comment) || (author && authorIsMember)

  return (
    <li className="rounded-lg border border-subtle bg-surface-card p-3">
      {/* ① 무슨 신고인가 */}
      <div className="flex flex-wrap items-center gap-2">
        <AdminStatusBadge kind="report" value={report.status} />
        <AdminBadge tone="brand">{REASON_LABEL.get(report.reason) ?? report.reason}</AdminBadge>
        <AdminBadge>
          {report.post ? '글 신고' : report.comment ? '댓글 신고' : '대상 없음'}
        </AdminBadge>
        <span className="text-xs text-content-muted">접수 {formatKst(report.createdAt)}</span>
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
              <AdminStatusBadge kind="post" value={report.post.status} />
            ) : null}
            <Link href={`/admin/content/${report.post.id}`} className="break-words text-link">
              {report.post.title}
            </Link>
          </p>
          {/* 🔴 사진을 주소 글자로 보여주지 않는다.
                 신고 사유의 상당수가 사진이라, 무엇을 신고한 것인지 여기서 보이지 않으면
                 매번 고객 화면을 새 창으로 열어야 한다 — 30 초 컷이 깨지는 자리다.
                 대신 높이를 묶어 카드 하나가 화면을 다 먹지 않게 한다. */}
          <div className="mt-1 max-h-[320px] overflow-y-auto rounded-lg bg-surface-soft p-3">
            <PostBody content={report.post.content} />
          </div>
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
      <dl className="mt-3 flex flex-col gap-1 text-sm sm:flex-row sm:gap-6">
        {guestName ? (
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-content-muted">작성자</dt>
            <dd className="m-0 flex flex-wrap items-center gap-1 text-content-primary">
              <span>{guestName}</span>
              <AdminBadge>비회원</AdminBadge>
            </dd>
          </div>
        ) : null}
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
            successText="처리 완료로 표시했어요."
            run={async () => {
              'use server'
              return setReportStatus(report.id, 'RESOLVED')
            }}
          />
        ) : (
          <AdminActionButton
            label="미처리로 되돌리기"
            successText="미처리로 되돌렸어요."
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

      {hasRiskyAction ? (
        <AdminActionGroup
          danger
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
                successText="글을 숨겼어요."
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
                successText="댓글을 다시 보이게 했어요."
                run={async () => {
                  'use server'
                  return setCommentHidden(report.comment!.id, false)
                }}
              />
            ) : (
              <AdminActionButton
                label="댓글 숨기기"
                successText="댓글을 숨겼어요."
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

      {report.comment ? (
        <AdminActionGroup label="댓글 고치기" hint="고쳐도 작성자에게 알림이 가지 않습니다.">
          <AdminCommentEditForm commentId={report.comment.id} content={report.comment.content} />
        </AdminActionGroup>
      ) : null}
    </li>
  )
}
