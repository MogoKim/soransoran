import type { NextAuthConfig } from 'next-auth'
import Kakao from 'next-auth/providers/kakao'

/**
 * NextAuth v5 — 카카오 전용
 *
 * 🔴 우나어의 KAKAO_CLIENT_ID / SECRET / callback URL 을 재사용하지 않는다.
 *    callback URL 은 도메인에 묶이므로 공유하면 두 서비스의 로그인이 서로를 침범한다.
 *    소란소란 전용 Kakao 앱에서 신규 발급한 값을 쓴다.
 */
export const authConfig: NextAuthConfig = {
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
    authorized({ auth }) {
      return Boolean(auth?.user)
    },
  },
}
