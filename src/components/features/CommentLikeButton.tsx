'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { toggleCommentLike } from '@/lib/actions/comment-likes'
import { loginHref } from '@/lib/callback-url'

const FAILED = '공감 처리에 실패했어요. 잠시 뒤 다시 시도해 주세요.'

export default function CommentLikeButton({
  commentId,
  likeCount,
  isLiked,
  isLoggedIn,
}: {
  commentId: string
  likeCount: number
  isLiked: boolean
  isLoggedIn: boolean
}) {
  const pathname = usePathname()
  const [liked, setLiked] = useState(isLiked)
  const [count, setCount] = useState(likeCount)
  const [notice, setNotice] = useState<{ text: string; login?: true } | null>(null)
  const [, startTransition] = useTransition()
  /* useTransition 의 pending 은 다음 렌더에 반영된다 — 연타는 그 사이에 들어온다 */
  const inFlight = useRef(false)

  function onClick() {
    if (!isLoggedIn) {
      setNotice({ text: '로그인하시면 공감을 남기실 수 있어요.', login: true })
      return
    }
    if (inFlight.current) return
    inFlight.current = true

    const prevLiked = liked
    const prevCount = count
    setLiked(!prevLiked)
    setCount(prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1)
    setNotice(null)

    startTransition(async () => {
      try {
        const result = await toggleCommentLike(commentId)

        if (result.error) {
          setLiked(prevLiked)
          setCount(prevCount)
          setNotice({ text: result.error })
          return
        }
        // 서버가 센 값이 정답이다 — 그 사이 다른 사람이 누른 것까지 반영된다
        if (typeof result.likeCount === 'number') setCount(result.likeCount)
        if (typeof result.liked === 'boolean') setLiked(result.liked)
      } catch {
        setLiked(prevLiked)
        setCount(prevCount)
        setNotice({ text: FAILED })
      } finally {
        inFlight.current = false
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={liked ? '공감 취소' : '공감'}
        aria-pressed={liked}
        className={`inline-flex min-h-[52px] items-center gap-1.5 rounded-lg px-2 text-sm transition duration-150 active:scale-[0.98] ${
          liked ? 'font-bold text-brand-ink' : 'text-content-muted hover:text-brand-ink'
        }`}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill={liked ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20s-7.2-4.6-7.2-9.4A4 4 0 0 1 12 7.6a4 4 0 0 1 7.2 3C19.2 15.4 12 20 12 20Z" />
        </svg>
        {/* 0 도 감추지 않는다 — 자리가 사라졌다 생겼다 하면 줄 폭이 흔들린다 */}
        <span>공감 {count}</span>
      </button>

      {notice ? (
        <p role="status" className="m-0 text-sm text-content-muted">
          {notice.text}
          {notice.login ? (
            <>
              {' '}
              <Link href={loginHref(pathname)} className="text-link">
                카카오로 시작하기
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
