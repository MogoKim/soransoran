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
import { STAGE_MODEL as CANON_STAGE_MODEL } from '../../src/lib/content-core/pipeline'
import {
  canGenerate, lifeContractIdentity, orderPersonasForSource, parseSpeakerPlan, planSchemaFailed,
} from '../../src/lib/content-core/speaker'
import type { PersonaLifeContract, SpeakerPlan } from '../../src/lib/content-core/speaker'
import { materializePersonaAt } from '../../src/lib/persona-birth-anchor'
import {
  planAxisMapping, fixSourceSpeakerAge, checkAgeMappingApplied,
} from '../../src/lib/content-core/speaker-relative-facts'
import { OTHER_MARKERS } from '../../src/lib/persona-self-age'
/**
 * 🔴 **load-bearing 을 한 번에 판정한다** (2026-09-23). 사람을 차례로 태우지 않는다.
 */
import {
  resolveLoadBearing, loadBearingRequirements, checkLoadBearingPreserved,
  type LoadBearingCandidate,
} from '../../src/lib/content-core/load-bearing'
import {
  selfForbiddenBy, priorFailureLines, type PriorPlanFailure,
} from '../../src/lib/content-core/replan-input'

/** 🔴 KST 날짜 한 줄 — 주입된 시각에서만 만든다 */
function kstDateKey(at: Date): string {
  return new Date(at.getTime() + 9 * 3600e3).toISOString().slice(0, 10)
}
import {
  buildVoiceEvidence, judgeVoiceReadiness, voiceStandardMissingFrom, VOICE_READINESS_LABEL,
} from '../../src/lib/content-core/voice-evidence'
import type { VoiceEvidence } from '../../src/lib/content-core/voice-evidence'
import type { GenerationContract } from '../../src/lib/content-core/pipeline'
import {
  groundedInDraft, groundedInSource, judgeMachine, parseSemanticReview, INCOMPLETE_LABEL,
  type DeterministicFailure, type DeterministicResult, type IncompleteCause,
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
 * 🔴 **정본은 `src/lib/content-core/pipeline.ts` 다.** 봉투·큐·발행이 같은 값을 읽어야 해서
 *    `src` 에 둔다. 여기서는 그 값이 **provider 가 아는 이름인지** 타입으로 강제한다 —
 *    `as` 로 모르는 모델을 억지 통과시키지 않는다.
 */
export const STAGE_MODEL: Readonly<Record<AskStage, ProviderModel>> = CANON_STAGE_MODEL

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
  /**
   * 🔴 **내부 생일** (`YYYY-MM-DD`). 정확한 나이를 계산하는 정본이고,
   *    글에는 나오지 않는다 — 나오는 것은 계산된 나이뿐이다.
   */
  birthDate?: string
  samples: readonly string[]
  bundleDigest: string
}

/**
 * 🔴 **이 회차가 쓸 수 있었던 후보 풀 전체의 한 줄.**
 *
 *    생성 계약(`personaPoolDigest`)이 이 값의 지문을 쓴다. 생활사 계약 전체와
 *    말투 토큰·말투 묶음 지문이 들어간다 — 전부 프롬프트에 실리는 값이다.
 *    🔴 **댓글 원문은 넣지 않는다.** 말투 근거는 `bundleDigest` 가 대신한다.
 *    🔴 후보 순서는 코드 오름차순으로 고정한다 — 읽는 순서가 달라도 같은 값이어야 한다.
 */
export function personaPoolIdentity(cands: readonly PersonaInput[], now?: Date): string {
  return [...cands]
    .sort((a, b) => a.code.localeCompare(b.code))
    /**
     * 🔴 **`birthDate` 도 넣는다** (2026-09-23). 그 값이 프롬프트의 나이 지시를 바꾸므로
     *    계약에 들어가야 한다. 빠지면 생일을 고쳐도 **옛 artifact 가 그대로 재사용**된다.
     */
    .map((c) => {
      /**
       * 🔴 **생일이 지나면 나이가 바뀌므로 캐시도 바뀌어야 한다** (2026-09-23).
       *    `birthDate` 만 넣으면 생일 전후 artifact 가 같은 계약으로 재사용된다.
       *    🔴 날짜가 아니라 **나이**(`ageEpoch`)를 넣는다 — 그래야 매일 무효화되지 않는다.
       */
      const snap = now === undefined ? null
        : materializePersonaAt({ card: { code: c.code, birthDate: c.birthDate ?? '', ageBand: c.ageBand }, now })
      const epoch = snap !== null && snap.ok ? snap.at.ageEpoch : '∅'
      return `${lifeContractIdentity(c)}\u0001birth=${c.birthDate ?? '∅'}`
        + `\u0001age=${epoch}`
        + `\u0001voice=${c.voiceTokens.join('\u0002')}`
        + `\u0001bundle=${c.bundleDigest}`
    })
    .join('\u0003')
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
    // 🔴 정본 생일 — 정확한 나이를 계산하는 유일한 출처다. 글에는 나오지 않는다
    birthDate: card.birthDate,
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
  /**
   * 🔴 **이 한 장의 불투명 id.** 부르는 쪽이 회차마다 새로 만든다 —
   *    원문에서 유도하지 않는다(원문 지문이 DB 로 새는 것을 막는다).
   */
  artifactId: string
  sourceArticleId: string
  /** 🔴 이미 마스킹된 값이다 */
  title: string
  maskedBody: string
  /** 🔴 순서는 여기서 정하지 않는다 — 러너가 원문 지문으로 세운다 */
  personas: readonly PersonaInput[]
  /**
   * 🔴 **좁히기 전의 전체 화자 후보 수** (2026-09-22).
   *
   *    화자 여력 계획이 원천마다 후보를 나누므로, "쓸 사람이 없다" 는 실패가
   *    **두 가지**가 됐다 — 전체에서도 없는 것(결론)과 이번 묶음에만 없는 것
   *    (다음 회차에 달라진다). 이 값이 없으면 둘을 가를 수 없다.
   *    🔴 좁히지 않았으면 `personas.length` 와 같다.
   */
  personaPoolSize: number
  voiceSourceDigest: string
  /** 🔴 이 회차의 생성 계약 — artifact 에 그대로 실린다 */
  contract: GenerationContract
  ask: Ask
  now: Date
  /** 🔴 원천 하나가 쓸 수 있는 요청 수 — 넘기면 완주 실패로 남는다 */
  callCap: number
  /**
   * 🔴 **같은 원천의 지난 실패** (2026-09-23 마스터 지적).
   *
   *    앞판은 실패한 사람을 빼기만 했다. 그러면 계획기는 **왜 실패했는지 모른 채**
   *    같은 1인칭 계획을 또 세운다. 실패 사유를 **요청의 입력으로** 실어
   *    같은 계획을 되풀이하지 않게 한다. 🔴 유료 호출을 늘리지 않는다 — 입력만 늘린다.
   */
  priorFailures?: readonly PriorPlanFailure[]
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
  if (r.blocked) return { complete: false, reason: 'budgetBlocked', cause: 'budgetBlocked' }
  if (!r.ok) return { complete: false, reason: 'noResponse', cause: 'noResponse' }
  if (r.truncated) return { complete: false, reason: 'truncated', cause: 'truncated' }
  if (!r.usageKnown) return { complete: false, reason: 'usageUnknown', cause: 'usageUnknown' }
  return { complete: true, reason: null, cause: null }
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

/**
 * 🔴 **의미 검수를 부르지 않았다.** 조기 종료가 쓰는 값이다 —
 *    예산이 남아 있어도 앞 단계에서 멈추면 검수는 실행되지 않는다.
 *    🔴 `budgetBlocked` 는 **의미 검수 호출이 실제로 막혔을 때만** 쓴다
 *    (`completionOf(rRes)` 가 그것을 판정한다).
 */
const notRun = (cause: IncompleteCause): ReviewCompletion =>
  ({ complete: false, reason: 'notRun', cause })

/**
 * 🔴 **앞 유료 단계가 완주하지 못해서 멈췄다.** 그 단계의 원인을 **그대로 물려준다** —
 *    예산에 막힌 것과 답이 잘린 것은 다음 회차의 처리가 다르다.
 */
const notRunFrom = (c: ReviewCompletion): ReviewCompletion =>
  notRun(c.cause ?? 'noResponse')

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
    artifactId: input.artifactId,
    sourceArticleId: packet.sourceArticleId,
    generatedAt: input.now.toISOString(),
    // 🔴 **어떤 계약으로 만들었는가** — 조기 종료한 artifact 에도 반드시 실린다
    contract: input.contract,
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
      // 🔴 다음 회차를 강제하는 값 — 문구가 아니라 목록이다
      suggestedPersonaCodes: [...suggested],
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
  /**
   * 🔴 **추천 후보는 artifact 에 값으로 남는다** (2026-09-23 마스터 P0-3).
   *    `blank()` 가 이 변수를 읽는다 — 실패 경로마다 따로 넘기면 한 곳이 빠진다.
   */
  let suggested: readonly string[] = []
  if (budgetProblems.length > 0) {
    return blank(null, [], null, null,
      { pass: false, failures: [{ code: 'schemaInvalid', detail: budgetProblems.join(' · ') }] },
      // 🔴 장부 탓이 아니다 — 근거 묶음을 만드는 쪽이 어긋난 것이다. 다시 물어도 같다
      null, notRun('evidenceBudgetViolated'), 'hold', budgetProblems.join(' · '))
  }
  /**
   * 🔴 **이미지·링크·앞 대화 없이는 알 수 없는 글은 만들지 않는다.**
   *    묻기 전에 멈춘다 — 확인 못 한 글에 돈을 쓰지 않는다.
   */
  if (packet.contextSufficiency === 'insufficient') {
    return blank(null, [], null, null, noDet, null, notRun('contextInsufficient'),
      'hold', `무슨 이야기인지 확인하지 못했다 (${packet.insufficientReasons.join('·')})`)
  }

  // ── ① 화자 계획 — 🔴 원문과 실제 카드를 함께 보고, 코드가 근거를 검증한다 ──
  /**
   * 🔴 **이 원문에 대해 정해진 순서로 세운다.** 읽은 순서가 달라도 실제로 보내는 것이
   *    같아야 하고, 그 순서는 계약(`sourceInputHash` + 후보 풀)만으로 다시 만들 수 있어야 한다.
   */
  /**
   * 🔴 **계획도 그날의 Persona 를 본다** (2026-09-23 보정).
   *
   *    앞판은 계획 후보에 **정적 카드 `ageBand`** 를 실었고, 생성 단계만
   *    `materializePersonaAt` 의 `effectiveAgeBand` 를 썼다. 그러면 미래에
   *      계획: "P02 는 40대 후반" · 생성: "P02 는 50대 초반"
   *    으로 **서로 다른 사람**을 보게 된다.
   *    🔴 계획·자격 검증·프롬프트·검수·나이 검사가 **같은 스냅샷** 하나를 쓴다.
   */
  const datedOf = (p: PersonaInput): PersonaInput => {
    const v = materializePersonaAt({
      card: { code: p.code, birthDate: p.birthDate ?? '', ageBand: p.ageBand }, now: input.now,
    })
    return v.ok ? { ...p, ageBand: v.at.effectiveAgeBand } : p
  }
  const dated = input.personas.map(datedOf)
  const ordered = orderPersonasForSource(dated, input.contract.sourceInputHash)
  /**
   * 🔴 **지난 실패를 계획 요청의 입력으로 싣는다** (2026-09-23).
   *    빼기만 하면 계획기는 같은 1인칭 계획을 또 세운다.
   */
  const prior = input.priorFailures ?? []
  const selfForbidden = selfForbiddenBy(prior)
  const pRes = await ask('speakerPlan', buildSpeakerPlanSystemPrompt(),
    buildSpeakerPlanPayload({
      packet, personas: ordered, priorFailures: priorFailureLines(prior), selfForbidden,
    }))
  const pC = completionOf(pRes)
  if (!pC.complete) {
    return blank(null, [], null, null, noDet, null, notRunFrom(pC),
      'hold', `화자 계획을 완주하지 못했다 (${INCOMPLETE_LABEL[pC.reason ?? 'noResponse']})`)
  }
  const parse = parseSpeakerPlan(pRes.rawText, packet, ordered)
  const plan = parse.plan
  const dropped = parse.dropped
  /**
   * 🔴 **형식을 어긴 답과 자격이 없는 원문을 가른다** (2026-09-21 보정).
   *
   *    앞판은 둘 다 `canGenerate` 실패로 흘러 `speakerUnqualified`(결론)가 됐다.
   *    JSON 이 아니거나 schema 가 어긋난 것은 **이번 답이 잘못된 것**이다 —
   *    다시 물으면 달라질 수 있다. 결론으로 적으면 정상 원천이 영구 제외된다.
   */
  if (planSchemaFailed(parse)) {
    const why = parse.schemaProblems.length > 0 ? parse.schemaProblems.join(' · ') : plan.reason
    return blank(plan, dropped, null, null, noDet, null, notRun('parseFailed'),
      'hold', `화자 계획을 읽지 못했다 (${why})`)
  }
  /**
   * 🔴 **좁힌 묶음 탓인지 전체에서도 없는지 가른다** (2026-09-22).
   *
   *    `speakerUnqualified` 는 **결론**이라 그 원천이 영구 제외된다.
   *    후보를 나눈 뒤에는 "이번 묶음에 맞는 사람이 없었다" 가 그 값으로 적히는데,
   *    그것은 결론이 아니다 — 다음 회차에 다른 묶음을 받으면 쓸 수 있다.
   *    🔴 좁혀져 있었으면 `speakerSlotNarrowed`(다시 본다)로 적는다.
   */
  const narrowed = input.personas.length < input.personaPoolSize
  const noSpeakerCause = narrowed ? 'speakerSlotNarrowed' as const : 'speakerUnqualified' as const
  const narrowNote = narrowed
    ? ` (이번 묶음 ${input.personas.length}/${input.personaPoolSize}명 — 좁혀져 있었다)`
    : ''
  const gen = canGenerate(packet, plan)
  if (!gen.ok) {
    return blank(plan, dropped, null, null, noDet, null, notRun(noSpeakerCause),
      'hold', `${gen.why}${narrowNote}`)
  }
  /**
   * 🔴 **제안하지 않은 화자는 받지 않는다** (2026-09-22).
   *
   *    화자 여력 계획이 원천마다 후보를 좁히면서, 모델이 **목록에 없는 이름**을
   *    돌려줄 수 있는 자리가 생겼다. 앞판은 `!` 로 단정해 그 값이 `undefined` 인 채
   *    아래로 흘렀다 — 말투 근거도 자격 판정도 없는 글이 만들어진다.
   *    🔴 제안 밖이면 만들지 않는다(fail-closed).
   */
  // 🔴 계획이 본 것과 **같은 dated 스냅샷**에서 고른다 — 정적 카드로 되돌아가지 않는다
  const persona = dated.find((p) => p.code === plan.personaCode)
  if (persona === undefined) {
    return blank(plan, dropped, null, null, noDet, null, notRun(noSpeakerCause),
      'hold', `제안하지 않은 화자다 — ${plan.personaCode ?? '(없음)'}`
        + ` (제안 ${input.personas.map((p) => p.code).join(',') || '없음'})${narrowNote}`)
  }

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
    return blank(plan, dropped, voice, null, noDet, null, notRun('voiceUnready'),
      'hold', VOICE_READINESS_LABEL[ready.why!])
  }

  // ── ③ 초안 한 편 ──
  /**
   * 🔴 **정말로 들어갔는지 값으로 본다.** 프롬프트 쪽 조건이 잘못되면 기준이
   *    조용히 빠진다 — 두 요청 모두 보내기 전에 확인하고, 하나라도 비면 안 보낸다.
   */
  /**
   * 🔴 **주입된 시계를 쓴다** (2026-09-23). `Date.now()` 를 부르면 같은 입력이
   *    실행 시각에 따라 다른 나이를 내고, 과거 재현도 되지 않는다.
   */
  /**
   * 🔴 **그 시점의 Persona 를 한 번 만든다** — 계획·프롬프트·검사가 같은 값을 쓴다.
   *    🔴 정적 `ageBand` 를 런타임 fallback 으로 쓰지 않는다. 그러면 2031년에도
   *       "40대 후반" 으로 돌아간다(실측 반례).
   */
  // 🔴 위 `dated` 와 같은 함수·같은 시각이다 — 두 번 계산해도 값이 갈리지 않는다
  const snap = materializePersonaAt({
    card: { code: persona.code, birthDate: persona.birthDate ?? '', ageBand: persona.ageBand },
    now: input.now,
  })
  if (!snap.ok) {
    return blank(plan, dropped, null, null, noDet, null, notRun('personaTransformFailed' as const),
      'hold', `Persona 시점 계산 실패 — ${snap.reason}`)
  }
  const at = snap.at

  /**
   * 🔴 **변환 계획을 먼저 판정한다** (2026-09-23 fail-closed).
   *
   *    `protectedFacts` 에서 화자 상대 사실을 빼 놓고 **대체 지시 없이** 생성하면
   *    그 내용이 사라진다. 그래서 여기서 먼저 묻고, 실패하면 **구조화된 이유**로 멈춘다 —
   *    문자열을 파싱해 상태를 정하지 않는다.
   */
  /**
   * ── 🔴 **load-bearing 을 한 번에 판정한다** (2026-09-23 마스터 지적) ──
   *
   *    앞판은 `planAxisMapping` 이 Persona 를 보기도 전에 실패를 냈고, 재계획은
   *    사람만 바꿨다 — 성공 가능성 0 인 반복이었다. 지금은 **조건을 만족하는 후보가
   *    실제로 있는가**를 보고, 없으면 자리를 바꾸고, 그것도 안 되면 **한 번에 결론**이다.
   */
  const lb = resolveLoadBearing({
    facts: plan.speakerRelative
      .filter((e) => e.materiality === 'loadBearing')
      .map((e) => ({ axis: e.axis, sourceText: e.sourceText })),
    stance: plan.stance,
    chosen: { code: persona.code, exactAge: at.exactAge },
    candidates: dated.map((p): LoadBearingCandidate => {
      const v = materializePersonaAt({
        card: { code: p.code, birthDate: p.birthDate ?? '', ageBand: p.ageBand }, now: input.now,
      })
      return { code: p.code, exactAge: v.ok ? v.at.exactAge : null }
    }),
    selfAlreadyFailed: selfForbidden,
  })
  if (!lb.ok) {
    /**
     * 🔴 **코드로 분기한다.** 재시도인지 결론인지가 여기서 갈린다 —
     *    결론을 재시도로 적으면 같은 원천을 유료로 되풀이하고,
     *    재시도를 결론으로 적으면 정상 원천이 영구 제외된다.
     */
    const cause = !lb.retry
      ? 'meaningUnpreservable' as const
      : lb.code === 'PERSONA_MISMATCH' ? 'loadBearingMismatch' as const
        : 'loadBearingSelfImpossible' as const
    // 🔴 문구뿐 아니라 **값으로도** 남긴다 — 다음 회차가 이 목록만 쓴다
    if (lb.retry) suggested = lb.suggest
    const suggest = lb.retry && lb.suggest.length > 0 ? ` (만족하는 후보 ${lb.suggest.join(' ')})` : ''
    return blank(plan, dropped, voice, null, noDet, null, notRun(cause),
      'hold', `${lb.code}: ${lb.reason}${suggest}`)
  }

  const mapping = planAxisMapping({
    facts: plan.speakerRelative.map((e) => ({
      axis: e.axis, sourceText: e.sourceText, role: e.materiality,
    })),
    persona: {
      // 🔴 그날 계산한 값만 쓴다 — 정적 카드 값이 아니다
      exactAge: at.exactAge, ageBand: at.effectiveAgeBand,
      maritalStatus: persona.maritalStatus,
      childrenCount: persona.childrenCount, parentCare: persona.parentCare,
      menopauseStatus: persona.menopauseStatus, work: persona.workStatus, region: persona.region,
    },
  })
  if (!mapping.ok) {
    // 🔴 코드로 분기한다 — 문자열을 파싱해 상태를 정하지 않는다
    const cause = mapping.code === 'LOAD_BEARING'
      ? 'loadBearingMismatch' as const : 'personaTransformFailed' as const
    return blank(plan, dropped, null, null, noDet, null, notRun(cause),
      'hold', `${mapping.axis}: ${mapping.reason}`)
  }

  /**
   * 🔴 **지켜야 하는 조건을 값으로 만든다** (2026-09-23 마스터 P0-2).
   *    초안 지시문과 아래 결정적 후조건이 **같은 값**을 쓴다 — 두 벌로 두면 한쪽이 낡는다.
   */
  const keepRules = loadBearingRequirements({
    facts: plan.speakerRelative
      .filter((e) => e.materiality === 'loadBearing')
      .map((e) => ({ axis: e.axis, sourceText: e.sourceText })),
    stance: plan.stance,
  })
  const draftSystem = buildV2DraftSystemPrompt({
    plan, voice, life: persona, mappings: mapping.mappings, keep: keepRules,
  })
  const reviewSystem = buildV2ReviewSystemPrompt({ plan, voice, life: persona })
  const voiceless = [
    ...(voiceStandardMissingFrom(draftSystem, voice) ? ['생성'] : []),
    ...(voiceStandardMissingFrom(reviewSystem, voice) ? ['의미 검수'] : []),
  ]
  if (voiceless.length > 0) {
    return blank(plan, dropped, voice, null, noDet, null, notRun('wiringBroken'),
      'hold', `말투 기준이 ${voiceless.join('·')} 요청에 들어가지 않았다 — 배선이 어긋났다`)
  }
  const dRes = await ask('draftGen', draftSystem, buildV2DraftPayload({ packet }))
  const dC = completionOf(dRes)
  let draft = dC.complete ? parseDraft(dRes.rawText) : null
  if (draft === null) {
    const why = dC.complete ? '초안을 읽지 못했다' : `초안 생성을 완주하지 못했다 (${INCOMPLETE_LABEL[dC.reason ?? 'noResponse']})`
    return blank(plan, dropped, voice, null,
      { pass: false, failures: [{ code: 'schemaInvalid', detail: why }] },
      // 🔴 읽지 못한 답은 **이번 답**이 잘못된 것이다 — 결론이 아니라 재시도다
      null, dC.complete ? notRun('parseFailed') : notRunFrom(dC), 'hold', why)
  }

  /**
   * 🔴 **자동 보정** (2026-09-23). 모델이 "바꿔 쓰라" 를 어기고 원문 나이를 그대로
   *    베낀 경우, 곧바로 HOLD 로 태우지 않고 **결정적으로 고친다.**
   *    🔴 유료 호출을 더 쓰지 않는다 — 문자열 치환이다.
   *    🔴 고친 뒤 아래 deterministic·semantic 검사를 **그대로 다시 지난다.**
   */
  // 🔴 **모든** age mapping 을 본다 — `.find()` 로 첫 개만 처리하면 나머지가 남는다
  const ageMaps = mapping.mappings.filter((m) => m.axis === 'age')
  const sourceAges = ageMaps.map((m) => m.sourceText)
  if (ageMaps.length > 0) {
    const personaText = ageMaps[0]!.personaText!
    const t = fixSourceSpeakerAge({
      text: draft.title, sourceAges, personaText, otherMarkers: OTHER_MARKERS,
    })
    const b = fixSourceSpeakerAge({
      text: draft.body, sourceAges, personaText, otherMarkers: OTHER_MARKERS,
    })
    if (t.fixed + b.fixed > 0) draft = { ...draft, title: t.text, body: b.text }

    /**
     * 🔴 **이행 후조건** — 고쳤든 안 고쳤든 결과를 확인한다.
     *    초안이 나이 문장을 통째로 빼면 `fixed=0 · remaining=[]` 이라
     *    "고칠 것이 없었다" 와 구분되지 않는다. 그래서 따로 묻는다.
     *    🔴 실패하면 **구조화된 사유**로 돌려보낸다 — 문자열을 파싱하지 않는다.
     */
    const post = checkAgeMappingApplied({
      text: `${draft.title}\n${draft.body}`,
      sourceAges, exactAge: at.exactAge, effectiveAgeBand: at.effectiveAgeBand,
      // 🔴 1인칭 자리에서만 우리 나이를 요구한다
      requireSelfAge: plan.stance === 'SELF_EXPERIENCE',
    })
    if (!post.ok) {
      return blank(plan, dropped, null, null, noDet, null,
        notRun('personaTransformFailed' as const), 'hold', `${post.code}: ${post.reason}`)
    }
  }

  // ── ④ deterministic — 확정 가능한 것만 ──
  const draftText = `${draft.title}\n${draft.body}`
  const failures: DeterministicFailure[] = []
  /**
   * 🔴 **결론을 만드는 조건이 최종 글에 남았는가** (2026-09-23 마스터 P0-2).
   *
   *    원문 자기 나이는 `protectedFacts` 에서 이미 걷어내졌고 `planAxisMapping` 은
   *    load-bearing 을 건너뛴다 — 그래서 초안이 그 조건을 **통째로 지워도** 아무도
   *    막지 못했다. 🔴 의미 검수가 `clean` 이라 답해도 여기서 막는다.
   *    🔴 결정적 단계이므로 **유료 검수 요청 앞**이다 — 호출이 늘지 않는다.
   */
  // 🔴 공용 age mention parser 하나만 본다 — 숫자가 글자로 있는지로 통과시키지 않는다
  const kept = checkLoadBearingPreserved({ text: draftText, requirements: keepRules })
  if (!kept.ok) failures.push({ code: 'loadBearingLost', detail: `${kept.code}: ${kept.reason}` })
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
    const stop = notRun('deterministicFailed')
    const j = judgeMachine({ deterministic: det, semantic: null, semanticCompletion: stop })
    return blank(plan, dropped, voice, draft, det, null, stop, j.outcome, j.reason)
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
    ? { complete: false, reason: 'parseFailed', cause: 'parseFailed' } : semanticC

  const j = judgeMachine({ deterministic: det, semantic, semanticCompletion: semanticC2 })
  return blank(plan, dropped, voice, draft, det, semantic, semanticC2, j.outcome, j.reason)
}
