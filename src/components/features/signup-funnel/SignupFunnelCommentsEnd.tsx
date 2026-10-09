'use client'

import { useEffect } from 'react'
import { useComposeMode } from '@/components/features/ComposeModeProvider'
import SignupFunnelMarker from '@/components/features/signup-funnel/SignupFunnelMarker'
import { useSignupFunnelTracker } from '@/components/features/signup-funnel/SignupFunnelTracker'

/**
 * 커뮤니티 댓글 끝 감지 지점 — CommentSection 의 afterComments 슬롯에 들어간다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §5-2 · §6-3.
 *
 * 🔴 슬롯은 공개 댓글·답글 목록 바로 뒤, 댓글 입력창 앞이다. 답글을 펼치면 목록이 길어져 이 지점이
 *    아래로 밀린다 — 관측이 그대로 그 이동을 따른다.
 * 🔴 답글·수정·비회원 수정/삭제 폼의 열림은 ComposeModeProvider 의 otherComposerOpen 하나로 본다.
 *    읽기만 한다. 댓글 쪽에 새 상태·이벤트를 더하지 않는다. 초점이 빠져도 폼이 열려 있으면 계속 막힌다.
 */
export default function SignupFunnelCommentsEnd() {
  const { otherComposerOpen } = useComposeMode()
  const tracker = useSignupFunnelTracker()
  const composeConflict = tracker?.composeConflict

  useEffect(() => {
    composeConflict?.(otherComposerOpen)
  }, [composeConflict, otherComposerOpen])

  return <SignupFunnelMarker kind="content-end" />
}
