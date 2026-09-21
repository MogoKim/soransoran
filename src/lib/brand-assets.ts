/**
 * 브랜드 자산 manifest — 리브랜딩 때 무엇을 교체해야 하는지의 단일 목록
 *
 * 🔴 코드는 이 목록을 읽지 않는다. 사람과 검사 스크립트가 읽는다.
 *    자산 경로를 컴포넌트가 여기서 가져가게 만들면 Next.js 의 파일 규약
 *    (app/icon.png · app/opengraph-image.tsx)과 어긋나고, 빌드 최적화도 잃는다.
 *    그래서 "무엇이 어디 있는지"만 적고, 실제 참조는 각자의 자리에 둔다.
 *
 * 🔴 이 파일이 없으면 리브랜딩 당일에 자산을 눈으로 찾아야 한다.
 *    우나어는 로고가 6개 파일에 하드코딩돼 교체가 사실상 불가능했다 —
 *    목록이 없으면 빠뜨린 것을 빠뜨렸는지도 모른다.
 *
 * 제외한 것과 그 이유:
 *   매거진 콘텐츠 이미지   글의 일부지 브랜드 자산이 아니다(교체하면 글이 깨진다)
 *   사용자 업로드 이미지   회원의 것이다
 *   카카오 공식 자산·색    외부 브랜드다. 바꾸면 로그인 버튼이 카카오로 안 읽힌다(§4 격리)
 *   운영용 admin 이미지    고객면이 아니다
 *
 * ── 🔴 이 목록이 보장하지 못하는 것 (과장하지 않는다) ──
 *
 *   이 파일은 **사람이 적은 목록**이다. check:brand-assets 는 적힌 것이 실제와 맞는지만 본다.
 *
 *   보장한다
 *     · 엔트리 구조(필수 필드·category 값)가 유효하다
 *     · path 가 목록 안에서 유일하다(중복 등록 없음)
 *     · 필수 category 가 하나도 빠지지 않았다
 *     · 적힌 파일·코드 진입점이 실제로 존재한다
 *     · 외부 브랜드(locked)가 구분돼 있다
 *
 *   보장하지 못한다
 *     · **여기 적지 않은 새 브랜드 자산은 찾아내지 못한다.** 누군가 로고 이미지를
 *       새로 추가하고 이 목록에 넣지 않으면 검사는 그대로 통과한다.
 *       (자동 탐색은 매거진·사용자 이미지까지 끌어와 오탐이 되므로 하지 않는다)
 *     · 이미지 **안에** 브랜드 요소(글자·로고)가 들어 있는지 시각적으로 판정하지 못한다.
 *       note 의 "글자가 없다" 같은 서술은 사람이 열어 보고 적은 것이다.
 *     · 새 로고·아이콘을 만들어 주지 않는다. 교체는 사람의 일이다.
 *
 *   그래서 브랜드 자산을 추가할 때는 이 목록에 함께 적는다 —
 *   적지 않으면 리브랜딩 당일에 그 자산만 옛 브랜드로 남는다.
 */

export type BrandAssetKind =
  /** 저장소에 있는 파일. 교체하려면 사람이 새 파일을 만들어 덮어써야 한다 */
  | 'file'
  /** 코드가 그려낸다. 값을 고치면 따라 바뀐다 */
  | 'code'

/**
 * 자산의 역할 — 🔴 서로 배타적이다. 한 자산은 정확히 하나의 category 에 든다.
 *
 * kind(file/code) · replace · locked 는 축이 서로 겹치는 속성이라
 * 그것만으로 세면 같은 자산이 두 번 잡힌다.
 * (실제로 그렇게 셌다: LOCKED 1건이 kind=code 라 "코드 렌더 5"에 이미 들어 있는데
 *  따로 또 더해 11건을 12건으로 보고했다. category 는 그 이중 계산을 구조적으로 막는다)
 */
export type BrandAssetCategory =
  | 'app-icon'
  | 'apple-icon'
  | 'logo'
  | 'og'
  | 'manifest'
  | 'hero'
  | 'login-image'
  /** 외부 브랜드 — 우리 것이 아니다 */
  | 'external'

export type BrandAsset = {
  /** 파일 경로 또는 코드 진입점. 목록 안에서 유일해야 한다 */
  path: string
  kind: BrandAssetKind
  category: BrandAssetCategory
  /** 어디에 쓰이는가 */
  use: string
  /** 리브랜딩 때 반드시 교체해야 하는가 */
  replace: boolean
  /** 외부 브랜드라 바꾸면 안 되는가 */
  locked: boolean
  /**
   * 이미지 파일의 실제 픽셀 크기 — `'32x32'` 형식.
   *
   * 🔴 `kind: 'file'` 이면서 PNG 인 자산은 **반드시 적는다.**
   *    check:brand-assets 가 PNG 헤더를 직접 읽어 대조한다 —
   *    "180×180 으로 교체했다"는 note 의 서술만으로는 아무것도 보장하지 못한다.
   *    실제로 그 서술이 맞는지 아무도 확인하지 않은 채 반년을 지날 수 있다.
   */
  pixels?: string
  /** 판단 근거 — 실제로 열어 확인한 내용 */
  note: string
}

export const BRAND_ASSETS: readonly BrandAsset[] = [
  {
    path: 'src/app/icon.png',
    kind: 'file',
    category: 'app-icon',
    use: '브라우저 탭 favicon (Next.js app 규약)',
    replace: true,
    locked: false,
    pixels: '32x32',
    note:
      '✅ 2026-09-21 신규 브랜드로 **교체 완료 — C-반전안.** ' +
      '창업자 승인 원본 Favicon.png(1254×1254)에서 두 사람이 손을 맞대는 심볼만 ' +
      '뽑아, 진한 주황 면 위에 밝은 크림 심볼로 뒤집은 것이다. ' +
      '🔴 작은 크기에서 면이 먼저 보여야 하기 때문이다 — 크림 카드 안은 밝은 탭 배경에 ' +
      '묻힌다(실측: 크림안 32px 2.59:1 vs 이 안 2.89:1). 16px 축소도 형태가 남는다(2.40:1). ' +
      '🔴 **글자가 없다.** 이름이 바뀌어도 이 파일은 그대로 쓸 수 있다 — ' +
      '이전 자산(주황 바탕에 두 줄 글자)과 갈리는 지점이다. ' +
      'replace 는 true 로 둔다 — 다음 리브랜딩에서 사람이 다시 만들어야 하는 자산이라는 정책값이다.',
  },
  {
    path: 'src/app/apple-icon.png',
    kind: 'file',
    category: 'apple-icon',
    use: 'iOS 홈 화면 아이콘 (Next.js app 규약)',
    replace: true,
    locked: false,
    pixels: '180x180',
    note:
      '✅ 2026-09-21 신규 브랜드로 **교체 완료 — A안.** 같은 승인 원본에서 뽑았고 ' +
      '같은 심볼 체계지만 표현이 다르다 — 크림 카드 위 원색 심볼에 세 갈래 빛과 ' +
      '좌우 마크까지 남긴다. 홈 화면은 충분히 커서 디테일이 살고 원본 인상에 가장 가깝다. ' +
      '실측 3.12:1. 32px 이하에서는 이 표현이 흐려지므로 탭 아이콘은 C-반전을 쓴다. ' +
      'replace 는 위와 같은 이유로 true 를 유지한다.',
  },
  {
    path: 'public/brand/icon-192.png',
    kind: 'file',
    category: 'app-icon',
    use: 'PWA 설치 아이콘 — manifest 192×192',
    replace: true,
    locked: false,
    pixels: '192x192',
    note:
      '✅ 2026-09-21 신설. apple-icon 과 같은 A안이다. ' +
      '🔴 purpose 는 any 다(manifest.ts 참조) — 심볼이 maskable 안전영역(지름 80%)을 ' +
      '넘어서 실측 57.4% 가 밖이다. 선언하면 팔이 잘린다.',
  },
  {
    path: 'public/brand/icon-512.png',
    kind: 'file',
    category: 'app-icon',
    use: 'PWA 스플래시·스토어 면 — manifest 512×512',
    replace: true,
    locked: false,
    pixels: '512x512',
    note: '✅ 2026-09-21 신설. 192 와 같은 A안, 같은 purpose 판단이다.',
  },
  {
    path: 'public/brand/soransoran-logo.png',
    kind: 'file',
    category: 'logo',
    use: '가로형 로고 — 헤더 · 오류 화면 · OG 2곳이 모두 이 한 파일을 쓴다',
    replace: true,
    locked: false,
    pixels: '186x96',
    note:
      '✅ 2026-09-21 신설. 창업자 승인 원본 Logo.png(1672×941, 646KB)의 투명 여백을 ' +
      '실제 내용 기준으로 정리(1557×805)하고 표시 상자 93×48 의 2배로 줄인 것이다. ' +
      '비율 1.9342 → 1.9375(왜곡 없음) · 23.2KB. ' +
      '🔴 원본을 런타임에 그대로 쓰지 않는다 — 646KB 는 헤더 한 줄이 짊어질 무게가 아니다. ' +
      '🔴 이름이 픽셀에 들어 있다. 이름이 바뀌면 코드로는 못 고친다(replace: true).',
  },
  {
    path: 'src/components/brand/Logo.tsx',
    kind: 'code',
    category: 'logo',
    use: '헤더·오류 화면 로고 — 브랜드 표시의 단일 진입점',
    replace: false,
    locked: false,
    note:
      '🕘 2026-09-07~09-21 에는 **두 색 텍스트 워드마크**였다(24px · 800/500 · ' +
      '--brand/--brand-strong). 2026-09-21 신규 브랜드에서 **가로형 이미지 로고**로 바뀌었다. ' +
      '이 파일은 이제 next/image 로 public/brand/soransoran-logo.png 를 48px 높이로 그린다 — ' +
      '주소와 크기의 정본은 src/lib/brand-logo.ts 다. ' +
      '파일을 바꾸면 따라 바뀌므로 코드 자체는 교체 대상이 아니다.',
  },
  {
    path: 'src/app/opengraph-image.tsx',
    kind: 'code',
    category: 'og',
    use: '기본 OG 이미지 — 공유 카드',
    replace: false,
    locked: false,
    note:
      'next/og 로 매 요청 생성한다. 🕘 2026-09-21 까지는 두 색 워드마크를 코드로 그렸고, ' +
      '지금은 **화면과 같은 로고 파일**을 높이 72px 로 그린다(brand-logo-image.ts 가 ' +
      '번들 안의 PNG 를 data URI 로 읽어 넘긴다 — 자기 자신에게 HTTP 요청하지 않는다). ' +
      '제목·게시판명·카피는 여전히 코드가 읽으므로 픽셀에 박히지 않는다. ' +
      '우나어는 og-cover.png 에 로고가 구워져 있어 수동 교체가 필요했다.',
  },
  {
    path: 'src/app/community/[boardSlug]/[postId]/opengraph-image.tsx',
    kind: 'code',
    category: 'og',
    use: '글 상세 OG 이미지',
    replace: false,
    locked: false,
    note:
      '위와 같은 방식이고 로고도 같은 파일이다. 글 제목 + 로고를 그린다. ' +
      '보드 라벨은 로고 뒤에 기존 간격(marginLeft 20)으로, 세로 가운데 맞춰 붙는다.',
  },
  {
    path: 'src/app/manifest.ts',
    kind: 'code',
    category: 'manifest',
    use: 'PWA manifest — name · theme_color · background_color',
    replace: false,
    locked: false,
    note:
      'SITE.name 과 BRAND 색을 읽는다. 아이콘 4종(32·180·192·512)은 위 file 자산이 지고 ' +
      'manifest 는 경로·크기·MIME 만 선언한다. purpose 는 any 다 — 근거는 manifest.ts 머리말.',
  },
  {
    path: 'public/images/hero/soransoran-community-hero.jpg',
    kind: 'file',
    category: 'hero',
    use: '홈 첫 화면 배너',
    replace: false,
    locked: false,
    note:
      '1920×1194. 40~50대 여성 셋이 대화하는 사진으로 로고·문구가 들어 있지 않다. ' +
      '웜 모노크롬 전환 때 실측했다 — 따뜻한 색은 나무·피부 톤이고 브랜드 카피가 아니다. ' +
      '타깃이 그대로면 내용은 재사용할 수 있다 — 파일명에만 옛 브랜드가 남는다.',
  },
  {
    path: 'public/images/login/soransoran-login-slide-1.jpg',
    kind: 'file',
    category: 'login-image',
    use: '로그인 화면 슬라이드 1',
    replace: true,
    locked: false,
    note:
      '720×900. ✅ 2026-09-08 새 팔레트로 **교체 완료.** ' +
      '사진 위 강조 카피가 픽셀로 구워져 있어 코드로는 못 고치던 자리다 — ' +
      '사진·인물·배치·카피는 그대로 두고 **강조 글자 색만** 이전 코랄에서 --brand 계열로 옮겼다. ' +
      '흰 글자는 건드리지 않았다. ' +
      '🔴 replace 는 true 로 둔다 — 지금 어긋나 있다는 뜻이 아니라 ' +
      '**다음 리브랜딩에서도 사람이 다시 만들어야 하는 자산**이라는 정책값이다. ' +
      '🔴 이 파일에는 색 값을 적지 않는다(check:tokens 대상). 토큰명으로만 가리킨다.',
  },
  {
    path: 'public/images/login/soransoran-login-slide-2.jpg',
    kind: 'file',
    category: 'login-image',
    use: '로그인 화면 슬라이드 2',
    replace: true,
    locked: false,
    note: '슬라이드 1 과 같다 — 2026-09-08 강조 글자만 --brand 계열로 교체 완료.',
  },
  {
    path: 'public/images/login/soransoran-login-slide-3.jpg',
    kind: 'file',
    category: 'login-image',
    use: '로그인 화면 슬라이드 3',
    replace: true,
    locked: false,
    note: '슬라이드 1 과 같다 — 2026-09-08 강조 글자만 --brand 계열로 교체 완료.',
  },
  {
    path: 'src/components/features/KakaoSignInButton.tsx',
    kind: 'code',
    category: 'external',
    use: '카카오 로그인 버튼 — 심볼·색',
    replace: false,
    locked: true,
    note:
      '🔴 외부 브랜드다. --kakao-bg · --kakao-text 토큰과 카카오 심볼은 ' +
      '카카오 브랜드 가이드를 따른다. 우리 색을 섞으면 카카오 버튼으로 읽히지 않는다(§4 격리). ' +
      '리브랜딩에서 손대지 않는다.',
  },
] as const

/** 리브랜딩 당일 반드시 새로 만들어야 하는 자산 */
export const MUST_REPLACE = BRAND_ASSETS.filter((a) => a.replace)

/** 외부 브랜드라 손대면 안 되는 자산 */
export const LOCKED_ASSETS = BRAND_ASSETS.filter((a) => a.locked)
