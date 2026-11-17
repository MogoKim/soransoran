/**
 * Persona 생활사 값의 **뜻**을 한 곳에서 판정한다.
 *
 * 같은 사실("이 사람은 갱년기를 겪었는가")을 화자 자격 · 초안 게이트 · 발행 배정이 각자 다른 목록으로
 * 판정하면 한 곳만 어긋나도 그 사람은 그 주제를 영영 쓰지 못한다. 값의 어휘와 그 뜻은 여기 하나다.
 *
 * 🔴 순수 함수다. 파일도 DB 도 읽지 않는다.
 * 🔴 아는 값만 참이다 — 빈 값 · 모르는 값은 근거가 되지 못한다(fail-closed).
 */

/** 카드와 DB `identity.menopauseStatus` 가 쓰는 값 전부 */
export const MENOPAUSE_STATUSES = ['전', '진행중', '후'] as const
export type MenopauseStatus = (typeof MENOPAUSE_STATUSES)[number]

/** 갱년기를 겪고 있거나 겪었는가 — `전` 은 아직 겪지 않았다 */
export function hasMenopauseExperience(status: string | null | undefined): boolean {
  const v = (status ?? '').trim()
  return v === '진행중' || v === '후'
}
