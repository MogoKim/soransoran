'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { getBoardByType, type BoardType } from '@/lib/board-registry'
import { communityPostHref } from '@/lib/admin-format'
import {
  COMMENT_TOO_LONG,
  COMMENT_TOO_SHORT,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from '@/lib/comment-policy'
import { checkContent } from '@/lib/content-guard'
import { sanitizePostHtml, isHtmlContent } from '@/lib/post-html'
import { firstImageUrl } from '@/lib/post-media'

/**
 * 어드민 1차 MVP — 운영 write 경로. 🔴 이 파일이 유일한 지점이다.
 *
 * 🔴 hard delete 를 하지 않는다.
 *    prisma.delete · deleteMany 를 쓰지 않는다. 되돌릴 수 없는 조치는
 *    어드민에 두지 않는다 — 지운 글은 신고 근거도 함께 사라진다.
 *    글은 status='HIDDEN', 댓글은 isDeleted=true 로 가린다.
 *
 * 🔴 PostStatus.DELETED 도 쓰지 않는다.
 *    HIDDEN 과 화면 효과는 같은데 이름이 삭제라 나중에 정리 배치의 대상이 된다.
 *
 * 🔴 노출 판정을 여기서 직접 하지 않는다.
 *    status·isDeleted 만 바꾸면 post-visibility.ts 의 3축 where 를 쓰는
 *    모든 화면(목록·상세·홈 인기글·내 활동·좋아요·조회수)이 함께 따라온다.
 *
 * 🔴 전 함수가 requireAdmin 을 먼저 통과한다. 통과 못 하면 한 줄도 쓰지 않는다.
 *
 * 🔴 고객 글 경로를 문자열로 짐작하지 않는다.
 *    실제 경로는 /community/{boardSlug}/{postId} 이고 boardSlug 는 board-registry 가 정한다.
 *    없는 경로를 revalidate 하면 아무 일도 일어나지 않는다 — 조용히 실패해서
 *    "숨겼는데 고객 화면에 그대로 있다" 로 나타난다.
 */

/**
 * 이 글이 바뀌면 다시 그려야 할 고객 화면들.
 *
 * 🔴 board.href 를 문자열로 적지 않는다. registry 가 유일한 출처다.
 * 🔴 홈(/)과 /best 도 함께 넣는다 — 인기글이 두 곳에서 뽑힌다.
 */
function revalidatePostSurfaces(postId: string, boardType: BoardType): void {
  const href = communityPostHref(postId, boardType)
  if (href) revalidatePath(href)
  const board = getBoardByType(boardType)
  if (board) revalidatePath(board.href)
  revalidatePath('/')
  revalidatePath('/best')
}

export type AdminActionState = { error?: string; ok?: true }

const DENIED: AdminActionState = { error: '권한이 없습니다.' }

/** 글 제목·본문 수정 — 다른 필드는 건드리지 않는다 */
export async function updatePost(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  const id = String(formData.get('postId') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const raw = String(formData.get('content') ?? '').trim()

  if (!id) return { error: '글을 찾지 못했습니다.' }
  if (title === '') return { error: '제목을 적어 주세요.' }
  if (title.length > 200) return { error: '제목은 200자까지 쓸 수 있습니다.' }
  if (raw === '') return { error: '본문을 적어 주세요.' }

  /**
   * 🔴 운영자가 고친 본문도 sanitize 를 지난다.
   *    운영자를 의심해서가 아니라, 신고 글에서 본문을 통째로 복사해 붙이는 일이
   *    이 화면에서 실제로 일어나기 때문이다. 그때 딸려 온 태그를 그대로 저장하면
   *    고객 화면에서 그대로 살아난다.
   *
   * 🔴 평문으로 온 것은 평문으로 둔다 — 옛 글을 고칠 때 형식을 바꾸지 않는다.
   */
  const content = isHtmlContent(raw) ? sanitizePostHtml(raw) : raw

  const exists = await prisma.post.findUnique({
    where: { id },
    select: { id: true, boardType: true },
  })
  if (!exists) return { error: '글을 찾지 못했습니다.' }

  await prisma.post.update({
    where: { id },
    data: { title, content, thumbnailUrl: firstImageUrl(content) },
  })

  revalidatePath(`/admin/content/${id}`)
  revalidatePath('/admin/content')
  revalidatePostSurfaces(id, exists.boardType)
  return { ok: true }
}

/**
 * 글 공개/숨김 전환.
 * @param hidden true 면 HIDDEN, false 면 PUBLISHED.
 *   🔴 토글이 아니라 명시값을 받는다 — 두 사람이 동시에 누르면 의도와 반대가 된다.
 */
export async function setPostHidden(postId: string, hidden: boolean): Promise<AdminActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED
  if (!postId) return { error: '글을 찾지 못했습니다.' }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { status: true, boardType: true },
  })
  if (!post) return { error: '글을 찾지 못했습니다.' }
  // DELETED 는 이 화면이 만드는 상태가 아니다. 되돌리는 것도 여기서 하지 않는다.
  if (post.status === 'DELETED') return { error: '삭제 상태인 글은 여기서 바꾸지 않습니다.' }

  await prisma.post.update({
    where: { id: postId },
    data: { status: hidden ? 'HIDDEN' : 'PUBLISHED' },
  })

  revalidatePath(`/admin/content/${postId}`)
  revalidatePath('/admin/content')
  revalidatePath('/admin/reports')
  revalidatePath('/admin/home')
  revalidatePostSurfaces(postId, post.boardType)
  return { ok: true }
}

/** 댓글 숨김/복구 — isDeleted 만 바꾼다 (행을 지우지 않는다) */
export async function setCommentHidden(
  commentId: string,
  hidden: boolean,
): Promise<AdminActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED
  if (!commentId) return { error: '댓글을 찾지 못했습니다.' }

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { postId: true, post: { select: { boardType: true } } },
  })
  if (!comment) return { error: '댓글을 찾지 못했습니다.' }

  await prisma.comment.update({ where: { id: commentId }, data: { isDeleted: hidden } })

  revalidatePath(`/admin/content/${comment.postId}`)
  revalidatePath('/admin/reports')
  // 댓글 수가 홈 인기글 점수에 들어간다 — 글 표면을 함께 다시 그린다.
  revalidatePostSurfaces(comment.postId, comment.post.boardType)
  return { ok: true }
}

/**
 * 댓글 본문 수정 — 운영자용.
 *
 * 🔴 고객용 updateComment 를 쓰지 않는다.
 *    그쪽은 "본인 댓글만" 이 성립 조건이라 authorId 를 세션과 대조하고 rate limit 을 건다.
 *    운영자는 남의 댓글을 고치는 사람이라 그 경로로는 통과할 수 없다.
 *
 * 🔴 바꾸는 것은 content 하나뿐이다.
 *    authorId · postId · createdAt · isDeleted · source · commentOrigin · personaId 는
 *    건드리지 않는다. 누가 언제 어느 레인에서 썼는지가 바뀌면 추적이 끊긴다.
 *
 * 🔴 숨김 댓글도 고칠 수 있다. 대신 숨김 상태는 그대로 둔다 —
 *    고치는 것과 다시 보이게 하는 것은 다른 판단이고, 묶으면 실수로 되살아난다.
 *
 * 🔴 길이·금지어는 고객과 같은 기준을 쓴다(comment-policy · content-guard).
 *    운영자가 고쳤다는 이유로 고객 화면에 다른 기준의 글이 남으면 안 된다.
 */
export async function updateCommentContent(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  const commentId = String(formData.get('commentId') ?? '')
  const content = String(formData.get('content') ?? '').trim()

  if (!commentId) return { error: '댓글을 찾지 못했습니다.' }
  if (content.length < MIN_COMMENT_LENGTH) return { error: COMMENT_TOO_SHORT }
  if (content.length > MAX_COMMENT_LENGTH) return { error: COMMENT_TOO_LONG }

  const guard = checkContent(content)
  if (!guard.ok) return { error: guard.reason }

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, postId: true, post: { select: { boardType: true } } },
  })
  if (!comment) return { error: '댓글을 찾지 못했습니다.' }

  await prisma.comment.update({ where: { id: commentId }, data: { content } })

  revalidatePath(`/admin/content/${comment.postId}`)
  revalidatePath('/admin/content')
  revalidatePath('/admin/reports')
  revalidatePostSurfaces(comment.postId, comment.post.boardType)
  return { ok: true }
}

/**
 * 회원 차단/해제.
 * 🔴 isAdmin 은 건드리지 않는다 — 권한 부여는 어드민 화면의 일이 아니다.
 * 🔴 관리자 계정은 차단하지 않는다. 자기 권한을 스스로 잠그는 사고를 막는다.
 */
export async function setMemberBlocked(
  userId: string,
  blocked: boolean,
): Promise<AdminActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED
  if (!userId) return { error: '회원을 찾지 못했습니다.' }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  })
  if (!user) return { error: '회원을 찾지 못했습니다.' }
  if (user.isAdmin && blocked) return { error: '관리자는 차단할 수 없습니다.' }

  await prisma.user.update({ where: { id: userId }, data: { isBlocked: blocked } })

  revalidatePath(`/admin/members/${userId}`)
  revalidatePath('/admin/members')
  return { ok: true }
}

/**
 * 신고 상태 변경.
 * 🔴 처리 사유를 남기지 않는다 — Report 에 사유 컬럼이 없다.
 *    1차에서 스키마를 바꾸지 않기로 했다. 사유가 필요해지면 컬럼을 먼저 만든다.
 * 🔴 status 를 바꿔도 대상 글·댓글은 그대로다. 가리는 것은 별도 버튼이다 —
 *    "확인함" 과 "가림" 은 다른 판단이고, 하나로 묶으면 되돌릴 수 없다.
 */
export async function setReportStatus(
  reportId: string,
  status: 'PENDING' | 'REVIEWED' | 'RESOLVED',
): Promise<AdminActionState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED
  if (!reportId) return { error: '신고를 찾지 못했습니다.' }

  const report = await prisma.report.findUnique({ where: { id: reportId }, select: { id: true } })
  if (!report) return { error: '신고를 찾지 못했습니다.' }

  await prisma.report.update({
    where: { id: reportId },
    // PENDING 으로 되돌리면 검토 시각도 지운다 — 남아 있으면 "언제 봤나" 가 거짓이 된다.
    data: { status, reviewedAt: status === 'PENDING' ? null : new Date() },
  })

  revalidatePath('/admin/reports')
  revalidatePath('/admin')
  return { ok: true }
}
