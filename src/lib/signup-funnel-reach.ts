/**
 * 회원가입 전환 ② prompt_reach — 가입 제안 기준 도달 판정. 브라우저 DOM 과 분리한 순수 상태 기계.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §5 · §6-3 · §8-1 · §8-2.
 *
 * 🔴 도달 = (커뮤니티라면 본문 끝을 먼저 관측) → 끝 감지 지점이 **충돌 없이 연속 1초** 보임.
 * 🔴 pending timer 는 최대 하나다. 감지 지점이 나가거나 충돌이 생기면 즉시 취소한다.
 * 🔴 충돌이 생긴 그 "보임 구간" 은 오염된다. 충돌이 닫혀도 감지 지점이 한 번 나갔다 다시 들어오기 전에는
 *    다시 재지 않는다(정본 §5-2 · §6-3). 들어오는 순간 충돌이 열려 있어도 그 구간은 오염이다.
 * 🔴 한 기계는 mount 하나다. 도달하면 끝이다 — 같은 mount 에서 두 번 알리지 않는다.
 *
 * 시계·DOM 은 인자로 받는다. 이 파일은 window · document · setTimeout 을 직접 부르지 않는다.
 */

export const REACH_DWELL_MS = 1000

export type ReachMachineOptions = {
  /** 커뮤니티 true — 본문 끝을 먼저 관측해야 한다. 매거진 false */
  requireBodyEnd: boolean
  /** 지금 DOM 에 충돌 UI 가 있는가 — 시작·완료 순간과 대기 중 변화 때 묻는다 */
  domConflict: () => boolean
  onReach: () => void
  /** 대기 시작·끝 — 대기 중에만 DOM 변화를 지켜보게 하는 손잡이 */
  onPendingChange?: (pending: boolean) => void
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  dwellMs?: number
}

export type ReachMachine = {
  /** 본문 끝 감지 지점이 한 번이라도 보였다 */
  bodyEndSeen(): void
  /** 끝 감지 지점의 보임 여부 */
  contentEnd(visible: boolean): void
  /** 답글·수정·비회원 수정/삭제 폼 열림(ComposeModeProvider.otherComposerOpen) */
  composeConflict(open: boolean): void
  /** 대기 중 DOM 이 바뀌었다 — 충돌을 다시 본다 */
  domChanged(): void
  dispose(): void
}

export function createReachMachine(o: ReachMachineOptions): ReachMachine {
  const dwell = o.dwellMs ?? REACH_DWELL_MS
  let bodySeen = !o.requireBodyEnd
  let visible = false
  let tainted = false
  let compose = false
  let pending: { handle: unknown } | null = null
  let done = false
  let disposed = false

  const conflictNow = () => compose || o.domConflict()

  function cancel(): void {
    if (!pending) return
    o.clearTimer(pending.handle)
    pending = null
    o.onPendingChange?.(false)
  }

  function taint(): void {
    tainted = true
    cancel()
  }

  function fire(): void {
    pending = null
    o.onPendingChange?.(false)
    if (done || disposed) return
    if (conflictNow()) {
      tainted = true
      return
    }
    done = true
    o.onReach()
  }

  function tryStart(): void {
    if (done || disposed || pending || !visible || tainted || !bodySeen) return
    if (conflictNow()) {
      tainted = true
      return
    }
    pending = { handle: o.setTimer(fire, dwell) }
    o.onPendingChange?.(true)
  }

  return {
    bodyEndSeen() {
      if (bodySeen || disposed) return
      bodySeen = true
      tryStart()
    },
    contentEnd(next) {
      if (disposed) return
      if (next === visible) return
      visible = next
      if (!next) {
        cancel()
        return
      }
      // 새 보임 구간 — 지난 구간의 오염은 여기서 끝난다
      tainted = false
      tryStart()
    },
    composeConflict(open) {
      if (disposed) return
      compose = open
      if (open && visible) taint()
    },
    domChanged() {
      if (disposed || !pending) return
      if (o.domConflict()) taint()
    },
    dispose() {
      cancel()
      disposed = true
    },
  }
}

/** 문서에서 읽을 최소 모양 — 시험이 가짜 문서를 넣을 수 있게 */
export type ConflictDocument = {
  querySelector(selectors: string): unknown
  activeElement: unknown
}

/**
 * 공개 DOM 의미만으로 보는 충돌 UI.
 *
 *   열린 modal·sheet  [role=dialog][aria-modal=true] · [role=alertdialog] · dialog[open]
 *   열린 menu·popover  [role=menu] · [aria-haspopup][aria-expanded=true]
 *   작성 초점          입력 요소(textarea · 글자 input · select · contenteditable · iframe)에 초점
 *                      — 모바일 키보드는 이 초점이 있을 때만 열린다
 *
 * 🔴 답글·수정·비회원 수정/삭제 폼이 초점 없이 열린 상태는 DOM 으로 구분되지 않는다.
 *    그 상태는 composeConflict(otherComposerOpen) 하나가 맡는다.
 */
const CONFLICT_SELECTOR = [
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"]',
  'dialog[open]',
  '[role="menu"]',
  '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]',
].join(', ')

const NON_TEXT_INPUT = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'hidden', 'range', 'color', 'file'])

function isEditing(active: unknown): boolean {
  if (!active || typeof active !== 'object') return false
  const el = active as { tagName?: unknown; type?: unknown; isContentEditable?: unknown }
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'IFRAME') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUT.has(String(el.type ?? 'text').toLowerCase())
  return el.isContentEditable === true
}

export function hasDomConflict(doc: ConflictDocument): boolean {
  return doc.querySelector(CONFLICT_SELECTOR) !== null || isEditing(doc.activeElement)
}
