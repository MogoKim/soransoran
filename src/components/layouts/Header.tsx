import Link from 'next/link'
import Logo from '@/components/brand/Logo'
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
      <Link href="/" className="flex items-center no-underline" aria-label="소란소란 홈">
        <Logo tone="brand" className="text-2xl" />
      </Link>
      <div className="flex items-center gap-1">
        <FontSizeToggle variant="header" />
        <HeaderAuth />
      </div>
    </header>
  )
}
