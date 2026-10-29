/**
 * DIRECT_SPEC_V1 상류 source 관문 — 승인된 M-GRAPH 입력이 있을 때만 `article-spec.json` 을 만든다.
 *
 * 🔴 **왜 생겼나** (2026-10-15 권위 감사).
 *    PR #738 로 하류(run target → fetch → QA → register → sidecar → merge gate)는 연결됐지만,
 *    producer 가 무엇으로 spec 을 컴파일하는지는 비어 있었다. 그 사이 큐 행에 opt-in 이 붙으면
 *    direct 행이 legacy Claude brief 를 타고(`brief.md`·`review.ts` 생성) 하류에서는 spec 이 없어
 *    멈춘다 — 두 경로를 한 회차에 섞는 상태다.
 *
 *    감사 시점의 사실:
 *      · 제품 graph bundle(`src/content/magazine/graph/*`) intent 는 `{id, cluster, board}` 뿐이다.
 *        readerQuestion · scope · outline · evidence · safetyConstraints · hubPath · ctaLabel 이 없다.
 *      · 연구 `contract/build/current` 는 제품과 다른 graphVersion 을 가리킨다.
 *      · 제품 graphVersion 의 연구 입력 snapshot 은 모든 intent 가 승인 기록 없음이다.
 *    → 지금은 **어떤 direct 행도 준비되지 않았다.** 이 관문은 그 사실을 구조화해 멈춘다.
 *
 * 🔴 **빈 필드를 추정하지 않는다.** 제품 graph · 낡은 연구 · 시험 fixture 에서 값을 끌어오지 않는다.
 *    입력은 아래 계약을 따르는 승인 artifact 하나뿐이다. 없으면 NOT_READY 다.
 *
 * 🔴 **source artifact 계약** (`magazine-article-spec-source/2·/3` · ArticlePlan · 2026-10-22 PR C · /3 2026-10-28).
 *      경로      drafts/magazine/article-spec-source/<graphVersion>.json
 *      최상위    { schema, graphVersion, entries: [entry] }
 *      entry     { status, approvedBy, approvedAt, admission, plan, node, relations, hero, publication, productBasis, sourceHash }
 *      admission { g8ManifestHash, receiptHash, graphVersion, readinessHash } — 연구 G8 receipt 와 같은 값
 *      plan      필수 ARTICLE_PLAN_REQUIRED · 선택 ARTICLE_PLAN_OPTIONAL — 허용값은 topic-queue.ts 의 union
 *      sourceHash = sha256(canonicalJson(entry 에서 sourceHash 를 뺀 것)) — productBasis 를 포함한다
 *      🔴 articlePlanHash 는 이 sourceHash 하나다 (두 번째 해시 정의를 만들지 않는다)
 *    생산자는 `magazine-direct-spec-source-authoring` 의 approve 하나다. 이 파일을 손으로 만들지 않는다.
 *    source/1(plan·admission 없음)은 읽지 않는다 — SOURCE_SCHEMA_UNKNOWN.
 *
 * 🔴 **queue 행은 승인 plan 의 복제다** — materialize 가 `queueRowFromEntry` 하나로 만든다.
 *    소비 시점에 복제 필드(QUEUE_REPLICA_FIELDS)를 다시 맞춰 손편집을 SOURCE_QUEUE_DRIFT 로 막고,
 *    articlePlanHash ↔ entry.sourceHash · g8ManifestHash ↔ admission 은 각자 전용 사유로 막는다.
 *
 * 🔴 **productBasis — 승인한 M-GRAPH 판을 소비 시점에 다시 맞춘다** (2026-10-15 Codex P1).
 *    graphVersion 만 같으면 control(enabled · kill switch · cluster · surface)이나 resolver 의 surface·type 계약이
 *    바뀌어도 옛 source 를 쓴다. 승인 entry 에 basis 를 싣고, 관문은 `productRoot` 에서 같은 helper 로 다시 계산해
 *    정확히 같을 때만 통과시킨다. productRoot 를 주지 않으면 PRODUCT_BASIS_UNVERIFIED 로 막는다.
 *
 * 🔴 모델 · 시계 · 네트워크를 읽지 않는다. 읽는 파일은 제품 graph(current·bundle·control·resolver)와 source artifact 뿐이다.
 *    사유에는 경로 · 버전 · 필드 이름 · 승인 상태만 남긴다 — source 원문을 남기지 않는다.
 */

import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { ARTICLE_SPEC_SCHEMA_V2, canonicalJson, compileArticleSpec, verifyArticleSpec } from './magazine-article-spec.mjs'
import { ARTICLE_SPEC_FILENAME, ARTICLE_SPEC_REGISTER_LEDGER, DIRECT_SPEC_MODE, DIRECT_SPEC_OPT_IN_FIELD, G8_ROW_NOT_DIRECT, g8RowProblem, readDirectSpec } from './magazine-direct-spec.mjs'
import { judgeForbidden } from './magazine-forbidden.mjs'
import { isAutoLaneEligible } from './magazine-validation-profile.mjs'
import { evalLiteral, sliceLiteral } from './magazine-load.mjs'
import { isSingleDiscovery, isValidDirectCount } from './magazine-relation-policy.mjs'

export const DIRECT_SPEC_SOURCE_NOT_READY = 'DIRECT_SPEC_SOURCE_NOT_READY'
export const DIRECT_SPEC_SPEC_CONFLICT = 'DIRECT_SPEC_SPEC_CONFLICT'
/**
 * 🔴 **명시적 개정(supersedes)** (2026-10-26 · age-learning 재승인 준비).
 *    승인 entry 가 `supersedes.specHash` 로 디스크의 옛 spec 을 **정확히** 가리키면, 디스크 spec 이 새 컴파일 결과와 달라도
 *    CONFLICT 가 아니라 「교체 필요」다 — 교체는 producer 가 lease 안에서만 한다(`supersedeDirectSpec`).
 *    전송 · 등록 관문은 교체 전 상태로 진행하지 않는다(둘 다 ok:false).
 */
export const DIRECT_SPEC_SUPERSEDE_REQUIRED = 'DIRECT_SPEC_SUPERSEDE_REQUIRED'
/** 선언한 old specHash 가 디스크 spec 과 다르다 — 무엇을 대체하는지 확정할 수 없다 (fail-closed) */
export const DIRECT_SPEC_SUPERSEDE_MISMATCH = 'DIRECT_SPEC_SUPERSEDE_MISMATCH'
/** 교체 조건(신원 · draft · 전송 · 등록 · 보존 · 경쟁 writer)을 지키지 못했다 — 바이트를 덮지도 되돌리지도 않는다 */
export const DIRECT_SPEC_SUPERSEDE_BLOCKED = 'DIRECT_SPEC_SUPERSEDE_BLOCKED'
const SHA256_RE = /^sha256:[0-9a-f]{64}$/
/** `supersedes` 는 정확히 { specHash, sourceHash } — 둘 다 sha256 · 대체하는 승인은 이 entry 자신이 아니다 */
export function supersedesProblem(entry) {
  const s = entry?.supersedes
  if (s === undefined) return null
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'SUPERSEDES_INVALID'
  const keys = Object.keys(s).sort().join(',')
  if (keys !== 'sourceHash,specHash' || !SHA256_RE.test(s.specHash) || !SHA256_RE.test(s.sourceHash)) return 'SUPERSEDES_INVALID'
  if (s.sourceHash === entry.sourceHash) return 'SUPERSEDES_INVALID'
  return null
}
/**
 * 🔴 **원고 보존형 안전 개정(safety revision)** (2026-10-28 · age-learning).
 *    일반 개정(supersedes)은 draft.md 가 있으면 교체하지 않는다(DRAFT_EXISTS). 이미 회수·QA 를 지난 원고에
 *    글별 주제 금지 패턴과 새 공개 시각만 더하려면 그 원고를 **고정**해야 한다 — 승인 entry 가 `safetyRevision.draftHash`
 *    (원고 바이트 sha256)를 싣는다. 바뀌어도 되는 것은 spec 판 · 주제 패턴 · publishAt · specHash 뿐이고,
 *    새 패턴이 고정한 원고에 하나라도 걸리면 승인 · 큐 · spec 교체 모두 0 이다. 원고는 지우지도 고치지도 않는다.
 */
export function safetyRevisionProblem(entry) {
  const s = entry?.safetyRevision
  if (s === undefined) return null
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).join(',') !== 'draftHash' || !SHA256_RE.test(s.draftHash)) return 'SAFETY_REVISION_INVALID'
  if (!entry.supersedes) return 'SAFETY_REVISION_INVALID'
  return null
}
/** 원고 바이트의 고정값 — `sha256:<hex>` */
export const draftHashOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
/** 안전 개정이 old → new spec 에서 바꿀 수 있는 자리 — 그 밖은 하나라도 다르면 거부 */
export const SAFETY_REVISION_SPEC_PATHS = Object.freeze(['schemaVersion', 'safety.topicForbiddenPatterns', 'publication.publishAt', 'specHash'])
/** 안전 개정이 기존 승인 entry 에서 바꿀 수 있는 자리 — 승인 기록 · 개정 표식 · 패턴 · publishAt 뿐 */
export const SAFETY_REVISION_ENTRY_PATHS = Object.freeze(['approvedBy', 'approvedAt', 'sourceHash', 'supersedes', 'safetyRevision', 'node.forbiddenPatterns', 'publication.publishAt'])
/** 객체만 펼친다 — 배열 · 값은 잎(canonical)으로 본다. 개정 표식은 객체째 잎으로 본다 */
function leaves(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value) && prefix !== 'supersedes' && prefix !== 'safetyRevision') {
    for (const k of Object.keys(value)) leaves(value[k], prefix ? `${prefix}.${k}` : k, out)
  } else out[prefix] = canonicalJson(value ?? null)
  return out
}
function driftOutside(a, b, allowed) {
  const x = leaves(a)
  const y = leaves(b)
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => !allowed.includes(k) && x[k] !== y[k]).sort()
}
/** old → new spec 에서 허용 밖으로 바뀐 경로 — 새 spec 은 spec/2 여야 한다 */
export function safetyRevisionSpecDrift(oldSpec, newSpec) {
  const drift = driftOutside(oldSpec, newSpec, SAFETY_REVISION_SPEC_PATHS)
  if (newSpec?.schemaVersion !== ARTICLE_SPEC_SCHEMA_V2) drift.push('schemaVersion')
  return drift
}
/** 기존 승인 entry → 안전 개정 entry 에서 허용 밖으로 바뀐 경로 (title · plan · relations · hero · admission · node · productBasis …) */
export function safetyRevisionEntryDrift(baseEntry, nextEntry) {
  return driftOutside(baseEntry, nextEntry, SAFETY_REVISION_ENTRY_PATHS)
}
/** 고정한 원고에 걸리는 주제 패턴 — batch QA 와 같은 판정(judgeForbidden) */
export function draftTopicViolations(draftText, patterns) {
  return judgeForbidden(String(draftText ?? ''), Array.isArray(patterns) ? patterns : []).violations.map((v) => v.pattern)
}
/** 옛 spec 보존 이름 — `article-spec.superseded-<old hex>.json` (같은 폴더) */
export const supersededSpecName = (oldSpecHash) => `article-spec.superseded-${String(oldSpecHash).replace(/^sha256:/, '')}.json`
/** 같은 글의 개정이라고 볼 신원 — 제목 · 공개 시각 · 본문 계획은 바뀔 수 있다 */
export const SUPERSEDE_IDENTITY_KEYS = Object.freeze(['slug', 'intentId', 'graphNodeId', 'graphVersion', 'cluster', 'admissionManifestHash'])
/**
 * 🔴 **source 판** (2026-10-28 · 글별 주제 금지 패턴).
 *    source/3 — 승인 entry 가 사람이 정한 `node.forbiddenPatterns` 를 반드시 싣는다 → spec/2. authoring 이 쓰는 판이다.
 *    source/2 — 패턴이 없는 옛 판. 읽기만 한다 → spec/1(바이트 그대로). 운영 디스크의 옛 spec 과 그 개정(supersedes)을 위해 남긴다.
 *    source/2 spec 은 batch QA 에서 DIRECT_TOPIC_PATTERNS_ABSENT 로 막힌다 — 글별 주제 위험을 대신할 것이 없다.
 */
export const DIRECT_SPEC_SOURCE_SCHEMA_V2 = 'magazine-article-spec-source/2'
export const DIRECT_SPEC_SOURCE_SCHEMA = 'magazine-article-spec-source/3'
export const DIRECT_SPEC_SOURCE_SCHEMAS = Object.freeze([DIRECT_SPEC_SOURCE_SCHEMA_V2, DIRECT_SPEC_SOURCE_SCHEMA])
/** source/3 의 글별 주제 금지 패턴 자리 — 자연어 지침(node.safetyConstraints)과 다르다 */
export const TOPIC_PATTERNS_FIELD = 'node.forbiddenPatterns'
export const DIRECT_SPEC_SOURCE_DIRNAME = 'article-spec-source'
/** canary 는 STANDARD 한 프로필만 연다 */
export const DIRECT_SPEC_CANARY_PROFILE = 'STANDARD'

/** ArticlePlan — 사람이 정하고 승인하는 큐 필드. 허용값은 topic-queue.ts 의 union 이다 */
export const ARTICLE_PLAN_REQUIRED = Object.freeze([
  'title', 'contentType', 'intent', 'target', 'riskLevel', 'validationProfile', 'reviewMode', 'ctaBoard', 'whyNow', 'notes', 'imageMode',
])
export const ARTICLE_PLAN_OPTIONAL = Object.freeze(['season', 'calendarEvent', 'publishWindow', 'seriesId', 'seriesOrder'])
/** 승인 entry 가 싣는 연구 G8 receipt 신원 */
export const ADMISSION_FIELDS = Object.freeze(['g8ManifestHash', 'receiptHash', 'graphVersion', 'readinessHash'])

/**
 * compileArticleSpec 이 source entry 에서 읽는 필드 + 승인 plan · admission — 하나라도 비면 NOT_READY 다.
 */
export const DIRECT_SPEC_REQUIRED_FIELDS = Object.freeze([
  'node.id', 'node.intentId', 'node.slug', 'node.status', 'node.graphVersion',
  'node.readerQuestion', 'node.scope.include', 'node.scope.exclude', 'node.outline',
  'node.evidence.factsToVerify', 'node.evidence.sourceRequirements', 'node.safetyConstraints',
  'node.hubPath', 'node.ctaLabel',
  'relations.direct', 'relations.discovery', 'publication.publishAt',
  ...ARTICLE_PLAN_REQUIRED.map((k) => `plan.${k}`),
  ...ADMISSION_FIELDS.map((k) => `admission.${k}`),
])

/**
 * 🔴 **queue 행의 복제 필드** — 승인 plan(또는 승인 entry)에서 나오고, 소비 시점에 하나씩 다시 맞춘다.
 *    slug · intentId 는 entry 조회 신원(SOURCE_ENTRY_ABSENT)이고, g8ManifestHash · articlePlanHash 는
 *    전용 사유(MANIFEST_DRIFT · ARTICLE_PLAN_HASH_DRIFT)로 본다 — 여기에 넣지 않는다.
 *    선택 필드는 **키 존재 여부까지** 같아야 한다(승인에 없는 seriesId 를 손으로 더해도 drift).
 */
export const QUEUE_REPLICA_FIELDS = Object.freeze([
  'title', 'contentType', 'intent', 'cluster', 'target', 'validationProfile', 'riskLevel', 'reviewMode', 'imageMode',
  'autoEligible', 'seriesId', 'seriesOrder', 'season', 'calendarEvent', 'publishWindow', 'ctaBoard', 'internalLinks',
  'whyNow', 'notes', 'directSpecMode',
])

/**
 * 승인 relations 의 대상 slug — direct 순서 다음 discovery 순서, **중복만** 뺀다. 개수로 자르지 않는다.
 */
export function internalLinksOf(relations) {
  const discovery = Array.isArray(relations?.discovery) ? relations.discovery : (relations?.discovery ? [relations.discovery] : [])
  const out = []
  for (const r of [...(Array.isArray(relations?.direct) ? relations.direct : []), ...discovery]) {
    if (typeof r?.slug === 'string' && !out.includes(r.slug)) out.push(r.slug)
  }
  return out
}

/**
 * 🔴 **승인 entry → topic-queue 행** — materialize 와 소비 관문이 같은 함수로 만든다.
 *    키 순서는 TopicQueueItem 순서로 고정한다(렌더 바이트 결정적). day 는 호출자가 큐 lock 안에서 정한다.
 *    cluster 는 승인 basis 의 sourceCluster(제품 graph intent cluster)다.
 */
export function queueRowFromEntry(entry, { day }) {
  const p = entry?.plan ?? {}
  const opt = (k) => (p[k] === undefined || p[k] === null ? {} : { [k]: p[k] })
  return {
    day,
    slug: entry?.node?.slug,
    title: p.title,
    contentType: p.contentType,
    intent: p.intent,
    cluster: entry?.productBasis?.sourceCluster,
    target: p.target,
    validationProfile: p.validationProfile,
    riskLevel: p.riskLevel,
    reviewMode: p.reviewMode,
    imageMode: p.imageMode,
    autoEligible: true,
    ...opt('seriesId'),
    ...opt('seriesOrder'),
    ...opt('season'),
    ...opt('calendarEvent'),
    ...opt('publishWindow'),
    ctaBoard: p.ctaBoard,
    internalLinks: internalLinksOf(entry?.relations),
    whyNow: p.whyNow,
    notes: p.notes,
    intentId: entry?.node?.intentId,
    g8ManifestHash: entry?.admission?.g8ManifestHash,
    directSpecMode: DIRECT_SPEC_MODE,
    articlePlanHash: entry?.sourceHash,
  }
}

/** queue 행이 승인 entry 의 복제와 다른 필드 — 없으면 [] · day 는 양의 정수인지만 본다 */
export function queueDriftOf(queueItem, entry) {
  const want = queueRowFromEntry(entry, { day: queueItem?.day })
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o ?? {}, k) && o[k] !== undefined
  const drift = QUEUE_REPLICA_FIELDS.filter((k) => has(want, k) !== has(queueItem, k) || canonicalJson(want[k] ?? null) !== canonicalJson(queueItem?.[k] ?? null))
  if (!Number.isInteger(queueItem?.day) || queueItem.day <= 0) drift.push('day')
  return drift
}

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

/** entry 의 sourceHash — 자기 자신을 뺀 canonical JSON 의 해시 */
export function directSpecSourceHash(entry) {
  const { sourceHash: _omit, ...body } = entry ?? {}
  return sha256(canonicalJson(body))
}

export function directSpecSourcePath(draftsDir, graphVersion) {
  return join(draftsDir, DIRECT_SPEC_SOURCE_DIRNAME, `${graphVersion}.json`)
}

/**
 * 제품이 지금 서빙하는 graphVersion — `current.ts` 의 re-export 대상에서 읽는다.
 * 읽지 못하면 null (호출자가 NOT_READY 로 막는다). 추정하지 않는다.
 */
export function readProductGraphVersion(currentTsPath) {
  let src
  try { src = readFileSync(currentTsPath, 'utf8') } catch { return null }
  const m = src.match(/^export \{ GRAPH, EXPORT_HASH \} from '\.\/(g-\d{8}-[0-9a-f]{6})'$/m)
  return m ? m[1] : null
}

const PRODUCT_GRAPH = {
  current: 'src/content/magazine/graph/current.ts',
  control: 'src/content/magazine/graph/control.ts',
  resolver: 'src/lib/magazine-graph.ts',
}
/** discovery 자리는 BRIDGE 관계만 채운다 — 제품 resolver 의 규칙 */
export const DISCOVERY_RELATION_TYPE = 'BRIDGE'

/** 제품 소스의 문자열 배열 상수 — `export const NAME = ['A', 'B'] as const` */
function readStringArray(text, name) {
  const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`).exec(text)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/**
 * control.ts 의 `export const CONTROL = {…}` 를 **구조 파서**(sliceLiteral + evalLiteral)로 읽는다.
 * 🔴 정상 TypeScript 리터럴(여러 줄 · 끝 쉼표 · 주석)은 한 줄 판과 같은 값으로 읽고,
 *    파싱 불가 · 필드 누락 · 형식 오류는 **던지지 않고** null 이다 — 호출자가 PRODUCT_BASIS_UNREADABLE 로 막는다.
 */
export function parseGraphControl(controlText) {
  const anchor = String(controlText ?? '').indexOf('export const CONTROL')
  if (anchor === -1) return null
  const literal = sliceLiteral(controlText, controlText.indexOf('=', anchor), '{', '}')
  if (!literal) return null
  let raw
  try { raw = evalLiteral(literal, 'control.ts') } catch { return null }
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!isPlain(raw)) return null
  const { graphVersion, enabled, enabledClusters, surfaces, killSwitch } = raw
  if (typeof graphVersion !== 'string' || !graphVersion.trim()) return null
  if (typeof enabled !== 'boolean') return null
  if (!Array.isArray(enabledClusters) || !enabledClusters.every((c) => typeof c === 'string' && c.trim())) return null
  if (!isPlain(surfaces) || !Object.values(surfaces).every((v) => typeof v === 'boolean')) return null
  if (!isPlain(killSwitch) || typeof killSwitch.tripped !== 'boolean') return null
  // 🔴 격리 컨텍스트의 객체를 이 컨텍스트의 평범한 값으로 옮긴다
  return {
    graphVersion,
    enabled,
    enabledClusters: [...enabledClusters],
    surfaces: Object.fromEntries(Object.entries(surfaces)),
    killSwitch: { tripped: killSwitch.tripped },
  }
}

/**
 * graph bundle 의 구조 — basis 계산과 관계 판정이 실제로 쓰는 필드만, **던지지 않고** 검증한다.
 * 🔴 JSON 문법이 맞고 EXPORT_HASH 까지 맞아도 intents 가 null·누락·잘못된 원소면 판독 실패다.
 */
export function graphBundleShapeOk(graph) {
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!isPlain(graph)) return false
  if (typeof graph.graphVersion !== 'string' || !graph.graphVersion.trim()) return false
  if (!isPlain(graph.contentHash)) return false
  if (!Array.isArray(graph.intents) || !graph.intents.every((i) => isPlain(i) && typeof i.id === 'string' && i.id.trim()
    && (i.cluster === null || (typeof i.cluster === 'string' && i.cluster.trim())))) return false
  if (!Array.isArray(graph.edges) || !graph.edges.every(isPlain)) return false
  if (!Array.isArray(graph.mappings) || !graph.mappings.every(isPlain)) return false
  return true
}

/**
 * 🔴 **제품 M-GRAPH 판 판독 — authoring 과 소비 관문이 같이 쓰는 하나뿐인 구현.**
 *    current.ts → bundle(EXPORT_HASH 재계산) · control.ts · resolver(구현 surface · 관계 type).
 * @returns {{ok:true, pointer, graph, exportHash, recomputedExportHash, control, implemented, footer, relationTypes, surfaces, blockers}
 *          |{ok:false, code:string, why:string}}
 */
export function readProductGraphState(productRoot) {
  const read = (rel) => { try { return readFileSync(join(productRoot, rel), 'utf8') } catch { return null } }
  const current = read(PRODUCT_GRAPH.current)
  const m = current && /^export \{ GRAPH, EXPORT_HASH \} from '\.\/(g-[a-z0-9-]+)'$/m.exec(current)
  if (!m) return { ok: false, code: 'GRAPH_POINTER_UNREADABLE', why: 'current.ts 가 가리키는 판을 찾지 못했다' }
  const pointer = m[1]
  const bundleText = read(join(dirname(PRODUCT_GRAPH.current), `${pointer}.ts`))
  const literal = bundleText && sliceLiteral(bundleText, bundleText.indexOf('=', bundleText.indexOf('export const GRAPH')), '{', '}')
  if (!literal) return { ok: false, code: 'GRAPH_BUNDLE_UNREADABLE', why: 'bundle 의 GRAPH 리터럴을 찾지 못했다' }
  let graph
  try { graph = JSON.parse(literal) } catch { return { ok: false, code: 'GRAPH_BUNDLE_UNREADABLE', why: 'bundle 의 GRAPH 리터럴을 파싱하지 못했다' } }
  if (!graphBundleShapeOk(graph)) return { ok: false, code: 'GRAPH_BUNDLE_UNREADABLE', why: 'bundle 의 GRAPH 구조(graphVersion·contentHash·intents·edges·mappings)가 다르다' }
  const exportHash = /export const EXPORT_HASH = '([0-9a-f]+)'/.exec(bundleText)?.[1] ?? null
  const recomputedExportHash = createHash('sha256').update(JSON.stringify(graph)).digest('hex').slice(0, 16)
  const controlText = read(PRODUCT_GRAPH.control)
  const resolverText = read(PRODUCT_GRAPH.resolver)
  if (!controlText || !resolverText) return { ok: false, code: 'GRAPH_CONTROL_UNREADABLE', why: 'control.ts 또는 magazine-graph.ts 를 읽지 못했다' }
  const control = parseGraphControl(controlText)
  if (!control) return { ok: false, code: 'GRAPH_CONTROL_UNREADABLE', why: 'control.ts 의 CONTROL 을 읽지 못했거나 필드가 없거나 형식이 다르다' }
  const implemented = readStringArray(resolverText, 'IMPLEMENTED_SURFACES') ?? []
  const footer = readStringArray(resolverText, 'FOOTER_SURFACES') ?? []
  const relationTypes = readStringArray(resolverText, 'MAGAZINE_RELATION_TYPES') ?? []
  const blockers = []
  if (graph.graphVersion !== pointer) blockers.push('GRAPH_VERSION_MISMATCH')
  if (!exportHash || exportHash !== recomputedExportHash) blockers.push('GRAPH_EXPORT_HASH_MISMATCH')
  if (control.graphVersion !== pointer) blockers.push('GRAPH_CONTROL_VERSION_MISMATCH')
  if (!control.enabled) blockers.push('GRAPH_CONTROL_DISABLED')
  if (control.killSwitch?.tripped !== false) blockers.push('GRAPH_KILL_SWITCH_TRIPPED')
  if (!implemented.length || !footer.length || !relationTypes.length) blockers.push('GRAPH_SURFACE_CONTRACT_UNREADABLE')
  // 🔴 direct·discovery 관계가 실제로 보이는 자리 = 구현된 footer surface ∩ control 에서 켠 surface
  const surfaces = footer.filter((x) => implemented.includes(x) && control.surfaces?.[x] === true)
  return { ok: true, pointer, graph, exportHash, recomputedExportHash, control, implemented, footer, relationTypes, surfaces, blockers }
}

/**
 * 승인 entry 에 싣고 소비 시점에 다시 맞추는 **정본 basis**. canonical — 순서가 의미 없는 목록은 정렬한다.
 * sourceCluster = 제품 graph intent 의 cluster, 없으면 큐 행 cluster.
 */
export function productBasisFor(state, { intentId, queueCluster = null }) {
  const sourceCluster = state.graph.intents.find((i) => i.id === intentId)?.cluster ?? queueCluster ?? null
  const sortedSurfaces = Object.fromEntries(Object.keys(state.control.surfaces ?? {}).sort().map((k) => [k, state.control.surfaces[k] === true]))
  return {
    graphVersion: state.pointer,
    exportHash: state.exportHash,
    control: {
      graphVersion: state.control.graphVersion,
      enabled: state.control.enabled,
      killSwitchTripped: state.control.killSwitch?.tripped !== false,
      enabledClusters: [...state.control.enabledClusters].sort(),
      surfaces: sortedSurfaces,
    },
    sourceCluster,
    relationContract: {
      implementedSurfaces: [...state.implemented].sort(),
      footerSurfaces: [...state.footer].sort(),
      enabledRelationSurfaces: [...state.surfaces].sort(),
      relationTypes: [...state.relationTypes].sort(),
      discoveryType: DISCOVERY_RELATION_TYPE,
    },
  }
}

/** 소비 시점의 현재 basis — 판독 실패·판 자체 결함이면 **던지지 않고** ok:false / PRODUCT_BASIS_UNREADABLE */
export function currentProductBasis(productRoot, { intentId, queueCluster = null }) {
  const state = readProductGraphState(productRoot)
  if (!state.ok) return { ok: false, code: 'PRODUCT_BASIS_UNREADABLE', why: `${state.code}: ${state.why}` }
  if (state.blockers.some((b) => ['GRAPH_VERSION_MISMATCH', 'GRAPH_EXPORT_HASH_MISMATCH', 'GRAPH_SURFACE_CONTRACT_UNREADABLE'].includes(b))) {
    return { ok: false, code: 'PRODUCT_BASIS_UNREADABLE', why: `제품 graph 판이 깨졌다: ${state.blockers.join(',')}` }
  }
  return { ok: true, basis: productBasisFor(state, { intentId, queueCluster }) }
}

/** 🔴 hero 계약 — NO_IMAGE 만 hero=null. REQUIRED · OPTIONAL 은 자동 레인이 hero 를 만들어야 하므로 alt·scene 필수 */
export function heroRequired(imageMode) {
  return imageMode === 'REQUIRED' || imageMode === 'OPTIONAL'
}

function valueAt(obj, path) {
  let cur = obj
  for (const key of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

function isPresent(value, path) {
  // 🔴 관계 수량은 공용 정책 하나로 본다 — direct 2~3 · discovery 단일 객체
  if (path === 'relations.direct') return Array.isArray(value) && isValidDirectCount(value.length)
  if (path === 'relations.discovery') return isSingleDiscovery(value)
  if (path === 'node.outline') return Array.isArray(value) && value.filter((v) => String(v ?? '').trim()).length >= 3
  if (Array.isArray(value)) return value.some((v) => String(v ?? '').trim())
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return String(value ?? '').trim() !== ''
}

/**
 * 🔴 hero 는 큐의 imageMode 가 정한다 — `heroRequired` 하나가 계약이다(authoring 도 이것만 쓴다).
 *    REQUIRED · OPTIONAL → hero.alt · hero.scene 필수 · NO_IMAGE → 둘 다 금지.
 * 🔴 source/3 이면 글별 주제 금지 패턴(`node.forbiddenPatterns`)도 필수다 — 빈 배열은 없는 것이다.
 */
export function missingSourceFields(entry, queueItem = null, { schema = DIRECT_SPEC_SOURCE_SCHEMA } = {}) {
  const missing = DIRECT_SPEC_REQUIRED_FIELDS.filter((path) => !isPresent(valueAt(entry, path), path))
  if (heroRequired(queueItem?.imageMode)) {
    for (const path of ['hero.alt', 'hero.scene']) if (!isPresent(valueAt(entry, path), path)) missing.push(path)
  }
  if (schema === DIRECT_SPEC_SOURCE_SCHEMA && !isPresent(valueAt(entry, TOPIC_PATTERNS_FIELD), TOPIC_PATTERNS_FIELD)) missing.push(TOPIC_PATTERNS_FIELD)
  return missing
}

function heroForbidden(entry, queueItem) {
  return queueItem?.imageMode === 'NO_IMAGE'
    && (isPresent(entry?.hero?.alt, 'hero.alt') || isPresent(entry?.hero?.scene, 'hero.scene'))
}

/**
 * direct 행 하나의 source 준비 상태를 판정한다. **던지지 않는다.**
 *
 * @returns {{ok:true, input:object, spec:object, evidence:object}
 *          |{ok:false, code:'DIRECT_SPEC_SOURCE_NOT_READY', why:string, evidence:object}}
 *   evidence = { mode, slug, intentId, expectedGraphVersion, observedGraphVersion, sourcePath,
 *                approvalStatus, missingFields, blockers, g8ManifestHash, sourceHash, queueDrift }
 *
 * 🔴 **ArticleSpec 직전 관문이다** — compileArticleSpec 전에 G8 행 계약(G8_ROW_NOT_DIRECT) ·
 *    articlePlanHash(ARTICLE_PLAN_HASH_DRIFT) · queue 복제 필드(SOURCE_QUEUE_DRIFT)를 다시 본다.
 */
export function judgeDirectSpecSource({ queueItem, draftsDir, expectedGraphVersion, repoRoot = null, productRoot = null, readFile = (p) => readFileSync(p, 'utf8'), exists = existsSync }) {
  const blockers = []
  const slug = queueItem?.slug ?? null
  const intentId = queueItem?.intentId ?? null
  const sourcePath = expectedGraphVersion ? directSpecSourcePath(draftsDir, expectedGraphVersion) : null
  const evidence = {
    mode: DIRECT_SPEC_MODE,
    slug,
    intentId,
    expectedGraphVersion: expectedGraphVersion ?? null,
    observedGraphVersion: null,
    sourcePath: sourcePath ? (repoRoot ? relative(repoRoot, sourcePath) : sourcePath) : null,
    approvalStatus: null,
    missingFields: [...DIRECT_SPEC_REQUIRED_FIELDS],
    blockers,
    g8ManifestHash: queueItem?.g8ManifestHash ?? null,
    sourceHash: null,
    queueDrift: [],
  }
  const notReady = (why) => ({ ok: false, code: DIRECT_SPEC_SOURCE_NOT_READY, why, evidence })

  if (!expectedGraphVersion) {
    blockers.push('PRODUCT_GRAPH_VERSION_UNREADABLE')
    return notReady('제품 graphVersion 을 읽지 못했다 — 어떤 source 도 현재 판으로 인정할 수 없다')
  }
  if (!intentId || !queueItem?.g8ManifestHash || !queueItem?.articlePlanHash) blockers.push('QUEUE_NOT_G8_ADMITTED')
  if (g8RowProblem(queueItem)) blockers.push(G8_ROW_NOT_DIRECT)
  const lane = isAutoLaneEligible(queueItem ?? {})
  if (!lane.ok || lane.profile !== DIRECT_SPEC_CANARY_PROFILE) blockers.push('PROFILE_NOT_STANDARD')

  if (!exists(sourcePath)) {
    blockers.push('SOURCE_ABSENT')
    return notReady(`승인 source artifact 가 없다 (${evidence.sourcePath})`)
  }
  let doc
  try { doc = JSON.parse(readFile(sourcePath)) } catch {
    blockers.push('SOURCE_UNREADABLE')
    return notReady('source artifact 를 읽거나 파싱하지 못했다')
  }
  if (!DIRECT_SPEC_SOURCE_SCHEMAS.includes(doc?.schema)) blockers.push('SOURCE_SCHEMA_UNKNOWN')
  const sourceV3 = doc?.schema === DIRECT_SPEC_SOURCE_SCHEMA
  evidence.observedGraphVersion = typeof doc?.graphVersion === 'string' ? doc.graphVersion : null
  if (evidence.observedGraphVersion !== expectedGraphVersion) blockers.push('GRAPH_VERSION_STALE')

  const entries = Array.isArray(doc?.entries) ? doc.entries : []
  const matches = entries.filter((e) => e?.node?.intentId === intentId && e?.node?.slug === slug)
  if (matches.length !== 1) {
    blockers.push(matches.length ? 'SOURCE_ENTRY_DUPLICATE' : 'SOURCE_ENTRY_ABSENT')
    return notReady(`source 에 이 행(${slug} · ${intentId})의 entry 가 정확히 하나가 아니다 (${matches.length}개)`)
  }
  const entry = matches[0]
  evidence.supersedes = entry.supersedes ?? null
  evidence.safetyRevision = entry.safetyRevision ?? null
  evidence.approvalStatus = typeof entry.status === 'string' ? entry.status : null
  evidence.sourceHash = typeof entry.sourceHash === 'string' ? entry.sourceHash : null
  evidence.missingFields = missingSourceFields(entry, queueItem, { schema: doc.schema })
  // 🔴 source/2 판에 패턴이 끼어 있으면 판과 내용이 어긋난다 — 조용히 spec/1 로 버리지도, spec/2 로 올리지도 않는다
  if (!sourceV3 && valueAt(entry, TOPIC_PATTERNS_FIELD) !== undefined) blockers.push('SOURCE_SCHEMA_FIELD_MISMATCH')

  if (entry.status !== 'APPROVED' || entry.node?.status !== 'APPROVED' || !String(entry.approvedBy ?? '').trim() || !String(entry.approvedAt ?? '').trim()) {
    blockers.push('NOT_APPROVED')
  }
  if (entry.node?.graphVersion !== expectedGraphVersion || entry.admission?.graphVersion !== expectedGraphVersion) blockers.push('GRAPH_VERSION_STALE')
  if (entry.sourceHash !== directSpecSourceHash(entry)) blockers.push('SOURCE_HASH_DRIFT')
  if (supersedesProblem(entry)) blockers.push('SUPERSEDES_INVALID')
  // 🔴 원고 보존형 안전 개정은 source/3(패턴 필수)에서만 — 형식이 어긋나면 일반 개정으로 묻어 보내지 않는다
  if (safetyRevisionProblem(entry)) blockers.push('SAFETY_REVISION_INVALID')
  if (entry.safetyRevision !== undefined && !sourceV3) blockers.push('SOURCE_SCHEMA_FIELD_MISMATCH')
  if (entry.admission?.g8ManifestHash !== queueItem?.g8ManifestHash) blockers.push('MANIFEST_DRIFT')
  // 🔴 articlePlanHash 는 승인 entry 의 sourceHash 하나다 — 큐 행이 다른 승인(또는 위조 해시)을 가리키면 쓰지 않는다
  if (queueItem?.articlePlanHash !== entry.sourceHash) blockers.push('ARTICLE_PLAN_HASH_DRIFT')
  evidence.queueDrift = queueDriftOf(queueItem, entry)
  if (evidence.queueDrift.length) blockers.push('SOURCE_QUEUE_DRIFT')
  if (evidence.missingFields.length) blockers.push('FIELDS_MISSING')
  if (heroForbidden(entry, queueItem)) blockers.push('HERO_FORBIDDEN')
  // 🔴 승인한 M-GRAPH 판(productBasis)이 지금 제품 판과 정확히 같아야 한다
  if (!productRoot) blockers.push('PRODUCT_BASIS_UNVERIFIED')
  else {
    const cur = currentProductBasis(productRoot, { intentId, queueCluster: queueItem?.cluster ?? null })
    if (!cur.ok) blockers.push('PRODUCT_BASIS_UNREADABLE')
    else {
      const b = cur.basis
      if (!entry.productBasis || typeof entry.productBasis !== 'object') blockers.push('PRODUCT_BASIS_MISSING')
      else if (canonicalJson(entry.productBasis) !== canonicalJson(b)) blockers.push('PRODUCT_BASIS_DRIFT')
      if (b.graphVersion !== expectedGraphVersion) blockers.push('PRODUCT_BASIS_DRIFT')
      if (!b.control.enabled || b.control.killSwitchTripped || !b.control.enabledClusters.includes(b.sourceCluster)) blockers.push('PRODUCT_BASIS_INACTIVE')
    }
  }

  const unique = [...new Set(blockers)]
  blockers.length = 0
  blockers.push(...unique)
  if (blockers.length) return notReady(`source 가 준비되지 않았다: ${blockers.join(', ')}`)

  const input = {
    node: entry.node,
    queueItem: { ...queueItem, validationProfile: lane.profile },
    relations: entry.relations,
    publication: entry.publication,
    hero: entry.hero ?? null,
    // 🔴 source/3 만 spec/2 를 만든다 — 판이 정한다, 값의 유무로 추측하지 않는다
    ...(sourceV3 ? { topicForbiddenPatterns: entry.node.forbiddenPatterns } : {}),
  }
  let spec
  try { spec = compileArticleSpec(input) } catch (e) {
    blockers.push('COMPILE_FAILED')
    return notReady(`compileArticleSpec 가 거부했다 (${e?.code ?? 'ARTICLE_SPEC_INPUT'})`)
  }
  const v = verifyArticleSpec(spec)
  if (!v.ok) {
    blockers.push('VERIFY_FAILED')
    return notReady(`verifyArticleSpec 가 거부했다 (${v.code})`)
  }
  return { ok: true, input, spec, evidence }
}

const specBytes = (spec) => `${JSON.stringify(spec, null, 2)}\n`

/**
 * 디스크의 article-spec.json 이 지금 source 로 컴파일한 spec 과 **같은 바이트**인가.
 * @returns {{state:'ABSENT'|'IDENTICAL'|'CONFLICT', path:string, why?:string}}
 */
export function existingSpecState({ spec, draftsDir }) {
  const path = join(draftsDir, spec.identity.slug, ARTICLE_SPEC_FILENAME)
  if (!existsSync(path)) return { state: 'ABSENT', path }
  let prev
  try { prev = readFileSync(path, 'utf8') } catch (e) {
    return { state: 'CONFLICT', path, why: `기존 spec 을 읽지 못했다 (${e.code ?? e.message})` }
  }
  if (prev === specBytes(spec)) return { state: 'IDENTICAL', path }
  return { state: 'CONFLICT', path, why: '기존 article-spec.json 이 현재 승인 source 로 컴파일한 spec 과 다르다 — 덮어쓰지도 재사용하지도 않는다' }
}

/**
 * 🔴 **direct 행을 지금 진행해도 되는가** — 선정 · 재사용 · 등록이 모두 이 함수 하나로 본다.
 *    현재 승인 source 가 준비돼 있고, 디스크 spec 이 있으면 그 바이트가 source 컴파일 결과와 같아야 한다.
 *    source 부재·stale·승인 취소·hash drift → DIRECT_SPEC_SOURCE_NOT_READY · 다른 spec → DIRECT_SPEC_SPEC_CONFLICT.
 *
 * @returns {{ok:true, judged:object, spec:object, evidence:object, existing:'ABSENT'|'IDENTICAL'}
 *          |{ok:false, code:string, why:string, evidence:object}}
 */
export function verifyDirectSpecIdentity({ queueItem, draftsDir, expectedGraphVersion, repoRoot = null, productRoot = null }) {
  const judged = judgeDirectSpecSource({ queueItem, draftsDir, expectedGraphVersion, repoRoot, productRoot })
  if (!judged.ok) return judged
  const existing = existingSpecState({ spec: judged.spec, draftsDir })
  if (existing.state === 'CONFLICT') {
    const declared = judged.evidence?.supersedes?.specHash ?? null
    if (declared) {
      const disk = diskSpecHash(existing.path)
      const supersede = { oldSpecHash: disk, declaredSpecHash: declared, newSpecHash: judged.spec.specHash }
      if (disk === declared) {
        return { ok: false, code: DIRECT_SPEC_SUPERSEDE_REQUIRED, judged, supersede, evidence: { ...judged.evidence, supersede },
          why: `승인이 디스크 spec(${disk.slice(0, 15)}…)을 명시적으로 대체한다 — producer 가 lease 안에서 교체하기 전에는 진행하지 않는다` }
      }
      return { ok: false, code: DIRECT_SPEC_SUPERSEDE_MISMATCH, supersede, evidence: { ...judged.evidence, supersede },
        why: `승인이 선언한 old specHash(${declared.slice(0, 15)}…)가 디스크 spec(${String(disk).slice(0, 15)}…)과 다르다 — 덮어쓰지 않는다` }
    }
    return { ok: false, code: DIRECT_SPEC_SPEC_CONFLICT, why: existing.why, evidence: judged.evidence }
  }
  return { ok: true, judged, spec: judged.spec, evidence: judged.evidence, existing: existing.state }
}

/**
 * 🔴 **이미 디스크에 있는 direct spec 으로 진행해도 되는가** — 등록 gate 와 실제 전송 경계(deliveryGate)가 같이 쓴다.
 *    호출자가 들고 온 행(run.json 행에는 compile 재료가 없다)이 아니라 **정본 큐 행**으로 다시 컴파일하고,
 *    디스크 spec 바이트가 그 결과와 같아야 한다. 새 spec 을 쓰지 않는다.
 *    정본 큐에 없음 → DIRECT_SPEC_NOT_IN_QUEUE · opt-in 철회 → DIRECT_SPEC_MODE_WITHDRAWN ·
 *    source 부재/취소/stale/drift → DIRECT_SPEC_SOURCE_NOT_READY · 다른 spec → DIRECT_SPEC_SPEC_CONFLICT ·
 *    spec 없음 → DIRECT_SPEC_MISSING.
 */
export function verifyDirectSpecOnDisk({ slug, queue, draftsDir, expectedGraphVersion, repoRoot = null, productRoot = null }) {
  const canonical = (queue ?? []).find((q) => q?.slug === slug) ?? null
  if (!canonical) return { ok: false, code: 'DIRECT_SPEC_NOT_IN_QUEUE', why: `정본 큐에 ${slug} 가 없다 — 승인 신원을 다시 확인할 수 없다`, evidence: null }
  if (canonical[DIRECT_SPEC_OPT_IN_FIELD] !== DIRECT_SPEC_MODE) {
    return { ok: false, code: 'DIRECT_SPEC_MODE_WITHDRAWN', why: '정본 큐 행이 더는 DIRECT_SPEC_V1 이 아니다 — 저장된 spec 으로 보내지 않는다', evidence: null }
  }
  const v = verifyDirectSpecIdentity({ queueItem: canonical, draftsDir, expectedGraphVersion, repoRoot, productRoot })
  if (!v.ok) return v
  if (v.existing !== 'IDENTICAL') {
    return { ok: false, code: 'DIRECT_SPEC_MISSING', why: 'article-spec.json 이 없다 — 이 단계는 spec 을 새로 쓰지 않는다', evidence: v.evidence }
  }
  return v
}

/** DIRECT 글에 승인된 글별 주제 금지 패턴이 없다 — spec/1(source/2) 이거나 패턴이 비었다 */
export const DIRECT_TOPIC_PATTERNS_ABSENT = 'DIRECT_TOPIC_PATTERNS_ABSENT'

/**
 * 🔴 **DIRECT 글의 글별 주제 금지 패턴** — batch QA 가 review.ts 대신 읽는 단 하나의 정본.
 *    디스크 spec 을 읽고(없음 · 손상 · 자기검증 실패 → 그 코드) 정본 큐 행 · 현재 승인 source · 제품 판으로
 *    다시 컴파일한 spec 과 바이트까지 같을 때만(`verifyDirectSpecOnDisk`) 그 spec 의 패턴을 돌려준다.
 *    spec/1 이거나 패턴이 비면 DIRECT_TOPIC_PATTERNS_ABSENT 다 — 공통 목록 · 지침 문장으로 대신하지 않는다.
 * @returns {{ok:true, patterns:string[], specHash:string, schemaVersion:string}|{ok:false, code:string, why:string}}
 */
export function directTopicForbiddenPatterns({ slug, queue, draftsDir, expectedGraphVersion, productRoot }) {
  const disk = readDirectSpec({ slug, draftsDir })
  if (!disk.ok) return { ok: false, code: disk.code, why: disk.why }
  const v = verifyDirectSpecOnDisk({ slug, queue, draftsDir, expectedGraphVersion, productRoot })
  if (!v.ok) return { ok: false, code: v.code, why: v.why }
  const patterns = v.spec.safety?.topicForbiddenPatterns
  if (v.spec.schemaVersion !== ARTICLE_SPEC_SCHEMA_V2 || !Array.isArray(patterns) || patterns.length === 0) {
    return { ok: false, code: DIRECT_TOPIC_PATTERNS_ABSENT,
      why: `승인 ArticleSpec(${v.spec.schemaVersion})에 글별 주제 금지 패턴이 없다 — 공통 목록 · topicConstraints 로 대신하지 않는다 (source/3 승인 필요)` }
  }
  return { ok: true, patterns: [...patterns], specHash: v.spec.specHash, schemaVersion: v.spec.schemaVersion }
}

/** 디스크 spec 의 specHash — 읽기 · 파싱 · 자기검증이 모두 통과할 때만, 아니면 null */
function diskSpecHash(path) {
  try {
    const spec = JSON.parse(readFileSync(path, 'utf8'))
    return verifyArticleSpec(spec).ok ? spec.specHash : null
  } catch { return null }
}

/**
 * 🔴 **옛 spec 을 새 승인 spec 으로 교체해도 되는가** — 파일을 쓰지 않는다.
 *    ① 디스크 spec 이 성하고 specHash 가 승인이 선언한 supersedes.specHash 와 정확히 같다
 *    ② 신원(SUPERSEDE_IDENTITY_KEYS)이 새 spec 과 같다 — 다른 글 · 다른 판 · 다른 admission 은 개정이 아니다
 *    ③ draft.md 없음 · 등록 영수증 없음
 *    ④ 장부에 실제 전송 흔적 없음 — 전송 기록은 sent=false · fingerprint null · 예약 없음뿐, 응답 · 재생성 계보 0
 *       (전송 0 의 과거 회수 실패가 남긴 CONTENT attempts 는 전송 흔적이 아니다)
 * 🔴 **원고 보존형 안전 개정**(승인 entry 의 safetyRevision)이면 ③④ 대신:
 *    draft.md 가 있고 바이트 sha256 이 고정값과 같다 · 등록 영수증 없음 · 미정산 전송 예약 없음(정산된 과거 전송은 원고의 출처다) ·
 *    old → new spec 차이가 허용 경로(판 · 주제 패턴 · publishAt · specHash)뿐 · 새 패턴이 그 원고에 걸리지 않는다.
 * @returns {{ok:true, oldBytes:string, oldSpec:object, draftHash?:string}|{ok:false, problems:string[]}}
 */
export function judgeSupersession({ judged, draftsDir, slug, deliveryEntry = null }) {
  const problems = []
  const dir = join(draftsDir, slug)
  const path = join(dir, ARTICLE_SPEC_FILENAME)
  const declared = judged?.evidence?.supersedes?.specHash ?? null
  let oldBytes = null
  let oldSpec = null
  try { oldBytes = readFileSync(path, 'utf8'); oldSpec = JSON.parse(oldBytes) } catch { problems.push('OLD_SPEC_UNREADABLE') }
  if (oldSpec && !verifyArticleSpec(oldSpec).ok) problems.push('OLD_SPEC_INVALID')
  if (!declared || oldSpec?.specHash !== declared) problems.push('OLD_HASH_MISMATCH')
  const next = judged?.spec
  if (!next || oldSpec?.specHash === next.specHash) problems.push('SUPERSEDE_NOOP')
  if (oldSpec && next && SUPERSEDE_IDENTITY_KEYS.some((k) => oldSpec.identity?.[k] !== next.identity?.[k])) problems.push('IDENTITY_MISMATCH')
  if (next && next.identity?.slug !== slug) problems.push('IDENTITY_MISMATCH')
  const d = deliveryEntry?.delivery
  const safety = judged?.evidence?.safetyRevision ?? null
  if (!safety) {
    if (existsSync(join(dir, 'draft.md'))) problems.push('DRAFT_EXISTS')
  }
  if (existsSync(join(dir, ARTICLE_SPEC_REGISTER_LEDGER))) problems.push('REGISTERED')
  let draftHash = null
  if (safety) {
    let draft = null
    try { draft = readFileSync(join(dir, 'draft.md')) } catch { problems.push('DRAFT_MISSING') }
    if (draft) draftHash = draftHashOf(draft)
    if (draft && draftHash !== safety.draftHash) problems.push('DRAFT_CHANGED')
    if (oldSpec && next && safetyRevisionSpecDrift(oldSpec, next).length) problems.push('SAFETY_REVISION_DRIFT')
    if (draft && next && draftTopicViolations(draft.toString('utf8'), next.safety?.topicForbiddenPatterns).length) problems.push('DRAFT_PATTERN_VIOLATION')
    // 🔴 정산된 과거 전송은 이 원고의 출처다 — 막는 것은 아직 결말이 없는 예약 · 전송불명뿐이다
    if (d?.reservationId || d?.kind === 'DELIVERY_UNCERTAIN' || deliveryEntry?.sent === null) problems.push('DELIVERY_UNSETTLED')
  } else if ((d && (d.sent !== false || d.messageFingerprint || d.reservationId)) || deliveryEntry?.sent === true || deliveryEntry?.sent === null
    || deliveryEntry?.firstResponseInvalid || (deliveryEntry?.regenLineage?.calls ?? 0) > 0 || (deliveryEntry?.regenCalls ?? 0) > 0) {
    problems.push('DELIVERY_TRACE')
  }
  const unique = [...new Set(problems)]
  return unique.length ? { ok: false, problems: unique } : { ok: true, oldBytes, oldSpec, ...(safety ? { draftHash } : {}) }
}

/**
 * 🔴 **lease 를 지금도 내가 쥐고 있는가** — `lease.ok` 만 믿지 않는다. lease 파일의 token 이 내 token 이어야 한다.
 *    회수 경쟁 · 사람 정리로 잃었으면 false.
 */
function leaseHeld(lease) {
  if (!lease?.ok || !lease.lease || !lease.token) return false
  try { return JSON.parse(readFileSync(lease.lease, 'utf8'))?.token === lease.token } catch { return false }
}

/** 교체 중 고정 경로 — 다음 회차 복구 판정이 찾는 자리다 (soransoran 원고 폴더 안) */
export const SUPERSEDE_OWNED = 'article-spec.supersede-owned.json'
export const SUPERSEDE_TMP = 'article-spec.supersede-new.json'
/** 교체 조각이 남았고 자동으로 판정할 수 없다 — 아무것도 지우지 않고 HOLD (사람이 recovery 경로를 본다) */
export const DIRECT_SPEC_SUPERSEDE_RECOVERY_REQUIRED = 'DIRECT_SPEC_SUPERSEDE_RECOVERY_REQUIRED'
/** 남은 교체 조각 — 소유 사본 · tmp */
export function supersedeLeftovers({ draftsDir, slug }) {
  return [SUPERSEDE_OWNED, SUPERSEDE_TMP].filter((f) => existsSync(join(draftsDir, slug, f)))
}
const recoveryRequired = ({ problems, why, path, owned, tmp }) => ({
  ok: false, code: DIRECT_SPEC_SUPERSEDE_RECOVERY_REQUIRED, problems, why: `${why} (${problems.join(',')}) — 아무것도 지우지 않았다`,
  recovery: { canonical: path, canonicalExists: existsSync(path), owned, ownedExists: existsSync(owned), tmp, tmpExists: existsSync(tmp) },
})

/** 옛 spec 바이트를 보존 자리에 no-clobber 로 남긴다 — 이미 있으면 같은 바이트여야 한다. 다시 읽어 확인한다 */
function preserveOldSpec(archive, oldBytes) {
  if (!existsSync(archive)) {
    const tmp = `${archive}.tmp-${process.pid}`
    const fd = openSync(tmp, 'wx')
    try { writeSync(fd, oldBytes); fsyncSync(fd) } finally { closeSync(fd) }
    try { linkSync(tmp, archive) } catch (e) {
      if (e.code !== 'EEXIST') return { ok: false, why: `보존 자리를 만들지 못했다: ${e.message}` }
    } finally {
      try { unlinkSync(tmp) } catch { /* best effort */ }
    }
  }
  let kept = null
  try { kept = readFileSync(archive, 'utf8') } catch { kept = null }
  return kept === oldBytes ? { ok: true } : { ok: false, why: '보존 자리에 옛 spec 과 다른 바이트가 있다' }
}

/**
 * 🔴 **명시적 개정의 실행 — producer 가 manuscript lease 를 쥔 채로만 부른다.**
 *    ① 조건 판정(judgeSupersession) ② 옛 spec 을 `article-spec.superseded-<old>.json` 으로 no-clobber 보존
 *    ③ 읽은 바이트가 그대로인지 다시 보고(CAS) 새 spec 으로 원자 교체 ④ 다시 읽어 새 바이트인지 확인.
 *    경쟁 writer(③ 직전 · ④ 관측)가 있으면 **덮지도 되돌리지도 않고** 충돌로 멈춘다 — 보존본은 남긴다(복사본이라 해가 없다).
 *    같은 승인으로 다시 돌면 디스크가 이미 새 spec 이므로 이 함수까지 오지 않는다(IDENTICAL · 멱등).
 *    `hooks.beforeReplace` · `hooks.afterReplace` 는 시험 전용(경쟁 writer 주입)이다.
 * @returns {{ok:true, record:{superseded:true, oldSpecHash:string, newSpecHash:string, archive:string}}|{ok:false, code:string, why:string, problems:string[]}}
 */
export function supersedeDirectSpec({ judged, draftsDir, slug, deliveryEntry = null, lease = null, hooks = {} }) {
  const blocked = (problems, why) => ({ ok: false, code: DIRECT_SPEC_SUPERSEDE_BLOCKED, problems, why: `${why} (${problems.join(',')}) — 덮어쓰지 않았다` })
  if (!lease?.ok || !lease.lease || !lease.token) return blocked(['LEASE_REQUIRED'], '원고 lease 없이 spec 을 교체하지 않는다')
  const dir = join(draftsDir, slug)
  const path = join(dir, ARTICLE_SPEC_FILENAME)
  const owned = join(dir, SUPERSEDE_OWNED)
  const tmp = join(dir, SUPERSEDE_TMP)
  const recovery = (problems, why) => recoveryRequired({ problems, why, path, owned, tmp })
  // 🔴 앞 교체가 남긴 조각이 있으면 새 교체를 시작하지 않는다 — 복구 판정(recoverSupersession)이 먼저다
  if (supersedeLeftovers({ draftsDir, slug }).length) return recovery(['LEFTOVER'], '앞 교체의 소유 사본 · tmp 가 남아 있다')
  const j = judgeSupersession({ judged, draftsDir, slug, deliveryEntry })
  if (!j.ok) return blocked(j.problems, '명시적 개정 조건을 지키지 못했다')
  const oldSpecHash = j.oldSpec.specHash
  const archive = join(dir, supersededSpecName(oldSpecHash))
  // ② 보존 — 없으면 no-clobber 로 만들고, 있으면 같은 바이트여야 한다
  const kept = preserveOldSpec(archive, j.oldBytes)
  if (!kept.ok) return blocked(['ARCHIVE_CONFLICT'], kept.why)
  if (!leaseHeld(lease)) return blocked(['LOCK_LOST'], '교체 직전 원고 lease 소유권을 잃었다 — canonical spec 을 건드리지 않는다')
  hooks.beforeReplace?.({ path, lease })
  /**
   * ③ **배타 교체** (2026-10-26 · Codex P1 — CAS 확인과 rename 사이 경쟁 · 설치 실패 시 canonical 소실 · 급사).
   *    (a) canonical 을 고정 소유 경로(SUPERSEDE_OWNED)로 **떼어 낸다** — 그 순간부터 canonical 은 비어 있다
   *    (b) 떼어 낸 바이트가 판정한 옛 spec 이 아니면 남의 바이트다 — no-clobber 로 제자리에 되돌리고 멈춘다
   *    (c) 새 spec 은 고정 tmp(O_EXCL) → fsync → **lease 재확인** → link 로 배타 생성한다
   *    🔴 소유 사본은 **canonical 에 새 spec 이 검증됐거나 · 옛 spec 이 canonical 에 확실히 복구됐을 때만** 지운다.
   *       복구하지 못했으면 지우지 않고 RECOVERY_REQUIRED 와 경로를 돌려준다 — 다음 회차가 lease 안에서 판정한다.
   *    🔴 예외로 끝나지 않는다 — 모든 실패는 구조화된 결과다. 외부 writer 의 canonical 바이트는 덮지도 되돌리지도 않는다.
   *    `hooks.fail(step)` 은 시험 전용 실패 주입(tmpOpen · tmpWrite · tmpFsync · install · restore)이다.
   */
  const newBytes = specBytes(judged.spec)
  const drop = (f) => { try { unlinkSync(f) } catch { /* 이미 없다 */ } }
  const inject = (step) => { const e = hooks.fail?.(step); if (e) throw e }
  /** canonical 이 비었다 — 옛 spec 을 no-clobber 로 되돌린다. 확실히 되돌렸을 때만 소유 사본 · tmp 를 지운다 */
  const restoreOld = (problems, why) => {
    try { inject('restore'); linkSync(owned, path) } catch (e) {
      drop(tmp)
      return recovery([...problems, e?.code === 'EEXIST' ? 'EXTERNAL_CANONICAL' : 'RESTORE_FAILED'],
        `${why} — 옛 spec 을 canonical 에 되돌리지 못했다(${e?.code ?? e?.message}). 소유 사본을 지우지 않는다`)
    }
    if (readFileSync(path, 'utf8') !== j.oldBytes) { drop(tmp); return recovery([...problems, 'RESTORE_UNVERIFIED'], `${why} — 되돌린 canonical 이 옛 spec 이 아니다`) }
    drop(tmp); drop(owned)
    return blocked(problems, `${why} — 옛 spec 을 제자리에 되돌렸다`)
  }
  try { renameSync(path, owned) } catch (e) {
    return blocked(['CONCURRENT_WRITER'], `canonical spec 을 떼어 내지 못했다(${e.code ?? e.message})`)
  }
  try {
    hooks.afterDetach?.({ path, lease })
    const detached = readFileSync(owned, 'utf8')
    if (detached !== j.oldBytes) {
      // 🔴 판정 뒤 다른 writer 의 바이트를 떼어 냈다 — no-clobber 로 제자리에 되돌린다. canonical 을 또 누가 차지했으면 소유 사본을 남긴다
      try { linkSync(owned, path) } catch {
        return recovery(['CONCURRENT_WRITER', 'EXTERNAL_BYTES_PARKED'], '판정 뒤 spec 이 바뀌었고 canonical 도 다시 차지됐다 — 떼어 낸 바이트를 소유 사본에 둔다')
      }
      drop(owned)
      return blocked(['CONCURRENT_WRITER'], '판정 뒤 spec 이 바뀌었다 — 그 바이트를 제자리에 두었다')
    }
    hooks.beforeInstall?.({ path, lease })
    try {
      inject('tmpOpen')
      const fd = openSync(tmp, 'wx')
      try { inject('tmpWrite'); writeSync(fd, newBytes); inject('tmpFsync'); fsyncSync(fd) } finally { closeSync(fd) }
    } catch (e) { return restoreOld(['INSTALL_FAILED'], `새 spec tmp 를 만들지 못했다(${e?.code ?? e?.message})`) }
    hooks.afterTmpWrite?.({ path, lease })
    // 🔴 설치 직전 lease 를 다시 본다 — 확인 뒤 잃었으면 새 spec 을 설치하지 않는다
    if (!leaseHeld(lease)) return restoreOld(['LOCK_LOST'], '설치 직전 원고 lease 소유권을 잃었다')
    // 🔴 원고 보존형 — 설치 직전 원고가 고정한 그 바이트인지 다시 본다. 교체 · 삭제됐으면 새 spec 을 설치하지 않는다(원고는 건드리지 않는다)
    if (j.draftHash) {
      let now = null
      try { now = draftHashOf(readFileSync(join(dir, 'draft.md'))) } catch { now = null }
      if (now !== j.draftHash) return restoreOld([now ? 'DRAFT_CHANGED' : 'DRAFT_MISSING'], '설치 직전 고정한 원고가 바뀌었거나 사라졌다')
    }
    try { inject('install'); linkSync(tmp, path) } catch (e) {
      if (e?.code === 'EEXIST') {
        drop(tmp)
        return recovery(['CONCURRENT_WRITER', 'EXTERNAL_CANONICAL'], '설치 직전 다른 writer 가 canonical spec 을 먼저 만들었다 — 그 바이트를 그대로 둔다')
      }
      return restoreOld(['INSTALL_FAILED'], `새 spec 을 설치하지 못했다(${e?.code ?? e?.message})`)
    }
    hooks.afterReplace?.({ path, lease })
    // ④ 다시 읽기 — 설치 뒤 다른 writer 가 바꿨으면 지금 바이트를 그대로 두고 소유 사본을 남긴다
    if (readFileSync(path, 'utf8') !== newBytes) {
      drop(tmp)
      return recovery(['CONCURRENT_WRITER', 'EXTERNAL_CANONICAL'], '설치 뒤 spec 이 새 바이트가 아니다')
    }
    drop(tmp); drop(owned)
    return { ok: true, record: { superseded: true, oldSpecHash, newSpecHash: judged.spec.specHash, archive: supersededSpecName(oldSpecHash),
      ...(j.draftHash ? { topicSafetyRevision: true, preservedDraftHash: j.draftHash, publishAt: judged.spec.publication.publishAt } : {}) } }
  } catch (e) {
    // 🔴 예상하지 못한 실패 — canonical 이 비었으면 옛 spec 을 되돌리고, 아니면 소유 사본을 남겨 복구로 넘긴다
    if (!existsSync(path)) return restoreOld(['UNEXPECTED'], String(e?.message ?? e))
    drop(tmp)
    return recovery(['UNEXPECTED'], String(e?.message ?? e))
  }
}

/**
 * 🔴 **앞 교체가 남긴 조각의 복구 판정** — producer 가 같은 slug 원고 lease 안에서만 부른다 (급사 · 실패 뒤 다음 회차).
 *    소유 사본(옛 spec) · tmp · canonical 을 보고:
 *      canonical 없음 · 옛 spec  → 옛 spec 을 no-clobber 로 되돌린다(RESTORED_OLD) — 호출부가 다시 판정해 교체를 재시도한다
 *      canonical = 새 spec      → 교체는 끝났다(COMPLETED) — 조각만 지우고 recovered 기록을 돌려준다
 *      그 밖(외부 바이트 · 소유 사본 손상 · 보존본 불일치 · tmp 만 있음) → 아무것도 지우지 않고 RECOVERY_REQUIRED
 *    정상 복구 뒤에는 소유 사본 · tmp 가 남지 않는다.
 * @returns {{ok:true, state:'CLEAN'|'RESTORED_OLD'|'COMPLETED', record?:object}|{ok:false, code:string, problems:string[], why:string, recovery:object}}
 */
export function recoverSupersession({ draftsDir, slug, lease = null, newSpec = null, safety = null }) {
  const dir = join(draftsDir, slug)
  const path = join(dir, ARTICLE_SPEC_FILENAME)
  const owned = join(dir, SUPERSEDE_OWNED)
  const tmp = join(dir, SUPERSEDE_TMP)
  const recovery = (problems, why) => recoveryRequired({ problems, why, path, owned, tmp })
  if (!supersedeLeftovers({ draftsDir, slug }).length) return { ok: true, state: 'CLEAN' }
  if (!leaseHeld(lease)) return recovery(['LEASE_REQUIRED'], '원고 lease 없이 교체 조각을 정리하지 않는다')
  const drop = (f) => { try { unlinkSync(f) } catch { /* 이미 없다 */ } }
  const read = (f) => { try { return readFileSync(f, 'utf8') } catch { return null } }
  const ownedBytes = read(owned)
  const canon = read(path)
  const newBytes = newSpec ? specBytes(newSpec) : null
  if (ownedBytes === null) {
    // tmp 만 남았다 — 교체 순서상 tmp 는 소유 사본보다 먼저 지운다. canonical 이 새 spec 이면 tmp 만 지운다
    if (canon !== null && canon === newBytes) { drop(tmp); return { ok: true, state: 'COMPLETED' } }
    return recovery(['AMBIGUOUS_TMP_ONLY'], '소유 사본 없이 tmp 만 남았다 — 자동으로 판정하지 않는다')
  }
  let oldSpec = null
  try { oldSpec = JSON.parse(ownedBytes) } catch { oldSpec = null }
  if (!oldSpec || !verifyArticleSpec(oldSpec).ok) return recovery(['OWNED_INVALID'], '소유 사본이 성한 spec 이 아니다')
  // 🔴 소유 사본이 이 교체의 옛 spec 인가 — 보존본과 같은 바이트여야 한다
  if (read(join(dir, supersededSpecName(oldSpec.specHash))) !== ownedBytes) return recovery(['ARCHIVE_MISMATCH'], '소유 사본이 보존본과 다르다')
  if (canon === null) {
    try { linkSync(owned, path) } catch (e) {
      return recovery([e?.code === 'EEXIST' ? 'EXTERNAL_CANONICAL' : 'RESTORE_FAILED'], `옛 spec 을 canonical 에 되돌리지 못했다(${e?.code ?? e?.message})`)
    }
    if (read(path) !== ownedBytes) return recovery(['RESTORE_UNVERIFIED'], '되돌린 canonical 이 옛 spec 이 아니다')
    drop(tmp); drop(owned)
    return { ok: true, state: 'RESTORED_OLD' }
  }
  if (canon === ownedBytes) { drop(tmp); drop(owned); return { ok: true, state: 'RESTORED_OLD' } }
  if (newBytes !== null && canon === newBytes) {
    // 🔴 원고 보존형 — 고정한 원고가 그대로일 때만 끝난 교체로 인정한다. 바뀌었으면 조각을 지우지 않고 사람에게 넘긴다
    let draftNow = null
    if (safety) { try { draftNow = draftHashOf(readFileSync(join(dir, 'draft.md'))) } catch { draftNow = null } }
    if (safety && draftNow !== safety.draftHash) return recovery([draftNow ? 'DRAFT_CHANGED' : 'DRAFT_MISSING'], '교체는 끝났지만 고정한 원고가 그대로가 아니다')
    drop(tmp); drop(owned)
    return { ok: true, state: 'COMPLETED',
      record: { superseded: true, recovered: true, oldSpecHash: oldSpec.specHash, newSpecHash: newSpec.specHash, archive: supersededSpecName(oldSpec.specHash),
        ...(safety ? { topicSafetyRevision: true, preservedDraftHash: safety.draftHash, publishAt: newSpec.publication.publishAt } : {}) } }
  }
  return recovery(['EXTERNAL_CANONICAL'], 'canonical 에 옛 spec 도 새 spec 도 아닌 바이트가 있다 — 보존하고 사람이 확인한다')
}

/**
 * spec 을 `drafts/<slug>/article-spec.json` 에 **덮어쓰지 않고** 원자적으로 쓴다.
 *   · 없으면 tmp → fsync → link(no-clobber) → 쓴다
 *   · 같은 바이트가 이미 있으면 멱등 (written:false)
 *   · 다른 바이트가 있으면 DIRECT_SPEC_SPEC_CONFLICT — 기존 바이트를 건드리지 않는다
 */
export function persistDirectSpecNoClobber({ spec, draftsDir }) {
  const path = join(draftsDir, spec.identity.slug, ARTICLE_SPEC_FILENAME)
  const bytes = specBytes(spec)
  const sameOrConflict = () => {
    const e = existingSpecState({ spec, draftsDir })
    if (e.state === 'IDENTICAL') return { ok: true, written: false, path, specHash: spec.specHash }
    return { ok: false, code: DIRECT_SPEC_SPEC_CONFLICT, why: e.why ?? '다른 바이트의 article-spec.json 이 이미 있다 — 덮어쓰지 않는다', path }
  }
  if (existsSync(path)) return sameOrConflict()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`
  const fd = openSync(tmp, 'wx')
  try { writeSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
  try {
    linkSync(tmp, path)
  } catch (e) {
    if (e.code === 'EEXIST') return sameOrConflict()
    throw e
  } finally {
    try { unlinkSync(tmp) } catch { /* best effort */ }
  }
  return { ok: true, written: true, path, specHash: spec.specHash }
}
