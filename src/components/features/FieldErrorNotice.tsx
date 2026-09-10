'use client'

import { useEffect, useRef } from 'react'

/**
 * 막힌 입력칸 바로 옆에 붙는 안내.
 *
 * 🔴 화면 위쪽 요약 하나로 끝내지 않는다. 제목이 막혔는데 안내가 화면 맨 위에만 있으면,
 *    본문을 길게 쓴 사람은 스크롤을 올려야 이유를 보고 다시 내려와야 한다.
 *    막힌 자리에서 말한다.
 *
 * 🔴 role="alert" 로 즉시 읽힌다. 그리고 같은 문장을 위쪽 요약이 또 읽지 않도록
 *    부르는 쪽이 요약을 감춘다 — 두 번 낭독되면 무엇이 문제인지 더 헷갈린다.
 *
 * 🔴 문구를 자르지 않는다. 걸린 표현이 길어도 줄바꿈으로 흘려보낸다 —
 *    말줄임표로 끊기면 정작 바꿔야 할 말이 보이지 않는다.
 *
 * 🔴 **자기 자신을 화면 가운데로 데려온다.**
 *    한때는 부르는 쪽이 입력칸(또는 본문 wrapper)을 scrollIntoView 했는데,
 *    본문 상자는 min-height 가 240px+42svh 라 그 상자를 가운데 두면 아래 끝에 붙은 안내가
 *    화면 밖으로 밀린다. 실측(2026-09-10, 격리 프로필):
 *
 *      키보드 열린 390×380 — wrapper 를 center: 안내 top 401 / 하단 고정 CTA top 316 → **가려짐**
 *                            안내를 center:   안내 top 163 / 같은 CTA top 316 → 보임
 *
 *    "왜 막혔는지" 를 말해 주려고 만든 문장이 정작 안 보이면 고친 것이 아니다.
 *    마운트되는 것은 안내 자신이므로, 자기 자리를 아는 여기서 옮긴다.
 */
export default function FieldErrorNotice({ id, message }: { id: string; message: string }) {
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  return (
    <p
      ref={ref}
      id={id}
      role="alert"
      className="text-sm font-bold text-state-danger [word-break:keep-all] [overflow-wrap:anywhere]"
    >
      {message}
    </p>
  )
}
