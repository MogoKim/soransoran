import type { BoardType, Prisma, PrismaClient } from '@prisma/client'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import {
  DISCOVERY_ELIGIBLE_WHERE,
  POST_VISIBILITY_SELECT,
  isDiscoveryEligible,
  isPromotionWriteBlocked,
  pickPostVisibility,
  type PostVisibilityInput,
} from '@/lib/post-visibility'
import { REAL_MEMBER_WHERE } from '@/lib/admin-format'
import {
  BEST_POLICY_VERSION,
  BEST_RECORDED_BY,
  BEST_V2_UNUSED_COLUMNS,
  meetsBestEntry,
  reactionWeight,
  type BestRecordedBy,
  type RealReactions,
} from '@/lib/best-ranking'

/**
 * /best 자격 동기화 — 반응·노출이 바뀌는 쓰기 경로가 **자기 트랜잭션 안에서** 부른다.
 *
 * 🔴 페이지 조회(GET)는 여기 어떤 함수도 부르지 않는다. 읽기는 queries/best.ts 다.
 * 🔴 `prisma` 를 import 하지 않는다. 호출부의 tx 를 받는다 — 원본 반응 저장 · 가중치 갱신 ·
 *    최초 입성 기록이 한 트랜잭션이라 하나만 남는 부분 실패가 없다.
 *
 * ── 쓰기 경로가 부르는 것 ──────────────────────────────────────────
 *   syncBestEligibility(tx, postId)   공감·댓글·댓글 숨김/복구·글 삭제/숨김/복구·운영 글 숨김
 *   applyMemberBlock(tx, …)           회원 차단·해제 — 영향 글마다 syncBestEligibility
 *   🔴 **바뀐 글 하나만 본다.** 전역 순위를 읽지 않는다 — 입성은 그 글의 W 와 공개 자격으로만 정해진다.
 *      (best-v1 은 사건마다 전역 12개를 다시 읽었다. 그 로직은 지웠다)
 *
 * ── 기록(BestSelection) ─────────────────────────────────────────────
 *   W ≥ 2 이고 공개 자격이 있는 첫 순간 한 행을 만든다(firstEnteredAt = 그 트랜잭션 시각).
 *   🔴 행을 지우거나 고치지 않는다 — 반응 감소·차단·숨김 뒤에도 그대로다. 숨김·삭제 글은
 *      읽기(queries/best.ts)가 목록·개수에서 뺄 뿐이라, 되살리면 원래 자리로 돌아온다.
 *   🔴 글당 한 행 — postId PK + skipDuplicates. 동시 요청이 함께 기준을 넘어도 두 번째는 0 건이고,
 *      사용자의 공감·댓글 요청을 실패시키지 않는다.
 *
 * 🔴 잠금 순서: 글 행을 잠그고(lockPost) → 그 글의 BestSelection 을 쓴다. 여러 글을 다루는 호출부
 *    (차단·backfill)는 postId 순으로 하나씩 — 두 트랜잭션이 서로를 기다리는 고리가 생기지 않는다.
 */

type Db = Prisma.TransactionClient

const COMMUNITY_BOARD_TYPES = COMMUNITY_BOARDS.map((b) => b.type) as BoardType[]

/**
 * 베스트 공개 자격 — 보는 사람과 무관하다. 목록(queries/best.ts)과 입성 판정이 같은 조건을 쓴다.
 * 🔴 차단 필터가 없다. 누가 누구를 차단했든 기록은 하나다. 화면 필터는 queries/best.ts 가 얹는다.
 */
export const BEST_PUBLIC_WHERE = {
  boardType: { in: COMMUNITY_BOARD_TYPES },
  ...DISCOVERY_ELIGIBLE_WHERE,
} satisfies Prisma.PostWhereInput

/** BEST_PUBLIC_WHERE 의 행 판정판 — 잠근 행으로 입성 자격을 본다 */
export function isBestPublic(row: PostVisibilityInput & { boardType: BoardType }): boolean {
  return COMMUNITY_BOARD_TYPES.includes(row.boardType) && isDiscoveryEligible(pickPostVisibility(row))
}

/**
 * /best 가 "실회원" 으로 세는 사람 — 공감과 회원 댓글이 **같은 조건**을 쓴다.
 *
 * = 어드민 정본 REAL_MEMBER_WHERE(카카오 계정 · Persona 아님 · 운영 작성자 아님) + 운영 차단 아님.
 * 🔴 REAL_MEMBER_WHERE 자체를 고치지 않는다. 어드민의 "실회원 수" 는 차단된 사람도 센다 —
 *    그쪽의 뜻을 바꾸지 않고 베스트 전용 조건을 여기서 덧붙인다.
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
 * 글 행을 잠그고 자격 판정에 필요한 값을 읽는다.
 *
 * 🔴 UPDATE 로 잠근다(값은 그대로). 같은 글에 공감·댓글 트랜잭션이 동시에 오면
 *    뒤 트랜잭션이 여기서 기다렸다가 앞 트랜잭션이 커밋한 행까지 센다 —
 *    둘 다 W=1 을 보고 아무도 기록하지 않는 일이 없다(합치면 W=2 인데도).
 *    Prisma 에는 SELECT … FOR UPDATE 가 없고 raw SQL 은 쓰지 않는다.
 *
 * 🔴 **Post.updatedAt 을 움직이지 않는다.** 이 값은 sitemap lastModified 와 어드민 "수정" 시각 —
 *    글 내용이 바뀐 때다. 가중치 갱신은 글 수정이 아니다.
 *    그래서 읽은 updatedAt 을 **그대로 다시 쓰되, 그 값이 아직 그대로일 때만** 잠근다.
 *    읽은 뒤 잠그기 전에 다른 쓰기(글 수정·조회수·공감 수)가 커밋되면 조건이 어긋나 0 건이 되고,
 *    다시 읽어 새 값으로 잠근다 — 남의 수정 시각을 과거 값으로 되돌리지 않는다(격리 DB 반례).
 *    잠근 뒤에는 행 잠금이 커밋까지 이어져 그 사이 아무도 이 값을 바꾸지 못한다.
 */
async function lockPost(db: Db, postId: string) {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const seen = await db.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, boardType: true, updatedAt: true, bestReactionWeight: true, ...POST_VISIBILITY_SELECT },
    })
    if (!seen) return null
    const locked = await db.post.updateMany({
      where: { id: postId, updatedAt: seen.updatedAt },
      data: { bestReactionWeight: { increment: 0 }, updatedAt: seen.updatedAt },
    })
    if (locked.count === 1) return seen
  }
  throw new Error(`best: 글 ${postId} 을 ${LOCK_ATTEMPTS}번 연속 잠그지 못했다(경합)`)
}

/**
 * C-4 — 승격이 막힌 글인가. 판정 축은 생성 때 고정되므로 잠그기 전에 읽어도 된다.
 * 🔴 막힌 글에는 잠금(UPDATE)조차 하지 않는다 — "진입 즉시 return".
 */
async function isBlockedForBest(db: Db, postId: string): Promise<boolean> {
  const row = await db.post.findUnique({ where: { id: postId }, select: POST_VISIBILITY_SELECT })
  return !row || isPromotionWriteBlocked(pickPostVisibility(row))
}

/** 최초 입성 기록. 이미 있으면 0 건 — 오류가 아니다(글당 한 행 · 기존 행을 건드리지 않는다) */
async function recordFirstEntry(db: Db, postId: string, recordedBy: BestRecordedBy): Promise<boolean> {
  const r = await db.bestSelection.createMany({
    data: [{ postId, policyVersion: BEST_POLICY_VERSION, recordedBy, ...BEST_V2_UNUSED_COLUMNS }],
    skipDuplicates: true,
  })
  return r.count === 1
}

export type BestSyncResult = {
  /** 지금의 실반응 가중치 */
  weight: number
  /** 이 호출이 최초 입성 기록을 만들었는가 */
  entered: boolean
}

/**
 * 쓰기 경로의 단일 진입점 — 이 글의 W 를 다시 세어 저장하고, 기준을 처음 넘었으면 입성을 기록한다.
 *
 * 🔴 원본 변경(공감·댓글·글 상태)과 **같은 트랜잭션, 원본 변경 뒤에** 부른다.
 *    그래야 방금 바뀐 반응 수와 방금 바뀐 공개 상태로 판정한다.
 * 🔴 숨겨지거나 지워진 글은 W 만 맞추고 기록하지 않는다 — 공개 자격이 없다.
 *    되살린 글이 그때 W ≥ 2 이고 아직 기록이 없다면 되살린 순간 입성한다.
 * 🔴 C-4 글이면 아무것도 쓰지 않고 null 이다.
 */
export async function syncBestEligibility(
  db: Db,
  postId: string,
  recordedBy: BestRecordedBy = BEST_RECORDED_BY.event,
): Promise<BestSyncResult | null> {
  if (await isBlockedForBest(db, postId)) return null
  const post = await lockPost(db, postId)
  if (!post) return null
  const weight = reactionWeight(await countRealReactions(db, post))
  if (weight !== post.bestReactionWeight) {
    // 쓸 때도 updatedAt 은 잠글 때 읽은 값 그대로다(lockPost 주석).
    await db.post.update({
      where: { id: postId },
      data: { bestReactionWeight: weight, updatedAt: post.updatedAt },
      select: { id: true },
    })
  }
  const entered = meetsBestEntry(weight) && isBestPublic(post)
    ? await recordFirstEntry(db, postId, recordedBy)
    : false
  return { weight, entered }
}

/**
 * 회원 차단·해제 — 차단 여부를 바꾸고, 그 회원이 반응한 글의 자격을 다시 본다.
 *
 * 🔴 차단 여부는 실회원 판정의 입력이다(BEST_REAL_MEMBER_WHERE). 바꾸기만 하고 다시 세지 않으면
 *    차단 회원의 공감·댓글이 다른 반응이 생길 때까지 W 에 남는다(해제도 반대로 복구되지 않는다).
 * 🔴 호출부 트랜잭션 안에서 부른다 — 차단과 재계산·입성이 함께 커밋되거나 함께 되돌아간다.
 * 🔴 영향 글만 본다: 그 회원의 공감 글 ∪ MEMBER 댓글 글. 한 글은 한 번만(공감+댓글이어도).
 *    전체 글을 다시 보지 않는다. 동시 Promise 를 만들지 않고 postId 순으로 하나씩 —
 *    글 행 잠금을 늘 같은 순서로 잡아 다른 트랜잭션과 고리가 생기지 않는다.
 * 🔴 기존 기록은 지우지 않는다. 해제로 W 가 2 이상이 된 글은 그 순간 입성한다.
 */
export async function applyMemberBlock(
  db: Db,
  userId: string,
  blocked: boolean,
): Promise<{ affectedPosts: number; entered: number }> {
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
  let entered = 0
  for (const postId of postIds) {
    if ((await syncBestEligibility(db, postId))?.entered) entered += 1
  }
  return { affectedPosts: postIds.length, entered }
}

/** backfill 이 글마다 내리는 판정 */
export type BestBackfillVerdict =
  | 'enter' // 기준 통과 · 공개 · 기록 없음 → 새로 기록한다
  | 'recorded' // 이미 기록이 있다 — 건드리지 않는다
  | 'below' // W < 2
  | 'not-public' // 숨김·삭제·게시판 밖 — W 가 넘어도 입성하지 않는다
  | 'c4' // 승격 차단 글 — 계산하지 않는다

export type BestBackfillSummary = {
  scanned: number
  /** 저장된 W 가 원본 행과 달랐던 글 */
  weightChanged: number
  /** 판정별 글 수 */
  verdicts: Record<BestBackfillVerdict, number>
  /** W ≥ 1 이거나 기록이 있는 글의 판정 — dry-run 출력의 근거 */
  rows: { id: string; title: string; boardType: BoardType; status: string; weight: number; verdict: BestBackfillVerdict }[]
  /**
   * 이미 있는 기록 중 지금 정책과 어긋나는 것 — **분류만 한다. 지우지 않는다.**
   * (반응이 줄어 W < 2 가 된 기록은 정책상 정상이라 여기 넣지 않는다)
   */
  anomalies: { postId: string; reason: string }[]
  /** apply 일 때 실제로 쓴 수 */
  weightWritten: number
  created: number
}

/**
 * 도입 backfill — 모든 글의 W 를 원본 행으로 다시 세고, 기준을 넘었는데 기록이 없는 공개 글을
 * 기록한다(recordedBy='backfill', 그 시각이 입성 시각).
 *
 * 🔴 기본은 dry-run 이다. apply 가 아니면 아무것도 쓰지 않는다.
 * 🔴 멱등이다 — 두 번째 apply 는 쓰기 0 이다.
 * 🔴 기존 기록을 지우거나 고치지 않는다. 어긋난 기록은 anomalies 로 보고만 한다.
 * 🔴 쓰기는 쓰기 경로와 같은 syncBestEligibility 다 — 글 행을 잠그고 그 순간의 원본으로 판정한다.
 *    글마다 짧은 트랜잭션이라 운영 중에 돌려도 한 글 이상 오래 잡지 않는다.
 */
export async function backfillBestEligibility(
  db: PrismaClient,
  { apply, batchSize = 200 }: { apply: boolean; batchSize?: number },
): Promise<BestBackfillSummary> {
  const sum: BestBackfillSummary = {
    scanned: 0,
    weightChanged: 0,
    verdicts: { enter: 0, recorded: 0, below: 0, 'not-public': 0, c4: 0 },
    rows: [],
    anomalies: [],
    weightWritten: 0,
    created: 0,
  }
  const existing = new Map(
    (await db.bestSelection.findMany({ select: { postId: true, policyVersion: true } })).map((r) => [r.postId, r.policyVersion]),
  )
  let cursor: string | undefined
  for (;;) {
    const rows = await db.post.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true, title: true, boardType: true, authorId: true, bestReactionWeight: true, ...POST_VISIBILITY_SELECT,
      },
    })
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id
    for (const row of rows) {
      sum.scanned += 1
      const policy = existing.get(row.id)
      const recorded = policy !== undefined
      if (recorded && policy !== BEST_POLICY_VERSION) {
        sum.anomalies.push({ postId: row.id, reason: `이전 정책(${policy}) 규칙으로 생긴 기록` })
      }
      if (isPromotionWriteBlocked(pickPostVisibility(row))) {
        sum.verdicts.c4 += 1
        if (recorded) sum.anomalies.push({ postId: row.id, reason: 'C-4 승격 차단 글인데 기록이 있다' })
        continue
      }
      const weight = reactionWeight(await countRealReactions(db, row))
      const weightDiffers = weight !== row.bestReactionWeight
      if (weightDiffers) sum.weightChanged += 1
      const verdict: BestBackfillVerdict = recorded
        ? 'recorded'
        : !meetsBestEntry(weight)
          ? 'below'
          : !isBestPublic(row)
            ? 'not-public'
            : 'enter'
      sum.verdicts[verdict] += 1
      if (weight > 0 || recorded) {
        sum.rows.push({ id: row.id, title: row.title, boardType: row.boardType, status: row.status, weight, verdict })
      }
      if (apply && (weightDiffers || verdict === 'enter')) {
        const r = await db.$transaction((tx) => syncBestEligibility(tx, row.id, BEST_RECORDED_BY.backfill))
        if (weightDiffers) sum.weightWritten += 1
        if (r?.entered) sum.created += 1
      }
    }
  }
  return sum
}
