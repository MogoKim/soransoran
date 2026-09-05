#!/usr/bin/env tsx
/**
 * 자동 상세 fetch fixture — 🔴 **네트워크 없이 판정을 검사한다**
 *
 * 🔴 이 fixture 가 막는 사고
 *    ① 스위치 하나로 live 가 열리는 것 (두 개여야 한다)
 *    ② HTTP 200 을 성공으로 오인하는 것 (title 폴백·dialog 가 우선이다)
 *    ③ 읽지 못한 글이 Drop·Hold 로 뭉개지는 것
 *    ④ 위험한 글이 "짧다" 는 이유로 Short Raw Noindex 가 되는 것
 *    ⑤ 같은 글을 두 번 여는 것
 *    ⑥ 산출물이 .microseed-data/ 밖으로 나가는 것
 *    ⑦ DB·Sheet·LLM·발행이 들어오는 것
 */
import { readFileSync } from 'node:fs'
import {
  classifyAccess, classifyDetail, measureLength, AXIS_LABEL,
  SHORT_RAW_MAX, RAW_MIN_BODY, type DetailAxis,
} from './lib/micro-seed-detail-classify.mjs'
import { TSV_COLUMNS, ALLOWED_CAPS, DEFAULT_CAP, PACE_MIN_MS, PACE_MAX_MS, DETAIL_KILL_SWITCH_ENV } from './micro-seed-detail-fetch.mjs'

const FETCH = readFileSync('scripts/micro-seed-detail-fetch.mts', 'utf-8')
const CLS = readFileSync('scripts/lib/micro-seed-detail-classify.mts', 'utf-8')
const codeOf = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const FETCH_CODE = codeOf(FETCH)
const CLS_CODE = codeOf(CLS)

let pass = 0
let fail = 0
const check = (l: string, ok: boolean, why = ''): void => {
  if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${why ? ` — ${why}` : ''}`) }
}
const D = (o: Partial<Parameters<typeof classifyDetail>[0]>) => classifyDetail({
  title: '제목', body: '', comments: [], imageCount: 0, access: 'ok', ...o,
} as Parameters<typeof classifyDetail>[0])

console.log('\n자동 상세 fetch fixture')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① Access — 🔴 HTTP 200 만으로 성공을 판정하지 않는다')
check('🔴 dialog "삭제" → deletedOrExpired',
  classifyAccess({ httpStatus: 200, dialogMessage: '삭제되었거나 존재하지 않는 게시글입니다.' }) === 'deletedOrExpired')
check('🔴 title 폴백 → deletedOrExpired (HTTP 200 이어도)',
  classifyAccess({ httpStatus: 200, titleFallback: true, articleFrame: true, bodyFound: true }) === 'deletedOrExpired')
check('🔴 권한 안내 → permissionDenied',
  classifyAccess({ httpStatus: 200, permissionNotice: true }) === 'permissionDenied')
check('🔴 ca-fe 프레임 미도달 → renderFailed',
  classifyAccess({ httpStatus: 200, titleFallback: false, articleFrame: false }) === 'renderFailed')
check('🔴 프레임은 있는데 본문 못 찾음 → selectorFailed',
  classifyAccess({ httpStatus: 200, titleFallback: false, articleFrame: true, bodyFound: false }) === 'selectorFailed')
check('🟢 전부 정상 → ok',
  classifyAccess({ httpStatus: 200, titleFallback: false, articleFrame: true, bodyFound: true }) === 'ok')

console.log('\n② 읽지 못한 것은 판정이 아니다')
for (const a of ['deletedOrExpired', 'permissionDenied', 'renderFailed', 'selectorFailed'] as const) {
  const v = D({ access: a, body: '아주 긴 본문'.repeat(50) })
  check(`⚫ ${a} → access 축`, v.axis === 'access', `실제 ${v.axis}`)
  check(`   Drop·Hold 로 뭉개지 않는다`, v.axis !== 'drop' && v.axis !== 'hold')
}

console.log('\n③ 위험은 길이보다 먼저다 — 짧다고 통과시키지 않는다')
check('🔴 정치 + 30자 → drop (Short Raw 아님)',
  D({ title: '대선 후보 토론 보셨어요', body: '어떻게 보셨나요 궁금해요' }).axis === 'drop')
check('🔴 의료 단정 + 40자 → hold (Short Raw 아님)',
  D({ title: '도수치료 어떤가요', body: '도수치료 받아볼까 고민중이에요 추천 부탁' }).axis === 'hold')
check('🔴 이미지 의존 + 짧은 본문 → drop',
  D({ title: '이 글씨체 뭔지 아는 분', body: '이거 뭐죠', imageCount: 2 }).axis === 'drop')

console.log('\n④ 100자 미만 → Short Raw Noindex **후보**')
{
  const v = D({ title: '전기세 얼마 나와요', body: '40만원 넘은거 실환가요 에어컨 거실만 트는데' })
  check(`🟡 ${v.measuredLength}자 → shortRawNoindex`, v.axis === 'shortRawNoindex', `실제 ${v.axis}`)
  check('🔴 발행 전 사람 확인이 필요하다고 적는다', v.reason.includes('발행 전 사람 확인'))
  check(`🔴 기준값이 ${SHORT_RAW_MAX} 이다`, SHORT_RAW_MAX === 100)
  check('🟢 길이 기준을 기록한다', v.lengthBasis === 'body')
  const t = D({ title: '전기세 얼마 나와요', body: '40만원 넘은거 실환가요 에어컨 거실만 트는데', lengthBasis: 'titleBody' })
  check('🟡 titleBody 기준이면 길이가 더 크다', t.measuredLength > v.measuredLength)
  check('🔴 어느 기준으로 쟀는지 남는다', t.lengthBasis === 'titleBody')
}
check('🔴 띄어쓰기를 포함해 센다', measureLength('', 'a b c', 'body') === 5)
check('🔴 제목+본문 기준은 둘을 합친다', measureLength('가나', '다라', 'titleBody') === 5)

console.log('\n⑤ 400자 이상 + 사연 축 → Raw Originality')
{
  // 🔴 축은 **제목**에서 본다 (목록 단계 신호와 같은 기준). '시어머니' 는 어휘에 없다 — '남편' 을 쓴다
  const long = '남편이 서운하다고 해서 며칠째 답답합니다 '.repeat(20)
  const v = D({ title: '남편 때문에 답답해요', body: long, boardName: '쫑알쫑알' })
  check(`🔵 ${v.measuredLength}자 + 축 → rawOriginality`, v.axis === 'rawOriginality', `실제 ${v.axis} · 축 ${v.assetAxes.join('/')}`)
  check(`🔴 기준값이 ${RAW_MIN_BODY} 이다`, RAW_MIN_BODY === 400)
  const noAxis = D({ title: '오늘 날씨 얘기', body: '가나다라마바사 '.repeat(60) })
  check('🟢 400자여도 사연 축이 없으면 seedOriginality', noAxis.axis === 'seedOriginality', `실제 ${noAxis.axis}`)
}

console.log('\n⑥ 나머지는 Seed Originality')
check('🟢 100~399자 → seedOriginality',
  D({ title: '영어학원 어학원이 나을까요', body: '초2 둘째가 지금 일반영어학원 다니는중인데 '.repeat(6) }).axis === 'seedOriginality')

console.log('\n⑦ 6축이 전부 있다')
for (const a of ['shortRawNoindex', 'seedOriginality', 'rawOriginality', 'hold', 'drop', 'access'] as DetailAxis[]) {
  check(`🟢 축 ${AXIS_LABEL[a]}`, typeof AXIS_LABEL[a] === 'string' && AXIS_LABEL[a].length > 0)
}

console.log('\n⑧ cap · pacing · runId · kill switch')
check(`🔴 기본 cap 이 ${DEFAULT_CAP} 이다`, DEFAULT_CAP === 10)
check('🔴 cap 은 10 또는 20 만 허용', JSON.stringify([...ALLOWED_CAPS]) === JSON.stringify([10, 20]))
check('🔴 허용 밖 cap 은 거부한다', /ALLOWED_CAPS\.includes\(CAP\)/.test(FETCH_CODE))
check(`🔴 pacing ${PACE_MIN_MS}~${PACE_MAX_MS}ms`, PACE_MIN_MS === 2500 && PACE_MAX_MS === 4500)
check('🔴 pacing 을 실제로 기다린다', /setTimeout\(r, PACE_MIN_MS \+ Math\.random\(\)/.test(FETCH_CODE))
check('🔴 runId 를 기록한다', /runId/.test(FETCH_CODE) && TSV_COLUMNS.includes('runId'))
check('🔴 상세 전용 kill switch 를 쓴다', DETAIL_KILL_SWITCH_ENV === 'SORAN_NAVERCAFE_DETAIL_ENABLED')
check('🔴 목록 수집기 스위치와 **다르다**',
  (DETAIL_KILL_SWITCH_ENV as string) !== 'SORAN_NAVERCAFE_COLLECT_ENABLED')
check('🔴 --live 와 스위치가 **둘 다** 있어야 연다', /if \(!LIVE \|\| !switchOn\)/.test(FETCH_CODE))
// 🔴 import 줄이 아니라 **호출 위치**를 본다 — import 는 파일 맨 위에 있다
check('🔴 계획 모드에서 산출물을 쓰지 않는다 (write 호출이 가드 뒤에 있다)',
  FETCH_CODE.indexOf('writeFileSync(jsonlPath') > FETCH_CODE.indexOf('if (!LIVE || !switchOn)'))

console.log('\n⑨ 같은 글을 두 번 열지 않는다')
check('🔴 이전 산출물의 articleId 를 읽는다', /seenArticleIds/.test(FETCH_CODE))
check('🔴 대상 선정에서 제외한다', /!seen\.has\(s\.row\.sourceArticleId\)/.test(FETCH_CODE))
check('🔴 needsDetail 만 연다', /verdictOf\(s\)\.verdict === 'needsDetail'/.test(FETCH_CODE))

console.log('\n⑩ 산출물은 .microseed-data/ 아래 JSONL · TSV 뿐이다')
check('🔴 경로 밖이면 거부한다', /rel\.startsWith\('\.microseed-data\/'\)/.test(FETCH_CODE))
check('🔴 JSONL 과 TSV 만 쓴다',
  /\.detail\.jsonl/.test(FETCH_CODE) && /\.detail\.tsv/.test(FETCH_CODE))
check('🟢 TSV 컬럼 17개', TSV_COLUMNS.length === 17, String(TSV_COLUMNS.length))
check('🟢 축·접근·길이 기준이 컬럼에 있다',
  ['axis', 'access', 'bodyLength', 'lengthBasis', 'safetyVerdict'].every((c) => TSV_COLUMNS.includes(c)))

console.log('\n⑪ 하지 않는 것 — DB · Sheet · LLM · 발행 · 목록 scout')
for (const [re, label] of [
  [/PrismaClient|@prisma\/client/, 'Prisma'],
  [/googleapis|google-spreadsheet|sheets\./, 'Google Sheet'],
  [/anthropic|openai|claude-|gpt-/i, 'LLM'],
  // 🔴 출력 문구("noindex 배포 0")와 정당한 식별자(loadScoutRows)를 잡지 않도록
  //    **실제 호출·엔드포인트**만 본다 — 이 저장소에서 반복한 실수다
  [/\.publish\(|publishTo|deployTo|publishPost/i, '발행·배포 호출'],
  [/boardListUrl|ArticleList\.nhn|collectNaverCafe/i, '목록 scout 호출'],
] as const) {
  check(`🔴 fetch 에 ${label} 없음`, !re.test(FETCH_CODE))
  check(`🔴 classify 에 ${label} 없음`, !re.test(CLS_CODE))
}
check('🔴 classify 는 네트워크를 모른다',
  !/playwright|chromium|fetch\(|axios|page\.|browser/.test(CLS_CODE))
check('🔴 classify 는 파일을 쓰지 않는다', !/writeFileSync|readFileSync/.test(CLS_CODE))
check('🔴 import 만으로 브라우저를 열지 않는다', /if \(isDirectRun\) void main\(\)/.test(FETCH_CODE))
check('🔴 evaluate 콜백에 이름 붙은 함수가 없다 (__name 사고)',
  !/frame\.evaluate\(\(\) => \{[\s\S]{0,200}const \w+ = \(/.test(FETCH_CODE))

console.log(`\n${'─'.repeat(57)}`)
if (fail > 0) { console.log(`\n❌ ${fail}건 실패 · ${pass}건 통과\n`); process.exit(1) }
console.log(`\n✅ 전부 통과 (${pass}건) — 읽고 분류만 한다. 발행하지 않는다.\n`)
