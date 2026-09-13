#!/usr/bin/env tsx
/**
 * Raw 재작성 작업대 fixture — 🔴 **계약이 어긋나면 여기서 멈춘다** (§4-AG T7-1)
 *
 * 읽기만 한다. 네트워크·DB·파일 쓰기 0.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  selectRewriteCards, loadApprovals, handledArticleIds, renderHtml, escapeHtml,
  rewriteRunId, isInsideDataDir, REWRITE_COLUMNS, REWRITE_DECISIONS, NOT_PUBLISH_NOTE,
  type ApprovalRow,
} from './micro-seed-raw-rewrite.mjs'
import { COPY_RUN_CHARS } from '../src/lib/draft-originality'
import { BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const row = (o: Partial<ApprovalRow>): ApprovalRow => ({
  decision: 'RAW', sourceArticleId: 'x', sourceSite: 's', url: 'u', title: 't',
  bodyLength: 500, bodyHead: '앞부분', safetyVerdict: 'pass', safetyReasons: '',
  runId: 'r', fetchedAt: 'f', reviewedAt: 'rv', ...o,
})

console.log('\nRaw 재작성 작업대 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 입력 — RAW 만 작업대에 오른다')
{
  const { cards, rejected } = selectRewriteCards([
    row({ sourceArticleId: 'raw1' }),
    row({ sourceArticleId: 'hold', decision: 'HOLD' }),
    row({ sourceArticleId: 'drop', decision: 'DROP' }),
    row({ sourceArticleId: 'none', decision: '' }),
  ])
  check('🔴 RAW 만 후보다', cards.length === 1 && cards[0]!.articleId === 'raw1')
  check('🔴 HOLD 는 제외', !cards.some((c) => c.articleId === 'hold'))
  check('🔴 DROP 은 제외', !cards.some((c) => c.articleId === 'drop'))
  check('🔴 미선택은 제외', !cards.some((c) => c.articleId === 'none'))
  check('🔴 빠진 행을 사유와 함께 남긴다', rejected.length === 3
    && rejected.every((r) => r.code.startsWith('판정')))
  check('🔴 이미 초안 있는 원천은 다시 오르지 않는다',
    selectRewriteCards([row({ sourceArticleId: 'raw1' })], new Set(['raw1'])).cards.length === 0)
  check('제외 사유에 "이미 초안 있음" 이 남는다',
    selectRewriteCards([row({ sourceArticleId: 'raw1' })], new Set(['raw1']))
      .rejected[0]!.code === '이미 초안 있음')
  check('긴 글이 먼저 온다', selectRewriteCards([
    row({ sourceArticleId: 'a', bodyLength: 400 }), row({ sourceArticleId: 'b', bodyLength: 2000 }),
  ]).cards.map((c) => c.articleId).join(',') === 'b,a')
  check('같은 길이면 id 로 가른다', selectRewriteCards([
    row({ sourceArticleId: 'z', bodyLength: 500 }), row({ sourceArticleId: 'y', bodyLength: 500 }),
  ]).cards.map((c) => c.articleId).join(',') === 'y,z')
}

console.log('\n② decision — ADOPT 를 아직 쓰지 않는다')
{
  const codes = REWRITE_DECISIONS.map(([k]) => k)
  check('SAVE · HOLD · DROP 셋뿐', codes.join(',') === 'SAVE,HOLD,DROP')
  // 🔴 여기는 발행 후보 확정이 아니라 작업대다. ADOPT 는 다음 단계(T7-3)의 말이다.
  for (const k of ['ADOPT', 'APPROVE', 'SEED', 'RAW', 'PUBLISH']) {
    check(`🔴 ${k} 가 없다`, !codes.includes(k))
  }
  check('발행이 아님을 문구에 박는다',
    /발행 아님/.test(NOT_PUBLISH_NOTE) && /발행 후보 확정 아님/.test(NOT_PUBLISH_NOTE))
}

console.log('\n③ 산출 — 🔴 원문이 파일에 들어가지 않는다')
{
  check('🔴 bodyHead 컬럼이 없다 — 원문 조각을 초안 파일로 옮기지 않는다',
    !REWRITE_COLUMNS.includes('bodyHead'))
  check('🔴 body 전문 컬럼도 없다', !REWRITE_COLUMNS.includes('body'))
  check('sourceTitle·sourceBodyLength 는 있다 (어느 글에서 왔는지)',
    REWRITE_COLUMNS.includes('sourceTitle') && REWRITE_COLUMNS.includes('sourceBodyLength'))
  check('사람이 쓴 것이 전부 담긴다', ['angle', 'avoid', 'draftTitle', 'draftBody']
    .every((k) => REWRITE_COLUMNS.includes(k)))
  check('겹침 수치를 남긴다', REWRITE_COLUMNS.includes('overlapWithSource'))
  check('누가 썼는지 남긴다', REWRITE_COLUMNS.includes('writtenBy'))
  check('decision 이 첫 컬럼', REWRITE_COLUMNS[0] === 'decision')
}

console.log('\n④ 화면')
{
  const { cards, rejected } = selectRewriteCards([row({ sourceArticleId: 'raw1', bodyLength: 900 })])
  const html = renderHtml(cards, rejected, { bodyHeadChars: BODY_HEAD_CHARS, maxOverlap: COPY_RUN_CHARS })
  for (const k of REWRITE_DECISIONS.map(([x]) => x)) check(`버튼 ${k} 가 있다`, html.includes(`data-k="${k}"`) || html.includes(`['${k}',`))
  for (const k of ['ADOPT', 'APPROVE', 'PUBLISH']) {
    check(`🔴 ${k} 버튼이 없다`, !html.includes(`data-k="${k}"`) && !html.includes(`['${k}',`))
  }
  check('🔴 발행 버튼이 없다', !/<button[^>]*>\s*발행/.test(html))
  check('입력란 넷이 있다 — 각도·버릴 것·새 제목·새 본문',
    ['class="angle"', 'class="avoid"', 'class="dtitle"', 'class="body"'].every((s) => html.includes(s)))
  check('🟡 전문이 아님을 화면이 말한다', html.includes('전문이 아니다'))
  check('🔴 원문 문장을 옮기지 말라고 말한다', html.includes('원문 문장을 옮기지 않는다'))
  check('겹침 경고 기준이 화면에 들어간다', html.includes(String(COPY_RUN_CHARS)))
  check('겹침을 실시간으로 잰다', html.includes('function longestOverlap'))
  check('LLM 이 아니라 사람이 쓰는 자리임을 밝힌다', html.includes('사람이 쓰는 자리'))
  check('미작업만 보기 필터', html.includes('UNDECIDED'))
  check('localStorage 저장·복원', html.includes('localStorage.setItem') && html.includes('localStorage.getItem'))
  check('TSV·JSON 내려받기', html.includes('raw-rewrite-workbench-'))
  check('🔴 누르지 않은 카드는 export 에 없다', html.includes('if (!st.v) return;'))
  check('🔴 발행 후보가 아님을 하단에 적는다', html.includes('발행 후보가 아니다'))
}

console.log('\n⑤ 🔴 외부 네트워크 0')
{
  const { cards, rejected } = selectRewriteCards([row({})])
  const html = renderHtml(cards, rejected, {})
  for (const [label, re] of [
    ['fetch/XHR', /fetch\(|XMLHttpRequest|WebSocket|EventSource/],
    ['외부 script', /<script[^>]+src=/],
    ['외부 style', /<link[^>]+href=/],
    ['동적 import', /\bimport\s*\(/],
  ] as const) check(`🔴 ${label} 없음`, !re.test(html))
  check('🔴 데이터는 인라인 JSON', html.includes('<script type="application/json" id="data">'))
}

console.log('\n⑥ 경로 · 이스케이프')
{
  check('🟢 정상 경로 허용', isInsideDataDir('.microseed-data/raw-rewrite-workbench.html'))
  check('🟢 ./ 접두도 같은 경로', isInsideDataDir('./.microseed-data/x.html'))
  check('🔴 바깥 경로 거부', !isInsideDataDir('docs/x.html'))
  check('🔴 .. 탈출 거부', !isInsideDataDir('.microseed-data/../x.html'))
  check('🔴 비슷한 이름 거부', !isInsideDataDir('.microseed-data-other/x.html'))
  check('HTML 이스케이프', escapeHtml('<script>&"\'') === '&lt;script&gt;&amp;&quot;&#39;')
  const { cards, rejected } = selectRewriteCards([row({ title: '<img src=x onerror=alert(1)>' })])
  check('🔴 제목의 태그가 그대로 실리지 않는다',
    !renderHtml(cards, rejected, {}).includes('<img src=x onerror'))
  check('회차 id 는 YYYYMMDD-HHMMSS', /^\d{8}-\d{6}$/.test(rewriteRunId(new Date())))
}

console.log('\n⑦ 입력 읽기 · 중복 제외')
{
  const dir = mkdtempSync(join(tmpdir(), 'raw-rewrite-'))
  writeFileSync(join(dir, 'raw-originality-approvals-1.json'),
    JSON.stringify({ decisions: [row({ sourceArticleId: 'A', bodyLength: 100 })] }), 'utf-8')
  writeFileSync(join(dir, 'raw-originality-approvals-2.json'),
    JSON.stringify({ decisions: [row({ sourceArticleId: 'A', bodyLength: 999 })] }), 'utf-8')
  const { rows, files } = loadApprovals(dir)
  check('여러 파일을 읽는다', files.length === 2)
  check('🔴 같은 id 는 나중 파일이 이긴다 — 재검수가 최신이다',
    rows.length === 1 && rows[0]!.bodyLength === 999)
  writeFileSync(join(dir, 'raw-originality-approvals-3.tsv'),
    'decision\tsourceArticleId\tbodyLength\nRAW\tB\t50\n', 'utf-8')
  check('TSV 도 읽는다', loadApprovals(dir).rows.some((r) => r.sourceArticleId === 'B'))
  writeFileSync(join(dir, 'raw-rewrite-workbench-1.json'),
    JSON.stringify({ drafts: [{ sourceArticleId: 'A', decision: 'SAVE' },
      { sourceArticleId: 'B', decision: 'HOLD' }] }), 'utf-8')
  const done = handledArticleIds(dir)
  check('🔴 SAVE 한 원천은 처리된 것으로 본다', done.has('A'))
  check('🔴 HOLD 는 처리로 치지 않는다 — 빼면 영영 못 돌아온다', !done.has('B'))
  check('없는 디렉터리는 빈 결과', loadApprovals(join(dir, 'nope')).rows.length === 0
    && handledArticleIds(join(dir, 'nope')).size === 0)
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n⑧ 금지 — 생성기 코드')
{
  const src = readFileSync('scripts/micro-seed-raw-rewrite.mts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [label, re] of [
    ['prisma / DB write', /prisma|PrismaClient|\.upsert\(/i],
    ['Google Sheet', /googleapis|spreadsheet/i],
    ['LLM 호출', /openai|anthropic|claude-|gpt-|messages\.create/i],
    ['브라우저 구동 · 네트워크', /playwright|puppeteer|chromium|fetch\(/],
    ['82cook adapter', /82cook/],
    ['네이버 접속', /cafe\.navercom|cafe\.naver\.com|SESSION_PATH/],
  ] as const) check(`🔴 ${label} 없음`, !re.test(src))
  check('🔴 금지 호칭 없음', !['시니어', '어르신', '노인', '실버'].some((w) => src.includes(w)))
  check('엔트리포인트 가드', /if \(isDirectRun\) main\(\)/.test(src))
  check('🔴 산출 경로를 가드한다', /assertInsideDataDir\(out\)/.test(src))
}

console.log('\n⑨ 실제 승인 파일이 있으면 함께 본다')
try {
  const { rows, files } = loadApprovals('.microseed-data')
  if (files.length === 0) throw new Error('no files')
  const { cards, rejected } = selectRewriteCards(rows, new Set(handledArticleIds('.microseed-data').keys()))
  check(`실 파일 ${files.length}개 · 판정 ${rows.length}건 · 후보 ${cards.length}건`, rows.length > 0)
  check('🔴 후보는 전부 RAW 판정', cards.every((c) => c.reviewDecision === 'RAW'))
  check('🔴 DROP 이 후보에 없다', !cards.some((c) => c.articleId === '448093'))
  check(`🔴 참고 본문이 ${BODY_HEAD_CHARS}자를 넘지 않는다`,
    cards.every((c) => c.headChars <= BODY_HEAD_CHARS))
  check('🔴 승인 파일에 body 전문 필드가 없다',
    !rows.some((r) => Object.prototype.hasOwnProperty.call(r, 'body')))
} catch {
  console.log('  🟡 .microseed-data/raw-originality-approvals-* 없음 — 건너뜀')
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
