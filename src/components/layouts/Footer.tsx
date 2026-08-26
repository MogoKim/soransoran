import Link from 'next/link'
import { SITE } from '@/lib/brand'
import FontSizeToggle from '@/components/layouts/FontSizeToggle'

/** FAQ 가 붙어도 이 배열에 한 줄만 늘어난다.
 *  emphasis 는 개인정보처리방침을 다른 링크와 구분해 표시하기 위한 것이다. */
const LINKS: { href: string; label: string; emphasis?: boolean }[] = [
  { href: '/terms', label: '이용약관' },
  { href: '/privacy', label: '개인정보처리방침', emphasis: true },
  { href: '/rules', label: '커뮤니티 규칙' },
  { href: '/contact', label: '문의' },
]

/** 하단 영역 — 약관·규칙·문의 접근 경로. 터치 타겟 52px 유지 */
export default function Footer() {
  return (
    <footer className="mt-16 border-t border-subtle bg-surface-card">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-8">
        <nav className="flex flex-wrap items-center gap-x-4">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`inline-flex min-h-[52px] items-center text-sm text-content-muted no-underline ${
                link.emphasis ? 'font-bold' : ''
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <FontSizeToggle />

        <p className="text-xs text-content-muted">
          {SITE.name} · soransoran.community@gmail.com
        </p>
        <p className="text-xs text-content-muted">
          이곳의 글은 회원들의 경험과 의견이며 의료·법률·금융 조언이 아닙니다.
        </p>
      </div>
    </footer>
  )
}
