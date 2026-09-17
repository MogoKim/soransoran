'use client'

import { TOUCH_MIN } from '@/lib/spacing'

const LABEL = '댓글을 남겨주세요'

/**
 * 하단 댓글 진입점 — 모바일 전용.
 *
 * 🔴 입력창을 만들지 않는다. 누르면 원래 자리에 있는 입력 영역으로 **데려간다**.
 *    폼을 한 벌 더 두면 비회원 Turnstile 위젯이 둘이 되어 토큰이 어긋난다.
 * 🔴 폼을 이 자리로 끌어올리지도 않는다. 예전에는 화면 아래 시트로 옮기고 뒤를
 *    어둡게 덮었는데, 쓰는 동안 읽던 댓글이 보이지 않았다.
 *    가는 일과 쓰는 일을 나눠, 가는 일만 여기서 한다.
 */
export default function CommentDock({ onActivate }: { onActivate: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-subtle bg-surface-card px-4 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 md:hidden">
      <button
        type="button"
        onClick={onActivate}
        aria-label={LABEL}
        /* 🔴 코랄을 쓰지 않는다. 상시 떠 있는 하단 띠에 브랜드색을 얹으면 가입 배너로 읽힌다. */
        className={`flex ${TOUCH_MIN} w-full items-center gap-3 rounded-lg border border-interactive bg-surface-page px-4 text-left text-sm text-content-muted transition duration-150 active:scale-[0.99]`}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="shrink-0"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span className="truncate">{LABEL}</span>
        {/* 말풍선만으로는 "여기서 쓸 수 있다"가 전해지지 않는다 — 한 단어로 행동을 못 박는다 */}
        <span
          aria-hidden
          className="ml-auto shrink-0 rounded-lg border border-subtle bg-surface-card px-3 py-1 text-xs font-bold text-content-primary"
        >
          쓰기
        </span>
      </button>
    </div>
  )
}
