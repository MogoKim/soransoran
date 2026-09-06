#!/usr/bin/env tsx
/**
 * Raw Originality 레인 fixture — 🔴 **계약이 어긋나면 여기서 멈춘다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AF
 * 읽기만 한다. 네트워크·DB·파일 쓰기 0.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RAW_LANE, RAW_AXIS, RAW_DECISIONS, RAW_COLUMNS, RAW_MIN_BODY, BODY_HEAD_CHARS,
  NOT_PUBLISH_NOTE, maskSensitive, digestBody, selectRawTargets, prescreen,
  blockedBeforeRead, rawDecisions, heldForReread,
} from './lib/micro-seed-raw-originality.mjs'
import { RAW_MIN_BODY as CLASSIFY_MIN } from './lib/micro-seed-detail-classify.mjs'
import {
  RAW_DETAIL_COLUMNS, RAW_DETAIL_KILL_SWITCH_ENV, ALLOWED_CAPS, DEFAULT_CAP,
  seenRawIds, seenAll, toTsv, isInsideDataDir, assertOutputPath, type RawDetailRow,
} from './micro-seed-raw-detail-fetch.mjs'
import { DETAIL_KILL_SWITCH_ENV } from './micro-seed-detail-fetch.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

console.log('\nRaw Originality 레인 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 낱말 — 다른 화면의 말을 쓰지 않는다')
const codes = RAW_DECISIONS.map(([d]) => d)
check('decision 은 RAW · HOLD · DROP 셋뿐', codes.join(',') === 'RAW,HOLD,DROP')
check('🔴 ADOPT 가 없다 (초안 검수의 말)', !codes.includes('ADOPT'))
check('🔴 APPROVE 가 없다 (SRN 승인의 말)', !codes.includes('APPROVE'))
check('🔴 SEED 가 없다 (소스 승인의 말)', !codes.includes('SEED'))
check('발행이 아님을 문구에 박는다', /발행 아님/.test(NOT_PUBLISH_NOTE) && /Raw Vault 적재 아님/.test(NOT_PUBLISH_NOTE))

console.log('\n② lane 과 axis 를 섞지 않는다')
check(`lane 은 목록 단계의 ${RAW_LANE}`, RAW_LANE === 'originalRaw')
check(`axis 는 상세 판정의 ${RAW_AXIS}`, RAW_AXIS === 'rawOriginality')
check('🔴 둘은 다른 값이다', String(RAW_LANE) !== String(RAW_AXIS))
check('🔴 400자 기준이 detail-classify 와 같다', RAW_MIN_BODY === CLASSIFY_MIN)

console.log('\n③ 본문 — 전문을 저장하지 않는다')
const long = `${'가'.repeat(500)}\n\n두 번째 문단`
const d = digestBody(long)
check(`앞 ${BODY_HEAD_CHARS}자만 남긴다`, [...d.head].length === BODY_HEAD_CHARS)
check('🔴 head 가 원문보다 짧다', [...d.head].length < [...long].length)
check('길이는 자르기 전 값이다', d.length === [...long].length)
check('잘렸음을 표시한다', d.truncated)
check('문단 수를 센다', d.paragraphs === 2)
check('짧은 글은 자르지 않는다', !digestBody('짧은 글').truncated)
check('🔴 컬럼에 body 전문이 없다', !RAW_COLUMNS.includes('body'))
check('bodyHead 컬럼은 있다', RAW_COLUMNS.includes('bodyHead'))

console.log('\n④ 마스킹 — 자르기 전에 지운다')
check('링크를 지운다', maskSensitive('보세요 https://a.b/c 여기').includes('[링크]'))
check('메일을 지운다', maskSensitive('a@b.com 으로').includes('[메일]'))
check('휴대폰을 지운다', maskSensitive('010-1234-5678 로').includes('[연락처]'))
check('일반 번호를 지운다', maskSensitive('02-123-4567 로').includes('[연락처]'))
check('계정을 지운다', maskSensitive('@someone 님이').includes('[계정]'))
{
  // 🔴 경계에 걸친 연락처 — 자르기를 먼저 하면 절반만 남아 마스킹을 빠져나간다
  const body = `${'가'.repeat(BODY_HEAD_CHARS - 5)}010-1234-5678 뒤쪽`
  check('🔴 경계에 걸친 연락처도 지워진다', !/010-1234-5678/.test(digestBody(body).head))
}

console.log('\n⑤ 대상 선정')
const mk = (id: string, lane: string, score: number): { sourceArticleId: string; sourceSite: string; lane: string; score: number; title: string } =>
  ({ sourceArticleId: id, sourceSite: 's', lane, score, title: `제목${id}` })
{
  const rows = [mk('a', 'originalRaw', 10), mk('b', 'infoSeed', 99), mk('c', 'originalRaw', 50), mk('d', 'originalRaw', 30)]
  const t = selectRawTargets(rows, 2, new Set())
  check('🔴 originalRaw 레인만 고른다', t.every((x) => x.lane === RAW_LANE))
  check('점수순으로 고른다', t.map((x) => x.sourceArticleId).join(',') === 'c,d')
  check('cap 을 넘지 않는다', t.length === 2)
  check('🔴 이미 읽은 것은 빼고 고른다',
    selectRawTargets(rows, 10, new Set(['c'])).map((x) => x.sourceArticleId).join(',') === 'd,a')
  check('빈 입력이면 빈 결과', selectRawTargets([], 10, new Set()).length === 0)
}

console.log('\n⑥ 읽기 전 안전 — 생활 사연을 미리 버리지 않는다')
{
  const living = ['남편이랑 크게 싸웠어요', '친정엄마 병원비 어떻게들 하세요', '맞벌이 돈관리 어떻게 하세요', '회사 그만둘까 고민이에요']
  const kept = living.filter((t) =>
    !blockedBeforeRead(prescreen({ sourceArticleId: 'x', sourceSite: 's', lane: RAW_LANE, score: 1, title: t })))
  check(`🟡 가족·부부·돈·일 생활 사연 ${living.length}건이 모두 남는다 (${kept.length}건)`, kept.length === living.length)
}

console.log('\n⑦ 판정 뒤 흐름')
{
  const rows = [{ decision: 'RAW', sourceArticleId: '1' }, { decision: 'HOLD', sourceArticleId: '2' },
    { decision: 'DROP', sourceArticleId: '3' }, { decision: '', sourceArticleId: '4' }]
  check('RAW 만 다음 단계로', rawDecisions(rows).map((r) => r.sourceArticleId).join(',') === '1')
  check('HOLD 는 다시 볼 대상으로 남는다', heldForReread(rows).map((r) => r.sourceArticleId).join(',') === '2')
  check('🔴 미선택은 어느 쪽도 아니다', !rawDecisions(rows).some((r) => r.sourceArticleId === '4'))
}

console.log('\n⑨ raw-detail-fetch — 저장 계약 (T1)')
check('🔴 컬럼에 body 전문이 없다', !RAW_DETAIL_COLUMNS.includes('body'))
check('bodyHead 컬럼이 있다', RAW_DETAIL_COLUMNS.includes('bodyHead'))
check('bodyLength 는 자르기 전 길이', RAW_DETAIL_COLUMNS.includes('bodyLength'))
check('지시된 16컬럼이 모두 있다', [
  'sourceArticleId', 'sourceSite', 'url', 'title', 'score', 'lane', 'accessStatus',
  'bodyLength', 'bodyHead', 'axis', 'safetyVerdict', 'safetyReasons',
  'imageCount', 'commentCount', 'runId', 'fetchedAt',
].every((c) => RAW_DETAIL_COLUMNS.includes(c)))
check('🔴 스위치가 detail-fetch 것과 다르다',
  RAW_DETAIL_KILL_SWITCH_ENV === 'SORAN_NAVERCAFE_RAW_DETAIL_ENABLED'
  && String(RAW_DETAIL_KILL_SWITCH_ENV) !== String(DETAIL_KILL_SWITCH_ENV))
check('cap 은 10 또는 20 만', ALLOWED_CAPS.join(',') === '10,20' && DEFAULT_CAP === 10)
{
  const row: RawDetailRow = {
    sourceArticleId: 'a', sourceSite: 's', url: 'u', title: 't', score: 1, lane: RAW_LANE,
    accessStatus: 'ok', bodyLength: 900, bodyHead: '앞부분', axis: RAW_AXIS,
    safetyVerdict: 'pass', safetyReasons: '', imageCount: 0, commentCount: 0,
    runId: 'r', fetchedAt: 'f',
  }
  const t = toTsv([row])
  check('TSV 첫 줄이 컬럼과 같다', t.split('\n')[0] === RAW_DETAIL_COLUMNS.join('\t'))
  check('🔴 원문 전문이 실릴 자리가 없다',
    t.split('\n')[0]!.split('\t').length === RAW_DETAIL_COLUMNS.length)
}
{
  // 🔴 `.raw-detail.jsonl` 은 `.detail.jsonl` 로 끝나지 않는다 — 그래서 별도 함수가 필요하다
  check('🔴 raw-detail 파일명이 detail 규칙에 안 걸린다', !'x.raw-detail.jsonl'.endsWith('.detail.jsonl'))
  const dir = mkdtempSync(join(tmpdir(), 'raw-seen-'))
  writeFileSync(join(dir, 'raw-detail-1.raw-detail.jsonl'), `${JSON.stringify({ sourceArticleId: 'RAWID' })}\n`, 'utf-8')
  writeFileSync(join(dir, 'detail-1.detail.jsonl'), `${JSON.stringify({ sourceArticleId: 'DETID' })}\n`, 'utf-8')
  check('raw-detail 에서 읽은 id 를 잡는다', seenRawIds(dir).has('RAWID'))
  check('🔴 seenAll 이 양쪽을 합친다', seenAll(dir).has('RAWID') && seenAll(dir).has('DETID'))
  writeFileSync(join(dir, 'raw-detail-2.raw-detail.jsonl'), '{깨짐\n', 'utf-8')
  check('깨진 줄이 있어도 죽지 않는다', seenRawIds(dir).has('RAWID'))
  check('없는 디렉터리는 빈 목록', seenRawIds(join(dir, 'nope')).size === 0)
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n⑨-2 산출 경로 가드 — 🔴 **실제로 불러 본다**')
{
  // 🔴 왜 실호출인가. 2026-09-06 에 live 로 10건을 읽고도 산출물을 한 줄도 못 썼다.
  //    `SCOUT_DATA_DIR` 이 './.microseed-data' 인데 relative() 는 '.microseed-data/…' 를
  //    돌려주어, 상수를 이어 붙인 비교가 **언제나 거짓**이었다.
  //    그때 fixture 는 소스에 문자열이 있는지만 봤다 — 있었고, 그래서 통과했다.
  //    **불러 보지 않는 시험은 이 사고를 잡지 못한다.**
  check('🟢 정상 산출 경로를 허용한다',
    isInsideDataDir('.microseed-data/raw-detail-20260101-000000.raw-detail.jsonl'))
  check('🟢 ./ 가 붙어도 같은 경로다',
    isInsideDataDir('./.microseed-data/raw-detail-20260101-000000.raw-detail.tsv'))
  check('🟢 하위 디렉터리도 허용', isInsideDataDir('.microseed-data/sub/x.jsonl'))
  check('🔴 바깥 경로는 거부한다', !isInsideDataDir('docs/x.jsonl'))
  check('🔴 상위로 빠져나가는 경로는 거부한다', !isInsideDataDir('.microseed-data/../x.jsonl'))
  check('🔴 절대경로로 우회해도 거부한다', !isInsideDataDir('/tmp/x.jsonl'))
  check('🔴 디렉터리 자신은 산출 경로가 아니다', !isInsideDataDir('.microseed-data'))
  check('🔴 비슷한 이름에 속지 않는다', !isInsideDataDir('.microseed-data-other/x.jsonl'))
  // 🔴 assertOutputPath 자체도 불러 본다 — 정상 경로에서 죽지 않아야 한다
  let threw = false
  try { assertOutputPath('.microseed-data/raw-detail-20260101-000000.raw-detail.jsonl') }
  catch { threw = true }
  check('🔴 정상 경로에서 assertOutputPath 가 멈추지 않는다', !threw)
}

console.log('\n⑨-3 env 로딩 — 🔴 await 를 빠뜨리지 않는다')
{
  const src = readFileSync('scripts/micro-seed-raw-detail-fetch.mts', 'utf-8')
  // 🔴 loadEnvLocal 은 async 다. await 없이 부르면 .env.local 의 스위치를 못 읽어
  //    "켰는데 안 열린다" 가 된다 — 저장소의 다른 스크립트는 모두 await 를 쓴다.
  check('🔴 await loadEnvLocal() 로 부른다', /await loadEnvLocal\(\)/.test(src))
  check('🔴 await 없는 호출이 남아 있지 않다', !/(?<!await )\bloadEnvLocal\(\)/.test(src))
}


console.log('\n⑩ raw-detail-fetch — 🔴 full body 저장 경로가 없다')
{
  const src = readFileSync('scripts/micro-seed-raw-detail-fetch.mts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('🔴 body 가 digestBody 를 거쳐서만 나간다', /digestBody\(body\)/.test(src))
  check('🔴 bodyHead 는 digest 에서 온다', /bodyHead:\s*digest\.head/.test(src))
  check('🔴 저장 객체에 body 를 담지 않는다', !/^\s*body,\s*$/m.test(src) && !/\bbody:\s*body\b/.test(src))
  check('🔴 SRN 식 조건부 body 저장이 없다', !/shortRawNoindex.*\{\s*body\s*\}/.test(src))
  check('🔴 prisma / DB write 없음', !/prisma|PrismaClient|\.upsert\(/i.test(src))
  check('🔴 Google Sheet 없음', !/googleapis|spreadsheet/i.test(src))
  check('🔴 LLM 없음', !/openai|anthropic|claude-|gpt-/i.test(src))
  check('🔴 82cook adapter 없음', !/82cook/.test(src))
  check('🔴 금지 호칭 없음', !['시니어', '어르신', '노인', '실버'].some((w) => src.includes(w)))
  check('두 스위치를 모두 본다',
    /argv\.includes\('--live'\)/.test(src) && /RAW_DETAIL_KILL_SWITCH_ENV\]/.test(src))
  check('🔴 스위치가 없으면 write 전에 돌아 나간다', /if \(!LIVE \|\| !switchOn\)/.test(src))
  check('pacing 을 detail-fetch 에서 가져온다', /PACE_MIN_MS, PACE_MAX_MS/.test(src))
  check('엔트리포인트 가드가 있다', /if \(isDirectRun\) void main\(\)/.test(src))
  check('산출 경로가 .raw-detail 이다', /raw-detail-\$\{runId\}\.raw-detail\.(jsonl|tsv)/.test(src))
}


console.log('\n⑧ 금지 — lib 과 계획 CLI 에 위험한 것이 없다')
{
  // 🔴 주석을 지우고 본다 — 주석에 적힌 금지어가 자기 자신을 잡으면 안 된다
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const files = ['scripts/lib/micro-seed-raw-originality.mts', 'scripts/micro-seed-raw-originality-plan.mts']
  const banned: readonly (readonly [string, RegExp])[] = [
    ['prisma / DB write', /prisma|PrismaClient|\.create\(|\.upsert\(/],
    ['Google Sheet', /googleapis|spreadsheet/i],
    ['LLM 호출', /openai|anthropic|claude-|gpt-|messages\.create/i],
    ['브라우저 · 네트워크', /playwright|puppeteer|chromium|fetch\(|axios/],
    ['파일 쓰기', /writeFileSync|appendFileSync|mkdirSync/],
    ['82cook adapter', /82cook/],
  ]
  for (const [label, re] of banned) {
    const hit = files.filter((f) => re.test(codeOf(f)))
    check(`🔴 ${label} 없음`, hit.length === 0)
  }
  // 🔴 시니어·어르신 계열 금지어
  const bad = ['시니어', '어르신', '노인', '실버'].filter((w) => files.some((f) => codeOf(f).includes(w)))
  check('🔴 금지 호칭 없음', bad.length === 0)
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
