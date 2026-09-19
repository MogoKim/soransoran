#!/usr/bin/env tsx
/**
 * Content Core v2 행동 검사 — 🔴 **네트워크 0 · 실제 provider 0 · DB 0**
 *
 * 🔴 **정규식이 있는지 세지 않는다.** 실제 함수를 돌려 나온 `HumanReviewArtifact`
 *    값으로 본다. 통과 수는 제품 성공이 아니다.
 *
 * 🔴 **못 하는 것**: 실제 모델이 재미있는 글을 쓰는가. 가짜 provider 는 정해진
 *    답을 돌려준다. 그것은 사람 blind 평가와 유료 실측으로만 확인된다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { runContentCore, personaInputOf, type Ask, type AskResult, type PersonaInput }
  from './lib/content-core-run.mjs'
import {
  buildEssenceSystemPrompt, buildV2DraftSystemPrompt, lifeContractLines, type ClaimVocabulary,
} from './lib/content-core-prompts.mjs'
import { isContentCoreV2Enabled, CONTENT_CORE_V2_ENV, CONTENT_CORE_V2_FLAG_REMOVE_AT }
  from '../src/lib/content-core/flag'
import { vocabularyOf } from '../src/lib/content-core/speaker'
import { EVIDENCE_CHAR_BUDGET } from '../src/lib/content-core/evidence'
import { claimValueAllowed, judgeProtectedFact, normalizeForProvenance }
  from '../src/lib/content-core/essence'
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

/** 🔴 합성 카드에서 만든다 — 어휘를 손으로 적지 않는다 */
let VOCAB: ClaimVocabulary

type Canned = { essence?: unknown; draft?: unknown; review?: unknown; age?: unknown }
const okRes = (text: string): AskResult => ({
  ok: true, rawText: text, truncated: false, usageKnown: true,
  inputTokens: 100, outputTokens: 20, usd: 0.0001, blocked: false,
})
const pick = (c: Canned, stage: string): string => JSON.stringify(
  stage === 'essence' ? c.essence ?? {}
    : stage === 'draftGen' ? c.draft ?? {}
      : stage === 'semanticReview' ? c.review ?? { issues: [], claimViolations: [], confidence: 0.9, note: '' }
        : c.age ?? { conflict: false, evidence: '' })
/**
 * 🔴 **보낸 것을 값으로 본다.** 정규식으로 소스를 훑지 않고, 실제로 provider 에게
 *    간 system·payload 를 기록해 확인한다.
 */
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

/**
 * 🔴 **정본 카드를 만들고 정본 변환을 지난다** — v2 전용 축소판을 손으로 조립하지 않는다.
 *    이 경로가 곧 시험 harness · 운영 runner 가 쓰는 경로다
 *    (2026-09-19: 손 조립 때문에 말투 기준이 빈 채로 유료 시험을 돌았다).
 */
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
const partTime = P({ code: 'P01', childrenCount: 2, childrenAgeBands: ['중고등'] as ChildAgeBand[], workStatus: '파트타임' })
const homemaker = P({ code: 'P02', childrenCount: 1, workStatus: '전업', region: '광역시' })
const noKids = P({ code: 'P04', childrenCount: 0, workStatus: '직장(정규)' })
/** 🔴 비혼 — 남편을 자기 남편처럼 말하면 안 되는 사람 */
const single = P({ code: 'P08', maritalStatus: '비혼', childrenCount: 0, workStatus: '자영업' })
const ALL = [partTime, homemaker, noKids]

VOCAB = vocabularyOf([partTime, homemaker, noKids, single])

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
  vocabulary: VOCAB, ask: fakeAsk(o.canned, o.fault), now: NOW, callCap: o.cap ?? 6,
  })
}

const fact = (kind: string, text: string, ref = 'head'): unknown => ({ kind, text, evidenceRef: ref })
const beat = (kind: string, meaning: string, evidenceText: string, ref = 'head', id?: string): unknown =>
  ({ ...(id === undefined ? {} : { id }), kind, meaning, evidenceRef: ref, evidenceText })
const claim = (o: { id?: string; fact: string; requiredValue: string; selfClaim?: string
  stanceShiftable?: boolean; evidenceRef?: string; evidenceText: string }): unknown => ({
  id: o.id ?? 'c1', fact: o.fact, requiredValue: o.requiredValue,
  selfClaim: o.selfClaim ?? '', stanceShiftable: o.stanceShiftable ?? false,
  evidenceRef: o.evidenceRef ?? 'head', evidenceText: o.evidenceText,
})

console.log('\n══ Content Core v2 행동 검사 (🔴 네트워크 0 · provider 0 · DB 0) ══\n')
// ─────────────────────────────────────────────────────────
console.log('⓪ 스위치 · 운영 배선 — 🔴 이 PR 은 v1 을 한 줄도 바꾸지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 기본은 꺼짐', !isContentCoreV2Enabled({}))
  check('🔴 모르는 값도 꺼진 것', !isContentCoreV2Enabled({ [CONTENT_CORE_V2_ENV]: '1' }))
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

const results: { name: string; a: HumanReviewArtifact }[] = []
const record = (name: string, a: HumanReviewArtifact): HumanReviewArtifact => {
  results.push({ name, a }); return a
}

// ─────────────────────────────────────────────────────────
console.log('\n① 짧지만 완결된 일상글 — 🔴 protectedFacts 가 없어도 완주')
// ─────────────────────────────────────────────────────────
{
  const a = record('①', await run({
    id: 'S1', title: '오늘 아침에 처음으로 김장 김치를 꺼냈어요',
    body: '아직 좀 이른가 싶었는데 그냥 꺼냈습니다. 맛은 괜찮네요.',
    canned: {
      essence: {
        coreMoment: '올해 첫 김장 김치를 이르게 꺼내 먹은 이야기',
        protectedFacts: [], // 🔴 없어도 된다
        sourceBeats: [beat('situation', '첫 김장 김치를 예상보다 이르게 열어 본 장면', '아직 좀 이른가 싶었는데')],
        participationHook: '', participationConfidence: 0.4,
        closingIntent: 'share', timeSensitivity: 'timeBound',
        contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 그냥 뚜껑을 열었습니다. 생각보다 잘 익었더라고요.' },
    },
  }))
  check('🔴 🔴 **protectedFacts 0개여도 완주한다**',
    a.essence?.protectedFacts.length === 0 && a.draft !== null)
  check('🔴 없는 갈등·질문을 만들지 않았다', a.essence?.claimRequirements.length === 0)
  check('🔴 짧은 글은 안 자른다', !a.evidence.truncated)
  check('🔴 기계 판정이 나왔고 사람 칸은 비어 있다',
    a.review.machineOutcome === 'adopt' && a.humanDecision.verdict === null)
  check('🔴 정상 경로 호출 4회', a.cost.totalCalls === 4, `${a.cost.totalCalls}회`)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 사진·앞 대화가 있어야 아는 글 — 🔴 생성 0')
// ─────────────────────────────────────────────────────────
{
  const a = record('②', await run({
    id: 'S2', title: '이거 어떤가요', body: '아래 사진을 보고 알려주세요. 지난 글에 이어서요.',
    canned: { draft: { title: 'x', body: 'y' } },
  }))
  check('🔴 확인 못 함으로 섰다', a.evidence.contextSufficiency === 'insufficient')
  check('🔴 사진·앞 글 둘 다 짚었다',
    a.evidence.insufficientReasons.includes('needsImage')
    && a.evidence.insufficientReasons.includes('needsPriorThread'))
  check('🔴 🔴 **유료 호출 0회**', a.cost.totalCalls === 0, `${a.cost.totalCalls}회`)
  check('🔴 초안을 만들지 않았다', a.draft === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 긴 글 — 🔴 꼬리 근거 · 줄바꿈이 provenance 를 죽이지 않는다')
// ─────────────────────────────────────────────────────────
{
  const long = `${'서론이 길게 이어집니다. '.repeat(30)}\n그래서 다들\n어떻게 하시는지 궁금해요?`
  const a = record('③', await run({
    id: 'S3', title: '요즘 고민이 하나 있어서요', body: long,
    canned: {
      essence: {
        coreMoment: '길게 적은 고민 끝에 다들 어떻게 하는지 묻는 글',
        protectedFacts: [],
        // 🔴 원문에는 줄바꿈이 있다 — 공백만 지우면 찾아져야 한다
        sourceBeats: [beat('participation', '다른 사람들은 어떻게 하는지 듣고 싶어 하는 마음',
          '그래서 다들 어떻게 하시는지 궁금해요', 'tail')],
        participationHook: '다들 어떻게 하시는지', participationConfidence: 0.8,
        closingIntent: 'ask', timeSensitivity: 'evergreen',
        contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '다들 이럴 때 어떻게 하세요', body: '한참 혼자 생각하다가 여쭤봅니다. 어떻게들 하시는지 궁금해요.' },
    },
  }))
  check('🔴 긴 글은 머리·꼬리로 잘렸다', a.evidence.truncated)
  check('🔴 🔴 **줄바꿈이 달라도 근거가 살아남는다**',
    a.essence?.sourceBeats.length === 1, JSON.stringify(a.dropped))
  check(`🔴 총량이 예산 ${EVIDENCE_CHAR_BUDGET}자 안이다`, a.evidence.totalEvidenceChars <= EVIDENCE_CHAR_BUDGET)
  check('🔴 끝까지 갔다', a.draft !== null)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 숫자 — 🔴 원자적 사실만 글자 그대로 지킨다')
// ─────────────────────────────────────────────────────────
{
  const base = (draftBody: string): Canned => ({
    essence: {
      coreMoment: '직원 아홉 명인 곳에서 여행 선물을 사야 하는지 묻는 글',
      protectedFacts: [fact('number', '9명'), fact('searchTerm', '선물', 'title')],
      sourceBeats: [beat('situation', '근무 시간을 다른 날로 옮겨 채운 사정', '다른날 다 근무해요')],
      participationHook: '사야 하나 말아야 하나', participationConfidence: 0.9,
      closingIntent: 'ask', timeSensitivity: 'evergreen',
      contentRoles: ['usefulAnswer', 'conversationSpark'], claimRequirements: [],
    },
    draft: { title: '여행 선물 다들 사오세요', body: draftBody },
  })
  const keep = record('④', await run({
    id: 'S4', title: '여행 다녀오면 선물하나요', body: '시간 땜빵난건 다른날 다 근무해요. 직원은 9명정도되요.',
    canned: base('직원이 9명이라 한 명씩 챙기면 부담이 큽니다. 다들 어떻게 하세요.'),
  }))
  check('🔴 원자적 숫자를 지키면 통과한다', keep.review.deterministic.pass,
    JSON.stringify(keep.review.deterministic.failures))
  check('🔴 🔴 **"직원은 9명정도되요" 에서 "9명" 을 찾아낸다**',
    keep.essence?.protectedFacts.some((f) => f.text === '9명') === true)
  const lost = await run({
    id: 'S4b', title: '여행 다녀오면 선물하나요', body: '시간 땜빵난건 다른날 다 근무해요. 직원은 9명정도되요.',
    canned: base('사람이 꽤 많아서 한 명씩 챙기면 부담이 큽니다. 다들 어떻게 하세요.'),
  })
  check('🔴 🔴 **숫자를 지우면 잡는다**',
    lost.review.deterministic.failures.some((f) => f.code === 'protectedFactMissing'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 A 회귀 — 원문 질문 전체를 글자 그대로 지키라고 못 한다')
// ─────────────────────────────────────────────────────────
{
  const a = record('⑤', await run({
    id: 'S5', title: '남편이 집안일 많이 돕나요?',
    body: '티비에는 집안일 돕는 남편들 많이 나오던데.. 왜 저희 애아빠는 안그럴까요\n\n역시 방송은 방송일 뿐일까요',
    canned: {
      essence: {
        coreMoment: '방송에 나오는 남편들과 자기 남편을 견주며 답답해하는 이야기',
        // 🔴 앞판이 그대로 통과시켰던 모양 — 문장 · 질문을 글자 그대로 지키라고 한다
        protectedFacts: [
          fact('searchTerm', '왜 저희 애아빠는 안그럴까요'),
          fact('searchTerm', '역시 방송은 방송일 뿐일까요'),
          fact('searchTerm', '집안일'),
        ],
        sourceBeats: [beat('contrast', '화면 속 남편과 우리 집 남편의 거리', '티비에는 집안일 돕는 남편들')],
        participationHook: '같은 마음인 사람이 있는지', participationConfidence: 0.85,
        closingIntent: 'ask', timeSensitivity: 'evergreen',
        contentRoles: ['conversationSpark', 'experienceResonance'],
        // 🔴 남편을 자기 남편처럼 말하는 글 — spouse 조건이 있어야 한다
        claimRequirements: [
          claim({ id: 'c1', fact: 'spouse', requiredValue: '있음', selfClaim: '자기 배우자의 가사 분담',
            evidenceText: '저희 애아빠' }),
        ],
      },
      draft: { title: '화면 속 그 집 남편들', body: '방송만 보면 다들 앞치마를 두르고 집안일을 하더군요. 저희 집은 영 딴판이라 웃음이 납니다. 다들 어떠세요.' },
    },
  }))
  check('🔴 🔴 **질문 전체를 protectedFact 로 받지 않는다**',
    a.essence?.protectedFacts.every((f) => !f.text.includes('까요')) === true,
    JSON.stringify(a.essence?.protectedFacts))
  check('🔴 사유만 남기고 버린다 (다른 칸으로 옮기지 않는다)',
    a.dropped.filter((d) => d.why === 'clauseLike').length === 2, JSON.stringify(a.dropped))
  /**
   * 🔴 **실제로 draftGen 에 간 문자열**을 본다. 앞판은 문장을 `sourceBeat.meaning` 으로
   *    옮겨서 원문 문구가 생성 프롬프트로 그대로 갔다 — 내가 만든 계약 위반이었다.
   */
  {
    const sent = sentOf('draftGen')[0]!
    const both = `${sent.system}\n${sent.payload}`
    for (const phrase of ['왜 저희 애아빠는 안그럴까요', '역시 방송은 방송일 뿐일까요']) {
      check(`🔴 🔴 **강등된 원문 문구가 생성에 가지 않는다 — "${phrase}"**`,
        !both.includes(phrase))
    }
    check('🔴 🔴 **모델이 따로 정리한 뜻은 전달된다**',
      both.includes('화면 속 남편과 우리 집 남편의 거리'))
    check('🟢 검증된 protectedFact 는 전달된다', both.includes('집안일'))
    check('🔴 원문 body 전체가 생성에 가지 않는다',
      !both.includes('티비에는 집안일 돕는 남편들 많이 나오던데'))
  }
  check('🟢 원자적인 것은 남는다', a.essence?.protectedFacts.some((f) => f.text === '집안일') === true)
  check('🔴 🔴 **spouse 조건이 자격에 들어갔다**',
    a.essence?.claimRequirements.some((c) => c.fact === 'spouse' && c.requiredValue === '있음') === true)
  check('🔴 기혼 Persona 가 배정됐다', ['P01', 'P02', 'P04'].includes(a.speaker.personaCode ?? ''))
  check('🟢 원문을 옮기지 않은 초안은 통과한다', a.review.deterministic.pass,
    JSON.stringify(a.review.deterministic.failures))
  check('🔴 원문 문장이 생성 payload 로 가지 않는다', (() => {
    const src = readFileSync('scripts/lib/content-core-prompts.mts', 'utf-8')
    const i = src.indexOf('export function buildV2DraftPayload')
    const body = src.slice(i, src.indexOf('\n}', i))
    return !body.includes('sourceSpans') && !body.includes('evidenceText') && !body.includes('packet')
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 B 회귀 — 관점 설명을 자녀 자격값으로 쓰지 않는다')
// ─────────────────────────────────────────────────────────
{
  const a = record('⑥', await run({
    id: 'S6', title: '아들 낳으면 왜 안쓰럽게 보는지',
    body: '딸도 딸 나름이고 아들도 진짜 엄마 잘챙기는 사람들 많이 봤거든요. 전 아직 자녀는 없지만 주위에도 저런 시선들 많이 보셨나요??',
    canned: {
      essence: {
        coreMoment: '아들을 낳은 사람을 안쓰럽게 보는 시선에 대한 의문',
        protectedFacts: [],
        sourceBeats: [beat('contrast', '아들과 딸을 두고 도는 통념과 실제로 본 모습의 어긋남', '아들도 진짜 엄마 잘챙기는 사람들')],
        participationHook: '그런 시선을 본 적 있는지', participationConfidence: 0.72,
        closingIntent: 'ask', timeSensitivity: 'evergreen',
        contentRoles: ['conversationSpark', 'experienceResonance'],
        // 🔴 앞판이 통과시킨 모양 — requiredValue 자리에 관점 설명을 넣었다
        claimRequirements: [
          claim({ id: 'c1', fact: 'children', requiredValue: '자녀 없이 주변 관찰로 쓴 글',
            evidenceText: '전 아직 자녀는 없지만' }),
        ],
      },
      draft: { title: 'x', body: 'y' },
    },
  }))
  check('🔴 🔴 **관점 설명은 자격값이 될 수 없다 — 생성하지 않는다**',
    a.draft === null && a.review.machineOutcome === 'hold')
  check('🔴 형식 문제로 남겼다', a.review.machineReason.includes('claim'), a.review.machineReason)
  check('🔴 생성 호출까지 가지 않았다', a.cost.calls.every((c) => c.stage !== 'draftGen'))
  // 🔴 coreMoment 를 원문에 없는 말로 바꾸지 않는다 — 사람이 볼 수 있게 남는다
  check('🟢 coreMoment 가 artifact 에 그대로 남는다',
    (a.essence?.coreMoment ?? '').includes('안쓰럽게'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 C 회귀 — 알바는 파트타임 Persona 와 연결된다')
// ─────────────────────────────────────────────────────────
{
  const essence = {
    coreMoment: '알바 시간을 조정하고 여행을 다녀온 뒤 동료 선물을 해야 하는지 묻는 글',
    protectedFacts: [fact('number', '9명')],
    sourceBeats: [beat('situation', '대신 일해준 사람 없이 시간을 다른 날로 채운 사정', '다른날 다 근무해요')],
    participationHook: '선물을 해야 하는지', participationConfidence: 0.75,
    closingIntent: 'ask', timeSensitivity: 'timeBound',
    contentRoles: ['usefulAnswer', 'conversationSpark'],
    claimRequirements: [
      claim({ id: 'c1', fact: 'work', requiredValue: '파트타임', selfClaim: '알바로 일하는 사람의 경험',
        stanceShiftable: true, evidenceText: '알바' }),
    ],
  }
  const body = '알바 하는데 시간 땜빵난건 다른날 다 근무해요. 직원은 9명정도되요.'
  // 🔴 파트타임 Persona 가 부하가 더 많아도 자격자가 먼저다
  const a = record('⑦', await run({
    id: 'S7', title: '알바중 여행다녀오면 선물하나요..?', body,
    canned: { essence, draft: { title: '알바 다녀와서 선물', body: '시간을 다른 날로 옮겨 다 채웠는데요. 직원이 9명이라 고민됩니다. 다들 어떻게 하세요.' } },
    load: { P01: 5, P02: 0, P04: 0 },
  }))
  check('🔴 🔴 **파트타임 Persona 가 배정된다 (부하가 많아도)**',
    a.speaker.personaCode === 'P01', String(a.speaker.personaCode))
  check('🔴 자기 경험으로 쓴다', a.speaker.stance === 'SELF_EXPERIENCE')
  check('🟢 전업 Persona 가 알바를 말하지 않는다', a.speaker.personaCode !== 'P02')
  // 자격자가 없으면 자리를 낮춘다
  const shifted = await run({
    id: 'S7b', title: '알바중 여행다녀오면 선물하나요..?', body,
    canned: { essence, draft: { title: '알바 선물 어떻게들 하세요', body: '시간을 다른 날로 옮겨 채우는 경우엔 어떻게 하시는지 궁금합니다. 직원이 9명이라면 더 그렇고요.' } },
    personas: [homemaker],
  })
  check('🔴 자격자가 없으면 자리를 낮춘다',
    shifted.speaker.stance !== null && shifted.speaker.stance !== 'SELF_EXPERIENCE',
    String(shifted.speaker.stance))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 C 회귀 — 낮춘 자리인데 자기 사실로 주장하면 잡는다')
// ─────────────────────────────────────────────────────────
{
  const essence = {
    coreMoment: '알바 시간을 조정하고 동료 선물을 해야 하는지 묻는 글',
    protectedFacts: [], sourceBeats: [beat('situation', '시간을 다른 날로 채운 사정', '다른날 다 근무해요')],
    participationHook: '선물을 해야 하는지', participationConfidence: 0.75,
    closingIntent: 'ask', timeSensitivity: 'timeBound',
    contentRoles: ['usefulAnswer'],
    claimRequirements: [
      claim({ id: 'c1', fact: 'work', requiredValue: '파트타임', selfClaim: '알바로 일하는 사람의 경험',
        stanceShiftable: true, evidenceText: '알바' }),
    ],
  }
  const violating = '제가 조정한 시간을 다른 날에 다 채우는 거거든요. 이럴 때 선물을 해야 하나요.'
  const a = record('⑧', await run({
    id: 'S8', title: '알바중 여행다녀오면 선물하나요..?',
    body: '알바 하는데 시간 땜빵난건 다른날 다 근무해요.',
    personas: [homemaker],
    canned: {
      essence,
      draft: { title: '이럴 때 선물 하시나요', body: violating },
      review: { issues: [], confidence: 0.8, note: '',
        claimViolations: [{ claimId: 'c1', evidence: '제가 조정한 시간을 다른 날에 다 채우는 거거든요', why: '알바 경험을 자기 일로 말했다' }] },
    },
  }))
  check('🔴 🔴 **QUESTION 자리인데 자기 일로 말하면 adopt 가 아니다**', a.review.machineOutcome === 'hold')
  check('🔴 어느 주장을 어디서 위반했는지 남는다',
    a.review.claimViolations.length === 1 && a.review.claimViolations[0]!.claimId === 'c1')
  check('🔴 근거가 초안에 실제로 있는 문장이다',
    violating.includes(a.review.claimViolations[0]!.evidence))
  // 🔴 초안에 없는 문장을 근거로 대면 막지 않는다
  const fake = await run({
    id: 'S8b', title: '알바중 여행다녀오면 선물하나요..?',
    body: '알바 하는데 시간 땜빵난건 다른날 다 근무해요.',
    personas: [homemaker],
    canned: {
      essence,
      draft: { title: '이럴 때 선물 하시나요', body: '그런 경우엔 어떻게들 하시는지 궁금합니다.' },
      review: { issues: [], confidence: 0.8, note: '',
        claimViolations: [{ claimId: 'c1', evidence: '제가 매일 알바를 갑니다', why: '지어낸 근거' }] },
    },
  })
  check('🔴 🔴 **지어낸 근거로는 막지 않는다**',
    fake.review.claimViolations.length === 0 && fake.review.machineOutcome === 'adopt',
    JSON.stringify(fake.review.claimViolations))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 🔴 Voice 책임 분리 — 사건 유출과 말투 불일치는 다른 것이다')
// ─────────────────────────────────────────────────────────
{
  const base = {
    id: 'S9', title: '요즘 날이 부쩍 차네요', body: '아침에 창문 열었다가 놀랐어요.',
    canned: {
      essence: {
        coreMoment: '아침 공기가 갑자기 차가워진 이야기',
        protectedFacts: [], sourceBeats: [beat('emotion', '갑작스러운 서늘함에 놀란 마음', '창문 열었다가 놀랐어요')],
        participationHook: '', participationConfidence: 0.3,
        closingIntent: 'share', timeSensitivity: 'timeBound',
        contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '아침 공기가 달라졌어요', body: '창을 여니 놀랄 만큼 서늘하더군요.' },
    },
  }
  const leak = record('⑨', await run({
    ...base, canned: { ...base.canned, review: { issues: ['voiceContentLeak'], claimViolations: [], confidence: 0.8, note: '참고 댓글의 사건이 들어왔다' } },
  }))
  check('🔴 사건 유출이면 adopt 아님', leak.review.machineOutcome === 'hold')
  check('🔴 🔴 **artifact 가 사건 유출과 말투 불일치를 나눠 남긴다**',
    leak.review.voice.contentLeak === true && leak.review.voice.mismatch === false)
  const mismatchPersona = partTime
  const mismatch = await run({
    ...base, id: 'S9b', personas: [mismatchPersona],
    canned: { ...base.canned, review: { issues: ['voiceMismatch'], claimViolations: [], confidence: 0.8, note: '그 사람 말투가 아니다' } },
  })
  check('🔴 말투 불일치도 adopt 아님', mismatch.review.machineOutcome === 'hold')
  check('🔴 🔴 **두 축이 따로 기록된다**',
    mismatch.review.voice.mismatch === true && mismatch.review.voice.contentLeak === false)
  /**
   * 🔴 **소스를 훑지 않고 실제로 간 문자열을 본다** (2026-09-19 보정).
   *    앞판은 `voice.voiceCore` 라는 **식별자 이름**이 소스에 있는지 셌다.
   *    그래서 그 이름이 가리키는 값이 **빈 문자열이어도 통과**했고,
   *    두 번째 유료 실측에서 말투 기준 없이 세 편이 그대로 나갔다.
   */
  const std = voiceStandardOf(mismatchPersona.voiceTokens)
  check('🔴 🔴 **생성·검수 요청에 말투 기준 값이 실제로 들어갔다**',
    std !== '' && sentOf('draftGen')[0]!.system.includes(std)
    && sentOf('semanticReview')[0]!.system.includes(std),
    `기준 "${std}"`)
  check('🔴 고정 할당량(이모티콘 개수·문장 길이)을 만들지 않았다', (() => {
    const src = readFileSync('src/lib/content-core/review.ts', 'utf-8')
    return src.includes('정해진 몫을 세지 않는다') && !/이모티콘 \d|문장 \d개/.test(src)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 복제 · 완주 — 🔴 기존 계약을 그대로 지킨다')
// ─────────────────────────────────────────────────────────
{
  const copied = record('⑩', await run({
    id: 'S10', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: {
      essence: {
        coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
        sourceBeats: [beat('situation', '예상보다 이르게 열어 본 장면', '좀 이른가 싶었는데')],
        participationHook: '', participationConfidence: 0.4, closingIntent: 'share',
        timeSensitivity: 'timeBound', contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '벌써 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요. 그냥 열었습니다.' },
    },
  }))
  check('🔴 🔴 **원문 실질 복제는 계속 차단된다**',
    copied.review.deterministic.failures.some((f) => f.code === 'copiedFromSource'))
  const base = {
    id: 'S10b', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: {
      essence: {
        coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
        sourceBeats: [beat('situation', '예상보다 이르게 열어 본 장면', '좀 이른가 싶었는데')],
        participationHook: '', participationConfidence: 0.4, closingIntent: 'share',
        timeSensitivity: 'timeBound', contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다. 생각보다 잘 익었더라고요.' },
    },
  }
  check('🟢 새로 쓴 초안은 통과한다', (await run(base)).review.machineOutcome === 'adopt')
  for (const stage of ['essence', 'draftGen', 'semanticReview', 'ageCheck'] as const) {
    for (const [label, fault] of [
      ['사용량 미상', { usageUnknown: stage }], ['막힘', { blocked: stage }], ['잘림', { truncate: stage }],
    ] as const) {
      const a = await run({ ...base, id: `S10-${stage}`, fault })
      check(`🔴 ${stage} ${label} → adopt 아님`, a.review.machineOutcome !== 'adopt', a.review.machineOutcome)
    }
  }
  const capped = await run({ ...base, id: 'S10c', cap: 2 })
  check('🔴 원천별 상한에 걸리면 adopt 아님', capped.review.machineOutcome !== 'adopt')
  check('🔴 상한을 넘겨 부르지 않았다', capped.cost.totalCalls <= 2)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 계약 단위 검사 · artifact')
// ─────────────────────────────────────────────────────────
{
  check('🟢 증명 가능한 값은 통과한다',
    judgeProtectedFact('number', '9명').ok && judgeProtectedFact('relation', '시어머니').ok
    && judgeProtectedFact('publicEntity', '나는솔로').ok && judgeProtectedFact('searchTerm', '갱년기').ok)
  check('🔴 🔴 **한국어 절 두 개가 protectedFact 로 들어가지 않는다**', (() => {
    const a = judgeProtectedFact('searchTerm', '남편이 집안일을 거의 돕지 않아서')
    const b = judgeProtectedFact('searchTerm', '아들을 낳으면 안쓰럽게 보는 시선')
    // 🔴 버린다 — 다른 칸으로 옮기지 않는다
    return !a.ok && a.why === 'clauseLike' && !b.ok && b.why === 'clauseLike'
  })())
  check('🔴 숫자·관계는 모양이 아니면 버린다',
    !judgeProtectedFact('number', '남편이 집안일을').ok
    && !judgeProtectedFact('relation', '우리 시어머니가').ok)
  check('🔴 공백·줄바꿈만 지운다', normalizeForProvenance('다들\n 어떻게 하시는지') === '다들어떻게하시는지')
  check('🔴 🔴 **관점 설명은 자격값이 아니다**',
    !claimValueAllowed('children', '자녀 없이 주변 관찰로 쓴 글', VOCAB)
    && !claimValueAllowed('work', '알바로 일하는 사람의 경험', VOCAB)
    && !claimValueAllowed('spouse', '', VOCAB))
  check('🟢 카드가 가진 값만 통과한다',
    claimValueAllowed('children', '있음', VOCAB) && claimValueAllowed('work', '파트타임', VOCAB)
    && claimValueAllowed('region', '수도권', VOCAB) && claimValueAllowed('childAgeBand', '중고등', VOCAB))
  check('🔴 카드에 없는 값은 막는다',
    !claimValueAllowed('work', '알바', VOCAB) && !claimValueAllowed('region', '제주', VOCAB))
  check('🔴 죽은 계약이 남아 있지 않다', (() => {
    const files = ['src/lib/content-core/essence.ts', 'src/lib/content-core/review.ts',
      'scripts/lib/content-core-run.mts', 'scripts/lib/content-core-prompts.mts',
      'src/lib/content-core/artifact.ts']
    const joined = files.map((f) => readFileSync(f, 'utf-8')).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '')
    return !/\banchors\b|alteredExactAnchors|exactAnchors|EssenceAnchor|voiceFidelity|droppedAnchors|isPersonalInfoAnchor|anchorGrounded/.test(joined)
  })())
  for (const { name, a } of results) {
    const bad = violatesArtifact(a)
    check(`${name} artifact 가 계약을 지킨다`, bad.length === 0, bad.join(' / '))
  }
  check('🔴 사람이 읽을 요약이 나온다', artifactSummary(results[0]!.a).includes('S1'))
  check('🔴 essence 프롬프트가 정본 어휘만 안내한다', (() => {
    const p = buildEssenceSystemPrompt(VOCAB)
    return p.includes('파트타임') && p.includes('requiredValue') && !p.includes('derived')
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑫ 🔴 생활사 계약 — 생성과 검수가 같은 카드를 본다')
// ─────────────────────────────────────────────────────────
{
  const BASE_E = {
    coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
    sourceBeats: [beat('situation', '예상보다 이르게 열어 본 장면', '좀 이른가 싶었는데')],
    participationHook: '', participationConfidence: 0.4, closingIntent: 'share',
    timeSensitivity: 'timeBound', contentRoles: ['conversationSpark'], claimRequirements: [],
  }
  const BASE = {
    id: 'S12', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: {
      essence: BASE_E,
      draft: { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다. 생각보다 잘 익었더라고요.' },
    },
  }
  // 🔴 essence 가 spouse claim 을 **빠뜨려도** 비혼 Persona 가 자기 남편을 말하면 잡힌다
  const a = record('⑫', await run({
    ...BASE, id: 'S12a', personas: [single],
    canned: {
      ...BASE.canned,
      draft: { title: '우리 남편이요', body: '우리 남편이 김치를 좋아해서 일찍 열었습니다. 다들 어떠세요.' },
      review: { issues: ['personaClaimValidity'], claimViolations: [], confidence: 0.9, note: '',
        lifeContradictions: [{ fact: 'spouse', drafted: '남편 있음', card: '비혼',
          evidence: '우리 남편이 김치를 좋아해서 일찍 열었습니다' }] },
    },
  }))
  check('🔴 🔴 **claim 이 없어도 비혼 Persona 의 남편 주장을 잡는다**',
    a.review.machineOutcome === 'hold' && a.review.lifeContradictions.length === 1)
  check('🔴 사유가 남았다', a.review.machineReason.includes('생활사 모순'))
  check('🔴 근거가 초안에 실제로 있는 문장이다',
    a.draft!.body.includes(a.review.lifeContradictions[0]!.evidence))
  // 🔴 카드와 다른 직업·자녀 수를 주장하면 잡는다
  const b = await run({
    ...BASE, id: 'S12b', personas: [homemaker],
    canned: {
      ...BASE.canned,
      draft: { title: '퇴근길에요', body: '회사 마치고 돌아와 아이 셋 먹이려고 열었습니다.' },
      review: { issues: ['personaClaimValidity'], claimViolations: [], confidence: 0.9, note: '',
        lifeContradictions: [
          { fact: 'work', drafted: '회사 다님', card: '전업', evidence: '회사 마치고 돌아와' },
          { fact: 'children', drafted: '자녀 3', card: '자녀 1', evidence: '아이 셋 먹이려고' }] },
    },
  })
  check('🔴 🔴 **카드와 다른 직업·자녀 수를 잡는다**',
    b.review.machineOutcome === 'hold' && b.review.lifeContradictions.length === 2)
  // 🔴 지어낸 근거로는 막지 않는다
  const c = await run({
    ...BASE, id: 'S12c', personas: [homemaker],
    canned: {
      ...BASE.canned,
      review: { issues: [], claimViolations: [], confidence: 0.9, note: '',
        lifeContradictions: [{ fact: 'work', drafted: 'x', card: 'y', evidence: '초안에 없는 문장입니다' }] },
    },
  })
  check('🔴 지어낸 생활사 근거는 무시한다',
    c.review.lifeContradictions.length === 0 && c.review.machineOutcome === 'adopt')
  // 🔴 생활사를 글에 나열하지 않는다 — 프롬프트가 그렇게 말한다
  const gen = buildV2DraftSystemPrompt({
    essence: { ...BASE_E, essenceVersion: 'x', contextSufficiency: 'sufficient', insufficientReasons: [] } as never,
    plan: { decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE', unmetClaims: [],
      coverageGap: null, reason: '', planVersion: 'x' },
    voice: buildVoiceEvidence({ personaCode: 'P02', voiceTokens: ['짧은 문장'], samples: [],
      bundleDigest: 'b', sourceDigest: 's' }),
    life: homemaker,
  })
  check('🔴 🔴 **생성이 생활사를 받되 욱여넣지 말라고 말한다**',
    gen.includes('전부 욱여넣지 않습니다') && gen.includes('새로 지어내지 않습니다'))
  check('🔴 생활사 값이 카드에서 온다',
    lifeContractLines(homemaker).some((x) => x.includes('전업'))
    && lifeContractLines(homemaker).some((x) => x.includes('자녀 1명')))
  // 🔴 noGo 를 소재 전체 금지로 읽지 않는다
  const withNoGo = buildV2DraftSystemPrompt({
    essence: { ...BASE_E, essenceVersion: 'x', contextSufficiency: 'sufficient', insufficientReasons: [] } as never,
    plan: { decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE', unmetClaims: [],
      coverageGap: null, reason: '', planVersion: 'x' },
    voice: buildVoiceEvidence({ personaCode: 'P02', voiceTokens: ['짧은 문장'], samples: [],
      bundleDigest: 'b', sourceDigest: 's' }),
    life: P({ code: 'P05', noGoTopics: ['시어머니 험담'] }),
  })
  check('🔴 🔴 **noGo 를 주제 전체 금지로 과잉 해석하지 않는다**',
    withNoGo.includes('통째로 막는 뜻이 아닙니다'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑬ 🔴 브리프 왜곡 — 정리한 뜻이 원문을 뒤집으면 막는다')
// ─────────────────────────────────────────────────────────
{
  const a = record('⑬', await run({
    id: 'S13', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: {
      essence: {
        // 🔴 원문 근거는 "김치를 꺼냈다" 인데 뜻은 "회사가 망했다" 다
        coreMoment: '김치 때문에 회사가 망한 이야기', protectedFacts: [],
        sourceBeats: [beat('situation', '김치 때문에 회사가 망했다', '좀 이른가 싶었는데')],
        participationHook: '', participationConfidence: 0.4, closingIntent: 'share',
        timeSensitivity: 'timeBound', contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '회사가 그렇게 됐어요', body: '그 일 때문에 회사가 문을 닫았습니다. 다들 어떠세요.' },
      review: { issues: ['briefDistortion'], claimViolations: [], lifeContradictions: [],
        confidence: 0.9, note: '원문 근거에 회사 이야기가 없다' },
    },
  }))
  check('🔴 🔴 **briefDistortion 이면 adopt 하지 않는다**', a.review.machineOutcome === 'hold')
  check('🔴 사유가 남았다', a.review.machineReason.includes('briefDistortion'))
  check('🔴 🔴 **검수가 원문 근거를 함께 받는다**', (() => {
    const src = readFileSync('scripts/lib/content-core-prompts.mts', 'utf-8')
    const i = src.indexOf('export function buildV2ReviewPayload')
    const body = src.slice(i)
    return body.includes('원문근거') && body.includes('정리한뜻') && body.includes('초안')
  })())
  check('🔴 생성에는 원문 근거를 보내지 않는다', (() => {
    const src = readFileSync('scripts/lib/content-core-prompts.mts', 'utf-8')
    const i = src.indexOf('export function buildV2DraftPayload')
    const body = src.slice(i, src.indexOf('export function buildV2ReviewSystemPrompt', i))
    return !body.includes('packet') && !body.includes('evidenceText') && !body.includes('spans')
  })())
  /**
   * 🔴 **`sourceFidelity` 는 축에서 없앴다** — 누락과 창작을 겸해 사람이 무엇을
   *    고쳐야 할지 알 수 없었다. 이름이 와도 우리 축이 아니므로 통과가 아니고,
   *    **그 하나만으로 막지도 않는다** — 근거를 가진 두 구조가 대신 맡는다.
   */
  const vague = await run({
    id: 'S13c', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: {
      essence: { coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
        sourceBeats: [beat('situation', '예상보다 이르게 열어 본 장면', '좀 이른가 싶었는데')],
        closingIntent: 'share', contentRoles: ['conversationSpark'], claimRequirements: [] },
      draft: { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다. 생각보다 잘 익었더라고요.' },
      review: { issues: ['sourceFidelity'], missingBeatIds: [], unsupportedAdditions: [],
        claimViolations: [], lifeContradictions: [], confidence: 0.8, note: '두루뭉술' },
    },
  })
  check('🔴 🔴 **sourceFidelity 는 우리 축이 아니다 — 이름만으로 막지 않는다**',
    vague.review.semantic!.issues.length === 0
    && vague.review.semantic!.unknownIssues.includes('sourceFidelity'))
  check('🔴 한 번의 semanticReview 가 넷을 함께 본다', (() => {
    const src = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '')
    return (src.match(/ask\('semanticReview'/g) ?? []).length === 1
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑭ 🔴 생성에 실제로 간 문자열 — 정규식이 아니라 값으로 본다')
// ─────────────────────────────────────────────────────────
{
  const BODY = '시간 땜빵난건 다른날 다 근무해요. 직원은 9명정도되요.'
  const E = {
    coreMoment: '근무 시간을 옮겨 채우고 동료 선물을 해야 하는지 묻는 이야기',
    protectedFacts: [fact('number', '9명')],
    sourceBeats: [beat('situation', '남이 대신해 준 것이 아니라 스스로 시간을 메운 사정', '다른날 다 근무해요')],
    participationHook: '선물을 해야 하는지', participationConfidence: 0.8,
    closingIntent: 'ask', timeSensitivity: 'evergreen',
    contentRoles: ['usefulAnswer'], claimRequirements: [],
  }
  const DRAFT = { title: '이럴 때 선물 하시나요', body: '시간을 옮겨 스스로 메웠는데요. 직원이 9명이라 고민됩니다. 다들 어떻게 하세요.' }

  const a = record('⑭', await run({
    id: 'S14', title: '알바중 여행다녀오면 선물하나요..?', body: BODY,
    canned: { essence: E, draft: DRAFT },
  }))
  const sent = sentOf('draftGen')[0]!
  const both = `${sent.system}\n${sent.payload}`
  check('🔴 🔴 **원문 문구가 생성에 가지 않는다**',
    !both.includes('시간 땜빵난건') && !both.includes('직원은 9명정도되요')
    && !both.includes('다른날 다 근무해요'))
  check('🟢 검증된 protectedFact 는 전달된다', both.includes('9명'))
  check('🟢 모델이 정리한 뜻은 전달된다', both.includes('스스로 시간을 메운 사정'))
  check('🔴 정상 호출 4회', a.cost.totalCalls === 4, `${a.cost.totalCalls}회`)
  check('🔴 검수는 원문 근거를 받는다 (생성과 다르다)', (() => {
    const r = sentOf('semanticReview')[0]!
    return r.payload.includes('시간 땜빵난건')
  })())

  // 🔴 9명이 빠지면 잡힌다
  const missing = await run({
    id: 'S14b', title: '알바중 여행다녀오면 선물하나요..?', body: BODY,
    canned: { essence: E, draft: { title: '이럴 때 선물 하시나요', body: '시간을 옮겨 스스로 메웠는데요. 사람이 꽤 되어 고민됩니다. 다들 어떻게 하세요.' } },
  })
  check('🔴 🔴 **검증된 사실이 빠지면 잡는다**',
    missing.review.deterministic.failures.some((f) => f.code === 'protectedFactMissing'))

  // 🔴 protectedFacts 0개여도 완주
  const none = await run({
    id: 'S14c', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: {
      essence: { ...E, coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
        sourceBeats: [beat('situation', '예상보다 이르게 열어 본 장면', '좀 이른가 싶었는데')],
        closingIntent: 'share', contentRoles: ['conversationSpark'] },
      draft: { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다. 생각보다 잘 익었더라고요.' },
    },
  })
  check('🟢 protectedFacts 0개여도 완주한다',
    none.review.machineOutcome === 'adopt' && none.cost.totalCalls === 4)

  // 🔴 실질 복제는 계속 차단
  const copy = await run({
    id: 'S14d', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: {
      essence: { ...E, coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
        sourceBeats: [beat('situation', '예상보다 이르게 열어 본 장면', '좀 이른가 싶었는데')],
        closingIntent: 'share', contentRoles: ['conversationSpark'] },
      draft: { title: '벌써 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요. 그냥 열었습니다.' },
    },
  })
  check('🔴 원문 실질 복제는 계속 차단된다',
    copy.review.deterministic.failures.some((f) => f.code === 'copiedFromSource'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑮ 🔴 말투 계약 — 빈 Voice 가 조용히 지나가지 못한다')
// ─────────────────────────────────────────────────────────
{
  const E = {
    coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
    sourceBeats: [beat('situation', '예상보다 이르게 열어 본 장면', '좀 이른가 싶었는데', 'head', 'b1')],
    closingIntent: 'share', contentRoles: ['conversationSpark'], claimRequirements: [],
  }
  const DRAFT = { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다. 생각보다 잘 익었더라고요.' }
  const src = { title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.' }

  const noVoice = await run({
    id: 'S15a', title: src.title, body: src.body, canned: { essence: E, draft: DRAFT },
    personas: [P({ code: 'P01', voiceTokens: [] })],
  })
  check('🔴 🔴 **말투 기준이 비면 초안을 만들지 않는다**',
    noVoice.draft === null && noVoice.review.machineOutcome === 'hold',
    noVoice.review.machineReason)
  check('🔴 🔴 **묻기 전에 멈춘다 — 소재 판정 1회만 쓴다**',
    noVoice.cost.totalCalls === 1, `${noVoice.cost.totalCalls}회`)

  const fewSamples = await run({
    id: 'S15b', title: src.title, body: src.body, canned: { essence: E, draft: DRAFT },
    personas: [P({ code: 'P01', samples: ['그러게요'] })],
  })
  check(`🔴 🔴 **말투 참고가 ${VOICE_SAMPLE_MIN}건보다 적으면 만들지 않는다**`,
    fewSamples.draft === null && fewSamples.cost.totalCalls === 1, fewSamples.review.machineReason)

  const ok = await run({
    id: 'S15c', title: src.title, body: src.body, canned: { essence: E, draft: DRAFT },
    personas: [P({ code: 'P01', voiceTokens: ['짧은 문장', '~해요 기본', '줄바꿈 잦음'] })],
  })
  const std = voiceStandardOf(['짧은 문장', '~해요 기본', '줄바꿈 잦음'])
  check('🟢 말투가 갖춰지면 완주한다', ok.review.machineOutcome === 'adopt' && ok.cost.totalCalls === 4)
  check('🔴 🔴 **생성 요청에 말투 기준 값이 들어갔다**', sentOf('draftGen')[0]!.system.includes(std))
  check('🔴 🔴 **검수 요청에 같은 말투 기준 값이 들어갔다**', sentOf('semanticReview')[0]!.system.includes(std))
  check('🔴 말투 근거가 몇 토큰에서 나왔는지 남는다',
    ok.voice.provenance!.voiceTokenCount === 3 && ok.voice.provenance!.sampleCount === 2)
  check('🔴 정본 변환은 하나다 — voiceTokens 를 그대로 받는다',
    voiceStandardOf(['a', '', ' b ']) === 'a · b')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑯ 🔴 B 회귀 — "자녀 없음" 때문에 생성 0건이 되지 않는다')
// ─────────────────────────────────────────────────────────
{
  const TITLE = '아들 딸 이야기'
  const BODY = '전 아직 자녀는 없지만 주변을 보면 아들이 엄마를 잘 챙기더라고요. 안쓰럽게 보는 시선이 있잖아요.'
  const E = {
    coreMoment: '아들을 안쓰럽게 보는 시선과 실제로 잘 챙기는 아들들',
    protectedFacts: [fact('relation', '아들')],
    sourceBeats: [
      beat('contrast', '아들을 낳으면 안쓰럽게 본다는 시선과 실제로 잘 챙기는 아들들', '안쓰럽게 보는 시선이 있잖아요', 'head', 'b1'),
    ],
    closingIntent: 'share', contentRoles: ['conversationSpark'],
    claimRequirements: [claim({ fact: 'children', requiredValue: '없음', stanceShiftable: true, evidenceText: '전 아직 자녀는 없지만' })],
  }
  const DRAFT = { title: '아들 키우는 분들 보면', body: '아들이 엄마를 참 잘 챙기더라고요. 안쓰럽다는 말도 들리는데 꼭 그렇지만은 않아 보여요.' }

  const b = await run({
    id: 'S16a', title: TITLE, body: BODY, canned: { essence: E, draft: DRAFT },
    personas: [P({ code: 'P04', childrenCount: 0 })],
  })
  check('🔴 🔴 **children="없음" 이 자격값으로 받아들여진다**',
    b.essence!.claimRequirements.length === 1
    && b.essence!.claimRequirements[0]!.requiredValue === '없음')
  check('🔴 🔴 **schema 문제로 생성 0건이 되지 않는다**', b.draft !== null, b.review.machineReason)
  check('🔴 🔴 **자녀 0인 사람이 1인칭으로 쓴다**',
    b.speaker.personaCode === 'P04' && b.speaker.stance === 'SELF_EXPERIENCE')
  check('🔴 자녀가 있는 사람은 이 자격을 채우지 못한다', (await run({
    id: 'S16b', title: TITLE, body: BODY, canned: { essence: E, draft: DRAFT },
    personas: [P({ code: 'P02', childrenCount: 2, childrenAgeBands: ['중고등'] as ChildAgeBand[] })],
  })).speaker.stance !== 'SELF_EXPERIENCE')
  check('🔴 🔴 **다른 presence 축에는 "없음" 을 붙이지 않았다**',
    !claimValueAllowed('spouse', '없음', VOCAB)
    && !claimValueAllowed('parentCare', '없음', VOCAB)
    && !claimValueAllowed('menopause', '없음', VOCAB)
    && claimValueAllowed('children', '없음', VOCAB))
  check('🔴 관찰로 살릴 수 있으면 claim 을 만들지 말라고 요청한다',
    buildEssenceSystemPrompt(VOCAB).includes('거의 언제나 빈 목록이다'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑰ 🔴 사건 창작 · 필수 결 누락 — 근거를 가진 두 구조가 잡는다')
// ─────────────────────────────────────────────────────────
{
  // ── A 실측: 원문에 없는 주말 밥상 · 아이 학용품 장면 ──
  const A_BODY = 'tv에 나오는 남편들은 집안일도 잘하고 챙겨주던데 왜 저희 애아빠는 안그럴까요'
  const A_E = {
    coreMoment: '방송 속 남편들과 달리 자기 남편은 집안일을 돕지 않아 답답하다',
    protectedFacts: [fact('relation', '남편', 'title')],
    sourceBeats: [
      beat('contrast', '방송에서 본 이상과 현실의 차이', 'tv에 나오는 남편들은', 'head', 'b1'),
      beat('emotion', '현실에 대한 실망감과 의문', '왜 저희 애아빠는 안그럴까요', 'head', 'b2'),
    ],
    closingIntent: 'ask', contentRoles: ['conversationSpark', 'experienceResonance'],
    claimRequirements: [claim({ fact: 'spouse', requiredValue: '있음', stanceShiftable: false, evidenceText: 'tv에 나오는 남편들은' })],
  }
  const A_DRAFT = {
    title: '요즘 드라마 남편들은 다 왜 그럴까요',
    body: '어제 저녁에 드라마를 봤는데 남편이 밥하고 설거지까지 하더라고요.\n'
      + '주말에 한번 밥 차려달라고 하면 난리가 나고, 아이들 학용품 챙겨달라고 하면 못 봤대요.\n'
      + '다들 어떠신지 궁금해요.',
  }
  const a = await run({
    id: 'S17a', title: '남편 이야기', body: A_BODY,
    personas: [P({ code: 'P01', childrenCount: 2, childrenAgeBands: ['중고등'] as ChildAgeBand[] })],
    canned: {
      essence: A_E, draft: A_DRAFT,
      review: { issues: [], missingBeatIds: [], claimViolations: [], lifeContradictions: [],
        unsupportedAdditions: [
          { evidence: '주말에 한번 밥 차려달라고 하면 난리가 나고, 아이들 학용품 챙겨달라고 하면 못 봤대요.', why: '원문에 없는 장면' },
        ], confidence: 0.85, note: '' },
    },
  })
  check('🔴 🔴 **A 회귀 — 원문에 없는 새 사건을 잡는다**',
    a.review.machineOutcome === 'hold' && a.review.semantic!.unsupportedAdditions.length === 1)
  check('🔴 사유가 초안 속 문장을 가리킨다', a.review.machineReason.includes('아이들 학용품'))

  // ── C 실측: "휴가를 냈다" 창작 + "다른 날 근무를 채웠다" 누락 ──
  const C_BODY = '알바중인데 여행을 다녀오려고요. 다른 날 근무를 채워서 시간을 옮겼어요. 같이 일하는 사람이 9명인데 선물 사와야 하나요.'
  const C_E = {
    coreMoment: '알바 중 여행을 다녀올 때 함께 일하는 사람들에게 선물을 줘야 하는지 궁금하다',
    protectedFacts: [fact('number', '9명')],
    sourceBeats: [
      beat('situation', '대타 없이 다른 날 근무로 본인이 시간을 메웠다', '다른 날 근무를 채워서 시간을 옮겼어요', 'head', 'b1'),
      beat('participation', '선물이 관례인지 묻는다', '선물 사와야 하나요', 'head', 'b2'),
    ],
    closingIntent: 'ask', contentRoles: ['usefulAnswer', 'conversationSpark'],
    claimRequirements: [claim({ fact: 'work', requiredValue: '파트타임', stanceShiftable: true, evidenceText: '알바중인데' })],
  }
  const C_DRAFT = {
    title: '알바 다녀올 때 선물 문제',
    body: '휴가를 내고 여행을 다녀오려는데요. 같이 일하는 사람이 9명이라 선물을 챙겨야 하나 싶어요.\n어떻게들 하시는지 궁금합니다.',
  }
  const c = await run({
    id: 'S17b', title: '알바중 여행다녀오면 선물하나요..?', body: C_BODY,
    personas: [P({ code: 'P01', workStatus: '파트타임', childrenCount: 2, childrenAgeBands: ['중고등'] as ChildAgeBand[] })],
    canned: {
      essence: C_E, draft: C_DRAFT,
      review: { issues: [], claimViolations: [], lifeContradictions: [],
        missingBeatIds: ['b1'],
        unsupportedAdditions: [{ evidence: '휴가를 내고 여행을 다녀오려는데요.', why: '원문은 근무를 옮긴 것이다' }],
        confidence: 0.85, note: '' },
    },
  })
  check('🔴 🔴 **C 회귀 — "휴가를 냈다" 를 잡는다**',
    c.review.semantic!.unsupportedAdditions.some((x) => x.evidence.includes('휴가를 내고')))
  check('🔴 🔴 **C 회귀 — 사라진 필수 결을 id 로 가리킨다**',
    c.review.semantic!.missingBeatIds.includes('b1'))
  check('🔴 둘 중 하나라도 실질적이면 adopt 하지 않는다', c.review.machineOutcome === 'hold')

  // ── 🔴 과차단 방지 ①: 초안에 없는 문장은 근거로 인정하지 않는다 ──
  const ghost = await run({
    id: 'S17c', title: '알바중 여행다녀오면 선물하나요..?', body: C_BODY,
    personas: [P({ code: 'P01', workStatus: '파트타임' })],
    canned: {
      essence: C_E,
      draft: { title: '다녀올 때 선물 하시나요', body: '근무를 다른 날로 옮겨 두고 다녀오려고요. 함께 일하는 사람이 9명이라 고민입니다. 어떻게들 하시나요.' },
      review: { issues: [], claimViolations: [], lifeContradictions: [], missingBeatIds: [],
        unsupportedAdditions: [{ evidence: '남편이 태워다 준다고 했어요', why: '지어낸 근거' }],
        confidence: 0.8, note: '' },
    },
  })
  check('🔴 🔴 **초안에 없는 문장으로는 막지 않는다**',
    ghost.review.semantic!.unsupportedAdditions.length === 0)

  // ── 🔴 과차단 방지 ②: 우리가 건네지 않은 결 이름으로는 막지 않는다 ──
  const ghostBeat = await run({
    id: 'S17d', title: '알바중 여행다녀오면 선물하나요..?', body: C_BODY,
    personas: [P({ code: 'P01', workStatus: '파트타임' })],
    canned: {
      essence: C_E,
      draft: { title: '다녀올 때 선물 하시나요', body: '근무를 다른 날로 옮겨 두고 다녀오려고요. 함께 일하는 사람이 9명이라 고민입니다. 어떻게들 하시나요.' },
      review: { issues: [], claimViolations: [], lifeContradictions: [],
        missingBeatIds: ['b9', ''], unsupportedAdditions: [], confidence: 0.8, note: '' },
    },
  })
  check('🔴 🔴 **모르는 결 이름으로는 막지 않는다**',
    ghostBeat.review.semantic!.missingBeatIds.length === 0
    && ghostBeat.review.machineOutcome === 'adopt')

  // ── 🔴 과차단 방지 ③: 짧은 일상글을 억지로 늘리지 않는다 ──
  const short = await run({
    id: 'S17e', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: {
      essence: { coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
        sourceBeats: [beat('situation', '예상보다 이르게 열어 본 장면', '좀 이른가 싶었는데', 'head', 'b1')],
        closingIntent: 'share', contentRoles: ['conversationSpark'], claimRequirements: [] },
      draft: { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다.' },
      review: { issues: [], missingBeatIds: [], unsupportedAdditions: [],
        claimViolations: [], lifeContradictions: [], confidence: 0.9, note: '' },
    },
  })
  check('🟢 🔴 **짧고 새 사건 없는 글은 과차단하지 않는다**',
    short.review.machineOutcome === 'adopt' && short.cost.totalCalls === 4)

  // ── 🔴 재료 경계가 실제로 요청에 들어간다 ──
  check('🔴 🔴 **생성이 받는 결에 안정적인 id 가 붙는다**', (() => {
    const payload = JSON.parse(sentOf('draftGen')[0]!.payload) as { beats: { id: string; meaning: string }[] }
    return payload.beats.length === 1 && payload.beats[0]!.id === 'b1'
  })())
  check('🔴 생성 요청이 재료 경계를 말한다',
    sentOf('draftGen')[0]!.system.includes('이 셋 밖의 장면')
    && sentOf('draftGen')[0]!.system.includes('재료가 적으면 짧게 씁니다'))
  check('🔴 검수 요청이 결 목록을 id 로 받는다',
    sentOf('semanticReview')[0]!.system.includes('[b1]'))
  check('🔴 검수 요청이 생활사 카드 사실은 새 사건이 아니라고 말한다',
    sentOf('semanticReview')[0]!.system.includes('이것들은 새 사건이 아니다'))
  check('🔴 검수에 원문 근거가 계속 간다',
    sentOf('semanticReview')[0]!.payload.includes('원문근거'))
  check('🔴 생성에는 원문 조각이 가지 않는다',
    !sentOf('draftGen')[0]!.payload.includes('좀 이른가 싶었는데'))
  check('🔴 정상 경로는 여전히 4회다', short.cost.totalCalls === 4)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 검사다 — 실제 모델이 재미있는 글을 쓰는지는 증명하지 않았다.')
console.log('🔴 통과 수는 제품 성공이 아니다. 사람 READY 판정은 아직 0건이다.')
if (fail > 0) process.exit(1)
