/**
 * 정기 공급 회차 몫 보호 — 🔴 **순수 판정. 파일·네트워크·env 읽기 0**
 *
 * 막는 사고 (2026-09-28 실측):
 *   손으로 돌린 공급 회차 17번이 하루 예산을 먼저 다 썼고, 그 뒤 정기 회차는 요청마다 `DAILY_EXHAUSTED`
 *   로 막혀 초안이 0건이었다. 장부는 "누가 먼저 왔는가"만 봤고, 하루 생산의 근거인 정기 회차의 몫을
 *   아무도 지키지 않았다.
 *
 * 규칙 하나 — **남은 예산 ÷ 남은 회차** (`allocateScheduledReserve`):
 *   오늘 아직 끝나지 않은 정기 회차(바퀴마다 하나 · `SUPPLY_RUN_SLOTS_KST`)가 남은 하루 예산을 똑같이 나눠 갖는다.
 *   · 정기 회차는 자기 몫만 쓴다 — 뒤 회차의 몫을 남긴다. 덜 쓴 몫은 뒤 회차들에 똑같이 넘어간다.
 *   · 손 실행(수동 · 창 밖 kickstart · 잠에서 깬 회차)은 남은 회차 전부의 몫을 남긴 나머지만 쓴다.
 *   · 마지막 회차의 창이 끝나면 남은 예산이 풀린다.
 *   하루 총액은 여기서 정하지 않는다 — `min(env 하루 예산, 날짜별 계약 천장)` 이다.
 *
 * 🔴 **정기 회차를 무엇으로 아는가 — 호출자가 넘기는 인자가 아니다.**
 *    launchd 는 자기가 띄운 프로세스에 `XPC_SERVICE_NAME=<job label>` 을 넣는다.
 *    공급 job 은 `stage-consume-exec` → `supply-process` → 판정·초안 자식으로 env 를 그대로 물려준다.
 *    · `--trigger=...` 같은 **인자**나 `SORAN_*` env 는 보지 않는다 — 손으로 넣을 수 있는 칸이다.
 *    · 라벨은 **정확히 공급 job 하나**여야 한다. 다른 soransoran job(댓글 러너 등)은 정기 공급이 아니다.
 *    · 라벨이 맞아도 **회차 창 밖이면 수동**이다 — 아무 때나 kickstart 로 띄운 회차나
 *      잠에서 깬 뒤 늦게 뜬 회차가 정기 몫을 쓰지 못하게 한다. 요청 시각은 **벽시계**다.
 *    · 요청 시각뿐 아니라 **회차 시작 시각**도 같은 창이어야 한다(`supplyRunKindOf`).
 *    · 표식이 없거나 모르면 **수동**이다(fail-closed — 떼어 둔 몫을 지키는 쪽).
 *    🔴 남는 빈틈: 사람이 일부러 `XPC_SERVICE_NAME=com.soransoran.supply-process` 를 적고
 *       회차 창 안에서 손으로 돌리면 정기로 보인다. 실수로는 생기지 않는 경로다 — 숨기지 않고 적는다.
 */

import { SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS, type SupplyRunSlot } from './supply-schedule-contract'
import type { LedgerEntry, SpendProtect } from './llm-ledger'
import { supplyApprovedDailyUsdOf } from './supply-cost-envelope'

export type { SpendProtect }

/** 🔴 launchd 가 넣는 env 이름 — 이 값을 호출자가 정하지 않는다 */
export const LAUNCHD_LABEL_ENV = 'XPC_SERVICE_NAME'

/** 🔴 정기 공급 job 의 label — `com.soransoran.supply-process.plist.template` 의 `Label` 과 같아야 한다(검사가 대조) */
export const SUPPLY_PROCESS_LAUNCHD_LABEL = 'com.soransoran.supply-process'

/** 회차 하나의 창 — 정본은 `SUPPLY_RUN_WINDOW_MS`. 창이 끝나면 회차가 돌았든 안 돌았든 그 몫을 푼다 */
export const SCHEDULED_RUN_WINDOW_MS = SUPPLY_RUN_WINDOW_MS

/** 오늘 장부 파일이 없을 때 "최근 장부가 있었는가"를 보는 기간(일) — `missingTodayLedgerVerdict` 의 ① */
export const SCHEDULED_COST_LOOKBACK_DAYS = 7

export type SlotKst = SupplyRunSlot

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
 *    그 회차의 요청은 **오늘 장부**에 적힌다. 지금 마지막 회차의 창은 자정을 넘지 않지만
 *    바퀴 시각을 옮기는 날 조용히 틀리지 않게 둔다.
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
 *    · 오늘 KST 날짜 기준이다. 자정이 지나면 새 날의 회차 전부가 다시 잡힌다(장부 파일도 새 날이다).
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
 * 🔴 **정기 회차인가.** 라벨이 공급 job **정확히 하나**이고, 요청 시각과 **회차 시작 시각**이
 *    **같은 슬롯 창 안**일 때만이다. 그 밖은 전부 수동이다 — 표식이 없음 · 다른 job · 창 밖 kickstart ·
 *    늦게 뜬 launchd 회차 · 창 안에서 시작했지만 잠들었다가 **다른 창에서 깨어난** 회차.
 *
 * 🔴 **잠·늦은 복귀 규칙** — 요청 시각만 보면 두 가지가 샌다(2026-09-29 실측 재현):
 *    ① 아침 회차가 시작 직후 잠들었다 점심 회차 창에서 깨면, 그 회차의 남은 요청이 **점심 회차 몫**으로
 *       정기 판정을 받았다 — 제 회차가 아닌 몫을 먹고, 점심 정기 회차가 굶는다.
 *    ② 회차 시각 몇 분 전에 kickstart 로 뜬 회차가 회차 시각을 넘기면 그 뒤 요청이 그 회차 몫을 받았다.
 *    그래서 `runStartedAt`(회차가 **실제로 시작한** 가장 이른 시각)도 같은 창이어야 한다.
 *    · 창이 다르거나 시작 시각이 창 밖 → 순수 예산 보호 계산에서는 **수동**이다. 다만 공급 launchd 라벨로
 *      시작한 운영 세션은 처음부터 창 밖이거나 자기 창이 끝난 뒤면 새 유료 요청을 시작하지 않는다
 *      (`SupplyLlmSession`) — 다음 자연 슬롯이 이어받는다. launchd 라벨이 없는 진짜 손 실행만 수동 몫 규칙을 쓴다.
 *    · `runStartedAt === null` = 시작 시각을 **모른다**(깨진 `SORAN_RUN_AT` 등) → 순수 예산 계산은 수동.
 *      운영 `SupplyLlmSession`은 부모 값이 있었는데 깨진 경우 호출 시작 전에 hard block 한다.
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
 *    그날 쓴 것이 0 으로 돌아가 **새 하루 예산**이 열렸다(A4 진단 §5 ②).
 *
 *    **오늘 파일이 없는 것이 정상인 경우** — 전부 허용한다:
 *      ① 최근 `SCHEDULED_COST_LOOKBACK_DAYS` 일 장부가 하나도 없다 — 새 장부이거나 오래 꺼져 있었다
 *      ② 오늘 첫 정기 회차 시각 전이다 — 자정 직후의 첫 호출
 *      ③ 이 요청이 **정기 회차**다 — 호스트가 앞 회차 동안 꺼져 있었던 날, 정기 회차가 그날 첫 줄을 연다
 *    그 밖(최근 장부가 있고 · 첫 회차 시각이 지났고 · 손 실행)은 **보류**다 — 호출부가 `LEDGER_ERROR` 로 막고
 *    오늘 파일을 만들지 않는다(만들면 다음 요청부터는 "있는 파일" 이 되어 규칙이 한 번만 걸린다).
 *
 *    🔴 **잃는 것** — 호스트가 꺼져 있다 켜진 날, 그날 첫 정기 회차가 돌기 전의 손 실행은 막힌다.
 *    🔴 **남는 빈틈** — 사람이 오늘 파일과 최근 7일 파일을 **모두** 옮기면 ① 로 허용된다. 오늘 파일만 지운 뒤
 *       다음 **정기** 회차가 새 파일을 열면 그 회차는 새 장부 기준으로 쓴다 — 실수로는 생기지 않는 경로라 적어 둔다.
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
    return { ok: true, why: '오늘 첫 정기 회차 전이다 — 오늘 첫 호출이 파일을 연다' }
  }
  if (input.kind === 'scheduled') {
    return { ok: true, why: '정기 회차가 오늘 첫 줄을 연다 — 앞 회차 동안 꺼져 있었던 날' }
  }
  return {
    ok: false,
    reason: '오늘 공급 장부 파일이 없다 — 최근 장부는 있고 오늘 첫 정기 회차 시각이 지났다.'
      + ' 🔴 파일이 옮겨졌거나 지워졌을 수 있어 "오늘 쓴 돈 0" 으로 읽지 않는다(손 실행 보류).'
      + ' 다음 정기 회차가 오늘 장부를 열면 풀린다',
  }
}

// ─────────────────────────────────────────────────────────
// 배분 — 🔴 남은 예산 ÷ 남은 회차
// ─────────────────────────────────────────────────────────

/** 🔴 한 줄이 여력에서 차지하는 금액 — `tallyOf` 와 같은 규칙(정산이면 정산액 · 열린 예약이면 예약액) */
function spendOf(e: LedgerEntry): number {
  if (e.stage === 'countTokens' || e.status === 'blocked') return 0
  if (e.status === 'settled' && e.settledUsd !== null) return e.settledUsd
  return e.reservedUsd ?? 0
}

const isScheduledTag = (e: LedgerEntry): e is LedgerEntry & { runSlot: string } =>
  e.runKind === 'scheduled' && typeof e.runSlot === 'string' && e.runSlot !== ''

export type SlotAllocation = {
  label: string
  /** 이 회차의 몫 = 남은 예산 ÷ 남은 회차 */
  shareUsd: number
  /** 그 회차가 오늘 이미 쓴 것(정산 + 열린 예약) */
  spentUsd: number
  /** 아직 지켜 줄 몫 = max(0, 몫 − 쓴 것) */
  claimUsd: number
}

export type ScheduledAllocation = {
  /** 남은 회차가 나눠 갖는 예산 = 천장 − 남은 회차 밖에서 쓴 것(끝난 회차 · 손 실행). 0 이상 */
  basisUsd: number
  /** 회차 하나의 몫 = `basisUsd` ÷ 남은 회차 수. 남은 회차가 없으면 0 */
  shareUsd: number
  slots: SlotAllocation[]
  /** 🔴 이 요청이 건드릴 수 없는 몫 — 손 실행이면 전부, 정기 회차면 자기 회차를 뺀 나머지 */
  reservedForOthersUsd: number
}

/**
 * 🔴 **남은 예산을 남은 정기 회차에 똑같이 나눈다.**
 *
 *    `capUsd` 는 `min(env 하루 예산, 계약 천장)` 이다. `todayEntries` 는 **오늘 장부 전체**(잠금 안에서 읽은 것).
 *    `ownSlot` 은 이 요청이 정기 회차면 그 회차 이름, 손 실행이면 `null`.
 *
 *    ① 나눌 예산 B = 천장 − (남은 회차 밖에서 쓴 것). 남은 회차가 이미 쓴 금액은 자기 몫에서만 빠진다.
 *    ② 회차 몫 = B ÷ 남은 회차 수. 회차 j 의 남은 몫 = max(0, 회차 몫 − 그 회차가 쓴 것).
 *    회차 수가 바뀌어도(13 → 다른 값) 이 식은 그대로다 — 회차 수를 여기 적지 않는다.
 */
export function allocateScheduledReserve(input: {
  pending: readonly SlotWindow[]
  capUsd: number
  todayEntries: readonly LedgerEntry[]
  ownSlot: string | null
}): ScheduledAllocation {
  let used = 0
  const spentBySlot = new Map<string, number>()
  for (const e of input.todayEntries) {
    const s = spendOf(e)
    used += s
    if (s !== 0 && isScheduledTag(e)) spentBySlot.set(e.runSlot, (spentBySlot.get(e.runSlot) ?? 0) + s)
  }
  const k = input.pending.length
  const pendingSpent = input.pending.reduce((sum, w) => sum + (spentBySlot.get(w.label) ?? 0), 0)
  const cap = Number.isFinite(input.capUsd) ? Math.max(0, input.capUsd) : 0
  const basisUsd = Math.max(0, cap - (used - pendingSpent))
  const shareUsd = k === 0 ? 0 : basisUsd / k
  const slots = input.pending.map((w) => {
    const spentUsd = spentBySlot.get(w.label) ?? 0
    return { label: w.label, shareUsd, spentUsd, claimUsd: Math.max(0, shareUsd - spentUsd) }
  })
  const reservedForOthersUsd = slots
    .filter((s) => s.label !== input.ownSlot)
    .reduce((sum, s) => sum + s.claimUsd, 0)
  return { basisUsd, shareUsd, slots, reservedForOthersUsd }
}

/**
 * 🔴 **이 요청에 적용할 보호 조건.** 순수 함수 — env · 시각 · 장부 줄을 **받는다**.
 *
 *    손 실행:  남은 정기 회차 **전부**의 남은 몫을 떼어 두고, 천장은 계약 천장이다.
 *              계약 천장이 미승인(`null`)이면 0 이다 — 손 실행은 아무것도 못 쓴다(fail-closed).
 *    정기 회차: **자기 말고** 남은 회차들의 남은 몫을 떼어 둔다. 천장은 계약 천장(미승인이면 env 만).
 */
export function supplySpendProtectAt(input: {
  env: Readonly<Record<string, string | undefined>>
  now: Date
  /** 오늘 장부 줄 — 없으면 빈 장부 */
  todayEntries?: readonly LedgerEntry[]
  /** env 하루 예산 — `null`/없음이면 계약 천장만 본다(그때 장부 판정은 어차피 `NO_BUDGET`) */
  dailyUsd?: number | null
  slots?: readonly SlotKst[]
  windowMs?: number
  ceilingUsd?: number | null
  /**
   * 🔴 이 회차가 **실제로 시작한** 가장 이른 시각 — `supplyRunKindOf` 의 잠·늦은 복귀 규칙.
   *    `null` 은 모름(→ 수동). 없으면(`undefined`) 요청 시각과 같다고 본다(순수 계산·시험용).
   */
  runStartedAt?: Date | null
}): { kind: SupplyRunKind; why: string; slot: string | null; allocation: ScheduledAllocation; protect: SpendProtect } {
  const slots = input.slots ?? SUPPLY_RUN_SLOTS_KST
  const windowMs = input.windowMs ?? SCHEDULED_RUN_WINDOW_MS
  const k = supplyRunKindOf(input.env, input.now, slots, windowMs, input.runStartedAt)
  const pending = pendingSlotsAt(input.now, slots, windowMs)
  // 🔴 천장은 요청 시각의 KST 날짜 계약이 정한다(장부 기록 · preflight 와 같은 정본 `supplyApprovedDailyUsdOf`)
  const contract = input.ceilingUsd === undefined
    ? supplyApprovedDailyUsdOf(new Date(input.now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10))
    : input.ceilingUsd
  // 🔴 손 실행은 천장 미승인을 0 으로 읽는다. 정기 회차는 천장이 없으면 env 예산만 본다
  const ceiling: number | null = k.kind === 'manual' ? (contract ?? 0) : contract
  const daily = input.dailyUsd ?? null
  const capUsd = ceiling === null ? (daily ?? 0) : daily === null ? ceiling : Math.min(daily, ceiling)
  const allocation = allocateScheduledReserve({
    pending, capUsd, todayEntries: input.todayEntries ?? [], ownSlot: k.slot,
  })
  const protectedOthers = allocation.slots.filter((s) => s.label !== k.slot && s.claimUsd > 0)
  return {
    ...k, allocation,
    protect: {
      reservedForOthersUsd: allocation.reservedForOthersUsd,
      ceilingUsd: ceiling,
      // ▸ 사람이 읽는 한 줄 — 남은 예산을 남은 회차 몇 개가 얼마씩 나누는가
      reason: `남은 예산 $${allocation.basisUsd.toFixed(4)} ÷ 남은 회차 ${allocation.slots.length}개 = 회차 몫 $${allocation.shareUsd.toFixed(4)}`
        + ` · ${k.kind === 'scheduled' ? '다른' : '남은'} 회차 ${protectedOthers.length}개 몫 $${allocation.reservedForOthersUsd.toFixed(4)} 를 남긴다`
        + ` · 천장 $${(ceiling ?? capUsd).toFixed(2)} · ${k.why}`,
    },
  }
}
