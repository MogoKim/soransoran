'use client'

import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import { usePathname } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { toggleCommentLike } from '@/lib/actions/comment-likes'
import { loginHref } from '@/lib/callback-url'

const FAILED = '공감 처리에 실패했어요. 잠시 뒤 다시 시도해 주세요.'

/**
 * 🔴 서버가 돌려준 "로그인이 필요합니다." 를 그대로 보여주지 않는다.
 *    같은 버튼인데 사전 차단은 아래 문장 + 로그인하기 링크이고, 서버 경로만
 *    딱딱한 문장에 **갈 곳이 없었다.** 같은 상황이면 같게 말한다.
 *
 * 🔴 문자열 비교는 **단기 선택**이다 — 서버 문구가 바뀌면 매핑이 조용히 끊긴다.
 *    길게는 서버가 `code: 'LOGIN_REQUIRED'` 를 돌려주는 쪽이 맞지만 이번 범위가 아니다.
 *    (`PostActionBar` 에 같은 짝이 있다. 전역 상수는 아직 만들지 않는다 —
 *     고객면과 운영면을 가른 뒤에 정한다)
 */
const SERVER_LOGIN_REQUIRED = '로그인이 필요합니다.'
const NEEDS_LOGIN = '로그인하시면 공감을 남기실 수 있어요.'

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
      setNotice({ text: NEEDS_LOGIN, login: true })
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
          setNotice(
            result.error === SERVER_LOGIN_REQUIRED
              ? { text: NEEDS_LOGIN, login: true }
              : { text: result.error },
          )
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
        className={`inline-flex ${TOUCH_MIN} items-center gap-1.5 rounded-lg px-2 text-sm transition duration-150 active:scale-[0.98] ${
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

      {/* 🔴 색은 `PostActionBar` 의 notice 와 맞춘다 — 둘은 같은 자리의 쌍둥이다
             (같은 state 모양 · 같은 마크업 · 같은 "동작 결과 안내문" 역할).
             muted 는 메타용이라 읽어야 하는 문장을 내려 두는 셈이었다. 6.14 → 9.08 로 오른다.
             정본 §12-14 ② 가 남긴 "올려 맞추는 방향" 이다 — PostActionBar 를 내리지 않는다.
          🔴 링크에 밑줄을 붙인다. 색만으로 링크를 구분하지 않는다.
             본문이 9.08 로 오르면 링크(5.50)와 격차가 벌어져 더 그렇다. */}
      {notice ? (
        <p role="status" className="m-0 text-sm text-content-secondary">
          {notice.text}
          {notice.login ? (
            <>
              {' '}
              <Link
                href={loginHref(pathname)}
                className="text-link underline underline-offset-2"
              >
                카카오로 시작하기
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
