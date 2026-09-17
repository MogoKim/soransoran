'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { AdminActionState } from '@/lib/actions/admin'
import { useToast } from '@/components/ui/toast'

/**
 * 어드민 조치 버튼 — 이 파일 하나가 모든 조치 버튼을 맡는다.
 *
 * 🔴 조치마다 컴포넌트를 만들지 않는다. 1차 목표는 구조가 아니라 운영 가능 상태다.
 *    호출부가 서버 액션을 감싼 함수만 넘기면 된다.
 *
 * 🔴 confirm 은 되돌리기 어려운 쪽에만 붙인다.
 *    가리기·차단에는 묻고, 되돌리기(공개·해제)에는 묻지 않는다 —
 *    매번 물으면 사람이 읽지 않고 누르게 된다.
 *
 * 🔴 성공하면 router.refresh() 로 서버 컴포넌트를 다시 그린다.
 *    revalidatePath 만으로는 지금 보고 있는 화면이 바뀌지 않는다.
 *
 * 🔴 조치가 끝났다는 것은 토스트가 알린다.
 *    다시 그려도 바뀌는 것이 배지 한 글자뿐인 조치가 많다 —
 *    목록에서 어느 행을 눌렀는지 놓치면 무엇이 바뀌었는지 알 수 없다.
 *
 * 🔴 문구는 label 에서 만든다. 조치마다 상수를 두지 않는다.
 *    다만 "숨기기했어요" 처럼 말이 안 되는 라벨이 있어 successText 로 덮을 수 있게 둔다.
 */
export default function AdminActionButton({
  label,
  run,
  confirmText,
  successText,
  tone = 'default',
  disabled,
}: {
  label: string
  run: () => Promise<AdminActionState>
  /** 있으면 누르기 전에 확인을 묻는다 */
  confirmText?: string
  /** 기본 문구(`${label}했어요.`)가 어색한 조치만 적는다 */
  successText?: string
  tone?: 'default' | 'danger'
  disabled?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    if (confirmText && !window.confirm(confirmText)) return
    startTransition(async () => {
      const res = await run()
      if (res.error) {
        setError(res.error)
        return
      }
      /* 🔴 같은 행을 연달아 누르면 줄이 쌓이지 않게 label 로 자리를 묶는다 */
      toast.success(successText ?? `${label}했어요.`, { key: `admin:${label}` })
      router.refresh()
    })
  }

  /**
   * 🔴 크기 클래스를 붙인다 (2026-09-17).
   *    전에는 없어서 body(고객값 20px)를 상속했고, 고객 "글자 크기" 3단계까지
   *    따라가 버튼만 18~24px 로 흔들렸다. 조치 버튼이 화면에서 가장 큰 요소가 되어
   *    보조 링크·상태 배지가 그 아래로 묻혔다.
   *    17px 는 브랜드 정본이 admin CTA 대비를 판정할 때 전제한 크기대이기도 하다.
   *
   * 🔴 채움/외곽선 구분과 위험도 의미는 **그대로 둔다.**
   *    tone='danger' = 외곽선 · 기본 = 채움. 확인창(confirmText)·disabled 조건도 무수정.
   *    바꾼 것은 글자 크기와 **외곽선 글자색뿐**이다.
   *
   * 🔴 외곽선 글자를 --brand-ink → --brand-strong 으로 바꿨다.
   *    brand-ink(#FA4601)는 흰 카드 위 3.53:1 이다. 20px bold 일 때는 큰 글씨
   *    기준 3.0 을 넘어 통과했지만, 17px 로 내리면 본문 4.5 기준에 미달한다.
   *    brand-strong(#C43300)은 5.50:1 — 정본 §1-2 의 "작은 글씨는 brand-strong" 규칙 그대로다.
   */
  const base =
    'inline-flex min-h-[52px] items-center justify-center rounded-lg px-4 text-base font-bold transition duration-150 active:scale-[0.98] disabled:opacity-50'
  const skin =
    tone === 'danger'
      ? 'border border-interactive text-brand-strong hover:bg-surface-soft'
      : 'bg-cta text-content-primary hover:brightness-95'

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={onClick} disabled={pending || disabled} className={`${base} ${skin}`}>
        {pending ? '처리 중…' : label}
      </button>
      {error ? <p className="text-sm text-state-danger">{error}</p> : null}
    </div>
  )
}
