'use client'

import { BRAND } from '@/lib/brand'
import { BRAND_NAME } from '@/lib/brand-name'
import { BRAND_LOGO } from '@/lib/brand-logo'

/**
 * 최상위 에러 화면 — layout 자체가 실패한 경우에만 쓰인다.
 * html/body 를 직접 렌더해야 하므로 globals.css 토큰에 의존하지 않고 최소 스타일만 인라인으로 둔다.
 *
 * 🔴 stack trace · env · DB 정보를 노출하지 않는다.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: BRAND.background,
          color: BRAND.text,
        }}
      >
        {/* 가로형 이미지 로고 (정본 §3-2-A) — 화면 Logo 와 **같은 파일**이다.
            🔴 next/image 를 쓰지 않는다. 여기는 layout 자체가 실패한 경계라
               이미지 최적화 경로까지 성립한다고 가정할 수 없다. 정적 <img> 로
               public 의 파일을 그대로 가져오고, 크기는 인라인으로 박는다.
            🔴 globals.css 가 없을 수 있어 sr-only 클래스를 못 쓴다 —
               접근 가능한 이름은 alt 하나로 읽힌다.

            🕘 이전에는 두 색 텍스트 워드마크였다(2026-09-07 ~ 2026-09-21).
               CSS 변수를 해석하지 못하는 자리라 색을 BRAND 상수로 넣어 그렸다.
               이미지 로고로 바뀌면서 그 조각과 BRAND.strong 참조가 함께 사라졌다. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- layout 실패 경계라 next/image 를 쓰지 않는다 */}
        <img
          src={BRAND_LOGO.src}
          alt={BRAND_NAME}
          width={BRAND_LOGO.width}
          height={BRAND_LOGO.height}
          style={{ display: 'block' }}
        />
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          일시적인 문제가 발생했습니다
        </h1>
        <p style={{ fontSize: 15, color: BRAND.muted, margin: 0 }}>
          잠시 후 다시 시도해 주세요.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: 52,
            padding: '0 24px',
            borderRadius: 12,
            border: 'none',
            background: BRAND.cta,
            color: BRAND.onBrand,
            fontWeight: 700,
            /* 🔴 흰 내용(BRAND.onBrand)은 CTA 면 위 3.53:1 이라 큰 굵은 글씨(18.66px+700)로만 통과한다.
               16px 이던 것을 20px 로 올린다 — 기준을 낮추지 않고 글자를 조건 안으로 올린다. */
            fontSize: 20,
          }}
        >
          다시 시도
        </button>
      </body>
    </html>
  )
}
