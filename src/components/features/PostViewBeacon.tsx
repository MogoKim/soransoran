'use client'

import { useEffect } from 'react'

/** 같은 탭에서 같은 글을 두 번 세지 않기 위한 열쇠. 탭을 닫으면 사라진다. */
const seenKey = (postId: string) => `soransoran:viewed:${postId}`

/**
 * 글 조회 진단선 — 화면이 실제로 열린 뒤 한 번만 알린다.
 *
 * 🔴 서버 렌더 중에 세지 않는 이유가 이 컴포넌트의 존재 이유다.
 *    렌더에서 세면 프리페치와 크롤러가 그대로 조회수가 되고,
 *    상세 화면이 영영 쓰기 경로로 남아 캐시할 수 없게 된다.
 *    브라우저가 실제로 그린 뒤에 세면 그 둘이 구조적으로 걸러진다.
 *
 * 🔴 아무것도 그리지 않는다. 실패해도 화면에 아무 일이 없어야 한다.
 *    JS 를 꺼 둔 사람에게는 글이 그대로 보이고 숫자만 오르지 않는다.
 */
export default function PostViewBeacon({ postId }: { postId: string }) {
  useEffect(() => {
    if (!postId) return

    // sessionStorage 는 사생활 보호 모드 등에서 접근 자체가 막힐 수 있다.
    // 못 읽으면 중복 방지를 포기하되 기록은 계속한다 — 화면이 멈추는 것보다 낫다.
    let alreadySeen = false
    try {
      alreadySeen = window.sessionStorage.getItem(seenKey(postId)) !== null
    } catch {
      // 무시한다.
    }
    if (alreadySeen) return

    try {
      window.sessionStorage.setItem(seenKey(postId), '1')
    } catch {
      // 무시한다.
    }

    const url = `/api/view/${encodeURIComponent(postId)}`

    // sendBeacon 은 화면을 떠나도 전송이 보장된다. 응답을 읽지 않는 이 용도에 맞다.
    try {
      if (navigator.sendBeacon?.(url)) return
    } catch {
      // 아래 fetch 로 넘어간다.
    }

    // keepalive 로 이탈 중에도 전송을 이어 간다. 실패는 그대로 삼킨다.
    void fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
  }, [postId])

  return null
}
