/**
 * 🔴 **시험 전용 — 가짜 provider 러너를 "그날 마지막 정기 회차" 로 띄우는 env**
 *
 *    정기 회차 몫 보호(`supply-scheduled-reserve`)는 손 실행에게 **남은 정기 회차 몫 전부**를 떼어 둔다 —
 *    라벨 없이 띄운 러너(손 실행)는 마지막 회차 창이 끝나기 전에는 한 건도 못 보낸다. 시험 결과가 **돌린 시각**에 따라 갈린다.
 *
 *    그래서 보호 판정이 아닌 것(생성·검수·마스킹·시각 보존 등)을 보는 fixture 는 러너를
 *    **마지막 정기 회차**로 띄운다 — 뒤 회차가 없으니 떼어 둘 몫이 0 이고, 하루 예산 판정은 그대로다.
 *
 *    · 라벨(`XPC_SERVICE_NAME`)은 launchd 가 넣는 이름 그대로 준다.
 *    · 시각(`FAKE_SUPPLY_PROTECT_NOW`)은 `fake-provider-hook` 이 걸린 프로세스에서만 읽힌다 —
 *      그 훅은 provider 를 가짜로 바꾸므로 이 env 로 **실제 유료 요청**을 보낼 수 없다.
 *    🔴 보호 자체를 보는 시험(`supply:reserve-check` · `supply:ledger-check` ⓚ')은 이것을 쓰지 않는다.
 */
import { SUPPLY_RUN_SLOTS_KST } from '../../src/lib/supply-schedule-contract'
import { LAUNCHD_LABEL_ENV, SUPPLY_PROCESS_LAUNCHD_LABEL } from '../../src/lib/supply-scheduled-reserve'

const LAST_SLOT_MINUTE = Math.max(...SUPPLY_RUN_SLOTS_KST.map((s) => s.hour * 60 + s.minute))

/** 2026-09-28 KST · 마지막 정기 회차 시각 + 5분 — 그 회차 창 안(시각은 바퀴 표에서 계산한다) */
export const LAST_SLOT_PROTECT_NOW = new Date(
  Date.parse('2026-09-28T00:00:00.000+09:00') + (LAST_SLOT_MINUTE + 5) * 60_000,
).toISOString()

export const LAST_SLOT_SCHEDULED_ENV: Readonly<Record<string, string>> = Object.freeze({
  [LAUNCHD_LABEL_ENV]: SUPPLY_PROCESS_LAUNCHD_LABEL,
  FAKE_SUPPLY_PROTECT_NOW: LAST_SLOT_PROTECT_NOW,
})
