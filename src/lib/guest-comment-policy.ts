/**
 * 비회원 댓글 입력 정책. 서버 액션과 입력 폼이 같은 값을 본다.
 *
 * 🔴 본문 길이·금칙어는 회원 댓글과 같은 것을 쓴다(comment-policy · content-guard).
 *    비회원이라고 기준을 낮추면 스팸이 그쪽으로 몰린다.
 */
import { COMMENT_NOT_FOUND } from '@/lib/comment-policy'

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

/**
 * 칸 이름 — 🔴 무엇을 적는 칸인지가 아니라 **어디에 쓰이는지**를 적는다.
 *    '이름' · '비밀번호' 는 가입 양식처럼 읽혀 그 자리에서 사람을 멈추게 했다.
 *    이 두 칸은 계정을 만드는 것이 아니라 이 댓글 한 줄에만 쓰인다.
 */
export const GUEST_NICKNAME_LABEL = '댓글 남길 이름'
export const GUEST_PASSWORD_LABEL = '수정·삭제용 번호'
/**
 * 번호 칸 아래 한 줄.
 *
 * 🔴 쓰임새와 **되찾을 수 없다는 사실**을 함께 말한다.
 *    한때 쓰임새만 남기고 뒤 문장을 뺐는데, 4자리 숫자는 서버에 해시로만 있어
 *    정말로 되찾아 줄 방법이 없다. 그 사실을 나중에 알게 되면 고칠 기회 자체가 없다.
 * 🔴 두 줄로 나누지 않는다. 짧은 칸 아래에 문장이 둘이면 그 자체로 무거워진다.
 */
export const GUEST_PASSWORD_HINT = '댓글 수정·삭제할 때만 써요 · 잊으면 되찾을 수 없어요'

/**
 * 사람 인증을 기다리다 시간이 다 됐을 때.
 *
 * 🔴 "봇으로 보인다" 고 말하지 않는다. 대부분은 네트워크가 느렸을 뿐이고,
 *    처음 온 사람에게 의심부터 말하면 다시 쓰지 않는다.
 * 🔴 다음 행동을 적는다 — 쓴 글은 그대로 남아 있으니 다시 누르기만 하면 된다.
 */
export const GUEST_TURNSTILE_TIMEOUT = '확인이 늦어지고 있어요. 쓰신 글은 그대로 있으니 등록을 다시 눌러주세요.'

/**
 * 대화형 확인이 화면에 떠 있는 동안 폼 안에 남는 한 줄.
 *
 * 🔴 "기다려 주세요" 가 아니라 **할 일**을 적는다. 이 단계는 사람이 눌러야 끝난다.
 */
export const GUEST_CHALLENGE_PENDING = '위 확인을 마치면 바로 등록돼요.'

/**
 * 대화형 확인을 끝내 마치지 못했을 때.
 *
 * 🔴 `GUEST_TURNSTILE_TIMEOUT` 과 다른 문장을 쓴다. 그쪽은 아무것도 뜨지 않아
 *    기다리기만 한 경우이고, 이쪽은 화면에 뜬 확인이 남아 있는 경우다 —
 *    다음에 할 일이 다르므로 같은 말로 묶지 않는다.
 */
export const GUEST_CHALLENGE_TIMEOUT = '확인을 마치지 못했어요. 쓰신 글은 그대로 있으니 위 확인을 끝내고 등록을 다시 눌러주세요.'

export const GUEST_NICKNAME_INVALID = `이름은 ${GUEST_NICKNAME_MIN}~${GUEST_NICKNAME_MAX}자로 적어주세요.`
export const GUEST_PASSWORD_INVALID = '비밀번호는 숫자 4자리로 적어주세요.'
export const GUEST_NICKNAME_TAKEN = '이미 쓰고 있는 이름이에요. 다른 이름으로 해주세요.'
export const GUEST_PASSWORD_WRONG = '비밀번호가 맞지 않아요.'
export const GUEST_LOCKED = `비밀번호를 ${GUEST_PASSWORD_MAX_ATTEMPTS}번 틀렸어요. 1분 뒤에 다시 시도해 주세요.`
/**
 * 🔴 회원 경로와 **같은 문장**을 쓴다. 댓글이 사라진 사실은 하나인데
 *    비회원에게만 다르게 말할 이유가 없다 — 정본 §12-20.
 */
export const GUEST_NOT_FOUND = COMMENT_NOT_FOUND
export const GUEST_ONLY = '회원이 쓴 댓글은 이 방법으로 고칠 수 없어요.'

/** 비회원 댓글임을 화면에서 알리는 말 */
export const GUEST_BADGE = '비회원'

/** 등록 뒤 가볍게 권하는 한 줄. 막지 않고 권하기만 한다. */
export const GUEST_SIGNUP_HINT = '카카오로 가입하시면 내가 쓴 댓글을 더 쉽게 관리할 수 있어요.'
