/**
 * 동의 항목과 판본.
 *
 * 🔴 version 은 약관 화면의 시행일이다.
 *    '1.0' 같은 임의 번호를 쓰면 약관이 바뀌었을 때 누가 어느 판본에 동의했는지
 *    되짚을 수 없다. 시행일이면 화면과 기록이 같은 것을 가리킨다.
 *
 * 🔴 시행일이 바뀌면 여기도 바꾼다.
 *    (userId, type, version) 이 unique 라 판본이 바뀌면 새 행이 생기고,
 *    그것이 곧 "다시 받아야 한다" 는 신호가 된다.
 */

/** Agreement.type 에 쓰는 값. 스키마가 String 이라 여기서 좁힌다 */
export const AGREEMENT_TYPE = {
  terms: 'TERMS_OF_SERVICE',
  privacy: 'PRIVACY_POLICY',
  marketing: 'MARKETING',
} as const

export type AgreementType = (typeof AGREEMENT_TYPE)[keyof typeof AGREEMENT_TYPE]

/**
 * 판본 = 시행일.
 *   이용약관        /terms   시행일
 *   개인정보처리방침 /privacy 시행일
 *   광고성 정보 수신  온보딩 화면의 동의 문구가 바뀐 날
 */
export const AGREEMENT_VERSION = {
  [AGREEMENT_TYPE.terms]: '2026-08-22',
  [AGREEMENT_TYPE.privacy]: '2026-08-27',
  [AGREEMENT_TYPE.marketing]: '2026-08-28',
} as const

/** 동의하지 않으면 가입이 끝나지 않는 항목 */
export const REQUIRED_AGREEMENTS = [AGREEMENT_TYPE.terms, AGREEMENT_TYPE.privacy] as const
