#!/usr/bin/env tsx
/**
 * 목록 쪽 이동 규칙 회귀 테스트 — **게시판과 매거진 둘 다**.
 *
 * 🔴 DB 를 켜지 않는다. list-query 는 import 가 하나도 없는 순수 모듈이고,
 *    매거진은 파일 기반이라 표본 없이 실제 콘텐츠로 확인된다.
 *    켜야 확인되는 테스트는 아무도 돌리지 않는다.
 *
 * 🔴 규칙을 여기에 다시 적지 않는다 — 원본을 그대로 import 한다.
 *    복사본은 반드시 원본과 어긋난다. 매거진 기대값도 상수로 박지 않고
 *    **공개 관문이 돌려준 실제 글 수에서 계산**한다 — 글이 늘어도 이 파일은 그대로다.
 *
 * 이 테스트가 지키는 것
 *   ① 양의 정수 문자열만 정상값이다 — 0 · 음수 · 글자 · 소수 · 공백 · 빈값은 전부 1쪽
 *   ② 자릿수가 터무니없이 긴 값도 안전 정수로 눌려 404 로 간다 (500 이 아니다)
 *   ③ 글이 0건인 목록의 1쪽은 **없는 쪽이 아니다** (빈 목록은 정상 화면)
 *   ④ 마지막 쪽은 200, 그 다음 쪽부터 404
 *   ⑤ 기본값(1쪽 · 최신순 · 전체 분류)은 주소에 남지 않는다
 *   ⑥ 쪽을 옮겨도 유지 축이 따라가고, 유지 축을 바꾸면 쪽이 떨어진다
 *   ⑦ 쪽 이동 nav 안의 aria-current="page" 가 정확히 하나다 (소스 가드)
 *   ⑧ 매거진: 분류별 total 과 slice 가 일치하고, 전 쪽 slug 합집합 = 공개 글 전체 · 중복 0
 *   ⑨ 매거진: DRAFT · BLOCKED · 예약 글이 목록에도 total 에도 들어오지 않는다
 *
 * 🔴 **이 테스트가 보장하지 않는 것**
 *    ⑴ 쪽을 넘기는 사이에 새 글이 들어오는 경우의 중복·누락. offset 방식의 구조적
 *       성질이라 순수 함수로 확인할 수 있는 종류가 아니다
 *       (근거와 범위는 src/lib/list-query.ts 끝 주석에 적혀 있다).
 *       매거진은 파일 기반이라 배포 사이에 글이 늘지 않아 이 위험이 게시판보다 작다.
 *    ⑵ ⑦ 은 렌더된 DOM 이 아니라 **파일에 적힌 개수**다. 이 저장소에는 컴포넌트를
 *       렌더할 테스트 장치가 없다. DOM 개수는 브라우저 실측으로 따로 본다.
 *
 * 사용법: npm run check:pagination
 * 종료 코드: FAIL 이 있으면 1
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import {
  BOARD_PAGE_SIZE,
  buildBoardListHref,
  buildMagazineListHref,
  firstParam,
  isPageOutOfRange,
  lastPageOf,
  MAGAZINE_PAGE_SIZE,
  parseBoardSort,
  parsePageParam,
} from '../src/lib/list-query'
import {
  getAllMagazineArticles,
  getMagazineListState,
  isPublicMagazineArticle,
  resolveMagazineList,
} from '../src/lib/magazine'
import { MAGAZINE_ARTICLES } from '../src/content/magazine/articles'
import type { MagazineArticle, MagazineCluster } from '../src/content/magazine/types'

let pass = 0
let fail = 0
function expect(label: string, actual: unknown, want: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(
    `  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`,
  )
  ok ? (pass += 1) : (fail += 1)
}

const BOARD = '/community/free'

console.log('\n══════ 쪽 크기')
expect('일반 게시판은 12건', BOARD_PAGE_SIZE, 12)

console.log('\n══════ page 파싱 — 양의 정수 문자열만 정상값, 나머지는 전부 1쪽')
expect('정상값은 그대로', parsePageParam('7'), 7)
expect('여러 자리도 그대로', parsePageParam('999999'), 999999)
expect('없으면 1', parsePageParam(undefined), 1)
expect('빈 문자열은 1', parsePageParam(''), 1)
expect('공백만 있으면 1', parsePageParam('   '), 1)
expect('0 은 1', parsePageParam('0'), 1)
expect('0 여러 개도 1', parsePageParam('000'), 1)
expect('음수는 1', parsePageParam('-3'), 1)
expect('글자는 1', parsePageParam('abc'), 1)
// 🔴 parseInt 를 쓰면 여기서 3 · 7 이 나온다. 적힌 것과 다른 화면을 추측해 열지 않는다.
expect('소수 3.9 는 3 이 아니라 1', parsePageParam('3.9'), 1)
expect('소수 1.7 은 1', parsePageParam('1.7'), 1)
expect('숫자 뒤 글자 7abc 는 7 이 아니라 1', parsePageParam('7abc'), 1)
expect('앞뒤 공백 " 7 " 도 1 — 양의 정수 문자열이 아니다', parsePageParam(' 7 '), 1)
expect('더하기 기호 +7 도 1', parsePageParam('+7'), 1)
expect('전각 숫자도 1', parsePageParam('７'), 1)
expect('같은 키가 둘이면 첫 값', parsePageParam(['2', '5']), 2)
expect('같은 키 첫 값이 이상하면 1', parsePageParam(['abc', '5']), 1)
expect('빈 배열은 1', parsePageParam([]), 1)

console.log('\n══════ 자릿수가 터무니없이 긴 값 — 500 이 아니라 404 로 가야 한다')
// 🔴 반례: 형식은 멀쩡한 양의 정수라 파서를 통과한다. 그대로 흘려보내면
//    Number 가 1e+24 라는 부동소수가 되어 주소가 깨지고 Prisma skip 에서 터진다.
const HUGE = '999999999999999999999999'
expect('안전 정수로 눌린다', parsePageParam(HUGE), Number.MAX_SAFE_INTEGER)
expect('안전 정수다', Number.isSafeInteger(parsePageParam(HUGE)), true)
expect('어떤 total 보다도 커서 범위 밖이다', isPageOutOfRange(parsePageParam(HUGE), 1_000_000), true)
expect(
  '주소로 되돌려도 지수 표기가 나오지 않는다',
  buildBoardListHref(BOARD, { page: parsePageParam(HUGE) }),
  `${BOARD}?page=9007199254740991`,
)
expect(
  '되돌린 주소를 다시 읽어도 안전 정수 그대로',
  parsePageParam('9007199254740991'),
  Number.MAX_SAFE_INTEGER,
)

console.log('\n══════ sort 파싱 — 모르는 값은 최신순')
expect('없으면 latest', parseBoardSort(undefined), 'latest')
expect('views 는 그대로', parseBoardSort('views'), 'views')
expect('모르는 값은 latest', parseBoardSort('likes'), 'latest')
expect('대문자는 모르는 값', parseBoardSort('VIEWS'), 'latest')

console.log('\n══════ 마지막 쪽')
expect('0건이어도 1쪽은 있다', lastPageOf(0), 1)
expect('1건이면 1쪽', lastPageOf(1), 1)
expect('딱 한 쪽(12건)', lastPageOf(BOARD_PAGE_SIZE), 1)
expect('한 건 더 넘으면 2쪽', lastPageOf(BOARD_PAGE_SIZE + 1), 2)
expect('93건이면 8쪽', lastPageOf(93), 8)
expect('96건(12의 배수)이면 8쪽 — 빈 9쪽을 만들지 않는다', lastPageOf(96), 8)

console.log('\n══════ 범위 초과 → 404')
expect('글 0건 게시판의 1쪽은 404 가 아니다', isPageOutOfRange(1, 0), false)
expect('글 0건 게시판의 2쪽은 404', isPageOutOfRange(2, 0), true)
expect('12건일 때 1쪽 정상', isPageOutOfRange(1, BOARD_PAGE_SIZE), false)
expect('12건일 때 2쪽은 404', isPageOutOfRange(2, BOARD_PAGE_SIZE), true)
expect('93건일 때 마지막 8쪽 정상', isPageOutOfRange(8, 93), false)
expect('93건일 때 9쪽은 404', isPageOutOfRange(9, 93), true)
expect('아주 큰 쪽은 404 — 우나어 /best?page=50 같은 빈 화면을 막는다', isPageOutOfRange(50, 93), true)

console.log('\n══════ 주소 만들기 — 기본값은 주소에 남지 않는다')
expect('1쪽 · 최신순은 맨 주소', buildBoardListHref(BOARD), BOARD)
expect('인자를 줘도 기본값이면 맨 주소', buildBoardListHref(BOARD, { page: 1, sort: 'latest' }), BOARD)
expect('page=1 을 붙이지 않는다', buildBoardListHref(BOARD, { page: 1 }), BOARD)
expect('2쪽', buildBoardListHref(BOARD, { page: 2 }), `${BOARD}?page=2`)
expect('조회순 1쪽', buildBoardListHref(BOARD, { sort: 'views' }), `${BOARD}?sort=views`)
expect(
  '쪽을 옮겨도 정렬이 따라간다',
  buildBoardListHref(BOARD, { page: 3, sort: 'views' }),
  `${BOARD}?sort=views&page=3`,
)
expect(
  '정렬을 바꾸면 쪽이 떨어진다 (page 를 넘기지 않는 것이 그 방법이다)',
  buildBoardListHref(BOARD, { sort: 'views' }),
  `${BOARD}?sort=views`,
)
expect('갱년기톡도 같은 규칙', buildBoardListHref('/community/menopause', { page: 2 }), '/community/menopause?page=2')

console.log('\n══════ 파싱과 주소가 서로를 되돌린다')
for (const [page, sort] of [[1, 'latest'], [2, 'latest'], [1, 'views'], [5, 'views']] as const) {
  const href = buildBoardListHref(BOARD, { page, sort })
  const query = new URLSearchParams(href.split('?')[1] ?? '')
  expect(
    `${href} → page ${page} · sort ${sort}`,
    [parsePageParam(query.get('page') ?? undefined), parseBoardSort(query.get('sort') ?? undefined)],
    [page, sort],
  )
}

/* ══════════════════════════════════════════════════════════════════
 * 매거진
 *
 * 🔴 기대값을 숫자로 박지 않는다. 공개 글이 34건이라 12/12/10 이라는 것은
 *    오늘의 사실이지 규칙이 아니다. 글이 늘면 이 파일이 아니라 화면이 따라가야 한다.
 *    그래서 **관문이 돌려준 실제 개수에서 기대값을 만든다.**
 * ══════════════════════════════════════════════════════════════════ */
console.log('\n══════ 매거진 — 쪽 크기와 경계')
const MAGAZINE = '/magazine'
const allMagazine = getAllMagazineArticles()
const magazineTotal = allMagazine.length
const magazineLastPage = lastPageOf(magazineTotal, MAGAZINE_PAGE_SIZE)

expect('매거진은 한 쪽에 12건', MAGAZINE_PAGE_SIZE, 12)
expect('공개 글이 있다 (없으면 아래 검사가 전부 무의미해진다)', magazineTotal > 0, true)
console.log(`  · 지금 공개 글 ${magazineTotal}건 → ${magazineLastPage}쪽`)

for (let page = 1; page <= magazineLastPage; page += 1) {
  const { articles, total } = getMagazineListState(undefined, page)
  const expected = Math.min(MAGAZINE_PAGE_SIZE, magazineTotal - (page - 1) * MAGAZINE_PAGE_SIZE)
  expect(`${page}쪽 글 수 = ${expected}`, articles.length, expected)
  expect(`${page}쪽 total 은 전체 개수와 같다`, total, magazineTotal)
  expect(`${page}쪽은 범위 안이다`, isPageOutOfRange(page, total, MAGAZINE_PAGE_SIZE), false)
}
expect(
  `마지막 다음 쪽(${magazineLastPage + 1})은 범위 밖 — 404`,
  isPageOutOfRange(magazineLastPage + 1, magazineTotal, MAGAZINE_PAGE_SIZE),
  true,
)
expect(
  '범위 밖이면 자르지 않고 빈 배열',
  getMagazineListState(undefined, magazineLastPage + 1).articles.length,
  0,
)

console.log('\n══════ 매거진 — 전 쪽 합집합 = 공개 글 전체 · 중복 0')
const collected: string[] = []
for (let page = 1; page <= magazineLastPage; page += 1) {
  collected.push(...getMagazineListState(undefined, page).articles.map((a) => a.slug))
}
expect('모은 개수 = 공개 글 수', collected.length, magazineTotal)
expect('고유 개수 = 공개 글 수 (중복 0)', new Set(collected).size, magazineTotal)
expect(
  'slug 집합이 공개 글 집합과 정확히 같다 (누락 0)',
  [...new Set(collected)].sort().join(','),
  allMagazine.map((a) => a.slug).sort().join(','),
)

console.log('\n══════ 매거진 — 공개 관문이 total 과 목록 양쪽에 걸린다')
const hidden = MAGAZINE_ARTICLES.filter((a) => !isPublicMagazineArticle(a))
console.log(`  · 지금 비공개(DRAFT·BLOCKED·예약) ${hidden.length}건`)
expect(
  '비공개 글이 total 에 섞이지 않는다',
  magazineTotal,
  MAGAZINE_ARTICLES.length - hidden.length,
)
expect(
  '비공개 slug 가 어느 쪽에도 없다',
  hidden.filter((a) => collected.includes(a.slug)).map((a) => a.slug),
  [],
)

console.log('\n══════ 매거진 — 분류별 total 과 slice 가 일치한다 (실제 콘텐츠)')
const magazineClusters = getMagazineListState(undefined, 1).clusters
expect('칩으로 세울 분류가 있다', magazineClusters.length > 0, true)
for (const cluster of magazineClusters) {
  const inCluster = allMagazine.filter((a) => a.cluster === cluster)
  const { total } = getMagazineListState(cluster, 1)
  expect(`[${cluster}] total = 실제 글 수 ${inCluster.length}`, total, inCluster.length)

  const last = lastPageOf(total, MAGAZINE_PAGE_SIZE)
  const slugs: string[] = []
  for (let page = 1; page <= last; page += 1) {
    slugs.push(...getMagazineListState(cluster, page).articles.map((a) => a.slug))
  }
  expect(
    `[${cluster}] 전 쪽 합집합 = 그 분류 글 전체`,
    slugs.sort().join(','),
    inCluster.map((a) => a.slug).sort().join(','),
  )
  expect(
    `[${cluster}] 마지막 다음 쪽은 404`,
    isPageOutOfRange(last + 1, total, MAGAZINE_PAGE_SIZE),
    true,
  )
}

/* ══════════════════════════════════════════════════════════════════
 * 합성 표본 — 분류가 두 쪽이 되는 경우
 *
 * 🔴 **실제 콘텐츠로는 이 경로가 열리지 않는다.** 지금 가장 많은 분류가 9건이라
 *    `cluster + page=2` 가 한 번도 계산되지 않는다. 검사가 닿지 않는 곳에
 *    쪽 나누기의 핵심 경계가 있는 셈이다.
 *
 * 🔴 그렇다고 검사를 위해 **콘텐츠를 늘리지 않는다.** 실제 발행물은 독자가 읽는 것이고
 *    시험 표본이 아니다. `resolveMagazineList` 가 글 배열을 인자로 받는 이유가 이것이다 —
 *    같은 계산에 다른 표본을 넣는다.
 *
 * 🔴 표본은 **실재하는 `MagazineCluster` 값**을 쓴다. `'__no-such-cluster__'` 같은
 *    가짜 문자열로는 "타입에는 있지만 공개 글이 0건인 분류" 를 검사할 수 없다 —
 *    그건 그냥 모르는 문자열이라 이미 다른 반례가 덮는다.
 * ══════════════════════════════════════════════════════════════════ */
console.log('\n══════ 매거진 — 합성 표본으로 분류 2쪽 검사')

const FIXTURE_CLUSTER: MagazineCluster = 'sleep'
/** 표본에 **일부러 넣지 않은** 실재 분류. "유효하지만 공개 글 0건" 반례용이다. */
const ABSENT_CLUSTER: MagazineCluster = 'clinic'

/**
 * 표본 글 하나 만들기.
 *
 * 🔴 **실제 공개 글을 본으로 삼아 필요한 필드만 덮어쓴다.** 빈 객체를
 *    `as MagazineArticle` 로 우기면 타입이 통과할 뿐 실제 글이 못 하는 일을
 *    표본이 할 수 있게 된다 — 그런 표본으로 통과한 시험은 결함을 덮는다.
 *    본을 쓰면 필수 필드가 전부 채워진 채로 시작하고, 강제 단언도 필요 없다.
 */
const fixtureTemplate = allMagazine[0]
if (!fixtureTemplate) {
  console.error('🔴 공개 글이 0건이라 표본을 만들 수 없다 — 검사 중단')
  process.exit(1)
}
const fixtureArticle = (slug: string, cluster: MagazineCluster): MagazineArticle => ({
  ...fixtureTemplate,
  slug,
  cluster,
  publishedAt: '2026-09-01',
  // 본에 남아 있으면 표본끼리 seriesOrder 로 얽힌다. 목록 계산과 무관하게 지운다.
  seriesId: undefined,
  seriesOrder: undefined,
})

const fixture: MagazineArticle[] = [
  ...Array.from({ length: 13 }, (_, i) => fixtureArticle(`sleep-${String(i + 1).padStart(2, '0')}`, FIXTURE_CLUSTER)),
  fixtureArticle('emotion-01', 'emotion'),
]
const resolveFixture = (cluster: string | undefined, page: number) =>
  resolveMagazineList(fixture, cluster, page)

expect('표본: 수면 13건 + 감정 1건', fixture.length, 14)
expect('칩은 표본에 있는 분류만', resolveFixture(undefined, 1).clusters.sort().join(','), 'emotion,sleep')

const fx1 = resolveFixture(FIXTURE_CLUSTER, 1)
const fx2 = resolveFixture(FIXTURE_CLUSTER, 2)
const fx3 = resolveFixture(FIXTURE_CLUSTER, 3)

expect('[반례1] 분류 total = 13', fx1.total, 13)
expect('[반례2] 분류 1쪽 = 12건', fx1.articles.length, 12)
expect('[반례3] 분류 2쪽 = 1건', fx2.articles.length, 1)
expect('2쪽 total 도 13 — 목록과 개수가 같은 조건을 본다', fx2.total, 13)

const fxSlugs = [...fx1.articles, ...fx2.articles].map((a) => a.slug)
expect('[반례4] 두 쪽 합집합 13건', fxSlugs.length, 13)
expect('[반례4] 중복 0건', new Set(fxSlugs).size, 13)
expect(
  '[반례4] 합집합이 그 분류 글 전체와 같다',
  [...fxSlugs].sort().join(','),
  fixture.filter((a) => a.cluster === FIXTURE_CLUSTER).map((a) => a.slug).sort().join(','),
)

expect('[반례5] 분류 3쪽은 범위 초과', isPageOutOfRange(3, fx3.total, MAGAZINE_PAGE_SIZE), true)
expect('[반례5] 범위 초과면 자르지 않는다', fx3.articles.length, 0)
expect('[반례5] 범위를 넘겨도 분류는 유지된다 (404 화면의 canonical 이 흔들리지 않게)', fx3.cluster, FIXTURE_CLUSTER)

expect(
  '[반례6] 분류 2쪽 주소',
  buildMagazineListHref(MAGAZINE, { cluster: FIXTURE_CLUSTER, page: 2 }),
  `${MAGAZINE}?cluster=sleep&page=2`,
)
expect(
  '[반례7] 분류를 바꾸면 기존 page 가 사라진다',
  buildMagazineListHref(MAGAZINE, { cluster: 'emotion' }),
  `${MAGAZINE}?cluster=emotion`,
)

// 🔴 [반례8] `clinic` 은 실재하는 MagazineCluster 다. 표본에 글이 0건이라 칩이 없고,
//    그 주소로 들어오면 고를 수 없는 것이 골라진 화면이 되므로 전체로 되돌린다.
expect('[반례8] 표본에 clinic 칩이 없다', resolveFixture(undefined, 1).clusters.includes(ABSENT_CLUSTER), false)
expect('[반례8] 유효한 분류라도 공개 글 0건이면 전체로 정규화', resolveFixture(ABSENT_CLUSTER, 1).cluster, 'all')
expect('[반례8] 그 화면은 전체 목록이다', resolveFixture(ABSENT_CLUSTER, 1).total, fixture.length)

console.log('\n══════ 매거진 — 분류 정규화 (실제 콘텐츠)')
expect('없으면 전체', getMagazineListState(undefined, 1).cluster, 'all')
expect('빈 문자열은 전체', getMagazineListState('', 1).cluster, 'all')
expect('실재하고 글이 있는 분류는 그대로', getMagazineListState(magazineClusters[0], 1).cluster, magazineClusters[0])
expect('모르는 문자열은 전체', getMagazineListState('nope', 1).cluster, 'all')
expect('대문자는 모르는 값', getMagazineListState('SLEEP', 1).cluster, 'all')

/* ══════════════════════════════════════════════════════════════════
 * 같은 키가 둘인 주소
 *
 * 🔴 배열을 눌러 첫 값만 쓰는 일은 **주소 해석의 첫 관문(`firstParam`)** 이 한다.
 *    목록 계산은 원시값만 받는다 — 배열이 그 안까지 들어가면 호출부의 React `cache`
 *    키가 매번 달라져 같은 요청에서 공개 글을 두 번 고르게 된다.
 *    그래서 여기서도 실제 화면과 같은 순서로 검사한다: firstParam → 계산.
 * ══════════════════════════════════════════════════════════════════ */
console.log('\n══════ 같은 키가 둘인 주소 — 첫 값만 쓴다')
expect('firstParam: 배열이면 첫 값', firstParam(['sleep', 'emotion']), 'sleep')
expect('firstParam: 문자열은 그대로', firstParam('sleep'), 'sleep')
expect('firstParam: 없으면 undefined', firstParam(undefined), undefined)
expect('firstParam: 빈 배열이면 undefined', firstParam([]), undefined)
expect(
  '?cluster=<첫분류>&cluster=nope → 첫 값이 고른 분류가 된다',
  getMagazineListState(firstParam([magazineClusters[0], 'nope']), 1).cluster,
  magazineClusters[0],
)
expect(
  '?page=2&page=5 → 2쪽',
  parsePageParam(['2', '5']),
  2,
)
expect(
  '?cluster=<첫분류>&cluster=nope&page=2&page=5 → 첫 값 둘이 함께 쓰인다',
  [
    getMagazineListState(firstParam([magazineClusters[0], 'nope']), parsePageParam(['2', '5'])).cluster,
    parsePageParam(['2', '5']),
  ],
  [magazineClusters[0], 2],
)
expect(
  '눌린 값은 원시값이다 — cache 키가 요청마다 흔들리지 않는다',
  typeof firstParam(['sleep', 'emotion']),
  'string',
)

console.log('\n══════ 매거진 — 주소 규칙')
expect('전체 1쪽은 맨 주소', buildMagazineListHref(MAGAZINE), MAGAZINE)
expect('page=1 을 붙이지 않는다', buildMagazineListHref(MAGAZINE, { page: 1 }), MAGAZINE)
expect('cluster=all 을 붙이지 않는다', buildMagazineListHref(MAGAZINE, { cluster: 'all' }), MAGAZINE)
expect(
  '기본값 둘 다 주면 맨 주소',
  buildMagazineListHref(MAGAZINE, { page: 1, cluster: 'all' }),
  MAGAZINE,
)
expect('전체 2쪽', buildMagazineListHref(MAGAZINE, { page: 2 }), `${MAGAZINE}?page=2`)
expect('분류 1쪽', buildMagazineListHref(MAGAZINE, { cluster: 'sleep' }), `${MAGAZINE}?cluster=sleep`)
expect(
  '쪽을 옮겨도 분류가 따라간다',
  buildMagazineListHref(MAGAZINE, { page: 2, cluster: 'sleep' }),
  `${MAGAZINE}?cluster=sleep&page=2`,
)
expect(
  '분류를 바꾸면 쪽이 떨어진다 (page 를 넘기지 않는 것이 그 방법이다)',
  buildMagazineListHref(MAGAZINE, { cluster: 'emotion' }),
  `${MAGAZINE}?cluster=emotion`,
)
expect(
  '거대한 쪽도 지수 표기가 아니다',
  buildMagazineListHref(MAGAZINE, { page: parsePageParam('999999999999999999999999') }),
  `${MAGAZINE}?page=9007199254740991`,
)
expect(
  '거대한 쪽은 범위 밖 — 404 로 간다',
  isPageOutOfRange(parsePageParam('999999999999999999999999'), magazineTotal, MAGAZINE_PAGE_SIZE),
  true,
)
expect(
  '거대한 쪽에서도 자르지 않는다 (배열을 헛돌리지 않는다)',
  getMagazineListState(undefined, parsePageParam('999999999999999999999999')).articles.length,
  0,
)

console.log('\n══════ 매거진 — 주소를 읽고 다시 만들면 제자리')
for (const [page, cluster] of [
  [1, 'all'],
  [2, 'all'],
  [1, magazineClusters[0]],
  [2, magazineClusters[0]],
] as const) {
  const href = buildMagazineListHref(MAGAZINE, { page, cluster })
  const query = new URLSearchParams(href.split('?')[1] ?? '')
  expect(
    `${href} → page ${page} · cluster ${cluster}`,
    [
      parsePageParam(query.get('page') ?? undefined),
      getMagazineListState(query.get('cluster') ?? undefined, 1).cluster,
    ],
    [page, cluster],
  )
}

console.log('\n══════ aria-current — 쪽 이동 nav 안에 정확히 하나')
/**
 * 🔴 **문서 전체를 세지 않는다.** 상단 메뉴가 현재 게시판에, 정렬 탭이 현재 정렬에
 *    각자 표시를 다는 것은 정상이다 — 보조기술은 nav 묶음 단위로 읽는다.
 *    여기서 보는 것은 "쪽의 집합" 인 이 컴포넌트 안에서만 `page` 가 하나인지다.
 *
 * 🔴 **정규식으로 세지 않는다. 파서로 센다.**
 *    첫 판은 `/aria-current="page"/g` 로 셌는데 같은 파일 주석에 적힌 설명 문구까지
 *    함께 세어 2 가 나왔다. 주석을 고치면 통과하지만, 그건 가드를 코드에 맞춘 것이 아니라
 *    코드를 가드에 맞춘 것이다. `check-color-literals.mjs` 가 같은 판단을 했다 —
 *    파서는 주석을 애초에 노드로 주지 않는다.
 *
 * ⚠️ 그래도 이것은 **소스 가드**다. 렌더된 DOM 을 센 것이 아니다.
 *    이 저장소에는 컴포넌트를 렌더할 테스트 장치가 없다. DOM 개수는 브라우저로 따로 본다.
 */
const PAGINATION = 'src/components/features/Pagination.tsx'
const source = readFileSync(join(process.cwd(), PAGINATION), 'utf8')
const sourceFile = ts.createSourceFile(PAGINATION, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

/** JSX 속성으로 실제 쓰인 aria-current 만 모은다 — { 값, 붙은 태그 } */
function collectAriaCurrent(): Array<{ value: string; tag: string }> {
  const found: Array<{ value: string; tag: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'aria-current') {
      const init = node.initializer
      const owner = node.parent.parent // JsxAttributes → JsxOpeningElement | JsxSelfClosingElement
      found.push({
        value: init && ts.isStringLiteral(init) ? init.text : '(정적 문자열 아님)',
        tag:
          ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner)
            ? owner.tagName.getText(sourceFile)
            : '(알 수 없음)',
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

const ariaCurrents = collectAriaCurrent()
expect('aria-current 속성이 통째로 1개다', ariaCurrents.length, 1)
expect('그 값은 "page" 다 — 여기가 쪽의 집합이다', ariaCurrents[0]?.value, 'page')
expect('그것은 span 에 붙어 있다 — 지금 쪽은 링크가 아니다', ariaCurrents[0]?.tag, 'span')

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL\n`)
process.exit(fail === 0 ? 0 : 1)
