import type { Prisma, PrismaClient } from '@prisma/client'
import {
  POST_VISIBILITY_SELECT, NOT_MICRO_SEED_LANE_WHERE, belongsToMicroSeedLane, pickPostVisibility,
} from './post-visibility'
import { EXCLUDE_GREETING, isGreetingPost } from './greeting-policy'
import { syncBestEligibility } from './best-ranking-db'
import { lockPostRow, type AfterPostLock } from './post-row-lock'
import {
  OPEN_PERSONA_CANDIDATE_STATUSES, judgeBoardMove,
  type BoardMoveBlockCode, type BoardMoveFacts, type MovableBoard,
} from './board-move'

/**
 * 어드민 게시판 변경 — DB 쪽. 판정은 board-move.ts, 인증 · revalidate 는 actions/admin.ts 가 한다.
 *
 * 🔴 바꾸는 값은 Post.boardType 하나다(Prisma @updatedAt 이 updatedAt 을 함께 올린다).
 *    제목 · 본문 · 작성자 · personaId · operatorWriterId · 댓글 · status · createdAt 은 그대로다.
 *    오리지널 큐 · 자동 READY 감사 · 단계 증거 · Persona 후보 · gateResults 에는 한 줄도 쓰지 않는다.
 * 🔴 OperatorWriteLog 를 남기지 않는다 — 게시판 변경은 관리자 조치이지 운영 작성자의 행동이 아니다.
 *
 * 🔴 판정은 트랜잭션 안에서 **다시** 한다. 화면이 열린 뒤에 후보가 생기거나 큐가 붙을 수 있다.
 *    쓰기는 같은 조건을 where 에 다시 건 조건부 update 다 — 읽고 쓰는 사이에 바뀌면 0 건이다.
 * 🔴 **Post 행 잠금을 가장 먼저 잡는다**(post-row-lock.ts 공용 계약). 자동 후보 적재 · 수동 대상 지정도
 *    같은 잠금을 먼저 잡으므로, 열린 후보를 세는 일과 boardType 을 바꾸는 일 사이에 후보가 끼어들 수 없다.
 *    후보 쪽이 먼저 잠그면 여기서 기다렸다가 그 후보를 보고 OPEN_PERSONA_CANDIDATE 로 멈추고,
 *    여기가 먼저 잠그면 후보 쪽이 기다렸다가 바뀐 게시판을 보고 쓰지 않는다.
 * 🔴 화면이 본 게시판(from)은 **두 번** 대조한다.
 *    ① 요청이 도착한 순간(잠그기 전) — 이미 다르면 그 화면은 낡았다. 앞 요청이 끝나기를 기다린 뒤
 *       "우연히 같아진" 게시판으로 통과하지 않게 한다(반대 방향 동시 요청 · ABA).
 *    ② 잠근 뒤 — 같은 이동이 두 번 오면 뒤 요청은 잠금을 기다렸다가 이미 옮겨진 게시판을 보고 STALE 이다.
 *    다시 시도하지 않는다 — 다시 돌리면 앞 요청이 바꾼 게시판을 기준으로 또 옮겨 "두 번 이동" 이 된다.
 *
 * 🔴 /best — syncBestEligibility 를 같은 트랜잭션, boardType 변경 **뒤에** 부른다(best-v2 단일 진입점).
 *    FREE ↔ MENOPAUSE 는 둘 다 커뮤니티 게시판이라 공개 자격 · W 는 바뀌지 않고, 이미 입성한
 *    기록(BestSelection)은 그대로 둔다 — 재입성 · 입성 시각 갱신 · 순위 가산이 없다.
 */

type Db = Prisma.TransactionClient | PrismaClient

/** 판정 입력을 읽는다 — 관리자 글 상세(표시)와 트랜잭션(재판정)이 같은 함수를 쓴다 */
export async function readBoardMoveFacts(db: Db, postId: string): Promise<BoardMoveFacts | null> {
  const post = await db.post.findUnique({
    where: { id: postId },
    select: {
      boardType: true,
      personaId: true,
      category: true,
      // status 는 여기 들어 있다(3축 판정 입력)
      ...POST_VISIBILITY_SELECT,
      originalPostQueue: { select: { id: true } },
    },
  })
  if (!post) return null
  // PersonaApprovalQueue.targetPostId 는 FK 가 없다 — 관계가 아니라 값으로 센다
  const openPersonaCandidates = await db.personaApprovalQueue.count({
    where: { targetPostId: postId, status: { in: [...OPEN_PERSONA_CANDIDATE_STATUSES] } },
  })
  return {
    boardType: post.boardType,
    status: post.status,
    personaId: post.personaId,
    microSeedLane: belongsToMicroSeedLane(pickPostVisibility(post)),
    originalQueueLinked: post.originalPostQueue !== null,
    greeting: isGreetingPost(post),
    openPersonaCandidates,
  }
}

export type BoardMoveResult =
  | { ok: true; from: MovableBoard; to: MovableBoard }
  | { ok: false; code: BoardMoveBlockCode | 'NOT_FOUND' | 'STALE'; message: string }

const NOT_FOUND = { ok: false, code: 'NOT_FOUND', message: '글을 찾지 못했습니다.' } as const
const STALE = {
  ok: false, code: 'STALE', message: '화면을 연 뒤 이 글의 게시판이 바뀌었습니다. 새로 불러와 다시 확인해 주세요.',
} as const

/**
 * 게시판을 옮긴다. `from` 은 운영자가 화면에서 본 지금 게시판이다 —
 * 실제 값과 다르면 아무것도 쓰지 않는다(그 사이 누가 옮겼다).
 */
export async function movePostBoardTx(
  db: PrismaClient,
  input: { postId: string; from: string; to: string },
  afterLock?: AfterPostLock,
): Promise<BoardMoveResult> {
  // ① 도착 대조 — 판정이 아니라 낡은 화면을 일찍 돌려보내는 것이다. 판정은 잠근 뒤에 다시 한다
  const arrived = await db.post.findUnique({ where: { id: input.postId }, select: { boardType: true } })
  if (!arrived) return NOT_FOUND
  if (arrived.boardType !== input.from) return STALE

  return db.$transaction(async (tx) => {
    // 🔴 잠금 → (시험 전용 멈춤) → 지금 사실 전부 다시 읽기 → 판정(② from 재대조 포함) → 쓰기
    const locked = await lockPostRow(tx, input.postId)
    if (afterLock) await afterLock()
    if (!locked) return NOT_FOUND
    const facts = await readBoardMoveFacts(tx, input.postId)
    if (!facts) return NOT_FOUND
    if (facts.boardType !== input.from) return STALE
    const verdict = judgeBoardMove(facts, input.to)
    if (!verdict.ok) return verdict
    const from = facts.boardType as MovableBoard

    // 🔴 판정 조건을 where 에 다시 건다 — 잠금 아래라 바뀔 수 없지만, 조건과 쓰기를 한 문장으로 묶어 둔다.
    //    (열린 Persona 후보는 FK 가 없어 where 로 걸 수 없다 — 잠근 뒤 같은 트랜잭션 안에서 셌다)
    const moved = await tx.post.updateMany({
      where: {
        AND: [
          {
            id: input.postId,
            boardType: from,
            status: 'PUBLISHED',
            personaId: null,
            originalPostQueue: { is: null },
            ...NOT_MICRO_SEED_LANE_WHERE,
          },
          EXCLUDE_GREETING,
        ],
      },
      data: { boardType: verdict.to },
    })
    if (moved.count !== 1) return STALE

    await syncBestEligibility(tx, input.postId)
    return { ok: true, from, to: verdict.to } as const
  }, { maxWait: 10_000, timeout: 20_000 })
}
