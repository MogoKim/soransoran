import { SIGNUP_FUNNEL_CONTENT_TYPES, type SignupFunnelContentType } from '@/lib/signup-funnel'

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
 * 🔴 지우는 일은 가입 완료(⑤) 쪽이 성공 응답 뒤에 한다(clearAuthMarker).
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

const AUTH_MARKER_KEYS = ['contentType', 'entryPoint', 'expiresAt'] as const

/**
 * 귀속 표식 검증 — 브라우저와 서버가 각자 부른다. 서버는 브라우저의 판정을 믿지 않고 다시 부른다(§8-4).
 *
 * 🔴 일반 객체 · 자기 키 정확히 셋 · 셋 다 데이터 속성이어야 한다. 추가·누락·symbol·숨은 키·getter·배열·
 *    클래스 객체는 거부한다. 입력을 고치지도, getter 를 부르지도 않는다.
 * 🔴 now 기준 만료(expiresAt ≤ now)와 30분을 넘는 미래 만료는 거부한다 — 브라우저가 늘린 만료를 믿지 않는다.
 */
export function parseAuthMarker(value: unknown, now: number): AuthMarker | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return null

  const keys = Reflect.ownKeys(value)
  if (keys.length !== AUTH_MARKER_KEYS.length) return null
  const values: Partial<Record<(typeof AUTH_MARKER_KEYS)[number], unknown>> = {}
  for (const key of AUTH_MARKER_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) return null
    values[key] = descriptor.value
  }

  const { contentType, entryPoint, expiresAt } = values
  if (typeof contentType !== 'string' || !(SIGNUP_FUNNEL_CONTENT_TYPES as readonly string[]).includes(contentType)) return null
  if (entryPoint !== 'content_end') return null
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) return null
  if (expiresAt <= now || expiresAt - now > AUTH_MARKER_TTL_MS) return null

  return { contentType: contentType as SignupFunnelContentType, entryPoint, expiresAt }
}

/** 저장된 표식을 읽어 검증한다. 읽기·파싱 실패와 무효 값은 null — 가입을 막지 않는다 */
export function readAuthMarker(storage: PromptStorage | null, now: number): AuthMarker | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(AUTH_MARKER_KEY)
    return raw === null ? null : parseAuthMarker(JSON.parse(raw), now)
  } catch {
    return null
  }
}

/** 가입 성공 뒤에만 부른다. 지우지 못해도 가입과 화면 이동을 막지 않는다 — 어차피 30분 뒤 만료다 */
export function clearAuthMarker(storage: { removeItem(key: string): void } | null): void {
  try {
    storage?.removeItem(AUTH_MARKER_KEY)
  } catch {
    // 삼킨다
  }
}
