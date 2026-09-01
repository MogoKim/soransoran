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
