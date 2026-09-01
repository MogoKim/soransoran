'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import { getBoardByType, type BoardType } from '@/lib/board-registry'
import { publishCandidateTx } from '@/lib/persona-publish-tx'
import {
  planTakedown, type PublishBlock, type TakedownBlock,
} from '@/lib/persona-publish-rules'

/**
 * 페르소나 후보 발행 · 내림 — 🔴 화면에서 오는 유일한 write 경로다
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §13
 *
 * 🔴 발행 자체는 여기서 구현하지 않는다 — persona-publish-tx.ts 를 부른다.
 *    CLI(scripts/persona-publish-live.mts)와 **같은 함수**를 쓰기 위해서다.
 *    이 파일이 맡는 것은 권한 · 세션 · 캐시 무효화뿐이다.
 *
 * 🔴 자동 발행이 아니다. 사람이 버튼을 눌러야 한다.
 * 🔴 LLM 을 부르지 않는다. Persona.status 를 바꾸지 않는다 — active 전환 없음.
 * 🔴 반환값에 후보 본문 · 실회원 닉네임을 담지 않는다. 사유 문구만 돌려준다.
 */

export type PublishState = {
  error?: string
  blocks?: PublishBlock[]
  publishedCommentId?: string
}

export type TakedownState = {
  error?: string
  blocks?: TakedownBlock[]
  ok?: true
}

/** 대상 글의 게시판 경로. 등록되지 않은 게시판이면 revalidate 를 건너뛴다 */
function postPath(boardType: BoardType, postId: string): string | null {
  const board = getBoardByType(boardType)
  return board ? `${board.href}/${postId}` : null
}

/**
 * 승인된 후보 1건을 실제 댓글로 발행한다.
 *
 * @param id PersonaApprovalQueue.id
 */
export async function publishPersonaCandidate(id: string): Promise<PublishState> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: '권한이 없습니다.' }

  const session = await auth()
  if (!session?.user?.id) return { error: '로그인이 필요합니다.' }

  const res = await publishCandidateTx(prisma, { id })

  if (res.kind === 'error') return { error: res.message }
  if (res.kind === 'blocked') return { blocks: res.blocks }

  const path = postPath(res.boardType, res.postId)
  if (path) revalidatePath(path)
  revalidatePath('/admin/persona-candidates')
  revalidatePath(`/admin/persona-candidates/${id}`)
  return { publishedCommentId: res.commentId }
}

/**
 * 발행된 페르소나 댓글을 내린다 — 🔴 최소 기능
 *
 * 🔴 Comment.isDeleted = true 한 컬럼만 바꾼다.
 *    고객 화면 조회가 isDeleted:false 로 거르므로 즉시 사라지고 댓글 수에서도 빠진다.
 *
 * 🔴 페르소나가 발행한 댓글만 대상이다. 실회원 댓글은 이 경로로 지워지지 않는다 —
 *    회원 글을 내리는 것은 신고 처리 경로의 일이고 판단 기준이 다르다.
 *
 * 🔴 대기열은 PUBLISHED 로 남긴다. 발행됐다는 사실은 사실이다.
 *    되돌리면 "발행된 적 없는 것" 이 되어 계측이 무너진다.
 *
 * @param commentId 내릴 Comment.id
 */
export async function takedownPersonaComment(commentId: string): Promise<TakedownState> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: '권한이 없습니다.' }

  const session = await auth()
  if (!session?.user?.id) return { error: '로그인이 필요합니다.' }

  const target = (commentId ?? '').trim()
  if (target === '') return { error: '대상을 찾을 수 없습니다.' }

  try {
    const row = await prisma.comment.findUnique({
      where: { id: target },
      select: {
        id: true, personaId: true, isDeleted: true, postId: true,
        post: { select: { boardType: true } },
      },
    })

    const plan = planTakedown({
      comment: row ? { personaId: row.personaId, isDeleted: row.isDeleted } : null,
    })
    if (!plan.ok) return { blocks: plan.blocks }
    if (row === null) return { error: '대상을 찾을 수 없습니다.' }

    // 🔴 조건부 UPDATE — personaId 가 있고 아직 살아 있는 행만
    const res = await prisma.comment.updateMany({
      where: { id: row.id, personaId: { not: null }, isDeleted: false },
      data: { isDeleted: true },
    })
    if (res.count === 0) return { error: '이미 내려간 댓글입니다.' }

    const path = postPath(row.post.boardType, row.postId)
    if (path) revalidatePath(path)
    revalidatePath('/admin/persona-candidates')
    return { ok: true }
  } catch {
    return { error: '내리지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}
