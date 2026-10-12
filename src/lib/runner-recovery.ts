/**
 * 🔴 **러너 복구 판정 — 순수 함수. launchctl·파일 0** (2026-09-28)
 *
 *    잠·네트워크 끊김·일시 오류로 **한 회차가 실패했거나 예정 회차가 비었을 때** 그 job 을 한 번
 *    다시 깨운다(`launchctl kickstart`). 판정은 여기서, 실행은 `scripts/runner-recover.mts` 가 한다.
 *
 * 🔴 **새 문턱값을 만들지 않는다.** "얼마나 비면 누락인가" 는 관제 정본 `staleAfterFromSlots`
 *    (슬롯 간격 × 2 · 하한 3h · 상한 30h)를 그대로 쓴다. 같은 창 안에서는 **한 번만** 다시 깨운다.
 *
 * 🔴 **모르면 건드리지 않는다.** 복구는 행동이다 — 관측을 못 했으면(unknown · 근거 시각 없음)
 *    깨우지 않는다. 등록·load 는 사람 일이다(unloaded 는 건드리지 않는다).
 *
 * 🔴 **두 정책** (2026-10-11 Batch A4).
 *    · `stale` (기존 · 발행 · 공급 · 감사 · controller) — 누락 = 마지막 회차가 `staleAfterFromSlots` 를 넘김 · 창 = 그 값
 *    · `slot`  (댓글 러너) — 60분 첫 댓글 계약에는 `stale`(밤 공백 × 2 = 20시간)이 너무 늦다.
 *              누락 = **지난 예약 슬롯**(유예 `RECOVERY_SLOT_GRACE_MS` 지난 가장 최근 슬롯)보다 마지막 회차가 이르다.
 *              창 = 그 슬롯부터 다음 슬롯까지 — 그 슬롯 뒤에 이미 한 번 깨웠으면 다시 깨우지 않는다(창마다 최대 1회).
 *    두 정책 모두 — 실패 관측 또는 실제 누락일 때만 · unloaded · 상태 모름 · 실행 중이면 건드리지 않는다.
 */
import { staleAfterFromSlots } from './supply-health'
import type { JobState } from './runtime-isolation'

export type RecoveryInput = {
  label: string
  /** 🔴 다시 돌려도 안전한 job 인가 — 수집 job 은 아니다(외부 요청 간격) */
  recoverable: boolean
  state: JobState
  running: boolean
  lastExitCode: number | null
  /** 마지막 회차의 근거 시각(ISO) — 회차 기록 또는 로그가 바뀐 때. 모르면 null */
  lastRunAt: string | null
  /** 설치본의 하루 슬롯 [시, 분] — `StartInterval` 만 쓰는 job 은 빈 배열 */
  slots: readonly (readonly [number, number])[]
  /** 이 도구가 마지막으로 깨운 시각(ISO) — 없으면 null */
  lastRecoveryAt: string | null
  now: Date
  /** 🔴 생략하면 `stale` — 기존 네 job 의 판정은 그대로다 */
  policy?: RecoveryPolicy
}

export type RecoveryPolicy = 'stale' | 'slot'

/** 🔴 슬롯 시각이 지나고 이만큼은 기다린다 — 그 회차가 로그를 남길 시간(새 문턱이 아니라 관측 지연 흡수) */
export const RECOVERY_SLOT_GRACE_MS = 10 * 60_000

const KST_OFFSET_MS = 9 * 3_600_000
const DAY_MS = 86_400_000

/** 🔴 `at` 이전(포함)에 지난 가장 최근 슬롯 시각(KST 기준 오늘·어제). 슬롯이 없으면 null */
export function latestSlotAtOrBefore(slots: readonly (readonly [number, number])[], at: Date): Date | null {
  if (slots.length === 0) return null
  const shifted = at.getTime() + KST_OFFSET_MS
  const midnight = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - KST_OFFSET_MS
  let best: number | null = null
  for (const dayStart of [midnight, midnight - DAY_MS]) {
    for (const [h, m] of slots) {
      const t = dayStart + (h * 60 + m) * 60_000
      if (t <= at.getTime() && (best === null || t > best)) best = t
    }
  }
  return best === null ? null : new Date(best)
}

export type RecoveryVerdict = { action: 'kickstart' | 'skip'; reason: string; staleAfterMs: number }

export function judgeRecovery(i: RecoveryInput): RecoveryVerdict {
  if (i.policy === 'slot') return judgeSlotRecovery(i)
  const staleAfterMs = staleAfterFromSlots(i.slots)
  const skip = (reason: string): RecoveryVerdict => ({ action: 'skip', reason, staleAfterMs })
  if (!i.recoverable) return skip('복구 대상이 아니다 — 다시 돌리면 외부 요청 간격·상한을 깰 수 있다')
  if (i.state === 'unknown') return skip('launchctl 상태를 모른다 — 모르는 job 을 깨우지 않는다')
  if (i.state !== 'loaded') return skip('load 되어 있지 않다 — 등록은 사람 일이다')
  if (i.running) return skip('지금 돌고 있다')
  const now = i.now.getTime()
  if (i.lastRecoveryAt !== null) {
    const t = Date.parse(i.lastRecoveryAt)
    if (!Number.isFinite(t)) return skip('복구 표식을 읽을 수 없다 — 반복 복구를 막으려고 멈춘다')
    if (now - t < staleAfterMs) return skip('같은 창 안에서 이미 한 번 깨웠다 — 반복하지 않는다')
  }
  if (i.lastExitCode !== null && i.lastExitCode !== 0) {
    return { action: 'kickstart', reason: `마지막 회차가 exit ${i.lastExitCode} 로 끝났다 — 한 번 다시 돌린다`, staleAfterMs }
  }
  if (i.lastRunAt === null) return skip('마지막 회차 시각을 모른다 — 누락인지 알 수 없다')
  const last = Date.parse(i.lastRunAt)
  if (!Number.isFinite(last)) return skip('마지막 회차 시각을 읽을 수 없다')
  if (now - last > staleAfterMs) {
    return {
      action: 'kickstart', staleAfterMs,
      reason: `마지막 회차가 ${Math.round((now - last) / 3_600_000)}시간 전 — 슬롯 기준 ${Math.round(staleAfterMs / 3_600_000)}시간을 넘겼다(누락)`,
    }
  }
  return skip('정상 — 최근 회차가 슬롯 간격 안에 있고 실패하지 않았다')
}

/**
 * 🔴 **슬롯 정책** — 지난 예약 슬롯 하나를 놓쳤거나 마지막 회차가 실패했을 때, 그 슬롯 창에서 **한 번만** 깨운다.
 *    `staleAfterMs` 칸에는 창의 시작부터 지금까지를 적는다(사람이 읽는 값).
 */
function judgeSlotRecovery(i: RecoveryInput): RecoveryVerdict {
  const now = i.now.getTime()
  const due = latestSlotAtOrBefore(i.slots, new Date(now - RECOVERY_SLOT_GRACE_MS))
  const windowMs = due === null ? 0 : now - due.getTime()
  const skip = (reason: string): RecoveryVerdict => ({ action: 'skip', reason, staleAfterMs: windowMs })
  if (!i.recoverable) return skip('복구 대상이 아니다 — 다시 돌리면 외부 요청 간격·상한을 깰 수 있다')
  if (i.state === 'unknown') return skip('launchctl 상태를 모른다 — 모르는 job 을 깨우지 않는다')
  if (i.state !== 'loaded') return skip('load 되어 있지 않다 — 등록은 사람 일이다')
  if (i.running) return skip('지금 돌고 있다')
  if (due === null) return skip('예약 슬롯이 없다 — 슬롯 정책으로 누락을 판정할 수 없다')
  if (i.lastRecoveryAt !== null) {
    const t = Date.parse(i.lastRecoveryAt)
    if (!Number.isFinite(t)) return skip('복구 표식을 읽을 수 없다 — 반복 복구를 막으려고 멈춘다')
    if (t >= due.getTime()) return skip('이 슬롯 창에서 이미 한 번 깨웠다 — 반복하지 않는다')
  }
  if (i.lastExitCode !== null && i.lastExitCode !== 0) {
    return { action: 'kickstart', reason: `마지막 회차가 exit ${i.lastExitCode} 로 끝났다 — 이 슬롯 창에서 한 번 다시 돌린다`, staleAfterMs: windowMs }
  }
  if (i.lastRunAt === null) return skip('마지막 회차 시각을 모른다 — 누락인지 알 수 없다')
  const last = Date.parse(i.lastRunAt)
  if (!Number.isFinite(last)) return skip('마지막 회차 시각을 읽을 수 없다')
  if (last < due.getTime()) {
    return {
      action: 'kickstart', staleAfterMs: windowMs,
      reason: `예약 슬롯 ${due.toISOString()} 뒤 회차가 없다(마지막 ${Math.round((now - last) / 60_000)}분 전) — 실제 누락 · 한 번 깨운다`,
    }
  }
  return skip('정상 — 지난 예약 슬롯 뒤에 회차가 있었고 실패하지 않았다')
}

// ─────────────────────────────────────────────────────────
// 🔴 고아 깨움 표식 — 사건 깨움이 러너에 닿지 못하고 남은 표식 (2026-10-12 Batch C2)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **표식이 이만큼 남아 있어야 고아로 본다** — 깨움 직후 러너가 뜨고 표식을 거두는 시간. 새 정책 문턱이 아니라
 *    관측 지연 흡수다(같은 성격: `RECOVERY_SLOT_GRACE_MS`).
 */
export const ORPHAN_WAKE_GRACE_MS = 3 * 60_000

/**
 * 🔴 **처리 기록 — 세 상태를 구조로 가른다** (2026-10-12 C2 보정).
 *    `missing`    기록이 없다 — 아직 이 도구가 다시 깨운 표식이 없다
 *    `valid`      기록이 있고 다시 깨운 표식의 시각(`wakeAt`)을 읽었다
 *    `unreadable` 기록 파일은 있는데 읽거나 해석하지 못했다(손상 JSON · `wakeAt` 없음 · 문자열 아님 · 읽기 실패)
 *    🔴 `unreadable` 은 "이미 깨웠는지 모른다" 다 — 모르는 상태에서 kickstart 하지 않는다(fail-closed).
 *       앞판은 이 경우를 문자열 `'unreadable'` 로 돌려 표식 시각과 같지 않으면 통과시켰다 → 기록이 깨지면 회차마다 같은 표식을 다시 깨웠다.
 */
export type HandledWake = { kind: 'missing' } | { kind: 'valid'; wakeAt: string } | { kind: 'unreadable' }

/**
 * 🔴 **정본 ISO 시각인가** — 처리 기록의 `wakeAt` 은 follow-up 표식의 `at` 그대로이고, 그 값은 언제나
 *    `new Date(ms).toISOString()`(`YYYY-MM-DDTHH:mm:ss.sssZ`)이 만든다(`runner-lease.requestFollowUp`).
 *    판정은 하나다 — 유한한 시각이고, 그 시각을 `toISOString()` 으로 되돌린 문자열이 원문과 **글자 그대로** 같은가.
 *    이것만으로 모양(밀리초 · `Z` · `T`)과 넘친 날짜(`2026-02-30`)가 함께 걸린다(정규식을 따로 두면 같은 결정이 두 곳이다).
 */
export function isCanonicalIso(v: string): boolean {
  const t = Date.parse(v)
  return Number.isFinite(t) && new Date(t).toISOString() === v
}

/**
 * 🔴 처리 기록 원문 → 상태. 순수 — 파일이 없는 경우(`missing`)는 읽는 쪽이 정한다.
 *    `wakeAt` 이 정본 ISO 시각이 아니면(`"garbage"` · `"2026-99-99"` · 공백 · 숫자 문자열 등) `unreadable` 이다 —
 *    앞판은 비어 있지 않은 문자열이면 valid 로 읽어, 표식 시각과 다르면 같은 고아 표식을 틱마다 다시 깨웠다(2026-10-12 C2 경계 보정).
 */
export function parseHandledWake(raw: string): HandledWake {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { kind: 'unreadable' } }
  if (typeof v !== 'object' || v === null) return { kind: 'unreadable' }
  const w = (v as { wakeAt?: unknown }).wakeAt
  return typeof w === 'string' && isCanonicalIso(w) ? { kind: 'valid', wakeAt: w } : { kind: 'unreadable' }
}

export type OrphanWakeInput = {
  /** 사건 깨움이 켜져 있는가(`SORAN_EVENT_WAKE` 가 이 대상을 허용) */
  enabled: boolean
  state: JobState
  running: boolean
  /** 지금 남아 있는 follow-up 표식 — 없으면 null. trigger · 시각은 표식 원문에서 읽은 것 */
  marker: { trigger: string | null; at: string | null } | null
  /** 이 도구가 이미 다시 깨운 표식의 기록 — `HandledWake` 세 상태 */
  handled: HandledWake
  now: Date
}

/**
 * 🔴 **고아 사건 표식을 한 번 다시 깨운다 — 표식 하나에 최대 1회.**
 *    · 사건(event) 표식만 본다 — 정기 · 수동 겹침이 남긴 표식은 정기 회차가 받는다
 *    · 시각을 모르는 표식은 건드리지 않는다(상한을 셀 수 없다)
 *    · 같은 표식(같은 시각)을 이미 깨웠으면 다시 깨우지 않는다 — kickstart 가 실패해도 무한 반복하지 않는다
 *    · 처리 기록을 읽지 못하면(`unreadable`) 깨우지 않는다 — 이미 깨웠는지 모르면 반복을 막을 수 없다(fail-closed)
 *    · 깨움이 꺼졌거나 · unloaded · 상태 모름 · 실행 중이면 건드리지 않는다
 */
export function judgeOrphanWake(i: OrphanWakeInput): RecoveryVerdict {
  const skip = (reason: string): RecoveryVerdict => ({ action: 'skip', reason, staleAfterMs: ORPHAN_WAKE_GRACE_MS })
  if (!i.enabled) return skip('사건 깨움이 꺼져 있다 — 고아 표식을 깨우지 않는다')
  if (i.marker === null) return skip('남은 깨움 표식이 없다')
  if (i.marker.trigger !== 'event') return skip(`사건 표식이 아니다(${i.marker.trigger ?? '모름'}) — 정기 회차가 받는다`)
  if (i.marker.at === null) return skip('표식 시각을 모른다 — 상한을 셀 수 없어 건드리지 않는다')
  const at = Date.parse(i.marker.at)
  if (!Number.isFinite(at)) return skip('표식 시각을 읽을 수 없다')
  if (i.state === 'unknown') return skip('launchctl 상태를 모른다 — 모르는 job 을 깨우지 않는다')
  if (i.state !== 'loaded') return skip('load 되어 있지 않다 — 등록은 사람 일이다')
  if (i.running) return skip('지금 돌고 있다 — 회차가 끝날 때 표식을 거둔다')
  if (i.handled.kind === 'unreadable') return skip('처리 기록을 읽지 못했다 — 이미 깨웠는지 모르므로 깨우지 않는다(fail-closed · 정기 회차가 받는다)')
  if (i.handled.kind === 'valid' && i.handled.wakeAt === i.marker.at) return skip('이 표식은 이미 한 번 다시 깨웠다 — 반복하지 않는다(정기 회차가 받는다)')
  if (i.now.getTime() - at < ORPHAN_WAKE_GRACE_MS) return skip('깨운 지 얼마 안 됐다 — 러너가 거둘 시간을 준다')
  return { action: 'kickstart', reason: `사건 깨움 표식(${i.marker.at})이 러너에 닿지 못하고 남았다 — 한 번 다시 깨운다`, staleAfterMs: ORPHAN_WAKE_GRACE_MS }
}
