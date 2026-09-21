/**
 * READY 재고 **스냅샷 장부** — 🔴 append-only. DB 를 쓰지 않는다
 *
 * 🔴 **생산량은 순증가가 아니다** (2026-09-21 3차 보정).
 *
 *    앞판은 "14일 안에 승인된 행 수 ÷ 14" 를 `readyNetPerDay` 라고 불렀다.
 *    그것은 **생산량**이다 — 같은 기간에 발행되거나 신선도가 지나 빠진 몫을 빼지 않았다.
 *    순증가는 정의상 **두 시점의 재고 차이**이고, 그러려면 과거 시점의 재고를 알아야 한다.
 *
 * 🔴 **과거 값을 지어내지 않는다.** 스냅샷이 없으면 `unmeasured` 다 —
 *    "아마 이랬을 것" 으로 채우면 그 숫자가 승격 근거가 된다.
 *
 * 🔴 worktree 밖에 둔다 — 배포가 트리를 갈아 끼워도 시계열이 사라지면 안 된다.
 *    (수집 회차 기록과 같은 자리·같은 원칙)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SNAPSHOT_PATH = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'd100-ready-stock.jsonl',
)

export type ReadyStockSnapshot = {
  /** ISO — 잰 시각 */
  at: string
  /** 그 시각의 재고 (정본 selector 기준) */
  readyStock: number
  /** 🔴 어느 판정 규칙으로 쟀는가. 규칙이 바뀌면 이전 값과 견주지 않는다 */
  selectorVersion: string
}

/**
 * 🔴 **selector 가 바뀌면 시계열이 끊긴다.** 규칙이 달라진 두 시점의 차이는
 *    재고 변화가 아니라 **정의 변화**다. 그것을 순증가라고 부르면 안 된다.
 */
export const READY_SELECTOR_VERSION = 'stock-funnel-v1'

export function readSnapshots(path = SNAPSHOT_PATH): ReadyStockSnapshot[] {
  if (!existsSync(path)) return []
  const out: ReadyStockSnapshot[] = []
  try {
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      if (line.trim() === '') continue
      const j = JSON.parse(line) as Partial<ReadyStockSnapshot>
      if (typeof j.at !== 'string' || typeof j.readyStock !== 'number') continue
      if (typeof j.selectorVersion !== 'string') continue
      out.push({ at: j.at, readyStock: j.readyStock, selectorVersion: j.selectorVersion })
    }
  } catch { return [] }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

/** 🔴 **지금 값만 적는다.** 과거 시각으로 쓰는 길을 만들지 않는다 */
export function appendSnapshot(readyStock: number, now: Date, path = SNAPSHOT_PATH): boolean {
  try {
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
    const rec: ReadyStockSnapshot = {
      at: now.toISOString(), readyStock, selectorVersion: READY_SELECTOR_VERSION,
    }
    appendFileSync(path, `${JSON.stringify(rec)}\n`, { encoding: 'utf-8', mode: 0o600 })
    return true
  } catch { return false }
}

export type NetChange =
  | {
      measured: true
      perDay: number
      fromAt: string
      toAt: string
      spanDays: number
      fromStock: number
      toStock: number
    }
  | { measured: false; reason: string }

/** 🔴 두 시점이 이만큼은 떨어져 있어야 하루치를 말할 수 있다 */
export const MIN_SNAPSHOT_SPAN_DAYS = 1

/**
 * 🔴 **두 시점의 같은 selector 재고 차이 ÷ 지난 날.** 그 외의 계산은 순증가가 아니다.
 *
 *    · 스냅샷이 하나뿐이거나 없으면 → `unmeasured`
 *    · selector 판이 다르면 → `unmeasured` (정의가 달라 비교가 성립하지 않는다)
 *    · 간격이 하루 미만이면 → `unmeasured` (하루치를 말할 수 없다)
 */
export function readyNetFromSnapshots(input: {
  snapshots: readonly ReadyStockSnapshot[]
  /** 지금 잰 재고 — 재지 못했으면 `null` */
  nowStock: number | null
  now: Date
}): NetChange {
  if (input.nowStock === null) return { measured: false, reason: '지금 재고를 읽지 못했다' }
  const same = input.snapshots.filter((s) => s.selectorVersion === READY_SELECTOR_VERSION)
  if (same.length === 0) {
    /**
     * 🔴 **"하나도 없다" 와 "판이 달라 못 쓴다" 는 다른 사실이다.**
     *    뒤엣것은 시계열이 있었는데 판정 규칙이 바뀌어 끊긴 것이라, 사람이 할 일이 다르다.
     */
    const other = input.snapshots.length > 0
    return {
      measured: false,
      reason: other
        ? `과거 스냅샷이 다른 판(selector 버전 ${[...new Set(input.snapshots.map((s) => s.selectorVersion))].join('·')})`
          + `으로 잰 것이다 — 지금 판 ${READY_SELECTOR_VERSION} 과 견줄 수 없다`
        : `과거 재고 스냅샷이 없다 (${READY_SELECTOR_VERSION})`
          + ' — 🔴 생산량으로 대신하지 않는다',
    }
  }
  const first = same[0]!
  const fromMs = Date.parse(first.at)
  if (!Number.isFinite(fromMs)) return { measured: false, reason: '스냅샷 시각을 읽을 수 없다' }
  const spanDays = (input.now.getTime() - fromMs) / 86_400_000
  if (spanDays < MIN_SNAPSHOT_SPAN_DAYS) {
    return {
      measured: false,
      reason: `가장 오래된 스냅샷이 ${spanDays.toFixed(2)}일 전이다`
        + ` — ${MIN_SNAPSHOT_SPAN_DAYS}일은 지나야 하루치를 말할 수 있다`,
    }
  }
  return {
    measured: true,
    perDay: Math.round(((input.nowStock - first.readyStock) / spanDays) * 10) / 10,
    fromAt: first.at, toAt: input.now.toISOString(),
    spanDays: Math.round(spanDays * 10) / 10,
    fromStock: first.readyStock, toStock: input.nowStock,
  }
}
