/**
 * vNext Article 출처(release) overlay 규칙 — **admission 과 runtime 이 같이 쓰는 하나** (S3 P1 수리).
 *
 * 왜 따로 있나
 *   앞판은 admission(`scripts/lib/magazine-content-plan.mjs`)이 「canonical slug ∪ 출처 slug 중 공개 하나」 를 대상으로 셌고,
 *   runtime(`src/lib/magazine-graph.ts`)은 canonical 에 같은 intent · 같은 slug 가 있으면 출처를 버렸다.
 *   그래서 canonical 글이 미공개 · 충돌일 때 admission 이 승인한 대상을 runtime 이 그리지 않았다.
 *   두 층이 이 파일의 `provenanceOverlay` 하나로 정하면 그런 어긋남이 생길 자리가 없다.
 *
 * 규칙 — 출처 행은 아래 **어느 것에도 걸리지 않을 때만** overlay 에 들어간다. 걸리면 그 행은 더하지 않고, 그 글은 폴백 규칙대로 그려진다.
 *   · 같은 release.intentId 를 둘 이상의 행이 주장한다 — 고르지 않고 전부 버린다
 *   · 그 intent 가 지금 graph 에 없다(rollback) — 실패가 아니라 폴백
 *   · canonical 에 같은 (intent, slug) 가 이미 있다 — 다음 graph 승격이 흡수했다(결과 같음)
 *   · canonical 의 같은 slug 가 다른 intent 이거나, canonical 의 같은 intent 가 다른 slug 다 — canonical 이 이긴다
 *   · 정확한 컴파일 plan 결속이 없거나, 결속과 graphVersion · bundleHash · policyBoard · plan 존재 · planHash 중 하나라도 다르다
 * 🔴 버린 이유를 따로 돌려주지 않는다 — 운영에서 아무도 읽지 않는 진단은 계약이 아니다. 검사는 결과(overlay · 하단 목록)로 판정한다.
 *
 * 🔴 출처는 신원(slug → intent)만 준다. edge · 관계 유형 · 이유 · 표면 · 슬롯 · 우선순위 · 3+1 은 전부 graph 가 정한다.
 * 🔴 결속(binding)은 **정확한 컴파일 plan** 이다 — 64-hex 형식이 맞는 것만으로 출처를 믿지 않는다.
 *    S3 P1 에는 결속을 만드는 경로가 없다(저장소 · CI 에 Bundle 이 없고 runtime 은 hash 를 재계산할 수 없다).
 *    그래서 두 층의 운영 호출은 `NO_RELEASE_BINDING` 을 넘기고, 출처는 **켜질 수 없다**. S3-P2 가 같은 결속을 두 층에 함께 준다.
 * 🔴 순수 — import 0 · fs · env · 벽시계 · 네트워크 0. 입력 순서와 무관하게 같은 답이다.
 */

/** S3 P1 — 결속이 없다. 두 층의 운영 호출이 이 값을 넘긴다 */
export const NO_RELEASE_BINDING = null

/**
 * @typedef {{ intentId: string, graphVersion: string, bundleHash: string, planHash: string, policyBoard: { id: string, hash: string } }} ReleaseProvenance
 * @typedef {{ slug: string, release: ReleaseProvenance }} ProvenanceRow
 * @typedef {{ graphVersion: string, bundleHash: string, policyBoard: { id: string, hash: string }, planHashOf: Readonly<Record<string, string>> }} ReleaseBinding
 * @typedef {{ intent: string, slug: string }} CanonicalIdentity
 */

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * 출처 하나가 결속과 정확히 같은가 — 다섯 필드(intentId · graphVersion · bundleHash · planHash · policyBoard)가 컴파일 plan 과 같아야 한다.
 * @param {ReleaseProvenance} release
 * @param {ReleaseBinding | null} binding
 * @returns {boolean}
 */
function isReleaseBound(release, binding) {
  if (!binding) return false
  if (release.graphVersion !== binding.graphVersion) return false
  if (release.bundleHash !== binding.bundleHash) return false
  if (!release.policyBoard || release.policyBoard.id !== binding.policyBoard.id || release.policyBoard.hash !== binding.policyBoard.hash) return false
  // intentId 위조(그 intent 의 컴파일 plan 이 없음)도 여기서 걸린다 — 자기 속성의 문자열 planHash 만 같을 수 있다
  return typeof release.planHash === 'string' && own(binding.planHashOf, release.intentId) && binding.planHashOf[release.intentId] === release.planHash
}

/**
 * 유효 출처 overlay — canonical 신원에 더할 (intent, slug).
 * @param {{ canonical: readonly CanonicalIdentity[], graphIntentIds: readonly string[], rows: readonly ProvenanceRow[], binding: ReleaseBinding | null }} input
 *   canonical       graph(또는 같은 판 Bundle)의 mapping 신원 — 공개 여부와 무관하게 전부
 *   graphIntentIds  그 판의 intent id 전부
 *   rows            출처가 있는 글 — 호출자가 같은 공개 관문을 거친 것만 넘긴다(runtime: 공개 목록 · admission: 같은 시각에 공개인 행)
 * @returns {CanonicalIdentity[]} slug code-unit 순
 */
export function provenanceOverlay({ canonical, graphIntentIds, rows, binding }) {
  const intents = new Set(graphIntentIds)
  const intentsOfSlug = new Map()
  const slugsOfIntent = new Map()
  for (const m of canonical) {
    if (!intentsOfSlug.has(m.slug)) intentsOfSlug.set(m.slug, new Set())
    intentsOfSlug.get(m.slug).add(m.intent)
    if (!slugsOfIntent.has(m.intent)) slugsOfIntent.set(m.intent, new Set())
    slugsOfIntent.get(m.intent).add(m.slug)
  }
  const claims = new Map()
  for (const r of rows) claims.set(r.release.intentId, (claims.get(r.release.intentId) ?? 0) + 1)

  const overlay = []
  for (const r of [...rows].sort((a, b) => byCodeUnit(a.slug, b.slug))) {
    const intentId = r.release.intentId
    if (claims.get(intentId) > 1) continue // 출처 intent 중복 — 고르지 않는다
    if (!intents.has(intentId)) continue // rollback — 그 intent 가 없는 판
    if (intentsOfSlug.has(r.slug)) continue // canonical 같은 slug(흡수 또는 다른 intent) — canonical 이 이긴다
    if (slugsOfIntent.has(intentId)) continue // canonical 같은 intent(다른 slug · 미공개여도) — canonical 이 이긴다
    if (!isReleaseBound(r.release, binding)) continue // 정확한 컴파일 plan 결속 없음
    overlay.push({ intent: intentId, slug: r.slug })
  }
  return overlay
}
