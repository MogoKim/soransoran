import { ImageResponse } from 'next/og'
import { BRAND } from '@/lib/brand'

/**
 * favicon — 코드 생성 (우나어 asset 미복사)
 *
 * 32×32 에서 한글 4글자는 판독이 불가능하므로 축약형 "소" 한 글자를 쓴다.
 * 브랜드 시그니처(--brand)는 면으로만 등장한다는 정본 §3-1 에 맞춰
 * 배경을 brand 로, 글자를 흰색으로 둔다.
 */
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
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
          fontSize: 22,
          fontWeight: 700,
          borderRadius: 7,
        }}
      >
        소
      </div>
    ),
    size,
  )
}
