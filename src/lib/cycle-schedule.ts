/**
 * 하루 13바퀴 — 🔴 **유일한 시간표. 순수 함수 · 네트워크·DB·파일 0** (2026-11-19 창업자 결정)
 *
 * 왜 이 파일이 있는가:
 *   커뮤니티 글에는 시간대의 감성이 있다. 새벽 글은 새벽에, 아침 글은 아침에 나가야 한다.
 *   2026-11-19 이전에는 수집 · 글 만들기 · 공개 · 댓글이 각자 시간표를 갖고 따로 돌았고,
 *   수집 10회 중 6회가 06:15 전이어서 한밤중 글("잠이 안 와서…")이 아침 08:00 에 나갔다.
 *
 *   그래서 **바퀴 시각 하나**가 뒤의 단계를 전부 끌고 간다.
 *   수집 job · 글 만들기 창 · 비용 증거의 정상 회차 · 공개 몫이 이 표에서 계산된다.
 *   시각을 바꿀 때 고칠 곳은 이 표 하나다 — 다른 파일에 시각을 다시 적지 않는다.
 *
 * 🔴 `weight` 는 하루 30편을 시간대에 나눈 창업자 결정값이다(새벽 3 · 아침 8 · 점심 6 · 오후 7 · 저녁 6).
 *    다른 하루 목표는 이 비율로 나눈다(`cycleQuotas`). 실제 카페도 새벽에는 글이 아주 적다.
 */

export type CycleBand = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening'

export type Cycle = {
  /** KST 자정에서 센 분 — 이 시각에 수집이 시작된다 */
  readonly minute: number
  readonly band: CycleBand
  /** 하루 30편일 때 이 바퀴의 공개 몫 */
  readonly weight: number
}

const at = (h: number, m: number): number => h * 60 + m

export const CYCLES: readonly Cycle[] = Object.freeze([
  { minute: at(1, 0), band: 'dawn', weight: 2 },
  { minute: at(4, 0), band: 'dawn', weight: 1 },
  { minute: at(6, 30), band: 'morning', weight: 2 },
  { minute: at(8, 20), band: 'morning', weight: 3 },
  { minute: at(10, 0), band: 'morning', weight: 3 },
  { minute: at(11, 20), band: 'noon', weight: 3 },
  { minute: at(12, 20), band: 'noon', weight: 3 },
  { minute: at(13, 20), band: 'afternoon', weight: 2 },
  { minute: at(15, 20), band: 'afternoon', weight: 3 },
  { minute: at(17, 20), band: 'afternoon', weight: 2 },
  { minute: at(18, 20), band: 'evening', weight: 2 },
  { minute: at(20, 20), band: 'evening', weight: 2 },
  { minute: at(22, 20), band: 'evening', weight: 2 },
] as const)

export const CYCLE_MINUTES: readonly number[] = Object.freeze(CYCLES.map((c) => c.minute))

const DAY_MINUTES = 24 * 60

/** `HH:MM` — 로그 · launchd 템플릿 · 문서가 같은 표기를 쓴다 */
export function cycleLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

/**
 * 그 분에 **진행 중인 바퀴**의 순번(0~12). 01:00 전(00:00~00:59)은 전날 22:20 바퀴(12)다.
 * 🔴 범위 밖 · 정수가 아닌 입력은 `null` — 가까운 바퀴로 추정하지 않는다.
 */
export function cycleIndexAt(minuteOfDay: number): number | null {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= DAY_MINUTES) return null
  let idx = CYCLES.length - 1
  for (let i = 0; i < CYCLES.length; i += 1) if (CYCLES[i]!.minute <= minuteOfDay) idx = i
  return minuteOfDay < CYCLES[0]!.minute ? CYCLES.length - 1 : idx
}

/** 순번 `i` 바퀴의 길이(분) — 다음 바퀴 시작까지. 마지막 바퀴는 자정을 넘어 첫 바퀴까지다 */
export function cycleLengthMinutes(i: number): number | null {
  const cur = CYCLES[i]
  if (cur === undefined) return null
  const next = CYCLES[(i + 1) % CYCLES.length]!
  return (next.minute - cur.minute + DAY_MINUTES) % DAY_MINUTES
}

/**
 * 하루 목표를 바퀴에 나눈다 — 최대 나머지 방식(합이 정확히 `dailyTarget`).
 *
 * `active` 는 **지금 공개에 참여하는 바퀴**다. 1단계(공개 08~22시)에서는 새벽 바퀴와 22:20 바퀴가
 * 빠지고, 그 몫은 나머지 바퀴에 `weight` 비율로 돌아간다. 빠진 바퀴의 몫은 0 이다.
 * 🔴 `dailyTarget` 이 음수 · 정수가 아님 · 참여 바퀴 0 이면 전부 0 을 돌려준다(몫을 지어내지 않는다).
 */
export function cycleQuotas(dailyTarget: number, active: (c: Cycle, i: number) => boolean = () => true): number[] {
  const zero = CYCLES.map(() => 0)
  if (!Number.isInteger(dailyTarget) || dailyTarget <= 0) return zero
  const on = CYCLES.map((c, i) => active(c, i))
  const total = CYCLES.reduce((s, c, i) => s + (on[i] ? c.weight : 0), 0)
  if (total <= 0) return zero
  const exact = CYCLES.map((c, i) => (on[i] ? (dailyTarget * c.weight) / total : 0))
  const out = exact.map((x) => Math.floor(x))
  let left = dailyTarget - out.reduce((s, n) => s + n, 0)
  // 🔴 동률은 앞 바퀴가 먼저다 — 실행마다 같은 답
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).filter((x) => on[x.i]).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) { if (left <= 0) break; out[i] = (out[i] ?? 0) + 1; left -= 1 }
  return out
}
