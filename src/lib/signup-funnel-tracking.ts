import 'server-only'

import { cache } from 'react'
import { shouldTrackSignupFunnel } from '@/lib/signup-funnel-gate'
import { getRequestSession } from '@/lib/request-session'

/**
 * 이 요청의 상세 화면에 회원가입 전환 tracker 를 그릴 것인가 — 요청 하나에 한 번만 판정한다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-7 · §8-11.
 *
 * 🔴 페이지가 tracker 와 감지 지점들을 그릴지 이 값 하나로 정한다. 감지 지점마다 따로 판정하지 않는다.
 * 🔴 gate 가 닫혀 있으면 세션을 묻지 않는다. 열려 있으면 같은 요청의 공유 세션을 본다 — 새 인증·DB 조회 0.
 * 🔴 env 는 gate 가 보는 두 값만 넘긴다.
 */
export const isSignupFunnelTracking = cache(() =>
  shouldTrackSignupFunnel(
    {
      VERCEL_ENV: process.env.VERCEL_ENV,
      SIGNUP_FUNNEL_COLLECTION_START: process.env.SIGNUP_FUNNEL_COLLECTION_START,
    },
    new Date(),
    getRequestSession,
  ),
)
