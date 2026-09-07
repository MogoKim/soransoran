'use client'

import Image from 'next/image'
import { TOUCH_MIN } from '@/lib/spacing'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import KakaoSignInButton from '@/components/features/KakaoSignInButton'

type Slide = {
  img: string
  /** 이미지 아래에 코드 텍스트로 얹는다. 글자 크기 토글에 함께 반응한다 */
  sub: string
  /**
   * 🔴 이미지 안 카피를 그대로 옮겨 적는다.
   *    사진에 박힌 글자는 화면 확대·글자 크기 토글에 반응하지 않고
   *    스크린리더도 읽지 못한다. alt 가 그 몫을 대신한다.
   */
  alt: string
}

const SLIDES: Slide[] = [
  {
    img: '/images/login/soransoran-login-slide-1.jpg',
    sub: '같은 시기를 지나는 또래에게\n털어놓으면 한결 가벼워져요.',
    alt: '소파에 앉아 휴대폰을 보는 사람. "혼자 앓던 고민, 이제 같이 나눠요"',
  },
  {
    img: '/images/login/soransoran-login-slide-2.jpg',
    sub: '글 하나 올리면 또래의\n진심 어린 댓글이 달려요.',
    alt: '휴대폰을 보며 웃는 사람과 댓글 말풍선. "내 이야기에, 나도 그래요"',
  },
  {
    img: '/images/login/soransoran-login-slide-3.jpg',
    sub: '갱년기 · 몸과 마음 · 사는 이야기,\n검색엔 없는 경험담을 만나요.',
    alt: '휴대폰을 함께 보며 웃는 두 사람. "먼저 걸어본 또래의 진짜 노하우"',
  },
]

const AUTO_MS = 5000
const SWIPE_THRESHOLD = 40

/**
 * 🔴 callbackUrl 은 page 가 만든 값을 그대로 쓴다. 여기서 기본값을 다시 정하지 않는다.
 *    hasReturnPath 는 안내 문구를 띄울지만 정한다 —
 *    직접 /login 으로 들어온 사람에게 "보던 화면으로 돌아와요" 는 사실이 아니다.
 */
export default function LoginOnboarding({
  callbackUrl,
  hasReturnPath,
}: {
  callbackUrl: string
  hasReturnPath: boolean
}) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)
  const startX = useRef<number | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // 자동 전환 — 점을 누르거나 밀 때마다 타이머가 다시 시작된다.
  // 움직임을 줄이도록 설정한 사람에게는 돌지 않는다.
  useEffect(() => {
    if (reduceMotion) return
    const t = setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), AUTO_MS)
    return () => clearTimeout(t)
  }, [index, reduceMotion])

  const goTo = useCallback((i: number) => {
    setIndex(((i % SLIDES.length) + SLIDES.length) % SLIDES.length)
  }, [])

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (startX.current === null) return
    const dx = e.changedTouches[0].clientX - startX.current
    if (dx <= -SWIPE_THRESHOLD) goTo(index + 1)
    else if (dx >= SWIPE_THRESHOLD) goTo(index - 1)
    startX.current = null
  }

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-surface-card sm:h-[86vh] sm:max-h-[760px] sm:max-w-[420px] sm:rounded-2xl">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="뒤로가기"
        className={`absolute left-2 top-[max(10px,env(safe-area-inset-top))] z-10 flex ${TOUCH_MIN} items-center gap-1 px-2 text-content-primary transition duration-150 hover:text-brand-strong active:scale-[0.98]`}
      >
        <span className="text-2xl leading-none" aria-hidden>
          ‹
        </span>
        <span className="break-keep font-bold">뒤로가기</span>
      </button>

      {/* 뒤로가기가 absolute 라 그 높이만큼 자리를 비워 둔다 */}
      <div className="shrink-0 pt-[max(52px,calc(env(safe-area-inset-top)+44px))]" aria-hidden />

      <div className="flex min-h-0 flex-1 flex-col px-6 py-2">
        <div
          className="flex min-h-0 w-full flex-1 overflow-hidden"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div
            className="flex h-full w-full"
            style={{
              transform: `translateX(-${index * 100}%)`,
              transition: reduceMotion ? 'none' : 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)',
            }}
          >
            {SLIDES.map((slide, i) => (
              <div key={slide.img} className="flex h-full w-full shrink-0 items-center justify-center">
                <div className="relative aspect-[4/5] h-full max-w-full overflow-hidden rounded-[28px] bg-surface-soft">
                  <Image
                    src={slide.img}
                    alt={slide.alt}
                    fill
                    sizes="(max-width: 420px) 100vw, 420px"
                    className="object-cover"
                    priority={i === 0}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <p
          aria-live="polite"
          className="mx-auto max-w-[340px] shrink-0 whitespace-pre-line break-keep pt-4 text-center text-lg font-semibold leading-[1.5] text-content-primary"
        >
          {SLIDES[index].sub}
        </p>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 pb-2">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.img}
            type="button"
            aria-label={`${i + 1}번째 화면으로 이동`}
            aria-current={i === index}
            onClick={() => goTo(i)}
            className="flex min-h-[36px] items-center px-1"
          >
            <span
              className={`block h-2 rounded-full transition-all duration-300 ${
                i === index ? 'w-6 bg-brand' : 'w-2 bg-content-muted/30'
              }`}
            />
          </button>
        ))}
      </div>

      <div className="shrink-0 px-6 pb-[max(20px,env(safe-area-inset-bottom))]">
        <KakaoSignInButton callbackUrl={callbackUrl} variant="onboarding" />

        <div className="mt-3 text-center">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center text-sm text-content-muted underline underline-offset-2"
          >
            먼저 둘러볼게요
          </Link>
        </div>

        {hasReturnPath ? (
          <p className="text-center text-xs leading-[1.6] text-content-muted">
            로그인하면 보던 화면으로 돌아와요.
          </p>
        ) : null}
      </div>
    </div>
  )
}
