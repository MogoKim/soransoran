/**
 * KST 쓰기 금지 창 — 운영 레인의 수동 쓰기를 잠시 멈추는 시간 (순수 · DB·세션·네트워크 없음)
 *
 * 🔴 **임시 규칙이다.** 근거는 하나 — Persona cohort 투입 도구(scripts/persona-cohort-run.mts)가 작업 앞뒤로
 *    전역 댓글·글·회원 수를 비교해, 그 사이에 쓰기가 하나라도 끼면 투입이 실패로 끝난다
 *    (D30 1회 투입기는 매일 07:05~07:19 KST 창에서 돈다 — scripts/lib/persona-d30-oneshot.mts ONESHOT_WINDOW).
 *    그 도구가 행 단위 대조로 바뀌면 이 창들은 함께 걷는다. 걷을 때는 이 파일 하나만 고친다.
 * 🔴 창은 [start, end) 반열림이다 — 시작 분은 막고 끝 분부터 다시 된다.
 * 🔴 D100 모듈을 import 하지 않는다 — 운영 레인이 D100 코드에 묶이지 않게 KST 분 계산을 여기 둔다.
 *
 * 쓰는 곳: Persona 목소리 댓글(운영 레인) · 운영자 이름 명단 적용 도구
 */

export type KstQuietWindow = { label: string; startMinute: number; endMinute: number }

/** Persona 목소리 댓글 — 06:30~08:30 KST 쉰다 */
export const PERSONA_VOICE_QUIET_WINDOW: KstQuietWindow = {
  label: 'Persona 목소리 댓글',
  startMinute: 6 * 60 + 30,
  endMinute: 8 * 60 + 30,
}

/** 운영자 이름 명단 적용(회원 행 추가) — 06:00~09:00 KST 쉰다 */
export const OPERATOR_ROSTER_QUIET_WINDOW: KstQuietWindow = {
  label: '운영자 이름 명단 적용',
  startMinute: 6 * 60,
  endMinute: 9 * 60,
}

const KST_OFFSET_MS = 9 * 3_600_000
const DAY_MS = 86_400_000

/** KST 하루 안의 분(0~1439) */
export function kstMinuteOfDayOf(now: Date): number {
  const ms = (((now.getTime() + KST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS
  return Math.floor(ms / 60_000)
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/** 지금 이 창 안인가 — 안이면 사람이 읽을 이유를 돌려준다 */
export function judgeKstQuietWindow(now: Date, w: KstQuietWindow): { ok: true } | { ok: false; reason: string } {
  const m = kstMinuteOfDayOf(now)
  if (m >= w.startMinute && m < w.endMinute) {
    return {
      ok: false,
      reason: `${hhmm(w.startMinute)}~${hhmm(w.endMinute)} KST 에는 ${w.label}을(를) 쉽니다(자동 운영 점검 시간). ${hhmm(w.endMinute)} 부터 다시 됩니다.`,
    }
  }
  return { ok: true }
}
