/**
 * ArticlePlan — `magazine-article-spec-source/2` 의 **후보(DRAFT) 생산 · 사람의 명시적 승인 · 큐 materialize**.
 *
 * 🔴 **왜 바뀌었나** (2026-10-22 · M-GRAPH PR C).
 *    G8 v2 는 큐를 쓰지 않는다 — 연구 admission(receipt · slug manifest · ledger)만 기록한다.
 *    앞판 prepare 는 G8 이 넣은 큐 행을 전제로 했으므로, admission 만 있는 지금 상태를 읽지 못했다
 *    (v1 대조는 「장부에 있는데 큐에 없는 행」을 불일치로 본다). 이제 G8 admission 을 사람이 승인하는
 *    ArticlePlan 으로 잇고, 큐 행은 승인 entry 에서만 만든다.
 *
 * 🔴 **세 단계를 섞지 않는다.**
 *    prepare      읽기 전용. 지정한 slug 하나의 admission(receipt ∧ slug binding ∧ ledger)과 현재 제품 graph 를
 *                 검증하고 DRAFT 후보를 돌려준다. 큐 행을 요구하지 않는다. 관계는 receipt 의 edge 로 고정한다.
 *                 기계가 증거로 확정할 수 없는 필드(plan · 문장 · outline · 근거 · hero · CTA)는 null 로 남긴다.
 *    approve      사람이 채운 후보 · 승인자 · 승인 시각 · 확인한 후보 해시를 받아 admission · graph 를 **다시 전부**
 *                 대조한 뒤에만 `drafts/magazine/article-spec-source/<graphVersion>.json` 에 entry 하나를 원자적으로 더한다.
 *    materialize  승인 entry 하나에서 queue 행 하나를 만든다(`queueRowFromEntry`). 큐 writer lock 안에서
 *                 day = max(day)+1 로 정하고, 쓴 뒤 같은 parser 로 다시 읽어 행이 정확히 같은지 본다.
 *
 * 🔴 관계 증거는 **연구 G8 receipt + 현재 제품 graph bundle** 이다. receipt 의 edgeId 를 지금 bundle 의 edge
 *    (from · to · slot · anchor · reason)와 대상 mapping slug 로 다시 맞춘다. 남거나 모자라도 고르거나 채우지 않는다.
 * 🔴 시각은 주입 가능한 `nowMs`(기본 Date.now()) 기준이다. 미래 시각으로 미래 공개 글을 승인하지 못한다.
 * 🔴 네트워크 · Chrome · CDP · 모델 호출 0. 연구 receipt · slug manifest · ledger · articles · graph · control 을 쓰지 않는다.
 *    큐는 materialize 만 쓴다.
 */

import { createHash } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { canonicalJson } from './magazine-article-spec.mjs'
import {
  ADMISSION_FIELDS, ARTICLE_PLAN_OPTIONAL, ARTICLE_PLAN_REQUIRED, DIRECT_SPEC_SOURCE_DIRNAME, DIRECT_SPEC_SOURCE_SCHEMA,
  DISCOVERY_RELATION_TYPE, directSpecSourceHash, judgeDirectSpecSource, missingSourceFields, productBasisFor,
  queueRowFromEntry, readProductGraphState,
} from './magazine-direct-spec-source.mjs'
import {
  ADMISSION_FILES, JOURNAL_FILE, KNOWN_LEGACY_ADMISSIONS, LOCK_FILE, insertQueueRows, productPayloadOf, readReceipts,
  receiptProblems, titleProblems, verifyAdmissions, writeAtomic,
} from './magazine-g8-promoter.mjs'
import { isPublic, resolvePublishAt } from './magazine-gate.mjs'
import { parseArticlesSource, parseQueueSource } from './magazine-load.mjs'
import { withQueueWriteLock } from './magazine-queue-lock.mjs'
import { RELATION_CONTRACT_LABEL, isSingleDiscovery, isValidDirectCount } from './magazine-relation-policy.mjs'

export const CANDIDATE_SCHEMA = 'magazine-article-spec-source-candidate/2'
export const CANDIDATE_STATUS = 'DRAFT'
export const G8_LEDGER_SCHEMA = 'm3ledger/2'
export const RESEARCH_INTENT_SCHEMA = 'intent/2'

const DIRECT_SLOTS = new Set(['DIRECT_NEXT', 'SAME_EXPERIENCE', 'ACTION_OR_CONTEXT'])
const DISCOVERY_SLOT = 'BRIDGE_DISCOVERY'
const DISCOVERY_TYPE = DISCOVERY_RELATION_TYPE
const KST_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+09:00$/
/** 🔴 운영 runtime 작업장에는 쓰지 않는다 — 승인 artifact · 큐 행은 기능 브랜치에서 검토를 거쳐 들어간다 */
export const RUNTIME_PATH_PATTERNS = [/soransoran-magazine-runtime(?:\/|$)/]
/** 🔴 기계 승인 표식 — 사람 승인만 받는다 */
const MACHINE_APPROVER = /:|^(?:machine|bot|auto|automation|system|ci|agent|claude|codex|chatgpt|gpt|openai|anthropic)\b/i

const PRODUCT = {
  articles: 'src/content/magazine/articles.ts',
  queue: 'drafts/magazine/topic-queue.ts',
}
const RESEARCH = { manifest: 'contract/build/current/manifest.json', intents: 'contract/build/current/intents.jsonl' }

/**
 * 🔴 **admission 신원 거부 사유 — 우선순위 순서.** 이 중 하나라도 있으면 prepare · approve · materialize 가 멈춘다.
 *    (graph control · surface 같은 판 상태는 후보 blocker 로 남긴다 — 사람이 볼 수 있게)
 */
export const ADMISSION_REJECT_ORDER = Object.freeze([
  'ADMISSION_IN_PROGRESS', 'ADMISSION_LOCKED', 'RECEIPT_ABSENT', 'RECEIPT_DUPLICATE', 'RECEIPT_INVALID',
  'SLUG_BINDING_MISMATCH', 'LEDGER_MISMATCH', 'G8_INCONSISTENT', 'ADMISSION_GRAPH_STALE', 'RECEIPT_EDGE_DRIFT',
  'ADMISSION_CLUSTER_DRIFT', 'SLUG_ALREADY_REGISTERED', 'ALREADY_QUEUED', 'ALREADY_PLANNED',
])

const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''

function err(code, why) { const e = new Error(why); e.code = code; return e }
function readText(path, label) {
  try { return readFileSync(path, 'utf8') } catch (e) { throw err('INPUT_UNREADABLE', `${label} 를 읽지 못했다 (${path}): ${e.code ?? e.message}`) }
}
const readOptional = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)
const parseJsonl = (text) => String(text ?? '').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))

/**
 * 실제 KST 시각인가 — 형식뿐 아니라 날짜가 존재해야 한다(2026-02-30 거부).
 * @returns {number|null} epoch ms
 */
export function parseKst(value) {
  const m = KST_AT.exec(String(value ?? ''))
  if (!m) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  const back = new Date(ms + 9 * 3600e3).toISOString().slice(0, 19)
  return back === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` ? ms : null
}

/**
 * 제품 graph — **공용 판독(`readProductGraphState`)을 그대로 쓴다.** authoring 과 소비 관문이 같은 구현을 본다.
 * 🔴 pointer · bundle · EXPORT_HASH · control 판이 어긋나면 그 판을 증거로 쓰지 않는다.
 */
export function readProductGraph(repoRoot) {
  return readProductGraphState(repoRoot)
}

/**
 * 🔴 **plan 허용값 — topic-queue.ts 의 union 을 그대로 읽는다.** 값 목록을 여기 복사하지 않는다.
 *    union 하나라도 못 읽으면 던진다(PLAN_UNIONS_UNREADABLE) — 임의 문자열로 완화하지 않는다.
 */
export function readQueueUnions(queueText) {
  const literals = (body) => [...String(body).matchAll(/'([^']*)'/g)].map((m) => m[1])
  const union = (name) => {
    const m = new RegExp(`export type ${name} = ((?:\\s*\\|?\\s*'[^']*')+)`).exec(queueText)
    if (!m) throw err('PLAN_UNIONS_UNREADABLE', `topic-queue.ts 의 ${name} union 을 읽지 못했다`)
    return literals(m[1])
  }
  const profile = /validationProfile\?: ((?:\s*\|?\s*'[^']*')+)/.exec(queueText)
  if (!profile) throw err('PLAN_UNIONS_UNREADABLE', 'topic-queue.ts 의 validationProfile union 을 읽지 못했다')
  return {
    contentType: union('ContentType'),
    intent: union('SearchIntent'),
    riskLevel: union('RiskLevel'),
    reviewMode: union('ReviewMode'),
    ctaBoard: union('CtaBoard'),
    imageMode: union('ImageMode'),
    season: union('Season'),
    validationProfile: literals(profile[1]),
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/
/**
 * plan 검증 — 필수 값 null · 빈 문자열 · union 밖 값 · 모르는 키 · 선택 필드 형식.
 * @returns {string[]} 문제 코드 (`PLAN_REQUIRED_MISSING:title` 같은 형식)
 */
export function planProblems(plan, unions) {
  const out = []
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['PLAN_NOT_OBJECT']
  for (const k of Object.keys(plan)) if (![...ARTICLE_PLAN_REQUIRED, ...ARTICLE_PLAN_OPTIONAL].includes(k)) out.push(`PLAN_UNKNOWN_FIELD:${k}`)
  for (const k of ARTICLE_PLAN_REQUIRED) {
    const v = plan[k]
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) { out.push(`PLAN_REQUIRED_MISSING:${k}`); continue }
    if (unions[k] && !unions[k].includes(v)) out.push(`PLAN_VALUE_NOT_IN_UNION:${k}`)
    else if (!unions[k] && typeof v !== 'string') out.push(`PLAN_VALUE_INVALID:${k}`)
  }
  if (nonEmpty(plan.title)) for (const p of titleProblems(plan.title)) out.push(`PLAN_TITLE_INVALID:${p.split(' ')[0]}`)
  const given = (k) => plan[k] !== undefined && plan[k] !== null
  if (given('season') && !unions.season.includes(plan.season)) out.push('PLAN_VALUE_NOT_IN_UNION:season')
  if (given('calendarEvent') && !nonEmpty(plan.calendarEvent)) out.push('PLAN_VALUE_INVALID:calendarEvent')
  if (given('publishWindow')) {
    const w = plan.publishWindow
    const keysOk = w && typeof w === 'object' && !Array.isArray(w) && canonicalJson(Object.keys(w).sort()) === canonicalJson(['after', 'before'])
    if (!keysOk || !YMD.test(w.after) || !YMD.test(w.before) || w.after > w.before) out.push('PLAN_VALUE_INVALID:publishWindow')
  }
  if (given('seriesId') !== given('seriesOrder')) out.push('PLAN_SERIES_INCOMPLETE')
  if (given('seriesId') && !nonEmpty(plan.seriesId)) out.push('PLAN_VALUE_INVALID:seriesId')
  if (given('seriesOrder') && !(Number.isInteger(plan.seriesOrder) && plan.seriesOrder >= 1)) out.push('PLAN_VALUE_INVALID:seriesOrder')
  return [...new Set(out)]
}

/** 승인 entry 에 싣는 plan — 필수 키 + 값이 있는 선택 키만 (null 선택 키는 싣지 않는다) */
function normalizePlan(plan) {
  const out = {}
  for (const k of ARTICLE_PLAN_REQUIRED) out[k] = plan[k]
  for (const k of ARTICLE_PLAN_OPTIONAL) if (plan[k] !== undefined && plan[k] !== null) out[k] = plan[k]
  return out
}

/**
 * 연구 intent 참고 — `intents.jsonl` 원문 해시를 다시 계산해 manifest · 제품 graph 와 대조한다.
 * schema · intentId 중복까지 통과해야 hint 를 쓴다. edges · mappings 는 판이 같을 때만 '쓸 수 있음' 이다.
 */
export function readResearchReference({ researchDir, graph, intentId }) {
  if (!researchDir) return { used: false, reason: 'NOT_REQUESTED' }
  const manifest = JSON.parse(readText(join(researchDir, RESEARCH.manifest), '연구 manifest'))
  const intentsText = readText(join(researchDir, RESEARCH.intents), '연구 intents')
  const recomputed = createHash('sha256').update(intentsText).digest('hex').slice(0, 16)
  if (manifest?.contentHash?.intents !== recomputed) {
    throw err('RESEARCH_INTENTS_BODY_MISMATCH', `연구 intents 원문 해시(${recomputed}) 가 manifest(${manifest?.contentHash?.intents}) 와 다르다 — 참고하지 않는다`)
  }
  if (recomputed !== graph.contentHash?.intents) {
    throw err('RESEARCH_INTENT_HASH_MISMATCH', `연구 intent snapshot hash(${recomputed}) 가 제품 graph(${graph.contentHash?.intents}) 와 다르다 — 참고하지 않는다`)
  }
  const rows = parseJsonl(intentsText)
  if (rows.some((r) => r?.schemaVersion !== RESEARCH_INTENT_SCHEMA || !nonEmpty(r?.intentId))) throw err('RESEARCH_INTENT_SCHEMA', `연구 intent 판이 ${RESEARCH_INTENT_SCHEMA} 가 아니다`)
  const ids = rows.map((r) => r.intentId)
  if (new Set(ids).size !== ids.length) throw err('RESEARCH_INTENT_DUPLICATE', '연구 intent 에 중복 intentId 가 있다')
  const row = rows.find((x) => x.intentId === intentId) ?? null
  return {
    used: Boolean(row),
    reason: row ? 'INTENTS_HASH_EQUAL' : 'INTENT_NOT_IN_RESEARCH',
    researchGraphVersion: manifest.graphVersion ?? null,
    intentsHash: recomputed,
    relationsUsable: manifest.graphVersion === graph.graphVersion && manifest?.contentHash?.edges === graph.contentHash?.edges
      && manifest?.contentHash?.mappings === graph.contentHash?.mappings,
    // 🔴 참고(hint)일 뿐이다 — entry 를 채우지 않는다. 사람이 읽고 판단한다
    hint: row ? {
      intentId: row.intentId, primaryQuery: row.primaryQuery ?? null, audienceSituation: row.audienceSituation ?? null,
      answerScope: row.answerScope ?? null, exclusions: row.exclusions ?? null,
    } : null,
  }
}

const relTuple = (r) => (r ? `${r.slot}|${r.toIntentId}|${r.anchorLabel}|${r.readerReason}` : 'null')
/** receipt 관계 → source entry 관계 (대상은 receipt 의 targetSlug) */
const asRelation = (r) => ({ slug: r.targetSlug, source: 'M-GRAPH', relationType: r.slot, reason: r.readerReason })

/**
 * 🔴 **연구 admission 판독** — receipt ∧ slug binding ∧ ledger 를 이 slug 하나에 대해 정확히 맞춘다.
 *    journal(진행 중) · lock(진행 중) · receipt 없음 · binding 불일치 · ledger 불일치는 각자 명시 사유다.
 *    마지막으로 G8 의 `verifyAdmissions` 전체 판정(KNOWN_LEGACY 열거 포함)이 통과해야 한다.
 */
export function readAdmission({ admissionRoot, repoRoot, slug, knownLegacy = KNOWN_LEGACY_ADMISSIONS }) {
  const reject = []
  if (existsSync(join(admissionRoot, JOURNAL_FILE))) reject.push('ADMISSION_IN_PROGRESS')
  if (existsSync(join(admissionRoot, LOCK_FILE))) reject.push('ADMISSION_LOCKED')
  const receipts = readReceipts(admissionRoot)
  const hits = []
  for (const r of receipts) {
    let parsed = null
    try { parsed = JSON.parse(r.text) } catch { /* receiptProblems 가 RECEIPT_PARSE 로 센다 */ }
    for (const a of parsed?.manifest?.admissions ?? []) if (a?.slug === slug) hits.push({ file: r.file, text: r.text, receipt: parsed, admission: a })
  }
  if (!hits.length) reject.push('RECEIPT_ABSENT')
  else if (hits.length > 1) reject.push('RECEIPT_DUPLICATE')
  const hit = hits.length === 1 ? hits[0] : null
  if (hit && receiptProblems(hit.file, hit.text).length) reject.push('RECEIPT_INVALID')

  const slugText = readOptional(join(admissionRoot, ADMISSION_FILES.slugManifest))
  const ledgerText = readOptional(join(admissionRoot, ADMISSION_FILES.ledger))
  const slugs = slugText ? JSON.parse(slugText).slugs ?? {} : {}
  const ledger = parseJsonl(ledgerText)
  const a = hit?.admission ?? null
  let event = null
  if (a) {
    const owners = Object.entries(slugs).filter(([, s]) => s === slug).map(([id]) => id)
    if (slugs[a.intentId] !== slug || owners.length !== 1) reject.push('SLUG_BINDING_MISMATCH')
    const admitted = ledger.filter((e) => e?.event === 'ADMITTED')
    const exact = admitted.filter((e) => e.intentId === a.intentId && e.slug === slug)
    const crossed = admitted.filter((e) => (e.intentId === a.intentId) !== (e.slug === slug))
    event = exact.length === 1 ? exact[0] : null
    const sameRelations = event
      && canonicalJson((event.directRelations ?? []).map(relTuple)) === canonicalJson((a.direct ?? []).map(relTuple))
      && relTuple(event.discoveryRelation) === relTuple(a.discovery)
    if (!event || crossed.length || event.schemaVersion !== G8_LEDGER_SCHEMA || !nonEmpty(event.at) || !sameRelations) reject.push('LEDGER_MISMATCH')
  }
  const verify = verifyAdmissions({
    receipts, slugManifestText: slugText, ledgerText, payloadOf: productPayloadOf(repoRoot),
    journalPresent: existsSync(join(admissionRoot, JOURNAL_FILE)), knownLegacy,
  })
  if (!verify.ok) reject.push('G8_INCONSISTENT')
  return {
    reject: [...new Set(reject)],
    receipt: hit?.receipt ?? null,
    receiptFile: hit ? relative(admissionRoot, hit.file) : null,
    admission: a,
    event,
    verify,
  }
}

/** 지금 승인 source artifact 에서 slug 또는 intentId 의 entry */
function plannedEntries(repoRoot, graphVersion, { slug, intentId }) {
  const file = join(repoRoot, 'drafts/magazine', DIRECT_SPEC_SOURCE_DIRNAME, `${graphVersion}.json`)
  if (!existsSync(file)) return { file, doc: null, entries: [] }
  let doc
  try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { throw err('ARTIFACT_UNREADABLE', `source artifact 를 읽지 못했다: ${e.message}`) }
  const entries = (Array.isArray(doc?.entries) ? doc.entries : []).filter((x) => x?.node?.slug === slug || x?.node?.intentId === intentId)
  return { file, doc, entries }
}

/**
 * 현재 판의 신원 — prepare · approve · materialize 가 **같은 함수**로 읽는다. approve 는 이 값이 후보와 같아야 한다.
 * `phase` — 'plan'(prepare·approve: 이미 계획된 slug 거부) · 'materialize'(승인 entry 가 있어야 한다).
 * @returns {{ok:false, code, why, problems}|{ok:true, ...}}
 */
export function readCurrentState({ repoRoot, admissionRoot, slug, phase = 'plan', knownLegacy = KNOWN_LEGACY_ADMISSIONS }) {
  const productGraph = readProductGraph(repoRoot)
  if (!productGraph.ok) return { ...productGraph, ok: false }
  const { graph, control } = productGraph
  const articlesText = readText(join(repoRoot, PRODUCT.articles), 'articles.ts')
  const queueText = readText(join(repoRoot, PRODUCT.queue), 'topic-queue.ts')
  const articles = parseArticlesSource(articlesText)
  const queue = parseQueueSource(queueText)
  const adm = readAdmission({ admissionRoot, repoRoot, slug, knownLegacy })
  const reject = [...adm.reject]
  const a = adm.admission
  const intentId = a?.intentId ?? null

  if (a) {
    const receiptGv = adm.receipt.manifest?.graph?.graphVersion ?? null
    if (receiptGv !== productGraph.pointer) reject.push('ADMISSION_GRAPH_STALE')
    // 🔴 receipt 의 edge 를 지금 제품 bundle 과 다시 맞춘다 — id · from · to · slot · anchor · reason · 대상 mapping slug
    for (const r of [...(a.direct ?? []), ...(a.discovery ? [a.discovery] : [])]) {
      const e = graph.edges.find((x) => x.id === r.edgeId)
      const targets = graph.mappings.filter((m) => m.intent === r.toIntentId).map((m) => m.slug)
      if (!e || e.from !== intentId || e.to !== r.toIntentId || e.slot !== r.slot || e.anchor !== r.anchorLabel || e.reason !== r.readerReason
        || targets.length !== 1 || targets[0] !== r.targetSlug) { reject.push('RECEIPT_EDGE_DRIFT'); break }
    }
    const graphIntent = graph.intents.find((i) => i.id === intentId) ?? null
    if (!graphIntent || graphIntent.cluster !== a.cluster) reject.push('ADMISSION_CLUSTER_DRIFT')
    if (articles.some((x) => x.slug === slug)) reject.push('SLUG_ALREADY_REGISTERED')
    if (queue.some((q) => q.slug === slug || (intentId && q.intentId === intentId))) reject.push('ALREADY_QUEUED')
    if (phase === 'plan' && plannedEntries(repoRoot, productGraph.pointer, { slug, intentId }).entries.length) reject.push('ALREADY_PLANNED')
  }
  if (reject.length) {
    const ordered = ADMISSION_REJECT_ORDER.filter((c) => reject.includes(c))
    return { ok: false, code: ordered[0], why: `admission 신원이 맞지 않는다: ${ordered.join(',')}`, problems: ordered,
      verifyProblems: adm.verify.problems }
  }

  const blockers = [...productGraph.blockers]
  const sourceCluster = a.cluster
  if (!control.enabledClusters.includes(sourceCluster)) blockers.push('GRAPH_CLUSTER_DISABLED')
  const productBasis = productBasisFor(productGraph, { intentId, queueCluster: sourceCluster })
  const m = adm.receipt.manifest
  const admissionBlock = {
    g8ManifestHash: adm.receipt.manifestHash,
    receiptHash: adm.receipt.receiptHash,
    graphVersion: m.graph.graphVersion,
    readinessHash: m.readiness.readinessHash,
  }
  return {
    ok: true,
    graph, control, surfaces: productGraph.surfaces, relationTypes: productGraph.relationTypes, articles, sourceCluster, productBasis,
    admission: a,
    admissionBlock,
    relations: { direct: (a.direct ?? []).map(asRelation), discovery: a.discovery ? asRelation(a.discovery) : null },
    identity: {
      graphVersion: productGraph.pointer,
      contentHash: graph.contentHash,
      // 🔴 승인 entry 에 실릴 basis 와 같은 값 — 후보 이후 control·surface·resolver 계약이 바뀌면 STATE_CHANGED
      productBasis,
      admission: {
        ...admissionBlock, receiptFile: adm.receiptFile, intentId, slug, cluster: a.cluster,
        eventHash: sha(canonicalJson(adm.event)), edges: [...(a.direct ?? []), ...(a.discovery ? [a.discovery] : [])].map((r) => r.edgeId),
      },
      articlesHash: sha(articlesText),
    },
    blockers: [...new Set(blockers)],
  }
}

/** 관계 대상 글의 상태 — 판정 시각 기준 공개여야 한다 */
function targetState(articles, slug, atMs) {
  const a = articles.find((x) => x.slug === slug)
  if (!a) return { state: 'UNREGISTERED' }
  if (a.status === 'DRAFT' || a.status === 'BLOCKED') return { state: a.status }
  const publishMs = resolvePublishAt(a)
  return { state: isPublic(a, atMs) ? 'PUBLIC' : 'FUTURE', publishAt: new Date(publishMs + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00' }
}

/**
 * 현재 제품 graph 에서 intentId 의 나가는 관계 — 보이는 자리 · type · 대상 공개 상태.
 * 🔴 `active=false` 만으로 거부하지 않는다 — 미등록 source node 의 관계는 구조상 아직 비활성이다(preactivation).
 */
export function graphRelationEvidence({ state, intentId, atMs }) {
  const { graph, articles, surfaces, relationTypes } = state
  return graph.edges
    .filter((e) => e.from === intentId && e.slot)
    .map((e) => {
      const slugs = graph.mappings.filter((m) => m.intent === e.to).map((m) => m.slug)
      const slug = slugs.length === 1 ? slugs[0] : null
      const t = slug ? targetState(articles, slug, atMs) : { state: slugs.length ? 'MAPPING_AMBIGUOUS' : 'UNMAPPED' }
      const surfaceOk = surfaces.includes(e.placement)
      const typeOk = relationTypes.includes(e.type) && (e.slot !== DISCOVERY_SLOT || e.type === DISCOVERY_TYPE)
      const activation = e.active === true ? 'ACTIVE' : 'PREACTIVATION'
      return {
        edgeId: e.id, toIntent: e.to, slug, slot: e.slot, type: e.type, placement: e.placement, reason: e.reason,
        active: e.active === true, activation, surfaceOk, typeOk, target: t.state, targetPublishAt: t.publishAt ?? null,
        eligible: Boolean(slug) && t.state === 'PUBLIC' && nonEmpty(e.reason) && surfaceOk && typeOk,
        activationBasis: activation === 'ACTIVE'
          ? 'edge.active=true'
          : `미등록 source node 의 preactivation — control·surface(${e.placement}:${surfaceOk})·type(${e.type}:${typeOk})·target(${t.state}) 를 모두 본다`,
      }
    })
    .sort((a, b) => String(a.edgeId).localeCompare(String(b.edgeId)))
}

/**
 * 관계 수량(공용 정책 direct 2~3 + discovery 1) · 대상 공개 · 보이는 자리 · type 판정.
 * 🔴 M-GRAPH 관계는 현재 제품 graph 의 edge 와 slot · reason 까지 같아야 한다. HUB · SERIES 는 receipt 가 증명하지 않는다.
 */
export function judgeRelations({ relations, state, intentId, slug, atMs }) {
  const { articles } = state
  const problems = []
  const direct = Array.isArray(relations?.direct) ? relations.direct : null
  const discovery = relations?.discovery ?? null
  if (!direct || !isValidDirectCount(direct.length)) problems.push('RELATIONS_DIRECT_COUNT_INVALID')
  if (!isSingleDiscovery(discovery)) problems.push('RELATIONS_DISCOVERY_NOT_1')
  const single = isSingleDiscovery(discovery)
  const all = [...(direct ?? []), ...(single ? [discovery] : [])]
  const slugsOf = all.map((r) => r?.slug)
  if (slugsOf.includes(slug)) problems.push('RELATION_SELF')
  if (new Set(slugsOf).size !== slugsOf.length) problems.push('RELATION_DUPLICATE')
  const evidence = graphRelationEvidence({ state, intentId, atMs })
  all.forEach((r, i) => {
    const isDiscovery = single && i === all.length - 1
    if (!r || !nonEmpty(r.slug) || !nonEmpty(r.source) || !nonEmpty(r.relationType) || !nonEmpty(r.reason)) {
      problems.push('RELATION_FIELD_MISSING'); return
    }
    const t = targetState(articles, r.slug, atMs)
    if (t.state === 'UNREGISTERED') problems.push('RELATION_TARGET_UNREGISTERED')
    else if (t.state === 'FUTURE') problems.push('RELATION_TARGET_NOT_YET_PUBLIC')
    else if (t.state !== 'PUBLIC') problems.push('RELATION_TARGET_NOT_PUBLIC')
    if (r.source === 'M-GRAPH') {
      const proof = evidence.find((e) => e.slug === r.slug && e.slot === r.relationType && e.reason === r.reason)
      if (!proof) problems.push('RELATION_NOT_IN_PRODUCT_GRAPH')
      else {
        if (!proof.surfaceOk) problems.push('RELATION_SURFACE_DISABLED')
        if (!proof.typeOk) problems.push('RELATION_TYPE_INVALID')
      }
      const wantSlot = isDiscovery ? r.relationType === DISCOVERY_SLOT : DIRECT_SLOTS.has(r.relationType)
      if (!wantSlot) problems.push('RELATION_SLOT_MISMATCH')
    } else {
      problems.push(r.source === 'HUB' ? 'RELATION_HUB_UNPROVABLE' : 'RELATION_SOURCE_UNKNOWN')
    }
  })
  return { ok: problems.length === 0, problems: [...new Set(problems)], evidence }
}

export function candidateHashOf(candidate) {
  const { candidateHash: _omit, ...body } = candidate ?? {}
  return sha(canonicalJson(body))
}

/** 후보에서 아직 사람이 채우지 않은 필드 — 소비 관문과 **같은 함수**(`missingSourceFields`, hero 계약 포함)다 */
export function unresolvedOf(entry) {
  const probe = { ...entry, status: 'APPROVED', node: { ...(entry?.node ?? {}), status: 'APPROVED' } }
  return [...new Set(missingSourceFields(probe, { imageMode: entry?.plan?.imageMode ?? null }))].sort()
}

/**
 * prepare — 읽기 전용. 명시한 slug 하나의 DRAFT 후보를 만든다. **큐 행을 요구하지 않는다.**
 * @returns {{ok:true, candidate:object}|{ok:false, code:string, why:string, problems?:string[]}}
 */
export function prepareCandidate({ repoRoot, admissionRoot, slug, asOf, researchDir = null, nowMs = Date.now(), knownLegacy = KNOWN_LEGACY_ADMISSIONS }) {
  if (!nonEmpty(slug)) return { ok: false, code: 'SLUG_REQUIRED', why: '--slug 로 한 건을 지정해야 한다 (자동 선택 없음)' }
  const atMs = parseKst(asOf)
  if (atMs === null) return { ok: false, code: 'AS_OF_INVALID', why: '--as-of 는 초까지 포함한 실제 KST(+09:00) 시각이어야 한다' }
  if (atMs > nowMs) return { ok: false, code: 'AS_OF_FUTURE', why: '--as-of 가 지금보다 뒤다 — 미래 공개 글을 지금 증거로 쓰지 않는다' }
  let state
  let research
  try {
    state = readCurrentState({ repoRoot, admissionRoot, slug, phase: 'plan', knownLegacy })
    if (!state.ok) return state
    research = readResearchReference({ researchDir, graph: state.graph, intentId: state.admission.intentId })
  } catch (e) {
    return { ok: false, code: e.code ?? 'INPUT_UNREADABLE', why: e.message }
  }
  const { identity, admission: a } = state
  const intentId = a.intentId
  const blockers = [...state.blockers]
  const rel = judgeRelations({ relations: state.relations, state, intentId, slug, atMs })
  if (!rel.ok) blockers.push(...rel.problems)
  const edgeIds = new Set([...(a.direct ?? []), ...(a.discovery ? [a.discovery] : [])].map((r) => r.edgeId))
  const provenance = {}
  const derived = (path, source, extra = {}) => { provenance[path] = { status: 'DERIVED', source, ...extra } }
  const open = (path, why) => { provenance[path] = { status: 'UNRESOLVED', source: null, why } }

  const entry = {
    admission: state.admissionBlock,
    plan: Object.fromEntries(ARTICLE_PLAN_REQUIRED.map((k) => [k, null])),
    node: {
      id: intentId, intentId, slug, status: CANDIDATE_STATUS, graphVersion: identity.graphVersion,
      readerQuestion: null, scope: { include: null, exclude: null }, outline: null,
      evidence: { factsToVerify: null, sourceRequirements: null }, safetyConstraints: null, hubPath: null, ctaLabel: null,
    },
    relations: state.relations,
    hero: { alt: null, scene: null },
    publication: { publishAt: null },
  }
  for (const k of ADMISSION_FIELDS) derived(`admission.${k}`, `research:${identity.admission.receiptFile}`)
  for (const p of ['node.id', 'node.intentId', 'node.slug']) derived(p, 'G8 receipt ∧ slug manifest ∧ ledger')
  derived('node.graphVersion', 'product current.ts')
  derived('node.status', 'DRAFT — 승인 상태로 바꾸는 것은 approve 단계뿐이다')
  derived('relations.direct', `G8 receipt edges ${[...a.direct].map((r) => r.edgeId).join(',')} ∩ product-graph`)
  derived('relations.discovery', `G8 receipt edge ${a.discovery?.edgeId ?? '-'} ∩ product-graph`)
  for (const k of ARTICLE_PLAN_REQUIRED) open(`plan.${k}`, '사람이 정하고 승인한다 — 허용값은 topic-queue.ts union')
  for (const p of ['node.readerQuestion', 'node.scope.include', 'node.scope.exclude', 'node.outline', 'node.evidence.factsToVerify',
    'node.evidence.sourceRequirements', 'node.safetyConstraints', 'node.hubPath', 'node.ctaLabel', 'publication.publishAt']) {
    open(p, '기계가 증거로 확정할 수 없다 — 사람이 채우고 승인한다')
  }
  open('hero', 'plan.imageMode 가 REQUIRED · OPTIONAL 이면 alt · scene 을 채우고, NO_IMAGE 면 null 로 둔다')

  const candidate = {
    schema: CANDIDATE_SCHEMA,
    status: CANDIDATE_STATUS,
    asOf,
    identity,
    // 🔴 참고 — entry 를 채우지 않는다. 제목·질문을 고를 때 사람이 읽는다
    hint: { primaryQuery: a.primaryQuery ?? null, cluster: a.cluster ?? null, territoryId: a.territoryId ?? null },
    research,
    relationEvidence: rel.evidence.filter((e) => edgeIds.has(e.edgeId)),
    entry,
    provenance,
    unresolvedFields: unresolvedOf(entry),
    blockers: [...new Set(blockers)].sort(),
  }
  return { ok: true, candidate: { ...candidate, candidateHash: candidateHashOf(candidate) } }
}

export function inspectCandidate(candidate) {
  return {
    schema: candidate?.schema ?? null,
    status: candidate?.status ?? null,
    computedHash: candidateHashOf(candidate),
    storedHash: candidate?.candidateHash ?? null,
    unresolvedFields: unresolvedOf(candidate?.entry),
    blockers: candidate?.blockers ?? [],
  }
}

/**
 * 🔴 **출력 경로 신원** — repoRoot 와 outRoot 는 둘 다 실제 디렉터리이고, canonical realpath 가 정확히 같은
 *    작업 트리 루트(`.git` 이 있는 곳)여야 한다. 경로 자체에 symlink 조상이 있거나 runtime 이면 거부한다.
 */
export function checkOutputRoots({ repoRoot, outRoot }) {
  const fail = (code, why) => ({ ok: false, code, why })
  if (!repoRoot || !outRoot) return fail('OUT_ROOT_REQUIRED', '--repo 와 --out-root 를 모두 명시해야 한다')
  const canon = {}
  for (const [k, p] of [['repoRoot', repoRoot], ['outRoot', outRoot]]) {
    let st
    try { st = statSync(p) } catch { return fail('OUT_ROOT_NOT_DIRECTORY', `${k} 가 존재하는 디렉터리가 아니다: ${p}`) }
    if (!st.isDirectory()) return fail('OUT_ROOT_NOT_DIRECTORY', `${k} 가 디렉터리가 아니다: ${p}`)
    const real = realpathSync(p)
    if (real !== resolve(p)) return fail('OUT_ROOT_SYMLINK', `${k} 경로에 symlink 조상이 있다 (${resolve(p)} → ${real})`)
    if (RUNTIME_PATH_PATTERNS.some((re) => re.test(real))) return fail('RUNTIME_OUTPUT_FORBIDDEN', '운영 runtime 작업장에는 승인 artifact 를 쓰지 않는다')
    canon[k] = real
  }
  if (canon.repoRoot !== canon.outRoot) return fail('OUT_ROOT_NOT_REPO', `--out-root 는 --repo 와 같은 작업 트리 루트여야 한다 (${canon.outRoot} ≠ ${canon.repoRoot})`)
  if (!existsSync(join(canon.repoRoot, '.git'))) return fail('OUT_ROOT_NOT_WORKTREE', '작업 트리 루트(.git)가 아니다')
  return { ok: true, root: canon.repoRoot }
}

/** 루트 아래 대상 경로의 기존 구성요소 중 symlink 가 있으면 거부한다(경로 탈출) */
function checkNoSymlinkBelow(root, target) {
  const rel = relative(root, target)
  if (rel.startsWith('..') || rel.startsWith(sep)) return { ok: false, code: 'OUT_PATH_ESCAPE', why: `대상이 루트 밖이다: ${target}` }
  let cur = root
  for (const part of rel.split(sep)) {
    cur = join(cur, part)
    let st
    try { st = lstatSync(cur) } catch { continue }
    if (st.isSymbolicLink()) return { ok: false, code: 'OUT_PATH_SYMLINK', why: `대상 경로에 symlink 가 있다: ${cur}` }
  }
  return { ok: true }
}

/**
 * 단일 writer 잠금 — **회수하지 않는다** (2026-10-22 · PR C 경쟁 수리).
 * 🔴 **내용이 다 쓰인 뒤에만 잠금이 보인다** — pid · token 을 쓴 임시 파일(`wx`)을 `link` 로 배타 생성한다.
 *    (앞판은 O_EXCL 로 빈 파일을 만든 뒤 pid 를 썼다. 그 사이 다른 프로세스가 빈 파일을 읽고
 *     죽은 잠금으로 지워 두 writer 가 동시에 잠금을 쥐었다 — 동시 승인 25회 중 1회 재현.)
 * 🔴 **잠금이 이미 있으면 주인이 살았든 죽었든 그대로 두고 LOCK_BUSY** 다. 앞판은 죽은 pid 의 잠금을 지웠는데,
 *    확인과 unlink 사이에 새 주인이 잠금을 잡으면 **새 잠금을 지웠다**(재현). 자동 stale 회수는 없앴다 —
 *    남은 잠금은 사람이 주인을 확인하고 지운다.
 * 🔴 해제는 rename 으로 떼어 낸 뒤 token 을 확인하고, 내 것이 아니면 같은 inode 를 제자리에 되돌린다 —
 *    어떤 종료 경로에서도 내 것이 아닌 잠금을 지우지 않는다.
 * `hooks.lockObserved` 는 시험 전용(기존 잠금을 본 직후 경쟁 주입)이다.
 */
function acquireLock(lockPath, hooks = {}) {
  const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const tmp = `${lockPath}.${token}`
  const fd = openSync(tmp, 'wx')
  try { writeSync(fd, JSON.stringify({ pid: process.pid, token })); fsyncSync(fd) } finally { closeSync(fd) }
  try {
    try {
      linkSync(tmp, lockPath)
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      hooks.lockObserved?.({ lockPath })
      let holder = null
      try { holder = JSON.parse(readFileSync(lockPath, 'utf8')) } catch { holder = null }
      return { ok: false, code: 'LOCK_BUSY', why: `승인 잠금이 이미 있다${holder?.pid ? ` (pid ${holder.pid})` : ''} — 주인이 살았든 죽었든 자동으로 지우지 않는다. 사람이 확인하고 지운다` }
    }
    const owns = () => { try { return JSON.parse(readFileSync(lockPath, 'utf8')).token === token } catch { return false } }
    const release = () => {
      const parked = `${lockPath}.release-${token}`
      try { renameSync(lockPath, parked) } catch { return }
      let mine = false
      try { mine = JSON.parse(readFileSync(parked, 'utf8')).token === token } catch { mine = false }
      if (mine) { try { unlinkSync(parked) } catch { /* 이미 없다 */ } return }
      // 내 것이 아니다 — 같은 inode 를 제자리에 되돌린다. 그 사이 새 잠금이 생겼으면 떼어 낸 파일을 그대로 남긴다(지우지 않는다)
      try { linkSync(parked, lockPath); unlinkSync(parked) } catch { /* parked 를 보존한다 */ }
    }
    return { ok: true, owns, release }
  } finally {
    try { unlinkSync(tmp) } catch { /* 이미 없다 */ }
  }
}

const docBytes = (doc) => `${JSON.stringify(doc, null, 2)}\n`
/** 대상 파일의 지금 상태 — 존재 여부와 정확한 바이트 해시 */
function snapshot(file) {
  if (!existsSync(file)) return { exists: false, hash: null }
  return { exists: true, hash: sha(readFileSync(file)) }
}

/**
 * 승인 entry 로 만들 큐 행이 **실제 소비 관문**(judgeDirectSpecSource)을 통과하는가 — 쓰기 전, 메모리에서.
 * approve 와 materialize 가 같은 함수로 본다.
 */
function gateWithEntry({ entry, root, graphVersion, day = 1 }) {
  return judgeDirectSpecSource({
    queueItem: queueRowFromEntry(entry, { day }), draftsDir: '/nonexistent-dssa', expectedGraphVersion: graphVersion, productRoot: root,
    exists: () => true,
    readFile: () => JSON.stringify({ schema: DIRECT_SPEC_SOURCE_SCHEMA, graphVersion, entries: [entry] }),
  })
}

/**
 * approve — source artifact 의 유일한 쓰기. 후보를 다시 검증하고 승인 entry 하나를 원자적으로 더한다.
 * `hooks.beforeLock` · `hooks.lockObserved` · `hooks.beforeRename` 은 시험 전용(경쟁 승인 · 잠금 경쟁 · 급사 · 실패 · 외부 writer 주입)이다.
 *
 * @returns {{ok:true, written:boolean, path:string, sourceHash:string, entry:object}|{ok:false, code:string, why:string, problems?:string[]}}
 */
export function approveCandidate({ candidate, approver, at, confirmCandidateHash, repoRoot, admissionRoot, outRoot, researchDir = null, nowMs = Date.now(), hooks = {}, knownLegacy = KNOWN_LEGACY_ADMISSIONS }) {
  const fail = (code, why, problems) => ({ ok: false, code, why, ...(problems ? { problems } : {}) })
  const roots = checkOutputRoots({ repoRoot, outRoot })
  if (!roots.ok) return roots
  if (!nonEmpty(approver)) return fail('APPROVER_REQUIRED', '승인자가 비었다')
  if (MACHINE_APPROVER.test(approver.trim())) return fail('APPROVER_MACHINE', `기계 승인 표식이다: ${approver}`)
  const atMs = parseKst(at)
  if (atMs === null) return fail('APPROVED_AT_INVALID', '--at 은 초까지 포함한 실제 KST(+09:00) 시각이어야 한다')
  if (atMs > nowMs) return fail('APPROVED_AT_FUTURE', '--at 이 지금보다 뒤다 — 미래 시각으로 승인하지 않는다')
  if (candidate?.schema !== CANDIDATE_SCHEMA || candidate?.status !== CANDIDATE_STATUS) return fail('CANDIDATE_NOT_DRAFT', '후보 판이 아니거나 DRAFT 가 아니다')
  const asOfMs = parseKst(candidate.asOf)
  if (asOfMs === null || atMs < asOfMs) return fail('APPROVED_AT_BEFORE_CANDIDATE', '승인 시각이 후보 기준 시각(asOf)보다 앞이다')
  const computed = candidateHashOf(candidate)
  if (confirmCandidateHash !== computed) return fail('CANDIDATE_HASH_MISMATCH', `확인한 후보 해시가 지금 후보와 다르다 (${confirmCandidateHash} ≠ ${computed})`)
  const forged = ['status', 'approvedBy', 'approvedAt', 'sourceHash', 'productBasis'].filter((k) => k in (candidate.entry ?? {}))
  if (forged.length || candidate.entry?.node?.status !== CANDIDATE_STATUS) return fail('CANDIDATE_APPROVAL_FORGED', `후보에 승인 필드가 있다 (${forged.join(',') || 'node.status'})`)
  if ((candidate.blockers ?? []).length) return fail('CANDIDATE_BLOCKED', `후보에 차단 사유가 있다: ${candidate.blockers.join(',')}`)

  // 🔴 승인 직전 — receipt · slug binding · ledger · 제품 graph 를 처음부터 다시 읽는다
  let state
  let unions
  try {
    state = readCurrentState({ repoRoot: roots.root, admissionRoot, slug: candidate.identity?.admission?.slug, phase: 'plan', knownLegacy })
    if (!state.ok) return state
    if (researchDir) readResearchReference({ researchDir, graph: state.graph, intentId: state.admission.intentId })
    unions = readQueueUnions(readText(join(roots.root, PRODUCT.queue), 'topic-queue.ts'))
  } catch (e) {
    return fail(e.code ?? 'INPUT_UNREADABLE', e.message)
  }
  if (state.blockers.length) return fail('STATE_BLOCKED', `현재 판 신원이 막혔다: ${state.blockers.join(',')}`, state.blockers)
  if (canonicalJson(state.identity) !== canonicalJson(candidate.identity)) {
    const changed = Object.keys(state.identity).filter((k) => canonicalJson(state.identity[k]) !== canonicalJson(candidate.identity[k]))
    return fail('STATE_CHANGED', `후보 이후 판이 바뀌었다: ${changed.join(',')}`, changed)
  }
  const e = candidate.entry
  const plan = planProblems(e.plan, unions)
  if (plan.length) return fail('PLAN_INVALID', `plan 이 승인 계약을 지키지 않는다: ${plan.join(',')}`, plan)
  const unresolved = unresolvedOf(e)
  if (unresolved.length) return fail('CANDIDATE_UNRESOLVED', `사람이 채우지 않은 필드: ${unresolved.join(',')}`, unresolved)
  const a = state.admission
  const pinned = { 'node.id': e.node.id === a.intentId, 'node.intentId': e.node.intentId === a.intentId,
    'node.slug': e.node.slug === a.slug, 'node.graphVersion': e.node.graphVersion === state.identity.graphVersion,
    admission: canonicalJson(e.admission) === canonicalJson(state.admissionBlock),
    relations: canonicalJson(e.relations) === canonicalJson(state.relations) }
  const drifted = Object.entries(pinned).filter(([, ok]) => !ok).map(([k]) => k)
  if (drifted.length) return fail('CANDIDATE_IDENTITY_EDITED', `기계가 고정한 신원 필드가 바뀌었다: ${drifted.join(',')}`, drifted)
  const rel = judgeRelations({ relations: e.relations, state, intentId: e.node.intentId, slug: e.node.slug, atMs })
  if (!rel.ok) return fail('RELATIONS_INVALID', `관계 ${RELATION_CONTRACT_LABEL} 이 증명되지 않는다: ${rel.problems.join(',')}`, rel.problems)

  const approvedEntry = {
    status: 'APPROVED', approvedBy: approver.trim(), approvedAt: at,
    admission: state.admissionBlock,
    plan: normalizePlan(e.plan),
    node: { ...e.node, status: 'APPROVED' },
    relations: e.relations, hero: e.hero ?? null, publication: e.publication,
    // 🔴 승인한 M-GRAPH 판 — 소비 관문이 같은 helper 로 다시 계산해 정확히 같아야 쓴다 (sourceHash 에 포함)
    productBasis: state.productBasis,
  }
  approvedEntry.sourceHash = directSpecSourceHash(approvedEntry)

  // 🔴 이 entry 로 materialize 할 큐 행이 실제 관문을 통과해야 승인 artifact 가 의미가 있다(쓰기 전, 메모리에서)
  const gv = state.identity.graphVersion
  const gateCheck = gateWithEntry({ entry: approvedEntry, root: roots.root, graphVersion: gv })
  if (!gateCheck.ok) return fail('GATE_REJECTED', `source 관문이 거부했다: ${gateCheck.evidence.blockers.join(',')}`, gateCheck.evidence.blockers)

  const file = join(roots.root, 'drafts/magazine', DIRECT_SPEC_SOURCE_DIRNAME, `${gv}.json`)
  const below = checkNoSymlinkBelow(roots.root, file)
  if (!below.ok) return below
  mkdirSync(dirname(file), { recursive: true })
  if (realpathSync(dirname(file)) !== dirname(file)) return fail('OUT_PATH_SYMLINK', '대상 폴더가 symlink 를 지난다')
  hooks.beforeLock?.({ file })
  const lock = acquireLock(`${file}.lock`, hooks)
  if (!lock.ok) return lock
  try {
    // 🔴 CAS — 읽은 바이트를 기억한다. 교체 직전에 다시 보고 다르면 멈춘다(외부 writer 를 덮지 않는다)
    const before = snapshot(file)
    let doc = { schema: DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: gv, entries: [] }
    if (before.exists) {
      try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch (er) { return fail('ARTIFACT_UNREADABLE', `기존 artifact 를 읽지 못했다: ${er.message}`) }
      if (doc?.schema !== DIRECT_SPEC_SOURCE_SCHEMA || doc?.graphVersion !== gv || !Array.isArray(doc?.entries)) {
        return fail('ARTIFACT_IDENTITY', '기존 artifact 의 schema·graphVersion 이 다르다 — 덮어쓰지 않는다')
      }
    }
    // 🔴 lock 안에서 다시 — 판독 뒤 다른 승인이 먼저 쓴 경우(경쟁)도 덮어쓰지 않는다
    if (doc.entries.some((x) => x?.node?.slug === e.node.slug || x?.node?.intentId === e.node.intentId)) {
      return fail('ALREADY_PLANNED', '같은 slug 또는 intent 의 승인 entry 가 이미 있다 — 덮어쓰지 않는다')
    }
    const next = { schema: DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: gv,
      entries: [...doc.entries, approvedEntry].sort((x, y) => String(x.node.slug).localeCompare(String(y.node.slug))) }
    const bytes = docBytes(next)
    const tmp = `${file}.tmp-${process.pid}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`
    const fd = openSync(tmp, 'w')
    try { writeSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
    try {
      hooks.beforeRename?.({ tmp, file })
      // 🔴 잠금을 아직 내가 쥐고 있는가 — 회수 경쟁으로 잃었으면 쓰지 않는다
      if (!lock.owns()) {
        unlinkSync(tmp)
        return fail('LOCK_LOST', '쓰기 직전 잠금 소유권을 잃었다 — 덮어쓰지 않는다')
      }
      const now = snapshot(file)
      if (now.exists !== before.exists || now.hash !== before.hash) {
        unlinkSync(tmp)
        return fail('ARTIFACT_CHANGED_DURING_WRITE', '읽은 뒤 artifact 가 바뀌었다(외부 writer) — 덮어쓰지 않는다')
      }
      renameSync(tmp, file)
    } catch (er) {
      try { unlinkSync(tmp) } catch { /* 이미 없다 */ }
      return fail('ARTIFACT_WRITE_FAILED', `쓰기 실패 — 기존 artifact 는 그대로다: ${er.message}`)
    }
    return { ok: true, written: true, path: file, sourceHash: approvedEntry.sourceHash, entry: approvedEntry }
  } finally {
    lock.release()
  }
}

/**
 * materialize — 승인 source/2 entry 하나에서 topic-queue 행 하나를 만든다. 큐의 유일한 ArticlePlan writer.
 * 🔴 plan 밖의 값을 쓰지 않는다 — 행은 `queueRowFromEntry(entry)` 하나로 만든다(day 만 lock 안에서 정한다).
 * 🔴 큐 writer lock(`withQueueWriteLock`) 안에서 읽기 · 중복 확인 · day 결정 · 쓰기 · 다시 읽기 대조를 한 번에 한다.
 * `hooks.beforeLock` · `hooks.beforeWrite` · `hooks.afterWrite` 는 시험 전용(경쟁 writer · 외부 writer · 쓰기 손상 주입)이다.
 *
 * @returns {{ok:true, written:true, path:string, row:object, day:number}|{ok:false, code:string, why:string, problems?:string[]}}
 */
export function materializePlan({ repoRoot, admissionRoot, slug, outRoot, env = process.env, hooks = {}, knownLegacy = KNOWN_LEGACY_ADMISSIONS }) {
  const fail = (code, why, problems) => ({ ok: false, code, why, ...(problems ? { problems } : {}) })
  const roots = checkOutputRoots({ repoRoot, outRoot })
  if (!roots.ok) return roots
  if (!nonEmpty(slug)) return fail('SLUG_REQUIRED', '--slug 로 한 건을 지정해야 한다')
  let state
  let unions
  let planned
  try {
    state = readCurrentState({ repoRoot: roots.root, admissionRoot, slug, phase: 'materialize', knownLegacy })
    if (!state.ok) return state
    unions = readQueueUnions(readText(join(roots.root, PRODUCT.queue), 'topic-queue.ts'))
    planned = plannedEntries(roots.root, state.identity.graphVersion, { slug, intentId: state.admission.intentId })
  } catch (e) {
    return fail(e.code ?? 'INPUT_UNREADABLE', e.message)
  }
  if (state.blockers.length) return fail('STATE_BLOCKED', `현재 판 신원이 막혔다: ${state.blockers.join(',')}`, state.blockers)
  if (planned.doc && planned.doc.schema !== DIRECT_SPEC_SOURCE_SCHEMA) return fail('PLAN_SCHEMA_UNKNOWN', `source artifact 판이 ${DIRECT_SPEC_SOURCE_SCHEMA} 가 아니다`)
  const exact = planned.entries.filter((x) => x?.node?.slug === slug && x?.node?.intentId === state.admission.intentId)
  if (planned.entries.length !== 1 || exact.length !== 1) return fail('PLAN_NOT_APPROVED', `이 slug·intent 의 승인 entry 가 정확히 하나가 아니다 (${planned.entries.length}개)`)
  const entry = exact[0]
  if (entry.status !== 'APPROVED' || entry.node?.status !== 'APPROVED' || !nonEmpty(entry.approvedBy) || MACHINE_APPROVER.test(String(entry.approvedBy).trim())) {
    return fail('PLAN_NOT_APPROVED', '승인 entry 가 아니다 (status · 사람 승인자)')
  }
  if (entry.sourceHash !== directSpecSourceHash(entry)) return fail('PLAN_HASH_DRIFT', '승인 entry 의 sourceHash 가 본문과 다르다 — 승인 뒤 바뀌었다')
  if (canonicalJson(entry.admission) !== canonicalJson(state.admissionBlock)) return fail('ADMISSION_DRIFT', '승인 entry 의 admission 이 지금 receipt 와 다르다')
  if (canonicalJson(entry.relations) !== canonicalJson(state.relations)) return fail('RELATIONS_DRIFT', '승인 entry 의 관계가 지금 receipt 관계와 다르다')
  const plan = planProblems(entry.plan, unions)
  if (plan.length) return fail('PLAN_INVALID', `승인 plan 이 지금 큐 계약을 지키지 않는다: ${plan.join(',')}`, plan)
  const gv = state.identity.graphVersion
  const pre = gateWithEntry({ entry, root: roots.root, graphVersion: gv })
  if (!pre.ok) return fail('GATE_REJECTED', `source 관문이 거부했다: ${pre.evidence.blockers.join(',')}`, pre.evidence.blockers)

  const queuePath = join(roots.root, PRODUCT.queue)
  const below = checkNoSymlinkBelow(roots.root, queuePath)
  if (!below.ok) return below
  hooks.beforeLock?.({ queuePath })
  const locked = withQueueWriteLock(queuePath, () => {
    const before = readFileSync(queuePath, 'utf8')
    const queue = parseQueueSource(before)
    // 🔴 lock 안에서 다시 — 판독 뒤 다른 writer 가 같은 slug·intent 행을 넣었으면 쓰지 않는다
    if (queue.some((q) => q.slug === slug || q.intentId === entry.node.intentId)) return fail('ALREADY_QUEUED', '큐에 이 slug 또는 intent 의 행이 이미 있다')
    const day = Math.max(0, ...queue.map((q) => q.day).filter(Number.isInteger)) + 1
    const row = queueRowFromEntry(entry, { day })
    const next = insertQueueRows(before, [row])
    /** 같은 parser 로 읽은 큐가 「기존 행 그대로 + 새 행 정확히 1개」인가 — 파싱 실패도 아니다로 본다 */
    const exactlyAdded = (text) => {
      let rows
      try { rows = parseQueueSource(text) } catch { return false }
      const mine = rows.filter((q) => q.slug === slug)
      return mine.length === 1 && canonicalJson(mine[0]) === canonicalJson(row) && canonicalJson(rows.filter((q) => q.slug !== slug)) === canonicalJson(queue)
    }
    // 🔴 쓰기 전에 메모리에서 — 렌더 결과가 큐로 읽히지 않으면 아무것도 쓰지 않는다
    if (!exactlyAdded(next)) return fail('QUEUE_RENDER_INVALID', '새 행을 넣은 큐가 같은 parser 로 기존 행 + 새 행 1개로 읽히지 않는다 — 쓰지 않는다')
    hooks.beforeWrite?.({ queuePath })
    // 🔴 lock 밖 writer 가 있었는가 — 읽은 바이트와 다르면 쓰지 않는다
    if (readFileSync(queuePath, 'utf8') !== before) return fail('QUEUE_CHANGED', '읽은 뒤 큐가 바뀌었다 — 쓰지 않는다')
    writeAtomic(queuePath, next)
    hooks.afterWrite?.({ queuePath })
    // 🔴 디스크의 실제 바이트가 쓴 바이트와 정확히 같고 같은 parser 로도 「기존 행 + 새 행 1개」일 때만 성공이다.
    //    다르면 그 사이 다른 writer 가 썼다 — 관측한 지금 바이트를 **덮지도 되돌리지도 않는다**(되돌리면 남의 변경까지 지운다).
    const observed = readFileSync(queuePath, 'utf8')
    if (observed !== next || !exactlyAdded(observed)) {
      return fail('QUEUE_WRITE_CONFLICT', '쓴 뒤 큐 바이트가 쓴 것과 다르다 — 다른 writer 가 끼어들었다. 지금 바이트를 그대로 두고 멈춘다 (사람이 확인한다)')
    }
    return { ok: true, written: true, path: queuePath, row, day }
  }, { env })
  if (!locked.ok) return locked
  return locked.value
}

export const AUTHORING_FILES = { ...PRODUCT, ...ADMISSION_FILES, journal: JOURNAL_FILE, lock: LOCK_FILE, research: RESEARCH }
