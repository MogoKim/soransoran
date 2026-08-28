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
       * 🔴 authorization 을 건드리지 않는다.
       *    Kakao provider 의 기본값은 URL **문자열** 인데, 여기에 객체를
       *    ({ params: { scope } }) 넘기면 Auth.js 의 merge 가 문자열을 통째로
       *    덮어써 URL 이 사라진다. 그러면 authorize 주소가
       *    https://authjs.dev/... 로 만들어지고 로그인 버튼이 아무 데도 가지 않는다.
       *    (@auth/core lib/utils/providers.js 에 "authorization: string or object 를
       *     아직 지원하지 않는다" 고 적혀 있다. 2026-08-28 실제로 겪었다)
       *
       *    scope 를 적을 필요도 없다 — 카카오는 콘솔에서 [필수 동의] 로 둔 항목을
       *    기본으로 요청한다. 성별·출생연도·전화번호는 그렇게 이미 들어온다.
       *    정말 넣어야 할 날이 오면 객체가 아니라 전체 URL 문자열로 준다.
       */

      /**
       * 기본 profile() 은 id·name·email·image 만 남기고 나머지를 버린다.
       * userinfo 응답(v2/user/me)에 동의 항목이 이미 들어 있으므로
       * 카카오 API 를 따로 부를 필요가 없다 — 버려지는 것을 주워 담기만 한다.
       *
       * 🔴 여기서 돌려준 값은 그대로 prisma.user.create 로 간다.
       *    컬럼이 없는 필드를 넣으면 Unknown argument 로 던져 로그인이 전면 실패한다.
       *    (0009 migration 은 2026-08-28 적용 완료)
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
