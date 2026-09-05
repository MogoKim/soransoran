'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'
import Link from 'next/link'
import { loginHref } from '@/lib/callback-url'
import { togglePostLike } from '@/lib/actions/likes'
import { togglePostScrap } from '@/lib/actions/scraps'
import {
  canWebShare,
  copyShareLink,
  preloadKakaoSdk,
  shareOrCopy,
  shareToKakao,
} from '@/lib/share-link'
import BottomSheet from '@/components/ui/BottomSheet'
import ReportButton from '@/components/features/ReportButton'

/**
 * 글 아래 행동 줄 — 읽고 → 공감하고 → 나누는 동선의 마디.
 *
 * 🔴 공감은 왼쪽에 크게, 공유·더보기는 오른쪽에 작게 둔다.
 *    셋을 같은 크기로 놓으면 무엇이 주된 반응인지 사라진다.
 *
 * 🔴 공감과 스크랩은 로그인 사용자에게 실제로 저장한다
 *    (togglePostLike · togglePostScrap). 비로그인에게는 로그인 안내만 한다.
 *
 * 🔴 무슨 일이 일어났는지 문장으로 알린다 — 눌렀는데 화면이 말이 없으면
 *    됐는지 안 됐는지 알 수 없고, 사람은 한 번 더 누른다.
 *
 * 🔴 공유는 갈래를 열어 보여준다. 우리 손님이 글을 나르는 길은 대부분 카카오톡인데,
 *    OS 공유 시트는 기기마다 목록이 달라 카카오톡을 찾아 헤매게 된다.
 *    카카오톡을 첫 줄에 두고, 나머지 길은 아래에 남긴다.
 *
 * 🔴 줄마다 하는 일과 이름이 같아야 한다. "링크 복사" 라 적고 공유 시트를 띄우지 않는다.
 */
export default function PostActionBar({
  postId,
  title,
  currentPath,
  isLoggedIn,
  likeCount,
  isLiked,
  isScrapped,
}: {
  postId: string
  title: string
  currentPath: string
  isLoggedIn: boolean
  likeCount: number
  isLiked: boolean
  isScrapped: boolean
}) {
  /** 🔴 로그인 링크는 안내마다 다르다. 문장과 함께 들고 다니지 않으면
      공유 성공 안내에까지 "로그인" 이 붙는다(실측으로 잡은 문제). */
  const [notice, setNotice] = useState<{ text: string; login?: true } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  /* 🔴 서버에는 navigator 가 없다. 첫 렌더에서 이 값을 읽으면 서버·브라우저 화면이
     달라져 hydration 이 어긋난다 — 마운트 뒤에 정한다. */
  const [webShareReady, setWebShareReady] = useState(false)
  const shareRef = useRef<HTMLDivElement>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [liked, setLiked] = useState(isLiked)
  const [count, setCount] = useState(likeCount)
  const [, startTransition] = useTransition()
  /* 🔴 useTransition 의 pending 은 다음 렌더에 반영된다. 연타는 그 사이에 들어온다 —
     같은 tick 에서 막으려면 ref 가 필요하다. */
  const inFlight = useRef(false)
  const [scrapped, setScrapped] = useState(isScrapped)
  const scrapInFlight = useRef(false)

  /* 🔴 카카오 SDK 는 이 화면에서만 미리 받아둔다. 클릭한 뒤에 받으면 iOS 가
     사용자 조작으로 보지 않아 공유창이 열리지 않는다. */
  useEffect(() => {
    preloadKakaoSdk()
    setWebShareReady(canWebShare())
  }, [])

  /* 열린 목록은 바깥을 누르거나 Esc 로 닫힌다 — 닫는 법이 하나뿐이면 갇힌 것처럼 느낀다 */
  useEffect(() => {
    if (!shareOpen) return

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target
      if (target instanceof Node && shareRef.current?.contains(target)) return
      setShareOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setShareOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [shareOpen])

  async function onKakaoShare() {
    setShareOpen(false)
    const result = await shareToKakao(title, currentPath)
    setNotice({
      text:
        result === 'shared' ? '카카오톡 공유창을 열었어요.'
          : result === 'copied' ? '카카오톡 공유를 쓸 수 없어 링크를 복사했어요. 붙여넣어 보내주세요.'
          : '공유가 안 됐어요. 주소창의 주소를 복사해 주세요.',
    })
  }

  async function onWebShare() {
    setShareOpen(false)
    const result = await shareOrCopy(title, currentPath)
    if (result === 'cancelled') return // 닫은 것은 실패가 아니다
    setNotice({
      text:
        result === 'shared' ? '공유했어요.'
          : result === 'copied' ? '링크를 복사했어요.'
          : '링크 복사가 안 됐어요. 주소창의 주소를 복사해 주세요.',
    })
  }

  async function onCopyLink() {
    setShareOpen(false)
    const copied = await copyShareLink(currentPath)
    setNotice({
      text: copied
        ? '링크를 복사했어요.'
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

  /** 🔴 공감과 같은 형태다 — 시트를 먼저 닫고, 화면을 바꾼 뒤, 실패하면 되돌린다. */
  function onScrap() {
    setSheetOpen(false)

    if (!isLoggedIn) {
      setNotice({ text: '로그인하시면 스크랩을 쓰실 수 있어요.', login: true })
      return
    }
    if (scrapInFlight.current) return
    scrapInFlight.current = true

    const prev = scrapped
    setScrapped(!prev)
    setNotice({ text: prev ? '스크랩을 해제했어요.' : '스크랩했어요. 내 정보에서 다시 보실 수 있어요.' })

    startTransition(async () => {
      const result = await togglePostScrap(postId)
      scrapInFlight.current = false

      if (result.error) {
        setScrapped(prev)
        setNotice({ text: result.error })
        return
      }
      if (typeof result.scrapped === 'boolean') setScrapped(result.scrapped)
    })
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
              ? `inline-flex ${TOUCH_MIN} items-center gap-2 rounded-full border border-interactive bg-surface-soft px-4 text-sm font-bold text-brand-ink transition duration-150 active:scale-[0.98]`
              : `inline-flex ${TOUCH_MIN} items-center gap-2 rounded-full border border-interactive px-4 text-sm font-bold text-brand-ink transition duration-150 hover:bg-surface-soft active:scale-[0.98]`
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

        {/* 🔴 목록은 이 버튼에 붙여 오른쪽 끝을 맞춘다. 화면 왼쪽으로 펼쳐지므로
              좁은 폭에서도 밖으로 나가지 않는다. */}
        <div className="relative" ref={shareRef}>
          <button
            type="button"
            onClick={() => setShareOpen((open) => !open)}
            aria-label="공유"
            aria-haspopup="menu"
            aria-expanded={shareOpen}
            className={`inline-flex ${TOUCH_MIN} items-center gap-1.5 rounded-lg px-3 text-sm text-content-muted transition duration-150 hover:text-brand-ink active:scale-[0.98]`}
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

          {shareOpen ? (
            /* 🔴 카카오 브랜드 노랑을 칠하지 않는다. 색은 토큰에만 산다 —
                  여기 리터럴을 두면 나중에 색을 바꿀 때 이 파일부터 놓친다. */
            <div
              role="menu"
              aria-label="공유 방법"
              className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-xl border border-subtle bg-surface-card p-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={onKakaoShare}
                className={`flex w-full ${TOUCH_MIN} items-center gap-3 rounded-lg px-3 text-sm text-content-primary transition-colors duration-150 hover:bg-surface-soft`}
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
                  <path d="M12 4.2c-4.5 0-8.2 2.8-8.2 6.3 0 2.2 1.5 4.2 3.8 5.3l-.9 3.3 3.7-2.2c.5.1 1.1.1 1.6.1 4.5 0 8.2-2.8 8.2-6.5S16.5 4.2 12 4.2Z" />
                </svg>
                <span>카카오톡으로 공유</span>
              </button>

              {webShareReady ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={onWebShare}
                  className={`flex w-full ${TOUCH_MIN} items-center gap-3 rounded-lg px-3 text-sm text-content-primary transition-colors duration-150 hover:bg-surface-soft`}
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
                    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                    <path d="M12 15V3.8" />
                    <path d="M8.2 7.6 12 3.8l3.8 3.8" />
                  </svg>
                  <span>다른 앱으로 공유</span>
                </button>
              ) : null}

              <button
                type="button"
                role="menuitem"
                onClick={onCopyLink}
                className={`flex w-full ${TOUCH_MIN} items-center gap-3 rounded-lg px-3 text-sm text-content-primary transition-colors duration-150 hover:bg-surface-soft`}
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
                  <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2" />
                  <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2" />
                </svg>
                <span>링크 복사</span>
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => {
            setShareOpen(false)
            setSheetOpen(true)
          }}
          aria-label="더보기"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={`inline-flex ${TOUCH_MIN} min-w-[52px] items-center justify-center rounded-lg text-content-muted transition duration-150 hover:text-brand-ink active:scale-[0.98]`}
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
                className={`${TOUCH_MIN} text-link underline underline-offset-2`}
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
            aria-pressed={scrapped}
            className={`flex ${TOUCH_MIN} items-center gap-3 text-content-primary transition-colors duration-150 hover:text-brand-ink`}
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-[22px] w-[22px] shrink-0"
              fill={scrapped ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4-6.5 4V5a1 1 0 0 1 1-1Z" />
            </svg>
            <span>{scrapped ? '스크랩 해제' : '스크랩'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSheetOpen(false)
              setReportOpen(true)
            }}
            className={`flex ${TOUCH_MIN} items-center gap-3 text-state-danger transition-opacity duration-150 hover:opacity-80`}
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
