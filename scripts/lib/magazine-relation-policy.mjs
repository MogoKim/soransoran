/**
 * 매거진 관계 수량 정책 — **단일 정의**. M-GRAPH readiness 와 M-AUTO source · authoring · ArticleSpec 이 모두 이것만 쓴다.
 *
 *   direct     2 ~ 3   (생산 최소 2 · 화면 표시 최대 3)
 *   discovery  정확히 1 (단일 객체)
 *
 * 🔴 각 모듈에 2 · 3 을 다시 적지 않는다. 숫자가 두 곳에 있으면 한쪽만 바뀌어
 *    GRAPH_READY 인 노드가 source 작성에서 막히는 일이 생긴다(2026-10-17 실측).
 * 🔴 4개 이상을 자동으로 잘라 3개로 만들지 않는다 — 고르는 것은 사람이다(authoring prepare).
 * 🔴 제품 resolver(`src/lib/magazine-graph.ts`)의 `MAX_DIRECT` 는 런타임 TS 라 여기서 import 하지 않는다.
 *    대신 `scripts/magazine-relation-policy-check.mjs` 가 두 값이 같은지 본다.
 */
export const RELATION_POLICY = Object.freeze({
  directMin: 2,
  directMax: 3,
  discovery: 1,
})

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
