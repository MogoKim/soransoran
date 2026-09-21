import { ImageResponse } from 'next/og'
import { BRAND, SITE } from '@/lib/brand'
import { loadBrandLogoDataUri, OG_LOGO_HEIGHT, OG_LOGO_WIDTH } from '@/lib/brand-logo-image'

/**
 * 기본 OG 이미지 — 코드 생성
 *
 * 정본 §3-3: 인물 사진 없이 타이포 중심.
 * 읽어야 하는 카피는 --text-primary, brand 는 장식 면으로만 쓴다.
 *
 * 🕘 **로고 자리는 2026-09-21 에 이미지로 바뀌었다.** 그 전에는 두 색 텍스트
 *    워드마크를 코드로 그렸다(앞 800 BRAND.color · 뒤 500 BRAND.strong · 52px).
 *    이제 화면과 같은 파일을 그린다 — 줄 높이 52px 은 그대로라 판은 바뀌지 않는다.
 */
export const alt = `${SITE.name} — ${SITE.tagline}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  const logo = loadBrandLogoDataUri()

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
        {/* 가로형 이미지 로고 (정본 §3-2-A) — 화면 Logo 와 같은 파일이다.
            🔴 alt 를 두지 않는다. 이것은 PNG 로 굽히는 그림이고 대체 텍스트는
               파일 밖의 `alt` export 가 진다 — 여기 적으면 그림 안에 글자로 남는다. */}
        <div style={{ display: 'flex' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og(satori) 는 next/image 를 그리지 못한다 */}
          <img src={logo} width={OG_LOGO_WIDTH} height={OG_LOGO_HEIGHT} alt="" />
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
