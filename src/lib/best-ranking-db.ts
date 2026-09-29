import type { BoardType, Prisma, PrismaClient } from '@prisma/client'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import {
  DISCOVERY_ELIGIBLE_WHERE,
  POST_VISIBILITY_SELECT,
  isDiscoveryEligible,
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
 * /best 순위 입력과 과거 기록을 쓰는 곳 — 반응·노출이 바뀌는 쓰기 경로가 **자기 트랜잭션 안에서** 부른다.
 *
 * 🔴 페이지 조회(GET)는 여기 어떤 함수도 부르지 않는다. 읽기는 queries/best.ts 다.
 * 🔴 `prisma` 를 import 하지 않는다. 호출부의 tx 를 받는다 — 원본 반응 저장 · 순위 키 갱신 ·
 *    기록이 한 트랜잭션이라 하나만 남는 부분 실패가 없다.
 *
 * ── 쓰기 경로가 부르는 것 ──────────────────────────────────────────
 *   syncBestRanking(tx, postId)   공감·댓글·댓글 숨김/복구·글 삭제/숨김/복구·운영 글 숨김
 *   applyMemberBlock(tx, …)       회원 차단·해제 — 영향 글을 모두 다시 계산한 뒤 기록 판정은 한 번
 *   🔴 쓰기 경로는 recomputePostRanking · recordBestEntries 를 따로 부르지 않는다.
 *      둘 중 하나만 부르면 "점수는 바뀌었는데 12위 진입이 기록되지 않는" 경로가 생긴다.
 *      `npm run check:best` 가 호출부를 센다.
 *
 * ── 기록(BestSelection)은 언제 생기는가 ─────────────────────────────
 *   사건마다 **전역 12개를 다시 보고**, 실반응이 있는데 아직 기록이 없는 글을 기록한다.
 *   사건이 난 글만 보지 않는다 — 위 글이 숨겨지거나 공감이 취소되면 13위가 끌려 올라오는데,
 *   그 글에는 사건이 없다.
 *   🔴 순위 키는 "지금" 이 들어가지 않는 고정값이다(best-ranking.ts). 시간이 흘러도 순서가
 *      바뀌지 않으므로, 순서가 바뀌는 순간은 언제나 위 쓰기 경로 중 하나다.
 *   🔴 도입 backfill(backfillBestRanking)이 활성화 직전의 12개를 초기 기록으로 맞춘다.
 *
 * 🔴 잠금 순서: 글 행을 postId 순으로 잠그고(lockPost) → BestSelection 을 postId 순으로 쓴다.
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
 * 🔴 쓰기 경로는 이것을 직접 부르지 않는다 — syncBestRanking 을 부른다.
 *    이것만 따로 부르는 곳은 둘이다: 회원 차단(글마다 계산한 뒤 기록은 한 번)과
 *    backfill(전부 계산한 뒤 기록은 한 번). 중간 상태의 12개를 기록하지 않기 위해서다.
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
 * 쓰기 경로의 단일 진입점 — 이 글의 순위 키를 다시 계산하고, 전역 12개를 보고 기록한다.
 *
 * 🔴 원본 변경(공감·댓글·글 상태)과 **같은 트랜잭션에서, 원본 변경 뒤에** 부른다.
 *    그래야 기록 판정이 방금 바뀐 12개를 본다.
 * 🔴 글이 숨겨지거나 지워진 뒤에 불러도 된다 — 그 글은 12개 후보에서 빠지고(BEST_GLOBAL_WHERE),
 *    대신 끌려 올라온 글이 기록된다. 되살린 글은 키를 다시 맞춘 뒤 판정한다.
 * 🔴 C-4 글이면 순위 키는 건드리지 않지만 기록 판정은 한다 — 그 글이 아니라 전역 12개를 보는 일이다.
 */
export async function syncBestRanking(db: Db, postId: string) {
  const ranking = await recomputePostRanking(db, postId)
  const recorded = await recordBestEntries(db)
  return { ranking, recorded }
}

/**
 * 회원 차단·해제 — 차단 여부를 바꾸고, 그 회원이 반응한 글의 순위 키를 다시 계산한다.
 *
 * 🔴 차단 여부는 실회원 판정의 입력이다(BEST_REAL_MEMBER_WHERE). 바꾸기만 하고 다시 세지 않으면
 *    차단 회원의 공감·댓글이 다른 반응이 생길 때까지 순위에 남는다(해제도 반대로 복구되지 않는다).
 * 🔴 호출부 트랜잭션 안에서 부른다 — 차단과 재계산이 함께 커밋되거나 함께 되돌아간다.
 * 🔴 영향 글만 센다: 그 회원의 공감 글 ∪ MEMBER 댓글 글. 한 글은 한 번만(공감+댓글이어도).
 *    전체 글을 다시 계산하지 않는다. 동시 Promise 를 만들지 않고 postId 순으로 하나씩 —
 *    글 행 잠금을 늘 같은 순서로 잡아 다른 트랜잭션과 고리가 생기지 않는다.
 * 🔴 기록 판정은 **모든 영향 글을 다시 계산한 뒤 한 번**이다. 글마다 판정하면 절반만 계산된
 *    12개를 보고 기록한다 — 해제 중간에 아직 복구 안 된 글 대신 다른 글이 기록되는 식이다.
 * 🔴 과거 기록(BestSelection)은 지우지 않는다. 작성자 본인 제외·같은 회원 한 번 규칙은
 *    countRealReactions 가 그대로 지킨다.
 */
export async function applyMemberBlock(
  db: Db,
  userId: string,
  blocked: boolean,
): Promise<{ affectedPosts: number; recorded: { created: number; peakRaised: number } }> {
  await db.user.update({ where: { id: userId }, data: { isBlocked: blocked }, select: { id: true } })
  const [liked, commented] = await Promise.all([
    db.like.findMany({ where: { userId }, distinct: ['postId'], select: { postId: true } }),
    db.comment.findMany({
      where: { authorId: userId, commentOrigin: 'MEMBER' },
      distinct: ['postId'],
      select: { postId: true },
    }),
  ])
  const postIds = [...new Set([...liked, ...commented].map((r) => r.postId))].sort()
  for (const postId of postIds) await recomputePostRanking(db, postId)
  const recorded = await recordBestEntries(db)
  return { affectedPosts: postIds.length, recorded }
}

export type BackfillSummary = {
  scanned: number
  /** C-4 로 계산하지 않은 글 */
  blocked: number
  /** 순위 키·가중치가 식과 달랐던 글 */
  changed: number
  /** 실제로 다시 쓴 글(apply 일 때만) */
  written: number
  /** 식으로 계산한 전역 12개 — 기록 후보 판단의 근거 */
  top: { id: string; title: string; boardType: BoardType; score: number; weight: number; recorded: boolean }[]
  /** 새로 만들 기록 수(apply 전 판단) */
  toCreate: number
  created: number
  peakRaised: number
}

/**
 * 도입 backfill — 모든 글의 순위 키를 식으로 다시 계산하고, 끝난 뒤 **한 번** 지금 12개 중
 * 실반응 글만 기록한다(recordedBy='backfill', 그 시각이 최초 진입 시각).
 *
 * 🔴 기본은 dry-run 이다. apply 가 아니면 아무것도 쓰지 않는다.
 * 🔴 멱등이다 — 두 번째 apply 는 쓰기 0 이다.
 * 🔴 과거 12위 진입을 재현하지 않는다(취소된 공감은 행이 없다). 추정 기록을 만들지 않는다.
 * 🔴 쓰기는 쓰기 경로와 같은 recomputePostRanking 이다 — 글 행을 잠그고 그 순간의 원본으로 계산한다.
 *    글마다 짧은 트랜잭션이라 운영 중에 돌려도 한 글 이상 오래 잡지 않는다.
 */
export async function backfillBestRanking(
  db: PrismaClient,
  { apply, batchSize = 200 }: { apply: boolean; batchSize?: number },
): Promise<BackfillSummary> {
  const sum: BackfillSummary = {
    scanned: 0, blocked: 0, changed: 0, written: 0, top: [], toCreate: 0, created: 0, peakRaised: 0,
  }
  const keep: Omit<BackfillSummary['top'][number], 'recorded'>[] = []
  let cursor: string | undefined
  for (;;) {
    const rows = await db.post.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true, title: true, boardType: true, authorId: true, createdAt: true,
        bestRankScore: true, bestReactionWeight: true, ...POST_VISIBILITY_SELECT,
      },
    })
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id
    for (const row of rows) {
      sum.scanned += 1
      const vis = pickPostVisibility(row)
      if (isPromotionWriteBlocked(vis)) {
        sum.blocked += 1
        continue
      }
      const weight = reactionWeight(await countRealReactions(db, row))
      const score = bestRankScore({ createdAt: row.createdAt, weight })
      if (weight !== row.bestReactionWeight || !sameRankScore(score, row.bestRankScore)) {
        sum.changed += 1
        if (apply) {
          await db.$transaction((tx) => recomputePostRanking(tx, row.id))
          sum.written += 1
        }
      }
      if (isDiscoveryEligible(vis) && COMMUNITY_BOARD_TYPES.includes(row.boardType)) {
        keep.push({ id: row.id, title: row.title, boardType: row.boardType, score, weight })
        keep.sort((a, b) => b.score - a.score || (a.id < b.id ? 1 : -1))
        if (keep.length > BEST_CURRENT_SIZE) keep.pop()
      }
    }
  }
  const recorded = new Set(
    (await db.bestSelection.findMany({ where: { postId: { in: keep.map((t) => t.id) } }, select: { postId: true } }))
      .map((r) => r.postId),
  )
  sum.top = keep.map((t) => ({ ...t, recorded: recorded.has(t.id) }))
  sum.toCreate = sum.top.filter((t) => hasValidReaction(t.weight) && !t.recorded).length
  if (apply) {
    const r = await db.$transaction((tx) => recordBestEntries(tx, BEST_RECORDED_BY.backfill))
    sum.created = r.created
    sum.peakRaised = r.peakRaised
  }
  return sum
}
