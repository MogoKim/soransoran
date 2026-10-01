import type { PrismaClient } from '@prisma/client'
import { buildCommentThreads, type ThreadAnomaly } from '@/lib/comment-thread'
import { toThreadViews, type ThreadView } from '@/lib/comment-view'

/**
 * 한 글의 댓글을 읽어 대화 스레드로 만든다 — 게시글 상세(getPostDetail)와 격리 DB 검사가 같은 함수를 쓴다.
 *
 * 🔴 이 글의 댓글을 **한 번에** 전부 읽는다 — 지운 댓글 · 차단한 회원의 댓글까지.
 *    대화 중간의 댓글을 여기서 빼면 그 뒤에 이어진 남의 답글이 무엇에 대한 것인지 사라진다.
 *    지운·차단 댓글의 이름·본문은 toThreadViews 가 화면으로 넘기기 **전에** 비운다.
 *    (예전에는 차단 회원 댓글을 where 에서 뺐다 — 그러면 그 댓글에 달린 남의 답글이 고아가 된다.)
 * 🔴 스레드(루트 · 직접 대상 · 시간순 평면화)는 DB 가 아니라 comment-thread.ts 가 계산한다.
 *    재귀 질의 · N+1 이 없다. 2026-09-30 기준 글당 댓글 최대 17개다.
 * 🔴 관계가 어긋난 댓글(순환 · 사라진 부모 · 다른 글의 부모)은 스레드 시작점으로 세우고
 *    anomalies 로 돌려준다 — 화면은 깨뜨리지 않되 조용히 넘기지 않는다.
 */
export async function loadPostThreads(
  db: Pick<PrismaClient, 'comment'>,
  args: { postId: string; postAuthorId: string; blockedAuthorIds: readonly string[] },
): Promise<{ threads: ThreadView[]; anomalies: ThreadAnomaly[] }> {
  const rows = await db.comment.findMany({
    where: { postId: args.postId },
    select: {
      id: true,
      postId: true,
      parentId: true,
      content: true,
      createdAt: true,
      isDeleted: true,
      authorId: true,
      // 비회원 댓글은 author 가 null 이고 guestNickname 이 채워진다.
      author: { select: { id: true, name: true, nickname: true, image: true } },
      guestNickname: true,
      likeCount: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  const built = buildCommentThreads(rows, { postId: args.postId, blockedAuthorIds: new Set(args.blockedAuthorIds) })
  return { threads: toThreadViews(built.threads, args.postAuthorId), anomalies: built.anomalies }
}
