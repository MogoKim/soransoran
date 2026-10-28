/**
 * 정기 공급 회차 몫 보호 — 🔴 **순수 판정. 파일·네트워크·env 읽기 0** (2026-09-29)
 *
 * 🔴 **왜 이 파일이 생겼나 — 2026-09-28 실측.**
 *    손으로 돌린 공급 회차 17번이 하루 예산(env `SORAN_LLM_DAILY_BUDGET_USD`)을
 *    **먼저** 다 썼다. 그 뒤 정기 회차 14:15 · 17:15 · 21:15 · 22:15 는 요청마다
 *    `DAILY_EXHAUSTED` 로 막혀(77건) 초안이 0건이었다. 장부는 "누가 먼저 왔는가" 만 봤다 —
 *    정기 회차가 하루 생산의 근거인데, 그 몫을 아무도 지키지 않았다.
 *    🔴 (2026-09-30 정정, A4 진단) "먼저 썼다" 는 11시대 손 실행 6회($0.44)에만 맞다. 오후 손 실행 9회는
 *       프로세스 env 로 덮어쓴 더 큰 하루 예산으로 **$0.50 을 넘겨** 썼다(장부 합계 $1.1925). 그 길은 이 파일의
 *       천장(min(env, 계약 천장))이 닫고, 별도 장부로 새 예산을 여는 길(`$HOME` 바꾸기 · 오늘 파일 없음)은
 *       `supply-llm-call` 의 정본 자리 확인과 `missingTodayLedgerVerdict` 가 닫는다.
 *
 * 🔴 **2차 보정 (같은 날) — 고정 몫 $0.0464 로는 늦은 슬롯이 여전히 굶는다.**
 *    앞판은 슬롯 몫을 `estimateSupplySpend(10).expectedPerRun`(묶음 5 시절 09-24~27 단가로 만든 추정)
 *    하나로 고정했다. 묶음이 커진 뒤 실제 정기 회차(09-29 08:15 · 12:15 · 17:15)는
 *    **$0.0655 · $0.0992 · $0.0923** 을 썼다. 몫을 실제보다 작게 떼면, 앞 슬롯이 실제만큼 쓰는 동안
 *    뒤 슬롯의 몫이 모자라 22:15 가 막힌다. 더 큰 상수 하나로 바꾸는 것도 답이 아니다 —
 *    다음에 묶음·모델이 바뀌면 또 낡는다. 그래서 몫을 **장부의 최근 정기 회차 실측**에서 읽는다.
 *
 * 🔴 **무엇을 하는가 — 슬롯별 동적 배분.**
 *    ① 슬롯 몫(share) = **어제까지** `SCHEDULED_COST_LOOKBACK_DAYS` 일 동안 **정산이 끝난 정기 회차**의
 *       슬롯당 실측 평균(오늘 회차는 넣지 않는다 — 하루 안에서 몫이 흔들리지 않게).
 *       표본이 `SCHEDULED_COST_MIN_SAMPLES` 개 미만이면 **보수 기본값**
 *       `estimateSupplySpend(묶음).capPerRun`(회차 상한 — 꽉 찬 회차 최대 단가) 을 쓴다(fail-closed).
 *       🔴 이력 중 **하루라도 못 읽거나(깨짐) 어제 장부가 없거나 비었으면** 표본을 내지 않고 보수 기본값이다
 *          (세션 `historyBefore`) — 남은 날의 일부 표본으로 몫을 낮추지 않는다.
 *    ② 오늘 정기 몫 전체 P는 운영 예산과 계약 천장 중 낮은 값 안에서 정한다.
 *       D20 승인 천장 $1.20이 적용되면 당일 증명에 쓸 앞 5슬롯을 먼저 보호한다.
 *       더 낮은 운영 예산에서는 기존 7슬롯 동적 몫 계산을 유지한다.
 *    ③ D20 증명 슬롯이 남아 있는 동안 21:15·22:15는 앞 5슬롯의 예산을 먼저 쓰지 못한다.
 *       앞 5슬롯이 끝난 뒤에만 남은 예산을 나누어 쓴다.
 *    ④ 남은 증명 슬롯은 실제 여력을 같은 비율로 나누고, 각 슬롯이 이미 쓴 정산·열린 예약은
 *       그 슬롯의 남은 몫에서만 뺀다.
 *    ⑤ 손 실행(수동 · commissioning · 창 밖 kickstart · 늦게 뜬 launchd · 잠에서 깨 다른 창에 들어온 회차)은
 *       우선 슬롯의 남은 몫을 전부 떼어 둔 나머지만 쓴다.
 *    ⑥ 정기 회차는 자기를 제외한 나머지 우선 슬롯의 남은 몫을 떼어 둔 나머지를 쓴다.
 *    (계산 정본은 `allocateScheduledReserve` 주석.)
 *
 * 🔴 **무엇을 하지 않는가.**
 *    · 하루 총액을 올리지 않는다. 예산 값을 코드가 정하지 않는다(env · 계약 천장 중 낮은 값).
 *    · 정기 회차가 **끝났는지** 관측하지 않는다. 시각 창으로만 푼다(아래 `SCHEDULED_RUN_WINDOW_MS`).
 *    · 실측을 회차 id 의 시각으로 추측하지 않는다 — 장부 줄의 `runKind`/`runSlot`(요청 전 판정이
 *      적은 값)만 믿는다. 이 칸이 생기기 전 장부(~2026-09-29)는 표본이 아니다 → 기본값으로 시작한다.
 *
 * 🔴 **정기 회차를 무엇으로 아는가 — 호출자가 넘기는 인자가 아니다.**
 *    launchd 는 자기가 띄운 프로세스에 `XPC_SERVICE_NAME=<job label>` 을 넣는다.
 *    이 저장소는 이미 그 값으로 예약/수동을 가른다(`collect-run-record.judgeTrigger`, 수집 기록 522건 schedule).
 *    공급 job 은 `stage-consume-exec` → `supply-process` → 판정·초안 자식으로 env 를 그대로 물려준다.
 *    · `--trigger=...` 같은 **인자**나 `SORAN_*` env 는 보지 않는다 — 손으로 넣을 수 있는 칸이다.
 *    · 라벨은 **정확히 공급 job 하나**여야 한다. 다른 soransoran job(댓글 러너 등)은 정기 공급이 아니다.
 *    · 라벨이 맞아도 **슬롯 창 밖이면 수동**이다 — `launchctl kickstart` 로 아무 때나 띄운 회차나
 *      잠에서 깬 뒤 늦게 뜬 회차가 정기 몫을 쓰지 못하게 한다. 요청 시각은 **벽시계**다.
 *    · 🔴 (3차) 요청 시각뿐 아니라 **회차 시작 시각**도 같은 창이어야 한다 — 잠들었다 다른 창에서 깬 회차,
 *      창 전에 kickstart 로 떠서 창으로 넘어온 회차는 수동이다(`supplyRunKindOf`). 시작 시각은
 *      min(부모 `SORAN_RUN_AT`, 세션 생성 벽시계)이다 — `SORAN_RUN_AT` 은 **더 엄격하게만** 쓴다
 *      (그 값으로 창 밖 요청이 정기가 되지는 않는다). 모양이 틀리면 모르는 것 → 수동.
 *    · 표식이 없거나 모르면 **수동**이다(fail-closed — 떼어 둔 몫을 지키는 쪽).
 *    🔴 남는 빈틈: 사람이 일부러 `XPC_SERVICE_NAME=com.soransoran.supply-process` 를 적고
 *       슬롯 창 안에서 손으로 돌리면 정기로 보인다. 실수로는 생기지 않는 경로다 — 숨기지 않고 적는다.
 */

import {
  SUPPLY_DAILY_USD_APPROVED, SUPPLY_PROOF_FIRST_DAILY_USD, SUPPLY_PROOF_RUN_SLOTS_KST,
  SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS, SUPPLY_WORKSET_PER_RUN, estimateSupplySpend,
  supplyProofRunSlots,
} from './supply-schedule-contract'
import type { LedgerEntry, SpendProtect } from './llm-ledger'

export type { SpendProtect }

/** 🔴 launchd 가 넣는 env 이름 — 이 값을 호출자가 정하지 않는다 */
export const LAUNCHD_LABEL_ENV = 'XPC_SERVICE_NAME'

/** 🔴 정기 공급 job 의 label — `com.soransoran.supply-process.plist.template` 의 `Label` 과 같아야 한다(검사가 대조) */
export const SUPPLY_PROCESS_LAUNCHD_LABEL = 'com.soransoran.supply-process'

/**
 * 🔴 **슬롯 하나의 창 — 슬롯 시각부터 이만큼.**
 *
 *    공급 회차 하나가 **정상으로 살아 있을 수 있는 가장 긴 시간**(`SUPPLY_RUN_WINDOW_MS`, 45분)이다.
 *    그 안에서는 ① 그 회차를 정기로 인정하고 ② 그 슬롯의 몫을 지킨다.
 *    (2026-10-12 Batch C1 — 앞판은 이 값이 `wx` 잠금 시효였다. 지금 잠금은 커널 lease 라 시효가 없고, 이 값은 창 길이로만 남는다.)
 *    창이 끝나면 슬롯이 돌았든(노트북이 꺼져) 안 돌았든 몫을 푼다. proof-first에서는 그 몫을
 *    이후 먼저 도착한 event·복구·정기 회차가 쓰고, 저예산 profile에서는 기존 방식으로 뒤 슬롯에 이월한다.
 */
export const SCHEDULED_RUN_WINDOW_MS = SUPPLY_RUN_WINDOW_MS

/**
 * 🔴 **실측을 모으는 기간(일)** — 어제부터 뒤로 이만큼의 KST 날짜 장부를 읽는다(오늘은 넣지 않는다).
 *    묶음 크기·모델이 바뀌면 일주일 안에 새 값으로 넘어간다. 오늘을 빼는 이유 — 오늘 끝난 회차가 표본이 되면
 *    하루 중간에 몫(과 오늘 정기 몫 전체)이 바뀌어, 아침에 떼어 둔 뒤 슬롯 몫이 오후에 줄 수 있다.
 */
export const SCHEDULED_COST_LOOKBACK_DAYS = 7

/**
 * 🔴 **실측으로 인정하는 최소 표본(정기 슬롯 회차 수).** 이보다 적으면 보수 기본값이다.
 *    하루 7슬롯 중 절반에 가까운 값 — 한두 회차의 우연한 값으로 몫을 정하지 않는다.
 */
export const SCHEDULED_COST_MIN_SAMPLES = 3

/**
 * 🔴 **실측 몫의 바닥** — 모델 추정 평균 지출(`expectedPerRun`, 묶음 기준).
 *    할 일이 적은 날 몇 회차가 아주 싸게 끝났다고 뒤 슬롯 보호가 사라지지 않게 한다.
 */
export function measuredShareFloorUsd(): number {
  return estimateSupplySpend(SUPPLY_WORKSET_PER_RUN).expectedPerRun
}

/**
 * 🔴 **실측 몫의 천장 · 표본 부족 때의 기본값** — 회차 상한(`capPerRun`: 묶음 전부 × 최대 단가).
 *
 *    표본이 모자라면 이 값으로 **크게** 떼어 둔다(fail-closed). 7슬롯 × 이 값은 하루 천장보다 커서
 *    비례 축소가 걸린다 — 결과는 "하루 여력을 남은 슬롯이 똑같이 나눠 갖고, 손 실행은 남는 게 없다" 다.
 *    손 실행이 멈추는 쪽으로 틀리고, 정기 회차가 굶는 쪽으로는 틀리지 않는다.
 */
export function conservativeShareUsd(): number {
  return estimateSupplySpend(SUPPLY_WORKSET_PER_RUN).capPerRun
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
  /** 사람이 읽는 이름 — `2026-09-28 14:15` · 🔴 장부 `runSlot` 에 이 값이 그대로 적힌다 */
  label: string
  startMs: number
  endMs: number
}

/** 슬롯 이름(`YYYY-MM-DD HH:MM`, KST) → 시작 시각(UTC ms). 모양이 틀리면 `null` */
export function slotStartMsOf(label: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(label)
  if (m === null) return null
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00.000+09:00`)
  return Number.isFinite(t) ? t : null
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
 *    · 오늘 KST 날짜 기준이다. 자정이 지나면 새 날의 슬롯 7개가 다시 잡힌다(장부 파일도 새 날이다).
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
 * 🔴 **오늘 창이 이미 끝난 슬롯** (시각 순서) — 이월 계산에 쓴다. 오늘 KST 날짜에 시작한 것만이다.
 *    `pendingSlotsAt` 과 합치면 오늘 슬롯 전부다(자정을 넘는 어제 슬롯은 어느 쪽에도 끝난 것으로 들지 않는다).
 */
export function endedSlotsAt(
  now: Date, slots: readonly SlotKst[] = SUPPLY_RUN_SLOTS_KST, windowMs: number = SCHEDULED_RUN_WINDOW_MS,
): SlotWindow[] {
  const t = now.getTime()
  const today0 = kstMidnightMs(now)
  return slotWindowsAround(now, slots, windowMs)
    .filter((w) => w.startMs >= today0 && w.endMs <= t)
    .sort((a, b) => a.startMs - b.startMs)
}

/**
 * 🔴 **정기 회차인가.** 라벨이 공급 job **정확히 하나**이고, 요청 시각과 **회차 시작 시각**이
 *    **같은 슬롯 창 안**일 때만이다. 그 밖은 전부 수동이다 — 표식이 없음 · 다른 job · 창 밖 kickstart ·
 *    늦게 뜬 launchd 회차 · 창 안에서 시작했지만 잠들었다가 **다른 창에서 깨어난** 회차.
 *
 * 🔴 **잠·늦은 복귀 규칙 (2026-09-29 3차)** — 요청 시각만 보면 두 가지가 샌다(실측 재현):
 *    ① 08:15 회차가 08:16 에 시작해 잠들고 12:17 에 깨면, 그 회차의 남은 요청이 **12:15 슬롯 몫**으로
 *       정기 판정을 받았다 — 제 슬롯이 아닌 몫을 먹고, 12:15 정기 회차가 굶는다.
 *    ② 08:10 에 kickstart 로 뜬 회차가 08:15 를 넘기면 그 뒤 요청이 08:15 몫을 받았다.
 *    그래서 `runStartedAt`(회차가 **실제로 시작한** 가장 이른 시각)도 같은 창이어야 한다.
 *    · 창이 다르거나 시작 시각이 창 밖 → **수동**. 수동은 아직 우선권이 있는 슬롯의 남은 몫을 떼어 둔
 *      나머지만 쓴다. 끝난 슬롯의 미사용분은 현재 profile의 우선순위 규칙에 따라 복구·후속 회차가 쓸 수 있다.
 *    · `runStartedAt === null` = 시작 시각을 **모른다**(깨진 `SORAN_RUN_AT` 등) → 수동(fail-closed).
 *    · `undefined` = 이 호출이 시작 시각을 따로 주지 않았다 → 요청 시각과 같다고 본다(순수 계산·시험용).
 *      🔴 운영 경로(`supplyProtectFromEnv`)는 **언제나** 값을 준다 — 세션 검사가 그것을 본다.
 */
export function supplyRunKindOf(
  env: Readonly<Record<string, string | undefined>>, now: Date,
  slots: readonly SlotKst[] = SUPPLY_RUN_SLOTS_KST, windowMs: number = SCHEDULED_RUN_WINDOW_MS,
  runStartedAt?: Date | null,
): { kind: SupplyRunKind; why: string; slot: string | null } {
  const label = (env[LAUNCHD_LABEL_ENV] ?? '').trim()
  if (label !== SUPPLY_PROCESS_LAUNCHD_LABEL) {
    return {
      kind: 'manual', slot: null,
      why: label === '' ? `${LAUNCHD_LABEL_ENV} 없음 — 손 실행으로 본다` : `launchd 라벨이 공급 job 이 아니다 (${label})`,
    }
  }
  const slot = activeSlotAt(now, slots, windowMs)
  if (slot === null) {
    return { kind: 'manual', slot: null, why: '공급 job 라벨이지만 슬롯 창 밖이다 — kickstart · 늦게 뜬 회차로 본다' }
  }
  if (runStartedAt !== undefined) {
    if (runStartedAt === null || !Number.isFinite(runStartedAt.getTime())) {
      return { kind: 'manual', slot: null, why: '회차 시작 시각을 모른다 — 정기로 인정하지 않는다(fail-closed)' }
    }
    const startSlot = activeSlotAt(runStartedAt, slots, windowMs)
    if (startSlot === null || startSlot.label !== slot.label) {
      return {
        kind: 'manual', slot: null,
        why: `회차가 ${slot.label} 창 안에서 시작하지 않았다(시작 ${startSlot?.label ?? '창 밖'})`
          + ' — 잠에서 깬·창 밖에서 뜬 회차는 손 실행으로 본다',
      }
    }
  }
  return { kind: 'scheduled', slot: slot.label, why: `정기 슬롯 ${slot.label} 창 안` }
}

// ─────────────────────────────────────────────────────────
// 🔴 오늘 장부 파일이 없을 때 — "사용액 0" 으로 믿어도 되는가 (2026-09-30)
// ─────────────────────────────────────────────────────────

export type MissingTodayVerdict = { ok: true; why: string } | { ok: false; reason: string }

/**
 * 🔴 **공급 장부의 오늘 파일이 없다 — 그것을 "오늘 쓴 돈 0" 으로 읽어도 되는가.**
 *
 *    장부 저장소는 없는 파일을 빈 장부로 읽는다. 그래서 오늘 파일을 옮기거나 지우면
 *    그날 쓴 것이 0 으로 돌아가 **새 하루 예산**이 열렸다(A4 진단 §5 ②). 이력 쪽은 이미
 *    "어제 파일 없음 → 보수 기본값" 으로 fail-closed 인데, 오늘 파일에는 같은 규칙이 없었다.
 *
 *    **오늘 파일이 없는 것이 정상인 경우** — 전부 허용한다:
 *      ① 최근 `SCHEDULED_COST_LOOKBACK_DAYS` 일 장부가 하나도 없다 — 새 장부이거나 오래 꺼져 있었다
 *      ② 오늘 첫 정기 슬롯 시각(06:15 KST) 전이다 — 자정 직후 · 이른 아침의 첫 호출
 *      ③ 이 요청이 **정기 회차**다 — 노트북이 아침 슬롯 동안 꺼져 있었던 날, 정기 회차가 그날 첫 줄을 연다
 *    그 밖(최근 장부가 있고 · 첫 슬롯 시각이 지났고 · 손 실행)은 **보류**다 — 호출부가 `LEDGER_ERROR` 로 막고
 *    오늘 파일을 만들지 않는다(만들면 다음 요청부터는 "있는 파일" 이 되어 규칙이 한 번만 걸린다).
 *
 *    🔴 **잃는 것** — 아침 슬롯 동안 노트북이 꺼져 있던 날, 그날 첫 정기 회차가 돌기 전의 손 실행은 막힌다
 *       (23:00 전 손 실행 몫은 원래 거의 0 이라 실제로 잃는 것은 작다). 정기 회차가 하루 종일 한 번도
 *       못 돈 날에는 23:00 이후 손 실행도 막힌다. 검사(`supply:reserve-check` ⓙ)가 이 경계를 값으로 적는다.
 *    🔴 **남는 빈틈** — 사람이 오늘 파일과 최근 7일 파일을 **모두** 옮기면 ① 로 허용된다. 그때도 이력이 없어
 *       몫은 보수 기본값이라 23:00 전 손 실행 몫은 0 이다. 오늘 파일만 지운 뒤 다음 **정기** 회차가 새 파일을
 *       열면 그 회차는 자기 몫 + 손 실행 몫을 새 장부 기준으로 쓴다 — 실수로는 생기지 않는 경로라 적어 둔다.
 */
export function missingTodayLedgerVerdict(input: {
  now: Date
  todayExists: boolean
  /** 어제부터 `SCHEDULED_COST_LOOKBACK_DAYS` 일 중 하나라도 장부 파일이 있다 */
  recentDaysExist: boolean
  kind: SupplyRunKind
  slots?: readonly SlotKst[]
}): MissingTodayVerdict {
  if (input.todayExists) return { ok: true, why: '오늘 장부가 있다' }
  if (!input.recentDaysExist) {
    return { ok: true, why: `최근 ${SCHEDULED_COST_LOOKBACK_DAYS}일 장부가 없다 — 새 장부(또는 오래 꺼져 있었다)로 본다` }
  }
  const slots = input.slots ?? SUPPLY_RUN_SLOTS_KST
  const today0 = kstMidnightMs(input.now)
  const firstStart = Math.min(...slots.map((s) => today0 + (s.hour * 60 + s.minute) * 60_000))
  if (!Number.isFinite(firstStart) || input.now.getTime() < firstStart) {
    return { ok: true, why: '오늘 첫 정기 슬롯 전이다 — 오늘 첫 호출이 파일을 연다' }
  }
  if (input.kind === 'scheduled') {
    return { ok: true, why: '정기 회차가 오늘 첫 줄을 연다 — 아침 슬롯 동안 꺼져 있었던 날' }
  }
  return {
    ok: false,
    reason: '오늘 공급 장부 파일이 없다 — 최근 장부는 있고 오늘 첫 정기 슬롯 시각이 지났다.'
      + ' 🔴 파일이 옮겨졌거나 지워졌을 수 있어 "오늘 쓴 돈 0" 으로 읽지 않는다(손 실행 보류).'
      + ' 다음 정기 회차가 오늘 장부를 열면 풀린다',
  }
}

// ─────────────────────────────────────────────────────────
// 실측 — 🔴 장부 줄의 `runKind`/`runSlot` 만 믿는다
// ─────────────────────────────────────────────────────────

/** 🔴 한 줄이 여력에서 차지하는 금액 — `tallyOf` 와 같은 규칙(정산이면 정산액 · 열린 예약이면 예약액) */
function spendOf(e: LedgerEntry): number {
  if (e.stage === 'countTokens' || e.status === 'blocked') return 0
  if (e.status === 'settled' && e.settledUsd !== null) return e.settledUsd
  return e.reservedUsd ?? 0
}

const isScheduledTag = (e: LedgerEntry): e is LedgerEntry & { runSlot: string } =>
  e.runKind === 'scheduled' && typeof e.runSlot === 'string' && e.runSlot !== ''

export type ScheduledRunSample = { slot: string; usd: number }

/**
 * 🔴 **정산이 끝난 정기 슬롯 회차의 실측 비용.** 한 슬롯의 판정(-j)·초안(-d) 회차를 합친다.
 *
 *    표본에서 빼는 것 — 전부 "실제 한 회차 비용" 을 과소·왜곡하는 경우다.
 *      · 오늘 슬롯(하루 안에서 몫이 흔들리지 않게) · 창이 아직 끝나지 않은 슬롯(도는 중)
 *      · 미정산(`reserved` · `usageUnknown`)이 남은 슬롯 — 금액을 모른다
 *      · 막힌 요청이 있는 슬롯 — 예산·몫·상한에 잘려 실제보다 적게 썼다
 *      · 사람이 마감한 줄이 있는 슬롯 — 사고 회차다
 *      · 기간(`lookbackDays`) 밖 슬롯
 *
 * 🔴 **사람이 마감한 줄은 표식이 없어도 잡는다 (2026-09-29 3차).**
 *    `supply:ledger-resolve` 가 적는 마감 줄은 앞판에서 `runKind`/`runSlot` 을 싣지 않았다. 접으면 그 줄이
 *    예약 줄을 **이기므로** 표식이 사라지고, "사람이 마감한 슬롯은 뺀다" 는 규칙이 운영에서 한 번도 걸리지
 *    않았다(죽은 게이트 — 실제 resolve 경로로 재현). 게다가 그 건의 금액이 슬롯 합에서 빠져 그 슬롯이
 *    **실제보다 싸게** 표본이 됐다. 이제 resolve 가 원래 줄의 표식을 옮겨 적고, 여기서는 표식이 없는
 *    마감 줄도 그 요청의 `startedAt` 이 들어가는 슬롯 창으로 뺀다 — 정기 요청의 `startedAt` 은 정의상
 *    제 슬롯 창 안이다(판정이 그 시각으로 정기를 정했다). 같은 창의 손 실행 마감이면 정기 슬롯 하나를
 *    괜히 버리는 쪽으로 틀린다(표본이 줄면 보수 기본값 쪽이다).
 *    `startedAt` 을 읽지 못하면 어느 슬롯인지 모른다 → **표본 전부를 버린다**(보수 기본값으로 간다).
 */
export function scheduledRunSamples(input: {
  entries: readonly LedgerEntry[]
  now: Date
  windowMs?: number
  lookbackDays?: number
  slots?: readonly SlotKst[]
}): ScheduledRunSample[] {
  const windowMs = input.windowMs ?? SCHEDULED_RUN_WINDOW_MS
  const lookback = input.lookbackDays ?? SCHEDULED_COST_LOOKBACK_DAYS
  const slots = input.slots ?? SUPPLY_RUN_SLOTS_KST
  const today0 = kstMidnightMs(input.now)
  const oldest0 = today0 - lookback * DAY_MS
  const bySlot = new Map<string, { usd: number; tainted: boolean; paid: number }>()
  /** 🔴 표식 없는 사람 마감 줄이 가리키는 슬롯 */
  const humanSlots = new Set<string>()
  for (const e of input.entries) {
    if (e.resolvedBy === 'human' && !isScheduledTag(e)) {
      const at = Date.parse(e.startedAt)
      if (!Number.isFinite(at)) return []
      const w = activeSlotAt(new Date(at), slots, windowMs)
      if (w !== null) humanSlots.add(w.label)
    }
    if (!isScheduledTag(e) || e.stage === 'countTokens') continue
    const g = bySlot.get(e.runSlot) ?? { usd: 0, tainted: false, paid: 0 }
    if (e.status === 'blocked') g.tainted = true
    else if (e.status !== 'settled' || e.settledUsd === null) g.tainted = true
    else { g.usd += e.settledUsd; g.paid += 1 }
    if (e.resolvedBy === 'human') g.tainted = true
    bySlot.set(e.runSlot, g)
  }
  const out: ScheduledRunSample[] = []
  for (const [slot, g] of bySlot) {
    const start = slotStartMsOf(slot)
    if (humanSlots.has(slot)) continue
    if (start === null || g.tainted || g.paid === 0) continue
    if (start + windowMs > input.now.getTime()) continue
    // 🔴 어제까지만 — 오늘 슬롯은 표본이 아니다
    if (start < oldest0 || start >= today0) continue
    out.push({ slot, usd: g.usd })
  }
  return out.sort((a, b) => a.slot.localeCompare(b.slot))
}

export type ShareDecision = {
  usd: number
  source: 'measured' | 'fallback'
  samples: number
  why: string
}

/**
 * 🔴 **슬롯 몫 하나.** 표본 평균을 `[바닥, 천장]` 안에 둔다. 표본이 모자라거나 읽지 못했으면 기본값.
 *    `samples === null` = 장부 이력을 읽지 못했다 → 기본값(모르는 것은 크게 떼어 둔다).
 */
export function scheduledShareFrom(samples: readonly ScheduledRunSample[] | null, minSamples: number = SCHEDULED_COST_MIN_SAMPLES): ShareDecision {
  const floor = measuredShareFloorUsd()
  const cap = conservativeShareUsd()
  if (samples === null) {
    return { usd: cap, source: 'fallback', samples: 0, why: `정기 실측 이력을 읽지 못했다 — 보수 기본값(회차 상한) $${cap.toFixed(4)}` }
  }
  if (samples.length < minSamples) {
    return {
      usd: cap, source: 'fallback', samples: samples.length,
      why: `정기 실측 ${samples.length}회 < ${minSamples}회 — 보수 기본값(회차 상한) $${cap.toFixed(4)}`,
    }
  }
  const mean = samples.reduce((s, x) => s + x.usd, 0) / samples.length
  if (!Number.isFinite(mean)) {
    return { usd: cap, source: 'fallback', samples: samples.length, why: `정기 실측 평균을 계산하지 못했다 — 보수 기본값 $${cap.toFixed(4)}` }
  }
  const usd = Math.min(cap, Math.max(floor, mean))
  return {
    usd, source: 'measured', samples: samples.length,
    why: `정기 실측 ${samples.length}회 평균 $${mean.toFixed(4)}`
      + (usd === mean ? '' : ` → [$${floor.toFixed(4)}, $${cap.toFixed(4)}] 안으로 $${usd.toFixed(4)}`),
  }
}

// ─────────────────────────────────────────────────────────
// 배분 — 🔴 남은 슬롯 몫 · 비례 축소 · 이월
// ─────────────────────────────────────────────────────────

export type SlotAllocation = {
  label: string
  /** 비례 축소 뒤의 몫 */
  shareUsd: number
  /** 그 슬롯의 정기 회차가 오늘 이미 쓴 것(정산 + 열린 예약) */
  spentUsd: number
  /** 아직 지켜 줄 몫 = max(0, 몫 − 쓴 것) */
  claimUsd: number
}

export type ScheduledAllocation = {
  /** 오늘 정기 몫 전체 — proof-first는 천장 전부, 저예산 profile은 기존 7회 동적 몫 */
  poolUsd: number
  /** 남은 슬롯이 받을 몫 — proof-first 고정 몫 또는 기존 동적 몫에서 사용액을 반영한 값 */
  entitlementUsd: number
  /** 남은 슬롯이 실제로 쓸 수 있는 여력 = 천장 − 남은 슬롯 밖에서 쓴 것 (0 이상) */
  basisUsd: number
  /** 비례 배율 = min(받을 몫, 여력) / 받을 몫 (≤ 1) */
  scale: number
  slots: SlotAllocation[]
  /** 🔴 이 요청이 건드릴 수 없는 몫 — 손 실행이면 전부, 정기 회차면 자기 슬롯을 뺀 나머지 */
  reservedForOthersUsd: number
}

/**
 * 🔴 **남은 정기 슬롯에 몫을 배분한다.**
 *
 *    `capUsd` 는 `min(env 하루 예산, 계약 천장)` 이다. `todayEntries` 는 **오늘 장부 전체**(잠금 안에서 읽은 것).
 *    `ownSlot` 은 이 요청이 정기 회차면 그 슬롯 이름, 손 실행이면 `null`.
 *
 *    ① D20 승인 천장 전액이 적용되면 오늘 정기 몫 전체 P = 천장이다. 더 낮은 운영 예산에서는
 *       기존 몫 계산을 유지해 단계 전환 전 동작을 바꾸지 않는다.
 *    ② proof-first 예산에서 증명 슬롯 하나의 몫은 하루 시작부터 P / 전체 증명 슬롯 수로 고정한다.
 *       끝난 슬롯이 못 쓴 몫은 이후 먼저 도착한 event·복구·정기 회차가 쓸 수 있고, 남은 증명 슬롯 몫은 줄지 않는다.
 *       21:15·22:15는 증명 슬롯이 모두 끝날 때까지 몫이 0이다. 그 뒤 남은 P를 나눠 갖는다.
 *    ③ 실제 여력 B = 천장 − (현재 우선순위 슬롯 밖에서 쓴 것). 현재 우선순위 슬롯이 이미 쓴 금액은
 *       자기 몫에서만 빠진다.
 *    ④ 슬롯 몫 = B / 현재 우선순위 슬롯 수. 슬롯 j 의 남은 몫 = max(0, 슬롯 몫 − 그 슬롯이 쓴 것).
 */
export function allocateScheduledReserve(input: {
  pending: readonly SlotWindow[]
  /** 오늘 창이 이미 끝난 슬롯 — 시각 순서 */
  ended: readonly SlotWindow[]
  shareUsd: number
  capUsd: number
  todayEntries: readonly LedgerEntry[]
  ownSlot: string | null
  /** 당일 공개 목표를 증명하는 앞 슬롯. 남아 있는 동안 늦은 슬롯보다 먼저 예산을 보호한다. */
  proofSlots?: readonly SlotKst[]
}): ScheduledAllocation {
  let used = 0
  const spentBySlot = new Map<string, number>()
  for (const e of input.todayEntries) {
    const s = spendOf(e)
    used += s
    if (s !== 0 && isScheduledTag(e)) spentBySlot.set(e.runSlot, (spentBySlot.get(e.runSlot) ?? 0) + s)
  }
  const proofMinutes = new Set((input.proofSlots ?? SUPPLY_PROOF_RUN_SLOTS_KST).map((s) => s.hour * 60 + s.minute))
  const isProof = (label: string): boolean => {
    const m = / (\d{2}):(\d{2})$/.exec(label)
    return m !== null && proofMinutes.has(Number(m[1]) * 60 + Number(m[2]))
  }
  const proofFirst = input.capUsd >= SUPPLY_PROOF_FIRST_DAILY_USD
  const pendingProof = input.pending.filter((w) => isProof(w.label))
  const priority = proofFirst && pendingProof.length > 0 ? pendingProof : [...input.pending]
  const priorityLabels = new Set(priority.map((w) => w.label))
  const prioritySpent = priority.reduce((sum, w) => sum + (spentBySlot.get(w.label) ?? 0), 0)
  const k = priority.length
  const pool = proofFirst
    ? Math.max(0, input.capUsd)
    : Math.max(0, Math.min(input.capUsd, (input.ended.length + input.pending.length) * input.shareUsd))
  let entitlement: number
  let basis: number
  let scale: number
  let perSlot: number
  if (proofFirst && pendingProof.length > 0) {
    basis = Math.max(0, input.capUsd - (used - prioritySpent))
    const proofShare = proofMinutes.size === 0 ? 0 : input.capUsd / proofMinutes.size
    entitlement = k * proofShare
    const pendingPool = Math.min(entitlement, basis)
    scale = entitlement > 0 ? pendingPool / entitlement : 1
    perSlot = k === 0 ? 0 : pendingPool / k
  } else if (proofFirst) {
    basis = Math.max(0, input.capUsd - (used - prioritySpent))
    entitlement = k === 0 ? 0 : basis
    scale = 1
    perSlot = k === 0 ? 0 : basis / k
  } else {
    let rest = pool
    input.ended.forEach((w, i) => {
      const slotShare = rest / (input.ended.length - i + k)
      rest -= Math.min(spentBySlot.get(w.label) ?? 0, slotShare)
    })
    entitlement = k === 0 ? 0 : Math.max(0, rest)
    basis = Math.max(0, input.capUsd - (used - prioritySpent))
    const pendingPool = Math.min(entitlement, basis)
    scale = entitlement > 0 ? pendingPool / entitlement : 1
    perSlot = k === 0 ? 0 : pendingPool / k
  }
  const slots = input.pending.map((w) => {
    const spentUsd = spentBySlot.get(w.label) ?? 0
    const shareUsd = priorityLabels.has(w.label) ? perSlot : 0
    return { label: w.label, shareUsd, spentUsd, claimUsd: Math.max(0, shareUsd - spentUsd) }
  })
  const reservedForOthersUsd = slots
    .filter((s) => s.label !== input.ownSlot)
    .reduce((sum, s) => sum + s.claimUsd, 0)
  return { poolUsd: pool, entitlementUsd: entitlement, basisUsd: basis, scale, slots, reservedForOthersUsd }
}

/**
 * 🔴 **이 요청에 적용할 보호 조건.** 순수 함수 — env · 시각 · 장부 줄을 **받는다**.
 *
 *    손 실행:  남은 정기 슬롯 **전부**의 남은 몫을 떼어 두고, 천장은 계약 천장이다.
 *              계약 천장이 미승인(`null`)이면 0 이다 — 손 실행은 아무것도 못 쓴다(fail-closed).
 *    정기 회차: **자기 말고** 남은 슬롯들의 남은 몫을 떼어 둔다. 천장은 계약 천장(미승인이면 env 만).
 *
 *    `historyEntries` — 어제까지 `SCHEDULED_COST_LOOKBACK_DAYS` 일 장부 줄(오늘 줄이 섞여 있어도 표본에서 뺀다). `null` 이면 이력을 읽지
 *    못한 것이다 → 보수 기본값. `shareUsd` 를 주면 실측 대신 그 값을 쓴다(시험 전용).
 */
export function supplySpendProtectAt(input: {
  env: Readonly<Record<string, string | undefined>>
  now: Date
  /** 오늘 장부 줄 — 없으면 빈 장부 */
  todayEntries?: readonly LedgerEntry[]
  /** 어제까지의 장부 줄 — `null`/없음이면 이력 없음 → 보수 기본값 */
  historyEntries?: readonly LedgerEntry[] | null
  /** env 하루 예산 — `null`/없음이면 계약 천장만 본다(그때 장부 판정은 어차피 `NO_BUDGET`) */
  dailyUsd?: number | null
  slots?: readonly SlotKst[]
  windowMs?: number
  shareUsd?: number
  ceilingUsd?: number | null
  /**
   * 🔴 이 회차가 **실제로 시작한** 가장 이른 시각 — `supplyRunKindOf` 의 잠·늦은 복귀 규칙.
   *    `null` 은 모름(→ 수동). 없으면(`undefined`) 요청 시각과 같다고 본다(순수 계산·시험용).
   */
  runStartedAt?: Date | null
}): { kind: SupplyRunKind; why: string; slot: string | null; share: ShareDecision; allocation: ScheduledAllocation; protect: SpendProtect } {
  const slots = input.slots ?? SUPPLY_RUN_SLOTS_KST
  const windowMs = input.windowMs ?? SCHEDULED_RUN_WINDOW_MS
  const k = supplyRunKindOf(input.env, input.now, slots, windowMs, input.runStartedAt)
  const pending = pendingSlotsAt(input.now, slots, windowMs)
  const share: ShareDecision = input.shareUsd !== undefined
    ? { usd: input.shareUsd, source: 'measured', samples: 0, why: `주어진 몫 $${input.shareUsd.toFixed(4)}` }
    : scheduledShareFrom(input.historyEntries === undefined || input.historyEntries === null
      ? null
      : scheduledRunSamples({ entries: input.historyEntries, now: input.now, windowMs, slots }))
  const contract = input.ceilingUsd === undefined ? SUPPLY_DAILY_USD_APPROVED : input.ceilingUsd
  // 🔴 손 실행은 천장 미승인을 0 으로 읽는다. 정기 회차는 천장이 없으면 env 예산만 본다(앞판 그대로)
  const ceiling: number | null = k.kind === 'manual' ? (contract ?? 0) : contract
  const daily = input.dailyUsd ?? null
  const capUsd = ceiling === null ? (daily ?? 0) : daily === null ? ceiling : Math.min(daily, ceiling)
  const allocation = allocateScheduledReserve({
    pending, ended: endedSlotsAt(input.now, slots, windowMs),
    shareUsd: share.usd, capUsd, todayEntries: input.todayEntries ?? [], ownSlot: k.slot,
    proofSlots: supplyProofRunSlots(slots, windowMs),
  })
  const others = allocation.slots.filter((s) => s.label !== k.slot)
  const protectedOthers = others.filter((s) => s.claimUsd > 0)
  return {
    ...k, share, allocation,
    protect: {
      reservedForOthersUsd: allocation.reservedForOthersUsd,
      ceilingUsd: ceiling,
      reason: `${k.kind === 'scheduled' ? '다른' : '남은'} 우선 정기 슬롯 ${protectedOthers.length}개 몫 $${allocation.reservedForOthersUsd.toFixed(4)}`
        + (protectedOthers.length === 0 ? '' : ` (${protectedOthers.map((s) => `${s.label.slice(11)} $${s.claimUsd.toFixed(4)}`).join(' · ')})`)
        + ` · 슬롯 몫 $${share.usd.toFixed(4)} · 오늘 정기 몫 전체 $${allocation.poolUsd.toFixed(4)}`
        + ` · 현재 우선 슬롯 권리 $${allocation.entitlementUsd.toFixed(4)}`
        + `${allocation.scale < 1 ? ` × 배율 ${allocation.scale.toFixed(3)}` : ''}`
        + ` [${share.why}]`
        + ` · 천장 $${(ceiling ?? capUsd).toFixed(2)} · ${k.why}`,
    },
  }
}
