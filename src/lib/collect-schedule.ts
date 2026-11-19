/**
 * 공급 처리 예약 시각 — 🔴 **순수 상수. 네트워크·DB·파일 0**
 *
 * 🔴 수집 시각 · 원천 · 하루 요청 상한은 여기 없다. 바퀴 시각은 `cycle-schedule.ts` 의 `CYCLES`,
 *    원천 목록과 상한은 `collect-sources.ts` 가 정한다. 이 파일에는 아직 바퀴 표로 옮기지 않은
 *    공급 처리(supply-process) 시각만 남아 있다(공급 담당이 옮긴다).
 */

export type Slot = { hour: number; minute: number }

const at = (hour: number, minute: number): Slot => ({ hour, minute })

/** 🔴 공급 처리(drain) 슬롯 — 수집 결과를 비운다 */
export const SUPPLY_PROCESS_SLOTS: readonly Slot[] =
  [at(6, 15), at(8, 15), at(12, 15), at(14, 15), at(17, 15), at(21, 15), at(22, 15)]
