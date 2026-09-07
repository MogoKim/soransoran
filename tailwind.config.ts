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
        /**
         * 🔴 역할 별칭 — 새 크기가 아니다. xs 와 값이 **완전히 같다.**
         *    정본 §12-3 의 meta 역할(작성자·날짜·조회수·댓글수)만 이 이름을 쓴다.
         *    같은 17px 라도 입력 라벨·안내문·상태 문구는 역할이 달라 xs 로 남는다.
         *
         * 🔴 값이 갈라지면 별칭이 아니다. 크기를 바꾸려면 --text-caption 을 고친다 —
         *    여기서 다른 값을 주는 순간 meta 만 글자 크기 축에서 떨어져 나간다.
         *
         * 🔴 별칭을 늘릴 때는 src/lib/utils.ts 의 font-size 그룹에도 함께 등록한다.
         *    등록하지 않으면 cn() 안에서 조용히 지워진다(그 파일 주석 참조).
         */
        meta: ['var(--text-caption)', { lineHeight: '1.4' }],
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
          /* 작은 글씨·연한 코랄 면 위 브랜드 텍스트용 진한 코랄 #b64235 — text-brand-ink 가 대비 미달인 자리 */
          strong: 'var(--brand-strong)',
        },
        /* CTA — 누르는 것 */
        cta: {
          DEFAULT: 'var(--cta)',
          edge: 'var(--cta-edge)',
          text: 'var(--cta-text)',
        },
        surface: {
          page: 'var(--surface-page)',
          card: 'var(--surface-card)',
          soft: 'var(--surface-soft)',
        },
        content: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        link: 'var(--link)',
        /* 외부 브랜드 (카카오 로그인 버튼 전용) */
        kakao: {
          DEFAULT: 'var(--kakao-bg)',
          text: 'var(--kakao-text)',
        },
        state: {
          success: 'var(--state-success)',
          warning: 'var(--state-warning)',
          danger: 'var(--state-danger)',
          info: 'var(--state-info)',
        },
      },
      /**
       * 🔴 보더 색은 colors 가 아니라 borderColor 에 둔다.
       *
       * colors.border.{subtle,interactive} 로 두면 색 이름이 'border-subtle' 이 되고
       * 실제 유틸리티는 border-border-subtle 이 된다. 컴포넌트는 border-subtle 을
       * 쓰므로 무효 클래스가 되어 빌드 CSS 에 아무 규칙도 생기지 않았다.
       * (colors.surface.page 는 최상위라 border-surface-page 가 정상 생성된 것과 대조된다)
       *
       * 그동안 테두리 색은 globals.css 의 전역 *{border-color:var(--border-subtle)} 이
       * 대신 주고 있었다. subtle 은 값이 같아 눈에 띄지 않았지만,
       * interactive 는 정의만 되고 어디에도 적용되지 않았다 —
       * 테두리로 존재를 알려야 하는 버튼이 장식 구분선 색을 쓰고 있었다.
       */
      borderColor: {
        subtle: 'var(--border-subtle)',
        interactive: 'var(--border-interactive)',
      },
      /* 🔴 그림자 색도 토큰 밖으로 새지 않게 둔다.
         컴포넌트에 rgba 를 직접 쓰면 색을 바꿀 때 찾아다녀야 한다. */
      boxShadow: {
        kakao: 'var(--shadow-kakao)',
        toast: 'var(--shadow-toast)',
        modal: 'var(--shadow-modal)',
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
