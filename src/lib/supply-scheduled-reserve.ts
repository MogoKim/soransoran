/**
 * 정기 공급 회차 몫 보호 — 🔴 **순수 판정. 파일·네트워크·env 읽기 0** (2026-09-29)
 *
 * 🔴 **왜 이 파일이 생겼나 — 2026-09-28 실측.**
 *    손으로 돌린 공급 회차 17번이 하루 예산(env `SORAN_LLM_DAILY_BUDGET_USD`)을
 *    **먼저** 다 썼다. 그 뒤 정기 회차 14:15 · 17:15 · 21:15 · 22:15 는 요청마다
 *    `DAILY_EXHAUSTED` 로 막혀(77건) 초안이 0건이었다. 장부는 "누가 먼저 왔는가" 만 봤다 —
 *    정기 회차가 하루 생산의 근거인데, 그 몫을 아무도 지키지 않았다.
 *
 * 🔴 **2차 보정 (같은 날) — 고정 몫 $0.0464 로는 늦은 슬롯이 여전히 굶는다.**
 *    앞판은 슬롯 몫을 `estimateSupplySpend(10).expectedPerRun`(묶음 5 시절 09-24~27 단가로 만든 추정)
 *    하나로 고정했다. 묶음 10 이 된 뒤 실제 정기 회차(09-29 08:15 · 12:15 · 17:15)는
 *    **$0.0655 · $0.0992 · $0.0923** 을 썼다. 몫을 실제보다 작게 떼면, 앞 슬롯이 실제만큼 쓰는 동안
 *    뒤 슬롯의 몫이 모자라 22:15 가 막힌다. 더 큰 상수 하나로 바꾸는 것도 답이 아니다 —
 *    다음에 묶음·모델이 바뀌면 또 낡는다. 그래서 몫을 **장부의 최근 정기 회차 실측**에서 읽는다.
 *
 * 🔴 **무엇을 하는가 — 슬롯별 동적 배분.**
 *    ① 슬롯 몫(share) = **어제까지** `SCHEDULED_COST_LOOKBACK_DAYS` 일 동안 **정산이 끝난 정기 회차**의
 *       슬롯당 실측 평균(오늘 회차는 넣지 않는다 — 하루 안에서 몫이 흔들리지 않게).
 *       표본이 `SCHEDULED_COST_MIN_SAMPLES` 개 미만이면 **보수 기본값**
 *       `estimateSupplySpend(묶음).capPerRun`(회차 상한 — 꽉 찬 회차 최대 단가) 을 쓴다(fail-closed).
 *    ② 오늘 정기 몫 전체 P = min(천장, 6 × 몫). 천장 = min(env 하루 예산, 계약 천장 $0.50).
 *    ③ 끝난 슬롯은 **자기 몫 안에서 쓴 만큼만** P 에서 뺀다 — 덜 쓰거나 안 돈 몫은 남은 슬롯에
 *       **똑같이 이월**된다(손 실행으로 가지 않는다). 몫을 넘겨 쓴 것은 P 를 줄이지 않는다.
 *    ④ 남은 P 가 실제 여력(천장 − 남은 슬롯 밖에서 쓴 것)보다 크면 **비례로 줄인다** — 늦은 슬롯도 같은 비율.
 *    ⑤ 슬롯 j 의 남은 몫 = max(0, 슬롯 몫 − 그 슬롯이 이미 쓴 것(정산 + 열린 예약)).
 *    ⑥ 손 실행(수동 · commissioning · 창 밖 kickstart · 늦게 뜬 launchd)은 **남은 슬롯 전부**의
 *       남은 몫을 떼어 둔 나머지(= 천장 − P 안쪽, 마지막 슬롯 뒤에는 전부)만 쓴다.
 *    ⑦ 정기 회차(슬롯 i)는 **자기 말고 남은 슬롯**의 남은 몫을 떼어 둔 나머지를 쓴다 —
 *       자기 몫(이월 포함) + 손 실행 몫 중 남은 것. 뒤 슬롯의 몫은 건드리지 못한다.
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
 *      잠에서 깬 뒤 늦게 뜬 회차가 정기 몫을 쓰지 못하게 한다. 시각은 **벽시계**다. 부모가 넘기는
 *      `SORAN_RUN_AT` 을 쓰지 않는다(손 실행이 그 값을 08:15 로 적어 넣을 수 있다).
 *    · 표식이 없거나 모르면 **수동**이다(fail-closed — 떼어 둔 몫을 지키는 쪽).
 *    🔴 남는 빈틈: 사람이 일부러 `XPC_SERVICE_NAME=com.soransoran.supply-process` 를 적고
 *       슬롯 창 안에서 손으로 돌리면 정기로 보인다. 실수로는 생기지 않는 경로다 — 숨기지 않고 적는다.
 */

import {
  SUPPLY_DAILY_USD_APPROVED, SUPPLY_RUN_SLOTS_KST, SUPPLY_WORKSET_PER_RUN, estimateSupplySpend,
} from './supply-schedule-contract'
import { LOCK_TTL_MS } from './supply-process'
import type { LedgerEntry, SpendProtect } from './llm-ledger'

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
 *    묶어 두지 않는다(그 몫은 뒤 슬롯으로 이월된다).
 */
export const SCHEDULED_RUN_WINDOW_MS = LOCK_TTL_MS

/**
 * 🔴 **실측을 모으는 기간(일)** — 어제부터 뒤로 이만큼의 KST 날짜 장부를 읽는다(오늘은 넣지 않는다).
 *    묶음 크기·모델이 바뀌면 일주일 안에 새 값으로 넘어간다. 오늘을 빼는 이유 — 오늘 끝난 회차가 표본이 되면
 *    하루 중간에 몫(과 오늘 정기 몫 전체)이 바뀌어, 아침에 떼어 둔 뒤 슬롯 몫이 오후에 줄 수 있다.
 */
export const SCHEDULED_COST_LOOKBACK_DAYS = 7

/**
 * 🔴 **실측으로 인정하는 최소 표본(정기 슬롯 회차 수).** 이보다 적으면 보수 기본값이다.
 *    하루 6슬롯 중 절반 — 한두 회차의 우연한 값으로 몫을 정하지 않는다.
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
 *    표본이 모자라면 이 값으로 **크게** 떼어 둔다(fail-closed). 6슬롯 × 이 값은 하루 천장보다 커서
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
 * 🔴 **정기 회차인가.** 라벨이 공급 job **정확히 하나**이고 **슬롯 창 안**일 때만이다.
 *    그 밖은 전부 수동이다 — 표식이 없음 · 다른 job · 창 밖 kickstart · 늦게 뜬 launchd 회차.
 */
export function supplyRunKindOf(
  env: Readonly<Record<string, string | undefined>>, now: Date,
  slots: readonly SlotKst[] = SUPPLY_RUN_SLOTS_KST, windowMs: number = SCHEDULED_RUN_WINDOW_MS,
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
  return { kind: 'scheduled', slot: slot.label, why: `정기 슬롯 ${slot.label} 창 안` }
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
 */
export function scheduledRunSamples(input: {
  entries: readonly LedgerEntry[]
  now: Date
  windowMs?: number
  lookbackDays?: number
}): ScheduledRunSample[] {
  const windowMs = input.windowMs ?? SCHEDULED_RUN_WINDOW_MS
  const lookback = input.lookbackDays ?? SCHEDULED_COST_LOOKBACK_DAYS
  const today0 = kstMidnightMs(input.now)
  const oldest0 = today0 - lookback * DAY_MS
  const bySlot = new Map<string, { usd: number; tainted: boolean; paid: number }>()
  for (const e of input.entries) {
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
  /** 오늘 정기 몫 전체 = min(천장, 하루 슬롯 수 × 슬롯 몫) — 하루 시작에 정기 회차에게 떼어 둔 것 */
  poolUsd: number
  /** 남은 슬롯이 받을 몫 = 전체 − 끝난 슬롯이 실제로 쓴 것 (기본 몫 + 이월) */
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
 *    `ownSlot` 은 이 요청이 정기 회차면 그 슬롯 이름, 손 실행이면 `null`. `slotsPerDay` 는 정본 슬롯 수(6).
 *
 *    ① 오늘 정기 몫 전체 P = min(천장, 슬롯 수 × 몫). 손 실행 몫은 처음부터 `천장 − P` 뿐이다.
 *    ② 끝난 슬롯을 시각 순서로 지나며 P 에서 **그 슬롯 몫 안에서 쓴 만큼만** 뺀다
 *       (슬롯 j 의 몫 = 그때 남은 P / 그 슬롯부터 남은 슬롯 수). 🔴 **이월** — 앞 슬롯이 덜 썼거나
 *       안 돌았으면(노트북 잠김) 그 차이가 뒤 슬롯에 **똑같이** 나뉜다. 손 실행으로 가지 않는다.
 *       🔴 몫을 넘겨 쓴 것(손 실행 몫 `천장 − P` 에서 먼저 온 쪽이 쓴 것)은 P 에서 빼지 않는다 —
 *          빼면 앞 정기 회차가 많이 쓴 날 뒤 슬롯이 굶는다.
 *    ③ 실제 여력 B = 천장 − (남은 슬롯 **밖**에서 쓴 것). 남은 P 가 B 보다 크면 **비례로 줄인다**.
 *    ④ 슬롯 몫 = min(남은 P, B) / 남은 슬롯 수. 슬롯 j 의 남은 몫 = max(0, 슬롯 몫 − 그 슬롯이 쓴 것).
 *
 *    🔴 남은 P·B 모두 **남은 슬롯이 이미 쓴 것을 빼지 않는다.** 빼면 한 슬롯이 쓸수록 뒤 슬롯의 몫이 따라
 *       줄어, 그 슬롯이 연속 소액 요청으로 결국 전부를 가져간다. 앞 슬롯이 쓴 것은 그 슬롯 자신의 몫에서 빠진다.
 */
export function allocateScheduledReserve(input: {
  pending: readonly SlotWindow[]
  /** 오늘 창이 이미 끝난 슬롯 — 시각 순서 */
  ended: readonly SlotWindow[]
  shareUsd: number
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
  const pendingSpent = input.pending.reduce((sum, w) => sum + (spentBySlot.get(w.label) ?? 0), 0)
  const k = input.pending.length
  const pool = Math.max(0, Math.min(input.capUsd, (input.ended.length + k) * input.shareUsd))
  // ② 끝난 슬롯이 몫 안에서 쓴 만큼만 P 에서 뺀다 — 이월과 초과 사용을 가른다
  let rest = pool
  input.ended.forEach((w, i) => {
    const slotShare = rest / (input.ended.length - i + k)
    rest -= Math.min(spentBySlot.get(w.label) ?? 0, slotShare)
  })
  const entitlement = k === 0 ? 0 : Math.max(0, rest)
  const basis = Math.max(0, input.capUsd - (used - pendingSpent))
  const pendingPool = Math.min(entitlement, basis)
  const scale = entitlement > 0 ? pendingPool / entitlement : 1
  const perSlot = k === 0 ? 0 : pendingPool / k
  const slots = input.pending.map((w) => {
    const spentUsd = spentBySlot.get(w.label) ?? 0
    return { label: w.label, shareUsd: perSlot, spentUsd, claimUsd: Math.max(0, perSlot - spentUsd) }
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
}): { kind: SupplyRunKind; why: string; slot: string | null; share: ShareDecision; allocation: ScheduledAllocation; protect: SpendProtect } {
  const slots = input.slots ?? SUPPLY_RUN_SLOTS_KST
  const windowMs = input.windowMs ?? SCHEDULED_RUN_WINDOW_MS
  const k = supplyRunKindOf(input.env, input.now, slots, windowMs)
  const pending = pendingSlotsAt(input.now, slots, windowMs)
  const share: ShareDecision = input.shareUsd !== undefined
    ? { usd: input.shareUsd, source: 'measured', samples: 0, why: `주어진 몫 $${input.shareUsd.toFixed(4)}` }
    : scheduledShareFrom(input.historyEntries === undefined || input.historyEntries === null
      ? null
      : scheduledRunSamples({ entries: input.historyEntries, now: input.now, windowMs }))
  const contract = input.ceilingUsd === undefined ? SUPPLY_DAILY_USD_APPROVED : input.ceilingUsd
  // 🔴 손 실행은 천장 미승인을 0 으로 읽는다. 정기 회차는 천장이 없으면 env 예산만 본다(앞판 그대로)
  const ceiling: number | null = k.kind === 'manual' ? (contract ?? 0) : contract
  const daily = input.dailyUsd ?? null
  const capUsd = ceiling === null ? (daily ?? 0) : daily === null ? ceiling : Math.min(daily, ceiling)
  const allocation = allocateScheduledReserve({
    pending, ended: endedSlotsAt(input.now, slots, windowMs),
    shareUsd: share.usd, capUsd, todayEntries: input.todayEntries ?? [], ownSlot: k.slot,
  })
  const others = allocation.slots.filter((s) => s.label !== k.slot)
  return {
    ...k, share, allocation,
    protect: {
      reservedForOthersUsd: allocation.reservedForOthersUsd,
      ceilingUsd: ceiling,
      reason: `${k.kind === 'scheduled' ? '뒤' : '남은'} 정기 슬롯 ${others.length}개 몫 $${allocation.reservedForOthersUsd.toFixed(4)}`
        + (others.length === 0 ? '' : ` (${others.map((s) => `${s.label.slice(11)} $${s.claimUsd.toFixed(4)}`).join(' · ')})`)
        + ` · 슬롯 몫 $${share.usd.toFixed(4)} · 오늘 정기 몫 전체 $${allocation.poolUsd.toFixed(4)}`
        + ` · 남은 슬롯 몫(이월 포함) $${allocation.entitlementUsd.toFixed(4)}`
        + `${allocation.scale < 1 ? ` × 배율 ${allocation.scale.toFixed(3)}` : ''}`
        + ` [${share.why}]`
        + ` · 천장 $${(ceiling ?? capUsd).toFixed(2)} · ${k.why}`,
    },
  }
}
