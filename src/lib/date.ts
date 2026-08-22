/**
 * 상대 시간 표기
 *
 * 목록에서 "언제 쓴 글인지"가 보이지 않으면 죽은 커뮤니티처럼 보인다.
 * 정확한 초 단위보다 "방금 전 / 3분 전" 같은 감각이 중요하므로 단순하게 계산한다.
 *
 * 일주일이 넘어가면 상대 표기가 오히려 감이 안 오므로 날짜로 바꾼다.
 */
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function formatRelativeTime(value: Date, now: Date = new Date()): string {
  const diff = now.getTime() - value.getTime()

  // 시계 오차 등으로 미래 시각이 들어오면 "방금 전"으로 처리한다
  if (diff < MINUTE) return '방금 전'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`
  if (diff < WEEK) return `${Math.floor(diff / DAY)}일 전`

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(value)
}

/**
 * 목록 미리보기용 본문 요약
 *
 * 줄바꿈을 공백으로 눌러 2줄 말줄임이 예측 가능하게 만든다.
 * 길이를 넉넉히 잘라 두고 실제 줄 수 제한은 CSS(line-clamp)가 맡는다.
 */
export function toPreview(content: string, max = 140): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
