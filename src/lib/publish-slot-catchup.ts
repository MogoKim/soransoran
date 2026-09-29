/**
 * 발행 슬롯 **catch-up 판정** — 🔴 순수 함수. DB · 네트워크 · 파일 · 시계 없음
 *
 * 🔴 **왜 필요한가** (2026-09-14 실측).
 *
 *    옛 판정(`judgeSlotRun`)은 이렇게 물었다 — **"이 run 을 띄운 cron 이 내 단계의 슬롯인가."**
 *    그 질문은 GitHub 이 **예약을 배달해 준다**는 전제 위에 서 있었다. 전제가 깨졌다.
 *
 *      · 2026-09-13  예약 10건이 전부 도착했지만 **108~331분 늦게** 왔다
 *      · 2026-09-14  `30 0 * * *`(09:30 KST · d1 의 **유일한** 슬롯)이 **배달되지 않았다**.
 *                    다른 예약(08:10)은 도착했지만 "내 슬롯이 아니다" 로 쉬었고,
 *                    재고 · 배정 · cap · kill switch 가 전부 준비된 채 **그날 0편**이 됐다.
 *
 *    옛 질문에는 답할 수 없는 상황이다. **"내 슬롯 하나가 안 왔다"** 는 사실을
 *    그 질문은 영원히 모른다 — 물어볼 run 자체가 없기 때문이다.
 *
 * 🔴 **그래서 질문을 바꾼다.**
 *
 *      옛: "이 run 은 내 슬롯인가?"          → 슬롯 하나가 유실되면 그날이 통째로 비어 있다
 *      새: "지금까지 **도래한** 내 슬롯 중,   → 어느 run 이 오든 밀린 것을 대신 낸다
 *           아직 안 나간 것이 있는가?"
 *
 *    이것이 catch-up 이다. **예약을 더 늘려 문제를 덮지 않는다** — 예약 수는 그대로 두고,
 *    이미 오는 run 들이 서로의 실패를 메우게 한다.
 *
 * 🔴 **중복 발행을 무엇이 막는가 — 두 겹이다.**
 *
 *      ① 여기: `backlog = 도래한 슬롯 수 − 오늘 발행 수`. 오늘 낸 만큼이 이미 빠져 있으므로
 *         같은 슬롯으로 두 번 불려도, 어제 예약이 오늘 늦게 도착해도 **두 번째는 0** 이다.
 *      ② 트랜잭션: `publishOriginalPostTx` 가 Serializable 안에서 오늘 발행 수를 **다시 센다.**
 *         ①은 그 순간의 사진이라, 두 run 이 같은 사진을 보는 경쟁은 ②가 막는다.
 *
 *    한 겹만으로는 부족하다. ①만 있으면 동시 실행에 뚫리고, ②만 있으면 밀린 슬롯을 모른다.
 *
 * 🔴 **단계 정체성은 그대로다.** due 는 `profileOf(stage).slots`(러너 프로필 · d1~d10 은 `PROFILES` 그대로)에서만 나온다 —
 *    d1 은 09:30 하나, d3 는 09:30·13:30·19:00. d1 이 d3 의 슬롯을 대신 내는 일은 없다.
 *
 * 🔴 **앞당겨 내지 않는다.** 도래하지 않은 슬롯은 due 가 아니다.
 *    08:10 에 불려도 d1 의 backlog 는 0 이다 — 09:30 전에는 낼 것이 없다.
 */

import {
  minuteOfDay, slotLabel, profileOf, kstMidnight,
  type RuntimeStage,
} from './scale-profile'
import { slotOfCron } from './scale-workflow-render'

/**
 * 🔴 **당일 운영 창.** 밀린 슬롯을 아무 때나 메우지 않는다 —
 *    22시가 넘어 올린 글은 첫 댓글까지 밤을 넘기고(§9.5-g), 아침에 처음 온 사람은
 *    "댓글 하나 없는 어젯밤 글" 을 본다. 그 글은 **없는 것보다 나쁘다.**
 *
 *    창 밖의 backlog 는 버린다. 다음 날 첫 슬롯부터 다시 센다.
 */
export const PUBLISH_WINDOW_START_MINUTE = 8 * 60
export const PUBLISH_WINDOW_END_MINUTE = 22 * 60

/**
 * 🔴 **한 회차가 낼 수 있는 최대 건수.**
 *
 *    backlog 가 3이어도 한 번에 3건을 쏟지 않는다. 같은 분에 세 편이 올라오면
 *    타임라인이 사람의 것으로 보이지 않는다 — 그것이 막으려는 바로 그 일이다.
 *    밀린 것은 **다음 run 이 이어서** 낸다. 예약은 하루 10번 오므로 창 안에서 따라잡는다.
 */
export const PER_RUN_MAX = 1

/**
 * 🔴 **누가 이 회차를 불렀는가.**
 *
 *    · `schedule` — GitHub Actions 예약. **늦게 온다**(실측 108~331분). cron 문자열이 있어야 한다
 *    · `local`    — launchd 등 정시 트리거. 예약 문자열이 없고, **시각 자체가 근거**다
 *    · `manual`   — 사람이 손으로 불렀다. 🔴 **발행하지 않는다.** 연결 확인용이다
 *
 *    🔴 모르는 값은 `manual` 과 같다 — 모를 때 내보내지 않는다(fail-closed).
 */
export type TriggerKind = 'schedule' | 'local' | 'manual'

export type DueSlot = { kst: string; minuteOfDay: number; count: number }

export type CatchUpVerdict = {
  /** 🔴 이 회차가 발행해도 되는가 */
  run: boolean
  /** 몇 건까지. `run` 이 false 면 0 */
  allowed: number
  /** 이 run 을 띄운 예약의 KST 표기 — 읽을 수 없으면 null */
  slotKst: string | null
  /** 그 예약이 **내 단계의** 슬롯인가 (정체성 보존 · 로그용) */
  ownSlot: boolean
  /** 🔴 자기 슬롯이 아닌데 밀린 것을 대신 내는가 */
  catchUp: boolean
  /** 지금까지 도래한 내 단계 슬롯이 담당하는 누적 건수 */
  dueCount: number
  /** 오늘(KST) 이미 발행한 수 */
  publishedToday: number
  /** 🔴 아직 안 나간 건수 = dueCount − publishedToday (음수는 0) */
  backlog: number
  /** 도래한 슬롯 목록 */
  due: readonly DueSlot[]
  reason: string
}

/** 🔴 DB count 가 될 수 있는 값인가 — NaN · Infinity · 음수 · 소수 · 비-number 를 전부 막는다 */
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0

/** KST 기준 하루 중 분 (0~1439). 🔴 하루 경계는 러너의 `kstDayStart` 와 같다 */
export function kstMinuteOfDay(now: Date): number {
  return Math.floor((now.getTime() - kstMidnight(now).getTime()) / 60_000)
}

/**
 * 🔴 그 단계에서 **지금까지 도래한** 슬롯들.
 *    `minuteOfDay <= nowMinute` 인 것만이다 — 앞당겨 내지 않는다.
 */
export function dueSlotsAt(stage: RuntimeStage, nowMinute: number): DueSlot[] {
  if (!Number.isInteger(nowMinute)) return []
  return [...profileOf(stage).slots]
    .sort((a, b) => minuteOfDay(a) - minuteOfDay(b))
    .filter((s) => minuteOfDay(s) <= nowMinute)
    .map((s) => ({ kst: slotLabel(s), minuteOfDay: minuteOfDay(s), count: s.count }))
}

/** 도래한 슬롯이 담당하는 누적 건수 */
export function dueCountAt(stage: RuntimeStage, nowMinute: number): number {
  return dueSlotsAt(stage, nowMinute).reduce((n, s) => n + s.count, 0)
}

/**
 * 🔴 **이 회차가 발행해도 되는가 — 그리고 몇 건인가.**
 *
 *    하나라도 어긋나면 `run: false · allowed: 0` 이다. 애매한 중간을 두지 않는다.
 */
export function judgeCatchUp(input: {
  stage: RuntimeStage
  /** 실행 시각 */
  now: Date
  /** 누가 불렀는가 */
  trigger: TriggerKind
  /** `github.event.schedule` 그대로. `schedule` 트리거에서는 **필수**다 */
  cron: string | null
  /** 오늘(KST) 이미 발행한 수 — DB 실측. 🔴 못 셌으면 넘기지 말고 그대로 둔다 */
  publishedToday: number | null | undefined
  /** 한 회차 상한 — 생략하면 `PER_RUN_MAX` */
  perRunMax?: number
}): CatchUpVerdict {
  const blocked = (reason: string, extra?: Partial<CatchUpVerdict>): CatchUpVerdict => ({
    run: false, allowed: 0, slotKst: null, ownSlot: false, catchUp: false,
    dueCount: 0, publishedToday: isCount(input.publishedToday) ? input.publishedToday : 0,
    backlog: 0, due: [], reason, ...extra,
  })

  const t = input.now
  if (!(t instanceof Date) || !Number.isFinite(t.getTime())) {
    return blocked('실행 시각을 읽지 못했다 — 어느 슬롯이 도래했는지 셀 수 없다(fail-closed)')
  }
  if (!isCount(input.publishedToday)) {
    return blocked('오늘 발행 수를 세지 못했다(누락 · NaN · 음수 · 소수) — 발행하지 않는다(fail-closed)')
  }
  const publishedToday = input.publishedToday

  /**
   * 🔴 **손으로 부른 회차는 발행하지 않는다.** 모르는 트리거도 같다 —
   *    "누가 불렀는지 모르겠으니 일단 낸다" 는 경로를 두지 않는다.
   */
  if (input.trigger !== 'schedule' && input.trigger !== 'local') {
    return blocked(`트리거가 ${input.trigger === 'manual' ? '수동' : '알 수 없음'}이다 — 발행하지 않는다(연결 확인용)`, { publishedToday })
  }

  /**
   * 🔴 **예약이 부른 회차는 예약 문자열이 있어야 한다.**
   *    옛 계약 그대로다 — 이 값이 없으면 `workflow_dispatch` 가 발행 경로로 새어 든다.
   *    catch-up 은 "언제 낼까" 를 넓히는 것이지 "누가 불러도 된다" 가 아니다.
   */
  let slotKst: string | null = null
  let ownSlot = false
  if (input.trigger === 'schedule') {
    const raw = (input.cron ?? '').trim()
    if (raw === '') {
      return blocked('예약 cron 을 받지 못했다 — 어느 회차인지 모르면 내보내지 않는다', { publishedToday })
    }
    const slot = slotOfCron(raw)
    if (slot === null) {
      return blocked(`예약 cron "${raw}" 를 슬롯으로 읽을 수 없다`, { publishedToday })
    }
    slotKst = slotLabel(slot)
    ownSlot = profileOf(input.stage).slots.some((s) => minuteOfDay(s) === minuteOfDay(slot))
  }

  const nowMinute = kstMinuteOfDay(t)
  /**
   * 🔴 **창을 넘긴 backlog 는 버린다.** 늦게라도 내는 것이 늘 나은 것이 아니다 —
   *    22시 넘어 올린 글은 첫 댓글을 밤새 기다리고, 아침의 첫인상이 그 글이 된다.
   */
  if (nowMinute > PUBLISH_WINDOW_END_MINUTE) {
    return blocked(
      `운영 창(${slotLabel({ hour: 8, minute: 0 })}~${slotLabel({ hour: 22, minute: 0 })} KST)이 끝났다`
      + ' — 밀린 슬롯은 오늘 메우지 않는다',
      { publishedToday, slotKst, ownSlot },
    )
  }

  const due = dueSlotsAt(input.stage, nowMinute)
  const dueCount = due.reduce((n, s) => n + s.count, 0)
  const backlog = Math.max(0, dueCount - publishedToday)
  const base = { slotKst, ownSlot, dueCount, publishedToday, due }

  if (dueCount === 0) {
    return {
      ...blocked('', base), run: false, allowed: 0, backlog: 0,
      reason: `${input.stage} 의 첫 슬롯(${slotLabel(profileOf(input.stage).slots[0]!)} KST)이 아직 오지 않았다`
        + ' — 앞당겨 내지 않는다',
    }
  }
  if (backlog === 0) {
    return {
      ...blocked('', base), run: false, allowed: 0, backlog: 0,
      reason: `도래한 슬롯 ${dueCount}건을 이미 다 냈다 (오늘 ${publishedToday}건) — 낼 것이 없다`,
    }
  }

  const wanted = input.perRunMax
  const perRun = Number.isInteger(wanted) && (wanted as number) > 0 ? (wanted as number) : PER_RUN_MAX
  const allowed = Math.min(backlog, perRun)
  const catchUp = !ownSlot || backlog > 1

  return {
    ...base,
    run: true,
    allowed,
    catchUp,
    backlog,
    reason: catchUp
      ? `🟡 catch-up — 도래 ${dueCount}건 · 발행 ${publishedToday}건 → 밀린 ${backlog}건 중 ${allowed}건을 낸다`
        + (ownSlot ? ` (이 회차는 ${input.stage} 의 ${slotKst ?? '정시'} 슬롯이다)`
          : ` (이 회차 자체는 ${input.stage} 의 슬롯이 아니지만 밀린 것을 대신 낸다)`)
      : `${slotKst ?? '정시'} — ${input.stage} 의 슬롯이고 아직 내지 않았다 → ${allowed}건`,
  }
}

/**
 * 🔴 **그 단계가 하루 동안 실제로 낼 수 있는 최대치.**
 *    catch-up 이 상한을 늘리지 않는다는 것을 계산으로 못박는다 —
 *    창이 끝나는 시각의 `dueCount` 가 곧 `dailyTarget` 이다.
 *
 * 🔴 **이것은 천장이지 달성치가 아니다.** 실제로 몇 건이 나가는지는 트리거가
 *    **몇 번, 언제** 도착하는지가 정한다 — `simulateDay` 가 그것을 답한다.
 */
export function catchUpDailyCeiling(stage: RuntimeStage): number {
  return Math.min(dueCountAt(stage, PUBLISH_WINDOW_END_MINUTE), profileOf(stage).dailyTarget)
}

export type DaySimulation = {
  /** 이 트리거 배열로 실제로 나가는 건수 */
  published: number
  /** 그 단계의 하루 목표 */
  target: number
  /** 목표를 채우는가 */
  meetsTarget: boolean
  /** 운영 창(08:00~22:00) 안에 도착한 트리거 수 */
  triggersInWindow: number
  /** 창을 넘겨 도착해 버려진 트리거 수 */
  triggersAfterWindow: number
  /** 각 트리거가 낸 건수 (도착 순) */
  perTrigger: readonly { atKst: string; allowed: number; reason: string }[]
}

/**
 * 🔴 **이 트리거 배열이면 하루에 몇 건이 나가는가.**
 *
 *    🔴 **왜 필요한가.** "하루를 1분씩 다 돌려 상한을 넘지 않는다" 는 검사는
 *    *상한*을 증명하지 매분 트리거가 온다는 뜻이 아니다. 그 숫자를 **운영 능력**으로 읽으면
 *    실제로는 하루 7번밖에 안 오는 트리거를 10번 오는 것처럼 셈하게 된다.
 *
 *    그래서 **트리거 도착 시각을 입력으로 받는다.** 셋을 따로 넣어 따로 본다 —
 *      · launchd 가 깨어 있을 때의 슬롯 시각
 *      · 절전으로 여러 슬롯이 한 번으로 합쳐진 wake 시각
 *      · GitHub 예약의 **실측** 도착 시각
 *
 * 🔴 순수 함수다. 시계를 읽지 않는다 — 시각은 전부 인자로 들어온다.
 */
export function simulateDay(input: {
  stage: RuntimeStage
  /** 트리거 도착 시각들 (순서 무관 — 내부에서 정렬한다) */
  arrivals: readonly Date[]
  trigger?: TriggerKind
  /** `schedule` 로 볼 때 넘길 cron. 생략하면 `local` 로 본다 */
  cronOf?: (at: Date) => string | null
  perRunMax?: number
}): DaySimulation {
  const stage = input.stage
  const kind: TriggerKind = input.trigger ?? 'local'
  const sorted = [...input.arrivals].sort((a, b) => a.getTime() - b.getTime())
  const perTrigger: { atKst: string; allowed: number; reason: string }[] = []
  let published = 0
  let inWindow = 0
  let afterWindow = 0
  for (const at of sorted) {
    const m = kstMinuteOfDay(at)
    if (m > PUBLISH_WINDOW_END_MINUTE) afterWindow += 1
    else inWindow += 1
    const v = judgeCatchUp({
      stage, now: at, trigger: kind,
      cron: kind === 'schedule' ? (input.cronOf?.(at) ?? null) : null,
      publishedToday: published,
      ...(input.perRunMax === undefined ? {} : { perRunMax: input.perRunMax }),
    })
    if (v.run) published += v.allowed
    perTrigger.push({
      atKst: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
      allowed: v.run ? v.allowed : 0,
      reason: v.reason,
    })
  }
  const target = profileOf(stage).dailyTarget
  return {
    published, target, meetsTarget: published >= target,
    triggersInWindow: inWindow, triggersAfterWindow: afterWindow, perTrigger,
  }
}
