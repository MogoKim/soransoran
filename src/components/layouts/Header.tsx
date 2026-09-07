import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import Logo from '@/components/brand/Logo'
import { BRAND_NAME } from '@/lib/brand-name'
import HeaderAuth from '@/components/layouts/HeaderAuth'
import FontSizeToggle from '@/components/layouts/FontSizeToggle'

/**
 * 헤더
 *
 * 🔴 로고 슬롯은 가로형이다. 정사각 슬롯을 두지 않는다.
 *    우나어는 1024x492 가로 로고를 60x60 정사각에 넣어 실제 60x29 로 렌더됐고,
 *    워드마크 글자 높이가 12px 이 되어 판독이 불가능했다.
 */
export default function Header() {
  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between gap-2 border-b border-subtle bg-surface-card px-4">
      {/* 🔴 워드마크 줄 높이만으로는 터치 기준에 못 미친다.
          헤더가 h-16(64px) 이라 여기서 52px 을 확보해도 헤더는 그대로다.
          글자 크기와 색은 Logo 가 정한다 — 여기서는 누를 수 있는 넓이만 맞춘다.
          🔴 여기서 text-* 를 넘기지 않는다. 로고는 24px 고정이라 본문 크기 설정을 따르지 않는다. */}
      <Link
        href="/"
        className={`flex ${TOUCH_MIN} items-center no-underline`}
        aria-label={`${BRAND_NAME} 홈`}
      >
        <Logo />
      </Link>
      <div className="flex items-center gap-1">
        <FontSizeToggle variant="header" />
        <HeaderAuth />
      </div>
    </header>
  )
}
