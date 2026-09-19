#!/usr/bin/env tsx
/**
 * Content Core v2 행동 검사 — 🔴 **네트워크 0 · 실제 provider 0 · DB 0**
 *
 * 🔴 **정규식이 있는지 세지 않는다.** 실제 함수를 돌려 나온 `HumanReviewArtifact` 와
 *    **실제로 provider 에게 간 payload 값**으로 본다.
 *
 * 🔴 **검사 수는 성과가 아니다.** 가짜 provider 는 정해진 답을 돌려준다.
 *    실제 모델이 쓸 만한 글을 쓰는지는 사람 평가와 유료 실측으로만 안다.
 *
 * 🔴 **이 판의 핵심**: `SELF_EXPERIENCE` 는 **코드가 검증한 허가 근거** 없이 나올 수 없다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { runContentCore, personaInputOf, type Ask, type AskResult, type PersonaInput }
  from './lib/content-core-run.mjs'
import {
  buildSpeakerPlanSystemPrompt, buildV2DraftSystemPrompt, lifeContractLines,
  qualificationLine, sourceBlock,
} from './lib/content-core-prompts.mjs'
import { isContentCoreV2Enabled, CONTENT_CORE_V2_ENV, CONTENT_CORE_V2_FLAG_REMOVE_AT }
  from '../src/lib/content-core/flag'
import { cardValueText, hasFact, verifySelfWarrants }
  from '../src/lib/content-core/speaker'
import { EVIDENCE_CHAR_BUDGET, buildEvidencePacket } from '../src/lib/content-core/evidence'
import { judgeProtectedFact, normalizeForProvenance } from '../src/lib/content-core/source-facts'
import { LIFE_CONTRADICTION_FACTS, SEMANTIC_AXES } from '../src/lib/content-core/review'
import { violatesArtifact, artifactSummary, type HumanReviewArtifact }
  from '../src/lib/content-core/artifact'
import { buildVoiceEvidence, voiceStandardOf, VOICE_SAMPLE_MIN }
  from '../src/lib/content-core/voice-evidence'
import type { PoolCard } from '../src/lib/persona-pool-card'
import type { ChildAgeBand } from '../src/lib/original-post-persona-match'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : ` — ${extra}`}`) }
}
const NOW = new Date('2026-09-19T10:00:00.000Z')

type Canned = { plan?: unknown; draft?: unknown; review?: unknown }
const okRes = (text: string): AskResult => ({
  ok: true, rawText: text, truncated: false, usageKnown: true,
  inputTokens: 100, outputTokens: 20, usd: 0.0001, blocked: false,
})
const EMPTY_REVIEW = {
  droppedFromSource: [], unsupportedAdditions: [], lifeContradictions: [],
  issues: [], confidence: 0.9, note: '',
}
const pick = (c: Canned, stage: string): string => JSON.stringify(
  stage === 'speakerPlan' ? c.plan ?? {}
    : stage === 'draftGen' ? c.draft ?? {}
      : c.review ?? EMPTY_REVIEW)

/** 🔴 **보낸 것을 값으로 본다** — 실제로 provider 에게 간 system·payload 를 기록한다 */
type Sent = { stage: string; system: string; payload: string }
let SENT: Sent[] = []
const sentOf = (stage: string): Sent[] => SENT.filter((x) => x.stage === stage)

const fakeAsk = (c: Canned, fault: { truncate?: string; blocked?: string; usageUnknown?: string } = {}): Ask =>
  async (stage, system, payload) => {
    SENT.push({ stage, system, payload })
    if (fault.blocked === stage) {
      return { ok: false, rawText: '', truncated: false, usageKnown: false, inputTokens: null, outputTokens: null, usd: null, blocked: true }
    }
    if (fault.truncate === stage) return { ...okRes(''), truncated: true }
    if (fault.usageUnknown === stage) return { ...okRes(pick(c, stage)), usageKnown: false, inputTokens: null, outputTokens: null, usd: null }
    return okRes(pick(c, stage))
  }

/** 🔴 정본 카드를 만들고 **정본 변환**을 지난다 — 축소판을 손으로 조립하지 않는다 */
const CARD = (o: Partial<PoolCard> & { code: string }): PoolCard => ({
  code: o.code,
  title: o.title ?? `카드 ${o.code}`,
  ageBand: o.ageBand ?? '40대 후반',
  region: o.region ?? '수도권',
  maritalStatus: o.maritalStatus ?? '기혼',
  spouseRelationship: o.spouseRelationship ?? null,
  childrenCount: o.childrenCount ?? 0,
  childrenAgeBands: o.childrenAgeBands ?? [],
  workStatus: o.workStatus ?? '전업',
  economicStatus: o.economicStatus ?? '보통',
  housing: o.housing ?? '자가',
  menopauseStatus: o.menopauseStatus ?? '전',
  parentCare: o.parentCare ?? '없음',
  personality: o.personality ?? ['조심스러움'],
  noGoTopics: o.noGoTopics ?? [],
  noGoExpressions: o.noGoExpressions ?? [],
  forbiddenReactionRoles: o.forbiddenReactionRoles ?? [],
  voiceTokens: o.voiceTokens ?? ['짧은 문장', '~해요 기본'],
  voiceLength: o.voiceLength ?? '짧게',
  variationCount: o.variationCount ?? 3,
})
const DEFAULT_SAMPLES = ['그러게요 저도 비슷하게 느꼈어요', '맞아요 저도 같은 생각이에요']
const P = (o: Partial<PoolCard> & { code: string }
  & { samples?: readonly string[]; bundleDigest?: string }): PersonaInput =>
  personaInputOf(CARD(o), {
    samples: o.samples ?? DEFAULT_SAMPLES,
    bundleDigest: o.bundleDigest ?? 'bundle0000000000',
  })

/** 알바 원문에 자격이 있는 사람 · 없는 사람 */
const partTime = P({ code: 'P01', workStatus: '파트타임', childrenCount: 2, childrenAgeBands: ['중고등'] as ChildAgeBand[] })
const homemaker = P({ code: 'P02', workStatus: '전업', childrenCount: 1, region: '광역시' })
const noKids = P({ code: 'P04', childrenCount: 0, workStatus: '직장(정규)' })
const single = P({ code: 'P08', maritalStatus: '비혼', childrenCount: 0, workStatus: '자영업' })
const ALL = [partTime, homemaker, noKids]

const run = (o: {
  id: string; title: string; body: string; canned: Canned
  personas?: readonly PersonaInput[]
  load?: Record<string, number>
  fault?: { truncate?: string; blocked?: string; usageUnknown?: string }
  cap?: number
}): Promise<HumanReviewArtifact> => {
  SENT = []
  return runContentCore({
    sourceArticleId: o.id, title: o.title, maskedBody: o.body,
    personas: o.personas ?? ALL, load: o.load, voiceSourceDigest: 'asset000000000',
    ask: fakeAsk(o.canned, o.fault), now: NOW, callCap: o.cap ?? 6,
  })
}

const fact = (kind: string, text: string, ref = 'head'): unknown => ({ kind, text, evidenceRef: ref })
const warrant = (o: { fact: string; requiredValue: string; evidenceText: string
  evidenceRef?: string; cardValue: string }): unknown => ({
  fact: o.fact, requiredValue: o.requiredValue,
  evidenceRef: o.evidenceRef ?? 'head', evidenceText: o.evidenceText, cardValue: o.cardValue,
})
/** 계획 응답 한 벌 */
const plan = (o: Record<string, unknown>): unknown => ({
  decision: 'ok', protectedFacts: [], closingIntent: 'ask',
  contentRoles: ['conversationSpark'], speakerWarrants: [], universalReason: '', ...o,
})

/** 🔴 실제 원천 셋 — 네 번의 유료 실측에서 쓴 바로 그 글이다 */
const SRC = {
  A: { id: '449853', title: '남편이 집안일 많이 돕나요?',
    body: '티비에는 집안일 돕는 남편들 많이 나오던데.. 왜 저희 애아빠는 안그럴까요\n\n역시 방송은 방송일 뿐일까요' },
  B: { id: '35019068', title: '아들 낳으면 왜 안쓰럽게 보는지',
    body: '딸도 딸 나름이고\n\n아들도 진짜 엄마 잘챙기는 사람들 많이 봤거든요\n\n전 아직 자녀는 없지만\n\n'
      + '엄마 성향에 따라서 오히려 아들이 맞는 사람도\n\n있다고 봤는데ㅋㅋ\n\n주위에도 저런 시선들 많이 보셨나요??' },
  C: { id: '35011647', title: '알바중 여행다녀오면 선물하나요..?',
    body: '누가 대타뛰어준건 아니고 시간 땜빵난건  다른날 다 근무해요.\n\n3시간씩하는데, 직원은 9명정도되요,,,' },
}

console.log('\n══ Content Core v2 행동 검사 (🔴 네트워크 0 · provider 0 · DB 0) ══\n')
// ─────────────────────────────────────────────────────────
console.log('⓪ 스위치 · 운영 배선 — 🔴 이 PR 은 v1 을 한 줄도 바꾸지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 기본은 꺼짐', !isContentCoreV2Enabled({}))
  check('🟢 "true" 하나만 켠다', isContentCoreV2Enabled({ [CONTENT_CORE_V2_ENV]: 'true' }))
  check('🔴 지울 마일스톤이 박혀 있다', CONTENT_CORE_V2_FLAG_REMOVE_AT === 'M5')
  const v1Diff = execFileSync('git', ['diff', '--numstat', 'origin/main', '--',
    'scripts/micro-seed-auto-draft.mts', 'src/lib/micro-seed-auto-draft.ts'], { encoding: 'utf-8' })
  check('🔴 🔴 **v1 이 origin/main 과 0줄 차이다**', v1Diff.trim() === '', v1Diff.trim())
  check('🟢 v1 러너는 그대로 있다', existsSync('scripts/micro-seed-auto-draft.mts'))
  const opsRefs = execFileSync('git', ['grep', '-l', 'content-core', '--', 'src/', 'scripts/'], { encoding: 'utf-8' })
    .trim().split('\n').filter((f) => f !== '' && !f.includes('content-core'))
  check('🔴 운영 코드에 v2 소비자가 없다', opsRefs.length === 0, opsRefs.join(', '))
}

// ─────────────────────────────────────────────────────────
console.log('\n① 🔴 🔴 C 알바 원문 — SELF 는 파트타임 Persona 만, 전업은 불가능')
// ─────────────────────────────────────────────────────────
{
  const PLAN_OK = plan({
    personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
      evidenceRef: 'title', evidenceText: '알바중', cardValue: '파트타임' })],
    protectedFacts: [fact('number', '3시간'), fact('number', '9명')],
    contentRoles: ['usefulAnswer', 'conversationSpark'],
  })
  const DRAFT = { title: '여행 다녀올 때 선물 하시나요',
    body: '대신 서 준 사람은 없고 비는 시간은 제가 다른 날에 채웠어요. 3시간씩 일하고 9명이에요. 다들 사 가시나요.' }

  const ok = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime, homemaker], canned: { plan: PLAN_OK, draft: DRAFT } })
  check('🟢 🔴 **파트타임 Persona 는 근거를 대고 SELF 가 된다**',
    ok.plan.personaCode === 'P01' && ok.plan.stance === 'SELF_EXPERIENCE'
    && ok.plan.selfBasis === 'lifeFacts', ok.plan.reason)
  check('🔴 🔴 **허가 근거가 원문의 알바 문장에서 나왔다**',
    ok.plan.warrants[0]!.evidenceText === '알바중'
    && normalizeForProvenance(SRC.C.title).includes('알바중'))
  check('🔴 카드 값이 그대로 대조됐다', ok.plan.warrants[0]!.cardValue === '파트타임')
  check('🔴 🔴 **정상 경로 3회**', ok.cost.totalCalls === 3, `${ok.cost.totalCalls}회`)
  check('🔴 단계 이름이 셋뿐이다',
    ok.cost.calls.map((c) => c.stage).join(',') === 'speakerPlan,draftGen,semanticReview')

  // 🔴 전업 Persona 를 SELF 로 올리려 하면 — cardValue 를 속이든, 못 채우든 불가능
  const lie = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [homemaker],
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'title', evidenceText: '알바중', cardValue: '파트타임' })],
      contentRoles: ['usefulAnswer'] }), draft: DRAFT } })
  check('🔴 🔴 **전업 카드에 "파트타임" 이라 적으면 대조에서 걸린다**',
    lie.plan.stance !== 'SELF_EXPERIENCE' && lie.plan.rejection === 'cardValueMismatch',
    `${lie.plan.stance} / ${lie.plan.rejection}`)

  const unmet = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [homemaker],
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'title', evidenceText: '알바중', cardValue: '전업' })],
      contentRoles: ['usefulAnswer'] }), draft: DRAFT } })
  check('🔴 🔴 **카드 값을 바로 적어도 파트타임을 충족 못 하면 불가**',
    unmet.plan.stance !== 'SELF_EXPERIENCE' && unmet.plan.rejection === 'requiredValueUnmet',
    `${unmet.plan.stance} / ${unmet.plan.rejection}`)
  check('🔴 🔴 **다른 Persona 를 조용히 고르지 않는다**', unmet.plan.personaCode === 'P02')

  // 🔴 4차 결함 재현 — 근거 없이 SELF 를 주장
  const bare = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [homemaker],
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [], contentRoles: ['usefulAnswer'] }), draft: DRAFT } })
  check('🔴 🔴 **빈 근거로는 SELF 를 허가하지 않는다 (4차 결함)**',
    bare.plan.stance !== 'SELF_EXPERIENCE' && bare.plan.rejection === 'emptyWarrants')
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 남편 자기 경험 → 기혼만 · 자녀 없음 → childrenCount 0 만')
// ─────────────────────────────────────────────────────────
{
  const A_DRAFT = { title: '방송 속 남편들 보면요',
    body: '화면에 나오는 남편들은 집안일을 곧잘 하던데 우리 남편은 딴판이에요. 다들 어떠세요.' }
  const A_PLAN = (code: string, cardValue: string): unknown => plan({
    personaCode: code, stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    speakerWarrants: [warrant({ fact: 'spouse', requiredValue: '있음',
      evidenceText: '왜 저희 애아빠는 안그럴까요', cardValue })],
    protectedFacts: [fact('relation', '남편', 'title')],
    contentRoles: ['conversationSpark', 'experienceResonance'],
  })
  const married = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [partTime], canned: { plan: A_PLAN('P01', '기혼'), draft: A_DRAFT } })
  check('🟢 기혼 Persona 는 남편 이야기를 1인칭으로 쓴다',
    married.plan.stance === 'SELF_EXPERIENCE' && married.plan.personaCode === 'P01')

  const unmarried = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single], canned: { plan: A_PLAN('P08', '비혼'), draft: A_DRAFT } })
  check('🔴 🔴 **비혼 Persona 는 남편 자기 경험이 불가능하다**',
    unmarried.plan.stance !== 'SELF_EXPERIENCE' && unmarried.plan.rejection === 'requiredValueUnmet')

  const B_DRAFT = { title: '아들 낳으면 왜 그런 눈으로 볼까요',
    body: '아들 낳았다고 하면 딱하게 보는 분위기가 있잖아요.\n곁에서 보면 아들이 엄마를 참 잘 챙기더라고요.\n다들 겪어 보셨어요?' }
  const B_PLAN = (code: string, cardValue: string): unknown => plan({
    personaCode: code, stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    speakerWarrants: [warrant({ fact: 'children', requiredValue: '없음',
      evidenceText: '전 아직 자녀는 없지만', cardValue })],
    contentRoles: ['conversationSpark'],
  })
  const childless = await run({ id: SRC.B.id, title: SRC.B.title, body: SRC.B.body,
    personas: [noKids], canned: { plan: B_PLAN('P04', '0'), draft: B_DRAFT } })
  check('🟢 🔴 **자녀 0인 Persona 는 "자녀 없음" 을 1인칭으로 쓴다**',
    childless.plan.stance === 'SELF_EXPERIENCE' && childless.plan.personaCode === 'P04')

  const hasKids = await run({ id: SRC.B.id, title: SRC.B.title, body: SRC.B.body,
    personas: [partTime], canned: { plan: B_PLAN('P01', '2'), draft: B_DRAFT } })
  check('🔴 🔴 **자녀 2명인 Persona 는 "자녀 없음" 이 불가능하다**',
    hasKids.plan.stance !== 'SELF_EXPERIENCE' && hasKids.plan.rejection === 'requiredValueUnmet')
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 허가 근거 검증 — 없는 사람 · 없는 근거 · 모르는 축')
// ─────────────────────────────────────────────────────────
{
  const DRAFT = { title: '여행 선물', body: '3시간씩 일하고 9명이에요. 다들 사 가시나요.' }
  const facts = [fact('number', '3시간'), fact('number', '9명')]

  const ghost = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P99', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: facts,
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임', evidenceRef: 'title', evidenceText: '알바중', cardValue: '파트타임' })] }), draft: DRAFT } })
  check('🔴 🔴 **카드에 없는 personaCode 는 HOLD**',
    ghost.plan.personaCode === null && ghost.plan.rejection === 'unknownPersona'
    && ghost.draft === null, ghost.plan.reason)
  check('🔴 묻기 전에 멈춘다 — 유료 1회', ghost.cost.totalCalls === 1)

  const noEvidence = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: facts, contentRoles: ['usefulAnswer', 'conversationSpark'],
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceText: '제가 편의점에서 일하는데', cardValue: '파트타임' })] }), draft: DRAFT } })
  check('🔴 🔴 **원문에 없는 근거로는 SELF 를 허가하지 않는다**',
    noEvidence.plan.stance !== 'SELF_EXPERIENCE'
    && noEvidence.plan.rejection === 'evidenceNotInSource')
  check('🔴 소재가 사니 같은 사람으로 자리를 낮췄다',
    noEvidence.plan.personaCode === 'P01' && noEvidence.plan.stance === 'QUESTION')

  const oddFact = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: facts, contentRoles: ['usefulAnswer'],
      speakerWarrants: [warrant({ fact: 'income', requiredValue: '많음', evidenceText: '알바중', evidenceRef: 'title', cardValue: 'x' })] }), draft: DRAFT } })
  check('🔴 🔴 **모르는 축은 통과시키지 않는다**',
    oddFact.plan.stance !== 'SELF_EXPERIENCE' && oddFact.plan.rejection === 'unknownFact')

  const oddStance = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'EXPERT', protectedFacts: facts }), draft: DRAFT } })
  check('🔴 모르는 자리 이름은 HOLD', oddStance.plan.rejection === 'unknownStance')
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 load 는 자격을 이기지 못한다')
// ─────────────────────────────────────────────────────────
{
  const DRAFT = { title: '여행 선물', body: '3시간씩 일하고 9명이에요. 다들 사 가시나요.' }
  const facts = [fact('number', '3시간'), fact('number', '9명')]
  // 🔴 P02(전업)는 load 0, P01(파트타임)은 load 5 — 그래도 P02 로 SELF 가 될 수 없다
  const a = await run({
    id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime, homemaker], load: { P01: 5, P02: 0 },
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: facts, contentRoles: ['usefulAnswer', 'conversationSpark'],
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'title', evidenceText: '알바중', cardValue: '전업' })] }), draft: DRAFT } })
  check('🔴 🔴 **load 가 적다고 무자격 Persona 가 SELF 가 되지 않는다**',
    a.plan.stance !== 'SELF_EXPERIENCE' && a.plan.rejection === 'requiredValueUnmet')
  check('🔴 load 는 계획 호출에 **입력으로만** 간다',
    sentOf('speakerPlan')[0]!.payload.includes('맡은 수 5')
    && sentOf('speakerPlan')[0]!.payload.includes('맡은 수 0'))
  check('🔴 계획 지시가 load 로 자격을 뒤집지 말라고 말한다',
    buildSpeakerPlanSystemPrompt().includes('자격 없는 사람을 고르지 않는다'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 자격이 필요 없는 글 — 과차단하지 않되 **명시적 결정**이어야 한다')
// ─────────────────────────────────────────────────────────
{
  const SRC_KIM = { id: 'S5', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.' }
  const DRAFT = { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다.' }

  const universal = await run({ ...SRC_KIM, personas: [homemaker],
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE',
      selfBasis: 'noLifeFactNeeded', universalReason: '특정 직업·가족 사실이 필요 없는 일상 이야기다',
      closingIntent: 'share', contentRoles: ['conversationSpark'] }), draft: DRAFT } })
  check('🟢 🔴 **생활사 자격이 필요 없는 일상글은 과차단하지 않는다**',
    universal.plan.stance === 'SELF_EXPERIENCE'
    && universal.plan.selfBasis === 'noLifeFactNeeded'
    && universal.review.machineOutcome === 'adopt', universal.plan.reason)
  check('🔴 🔴 **빈 배열이 아니라 명시적 값으로 구분된다**',
    universal.plan.warrants.length === 0 && universal.plan.universalReason !== '')

  const silent = await run({ ...SRC_KIM, personas: [homemaker],
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE',
      closingIntent: 'share', contentRoles: ['conversationSpark'] }), draft: DRAFT } })
  check('🔴 🔴 **selfBasis 를 밝히지 않으면 SELF 가 아니다**',
    silent.plan.stance !== 'SELF_EXPERIENCE' && silent.plan.rejection === 'unknownBasis')

  const noReason = await run({ ...SRC_KIM, personas: [homemaker],
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE',
      selfBasis: 'noLifeFactNeeded', closingIntent: 'share',
      contentRoles: ['conversationSpark'] }), draft: DRAFT } })
  check('🔴 이유 없는 "자격 불필요" 는 통과시키지 않는다',
    noReason.plan.rejection === 'noUniversalReason')

  const both = await run({ ...SRC_KIM, personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE',
      selfBasis: 'noLifeFactNeeded', universalReason: 'x', closingIntent: 'share',
      contentRoles: ['conversationSpark'],
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임', evidenceText: '맛은 괜찮네요', cardValue: '파트타임' })] }), draft: DRAFT } })
  check('🔴 자격이 필요 없다면서 근거를 대면 통과시키지 않는다',
    both.plan.rejection === 'warrantsWithoutNeed')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 강등과 HOLD — 소재가 살면 낮추고, 당사자 경험이 알맹이면 멈춘다')
// ─────────────────────────────────────────────────────────
{
  const DRAFT = { title: '남편 집안일 이야기', body: '방송에서는 곧잘 하던데 실제로는 어떠신가요.' }
  const bad = (roles: string[]): unknown => plan({
    personaCode: 'P08', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    contentRoles: roles, closingIntent: 'ask',
    speakerWarrants: [warrant({ fact: 'spouse', requiredValue: '있음',
      evidenceText: '왜 저희 애아빠는 안그럴까요', cardValue: '비혼' })],
  })
  const lowered = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single], canned: { plan: bad(['conversationSpark', 'experienceResonance']), draft: DRAFT } })
  check('🟢 🔴 **물음으로 바꿔도 소재가 살면 자리를 낮춘다**',
    lowered.plan.stance === 'QUESTION' && lowered.plan.personaCode === 'P08' && lowered.draft !== null)
  check('🔴 낮춘 자리가 생성 지시에 들어간다',
    sentOf('draftGen')[0]!.system.includes('이 글 속 경험은 당신 것이 아닙니다'))

  const held = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single], canned: { plan: bad(['experienceResonance']), draft: DRAFT } })
  check('🔴 🔴 **당사자 경험이 알맹이뿐이면 HOLD**',
    held.plan.personaCode === null && held.draft === null
    && held.plan.rejection === 'requiredValueUnmet', held.plan.reason)

  const modelHold = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single], canned: { plan: { decision: 'hold', holdReason: '쓸 사람이 없다' }, draft: DRAFT } })
  check('🔴 계획이 hold 라고 하면 만들지 않는다',
    modelHold.draft === null && modelHold.cost.totalCalls === 1)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 계획 호출이 받는 것 · 남기는 것')
// ─────────────────────────────────────────────────────────
{
  const DRAFT = { title: '여행 선물', body: '3시간씩 일하고 9명이에요. 다들 사 가시나요.' }
  const a = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [P({ code: 'P01', workStatus: '파트타임', samples: ['참고 댓글 본문 하나', '참고 댓글 본문 둘'] })],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: [fact('number', '3시간'), fact('number', '9명')],
      contentRoles: ['usefulAnswer'],
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임', evidenceRef: 'title', evidenceText: '알바중', cardValue: '파트타임' })] }), draft: DRAFT } })
  const sent = sentOf('speakerPlan')[0]!
  check('🔴 🔴 **계획 payload 에 마스킹된 원문이 들어간다**',
    normalizeForProvenance(sent.payload).includes(normalizeForProvenance('누가 대타뛰어준건 아니고')))
  check('🔴 🔴 **후보 카드의 자격 칸이 들어간다**', sent.payload.includes('하는 일 파트타임'))
  check('🔴 🔴 **말투 참고 댓글 본문은 들어가지 않는다**',
    !sent.payload.includes('참고 댓글 본문 하나') && !sent.payload.includes('참고 댓글 본문 둘'))
  check('🔴 자격 줄에 말투·성격이 없다',
    !qualificationLine(partTime).includes('성격') && !qualificationLine(partTime).includes('말투'))
  const json = JSON.stringify(a)
  check('🔴 🔴 **artifact 에 원문 전문이 저장되지 않는다** (300자 예산 안)',
    a.evidence.totalEvidenceChars <= EVIDENCE_CHAR_BUDGET && violatesArtifact(a).length === 0)
  check('🔴 🔴 **artifact 에 카드 전체가 저장되지 않는다**',
    !json.includes('형편') && !json.includes('갱년기') && !json.includes('부모 돌봄'))
  check('🔴 사람이 읽는 한 줄이 남는다', artifactSummary(a).includes('사람 미판정'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 생성·검수 — 원문 직접 · 복제 차단 · 과차단 방지')
// ─────────────────────────────────────────────────────────
{
  const PLAN_OK = plan({
    personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    protectedFacts: [fact('number', '3시간'), fact('number', '9명')],
    contentRoles: ['usefulAnswer', 'conversationSpark'],
    speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임', evidenceRef: 'title', evidenceText: '알바중', cardValue: '파트타임' })],
  })
  const GOOD = { title: '여행 다녀올 때 선물 하시나요',
    body: '대신 서 준 사람은 없고 비는 시간은 제가 다른 날에 채웠어요. 3시간씩 일하고 9명이에요. 다들 사 가시나요.' }
  const base = { id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [partTime] }

  const ok = await run({ ...base, canned: { plan: PLAN_OK, draft: GOOD } })
  check('🔴 🔴 **생성 payload 가 원문을 직접 받는다**',
    normalizeForProvenance(sentOf('draftGen')[0]!.payload).includes(normalizeForProvenance('다른날 다 근무해요')))
  check('🔴 검수도 같은 원문을 본다',
    normalizeForProvenance(sentOf('semanticReview')[0]!.payload).includes(normalizeForProvenance('3시간씩하는데')))
  check('🔴 🔴 **원문이 부른 생활사가 생성·검수에 함께 건네진다**',
    sentOf('draftGen')[0]!.system.includes('work=파트타임')
    && sentOf('semanticReview')[0]!.system.includes('work = 파트타임'))
  check('🟢 조건·숫자를 살린 초안은 통과한다', ok.review.machineOutcome === 'adopt')

  const noNum = await run({ ...base, canned: { plan: PLAN_OK,
    draft: { title: '선물', body: '비는 시간은 제가 다른 날 채웠어요. 사람이 꽤 되는데 다들 사 가시나요.' } } })
  check('🔴 3시간·9명이 빠지면 잡는다',
    noNum.review.deterministic.failures.some((f) => f.code === 'protectedFactMissing'))

  const copied = await run({ ...base, canned: { plan: PLAN_OK,
    draft: { title: '알바중 여행다녀오면 선물하나요..?',
      body: '누가 대타뛰어준건 아니고 시간 땜빵난건  다른날 다 근무해요. 3시간씩하는데, 직원은 9명정도되요' } } })
  check('🔴 🔴 **원문을 통째로 옮기면 차단된다**',
    copied.review.deterministic.failures.some((f) => f.code === 'copiedFromSource'))
  check('🔴 의미 검수까지 가지 않는다 — 유료 2회', copied.cost.totalCalls === 2)

  const invented = await run({ ...base, canned: { plan: PLAN_OK, draft: GOOD,
    review: { ...EMPTY_REVIEW, confidence: 0.85,
      unsupportedAdditions: [{ evidence: '다들 사 가시나요.', why: '원문에 없는 장면' }] } } })
  check('🔴 원문에 없는 사건은 adopt 아님', invented.review.machineOutcome === 'hold')

  const ghostEvidence = await run({ ...base, canned: { plan: PLAN_OK, draft: GOOD,
    review: { ...EMPTY_REVIEW, confidence: 0.85,
      unsupportedAdditions: [{ evidence: '남편이 태워다 준다고 했어요', why: '지어낸 근거' }],
      droppedFromSource: [{ evidence: '사장님이 화를 내셨어요', why: '지어낸 근거' }],
      lifeContradictions: [{ fact: 'work', drafted: 'x', card: 'y', evidence: '저는 집에만 있어요' }] } } })
  check('🔴 🔴 **지어낸 근거 세 종류를 전부 무시한다**',
    ghostEvidence.review.unsupportedAdditions.length === 0
    && ghostEvidence.review.droppedFromSource.length === 0
    && ghostEvidence.review.lifeContradictions.length === 0
    && ghostEvidence.review.machineOutcome === 'adopt')

  const shortPost = await run({
    id: 'S8s', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    personas: [homemaker],
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE',
      selfBasis: 'noLifeFactNeeded', universalReason: '보편적인 일상 이야기',
      closingIntent: 'share', contentRoles: ['conversationSpark'] }),
      draft: { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다.' } } })
  check('🟢 🔴 **짧은 일상글을 과차단하지 않는다**',
    shortPost.review.machineOutcome === 'adopt' && shortPost.cost.totalCalls === 3)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 말투 계약 · 완주 · 단위 검사')
// ─────────────────────────────────────────────────────────
{
  const KIM = { id: 'S9', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.' }
  const PLAN_U = plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE',
    selfBasis: 'noLifeFactNeeded', universalReason: '보편적인 일상 이야기',
    closingIntent: 'share', contentRoles: ['conversationSpark'] })
  const DRAFT = { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다.' }

  const noVoice = await run({ ...KIM, personas: [P({ code: 'P01', voiceTokens: [] })],
    canned: { plan: PLAN_U, draft: DRAFT } })
  check('🔴 🔴 **말투 기준이 비면 초안을 만들지 않는다**',
    noVoice.draft === null && noVoice.cost.totalCalls === 1)
  const few = await run({ ...KIM, personas: [P({ code: 'P01', samples: ['그러게요'] })],
    canned: { plan: PLAN_U, draft: DRAFT } })
  check(`🔴 말투 참고가 ${VOICE_SAMPLE_MIN}건보다 적으면 만들지 않는다`,
    few.draft === null && few.cost.totalCalls === 1)

  const tokens = ['짧은 문장', '~해요 기본', '줄바꿈 잦음']
  const ok = await run({ ...KIM, personas: [P({ code: 'P01', voiceTokens: tokens })],
    canned: { plan: PLAN_U, draft: DRAFT } })
  const std = voiceStandardOf(tokens)
  check('🔴 🔴 **생성·검수 요청에 말투 기준 값이 실제로 들어갔다**',
    sentOf('draftGen')[0]!.system.includes(std) && sentOf('semanticReview')[0]!.system.includes(std))
  check('🔴 말투 근거가 몇 토큰에서 나왔는지 남는다', ok.voice.provenance!.voiceTokenCount === 3)
  check('🔴 정본 변환은 하나다', voiceStandardOf(['a', '', ' b ']) === 'a · b')

  for (const [name, fault] of [
    ['잘림', { truncate: 'semanticReview' }], ['막힘', { blocked: 'semanticReview' }],
    ['사용량 미상', { usageUnknown: 'semanticReview' }],
  ] as const) {
    const a = await run({ ...KIM, personas: [partTime], canned: { plan: PLAN_U, draft: DRAFT }, fault })
    check(`🔴 검수 ${name} → adopt 아님`, a.review.machineOutcome === 'hold', a.review.machineReason)
  }
  const planFault = await run({ ...KIM, personas: [partTime], canned: { plan: PLAN_U, draft: DRAFT }, fault: { usageUnknown: 'speakerPlan' } })
  check('🔴 🔴 **사용량 모르는 계획으로 글을 만들지 않는다**',
    planFault.draft === null && planFault.plan.personaCode === null)
  const capped = await run({ ...KIM, personas: [partTime], canned: { plan: PLAN_U, draft: DRAFT }, cap: 2 })
  check('🔴 원천당 요청 상한을 넘기지 않는다', capped.cost.totalCalls <= 2)

  check('🔴 의미 축은 셋뿐이다', SEMANTIC_AXES.length === 3, SEMANTIC_AXES.join(','))
  check('🔴 형편·배우자 관계가 생활사 모순 축에 있다',
    (LIFE_CONTRADICTION_FACTS as readonly string[]).includes('economicStatus')
    && (LIFE_CONTRADICTION_FACTS as readonly string[]).includes('spouseRelationship'))
  check('🔴 원자적 사실만 글자를 강제한다',
    judgeProtectedFact('number', '9명').ok && judgeProtectedFact('relation', '시어머니').ok
    && !judgeProtectedFact('number', '직원은 9명정도되요').ok)
  check('🔴 카드 값 읽기가 카드와 일치한다',
    cardValueText(partTime, 'work') === '파트타임' && cardValueText(partTime, 'children') === '2'
    && cardValueText(single, 'spouse') === '비혼')
  check('🔴 hasFact 는 정규 값끼리만 견준다',
    hasFact(partTime, 'work', '파트타임') && !hasFact(homemaker, 'work', '파트타임')
    && hasFact(noKids, 'children', '없음') && !hasFact(partTime, 'children', '없음'))
  check('🔴 근거 검증은 후보가 없으면 실패한다',
    !verifySelfWarrants({ persona: undefined, selfBasis: 'lifeFacts', warrants: [], universalReason: '', spans: [] }).ok)
  check('🔴 생활사 값이 카드에서 온다',
    lifeContractLines(homemaker).some((x) => x.includes('전업')))
  const packet = buildEvidencePacket({ sourceArticleId: 'x', title: '제목', maskedBody: '본문입니다.' })
  check('🔴 원문 덩어리는 제목과 본문을 함께 담는다',
    sourceBlock(packet).includes('제목') && sourceBlock(packet).includes('본문입니다.'))
  const gen = buildV2DraftSystemPrompt({
    plan: { decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded',
      warrants: [], universalReason: 'x', protectedFacts: [], closingIntent: null,
      contentRoles: [], reason: '', rejection: null, planVersion: 'x' },
    voice: buildVoiceEvidence({ personaCode: 'P02', voiceTokens: ['짧은 문장'], samples: [], bundleDigest: 'b', sourceDigest: 's' }),
    life: homemaker,
  })
  check('🔴 생활사는 자격 장치이지 글의 재료가 아니라고 말한다', gen.includes('글의 재료가 아닙니다'))
  check('🔴 원문에 없는 사건을 만들지 말라고 말한다', gen.includes('사건 · 날짜 · 대사 · 겪은 일'))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 검사다 — 실제 모델이 쓸 만한 글을 쓰는지는 증명하지 않았다.')
console.log('🔴 검사 수는 성과가 아니다. 사람 READY 판정은 유료 실측으로만 나온다.')
if (fail > 0) process.exit(1)
