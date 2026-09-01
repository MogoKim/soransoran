/**
 * 비회원 댓글 입력 정책. 서버 액션과 입력 폼이 같은 값을 본다.
 *
 * 🔴 본문 길이·금칙어는 회원 댓글과 같은 것을 쓴다(comment-policy · content-guard).
 *    비회원이라고 기준을 낮추면 스팸이 그쪽으로 몰린다.
 */
export const GUEST_NICKNAME_MIN = 1
export const GUEST_NICKNAME_MAX = 10

/** 숫자 4자리 고정. 자유 문자열로 두면 사람들이 기억하지 못해 수정·삭제를 포기한다. */
export const GUEST_PASSWORD_LENGTH = 4
export const GUEST_PASSWORD_PATTERN = /^\d{4}$/

/** 비밀번호 연속 실패 허용 횟수와 잠금 시간 */
export const GUEST_PASSWORD_MAX_ATTEMPTS = 3
export const GUEST_LOCK_MS = 60 * 1000

export const GUEST_NICKNAME_PLACEHOLDER = '예: 소란맘'
export const GUEST_PASSWORD_PLACEHOLDER = '숫자 4자리'

export const GUEST_NICKNAME_INVALID = `이름은 ${GUEST_NICKNAME_MIN}~${GUEST_NICKNAME_MAX}자로 적어주세요.`
export const GUEST_PASSWORD_INVALID = '비밀번호는 숫자 4자리로 적어주세요.'
export const GUEST_NICKNAME_TAKEN = '이미 쓰고 있는 이름이에요. 다른 이름으로 해주세요.'
export const GUEST_PASSWORD_WRONG = '비밀번호가 맞지 않아요.'
export const GUEST_LOCKED = `비밀번호를 ${GUEST_PASSWORD_MAX_ATTEMPTS}번 틀렸어요. 1분 뒤에 다시 시도해 주세요.`
export const GUEST_NOT_FOUND = '댓글을 찾을 수 없습니다.'
export const GUEST_ONLY = '회원이 쓴 댓글은 이 방법으로 고칠 수 없어요.'

/** 비회원 댓글임을 화면에서 알리는 말 */
export const GUEST_BADGE = '비회원'

/** 등록 뒤 가볍게 권하는 한 줄. 막지 않고 권하기만 한다. */
export const GUEST_SIGNUP_HINT = '카카오로 가입하시면 내가 쓴 댓글을 더 쉽게 관리할 수 있어요.'
