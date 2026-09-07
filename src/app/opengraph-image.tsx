import { ImageResponse } from 'next/og'
import { BRAND, SITE } from '@/lib/brand'
import { BRAND_NAME_HEAD, BRAND_NAME_TAIL } from '@/lib/brand-name'

/**
 * 기본 OG 이미지 — 코드 생성
 *
 * 정본 §3-3: 인물 사진 없이 타이포 중심.
 * 읽어야 하는 카피는 --text-primary(#2f2624), brand(#ff6f61)는 장식 면으로만 쓴다.
 */
export const alt = `${SITE.name} — ${SITE.tagline}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
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
        {/* 두 색 워드마크 (정본 §3-2-A) — 화면 Logo 와 같은 조각이다.
            next/og 는 CSS 변수를 해석하지 못하므로 색은 BRAND 상수를 쓴다.
            자간은 52px 에서 -0.03em — 화면 24px 의 -0.02em 보다 한 단계 조인다. */}
        <div style={{ display: 'flex', fontSize: 52, letterSpacing: '-0.03em' }}>
          <span style={{ fontWeight: 800, color: BRAND.color }}>{BRAND_NAME_HEAD}</span>
          <span style={{ fontWeight: 500, color: BRAND.strong }}>{BRAND_NAME_TAIL}</span>
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 76,
            fontWeight: 800,
            color: BRAND.text,
            lineHeight: 1.25,
          }}
        >
          40대 50대 여성이
        </div>
        <div style={{ display: 'flex', fontSize: 76, fontWeight: 800, color: BRAND.text }}>
          이야기하는 곳
        </div>
        <div style={{ display: 'flex', marginTop: 40, width: 160, height: 12, background: BRAND.color }} />
      </div>
    ),
    size,
  )
}
