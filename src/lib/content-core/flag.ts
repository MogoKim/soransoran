/**
 * Content Core v2 스위치 — 🔴 **기본은 꺼짐. 운영 경로는 이것을 켜기 전까지 바뀌지 않는다.**
 *
 * 🔴 v1 과 v2 를 같은 함수 안 조건문으로 섞지 않는다. 이 스위치는
 *    **어느 경로를 부를지**만 정하고, 경로 안에서 다시 갈라지지 않는다.
 *
 * 🔴 **이 스위치는 임시다.** v2 가 운영으로 전환되면(M4) 이 파일과 v1 경로를
 *    함께 지운다 — 영원한 임시 코드로 남기지 않는다.
 */
export const CONTENT_CORE_V2_ENV = 'SORAN_CONTENT_CORE_V2'
/** 🔴 이 스위치를 지울 마일스톤 — 넘기면 계약 위반이다 */
export const CONTENT_CORE_V2_FLAG_REMOVE_AT = 'M5'

/** 🔴 `'true'` 하나만 켠다. 모르는 값은 꺼진 것이다 */
export function isContentCoreV2Enabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env[CONTENT_CORE_V2_ENV] ?? '').trim() === 'true'
}
