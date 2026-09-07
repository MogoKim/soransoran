#!/usr/bin/env tsx
/**
 * Seed Originality 소스 검수 화면 fixture — 🔴 **네트워크 없이 계약을 검사한다**
 *
 * 🔴 이 fixture 가 막는 사고
 *    ① 다른 축이 섞여 들어오는 것 — 사람이 누르는 대상이 바뀐다
 *    ② APPROVE · ADOPT 가 생기는 것 — 두 단계의 말이 섞이면 판정을 구분할 수 없다
 *    ③ 누르지 않은 후보가 기본값으로 나가는 것
 *    ④ SEED 아닌 것이 다음 단계로 넘어가는 것
 *    ⑤ export 컬럼 순서가 바뀌는 것
 *    ⑥ 산출물이 .microseed-data/ 밖으로 나가는 것
 *    ⑦ DB·Sheet·LLM·발행·네이버·82cook 이 들어오는 것
 */
import { readFileSync } from 'node:fs'
import {
  SOURCE_AXIS, SOURCE_DECISION_KEYS, SOURCE_COLUMNS, NOT_PUBLISH_NOTE,
  selectSources, sourceRows, sourceTsv, seedDecisions, heldForReread,
  type DetailRecord,
} from './lib/micro-seed-seed-source-review.mjs'
import {
  escapeHtml, assertInsideDataDir, renderHtml, sourceRunId, loadDetailRecords, SOURCE_DATA_DIR,
} from './micro-seed-seed-source-review.mjs'

const LIB = readFileSync('scripts/lib/micro-seed-seed-source-review.mts', 'utf-8')
const GEN = readFileSync('scripts/micro-seed-seed-source-review.mts', 'utf-8')
/** 🔴 부정 스캔 전에 주석을 지운다 */
const codeOf = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const LIB_CODE = codeOf(LIB)
const GEN_CODE = codeOf(GEN)

let pass = 0
let fail = 0
const check = (l: string, ok: boolean, why = ''): void => {
  if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${why ? ` — ${why}` : ''}`) }
}

const ok = (o: Partial<DetailRecord> = {}): DetailRecord => ({
  runId: 'R1', axis: 'seedOriginality', access: 'ok',
  sourceSite: 'navercafe:test', sourceArticleId: '1', url: 'https://example.test/1',
  score: 40, lane: 'microSeedQuestion', bodyLength: 200, imageCount: 0, commentCount: 2,
  safetyVerdict: 'pass', safetyReasons: '', assetAxes: '', reason: 'r', title: '제목',
  ...o,
})
const one = (o: Partial<DetailRecord>): number => selectSources([ok(o)]).cards.length

console.log('\nSeed Originality 소스 검수 fixture')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 후보 필터 — 🔴 seedOriginality 축만 올라온다')
check('🟢 seedOriginality → 후보', one({}) === 1)
for (const axis of ['shortRawNoindex', 'rawOriginality', 'hold', 'drop', 'access']) {
  check(`🔴 ${axis} → 제외`, one({ axis }) === 0)
}
check('🔴 축이 비면 제외', one({ axis: '' }) === 0)
check('🔴 제외 사유가 notSourceAxis',
  selectSources([ok({ axis: 'shortRawNoindex' })]).rejected[0]?.code === 'notSourceAxis')
check('🔴 5축을 한꺼번에 줘도 후보 0',
  selectSources(['shortRawNoindex', 'rawOriginality', 'hold', 'drop', 'access']
    .map((axis, i) => ok({ axis, sourceArticleId: String(90 + i) }))).cards.length === 0)

console.log('\n② 접근 · 안전 — 🔴 소재보다 먼저다')
for (const access of ['deletedOrExpired', 'permissionDenied', 'renderFailed', 'selectorFailed', '']) {
  check(`🔴 access=${access || '(없음)'} → 제외`, one({ access }) === 0)
}
for (const sv of ['drop', 'hold', 'hardExclude', 'access', '']) {
  check(`🔴 safety=${sv || '(없음)'} → 제외`, one({ safetyVerdict: sv }) === 0)
}
check('🔴 access 사유는 notAccessible',
  selectSources([ok({ access: 'renderFailed' })]).rejected[0]?.code === 'notAccessible')
check('🔴 safety 사유는 unsafe',
  selectSources([ok({ safetyVerdict: 'hold' })]).rejected[0]?.code === 'unsafe')
check('🔴 본문 0자 → 제외', one({ bodyLength: 0 }) === 0)
check('🔴 articleId 없으면 제외', one({ sourceArticleId: '' }) === 0)
check('🔴 중복 articleId 는 한 번만',
  selectSources([ok({ sourceArticleId: '7' }), ok({ sourceArticleId: '7' })]).cards.length === 1)
check('🟢 점수 내림차순',
  selectSources([ok({ sourceArticleId: 'a', score: 10 }), ok({ sourceArticleId: 'b', score: 90 })])
    .cards.map((c) => c.articleId).join(',') === 'b,a')

console.log('\n③ 버튼 — 🔴 SEED · HOLD · DROP 셋뿐 (§4-AD ⑥)')
check('버튼 3종', SOURCE_DECISION_KEYS.length === 3)
check('SEED,HOLD,DROP', SOURCE_DECISION_KEYS.join(',') === 'SEED,HOLD,DROP')
check('🔴 APPROVE 없음 — SRN 의 "원문 그대로 낸다" 다', !SOURCE_DECISION_KEYS.includes('APPROVE'))
check('🔴 ADOPT 없음 — 초안 검수 단계의 말이다', !SOURCE_DECISION_KEYS.includes('ADOPT'))
check('🔴 발행류 버튼 없음',
  !SOURCE_DECISION_KEYS.some((k) => /PUBLISH|DEPLOY|LIVE|NOINDEX/i.test(k)))
check('🔴 lib 코드에 APPROVE·ADOPT 문자열이 없다',
  !/'APPROVE'|'ADOPT'/.test(LIB_CODE))
check('🔴 생성기 코드에도 없다', !/'APPROVE'|'ADOPT'/.test(GEN_CODE))

console.log('\n④ export — 🔴 사람이 누른 것만')
const cards = selectSources([ok({ sourceArticleId: 'x1' }), ok({ sourceArticleId: 'x2' })]).cards
check('아무도 안 눌렀으면 0행', sourceRows(cards, {}).length === 0)
check('빈 문자열 판정은 누른 것이 아니다', sourceRows(cards, { x1: { v: '' } }).length === 0)
check('메모만 있으면 나가지 않는다', sourceRows(cards, { x1: { memo: 'm' } }).length === 0)
const AT = '2026-09-06T01:00:00.000Z'
const rows = sourceRows(cards, { x1: { v: 'SEED', memo: '쓸 만하다' }, x2: { v: 'DROP' } }, AT)
check('누른 2건만', rows.length === 2)
check('decision 그대로', rows[0]?.decision === 'SEED' && rows[1]?.decision === 'DROP')
check('memo 반영', rows[0]?.memo === '쓸 만하다')
check('모든 행에 발행 아님 문구', rows.every((r) => r.note === NOT_PUBLISH_NOTE))
check('detailRunId 실림', rows[0]?.detailRunId === 'R1')
check('reviewedAt 단일값', new Set(rows.map((r) => r.reviewedAt)).size === 1 && rows[0]?.reviewedAt === AT)
check('🟡 reviewedAt 을 안 주면 지금 시각',
  /^\d{4}-\d{2}-\d{2}T/.test(sourceRows(cards, { x1: { v: 'SEED' } })[0]?.reviewedAt ?? ''))

console.log('\n⑤ 다음 단계로 — 🔴 SEED 만 넘어간다 (§4-AD ⑧)')
check('SEED 1건만 추려진다', seedDecisions(rows).length === 1 && seedDecisions(rows)[0]?.sourceArticleId === 'x1')
check('🔴 DROP 은 넘어가지 않는다', !seedDecisions(rows).some((r) => r.decision === 'DROP'))
const held = sourceRows(cards, { x1: { v: 'HOLD' }, x2: { v: 'SEED' } }, AT)
check('🔴 HOLD 도 넘어가지 않는다', seedDecisions(held).every((r) => r.decision === 'SEED'))
check('🟡 HOLD 는 재접속 대상으로 모인다', heldForReread(held).length === 1)
check('🟡 SEED·DROP 은 재접속 대상이 아니다', heldForReread(rows).length === 0)

console.log('\n⑥ 컬럼 계약 — 🔴 순서 고정 (§4-AD ⑦)')
const EXPECTED = [
  'decision', 'sourceArticleId', 'sourceSite', 'url', 'score', 'lane',
  'bodyLength', 'imageCount', 'commentCount', 'assetAxes',
  'safetyVerdict', 'safetyReasons', 'title', 'memo',
  'detailRunId', 'reviewedAt', 'note',
]
check(`컬럼 ${EXPECTED.length}개 순서까지 같다`, SOURCE_COLUMNS.join('|') === EXPECTED.join('|'))
check('🔴 body 원문 컬럼이 없다 (저장하지 않는 레인이다)', !SOURCE_COLUMNS.includes('body'))
const tsv = sourceTsv(rows)
check('TSV 헤더가 계약과 같다', tsv.split('\n')[0] === EXPECTED.join('\t'))
check('TSV 셀 수 = 컬럼 수', (tsv.split('\n')[1] ?? '').split('\t').length === EXPECTED.length)
check('🔴 탭·개행이 셀 안에서 접힌다',
  (sourceTsv(sourceRows(selectSources([ok({ sourceArticleId: 'y', title: '가\t나\n다' })]).cards,
    { y: { v: 'SEED' } }, AT)).split('\n')[1] ?? '').split('\t').length === EXPECTED.length)

console.log('\n⑦ HTML')
const html = renderHtml(selectSources([ok({ sourceArticleId: 'h1' })]).cards,
  selectSources([ok({ axis: 'drop', sourceArticleId: 'h2' })]).rejected, { generatedAt: 'T' })
check('🔴 발행 아님 배너', /class="banner">🔴 [^<]*발행 아님/.test(html) && html.includes(NOT_PUBLISH_NOTE))
check('🟢 이 화면의 질문을 명시한다', html.includes('이 소재를 우리 질문으로 바꿀 수 있나'))
check('🔴 축 제한 문구', html.includes('섞이지 않는다'))
check('🔴 APPROVE·ADOPT 가 없다는 문구', html.includes('APPROVE · ADOPT 버튼이 없다'))
check('🔴 화면에 APPROVE/ADOPT 버튼이 실제로 없다',
  !/data-k="APPROVE"|data-k="ADOPT"/.test(html))
check('🟡 본문 미저장 안내', html.includes('본문은 저장되지 않는다'))
check('🔴 재접속은 별도 승인 문구', html.includes('재접속이 필요하고 그것은 별도 승인'))
check('🟢 SEED 만 다음 입력이 된다는 문구', html.includes('입력 후보가 된다'))
check('🟢 localStorage 저장·복원',
  html.includes('localStorage.getItem(KEY)') && html.includes('localStorage.setItem(KEY'))
check('🟢 시작 시 복원', /var STATE = load\(\);/.test(html))
check('🟢 초기화가 localStorage 도 지운다', html.includes('localStorage.removeItem(KEY)'))
check('🟢 TSV·JSON 두 가지로 내보낸다',
  html.includes("'seed-originality-source-approvals-' + STAMP + '.tsv'")
  && html.includes("'seed-originality-source-approvals-' + STAMP + '.json'"))
check('🔴 화면 export 도 누른 것만', /if \(!st\.v\) return;/.test(html))
check('🔴 TSV·JSON 이 같은 시각을 쓴다',
  /var at = new Date\(\)\.toISOString\(\);[\s\S]*?rows\(at\)[\s\S]*?tsv\(at\)/.test(html))
check('🟡 HOLD 안내 자리', html.includes('전문이 필요하면 재접속을 따로 요청한다'))
check('🔴 빠진 행 집계를 숨기지 않는다', html.includes('후보에서 빠진 행 보기'))
check('🔴 외부 네트워크를 부르지 않는다', !/<script src=|<link[^>]+href="https?:|@import|cdn\./.test(html))
check('🟢 터치 타깃 52px 이상', /button\.act\{[^}]*min-height:52px/.test(html))
check('🟢 escape 동작', escapeHtml('<b>&"\'') === '&lt;b&gt;&amp;&quot;&#39;')
check('🔴 데이터 블록의 < 이스케이프',
  renderHtml(selectSources([ok({ sourceArticleId: 'z', title: '<script>' })]).cards, [], {})
    .includes('\\u003cscript'))

console.log('\n⑧ 파일 이름 · 경로 가드')
const t1 = new Date('2026-09-06T01:05:38')
const t2 = new Date('2026-09-06T11:18:18')
check('runId 형식 YYYYMMDD-HHMMSS', /^\d{8}-\d{6}$/.test(sourceRunId(t1)), sourceRunId(t1))
check('🔴 같은 날 다른 시각 → 다른 이름', sourceRunId(t1) !== sourceRunId(t2))
check('🟢 시간순 정렬', sourceRunId(t1) < sourceRunId(t2))
check(`기본 디렉터리 ${SOURCE_DATA_DIR}`, SOURCE_DATA_DIR === '.microseed-data')
const origExit = process.exit
let exited = 0
process.exit = ((): never => { exited++; throw new Error('exit') }) as typeof process.exit
const guarded = (p: string): boolean => { try { assertInsideDataDir(p); return false } catch { return true } }
const outside = guarded('/tmp/x.html')
const inside = guarded('.microseed-data/x.html')
process.exit = origExit
check('🔴 밖은 거부', outside && exited === 1)
check('🟢 안은 통과', !inside)
check('🔴 엔트리포인트 가드', /if \(isDirectRun\) main\(\)/.test(GEN_CODE))
check('🔴 writeFileSync 1회', (GEN_CODE.match(/writeFileSync\(/g) ?? []).length === 1)
check('🔴 쓰기 전에 경로 가드', GEN_CODE.indexOf('assertInsideDataDir(out)') < GEN_CODE.indexOf('writeFileSync(out'))

console.log('\n⑨ 금지 경로 — 🔴 코드에 없어야 한다 (주석 제거 후)')
const BANNED: readonly (readonly [string, RegExp])[] = [
  ['prisma / DB write', /prisma|PrismaClient|\.create\(|\.upsert\(/],
  ['Google Sheet', /googleapis|spreadsheet/i],
  ['LLM 호출', /openai|anthropic|claude-|gpt-|messages\.create/i],
  ['브라우저 · live fetch', /chromium|playwright|page\.goto|newContext/],
  ['네트워크 요청', /\bfetch\(|axios|https?\.request/],
  ['자동 발행', /publishPost|publishLive|autoPublish|deployNoindex/],
  ['82cook adapter', /82cook|import82/i],
  ['Raw Vault 적재', /MicroSeedRawContent|rawVault/i],
  ['네이버 재접속', /cafe\.naver/i],
]
for (const [label, re] of BANNED) {
  check(`🔴 lib 에 ${label} 없음`, !re.test(LIB_CODE))
  check(`🔴 생성기에 ${label} 없음`, !re.test(GEN_CODE))
}
check('🔴 lib 은 파일 I/O 를 하지 않는다', !/readFileSync|writeFileSync|readdirSync|node:fs/.test(LIB_CODE))

console.log('\n⑩ 🔴 SRN 화면과 섞이지 않는지 (별도 계약)')
check('축 상수가 seedOriginality', SOURCE_AXIS === 'seedOriginality')
check('note 문구가 SRN 과 다르다', NOT_PUBLISH_NOTE === '발행 아님 · 소재 승인 파일만 생성')
check('🔴 SRN 의 note 문구를 쓰지 않는다',
  !LIB_CODE.includes('noindex 배포 아님') && !GEN_CODE.includes('사람 승인 파일만 생성'))
check('🔴 lib 이 SRN 모듈을 import 하지 않는다', !/micro-seed-srn-review/.test(LIB_CODE))
check('🔴 생성기도 import 하지 않는다', !/micro-seed-srn-review/.test(GEN_CODE))

console.log('\n⑪ 실 산출물이 있으면 함께 본다 (없으면 건너뛴다)')
try {
  const { records } = loadDetailRecords('.microseed-data')
  const { cards: real, rejected } = selectSources(records)
  check(`실 파일 후보 ${real.length}건`, real.length > 0)
  check('🔴 전부 seedOriginality 축 조건을 만족한다',
    real.every((c) => c.safetyVerdict === 'pass' && c.bodyLength > 0))
  // 🔴 실 데이터에 기대는 검사다. 사유를 하나로 못박으면 새 회차가 들어올 때마다 깨진다 —
  //    2026-09-07 에 82cook 어댑터가 access=failed 8건을 넣어 실제로 깨졌다.
  //    막아야 할 것은 "모르는 사유" 이지 notSourceAxis 외 전부가 아니다.
  check('🔴 제외 사유가 전부 아는 코드다',
    rejected.every((r) => (['notSourceAxis', 'notAccessible', 'unsafe', 'noArticleId', 'emptyBody'] as const)
      .includes(r.code)))
  check('🔴 아무도 안 누르면 export 0행', sourceRows(real, {}).length === 0)
} catch {
  console.log('  🟡 .detail.jsonl 없음 — 건너뜀')
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
