import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './prisma'
import { authConfig } from './auth.config'
import { hasAnyConsentField, readKakaoConsent } from '@/lib/kakao-profile'
import { SIGNUP_BLOCKED_PATH, decideSignup } from '@/lib/signup-policy'

/**
 * session 전략은 JWT 를 유지하되 PrismaAdapter 를 함께 연결한다.
 *
 *   JWT      매 요청 DB 조회 없이 세션을 복원한다 (응답이 빠르다)
 *   Adapter  로그인 시 User·Account 를 DB 에 저장한다
 *
 * Adapter 가 없으면 로그인해도 User row 가 생기지 않아
 * Post.authorId(필수 FK)를 만들 수 없다 — 글쓰기가 구조적으로 불가능해진다.
 *
 * Session 테이블은 JWT 전략에서 사용하지 않는다(비어 있는 것이 정상).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,

    /**
     * 가입 자격 확인과 기존 회원 보정.
     *
     * 🔴 이 콜백은 User 행이 만들어지기 **전에** 돈다.
     *    여기서 막으면 차단된 사람의 계정이 DB 에 남지 않는다.
     *    jwt 나 화면에서 막으면 이미 만들어진 뒤라 지우는 일이 따로 생긴다.
     *
     * 🔴 false 를 돌려주지 않는다.
     *    false 는 NextAuth 기본 에러 흐름으로 빠져 어떤 안내를 보여줄지 고를 수 없다.
     *    경로 문자열을 돌려주면 그 주소로 보낸다.
     *
     * 🔴 어느 계정이 막혔는지 남기지 않는다. 정책 차단은 사유 코드로 충분하다.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'kakao' || !profile) return true

      const providerAccountId = String(account.providerAccountId)

      // 이미 쓰고 있는 사람인가. Account 로 본다 — User.providerId 는 adapter 가 채우지 않는다.
      let linked: { userId: string } | null = null
      try {
        linked = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: { provider: 'kakao', providerAccountId },
          },
          select: { userId: true },
        })
      } catch (error) {
        // 🔴 조회가 실패하면 막지 않는다.
        //    DB 가 흔들릴 때 신규 여성까지 차단하는 쪽이 더 나쁘다.
        console.error('[auth] member lookup failed:', (error as Error).message)
        return true
      }

      const consent = readKakaoConsent(profile)
      const decision = decideSignup({
        gender: consent.gender,
        isExistingMember: Boolean(linked),
        providerAccountId,
        email: user?.email,
      })

      if (!decision.allowed) {
        console.info('[auth] signup blocked:', decision.reason)
        return SIGNUP_BLOCKED_PATH
      }

      // 기존 회원 보정 — adapter 는 재로그인 때 User 를 갱신하지 않는다.
      // 신규 가입은 profile() 이 이미 채우므로 여기서 손댈 것이 없다.
      if (linked && hasAnyConsentField(consent)) {
        try {
          // 🔴 undefined 인 항목은 payload 에서 뺀다.
          //    Prisma 에서 undefined 는 "바꾸지 않음" 이라 그대로 넘겨도 안전하지만,
          //    payload 를 보면 무엇을 쓰는지 한눈에 보여야 나중에 실수가 없다.
          const data = Object.fromEntries(
            Object.entries(consent).filter(([, value]) => value !== undefined),
          )
          await prisma.user.update({
            where: { id: linked.userId },
            data: { ...data, profileConsentAt: new Date() },
          })
        } catch (error) {
          // 저장에 실패해도 로그인은 통과시킨다 —
          // 값을 못 채운 것과 사람이 못 들어오는 것은 무게가 다르다.
          console.error('[auth] consent backfill failed:', (error as Error).message)
        }
      }

      return true
    },
  },
})
