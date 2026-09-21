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
 * OG 안에서의 로고 **표시 상자 높이** — 72px (2026-09-21 실측으로 확정)
 *
 * 🔴 아래 숫자를 읽을 때 셋을 구분한다. 섞으면 근거가 거짓이 된다.
 *      표시 상자     코드가 잡는 자리. `OG_LOGO_WIDTH × OG_LOGO_HEIGHT` 다.
 *      잉크 경계상자  실제로 그려진 픽셀의 bounding box.
 *                    이 로고는 원본의 투명 여백을 이미 잘라냈으므로 **표시 상자와 같다.**
 *      칠해진 면적    그 상자 안에서 실제로 색이 있는 픽셀. 이 로고는 상자의 **33.9%** 뿐이다.
 *
 * 🕘 처음에는 이전 워드마크의 줄 높이인 52px 를 표시 상자 높이로 그대로 받았다.
 *    판은 유지됐지만 창업자 눈에 로고가 작아 보였다. 왜 그런지 실제로 재 보았다 —
 *    **면적이 아니라 이름 글자의 높이** 때문이었다.
 *
 *      대상                         잉크 경계상자   칠해진 면적   그 안의 이름 글자 높이
 *      이전 두 색 워드마크(52px)      184 × 47       2,180px²      47px  (글자가 곧 전부다)
 *      로고 표시 상자 52px            101 × 52       1,783px²      26px
 *      로고 표시 상자 72px            140 × 72       3,418px²      36px   ← 확정
 *      로고 표시 상자 96px            186 × 96         —           48px
 *
 *    로고는 심볼과 이름이 한 덩어리라 **이름이 상자 높이의 정확히 절반**을 쓴다(실측).
 *    그래서 52px 상자에서 이름은 26px 이 되어 이전 47px 글자의 **절반가량**으로 읽혔다.
 *    칠해진 면적으로만 보면 52px 도 이전의 82% 라 "절반" 이 아니다 —
 *    🔴 작아 보인 원인은 면적이 아니라 글자 높이였다.
 *
 * 🔴 52·72·88·96 을 실제로 그려 재고 골랐다. 판정 기준은 **가장 빠듯한 경우**,
 *    즉 제목이 세 줄로 접히는 글(38자)에서 마지막 줄과 강조 바 사이 간격이다.
 *
 *      표시 상자 높이   표시 상자    3줄 제목 아래 여백   바깥 여백   가로/세로
 *            52        101 × 52          55px             96px      1.9423
 *            72        140 × 72          41px             96px      1.9444   ← 확정
 *            88        171 × 88          25px             96px      1.9432
 *            96        186 × 96          17px             96px      1.9375
 *
 *    어느 높이에서도 **잘리지 않는다**(바는 항상 판 안이고 바깥 여백 96px 도 지켜진다).
 *    96 은 파일의 원래 크기라 비율이 정확하고 이름 글자도 이전 워드마크와 같은 48px 이
 *    되지만, 마지막 줄이 바에 17px 까지 붙어 밑줄처럼 보인다.
 *    72 는 이름 글자를 36px 까지 올리면서 세 줄 글에서도 41px 을 남긴다.
 *
 * 🔴 아래 카피의 marginTop 28 · 바의 marginTop 40 · padding 96 · TITLE_MAX 는
 *    **건드리지 않았다.** 표시 상자 높이 하나만 바꿨고, 세로 배치는 flex 가운데
 *    정렬이 흡수한다.
 *
 * ⚠️ 가로는 정수로 반올림되므로 가로/세로가 0.4% 안쪽에서 흔들린다(위 표).
 *    93:48 = 31:16 이라 높이가 16의 배수일 때만 정확히 맞는다. 눈에 보이는 차이가
 *    아니고, 여기서는 세로 여유를 우선했다.
 */
export const OG_LOGO_HEIGHT = 72
export const OG_LOGO_WIDTH = Math.round(
  (BRAND_LOGO.width / BRAND_LOGO.height) * OG_LOGO_HEIGHT,
)
