/**
 * 발행 날짜 · 슬롯 · 그날 문 — 🔴 하루 시험 허가(canary) · 기간 허가(window) · 하루 시뮬레이션 판정은 지웠다 (2026-09-30)
 *
 * 🔴 **지운 것과 이유.**
 *    · `canaryAuthorization` · `windowAuthorization` (`SORAN_RELEASE_CANARY_*` · `SORAN_RELEASE_WINDOW_*`) —
 *      사람이 env 로 단계를 올리던 경로다. 단계의 정본은 StageDecision 하나다(정본: no routine human stage/env command).
 *    · `judgeOneDayCanary` — 기존 **완성 글 큐**로 하루를 시뮬레이션해 시험을 열던 판정. 시험 관문은 이제
 *      `judgeNextPreflight`(slot-valid 기회 · 처리량 · Persona · 비용)이다.
 * 🔴 남은 것은 날짜 · 슬롯 수 · 그날 문(`judgeDayGuard`) 셋뿐이다.
 */
import type { RuntimeStage } from './scale-profile'
import { profileOf } from './scale-profile'

/**
 * 🔴 **KST 달력 날짜.** 시험 허가는 이 문자열 하나에 묶인다 —
 *    날짜가 지나면 아무도 끄지 않아도 꺼진다.
 */
export function kstDateString(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
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
