import { prisma } from '@/lib/prisma'
import { loadPostThreads } from '@/lib/queries/comment-threads'
import { auth } from '@/lib/auth'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import {
  COMMUNITY_VISIBLE_WHERE,
  DISCOVERY_ELIGIBLE_WHERE,
  POST_VISIBILITY_SELECT,
} from '@/lib/post-visibility'
import { EXCLUDE_GREETING } from '@/lib/greeting-policy'
import { BOARD_PAGE_SIZE, isPageOutOfRange, type BoardSort } from '@/lib/list-query'
import { pickHomePopular } from '@/lib/popularity'
import { POST_LIST_ITEM_SELECT } from '@/lib/queries/post-list-item-select'
import { applyHomeExposure, isOverrideActive } from '@/lib/home-exposure-rules'
import type { BoardType } from '@prisma/client'

const COMMUNITY_BOARD_TYPES = COMMUNITY_BOARDS.map((b) => b.type) as BoardType[]

/**
 * 🟢 Micro Seed 는 여기서 제외하지 않는다.
 *
 * 커뮤니티 목록·상세는 Micro Seed 가 "보여야 하는" 표면이다.
 * 제외 대상은 sitemap · JSON-LD · OG · best · trending · related · search ·
 * topic hub · public API 이지 커뮤니티 화면이 아니다.
 * 목록·상세에서 빼면 레인의 목적(커뮤니티 생활감)이 사라진다.
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §2-0 · §4 · §7-A
 */

/**
 * 🔴 차단 사용자 필터
 *
 * 차단을 저장만 해 두고 어느 쿼리에서도 걸러내지 않으면, 사용자는 보호받는다고
 * 믿는데 실제로는 아니다 — 미구현보다 나쁘다.
 * 그래서 목록·상세 쿼리 모두에서 처음부터 필터를 적용한다.
 *
 * 차단 UI 를 D-day 에 숨기더라도 이 필터는 유지한다.
 */
export async function getBlockedUserIds(): Promise<string[]> {
  const session = await auth()
  const viewerId = session?.user?.id
  if (!viewerId) return []

  const blocks = await prisma.userBlock.findMany({
    where: { blockerId: viewerId },
    select: { blockedUserId: true },
  })
  return blocks.map((b) => b.blockedUserId)
}

/** 게시판 목록(PostCard)용. 미리보기와 작성자를 그리므로 content·author 가 필요하다. */
const POST_LIST_SELECT = {
  id: true,
  title: true,
  // 목록 미리보기용. 전체를 실어 나르지 않도록 화면에서 잘라 쓴다.
  content: true,
  createdAt: true,
  viewCount: true,
  // displayName 이 nickname → name 순으로 읽는다. 목록은 그 둘만 있으면 된다.
  author: { select: { name: true, nickname: true } },
  // 삭제된 댓글은 세지 않는다 — 목록의 숫자와 상세에 보이는 개수가 어긋나면 안 된다.
  _count: { select: { comments: { where: { isDeleted: false } } } },
} as const


/**
 * 🔴 조회수는 목록 정렬까지다.
 *    사람이 스스로 고른 정렬과, 서비스가 대표로 골라 첫 화면에 내미는 순서는 다른 문제다.
 *    비정규화 카운터(조회수)는 표시와 목록 정렬에만 쓰고 승격·추천 점수의 입력에서는 뺀다.
 *    홈 인기글·베스트가 쓰는 popularity.ts 는 조회수를 모른다 (정본 C-4).
 *
 * 🔴 정렬 축(`BOARD_SORTS` · `BoardSort` · `parseBoardSort`)은 `@/lib/list-query` 에 있다.
 *    페이지 이동 UI 가 client 인데 정렬 타입을 알아야 한다. 이 파일은 `prisma` 와 `auth` 를
 *    가져오므로, 거기서 값을 하나라도 가져가면 브라우저 번들이 그 둘을 문다.
 *
 * 🔴 첫 가입 인사는 이 목록에 넣지 않는다.
 *    새로 온 사람의 인사는 홈에서 환영으로 보여줄 글이지, 게시판을 열어
 *    이야기를 읽으러 온 사람에게 내밀 글이 아니다. 매일 몇 건씩 쌓이면
 *    자유게시판 첫 화면이 인사말로 덮인다.
 *
 *    빼는 축이 3축 게이트가 아니라 category 인 이유는, 이것이 노출 정책이 아니라
 *    "어떤 종류의 글인가" 의 문제이기 때문이다. 색인·추천에서 빠지는 것은
 *    3축이 따로 담당한다 (post-visibility.ts).
 *
 * 🔴 AND 로 묶는다.
 *    EXCLUDE_GREETING 은 OR 키를 가진다. 지금 이 where 에는 OR 가 없어 펼쳐도
 *    되지만, 나중에 누가 OR 를 하나 더하는 순간 키가 덮여 조용히 사라진다.
 *    AND 는 그 일이 일어나지 않는다.
 *
 * 🔴 **`where` 를 변수 하나로 만들어 목록과 개수가 같은 것을 센다.**
 *    두 번 적으면 언젠가 한쪽만 고쳐진다. 그 순간 마지막 페이지가 404 가 되거나
 *    빈 페이지가 200 이 된다 — 조건이 어긋난 것을 화면에서는 알아볼 수 없다.
 *    특히 `blockedIds` 는 보는 사람마다 다르다. 목록에서만 빼고 개수에서 안 빼면
 *    차단한 사람이 있는 회원에게만 페이지 수가 부풀어 빈 마지막 페이지가 생긴다.
 *
 * 🔴 **`unstable_cache` 를 쓰지 않는다.** 이 목록은 `auth()` 에 기대는 뷰어별 결과다.
 *    캐시하면 A 가 차단한 사람의 글이 B 에게 그대로 나간다. 우나어 목록에는
 *    차단 필터가 없어 캐시가 성립하지만, 그 구조를 여기로 가져올 수 없다.
 *
 * 🔴 정렬 마지막은 언제나 `{ id: 'desc' }` 다.
 *    `createdAt` 이 같은 글이 여럿이면 순서가 정해지지 않아 `skip/take` 경계에서
 *    같은 글이 두 번 나오거나 한 건이 빠진다. 하루 100건을 일괄 발행하는 구조라
 *    같은 시각의 글은 실제로 생긴다. 한계는 `list-query.ts` 끝에 적어 두었다 —
 *    이 tie-breaker 는 **같은 데이터 상태 안에서만** 순서를 보장한다.
 */
export async function getPostsByBoard(
  boardType: BoardType,
  sort: BoardSort = 'latest',
  page = 1,
) {
  const blockedIds = await getBlockedUserIds()

  const where = {
    boardType,
    ...COMMUNITY_VISIBLE_WHERE,
    ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    AND: [EXCLUDE_GREETING],
  }

  /* 조회순에도 최신순을 보조로 둔다.
     조회수가 같은 글이 여럿이면 어느 쪽이 위인지 정해지지 않아, 같은 화면을
     다시 열 때마다 자리가 바뀌어 보인다. 지금처럼 조회수가 한 자릿수일 때 특히 그렇다. */
  const orderBy =
    sort === 'views'
      ? [{ viewCount: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: 'desc' as const }, { id: 'desc' as const }]

  /**
   * 🔴 **count 가 findMany 보다 먼저다. 나란히 돌리지 않는다.**
   *
   *    `?page=999999999999999999999999` 는 형식이 멀쩡한 양의 정수라 파서를 통과한다.
   *    이 값이 `skip` 에 닿으면 Prisma 는 Int 범위를 넘겼다며 던지고 화면은 **500** 이 된다.
   *    없는 쪽의 올바른 답은 500 이 아니라 404 다 — 그래서 **범위를 먼저 확인하고,
   *    유효한 쪽에만 findMany 를 실행한다.** 큰 값에서는 쿼리가 아예 한 번만 나간다.
   *
   *    대가는 유효한 쪽에서 왕복이 하나 늘어나는 것이다(나란히 → 차례로).
   *    이 경로는 이미 `auth()` → 차단 목록 조회가 차례로 일어나므로 한 단계가 더해질 뿐이고,
   *    500 을 못 내게 하는 값이 그보다 크다.
   *
   * 🔴 경계 판정은 호출부(page.tsx)와 **같은 함수**를 쓴다.
   *    여기서 따로 비교식을 적으면 두 곳이 갈라져, 한쪽은 빈 목록을 주고
   *    다른 쪽은 404 를 주지 않는 상태가 된다.
   */
  const total = await prisma.post.count({ where })
  if (isPageOutOfRange(page, total)) return { posts: [], total }

  const posts = await prisma.post.findMany({
    where,
    select: POST_LIST_SELECT,
    orderBy,
    skip: (page - 1) * BOARD_PAGE_SIZE,
    take: BOARD_PAGE_SIZE,
  })

  return { posts, total }
}

/**
 * 홈 "지금 올라온 이야기" 용 — 커뮤니티 보드 전체에서 최신 글을 섞어 가져온다.
 *
 * 🔴 이건 community list 가 아니라 **discovery 표면**이다.
 *    특정 게시판을 열어 보는 것과, 서비스가 대표로 골라 첫 화면에 올리는 것은 다르다.
 *    따라서 DISCOVERY_ELIGIBLE_WHERE 를 쓰고 Micro Seed 를 제외한다.
 *
 * 게시판 목록·상세(getPostsByBoard · getPostDetail)는 COMMUNITY_VISIBLE_WHERE 를
 * 그대로 쓴다 — 거기서는 Micro Seed 가 보여야 한다.
 */
export async function getRecentDiscoveryPosts(take = 6) {
  const blockedIds = await getBlockedUserIds()

  return prisma.post.findMany({
    where: {
      boardType: { in: COMMUNITY_BOARD_TYPES },
      ...DISCOVERY_ELIGIBLE_WHERE,
      ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    },
    select: POST_LIST_ITEM_SELECT,
    orderBy: { createdAt: 'desc' },
    take,
  })
}

/** 게시판 하나에서 점수 계산에 넣을 후보를 몇 건까지 가져올지. */
const HOME_POPULAR_CANDIDATES_PER_BOARD = 60

/**
 * 홈 노출 예외를 얹기 전, 자동 후보를 몇 배로 넉넉히 뽑을지.
 *
 * 🔴 take 만큼만 뽑아 두면 HIDE 가 걸릴 때마다 홈이 한 칸씩 짧아진다.
 *    PIN 이 자동 상위와 겹쳐도 마찬가지다. 여유를 두고 뽑아 잘라 낸다.
 */
const HOME_OVERRIDE_HEADROOM = 2

/** 총 노출에서 갱년기톡에 보장하는 최소 자리. 후보가 모자라면 있는 만큼만 채운다. */
const HOME_POPULAR_MIN_MENOPAUSE = 7

/**
 * 홈 인기 점수 목록 — 홈 노출 예외(PIN·HIDE)를 얹기 전의 순수 점수 순서.
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
 * 차단 목록을 인자로 받는다 — 홈 경로가 getBlockedUserIds 를 두 번 부르지 않게 하려는 것이다.
 */
async function pickPopularByScore(take: number, blockedIds: string[]) {
  const candidatesFor = (boardType: BoardType) =>
    prisma.post.findMany({
      where: {
        boardType,
        ...DISCOVERY_ELIGIBLE_WHERE,
        ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
      },
      select: POST_LIST_ITEM_SELECT,
      orderBy: { createdAt: 'desc' },
      take: HOME_POPULAR_CANDIDATES_PER_BOARD,
    })

  const [menopause, free] = await Promise.all([candidatesFor('MENOPAUSE'), candidatesFor('FREE')])

  return pickHomePopular({
    menopause,
    free,
    take,
    minMenopause: HOME_POPULAR_MIN_MENOPAUSE,
    now: new Date(),
  })
}

/**
 * 홈 "지금 뜨는 이야기" 용 — 순수 인기 점수 위에 홈 노출 예외를 한 겹 얹는다.
 *
 * 🔴 applyHomeExposure 를 부르는 곳은 여기 하나다.
 *    예전에 순수 점수 함수 안에 두었더니 그 함수를 함께 쓰던 /best 까지
 *    홈 고정·숨김을 따라갔다. 홈 큐레이션은 홈(/) 과 /admin/home 의 것이다.
 *
 * 쓰는 곳: src/app/page.tsx · src/app/admin/(ops)/home/page.tsx
 */
export async function getHomePopularPosts(take = 20) {
  const blockedIds = await getBlockedUserIds()

  const [candidates, overrides] = await Promise.all([
    // 🔴 take 만큼만 뽑아 두면 HIDE 가 걸릴 때마다 홈이 한 칸씩 짧아진다.
    //    여유(HEADROOM)를 두고 뽑아 applyHomeExposure 가 잘라 낸다.
    pickPopularByScore(take * HOME_OVERRIDE_HEADROOM, blockedIds),
    // 🔴 만료 판정을 SQL 로 하지 않는다. isActive 만 좁혀 가져오고
    //    expiresAt 비교는 규칙 함수가 한 곳에서 한다 — 두 곳이면 언젠가 어긋난다.
    prisma.homeExposureOverride.findMany({
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
    .filter((o) => o.action === 'PIN' && isOverrideActive(o))
    .map((o) => o.postId)

  const pinnedPosts = activePinIds.length
    ? await prisma.post.findMany({
        where: {
          id: { in: activePinIds },
          boardType: { in: COMMUNITY_BOARD_TYPES },
          ...DISCOVERY_ELIGIBLE_WHERE,
          ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
        },
        select: POST_LIST_ITEM_SELECT,
      })
    : []

  return applyHomeExposure({ candidates, pinnedPosts, overrides, take })
}

export async function getPostDetail(postId: string) {
  const blockedIds = await getBlockedUserIds()

  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      ...COMMUNITY_VISIBLE_WHERE,
      ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    },
    select: {
      id: true,
      boardType: true,
      title: true,
      content: true,
      createdAt: true,
      viewCount: true,
      author: { select: { id: true, name: true, nickname: true, image: true } },
      // 상세 metadata 가 robotsMetaFor() 로 noindex 를 판정하는 데 쓴다.
      ...POST_VISIBILITY_SELECT,
    },
  })
  if (!post) return null

  const { threads, anomalies } = await loadPostThreads(prisma, {
    postId,
    postAuthorId: post.author.id,
    blockedAuthorIds: blockedIds,
  })
  if (anomalies.length > 0) {
    // 🔴 화면은 깨뜨리지 않되 조용히 넘기지 않는다 — 관계가 어긋난 댓글은 스레드 시작점으로 섰다
    console.error('[comment-thread] 관계 이상', { postId, anomalies })
  }

  return { post, threads }
}
