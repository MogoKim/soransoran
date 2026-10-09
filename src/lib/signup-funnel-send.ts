import type { AnonymousFunnelPayload } from '@/lib/signup-funnel'

/**
 * 익명 회원가입 전환 기록을 보낸다 — 브라우저 전용 · fire-and-forget.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-2 · §8-11.
 *
 * 🔴 응답을 기다리지 않는다. 화면·사용자 행동이 계측 응답에 묶이지 않는다.
 * 🔴 실패와 예외는 이 함수 안에서 끝난다. 재시도·대기열·timer 를 두지 않는다.
 * 🔴 세 값만 보낸다. 받은 객체를 그대로 직렬화하지 않고 다시 만든다 — 콘텐츠 경로·ID·사용자 값이
 *    실수로 섞여 들어와도 밖으로 나가지 않는다.
 * 🔴 import 할 때 브라우저 API 를 부르지 않는다. 부를 때만 navigator 를 본다.
 */
const ENDPOINT = '/api/signup-funnel'

export function sendAnonymousFunnelEvent(payload: AnonymousFunnelPayload): void {
  try {
    const body = JSON.stringify({
      step: payload.step,
      contentType: payload.contentType,
      entryPoint: payload.entryPoint,
    })
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(ENDPOINT, body)) return
    }
    // sendBeacon 이 없거나 대기열이 거절한 경우만. 기다리지 않고 다시 보내지도 않는다.
    void fetch(ENDPOINT, { method: 'POST', body, keepalive: true, credentials: 'same-origin' }).catch(() => {})
  } catch {
    // 계측 때문에 화면이 멈추지 않는다.
  }
}

/**
 * mount 한 번에 한 번만 보낸다 — 방문 정의(정본 §8-2)의 판정 자리.
 *
 * 🔴 guard 는 컴포넌트 인스턴스의 ref 다. 같은 mount 의 rerender · React 개발 모드의 effect 재실행은
 *    같은 guard 를 보므로 다시 보내지 않는다. 새로고침·새 탭은 새 인스턴스라 새 guard — 새 방문이다.
 * 🔴 브라우저 저장소를 쓰지 않는다. 콘텐츠 경로를 브라우저에 남기지 않는다.
 */
export function sendOncePerMount(
  guard: { sent: boolean },
  payload: AnonymousFunnelPayload,
  send: (payload: AnonymousFunnelPayload) => void = sendAnonymousFunnelEvent,
): void {
  if (guard.sent) return
  guard.sent = true
  send(payload)
}
