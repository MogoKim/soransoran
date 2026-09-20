/**
 * Content Core v2 파이프라인 정본 — 🔴 **한 곳에서만 정한다**
 *
 * 🔴 **왜 `src/lib` 인가.** 봉투 profile(`micro-seed-supply-autofill`)과 발행 profile
 *    (`original-post-auto-publish`)이 이 값을 읽어야 하는데, 그쪽은 `src/lib` 다.
 *    `scripts/` 를 import 할 수 없으므로 정본이 여기 있어야 한다.
 *    러너·프롬프트 쪽(`scripts/lib/content-core-*.mts`)은 여기서 가져다 쓴다.
 *
 * 🔴 **모델이 단계마다 다르다.** 한 칸에 하나만 적으면 거짓이 된다 —
 *    2026-09-20 전환 전 봉투는 `model: 'claude-haiku-4.5'` 한 칸이었고,
 *    그대로 두면 Gemini 가 쓴 글을 Haiku 가 썼다고 기록하게 된다.
 */

/** 🔴 파이프라인 판 — 경로 자체가 바뀌면 올린다 */
export const CONTENT_CORE_PIPELINE_VERSION = 'content-core-v2.1'

export const SPEAKER_PLAN_PROMPT_VERSION = 'speaker-plan-p3'
export const V2_DRAFT_PROMPT_VERSION = 'v2-draft-p7'
export const V2_REVIEW_PROMPT_VERSION = 'v2-review-p7'

export const CONTENT_CORE_STAGES = ['speakerPlan', 'draftGen', 'semanticReview'] as const
export type ContentCoreStage = (typeof CONTENT_CORE_STAGES)[number]

/**
 * 🔴 **단계마다 어느 모델을 쓰는가.** 부르는 쪽이 임의로 고르지 않게 한 곳에 둔다.
 *    검수를 생성과 같은 모델에 맡기면 자기 글을 자기가 채점한다.
 *    🔴 값이 provider 가 아는 이름인지는 `scripts/lib/content-core-run.mts` 가
 *       `ProviderModel` 타입으로 강제한다 — 여기서 `as` 로 우기지 않는다.
 */
export const STAGE_MODEL = Object.freeze({
  speakerPlan: 'gemini-3.7-flash',
  draftGen: 'gemini-3.7-flash',
  semanticReview: 'claude-haiku-4.5',
} as const) satisfies Readonly<Record<ContentCoreStage, string>>

/**
 * 🔴 **단계마다 받아 올 수 있는 출력 토큰 상한** (2026-09-20 실측 보정).
 *
 *    앞판은 세 단계가 `DRAFT_MAX_TOKENS = 1200` **하나를 같이 썼다.** 그런데
 *    Gemini 는 thinking 과 본문을 **같은 한도**로 센다. SHADOW5 449787 에서
 *    thinking 이 1,027 을 먹고 1,196 에서 잘려 **초안이 통째로 사라졌다** —
 *    돈은 썼는데 글이 없다.
 *
 * 🔴 **단계마다 필요한 양이 다르다.** 계획과 검수는 짧은 JSON 하나면 되고,
 *    초안만 본문을 담아야 한다. 그래서 초안에만 자리를 더 준다.
 *    🔴 전체를 4000 으로 올리지 않는다 — 안 쓰는 자리는 예약액만 키운다.
 * 🔴 이 값은 **장부 예약과 provider 요청에 그대로 들어간다.** 화면용 숫자가 아니다.
 */
export const STAGE_MAX_OUTPUT_TOKENS = Object.freeze({
  speakerPlan: 1200,
  draftGen: 2000,
  semanticReview: 1200,
} as const) satisfies Readonly<Record<ContentCoreStage, number>>

/**
 * 🔴 **생성 캐시 key 에 실리는 한 줄.** 단계 상한이 바뀌면 옛 항목은 저절로 miss 된다 —
 *    1200 으로 잘린 결과를 2000 짜리 계약이 재사용하면 안 된다.
 */
export const STAGE_MAX_OUTPUT_LABEL =
  CONTENT_CORE_STAGES.map((s) => `${s}=${STAGE_MAX_OUTPUT_TOKENS[s]}`).join(',')

/** 🔴 봉투 한 칸에 담는 프롬프트 판 — 셋을 합쳐 하나로 적는다 */
export const CONTENT_CORE_PROMPT_VERSION =
  `${SPEAKER_PLAN_PROMPT_VERSION}|${V2_DRAFT_PROMPT_VERSION}|${V2_REVIEW_PROMPT_VERSION}`

/**
 * 🔴 **사람이 읽는 한 줄.** 큐·발행이 "무엇이 이 글을 썼나" 를 적을 때 쓴다.
 *    한 모델 이름을 쓰지 않는다 — 그건 거짓이다.
 */
export const CONTENT_CORE_MODEL_LABEL =
  `${CONTENT_CORE_PIPELINE_VERSION}:`
  + CONTENT_CORE_STAGES.map((s) => `${s}=${STAGE_MODEL[s]}`).join(',')

/**
 * 🔴 **이 글이 어떤 계약으로 만들어졌는가** (2026-09-20).
 *
 *    `artifactVersion` 하나로는 판단할 수 없다 — 그건 **스키마 판**이고,
 *    같은 스키마에서 프롬프트·모델·말투 자산이 바뀔 수 있다. 그러면 지난 HOLD 를
 *    지금 계약의 결론으로 쓰게 된다.
 *
 * 🔴 **원문을 담지 않는다.** 입력은 해시 하나로만 적는다.
 */
export type GenerationContract = {
  /** 🔴 원문 지문 — 판정기 정본 해시와 같은 값이다. 원문을 복원할 수 없다 */
  sourceInputHash: string
  pipelineVersion: string
  promptVersion: string
  stageModels: Readonly<Record<ContentCoreStage, string>>
  /** 말투 자산 판 — 댓글 정본 묶음의 지문 */
  voiceAssetDigest: string
  /** Persona 정본 카드 판 */
  personaCardDigest: string
}

/** 🔴 두 계약이 같은가 — 한 칸이라도 다르면 다른 계약이다 */
/** 🔴 원천과 무관한 칸들 — 회차마다 한 번만 만든다 */
export type ContractBase = Omit<GenerationContract, 'sourceInputHash'>

export function sameGenerationContract(
  a: GenerationContract | null | undefined, b: GenerationContract,
): boolean {
  if (a === null || a === undefined) return false
  return a.sourceInputHash === b.sourceInputHash
    && a.pipelineVersion === b.pipelineVersion
    && a.promptVersion === b.promptVersion
    && a.voiceAssetDigest === b.voiceAssetDigest
    && a.personaCardDigest === b.personaCardDigest
    && CONTENT_CORE_STAGES.every((st) => a.stageModels?.[st] === b.stageModels[st])
}

/**
 * 🔴 봉투에 실린 `stageModels` 가 정본과 **한 칸도 빠짐없이** 같은가.
 *    빠진 칸을 통과시키면 "어느 모델이 썼는지 모르는 글" 이 큐에 올라간다.
 */
export function stageModelsMismatch(v: unknown): string[] {
  if (typeof v !== 'object' || v === null) return ['stageModels 가 없다']
  const got = v as Record<string, unknown>
  const bad: string[] = []
  for (const s of CONTENT_CORE_STAGES) {
    if (got[s] !== STAGE_MODEL[s]) {
      bad.push(`stageModels.${s}=${String(got[s] ?? '(없음)')} ≠ ${STAGE_MODEL[s]}`)
    }
  }
  for (const k of Object.keys(got)) {
    if (!(CONTENT_CORE_STAGES as readonly string[]).includes(k)) bad.push(`모르는 단계 ${k}`)
  }
  return bad
}
