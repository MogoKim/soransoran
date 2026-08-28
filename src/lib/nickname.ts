/**
 * 닉네임 정책. 화면과 서버 액션이 같은 값을 본다.
 *
 * 🔴 이 파일은 Prisma 도 auth 도 부르지 않는다.
 *    형식 검사는 순수 함수로 두어야 화면에서도 서버에서도 같은 판정이 나온다.
 *    중복 확인만 DB 가 필요하고, 그것은 서버 액션의 몫이다.
 */

export const NICKNAME_MIN = 2
export const NICKNAME_MAX = 10

/** 한글·영문·숫자만. 공백과 특수문자는 받지 않는다 */
export const NICKNAME_PATTERN = /^[가-힣a-zA-Z0-9]+$/

/**
 * 쓸 수 없는 이름.
 *
 * 🔴 운영자를 사칭하는 이름을 막는다. 커뮤니티에서 이름은 신뢰의 첫 단서다.
 *    서비스 이름 자체도 막는다 — 공식 계정으로 오인된다.
 */
export const BANNED = ['운영자', '관리자', '어드민', '관리인', 'admin', '소란소란'] as const

export const NICKNAME_PLACEHOLDER = '예: 봄볕드는창가'
export const NICKNAME_RULE_HINT = `한글·영문·숫자 ${NICKNAME_MIN}~${NICKNAME_MAX}자. 나중에 바꾸실 수 있어요.`
export const NICKNAME_TAKEN = '이미 쓰고 있는 이름이에요. 다른 이름을 지어주세요.'
export const NICKNAME_AVAILABLE = '쓰실 수 있는 이름이에요'

/**
 * 형식 검사. 문제가 없으면 null 을 돌려준다.
 *
 * 🔴 무엇이 잘못됐는지 하나씩 알려준다. "사용할 수 없습니다" 한 줄로 뭉치면
 *    사람은 무엇을 고쳐야 할지 모른 채 같은 실수를 반복한다.
 */
export function validateNicknameFormat(value: string): string | null {
  const trimmed = value.trim()

  if (!trimmed) return '닉네임을 입력해 주세요.'
  if (/\s/.test(trimmed)) return '띄어쓰기는 넣을 수 없어요.'
  if (trimmed.length < NICKNAME_MIN) return `${NICKNAME_MIN}자 이상 입력해 주세요.`
  if (trimmed.length > NICKNAME_MAX) return `${NICKNAME_MAX}자 이하로 입력해 주세요.`
  if (!NICKNAME_PATTERN.test(trimmed)) return '한글, 영문, 숫자만 쓸 수 있어요.'

  const lower = trimmed.toLowerCase()
  if (BANNED.some((word) => lower.includes(word.toLowerCase()))) {
    return '쓸 수 없는 이름이에요. 다른 이름을 지어주세요.'
  }

  return null
}
