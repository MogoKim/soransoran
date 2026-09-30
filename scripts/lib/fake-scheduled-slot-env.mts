/**
 * 🔴 **시험 전용 — 가짜 provider 러너를 "마지막 정기 슬롯(22:15) 회차" 로 띄우는 env** (2026-09-29 2차).
 *
 *    정기 회차 몫 보호(`supply-scheduled-reserve`)는 손 실행에게 **남은 정기 슬롯 몫 전부**를 떼어 둔다.
 *    임시 HOME 장부에는 정기 실측이 없어 몫이 보수 기본값(회차 상한)이 되고, 그러면 하루 여력 전부가 정기 몫이다 —
 *    라벨 없이 띄운 러너(손 실행)는 23시(KST) 전에는 한 건도 못 보낸다. 시험 결과가 **돌린 시각**에 따라 갈린다.
 *
 *    그래서 보호 판정이 아닌 것(생성·검수·마스킹·시각 보존 등)을 보는 fixture 는 러너를
 *    **마지막 슬롯 정기 회차**로 띄운다 — 뒤 슬롯이 없으니 떼어 둘 몫이 0 이고, 하루 예산 판정은 그대로다.
 *
 *    · 라벨(`XPC_SERVICE_NAME`)은 launchd 가 넣는 이름 그대로 준다.
 *    · 시각(`FAKE_SUPPLY_PROTECT_NOW`)은 `fake-provider-hook` 이 걸린 프로세스에서만 읽힌다 —
 *      그 훅은 provider 를 가짜로 바꾸므로 이 env 로 **실제 유료 요청**을 보낼 수 없다.
 *    🔴 보호 자체를 보는 시험(`supply:reserve-check` · `supply:ledger-check` ⓚ')은 이것을 쓰지 않는다.
 */
import { LAUNCHD_LABEL_ENV, SUPPLY_PROCESS_LAUNCHD_LABEL } from '../../src/lib/supply-scheduled-reserve'

/** 22:20 KST(2026-09-28) — 22:15 슬롯 창 안 */
export const LAST_SLOT_PROTECT_NOW = '2026-09-28T13:20:00.000Z'

export const LAST_SLOT_SCHEDULED_ENV: Readonly<Record<string, string>> = Object.freeze({
  [LAUNCHD_LABEL_ENV]: SUPPLY_PROCESS_LAUNCHD_LABEL,
  FAKE_SUPPLY_PROTECT_NOW: LAST_SLOT_PROTECT_NOW,
})
