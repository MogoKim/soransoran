/**
 * 하루 13바퀴 — 🔴 **유일한 시간표. 순수 함수 · 네트워크·DB·파일 0** (2026-11-19 창업자 결정)
 *
 * 왜 이 파일이 있는가:
 *   커뮤니티 글에는 시간대의 감성이 있다. 새벽 글은 새벽에, 아침 글은 아침에 나가야 한다.
 *   2026-11-19 이전에는 수집 · 글 만들기 · 공개 · 댓글이 각자 시간표를 갖고 따로 돌았고,
 *   수집 10회 중 6회가 06:15 전이어서 한밤중 글("잠이 안 와서…")이 아침 08:00 에 나갔다.
 *
 *   그래서 **바퀴 시각 하나**가 뒤의 단계를 전부 끌고 간다.
 *   수집 job · 공급(글 만들기) job 과 그 정기 회차 창 · 예산 배분 · 공개 몫이 이 표에서 계산된다.
 *   시각을 바꿀 때 고칠 곳은 이 표 하나다 — 다른 파일에 시각을 다시 적지 않는다.
 *
 * 🔴 `weight` 는 하루 30편을 시간대에 나눈 창업자 결정값이다(새벽 3 · 아침 8 · 점심 6 · 오후 7 · 저녁 6).
 *    다른 하루 목표는 이 비율로 나눈다(`cycleQuotas`). 실제 카페도 새벽에는 글이 아주 적다.
 *    D20 이상의 공개 자리(`cycleSlots`)도 이 몫을 그 바퀴의 공개 창에 편 것이다 — 새벽 글은 새벽에 나간다.
 *
 * 🔴 import 0 이다 — `scale-profile`(러너 프로필)이 모듈을 읽는 순간 자리를 계산하므로, 이 파일이 무엇을 import 하면 순환이 된다.
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

/**
 * 공급(글 만들기) 회차는 **바퀴마다 한 번, 수집이 시작되고 이만큼 뒤에** 뜬다.
 *
 * 막는 사고: 공급이 수집보다 먼저(또는 같은 분에) 뜨면 그 바퀴의 글이 아직 파일에 없어 다음 회차까지
 *   몇 시간을 기다린다(옛 08:15 공급은 08:20 수집보다 5분 먼저 떴다).
 * 값의 근거: 두 카페를 차례로 도는 수집 한 바퀴의 예상 소요가 7~10분이다. 수집이 이보다 늦게 끝난 바퀴의 글은
 *   잃지 않는다 — 수집기는 결과 파일을 한 번에 내놓고(원자적 rename), 못 본 파일은 다음 공급 회차가 받는다.
 * 🔴 공급 job 시각 · 정기 회차 창 · 예산 배분 · 비용 증거가 전부 이 값과 `CYCLES` 에서 계산된다.
 */
export const SUPPLY_AFTER_COLLECT_MINUTES = 15

/** 공급 회차가 뜨는 분(KST 자정 기준) — 바퀴 순서 그대로 */
export const SUPPLY_CYCLE_MINUTES: readonly number[] = Object.freeze(CYCLES.map((c) => c.minute + SUPPLY_AFTER_COLLECT_MINUTES))

/**
 * 🔴 **발행 heartbeat 간격(분)** — 발행 러너가 깨는 10분 격자. 공개 자리 · 발행 창 끝 · 공급 수요 지평이 이 한 값을 쓴다.
 *    공급이 다른 간격을 가정하면 만들 수 없는 시각의 글을 준비하거나, 실제로 남은 기회를 놓친다.
 *    (`publish-slot-catchup` 이 그대로 다시 내보낸다 — 정의는 여기 하나다)
 */
export const HEARTBEAT_INTERVAL_MINUTES = 10

/**
 * 🔴 **그날 단계 결정의 기준 시각**(KST 자정에서 센 분) — controller 는 이 분부터 다섯 번 깬다(`ops-loop-templates`).
 *    공개는 자정에도 이어지고(그날 결정 전 회차는 전날 결정이 지킨 단계로) 올리는 판정은 전날이 닫힌 뒤 한다.
 *    01:50 인 이유 — 바퀴 표 · 감사 회차가 바뀌면 이 값부터 다시 본다(검사가 관계를 잰다):
 *      ① 전날 마지막 바퀴(22:20)의 공개 창이 닫힌 뒤다(01:30) — 자정을 넘는 전날 몫이 다 나갔다
 *      ② 결정 전에 나간 새벽 자리의 감사가 한 번 다시 돌 시간이 지났다(00:50 글 → 감사 01:10 · 재시도 01:40 + 한 틱).
 *         재시도 가능 감사 실패 한 건은 품질 신호를 나쁨으로 만든다 — 제공사 일시 오류 한 번이 그날 단계를 굳히지 않는다
 *      ③ 첫 바퀴(01:00) 공급 회차의 유료 창이 끝난 뒤에도 미룰 수 있는 예약이 남는다(최종 판정 = 기준 + 55분)
 */
export const STAGE_DECISION_BASE_MINUTE = at(1, 50)

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
 * 하루 목표를 바퀴에 나눈다 — 최대 나머지 방식(합이 정확히 `dailyTarget`). 모든 바퀴가 공개에 참여한다(하루 전체 창).
 * 🔴 `dailyTarget` 이 0 · 음수 · 정수가 아니면 전부 0 을 돌려준다(몫을 지어내지 않는다).
 */
export function cycleQuotas(dailyTarget: number): number[] {
  const zero = CYCLES.map(() => 0)
  if (!Number.isInteger(dailyTarget) || dailyTarget <= 0) return zero
  const total = CYCLES.reduce((s, c) => s + c.weight, 0)
  if (total <= 0) return zero
  const exact = CYCLES.map((c) => (dailyTarget * c.weight) / total)
  const out = exact.map((x) => Math.floor(x))
  let left = dailyTarget - out.reduce((s, n) => s + n, 0)
  // 🔴 동률은 앞 바퀴가 먼저다 — 실행마다 같은 답
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) { if (left <= 0) break; out[i] = (out[i] ?? 0) + 1; left -= 1 }
  return out
}

/**
 * 순번 `i` 바퀴의 **공개 창** `[start, end)`(KST 자정에서 센 분) — 그 바퀴 공급 회차가 뜬 뒤 첫 heartbeat 틱부터
 * 다음 바퀴의 창 시작 전까지. 시작 = (공급 + 한 틱)을 격자 위로 올린 분 — 새 숫자 없이 바퀴 표 · 공급 지연 · 격자에서 나온다.
 * 마지막 바퀴(22:20)의 끝은 다음 날 첫 바퀴의 시작이다(1440 이상).
 */
export function cyclePublishWindow(i: number): { start: number; end: number } | null {
  if (CYCLES[i] === undefined) return null
  const startOf = (j: number): number =>
    Math.ceil((CYCLES[j]!.minute + SUPPLY_AFTER_COLLECT_MINUTES + HEARTBEAT_INTERVAL_MINUTES) / HEARTBEAT_INTERVAL_MINUTES)
    * HEARTBEAT_INTERVAL_MINUTES
  return { start: startOf(i), end: i + 1 < CYCLES.length ? startOf(i + 1) : startOf(0) + DAY_MINUTES }
}

export type CycleSlots =
  | { ok: true; minutes: readonly number[] }
  | { ok: false; problems: readonly string[] }

/**
 * 🔴 **하루 공개 자리 — 바퀴 몫을 그 바퀴의 공개 창에 편다** (2026-11-23 · 11-19 승인 묶음 C)
 *
 *    바퀴 i 의 몫 q = `cycleQuotas(n)[i]` · 창의 틱 수 T · k 번째 자리 = 창 시작 + 틱 × floor((2k+1)·T ÷ 2q)
 *    — 몫을 창 안에 고르게 둔다. 정수 나눗셈이라 실행마다 같은 분이다(부동소수 x.999… 로 한 틱 당겨지지 않는다).
 *    1440 이상인 자리는 1440 을 빼 그 달력일 앞자리로 감는다 — 00:xx 자리는 전날 22:20 바퀴 몫이고,
 *    매일 같은 꼴이라 하루 합은 정확히 n 이다(하루 상한 · catch-up 은 달력일 그대로).
 *    한 틱에는 한 건이다 — 몫이 틱 수보다 큰 바퀴가 있으면 담을 수 없다(`ok: false` · d100 이 여기서 막힌다).
 *    🔴 결과는 분 오름차순이다 — 첫 슬롯 문구와 검사 대조가 이 순서를 쓴다.
 */
export function cycleSlots(dailyTarget: number): CycleSlots {
  if (!Number.isInteger(dailyTarget) || dailyTarget < 1) return { ok: false, problems: [`목표 ${dailyTarget} — 1 이상 정수여야 한다`] }
  const quotas = cycleQuotas(dailyTarget)
  const minutes: number[] = []
  const problems: string[] = []
  for (let i = 0; i < CYCLES.length; i += 1) {
    const w = cyclePublishWindow(i)!
    const ticks = (w.end - w.start) / HEARTBEAT_INTERVAL_MINUTES
    const q = quotas[i] ?? 0
    if (q > ticks) {
      problems.push(`${cycleLabel(CYCLES[i]!.minute)} 바퀴 몫 ${q}편 > 공개 창 ${cycleLabel(w.start)}~${cycleLabel(w.end % DAY_MINUTES)}`
        + ` 의 ${ticks}틱 — 한 틱 한 건으로 담을 수 없다`)
      continue
    }
    for (let k = 0; k < q; k += 1) {
      const m = w.start + HEARTBEAT_INTERVAL_MINUTES * Math.floor(((2 * k + 1) * ticks) / (2 * q))
      minutes.push(m >= DAY_MINUTES ? m - DAY_MINUTES : m)
    }
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, minutes: minutes.sort((a, b) => a - b) }
}
