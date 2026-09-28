import type { BoardType, Prisma } from '@prisma/client'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import {
  DISCOVERY_ELIGIBLE_WHERE,
  POST_VISIBILITY_SELECT,
  isPromotionWriteBlocked,
  pickPostVisibility,
} from '@/lib/post-visibility'
import { REAL_MEMBER_WHERE } from '@/lib/admin-format'
import {
  BEST_CURRENT_SIZE,
  BEST_POLICY_VERSION,
  BEST_RECORDED_BY,
  bestRankScore,
  hasValidReaction,
  reactionWeight,
  sameRankScore,
  type RealReactions,
} from '@/lib/best-ranking'

/**
 * /best 순위 입력을 쓰는 곳 — 반응·노출이 바뀌는 쓰기 경로가 **자기 트랜잭션 안에서** 부른다.
 *
 * 🔴 페이지 조회(GET)는 여기 어떤 함수도 부르지 않는다. 읽기는 queries/best.ts 다.
 * 🔴 `prisma` 를 import 하지 않는다. 호출부의 tx 를 받는다 — 원본 반응 저장과
 *    순위 갱신·기록이 한 트랜잭션이라 하나만 남는 부분 실패가 없다.
 *
 * 🔴 잠금 순서: 글 행 하나를 먼저 잠그고(lockPost) → BestSelection 을 postId 순으로 쓴다.
 *    모든 호출부가 이 순서라 두 트랜잭션이 서로를 기다리는 고리가 생기지 않는다.
 */

type Db = Prisma.TransactionClient

const COMMUNITY_BOARD_TYPES = COMMUNITY_BOARDS.map((b) => b.type) as BoardType[]

/**
 * 전역 베스트 후보 — 보는 사람과 무관한 공개 적격 글.
 * 🔴 차단 필터가 없다. 누가 누구를 차단했든 기록은 하나다. 화면 필터는 queries/best.ts 가 얹는다.
 */
export const BEST_GLOBAL_WHERE = {
  boardType: { in: COMMUNITY_BOARD_TYPES },
  ...DISCOVERY_ELIGIBLE_WHERE,
} satisfies Prisma.PostWhereInput

/** 순위 정렬 — 목록·기록이 같은 것을 쓴다. id 가 마지막 동점을 가른다 */
export const BEST_RANK_ORDER = [
  { bestRankScore: 'desc' as const },
  { id: 'desc' as const },
]

/**
 * /best 가 "실회원" 으로 세는 사람 — 공감과 회원 댓글이 **같은 조건**을 쓴다.
 *
 * = 어드민 정본 REAL_MEMBER_WHERE(카카오 계정 · Persona 아님 · 운영 작성자 아님) + 운영 차단 아님.
 * 🔴 REAL_MEMBER_WHERE 자체를 고치지 않는다. 어드민의 "실회원 수" 는 차단된 사람도 센다 —
 *    그쪽의 뜻을 바꾸지 않고 랭킹 전용 조건을 여기서 덧붙인다.
 */
export const BEST_REAL_MEMBER_WHERE = {
  ...REAL_MEMBER_WHERE,
  isBlocked: false,
} satisfies Prisma.UserWhereInput

/**
 * 이 글의 실반응을 센다. 무엇이 실반응인가의 정본.
 *
 * 입력은 **정규화 행**뿐이다 — Like 행 · Comment 행. Post.likeCount · viewCount ·
 * 무필터 댓글 수는 쓰지 않는다(정본 C-4 보조 규칙: 화면용 카운터는 승격 입력이 아니다).
 *
 * 공감  — 작성자가 아닌 BEST_REAL_MEMBER_WHERE 회원의 Like 행
 * 댓글  — MEMBER: 작성자가 아닌 BEST_REAL_MEMBER_WHERE 회원 **사람 수**
 *         (commentOrigin='MEMBER' 표기만 믿지 않는다 — 작성자 relation 으로 실회원을 확인한다)
 *         GUEST: **건수**(상한은 best-ranking.ts). 비회원은 영속 식별자가 없다.
 *         PERSONA · OPERATOR · MICRO_SEED_VERBATIM 은 세지 않는다.
 * 삭제된 댓글은 세지 않는다.
 */
export async function countRealReactions(
  db: Db,
  post: { id: string; authorId: string },
): Promise<RealReactions> {
  const [likes, members, guestComments] = await Promise.all([
    db.like.count({
      where: { postId: post.id, userId: { not: post.authorId }, user: BEST_REAL_MEMBER_WHERE },
    }),
    db.comment.findMany({
      where: {
        postId: post.id,
        isDeleted: false,
        commentOrigin: 'MEMBER',
        personaId: null,
        operatorWriterId: null,
        // 🔴 not 하나로 쓰면 SQL 이 NULL 을 함께 버린다. 두 조건을 따로 적는다.
        AND: [{ authorId: { not: null } }, { authorId: { not: post.authorId } }],
        author: { is: BEST_REAL_MEMBER_WHERE },
      },
      distinct: ['authorId'],
      select: { authorId: true },
    }),
    db.comment.count({
      where: { postId: post.id, isDeleted: false, commentOrigin: 'GUEST' },
    }),
  ])
  return { likes, memberCommenters: members.length, guestComments }
}

/** 잠금 재시도 한도 — 읽고 잠그는 사이에 다른 쓰기가 끼어든 횟수. 넘으면 트랜잭션을 실패시킨다 */
const LOCK_ATTEMPTS = 5

/**
 * 글 행을 잠그고 순위 계산에 필요한 값을 읽는다.
 *
 * 🔴 UPDATE 로 잠근다(값은 그대로). 같은 글에 공감·댓글 트랜잭션이 동시에 오면
 *    뒤 트랜잭션이 여기서 기다렸다가 앞 트랜잭션이 커밋한 행까지 센다 —
 *    서로 상대의 반응을 못 본 채 절대값을 덮어쓰는 일이 없다.
 *    Prisma 에는 SELECT … FOR UPDATE 가 없고 raw SQL 은 쓰지 않는다.
 *
 * 🔴 **Post.updatedAt 을 움직이지 않는다.** 이 값은 sitemap lastModified 와 어드민 "수정" 시각 —
 *    글 내용이 바뀐 때다. 순위 메타데이터 갱신은 글 수정이 아니다.
 *    그래서 읽은 updatedAt 을 **그대로 다시 쓰되, 그 값이 아직 그대로일 때만** 잠근다.
 *    읽은 뒤 잠그기 전에 다른 쓰기(글 수정·조회수·공감 수)가 커밋되면 조건이 어긋나 0 건이 되고,
 *    다시 읽어 새 값으로 잠근다 — 남의 수정 시각을 과거 값으로 되돌리지 않는다(격리 DB 반례).
 *    잠근 뒤에는 행 잠금이 커밋까지 이어져 그 사이 아무도 이 값을 바꾸지 못한다.
 */
async function lockPost(db: Db, postId: string) {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const seen = await db.post.findUnique({
      where: { id: postId },
      select: {
        id: true, authorId: true, createdAt: true, updatedAt: true,
        bestRankScore: true, bestReactionWeight: true,
      },
    })
    if (!seen) return null
    const locked = await db.post.updateMany({
      where: { id: postId, updatedAt: seen.updatedAt },
      data: { bestReactionWeight: { increment: 0 }, updatedAt: seen.updatedAt },
    })
    if (locked.count === 1) return seen
  }
  throw new Error(`best-ranking: 글 ${postId} 을 ${LOCK_ATTEMPTS}번 연속 잠그지 못했다(경합)`)
}

/**
 * C-4 — 승격이 막힌 글인가. 판정 축은 생성 때 고정되므로 잠그기 전에 읽어도 된다.
 * 🔴 막힌 글에는 잠금(UPDATE)조차 하지 않는다 — "진입 즉시 return".
 */
async function isBlockedForRanking(db: Db, postId: string): Promise<boolean> {
  const row = await db.post.findUnique({ where: { id: postId }, select: POST_VISIBILITY_SELECT })
  return !row || isPromotionWriteBlocked(pickPostVisibility(row))
}

/**
 * 이 글의 순위 키를 처음부터 다시 계산해 쓴다. 기록은 하지 않는다.
 * 백필은 이것만 부르고 기록은 마지막에 한 번 한다 — 중간 상태의 12개를 기록하지 않기 위해서다.
 *
 * 🔴 C-4: Micro Seed · 첫 인사처럼 승격이 막힌 글은 들어오자마자 돌아간다. 아무것도 쓰지 않는다.
 */
export async function recomputePostRanking(db: Db, postId: string) {
  if (await isBlockedForRanking(db, postId)) return null
  const post = await lockPost(db, postId)
  if (!post) return null
  const weight = reactionWeight(await countRealReactions(db, post))
  const score = bestRankScore({ createdAt: post.createdAt, weight })
  // 값이 그대로면 쓰지 않는다. 쓸 때도 updatedAt 은 잠글 때 읽은 값 그대로다(lockPost 주석).
  // 🔴 점수는 `!==` 로 비교하지 않는다 — 소수 점수는 DB 를 한 번 거치면 마지막 자리가 달라진다
  //    (실측 2.4e-7초). 그러면 매번 "바뀜" 으로 읽혀 쓰지 않아도 될 UPDATE 가 돈다.
  if (weight !== post.bestReactionWeight || !sameRankScore(score, post.bestRankScore)) {
    await db.post.update({
      where: { id: postId },
      data: { bestRankScore: score, bestReactionWeight: weight, updatedAt: post.updatedAt },
      select: { id: true },
    })
  }
  return { weight, score }
}

/**
 * 지금 전역 12개 중 실반응이 있고 아직 기록되지 않은 글을 기록한다. 이미 있으면 최고 순위만 올린다.
 *
 * 🔴 멱등이다. 몇 번을 불러도, 동시에 불러도 글당 한 행이다(PK + skipDuplicates).
 *    중복 충돌은 오류가 아니다 — 사용자의 공감·댓글 요청을 실패시키지 않는다.
 * 🔴 BestSelection 을 postId 순으로 쓴다(파일 머리 주석의 잠금 순서).
 */
export async function recordBestEntries(
  db: Db,
  recordedBy: (typeof BEST_RECORDED_BY)[keyof typeof BEST_RECORDED_BY] = BEST_RECORDED_BY.event,
): Promise<{ created: number; peakRaised: number }> {
  const top = await db.post.findMany({
    where: BEST_GLOBAL_WHERE,
    orderBy: BEST_RANK_ORDER,
    take: BEST_CURRENT_SIZE,
    select: { id: true, bestRankScore: true, bestReactionWeight: true },
  })
  const entries = top
    .map((p, i) => ({ ...p, rank: i + 1 }))
    .filter((p) => hasValidReaction(p.bestReactionWeight))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (entries.length === 0) return { created: 0, peakRaised: 0 }

  const created = await db.bestSelection.createMany({
    data: entries.map((e) => ({
      postId: e.id,
      scoreAtEntry: e.bestRankScore,
      peakRank: e.rank,
      policyVersion: BEST_POLICY_VERSION,
      recordedBy,
    })),
    skipDuplicates: true,
  })

  let peakRaised = 0
  for (const e of entries) {
    const raised = await db.bestSelection.updateMany({
      where: { postId: e.id, peakRank: { gt: e.rank } },
      data: { peakRank: e.rank },
    })
    peakRaised += raised.count
  }
  return { created: created.count, peakRaised }
}

/**
 * 공감·댓글·댓글 숨김처럼 **실반응이 바뀐 뒤** 부른다. 재계산 + 기록.
 * 🔴 반응이 줄어도 부른다 — 이 글이 내려가면 13위가 12위로 올라와 기록될 수 있다.
 */
export async function refreshBestRanking(db: Db, postId: string): Promise<void> {
  await recomputePostRanking(db, postId)
  await recordBestEntries(db)
}
