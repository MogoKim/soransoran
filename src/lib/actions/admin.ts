'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'

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
 */

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
  const content = String(formData.get('content') ?? '').trim()

  if (!id) return { error: '글을 찾지 못했습니다.' }
  if (title === '') return { error: '제목을 적어 주세요.' }
  if (title.length > 200) return { error: '제목은 200자까지 쓸 수 있습니다.' }
  if (content === '') return { error: '본문을 적어 주세요.' }

  const exists = await prisma.post.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return { error: '글을 찾지 못했습니다.' }

  await prisma.post.update({ where: { id }, data: { title, content } })

  revalidatePath(`/admin/content/${id}`)
  revalidatePath('/admin/content')
  revalidatePath(`/post/${id}`)
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

  const post = await prisma.post.findUnique({ where: { id: postId }, select: { status: true } })
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
  revalidatePath('/')
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
    select: { postId: true },
  })
  if (!comment) return { error: '댓글을 찾지 못했습니다.' }

  await prisma.comment.update({ where: { id: commentId }, data: { isDeleted: hidden } })

  revalidatePath(`/admin/content/${comment.postId}`)
  revalidatePath('/admin/reports')
  revalidatePath(`/post/${comment.postId}`)
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
