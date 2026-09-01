'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import { getBoardByType, type BoardType } from '@/lib/board-registry'
import {
  planSetTarget, planClearTarget, judgeTargetPost,
  type TargetBlock, type TargetPostFacts,
} from '@/lib/persona-target-rules'
import type { CandidateStatus } from '@/lib/persona-candidate-rules'

/**
 * 발행 대상 글 지정 — 🔴 이 파일이 targetPostId 의 유일한 write 경로다
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §8 · §10-2
 *
 * 🔴 이것은 발행이 아니다. 발행 전에 "어디에 달지" 를 정하는 일이다.
 *    write 대상은 PersonaApprovalQueue.targetPostId **한 컬럼뿐**이다.
 *    status 를 바꾸지 않는다 — 승인도 발행도 여기서 일어나지 않는다.
 *    Post · Comment · User · Persona · PersonaActivityLog 를 건드리지 않는다.
 *
 * 🔴 LLM 을 부르지 않는다. 대상 글은 사람이 고른다.
 *
 * 🔴 목록과 저장이 같은 판정 함수(judgeTargetPost)를 쓴다.
 *    고를 수 있게 보여 놓고 저장에서 다른 기준으로 막으면 운영자는 이유를 알 수 없다.
 *
 * 🔴 반환값에 글 본문을 담지 않는다. 제목 · 게시판 · 작성일 · 댓글 수까지다.
 */

export type TargetState = {
  error?: string
  blocks?: TargetBlock[]
  targetPostId?: string | null
}

/** 목록 한 줄 — 🔴 본문 없음 */
export type TargetPostOption = {
  id: string
  title: string
  boardLabel: string
  createdAt: string
  personaComments: number
  memberComments: number
  eligible: boolean
  /** 고를 수 없는 이유. 고를 수 있으면 빈 배열 */
  blocks: TargetBlock[]
}

export type SearchState = {
  error?: string
  posts?: TargetPostOption[]
}

/** 한 번에 보여 줄 최대 건수 — 운영자가 훑어보는 화면이라 넉넉할 이유가 없다 */
const SEARCH_LIMIT = 12

function boardLabelOf(boardType: BoardType): string {
  return getBoardByType(boardType)?.label ?? boardType
}

/**
 * 대상 글 후보를 찾는다 — 🔴 read-only
 *
 * 🔴 부적격 글도 사유와 함께 보여준다. 목록에서 조용히 빼면
 *    운영자는 "왜 이 글이 안 보이지" 를 알 수 없다.
 *
 * @param query 제목 검색어. 비우면 최신 글부터
 */
export async function searchTargetPosts(query: string): Promise<SearchState> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: '권한이 없습니다.' }

  const q = (query ?? '').trim()

  try {
    const posts = await prisma.post.findMany({
      // 🔴 공개 글만 후보다. 숨김·삭제 글에 댓글을 달지 않는다
      where: {
        status: 'PUBLISHED',
        ...(q !== '' ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      select: {
        id: true, title: true, boardType: true, status: true, createdAt: true,
        // 🔴 personaId 만 읽는다. 본문도 작성자도 가져오지 않는다.
        //    상한이 12건이라 댓글 배열을 세도 부담이 없다 — groupBy 두 번보다 단순하다
        comments: { where: { isDeleted: false }, select: { personaId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_LIMIT,
    })

    return {
      posts: posts.map((p) => {
        const facts: TargetPostFacts = {
          status: p.status,
          personaComments: p.comments.filter((c) => c.personaId !== null).length,
          memberComments: p.comments.filter((c) => c.personaId === null).length,
        }
        const verdict = judgeTargetPost(facts)
        return {
          id: p.id,
          title: p.title,
          boardLabel: boardLabelOf(p.boardType),
          createdAt: p.createdAt.toISOString(),
          personaComments: facts.personaComments,
          memberComments: facts.memberComments,
          eligible: verdict.eligible,
          blocks: verdict.blocks,
        }
      }),
    }
  } catch {
    return { error: '글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}

/** 후보와 대상 글을 함께 읽어 판정한다 — set · clear 가 공유한다 */
async function loadCandidate(id: string) {
  return prisma.personaApprovalQueue.findUnique({
    where: { id },
    select: { id: true, status: true, publishedCommentId: true },
  })
}

/**
 * 대상 글을 지정한다.
 *
 * @param id     PersonaApprovalQueue.id
 * @param postId 대상 Post.id
 */
export async function setPersonaCandidateTarget(id: string, postId: string): Promise<TargetState> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: '권한이 없습니다.' }

  const session = await auth()
  if (!session?.user?.id) return { error: '로그인이 필요합니다.' }

  const target = (id ?? '').trim()
  if (target === '') return { error: '대상을 찾을 수 없습니다.' }

  try {
    const row = await loadCandidate(target)
    if (row === null) return { error: '대상을 찾을 수 없습니다.' }

    const wanted = (postId ?? '').trim()
    // 🔴 저장 직전에 글 상태를 다시 읽는다. 목록을 띄운 뒤 댓글이 달렸을 수 있다
    const post = wanted === ''
      ? null
      : await prisma.post.findUnique({
          where: { id: wanted },
          select: {
            status: true,
            comments: { where: { isDeleted: false }, select: { personaId: true } },
          },
        })

    const facts: TargetPostFacts | null = post
      ? {
          status: post.status,
          personaComments: post.comments.filter((c) => c.personaId !== null).length,
          memberComments: post.comments.filter((c) => c.personaId === null).length,
        }
      : null

    const plan = planSetTarget({
      candidate: {
        status: row.status as CandidateStatus,
        publishedCommentId: row.publishedCommentId,
      },
      postId: wanted,
      post: facts,
    })
    if (!plan.ok) return { blocks: plan.blocks }

    // 🔴 조건부 UPDATE — 읽은 뒤 쓰는 사이에 발행됐으면 0건이 되어 덮어쓰지 않는다.
    //    🔴 targetPostId 한 컬럼만 쓴다. status 는 건드리지 않는다
    const res = await prisma.personaApprovalQueue.updateMany({
      where: {
        id: row.id,
        status: { in: ['PENDING', 'APPROVED'] },
        publishedCommentId: null,
      },
      data: { targetPostId: plan.postId },
    })
    if (res.count === 0) return { error: '이미 처리된 후보입니다. 새로고침해 주세요.' }

    revalidatePath('/admin/persona-candidates')
    revalidatePath(`/admin/persona-candidates/${row.id}`)
    return { targetPostId: plan.postId }
  } catch {
    return { error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}

/**
 * 대상 글 지정을 해제한다.
 *
 * 🔴 해제도 targetPostId 한 컬럼뿐이다. status 는 그대로다.
 */
export async function clearPersonaCandidateTarget(id: string): Promise<TargetState> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: '권한이 없습니다.' }

  const session = await auth()
  if (!session?.user?.id) return { error: '로그인이 필요합니다.' }

  const target = (id ?? '').trim()
  if (target === '') return { error: '대상을 찾을 수 없습니다.' }

  try {
    const row = await loadCandidate(target)
    if (row === null) return { error: '대상을 찾을 수 없습니다.' }

    const plan = planClearTarget({
      status: row.status as CandidateStatus,
      publishedCommentId: row.publishedCommentId,
    })
    if (!plan.ok) return { blocks: plan.blocks }

    const res = await prisma.personaApprovalQueue.updateMany({
      where: {
        id: row.id,
        status: { in: ['PENDING', 'APPROVED'] },
        publishedCommentId: null,
      },
      data: { targetPostId: null },
    })
    if (res.count === 0) return { error: '이미 처리된 후보입니다. 새로고침해 주세요.' }

    revalidatePath('/admin/persona-candidates')
    revalidatePath(`/admin/persona-candidates/${row.id}`)
    return { targetPostId: null }
  } catch {
    return { error: '해제하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}
