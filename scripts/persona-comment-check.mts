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
  const v = checkCommentCandidate({ personaCode: 'P07', text: '우리 또래분들 다 그러시더라구요', sourceTexts: [] })
  const g = v.gates.find((x) => x.gate === '⑤')
  if (g?.outcome !== 'regenerate') bad('⑤ 금지 호칭', 'case', `🔴 ⑤=${g?.outcome}`)
  else ok('⑤ 금지 호칭', 'case', 'regenerate')
}

// ── ⑨ 출처 marker ────────────────────────────────────
{
  const v = checkCommentCandidate({ personaCode: 'P10', text: '82님들 말씀처럼 등업하고 보니', sourceTexts: [] })
  const g = v.gates.find((x) => x.gate === '⑨')
  if (g?.outcome !== 'regenerate') bad('⑨ 출처 marker', 'case', `🔴 ⑨=${g?.outcome}`)
  else if (!v.aiToneTags.includes('SOURCE_TRACE')) bad('⑨ 출처 marker', 'case', '🔴 태그 없음')
  else ok('⑨ 출처 marker', 'case', 'regenerate · SOURCE_TRACE')
}

// ── ⑥-A 닉네임 혼입 ──────────────────────────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '봄뜰하나님 말씀이 맞아요', sourceTexts: [], knownNames: ['봄뜰하나'],
  })
  const g = v.gates.find((x) => x.gate === '⑥')
  if (g?.outcome !== 'regenerate') bad('⑥-A 닉네임 혼입', 'case', `🔴 ⑥=${g?.outcome}`)
  else if (/봄뜰하나/.test(JSON.stringify(v))) bad('⑥-A 닉네임 혼입', 'guard', '🔴 반환값에 닉네임이 있다')
  else ok('⑥-A 닉네임 혼입', 'case', 'regenerate · 개수만 보고')
}

// ── 금지 역할 ────────────────────────────────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P15', text: '저는 그때 이렇게 했었어요 저희 애가 그맘때', sourceTexts: [],
    forbiddenRoles: ['experience'],
  })
  if (v.reactionType !== 'experience') {
    ok('금지 역할', 'case', `분류가 ${v.reactionType} — 케이스 성립 안 함(스킵)`)
  } else if (v.status !== 'regenerate') {
    bad('금지 역할', 'case', `🔴 ${v.status}`)
  } else ok('금지 역할', 'case', 'experience 금지 → regenerate')
}

// ── AI 티 태그 ───────────────────────────────────────
{
  const tidy = checkCommentCandidate({ personaCode: 'P15', text: '- 첫째\n- 둘째\n**꼭**', sourceTexts: [] })
  const advice = checkCommentCandidate({
    personaCode: 'P17', text: '그거 병원 가서 검사받으셔야 합니다', sourceTexts: [], adviceForbidden: true,
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
  const v = checkCommentCandidate({ personaCode: 'P05', text: '그러네요', sourceTexts: [] })
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
  const v = checkCommentCandidate({ personaCode: 'P05', text, sourceTexts: [] })
  if (JSON.stringify(v).includes(text)) bad('반환값에 본문 없음', 'guard', '🔴 본문이 반환값에 있다')
  else ok('반환값에 본문 없음', 'guard', '관문 코드 · 태그 · 길이만')
}

// ── 집계 ─────────────────────────────────────────────
{
  const list: CandidateVerdict[] = [
    checkCommentCandidate({ personaCode: 'P05', text: '그러네요', sourceTexts: [] }),
    checkCommentCandidate({ personaCode: 'P07', text: '우리 또래분들', sourceTexts: [] }),
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
