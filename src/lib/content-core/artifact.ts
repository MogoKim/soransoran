/**
 * HumanReviewArtifact — 🔴 **사람이 근거를 보고 판단하는 한 장**
 *
 * 🔴 **담지 않는 것**: 원문 전문 · 프롬프트 원문 · 응답 원문 · API 키 · 개인정보 ·
 *    작성자 · URL · 댓글 본문. 근거는 `SourceEvidencePacket` 이 이미 300자로 묶었다.
 *
 * 🔴 `machineOutcome` 은 **READY 가 아니다.** `humanDecision` 이 비어 있으면
 *    아직 아무도 이 글을 받아들이지 않은 것이다.
 */
import { EVIDENCE_CHAR_BUDGET, type SourceEvidencePacket } from './evidence'
import type { ClosingIntent, ContentRole, DropReason, ProtectedFact } from './source-facts'
import type { SelfBasis, SpeakerWarrant, Stance, WarrantRejection } from './speaker'
import type { VoiceProvenance } from './voice-evidence'
import type {
  DeterministicResult, DroppedFromSource, LifeContradiction, MachineOutcome, ReviewCompletion,
  SemanticVerdict, UnsupportedAddition,
} from './review'

export const ARTIFACT_VERSION = 'human-review-v6'

/** 🔴 사람만 적을 수 있다 — 기계가 채우면 사칭이다 */
export const HUMAN_VERDICTS = ['READY', 'EDIT_REQUIRED', 'HOLD'] as const
export type HumanVerdict = (typeof HUMAN_VERDICTS)[number]

/**
 * 🔴 **`ageCheck` 를 없앴다** (2026-09-19). 나이·가족 나이 모순은 통합 의미 검수의
 *    `lifeContradictions` 가 **같은 근거(초안 속 문장)** 로 받는다 — 카드의 나이대와
 *    자녀 나이대가 이미 그 프롬프트에 들어가 있고, 확정 가능한 자기 나이 모순은
 *    deterministic 이 계속 본다. 정상 경로 4회 → 3회.
 *    🔴 **동등성이 증명된 것은 아니다.** 계약이 같다는 것까지만 확인됐고,
 *       실제 모델이 같은 판정을 내는지는 유료 실측으로만 안다.
 */
export type CallMeta = {
  stage: 'speakerPlan' | 'draftGen' | 'semanticReview'
  /**
   * 🔴 **어느 모델이 이 단계를 맡았는가** (2026-09-19). 단계마다 모델이 다를 수 있어
   *    회차 비용을 합쳐 놓으면 **무엇이 얼마를 썼는지 알 수 없다.**
   */
  model: string | null
  count: number
  inputTokens: number | null
  /** 🔴 과금 기준 출력 — Gemini 는 `candidates + thoughts` 합이다 */
  outputTokens: number | null
  /**
   * 🔴 **그 중 thinking 이 몇인가.** `outputTokens` 에 이미 포함돼 있고,
   *    이 칸은 **포함됐음을 사람이 확인하는 값**이다. 모르면 null 이다 —
   *    thinking 을 쓰지 않는 모델은 null, 썼는데 못 읽었으면 그 건은 미정산이다.
   */
  thoughtsTokens: number | null
  usd: number | null
}

export type HumanReviewArtifact = {
  artifactVersion: string
  /**
   * 🔴 **불투명 id** (2026-09-20). 이 한 장을 정확히 가리키는 이름이다.
   *
   *    🔴 **원문 제목·본문·해시에서 만들지 않는다.** 그렇게 만들면 id 자체가
   *       원문의 지문이 되어 DB·큐에 원문이 새어 나간다. 회차마다 새로 만드는
   *       무작위 값이고, 같은 원천을 두 번 만들면 **서로 다른 id** 다.
   *    🔴 같은 값이 artifact → candidate → gateResults.autoDraft → 사람 검토까지 간다.
   */
  artifactId: string
  sourceArticleId: string
  generatedAt: string

  evidence: {
    title: string
    spans: SourceEvidencePacket['spans']
    bodyEvidenceChars: number
    /** 🔴 제목까지 합친 저장 원문 총량 — 예산이 걸리는 값 */
    totalEvidenceChars: number
    bodyLength: number
    truncated: boolean
    omittedRatio: number
    contextSufficiency: SourceEvidencePacket['contextSufficiency']
    insufficientReasons: SourceEvidencePacket['insufficientReasons']
    packetVersion: string
  }

  /** 🔴 근거를 지목하지 못해 버린 것 — 조용히 사라지지 않게 남긴다 */
  dropped: { text: string; why: DropReason }[]

  /**
   * 🔴 **화자 계획 한 장** — 자격 사실을 표현하는 구조는 `warrants` 하나뿐이다
   *    (2026-09-19 대안 D: `essence.claimRequirements` 와 `speaker.unmetClaims` 두 벌을 없앴다).
   */
  plan: {
    personaCode: string | null
    stance: Stance | null
    /** 🔴 1인칭을 허가받은 방식 — 빈 배열과 구분되는 명시적 값 */
    selfBasis: SelfBasis | null
    /** 🔴 코드 검증을 통과한 허가 근거만 */
    warrants: SpeakerWarrant[]
    universalReason: string
    /** 🔴 1인칭이 거절된 이유 — 자리를 낮추거나 HOLD 한 근거 */
    rejection: WarrantRejection | null
    protectedFacts: ProtectedFact[]
    closingIntent: ClosingIntent | null
    contentRoles: ContentRole[]
    reason: string
  }

  voice: {
    provenance: VoiceProvenance | null
    blindCheckPoints: string[]
  }

  /** 🔴 만들지 않았으면 null — 빈 문자열로 있는 척하지 않는다 */
  draft: { title: string; body: string } | null

  review: {
    deterministic: DeterministicResult
    semantic: SemanticVerdict | null
    semanticCompletion: ReviewCompletion
    /** 🔴 원문에 있었는데 초안에서 사라진 것 — **원문** 속 문장을 가리킨다 */
    droppedFromSource: DroppedFromSource[]
    /** 🔴 원문·카드에 없던 새 사건 — **초안** 속 문장을 가리킨다 */
    unsupportedAdditions: UnsupportedAddition[]
    /** 🔴 카드와 다른 생활사를 자기 일로 주장한 곳 (나이·자녀 나이 포함) */
    lifeContradictions: LifeContradiction[]
    /** 🔴 말투 두 책임을 **나눠서** 남긴다 */
    voice: { contentLeak: boolean; mismatch: boolean }
    /** 🔴 기계 값이다. READY 가 아니다 */
    machineOutcome: MachineOutcome
    machineReason: string
  }

  /** 🔴 사람이 채우는 칸 — 기계는 null 로 둔다 */
  humanDecision: {
    verdict: HumanVerdict | null
    reasons: string[]
    reviewedAt: string | null
  }

  cost: {
    calls: CallMeta[]
    totalCalls: number
    totalInputTokens: number | null
    totalOutputTokens: number | null
    totalUsd: number | null
  }
}

/** 🔴 기록 직전 관문 — 담으면 안 되는 것이 들어갔는가 */
export function violatesArtifact(a: HumanReviewArtifact): string[] {
  const bad: string[] = []
  if (!/^[0-9a-f]{32}$/.test(a.artifactId)) bad.push('🔴 artifactId 가 불투명 id 모양이 아니다')
  if (a.humanDecision.verdict !== null) bad.push('🔴 기계가 사람 판정을 채웠다')
  if (a.humanDecision.reviewedAt !== null) bad.push('🔴 기계가 사람 검토 시각을 채웠다')
  const json = JSON.stringify(a)
  for (const [label, re] of [
    ['API 키', /sk-[A-Za-z0-9_-]{8,}/],
    ['연락처', /\b01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}\b/],
    ['메일', /[\w.+-]+@[\w-]+\.[\w.]+/],
    ['URL', /https?:\/\//],
  ] as const) {
    if (re.test(json)) bad.push(`🔴 ${label} 가 들어 있다`)
  }
  if (a.evidence.bodyEvidenceChars > a.evidence.bodyLength && a.evidence.bodyLength > 0) {
    bad.push('🔴 근거가 원문보다 길다 — 배선이 어긋났다')
  }
  // 🔴 제목까지 합친 총량이 예산 안인가 — 앞판은 제목이 공짜였다
  if (a.evidence.totalEvidenceChars > EVIDENCE_CHAR_BUDGET) {
    bad.push(`🔴 저장 원문 총량 ${a.evidence.totalEvidenceChars}자 — 예산 ${EVIDENCE_CHAR_BUDGET}자를 넘었다`)
  }
  if (a.review.machineOutcome === 'adopt' && !a.review.semanticCompletion.complete) {
    bad.push('🔴 완주하지 못한 검수로 adopt 가 됐다')
  }
  return bad
}

/** 사람이 읽는 한 줄 — 🔴 판정이 아니라 요약이다 */
export function artifactSummary(a: HumanReviewArtifact): string {
  const s = a.plan
  return [
    `${a.sourceArticleId}`,
    `근거 ${a.evidence.bodyEvidenceChars}/${a.evidence.bodyLength}자${a.evidence.truncated ? ' (잘림)' : ''}`,
    `${s.personaCode ?? '화자 없음'} · ${s.stance ?? '자리 없음'}`
      + (s.selfBasis === null ? '' : `(${s.selfBasis})`),
    `기계 ${a.review.machineOutcome}`,
    `사람 ${a.humanDecision.verdict ?? '미판정'}`,
  ].join(' · ')
}
