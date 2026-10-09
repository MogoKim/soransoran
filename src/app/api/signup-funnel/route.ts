import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleSignupFunnelRequest } from '@/lib/signup-funnel-endpoint'
import { incrementSignupFunnel } from '@/lib/signup-funnel-store'

/**
 * 익명 회원가입 전환 기록 — ①~④ 단계만 받는다. 판정은 전부 signup-funnel-endpoint.ts 에 있다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8.
 *
 * 🔴 이 파일은 Production 의존(인증 · Prisma 싱글턴 · env · 시계)을 잇기만 한다. 판정을 여기 두지 않는다.
 * 🔴 GET 을 만들지 않는다. 링크·prefetch·크롤러가 기록 경로를 건드릴 문이 없어야 한다.
 * 🔴 robots.ts 가 '/api/' 를 Disallow 하고, 응답에 x-robots-tag: noindex 를 붙인다.
 */
export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return handleSignupFunnelRequest(request, {
    // 🔴 gate 가 보는 두 값만 넘긴다. 요청마다 읽으므로 env 를 바꾸면 다음 요청부터 반영된다.
    env: {
      VERCEL_ENV: process.env.VERCEL_ENV,
      SIGNUP_FUNNEL_COLLECTION_START: process.env.SIGNUP_FUNNEL_COLLECTION_START,
    },
    now: () => new Date(),
    isLoggedIn: async () => Boolean((await auth())?.user),
    increment: (key, now) => incrementSignupFunnel(prisma, key, now),
  })
}
