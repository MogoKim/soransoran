/**
 * 🔴 **한 회차에는 시각이 하나다** (2026-09-23 마스터 지적)
 *
 *   부모(`supply-process`)와 자식(`micro-seed-auto-draft`)이 **각자 `new Date()`** 를
 *   만들면, KST 자정이나 Persona 생일 경계를 사이에 두고 두 프로세스가 **다른 날**을
 *   본다. 그러면
 *     · 부모가 만든 계약의 `personaPoolDigest`(나이가 들어간다) 와
 *     · 자식이 artifact 에 적는 계약
 *   이 달라지고, **끝난 원천이 terminal 로 인정되지 않아** 같은 원천을 유료로 되풀이한다.
 *
 * 🔴 부모가 ISO 문자열 하나를 만들어 자식 env 로 넘긴다. 자식은 그 값만 쓴다.
 */
export const RUN_AT_ENV = 'SORAN_RUN_AT'

/** 🔴 시간대까지 명시된 ISO 만 받는다 — 관대한 파싱은 잘못된 날짜를 통과시킨다 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export type RunClock = {
  at: Date
  /** 🔴 어디서 왔는가 — 회차 로그에 찍어 사람이 본다 */
  from: 'parent' | 'self'
}

/**
 * 🔴 **부모가 준 시각이 있으면 그것을 쓴다.** 없으면 자기 시계다(단독 실행).
 *    🔴 있는데 **모양이 틀렸으면 던진다** — 조용히 자기 시계로 돌아가면
 *       "부모와 같은 값을 쓴다" 는 계약이 거짓이 되고, 그 사실이 아무 데도 남지 않는다.
 */
export function runClockFrom(env: Readonly<Record<string, string | undefined>>): RunClock {
  const raw = (env[RUN_AT_ENV] ?? '').trim()
  if (raw === '') return { at: new Date(), from: 'self' }
  if (!ISO_INSTANT.test(raw)) {
    throw new Error(`${RUN_AT_ENV} 가 ISO 시각이 아니다 — "${raw}"`)
  }
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) throw new Error(`${RUN_AT_ENV} 를 읽지 못했다 — "${raw}"`)
  return { at: new Date(ms), from: 'parent' }
}
