#!/usr/bin/env tsx
/**
 * Seed Originality 초안 검수 화면 fixture — 🔴 **네트워크 없이 계약을 검사한다**
 *
 * 🔴 이 fixture 가 막는 사고
 *    ① 누르지 않은 초안이 기본값으로 export 되는 것 — '검수' 가 사람의 행위가 아니게 된다
 *    ② export 컬럼 순서가 바뀌는 것 (위치로 읽는 쪽이 조용히 오독한다)
 *    ③ 권장이 실행할 때마다 달라지는 것 — 그러면 그 표시를 믿을 수 없다
 *    ④ 복붙 검증 결과(겹침·유출·금지 호칭)가 화면에서 사라지는 것
 *    ⑤ 발행 버튼이 생기는 것
 *    ⑥ 산출물이 .microseed-data/ 밖으로 나가는 것
 *    ⑦ DB·Sheet·LLM·발행·네이버·82cook 이 들어오는 것
 */
import { readFileSync } from 'node:fs'
import {
  toGroups, reviewRows, reviewTsv, pickRecommended, overAdopted, draftKey,
  REVIEW_DECISION_KEYS, REVIEW_COLUMNS, NOT_PUBLISH_NOTE, RECOMMENDED_ADOPT_PER_SOURCE,
  type ExpansionIn,
} from './lib/micro-seed-seed-originality-review.mjs'
import {
  escapeHtml, assertInsideDataDir, renderHtml, readExpansions, REVIEW_DATA_DIR,
} from './micro-seed-seed-originality-review.mjs'

const LIB = readFileSync('scripts/lib/micro-seed-seed-originality-review.mts', 'utf-8')
const GEN = readFileSync('scripts/micro-seed-seed-originality-review.mts', 'utf-8')
/** 🔴 부정 스캔 전에 주석을 지운다 */
const codeOf = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const LIB_CODE = codeOf(LIB)
const GEN_CODE = codeOf(GEN)

let pass = 0
let fail = 0
const check = (l: string, ok: boolean, why = ''): void => {
  if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${why ? ` — ${why}` : ''}`) }
}

const draft = (n: number, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  draftNo: n, title: `초안 ${n}`, body: '본문이에요.\n어떠세요?', bodyLength: 14,
  safety: { verdict: 'pass', reasons: [], summary: 'pass' },
  originality: { runWords: 0, runChars: n, coverRatio: 0 },
  leakedTokens: [], bannedHonorifics: [], ok: true,
  ...o,
})
const exp = (id: string, drafts: Record<string, unknown>[]): ExpansionIn => ({
  sourceArticleId: id, sourceTitle: '원문 제목', topic: 'household', topicLabel: '살림 · 주방',
  material: '후라이팬', matched: '후라이팬', generalized: '버린 낱말 2개', direction: '방향',
  drafts, needsHuman: false,
}) as ExpansionIn

console.log('\nSeed Originality 초안 검수 fixture')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 그룹 — 🔴 원천 articleId 로 묶는다')
const groups = toGroups([exp('a', [draft(1), draft(2), draft(3)]), exp('b', [draft(1), draft(2)])])
check('그룹 2개', groups.length === 2)
check('a 그룹 초안 3개', groups[0]?.drafts.length === 3)
check('b 그룹 초안 2개', groups[1]?.drafts.length === 2)
check('🔴 초안 키가 원천+번호로 유일하다',
  new Set(groups.flatMap((g) => g.drafts.map((d) => d.key))).size === 5)
check('키 형식 a#1', groups[0]?.drafts[0]?.key === draftKey('a', 1))
check('🔴 articleId 없는 행은 버린다', toGroups([{ sourceArticleId: '', drafts: [draft(1)] }]).length === 0)
check('초안 0건 그룹도 남는다 (needsHuman 을 보여야 한다)',
  toGroups([{ sourceArticleId: 'c', drafts: [], needsHuman: true }])[0]?.needsHuman === true)

console.log('\n② 권장 — 🔴 결정적이어야 한다')
const g1 = toGroups([exp('a', [draft(1, { originality: { runWords: 0, runChars: 5, coverRatio: 0 } }), draft(2, { originality: { runWords: 0, runChars: 2, coverRatio: 0 } }), draft(3, { originality: { runWords: 0, runChars: 9, coverRatio: 0 } })])])[0]!
check('겹침이 가장 작은 것이 권장', g1.drafts.find((d) => d.recommended)?.draftNo === 2)
check('🔴 그룹당 권장은 1개', g1.drafts.filter((d) => d.recommended).length === 1)
const g2 = toGroups([exp('a', [draft(3, { originality: { runWords: 0, runChars: 2, coverRatio: 0 } }), draft(1, { originality: { runWords: 0, runChars: 2, coverRatio: 0 } })])])[0]!
check('동률이면 draftNo 작은 쪽', g2.drafts.find((d) => d.recommended)?.draftNo === 1)
check('🔴 두 번 돌려도 같다',
  pickRecommended(g1.drafts) === pickRecommended(g1.drafts))
const dirty = toGroups([exp('a', [draft(1, { ok: false, leakedTokens: ['통영'] })])])[0]!
check('🔴 검증이 더러우면 권장하지 않는다', dirty.drafts.every((d) => !d.recommended))
check('🔴 억지로 하나 고르지 않는다', pickRecommended(dirty.drafts) === null)
check('권장 상수는 1', RECOMMENDED_ADOPT_PER_SOURCE === 1)

console.log('\n③ 복붙 검증 결과 — 🔴 그대로 실린다')
const flagged = toGroups([exp('a', [
  draft(1, { leakedTokens: ['통영'], ok: false }),
  draft(2, { bannedHonorifics: ['어르신'], ok: false }),
  draft(3, { safety: { verdict: 'hold', reasons: [{ code: 'medicalClaim' }], summary: '의료 단정' }, ok: false }),
])])[0]!
check('유출 낱말이 카드에 남는다', flagged.drafts[0]?.leakedTokens.join() === '통영')
check('금지 호칭이 카드에 남는다', flagged.drafts[1]?.bannedHonorifics.join() === '어르신')
check('safety 사유가 카드에 남는다', flagged.drafts[2]?.safetyReasons === 'medicalClaim')
check('🔴 셋 다 clean=false', flagged.drafts.every((d) => !d.clean))
check('🟢 깨끗한 초안은 clean=true', groups[0]?.drafts.every((d) => d.clean))
check('🔴 safety 가 pass 여도 유출이 있으면 clean 아님',
  toGroups([exp('a', [draft(1, { leakedTokens: ['x'], ok: false })])])[0]?.drafts[0]?.clean === false)

console.log('\n④ export — 🔴 사람이 누른 것만')
check('아무도 안 눌렀으면 0행', reviewRows(groups, {}).length === 0)
check('빈 문자열 판정은 누른 것이 아니다', reviewRows(groups, { 'a#1': { v: '' } }).length === 0)
check('메모만 있으면 나가지 않는다', reviewRows(groups, { 'a#1': { memo: 'm' } }).length === 0)
const rows = reviewRows(groups, { 'a#1': { v: 'ADOPT', memo: '이걸로' }, 'b#2': { v: 'DROP' } })
check('누른 2건만 나간다', rows.length === 2)
check('decision 이 그대로', rows[0]?.decision === 'ADOPT' && rows[1]?.decision === 'DROP')
check('원천·번호가 함께 나간다', rows[0]?.sourceArticleId === 'a' && rows[0]?.draftNo === 1)
check('메모 반영', rows[0]?.memo === '이걸로')
check('모든 행에 발행 아님 문구', rows.every((r) => r.note === NOT_PUBLISH_NOTE))
check('복붙 검증 결과가 export 에도 실린다',
  typeof rows[0]?.originality === 'string' && rows[0]?.clean === 'clean')

console.log('\n⑤ 다중 채택 — 🟡 막지 않고 알린다')
const many = { 'a#1': { v: 'ADOPT' }, 'a#2': { v: 'ADOPT' } }
check('한 원천 2개 채택도 export 된다', reviewRows(groups, many).length === 2)
check('🟡 초과 채택으로 잡힌다', overAdopted(groups, many)[0]?.sourceArticleId === 'a')
check('🟡 채택 수를 알려준다', overAdopted(groups, many)[0]?.adopted === 2)
check('1개면 초과가 아니다', overAdopted(groups, { 'a#1': { v: 'ADOPT' } }).length === 0)
check('🔴 REVISE·DROP 은 초과로 세지 않는다',
  overAdopted(groups, { 'a#1': { v: 'REVISE' }, 'a#2': { v: 'DROP' }, 'a#3': { v: 'REVISE' } }).length === 0)

console.log('\n⑥ 컬럼 계약 — 🔴 순서 고정')
const EXPECTED = [
  'decision', 'sourceArticleId', 'draftNo', 'topic', 'material', 'generalized', 'direction',
  'title', 'body', 'bodyLength',
  'safetyVerdict', 'safetyReasons', 'originality', 'leakedTokens', 'clean', 'recommended',
  'memo', 'note',
  // 🔴 §4-AC 간극 보강 — 맨 뒤에만 붙었다
  'sourceSite', 'generatedAt', 'reviewedAt',
]
check(`컬럼 ${EXPECTED.length}개 순서까지 같다`, REVIEW_COLUMNS.join('|') === EXPECTED.join('|'))
const tsv = reviewTsv(rows)
check('TSV 헤더가 계약과 같다', tsv.split('\n')[0] === EXPECTED.join('\t'))
check('TSV 셀 수 = 컬럼 수', (tsv.split('\n')[1] ?? '').split('\t').length === EXPECTED.length)
check('🔴 본문 개행이 셀 안에서 접힌다', !(tsv.split('\n')[1] ?? '').includes('\n본문'))
check('🔴 탭도 접힌다',
  (reviewTsv(reviewRows(toGroups([exp('t', [draft(1, { title: '가\t나' })])]), { 't#1': { v: 'ADOPT' } }))
    .split('\n')[1] ?? '').split('\t').length === EXPECTED.length)

check('🔴 앞 18개 위치는 그대로다 (뒤에만 붙었다)',
  REVIEW_COLUMNS.slice(0, 18).join('|') === EXPECTED.slice(0, 18).join('|')
  && REVIEW_COLUMNS.slice(18).join('|') === 'sourceSite|generatedAt|reviewedAt')

console.log('\n⑫ 간극 3필드 — 🔴 행마다 있어야 한다 (§4-AC ③)')
const AT_GEN = '2026-09-05T00:00:00.000Z'
const AT_REV = '2026-09-05T01:00:00.000Z'
const gg = toGroups([{
  sourceArticleId: 'g1', sourceSite: 'navercafe:test', sourceTitle: '원문', topic: 'household',
  topicLabel: '살림', material: '후라이팬', matched: '후라이팬', generalized: 'g', direction: 'd',
  drafts: [draft(1, { generatedAt: AT_GEN })], needsHuman: false,
} as ExpansionIn])
check('🔴 그룹에 sourceSite', gg[0]?.sourceSite === 'navercafe:test')
check('🔴 카드에 generatedAt', gg[0]?.drafts[0]?.generatedAt === AT_GEN)
const rr = reviewRows(gg, { 'g1#1': { v: 'ADOPT' } }, AT_REV)
check('🔴 export 행에 sourceSite', rr[0]?.sourceSite === 'navercafe:test')
check('🔴 export 행에 generatedAt', rr[0]?.generatedAt === AT_GEN)
check('🔴 export 행에 reviewedAt', rr[0]?.reviewedAt === AT_REV)
check('🔴 reviewedAt 은 generatedAt 과 다르다 (검수 시각)', rr[0]?.reviewedAt !== rr[0]?.generatedAt)
const many2 = reviewRows(
  toGroups([{ sourceArticleId: 'g2', sourceSite: 'navercafe:test', drafts: [draft(1), draft(2)] } as ExpansionIn]),
  { 'g2#1': { v: 'ADOPT' }, 'g2#2': { v: 'DROP' } }, AT_REV)
check('🟢 한 export 안 reviewedAt 은 모두 같다',
  new Set(many2.map((r) => r.reviewedAt)).size === 1)
check('🟡 reviewedAt 을 안 주면 지금 시각을 쓴다',
  /^\d{4}-\d{2}-\d{2}T/.test(reviewRows(gg, { 'g1#1': { v: 'ADOPT' } })[0]?.reviewedAt ?? ''))
check('🟡 sourceSite 없으면 빈 문자열 (추측하지 않는다)',
  toGroups([{ sourceArticleId: 'g3', drafts: [draft(1)] } as ExpansionIn])[0]?.sourceSite === '')
check('🔴 화면 export 도 세 필드를 넣는다',
  /sourceSite: g\.sourceSite, generatedAt: d\.generatedAt, reviewedAt: at/.test(renderHtml(gg, {})))
check('🔴 화면은 TSV·JSON 에 같은 시각을 쓴다',
  /var at = new Date\(\)\.toISOString\(\);[\s\S]*?rows\(at\)[\s\S]*?tsv\(at\)/.test(renderHtml(gg, {})))

console.log('\n⑦ 버튼 — 🔴 여기에 발행이 없다')
check('버튼 3종', REVIEW_DECISION_KEYS.length === 3)
check('ADOPT·REVISE·DROP', REVIEW_DECISION_KEYS.join(',') === 'ADOPT,REVISE,DROP')
check('🔴 발행류 버튼 없음', !REVIEW_DECISION_KEYS.some((k) => /PUBLISH|DEPLOY|LIVE|NOINDEX/i.test(k)))

console.log('\n⑧ HTML')
const html = renderHtml(groups, { generatedAt: 'T', sources: 2, drafts: 5, clean: 5, flagged: 0 })
check('🔴 발행 아님 배너', /class="banner">🔴 [^<]*발행 아님/.test(html) && html.includes(NOT_PUBLISH_NOTE))
check('🟢 초안이지 원문이 아니라고 말한다', html.includes('초안</b> 이지 원문이 아니다'))
check('🟡 복붙 검증 결과를 표시한다고 말한다', html.includes('복붙 금지 검증 결과'))
check('🔵 권장 1개 안내', html.includes(`권장은 ${RECOMMENDED_ADOPT_PER_SOURCE}개`))
check('원문 겹침 표시', html.includes('원문 겹침 '))
check('유출 낱말 표시 자리', html.includes('원문 낱말이 남았다'))
check('금지 호칭 표시 자리', html.includes('금지 호칭: '))
check('그룹 머리에 소재·일반화·방향', html.includes('<b>소재</b>') && html.includes('<b>일반화</b>') && html.includes('<b>방향</b>'))
check('🟢 localStorage 저장·복원',
  html.includes('localStorage.getItem(KEY)') && html.includes('localStorage.setItem(KEY'))
check('🟢 시작 시 복원', /var STATE = load\(\);/.test(html))
check('🟢 초기화가 localStorage 도 지운다', html.includes('localStorage.removeItem(KEY)'))
check('🟢 TSV·JSON 두 가지로 내보낸다',
  html.includes("download('seed-originality-review.tsv'") && html.includes("download('seed-originality-review.json'"))
check('🔴 화면 export 도 누른 것만', /if \(!st\.v\) return;/.test(html))
check('🟡 초과 채택 안내 자리', html.includes('권장(') && html.includes('보다 많이 채택한 곳'))
check('미판정만 필터', html.includes("['UNDECIDED','미판정만']"))
check('권장만 · 확인 필요 필터', html.includes("['RECOMMENDED','권장만']") && html.includes("['FLAGGED','확인 필요']"))
check('🔴 외부 네트워크를 부르지 않는다', !/<script src=|<link[^>]+href="https?:|@import|cdn\./.test(html))
check('🟢 터치 타깃 52px 이상', /button\.act\{[^}]*min-height:52px/.test(html))
check('🟢 escape 동작', escapeHtml('<b>&"\'') === '&lt;b&gt;&amp;&quot;&#39;')
check('🔴 데이터 블록의 < 는 이스케이프',
  renderHtml(toGroups([exp('z', [draft(1, { title: '<script>' })])]), {}).includes('\\u003cscript'))

console.log('\n⑨ 경로 가드 · 엔트리포인트')
check(`기본 디렉터리 ${REVIEW_DATA_DIR}`, REVIEW_DATA_DIR === '.microseed-data')
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
check('🔴 입력도 경로 가드를 통과한다', GEN_CODE.includes('assertInsideDataDir(inPath)'))

console.log('\n⑩ 금지 경로 — 🔴 코드에 없어야 한다 (주석 제거 후)')
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

console.log('\n⑪ 실 산출물이 있으면 함께 본다 (없으면 건너뛴다)')
try {
  const real = toGroups(readExpansions('.microseed-data/seed-originality-dry-run-20260905.json'))
  const n = real.reduce((a, g) => a + g.drafts.length, 0)
  check(`실 파일 원천 ${real.length}건 · 초안 ${n}건`, real.length > 0 && n > 0)
  check('🔴 원천마다 권장 1개 이하', real.every((g) => g.drafts.filter((d) => d.recommended).length <= 1))
  check('🟢 초안이 있는 원천은 권장이 있다',
    real.filter((g) => g.drafts.length > 0).every((g) => g.drafts.some((d) => d.recommended)))
  check('🔴 아무도 안 누르면 export 0행', reviewRows(real, {}).length === 0)
} catch {
  console.log('  🟡 dry-run 산출물 없음 — 건너뜀')
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
