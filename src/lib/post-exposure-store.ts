import 'server-only'

import { Prisma, type PrismaClient } from '@prisma/client'
import { COMMUNITY_VISIBLE_WHERE } from '@/lib/post-visibility'
import {
  exposureWindowStart,
  viewerKeyHash,
  type PostExposureKind,
  type PostExposureSurface,
} from '@/lib/post-exposure'

type RecordInput = {
  postId: string
  kind: PostExposureKind
  surface: PostExposureSurface
  userId: string | null
  anonymousToken: string | null
  secret: string
  now: Date
}

export type PostExposureResult = 'accepted' | 'duplicate' | 'excluded' | 'absent'

class PostBecameInvisible extends Error {}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * 노출 수락의 유일한 쓰기 경계.
 * actor 제외, 공개 글 확인, 원장 unique, 공개 누적 증가가 한 트랜잭션 안에 있다.
 */
export async function recordPostExposure(
  db: PrismaClient,
  input: RecordInput,
): Promise<PostExposureResult> {
  const postId = input.postId.trim()
  if (!postId) return 'absent'
  if (input.userId === null && input.anonymousToken === null) return 'excluded'

  const identity = input.userId === null
    ? `anonymous:${input.anonymousToken}`
    : `member:${input.userId}`
  const hash = viewerKeyHash(input.secret, identity)

  try {
    return await db.$transaction(async (tx) => {
      if (input.userId !== null) {
        const actor = await tx.user.findUnique({
          where: { id: input.userId },
          select: {
            isAdmin: true,
            persona: { select: { id: true } },
            operatorWriter: { select: { id: true } },
          },
        })
        if (!actor || actor.isAdmin || actor.persona !== null || actor.operatorWriter !== null) {
          return 'excluded'
        }
      }

      const post = await tx.post.findFirst({
        where: { id: postId, ...COMMUNITY_VISIBLE_WHERE },
        select: { id: true },
      })
      if (!post) return 'absent'

      await tx.postExposureEvent.create({
        data: {
          postId,
          kind: input.kind,
          surface: input.surface,
          viewerKeyHash: hash,
          windowStart: exposureWindowStart(input.now),
          createdAt: input.now,
        },
      })

      const updated = await tx.post.updateMany({
        where: { id: postId, ...COMMUNITY_VISIBLE_WHERE },
        data: { viewCount: { increment: 1 } },
      })
      if (updated.count !== 1) throw new PostBecameInvisible()
      return 'accepted'
    })
  } catch (error) {
    if (isUniqueConflict(error)) return 'duplicate'
    if (error instanceof PostBecameInvisible) return 'absent'
    throw error
  }
}

export async function cleanupPostExposureEvents(
  db: PrismaClient,
  cutoff: Date,
  take = 1_000,
): Promise<number> {
  if (!Number.isInteger(take) || take < 1 || take > 5_000) throw new Error('INVALID_CLEANUP_BATCH')
  const rows = await db.postExposureEvent.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
  })
  if (rows.length === 0) return 0
  const result = await db.postExposureEvent.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
  return result.count
}
