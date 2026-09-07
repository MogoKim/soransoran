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
  envelopeProvenance: 'machine-generated',
  envelopeRuleVersion: 'auto-draft-v3',
  envelopePromptVersion: 'draft-gen-v3',
  envelopeModel: 'claude-haiku-4.5',
  /** 행의 값 */
  sourceDecision: 'AUTO_ADOPT',
  sourceInput: 'auto-judge',
  candidateType: 'seedOriginality',
} as const

/** 🔴 기계 후보가 큐에 남길 표시 — 사람 것과 한 글자도 겹치지 않는다 */
export const MACHINE_PROMPT_VERSION = 'publish-candidate-auto-v1'
export const MACHINE_MODEL = 'claude-haiku-4.5'
export const MACHINE_DECIDED_BY = 'machine:auto-draft-v3'
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
  // 🔴 **숫자로 존재해야 한다.** 없으면 `?? 0` 이 0 을 만들어 통과시킨다 —
  //    "재지 않았다" 가 "겹침 0" 이 되는 것이 provenance 세탁의 시작이다
  const ov = c.maxOverlap
  if (typeof ov !== 'number' || !Number.isFinite(ov)) bad.push('maxOverlap 이 숫자가 아니다')
  else if (ov < 0 || ov >= MAX_ALLOWED_OVERLAP) bad.push(`maxOverlap=${ov} (0~${MAX_ALLOWED_OVERLAP - 1})`)
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
 * 원문이 새지 않았다고 볼 수 있는 선 — 후보 파일이 이미 재는 값이다.
 *
 * 🔴 **6자 "미만" 이다.** 이 파일은 `> MAX_ALLOWED_OVERLAP` 으로 재고 있어서
 *    정확히 6자가 통과했다(2026-09-07 실측). 초안 생성 쪽(`micro-seed-auto-draft`)은
 *    `overlap < MAX_OVERLAP` 으로 6자를 막고 있었으므로 **두 곳의 기준이 어긋나 있었다.**
 *    통과선을 느슨한 쪽에 맞추면 엄한 쪽 검사가 무의미해진다.
 */
export const MAX_ALLOWED_OVERLAP = 6

/** 재고 기준선 (§4-AN) */
export const STOCK_WARN = 3
export const STOCK_MIN = 5
export const STOCK_TARGET = 14

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
})[]): { usable: number; level: StockLevel; shortfall: number; human: number; machine: number } {
  // 🔴 **promptVersion 만 보지 않는다.** 발행 러너가 인정하는 행만 재고다 —
  //    판만 맞고 접두나 게이트 기록이 어긋난 행은 넣어도 아무도 못 먹는다.
  const live = rows.filter((r) =>
    (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''))
  const human = live.filter((r) => queueProfileOf(r) === 'human').length
  const machine = live.filter((r) => queueProfileOf(r) === 'machine').length
  const usable = human + machine
  const level: StockLevel = usable <= STOCK_WARN ? 'critical' : usable < STOCK_MIN ? 'low' : 'ok'
  return { usable, level, shortfall: Math.max(0, STOCK_TARGET - usable), human, machine }
}

export type Candidate = {
  candidateType?: string
  sourceArticleId?: string
  sourceSite?: string
  sourceInput?: string
  sourceDecision?: string
  title?: string
  body?: string
  safetyVerdict?: string
  maxOverlap?: number
  leakedTokens?: string
  reviewedAt?: string
  provenanceNote?: string
}

/** 보류 목록 한 줄 — 사람이 "이건 지금 내지 말자" 고 정한 것 */
export type HeldEntry = { sourceArticleId: string; title: string; reason?: string }

export type SkipCode =
  | 'TYPE' | 'DECISION' | 'SAFETY' | 'OVERLAP' | 'LEAK' | 'EMPTY'
  | 'ALREADY' | 'HELD' | 'SIBLING'
  | 'PROFILE' | 'IMPERSONATION'

export const SKIP_LABEL: Record<SkipCode, string> = {
  TYPE: 'seedOriginality · rawOriginality 가 아니다 (SRN 은 경로가 다르다)',
  DECISION: '사람이 채택한 표시가 없다 (Seed=ADOPT · Raw=SAVE)',
  SAFETY: 'safety 가 pass 가 아니다',
  OVERLAP: `원문 겹침이 ${MAX_ALLOWED_OVERLAP}자 이상이다 (${MAX_ALLOWED_OVERLAP}자 미만이어야 한다)`,
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
    // 🔴 `>=` 다. `>` 였을 때 정확히 6자가 통과했다
    if (Number(c.maxOverlap ?? 0) >= MAX_ALLOWED_OVERLAP) { push(title, 'OVERLAP'); continue }
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
  limit: number | null
  usable: number
}): ApplyGate {
  if (!input.apply) return { ok: false, reason: 'dry-run — --apply 가 없다' }
  if (input.limit === null || !Number.isInteger(input.limit) || input.limit < 1) {
    return { ok: false, reason: `--limit=N 이 필요하다 (받은 값 ${input.limit ?? '없음'})` }
  }
  if (input.targets.length === 0) return { ok: false, reason: '보충할 후보가 0건이다' }
  const room = Math.max(0, STOCK_TARGET - input.usable)
  if (room === 0) {
    return { ok: false, reason: `재고가 이미 목표 ${STOCK_TARGET}건이다 (현재 ${input.usable}건)` }
  }
  const n = Math.min(input.limit, input.targets.length, room)
  if (n < input.limit) {
    return {
      ok: false,
      reason: `--limit ${input.limit} 을 채울 수 없다 — 후보 ${input.targets.length}건 · 남은 여력 ${room}건.`
        + ' 잘라내지 않고 멈춘다',
    }
  }
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
          maxOverlap: Number(c.maxOverlap ?? 0),
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
          maxOverlap: Number(c.maxOverlap ?? 0),
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
        maxOverlap: Number(c.maxOverlap ?? 0),
        sourceInput: S(c.sourceInput),
        provenanceNote: S(c.provenanceNote),
        filledAt: input.now,
      },
    },
  }
}
