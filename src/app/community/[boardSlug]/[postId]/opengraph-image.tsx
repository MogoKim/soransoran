import { ImageResponse } from 'next/og'
import { BRAND, SITE } from '@/lib/brand'
import { getBoardBySlug } from '@/lib/board-registry'
import { getPostDetail } from '@/lib/queries/posts'
import { isSearchIndexable } from '@/lib/post-visibility'

/**
 * 글 상세 공유 카드 — 코드 생성
 *
 * 루트 opengraph-image 와 같은 판이다(정본 §3-3: 인물 사진 없이 타이포 중심).
 * 다른 점은 가운데 카피가 그 글의 제목이라는 것뿐이다.
 *
 * 🔴 검색 비노출 글에는 제목을 그리지 않는다.
 *    이 파일은 세그먼트 전체에 붙으므로 Micro Seed 글에도 자동으로 적용된다.
 *    제목도 원문이라, 그리는 순간 noindex 로도 막지 못하는 그림 유출이 된다.
 *    그 경우 루트와 같은 브랜드 카드로 되돌린다 — 지금 그 글들이 받는 것과 같다.
 */
export const alt = SITE.title
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** 카드는 두 줄까지다. 넘치면 잘라 말줄임 — 세 줄부터는 글자가 작아져 안 읽힌다. */
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
        <div style={{ display: 'flex', fontSize: 52, fontWeight: 800, color: BRAND.ink }}>
          {SITE.name}
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
