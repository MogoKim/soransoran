'use client'

import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import Logo from '@/components/brand/Logo'

/**
 * route 에러 화면
 *
 * 🔴 stack trace · error.message · env 를 화면에 노출하지 않는다.
 *    사용자에게는 무엇을 하면 되는지만 보여준다.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center">
      {/* 🔴 브랜드명을 여기서 직접 마크업하지 않는다 — 워드마크는 Logo 한 곳이 정본이다 */}
      <Logo />
      <h1 className="mt-6 text-xl font-bold text-content-primary">
        화면을 불러오지 못했습니다
      </h1>
      <p className="mt-2 text-sm text-content-muted">
        잠시 후 다시 시도해 주세요. 계속 같은 화면이 보이면 알려주시면 확인하겠습니다.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className={`inline-flex ${TOUCH_MIN} items-center rounded-lg bg-cta px-6 font-bold text-cta-text transition duration-150 hover:brightness-95 active:scale-95`}
        >
          다시 시도
        </button>
        <Link
          href="/"
          className={`inline-flex ${TOUCH_MIN} items-center rounded-lg border border-interactive px-6 font-bold text-brand-strong no-underline transition duration-150 hover:bg-surface-soft active:scale-[0.98]`}
        >
          홈으로
        </Link>
      </div>
    </main>
  )
}
