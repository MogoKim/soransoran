export const REPORT_REASONS = [
  { value: 'SPAM', label: '광고·스팸' },
  { value: 'ABUSE', label: '욕설·비방' },
  { value: 'ADULT', label: '선정적 내용' },
  { value: 'PRIVACY', label: '개인정보 노출' },
  { value: 'ETC', label: '기타' },
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]['value']

export const VALID_REPORT_REASONS = new Set<string>(REPORT_REASONS.map((r) => r.value))
