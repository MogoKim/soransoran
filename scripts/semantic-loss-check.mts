/**
 * 의미 손실 감사 검사 — 🔴 **v7 운영 08:15·12:15 의 의미 경고를 개인정보 없이 재생한다** (2026-10-13 · quality-v8)
 *
 * 🔴 네트워크 0 · provider 0 · DB 0. fixture 는 운영 구조만 재현한 **합성 글**이다
 *    (`scripts/__fixtures__/semantic-loss/v7-0815-1215.json` · v1Spans 는 origin/main 018da79c 코드가 만든 값).
 * 🔴 `check:content-core-v2` 가 `generation-loss-check` 끝에서 이 파일을 부른다 — 같은 CI 줄이다.
 *
 * 반례 목록
 *   ① 수집기가 두 번 이어 붙인 본문만 걷어낸다 — 사람이 쓴 되풀이는 건드리지 않는다
 *   ② 재생: 고치기 전 근거 묶음은 끝나지 않은 문장을 꼬리로 보냈고, 고친 뒤에는 한 벌 전체가 간다
 *   ③ 생성 입력: 보존할 사실이 구조로 간다 · 전하는 말에 보고 들은 경로를 지어 붙이지 않는다
 *   ④ 🔴 검수는 그대로다 — 검수 프롬프트 · 판 · 경고 코드 · 근거 대조 · 기계 결론이 한 글자도 같다
 *   ⑤ 🔴 잘림 · 파싱 · 무응답은 의미 탈락이 아니다 — 경고 수 0 · INCOMPLETE 하나
 *   ⑥ 러너 배선: 실제 `runContentCore` 가 고친 묶음과 `보존` 을 요청에 싣는다
 *   ⑦ 분류표 — 경고 5건의 원인과 이번 판이 다루는 몫
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  runContentCore, personaInputOf, STAGE_MODEL, type Ask, type AskResult,
} from './lib/content-core-run.mjs'
import {
  REVIEW_FAMILY_SPECIFICS_LINES, buildV2DraftPayload, buildV2DraftSystemPrompt, buildV2ReviewSystemPrompt, sourceBlock, sourceKeepOf,
} from './lib/content-core-prompts.mjs'
import { BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'
import {
  COLLECTION_TRIM_SLACK, EVIDENCE_CHAR_BUDGET, EVIDENCE_PACKET_VERSION, REPEAT_MIN_CHARS,
  buildEvidencePacket, collapseRepeatedBody, type SourceEvidencePacket,
} from '../src/lib/content-core/evidence'
import {
  REVIEW_VERSION, groundedInDraft, groundedInSource, judgeMachine, parseSemanticReview,
} from '../src/lib/content-core/review'
import {
  CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION, STAGE_MAX_OUTPUT_LABEL,
  V2_DRAFT_PROMPT_VERSION, V2_REVIEW_PROMPT_VERSION,
} from '../src/lib/content-core/pipeline'
import { COPY_RUN_CHARS, COPY_RUN_WORDS } from '../src/lib/draft-originality'
import { SPEAKER_PLAN_VERSION, parseSpeakerPlan, type SpeakerPlan } from '../src/lib/content-core/speaker'
import { buildVoiceEvidence } from '../src/lib/content-core/voice-evidence'
import {
  SEMANTIC_HOLD_CODES, semanticHoldsOf, semanticSummaryOf,
} from '../src/lib/semantic-summary-codes'
import type { PoolCard } from '../src/lib/persona-pool-card'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : ` — ${extra}`}`) }
}
const NOW = new Date('2026-10-13T03:15:00.000Z')
const flat = (s: string): string => s.replace(/\s+/g, '')
/** 🔴 (v2-review-p8) 가족 사실 줄만 걷어낸 검수 지시문 — 이것이 main(p7)과 같아야 다른 축 기준이 그대로다 */
const withoutFamilyLines = (sys: string): string => sys.split('\n').filter((l) => !REVIEW_FAMILY_SPECIFICS_LINES.includes(l)).join('\n')

type Flag = { evidence: string; why: string; class: FlagClass }
type FlagClass = 'collectorRepeatCut' | 'accessPathInvented' | 'paraphraseFlagged' | 'intensityFlagged'
type Case = {
  id: string; run: string; title: string; rawBody: string
  plan: Record<string, unknown>
  draft: { title: string; body: string }
  review: { droppedFromSource: Flag[]; unsupportedAdditions: Flag[]; lifeContradictions: never[]; issues: string[]; confidence: number; note: string }
  v1Spans: { kind: string; text: string }[]; v1Truncated: boolean; v1BodyLength: number
  unflaggedLoss?: string[]
}
type Incomplete = {
  id: string; run: string; stage: string; machineOutcome: string
  semanticCompletion: { complete: boolean; reason: string; cause: string }
}
const FX = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'semantic-loss', 'v7-0815-1215.json'), 'utf8')) as
  { cases: Case[]; incomplete: Incomplete[] }
const CASE = (id: string): Case => FX.cases.find((c) => c.id === id)!
const packetOf = (c: Case): SourceEvidencePacket =>
  buildEvidencePacket({ sourceArticleId: c.id, title: c.title, maskedBody: c.rawBody })
const v1BlockOf = (c: Case): string =>
  [`제목: ${c.title}`, ...c.v1Spans.filter((s) => s.kind !== 'title').map((s) => s.text)].join('\n')

// ── 정본 카드 → 정본 변환 ──
const CARD = (o: Partial<PoolCard> & { code: string }): PoolCard => ({
  code: o.code, birthDate: '1972-04-04', title: `카드 ${o.code}`,
  ageBand: '50대 초반', region: '수도권', maritalStatus: o.maritalStatus ?? '기혼',
  spouseRelationship: null, childrenCount: 0, childrenAgeBands: [],
  workStatus: '전업', economicStatus: '보통', housing: '자가', menopauseStatus: '중',
  parentCare: '없음', personality: ['담담함'], noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
  voiceTokens: ['짧은 문장', '~요 기본'], voiceLength: '짧게', variationCount: 3,
  household: { childrenLiving: null, careSide: null, careCohabit: null },
})
const PERSONAS = [
  personaInputOf(CARD({ code: 'P21' }), { samples: ['그러게요 저도 그래요', '맞아요 저희 집도요'], bundleDigest: 'bundle0000000021' }),
  personaInputOf(CARD({ code: 'P22', maritalStatus: '미혼' }), { samples: ['저도 궁금했어요', '그쵸 그런 날 있어요'], bundleDigest: 'bundle0000000022' }),
]
const planOf = (c: Case): SpeakerPlan => {
  const p = packetOf(c)
  return parseSpeakerPlan(JSON.stringify(c.plan), p, PERSONAS).plan
}
const lifeOf = (plan: SpeakerPlan) => PERSONAS.find((x) => x.code === plan.personaCode) ?? PERSONAS[0]!
const voiceOf = (code: string) => {
  const p = PERSONAS.find((x) => x.code === code) ?? PERSONAS[0]!
  return buildVoiceEvidence({ personaCode: p.code, voiceTokens: p.voiceTokens, samples: p.samples, bundleDigest: p.bundleDigest, sourceDigest: 'asset000000000' })
}

console.log('\n══ 의미 손실 감사 검사 (🔴 합성 fixture · 네트워크 0 · provider 0 · DB 0) ══')

// ─────────────────────────────────────────────────────────
console.log('\n① 🔴 수집기가 두 번 이어 붙인 본문만 걷어낸다')
// ─────────────────────────────────────────────────────────
{
  const X = '오늘 아침에 남편이랑 산책을 다녀왔는데\n\n바람이 차서 금방 들어왔어요\n\n다들 요즘 산책 하시나요'
  check('🔴 수집 상한 = 근거 예산 (300자) — 두 값이 갈리면 상한 판정이 틀린다', BODY_HEAD_CHARS === EVIDENCE_CHAR_BUDGET)
  check('🔴 같은 글 두 벌 → 한 벌', collapseRepeatedBody(`${X}\n${X}`).text === X && collapseRepeatedBody(`${X}\n${X}`).collapsed)
  check('🔴 두 벌 사이 공백·줄바꿈이 달라도 한 벌', collapseRepeatedBody(`${X} ${X.replace(/\n\n/g, '\n')}`).text === X)
  const long = `${X}\n${'그래서 오늘은 집에서 따뜻한 차를 마시면서 창밖만 봤어요. '.repeat(6)}`.trim()
  const capped = `${long}\n${long}`.slice(0, EVIDENCE_CHAR_BUDGET).trim()
  check('🔴 상한에서 잘린 두 번째 벌(첫 벌의 첫머리) → 첫 벌만', collapseRepeatedBody(capped).text === long, `${collapseRepeatedBody(capped).text.length}/${long.length}`)
  // 🔴 여유 경계 양쪽 — 상한 - 여유 + 1 자는 상한으로, 상한 - 여유 자는 상한 밖으로 본다
  // 다듬은 뒤 길이로 자른다 — 공백에서 끊기면 수집기처럼 다듬어져 짧아진다
  const two = `${long}\n${long}`
  const prefixes = Array.from({ length: two.length }, (_, k) => two.slice(0, k + 1).trim())
  const inside = prefixes.find((x) => x.length > EVIDENCE_CHAR_BUDGET - COLLECTION_TRIM_SLACK)!
  const outside = [...prefixes].reverse().find((x) => x.length <= EVIDENCE_CHAR_BUDGET - COLLECTION_TRIM_SLACK)!
  check(`🔴 상한 뒤 끝 공백을 다듬은 길이(여유 안 ${inside.length}자)도 상한으로 본다`,
    inside.length < EVIDENCE_CHAR_BUDGET && collapseRepeatedBody(inside).text === long)
  check(`🔴 🔴 여유 밖 길이(${outside.length}자)에서 두 번째 벌이 조각이면 → 그대로 (완전한 두 벌만 걷는다)`,
    outside.length > long.length + REPEAT_MIN_CHARS && !collapseRepeatedBody(outside).collapsed)
  // ── 반례: 사람이 쓴 되풀이는 그대로 ──
  const echo = `${X}\n\n오늘 하루도 그렇게 지나갔네요\n\n${X.split('\n')[0]}`
  check('🔴 🔴 짧은 글이 끝에 첫 줄을 다시 쓴 것 → 그대로 (상한 밖이면 완전한 두 벌만 걷는다)', !collapseRepeatedBody(echo).collapsed)
  check('🔴 🔴 짧은 되풀이 → 그대로', !collapseRepeatedBody('보고싶다 엄마\n보고싶다 엄마').collapsed
    && flat('보고싶다엄마보고싶다엄마').length < REPEAT_MIN_CHARS * 2)
  const mid = `${X}\n\n중간에 한 줄\n\n${X}\n\n그리고 끝에 다른 이야기가 이어집니다`
  check('🔴 🔴 가운데 되풀이 뒤에 다른 말이 이어지면 → 그대로', !collapseRepeatedBody(mid).collapsed)
  const diverge = `${X}\n${X.slice(0, 30)}그런데 사실 다른 이야기예요`
  check('🔴 🔴 두 번째 벌이 중간에 갈라지면 → 그대로', !collapseRepeatedBody(diverge).collapsed)
  check('🔴 남기는 것은 첫 벌의 글자 그대로 — 고치지 않는다', `${X}\n${X}`.startsWith(collapseRepeatedBody(`${X}\n${X}`).text))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 재생 — 고치기 전 근거 묶음(evidence-v1)과 고친 뒤(evidence-v2)')
// ─────────────────────────────────────────────────────────
{
  check('🔴 근거 묶음 판 = evidence-v2', EVIDENCE_PACKET_VERSION === 'evidence-v2')
  const A = CASE('A'); const B = CASE('B'); const C = CASE('C')
  const pa = packetOf(A); const pb = packetOf(B); const pc = packetOf(C)
  const headOf = (p: SourceEvidencePacket) => p.spans.find((s) => s.kind === 'head')?.text ?? ''
  // A — 같은 글 두 벌
  check('A v1: 같은 글이 두 번 실렸다 (재현 확인)', flat(A.v1Spans[1]!.text).length > 2 * flat(headOf(pa)).length - 4)
  check('🔴 A v2: 한 벌만 · 잘림 없음', !pa.truncated && pa.spans.length === 2 && flat(`${headOf(pa)}${headOf(pa)}`) === flat(A.rawBody))
  // B — 상한에서 잘린 두 벌 → v1 은 끝나지 않은 문장을 머리 끝으로, 두 번째 벌 중간을 꼬리로 보냈다
  const bDrop = B.review.droppedFromSource[0]!.evidence
  const bTail = B.v1Spans.find((s) => s.kind === 'tail')!.text
  check('B v1: 검수가 "사라졌다" 고 적은 문장은 머리 끝에서 잘린 조각이다 (재현 확인)',
    B.v1Truncated && flat(B.v1Spans.find((s) => s.kind === 'head')!.text).endsWith(flat(bDrop)) && !/[요다?]\s*$/.test(bDrop), bDrop)
  check('B v1: 꼬리는 원문의 끝이 아니라 두 번째 벌의 중간이다 (재현 확인)', flat(headOf(pb)).includes(flat(bTail)))
  check('🔴 B v2: 한 벌 전체가 머리 하나로 · 꼬리 없음 · 잘림 없음',
    !pb.truncated && pb.spans.filter((s) => s.kind === 'tail').length === 0 && /갈비찜은 손이 더 많이 가요 ㅠ$/.test(headOf(pb)), headOf(pb).slice(-20))
  const bLast = headOf(pb).split(/\n+/).map((x) => x.trim()).filter((x) => x !== '').pop() ?? ''
  check('🔴 B v2: 그 문장이 끝까지 있다 — 생성·검수가 끝난 문장을 본다',
    flat(bLast).startsWith(flat(bDrop)) && flat(bLast).length > flat(bDrop).length && /[요다?]\s*ㅠ?$/.test(bLast), bLast)
  // C — 두 벌이 아닌 긴 글은 그대로 (상한에서 잘린 글은 잘린 채)
  check('🔴 C: 두 벌이 아닌 글은 v1 과 같은 근거 — 바꾸지 않는다',
    JSON.stringify(pc.spans.map((s) => ({ kind: s.kind, text: s.text }))) === JSON.stringify(C.v1Spans) && pc.truncated)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 생성 입력 — 🔴 보존할 사실은 구조로 · 보고 들은 경로는 지어 붙이지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 초안 프롬프트 판 = v2-draft-p12', V2_DRAFT_PROMPT_VERSION === 'v2-draft-p12' && CONTENT_CORE_PROMPT_VERSION.includes('v2-draft-p12'))
  for (const id of ['A', 'B', 'C']) {
    const c = CASE(id); const packet = packetOf(c); const plan = planOf(c)
    const keep = sourceKeepOf(plan, packet)
    const raw = JSON.parse(buildV2DraftPayload({ packet, plan })) as { 원문: string; 보존?: typeof keep }
    check(`${id}: 🔴 🔴 초안 요청에 [보존] 칸이 있다`, raw.보존 !== undefined, Object.keys(raw).join(','))
    const sent = { 원문: raw.원문, 보존: raw.보존 ?? { 그대로쓸말: [], 원문의물음: [], 원문범위: '' } }
    check(`${id}: 보존.그대로쓸말 = 계획의 지킬 말 그대로`,
      JSON.stringify(sent.보존.그대로쓸말) === JSON.stringify([...new Set(plan.protectedFacts.map((f) => f.text))]) && plan.protectedFacts.length > 0)
    check(`${id}: 보존.원문범위 = 근거 묶음의 잘림`, sent.보존.원문범위 === (packet.truncated ? '일부' : '전체'))
    check(`${id}: 🔴 보존.원문의물음 — 묻고 끝나는 원문만 · 원문에 실제로 있는 물음표 문장만`,
      plan.closingIntent === 'ask'
        ? sent.보존.원문의물음.length > 0 && sent.보존.원문의물음.every((q) => /[?？]$/.test(q) && sourceBlock(packet).includes(q))
        : sent.보존.원문의물음.length === 0, JSON.stringify(sent.보존.원문의물음))
    check(`${id}: 원문은 고친 근거 묶음 그대로`, sent.원문 === sourceBlock(packet))
  }
  const c = CASE('C'); const plan = planOf(c)
  const sys = buildV2DraftSystemPrompt({ plan, voice: voiceOf(plan.personaCode ?? 'P21'), life: lifeOf(plan), mappings: [] })
  check('🔴 🔴 초안 지시문이 보고 · 읽고 · 들은 경로를 지어 붙이지 말라고 한다 (운영 두 편의 말을 예로)',
    sys.includes('어디서 보고 · 읽고 · 들었는지') && sys.includes('"어디서 봤는데"') && sys.includes('"어떤 글을 봤는데"'))
  check('🔴 초안 지시문이 [보존] 세 칸을 설명한다', ['그대로쓸말', '원문의물음', '원문범위'].every((k) => sys.includes(k)))
  check('🔴 보존은 문장 복제 허가가 아니다 — 짧은 원자적 사실만 그대로',
    sys.includes('짧은 원자적 사실만') && sys.includes('원문의 앞뒤 문장은 옮기지 않습니다'))
  check('🔴 원문의 물음은 뜻만 살리고 문장·표현은 새로 쓴다',
    sys.includes('물음의 뜻') && sys.includes('문장과 표현은 새로 씁니다'))
  check('🔴 그대로쓸말 밖의 문장과 표현은 원문에서 옮기지 않고 새로 쓴다',
    sys.includes('원문과 겹치지 않게') && sys.includes('그대로쓸말 밖의 문장과 표현은 원문에서 옮기지 말고 새로 씁니다'))
  check('🔴 생성이 현행 복제 게이트 경계를 답하기 전 스스로 대조한다',
    sys.includes(`연속 ${COPY_RUN_WORDS}어절`) && sys.includes(`공백을 빼고 ${COPY_RUN_CHARS}자`)
    && sys.includes('그 문장을 다시 씁니다'))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 검수는 그대로다 — 기준 완화 0')
// ─────────────────────────────────────────────────────────
/**
 * 🔴 **검수 지시문 지문** — origin/main 018da79c 의 `buildV2ReviewSystemPrompt` 가 아래 고정 입력으로 낸 글자의 sha256.
 *    이 값이 바뀌면 검수 기준이 바뀐 것이다 — 이 PR 의 범위가 아니다. 바꾸려면 판(`V2_REVIEW_PROMPT_VERSION`)부터 올린다.
 */
const REVIEW_PROMPT_SHA256 = 'aa33dd5dcee51450fa57be4e12e72e4da9c0327ca0c13c74823dbb7ad765f208'
/** 🔴 같은 방식으로 — origin/main 018da79c 의 `runContentCore` 가 ⑥ 의 입력(B · 그날 기준 카드)으로 보낸 검수 지시문의 sha256 */
const RUNNER_REVIEW_PROMPT_SHA256 = '18a52eb24c7a89caee3c67b3eeff5eeb5a2160a2b51ab7805b5bdc9b550a71e3'
{
  check('🔴 검수 판 그대로(review-v7) · 검수 프롬프트는 p8 (가족 사실 줄 추가 · 2026-10-13 감사 결함)', V2_REVIEW_PROMPT_VERSION === 'v2-review-p8' && REVIEW_VERSION === 'review-v7')
  check('🔴 의미 경고 코드 그대로', JSON.stringify(SEMANTIC_HOLD_CODES) === JSON.stringify({
    unsupportedAdditions: 'SEMANTIC_UNSUPPORTED_ADDITION', lifeContradictions: 'SEMANTIC_LIFE_CONTRADICTION',
    droppedFromSource: 'SEMANTIC_DROPPED_FROM_SOURCE', incomplete: 'SEMANTIC_REVIEW_INCOMPLETE',
  }))
  const c = CASE('B'); const plan = planOf(c)
  const reviewSys = buildV2ReviewSystemPrompt({ plan, voice: voiceOf(plan.personaCode ?? 'P21'), life: lifeOf(plan) })
  const sha = createHash('sha256').update(reviewSys, 'utf8').digest('hex')
  check('🔴 🔴 검수 지시문에서 가족 사실 줄만 걷어내면 main(p7)과 한 글자도 같다 — 다른 축 기준 완화 0',
    createHash('sha256').update(withoutFamilyLines(reviewSys), 'utf8').digest('hex') === REVIEW_PROMPT_SHA256, sha)
  check('🔴 🔴 검수 지시문에 가족 사실 줄이 전부 들어 있다(자녀 수 · 성별 · 나이대 · 남의 자녀 제외)',
    REVIEW_FAMILY_SPECIFICS_LINES.every((l) => reviewSys.split('\n').includes(l)) && reviewSys.includes('자녀 성별 칸이 없다'))
  check('🔴 검수 지시문은 [보존] 을 모른다 — 생성 입력만 바뀌었다', !reviewSys.includes('그대로쓸말') && !reviewSys.includes('원문의물음'))
  // 🔴 같은 경고가 고친 뒤에도 오면 **그대로 센다** — 근거 대조가 느슨해지지 않았다
  for (const id of ['A', 'B', 'C']) {
    const k = CASE(id); const packet = packetOf(k); const draftText = `${k.draft.title}\n${k.draft.body}`
    const parsed = parseSemanticReview(JSON.stringify(k.review))!
    const dropped = groundedInSource(parsed.droppedFromSource, sourceBlock(packet))
    const added = groundedInDraft(parsed.unsupportedAdditions, draftText)
    check(`${id}: 🔴 v7 경고가 고친 묶음에서도 그대로 근거로 인정된다 (탈락 ${dropped.length} · 추가 ${added.length})`,
      dropped.length === k.review.droppedFromSource.length && added.length === k.review.unsupportedAdditions.length)
    const holds = semanticHoldsOf(semanticSummaryOf({
      deterministic: { pass: true }, semanticCompletion: { complete: true },
      semantic: { ...parsed, droppedFromSource: dropped, unsupportedAdditions: added },
    }))
    check(`${id}: 🔴 경고는 그대로 자동 READY 표본에서 뺀다 — ${holds.join(' ') || '(없음)'}`,
      (dropped.length === 0 || holds.includes(`${SEMANTIC_HOLD_CODES.droppedFromSource}:${dropped.length}`))
      && (added.length === 0 || holds.includes(`${SEMANTIC_HOLD_CODES.unsupportedAdditions}:${added.length}`)))
    const j = judgeMachine({
      deterministic: { pass: true, failures: [] },
      semantic: { ...parsed, droppedFromSource: dropped, unsupportedAdditions: added },
      semanticCompletion: { complete: true, reason: null, cause: null },
    })
    check(`${id}: 기계 결론 그대로 — 경고는 사람에게 넘기고 voice 축은 막는다 (${j.outcome})`,
      j.outcome === (k.review.issues.length > 0 ? 'hold' : 'adopt') && j.warnings.length === Number(dropped.length > 0) + Number(added.length > 0))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 잘림 · 파싱 · 무응답은 의미 탈락이 아니다')
// ─────────────────────────────────────────────────────────
{
  for (const x of FX.incomplete) {
    const sum = semanticSummaryOf({ deterministic: { pass: true }, semanticCompletion: x.semanticCompletion, semantic: { droppedFromSource: [], unsupportedAdditions: [], lifeContradictions: [] } })
    const holds = semanticHoldsOf(sum)
    check(`${x.id}(${x.run} ${x.stage} ${x.semanticCompletion.cause}): 🔴 INCOMPLETE 하나 · 탈락·추가 0`,
      holds.length === 1 && holds[0] === SEMANTIC_HOLD_CODES.incomplete && sum !== null && sum.droppedFromSource === 0 && sum.unsupportedAdditions === 0)
  }
  // 🔴 실제 러너에서도 — 판독이 잘리면 검수를 부르지 않고 탈락·추가는 비어 있다
  for (const beat of ['truncated', 'parse', 'noResponse'] as const) {
    const ask: Ask = async (stage) => {
      if (stage !== 'speakerPlan') throw new Error('판독 뒤 단계를 불렀다')
      const base: AskResult = { ok: true, rawText: '{', truncated: false, usageKnown: true, inputTokens: 10, outputTokens: 10, thoughtsTokens: 0, usd: 0.0001, blocked: false, errorCode: null }
      return beat === 'truncated' ? { ...base, truncated: true }
        : beat === 'noResponse' ? { ...base, ok: false, rawText: '', usageKnown: false, usd: null, inputTokens: null, outputTokens: null, thoughtsTokens: null, errorCode: 'HTTP_400' }
          : base
    }
    const a = await runOf(CASE('B'), ask)
    check(`🔴 판독 ${beat}: 원인 ${a.review.semanticCompletion.cause} · 검수 미호출 · 탈락·추가 0`,
      !a.review.semanticCompletion.complete && a.review.droppedFromSource.length === 0 && a.review.unsupportedAdditions.length === 0
      && a.cost.calls.every((x) => x.stage === 'speakerPlan')
      && a.review.semanticCompletion.cause === (beat === 'truncated' ? 'truncated' : beat === 'parse' ? 'parseFailed' : 'noResponse'))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 러너 배선 — 🔴 실제 `runContentCore` 가 고친 묶음과 [보존] 을 싣는다')
// ─────────────────────────────────────────────────────────
async function runOf(c: Case, ask: Ask) {
  return runContentCore({
    artifactId: randomUUID().replace(/-/g, ''), sourceSite: 'navercafe:fixture', sourceArticleId: c.id,
    title: c.title, maskedBody: c.rawBody,
    sourceMeta: { site: 'navercafe:fixture', postedAt: NOW, capturedAt: NOW, imageCount: null },
    personas: PERSONAS, personaPoolSize: PERSONAS.length, voiceSourceDigest: 'asset000000000',
    contract: {
      sourceInputHash: `fx${c.id}00000000000000`, pipelineVersion: CONTENT_CORE_PIPELINE_VERSION, promptVersion: CONTENT_CORE_PROMPT_VERSION,
      speakerPlanVersion: SPEAKER_PLAN_VERSION, reviewVersion: REVIEW_VERSION, planPromptDigest: 'plan000000000000',
      stageModels: STAGE_MODEL, stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL, voiceAssetDigest: 'asset000000000', personaPoolDigest: 'pool0000000000',
    },
    ask, now: NOW, callCap: 3, retryCap: 0,
  })
}
{
  const c = CASE('B')
  const sent: { stage: string; system: string; payload: string }[] = []
  const ok = (text: string): AskResult => ({ ok: true, rawText: text, truncated: false, usageKnown: true, inputTokens: 100, outputTokens: 20, thoughtsTokens: 5, usd: 0.0001, blocked: false, errorCode: null })
  const a = await runOf(c, async (stage, system, payload) => {
    sent.push({ stage, system, payload })
    return ok(JSON.stringify(stage === 'speakerPlan' ? c.plan : stage === 'draftGen' ? c.draft : c.review))
  })
  const packet = packetOf(c)
  const d = sent.find((x) => x.stage === 'draftGen')
  const r = sent.find((x) => x.stage === 'semanticReview')
  const p = sent.find((x) => x.stage === 'speakerPlan')
  check('🔴 판독 → 초안 → 검수 각 1회', sent.map((x) => x.stage).join(',') === 'speakerPlan,draftGen,semanticReview', `${sent.map((x) => x.stage).join(',')} · ${a.review.machineReason}`)
  const dp = d === undefined ? null : JSON.parse(d.payload) as { 원문: string; 보존?: { 그대로쓸말: string[]; 원문의물음: string[]; 원문범위: string } }
  check('🔴 🔴 초안 요청에 [보존] 이 실렸다 — 그대로쓸말 · 원문의물음(제목) · 원문범위 전체',
    dp?.보존 !== undefined && dp.보존.그대로쓸말.includes('갈비찜') && dp.보존.원문의물음.includes(c.title) && dp.보존.원문범위 === '전체', d?.payload.slice(0, 300))
  check('🔴 🔴 초안·검수·판독이 같은 한 벌 원문을 본다 — 두 번째 벌이 없다',
    dp !== null && dp.원문 === sourceBlock(packet) && r !== undefined && (JSON.parse(r.payload) as { 원문: string }).원문 === sourceBlock(packet)
    && p !== undefined && !p.payload.includes(c.rawBody.slice(c.rawBody.length - 40)))
  check('🔴 🔴 러너가 보낸 검수 지시문 — 가족 사실 줄만 빼면 main 러너와 한 글자도 같다 · 그 줄은 실렸다',
    r !== undefined && createHash('sha256').update(withoutFamilyLines(r.system), 'utf8').digest('hex') === RUNNER_REVIEW_PROMPT_SHA256
    && REVIEW_FAMILY_SPECIFICS_LINES.every((l) => r.system.includes(l)))
  check('🔴 artifact 근거 판 = evidence-v2 · 길이는 한 벌', a.evidence.packetVersion === 'evidence-v2' && a.evidence.bodyLength === packet.bodyLength && packet.bodyLength < c.v1BodyLength)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 분류표 — v7 08:15·12:15 의미 경고 5건')
// ─────────────────────────────────────────────────────────
{
  const flags = FX.cases.flatMap((c) => [...c.review.droppedFromSource, ...c.review.unsupportedAdditions].map((f) => ({ id: c.id, ...f })))
  const by = (k: FlagClass) => flags.filter((f) => f.class === k).length
  const table: Record<FlagClass, { n: number; where: string; handled: boolean }> = {
    collectorRepeatCut: { n: by('collectorRepeatCut'), where: '중간 변환 — 수집 두 벌 + 근거 묶음 재절단', handled: true },
    accessPathInvented: { n: by('accessPathInvented'), where: '생성 지시문 — 전하는 말에 보고 들은 경로를 지어 붙임', handled: true },
    paraphraseFlagged: { n: by('paraphraseFlagged'), where: '검수 판단 — 원문 `왈` 을 풀어 쓴 것을 새 사실로 셈', handled: false },
    intensityFlagged: { n: by('intensityFlagged'), where: '검수 판단 — 감정의 세기 차이를 탈락으로 셈', handled: false },
  }
  for (const [k, v] of Object.entries(table)) console.log(`   ${v.handled ? '🛠 ' : '👤 '}${k} ${v.n}건 — ${v.where}${v.handled ? '' : ' (사람 검토 유지 · 기준 그대로)'}`)
  check('경고 5건 = 탈락 2 · 추가 3', flags.length === 5
    && FX.cases.reduce((n, c) => n + c.review.droppedFromSource.length, 0) === 2
    && FX.cases.reduce((n, c) => n + c.review.unsupportedAdditions.length, 0) === 3)
  check('🔴 이번 판이 원인을 고친 몫 3 · 검수 판단으로 사람에게 남는 몫 2',
    Object.values(table).filter((v) => v.handled).reduce((n, v) => n + v.n, 0) === 3
    && Object.values(table).filter((v) => !v.handled).reduce((n, v) => n + v.n, 0) === 2)
  check('잘림 3건은 표에 없다 — 의미 경고가 아니다', FX.incomplete.length === 3 && flags.every((f) => !FX.incomplete.some((x) => x.id === f.id)))
  const missed = FX.cases.flatMap((c) => c.unflaggedLoss ?? [])
  console.log(`   ⚠️ 검수가 잡지 못한 실제 손실 ${missed.length}건 — 경고 수가 0 이어도 손실 0 이 아니다`)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 합성 fixture 재생이다 — 실제 모델이 경로를 덜 붙이는지 · 검수 경고가 줄어드는지는 운영 실측으로만 안다.')
if (fail > 0) process.exit(1)
