/**
 * bootstrap 예산 **입력 수집** — 🔴 DB read-only. write 0 · provider 0
 *
 * 🔴 **판정은 여기서 하지 않는다.** 이 파일은 DB 행을 정본 판정 함수가 먹는
 *    모양으로 바꿔 주기만 한다 — `judgePostAuthor` 와 `countManagedPosts` 가 판정한다.
 *    두 벌로 갈라져 다른 답을 내는 일을 막으려는 것이다.
 *
 * 🔴 **`scripts/lib` 가 아니라 여기 있는 이유** (2026-09-11).
 *
 *    옛 자리는 `scripts/lib/persona-comment-bootstrap-source.ts` 였다. 그런데
 *    발행 트랜잭션(`persona-publish-tx.ts`)도 **같은 예산**을 트랜잭션 안에서
 *    다시 세야 한다 — 밖에서 센 값은 그 사이 다른 후보가 가져간 자리를 모른다.
 *    `src` 는 `scripts` 를 import 할 수 없다(Next 빌드 경계). 그래서 방향을 뒤집었다.
 *
 * 🔴 제목도 본문도 읽지 않는다. 개인정보는 이 경로에 들어오지 않는다.
 */
import type { PrismaClient } from '@prisma/client'

import { judgePostAuthor } from './persona-comment-release'
import {
  countManagedPosts, type ManagedCount, type ManagedPostFacts,
} from './persona-comment-bootstrap-budget'
import {
  isExternalSourcedBody, pickPostVisibility, POST_VISIBILITY_SELECT,
} from './post-visibility'

/**
 * 🔴 **PrismaClient 와 트랜잭션 클라이언트를 둘 다 받는다.**
 *    `Prisma.TransactionClient` 는 `post` 를 그대로 갖고 있으므로 이 모양으로 충분하다 —
 *    구체 타입을 요구하면 트랜잭션 안에서 같은 함수를 쓸 수 없게 된다.
 */
export type PostReader = Pick<PrismaClient, 'post'>

/**
 * 오늘(KST 하루) 공개된 글 중 bootstrap 대상이 될 수 있는 자리 수.
 *
 * 🔴 **읽지 못하면 회차를 죽이지 않고 그 글만 뺀다.** 다만 조회 자체가 실패하면
 *    `null` 을 돌려준다 — 그때는 예산이 0 이어야 한다(fail-closed).
 */
export async function countManagedPostsToday(
  db: PostReader, dayStart: Date, now: Date,
): Promise<ManagedCount | null> {
  try {
    const rows = await db.post.findMany({
      where: { status: 'PUBLISHED', createdAt: { gte: dayStart, lte: now } },
      select: {
        source: true,
        // 🔴 3축은 정본 select 를 쓴다 — 손으로 고르면 판정 입력이 갈라진다(C-2)
        ...POST_VISIBILITY_SELECT,
        persona: { select: { code: true } },
        // 🔴 운영자 직접 글을 가려낸다. 빠뜨리면 `judgePostAuthor` 가 `unknown` 으로
        //    막아 회차가 이유 없이 좁아진다 — 안전하지만 원인을 못 찾는 상태다
        operatorWriterId: true,
        author: { select: { isAdmin: true, _count: { select: { accounts: true } } } },
        comments: { where: { isDeleted: false }, select: { personaId: true } },
      },
    })
    const facts: ManagedPostFacts[] = rows.map((p) => {
      // 🔴 축 이름은 정본만 안다. 여기서 꺼내 비교하지 않는다(C-2)
      const visibility = pickPostVisibility(p)
      const verdict = judgePostAuthor({
        authorPersonaCode: p.persona?.code ?? null,
        authorOperatorWriterId: p.operatorWriterId,
        source: p.source,
        authorIsAdmin: p.author?.isAdmin ?? null,
        authorRealMember: p.author === null
          ? null
          : { accountCount: p.author._count.accounts, providerId: null },
        visibility,
      })
      return {
        authorKind: verdict.kind,
        externalSourced: isExternalSourcedBody(visibility),
        // 🔴 **수**를 넘긴다. 있음/없음으로 접으면 "4건이라 1자리 남았다" 를 말할 수 없다
        personaCommentCount: p.comments.filter((c) => c.personaId !== null).length,
      }
    })
    return countManagedPosts(facts)
  } catch {
    return null
  }
}
