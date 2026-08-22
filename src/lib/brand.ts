/**
 * 브랜드 상수 — CSS 밖에서 색이 필요한 곳의 단일 지점
 *
 * Next.js metadata(viewport.themeColor)와 manifest 는 CSS 변수를 해석하지 못한다.
 * 따라서 그 두 곳만 이 파일의 상수를 쓴다.
 *
 * 🔴 색상 hex 의 정의 위치는 두 곳뿐이다.
 *      1) src/app/globals.css   — 화면에 그려지는 모든 색
 *      2) 이 파일               — metadata / manifest 전용
 *    컴포넌트에서는 절대 hex 를 쓰지 않는다. semantic token 만 쓴다.
 *
 * 색을 교체할 때는 이 두 파일만 고치면 된다.
 */
export const BRAND = {
  /** 브랜드 시그니처 — theme-color */
  color: '#ff6f61',
  /** 페이지 배경 — manifest background_color */
  background: '#fff8f6',
} as const

export const SITE = {
  name: '소란소란',
  title: '소란소란 - 40대 50대 여성을 위한 커뮤니티',
  tagline: '40대 50대 여성이 이야기하는 곳',
  description:
    '갱년기, 몸과 마음, 사는 이야기. 40대 50대 여성이 서로의 이야기를 나누는 곳입니다.',
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://soransoran.com',
} as const
