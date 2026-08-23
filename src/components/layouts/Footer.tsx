import Link from 'next/link'
import { SITE } from '@/lib/brand'
import FontSizeToggle from '@/components/layouts/FontSizeToggle'

/** 하단 영역 — 법무 문서 접근 경로. 터치 타겟 52px 유지 */
export default function Footer() {
  return (
    <footer className="mt-16 border-t border-subtle bg-surface-card">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-8">
        <nav className="flex flex-wrap items-center gap-x-4">
          <Link
            href="/terms"
            className="inline-flex min-h-[52px] items-center text-sm text-content-muted no-underline"
          >
            이용약관
          </Link>
          <Link
            href="/privacy"
            className="inline-flex min-h-[52px] items-center text-sm font-bold text-content-muted no-underline"
          >
            개인정보처리방침
          </Link>
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
