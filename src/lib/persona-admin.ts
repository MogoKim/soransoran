/**
 * 어드민 페르소나 화면 공용 — 🔴 읽기 전용
 *
 * 정본: docs/operations/2026-08-31-persona-db-model-design.md §10-2
 *       전략 §10-2 어드민은 승인 버튼 화면이 아니라 자동화 관제실이다
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다.
 *    외부 비공개 정책(전략 §10-1)상 고객 화면 코드는 Persona 를 몰라야 한다.
 */

/**
 * 닉네임 마스킹 — 🔴 첫 글자만 남긴다.
 *
 * 어드민이라도 목록에서 전문을 흘리지 않는다. 스크린샷 · 화면 공유 ·
 * 로그 캡처로 새어 나가는 경로가 실제로 있다.
 * 필요하면 상세에서 개별 확인한다(§3).
 */
export function maskNickname(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (raw === '') return '(이름 없음)'
  const chars = [...raw]
  return `${chars[0]}${'●'.repeat(Math.max(0, chars.length - 1))}`
}

/** 값이 들어 있는지만 알려준다 — 🔴 내용을 노출하지 않는다 */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return true
}

/** 채움 표시 — 어드민 목록에서 "준비됐는가" 만 본다 */
export const filledMark = (v: unknown): string => (hasValue(v) ? '있음' : '—')

export const STATUS_LABEL: Record<string, string> = {
  draft: '준비 중',
  active: '활동 중',
  paused: '일시 중지',
  retired: '은퇴',
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  created: '생성',
  approved: '승인',
  updated: '수정',
  status_changed: '상태 전환',
  retired: '폐기',
  display_name_assigned: '이름 배정',
  display_name_retired: '이름 폐기',
}

export function formatKst(value: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul',
  }).format(value)
}
