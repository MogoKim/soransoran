'use client'

import { BRAND } from '@/lib/brand'

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
        <p style={{ fontSize: 24, fontWeight: 800, color: BRAND.ink, margin: 0 }}>소란소란</p>
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
            fontSize: 16,
          }}
        >
          다시 시도
        </button>
      </body>
    </html>
  )
}
