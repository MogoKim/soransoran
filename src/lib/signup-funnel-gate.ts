import 'server-only'

import { isSignupFunnelDay } from '@/lib/signup-funnel'

/**
 * 회원가입 전환 수집 gate — KST 날짜와 수집 시작일로 "지금 Production 카운터를 열어도 되는가" 를 판정한다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-3 · §8-7.
 *
 * 🔴 세 조건이 **모두** 맞을 때만 연다.
 *      1. VERCEL_ENV === 'production'
 *      2. SIGNUP_FUNNEL_COLLECTION_START 가 실제로 있는 'YYYY-MM-DD'
 *      3. 지금 KST 날짜 ≥ 시작일
 *    수집 시작일과 기록 스위치는 이 env 값 하나다. 별도 on/off 를 두지 않는다.
 *
 * 🔴 env 가 없거나 틀려도 throw 하지 않는다 — 닫힌 것으로 판정한다. 계측 설정 오류가 화면을 깨면 안 된다.
 * 🔴 시계와 env 를 인자로 받는다. 이 파일이 `new Date()` · `process.env` 를 직접 읽지 않아야
 *    시험이 모든 조합과 자정 경계를 그대로 재현할 수 있다.
 * 🔴 writer 와 reader 가 같은 함수를 본다(§8-7). 판정이 두 곳이 되면 언젠가 갈린다.
 */

export type SignupFunnelEnv = {
  VERCEL_ENV?: string
  SIGNUP_FUNNEL_COLLECTION_START?: string
}

export type SignupFunnelGate =
  | { active: true; startDay: string; today: string }
  | { active: false; reason: 'not_production' | 'start_invalid' | 'before_start' }

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 받은 시각의 KST 달력 날짜 'YYYY-MM-DD' — 집계 day 를 서버가 정하는 자리다 */
export function toKstDay(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

export function signupFunnelGate(env: SignupFunnelEnv, now: Date): SignupFunnelGate {
  if (env.VERCEL_ENV !== 'production') return { active: false, reason: 'not_production' }

  const startDay = env.SIGNUP_FUNNEL_COLLECTION_START
  if (!isSignupFunnelDay(startDay)) return { active: false, reason: 'start_invalid' }

  const today = toKstDay(now)
  // 두 값 모두 'YYYY-MM-DD' 라 문자열 비교가 날짜 비교다
  if (today < startDay) return { active: false, reason: 'before_start' }

  return { active: true, startDay, today }
}

/**
 * 이 상세 화면에 로그인되지 않은 방문 tracker 를 그릴 것인가.
 *
 * 🔴 gate 가 먼저다. 닫혀 있으면 세션을 묻지 않는다 — 수집 전에는 판정 비용이 0 이다.
 * 🔴 세션은 같은 요청의 공유 판정을 받는다(getRequestSession). 이 함수가 auth() 를 부르지 않는다.
 * 🔴 세션 판정이 실패하면 로그아웃으로 단정하지 않는다 — 그리지 않는다.
 */
export async function shouldTrackLoggedOutView(
  env: SignupFunnelEnv,
  now: Date,
  getSession: () => Promise<{ user?: unknown } | null>,
): Promise<boolean> {
  if (!signupFunnelGate(env, now).active) return false
  try {
    const session = await getSession()
    return !session?.user
  } catch {
    return false
  }
}
