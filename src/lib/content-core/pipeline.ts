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
export const CONTENT_CORE_PIPELINE_VERSION = 'content-core-v2'

export const SPEAKER_PLAN_PROMPT_VERSION = 'speaker-plan-p2'
export const V2_DRAFT_PROMPT_VERSION = 'v2-draft-p6'
export const V2_REVIEW_PROMPT_VERSION = 'v2-review-p6'

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
