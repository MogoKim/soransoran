/**
 * G8 편입기 — builder 가 판정한 **GRAPH_READY** intent 에 영구 신원(slug)과 admission 을 부여한다.
 *
 * 🔴 **G8 은 queue writer 가 아니다** (2026-10-21 · g8-promotion/2).
 *    콘텐츠 계획(형식 · 검색 의도 · 위험 · CTA …)은 ArticlePlan 이 정한다. G8 이 쓰는 것은 연구 쪽 세 파일뿐이다.
 *      contract/g8-admission/<manifestHash>.json   receipt — manifest 원문 + 사람 승인 (wx · 불변)
 *      contract/m3-slug-manifest.json             intentId ↔ slug 영구 binding (키 추가만)
 *      contract/m3-state.jsonl                    ADMITTED 사건 (정본 recordAdmission · append-only)
 *    제품 파일(articles · topic-queue · graph)은 읽기만 한다.
 *
 * 🔴 **판정을 다시 만들지 않는다.** 후보는 builder `computeGraphAndReadiness` 의 GRAPH_READY 행뿐이다.
 *    G8 은 그 위에 신원 검사(이미 편입 · slug 충돌 · 제목 충돌 · 제목 형식)만 얹는다 — 새 후보를 만들지 않는다.
 *
 * 🔴 **입력 권위는 snapshot 하나다.** 연구 current · 루트 canonical 을 읽지 않는다.
 *    snapshot 으로 다시 계산한 graph 가 제품 bundle payload 와 바이트까지 같아야 한다.
 *    readiness 는 판정 시각(--at)으로 계산하고, 판 이름은 제품 current 가 가리키는 graphVersion 을 그대로 쓴다.
 *
 * 🔴 **apply 는 commit-forward 다.** 임시 공간에서 세 파일의 최종 바이트를 전부 만들고 검증한 뒤에만 journal 을 쓴다.
 *    journal 이후의 급사는 같은 최종 바이트를 끝까지 놓아 완성한다 — 의미 판정을 다시 하지 않고, ledger 를 줄이지 않는다.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parseArticlesSource, parseQueueSource, sliceLiteral } from './magazine-load.mjs'
import { checkTitleForm } from './magazine-editorial.mjs'
import { BANNED_WORDS } from './magazine-brief-policy.mjs'
import {
  INPUT_FILES as SNAPSHOT_FILE_NAMES, computeGraphAndReadiness, isRealKstAt, parseControlText, semanticHashOf,
} from './magazine-graph-build.mjs'

export const G8_SCHEMA = 'g8-promotion/2'
export const RECEIPT_SCHEMA = 'g8-admission-receipt/1'
export const ADMISSION_JOURNAL_SCHEMA = 'g8-admission-journal/1'
export const LOCK_SCHEMA = 'g8-admission-lock/1'

/** 연구 쪽 — G8 이 읽는 모듈 */
export const RESEARCH_FILES = {
  slugModule: 'contract/m3-slug.mjs',
  /** 🔴 장부 사건은 이 정본 계약(validateLedger · recordAdmission)으로만 적는다 */
  pipelineModule: 'contract/m3-pipeline.mjs',
}
/** 편입 장부 — G8 이 쓰는 연구 쪽 파일. 없으면 빈 것으로 본다 (해시 `ABSENT`) */
export const ADMISSION_FILES = {
  slugManifest: 'contract/m3-slug-manifest.json',
  ledger: 'contract/m3-state.jsonl',
}
export const RECEIPT_DIR = 'contract/g8-admission'
export const LOCK_FILE = 'contract/.g8-admission.lock'
export const JOURNAL_FILE = 'contract/.g8-admission.journal.json'
export const PRODUCT_FILES = {
  articles: 'src/content/magazine/articles.ts',
  queue: 'drafts/magazine/topic-queue.ts',
  graphCurrent: 'src/content/magazine/graph/current.ts',
  graphControl: 'src/content/magazine/graph/control.ts',
  graphResolver: 'src/lib/magazine-graph.ts',
}
export const SNAPSHOT_FILES = Object.freeze(Object.values(SNAPSHOT_FILE_NAMES))

/**
 * 🔴 **receipt 없이 이미 있는 ADMITTED 5행** — G8 v1 이전 편입. intentId · slug · 행 sha256 으로 정확히 열거한다.
 *    「receipt 가 없으면 legacy」 가 아니다 — 여기 없는 receipt 없는 행은 UNKNOWN 이고 실패다.
 */
export const KNOWN_LEGACY_ADMISSIONS = Object.freeze([
  { intentId: 'I-T6-12', slug: 'retirement-others-what-work', lineSha256: 'e1c0ce82802a21ecfa1e9af0a4ffdc0f16ca5f77d35b10c7928e6faa544e96c6' },
  { intentId: 'I-T4-15', slug: 'clinic-booking-app', lineSha256: 'fbdd21af605bdf94736d0cd2362b556970a2d8f487138c18fa6ac0075d6b6ae4' },
  { intentId: 'I-T6-13', slug: 'job-credentials', lineSha256: 'a77ad0919213effd58d64bfd68fce9c08c16e5355830e717eb035c0b9c2ffe1c' },
  { intentId: 'I-T7-05', slug: 'alone-pastime', lineSha256: 'bb4ac3d0d9cb9e82fcb3492dcfdda389adaf924883e51689153349aa87082f02' },
  { intentId: 'I-T8-38', slug: 'gray-hair-leave-as-is', lineSha256: '3eea17205f16511f2ca7d4a5900c2ff8dd8cde594de0c69472228b769c6c4834' },
])

/** 🔴 기계 승인 표식 — admission 은 사람 승인만 받는다 (DIRECT source 승인과 같은 규칙) */
export const MACHINE_APPROVER = /:|^(?:machine|bot|auto|automation|system|ci|agent|claude|codex|chatgpt|gpt|openai|anthropic)\b/i

// ── 기본 ─────────────────────────────────────────────────────

export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')
const sha16 = (text) => sha256(text).slice(0, 16)

/** 키를 정렬한 canonical JSON — manifest · receipt 해시의 유일한 직렬화 */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}
/** manifest 해시 — hash 필드만 뺀 canonical JSON 의 sha256 */
export const hashManifest = (m) => { const { hash: _omit, ...body } = m ?? {}; return sha256(canonicalJson(body)) }
/** receipt 해시 — receiptHash 필드만 뺀 receipt 전체의 canonical JSON 의 sha256 */
export const receiptHashOf = (r) => { const { receiptHash: _omit, ...body } = r ?? {}; return sha256(canonicalJson(body)) }

class G8Error extends Error {
  constructor(code, why) { super(`${code} — ${why}`); this.code = code; this.why = why }
}
const fail = (code, why) => { throw new G8Error(code, why) }

function readRequired(file, label) {
  if (!fs.existsSync(file)) fail('INPUT_MISSING', `${label} 가 없다: ${file}`)
  return fs.readFileSync(file, 'utf8')
}
function readOptional(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}
const parseJsonl = (text, label) => String(text ?? '').split('\n').filter((l) => l.trim()).map((l, i) => {
  try { return JSON.parse(l) } catch (e) { throw new Error(`${label} ${i + 1}행 JSON 파싱 실패: ${e.message}`) }
})

/**
 * 🔴 **판정 시각은 정확한 KST 시각 하나다.** 날짜만 받아 하루 끝으로 해석하지 않는다 · 벽시계로 대신하지 않는다.
 */
export function parseAt(at, label = '판정 시각') {
  if (!isRealKstAt(at)) fail('AT_INVALID', `${label}은 실제로 있는 YYYY-MM-DDTHH:MM:SS+09:00 이어야 한다: ${at}`)
  return { at, ms: new Date(at).getTime() }
}

/** 비교용 — 공백·문장부호를 걷어 낸 질문/제목 */
export const normalizeTitle = (s) => String(s ?? '').replace(/[\s?!.,·…"'「」()~]/g, '')

/** 🔴 제목 계약 — 큐 작업 제목은 자동 제작에 넣을 최소 형식과 금지어를 통과해야 한다 */
export function titleProblems(title) {
  const out = []
  const t = checkTitleForm(title)
  if (t.level) out.push(`title_form — ${t.reason}`)
  const banned = BANNED_WORDS.filter((w) => String(title ?? '').includes(w))
  if (banned.length) out.push(`title_banned — ${banned.join('·')}`)
  return out
}

// ── 신원 입력 (15개) ──────────────────────────────────────────

/**
 * 🔴 **apply 직전에 전부 다시 센다.** 하나라도 다르면 journal 전에 STALE_INPUT — 실제 write 0.
 *    제품 7 · 연구 3 · snapshot 5. 연구 current 는 여기 없다(읽지 않는다).
 */
export function readIdentityInputs({ repoDir, researchDir, snapshotDir }) {
  const p = (rel) => path.join(repoDir, rel)
  const current = readRequired(p(PRODUCT_FILES.graphCurrent), 'graph current.ts')
  const m = /export \{ GRAPH, EXPORT_HASH \} from '\.\/(g-[a-z0-9-]+)'/.exec(current)
  if (!m) fail('INPUT_MISSING', 'graph current.ts 가 가리키는 버전을 찾지 못했다')
  const bundleRel = path.join(path.dirname(PRODUCT_FILES.graphCurrent), `${m[1]}.ts`)
  const draftsDir = p('drafts/magazine')
  const draftSlugs = fs.existsSync(draftsDir)
    ? fs.readdirSync(draftsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : []
  const texts = {
    articles: readRequired(p(PRODUCT_FILES.articles), PRODUCT_FILES.articles),
    topicQueue: readRequired(p(PRODUCT_FILES.queue), PRODUCT_FILES.queue),
    graphCurrent: current,
    graphPointer: m[1],
    graphBundle: readRequired(p(bundleRel), bundleRel),
    graphControl: readRequired(p(PRODUCT_FILES.graphControl), PRODUCT_FILES.graphControl),
    graphResolver: readRequired(p(PRODUCT_FILES.graphResolver), PRODUCT_FILES.graphResolver),
    draftSlugs,
    slugManifest: readOptional(path.join(researchDir, ADMISSION_FILES.slugManifest)),
    ledger: readOptional(path.join(researchDir, ADMISSION_FILES.ledger)),
    slugModule: readRequired(path.join(researchDir, RESEARCH_FILES.slugModule), RESEARCH_FILES.slugModule),
    snapshot: Object.fromEntries(SNAPSHOT_FILES.map((n) => [n, readRequired(path.join(snapshotDir, n), `snapshot ${n}`)])),
  }
  const absent = (t) => (t === null ? 'ABSENT' : sha256(t))
  const entries = [
    ['product.articles', sha256(texts.articles)],
    ['product.topicQueue', sha256(texts.topicQueue)],
    ['product.draftsSlugSet', sha256(texts.draftSlugs.join('\n'))],
    ['product.graphCurrent', sha256(texts.graphCurrent)],
    ['product.graphBundle', sha256(texts.graphBundle)],
    ['product.graphControl', sha256(texts.graphControl)],
    ['product.graphResolver', sha256(texts.graphResolver)],
    ['research.slugManifest', absent(texts.slugManifest)],
    ['research.ledger', absent(texts.ledger)],
    ['research.slugModule', sha256(texts.slugModule)],
    ...SNAPSHOT_FILES.map((n) => [`snapshot.${n}`, sha256(texts.snapshot[n])]),
  ]
  return { texts, hashes: Object.fromEntries(entries) }
}

// ── 제품 bundle 대조 ─────────────────────────────────────────

/** 제품 bundle 파일의 GRAPH payload 와 EXPORT_HASH 를 실제로 읽는다 */
export function readBundlePayload(bundleText) {
  const literal = sliceLiteral(bundleText, bundleText.indexOf('=', bundleText.indexOf('export const GRAPH')), '{', '}')
  if (!literal) fail('GRAPH_BUNDLE_UNREADABLE', 'graph 번들의 GRAPH 리터럴을 찾지 못했다')
  const e = /export const EXPORT_HASH = '([0-9a-f]+)'/.exec(bundleText)
  if (!e) fail('GRAPH_BUNDLE_UNREADABLE', 'graph 번들의 EXPORT_HASH 를 찾지 못했다')
  let payload
  try { payload = JSON.parse(literal) } catch (err) { fail('GRAPH_BUNDLE_UNREADABLE', `GRAPH 리터럴 JSON 파싱 실패: ${err.message}`) }
  return { payload, exportHash: e[1] }
}

/**
 * 🔴 **snapshot ↔ 제품 bundle.** 선언값만 보지 않는다 — 전부 다시 계산해 대조한다.
 *    payload deep-equal(generatedAt 제외) · contentHash 각 필드 · participation 포함 combined · graphVersion ·
 *    graphSemanticHash · EXPORT_HASH · current 가 가리키는 파일 · control 판.
 * @returns {string[]} 어긋난 것 (비면 일치)
 */
export function graphIdentityProblems({ core, texts }) {
  const { payload, exportHash } = readBundlePayload(texts.graphBundle)
  const problems = []
  if (sha16(JSON.stringify(payload)) !== exportHash) problems.push('EXPORT_HASH — bundle payload 와 EXPORT_HASH 가 다르다')
  const recomputed = { ...core.parts.slimCore, generatedAt: payload.generatedAt }
  if (JSON.stringify(recomputed) !== JSON.stringify(payload)) problems.push('PAYLOAD — snapshot 재계산 payload 가 제품 bundle 과 다르다')
  const pc = payload.contentHash ?? {}
  for (const k of ['intents', 'edges', 'mappings', 'participation', 'combined']) {
    if (core.contentHash[k] !== pc[k]) problems.push(`CONTENT_HASH.${k} — ${core.contentHash[k]} ≠ ${pc[k]}`)
  }
  if (sha16(`${pc.intents}${pc.edges}${pc.mappings}${pc.participation ?? ''}`) !== pc.combined) problems.push('COMBINED — payload combined 가 각 필드에서 나오지 않는다')
  if (core.graphVersion !== payload.graphVersion) problems.push(`GRAPH_VERSION — ${core.graphVersion} ≠ ${payload.graphVersion}`)
  if (texts.graphPointer !== payload.graphVersion) problems.push(`CURRENT — current.ts 가 ${texts.graphPointer} 를 가리킨다`)
  if (!String(payload.graphVersion).endsWith(`-${String(pc.combined).slice(0, 6)}`)) problems.push('GRAPH_VERSION_SUFFIX — combined 앞 6자리와 다르다')
  if (semanticHashOf(payload) !== core.graphSemanticHash) problems.push('GRAPH_SEMANTIC_HASH — payload 재계산 값이 다르다')
  if (parseControlText(texts.graphControl)?.graphVersion !== payload.graphVersion) problems.push('CONTROL — control.ts 판이 bundle 과 다르다 (제품이 폴백 중)')
  return problems
}

// ── dry-run (manifest) ───────────────────────────────────────

async function loadProposeSlug(researchDir) {
  const mod = await import(pathToFileURL(path.join(researchDir, RESEARCH_FILES.slugModule)).href)
  if (typeof mod.proposeSlug !== 'function') fail('SLUG_MODULE', 'm3-slug.mjs 에 proposeSlug 가 없다')
  // 🔴 순수 proposeSlug 만 쓴다 — assignSlugs · collectTakenSlugs 는 운영 경로 · 연구 current 를 읽는다
  return mod.proposeSlug
}

/**
 * 🔴 **G8 manifest (g8-promotion/2)** — 같은 입력이면 바이트까지 같다. 시각 · 난수 · 파일 순서가 들어가지 않는다.
 *
 * 🔴 **readiness 는 판정 시각(--at)으로 계산한다** (2026-10-22). 과거 build 시각의 readiness 를 다시 쓰지 않는다.
 *    판 이름은 제품 current 가 가리키는 graphVersion 을 그대로 기대값으로 넘긴다 — 날짜를 추정하지 않는다.
 *    그 시각에 snapshot lifecycle 이나 graph 내용이 제품 bundle 과 달라졌으면 GRAPH_BUNDLE_MISMATCH 로 거부한다.
 * @param {{ repoDir: string, researchDir: string, snapshotDir: string, at: string }} p
 */
export async function buildManifest({ repoDir, researchDir, snapshotDir, at }) {
  parseAt(at, '판정 시각(--at)')
  const { texts, hashes } = readIdentityInputs({ repoDir, researchDir, snapshotDir })
  const proposeSlug = await loadProposeSlug(researchDir)

  let core
  try {
    core = computeGraphAndReadiness({
      inputTexts: texts.snapshot,
      productTexts: { resolver: texts.graphResolver, control: texts.graphControl, articles: texts.articles },
      admissionTexts: { slugManifest: texts.slugManifest, ledger: texts.ledger },
      effectiveAt: at,
      expectedGraphVersion: texts.graphPointer,
    })
  } catch (e) { fail('GRAPH_BUNDLE_MISMATCH', `snapshot 으로 graph 를 다시 계산하지 못했다: ${e.code ?? ''} ${e.why ?? e.message}`) }
  const problems = graphIdentityProblems({ core, texts })
  if (problems.length) fail('GRAPH_BUNDLE_MISMATCH', problems.join(' | '))
  const { payload, exportHash } = readBundlePayload(texts.graphBundle)

  // ── 신원 검사 재료 (제품 · 연구 장부) ──
  const articles = parseArticlesSource(texts.articles)
  const queue = parseQueueSource(texts.topicQueue)
  const slugTable = texts.slugManifest ? JSON.parse(texts.slugManifest).slugs ?? {} : {}
  const ledger = parseJsonl(texts.ledger ?? '', 'ledger')
  const admittedIntent = new Set(ledger.filter((r) => r.event === 'ADMITTED').map((r) => r.intentId))
  const takenBy = new Map()
  const take = (slug, who) => { if (slug && !takenBy.has(slug)) takenBy.set(slug, who) }
  for (const a of articles) take(a.slug, 'articles.ts')
  for (const q of queue) take(q.slug, 'topic-queue.ts')
  for (const d of texts.draftSlugs) take(d, 'drafts/magazine')
  for (const x of payload.mappings ?? []) take(x.slug, 'graph 번들 매핑')
  for (const [id, slug] of Object.entries(slugTable)) take(slug, `slug 표(${id})`)
  for (const r of ledger) take(r.slug, `장부(${r.intentId})`)
  const titles = new Set([...articles.map((a) => normalizeTitle(a.title)), ...queue.map((q) => normalizeTitle(q.title))])
  const intents = new Map(core.layers.intents.map((x) => [x.intentId, x]))
  const edges = new Map(core.layers.edges.map((e) => [e.edgeId, e]))
  const rel = (tgt) => {
    const e = edges.get(tgt.edgeId)
    if (!e || e.readerReason !== tgt.reason) fail('READINESS_EDGE', `${tgt.edgeId} 가 graph edge 와 다르다`)
    return { edgeId: tgt.edgeId, slot: tgt.slot, toIntentId: tgt.toIntentId, anchorLabel: e.anchorLabel, readerReason: e.readerReason, targetSlug: tgt.slug }
  }

  const drafts = []
  const refused = []
  for (const r of core.readiness.rows) {
    if (!(r.status === 'GRAPH_READY' && r.graphReady === true)) continue
    const it = intents.get(r.intentId)
    const slug = slugTable[r.intentId] ?? proposeSlug(it.primaryQuery, it.territoryId)
    const why = []
    if (admittedIntent.has(r.intentId)) why.push('ALREADY_ADMITTED')
    if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) why.push(`SLUG_INVALID — ${slug || '빈 값'}`)
    else if (takenBy.has(slug)) why.push(`SLUG_TAKEN — ${slug} (${takenBy.get(slug)})`)
    if (titles.has(normalizeTitle(it.primaryQuery))) why.push('TITLE_TAKEN')
    why.push(...titleProblems(it.primaryQuery))
    if (why.length) { refused.push({ intentId: r.intentId, slug: slug || null, why }); continue }
    drafts.push({
      intentId: r.intentId, slug, cluster: it.magazineCluster ?? r.cluster, primaryQuery: it.primaryQuery, territoryId: it.territoryId,
      direct: r.direct.targets.map(rel),
      discovery: r.discovery.targets.length ? rel(r.discovery.targets[0]) : null,
      reverse: r.reverse.sources.map((s) => s.edgeId),
    })
  }
  // 🔴 후보끼리 같은 slug — 사전이 두 의도를 가르지 못한다. 번호를 붙이지 않는다
  const bySlug = new Map()
  for (const d of drafts) bySlug.set(d.slug, [...(bySlug.get(d.slug) ?? []), d.intentId])
  const admissions = drafts.filter((d) => {
    if (bySlug.get(d.slug).length === 1) return true
    refused.push({ intentId: d.intentId, slug: d.slug, why: [`SLUG_COLLISION — ${bySlug.get(d.slug).join(',')}`] })
    return false
  })

  const m = {
    schema: G8_SCHEMA,
    at,
    snapshot: { name: path.basename(path.resolve(snapshotDir)), inputSha256: Object.fromEntries(SNAPSHOT_FILES.map((n) => [n, hashes[`snapshot.${n}`]])) },
    graph: { graphVersion: core.graphVersion, contentHash: core.contentHash, graphSemanticHash: core.graphSemanticHash, exportHash },
    readiness: { readinessHash: core.readinessHash, readinessFileSha256: core.readinessFileSha256, inputs: core.readiness.inputs },
    identityInputHashes: hashes,
    admissions: admissions.sort((a, b) => (a.intentId < b.intentId ? -1 : a.intentId > b.intentId ? 1 : 0)),
    refused: refused.sort((a, b) => (a.intentId < b.intentId ? -1 : a.intentId > b.intentId ? 1 : 0)),
  }
  m.hash = hashManifest(m)
  return m
}

// ── receipt · 장부 행 ────────────────────────────────────────

export const receiptPathOf = (researchDir, manifestHash) => path.join(researchDir, RECEIPT_DIR, `${manifestHash}.json`)
/** 정본 recordAdmission 에 넘기는 사건 재료 — 관계는 receipt 와 같은 네 필드 */
const ledgerItemOf = (a) => ({
  intentId: a.intentId, slug: a.slug, title: a.primaryQuery, cluster: a.cluster,
  directRelations: a.direct.map(({ slot, toIntentId, anchorLabel, readerReason }) => ({ slot, toIntentId, anchorLabel, readerReason })),
  discoveryRelation: a.discovery
    ? { slot: a.discovery.slot, toIntentId: a.discovery.toIntentId, anchorLabel: a.discovery.anchorLabel, readerReason: a.discovery.readerReason }
    : null,
  internalLinks: [],
})
const relTuple = (r) => (r ? `${r.slot}|${r.toIntentId}|${r.anchorLabel}|${r.readerReason}` : 'null')

export function makeReceipt({ manifest, approval, committedAt }) {
  const r = { schema: RECEIPT_SCHEMA, manifestHash: manifest.hash, manifest, approval, committedAt }
  r.receiptHash = receiptHashOf(r)
  return r
}
export const receiptBytes = (r) => `${JSON.stringify(r, null, 2)}\n`

/** 승인 형식 — 사람 · 실제 KST 시각 · 확인한 manifest 해시 */
export function approvalProblems(approval, manifestHash) {
  const out = []
  const by = String(approval?.approvedBy ?? '').trim()
  if (!by) out.push('APPROVER_MISSING')
  else if (MACHINE_APPROVER.test(by)) out.push(`APPROVER_MACHINE — ${by}`)
  if (!isRealKstAt(approval?.approvedAt)) out.push('APPROVED_AT_INVALID')
  if (approval?.confirmManifestHash !== manifestHash) out.push('CONFIRM_HASH_MISMATCH')
  return out
}

/** 한 receipt 파일의 자기 불변식 */
export function receiptProblems(file, text) {
  let r
  try { r = JSON.parse(text) } catch { return ['RECEIPT_PARSE'] }
  const out = []
  if (r.schema !== RECEIPT_SCHEMA) out.push('RECEIPT_SCHEMA')
  if (path.basename(file) !== `${r.manifestHash}.json`) out.push('RECEIPT_FILENAME — 파일명이 manifestHash 가 아니다')
  if (hashManifest(r.manifest) !== r.manifestHash || r.manifest?.hash !== r.manifestHash) out.push('RECEIPT_MANIFEST_HASH — manifest 원문 해시가 다르다')
  out.push(...approvalProblems(r.approval, r.manifestHash).map((x) => `RECEIPT_APPROVAL — ${x}`))
  if (!isRealKstAt(r.committedAt)) out.push('RECEIPT_COMMITTED_AT')
  if (receiptHashOf(r) !== r.receiptHash) out.push('RECEIPT_HASH — receiptHash 가 본문과 다르다')
  return out
}

/**
 * 🔴 **receipt · slug binding · ledger 의 정확한 일치.**
 *    · receipt 의 admission 마다 slug 표 binding · ledger ADMITTED 1행 · 관계 4필드 · 그 판 bundle edge 가 같다
 *    · ledger ADMITTED 행은 CURRENT(receipt 있음) · KNOWN_LEGACY(정확한 열거) · UNKNOWN(실패) 중 하나
 *    · slug binding 은 receipt 나 KNOWN_LEGACY 로 설명돼야 한다
 *    · journal 이 남아 있으면 일관 상태로 판정하지 않는다
 * @param {{ receipts: {file:string,text:string}[], slugManifestText: string|null, ledgerText: string|null,
 *           payloadOf: (graphVersion:string)=>object|null, journalPresent?: boolean, knownLegacy?: object[] }} p
 */
export function verifyAdmissions({ receipts, slugManifestText, ledgerText, payloadOf, journalPresent = false, knownLegacy = KNOWN_LEGACY_ADMISSIONS }) {
  const problems = []
  if (journalPresent) problems.push('ADMISSION_IN_PROGRESS — journal 이 남아 있다')
  const slugs = slugManifestText ? JSON.parse(slugManifestText).slugs ?? {} : {}
  const lines = String(ledgerText ?? '').split('\n').filter((l) => l.trim())
  const admitted = lines.map((line) => ({ line, row: JSON.parse(line) })).filter((x) => x.row.event === 'ADMITTED')
  const current = new Map()
  for (const { file, text } of receipts) {
    const rp = receiptProblems(file, text)
    if (rp.length) { problems.push(...rp.map((x) => `${path.basename(file)} ${x}`)); continue }
    const r = JSON.parse(text)
    const payload = payloadOf(r.manifest.graph?.graphVersion)
    const bEdges = new Map((payload?.edges ?? []).map((e) => [e.id, e]))
    if (!payload) problems.push(`${path.basename(file)} GRAPH_MISSING — ${r.manifest.graph?.graphVersion} bundle 이 제품에 없다`)
    for (const a of r.manifest.admissions ?? []) {
      const key = `${a.intentId}|${a.slug}`
      if (current.has(key)) problems.push(`DUPLICATE_ADMISSION — ${key}`)
      current.set(key, a)
      if (slugs[a.intentId] !== a.slug) problems.push(`SLUG_BINDING — ${a.intentId} → ${a.slug} (표: ${slugs[a.intentId] ?? '없음'})`)
      const owners = Object.entries(slugs).filter(([, s]) => s === a.slug).map(([id]) => id)
      if (owners.length !== 1) problems.push(`SLUG_OWNER — ${a.slug} 의 intent 가 ${owners.length}개`)
      const rows = admitted.filter((x) => x.row.intentId === a.intentId && x.row.slug === a.slug)
      if (rows.length !== 1) { problems.push(`LEDGER_ROW — ${key} ADMITTED ${rows.length}행`); continue }
      const lr = rows[0].row
      const want = ledgerItemOf(a)
      if (JSON.stringify((lr.directRelations ?? []).map(relTuple)) !== JSON.stringify(want.directRelations.map(relTuple))
        || relTuple(lr.discoveryRelation) !== relTuple(want.discoveryRelation)) problems.push(`LEDGER_RELATION — ${key} 관계가 receipt 와 다르다`)
      for (const x of [...a.direct, ...(a.discovery ? [a.discovery] : [])]) {
        const e = bEdges.get(x.edgeId)
        if (payload && (!e || e.from !== a.intentId || e.to !== x.toIntentId || e.slot !== x.slot || e.anchor !== x.anchorLabel || e.reason !== x.readerReason)) {
          problems.push(`BUNDLE_EDGE — ${key} ${x.edgeId} 가 ${r.manifest.graph.graphVersion} 의 edge 와 다르다`)
        }
      }
    }
  }
  const legacyKey = new Set(knownLegacy.map((x) => `${x.intentId}|${x.slug}|${x.lineSha256}`))
  const legacyPair = new Set(knownLegacy.map((x) => `${x.intentId}|${x.slug}`))
  const classes = { CURRENT: 0, KNOWN_LEGACY: 0, UNKNOWN: 0 }
  for (const { line, row } of admitted) {
    const key = `${row.intentId}|${row.slug}`
    if (current.has(key)) classes.CURRENT++
    else if (legacyKey.has(`${key}|${sha256(line)}`)) classes.KNOWN_LEGACY++
    else { classes.UNKNOWN++; problems.push(`UNKNOWN_ADMISSION — ${key} (receipt 도 KNOWN_LEGACY 도 아니다)`) }
  }
  for (const [id, slug] of Object.entries(slugs)) {
    const key = `${id}|${slug}`
    if (!current.has(key) && !legacyPair.has(key)) problems.push(`UNEXPLAINED_BINDING — ${key}`)
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)], classes }
}

/** 연구 루트의 receipt 전부 — 파일명 정렬 */
export function readReceipts(researchDir) {
  const dir = path.join(researchDir, RECEIPT_DIR)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => ({ file: path.join(dir, n), text: fs.readFileSync(path.join(dir, n), 'utf8') }))
}
/** 제품 repo 에서 graphVersion 의 bundle payload — 없으면 null */
export const productPayloadOf = (repoDir) => (gv) => {
  const f = path.join(repoDir, path.dirname(PRODUCT_FILES.graphCurrent), `${gv}.ts`)
  return fs.existsSync(f) ? readBundlePayload(fs.readFileSync(f, 'utf8')).payload : null
}
/** 지금 연구 루트 상태 그대로의 일치 판정 */
export function verifyAdmissionState({ researchDir, repoDir, knownLegacy }) {
  return verifyAdmissions({
    receipts: readReceipts(researchDir),
    slugManifestText: readOptional(path.join(researchDir, ADMISSION_FILES.slugManifest)),
    ledgerText: readOptional(path.join(researchDir, ADMISSION_FILES.ledger)),
    payloadOf: productPayloadOf(repoDir),
    journalPresent: fs.existsSync(path.join(researchDir, JOURNAL_FILE)),
    knownLegacy,
  })
}

// ── 잠금 ─────────────────────────────────────────────────────

/**
 * 🔴 **연구 admission 잠금.** O_EXCL 로 만든다. 있으면 ADMISSION_LOCKED — 시간 · PID 만 보고 지우지 않는다.
 *    급사로 남은 잠금은 `recoverStaleLock`(잠금 파일 sha256 을 사람이 확인한 명시 경로)으로만 넘겨받는다.
 */
function acquireLock(researchDir, manifestHash) {
  const file = path.join(researchDir, LOCK_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = `${JSON.stringify({ schema: LOCK_SCHEMA, host: os.hostname(), pid: process.pid, startedAt: new Date().toISOString(), manifestHash })}\n`
  let fd
  try { fd = fs.openSync(file, 'wx') } catch (e) {
    if (e.code !== 'EEXIST') throw e
    const text = readOptional(file)
    let holder = null
    try { holder = JSON.parse(text) } catch { /* 깨진 잠금 — 그대로 둔다 */ }
    return { ok: false, code: 'ADMISSION_LOCKED', why: '다른 admission 이 잠금을 쥐고 있다 — 자동으로 지우지 않는다', holder, lockSha256: text === null ? null : sha256(text) }
  }
  try { fs.writeSync(fd, body); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  return { ok: true, file, body }
}
function releaseLock(lock) {
  if (readOptional(lock.file) === lock.body) fs.unlinkSync(lock.file)
}

// ── 쓰기 ─────────────────────────────────────────────────────

/** 🔴 임시 파일 → fsync → rename. 입력 수리 journal 도 이것을 쓴다 (약한 사본을 따로 두지 않는다) */
export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.g8tmp-${process.pid}`
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeSync(fd, text); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
}
export const shaOrAbsent = (text) => (text === null ? 'ABSENT' : sha256(text))

/** 🔴 receipt 는 wx — 임시 파일을 끝까지 쓴 뒤 link 로 놓는다. 이미 있으면 덮지 않는다 */
function placeReceipt(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.g8tmp-${process.pid}`
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try { fs.linkSync(tmp, file) } finally { fs.rmSync(tmp, { force: true }) }
}

/** 🔴 ledger 는 append 만 — O_APPEND 로 붙이고 fsync 한다 */
function appendLedger(file, bytes) {
  const fd = fs.openSync(file, 'a')
  try { fs.writeSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

/**
 * 🔴 **시험 전용 정지점** — 실제 자식 프로세스로 동시 apply·SIGKILL 을 재현하려고 둔다.
 *    `SORAN_MAGAZINE_TEST_MODE=1` 이 없으면 열리지 않고, 변수만 있으면 apply 를 거부한다.
 */
export function testPauseHook(env = process.env) {
  const stage = env.G8_TEST_PAUSE_AT
  const gate = env.G8_TEST_GATE
  if (!stage && !gate) return () => {}
  if (env.SORAN_MAGAZINE_TEST_MODE !== '1') throw new Error('G8_TEST_PAUSE_AT · G8_TEST_GATE 는 SORAN_MAGAZINE_TEST_MODE=1 에서만 쓴다 — 운영에서는 금지다')
  return (s) => {
    if (s !== stage) return
    fs.writeFileSync(`${gate}.reached`, String(process.pid))
    while (!fs.existsSync(`${gate}.go`)) sleepSync(20)
  }
}

/**
 * 🔴 **journal 신원 검증** (입력 수리 journal 이 쓰는 공용 형식) — 되돌리기 전에 「이 journal 이 지금 이 루트의 그 파일만
 *    가리키는가」를 본다. schema · 개수 · 중복 0 · 현재 루트에서 계산한 절대 경로와 정확히 일치.
 *    하나라도 어긋나면 어떤 파일도 쓰거나 지우지 않는다 — journal 자체도 남긴다.
 */
export const JOURNAL_SCHEMA = 'g8-journal/1'
export function checkJournalIdentity(j, expectedPaths, schema = JOURNAL_SCHEMA) {
  const failId = (why) => ({ ok: false, code: 'RECOVERY_IDENTITY', why })
  if (!j || typeof j !== 'object') return failId('journal 이 객체가 아니다')
  if (j.schema !== schema) return failId(`schema 가 ${schema} 가 아니다 (${String(j.schema)})`)
  if (!Array.isArray(j.files)) return failId('files 가 배열이 아니다')
  const want = [...expectedPaths].sort()
  if (j.files.length !== want.length) return failId(`파일 수가 ${want.length} 이 아니다 (${j.files.length})`)
  const got = j.files.map((f) => f?.path)
  if (got.some((p) => typeof p !== 'string' || !path.isAbsolute(p))) return failId('절대 경로가 아닌 항목이 있다')
  if (new Set(got).size !== got.length) return failId('같은 경로가 두 번 있다')
  const sorted = [...got].sort()
  if (sorted.some((p, i) => p !== want[i])) return failId(`경로가 현재 루트의 세 파일과 다르다 (${sorted.join(', ')})`)
  for (const f of j.files) {
    if (!(f.before === null || typeof f.before === 'string')) return failId(`${f.path} 의 before 가 원문 또는 null 이 아니다`)
    if (typeof f.afterSha !== 'string') return failId(`${f.path} 의 afterSha 가 없다`)
  }
  return { ok: true }
}

/**
 * 실제 위치 — 같은 파일을 다른 표기(/var ↔ /private/var · symlink)로 가리켜도 같은 값이다.
 * 아직 없는 경로는 존재하는 가장 가까운 상위 폴더를 풀고 나머지를 붙인다.
 */
function realPathOf(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return null
  let d = path.resolve(p)
  const rest = []
  while (!fs.existsSync(d)) { rest.unshift(path.basename(d)); const up = path.dirname(d); if (up === d) return null; d = up }
  return path.join(fs.realpathSync(d), ...rest)
}
const samePath = (a, b) => realPathOf(a) !== null && realPathOf(a) === realPathOf(b)

/** admission journal 신원 — 이 연구 루트의 세 파일 · 이 manifest 의 receipt 경로만 (실제 위치로 대조) */
function admissionJournalProblems(j, researchDir) {
  const out = []
  if (!j || typeof j !== 'object') return ['journal 이 객체가 아니다']
  if (j.schema !== ADMISSION_JOURNAL_SCHEMA) out.push(`schema ${String(j.schema)}`)
  if (typeof j.manifestHash !== 'string' || !/^[0-9a-f]{64}$/.test(j.manifestHash)) out.push('manifestHash')
  else if (!samePath(j.receipt?.path, receiptPathOf(researchDir, j.manifestHash))) out.push('receipt 경로')
  if (typeof j.receipt?.bytes !== 'string' || sha256(j.receipt?.bytes ?? '') !== j.receipt?.sha256) out.push('receipt 바이트')
  if (!samePath(j.slugManifest?.path, path.join(researchDir, ADMISSION_FILES.slugManifest)) || typeof j.slugManifest?.afterBytes !== 'string'
    || sha256(j.slugManifest.afterBytes) !== j.slugManifest.afterSha256 || typeof j.slugManifest.beforeSha256 !== 'string') out.push('slug manifest')
  if (!samePath(j.ledger?.path, path.join(researchDir, ADMISSION_FILES.ledger)) || typeof j.ledger?.appendBytes !== 'string'
    || !Number.isInteger(j.ledger?.beforeLength) || typeof j.ledger?.beforeSha256 !== 'string' || typeof j.ledger?.afterSha256 !== 'string') out.push('ledger')
  return out
}

/**
 * 🔴 **commit-forward** — journal 에 적힌 최종 바이트만 놓는다. 의미 판정(recordAdmission · proposeSlug)을 부르지 않는다.
 *    ledger 를 줄이거나 이전 바이트로 되돌리는 경로는 없다. before 도 after 도 아니면 CONFLICT 로 멈추고 덮지 않는다.
 */
function commitForward(j, faultHook) {
  const R = j.receipt, S = j.slugManifest, L = j.ledger
  // ① receipt
  const curReceipt = readOptional(R.path)
  if (curReceipt === null) {
    // 급사로 남은 임시 receipt 조각을 치운다 — 본 파일이 아니므로 판정에는 쓰이지 않는다
    const dir = path.dirname(R.path)
    if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) if (n.startsWith(`${path.basename(R.path)}.g8tmp-`)) fs.rmSync(path.join(dir, n), { force: true })
    faultHook('receipt:before', { file: R.path })
    placeReceipt(R.path, R.bytes)
  } else if (sha256(curReceipt) !== R.sha256) return { ok: false, code: 'RECEIPT_CONFLICT', why: `${R.path} 가 journal 의 receipt 와 다르다 — 덮지 않는다` }
  faultHook('receipt:written')
  // ② slug manifest
  const curSlug = shaOrAbsent(readOptional(S.path))
  if (curSlug === S.beforeSha256) writeAtomic(S.path, S.afterBytes)
  else if (curSlug !== S.afterSha256) return { ok: false, code: 'SLUG_MANIFEST_CONFLICT', why: `${S.path} 가 before 도 after 도 아니다 — 덮지 않는다` }
  faultHook('slug:written')
  // ③ ledger — 바이트 단위 접두 대조 뒤 남은 부분만 붙인다
  const cur = fs.existsSync(L.path) ? fs.readFileSync(L.path) : Buffer.alloc(0)
  const append = Buffer.from(L.appendBytes, 'utf8')
  if (sha256(cur) !== L.afterSha256) {
    const head = cur.subarray(0, L.beforeLength)
    const tail = cur.subarray(L.beforeLength)
    const headSha = L.beforeSha256 === 'ABSENT' && L.beforeLength === 0 ? 'ABSENT' : sha256(head)
    if (cur.length < L.beforeLength || headSha !== L.beforeSha256 || !append.subarray(0, tail.length).equals(tail)) {
      return { ok: false, code: 'LEDGER_CONFLICT', why: `${L.path} 앞부분이 journal 의 before 와 다르다 — 줄이지도 덮지도 않는다` }
    }
    const rest = append.subarray(tail.length)
    if (rest.length) {
      // 시험 급사 재현 지점 — 훅이 일부만 붙이고 죽을 수 있다(운영 훅은 아무것도 하지 않는다)
      faultHook('ledger:append', { file: L.path, bytes: rest, appendLedger })
      appendLedger(L.path, rest)
    }
  }
  faultHook('ledger:written')
  const after = { receipt: sha256(readOptional(R.path) ?? ''), slug: shaOrAbsent(readOptional(S.path)), ledger: sha256(fs.readFileSync(L.path)) }
  if (after.receipt !== R.sha256 || after.slug !== S.afterSha256 || after.ledger !== L.afterSha256) {
    return { ok: false, code: 'COMMIT_MISMATCH', why: `쓰기 뒤 해시가 journal 과 다르다 (${JSON.stringify(after)})` }
  }
  return { ok: true }
}

function finishJournal({ researchDir, repoDir, journalPath, knownLegacy }) {
  const v = verifyAdmissions({
    receipts: readReceipts(researchDir),
    slugManifestText: readOptional(path.join(researchDir, ADMISSION_FILES.slugManifest)),
    ledgerText: readOptional(path.join(researchDir, ADMISSION_FILES.ledger)),
    payloadOf: productPayloadOf(repoDir), journalPresent: false, knownLegacy,
  })
  if (!v.ok) return { ok: false, code: 'VERIFY_FAILED', why: v.problems.slice(0, 5).join(' / ') }
  fs.unlinkSync(journalPath)
  return { ok: true }
}

/** 잠금 안에서 남은 journal 을 끝까지 완성한다 */
async function recoverJournal({ researchDir, repoDir, faultHook, knownLegacy }) {
  const journalPath = path.join(researchDir, JOURNAL_FILE)
  let j
  try { j = JSON.parse(fs.readFileSync(journalPath, 'utf8')) } catch (e) { return { ok: false, code: 'RECOVERY_IDENTITY', why: `journal 을 읽지 못했다: ${e.message}` } }
  const bad = admissionJournalProblems(j, researchDir)
  if (bad.length) return { ok: false, code: 'RECOVERY_IDENTITY', why: bad.join(', ') }
  const c = commitForward(j, faultHook)
  if (!c.ok) return c
  const f = finishJournal({ researchDir, repoDir, journalPath, knownLegacy })
  return f.ok ? { ok: true, code: 'RECOVERED', manifestHash: j.manifestHash } : f
}

async function loadPipeline(researchDir) {
  const pipelinePath = path.join(researchDir, RESEARCH_FILES.pipelineModule)
  if (!fs.existsSync(pipelinePath)) return null
  const pipeline = await import(pathToFileURL(pipelinePath).href)
  if (typeof pipeline.recordAdmission !== 'function' || typeof pipeline.validateLedger !== 'function') return null
  return pipeline
}

/**
 * 🔴 **staged preflight** — 임시 공간에서 세 최종 상태를 전부 만들고 검증한다. 실제 파일은 건드리지 않는다.
 *    한 admission 이라도 실패하면 아무것도 쓰지 않는다.
 */
function stageAdmission({ manifest, researchDir, repoDir, pipeline, approval, committedAt, knownLegacy }) {
  const receipt = makeReceipt({ manifest, approval, committedAt })
  const rBytes = receiptBytes(receipt)
  const slugPath = path.join(researchDir, ADMISSION_FILES.slugManifest)
  const ledgerPath = path.join(researchDir, ADMISSION_FILES.ledger)
  const slugBefore = readOptional(slugPath)
  const sm = slugBefore === null ? { _note: '🔴 intentId ↔ slug 영구 대응. 한 번 정하면 바꾸지 않는다', slugs: {} } : JSON.parse(slugBefore)
  const nextSlugs = { ...(sm.slugs ?? {}) }
  for (const a of manifest.admissions) {
    if (nextSlugs[a.intentId] !== undefined) return { ok: false, code: 'INTENT_BOUND_ELSEWHERE', why: `${a.intentId} → ${nextSlugs[a.intentId]}` }
    if (Object.values(nextSlugs).includes(a.slug)) return { ok: false, code: 'SLUG_BOUND_ELSEWHERE', why: a.slug }
    nextSlugs[a.intentId] = a.slug
  }
  const slugAfter = `${JSON.stringify({ ...sm, slugs: nextSlugs }, null, 2)}\n`

  const ledgerBefore = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath) : null
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-stage-'))
  try {
    const stateFile = path.join(dir, 'm3-state.jsonl')
    fs.writeFileSync(stateFile, ledgerBefore ?? '')
    for (const a of manifest.admissions) {
      const r = pipeline.recordAdmission({ stateFile, item: ledgerItemOf(a), at: committedAt })
      if (!r.ok || !r.appended) return { ok: false, code: 'ADMISSION_REJECTED', why: `${a.intentId}: ${r.ok ? '새 사건이 아니다 (idempotent)' : r.why}` }
    }
    const ledgerAfter = fs.readFileSync(stateFile)
    const before = ledgerBefore ?? Buffer.alloc(0)
    if (!ledgerAfter.subarray(0, before.length).equals(before)) return { ok: false, code: 'LEDGER_NOT_APPEND_ONLY', why: '최종 ledger 가 기존 바이트로 시작하지 않는다' }
    const lv = pipeline.validateLedger(parseJsonl(ledgerAfter.toString('utf8'), 'ledger'))
    if (!lv.ok) return { ok: false, code: 'ADMISSION_REJECTED', why: lv.problems[0] }

    const receiptFile = receiptPathOf(researchDir, manifest.hash)
    const v = verifyAdmissions({
      receipts: [...readReceipts(researchDir), { file: receiptFile, text: rBytes }],
      slugManifestText: slugAfter, ledgerText: ledgerAfter.toString('utf8'),
      payloadOf: productPayloadOf(repoDir), journalPresent: false, knownLegacy,
    })
    if (!v.ok) return { ok: false, code: 'STAGED_VERIFY_FAILED', why: v.problems.slice(0, 5).join(' / ') }
    return {
      ok: true,
      journal: {
        schema: ADMISSION_JOURNAL_SCHEMA, manifestHash: manifest.hash, phase: 'PREPARED',
        receipt: { path: receiptFile, bytes: rBytes, sha256: sha256(rBytes) },
        slugManifest: { path: slugPath, beforeSha256: shaOrAbsent(slugBefore), afterBytes: slugAfter, afterSha256: sha256(slugAfter) },
        ledger: { path: ledgerPath, beforeSha256: ledgerBefore === null ? 'ABSENT' : sha256(ledgerBefore), beforeLength: before.length,
          appendBytes: ledgerAfter.subarray(before.length).toString('utf8'), afterSha256: sha256(ledgerAfter) },
      },
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** 동일 manifest 가 이미 세 곳에 정확히 있는가 */
function alreadyApplied({ manifest, researchDir, repoDir, knownLegacy }) {
  const file = receiptPathOf(researchDir, manifest.hash)
  const text = readOptional(file)
  if (text === null) return { state: 'ABSENT' }
  const r = (() => { try { return JSON.parse(text) } catch { return null } })()
  if (!r || canonicalJson(r.manifest) !== canonicalJson(manifest)) return { state: 'CONFLICT', why: 'receipt 의 manifest 가 이 manifest 가 아니다' }
  const v = verifyAdmissionState({ researchDir, repoDir, knownLegacy })
  return v.ok ? { state: 'COMPLETE' } : { state: 'INCOMPLETE', why: v.problems.slice(0, 5).join(' / ') }
}

/**
 * 🔴 **명시적 apply** — 연구 세 파일만 쓴다. 제품 파일 · topic queue 는 쓰지 않는다.
 *   lock → 남은 journal 완성 → ALREADY_APPLIED 판정 → 입력 15개 재해시 · graph · readiness 재검증
 *   → 승인 형식 → staged preflight → journal → receipt wx → slug 원자 교체 → ledger append → 검증 → journal 삭제 → unlock
 *
 * 🔴 journal 을 쓴 뒤의 예외는 급사와 같다 — 잠금 · journal 을 남긴다(`recoverStaleLock` 이 이어서 완성한다).
 */
export async function applyAdmissions({ manifest, repoDir, researchDir, snapshotDir, approval, committedAt, faultHook = testPauseHook(), knownLegacy = KNOWN_LEGACY_ADMISSIONS }) {
  if (manifest?.schema !== G8_SCHEMA) return { ok: false, code: 'SCHEMA', why: `manifest schema 가 ${G8_SCHEMA} 가 아니다` }
  if (hashManifest(manifest) !== manifest.hash) return { ok: false, code: 'HASH_MISMATCH', why: 'manifest 본문과 해시가 다르다' }
  if (!isRealKstAt(committedAt)) return { ok: false, code: 'AT_INVALID', why: 'committedAt 은 실제 KST 시각이어야 한다' }
  const ap = approvalProblems(approval, manifest.hash)
  if (ap.length) return { ok: false, code: 'APPROVAL_INVALID', why: ap.join(', ') }

  const lock = acquireLock(researchDir, manifest.hash)
  if (!lock.ok) return lock
  faultHook('locked')
  const done = (r) => { releaseLock(lock); return r }

  // ① 남은 journal 을 먼저 끝까지 완성한다
  let recovered = null
  if (fs.existsSync(path.join(researchDir, JOURNAL_FILE))) {
    recovered = await recoverJournal({ researchDir, repoDir, faultHook, knownLegacy })
    if (!recovered.ok) return done({ ...recovered, recovered })
  }
  // ② 이미 전부 반영된 같은 manifest
  const already = alreadyApplied({ manifest, researchDir, repoDir, knownLegacy })
  if (already.state === 'COMPLETE') return done({ ok: true, code: 'ALREADY_APPLIED', written: [], recovered })
  if (already.state !== 'ABSENT') return done({ ok: false, code: 'ADMISSION_INCONSISTENT', why: already.why, recovered })

  // ③ 입력 15개 · graph · readiness 재검증 — 다르면 journal 전에 멈춘다
  let current
  try { current = readIdentityInputs({ repoDir, researchDir, snapshotDir }) } catch (e) { return done({ ok: false, code: 'STALE_INPUT', why: e.message, recovered }) }
  const stale = Object.keys({ ...manifest.identityInputHashes, ...current.hashes }).filter((k) => manifest.identityInputHashes?.[k] !== current.hashes[k]).sort()
  if (stale.length) return done({ ok: false, code: 'STALE_INPUT', why: `manifest 이후 바뀌었다: ${stale.join(', ')}`, stale, recovered })
  let rebuilt
  try {
    rebuilt = await buildManifest({ repoDir, researchDir, snapshotDir, at: manifest.at })
  } catch (e) { return done({ ok: false, code: 'STALE_INPUT', why: e.message, recovered }) }
  if (canonicalJson(rebuilt.graph) !== canonicalJson(manifest.graph)) return done({ ok: false, code: 'STALE_INPUT', why: 'graph 신원이 manifest 와 다르다', recovered })
  if (rebuilt.readiness.readinessHash !== manifest.readiness?.readinessHash) return done({ ok: false, code: 'READINESS_STALE', why: 'readinessHash 가 manifest 와 다르다', recovered })
  if (rebuilt.hash !== manifest.hash) return done({ ok: false, code: 'MANIFEST_MISMATCH', why: '같은 입력으로 다시 만든 manifest 가 다르다', recovered })
  if (!manifest.admissions.length) return done({ ok: true, code: 'NOTHING_TO_APPLY', written: [], recovered })
  const pre = verifyAdmissionState({ researchDir, repoDir, knownLegacy })
  if (!pre.ok) return done({ ok: false, code: 'ADMISSION_INCONSISTENT', why: pre.problems.slice(0, 5).join(' / '), recovered })

  // ④ staged preflight
  const pipeline = await loadPipeline(researchDir)
  if (!pipeline) return done({ ok: false, code: 'PIPELINE_MISSING', why: 'm3-pipeline.mjs 의 recordAdmission · validateLedger', recovered })
  const staged = stageAdmission({ manifest, researchDir, repoDir, pipeline, approval, committedAt, knownLegacy })
  if (!staged.ok) return done({ ...staged, recovered })
  faultHook('journal:before')

  // ⑤ journal → commit-forward (이후 예외는 급사와 같다)
  const journalPath = path.join(researchDir, JOURNAL_FILE)
  writeAtomic(journalPath, JSON.stringify(staged.journal))
  faultHook('journal:written')
  const c = commitForward(staged.journal, faultHook)
  if (!c.ok) return done({ ...c, recovered })
  const f = finishJournal({ researchDir, repoDir, journalPath, knownLegacy })
  if (!f.ok) return done({ ...f, recovered })
  return done({ ok: true, code: 'APPLIED', written: ['receipt', 'slugManifest', 'ledger'], admissions: manifest.admissions.length, hash: manifest.hash, recovered })
}

/**
 * 🔴 **stale lock 의 유일한 명시 경로** — 사람이 확인한 잠금 파일 sha256 이 지금 파일과 같을 때만 넘겨받는다.
 *    journal 이 있으면 잠금만 지우지 않는다 — 넘겨받은 잠금 안에서 journal 을 끝까지 완성한 뒤에 놓는다.
 *
 * 🔴 **확인한 그 잠금만 넘겨받는다** (2026-10-22 · 확인-덮어쓰기 경쟁 제거). 경로를 무조건 덮어쓰지 않는다.
 *    ① 복구끼리는 O_EXCL takeover 표식으로 하나만 — 동시 복구는 LOCK_RACE
 *    ② 확인한 잠금을 rename 으로 경로에서 떼어 내고, **떼어 낸 파일**의 sha256 을 다시 본다
 *       — 그 사이 새 holder 잠금으로 바뀌었으면 같은 inode 를 link 로 제자리에 되돌리고 LOCK_RACE
 *    ③ 내 잠금은 O_EXCL 로만 만든다 — 그 사이 새 holder 가 먼저 잡았으면 LOCK_RACE (그 잠금은 그대로)
 *    takeover 표식이 급사로 남으면 사람이 지운다 — 자동으로 지우지 않는다.
 */
export async function recoverStaleLock({ researchDir, repoDir, expectLockSha256, operator, faultHook = () => {}, knownLegacy = KNOWN_LEGACY_ADMISSIONS }) {
  const file = path.join(researchDir, LOCK_FILE)
  if (!String(operator ?? '').trim() || MACHINE_APPROVER.test(String(operator).trim())) return { ok: false, code: 'OPERATOR_INVALID', why: '사람 operator 가 필요하다' }
  const race = (why) => ({ ok: false, code: 'LOCK_RACE', why })
  const takeover = `${file}.takeover`
  let tfd
  try { tfd = fs.openSync(takeover, 'wx') } catch (e) {
    if (e.code === 'EEXIST') return race(`다른 잠금 복구가 진행 중이다 (${path.basename(takeover)}) — 자동으로 지우지 않는다`)
    if (e.code === 'ENOENT') return { ok: false, code: 'NO_LOCK', why: '잠금 파일이 없다' }
    throw e
  }
  try { fs.writeSync(tfd, `${JSON.stringify({ host: os.hostname(), pid: process.pid, operator })}\n`); fs.fsyncSync(tfd) } finally { fs.closeSync(tfd) }
  try {
    const text = readOptional(file)
    if (text === null) return { ok: false, code: 'NO_LOCK', why: '잠금 파일이 없다' }
    if (sha256(text) !== expectLockSha256) return { ok: false, code: 'LOCK_SHA_MISMATCH', why: `잠금 파일 sha256 이 ${expectLockSha256} 가 아니다 — 아무것도 하지 않는다` }
    faultHook('lock:checked', { file })
    const claim = `${file}.claimed-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
    try { fs.renameSync(file, claim) } catch (e) {
      if (e.code === 'ENOENT') return race('확인한 뒤 잠금이 사라졌다')
      throw e
    }
    const claimed = fs.readFileSync(claim, 'utf8')
    if (sha256(claimed) !== expectLockSha256) {
      // 확인한 뒤 새 holder 잠금으로 바뀌었다 — 같은 inode 를 제자리에 되돌린다(덮지 않는다)
      try { fs.linkSync(claim, file); fs.rmSync(claim) } catch { return race(`새 holder 잠금을 되돌리지 못했다 — ${claim} 에 보존했다 (사람 확인)`) }
      return race('확인한 뒤 경로가 새 holder 잠금으로 바뀌었다 — 그 잠금을 그대로 두었다')
    }
    faultHook('lock:claimed', { file })
    const body = `${JSON.stringify({ schema: LOCK_SCHEMA, host: os.hostname(), pid: process.pid, startedAt: new Date().toISOString(), takeoverOf: expectLockSha256, operator })}\n`
    let fd
    try { fd = fs.openSync(file, 'wx') } catch (e) {
      if (e.code === 'EEXIST') { fs.rmSync(claim); return race('stale 잠금을 떼어 낸 사이 새 holder 가 먼저 잠갔다 — 그 잠금을 그대로 두었다') }
      throw e
    }
    try { fs.writeSync(fd, body); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.rmSync(claim)
    return await finishTakeover({ lock: { file, body }, researchDir, repoDir, faultHook, knownLegacy })
  } finally {
    fs.rmSync(takeover, { force: true })
  }
}

/** 넘겨받은 잠금 안에서 남은 journal 을 완성하고 잠금을 놓는다 */
async function finishTakeover({ lock, researchDir, repoDir, faultHook, knownLegacy }) {
  if (fs.existsSync(path.join(researchDir, JOURNAL_FILE))) {
    const r = await recoverJournal({ researchDir, repoDir, faultHook, knownLegacy })
    releaseLock(lock)
    return r.ok ? { ok: true, code: 'STALE_LOCK_RECOVERED', manifestHash: r.manifestHash } : r
  }
  releaseLock(lock)
  return { ok: true, code: 'STALE_LOCK_RELEASED' }
}

/** CLI 용 — manifest 를 읽고 해시를 확인한다 */
export function readManifestFile(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { manifest, valid: hashManifest(manifest) === manifest.hash }
}

// ── 큐 행 렌더 (등록 · 입력 수리 · 시험이 쓰는 공용 helper — G8 은 큐를 쓰지 않는다) ──

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
function tsValue(v) {
  if (Array.isArray(v)) return `[${v.map(tsValue).join(', ')}]`
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${tsValue(x)}`).join(', ')} }`
  if (typeof v === 'string') return q(v)
  return String(v)
}
/** 기존 큐와 같은 들여쓰기 · 홑따옴표 · 키 순서 */
export function renderQueueRow(row) {
  return `  {\n${Object.entries(row).map(([k, v]) => `    ${k}: ${tsValue(v)},`).join('\n')}\n  },\n`
}

export function insertQueueRows(src, rows) {
  const anchor = src.indexOf('export const TOPIC_QUEUE')
  if (anchor === -1) throw new Error('TOPIC_QUEUE 를 찾지 못했다')
  const assign = src.indexOf('=', anchor)
  const literal = sliceLiteral(src, assign, '[', ']')
  if (!literal) throw new Error('TOPIC_QUEUE 배열 경계를 찾지 못했다')
  const close = src.indexOf(literal, assign) + literal.length - 1
  return src.slice(0, close) + rows.map(renderQueueRow).join('') + src.slice(close)
}

/**
 * 🔴 **(G8 v1 큐 행 대조 — 운영 소비자 없음 · 2026-10-22 PR C)** G8 큐 행(intentId·g8ManifestHash)마다 장부 ADMITTED 사건이 있고,
 *    장부 사건마다 큐 행이 있거나 **등록된 글**이어야 한다. 영구 slug 표가 그 짝을 묶고 있어야 한다.
 *    v2 에서는 admission 이 큐보다 먼저 오므로 「장부에 있는데 큐에 없음」이 정상이다 — ArticlePlan(authoring)은 이 함수 대신
 *    `verifyAdmissions` + slug 하나의 receipt ∧ binding ∧ ledger 대조(`readAdmission`)를 쓴다. 남은 호출은 G8 검사의 v1 반례뿐이다.
 */
export function verifyConsistency({ queueSource, articlesSource = null, ledgerSource, slugManifestSource, journalPresent = false }) {
  const problems = []
  const queue = parseQueueSource(queueSource)
  const articles = articlesSource ? new Set(parseArticlesSource(articlesSource).map((a) => a.slug)) : new Set()
  const ledger = parseJsonl(ledgerSource ?? '', 'ledger')
  const slugs = slugManifestSource ? JSON.parse(slugManifestSource).slugs ?? {} : {}
  const key = (r) => `${r.intentId}|${r.slug}`
  const qRows = queue.filter((r) => r.g8ManifestHash)
  const qKeys = new Set(qRows.map(key))
  const lRows = ledger.filter((r) => r.event === 'ADMITTED')
  const lKeys = new Set(lRows.map(key))
  if (journalPresent) problems.push('PENDING_JOURNAL — 끝나지 않은 apply 가 있다 (다음 apply 가 되돌린다)')
  for (const r of qRows) if (!lKeys.has(key(r))) problems.push(`QUEUE_WITHOUT_ADMISSION — ${r.g8ManifestHash}|${key(r)}`)
  for (const r of lRows) {
    if (!qKeys.has(key(r)) && !articles.has(r.slug)) problems.push(`ADMISSION_WITHOUT_QUEUE — ${key(r)}`)
  }
  for (const r of [...qRows, ...lRows]) {
    if (slugs[r.intentId] !== r.slug) problems.push(`SLUG_UNBOUND — ${r.intentId} → ${r.slug} (표: ${slugs[r.intentId] ?? '없음'})`)
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] }
}
