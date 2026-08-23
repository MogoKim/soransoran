/**
 * 글자 크기 단계 — 값과 이름을 여기서만 정한다.
 *
 * 화면마다 같은 단계를 다르게 부르면 사용자가 무엇을 고른 건지 알 수 없다.
 * 실제 크기는 globals.css 의 :root / [data-font-size='SMALL'] / [data-font-size='LARGE'] 가 정한다.
 * 기본값 NORMAL 은 속성을 붙이지 않는 상태다.
 */

export const FONT_SIZE_VALUES = ['SMALL', 'NORMAL', 'LARGE'] as const

export type FontSize = (typeof FONT_SIZE_VALUES)[number]

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  SMALL: '작게',
  NORMAL: '기본',
  LARGE: '크게',
}

export const FONT_SIZE_STORAGE_KEY = 'soran-font-size'

export function isFontSize(value: unknown): value is FontSize {
  return typeof value === 'string' && (FONT_SIZE_VALUES as readonly string[]).includes(value)
}
