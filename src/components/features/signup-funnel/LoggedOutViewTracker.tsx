import type { SignupFunnelContentType } from '@/lib/signup-funnel'
import { shouldTrackLoggedOutView } from '@/lib/signup-funnel-gate'
import { getRequestSession } from '@/lib/request-session'
import LoggedOutViewBeacon from '@/components/features/signup-funnel/LoggedOutViewBeacon'

/**
 * 회원가입 전환 ① logged_out_view 의 서버 경계 — 그릴지 말지만 정한다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-1 · §8-2 · §8-7 · §8-11.
 *
 * 🔴 수집 gate 가 닫혀 있으면 세션도 묻지 않고 아무것도 그리지 않는다. client 조각이 응답에 실리지 않는다.
 * 🔴 로그인 판정은 같은 요청의 공유 세션(getRequestSession)이다. 새 인증·DB 조회를 더하지 않는다.
 * 🔴 env 는 gate 가 보는 두 값만 넘긴다.
 */
export default async function LoggedOutViewTracker({ contentType }: { contentType: SignupFunnelContentType }) {
  const track = await shouldTrackLoggedOutView(
    {
      VERCEL_ENV: process.env.VERCEL_ENV,
      SIGNUP_FUNNEL_COLLECTION_START: process.env.SIGNUP_FUNNEL_COLLECTION_START,
    },
    new Date(),
    getRequestSession,
  )
  if (!track) return null
  return <LoggedOutViewBeacon contentType={contentType} />
}
