#!/usr/bin/env tsx
/**
 * VE-M2-2 규칙 신호 fixture — 네트워크 · DB · LLM 없이 계약을 검증한다
 *
 * 정본: docs/operations/2026-08-26-voice-derived-m2-design.md §1 · §2 · §3
 *
 * 🔴 이 fixture 가 검사하는 것은 "신호가 잘 뽑히는가" 가 아니라
 *    **"선을 넘지 않는가"** 다. 넘으면 되돌리기 어려운 쪽만 잠근다:
 *      ① 원문 · 댓글 · 닉네임이 저장되는가
 *      ② LLM · API 가 호출되는가 (이 단계는 비용 0원이어야 한다)
 *      ③ 타겟 설명어가 **좋은 치환어로 되살아나는가**
 *      ④ VE-M3 신호 7종을 placeholder 로 만드는가
 *
 * 🔴 ③ 이 이 파일의 존재 이유에 가깝다.
 *    "우리 또래분들" 은 한 번 좋은 치환어로 문서에 적혔다가 폐기됐다(PR #100).
 *    사람은 같은 실수를 반복하고, 문서는 읽히지 않는다. fixture 는 읽힌다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeStyleSignals, computeCommunityRegister,
  SOURCE_SPECIFIC_TERMS, SORANSORAN_REGISTER_TERMS, TARGET_DESCRIPTOR_TERMS,
  STYLE_RULE_VERSION, LOW_SAMPLE_CHARS,
} from './lib/voice-style-signals.mjs'
import {
  toCommentSignals, classifyReaction, summarizeCommentSignals, COMMENT_TRUNCATE_AT,
} from './lib/voice-comment-signals.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIVE = join(HERE, 'voice-derive-live.mts')
const STYLE_LIB = join(HERE, 'lib/voice-style-signals.mts')
const COMMENT_LIB = join(HERE, 'lib/voice-comment-signals.mts')

const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string) => report.push({ ok: true, kind, name, detail })
const bad = (name: string, kind: string, detail: string) => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}

/** 🔴 `/**` 로 시작하는 한 줄 JSDoc 도 걷어낸다 — 설명을 위반으로 읽으면 안 된다 */
const stripComments = (raw: string): string =>
  raw.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/|--)/.test(l)).join('\n')

const liveRaw = readFileSync(LIVE, 'utf-8')
const liveCode = stripComments(liveRaw)
const styleCode = stripComments(readFileSync(STYLE_LIB, 'utf-8'))
const commentCode = stripComments(readFileSync(COMMENT_LIB, 'utf-8'))

/** `voiceDerived.create` 의 data 블록만 잘라낸다 */
function derivedDataBlock(): string {
  const i = liveCode.indexOf('voiceDerived.create(')
  if (i === -1) return ''
  const j = liveCode.indexOf('select:', i)
  return liveCode.slice(i, j === -1 ? i + 1600 : j)
}

const SAMPLE_BODY = [
  '82님들 안녕하세요ㅠㅠ',
  '',
  '어제 병원 다녀왔는데요.. 검사 결과가 애매하다고 하네요~~',
  '혹시 저만 이런가요? 다들 어떠세요?',
  '저도 처음이라 어떻게 해야 할지 모르겠어요ㅋㅋ',
].join('\n')

// ── ① 원문 · 댓글 · 닉네임이 저장되지 않는다 ─────────────
//    🔴 VE-M2 전체가 여기 걸려 있다.
{
  const offenders: string[] = []
  const block = derivedDataBlock()
  if (!block) offenders.push('voiceDerived.create 를 찾지 못했다')
  for (const f of ['content', 'body', 'rawBody', 'commentBody', 'topComments', 'author', 'nickname']) {
    // 🔴 `content:` 뿐 아니라 **shorthand `content,`** 도 잡는다.
    //    역검증에서 `content,` 한 줄이 그대로 통과했다 — 셋 다 본문이 새는 경로다.
    //    뒤에 `[,:}\n]` 를 요구하므로 `contentHash` · `contentLength` 는 걸리지 않는다.
    if (new RegExp(`\\b${f}\\s*[,:}\\n]`).test(block)) offenders.push(`create data 에 ${f}`)
  }
  if (/:\s*content\b|:\s*src\.content\b/.test(block)) offenders.push('create data 에 본문 변수')
  // 실제 계산 결과에도 원문이 없어야 한다
  const signals = computeStyleSignals(SAMPLE_BODY)
  const json = JSON.stringify(signals)
  if (json.includes('병원 다녀왔는데')) offenders.push('신호 반환값에 본문 문장')
  if (json.includes('검사 결과가 애매')) offenders.push('신호 반환값에 본문 문장')
  if (offenders.length) bad('원문을 저장하지 않는다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('원문을 저장하지 않는다', 'policy', `create data 정결 · 신호 ${json.length}B 에 본문 0`)
}

// ── ② 댓글 본문 · 닉네임이 신호에 남지 않는다 ────────────
{
  const body = '저도 작년에 똑같이 겪었어요. 병원은 큰 데로 가시는 게 나아요.'
  const rows = toCommentSignals(
    [{ author: '햇살가득', content: body, likeCount: 4, replyCount: 1 }],
    { capturedAt: new Date('2026-08-01T00:00:00Z') },
  )
  const json = JSON.stringify(rows)
  const offenders: string[] = []
  if (json.includes('똑같이 겪었')) offenders.push('댓글 본문이 남았다')
  if (json.includes('햇살가득')) offenders.push('닉네임 원문이 남았다')
  if (!rows[0]?.contentHash?.startsWith('sha256:')) offenders.push('contentHash 형식')
  // 🔴 (2026-10-01 · #641) 작가 식별값을 만들지 않는다
  if (rows[0]?.authorHash !== null) offenders.push('authorHash 가 만들어졌다')
  if (rows[0]?.contentLength !== body.length) offenders.push('길이가 틀리다')
  if (rows[0]?.likeCount !== 4 || rows[0]?.replyCount !== 1) offenders.push('반응 수치 손실')
  if (offenders.length) bad('댓글 본문 · 닉네임 미저장', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('댓글 본문 · 닉네임 미저장', 'policy', `해시 · 길이 · 반응만 · ${json.length}B`)
}

// ── ③ 🔴 타겟 설명어를 좋은 치환어로 되살리지 않는다 ─────
//    "우리 또래분들" 은 초판에서 좋은 치환어로 적혔다가 폐기됐다(PR #100).
{
  const offenders: string[] = []
  // 금지어가 소란소란 register 에 섞이면 안 된다
  for (const t of TARGET_DESCRIPTOR_TERMS) {
    if ((SORANSORAN_REGISTER_TERMS as readonly string[]).includes(t)) {
      offenders.push(`soransoranRegister 에 금지어 ${t}`)
    }
  }
  // 필수 금지어가 목록에 있어야 한다 — 🔴 리터럴로 못박는다
  for (const must of ['우리 또래분들', '50대 여성분들', '중년 여성분들', '같은 세대 분들']) {
    if (!(TARGET_DESCRIPTOR_TERMS as readonly string[]).includes(must)) {
      offenders.push(`금지어 목록에 ${must} 없음`)
    }
  }
  // 소란소란 호칭 4종이 있어야 한다
  for (const must of ['소란소란님들', '소란소란님', '소란님들', '소란님']) {
    if (!(SORANSORAN_REGISTER_TERMS as readonly string[]).includes(must)) {
      offenders.push(`소란소란 호칭에 ${must} 없음`)
    }
  }
  // 실제 계산: 금지어가 든 글은 targetDescriptorRisk 로 잡히고 register 로 승격되지 않는다
  const r = computeCommunityRegister('우리 또래분들 이런 경우 어떻게 하세요? 50대 여성분들 계신가요')
  if (!r.targetDescriptorRisk.includes('우리 또래분들')) offenders.push('우리 또래분들 미검출')
  if (!r.targetDescriptorRisk.includes('50대 여성분들')) offenders.push('50대 여성분들 미검출')
  if (r.soransoranRegister.length > 0) offenders.push('금지어가 치환 후보로 올라갔다')
  if (offenders.length) bad('타겟 설명어는 생성 금지어다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('타겟 설명어는 생성 금지어다', 'policy', `${TARGET_DESCRIPTOR_TERMS.length}종 · register 승격 0`)
}

// ── ④ 원출처 호칭을 감지한다 ─────────────────────────────
{
  const offenders: string[] = []
  for (const must of ['82님들', '우갱님들', '레테님들', '은오님들']) {
    if (!SOURCE_SPECIFIC_TERMS.some((s) => s.term === must)) offenders.push(`사전에 ${must} 없음`)
    const r = computeCommunityRegister(`${must} 이거 어떻게 하세요?`)
    if (!r.sourceSpecific.some((s) => s.term === must)) offenders.push(`${must} 미검출`)
  }
  // 🔴 긴 것을 먼저 세지 않으면 '82님들' 이 '82님' 으로도 잡혀 두 번 센다
  const dup = computeCommunityRegister('82님들 안녕하세요')
  if (dup.sourceSpecific.length !== 1) {
    offenders.push(`82님들 이 ${dup.sourceSpecific.length}건으로 중복 검출`)
  }
  // 소란소란 호칭은 sourceSpecific 이 아니다
  const soran = computeCommunityRegister('소란님들 이거 어떻게 하세요?')
  if (soran.sourceSpecific.length > 0) offenders.push('소란님들 이 원출처로 분류됐다')
  if (!soran.soransoranRegister.includes('소란님들')) offenders.push('소란님들 미검출')
  if (offenders.length) bad('원출처 호칭 감지 · 소란소란과 구분', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('원출처 호칭 감지 · 소란소란과 구분', 'policy', '4종 검출 · 중복 0 · 소란소란 분리')
}

// ── ⑤ 공동체 구조를 살린다 ──────────────────────────────
//    🔴 호칭만 보고 구조를 버리면 남는 건 혼잣말이다.
{
  const r = computeCommunityRegister('82님들 저 이거 어떻게 해야 할까요? 조언 부탁드려요')
  const offenders: string[] = []
  if (r.preserveStructure === 'none') offenders.push('구조가 none 으로 버려졌다')
  if (r.preserveStructure !== 'advice_request') offenders.push(`구조=${r.preserveStructure} (advice_request 여야 한다)`)
  const q = computeCommunityRegister('다들 어떠세요? 혹시 저만 그런가요')
  if (q.preserveStructure !== 'collective_question') offenders.push(`질문 구조=${q.preserveStructure}`)
  if (q.genericCommunityPhrase.length === 0) offenders.push('일반 커뮤니티 표현 미검출')
  if (offenders.length) bad('공동체 구조를 살린다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('공동체 구조를 살린다', 'policy', `advice_request · collective_question · generic ${q.genericCommunityPhrase.length}종`)
}

// ── ⑥ 신호 6종이 비어 있지 않다 ─────────────────────────
{
  const s = computeStyleSignals(SAMPLE_BODY)
  const offenders: string[] = []
  const keys = ['typingArtifacts', 'punctuationHabit', 'spacingVariance',
    'mobileInputTrace', 'communityRegister', 'artifactFrequency'] as const
  for (const k of keys) {
    if (!s[k] || Object.keys(s[k] as object).length === 0) offenders.push(`${k} 비어 있음`)
  }
  if (s.punctuationHabit.emoticon === 0) offenders.push('ㅠㅠ · ㅋㅋ 를 세지 못했다')
  if (s.punctuationHabit.ellipsis === 0) offenders.push('.. 를 세지 못했다')
  if (s.punctuationHabit.tilde === 0) offenders.push('~~ 를 세지 못했다')
  if (s.punctuationHabit.question === 0) offenders.push('? 를 세지 못했다')
  if (s.mobileInputTrace.lineCount < 4) offenders.push('줄 수를 세지 못했다')
  if (s.spacingVariance.wordCount === 0) offenders.push('어절을 세지 못했다')
  if (s.artifactFrequency.sampleChars !== SAMPLE_BODY.length) offenders.push('표본 길이가 틀리다')
  if (offenders.length) bad('신호 6종이 계산된다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('신호 6종이 계산된다', 'policy', `6종 채워짐 · 이모티콘 ${s.punctuationHabit.emoticon} · 줄 ${s.mobileInputTrace.lineCount}`)
}

// ── ⑦ 짧은 글은 표본 부족으로 표시된다 ──────────────────
//    🔴 본문의 45.7% 가 300자 미만이다. 60자 글의 빈도를 3,000자와 나란히 놓으면 안 된다.
//    🔴 임계값을 **리터럴로 못박는다** — 상수를 참조하면 값을 바꿔도 통과한다.
{
  const offenders: string[] = []
  if (LOW_SAMPLE_CHARS !== 200) offenders.push(`LOW_SAMPLE_CHARS 가 ${LOW_SAMPLE_CHARS} (1차값은 200)`)
  const short = computeStyleSignals('가'.repeat(199))
  const long = computeStyleSignals('가'.repeat(200))
  if (!short.artifactFrequency.lowSample) offenders.push('199자가 lowSample 이 아니다')
  if (long.artifactFrequency.lowSample) offenders.push('200자가 lowSample 로 잡힌다')
  if (offenders.length) bad('짧은 표본 표시', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('짧은 표본 표시', 'guard', '199자 lowSample · 200자 정상')
}

// ── ⑧ 댓글 반응 분류 · 잘림 표시 ────────────────────────
{
  const offenders: string[] = []
  const cases: Array<[string, string]> = [
    ['저도 작년에 겪었어요', 'experience'],
    ['그건 아니에요 다시 확인해보세요', 'rebuttal'],
    ['어느 병원 가셨어요?', 'question'],
    ['맞아요 저도요 힘내세요', 'empathy'],
  ]
  for (const [text, want] of cases) {
    const got = classifyReaction(text)
    if (got !== want) offenders.push(`"${text.slice(0, 8)}…" → ${got} (기대 ${want})`)
  }
  // 🔴 199자 경계를 리터럴로 못박는다
  if (COMMENT_TRUNCATE_AT !== 199) offenders.push(`COMMENT_TRUNCATE_AT 가 ${COMMENT_TRUNCATE_AT} (1차값은 199)`)
  const rows = toCommentSignals(
    [{ content: '가'.repeat(198) }, { content: '가'.repeat(199) }],
    { capturedAt: new Date(0) },
  )
  if (rows[0].truncated) offenders.push('198자가 잘림으로 잡힌다')
  if (!rows[1].truncated) offenders.push('199자가 잘림으로 안 잡힌다')
  if (rows[0].ordinal !== 0 || rows[1].ordinal !== 1) offenders.push('ordinal 이 순서를 잃었다')
  if (rows[0].anchorHint !== null) offenders.push('anchorHint 가 비어 있지 않다 (복원 불가가 정상)')
  if (offenders.length) bad('반응 분류 · 잘림 경계', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('반응 분류 · 잘림 경계', 'policy', '4종 분류 · 198/199 경계 · ordinal 보존')
}

// ── ⑨ VE-M3 신호 7종을 만들지 않는다 ────────────────────
//    🔴 placeholder 숫자로도 만들지 않는다. 있으면 채우고 싶어지고,
//       채우면 의미 없는 숫자가 학습 정답지에 남는다.
{
  const M3 = ['naturalnessScore', 'voiceRetention', 'originalityDelta', 'overSanitizedRisk',
    'overMimicryRisk', 'expressionRisk', 'sequenceSimilarityRisk'] as const
  const offenders: string[] = []
  const block = derivedDataBlock()
  const signalsJson = JSON.stringify(computeStyleSignals(SAMPLE_BODY))
  for (const f of M3) {
    // 🔴 단어 경계가 아니라 **부분 문자열**로 본다.
    //    `\b` 는 `_` 를 단어 문자로 보므로 `_naturalnessScore` 를 놓친다
    //    (역검증에서 실제로 통과했다). 주석은 이미 걷어냈으니 오탐이 없다.
    if (block.includes(f)) offenders.push(`create data 에 ${f}`)
    if (styleCode.includes(f)) offenders.push(`style lib 에 ${f}`)
    if (commentCode.includes(f)) offenders.push(`comment lib 에 ${f}`)
    if (liveCode.includes(f)) offenders.push(`live 에 ${f}`)
    if (signalsJson.includes(f)) offenders.push(`신호 산출물에 ${f}`)
  }
  // schema 에도 컬럼이 없어야 한다
  const schema = readFileSync(join(HERE, '../prisma/schema.prisma'), 'utf-8')
  const m = schema.match(/model VoiceDerived \{([\s\S]*?)\n\}/)
  if (!m) offenders.push('schema 에 VoiceDerived 가 없다')
  else {
    const bodyLines = m[1].split('\n').filter((l) => !/^\s*\/\/\/?/.test(l)).join('\n')
    for (const f of M3) if (new RegExp(`\\b${f}\\b`).test(bodyLines)) offenders.push(`schema 에 ${f} 컬럼`)
  }
  if (offenders.length) bad('VE-M3 신호 7종 미생성', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('VE-M3 신호 7종 미생성', 'policy', 'create · lib · 산출물 · schema 전부 0')
}

// ── ⑩ LLM · API · 크롤링이 없다 (비용 0원) ──────────────
{
  const offenders: string[] = []
  for (const [label, code] of [['live', liveCode], ['style lib', styleCode], ['comment lib', commentCode]] as const) {
    if (/openai|anthropic|\bclaude\b|gpt-|gemini/i.test(code)) offenders.push(`${label} 에 LLM 참조`)
    if (/\bfetch\s*\(|axios|got\(|node-fetch|https?\.request/.test(code)) offenders.push(`${label} 에 네트워크 호출`)
    if (/puppeteer|playwright|cheerio|jsdom/i.test(code)) offenders.push(`${label} 에 크롤링 도구`)
    if (/Math\.random/.test(code)) offenders.push(`${label} 에 난수 — 재현 불가능해진다`)
  }
  // 🔴 lib 은 DB 도 몰라야 한다. 계산과 저장을 섞지 않는다
  if (/PrismaClient/.test(styleCode)) offenders.push('style lib 이 DB 를 안다')
  if (/PrismaClient/.test(commentCode)) offenders.push('comment lib 이 DB 를 안다')
  if (offenders.length) bad('LLM · API · 크롤링 0 (비용 0원)', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('LLM · API · 크롤링 0 (비용 0원)', 'guard', 'LLM 0 · fetch 0 · 크롤러 0 · 난수 0 · lib 은 DB 모름')
}

// ── ⑪ --apply 는 --limit 을 요구한다 ────────────────────
{
  const offenders: string[] = []
  if (!/const APPLY = process\.argv\.includes\('--apply'\)/.test(liveCode)) offenders.push('APPLY 게이트 없음')
  if (!/if \(APPLY && LIMIT === null\)/.test(liveCode)) offenders.push('--limit 요구 없음')
  // write 는 전부 APPLY 뒤에 있어야 한다
  for (const call of ['voiceDerived.create(', 'voiceCommentSignal.createMany(']) {
    const at = liveCode.indexOf(call)
    if (at === -1) { offenders.push(`${call} 를 찾지 못했다`); continue }
    const before = liveCode.slice(0, at)
    if (!/if \(!APPLY\) \{/.test(before)) offenders.push(`${call} 앞에 dry-run 분기가 없다`)
  }
  if (offenders.length) bad('--apply 는 --limit 을 요구한다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('--apply 는 --limit 을 요구한다', 'guard', 'dry-run 기본 · write 는 게이트 뒤')
}

// ── ⑫ 중복은 SKIP · 상수가 고정돼 있다 ──────────────────
{
  const offenders: string[] = []
  if (STYLE_RULE_VERSION !== 'voice-m2-rule-v1') {
    offenders.push(`ruleVersion 이 ${STYLE_RULE_VERSION} (1차값은 voice-m2-rule-v1)`)
  }
  if (!/const METHOD = 'rule'/.test(liveCode)) offenders.push("method 가 'rule' 고정이 아니다")
  if (!/const MODEL = ''/.test(liveCode)) offenders.push("model 이 '' 가 아니다")
  if (!/const PROMPT_VERSION = ''/.test(liveCode)) offenders.push("promptVersion 이 '' 가 아니다")
  // 🔴 중복 확인을 **배치로** 한다. 행마다 조회하면 9,674 왕복이다
  if (!/voiceDerived\.findMany\(/.test(liveCode)) offenders.push('기존 계산분 배치 조회가 없다')
  if (!/skipDuplicates: true/.test(liveCode)) offenders.push('댓글 신호 중복 SKIP 이 없다')
  if (offenders.length) bad('상수 고정 · 중복 SKIP', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('상수 고정 · 중복 SKIP', 'guard', `${STYLE_RULE_VERSION} · rule · '' · '' · 배치 조회`)
}

// ── ⑬ 로그에 원문 · 댓글 · 닉네임을 흘리지 않는다 ────────
{
  const offenders: string[] = []
  const logs = liveCode.split('\n').filter((l) => /console\.(log|error)/.test(l))
  for (const l of logs) {
    if (/\$\{[^}]*\bcontent\b[^}]*\}/.test(l) && !/contentHash|contentLength/.test(l)) {
      offenders.push('로그에 본문 변수')
    }
    if (/\$\{[^}]*\bauthor\b[^}]*\}/.test(l) && !/authorHash/.test(l)) offenders.push('로그에 닉네임')
    if (/\$\{[^}]*topComments[^}]*\}/.test(l)) offenders.push('로그에 댓글 원문')
  }
  // 요약 함수도 본문을 담지 않아야 한다
  const s = summarizeCommentSignals(toCommentSignals(
    [{ author: '홍길동', content: '저도 겪었어요 병원 다녀오세요' }],
    { capturedAt: new Date(0) },
  ))
  const sj = JSON.stringify(s)
  if (sj.includes('겪었어요') || sj.includes('홍길동')) offenders.push('요약에 본문 · 닉네임')
  if (offenders.length) bad('로그에 원문을 흘리지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('로그에 원문을 흘리지 않는다', 'guard', `console ${logs.length}줄 정결 · 요약 ${sj.length}B`)
}

// ── 출력 ────────────────────────────────────────────────
console.log('\nVE-M2-2 규칙 신호 — fixture 자기검증')
console.log('  이 fixture 는 네트워크 · DB · LLM 을 타지 않는다')
console.log('  🔴 검사하는 것은 "신호가 잘 뽑히는가" 가 아니라 "선을 넘지 않는가" 다\n')
const label: Record<string, string> = { policy: '[정책]  ', guard: '[가드]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(30)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — 규칙 신호 경로가 선을 넘지 않는다\n`)
