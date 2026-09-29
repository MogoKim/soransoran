/**
 * 게시판 목록의 주소 해석 — 페이지와 정렬의 정본.
 *
 * 🔴 **이 파일은 import 가 하나도 없다.** 서버 컴포넌트와 클라이언트 컴포넌트가
 *    같은 규칙을 써야 하는데, 조회 함수(`queries/posts.ts`)는 `prisma` 와 `auth` 를
 *    가져온다. 페이지네이션 UI 는 client 라 거기서 값을 하나라도 가져오면
 *    브라우저 번들에 Prisma 와 인증이 딸려온다. 타입 전용 import 는 지워지지만,
 *    한 번만 실수하면 새는 구조가 된다. 여기는 그 일이 일어날 수 없다.
 *
 * 🔴 정렬 상수도 여기 있다. 원래 `queries/posts.ts` 에 있었는데,
 *    페이지 링크를 만들려면 client 가 정렬 타입을 알아야 해서 옮겼다.
 *    **옮긴 것이지 복사한 것이 아니다** — 그쪽에는 남겨 두지 않았다.
 */

/**
 * 일반 게시판 한 페이지의 글 수.
 *
 * 🔴 이름에 `BOARD` 가 들어가는 것이 규칙의 일부다.
 *    `/best`(BEST_PAGE_SIZE) · `/my/*`(10) 은 각자의 역할로 따로 정한다.
 *    `LIST_PAGE_SIZE` 처럼 넓은 이름을 두면 언젠가 그중 하나가
 *    "목록이니까" 하고 끌어다 쓰고, 그때부터 값 하나가 여러 화면을 흔든다.
 *
 * 🔴 **경계 판정의 단일 소스다.** 조회의 `skip/take` 와 범위 초과 404(`isPageOutOfRange`)가
 *    서로 다른 값을 쓰면 "마지막 페이지인데 404" 또는 "빈 페이지인데 200" 이 생긴다.
 */
export const BOARD_PAGE_SIZE = 12

/**
 * 매거진 한 쪽의 글 수.
 *
 * 🔴 게시판과 **값이 같지만 같은 축이 아니다.** `BOARD_PAGE_SIZE` 를 가리키는 별칭으로
 *    두지 않는 이유가 그것이다 — 별칭이면 게시판 크기를 조정하는 날 매거진이 말없이 따라간다.
 *    회원 글 목록과 편집 콘텐츠 목록은 한 쪽에 몇 개가 알맞은지를 따로 정해야 한다.
 *
 *    숫자를 두 번 적는 것이 아니라 **역할을 두 개 두는 것**이다.
 *    두 값은 이 파일 안에 나란히 있고, 화면 파일로는 흩어지지 않는다.
 */
export const MAGAZINE_PAGE_SIZE = 12

/**
 * /best 한 쪽의 글 수. 베스트 입성 글을 최초 입성 최신순으로 이만큼씩 나눈다.
 *
 * 🔴 전체 상한이 아니라 쪽 크기다. 1쪽과 2쪽의 뜻이 같다(1~12번째 · 13~24번째 입성 글).
 * 🔴 게시판·매거진과 값이 같지만 별칭으로 두지 않는다 — 위 MAGAZINE_PAGE_SIZE 와 같은 이유다.
 *    마지막 쪽·범위 밖 판정은 게시판과 같은 lastPageOf · isPageOutOfRange 에 이 값을 넘겨 쓴다.
 */
export const BEST_PAGE_SIZE = 12

/**
 * 게시판 목록 정렬.
 *
 * 🔴 두 개로 끝낸다. 공감순·댓글순·인기순은 넣지 않는다 —
 *    고를 것이 늘수록 고르지 않게 되고, 목록의 기본 순서가 무엇인지 흐려진다.
 */
export const BOARD_SORTS = ['latest', 'views'] as const

export type BoardSort = (typeof BOARD_SORTS)[number]

/**
 * 주소창의 sort 값을 정렬로 바꾼다.
 *
 * 🔴 모르는 값은 막지 않고 최신순으로 돌린다.
 *    주소를 손으로 고쳤다고 목록이 비거나 404 가 되면, 고장 난 것으로 보인다.
 *    기본값이 최신순이므로 되돌아갈 곳이 언제나 있다.
 */
export function parseBoardSort(value: string | undefined): BoardSort {
  return BOARD_SORTS.includes(value as BoardSort) ? (value as BoardSort) : 'latest'
}

/**
 * 주소창의 page 값을 페이지 번호로 바꾼다. **양의 정수 문자열만 정상값이다.**
 *
 * 🔴 정렬과 같은 태도다 — 형식이 틀린 값에 404 를 주지 않고 1쪽으로 돌린다.
 *    `0` · `-1` · `abc` · `3.9` · `7abc` · `" 7 "` · 빈 문자열 · 공백이 전부 1이 된다.
 *
 * 🔴 `Number.parseInt` 를 쓰지 않는다. 그쪽은 앞에서부터 읽다가 멈추므로
 *    `3.9` → 3, `7abc` → 7 을 돌려준다. "3.9쪽" 을 3쪽으로 **추측해서** 보여주는 것은
 *    사용자가 주소에 적은 것과 다른 화면을 여는 일이다. 모르는 값은 추측하지 않고
 *    1쪽이라는 **되돌아갈 곳**으로 보낸다 — `parseBoardSort` 가 하는 일과 같다.
 *
 * 🔴 범위를 **넘긴** 값은 여기서 거르지 않는다. 형식이 틀린 것이 아니라
 *    "없는 쪽" 이라 답이 다르다 — 404 다 (`isPageOutOfRange` 참조).
 *
 * 🔴 자릿수가 아무리 길어도 형식이 맞으면 통과시키되 안전 정수로 눌러 둔다.
 *    `?page=999999999999999999999999` 는 `1e+24` 라는 부동소수가 되어,
 *    그대로 흘려보내면 주소를 다시 만들 때 `page=1e%2B24` 가 되고
 *    Prisma `skip` 에 닿으면 Int 범위를 넘겨 **500** 이 난다.
 *    `MAX_SAFE_INTEGER` 로 누르면 값은 여전히 어떤 total 보다도 커서 404 로 가고,
 *    숫자로서는 멀쩡해 아래 어느 단계도 깨뜨리지 않는다.
 *
 * 🔴 `?page=2&page=5` 처럼 같은 키가 둘이면 Next 가 배열을 준다. 첫 값을 쓴다.
 */
export function parsePageParam(raw: string | string[] | undefined): number {
  const first = firstParam(raw)
  if (first === undefined || !/^\d+$/.test(first)) return 1
  const parsed = Number(first)
  if (parsed < 1) return 1
  return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

/**
 * 같은 키가 둘이면 Next 가 배열을 준다(`?page=2&page=5`). 첫 값만 쓴다.
 *
 * 🔴 **주소 해석의 첫 관문이자, 배열을 더 안쪽으로 들여보내지 않는 문이다.**
 *    목록 계산을 React `cache` 로 감쌀 때 배열이 인자로 들어가면 캐시가 깨진다 —
 *    `cache` 는 인자의 **동일성**만 보므로 내용이 같은 다른 배열은 다른 키다.
 *    `generateMetadata` 와 렌더가 각자 배열을 만들면 같은 요청에서 계산이 두 번 돈다.
 *    여기서 문자열로 눌러 두면 그 일이 구조적으로 일어나지 않는다.
 */
export function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw
}

/**
 * 글이 `total` 건일 때 마지막 페이지 번호.
 *
 * 🔴 글이 0건이어도 1이다. 게시판은 존재하고 "아직 글이 없습니다" 는 정상 화면이다.
 */
export function lastPageOf(total: number, pageSize: number = BOARD_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/**
 * 요청된 페이지가 **없는 범위**인지 — true 면 호출부가 `notFound()` 를 던진다.
 *
 * 🔴 빈 페이지를 200 으로 주지 않는다. 우나어 `/best` 실측(2026-09-21):
 *    `?page=50`(총 6페이지)이 200 + 빈 목록을 돌려줬고, 그 화면의 "이전" 은
 *    page=49 라는 또 다른 빈 페이지로 갔다. 사용자에게는 막다른 골목이고
 *    수집기에게는 끝없이 이어지는 soft-404 다.
 *
 * 🔴 글이 하나도 없는 게시판의 1페이지는 404 가 아니다 — `lastPageOf` 가 하한을 1로 잡는다.
 */
export function isPageOutOfRange(
  page: number,
  total: number,
  pageSize: number = BOARD_PAGE_SIZE,
): boolean {
  return page > lastPageOf(total, pageSize)
}

/**
 * 쪽을 옮겨도 따라가야 하는 축. **기본값인 축은 `undefined` 로 준다** — 주소에서 빠진다.
 *
 * 🔴 값이 전부 문자열이다. 쪽 이동 UI 는 client 이고 이 값은 서버에서 넘어간다 —
 *    함수나 클래스 인스턴스를 넘길 수 없다. 문자열 지도면 그 제약을 타입이 지킨다.
 */
export type ListKeepParams = Record<string, string | undefined>

/**
 * 목록 주소를 만든다. **모든 목록 화면이 이 함수 하나를 거친다.**
 *
 * 🔴 기본값은 주소에 남기지 않는다.
 *      1쪽          → `/community/free`          (`?page=1` 을 붙이지 않는다)
 *      최신순       → `/community/free`          (`?sort=latest` 를 붙이지 않는다)
 *      전체 분류    → `/magazine`                (`?cluster=all` 을 붙이지 않는다)
 *
 *    우나어는 "맨앞" 링크가 `?page=1` 이라 같은 내용에 주소가 둘이었다(2026-09-21 실측).
 *    그 화면의 canonical 은 `?page=1` 쪽을 정본에서 빼 주지만, 링크를 주고받는
 *    사람에게는 여전히 두 주소다.
 *
 * 🔴 유지 축을 page 보다 **앞**에 둔다. 축만 걸린 주소와 거기에 쪽이 붙은 주소가
 *    같은 접두를 가져, 주소만 보고도 같은 목록임을 안다.
 */
export function buildListHref(
  basePath: string,
  { page = 1, keep = {} }: { page?: number; keep?: ListKeepParams } = {},
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(keep)) {
    if (value != null && value !== '') params.set(key, value)
  }
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `${basePath}?${query}` : basePath
}

/**
 * 게시판에서 쪽을 옮겨도 따라가는 축 — 정렬 하나다.
 *
 * 🔴 "최신순은 주소에 남기지 않는다" 는 판단이 여기 한 곳에 있다.
 *    쪽 링크(Pagination)와 정렬 탭과 canonical 이 전부 이것을 부른다.
 *    호출부마다 `sort === 'latest' ? undefined : sort` 를 적으면 언젠가 한 곳이 어긋난다.
 */
export function boardListKeep(sort: BoardSort): ListKeepParams {
  return { sort: sort === 'latest' ? undefined : sort }
}

export function buildBoardListHref(
  basePath: string,
  { page = 1, sort = 'latest' }: { page?: number; sort?: BoardSort } = {},
): string {
  return buildListHref(basePath, { page, keep: boardListKeep(sort) })
}

/**
 * 분류를 고르지 않은 상태.
 *
 * 🔴 문자열 `'all'` 이다. `MagazineCluster` 유니온에 섞지 않는다 —
 *    그쪽은 "실제 분류" 의 목록이고, 여기는 "고르지 않음" 이라는 다른 종류의 값이다.
 */
export const MAGAZINE_ALL_CLUSTER = 'all'

/**
 * 매거진에서 쪽을 옮겨도 따라가는 축 — 분류 하나다.
 *
 * 🔴 `boardListKeep` 과 같은 이유로 여기 한 곳에 둔다.
 *    분류 칩·쪽 링크·canonical 이 같은 규칙을 봐야 한다.
 */
export function magazineListKeep(cluster: string = MAGAZINE_ALL_CLUSTER): ListKeepParams {
  return { cluster: cluster === MAGAZINE_ALL_CLUSTER ? undefined : cluster }
}

export function buildMagazineListHref(
  basePath: string,
  { page = 1, cluster = MAGAZINE_ALL_CLUSTER }: { page?: number; cluster?: string } = {},
): string {
  return buildListHref(basePath, { page, keep: magazineListKeep(cluster) })
}

/* ────────────────────────────────────────────────────────────────
 * 🔴 offset 페이지네이션의 한계 — 알고 쓴다.
 *
 * 조회는 `skip/take` 다. 정렬 마지막에 `{ id: 'desc' }` 를 두어 **같은 데이터 상태
 * 안에서는** 순서가 하나로 정해진다. `createdAt` 이 같은 글이 여럿이어도
 * (하루 100건 일괄 발행이면 실제로 생긴다) 페이지 경계에서 글이 겹치거나
 * 빠지지 않는다.
 *
 * 그러나 **1페이지를 읽고 2페이지로 넘기는 사이에 새 글이 들어오면** 경계의 글이
 * 한 칸씩 밀려 같은 글을 두 번 보거나 한 건을 건너뛴다. tie-breaker 는 이것을
 * 막지 못한다 — 데이터 상태 자체가 달라진 것이라 정렬 규칙의 문제가 아니다.
 * cursor 방식으로 바꿔야 풀리고, 그때는 "N페이지로 바로 가기" 를 잃는다.
 *
 * 지금은 **페이지 번호로 바로 가는 것**이 더 중요해 offset 을 쓴다.
 * 테스트가 보장하는 것도 딱 여기까지다 — 그 이상으로 적지 않는다.
 * ──────────────────────────────────────────────────────────────── */
