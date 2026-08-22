import type { NextAuthConfig } from 'next-auth'
import Kakao from 'next-auth/providers/kakao'

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
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
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
