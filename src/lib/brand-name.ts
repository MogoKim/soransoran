/**
 * 브랜드 이름 — 화면에 그려지는 서비스명의 단일 지점
 *
 * 🔴 왜 brand.ts 와 따로 두는가
 *    brand.ts 는 모듈 최상위에서 resolveSiteUrl() 을 실행한다.
 *    process.env 3종을 읽고 new URL() 로 파싱하는 코드이며, 최상위 호출이라
 *    tree-shaking 으로 떨어지지 않는다 — 그 파일에서 이름 하나만 가져와도
 *    URL 해석 로직 전체가 함께 번들된다.
 *
 *    실제로 그렇게 될 뻔한 자리가 있다: nickname.ts 의 BANNED 는 서비스명을
 *    사칭 금지어로 갖는데, 이 상수를 client 인 nickname-field.tsx 가 import 한다.
 *    여기서 SITE.name 을 썼다면 닉네임 입력 화면 청크에 URL 해석이 들어갔다.
 *
 *    이름은 환경에 따라 달라지지 않는다. 환경을 읽는 코드와 같은 파일에 둘 이유가 없다.
 *
 * 🔴 값의 정의는 여기 한 곳이다. brand.ts 의 SITE.name 도 이 값을 가져다 쓴다.
 *    화면·문구에서 서비스명을 직접 적지 않는다.
 */
export const BRAND_NAME = '소란소란'

/**
 * 두 색 워드마크의 분리 위치 — 🔴 이름의 일부라 이름 옆에 둔다
 *
 * 워드마크는 앞·뒤 두 조각을 다른 무게와 색으로 그린다(정본 §3-2-A).
 * 그 분리 위치는 **이름의 성질**이지 컴포넌트의 사정이 아니다 —
 * 지금 이름은 같은 두 음절이 두 번 반복되는 형태라 절반에서 가른다.
 *
 * 🔴 화면(Logo.tsx) · CSS 없는 fallback(global-error) · next/og 이미지가
 *    모두 같은 조각을 써야 한다. 각자 자르면 한 곳만 어긋난 채 배포된다.
 *    그래서 자르는 곳을 여기 하나로 두고 결과만 내보낸다.
 *
 * 🔴 글자 수를 코드가 추측하게 두지 않는다. 리브랜딩 때 BRAND_NAME 을 고치는 사람이
 *    바로 아래 줄에서 분리 위치도 함께 정하게 된다.
 */
export const BRAND_NAME_SPLIT_AT = 2

/** 워드마크 앞 조각 — weight 800 · 브랜드 원색 */
export const BRAND_NAME_HEAD = BRAND_NAME.slice(0, BRAND_NAME_SPLIT_AT)
/** 워드마크 뒤 조각 — weight 500 · 진한 주황 */
export const BRAND_NAME_TAIL = BRAND_NAME.slice(BRAND_NAME_SPLIT_AT)

/**
 * 브랜드명에 붙는 주제 조사 — 🔴 받침을 코드가 판별하지 않는다.
 *
 * 자동 판별은 한글 받침에만 통한다. 영문·숫자·혼합 이름은 **발음**이 조사를 정하므로
 * 글자만 보고는 맞출 수 없다 — 같은 끝글자라도 읽는 방식에 따라 갈린다.
 * (예: 'Soran'은/는 · 'MZ'는 · 'Soran9'는 — 규칙이 아니라 발음의 문제다)
 *
 * 그래서 이름과 조사를 같은 파일에서 함께 확정한다.
 * 리브랜딩 때 BRAND_NAME 을 고치는 사람이 바로 아래 줄에서 조사도 함께 정하게 된다 —
 * 자동 판별에 맡기면 틀려도 아무도 모른 채 화면에 나간다.
 */
export const BRAND_NAME_TOPIC_PARTICLE = '은'

/** 주제 조사가 붙은 형태. 문장에서는 이 값을 쓴다 — 조사를 직접 이어붙이지 않는다. */
export const BRAND_NAME_WITH_TOPIC = `${BRAND_NAME}${BRAND_NAME_TOPIC_PARTICLE}`
