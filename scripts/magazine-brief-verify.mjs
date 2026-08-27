#!/usr/bin/env node
/**
 * brief 게이트 검사 — 사람 승인 없이 fetch 로 넘어가도 되는지 판정한다
 *
 * 읽기만 한다. 아무것도 쓰지 않는다.
 *
 * 사용법
 *   node scripts/magazine-brief-verify.mjs <slug|경로> [...]
 *   node scripts/magazine-brief-verify.mjs --all          brief.md 가 있는 전부
 *   node scripts/magazine-brief-verify.mjs --run 2026-08-26   그날 producer 선정분
 *   node scripts/magazine-brief-verify.mjs --self-test    규칙 자체를 검사한다
 *   ... --json
 *
 * 종료 코드: 하나라도 실패면 1
 *
 * 🔴 --self-test 는 왜 있는가
 *    게이트가 "통과시키는 것" 만 확인하면 반쪽이다. 7-D-13-C 같은 위반을
 *    **실제로 잡는지** 를 봐야 한다. fixture 를 파일로 만들지 않고
 *    여기 인라인으로 둔다 — drafts/ 에 가짜 brief 를 남기지 않기 위해서다.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { DRAFTS_DIR, ROOT, evalLiteral, loadQueue, sliceLiteral } from './lib/magazine-load.mjs'
import { assertQaWordsInSync, GATES, verifyBrief } from './lib/magazine-brief-policy.mjs'

const RUNS_DIR = join(DRAFTS_DIR, '_runs')

function resolveDir(arg) {
  if (isAbsolute(arg)) return arg
  if (arg.includes('/')) return join(ROOT, arg)
  return join(DRAFTS_DIR, arg)
}

/** review.ts 의 REVIEW 리터럴을 꺼낸다. batch-qa 와 같은 방식이다 */
function loadReview(dir) {
  const file = join(dir, 'review.ts')
  if (!existsSync(file)) return null
  const src = readFileSync(file, 'utf8')
  const anchor = src.indexOf('export const REVIEW')
  if (anchor === -1) return null
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  return literal ? evalLiteral(literal, `${basename(dir)}/review.ts`) : null
}

function inspect(dir, queueBySlug) {
  const slug = basename(dir)
  const briefPath = join(dir, 'brief.md')
  if (!existsSync(briefPath)) {
    return { slug, verdict: 'NO_BRIEF', results: [], detail: 'brief.md 가 없다' }
  }
  const briefText = readFileSync(briefPath, 'utf8')
  const review = loadReview(dir)
  const queueItem = queueBySlug.get(slug) ?? null
  const { ok, results } = verifyBrief({ briefText, review, queueItem })
  return { slug, verdict: ok ? 'PASS' : 'FAIL', results, hasReview: Boolean(review) }
}

// ─────────────────────────────────────────────────────────
// self-test — 게이트가 실제로 잡는지 본다
// ─────────────────────────────────────────────────────────

const OK_BRIEF = [
  '## 검색 의도',
  '검색어 넷.',
  '## 대상 독자',
  '장면 넷.',
  '## 도입에서 해야 할 것',
  '장면으로 연다.',
  '## 글 구조 (h2 5개)',
  'h2 다섯.',
  '## 반드시 그대로 넣을 문장 5개',
  '```',
  '1. 사람마다 다릅니다.',
  '2. 언제부터인지는 저마다 다릅니다.',
  '3. 몸에 문제가 생겼다는 뜻은 아닙니다.',
  '4. 오래간다면 병원에서 확인해 보시는 편이 좋습니다.',
  '5. 그다음에 더 힘들어지기도 합니다.',
  '```',
  '## 절대 쓰지 말 것',
  '진단명.',
].join('\n')

const OK_SENTENCES = [
  '사람마다 다릅니다.',
  '언제부터인지는 저마다 다릅니다.',
  '몸에 문제가 생겼다는 뜻은 아닙니다.',
  '오래간다면 병원에서 확인해 보시는 편이 좋습니다.',
  '그다음에 더 힘들어지기도 합니다.',
]

const OK_REVIEW = {
  slug: 'ok-slug',
  summary: ['한 줄', '두 줄', '세 줄', '네 줄', '다섯 줄'],
  riskSentences: OK_SENTENCES,
  risk: { medical: 'MEDIUM', money: 'NONE', legal: 'NONE' },
  factsToVerify: ['이 판단에 동의하는가'],
  forbiddenPatterns: ['아토피', '건선'],
  preparedAt: '2026-08-27',
  preparedBy: 'Claude Code',
  notes: '자기검사용 fixture',
}

/** [이름, 기대 실패 게이트(null=통과), brief, review, queueItem] */
function selfTestCases() {
  const q = { riskLevel: 'MEDIUM' }
  return [
    ['정상 — 전부 통과', null, OK_BRIEF, OK_REVIEW, q],

    // 🔴 7-D-13-C 재현: forbiddenPatterns 단어를 "반드시 넣을 문장" 에 씀
    [
      '7-D-13-C 재현 — 금지 패턴이 넣을 문장에 있다',
      'G3',
      OK_BRIEF.replace('3. 몸에 문제가', '3. 아토피가 아니라 몸에 문제가'),
      { ...OK_REVIEW, riskSentences: OK_SENTENCES.map((s, i) => (i === 2 ? '아토피가 아니라 몸에 문제가 생겼다는 뜻은 아닙니다.' : s)) },
      q,
    ],
    [
      '공통 의료 단정("반드시")이 넣을 문장에 있다',
      'G3',
      OK_BRIEF.replace('1. 사람마다', '1. 반드시 사람마다'),
      { ...OK_REVIEW, riskSentences: OK_SENTENCES.map((s, i) => (i === 0 ? '반드시 사람마다 다릅니다.' : s)) },
      q,
    ],
    ['금지 호칭("어르신")이 넣을 문장에 있다', 'G3',
      OK_BRIEF.replace('1. 사람마다', '1. 어르신마다'),
      { ...OK_REVIEW, riskSentences: OK_SENTENCES.map((s, i) => (i === 0 ? '어르신마다 다릅니다.' : s)) }, q],

    ['forbiddenPatterns 가 빈 배열', 'G4', OK_BRIEF, { ...OK_REVIEW, forbiddenPatterns: [] }, q],

    // 🔴 2026-08-27 재현: 스키마를 어긴 review 가 게이트를 통과해 build 를 깨뜨렸다
    ['summary 가 없다', 'G7', OK_BRIEF, { ...OK_REVIEW, summary: undefined }, q],
    ['factsToVerify 가 비어 있다', 'G7', OK_BRIEF, { ...OK_REVIEW, factsToVerify: [] }, q],
    ['notes 가 비어 있다', 'G7', OK_BRIEF, { ...OK_REVIEW, notes: '  ' }, q],
    ['preparedAt 형식이 다르다', 'G7', OK_BRIEF, { ...OK_REVIEW, preparedAt: '2026/08/27' }, q],
    ['스키마에 없는 필드가 있다', 'G7', OK_BRIEF, { ...OK_REVIEW, reviewMode: 'RISK_SENTENCES' }, q],
    ['forbiddenPatterns 자체가 없음', 'G4', OK_BRIEF, { ...OK_REVIEW, forbiddenPatterns: undefined }, q],

    ['HIGH 는 auto-brief HOLD', 'G5', OK_BRIEF, OK_REVIEW, { riskLevel: 'HIGH' }],
    ['LOW 는 대상에 포함', null, OK_BRIEF, { ...OK_REVIEW, risk: { medical: 'LOW', money: 'NONE' } }, { riskLevel: 'LOW' }],
    ['MEDIUM 은 대상에 포함', null, OK_BRIEF, OK_REVIEW, q],

    ['TODO 가 남아 있다', 'G1', OK_BRIEF + '\n<!-- TODO(세션): 여기 채운다 -->', OK_REVIEW, q],
    ['필수 섹션이 빠졌다', 'G1', OK_BRIEF.replace('## 대상 독자', '## 다른 제목'), OK_REVIEW, q],

    ['brief 5문장과 review 가 다르다', 'G2',
      OK_BRIEF, { ...OK_REVIEW, riskSentences: OK_SENTENCES.map((s, i) => (i === 1 ? s + ' 조금 다름' : s)) }, q],
    ['MEDIUM 인데 riskSentences 가 없다', 'G2',
      OK_BRIEF, { ...OK_REVIEW, riskSentences: [] }, q],

    ['의료 MEDIUM 인데 진료 권고가 없다', 'G6',
      OK_BRIEF.replace('4. 오래간다면 병원에서 확인해 보시는 편이 좋습니다.', '4. 오래가기도 합니다.'),
      { ...OK_REVIEW, riskSentences: OK_SENTENCES.map((s, i) => (i === 3 ? '오래가기도 합니다.' : s)) }, q],
    ['재무 MEDIUM 인데 공식 기관 권고가 없다', 'G6',
      OK_BRIEF.replace('4. 오래간다면 병원에서 확인해 보시는 편이 좋습니다.', '4. 오래가기도 합니다.'),
      {
        ...OK_REVIEW,
        risk: { medical: 'NONE', money: 'MEDIUM' },
        riskSentences: OK_SENTENCES.map((s, i) => (i === 3 ? '오래가기도 합니다.' : s)),
      }, q],
    ['재무 MEDIUM + 공단 확인 문장 있음', null,
      OK_BRIEF.replace('4. 오래간다면 병원에서 확인해 보시는 편이 좋습니다.', '4. 실제 금액은 공단에서 확인하는 것이 정확합니다.'),
      {
        ...OK_REVIEW,
        risk: { medical: 'NONE', money: 'MEDIUM' },
        riskSentences: OK_SENTENCES.map((s, i) => (i === 3 ? '실제 금액은 공단에서 확인하는 것이 정확합니다.' : s)),
      }, q],
  ]
}

function runSelfTest() {
  console.log('')
  console.log('  brief 정책 self-test')
  console.log('')
  let failed = 0

  try {
    assertQaWordsInSync()
    console.log('  ✅ magazine-qa.mjs 금지어와 동기화됨')
  } catch (err) {
    failed++
    console.log(`  🔴 금지어 drift — ${err.message}`)
  }
  console.log('')

  for (const [name, expectGate, briefText, review, queueItem] of selfTestCases()) {
    const { ok, results } = verifyBrief({ briefText, review, queueItem })
    const failedGates = results.filter((r) => !r.ok).map((r) => r.gate)
    const pass = expectGate === null ? ok : !ok && failedGates.includes(expectGate)
    if (!pass) failed++
    const want = expectGate === null ? '통과' : `${expectGate} 실패`
    const got = ok ? '통과' : `${failedGates.join(',')} 실패`
    console.log(`  ${pass ? '✅' : '🔴'} ${name.padEnd(38)} 기대=${want.padEnd(10)} 실제=${got}`)
  }

  console.log('')
  console.log(`  ${failed === 0 ? '✅ 전부 통과' : `🔴 ${failed}건 실패`}`)
  console.log('')
  return failed === 0 ? 0 : 1
}

// ─────────────────────────────────────────────────────────

function help() {
  console.log(`brief 게이트 검사 (읽기 전용)

  node scripts/magazine-brief-verify.mjs <slug|경로> [...]
  node scripts/magazine-brief-verify.mjs --all
  node scripts/magazine-brief-verify.mjs --run YYYY-MM-DD
  node scripts/magazine-brief-verify.mjs --self-test
  ... --json

게이트
${Object.entries(GATES).map(([k, v]) => `  ${k}  ${v}`).join('\n')}`)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('--help')) return help()
  if (argv.includes('--self-test')) process.exit(runSelfTest())

  const asJson = argv.includes('--json')
  const queueBySlug = new Map(loadQueue().map((x) => [x.slug, x]))

  let dirs = []
  const ri = argv.indexOf('--run')
  if (argv.includes('--all')) {
    dirs = readdirSync(DRAFTS_DIR)
      // _template 은 형식 예시다. "예시 문장을 지우지 않고 발행하면 FAIL" 이 설계다(runbook)
      .filter((n) => n !== '_runs' && n !== '_template' && existsSync(join(DRAFTS_DIR, n, 'brief.md')))
      .map((n) => join(DRAFTS_DIR, n))
  } else if (ri !== -1 && argv[ri + 1]) {
    const sel = join(RUNS_DIR, argv[ri + 1], 'selected')
    if (!existsSync(sel)) {
      console.error(`  ${sel} 이 없다.`)
      process.exit(2)
    }
    dirs = readdirSync(sel).map((n) => join(DRAFTS_DIR, n))
  } else {
    dirs = argv.filter((a) => !a.startsWith('--')).map(resolveDir)
  }

  const reports = dirs.map((d) => inspect(d, queueBySlug))

  if (asJson) {
    console.log(JSON.stringify({ total: reports.length, reports }, null, 2))
  } else {
    console.log('')
    for (const r of reports) {
      const mark = r.verdict === 'PASS' ? '✅' : r.verdict === 'NO_BRIEF' ? '⚪' : '🔴'
      console.log(`  ${mark} ${r.slug}  ${r.verdict}${r.detail ? ` — ${r.detail}` : ''}`)
      for (const g of r.results.filter((x) => !x.ok)) {
        console.log(`       ${g.gate}  ${g.detail}`)
      }
    }
    const pass = reports.filter((r) => r.verdict === 'PASS').length
    const fail = reports.filter((r) => r.verdict === 'FAIL').length
    const none = reports.filter((r) => r.verdict === 'NO_BRIEF').length
    console.log('')
    console.log(`  PASS ${pass} · FAIL ${fail} · brief 없음 ${none}`)
    console.log('')
  }

  process.exit(reports.some((r) => r.verdict === 'FAIL') ? 1 : 0)
}

main()
