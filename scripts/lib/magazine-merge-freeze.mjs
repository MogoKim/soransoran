/**
 * 매거진 merge freeze — **모든 매거진 자동 merge 직전에 같은 판정 하나**를 돈다 (2026-11-24 창업자 승인).
 *
 * 왜 있나
 *   창업자가 정한 두 밤(11/24 22:00 ~ 11/25 02:30 KST · 11/25 22:00 ~ 11/26 02:30 KST)에는 매거진 PR 이 main 에 들어가지 않아야 한다.
 *   그 시간대에 도는 자동 merge 는 legacy 01:00 `--apply` · 02:00 `--recover`(둘 다 `runAutoMerge`)와 vNext release merge 다.
 *   한 경로만 막으면 다른 경로가 같은 밤에 main 을 바꾼다 — 그래서 판정은 여기 한 곳이고, 두 경로가 merge 호출 **바로 앞**에서 부른다.
 *
 * 규칙
 *   창은 [startAt, endAt) — 시작 시각은 막고 끝 시각부터 연다. 시각은 오프셋이 붙은 엄격 시각(public-rule)으로만 읽는다.
 *   🔴 판정 시각이 유한한 수가 아니면 막는다(MERGE_FREEZE_CLOCK_INVALID) — 모르는 시각을 "창 밖" 으로 보지 않는다.
 *   🔴 창 표가 깨졌으면(읽을 수 없는 시각 · 끝 ≤ 시작) 막는다(MERGE_FREEZE_TABLE_INVALID).
 *   창 밖은 아무것도 막지 않는다 — 이 판정이 정상 merge 를 막는 일은 두 창 안에서만 생긴다.
 *
 * 🔴 순수 — public-rule 만 import 한다. fs · env · 벽시계 · 네트워크 0. 호출자가 시각을 준다.
 */
import { strictOffsetTimeMs } from './magazine-public-rule.mjs'

/** 창업자가 정한 freeze 창 — 지난 창은 판정에 영향이 없다(창 밖). 새 창은 행을 더한다 */
export const MAGAZINE_MERGE_FREEZE_WINDOWS = Object.freeze([
  Object.freeze({ id: 'freeze-2026-11-24-night', startAt: '2026-11-24T22:00:00+09:00', endAt: '2026-11-25T02:30:00+09:00' }),
  Object.freeze({ id: 'freeze-2026-11-25-night', startAt: '2026-11-25T22:00:00+09:00', endAt: '2026-11-26T02:30:00+09:00' }),
])

/**
 * @param {number} nowMs  merge 직전 시각(ms) — 호출자가 그 순간 다시 읽은 값
 * @param {readonly {id:string, startAt:string, endAt:string}[]} [windows]
 * @returns {{ frozen: boolean, code: string|null, window: {id:string, startAt:string, endAt:string}|null, message: string }}
 */
export function judgeMergeFreeze(nowMs, windows = MAGAZINE_MERGE_FREEZE_WINDOWS) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    return { frozen: true, code: 'MERGE_FREEZE_CLOCK_INVALID', window: null, message: `merge 직전 시각을 읽지 못했다(${String(nowMs)}) — 모르면 막는다` }
  }
  if (!Array.isArray(windows)) return { frozen: true, code: 'MERGE_FREEZE_TABLE_INVALID', window: null, message: 'freeze 창 표가 배열이 아니다 — 막는다' }
  for (const w of windows) {
    const start = strictOffsetTimeMs(w?.startAt)
    const end = strictOffsetTimeMs(w?.endAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || typeof w?.id !== 'string' || w.id === '') {
      return { frozen: true, code: 'MERGE_FREEZE_TABLE_INVALID', window: null, message: `freeze 창 ${String(w?.id)} 를 읽지 못했다 — 막는다` }
    }
    if (nowMs >= start && nowMs < end) {
      return { frozen: true, code: 'MERGE_FREEZE_WINDOW', window: { id: w.id, startAt: w.startAt, endAt: w.endAt },
        message: `매거진 merge freeze(${w.startAt} ~ ${w.endAt}) 안이다 — merge 하지 않는다. PR 은 그대로 두고 창이 끝난 뒤 같은 관문으로 다시 본다` }
    }
  }
  return { frozen: false, code: null, window: null, message: 'freeze 창 밖' }
}
