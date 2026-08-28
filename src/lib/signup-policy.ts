import type { KakaoGender } from '@/lib/kakao-profile'

/**
 * 가입 자격 판정 — 소란소란은 여성을 위한 커뮤니티다.
 *
 * 🔴 판정은 이 파일 하나에서만 한다.
 *    화면에서 버튼을 감추는 것은 안내이지 방어가 아니고,
 *    콜백 안에 조건을 흩어 두면 어느 날 한쪽만 고쳐진다.
 *
 * 🔴 막는 것은 male 하나다.
 *      female        통과
 *      male          차단
 *      값 없음       통과   ← 동의했어도 카카오 계정에 값이 없으면 오지 않는다.
 *                            그 사람까지 막으면 여성인데 못 들어오는 사람이 생긴다.
 *      기존 회원     통과   ← 이미 쓰고 있는 사람의 로그인을 새 정책으로 끊지 않는다
 *      운영자        통과   ← 아래 allowlist
 */

/** 차단 사유 코드. 로그인 화면이 이 값으로 안내를 고른다 */
export const SIGNUP_BLOCKED = 'female_only' as const

export type SignupDecision =
  | { allowed: true; reason: 'female' | 'gender_unknown' | 'existing_member' | 'allowlisted' }
  | { allowed: false; reason: typeof SIGNUP_BLOCKED }

/**
 * 운영자 예외 목록 — 쉼표로 구분한 카카오 회원번호 또는 이메일.
 *
 * 🔴 코드에 사람을 적어 두지 않는다. 환경변수로 둬야 사람이 바뀔 때 배포가 필요 없다.
 * 🔴 값이 없으면 아무도 통과시키지 않는다. 비어 있는 것이 기본이다.
 *
 * 예: SIGNUP_ALLOWLIST="1234567890,operator@example.com"
 */
function allowlist(): Set<string> {
  const raw = process.env.SIGNUP_ALLOWLIST
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isAllowlisted(providerAccountId?: string, email?: string | null): boolean {
  const list = allowlist()
  if (list.size === 0) return false
  if (providerAccountId && list.has(providerAccountId.trim().toLowerCase())) return true
  if (email && list.has(email.trim().toLowerCase())) return true
  return false
}

export function decideSignup(input: {
  gender: KakaoGender | undefined
  /** 이미 User 행이 있는가 */
  isExistingMember: boolean
  providerAccountId?: string
  email?: string | null
}): SignupDecision {
  // 순서가 정책이다. 기존 회원과 운영자는 성별을 보기 전에 통과한다.
  if (input.isExistingMember) return { allowed: true, reason: 'existing_member' }
  if (isAllowlisted(input.providerAccountId, input.email)) {
    return { allowed: true, reason: 'allowlisted' }
  }
  if (input.gender === 'male') return { allowed: false, reason: SIGNUP_BLOCKED }
  if (input.gender === 'female') return { allowed: true, reason: 'female' }
  return { allowed: true, reason: 'gender_unknown' }
}
