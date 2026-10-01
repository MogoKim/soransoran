'use client'

import { useLayoutEffect, useRef } from 'react'
import CommentIcon from '@/components/icons/CommentIcon'
import { useThreadNav } from '@/components/features/ThreadNavProvider'
import type { ReplyToView } from '@/lib/comment-view'

/**
 * 답글 위 한 줄 — "↳ 박마음님에게 답글". 누르면 대상 댓글로 간다.
 *
 * 🔴 한 줄이 기본이다. 긴 닉네임은 **이름 칸만** 폭에 맞춰 줄여 "초록대문집…님에게 답글" 로 붙인다.
 *    CSS 말줄임만 쓰면 "…" 뒤에 글자 하나만큼 빈칸이 남아 "님에게" 가 떨어져 보인다 —
 *    그래서 그려진 뒤 글자를 직접 줄인다. 그 전(하이드레이션 전)에는 CSS 말줄임이 대신한다.
 * 🔴 글자 크기는 줄이지 않는다. 전체 닉네임은 aria-label 에 남는다.
 * 🔴 보이는 "님에게 답글" 이 접근 이름 안에 그대로 들어간다 — 음성 조작으로 부를 수 있게.
 * 🔴 지운·차단 대상은 이름이 없다. 문구만 두고, 좁으면 두 줄까지 줄바꿈한다(자르지 않는다).
 * 🔴 보이는 높이는 한 줄, 누르는 높이는 52px — 위아래 음수 여백으로 메타 줄과 겹친다(메타 줄에는 누르는 것이 없다).
 */
export default function ReplyTargetLink({ fromId, target }: { fromId: string; target: ReplyToView }) {
  const nav = useThreadNav()
  const btnRef = useRef<HTMLButtonElement>(null)
  const whoRef = useRef<HTMLSpanElement>(null)
  const full = target.state === 'live' ? target.name : ''

  useLayoutEffect(() => {
    const btn = btnRef.current
    const who = whoRef.current
    if (!btn || !who || !full) return
    const fit = () => {
      const box = btn.parentElement
      if (!box) return
      const ps = getComputedStyle(box)
      const room = box.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)
      const bs = getComputedStyle(btn)
      // 🔴 <button> 의 scrollWidth 는 자식이 넘쳐도 자기 폭을 준다 — 자식 폭을 직접 더한다
      const need = () =>
        Array.from(btn.children).reduce((w, el) => {
          const cs = getComputedStyle(el)
          return w + el.getBoundingClientRect().width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight)
        }, parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight))
      who.style.flex = 'none'
      who.style.overflow = 'visible'
      who.textContent = full
      let n = full.length
      while (n > 1 && need() > room + 0.5) {
        n--
        who.textContent = full.slice(0, n) + '…'
      }
      who.style.flex = ''
      who.style.overflow = ''
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (btn.parentElement) ro.observe(btn.parentElement)
    // 글자 크기 3단계를 바꾸면 폭은 그대로여도 글자가 커진다
    const mo = new MutationObserver(fit)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font-size'] })
    void document.fonts?.ready.then(fit)
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [full])

  const gone = target.state !== 'live'
  const goneText = target.state === 'blocked' ? '차단한 회원의 댓글' : '삭제된 댓글'
  const label = gone
    ? `${goneText}에 대한 답글. ${goneText} 자리로 이동`
    : `${target.name}님${target.isPostAuthor ? '(글쓴이)' : ''}${target.isGuest ? '(비회원)' : ''}에게 답글. 대상 댓글로 이동`

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => nav?.jump(fromId, target.id)}
      aria-label={label}
      className="-mb-2.5 -ml-1.5 -mt-3 flex min-h-[52px] w-fit max-w-full items-center rounded-lg px-1.5 text-left text-meta leading-[1.4] text-content-muted"
    >
      <span className="mr-1">
        <CommentIcon name="reply-to" />
      </span>
      {gone ? (
        <span className="min-w-0 break-keep [overflow-wrap:anywhere]">
          <span className="italic text-content-secondary">{goneText}</span>에 대한 답글
        </span>
      ) : (
        <>
          <span
            ref={whoRef}
            className="min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap font-bold text-content-secondary underline decoration-1 underline-offset-[3px] hover:text-brand-strong"
          >
            {target.name}
          </span>
          <span className="shrink-0 whitespace-nowrap">님에게 답글</span>
        </>
      )}
    </button>
  )
}
