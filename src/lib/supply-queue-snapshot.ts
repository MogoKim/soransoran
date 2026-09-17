/**
 * 생성 전 큐 스냅샷 — 🔴 **순수 함수. DB·파일·시각 조회 0**
 *
 * 🔴 **왜 필요한가** (2026-09-17 실측).
 *
 *    12:15 회차는 소재 266건을 **유료로** 생성해 183건을 채택했고, 적재는 **10건**이었다.
 *    빠진 이유 중 가장 큰 것은 `SIBLING` **161건** —
 *    *"같은 원문의 형제가 아직 큐에서 안 나갔다"* 다.
 *
 *    그 판정은 `micro-seed-supply-autofill.hasPendingSibling` 이 하고,
 *    **원문 id 와 큐 상태만 있으면 생성 전에 알 수 있다.** 그런데 지금은
 *    생성이 다 끝난 **적재 단계**에서 본다. 즉 **낼 수 없는 것을 만든 뒤에 버린다.**
 *
 * 🔴 **그런데 생성기는 DB 를 읽지 않는다** — 그것이 이 레인의 계약이다
 *    (`micro-seed-auto-draft.mts` 머리말: `DB 0 · 큐 0 · 발행 0 · Sheet 0`).
 *    계약을 깨지 않으려면 **러너가 읽어서 파일로 건넨다.** 이 파일이 그 계약이다.
 *
 * 🔴 **판정 규칙을 여기서 다시 만들지 않는다.** 정본은 `hasPendingSibling` ·
 *    `baseArticleId` 하나이고, 스냅샷은 그 정본이 만든 집합을 **옮기기만** 한다.
 *
 * 🔴 **앞당기는 것은 `SIBLING` 하나뿐이다.**
 *    `ALREADY`(이미 큐에 올라갔다) 와 `HELD`(사람이 보류했다) 는 **후보 제목**을 본다.
 *    생성 전에는 제목이 없다 — 원문 id 로 그것을 대신하면 *"이 원문은 영영 금지"* 가 되고,
 *    같은 원문에서 나올 **다른 초안까지** 막는다. 그것은 다른 정책이다. 여기서 만들지 않는다.
 *    적재 단계의 `ALREADY`·`HELD`·중복·트랜잭션 검사는 **그대로 남는다.**
 */

import { baseArticleId, isOurSite, isPendingRow } from './micro-seed-supply-autofill'

/** 🔴 파일이 무엇인지 — 다른 파일을 잘못 읽었을 때 조용히 통과하지 않게 한다 */
export const QUEUE_SNAPSHOT_KIND = 'supply-queue-snapshot'

/**
 * 🔴 계약 판. 모양이나 뜻이 바뀌면 **올린다** —
 *    옛 판을 새 판정에 쓰면 "걸렀다" 는 기록만 남고 실제로는 안 걸러진다.
 */
export const QUEUE_SNAPSHOT_VERSION = 'queue-snapshot-v1'

/**
 * 🔴 **오래된 스냅샷을 쓰지 않는다** — 30분.
 *
 *    회차 하나가 45분 넘게 걸린 실측이 있다(12:15 회차 45분 53초). 그동안
 *    다른 경로가 큐에 넣을 수 있고, 그러면 스냅샷은 **없는 세상**을 말한다.
 *    🔴 그래도 이 값이 정합성을 보장하지는 않는다 — **최종 판정은 적재 단계가 한다.**
 *    여기서 하는 일은 "확실히 낼 수 없는 것" 을 미리 빼는 것뿐이다.
 */
export const QUEUE_SNAPSHOT_TTL_MS = 30 * 60 * 1000

/** 회차마다 다른 파일 — 🔴 이전 회차 파일을 집어 쓰지 못하게 이름에 회차를 박는다 */
export const queueSnapshotFileName = (runId: string): string =>
  `supply-queue-snapshot-${runId}.json`

export type QueueSnapshot = {
  kind: string
  version: string
  runId: string
  /** ISO. 🔴 신선도 판정의 기준이다 */
  takenAt: string
  /**
   * 🔴 **미발행 후보가 큐에 남아 있는 원문 id** (`baseArticleId` 적용 후).
   *    "이 원문으로 지금 만들어도 적재되지 않는다" 는 뜻이다.
   */
  pendingSourceIds: string[]
}

/**
 * 큐 한 줄 — 🔴 적재의 `queueForSibling` 이 보는 것과 **같은 세 칸**이다.
 *
 * 🔴 `sourceSite` 가 있어야 한다. 적재는 `isOurSite` 를 통과한 행만 형제로 세는데,
 *    스냅샷이 그 범위를 안 보면 **남의 원문까지 막는다** — 적재는 그 행을 형제로 세지도
 *    않으므로 그 원문은 **영영 만들어지지 않는다.**
 */
export type SnapshotQueueRow = {
  sourceArticleId: string
  sourceSite: string
  createdPostId: string | null
}

/**
 * 🔴 **미발행 형제가 있는 원문 집합.**
 *
 *    범위(`isOurSite`)와 미발행 조건(`isPendingRow`)을 **적재와 같은 정본 함수**로 판단한다.
 *    조건을 여기서 다시 쓰지 않는다 — 앞선 판이 미발행 조건을 손으로 복제했고,
 *    그러면 한쪽만 고쳐질 때 두 판정이 갈린다.
 *
 * 🔴 발행이 끝난 행은 넣지 않는다 — 형제가 이미 나갔으면 새 초안을 넣어도 된다는
 *    기존 계약 그대로다.
 */
export function pendingSourceIdsOf(rows: readonly SnapshotQueueRow[]): Set<string> {
  const out = new Set<string>()
  for (const r of rows) {
    const id = typeof r.sourceArticleId === 'string' ? r.sourceArticleId : ''
    if (id === '') continue
    // 🔴 적재와 같은 범위 — 우리가 만든 synthetic 행만 형제다
    if (!isOurSite(typeof r.sourceSite === 'string' ? r.sourceSite : '')) continue
    // 🔴 적재와 같은 미발행 조건 — 정본 함수를 그대로 부른다
    if (!isPendingRow(r)) continue
    out.add(baseArticleId(id))
  }
  return out
}

export function buildQueueSnapshot(input: {
  runId: string
  takenAt: Date
  rows: readonly SnapshotQueueRow[]
}): QueueSnapshot {
  return {
    kind: QUEUE_SNAPSHOT_KIND,
    version: QUEUE_SNAPSHOT_VERSION,
    runId: input.runId,
    takenAt: input.takenAt.toISOString(),
    // 🔴 정렬한다 — 같은 입력이면 같은 파일이어야 사람이 대조할 수 있다
    pendingSourceIds: [...pendingSourceIdsOf(input.rows)].sort(),
  }
}

/**
 * 🔴 읽지 못하는 이유를 **한 덩어리로 뭉개지 않는다.** 다음에 할 일이 다르다.
 *
 *    `MISSING`      러너가 안 만들었거나 지워졌다
 *    `PARSE`        JSON 이 아니다
 *    `KIND`·`VERSION` 다른 파일이거나 옛 판이다
 *    `RUN_MISMATCH` **다른 회차 파일**이다 — 가장 위험하다. 없는 세상을 근거로 거를 뻔했다
 *    `STALE`        너무 오래됐다
 *    `SHAPE`        모양이 계약과 다르다
 */
export type SnapshotFailCode =
  | 'MISSING' | 'PARSE' | 'KIND' | 'VERSION' | 'RUN_MISMATCH' | 'STALE' | 'SHAPE'

export type SnapshotRead =
  | { ok: true; pendingSourceIds: ReadonlySet<string>; ageMs: number }
  | { ok: false; code: SnapshotFailCode; reason: string }

/**
 * 🔴 **fail-closed.** 하나라도 어긋나면 `ok: false` 다.
 *
 *    "못 읽었으니 그냥 다 만든다" 로 두면, 걸렀다고 적어 놓고 실제로는 안 걸러진다 —
 *    그러면 이 배선이 **있으나 마나**가 되고 아무도 그것을 모른다.
 *    부르는 쪽이 이 결과를 받아 **유료 단계를 보류**한다.
 */
export function readQueueSnapshot(input: {
  /** 파일 내용. 🔴 없으면 `null` — 부르는 쪽이 파일을 읽는다 */
  raw: string | null
  /** 이번 회차 id */
  runId: string
  now: Date
  ttlMs?: number
}): SnapshotRead {
  if (input.raw === null) {
    return { ok: false, code: 'MISSING', reason: '큐 스냅샷 파일이 없다' }
  }
  let j: unknown
  try {
    j = JSON.parse(input.raw)
  } catch {
    return { ok: false, code: 'PARSE', reason: '큐 스냅샷이 JSON 이 아니다' }
  }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) {
    return { ok: false, code: 'SHAPE', reason: '큐 스냅샷이 객체가 아니다' }
  }
  const o = j as Record<string, unknown>
  if (o.kind !== QUEUE_SNAPSHOT_KIND) {
    return { ok: false, code: 'KIND', reason: `다른 파일이다 (kind=${String(o.kind ?? '없음')})` }
  }
  if (o.version !== QUEUE_SNAPSHOT_VERSION) {
    return {
      ok: false, code: 'VERSION',
      reason: `옛 판이다 (version=${String(o.version ?? '없음')} · 기대 ${QUEUE_SNAPSHOT_VERSION})`,
    }
  }
  if (typeof o.runId !== 'string' || o.runId !== input.runId) {
    return {
      ok: false, code: 'RUN_MISMATCH',
      reason: `다른 회차 파일이다 (파일=${String(o.runId ?? '없음')} · 이번=${input.runId})`,
    }
  }
  if (typeof o.takenAt !== 'string') {
    return { ok: false, code: 'SHAPE', reason: 'takenAt 이 없다' }
  }
  const t = new Date(o.takenAt).getTime()
  if (!Number.isFinite(t)) {
    return { ok: false, code: 'SHAPE', reason: `takenAt 을 읽을 수 없다 (${o.takenAt})` }
  }
  const ageMs = input.now.getTime() - t
  const ttl = input.ttlMs ?? QUEUE_SNAPSHOT_TTL_MS
  // 🔴 미래 시각도 거절한다 — 시계가 어긋난 채로 거르면 무엇을 걸렀는지 설명할 수 없다
  if (ageMs < 0 || ageMs > ttl) {
    return {
      ok: false, code: 'STALE',
      reason: `스냅샷이 ${Math.round(ageMs / 60000)}분 됐다 (허용 ${Math.round(ttl / 60000)}분)`,
    }
  }
  const ids = o.pendingSourceIds
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
    return { ok: false, code: 'SHAPE', reason: 'pendingSourceIds 가 문자열 배열이 아니다' }
  }
  return {
    ok: true,
    pendingSourceIds: new Set((ids as string[]).map((x) => x.trim()).filter((x) => x !== '')),
    ageMs,
  }
}

/** 생성 전 제외 판정 — 🔴 **넣을 것과 뺀 것을 둘 다 돌려준다.** 조용히 줄이지 않는다 */
export type PreDraftPlan = {
  keep: string[]
  /** 🔴 미발행 형제가 있어 지금 만들어도 적재되지 않는 원문 */
  excluded: string[]
}

/**
 * 🔴 **원문 id 로만 판단한다.** 제목도 본문도 보지 않는다 —
 *    생성 전에는 아직 없고, 없는 것으로 판단하면 그것은 추측이다.
 */
export function planPreDraftExclusion(input: {
  sourceArticleIds: readonly string[]
  pendingSourceIds: ReadonlySet<string>
}): PreDraftPlan {
  const keep: string[] = []
  const excluded: string[] = []
  for (const raw of input.sourceArticleIds) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (id === '') continue
    // 🔴 seed 의 id 는 원문 id 그대로다. 그래도 한 번 정규화해 둔다 —
    //    호출부가 synthetic id 를 넘겨도 같은 규칙으로 읽힌다
    if (input.pendingSourceIds.has(baseArticleId(id)) || input.pendingSourceIds.has(id)) {
      excluded.push(id)
    } else {
      keep.push(id)
    }
  }
  return { keep, excluded }
}
