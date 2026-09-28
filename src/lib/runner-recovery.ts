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
}

export type RecoveryVerdict = { action: 'kickstart' | 'skip'; reason: string; staleAfterMs: number }

export function judgeRecovery(i: RecoveryInput): RecoveryVerdict {
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
