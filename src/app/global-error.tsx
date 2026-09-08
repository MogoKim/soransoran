'use client'

import { BRAND } from '@/lib/brand'
import { BRAND_NAME, BRAND_NAME_HEAD, BRAND_NAME_TAIL } from '@/lib/brand-name'

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
        {/* 두 색 워드마크 (정본 §3-2-A) — 화면 Logo 와 같은 조각·같은 색이다.
            🔴 여기는 globals.css 가 없을 수 있어 토큰도 sr-only 클래스도 못 쓴다.
               그래서 색은 BRAND 상수로, 이름은 role="img" + aria-label 로 한 번만 읽힌다. */}
        <p
          role="img"
          aria-label={BRAND_NAME}
          style={{ fontSize: 24, letterSpacing: '-0.02em', whiteSpace: 'nowrap', margin: 0 }}
        >
          <span aria-hidden style={{ fontWeight: 800, color: BRAND.color }}>{BRAND_NAME_HEAD}</span>
          <span aria-hidden style={{ fontWeight: 500, color: BRAND.strong }}>{BRAND_NAME_TAIL}</span>
        </p>
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
