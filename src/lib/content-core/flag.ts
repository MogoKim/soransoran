/**
 * Content Core v2 스위치 — 🔴 **이 PR 에는 운영 진입점이 없다.**
 *
 * 🔴 **router 를 여기 만들지 않는다** (2026-09-19 보정).
 *    앞판은 v1 진입점이 이 스위치를 읽어 `true` 면 멈추게 했다. 그런데 v2 에는
 *    운영 runner 도 ledger adapter 도 없다 — *"v2 가 맡는다"* 고 찍으면서
 *    **실제로는 0건**이 되는 상태였다. 그런 상태를 남기지 않는다.
 *
 * 🔴 router 는 **v2 runner · ledger adapter 와 같은 세로 작업에서** 함께 만든다.
 *    지금 이 이름이 하는 일은 하나다 — **스위치 이름과 기본값을 한 곳에 못박는 것.**
 *    운영 코드에 소비자가 없다는 사실을 fixture 가 확인한다.
 */
export const CONTENT_CORE_V2_ENV = 'SORAN_CONTENT_CORE_V2'
/** 🔴 이 스위치를 지울 마일스톤 — 넘기면 계약 위반이다 */
export const CONTENT_CORE_V2_FLAG_REMOVE_AT = 'M5'

/** 🔴 `'true'` 하나만 켠다. 모르는 값은 꺼진 것이다 */
export function isContentCoreV2Enabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env[CONTENT_CORE_V2_ENV] ?? '').trim() === 'true'
}
