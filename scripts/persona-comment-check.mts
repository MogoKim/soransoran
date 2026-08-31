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
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkCommentCandidate, summarizeCandidates, type CandidateVerdict,
} from './lib/persona-comment-candidate.mjs'
import { checkPersonaConsistency, checkVoiceFingerprint } from './lib/persona-gate-78.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, 'lib/persona-comment-candidate.mts')
const RUNNER = join(HERE, 'persona-comment-dry-run.mts')
const GATE234 = join(HERE, 'lib/persona-gate-234.mts')
const GATE78 = join(HERE, 'lib/persona-gate-78.mts')
const SELF = join(HERE, 'persona-comment-check.mts')

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
  // 🔴 ⑦(identity 대조) · ⑧(반복 패턴) 은 여전히 돌지 않는다.
  //    ② 는 코퍼스 조회가 없을 때만 notRun 이다
  const expected = ['⑦', '⑧']
  const missing = expected.filter((g) => !notRun.includes(g as never))
  if (missing.length > 0) bad('미실행은 notRun', 'guard', `🔴 ${missing.join(' ')} 가 notRun 이 아니다`)
  else if (v.gates.length !== 9) bad('미실행은 notRun', 'guard', `🔴 관문 ${v.gates.length}/9`)
  else ok('미실행은 notRun', 'guard', `9관문 · notRun ${notRun.length}종 (⑦ ⑧ 포함)`)
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
  for (const key of ['--apply', 'publish']) {
    if (runnerCode.includes(key)) offenders.push(`🔴 runner 에 ${key} 가 있다`)
  }
  // 🔴 runner 가 --enqueue 로 대기열에 적재하게 되면서 write 자체는 생겼다.
  //    막아야 할 것은 "대기열 적재" 가 아니라 **고객에게 나가는 write** 다.
  //    그래서 문자열 매칭을 푸는 대신 **쓰기 대상 모델을 화이트리스트로** 좁힌다.
  //    ('.create(' 만 보던 이전 가드는 createHash().update() 까지 잡는 거친 검사였다)
  const QUEUE_ONLY = ['personaApprovalQueue']
  const writeTargets = [...runnerCode.matchAll(
    /prisma\.([A-Za-z]+)\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\b/g,
  )].map((m) => m[1] ?? '')
  const badWrites = [...new Set(writeTargets)].filter((m) => !QUEUE_ONLY.includes(m))
  if (badWrites.length > 0) offenders.push(`🔴 runner 가 ${badWrites.join(' · ')} 에 쓴다`)
  if (offenders.length) bad('순수 함수 · 발행 없음', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('순수 함수 · 발행 없음', 'guard', 'DB · LLM · 발행 경로 없음 · ① 반환값 확인')
}

// ══ ② 고유 표현 ═══════════════════════════════════
{
  // 🔴 희귀 = 코퍼스 빈도 0~1. 흔함 = 6+ (§3-② 판정 3단)
  const rareLookup = () => 0
  const commonLookup = () => 50
  const midLookup = () => 3
  const shared = '남의편이 그러는데'

  const rare = checkCommentCandidate({
    personaCode: 'P05', text: `${shared} 저도 그래요`, sourceTexts: [`${shared} 참 답답해요`],
    frequencyLookup: rareLookup,
  })
  const common = checkCommentCandidate({
    personaCode: 'P05', text: `${shared} 저도 그래요`, sourceTexts: [`${shared} 참 답답해요`],
    frequencyLookup: commonLookup,
  })
  const mid = checkCommentCandidate({
    personaCode: 'P05', text: `${shared} 저도 그래요`, sourceTexts: [`${shared} 참 답답해요`],
    frequencyLookup: midLookup,
  })
  const g = (v: typeof rare) => v.gates.find((x) => x.gate === '②')?.outcome
  const offenders: string[] = []
  if (g(rare) !== 'regenerate') offenders.push(`희귀=${g(rare)}`)
  if (g(mid) !== 'review') offenders.push(`중간=${g(mid)}`)
  if (g(common) !== 'pass') offenders.push(`흔함=${g(common)}`)
  if (offenders.length) bad('② 희귀도 3단', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('② 희귀도 3단', 'case', '희귀 regenerate · 중간 review · 흔함 pass')
}

// ── 🔴 ② 는 코퍼스 없으면 notRun ─────────────────────
{
  const v = checkCommentCandidate({ personaCode: 'P05', text: '그러네요', sourceTexts: SOURCE })
  const g = v.gates.find((x) => x.gate === '②')
  if (g?.outcome !== 'notRun') bad('② 코퍼스 없으면 notRun', 'guard', `🔴 ②=${g?.outcome}`)
  else ok('② 코퍼스 없으면 notRun', 'guard', 'pass 로 세지 않는다')
}

// ── 🔴 ② 반환값에 n-gram 문자열이 없다 ────────────────
{
  const shared = '남의편이그러는데'
  const v = checkCommentCandidate({
    personaCode: 'P05', text: `${shared} 저도요`, sourceTexts: [`${shared} 답답해요`],
    frequencyLookup: () => 0,
  })
  if (JSON.stringify(v).includes('남의편')) bad('② 원문 조각 없음', 'guard', '🔴 n-gram 이 반환값에 있다')
  else ok('② 원문 조각 없음', 'guard', '개수만')
}

// ══ ③ 식별 디테일 ═════════════════════════════════
{
  // 🔴 단일은 허용 · 2개 review · 3개 이상 regenerate
  const one = checkCommentCandidate({ personaCode: 'P05', text: '집 근처 병원 다녀왔어요', sourceTexts: SOURCE })
  const two = checkCommentCandidate({ personaCode: 'P05', text: '가나구 병원에 다녀왔어요', sourceTexts: SOURCE })
  const three = checkCommentCandidate({
    personaCode: 'P05', text: '가나구 병원에 3월 12일 다녀왔어요', sourceTexts: SOURCE,
  })
  const g = (v: typeof one) => v.gates.find((x) => x.gate === '③')?.outcome
  const offenders: string[] = []
  if (g(one) !== 'pass') offenders.push(`단일=${g(one)}`)
  if (g(two) !== 'review') offenders.push(`2개=${g(two)}`)
  if (g(three) !== 'regenerate') offenders.push(`3개=${g(three)}`)
  if (offenders.length) bad('③ 결합 판정', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('③ 결합 판정', 'case', '단일 pass · 2개 review · 3개 regenerate')
}

// ── 🔴 ③ 반환값에 걸린 값이 없다 ──────────────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '가나구 병원에 3월 12일 다녀왔어요', sourceTexts: SOURCE,
  })
  const json = JSON.stringify(v)
  if (/가나|3월|12일/.test(json)) bad('③ 값 노출 없음', 'guard', '🔴 걸린 값이 반환값에 있다')
  else if (!json.includes('REGION')) bad('③ 값 노출 없음', 'guard', '🔴 카테고리 코드가 없다')
  else ok('③ 값 노출 없음', 'guard', '카테고리 코드만')
}

// ── 🔴 ③ 밴드 표현은 통과한다 ─────────────────────────
{
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '저도 50대 초반인데 수도권 살아요', sourceTexts: SOURCE,
  })
  const g = v.gates.find((x) => x.gate === '③')
  if (g?.outcome !== 'pass') bad('③ 밴드는 통과', 'case', `🔴 ③=${g?.outcome} (${g?.detail})`)
  else ok('③ 밴드는 통과', 'case', '"50대 초반" · "수도권" 은 특정되지 않는다')
}

// ══ ④ 구조 과복제 ═════════════════════════════════
{
  // 🔴 흔한 전개(병원→검사→기다림)는 순서가 같아도 세지 않는다
  const src = [
    '무릎이 아파서 병원에 갔어요. 검사를 받았어요. 결과를 기다리고 있어요.',
  ]
  const commonFlow = checkCommentCandidate({
    personaCode: 'P05',
    text: '저도 병원에 갔어요. 검사를 받았어요. 결과를 기다려요.',
    sourceTexts: src,
  })
  const g = commonFlow.gates.find((x) => x.gate === '④')
  if (g?.outcome !== 'pass') bad('④ 흔한 구조는 통과', 'case', `🔴 ④=${g?.outcome} (${g?.detail})`)
  else ok('④ 흔한 구조는 통과', 'case', '일반 구조 사전으로 걸러진다')
}

// ── 🔴 ④ 는 sourceTexts 없으면 notRun ────────────────
{
  const v = checkCommentCandidate({ personaCode: 'P05', text: '그러네요 저도 그래요', sourceTexts: [] })
  const g = v.gates.find((x) => x.gate === '④')
  if (g?.outcome !== 'notRun') bad('④ 검사 불가는 notRun', 'guard', `🔴 ④=${g?.outcome}`)
  else ok('④ 검사 불가는 notRun', 'guard', 'pass 로 세지 않는다')
}

// ── 🔴 ④ 와 ① 의 역할이 다르다 ───────────────────────
{
  // 표현을 전부 바꿔 ① 은 통과하지만 고유 전개가 순서까지 같은 경우
  const src = [
    '옆집에서 고양이를 데려왔대요. 우리 애가 자꾸 넘어다봐요. 결국 같이 키우기로 했어요. 이름도 지어줬대요.',
  ]
  const v = checkCommentCandidate({
    personaCode: 'P05',
    text: '옆집에서 고양이를 데려왔대요. 우리 애가 자꾸 넘어다봐요. 결국 같이 키우기로 했어요. 이름도 지어줬대요.',
    sourceTexts: src,
  })
  const four = v.gates.find((x) => x.gate === '④')
  if (four?.outcome === 'pass') {
    bad('④ 고유 전개 검출', 'case', `🔴 ④=pass (${four.detail})`)
  } else ok('④ 고유 전개 검출', 'case', `④=${four?.outcome} — ${four?.detail}`)
}

// ── 🔴 AI 티 태그 중복이 없다 ─────────────────────────
{
  const shared = '남의편이그러는데참'
  const v = checkCommentCandidate({
    personaCode: 'P05', text: `${shared} 답답하네요 정말로요`, sourceTexts: [`${shared} 답답하네요 정말로요`],
    frequencyLookup: () => 0,
  })
  const dup = v.aiToneTags.length !== new Set(v.aiToneTags).size
  if (dup) bad('태그 중복 없음', 'guard', `🔴 ${v.aiToneTags.join(' · ')}`)
  else ok('태그 중복 없음', 'guard', `${v.aiToneTags.length}종`)
}

// ══ 🔴 관문 수는 입력과 무관하게 9개 ════════════
{
  // 🔴 관문 하나가 근거를 둘 갖는다고 gates 가 10개가 되면
  //    "9관문 중 몇 종 통과" 라는 집계가 후보마다 다른 분모를 갖게 된다.
  const GATES = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']
  type In = Parameters<typeof checkCommentCandidate>[0]
  const cases: Array<{ name: string; input: In }> = [
    { name: '기본', input: { personaCode: 'P05', text: '그러네요', sourceTexts: SOURCE } },
    { name: 'source 없음', input: { personaCode: 'P05', text: '그러네요', sourceTexts: [] } },
    { name: '금지 호칭', input: { personaCode: 'P07', text: '우리 또래분들 다 그러시더라구요', sourceTexts: SOURCE } },
    { name: '조언 단정형', input: { personaCode: 'P17', text: '병원 가서 검사받으셔야 합니다', sourceTexts: SOURCE, adviceForbidden: true } },
    { name: '조언 금지 · 통과', input: { personaCode: 'P17', text: '저도 그랬어요 마음이 참 그렇죠', sourceTexts: SOURCE, adviceForbidden: true } },
    { name: '호칭+조언 동시', input: { personaCode: 'P07', text: '우리 또래분들은 병원 가서 검사받으셔야 합니다', sourceTexts: SOURCE, adviceForbidden: true } },
    { name: '코퍼스 있음', input: { personaCode: 'P05', text: '그러네요', sourceTexts: SOURCE, frequencyLookup: () => 50 } },
    { name: '닉네임 혼입', input: { personaCode: 'P05', text: '그러네요', sourceTexts: SOURCE, knownNames: ['합성닉'] } },
    { name: '금지 역할', input: { personaCode: 'P05', text: '병원 가보세요', sourceTexts: SOURCE, forbiddenRoles: ['information'] } },
  ]
  const offenders: string[] = []
  for (const c of cases) {
    // 🔴 여기의 try 는 예외를 삼키려는 게 아니라 **실패로 기록**하려는 것이다.
    //    관문이 중복되면 판정부가 throw 하는데, 그때 스크립트가 죽으면
    //    어느 입력이 깨뜨렸는지 리포트에 남지 않는다.
    let v: CandidateVerdict
    try {
      v = checkCommentCandidate(c.input)
    } catch (e) {
      offenders.push(`${c.name}=throw(${e instanceof Error ? e.message : '알 수 없음'})`)
      continue
    }
    if (v.gates.length !== 9) offenders.push(`${c.name}=${v.gates.length}개`)
    const codes = v.gates.map((g) => g.gate)
    for (const code of GATES) {
      const n = codes.filter((x) => x === code).length
      if (n !== 1) offenders.push(`${c.name} ${code}=${n}개`)
    }
  }
  if (offenders.length) bad('관문 수 항상 9', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('관문 수 항상 9', 'guard', `입력 ${cases.length}종 전부 ①~⑨ 각 1개`)
}

// ── 🔴 ⑤ 는 근거가 둘이어도 관문은 하나 ────────
{
  const v = checkCommentCandidate({
    personaCode: 'P07',
    text: '우리 또래분들은 병원 가서 검사받으셔야 합니다',
    sourceTexts: SOURCE, adviceForbidden: true,
  })
  const hits = v.gates.filter((g) => g.gate === '⑤')
  const g = hits[0]
  const offenders: string[] = []
  if (hits.length !== 1) offenders.push(`⑤ ${hits.length}개`)
  if (g?.outcome !== 'regenerate') offenders.push(`outcome=${g?.outcome}`)
  if (!g?.detail.includes('타겟 설명어')) offenders.push('호칭 근거 누락')
  if (!g?.detail.includes('§5')) offenders.push('조언 근거 누락')
  // 🔴 detail 은 코드 · 개수 · 정책명만이다
  if (/또래|병원|검사/.test(g?.detail ?? '')) offenders.push('🔴 detail 에 본문 조각')
  if (offenders.length) bad('⑤ 근거 둘 · 관문 하나', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('⑤ 근거 둘 · 관문 하나', 'case', `1개 · regenerate · "${g?.detail}"`)
}

// ── 🔴 ⑤ 병합은 더 엄격한 쪽을 남긴다 ────────
{
  // 호칭 regenerate + 조언 review → regenerate 여야 한다 (덮어쓰면 완화된다)
  const v = checkCommentCandidate({
    personaCode: 'P07', text: '우리 또래분들도 병원 가보세요',
    sourceTexts: SOURCE, adviceForbidden: true,
  })
  const g = v.gates.find((x) => x.gate === '⑤')
  if (g?.outcome !== 'regenerate') bad('⑤ 더 엄격한 쪽', 'case', `🔴 ⑤=${g?.outcome} (${g?.detail})`)
  else ok('⑤ 더 엄격한 쪽', 'case', `regenerate 유지 · "${g?.detail}"`)
}

// ── 🔴 실제 시/구 지명이 저장소에 남지 않았는가 ────
{
  // fixture 텍스트는 전부 합성이다. 실제 지명은 그 자체가 식별 정보라
  // 저장소에 남으면 테스트 데이터가 아니라 기록이 된다.
  // 🔴 금지 목록을 평문으로 적는 방식은 쓰지 않는다 — 그것도 남기는 것이다.
  //    지명꼴을 전부 뽑아 해시로만 대조한다.
  //    거짓양성("활동" · "화면" 등)은 해시가 맞지 않아 무해하다.
  const ph = (v: string) => createHash('sha1').update(`place:${v}`).digest('hex').slice(0, 12)
  const BANNED = new Set([
  '02043db24e11', '04b0aa106ecc', '04beabb36467', '04e0602c9a2f', '06d78663b341', '087316020483',
  '08b4b3c1aa93', '0acf7b161625', '0e0b34d25a3f', '0e9b1481c6c6', '163342b6f97a', '1a12cbaeb7cd',
  '1b8ad584f8c8', '1c6f0d1db00e', '1d44e3c454bd', '22e05d897316', '294c6774f682', '2c99b3d460b9',
  '2fc3d046d9e5', '314e976d7bad', '3822bae0723f', '39b14dc78b2b', '3e541cfbbaef', '3f1057693eea',
  '416460051862', '41ca4f163dd4', '42bc5f5fd40b', '443ebbea3294', '487b4e96c981', '4bb3a94dce07',
  '4cfe7d481328', '53aee12601f6', '5897755c8a21', '59edb51fe133', '5abbe0d9c1dc', '5bbbc2b89c61',
  '5c65f2f55205', '62cf4f7c56e0', '630ce57404e9', '646e3cf32b2b', '6b8c874226b5', '6c53c8e6baa3',
  '6ce65f30490e', '6f78d5fc5580', '6f999cc99244', '6fe11ab64133', '763d30958fbd', '7ebbea266d4f',
  '7f961c6bd6ad', '8263b5aaec15', '82e05b543f3a', '84b8b06a0b9d', '84d613d4d4a5', '8526ebb11483',
  '85f74a44ea5d', '8c1b0e69f909', '8db420fe56a0', '93700473531e', '946dc78e5b73', '9571f3aec810',
  '962ee723fcb7', '97492184d3d4', '9aae2784f28f', 'a31a02147abe', 'a352c6c8454a', 'a38fa22ea863',
  'a45e378eed33', 'ab76f1566e87', 'abd083c7b5f7', 'ade3405c5502', 'b429dd6eb8f8', 'b42acbb15b5e',
  'b47ff229e83b', 'b8f5bb67bca1', 'b9c6a9ec2108', 'bb65cabcf0d1', 'c3520b52fbb3', 'cb3e49ea8585',
  'cca105d39109', 'cd685b881612', 'd04007ba87e8', 'd2edd25bee54', 'd31b75dd9466', 'd64a9eef1ce9',
  'd7c01fc9ce4c', 'd7db54062b3d', 'd81ff6531a99', 'da5de4c605dc', 'dc2f8a46b193', 'dd75af27d792',
  'e15a33b049bb', 'e3065edb8491', 'e7955f170b7d', 'e97b60b76d73', 'e9b69ddcd09b', 'ef3131b10f89',
  'f12942fde1f5', 'f201d54d7389', 'f2e55d98c878', 'f30b0e7ec55e', 'f3ca2467fc94', 'f4dd769bda91',
  'f595b70ba5f3', 'f63f92a61f23', 'f7f6088823e3', 'fa06cc139b3e', 'fc4a5a95ed78', 'feffd7eb59e7',
  ])
  const raw = [SELF, LIB, GATE234, GATE78, RUNNER].map((f) => readFileSync(f, 'utf-8'))
  const hits = new Set<string>()
  for (const src of raw) {
    for (const m of src.matchAll(/[가-힣]{2,4}(?:시|구|동|읍|면)/gu)) {
      const d = ph(m[0])
      if (BANNED.has(d)) hits.add(d)
    }
  }
  // 🔴 실패해도 지명을 출력하지 않는다 — 해시 · 개수만
  if (hits.size > 0) bad('실제 지명 없음', 'guard', `🔴 실제 시/구 지명 ${hits.size}종 — ${[...hits].join(' ')}`)
  else ok('실제 지명 없음', 'guard', `대조 ${BANNED.size}종 · 소스 ${raw.length}개 전부 합성`)
}

// ══ ⑦ Persona Consistency ════════════════
{
  // 🔴 identity 가 없어도 잡아야 한다 — §5 가족 경유 진술은 설정 대조가 아니다
  const proxy = checkCommentCandidate({
    personaCode: 'P05', text: '우리 딸도 그 병원 다녀왔어요', sourceTexts: SOURCE,
  })
  const g = proxy.gates.find((x) => x.gate === '⑦')
  const offenders: string[] = []
  if (g?.outcome !== 'regenerate') offenders.push(`가족경유=${g?.outcome}`)
  if (!g?.detail.includes('FAMILY_PROXY')) offenders.push('코드 누락')
  // 🔴 정서 표현은 걸리지 않아야 한다 — 다 막으면 아무 말도 못 한다
  const feel = checkCommentCandidate({
    personaCode: 'P05', text: '우리 딸도 그맘때 참 힘들어했어요', sourceTexts: SOURCE,
  })
  const fg = feel.gates.find((x) => x.gate === '⑦')
  if (fg?.outcome === 'regenerate') offenders.push(`정서표현이 걸림=${fg.detail}`)
  if (offenders.length) bad('⑦ 가족 경유 진술', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('⑦ 가족 경유 진술', 'case', 'identity 없어도 regenerate · 정서 표현은 통과')
}

// ── 🔴 ⑦ identity 없으면 설정 모순은 notRun ────
{
  const v = checkCommentCandidate({ personaCode: 'P05', text: '저도 그랬어요', sourceTexts: SOURCE })
  const g = v.gates.find((x) => x.gate === '⑦')
  if (g?.outcome !== 'notRun') bad('⑦ 대조 없으면 notRun', 'guard', `🔴 ⑦=${g?.outcome}`)
  else ok('⑦ 대조 없으면 notRun', 'guard', 'pass 로 세지 않는다')
}

// ── ⑦ 설정 모순 ──────────────────
{
  const offenders: string[] = []
  const gOf = (v: ReturnType<typeof checkCommentCandidate>) => v.gates.find((x) => x.gate === '⑦')
  // 자녀 0 인데 자녀 언급
  const child = gOf(checkCommentCandidate({
    personaCode: 'P05', text: '우리 애들은 다 컸어요', sourceTexts: SOURCE,
    identity: { childrenCount: 0 },
  }))
  if (child?.outcome !== 'regenerate' || !child.detail.includes('CHILD_CONFLICT')) {
    offenders.push(`자녀=${child?.outcome}(${child?.detail})`)
  }
  // 사별 설정 + 배우자 현재형
  const spouse = gOf(checkCommentCandidate({
    personaCode: 'P05', text: '남편이 요즘 자꾸 그래요', sourceTexts: SOURCE,
    identity: { maritalStatus: '사별' },
  }))
  if (spouse?.outcome !== 'regenerate' || !spouse.detail.includes('SPOUSE_CONFLICT')) {
    offenders.push(`배우자=${spouse?.outcome}`)
  }
  // 🔴 과거를 명시하면 모순이 아니다 — 사별한 사람도 남편 얘기를 한다
  const past = gOf(checkCommentCandidate({
    personaCode: 'P05', text: '남편이 살아 있을 때는 늘 그랬어요', sourceTexts: SOURCE,
    identity: { maritalStatus: '사별' },
  }))
  if (past?.outcome === 'regenerate') offenders.push(`과거형이 걸림=${past.detail}`)
  // No-Go
  const nogo = gOf(checkCommentCandidate({
    personaCode: 'P05', text: '그 정당 얘기는 좀 그렇죠', sourceTexts: SOURCE,
    noGoTopics: ['정당'],
  }))
  if (nogo?.outcome !== 'regenerate' || !nogo.detail.includes('NO_GO')) offenders.push(`No-Go=${nogo?.outcome}`)
  if (offenders.length) bad('⑦ 설정 모순', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('⑦ 설정 모순', 'case', '자녀 · 배우자 · No-Go 검출 · 과거형은 통과')
}

// ── 🔴 ⑦ 도 근거가 둘이어도 관문은 하나 ────
{
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '우리 딸도 그 병원 다녀왔어요 꼭 가보세요', sourceTexts: SOURCE,
    forbiddenRoles: ['information'], identity: { childrenCount: 0 },
  })
  const hits = v.gates.filter((g) => g.gate === '⑦')
  const g = hits[0]
  const offenders: string[] = []
  if (hits.length !== 1) offenders.push(`⑦ ${hits.length}개`)
  if (g?.outcome !== 'regenerate') offenders.push(`outcome=${g?.outcome}`)
  if (/딸|병원/.test(g?.detail ?? '')) offenders.push('🔴 detail 에 본문 조각')
  if (offenders.length) bad('⑦ 근거 둘 · 관문 하나', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('⑦ 근거 둘 · 관문 하나', 'case', `1개 · regenerate · "${g?.detail}"`)
}

// ══ ⑧ Voice Fingerprint ══════════════
{
  const PRIOR = ['오늘도 그랬어요', '저도 그랬어요', '어제도 그랬어요', '늘 그랬어요', '항상 그랬어요']
  const rep = checkCommentCandidate({
    personaCode: 'P05', text: '저는 매번 그랬어요', sourceTexts: SOURCE, priorTexts: PRIOR,
  })
  const g = rep.gates.find((x) => x.gate === '⑧')
  const offenders: string[] = []
  if (g?.outcome !== 'regenerate') offenders.push(`반복=${g?.outcome}(${g?.detail})`)
  if (!rep.aiToneTags.includes('TONE_REPEAT')) offenders.push('TONE_REPEAT 태그 없음')
  // 🔴 outcome 만 보면 다른 축이 대신 걸려도 통과한다 — 축을 특정해서 본다.
  //    (말끝 임계를 껐는데 3-gram 이 대신 걸려 fixture 가 통과한 적이 있다)
  const axes = checkVoiceFingerprint('저는 매번 그랬어요', { priorTexts: PRIOR }).axes
  if (!axes.includes('ENDING')) offenders.push(`ENDING 축 미검출 (${axes.join('·') || '없음'})`)
  if (offenders.length) bad('⑧ 말끝 반복', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('⑧ 말끝 반복', 'case', `regenerate · ENDING 축 · "${g?.detail}"`)
}

// ── 🔴 ⑧ 표본이 모자라면 반복을 재지 않는다 ───
{
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '저도 그랬어요', sourceTexts: SOURCE, priorTexts: ['저도 그랬어요', '늘 그랬어요'],
  })
  const g = v.gates.find((x) => x.gate === '⑧')
  if (g?.outcome !== 'notRun') bad('⑧ 표본 부족은 notRun', 'guard', `🔴 ⑧=${g?.outcome} (${g?.detail})`)
  else ok('⑧ 표본 부족은 notRun', 'guard', 'pass 로 세지 않는다')
}

// ── 🔴 ⑧ 표본이 모자라도 seed 축은 돈다 ────
{
  // 🔴 실제로 겪은 결함이다. 표본 부족으로 early return 해서
  //    seed 재사용이 조용히 무력해졌다. 축마다 실행 조건이 다르다.
  const three = checkCommentCandidate({
    personaCode: 'P05', text: '저도 그랬어요', sourceTexts: SOURCE, seedUseCount: 3,
  })
  const two = checkCommentCandidate({
    personaCode: 'P05', text: '저도 그랬어요', sourceTexts: SOURCE, seedUseCount: 2,
  })
  const one = checkCommentCandidate({
    personaCode: 'P05', text: '저도 그랬어요', sourceTexts: SOURCE, seedUseCount: 1,
  })
  const g = (v: typeof three) => v.gates.find((x) => x.gate === '⑧')?.outcome
  const offenders: string[] = []
  if (g(three) !== 'regenerate') offenders.push(`3회=${g(three)}`)
  if (g(two) !== 'review') offenders.push(`2회=${g(two)}`)
  if (g(one) !== 'notRun') offenders.push(`1회=${g(one)}`)
  if (offenders.length) bad('⑧ seed 축은 표본 무관', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('⑧ seed 축은 표본 무관', 'guard', '3회 regenerate · 2회 review · 1회는 반복축 notRun')
}

// ── ⑧ 반복이 없으면 통과 ────────────
{
  // 🔴 사람도 반복한다. 다 막으면 아무 글도 못 쓴다
  const PRIOR = ['그거 참 속상하셨겠어요', '마음이 무겁네요', '저는 잘 모르겠더라구요', '비슷한 일이 있었죠', '토닥토닥 해드리고 싶어요']
  const v = checkCommentCandidate({
    personaCode: 'P05', text: '읽는데 눈물이 핑 도네요', sourceTexts: SOURCE, priorTexts: PRIOR,
  })
  const g = v.gates.find((x) => x.gate === '⑧')
  if (g?.outcome !== 'pass') bad('⑧ 자연스러우면 통과', 'case', `🔴 ⑧=${g?.outcome} (${g?.detail})`)
  else ok('⑧ 자연스러우면 통과', 'case', `pass · "${g?.detail}"`)
}

// ── 🔴 ⑦⑧ 판정부 반환값에 본문이 없는가 ────────
{
  // 🔴 호출부(candidate)가 detail 을 다시 조립하므로, 판정부만 오염돼도
  //    candidate 출력에는 드러나지 않는다. 판정부를 직접 본다.
  const TEXT = '우리 딸도 그 병원 다녀왔어요 남편이 그래요'
  const seven = checkPersonaConsistency(TEXT, { identity: { childrenCount: 0, maritalStatus: '사별' } })
  const eight = checkVoiceFingerprint(TEXT, {
    priorTexts: ['오늘도 그랬어요', '저도 그랬어요', '어제도 그랬어요', '늘 그랬어요', '항상 그랬어요'],
    seedUseCount: 3,
  })
  const json = JSON.stringify({ seven, eight })
  const offenders: string[] = []
  for (const frag of ['우리', '딸', '병원', '남편', '다녀왔', '그랬어요']) {
    if (json.includes(frag)) offenders.push(`"${frag}"`)
  }
  if (seven.codes.length === 0) offenders.push('🔴 ⑦ 가 아무것도 못 잡았다')
  if (eight.axes.length === 0) offenders.push('🔴 ⑧ 이 아무것도 못 잡았다')
  if (offenders.length) bad('⑦⑧ 판정부 값 노출 없음', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('⑦⑧ 판정부 값 노출 없음', 'guard', `코드 ${seven.codes.length}종 · 축 ${eight.axes.length}종만`)
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
