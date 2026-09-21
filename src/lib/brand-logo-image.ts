import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BRAND_LOGO } from '@/lib/brand-logo'

/**
 * next/og 가 그릴 로고 — 파일 바이트를 data URI 로 돌려준다
 *
 * 🔴 **화면과 같은 파일이다.** 공유 카드용 로고를 따로 만들지 않는다 —
 *    두 벌이 되는 순간 리브랜딩에서 한쪽만 바뀐 채 배포된다.
 *
 * 🔴 왜 절대 URL 이 아닌가
 *    `<img src="https://…/brand/…png">` 로 두면 OG 를 그릴 때마다 우리 서버가
 *    자기 자신에게 HTTP 요청을 한다. 배포 직후·프리뷰 도메인·네트워크 실패에서
 *    공유 카드가 **로고 없이** 나가고, 그 실패는 크롤러 쪽에서만 보인다.
 *
 * 🔴 왜 `new URL(..., import.meta.url)` 이 아닌가 — **실측으로 깨졌다.**
 *    Next.js 문서가 폰트에 쓰는 그 방식을 그대로 썼더니 webpack 이 그 표현을
 *    **공개 경로 문자열**(`/_next/static/media/soransoran-logo.a8cab7f4.png`)로 바꿨고,
 *    Node 의 `fetch` 가 그것을 URL 로 파싱하지 못해 빌드가 멈췄다:
 *
 *      TypeError: Failed to parse URL from /_next/static/media/soransoran-logo.…png
 *      Error occurred prerendering page "/opengraph-image"
 *
 *    빌드 시점 프리렌더에서 바로 드러났기 때문에 배포 전에 잡혔다.
 *    상대 경로를 서버에서 fetch 하는 방식은 쓰지 않는다.
 *
 * 🔴 그래서 `public/` 의 파일을 **런타임에 한 번 읽는다.**
 *
 * 🔴 경로를 **문자열 리터럴로** 적는다. 상수에서 가져오면 Next 의 파일 추적
 *    (`@vercel/nft`)이 값을 따라가지 못해 서버 번들에 파일이 올라가지 않는다 —
 *    실측했다: 상수로 조립했을 때 `route.js.nft.json` 에 로고가 **없었다.**
 *    로컬에서는 `public/` 이 그대로 있어 통과하고 배포에서만 깨지는 종류의 결함이다.
 *    리터럴이라 `brand-logo.ts` 와 갈라질 수 있으므로 `check:brand-assets` 가 대조한다.
 *
 * ⚠️ 이 모듈은 **서버(next/og)에서만** 부른다. `node:fs` 를 쓰므로 client 에서
 *    import 하면 번들이 깨진다. 화면 쪽은 `BRAND_LOGO.src`(주소)를 쓴다.
 */
let cached: string | null = null

export function loadBrandLogoDataUri(): string {
  if (cached) return cached
  const bytes = readFileSync(join(process.cwd(), 'public/brand/soransoran-logo.png'))
  cached = `data:image/png;base64,${bytes.toString('base64')}`
  return cached
}

/**
 * OG 안에서의 로고 **표시 상자 높이** — 72px
 *
 * 🔴 아래 숫자를 읽을 때 셋을 구분한다. 섞으면 근거가 거짓이 된다.
 *      표시 상자     코드가 잡는 자리. `OG_LOGO_WIDTH × OG_LOGO_HEIGHT` 다.
 *      잉크 경계상자  실제로 그려진 픽셀의 bounding box.
 *      칠해진 면적    그 상자 안에서 실제로 색이 있는 픽셀. 이 로고는 상자의 **32.1%** 뿐이다.
 *
 * 🔴 파일 상자는 192×96 = 정확히 **2.000** 이다. 내용(191×96 · 제 비율 1.9913)을
 *    늘리지 않고 담았기 때문에, 화면 96×48 도 여기 144×72 도 같은 상자 비율이 되어
 *    **어느 자리에서도 비율 왜곡이 없다**(2026-09-21 신규 원본 기준 실측).
 *
 * 🔴 52·72·88·96 을 실제로 그려 재고 골랐다. 판정 기준은 **가장 빠듯한 경우**,
 *    즉 제목이 세 줄로 접히는 글(38자)에서 마지막 줄과 강조 바 사이 간격이다.
 *
 *      표시 상자 높이   표시 상자    잉크 경계상자   3줄 제목 아래 여백   바깥 여백
 *            52        104 × 52      104 × 52           55px             96px
 *            72        144 × 72      143 × 72           41px             96px   ← 확정
 *            88        176 × 88      175 × 88           25px             96px
 *            96        192 × 96      191 × 96           17px             96px
 *
 *    어느 높이에서도 **잘리지 않는다**(바는 항상 판 안이고 바깥 여백 96px 도 지켜진다).
 *    96 은 파일의 원래 크기라 가장 또렷하지만 마지막 줄이 바에 17px 까지 붙어 밑줄처럼 보인다.
 *
 * 🔴 로고 안에서 **이름 글자는 상자 높이의 57.3%** 를 쓴다(신규 원본 실측 · 이전 원본은 50%).
 *    72 에서 이름은 41px 이 되어, 이미지 로고 이전의 텍스트 워드마크(글자 47px)에
 *    가장 가깝게 선다. 52 에서는 30px 로 눈에 띄게 작다.
 *
 * 🔴 아래 카피의 marginTop 28 · 바의 marginTop 40 · padding 96 · TITLE_MAX 는
 *    **건드리지 않았다.** 표시 상자 높이 하나만 정하고, 세로 배치는 flex 가운데
 *    정렬이 흡수한다.
 */
export const OG_LOGO_HEIGHT = 72
export const OG_LOGO_WIDTH = Math.round(
  (BRAND_LOGO.width / BRAND_LOGO.height) * OG_LOGO_HEIGHT,
)
