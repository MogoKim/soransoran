/**
 * 홈 인기 편성 — 후보 조회(loadHomePopularInputs) · 편성(composeHomePopularViews) 두 가지만 둔다.
 *
 * 🔴 prisma 싱글톤 · auth · next-auth · Next.js 를 import 하지 않는다(check:visibility 가 막는다).
 *    DB 는 인자로 받고, 세션이 필요한 차단 목록은 queries/posts.ts 가 구해 넘긴다.
 *    그래야 검사·replay 가 Next 타입을 끌어오지 않고 화면과 같은 함수를 그대로 부른다.
 * 🔴 홈 노출 예외(applyHomeExposure)를 부르는 곳은 이 파일의 composeHomePopularViews 하나다.
 *
 * 쓰는 곳: src/lib/queries/posts.ts getHomePopularViews · scripts/home-popularity-*
 */
import type { BoardType, Prisma } from '@prisma/client'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import { DISCOVERY_ELIGIBLE_WHERE } from '@/lib/post-visibility'
import { pickBoardPopular, pickHomePopular, type ScorablePost } from '@/lib/popularity'
import { withRealReactions } from '@/lib/popularity-db'
import { POST_LIST_ITEM_SELECT } from '@/lib/queries/post-list-item-select'
import { applyHomeExposure, isOverrideActive, type OverrideRow } from '@/lib/home-exposure-rules'
import {
  HOME_OVERRIDE_HEADROOM,
  HOME_POPULAR_CANDIDATES_PER_BOARD,
  HOME_POPULAR_COUNT,
  HOME_POPULAR_MIN_MENOPAUSE,
  HOME_POPULAR_PER_BOARD,
} from '@/lib/home-exposure'

const COMMUNITY_BOARD_TYPES = COMMUNITY_BOARDS.map((b) => b.type) as BoardType[]

/** 편성 입력 한 벌 — 로더가 만들고, 검사는 표본으로 직접 만든다. */
export type HomePopularInputs<T extends ScorablePost> = {
  menopause: readonly T[]
  free: readonly T[]
  pinnedPosts: readonly T[]
  overrides: readonly OverrideRow[]
}

/**
 * 홈 인기 편성의 입력 — 게시판별 후보 한 벌 · 홈 노출 예외 · 고정 글.
 *
 * 🔴 모바일(섞은 20)과 데스크톱(게시판별 10|10)은 **이 한 벌**에서 함께 나온다.
 *    화면마다 따로 조회하지 않는다 — 조회가 늘고, 두 화면이 다른 시점의 후보를 보게 된다.
 *
 * 🔴 홈 전용이다. /best 는 이것을 쓰지 않는다 — 자기 입성 기준(best-ranking.ts)과
 *    읽기(queries/best.ts)가 있다. 두 화면의 점수를 합치지 않는다.
 *
 * getRecentDiscoveryPosts 와 짝이다. 둘 다 discovery 표면이고 고르는 기준만 다르다 —
 * 상세 하단 이어읽기는 최신순, 인기글은 점수순이라 함수를 나눈다.
 *
 * 게시판별로 따로 가져오는 이유는 배분 때문이다. 한 번에 가져오면 자유게시판이
 * 상위를 채웠을 때 갱년기톡 후보가 애초에 손에 들어오지 않는다.
 *
 * 점수와 배분은 popularity.ts 가 맡는다 — 여기는 조회만 한다.
 * 차단 목록을 인자로 받는다 — 차단은 로그인 세션(auth)을 읽어야 해서 queries/posts.ts 가 구해 넘긴다.
 * `db` 를 인자로 받는다 — 화면은 prisma 를, 격리 DB 검사는 조회 수를 세는 클라이언트를 넘긴다.
 *
 * 🔴 점수의 반응은 실반응 신호(popularity-db.ts — 실회원 사람 수 + 비회원 상한 3)다. 후보를 고른 뒤 붙인다.
 *    화면에 그리는 `_count.comments`(Persona 댓글 포함 실제 개수)는 그대로 둔다 — 숫자를 바꾸지 않고
 *    순서만 실반응으로 매긴다.
 */
export async function loadHomePopularInputs(db: Prisma.TransactionClient, blockedIds: string[], now: Date) {
  const candidatesFor = (boardType: BoardType) =>
    db.post.findMany({
      where: {
        boardType,
        ...DISCOVERY_ELIGIBLE_WHERE,
        ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
      },
      select: POST_LIST_ITEM_SELECT,
      orderBy: { createdAt: 'desc' },
      take: HOME_POPULAR_CANDIDATES_PER_BOARD,
    })

  const [[menopause, free], overrides] = await Promise.all([
    Promise.all([candidatesFor('MENOPAUSE'), candidatesFor('FREE')]).then(([menopauseRows, freeRows]) =>
      Promise.all([withRealReactions(db, menopauseRows), withRealReactions(db, freeRows)]),
    ),
    // 🔴 만료 판정을 SQL 로 하지 않는다. isActive 만 좁혀 가져오고
    //    expiresAt 비교는 규칙 함수가 한 곳에서 한다 — 두 곳이면 언젠가 어긋난다.
    db.homeExposureOverride.findMany({
      where: { surface: 'HOME_POPULAR', isActive: true },
      select: { postId: true, action: true, position: true, isActive: true, expiresAt: true },
    }),
  ])

  /**
   * 🔴 PIN 글을 따로 조회한다.
   *    자동 후보 안에서만 찾으면 점수가 낮아 후보에 못 든 글은 고정해도 뜨지 않는다 —
   *    운영자가 "고정했는데 안 보인다" 를 겪는다. PIN 은 자동 점수를 이겨야 한다.
   *
   * 🔴 그러나 노출 안전 규칙은 이기지 않는다.
   *    자동 후보와 **똑같은 where** 를 쓴다 — 게시판(MENOPAUSE·FREE) ·
   *    DISCOVERY_ELIGIBLE_WHERE(PUBLISHED · isMicroSeed=false ·
   *    indexPromotionBlocked=false) · 차단 회원 제외.
   *    조건을 못 지난 글은 여기서 조회되지 않아 홈에 나가지 않는다.
   *
   * 🔴 HIDE 와 겹친 PIN 은 규칙 함수가 뺀다. 여기서는 거르지 않는다 —
   *    충돌 판정이 두 곳이면 언젠가 서로 다른 답을 낸다.
   */
  const activePinIds = overrides
    .filter((o) => o.action === 'PIN' && isOverrideActive(o, now))
    .map((o) => o.postId)

  // 고정 글도 자동 후보와 같은 모양으로 맞춘다 — 점수는 쓰지 않지만 어드민이 같은 칸을 그린다.
  const pinnedPosts = activePinIds.length
    ? await withRealReactions(db, await db.post.findMany({
        where: {
          id: { in: activePinIds },
          boardType: { in: COMMUNITY_BOARD_TYPES },
          ...DISCOVERY_ELIGIBLE_WHERE,
          ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
        },
        select: POST_LIST_ITEM_SELECT,
      }))
    : []

  return { menopause, free, pinnedPosts, overrides }
}

/**
 * 홈 인기 편성 — 순수 점수 위에 홈 노출 예외를 한 겹 얹어 모바일·데스크톱 결과를 함께 만든다.
 *
 *   mobile   두 게시판을 섞은 한 줄 · 갱년기톡 최소 보장 · HOME_POPULAR_COUNT
 *   desktop  게시판별 열 · 최소 보장 없음 · 각 HOME_POPULAR_PER_BOARD
 *
 * 🔴 applyHomeExposure 를 부르는 곳은 여기 하나다.
 *    예전에 순수 점수 함수 안에 두었더니 그 함수를 함께 쓰던 /best 까지
 *    홈 고정·숨김을 따라갔다. 홈 큐레이션은 홈(/) 과 /admin/home 의 것이다.
 *
 * 🔴 `now` 하나를 점수·만료 판정 전부에 넘긴다. 결과마다 시각이 다르면 같은 HIDE 가
 *    한쪽에서만 풀리고, 같은 글이 열과 한 줄에서 다른 순서를 받는다.
 * 🔴 HIDE 는 세 결과 모두에 걸린다. PIN 은 글이 속한 게시판 열 맨 위에만, 열 안에서 position 순서로 선다.
 * 후보가 모자라면 있는 만큼만 — 최신 글·비적격 글로 채우지 않는다.
 */
export function composeHomePopularViews<T extends ScorablePost>(
  { menopause, free, pinnedPosts, overrides }: HomePopularInputs<T>,
  now: Date,
) {
  const mobile = applyHomeExposure({
    // 🔴 take 만큼만 뽑아 두면 HIDE 가 걸릴 때마다 홈이 한 칸씩 짧아진다.
    //    여유(HEADROOM)를 두고 뽑아 applyHomeExposure 가 잘라 낸다.
    candidates: pickHomePopular({
      menopause,
      free,
      take: HOME_POPULAR_COUNT * HOME_OVERRIDE_HEADROOM,
      minMenopause: HOME_POPULAR_MIN_MENOPAUSE,
      now,
    }),
    pinnedPosts,
    overrides,
    take: HOME_POPULAR_COUNT,
    now,
  })

  const column = (boardType: BoardType, posts: readonly T[]) =>
    applyHomeExposure({
      candidates: pickBoardPopular({ posts, boardType, take: HOME_POPULAR_PER_BOARD * HOME_OVERRIDE_HEADROOM, now }),
      // 다른 게시판의 고정 글은 이 열에서 찾지 못하게 한다 — 규칙 함수가 찾지 못한 PIN 은 건너뛴다.
      pinnedPosts: pinnedPosts.filter((p) => p.boardType === boardType),
      overrides,
      take: HOME_POPULAR_PER_BOARD,
      now,
    })

  return {
    mobile,
    desktop: { MENOPAUSE: column('MENOPAUSE', menopause), FREE: column('FREE', free) },
  }
}
