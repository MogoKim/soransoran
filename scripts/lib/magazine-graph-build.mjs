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
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

import { isPublic } from './magazine-gate.mjs'
import { RELATION_POLICY } from './magazine-relation-policy.mjs'
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
  productionMinimum: Object.freeze({ direct: RELATION_POLICY.directMin, discovery: RELATION_POLICY.discovery }),
  displayTarget: Object.freeze({ directMax: RELATION_POLICY.directMax, discovery: RELATION_POLICY.discovery }),
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

/**
 * 🔴 공용 시각 의미 검증 — 파싱한 시각을 같은 offset 의 벽시계로 되돌려 입력의 `YYYY-MM-DDTHH:mm:ss` 와
 *    **문자 그대로** 같은지 본다. 2026-02-30 · 24:00 · 25:61:61 처럼 Date 가 굴리거나 못 읽는 값은 false.
 *    effectiveAt · mapping publishedAt · publishAt 이 같은 함수를 쓴다(규칙이 갈라지지 않게).
 */
export function wallClockRoundTrips(text, offsetMin) {
  if (typeof text !== 'string') return false
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) return false
  return new Date(ms + offsetMin * 60e3).toISOString().slice(0, 19) === text.slice(0, 19)
}
/** 달력에 실제로 있는 YYYY-MM-DD */
export const isRealDate = (v) => isStr(v) && DATE_RE.test(v) && wallClockRoundTrips(`${v}T00:00:00Z`, 0)
/** 실제로 있는 KST 초 단위 시각 — +09:00 고정 */
export const isRealKstAt = (v) => isStr(v) && KST_AT_RE.test(v) && wallClockRoundTrips(v, 9 * 60)

/**
 * effectiveAt — 오프셋을 명시한 시각만. graphVersion 날짜는 이 시각의 **KST 날짜**다.
 * 🔴 `Date.parse` 는 2026-02-30 을 3월 2일로, 24:00 을 다음 날 0시로 굴린다. 그래서 파싱한 시각을
 *    같은 offset 의 벽시계로 되돌려 입력의 날짜·시·분·초와 **문자 그대로** 같을 때만 받는다.
 *    offset 은 ±14:00 안이어야 한다(V8 은 +14:30 도 받는다).
 */
export function parseEffectiveAt(text) {
  const m = typeof text === 'string' ? EFFECTIVE_AT_RE.exec(text) : null
  if (!m) fail('EFFECTIVE_AT_INVALID', `effectiveAt 은 오프셋이 있는 ISO 시각이어야 한다 (예 2026-10-15T13:00:00+09:00): ${text}`)
  const offset = m[7]
  let offsetMin = 0
  if (offset !== 'Z') {
    const oh = Number(offset.slice(1, 3)), om = Number(offset.slice(4, 6))
    if (oh > 14 || om > 59 || (oh === 14 && om > 0)) fail('EFFECTIVE_AT_INVALID', `offset 이 범위 밖이다: ${text}`)
    offsetMin = (offset[0] === '-' ? -1 : 1) * (oh * 60 + om)
  }
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) fail('EFFECTIVE_AT_INVALID', `해석할 수 없는 시각이다: ${text}`)
  if (!wallClockRoundTrips(text, offsetMin)) fail('EFFECTIVE_AT_INVALID', `달력에 없는 날짜·시각이다: ${text}`)
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
  validateInputs(out)
  return { ...out, hashes }
}

/** placement 계약 — 구현 여부와 무관하게 graph 가 쓸 수 있는 표면 전부 */
export const KNOWN_PLACEMENTS = Object.freeze(['CTA_END', 'FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE',
  'SERIES_NAV', 'BODY_INLINE_OR_TOP', 'BODY_CALLOUT'])
const EDGE_ID_RE = /^E-\d{4,}$/
const TERRITORY_RE = /^T\d+/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KST_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/
/** intent/2 열거 계약 — 연구 입력 2026-10-15 판의 값 전부. 새 값은 계약 변경으로 들인다 */
export const INTENT_ENUMS = Object.freeze({
  policyScope: Object.freeze(['ALLOWED', 'BLOCKED']),
  verificationProfile: Object.freeze(['STANDARD', 'MEDICAL', 'SENSITIVE', 'FINANCIAL']),
  automationDecision: Object.freeze(['PASS', 'HOLD', 'REJECT']),
  topicVerdict: Object.freeze(['AUTO_READY_TOPIC', 'EXTEND_EXISTING', 'AUTO_HOLD', 'AUTO_REJECT']),
})
/** intent/2 runtimeState — 입력에 없으면 builder 가 UNPUBLISHED 로 채운다 */
export const RUNTIME_STATES = Object.freeze(['UNPUBLISHED', 'ACTIVE', 'FALLBACK', 'QUARANTINED'])
/** edge/3 runtimeState — builder 가 계산한다 */
export const EDGE_RUNTIME_STATES = Object.freeze(['UNPUBLISHED', 'FALLBACK', 'ACTIVE'])
export const RECIPROCAL_POLICIES = Object.freeze(['ONE_WAY', 'BACKLINK_REQUIRED', 'MUTUAL'])
export const EDGE_PRIORITIES = Object.freeze([1, 2, 3])
export const BACKLINK_STATUSES = Object.freeze(['PLANNED', 'PAIRED'])
export const ASSET_STATES = Object.freeze(['LIVE', 'SCHEDULED_NOT_YET_PUBLIC', 'QUEUED', 'BLOCKED'])
export const MAPPING_COVERAGES = Object.freeze(['ANSWERS', 'ANSWERS_PARTIAL', 'ANSWERS_WITH_DEFECT', 'ANSWERS_WITH_SCOPE_EXPANSION',
  'PARTIAL', 'ADJACENT', 'QUEUED_NOT_PUBLIC', 'SCHEDULED_NOT_YET_PUBLIC'])
/**
 * 🔴 lifecycle 정합 — 공개(LIVE)된 글에 "아직 공개 전" coverage 가 남아 있으면 오래된 판정이다.
 *    공개 뒤 본문을 다시 대조해 ANSWERS · ANSWERS_PARTIAL 등으로 바꾸거나 매핑을 지워야 한다.
 */
export const PRE_PUBLIC_COVERAGES = Object.freeze(['SCHEDULED_NOT_YET_PUBLIC', 'QUEUED_NOT_PUBLIC'])

/**
 * 🔴 graph 참여 상태 (2026-10-18) — 공개 글이 검색 graph 에 들어가는가.
 *    SEARCH_NODE           canonical mapping 이 있는 글. mappings 에서 파생하고 따로 적지 않는다
 *    EDITORIAL_NON_SEARCH  bounded 조사로 검색 근거 없음이 **증명된** 글. assets-published 의 graphParticipation 으로만 들어온다
 *    UNRESOLVED            둘 다 아닌 글. 기록하지 않는다 — 선언이 없다는 것이 곧 미확정이다
 *    slug · cluster 이름으로 editorial 을 정하지 않는다. 근거 신원과 hash 가 있는 선언만 받는다.
 */
export const EDITORIAL_NON_SEARCH = 'EDITORIAL_NON_SEARCH'
export const EDITORIAL_REASON_CODES = Object.freeze(['BOUNDED_RESEARCH_EXHAUSTED'])
/** 판정을 운반하는 bundle 의 schema 표식 — 판정 산출 행의 schemaVersion 과 같은 값 */
export const PARTICIPATION_SCHEMA = 'participation/1'
const SHA256_RE = /^[0-9a-f]{64}$/
/** editorial 근거 묶음의 hash — 근거 순서와 무관하다. 연구 기록과 builder 가 이 함수 하나를 쓴다 */
export function editorialEvidenceHash(evidence) {
  const rows = evidence.map((e) => ({ ref: e.ref, sha256: e.sha256 }))
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  return sha256(JSON.stringify(rows))
}

/**
 * 🔴 existing asset 요약의 유일한 권위 — canonical `existingSlugs` 에서 만든 **built mappings** 다.
 *    automation `existingAssetRelation` 은 legacy 입력이며 산출을 정하지 않는다(두 권위가 한 bundle 안에서 모순되지 않게).
 *    형식: `slug(상태/coverage)` 를 mapping 순서대로 `, ` 로 잇는다. 상태는 LIVE 만 기존 호환 표현 PUBLISHED, 그 외는 assetState. 없으면 `없음`.
 */
export function summarizeExistingAssets(intentMappings) {
  return intentMappings.map((m) => `${m.slug}(${m.assetState === 'LIVE' ? 'PUBLISHED' : m.assetState}/${m.coverage})`).join(', ') || '없음'
}
/** intentId → 요약. mapping 순서(canonical 순서)를 그대로 따른다 */
export function existingAssetSummaries(mappings) {
  const by = new Map()
  for (const m of mappings) (by.get(m.intentId) ?? by.set(m.intentId, []).get(m.intentId)).push(m)
  return (intentId) => summarizeExistingAssets(by.get(intentId) ?? [])
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'
export const isEdgeId = (v) => isStr(v) && EDGE_ID_RE.test(v)
/** mapping 신원 = (intentId, slug). 둘 중 하나라도 비면 신원이 없다 */
export const mappingKey = (m) => (nonEmpty(m.intentId) && nonEmpty(m.slug) ? `${m.intentId}\u0000${m.slug}` : null)

/**
 * 🔴 공용 신원 검증 — 입력 경계와 산출 경계가 **같은 함수**로 형식 · 중복을 본다.
 * @param {object[]} rows
 * @param {{ label: string, keyOf: (r: object) => unknown, valid: (k: unknown) => boolean, unique: boolean }} rule
 * @returns {{ seen: Set<string>, problems: string[] }}
 */
export function identityProblems(rows, { label, keyOf, valid, unique }) {
  const seen = new Set()
  const problems = []
  rows.forEach((r, i) => {
    const key = isPlain(r) ? keyOf(r) : undefined
    if (!valid(key)) { problems.push(`${label} ${i + 1}번 신원 형식 오류: ${JSON.stringify(key)}`); return }
    if (unique && seen.has(key)) problems.push(`${label} 신원 중복 ${String(key).replace('\u0000', '→')}`)
    seen.add(key)
  })
  return { seen, problems }
}

/**
 * 🔴 입력 신원 계약 — buildGraphLayers 가 TypeError 없이 돌 수 있는 최소 구조와 **신원**만 본다.
 *    필드 값 계약(enum · 필수 문자열 · 게시판 등)은 여기서 보지 않는다 — 산출 계약 `validateBuiltArtifacts` 한 곳에만 둔다.
 *    두 곳에 같은 규칙을 두면 한쪽을 지워도 다른 쪽이 가려 변이가 검출되지 않는다.
 */
export function validateInputs({ canonical, automation, graph, published, queued }) {
  const bad = []
  const ids = (rows, rule) => { const r = identityProblems(rows, rule); bad.push(...r.problems); return r.seen }
  if (!canonical.length) bad.push('canonical intent 가 0개다')
  if (!automation.length) bad.push('automation intent 가 0개다')
  if (!graph.length) bad.push('graph edge 가 0개다')
  const canon = ids(canonical, { label: 'canonical intent', keyOf: (r) => r.intentId, valid: nonEmpty, unique: true })
  const auto = ids(automation, { label: 'automation intent', keyOf: (r) => r.intentId, valid: nonEmpty, unique: true })
  const onlyAuto = [...auto].filter((x) => !canon.has(x)), onlyCanon = [...canon].filter((x) => !auto.has(x))
  if (onlyAuto.length || onlyCanon.length) bad.push(`canonical·automation intent 집합이 다르다 (automation 만 ${onlyAuto.slice(0, 3)} · canonical 만 ${onlyCanon.slice(0, 3)})`)
  canonical.forEach((c, i) => {
    if (!isPlain(c)) return
    if (c.existingSlugs != null && (!Array.isArray(c.existingSlugs) || !c.existingSlugs.every((s) => isPlain(s) && nonEmpty(s.slug)))) {
      bad.push(`canonical ${i + 1}행 existingSlugs 형식 오류`)
    }
  })
  graph.forEach((e, i) => { if (!isPlain(e)) bad.push(`graph ${i + 1}행 객체가 아니다`) })
  ids(graph, { label: 'graph edge', keyOf: (e) => e.edgeId, valid: isEdgeId, unique: true })
  published.forEach((p, i) => {
    if (!isPlain(p) || !nonEmpty(p.slug) || !isStr(p.assetState)) bad.push(`assets-published ${i + 1}행 slug·assetState 형식 오류`)
    else if (p.graphParticipation !== undefined && (!isPlain(p.graphParticipation) || !Array.isArray(p.graphParticipation.evidence))) {
      bad.push(`assets-published ${i + 1}행 graphParticipation 형식 오류`)
    }
  })
  queued.forEach((q, i) => { if (!isPlain(q) || !nonEmpty(q.slug)) bad.push(`assets-queue ${i + 1}행 slug 형식 오류`) })
  if (bad.length) fail('INPUT_SCHEMA_INVALID', `${bad.length}건 — ${bad.slice(0, 5).join(' | ')}`)
}

/**
 * 🔴 산출 계약 — buildGraphLayers 결과(intent/2 · edge/3 · mapping/2)를 **직렬화 · 해시 전에** 전부 본다.
 *    입력 필드를 하나씩 막는 대신, 실제로 나갈 값의 계약을 한 곳에서 닫는다. 실패는 `INPUT_SCHEMA_INVALID`.
 *    nullable · builder 기본값은 산출 값 기준이다(runtimeState → UNPUBLISHED, communityDestination → 영토 게시판).
 */
export function validateBuiltArtifacts({ intents, edges, mappings, participation = [] }) {
  const bad = []
  // 🔴 최종 산출 신원 — 자동 생성 edge 까지 포함한 결과를 입력과 같은 helper 로 본다
  const identity = (rows, rule) => { const r = identityProblems(rows, rule); bad.push(...r.problems); return r.seen }
  const intentIds = identity(intents, { label: '산출 intent', keyOf: (x) => x.intentId, valid: nonEmpty, unique: true })
  const assetSummaryOf = existingAssetSummaries(mappings)
  identity(edges, { label: '산출 edge', keyOf: (e) => e.edgeId, valid: isEdgeId, unique: true })
  identity(mappings, { label: '산출 mapping', keyOf: mappingKey, valid: nonEmpty, unique: true })
  const nullableStr = (v) => v == null || isStr(v)

  intents.forEach((x) => {
    const at = `intent ${x.intentId}`
    if (x.schemaVersion !== 'intent/2') bad.push(`${at} schemaVersion 계약 밖`)
    for (const k of ['primaryQuery', 'audienceSituation']) if (!nonEmpty(x[k])) bad.push(`${at} ${k} 누락`)
    if (!isStr(x.territoryId) || !TERRITORY_RE.test(x.territoryId)) bad.push(`${at} territoryId 형식 오류: ${JSON.stringify(x.territoryId)}`)
    if (x.magazineCluster !== null && !nonEmpty(x.magazineCluster)) bad.push(`${at} magazineCluster 형식 오류`)
    if (x.answerScope !== null && !isStr(x.answerScope)) bad.push(`${at} answerScope 형식 오류`)
    if (!Array.isArray(x.exclusions) || !x.exclusions.every(isStr)) bad.push(`${at} exclusions 형식 오류`)
    for (const [k, allowed] of Object.entries(INTENT_ENUMS)) {
      if (!allowed.includes(x[k])) bad.push(`${at} ${k} 계약 밖: ${JSON.stringify(x[k])}`)
    }
    if (!RUNTIME_STATES.includes(x.runtimeState)) bad.push(`${at} runtimeState 계약 밖: ${JSON.stringify(x.runtimeState)}`)
    for (const k of ['policyScopeWhy', 'verdictWhy', 'existingAssetRelation']) if (!isStr(x[k])) bad.push(`${at} ${k} 누락`)
    if (isStr(x.existingAssetRelation) && x.existingAssetRelation !== assetSummaryOf(x.intentId)) bad.push(`${at} existingAssetRelation 이 mappings 와 다르다: ${JSON.stringify(x.existingAssetRelation)}`)
    for (const k of ['profileSpec', 'evidence']) if (!isPlain(x[k])) bad.push(`${at} ${k} 누락·형식 오류`)
    if (isPlain(x.evidence) && (typeof x.evidence.refs !== 'number' || !Number.isFinite(x.evidence.refs))) bad.push(`${at} evidence.refs 가 수가 아니다: ${JSON.stringify(x.evidence.refs)}`)
    if (x.retryPolicy !== null && !isPlain(x.retryPolicy)) bad.push(`${at} retryPolicy 형식 오류`)
    if (x.quarantineReason !== undefined && !isStr(x.quarantineReason)) bad.push(`${at} quarantineReason 형식 오류`)
    if (x.duplicateReason !== null && !isStr(x.duplicateReason)) bad.push(`${at} duplicateReason 형식 오류`)
    if (!BOARDS.includes(x.communityDestination)) bad.push(`${at} communityDestination 이 게시판 계약 밖이다: ${JSON.stringify(x.communityDestination)}`)
  })

  edges.forEach((e) => {
    const at = `edge ${e.edgeId}`
    if (e.schemaVersion !== 'edge/3') bad.push(`${at} schemaVersion 계약 밖`)
    if (!Object.hasOwn(RELATION_TO_SLOT, e.relationType)) bad.push(`${at} 모르는 relationType: ${JSON.stringify(e.relationType)}`)
    // 🔴 미지 relationType 은 위 한 줄만 잡는다 — 여기서 겹쳐 잡으면 위 검사를 지워도 변이가 가려진다
    if (Object.hasOwn(RELATION_TO_SLOT, e.relationType) && e.recommendationSlot !== RELATION_TO_SLOT[e.relationType]) bad.push(`${at} recommendationSlot 이 관계에서 파생된 값이 아니다`)
    if (!KNOWN_PLACEMENTS.includes(e.placement)) bad.push(`${at} 모르는 placement: ${JSON.stringify(e.placement)}`)
    if (!intentIds.has(e.fromIntentId)) bad.push(`${at} fromIntentId 가 intent 집합에 없다: ${JSON.stringify(e.fromIntentId)}`)
    if (e.relationType === 'COMMUNITY') { if (!BOARDS.includes(e.toIntentId)) bad.push(`${at} COMMUNITY 도착이 게시판 계약 밖이다: ${JSON.stringify(e.toIntentId)}`) }
    else if (!intentIds.has(e.toIntentId)) bad.push(`${at} toIntentId 가 intent 집합에 없다: ${JSON.stringify(e.toIntentId)}`)
    if (!isStr(e.readerReason) || !isStr(e.anchorLabel)) bad.push(`${at} readerReason·anchorLabel 이 문자열이 아니다`)
    if (!EDGE_PRIORITIES.includes(e.priority)) bad.push(`${at} priority 계약 밖: ${JSON.stringify(e.priority)}`)
    if (!RECIPROCAL_POLICIES.includes(e.reciprocalPolicy)) bad.push(`${at} reciprocalPolicy 계약 밖: ${JSON.stringify(e.reciprocalPolicy)}`)
    if (!nullableStr(e.reverseEdgeId) || !nullableStr(e.reciprocalGroupId) || !nullableStr(e.reciprocalWhy)
      || !nullableStr(e.riskNote) || !nullableStr(e.generatedBy)) bad.push(`${at} 선택 문자열 필드 형식 오류`)
    if (e.backlinkStatus != null && !BACKLINK_STATUSES.includes(e.backlinkStatus)) bad.push(`${at} backlinkStatus 계약 밖: ${JSON.stringify(e.backlinkStatus)}`)
    if (e.backlinkPlan != null) {
      const p = e.backlinkPlan
      if (!isPlain(p) || !intentIds.has(p.fromIntentId) || !intentIds.has(p.toIntentId) || !Object.hasOwn(RELATION_TO_SLOT, p.relationType)
        || !isStr(p.readerReason) || !isStr(p.anchorLabel)) bad.push(`${at} backlinkPlan 형식 오류`)
      else if (!nonEmpty(p.activateWhen)) bad.push(`${at} backlinkPlan.activateWhen 누락`)
    }
    if (!['ALLOWED', 'BLOCKED'].includes(e.policyScope) || !['PASS', 'HOLD', 'REJECT'].includes(e.automationDecision)
      || !EDGE_RUNTIME_STATES.includes(e.runtimeState)) bad.push(`${at} 계산 enum 계약 밖`)
    if (!isStr(e.policyScopeWhy) || !isStr(e.automationDecisionWhy) || !isStr(e.runtimeWhy)) bad.push(`${at} 계산 사유 누락`)
    if (!nullableStr(e.fromCluster) || !nullableStr(e.toCluster)) bad.push(`${at} cluster 형식 오류`)
    if (typeof e.exposeNow !== 'boolean' || typeof e.crossCluster !== 'boolean') bad.push(`${at} boolean 필드 형식 오류`)
    // 🔴 형식이 아니라 값 — crossCluster 는 산출 cluster 두 값에서만 나온다. COMMUNITY 는 언제나 false
    else if (e.crossCluster !== (e.relationType === 'COMMUNITY' ? false : e.fromCluster !== e.toCluster)) bad.push(`${at} crossCluster 가 산출 fromCluster·toCluster 와 어긋난다`)
    if (!Array.isArray(e.fromLive) || !e.fromLive.every(isStr) || !Array.isArray(e.toLive) || !e.toLive.every(isStr)) bad.push(`${at} fromLive·toLive 형식 오류`)
    if (!isPlain(e.layers) || !['DESIGN', 'AUTOMATION_READY', 'RUNTIME_ACTIVE'].every((k) => typeof e.layers[k] === 'boolean')) bad.push(`${at} layers 가 boolean 이 아니다`)
    if (!isPlain(e.layerWhy)) bad.push(`${at} layerWhy 형식 오류`)
  })

  mappings.forEach((m, i) => {
    const at = `mapping ${i + 1} ${m.intentId}→${m.slug}`
    if (m.schemaVersion !== 'mapping/2') bad.push(`${at} schemaVersion 계약 밖`)
    if (!intentIds.has(m.intentId)) bad.push(`${at} intentId 가 intent 집합에 없다`)
    if (!nonEmpty(m.slug)) bad.push(`${at} slug 누락`)
    if (!ASSET_STATES.includes(m.assetState)) bad.push(`${at} assetState 계약 밖: ${JSON.stringify(m.assetState)}`)
    if (!MAPPING_COVERAGES.includes(m.coverage)) bad.push(`${at} coverage 계약 밖: ${JSON.stringify(m.coverage)}`)
    if (m.assetState === 'LIVE' && PRE_PUBLIC_COVERAGES.includes(m.coverage)) bad.push(`${at} lifecycle 모순 — LIVE 인데 coverage ${m.coverage}`)
    if (m.cluster !== null && !nonEmpty(m.cluster)) bad.push(`${at} cluster 형식 오류: ${JSON.stringify(m.cluster)}`)
    if (m.publishedAt !== null && !isRealDate(m.publishedAt)) bad.push(`${at} publishedAt 형식 오류: ${JSON.stringify(m.publishedAt)}`)
    if (m.publishAt !== null && !isRealKstAt(m.publishAt)) bad.push(`${at} publishAt 형식 오류: ${JSON.stringify(m.publishAt)}`)
  })

  // 🔴 editorial 선언 — 근거 신원 · hash 가 없으면 받지 않고, 검색 mapping 과 동시에 있으면 계약 오류다
  const mappedSlugs = new Set(mappings.map((m) => m.slug))
  const partRows = Array.isArray(participation) ? participation : []
  if (!Array.isArray(participation)) bad.push('participation 산출이 배열이 아니다')
  identity(partRows, { label: '산출 participation', keyOf: (p) => p.slug, valid: nonEmpty, unique: true })
  partRows.forEach((p, i) => {
    // 🔴 형식이 깨진 행은 역참조하지 않는다 — TypeError 가 아니라 계약 위반으로 막는다
    if (!isPlain(p)) { bad.push(`participation ${i + 1}번 객체가 아니다`); return }
    const at = `participation ${p.slug}`
    if (p.schemaVersion !== PARTICIPATION_SCHEMA) bad.push(`${at} schemaVersion 계약 밖`)
    if (p.state !== EDITORIAL_NON_SEARCH) bad.push(`${at} state 계약 밖: ${JSON.stringify(p.state)}`)
    if (!EDITORIAL_REASON_CODES.includes(p.reasonCode)) bad.push(`${at} reasonCode 계약 밖: ${JSON.stringify(p.reasonCode)}`)
    const evidence = Array.isArray(p.evidence) ? p.evidence : null
    if (evidence === null) bad.push(`${at} 근거 목록이 배열이 아니다`)
    else if (!evidence.length || !evidence.every((e) => isPlain(e) && nonEmpty(e.ref) && isStr(e.sha256) && SHA256_RE.test(e.sha256))) {
      bad.push(`${at} 근거 신원·hash 누락`)
    } else if (new Set(evidence.map((e) => e.ref)).size !== evidence.length) bad.push(`${at} 근거 신원 중복`)
    // 🔴 hash 는 형식 검증을 통과한 근거에만 계산한다
    else if (p.evidenceHash !== editorialEvidenceHash(evidence)) bad.push(`${at} evidenceHash 가 근거 묶음과 다르다`)
    if (mappedSlugs.has(p.slug)) bad.push(`${at} EDITORIAL_NON_SEARCH 인데 canonical mapping 이 있다`)
  })

  if (bad.length) fail('INPUT_SCHEMA_INVALID', `산출 계약 ${bad.length}건 — ${bad.slice(0, 5).join(' | ')}`)
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

export const PRODUCT_LIFECYCLE_DRIFT = 'INPUT_PRODUCT_LIFECYCLE_DRIFT'
/** 예약될 수 없는 제품 status — snapshot 이 SCHEDULED 라고 적어도 공개 예정이 아니다 */
export const UNSCHEDULABLE_STATUSES = Object.freeze(['DRAFT', 'BLOCKED'])

/**
 * 🔴 snapshot ↔ 제품 lifecycle 대조 — 오래된 연구 snapshot 이 이미 공개된 글을 QUEUE · 공개 전으로 계속 분류하거나,
 *    아직 공개 전인 글을 LIVE 로 기록하면 build 전에 멈춘다(2026-10-17 kimjang · cold-weather 사고의 일반 관문).
 *
 *    시각: 명시한 effectiveAt 만 쓴다(벽시계 0). 공개 판정은 제품과 같은 `isPublic(article, ms)` — raw status 로 판정하지 않는다.
 *    snapshot 상태(slug 별): published 의 LIVE · SCHEDULED_NOT_YET_PUBLIC 가 queue 를 가린다(published > queue).
 *      `assets-queue` 는 topic-queue 의 append-only provenance 사본이라 공개 뒤에도 행이 남는다 — 교차 중복은 허용한다.
 *    규칙:
 *      · 제품에서 공개된 slug 는 snapshot 에서 LIVE 여야 한다(queue-only · scheduled · 없음 → drift)
 *      · 제품에서 아직 공개 전인(또는 없는) slug 를 LIVE 로 기록하면 drift
 *      · SCHEDULED 는 제품에 그 글이 있고 DRAFT · BLOCKED 가 아닐 때만 — phantom 예약 · 초안 · 차단 글은 drift
 *      · 대상 slug = snapshot 의 published · queue · canonical existingSlugs. canonical 밖 제품 글은 mapping 을 요구하지 않는다
 *      · published · queue 각 파일 안의 slug 중복, 계약 밖 published assetState 는 drift
 *    오류는 slug 별 한 건(사유를 모은다)으로 낸다.
 *    🔴 `validateBuiltArtifacts` 의 LIVE ↔ coverage 검사는 산출 내부 계약이고, 이 관문은 snapshot 과 제품 사실의 대조다 — 중복이 아니다.
 * @returns {{ slug: string, reasons: string[] }[]} slug 순 정렬
 */
export function productLifecycleDrift({ inputs, articles, effectiveMs }) {
  const bySlug = new Map(articles.map((a) => [a.slug, a]))
  const drift = new Map()
  const add = (slug, why) => (drift.get(slug) ?? drift.set(slug, []).get(slug)).push(why)
  const resolved = new Map()
  const seenQueue = new Set()
  for (const q of inputs.queued) {
    if (seenQueue.has(q.slug)) add(q.slug, 'assets-queue 안에서 slug 중복')
    seenQueue.add(q.slug)
    resolved.set(q.slug, 'QUEUE')
  }
  const seenPublished = new Set()
  for (const p of inputs.published) {
    if (seenPublished.has(p.slug)) add(p.slug, 'assets-published 안에서 slug 중복')
    seenPublished.add(p.slug)
    const state = p.assetState === 'LIVE' ? 'LIVE' : p.assetState === 'SCHEDULED_NOT_YET_PUBLIC' ? 'SCHEDULED' : null
    if (!state) add(p.slug, `assets-published assetState 계약 밖: ${JSON.stringify(p.assetState)}`)
    resolved.set(p.slug, state ?? 'UNKNOWN') // published 가 queue 를 가린다
  }
  const canonicalSlugs = inputs.canonical.flatMap((c) => (c.existingSlugs ?? []).map((s) => s.slug))
  for (const slug of new Set([...resolved.keys(), ...canonicalSlugs])) {
    const article = bySlug.get(slug)
    const state = resolved.get(slug) ?? 'ABSENT'
    const live = Boolean(article) && isPublic(article, effectiveMs)
    if (live && state !== 'LIVE') add(slug, `제품은 effectiveAt 에 공개인데 snapshot 은 ${state}`)
    if (!live && state === 'LIVE') add(slug, `snapshot 은 LIVE 인데 제품은 ${article ? 'effectiveAt 에 아직 공개 전' : '없음'}`)
    // 🔴 SCHEDULED 제품 신원 — 예약은 제품에 실제로 예약된 글이어야 한다(이미 공개된 경우는 위 줄이 잡는다)
    if (state === 'SCHEDULED') {
      if (!article) add(slug, 'snapshot 은 SCHEDULED 인데 제품에 글이 없다')
      if (article && UNSCHEDULABLE_STATUSES.includes(article.status)) add(slug, `snapshot 은 SCHEDULED 인데 제품 status 가 ${article.status}`)
    }
  }
  return [...drift].sort(([a], [b]) => a.localeCompare(b)).map(([slug, reasons]) => ({ slug, reasons }))
}

/** 관문 — drift 가 있으면 `INPUT_PRODUCT_LIFECYCLE_DRIFT` 로 멈춘다 */
export function assertProductLifecycle({ inputs, articles, effectiveMs }) {
  const drift = productLifecycleDrift({ inputs, articles, effectiveMs })
  if (drift.length) fail(PRODUCT_LIFECYCLE_DRIFT, `${drift.length}개 slug — ${drift.slice(0, 5).map((d) => `${d.slug}: ${d.reasons.join(' · ')}`).join(' | ')}`)
}

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
  // 🔴 automation.existingAssetRelation(legacy)은 읽지 않는다 — 요약은 built mappings 하나에서 나온다
  const assetSummaryOf = existingAssetSummaries(mappings)

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
    existingAssetRelation: assetSummaryOf(r.intentId), duplicateReason: r.duplicateReason ?? null }))

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
    // 🔴 cluster 는 한 번만 계산한다 — canonical magazineCluster → 입력 edge cluster → null.
    //    crossCluster 를 canonical 값끼리 따로 비교하면 한쪽이 null 일 때 산출 cluster 와 어긋난다 (2026-10-21 실측 74건)
    const fromCluster = I[e.fromIntentId]?.magazineCluster ?? e.fromCluster ?? null
    const toCluster = isCommunity ? null : (I[e.toIntentId]?.magazineCluster ?? e.toCluster ?? null)
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
      fromCluster, toCluster, crossCluster: isCommunity ? false : fromCluster !== toCluster,
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

  // ⑤ graph 참여 — editorial 선언만 싣는다. SEARCH_NODE 는 mappings 가, UNRESOLVED 는 선언 없음이 말한다
  const participation = published.filter((p) => p.graphParticipation !== undefined).map((p) => {
    const g = p.graphParticipation
    return { schemaVersion: PARTICIPATION_SCHEMA, slug: p.slug, state: g.state ?? null, reasonCode: g.reasonCode ?? null,
      evidence: g.evidence.map((e) => ({ ref: isPlain(e) ? e.ref ?? null : null, sha256: isPlain(e) ? e.sha256 ?? null : null })),
      evidenceHash: g.evidenceHash ?? null }
  }).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))

  return { intents, edges, mappings, participation, autoBacklinks, registeredInProduct: published.length }
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
export function slimGraph({ graphVersion, contentHash, generatedAt, intents, edges, mappings, participation = [] }) {
  const slim = {
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
    // 🔴 coverage 는 resolver 의 다중 mapping 선택 정책(ANSWERS 우선)이 읽는다 — 검증된 산출 값을 그대로 싣는다
    mappings: mappings.filter((x) => x.assetState === 'LIVE').map((x) => ({ intent: x.intentId, slug: x.slug, cluster: x.cluster, coverage: x.coverage })),
    intents: intents.filter((x) => x.automationDecision === 'PASS' && x.runtimeState !== 'QUARANTINED')
      .map((x) => ({ id: x.intentId, cluster: x.magazineCluster, board: x.communityDestination })),
  }
  // 🔴 editorial 판정은 선언이 있을 때만 싣는다 — 선언 없는 판의 bundle 바이트(롤백 대상 포함)를 바꾸지 않는다.
  //    근거 신원 목록은 participation.jsonl 에 남고, 제품은 판정과 evidenceHash 만 읽는다
  if (participation.length) {
    // 🔴 판정을 운반하는 bundle 만 schema 표식을 단다 — 선언 없는 판은 schemaVersion 바이트도 그대로
    slim.schemaVersion = { ...slim.schemaVersion, participation: PARTICIPATION_SCHEMA }
    slim.participation = participation.map((p) => ({ slug: p.slug, state: p.state, reasonCode: p.reasonCode, evidenceHash: p.evidenceHash }))
  }
  return slim
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
  // 🔴 새 산출의 LIVE mapping 은 공개 후 coverage 를 반드시 갖는다 — 없으면 resolver 가 ANSWERS 우선을 못 한다
  const coverageBad = slim.mappings.filter((m) => !MAPPING_COVERAGES.includes(m.coverage) || PRE_PUBLIC_COVERAGES.includes(m.coverage))
  if (coverageBad.length) bad.push(`EXPORT_MAPPING_COVERAGE_MISSING ${coverageBad.map((m) => `${m.intent}|${m.slug}`).join(',')}`)
  // 🔴 bundle 이 운반하는 editorial 판정 — 검색 mapping 과 겹치거나 근거 hash 가 없으면 내보내지 않는다
  const mappedSlugs = new Set(slim.mappings.map((m) => m.slug))
  const partBad = (slim.participation ?? []).filter((p) => p.state !== EDITORIAL_NON_SEARCH || !EDITORIAL_REASON_CODES.includes(p.reasonCode)
    || !SHA256_RE.test(p.evidenceHash ?? '') || mappedSlugs.has(p.slug))
  if (partBad.length) bad.push(`EXPORT_PARTICIPATION_INVALID ${partBad.map((p) => p.slug).join(',')}`)
  // 🔴 판정과 schema 표식은 함께 다닌다 — 한쪽만 있으면 소비자가 판을 잘못 읽는다
  const hasPart = Array.isArray(slim.participation) && slim.participation.length > 0
  const marker = slim.schemaVersion?.participation
  if (hasPart && marker !== PARTICIPATION_SCHEMA) bad.push(`EXPORT_PARTICIPATION_SCHEMA_MISSING ${JSON.stringify(marker ?? null)}`)
  if (!hasPart && (marker !== undefined || 'participation' in slim)) bad.push('EXPORT_PARTICIPATION_SCHEMA_ORPHAN')
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
  // 🔴 snapshot ↔ 제품 lifecycle — layer · 직렬화 · 해시 · 쓰기 전에
  assertProductLifecycle({ inputs, articles: product.articles, effectiveMs: eff.ms })
  const layers = buildGraphLayers({ inputs, implementedSurfaces: product.implemented })
  // 🔴 산출 계약 — 직렬화 · 해시 · export 전에 한 번
  validateBuiltArtifacts(layers)

  const sIntents = layers.intents.map((x) => JSON.stringify(x)).join('\n') + '\n'
  const sEdges = layers.edges.map((x) => JSON.stringify(x)).join('\n') + '\n'
  const sMap = layers.mappings.map((x) => JSON.stringify(x)).join('\n') + '\n'
  const hI = sha16(sIntents), hE = sha16(sEdges), hM = sha16(sMap)
  // 🔴 editorial 선언도 판의 내용이다 — 바뀌면 graphVersion 이 바뀐다. 선언이 없으면 기존 판과 같은 hash 다
  const sPart = layers.participation.length ? layers.participation.map((x) => JSON.stringify(x)).join('\n') + '\n' : null
  const hP = sPart === null ? null : sha16(sPart)
  const combined = sha16(hI + hE + hM + (hP ?? ''))
  const graphVersion = `g-${eff.versionDate}-${combined.slice(0, 6)}`
  const contentHash = hP === null
    ? { intents: hI, edges: hE, mappings: hM, combined }
    : { intents: hI, edges: hE, mappings: hM, participation: hP, combined }

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
    ...(sPart === null ? {} : { 'participation.jsonl': sPart }),
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

// ── 쓰기 경계 (CLI 전용 · 파일 시스템) ──

/**
 * 아직 없을 수도 있는 경로의 **실제 신원**. 존재하는 가장 가까운 조상을 realpath 로 풀고
 * 남은 이름을 붙인다. 🔴 남은 이름 중 하나라도 lstat 로 보이면(=끊어진 symlink) 거부한다 —
 * mkdir · write 가 그 링크를 따라 엉뚱한 곳에 쓴다.
 */
export function canonicalPath(p) {
  let cur = resolve(p)
  const rest = []
  for (;;) {
    try {
      return rest.length ? join(realpathSync(cur), ...rest.reverse()) : realpathSync(cur)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      let dangling = false
      try { lstatSync(cur); dangling = true } catch { /* 진짜로 없다 */ }
      if (dangling) fail('OUT_DIR_FORBIDDEN', `끊어진 symlink 가 경로에 있다: ${cur}`)
      const parent = dirname(cur)
      if (parent === cur) fail('OUT_DIR_FORBIDDEN', `경로를 풀 수 없다: ${p}`)
      rest.push(basename(cur))
      cur = parent
    }
  }
}

const insideOf = (child, parent) => {
  const r = relative(parent, child)
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !r.startsWith(sep))
}

/**
 * out-dir 판정 — **실제 경로**로 본다. 문자열 경로가 안전해 보여도 조상의 symlink 가
 * 금지 구역으로 귀결되면 쓰기 전에 거부한다.
 * @param {{ outDir: string, forbidden: { label: string, path: string }[] }} p
 * @returns {{ canon: string }}
 */
export function planOutDir({ outDir, forbidden }) {
  const canon = canonicalPath(outDir)
  for (const f of forbidden) {
    const root = canonicalPath(f.path)
    if (insideOf(canon, root)) fail('OUT_DIR_FORBIDDEN', `out-dir 의 실제 경로가 ${f.label} 아래다: ${canon}`)
  }
  for (const marker of ['current.ts', 'control.ts']) {
    let seen = false
    try { lstatSync(join(canon, marker)); seen = true } catch { /* 없음 */ }
    if (seen) fail('OUT_DIR_FORBIDDEN', 'out-dir 에 current.ts · control.ts 가 있다 — 제품 graph 폴더로 보인다. build 는 판 전환을 하지 않는다')
  }
  return { canon }
}

/** canon 의 모든 구성요소가 symlink 가 아닌 실제 디렉터리인지 — 없는 것은 하나씩 만든다 */
function ensureRealDirs(canon) {
  const parts = canon.split(sep).filter(Boolean)
  let cur = sep
  for (const part of parts) {
    cur = join(cur, part)
    let st = null
    try { st = lstatSync(cur) } catch (e) { if (e.code !== 'ENOENT') throw e }
    if (!st) { mkdirSync(cur); st = lstatSync(cur) }
    if (st.isSymbolicLink() || !st.isDirectory()) fail('OUT_DIR_CHANGED', `판정 뒤 경로가 바뀌었다(symlink·파일): ${cur}`)
  }
  if (realpathSync(canon) !== canon) fail('OUT_DIR_CHANGED', `판정 뒤 실제 경로가 바뀌었다: ${canon}`)
}

const listTree = (dir) => {
  const out = []
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : out.push(relative(dir, p)) } }
  walk(dir)
  return out.sort()
}

/**
 * 판 폴더 쓰기 — 임시 폴더에 다 쓴 뒤 rename. 같은 판이 있으면 바이트가 같을 때만 UNCHANGED.
 * 🔴 판정(planOutDir) 뒤 mkdir · write · rename 사이에 경로가 바뀌면 OUT_DIR_CHANGED 로 멈춘다(fail-closed).
 * @param {{ plan: {canon:string}, graphVersion: string, files: Record<string,string>, hooks?: { afterPlan?: () => void, beforeRename?: () => void } }} p
 * @returns {'WRITTEN'|'UNCHANGED'}
 */
export function writeStage({ plan, graphVersion, files, hooks = {} }) {
  const { canon } = plan
  hooks.afterPlan?.()
  ensureRealDirs(canon)
  const stage = join(canon, graphVersion)
  let st = null
  try { st = lstatSync(stage) } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (st) {
    if (st.isSymbolicLink() || !st.isDirectory()) fail('OUT_DIR_CHANGED', `판 폴더가 디렉터리가 아니다: ${stage}`)
    const have = listTree(stage)
    const want = Object.keys(files).sort()
    const same = have.length === want.length && want.every((f, i) => have[i] === f && readFileSync(join(stage, f), 'utf8') === files[f])
    if (!same) fail('OUT_STAGE_CONFLICT', `${graphVersion} 폴더가 이미 있고 내용이 다르다 — 덮어쓰지 않는다`)
    return 'UNCHANGED'
  }
  const tmp = mkdtempSync(join(canon, `.${graphVersion}.tmp-`))
  const realTmp = realpathSync(tmp)
  if (realTmp !== tmp || dirname(realTmp) !== canon) {
    try { rmSync(realTmp, { recursive: true, force: true }) } catch { /* 정리 실패도 아래에서 막힌다 */ }
    fail('OUT_DIR_CHANGED', `임시 폴더가 판정한 경로 밖에 생겼다: ${realTmp}`)
  }
  try {
    for (const [rel, text] of Object.entries(files)) {
      const target = join(tmp, rel)
      mkdirSync(dirname(target), { recursive: true })
      if (realpathSync(dirname(target)) !== dirname(target)) fail('OUT_DIR_CHANGED', `쓰기 위치가 바뀌었다: ${target}`)
      writeFileSync(target, text, { flag: 'wx' })
    }
    hooks.beforeRename?.()
    ensureRealDirs(canon)
    if (realpathSync(tmp) !== tmp) fail('OUT_DIR_CHANGED', `임시 폴더 경로가 바뀌었다: ${tmp}`)
    renameSync(tmp, stage)
  } catch (e) {
    try { if (realpathSync(tmp) === tmp) rmSync(tmp, { recursive: true, force: true }) } catch { /* 이미 없음 */ }
    throw e
  }
  return 'WRITTEN'
}
