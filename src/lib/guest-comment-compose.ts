/**
 * 비회원 댓글 작성 폼의 진행 규칙 — 🔴 브라우저 · 네트워크 · React 없음.
 *
 * 폼 안에 두면 단계 전환을 화면 없이는 확인할 수 없다.
 * 여기 있으면 조건표를 전수로 돌려볼 수 있다(scripts/comment-compose-check.mts).
 */
import { MIN_COMMENT_LENGTH } from '@/lib/comment-policy'
import { GUEST_NICKNAME_MIN, GUEST_PASSWORD_LENGTH } from '@/lib/guest-comment-policy'

/**
 * 등록을 누른 뒤의 진행 단계.
 *
 * 🔴 'awaiting-token' 을 'submitting' 과 합치지 않는다.
 *    사람 인증을 기다리는 시간과 서버가 글을 받는 시간은 길이도 실패 사유도 다르다.
 *    한 상태로 묶으면 "등록 중…" 이라고 말해 놓고 아무 일도 일어나지 않는 구간이 생긴다.
 */
export type SubmitPhase =
  | 'idle'
  /** 위젯이 조용히 토큰을 만들어 주기를 기다린다 — 사람이 할 일은 없다 */
  | 'awaiting-token'
  /** 대화형 챌린지가 떠 있다 — **사람이 풀고 있다** */
  | 'solving-challenge'
  | 'submitting'

/**
 * 이름·번호 칸을 펼칠 것인가.
 *
 * 🔴 한번 펼쳐지면 닫지 않는다(단방향). 본문을 지웠다고 접으면
 *    (1) 쓰던 중에 화면이 위아래로 뛰고
 *    (2) 그 안의 Turnstile 위젯이 사라졌다 다시 붙어 받아 둔 토큰을 잃는다.
 *    접어서 얻는 것보다 잃는 것이 크다.
 */
export function resolveIdentityOpen(alreadyOpen: boolean, content: string): boolean {
  if (alreadyOpen) return true
  return content.trim().length > 0
}

/**
 * 등록을 시작할 수 있는가.
 *
 * 🔴 사람 인증 토큰을 조건에 넣지 않는다.
 *    인증 위젯은 평소 보이지 않게 바뀌었다 — 보이지 않는 것을 기다리라고 하면
 *    사용자는 회색 버튼 앞에서 이유를 모른 채 멈춘다.
 *    토큰은 누른 **뒤에** 기다린다. 서버 검증은 그대로이므로 느슨해지는 것은 없다.
 */
export function canSubmitGuestComment({
  content,
  nickname,
  password,
}: {
  content: string
  nickname: string
  password: string
}): boolean {
  if (content.trim().length < MIN_COMMENT_LENGTH) return false
  if (nickname.trim().length < GUEST_NICKNAME_MIN) return false
  if (password.length !== GUEST_PASSWORD_LENGTH) return false
  return true
}

/**
 * 등록을 눌렀을 때 폼이 할 일.
 *
 * 🔴 "이미 진행 중인가" 는 여기서 보지 않는다. 재진입 차단은 use-submit-guard 하나가 맡는다 —
 *    두 곳이 각자 막으면 한쪽이 푼 것을 다른 쪽이 모르는 순간이 생긴다.
 *    여기는 **토큰이 준비됐는가** 만 본다.
 */
export type SubmitPlan =
  /** 토큰이 아직 없다 — 기다렸다가 다시 보낸다 */
  | { action: 'wait' }
  /** 그대로 서버로 보낸다 */
  | { action: 'send' }

export function planSubmit({
  needsToken,
  hasToken,
}: {
  /** 사이트 키가 있어 위젯이 도는 환경인가 */
  needsToken: boolean
  hasToken: boolean
}): SubmitPlan {
  if (needsToken && !hasToken) return { action: 'wait' }
  return { action: 'send' }
}

/**
 * 진행 중 버튼에 적는 말.
 * 🔴 'idle' 에서도 부를 수 있어야 한다 — ActionButton 은 pendingLabel 을 늘 받는다.
 */
export function submitPendingLabel(phase: SubmitPhase): string {
  if (phase === 'awaiting-token') return '확인 중…'
  /**
   * 🔴 "확인 중…" 과 다른 말을 쓴다. 이 단계는 **사람이 움직여야** 끝난다 —
   *    기계가 처리 중인 것처럼 말하면 화면에 뜬 확인 상자를 기다리기만 한다.
   */
  if (phase === 'solving-challenge') return '확인을 기다려요'
  return '등록 중…'
}

/** 토큰을 기다리는 동안 한 틱마다 내리는 결정 */
export type WaitTick =
  | { action: 'submit' }
  | { action: 'keep-waiting' }
  /** 기다림을 끝낸다. reason 이 안내 문구를 가른다 */
  | { action: 'give-up'; reason: 'quiet' | 'challenge' }

/**
 * 🔴 사람이 챌린지를 푸는 동안에는 우리 시계를 멈춘다.
 *
 *    예전에는 누른 시각부터 10초를 세고 그때 위젯을 reset 했다. 확인 상자를 띄워 놓고
 *    글자를 읽고 있던 사람에게는 **풀던 것이 10초마다 사라지는** 화면이 된다.
 *    대화형 챌린지의 제한 시간은 Cloudflare 가 스스로 재고 timeout-callback 으로 알려 준다
 *    (refresh-timeout 기본값 auto 가 위젯 새로고침까지 맡는다).
 *    우리 타이머는 **아무도 아무것도 하지 않는 조용한 대기**에만 쓴다.
 *
 * 🔴 그래도 상한은 둔다. 위젯이 챌린지를 띄운 채 영영 아무 콜백도 주지 않으면
 *    사용자는 끝나지 않는 버튼 앞에 남는다. 다만 사람이 풀 시간은 넉넉해야 한다.
 */
export function evaluateTokenWait({
  hasToken,
  challengeActive,
  quietElapsedMs,
  challengeElapsedMs,
  quietLimitMs,
  challengeLimitMs,
}: {
  hasToken: boolean
  challengeActive: boolean
  /** 조용히 기다린 시간 — 챌린지가 떠 있는 동안은 늘지 않는다 */
  quietElapsedMs: number
  /** 챌린지가 떠 있은 시간 */
  challengeElapsedMs: number
  quietLimitMs: number
  challengeLimitMs: number
}): WaitTick {
  if (hasToken) return { action: 'submit' }
  if (challengeActive) {
    if (challengeElapsedMs >= challengeLimitMs) return { action: 'give-up', reason: 'challenge' }
    return { action: 'keep-waiting' }
  }
  if (quietElapsedMs >= quietLimitMs) return { action: 'give-up', reason: 'quiet' }
  return { action: 'keep-waiting' }
}
