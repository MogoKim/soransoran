/**
 * Content Core v2 — 🔴 **세로 경로 하나를 끝까지 돈다**
 *
 * 근거 묶음 → 소재 판정 → 화자·자리 → 말투 근거 → 초안 한 편 → 최소 검수 → 사람 판정 한 장
 *
 * 🔴 **효과를 주입받는다.** provider·시계·예산을 직접 부르지 않는다 —
 *    fixture 가 가짜 provider 를 넣고 같은 경로를 돌린다.
 * 🔴 **DB · 큐 · 발행 · 네트워크를 모르는 파일이다.**
 * 🔴 **v1 의 생성·검수 계약을 가져오지 않는다.** 옛 소재 프로파일(`readSourceProfile`) ·
 *    템플릿(`expandSeed`) · 복수 초안(`MAX_DRAFTS_PER_SOURCE`) · 옛 품질 프롬프트가
 *    이 경로로 들어오지 못한다.
 *    🔴 다만 **금지 낱말 · 복제 · 자기 나이 정본은 공유한다** — 저장소에 한 벌이어야 하는
 *    안전 기준이고, 두 벌로 두면 한쪽이 낡는다. 허용 목록은 fixture 가 고정한다.
 */
import { buildEvidencePacket, evidenceText, violatesEvidenceBudget }
  from '../../src/lib/content-core/evidence'
import type { SourceEvidencePacket } from '../../src/lib/content-core/evidence'
import { canGenerate, parseEssence } from '../../src/lib/content-core/essence'
import type { SourceEssence } from '../../src/lib/content-core/essence'
import { planSpeaker } from '../../src/lib/content-core/speaker'
import type { SpeakerFacts, SpeakerPlan } from '../../src/lib/content-core/speaker'
import { buildVoiceEvidence, voiceLeak } from '../../src/lib/content-core/voice-evidence'
import type { VoiceEvidence } from '../../src/lib/content-core/voice-evidence'
import {
  alteredExactAnchors, judgeMachine, parseSemanticReview,
  type DeterministicFailure, type DeterministicResult, type ReviewCompletion, type SemanticVerdict,
} from '../../src/lib/content-core/review'
import { ARTIFACT_VERSION, type CallMeta, type HumanReviewArtifact }
  from '../../src/lib/content-core/artifact'
import { isPersonalInfoAnchor } from '../../src/lib/content-core/essence'
import { hasBannedWord } from '../../src/lib/micro-seed-auto-draft'
import { judgeCopy, measureOriginality } from '../../src/lib/draft-originality'
import { judgeSelfAgeConflict } from '../../src/lib/persona-self-age'
import {
  buildEssencePayload, buildEssenceSystemPrompt, buildV2DraftPayload, buildV2DraftSystemPrompt,
  buildV2ReviewPayload, buildV2ReviewSystemPrompt,
} from './content-core-prompts.mjs'

/** provider 한 번 — 🔴 fixture 가 가짜를 넣는다 */
export type AskResult = {
  ok: boolean
  rawText: string
  /** 🔴 잘림 · 미응답 · 사용량 미상을 **구분해서** 돌려준다 */
  truncated: boolean
  usageKnown: boolean
  inputTokens: number | null
  outputTokens: number | null
  usd: number | null
  /** 예산·상한에 막혀 **나가지도 않았는가** */
  blocked: boolean
}
export type AskStage = CallMeta['stage']
export type Ask = (stage: AskStage, system: string, payload: string) => Promise<AskResult>

export type PersonaInput = SpeakerFacts & {
  voiceCore: string
  samples: readonly string[]
  bundleDigest: string
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
    if (spent >= input.callCap) {
      return { ok: false, rawText: '', truncated: false, usageKnown: false, inputTokens: null, outputTokens: null, usd: null, blocked: true }
    }
    spent += 1
    const r = await input.ask(stage, system, payload)
    calls.push({ stage, count: 1, inputTokens: r.inputTokens, outputTokens: r.outputTokens, usd: r.usd })
    return r
  }

  const packet: SourceEvidencePacket = buildEvidencePacket({
    sourceArticleId: input.sourceArticleId, title: input.title, maskedBody: input.maskedBody,
  })
  const budgetProblems = violatesEvidenceBudget(packet)

  const blank = (
    essence: SourceEssence | null, dropped: { text: string; why: never }[],
    speaker: SpeakerPlan | null, voice: VoiceEvidence | null,
    draft: { title: string; body: string } | null,
    det: DeterministicResult, semantic: SemanticVerdict | null,
    semanticC: ReviewCompletion, ageConflict: boolean | null, ageC: ReviewCompletion,
    outcome: 'adopt' | 'hold' | 'drop', reason: string,
  ): HumanReviewArtifact => ({
    artifactVersion: ARTIFACT_VERSION,
    sourceArticleId: packet.sourceArticleId,
    generatedAt: input.now.toISOString(),
    evidence: {
      title: packet.title, spans: packet.spans, bodyEvidenceChars: packet.bodyEvidenceChars,
      bodyLength: packet.bodyLength, truncated: packet.truncated, omittedRatio: packet.omittedRatio,
      contextSufficiency: packet.contextSufficiency, insufficientReasons: packet.insufficientReasons,
      packetVersion: packet.packetVersion,
    },
    essence,
    droppedAnchors: dropped,
    speaker: {
      personaCode: speaker?.personaCode ?? null, stance: speaker?.stance ?? null,
      claimRequirements: essence?.claimRequirements ?? [],
      unmetClaims: speaker?.unmetClaims ?? [],
      coverageGap: speaker?.coverageGap ?? null,
      reason: speaker?.reason ?? reason,
    },
    voice: { provenance: voice?.provenance ?? null, blindCheckPoints: voice?.blindCheckPoints ?? [] },
    draft,
    review: {
      deterministic: det, semantic, semanticCompletion: semanticC,
      ageConflict, ageCompletion: ageC, machineOutcome: outcome, machineReason: reason,
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
    return blank(null, [], null, null, null,
      { pass: false, failures: [{ code: 'schemaInvalid', detail: budgetProblems.join(' · ') }] },
      null, INCOMPLETE, null, INCOMPLETE, 'hold', budgetProblems.join(' · '))
  }
  /**
   * 🔴 **이미지·링크·앞 대화 없이는 알 수 없는 글은 만들지 않는다.**
   *    묻기 전에 멈춘다 — 확인 못 한 글에 돈을 쓰지 않는다.
   */
  if (packet.contextSufficiency === 'insufficient') {
    return blank(null, [], null, null, null, noDet, null, INCOMPLETE, null, INCOMPLETE,
      'hold', `무슨 이야기인지 확인하지 못했다 (${packet.insufficientReasons.join('·')})`)
  }

  // ── ① 소재 판정 ──
  const eRes = await ask('essence', buildEssenceSystemPrompt(), buildEssencePayload(packet))
  const eParse = eRes.ok && !eRes.truncated
    ? parseEssence(eRes.rawText, packet)
    : { essence: null, droppedAnchors: [], schemaProblems: ['답을 읽지 못했다'] }
  const dropped = eParse.droppedAnchors as { text: string; why: never }[]
  const gen = canGenerate(eParse.essence)
  if (!gen.ok) {
    return blank(eParse.essence, dropped, null, null, null, noDet, null, INCOMPLETE, null, INCOMPLETE, 'hold', gen.why)
  }
  const essence = eParse.essence!

  // ── ② 화자와 자리 ──
  const plan = planSpeaker({
    sourceArticleId: packet.sourceArticleId, essence,
    personas: input.personas, load: input.load,
  })
  if (plan.decision === 'hold' || plan.personaCode === null) {
    return blank(essence, dropped, plan, null, null, noDet, null, INCOMPLETE, null, INCOMPLETE, 'hold', plan.reason)
  }
  const persona = input.personas.find((p) => p.code === plan.personaCode)!

  // ── ③ 말투 근거 ──
  const voice = buildVoiceEvidence({
    personaCode: persona.code, voiceCore: persona.voiceCore, samples: persona.samples,
    bundleDigest: persona.bundleDigest, sourceDigest: input.voiceSourceDigest,
  })

  // ── ④ 초안 한 편 ──
  const dRes = await ask('draftGen',
    buildV2DraftSystemPrompt({ essence, plan, voice }),
    buildV2DraftPayload({ packet, essence }))
  const draft = dRes.ok && !dRes.truncated ? parseDraft(dRes.rawText) : null
  if (draft === null) {
    return blank(essence, dropped, plan, voice, null,
      { pass: false, failures: [{ code: 'schemaInvalid', detail: '초안을 읽지 못했다' }] },
      null, INCOMPLETE, null, INCOMPLETE, 'hold', '초안을 읽지 못했다')
  }

  // ── ⑤ deterministic — 확정 가능한 것만 ──
  const draftText = `${draft.title}\n${draft.body}`
  const failures: DeterministicFailure[] = []
  if (isPersonalInfoAnchor(draftText)) failures.push({ code: 'personalInfo', detail: '개인정보 표식' })
  if (hasBannedWord(draftText)) failures.push({ code: 'bannedWord', detail: '금지 낱말' })
  const copy = judgeCopy(measureOriginality(draftText, evidenceText(packet)))
  if (copy.copied) failures.push({ code: 'copiedFromSource', detail: copy.reason })
  const altered = alteredExactAnchors(essence, draftText)
  if (altered.length > 0) failures.push({ code: 'exactAnchorAltered', detail: altered.join(' · ') })
  const leak = voiceLeak({ draftText, samples: voice.samples, evidenceText: evidenceText(packet), essence })
  if (leak.leaked) failures.push({ code: 'voiceContentLeak', detail: leak.tokens.slice(0, 5).join(' · ') })
  if (persona.ageBand != null && persona.ageBand.trim() !== '') {
    // 🔴 정본이 판정하지 못하면(null) 막지 않는다 — 모르는 것을 결함으로 세지 않는다
    const sa = judgeSelfAgeConflict({ ageBand: persona.ageBand, text: draftText })
    if (sa !== null && sa.conflict) failures.push({ code: 'selfAgeConflict', detail: sa.evidence })
  }
  const det: DeterministicResult = { pass: failures.length === 0, failures }
  if (!det.pass) {
    const j = judgeMachine({ deterministic: det, semantic: null, semanticCompletion: INCOMPLETE, ageCompletion: INCOMPLETE, ageConflict: false })
    return blank(essence, dropped, plan, voice, draft, det, null, INCOMPLETE, null, INCOMPLETE, j.outcome, j.reason)
  }

  // ── ⑥ 의미 검수 1회 ──
  const rRes = await ask('semanticReview',
    buildV2ReviewSystemPrompt({ essence, plan }), buildV2ReviewPayload(draft))
  const semanticC = completionOf(rRes)
  const semantic = semanticC.complete ? parseSemanticReview(rRes.rawText) : null
  const semanticC2: ReviewCompletion = semanticC.complete && semantic === null
    ? { complete: false, reason: 'parseFailed' } : semanticC

  // ── ⑦ 보조 나이 검수 — 🔴 이번 판에서 없애지 않는다 ──
  const aRes = await ask('ageCheck',
    `너는 글 한 편을 읽고 딱 하나만 판정한다.\n글쓴이는 **${persona.ageBand ?? ''}** 여성이다.\n`
    + '글이 자기 나이나 가족 나이를 말하는데 그것과 어긋나는가.\n'
    + 'JSON 만 답한다: {"conflict":true|false,"evidence":"초안에 실제로 있는 문장 (없으면 빈 문자열)"}',
    JSON.stringify({ title: draft.title, body: draft.body }))
  const ageC = completionOf(aRes)
  let ageConflict: boolean | null = null
  let ageC2 = ageC
  if (ageC.complete) {
    try {
      const t = aRes.rawText.trim()
      const j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
      ageConflict = j.conflict === true
    } catch { ageC2 = { complete: false, reason: 'parseFailed' } }
  }

  const j = judgeMachine({
    deterministic: det, semantic, semanticCompletion: semanticC2,
    ageCompletion: ageC2, ageConflict: ageConflict === true,
  })
  return blank(essence, dropped, plan, voice, draft, det, semantic, semanticC2, ageConflict, ageC2, j.outcome, j.reason)
}
