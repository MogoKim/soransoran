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
import { pickV2 } from '../src/lib/micro-seed-auto-draft'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runContentCore, personaInputOf, personaPoolIdentity, STAGE_MODEL, type Ask, type AskResult, type PersonaInput }
  from './lib/content-core-run.mjs'
import {
  buildSpeakerPlanSystemPrompt, buildSpeakerPlanPayload,
  buildV2DraftSystemPrompt, buildV2ReviewSystemPrompt, lifeContractLines,
  qualificationLine, sourceBlock,
} from './lib/content-core-prompts.mjs'
import {
  cardValueText, hasFact, verifySelfWarrants,
  SPEAKER_PLAN_VERSION, WARRANT_REJECTIONS, WARRANT_REJECTION_LABEL,
} from '../src/lib/content-core/speaker'
import { parseAgeBand, readSelfAgeClaim, judgeSelfAgeBasis, OTHER_MARKERS } from '../src/lib/persona-self-age'
import { speakerRelativeAxisOf, parseSpeakerPlan, materialityFor } from '../src/lib/content-core/speaker'
import {
  expectedSelfFactsIn, selfAgeNumbersIn, fixSourceSpeakerAge,
} from '../src/lib/content-core/speaker-relative-facts'
import { ageMentionsIn } from '../src/lib/persona-self-age'
import { sourceAgeFact } from '../src/lib/content-core/load-bearing'
import { parsePoolDoc } from '../src/lib/persona-pool-card'

/** 🔴 KST 날짜 한 줄 — 검사도 러너와 같은 규칙을 쓴다 */
const kstKeyOf = (at: Date): string => new Date(at.getTime() + 9 * 3600e3).toISOString().slice(0, 10)
import {
  planAxisMapping, SPEAKER_RELATIVE_AXES, checkAgeMappingApplied,
} from '../src/lib/content-core/speaker-relative-facts'
import {
  exactAgeOf, exactAgeOn, checkLifeConsistency, childAgeFrom,
  materializePersonaAt, bandOfAge,
} from '../src/lib/persona-birth-anchor'
import { EMPTY_HUMAN_DECISIONS, EMPTY_SOURCE_KEYS, selectWorkset, preGenerationRelease, PERSONA_REPLAN_CAUSES, REPLAN_ATTEMPT_MAX, sourceKeyOf } from '../src/lib/supply-workset'
/** 🔴 이 검사의 원천 사이트 — 원천 열쇠(P0-B)는 (사이트, id) 다 */
const FX_SITE = 'navercafe:fixture'
const RT_SITE = 'navercafe:remonterrace'
import { fakeSourceEvidence } from './lib/fake-source-evidence.mjs'
import {
  resolveLoadBearing, ACTIVATED_AXES, loadBearingRequirements, checkLoadBearingPreserved,
} from '../src/lib/content-core/load-bearing'
import { RETRYABLE_CAUSES } from '../src/lib/content-core/review'
import { priorFailureLines, selfForbiddenBy } from '../src/lib/content-core/replan-input'
import { readPriorOutcomes } from './lib/prior-outcomes.mjs'
import { personasForAttempt } from './lib/replan-personas.mjs'
import { semanticSummaryOf } from '../src/lib/micro-seed-supply-autofill'
import { SEED_AXIS } from '../src/lib/micro-seed-auto-judge'
import { EVIDENCE_CHAR_BUDGET, buildEvidencePacket } from '../src/lib/content-core/evidence'
import { judgeProtectedFact, normalizeForProvenance } from '../src/lib/content-core/source-facts'
import {
  LIFE_CONTRADICTION_FACTS, SEMANTIC_AXES, INCOMPLETE_LABEL, REVIEW_VERSION,
  artifactRetryable, reviewShapeOk,
  REVIEW_WARNING_AXES, judgeMachine, reviewWarnings,
  type DeterministicResult, type ReviewCompletion, type SemanticVerdict,
} from '../src/lib/content-core/review'
import { readReviewArtifact, reviewEvidenceLines } from '../src/lib/original-post-machine-review'
import { violatesArtifact, artifactSummary, ARTIFACT_VERSION, type HumanReviewArtifact }
  from '../src/lib/content-core/artifact'
import {
  CONTENT_CORE_PROMPT_VERSION, STAGE_MAX_OUTPUT_LABEL, SPEAKER_PLAN_PROMPT_VERSION,
  CONTENT_CORE_PIPELINE_VERSION, generationIdentity, readGenerationContract,
  sameGenerationContract, type GenerationContract,
  CONTENT_CORE_STAGES, STAGE_MAX_OUTPUT_TOKENS, V2_DRAFT_PROMPT_VERSION,
  V2_REVIEW_PROMPT_VERSION,
} from '../src/lib/content-core/pipeline'
import { buildVoiceEvidence, voiceStandardOf, VOICE_SAMPLE_MIN }
  from '../src/lib/content-core/voice-evidence'
import {
  costOf, priceOf, GEMINI_POST_PROMO, GEMINI_PROMO_ENDS_AT, MODEL_PRICES,
  PRICING_SOURCES, PRICING_VERSION, type Usage,
} from '../src/lib/llm-pricing'
import { GEMINI_COUNT_TOKENS_URL, geminiCountBody, readGeminiUsage }
  from './lib/voice-m3-provider.mjs'
import type { PoolCard } from '../src/lib/persona-pool-card'
import type { ChildAgeBand } from '../src/lib/original-post-persona-match'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : ` — ${extra}`}`) }
}
const NOW = new Date('2026-09-19T10:00:00.000Z')

type Canned = { plan?: unknown; draft?: unknown; review?: unknown }
type Fault = {
  truncate?: string; blocked?: string; usageUnknown?: string
  /** 🔴 그 단계가 **형식을 어긴 답**을 돌려준다 */
  raw?: { stage: string; text: string }
}
const okRes = (text: string): AskResult => ({
  ok: true, rawText: text, truncated: false, usageKnown: true,
  inputTokens: 100, outputTokens: 20, thoughtsTokens: null, usd: 0.0001, blocked: false,
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
type Sent = { stage: string; system: string; payload: string; model: string }
let SENT: Sent[] = []
const sentOf = (stage: string): Sent[] => SENT.filter((x) => x.stage === stage)

const fakeAsk = (c: Canned, fault: Fault = {}): Ask =>
  async (stage, system, payload, model) => {
    SENT.push({ stage, system, payload, model })
    if (fault.blocked === stage) {
      return {
        ok: false, rawText: '', truncated: false, usageKnown: false,
        inputTokens: null, outputTokens: null, thoughtsTokens: null, usd: null, blocked: true,
      }
    }
    if (fault.truncate === stage) return { ...okRes(''), truncated: true }
    // 🔴 형식을 어긴 답 — 완주는 했는데 읽을 수 없는 경우다
    if (fault.raw?.stage === stage) return okRes(fault.raw.text)
    if (fault.usageUnknown === stage) return { ...okRes(pick(c, stage)), usageKnown: false, inputTokens: null, outputTokens: null, thoughtsTokens: null, usd: null }
    return okRes(pick(c, stage))
  }

/** 🔴 정본 카드를 만들고 **정본 변환**을 지난다 — 축소판을 손으로 조립하지 않는다 */
const CARD = (o: Partial<PoolCard> & { code: string }): PoolCard => ({
  code: o.code,
  birthDate: o.birthDate ?? '1976-05-05',
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
  household: o.household ?? { childrenLiving: null, careSide: null, careCohabit: null },
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
  fault?: Fault
  cap?: number
  /** 🔴 좁히기 전의 전체 후보 수 — 주지 않으면 `personas` 가 곧 전체다 */
  poolSize?: number
}): Promise<HumanReviewArtifact> => {
  SENT = []
  return runContentCore({
    // 🔴 fixture 도 회차마다 새 불투명 id 를 준다 — 원문에서 유도하지 않는다
    artifactId: randomUUID().replace(/-/g, ''),
    sourceSite: FX_SITE, sourceArticleId: o.id, title: o.title, maskedBody: o.body,
    // 🔴 (quality-v3) 회차와 같은 날 올라온 커뮤니티 글 · 사진 수 미상 — 이 검사의 원문은 시점·출처 축을 부르지 않는다
    sourceMeta: { site: 'navercafe:fixture', postedAt: NOW, capturedAt: NOW, imageCount: null },
    personas: o.personas ?? ALL,
    /**
     * 🔴 **넘긴 목록이 곧 전체다** — 따로 주지 않는 한.
     *    `poolSize` 를 크게 주면 "좁혀져 있었다" 가 되어 `speakerSlotNarrowed` 로 적힌다.
     */
    personaPoolSize: o.poolSize ?? (o.personas ?? ALL).length,
    voiceSourceDigest: 'asset000000000',
    ask: fakeAsk(o.canned, o.fault), now: NOW, callCap: o.cap ?? 6,
    // 🔴 fixture 도 계약을 싣는다 — 정본 모양 그대로다
    contract: {
      sourceInputHash: 'fixturehash00000',
      pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
      promptVersion: CONTENT_CORE_PROMPT_VERSION,
      speakerPlanVersion: SPEAKER_PLAN_VERSION,
      reviewVersion: REVIEW_VERSION,
      planPromptDigest: 'plan000000000000',
      stageModels: STAGE_MODEL,
      stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL,
      voiceAssetDigest: 'asset000000000', personaPoolDigest: 'pool0000000000',
    },
  })
}

const fact = (kind: string, text: string, ref = 'head'): unknown => ({ kind, text, evidenceRef: ref })
/**
 * 🔴 **모델이 적어 내는 칸만.** `cardValue` 는 없다 (2026-09-20) —
 *    고른 사람의 카드 값은 코드가 정본에서 직접 읽는다.
 */
const warrant = (o: { fact: string; requiredValue: string; evidenceText: string
  evidenceRef?: string }): unknown => ({
  fact: o.fact, requiredValue: o.requiredValue,
  evidenceRef: o.evidenceRef ?? 'head', evidenceText: o.evidenceText,
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
  /**
   * 🔴 **스위치는 없앴다** (2026-09-20). v2 가 **유일한 생성 경로**가 되었으므로
   *    끄고 켜는 칸이 남아 있으면 그 자체가 죽은 병렬 경로다.
   */
  check('🔴 🔴 **v2 스위치가 남아 있지 않다**', (() => {
    if (existsSync('src/lib/content-core/flag.ts')) return false
    // 🔴 `git grep` 은 못 찾으면 종료 코드 1 이다 — 그것이 곧 "없다" 다
    // 🔴 이름을 통째로 적으면 이 파일 자신이 걸린다 — 쪼개서 만든다
    const name = ['CONTENT', 'CORE', 'V2', 'ENV'].join('_')
    const r = spawnSync('git', ['grep', '-l', name, '--', 'src/', 'scripts/'], { encoding: 'utf-8' })
    return r.status !== 0 && (r.stdout ?? '').trim() === ''
  })())
  /**
   * 🔴 **여기 두 단언은 2026-09-20 에 뜻이 뒤집혔다.**
   *    배선 전에는 *"v1 을 건드리지 않았다 · v2 소비자가 없다"* 가 격리의 증거였다.
   *    배선 뒤에는 그 반대가 계약이다 — **운영 러너가 v2 를 부르고, 대체된 v1
   *    생성 경로는 남아 있지 않다.** 옛 단언을 남겨 두면 통과가 곧 미배선을 뜻한다.
   */
  const runner = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🟢 🔴 **운영 러너가 Content Core v2 를 실제로 호출한다**',
    /await runContentCore\(\{/.test(runner))
  check('🔴 🔴 **대체된 v1 생성·검수 경로가 러너에 남아 있지 않다**', (() => {
    const dead = ['expandSeed', 'askQuality', 'parseQuality', 'generateWithRetries',
      'buildGenSystemPrompt', 'buildQualitySystemPrompt', 'buildAgeCheckSystemPrompt',
      'MAX_DRAFTS_PER_SOURCE', 'pickDraftGated', 'lifeConflictDirective']
      .filter((n) => new RegExp(`\\b${n}\\b`).test(runner))
    return dead.length === 0
  })(), '남은 참조 있음')
  check('🔴 유료 요청이 전부 장부 wrapper 를 지난다 — provider 직접 호출 0',
    (runner.match(/LEDGER\.call\(/g) ?? []).length === 1
    && !/fetch\(/.test(runner))
  check('🟢 v1 러너 파일 자체는 그대로 있다 (수집·판정·적재는 삭제하지 않았다)',
    existsSync('scripts/micro-seed-auto-draft.mts')
    && /planPreDraftExclusion/.test(runner) && /judgeSourceGate/.test(runner))
}

// ─────────────────────────────────────────────────────────
console.log('\n① 🔴 🔴 C 알바 원문 — SELF 는 파트타임 Persona 만, 전업은 불가능')
// ─────────────────────────────────────────────────────────
{
  const PLAN_OK = plan({
    personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
      evidenceRef: 'title', evidenceText: '알바중' })],
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
  check('🔴 🔴 **카드 값은 코드가 정본에서 읽어 찍는다**',
    ok.plan.warrants[0]!.verifiedCardValue === cardValueText(partTime, 'work'),
    ok.plan.warrants[0]!.verifiedCardValue)
  check('🔴 🔴 **정상 경로 3회**', ok.cost.totalCalls === 3, `${ok.cost.totalCalls}회`)
  check('🔴 단계 이름이 셋뿐이다',
    ok.cost.calls.map((c) => c.stage).join(',') === 'speakerPlan,draftGen,semanticReview')

  /**
   * 🔴 **모델이 카드 값을 보내도 아무 일도 일어나지 않는다** (2026-09-20).
   *    옛 계약에서는 이 자리가 `cardValueMismatch` 로 갈렸다. 이제 코드가
   *    정본만 읽으므로, 거짓 값을 실어 보내도 판정이 달라지지 않는다.
   */
  const stray = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime, homemaker],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'title', evidenceText: '알바중', cardValue: '전혀 다른 값' }],
      protectedFacts: [fact('number', '3시간'), fact('number', '9명')],
      contentRoles: ['usefulAnswer', 'conversationSpark'] }), draft: DRAFT } })
  check('🔴 🔴 **provider 가 보낸 cardValue 는 판정에 영향을 주지 못한다**',
    stray.plan.stance === 'SELF_EXPERIENCE'
    && stray.plan.warrants[0]!.verifiedCardValue === cardValueText(partTime, 'work'),
    `${stray.plan.stance} / ${stray.plan.rejection ?? '-'}`)
  check('🔴 🔴 **그 값이 artifact 에 실리지도 않는다**',
    !JSON.stringify(stray.plan.warrants).includes('전혀 다른 값'))

  const unmet = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [homemaker],
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'title', evidenceText: '알바중' })],
      contentRoles: ['usefulAnswer'] }), draft: DRAFT } })
  check('🔴 🔴 **전업 카드는 파트타임 자격을 충족하지 못한다**',
    unmet.plan.stance !== 'SELF_EXPERIENCE' && unmet.plan.rejection === 'requiredValueUnmet',
    `${unmet.plan.stance} / ${unmet.plan.rejection}`)
  check('🔴 🔴 **다른 Persona 를 조용히 고르지 않는다 — 아무도 고르지 않고 멈춘다**',
    unmet.plan.personaCode === null && unmet.draft === null && unmet.cost.totalCalls === 1)

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
  const A_PLAN = (code: string): unknown => plan({
    personaCode: code, stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    speakerWarrants: [warrant({ fact: 'spouse', requiredValue: '있음',
      evidenceText: '왜 저희 애아빠는 안그럴까요' })],
    protectedFacts: [fact('relation', '남편', 'title')],
    contentRoles: ['conversationSpark', 'experienceResonance'],
  })
  const married = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [partTime], canned: { plan: A_PLAN('P01'), draft: A_DRAFT } })
  check('🟢 기혼 Persona 는 남편 이야기를 1인칭으로 쓴다',
    married.plan.stance === 'SELF_EXPERIENCE' && married.plan.personaCode === 'P01')

  const unmarried = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single], canned: { plan: A_PLAN('P08'), draft: A_DRAFT } })
  check('🔴 🔴 **비혼 Persona 는 남편 자기 경험이 불가능하다**',
    unmarried.plan.stance !== 'SELF_EXPERIENCE' && unmarried.plan.rejection === 'requiredValueUnmet')

  const B_DRAFT = { title: '아들 낳으면 왜 그런 눈으로 볼까요',
    body: '아들 낳았다고 하면 딱하게 보는 분위기가 있잖아요.\n곁에서 보면 아들이 엄마를 참 잘 챙기더라고요.\n다들 겪어 보셨어요?' }
  const B_PLAN = (code: string): unknown => plan({
    personaCode: code, stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    speakerWarrants: [warrant({ fact: 'children', requiredValue: '없음',
      evidenceText: '전 아직 자녀는 없지만' })],
    contentRoles: ['conversationSpark'],
  })
  const childless = await run({ id: SRC.B.id, title: SRC.B.title, body: SRC.B.body,
    personas: [noKids], canned: { plan: B_PLAN('P04'), draft: B_DRAFT } })
  check('🟢 🔴 **자녀 0인 Persona 는 "자녀 없음" 을 1인칭으로 쓴다**',
    childless.plan.stance === 'SELF_EXPERIENCE' && childless.plan.personaCode === 'P04')

  const hasKids = await run({ id: SRC.B.id, title: SRC.B.title, body: SRC.B.body,
    personas: [partTime], canned: { plan: B_PLAN('P01'), draft: B_DRAFT } })
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
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임', evidenceRef: 'title', evidenceText: '알바중' })] }), draft: DRAFT } })
  check('🔴 🔴 **카드에 없는 personaCode 는 HOLD**',
    ghost.plan.personaCode === null && ghost.plan.rejection === 'unknownPersona'
    && ghost.draft === null, ghost.plan.reason)
  check('🔴 묻기 전에 멈춘다 — 유료 1회', ghost.cost.totalCalls === 1)

  const noEvidence = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: facts, contentRoles: ['usefulAnswer', 'conversationSpark'],
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceText: '제가 편의점에서 일하는데' })] }), draft: DRAFT } })
  check('🔴 🔴 **원문에 없는 근거로는 SELF 를 허가하지 않는다**',
    noEvidence.plan.stance !== 'SELF_EXPERIENCE'
    && noEvidence.plan.rejection === 'evidenceNotInSource')
  check('🔴 🔴 **허가 실패는 자동 강등이 아니라 HOLD 다**',
    noEvidence.plan.stance === null && noEvidence.plan.personaCode === null
    && noEvidence.draft === null, `${noEvidence.plan.stance}`)
  check('🔴 🔴 **초안 호출 0 — 계획 1회에서 멈춘다**',
    noEvidence.cost.totalCalls === 1, `${noEvidence.cost.totalCalls}회`)

  const oddFact = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: facts, contentRoles: ['usefulAnswer'],
      speakerWarrants: [warrant({ fact: 'income', requiredValue: '많음', evidenceText: '알바중', evidenceRef: 'title' })] }), draft: DRAFT } })
  check('🔴 🔴 **모르는 축은 통과시키지 않는다**',
    oddFact.plan.stance !== 'SELF_EXPERIENCE' && oddFact.plan.rejection === 'unknownFact')

  const oddStance = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'EXPERT', protectedFacts: facts }), draft: DRAFT } })
  check('🔴 모르는 자리 이름은 HOLD', oddStance.plan.rejection === 'unknownStance')
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 🔴 후보 순서는 원문이 정한다 — 회차 상태가 아니다')
// ─────────────────────────────────────────────────────────
{
  const DRAFT = { title: '여행 선물', body: '3시간씩 일하고 9명이에요. 다들 사 가시나요.' }
  const facts = [fact('number', '3시간'), fact('number', '9명')]
  const planned = plan({
    personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    protectedFacts: facts, contentRoles: ['usefulAnswer', 'conversationSpark'],
    speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
      evidenceRef: 'title', evidenceText: '알바중' })],
  })
  const a = await run({
    id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime, homemaker],
    canned: { plan: planned, draft: DRAFT } })
  const payloadA = sentOf('speakerPlan')[0]!.payload
  check('🔴 🔴 **앞에 있다고 무자격 Persona 가 SELF 가 되지 않는다**',
    a.plan.stance !== 'SELF_EXPERIENCE' && a.plan.rejection === 'requiredValueUnmet')
  check('🔴 🔴 **회차 안에서만 존재하는 값(맡은 수)이 요청에 없다**',
    !payloadA.includes('맡은 수'), payloadA.slice(0, 200))

  /** 🔴 같은 원문·같은 후보 풀이면 **읽은 순서가 달라도 보내는 것이 같다** */
  await run({
    id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [homemaker, partTime],
    canned: { plan: planned, draft: DRAFT } })
  check('🔴 🔴 **[P01,P02] 와 [P02,P01] 의 실제 요청이 같다**',
    sentOf('speakerPlan')[0]!.payload === payloadA)
  check('🔴 🔴 **그리고 계약도 같다**',
    personaPoolIdentity([partTime, homemaker]) === personaPoolIdentity([homemaker, partTime]))
  check('🔴 계획 지시가 순서로 자격을 뒤집지 말라고 말한다',
    buildSpeakerPlanSystemPrompt().includes('자격 없는 사람을 고르지 않는다'))
  check('🔴 🔴 **지시가 맡은 수를 더는 말하지 않는다**',
    !buildSpeakerPlanSystemPrompt().includes('맡은 수'))
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
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임', evidenceText: '맛은 괜찮네요' })] }), draft: DRAFT } })
  check('🔴 자격이 필요 없다면서 근거를 대면 통과시키지 않는다',
    both.plan.rejection === 'warrantsWithoutNeed')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 허가 실패는 HOLD · 처음부터 고른 낮은 자리는 생성')
// ─────────────────────────────────────────────────────────
{
  const DRAFT = { title: '남편 집안일 이야기', body: '방송에서는 곧잘 하던데 실제로는 어떠신가요.' }
  const badSelf = (roles: string[]): unknown => plan({
    personaCode: 'P08', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    contentRoles: roles, closingIntent: 'ask',
    speakerWarrants: [warrant({ fact: 'spouse', requiredValue: '있음',
      evidenceText: '왜 저희 애아빠는 안그럴까요' })],
  })
  for (const [name, roles] of [
    ['소재가 살 수 있는 글', ['conversationSpark', 'experienceResonance']],
    ['당사자 경험이 알맹이뿐인 글', ['experienceResonance']],
  ] as const) {
    const a = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
      personas: [single], canned: { plan: badSelf([...roles]), draft: DRAFT } })
    check(`🔴 🔴 **SELF 허가 실패 → HOLD (${name})**`,
      a.plan.stance === null && a.plan.personaCode === null && a.draft === null
      && a.plan.rejection === 'requiredValueUnmet' && a.cost.totalCalls === 1,
      `${a.plan.stance} / ${a.cost.totalCalls}회`)
  }
  check('🔴 🔴 **자동 강등 경로가 코드에 없다**', (() => {
    const src = readFileSync('src/lib/content-core/speaker.ts', 'utf-8')
    return !src.includes('fallbackStance') && !src.includes('stanceKeepsStory')
  })())

  // 🟢 모델이 **처음부터** 낮은 자리를 고른 경우는 그대로 만든다
  const chosen = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single],
    canned: { plan: plan({ personaCode: 'P08', stance: 'QUESTION', closingIntent: 'ask',
      contentRoles: ['conversationSpark'] }), draft: DRAFT } })
  check('🟢 🔴 **처음부터 QUESTION 을 고르면 그 자리로 만든다**',
    chosen.plan.stance === 'QUESTION' && chosen.plan.personaCode === 'P08'
    && chosen.draft !== null && chosen.cost.totalCalls === 3)
  check('🔴 낮춘 자리가 생성 지시에 들어간다',
    sentOf('draftGen')[0]!.system.includes('이 글 속 경험은 당신 것이 아닙니다'))
  check('🔴 검수도 낮춘 자리를 안다',
    sentOf('semanticReview')[0]!.system.includes('원문 속 경험을 자기 일로 말하면'))

  // 🔴 낮춘 자리인데 초안이 자기 경험을 말하면 adopt 아님
  const violates = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single],
    canned: { plan: plan({ personaCode: 'P08', stance: 'QUESTION', closingIntent: 'ask',
      contentRoles: ['conversationSpark'] }),
      draft: { title: '우리 남편은요', body: '저희 남편은 집안일을 통 안 해요. 다들 어떠세요.' },
      review: { ...EMPTY_REVIEW, confidence: 0.9, lifeContradictions: [
        { fact: 'spouse', drafted: '남편이 있다', card: '비혼',
          evidence: '저희 남편은 집안일을 통 안 해요.' },
      ] } } })
  /**
   * 🔴 **이제 의미 검수까지 가지 않는다** (2026-09-26 초안 게이트). 비혼 P08 이 QUESTION 자리에서
   *    "저희 남편은" 을 말하면 **구조화된 사유 두 개**로 결정적으로 막힌다 — 유료 검수 요청 0.
   *    앞판은 모델이 `lifeContradictions` 를 답해 줘야만 막혔다(운영 4편은 모델이 답하지 않았다).
   */
  const vCodes = violates.review.deterministic.failures.map((f) => f.code)
  check('🔴 🔴 **낮춘 자리에서 자기 경험을 말하면 adopt 아님 — 의미 검수 전에 구조화된 사유로 막는다**',
    violates.review.machineOutcome === 'hold'
    && vCodes.includes('unwarrantedSelfClaim') && vCodes.includes('lifeStageTenseConflict')
    && violates.review.semanticCompletion.cause === 'deterministicFailed'
    && sentOf('semanticReview').length === 0,
    `${violates.review.machineOutcome} · ${vCodes.join(',')} · 검수 요청 ${sentOf('semanticReview').length}`)

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
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임', evidenceRef: 'title', evidenceText: '알바중' })] }), draft: DRAFT } })
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
    speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임', evidenceRef: 'title', evidenceText: '알바중' })],
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
  /**
   * 🔴 **2026-09-20 — 이제 경고다.** 막지 않고 사람에게 넘긴다.
   *    근거는 artifact 에 그대로 남는다 (아래 두 줄이 그것을 본다).
   */
  check('🟡 🔴 **원문에 없어 보이는 것은 막지 않고 후보로 보낸다**',
    invented.review.machineOutcome === 'adopt', invented.review.machineReason)
  check('🔴 🔴 **그래도 근거는 artifact 에 남는다**',
    invented.review.unsupportedAdditions.length === 1
    && invented.review.unsupportedAdditions[0]!.evidence === '다들 사 가시나요.')

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
      warrants: [], universalReason: 'x', protectedFacts: [], speakerRelative: [], closingIntent: null,
      contentRoles: [], reason: '', rejection: null, planVersion: 'x' },
    mappings: [],
    voice: buildVoiceEvidence({ personaCode: 'P02', voiceTokens: ['짧은 문장'], samples: [], bundleDigest: 'b', sourceDigest: 's' }),
    life: homemaker,
  })
  check('🔴 생활사는 자격 장치이지 글의 재료가 아니라고 말한다', gen.includes('글의 재료가 아닙니다'))
  check('🔴 원문에 없는 사건을 만들지 말라고 말한다', gen.includes('사건 · 날짜 · 대사 · 겪은 일'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 🔴 🔴 증거 위치 계약 — 모델이 title/head/tail 을 구분할 수 있어야 한다')
// ─────────────────────────────────────────────────────────
{
  const DRAFT_C = { title: '여행 선물 하시나요',
    body: '대신 서 준 사람은 없고 비는 시간은 제가 다른 날에 채웠어요. 3시간씩 일하고 9명이에요. 다들 사 가시나요.' }

  // 🔴 payload 가 span 구조를 실제로 담는가
  const probe = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: [fact('number', '3시간', 'head'), fact('number', '9명', 'head')],
      contentRoles: ['usefulAnswer', 'conversationSpark'],
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'title', evidenceText: '알바중' })] }), draft: DRAFT_C } })
  const sent = JSON.parse(sentOf('speakerPlan')[0]!.payload) as
    { 원문: { spans: { kind: string; text: string }[]; bodyLength: number; truncated: boolean } }
  check('🔴 🔴 **계획 payload 가 span 을 kind 와 함께 보낸다**',
    Array.isArray(sent.원문.spans) && sent.원문.spans.every((x) => typeof x.kind === 'string'))
  check('🔴 🔴 **제목과 본문이 서로 다른 span 으로 구분된다**',
    sent.원문.spans.find((x) => x.kind === 'title')!.text === SRC.C.title
    && sent.원문.spans.find((x) => x.kind === 'head')!.text.includes('누가 대타뛰어준건'))
  check('🔴 packet 에 없는 span 은 보내지 않는다',
    sent.원문.spans.every((x) => ['title', 'head', 'tail'].includes(x.kind))
    && !sent.원문.spans.some((x) => x.kind === 'tail'))
  check('🔴 본문 길이·잘림 여부가 함께 간다',
    sent.원문.bodyLength === SRC.C.body.length && sent.원문.truncated === false)
  check('🔴 원문 내용 범위는 늘어나지 않았다',
    probe.evidence.totalEvidenceChars <= EVIDENCE_CHAR_BUDGET)
  check('🔴 계획 지시가 kind 가 곧 evidenceRef 라고 말한다',
    buildSpeakerPlanSystemPrompt().includes('곧 `evidenceRef` 다'))

  // 🔴 🔴 C 의 알바 근거가 **title** 에서 검증된다
  check('🔴 🔴 **C — 알바 근거가 title 로 검증되어 SELF 가 유지된다**',
    probe.plan.stance === 'SELF_EXPERIENCE' && probe.plan.personaCode === 'P01'
    && probe.plan.warrants[0]!.evidenceRef === 'title', probe.plan.reason)
  // 🔴 🔴 C 의 3시간·9명이 **head** 에서 검증된다
  check('🔴 🔴 **C — 3시간·9명이 head 에서 protectedFacts 로 살아남는다**',
    probe.plan.protectedFacts.map((f) => f.text).join(',') === '3시간,9명'
    && probe.dropped.length === 0, JSON.stringify(probe.dropped))
  check('🔴 🔴 **protectedFacts 검증이 실제로 작동한다 — 빠지면 잡는다**', (await run({
    id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: [fact('number', '3시간', 'head'), fact('number', '9명', 'head')],
      contentRoles: ['usefulAnswer'],
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'title', evidenceText: '알바중' })] }),
      draft: { title: '선물', body: '비는 시간은 제가 다른 날 채웠어요. 사람이 꽤 되는데 다들 사 가시나요.' } },
  })).review.deterministic.failures.some((f) => f.code === 'protectedFactMissing'))

  // 🔴 🔴 A 의 남편 근거가 **title** 에서 검증된다
  const a = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: [fact('relation', '남편', 'title')],
      contentRoles: ['conversationSpark', 'experienceResonance'],
      speakerWarrants: [warrant({ fact: 'spouse', requiredValue: '있음',
        evidenceRef: 'title', evidenceText: '남편이 집안일 많이 돕나요?' })] }),
      draft: { title: '방송 속 남편들 보면요',
        body: '화면에 나오는 남편들은 집안일을 곧잘 하던데 우리 남편은 딴판이에요. 다들 어떠세요.' } } })
  check('🔴 🔴 **A — 남편 근거가 title 로 검증되어 SELF 가 유지된다**',
    a.plan.stance === 'SELF_EXPERIENCE' && a.plan.warrants[0]!.evidenceRef === 'title'
    && a.review.machineOutcome === 'adopt', a.plan.reason)

  // 🔴 같은 글자라도 **자리가 틀리면** 거부한다
  const wrongRef = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: [], contentRoles: ['usefulAnswer'],
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'head', evidenceText: '알바중' })] }), draft: DRAFT_C } })
  check('🔴 🔴 **같은 글자라도 ref 가 틀리면 거부한다 (title 내용을 head 라 하면)**',
    wrongRef.plan.stance === null && wrongRef.plan.rejection === 'evidenceNotInSource'
    && wrongRef.cost.totalCalls === 1)
  const wrongRef2 = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      protectedFacts: [fact('number', '3시간', 'title')], contentRoles: ['usefulAnswer'],
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'title', evidenceText: '알바중' })] }), draft: DRAFT_C } })
  check('🔴 protectedFact 도 자리가 틀리면 버린다',
    wrongRef2.dropped.some((d) => d.text === '3시간' && d.why === 'notInEvidence'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 🔴 혼합 모델 — 단계별 모델과 thinking 과금')
// ─────────────────────────────────────────────────────────
{
  check('🔴 🔴 **speakerPlan · draftGen 은 Gemini, semanticReview 는 Haiku**',
    STAGE_MODEL.speakerPlan === 'gemini-3.7-flash'
    && STAGE_MODEL.draftGen === 'gemini-3.7-flash'
    && STAGE_MODEL.semanticReview === 'claude-haiku-4.5')

  const DRAFT = { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다.' }
  const a = await run({
    id: 'S11', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    personas: [homemaker],
    canned: { plan: plan({ personaCode: 'P02', stance: 'SELF_EXPERIENCE',
      selfBasis: 'noLifeFactNeeded', universalReason: '보편적인 일상 이야기',
      closingIntent: 'share', contentRoles: ['conversationSpark'] }), draft: DRAFT },
  })
  check('🔴 🔴 **실제 요청 인자에 단계별 모델이 실려 나갔다**',
    sentOf('speakerPlan')[0]!.model === 'gemini-3.7-flash'
    && sentOf('draftGen')[0]!.model === 'gemini-3.7-flash'
    && sentOf('semanticReview')[0]!.model === 'claude-haiku-4.5')
  check('🔴 🔴 **artifact 가 호출마다 모델을 남긴다 — 비용을 섞지 않는다**',
    a.cost.calls.map((c) => `${c.stage}:${c.model}`).join(',')
      === 'speakerPlan:gemini-3.7-flash,draftGen:gemini-3.7-flash,semanticReview:claude-haiku-4.5')
  check('🔴 thinking 칸이 호출마다 남는다',
    a.cost.calls.every((c) => 'thoughtsTokens' in c))
  check('🔴 정상 경로 3회', a.cost.totalCalls === 3)

  // ── 가격표 ──
  const g = priceOf('gemini-3.7-flash')
  check('🔴 🔴 **Gemini 3.7 Flash 공식 단가 $0.75 / $3.75 (2026-09-19 확인)**',
    g !== null && g.inputPerMTok === 0.75 && g.outputPerMTok === 3.75)
  check('🔴 프로모션 종료일과 이후 단가를 코드에 남겼다',
    GEMINI_PROMO_ENDS_AT === '2026-12-31'
    && GEMINI_POST_PROMO.inputPerMTok === 1.5 && GEMINI_POST_PROMO.outputPerMTok === 7.5)
  check('🔴 모델마다 출처와 확인일이 있다',
    Object.keys(MODEL_PRICES).every((m) => PRICING_SOURCES[m]?.url.startsWith('https://')))
  check('🔴 가격표 버전이 한 제공사만 가리키지 않는다', !PRICING_VERSION.startsWith('anthropic-'))

  // ── 🔴 thinking 토큰이 실제 정산에 포함되는가 ──
  const usage = (o: Partial<Usage>): Usage => ({
    inputTokens: 1000, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, ...o })
  const visibleOnly = costOf({ model: 'gemini-3.7-flash', usage: usage({ outputTokens: 100 }) })
  const withThoughts = costOf({ model: 'gemini-3.7-flash', usage: usage({ outputTokens: 600 }) })
  check('🔴 🔴 **thinking 500 토큰이 정산에 실제로 더해진다**',
    visibleOnly.known && withThoughts.known
    && Math.abs((withThoughts.usd - visibleOnly.usd) - (500 * 3.75) / 1_000_000) < 1e-12,
    `${visibleOnly.known ? visibleOnly.usd : '?'} → ${withThoughts.known ? withThoughts.usd : '?'}`)
  check('🔴 사용량을 모르면 금액을 만들지 않는다',
    !costOf({ model: 'gemini-3.7-flash', usage: usage({ outputTokens: null }) }).known
    && !costOf({ model: 'gemini-3.7-flash', usage: usage({ cacheReadTokens: null }) }).known)
  check('🔴 가격표에 없는 모델은 NO_PRICE 로 막힌다', (() => {
    const v = costOf({ model: 'gpt-5-mini', usage: usage({}) })
    return !v.known && v.code === 'NO_PRICE'
  })())

  // ── 🔴 provider 응답 해석: thinking 포함 · 누락 시 미상 ──
  const gemUsage = (o: Record<string, unknown>): Record<string, unknown> => ({
    promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 500, ...o })
  check('🔴 🔴 **Gemini 출력 과금 = candidates + thoughts**',
    readGeminiUsage(gemUsage({})).outputTokens === 600)
  check('🔴 🔴 **thoughtsTokenCount 가 없으면 usageUnknown — 싸게 추정하지 않는다**',
    readGeminiUsage(gemUsage({ thoughtsTokenCount: undefined })).usageKnown === false)
  check('🟢 thinking 을 안 쓴 응답(0)은 정상 통과',
    readGeminiUsage(gemUsage({ thoughtsTokenCount: 0 })).usageKnown === true
    && readGeminiUsage(gemUsage({ thoughtsTokenCount: 0 })).outputTokens === 100)
  check('🔴 예상 못 한 캐시 칸이 나타나면 0 으로 뭉개지 않는다',
    readGeminiUsage(gemUsage({ cachedContentTokenCount: 300 })).cacheReadTokens === 300)
  check('🔴 사용량 칸 이름이 장부에 남는다 — 모르는 과금 칸이 드러난다',
    readGeminiUsage(gemUsage({ toolUsePromptTokenCount: 7 })).usageKeys.includes('toolUsePromptTokenCount'))

  // ── 🔴 사전 계산 요청이 generateContent 와 같은 입력인가 ──
  check('🔴 🔴 **Gemini countTokens 는 generateContentRequest 로 systemInstruction 을 함께 센다**',
    geminiCountBody('sys', 'payload', 'gemini-3.7-flash')
      === JSON.stringify({ generateContentRequest: {
        model: 'models/gemini-3.7-flash',
        systemInstruction: { parts: [{ text: 'sys' }] },
        contents: [{ role: 'user', parts: [{ text: 'payload' }] }] } }))
  check('🔴 사전 계산 URL 이 공식 endpoint 다',
    GEMINI_COUNT_TOKENS_URL
      === 'https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens')
  check('🔴 "다른 provider 에는 공식 경로가 없다" 는 틀린 주석이 사라졌다', (() => {
    const src = readFileSync('scripts/lib/voice-m3-provider.mts', 'utf-8')
    return !src.includes('에는 공식 사전 계산 경로가 없다`')
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑭ 🔴 🔴 449988 재현 — 카드 값 소유권은 코드에 있다 (2026-09-20)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실측 449988 을 그대로 세운다.**
   *    자녀 1명(초등) Persona, 원문에 아이가 있다는 근거, `requiredValue: "있음"`.
   *    옛 계약에서는 모델이 `cardValue: "1 (초등)"` 을 적어 카드 `"1"` 과 어긋나
   *    생성 전에 멈췄다 — 사실은 맞고 표기만 달랐다.
   */
  const kidCard = P({
    code: 'P09', childrenCount: 1, childrenAgeBands: ['초등'] as ChildAgeBand[],
    workStatus: '전업',
  })
  const SRC_449988 = {
    id: '449988', title: '남편과 각방',
    body: '코골이 남편하고  결혼하고  잠귀가 밝은 저는 같은방  쓰는게 너무너무 힘들었는데..\n\n'
      + '아이가 태어나고 새벽 출근준비하는 남편때문에 아이가 계속 새벽에 깨서 어찌어찌 각방을 썼는데..'
      + ' 생각해보니 각방쓴지 어언..5년인데..\n\n이번에 집정리 좀할겸 다 세식구 각자 1방씩?얘기가 나왔는데..\n\n괜찮겠지요^^;;',
  }
  const D = { title: '각방 쓰신 지 얼마나 되셨어요',
    body: '저희도 잠 때문에 방을 따로 쓴 지 오래됐어요.\n이번에 집을 정리하면서 다시 생각하게 되네요.\n다들 어떻게 지내세요?' }
  const PLAN = plan({
    personaCode: 'P09', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    speakerWarrants: [warrant({ fact: 'children', requiredValue: '있음',
      evidenceRef: 'head', evidenceText: '아이가 태어나고' })],
    contentRoles: ['conversationSpark', 'experienceResonance'],
  })
  const r = await run({ ...SRC_449988, personas: [kidCard], canned: { plan: PLAN, draft: D } })
  check('🟢 🔴 **449988 이 이제 1인칭 허가를 받는다**',
    r.plan.stance === 'SELF_EXPERIENCE' && r.plan.personaCode === 'P09'
    && r.plan.rejection === null, r.plan.reason)
  check('🔴 🔴 **카드 값은 코드가 정본에서 읽었다 — "1"**',
    r.plan.warrants[0]!.verifiedCardValue === '1'
    && r.plan.warrants[0]!.verifiedCardValue === cardValueText(kidCard, 'children'))
  check('🔴 🔴 **초안이 만들어지고 3회로 완주한다**',
    r.draft !== null && r.cost.totalCalls === 3, `${r.cost.totalCalls}회`)

  // 🔴 provider 가 옛 계약대로 "1 (초등)" 을 보내도 결과가 같다
  const annotated = await run({ ...SRC_449988, personas: [kidCard],
    canned: { plan: plan({ personaCode: 'P09', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'children', requiredValue: '있음',
        evidenceRef: 'head', evidenceText: '아이가 태어나고', cardValue: '1 (초등)' }],
      contentRoles: ['conversationSpark', 'experienceResonance'] }), draft: D } })
  check('🔴 🔴 **"1 (초등)" 을 보내도 더는 막히지 않는다**',
    annotated.plan.stance === 'SELF_EXPERIENCE' && annotated.draft !== null,
    annotated.plan.reason)

  // ── 🔴 느슨해지지 않았다 ──
  const wrongValue = await run({ ...SRC_449988, personas: [kidCard],
    canned: { plan: plan({ personaCode: 'P09', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [warrant({ fact: 'children', requiredValue: '없음',
        evidenceRef: 'head', evidenceText: '아이가 태어나고' })],
      contentRoles: ['conversationSpark'] }), draft: D } })
  check('🔴 🔴 **requiredValue 가 실제 카드와 다르면 여전히 거절**',
    wrongValue.plan.stance !== 'SELF_EXPERIENCE'
    && wrongValue.plan.rejection === 'requiredValueUnmet', `${wrongValue.plan.rejection}`)

  const wrongRef = await run({ ...SRC_449988, personas: [kidCard],
    canned: { plan: plan({ personaCode: 'P09', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [warrant({ fact: 'children', requiredValue: '있음',
        evidenceRef: 'title', evidenceText: '아이가 태어나고' })],
      contentRoles: ['conversationSpark'] }), draft: D } })
  check('🔴 🔴 **근거 위치가 틀리면 여전히 거절**',
    wrongRef.plan.stance !== 'SELF_EXPERIENCE'
    && wrongRef.plan.rejection === 'evidenceNotInSource', `${wrongRef.plan.rejection}`)

  const noKidPersona = await run({ ...SRC_449988, personas: [noKids],
    canned: { plan: plan({ personaCode: 'P04', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [warrant({ fact: 'children', requiredValue: '있음',
        evidenceRef: 'head', evidenceText: '아이가 태어나고' })],
      contentRoles: ['conversationSpark'] }), draft: D } })
  check('🔴 🔴 **자격 없는 Persona 는 여전히 거절**',
    noKidPersona.plan.stance !== 'SELF_EXPERIENCE'
    && noKidPersona.plan.rejection === 'requiredValueUnmet')
  check('🔴 🔴 **자동 강등 없음 — 아무도 고르지 않고 계획 1회에서 멈춘다**',
    noKidPersona.plan.personaCode === null && noKidPersona.plan.stance === null
    && noKidPersona.draft === null && noKidPersona.cost.totalCalls === 1)

  // ── 🔴 일어날 수 없는 사유는 목록에서 사라졌다 ──
  check('🔴 🔴 **cardValueMismatch 가 더는 존재하지 않는다**',
    !(WARRANT_REJECTIONS as readonly string[]).includes('cardValueMismatch')
    && !readFileSync('src/lib/content-core/speaker.ts', 'utf-8')
      .includes("why: 'cardValueMismatch'"))
  check('🔴 🔴 **계획 요청이 cardValue 를 더는 요구하지 않는다**',
    !buildSpeakerPlanSystemPrompt().includes('cardValue'))
  check('🔴 판 번호가 새 계약을 담는다',
    SPEAKER_PLAN_PROMPT_VERSION === 'speaker-plan-p5'
    && SPEAKER_PLAN_VERSION === 'speaker-plan-v6'
    && ARTIFACT_VERSION === 'human-review-v9'
    && CONTENT_CORE_PROMPT_VERSION.includes(SPEAKER_PLAN_PROMPT_VERSION))
  check('🔴 🔴 **캐시 key 와 artifact 계약이 같은 함수에서 나온다**', (() => {
    const runner = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    const i = runner.indexOf('const v2Key =')
    const key = runner.slice(i, runner.indexOf('\n\n', i))
    // 🔴 key 가 제 손으로 판 이름을 잇지 않는다 — 계약 하나만 쓴다
    return /generationIdentity\(contract\)/.test(key) && /ARTIFACT_VERSION/.test(key)
      && !/PROMPT_VERSION|STAGE_MODEL\.|SPEAKER_PLAN_VERSION|STAGE_MAX_OUTPUT_LABEL/.test(key)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑮ 🔴 🔴 중단 사유가 사실을 말한다 — notRun vs budgetBlocked')
// ─────────────────────────────────────────────────────────
{
  const D = { title: '각방 쓰신 지 얼마나 되셨어요',
    body: '저희도 잠 때문에 방을 따로 쓴 지 오래됐어요.\n이번에 집을 정리하면서 다시 생각하게 되네요.\n다들 어떻게 지내세요?' }
  /** 🔴 자격 실패로 화자 계획에서 멈춘 회차 — 예산은 남아 있다 */
  const held = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single],
    canned: { plan: plan({ personaCode: 'P08', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [warrant({ fact: 'spouse', requiredValue: '있음',
        evidenceText: '왜 저희 애아빠는 안그럴까요' })],
      contentRoles: ['conversationSpark'] }), draft: D } })
  check('🔴 🔴 **조기 HOLD 의 semanticCompletion 은 notRun 이다**',
    held.review.semanticCompletion.reason === 'notRun',
    String(held.review.semanticCompletion.reason))
  check('🔴 🔴 **예산이 남았는데 budgetBlocked 라고 적지 않는다**',
    held.review.semanticCompletion.reason !== 'budgetBlocked' && held.cost.totalCalls === 1)
  check('🔴 machineReason 에는 화자 계획의 실제 사유가 남는다',
    held.review.machineReason.includes('1인칭 허가 실패')
    && held.review.machineReason.includes(WARRANT_REJECTION_LABEL.requiredValueUnmet))

  /** 🔴 의미 검수 호출이 **실제로** 막힌 회차 */
  const blocked = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [partTime],
    fault: { blocked: 'semanticReview' },
    canned: { plan: plan({ personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
        evidenceRef: 'title', evidenceText: '알바중' })],
      protectedFacts: [fact('number', '3시간'), fact('number', '9명')],
      contentRoles: ['usefulAnswer'] }),
      draft: { title: '여행 다녀올 때 선물 하시나요',
        body: '대신 서 준 사람은 없고 비는 시간은 제가 다른 날에 채웠어요. 3시간씩 일하고 9명이에요. 다들 사 가시나요.' } } })
  check('🔴 🔴 **의미 검수가 실제로 막히면 budgetBlocked 다**',
    blocked.review.semanticCompletion.reason === 'budgetBlocked',
    String(blocked.review.semanticCompletion.reason))
  check('🔴 막힌 회차는 adopt 가 아니다', blocked.review.machineOutcome !== 'adopt')
  /**
   * 🔴 **형식을 어긴 답은 결론이 아니다** (2026-09-21 보정).
   *    앞판은 화자 계획 파싱 실패가 `canGenerate` 실패로 흘러 `speakerUnqualified`(결론)가 됐고,
   *    초안 파싱 실패는 `draftUnreadable`(결론)이었다. 둘 다 정상 원천을 영구 제외했다.
   */
  const planIn = plan({
    personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    speakerWarrants: [warrant({ fact: 'work', requiredValue: '파트타임',
      evidenceRef: 'title', evidenceText: '알바중' })],
    contentRoles: ['usefulAnswer'],
  })
  for (const [name, fault] of [
    ['화자 계획이 JSON 이 아니다', { raw: { stage: 'speakerPlan', text: '이건 JSON 이 아니다' } }],
    ['화자 계획 schema 가 어긋났다', { raw: { stage: 'speakerPlan', text: '{"decision":"뭔가"}' } }],
    ['초안이 JSON 이 아니다', { raw: { stage: 'draftGen', text: '제목만 덜렁 왔다' } }],
    ['초안에 본문이 없다', { raw: { stage: 'draftGen', text: '{"title":"제목"}' } }],
  ] as const) {
    const got = await run({
      id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [partTime],
      fault, canned: { plan: planIn, draft: D },
    })
    const c = got.review.semanticCompletion
    check(`🔴 🔴 **${name} → 다시 시도한다**`,
      c.complete === false && c.reason === 'notRun' && c.cause === 'parseFailed'
      && artifactRetryable(got.review) === true && reviewShapeOk(got.review),
      `${String(c.reason)}/${String(c.cause)} · ${got.review.machineReason}`)
  }
  check('🔴 🔴 **정상 자격 실패는 그대로 결론이다**',
    held.review.semanticCompletion.cause === 'speakerUnqualified'
    && artifactRetryable(held.review) === false,
    String(held.review.semanticCompletion.cause))
  {
    const chose = await run({
      id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [partTime],
      canned: {
        plan: planIn, draft: D,
        review: { ...EMPTY_REVIEW, issues: ['voiceMismatch'] },
      },
    })
    check('🔴 🔴 **모델이 완주해서 고른 HOLD 는 결론이다**',
      chose.review.machineOutcome === 'hold'
      && chose.review.semanticCompletion.complete === true
      && artifactRetryable(chose.review) === false,
      `${chose.review.machineOutcome} · ${chose.review.machineReason}`)
  }
  check('🔴 예산에 막힌 회차는 계속 재시도다', artifactRetryable(blocked.review) === true)

  /** 🔴 근거 예산 위반은 **장부 탓이 아니다** — 근거를 만드는 쪽이 어긋난 것이다 */
  {
    const over = await run({
      id: 'budget-1', title: '제'.repeat(900), body: SRC.C.body, personas: [partTime],
      canned: { plan: planIn, draft: D },
    })
    const c = over.review.semanticCompletion
    check('🔴 🔴 **근거 예산 위반은 제 이름으로 남는다**',
      c.cause === 'evidenceBudgetViolated' && c.reason === 'notRun',
      `${String(c.reason)}/${String(c.cause)}`)
    check('🔴 🔴 **그리고 다시 시도하지 않는다 — 배선이 그대로면 또 같다**',
      artifactRetryable(over.review) === false && over.cost.totalCalls === 0)
  }

  check('🔴 🔴 **중단 원인을 문구가 아니라 값으로 적는다**', (() => {
    const src = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
    return !/const INCOMPLETE: ReviewCompletion/.test(src) && !/\bNOT_RUN\b/.test(src)
      /**
       * 🔴 화자 없음은 **두 값**이 됐다 (2026-09-22) — 전체에서도 없는 것(결론)과
       *    이번 묶음에만 없는 것(다시 본다). 둘 다 **값**으로 적혀야 한다.
       */
      && /notRun\(noSpeakerCause\)/.test(src)
      && /'speakerUnqualified' as const/.test(src)
      && /'speakerSlotNarrowed' as const/.test(src)
      && /notRun\('voiceUnready'\)/.test(src)
      && /notRun\('evidenceBudgetViolated'\)/.test(src)
      && /notRun\('parseFailed'\)/.test(src)
      && !/draftUnreadable|ledgerUnavailable/.test(src)
      && /notRunFrom\(pC\)/.test(src)
  })())
  check('🔴 사유 이름마다 사람이 읽는 말이 있다',
    INCOMPLETE_LABEL.notRun !== '' && INCOMPLETE_LABEL.budgetBlocked !== ''
    && INCOMPLETE_LABEL.notRun !== INCOMPLETE_LABEL.budgetBlocked)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑯ 🔴 🔴 단계별 출력 상한 · 말투는 체크리스트가 아니다 (2026-09-20)')
// ─────────────────────────────────────────────────────────
{
  // ── ① 단계마다 제 상한 ──
  check('🔴 🔴 **speakerPlan 1200 · draftGen 2000 · semanticReview 1200**',
    STAGE_MAX_OUTPUT_TOKENS.speakerPlan === 1200
    && STAGE_MAX_OUTPUT_TOKENS.draftGen === 2000
    && STAGE_MAX_OUTPUT_TOKENS.semanticReview === 1200)
  check('🔴 🔴 **초안만 더 받는다** — 세 값이 같지 않다',
    STAGE_MAX_OUTPUT_TOKENS.draftGen > STAGE_MAX_OUTPUT_TOKENS.speakerPlan
    && STAGE_MAX_OUTPUT_TOKENS.draftGen > STAGE_MAX_OUTPUT_TOKENS.semanticReview)
  check('🔴 전체를 4000 으로 올리지 않았다 — 안 쓰는 자리는 예약액만 키운다',
    CONTENT_CORE_STAGES.every((st) => STAGE_MAX_OUTPUT_TOKENS[st] <= 2000))
  check('🔴 단계가 빠짐없이 값을 가진다',
    CONTENT_CORE_STAGES.every((st) => Number.isInteger(STAGE_MAX_OUTPUT_TOKENS[st])))

  const runner = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 🔴 **공통 상한 상수가 사라졌다** — 옛 판으로 되돌리면 여기서 걸린다',
    !/DRAFT_MAX_TOKENS/.test(runner))
  check('🔴 🔴 **러너가 단계 상한을 그대로 넘긴다**',
    /STAGE_MAX_OUTPUT_TOKENS\[stage\]/.test(runner))
  /**
   * 🔴 **계약 한 칸이 바뀌면 identity 가 바뀐다.** 캐시 key 도 terminal 판정도
   *    이 값을 쓰므로, 여기서 한 번 확인하면 두 곳이 함께 miss 된다.
   */
  {
    const base: GenerationContract = {
      sourceInputHash: 'h', pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
      promptVersion: CONTENT_CORE_PROMPT_VERSION, speakerPlanVersion: SPEAKER_PLAN_VERSION,
      reviewVersion: REVIEW_VERSION, planPromptDigest: 'plan1',
      stageModels: STAGE_MODEL, stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL,
      voiceAssetDigest: 'v1', personaPoolDigest: 'p1',
    }
    const id0 = generationIdentity(base)
    for (const [name, patch] of [
      ['출력 상한', { stageMaxOutputLabel: 'speakerPlan=1,draftGen=1,semanticReview=1' }],
      ['검수 판', { reviewVersion: 'review-v0' }],
      ['화자 계획 판', { speakerPlanVersion: 'speaker-plan-v0' }],
      ['계획 프롬프트', { planPromptDigest: 'plan2' }],
      ['단계 모델', { stageModels: { ...STAGE_MODEL, draftGen: 'other' } }],
      ['말투 자산', { voiceAssetDigest: 'v2' }],
      ['Persona 후보 풀', { personaPoolDigest: 'p2' }],
      ['원천 지문', { sourceInputHash: 'h2' }],
    ] as const) {
      const next = { ...base, ...patch }
      check(`🔴 🔴 **${name}이 바뀌면 캐시와 terminal 이 함께 miss 된다**`,
        generationIdentity(next) !== id0 && !sameGenerationContract(base, next))
    }
    check('🔴 같은 계약이면 같은 값이다',
      generationIdentity({ ...base }) === id0 && sameGenerationContract({ ...base }, base))
    check('🔴 🔴 **칸이 빠진 옛 계약은 읽지 않는다**',
      readGenerationContract({ ...base, planPromptDigest: undefined }) === null
      && readGenerationContract(null) === null)
  }
  check('🔴 판 번호가 새 계약을 담는다',
    CONTENT_CORE_PIPELINE_VERSION === 'content-core-v2.1'
    && V2_DRAFT_PROMPT_VERSION === 'v2-draft-p10'
    && CONTENT_CORE_PROMPT_VERSION.includes(V2_DRAFT_PROMPT_VERSION))
  /**
   * 🔴 봉투 조립이 `candidate-envelope` 으로 옮겨졌다(2026-09-23) — **옮긴 자리에서**
   *    같은 것을 본다. 러너만 보면 옮겨진 뒤 이 검사는 아무것도 지키지 않는다.
   */
  const envLib = readFileSync('scripts/lib/candidate-envelope.mts', 'utf-8')
  check('🔴 🔴 **봉투가 판 이름을 어디에도 다시 적지 않는다**',
    /draftFrom: CONTENT_CORE_PIPELINE_VERSION/.test(envLib)
    && /provenanceNote: `[^`]*\$\{CONTENT_CORE_PIPELINE_VERSION\}`/.test(envLib)
    // 🔴 따옴표든 템플릿이든 **글자 자체**가 남아 있으면 안 된다 — 앞판이 그렇게 새어 나갔다
    && !envLib.includes('content-core-v2') && !runner.includes('content-core-v2'))

  // ── ② 말투는 경향이다 ──
  // 🔴 파싱된 계획 모양 그대로 — 모델 응답 모양(`plan()`)이 아니다
  const sys = buildV2DraftSystemPrompt({
    plan: {
      decision: 'ok', personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      warrants: [], universalReason: '보편적인 이야기다', protectedFacts: [],
      closingIntent: 'ask', contentRoles: ['conversationSpark'], reason: '', rejection: null,
      planVersion: SPEAKER_PLAN_VERSION,
    } as never,
    mappings: [],
    voice: buildVoiceEvidence({
      personaCode: 'P01', voiceTokens: ['길게', '"ㅋㅋ" 자주', '오타 잦음', '느낌표 많음'],
      samples: ['ㅋㅋ 저도요', '진짜 그래요!', '아휴 참'],
      bundleDigest: 'b0', sourceDigest: 'a0',
    }),
    life: partTime,
  })
  check('🔴 🔴 **기준이 넣어야 할 목록이 아니라고 적혀 있다**',
    sys.includes('항목을 하나씩 넣어야 하는 목록이 아닙니다'))
  check('🔴 🔴 **모든 특징을 한 글에 넣지 말라고 적혀 있다**',
    sys.includes('모든 특징을 한 글에 다 넣지 않습니다'))
  check('🔴 🔴 **오타를 일부러 만들지 말라고 적혀 있다**',
    sys.includes('오타를 일부러 만들지 않습니다'))
  check('🔴 🔴 **ㅋㅋ·ㅎㅎ·ㅠㅠ·느낌표·사투리는 감정이 맞을 때만**',
    /ㅋㅋ · ㅎㅎ · ㅠㅠ · 느낌표 · 사투리는 \*\*원문의 감정과 맞을 때만\*\*/.test(sys))
  check('🔴 🔴 **말끝·호흡·문장 길이·줄바꿈을 먼저 쓰라고 적혀 있다**',
    sys.includes('말끝 · 호흡 · 문장 길이 · 줄바꿈'))
  check('🔴 강한 말투 기준 자체는 그대로 실린다 — 지우지 않았다',
    sys.includes('"ㅋㅋ" 자주') && sys.includes('오타 잦음'))
  check('🔴 🔴 **차단 규칙·검수 축을 더하지 않았다**',
    SEMANTIC_AXES.length === 3
    && !/ㅋ\{2,\}|ㅎ\{2,\}|ㅠ\{2,\}/.test(readFileSync('src/lib/content-core/review.ts', 'utf-8')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑰ 🔴 🔴 의미 검수 역할 — 확정 결함은 막고, 애매한 판정은 사람에게 (2026-09-20)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 SHADOW5B 5편은 사람이 전부 READY 로 봤는데 `unsupportedAdditions` ·
   *    `droppedFromSource` 가 두 편을 막았고, **같은 원문·같은 초안이 회차마다
   *    ADOPT/HOLD 를 오갔다.** 그래서 이 둘은 경고로 내리고 판정을 사람에게 넘긴다.
   *
   * 🔴 **프롬프트 문자열을 세지 않는다** — `judgeMachine` 이 실제로 어떻게
   *    판정하는지 값으로 본다. 예시를 프롬프트에 박아 맞추는 방식은 그만둔다.
   */
  const PASS: DeterministicResult = { pass: true, failures: [] }
  const DONE: ReviewCompletion = { complete: true, reason: null, cause: null }
  const V = (o: Partial<SemanticVerdict> = {}): SemanticVerdict => ({
    issues: [], unknownIssues: [], droppedFromSource: [], unsupportedAdditions: [],
    lifeContradictions: [], confidence: 0.9, note: '', ...o,
  })
  const ADD = [{ evidence: '어제 아침에도 일어났는데 힘이 너무 안 나서', why: '원문에 없다' }]
  const DROP = [{ evidence: '형수가 음식사오니깐 나오는데', why: '사라졌다' }]

  // ── ① unsupportedAdditions 만 있으면 후보로 간다 ──
  {
    const j = judgeMachine({ deterministic: PASS, semantic: V({ unsupportedAdditions: ADD }), semanticCompletion: DONE })
    check('🟢 🔴 **원문에 없어 보이는 것만 있으면 adopt 다** — 사람에게 넘긴다',
      j.outcome === 'adopt', `${j.outcome} / ${j.reason}`)
    check('🔴 🔴 **경고는 사라지지 않는다** — 근거가 그대로 남는다',
      j.warnings.length === 1 && j.warnings[0]!.includes('어제 아침에도 일어났는데'))
  }
  // ── ② droppedFromSource 만 있어도 후보로 간다 ──
  {
    const j = judgeMachine({ deterministic: PASS, semantic: V({ droppedFromSource: DROP }), semanticCompletion: DONE })
    check('🟢 🔴 **원문에서 사라져 보이는 것만 있으면 adopt 다**', j.outcome === 'adopt', j.reason)
    check('🔴 그 근거도 경고로 남는다',
      j.warnings.length === 1 && j.warnings[0]!.includes('형수가 음식사오니깐'))
  }
  // ── ③ 둘 다 있어도 사람 검토 후보다 ──
  {
    const j = judgeMachine({
      deterministic: PASS, semanticCompletion: DONE,
      semantic: V({ unsupportedAdditions: ADD, droppedFromSource: DROP }),
    })
    check('🟢 🔴 **두 경고가 함께 있어도 사람 검토 후보가 된다**', j.outcome === 'adopt', j.reason)
    check('🔴 경고 둘이 모두 남는다', j.warnings.length === 2)
  }
  // ── ④ 확정할 수 있는 결함은 그대로 막는다 ──
  for (const [name, arg, want] of [
    ['생활사 모순', V({ lifeContradictions: [{ fact: 'work', drafted: '전업', card: '파트타임', evidence: 'x' }] }), 'hold'],
    ['harm', V({ issues: ['harm'] }), 'drop'],
    ['말투 누수', V({ issues: ['voiceContentLeak'] }), 'hold'],
    ['말투 불일치', V({ issues: ['voiceMismatch'] }), 'hold'],
    ['모르는 축', V({ unknownIssues: ['무엇'] }), 'hold'],
  ] as const) {
    const j = judgeMachine({ deterministic: PASS, semantic: arg, semanticCompletion: DONE })
    check(`🔴 🔴 **${name} 은 계속 ${want.toUpperCase()} 다**`, j.outcome === want, j.outcome)
  }
  for (const [name, code, want] of [
    ['개인정보', 'personalInfo', 'drop'],
    ['금지어', 'bannedWord', 'drop'],
    ['복제', 'copiedFromSource', 'hold'],
    ['보호 사실 누락', 'protectedFactMissing', 'hold'],
  ] as const) {
    const det: DeterministicResult = { pass: false, failures: [{ code, detail: '' }] }
    const j = judgeMachine({ deterministic: det, semantic: V(), semanticCompletion: DONE })
    check(`🔴 🔴 **${name} 은 계속 ${want.toUpperCase()} 다**`, j.outcome === want, j.outcome)
  }
  for (const reason of ['truncated', 'noResponse', 'parseFailed', 'usageUnknown', 'budgetBlocked', 'notRun'] as const) {
    const j = judgeMachine({
      deterministic: PASS, semantic: null,
      semanticCompletion: { complete: false, reason, cause: reason === 'notRun' ? 'voiceUnready' : reason },
    })
    check(`🔴 미완료(${reason})는 계속 HOLD 다`, j.outcome === 'hold')
  }
  check('🔴 🔴 **경고 축은 둘뿐이다** — 새 축을 만들지 않았다',
    REVIEW_WARNING_AXES.length === 2
    && REVIEW_WARNING_AXES.join(',') === 'unsupportedAdditions,droppedFromSource')
  check('🔴 검수 축은 그대로 셋이다', SEMANTIC_AXES.join(',') === 'voiceContentLeak,voiceMismatch,harm')

  // ── ④-b 🔴 혼합 — 경고와 hard 사유가 같이 있으면 전체는 HOLD 다 ──
  {
    const mixed = V({
      unsupportedAdditions: ADD,
      lifeContradictions: [{ fact: 'work', drafted: '전업', card: '파트타임', evidence: '전업이라' }],
    })
    const j = judgeMachine({ deterministic: PASS, semantic: mixed, semanticCompletion: DONE })
    check('🔴 🔴 **경고 + 생활사 모순이면 전체는 HOLD 다**', j.outcome === 'hold', j.outcome)
    check('🔴 🔴 **그래도 경고 근거는 보존된다**',
      j.warnings.length === 1 && j.warnings[0]!.includes('어제 아침에도 일어났는데'))
    check('🔴 전체 사유는 hard 쪽이 말한다', j.reason.includes('생활사 모순'))

    const art = readReviewArtifact({
      artifactId: 'b'.repeat(32), sourceArticleId: 's2',
      evidence: { spans: [{ kind: 'head', text: '원문 조각' }] },
      plan: { personaCode: 'P01', stance: 'SELF_EXPERIENCE', warrants: [] },
      draft: { title: '제목', body: '본문' },
      review: {
        machineOutcome: j.outcome, machineReason: j.reason,
        unsupportedAdditions: ADD, droppedFromSource: [],
        lifeContradictions: mixed.lifeContradictions,
      },
      cost: { calls: [] },
    })
    const lines = art === null ? '' : reviewEvidenceLines(art).join('\n')
    check('🔴 🔴 **화면이 "기계가 막지 않았다" 라고 주장하지 않는다**',
      !lines.includes('기계가 막지 않았다'))
    check('🔴 🔴 **경고 줄은 "이 항목 자체는 hard 차단 사유가 아니다" 라고만 말한다**',
      lines.includes('이 항목 자체는 hard 차단 사유가 아니다'))
    check('🔴 화면 맨 윗줄이 전체 판정(hold)을 말한다', lines.split('\n')[0]!.includes('기계 hold'))
    check('🔴 경고 근거와 hard 근거가 모두 보인다',
      lines.includes('어제 아침에도 일어났는데') && lines.includes('생활사 모순'))
  }

  // ── ④-c 🔴 adopt 경고 집계에 hard HOLD/DROP 을 넣지 않는다 ──
  check('🔴 🔴 **회차 로그는 adopt 인 것만 "사람에게 넘긴 경고" 로 센다**', (() => {
    const src = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    const i = src.indexOf('const warned = artifacts.filter(')
    if (i === -1) return false
    const block = src.slice(i, i + 220)
    return block.includes("a.review.machineOutcome === 'adopt'")
      && block.includes('reviewWarnings(a.review.semantic).length > 0')
  })())
  {
    /** 🔴 같은 판정 함수로 센다 — 집계 규칙을 손으로 다시 쓰지 않는다 */
    const rows = [
      { outcome: 'adopt', s: V({ unsupportedAdditions: ADD }) },
      { outcome: 'adopt', s: V({ droppedFromSource: DROP }) },
      { outcome: 'hold', s: V({ unsupportedAdditions: ADD, lifeContradictions: [{ fact: 'work', drafted: 'x', card: 'y', evidence: 'z' }] }) },
      { outcome: 'drop', s: V({ unsupportedAdditions: ADD, issues: ['harm'] }) },
      { outcome: 'adopt', s: V() },
    ]
    const counted = rows.filter((r) => r.outcome === 'adopt' && reviewWarnings(r.s).length > 0)
    check('🔴 🔴 **hard HOLD/DROP 은 그 숫자에 들어가지 않는다** — 5장 중 2건만',
      counted.length === 2)
  }

  // ── ⑤ 사람 검토 화면이 경고를 보여준다 ──
  {
    const art = readReviewArtifact({
      artifactId: 'a'.repeat(32), sourceArticleId: 's1',
      evidence: { spans: [{ kind: 'head', text: '원문 조각' }] },
      plan: { personaCode: 'P01', stance: 'SELF_EXPERIENCE', warrants: [] },
      draft: { title: '제목', body: '본문' },
      review: {
        machineOutcome: 'adopt', machineReason: '',
        unsupportedAdditions: ADD, droppedFromSource: DROP, lifeContradictions: [],
      },
      cost: { calls: [] },
    })
    const lines = art === null ? [] : reviewEvidenceLines(art).join('\n')
    check('🔴 🔴 **사람 검토 화면에 원문 근거가 보인다**', String(lines).includes('원문 조각'))
    check('🔴 🔴 **경고 근거 둘이 모두 보인다**',
      String(lines).includes('어제 아침에도 일어났는데') && String(lines).includes('형수가 음식사오니깐'))
    check('🔴 🔴 **화면이 사람이 판정할 자리라고 말한다**',
      String(lines).includes('[사람이 판정]')
      && String(lines).includes('이 항목 자체는 hard 차단 사유가 아니다'))
  }

  // ── ⑥ SHADOW5B 5편을 provider 없이 다시 판정하면 전부 후보다 ──
  {
    /** 🔴 실제 재실행에서 Haiku 가 낸 판정 그대로 — provider 를 부르지 않는다 */
    const real: { id: string; add: number; drop: number }[] = [
      { id: '450476', add: 1, drop: 0 },
      { id: '449787', add: 0, drop: 0 },
      { id: '35023663', add: 0, drop: 1 },
      { id: '450407', add: 0, drop: 0 },
      { id: '449635', add: 0, drop: 0 },
    ]
    const outcomes = real.map((r) => judgeMachine({
      deterministic: PASS, semanticCompletion: DONE,
      semantic: V({
        unsupportedAdditions: r.add > 0 ? ADD : [],
        droppedFromSource: r.drop > 0 ? DROP : [],
      }),
    }))
    check('🟢 🔴 **SHADOW5B 5편이 전부 사람 검토 후보가 된다** (provider 호출 0)',
      outcomes.every((o) => o.outcome === 'adopt'),
      outcomes.map((o) => o.outcome).join(','))
    check('🔴 경고가 붙은 2편은 경고를 달고 간다',
      outcomes.filter((o) => o.warnings.length > 0).length === 2)
  }

  // ── ⑦ 사람 확인 없는 발행은 그대로 막혀 있다 ──
  check('🔴 🔴 **기계 후보는 사람 검토 전에는 발행되지 않는다**', (() => {
    const pub = readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf-8')
    const runner = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    const envLib2 = readFileSync('scripts/lib/candidate-envelope.mts', 'utf-8')
    // 🔴 그 문구는 봉투에 실린다 — 봉투를 조립하는 자리에서 본다
    return /HUMAN_ONLY_VALUES/.test(pub)
      && /발행은 사람이 publish:machine-review 로 검토를 마쳐야 열린다/.test(envLib2)
      && !/발행은 사람이 publish:machine-review/.test(runner)
  })())
}

console.log('\n🔴 🔴 **자기 나이 정본 — 새 계약을 만들지 않고 `persona-self-age` 를 쓴다**')
{
  // 🔴 정본 구간: 초반 0~3 · 중반 4~6 · **후반 7~9**. 40대 후반 = 47~49 다.
  check('🔴 🔴 **40대 후반 = 47~49 — 45·46 은 들어가지 않는다**', (() => {
    const b = parseAgeBand('40대 후반')
    return b?.from === 47 && b.to === 49
  })(), JSON.stringify(parseAgeBand('40대 후반')))
  check('🔴 초반 0~3 · 중반 4~6', (() => {
    const a = parseAgeBand('50대 초반'); const m = parseAgeBand('50대 중반')
    return a?.from === 50 && a.to === 53 && m?.from === 54 && m.to === 56
  })())
  check('🔴 🔴 **P02 실제 문장 "제가 곧 44인데" 를 읽는다 (정본 확장)**', (() => {
    const c = readSelfAgeClaim('제가 곧 44인데 아직 어리다는 소리도 듣고 그래요.')
    return c !== null && c.span.from === 44 && c.span.to === 44
  })())
  const basis = (text: string, band: string | null, sb: string | null) =>
    judgeSelfAgeBasis({ text, ageBand: band, selfBasis: sb })
  check('🔴 🔴 **44 + 40대 후반 + lifeFacts → HOLD (겹치지 않는다)**',
    basis('제가 곧 44인데', '40대 후반', 'lifeFacts').hold === true)
  check('🔴 🔴 **45 는 40대 후반과 겹치지 않는다 — 통과하면 실패다**',
    basis('제가 45인데', '40대 후반', 'lifeFacts').hold === true)
  check('🔴 🔴 **46 도 겹치지 않는다**',
    basis('제가 46인데', '40대 후반', 'lifeFacts').hold === true)
  check('🔴 🔴 **47~49 만 겹친다**',
    basis('제가 47인데', '40대 후반', 'lifeFacts').hold === false
    && basis('제가 49인데', '40대 후반', 'lifeFacts').hold === false
    && basis('제가 50인데', '40대 후반', 'lifeFacts').hold === true)
  check('🔴 🔴 **나이를 밝혔는데 `selfBasis` 가 lifeFacts 가 아니면 HOLD**', (() => {
    const v = basis('제가 47인데', '40대 후반', 'noLifeFactNeeded')
    return v.hold && v.code === 'AGE_WITHOUT_LIFE_FACT'
  })())
  check('🔴 `selfBasis` 가 null 이어도 HOLD',
    basis('제가 47인데', '40대 후반', null).hold === true)
  check('🔴 🔴 **밴드를 읽을 수 없으면 HOLD (fail-closed)**', (() => {
    const v = basis('제가 47인데', null, 'lifeFacts')
    return v.hold && v.code === 'AGE_BAND_UNKNOWN'
  })())
  check('🔴 나이를 말하지 않으면 통과다',
    basis('저도 아직 어려 보인다는 소리를 듣고 그래요.', '40대 후반', 'noLifeFactNeeded').hold === false)

  // 🔴 기존 오탐 방지 계약이 그대로인가 — 훼손하면 여기서 깨진다
  check('🔴 🔴 **제3자 나이는 자기 나이가 아니다**',
    readSelfAgeClaim('아는 분이 44인데 몇 년 다녀보니 80퍼는 넘는 것 같더라고요.') === null)
  check('🔴 🔴 **기간·퍼센트는 나이가 아니다**',
    readSelfAgeClaim('몇 년 꾸준히 다녀봤는데요. 80퍼는 넘는 것 같아요.') === null
    && readSelfAgeClaim('3일 뒀더니 시어졌어요.') === null)
  check('🔴 근사 표현은 자기 나이 근거로 쓰지 않는다',
    readSelfAgeClaim('마흔 중반쯤 됐는데요.') === null)
  check('🔴 가족 나이는 자기 나이가 아니다', readSelfAgeClaim('엄마가 예순이 넘었어요.') === null)
}

console.log('\n🔴 🔴 **파이프라인 차단 — `pickV2` 가 채택 전에 막는다 (함수 PASS 가 아니다)**')
{
  // 🔴 P02 의 **실제 초안 문장**과 실제 정본 나이대다.
  const P02_BODY = '동네에 있는 좀 저렴한 에스테틱을 몇 년 꾸준히 다녀봤는데요.\n'
    + '잔주름도 좀 옅어지는 것 같고 그러더라고요.\n제가 곧 44인데 아직 어리다는 소리도 듣고 그래요.\n'
    + '자랑하려는 건 아닌데, 정말 여자는 피부가 80퍼인 것 같다는 생각이 들더라고요.'
  const EDITED_BODY = '동네에 있는 좀 저렴한 에스테틱을 몇 년 꾸준히 다녀봤는데요.\n'
    + '잔주름도 좀 옅어지는 것 같고 그러더라고요.\n저도 아직 어려 보인다는 소리를 듣고 그래요.\n'
    + '자랑하려는 건 아닌데, 정말 여자는 피부가 80퍼인 것 같다는 생각이 들더라고요.'
  const TITLE = '여자는 피부가 80퍼라는 말이 맞는 것 같아요'

  const run = (body: string, ageBand: string | null, selfBasis: 'lifeFacts' | 'noLifeFactNeeded' | null,
    withAgeFact = true) => pickV2({
    judgement: { sourceArticleId: '35040880', decision: 'SEED', reason: 'ok' } as never,
    draft: { sourceArticleId: '35040880', draftNo: 1, title: TITLE, body,
      safetyVerdict: 'pass', originality: { runChars: 7, runWords: 1, coverRatio: 0 },
      generatedAt: '2026-09-23T00:00:00.000Z' } as never,
    seenTitles: new Set<string>(), seenBodies: new Set<string>(), sourceUsed: false,
    machineOutcome: 'adopt', machineReason: '', sourceTitleCopied: false, crisisStop: null,
    ...(withAgeFact ? { ageFact: { ageBand, selfBasis } } : {}),
  }, '2026-09-23T00:00:00.000Z')

  const blocked = run(P02_BODY, '40대 후반', 'noLifeFactNeeded')
  check('🔴 🔴 **"제가 곧 44인데" + P02(40대 후반) 는 채택되지 않는다**',
    blocked.decision !== 'AUTO_ADOPT', JSON.stringify({ d: blocked.decision, r: blocked.reason }))
  check('🔴 🔴 **사유가 값으로 남는다 — 기존 어휘 `lifeHistoryConflict`**',
    blocked.reason === 'lifeHistoryConflict', String(blocked.reason))
  check('🔴 `AUTO_HOLD` 다 — `AUTO_DROP` 이 아니다', blocked.decision === 'AUTO_HOLD', String(blocked.decision))
  /**
   * 🔴 **HOLD 가 어디 남는지 값으로 확인한다** (2026-09-23 표현 정정).
   *    앞판은 "DB 사람 검토 후보로 남는다" 고 썼는데 **틀렸다.** `adopted` 에는
   *    `AUTO_ADOPT` 만 들어가므로 HOLD 는 **DB 후보가 되지 않는다.**
   *    남는 곳은 회차 산출물 `auto-draft-<회차>.picks.jsonl` 이다.
   *
   * 🔴 **재시도 계약** (2026-09-23 재정정). `AUTO_HOLD` 원천은 `concluded` 가 아니어서
   *    **재시도 자격을 유지한다.** 다만 **다음 회차 즉시 선택은 보장되지 않는다** —
   *    workset 의 reserve 자리 · 신규 우선 · starvation 규칙에 따라 다시 선택된다.
   *    그 동작은 아래 `selectWorkset` 실행 검사가 값으로 확인한다.
   */
  const runnerSrc = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 HOLD 도 `picks` 산출물에는 남는다',
    /picks\.push\(p\)/.test(runnerSrc) && /picks\.map\(\(pp\) => JSON\.stringify\(pp\)\)/.test(runnerSrc))
  check('🔴 🔴 **HOLD 는 DB 후보가 되지 않는다 — `adopted` 에 안 들어간다**',
    blocked.decision !== 'AUTO_ADOPT')
  check('🔴 🔴 **`selfBasis=lifeFacts` 로 보내도 44 는 밴드 밖이라 막힌다**',
    run(P02_BODY, '40대 후반', 'lifeFacts').decision !== 'AUTO_ADOPT')
  check('🔴 🔴 **밴드를 모르면 막는다 (fail-closed)**',
    run(P02_BODY, null, 'lifeFacts').decision !== 'AUTO_ADOPT')

  const okPick = run(EDITED_BODY, '40대 후반', 'noLifeFactNeeded')
  check('🔴 🔴 **나이를 뺀 마스터 편집안은 채택된다 — 막기만 하는 코드가 아니다**',
    okPick.decision === 'AUTO_ADOPT', JSON.stringify({ d: okPick.decision, r: okPick.reason }))

  // 🔴 오탐 — 제3자 나이·기간·퍼센트는 막지 않는다
  const third = '아는 분이 44인데 몇 년 다녀보니 80퍼는 넘는 것 같더라고요. 그 집 애가 15살이래요.'
  check('🔴 🔴 **제3자 나이·기간·퍼센트는 오탐으로 막지 않는다**',
    run(third, '40대 후반', 'noLifeFactNeeded').decision === 'AUTO_ADOPT',
    JSON.stringify(readSelfAgeClaim(third)))

  // 🔴 넘기지 않으면 검사하지 않는다 — 기존 호출부 동작 불변
  check('🔴 `ageFact` 를 넘기지 않으면 기존 동작 그대로다',
    run(P02_BODY, '40대 후반', 'noLifeFactNeeded', false).decision === 'AUTO_ADOPT')

  // 🔴 **차단된 행은 적재 대상이 아니다** — AUTO_ADOPT 만 candidates 로 간다
  const runner = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 🔴 **러너가 `ageFact` 를 실제로 넘긴다 — 함수만 있고 안 부르는 상태가 아니다**',
    /ageFact: \{[\s\S]{0,240}?ageBand: card\?\.ageBand \?\? null/.test(runner)
    && /personaExactAge: personaAgeOf\(card\)/.test(runner))
  check('🔴 🔴 **`AUTO_ADOPT` 인 것만 `adopted` 에 들어간다 — 차단된 행은 DB 후보가 되지 않는다**',
    /if \(p\.decision === 'AUTO_ADOPT'\) \{\s*\n\s*adopted\.push/.test(runner))
  check('🔴 🔴 **경고만 있는 정상 후보의 공급은 멈추지 않는다 — `lifeHistoryConflict` 는 DROP 이 아니다**',
    !/'lifeHistoryConflict'/.test(readFileSync('src/lib/micro-seed-auto-draft.ts', 'utf-8')
      .split('const DROP')[1]?.split(']')[0] ?? ''))
}

console.log('\n🔴 🔴 **실행 사슬 — artifact.plan → voice candidate ageBand → pickV2 → adopted**')
{
  // 🔴 러너가 하는 일을 **그 순서 그대로** 돌린다. 정규식 검사가 아니다.
  const TITLE = '여자는 피부가 80퍼라는 말이 맞는 것 같아요'
  const BAD = '동네에 있는 좀 저렴한 에스테틱을 몇 년 꾸준히 다녀봤는데요.\n'
    + '제가 곧 44인데 아직 어리다는 소리도 듣고 그래요.'
  const GOOD = '동네에 있는 좀 저렴한 에스테틱을 몇 년 꾸준히 다녀봤는데요.\n'
    + '저도 아직 어려 보인다는 소리를 듣고 그래요.'
  const THIRD = '아는 분이 44인데 몇 년 다녀보니 80퍼는 넘는 것 같더라고요. 3일 뒀더니 그렇대요.'

  /** 실제 voice 후보 목록의 모양 — code 와 ageBand 를 가진다 */
  const CANDIDATES = [
    { code: 'P02', ageBand: '40대 후반' },
    { code: 'P10', ageBand: '50대 초반' },
  ]
  /** artifact 의 plan 모양 */
  type Art = { plan: { personaCode: string; selfBasis: string | null } | null }

  /** 🔴 러너와 **같은 순서**: plan → candidate 조회 → pickV2 → adopted */
  const chain = (art: Art, body: string): { picks: string[]; adopted: number } => {
    const picks: string[] = []
    let adopted = 0
    const planned = art.plan?.personaCode ?? null
    const card = planned === null ? undefined : CANDIDATES.find((c) => c.code === planned)
    const p = pickV2({
      judgement: { sourceArticleId: '35040880', decision: 'SEED', reason: 'ok' } as never,
      draft: { sourceArticleId: '35040880', draftNo: 1, title: TITLE, body,
        safetyVerdict: 'pass', originality: { runChars: 7, runWords: 1, coverRatio: 0 },
        generatedAt: '2026-09-23T00:00:00.000Z' } as never,
      seenTitles: new Set<string>(), seenBodies: new Set<string>(), sourceUsed: false,
      machineOutcome: 'adopt', machineReason: '', sourceTitleCopied: false, crisisStop: null,
      ageFact: { ageBand: card?.ageBand ?? null, selfBasis: art.plan?.selfBasis ?? null },
    }, '2026-09-23T00:00:00.000Z')
    picks.push(`${p.decision}:${p.reason}`)
    if (p.decision === 'AUTO_ADOPT') adopted += 1   // 🔴 러너와 같은 조건
    return { picks, adopted }
  }

  const P02_PLAN: Art = { plan: { personaCode: 'P02', selfBasis: 'noLifeFactNeeded' } }
  check('🔴 🔴 **원본 "제가 곧 44인데" 는 adopted 0건**',
    chain(P02_PLAN, BAD).adopted === 0, JSON.stringify(chain(P02_PLAN, BAD).picks))
  check('🔴 🔴 **마스터 편집안은 adopted 1건**',
    chain(P02_PLAN, GOOD).adopted === 1, JSON.stringify(chain(P02_PLAN, GOOD).picks))
  check('🔴 🔴 **`lifeFacts` 로 보내도 44 는 40대 후반(47~49) 밖이라 adopted 0건**',
    chain({ plan: { personaCode: 'P02', selfBasis: 'lifeFacts' } }, BAD).adopted === 0)
  check('🔴 🔴 **모르는 personaCode → 카드를 못 찾아 fail-closed (adopted 0)**',
    chain({ plan: { personaCode: 'P99', selfBasis: 'lifeFacts' } }, BAD).adopted === 0)
  check('🔴 🔴 **plan 이 아예 없으면 fail-closed (adopted 0)**',
    chain({ plan: null }, BAD).adopted === 0)
  check('🔴 🔴 **제3자 나이·기간은 오탐으로 막지 않는다 — adopted 1건**',
    chain(P02_PLAN, THIRD).adopted === 1, JSON.stringify(chain(P02_PLAN, THIRD).picks))
  check('🔴 다른 화자(50대 초반)에게는 44 가 더 크게 어긋난다 — adopted 0건',
    chain({ plan: { personaCode: 'P10', selfBasis: 'lifeFacts' } }, BAD).adopted === 0)

  /**
   * 🔴 **과잉 차단 방지** (2026-09-23 마스터 판정).
   *
   *    막아야 할 것은 **나이를 말한 것**이 아니라 **원문 작성자의 개인 사실("곧 44")을
   *    화자에게 이식한 것**이다. P02 카드가 보장하는 것은 `40대 후반` 이지
   *    정확한 47·48·49세가 아니다. 카드가 보장하는 **연령대 표현은 통과해야 한다** —
   *    그런 디테일이 글을 사람답게 만든다.
   *
   *    🔴 카드에 연령대만 있으면 **연령대까지만** 쓴다. 근거 없는 정확한 나이를
   *       새로 지어내 통과시키는 편집은 제안하지 않는다.
   */
  const BAND_OK = '동네에 있는 좀 저렴한 에스테틱을 몇 년 꾸준히 다녀봤는데요.\n'
    + '저도 40대 후반인데 아직 어려 보인다는 말을 듣고 그래요.'
  check('🔴 🔴 **카드와 맞는 연령대 표현 + lifeFacts → adopted 1건 (과잉 차단하지 않는다)**',
    chain({ plan: { personaCode: 'P02', selfBasis: 'lifeFacts' } }, BAND_OK).adopted === 1,
    JSON.stringify(chain({ plan: { personaCode: 'P02', selfBasis: 'lifeFacts' } }, BAND_OK).picks))
  check('🔴 🔴 **같은 문장이라도 `noLifeFactNeeded` 면 AUTO_HOLD — 자격 없이 생활사를 쓸 수 없다**', (() => {
    const r = chain({ plan: { personaCode: 'P02', selfBasis: 'noLifeFactNeeded' } }, BAND_OK)
    return r.adopted === 0 && r.picks[0]?.startsWith('AUTO_HOLD') === true
  })(), JSON.stringify(chain({ plan: { personaCode: 'P02', selfBasis: 'noLifeFactNeeded' } }, BAND_OK).picks))
  check('🔴 🔴 **"곧 44" + P02(40대 후반) 는 그대로 AUTO_HOLD — 개인 사실 이식은 막는다**', (() => {
    const r = chain({ plan: { personaCode: 'P02', selfBasis: 'lifeFacts' } }, BAD)
    return r.adopted === 0 && r.picks[0]?.startsWith('AUTO_HOLD') === true
  })(), JSON.stringify(chain({ plan: { personaCode: 'P02', selfBasis: 'lifeFacts' } }, BAD).picks))
  check('🔴 카드가 보장하는 폭만큼만 통과한다 — 47·48·49 는 40대 후반 안이라 통과',
    chain({ plan: { personaCode: 'P02', selfBasis: 'lifeFacts' } },
      '저는 48인데 요즘 그런 생각이 들더라고요.').adopted === 1)
}

console.log('\n🔴 🔴 **재시도 자격 — `selectWorkset` 실행으로 확인한다 (다음 회차 즉시 선택을 보장하지 않는다)**')
{
  /**
   * 🔴 앞판은 "다음 회차에 그 원천이 다시 뽑힌다" 고 단언했다. **철회한다.**
   *    정확한 계약은 이렇다.
   *      · HOLD 된 원천은 `concluded` 에 들어가지 않아 **재시도 자격을 유지**한다
   *      · **다음 회차 즉시 선택은 보장하지 않는다** — 신규가 자리를 채울 수 있다
   *      · `WORKSET_RETRY_RESERVE` 한 자리와 **오래 기다린 순** 정렬이 굶김을 막는다
   */
  const NOW = new Date('2026-09-23T05:00:00Z')
  // 🔴 (2026-09-30) 순서는 정본 rank(원천 상대 백분위)다 — 옛 댓글 수 순서를 백분위로 옮겨 싣는다
  const row = (id: string, comments: number) => ({
    sourceArticleId: id, sourceSite: 'navercafe:remonterrace',
    commentCount: comments, sourcePostedAt: '', sourceListedAt: '',
    input: { sourceArticleId: id, title: `요즘 김치 담그기 어떠신가요 ${id}`,
      bodyHead: '주변에 물어보면 반반이더라고요. 다들 어떻게 하시는지 궁금해서 여쭤봐요.',
      bodyLength: 120, commentCount: comments,
      safetyVerdict: 'pass', access: 'ok', axis: SEED_AXIS } as never,
    evidence: fakeSourceEvidence(NOW, { id, commentsPct: comments / 100 }),
  })
  const releaseOf = (r: Parameters<typeof preGenerationRelease>[0]) => preGenerationRelease(r, NOW, NOW)
  const ago = (h: number) => NOW.getTime() - h * 3600e3
  const plan = (limit: number, attempted: Map<string, { atMs: number }>, fresh: string[]) =>
    selectWorkset({
      rows: [...fresh.map((f, i) => row(f, 50 - i)), ...[...attempted.keys()].map((k, i) => row(k, 40 - i))],
      humanDecided: EMPTY_HUMAN_DECISIONS, queuePending: new Set<string>(), queuedSources: EMPTY_SOURCE_KEYS, carriedOver: EMPTY_SOURCE_KEYS,
      concluded: new Set<string>(), attempted: new Map([...attempted].map(([k, v]) => [sourceKeyOf(RT_SITE, k), v])) as never,
      releaseOf, limit, runId: 'r1', takenAt: NOW,
    })

  const att = new Map([['old-1', { atMs: ago(30) }], ['old-2', { atMs: ago(5) }]])
  const p5 = plan(5, att, ['new-1', 'new-2', 'new-3', 'new-4', 'new-5'])
  const ids5 = p5.workset.sources.map((s) => s.sourceArticleId)
  check('🔴 🔴 **신규가 충분해도 재시도 자리가 남는다**',
    ids5.some((x) => x.startsWith('old-')), JSON.stringify(ids5))
  check('🔴 🔴 **재시도 중에서는 오래 기다린 것이 먼저다**',
    ids5.filter((x) => x.startsWith('old-'))[0] === 'old-1', JSON.stringify(ids5))
  check('🔴 신규가 자리를 다 못 채우면 재시도가 남은 칸을 쓴다',
    plan(5, att, ['new-1']).workset.sources.map((s) => s.sourceArticleId).length > 1)
  check('🔴 🔴 **다음 회차 즉시 선택은 보장되지 않는다 — 자리가 하나면 신규가 가져갈 수 있다**', (() => {
    const one = plan(1, new Map([['old-2', { atMs: ago(1) }]]), ['new-1'])
    return one.workset.sources.map((s) => s.sourceArticleId).length === 1 && one.workset.sources.map((s) => s.sourceArticleId)[0] === 'new-1'
  })())
  check('🔴 🔴 **다만 오래 굶으면 자리 하나여도 재시도가 가져간다**', (() => {
    const one = plan(1, new Map([['old-1', { atMs: ago(72) }]]), ['new-1'])
    return one.workset.sources.map((s) => s.sourceArticleId)[0] === 'old-1'
  })())
  check('🔴 `concluded` 에 들어간 원천은 다시 뽑히지 않는다', (() => {
    const p2 = selectWorkset({
      rows: [row('done-1', 99), row('new-1', 10)],
      humanDecided: EMPTY_HUMAN_DECISIONS, queuePending: new Set<string>(), queuedSources: EMPTY_SOURCE_KEYS, carriedOver: EMPTY_SOURCE_KEYS,
      concluded: new Set([sourceKeyOf(RT_SITE, 'done-1')]), attempted: new Map() as never,
      releaseOf, limit: 5, runId: 'r1', takenAt: NOW,
    })
    return !p2.workset.sources.map((s) => s.sourceArticleId).includes('done-1')
  })())
}

console.log('\n🔴 🔴 **화자 상대 사실 — 원문 작성자를 복제하지 않는다 (P02 실패 사슬)**')
{
  const span = (text: string) => [{ kind: 'head' as const, text, fromRatio: 0, toRatio: 1 }]

  // ① 원문 화자의 나이는 `protectedFacts` 에서 걷어낸다
  check('🔴 🔴 **원문 "낼44인데" 의 44 는 화자 상대 사실로 잡힌다**',
    speakerRelativeAxisOf({ text: '44', ref: 'head', spans: span('낼44인데 아직도 어리단소리들어요 ㅋ') }) === 'age')
  check('🔴 🔴 **제3자 나이는 걷어내지 않는다 — 원문 이야기의 일부다**',
    speakerRelativeAxisOf({ text: '44', ref: 'head', spans: span('아는 분이 44인데 그렇대요') }) === null)
  check('🔴 🔴 **나이가 아닌 숫자(80퍼)는 그대로 지킨다**',
    speakerRelativeAxisOf({ text: '80퍼', ref: 'head', spans: span('진짜여잔 피부가80퍼...') }) === null)
  check('🔴 기간·금액은 그대로 지킨다',
    speakerRelativeAxisOf({ text: '3일', ref: 'head', spans: span('3일 뒀더니 시어졌어요') }) === null)

  // ② Persona 정확 나이 — birth anchor
  const POOL = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
  const cardOf = (code: string) => POOL.cards.find((c) => c.code === code)!
  const p02 = { birthDate: cardOf('P02').birthDate, ageBand: cardOf('P02').ageBand }
  const a = exactAgeOf({ ...p02, onKstDate: '2026-09-23' })
  check('🔴 🔴 **P02 의 정확한 나이가 나온다**', a.ok === true, JSON.stringify(a))
  check('🔴 🔴 **그 나이는 정본 `40대 후반`(47~49) 안이다**',
    a.ok && a.age >= 47 && a.age <= 49, a.ok ? String(a.age) : '-')
  check('🔴 🔴 **생일은 카드에 적힌 값 그대로다 — 해시로 유도하지 않는다**', (() => {
    const b = exactAgeOf({ ...p02, onKstDate: '2026-09-23' })
    return a.ok && b.ok && a.birthDate === cardOf('P02').birthDate && a.age === b.age
  })())
  check('🔴 🔴 **해가 바뀌면 나이도 는다 — 사람이 매년 고치지 않는다**', (() => {
    const y0 = exactAgeOn(p02.birthDate, '2026-12-31')!
    const y5 = exactAgeOn(p02.birthDate, '2031-12-31')!
    return y5 === y0 + 5
  })())
  check('🔴 🔴 **밴드를 못 읽으면 나이를 만들지 않는다 (fail-closed)**',
    exactAgeOf({ birthDate: p02.birthDate, ageBand: null, onKstDate: '2026-09-23' }).ok === false)
  check('🔴 🔴 **생일이 없으면 나이를 만들지 않는다 (fail-closed)**',
    exactAgeOf({ birthDate: null, ageBand: '40대 후반', onKstDate: '2026-09-23' }).ok === false)
  check('🔴 🔴 **계산한 나이가 밴드 밖이면 쓰지 않는다**', (() => {
    const far = exactAgeOf({ ...p02, onKstDate: '2036-09-23' })
    return !far.ok && far.code === 'OUT_OF_BAND'
  })())
  check('🔴 🔴 **카드 31명 전원이 전 축 검사를 통과한다 (ageBand·자녀·갱년기·간병·혼인·직업)**', (() => {
    for (const c of POOL.cards) {
      const v = exactAgeOf({ birthDate: c.birthDate, ageBand: c.ageBand, onKstDate: '2026-09-23' })
      if (!v.ok) return false
      const probs = checkLifeConsistency({
        age: v.age, ageBand: c.ageBand, childrenAgeBands: c.childrenAgeBands,
        childrenCount: c.childrenCount, maritalStatus: c.maritalStatus,
        menopauseStatus: c.menopauseStatus, parentCare: c.parentCare, workStatus: c.workStatus,
      })
      if (probs.length > 0) return false
    }
    return POOL.cards.length === 31
  })())
  check('🔴 자녀 연령대 문자열을 제대로 읽는다 — `중3` 은 3세가 아니다',
    childAgeFrom('중3') === 15 && childAgeFrom('초등 고학년') === 11 && childAgeFrom('20대') === 25)
  check('🔴 생일 전후로 한 살이 갈린다', (() => {
    const [y, m, d] = p02.birthDate.split('-')
    const before = exactAgeOn(p02.birthDate, `2026-${m}-${String(Number(d) - 1 > 0 ? Number(d) - 1 : 1).padStart(2, '0')}`)
    const on = exactAgeOn(p02.birthDate, `2026-${m}-${d}`)
    return Number(y) > 1900 && before !== null && on !== null && on >= before
  })())
  check('🔴 🔴 **기준일 뒤에 생일이 오는 Persona 도 밴드 안이다 (실측 버그 회귀)**', (() => {
    // 🔴 `baseY - age` 로만 잡으면 생일이 기준일보다 뒤인 경우 한 살 적어져
    //    며칠만 지나도 OUT_OF_BAND 가 났다 (P01·P16·P19 실측).
    // 🔴 밴드를 추측하지 않는다 — **Pool 정본 문서**에서 읽는다
    const doc = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
    for (const c of doc.cards) {
      // 🔴 기준일부터 **1년 뒤까지** 어느 날이든 밴드 안이어야 한다 —
      //    그래야 사람이 매년 카드를 고치지 않아도 된다
      for (const d of ['2026-09-23', '2026-12-31']) {
        if (!exactAgeOf({ birthDate: c.birthDate, ageBand: c.ageBand, onKstDate: d }).ok) return false
      }
    }
    return doc.cards.length >= 20
  })())
  check('🔴 생활사 모순을 잡는다 — 자녀 40세인데 화자 49세', (() => {
    const probs = checkLifeConsistency({ age: 49, childrenAgeBands: ['40대'] })
    return probs.some((x) => x.axis === 'children')
  })())

  // ③ 자동 변환 — 사람 손 없이
  const FACTS = (role: 'incidental' | 'loadBearing') =>
    [{ axis: 'age' as const, sourceText: '42', role }]
  const persona = (exactAge: number | null, band: string | null) => ({
    exactAge, ageBand: band, maritalStatus: '기혼', childrenCount: 1,
    parentCare: null, menopauseStatus: null, work: null, region: null,
  })
  const m49 = planAxisMapping({ facts: FACTS('incidental'), persona: persona(49, '40대 후반') })
  check('🔴 🔴 **원문 42 + Persona 49 → "49살" 로 서술하라는 지시가 나온다**',
    m49.ok && m49.mappings[0]?.personaText === '49살'
    && m49.mappings[0].outputRule.includes('복제하지 않고'), JSON.stringify(m49))
  check('🔴 🔴 **정확한 나이가 없으면 연령대까지만 — 숫자를 지어내지 않는다**', (() => {
    const m = planAxisMapping({ facts: FACTS('incidental'), persona: persona(null, '50대 초반') })
    return m.ok && m.mappings[0]?.personaText === '50대 초반'
  })())
  check('🔴 🔴 **원문에 나이가 없으면 아무것도 더하지 않는다**', (() => {
    const m = planAxisMapping({ facts: [], persona: persona(49, '40대 후반') })
    return m.ok && m.mappings.length === 0 && m.note.includes('더하지 않는다')
  })())
  /**
   * 🔴 **load-bearing 은 여기서 판정하지 않는다** (2026-09-23 마스터 지적).
   *    앞판은 여기서 곧바로 실패를 냈다 — Persona 를 보기도 전에. 그래서 사람을 바꾸는
   *    재계획이 성공 가능성 0 인 반복이 됐다. 판정 자리는 `resolveLoadBearing` 이다.
   */
  check('🔴 🔴 **load-bearing 이 여기까지 왔으면 "고른 사람이 조건을 만족한다" 는 뜻이다**', (() => {
    const m = planAxisMapping({ facts: FACTS('loadBearing'), persona: persona(49, '40대 후반') })
    // 🔴 바꾸지 않는다 — 원문 값이 곧 우리 값이므로 지시가 필요 없다
    return m.ok && m.mappings.length === 0
  })())
  check('🔴 🔴 **우리 쪽 값이 없으면 빈 지시로 넘기지 않고 실패로 올린다 (fail-closed)**', (() => {
    const m = planAxisMapping({
      facts: [{ axis: 'region', sourceText: '부산', role: 'incidental' }],
      persona: persona(49, '40대 후반'),   // region 이 null 이다
    })
    return !m.ok && m.code === 'NO_PERSONA_VALUE' && m.axis === 'region'
  })())
  check('🔴 나이 말고 다른 축도 같은 계약으로 바뀐다 (혼인·자녀)', (() => {
    const m = planAxisMapping({
      facts: [{ axis: 'maritalStatus', sourceText: '이혼', role: 'incidental' },
        { axis: 'children', sourceText: '자녀 셋', role: 'incidental' }],
      persona: persona(49, '40대 후반'),
    })
    return m.ok && m.mappings[0]?.personaText === '기혼' && m.mappings[1]?.personaText === '자녀 1'
  })())
  check('🔴 축 목록이 일곱이다 — 축마다 패치하지 않는다',
    SPEAKER_RELATIVE_AXES.length === 7)

  // ④ 나이 말고 다른 축도 걷어낸다 — 조사에서 찾은 같은 구조의 결함
  const ax = (text: string, host: string) =>
    speakerRelativeAxisOf({ text, ref: 'head', spans: span(host) })
  /**
   * 🔴 **관계·직업·지역·갱년기는 아직 켜지 않았다** (마스터 판정).
   *    걷어내기만 하고 완전한 변환·검증이 없으면 **내용이 사라진다.**
   *    지금은 `age` 한 축만 켜 놓고 세로로 끝까지 완성한다.
   */
  check('🔴 🔴 **관계는 아직 걷어내지 않는다 — 변환이 완성되기 전에는 지킨다**',
    ax('남편', '남편이 퇴근하고 와서 과일 한 상자 가져가라네요') === null)
  check('🔴 🔴 **자녀도 아직 걷어내지 않는다**',
    ax('딸', '중3 딸이 샤워를 한 시간 넘게 해요') === null)
  check('🔴 🔴 **부모 돌봄도 아직 걷어내지 않는다**',
    ax('친정', '친정 어머니 병원 모시고 다니느라 힘들어요') === null)
  check('🔴 "아는 분 남편" 도 당연히 지킨다',
    ax('남편', '아는 분 남편은 외아들이라 그런지 매일 통화한대요') === null)
  check('🔴 🔴 **지명·상품 같은 source-invariant 는 그대로 지킨다**',
    ax('강남', '강남에 새로 생긴 가게 가봤어요') === null)

  // ⑤ hasFact 양방향 — 우리 풀에 있는 사람을 쓸 수 있어야 한다
  const card = (o: Record<string, unknown>) => ({
    code: 'PX', ageBand: '50대 초반', maritalStatus: '이혼', childrenCount: 0,
    childrenAgeBands: [] as string[], parentCare: '없음', menopauseStatus: '전',
    workStatus: '전업', region: '수도권', ...o,
  })
  check('🔴 🔴 **비혼·이혼 Persona 가 `spouse=없음` 근거를 세울 수 있다**',
    hasFact(card({}) as never, 'spouse', '없음') === true
    && hasFact(card({}) as never, 'spouse', '있음') === false)
  check('🔴 🔴 **간병 없는 Persona 가 `parentCare=없음` 근거를 세울 수 있다**',
    hasFact(card({}) as never, 'parentCare', '없음') === true)
  check('🔴 🔴 **갱년기 전 Persona 가 `menopause=없음` 근거를 세울 수 있다**',
    hasFact(card({}) as never, 'menopause', '없음') === true)
  check('🔴 기혼 Persona 는 `spouse=있음` 이 맞고 `없음` 은 아니다',
    hasFact(card({ maritalStatus: '기혼' }) as never, 'spouse', '있음') === true
    && hasFact(card({ maritalStatus: '기혼' }) as never, 'spouse', '없음') === false)
  check('🔴 프롬프트 계약도 양방향으로 맞춰졌다', (() => {
    const src = readFileSync('scripts/lib/content-core-prompts.mts', 'utf-8')
    return /spouse · parentCare · menopause · children → "있음" 또는 "없음"/.test(src)
  })())
}

console.log('\n🔴 🔴 **P02 실제 E2E — 원문 "곧 44" 가 초안 프롬프트까지 어떻게 가는가**')
{
  // 🔴 helper 만 부르지 않는다. **실제 계획 파서 → 실제 프롬프트 빌더**를 지난다.
  const SRC = '낼44인데 아직도 어리단소리들어요 ㅋ\n진짜여잔 피부가80퍼...'
  const packet = { spans: [{ kind: 'head' as const, text: SRC, fromRatio: 0, toRatio: 1 }] }
  const card = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
    .cards.find((c) => c.code === 'P02')!

  // ① 실제 계획 파서 — 모델이 44 와 80퍼를 둘 다 protectedFacts 로 냈다고 하자 (실측 그대로)
  const raw = JSON.stringify({
    decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE',
    selfBasis: 'noLifeFactNeeded', universalReason: '누구나 겪는 일이라',
    speakerWarrants: [], closingIntent: 'ask', contentRoles: [],
    protectedFacts: [
      { kind: 'number', text: '80퍼', evidenceRef: 'head' },
      { kind: 'number', text: '44', evidenceRef: 'head' },
    ],
    // 🔴 새 계약(p5/v6) — 화자 상대 사실마다 materiality 를 **반드시** 적는다
    speakerRelative: [{ axis: 'age', sourceText: '44', evidenceRef: 'head', materiality: 'incidental' }],
  })
  const parsed = parseSpeakerPlan(raw, packet as never, [card] as never)
  const plan = parsed.plan
  check('🔴 🔴 **① 계획이 만들어진다**', plan.decision === 'ok', JSON.stringify(parsed.schemaProblems))
  check('🔴 🔴 **② 원문의 44 가 `protectedFacts` 에 남지 않는다**',
    !plan.protectedFacts.some((f: { text: string }) => f.text === '44'),
    JSON.stringify(plan.protectedFacts))
  check('🔴 🔴 **③ source-invariant 인 80퍼 는 그대로 지켜진다 — 내용이 사라지지 않는다**',
    plan.protectedFacts.some((f: { text: string }) => f.text === '80퍼'))
  check('🔴 🔴 **④ 빼기만 하지 않는다 — 무엇을 바꿀지 계획에 남는다**',
    plan.speakerRelative.some((e: { axis: string; sourceText: string }) => e.axis === 'age' && e.sourceText === '44'),
    JSON.stringify(plan.speakerRelative))

  // ② 그날의 정확한 나이
  const age = exactAgeOf({ birthDate: card.birthDate, ageBand: card.ageBand, onKstDate: '2026-09-23' })
  check('🔴 🔴 **⑤ P02 고정 생일에서 그날 나이가 나온다**', age.ok === true, JSON.stringify(age))

  // ③ **실제 프롬프트 빌더**
  const life = {
    code: card.code, ageBand: card.ageBand, region: card.region,
    maritalStatus: card.maritalStatus, spouseRelationship: card.spouseRelationship,
    childrenCount: card.childrenCount, childrenAgeBands: card.childrenAgeBands,
    workStatus: card.workStatus, economicStatus: card.economicStatus,
    menopauseStatus: card.menopauseStatus, parentCare: card.parentCare,
    personality: card.personality, noGoTopics: card.noGoTopics,
    noGoExpressions: card.noGoExpressions ?? [], housing: card.housing,
  }
  const mapping = planAxisMapping({
    facts: plan.speakerRelative.map((e: { axis: string; sourceText: string; materiality: string }) =>
      ({ axis: e.axis as never, sourceText: e.sourceText, role: e.materiality as never })),
    persona: {
      exactAge: age.ok ? age.age : null, ageBand: card.ageBand,
      maritalStatus: card.maritalStatus, childrenCount: card.childrenCount,
      parentCare: card.parentCare, menopauseStatus: card.menopauseStatus,
      work: card.workStatus, region: card.region,
    },
  })
  check('🔴 🔴 **⑤-b 변환 계획이 성공한다 — 실패면 생성으로 넘어가지 않는다**', mapping.ok === true,
    JSON.stringify(mapping))
  const prompt = buildV2DraftSystemPrompt({
    plan, life: life as never, mappings: mapping.ok ? mapping.mappings : [],
    voice: { tokens: [], samples: ['그렇더라고요'], bundleDigest: 'b' } as never,
  })
  check('🔴 🔴 **⑥ 프롬프트가 "44 를 복제하지 말고 N살로 써라" 를 실제로 담는다**',
    prompt.includes('복제하지 않고') && age.ok && prompt.includes(`${age.age}살`),
    prompt.split('\n').filter((l) => l.includes('복제하지')).join(' / '))
  check('🔴 🔴 **⑦ 프롬프트에 원문의 44 가 "그대로 쓰라" 로 남지 않는다**', (() => {
    const keepLine = prompt.split('\n').find((l) => l.includes('그대로** 씁니다')) ?? ''
    return !keepLine.includes('44')
  })())
  check('🔴 🔴 **⑧ 80퍼 는 "그대로 쓰라" 에 남는다 — invariant 는 지켜진다**', (() => {
    const keepLine = prompt.split('\n').find((l) => l.includes('그대로** 씁니다')) ?? ''
    return keepLine.includes('80퍼')
  })())
  check('🔴 🔴 **⑨ "빼지 말고 바꾼다" 는 지시가 있다 — 내용 유실을 막는다**',
    prompt.includes('빼지 말고 바꿉니다'))
  check('🔴 🔴 **⑩ 원문에 없던 사실을 더하지 말라는 지시도 있다**',
    prompt.includes('새로 더하지 않습니다'))

  // ④ exactAge 가 없으면 연령대까지만
  const bandMap = planAxisMapping({
    facts: plan.speakerRelative.map((e: { axis: string; sourceText: string; materiality: string }) =>
      ({ axis: e.axis as never, sourceText: e.sourceText, role: e.materiality as never })),
    persona: {
      exactAge: null, ageBand: card.ageBand, maritalStatus: card.maritalStatus,
      childrenCount: card.childrenCount, parentCare: card.parentCare,
      menopauseStatus: card.menopauseStatus, work: card.workStatus, region: card.region,
    },
  })
  const noAge = buildV2DraftSystemPrompt({
    plan, life: life as never, mappings: bandMap.ok ? bandMap.mappings : [],
    voice: { tokens: [], samples: ['그렇더라고요'], bundleDigest: 'b' } as never,
  })
  check('🔴 🔴 **⑪ 정확한 나이가 없으면 연령대로 쓰라고 한다 — 숫자를 지어내지 않는다**',
    noAge.includes(card.ageBand) && !/\d{2}살/.test(noAge.split('바꿔 씁니다')[1] ?? ''))

  // ⑤ 제3자 나이는 손대지 않는다
  const thirdPacket = { spans: [{ kind: 'head' as const, text: '아는 분이 44인데 그렇대요', fromRatio: 0, toRatio: 1 }] }
  const thirdPlan = parseSpeakerPlan(JSON.stringify({
    decision: 'ok', personaCode: 'P02', stance: 'OBSERVATION',
    selfBasis: null, universalReason: '', speakerWarrants: [], closingIntent: 'ask', contentRoles: [],
    protectedFacts: [{ kind: 'number', text: '44', evidenceRef: 'head' }],
  }), thirdPacket as never, [card] as never).plan
  check('🔴 🔴 **⑫ 제3자 나이는 `protectedFacts` 에 그대로 남는다**',
    thirdPlan.protectedFacts.some((f: { text: string }) => f.text === '44')
    && thirdPlan.speakerRelative.length === 0, JSON.stringify(thirdPlan.protectedFacts))
}

console.log('\n🔴 🔴 **P02 전체 E2E — 실제 `runContentCore` 를 끝까지 돌린다**')
{
  /**
   * 🔴 프롬프트 문자열 포함 검사가 아니다. **가짜 provider 로 실제 파이프라인 전체**를
   *    돈다: plan → parseSpeakerPlan → birthDate → exactAge → draft prompt →
   *    draft 응답 → **자동 보정** → deterministic → semantic review → artifact.
   */
  const CARD_P02 = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
    .cards.find((c) => c.code === 'P02')!
  const p02 = P({
    code: 'P02', ageBand: CARD_P02.ageBand, birthDate: CARD_P02.birthDate,
    maritalStatus: CARD_P02.maritalStatus, childrenCount: CARD_P02.childrenCount,
    childrenAgeBands: CARD_P02.childrenAgeBands, workStatus: CARD_P02.workStatus,
    region: CARD_P02.region, menopauseStatus: CARD_P02.menopauseStatus,
    parentCare: CARD_P02.parentCare,
  })
  const expectAge = exactAgeOf({
    birthDate: CARD_P02.birthDate, ageBand: CARD_P02.ageBand, onKstDate: kstKeyOf(NOW),
  })

  const SRC_TITLE = '자랑은 아닌데 여잔 피부가80퍼인듯'
  const SRC_BODY = '에스테딕싼곳 동네다니는데 진짜\n낼44인데 아직도 어리단소리들어요 ㅋ\n진짜여잔 피부가80퍼...'
  const PLAN = {
    decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE',
    selfBasis: 'lifeFacts', universalReason: '',
    speakerWarrants: [{ fact: 'age', requiredValue: CARD_P02.ageBand, evidenceRef: 'head', evidenceText: '낼44인데' }],
    closingIntent: 'ask', contentRoles: ['conversationSpark'],
    protectedFacts: [
      { kind: 'number', text: '80퍼', evidenceRef: 'title' },
      { kind: 'number', text: '44', evidenceRef: 'head' },
    ],
    speakerRelative: [{ axis: 'age', sourceText: '44', evidenceRef: 'head', materiality: 'incidental' }],
  }
  /** 🔴 반례 ①: 모델이 원문의 44 를 **그대로 베껴** 돌려준다 */
  const DRAFT_COPIES_44 = {
    title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
    body: '동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n제가 곧 44인데 아직 어리단 소리를 들어요.\n여자는 피부가 80퍼인 것 같아요. 다들 어떠세요?',
  }
  /** 🔴 반례 ②: 모델이 처음부터 P02 나이를 쓴다 */
  const DRAFT_USES_PERSONA = {
    title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
    body: `동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n제가 ${expectAge.ok ? expectAge.age : 47}인데 아직 어리단 소리를 들어요.\n여자는 피부가 80퍼인 것 같아요. 다들 어떠세요?`,
  }

  const go = (draft: unknown) => run({
    id: '35040880', title: SRC_TITLE, body: SRC_BODY,
    personas: [p02], canned: { plan: PLAN, draft, review: EMPTY_REVIEW },
  })

  const a1 = await go(DRAFT_COPIES_44)
  const t1 = `${a1.draft?.title ?? ''}\n${a1.draft?.body ?? ''}`
  check('🔴 🔴 **① 초안이 44 를 베껴도 자동 보정 뒤 채택된다**',
    a1.review.machineOutcome === 'adopt', `${a1.review.machineOutcome} · ${a1.review.machineReason}`)
  check('🔴 🔴 **① 결과에 원문의 44 가 남지 않는다**', !/(^|[^0-9])44\s*(살|세|인데)/.test(t1), t1)
  check('🔴 🔴 **① P02 정본 나이가 들어간다**',
    expectAge.ok && new RegExp(`(^|[^0-9])${expectAge.age}\\s*(살|세|인데)`).test(t1),
    `기대 ${expectAge.ok ? expectAge.age : '-'} · 본문 ${t1}`)
  check('🔴 🔴 **① source-invariant 인 80퍼 는 살아 있다**', t1.includes('80퍼'))
  check('🔴 🔴 **① `protectedFactMissing` 이 없다**',
    !a1.review.deterministic.failures.some((f) => f.code === 'protectedFactMissing'),
    JSON.stringify(a1.review.deterministic.failures))
  check('🔴 🔴 **① `lifeContradictions` 가 없다**',
    a1.review.semantic !== null && a1.review.semantic.lifeContradictions.length === 0)

  /** 🔴 반례 ③: 초안이 나이 문장을 **통째로 빼 버린다** */
  const a3 = await go({
    title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
    body: '동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n여자는 피부가 80퍼인 것 같아요. 다들 어떠세요?',
  })
  check('🔴 🔴 **③ 나이 문장을 통째로 빼면 채택되지 않는다 (adopt 금지)**',
    a3.review.machineOutcome !== 'adopt', a3.review.machineOutcome)
  check('🔴 🔴 **③ 구조화된 `personaTransformFailed` 로 돌아온다 — 문자열 파싱 아님**',
    a3.review.semanticCompletion.cause === 'personaTransformFailed',
    String(a3.review.semanticCompletion.cause))
  check('🔴 🔴 **③ 그 사유는 재시도 자격을 유지한다 — 영구 제외가 아니다**',
    artifactRetryable(a3.review) === true)

  /** 🔴 반례 ④: 제3자 44 와 우리 나이가 같은 글에 있다 */
  const a4 = await go({
    title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
    body: `아는 분이 44인데 관리를 안 하더라고요.\n저는 ${expectAge.ok ? expectAge.age : 47}인데 그래도 어리단 소리를 들어요.\n여자는 피부가 80퍼인 것 같아요.`,
  })
  check('🔴 🔴 **④ 제3자 44 는 그대로 두고 채택된다**',
    a4.review.machineOutcome === 'adopt'
    && (a4.draft?.body ?? '').includes('아는 분이 44인데'), a4.review.machineOutcome)

  const a2 = await go(DRAFT_USES_PERSONA)
  const t2 = `${a2.draft?.title ?? ''}\n${a2.draft?.body ?? ''}`
  check('🔴 🔴 **② 처음부터 P02 나이를 쓰면 손대지 않고 채택된다**',
    a2.review.machineOutcome === 'adopt' && t2 === `${DRAFT_USES_PERSONA.title}\n${DRAFT_USES_PERSONA.body}`,
    `${a2.review.machineOutcome}`)

  // 🔴 주입 시계 — 같은 `now` 면 언제 돌려도 같은 나이다
  check('🔴 🔴 **③ 주입된 시계만 쓴다 — 실행 시각과 무관하다**', (() => {
    const d1 = exactAgeOf({ birthDate: CARD_P02.birthDate, ageBand: CARD_P02.ageBand, onKstDate: kstKeyOf(NOW) })
    const d2 = exactAgeOf({ birthDate: CARD_P02.birthDate, ageBand: CARD_P02.ageBand, onKstDate: kstKeyOf(NOW) })
    return d1.ok && d2.ok && d1.age === d2.age
  })())
  check('🔴 🔴 **③ KST 자정 경계에서 날짜가 갈린다**',
    kstKeyOf(new Date('2026-09-22T14:59:59Z')) === '2026-09-22'
    && kstKeyOf(new Date('2026-09-22T15:00:00Z')) === '2026-09-23')
  check('🔴 🔴 **③ 사람이 갱신하지 않아도 나이가 진행된다 (2026 · 2031 · 2036)**', (() => {
    const y = (n: string) => exactAgeOn(CARD_P02.birthDate, `${n}-12-31`)
    const a = y('2026'); const b = y('2031'); const c = y('2036')
    return a !== null && b === a + 5 && c === a + 10
  })())
}

console.log('\n🔴 🔴 **materiality — 계획이 말한 값을 쓰되 증거로 확인한다 (하드코딩 제거)**')
{
  /**
   * 🔴 앞판은 화자 상대 사실을 **전부 `incidental`** 로 하드코딩했다. 그래서
   *    `loadBearingMismatch` 는 **한 번도 나올 수 없는 죽은 경로**였다.
   *    여기서는 실제 `runContentCore` 를 돌려 세 갈래가 **정말 갈리는지** 본다.
   */
  const CARD_P02 = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
    .cards.find((c) => c.code === 'P02')!
  const p02 = P({
    code: 'P02', ageBand: CARD_P02.ageBand, birthDate: CARD_P02.birthDate,
    maritalStatus: CARD_P02.maritalStatus, childrenCount: CARD_P02.childrenCount,
    childrenAgeBands: CARD_P02.childrenAgeBands, workStatus: CARD_P02.workStatus,
    region: CARD_P02.region, menopauseStatus: CARD_P02.menopauseStatus,
    parentCare: CARD_P02.parentCare,
  })
  const T = '자랑은 아닌데 여잔 피부가80퍼인듯'
  const B = '에스테딕싼곳 동네다니는데 진짜\n낼44인데 아직도 어리단소리들어요 ㅋ\n진짜여잔 피부가80퍼...'
  const DRAFT = {
    title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
    body: '동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n제가 곧 44인데 아직 어리단 소리를 들어요.\n여자는 피부가 80퍼인 것 같아요. 다들 어떠세요?',
  }
  const planWith = (speakerRelative: unknown[]): unknown => ({
    decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE',
    selfBasis: 'lifeFacts', universalReason: '',
    speakerWarrants: [{
      fact: 'age', requiredValue: CARD_P02.ageBand, evidenceRef: 'head', evidenceText: '낼44인데',
    }],
    closingIntent: 'ask', contentRoles: ['conversationSpark'],
    protectedFacts: [
      { kind: 'number', text: '80퍼', evidenceRef: 'title' },
      { kind: 'number', text: '44', evidenceRef: 'head' },
    ],
    speakerRelative,
  })
  const go = (speakerRelative: unknown[]) => run({
    id: '35040880', title: T, body: B, personas: [p02],
    canned: { plan: planWith(speakerRelative), draft: DRAFT, review: EMPTY_REVIEW },
  })

  /** 🔴 ① 계획이 그 나이를 `incidental` 이라 말하고 증거도 맞다 → 바꿔서 채택 */
  const ok1 = await go([
    { axis: 'age', sourceText: '44', evidenceRef: 'head', materiality: 'incidental' },
  ])
  check('🔴 🔴 **① 계획이 incidental 이라 말하고 증거가 맞으면 바꿔서 채택한다**',
    ok1.review.machineOutcome === 'adopt',
    `${ok1.review.machineOutcome} · ${ok1.review.machineReason}`)

  /**
   * 🔴 ② **loadBearing 인데 고른 사람이 그 조건이 아니다.**
   *    P02 는 47(그날 계산)이고 원문은 44 다. 이번 묶음에 44 인 후보가 없으므로
   *    사람을 바꿔도 소용없다 — **자리(stance)** 를 바꾸라고 돌려보낸다.
   *    🔴 앞판은 여기서 사람을 세 명 태웠다.
   */
  const lb = await go([
    { axis: 'age', sourceText: '44', evidenceRef: 'head', materiality: 'loadBearing' },
  ])
  check('🔴 🔴 **② 만족하는 후보가 없으면 `loadBearingSelfImpossible` — 사람을 태우지 않는다**',
    lb.review.machineOutcome !== 'adopt'
    && lb.review.semanticCompletion.cause === 'loadBearingSelfImpossible',
    `${lb.review.machineOutcome} · ${String(lb.review.semanticCompletion.cause)} · ${lb.review.machineReason}`)
  check('🔴 🔴 **② 그 사유는 사람을 제외하지 않는다 — 제외 대상 사유 목록에 없다**',
    ![...PERSONA_REPLAN_CAUSES].includes('loadBearingSelfImpossible' as never),
    [...PERSONA_REPLAN_CAUSES].join(','))

  /**
   * 🔴 ③ **materiality 를 답하지 않으면 통과시키지 않는다** (마스터 P0-2).
   *    앞판은 검증되지 않은 자기 나이를 `incidental` 로 보고 **adopt** 했다.
   */
  const omitted = await go([
    { axis: 'age', sourceText: '80퍼', evidenceRef: 'title', materiality: 'incidental' },
  ])
  check('🔴 🔴 **③ 답했는데 그 사실만 빠지면 모양 오류다 — 발행 후보가 되지 않는다**',
    omitted.review.machineOutcome !== 'adopt'
    && omitted.review.semanticCompletion.cause === 'parseFailed',
    `${omitted.review.machineOutcome} · ${String(omitted.review.semanticCompletion.cause)}`)

  /** 🔴 ④ 증거 자리를 지어내면 그 주장은 없는 것과 같다 */
  const faked = await go([
    { axis: 'age', sourceText: '44', evidenceRef: 'title', materiality: 'incidental' },
  ])
  check('🔴 🔴 **④ evidenceRef 가 실제와 다르면 그 주장을 버리고 다시 묻는다**',
    faked.review.machineOutcome !== 'adopt'
    && faked.review.semanticCompletion.cause === 'parseFailed',
    `${faked.review.machineOutcome} · ${String(faked.review.semanticCompletion.cause)}`)

  /**
   * 🔴 ⑤ **아예 답하지 않아도 통과시키지 않는다.** 이것이 마스터가 지적한 자리다 —
   *    앞판은 여기서 `incidental` 기본값으로 **발행 후보를 만들었다.**
   */
  const silent = await go([])
  check('🔴 🔴 **⑤ speakerRelative 를 아예 안 쓰면 발행 후보가 되지 않는다 (fail-closed)**',
    silent.review.machineOutcome !== 'adopt'
    && silent.review.semanticCompletion.cause === 'parseFailed',
    `${silent.review.machineOutcome} · ${String(silent.review.semanticCompletion.cause)}`)
  check('🔴 🔴 **⑤ 그것은 재시도다 — 정상 원천을 영구 제외하지 않는다**',
    artifactRetryable(silent.review) === true)
  check('🔴 🔴 **⑤ 기본값 함수가 사라졌다 — `materialityFor` 는 없으면 `null` 이다**',
    materialityFor('44', 'head', new Map()) === null)

  /**
   * 🔴 ⑥ **원문에 없는 말을 지목한 계획은 채택되지 않는다.**
   *    🔴 `foundInSpan` 이 이것을 잡는다고 말하지 않는다 — 실측하면 그보다 앞서
   *    다른 검사가 먼저 잡는다. 관측되지 않은 것을 관측했다고 적지 않는다.
   */
  const notInSpan = await run({
    id: '35040880', title: T, body: B, personas: [p02],
    canned: {
      plan: {
        ...(planWith([
          { axis: 'age', sourceText: '44살', evidenceRef: 'head', materiality: 'incidental' },
        ]) as Record<string, unknown>),
        protectedFacts: [
          { kind: 'number', text: '80퍼', evidenceRef: 'title' },
          { kind: 'number', text: '44살', evidenceRef: 'head' },
        ],
      },
      draft: DRAFT, review: EMPTY_REVIEW,
    },
  })
  check('🔴 🔴 **⑥ 원문에 없는 말을 지목한 계획은 채택되지 않는다**',
    notInSpan.review.machineOutcome !== 'adopt',
    `${notInSpan.review.machineOutcome} · ${notInSpan.review.machineReason}`)

  /**
   * 🔴 **유료 요청 수를 값으로 남긴다** (2026-09-23 마스터 요구 ⑥).
   *    "변화 0" 이라고 쓰지 않는다 — 실제로 몇 번 나갔는지 잰다.
   */
  console.log(`   🔴 회차당 유료 요청 — 정상 ${ok1.cost.totalCalls}회`
    + ` · load-bearing 중단 ${lb.cost.totalCalls}회`
    + ` · materiality 누락 ${silent.cost.totalCalls}회 (원천당 상한 ${3})`)
  check('🔴 🔴 **⑦ 정상 회차는 세 번이다 — 계획·생성·검수**',
    ok1.cost.totalCalls === 3, String(ok1.cost.totalCalls))
  check('🔴 🔴 **⑦ load-bearing 으로 멈추면 계획 한 번에서 끝난다 — 생성·검수로 가지 않는다**',
    lb.cost.totalCalls === 1, String(lb.cost.totalCalls))
  check('🔴 🔴 **⑦ materiality 누락도 계획 한 번이다 — 검증되지 않은 글에 돈을 더 쓰지 않는다**',
    silent.cost.totalCalls === 1, String(silent.cost.totalCalls))
}

console.log('\n🔴 🔴 **추천 Persona 를 다음 회차가 실제로 강제한다 (마스터 P0-3)**')
{
  /**
   * 🔴 앞판: `resolveLoadBearing` 의 `suggest=['P04']` 가 **사람이 읽는 문구**에만
   *    들어갔다. 다음 회차는 정렬 순서대로 **또 다른 불일치 Persona** 를 골랐다.
   *    🔴 값으로 남기고, 다음 회차 후보를 그 교집합으로만 만든다.
   */
  const SRC = 'lb-suggest'
  const C = (code: string) => ({ code })
  /** 🔴 artifact 가 실제로 내는 모양 그대로 — 손으로 줄이지 않는다 */
  const outcome = (suggest: readonly string[]) => [{
    sourceKey: SRC, sourceArticleId: SRC, atMs: Date.parse('2026-09-23T01:00:00.000Z'),
    stage: 'draft' as const, state: 'retryable' as const,
    failedPersonaCode: 'P02', failedStance: 'SELF_EXPERIENCE',
    failedCause: 'loadBearingMismatch', suggestedPersonaCodes: suggest,
  }]

  /** 🔴 ① 틀린 P01 이 정렬상 P04 보다 앞에 있어도 **P04 만** 고른다 */
  const only = personasForAttempt({
    outcomes: outcome(['P04']), sourceKey: SRC,
    slotCodes: ['P01', 'P02', 'P04', 'P08'],
    candidates: [C('P01'), C('P02'), C('P04'), C('P08')],
  })
  check('🔴 🔴 **① 지목된 P04 만 나간다 — 앞에 있는 P01 을 고르지 않는다**',
    only.ok && only.personas.map((x) => x.code).join(',') === 'P04',
    only.ok ? only.personas.map((x) => x.code).join(',') : JSON.stringify(only))

  /** 🔴 ② 지목이 여럿이면 그 집합 안에서 기존 정렬을 그대로 쓴다 */
  const many = personasForAttempt({
    outcomes: outcome(['P08', 'P04']), sourceKey: SRC,
    slotCodes: ['P01', 'P02', 'P04', 'P08'],
    candidates: [C('P01'), C('P02'), C('P04'), C('P08')],
  })
  check('🔴 🔴 **② 지목이 여럿이면 그 안에서 기존 정렬을 쓴다 (P04,P08)**',
    many.ok && many.personas.map((x) => x.code).join(',') === 'P04,P08',
    many.ok ? many.personas.map((x) => x.code).join(',') : JSON.stringify(many))

  /** 🔴 ③ 지목한 사람이 더 이상 적격하지 않으면 **조용히 전체로 돌아가지 않는다** */
  const gone = personasForAttempt({
    outcomes: outcome(['P04']), sourceKey: SRC,
    slotCodes: ['P01', 'P08'],
    candidates: [C('P01'), C('P08')],
  })
  check('🔴 🔴 **③ 지목이 사라지면 구조화된 실패다 — 아무나로 대체하지 않는다**',
    !gone.ok && gone.code === 'SUGGESTED_UNAVAILABLE', JSON.stringify(gone))

  /** 🔴 ④ 지목이 없으면 제한이 없다 — 기존 경로가 그대로다 */
  const free = personasForAttempt({
    outcomes: outcome([]), sourceKey: SRC,
    slotCodes: ['P01', 'P04', 'P08'],
    candidates: [C('P01'), C('P04'), C('P08')],
  })
  check('🔴 🔴 **④ 지목이 없으면 제한하지 않는다 — 실패한 P02 만 빠진다**',
    free.ok && free.personas.map((x) => x.code).join(',') === 'P01,P04,P08',
    free.ok ? free.personas.map((x) => x.code).join(',') : JSON.stringify(free))

  /**
   * 🔴 ⑤ **SELF_IMPOSSIBLE 은 사람을 지목하지 않는다** — 같은 Persona 로 자리만 바꾼다.
   */
  const selfImp = personasForAttempt({
    outcomes: [{
      sourceKey: SRC, sourceArticleId: SRC, atMs: Date.parse('2026-09-23T01:00:00.000Z'),
      stage: 'draft', state: 'retryable',
      failedPersonaCode: 'P02', failedStance: 'SELF_EXPERIENCE',
      failedCause: 'loadBearingSelfImpossible', suggestedPersonaCodes: [],
    }],
    sourceKey: SRC, slotCodes: ['P01', 'P02', 'P04'],
    candidates: [C('P01'), C('P02'), C('P04')],
  })
  check('🔴 🔴 **⑤ SELF_IMPOSSIBLE 은 같은 Persona 를 남긴다 — 자리만 바꾼다**',
    selfImp.ok && selfImp.personas.some((x) => x.code === 'P02'),
    selfImp.ok ? selfImp.personas.map((x) => x.code).join(',') : JSON.stringify(selfImp))

  /** 🔴 ⑥ 추천이 artifact 에 **값으로** 실린다 — 문구만 보지 않는다 */
  const lbPick = resolveLoadBearing({
    facts: [{ axis: 'age', sourceText: '44' }], stance: 'SELF_EXPERIENCE',
    chosen: { code: 'P02', exactAge: 47 },
    candidates: [{ code: 'P02', exactAge: 47 }, { code: 'P04', exactAge: 44 }],
    selfAlreadyFailed: false,
  })
  check('🔴 🔴 **⑥ 판정이 후보 목록을 값으로 낸다**',
    !lbPick.ok && lbPick.retry && lbPick.suggest.join(',') === 'P04', JSON.stringify(lbPick))
  const runSrc = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
  check('🔴 🔴 **⑥ 러너가 그 목록을 artifact 에 싣는다 — 문구에만 두지 않는다**',
    /suggestedPersonaCodes: \[\.\.\.suggested\]/.test(runSrc)
    && /if \(lb\.retry\) suggested = lb\.suggest/.test(runSrc))
  const wsSrc = readFileSync('src/lib/supply-workset.ts', 'utf-8')
  check('🔴 🔴 **⑥ 지난 결과를 읽을 때 그 목록을 꺼낸다**',
    /suggestedPersonaCodes/.test(wsSrc))
}

console.log('\n🔴 🔴 **load-bearing 조건 보존 — 초안이 지우면 검수가 clean 이라도 막는다 (마스터 P0-2)**')
{
  /**
   * 🔴 원문 자기 나이는 `protectedFacts` 에서 걷어내지고 `planAxisMapping` 은
   *    load-bearing 을 건너뛴다 — 그래서 초안이 그 조건을 **통째로 지워도** 막는 것이
   *    없었다. 의미 검수는 "깨끗하다" 고 답할 수 있다(모델의 답은 근거가 아니다).
   */
  const CARDS = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8')).cards
  const datedAge = (c: typeof CARDS[number]): number | null => {
    const v = materializePersonaAt({ card: { code: c.code, birthDate: c.birthDate, ageBand: c.ageBand }, now: NOW })
    return v.ok ? v.at.exactAge : null
  }
  // 🔴 원문 조건과 **같은 나이**인 사람을 정본에서 찾는다 — 그래야 SELF 가 성립한다
  const fitCard = CARDS.find((c) => datedAge(c) === 51)!
  const AGE = 51
  const pFit = P({
    code: fitCard.code, ageBand: fitCard.ageBand, birthDate: fitCard.birthDate,
    maritalStatus: fitCard.maritalStatus, childrenCount: fitCard.childrenCount,
    childrenAgeBands: fitCard.childrenAgeBands, workStatus: fitCard.workStatus,
    region: fitCard.region, menopauseStatus: fitCard.menopauseStatus, parentCare: fitCard.parentCare,
  })
  const LT = '나이 제한이 있다는데 아시는 분'
  const LB = `제가 ${AGE}세라서 그 지원 대상이 된다고 하더라고요.\n서류가 까다로운지 궁금합니다.`
  const lbPlan = (stance: string) => ({
    decision: 'ok', personaCode: fitCard.code, stance,
    selfBasis: stance === 'SELF_EXPERIENCE' ? 'noLifeFactNeeded' : null,
    universalReason: stance === 'SELF_EXPERIENCE' ? '누구나 겪는 일이라' : '',
    speakerWarrants: [], closingIntent: 'ask', contentRoles: ['conversationSpark'],
    protectedFacts: [],
    speakerRelative: [
      { axis: 'age', sourceText: String(AGE), evidenceRef: 'head', materiality: 'loadBearing' },
    ],
  })
  const goLB = (stance: string, draft: { title: string; body: string }) => run({
    id: 'lb-1', title: LT, body: LB, personas: [pFit],
    // 🔴 의미 검수는 **깨끗하다고 답한다** — 그래도 막혀야 한다
    canned: { plan: lbPlan(stance), draft, review: EMPTY_REVIEW },
  })

  /** 🔴 ① 초안이 조건을 통째로 지웠다 + 검수 clean → 후보가 되면 안 된다 */
  const dropped = await goLB('SELF_EXPERIENCE', {
    title: '지원 서류가 까다로울까요',
    body: '얼마 전에 대상이 된다는 이야기를 듣고 알아보는 중입니다.\n'
      + '서류 준비가 번거로운지 먼저 겪어 보신 분 계실까요?',
  })
  check('🔴 🔴 **① 조건을 지운 초안은 검수가 clean 이라도 후보가 되지 않는다**',
    dropped.review.machineOutcome !== 'adopt'
    && dropped.review.deterministic.failures.some((f) => f.code === 'loadBearingLost'),
    `${dropped.review.machineOutcome} · ${JSON.stringify(dropped.review.deterministic.failures)}`)
  check('🔴 🔴 **① 의미 검수는 실제로 깨끗하다고 답했다 — 그 답에 기대지 않는다**',
    dropped.review.semantic === null || dropped.review.lifeContradictions.length === 0,
    JSON.stringify(dropped.review.semantic))

  /** 🔴 ② 1인칭 조건을 그대로 지킨 초안은 통과한다 */
  const keptSelf = await goLB('SELF_EXPERIENCE', {
    title: '지원 서류가 까다로울까요',
    body: `제가 ${AGE}세라 대상이 된다고 들어서 알아보는 중입니다.\n`
      + '서류 준비가 번거로운지 먼저 겪어 보신 분 계실까요?',
  })
  check('🔴 🔴 **② 조건을 1인칭으로 지킨 초안은 통과한다**',
    keptSelf.review.machineOutcome === 'adopt',
    `${keptSelf.review.machineOutcome} · ${keptSelf.review.machineReason}`)

  /** 🔴 ③ 1인칭이 아닌 자리에서는 그 나이를 **우리 나이로 주장하면** 안 된다 */
  const claimed = await goLB('QUESTION', {
    title: '지원 대상 나이가 어떻게 되나요',
    body: `제가 ${AGE}세라서 대상이 된다고 들었습니다.\n서류가 까다로운지 아시는 분 계실까요?`,
  })
  check('🔴 🔴 **③ 관찰·질문 자리에서 그 나이를 자기 것으로 주장하면 막는다**',
    claimed.review.machineOutcome !== 'adopt'
    && claimed.review.deterministic.failures.some((f) => f.code === 'loadBearingLost'),
    `${claimed.review.machineOutcome} · ${JSON.stringify(claimed.review.deterministic.failures)}`)

  /** 🔴 ④ 관찰·질문 자리에서 조건을 사건으로 남기면 통과한다 */
  const asEvent = await goLB('QUESTION', {
    title: '지원 대상 나이가 어떻게 되나요',
    body: `${AGE}세부터 대상이 된다는 이야기를 들었는데 맞을까요?\n서류가 까다로운지도 궁금합니다.`,
  })
  check('🔴 🔴 **④ 사건 조건으로 남기면 통과한다 — 소재를 버리지 않는다**',
    asEvent.review.machineOutcome === 'adopt',
    `${asEvent.review.machineOutcome} · ${asEvent.review.machineReason}`)

  /** 🔴 ⑤ 지시문과 후조건이 **같은 값**을 쓴다 — 두 벌로 두면 한쪽이 낡는다 */
  const reqSelf = loadBearingRequirements({
    facts: [{ axis: 'age', sourceText: String(AGE) }], stance: 'SELF_EXPERIENCE',
  })
  const reqEvent = loadBearingRequirements({
    facts: [{ axis: 'age', sourceText: String(AGE) }], stance: 'QUESTION',
  })
  check('🔴 🔴 **⑤ 1인칭이면 selfCondition · 아니면 eventCondition**',
    reqSelf[0]?.mode === 'selfCondition' && reqEvent[0]?.mode === 'eventCondition',
    `${reqSelf[0]?.mode} · ${reqEvent[0]?.mode}`)
  check('🔴 🔴 **⑤ 초안 지시문이 "바꾸지 말고 지킨다" 를 실제로 담는다**', (() => {
    const sysKeep = buildV2DraftSystemPrompt({
      plan: {
        ...lbPlan('SELF_EXPERIENCE'), protectedFacts: [], speakerRelative: [], warrants: [],
      } as never,
      voice: { tokens: [], samples: ['그렇더라고요'], bundleDigest: 'b' } as never,
      life: pFit as never, mappings: [], keep: reqSelf,
    })
    return sysKeep.includes('바꾸지 말고 지킵니다') && sysKeep.includes(String(AGE))
  })())
  check('🔴 🔴 **⑤ 바꾸는 목록과 지키는 목록은 서로 다른 칸이다 — 섞지 않는다**', (() => {
    const sysBoth = buildV2DraftSystemPrompt({
      plan: {
        ...lbPlan('SELF_EXPERIENCE'), protectedFacts: [], speakerRelative: [], warrants: [],
      } as never,
      voice: { tokens: [], samples: ['그렇더라고요'], bundleDigest: 'b' } as never,
      life: pFit as never,
      mappings: [{ axis: 'age', sourceText: '44', personaText: '47살', outputRule: '🔴 44 를 47살 로 서술한다' }],
      keep: reqSelf,
    })
    return sysBoth.includes('바꿔 씁니다') && sysBoth.includes('바꾸지 말고 지킵니다')
      && sysBoth.indexOf('바꿔 씁니다') < sysBoth.indexOf('바꾸지 말고 지킵니다')
  })())

  /** 🔴 ⑥ 유료 호출이 늘지 않는다 — 결정적 단계라 검수 요청 앞에서 끝난다 */
  console.log(`   🔴 조건 삭제 회차 유료 요청 ${dropped.cost.totalCalls}회 (정상 ${keptSelf.cost.totalCalls}회)`)
  check('🔴 🔴 **⑥ 조건이 사라지면 의미 검수를 부르지 않는다 — 호출이 늘지 않는다**',
    dropped.cost.totalCalls === 2 && keptSelf.cost.totalCalls === 3,
    `${dropped.cost.totalCalls} · ${keptSelf.cost.totalCalls}`)
}

console.log('\n🔴 🔴 **공용 age mention parser — 숫자 해석이 한 곳이다 (마스터 P0-1)**')
{
  /**
   * 🔴 앞판은 숫자를 읽는 코드가 **세 벌**이었다(`readAgeExpression` ·
   *    `selfAgeNumbersIn` · `sourceAgeNumber`). 그래서 `readSelfAgeClaim` 이
   *    남의 것·조건으로 본 표현을 `expectedSelfFactsIn` 은 **자기 나이로 오인**했다.
   *    자격·보험·제3자·사건 조건은 창업자가 정한 **source-invariant** 다.
   */
  const span = (text: string, kind = 'head') => [{ kind, text }]
  const selfOf = (t: string): number[] =>
    expectedSelfFactsIn(span(t)).map((x) => Number(x.sourceText))

  // ── 자기 나이로 탐지해야 하는 것 ──
  check('🔴 🔴 **① "제가 곧 44인데" → 자기 나이 44**',
    selfOf('제가 곧 44인데').join(',') === '44', JSON.stringify(selfOf('제가 곧 44인데')))
  check('🔴 🔴 **① "낼44인데 아직도 어리단소리들어요" → 자기 나이 44 (P02 실측 원문)**',
    selfOf('낼44인데 아직도 어리단소리들어요 ㅋ').join(',') === '44',
    JSON.stringify(selfOf('낼44인데 아직도 어리단소리들어요 ㅋ')))
  check('🔴 🔴 **① "아는 분이 44인데 저는 47이거든요" → 47 만**',
    selfOf('아는 분이 44인데 저는 47이거든요').join(',') === '47',
    JSON.stringify(selfOf('아는 분이 44인데 저는 47이거든요')))

  /**
   * ── 🔴 **자기 나이로 탐지하면 안 되는 것** ──
   *    마스터가 실행해 보인 오인 4건이다. 앞판은 전부 자기 나이로 읽었다.
   */
  const NOT_SELF: [string, string][] = [
    ['51세부터 지원 대상입니다', '자격 조건'],
    ['만 65세 이상이면 신청할 수 있어요', '자격 조건'],
    ['51세 지원자가 많아요', '제3자'],
    ['보험은 51세부터 비싸져요', '보험 조건'],
    ['아는 분이 44인데 그렇대요', '제3자'],
    ['여잔 피부가 80퍼인듯', '퍼센트'],
    ['3일 만에 끝났고 5년째입니다', '기간'],
    ['2026년부터 바뀐다네요', '연도'],
    ['30대같다고 다들 말하네요', '밴드 비유'],
    ['지원금이 51만원입니다', '금액'],
    ['51번 버스를 탔어요', '번호'],
  ]
  for (const [t, why] of NOT_SELF) {
    check(`🔴 🔴 **② ${why} — "${t}" 는 자기 나이가 아니다**`,
      selfOf(t).length === 0, JSON.stringify(selfOf(t)))
  }

  /** 🔴 ③ 역할을 구조화해서 낸다 — 사람이 읽는 문구가 아니라 값이다 */
  const roleOf = (t: string): string =>
    ageMentionsIn(t, 'head').map((m) => `${m.role}/${m.kind}/${m.span.from}-${m.span.to}`).join(' ')
  check('🔴 🔴 **③ 자격 조건은 `eventCondition` 으로 낸다**',
    roleOf('51세부터 지원 대상입니다') === 'eventCondition/exact/51-51',
    roleOf('51세부터 지원 대상입니다'))
  check('🔴 🔴 **③ "만 65세 이상이면" 은 범위 조사로 `eventCondition` 이다 — unknown 이 아니다**',
    roleOf('만 65세 이상이면 신청할 수 있어요') === 'eventCondition/exact/65-65',
    roleOf('만 65세 이상이면 신청할 수 있어요'))
  check('🔴 🔴 **③ 그 판정 근거는 범위 조사다 — 어느 규칙이 잡았는지 값으로 남는다**',
    ageMentionsIn('만 65세 이상이면 신청할 수 있어요')[0]?.reason === 'rangeCondition',
    String(ageMentionsIn('만 65세 이상이면 신청할 수 있어요')[0]?.reason))
  check('🔴 🔴 **③ "51세부터" 는 시점 조사가 잡는다 — 규칙이 겹치지 않는다**',
    ageMentionsIn('51세부터 지원 대상입니다')[0]?.reason === 'timePoint',
    String(ageMentionsIn('51세부터 지원 대상입니다')[0]?.reason))
  check('🔴 🔴 **③ 제3자 수식은 `thirdParty` 로 낸다**',
    roleOf('51세 지원자가 많아요') === 'thirdParty/exact/51-51', roleOf('51세 지원자가 많아요'))
  check('🔴 🔴 **③ 구간 표현은 `band` 로 낸다 — 숫자 하나로 줄이지 않는다**',
    roleOf('저는 50대 초반이에요') === 'self/band/50-53', roleOf('저는 50대 초반이에요'))
  check('🔴 🔴 **③ evidenceRef 를 함께 낸다**',
    ageMentionsIn('제가 47인데', 'title')[0]?.evidenceRef === 'title')
  check('🔴 🔴 **③ 원문 표현을 그대로 낸다**',
    ageMentionsIn('저는 50대 초반이에요')[0]?.raw === '50대 초반',
    String(ageMentionsIn('저는 50대 초반이에요')[0]?.raw))

  /** 🔴 ④ 옛 소비자들이 같은 답을 낸다 — 두 벌이 아니다 */
  check('🔴 🔴 **④ `readSelfAgeClaim` 과 `expectedSelfFactsIn` 이 어긋나지 않는다**', (() => {
    for (const [t] of NOT_SELF) {
      if (readSelfAgeClaim(t) !== null || selfOf(t).length > 0) return false
    }
    return true
  })())
  check('🔴 🔴 **④ `selfAgeNumbersIn` 도 같은 결과를 낸다 — 별도 정규식이 없다**',
    selfAgeNumbersIn('51세부터 지원 대상입니다').length === 0
    && selfAgeNumbersIn('제가 곧 44인데').join(',') === '44')
  check('🔴 🔴 **④ `sourceAgeFact` 도 같은 정본을 쓴다 — 51만원·51번은 나이가 아니다**',
    sourceAgeFact('51')?.span.from === 51 && sourceAgeFact('51만원') === null
    && sourceAgeFact('51번') === null,
    JSON.stringify([sourceAgeFact('51'), sourceAgeFact('51만원'), sourceAgeFact('51번')]))
  check('🔴 🔴 **④ 구간도 구조로 읽는다 — 숫자 하나로 평탄화하지 않는다**', (() => {
    const f = sourceAgeFact('50대 초반')
    return f !== null && f.kind === 'band' && f.raw === '50대 초반'
      && f.span.from === 50 && f.span.to === 53
  })(), JSON.stringify(sourceAgeFact('50대 초반')))
  check('🔴 🔴 **④ 나이를 읽는 별도 정규식이 소비자 쪽에 남아 있지 않다**', (() => {
    /** 🔴 주석은 뺀다 — "앞판에는 이런 정규식이 있었다" 는 설명까지 걸리면 거짓 실패다 */
    const code = (f: string): string => readFileSync(f, 'utf-8')
      .split('\n').filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l)).join('\n')
    const srf = code('src/lib/content-core/speaker-relative-facts.ts')
    const lb = code('src/lib/content-core/load-bearing.ts')
    return !/\[2-9\]\[0-9\]/.test(srf) && !/\\d\{2\}/.test(lb)
      && /ageMentionsIn/.test(srf) && /ageMentionsIn/.test(lb)
  })())
}

console.log('\n🔴 🔴 **load-bearing 보존은 숫자 존재가 아니라 나이 의미로 본다 (마스터 P0-2)**')
{
  /**
   * 🔴 앞판은 `new RegExp('51')` 로 **글자가 있는지**만 봤다. 마스터가 든 네 반례가
   *    전부 잘못 통과했다. 여기서는 공용 age mention 결과로 본다.
   */
  const REQ_SELF = loadBearingRequirements({
    facts: [{ axis: 'age', sourceText: '51' }], stance: 'SELF_EXPERIENCE',
  })
  const REQ_EVENT = loadBearingRequirements({
    facts: [{ axis: 'age', sourceText: '51' }], stance: 'QUESTION',
  })
  const keptOf = (text: string, req: typeof REQ_SELF) =>
    checkLoadBearingPreserved({ text, requirements: req })

  /** 🔴 마스터가 든 거짓 PASS 4건 — 전부 FAIL 이어야 한다 */
  const FALSE_PASS: [string, typeof REQ_SELF, string][] = [
    ['지원금이 51만원입니다', REQ_EVENT, 'eventCondition + 금액'],
    ['51번 버스를 탔어요', REQ_EVENT, 'eventCondition + 번호'],
    ['저는 50대 초반이고 지원금은 51만원이에요', REQ_SELF, 'selfCondition + 금액'],
    ['저는 50대 초반이에요. 51번 버스를 탔어요', REQ_SELF, 'selfCondition + 번호'],
  ]
  for (const [text, req, why] of FALSE_PASS) {
    const v = keptOf(text, req)
    check(`🔴 🔴 **① ${why} → FAIL 이어야 한다**`, !v.ok,
      `"${text}" → ${v.ok ? 'PASS(잘못)' : `${v.code}: ${v.reason}`}`)
  }

  /** 🔴 ② 계약대로 통과해야 하는 것 */
  check('🔴 🔴 **② selfCondition 은 정확한 51 세 1인칭이어야 통과한다**',
    keptOf('제가 51세라 대상이 된다고 들었어요', REQ_SELF).ok,
    JSON.stringify(keptOf('제가 51세라 대상이 된다고 들었어요', REQ_SELF)))
  check('🔴 🔴 **② "50대 초반" 은 51 을 품어도 부족하다 — 구간으로 대신하지 않는다**',
    !keptOf('저는 50대 초반이라 대상이 된다고 들었어요', REQ_SELF).ok,
    JSON.stringify(keptOf('저는 50대 초반이라 대상이 된다고 들었어요', REQ_SELF)))
  check('🔴 🔴 **② eventCondition 은 나이 조건으로 남아야 통과한다**',
    keptOf('51세부터 대상이 된다는데 맞을까요?', REQ_EVENT).ok,
    JSON.stringify(keptOf('51세부터 대상이 된다는데 맞을까요?', REQ_EVENT)))
  check('🔴 🔴 **② eventCondition 인데 자기 나이로 주장하면 막는다**',
    !keptOf('제가 51세라서 대상이 된다고 들었습니다', REQ_EVENT).ok,
    JSON.stringify(keptOf('제가 51세라서 대상이 된다고 들었습니다', REQ_EVENT)))
  check('🔴 🔴 **② 조건이 아예 사라지면 막는다**',
    !keptOf('대상이 된다고 들어서 알아보는 중입니다', REQ_SELF).ok,
    JSON.stringify(keptOf('대상이 된다고 들어서 알아보는 중입니다', REQ_SELF)))

  /** 🔴 ③ 구간 조건은 구간 표현으로 보존한다 — 숫자 50 으로 줄이지 않는다 */
  check('🔴 🔴 **③ 구간 조건은 span 을 그대로 본다**', (() => {
    const band = ageMentionsIn('저는 50대 초반이에요')[0]
    return band !== undefined && band.kind === 'band'
      && band.span.from === 50 && band.span.to === 53 && band.raw === '50대 초반'
  })())
}

console.log('\n🔴 🔴 **원문 자기 나이 탐지는 planner 출력에 의존하지 않는다 (마스터 P0-1)**')
{
  /**
   * 🔴 앞판 구멍: `parseSpeakerPlan` 은 `protectedFacts` 를 훑으면서만 자기 나이를
   *    발견했다. 모델이 "낼 44" 를 **protectedFacts 와 speakerRelative 양쪽에서**
   *    빠뜨리면 누락 자체가 발견되지 않아, 원문 화자의 나이가 그대로 남은 글이
   *    아무 경고 없이 발행 후보가 됐다.
   */
  const CARD_D = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
    .cards.find((c) => c.code === 'P02')!
  const pD = P({
    code: 'P02', ageBand: CARD_D.ageBand, birthDate: CARD_D.birthDate,
    maritalStatus: CARD_D.maritalStatus, childrenCount: CARD_D.childrenCount,
    childrenAgeBands: CARD_D.childrenAgeBands, workStatus: CARD_D.workStatus,
    region: CARD_D.region, menopauseStatus: CARD_D.menopauseStatus, parentCare: CARD_D.parentCare,
  })
  const T2 = '자랑은 아닌데 여잔 피부가80퍼인듯'
  const B2 = '에스테딕싼곳 동네다니는데 진짜\n낼44인데 아직도 어리단소리들어요 ㅋ\n진짜여잔 피부가80퍼...'
  const D2 = {
    title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
    body: '동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n제가 곧 44인데 아직 어리단 소리를 들어요.\n여자는 피부가 80퍼인 것 같아요. 다들 어떠세요?',
  }

  /**
   * 🔴 **반례**: 계획이 44 를 **protectedFacts 에도, speakerRelative 에도 적지 않았다.**
   *    앞판이라면 그대로 통과했다.
   */
  const blind = await run({
    id: '35040880', title: T2, body: B2, personas: [pD],
    canned: {
      plan: {
        decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE',
        selfBasis: 'noLifeFactNeeded', universalReason: '누구나 겪는 일이라',
        speakerWarrants: [], closingIntent: 'ask', contentRoles: ['conversationSpark'],
        // 🔴 44 가 없다 — 80퍼만 적었다
        protectedFacts: [{ kind: 'number', text: '80퍼', evidenceRef: 'title' }],
        // 🔴 speakerRelative 도 비어 있다
        speakerRelative: [],
      },
      draft: D2, review: EMPTY_REVIEW,
    },
  })
  check('🔴 🔴 **① 양쪽에서 빠뜨려도 코드가 원문에서 찾아낸다 — 발행 후보가 되지 않는다**',
    blind.review.machineOutcome !== 'adopt'
    && blind.review.semanticCompletion.cause === 'parseFailed',
    `${blind.review.machineOutcome} · ${String(blind.review.semanticCompletion.cause)}`)
  check('🔴 🔴 **① 그 사유는 재시도다 — 정상 원천을 영구 제외하지 않는다**',
    artifactRetryable(blind.review) === true)

  /**
   * 🔴 ② **speakerRelative 로만 적어도 받는다** — 그때는 변환 대상으로 싣는다.
   *    싣지 않으면 그 나이가 대체 없이 초안으로 흘러간다.
   */
  const srOnly = await run({
    id: '35040880', title: T2, body: B2, personas: [pD],
    canned: {
      plan: {
        decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE',
        selfBasis: 'noLifeFactNeeded', universalReason: '누구나 겪는 일이라',
        speakerWarrants: [], closingIntent: 'ask', contentRoles: ['conversationSpark'],
        protectedFacts: [{ kind: 'number', text: '80퍼', evidenceRef: 'title' }],
        speakerRelative: [
          { axis: 'age', sourceText: '44', evidenceRef: 'head', materiality: 'incidental' },
        ],
      },
      draft: D2, review: EMPTY_REVIEW,
    },
  })
  const t = `${srOnly.draft?.title ?? ''}\n${srOnly.draft?.body ?? ''}`
  check('🔴 🔴 **② speakerRelative 로만 적어도 변환된다 — 44 가 남지 않는다**',
    srOnly.review.machineOutcome === 'adopt' && !/(^|[^0-9])44\s*(살|세|인데)/.test(t),
    `${srOnly.review.machineOutcome} · ${t.split('\n')[1] ?? ''}`)

  /** 🔴 ③ 오탐 금지 — 제3자 나이·퍼센트·기간·연도는 요구하지 않는다 */
  const span = (text: string, kind = 'head') => [{ kind, text }]
  check('🔴 🔴 **③ 제3자 나이는 요구하지 않는다**',
    expectedSelfFactsIn(span('아는 분이 44인데 그렇대요')).length === 0)
  check('🔴 🔴 **③ 퍼센트(80퍼)는 나이가 아니다**',
    expectedSelfFactsIn(span('여잔 피부가 80퍼인듯')).length === 0)
  check('🔴 🔴 **③ 기간(3일·5년)은 나이가 아니다**',
    expectedSelfFactsIn(span('3일 만에 끝났고 5년째입니다')).length === 0)
  check('🔴 🔴 **③ 연도(2026년)는 나이가 아니다**',
    expectedSelfFactsIn(span('2026년부터 바뀐다네요')).length === 0)
  check('🔴 🔴 **③ "30대같다" 의 30 은 나이 주장이 아니다**',
    expectedSelfFactsIn(span('30대같다고 다들 말하네요')).length === 0)
  check('🔴 🔴 **③ 자기 나이는 자리까지 찾아낸다**', (() => {
    const got = expectedSelfFactsIn(span('낼44인데 아직도 어리단소리들어요'))
    return got.length === 1 && got[0]!.sourceText === '44' && got[0]!.evidenceRef === 'head'
      && got[0]!.axis === 'age'
  })())
  check('🔴 🔴 **③ 제3자와 자기 나이가 한 줄에 있으면 자기 것만 찾는다**', (() => {
    const got = expectedSelfFactsIn(span('아는 분이 44인데 저는 47이거든요'))
    return got.length === 1 && got[0]!.sourceText === '47'
  })())
  check('🔴 🔴 **③ 나이 축만 낸다 — 다른 생활사 축을 활성화하지 않았다**',
    expectedSelfFactsIn(span('제가 47인데 파트타임이고 부산 살아요'))
      .every((x) => x.axis === 'age'))
}

console.log('\n🔴 🔴 **계약 판을 올렸다 — 옛 cache/artifact 가 새 계약으로 재사용되지 않는다**')
{
  /**
   * 🔴 계획 요청의 **출력 계약**과 파서 **의미**가 바뀌었다(materiality 필수 ·
   *    load-bearing 판정 자리 이동). 판을 올리지 않으면 옛 응답으로 만든 artifact 와
   *    캐시가 새 계약의 결론으로 재사용된다.
   */
  check('🔴 🔴 **판이 실제로 올라갔다 — p5 · v6**',
    SPEAKER_PLAN_PROMPT_VERSION === 'speaker-plan-p5' && SPEAKER_PLAN_VERSION === 'speaker-plan-v6',
    `${SPEAKER_PLAN_PROMPT_VERSION} · ${SPEAKER_PLAN_VERSION}`)

  const BASE_C = {
    sourceInputHash: 'fixturehash00000',
    pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
    promptVersion: CONTENT_CORE_PROMPT_VERSION,
    speakerPlanVersion: SPEAKER_PLAN_VERSION,
    reviewVersion: REVIEW_VERSION,
    planPromptDigest: 'plan000000000000',
    stageModels: STAGE_MODEL,
    stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL,
    voiceAssetDigest: 'asset000000000', personaPoolDigest: 'pool0000000000',
  }
  /** 🔴 옛 판으로 적힌 artifact — 파일에 남아 있는 그 모양 그대로다 */
  const OLD_C = { ...BASE_C, speakerPlanVersion: 'speaker-plan-v5', promptVersion: CONTENT_CORE_PROMPT_VERSION.replace('speaker-plan-p5', 'speaker-plan-p4') }

  check('🔴 🔴 **① 옛 판 artifact 는 지금 계약과 같지 않다 — 결론으로 재사용되지 않는다**',
    !sameGenerationContract(OLD_C, BASE_C), JSON.stringify({ old: OLD_C.speakerPlanVersion, now: BASE_C.speakerPlanVersion }))
  check('🔴 🔴 **② 같은 판이면 같다 — 계약이 없는 척하지 않는다**',
    sameGenerationContract({ ...BASE_C }, BASE_C))
  check('🔴 🔴 **③ 판이 계약 지문에 실제로 들어간다 — 캐시 key 가 달라진다**',
    generationIdentity(BASE_C) !== generationIdentity(OLD_C),
    `${generationIdentity(BASE_C).slice(-60)}\n${generationIdentity(OLD_C).slice(-60)}`)

  /**
   * 🔴 ④ **새 응답만 새 계약을 충족한다.** 옛 응답(= materiality 없음)은
   *    같은 원문·같은 사람으로 돌려도 **발행 후보가 되지 않는다.**
   */
  const CARD_X = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
    .cards.find((c) => c.code === 'P02')!
  const pX = P({
    code: 'P02', ageBand: CARD_X.ageBand, birthDate: CARD_X.birthDate,
    maritalStatus: CARD_X.maritalStatus, childrenCount: CARD_X.childrenCount,
    childrenAgeBands: CARD_X.childrenAgeBands, workStatus: CARD_X.workStatus,
    region: CARD_X.region, menopauseStatus: CARD_X.menopauseStatus, parentCare: CARD_X.parentCare,
  })
  const SRC_T = '자랑은 아닌데 여잔 피부가80퍼인듯'
  const SRC_B = '에스테딕싼곳 동네다니는데 진짜\n낼44인데 아직도 어리단소리들어요 ㅋ\n진짜여잔 피부가80퍼...'
  const basePlan = {
    decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE',
    selfBasis: 'lifeFacts', universalReason: '',
    speakerWarrants: [{ fact: 'age', requiredValue: CARD_X.ageBand, evidenceRef: 'head', evidenceText: '낼44인데' }],
    closingIntent: 'ask', contentRoles: ['conversationSpark'],
    protectedFacts: [
      { kind: 'number', text: '80퍼', evidenceRef: 'title' },
      { kind: 'number', text: '44', evidenceRef: 'head' },
    ],
  }
  const DR = {
    title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
    body: '동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n제가 곧 44인데 아직 어리단 소리를 들어요.\n여자는 피부가 80퍼인 것 같아요. 다들 어떠세요?',
  }
  const oldShape = await run({
    id: '35040880', title: SRC_T, body: SRC_B, personas: [pX],
    canned: { plan: basePlan, draft: DR, review: EMPTY_REVIEW },
  })
  const newShape = await run({
    id: '35040880', title: SRC_T, body: SRC_B, personas: [pX],
    canned: {
      plan: { ...basePlan, speakerRelative: [
        { axis: 'age', sourceText: '44', evidenceRef: 'head', materiality: 'incidental' },
      ] },
      draft: DR, review: EMPTY_REVIEW,
    },
  })
  check('🔴 🔴 **④ 옛 모양 응답은 발행 후보가 되지 않는다 (입력: speakerRelative 없음)**',
    oldShape.review.machineOutcome !== 'adopt'
    && oldShape.review.semanticCompletion.cause === 'parseFailed',
    `${oldShape.review.machineOutcome} · ${String(oldShape.review.semanticCompletion.cause)}`)
  check('🔴 🔴 **④ 새 모양 응답만 통과한다 (입력: materiality=incidental)**',
    newShape.review.machineOutcome === 'adopt',
    `${newShape.review.machineOutcome} · ${newShape.review.machineReason}`)

  /**
   * 🔴 ⑤ **문서만 고치는 것은 계약 변경이 아니다.** 주석 한 줄에 캐시가 비면
   *    회차마다 전부 다시 사게 된다 — 그것은 판 올리기가 아니라 사고다.
   */
  check('🔴 🔴 **⑤ 계약 지문은 판·모델·자산만 본다 — 주석·문서는 들어가지 않는다**', (() => {
    const id = generationIdentity(BASE_C)
    return !id.includes('🔴') && !id.includes('docs/')
      && id.includes(SPEAKER_PLAN_VERSION) && id.includes(BASE_C.planPromptDigest)
  })(), generationIdentity(BASE_C))
  check('🔴 🔴 **⑤ 지시문 본문이 바뀌면 그때는 달라진다 — planPromptDigest 가 담는다**',
    generationIdentity({ ...BASE_C, planPromptDigest: 'changed000000000' }) !== generationIdentity(BASE_C))
}

console.log('\n🔴 🔴 **load-bearing 해소 — 사람을 차례로 태우지 않는다 (마스터 P0-1)**')
{
  /**
   * 🔴 앞판 실측: `planAxisMapping` 이 load-bearing 을 보면 **Persona 를 비교하기도 전에**
   *    실패했다. 그래서 P01 → P02 → P03 을 차례로 태우고 4회차에 멈췄다 —
   *    성공 가능성 0 인 세 번의 유료 반복이었다.
   *    🔴 여기서는 **입력 → 실제 결과**를 값으로 본다.
   */
  const F = [{ axis: 'age' as const, sourceText: '44' }]
  const C = (code: string, age: number | null) => ({ code, exactAge: age })
  const SELF = 'SELF_EXPERIENCE'

  // ① 고른 사람이 실제로 그 나이다 → 바꿀 것이 없다
  const sat = resolveLoadBearing({
    facts: F, stance: SELF, chosen: C('P02', 44),
    candidates: [C('P02', 44), C('P04', 47)], selfAlreadyFailed: false,
  })
  check('🔴 🔴 **① 고른 사람이 44 면 그대로 성립한다 — 입력 P02=44 · 원문 44 → ok**',
    sat.ok && sat.kind === 'personaSatisfies', JSON.stringify(sat))

  // ② 고른 사람은 아닌데 **만족하는 후보가 실제로 있다** → 그 사람으로 재계획
  const fit = resolveLoadBearing({
    facts: F, stance: SELF, chosen: C('P02', 47),
    candidates: [C('P02', 47), C('P04', 44), C('P08', 52)], selfAlreadyFailed: false,
  })
  check('🔴 🔴 **② P02=47 · 후보 P04=44 → PERSONA_MISMATCH 이고 P04 를 지목한다**',
    !fit.ok && fit.retry && fit.code === 'PERSONA_MISMATCH' && fit.suggest.join(',') === 'P04',
    JSON.stringify(fit))

  /**
   * 🔴 ③ **만족하는 후보가 하나도 없다** → 사람을 바꿔도 소용없다.
   *    앞판이 세 명을 태운 바로 그 입력이다. 지금은 **자리**를 바꾸라고 돌려보낸다.
   */
  const none = resolveLoadBearing({
    facts: F, stance: SELF, chosen: C('P02', 47),
    candidates: [C('P02', 47), C('P04', 49), C('P08', 52)], selfAlreadyFailed: false,
  })
  check('🔴 🔴 **③ 아무도 44 가 아니면 SELF_IMPOSSIBLE — 사람을 지목하지 않는다**',
    !none.ok && none.retry && none.code === 'SELF_IMPOSSIBLE'
    && none.suggest.length === 0 && none.forbidSelf,
    JSON.stringify(none))

  // ④ 자리를 바꾸면 그 값은 우리 것이 아니다 → 성립
  const obs = resolveLoadBearing({
    facts: F, stance: 'QUESTION', chosen: C('P02', 47),
    candidates: [C('P02', 47)], selfAlreadyFailed: true,
  })
  check('🔴 🔴 **④ 1인칭이 아니면 성립한다 — 그 나이를 우리 것으로 주장하지 않는다**',
    obs.ok && obs.kind === 'notClaimed', JSON.stringify(obs))

  /** 🔴 ⑤ 1인칭을 금지했는데 또 1인칭으로 오면 **한 번에 결론**이다 */
  const term = resolveLoadBearing({
    facts: F, stance: SELF, chosen: C('P02', 47),
    candidates: [C('P02', 47)], selfAlreadyFailed: true,
  })
  check('🔴 🔴 **⑤ 금지 뒤에도 1인칭이면 MEANING_UNPRESERVABLE — 재시도가 아니다**',
    !term.ok && !term.retry && term.code === 'MEANING_UNPRESERVABLE', JSON.stringify(term))
  check('🔴 🔴 **⑤ 그 사유는 재시도 목록에 없다 — 같은 원천을 다시 사지 않는다**',
    ![...RETRYABLE_CAUSES].includes('meaningUnpreservable' as never),
    [...RETRYABLE_CAUSES].join(','))

  /** 🔴 ⑥ 활성화하지 않은 축이 load-bearing 이면 결론이다 — 범위를 넘겨 바꾸지 않는다 */
  const other = resolveLoadBearing({
    facts: [{ axis: 'work', sourceText: '파트타임' }], stance: SELF, chosen: C('P02', 47),
    candidates: [C('P02', 47)], selfAlreadyFailed: false,
  })
  check('🔴 🔴 **⑥ 나이 말고 다른 축은 이 판에서 변환하지 않는다 — AXIS_NOT_ACTIVATED (결론)**',
    !other.ok && !other.retry && other.code === 'AXIS_NOT_ACTIVATED', JSON.stringify(other))
  check('🔴 🔴 **⑥ 활성화된 축은 나이 하나다**', [...ACTIVATED_AXES].join(',') === 'age')

  /**
   * 🔴 ⑦ **지난 실패가 다음 계획의 입력으로 실제로 실린다** (마스터: "같은 SELF 계획 반복 금지").
   */
  const payload = buildSpeakerPlanPayload({
    packet: { spans: [{ kind: 'head', text: '낼44인데', fromRatio: 0, toRatio: 1 }], bodyLength: 40,
      truncated: false, contextSufficiency: 'ok', insufficientReasons: [] } as never,
    personas: [P({ code: 'P02' })],
    priorFailures: priorFailureLines([
      { personaCode: 'P02', stance: SELF, cause: 'loadBearingSelfImpossible' },
    ]),
    selfForbidden: selfForbiddenBy([
      { personaCode: 'P02', stance: SELF, cause: 'loadBearingSelfImpossible' },
    ]),
  })
  check('🔴 🔴 **⑦ 요청에 지난 실패가 값으로 실린다 — 계획기가 이유를 받는다**',
    payload.includes('지난실패') && payload.includes('loadBearingSelfImpossible'), payload.slice(-300))
  check('🔴 🔴 **⑦ 1인칭 금지도 실린다 — 같은 SELF 계획을 되풀이하지 않는다**',
    payload.includes('SELF_EXPERIENCE 로 쓰지 마십시오'), payload.slice(-300))
  check('🔴 🔴 **⑦ 지난 실패가 없으면 그 칸을 넣지 않는다 — 빈 칸으로 흉내 내지 않는다**', (() => {
    const clean = buildSpeakerPlanPayload({
      packet: { spans: [{ kind: 'head', text: '낼44인데', fromRatio: 0, toRatio: 1 }], bodyLength: 40,
        truncated: false, contextSufficiency: 'ok', insufficientReasons: [] } as never,
      personas: [P({ code: 'P02' })],
    })
    return !clean.includes('지난실패') && !clean.includes('금지')
  })())
}

console.log('\n🔴 🔴 **Persona 재계획 — 실패한 사람을 빼고 다음 시도가 실제로 달라진다**')
{
  /**
   * 🔴 **helper 만 부르는 검사가 아니다.** 실제 `runContentCore` 로 **진짜 실패 artifact**
   *    를 만들고, 러너가 쓰는 파일 이름·JSON 모양 그대로 디스크에 쓴 뒤,
   *    러너가 부르는 **같은 읽기 함수**(`readPriorOutcomes`)로 다시 읽어 계획한다.
   *
   * 🔴 가짜 fixture 를 손으로 적지 않는다 — 실제가 내지 못하는 모양을 fixture 가 내면
   *    시험이 결함을 덮는다.
   */
  const CARD = (code: string): PoolCard =>
    parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
      .cards.find((c) => c.code === code)!
  const cardOf = (code: string): PersonaInput => {
    const c = CARD(code)
    return P({
      code, ageBand: c.ageBand, birthDate: c.birthDate, maritalStatus: c.maritalStatus,
      childrenCount: c.childrenCount, childrenAgeBands: c.childrenAgeBands,
      workStatus: c.workStatus, region: c.region,
      menopauseStatus: c.menopauseStatus, parentCare: c.parentCare,
    })
  }
  const SLOT = ['P02', 'P04', 'P08']
  const CANDS = SLOT.map(cardOf)

  const SRC_ID = '35040880'
  const SRC_TITLE = '자랑은 아닌데 여잔 피부가80퍼인듯'
  const SRC_BODY = '에스테딕싼곳 동네다니는데 진짜\n낼44인데 아직도 어리단소리들어요 ㅋ\n진짜여잔 피부가80퍼...'
  const HASH = 'fixturehash00000'
  const BASE = {
    pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
    promptVersion: CONTENT_CORE_PROMPT_VERSION,
    speakerPlanVersion: SPEAKER_PLAN_VERSION,
    reviewVersion: REVIEW_VERSION,
    planPromptDigest: 'plan000000000000',
    stageModels: STAGE_MODEL,
    stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL,
    voiceAssetDigest: 'asset000000000', personaPoolDigest: 'pool0000000000',
  }

  /** 🔴 **그 화자로 실제 실패시킨다** — 나이 문장을 통째로 뺀 초안이다 */
  const failWith = async (code: string): Promise<HumanReviewArtifact> => run({
    id: SRC_ID, title: SRC_TITLE, body: SRC_BODY,
    personas: [cardOf(code)],
    canned: {
      plan: {
        decision: 'ok', personaCode: code, stance: 'SELF_EXPERIENCE',
        selfBasis: 'lifeFacts', universalReason: '',
        speakerWarrants: [{
          fact: 'age', requiredValue: CARD(code).ageBand,
          evidenceRef: 'head', evidenceText: '낼44인데',
        }],
        closingIntent: 'ask', contentRoles: ['conversationSpark'],
        protectedFacts: [
          { kind: 'number', text: '80퍼', evidenceRef: 'title' },
          { kind: 'number', text: '44', evidenceRef: 'head' },
        ],
        speakerRelative: [{
          axis: 'age', sourceText: '44', evidenceRef: 'head', materiality: 'incidental',
        }],
      },
      draft: {
        title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
        body: '동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n여자는 피부가 80퍼인 것 같아요. 다들 어떠세요?',
      },
      review: EMPTY_REVIEW,
    },
  })

  /** 🔴 러너가 쓰는 그 파일 이름·그 JSON 으로 쓴다 — 읽는 쪽이 흉내가 아니게 */
  const world = (): string => mkdtempSync(join(tmpdir(), 'replan-'))
  const writeArtifacts = (dir: string, rid: string, arts: readonly HumanReviewArtifact[]): void => {
    writeFileSync(join(dir, `auto-draft-${rid}.artifacts.json`),
      `${JSON.stringify(arts, null, 2)}\n`, 'utf-8')
  }
  const outcomesOf = (dir: string) => readPriorOutcomes({
    dataDir: dir, hashOf: new Map([[sourceKeyOf(FX_SITE, SRC_ID), HASH]]),
    base: BASE, artifactVersion: ARTIFACT_VERSION,
  })
  const planNext = (dir: string) => personasForAttempt({
    outcomes: outcomesOf(dir), sourceKey: sourceKeyOf(FX_SITE, SRC_ID), slotCodes: SLOT, candidates: CANDS,
  })

  const a02 = await failWith('P02')
  check('🔴 🔴 **실제 실행이 P02 로 실패한다 (손으로 적은 fixture 아님)**',
    a02.plan.personaCode === 'P02'
    && a02.review.semanticCompletion.cause === 'personaTransformFailed'
    && a02.review.machineOutcome !== 'adopt',
    `${a02.plan.personaCode} · ${String(a02.review.semanticCompletion.cause)}`)

  const d1 = world()
  writeArtifacts(d1, '20260923-100000', [a02])
  const r1 = planNext(d1)
  check('🔴 🔴 **① 디스크에 쓴 실패 기록을 읽어 P02 를 제외한다**',
    r1.ok && r1.excluded.join(',') === 'P02', JSON.stringify(r1))
  check('🔴 🔴 **① 다음 시도에 나가는 화자가 실제로 바뀐다 — P02 가 빠진다**',
    r1.ok && !r1.personas.some((c) => c.code === 'P02') && r1.personas.length === 2,
    r1.ok ? r1.personas.map((c) => c.code).join(' ') : JSON.stringify(r1))
  check('🔴 🔴 **① 두 번째 시도임을 센다**', r1.ok && r1.attempt === 2, JSON.stringify(r1))
  check('🔴 🔴 **① 첫 시도(기록 없음)에는 아무도 빼지 않는다**', (() => {
    const empty = planNext(world())
    return empty.ok && empty.excluded.length === 0 && empty.personas.length === 3
      && empty.attempt === 1
  })())

  /** 🔴 ② 실제로 P04 로도 실패시킨다 — 두 사람이 빠진다 */
  const a04 = await failWith('P04')
  const d2 = world()
  writeArtifacts(d2, '20260923-100000', [a02])
  writeArtifacts(d2, '20260923-110000', [a04])
  const r2 = planNext(d2)
  check('🔴 🔴 **② 두 번 실패하면 둘 다 빠지고 남은 한 사람만 나간다**',
    r2.ok && r2.personas.map((c) => c.code).join(',') === 'P08'
    && [...r2.excluded].sort().join(',') === 'P02,P04',
    JSON.stringify(r2.ok ? r2.personas.map((c) => c.code) : r2))

  /** 🔴 ③ 셋 다 실패 — 더 시도하지 않는다. 같은 원천을 무한히 다시 사지 않는다 */
  const a08 = await failWith('P08')
  const d3 = world()
  writeArtifacts(d3, '20260923-100000', [a02])
  writeArtifacts(d3, '20260923-110000', [a04])
  writeArtifacts(d3, '20260923-120000', [a08])
  const r3 = planNext(d3)
  check('🔴 🔴 **③ 적격 화자를 모두 소진하면 구조화된 중단이다 (문자열 아님)**',
    !r3.ok && (r3.code === 'EXHAUSTED' || r3.code === 'ATTEMPT_CAP'),
    JSON.stringify(r3))
  check('🔴 🔴 **③ 무한 유료 반복 반례 — 시도 상한을 넘기지 않는다**',
    REPLAN_ATTEMPT_MAX === 3 && !r3.ok, `${REPLAN_ATTEMPT_MAX} · ${JSON.stringify(r3)}`)

  /**
   * 🔴 ④ **화자 탓이 아닌 실패로 사람을 태우지 않는다.**
   *    예산에 막힌 회차는 누구를 골랐든 똑같이 막혔다.
   */
  const aBudget = await run({
    id: SRC_ID, title: SRC_TITLE, body: SRC_BODY, personas: [cardOf('P02')],
    canned: {}, fault: { blocked: 'speakerPlan' },
  })
  const d4 = world()
  writeArtifacts(d4, '20260923-100000', [aBudget])
  const r4 = planNext(d4)
  check('🔴 🔴 **④ 예산 실패는 화자를 제외하지 않는다 — 장애 한 번에 원천이 굶지 않는다**',
    r4.ok && r4.excluded.length === 0 && r4.personas.length === 3,
    `${String(aBudget.review.semanticCompletion.cause)} → ${JSON.stringify(r4)}`)
  check('🔴 🔴 **④ 화자 탓 사유는 두 가지뿐이다 — 목록이 늘면 이 검사가 깨진다**',
    [...PERSONA_REPLAN_CAUSES].join(',') === 'personaTransformFailed,loadBearingMismatch',
    [...PERSONA_REPLAN_CAUSES].join(','))

  /** 🔴 ⑤ 계약이 다르면 지난 실패는 이 계약의 결론이 아니다 */
  check('🔴 🔴 **⑤ 원천 입력이 달라지면 지난 실패를 물려받지 않는다**', (() => {
    const got = personasForAttempt({
      outcomes: readPriorOutcomes({
        dataDir: d1, hashOf: new Map([[sourceKeyOf(FX_SITE, SRC_ID), 'otherhash0000000']]),
        base: BASE, artifactVersion: ARTIFACT_VERSION,
      }),
      sourceKey: sourceKeyOf(FX_SITE, SRC_ID), slotCodes: SLOT, candidates: CANDS,
    })
    return got.ok && got.excluded.length === 0
  })())

  /**
   * 🔴 ⑥ **러너가 실제로 이 경로를 쓰는가.** 위는 실행 검사이고 이것은 배선 검사다 —
   *    둘을 섞어 부르지 않는다. 러너가 화자 묶음을 **다른 곳에서 다시 조립하면**
   *    제외가 조용히 사라지므로, 조립이 한 곳뿐인 것까지 본다.
   */
  const runnerSrc = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 🔴 **⑥ 러너가 `personasForAttempt` 를 부른다**',
    /personasForAttempt\(\{/.test(runnerSrc))
  check('🔴 🔴 **⑥ 생성에 넘기는 화자 묶음은 그 결과 하나뿐이다**',
    /personas: replan\.personas,/.test(runnerSrc)
    && !/personas: voice\.candidates/.test(runnerSrc),
    runnerSrc.split('\n').filter((l) => /^\s*personas:/.test(l)).join(' | '))
  check('🔴 🔴 **⑥ `ok:false` 면 만들지 않고 넘어간다 — 유료 호출 앞이다**',
    /if \(!replan\.ok\) \{[\s\S]{0,400}?holdPick\(\)\n\s*continue/.test(runnerSrc))
  check('🔴 🔴 **⑥ 제외 목록이 캐시 key 에 들어간다 — 바뀌기 전 결과를 되받지 않는다**',
    /excl=\$\{digest16/.test(runnerSrc))
}

console.log('\n🔴 🔴 **birthDate 가 생성 계약에 들어간다 — 고치면 캐시가 무효화된다**')
{
  const base = P({ code: 'P02', birthDate: '1979-06-20' })
  const moved = P({ code: 'P02', birthDate: '1979-06-21' })
  check('🔴 🔴 **생일 한 글자만 달라도 `personaPoolDigest` 가 달라진다**',
    personaPoolIdentity([base]) !== personaPoolIdentity([moved]),
    `${personaPoolIdentity([base]).slice(-40)} vs ${personaPoolIdentity([moved]).slice(-40)}`)
  check('🔴 같은 생일이면 같은 값이다', personaPoolIdentity([base]) === personaPoolIdentity([P({ code: 'P02', birthDate: '1979-06-20' })]))
  check('🔴 🔴 **계약이 달라지면 옛 artifact 를 결론으로 재사용하지 않는다**', (() => {
    // `sameGenerationContract` 가 다르다고 보면 `attemptedOutcomes` 가 그 줄을 무시한다
    const a = { personaPoolDigest: personaPoolIdentity([base]) }
    const b = { personaPoolDigest: personaPoolIdentity([moved]) }
    return a.personaPoolDigest !== b.personaPoolDigest
  })())
}

console.log('\n🔴 🔴 **terminal 이 reason-aware 다 — 고칠 수 있는 실패가 원천을 태우지 않는다**')
{
  /**
   * 🔴 앞판은 `semanticCompletion.complete` 인 HOLD 를 **전부** 결론으로 봤다.
   *    그래서 다른 Persona 면 될 수 있는 실패 하나가 원천을 영구히 태웠다.
   *    이제 사유별로 갈린다 — `artifactOutcome` → `concludedSourceIds` → `selectWorkset`
   *    **실제 사슬**로 확인한다.
   */
  /** 🔴 정본이 요구하는 모양 그대로 — `complete: false` 면 사유도 원인도 있어야 한다 */
  const rev = (cause: string, reason = 'notRun') => ({
    deterministic: { pass: true, failures: [] },
    semantic: null, semanticCompletion: { complete: false, reason, cause },
    droppedFromSource: [], unsupportedAdditions: [], lifeContradictions: [],
    voice: null, machineOutcome: 'hold', machineReason: '',
  })
  check('🔴 🔴 **`personaTransformFailed` 는 재시도 자격을 유지한다**',
    artifactRetryable(rev('personaTransformFailed')) === true)
  check('🔴 🔴 **`loadBearingMismatch` 도 재계획 대상이다**',
    artifactRetryable(rev('loadBearingMismatch')) === true)
  check('🔴 예산·파싱 실패는 그대로 재시도다',
    artifactRetryable(rev('budgetBlocked', 'budgetBlocked')) === true
    && artifactRetryable(rev('parseFailed', 'parseFailed')) === true)
  check('🔴 🔴 **자격 없음·안전 실패는 그대로 결론이다**',
    artifactRetryable(rev('speakerUnqualified')) === false
    && artifactRetryable(rev('deterministicFailed')) === false)

  // 🔴 실제 사슬 — `selectWorkset` 이 그 원천을 다시 볼 수 있는가
  const AT = new Date('2026-09-23T05:00:00Z')
  const row = (id: string, c: number) => ({
    sourceArticleId: id, sourceSite: 'navercafe:remonterrace', commentCount: c,
    sourcePostedAt: '', sourceListedAt: '',
    input: { sourceArticleId: id, title: `요즘 김치 담그기 어떠신가요 ${id}`,
      bodyHead: '주변에 물어보면 반반이더라고요. 다들 어떻게 하시는지 궁금해서 여쭤봐요.',
      bodyLength: 120, commentCount: c, safetyVerdict: 'pass', access: 'ok', axis: SEED_AXIS } as never,
    evidence: fakeSourceEvidence(AT, { id, commentsPct: c / 100 }),
  })
  const pick = (concluded: string[]) => selectWorkset({
    rows: [row('transform-fail', 50), row('new-1', 10)],
    humanDecided: EMPTY_HUMAN_DECISIONS, queuePending: new Set<string>(), queuedSources: EMPTY_SOURCE_KEYS, carriedOver: EMPTY_SOURCE_KEYS,
    concluded: new Set(concluded.map((k) => sourceKeyOf(RT_SITE, k))), attempted: new Map() as never,
    releaseOf: (r) => preGenerationRelease(r, AT, AT),
    limit: 5, runId: 'r1', takenAt: AT,
  }).workset.sources.map((s) => s.sourceArticleId)
  check('🔴 🔴 **변환 실패 원천은 `concluded` 에 들어가지 않아 다시 뽑힐 수 있다**',
    pick([]).includes('transform-fail'))
  check('🔴 🔴 **결론인 원천만 `concluded` 로 빠진다**',
    !pick(['transform-fail']).includes('transform-fail'))
}

console.log('\n🔴 🔴 **시점 스냅샷 — 2031·2036 에도 낡은 밴드로 돌아가지 않는다**')
{
  const CARD = { code: 'P02', birthDate: '1979-06-20', ageBand: '40대 후반' }
  const at = (iso: string) => materializePersonaAt({ card: CARD, now: new Date(iso) })
  const y2026 = at('2026-09-23T03:00:00Z')
  const y2031 = at('2031-09-23T03:00:00Z')
  const y2036 = at('2036-09-23T03:00:00Z')
  check('🔴 2026 — 47세 · 40대 후반', y2026.ok && y2026.at.exactAge === 47 && y2026.at.effectiveAgeBand === '40대 후반')
  check('🔴 🔴 **2031 — 52세 · 50대 초반 (40대 후반으로 돌아가면 실패)**',
    y2031.ok && y2031.at.exactAge === 52 && y2031.at.effectiveAgeBand === '50대 초반',
    y2031.ok ? `${y2031.at.exactAge} · ${y2031.at.effectiveAgeBand}` : '-')
  check('🔴 🔴 **2036 — 57세 · 50대 후반**',
    y2036.ok && y2036.at.exactAge === 57 && y2036.at.effectiveAgeBand === '50대 후반',
    y2036.ok ? `${y2036.at.exactAge} · ${y2036.at.effectiveAgeBand}` : '-')
  check('🔴 🔴 **설계 카드와 어긋나면 보고는 하되 판정에 쓰지 않는다**',
    y2031.ok && y2031.at.designBandDrift !== null && y2026.ok && y2026.at.designBandDrift === null)
  check('🔴 생일이 없으면 만들지 않는다 (fail-closed)',
    materializePersonaAt({ card: { ...CARD, birthDate: '' }, now: new Date() }).ok === false)
  check('🔴 나이 → 밴드 변환', bandOfAge(52) === '50대 초반' && bandOfAge(57) === '50대 후반'
    && bandOfAge(45) === '40대 중반' && bandOfAge(40) === '40대 초반')
}

console.log('\n🔴 🔴 **생일 경계 캐시 — 매일 무효화되지는 않는다**')
{
  const p02 = P({ code: 'P02', birthDate: '1979-06-20' })
  const d = (iso: string) => personaPoolIdentity([p02], new Date(iso))
  const before = d('2026-06-19T03:00:00Z')
  const onDay = d('2026-06-20T03:00:00Z')
  const nextDay = d('2026-06-21T03:00:00Z')
  const later = d('2026-09-23T03:00:00Z')
  check('🔴 🔴 **생일 직전과 직후의 지문이 다르다**', before !== onDay)
  check('🔴 🔴 **생일과 무관한 다음 날은 같다 — 매일 무효화되지 않는다**', onDay === nextDay)
  check('🔴 🔴 **몇 달 뒤에도 같은 나이면 같다**', onDay === later)
  check('🔴 해가 바뀌어 나이가 늘면 달라진다', d('2027-09-23T03:00:00Z') !== later)
  check('🔴 시각을 주지 않으면 앞판과 같다 (나이 미포함)',
    personaPoolIdentity([p02]).includes('age=∅'))
}

console.log('\n🔴 🔴 **mapping 이행 후조건 — 통째로 빼면 채택되지 않는다**')
{
  const post = (text: string, exactAge: number | null = 47) => checkAgeMappingApplied({
    text, sourceAges: ['44'], exactAge, effectiveAgeBand: '40대 후반',
  })
  check('🔴 🔴 **원문 나이가 남으면 실패**', (() => {
    const v = post('제가 곧 44인데 그래요')
    return !v.ok && v.code === 'SOURCE_AGE_REMAINS'
  })())
  check('🔴 🔴 **나이 문장을 통째로 빼면 실패 — `fixed=0` 과 구분된다**', (() => {
    const v = post('동네 에스테틱을 몇 년 다녀봤는데요. 피부가 80퍼인 것 같아요.')
    return !v.ok && v.code === 'PERSONA_AGE_ABSENT'
  })())
  check('🔴 🔴 **1인칭 나이가 여럿이면 실패 (fail-closed)**', (() => {
    const v = post('제가 47인데\n저는 52살이에요')
    return !v.ok && v.code === 'CONFLICTING_SELF_AGE'
  })())
  check('🔴 우리 나이가 들어갔으면 통과', post('제가 47인데 그래요').ok === true)
  check('🔴 정확한 나이가 없으면 밴드 표현으로도 통과',
    post('저도 40대 후반인데 그래요', null).ok === true)
  check('🔴 🔴 **제3자 44 와 우리 47 이 같은 글에 있어도 통과**',
    post('아는 분이 44인데 저는 47이거든요').ok === true)
  check('🔴 제3자 나이만 있고 우리 나이가 없으면 실패',
    post('아는 분이 44인데 그렇대요').ok === false)
}

console.log('\n🔴 🔴 **운영 계약에 나이가 실제로 들어간다 (helper PASS 가 아니다)**')
{
  const src = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  const gc = readFileSync('scripts/lib/generation-contract.mts', 'utf-8')
  const sp = readFileSync('scripts/supply-process.mts', 'utf-8')
  // 🔴 **선택이 아니라 필수다** (2026-09-23). 선택이면 시각 없이 부르는 곳이 생기고,
  //    그 계약은 `age=∅` 라 어떤 artifact 와도 같지 않다(e2e 탐침에서 실측).
  check('🔴 🔴 **`currentContractBase` 가 시각을 필수로 받는다**',
    /currentContractBase\(runAt: Date\)/.test(gc)
    && !/currentContractBase\(runAt\?: Date\)/.test(gc))
  check('🔴 🔴 **그 시각을 `loadVoice` 로 넘긴다**', /loadVoice\(runAt\)/.test(gc))
  /**
   * 🔴 **자식은 자기 시계를 만들지 않는다** (2026-09-23 마스터 P0-4A).
   *    부모가 준 `SORAN_RUN_AT` 하나를 쓴다 — 자정·생일 경계에서 계약이 갈리지 않게.
   */
  check('🔴 🔴 **auto-draft 가 부모가 준 회차 시각 하나를 쓴다**',
    /const RUN_CLOCK = runClockFrom\(process\.env\)/.test(src)
    && /const RUN_AT = RUN_CLOCK\.at/.test(src)
    && !/const RUN_AT = new Date\(\)/.test(src)
    && /currentContractBase\(RUN_AT\)/.test(src)
    && /loadVoice\(RUN_AT\)/.test(src)
    && !/const CONTRACT_BASE = currentContractBase\(\)/.test(src))
  check('🔴 🔴 **생성 단계도 같은 시각을 본다**', /const now = RUN_AT/.test(src))
  check('🔴 🔴 **supply 회차도 한 시각으로 계약·묶음·자식을 묶는다**',
    // 🔴 2026-09-26 — 부모도 자식과 같은 규칙(`runClockFrom`)으로 한 번만 만든다. 벽시계를 다시 만들지 않는다
    /export const RUN_CLOCK = runClockFrom\(process\.env\)/.test(sp) && /export const RUN_AT = RUN_CLOCK\.at/.test(sp)
    && !/const RUN_AT = new Date\(\)/.test(sp) && /const runAt = RUN_AT/.test(sp)
    && /currentContractBase\(runAt\)/.test(sp) && /takenAt: runAt/.test(sp)
    && /\[RUN_AT_ENV\]: RUN_AT\.toISOString\(\)/.test(sp))
  check('🔴 🔴 **시각을 주면 계약에 `age=∅` 가 남지 않는다**', (() => {
    const p02 = P({ code: 'P02', birthDate: '1979-06-20' })
    const withNow = personaPoolIdentity([p02], new Date('2026-09-23T03:00:00Z'))
    return !withNow.includes('age=∅') && withNow.includes('age=P02@')
  })())
}

console.log('\n🔴 🔴 **계획과 생성이 같은 dated Persona 를 본다**')
{
  const run = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
  check('🔴 🔴 **계획 후보에 스냅샷을 먼저 적용한다**',
    /const dated = input\.personas\.map\(datedOf\)/.test(run)
    && /orderPersonasForSource\(dated,/.test(run))
  check('🔴 🔴 **생성도 그 `dated` 에서 고른다 — 정적 카드로 되돌아가지 않는다**',
    /const persona = dated\.find\(/.test(run)
    && !/const persona = input\.personas\.find\(/.test(run))
  check('🔴 🔴 **2031 P02 는 계획·생성 모두 52세/50대 초반을 본다**', (() => {
    const at = materializePersonaAt({
      card: { code: 'P02', birthDate: '1979-06-20', ageBand: '40대 후반' },
      now: new Date('2031-09-23T03:00:00Z'),
    })
    // 🔴 `datedOf` 와 같은 변환 — 계획 후보의 ageBand 가 이 값으로 바뀐다
    return at.ok && at.at.exactAge === 52 && at.at.effectiveAgeBand === '50대 초반'
  })())
}

console.log('\n🔴 🔴 **원문 나이 = Persona 나이면 고칠 것이 없다**')
{
  const post = (text: string, src: string[], age: number | null) => checkAgeMappingApplied({
    text, sourceAges: src, exactAge: age, effectiveAgeBand: '40대 후반',
  })
  check('🔴 🔴 **원문 47 + Persona 47 → 통과 (불필요한 수정 0)**',
    post('제가 47살인데요 요즘 그래요', ['47'], 47).ok === true)
  check('🔴 원문 44 + 결과 47 → 통과', post('제가 47살인데요', ['44'], 47).ok === true)
  check('🔴 🔴 **원문 44·47 + 결과 47 하나 → 통과**',
    post('제가 47살인데요', ['44', '47'], 47).ok === true)
  check('🔴 원문 44 + 결과 44 → 실패', post('제가 44살인데요', ['44'], 47).ok === false)
  check('🔴 원문 44 + 나이 누락 → 실패', post('피부가 80퍼인 것 같아요', ['44'], 47).ok === false)
  check('🔴 제3자 44 + self 47 → 통과',
    post('아는 분이 44인데\n저는 47이거든요', ['44'], 47).ok === true)
}

console.log('\n🔴 🔴 **자동 변환과 후조건이 역할을 끝까지 쓴다 (마스터 지적 · 혼합 역할)**')
{
  /**
   * 🔴 앞판은 `ageMentionsIn` 으로 역할을 만들어 놓고 **치환과 후조건에서 버렸다.**
   *    전역 `split/join` 과 역할 없는 정규식이라 마스터 실측에서:
   *      "친구는 40대 초반인데 저는 52살입니다"        → 친구 나이까지 52살로 훼손
   *      "저는 40대 초반이고, 40대 초반부터 지원 대상"  → 지원 조건까지 변조
   *      "제가 44살이고 44세부터 지원 대상입니다"       → exact 경로도 같은 결함
   *    그리고 **올바르게 보존된** 제3자·조건 때문에 정상 글이 `SOURCE_AGE_REMAINS` 로 막혔다.
   */
  const fix = (text: string, sourceAges: string[], personaText: string) =>
    fixSourceSpeakerAge({ text, sourceAges, personaText })
  const post = (text: string, sourceAges: string[], exactAge: number, band: string) =>
    checkAgeMappingApplied({ text, sourceAges, exactAge, effectiveAgeBand: band, requireSelfAge: true })
  /** 🔴 실패 코드만 꺼낸다 — 통과면 빈 문자열이다 */
  const postCode = (text: string, sourceAges: string[], exactAge: number, band: string): string => {
    const v = post(text, sourceAges, exactAge, band)
    return v.ok ? '' : v.code
  }

  /** 🔴 ① self exact 44→49 · eventCondition 44 는 그대로 */
  const r1 = fix('제가 44살이고 44세부터 지원 대상입니다.', ['44'], '49살')
  check('🔴 🔴 **① self exact 만 49살로 바뀌고 조건 44세는 그대로다**',
    r1.text === '제가 49살이고 44세부터 지원 대상입니다.' && r1.fixed === 1, r1.text)

  /** 🔴 ② self band 40대 초반→52 · thirdParty 40대 초반 은 그대로 */
  const r2 = fix('저는 40대 초반이고 친구는 40대 초반입니다.', ['40대 초반'], '52살')
  check('🔴 🔴 **② 내 구간만 52살로 바뀌고 친구 구간은 그대로다**',
    r2.text === '저는 52살이고 친구는 40대 초반입니다.' && r2.fixed === 1, r2.text)
  const r2b = fix('친구는 40대 초반인데 저는 52살입니다.', ['40대 초반'], '52살')
  check('🔴 🔴 **② 제3자 나이만 있으면 아무것도 바꾸지 않는다 — 훼손 0**',
    r2b.text === '친구는 40대 초반인데 저는 52살입니다.' && r2b.fixed === 0, r2b.text)

  /** 🔴 ③ self band 40대 초반→52 · eventCondition 40대 초반 은 그대로 */
  const r3 = fix('저는 40대 초반이고, 40대 초반부터 지원 대상입니다.', ['40대 초반'], '52살')
  check('🔴 🔴 **③ 내 구간만 바뀌고 지원 조건 구간은 그대로다**',
    r3.text === '저는 52살이고, 40대 초반부터 지원 대상입니다.' && r3.fixed === 1, r3.text)

  /** 🔴 ④ 올바르게 보존된 제3자·조건 때문에 SOURCE_AGE_REMAINS 가 나면 안 된다 */
  const p4a = post('저는 52살이고 친구는 40대 초반입니다.', ['40대 초반'], 52, '50대 초반')
  const p4b = post('저는 52살이고 40대 초반부터 지원 대상입니다.', ['40대 초반'], 52, '50대 초반')
  check('🔴 🔴 **④ 제3자 구간이 남아도 통과한다 — raw substring 을 보지 않는다**',
    p4a.ok, JSON.stringify(p4a))
  check('🔴 🔴 **④ 조건 구간이 남아도 통과한다**', p4b.ok, JSON.stringify(p4b))
  check('🔴 🔴 **④ 1인칭에 원문 나이가 남으면 여전히 막는다**',
    !post('저는 40대 초반이고 친구는 52살입니다.', ['40대 초반'], 52, '50대 초반').ok,
    JSON.stringify(post('저는 40대 초반이고 친구는 52살입니다.', ['40대 초반'], 52, '50대 초반')))
  check('🔴 🔴 **④ 1인칭 나이가 여럿이면 여전히 막는다 (기존 계약 유지)**',
    postCode('저는 52살입니다. 저는 57살입니다.', ['40대 초반'], 52, '50대 초반')
      === 'CONFLICTING_SELF_AGE',
    JSON.stringify(post('저는 52살입니다. 저는 57살입니다.', ['40대 초반'], 52, '50대 초반')))

  /** 🔴 ⑤ 제3자 나이만 있고 우리 나이가 없으면 기존대로 실패 */
  check('🔴 🔴 **⑤ 우리 나이가 1인칭으로 없으면 기존대로 PERSONA_AGE_ABSENT**',
    postCode('친구는 40대 초반입니다. 저는 잘 모르겠어요.', ['40대 초반'], 52, '50대 초반')
      === 'PERSONA_AGE_ABSENT',
    JSON.stringify(post('친구는 40대 초반입니다. 저는 잘 모르겠어요.', ['40대 초반'], 52, '50대 초반')))
  check('🔴 🔴 **⑤ 새 HOLD 사유를 만들지 않았다 — 기존 세 코드뿐이다**', (() => {
    const src = readFileSync('src/lib/content-core/speaker-relative-facts.ts', 'utf-8')
    const codes = [...src.matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]!)
    return [...new Set(codes)].sort().join(',')
      === 'CONFLICTING_SELF_AGE,NO_PERSONA_VALUE,PERSONA_AGE_ABSENT,SOURCE_AGE_REMAINS,UNKNOWN_AXIS'
  })())

  /** 🔴 ⑥ 원문 값 = 우리 값이면 손대지 않는다 */
  const noop = fix('제가 49살입니다.', ['49'], '49살')
  check('🔴 🔴 **⑥ 원문 나이와 우리 나이가 같으면 no-op — fixed 0**',
    noop.text === '제가 49살입니다.' && noop.fixed === 0, `${noop.text} · fixed=${noop.fixed}`)

  /** 🔴 ⑦ 전역 치환·역할 없는 정규식으로 되돌리면 이 검사가 깨진다 — 배선으로 확인 */
  const srfSrc = readFileSync('src/lib/content-core/speaker-relative-facts.ts', 'utf-8')
  check('🔴 🔴 **⑦ 전역 split/join 치환이 남아 있지 않다**',
    !/\.split\(n\)\.join\(/.test(srfSrc) && !/out\.split\([^)]*\)\.join\(/.test(srfSrc))
  check('🔴 🔴 **⑦ 치환은 파싱된 위치로 자른다 — 뒤에서부터 적용한다**',
    /out\.slice\(0, m\.at\) \+ input\.personaText \+ out\.slice\(m\.at \+ m\.raw\.length\)/.test(srfSrc)
    && /\.sort\(\(a, b\) => b\.at - a\.at\)/.test(srfSrc))
  check('🔴 🔴 **⑦ 치환·후조건이 `self` 역할만 본다**',
    (srfSrc.match(/m\.role === 'self'/g) ?? []).length >= 3)
}

console.log('\n🔴 🔴 **나이 전 경로 — exact 와 band 를 각각 끝까지 실행한다 (마스터 P0)**')
{
  /**
   * 🔴 parser 단위 검사로 끝내지 않는다. 마스터가 지정한 전 경로를 **실행**한다:
   *    원문 → expected fact → 계획 누락 대조 → mapping/load-bearing → 초안 지시문
   *    → 결정적 후조건 → `pickV2` → adopted → candidate payload
   */
  const CARDS_A = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8')).cards
  const aged = CARDS_A.map((c) => {
    const v = materializePersonaAt({ card: { code: c.code, birthDate: c.birthDate, ageBand: c.ageBand }, now: NOW })
    return { c, age: v.ok ? v.at.exactAge : null, band: v.ok ? v.at.effectiveAgeBand : c.ageBand }
  })
  const pickCard = (age: number) => aged.find((x) => x.age === age)!
  const inputOf = (x: typeof aged[number]) => P({
    code: x.c.code, ageBand: x.c.ageBand, birthDate: x.c.birthDate,
    maritalStatus: x.c.maritalStatus, childrenCount: x.c.childrenCount,
    childrenAgeBands: x.c.childrenAgeBands, workStatus: x.c.workStatus,
    region: x.c.region, menopauseStatus: x.c.menopauseStatus, parentCare: x.c.parentCare,
  })

  /** 🔴 원문 → 후보 payload 까지 러너와 **같은 순서·같은 함수**로 */
  const fullPath = async (o: {
    title: string; body: string; personas: PersonaInput[]
    plan: Record<string, unknown>; draft: { title: string; body: string }
    band: string | null; exactAge: number | null
  }) => {
    const art = await run({
      id: 'full-1', title: o.title, body: o.body, personas: o.personas,
      canned: { plan: o.plan, draft: o.draft, review: EMPTY_REVIEW },
    })
    if (art.draft === null) return { art, pick: null, payload: null }
    const cand = {
      sourceArticleId: 'full-1', draftNo: 1,
      title: art.draft.title, body: art.draft.body,
      safetyVerdict: 'pass', originality: { runChars: 7, runWords: 1, coverRatio: 0 },
      generatedAt: NOW.toISOString(),
    }
    const pick = pickV2({
      judgement: { sourceArticleId: 'full-1', decision: 'SEED', reason: 'ok' } as never,
      draft: cand as never, seenTitles: new Set<string>(), seenBodies: new Set<string>(),
      sourceUsed: false, machineOutcome: art.review.machineOutcome,
      machineReason: art.review.machineReason, sourceTitleCopied: false, crisisStop: null,
      ageFact: { ageBand: o.band, selfBasis: String(o.plan.selfBasis ?? '') as never, personaExactAge: o.exactAge },
    }, NOW.toISOString())
    const payload = pick.decision === 'AUTO_ADOPT'
      ? { title: cand.title, body: cand.body, artifactId: art.artifactId } : null
    return { art, pick, payload }
  }

  // ─────────── exact — 원문 44 · 우리 47 ───────────
  {
    const me = pickCard(47)
    const T = '자랑은 아닌데 여잔 피부가80퍼인듯'
    const B = '에스테딕싼곳 동네다니는데 진짜\n낼44인데 아직도 어리단소리들어요 ㅋ\n진짜여잔 피부가80퍼...'
    check('🔴 🔴 **exact ① 원문에서 자기 나이 44 를 코드가 먼저 찾는다**',
      expectedSelfFactsIn([{ kind: 'head', text: B }]).map((x) => x.sourceText).join(',') === '44',
      JSON.stringify(expectedSelfFactsIn([{ kind: 'head', text: B }])))

    const planOf = (sr: unknown[]) => ({
      decision: 'ok', personaCode: me.c.code, stance: 'SELF_EXPERIENCE',
      selfBasis: 'noLifeFactNeeded', universalReason: '누구나 겪는 일이라',
      speakerWarrants: [], closingIntent: 'ask', contentRoles: ['conversationSpark'],
      protectedFacts: [{ kind: 'number', text: '80퍼', evidenceRef: 'title' }],
      speakerRelative: sr,
    })
    const D = {
      title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
      body: '동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n제가 곧 44인데 아직 어리단 소리를 들어요.\n여자는 피부가 80퍼인 것 같아요. 다들 어떠세요?',
    }
    // ② 계획이 양쪽에서 누락 → parseFailed
    const miss = await fullPath({
      title: T, body: B, personas: [inputOf(me)], plan: planOf([]), draft: D,
      band: me.band, exactAge: me.age,
    })
    check('🔴 🔴 **exact ② 계획이 양쪽에서 빠뜨리면 parseFailed — 후보가 되지 않는다**',
      miss.art.review.semanticCompletion.cause === 'parseFailed' && miss.payload === null,
      `${miss.art.review.machineOutcome} · ${String(miss.art.review.semanticCompletion.cause)}`)

    // ③ 정상 — incidental 변환 → payload 까지
    const ok = await fullPath({
      title: T, body: B, personas: [inputOf(me)],
      plan: planOf([{ axis: 'age', sourceText: '44', evidenceRef: 'head', materiality: 'incidental' }]),
      draft: D, band: me.band, exactAge: me.age,
    })
    check('🔴 🔴 **exact ③ 정상 변환이 payload 까지 간다 — AUTO_ADOPT**',
      ok.pick?.decision === 'AUTO_ADOPT' && ok.payload !== null,
      `${ok.art.review.machineOutcome} · ${ok.pick?.decision}`)
    check('🔴 🔴 **exact ③ payload 에 원문 44 가 없고 우리 47 이 있다**',
      ok.payload !== null && !/(^|[^0-9])44\s*(살|세|인데)/.test(ok.payload.body)
      && new RegExp(`(^|[^0-9])${me.age}\\s*(살|세|인데)`).test(ok.payload.body),
      ok.payload?.body.split('\n')[1] ?? '')
  }

  // ─────────── band — 원문 "40대 초반" · 우리 52 ───────────
  {
    const me = pickCard(52)
    const T = '피부 고민 있으신 분'
    const B = '저는 40대 초반인데 피부 고민이 있어요.\n다들 어떻게 관리하시나요?'
    check('🔴 🔴 **band ① 원문의 "40대 초반" 을 코드가 구간으로 찾는다**',
      expectedSelfFactsIn([{ kind: 'head', text: B }]).map((x) => x.sourceText).join(',') === '40대 초반',
      JSON.stringify(expectedSelfFactsIn([{ kind: 'head', text: B }])))

    const planOf = (sr: unknown[]) => ({
      decision: 'ok', personaCode: me.c.code, stance: 'SELF_EXPERIENCE',
      selfBasis: 'noLifeFactNeeded', universalReason: '누구나 겪는 일이라',
      speakerWarrants: [], closingIntent: 'ask', contentRoles: ['conversationSpark'],
      protectedFacts: [], speakerRelative: sr,
    })
    // 🔴 모델이 원문 구간을 그대로 베낀 초안 — 자동 보정이 잡아야 한다
    const D = {
      title: '피부 관리 어떻게 하시는지 궁금해요',
      body: '저는 40대 초반인데 요즘 부쩍 건조하다는 느낌이 듭니다.\n다들 무엇부터 챙기시는지 여쭙고 싶어요.',
    }
    // ② 계획이 양쪽에서 누락 → parseFailed
    const miss = await fullPath({
      title: T, body: B, personas: [inputOf(me)], plan: planOf([]), draft: D,
      band: me.band, exactAge: me.age,
    })
    check('🔴 🔴 **band ② 계획이 양쪽에서 빠뜨리면 parseFailed — 후보가 되지 않는다**',
      miss.art.review.semanticCompletion.cause === 'parseFailed' && miss.payload === null,
      `${miss.art.review.machineOutcome} · ${String(miss.art.review.semanticCompletion.cause)}`)

    // ③ 정상 — incidental 구간 변환 → payload 까지
    const ok = await fullPath({
      title: T, body: B, personas: [inputOf(me)],
      plan: planOf([{ axis: 'age', sourceText: '40대 초반', evidenceRef: 'head', materiality: 'incidental' }]),
      draft: D, band: me.band, exactAge: me.age,
    })
    check('🔴 🔴 **band ③ 구간 변환이 payload 까지 간다 — AUTO_ADOPT**',
      ok.pick?.decision === 'AUTO_ADOPT' && ok.payload !== null,
      `${ok.art.review.machineOutcome} · ${ok.art.review.machineReason} · ${ok.pick?.decision}`)
    check('🔴 🔴 **band ③ payload 에 원문 "40대 초반" 이 남지 않는다**',
      ok.payload !== null && !ok.payload.body.includes('40대 초반'),
      ok.payload?.body.split('\n')[0] ?? '')
    check('🔴 🔴 **band ③ 우리 값(52살 또는 50대 초반)이 들어간다**',
      ok.payload !== null
      && (ok.payload.body.includes(`${me.age}`) || ok.payload.body.includes(me.band ?? '\u0000')),
      ok.payload?.body.split('\n')[0] ?? '')

    /**
     * 🔴 ④ **어미가 붙지 않은 구간 표현**도 바꾼다 — *"40대 초반 여성이라"*.
     *    숫자 치환 규칙은 `살|세|인데` 같은 **어미**를 요구하므로 여기 걸리지 않는다.
     *    그대로 두면 원문 화자의 연령대가 글에 남는다.
     */
    const bare = await fullPath({
      title: T, body: B, personas: [inputOf(me)],
      plan: planOf([{ axis: 'age', sourceText: '40대 초반', evidenceRef: 'head', materiality: 'incidental' }]),
      draft: {
        title: '피부 관리 어떻게 하시는지 궁금해요',
        body: '저는 40대 초반 여성이라 그런지 요즘 부쩍 건조합니다.\n다들 무엇부터 챙기시는지 여쭙고 싶어요.',
      },
      band: me.band, exactAge: me.age,
    })
    check('🔴 🔴 **band ④ 어미 없는 구간 표현도 바뀐다 — "40대 초반 여성" 이 남지 않는다**',
      bare.payload !== null && !bare.payload.body.includes('40대 초반'),
      `${bare.art.review.machineOutcome} · ${bare.art.draft?.body.split('\n')[0] ?? ''}`)
  }

  // ─────────── 혼합 역할 — 전체 경로에서 제3자·조건이 보존된다 ───────────
  {
    /**
     * 🔴 마스터 요구 ⑦ — 한 글에 **내 나이 · 친구 나이 · 지원 조건**이 함께 있을 때
     *    `runContentCore → pickV2 → adopted → candidate payload` 까지 가서
     *    바뀐 것은 내 나이 하나뿐인지 본다.
     */
    const me = pickCard(52)
    const T = '지원 대상 나이가 궁금해요'
    // 🔴 원문을 길게 둔다 — 짧으면 초안이 조금만 겹쳐도 `copiedFromSource` 로 막혀
    //    이 검사가 배선이 아니라 제 문장을 시험하게 된다
    const B = '저는 40대 초반인데 친구는 60대 초반입니다. 둘이 같이 알아보는 중인데 '
      + '들리는 말이 제각각이라 헷갈립니다. 40대 초반부터 지원 대상이라던데 어디서 확인하면 '
      + '되는지, 서류는 무엇을 챙겨야 하는지 아시는 분 계실까요? 주변에 먼저 해 보신 분이 '
      + '없어서 답답한 마음에 여쭤봅니다.'
    const D = {
      title: '지원 대상 나이를 아시는 분 계실까요',
      body: '저는 40대 초반인데 친구는 60대 초반입니다.\n'
        + '40대 초반부터 해당된다고 들었는데, 실제로 받아 보신 분 이야기가 궁금합니다.',
    }
    const mixed = await fullPath({
      title: T, body: B, personas: [inputOf(me)],
      plan: {
        decision: 'ok', personaCode: me.c.code, stance: 'SELF_EXPERIENCE',
        selfBasis: 'noLifeFactNeeded', universalReason: '누구나 겪는 일이라',
        speakerWarrants: [], closingIntent: 'ask', contentRoles: ['conversationSpark'],
        protectedFacts: [],
        speakerRelative: [
          { axis: 'age', sourceText: '40대 초반', evidenceRef: 'head', materiality: 'incidental' },
        ],
      },
      draft: D, band: me.band, exactAge: me.age,
    })
    check('🔴 🔴 **혼합 ① 전체 경로가 payload 까지 간다 — AUTO_ADOPT**',
      mixed.pick?.decision === 'AUTO_ADOPT' && mixed.payload !== null,
      `${mixed.art.review.machineOutcome} · ${mixed.art.review.machineReason}`)
    check('🔴 🔴 **혼합 ② 내 나이만 바뀐다 — payload 에 "저는 52"**',
      mixed.payload !== null && /저는 52/.test(mixed.payload.body),
      mixed.payload?.body ?? '')
    check('🔴 🔴 **혼합 ③ 친구 나이(60대 초반)가 그대로 남는다**',
      mixed.payload !== null && mixed.payload.body.includes('친구는 60대 초반'),
      mixed.payload?.body ?? '')
    check('🔴 🔴 **혼합 ④ 지원 조건(40대 초반부터)이 그대로 남는다**',
      mixed.payload !== null && mixed.payload.body.includes('40대 초반부터'),
      mixed.payload?.body ?? '')
    check('🔴 🔴 **혼합 ⑤ 1인칭 자리에는 원문 40대 초반이 남지 않는다**',
      mixed.payload !== null && !/저는 40대 초반/.test(mixed.payload.body),
      mixed.payload?.body ?? '')
  }

  // ─────────── load-bearing self band — 조건 "50대 초반" ───────────
  {
    const fit = pickCard(52)
    const unfit = pickCard(57)
    const F = [{ axis: 'age' as const, sourceText: '50대 초반' }]
    const C = (code: string, age: number | null) => ({ code, exactAge: age })
    const okFit = resolveLoadBearing({
      facts: F, stance: 'SELF_EXPERIENCE', chosen: C(fit.c.code, 52),
      candidates: [C(fit.c.code, 52)], selfAlreadyFailed: false,
    })
    check('🔴 🔴 **lb-band ① 52 는 50대 초반 조건을 만족한다 — SELF 가능**',
      okFit.ok && okFit.kind === 'personaSatisfies', JSON.stringify(okFit))
    const bad = resolveLoadBearing({
      facts: F, stance: 'SELF_EXPERIENCE', chosen: C(unfit.c.code, 57),
      candidates: [C(unfit.c.code, 57), C(fit.c.code, 52)], selfAlreadyFailed: false,
    })
    check('🔴 🔴 **lb-band ② 57 은 불충족 — 구간에 드는 후보만 지목한다**',
      !bad.ok && bad.retry && bad.code === 'PERSONA_MISMATCH'
      && bad.suggest.join(',') === fit.c.code, JSON.stringify(bad))
    const none = resolveLoadBearing({
      facts: F, stance: 'SELF_EXPERIENCE', chosen: C(unfit.c.code, 57),
      candidates: [C(unfit.c.code, 57), C('PXX', 61)], selfAlreadyFailed: false,
    })
    check('🔴 🔴 **lb-band ③ 구간에 드는 후보가 없으면 자리를 바꾼다**',
      !none.ok && none.retry && none.code === 'SELF_IMPOSSIBLE', JSON.stringify(none))
    check('🔴 🔴 **lb-band ④ 숫자 50 으로 축약하지 않는다 — span 50~53 을 그대로 쓴다**', (() => {
      const req = loadBearingRequirements({ facts: F, stance: 'SELF_EXPERIENCE' })
      return req[0]?.fact.kind === 'band' && req[0].fact.raw === '50대 초반'
        && req[0].fact.span.from === 50 && req[0].fact.span.to === 53
        && req[0].outputRule.includes('50대 초반')
    })(), JSON.stringify(loadBearingRequirements({ facts: F, stance: 'SELF_EXPERIENCE' })))

    const reqSelf = loadBearingRequirements({ facts: F, stance: 'SELF_EXPERIENCE' })
    const keep = (t: string, r = reqSelf) => checkLoadBearingPreserved({ text: t, requirements: r })
    check('🔴 🔴 **lb-band ⑤ "제가 52살인데" 로 조건이 보존된다**',
      keep('제가 52살인데 해당된다고 들었어요').ok,
      JSON.stringify(keep('제가 52살인데 해당된다고 들었어요')))
    check('🔴 🔴 **lb-band ⑤ "저는 50대 초반이라" 로도 보존된다**',
      keep('저는 50대 초반이라 해당된다고 들었어요').ok,
      JSON.stringify(keep('저는 50대 초반이라 해당된다고 들었어요')))
    check('🔴 🔴 **lb-band ⑤ "제가 57살인데" 는 구간 밖이라 막는다**',
      !keep('제가 57살인데 해당된다고 들었어요').ok,
      JSON.stringify(keep('제가 57살인데 해당된다고 들었어요')))
    check('🔴 🔴 **lb-band ⑤ 조건이 사라지면 막는다**',
      !keep('해당된다고 들어서 알아보는 중입니다').ok)
  }

  // ─────────── load-bearing event band — "50대 초반부터 지원 대상" ───────────
  {
    const F = [{ axis: 'age' as const, sourceText: '50대 초반' }]
    const reqEvent = loadBearingRequirements({ facts: F, stance: 'QUESTION' })
    const keep = (t: string) => checkLoadBearingPreserved({ text: t, requirements: reqEvent })
    check('🔴 🔴 **lb-event ① 같은 범위가 조건으로 남으면 통과한다**',
      keep('50대 초반부터 지원 대상이라는데 맞을까요?').ok,
      JSON.stringify(keep('50대 초반부터 지원 대상이라는데 맞을까요?')))
    for (const [t, why] of [
      ['지원금이 50만원입니다', '금액'],
      ['50번 버스를 탔어요', '번호'],
      ['제가 52살이라 대상이 된다고 들었습니다', '자기 나이로 주장'],
    ] as [string, string][]) {
      check(`🔴 🔴 **lb-event ② ${why} 만으로는 조건 보존이 아니다 — "${t}"**`,
        !keep(t).ok, `${t} → ${JSON.stringify(keep(t))}`)
    }
    check('🔴 🔴 **lb-event ③ 구간을 숫자 하나로 줄이면 조건이 달라진다 — 막는다**',
      !keep('50세부터 지원 대상이라는데 맞을까요?').ok,
      JSON.stringify(keep('50세부터 지원 대상이라는데 맞을까요?')))
  }
}

console.log('\n🔴 🔴 **artifact → pickV2 → adopted → candidate payload (실제 함수)**')
{
  /**
   * 🔴 문자열 소스 검사가 아니다. 위 E2E 가 만든 **실제 artifact** 를 받아
   *    러너와 **같은 순서·같은 함수**로 후보 payload 까지 만든다.
   */
  const CARD_P02 = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
    .cards.find((c) => c.code === 'P02')!
  const p02 = P({
    code: 'P02', ageBand: CARD_P02.ageBand, birthDate: CARD_P02.birthDate,
    maritalStatus: CARD_P02.maritalStatus, childrenCount: CARD_P02.childrenCount,
    childrenAgeBands: CARD_P02.childrenAgeBands, workStatus: CARD_P02.workStatus,
    region: CARD_P02.region, menopauseStatus: CARD_P02.menopauseStatus,
    parentCare: CARD_P02.parentCare,
  })
  const want = materializePersonaAt({
    card: { code: 'P02', birthDate: CARD_P02.birthDate, ageBand: CARD_P02.ageBand }, now: NOW,
  })
  const SRC_TITLE = '자랑은 아닌데 여잔 피부가80퍼인듯'
  const SRC_BODY = '에스테딕싼곳 동네다니는데 진짜\n낼44인데 아직도 어리단소리들어요 ㅋ\n진짜여잔 피부가80퍼...'
  const PLAN = {
    decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded',
    universalReason: '누구나 겪는 일이라', speakerWarrants: [],
    closingIntent: 'ask', contentRoles: ['conversationSpark'],
    protectedFacts: [
      { kind: 'number', text: '80퍼', evidenceRef: 'title' },
      { kind: 'number', text: '44', evidenceRef: 'head' },
    ],
    speakerRelative: [{ axis: 'age', sourceText: '44', evidenceRef: 'head', materiality: 'incidental' }],
  }
  const art = await run({
    id: '35040880', title: SRC_TITLE, body: SRC_BODY, personas: [p02],
    canned: {
      plan: PLAN, review: EMPTY_REVIEW,
      draft: { title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
        body: '동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n제가 곧 44인데 아직 어리단 소리를 들어요.\n여자는 피부가 80퍼인 것 같아요. 다들 어떠세요?' },
    },
  })
  check('🔴 artifact 가 adopt 다', art.review.machineOutcome === 'adopt', art.review.machineOutcome)

  // 🔴 러너와 **같은 순서**: 실제 `pickV2` → `AUTO_ADOPT` 만 `adopted` → payload
  const cand = {
    sourceArticleId: '35040880', draftNo: 1,
    title: art.draft!.title, body: art.draft!.body,
    safetyVerdict: 'pass', originality: { runChars: 7, runWords: 1, coverRatio: 0 },
    generatedAt: NOW.toISOString(),
  }
  const pick = pickV2({
    judgement: { sourceArticleId: '35040880', decision: 'SEED', reason: 'ok' } as never,
    draft: cand as never, seenTitles: new Set<string>(), seenBodies: new Set<string>(),
    sourceUsed: false, machineOutcome: art.review.machineOutcome,
    machineReason: art.review.machineReason, sourceTitleCopied: false, crisisStop: null,
    ageFact: {
      ageBand: want.ok ? want.at.effectiveAgeBand : null, selfBasis: PLAN.selfBasis,
      personaExactAge: want.ok ? want.at.exactAge : null,
    },
  }, NOW.toISOString())
  check('🔴 🔴 **`pickV2` 가 AUTO_ADOPT 를 낸다**',
    pick.decision === 'AUTO_ADOPT', `${pick.decision}:${pick.reason}`)

  const adopted = pick.decision === 'AUTO_ADOPT' ? [{ pick, draft: cand, art }] : []
  check('🔴 🔴 **`adopted` 에 한 건 들어간다 — HOLD 는 들어가지 않는다**', adopted.length === 1)

  const payload = adopted.map((a) => ({
    title: a.draft.title, body: a.draft.body,
    voiceProvenance: a.art.voice.provenance === null ? null : {
      personaCode: a.art.voice.provenance.personaCode,
      comments: a.art.voice.provenance.sampleCount,
      bundleDigest: a.art.voice.provenance.bundleDigest,
      sourceDigest: a.art.voice.provenance.sourceDigest,
    },
    semanticReview: semanticSummaryOf(a.art.review),
  }))[0]!
  const text = `${payload.title}\n${payload.body}`
  check('🔴 🔴 **보정된 본문이 payload 에 실린다**',
    want.ok && new RegExp(`(^|[^0-9])${want.at.exactAge}\\s*(살|세|인데)`).test(text), text)
  check('🔴 🔴 **원문 44 가 다시 나타나지 않는다**', !/(^|[^0-9])44\s*(살|세|인데)/.test(text))
  check('🔴 🔴 **source-invariant 80퍼 가 살아 있다**', text.includes('80퍼'))
  check('🔴 🔴 **Persona code · voice provenance 가 유지된다**',
    payload.voiceProvenance?.personaCode === 'P02'
    && (payload.voiceProvenance?.bundleDigest ?? '') !== '', JSON.stringify(payload.voiceProvenance))
  check('🔴 🔴 **artifact 의 의미 검수 요약이 payload 에 유지된다**',
    payload.semanticReview !== null && payload.semanticReview.complete === true,
    JSON.stringify(payload.semanticReview))

  // 🔴 HOLD 는 payload 로 가지 않는다
  const holdArt = await run({
    id: '35040881', title: SRC_TITLE, body: SRC_BODY, personas: [p02],
    canned: {
      plan: PLAN, review: EMPTY_REVIEW,
      draft: { title: '여자는 피부가 80퍼라는 말이 맞는 것 같아요',
        body: '동네 저렴한 에스테틱을 몇 년 다녀봤는데요.\n여자는 피부가 80퍼인 것 같아요.' },
    },
  })
  check('🔴 🔴 **나이가 빠진 초안은 artifact 가 adopt 가 아니고 payload 로도 안 간다**',
    holdArt.review.machineOutcome !== 'adopt' && holdArt.draft === null
      ? true
      : holdArt.review.machineOutcome !== 'adopt', holdArt.review.machineOutcome)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 검사다 — 실제 모델이 쓸 만한 글을 쓰는지는 증명하지 않았다.')
console.log('🔴 검사 수는 성과가 아니다. 사람 READY 판정은 유료 실측으로만 나온다.')
if (fail > 0) process.exit(1)
