'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'

const BOARD_HREF_TO_SLUG: Record<string, string> = Object.fromEntries(
  COMMUNITY_BOARDS.map((b) => [b.href, b.slug]),
)

/**
 * 노출 여부와 목적지를 한 곳에서 정한다.
 * 둘을 따로 두면 버튼은 보이는데 엉뚱한 게시판으로 가는 상태가 생긴다.
 */
function resolveWriteHref(pathname: string): string | null {
  if (pathname === '/') return '/write'

  const slug = BOARD_HREF_TO_SLUG[pathname]
  return slug ? `/write?board=${slug}` : null
}

/** 글쓰기 FAB. 로그인 여부는 보지 않는다 — 로그인 요청은 /write 와 createPost 가 담당한다. */
export default function FAB() {
  const pathname = usePathname()
  const writeHref = resolveWriteHref(pathname)

  if (writeHref === null) return null

  return (
    <Link
      href={writeHref}
      aria-label="글쓰기"
      className="fixed bottom-6 right-5 z-40 inline-flex min-h-[56px] items-center gap-1 rounded-full bg-cta px-6 font-bold text-cta-text no-underline shadow-[shadow:var(--shadow-brand)] transition duration-150 hover:brightness-95 active:scale-95"
    >
      <span aria-hidden className="mr-1 text-xl leading-none">+</span>
      글쓰기
    </Link>
  )
}
