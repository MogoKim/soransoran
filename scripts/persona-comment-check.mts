#!/usr/bin/env tsx
/**
 * 댓글 후보 판정부 fixture — 네트워크 · DB · LLM 없이 계약을 검증한다
 *
 * 🔴 검사하는 것은 "잘 잡는가" 가 아니라 **"선을 넘지 않는가"** 다:
 *      ① assertNoSourceLeak 을 try/catch 로 감싸지 않는가
 *         — 그 함수는 throw 하지 않는다. 감싸면 유출을 전부 놓친다 (실제로 겪었다)
 *      ② 미실행 관문을 pass 로 보고하지 않는가
 *      ③ 반환값에 후보 본문이 없는가
 *      ④ DB · LLM 경로가 들어오지 않는가
 *
 * 🔴 텍스트는 전부 합성이다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkCommentCandidate, summarizeCandidates, type CandidateVerdict,
} from './lib/persona-comment-candidate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, 'lib/persona-comment-candidate.mts')
const RUNNER = join(HERE, 'persona-comment-dry-run.mts')

const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string) => report.push({ ok: true, kind, name, detail })
const bad = (name: string, kind: string, detail: string) => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}
const stripComments = (raw: string): string =>
  raw.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/|--)/.test(l)).join('\n')

const libCode = stripComments(readFileSync(LIB, 'utf-8'))
const runnerCode = stripComments(readFileSync(RUNNER, 'utf-8'))

const SOURCE = ['시어머니 모시는 게 이렇게 힘든 줄 몰랐어요 매일 병원 모시고 다니느라']

// ── ① 20자 유출을 잡는가 ──────────────────────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P05',
    text: '시어머니 모시는 게 이렇게 힘든 줄 몰랐어요 매일 병원',
    sourceTexts: SOURCE,
  })
  const g = v.gates.find((x) => x.gate === '①')
  if (!v.sourceLeak) bad('① 20자 유출 검출', 'guard', '🔴 유출을 놓쳤다')
  else if (g?.outcome !== 'regenerate') bad('① 20자 유출 검출', 'guard', `🔴 ①=${g?.outcome}`)
  else if (v.status !== 'regenerate') bad('① 20자 유출 검출', 'guard', `🔴 status=${v.status}`)
  else ok('① 20자 유출 검출', 'guard', 'sourceLeak · ① regenerate · SEED_TOO_CLOSE')
}

// ── ① 유출 없으면 통과 ────────────────────────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '저도 그맘때 그랬어요... 지금도 가끔 그러네요', sourceTexts: SOURCE,
  })
  if (v.sourceLeak) bad('① 정상은 통과', 'case', '🔴 정상 후보를 유출로 잡았다')
  else if (v.status !== 'pass') bad('① 정상은 통과', 'case', `🔴 ${v.status} (${v.reason})`)
  else ok('① 정상은 통과', 'case', 'pass')
}

// ── ⑤ 금지 호칭 ──────────────────────────────────────
{
  const v = checkCommentCandidate({ personaCode: 'P07', text: '우리 또래분들 다 그러시더라구요', sourceTexts: SOURCE })
  const g = v.gates.find((x) => x.gate === '⑤')
  if (g?.outcome !== 'regenerate') bad('⑤ 금지 호칭', 'case', `🔴 ⑤=${g?.outcome}`)
  else ok('⑤ 금지 호칭', 'case', 'regenerate')
}

// ── ⑨ 출처 marker ────────────────────────────────────
{
  const v = checkCommentCandidate({ personaCode: 'P10', text: '82님들 말씀처럼 등업하고 보니', sourceTexts: SOURCE })
  const g = v.gates.find((x) => x.gate === '⑨')
  if (g?.outcome !== 'regenerate') bad('⑨ 출처 marker', 'case', `🔴 ⑨=${g?.outcome}`)
  else if (!v.aiToneTags.includes('SOURCE_TRACE')) bad('⑨ 출처 marker', 'case', '🔴 태그 없음')
  else ok('⑨ 출처 marker', 'case', 'regenerate · SOURCE_TRACE')
}

// ── ⑥-A 닉네임 혼입 ──────────────────────────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '봄뜰하나님 말씀이 맞아요', sourceTexts: SOURCE, knownNames: ['봄뜰하나'],
  })
  const g = v.gates.find((x) => x.gate === '⑥')
  if (g?.outcome !== 'regenerate') bad('⑥-A 닉네임 혼입', 'case', `🔴 ⑥=${g?.outcome}`)
  else if (/봄뜰하나/.test(JSON.stringify(v))) bad('⑥-A 닉네임 혼입', 'guard', '🔴 반환값에 닉네임이 있다')
  else ok('⑥-A 닉네임 혼입', 'case', 'regenerate · 개수만 보고')
}

// ── 금지 역할 — 🔴 스킵하지 않는다 ──────────────────
//    이전 판은 분류가 기대와 다르면 "케이스 성립 안 함" 으로 성공 처리했다.
//    그러면 금지 역할이 동작하지 않아도 fixture 가 통과한다.
{
  // classifyReaction 의 EXPERIENCE 패턴(겪었·해봤·다녀왔…)에 걸리는 합성 문장
  const text = '저도 작년에 그거 겪었어요'
  const v = checkCommentCandidate({
    personaCode: 'P15', text, sourceTexts: SOURCE, forbiddenRoles: ['experience'],
  })
  if (v.reactionType !== 'experience') {
    // 🔴 분류가 기대와 다르면 실패다. 케이스가 성립하지 않으면 검증이 아니다
    bad('금지 역할', 'case', `🔴 분류가 ${v.reactionType} — experience 케이스가 성립하지 않는다`)
  } else if (v.status !== 'regenerate') {
    bad('금지 역할', 'case', `🔴 ${v.status} (${v.reason})`)
  } else if (!v.aiToneTags.includes('IDENTITY_CONFLICT')) {
    bad('금지 역할', 'case', '🔴 IDENTITY_CONFLICT 태그 없음')
  } else ok('금지 역할', 'case', 'experience 금지 → regenerate · IDENTITY_CONFLICT')
}

// ── 금지 역할이 아니면 통과 ─────────────────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '저도 작년에 그거 겪었어요', sourceTexts: SOURCE, forbiddenRoles: [],
  })
  if (v.reactionType !== 'experience') bad('금지 아니면 통과', 'case', `🔴 분류 ${v.reactionType}`)
  else if (v.status !== 'pass') bad('금지 아니면 통과', 'case', `🔴 ${v.status} (${v.reason})`)
  else ok('금지 아니면 통과', 'case', 'experience 허용 → pass')
}

// ── 🔴 ① sourceTexts 가 비면 pass 가 아니다 ─────────
{
  const v = checkCommentCandidate({ personaCode: 'P05', text: '그러네요 저도 그래요', sourceTexts: [] })
  const g = v.gates.find((x) => x.gate === '①')
  if (g?.outcome !== 'regenerate') bad('① 검사 불가는 pass 아님', 'guard', `🔴 ①=${g?.outcome}`)
  else if (v.status === 'pass') bad('① 검사 불가는 pass 아님', 'guard', '🔴 status=pass')
  else ok('① 검사 불가는 pass 아님', 'guard', 'sourceTexts 없음 → regenerate')
}

// ── 🔴 위험 조언은 pass 가 아니다 ───────────────────
{
  const assertive = checkCommentCandidate({
    personaCode: 'P17', text: '그거 병원 가서 검사받으셔야 합니다',
    sourceTexts: SOURCE, adviceForbidden: true,
  })
  const soft = checkCommentCandidate({
    personaCode: 'P17', text: '저도 그때 병원 가봤는데 마음이 좀 놓이더라구요',
    sourceTexts: SOURCE, adviceForbidden: true,
  })
  const offenders: string[] = []
  if (assertive.status !== 'regenerate') offenders.push(`단정형이 ${assertive.status}`)
  if (!assertive.aiToneTags.includes('ADVICE_RISK')) offenders.push('단정형 ADVICE_RISK 없음')
  if (soft.status === 'pass') offenders.push('조언 신호가 pass')
  if (offenders.length) bad('위험 조언은 pass 아님', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('위험 조언은 pass 아님', 'guard', `단정형 regenerate · 신호 ${soft.status}`)
}

// ── 🔴 조언 금지가 아니면 태그도 판정도 없다 ─────────
{
  const v = checkCommentCandidate({
    personaCode: 'P17', text: '그거 병원 가서 검사받으셔야 합니다', sourceTexts: SOURCE,
  })
  if (v.aiToneTags.includes('ADVICE_RISK')) bad('조언 금지 아닌 유형', 'case', '🔴 태그가 붙었다')
  else ok('조언 금지 아닌 유형', 'case', 'adviceForbidden 없으면 판정하지 않는다')
}

// ── 🔴 구조화 나열은 regenerate ─────────────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P15', text: '- 첫째 병원\n- 둘째 약\n**꼭이요**', sourceTexts: SOURCE,
  })
  const g = v.gates.find((x) => x.gate === '⑧')
  if (g?.outcome !== 'regenerate') bad('⑧ 구조화 나열', 'guard', `🔴 ⑧=${g?.outcome}`)
  else if (v.status !== 'regenerate') bad('⑧ 구조화 나열', 'guard', `🔴 status=${v.status}`)
  else if (!v.aiToneTags.includes('TOO_TIDY')) bad('⑧ 구조화 나열', 'guard', '🔴 태그 없음')
  else ok('⑧ 구조화 나열', 'guard', 'regenerate · TOO_TIDY')
}

// ── NO_LIFE_MARKS 는 태그만 (판정 아님) ─────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '그런 일이 있었군', sourceTexts: SOURCE,
  })
  if (!v.aiToneTags.includes('NO_LIFE_MARKS')) {
    ok('NO_LIFE_MARKS 는 태그만', 'case', '표지가 있어 태그 없음 — 정상')
  } else if (v.status !== 'pass') {
    bad('NO_LIFE_MARKS 는 태그만', 'case', `🔴 ${v.status} — 태그가 판정으로 샜다`)
  } else ok('NO_LIFE_MARKS 는 태그만', 'case', 'pass 유지')
}

// ── AI 티 태그 ───────────────────────────────────────
{
  const tidy = checkCommentCandidate({ personaCode: 'P15', text: '- 첫째\n- 둘째\n**꼭**', sourceTexts: SOURCE })
  const advice = checkCommentCandidate({
    personaCode: 'P17', text: '그거 병원 가서 검사받으셔야 합니다', sourceTexts: SOURCE, adviceForbidden: true,
  })
  const offenders: string[] = []
  if (!tidy.aiToneTags.includes('TOO_TIDY')) offenders.push('TOO_TIDY 미검출')
  if (!tidy.aiToneTags.includes('NO_LIFE_MARKS')) offenders.push('NO_LIFE_MARKS 미검출')
  // 🔴 조언 위험은 reactionType 이 아니라 문구로도 잡아야 한다
  if (!advice.aiToneTags.includes('ADVICE_RISK')) offenders.push('ADVICE_RISK 미검출')
  if (offenders.length) bad('AI 티 태그', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('AI 티 태그', 'case', 'TOO_TIDY · NO_LIFE_MARKS · ADVICE_RISK')
}

// ── 🔴 미실행 관문을 pass 로 보고하지 않는가 ───────────
{
  const v = checkCommentCandidate({ personaCode: 'P05', text: '그러네요', sourceTexts: SOURCE })
  const notRun = v.gates.filter((g) => g.outcome === 'notRun').map((g) => g.gate)
  const expected = ['②', '③', '④']
  const missing = expected.filter((g) => !notRun.includes(g as never))
  if (missing.length > 0) bad('미실행은 notRun', 'guard', `🔴 ${missing.join(' ')} 가 notRun 이 아니다`)
  else if (v.gates.length !== 9) bad('미실행은 notRun', 'guard', `🔴 관문 ${v.gates.length}/9`)
  else ok('미실행은 notRun', 'guard', `9관문 · notRun ${notRun.length}종`)
}

// ── 🔴 반환값에 본문이 없는가 ────────────────────────
{
  const text = '아주 특이한합성문장입니다여기만있는말'
  const v = checkCommentCandidate({ personaCode: 'P05', text, sourceTexts: SOURCE })
  if (JSON.stringify(v).includes(text)) bad('반환값에 본문 없음', 'guard', '🔴 본문이 반환값에 있다')
  else ok('반환값에 본문 없음', 'guard', '관문 코드 · 태그 · 길이만')
}

// ── 집계 ─────────────────────────────────────────────
{
  const list: CandidateVerdict[] = [
    checkCommentCandidate({ personaCode: 'P05', text: '그러네요', sourceTexts: SOURCE }),
    checkCommentCandidate({ personaCode: 'P07', text: '우리 또래분들', sourceTexts: SOURCE }),
  ]
  const s = summarizeCandidates(list)
  if (s.total !== 2) bad('집계', 'case', `🔴 total=${s.total}`)
  else if (s.byStatus.regenerate < 1) bad('집계', 'case', '🔴 regenerate 미집계')
  else ok('집계', 'case', `total 2 · regenerate ${s.byStatus.regenerate}`)
}

// ── 🔴 소스 스캔 ─────────────────────────────────────
{
  const offenders: string[] = []
  for (const key of ['PrismaClient', 'prisma.', 'fetch(', 'readFileSync', 'process.env']) {
    if (libCode.includes(key)) offenders.push(`판정부가 ${key} 를 쓴다`)
  }
  // 🔴 assertNoSourceLeak 을 try/catch 로 감싸면 유출을 놓친다 — 실제로 겪은 결함이다
  if (/try\s*\{[\s\S]{0,200}assertNoSourceLeak/.test(libCode)) {
    offenders.push('🔴 assertNoSourceLeak 이 try 블록 안에 있다 — 그 함수는 throw 하지 않는다')
  }
  if (!/\.leaked/.test(libCode)) offenders.push('🔴 assertNoSourceLeak 의 반환값을 보지 않는다')
  // 🔴 발행 경로가 들어오지 않았는가
  for (const key of ['--apply', 'publish', '.create(', '.update(']) {
    if (runnerCode.includes(key)) offenders.push(`🔴 runner 에 ${key} 가 있다`)
  }
  if (offenders.length) bad('순수 함수 · 발행 없음', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('순수 함수 · 발행 없음', 'guard', 'DB · LLM · 발행 경로 없음 · ① 반환값 확인')
}

// ── 출력 ────────────────────────────────────────────
console.log('\nPersona 댓글 후보 판정부 fixture')
console.log('  네트워크 · DB · LLM 을 타지 않는다 · 텍스트는 전부 합성이다\n')
const label: Record<string, string> = { case: '[케이스]', guard: '[가드]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(24)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치\n`)
