/**
 * 🔴 **후보 봉투를 조립하는 한 곳** (2026-09-23 마스터 지적)
 *
 *   앞판은 검사가 봉투를 **손으로 축약해** 조립했다. 그러면 러너가 어느 칸을 빠뜨려도
 *   검사는 통과한다 — 실제로 `semanticReview` 가 빠진 채 적재까지 가서 P07 에서
 *   경고가 통째로 사라졌다(실측).
 *
 * 🔴 **러너와 검사가 이 함수 하나를 부른다.** 여기서 빠지면 양쪽이 같이 빨개진다.
 * 🔴 원문 전문·제목은 담지 않는다 — 대조 **결과**만 싣는다(§4-AF ⑤).
 */
import { CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION }
  from '../../src/lib/content-core/pipeline'
import { semanticSummaryOf } from '../../src/lib/micro-seed-supply-autofill'
import type { HumanReviewArtifact } from '../../src/lib/content-core/artifact'

/** 🔴 적재 정본이 읽는 모양 — v2 의 `sampleCount` 를 `comments` 로 잇는다 */
export type CandidateVoiceProvenance = {
  personaCode: string
  comments: number
  bundleDigest: string
  sourceDigest: string
}

export type CandidateSourceMeta = {
  site: string
  sourcePostedAt: string
  sourceListedAt: string
  sourceCapturedAt: string
}

export type CandidateDraft = {
  title: string
  body: string
  safetyVerdict: string
  originality: unknown
  generatedAt: string
}

export type CandidateInput = {
  artifact: HumanReviewArtifact
  sourceArticleId: string
  meta: CandidateSourceMeta
  draft: CandidateDraft
  /** 🔴 제목을 다시 쓴 뒤에도 원문과 같았는가 — 대조 **결과**만이다 */
  sourceTitleCopied: boolean
  sourceTitleCheckVersion: string
  /** 🔴 어느 판정에서 왔는지 — 없으면 `null`. 상수를 찍지 않는다 */
  autoJudge: unknown
  ruleVersion: string
  provenance: string
  reviewedAt: string
}

/**
 * 🔴 **후보 한 건.** 러너가 파일에 적는 그 객체다 — 검사용 축약본이 아니다.
 */
export function candidateEnvelopeItem(a: CandidateInput): Record<string, unknown> {
  const vp = a.artifact.voice.provenance
  return {
    candidateType: 'seedOriginality',
    /** 🔴 사람 검토가 이 한 장을 정확히 찾는 열쇠 — 원문에서 유도하지 않은 값이다 */
    artifactId: a.artifact.artifactId,
    sourceArticleId: a.sourceArticleId,
    sourceSite: a.meta.site,
    sourceTitleChecked: true,
    sourceTitleCopied: a.sourceTitleCopied,
    sourceTitleCheckVersion: a.sourceTitleCheckVersion,
    sourceInput: 'auto-judge',
    sourceDecision: 'AUTO_ADOPT',
    // 🔴 정본을 읽는다 — 여기에 판 이름을 다시 적지 않는다
    draftFrom: CONTENT_CORE_PIPELINE_VERSION,
    title: a.draft.title,
    body: a.draft.body,
    safetyVerdict: a.draft.safetyVerdict,
    // 🔴 **잰 값을 싣는다. 판정이 아니다.** 적재 쪽이 같은 정본으로 다시 판정한다
    originality: a.draft.originality,
    /**
     * 🔴 **적재 정본(`readVoiceProvenance`)이 요구하는 모양으로 잇는다** (2026-09-20).
     *    v2 는 `sampleCount` 로 세고 적재는 `comments` 로 읽는다 — 이름이 달라
     *    그대로 실으면 `voiceProvenance 가 없거나 깨졌다` 로 전량 제외된다.
     */
    voiceProvenance: vp === null ? null : {
      personaCode: vp.personaCode,
      comments: vp.sampleCount,
      bundleDigest: vp.bundleDigest,
      sourceDigest: vp.sourceDigest,
    } satisfies CandidateVoiceProvenance,
    /**
     * 🔴 **의미 검수 요약을 싣는다** (2026-09-22). 빠지면 모델이 찾은 결함이
     *    적재까지 오지 못한다(P07 실측). 문장이 아니라 **수와 완전성**이다.
     */
    semanticReview: semanticSummaryOf(a.artifact.review),
    leakedTokens: '',
    reviewedAt: a.reviewedAt,
    writtenAt: a.draft.generatedAt,
    /**
     * 🔴 **원문 쪽 세 시각** — 적재가 신선도를 재려면 여기를 지나야 한다.
     *    모르면 빈 문자열이다 — 지금 시각으로 채우지 않는다.
     */
    sourcePostedAt: a.meta.sourcePostedAt,
    sourceListedAt: a.meta.sourceListedAt,
    sourceCapturedAt: a.meta.sourceCapturedAt,
    provenanceNote: `기계 생성 · ${a.ruleVersion} · ${a.provenance} · ${CONTENT_CORE_PIPELINE_VERSION}`,
    autoJudge: a.autoJudge,
  }
}

/** 🔴 봉투 전체 — 러너가 `.candidates.json` 으로 적는 그 객체다 */
export function candidateEnvelope(input: {
  generatedAt: string
  ruleVersion: string
  provenance: string
  stageModels: Readonly<Record<string, string>>
  items: readonly CandidateInput[]
}): Record<string, unknown> {
  return {
    note: '🔴 기계가 만들고 기계가 고른 초안이다. 사람의 ADOPT 가 아니다 —'
      + ' supply-autofill 은 이 후보를 큐에 올리지만,'
      + ' 발행은 사람이 publish:machine-review 로 검토를 마쳐야 열린다.',
    generatedAt: input.generatedAt,
    ruleVersion: input.ruleVersion,
    /**
     * 🔴 **단계마다 모델이 다르다.** 한 칸에 하나만 적으면 거짓이 된다 —
     *    `stageModels` 로 통째로 싣고, 봉투 profile 이 정본과 대조한다.
     */
    promptVersion: CONTENT_CORE_PROMPT_VERSION,
    pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
    stageModels: input.stageModels,
    provenance: input.provenance,
    candidates: input.items.map(candidateEnvelopeItem),
  }
}

/**
 * 🔴 **봉투 한 건이 반드시 담아야 하는 칸.** 적재가 이 중 하나라도 없으면
 *    그 후보를 버리거나(voiceProvenance) 근거 없이 올린다(semanticReview·autoJudge).
 */
export const CANDIDATE_REQUIRED_KEYS = [
  'candidateType', 'artifactId', 'sourceArticleId', 'sourceSite',
  'sourceTitleChecked', 'sourceTitleCopied', 'sourceTitleCheckVersion',
  'sourceInput', 'sourceDecision', 'draftFrom', 'title', 'body',
  'safetyVerdict', 'originality', 'voiceProvenance', 'semanticReview',
  'leakedTokens', 'reviewedAt', 'writtenAt',
  'sourcePostedAt', 'sourceListedAt', 'sourceCapturedAt',
  'provenanceNote', 'autoJudge',
] as const

/** 🔴 빠진 칸을 값으로 낸다 — `undefined` 도 없는 것으로 센다 */
export function missingCandidateKeys(item: Record<string, unknown>): string[] {
  return CANDIDATE_REQUIRED_KEYS.filter((k) => !(k in item) || item[k] === undefined)
}
