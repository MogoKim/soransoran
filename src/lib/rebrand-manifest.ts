/**
 * 리브랜딩 운영 manifest — 도메인이 바뀌는 날 무엇을 어떤 순서로 바꾸는가
 *
 * 🔴 코드는 이 목록을 읽지 않는다. 사람과 검사 스크립트가 읽는다.
 *    (brand-assets.ts 와 같은 성격이다)
 *
 * 🔴 **비밀값은 값이 아니라 이름만 적는다.**
 *    KAKAO_CLIENT_SECRET · NEXTAUTH_SECRET · DATABASE_URL 같은 것은
 *    "이 환경변수를 어디에 새로 넣어야 한다"까지만 기록하고 값은 절대 두지 않는다.
 *    이 파일은 저장소에 커밋되고 PR 본문에도 인용된다.
 *
 * ── 이 manifest 가 보장하지 못하는 것 (과장하지 않는다) ──
 *   · 여기 적지 않은 전환 대상은 찾아내지 못한다. 사람이 적은 목록이다.
 *   · 외부 콘솔(카카오·GA·네이버·Vercel·DNS)의 실제 설정 상태를 읽지 못한다.
 *     manual 항목은 사람이 콘솔에서 직접 확인해야 한다.
 *   · 전환을 대신 실행해 주지 않는다.
 */

/**
 * 값을 어디가 소유하고, 어디까지 노출되는가.
 *
 * 🔴 "공개 환경변수" 한 덩어리로 묶지 않는다. 노출 범위가 서로 다르다 —
 *    묶어 두면 서버 전용 값을 브라우저에 내보내도 되는 것처럼 읽힌다.
 */
export type ConfigOwner =
  /** 저장소의 코드 정본. 파일을 고치면 반영된다 */
  | 'code'
  /**
   * NEXT_PUBLIC_* — 빌드 때 클라이언트 번들에 **값이 그대로 박힌다.**
   * 브라우저에서 읽을 수 있다는 전제로만 쓴다.
   */
  | 'client-public-env'
  /**
   * 서버에서만 읽는 환경변수. 비밀은 아니지만 **브라우저로 내보내지 않는다.**
   * 🔴 "비밀이 아니다"와 "공개해도 된다"는 다른 말이다.
   *    NEXT_PUBLIC_ 접두어를 붙이는 순간 성격이 바뀐다.
   */
  | 'server-non-secret-env'
  /**
   * 공개 식별자 — 값이 노출돼도 그 자체로 사고가 아니다.
   * KAKAO_CLIENT_ID 가 여기다. 앱을 식별할 뿐이고, 실제 방어는
   * 카카오 콘솔의 Redirect URI·도메인 등록이 한다.
   * 🔴 그래도 secret 과 같은 화면에서 다루므로 취급은 조심한다.
   */
  | 'public-identifier'
  /** 진짜 비밀. 값은 이 파일에도, 어떤 출력에도 적지 않는다 */
  | 'secret-env'
  /** 외부 서비스 콘솔에서만 바꿀 수 있다 */
  | 'external-console'

/**
 * 리브랜딩 때 이 값을 어떻게 하는가.
 *
 * 🔴 "바꿀 수 있다"와 "바꿔야 한다"를 구분한다. 섞으면 전환 당일에
 *    바꾸지 말아야 할 것까지 손대게 된다.
 */
export type RebrandPolicy =
  /** 리브랜딩이면 반드시 바뀐다 */
  | 'change'
  /** 조건에 따라 바꾼다. 조건은 각 항목의 policyWhy 에 적는다 */
  | 'review'
  /** 🔴 리브랜딩만으로는 바꾸지 않는다 */
  | 'keep'

export type RebrandStep =
  /** 브랜드명·자산 확정 — 도메인 없이 먼저 할 수 있다 */
  | 'decide'
  /** 도메인·DNS·메일 수신 준비 */
  | 'domain'
  /** 외부 서비스 등록(카카오·GA·검색엔진) */
  | 'external'
  /** 코드 변경 + preview 검증 */
  | 'code'
  /** production 전환과 사후 관측 */
  | 'cutover'

export type RebrandConfig = {
  /** 설정 ID — 검사·plan 출력의 키 */
  id: string
  /** 무엇인가 */
  what: string
  owner: ConfigOwner
  policy: RebrandPolicy
  /** 왜 그 정책인가 — review·keep 은 조건을 여기 적는다 */
  policyWhy: string
  /** 코드 정본 경로 또는 환경변수 이름. secret-env 는 이름만 */
  source: string
  /**
   * 정본 파일 안에서 현재 값을 담고 있는 export 이름.
   * 가드가 이 심볼을 읽어 "지금 값"을 얻는다 — 검사기에 값을 복사해 두지 않기 위해서다.
   * (환경변수·외부 콘솔 항목은 코드에 값이 없으므로 없다)
   */
  symbol?: string
  /**
   * 현재 값이 정본 밖에 있어도 되는 자리. legacyAllowed 와 같은 규칙이다 —
   * 정확한 파일 경로와 이유를 함께 적는다.
   */
  currentAlsoAllowed?: readonly { path: string; why: string }[]
  /**
   * 🔴 예전에 쓰던 값. 리브랜딩 후 **잔존을 찾기 위한 목록**이다.
   *
   *    정본만 바꾸면 가드는 새 값의 중복만 보고, 옛 값이 어딘가 남아 있어도 통과한다.
   *    옛 도메인·옛 이름이 남으면 링크가 죽거나 화면에 옛 브랜드가 그대로 뜬다 —
   *    둘 다 에러를 내지 않는다.
   *
   * 🔴 전환 절차는 순서를 강제한다:
   *      1) 지금 값을 여기 legacyValues 에 먼저 옮긴다
   *      2) 그다음 정본을 새 값으로 바꾼다
   *    순서를 뒤집으면 옛 값이 무엇이었는지 아무 데도 남지 않는다.
   *
   * 🔴 현재 값을 여기 중복해 넣지 않는다. 비밀값도 넣지 않는다(가드가 막는다).
   *    지금은 리브랜딩 전이라 전부 비어 있다.
   */
  legacyValues?: readonly string[]
  /**
   * 옛 값이 남아도 되는 **정확한 경로**와 이유.
   *
   * 🔴 디렉터리째 열지 않는다. 파일 하나씩, 이유와 함께 적는다.
   * 🔴 301 redirect 처럼 외부 콘솔에만 남는 값은 여기 적지 않는다 —
   *    코드에 없는 것을 코드 예외로 만들면 목록이 현실과 어긋난다.
   */
  legacyAllowed?: readonly { path: string; why: string }[]
  /** 도메인이 바뀌면 반드시 함께 바뀌어야 하는가 */
  domainBound: boolean
  /** 값이 비밀인가 — true 면 어떤 출력에도 값을 싣지 않는다 */
  secret: boolean
  step: RebrandStep
  /** 전환 뒤 무엇을 보고 성공을 판정하는가 */
  verify: string
  /** 실패하면 무엇으로 되돌리는가 */
  rollback: string
  /** 빠뜨렸을 때 실제로 벌어지는 일 */
  risk: string
}

export const REBRAND_CONFIGS: readonly RebrandConfig[] = [
  // ── 코드 정본 ──
  {
    id: 'primary-host',
    what: '운영 도메인 호스트 — SITE.url 의 최종 fallback',
    owner: 'code',
    policy: 'change',
    policyWhy: '새 도메인 그 자체다',
    source: 'src/lib/public-site-config.ts',
    symbol: 'PRIMARY_HOST',
    /**
     * 현재 값이 정본 밖에 있어도 되는 자리 — 경로와 이유를 함께 적는다.
     * 🔴 디렉터리째 열지 않는다.
     */
    currentAlsoAllowed: [
      {
        path: 'src/lib/public-site-info.ts',
        why: '문의 이메일 주소에 같은 도메인 문자열이 들어 있다. 이메일의 정본은 그쪽이다',
      },
    ],
    /** 🔴 리브랜딩 때 지금 값을 여기로 먼저 옮긴다. 지금은 전환 전이라 비어 있다 */
    legacyValues: [],
    legacyAllowed: [],
    domainBound: true,
    secret: false,
    step: 'code',
    verify: 'curl -s $NEW/sitemap.xml | grep -c $OLD_HOST → 0',
    rollback: 'git revert. 값은 커밋 이력에 남는다',
    risk: '환경변수가 비면 sitemap·canonical·OG 가 옛 도메인으로 나간다',
  },
  {
    id: 'tracked-hosts',
    what: 'GA4 를 켜는 호스트 목록',
    owner: 'code',
    policy: 'change',
    policyWhy: '새 호스트를 넣지 않으면 수집이 0 이 된다. 전환 기간에는 옛 호스트도 함께 둔다',
    source: 'src/lib/public-site-config.ts',
    domainBound: true,
    secret: false,
    step: 'code',
    verify: '새 도메인에서 GA 실시간 보고서에 방문이 잡히는지',
    rollback: 'git revert',
    risk: '🔴 옛 호스트만 남으면 shouldTrack() 이 false 가 되어 **수집이 0**. 에러도 로그도 없다',
  },
  {
    id: 'ga-measurement-id',
    what: 'GA4 측정 ID',
    owner: 'code',
    policy: 'review',
    policyWhy: '도메인 종속이 아니다. 속성을 유지하면 값 그대로, 새로 파면 교체 — 과거 지표 연속성과 맞바꾼다',
    source: 'src/lib/public-site-config.ts',
    symbol: 'GA_MEASUREMENT_ID',
    /** 🔴 리브랜딩 때 지금 값을 여기로 먼저 옮긴다. 지금은 전환 전이라 비어 있다 */
    legacyValues: [],
    legacyAllowed: [],
    domainBound: false,
    secret: false,
    step: 'external',
    verify: 'GA 콘솔 데이터 스트림에 새 도메인이 등록됐는지',
    rollback: 'git revert + GA 스트림 설정 되돌리기',
    risk: '속성을 새로 파면 과거 지표와 끊긴다 — 유지/신설은 운영 판단',
  },
  {
    id: 'naver-site-verification',
    what: '네이버 Search Advisor 소유확인 값',
    owner: 'code',
    policy: 'change',
    policyWhy: '🔴 네이버는 사이트(도메인)마다 다른 값을 발급한다. 새 값을 받아 넣어야 한다',
    source: 'src/lib/public-site-config.ts',
    symbol: 'NAVER_SITE_VERIFICATION',
    /** 🔴 리브랜딩 때 지금 값을 여기로 먼저 옮긴다. 지금은 전환 전이라 비어 있다 */
    legacyValues: [],
    legacyAllowed: [],
    domainBound: true,
    secret: false,
    step: 'external',
    verify: 'curl -s $NEW | grep naver-site-verification · Search Advisor 소유확인 통과',
    rollback: '옛 값으로 git revert (옛 도메인이 살아 있는 동안만 유효)',
    risk: '🔴 소유확인이 풀려 **색인이 멈춘다.** 화면은 정상이라 며칠 뒤 지표로 안다',
  },
  {
    id: 'contact-email',
    what: '고객 공개 문의 주소',
    owner: 'code',
    policy: 'review',
    policyWhy: '브랜드명이 주소에 들어 있으면 바꾼다. 다만 메일 수신 이전이 먼저다 — 코드만 고치면 메일이 오지 않는다',
    source: 'src/lib/public-site-info.ts',
    symbol: 'CONTACT_EMAIL',
    /** 🔴 리브랜딩 때 지금 값을 여기로 먼저 옮긴다. 지금은 전환 전이라 비어 있다 */
    legacyValues: [],
    legacyAllowed: [],
    domainBound: false,
    secret: false,
    step: 'decide',
    verify: '새 주소로 실제 메일이 도착하는지 (코드만 고치면 오지 않는다)',
    rollback: 'git revert. 옛 주소 수신은 유지해 둔다',
    risk: '약관·개인정보처리방침에 적힌 연락처라 함께 바뀐다. 수신 준비가 먼저다',
  },
  {
    id: 'brand-name',
    what: '서비스명',
    owner: 'code',
    policy: 'change',
    policyWhy: '리브랜딩의 정의 자체다. 조사(은/는)도 같은 파일에서 함께 정한다',
    source: 'src/lib/brand-name.ts',
    symbol: 'BRAND_NAME',
    /** 🔴 리브랜딩 때 지금 값을 여기로 먼저 옮긴다. 지금은 전환 전이라 비어 있다 */
    legacyValues: [],
    legacyAllowed: [],
    domainBound: false,
    secret: false,
    step: 'decide',
    verify: 'npm run check:brand · 화면 전체에서 옛 이름 0건',
    rollback: 'git revert',
    risk: '조사(은/는)도 같은 파일에서 함께 정한다 — 자동 판별하지 않는다',
  },

  // ── 환경변수 — 노출 범위가 서로 다르다 (ConfigOwner 주석 참조) ──
  {
    id: 'next-public-app-url',
    what: '공개 기준 URL — metadata·sitemap·OG 의 실제 기준',
    owner: 'client-public-env',
    policy: 'change',
    policyWhy: '새 도메인으로 바꾸지 않으면 canonical·OG·sitemap 이 옛 도메인으로 나간다',
    source: 'NEXT_PUBLIC_APP_URL',
    domainBound: true,
    secret: false,
    step: 'cutover',
    verify: 'curl -s $NEW | grep og:url · canonical 이 새 도메인인지',
    rollback: 'Vercel 환경변수를 옛 값으로 되돌리고 재배포',
    risk: '코드 fallback 보다 우선한다 — 여기가 옛 값이면 코드를 고쳐도 소용없다',
  },
  {
    id: 'nextauth-url',
    what: 'NextAuth 기준 URL — 카카오 callback 이 여기로 돌아온다',
    owner: 'server-non-secret-env',
    policy: 'change',
    policyWhy: '카카오 callback 이 여기로 돌아온다. 도메인이 바뀌면 반드시 함께 바뀐다',
    source: 'NEXTAUTH_URL',
    domainBound: true,
    secret: false,
    step: 'cutover',
    verify: '새 도메인에서 카카오 로그인 왕복 성공',
    rollback: 'Vercel 환경변수 되돌리고 재배포',
    risk: '🔴 카카오 콘솔 redirect URI 등록보다 먼저 바꾸면 **로그인 전면 실패**',
  },
  {
    id: 'soran-allow-indexing',
    what: '색인 허용 스위치 — preview 는 비워 둔다(전체 disallow)',
    owner: 'server-non-secret-env',
    policy: 'review',
    policyWhy: '값 자체는 전환 전후로 같을 수 있다. preview 에서 비우고 production 전환 뒤 켜는 운영 조작이다',
    source: 'SORAN_ALLOW_INDEXING',
    domainBound: false,
    secret: false,
    step: 'cutover',
    verify: 'curl -s $NEW/robots.txt',
    rollback: '값을 비우면 즉시 전체 disallow 로 돌아간다',
    risk: '새 도메인 preview 가 색인되면 중복 콘텐츠가 된다. 전환 전까지 비워 둔다',
  },

  // ── 카카오 앱 정보와 세션 키 — 값은 이름만 적는다 ──
  {
    id: 'kakao-client-id',
    what: '카카오 앱 키 — 새 앱을 쓸 경우에만 교체',
    owner: 'public-identifier',
    policy: 'review',
    policyWhy: '🔴 기존 앱에 Redirect URI 만 추가한다면 **값을 유지한다.** 새 앱을 만들 때만 교체한다',
    source: 'KAKAO_CLIENT_ID',
    /** 코드에 값이 없다(환경변수). 옛 식별자 잔존만 추적한다 */
    legacyValues: [],
    legacyAllowed: [],
    domainBound: false,
    secret: false,
    step: 'external',
    verify: '로그인 왕복 성공 (값을 로그에 찍지 않는다)',
    rollback: 'Vercel secret 을 옛 값으로 되돌린다',
    risk: '🔴 secret 이 아니다 — 브라우저에 노출돼도 그 자체로 사고가 아니다. 실제 방어는 카카오 콘솔의 Redirect URI·도메인 등록이 한다. 다만 secret 과 같은 화면에서 다루므로 취급은 조심한다',
  },
  {
    id: 'kakao-client-secret',
    what: '카카오 앱 시크릿',
    owner: 'secret-env',
    policy: 'review',
    policyWhy: '🔴 client ID 와 짝이다. 새 앱을 만들 때만 함께 교체하고, 기존 앱을 쓰면 유지한다',
    source: 'KAKAO_CLIENT_SECRET',
    domainBound: false,
    secret: true,
    step: 'external',
    verify: '로그인 왕복 성공',
    rollback: 'Vercel secret 되돌리기',
    risk: '🔴 값을 어디에도 출력하지 않는다',
  },
  {
    id: 'nextauth-secret',
    what: '세션 서명 키',
    owner: 'secret-env',
    policy: 'keep',
    policyWhy: '🔴 리브랜딩만으로 바꾸지 않는다. 바꾸면 전 회원의 로그인 세션이 무효가 된다. 보안 사고나 별도 키 회전 작업에서만 다룬다',
    source: 'NEXTAUTH_SECRET',
    domainBound: false,
    secret: true,
    step: 'cutover',
    verify: '기존 로그인 세션이 유지되는지',
    rollback: '옛 값 복구',
    risk: '바꾸면 전 회원이 로그아웃된다. 도메인 전환과 같은 날 바꾸지 않는다',
  },

  // ── 외부 콘솔 ──
  {
    id: 'kakao-redirect-uri',
    what: '카카오 개발자 콘솔 — Redirect URI · Web 사이트 도메인',
    owner: 'external-console',
    policy: 'change',
    policyWhy: '새 도메인 URI 를 등록하지 않으면 로그인이 실패한다. 옛 URI 는 지우지 않고 함께 둔다',
    source: '카카오 개발자 콘솔 > 내 애플리케이션 > 카카오 로그인',
    domainBound: true,
    secret: false,
    step: 'external',
    verify: '새 도메인에서 로그인 왕복 · 카카오톡 공유 동작',
    rollback: '새 URI 를 지우면 옛 도메인만 남는다 (옛 URI 를 먼저 지우지 않는다)',
    risk: '🔴 **옛 URI 를 먼저 지우면 전환 중 로그인이 끊긴다.** 둘 다 등록한 뒤 옮긴다',
  },
  {
    id: 'dns-vercel-domain',
    what: 'DNS 레코드 + Vercel 도메인 연결',
    owner: 'external-console',
    policy: 'change',
    policyWhy: '새 도메인을 서비스하려면 반드시 필요하다',
    source: 'DNS 관리 콘솔 · Vercel > Project > Domains',
    domainBound: true,
    secret: false,
    step: 'domain',
    verify: 'dig $NEW · curl -sI https://$NEW → 200',
    rollback: 'Vercel 에서 새 도메인을 primary 에서 내린다. 옛 도메인은 유지',
    risk: 'TTL 때문에 즉시 되돌아가지 않는다. 낮은 TTL 로 미리 준비한다',
  },
  {
    id: 'old-domain-redirect',
    what: '옛 도메인 → 새 도메인 301 redirect',
    owner: 'external-console',
    policy: 'change',
    policyWhy: '검색 순위 이전의 핵심이다. 켜지 않으면 두 도메인이 중복 콘텐츠로 경쟁한다',
    source: 'Vercel > Domains > Redirect',
    domainBound: true,
    secret: false,
    step: 'cutover',
    verify: 'curl -sI https://$OLD/ → 301 · Location 이 새 도메인',
    rollback: 'redirect 를 끄면 옛 도메인이 그대로 서비스한다',
    risk: '🔴 검색 순위 이전의 핵심이다. 끄면 두 도메인이 중복 콘텐츠가 된다',
  },
  {
    id: 'naver-search-advisor',
    what: '네이버 Search Advisor — 새 사이트 등록 · sitemap 제출',
    owner: 'external-console',
    policy: 'change',
    policyWhy: '🔴 유입 대부분이 네이버다. 새 사이트 등록과 sitemap 제출이 필요하다',
    source: 'searchadvisor.naver.com',
    domainBound: true,
    secret: false,
    step: 'external',
    verify: '소유확인 통과 · sitemap 제출 성공 · 며칠 뒤 색인 수',
    rollback: '옛 사이트 등록은 지우지 않는다',
    risk: '🔴 유입 대부분이 네이버다. 옛 사이트를 먼저 지우지 않는다',
  },
  {
    id: 'google-search-console',
    what: 'Google Search Console — 새 속성 + 주소 변경 도구',
    owner: 'external-console',
    policy: 'change',
    policyWhy: '새 속성 등록과 주소 변경 신청이 필요하다',
    source: 'search.google.com/search-console',
    domainBound: true,
    secret: false,
    step: 'external',
    verify: '소유확인 · 주소 변경 신청 접수',
    rollback: '옛 속성 유지',
    risk: '301 과 함께 써야 순위가 이전된다',
  },
  {
    id: 'ga-data-stream',
    what: 'GA4 데이터 스트림 — 새 도메인 등록',
    owner: 'external-console',
    policy: 'review',
    policyWhy: 'ga-measurement-id 와 짝이다. 속성을 유지하면 스트림에 새 도메인만 추가한다',
    source: 'analytics.google.com > 관리 > 데이터 스트림',
    domainBound: true,
    secret: false,
    step: 'external',
    verify: '실시간 보고서에 새 도메인 방문이 잡히는지',
    rollback: '스트림 설정 되돌리기',
    risk: 'TRACKED_HOSTS 코드 변경과 짝이다. 한쪽만 하면 수집이 0 이다',
  },
  {
    id: 'contact-mailbox',
    what: '문의 메일 수신 준비',
    owner: 'external-console',
    policy: 'review',
    policyWhy: 'contact-email 과 짝이다. 주소를 바꾸기로 하면 수신 준비가 먼저다',
    source: '메일 서비스 콘솔',
    domainBound: false,
    secret: false,
    step: 'decide',
    verify: '새 주소로 보낸 테스트 메일이 도착하는지',
    rollback: '옛 주소 수신 유지',
    risk: '🔴 코드만 고치면 메일이 오지 않는다. 수신이 먼저다',
  },
] as const

/** 도메인이 바뀌면 반드시 함께 움직여야 하는 설정 */
export const DOMAIN_BOUND = REBRAND_CONFIGS.filter((c) => c.domainBound)

/** 외부 콘솔에서만 바꿀 수 있는 설정 — 코드로 자동화되지 않는다 */
export const MANUAL_CONFIGS = REBRAND_CONFIGS.filter((c) => c.owner === 'external-console')

/** 값이 비밀이라 어떤 출력에도 싣지 않는 설정 */
export const SECRET_CONFIGS = REBRAND_CONFIGS.filter((c) => c.secret)

/** 리브랜딩이면 반드시 바뀌는 것 */
export const MUST_CHANGE = REBRAND_CONFIGS.filter((c) => c.policy === 'change')

/** 조건에 따라 바꾸는 것 — 조건은 policyWhy 에 있다 */
export const REVIEW_CONFIGS = REBRAND_CONFIGS.filter((c) => c.policy === 'review')

/** 🔴 리브랜딩만으로는 바꾸지 않는 것 */
export const KEEP_CONFIGS = REBRAND_CONFIGS.filter((c) => c.policy === 'keep')

/**
 * 옛 값을 추적할 수 있는 항목 — 리브랜딩 때 legacyValues 를 채우는 자리.
 * 🔴 정본을 바꾸기 **전에** 채운다. 뒤집으면 옛 값이 아무 데도 남지 않는다.
 */
export const LEGACY_TRACKED = REBRAND_CONFIGS.filter((c) => c.legacyValues !== undefined)

/** 전환 순서 — plan 출력과 runbook 이 같은 순서를 쓴다 */
export const STEP_ORDER: readonly RebrandStep[] = ['decide', 'domain', 'external', 'code', 'cutover']

export const STEP_LABEL: Record<RebrandStep, string> = {
  decide: '1. 브랜드 값·자산·메일 수신 확정',
  domain: '2. 도메인·DNS·Vercel 준비',
  external: '3. 외부 서비스 등록(카카오·GA·검색엔진)',
  code: '4. 코드 정본 변경 + preview QA',
  cutover: '5. production 전환과 사후 관측',
}
