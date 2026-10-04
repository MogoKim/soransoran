/**
 * 🔴 **한자 언어 핏 — 실제 CJK 한자 문자 판정 하나** (2026-10-04 P0-3 최종) — 순수 · 의존 없음
 *
 *    소란소란 글은 한글로 읽힌다. 사용자에게 보이는 원천 제목 · 본문과 최종 생성 제목 · 본문에 **실제 한자 문자**가
 *    한 글자라도 있으면 좋은 소재여도 언어 핏이 맞지 않는다(`朴나래` · `李효리` · `故 배우` · `祖國`).
 *    🔴 정치 판정이 아니다 — 별도 사유(`hanjaLanguageFit`)로 남는다. 한글 낱말 `한자` 는 한자 문자가 아니다.
 *    🔴 이 함수 하나만 쓴다 — 정규식을 다른 파일에 복제하지 않는다. 일본어 · 외국어 전체 정책으로 넓히지 않는다.
 *    🔴 URL · hash · HTML · 내부 메타데이터는 호출부가 넘기지 않는다(사람에게 보이는 제목 · 본문만).
 */
export const HANJA_LANGUAGE_FIT = 'hanjaLanguageFit'

const HAN = /\p{Script=Han}/u

/** 첫 한자 문자 — 없으면 `null` */
export function findCjkIdeograph(text: string): string | null {
  const m = HAN.exec(text ?? '')
  return m === null ? null : m[0]
}
