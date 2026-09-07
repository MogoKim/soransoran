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
    note:
      '32×32. ✅ 2026-09-07 새 팔레트 자산으로 **교체 완료.** ' +
      '창업자가 만든 2048×2048 정사각 원본에서 축소했다 — 브랜드 주황 바탕에 ' +
      '흰색과 연분홍 두 줄 글자다. 이전의 겹친 원 3개 추상 심볼은 대체됐다. ' +
      '🔴 replace 는 true 로 둔다 — 지금 어긋나 있다는 뜻이 아니라 ' +
      '**다음 리브랜딩에서도 사람이 새로 만들어야 하는 자산**이라는 정책값이다. ' +
      '글자가 픽셀에 구워져 있어 이름이 바뀌면 코드로는 못 고친다.',
  },
  {
    path: 'src/app/apple-icon.png',
    kind: 'file',
    category: 'apple-icon',
    use: 'iOS 홈 화면 아이콘 (Next.js app 규약)',
    replace: true,
    locked: false,
    note:
      '180×180. ✅ icon.png 와 같은 원본에서 축소해 **교체 완료**(2026-09-07). ' +
      'replace 는 위와 같은 이유로 true 를 유지한다.',
  },
  {
    path: 'src/components/brand/Logo.tsx',
    kind: 'code',
    category: 'logo',
    use: '헤더·오류 화면 워드마크 — 브랜드 표시의 단일 진입점',
    replace: false,
    locked: false,
    note:
      '이미지가 아니라 **두 색 텍스트 워드마크**다(2026-09-07). ' +
      '앞 절반은 weight 800 --brand, 뒤 절반은 weight 500 --brand-strong 이고 ' +
      '크기는 24px 고정, 자간 -0.02em 이다. 분리 위치만 상수로 두고 값은 BRAND_NAME 에서 파생한다. ' +
      '이름·색을 바꾸면 따라 바뀌므로 교체 대상이 아니다. ' +
      '이미지 로고로 가기로 결정하면 이 파일 하나만 고치면 된다.',
  },
  {
    path: 'src/app/opengraph-image.tsx',
    kind: 'code',
    category: 'og',
    use: '기본 OG 이미지 — 공유 카드',
    replace: false,
    locked: false,
    note:
      'next/og 로 매 요청 생성한다. SITE.name · SITE.tagline · BRAND 색을 읽으므로 ' +
      '픽셀에 글자가 박히지 않는다. 우나어는 og-cover.png 에 로고가 구워져 있어 수동 교체가 필요했다.',
  },
  {
    path: 'src/app/community/[boardSlug]/[postId]/opengraph-image.tsx',
    kind: 'code',
    category: 'og',
    use: '글 상세 OG 이미지',
    replace: false,
    locked: false,
    note: '위와 같은 방식. 글 제목 + 브랜드 워드마크를 코드로 그린다.',
  },
  {
    path: 'src/app/manifest.ts',
    kind: 'code',
    category: 'manifest',
    use: 'PWA manifest — name · theme_color · background_color',
    replace: false,
    locked: false,
    note: 'SITE.name 과 BRAND 색을 읽는다. 아이콘은 위 file 자산이 진다.',
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
      '720×900. 🔴 이전 기록("브랜드 요소 없는 사진")은 사실이 아니었다 — ' +
      '사진 위에 브랜드색 카피가 **픽셀로 구워져 있다.** ' +
      '웜 모노크롬 전환(2026-09-07) 실측: 채도 높은 주황·빨강 13,309px 의 평균이 ' +
      '이전 코랄에 가깝고 새 브랜드 주황과 어긋난다. ' +
      '🔴 수치는 여기 적지 않는다 — 설명문에 색 값을 쓰면 check:tokens 가 잡는다. ' +
      '(PR 본문과 커밋 메시지에 남겼다. 세 자리 hex 형태라 PR 번호 표기도 함께 걸린다) ' +
      '카피 색은 코드로 못 고친다 — 사람이 다시 만들어야 한다. ' +
      '🔴 아이콘 2종이 2026-09-07 교체된 뒤로 **실제로 새 팔레트와 어긋난 채 남은 자산은 ' +
      '이 로그인 슬라이드 3장뿐이다.**',
  },
  {
    path: 'public/images/login/soransoran-login-slide-2.jpg',
    kind: 'file',
    category: 'login-image',
    use: '로그인 화면 슬라이드 2',
    replace: true,
    locked: false,
    note: '슬라이드 1 과 같다 — 브랜드색 카피가 픽셀에 구워져 있어 새 팔레트와 어긋난다.',
  },
  {
    path: 'public/images/login/soransoran-login-slide-3.jpg',
    kind: 'file',
    category: 'login-image',
    use: '로그인 화면 슬라이드 3',
    replace: true,
    locked: false,
    note: '슬라이드 1 과 같다 — 브랜드색 카피가 픽셀에 구워져 있어 새 팔레트와 어긋난다.',
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
