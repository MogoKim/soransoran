'use client'

import { signIn } from 'next-auth/react'
import { TOUCH_MIN } from '@/lib/spacing'
import { onboardingHref } from '@/lib/callback-url'

/**
 * 카카오 로그인 버튼
 *
 * 색은 카카오 브랜드 가이드를 따르되, 그 외 화면 요소는 소란소란 토큰을 쓴다.
 * 카카오 버튼은 예외적으로 브랜드 색이 강제되는 지점이다.
 *
 * 🔴 누름 피드백에 소란소란 색을 섞지 않는다.
 *    hover 는 --kakao-bg 를 그대로 두고 밝기만 낮춘다(brightness).
 *    다른 CTA 처럼 hover 색을 따로 두면 카카오 노란색이 아니게 된다.
 *
 * 🔴 variant 는 생김새만 바꾼다.
 *    signIn 호출과 callbackUrl 전달은 어느 쪽이든 같은 한 줄이다 —
 *    모양 때문에 인증 경로가 갈라지면 한쪽만 고쳐지는 날이 온다.
 *
 * 🔴 로그인 뒤 목적지를 여기서 한 번 감싼다.
 *    시작 CTA 는 전부 이 버튼 하나를 지난다. 감싸는 자리를 여기 두면
 *    홈·글쓰기·상세 어디서 시작하든 같은 길로 간다 — 화면마다 각자
 *    감싸면 한 곳을 빠뜨리는 날이 오고, 그 입구로 들어온 사람만
 *    가입을 마치지 않은 채 서비스에 남는다.
 */

/**
 * default = 화면 안에 놓이는 기본형 · onboarding = 로그인 화면 하단 고정 CTA
 * prompt = 회원가입 전환 가입 제안 dialog 의 CTA(B안 · 높이 56px · 진행 중 비활성 표시)
 */
type Variant = 'default' | 'onboarding' | 'prompt'

const SHAPE: Record<Variant, string> = {
  default: `${TOUCH_MIN} max-w-xs rounded-lg px-6`,
  onboarding: 'min-h-[60px] rounded-xl px-4 py-2 shadow-kakao',
  prompt: 'min-h-[56px] rounded-xl px-4 py-2 disabled:cursor-default disabled:opacity-70',
}

/** 시작 CTA는 같은 라벨을 쓴다. */
const LABEL = '카카오로 3초 만에 시작하기'

export default function KakaoSignInButton({
  callbackUrl = '/',
  variant = 'default',
  label = LABEL,
  onSignInStart,
  disabled,
}: {
  callbackUrl?: string
  variant?: Variant
  /**
   * 🔴 라벨만 바꿀 수 있게 열어 둔다. 기본값은 그대로라 기존 화면은 달라지지 않는다.
   *    글을 다 쓰고 등록을 누른 사람에게 "3초 만에 시작하기" 는 처음 온 사람에게 하는 말이라
   *    이미 한 일을 못 본 척하는 문구가 된다.
   *
   * 🔴 그렇다고 그 화면에서 signIn 을 직접 부르지 않는다. onboardingHref 로 감싸는 자리가
   *    이 버튼 하나여야 입구마다 빠뜨리는 곳이 생기지 않는다(위 주석과 같은 이유).
   */
  label?: string
  /**
   * 나가기 직전에 부를 일 — 지금은 글쓰기 화면이 인증 시작을 세고 표식을 심는 데 쓴다.
   *
   * 🔴 선택이다. 넘기지 않은 화면(홈·로그인)은 지금과 한 글자도 달라지지 않는다.
   * 🔴 여기서 하는 일은 부르는 것뿐이다. 무엇을 셀지·막을지는 부르는 쪽이 정한다 —
   *    이 버튼은 외부 브랜드 자산이라(brand-assets.ts) 계측 규칙을 안에 들이지 않는다.
   * 🔴 signIn 앞에 둔다. signIn 은 화면을 떠나므로 뒤에 두면 실행되지 않는다.
   *    await 를 걸지 않는다 — 기다리는 사이 iOS 가 사용자 조작으로 보지 않을 수 있다.
   * 🔴 false 를 돌려주면 이번 누름은 인증을 시작하지 않는다(연타 거절). 아무것도 돌려주지 않는
   *    기존 호출부는 지금처럼 인증을 시작한다.
   */
  onSignInStart?: () => boolean | void
  /** 진행 중 표시 — 넘기지 않으면 기존 화면의 버튼 마크업은 그대로다 */
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (onSignInStart?.() === false) return
        signIn('kakao', { callbackUrl: onboardingHref(callbackUrl) })
      }}
      className={`inline-flex w-full flex-wrap items-center justify-center gap-2 break-keep bg-kakao text-center font-bold leading-tight text-kakao-text transition duration-150 hover:brightness-95 active:scale-95 ${SHAPE[variant]}`}
    >
      {variant === 'onboarding' ? (
        <svg className="shrink-0" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M10 2C5.582 2 2 4.925 2 8.5c0 2.26 1.37 4.25 3.46 5.43l-.9 3.3a.25.25 0 0 0 .38.27L8.8 15.5c.39.05.79.08 1.2.08 4.418 0 8-2.925 8-6.5S14.418 2 10 2Z"
            fill="currentColor"
          />
        </svg>
      ) : null}
      <span className="min-w-0">{label}</span>
    </button>
  )
}
