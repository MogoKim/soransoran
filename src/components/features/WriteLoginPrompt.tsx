'use client'

import { useEffect, useId, useRef } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'
import KakaoSignInButton from '@/components/features/KakaoSignInButton'
import { trackEvent } from '@/lib/analytics/track'
import { markWriteAuthStart } from '@/lib/analytics/write-auth-marker'
import type { BoardSlug } from '@/lib/board-registry'

/**
 * 다 쓰고 등록을 누른 비회원에게 보여 주는 안내.
 *
 * 🔴 로그인 화면으로 곧장 보내지 않는다. 글을 쓴 사람이 가장 먼저 하는 걱정은
 *    "지금 나가면 내 글은?" 이다. 그 답을 먼저 보여 주고 나서 로그인을 권한다.
 *    화면을 갈아치우면 답할 자리가 없다.
 *
 * 🔴 ui/BottomSheet 를 쓰지 않는다. 생김새는 같지만 그쪽의 마지막 버튼은 "닫기" 로 박혀 있다.
 *    여기서 그 자리는 "계속 작성하기" 여야 한다 — 닫는 동작이 아니라 쓰던 일로 돌아가는
 *    동작이라고 말해야, 로그인 말고 다른 길이 있다는 것이 읽힌다.
 *    라벨을 열려고 공용 시트를 고치면 카테고리 선택 등 다른 시트까지 흔들린다.
 *    대신 검증된 동작(스크림·스크롤 잠금·Esc·초점)은 그대로 따라간다.
 *
 * 🔴 스크림은 색과 투명도를 나눠 적는다. 토큰이 var() 라서 `bg-x/40` 형태는
 *    유틸리티가 생성되지 않아 스크림이 투명해진다(BottomSheet 에 같은 기록이 있고,
 *    이 화면에서도 실측으로 rgba(0,0,0,0) 을 확인했다).
 *
 * 🔴 이 컴포넌트는 글을 저장하지 않는다. 부르는 쪽(PostForm)이 띄우기 전에
 *    이미 저장을 마쳤다. 저장과 안내가 두 곳에 나뉘면 "안내는 떴는데 저장은 안 된"
 *    순간이 생기고, 그때 사용자는 문구를 믿고 나갔다가 글을 잃는다.
 *
 * 🔴 이 화면은 form 안에서 렌더된다. 모든 button 에 type="button" 이 필요하다 —
 *    빠뜨리면 기본값이 submit 이라, 로그인을 막으려고 띄운 안내가 도리어
 *    서버 액션을 부른다.
 */
export default function WriteLoginPrompt({
  boardSlug,
  callbackUrl,
  warning,
  onClose,
}: {
  /** 어느 게시판에서 나가는가. 표식과 계측이 같은 값을 써야 돌아왔을 때 짝이 맞는다. */
  boardSlug: BoardSlug
  /** 로그인 뒤 돌아올 곳. 게시판까지 포함한 글쓰기 경로여야 임시저장을 찾을 수 있다. */
  callbackUrl: string
  /** 임시저장이 실패했을 때만 온다 — 아래 warning 블록 참조 */
  warning?: string
  onClose: () => void
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  /**
   * 🔴 useState 가 아니라 ref 다. signIn 은 화면을 떠나기까지 수백 ms 가 걸리고
   *    그 사이 버튼은 살아 있다. state 로 막으면 다음 렌더에야 반영돼 연타가 먼저 들어온다
   *    (PostActionBar 가 같은 이유로 ref 를 쓴다).
   *
   * 🔴 안내를 닫았다 다시 열면 이 컴포넌트가 다시 마운트돼 ref 가 풀린다. 그게 맞다 —
   *    "계속 작성하기" 로 돌아갔다가 나중에 다시 누른 것은 별개의 인증 시도다.
   */
  const authStartedRef = useRef(false)

  /**
   * 🔴 표식을 이벤트보다 **먼저** 심는다.
   *    GA 가 막힌 환경에서도 "돌아와서 글이 살아났는가" 판정은 살아 있어야 한다.
   *    반대로 두면 계측이 실패한 사람은 복원 여부도 영영 알 수 없다.
   */
  function handleSignInStart() {
    if (authStartedRef.current) return
    authStartedRef.current = true

    markWriteAuthStart(boardSlug, Date.now())
    trackEvent('write_auth_start', { board_slug: boardSlug, method: 'kakao' })
  }

  useEffect(() => {
    // 되돌아갈 길은 눈에 보이는 버튼 말고 키보드에도 있어야 한다.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    // 뒤 화면이 같이 움직이면 어디를 만지고 있는지 알 수 없다.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 초점을 안으로 옮긴다 — 뒤에 남으면 가려진 입력칸을 계속 치게 된다.
    panelRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div aria-hidden className="absolute inset-0 bg-content-primary opacity-50" onClick={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full rounded-t-2xl border border-subtle bg-surface-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-5 text-center outline-none sm:max-w-[420px] sm:rounded-2xl sm:pb-5"
      >
        <p id={titleId} className="m-0 text-lg font-bold text-content-primary">
          작성한 글은 그대로 있어요
        </p>
        <p className="m-0 mt-1 text-sm text-content-muted">
          로그인하면 이어서 등록할 수 있어요
        </p>

        {/*
          🔴 임시저장이 막힌 브라우저(사파리 시크릿 등)에서는 위 문장이 거짓이 된다.
             그대로 두면 "그대로 있다" 를 믿고 나갔다가 글을 잃는다.
             그래서 저장 실패는 조용히 넘기지 않고, 나가기 전에 이 자리에서 말한다.
        */}
        {warning ? (
          <p role="alert" className="m-0 mt-3 text-sm font-bold text-state-danger">
            {warning}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col items-center gap-1">
          <KakaoSignInButton
            callbackUrl={callbackUrl}
            label="카카오로 계속하기"
            onSignInStart={handleSignInStart}
          />

          <button
            type="button"
            onClick={onClose}
            className={`${TOUCH_MIN} px-4 text-sm text-content-muted`}
          >
            계속 작성하기
          </button>
        </div>
      </div>
    </div>
  )
}
