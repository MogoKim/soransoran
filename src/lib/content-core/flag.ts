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

export const SUPPLY_PATHS = ['v1', 'v2'] as const
export type SupplyPath = (typeof SUPPLY_PATHS)[number]

/**
 * 🔴 **어느 경로가 운영 후보를 만드는가 — 정본은 여기 하나다.**
 *
 *    스위치를 장식으로 두지 않는다. v1 러너가 시작할 때 이것을 읽고,
 *    `v2` 면 **v1 은 돌지 않는다**. v2 는 아직 운영 진입점이 없으므로
 *    그때 회차는 후보 0건으로 끝난다 — 두 경로가 같은 회차에 섞이지 않는다.
 *
 * 🔴 기본값은 `v1` 이다. 모르는 값도 `v1` 이다.
 */
export function selectSupplyPath(env: Readonly<Record<string, string | undefined>>): SupplyPath {
  return isContentCoreV2Enabled(env) ? 'v2' : 'v1'
}

/** v1 러너가 멈출 때 찍는 말 — 🔴 조용히 0건으로 끝나지 않게 한다 */
export const V1_STOPPED_FOR_V2 =
  `🔴 ${CONTENT_CORE_V2_ENV}=true — 운영 후보 생성은 v2 경로가 맡는다. v1 은 돌지 않는다.`

