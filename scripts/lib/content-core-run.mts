/**
 * Content Core v2 — 🔴 **세로 경로 하나를 끝까지 돈다. 유료 3회**
 *
 * 마스킹된 근거 묶음
 *   → ① 화자 계획 (원문 + 실제 카드를 함께 보고 고르고, **코드가 근거를 검증**)
 *   → ② 원문 근거 + Persona + Voice 로 초안 한 편
 *   → deterministic (복제 · 개인정보 · 원자적 사실 · 확정 가능한 나이 모순)
 *   → ③ 원문과 초안을 **직접** 견주는 통합 검수
 *   → 사람 판정 한 장
 *
 * 🔴 **효과를 주입받는다.** provider·시계·예산을 직접 부르지 않는다.
 * 🔴 **DB · 큐 · 발행 · 네트워크를 모르는 파일이다.**
 * 🔴 **v1 의 생성·검수 계약을 가져오지 않는다.** 다만 금지 낱말 · 복제 · 자기 나이
 *    정본은 공유한다 — 저장소에 한 벌이어야 하는 안전 기준이다.
 */
import { buildEvidencePacket, evidenceText, violatesEvidenceBudget }
  from '../../src/lib/content-core/evidence'
import type { SourceEvidencePacket } from '../../src/lib/content-core/evidence'
import { isPersonalInfo, missingProtectedFacts } from '../../src/lib/content-core/source-facts'
import type { DropReason } from '../../src/lib/content-core/source-facts'
import type { PoolCard } from '../../src/lib/persona-pool-card'
/** 🔴 provider 가 아는 모델만 — `as` 로 모르는 이름을 억지 통과시키지 않는다 */
import type { ProviderModel } from './voice-m3-provider.mjs'
import { canGenerate, parseSpeakerPlan } from '../../src/lib/content-core/speaker'
import type { PersonaLifeContract, SpeakerPlan } from '../../src/lib/content-core/speaker'
import {
  buildVoiceEvidence, judgeVoiceReadiness, voiceStandardMissingFrom, VOICE_READINESS_LABEL,
} from '../../src/lib/content-core/voice-evidence'
import type { VoiceEvidence } from '../../src/lib/content-core/voice-evidence'
import {
  groundedInDraft, groundedInSource, judgeMachine, parseSemanticReview, INCOMPLETE_LABEL,
  type DeterministicFailure, type DeterministicResult,
  type ReviewCompletion, type SemanticVerdict,
} from '../../src/lib/content-core/review'
import { ARTIFACT_VERSION, type CallMeta, type HumanReviewArtifact }
  from '../../src/lib/content-core/artifact'
import { hasBannedWord } from '../../src/lib/micro-seed-auto-draft'
import { judgeCopy, measureOriginality } from '../../src/lib/draft-originality'
import { judgeSelfAgeConflict } from '../../src/lib/persona-self-age'
import {
  buildSpeakerPlanPayload, buildSpeakerPlanSystemPrompt,
  buildV2DraftPayload, buildV2DraftSystemPrompt,
  buildV2ReviewPayload, buildV2ReviewSystemPrompt, sourceBlock,
} from './content-core-prompts.mjs'

/** provider 한 번 — 🔴 fixture 가 가짜를 넣는다 */
export type AskResult = {
  ok: boolean
  rawText: string
  /** 🔴 잘림 · 미응답 · 사용량 미상을 **구분해서** 돌려준다 */
  truncated: boolean
  usageKnown: boolean
  inputTokens: number | null
  /** 🔴 과금 기준 출력 — Gemini 는 `candidates + thoughts` 합이다 */
  outputTokens: number | null
  /** 🔴 그 중 thinking. 포함됐음을 확인하는 값이고, 없는 모델은 null 이다 */
  thoughtsTokens: number | null
  usd: number | null
  /** 예산·상한에 막혀 **나가지도 않았는가** */
  blocked: boolean
}
export type AskStage = CallMeta['stage']

/**
 * 🔴 **단계마다 어느 모델을 쓰는가** — 부르는 쪽이 임의로 고르지 않게 한 곳에 둔다.
 *    (2026-09-19: 화자 계획과 생성은 Gemini, 의미 검수는 Haiku 로 나눈 시험 구성.
 *     검수를 생성과 같은 모델에 맡기면 자기 글을 자기가 채점한다.)
 */
export const STAGE_MODEL: Readonly<Record<AskStage, ProviderModel>> = Object.freeze({
  speakerPlan: 'gemini-3.7-flash',
  draftGen: 'gemini-3.7-flash',
  semanticReview: 'claude-haiku-4.5',
})

/** 🔴 `model` 을 인자로 받는다 — 어느 단계가 어디로 갔는지 **값으로** 확인된다 */
export type Ask = (
  stage: AskStage, system: string, payload: string, model: ProviderModel,
) => Promise<AskResult>

/**
 * 🔴 **정본 카드 + 말투 근거.** Persona 정보를 v2 에서 다시 정의하지 않는다 —
 *    `PersonaLifeContract` 는 `PoolCard` 에서 고른 칸이다.
 *
 * 🔴 **`voiceCore` 라는 손으로 옮겨 적는 칸을 없앴다** (2026-09-19 실측 보정).
 *    정본 카드가 가진 이름은 `voiceTokens` 인데 이 타입은 `voiceCore` 를 요구했다.
 *    이름이 다르니 부르는 쪽이 조용히 빈 문자열을 넘겼고, **말투 기준 없이**
 *    생성도 검수도 지나갔다. 이제 칸 이름이 정본과 같고, 조립은
 *    `personaInputOf` **하나**만 한다.
 */
export type PersonaInput = PersonaLifeContract & Pick<PoolCard, 'voiceTokens'> & {
  samples: readonly string[]
  bundleDigest: string
}

/**
 * 🔴 **정본 `PoolCard` → v2 입력. 저장소에 이 변환 하나뿐이다.**
 *    시험 harness 도 앞으로의 운영 runner 도 이것만 부른다 —
 *    손으로 칸을 재조립하면 이번과 같은 조용한 빈 값이 다시 생긴다.
 */
export function personaInputOf(
  card: PoolCard, ref: { samples: readonly string[]; bundleDigest: string },
): PersonaInput {
  return {
    code: card.code,
    ageBand: card.ageBand,
    region: card.region,
    maritalStatus: card.maritalStatus,
    spouseRelationship: card.spouseRelationship,
    childrenCount: card.childrenCount,
    childrenAgeBands: card.childrenAgeBands,
    workStatus: card.workStatus,
    economicStatus: card.economicStatus,
    menopauseStatus: card.menopauseStatus,
    parentCare: card.parentCare,
    personality: card.personality,
    noGoTopics: card.noGoTopics,
    noGoExpressions: card.noGoExpressions,
    voiceTokens: card.voiceTokens,
    samples: ref.samples,
    bundleDigest: ref.bundleDigest,
  }
}

export type RunInput = {
  sourceArticleId: string
  /** 🔴 이미 마스킹된 값이다 */
  title: string
  maskedBody: string
  personas: readonly PersonaInput[]
  load?: Readonly<Record<string, number>>
  voiceSourceDigest: string
  ask: Ask
  now: Date
  /** 🔴 원천 하나가 쓸 수 있는 요청 수 — 넘기면 완주 실패로 남는다 */
  callCap: number
}

/**
 * 🔴 **유료 단계 셋은 전부 같은 기준으로 완주를 본다** (2026-09-19 보정).
 *
 *    앞판은 검수 단계만 `usageKnown` 을 봤고 `essence`·`draftGen` 은
 *    `ok && !truncated` 만 봤다 — 사용량을 모르는 응답으로 만든 초안이
 *    그대로 adopt 까지 갔다. 어느 단계든 **막힘 · 무응답 · 잘림 ·
 *    사용량 미상 · 파싱 실패**는 똑같이 통과가 아니다.
 */
const completionOf = (r: AskResult): ReviewCompletion => {
  if (r.blocked) return { complete: false, reason: 'budgetBlocked' }
  if (!r.ok) return { complete: false, reason: 'noResponse' }
  if (r.truncated) return { complete: false, reason: 'truncated' }
  if (!r.usageKnown) return { complete: false, reason: 'usageUnknown' }
  return { complete: true, reason: null }
}

const parseDraft = (raw: string): { title: string; body: string } | null => {
  try {
    const t = raw.trim()
    const j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
    const title = typeof j.title === 'string' ? j.title.trim() : ''
    const body = typeof j.body === 'string' ? j.body.trim() : ''
    return title === '' || body === '' ? null : { title, body }
  } catch { return null }
}

const INCOMPLETE: ReviewCompletion = { complete: false, reason: 'budgetBlocked' }

/** 🔴 한 원천을 끝까지 돈다. 중간에 멈추면 멈춘 자리가 artifact 에 남는다 */
export async function runContentCore(input: RunInput): Promise<HumanReviewArtifact> {
  const calls: CallMeta[] = []
  let spent = 0
  const ask = async (stage: AskStage, system: string, payload: string): Promise<AskResult> => {
    const model = STAGE_MODEL[stage]
    if (spent >= input.callCap) {
      return {
        ok: false, rawText: '', truncated: false, usageKnown: false,
        inputTokens: null, outputTokens: null, thoughtsTokens: null, usd: null, blocked: true,
      }
    }
    spent += 1
    const r = await input.ask(stage, system, payload, model)
    // 🔴 어느 모델이 얼마를 썼는지 단계별로 남긴다 — 합쳐 놓으면 알 수 없다
    calls.push({
      stage, model, count: 1, inputTokens: r.inputTokens,
      outputTokens: r.outputTokens, thoughtsTokens: r.thoughtsTokens, usd: r.usd,
    })
    return r
  }

  const packet: SourceEvidencePacket = buildEvidencePacket({
    sourceArticleId: input.sourceArticleId, title: input.title, maskedBody: input.maskedBody,
  })
  const budgetProblems = violatesEvidenceBudget(packet)

  const blank = (
    plan: SpeakerPlan | null, dropped: { text: string; why: DropReason }[],
    voice: VoiceEvidence | null,
    draft: { title: string; body: string } | null,
    det: DeterministicResult, semantic: SemanticVerdict | null,
    semanticC: ReviewCompletion,
    outcome: 'adopt' | 'hold' | 'drop', reason: string,
  ): HumanReviewArtifact => ({
    artifactVersion: ARTIFACT_VERSION,
    sourceArticleId: packet.sourceArticleId,
    generatedAt: input.now.toISOString(),
    evidence: {
      title: packet.title, spans: packet.spans, bodyEvidenceChars: packet.bodyEvidenceChars,
      totalEvidenceChars: packet.totalEvidenceChars, bodyLength: packet.bodyLength, truncated: packet.truncated, omittedRatio: packet.omittedRatio,
      contextSufficiency: packet.contextSufficiency, insufficientReasons: packet.insufficientReasons,
      packetVersion: packet.packetVersion,
    },
    dropped,
    plan: {
      personaCode: plan?.personaCode ?? null, stance: plan?.stance ?? null,
      selfBasis: plan?.selfBasis ?? null, warrants: plan?.warrants ?? [],
      universalReason: plan?.universalReason ?? '', rejection: plan?.rejection ?? null,
      protectedFacts: plan?.protectedFacts ?? [], closingIntent: plan?.closingIntent ?? null,
      contentRoles: plan?.contentRoles ?? [], reason: plan?.reason ?? reason,
    },
    voice: { provenance: voice?.provenance ?? null, blindCheckPoints: voice?.blindCheckPoints ?? [] },
    draft,
    review: {
      deterministic: det, semantic, semanticCompletion: semanticC,
      droppedFromSource: semantic?.droppedFromSource ?? [],
      unsupportedAdditions: semantic?.unsupportedAdditions ?? [],
      lifeContradictions: semantic?.lifeContradictions ?? [],
      voice: {
        contentLeak: semantic?.issues.includes('voiceContentLeak') ?? false,
        mismatch: semantic?.issues.includes('voiceMismatch') ?? false,
      },
      machineOutcome: outcome, machineReason: reason,
    },
    humanDecision: { verdict: null, reasons: [], reviewedAt: null },
    cost: {
      calls, totalCalls: calls.length,
      totalInputTokens: calls.every((c) => c.inputTokens !== null)
        ? calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0) : null,
      totalOutputTokens: calls.every((c) => c.outputTokens !== null)
        ? calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0) : null,
      totalUsd: calls.every((c) => c.usd !== null)
        ? calls.reduce((n, c) => n + (c.usd ?? 0), 0) : null,
    },
  })

  const noDet: DeterministicResult = { pass: true, failures: [] }
  if (budgetProblems.length > 0) {
    return blank(null, [], null, null,
      { pass: false, failures: [{ code: 'schemaInvalid', detail: budgetProblems.join(' · ') }] },
      null, INCOMPLETE, 'hold', budgetProblems.join(' · '))
  }
  /**
   * 🔴 **이미지·링크·앞 대화 없이는 알 수 없는 글은 만들지 않는다.**
   *    묻기 전에 멈춘다 — 확인 못 한 글에 돈을 쓰지 않는다.
   */
  if (packet.contextSufficiency === 'insufficient') {
    return blank(null, [], null, null, noDet, null, INCOMPLETE,
      'hold', `무슨 이야기인지 확인하지 못했다 (${packet.insufficientReasons.join('·')})`)
  }

  // ── ① 화자 계획 — 🔴 원문과 실제 카드를 함께 보고, 코드가 근거를 검증한다 ──
  const pRes = await ask('speakerPlan', buildSpeakerPlanSystemPrompt(),
    buildSpeakerPlanPayload({ packet, personas: input.personas, load: input.load }))
  const pC = completionOf(pRes)
  if (!pC.complete) {
    return blank(null, [], null, null, noDet, null, INCOMPLETE,
      'hold', `화자 계획을 완주하지 못했다 (${INCOMPLETE_LABEL[pC.reason ?? 'noResponse']})`)
  }
  const parse = parseSpeakerPlan(pRes.rawText, packet, input.personas)
  const plan = parse.plan
  const dropped = parse.dropped
  const gen = canGenerate(packet, plan)
  if (!gen.ok) {
    return blank(plan, dropped, null, null, noDet, null, INCOMPLETE, 'hold', gen.why)
  }
  const persona = input.personas.find((p) => p.code === plan.personaCode)!

  // ── ② 말투 근거 ──
  const voice = buildVoiceEvidence({
    personaCode: persona.code, voiceTokens: persona.voiceTokens, samples: persona.samples,
    bundleDigest: persona.bundleDigest, sourceDigest: input.voiceSourceDigest,
  })
  /**
   * 🔴 **말투 없이 쓰지 않는다 — 묻기 전에 멈춘다** (2026-09-19 실측 보정).
   *    빈 기준으로 만든 글은 아무의 말투도 아니고, 검수도 같은 빈 값을 받으므로
   *    **그 사실이 판정에 드러나지 않는다.** 조용히 통과하느니 만들지 않는다.
   */
  const ready = judgeVoiceReadiness(voice)
  if (!ready.ok) {
    return blank(plan, dropped, voice, null, noDet, null, INCOMPLETE,
      'hold', VOICE_READINESS_LABEL[ready.why!])
  }

  // ── ③ 초안 한 편 ──
  /**
   * 🔴 **정말로 들어갔는지 값으로 본다.** 프롬프트 쪽 조건이 잘못되면 기준이
   *    조용히 빠진다 — 두 요청 모두 보내기 전에 확인하고, 하나라도 비면 안 보낸다.
   */
  const draftSystem = buildV2DraftSystemPrompt({ plan, voice, life: persona })
  const reviewSystem = buildV2ReviewSystemPrompt({ plan, voice, life: persona })
  const voiceless = [
    ...(voiceStandardMissingFrom(draftSystem, voice) ? ['생성'] : []),
    ...(voiceStandardMissingFrom(reviewSystem, voice) ? ['의미 검수'] : []),
  ]
  if (voiceless.length > 0) {
    return blank(plan, dropped, voice, null, noDet, null, INCOMPLETE,
      'hold', `말투 기준이 ${voiceless.join('·')} 요청에 들어가지 않았다 — 배선이 어긋났다`)
  }
  const dRes = await ask('draftGen', draftSystem, buildV2DraftPayload({ packet }))
  const dC = completionOf(dRes)
  const draft = dC.complete ? parseDraft(dRes.rawText) : null
  if (draft === null) {
    const why = dC.complete ? '초안을 읽지 못했다' : `초안 생성을 완주하지 못했다 (${INCOMPLETE_LABEL[dC.reason ?? 'noResponse']})`
    return blank(plan, dropped, voice, null,
      { pass: false, failures: [{ code: 'schemaInvalid', detail: why }] },
      null, INCOMPLETE, 'hold', why)
  }

  // ── ④ deterministic — 확정 가능한 것만 ──
  const draftText = `${draft.title}\n${draft.body}`
  const failures: DeterministicFailure[] = []
  if (isPersonalInfo(draftText)) failures.push({ code: 'personalInfo', detail: '개인정보 표식' })
  if (hasBannedWord(draftText)) failures.push({ code: 'bannedWord', detail: '금지 낱말' })
  const copy = judgeCopy(measureOriginality(draftText, evidenceText(packet)))
  if (copy.copied) failures.push({ code: 'copiedFromSource', detail: copy.reason })
  // 🔴 글자 그대로 지켜야 할 **원자적 사실**만 본다 — 문장은 애초에 여기 들어오지 못한다
  const missing = missingProtectedFacts(plan.protectedFacts, draftText)
  if (missing.length > 0) failures.push({ code: 'protectedFactMissing', detail: missing.join(' · ') })
  if (persona.ageBand != null && persona.ageBand.trim() !== '') {
    // 🔴 정본이 판정하지 못하면(null) 막지 않는다 — 모르는 것을 결함으로 세지 않는다
    const sa = judgeSelfAgeConflict({ ageBand: persona.ageBand, text: draftText })
    if (sa !== null && sa.conflict) failures.push({ code: 'selfAgeConflict', detail: sa.evidence })
  }
  const det: DeterministicResult = { pass: failures.length === 0, failures }
  if (!det.pass) {
    const j = judgeMachine({ deterministic: det, semantic: null, semanticCompletion: INCOMPLETE })
    return blank(plan, dropped, voice, draft, det, null, INCOMPLETE, j.outcome, j.reason)
  }

  // ── ⑤ 의미 검수 1회 ──
  const rRes = await ask('semanticReview', reviewSystem, buildV2ReviewPayload({ draft, packet }))
  const semanticC = completionOf(rRes)
  const parsed = semanticC.complete ? parseSemanticReview(rRes.rawText) : null
  /**
   * 🔴 **원문 또는 초안에 실제로 있는 문장만 근거로 인정한다.**
   *    사라진 것은 **원문**에서, 새로 만든 것과 생활사 모순은 **초안**에서 확인한다.
   *    지어낸 근거로 막으면 정상 글이 사라진다.
   */
  const semantic = parsed === null ? null : {
    ...parsed,
    droppedFromSource: groundedInSource(parsed.droppedFromSource, sourceBlock(packet)),
    unsupportedAdditions: groundedInDraft(parsed.unsupportedAdditions, draftText),
    lifeContradictions: groundedInDraft(parsed.lifeContradictions, draftText),
  }
  const semanticC2: ReviewCompletion = semanticC.complete && semantic === null
    ? { complete: false, reason: 'parseFailed' } : semanticC

  const j = judgeMachine({ deterministic: det, semantic, semanticCompletion: semanticC2 })
  return blank(plan, dropped, voice, draft, det, semantic, semanticC2, j.outcome, j.reason)
}
