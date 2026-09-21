#!/usr/bin/env tsx
/**
 * 게시판 목록 쪽 이동 규칙 회귀 테스트.
 *
 * 🔴 DB 를 켜지 않는다. list-query 는 import 가 하나도 없는 순수 모듈이라
 *    표본만으로 확인된다. 켜야 확인되는 테스트는 아무도 돌리지 않는다.
 *
 * 🔴 규칙을 여기에 다시 적지 않는다 — 원본을 그대로 import 한다.
 *    복사본은 반드시 원본과 어긋난다.
 *
 * 이 테스트가 지키는 것
 *   ① 양의 정수 문자열만 정상값이다 — 0 · 음수 · 글자 · 소수 · 공백 · 빈값은 전부 1쪽
 *   ② 자릿수가 터무니없이 긴 값도 안전 정수로 눌려 404 로 간다 (500 이 아니다)
 *   ③ 글이 0건인 게시판의 1쪽은 **없는 쪽이 아니다** (빈 목록은 정상 화면)
 *   ④ 마지막 쪽은 200, 그 다음 쪽부터 404
 *   ⑤ 기본값(1쪽 · 최신순)은 주소에 남지 않는다 — 같은 화면에 주소가 둘이 되지 않게
 *   ⑥ 쪽을 옮겨도 정렬이 따라가고, 정렬을 바꾸면 쪽이 떨어진다
 *   ⑦ 쪽 이동 nav 안의 aria-current="page" 가 정확히 하나다 (소스 가드)
 *
 * 🔴 **이 테스트가 보장하지 않는 것**
 *    ⑴ 쪽을 넘기는 사이에 새 글이 들어오는 경우의 중복·누락. offset 방식의 구조적
 *       성질이라 순수 함수로 확인할 수 있는 종류가 아니다
 *       (근거와 범위는 src/lib/list-query.ts 끝 주석에 적혀 있다).
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
  isPageOutOfRange,
  lastPageOf,
  parseBoardSort,
  parsePageParam,
} from '../src/lib/list-query'

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
