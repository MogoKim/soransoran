'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { loginHref } from '@/lib/callback-url'
import { togglePostLike } from '@/lib/actions/likes'
import { shareOrCopy } from '@/lib/share-link'
import BottomSheet from '@/components/ui/BottomSheet'
import ReportButton from '@/components/features/ReportButton'

/**
 * 글 아래 행동 줄 — 읽고 → 공감하고 → 나누는 동선의 마디.
 *
 * 🔴 공감은 왼쪽에 크게, 공유·더보기는 오른쪽에 작게 둔다.
 *    셋을 같은 크기로 놓으면 무엇이 주된 반응인지 사라진다.
 *
 * 🔴 이번 단계에서 공감·스크랩은 저장하지 않는다.
 *    누르면 무슨 일이 일어날지 문장으로 알린다 — 눌러도 아무 일이 없는 버튼은
 *    고장으로 읽히고, 고장은 다시 누르지 않게 만든다.
 */
export default function PostActionBar({
  postId,
  title,
  currentPath,
  isLoggedIn,
  likeCount,
  isLiked,
}: {
  postId: string
  title: string
  currentPath: string
  isLoggedIn: boolean
  likeCount: number
  isLiked: boolean
}) {
  /** 🔴 로그인 링크는 안내마다 다르다. 문장과 함께 들고 다니지 않으면
      공유 성공 안내에까지 "로그인" 이 붙는다(실측으로 잡은 문제). */
  const [notice, setNotice] = useState<{ text: string; login?: true } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [liked, setLiked] = useState(isLiked)
  const [count, setCount] = useState(likeCount)
  const [, startTransition] = useTransition()
  /* 🔴 useTransition 의 pending 은 다음 렌더에 반영된다. 연타는 그 사이에 들어온다 —
     같은 tick 에서 막으려면 ref 가 필요하다. */
  const inFlight = useRef(false)

  async function onShare() {
    const result = await shareOrCopy(title, currentPath)
    if (result === 'cancelled') return // 닫은 것은 실패가 아니다
    setNotice({
      text:
        result === 'shared' ? '공유했어요.'
          : result === 'copied' ? '링크를 복사했어요.'
          : '링크 복사가 안 됐어요. 주소창의 주소를 복사해 주세요.',
    })
  }

  /**
   * 🔴 비로그인에게는 지금 할 수 있는 일만 말한다.
   *
   * 🔴 화면을 먼저 바꾸고 서버에 보낸다. 실패하면 이전 값으로 되돌린다 —
   *    누른 뒤 아무 일도 안 일어나는 순간이 있으면 다시 누르게 되고, 그 두 번째가 취소가 된다.
   */
  function onLike() {
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
      const result = await togglePostLike(postId)
      inFlight.current = false

      if (result.error) {
        setLiked(prevLiked)
        setCount(prevCount)
        setNotice({ text: result.error })
        return
      }
      // 서버가 센 값이 정답이다 — 그 사이 다른 사람이 누른 것까지 반영된다
      if (typeof result.likeCount === 'number') setCount(result.likeCount)
      if (typeof result.liked === 'boolean') setLiked(result.liked)
    })
  }

  function onScrap() {
    setSheetOpen(false)
    setNotice(
      isLoggedIn
        ? { text: '스크랩 기능은 준비 중이에요. 곧 열어드릴게요.' }
        : { text: '로그인하시면 스크랩을 쓰실 수 있어요.', login: true },
    )
  }

  return (
    <div className="mt-6 border-t border-subtle pt-3">
      <div className="flex items-center gap-2">
        {/* 공감 — 알약. 아직 켜지지 않는 상태라 채우지 않고 윤곽선으로 둔다 */}
        <button
          type="button"
          onClick={onLike}
          aria-label={liked ? '공감 취소' : '공감'}
          aria-pressed={liked}
          className={
            liked
              ? 'inline-flex min-h-[52px] items-center gap-2 rounded-full border border-interactive bg-surface-soft px-4 text-sm font-bold text-brand-ink transition duration-150 active:scale-[0.98]'
              : 'inline-flex min-h-[52px] items-center gap-2 rounded-full border border-interactive px-4 text-sm font-bold text-brand-ink transition duration-150 hover:bg-surface-soft active:scale-[0.98]'
          }
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill={liked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20s-7.2-4.6-7.2-9.4A4 4 0 0 1 12 7.6a4 4 0 0 1 7.2 3C19.2 15.4 12 20 12 20Z" />
          </svg>
          {/* 0 도 감추지 않는다 — 자리가 사라졌다 생겼다 하면 버튼 폭이 흔들린다 */}
          <span>공감 {count}</span>
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onShare}
          aria-label="공유"
          className="inline-flex min-h-[52px] items-center gap-1.5 rounded-lg px-3 text-sm text-content-muted transition duration-150 hover:text-brand-ink active:scale-[0.98]"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
            <path d="M12 15V3.8" />
            <path d="M8.2 7.6 12 3.8l3.8 3.8" />
          </svg>
          <span>공유</span>
        </button>

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="더보기"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className="inline-flex min-h-[52px] min-w-[52px] items-center justify-center rounded-lg text-content-muted transition duration-150 hover:text-brand-ink active:scale-[0.98]"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="currentColor">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </div>

      {/* 안내는 화면을 가리지 않는다 — 줄 아래에 남고, 다음 동작에서 갈린다 */}
      {notice ? (
        <p role="status" className="mt-2 text-sm text-content-secondary">
          {notice.text}
          {notice.login ? (
            <>
              {' '}
              <Link
                href={loginHref(currentPath)}
                className="min-h-[52px] text-link underline underline-offset-2"
              >
                로그인하기
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {/* 신고 폼은 시트를 닫고 이 자리에 편다 — 시트 안에 폼을 겹쳐 넣으면 되돌아갈 길이 사라진다 */}
      {reportOpen ? (
        <div className="mt-2">
          <ReportButton postId={postId} defaultOpen />
        </div>
      ) : null}

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="더보기">
        <div className="flex flex-col [&>button+button]:border-t [&>button+button]:border-subtle">
          <button
            type="button"
            onClick={onScrap}
            className="flex min-h-[52px] items-center gap-3 text-content-primary transition-colors duration-150 hover:text-brand-ink"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-[22px] w-[22px] shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4-6.5 4V5a1 1 0 0 1 1-1Z" />
            </svg>
            <span>스크랩</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSheetOpen(false)
              setReportOpen(true)
            }}
            className="flex min-h-[52px] items-center gap-3 text-state-danger transition-opacity duration-150 hover:opacity-80"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-[22px] w-[22px] shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 21V4h9l-.8 3.2H19l-1 4.4H5" />
            </svg>
            <span>신고</span>
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
