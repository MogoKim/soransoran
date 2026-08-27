'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import { cn } from '@/lib/utils'

/** 이 아래로는 접지 않는다 — 화면 맨 위에서 버튼이 깜빡이며 줄어드는 것을 막는다 */
const COLLAPSE_AFTER_PX = 100

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

/**
 * 글쓰기 FAB. 로그인 여부는 보지 않는다 — 로그인 요청은 /write 와 createPost 가 담당한다.
 *
 * 🔴 내려 읽는 동안에는 접힌다.
 *    실측(2026-08-27 soransoran.com, 390px): 홈·자유게시판 어디서 멈춰도 항목 하나를 가렸다.
 *    펼친 폭은 116px(기본) · 137px("크게")이고, 접으면 둘 다 56px 이다 —
 *    가리는 폭이 기본에서 48%, "크게"에서 41% 로 줄어든다.
 *    올릴 때 · 맨 위일 때 다시 라벨을 보여 준다 — 되돌아가려는 순간이 쓰려는 순간이다.
 *
 * 🔴 사라지게 하지 않는다.
 *    감추면 가림은 완전히 없어지지만 글쓰기 진입점도 같이 없어진다.
 *    이 서비스의 목적은 글을 쓰게 하는 것이라 버튼은 항상 화면에 남는다.
 *
 * 🔴 접혀도 이름은 남는다.
 *    라벨은 시각적으로만 접고 aria-label 은 그대로 둔다.
 *    스크린리더에는 두 상태가 같은 버튼이어야 한다.
 *
 * 🔴 움직임을 줄이도록 설정해도 접는 것은 그대로 한다.
 *    한때 reduced motion 이면 scroll listener 자체를 붙이지 않았는데, 그건
 *    "애니메이션을 줄여 달라"는 요청에 **글 가림 방지 기능을 통째로 끄는** 응답이었다.
 *    그 설정을 켠 사람이 글을 더 잘 가려진 채로 읽어야 할 이유가 없다.
 *
 *    그래서 접힘은 항상 동작하고, 없애는 것은 **전환 애니메이션뿐**이다.
 *    판정은 CSS 의 motion-safe: 로 넘긴다 — 미디어 쿼리라 설정을 도중에 바꿔도
 *    즉시 따라가고, JS 가 상태를 한 번 읽고 마는 문제가 없다.
 */
export default function FAB() {
  const pathname = usePathname()
  const writeHref = resolveWriteHref(pathname)
  const [collapsed, setCollapsed] = useState(false)

  const active = writeHref !== null

  useEffect(() => {
    if (!active) return

    let lastY = window.scrollY

    const onScroll = () => {
      const y = window.scrollY
      setCollapsed(y > lastY && y > COLLAPSE_AFTER_PX)
      lastY = y
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [active])

  // active 가 아니라 writeHref 로 막아야 아래에서 href 타입이 string 으로 좁혀진다
  if (writeHref === null) return null

  return (
    <Link
      href={writeHref}
      aria-label="글쓰기"
      className={cn(
        /* motion-safe: 를 붙인 것은 전환뿐이다. 접힘(폭·여백) 자체는 항상 적용된다 —
           움직임을 줄이도록 설정하면 애니메이션 없이 바로 그 폭이 된다. */
        'fixed bottom-6 right-5 z-40 inline-flex h-[56px] items-center justify-center rounded-full bg-cta font-bold text-cta-text no-underline shadow-[shadow:var(--shadow-brand)] hover:brightness-95 motion-safe:transition-all motion-safe:duration-200 motion-safe:active:scale-95',
        collapsed ? 'w-[56px] px-0' : 'px-6',
      )}
    >
      <span aria-hidden className="text-xl leading-none">
        +
      </span>
      {/* 접힘은 폭으로 준다 — display:none 으로 지우면 글자가 튀듯 사라진다.
          펼친 폭은 넉넉히 잡는다: 글자 크기 "크게"에서 본문이 24px 이라
          세 글자가 72px 을 넘는다. 여기서 좁게 잡으면 라벨이 잘린다. */}
      <span
        aria-hidden
        className={cn(
          'overflow-hidden whitespace-nowrap motion-safe:transition-all motion-safe:duration-200',
          collapsed ? 'ml-0 max-w-0 opacity-0' : 'ml-1.5 max-w-[140px] opacity-100',
        )}
      >
        글쓰기
      </span>
    </Link>
  )
}
