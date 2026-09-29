/**
 * 하루짜리 **첫 시험** — 🔴 "지속 D3" 도 "14일 내구 재고" 도 아니다 (2026-09-21)
 *
 * 🔴 **왜 이 파일이 생겼는가.**
 *
 *    `judgeReadiness` 가 묻는 네 가지는 **전부 14일 지속성**이다 —
 *    14일 누적 발행량 · 공백일 0 · 기배정 복구 · 14일치 재고.
 *    그래서 "내일 하루 3편을 안전하게 낼 수 있는가" 를 묻는 자리가 **없었다.**
 *    재고가 4건이면 d3 은 물론 **d1 조차 미달**로 판정되고(재고 4/14),
 *    `resolveScale` 이 실제로 단계를 낮춘다.
 *
 *    창업자 결정은 첫 시험을 하루 돌리고 1~2일 집중 검토하는 것이다.
 *    그 결정과 14일 내구성 목표는 **다른 질문**이고, 한쪽을 다른 쪽의
 *    선행조건으로 두면 첫 시험이 영원히 서지 않는다.
 *
 * 🔴 **그러나 14일 목표를 없애지 않는다.** 이 판정은 승격이 아니다 —
 *    하루가 지나면 스스로 사라지고, `judgeReadiness` 는 그대로 미달을 말한다.
 *    두 값을 같은 이름으로 부르지 않는 것이 이 파일의 목적이다.
 *
 * 🔴 **새 계산이 없다.** 시뮬레이션은 러너와 같은 `simulateStage` 를 쓰고
 *    지평만 **1일**로 준다. 여기서 다시 계산하면 관제와 러너가 갈린다.
 */
import type { RuntimeStage } from './scale-profile'
import { profileOf } from './scale-profile'
import type { SimOutcome } from './scale-readiness'

/** 🔴 값이 아니라 **이름**이다 */
export const CANARY_STAGE_ENV = 'SORAN_RELEASE_CANARY_STAGE'
export const CANARY_DATE_ENV = 'SORAN_RELEASE_CANARY_DATE'

/**
 * 🔴 **KST 달력 날짜.** 시험 허가는 이 문자열 하나에 묶인다 —
 *    날짜가 지나면 아무도 끄지 않아도 꺼진다.
 */
export function kstDateString(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

export type CanaryVerdict = {
  stage: RuntimeStage
  /** 그날 슬롯 수 = 그날 목표 편수 */
  want: number
  /** 🔴 **오늘(KST) 이미 낸 수** — 회차마다 다시 세지 않는다 */
  published: number
  /** 🔴 아직 쓸 수 있는 슬롯 수 */
  slotsLeft: number
  /** 🔴 **이 회차가 실제로 더 채워야 하는 수** = min(목표 − 이미 낸 수, 남은 슬롯) */
  need: number
  /** 배정까지 끝나 지금 낼 수 있다고 본 미발행 후보 수 */
  can: number
  ok: boolean
  reasons: string[]
}

/** 🔴 오늘 상태 — 러너가 DB 와 시계에서 읽어 넘긴다 */
export type TodayState = {
  /** 오늘(KST) 이미 발행한 수 — DB 실측 */
  publishedToday: number
  /** 아직 쓸 수 있는 슬롯 수 — 지나지 않은 슬롯 + 밀려서 대신 낼 수 있는 슬롯 */
  slotsLeft: number
}

/**
 * 🔴 **하루치 판정.** `sim` 은 반드시 `days: 1` 로 돌린 것이어야 한다 —
 *    14일치를 넣으면 이 함수가 14일 조건을 하루 조건인 척 말하게 된다.
 *
 *    묻는 것은 둘뿐이다:
 *      · 그날 슬롯을 채울 만큼 **배정까지 끝난** 글이 있는가
 *      · 기배정 복구가 깨져 레인이 멈춘 상태가 아닌가
 *
 * 🔴 **묻지 않는 것**을 분명히 적는다 — 14일 누적 발행량 · 14일 공백일 ·
 *    14일치 재고. 그 셋은 `judgeReadiness` 가 계속 본다.
 */
export function judgeOneDayCanary(sim: SimOutcome, today: TodayState): CanaryVerdict {
  const want = profileOf(sim.stage).dailyTarget
  /**
   * 🔴 **회차마다 하루치 전체를 다시 요구하지 않는다** (2026-09-21 보정).
   *
   *    앞판은 `sim.in14 >= want` 였다. 그래서 READY 4건으로 시작해
   *    09:30 에 한 건을 내고 3건이 남으면 13:30 회차가 다시 3건을 요구하고,
   *    13:30 뒤 2건이 남으면 **19:00 회차가 NO-GO 로 막혔다** —
   *    그날 3편을 낼 수 있는데도 마지막 한 편이 나가지 못한다.
   *
   *    묻는 것은 "오늘 목표를 **아직** 채울 수 있는가" 다:
   *      · 이미 낸 수는 빼고
   *      · 남은 슬롯보다 많이 요구하지 않는다 (슬롯이 하나면 한 건만 있으면 된다)
   */
  /**
   * 🔴 **`슬롯 남은 수` 로 한 번 더 깎지 않는다** (2026-09-21 2차 보정).
   *
   *    처음에는 `min(목표 − 이미 낸 수, 남은 슬롯)` 으로 썼다. 그런데 프로필은
   *    **슬롯 합 === dailyTarget** 을 검증하고(`validateProfile`), 한 회차는 한 건만
   *    낸다. 그래서 도달 가능한 모든 상태에서 두 값이 **같다** — `min` 의 한쪽은
   *    언제나 죽은 가지이고, 돌연변이를 넣어도 다른 쪽이 가려 준다(실측).
   *
   *    죽은 가지를 가드인 척 남기지 않는다. 대신 **그 불변식 자체를** 검사가 잠근다
   *    (`④ 남은 슬롯과 남은 편수는 같다`). 프로필이 어긋나면 거기서 깨진다.
   */
  const need = Math.max(0, want - today.publishedToday)
  const reasons: string[] = []
  if (sim.horizonDays !== 1) {
    reasons.push(`🔴 하루치 시뮬레이션이 아니다 (지평 ${sim.horizonDays}일) — 하루 판정으로 쓸 수 없다`)
  }
  if (sim.recoveryBroken > 0) {
    reasons.push(`기배정 복구가 깨진 행 ${sim.recoveryBroken}건 — 레인이 멈춘다`)
  }
  /**
   * 🔴 `need === 0` 이면 **오늘 할 일이 끝났다** — 목표를 채웠다는 뜻이고,
   *    낼 수 있는 수는 0 이상이므로 이 비교는 저절로 통과한다.
   *    그때 NO-GO 를 내면 하루 중간에 단계가 d1 로 떨어져, 이미 낸 3건이
   *    "상한 초과" 처럼 읽힌다. 할 일이 없는 것은 미달이 아니다.
   */
  if (sim.in14 < need) {
    reasons.push(`이 회차에 더 필요한 ${need}건 중 ${sim.in14}건만 낼 수 있다`
      + ` (오늘 ${today.publishedToday}/${want}건 발행 · 남은 슬롯 ${today.slotsLeft}`
      + ` · 재고 ${sim.stock}건 · persona ${sim.personas}명)`)
  }
  return {
    stage: sim.stage, want,
    published: today.publishedToday, slotsLeft: today.slotsLeft, need,
    can: sim.in14, ok: reasons.length === 0, reasons,
  }
}

/**
 * 🔴 **아직 지나지 않은 슬롯 수** — 보고용이다.
 *
 *    판정에는 쓰지 않는다. 프로필 불변식(슬롯 합 === dailyTarget)이 있는 한
 *    이 값은 `목표 − 이미 낸 수` 와 같고, 판정에 한 번 더 곱하면 죽은 가지가 된다.
 *    로그가 "몇 시 슬롯이 남았는가" 를 사람 말로 보여 주는 데 쓴다 —
 *    🔴 그리고 검사가 그 **같음**을 직접 잠근다.
 */
export function slotsLeftToday(stage: RuntimeStage, now: Date): number {
  const p = profileOf(stage)
  const kst = new Date(now.getTime() + 9 * 3_600_000)
  const minuteNow = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  return p.slots.filter((sl) => sl.hour * 60 + sl.minute >= minuteNow)
    .reduce((n, sl) => n + sl.count, 0)
}

export type CanaryAuthorization = {
  /** 사람이 허가한 단계. 없으면 null */
  stage: RuntimeStage | null
  /** 사람이 허가한 KST 날짜. 없으면 null */
  date: string | null
  /** 오늘이 그날인가 */
  activeToday: boolean
  /** 왜 켜졌는지 · 왜 안 켜졌는지 한 줄 */
  note: string | null
}

/**
 * 🔴 **허가는 단계와 날짜를 **둘 다** 요구한다.**
 *
 *    `SORAN_RELEASE_STAGE` 를 올리는 것만으로는 켜지지 않는다 —
 *    그 변수는 "지속 운영 단계" 이고, 준비도 감속이 계속 걸린다.
 *    첫 시험은 **별도의 두 변수**로만 열리고, 날짜가 지나면 저절로 닫힌다.
 *    "설정을 d3 으로 바꿔 두었다" 가 조용히 상시 d3 이 되는 길을 막는다.
 */
export function canaryAuthorization(
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
  allowed: readonly RuntimeStage[],
): CanaryAuthorization {
  const rawStage = (env[CANARY_STAGE_ENV] ?? '').trim()
  const rawDate = (env[CANARY_DATE_ENV] ?? '').trim()
  if (rawStage === '' && rawDate === '') {
    return { stage: null, date: null, activeToday: false, note: null }
  }
  if (rawStage === '' || rawDate === '') {
    return {
      stage: null, date: null, activeToday: false,
      note: `🔴 첫 시험 허가가 반쪽이다 — ${CANARY_STAGE_ENV} 와 ${CANARY_DATE_ENV} 를 **둘 다** 준다`,
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return { stage: null, date: null, activeToday: false, note: `🔴 시험 날짜 형식이 아니다 — ${rawDate}` }
  }
  if (!allowed.includes(rawStage as RuntimeStage)) {
    return { stage: null, date: rawDate, activeToday: false, note: `🔴 모르는 단계다 — ${rawStage}` }
  }
  const today = kstDateString(now)
  const activeToday = rawDate === today
  return {
    stage: rawStage as RuntimeStage,
    date: rawDate,
    activeToday,
    note: activeToday
      ? `🔴 하루짜리 첫 시험 허가 — ${rawStage} · ${rawDate} (KST). 오늘 하루만이다`
      : `첫 시험 허가는 ${rawDate} (KST) 의 것이다 — 오늘(${today})은 아니다`,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 **기간형 제한 운영** — 하루짜리 시험과 다른 것이다 (2026-09-22)
//
//    하루짜리(`CANARY_*`)는 날짜 하나라 **매일 사람이 바꿔야** 한다.
//    며칠을 이어 보려면 그 손이 매일 들어가고, 그것이 "매일 수동 시동" 의
//    남은 절반이었다. 🔴 기간을 명시하면 그 손이 없어지고, **끝나면 스스로 닫힌다.**
//
// 🔴 **지속 운영 승격이 아니다.** 14일 누적·공백·재고 조건은 그대로 미달이고
//    `chosenReady` 는 false 로 남는다. 기간이 지나면 사람 개입 없이 기본 단계다.
// ─────────────────────────────────────────────────────────

export const WINDOW_STAGE_ENV = 'SORAN_RELEASE_WINDOW_STAGE'
export const WINDOW_FROM_ENV = 'SORAN_RELEASE_WINDOW_FROM'
export const WINDOW_UNTIL_ENV = 'SORAN_RELEASE_WINDOW_UNTIL'

/** 🔴 기간을 아무리 길게 적어도 이보다 길 수 없다 — 잊고 두는 것을 막는다 */
export const WINDOW_MAX_DAYS = 7

export type WindowAuthorization = {
  stage: RuntimeStage | null
  from: string | null
  until: string | null
  /** 오늘이 그 기간 안인가 */
  activeToday: boolean
  note: string | null
}

/**
 * 🔴 **모양이 맞는 것과 실제로 있는 날인 것은 다르다** (2026-09-22 보정).
 *
 *    앞판은 `/^\d{4}-\d{2}-\d{2}$/` 하나만 봤다. 그래서 `2026-02-30` 도 통과했고,
 *    `Date.parse` 가 NaN 을 내면 `span < 0` 도 `span + 1 > WINDOW_MAX_DAYS` 도
 *    **둘 다 false** 라 7일 상한이 통째로 무력해졌다 — NaN 비교는 언제나 false 다.
 *    없는 날짜 하나로 몇 달짜리 기간이 열리는 길이었다.
 *
 * 🔴 그래서 **되돌려 찍어 같은 글자인지** 본다. 2026-02-30 은 3월 2일로 굴러가므로 걸린다.
 */
const isDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  if (!Number.isFinite(t)) return false
  return new Date(t).toISOString().slice(0, 10) === s
}
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/**
 * 🔴 **세 값을 모두 요구한다.** 하나라도 비면 켜지지 않는다 —
 *    `UNTIL` 만 빠뜨리면 영원히 켜진 기간이 되고, 그것이 가장 위험하다.
 */
export function windowAuthorization(
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
  allowed: readonly RuntimeStage[],
): WindowAuthorization {
  const rawStage = (env[WINDOW_STAGE_ENV] ?? '').trim()
  const rawFrom = (env[WINDOW_FROM_ENV] ?? '').trim()
  const rawUntil = (env[WINDOW_UNTIL_ENV] ?? '').trim()
  const none: WindowAuthorization = { stage: null, from: null, until: null, activeToday: false, note: null }
  if (rawStage === '' && rawFrom === '' && rawUntil === '') return none
  const bad = (note: string): WindowAuthorization => ({ ...none, note })
  if (rawStage === '' || rawFrom === '' || rawUntil === '') {
    return bad(`🔴 기간 허가가 반쪽이다 — ${WINDOW_STAGE_ENV} · ${WINDOW_FROM_ENV} · ${WINDOW_UNTIL_ENV} 를 **모두** 준다`)
  }
  if (!isDate(rawFrom) || !isDate(rawUntil)) return bad(`🔴 기간 날짜 형식이 아니다 — ${rawFrom}~${rawUntil}`)
  if (!allowed.includes(rawStage as RuntimeStage)) return bad(`🔴 모르는 단계다 — ${rawStage}`)
  /**
   * 🔴 여기 닿을 때 두 값은 **실재하는 날짜**다 — `isDate` 가 되돌려 찍어 확인했다.
   *    그래서 `span` 은 유한하고, 아래 두 비교가 NaN 으로 함께 false 가 되는 일이 없다.
   *    (앞판은 형식만 봤고, 그때 `2026-02-30` 하나로 7일 상한이 통째로 열렸다.)
   */
  const span = daysBetween(rawFrom, rawUntil)
  if (span < 0) return bad(`🔴 시작이 끝보다 뒤다 — ${rawFrom} > ${rawUntil}`)
  if (span + 1 > WINDOW_MAX_DAYS) {
    return bad(`🔴 기간이 ${span + 1}일이다 — 최대 ${WINDOW_MAX_DAYS}일. 잊고 두는 것을 막는다`)
  }
  const today = kstDateString(now)
  const activeToday = today >= rawFrom && today <= rawUntil
  return {
    stage: rawStage as RuntimeStage, from: rawFrom, until: rawUntil, activeToday,
    note: activeToday
      ? `🔴 기간형 제한 운영 — ${rawStage} · ${rawFrom}~${rawUntil} (KST). 오늘은 그 안이다`
      : `기간 허가는 ${rawFrom}~${rawUntil} 의 것이다 — 오늘(${today})은 밖이다`,
  }
}

/** 🔴 그날 더 내도 되는가 — 세 가지를 **다른 무게**로 가른다 */
export type DayGuardInput = {
  /** 오늘(KST) 이미 낸 수 */
  publishedToday: number
  /** 그날 목표 */
  dailyTarget: number
  /** 지금 낼 수 있다고 본 수 */
  publishable: number
  /** 🔴 전면 중단 사유 — 중복·정산·안전 */
  hardDefects: readonly string[]
}
export type DayGuard = {
  /** 이 회차가 더 내도 되는가 */
  allow: boolean
  /** 🔴 **전면 중단**인가 (그날을 닫는다) */
  halt: boolean
  reason: string
}

/**
 * 🔴 **재고 부족과 결함을 같은 무게로 다루지 않는다.**
 *
 *    · 재고가 모자라 더 못 내는 것은 **그만 내는 것**이다 — 오늘 낸 것은 그대로 둔다
 *    · 중복·정산·안전 결함은 **전면 중단**이다 — 원인을 사람이 볼 때까지 그날을 닫는다
 */
export function judgeDayGuard(i: DayGuardInput): DayGuard {
  if (i.hardDefects.length > 0) {
    return { allow: false, halt: true, reason: `🔴 전면 중단 — ${i.hardDefects.join(' · ')}` }
  }
  const remain = Math.max(0, i.dailyTarget - i.publishedToday)
  if (remain === 0) {
    return { allow: false, halt: false, reason: `오늘 ${i.publishedToday}/${i.dailyTarget}건 — 다 냈다` }
  }
  if (i.publishable <= 0) {
    return {
      allow: false, halt: false,
      reason: `🟡 재고가 없어 더 내지 않는다 (오늘 ${i.publishedToday}/${i.dailyTarget}건)`
        + ' — 낸 것은 그대로 둔다',
    }
  }
  return { allow: true, halt: false, reason: `더 낼 수 있다 — 남은 ${remain}건 · 낼 수 있는 것 ${i.publishable}건` }
}
