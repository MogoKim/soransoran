/**
 * GA4 커스텀 이벤트 전송 — 얇은 한 겹.
 *
 * 🔴 측정 ID 를 여기 다시 적지 않는다.
 *    이 속성에 붙은 태그는 하나뿐이다(GoogleAnalytics.tsx 의 config 1회).
 *    gtag 는 send_to 가 없으면 config 된 대상 전부로 보내는데, 그 전부가 곧 그 하나다.
 *    ID 를 두 곳에 적으면 한쪽만 고쳐지는 날이 오고, 그날 이벤트가 어디로 갔는지 알 수 없다.
 *    (page_view 는 GoogleAnalytics.tsx 가 send_to 를 명시한다 — 그 파일은 건드리지 않는다)
 *
 * 🔴 hostname 을 다시 보지 않는다.
 *    TRACKED_HOSTS 판정은 GoogleAnalytics.tsx 하나가 한다. 여기서 또 재면 두 곳이 되고,
 *    언젠가 서로 다른 답을 낸다. 추적하지 않는 호스트에서는 그 파일이 태그를 올리지 않아
 *    window.gtag 자체가 없고, 그러면 이 함수는 그대로 아무 일도 하지 않는다.
 *    그 성질이 preview 에서 gtag 스텁을 꽂아 호출 횟수를 세는 검증을 가능하게 한다.
 *
 * 🔴 window.gtag 의 전역 타입(GtagArgs)은 page_view 만 허용한다.
 *    그 선언을 고치지 않고 여기서만 좁혀 읽는다 — GoogleAnalytics.tsx 무접촉이 목적이다.
 *    2단 단언은 그 파일이 이미 쓰는 관용구이고, any 를 쓰지 않는다.
 *
 * 🔴 계측이 화면을 멈추게 하지 않는다. 실패는 삼킨다 —
 *    이벤트 하나 때문에 글쓰기가 죽는 쪽이 훨씬 큰 손해다.
 */
import type { SoranEventMap, SoranEventName, SoranEventParams } from '@/lib/analytics/events'

type EventGtag = (command: 'event', name: SoranEventName, params: SoranEventParams) => void

/**
 * 🔴 전역 Window 선언에 기대지 않는다.
 *    `window.gtag` 의 타입은 GoogleAnalytics.tsx 안의 `declare global` 이 정한다.
 *    그 선언은 앱 tsconfig 에만 들어 있어서, 이 모듈을 가드 스크립트(tsconfig.ops.json)가
 *    가져오면 "Window 에 gtag 가 없다" 로 컴파일이 깨진다.
 *    여기서 window 를 좁혀 읽으면 이 파일이 홀로 서고, 동결된 그 파일에 손댈 이유도 없어진다.
 */
type GtagHolder = { gtag?: unknown }

export function trackEvent<K extends SoranEventName>(name: K, params: SoranEventMap[K]): void {
  if (typeof window === 'undefined') return

  const send = (window as unknown as GtagHolder).gtag as EventGtag | undefined
  if (typeof send !== 'function') return

  try {
    send('event', name, params)
  } catch {
    /* 삼킨다. 전송이 끊기면 계기판의 0 이 그걸 드러낸다 */
  }
}
