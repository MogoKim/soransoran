/**
 * 매거진 발행일 표시 전용 변환.
 * 정확한 YYYY-MM-DD 값만 화면 표기로 바꾼다.
 */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function formatMagazinePublishedDate(publishedAt: string): string {
  const matched = DATE_PATTERN.exec(publishedAt)
  if (!matched) return publishedAt

  const [, year, month, day] = matched
  return `${year}. ${Number(month)}. ${Number(day)}.`
}
