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

/** 원문이 새지 않았다고 볼 수 있는 선 — 후보 파일이 이미 재는 값이다 */
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
export function readStock(rows: readonly {
  status: string; promptVersion: string; createdPostId: string | null
}[]): { usable: number; level: StockLevel; shortfall: number } {
  const usable = rows.filter((r) =>
    r.promptVersion === AUTOFILL_PROMPT_VERSION
    && (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''),
  ).length
  const level: StockLevel = usable <= STOCK_WARN ? 'critical' : usable < STOCK_MIN ? 'low' : 'ok'
  return { usable, level, shortfall: Math.max(0, STOCK_TARGET - usable) }
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

export const SKIP_LABEL: Record<SkipCode, string> = {
  TYPE: 'seedOriginality · rawOriginality 가 아니다 (SRN 은 경로가 다르다)',
  DECISION: '사람이 채택한 표시가 없다 (Seed=ADOPT · Raw=SAVE)',
  SAFETY: 'safety 가 pass 가 아니다',
  OVERLAP: `원문 겹침이 ${MAX_ALLOWED_OVERLAP}자를 넘는다`,
  LEAK: '유출 토큰이 있다',
  EMPTY: '제목이나 본문이 비었다',
  ALREADY: '이미 큐에 올라갔다',
  HELD: '🔴 사람이 보류한 글이다',
  SIBLING: '같은 원문의 형제가 아직 큐에서 안 나갔다',
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
    if (S(c.sourceDecision) !== REQUIRED_DECISION[type]) { push(title, 'DECISION'); continue }
    if (S(c.safetyVerdict) !== 'pass') { push(title, 'SAFETY'); continue }
    if (Number(c.maxOverlap ?? 0) > MAX_ALLOWED_OVERLAP) { push(title, 'OVERLAP'); continue }
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
