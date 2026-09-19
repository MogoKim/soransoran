#!/usr/bin/env tsx
/**
 * Content Core v2 행동 검사 — 🔴 **네트워크 0 · 실제 provider 0 · DB 0**
 *
 * 🔴 **정규식이 있는지 세지 않는다.** 실제 함수를 돌려 나온 `HumanReviewArtifact`
 *    값으로 본다. 통과 수는 제품 성공이 아니다.
 *
 * 🔴 **못 하는 것**: 실제 모델이 재미있는 글을 쓰는가. 가짜 provider 는 정해진
 *    답을 돌려준다. 그것은 사람 blind 평가와 유료 실측으로만 확인된다.
 *
 * 🔴 **이 판의 핵심 검사**: 생성 모델이 **마스킹된 원문을 직접 받는가.**
 *    앞판은 앞 AI 가 만든 요약만 받았고, 그래서 원문의 말이 단계마다 변했다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { runContentCore, personaInputOf, type Ask, type AskResult, type PersonaInput }
  from './lib/content-core-run.mjs'
import {
  buildEssenceSystemPrompt, buildV2DraftSystemPrompt, lifeContractLines, sourceBlock,
  type ClaimVocabulary,
} from './lib/content-core-prompts.mjs'
import { isContentCoreV2Enabled, CONTENT_CORE_V2_ENV, CONTENT_CORE_V2_FLAG_REMOVE_AT }
  from '../src/lib/content-core/flag'
import { vocabularyOf } from '../src/lib/content-core/speaker'
import { EVIDENCE_CHAR_BUDGET, buildEvidencePacket } from '../src/lib/content-core/evidence'
import { claimValueAllowed, judgeProtectedFact, normalizeForProvenance }
  from '../src/lib/content-core/essence'
import { SEMANTIC_AXES } from '../src/lib/content-core/review'
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

type Canned = { essence?: unknown; draft?: unknown; review?: unknown }
const okRes = (text: string): AskResult => ({
  ok: true, rawText: text, truncated: false, usageKnown: true,
  inputTokens: 100, outputTokens: 20, usd: 0.0001, blocked: false,
})
const EMPTY_REVIEW = {
  droppedFromSource: [], unsupportedAdditions: [], lifeContradictions: [],
  issues: [], confidence: 0.9, note: '',
}
const pick = (c: Canned, stage: string): string => JSON.stringify(
  stage === 'essence' ? c.essence ?? {}
    : stage === 'draftGen' ? c.draft ?? {}
      : c.review ?? EMPTY_REVIEW)

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
 *    이 경로가 곧 시험 harness · 운영 runner 가 쓰는 경로다.
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
const claim = (o: { id?: string; fact: string; requiredValue: string; selfClaim?: string
  stanceShiftable?: boolean; evidenceRef?: string; evidenceText: string }): unknown => ({
  id: o.id ?? 'c1', fact: o.fact, requiredValue: o.requiredValue,
  selfClaim: o.selfClaim ?? '', stanceShiftable: o.stanceShiftable ?? false,
  evidenceRef: o.evidenceRef ?? 'head', evidenceText: o.evidenceText,
})
/** 🔴 실제 원문 셋 — 세 번의 유료 실측에서 쓴 바로 그 글이다 */
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

// ─────────────────────────────────────────────────────────
console.log('\n① 🔴 🔴 생성이 받는 것 — **마스킹된 원문 그 자체**')
// ─────────────────────────────────────────────────────────
{
  const a = await run({
    id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [P({ code: 'P01', workStatus: '파트타임' })],
    canned: {
      essence: { coreMoment: '알바 중 여행 선물이 관례인지 묻는다',
        protectedFacts: [fact('number', '3시간'), fact('number', '9명')],
        closingIntent: 'ask', contentRoles: ['usefulAnswer'],
        claimRequirements: [claim({ fact: 'work', requiredValue: '파트타임', stanceShiftable: true, evidenceText: '알바중', evidenceRef: 'title' })] },
      draft: { title: '다녀올 때 선물 하시나요',
        body: '대신 서 준 사람은 없고 빈 자리는 제가 다른 날 채웁니다. 3시간씩 일하고 9명이에요. 선물 사 가시나요.' },
    },
  })
  const payload = sentOf('draftGen')[0]!.payload
  check('🔴 🔴 **생성 payload 에 원문 본문이 그대로 들어간다**',
    normalizeForProvenance(payload).includes(normalizeForProvenance('누가 대타뛰어준건 아니고')))
  check('🔴 🔴 **원문 제목도 들어간다**',
    normalizeForProvenance(payload).includes(normalizeForProvenance(SRC.C.title)))
  check('🔴 🔴 **요약(coreMoment)은 생성에 가지 않는다**',
    !payload.includes('관례인지 묻는다'))
  check('🔴 검수도 같은 원문을 본다',
    normalizeForProvenance(sentOf('semanticReview')[0]!.payload)
      .includes(normalizeForProvenance('3시간씩하는데')))
  check('🔴 🔴 **정상 경로 호출 3회** (앞판 4회)', a.cost.totalCalls === 3, `${a.cost.totalCalls}회`)
  check('🔴 단계는 셋뿐이다',
    a.cost.calls.map((c) => c.stage).join(',') === 'essence,draftGen,semanticReview')
  check('🟢 기계 판정이 나왔고 사람 칸은 비어 있다',
    a.review.machineOutcome === 'adopt' && a.humanDecision.verdict === null)
  check('🔴 사람이 읽는 한 줄이 남는다', artifactSummary(a).includes('사람 미판정'))
  check('🔴 담지 말아야 할 것이 없다', violatesArtifact(a).length === 0, violatesArtifact(a).join(' · '))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 사진·앞 대화가 있어야 아는 글 — 🔴 생성 0 · 유료 0')
// ─────────────────────────────────────────────────────────
{
  const a = await run({
    id: 'S2', title: '이거 어떤가요', body: '아래 사진을 보고 알려주세요. 지난 글에 이어서요.',
    canned: { draft: { title: 'x', body: 'y' } },
  })
  check('🔴 확인 못 함으로 섰다', a.evidence.contextSufficiency === 'insufficient')
  check('🔴 사진·앞 글 둘 다 짚었다',
    a.evidence.insufficientReasons.includes('needsImage')
    && a.evidence.insufficientReasons.includes('needsPriorThread'))
  check('🔴 🔴 **묻기 전에 멈춘다 — 유료 0회**', a.cost.totalCalls === 0 && a.draft === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 A 회귀 — TV 속 남편과 현실의 차이')
// ─────────────────────────────────────────────────────────
{
  const husband = P({ code: 'P01', childrenCount: 2, childrenAgeBands: ['중고등'] as ChildAgeBand[] })
  const E = {
    coreMoment: '방송 속 남편들과 달리 자기 남편은 집안일을 돕지 않는다',
    protectedFacts: [fact('relation', '남편', 'title')],
    closingIntent: 'ask', contentRoles: ['conversationSpark', 'experienceResonance'],
    claimRequirements: [claim({ fact: 'spouse', requiredValue: '있음', evidenceText: '왜 저희 애아빠는 안그럴까요' })],
  }
  const GOOD = { title: '방송 속 남편들 보면요',
    body: '화면에 나오는 남편들은 집안일을 곧잘 하던데 우리 집은 딴판이에요.\n방송이라 그런 걸까요.' }

  // 🔴 좋은 초안 — 과차단하지 않는다
  const ok = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [husband], canned: { essence: E, draft: GOOD } })
  check('🔴 🔴 **생성이 원문의 TV·현실 대비를 직접 받는다**',
    normalizeForProvenance(sentOf('draftGen')[0]!.payload)
      .includes(normalizeForProvenance('티비에는 집안일 돕는 남편들')))
  check('🟢 짧고 새 사건 없는 초안은 통과한다', ok.review.machineOutcome === 'adopt')
  check('🟢 짧은 초안을 길이로 막지 않는다', ok.review.deterministic.pass)

  // 🔴 주말 밥상·학용품 — 원문에 없는 장면
  const invented = await run({
    id: SRC.A.id, title: SRC.A.title, body: SRC.A.body, personas: [husband],
    canned: { essence: E,
      draft: { title: '요즘 드라마 남편들은',
        body: '어제 드라마를 봤어요.\n주말에 한번 밥 차려달라고 하면 난리가 나고, 아이들 학용품 챙겨달라고 하면 못 봤대요.' },
      review: { ...EMPTY_REVIEW, confidence: 0.85, unsupportedAdditions: [
        { evidence: '주말에 한번 밥 차려달라고 하면 난리가 나고, 아이들 학용품 챙겨달라고 하면 못 봤대요.', why: '원문에 없는 장면' },
      ] } },
  })
  check('🔴 🔴 **A — 주말 밥상·학용품 같은 새 장면을 잡는다**',
    invented.review.machineOutcome === 'hold'
    && invented.review.unsupportedAdditions.length === 1)
  check('🔴 사유가 초안 속 문장을 가리킨다', invented.review.machineReason.includes('학용품'))

  // 🔴 TV·현실 대비가 사라진 초안
  const dropped = await run({
    id: SRC.A.id, title: SRC.A.title, body: SRC.A.body, personas: [husband],
    canned: { essence: E,
      draft: { title: '남편들 집안일 하시나요', body: '다들 남편이 집안일 얼마나 하시는지 궁금해요.' },
      review: { ...EMPTY_REVIEW, confidence: 0.8, droppedFromSource: [
        { evidence: '티비에는 집안일 돕는 남편들 많이 나오던데', why: '방송과 현실의 대비가 사라졌다' },
      ] } },
  })
  check('🔴 🔴 **A — 원문의 핵심 대비가 사라지면 잡는다**',
    dropped.review.machineOutcome === 'hold' && dropped.review.droppedFromSource.length === 1)
  check('🔴 근거가 **원문** 문장이다',
    SRC.A.body.includes(dropped.review.droppedFromSource[0]!.evidence))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 B 회귀 — "안쓰럽게 보는 시선" 이 생성까지 그대로 간다')
// ─────────────────────────────────────────────────────────
{
  const E = {
    coreMoment: '아들을 안쓰럽게 보는 시선에 대한 물음',
    protectedFacts: [fact('relation', '아들')],
    closingIntent: 'ask', contentRoles: ['conversationSpark'],
    claimRequirements: [claim({ fact: 'children', requiredValue: '없음', stanceShiftable: true, evidenceText: '전 아직 자녀는 없지만' })],
  }
  const GOOD = { title: '아들 낳으면 왜 그런 눈으로 볼까요',
    body: '아들 낳았다고 하면 딱하게 보는 분위기가 있잖아요.\n그런데 곁에서 보면 아들이 엄마를 참 잘 챙기더라고요.\n'
      + '엄마 성격에 따라 아들이 더 맞는 경우도 있고요.\n다들 그런 시선 겪어 보셨어요?' }

  const b = await run({ id: SRC.B.id, title: SRC.B.title, body: SRC.B.body,
    personas: [P({ code: 'P04', childrenCount: 0 })], canned: { essence: E, draft: GOOD } })
  const payload = sentOf('draftGen')[0]!.payload
  check('🔴 🔴 **원문의 "안쓰럽게" 가 생성에 그대로 전달된다**', payload.includes('안쓰럽게'))
  check('🔴 🔴 **"아들도 엄마 잘챙기는" 도 전달된다**',
    normalizeForProvenance(payload).includes(normalizeForProvenance('아들도 진짜 엄마 잘챙기는 사람들')))
  check('🔴 🔴 **"엄마 성향에 따라서" 도 전달된다**',
    normalizeForProvenance(payload).includes(normalizeForProvenance('엄마 성향에 따라서')))
  check('🔴 🔴 **children="없음" 으로 생성까지 도달한다**', b.draft !== null, b.review.machineReason)
  check('🔴 자녀 0인 사람이 1인칭으로 쓴다',
    b.speaker.personaCode === 'P04' && b.speaker.stance === 'SELF_EXPERIENCE')
  check('🟢 세 축을 다 살린 초안은 통과한다', b.review.machineOutcome === 'adopt')

  check('🔴 자녀가 있는 사람은 이 자격을 채우지 못한다', (await run({
    id: SRC.B.id, title: SRC.B.title, body: SRC.B.body, canned: { essence: E, draft: GOOD },
    personas: [P({ code: 'P02', childrenCount: 2, childrenAgeBands: ['중고등'] as ChildAgeBand[] })],
  })).speaker.stance !== 'SELF_EXPERIENCE')
  check('🔴 🔴 **다른 presence 축에는 "없음" 을 붙이지 않았다**',
    !claimValueAllowed('spouse', '없음', VOCAB)
    && !claimValueAllowed('parentCare', '없음', VOCAB)
    && !claimValueAllowed('menopause', '없음', VOCAB)
    && claimValueAllowed('children', '없음', VOCAB))

  // 🔴 축하 횟수·친구 경험 — 원문에 없는 장면
  const invented = await run({
    id: SRC.B.id, title: SRC.B.title, body: SRC.B.body,
    personas: [P({ code: 'P04', childrenCount: 0 })],
    canned: { essence: E,
      draft: { title: '아들 낳은 분들 보면',
        body: '딸을 낳았다고 하면 축하가 한두 마디인데, 아들을 낳았다고 하면 반응이 덜하더라고요.\n아들도 엄마를 잘 챙기던데요.' },
      review: { ...EMPTY_REVIEW, confidence: 0.8, unsupportedAdditions: [
        { evidence: '딸을 낳았다고 하면 축하가 한두 마디인데, 아들을 낳았다고 하면 반응이 덜하더라고요.', why: '원문에 없는 구체적 반응 차이' },
      ] } },
  })
  check('🔴 🔴 **B — 축하 횟수 같은 새 장면을 잡는다**',
    invented.review.machineOutcome === 'hold' && invented.review.unsupportedAdditions.length === 1)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 C 회귀 — 대타 없음 · 다른 날 근무 · 3시간 · 9명')
// ─────────────────────────────────────────────────────────
{
  const worker = P({ code: 'P01', workStatus: '파트타임' })
  const E = {
    coreMoment: '알바 중 여행 선물이 관례인지 묻는다',
    protectedFacts: [fact('number', '3시간'), fact('number', '9명')],
    closingIntent: 'ask', contentRoles: ['usefulAnswer', 'conversationSpark'],
    claimRequirements: [claim({ fact: 'work', requiredValue: '파트타임', stanceShiftable: true, evidenceText: '알바중', evidenceRef: 'title' })],
  }
  const GOOD = { title: '여행 다녀올 때 선물 하시나요',
    body: '대신 서 준 사람은 없고 비는 시간은 제가 다른 날에 채워 두었어요.\n한 번에 3시간씩 일하고 같이 있는 사람은 9명이에요.\n다들 사 가시나요.' }

  const c = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body,
    personas: [worker], canned: { essence: E, draft: GOOD } })
  const payload = sentOf('draftGen')[0]!.payload
  check('🔴 🔴 **"대타" 조건이 생성에 전달된다**',
    normalizeForProvenance(payload).includes(normalizeForProvenance('누가 대타뛰어준건 아니고')))
  check('🔴 🔴 **"다른날 다 근무" 도 전달된다**',
    normalizeForProvenance(payload).includes(normalizeForProvenance('다른날 다 근무해요')))
  check('🔴 원문 제목의 "여행" 이 전달된다', payload.includes('여행'))
  check('🟢 조건·숫자를 다 살린 초안은 통과한다', c.review.machineOutcome === 'adopt')
  check('🔴 3시간·9명이 살아 있다',
    c.draft!.body.includes('3시간') && c.draft!.body.includes('9명'))

  // 🔴 숫자가 빠지면 deterministic 이 잡는다
  const noNum = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [worker],
    canned: { essence: E, draft: { title: '선물 하시나요', body: '빈 시간은 제가 다른 날 채웠어요. 사람이 꽤 되는데 다들 사 가시나요.' } } })
  check('🔴 🔴 **3시간·9명이 빠지면 잡는다**',
    noNum.review.deterministic.failures.some((f) => f.code === 'protectedFactMissing'))

  // 🔴 휴가 · 다음 달 — 원문에 없는 사실
  const invented = await run({
    id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [worker],
    canned: { essence: E,
      draft: { title: '휴가 다녀올 때 선물',
        body: '다음 달에 짧게 휴가를 내려고 해요. 3시간씩 일하고 9명이 함께 있어요. 선물 사 가야 할까요.' },
      review: { ...EMPTY_REVIEW, confidence: 0.85, unsupportedAdditions: [
        { evidence: '다음 달에 짧게 휴가를 내려고 해요.', why: '원문에는 시점도 휴가도 없다 — 근무를 옮긴 것이다' },
      ] } },
  })
  check('🔴 🔴 **C — "휴가 · 다음 달" 을 잡는다**',
    invented.review.machineOutcome === 'hold'
    && invented.review.unsupportedAdditions[0]!.evidence.includes('다음 달'))

  // 🔴 대타 조건이 사라진 초안
  const lost = await run({
    id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [worker],
    canned: { essence: E,
      draft: { title: '선물 하시나요', body: '여행을 다녀오려고요. 3시간씩 일하고 9명이에요. 선물 사 가시나요.' },
      review: { ...EMPTY_REVIEW, confidence: 0.8, droppedFromSource: [
        { evidence: '누가 대타뛰어준건 아니고', why: '본인이 시간을 메운 조건이 사라졌다' },
      ] } },
  })
  check('🔴 🔴 **C — 대타 없음 조건이 사라지면 잡는다**',
    lost.review.machineOutcome === 'hold' && lost.review.droppedFromSource.length === 1)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 과차단 방지 — 지어낸 근거로 막지 않는다')
// ─────────────────────────────────────────────────────────
{
  const worker = P({ code: 'P01', workStatus: '파트타임' })
  const E = {
    coreMoment: '알바 중 여행 선물이 관례인지 묻는다',
    protectedFacts: [fact('number', '3시간'), fact('number', '9명')],
    closingIntent: 'ask', contentRoles: ['usefulAnswer'], claimRequirements: [],
  }
  const GOOD = { title: '여행 다녀올 때 선물 하시나요',
    body: '대신 서 준 사람은 없고 비는 시간은 제가 다른 날에 채웠어요. 3시간씩 일하고 9명이에요. 다들 사 가시나요.' }

  const ghostDraft = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [worker],
    canned: { essence: E, draft: GOOD, review: { ...EMPTY_REVIEW, confidence: 0.8,
      unsupportedAdditions: [{ evidence: '남편이 태워다 준다고 했어요', why: '지어낸 근거' }] } } })
  check('🔴 🔴 **초안에 없는 문장으로는 새 사건이라 하지 않는다**',
    ghostDraft.review.unsupportedAdditions.length === 0
    && ghostDraft.review.machineOutcome === 'adopt')

  const ghostSource = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [worker],
    canned: { essence: E, draft: GOOD, review: { ...EMPTY_REVIEW, confidence: 0.8,
      droppedFromSource: [{ evidence: '사장님이 화를 내셨어요', why: '지어낸 근거' }] } } })
  check('🔴 🔴 **원문에 없는 문장으로는 누락이라 하지 않는다**',
    ghostSource.review.droppedFromSource.length === 0
    && ghostSource.review.machineOutcome === 'adopt')

  const ghostLife = await run({ id: SRC.C.id, title: SRC.C.title, body: SRC.C.body, personas: [worker],
    canned: { essence: E, draft: GOOD, review: { ...EMPTY_REVIEW, confidence: 0.8,
      lifeContradictions: [{ fact: 'work', drafted: '전업', card: '파트타임', evidence: '저는 집에만 있어요' }] } } })
  check('🔴 🔴 **초안에 없는 문장으로는 생활사 모순이라 하지 않는다**',
    ghostLife.review.lifeContradictions.length === 0
    && ghostLife.review.machineOutcome === 'adopt')

  const shortPost = await run({
    id: 'S6d', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: {
      essence: { coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
        closingIntent: 'share', contentRoles: ['conversationSpark'], claimRequirements: [] },
      draft: { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다.' },
    },
  })
  check('🟢 🔴 **짧은 일상글을 과차단하지 않는다**',
    shortPost.review.machineOutcome === 'adopt' && shortPost.cost.totalCalls === 3)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 복제 — 원문을 보여 준다고 옮겨 적는 것을 허용하지 않는다')
// ─────────────────────────────────────────────────────────
{
  const E = { coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
    closingIntent: 'share', contentRoles: ['conversationSpark'], claimRequirements: [] }
  const copied = await run({
    id: 'S7a', title: '오늘 아침에 처음으로 김장 김치를 꺼냈어요',
    body: '아직 좀 이른가 싶었는데 그냥 꺼냈습니다. 맛은 괜찮네요. 다들 언제쯤 꺼내시나요.',
    canned: { essence: E, draft: { title: '오늘 아침에 처음으로 김장 김치를 꺼냈어요',
      body: '아직 좀 이른가 싶었는데 그냥 꺼냈습니다. 맛은 괜찮네요. 다들 언제쯤 꺼내시나요.' } },
  })
  check('🔴 🔴 **원문을 통째로 옮기면 차단된다**',
    copied.review.deterministic.failures.some((f) => f.code === 'copiedFromSource'))
  check('🔴 의미 검수까지 가지 않는다 — 유료 2회', copied.cost.totalCalls === 2)

  const sameTopic = await run({
    id: 'S7b', title: '오늘 아침에 처음으로 김장 김치를 꺼냈어요',
    body: '아직 좀 이른가 싶었는데 그냥 꺼냈습니다. 맛은 괜찮네요. 다들 언제쯤 꺼내시나요.',
    canned: { essence: E, draft: { title: '김장 김치 언제 여세요',
      body: '올해는 조금 서둘러 뚜껑을 열었네요. 생각보다 잘 익어서 다행이에요. 다른 분들은 어떠세요.' } },
  })
  check('🟢 🔴 **핵심 낱말이 겹친다는 이유만으로 복제라 하지 않는다**',
    sameTopic.review.deterministic.pass, JSON.stringify(sameTopic.review.deterministic.failures))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 ageCheck 를 없앤 근거 — 통합 검수가 같은 근거로 판정한다')
// ─────────────────────────────────────────────────────────
{
  const E = { coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
    closingIntent: 'share', contentRoles: ['conversationSpark'], claimRequirements: [] }
  const teen = P({ code: 'P01', ageBand: '40대 후반', childrenCount: 2, childrenAgeBands: ['중고등'] as ChildAgeBand[] })
  const DRAFT = { title: '김치 벌써 열었어요',
    body: '올해는 서둘러 뚜껑을 열었어요. 손주 녀석이 잘 먹어서 다행이에요.' }
  const a = await run({
    id: 'S8a', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    personas: [teen],
    canned: { essence: E, draft: DRAFT, review: { ...EMPTY_REVIEW, confidence: 0.85,
      lifeContradictions: [{ fact: 'childAgeBand', drafted: '손주가 있다',
        card: '자녀 2명 (중고등)', evidence: '손주 녀석이 잘 먹어서 다행이에요.' }] } },
  })
  check('🔴 🔴 **나이·가족 모순을 통합 검수가 잡는다**',
    a.review.machineOutcome === 'hold' && a.review.lifeContradictions.length === 1)
  check('🔴 🔴 **근거는 ageCheck 와 같은 것 — 초안 속 문장이다**',
    DRAFT.body.includes(a.review.lifeContradictions[0]!.evidence))
  check('🔴 🔴 **나이만 따로 묻는 호출이 없다** — 3회로 끝난다',
    a.cost.totalCalls === 3 && !a.cost.calls.some((c) => String(c.stage) === 'ageCheck'))
  check('🟢 확정 가능한 자기 나이 모순은 deterministic 이 계속 본다', (await run({
    id: 'S8b', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    personas: [teen],
    canned: { essence: E, draft: { title: '김치 열었어요', body: '제가 올해 23살인데요 김치를 벌써 열었어요.' } },
  })).review.deterministic.failures.some((f) => f.code === 'selfAgeConflict'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 🔴 말투 계약 — 빈 Voice 가 조용히 지나가지 못한다')
// ─────────────────────────────────────────────────────────
{
  const E = { coreMoment: '김치를 이르게 꺼낸 이야기', protectedFacts: [],
    closingIntent: 'share', contentRoles: ['conversationSpark'], claimRequirements: [] }
  const DRAFT = { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다.' }
  const src = { title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.' }

  const noVoice = await run({ id: 'S9a', title: src.title, body: src.body,
    canned: { essence: E, draft: DRAFT }, personas: [P({ code: 'P01', voiceTokens: [] })] })
  check('🔴 🔴 **말투 기준이 비면 초안을 만들지 않는다**',
    noVoice.draft === null && noVoice.cost.totalCalls === 1, noVoice.review.machineReason)

  const few = await run({ id: 'S9b', title: src.title, body: src.body,
    canned: { essence: E, draft: DRAFT }, personas: [P({ code: 'P01', samples: ['그러게요'] })] })
  check(`🔴 🔴 **말투 참고가 ${VOICE_SAMPLE_MIN}건보다 적으면 만들지 않는다**`,
    few.draft === null && few.cost.totalCalls === 1)

  const tokens = ['짧은 문장', '~해요 기본', '줄바꿈 잦음']
  const ok = await run({ id: 'S9c', title: src.title, body: src.body,
    canned: { essence: E, draft: DRAFT }, personas: [P({ code: 'P01', voiceTokens: tokens })] })
  const std = voiceStandardOf(tokens)
  check('🟢 말투가 갖춰지면 완주한다', ok.review.machineOutcome === 'adopt' && ok.cost.totalCalls === 3)
  check('🔴 🔴 **생성 요청에 말투 기준 값이 들어갔다**', sentOf('draftGen')[0]!.system.includes(std))
  check('🔴 🔴 **검수 요청에 같은 말투 기준 값이 들어갔다**', sentOf('semanticReview')[0]!.system.includes(std))
  check('🔴 말투 근거가 몇 토큰에서 나왔는지 남는다',
    ok.voice.provenance!.voiceTokenCount === 3 && ok.voice.provenance!.sampleCount === 2)
  check('🔴 정본 변환은 하나다', voiceStandardOf(['a', '', ' b ']) === 'a · b')

  const leak = await run({ id: 'S9d', title: src.title, body: src.body, personas: [P({ code: 'P01' })],
    canned: { essence: E, draft: DRAFT, review: { ...EMPTY_REVIEW, issues: ['voiceContentLeak'], confidence: 0.8 } } })
  check('🔴 사건 유출이면 adopt 아님',
    leak.review.machineOutcome === 'hold'
    && leak.review.voice.contentLeak && !leak.review.voice.mismatch)
  const mis = await run({ id: 'S9e', title: src.title, body: src.body, personas: [P({ code: 'P01' })],
    canned: { essence: E, draft: DRAFT, review: { ...EMPTY_REVIEW, issues: ['voiceMismatch'], confidence: 0.8 } } })
  check('🔴 말투 불일치도 adopt 아님',
    mis.review.machineOutcome === 'hold'
    && mis.review.voice.mismatch && !mis.review.voice.contentLeak)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 🔴 화자 자격 — 없는 생활사를 자기 일로 쓰지 않는다')
// ─────────────────────────────────────────────────────────
{
  const E = {
    coreMoment: '방송 속 남편들과 달리 자기 남편은 집안일을 돕지 않는다',
    protectedFacts: [], closingIntent: 'ask', contentRoles: ['conversationSpark'],
    claimRequirements: [claim({ fact: 'spouse', requiredValue: '있음', stanceShiftable: true, evidenceText: '왜 저희 애아빠는 안그럴까요' })],
  }
  const DRAFT = { title: '남편 집안일 이야기', body: '방송에서는 곧잘 하던데 실제로는 어떠신가요.' }
  const lowered = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single], canned: { essence: E, draft: DRAFT } })
  check('🔴 🔴 **자격이 없으면 자리를 낮춘다**',
    lowered.speaker.personaCode === 'P08' && lowered.speaker.stance !== 'SELF_EXPERIENCE')
  check('🔴 낮춘 자리가 생성 지시에 들어간다',
    sentOf('draftGen')[0]!.system.includes('자기 경험처럼 쓰지 않습니다'))
  check('🔴 검수도 낮춘 자리를 안다',
    sentOf('semanticReview')[0]!.system.includes('가지지 않은 사실'))

  const contradiction = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [single],
    canned: { essence: E, draft: { title: '우리 남편은요', body: '저희 남편은 집안일을 통 안 해요.' },
      review: { ...EMPTY_REVIEW, confidence: 0.9, lifeContradictions: [
        { fact: 'spouse', drafted: '남편이 있다', card: '비혼', evidence: '저희 남편은 집안일을 통 안 해요.' },
      ] } } })
  check('🔴 🔴 **비혼인 사람의 남편 주장을 잡는다**',
    contradiction.review.machineOutcome === 'hold'
    && contradiction.review.lifeContradictions[0]!.fact === 'spouse')

  const noPersona = await run({ id: SRC.A.id, title: SRC.A.title, body: SRC.A.body,
    personas: [], canned: { essence: E, draft: DRAFT } })
  check('🔴 쓸 사람이 없으면 만들지 않는다',
    noPersona.draft === null && noPersona.speaker.coverageGap?.why === 'noPersona')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 완주 · 계약 단위 검사')
// ─────────────────────────────────────────────────────────
{
  const E = { coreMoment: '김치 이야기', protectedFacts: [],
    closingIntent: 'share', contentRoles: ['conversationSpark'], claimRequirements: [] }
  const DRAFT = { title: '벌써 열어 봤어요', body: '때가 아닌가 했는데 뚜껑을 열었습니다.' }
  const base = { id: 'S11', title: '오늘 아침 김치 꺼냈어요', body: '좀 이른가 싶었는데 맛은 괜찮네요.',
    canned: { essence: E, draft: DRAFT } }
  for (const [name, fault] of [
    ['잘림', { truncate: 'semanticReview' }], ['막힘', { blocked: 'semanticReview' }],
    ['사용량 미상', { usageUnknown: 'semanticReview' }],
  ] as const) {
    const a = await run({ ...base, fault })
    check(`🔴 검수 ${name} → adopt 아님`, a.review.machineOutcome === 'hold', a.review.machineReason)
    check(`🔴 검수 ${name} → artifact 관문이 잡는다`,
      !(a.review.machineOutcome === 'adopt') && violatesArtifact(a).length === 0)
  }
  const genFault = await run({ ...base, fault: { usageUnknown: 'draftGen' } })
  check('🔴 🔴 **사용량 모르는 응답으로 만든 초안은 채택하지 않는다**',
    genFault.draft === null && genFault.review.machineOutcome === 'hold')
  const capped = await run({ ...base, cap: 2 })
  check('🔴 원천당 요청 상한을 넘기지 않는다', capped.cost.totalCalls <= 2)

  check('🔴 의미 축은 셋뿐이다', SEMANTIC_AXES.length === 3, SEMANTIC_AXES.join(','))
  check('🔴 원자적 사실만 글자를 강제한다',
    judgeProtectedFact('number', '9명').ok
    && judgeProtectedFact('relation', '시어머니').ok
    && !judgeProtectedFact('number', '직원은 9명정도되요').ok
    && !judgeProtectedFact('searchTerm', '시어머니가 서운하셨나 봐요').ok)
  check('🔴 생활사 값이 카드에서 온다',
    lifeContractLines(homemaker).some((x) => x.includes('전업'))
    && lifeContractLines(homemaker).some((x) => x.includes('자녀 1명')))
  check('🔴 claim 은 거의 언제나 빈 목록이라고 말한다',
    buildEssenceSystemPrompt(VOCAB).includes('거의 언제나 빈 목록이다'))
  check('🔴 소재 판정은 글을 다시 쓰지 않는다고 말한다',
    buildEssenceSystemPrompt(VOCAB).includes('글을 다시 쓰지 않는다'))

  const gen = buildV2DraftSystemPrompt({
    essence: { contextSufficiency: 'sufficient', insufficientReasons: [], coreMoment: null,
      protectedFacts: [], closingIntent: null, contentRoles: [], claimRequirements: [],
      essenceVersion: 'x' },
    plan: { decision: 'ok', personaCode: 'P02', stance: 'SELF_EXPERIENCE', unmetClaims: [],
      coverageGap: null, reason: '', planVersion: 'x' },
    voice: buildVoiceEvidence({ personaCode: 'P02', voiceTokens: ['짧은 문장'], samples: [],
      bundleDigest: 'b', sourceDigest: 's' }),
    life: homemaker,
  })
  check('🔴 🔴 **생활사는 자격 장치이지 글의 재료가 아니라고 말한다**',
    gen.includes('글의 재료가 아닙니다'))
  check('🔴 원문에 없는 사건을 만들지 말라고 말한다', gen.includes('사건 · 날짜 · 대사 · 겪은 일'))
  check('🔴 짧으면 짧게 쓰라고 말한다', gen.includes('짧게'))
  check('🔴 문장 구성은 새로 쓰라고 말한다', gen.includes('처음부터 새로'))

  const packet = buildEvidencePacket({ sourceArticleId: 'x', title: '제목', maskedBody: '본문입니다.' })
  check('🔴 원문 덩어리는 제목과 본문을 함께 담는다',
    sourceBlock(packet).includes('제목') && sourceBlock(packet).includes('본문입니다.'))
  check('🔴 근거 예산은 제목까지 합쳐 센다', EVIDENCE_CHAR_BUDGET === 300)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 검사다 — 실제 모델이 재미있는 글을 쓰는지는 증명하지 않았다.')
console.log('🔴 통과 수는 제품 성공이 아니다. 사람 READY 판정은 아직 0건이다.')
if (fail > 0) process.exit(1)
