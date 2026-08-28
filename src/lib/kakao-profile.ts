/**
 * 카카오가 준 응답에서 우리가 쓰는 항목만 꺼낸다.
 *
 * 🔴 이 파일은 Prisma 도 auth 도 부르지 않는다.
 *    auth.config.ts 는 Edge 에서 돌아 Prisma 를 쓸 수 없고,
 *    profile() 과 signIn 이 같은 함수를 봐야 두 곳의 해석이 갈라지지 않는다.
 *
 * 🔴 없는 값은 null 이 아니라 undefined 로 돌려준다.
 *    Prisma adapter 가 undefined 를 걸러 내므로, 동의하지 않은 항목이
 *    빈 값으로 덮어써지지 않는다.
 */

/** 카카오가 주는 성별. 이 둘 말고는 오지 않는다 */
export type KakaoGender = 'female' | 'male'

export type KakaoConsentFields = {
  gender?: KakaoGender
  /** "1975" 같은 네 자리 문자열. 숫자로 바꾸지 않는다 */
  birthyear?: string
  /** "+82 10-1234-5678" 형식. 정규화하지 않고 원문을 둔다 */
  phoneNumber?: string
}

function kakaoAccount(profile: unknown): Record<string, unknown> | undefined {
  if (!profile || typeof profile !== 'object') return undefined
  const account = (profile as Record<string, unknown>).kakao_account
  return account && typeof account === 'object' ? (account as Record<string, unknown>) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * 성별만 따로 읽는다. 다른 항목과 섞어 읽다가 실수하지 않도록 분리했다.
 * 동의했더라도 카카오 계정에 값이 없으면 오지 않는다 → undefined.
 */
function readKakaoGender(profile: unknown): KakaoGender | undefined {
  const value = text(kakaoAccount(profile)?.gender)
  return value === 'female' || value === 'male' ? value : undefined
}

/** 저장할 동의 항목. 하나도 없으면 빈 객체 */
export function readKakaoConsent(profile: unknown): KakaoConsentFields {
  const account = kakaoAccount(profile)
  if (!account) return {}
  return {
    gender: readKakaoGender(profile),
    birthyear: text(account.birthyear),
    phoneNumber: text(account.phone_number),
  }
}

/** 하나라도 받았는가 — 동의 시각을 남길지 정한다 */
export function hasAnyConsentField(fields: KakaoConsentFields): boolean {
  return Boolean(fields.gender || fields.birthyear || fields.phoneNumber)
}
