import { ImageResponse } from 'next/og'
import { BRAND, SITE } from '@/lib/brand'

/**
 * 기본 OG 이미지 — 코드 생성
 *
 * 정본 §3-3: 인물 사진 없이 타이포 중심.
 * 읽어야 하는 카피는 --text-primary(#2f2624), brand(#ff6f61)는 장식 면으로만 쓴다.
 */
export const alt = '소란소란 — 40대 50대 여성이 이야기하는 곳'
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
        <div style={{ display: 'flex', fontSize: 52, fontWeight: 800, color: BRAND.ink }}>
          {SITE.name}
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
