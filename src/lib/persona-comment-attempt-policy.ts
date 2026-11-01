/**
 * 첫 댓글 **시도 기억 정책** — 🔴 순수 함수. 파일 · DB · 시계 · 네트워크 없음
 *
 * 🔴 **왜 생겼나** (2026-11-01 · D20 첫 댓글 재시도).
 *
 *    한 글의 60분 window 안에서 회차가 여러 번 돈다. 후보가 9관문에서 막히면 적재가 0건이라
 *    **다음 회차가 읽는 상태는 그대로**였고, 같은 글에 같은 Persona × 같은 역할을 다시 보냈다
 *    (10회 호출 · distinct 조합 5개 · 반복 4개). 돈은 나갔고 같은 결과가 나왔다.
 *
 * 🔴 **계약 하나** — 같은 글의 발행 후 60분 window 안에서는 provider 에 이미 보낸 동일
 *    `postId × personaCode × reactionRole` 조합을 다시 선택 · 전송하지 않는다.
 *    새 조합이 없으면 반복하지 않고 유료 호출 0 으로 끝난다.
 *
 * 🔴 **TTL 은 날짜가 아니다.** `postPublishedAtMs + AUTO_FIRST_COMMENT_WINDOW_MS` 다 — 자정을 넘어도 같은 60분 계약이다.
 *
 * 🔴 **기억하는 것은 조합과 결과 코드뿐이다.** 후보 댓글 본문 · prompt · 원문 · detail 은 이 타입에 자리가 없다 —
 *    스키마가 그 밖의 키를 거절한다(파일이 손으로 고쳐져도 본문이 들어올 길이 없다).
 *
 * 🔴 이 모듈은 Gate · threshold · 상수 · 비용 · Queue · 발행을 건드리지 않는다. 첫 댓글 lane 만 쓴다(추가 댓글은 쓰지 않는다).
 */
import { AUTO_FIRST_COMMENT_WINDOW_MS } from './persona-comment-auto-lane'
import { dedupKeyOf } from './persona-comment-queue'

export const ATTEMPT_JOURNAL_VERSION = 1

/** 🔴 `STARTED` = provider 앞에 적은 시작 기록. 이후는 pipeline 의 단계와 같은 낱말이다(provider 를 부른 뒤의 결과만) */
export const ATTEMPT_STEPS = [
  'STARTED', 'PROVIDER_FAILED', 'PARSE_FAILED', 'ENQUEUE_BLOCKED', 'WRITE_SKIPPED', 'WRITE_FAILED', 'ENQUEUED',
] as const
export type AttemptStep = (typeof ATTEMPT_STEPS)[number]

export type AttemptEntry = {
  postId: string
  personaCode: string
  reactionRole: string
  /** 🔴 TTL 의 기준 — 글이 공개된 시각이다 */
  postPublishedAtMs: number
  attemptedAtMs: number
  step: AttemptStep
  /** 막은 관문 `관문:결과` (예: `②:regenerate`) — 🔴 본문 · detail 은 싣지 않는다 */
  failedGates: readonly string[]
  /** 적재 계약이 막은 사유 코드 */
  blockCodes: readonly string[]
}

export type AttemptJournal = { version: typeof ATTEMPT_JOURNAL_VERSION; entries: readonly AttemptEntry[] }

/** 🔴 조합 열쇠는 Queue 의 `dedupKey` 와 같다 — 같은 자리를 같은 이름으로 부른다 */
export function attemptKeyOf(c: { postId: string; personaCode: string; reactionRole: string }): string {
  return dedupKeyOf(c.postId, c.personaCode, c.reactionRole)
}

/** 이 기억이 끝나는 시각(포함) — 발행 + 60분 */
export function attemptExpiresAtMs(e: Pick<AttemptEntry, 'postPublishedAtMs'>): number {
  return e.postPublishedAtMs + AUTO_FIRST_COMMENT_WINDOW_MS
}

/** 🔴 window 는 경계 포함이다(`judgeAutoLane` 도 정확히 60분이면 통과). 그 뒤에는 글이 대상이 아니라 기억할 이유가 없다 */
export function isAttemptActive(e: Pick<AttemptEntry, 'postPublishedAtMs'>, nowMs: number): boolean {
  return nowMs <= attemptExpiresAtMs(e)
}

export function activeAttempts(entries: readonly AttemptEntry[], nowMs: number): AttemptEntry[] {
  return entries.filter((e) => isAttemptActive(e, nowMs))
}

/** 🔴 planner 의 feasible 단계가 제외할 **정확한 조합** 집합 — 같은 Persona 의 다른 역할은 다른 조합이다 */
export function attemptedComboKeys(entries: readonly AttemptEntry[], nowMs: number): Set<string> {
  return new Set(activeAttempts(entries, nowMs).map(attemptKeyOf))
}

// ─────────────────────────────────────────────────────────
// 파일 모양 — 엄격하게 읽는다. 모르는 모양은 fail-closed
// ─────────────────────────────────────────────────────────

export type AttemptParse =
  | { ok: true; journal: AttemptJournal }
  | { ok: false; code: 'JSON_INVALID' | 'SCHEMA_MISMATCH'; reason: string }

const ENTRY_KEYS = [
  'postId', 'personaCode', 'reactionRole', 'postPublishedAtMs', 'attemptedAtMs', 'step', 'failedGates', 'blockCodes',
] as const
/** 관문 번호(①~⑨ 등)와 결과 낱말 — 자유 문장이 들어올 수 없는 모양이다 */
const FAILED_GATE_RE = /^[^\s:]{1,8}:[A-Za-z_-]{1,32}$/
const BLOCK_CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/
const ID_RE = /^[^\s:]{1,128}$/
const LIST_MAX = 32

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringList = (v: unknown, re: RegExp): v is string[] =>
  Array.isArray(v) && v.length <= LIST_MAX && v.every((x) => typeof x === 'string' && re.test(x))

function entryProblem(raw: unknown): string | null {
  if (!isRecord(raw)) return '항목이 객체가 아니다'
  const keys = Object.keys(raw)
  if (keys.length !== ENTRY_KEYS.length || !ENTRY_KEYS.every((k) => keys.includes(k))) return '항목 키가 계약과 다르다'
  for (const k of ['postId', 'personaCode', 'reactionRole'] as const) {
    const v = raw[k]
    if (typeof v !== 'string' || !ID_RE.test(v)) return `${k} 모양이 맞지 않는다`
  }
  for (const k of ['postPublishedAtMs', 'attemptedAtMs'] as const) {
    const v = raw[k]
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) return `${k} 가 양의 정수가 아니다`
  }
  // 🔴 시도는 글이 공개된 뒤 60분 window 안에서만 일어난다(경계 포함 — 런타임이 쓰는 범위와 같다)
  const publishedAtMs = raw.postPublishedAtMs as number
  const attemptedAtMs = raw.attemptedAtMs as number
  if (attemptedAtMs < publishedAtMs || attemptedAtMs > attemptExpiresAtMs({ postPublishedAtMs: publishedAtMs })) {
    return 'attemptedAtMs 가 글 발행 후 60분 window 밖이다'
  }
  if (!(ATTEMPT_STEPS as readonly unknown[]).includes(raw.step)) return 'step 이 계약 밖이다'
  if (!isStringList(raw.failedGates, FAILED_GATE_RE)) return 'failedGates 모양이 맞지 않는다'
  if (!isStringList(raw.blockCodes, BLOCK_CODE_RE)) return 'blockCodes 모양이 맞지 않는다'
  return null
}

/** 🔴 읽기만 한다 — 고치지 않는다. 깨졌으면 부르는 쪽이 유료 생성을 닫는다 */
export function parseAttemptJournal(text: string): AttemptParse {
  let raw: unknown
  try { raw = JSON.parse(text) } catch {
    return { ok: false, code: 'JSON_INVALID', reason: 'JSON 을 읽지 못했다' }
  }
  if (!isRecord(raw) || Object.keys(raw).length !== 2 || raw.version !== ATTEMPT_JOURNAL_VERSION || !Array.isArray(raw.entries)) {
    return { ok: false, code: 'SCHEMA_MISMATCH', reason: `최상위 모양이 v${ATTEMPT_JOURNAL_VERSION} 계약과 다르다` }
  }
  for (const [i, e] of raw.entries.entries()) {
    const why = entryProblem(e)
    if (why !== null) return { ok: false, code: 'SCHEMA_MISMATCH', reason: `entries[${i}] — ${why}` }
  }
  // 🔴 같은 조합은 한 줄이다 — 시작 기록이 중복을 거절하므로, 두 줄이면 손으로 고쳐졌거나 깨진 파일이다
  const seen = new Set<string>()
  for (const [i, e] of (raw.entries as AttemptEntry[]).entries()) {
    const key = attemptKeyOf(e)
    if (seen.has(key)) return { ok: false, code: 'SCHEMA_MISMATCH', reason: `entries[${i}] — 같은 조합이 두 번 있다` }
    seen.add(key)
  }
  return { ok: true, journal: { version: ATTEMPT_JOURNAL_VERSION, entries: raw.entries as AttemptEntry[] } }
}

export function serializeAttemptJournal(entries: readonly AttemptEntry[]): string {
  const journal: AttemptJournal = { version: ATTEMPT_JOURNAL_VERSION, entries }
  return `${JSON.stringify(journal)}\n`
}

// ─────────────────────────────────────────────────────────
// 변경 — 새 배열을 돌려준다. 만료된 기억은 쓸 때마다 털어 파일이 커지지 않는다
// ─────────────────────────────────────────────────────────

export type StartResult =
  | { ok: true; entries: AttemptEntry[] }
  | { ok: false; reason: string }

/** 🔴 시작 기록. 같은 조합이 window 안에 이미 있으면 거절한다 — 두 번째 전송의 마지막 방어선 */
export function withAttemptStarted(entries: readonly AttemptEntry[], e: AttemptEntry, nowMs: number): StartResult {
  const live = activeAttempts(entries, nowMs)
  const key = attemptKeyOf(e)
  if (live.some((x) => attemptKeyOf(x) === key)) {
    return { ok: false, reason: '같은 조합이 이 60분 window 안에서 이미 전송 기록에 있다' }
  }
  if (e.step !== 'STARTED') return { ok: false, reason: '시작 기록의 step 은 STARTED 여야 한다' }
  return { ok: true, entries: [...live, e] }
}

export type AttemptOutcomeUpdate = {
  key: string
  step: AttemptStep
  failedGates: readonly string[]
  blockCodes: readonly string[]
}

/**
 * 🔴 결과 갱신 — 같은 항목의 step · 실패 관문 · 사유 코드만 바꾼다. 조합 · 시각은 건드리지 않는다.
 *    기록이 없는 열쇠는 `missing` 으로 돌려준다(조용히 버리지 않는다).
 */
export function withAttemptOutcomes(
  entries: readonly AttemptEntry[], updates: readonly AttemptOutcomeUpdate[], nowMs: number,
): { entries: AttemptEntry[]; missing: string[] } {
  const live = activeAttempts(entries, nowMs)
  const byKey = new Map(updates.map((u) => [u.key, u]))
  const hit = new Set<string>()
  const next = live.map((e) => {
    const u = byKey.get(attemptKeyOf(e))
    if (u === undefined) return e
    hit.add(u.key)
    return { ...e, step: u.step, failedGates: [...u.failedGates], blockCodes: [...u.blockCodes] }
  })
  return { entries: next, missing: updates.filter((u) => !hit.has(u.key)).map((u) => u.key) }
}

/**
 * 🔴 pipeline 결과 → 기록할 요약. provider 를 부른 뒤의 단계만 기록 대상이다(그 밖은 `null`).
 *    관문은 `통과가 아닌 것`만, 사유는 코드만 — 🔴 문장 · 본문은 받지도 않는다.
 */
export function attemptOutcomeOf(o: {
  step: string
  gates?: readonly { gate: string; outcome: string }[]
  blockCodes?: readonly string[]
}): Omit<AttemptOutcomeUpdate, 'key'> | null {
  if (o.step === 'STARTED' || !(ATTEMPT_STEPS as readonly string[]).includes(o.step)) return null
  const failedGates = (o.gates ?? []).filter((g) => g.outcome !== 'pass').map((g) => `${g.gate}:${g.outcome}`)
    .filter((x) => FAILED_GATE_RE.test(x)).slice(0, LIST_MAX)
  const blockCodes = (o.blockCodes ?? []).filter((c) => BLOCK_CODE_RE.test(c)).slice(0, LIST_MAX)
  return { step: o.step as AttemptStep, failedGates, blockCodes }
}
