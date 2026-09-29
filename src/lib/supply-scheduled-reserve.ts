/**
 * 정기 공급 회차 몫 보호 — 🔴 **순수 판정. 파일·네트워크·env 읽기 0** (2026-09-29)
 *
 * 🔴 **왜 이 파일이 생겼나 — 2026-09-28 실측.**
 *    손으로 돌린 공급 회차 17번이 하루 예산(env `SORAN_LLM_DAILY_BUDGET_USD`, 운영 $0.50)을
 *    **먼저** 다 썼다. 그 뒤 정기 회차 14:15 · 17:15 · 21:15 · 22:15 는 요청마다
 *    `DAILY_EXHAUSTED` 로 막혀(77건) 초안이 0건이었다. 장부는 "누가 먼저 왔는가" 만 봤다 —
 *    정기 회차가 하루 생산의 근거인데, 그 몫을 아무도 지키지 않았다.
 *
 * 🔴 **무엇을 하는가.**
 *    ① 그날(KST) **아직 끝나지 않은 정기 슬롯**마다 최소 생산 몫을 떼어 둔다.
 *    ② 손 실행(수동 · commissioning · 정기 창 밖 kickstart)은 **그 몫을 뺀 나머지**만 쓴다.
 *    ③ 정기 회차는 이 몫의 주인이다 — 떼어 둔 몫에 막히지 않는다(기존 하루 예산 판정은 그대로).
 *    ④ 슬롯의 창이 끝나면 그 슬롯의 몫은 풀린다 — 마지막 슬롯이 끝나면 떼어 둔 몫이 0 이다.
 *
 * 🔴 **무엇을 하지 않는가.**
 *    · 하루 총액을 올리지 않는다. 예산 값을 코드가 정하지 않는다(env 가 정한다).
 *    · 정기 회차끼리의 순서를 정하지 않는다 — 08:15 가 많이 쓰면 22:15 가 덜 받는다(기존 그대로).
 *    · 정기 회차가 **끝났는지** 관측하지 않는다. 시각 창으로만 푼다(아래 `SCHEDULED_RUN_WINDOW_MS`).
 *
 * 🔴 **정기 회차를 무엇으로 아는가 — 호출자가 넘기는 인자가 아니다.**
 *    launchd 는 자기가 띄운 프로세스에 `XPC_SERVICE_NAME=<job label>` 을 넣는다.
 *    이 저장소는 이미 그 값으로 예약/수동을 가른다(`collect-run-record.judgeTrigger`, 수집 기록 522건 schedule).
 *    공급 job 은 `stage-consume-exec` → `supply-process` → 판정·초안 자식으로 env 를 그대로 물려준다.
 *    · `--trigger=...` 같은 **인자**나 `SORAN_*` env 는 보지 않는다 — 손으로 넣을 수 있는 칸이다.
 *    · 라벨은 **정확히 공급 job 하나**여야 한다. 다른 soransoran job(댓글 러너 등)은 정기 공급이 아니다.
 *    · 라벨이 맞아도 **슬롯 창 밖이면 수동**이다 — `launchctl kickstart` 로 아무 때나 띄운 회차가
 *      정기 몫을 쓰지 못하게 한다. 시각은 **벽시계**다. 부모가 넘기는 `SORAN_RUN_AT` 을 쓰지 않는다
 *      (손 실행이 그 값을 08:15 로 적어 넣을 수 있다).
 *    · 표식이 없거나 모르면 **수동**이다(fail-closed — 떼어 둔 몫을 지키는 쪽).
 *    🔴 남는 빈틈: 사람이 일부러 `XPC_SERVICE_NAME=com.soransoran.supply-process` 를 적고
 *       슬롯 창 안에서 손으로 돌리면 정기로 보인다. 실수로는 생기지 않는 경로다 — 숨기지 않고 적는다.
 */

import {
  SUPPLY_DAILY_USD_APPROVED, SUPPLY_RUN_SLOTS_KST, SUPPLY_WORKSET_PER_RUN, estimateSupplySpend,
} from './supply-schedule-contract'
import { LOCK_TTL_MS } from './supply-process'
import type { SpendProtect } from './llm-ledger'

export type { SpendProtect }

/** 🔴 launchd 가 넣는 env 이름 — 이 값을 호출자가 정하지 않는다 */
export const LAUNCHD_LABEL_ENV = 'XPC_SERVICE_NAME'

/** 🔴 정기 공급 job 의 label — `com.soransoran.supply-process.plist.template` 의 `Label` 과 같아야 한다(검사가 대조) */
export const SUPPLY_PROCESS_LAUNCHD_LABEL = 'com.soransoran.supply-process'

/**
 * 🔴 **슬롯 하나의 창 — 슬롯 시각부터 이만큼.**
 *
 *    공급 러너의 잠금 시효(`LOCK_TTL_MS`, 45분)와 같은 값이다. 그보다 오래 도는 회차는
 *    러너 스스로 `STALE_HELD` 로 보고 멈추게 되어 있다 — 즉 한 정기 회차가 **정상으로 살아 있을 수
 *    있는 가장 긴 시간**이다. 그 안에서는 ① 그 회차를 정기로 인정하고 ② 그 슬롯의 몫을 지킨다.
 *    창이 끝나면 슬롯이 돌았든(노트북이 꺼져) 안 돌았든 몫을 푼다 — 안 돈 슬롯의 몫을 하루 종일
 *    묶어 두지 않는다.
 */
export const SCHEDULED_RUN_WINDOW_MS = LOCK_TTL_MS

/**
 * 🔴 **정기 회차 하나의 최소 생산 몫(USD).**
 *
 *    `estimateSupplySpend(SUPPLY_WORKSET_PER_RUN).expectedPerRun` — 실측 단가(`SUPPLY_MEASURED`)
 *    × 원천당 평균 호출 수 × 회차 묶음 크기다. **평균 지출**이지 상한(`capPerRun`)이 아니다 —
 *    상한 × 6회는 하루 예산보다 커서 떼어 둘 수가 없다. 그래서 "꽉 찬 회차" 가 아니라
 *    "회차 하나가 평균만큼은 만든다" 를 지킨다.
 */
export function perRunReserveUsd(): number {
  return estimateSupplySpend(SUPPLY_WORKSET_PER_RUN).expectedPerRun
}

export type SlotKst = { readonly hour: number; readonly minute: number }

export type SupplyRunKind = 'scheduled' | 'manual'

const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3_600_000

/** 그 순간이 속한 KST 날짜의 00:00 (UTC ms) */
function kstMidnightMs(now: Date): number {
  const shifted = now.getTime() + KST_OFFSET_MS
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - KST_OFFSET_MS
}

export type SlotWindow = {
  /** 사람이 읽는 이름 — `2026-09-28 14:15` */
  label: string
  startMs: number
  endMs: number
}

/**
 * 🔴 **어제·오늘 슬롯의 창.** 어제 것도 보는 이유 — 자정 가까운 슬롯의 창이 자정을 넘으면
 *    그 회차의 요청은 **오늘 장부**에 적힌다. 지금 슬롯(22:15 + 45분)은 넘지 않지만
 *    슬롯을 옮기는 날 조용히 틀리지 않게 둔다.
 */
export function slotWindowsAround(
  now: Date, slots: readonly SlotKst[] = SUPPLY_RUN_SLOTS_KST, windowMs: number = SCHEDULED_RUN_WINDOW_MS,
): SlotWindow[] {
  const today0 = kstMidnightMs(now)
  const out: SlotWindow[] = []
  for (const day0 of [today0 - DAY_MS, today0]) {
    const date = new Date(day0 + KST_OFFSET_MS).toISOString().slice(0, 10)
    for (const s of slots) {
      const startMs = day0 + (s.hour * 60 + s.minute) * 60_000
      out.push({
        label: `${date} ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`,
        startMs, endMs: startMs + windowMs,
      })
    }
  }
  return out
}

/** 🔴 지금 그 창 안에 있는 슬롯 — 정기 회차로 인정하는 근거 */
export function activeSlotAt(
  now: Date, slots: readonly SlotKst[] = SUPPLY_RUN_SLOTS_KST, windowMs: number = SCHEDULED_RUN_WINDOW_MS,
): SlotWindow | null {
  const t = now.getTime()
  return slotWindowsAround(now, slots, windowMs).find((w) => w.startMs <= t && t < w.endMs) ?? null
}

/**
 * 🔴 **아직 끝나지 않은 슬롯** — 창 끝이 지금보다 뒤이고, 그 몫이 **오늘 장부**에 들어갈 것.
 *
 *    · 지금 도는 슬롯(창 안)도 포함한다 — 정기 회차가 도는 **동안** 손 실행이 그 몫을 먹으면 안 된다.
 *    · 끝난 슬롯은 뺀다 — 마지막 슬롯의 창이 끝나면 0 개다(몫이 풀린다).
 *    · 오늘 KST 날짜 기준이다. 자정이 지나면 새 날의 슬롯 6개가 다시 잡힌다(장부 파일도 새 날이다).
 */
export function pendingSlotsAt(
  now: Date, slots: readonly SlotKst[] = SUPPLY_RUN_SLOTS_KST, windowMs: number = SCHEDULED_RUN_WINDOW_MS,
): SlotWindow[] {
  const t = now.getTime()
  const today0 = kstMidnightMs(now)
  const tomorrow0 = today0 + DAY_MS
  return slotWindowsAround(now, slots, windowMs)
    // 🔴 창이 오늘 장부 날짜와 겹치고(어제 슬롯은 자정을 넘긴 것만), 아직 끝나지 않았다
    .filter((w) => w.endMs > t && w.endMs > today0 && w.startMs < tomorrow0)
}

/**
 * 🔴 **정기 회차인가.** 라벨이 공급 job **정확히 하나**이고 **슬롯 창 안**일 때만이다.
 *    그 밖은 전부 수동이다 — 표식이 없음 · 다른 job · 창 밖 kickstart.
 */
export function supplyRunKindOf(
  env: Readonly<Record<string, string | undefined>>, now: Date,
  slots: readonly SlotKst[] = SUPPLY_RUN_SLOTS_KST, windowMs: number = SCHEDULED_RUN_WINDOW_MS,
): { kind: SupplyRunKind; why: string } {
  const label = (env[LAUNCHD_LABEL_ENV] ?? '').trim()
  if (label !== SUPPLY_PROCESS_LAUNCHD_LABEL) {
    return {
      kind: 'manual',
      why: label === '' ? `${LAUNCHD_LABEL_ENV} 없음 — 손 실행으로 본다` : `launchd 라벨이 공급 job 이 아니다 (${label})`,
    }
  }
  const slot = activeSlotAt(now, slots, windowMs)
  if (slot === null) {
    return { kind: 'manual', why: '공급 job 라벨이지만 슬롯 창 밖이다 — kickstart 등 손으로 띄운 것으로 본다' }
  }
  return { kind: 'scheduled', why: `정기 슬롯 ${slot.label} 창 안` }
}

/**
 * 🔴 **이 요청에 적용할 보호 조건.** 순수 함수 — env 와 시각을 **받는다**.
 *
 *    손 실행:  남은 슬롯 수 × 회차 몫 을 떼어 두고, 천장은 계약 천장이다.
 *              계약 천장이 미승인(`null`)이면 0 이다 — 손 실행은 아무것도 못 쓴다(fail-closed).
 *    정기 회차: 보호 없음(`null`).
 */
export function supplySpendProtectAt(input: {
  env: Readonly<Record<string, string | undefined>>
  now: Date
  slots?: readonly SlotKst[]
  windowMs?: number
  perRunUsd?: number
  ceilingUsd?: number | null
}): { kind: SupplyRunKind; why: string; protect: SpendProtect | null } {
  const slots = input.slots ?? SUPPLY_RUN_SLOTS_KST
  const windowMs = input.windowMs ?? SCHEDULED_RUN_WINDOW_MS
  const k = supplyRunKindOf(input.env, input.now, slots, windowMs)
  if (k.kind === 'scheduled') return { ...k, protect: null }
  const pending = pendingSlotsAt(input.now, slots, windowMs)
  const perRun = input.perRunUsd ?? perRunReserveUsd()
  const ceiling = input.ceilingUsd === undefined ? SUPPLY_DAILY_USD_APPROVED : input.ceilingUsd
  return {
    ...k,
    protect: {
      reservedForOthersUsd: pending.length * perRun,
      ceilingUsd: ceiling ?? 0,
      reason: `정기 슬롯 ${pending.length}개 몫 $${(pending.length * perRun).toFixed(4)}`
        + ` (회차당 $${perRun.toFixed(4)}${pending.length === 0 ? '' : ` · ${pending.map((p) => p.label.slice(11)).join(' ')}`})`
        + ` · 천장 $${(ceiling ?? 0).toFixed(2)} · ${k.why}`,
    },
  }
}
