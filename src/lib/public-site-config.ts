/**
 * 공개 웹 설정 — 도메인·분석·검색 인증의 단일 지점
 *
 * 여기 있는 값은 **전부 브라우저에 그대로 노출된다.** HTML meta 와 GA 스크립트로
 * 나가는 값이라 비밀이 아니다. 비밀은 아니지만 **바꿔야 할 때 빠뜨리면
 * 에러 없이 조용히 실패한다** — 그게 이 파일이 있는 이유다.
 *
 * 🔴 도메인이 바뀌는 날 이 파일을 못 찾으면 무슨 일이 벌어지나
 *      GA host 목록이 옛 도메인이면 → shouldTrack() 이 false 가 되어 **수집이 0 이 된다.**
 *                                      화면은 정상이고 콘솔에도 아무 말이 없다.
 *      네이버 인증값이 옛것이면      → 사이트 소유확인이 풀려 **색인이 멈춘다.**
 *    둘 다 "장애"로 보이지 않아서 며칠 뒤에야 지표로 알아챈다.
 *
 * 🔴 비밀값은 여기 두지 않는다.
 *    KAKAO_CLIENT_SECRET · NEXTAUTH_SECRET · DATABASE_URL 같은 값은
 *    이 파일에 이름조차 적지 않는다 — 필요한 환경변수 이름과 외부 콘솔 절차는
 *    src/lib/rebrand-manifest.ts 가 값 없이 기록한다.
 *
 * 🔴 환경변수·서버 전용 로직을 넣지 않는다.
 *    brand.ts 가 그 반례다 — 최상위에서 process.env 를 읽고 new URL() 로 파싱하는데,
 *    최상위 호출이라 tree-shaking 으로 떨어지지 않아 값 하나만 가져와도
 *    URL 해석 로직 전체가 클라이언트 번들에 함께 실린다.
 *    이 파일은 순수 상수만 두어 'use client' 컴포넌트가 가져다 써도 안전하게 유지한다.
 *    (GoogleAnalytics.tsx 가 실제로 client 다)
 */

/**
 * 운영 도메인의 호스트.
 *
 * 🔴 도메인 문자열의 정의는 여기 한 곳이다. brand.ts 의 DEFAULT_SITE_URL 도 이 값을 쓴다.
 */
export const PRIMARY_HOST = 'soransoran.com'

/** 운영 도메인의 origin. 환경변수가 하나도 없을 때의 최종 기준값이 된다 */
export const PRIMARY_ORIGIN = `https://${PRIMARY_HOST}`

/**
 * GA4 를 실제로 켜는 호스트 목록.
 *
 * 🔴 SITE.url 에서 파생하지 않는다. SITE.url 은 환경변수에 따라 preview 주소가 되는데,
 *    그러면 preview 배포의 방문이 운영 지표에 섞인다. 고정 목록이어야 한다.
 */
export const TRACKED_HOSTS = [PRIMARY_HOST, `www.${PRIMARY_HOST}`] as const

/**
 * GA4 측정 ID.
 *
 * 🔴 도메인 종속이 아니다 — 도메인이 바뀌어도 같은 속성을 쓸 수 있다.
 *    다만 GA 콘솔의 데이터 스트림에 새 도메인을 등록해야 하고,
 *    브랜드가 완전히 갈리면 속성을 새로 파는 편이 지표 해석에 낫다(운영 판단).
 */
export const GA_MEASUREMENT_ID = 'G-PW9HHV2LLL'

/**
 * 네이버 Search Advisor 사이트 소유확인 값.
 *
 * 🔴 **도메인 종속이다.** 네이버는 사이트(도메인)마다 다른 값을 발급한다.
 *    도메인을 바꾸면 이 값은 그 순간 무효가 되고, 새 사이트를 등록해
 *    새 값을 받아 여기에 넣어야 한다. 옛 값을 그대로 두면 소유확인이 풀린 채
 *    아무 에러 없이 색인만 멈춘다.
 *
 * 🔴 우나어에서 네이버 색인이 0 이 된 이력이 있다. 이 값은 신중히 다룬다.
 */
export const NAVER_SITE_VERIFICATION = '5fb6a5b550994c0658f1dd81543e86f5a211ce29'
