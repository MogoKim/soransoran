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
 * 🔴 **source artifact 계약** (`magazine-article-spec-source/1` · 소비자 쪽 요구 계약).
 *      경로      drafts/magazine/article-spec-source/<graphVersion>.json
 *      최상위    { schema, graphVersion, entries: [entry] }
 *      entry     { status, approvedBy, approvedAt, g8ManifestHash, node, relations, hero, publication, productBasis, sourceHash }
 *      sourceHash = sha256(canonicalJson(entry 에서 sourceHash 를 뺀 것)) — productBasis 를 포함한다
 *    생산자는 `magazine-direct-spec-source-authoring` 의 approve 하나다. 이 파일을 손으로 만들지 않는다.
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
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { canonicalJson, compileArticleSpec, verifyArticleSpec } from './magazine-article-spec.mjs'
import { ARTICLE_SPEC_FILENAME, DIRECT_SPEC_MODE, DIRECT_SPEC_OPT_IN_FIELD } from './magazine-direct-spec.mjs'
import { isAutoLaneEligible } from './magazine-validation-profile.mjs'
import { evalLiteral, sliceLiteral } from './magazine-load.mjs'

export const DIRECT_SPEC_SOURCE_NOT_READY = 'DIRECT_SPEC_SOURCE_NOT_READY'
export const DIRECT_SPEC_SPEC_CONFLICT = 'DIRECT_SPEC_SPEC_CONFLICT'
export const DIRECT_SPEC_SOURCE_SCHEMA = 'magazine-article-spec-source/1'
export const DIRECT_SPEC_SOURCE_DIRNAME = 'article-spec-source'
/** canary 는 STANDARD 한 프로필만 연다 */
export const DIRECT_SPEC_CANARY_PROFILE = 'STANDARD'

/**
 * compileArticleSpec 이 source entry 에서 읽는 필드 — 하나라도 비면 NOT_READY 다.
 * queueItem 쪽 필드(title·intent·whyNow…)는 기존 큐 계약이 이미 검사한다.
 */
export const DIRECT_SPEC_REQUIRED_FIELDS = Object.freeze([
  'node.id', 'node.intentId', 'node.slug', 'node.status', 'node.graphVersion',
  'node.readerQuestion', 'node.scope.include', 'node.scope.exclude', 'node.outline',
  'node.evidence.factsToVerify', 'node.evidence.sourceRequirements', 'node.safetyConstraints',
  'node.hubPath', 'node.ctaLabel',
  'relations.direct', 'relations.discovery', 'publication.publishAt',
])

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
  // 🔴 3+1 관계가 실제로 보이는 자리 = 구현된 footer surface ∩ control 에서 켠 surface
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
  if (path === 'relations.direct') return Array.isArray(value) && value.length === 3
  if (path === 'node.outline') return Array.isArray(value) && value.filter((v) => String(v ?? '').trim()).length >= 3
  if (Array.isArray(value)) return value.some((v) => String(v ?? '').trim())
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return String(value ?? '').trim() !== ''
}

/**
 * 🔴 hero 는 큐의 imageMode 가 정한다 — `heroRequired` 하나가 계약이다(authoring 도 이것만 쓴다).
 *    REQUIRED · OPTIONAL → hero.alt · hero.scene 필수 · NO_IMAGE → 둘 다 금지.
 */
export function missingSourceFields(entry, queueItem = null) {
  const missing = DIRECT_SPEC_REQUIRED_FIELDS.filter((path) => !isPresent(valueAt(entry, path), path))
  if (heroRequired(queueItem?.imageMode)) {
    for (const path of ['hero.alt', 'hero.scene']) if (!isPresent(valueAt(entry, path), path)) missing.push(path)
  }
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
 *                approvalStatus, missingFields, blockers, g8ManifestHash, sourceHash }
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
  }
  const notReady = (why) => ({ ok: false, code: DIRECT_SPEC_SOURCE_NOT_READY, why, evidence })

  if (!expectedGraphVersion) {
    blockers.push('PRODUCT_GRAPH_VERSION_UNREADABLE')
    return notReady('제품 graphVersion 을 읽지 못했다 — 어떤 source 도 현재 판으로 인정할 수 없다')
  }
  if (!intentId || !queueItem?.g8ManifestHash) blockers.push('QUEUE_NOT_G8_ADMITTED')
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
  if (doc?.schema !== DIRECT_SPEC_SOURCE_SCHEMA) blockers.push('SOURCE_SCHEMA_UNKNOWN')
  evidence.observedGraphVersion = typeof doc?.graphVersion === 'string' ? doc.graphVersion : null
  if (evidence.observedGraphVersion !== expectedGraphVersion) blockers.push('GRAPH_VERSION_STALE')

  const entries = Array.isArray(doc?.entries) ? doc.entries : []
  const matches = entries.filter((e) => e?.node?.intentId === intentId && e?.node?.slug === slug)
  if (matches.length !== 1) {
    blockers.push(matches.length ? 'SOURCE_ENTRY_DUPLICATE' : 'SOURCE_ENTRY_ABSENT')
    return notReady(`source 에 이 행(${slug} · ${intentId})의 entry 가 정확히 하나가 아니다 (${matches.length}개)`)
  }
  const entry = matches[0]
  evidence.approvalStatus = typeof entry.status === 'string' ? entry.status : null
  evidence.sourceHash = typeof entry.sourceHash === 'string' ? entry.sourceHash : null
  evidence.missingFields = missingSourceFields(entry, queueItem)

  if (entry.status !== 'APPROVED' || entry.node?.status !== 'APPROVED' || !String(entry.approvedBy ?? '').trim() || !String(entry.approvedAt ?? '').trim()) {
    blockers.push('NOT_APPROVED')
  }
  if (entry.node?.graphVersion !== expectedGraphVersion) blockers.push('GRAPH_VERSION_STALE')
  if (entry.sourceHash !== directSpecSourceHash(entry)) blockers.push('SOURCE_HASH_DRIFT')
  if (entry.g8ManifestHash !== queueItem?.g8ManifestHash) blockers.push('MANIFEST_DRIFT')
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
