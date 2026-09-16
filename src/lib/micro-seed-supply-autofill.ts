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

import { derive, SAFEST_PROFILE } from './scale-profile'
/** 🔴 독창성 정본 — 생성 · 적재 · 발행 전 재검사가 같은 함수를 쓴다 */
import { judgeCopy, readMeasure, describeOriginality } from './draft-originality'
import { readVoiceProvenance } from './original-post-voice-match'
// 🔴 판 값의 정본은 초안 lib 하나다 — 여기서 다시 적으면 올릴 때마다 갈라진다
import { DRAFT_RULE_VERSION, DRAFT_PROMPT_VERSION, DRAFT_PROVENANCE } from './micro-seed-auto-draft'

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
  envelopePromptVersion: DRAFT_PROMPT_VERSION,
  envelopeModel: 'claude-haiku-4.5',
  /** 행의 값 */
  sourceDecision: 'AUTO_ADOPT',
  sourceInput: 'auto-judge',
  candidateType: 'seedOriginality',
} as const

/** 🔴 기계 후보가 큐에 남길 표시 — 사람 것과 한 글자도 겹치지 않는다 */
export const MACHINE_PROMPT_VERSION = 'publish-candidate-auto-v1'
export const MACHINE_MODEL = 'claude-haiku-4.5'
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
  model?: string
}

/**
 * 이 후보가 기계 profile 을 **통째로** 만족하는가.
 *
 * 🔴 어긋난 항목을 전부 돌려준다 — "무엇이 안 맞았나" 를 조용히 삼키지 않는다.
 */
export function machineProfileMismatch(
  env: Envelope, c: Candidate,
): string[] {
  const bad: string[] = []
  const eq = (got: unknown, want: string, label: string): void => {
    if (S(got) !== want) bad.push(`${label}=${S(got) || '(없음)'} (기대 ${want})`)
  }
  eq(env.provenance, MACHINE_PROFILE.envelopeProvenance, 'envelope.provenance')
  eq(env.ruleVersion, MACHINE_PROFILE.envelopeRuleVersion, 'envelope.ruleVersion')
  eq(env.promptVersion, MACHINE_PROFILE.envelopePromptVersion, 'envelope.promptVersion')
  eq(env.model, MACHINE_PROFILE.envelopeModel, 'envelope.model')
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
  const vals = [S(env.provenance), S(c.sourceDecision), S(env.model), S(env.promptVersion)]
  return vals.some((v) => HUMAN_ONLY_VALUES.includes(v))
}

/**
 * 🔴 **독창성 기준을 여기서 다시 적지 않는다** (2026-09-13).
 *
 *    옛 판은 이 파일이 `>= 6`, 생성 쪽이 `< 6` 을 따로 갖고 있어서
 *    정확히 6자인 초안의 운명이 어느 단계를 지나느냐에 따라 달랐다(2026-09-07 실측).
 *    기준이 두 벌이면 반드시 그런 날이 온다. 이제 `draft-originality.ts` 하나가 판정한다.
 */

/** 재고 기준선 (§4-AN) */
/**
 * 🔴 **가장 안전한 기본값이다** (2026-09-08 개정).
 *    내부 공급 기준은 **capacity 단계**를 따르며, 러너가 `readStock`·`judgeFill` 에 주입한다.
 *    주입을 잊으면 여기로 떨어진다 — 재고 목표가 조용히 커지지 않는다.
 */
export const STOCK_WARN = derive(SAFEST_PROFILE).stockWarn
export const STOCK_MIN = derive(SAFEST_PROFILE).stockMin
export const STOCK_TARGET = derive(SAFEST_PROFILE).stockTarget

/** 🔴 재고 기준선 묶음 — capacity 프로필에서 만들어 주입한다 */
export type StockLimits = { warn: number; min: number; target: number }
export const SAFEST_STOCK_LIMITS: StockLimits = { warn: STOCK_WARN, min: STOCK_MIN, target: STOCK_TARGET }

export type StockLevel = 'critical' | 'low' | 'ok'

/**
 * 재고를 읽는다 — 🔴 **세는 대상은 "러너가 실제로 먹을 수 있는 것"** 이다.
 *
 * APPROVED 라도 이미 발행됐으면 재고가 아니고, legacy 판은 러너가 쳐다보지도 않는다.
 * 그래서 큐 전체 건수를 세면 재고를 과대평가한다 — 2026-09-07 에 큐가 9건인데
 * 러너 후보는 0건이었던 것이 그 경우다.
 */
/** 🔴 러너가 먹는 판 — 사람 것과 기계 것 둘 다 */
export const USABLE_PROMPT_VERSIONS: readonly string[] = [
  AUTOFILL_PROMPT_VERSION, MACHINE_PROMPT_VERSION,
] as const

export function readStock(rows: readonly (QueueProfileRow & {
  status: string; createdPostId: string | null
})[],
/** 🔴 capacity 프로필에서 만든 기준선. 주지 않으면 가장 안전한 값이다 */
limits: StockLimits = SAFEST_STOCK_LIMITS,
): { usable: number; level: StockLevel; shortfall: number; human: number; machine: number } {
  // 🔴 **promptVersion 만 보지 않는다.** 발행 러너가 인정하는 행만 재고다 —
  //    판만 맞고 접두나 게이트 기록이 어긋난 행은 넣어도 아무도 못 먹는다.
  const live = rows.filter((r) =>
    (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''))
  const human = live.filter((r) => queueProfileOf(r) === 'human').length
  const machine = live.filter((r) => queueProfileOf(r) === 'machine').length
  const usable = human + machine
  const level: StockLevel = usable <= limits.warn ? 'critical' : usable < limits.min ? 'low' : 'ok'
  return { usable, level, shortfall: Math.max(0, limits.target - usable), human, machine }
}

export type Candidate = {
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
}

/** 보류 목록 한 줄 — 사람이 "이건 지금 내지 말자" 고 정한 것 */
export type HeldEntry = { sourceArticleId: string; title: string; reason?: string }

export type SkipCode =
  | 'TYPE' | 'DECISION' | 'SAFETY' | 'COPIED' | 'UNMEASURED' | 'LEAK' | 'EMPTY'
  | 'ALREADY' | 'HELD' | 'SIBLING'
  | 'PROFILE' | 'IMPERSONATION'

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
  return queue.some((q) =>
    baseArticleId(q.sourceArticleId) === articleId
    && (q.createdPostId === null || q.createdPostId === ''),
  )
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
  /** 지금 재고 (readStock 결과) */
  usable: number
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
  usable: number
  /** 🔴 capacity 프로필의 재고 목표. 주지 않으면 가장 안전한 값 */
  target?: number
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
  // 🔴 목표는 capacity 프로필에서 주입한다. 주지 않으면 가장 안전한 값이다
  const target = input.target ?? STOCK_TARGET
  const room = Math.max(0, target - input.usable)
  if (room === 0) {
    return { ok: false, reason: `재고가 이미 목표 ${target}건이다 (현재 ${input.usable}건)` }
  }
  const n = Math.min(asked, input.targets.length, room)
  // 🔴 `--limit` 은 **정확히** 그 수여야 한다. `--up-to` 는 상한이므로 부분 적재가 정상이다
  if (upTo === null && n < asked) {
    return {
      ok: false,
      reason: `--limit ${asked} 을 채울 수 없다 — 후보 ${input.targets.length}건 · 남은 여력 ${room}건.`
        + ' 잘라내지 않고 멈춘다',
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
 * 🔴 **원문 쪽 세 시각 — 적재가 쓸 값** (2026-09-17).
 *
 *    `sourcePostedAt` 은 **원문이 올라온 시각**이다. 사건·방송·발언 시각이 아니고,
 *    우리가 초안을 쓴 시각(`writtenAt`)도 아니다. 셋을 한 칸에 뭉치면
 *    "오래된 이슈를 오늘 다시 수집한 것" 과 "오늘 올라온 글" 을 구분할 수 없게 된다.
 *
 * 🔴 **`null` 은 "모른다" 다.** 읽을 수 없는 값을 지금 시각이나 `sourceCapturedAt` 으로
 *    메우지 않는다 — 그렇게 메우는 것이 지금 고치려는 결함 그 자체다.
 *
 * 🔴 **이 PR 은 이 값을 DB 에 쓰지 않는다. 활성 schema 에도 컬럼이 없다.**
 *
 *    초안은 `prisma/migrations-draft/0026_raw_content_source_times` 에 있다.
 *    schema 에 컬럼만 올리고 DB 에 적용하지 않으면 **`select` 없는 `create()` 가
 *    없는 컬럼을 RETURNING 하다가 죽는다** — 실측으로
 *    `scripts/micro-seed-import-82cook-live.mts` 의 두 곳이 그렇다.
 *    그래서 schema 변경·migration 적용·적재 연결을 **한 작업으로 묶어** 별도 PR 로 낸다.
 *
 * 🔴 그때까지 이 함수는 **파일에서 파일로** 흐르는 값을 읽는 순수 함수로만 쓰인다.
 */
export type QueueSourceTimes = {
  sourcePostedAt: Date | null
  sourceListedAt: Date | null
  sourceCapturedAt: Date | null
}

/** 🔴 ISO 문자열 하나를 Date 로 — 빈 값도 못 읽는 값도 전부 `null`(모른다) 이다 */
function isoOrNull(v: unknown): Date | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s === '') return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 후보가 실어 온 세 시각을 적재용으로 읽는다 — 🔴 **순수 함수. 지어내지 않는다.**
 *
 * 🔴 `sourcePostedAt` 이 없다고 `sourceCapturedAt` 을 대신 쓰지 않는다.
 *    둘은 서로 다른 것을 뜻하고, 대신 쓰는 순간 **오래된 이슈 재수집**이
 *    **오늘 올라온 글**과 같아 보인다.
 */
export function queueSourceTimesOf(c: {
  sourcePostedAt?: unknown; sourceListedAt?: unknown; sourceCapturedAt?: unknown
}): QueueSourceTimes {
  return {
    sourcePostedAt: isoOrNull(c.sourcePostedAt),
    sourceListedAt: isoOrNull(c.sourceListedAt),
    sourceCapturedAt: isoOrNull(c.sourceCapturedAt),
  }
}

export function buildQueuePayload(input: {
  envelope: Envelope
  candidate: Candidate
  /** 🔴 후보에 실려 온 판정 출처. 상수를 찍지 않고 **이관**한다 */
  autoJudge?: AutoJudgeProvenance
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
        holds: [], blocks: [],
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
          draftRuleVersion: S(env.ruleVersion),
          draftPromptVersion: S(env.promptVersion),
          model: S(env.model),
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
