#!/usr/bin/env tsx
/**
 * SRN 승인 화면 fixture — 🔴 **네트워크 없이 계약을 검사한다**
 *
 * 🔴 이 fixture 가 막는 사고
 *    ① 승인 화면에 SRN 아닌 축이 섞이는 것 (사람이 누르는 대상이 바뀐다)
 *    ② 읽지 못한 글·안전 필터에 걸린 글이 승인 후보가 되는 것
 *    ③ 자격 판정이 title+body 로 슬쩍 바뀌는 것 (§4-Y ④ 는 body 기준이다)
 *    ④ 100자 경계가 무너지는 것
 *    ⑤ 누르지 않은 후보가 기본값으로 승인되어 나가는 것
 *    ⑥ export 컬럼 순서가 바뀌는 것 (위치로 읽는 쪽이 조용히 오독한다)
 *    ⑦ 산출물이 .microseed-data/ 밖으로 나가는 것
 *    ⑧ DB·Sheet·LLM·live fetch·자동 발행이 들어오는 것
 */
import { readFileSync } from 'node:fs'
import {
  SRN_AXIS, SRN_DECISION_KEYS, EXPORT_COLUMNS, NOT_PUBLISH_NOTE, SHORT_RAW_MAX,
  selectSrn, exportRows, exportTsv, titleBodyRefLength, blockedApprovals,
  type DetailRecord,
} from './lib/micro-seed-srn-review.mjs'
import { escapeHtml, assertOutputPath, renderHtml, SRN_DATA_DIR } from './micro-seed-srn-review.mjs'

const LIB = readFileSync('scripts/lib/micro-seed-srn-review.mts', 'utf-8')
const GEN = readFileSync('scripts/micro-seed-srn-review.mts', 'utf-8')
/** 🔴 부정 스캔 전에 주석을 지운다 — 이 저장소가 다섯 번 반복한 실수다 */
const codeOf = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const LIB_CODE = codeOf(LIB)
const GEN_CODE = codeOf(GEN)

let pass = 0
let fail = 0
const check = (l: string, ok: boolean, why = ''): void => {
  if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${why ? ` — ${why}` : ''}`) }
}

/** SRN 자격을 갖춘 기본 행 — 각 검사에서 한 조건씩 무너뜨린다 */
const ok = (o: Partial<DetailRecord> = {}): DetailRecord => ({
  runId: 'T', axis: 'shortRawNoindex', access: 'ok',
  sourceSite: 'navercafe:test', sourceArticleId: '1', url: 'https://example.test/1',
  score: 40, lane: 'microSeedQuestion',
  bodyLength: 50, lengthBasis: 'body', imageCount: 0, commentCount: 2,
  safetyVerdict: 'pass', safetyReasons: '', assetAxes: '', reason: 'r', title: '제목',
  ...o,
})
const ids = (rs: readonly DetailRecord[]): string[] => selectSrn(rs).cards.map((c) => c.articleId)
const one = (o: Partial<DetailRecord>): number => selectSrn([ok(o)]).cards.length

console.log('\nSRN 승인 화면 fixture')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 후보 필터 — 🔴 shortRawNoindex 축만 올라온다')
check('🟢 shortRawNoindex → 후보', one({}) === 1)
for (const axis of ['seedOriginality', 'rawOriginality', 'hold', 'drop', 'access']) {
  check(`🔴 ${axis} → 제외`, one({ axis }) === 0)
}
check('🔴 축이 비어 있으면 제외', one({ axis: '' }) === 0)
check('🔴 제외 사유가 notSrnAxis 로 남는다',
  selectSrn([ok({ axis: 'drop' })]).rejected[0]?.code === 'notSrnAxis')
check('🔴 6축 중 SRN 외 5축을 한꺼번에 줘도 후보 0',
  selectSrn(['seedOriginality', 'rawOriginality', 'hold', 'drop', 'access']
    .map((axis, i) => ok({ axis, sourceArticleId: String(100 + i) }))).cards.length === 0)

console.log('\n② 안전·접근 — 🔴 길이보다 먼저다 (§4-Y ⑤)')
for (const access of ['deletedOrExpired', 'permissionDenied', 'renderFailed', 'selectorFailed', '']) {
  check(`🔴 access=${access || '(없음)'} → 제외`, one({ access }) === 0)
}
for (const sv of ['drop', 'hold', 'hardExclude', 'access', '']) {
  check(`🔴 safety=${sv || '(없음)'} → 제외`, one({ safetyVerdict: sv }) === 0)
}
check('🔴 access 제외 사유는 notAccessible',
  selectSrn([ok({ access: 'deletedOrExpired' })]).rejected[0]?.code === 'notAccessible')
check('🔴 safety 제외 사유는 unsafe',
  selectSrn([ok({ safetyVerdict: 'drop' })]).rejected[0]?.code === 'unsafe')

console.log('\n③ 길이 — 🟢 본문(body) 기준 100자 미만 (§4-Y ④ 확정)')
check(`🟢 SHORT_RAW_MAX 는 ${SHORT_RAW_MAX}`, SHORT_RAW_MAX === 100)
check('🟢 99자 → 후보', one({ bodyLength: 99 }) === 1)
check('🔴 100자 → 제외 (미만이지 이하가 아니다)', one({ bodyLength: 100 }) === 0)
check('🔴 101자 → 제외', one({ bodyLength: 101 }) === 0)
check('🔴 0자 → 제외', one({ bodyLength: 0 }) === 0)
check('🔴 음수 → 제외', one({ bodyLength: -1 }) === 0)
check('🔴 길이 제외 사유는 notShort',
  selectSrn([ok({ bodyLength: 120 })]).rejected[0]?.code === 'notShort')

console.log('\n④ lengthBasis — 🔴 body 로 재지 않았으면 본문 길이를 모른다')
check('🔴 lengthBasis=titleBody → 제외', one({ lengthBasis: 'titleBody' }) === 0)
check('🔴 lengthBasis 없음 → 제외', one({ lengthBasis: '' }) === 0)
check('🔴 제외 사유는 notBodyBasis',
  selectSrn([ok({ lengthBasis: 'titleBody' })]).rejected[0]?.code === 'notBodyBasis')
check('🟢 통과한 카드의 lengthBasis 는 항상 body',
  selectSrn([ok({})]).cards[0]?.lengthBasis === 'body')

console.log('\n⑤ title+body — 🟡 참고값일 뿐 자격 판정에 쓰지 않는다')
check('🟡 참고값 = 제목 + 1 + 본문', titleBodyRefLength('네글자다', 50) === 4 + 1 + 50)
check('🟡 제목이 비면 본문 길이 그대로', titleBodyRefLength('', 50) === 50)
check('🟡 연속 공백은 하나로 접는다', titleBodyRefLength('가  나', 10) === 3 + 1 + 10)
// 🔴 핵심 — 참고값이 100 을 넘어도 body 가 100 미만이면 후보다.
//    §4-Y ④ 실측에서 87자·91자 건이 title+body 로는 102·112자였다.
const longTitle = '아주아주긴제목을달아서합계를백자넘게만든다'
check('🟢 body 91자 + 참고값 100 초과여도 후보로 남는다',
  one({ bodyLength: 91, title: longTitle }) === 1)
check('🟡 그 카드의 참고값은 실제로 100 을 넘는다',
  (selectSrn([ok({ bodyLength: 91, title: longTitle })]).cards[0]?.titleBodyRefLength ?? 0) > 100)
check('🔴 반대로 참고값이 작아도 body 100 이상이면 제외',
  one({ bodyLength: 100, title: '짧' }) === 0)
check('🔴 필터 코드가 titleBodyRefLength 로 자격을 거르지 않는다',
  !/titleBodyRefLength\s*[<>=]/.test(LIB_CODE) && !/[<>=]\s*titleBodyRefLength/.test(LIB_CODE))

console.log('\n⑥ 중복·정렬')
check('🔴 같은 articleId 는 한 번만',
  ids([ok({ sourceArticleId: '7' }), ok({ sourceArticleId: '7' })]).length === 1)
check('🟢 점수 내림차순',
  ids([ok({ sourceArticleId: 'a', score: 10 }), ok({ sourceArticleId: 'b', score: 90 })])
    .join(',') === 'b,a')
check('🔴 articleId 없으면 제외', one({ sourceArticleId: '' }) === 0)

console.log('\n⑦ 본문 보존 — 🟡 없을 수 있다. 없다고 후보에서 빼지 않는다')
check('🟡 body 없으면 null 로 남는다', selectSrn([ok({})]).cards[0]?.body === null)
check('🟡 body 없어도 후보 자격은 유지된다', one({}) === 1)
check('🟢 body 있으면 공백 정규화해서 담는다',
  selectSrn([ok({ body: '  가  나  ' })]).cards[0]?.body === '가 나')

console.log('\n⑧ export 계약 — 🔴 사람이 누른 것만 나간다')
// 🔴 APPROVE 를 쓰려면 본문이 있어야 한다 (§4-Z ⑨) — 없으면 승인 자체가 막힌다
const cards = selectSrn([
  ok({ sourceArticleId: 'x1', body: '원문 하나' }),
  ok({ sourceArticleId: 'x2', body: '원문 둘' }),
]).cards
check('🔴 아무도 안 눌렀으면 0행', exportRows(cards, {}).length === 0)
check('🔴 빈 문자열 판정은 누른 것이 아니다', exportRows(cards, { x1: { v: '' } }).length === 0)
check('🔴 메모만 있고 판정이 없으면 나가지 않는다',
  exportRows(cards, { x1: { memo: '메모' } }).length === 0)
const ex = exportRows(cards, { x1: { v: 'APPROVE', memo: 'm' } })
check('🟢 누른 1건만 나간다', ex.length === 1 && ex[0]?.sourceArticleId === 'x1')
check('🟢 decision 이 그대로 실린다', ex[0]?.decision === 'APPROVE')
check('🟢 axis 는 항상 shortRawNoindex', ex[0]?.axis === SRN_AXIS)
check('🟢 모든 행에 발행 아님 문구가 붙는다', ex[0]?.note === NOT_PUBLISH_NOTE)
check('🟡 참고값도 함께 나간다 (자격엔 안 쓰되 기록은 남긴다)',
  typeof ex[0]?.titleBodyRefLength === 'number')
check('🟢 자격 길이 컬럼이 body 기준임을 명시한다', ex[0]?.lengthBasis === 'body')

console.log('\n⑨ export 컬럼 순서 — 🔴 위치로 읽는 쪽이 있다. 중간 삽입 금지')
const EXPECTED = [
  'decision', 'axis', 'sourceArticleId', 'sourceSite', 'url', 'score', 'lane',
  'bodyLength', 'lengthBasis', 'titleBodyRefLength', 'imageCount', 'commentCount',
  'safetyVerdict', 'safetyReasons', 'title', 'memo', 'note',
  'body',
]
check(`🔴 컬럼 ${EXPECTED.length}개가 순서까지 같다`,
  EXPORT_COLUMNS.join('|') === EXPECTED.join('|'), EXPORT_COLUMNS.join('|'))
const tsvOut = exportTsv(ex)
check('🟢 TSV 헤더가 계약과 같다', tsvOut.split('\n')[0] === EXPECTED.join('\t'))
check('🟢 TSV 본문 셀 수가 컬럼 수와 같다',
  (tsvOut.split('\n')[1] ?? '').split('\t').length === EXPECTED.length)
check('🔴 탭·개행은 셀 안에서 공백으로 접힌다',
  !exportTsv(exportRows(
    selectSrn([ok({ sourceArticleId: 'y', title: '가\t나\n다' })]).cards,
    { y: { v: 'APPROVE' } },
  )).split('\n')[1]?.includes('가\t나'))

check('🔴 앞 17개 위치는 그대로다 (body 는 맨 뒤에만 붙었다)',
  EXPORT_COLUMNS.slice(0, 17).join('|') === EXPECTED.slice(0, 17).join('|')
  && EXPORT_COLUMNS[17] === 'body')

console.log('\n⑮ body export — 🔴 APPROVE 된 SRN 행에만 실린다')
const bodyCard = selectSrn([ok({ sourceArticleId: 'b1', bodyLength: 50, body: '짧은 원문이다' })]).cards
check('🟢 body 있는 후보는 approvable', bodyCard[0]?.approvable === true)
check('🟢 APPROVE → body 실림',
  exportRows(bodyCard, { b1: { v: 'APPROVE' } })[0]?.body === '짧은 원문이다')
for (const v of ['SEED', 'HOLD', 'DROP']) {
  check(`🔴 ${v} → body 빈 값`, exportRows(bodyCard, { b1: { v } })[0]?.body === '')
}
check('🔴 미선택 → 행 자체가 없다', exportRows(bodyCard, {}).length === 0)
check('🟢 TSV 마지막 셀이 body',
  (exportTsv(exportRows(bodyCard, { b1: { v: 'APPROVE' } })).split('\n')[1] ?? '').split('\t')[17] === '짧은 원문이다')
check('🔴 body 의 탭·개행은 셀 안에서 접힌다',
  (exportTsv(exportRows(
    selectSrn([ok({ sourceArticleId: 'b2', body: '가\t나\n다' })]).cards, { b2: { v: 'APPROVE' } },
  )).split('\n')[1] ?? '').split('\t').length === EXPECTED.length)
check('🟢 selectSrn 이 이미 공백을 정규화한다',
  selectSrn([ok({ sourceArticleId: 'b3', body: '가\t나\n다' })]).cards[0]?.body === '가 나 다')

console.log('\n⑯ 본문 미보존 승인 — 🔴 막는다 (두 곳에서)')
const noBody = selectSrn([ok({ sourceArticleId: 'n1', bodyLength: 50 })]).cards
check('🔴 body 없는 후보는 approvable=false', noBody[0]?.approvable === false)
check('🔴 APPROVE 해도 export 행이 없다', exportRows(noBody, { n1: { v: 'APPROVE' } }).length === 0)
check('🔴 body 빈 승인 행을 만들지 않는다',
  !exportRows(noBody, { n1: { v: 'APPROVE' } }).some((r) => r.decision === 'APPROVE' && r.body === ''))
check('🔴 blockedApprovals 가 이름을 남긴다',
  blockedApprovals(noBody, { n1: { v: 'APPROVE' } })[0]?.articleId === 'n1')
check('🟢 SEED·HOLD·DROP 은 그대로 나간다',
  ['SEED', 'HOLD', 'DROP'].every((v) => exportRows(noBody, { n1: { v } }).length === 1))
check('🟢 그 행들의 body 는 빈 값',
  exportRows(noBody, { n1: { v: 'HOLD' } })[0]?.body === '')
check('🔴 미선택은 blocked 에도 안 들어간다', blockedApprovals(noBody, {}).length === 0)
check('🔴 승인 가능한 카드는 blocked 가 아니다',
  blockedApprovals(bodyCard, { b1: { v: 'APPROVE' } }).length === 0)

console.log('\n⑩ 버튼 — 🔴 여기에 발행이 없다는 것이 계약이다')
check('🟢 버튼 4종', SRN_DECISION_KEYS.length === 4)
check('🟢 APPROVE·SEED·HOLD·DROP', SRN_DECISION_KEYS.join(',') === 'APPROVE,SEED,HOLD,DROP')
check('🔴 발행 버튼이 없다',
  !SRN_DECISION_KEYS.some((k) => /PUBLISH|DEPLOY|LIVE/i.test(k)))

console.log('\n⑪ 산출물 경로 — 🔴 .microseed-data/ 밖으로 나가지 않는다')
check(`🟢 기본 디렉터리는 ${SRN_DATA_DIR}`, SRN_DATA_DIR === '.microseed-data')
check('🔴 생성기는 assertOutputPath 를 부른 뒤에만 쓴다',
  GEN_CODE.indexOf('assertOutputPath(out)') < GEN_CODE.indexOf('writeFileSync(out'))
check('🔴 writeFileSync 호출은 1회뿐', (GEN_CODE.match(/writeFileSync\(/g) ?? []).length === 1)
check('🔴 경로 가드가 .microseed-data/ 접두사를 요구한다',
  /rel\.startsWith\(`\$\{SRN_DATA_DIR\}\/`\)/.test(GEN_CODE))
check('🔴 엔트리포인트 가드가 있다 — import 만으로 파일을 쓰지 않는다',
  /isDirectRun/.test(GEN_CODE) && /if \(isDirectRun\) main\(\)/.test(GEN_CODE))

console.log('\n⑫ 금지 경로 — 🔴 코드에 없어야 한다 (주석 제거 후 스캔)')
const BANNED: readonly (readonly [string, RegExp])[] = [
  ['prisma / DB write', /prisma|PrismaClient|\.create\(|\.update\(|\.upsert\(/],
  ['Google Sheet', /googleapis|sheets\.|spreadsheet/i],
  ['LLM 호출', /openai|anthropic|claude-|gpt-|messages\.create/i],
  ['브라우저 · live fetch', /chromium|playwright|page\.goto|newContext/],
  ['네트워크 요청', /\bfetch\(|axios|got\(|https?\.request/],
  ['자동 발행', /publishPost|publishLive|autoPublish|deployNoindex/],
  ['82cook adapter', /82cook|import82/i],
  ['Raw Vault 적재', /MicroSeedRawContent|rawVault/i],
]
for (const [label, re] of BANNED) {
  check(`🔴 lib 에 ${label} 없음`, !re.test(LIB_CODE))
  check(`🔴 생성기에 ${label} 없음`, !re.test(GEN_CODE))
}
check('🔴 lib 은 파일 I/O 를 하지 않는다',
  !/readFileSync|writeFileSync|readdirSync|node:fs/.test(LIB_CODE))

console.log('\n⑬ HTML — 🔴 발행 아님 문구 · localStorage · 네트워크 0')
const html = renderHtml(
  selectSrn([ok({ sourceArticleId: 'h1', body: '짧은 본문' })]).cards,
  selectSrn([ok({ axis: 'drop', sourceArticleId: 'h2' })]).rejected,
  { generatedAt: 'T', withBody: 1, withoutBody: 0 },
)
check('🔴 발행 아님 문구가 화면에 있다', html.includes(NOT_PUBLISH_NOTE))
check('🔴 문구가 배너로 강조된다', /class="banner">🔴 [^<]*발행 아님/.test(html))
check('🟢 본문 기준 확정 문구가 있다', html.includes('본문(body) 기준'))
check('🟡 참고값 표기가 있다', html.includes('참고값'))
check('🔴 축 제한 문구가 있다', html.includes('섞이지 않는다'))
check('🔴 자격 조건 ≠ 자동 발행 조건 문구가 있다', html.includes('자동 발행 조건이 아니다'))
check('🟢 localStorage 저장·복원이 있다',
  html.includes("localStorage.getItem(KEY)") && html.includes('localStorage.setItem(KEY'))
check('🟢 시작 시 복원한다', /var STATE = load\(\);/.test(html))
check('🟢 판정을 누르면 저장된다', /function refresh\(\)\{[\s\S]*?save\(\);/.test(html))
check('🟢 초기화는 localStorage 도 지운다', html.includes('localStorage.removeItem(KEY)'))
check('🟢 TSV·JSON 두 가지로 내보낸다',
  html.includes("download('srn-review.tsv'") && html.includes("download('srn-review.json'"))
check('🔴 HTML 이 외부 네트워크를 부르지 않는다',
  !/<script src=|<link[^>]+href="https?:|@import|cdn\./.test(html))
check('🔴 본문 미보존 행도 화면에서 사라지지 않는다', html.includes('본문 미보존'))
check('🔴 빠진 행 집계를 숨기지 않는다', html.includes('후보에서 빠진 행 보기'))
check('🟢 제목·본문은 escape 된다', escapeHtml('<b>&"\'') === '&lt;b&gt;&amp;&quot;&#39;')
check('🔴 데이터 블록의 < 는 이스케이프된다',
  renderHtml(selectSrn([ok({ sourceArticleId: 'z', title: '<script>' })]).cards, [], {})
    .includes('\\u003cscript'))
check('🟢 터치 타깃 52px 이상', /button\.act\{[^}]*min-height:52px/.test(html))
check('🟢 미판정만 보기 필터가 있다', html.includes("['UNDECIDED','미판정만']"))
check('🟢 미판정 필터는 판정 없는 카드만 남긴다',
  /filter === 'UNDECIDED'\) return !\(STATE\[c\.articleId\] \|\| \{\}\)\.v/.test(html))
check('🔴 화면 export 도 APPROVE 아니면 body 를 비운다',
  /body: st\.v === 'APPROVE' \? \(c\.body \|\| ''\) : ''/.test(html))
check('🔴 화면 export 도 승인 불가 행을 건너뛴다',
  /if \(st\.v === 'APPROVE' && !c\.approvable\) return;/.test(html))
check('🔴 승인 불가면 APPROVE 버튼을 잠근다', /b\.disabled = true;/.test(html))
check('🔴 잠금 사유를 화면에 쓴다', html.includes('본문 미보존이라 <b>승인 불가</b>'))
check('🔴 막힌 승인 건수를 표시한다', html.includes('승인했지만 내보내지 못한'))
check('🟢 export 컬럼에 body 가 포함돼 화면에 주입된다',
  html.includes('var COLS = ' + JSON.stringify(EXPORT_COLUMNS)))

console.log('\n⑭ assertOutputPath — 🔴 밖이면 종료한다')
const origExit = process.exit
let exited = 0
process.exit = ((): never => { exited++; throw new Error('exit') }) as typeof process.exit
const guarded = (p: string): boolean => {
  try { assertOutputPath(p); return false } catch { return true }
}
const outside = guarded('/tmp/srn.html')
const inside = guarded('.microseed-data/srn.html')
process.exit = origExit
check('🔴 .microseed-data 밖 절대경로는 거부', outside && exited === 1)
check('🟢 .microseed-data 안은 통과', !inside)

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
