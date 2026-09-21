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

export const SPEAKER_PLAN_PROMPT_VERSION = 'speaker-plan-p4'
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
 * 🔴 **이 글이 어떤 계약으로 만들어졌는가** (2026-09-20)
 *
 *    `artifactVersion` 하나로는 판단할 수 없다 — 그건 **스키마 판**이고,
 *    같은 스키마에서 프롬프트·모델·말투 자산이 바뀔 수 있다. 그러면 지난 HOLD 를
 *    지금 계약의 결론으로 쓰게 된다.
 *
 * 🔴 **생성 결과를 바꾸는 값은 전부 여기 있다.** 캐시 key 와 artifact 계약이
 *    따로 조립되던 것을 하나로 합쳤다 — 출력 상한·검수판·화자 계획판·계획 프롬프트가
 *    캐시에만 있어서, 그것들이 바뀌면 캐시는 miss 되는데 지난 HOLD 는 여전히
 *    "지금 계약의 결론" 으로 남았다 (2026-09-20 실측).
 *
 * 🔴 **원문을 담지 않는다.** 입력은 해시 하나로만 적는다.
 */
export type GenerationContract = {
  /** 🔴 원문 지문 — 판정기 정본 해시와 같은 값이다. 원문을 복원할 수 없다 */
  sourceInputHash: string
  pipelineVersion: string
  /** 세 프롬프트 판을 합친 한 줄 */
  promptVersion: string
  /** 화자 계획 **구조** 판 — 프롬프트 판과 다르다 */
  speakerPlanVersion: string
  /** 검수 규칙 판 */
  reviewVersion: string
  /** 🔴 계획 지시문 원문의 지문 — 판 번호를 안 올리고 문구만 바꿔도 결과가 바뀐다 */
  planPromptDigest: string
  stageModels: Readonly<Record<ContentCoreStage, string>>
  /** 🔴 단계별 출력 상한 — 1200 으로 잘린 결과를 2000 짜리 계약이 쓰면 안 된다 */
  stageMaxOutputLabel: string
  /** 말투 자산 판 — 댓글 정본 묶음의 지문 */
  voiceAssetDigest: string
  /**
   * 🔴 **실제로 쓸 수 있었던 Persona 후보 풀의 지문.**
   *    카드 문서 원문이 아니다 — 오타 한 자 고쳤다고 전량 다시 만들 이유가 없다.
   *    코드·말투 토큰·말투 묶음 지문처럼 **결과를 바꾸는 값**만 들어간다.
   */
  personaPoolDigest: string
}

/** 🔴 원천과 무관한 칸들 — 회차마다 한 번만 만든다 */
export type ContractBase = Omit<GenerationContract, 'sourceInputHash'>

/** 🔴 계약의 칸 순서 정본 — 여기 없는 칸은 identity 에 들어가지 않는다 */
const CONTRACT_FIELDS = [
  'sourceInputHash', 'pipelineVersion', 'promptVersion', 'speakerPlanVersion',
  'reviewVersion', 'planPromptDigest', 'stageMaxOutputLabel',
  'voiceAssetDigest', 'personaPoolDigest',
] as const satisfies readonly (keyof GenerationContract)[]

/**
 * 🔴 **계약을 한 줄로.** 생성 캐시 key 와 "지난 결과가 지금 계약인가" 판단이
 *    **이 함수 하나**를 쓴다. 두 곳에서 문자열을 따로 이으면 한쪽이 반드시 낡는다.
 */
export function generationIdentity(c: GenerationContract): string {
  return [
    ...CONTRACT_FIELDS.map((k) => `${k}=${c[k]}`),
    CONTENT_CORE_STAGES.map((st) => `${st}=${c.stageModels[st]}`).join(','),
  ].join('|')
}

/**
 * 🔴 **파일에서 읽은 값을 계약으로.** 한 칸이라도 없거나 모양이 다르면 `null` 이다 —
 *    빈 값을 채워 넣으면 모르는 것이 "같다" 로 통과한다.
 */
export function readGenerationContract(v: unknown): GenerationContract | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of CONTRACT_FIELDS) {
    if (typeof o[k] !== 'string' || o[k] === '') return null
    out[k] = o[k]
  }
  const models = o.stageModels
  if (typeof models !== 'object' || models === null) return null
  const m = models as Record<string, unknown>
  const stageModels: Record<string, string> = {}
  for (const st of CONTENT_CORE_STAGES) {
    if (typeof m[st] !== 'string' || m[st] === '') return null
    stageModels[st] = m[st] as string
  }
  return { ...out, stageModels } as unknown as GenerationContract
}

/** 🔴 두 계약이 같은가 — 한 칸이라도 다르면 다른 계약이다 */
export function sameGenerationContract(
  a: GenerationContract | null | undefined, b: GenerationContract,
): boolean {
  if (a === null || a === undefined) return false
  const norm = readGenerationContract(a)
  if (norm === null) return false
  return generationIdentity(norm) === generationIdentity(b)
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
