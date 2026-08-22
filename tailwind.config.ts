import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

/**
 * 소란소란 디자인 토큰 매핑
 *
 * 🔴 여기에는 hex 값을 쓰지 않는다. globals.css 의 CSS 변수만 참조한다.
 *    색을 바꿀 때는 globals.css :root 만 수정하면 전체 UI 가 교체된다.
 *    정본: soransoran-brand-design-spec.md §3-4
 */
const config: Config = {
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1200px' },
    },
    extend: {
      /* 글자 크기 3단계(작게/기본/크게)에 연동되는 스케일 */
      fontSize: {
        xs: ['var(--text-caption)', { lineHeight: '1.4' }],
        sm: ['var(--text-sm)', { lineHeight: '1.5' }],
        base: ['var(--text-body)', { lineHeight: '1.6' }],
        lg: ['var(--text-title)', { lineHeight: '1.6' }],
        xl: ['var(--text-heading)', { lineHeight: '1.4' }],
        '2xl': ['var(--text-display)', { lineHeight: '1.3' }],
      },
      colors: {
        /* 브랜드 — brand 는 비텍스트 전용 */
        brand: {
          DEFAULT: 'var(--brand)',
          soft: 'var(--brand-soft)',
          muted: 'var(--brand-muted)',
          ink: 'var(--brand-ink)',
        },
        /* CTA — 누르는 것 */
        cta: {
          DEFAULT: 'var(--cta)',
          hover: 'var(--cta-hover)',
          text: 'var(--cta-text)',
        },
        surface: {
          page: 'var(--surface-page)',
          card: 'var(--surface-card)',
          soft: 'var(--surface-soft)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          interactive: 'var(--border-interactive)',
        },
        content: {
          primary: 'var(--text-primary)',
          muted: 'var(--text-muted)',
        },
        link: 'var(--link)',
        state: {
          success: 'var(--state-success)',
          warning: 'var(--state-warning)',
          danger: 'var(--state-danger)',
          info: 'var(--state-info)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}

export default config
