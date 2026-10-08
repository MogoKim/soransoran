/**
 * 가입 제안 dialog 의 열림·닫힘·인증 시작 상태 — DOM 과 분리한 순수 상태 기계.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §6-4 · §6-5 · §8-1.
 *
 * 🔴 한 mount 에서 dialog 는 최대 한 번 열린다. 닫힌 뒤 다시 열지 않는다.
 * 🔴 CTA 는 첫 시도만 받아들인다. 연타는 거절한다 — 인증 호출과 ④ 가 한 번이 된다.
 * 🔴 진행 중에는 X · dim · ESC · 보조 버튼 · 뒤로가기 닫기를 받지 않는다.
 * 🔴 인증 왕복이 일어난 dialog 가 bfcache 로 돌아오면 닫는다. 같은 dialog 안에서 바로 다시 시도하게 하지 않고,
 *    이벤트·표식을 다시 만들지 않는다. 다시 시도는 이후의 정상 흐름에서 시작한다.
 */

export type PromptCloseSource = 'close-button' | 'dim' | 'escape' | 'secondary' | 'back'
export type PromptPhase = 'idle' | 'open' | 'pending' | 'closed'

export type PromptFlow = {
  phase(): PromptPhase
  /** 열어도 되면 true — idle 에서 한 번뿐 */
  open(): boolean
  /** 닫기 요청. 받아들이면 true */
  close(source: PromptCloseSource): boolean
  /** CTA 시도. 첫 시도만 true */
  startSignIn(): boolean
  /** bfcache 복원 — 진행 중이었으면 닫고 true. 그 밖에는 그대로 false */
  restoreFromCache(): boolean
}

export function createPromptFlow(): PromptFlow {
  let phase: PromptPhase = 'idle'
  return {
    phase: () => phase,
    open() {
      if (phase !== 'idle') return false
      phase = 'open'
      return true
    },
    close() {
      if (phase !== 'open') return false
      phase = 'closed'
      return true
    },
    startSignIn() {
      if (phase !== 'open') return false
      phase = 'pending'
      return true
    },
    restoreFromCache() {
      if (phase !== 'pending') return false
      phase = 'closed'
      return true
    },
  }
}

/**
 * Tab 초점 순환 — 다음 초점의 위치. 끝에서 Tab 은 처음으로, 처음에서 Shift+Tab 은 끝으로.
 * 지금 초점이 목록 밖이면(-1) Tab 은 처음, Shift+Tab 은 끝.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1
  if (current < 0) return backwards ? count - 1 : 0
  return backwards ? (current - 1 + count) % count : (current + 1) % count
}

/** 스크롤 잠금 동안 스크롤바가 사라진 폭만큼 오른쪽 여백을 채운다 — 본문이 옆으로 밀리지 않게 */
export function scrollbarCompensation(windowInnerWidth: number, documentClientWidth: number): number {
  return Math.max(0, windowInnerWidth - documentClientWidth)
}
