/**
 * M-GRAPH 결정적 build · export · readiness — 제품 저장소가 소유하는 정본 core.
 *
 * 🔴 연구 폴더(`soransoran-mgraph-research`)는 **읽기 전용 데이터 입력**이다. 그 폴더의 코드를 실행하거나
 *    import 하지 않는다. 입력은 호출자가 명시한 `inputRoot` 의 다섯 파일뿐이다.
 *
 * 🔴 같은 입력 · 같은 `effectiveAt` · 같은 `generatedAt` → 산출물 전체가 **같은 바이트**다.
 *    - 벽시계를 읽지 않는다. graphVersion 날짜는 `effectiveAt` 의 KST 날짜다.
 *    - graphVersion · contentHash · semanticHash 에 `generatedAt` 이 들어가지 않는다.
 *    - 산출물에 절대 경로가 들어가지 않는다 — inputRoot · outDir 가 달라도 같은 바이트다.
 *    - `EXPORT_HASH` 는 제품 bundle 의 **무결성** 해시다(`JSON.stringify(GRAPH)`, generatedAt 포함).
 *      제품 `check:magazine-graph` 가 같은 식으로 재계산하므로 식을 바꾸지 않는다.
 *
 * 🔴 build 는 `current.ts` · `control.ts` 를 쓰지 않는다. 판 전환은 별도 promote 단계의 몫이다.
 *
 * 보존하는 graph 의미(연구 builder `contract/build-graph.mjs` · `export-graph.mjs` 2026-10-15 판과 같은 바이트):
 *   ① mapping   intent.existingSlugs × 자산 상태(LIVE > SCHEDULED_NOT_YET_PUBLIC > QUEUED > BLOCKED)
 *   ② intent    automation 행 순서 · 필드 순서 · 격리 기본 재시도 정책 · 게시판 기본값(T1·T4 → menopause)
 *   ③ edge      DESIGN(양 끝 정책 ALLOWED) ⊃ AUTOMATION_READY(양 끝 PASS·비격리) ⊃ RUNTIME_ACTIVE
 *               (구현 표면 · 출발 LIVE · 매거진 관계는 도착 LIVE). 슬롯은 관계 type 에서만 파생
 *   ④ reverse   backlinkPlan 이 PLANNED 이고 두 글이 LIVE 이며 같은 방향이 없을 때만 자동 생성
 *               (BODY_INLINE_OR_TOP · priority 1 · 번호는 입력 최대 edgeId 다음부터)
 *   ⑤ export    AUTOMATION_READY edge · LIVE mapping · PASS 비격리 intent 만, 같은 필드 순서
 *   ⑥ 자체 검사  미공개 누출 · 출발 비공개 · 게시판 · 슬롯 · BRIDGE · COMMUNITY 슬롯 · 이유 · 미구현 표면
 */
import { createHash } from 'node:crypto'

import { isPublic } from './magazine-gate.mjs'
import { evalLiteral, parseArticlesSource, sliceLiteral } from './magazine-load.mjs'

export const BUILD_SCHEMA = 'mgraph-build/1'
export const READINESS_SCHEMA = 'mgraph-readiness/1'

/** 연구 입력 다섯 파일 — 이름이 곧 계약이다. 하나라도 없으면 build 하지 않는다 */
export const INPUT_FILES = Object.freeze({
  canonical: 'g4-intents-canonical.jsonl',
  automation: 'g4-automation-2026-09-23.jsonl',
  graph: 'g5-graph-2026-09-23.jsonl',
  published: 'assets-published.jsonl',
  queued: 'assets-queue.jsonl',
})

/** 제품 사실 — build 의 RUNTIME_ACTIVE 와 readiness 가 읽는다 */
export const PRODUCT_FILES = Object.freeze({
  resolver: 'src/lib/magazine-graph.ts',
  control: 'src/content/magazine/graph/control.ts',
  articles: 'src/content/magazine/articles.ts',
})

/** G8 편입 장부 — readiness 가 읽기만 한다 */
export const ADMISSION_FILES = Object.freeze({
  slugManifest: 'contract/m3-slug-manifest.json',
  ledger: 'contract/m3-state.jsonl',
})

/** 관계 → 슬롯. 연구 `graph-contract.ts` 의 RELATION_TO_SLOT 과 같은 값이며 제품에서는 여기가 정본이다 */
export const RELATION_TO_SLOT = Object.freeze({
  NEXT_QUESTION: 'DIRECT_NEXT',
  SIBLING: 'SAME_EXPERIENCE',
  ACTION: 'ACTION_OR_CONTEXT',
  PREREQUISITE: 'ACTION_OR_CONTEXT',
  SERIES: 'ACTION_OR_CONTEXT',
  BRIDGE: 'BRIDGE_DISCOVERY',
  COMMUNITY: null,
})
export const DIRECT_SLOTS = Object.freeze(['DIRECT_NEXT', 'SAME_EXPERIENCE', 'ACTION_OR_CONTEXT'])
export const DISCOVERY_SLOT = 'BRIDGE_DISCOVERY'
export const DISCOVERY_TYPE = 'BRIDGE'
export const BOARDS = Object.freeze(['/community/menopause', '/community/free'])

/** 🔴 생산 최소선과 화면 표시 목표는 다른 숫자다 — 섞지 않는다 */
export const READINESS_POLICY = Object.freeze({
  productionMinimum: Object.freeze({ direct: 2, discovery: 1 }),
  displayTarget: Object.freeze({ directMax: 3, discovery: 1 }),
})

export class GraphBuildError extends Error {
  constructor(code, why) { super(`${code}: ${why}`); this.code = code; this.why = why }
}
const fail = (code, why) => { throw new GraphBuildError(code, why) }

const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0

/** 정렬된 키로 직렬화 — 산출물 manifest · readiness 에서만 쓴다 (graph 본문은 원래 순서를 지킨다) */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
export const prettyStable = (value) => `${JSON.stringify(JSON.parse(stableJson(value)), null, 2)}\n`

// ── 시각 ──

const EFFECTIVE_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2}|Z)$/
const GENERATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** effectiveAt — 오프셋을 명시한 시각만. graphVersion 날짜는 이 시각의 **KST 날짜**다 */
export function parseEffectiveAt(text) {
  if (typeof text !== 'string' || !EFFECTIVE_AT_RE.test(text)) {
    fail('EFFECTIVE_AT_INVALID', `effectiveAt 은 오프셋이 있는 ISO 시각이어야 한다 (예 2026-10-15T13:00:00+09:00): ${text}`)
  }
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) fail('EFFECTIVE_AT_INVALID', `해석할 수 없는 시각이다: ${text}`)
  const kstDate = new Date(ms + 9 * 3600e3).toISOString().slice(0, 10)
  return { text, ms, kstDate, versionDate: kstDate.replace(/-/g, '') }
}

/** generatedAt — 기록용 시각. 의미 해시에 들어가지 않는다. 정규형 UTC 밀리초만 받는다 */
export function parseGeneratedAt(text) {
  if (typeof text !== 'string' || !GENERATED_AT_RE.test(text) || new Date(text).toISOString() !== text) {
    fail('GENERATED_AT_INVALID', `generatedAt 은 YYYY-MM-DDTHH:mm:ss.sssZ 정규형이어야 한다: ${text}`)
  }
  return text
}

// ── 입력 판독 ──

function parseJsonl(text, label) {
  return String(text).trim().split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line) } catch (e) { return fail('INPUT_UNREADABLE', `${label} ${i + 1}행 JSON 오류: ${e.message}`) }
  })
}

/**
 * 연구 입력 텍스트(파일명 → 내용)를 구조로 바꾼다.
 * 🔴 파일이 없으면 기본 위치로 대신 읽지 않는다 — 대체 경로는 재현성을 깨는 숨은 입력이다.
 */
export function parseInputTexts(texts) {
  const out = {}
  const hashes = {}
  for (const [key, name] of Object.entries(INPUT_FILES)) {
    const text = texts[name]
    if (typeof text !== 'string') fail('INPUT_MISSING', `입력 파일이 없다: ${name}`)
    out[key] = parseJsonl(text, name)
    hashes[name] = sha256(text)
  }
  return { ...out, hashes }
}

/** 제품 resolver 의 문자열 배열 상수 */
export function readStringArray(text, name) {
  const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`).exec(String(text ?? ''))
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/** control.ts 의 CONTROL — 구조 파서. 판독 실패는 null (호출자가 blocker 로 막는다) */
export function parseControlText(text) {
  const src = String(text ?? '')
  const anchor = src.indexOf('export const CONTROL')
  if (anchor === -1) return null
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  if (!literal) return null
  let raw
  try { raw = evalLiteral(literal, 'control.ts') } catch { return null }
  const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!plain(raw) || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.enabledClusters)) return null
  if (!plain(raw.surfaces) || !plain(raw.killSwitch) || typeof raw.killSwitch.tripped !== 'boolean') return null
  return {
    graphVersion: String(raw.graphVersion ?? ''),
    enabled: raw.enabled,
    enabledClusters: [...raw.enabledClusters].map(String),
    surfaces: Object.fromEntries(Object.entries(raw.surfaces).map(([k, v]) => [k, v === true])),
    killSwitchTripped: raw.killSwitch.tripped,
  }
}

/** 제품 사실 텍스트 → 구조. 표면 계약을 못 읽으면 build 를 멈춘다(모를 때 넓게 잡지 않는다) */
export function parseProductTexts(texts) {
  const implemented = readStringArray(texts.resolver, 'IMPLEMENTED_SURFACES')
  const footer = readStringArray(texts.resolver, 'FOOTER_SURFACES')
  const relationTypes = readStringArray(texts.resolver, 'MAGAZINE_RELATION_TYPES')
  if (!implemented?.length || !footer?.length || !relationTypes?.length) {
    fail('PRODUCT_SURFACE_UNREADABLE', 'magazine-graph.ts 의 IMPLEMENTED_SURFACES · FOOTER_SURFACES · MAGAZINE_RELATION_TYPES 를 읽지 못했다')
  }
  let articles
  try { articles = parseArticlesSource(texts.articles) } catch (e) { fail('PRODUCT_ARTICLES_UNREADABLE', e.message) }
  return {
    implemented, footer, relationTypes, articles,
    control: parseControlText(texts.control),
    hashes: Object.fromEntries(Object.entries(PRODUCT_FILES).map(([k, rel]) => [rel, sha256(String(texts[k] ?? ''))])),
  }
}

// ── build ──

/**
 * 연구 입력 + 제품 구현 표면 → intents · edges · mappings (연구 builder 와 같은 바이트).
 * @param {{ inputs: ReturnType<typeof parseInputTexts>, implementedSurfaces: string[] }} p
 */
export function buildGraphLayers({ inputs, implementedSurfaces }) {
  const { canonical: intentsRaw, automation: autoRaw, graph: edgesRaw, published, queued } = inputs
  const A = Object.fromEntries(autoRaw.map((r) => [r.intentId, r]))
  const I = Object.fromEntries(intentsRaw.map((r) => [r.intentId, r]))
  const LIVE = new Set(published.filter((a) => a.assetState === 'LIVE').map((a) => a.slug))
  const SCHED = new Set(published.filter((a) => a.assetState === 'SCHEDULED_NOT_YET_PUBLIC').map((a) => a.slug))
  const QUE = new Set(queued.map((a) => a.slug))
  const boards = new Set(BOARDS)
  const implemented = new Set(implementedSurfaces)

  // ① mappings
  const mappings = []
  for (const i of intentsRaw) for (const s of (i.existingSlugs || [])) {
    const st = LIVE.has(s.slug) ? 'LIVE' : SCHED.has(s.slug) ? 'SCHEDULED_NOT_YET_PUBLIC' : QUE.has(s.slug) ? 'QUEUED' : 'BLOCKED'
    mappings.push({ schemaVersion: 'mapping/2', intentId: i.intentId, slug: s.slug, assetState: st,
      publishedAt: s.publishedAt ?? null, publishAt: (published.find((p) => p.slug === s.slug) || {}).publishAt ?? null,
      cluster: s.cluster ?? null, coverage: s.coverage ?? 'ADJACENT' })
  }
  const liveSlugsOf = (id) => mappings.filter((m) => m.intentId === id && m.assetState === 'LIVE').map((m) => m.slug)

  // ② intents
  const intents = autoRaw.map((r) => ({ schemaVersion: 'intent/2',
    intentId: r.intentId, primaryQuery: r.primaryQuery, territoryId: r.territoryId,
    magazineCluster: r.magazineCluster ?? null, audienceSituation: r.audienceSituation,
    answerScope: I[r.intentId]?.answerScope ?? null, exclusions: I[r.intentId]?.exclusions ?? [],
    policyScope: r.policyScope, policyScopeWhy: r.policyScopeWhy,
    verificationProfile: r.verificationProfile, profileSpec: r.profileSpec,
    automationDecision: r.automationDecision, topicVerdict: r.topicVerdict, verdictWhy: r.verdictWhy,
    retryPolicy: r.retryPolicy ?? (r.runtimeState === 'QUARANTINED' ? {
      trigger: '자동 검증 실패로 격리됐다. 다음 회차에 재수집·재생성한다',
      autoRecollect: true, requeueAfterDays: 1, maxAutoRetries: 2,
      note: '🔴 builder 가 자동으로 붙였다. 사람이 풀지 않는다' } : null),
    quarantineReason: r.quarantineReason ?? (r.runtimeState === 'QUARANTINED'
      ? '🔴 사유가 기록되지 않은 격리다. 자동 검증 실패로 간주한다' : undefined),
    runtimeState: r.runtimeState ?? 'UNPUBLISHED',
    evidence: r.evidence,
    communityDestination: r.communityDestination
      ?? I[r.intentId]?.communityDestination
      ?? ((r.territoryId === 'T1' || r.territoryId === 'T4') ? '/community/menopause' : '/community/free'),
    existingAssetRelation: r.existingAssetRelation, duplicateReason: r.duplicateReason ?? null }))

  const intentUsable = (id) => {
    const x = A[id]
    if (!x) return { ok: false, why: `intent 없음: ${id}` }
    if (x.policyScope !== 'ALLOWED') return { ok: false, why: `${id} policyScope=${x.policyScope}` }
    if (x.automationDecision !== 'PASS') return { ok: false, why: `${id} automationDecision=${x.automationDecision}` }
    if (x.runtimeState === 'QUARANTINED') return { ok: false, why: `${id} 격리됨` }
    return { ok: true, why: null }
  }

  // ③ edges
  const edges = []
  let n = 0
  const mkEdge = (e) => {
    const isCommunity = e.relationType === 'COMMUNITY'
    const f = intentUsable(e.fromIntentId)
    const t = isCommunity
      ? (boards.has(e.toIntentId) ? { ok: true, why: null } : { ok: false, why: `게시판 경로가 계약과 다르다: ${e.toIntentId}` })
      : intentUsable(e.toIntentId)
    const fPolicy = A[e.fromIntentId]?.policyScope
    const tPolicy = isCommunity ? 'ALLOWED' : A[e.toIntentId]?.policyScope
    const designOk = fPolicy === 'ALLOWED' && tPolicy === 'ALLOWED'
      && (isCommunity ? boards.has(e.toIntentId) : !!A[e.toIntentId])
    const designWhy = designOk ? null : `🔴 정책상 제외 — from=${fPolicy} to=${tPolicy}`
    const arOk = designOk && f.ok && t.ok
    const arWhy = arOk ? null : (f.why || t.why)
    const fLive = liveSlugsOf(e.fromIntentId)
    const tLive = isCommunity ? [] : liveSlugsOf(e.toIntentId)
    const surfaceReady = implemented.has(e.placement)
    let runtimeState, runtimeWhy
    if (!arOk) { runtimeState = 'UNPUBLISHED'; runtimeWhy = `🔴 자동화 준비 밖 — ${arWhy}` }
    else if (!surfaceReady) { runtimeState = 'FALLBACK'
      runtimeWhy = `🔴 ${e.placement} 표면이 제품에 없다. 기존 최신 3편 방식으로 대체된다` }
    else if (!fLive.length) { runtimeState = 'UNPUBLISHED'; runtimeWhy = '🔴 출발 글이 아직 공개되지 않았다' }
    else if (!isCommunity && !tLive.length) { runtimeState = 'UNPUBLISHED'; runtimeWhy = '🔴 도착 글이 아직 공개되지 않았다' }
    else { runtimeState = 'ACTIVE'; runtimeWhy = '✅ 구현된 표면 · 출발 글 공개됨' }
    const recommendationSlot = RELATION_TO_SLOT[e.relationType] ?? null
    return { schemaVersion: 'edge/3', edgeId: e.edgeId, recommendationSlot,
      fromIntentId: e.fromIntentId, toIntentId: e.toIntentId, relationType: e.relationType,
      readerReason: e.readerReason, anchorLabel: e.anchorLabel,
      placement: e.placement, priority: e.priority,
      reciprocalPolicy: e.reciprocalPolicy, reverseEdgeId: e.reverseEdgeId ?? null,
      reciprocalGroupId: e.reciprocalGroupId, backlinkStatus: e.backlinkStatus,
      backlinkPlan: e.backlinkPlan, reciprocalWhy: e.reciprocalWhy,
      policyScope: designOk ? 'ALLOWED' : 'BLOCKED', policyScopeWhy: designWhy ?? '양 끝 intent 가 허용 범위다',
      automationDecision: arOk ? 'PASS' : (f.why || t.why || '').includes('REJECT') ? 'REJECT' : 'HOLD',
      automationDecisionWhy: arOk ? '양 끝 intent 가 PASS 이고 격리되지 않았다' : `🔴 ${arWhy}`,
      runtimeState, runtimeWhy, exposeNow: runtimeState === 'ACTIVE',
      fromCluster: I[e.fromIntentId]?.magazineCluster ?? e.fromCluster ?? null,
      toCluster: isCommunity ? null : (I[e.toIntentId]?.magazineCluster ?? e.toCluster ?? null),
      crossCluster: isCommunity ? false : ((I[e.fromIntentId]?.magazineCluster ?? null) !== (I[e.toIntentId]?.magazineCluster ?? null)),
      fromLive: fLive, toLive: tLive, riskNote: e.riskNote ?? null,
      layers: { DESIGN: designOk, AUTOMATION_READY: arOk, RUNTIME_ACTIVE: runtimeState === 'ACTIVE' },
      layerWhy: { design: designWhy, automationReady: arWhy, runtime: runtimeWhy },
      generatedBy: e.generatedBy ?? null }
  }
  for (const e of edgesRaw) { edges.push(mkEdge(e)); n = Math.max(n, +String(e.edgeId).slice(2)) }

  // ④ 계획된 역방향 자동 활성화
  const have = new Set(edges.filter((e) => e.relationType !== 'COMMUNITY').map((e) => `${e.fromIntentId}|${e.toIntentId}`))
  let autoBacklinks = 0
  for (const e of [...edges]) {
    if (e.backlinkStatus !== 'PLANNED' || !e.backlinkPlan) continue
    const p = e.backlinkPlan
    if (e.fromLive.length === 0 || e.toLive.length === 0) continue
    if (have.has(`${p.fromIntentId}|${p.toIntentId}`)) continue
    const b = mkEdge({ edgeId: `E-${String(++n).padStart(4, '0')}`,
      fromIntentId: p.fromIntentId, toIntentId: p.toIntentId, relationType: p.relationType,
      readerReason: p.readerReason, anchorLabel: p.anchorLabel,
      placement: 'BODY_INLINE_OR_TOP', priority: 1,
      reciprocalPolicy: 'ONE_WAY', reverseEdgeId: e.edgeId,
      reciprocalWhy: 'builder 가 자동 생성한 역방향', riskNote: e.riskNote,
      generatedBy: 'build-graph.mjs backlink activation' })
    edges.push(b); have.add(`${p.fromIntentId}|${p.toIntentId}`); autoBacklinks++
    e.backlinkStatus = 'PAIRED'; e.reverseEdgeId = b.edgeId
  }

  return { intents, edges, mappings, autoBacklinks, registeredInProduct: published.length }
}

function countLayer(edges, pred) {
  const es = edges.filter(pred), sem = es.filter((e) => e.relationType !== 'COMMUNITY')
  const nodes = new Set(); for (const e of sem) { nodes.add(e.fromIntentId); nodes.add(e.toIntentId) }
  for (const e of es) if (e.relationType === 'COMMUNITY') nodes.add(e.fromIntentId)
  const out = new Set(), inn = new Set()
  for (const e of sem) { out.add(e.fromIntentId); inn.add(e.toIntentId) }
  for (const e of es) if (e.relationType === 'COMMUNITY') out.add(e.fromIntentId)
  const adj = new Map([...nodes].map((x) => [x, new Set()]))
  for (const e of sem) { adj.get(e.fromIntentId).add(e.toIntentId); adj.get(e.toIntentId).add(e.fromIntentId) }
  const seen = new Set(), comps = []
  for (const x of nodes) {
    if (seen.has(x)) continue
    const st = [x]; seen.add(x); let k = 0
    while (st.length) { const y = st.pop(); k++; for (const z of adj.get(y)) if (!seen.has(z)) { seen.add(z); st.push(z) } }
    comps.push(k)
  }
  return { nodes: nodes.size, edges: es.length, magazineToMagazine: sem.length, communityCta: es.length - sem.length,
    inbound0: [...nodes].filter((x) => !inn.has(x)).length, outbound0: [...nodes].filter((x) => !out.has(x)).length,
    components: comps.sort((a, b) => b - a) }
}

/** 제품 bundle 의 slim GRAPH — 연구 exporter 와 같은 필드·순서 */
export function slimGraph({ graphVersion, contentHash, generatedAt, intents, edges, mappings }) {
  return {
    graphVersion,
    schemaVersion: { intent: 'intent/2', edge: 'edge/3', mapping: 'mapping/2', manifest: 'manifest/1' },
    contentHash,
    generatedAt,
    edges: edges.filter((e) => e.layers.AUTOMATION_READY).map((e) => ({
      id: e.edgeId, from: e.fromIntentId, to: e.toIntentId, type: e.relationType,
      slot: e.recommendationSlot ?? null,
      anchor: e.anchorLabel,
      reason: e.readerReason,
      placement: e.placement, priority: e.priority,
      fromCluster: e.fromCluster, toCluster: e.toCluster,
      active: e.layers.RUNTIME_ACTIVE })),
    mappings: mappings.filter((x) => x.assetState === 'LIVE').map((x) => ({ intent: x.intentId, slug: x.slug, cluster: x.cluster })),
    intents: intents.filter((x) => x.automationDecision === 'PASS' && x.runtimeState !== 'QUARANTINED')
      .map((x) => ({ id: x.intentId, cluster: x.magazineCluster, board: x.communityDestination })),
  }
}

/** export 자체 검사 — 하나라도 걸리면 아무것도 쓰지 않는다 */
export function exportProblems(slim, implementedSurfaces) {
  const bad = []
  const implemented = new Set(implementedSurfaces)
  const footer = new Set(['FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE'])
  const live = new Set(slim.mappings.map((x) => x.intent))
  const boards = new Set(BOARDS)
  if (!slim.edges.length) bad.push('EXPORT_EDGES_EMPTY')
  const ids = (xs) => xs.map((e) => e.id).join(',')
  const leak = slim.edges.filter((e) => e.active && e.type !== 'COMMUNITY' && !live.has(e.to))
  if (leak.length) bad.push(`EXPORT_UNPUBLISHED_TARGET_ACTIVE ${ids(leak)}`)
  const badBoard = slim.edges.filter((e) => e.type === 'COMMUNITY' && !boards.has(e.to))
  if (badBoard.length) bad.push(`EXPORT_BOARD_INVALID ${ids(badBoard)}`)
  const noFrom = slim.edges.filter((e) => e.active && !live.has(e.from))
  if (noFrom.length) bad.push(`EXPORT_UNPUBLISHED_SOURCE_ACTIVE ${ids(noFrom)}`)
  const slotBad = slim.edges.filter((e) => e.active && footer.has(e.placement) && !e.slot)
  if (slotBad.length) bad.push(`EXPORT_FOOTER_SLOT_MISSING ${ids(slotBad)}`)
  const discBad = slim.edges.filter((e) => e.slot === DISCOVERY_SLOT && e.type !== DISCOVERY_TYPE)
  if (discBad.length) bad.push(`EXPORT_DISCOVERY_NOT_BRIDGE ${ids(discBad)}`)
  const commBad = slim.edges.filter((e) => e.type === 'COMMUNITY' && e.slot)
  if (commBad.length) bad.push(`EXPORT_COMMUNITY_SLOT ${ids(commBad)}`)
  const reasonBad = slim.edges.filter((e) => e.active && e.type !== 'COMMUNITY' && !e.reason)
  if (reasonBad.length) bad.push(`EXPORT_ACTIVE_REASON_MISSING ${ids(reasonBad)}`)
  const unimpl = slim.edges.filter((e) => e.active && !implemented.has(e.placement))
  if (unimpl.length) bad.push(`EXPORT_UNIMPLEMENTED_SURFACE_ACTIVE ${ids(unimpl)}`)
  return bad
}

/** 제품 bundle 파일 텍스트. 머리말 시각도 generatedAt 이다(벽시계 없음) */
export function bundleText(slim) {
  const exportHash = sha16(JSON.stringify(slim))
  const text = `// 🔴 자동 생성 — 손으로 고치지 않는다. scripts/magazine-graph-build.mjs 가 만든다.
// graphVersion: ${slim.graphVersion}
// 생성: ${slim.generatedAt}
// 🔴 immutable — 이 파일을 덮어쓰지 않는다. 새 버전은 새 파일이다.
import type { MagazineGraph } from './types'

export const GRAPH: MagazineGraph = ${JSON.stringify(slim, null, 2)} as const

/** 🔴 런타임이 대조한다. 다르면 폴백한다 */
export const EXPORT_HASH = '${exportHash}'
`
  return { exportHash, text }
}

/** 의미 해시 — slim 에서 generatedAt 만 뺀 값. 실행 시각과 무관하다 */
export function semanticHashOf(slim) {
  const { generatedAt: _omit, ...rest } = slim
  return sha16(JSON.stringify(rest))
}

/**
 * 전체 build — 순수 함수. 파일 시스템 · 벽시계를 쓰지 않는다.
 * @returns {{ graphVersion, files: Record<string,string>, manifest, slim, layers, readiness }}
 */
export function buildAll({ inputTexts, productTexts, admissionTexts = null, effectiveAt, generatedAt }) {
  const eff = parseEffectiveAt(effectiveAt)
  const gen = parseGeneratedAt(generatedAt)
  const inputs = parseInputTexts(inputTexts)
  const product = parseProductTexts(productTexts)
  const layers = buildGraphLayers({ inputs, implementedSurfaces: product.implemented })

  const sIntents = layers.intents.map((x) => JSON.stringify(x)).join('\n') + '\n'
  const sEdges = layers.edges.map((x) => JSON.stringify(x)).join('\n') + '\n'
  const sMap = layers.mappings.map((x) => JSON.stringify(x)).join('\n') + '\n'
  const hI = sha16(sIntents), hE = sha16(sEdges), hM = sha16(sMap)
  const combined = sha16(hI + hE + hM)
  const graphVersion = `g-${eff.versionDate}-${combined.slice(0, 6)}`
  const contentHash = { intents: hI, edges: hE, mappings: hM, combined }

  const slim = slimGraph({ graphVersion, contentHash, generatedAt: gen, ...layers })
  const problems = exportProblems(slim, product.implemented)
  if (problems.length) fail('EXPORT_SELF_CHECK_FAILED', problems.join(' | '))
  const bundle = bundleText(slim)
  const semanticHash = semanticHashOf(slim)

  const readiness = buildReadiness({ layers, product, admission: parseAdmissionTexts(admissionTexts), effective: eff, graphVersion, semanticHash })

  const manifest = {
    schemaVersion: BUILD_SCHEMA,
    graphVersion, effectiveAt: eff.text, generatedAt: gen,
    contentHash, semanticHash, exportHash: bundle.exportHash,
    semanticExcludes: ['generatedAt'],
    counts: { intents: layers.intents.length, edges: layers.edges.length, mappings: layers.mappings.length,
      design: countLayer(layers.edges, (e) => e.layers.DESIGN),
      automationReady: countLayer(layers.edges, (e) => e.layers.AUTOMATION_READY),
      runtimeActive: countLayer(layers.edges, (e) => e.layers.RUNTIME_ACTIVE) },
    autoGeneratedBacklinks: layers.autoBacklinks,
    registeredInProduct: layers.registeredInProduct,
    implementedSurfaces: [...product.implemented],
    inputHashes: inputs.hashes,
    productHashes: product.hashes,
    admissionHashes: readiness.admissionHashes,
    promote: 'NOT_PERFORMED — build 는 current.ts · control.ts 를 쓰지 않는다',
  }
  const files = {
    'intents.jsonl': sIntents,
    'edges.jsonl': sEdges,
    'mappings.jsonl': sMap,
    [`bundle/${graphVersion}.ts`]: bundle.text,
    'readiness.json': prettyStable(readiness.report),
    'manifest.json': prettyStable(manifest),
  }
  return { graphVersion, files, manifest, slim, layers, readiness: readiness.report }
}

// ── readiness ──

/** G8 장부 — 없으면 null(=UNREAD). 있으면 ADMITTED intent → slug */
export function parseAdmissionTexts(texts) {
  if (!texts) return null
  const out = { admitted: new Map(), slugs: new Map(), hashes: {} }
  for (const [k, rel] of Object.entries(ADMISSION_FILES)) out.hashes[rel] = texts[k] == null ? 'ABSENT' : sha256(texts[k])
  if (texts.slugManifest != null) {
    let m
    try { m = JSON.parse(texts.slugManifest) } catch (e) { fail('ADMISSION_UNREADABLE', `m3-slug-manifest.json: ${e.message}`) }
    for (const [id, slug] of Object.entries(m?.slugs ?? {})) out.slugs.set(id, slug)
  }
  if (texts.ledger != null) {
    for (const row of parseJsonl(texts.ledger, 'm3-state.jsonl')) {
      if (row.event === 'ADMITTED' && nonEmpty(row.intentId)) out.admitted.set(row.intentId, row.slug ?? null)
    }
  }
  return out
}

/**
 * 미등록 intent 전부의 readiness — **파생 보고서**다. 사람이 고치는 정본이 아니다.
 *
 *  등록 = mapping 된 slug 중 하나라도 제품 articles.ts 에 있다(상태 무관).
 *  미등록 = 나머지 전부. 누락 없이 한 행씩 낸다.
 *
 *  관계 근거로 세는 것은 graph edge 뿐이다(제목 유사·hub·community 는 세지 않는다). 한 edge 가 세지려면
 *    AUTOMATION_READY · 슬롯 있음 · 이유·앵커 있음 · resolver 관계 type · 표면이 구현∩footer∩control 켜짐 ·
 *    도착 intent 의 공개 slug 가 정확히 하나 · 자기 자신·중복 아님 · discovery 는 BRIDGE.
 *  출발 cluster 가 꺼져 있거나 control 이 꺼져 있으면 count 는 0 이고 blocker 가 붙는다.
 */
export function buildReadiness({ layers, product, admission, effective, graphVersion, semanticHash }) {
  const nowMs = effective.ms
  const articles = new Map(product.articles.map((a) => [a.slug, a]))
  const control = product.control
  const footer = new Set(product.footer)
  const enabledSurfaces = new Set(product.implemented.filter((s) => footer.has(s) && control?.surfaces?.[s] === true))
  const relationTypes = new Set(product.relationTypes)
  const controlOn = Boolean(control && control.enabled && !control.killSwitchTripped)
  const clusterOn = (c) => controlOn && c != null && control.enabledClusters.includes(c)

  const mappingsOf = new Map()
  for (const m of layers.mappings) (mappingsOf.get(m.intentId) ?? mappingsOf.set(m.intentId, []).get(m.intentId)).push(m)
  const publicSlugsOf = (id) => [...new Set((mappingsOf.get(id) ?? []).map((m) => m.slug))]
    .filter((s) => articles.has(s) && isPublic(articles.get(s), nowMs))
  const registered = (id) => (mappingsOf.get(id) ?? []).some((m) => articles.has(m.slug))
  const edgeById = new Map(layers.edges.map((e) => [e.edgeId, e]))

  /** 출발 intent 기준으로 한 edge 를 판정한다. 근거로 세지 못하면 why 를 남긴다 */
  const judgeOutgoing = (e) => {
    const why = []
    if (!e.layers.AUTOMATION_READY) why.push(`AUTOMATION_READY_FALSE(${e.layerWhy.automationReady})`)
    if (!e.recommendationSlot) why.push('NO_SLOT')
    if (!nonEmpty(e.readerReason) || !nonEmpty(e.anchorLabel)) why.push('WEAK_REASON_OR_ANCHOR')
    if (!relationTypes.has(e.relationType)) why.push(`RELATION_TYPE_NOT_RENDERED(${e.relationType})`)
    if (e.recommendationSlot === DISCOVERY_SLOT && e.relationType !== DISCOVERY_TYPE) why.push('DISCOVERY_NOT_BRIDGE')
    if (!enabledSurfaces.has(e.placement)) why.push(`SURFACE_DISABLED(${e.placement})`)
    const slugs = publicSlugsOf(e.toIntentId)
    if (slugs.length === 0) why.push('TARGET_NOT_PUBLIC')
    if (slugs.length > 1) why.push(`TARGET_MAPPING_AMBIGUOUS(${slugs.join(',')})`)
    return { why, slug: slugs.length === 1 ? slugs[0] : null }
  }

  const reverseMismatch = (e) => {
    if (e.reverseEdgeId == null) return e.backlinkStatus === 'PAIRED' ? `${e.edgeId}: PAIRED 인데 reverseEdgeId 가 없다` : null
    const r = edgeById.get(e.reverseEdgeId)
    if (!r) return `${e.edgeId}: reverseEdgeId ${e.reverseEdgeId} 가 graph 에 없다`
    if (r.fromIntentId !== e.toIntentId || r.toIntentId !== e.fromIntentId) return `${e.edgeId}: reverse ${r.edgeId} 의 방향이 반대가 아니다`
    return null
  }

  const rows = []
  for (const intent of layers.intents) {
    const id = intent.intentId
    if (registered(id)) continue
    const cluster = intent.magazineCluster ?? null
    const blockers = []
    if (intent.policyScope !== 'ALLOWED') blockers.push('INTENT_POLICY_BLOCKED')
    if (intent.automationDecision !== 'PASS') blockers.push(`INTENT_${intent.automationDecision ?? 'UNDECIDED'}`)
    if (intent.runtimeState === 'QUARANTINED') blockers.push('INTENT_QUARANTINED')
    if (!control) blockers.push('CONTROL_UNREADABLE')
    else if (!control.enabled) blockers.push('CONTROL_DISABLED')
    else if (control.killSwitchTripped) blockers.push('KILL_SWITCH_TRIPPED')
    if (cluster == null) blockers.push('CLUSTER_UNASSIGNED')
    else if (control && !control.enabledClusters.includes(cluster)) blockers.push('CLUSTER_DISABLED')

    const outgoing = layers.edges.filter((e) => e.fromIntentId === id && e.relationType !== 'COMMUNITY')
    const direct = [], discovery = [], rejected = []
    const used = new Set()
    for (const e of [...outgoing].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.edgeId.localeCompare(b.edgeId))) {
      const j = judgeOutgoing(e)
      if (j.slug && used.has(j.slug)) j.why.push(`DUPLICATE_TARGET(${j.slug})`)
      if (j.why.length) { rejected.push({ edgeId: e.edgeId, toIntentId: e.toIntentId, why: j.why }); continue }
      used.add(j.slug)
      const t = { edgeId: e.edgeId, toIntentId: e.toIntentId, slug: j.slug, slot: e.recommendationSlot,
        type: e.relationType, placement: e.placement, priority: e.priority, reason: e.readerReason }
      if (e.recommendationSlot === DISCOVERY_SLOT) discovery.push(t)
      else if (DIRECT_SLOTS.includes(e.recommendationSlot)) direct.push(t)
    }
    // 🔴 cluster·control 이 꺼져 있으면 근거가 있어도 공개 화면에 뜨지 않는다 — count 0
    const visible = clusterOn(cluster)
    const directCount = visible ? direct.length : 0
    const discoveryCount = visible ? Math.min(discovery.length, 1) : 0

    // reverse — 이 글이 생기면 그것을 가리킬 공개 글의 관계.
    // 🔴 resolver 는 **공개 글의 cluster**(articles.ts)로 켜짐을 본다. intent cluster 가 아니다
    const inbound = layers.edges.filter((e) => e.toIntentId === id && e.relationType !== 'COMMUNITY')
    const reverseSources = []
    for (const e of inbound) {
      if (!e.layers.AUTOMATION_READY || !e.recommendationSlot || !enabledSurfaces.has(e.placement)
        || !relationTypes.has(e.relationType) || !nonEmpty(e.readerReason) || !nonEmpty(e.anchorLabel)) continue
      if (e.recommendationSlot === DISCOVERY_SLOT && e.relationType !== DISCOVERY_TYPE) continue
      for (const slug of publicSlugsOf(e.fromIntentId)) {
        if (!clusterOn(articles.get(slug).cluster ?? null)) continue
        reverseSources.push({ edgeId: e.edgeId, fromIntentId: e.fromIntentId, slug, slot: e.recommendationSlot, placement: e.placement })
      }
    }
    const mismatches = [...outgoing, ...inbound].map(reverseMismatch).filter(Boolean)
    if (mismatches.length) blockers.push('REVERSE_LINK_MISMATCH')

    // G8 — GRAPH_READY 다음 관문. GRAPH_READY 판정에 섞지 않고 별도 blocker 로 낸다
    let admissionState, admissionSlug = null
    const admissionBlockers = []
    if (!admission) { admissionState = 'UNREAD'; admissionBlockers.push('G8_ADMISSION_UNREAD') }
    else if (admission.admitted.has(id)) { admissionState = 'ADMITTED'; admissionSlug = admission.admitted.get(id) ?? admission.slugs.get(id) ?? null }
    else { admissionState = 'NOT_ADMITTED'; admissionSlug = admission.slugs.get(id) ?? null; admissionBlockers.push('G8_NOT_ADMITTED') }

    const min = READINESS_POLICY.productionMinimum
    const shortfall = []
    if (directCount < min.direct) shortfall.push(`DIRECT_SHORT(${directCount}/${min.direct})`)
    if (discoveryCount < min.discovery) shortfall.push(`DISCOVERY_SHORT(${discoveryCount}/${min.discovery})`)
    if (reverseSources.length === 0) shortfall.push('REVERSE_LINK_ABSENT')
    const status = blockers.length ? 'BLOCKED' : shortfall.length ? 'GRAPH_INCOMPLETE' : 'GRAPH_READY'

    rows.push({
      intentId: id, slug: admissionSlug, primaryQuery: intent.primaryQuery, cluster,
      automationDecision: intent.automationDecision, topicVerdict: intent.topicVerdict,
      // 🔴 count 는 지금 화면 기준(cluster·control 반영). ifClusterEnabled 는 cluster 를 켤지 판단할 때만 본다
      direct: { count: directCount, ifClusterEnabled: controlOn ? direct.length : 0, targets: direct },
      discovery: { count: discoveryCount, ifClusterEnabled: controlOn ? Math.min(discovery.length, 1) : 0, targets: discovery },
      display: { direct: visible ? direct.slice(0, READINESS_POLICY.displayTarget.directMax).map((t) => t.slug) : [],
        discovery: visible && discovery.length ? discovery[0].slug : null },
      reverse: { count: reverseSources.length, sources: reverseSources, mismatches },
      control: { controlEnabled: Boolean(control?.enabled), killSwitchTripped: control ? control.killSwitchTripped : null,
        clusterEnabled: clusterOn(cluster), enabledSurfaces: [...enabledSurfaces].sort() },
      admission: { state: admissionState, slug: admissionSlug, blockers: admissionBlockers },
      rejected, blockers, shortfall, status, graphReady: status === 'GRAPH_READY',
    })
  }
  rows.sort((a, b) => a.intentId.localeCompare(b.intentId))

  const tally = (xs) => xs.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {})
  const keyOf = (s) => s.replace(/\(.*$/, '')
  const registeredCount = layers.intents.filter((x) => registered(x.intentId)).length
  const report = {
    schemaVersion: READINESS_SCHEMA,
    derived: true,
    note: '🔴 파생 보고서다. 손으로 고치지 않는다 — 같은 입력으로 다시 build 하면 같은 바이트가 나온다',
    graphVersion, semanticHash, effectiveAt: effective.text,
    policy: READINESS_POLICY,
    totals: {
      intents: layers.intents.length, registered: registeredCount, unregistered: layers.intents.length - registeredCount,
      inventoried: rows.length,
      GRAPH_READY: rows.filter((r) => r.status === 'GRAPH_READY').length,
      GRAPH_INCOMPLETE: rows.filter((r) => r.status === 'GRAPH_INCOMPLETE').length,
      BLOCKED: rows.filter((r) => r.status === 'BLOCKED').length,
    },
    blockerCounts: tally(rows.flatMap((r) => r.blockers.map(keyOf))),
    shortfallCounts: tally(rows.flatMap((r) => r.shortfall.map(keyOf))),
    admissionCounts: tally(rows.map((r) => r.admission.state)),
    rows,
  }
  return { report, admissionHashes: admission ? admission.hashes : 'UNREAD' }
}

/** 상위 후보 — 상태 · 근거 수 · intentId 순(결정적) */
export function topCandidates(report, k = 5) {
  const rank = { GRAPH_READY: 0, GRAPH_INCOMPLETE: 1, BLOCKED: 2 }
  return [...report.rows].sort((a, b) => rank[a.status] - rank[b.status]
    || (b.direct.count + b.discovery.count) - (a.direct.count + a.discovery.count)
    || b.reverse.count - a.reverse.count || a.intentId.localeCompare(b.intentId)).slice(0, k)
}
