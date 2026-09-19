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
import type { SourceEssence, ClaimRequirement, DropReason } from './essence'
import type { CoverageGap, Stance } from './speaker'
import type { VoiceProvenance } from './voice-evidence'
import type {
  ClaimViolation, DeterministicResult, LifeContradiction, MachineOutcome, ReviewCompletion,
  SemanticVerdict,
} from './review'

export const ARTIFACT_VERSION = 'human-review-v2'

/** 🔴 사람만 적을 수 있다 — 기계가 채우면 사칭이다 */
export const HUMAN_VERDICTS = ['READY', 'EDIT_REQUIRED', 'HOLD'] as const
export type HumanVerdict = (typeof HUMAN_VERDICTS)[number]

export type CallMeta = {
  stage: 'essence' | 'draftGen' | 'semanticReview' | 'ageCheck'
  count: number
  inputTokens: number | null
  outputTokens: number | null
  usd: number | null
}

export type HumanReviewArtifact = {
  artifactVersion: string
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

  essence: SourceEssence | null
  /** 🔴 근거를 지목하지 못해 버린 것 — 조용히 사라지지 않게 남긴다 */
  dropped: { text: string; why: DropReason }[]

  speaker: {
    personaCode: string | null
    stance: Stance | null
    claimRequirements: ClaimRequirement[]
    unmetClaims: ClaimRequirement[]
    coverageGap: CoverageGap | null
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
    /** 🔴 낮춘 자리인데 자기 사실로 주장한 곳 — 초안 속 문장을 가리킨다 */
    claimViolations: ClaimViolation[]
    /** 🔴 카드에 없는 생활사를 새로 주장한 곳 — claim 이 없어도 잡힌다 */
    lifeContradictions: LifeContradiction[]
    /** 🔴 말투 두 책임을 **나눠서** 남긴다 */
    voice: { contentLeak: boolean; mismatch: boolean }
    ageConflict: boolean | null
    ageCompletion: ReviewCompletion
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
  if (a.review.machineOutcome === 'adopt'
    && (!a.review.semanticCompletion.complete || !a.review.ageCompletion.complete)) {
    bad.push('🔴 완주하지 못한 검수로 adopt 가 됐다')
  }
  return bad
}

/** 사람이 읽는 한 줄 — 🔴 판정이 아니라 요약이다 */
export function artifactSummary(a: HumanReviewArtifact): string {
  const s = a.speaker
  return [
    `${a.sourceArticleId}`,
    `근거 ${a.evidence.bodyEvidenceChars}/${a.evidence.bodyLength}자${a.evidence.truncated ? ' (잘림)' : ''}`,
    a.essence?.coreMoment ?? '무슨 이야기인지 확인 못 함',
    `${s.personaCode ?? '화자 없음'} · ${s.stance ?? '자리 없음'}`,
    `기계 ${a.review.machineOutcome}`,
    `사람 ${a.humanDecision.verdict ?? '미판정'}`,
  ].join(' · ')
}
