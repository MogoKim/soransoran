import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import { SITE } from '@/lib/brand'
import FontSizeToggle from '@/components/layouts/FontSizeToggle'
import { cn } from '@/lib/utils'

/** 화면이 늘어도 이 배열에 한 줄만 늘어난다.
 *  emphasis 는 개인정보처리방침을 다른 링크와 구분해 표시하기 위한 것이다. */
const LINKS: { href: string; label: string; emphasis?: boolean }[] = [
  { href: '/terms', label: '이용약관' },
  { href: '/privacy', label: '개인정보처리방침', emphasis: true },
  { href: '/rules', label: '커뮤니티 규칙' },
  { href: '/contact', label: '문의' },
  { href: '/faq', label: '자주 묻는 질문' },
]

/** 상호는 등록증 표기 그대로 둔다 — 줄이면 다른 사업자로 읽힌다. */
const BUSINESS = {
  name: '케이에이지랩(K-Agelab)',
  owner: '김용석',
  registrationNumber: '457-24-01157',
  address: '서울특별시 노원구 월계로55길 15',
} as const

/**
 * 하단 영역 — 약관·규칙·문의·사업자 정보. 터치 타겟 52px 유지
 *
 * avoidFloatingAction 은 FAB 이 있는 화면에서만 모바일 하단 여백을 늘려
 * 마지막 문구가 가리는 것을 막는다. 넓은 화면은 원래 여백으로 돌아간다.
 */
export default function Footer({ avoidFloatingAction = false }: { avoidFloatingAction?: boolean }) {
  return (
    <footer className="mt-16 border-t border-subtle bg-surface-card">
      <div
        className={cn(
          'mx-auto flex max-w-3xl flex-col gap-2 px-4 pt-8',
          avoidFloatingAction ? 'pb-28 lg:pb-8' : 'pb-8',
        )}
      >
        <nav className="flex flex-wrap items-center gap-x-4">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`inline-flex ${TOUCH_MIN} items-center text-sm text-content-muted no-underline ${
                link.emphasis ? 'font-bold' : ''
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <FontSizeToggle />

        {/* 🔴 summary 에 display 를 주지 않는다 — 주면 크롬·사파리에서 펼침 표시가 사라진다. */}
        <details className="text-content-muted">
          <summary className="cursor-pointer py-4 text-sm">사업자 정보</summary>
          <address className="flex flex-col gap-0.5 not-italic text-xs leading-[1.7]">
            <span className="break-keep">
              {SITE.name} · {BUSINESS.name} · 대표 {BUSINESS.owner}
            </span>
            <span className="break-keep">사업자등록번호 {BUSINESS.registrationNumber}</span>
            <span className="break-keep">{BUSINESS.address}</span>
          </address>
        </details>
      </div>
    </footer>
  )
}
