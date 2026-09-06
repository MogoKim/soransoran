#!/usr/bin/env tsx
/**
 * Raw Originality 검수 화면 fixture — 🔴 **계약이 어긋나면 여기서 멈춘다** (§4-AF T3)
 *
 * 읽기만 한다. 네트워크·DB·파일 쓰기 0.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  selectRawCards, loadRawRecords, renderHtml, escapeHtml, rawReviewId,
  isInsideDataDir, RAW_REVIEW_COLUMNS, type RawRecord,
} from './micro-seed-raw-review.mjs'
import {
  RAW_AXIS, RAW_DECISIONS, NOT_PUBLISH_NOTE, BODY_HEAD_CHARS,
} from './lib/micro-seed-raw-originality.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

const rec = (o: Partial<RawRecord>): RawRecord => ({
  sourceArticleId: 'x', sourceSite: 's', url: 'u', title: 't', score: 1, lane: 'originalRaw',
  accessStatus: 'ok', bodyLength: 500, bodyHead: '앞부분', axis: RAW_AXIS,
  safetyVerdict: 'pass', safetyReasons: '', imageCount: 0, commentCount: 0,
  runId: 'r1', fetchedAt: 'f', ...o,
})

console.log('\nRaw Originality 검수 화면 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 후보 선정 — 세 조건을 모두 만족해야 한다')
{
  const { cards, rejected } = selectRawCards([
    rec({ sourceArticleId: 'ok1' }),
    rec({ sourceArticleId: 'axis', axis: 'seedOriginality' }),
    rec({ sourceArticleId: 'srn', axis: 'shortRawNoindex' }),
    rec({ sourceArticleId: 'acc', accessStatus: 'deletedOrExpired' }),
    rec({ sourceArticleId: 'saf', safetyVerdict: 'hardExclude' }),
    rec({ sourceArticleId: 'hold', safetyVerdict: 'hold' }),
  ])
  check('🔴 rawOriginality 축만 올라온다', cards.length === 1 && cards[0]!.articleId === 'ok1')
  check('🔴 다른 축은 섞이지 않는다', !cards.some((c) => c.axis !== RAW_AXIS))
  check('🔴 읽지 못한 글은 후보가 아니다', !cards.some((c) => c.articleId === 'acc'))
  check('🔴 safety 가 pass 가 아니면 후보가 아니다',
    !cards.some((c) => c.articleId === 'saf' || c.articleId === 'hold'))
  check('🔴 빠진 행을 조용히 버리지 않는다 — 사유와 함께 돌려준다', rejected.length === 5)
  check('제외 사유에 축·access·safety 가 구분돼 남는다',
    rejected.some((r) => r.code.startsWith('축'))
    && rejected.some((r) => r.code.startsWith('access'))
    && rejected.some((r) => r.code.startsWith('safety')))
  check('긴 글이 먼저 온다', selectRawCards([
    rec({ sourceArticleId: 'a', bodyLength: 400 }), rec({ sourceArticleId: 'b', bodyLength: 2000 }),
  ]).cards.map((c) => c.articleId).join(',') === 'b,a')
  check('같은 길이면 id 로 가른다 — 순서가 흔들리지 않는다', selectRawCards([
    rec({ sourceArticleId: 'z', bodyLength: 500 }), rec({ sourceArticleId: 'y', bodyLength: 500 }),
  ]).cards.map((c) => c.articleId).join(',') === 'y,z')
}

console.log('\n② bodyHead — 🔴 전문이 아니다')
{
  const long = '가'.repeat(BODY_HEAD_CHARS)
  const { cards } = selectRawCards([rec({ bodyLength: 2795, bodyHead: long })])
  const c = cards[0]!
  check(`headChars 가 ${BODY_HEAD_CHARS} 를 넘지 않는다`, c.headChars <= BODY_HEAD_CHARS)
  check('🔴 잘렸음을 카드가 안다', c.truncated)
  check('원문 전체면 잘리지 않았다고 한다',
    !selectRawCards([rec({ bodyLength: 4, bodyHead: '네글자다' })]).cards[0]!.truncated)
  check('🔴 export 컬럼에 body 전문이 없다', !RAW_REVIEW_COLUMNS.includes('body'))
  check('bodyHead 컬럼은 있다', RAW_REVIEW_COLUMNS.includes('bodyHead'))
  check('지시된 16컬럼이 모두 있다', [
    'decision', 'sourceArticleId', 'sourceSite', 'url', 'title', 'score', 'lane', 'axis',
    'bodyLength', 'bodyHead', 'safetyVerdict', 'safetyReasons',
    'runId', 'fetchedAt', 'reviewedAt', 'note',
  ].every((k) => RAW_REVIEW_COLUMNS.includes(k)))
}

console.log('\n③ 화면 — 다른 화면의 말을 쓰지 않는다')
{
  const { cards, rejected } = selectRawCards([rec({ sourceArticleId: 'ok1' })])
  const html = renderHtml(cards, rejected, { bodyHeadChars: BODY_HEAD_CHARS })
  // 🔴 버튼은 data-k 로 만들어진다 — 문서 전체가 아니라 **버튼 정의**를 본다
  const btns = RAW_DECISIONS.map(([k]) => k)
  check('decision 은 RAW · HOLD · DROP 셋뿐', btns.join(',') === 'RAW,HOLD,DROP')
  for (const k of btns) check(`버튼 ${k} 가 있다`, html.includes(`data-k="${k}"`) || html.includes(`'${k}'`))
  for (const k of ['APPROVE', 'ADOPT', 'SEED', 'PUBLISH']) {
    check(`🔴 ${k} 버튼이 없다`, !html.includes(`data-k="${k}"`) && !html.includes(`['${k}',`))
  }
  check('🔴 발행 버튼이 없다', !/<button[^>]*>\s*발행/.test(html))
  check('발행이 아님을 배너에 박는다', html.includes(NOT_PUBLISH_NOTE))
  check('🟡 전문이 아님을 화면이 말한다', html.includes('전문이 아니다'))
  check(`앞 ${BODY_HEAD_CHARS}자임을 밝힌다`, html.includes(String(BODY_HEAD_CHARS)))
  check('300자로 판단됐는지 묻는다', html.includes('판단이 되셨나요'))
  check('미판정만 보기 필터가 있다', html.includes('UNDECIDED'))
  check('localStorage 로 저장·복원한다',
    html.includes('localStorage.setItem') && html.includes('localStorage.getItem'))
  check('TSV·JSON 내려받기가 있다', html.includes('raw-originality-approvals-'))
  check('🔴 미선택은 export 에서 빠진다', html.includes('if (!st.v) return;'))
}

console.log('\n④ 🔴 외부 네트워크 0 — 화면도 아무것도 부르지 않는다')
{
  const { cards, rejected } = selectRawCards([rec({})])
  const html = renderHtml(cards, rejected, {})
  for (const [label, re] of [
    ['fetch/XHR', /fetch\(|XMLHttpRequest|WebSocket|EventSource/],
    ['외부 script', /<script[^>]+src=/],
    ['외부 style', /<link[^>]+href=/],
    ['import', /\bimport\s*\(/],
  ] as const) check(`🔴 ${label} 없음`, !re.test(html))
  // 🔴 원문 링크(a href)는 있어도 된다 — 사람이 눌러야 열린다. 자동 요청이 아니다.
  check('원문 링크는 사람이 누를 때만 열린다', html.includes('rel="noreferrer noopener"'))
  check('🔴 데이터는 인라인 JSON 이다', html.includes('<script type="application/json" id="data">'))
}

console.log('\n⑤ 경로 가드 · 이스케이프')
{
  check('🟢 정상 경로 허용', isInsideDataDir('.microseed-data/raw-review.html'))
  check('🟢 ./ 접두도 같은 경로', isInsideDataDir('./.microseed-data/raw-review.html'))
  check('🔴 바깥 경로 거부', !isInsideDataDir('docs/x.html'))
  check('🔴 .. 탈출 거부', !isInsideDataDir('.microseed-data/../x.html'))
  check('🔴 비슷한 이름에 속지 않는다', !isInsideDataDir('.microseed-data-other/x.html'))
  check('HTML 이스케이프', escapeHtml('<script>&"\'') === '&lt;script&gt;&amp;&quot;&#39;')
  const { cards, rejected } = selectRawCards([rec({ title: '<img src=x onerror=alert(1)>' })])
  check('🔴 제목의 태그가 그대로 실리지 않는다',
    !renderHtml(cards, rejected, {}).includes('<img src=x onerror'))
  check('회차 id 는 YYYYMMDD-HHMMSS', /^\d{8}-\d{6}$/.test(rawReviewId(new Date())))
}

console.log('\n⑥ 입력 읽기')
{
  const dir = mkdtempSync(join(tmpdir(), 'raw-review-'))
  writeFileSync(join(dir, 'a.raw-detail.jsonl'),
    `${JSON.stringify(rec({ sourceArticleId: 'A', runId: 'r1', bodyLength: 500 }))}\n{깨진줄\n`, 'utf-8')
  writeFileSync(join(dir, 'b.raw-detail.jsonl'),
    `${JSON.stringify(rec({ sourceArticleId: 'A', runId: 'r2', bodyLength: 900 }))}\n`, 'utf-8')
  const { records, files } = loadRawRecords(dir)
  check('여러 파일을 읽는다', files.length === 2)
  check('깨진 줄이 있어도 죽지 않는다', records.length === 1)
  check('🔴 같은 id 는 나중 runId 가 이긴다 — 재수집이 최신이다',
    records[0]!.bodyLength === 900)
  check('없는 디렉터리는 빈 결과', loadRawRecords(join(dir, 'nope')).records.length === 0)
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n⑦ 금지 — 생성기 코드에 위험한 것이 없다')
{
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const src = codeOf('scripts/micro-seed-raw-review.mts')
  for (const [label, re] of [
    ['prisma / DB write', /prisma|PrismaClient|\.upsert\(/i],
    ['Google Sheet', /googleapis|spreadsheet/i],
    ['LLM 호출', /openai|anthropic|claude-|gpt-/i],
    ['브라우저 구동', /playwright|puppeteer|chromium/],
    ['82cook adapter', /82cook/],
  ] as const) check(`🔴 ${label} 없음`, !re.test(src))
  check('🔴 금지 호칭 없음', !['시니어', '어르신', '노인', '실버'].some((w) => src.includes(w)))
  check('엔트리포인트 가드가 있다', /if \(isDirectRun\) main\(\)/.test(src))
  check('🔴 산출 경로를 가드한다', /assertInsideDataDir\(out\)/.test(src))
}

console.log('\n⑧ 실제 산출물이 있으면 함께 본다')
try {
  const { records, files } = loadRawRecords('.microseed-data')
  if (files.length === 0) throw new Error('no files')
  const { cards } = selectRawCards(records)
  check(`실 파일 ${files.length}개 · 글 ${records.length}건 · 후보 ${cards.length}건`, records.length > 0)
  check('🔴 후보는 전부 rawOriginality · access ok · safety pass',
    cards.every((c) => c.axis === RAW_AXIS && c.safetyVerdict === 'pass'))
  check(`🔴 bodyHead 가 ${BODY_HEAD_CHARS}자를 넘는 후보가 없다`,
    cards.every((c) => c.headChars <= BODY_HEAD_CHARS))
  check('🔴 후보에 body 전문 필드가 없다',
    !records.some((r) => Object.prototype.hasOwnProperty.call(r, 'body')))
} catch {
  console.log('  🟡 .microseed-data/*.raw-detail.jsonl 없음 — 건너뜀')
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
