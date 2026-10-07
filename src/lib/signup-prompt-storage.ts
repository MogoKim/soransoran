import type { SignupFunnelContentType } from '@/lib/signup-funnel'

/**
 * 가입 제안 브라우저 저장 — 24시간 노출 제한과 인증 왕복 귀속 표식. 순수 함수 · storage·시계 주입.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §7 · §8-4.
 *
 * 🔴 두 키만 쓴다. 기존 조회수·글쓰기 인증 키와 공유하지 않는다.
 *      노출 키   최초 실제 노출 시각(ms) 하나
 *      표식 키   contentType · entryPoint · expiresAt 세 값
 *    콘텐츠 경로·ID·slug·회원 값은 어느 키에도 들어가지 않는다. 쿠키를 쓰지 않는다.
 * 🔴 저장을 확인할 수 없으면 노출하지 않는다(§7). 노출 기록은 쓰고 다시 읽어 같은 값일 때만 성공이다.
 * 🔴 어느 함수도 예외를 밖으로 던지지 않는다.
 */

export const PROMPT_SHOWN_KEY = 'soran-signup-prompt-shown'
export const AUTH_MARKER_KEY = 'soran-signup-auth-return'
export const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000
export const AUTH_MARKER_TTL_MS = 30 * 60 * 1000

export type PromptStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type PromptExposure = 'allowed' | 'cooldown' | 'unreadable'

/**
 * 지금 노출해도 되는가.
 *   값 없음 · 숫자가 아닌 손상값        → allowed (새 노출을 시도할 수 있다)
 *   최초 노출 뒤 24시간 미만            → cooldown
 *   지금보다 미래인 값                  → cooldown (안전하게 해석할 수 없다 — 노출하지 않는다)
 *   정확히 24시간 · 그 이후             → allowed
 *   읽기 자체가 실패                    → unreadable
 */
export function decidePromptExposure(storage: PromptStorage, now: number): PromptExposure {
  let raw: string | null
  try {
    raw = storage.getItem(PROMPT_SHOWN_KEY)
  } catch {
    return 'unreadable'
  }
  if (raw === null || !/^\d{1,15}$/.test(raw)) return 'allowed'
  const shownAt = Number(raw)
  if (shownAt > now) return 'cooldown'
  return now - shownAt >= PROMPT_COOLDOWN_MS ? 'allowed' : 'cooldown'
}

/** 노출 시각을 쓰고 다시 읽어 확인한다. 하나라도 실패하면 false — 노출하지 않는다 */
export function recordPromptExposure(storage: PromptStorage, now: number): boolean {
  const value = String(now)
  try {
    storage.setItem(PROMPT_SHOWN_KEY, value)
    return storage.getItem(PROMPT_SHOWN_KEY) === value
  } catch {
    return false
  }
}

/** 24시간 제한을 통과하고 노출 기록에 성공했을 때만 true — dialog 를 열어도 된다 */
export function claimPromptExposure(storage: PromptStorage | null, now: number): boolean {
  if (!storage) return false
  if (decidePromptExposure(storage, now) !== 'allowed') return false
  return recordPromptExposure(storage, now)
}

export type AuthMarker = {
  contentType: SignupFunnelContentType
  entryPoint: 'content_end'
  expiresAt: number
}

/**
 * 인증을 시작하는 순간 귀속 표식을 남긴다(§8-4 A안). 실패해도 인증은 그대로 시작한다 — false 만 돌려준다.
 * 🔴 지우는 일은 가입 완료(⑤) 쪽이 한다. 여기서는 쓰기만 한다.
 */
export function writeAuthMarker(storage: PromptStorage | null, contentType: SignupFunnelContentType, now: number): boolean {
  if (!storage) return false
  const marker: AuthMarker = { contentType, entryPoint: 'content_end', expiresAt: now + AUTH_MARKER_TTL_MS }
  try {
    storage.setItem(AUTH_MARKER_KEY, JSON.stringify(marker))
    return true
  } catch {
    return false
  }
}
