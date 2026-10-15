/**
 * DIRECT_SPEC_V1 source 작성 — `magazine-article-spec-source/1` 의 **후보(DRAFT) 생산**과 **사람의 명시적 승인**.
 *
 * 🔴 **왜 생겼나** (2026-10-15).
 *    #739 로 source 신원 관문은 선정·재사용·등록·전송·regen·입력 수리에 연결됐지만,
 *    그 관문이 읽을 승인 artifact 를 만드는 절차가 없었다. 손으로 JSON 을 쓰면 승인 기록과
 *    초안이 섞이고, 승인 시점의 판(graph·queue·G8·articles)을 아무도 고정하지 않는다.
 *
 * 🔴 **두 단계를 섞지 않는다.**
 *    prepare  읽기 전용. 지정한 slug 하나의 현재 판 신원을 검증하고 DRAFT 후보를 돌려준다.
 *             기계가 증거로 확정할 수 없는 필드는 null 로 남긴다 — 문장·outline·근거·hero·CTA 문구를 만들지 않는다.
 *             APPROVED · approvedBy · approvedAt 를 만들지 않는다. 파일을 쓰지 않는다.
 *    approve  사람이 채운 후보 파일 · 승인자 · 승인 시각 · 확인한 후보 해시를 받아 **다시 전부 검증**한 뒤에만
 *             `drafts/magazine/article-spec-source/<graphVersion>.json` 에 entry 하나를 원자적으로 더한다.
 *
 * 🔴 관계 증거는 **현재 제품 graph bundle 하나**다. 연구 edges·mappings 는 판이 다르면 쓰지 않는다.
 *    연구 intent 는 제품 graph 의 contentHash.intents 와 정확히 같을 때만 **참고(hint)** 로 싣는다 — entry 를 채우지 않는다.
 *
 * 🔴 네트워크 · Chrome · CDP · 모델 호출 0. queue · articles · graph · G8 장부를 쓰지 않는다.
 */

import { createHash } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { canonicalJson } from './magazine-article-spec.mjs'
import {
  DIRECT_SPEC_REQUIRED_FIELDS, DIRECT_SPEC_SOURCE_DIRNAME, DIRECT_SPEC_SOURCE_SCHEMA,
  directSpecSourceHash, judgeDirectSpecSource, missingSourceFields,
} from './magazine-direct-spec-source.mjs'
import { isPublic, resolvePublishAt } from './magazine-gate.mjs'
import { parseArticlesSource, parseQueueSource, sliceLiteral } from './magazine-load.mjs'
import { isAutoLaneEligible } from './magazine-validation-profile.mjs'

export const CANDIDATE_SCHEMA = 'magazine-article-spec-source-candidate/1'
export const CANDIDATE_STATUS = 'DRAFT'

const DIRECT_SLOTS = new Set(['DIRECT_NEXT', 'SAME_EXPERIENCE', 'ACTION_OR_CONTEXT'])
const DISCOVERY_SLOT = 'BRIDGE_DISCOVERY'
const KST_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/
/** 🔴 운영 runtime 작업장에는 쓰지 않는다 — 승인 artifact 는 기능 브랜치에서 검토를 거쳐 들어간다 */
export const RUNTIME_PATH_PATTERNS = [/soransoran-magazine-runtime(?:\/|$)/]
/** 🔴 기계 승인 표식 — 사람 승인만 받는다 */
const MACHINE_APPROVER = /:|^(?:machine|bot|auto|automation|system|ci|agent|claude|codex|chatgpt|gpt|openai|anthropic)\b/i

const PRODUCT = {
  graphCurrent: 'src/content/magazine/graph/current.ts',
  articles: 'src/content/magazine/articles.ts',
  queue: 'drafts/magazine/topic-queue.ts',
}
const ADMISSION = { ledger: 'contract/m3-state.jsonl', slugManifest: 'contract/m3-slug-manifest.json' }
const RESEARCH = { manifest: 'contract/build/current/manifest.json', intents: 'contract/build/current/intents.jsonl' }

const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''

function readText(path, label) {
  try { return readFileSync(path, 'utf8') } catch (e) {
    const err = new Error(`${label} 를 읽지 못했다 (${path}): ${e.code ?? e.message}`)
    err.code = 'INPUT_UNREADABLE'
    throw err
  }
}
const parseJsonl = (text) => String(text ?? '').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))

/**
 * 제품 graph — current.ts 가 가리키는 bundle 을 읽고 EXPORT_HASH 를 재계산한다(check:magazine-graph 와 같은 규칙).
 * 🔴 pointer · bundle · EXPORT_HASH 가 어긋나면 그 판을 증거로 쓰지 않는다.
 */
export function readProductGraph(repoRoot) {
  const current = readText(join(repoRoot, PRODUCT.graphCurrent), 'graph current.ts')
  const m = /^export \{ GRAPH, EXPORT_HASH \} from '\.\/(g-[a-z0-9-]+)'$/m.exec(current)
  if (!m) return { ok: false, code: 'GRAPH_POINTER_UNREADABLE', why: 'current.ts 가 가리키는 판을 찾지 못했다' }
  const pointer = m[1]
  const bundleText = readText(join(repoRoot, dirname(PRODUCT.graphCurrent), `${pointer}.ts`), 'graph bundle')
  const literal = sliceLiteral(bundleText, bundleText.indexOf('=', bundleText.indexOf('export const GRAPH')), '{', '}')
  if (!literal) return { ok: false, code: 'GRAPH_BUNDLE_UNREADABLE', why: 'bundle 의 GRAPH 리터럴을 찾지 못했다' }
  const graph = JSON.parse(literal)
  const declared = /export const EXPORT_HASH = '([0-9a-f]+)'/.exec(bundleText)?.[1] ?? null
  const recomputed = createHash('sha256').update(JSON.stringify(graph)).digest('hex').slice(0, 16)
  const blockers = []
  if (graph.graphVersion !== pointer) blockers.push('GRAPH_VERSION_MISMATCH')
  if (!declared || declared !== recomputed) blockers.push('GRAPH_EXPORT_HASH_MISMATCH')
  return { ok: true, pointer, graph, exportHash: declared, recomputedExportHash: recomputed, blockers }
}

/** 연구 intent 참고 — 제품 intents hash 와 같을 때만. edges · mappings 는 판이 같을 때만 '쓸 수 있음' 으로 표시한다 */
export function readResearchReference({ researchDir, graph, intentId }) {
  if (!researchDir) return { used: false, reason: 'NOT_REQUESTED' }
  const manifest = JSON.parse(readText(join(researchDir, RESEARCH.manifest), '연구 manifest'))
  const intentsHash = manifest?.contentHash?.intents ?? null
  if (intentsHash !== graph.contentHash?.intents) {
    const e = new Error(`연구 intent snapshot hash(${intentsHash}) 가 제품 graph(${graph.contentHash?.intents}) 와 다르다 — 참고하지 않는다`)
    e.code = 'RESEARCH_INTENT_HASH_MISMATCH'
    throw e
  }
  const row = parseJsonl(readText(join(researchDir, RESEARCH.intents), '연구 intents')).find((x) => x.intentId === intentId) ?? null
  return {
    used: Boolean(row),
    reason: row ? 'INTENTS_HASH_EQUAL' : 'INTENT_NOT_IN_RESEARCH',
    researchGraphVersion: manifest.graphVersion ?? null,
    intentsHash,
    // 🔴 연구 edges·mappings 는 판이 다르면 현재 관계 증거가 아니다
    relationsUsable: manifest.graphVersion === graph.graphVersion && manifest?.contentHash?.edges === graph.contentHash?.edges
      && manifest?.contentHash?.mappings === graph.contentHash?.mappings,
    // 🔴 참고(hint)일 뿐이다 — entry 를 채우지 않는다. 사람이 읽고 판단한다
    hint: row ? {
      intentId: row.intentId, primaryQuery: row.primaryQuery ?? null, audienceSituation: row.audienceSituation ?? null,
      answerScope: row.answerScope ?? null, exclusions: row.exclusions ?? null,
    } : null,
  }
}

/**
 * 현재 판의 신원 — prepare 와 approve 가 **같은 함수**로 읽는다. approve 는 이 값이 후보와 같아야 한다.
 * 🔴 판정에 필요한 원문(queue 행·장부 사건)은 해시로만 싣는다.
 */
export function readCurrentState({ repoRoot, admissionRoot, slug }) {
  const productGraph = readProductGraph(repoRoot)
  if (!productGraph.ok) return productGraph
  const { graph } = productGraph
  const articlesText = readText(join(repoRoot, PRODUCT.articles), 'articles.ts')
  const queueText = readText(join(repoRoot, PRODUCT.queue), 'topic-queue.ts')
  const articles = parseArticlesSource(articlesText)
  const queue = parseQueueSource(queueText)
  const ledgerText = existsSync(join(admissionRoot, ADMISSION.ledger)) ? readText(join(admissionRoot, ADMISSION.ledger), 'G8 장부') : ''
  const slugManifestText = existsSync(join(admissionRoot, ADMISSION.slugManifest)) ? readText(join(admissionRoot, ADMISSION.slugManifest), 'slug 표') : null
  const ledger = parseJsonl(ledgerText)
  const slugs = slugManifestText ? JSON.parse(slugManifestText).slugs ?? {} : {}

  const blockers = [...productGraph.blockers]
  const rows = queue.filter((q) => q.slug === slug)
  if (rows.length !== 1) blockers.push(rows.length ? 'QUEUE_ROW_DUPLICATE' : 'QUEUE_ROW_ABSENT')
  const row = rows.length === 1 ? rows[0] : null
  const intentId = row?.intentId ?? null
  if (!row || !nonEmpty(row.intentId) || !nonEmpty(row.g8ManifestHash)) blockers.push('QUEUE_NOT_G8_ADMITTED')
  const lane = row ? isAutoLaneEligible(row) : { ok: false }
  if (!lane.ok || lane.profile !== 'STANDARD') blockers.push('PROFILE_NOT_STANDARD')
  if (articles.some((a) => a.slug === slug)) blockers.push('SLUG_ALREADY_REGISTERED')

  const admitted = ledger.filter((e) => e.event === 'ADMITTED')
  const exact = admitted.filter((e) => e.intentId === intentId && e.slug === slug)
  const crossed = admitted.filter((e) => (e.intentId === intentId) !== (e.slug === slug))
  if (exact.length !== 1) blockers.push(exact.length ? 'ADMISSION_DUPLICATE' : 'ADMISSION_ABSENT')
  if (crossed.length) blockers.push('ADMISSION_IDENTITY_CROSSED')
  if (intentId && slugs[intentId] !== slug) blockers.push('SLUG_UNBOUND')
  if (intentId && !graph.intents.some((i) => i.id === intentId)) blockers.push('INTENT_NOT_IN_PRODUCT_GRAPH')

  return {
    ok: true,
    graph, articles, queueRow: row, lane,
    identity: {
      graphVersion: productGraph.pointer,
      exportHash: productGraph.exportHash,
      contentHash: graph.contentHash,
      queue: row ? { slug, intentId, g8ManifestHash: row.g8ManifestHash ?? null, validationProfile: lane.profile ?? null,
        imageMode: row.imageMode ?? null, rowHash: sha(canonicalJson(row)) } : { slug, intentId: null },
      admission: exact.length === 1 ? { eventHash: sha(canonicalJson(exact[0])), at: exact[0].at ?? null, slugBound: slugs[intentId] === slug } : null,
      articlesHash: sha(articlesText),
    },
    blockers: [...new Set(blockers)],
  }
}

/** 관계 대상 글의 상태 — 승인 시각 기준 공개여야 한다 */
function targetState(articles, slug, atMs) {
  const a = articles.find((x) => x.slug === slug)
  if (!a) return { state: 'UNREGISTERED' }
  if (a.status === 'DRAFT' || a.status === 'BLOCKED') return { state: a.status }
  const publishMs = resolvePublishAt(a)
  return { state: isPublic(a, atMs) ? 'PUBLIC' : 'FUTURE', publishAt: new Date(publishMs + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00' }
}

/** 현재 제품 graph 에서 intentId 의 나가는 관계 — 대상 intent 가 slug 하나로 mapping 된 것만 */
export function graphRelationEvidence({ graph, articles, intentId, atMs }) {
  return graph.edges
    .filter((e) => e.from === intentId && e.slot)
    .map((e) => {
      const slugs = graph.mappings.filter((m) => m.intent === e.to).map((m) => m.slug)
      const slug = slugs.length === 1 ? slugs[0] : null
      const t = slug ? targetState(articles, slug, atMs) : { state: slugs.length ? 'MAPPING_AMBIGUOUS' : 'UNMAPPED' }
      return { edgeId: e.id, toIntent: e.to, slug, slot: e.slot, reason: e.reason, active: e.active === true, target: t.state,
        targetPublishAt: t.publishAt ?? null, eligible: Boolean(slug) && t.state === 'PUBLIC' && nonEmpty(e.reason) }
    })
    .sort((a, b) => String(a.edgeId).localeCompare(String(b.edgeId)))
}

/**
 * 관계 3+1 판정 — prepare 의 후보 관계와 approve 의 사람이 확정한 관계를 **같은 규칙**으로 본다.
 * 🔴 M-GRAPH 관계는 현재 제품 graph 의 edge 와 slot · reason 까지 같아야 한다. SERIES 는 같은 seriesId 의 등록 글만.
 *    HUB 는 지금 코드·데이터로 증명할 수 없다 — 거부한다.
 */
export function judgeRelations({ relations, graph, articles, intentId, slug, queueRow, atMs }) {
  const problems = []
  const direct = Array.isArray(relations?.direct) ? relations.direct : null
  const discovery = relations?.discovery ?? null
  if (!direct || direct.length !== 3) problems.push('RELATIONS_DIRECT_NOT_3')
  if (!discovery || typeof discovery !== 'object') problems.push('RELATIONS_DISCOVERY_NOT_1')
  const all = [...(direct ?? []), ...(discovery ? [discovery] : [])]
  const slugsOf = all.map((r) => r?.slug)
  if (slugsOf.includes(slug)) problems.push('RELATION_SELF')
  if (new Set(slugsOf).size !== slugsOf.length) problems.push('RELATION_DUPLICATE')
  const evidence = graphRelationEvidence({ graph, articles, intentId, atMs })
  all.forEach((r, i) => {
    const isDiscovery = discovery && i === all.length - 1
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
      const wantSlot = isDiscovery ? r.relationType === DISCOVERY_SLOT : DIRECT_SLOTS.has(r.relationType)
      if (!wantSlot) problems.push('RELATION_SLOT_MISMATCH')
    } else if (r.source === 'SERIES') {
      const target = articles.find((a) => a.slug === r.slug)
      if (!queueRow?.seriesId || target?.seriesId !== queueRow.seriesId) problems.push('RELATION_SERIES_UNPROVEN')
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

/** 후보에서 아직 사람이 채우지 않은 필드 — 관문(`missingSourceFields`)과 같은 목록에 hero 규칙을 더한다 */
export function unresolvedOf(entry, queueRow) {
  const probe = { ...entry, status: 'APPROVED', node: { ...(entry?.node ?? {}), status: 'APPROVED' } }
  const missing = missingSourceFields(probe, queueRow)
  return [...new Set(missing)].sort()
}

/**
 * prepare — 읽기 전용. 명시한 slug 하나의 DRAFT 후보를 만든다.
 * @returns {{ok:true, candidate:object}|{ok:false, code:string, why:string}}
 */
export function prepareCandidate({ repoRoot, admissionRoot, slug, asOf, researchDir = null }) {
  if (!nonEmpty(slug)) return { ok: false, code: 'SLUG_REQUIRED', why: '--slug 로 한 건을 지정해야 한다 (자동 선택 없음)' }
  if (!KST_AT.test(String(asOf ?? ''))) return { ok: false, code: 'AS_OF_REQUIRED', why: '--as-of 는 초까지 포함한 KST(+09:00) 시각이어야 한다' }
  let state
  let research
  try {
    state = readCurrentState({ repoRoot, admissionRoot, slug })
    if (!state.ok) return state
    research = readResearchReference({ researchDir, graph: state.graph, intentId: state.identity.queue.intentId })
  } catch (e) {
    return { ok: false, code: e.code ?? 'INPUT_UNREADABLE', why: e.message }
  }
  const atMs = Date.parse(asOf)
  const { identity, queueRow, graph, articles } = state
  const intentId = identity.queue.intentId
  const evidence = intentId ? graphRelationEvidence({ graph, articles, intentId, atMs }) : []
  const eligibleDirect = evidence.filter((e) => e.eligible && DIRECT_SLOTS.has(e.slot))
  const eligibleDiscovery = evidence.filter((e) => e.eligible && e.slot === DISCOVERY_SLOT)
  const asRelation = (e) => ({ slug: e.slug, source: 'M-GRAPH', relationType: e.slot, reason: e.reason })
  const blockers = [...state.blockers]
  const provenance = {}
  const derived = (path, source) => { provenance[path] = { status: 'DERIVED', source } }
  const open = (path, why) => { provenance[path] = { status: 'UNRESOLVED', source: null, why } }

  // 🔴 관계는 정확히 3+1 이 증명될 때만 채운다. 남으면 사람이 고르고, 모자라면 막는다 — 숫자를 맞추려고 만들지 않는다
  let direct = null
  if (eligibleDirect.length === 3) { direct = eligibleDirect.map(asRelation); derived('relations.direct', `product-graph:${eligibleDirect.map((e) => e.edgeId).join(',')}`) }
  else if (eligibleDirect.length > 3) open('relations.direct', `증명된 direct 후보 ${eligibleDirect.length}개 — 사람이 3개를 고른다`)
  else { blockers.push('RELATIONS_INSUFFICIENT'); open('relations.direct', `증명된 direct 관계 ${eligibleDirect.length}개 — 3개가 필요하다`) }
  let discovery = null
  if (eligibleDiscovery.length === 1) { discovery = asRelation(eligibleDiscovery[0]); derived('relations.discovery', `product-graph:${eligibleDiscovery[0].edgeId}`) }
  else if (eligibleDiscovery.length > 1) open('relations.discovery', `증명된 discovery 후보 ${eligibleDiscovery.length}개 — 사람이 1개를 고른다`)
  else { blockers.push('RELATIONS_INSUFFICIENT'); open('relations.discovery', '증명된 discovery 관계가 없다') }

  const imageMode = queueRow?.imageMode ?? null
  const entry = {
    g8ManifestHash: identity.queue.g8ManifestHash ?? null,
    node: {
      id: intentId, intentId, slug, status: CANDIDATE_STATUS, graphVersion: identity.graphVersion,
      readerQuestion: null, scope: { include: null, exclude: null }, outline: null,
      evidence: { factsToVerify: null, sourceRequirements: null }, safetyConstraints: null, hubPath: null, ctaLabel: null,
    },
    relations: { direct, discovery },
    hero: imageMode === 'NO_IMAGE' ? null : { alt: null, scene: null },
    publication: { publishAt: null },
  }
  derived('g8ManifestHash', 'topic-queue')
  for (const p of ['node.id', 'node.intentId']) derived(p, 'topic-queue.intentId ∩ product-graph.intents')
  derived('node.slug', 'topic-queue.slug')
  derived('node.graphVersion', 'product current.ts')
  derived('node.status', 'DRAFT — 승인 상태로 바꾸는 것은 approve 단계뿐이다')
  for (const p of ['node.readerQuestion', 'node.scope.include', 'node.scope.exclude', 'node.outline', 'node.evidence.factsToVerify',
    'node.evidence.sourceRequirements', 'node.safetyConstraints', 'node.hubPath', 'node.ctaLabel', 'publication.publishAt']) {
    open(p, '기계가 증거로 확정할 수 없다 — 사람이 채우고 승인한다')
  }
  if (imageMode === 'NO_IMAGE') derived('hero', 'topic-queue.imageMode=NO_IMAGE')
  else { open('hero.alt', `imageMode=${imageMode} — 사람이 정한다`); open('hero.scene', `imageMode=${imageMode} — 사람이 정한다`) }

  const candidate = {
    schema: CANDIDATE_SCHEMA,
    status: CANDIDATE_STATUS,
    asOf,
    identity,
    research,
    relationEvidence: evidence,
    entry,
    provenance,
    unresolvedFields: unresolvedOf(entry, queueRow),
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
    unresolvedFields: unresolvedOf(candidate?.entry, { imageMode: candidate?.identity?.queue?.imageMode }),
    blockers: candidate?.blockers ?? [],
  }
}

export function isRuntimePath(p) {
  let real = resolve(p)
  try { real = realpathSync(real) } catch { /* 아직 없는 경로 — 문자열로 본다 */ }
  return RUNTIME_PATH_PATTERNS.some((re) => re.test(real) || re.test(resolve(p)))
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** 단일 writer 잠금 — O_EXCL. 죽은 pid 의 잠금만 회수한다 */
function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeSync(fd, JSON.stringify({ pid: process.pid }))
      closeSync(fd)
      return { ok: true, release: () => { try { unlinkSync(lockPath) } catch { /* 이미 없다 */ } } }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      let holder = null
      try { holder = JSON.parse(readFileSync(lockPath, 'utf8')) } catch { holder = null }
      if (holder && pidAlive(holder.pid)) return { ok: false, code: 'LOCK_BUSY', why: `다른 승인이 진행 중이다 (pid ${holder.pid})` }
      try { unlinkSync(lockPath) } catch { /* 경쟁자가 먼저 지웠다 */ }
    }
  }
  return { ok: false, code: 'LOCK_BUSY', why: '잠금을 얻지 못했다' }
}

const docBytes = (doc) => `${JSON.stringify(doc, null, 2)}\n`

/**
 * approve — 유일한 쓰기. 후보를 다시 검증하고 승인 entry 하나를 원자적으로 더한다.
 * `hooks.beforeRename` 은 시험 전용(급사·실패 주입)이다.
 *
 * @returns {{ok:true, written:boolean, path:string, sourceHash:string, entry:object}|{ok:false, code:string, why:string, problems?:string[]}}
 */
export function approveCandidate({ candidate, approver, at, confirmCandidateHash, repoRoot, admissionRoot, outRoot, researchDir = null, hooks = {} }) {
  const fail = (code, why, problems) => ({ ok: false, code, why, ...(problems ? { problems } : {}) })
  if (!outRoot) return fail('OUT_ROOT_REQUIRED', '--out-root 를 명시해야 한다')
  if (isRuntimePath(outRoot) || isRuntimePath(repoRoot)) return fail('RUNTIME_OUTPUT_FORBIDDEN', '운영 runtime 작업장에는 승인 artifact 를 쓰지 않는다')
  if (!nonEmpty(approver)) return fail('APPROVER_REQUIRED', '승인자가 비었다')
  if (MACHINE_APPROVER.test(approver.trim())) return fail('APPROVER_MACHINE', `기계 승인 표식이다: ${approver}`)
  if (!KST_AT.test(String(at ?? ''))) return fail('APPROVED_AT_INVALID', '--at 은 초까지 포함한 KST(+09:00) 시각이어야 한다')
  if (candidate?.schema !== CANDIDATE_SCHEMA || candidate?.status !== CANDIDATE_STATUS) return fail('CANDIDATE_NOT_DRAFT', '후보 판이 아니거나 DRAFT 가 아니다')
  const computed = candidateHashOf(candidate)
  if (confirmCandidateHash !== computed) return fail('CANDIDATE_HASH_MISMATCH', `확인한 후보 해시가 지금 후보와 다르다 (${confirmCandidateHash} ≠ ${computed})`)
  const forged = ['status', 'approvedBy', 'approvedAt', 'sourceHash'].filter((k) => k in (candidate.entry ?? {}))
  if (forged.length || candidate.entry?.node?.status !== CANDIDATE_STATUS) return fail('CANDIDATE_APPROVAL_FORGED', `후보에 승인 필드가 있다 (${forged.join(',') || 'node.status'})`)
  if ((candidate.blockers ?? []).length) return fail('CANDIDATE_BLOCKED', `후보에 차단 사유가 있다: ${candidate.blockers.join(',')}`)

  let state
  try {
    state = readCurrentState({ repoRoot, admissionRoot, slug: candidate.identity?.queue?.slug })
    if (!state.ok) return state
    if (researchDir) readResearchReference({ researchDir, graph: state.graph, intentId: state.identity.queue.intentId })
  } catch (e) {
    return fail(e.code ?? 'INPUT_UNREADABLE', e.message)
  }
  if (state.blockers.length) return fail('STATE_BLOCKED', `현재 판 신원이 막혔다: ${state.blockers.join(',')}`, state.blockers)
  if (canonicalJson(state.identity) !== canonicalJson(candidate.identity)) {
    const changed = Object.keys(state.identity).filter((k) => canonicalJson(state.identity[k]) !== canonicalJson(candidate.identity[k]))
    return fail('STATE_CHANGED', `후보 이후 판이 바뀌었다: ${changed.join(',')}`, changed)
  }
  const unresolved = unresolvedOf(candidate.entry, state.queueRow)
  if (unresolved.length) return fail('CANDIDATE_UNRESOLVED', `사람이 채우지 않은 필드: ${unresolved.join(',')}`, unresolved)
  const e = candidate.entry
  const pinned = { 'node.id': e.node.id === state.identity.queue.intentId, 'node.intentId': e.node.intentId === state.identity.queue.intentId,
    'node.slug': e.node.slug === state.identity.queue.slug, 'node.graphVersion': e.node.graphVersion === state.identity.graphVersion,
    g8ManifestHash: e.g8ManifestHash === state.identity.queue.g8ManifestHash }
  const drifted = Object.entries(pinned).filter(([, ok]) => !ok).map(([k]) => k)
  if (drifted.length) return fail('CANDIDATE_IDENTITY_EDITED', `기계가 고정한 신원 필드가 바뀌었다: ${drifted.join(',')}`, drifted)
  const rel = judgeRelations({ relations: e.relations, graph: state.graph, articles: state.articles, intentId: e.node.intentId,
    slug: e.node.slug, queueRow: state.queueRow, atMs: Date.parse(at) })
  if (!rel.ok) return fail('RELATIONS_INVALID', `관계 3+1 이 증명되지 않는다: ${rel.problems.join(',')}`, rel.problems)

  const approvedEntry = {
    status: 'APPROVED', approvedBy: approver.trim(), approvedAt: at,
    g8ManifestHash: e.g8ManifestHash,
    node: { ...e.node, status: 'APPROVED' },
    relations: e.relations, hero: e.hero ?? null, publication: e.publication,
  }
  approvedEntry.sourceHash = directSpecSourceHash(approvedEntry)

  // 🔴 실제 관문(judgeDirectSpecSource)으로 한 번 더 — 승인 artifact 는 관문이 읽을 수 있어야 의미가 있다(쓰기 전, 메모리에서)
  const gv = state.identity.graphVersion
  const gateCheck = judgeDirectSpecSource({
    queueItem: state.queueRow, draftsDir: '/nonexistent-dssa', expectedGraphVersion: gv,
    exists: () => true,
    readFile: () => JSON.stringify({ schema: DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: gv, entries: [approvedEntry] }),
  })
  if (!gateCheck.ok) return fail('GATE_REJECTED', `source 관문이 거부했다: ${gateCheck.evidence.blockers.join(',')}`, gateCheck.evidence.blockers)

  const file = join(outRoot, 'drafts/magazine', DIRECT_SPEC_SOURCE_DIRNAME, `${gv}.json`)
  mkdirSync(dirname(file), { recursive: true })
  const lock = acquireLock(`${file}.lock`)
  if (!lock.ok) return lock
  try {
    let doc = { schema: DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: gv, entries: [] }
    if (existsSync(file)) {
      try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch (err) { return fail('ARTIFACT_UNREADABLE', `기존 artifact 를 읽지 못했다: ${err.message}`) }
      if (doc?.schema !== DIRECT_SPEC_SOURCE_SCHEMA || doc?.graphVersion !== gv || !Array.isArray(doc?.entries)) {
        return fail('ARTIFACT_IDENTITY', '기존 artifact 의 schema·graphVersion 이 다르다 — 덮어쓰지 않는다')
      }
    }
    const same = doc.entries.find((x) => x?.node?.slug === e.node.slug && x?.node?.intentId === e.node.intentId)
    if (same) {
      if (canonicalJson(same) === canonicalJson(approvedEntry)) return { ok: true, written: false, path: file, sourceHash: approvedEntry.sourceHash, entry: same }
      return fail('ARTIFACT_CONFLICT', '같은 slug·intent 의 다른 승인 entry 가 이미 있다 — 덮어쓰지 않는다')
    }
    if (doc.entries.some((x) => x?.node?.slug === e.node.slug || x?.node?.intentId === e.node.intentId)) {
      return fail('ARTIFACT_DUPLICATE', '같은 slug 또는 intent 의 다른 entry 가 이미 있다')
    }
    const next = { schema: DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: gv,
      entries: [...doc.entries, approvedEntry].sort((a, b) => String(a.node.slug).localeCompare(String(b.node.slug))) }
    const bytes = docBytes(next)
    const tmp = `${file}.tmp-${process.pid}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`
    const fd = openSync(tmp, 'w')
    try { writeSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
    try {
      hooks.beforeRename?.({ tmp, file })
      renameSync(tmp, file)
    } catch (err) {
      try { unlinkSync(tmp) } catch { /* 이미 없다 */ }
      return fail('ARTIFACT_WRITE_FAILED', `쓰기 실패 — 기존 artifact 는 그대로다: ${err.message}`)
    }
    return { ok: true, written: true, path: file, sourceHash: approvedEntry.sourceHash, entry: approvedEntry }
  } finally {
    lock.release()
  }
}

export const AUTHORING_FILES = { ...PRODUCT, ...ADMISSION, research: RESEARCH, requiredFields: DIRECT_SPEC_REQUIRED_FIELDS }
