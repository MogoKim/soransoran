import type { NextAuthConfig } from 'next-auth'
import Kakao from 'next-auth/providers/kakao'
import { hasAnyConsentField, readKakaoConsent } from '@/lib/kakao-profile'

/**
 * NextAuth v5 — 카카오 전용
 *
 * 🔴 우나어의 KAKAO_CLIENT_ID / SECRET / callback URL 을 재사용하지 않는다.
 *    callback URL 은 도메인에 묶이므로 공유하면 두 서비스의 로그인이 서로를 침범한다.
 *    소란소란 전용 Kakao 앱에서 신규 발급한 값을 쓴다.
 *
 * 🔴 trustHost
 *    Auth.js 는 요청 헤더의 host 값을 신뢰해야 동작한다.
 *    Vercel preview 는 배포마다 도메인이 바뀌므로 명시해 두어야
 *    UntrustedHost 오류를 확실히 피할 수 있다.
 */
export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [
    Kakao({
      clientId: process.env.KAKAO_CLIENT_ID,
      clientSecret: process.env.KAKAO_CLIENT_SECRET,

      /**
       * 🔴 콘솔에서 승인받지 않은 항목을 여기 적으면 인가 단계에서 거부당한다.
       *    부분 실패가 아니라 로그인 전체가 막힌다. 항목을 늘리기 전에 콘솔부터 본다.
       *
       * 기본 provider 는 scope 를 비워 둬 앱의 기본 동의항목만 요청한다.
       * 우리는 가입 자격(성별·출생연도)과 본인 확인(전화번호)이 필요해 명시한다.
       */
      authorization: {
        params: {
          scope: 'profile_nickname profile_image account_email gender birthyear phone_number',
        },
      },

      /**
       * 🔴 기본 profile() 은 id·name·email·image 만 남기고 나머지를 버린다.
       *    userinfo 응답(v2/user/me)에는 동의 항목이 이미 들어 있으므로
       *    카카오 API 를 따로 부를 필요가 없다 — 버려지는 것을 주워 담기만 하면 된다.
       *
       * 🔴 여기서 돌려준 값은 그대로 prisma.user.create 로 간다.
       *    컬럼이 없는 필드를 넣으면 Unknown argument 로 던져 로그인이 전면 실패한다.
       *    (0009 migration 적용이 이 코드 배포보다 반드시 먼저다)
       */
      profile(profile) {
        const consent = readKakaoConsent(profile)
        return {
          id: String(profile.id),
          name: profile.kakao_account?.profile?.nickname,
          email: profile.kakao_account?.email,
          image: profile.kakao_account?.profile?.profile_image_url,
          ...consent,
          // 하나라도 받았을 때만 남긴다. 아무것도 못 받았는데 동의 시각이 찍히면 거짓이 된다.
          ...(hasAnyConsentField(consent) ? { profileConsentAt: new Date() } : {}),
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    /**
     * 🔴 error 를 비워 두면 NextAuth 가 /api/auth/error 로 보낸다.
     *    우리 디자인도 헤더도 없는 기본 화면이고, 왜 막혔는지 설명도 없다.
     *    AccessDenied 의 kind 는 'signIn' 이 아니라 'error' 라서
     *    pages.signIn 으로는 잡히지 않는다 — 이 줄이 있어야 한다.
     */
    error: '/login',
  },
  callbacks: {
    // JWT 전략이므로 매 요청 DB 조회 없이 토큰에 userId 를 실어 나른다.
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id
      return token
    },
    session({ session, token }) {
      if (session.user && typeof token.uid === 'string') {
        session.user.id = token.uid
      }
      return session
    },
    authorized({ auth }) {
      return Boolean(auth?.user)
    },
  },
}
