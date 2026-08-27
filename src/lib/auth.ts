import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './prisma'
import { authConfig } from './auth.config'
import {
  hasAnyConsentField,
  readKakaoConsent,
  readKakaoEmail,
  readKakaoGender,
} from '@/lib/kakao-profile'
import { SIGNUP_BLOCKED, decideSignup } from '@/lib/signup-policy'

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
     * 🔴 false 대신 경로 문자열을 돌려준다.
     *    false 는 "왜 안 되는지" 를 전할 수단이 없어 안내 화면을 고를 수 없다.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== 'kakao' || !profile) return false

      const providerAccountId = String(account.providerAccountId)

      // 이미 쓰고 있는 사람인가. Account 로 본다 — User.providerId 는 adapter 가 채우지 않는다.
      const linked = await prisma.account.findUnique({
        where: {
          provider_providerAccountId: { provider: 'kakao', providerAccountId },
        },
        select: { userId: true },
      })

      const decision = decideSignup({
        gender: readKakaoGender(profile),
        isExistingMember: Boolean(linked),
        providerAccountId,
        email: readKakaoEmail(profile),
      })

      if (!decision.allowed) {
        // 🔴 어느 계정이 막혔는지 남기지 않는다. 정책 차단은 사유 코드로 충분하다.
        console.info('[auth] signup blocked:', decision.reason)
        return `/login?error=${SIGNUP_BLOCKED}`
      }

      // 기존 회원 보정 — adapter 는 재로그인 때 User 를 갱신하지 않는다.
      // 동의 항목을 새로 받았거나 카카오에서 바뀌었으면 이때만 채울 수 있다.
      if (linked) {
        const consent = readKakaoConsent(profile)
        if (hasAnyConsentField(consent)) {
          await prisma.user.update({
            where: { id: linked.userId },
            data: { ...consent, profileConsentAt: new Date() },
          })
        }
      }

      return true
    },
  },
})
