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
import type { ReleaseStage } from './scale-profile'
import { PROFILES } from './scale-profile'
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
  stage: ReleaseStage
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
  const want = PROFILES[sim.stage].dailyTarget
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
export function slotsLeftToday(stage: ReleaseStage, now: Date): number {
  const p = PROFILES[stage]
  const kst = new Date(now.getTime() + 9 * 3_600_000)
  const minuteNow = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  return p.slots.filter((sl) => sl.hour * 60 + sl.minute >= minuteNow)
    .reduce((n, sl) => n + sl.count, 0)
}

export type CanaryAuthorization = {
  /** 사람이 허가한 단계. 없으면 null */
  stage: ReleaseStage | null
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
  allowed: readonly ReleaseStage[],
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
  if (!allowed.includes(rawStage as ReleaseStage)) {
    return { stage: null, date: rawDate, activeToday: false, note: `🔴 모르는 단계다 — ${rawStage}` }
  }
  const today = kstDateString(now)
  const activeToday = rawDate === today
  return {
    stage: rawStage as ReleaseStage,
    date: rawDate,
    activeToday,
    note: activeToday
      ? `🔴 하루짜리 첫 시험 허가 — ${rawStage} · ${rawDate} (KST). 오늘 하루만이다`
      : `첫 시험 허가는 ${rawDate} (KST) 의 것이다 — 오늘(${today})은 아니다`,
  }
}
