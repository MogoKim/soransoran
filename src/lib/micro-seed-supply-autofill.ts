/**
 * 공급 자동 보충 판정 — 🔴 **순수 판정만. DB 도 파일도 네트워크도 없다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AN
 *
 * 🔴 **이 파일이 정하는 것은 "무엇을 큐에 더 넣을까" 하나뿐이다.**
 *    적재도 승인도 하지 않는다 — 그건 러너의 일이고, 발행은 아예 다른 레인이다(§4-AL).
 *
 * 🔴 **왜 만드나.** 자동 발행 러너(§4-AL·§4-AM)는 매일 한 건씩 먹는데,
 *    그 앞에 사람이 서 있었다. 2026-09-07 에 후보 9건이 전부 소진돼
 *    러너가 먹을 것이 없어졌고, 사람이 5건을 손으로 다시 올렸다.
 *    **자동 소비기 앞에 수동 공급기가 있으면 그 속도는 사람 손의 속도다.**
 *
 * 🔴 **왜 이렇게 까다롭게 거르나.** 자동 보충은 곧 **사람이 매 건을 보지 않는다**는 뜻이다.
 *    그런데 이 레인의 글은 페르소나 이름으로 커뮤니티에 나간다.
 *    그래서 "사람이 이미 판단한 것" 만 통과시킨다 — 판단을 새로 하지 않는다.
 */

/** 🔴 원문 증거 기록의 정본 — 적재기는 옮길 뿐 판정하지 않는다 */
import {
  SOURCE_EVIDENCE_KEY, buildSourceEvidence,
  type SourceObservation, type SourceStatsSnapshot,
} from './source-slot-release'
/** 🔴 독창성 정본 — 생성 · 적재 · 발행 전 재검사가 같은 함수를 쓴다 */
import { judgeCopy, readMeasure, describeOriginality } from './draft-originality'
import { readVoiceProvenance } from './original-post-voice-match'
// 🔴 판 값의 정본은 초안 lib 하나다 — 여기서 다시 적으면 올릴 때마다 갈라진다
import { DRAFT_RULE_VERSION, DRAFT_PROVENANCE } from './micro-seed-auto-draft'
import {
  CONTENT_CORE_MODEL_LABEL, CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION,
  stageModelsMismatch,
} from './content-core/pipeline'
import { SEMANTIC_SUMMARY_KEY, SEMANTIC_HOLD_CODES, semanticSummaryOf, semanticHoldsOf, lifeReviewHoldsOf, type SemanticSummary } from './semantic-summary-codes'
/** 🔴 품질 계약 — 적재기가 저장하는 값은 이 파일의 코드 상수다(후보 파일 값이 아니다) */
import { qualityContractDigest, currentQualityContract, QUALITY_CONTRACT_KEY } from './quality-contract'

/** 이 판으로 만든 것만 다룬다 (enqueue 브리지와 같은 값) */
export const AUTOFILL_PROMPT_VERSION = 'publish-candidate-v1'
export const AUTOFILL_MODEL = 'human-curated'
export const AUTOFILL_SITE_PREFIX = 'publish-candidate:'

/**
 * 🔴 SRN(shortRawNoindex)은 오지 않는다 — noindex 정책이 달라 경로가 따로다(§4-AH ③).
 *    파일에 섞여 들어오면 여기서 막는다.
 */
export const AUTOFILL_ALLOWED_TYPES: readonly string[] = ['seedOriginality', 'rawOriginality'] as const

/**
 * 🔴 유형마다 "사람이 채택했다" 는 표시가 다르다.
 *    Seed 는 seed-originality 검수에서 `ADOPT`, Raw 는 raw-review 에서 `SAVE` 로 남는다.
 *    한쪽 값만 받으면 다른 레인이 통째로 막히고, 둘 다 아무거나 받으면 검수를 안 거친 것이 샌다.
 */
export const REQUIRED_DECISION: Readonly<Record<string, string>> = {
  seedOriginality: 'ADOPT',
  rawOriginality: 'SAVE',
}

/**
 * 🔴 **기계 후보 profile — 통째로 맞아야 받는다** (§4-AT)
 *
 * `micro-seed-auto-draft`(§4-AS)가 낸 후보를 받는 자리다.
 * 사람 경로(`ADOPT` · `SAVE`)는 그대로 두고 **별도 profile** 로 더한다.
 *
 * 🔴 **필드를 하나씩 독립으로 보지 않는다.** `sourceDecision` 만 맞고 provenance 가
 *    사람 것이면 통과해서는 안 된다 — 그런 행은 어느 쪽 경로로 들어왔는지 알 수 없고,
 *    "기계가 만든 글" 과 "사람이 고른 글" 의 구분이 무너진다.
 *    그래서 **완전한 tuple** 로만 받는다. 하나라도 어긋나면 전부 거절이다.
 *
 * 🔴 **`provenanceNote` 같은 자유 문자열을 믿지 않는다.** 그건 사람이 읽는 메모다.
 */
export const MACHINE_PROFILE = {
  /** 파일 봉투(envelope)의 값 — 🔴 행만 읽고 봉투를 버리면 안 된다 */
  envelopeProvenance: DRAFT_PROVENANCE,
  /**
   * 🔴 **판 값을 여기 다시 적지 않는다** (2026-09-13 정정).
   *
   *    옛 판은 `'auto-draft-v3'` 를 손으로 적어 두었다. 초안 쪽이 v4 · v5 로 올라가는 동안
   *    이 값은 그대로였고, 그래서 **새로 만든 기계 후보가 전부 `PROFILE` 로 제외**됐다 —
   *    공급이 조용히 0 이 되는 모양이다. 실측으로 확인했다.
   *    판 값은 초안 lib 하나가 정한다. 여기서는 가져다 쓴다.
   */
  envelopeRuleVersion: DRAFT_RULE_VERSION,
  /**
   * 🔴 **v2 판이다** (2026-09-20). 세 프롬프트 판을 합친 한 칸이고,
   *    정본은 `src/lib/content-core/pipeline.ts` 다 — 여기서 다시 적지 않는다.
   */
  envelopePromptVersion: CONTENT_CORE_PROMPT_VERSION,
  envelopePipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
  /** 행의 값 */
  sourceDecision: 'AUTO_ADOPT',
  sourceInput: 'auto-judge',
  candidateType: 'seedOriginality',
} as const

/** 🔴 기계 후보가 큐에 남길 표시 — 사람 것과 한 글자도 겹치지 않는다 */
export const MACHINE_PROMPT_VERSION = 'publish-candidate-auto-v1'
/**
 * 🔴 **한 모델 이름을 적지 않는다** (2026-09-20). 단계마다 다르므로
 *    정본(`CONTENT_CORE_MODEL_LABEL`)이 만든 한 줄을 쓴다 —
 *    큐 gateResults 와 발행 profile 이 **같은 값**을 읽는다.
 */
export const MACHINE_MODEL = CONTENT_CORE_MODEL_LABEL
/**
 * 🔴 큐에 남기는 "누가 정했나" 표시 — **판 값을 여기 다시 적지 않는다** (2026-09-13).
 *    옛 판은 `'machine:auto-draft-v3'` 로 굳어 있어서, 초안이 v5 인데도 v3 이라고 적었다.
 *    이 값은 기록일 뿐 판정에 쓰이지 않지만, **틀린 기록은 나중에 원인을 못 찾게 만든다.**
 */
export const MACHINE_DECIDED_BY = `machine:${DRAFT_RULE_VERSION}`
export const MACHINE_SITE_PREFIX = 'publish-candidate:auto:'

/** 🔴 사람 값 — 기계 경로가 이 값을 쓰면 안 된다 */
export const HUMAN_ONLY_VALUES: readonly string[] = [
  'founder', 'human-curated', 'ADOPT', 'SAVE',
] as const

export type Envelope = {
  provenance?: string
  ruleVersion?: string
  promptVersion?: string
  /**
   * 🔴 **단계마다 모델이 다르다** (2026-09-20, Content Core v2 전환).
   *    옛 봉투는 `model` 한 칸이었다. 한 칸에 하나만 적으면 Gemini 가 쓴 글을
   *    Haiku 가 썼다고 기록하게 된다 — 그래서 `stageModels` 를 통째로 싣는다.
   */
  stageModels?: unknown
  pipelineVersion?: string
  /**
   * 🔴 **생성한 코드의 품질 계약 digest** (2026-09-27). 생성기가 적는다.
   *    적재기는 이 값을 **저장하지 않는다** — 자기 코드 상수와 같은지만 본다.
   *    다르거나 없으면 그 파일은 다른 계약(수정 전 코드)이 만든 것이다 → SkipCode CONTRACT.
   */
  qualityContractDigest?: string
}

/**
 * 이 후보가 기계 profile 을 **통째로** 만족하는가.
 *
 * 🔴 어긋난 항목을 전부 돌려준다 — "무엇이 안 맞았나" 를 조용히 삼키지 않는다.
 */
export function machineProfileMismatch(
  env: Envelope, c: Candidate,
): string[] {
  return [...machineShapeMismatch(env, c), ...qualityContractMismatch(env)]
}

/**
 * 🔴 **품질 계약 대조** (2026-09-27) — 봉투의 digest 가 **지금 코드의 digest** 와 같은가.
 *    같아도 저장은 코드 상수로 한다. 이 함수는 **거르기만** 한다.
 */
export function qualityContractMismatch(env: Envelope): string[] {
  const got = S(env.qualityContractDigest)
  const want = qualityContractDigest()
  return got === want ? [] : [`envelope.qualityContractDigest=${got === '' ? '(없음)' : `${got.slice(0, 12)}…`} (기대 ${want.slice(0, 12)}…)`]
}

/** 🔴 기계 profile 의 모양 — 품질 계약을 뺀 나머지 전부 */
export function machineShapeMismatch(
  env: Envelope, c: Candidate,
): string[] {
  const bad: string[] = []
  const eq = (got: unknown, want: string, label: string): void => {
    if (S(got) !== want) bad.push(`${label}=${S(got) || '(없음)'} (기대 ${want})`)
  }
  eq(env.provenance, MACHINE_PROFILE.envelopeProvenance, 'envelope.provenance')
  eq(env.ruleVersion, MACHINE_PROFILE.envelopeRuleVersion, 'envelope.ruleVersion')
  eq(env.promptVersion, MACHINE_PROFILE.envelopePromptVersion, 'envelope.promptVersion')
  eq(env.pipelineVersion, MACHINE_PROFILE.envelopePipelineVersion, 'envelope.pipelineVersion')
  // 🔴 어느 단계를 어느 모델이 맡았는지 **한 칸도 빠짐없이** 같아야 한다
  bad.push(...stageModelsMismatch(env.stageModels))
  eq(c.sourceDecision, MACHINE_PROFILE.sourceDecision, 'sourceDecision')
  eq(c.sourceInput, MACHINE_PROFILE.sourceInput, 'sourceInput')
  eq(c.candidateType, MACHINE_PROFILE.candidateType, 'candidateType')
  eq(c.safetyVerdict, 'pass', 'safetyVerdict')
  // 🔴 **재 둔 값이 있어야 한다.** 없으면 `?? 0` 이 0 을 만들어 통과시킨다 —
  //    "재지 않았다" 가 "겹침 없음" 이 되는 것이 provenance 세탁의 시작이다
  const m = readMeasure(c.originality)
  if (m === null) bad.push('originality 를 재지 않았다')
  else if (judgeCopy(m).copied) bad.push(`originality=${describeOriginality(m)}`)
  /**
   * 🔴 **기계 후보는 말투 근거가 필수다** (2026-09-13).
   *    없으면 발행 단계가 "사람이 쓴 글" 과 구분하지 못해 **아무 Persona 이름으로나** 나간다.
   *    사람 후보에는 이 값이 없고, 그쪽은 이 함수를 통과하지 않는다.
   */
  if (readVoiceProvenance(c.voiceProvenance) === null) bad.push('voiceProvenance 가 없거나 깨졌다')
  if (S(c.leakedTokens) !== '') bad.push(`leakedTokens=${S(c.leakedTokens)}`)
  return bad
}

/**
 * 🔴 **큐 행이 어느 profile 인가 — 발행 러너와 같은 눈으로 본다.**
 *
 * 적재기와 발행기가 각자 판정하면 두 구현이 갈라진다. 실제로 갈라졌었다 —
 * 적재기가 사람 접두를 붙이는 동안 발행기는 기계 접두를 찾고 있었고,
 * 그러면 **넣은 행을 아무도 못 먹는다.**
 * 여기가 그 판정의 단일 지점이고, `original-post-auto-publish` 가 이걸 부른다.
 */
export type QueueProfileRow = {
  promptVersion: string
  model: string
  sourceSite: string
  gateResults?: unknown
}

export function queueProfileOf(r: QueueProfileRow): 'human' | 'machine' | null {
  if (r.promptVersion === AUTOFILL_PROMPT_VERSION
    && r.model === AUTOFILL_MODEL
    && r.sourceSite.startsWith(AUTOFILL_SITE_PREFIX)
    // 🔴 사람 접두가 기계 접두의 앞부분이므로 반드시 배제한다
    && !r.sourceSite.startsWith(MACHINE_SITE_PREFIX)) return 'human'

  if (r.promptVersion === MACHINE_PROMPT_VERSION
    && r.model === MACHINE_MODEL
    && r.sourceSite.startsWith(MACHINE_SITE_PREFIX)
    && machineGateOk(r.gateResults)) return 'machine'

  return null
}

/** gateResults 에 기계 표시가 온전히 남아 있는가 */
export function machineGateOk(gate: unknown): boolean {
  if (gate === null || typeof gate !== 'object') return false
  const g = (gate as Record<string, unknown>).autoDraft
  if (g === null || typeof g !== 'object') return false
  const m = g as Record<string, unknown>
  return String(m.provenance ?? '') === MACHINE_PROFILE.envelopeProvenance
    && String(m.sourceDecision ?? '') === MACHINE_PROFILE.sourceDecision
    && String(m.draftRuleVersion ?? '') === MACHINE_PROFILE.envelopeRuleVersion
}

/** 🔴 사람 값을 사칭했는가 — 하나라도 있으면 기계 후보가 아니다 */
export function impersonatesHuman(env: Envelope, c: Candidate): boolean {
  const vals = [S(env.provenance), S(c.sourceDecision), S(env.pipelineVersion), S(env.promptVersion)]
  return vals.some((v) => HUMAN_ONLY_VALUES.includes(v))
}

/**
 * 🔴 **독창성 기준을 여기서 다시 적지 않는다** (2026-09-13).
 *
 *    옛 판은 이 파일이 `>= 6`, 생성 쪽이 `< 6` 을 따로 갖고 있어서
 *    정확히 6자인 초안의 운명이 어느 단계를 지나느냐에 따라 달랐다(2026-09-07 실측).
 *    기준이 두 벌이면 반드시 그런 날이 온다. 이제 `draft-originality.ts` 하나가 판정한다.
 */

/**
 * **형식이 맞는 미발행 행**을 센다 — 🔴 **발행 가능 재고가 아니다** (2026-09-26 정정).
 *
 * APPROVED 라도 이미 발행됐으면 빼고, legacy 판(profile 불일치)도 뺀다 — 거기까지다.
 * 🔴 사람 검토를 기다리는 기계 초안 · TTL 만료 · 배정 불가도 **여기 들어간다.**
 *    앞판 주석은 이것을 "러너가 실제로 먹을 수 있는 것" 이라 불렀고, 같은 DB 에서
 *    이 값은 9 · 발행 러너는 0 이었다(실측 2026-09-26).
 * 🔴 쓰임은 **적재 천장·적재 정합**뿐이다. 발행 가능 재고는 `scripts/lib/publishable-stock`
 *    의 `classifyStock().counts.publishableNow` 가 정본이다.
 */
/**
 * 🔴 **재고 눈금을 지웠다** (2026-09-30 · source-slot-v1). `STOCK_WARN/MIN/TARGET`(×3·×5·×14) ·
 *    `stockBandOf` · 700 적재 천장은 완성 글 재고를 성공으로 보던 옛 정본이다. 적재 상한은 이제
 *    공급 러너의 JIT 수요(`judgeJitDemand`)가 `--up-to` 로만 준다. 이 수는 **적재 정합**에만 남는다.
 */
/** 🔴 러너가 먹는 판 — 사람 것과 기계 것 둘 다 */
export const USABLE_PROMPT_VERSIONS: readonly string[] = [
  AUTOFILL_PROMPT_VERSION, MACHINE_PROMPT_VERSION,
] as const

export function readStock(rows: readonly (QueueProfileRow & {
  status: string; createdPostId: string | null
})[]): { usable: number; human: number; machine: number } {
  // 🔴 **promptVersion 만 보지 않는다.** 발행 러너가 인정하는 행만 재고다 —
  //    판만 맞고 접두나 게이트 기록이 어긋난 행은 넣어도 아무도 못 먹는다.
  const live = rows.filter((r) =>
    (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''))
  const human = live.filter((r) => queueProfileOf(r) === 'human').length
  const machine = live.filter((r) => queueProfileOf(r) === 'machine').length
  const usable = human + machine
  return { usable, human, machine }
}

export type Candidate = {
  /** 🔴 사람 검토가 artifact 한 장을 정확히 찾는 불투명 열쇠 */
  artifactId?: string
  /**
   * 🔴 **생활 일관성 게이트가 모호하다고 본 축**(2026-09-28 quality-v2) — 코드 배열. 모양은
   *    `lifeReviewHoldsOf` 가 본다: 없거나 어긋나면 `DRAFT_LIFE_REVIEW:unread` 경고다.
   */
  lifeReview?: unknown
  candidateType?: string
  sourceArticleId?: string
  sourceSite?: string
  sourceInput?: string
  sourceDecision?: string
  /**
   * 🔴 **원문 제목 대조 결과** (2026-09-14). 생성기가 메모리 안에서 재고 **판정만** 넘긴다.
   *    🔴 원문 제목도 그 해시도 받지 않는다 — 짧은 제목의 무염 해시는 대입해 맞춰볼 수 있다.
   *    외부 원문이 없는 후보는 `checked` 가 오지 않는다(기존 동작 유지).
   */
  sourceTitleChecked?: boolean
  sourceTitleCopied?: boolean
  sourceTitleCheckVersion?: string
  title?: string
  body?: string
  safetyVerdict?: string
  /** 🔴 잰 값. 판정은 `draft-originality.ts` 가 한다 */
  originality?: unknown
  /**
   * 🔴 **어떤 Persona 의 말투로 썼는가** (2026-09-13).
   *    기록만 하던 값이 아니다 — 발행 matcher 가 이것으로 author 를 고른다.
   */
  voiceProvenance?: unknown
  leakedTokens?: string
  reviewedAt?: string
  provenanceNote?: string
  /**
   * 🔴 **원문 증거 재료** (2026-09-30 · source-evidence-v1) — 생성 봉투가 싣는다(`candidate-envelope`).
   *    적재기는 이 값을 `gateResults.sourceEvidence` 로 **옮길 뿐** 판정하지 않는다. 없으면 모른다.
   */
  sourcePostedAt?: string
  sourceListedAt?: string
  sourceCapturedAt?: string
  sourceResponse?: unknown
  participationDriver?: string
}

/** 보류 목록 한 줄 — 사람이 "이건 지금 내지 말자" 고 정한 것 */
export type HeldEntry = { sourceArticleId: string; title: string; reason?: string }

export type SkipCode =
  | 'TYPE' | 'DECISION' | 'SAFETY' | 'COPIED' | 'UNMEASURED' | 'LEAK' | 'EMPTY'
  | 'ALREADY' | 'HELD' | 'SIBLING'
  | 'PROFILE' | 'IMPERSONATION' | 'CONTRACT'

export const SKIP_LABEL: Record<SkipCode, string> = {
  TYPE: 'seedOriginality · rawOriginality 가 아니다 (SRN 은 경로가 다르다)',
  DECISION: '사람이 채택한 표시가 없다 (Seed=ADOPT · Raw=SAVE)',
  SAFETY: 'safety 가 pass 가 아니다',
  COPIED: '🔴 원문을 실질적으로 옮겼다',
  UNMEASURED: '🔴 독창성을 재지 않았다 — 옛 판(v3) 후보다',
  LEAK: '유출 토큰이 있다',
  EMPTY: '제목이나 본문이 비었다',
  ALREADY: '이미 큐에 올라갔다',
  HELD: '🔴 사람이 보류한 글이다',
  SIBLING: '같은 원문의 형제가 아직 큐에서 안 나갔다',
  PROFILE: '🔴 사람 profile 도 기계 profile 도 아니다 — 섞인 조합은 받지 않는다',
  IMPERSONATION: '🔴 기계 후보가 사람 값을 쓰고 있다',
  CONTRACT: '🔴 기계 후보 파일의 품질 계약이 지금 코드와 다르다 — 다른(수정 전) 코드가 만든 파일이다',
}

export type Skip = { title: string; code: SkipCode }

/** 출처 + 제목 — 제목이 키에 들어간다. 같은 원문에서 나온 두 초안은 서로 다른 후보다 */
export function provenanceKeyOf(articleId: string, title: string): string {
  return `${articleId} ${title.replace(/\s+/g, ' ').trim()}`
}

/**
 * 🔴 **보류 목록 대조.** 이게 이 파일에서 가장 중요한 함수다.
 *
 * 2026-09-07 에 사람이 후보 2건을 뺐다. 같은 원문에서 나온 짝이 이미 나갔거나
 * 큐에 있어서, 결이 비슷한 글이 연달아 나가는 것을 피하려는 판단이었다.
 * 그런데 **그 판단이 어디에도 기록되지 않았다.** 파일에도 DB 에도 없었다.
 *
 * `provenanceKey` 는 제목을 포함하므로 그 2건은 "아직 올린 적 없는 새 후보" 로 보인다.
 * 즉 자동 보충을 그냥 돌리면 **사람이 뺀 것을 기계가 도로 집어넣는다.**
 * 그래서 보류를 파일에 적어 두고(§4-AN ②) 여기서 대조한다.
 */
export function isHeld(c: Candidate, held: readonly HeldEntry[]): boolean {
  const key = provenanceKeyOf(S(c.sourceArticleId), S(c.title))
  return held.some((h) => provenanceKeyOf(h.sourceArticleId, h.title) === key)
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export type QueueRow = {
  sourceArticleId: string
  status: string
  createdPostId: string | null
}

/**
 * 🔴 **형제 검사.** 같은 원문에서 초안이 둘 나왔을 때, 하나가 아직 큐에 미발행으로 남아 있으면
 *    나머지를 넣지 않는다.
 *
 * 왜 발행 여부가 아니라 **미발행 여부**를 보나: 둘이 동시에 큐에 있으면
 * 러너가 연달아 집어 결이 비슷한 글이 이틀 연속 나갈 수 있다.
 * 형제가 이미 나갔으면(발행 완료) 시간이 벌어졌으므로 넣어도 된다.
 */
export function hasPendingSibling(
  articleId: string, queue: readonly QueueRow[],
): boolean {
  return queue.some((q) => baseArticleId(q.sourceArticleId) === articleId && isPendingRow(q))
}

/**
 * 🔴 **미발행 조건의 정본** (2026-09-17).
 *
 *    `hasPendingSibling` 이 이 함수를 부른다. 같은 조건을 다른 곳에서 **다시 쓰지 않는다** —
 *    한 곳에서 `trim()` 을 더하거나 빼는 순간 두 판정이 갈리고,
 *    "생성 전에 걸렀다" 와 "적재에서 걸린다" 가 서로 다른 말을 한다.
 */
export function isPendingRow(r: { createdPostId: string | null }): boolean {
  return r.createdPostId === null || r.createdPostId === ''
}

/**
 * 🔴 **형제 검사의 대상 범위 정본** (2026-09-17).
 *
 *    우리가 만든 synthetic 행인가 — 사람 접두(`publish-candidate:`)와
 *    기계 접두(`publish-candidate:auto:`) 둘 다다.
 *
 * 🔴 **범위를 넓히면 남의 원문까지 막는다.** legacy 행이나 다른 레인의 행에
 *    같은 원문 id 가 있다는 이유로 생성을 막으면, 적재 단계는 그 행을 형제로 세지도 않으므로
 *    **영영 만들어지지 않는 원문**이 생긴다. 적재(`queueForSibling`)와 같은 범위를 쓴다.
 */
export function isOurSite(site: string): boolean {
  return site.startsWith(AUTOFILL_SITE_PREFIX) || site.startsWith(MACHINE_SITE_PREFIX)
}

/** synthetic id 는 `<원래id>-<해시8>` 이다. 앞부분을 되돌린다 */
export function baseArticleId(synthetic: string): string {
  const i = synthetic.lastIndexOf('-')
  return i > 0 ? synthetic.slice(0, i) : synthetic
}

export type RefillInput = {
  /** 🔴 파일 봉투 — 행만 읽고 버리면 기계 profile 을 검증할 수 없다 */
  envelope?: Envelope
  candidates: readonly Candidate[]
  held: readonly HeldEntry[]
  /** 이미 큐에 올라간 것들의 provenanceKey */
  existing: ReadonlySet<string>
  /** 형제 검사용 — 큐 전체 */
  queue: readonly QueueRow[]
}

/**
 * 보충 대상을 고른다 — 🔴 **여덟 관문을 모두 지나야 한다.**
 *
 * 순서에 뜻이 있다. 값이 잘못된 것(TYPE·DECISION·SAFETY…)을 먼저 떨어뜨리고,
 * **사람의 판단(HELD)** 과 **레인의 사정(SIBLING)** 을 마지막에 본다.
 * 그래야 "왜 빠졌나" 를 볼 때 가장 중요한 이유가 남는다.
 */
export function planRefill(input: RefillInput): { targets: Candidate[]; skipped: Skip[] } {
  const targets: Candidate[] = []
  const skipped: Skip[] = []
  const push = (title: string, code: SkipCode): void => { skipped.push({ title, code }) }
  // 이번 회차 안에서도 형제가 겹치면 안 된다 — 파일에 짝이 둘 다 있을 수 있다
  const takenArticles = new Set<string>()

  for (const c of input.candidates) {
    const title = S(c.title)
    const id = S(c.sourceArticleId)
    const type = S(c.candidateType)

    if (!AUTOFILL_ALLOWED_TYPES.includes(type)) { push(title, 'TYPE'); continue }

    // 🔴 **두 profile 중 하나를 통째로 만족해야 한다.** 섞인 조합은 받지 않는다.
    const env = input.envelope ?? {}
    const isHumanShape = S(c.sourceDecision) === REQUIRED_DECISION[type]
      && S(env.provenance) !== MACHINE_PROFILE.envelopeProvenance
    const machineBad = machineProfileMismatch(env, c)
    const isMachineShape = machineBad.length === 0
    /**
     * 🔴 **모양은 기계 후보인데 품질 계약만 다르다** (2026-09-27) — PROFILE 로 뭉개지 않는다.
     *    다른 코드가 만든 파일이라는 뜻이다. 적재하지 않는다.
     */
    if (!isHumanShape && !isMachineShape
      && machineShapeMismatch(env, c).length === 0 && qualityContractMismatch(env).length > 0) {
      push(title, 'CONTRACT'); continue
    }
    if (!isHumanShape && !isMachineShape) { push(title, 'PROFILE'); continue }
    // 🔴 기계 후보가 사람 값을 쓰고 있으면 거절한다 — 사칭이다
    if (isMachineShape && impersonatesHuman(env, c)) { push(title, 'IMPERSONATION'); continue }
    if (S(c.safetyVerdict) !== 'pass') { push(title, 'SAFETY'); continue }
    // 🔴 **생성 때와 같은 함수로 다시 판정한다.** 여기서 숫자를 적으면 기준이 두 벌이 된다
    const measure = readMeasure(c.originality)
    if (measure === null) { push(title, 'UNMEASURED'); continue }
    if (judgeCopy(measure).copied) { push(title, 'COPIED'); continue }
    if (S(c.leakedTokens) !== '') { push(title, 'LEAK'); continue }
    if (title === '' || S(c.body) === '') { push(title, 'EMPTY'); continue }
    if (input.existing.has(provenanceKeyOf(id, title))) { push(title, 'ALREADY'); continue }
    // 🔴 사람이 뺀 것을 기계가 도로 넣지 않는다
    if (isHeld(c, input.held)) { push(title, 'HELD'); continue }
    if (takenArticles.has(id) || hasPendingSibling(id, input.queue)) { push(title, 'SIBLING'); continue }

    takenArticles.add(id)
    targets.push(c)
  }
  return { targets, skipped }
}

export type ApplyGate =
  | { ok: true; take: Candidate[] }
  | { ok: false; reason: string }

/**
 * 실제로 써도 되는가 — 🔴 **두 스위치가 다 있어야 한다.**
 *
 * 🔴 목표치를 넘겨 채우지 않는다. 재고가 14건이면 더 넣을 이유가 없고,
 *    쌓아 두면 오래된 글이 뒤늦게 나가 시의성이 어긋난다.
 */
export function judgeApply(input: {
  targets: readonly Candidate[]
  apply: boolean
  /**
   * 🔴 **사람이 준 정확한 개수.** 못 채우면 잘라내지 않고 멈춘다 —
   *    사람이 "10건" 이라고 했는데 3건만 들어가면 그건 다른 작업이다.
   */
  limit: number | null
  /**
   * 🔴 **자동 경로의 상한.** "이만큼까지 채워라" 이지 "정확히 이만큼" 이 아니다.
   *
   *    러너는 부족분(예: 29건)을 넘기는데 한 회차가 만드는 후보는 몇 건뿐이다.
   *    그것을 `limit` 으로 받으면 **영원히 한 건도 못 채운다** —
   *    2026-09-09 Wave B 에서 목표를 42 로 올리자 실제로 그렇게 됐다(적재 0건).
   *    자동 경로에는 사람이 없으므로 "부분 적재" 가 정상이고, 상한만 지키면 된다.
   *
   *    🔴 `limit` 과 함께 주지 않는다 — 둘 중 하나만 쓴다.
   */
  upTo?: number | null
}): ApplyGate {
  if (!input.apply) return { ok: false, reason: 'dry-run — --apply 가 없다' }
  const upTo = input.upTo ?? null
  if (input.limit !== null && upTo !== null) {
    return { ok: false, reason: '--limit 과 --up-to 를 함께 주지 않는다 — 정확히 채울지 상한까지 채울지 하나만 정한다' }
  }
  const asked = upTo ?? input.limit
  const flag = upTo !== null ? '--up-to' : '--limit'
  if (asked === null || !Number.isInteger(asked) || asked < 1) {
    return { ok: false, reason: `${flag}=N 이 필요하다 (받은 값 ${asked ?? '없음'})` }
  }
  if (input.targets.length === 0) return { ok: false, reason: '보충할 후보가 0건이다' }
  /**
   * 🔴 **재고 목표로 여력을 다시 재지 않는다** (2026-09-30 · source-slot-v1). 앞판은 `target − 재고`
   *    (capacity ×14 · 700)로 한 번 더 잘랐다 — 완성 글 재고가 공급을 정하는 두 번째 정본이었다.
   *    상한은 부르는 쪽이 준 수 하나다(공급 러너는 JIT 수요로 `--up-to` 를 정한다).
   */
  const n = Math.min(asked, input.targets.length)
  // 🔴 `--limit` 은 **정확히** 그 수여야 한다. `--up-to` 는 상한이므로 부분 적재가 정상이다
  if (upTo === null && n < asked) {
    return {
      ok: false,
      reason: `--limit ${asked} 을 채울 수 없다 — 후보 ${input.targets.length}건. 잘라내지 않고 멈춘다`,
    }
  }
  if (n < 1) return { ok: false, reason: '보충할 후보가 0건이다' }
  return { ok: true, take: input.targets.slice(0, n) }
}

/** 보충 뒤 정합 — 🔴 셋이 다 맞아야 한다 */
export function verifyAfterRefill(input: {
  before: { raw: number; queue: number; post: number }
  after: { raw: number; queue: number; post: number }
  added: number
}): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (input.after.raw - input.before.raw !== input.added) {
    problems.push(`RawContent +${input.after.raw - input.before.raw} (기대 +${input.added})`)
  }
  if (input.after.queue - input.before.queue !== input.added) {
    problems.push(`Queue +${input.after.queue - input.before.queue} (기대 +${input.added})`)
  }
  // 🔴 이것이 이 도구의 경계다. 공급은 발행하지 않는다
  if (input.after.post !== input.before.post) {
    problems.push(`🔴 Post 가 ${input.before.post} → ${input.after.post} 로 변했다 — 공급은 발행하지 않는다`)
  }
  return { ok: problems.length === 0, problems }
}


/**
 * 🔴 **큐에 넣을 값을 여기서 만든다 — 순수 함수다.**
 *
 * 2026-09-07 에 러너가 기계 후보에도 사람 접두(`publish-candidate:`)를 붙였다.
 * 그러면 발행 러너의 `queueProfileOf` 가 그 행을 `null` 로 보고 **넣은 것을 아무도 못 먹는다.**
 * 값 만들기를 러너에 두면 이런 어긋남을 fixture 가 볼 수 없다 — 그래서 여기로 옮긴다.
 *
 * 🔴 **입력이 틀렸는데 정상 상수를 찍지 않는다.** profile 이 어긋난 후보로는
 *    payload 를 만들지 않는다(`null`) — 그게 provenance 세탁이다.
 */
export type QueuePayload = {
  profile: 'human' | 'machine'
  syntheticSite: string
  decidedBy: string
  promptVersion: string
  model: string
  gateResults: Record<string, unknown>
}

export type AutoJudgeProvenance = {
  ruleVersion?: string
  promptVersion?: string
  model?: string
  inputHash?: string
  provenance?: string
}

/**
 * 🔴 **원문 증거 재료 — 적재 러너가 목록 관측에서 모은다** (2026-09-30 · source-evidence-v1).
 *    반복 관측과 원천 상대 스냅샷은 파일(목록 산출)에만 있다 — 이 순수 함수는 받은 것을 옮길 뿐이다.
 *    주지 않으면 없다(빈 관측 · 스냅샷 null) — 판정 쪽이 모르는 것으로 읽는다.
 */
export type EvidenceMaterial = { observations: readonly SourceObservation[]; sourceStats: SourceStatsSnapshot | null }

/**
 * 🔴 **후보 → 원문 증거 기록** — 옛 `queueSourceTimesOf`(검사만 부르던 죽은 순수 함수)를 대신한다.
 *    · 게시 · 목록 · 수집 시각은 후보가 실어 온 그대로(서로 메우지 않는다)
 *    · 초안 시각(`reviewedAt`)은 `draftedAt` 칸에만 — 신선도에 쓰지 않는다
 *    · 원문 URL · 제목 · 닉네임은 싣지 않는다(원문 id 는 해시만)
 */
export function sourceEvidenceOf(c: Candidate, m: EvidenceMaterial | null): Record<string, unknown> {
  const r = c.sourceResponse !== null && typeof c.sourceResponse === 'object' && !Array.isArray(c.sourceResponse)
    ? c.sourceResponse as Record<string, unknown> : null
  return buildSourceEvidence({
    postedAt: c.sourcePostedAt, listedAt: c.sourceListedAt, capturedAt: c.sourceCapturedAt,
    sourceSite: c.sourceSite, sourceArticleId: c.sourceArticleId,
    artifactId: (c as unknown as Record<string, unknown>).artifactId,
    dedupKey: `${S(c.sourceSite)}|${S(c.sourceArticleId)}`,
    response: r === null ? null : {
      views: r.views, comments: r.comments, listRank: r.listRank, listPage: r.listPage, observedAt: r.observedAt,
    },
    observations: m?.observations ?? [],
    sourceStats: m?.sourceStats ?? null,
    participationDriver: c.participationDriver,
    draftedAt: c.reviewedAt,
  }) as unknown as Record<string, unknown>
}

export function buildQueuePayload(input: {
  envelope: Envelope
  candidate: Candidate
  /** 🔴 후보에 실려 온 판정 출처. 상수를 찍지 않고 **이관**한다 */
  autoJudge?: AutoJudgeProvenance
  /** 🔴 artifact 의 `review` 블록. 없으면 **재지 못한 것**으로 읽는다 */
  review?: unknown
  /** 🔴 목록 관측에서 모은 증거 재료 — 없으면 null(모른다) */
  evidence?: EvidenceMaterial | null
  now: string
}): QueuePayload | null {
  const { envelope: env, candidate: c } = input
  const site = S(c.sourceSite)
  const machineBad = machineProfileMismatch(env, c)
  const isMachine = machineBad.length === 0

  if (isMachine) {
    if (impersonatesHuman(env, c)) return null
    const aj = input.autoJudge ?? {}
    // 🔴 판정 출처가 없으면 만들지 않는다 — 있지도 않은 근거를 지어내지 않는다
    if (S(aj.ruleVersion) === '' || S(aj.provenance) === '') return null
    return {
      profile: 'machine',
      // 🔴 여기가 P0 였다. 기계는 기계 접두다
      syntheticSite: `${MACHINE_SITE_PREFIX}${site}`,
      decidedBy: MACHINE_DECIDED_BY,
      promptVersion: MACHINE_PROMPT_VERSION,
      model: MACHINE_MODEL,
      gateResults: {
        /**
         * 🔴 **모델이 이미 낸 판정을 옮긴다** (2026-09-22). 앞판은 여기가 `[]` 로
         *    하드코딩돼 있어, semanticReview 가 찾은 결함이 DB 에 오지 못했다.
         *    🔴 `blocks` 는 그대로 비운다 — 이 경고는 후보 생성을 막지 않는다.
         *       사람 검토는 계속되고, **자동 READY 에서만 빠진다.**
         */
        holds: [
          ...semanticHoldsOf(semanticSummaryOf(input.review)),
          /**
           * 🔴 **생활 일관성 게이트가 모호하다고 본 축** (2026-09-28 quality-v2). 채택은 됐지만
           *    사람이 봐야 한다 — 자동 READY 에서만 빠진다. 칸이 없으면 `unread` 경고다(통과 아님).
           */
          ...lifeReviewHoldsOf(c.lifeReview),
        ],
        blocks: [],
        [SEMANTIC_SUMMARY_KEY]: semanticSummaryOf(input.review),
        /**
         * 🔴 **품질 계약 — 지금 코드 상수다** (2026-09-27). 봉투 값을 옮기지 않는다 —
         *    봉투는 위 `machineProfileMismatch` 에서 **같은지만** 봤다. 입력으로 바꿀 칸이 없다.
         */
        [QUALITY_CONTRACT_KEY]: currentQualityContract(),
        /**
         * 🔴 **원문 증거** (2026-09-30 · source-evidence-v1) — 선택기 · 발행 트랜잭션 · 단계 증거가
         *    같은 판정(`judgeSlotRelease`)으로 읽는다. 앞판은 여기서 세 시각을 버렸고, 대신 `sourceCapturedAt`
         *    칸에 초안 시각이 들어가 그것이 원문 나이처럼 쓰였다(A1 ⑦).
         */
        [SOURCE_EVIDENCE_KEY]: sourceEvidenceOf(c, input.evidence ?? null),
        autofill: {
          note: '🔴 기계가 만들고 기계가 고른 글이다. 사람이 고른 것이 아니다',
          candidateType: S(c.candidateType),
          sourceDecision: S(c.sourceDecision),
          safetyVerdict: S(c.safetyVerdict),
          originality: readMeasure(c.originality),
          // 🔴 **대조 결과만 남긴다.** 발행 판정이 제목 복제를 물을 유일한 근거다.
          //    🔴 원문 제목도 해시도 여기 오지 않는다(§4-AF ⑤)
          sourceTitleChecked: c.sourceTitleChecked === true,
          sourceTitleCopied: c.sourceTitleCopied === true,
          sourceTitleCheckVersion: S(c.sourceTitleCheckVersion),
          sourceInput: S(c.sourceInput),
          filledAt: input.now,
        },
        autoDraft: {
          provenance: MACHINE_PROFILE.envelopeProvenance,
          sourceDecision: MACHINE_PROFILE.sourceDecision,
          /**
           * 🔴 **열쇠 둘만 싣는다** (2026-09-20). 사람 검토가 로컬 artifact 정본에서
           *    **정확히 한 장**을 찾는다 — `artifactId` 로 찾고 `sourceArticleId` 로 대조한다.
           *    🔴 원문 제목·본문·근거는 **DB 로 복사하지 않는다** —
           *    그것은 `.microseed-data/*.artifacts.json` 에만 있다.
           *    🔴 `artifactId` 는 원문에서 유도하지 않은 불투명 값이라 지문이 되지 않는다.
           */
          artifactId: S((c as unknown as Record<string, unknown>).artifactId),
          sourceArticleId: S(c.sourceArticleId),
          draftRuleVersion: S(env.ruleVersion),
          draftPromptVersion: S(env.promptVersion),
          // 🔴 단계별 모델을 그대로 남긴다 — 한 칸으로 뭉개지 않는다
          pipelineVersion: S(env.pipelineVersion),
          stageModels: env.stageModels ?? null,
          draftFrom: S((c as unknown as Record<string, unknown>).draftFrom),
          safetyVerdict: S(c.safetyVerdict),
          originality: readMeasure(c.originality),
          // 🔴 발행 matcher 가 읽는다. 여기서 끊기면 말투와 이름이 어긋난다
          voice: readVoiceProvenance(c.voiceProvenance),
          queuedAt: input.now,
        },
        // 🔴 상수가 아니라 **후보에 실려 온 값**이다. 그 판에서 만들어졌다는 증거다
        autoJudge: {
          ruleVersion: S(aj.ruleVersion),
          promptVersion: S(aj.promptVersion),
          model: S(aj.model),
          inputHash: S(aj.inputHash),
          provenance: S(aj.provenance),
        },
      },
    }
  }

  // 사람 경로 — 기존 그대로
  const type = S(c.candidateType)
  if (S(c.sourceDecision) !== REQUIRED_DECISION[type]) return null
  if (S(env.provenance) === MACHINE_PROFILE.envelopeProvenance) return null
  return {
    profile: 'human',
    syntheticSite: `${AUTOFILL_SITE_PREFIX}${site}`,
    decidedBy: 'founder',
    promptVersion: AUTOFILL_PROMPT_VERSION,
    model: AUTOFILL_MODEL,
    gateResults: {
      holds: [], blocks: [],
      // 🔴 사람 후보도 같은 기록을 싣는다 — 재료가 없으면 모르는 기록이 되고 발행 판정이 unknown 으로 읽는다
      [SOURCE_EVIDENCE_KEY]: sourceEvidenceOf(c, input.evidence ?? null),
      autofill: {
        note: '공급 자동 보충 — 사람이 고른 글이다. LLM 생성이 아니다',
        candidateType: type,
        sourceDecision: S(c.sourceDecision),
        safetyVerdict: S(c.safetyVerdict),
        originality: readMeasure(c.originality),
        sourceInput: S(c.sourceInput),
        provenanceNote: S(c.provenanceNote),
        filledAt: input.now,
      },
    },
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 **모델이 찾은 결함이 게이트까지 오지 못했다** (2026-09-22 실측)
//
//   후보 `cmucp5zkd…`(P07) 에서 semanticReview 가 `unsupportedAdditions` 2건을 찾고
//   note 에 "원문의 '전 아직 자녀는 없지만' 을 지우고 아들을 낳은 사람으로 재구성했다"
//   고 적었다. 그런데 DB 의 `gateResults.holds`·`blocks` 는 **비어 있었다.**
//
//   유실은 두 곳이었다.
//     ① artifact → candidates.json : `review` 를 아예 싣지 않았다
//     ② candidate → gateResults    : `holds: [], blocks: []` 를 **하드코딩**했다
//
//   🔴 이미 찾은 경고를 **문자열 규칙으로 다시 찾지 않는다.** 이미 낸 판정을 옮길 뿐이다.
//   🔴 원문 전문을 DB 로 복제하지 않는다 — **개수와 완전성**만 싣는다.
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **의미 검수 요약 파서의 정본은 `semantic-summary-codes.ts`(의존 없는 파일)다** (2026-09-27).
 *    자동 READY 표본의 적격을 정하는 판정이라 품질 계약 CI 지문 대상이다. 이 파일(공급 적재기 전체)을
 *    지문에 넣으면 무관한 수정마다 세대가 바뀐다 — 그래서 판정만 옮겼다. 부르는 쪽은 바뀌지 않는다.
 */
export { SEMANTIC_SUMMARY_KEY, SEMANTIC_HOLD_CODES, semanticSummaryOf, semanticHoldsOf, type SemanticSummary }
