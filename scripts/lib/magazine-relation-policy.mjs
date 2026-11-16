/**
 * 매거진 관계 수량 정책 — **단일 정의**. M-GRAPH readiness 와 M-AUTO source · authoring · ArticleSpec 이 모두 이것만 쓴다.
 *
 * 세 층을 서로 다른 이름으로 둔다 (charter §18-B.2 · S1 C6 · 2026-11-10). 이름과 책임만 나눴고 값 · 판정은 앞판 그대로다.
 *   RELATION_DISPLAY_TARGET              표시 목표 — 화면 direct 최대 3 · discovery 최대 1 (제품 resolver MAX_DIRECT · MAX_DISCOVERY 와 같다)
 *   LEGACY_RELATION_POLICY               legacy 호환 기준 — direct 2~3 + discovery 정확히 1. 🔴 자기 값을 스스로 가진다 —
 *                                        표시 목표를 바꿔도 legacy 판정은 움직이지 않는다(경계 검사 R16 이 의존을 막는다).
 *                                        현재 graph readiness(GRAPH_READY) · source · authoring · ArticleSpec · brief 가 쓴다
 *   VNEXT_PUBLICATION_RELATION_MINIMUM   vNext 출판 최소 중 **관계가 소유하는 부분만** — 근거 있는 direct 1개 이상.
 *                                        영토 · 중복 · 도달성 · same-release · readerReason/anchorLabel 판정은 S2 compiler 소유다.
 *                                        🔴 legacy 소비처는 이 이름을 읽지 않는다(GRAPH_READY 를 쉽게 만들지 않는다 — 경계 검사 R16)
 * 호환 이름 — RELATION_POLICY · isValidDirectCount · isSingleDiscovery · RELATION_CONTRACT_LABEL 은 앞판 그대로다
 *   (같은 객체 · 같은 함수 · 같은 문자열). 새 legacy 명시 이름은 그 alias 다.
 *
 * 🔴 각 모듈에 2 · 3 을 다시 적지 않는다. 숫자가 두 곳에 있으면 한쪽만 바뀌어
 *    GRAPH_READY 인 노드가 source 작성에서 막히는 일이 생긴다(2026-10-17 실측).
 * 🔴 4개 이상을 자동으로 잘라 3개로 만들지 않는다 — 고르는 것은 사람이다(authoring prepare).
 * 🔴 제품 resolver(`src/lib/magazine-graph.ts`)의 `MAX_DIRECT` 는 런타임 TS 라 여기서 import 하지 않는다.
 *    대신 `scripts/magazine-relation-policy-check.mjs` 가 두 값이 같은지 본다.
 */

/** 표시 목표 — 화면에 보이는 direct 최대 · discovery 최대 */
export const RELATION_DISPLAY_TARGET = Object.freeze({
  directMax: 3,
  discovery: 1,
})

/**
 * legacy 호환 기준 — direct 2~3 · discovery 정확히 1. 지금은 표시 목표와 상한이 같은 값이지만 **값을 빌려 오지 않는다** —
 * 표시 목표(UI)가 바뀌어도 현재 source · authoring · ArticleSpec · readiness 판정이 조용히 따라 바뀌면 안 된다.
 */
export const LEGACY_RELATION_POLICY = Object.freeze({
  directMin: 2,
  directMax: 3,
  discovery: 1,
})

/** vNext 출판 최소 중 관계 수량 — direct 1개 이상. discovery 와 그 밖의 출판 조건은 넣지 않는다(S2 compiler 소유) */
export const VNEXT_PUBLICATION_RELATION_MINIMUM = Object.freeze({
  direct: 1,
})

/** 호환 이름 — legacy 호환 기준과 같은 객체 */
export const RELATION_POLICY = LEGACY_RELATION_POLICY

/** direct 개수가 계약 안인가 — 2 또는 3 */
export function isValidDirectCount(n) {
  return Number.isInteger(n) && n >= RELATION_POLICY.directMin && n <= RELATION_POLICY.directMax
}

/** discovery 는 정확히 1개 — 단일 객체만. 없음 · 배열(0개 · 2개)은 계약 밖 */
export function isSingleDiscovery(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 사람이 읽는 계약 표기 — 문구에 숫자를 따로 적지 않는다 */
export const RELATION_CONTRACT_LABEL = `direct ${RELATION_POLICY.directMin}~${RELATION_POLICY.directMax} + discovery ${RELATION_POLICY.discovery}`

// legacy 명시 이름 — 위 함수 · 문자열과 같은 것 (감싸지 않는다)
export { isValidDirectCount as isLegacyDirectCount, isSingleDiscovery as isLegacySingleDiscovery, RELATION_CONTRACT_LABEL as LEGACY_RELATION_CONTRACT_LABEL }
