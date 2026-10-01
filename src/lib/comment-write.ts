import 'server-only'
import { Prisma, type PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { holdReplyTarget, resolveReplyTarget } from '@/lib/reply-target'
import { REPLY_TARGET_GONE } from '@/lib/comment-policy'
import { syncBestEligibility } from '@/lib/best-ranking-db'
import { POST_NOT_FOUND } from '@/lib/post-policy'

/**
 * 사람이 쓰는 댓글·답글 저장 — 회원(actions/comments.ts)과 비회원(actions/guest-comments.ts)이 같이 쓴다.
 *
 * 신원 확인 · 본문 검사 · 봇 확인 · 속도 제한은 부르는 쪽이 **먼저** 끝낸다.
 * 여기는 "저장해도 되는가" 와 저장만 한다 — 한 Serializable 트랜잭션 안에서:
 *
 *   ① 글이 아직 공개 상태인가
 *   ② 답글이면 대상이 있고 · 같은 글이고 · 지워지지 않았고 · 차단한 회원이 아닌가 (reply-target.ts)
 *   ③ 방금 같은 사람이 같은 자리에 같은 말을 저장했는가 → 그렇다면 **새로 만들지 않고 그 댓글을 돌려준다**
 *   ④ 저장 · /best 자격 갱신
 *
 * 🔴 ③ 은 연타·재전송 방어다. 화면의 연타 가드(useSubmitGuard)는 한 탭 안에서만 막는다 —
 *    느린 망에서 다시 보내기 · 두 탭 · 새로고침 재전송은 서버에서만 막을 수 있다.
 *    동시에 들어온 두 요청은 Serializable 이 한쪽을 충돌(P2034)로 돌려보내고,
 *    다시 시도한 쪽은 먼저 들어간 댓글을 찾아 **같은 id** 를 돌려준다.
 * 🔴 실패하면 아무것도 남지 않는다. 댓글과 /best 갱신은 같은 트랜잭션이다.
 * 🔴 Persona · Operator 댓글은 이 함수를 쓰지 않는다. 그 경로는 최상위 댓글만 쓴다
 *    (persona-publish-tx.ts · operator-compose-tx.ts) — 이번 변경의 범위 밖이다.
 */

/** 같은 댓글로 볼 시간 — 이 안에 같은 사람이 같은 자리에 같은 말을 또 보내면 한 번으로 친다 */
export const COMMENT_DUPLICATE_WINDOW_MS = 60_000

const SERIALIZABLE = { isolationLevel: 'Serializable' as const, maxWait: 5_000, timeout: 15_000 }
/**
 * 충돌 재시도 횟수. 같은 댓글에 여러 답글이 동시에 들어오면 대상 잠금 앞에 줄을 서고,
 * 앞 사람이 커밋할 때마다 뒤 사람은 충돌로 돌아와 다시 시도한다 — 그래서 넉넉히 둔다.
 */
const MAX_ATTEMPTS = 5
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, 15 * attempt + Math.floor(Math.random() * 25)))

export const COMMENT_BUSY = '잠시 뒤 다시 눌러 주세요. 쓰신 글은 그대로 있어요.'

export type CommentAuthorInput =
  | { kind: 'member'; userId: string }
  | {
      kind: 'guest'
      nickname: string
      /**
       * 🔴 원문 번호 — **같은 사람인지 가르는 비교에만** 쓴다. 저장 · 로그 · 오류에 넣지 않는다.
       *    해시(bcrypt)는 요청마다 salt 가 달라 해시끼리 비교할 수 없다.
       */
      password: string
      /** 저장할 해시 — action 이 만든다 */
      passwordHash: string
    }

export type CommentWriteInput = {
  postId: string
  /** 폼이 보낸 parentId 그대로 — 여기서 다시 확인한다 */
  rawParentId: string
  content: string
  author: CommentAuthorInput
}

export type CommentWriteFailure = 'POST_GONE' | 'TARGET_GONE' | 'TARGET_BLOCKED' | 'BUSY'

export type CommentWriteResult =
  | { ok: true; commentId: string; duplicate: boolean }
  | { ok: false; code: CommentWriteFailure; error: string }

class Refused extends Error {
  constructor(readonly code: Exclude<CommentWriteFailure, 'BUSY'>, readonly userMessage: string) {
    super(code)
  }
}

const isSerializationConflict = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034'

/**
 * 방금 같은 사람이 같은 자리에 같은 말을 저장했는가 — 그 댓글 id.
 *
 * 🔴 비회원은 **닉네임만으로 같은 사람이 아니다.** 닉네임은 누구나 같은 것을 쓸 수 있다.
 *    같은 번호(자격 증명)까지 맞아야 같은 사람이다 — 다르면 각자의 번호로 각자의 댓글을
 *    고치고 지울 수 있어야 하므로 따로 저장한다.
 */
async function findDuplicate(
  tx: Prisma.TransactionClient,
  i: { postId: string; parentId: string | null; content: string; author: CommentAuthorInput },
): Promise<string | null> {
  const recent = {
    postId: i.postId,
    parentId: i.parentId,
    content: i.content,
    isDeleted: false,
    createdAt: { gte: new Date(Date.now() - COMMENT_DUPLICATE_WINDOW_MS) },
  }
  if (i.author.kind === 'member') {
    const same = await tx.comment.findFirst({ where: { ...recent, authorId: i.author.userId }, select: { id: true } })
    return same?.id ?? null
  }
  const candidates = await tx.comment.findMany({
    where: { ...recent, authorId: null, commentOrigin: 'GUEST', guestNickname: i.author.nickname },
    select: { id: true, guestPasswordHash: true },
    orderBy: { createdAt: 'asc' },
  })
  for (const c of candidates) {
    if (c.guestPasswordHash && (await bcrypt.compare(i.author.password, c.guestPasswordHash))) return c.id
  }
  return null
}

export async function writeComment(db: PrismaClient, input: CommentWriteInput): Promise<CommentWriteResult> {
  const { postId, content, author } = input
  const viewerId = author.kind === 'member' ? author.userId : null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const saved = await db.$transaction(async (tx) => {
        const post = await tx.post.findFirst({ where: { id: postId, status: 'PUBLISHED' }, select: { id: true } })
        if (!post) throw new Refused('POST_GONE', POST_NOT_FOUND)

        const target = await resolveReplyTarget(tx, input.rawParentId, postId, viewerId)
        if (!target.ok) throw new Refused(target.code, target.error)

        // 🔴 중복 확인이 잠금보다 먼저다 — 이미 저장된 같은 요청이면 새로 쓰지 않으므로 대상을 잠글 일이 없다.
        //    (잠금부터 잡으면 동시 재전송들이 서로의 잠금 뒤에 줄을 서며 충돌을 되풀이한다)
        const same = await findDuplicate(tx, { postId, parentId: target.parentId, content, author })
        if (same) return { commentId: same, duplicate: true }

        if (target.parentId !== null && !(await holdReplyTarget(tx, target, postId))) {
          throw new Refused('TARGET_GONE', REPLY_TARGET_GONE)
        }

        const created = await tx.comment.create({
          data:
            author.kind === 'member'
              ? { postId, authorId: author.userId, content, source: 'USER', parentId: target.parentId }
              : {
                  postId,
                  authorId: null,
                  content,
                  source: 'USER',
                  commentOrigin: 'GUEST',
                  guestNickname: author.nickname,
                  guestPasswordHash: author.passwordHash,
                  parentId: target.parentId,
                },
          select: { id: true },
        })
        // /best 자격(W · 최초 입성)을 댓글과 같은 트랜잭션에 둔다 — 댓글만 남고 입성이 빠지는 일이 없다.
        await syncBestEligibility(tx, postId)
        return { commentId: created.id, duplicate: false }
      }, SERIALIZABLE)
      return { ok: true, ...saved }
    } catch (e) {
      if (e instanceof Refused) return { ok: false, code: e.code, error: e.userMessage }
      if (isSerializationConflict(e) && attempt < MAX_ATTEMPTS) {
        await backoff(attempt)
        continue
      }
      if (isSerializationConflict(e)) return { ok: false, code: 'BUSY', error: COMMENT_BUSY }
      throw e
    }
  }
  return { ok: false, code: 'BUSY', error: COMMENT_BUSY }
}
