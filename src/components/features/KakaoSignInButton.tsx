'use client'

import { signIn } from 'next-auth/react'

/**
 * 카카오 로그인 버튼
 *
 * 색은 카카오 브랜드 가이드를 따르되, 그 외 화면 요소는 소란소란 토큰을 쓴다.
 * 카카오 버튼은 예외적으로 브랜드 색이 강제되는 지점이다.
 *
 * 🔴 누름 피드백에 소란소란 색을 섞지 않는다.
 *    hover 는 --kakao-bg 를 그대로 두고 밝기만 낮춘다(brightness).
 *    다른 CTA 처럼 hover 색을 따로 두면 카카오 노란색이 아니게 된다.
 */
export default function KakaoSignInButton({ callbackUrl = '/' }: { callbackUrl?: string }) {
  return (
    <button
      type="button"
      onClick={() => signIn('kakao', { callbackUrl })}
      className="inline-flex min-h-[52px] w-full max-w-xs items-center justify-center rounded-lg bg-kakao px-6 font-bold text-kakao-text transition duration-150 hover:brightness-95 active:scale-95"
    >
      카카오로 시작하기
    </button>
  )
}
