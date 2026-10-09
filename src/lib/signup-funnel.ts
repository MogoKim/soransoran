/**
 * 회원가입 전환 측정 계약 — 단계·허용값·payload·비율 정의의 **단일 위치**.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8.
 *
 * 🔴 브라우저와 서버가 함께 쓰는 순수 모듈이다. DB · env · 시계 · React · 인증 · server-only 를 들이지 않는다.
 *    여기 하나라도 들어오면 클라이언트 번들이 서버 의존을 끌고 가거나, 서버 판정이 브라우저에서 갈린다.
 *
 * 🔴 이벤트 이름·허용값·비율 정의를 다른 파일에서 다시 적지 않는다. 필요한 곳은 여기서 가져간다.
 *
 * 🔴 익명 기록 경로는 ①~④ 네 단계만 받는다. ⑤ signup_complete 는 서버가 최초 온보딩 전환을 확인한
 *    자리에서만 기록한다(정본 §8-5) — 익명 경로로 받으면 누구나 가입 완료를 지어낼 수 있다.
 */

/** 다섯 단계 — 순서가 곧 화면의 퍼널 순서다 */
export const SIGNUP_FUNNEL_STEPS = [
  'logged_out_view',
  'prompt_reach',
  'prompt_impression',
  'auth_start',
  'signup_complete',
] as const
export type SignupFunnelStep = (typeof SIGNUP_FUNNEL_STEPS)[number]

/** 익명 기록 경로가 받을 수 있는 단계 — signup_complete 는 없다 */
export const ANONYMOUS_FUNNEL_STEPS = [
  'logged_out_view',
  'prompt_reach',
  'prompt_impression',
  'auth_start',
] as const satisfies readonly SignupFunnelStep[]
export type AnonymousFunnelStep = (typeof ANONYMOUS_FUNNEL_STEPS)[number]

export const SIGNUP_FUNNEL_CONTENT_TYPES = ['community', 'magazine'] as const
export type SignupFunnelContentType = (typeof SIGNUP_FUNNEL_CONTENT_TYPES)[number]

/** 출입구 — 새 출입구가 생겨도 기존 content_end 숫자의 의미는 바뀌지 않는다 */
export const SIGNUP_FUNNEL_ENTRY_POINTS = ['content_end'] as const
export type SignupFunnelEntryPoint = (typeof SIGNUP_FUNNEL_ENTRY_POINTS)[number]

/** 클라이언트가 보낼 수 있는 값은 이 세 개뿐이다(정본 §8-3) */
export type SignupFunnelPayload<S extends SignupFunnelStep = SignupFunnelStep> = {
  step: S
  contentType: SignupFunnelContentType
  entryPoint: SignupFunnelEntryPoint
}
export type AnonymousFunnelPayload = SignupFunnelPayload<AnonymousFunnelStep>

/**
 * 저장 key — SignupFunnelDaily 의 복합 PK 와 같은 네 값이다.
 * 🔴 `day` 는 서버가 정한 KST 'YYYY-MM-DD' 다. 클라이언트 날짜를 받지 않는다.
 */
export type SignupFunnelKey = SignupFunnelPayload & { day: string }

/**
 * 어드민이 보여 줄 수 있는 비율 — **이 세 개뿐이다**(정본 §8-6). 항상 분자·분모와 함께 보인다.
 * 🔴 열람→가입 전환율 · 카카오 시작→가입 완료율은 일부러 없다. signup_complete 는 건수로만 보인다.
 */
export const SIGNUP_FUNNEL_RATIOS = [
  { id: 'end_reach_observed', label: '끝 도달 관측 비율', numerator: 'prompt_reach', denominator: 'logged_out_view' },
  { id: 'prompt_policy_working', label: '노출 정책 작동 비율', numerator: 'prompt_impression', denominator: 'prompt_reach' },
  { id: 'cta_response', label: 'CTA 반응 비율', numerator: 'auth_start', denominator: 'prompt_impression' },
] as const satisfies ReadonlyArray<{
  id: string
  label: string
  numerator: AnonymousFunnelStep
  denominator: AnonymousFunnelStep
}>
export type SignupFunnelRatio = (typeof SIGNUP_FUNNEL_RATIOS)[number]

const PAYLOAD_KEYS = ['step', 'contentType', 'entryPoint'] as const

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/** 일반 객체만 — 배열 · null · 클래스 인스턴스 · 원시값은 아니다 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * 키가 정확히 셋이고 셋 다 데이터 속성인 문자열이어야 한다.
 *
 * 🔴 추가 키가 **하나라도** 있으면 요청 전체를 거부한다(정본 §8-3). 버리고 집계하지 않는다 —
 *    버리고 집계하면 콘텐츠 ID 같은 값이 섞여 들어와도 알아챌 길이 없다.
 * 🔴 symbol 키 · 열거되지 않는 키 · getter 도 키로 센다. 입력을 고치지도, getter 를 부르지도 않는다.
 */
function parseWith<S extends SignupFunnelStep>(
  input: unknown,
  steps: readonly S[],
): SignupFunnelPayload<S> | null {
  if (!isPlainObject(input)) return null

  const keys = Reflect.ownKeys(input)
  if (keys.length !== PAYLOAD_KEYS.length) return null

  const values: Partial<Record<(typeof PAYLOAD_KEYS)[number], unknown>> = {}
  for (const key of PAYLOAD_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !('value' in descriptor)) return null
    values[key] = descriptor.value
  }

  const { step, contentType, entryPoint } = values
  if (!isOneOf(steps, step)) return null
  if (!isOneOf(SIGNUP_FUNNEL_CONTENT_TYPES, contentType)) return null
  if (!isOneOf(SIGNUP_FUNNEL_ENTRY_POINTS, entryPoint)) return null

  return { step, contentType, entryPoint }
}

/** 익명 기록 경로용 — ①~④ 만. signup_complete 는 거부한다 */
export function parseAnonymousFunnelPayload(input: unknown): AnonymousFunnelPayload | null {
  return parseWith(input, ANONYMOUS_FUNNEL_STEPS)
}

/** 서버 내부용 — 다섯 단계 전부 */
export function parseSignupFunnelPayload(input: unknown): SignupFunnelPayload | null {
  return parseWith(input, SIGNUP_FUNNEL_STEPS)
}

/**
 * KST 날짜 문자열 모양 검사 — 'YYYY-MM-DD' 이고 실제로 있는 날짜인가.
 * 🔴 지금 시각을 읽지 않는다. 날짜를 **정하는** 일은 서버가 한다(정본 §8-3).
 */
export function isSignupFunnelDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** 저장 key 가 계약 안의 값인가 — 저장 모듈이 쓰기 전에 본다 */
export function isSignupFunnelKey(key: SignupFunnelKey): boolean {
  return (
    isSignupFunnelDay(key.day) &&
    isOneOf(SIGNUP_FUNNEL_STEPS, key.step) &&
    isOneOf(SIGNUP_FUNNEL_CONTENT_TYPES, key.contentType) &&
    isOneOf(SIGNUP_FUNNEL_ENTRY_POINTS, key.entryPoint)
  )
}
