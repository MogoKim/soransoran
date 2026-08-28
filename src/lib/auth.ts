import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './prisma'
import { authConfig } from './auth.config'
import { hasAnyConsentField, readKakaoConsent } from '@/lib/kakao-profile'

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
     * 이미 가입한 회원의 동의 항목을 채운다.
     *
     * 🔴 provider 의 profile() 은 User 를 **처음 만들 때만** 쓰인다.
     *    adapter 는 재로그인에서 getUserByAccount 로 찾은 User 를 그대로 돌려줄 뿐
     *    updateUser 를 부르지 않는다. 그래서 먼저 가입한 사람은 동의 항목이 비어 있고,
     *    채울 수 있는 자리가 여기뿐이다.
     *
     * 🔴 이 콜백은 로그인을 막지 않는다. false 도 경로 문자열도 돌려주지 않는다.
     *    성별 차단·운영자 예외는 다음 PR 이다. 저장에 실패해도 로그인은 계속된다 —
     *    값을 못 채운 것과 사람이 못 들어오는 것은 무게가 다르다.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== 'kakao' || !profile) return true

      try {
        const linked = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: 'kakao',
              providerAccountId: String(account.providerAccountId),
            },
          },
          select: { userId: true },
        })
        // 신규 가입은 profile() 이 이미 채운다. 여기서 손댈 것이 없다.
        if (!linked) return true

        const consent = readKakaoConsent(profile)
        // 받은 것이 하나도 없으면 쓰지 않는다. 빈 update 로 updatedAt 만 흔들지 않는다.
        if (!hasAnyConsentField(consent)) return true

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
        // 🔴 어느 계정인지 남기지 않는다. 실패해도 로그인은 통과시킨다.
        console.error('[auth] consent backfill failed:', (error as Error).message)
      }

      return true
    },
  },
})
