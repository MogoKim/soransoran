import { ImageResponse } from 'next/og'
import { BRAND } from '@/lib/brand'

/** iOS 홈 화면 아이콘 — 180×180 */
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND.color,
          color: BRAND.onBrand,
          fontSize: 112,
          fontWeight: 700,
        }}
      >
        소
      </div>
    ),
    size,
  )
}
