/**
 * 🔴 **의미 검수 요약 — 칸 이름과 경고 코드의 정본** (2026-09-27 · 의존 없는 파일)
 *
 * 적재(`micro-seed-supply-autofill`) · 자동 READY 판정(`auto-ready-v2`) · 품질 계약 digest
 * (`quality-contract`)가 같은 값을 읽는다. 셋이 서로를 부르는 순환 안에서 모듈 로드 때 값을
 * 읽으면 비어 있다(실측: `Cannot access 'SEMANTIC_SUMMARY_KEY' before initialization`).
 * 그래서 아무것도 import 하지 않는 이 파일에 둔다. 값은 옮기기 전과 한 글자도 같다.
 */
export const SEMANTIC_SUMMARY_KEY = 'semanticReview'

/** 🔴 경고 코드 — 사람 화면과 자동 판정이 **같은 이름**을 읽는다 */
export const SEMANTIC_HOLD_CODES = {
  unsupportedAdditions: 'SEMANTIC_UNSUPPORTED_ADDITION',
  lifeContradictions: 'SEMANTIC_LIFE_CONTRADICTION',
  droppedFromSource: 'SEMANTIC_DROPPED_FROM_SOURCE',
  incomplete: 'SEMANTIC_REVIEW_INCOMPLETE',
} as const
