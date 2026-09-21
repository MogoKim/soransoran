import { ImageResponse } from 'next/og'
import { BRAND, SITE } from '@/lib/brand'
import { loadBrandLogoDataUri, OG_LOGO_HEIGHT, OG_LOGO_WIDTH } from '@/lib/brand-logo-image'
import { getBoardBySlug } from '@/lib/board-registry'
import { getPostDetail } from '@/lib/queries/posts'
import { isSearchIndexable } from '@/lib/post-visibility'

/**
 * 글 상세 공유 카드 — 코드 생성
 *
 * 루트 opengraph-image 와 같은 판이다(정본 §3-3: 인물 사진 없이 타이포 중심).
 * 다른 점은 가운데 카피가 그 글의 제목이라는 것뿐이다.
 *
 * 🕘 **로고 자리는 2026-09-21 에 이미지로 바뀌었다** — 기본 OG 와 같은 경위다.
 *
 * 🔴 검색 비노출 글에는 제목을 그리지 않는다.
 *    이 파일은 세그먼트 전체에 붙으므로 Micro Seed 글에도 자동으로 적용된다.
 *    제목도 원문이라, 그리는 순간 noindex 로도 막지 못하는 그림 유출이 된다.
 *    그 경우 루트와 같은 브랜드 카드로 되돌린다 — 지금 그 글들이 받는 것과 같다.
 */
export const alt = SITE.title
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * 제목 길이 상한. 넘치면 잘라 말줄임.
 *
 * 🔴 **"두 줄까지" 는 아니다.** 예전 주석이 그렇게 적혀 있었는데 실제와 달랐다 —
 *    68px 에서 한 줄에 들어가는 글자 수가 띄어쓰기에 따라 16~20자로 흔들려서,
 *    38자는 **두 줄이 되기도 하고 세 줄이 되기도 한다**(2026-09-21 실측:
 *    띄어쓰기가 많은 23자는 2줄, 조밀한 38자는 3줄).
 *
 * 🔴 그래서 값을 줄이지 않고 **세 줄까지 판이 버티는지**를 기준으로 삼는다.
 *    세 줄일 때 마지막 줄과 강조 바 사이가 로고 72px 기준 41px 남는다 —
 *    로고 높이를 이 값으로 정한 근거가 그것이다(brand-logo-image.ts).
 *    상한을 낮추면 제목이 더 일찍 잘리므로, 그것은 레이아웃이 아니라
 *    **무엇을 보여줄지**의 결정이라 여기서 임의로 바꾸지 않는다.
 */
const TITLE_MAX = 38

export default async function PostOgImage({
  params,
}: {
  params: { boardSlug: string; postId: string }
}) {
  const board = getBoardBySlug(params.boardSlug)
  const detail = await getPostDetail(params.postId).catch(() => null)
  const post = detail?.post

  const showTitle =
    Boolean(post) && Boolean(board) && post!.boardType === board!.type && isSearchIndexable(post!)

  const logo = loadBrandLogoDataUri()

  const headline = showTitle
    ? post!.title.length > TITLE_MAX
      ? `${post!.title.slice(0, TITLE_MAX)}…`
      : post!.title
    : SITE.tagline

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '96px',
          background: BRAND.background,
        }}
      >
        {/* 가로형 이미지 로고 (정본 §3-2-A) — 기본 OG·화면 Logo 와 같은 파일이다.
            보드 라벨은 로고 **뒤에** 기존 간격(marginLeft 20)으로 붙는다.
            🔴 라벨을 로고와 가운데로 맞춘다 — 워드마크였을 때는 같은 줄의 글자끼리
               기준선이 맞았지만, 이제 옆에 서는 것은 그림이라 정렬을 명시해야 한다. */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og(satori) 는 next/image 를 그리지 못한다 */}
          <img src={logo} width={OG_LOGO_WIDTH} height={OG_LOGO_HEIGHT} alt="" />
          {showTitle ? (
            <span style={{ marginLeft: 20, fontSize: 40, fontWeight: 700, color: BRAND.muted }}>
              {board!.label}
            </span>
          ) : null}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 68,
            fontWeight: 800,
            color: BRAND.text,
            lineHeight: 1.25,
          }}
        >
          {headline}
        </div>
        <div
          style={{ display: 'flex', marginTop: 40, width: 160, height: 12, background: BRAND.color }}
        />
      </div>
    ),
    size,
  )
}
