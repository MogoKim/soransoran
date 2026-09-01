/**
 * 어드민 화면 공통 표기.
 * 🔴 화면마다 Intl 설정을 다시 쓰지 않는다 — 한 곳이 틀리면 날짜가 서로 달라 보인다.
 */
const KST_DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
})

export function formatKst(value: Date | null | undefined): string {
  if (!value) return '-'
  return KST_DATE_TIME.format(value)
}

/** 값이 없으면 '-' 로 둔다. 빈칸은 "못 받았다" 와 "안 받았다" 를 구분하지 못한다. */
export function orDash(value: string | null | undefined): string {
  const v = value?.trim()
  return v ? v : '-'
}

/**
 * 실회원 판정 — 어드민 회원 화면의 단일 기준.
 *
 * 🔴 providerId 가 있어야 실회원이다. 카카오로 들어온 사람만 이 값을 갖는다
 *    (schema 주석: "카카오 providerId. 실회원 판별 기준이 된다").
 *
 * 🔴 페르소나가 연결된 User 는 뺀다.
 *    페르소나도 User 행을 갖지만 운영자가 차단하거나 상세를 볼 대상이 아니다.
 *    persona 파일을 건드리지 않고 관계 유무만 본다.
 *
 * 🔴 화면마다 where 를 다시 쓰지 않는다. 목록에서 빠진 사람이 상세로는 열리는
 *    상태가 가장 위험하다 — 목록·상세·집계가 같은 조각을 쓴다.
 */
export const REAL_MEMBER_WHERE = {
  providerId: { not: null },
  persona: { is: null },
} as const
