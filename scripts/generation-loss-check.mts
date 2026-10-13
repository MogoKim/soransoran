/**
 * Batch B 생성 손실 검사 — 🔴 **Persona 선결정 · 고정 · 제한 재시도 · 장부** (2026-10-12)
 *
 * 🔴 네트워크 0 · provider 0 · DB 0. 장부는 **실제 `SupplyLlmSession`** 을 임시 디렉터리에 띄우고
 *    `fetch` 만 가짜로 바꾼다 — 예약·정산·열린 예약·회차 상한은 운영과 같은 코드가 처리한다.
 *    요청 변환은 러너와 **같은 함수**(`ledgerAskOf`)다. 검사가 축약본을 조립하지 않는다.
 *
 * 반례 목록 (Batch B 계약)
 *   ① Persona 가 유료 초안 전에 코드로 확정된다 — 판독 요청에 사람이 없다
 *   ② 생성기가 다른 Persona 를 내밀어도 바꾸지 않고 실패한다 · 발행 매칭도 다른 사람을 받지 않는다
 *   ③ timeout · 잘림은 원천당 최대 1회만 다시 묻는다
 *   ④ 안전·품질·Persona 부적격 · 사용량 미상 · 예산 차단 · 4xx 는 재시도 0
 *   ⑤ 첫 시도와 재시도가 같은 회차 예산 · 같은 장부 상한을 쓴다
 *   ⑥ 재시도 성공 · 최종 실패 · 사용량 미상의 장부가 각각 정확하다 (이중 정산 0 · 누락 0)
 *   ⑦ 실제 비용 없는 요청을 예약액으로 정산하지 않는다
 *   ⑧ 같은 원천에서 재시도가 두 번째 초안·두 번째 artifact 를 만들지 않는다
 *   ⑨ 실패 유형 표 — 원인 값과 요청 결과로만 가른다
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  runContentCore, personaInputOf, STAGE_MODEL, parseDraft, DRAFT_PERSONA_DRIFT,
  type Ask, type AskResult, type PersonaInput,
} from './lib/content-core-run.mjs'
import { ledgerAskOf, V2_LEDGER_STAGE, V2_LEDGER_RETRY_STAGE } from './lib/content-core-ledger-ask.mjs'
import { SupplyLlmSession } from './lib/supply-llm-call.mjs'
import { ledgerPathOf, readLedgerDay, readOpenReservations } from './lib/llm-ledger-store.mjs'
import { V2_LEDGER_STAGE as RUNNER_LEDGER_STAGE, V2_LEDGER_RETRY_STAGE as RUNNER_RETRY_STAGE }
  from './micro-seed-auto-draft.mjs'
import {
  CALL_ALLOWANCE_PER_SOURCE, V2_CALL_CAP,
} from './micro-seed-auto-draft.mjs'
import {
  CALL_OUTCOMES, GENERATION_FAILURE_KINDS, GENERATION_RETRY_MAX, TRANSIENT_CALL_OUTCOMES,
  classifyCall, failureKindOf, isTransientCall, transientProviderError,
  type CallOutcome,
} from '../src/lib/content-core/generation-failure'
import { INCOMPLETE_CAUSES } from '../src/lib/content-core/review'
import {
  SPEAKER_PLAN_VERSION, decidePersona, orderPersonasForSource, parseSourceNeed,
} from '../src/lib/content-core/speaker'
import {
  CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION, STAGE_MAX_OUTPUT_LABEL,
} from '../src/lib/content-core/pipeline'
import { REVIEW_VERSION } from '../src/lib/content-core/review'
import { buildEvidencePacket } from '../src/lib/content-core/evidence'
import { LEDGER_STAGES, ledgerDateOf, type LedgerEntry } from '../src/lib/llm-ledger'
import { BANNED_WORDS } from '../src/lib/micro-seed-auto-draft'
import { filterByVoice, judgeVoiceMatch, readVoiceProvenance } from '../src/lib/original-post-voice-match'
import type { HumanReviewArtifact } from '../src/lib/content-core/artifact'
import type { PoolCard } from '../src/lib/persona-pool-card'
import type { ChildAgeBand } from '../src/lib/original-post-persona-match'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : ` — ${extra}`}`) }
}
const NOW = new Date('2026-10-12T01:00:00.000Z')
const HASH = 'fixturehash00000'

// ─────────────────────────────────────────────────────────
// fixture — 정본 카드 → 정본 변환(`personaInputOf`)
// ─────────────────────────────────────────────────────────
const CARD = (o: Partial<PoolCard> & { code: string }): PoolCard => ({
  code: o.code, birthDate: o.birthDate ?? '1976-05-05', title: `카드 ${o.code}`,
  ageBand: o.ageBand ?? '40대 후반', region: o.region ?? '수도권', maritalStatus: o.maritalStatus ?? '기혼',
  spouseRelationship: null, childrenCount: o.childrenCount ?? 0, childrenAgeBands: o.childrenAgeBands ?? [],
  workStatus: o.workStatus ?? '전업', economicStatus: '보통', housing: '자가', menopauseStatus: '전',
  parentCare: '없음', personality: ['조심스러움'], noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
  voiceTokens: o.voiceTokens ?? ['짧은 문장', '~해요 기본'], voiceLength: '짧게', variationCount: 3,
  household: { childrenLiving: null, careSide: null, careCohabit: null },
})
const P = (o: Partial<PoolCard> & { code: string }): PersonaInput =>
  personaInputOf(CARD(o), { samples: ['그러게요 저도 비슷하게 느꼈어요', '맞아요 저도 같은 생각이에요'], bundleDigest: 'bundle0000000000' })
const partTime = P({ code: 'P01', workStatus: '파트타임', childrenCount: 2, childrenAgeBands: ['중고등'] as ChildAgeBand[] })
const homemaker = P({ code: 'P02', workStatus: '전업', childrenCount: 1, region: '광역시' })
const office = P({ code: 'P04', workStatus: '직장(정규)' })
const ALL = [homemaker, office, partTime]

const SRC = {
  id: '35011647', title: '알바중 여행다녀오면 선물하나요..?',
  body: '누가 대타뛰어준건 아니고 시간 땜빵난건  다른날 다 근무해요.\n\n3시간씩하는데, 직원은 9명정도되요,,,',
}
const SELF_PLAN = {
  decision: 'ok', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts', universalReason: '',
  speakerWarrants: [{ fact: 'work', requiredValue: '파트타임', evidenceRef: 'title', evidenceText: '알바중' }],
  protectedFacts: [{ kind: 'number', text: '3시간', evidenceRef: 'head' }, { kind: 'number', text: '9명', evidenceRef: 'head' }],
  speakerRelative: [], closingIntent: 'ask', contentRoles: ['usefulAnswer'],
}
const QUESTION_PLAN = { ...SELF_PLAN, stance: 'QUESTION', selfBasis: null, speakerWarrants: [] }
const DRAFT = { title: '알바 동료들 여행 선물', body: '3시간씩 일하는 곳인데 9명이에요. 여행 다녀오면 다들 선물 사 가시나요?' }
const CLEAN_REVIEW = { droppedFromSource: [], unsupportedAdditions: [], lifeContradictions: [], issues: [], confidence: 0.9, note: '' }

// ─────────────────────────────────────────────────────────
// 각본 provider — 단계 · 시도마다 무엇을 돌려줄지 정한다
// ─────────────────────────────────────────────────────────
type Beat =
  | 'ok' | 'truncated' | 'timeout' | 'network' | 'http429' | 'http503' | 'http400' | 'unknownError'
  | 'usageUnknown' | 'blocked'
type Script = {
  plan?: unknown; draft?: unknown; review?: unknown
  /** 🔴 단계별 차례 — 비면 ok */
  beats?: Partial<Record<'speakerPlan' | 'draftGen' | 'semanticReview', Beat[]>>
}
type Sent = { stage: string; attempt: 1 | 2; system: string; payload: string }
let SENT: Sent[] = []
const okRes = (text: string): AskResult => ({
  ok: true, rawText: text, truncated: false, usageKnown: true,
  inputTokens: 100, outputTokens: 20, thoughtsTokens: 5, usd: 0.0001, blocked: false, errorCode: null,
})
const noRes = (code: string | null): AskResult => ({
  ok: false, rawText: '', truncated: false, usageKnown: false,
  inputTokens: null, outputTokens: null, thoughtsTokens: null, usd: null, blocked: false, errorCode: code,
})
const scriptedAsk = (s: Script): Ask => {
  const left = {
    speakerPlan: [...(s.beats?.speakerPlan ?? [])],
    draftGen: [...(s.beats?.draftGen ?? [])],
    semanticReview: [...(s.beats?.semanticReview ?? [])],
  }
  return async (stage, system, payload, _model, attempt) => {
    SENT.push({ stage, attempt, system, payload })
    const body = JSON.stringify(stage === 'speakerPlan' ? s.plan ?? SELF_PLAN
      : stage === 'draftGen' ? s.draft ?? DRAFT : s.review ?? CLEAN_REVIEW)
    const beat = left[stage].shift() ?? 'ok'
    switch (beat) {
      case 'ok': return okRes(body)
      case 'truncated': return { ...okRes(body.slice(0, 10)), truncated: true }
      case 'timeout': return noRes('TIMEOUT')
      case 'network': return noRes('NETWORK')
      case 'http429': return noRes('HTTP_429')
      case 'http503': return noRes('HTTP_503')
      case 'http400': return noRes('HTTP_400')
      case 'unknownError': return noRes(null)
      case 'usageUnknown': return { ...okRes(body), usageKnown: false, usd: null }
      case 'blocked': return { ...noRes('LEDGER_BLOCKED:NO_BUDGET'), blocked: true }
    }
  }
}
const contract = {
  sourceInputHash: HASH, pipelineVersion: CONTENT_CORE_PIPELINE_VERSION, promptVersion: CONTENT_CORE_PROMPT_VERSION,
  speakerPlanVersion: SPEAKER_PLAN_VERSION, reviewVersion: REVIEW_VERSION, planPromptDigest: 'plan000000000000',
  stageModels: STAGE_MODEL, stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL,
  voiceAssetDigest: 'asset000000000', personaPoolDigest: 'pool0000000000',
}
const run = (o: { script?: Script; ask?: Ask; personas?: readonly PersonaInput[]; retryCap?: number; cap?: number }) => {
  SENT = []
  return runContentCore({
    artifactId: randomUUID().replace(/-/g, ''), sourceSite: 'navercafe:fixture', sourceArticleId: SRC.id,
    title: SRC.title, maskedBody: SRC.body,
    sourceMeta: { site: 'navercafe:fixture', postedAt: NOW, capturedAt: NOW, imageCount: null },
    personas: o.personas ?? ALL, personaPoolSize: (o.personas ?? ALL).length, voiceSourceDigest: 'asset000000000',
    contract, ask: o.ask ?? scriptedAsk(o.script ?? {}), now: NOW, callCap: o.cap ?? V2_CALL_CAP,
    ...(o.retryCap === undefined ? { retryCap: GENERATION_RETRY_MAX } : { retryCap: o.retryCap }),
  })
}
const attemptsOf = (a: HumanReviewArtifact): string => a.cost.calls.map((c) => `${c.stage}#${c.attempt ?? 1}:${c.outcome ?? '?'}`).join(' ')

console.log('\n══ Batch B 생성 손실 검사 (🔴 네트워크 0 · provider 0 · DB 0) ══')

// ─────────────────────────────────────────────────────────
console.log('\n① 🔴 Persona 는 유료 초안 전에 코드가 정한다 — 판독은 사람을 보지 않는다')
// ─────────────────────────────────────────────────────────
{
  // 🔴 판독이 무자격자 P02 를 지목해 와도 읽지 않는다
  const a = await run({ script: { plan: { ...SELF_PLAN, personaCode: 'P02' } } })
  const need = SENT.find((x) => x.stage === 'speakerPlan')!
  const draft = SENT.find((x) => x.stage === 'draftGen')
  check('🔴 🔴 판독 요청에 후보 코드가 하나도 없다', ALL.every((p) => !need.payload.includes(p.code)) && !need.system.includes('personaCode'))
  check('🔴 🔴 판독 요청에 후보 줄·생활사 줄이 없다 — 값 어휘만',
    !need.payload.includes('"후보"') && need.payload.includes('"값목록"') && !need.payload.includes('하는 일 '))
  check('🔴 🔴 코드가 정했다 — 자격자 P01 · decidedBy=code',
    a.plan.personaCode === 'P01' && a.plan.personaDecision?.decidedBy === 'code'
    && a.plan.personaDecision.chosen === 'P01' && a.plan.personaDecision.eligible.join(',') === 'P01',
    JSON.stringify(a.plan.personaDecision))
  check('🔴 🔴 초안 요청은 정해진 한 사람으로만 조립됐다 — 다른 후보의 생활사가 없다',
    draft !== undefined && draft.system.includes('하는 일 파트타임')
    && !draft.system.includes('하는 일 직장(정규)') && !draft.system.includes('사는 곳 광역시'))
  check('🔴 판독 → 초안 → 검수 순서 · 각 1회', SENT.map((x) => x.stage).join(',') === 'speakerPlan,draftGen,semanticReview')
  check('🔴 채택 · 실패 없음', a.review.machineOutcome === 'adopt' && a.failure === null, a.review.machineReason)

  // 🔴 낮은 자리 — 원문마다 정해진 순서의 첫 사람(회차 상태 아님)
  const q = await run({ script: { plan: QUESTION_PLAN } })
  const expect = orderPersonasForSource(ALL, HASH)[0]!.code
  check('🔴 🔴 QUESTION 자리는 원문 순서의 첫 사람 — 같은 원문이면 언제나 같다', q.plan.personaCode === expect, `${q.plan.personaCode} ≠ ${expect}`)
  const q2 = await run({ script: { plan: QUESTION_PLAN }, personas: [partTime, office, homemaker] })
  check('🔴 🔴 후보를 읽은 순서가 달라도 같은 사람', q2.plan.personaCode === expect)

  // 🔴 자격자 중 선호(결론을 바꾸는 나이 조건) — 선호는 자격을 넓히지 않는다
  const packet = buildEvidencePacket({ sourceArticleId: SRC.id, title: SRC.title, maskedBody: SRC.body })
  const need2 = parseSourceNeed(JSON.stringify(SELF_PLAN), packet).need
  const twoEligible = [P({ code: 'P11', workStatus: '파트타임' }), P({ code: 'P12', workStatus: '파트타임' }), homemaker]
  const d1 = decidePersona({ need: need2, personas: twoEligible, spans: packet.spans })
  const d2 = decidePersona({ need: need2, personas: twoEligible, spans: packet.spans, prefer: (p) => p.code === 'P12' })
  const d3 = decidePersona({ need: need2, personas: twoEligible, spans: packet.spans, prefer: (p) => p.code === 'P02' })
  check('🔴 선호가 없으면 자격자 중 첫 사람', d1.plan.personaCode === 'P11')
  // 🔴 순서상 첫 사람이 **무자격자**여도 건너뛴다 — 앞에 있다는 이유로 1인칭을 허가하지 않는다
  const d0 = decidePersona({ need: need2, personas: [homemaker, office, partTime], spans: packet.spans })
  check('🔴 🔴 순서상 앞의 무자격자 둘을 건너뛰고 자격자 P01 — 검증된 근거만 싣는다',
    d0.plan.personaCode === 'P01' && d0.plan.warrants.length === 1 && d0.plan.warrants[0]!.verifiedCardValue === '파트타임'
    && d0.decision.eligible.join(',') === 'P01' && d0.decision.considered === 3, JSON.stringify(d0.decision))
  check('🔴 🔴 선호를 채운 자격자가 있으면 그 사람', d2.plan.personaCode === 'P12')
  check('🔴 🔴 선호가 무자격자를 가리키면 무시한다 — 자격을 넓히지 않는다', d3.plan.personaCode === 'P11')

  // 🔴 자격자가 없으면 HOLD · 초안 호출 0 · 재시도 0
  const none = await run({ script: { plan: SELF_PLAN }, personas: [homemaker, office] })
  check('🔴 🔴 자격자 0 → HOLD · 판독 1회에서 멈춘다 · 재시도 0',
    none.draft === null && none.plan.rejection === 'requiredValueUnmet' && none.cost.totalCalls === 1
    && none.failure?.kind === 'personaEligibility' && none.failure.stage === 'personaDecision' && !none.failure.retried,
    attemptsOf(none))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 정해진 Persona 는 바뀌지 않는다 — 다르면 실패')
// ─────────────────────────────────────────────────────────
{
  const drift = await run({ script: { draft: { ...DRAFT, personaCode: 'P02' } } })
  check('🔴 🔴 초안이 다른 화자를 내밀면 채택하지 않는다', drift.draft === null && drift.review.machineOutcome === 'hold')
  check('🔴 🔴 화자는 그대로 P01 — 바꿔 끼우지 않았다', drift.plan.personaCode === 'P01' && drift.voice.provenance?.personaCode === 'P01')
  check('🔴 사유가 값으로 남는다 — 다른 화자 · 형식 실패 · 재시도 0',
    drift.review.machineReason.includes(DRAFT_PERSONA_DRIFT) && drift.review.semanticCompletion.cause === 'parseFailed'
    && drift.failure?.kind === 'parseSchema' && drift.failure.stage === 'draftGen' && !drift.failure.retried,
    `${drift.review.machineReason} · ${JSON.stringify(drift.failure)}`)
  check('🔴 검수를 부르지 않았다 — 판독 · 초안 2회', drift.cost.totalCalls === 2, attemptsOf(drift))
  const persona2 = await run({ script: { draft: { ...DRAFT, persona: 'P04' } } })
  check('🔴 `persona` 칸도 같다', persona2.draft === null && persona2.review.machineReason.includes(DRAFT_PERSONA_DRIFT))
  const same = await run({ script: { draft: { ...DRAFT, personaCode: 'P01' } } })
  check('🟢 같은 화자를 적어 오면 막지 않는다 (과차단 아님)', same.draft !== null && same.review.machineOutcome === 'adopt')
  check('🔴 parseDraft 단위 — 다른 화자 실패 · 빈 칸 실패 · 정상 통과',
    !parseDraft(JSON.stringify({ ...DRAFT, personaCode: 'P09' }), 'P01').ok
    && !parseDraft('{"title":"","body":"x"}', 'P01').ok && parseDraft(JSON.stringify(DRAFT), 'P01').ok)

  // 🔴 발행 매칭 — 기계 초안은 말투 주인(생성 화자)만 쓸 수 있다. 다른 사람으로 바꿔 내보내지 않는다
  const a = await run({})
  // 🔴 적재 봉투의 말투 출처 모양 — 화자는 생성 artifact 의 화자 그대로다
  const voice = a.voice.provenance === null ? null : readVoiceProvenance({
    personaCode: a.voice.provenance.personaCode, comments: 2, bundleDigest: 'bundle0000000000', sourceDigest: null,
  })
  check('🔴 🔴 발행 매칭이 생성 화자만 받는다 (OTHER_PERSONA 는 부적격)',
    voice !== null && judgeVoiceMatch({ voice, personaCode: 'P01', profile: 'machine' }).ok
    && !judgeVoiceMatch({ voice, personaCode: 'P02', profile: 'machine' }).ok
    && filterByVoice(voice, 'machine', ALL).map((p) => p.code).join(',') === 'P01')
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 일시적 기술 실패만 원천당 1회 다시 묻는다')
// ─────────────────────────────────────────────────────────
{
  const t = await run({ script: { beats: { speakerPlan: ['truncated'] } } })
  check('🔴 🔴 판독 잘림 → 1회 재시도 → 채택', t.review.machineOutcome === 'adopt' && t.failure === null, attemptsOf(t))
  check('🔴 🔴 재시도는 자기 줄을 갖는다 — 4줄 · 시도 번호 · 결과',
    attemptsOf(t) === 'speakerPlan#1:truncated speakerPlan#2:ok draftGen#1:ok semanticReview#1:ok')
  check('🔴 재시도 요청은 첫 요청과 같다 — 같은 지시 · 같은 입력',
    SENT[0]!.system === SENT[1]!.system && SENT[0]!.payload === SENT[1]!.payload && SENT[1]!.attempt === 2)
  check('🔴 🔴 초안은 한 번만 만들었다 — 재시도가 두 번째 초안을 만들지 않는다',
    SENT.filter((x) => x.stage === 'draftGen').length === 1)

  const tt = await run({ script: { beats: { speakerPlan: ['timeout', 'timeout'] } } })
  check('🔴 🔴 timeout 두 번 → 재시도 1회 뒤 멈춘다 (세 번째 없음)',
    tt.cost.totalCalls === 2 && tt.draft === null && tt.review.semanticCompletion.cause === 'noResponse', attemptsOf(tt))
  check('🔴 🔴 손실 유형 timeout · 판독 단계 · 재시도함',
    tt.failure?.kind === 'timeout' && tt.failure.stage === 'sourceNeed' && tt.failure.retried === true, JSON.stringify(tt.failure))

  const once = await run({ script: { beats: { speakerPlan: ['timeout'], draftGen: ['truncated'] } } })
  check('🔴 🔴 원천당 1회 — 판독에서 썼으면 초안 잘림은 다시 묻지 않는다',
    attemptsOf(once) === 'speakerPlan#1:timeout speakerPlan#2:ok draftGen#1:truncated'
    && once.failure?.kind === 'truncated' && once.failure.stage === 'draftGen' && once.failure.retried === true,
    attemptsOf(once))

  for (const [beat, label] of [['network', '네트워크'], ['http429', '429'], ['http503', '5xx']] as const) {
    const r = await run({ script: { beats: { draftGen: [beat] } } })
    check(`🔴 ${label} 는 일시 실패 — 다시 묻고 채택`, r.review.machineOutcome === 'adopt' && r.cost.totalCalls === 4, attemptsOf(r))
  }
  const off = await run({ script: { beats: { speakerPlan: ['truncated'] } }, retryCap: 0 })
  check('🔴 retryCap 을 주지 않은 호출부는 재시도 0 (기본값)', off.cost.totalCalls === 1 && off.draft === null)
  const capAll = await run({ script: { beats: { speakerPlan: ['ok'], draftGen: ['truncated', 'truncated'] } } })
  check('🔴 🔴 원천당 요청은 정상 3 + 재시도 1 을 넘지 않는다 (회차 공동 예산 4)',
    capAll.cost.totalCalls <= V2_CALL_CAP + GENERATION_RETRY_MAX
    && V2_CALL_CAP + GENERATION_RETRY_MAX <= CALL_ALLOWANCE_PER_SOURCE, attemptsOf(capAll))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 재시도 0 — 안전·품질 · Persona 자격 · 사용량 미상 · 예산 · 영구 오류')
// ─────────────────────────────────────────────────────────
{
  const banned = BANNED_WORDS[0]!
  const unsafe = await run({ script: { draft: { ...DRAFT, body: `${DRAFT.body} ${banned}` } } })
  check('🔴 🔴 결정적 품질 실패 → 재시도 0 · 검수 0', unsafe.cost.totalCalls === 2
    && unsafe.cost.calls.every((c) => (c.attempt ?? 1) === 1) && unsafe.failure?.kind === 'safetyQuality'
    && unsafe.failure.stage === 'deterministic', attemptsOf(unsafe))
  const harm = await run({ script: { review: { ...CLEAN_REVIEW, issues: ['harm'] } } })
  check('🔴 🔴 의미 검수가 위해로 막음 → 재시도 0', harm.review.machineOutcome === 'drop' && harm.cost.totalCalls === 3
    && harm.failure?.kind === 'safetyQuality' && harm.failure.stage === 'semanticReview', attemptsOf(harm))
  const uu = await run({ script: { beats: { speakerPlan: ['usageUnknown'] } } })
  check('🔴 🔴 사용량 미상 → 재시도 0 · 유형 usageUnknown · 비용 UNKNOWN',
    uu.cost.totalCalls === 1 && uu.failure?.kind === 'usageUnknown' && uu.cost.totalUsd === null, attemptsOf(uu))
  const bb = await run({ script: { beats: { speakerPlan: ['blocked'] } } })
  check('🔴 🔴 예산 차단 → 재시도 0 · 유형 budgetBlocked', bb.cost.totalCalls === 1 && bb.failure?.kind === 'budgetBlocked', attemptsOf(bb))
  const h400 = await run({ script: { beats: { speakerPlan: ['http400'] } } })
  check('🔴 🔴 4xx → 재시도 0 · 유형 provider', h400.cost.totalCalls === 1 && h400.failure?.kind === 'provider', attemptsOf(h400))
  const unk = await run({ script: { beats: { speakerPlan: ['unknownError'] } } })
  check('🔴 모르는 오류 → 재시도 0 (모르는 실패에 돈을 더 쓰지 않는다)', unk.cost.totalCalls === 1, attemptsOf(unk))
  const bad = await run({ script: { plan: 'not json' } })
  check('🔴 판독 형식 오류 → 재시도 0 · 유형 parseSchema (다음 회차가 다시 본다)',
    bad.cost.totalCalls === 1 && bad.failure?.kind === 'parseSchema' && bad.review.semanticCompletion.cause === 'parseFailed', attemptsOf(bad))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 실제 장부 — 재시도 성공 · 최종 실패 · 사용량 미상 · 상한')
// ─────────────────────────────────────────────────────────
type GBeat = 'ok' | 'truncated' | 'timeout' | 'noUsage'
let G_BEATS: GBeat[] = []
let PAID = 0
const realFetch = globalThis.fetch
const prevKeys = { g: process.env.GEMINI_API_KEY, a: process.env.ANTHROPIC_API_KEY }
process.env.GEMINI_API_KEY = 'fixture-fake-key'
process.env.ANTHROPIC_API_KEY = 'fixture-fake-key'
const jsonRes = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url)
  if (u.includes(':countTokens')) return jsonRes({ totalTokens: 100 })
  if (u.includes('/count_tokens')) return jsonRes({ input_tokens: 100 })
  PAID += 1
  if (u.includes(':generateContent')) {
    const text = String((JSON.parse(String(init?.body ?? '{}')) as { contents?: { parts?: { text?: string }[] }[] })
      .contents?.[0]?.parts?.[0]?.text ?? '')
    const body = text.includes('"값목록"') ? JSON.stringify(SELF_PLAN) : JSON.stringify(DRAFT)
    const beat = G_BEATS.shift() ?? 'ok'
    if (beat === 'timeout') { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
    const usage = beat === 'noUsage' ? { promptTokenCount: 100 }
      : { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10, totalTokenCount: 150 }
    return jsonRes({
      candidates: [{ content: { parts: [{ text: beat === 'truncated' ? body.slice(0, 20) : body }] }, finishReason: beat === 'truncated' ? 'MAX_TOKENS' : 'STOP' }],
      usageMetadata: usage,
    })
  }
  return jsonRes({ content: [{ text: JSON.stringify(CLEAN_REVIEW).slice(1) }], usage: { input_tokens: 100, output_tokens: 30 }, stop_reason: 'end_turn' })
}) as typeof globalThis.fetch

const LIMITS = { dailyUsd: 5, runRequestCap: 50, headroomMultiplier: 1.2 }
const dirs: string[] = []
const ledgerRun = async (o: { beats: GBeat[]; runCap?: number; take?: number }) => {
  const dir = mkdtempSync(join(tmpdir(), 'batch-b-ledger-'))
  dirs.push(dir)
  G_BEATS = [...o.beats]
  PAID = 0
  const session = new SupplyLlmSession({ runId: `B-${randomUUID().slice(0, 8)}`, dir, limits: { ...LIMITS, runRequestCap: o.runCap ?? 50 }, now: () => NOW })
  let left = o.take ?? 99
  const counted: string[] = []
  const ask = ledgerAskOf({
    take: () => (left <= 0 ? false : (left -= 1, true)),
    count: (k) => { counted.push(k) },
    call: (stage, system, payload, maxOut, model) => session.call({
      stage, model, systemPrompt: system, userPayload: payload, maxOutputTokens: maxOut, timeoutMs: 5000, sourceKey: 'srcBatchB',
    }),
  })
  const art = await run({ ask })
  const read = readLedgerDay(ledgerPathOf(dir, ledgerDateOf(NOW)))
  const entries: LedgerEntry[] = read.ok ? read.entries : []
  const paidLines = entries.filter((e) => e.stage !== 'countTokens')
  /** 🔴 접기 전 원본 줄 — `readLedgerDay` 는 시도마다 마지막 줄만 남긴다. 이중 정산은 원본으로 본다 */
  const rawLines = readFileSync(ledgerPathOf(dir, ledgerDateOf(NOW)), 'utf-8').split('\n')
    .filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as LedgerEntry).filter((e) => e.stage !== 'countTokens')
  const open = readOpenReservations(dir)
  return { art, entries, paidLines, rawLines, open: open.ok ? open.list : null, counted, session }
}
/** 🔴 **원본 줄**에서 시도 하나 = 예약 줄 1 + 끝 줄 1 (막힌 요청은 막힌 줄 1) — 그 밖이면 이중 정산·누락이다 */
const attemptsWellFormed = (lines: readonly LedgerEntry[]): boolean => {
  const by = new Map<string, LedgerEntry[]>()
  for (const e of lines) by.set(e.attemptId, [...(by.get(e.attemptId) ?? []), e])
  return [...by.values()].every((xs) => {
    const st = xs.map((x) => x.status).sort().join(',')
    return st === 'reserved,settled' || st === 'reserved,usageUnknown' || st === 'blocked'
  })
}
const sumSettled = (lines: readonly LedgerEntry[]): number =>
  lines.filter((e) => e.status === 'settled').reduce((n, e) => n + (e.settledUsd ?? 0), 0)

try {
  // ── 재시도 성공 ──
  const s = await ledgerRun({ beats: ['truncated', 'ok', 'ok'] })
  const stages = s.paidLines.filter((e) => e.status !== 'reserved').map((e) => e.stage).join(',')
  check('🔴 🔴 [장부] 재시도 성공 — sourceNeed · sourceNeedRetry · draftGen · draftQuality 각 1건',
    stages === 'sourceNeed,sourceNeedRetry,draftGen,draftQuality', stages)
  check('🔴 🔴 [장부] 시도마다 예약 1 · 정산 1 — 이중 정산 0', attemptsWellFormed(s.rawLines))
  const a1 = s.paidLines.find((e) => e.stage === 'sourceNeed')!.attemptId
  const a2 = s.paidLines.find((e) => e.stage === 'sourceNeedRetry')!.attemptId
  check('🔴 [장부] 첫 시도와 재시도는 다른 attemptId · 같은 원천 열쇠',
    a1 !== a2 && s.paidLines.filter((e) => e.stage.startsWith('sourceNeed')).every((e) => e.sourceKey === 'srcBatchB'))
  check('🔴 🔴 [장부] 열린 예약 0 — 끝나지 않은 요청이 없다', s.open !== null && s.open.length === 0)
  check('🔴 🔴 [장부] artifact 비용 = 장부 정산 합 (누락 0 · 이중 0)',
    s.art.cost.totalUsd !== null && Math.abs(s.art.cost.totalUsd - sumSettled(s.paidLines)) < 1e-12
    && s.art.cost.calls.length === 4, `${s.art.cost.totalUsd} vs ${sumSettled(s.paidLines)}`)
  check('🔴 [장부] 잘린 첫 시도도 실제 사용량으로 정산됐다 — 돈은 썼다',
    (s.paidLines.find((e) => e.stage === 'sourceNeed' && e.status === 'settled')?.settledUsd ?? 0) > 0)
  check('🔴 [집계] 재시도는 `단계:retry` 로 센다', s.counted.join(',') === 'speakerPlan,speakerPlan:retry,draftGen,semanticReview', s.counted.join(','))
  check('🔴 채택 · provider 유료 4건', s.art.review.machineOutcome === 'adopt' && PAID === 4, `${s.art.review.machineReason} · paid ${PAID}`)

  // ── 최종 실패(timeout 두 번) ──
  const f = await ledgerRun({ beats: ['timeout', 'timeout'] })
  const unk = f.paidLines.filter((e) => e.status === 'usageUnknown')
  check('🔴 🔴 [장부] 최종 실패 — 두 시도 모두 사용량 미상으로 남는다 (sourceNeed · sourceNeedRetry)',
    unk.map((e) => e.stage).join(',') === 'sourceNeed,sourceNeedRetry' && attemptsWellFormed(f.rawLines), f.paidLines.map((e) => `${e.stage}:${e.status}`).join(' '))
  check('🔴 🔴 [장부] 실제 비용 없는 요청을 예약액으로 정산하지 않는다 — settledUsd null · 예약액은 남는다',
    unk.every((e) => e.settledUsd === null && (e.reservedUsd ?? 0) > 0) && f.session.tally.settledUsd === 0)
  check('🔴 🔴 [artifact] 비용 UNKNOWN — 0 이나 예약액이 아니다', f.art.cost.totalUsd === null && f.art.cost.calls.every((c) => c.usd === null))
  check('🔴 손실 유형 timeout · 재시도함', f.art.failure?.kind === 'timeout' && f.art.failure.retried === true)

  // ── 사용량 미상(응답은 옴) ──
  const u = await ledgerRun({ beats: ['noUsage'] })
  check('🔴 🔴 [장부] 사용량 미상 — 재시도 0 · usageUnknown 1건 · 정산액 없음',
    u.paidLines.filter((e) => e.status !== 'reserved').map((e) => `${e.stage}:${e.status}`).join(',') === 'sourceNeed:usageUnknown'
    && u.paidLines.every((e) => e.settledUsd === null || e.status !== 'usageUnknown'), u.paidLines.map((e) => `${e.stage}:${e.status}`).join(' '))
  check('🔴 [artifact] 유형 usageUnknown · 비용 UNKNOWN', u.art.failure?.kind === 'usageUnknown' && u.art.cost.totalUsd === null)

  // ── 회차 공동 예산이 재시도를 막는다 ──
  const b = await ledgerRun({ beats: ['truncated', 'ok'], take: 1 })
  check('🔴 🔴 [예산] 회차 공동 예산이 다 찼으면 재시도도 나가지 않는다 — 장부 유료 1건',
    PAID === 1 && b.paidLines.filter((e) => e.status !== 'reserved').map((e) => e.stage).join(',') === 'sourceNeed'
    && b.art.failure?.kind === 'budgetBlocked' && b.art.failure.retried === true, b.paidLines.map((e) => `${e.stage}:${e.status}`).join(' '))
  // ── 장부 회차 요청 상한이 재시도를 막는다 ──
  const c = await ledgerRun({ beats: ['truncated', 'ok'], runCap: 1 })
  const blocked = c.paidLines.find((e) => e.stage === 'sourceNeedRetry')
  check('🔴 🔴 [장부 상한] 회차 요청 상한이 재시도에도 걸린다 — sourceNeedRetry 가 blocked 로 남고 provider 0',
    PAID === 1 && blocked?.status === 'blocked' && blocked.settledUsd === null && attemptsWellFormed(c.rawLines),
    c.paidLines.map((e) => `${e.stage}:${e.status}:${e.blockCode ?? ''}`).join(' '))
} finally {
  globalThis.fetch = realFetch
  if (prevKeys.g === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevKeys.g
  if (prevKeys.a === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKeys.a
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 실패 유형 표 · 장부 어휘 · 배선')
// ─────────────────────────────────────────────────────────
{
  const table: [Parameters<typeof classifyCall>[0], CallOutcome][] = [
    [{ ok: true, truncated: false, usageKnown: true, blocked: false }, 'ok'],
    [{ ok: false, truncated: false, usageKnown: false, blocked: true }, 'blocked'],
    [{ ok: false, truncated: false, usageKnown: false, blocked: false, errorCode: 'TIMEOUT' }, 'timeout'],
    [{ ok: true, truncated: true, usageKnown: true, blocked: false }, 'truncated'],
    [{ ok: false, truncated: false, usageKnown: false, blocked: false, errorCode: 'HTTP_502' }, 'providerTransient'],
    [{ ok: false, truncated: false, usageKnown: false, blocked: false, errorCode: 'HTTP_401' }, 'providerPermanent'],
    [{ ok: false, truncated: false, usageKnown: false, blocked: false, errorCode: 'SETTLE_NOT_RECORDED' }, 'providerPermanent'],
    [{ ok: true, truncated: false, usageKnown: false, blocked: false }, 'usageUnknown'],
  ]
  check('🔴 요청 결과 분류 표', table.every(([r, want]) => classifyCall(r) === want),
    table.map(([r, w]) => `${classifyCall(r)}/${w}`).join(' '))
  check('🔴 🔴 재시도 대상은 timeout · 잘림 · 일시 제공사 오류 셋뿐',
    CALL_OUTCOMES.filter(isTransientCall).join(',') === 'timeout,truncated,providerTransient'
    && TRANSIENT_CALL_OUTCOMES.length === 3)
  check('🔴 일시 제공사 오류 — NETWORK · 429 · 5xx 만',
    ['NETWORK', 'HTTP_429', 'HTTP_500', 'HTTP_503'].every(transientProviderError)
    && !['HTTP_400', 'HTTP_401', 'HTTP_404', 'TIMEOUT', '', 'X'].some(transientProviderError))
  check('🔴 🔴 모든 미완주 원인이 손실 유형 하나로 간다 (빠진 값 0)',
    INCOMPLETE_CAUSES.every((c) => (GENERATION_FAILURE_KINDS as readonly string[]).includes(failureKindOf(c, null))))
  check('🔴 noResponse 는 마지막 요청 결과로 갈린다 — timeout / provider',
    failureKindOf('noResponse', 'timeout') === 'timeout' && failureKindOf('noResponse', 'providerPermanent') === 'provider')
  check('🔴 🔴 Persona 자격 원인은 personaEligibility — 기술 실패로 섞지 않는다',
    (['speakerUnqualified', 'speakerSlotNarrowed', 'loadBearingMismatch', 'personaTransformFailed'] as const)
      .every((c) => failureKindOf(c, null) === 'personaEligibility'))
  check('🔴 🔴 장부 어휘 — sourceNeed 와 재시도 셋이 있다', (['sourceNeed', 'sourceNeedRetry', 'draftGenRetry', 'draftQualityRetry'] as const)
    .every((s) => (LEDGER_STAGES as readonly string[]).includes(s)))
  check('🔴 🔴 판독은 judge 로 적히지 않는다 (K-06) · 재시도 이름은 첫 시도와 다르다',
    V2_LEDGER_STAGE.speakerPlan === 'sourceNeed'
    && (Object.keys(V2_LEDGER_STAGE) as (keyof typeof V2_LEDGER_STAGE)[]).every((k) => V2_LEDGER_STAGE[k] !== V2_LEDGER_RETRY_STAGE[k]))
  check('🔴 러너가 같은 장부 단계 맵을 쓴다 (두 벌 아님)', RUNNER_LEDGER_STAGE === V2_LEDGER_STAGE && RUNNER_RETRY_STAGE === V2_LEDGER_RETRY_STAGE)
  check('🔴 원천당 재시도 상한은 1', GENERATION_RETRY_MAX === 1)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 검사다 — 실제 모델의 잘림·timeout 이 재시도로 회복되는 비율은 운영 관측으로만 안다.')
if (fail > 0) process.exit(1)

// 🔴 (2026-10-13 quality-v8) 의미 손실 감사 반례 — 같은 CI 줄(`check:content-core-v2`)에 태운다. 실패하면 그 파일이 1 로 끝낸다
await import('./semantic-loss-check.mjs')
