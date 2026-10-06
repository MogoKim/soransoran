/**
 * G8 편입기 — M-GRAPH 연구 정본의 AUTO_READY 의도를 M-AUTO topic queue 로 올린다.
 *
 * 🔴 **새 주제를 만들지 않는다.** 이미 조사·판정된 의도만 옮긴다.
 *    입력은 연구 정본(의도·판정·그래프 빌드)과 제품의 articles·queue·graph 번들이고,
 *    출력은 manifest 하나다. 큐 행과 **편입 장부** 행은 같은 manifest 에서 나온다
 *    — 둘이 따로 갈라질 길을 만들지 않는다 (헌장 §15 전환 규칙 9).
 *
 * 🔴 **용어를 섞지 않는다.**
 *    · 편입 장부(admission ledger) — 연구 `contract/m3-state.jsonl`(ADMITTED 사건) +
 *      `contract/m3-slug-manifest.json`(intentId ↔ slug). 이 도구가 쓰는 것은 여기까지다.
 *    · 제품 graph bundle — `src/content/magazine/graph/*`. 이 도구는 **읽기만** 한다.
 *      편입 장부가 제품 그래프에 반영되려면 연구 build-graph 재빌드 → export → 배포가 따로 돌아야 한다.
 *
 * 🔴 **필수 필드를 추측하지 않는다.** 연구 정본에 값이 없으면 그 의도는 INCOMPLETE 다.
 *    STANDARD·EVERGREEN 같은 값으로 조용히 채우지 않는다.
 *    예외는 정본 문서가 이미 값을 정한 세 가지뿐이고, 행마다 출처를 적는다 (`DERIVED`).
 *
 * 🔴 **기본은 dry-run 이다.** 쓰기는 `applyManifest` 하나뿐이고, 그것도 호출자가
 *    큐 루트·편입 장부 루트·manifest 해시를 명시해야 돈다.
 *    apply 는 단일 writer 잠금 안에서만 쓰고, 급사하면 다음 apply 가 journal 로 되돌린다.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parseArticlesSource, parseQueueSource, sliceLiteral } from './magazine-load.mjs'
import { isPublic } from './magazine-gate.mjs'
import { checkTitleForm } from './magazine-editorial.mjs'
import { BANNED_WORDS } from './magazine-brief-policy.mjs'
import { VALIDATION_PROFILES } from './magazine-validation-profile.mjs'
import { withQuarantineLock } from './magazine-quarantine.mjs'
import { withQueueWriteLock } from './magazine-queue-lock.mjs'

export const G8_SCHEMA = 'g8-promotion/1'
export const PRIMARY_COUNT = 5
export const FALLBACK_COUNT = 3

/** 의도는 이 중 **정확히 하나**다. 순서가 판정 우선순위다 (`classifyIntents`) */
export const CLASSES = [
  'LIVE', 'SCHEDULED', 'ALREADY_QUEUED', 'DUPLICATE_OR_CONFLICT',
  'REJECT', 'HOLD', 'EXTEND_EXISTING', 'TERRITORY_DECISION_REQUIRED',
  'INCOMPLETE', 'ELIGIBLE_NEW',
]

export const RESEARCH_FILES = {
  canonical: 'g4-intents-canonical.jsonl',
  automation: 'g4-automation-2026-09-23.jsonl',
  rebaseline: 'g4-rebaseline-2026-09-23.jsonl',
  buildIntents: 'contract/build/current/intents.jsonl',
  buildEdges: 'contract/build/current/edges.jsonl',
  buildMappings: 'contract/build/current/mappings.jsonl',
  buildManifest: 'contract/build/current/manifest.json',
  slugModule: 'contract/m3-slug.mjs',
  /** 🔴 장부 사건은 이 정본 계약(validateLedger · recordAdmission)으로만 적는다 */
  pipelineModule: 'contract/m3-pipeline.mjs',
  productModule: 'contract/m3-product.mjs',
}
/** 편입 장부 — 이 도구가 쓰는 연구 쪽 파일. 없으면 빈 것으로 본다 (해시 `ABSENT`) */
export const ADMISSION_FILES = {
  slugManifest: 'contract/m3-slug-manifest.json',
  ledger: 'contract/m3-state.jsonl',
}
/** 급사 복구 journal — apply 가 쓰기 전에 원본 바이트를 적는다. 정상 종료면 남지 않는다 */
export const JOURNAL_FILE = 'contract/.g8-apply.journal.json'
export const PRODUCT_FILES = {
  articles: 'src/content/magazine/articles.ts',
  queue: 'drafts/magazine/topic-queue.ts',
  types: 'src/content/magazine/types.ts',
  graphCurrent: 'src/content/magazine/graph/current.ts',
}

/**
 * 의도가 기존 글로 **이미 답해졌다**고 보는 대응. PARTIAL·ADJACENT 는 답이 아니다 —
 * 그 의도는 연구 판정(EXTEND_EXISTING 또는 AUTO_READY)으로 간다.
 */
/**
 * 🔴 `ANSWERS_PARTIAL` · `ANSWERS_WITH_SCOPE_EXPANSION` 은 **완료 답변이 아니다** — 기존 글이 일부만 답하거나
 *    범위를 넓혀야 답한다. 그 의도는 연구 판정(EXTEND_EXISTING)을 따른다 (I-T6-09 · I-T1-26).
 */
const ANSWER_COVERAGE = new Set([
  'ANSWERS', 'ANSWERS_WITH_DEFECT',
  'QUEUED_NOT_PUBLIC', 'SCHEDULED_NOT_YET_PUBLIC', 'PRIMARY',
])

/** 연구 graph-contract.ts 의 RELATION_TO_SLOT 과 같다 */
const RELATION_TO_SLOT = {
  NEXT_QUESTION: 'DIRECT_NEXT',
  SIBLING: 'SAME_EXPERIENCE',
  ACTION: 'ACTION_OR_CONTEXT',
  PREREQUISITE: 'ACTION_OR_CONTEXT',
  SERIES: 'ACTION_OR_CONTEXT',
  BRIDGE: 'BRIDGE_DISCOVERY',
  COMMUNITY: null,
}

/**
 * 🔴 정본 문서가 이미 값을 정한 필드 — 연구 정본에 없어도 추측이 아니다.
 *    출처를 행의 `derived` 에 그대로 싣는다.
 */
export const DERIVED = {
  imageMode: {
    value: 'REQUIRED',
    source: 'scripts/lib/magazine-auto-lane.mjs heroPlan — 자동 레인에서는 OPTIONAL 도 hero 필수 (2026-09-21 사고)',
  },
  reviewMode: {
    byRisk: { LOW: 'SUMMARY_ONLY', MEDIUM: 'RISK_SENTENCES', HIGH: 'FULL_REVIEW' },
    source: 'topic-queue.ts ReviewMode — riskLevel 에서 파생되는 호환 필드. 자동 판정에 쓰이지 않는다',
  },
  autoEligible: {
    value: true,
    source: 'topic-queue.ts autoEligible — M3-A 호환 필드. 자동 진행 판정에 쓰이지 않는다',
  },
  target: {
    value: '40대 중반~60대 중반',
    source: 'NORTH-STAR 고객 정의 — 의도별 연령대를 좁힌 근거가 없으면 서비스 전체 독자층',
  },
}

/** 영토 판단이 창업자에게 남아 있는 묶음 (Foundation §14 「아직 열려 있는 것」) */
const TERRITORY_BUNDLES = new Set(['T9_PARENT_CARE', 'SEX_SCOPE'])

// ── 읽기 ─────────────────────────────────────────────────────

export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')

function readRequired(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} 가 없다: ${file}`)
  return fs.readFileSync(file, 'utf8')
}
function readOptional(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}
const parseJsonl = (text, label) => String(text ?? '').split('\n').filter((l) => l.trim()).map((l, i) => {
  try { return JSON.parse(l) } catch (e) { throw new Error(`${label} ${i + 1}행 JSON 파싱 실패: ${e.message}`) }
})

/** 큐 파일의 문자열 union 타입을 읽는다 — 허용값을 이 파일에 다시 적지 않는다 */
export function readStringUnion(src, typeName) {
  const m = new RegExp(`export type ${typeName}\\s*=([^\\n]*(?:\\n\\s*\\|[^\\n]*)*)`).exec(src)
  if (!m) throw new Error(`타입 ${typeName} 를 찾지 못했다`)
  const values = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  if (!values.length) throw new Error(`타입 ${typeName} 에 값이 없다`)
  return new Set(values)
}

function loadGraphBundle(repoDir) {
  const currentPath = path.join(repoDir, PRODUCT_FILES.graphCurrent)
  const current = readRequired(currentPath, 'graph current.ts')
  const m = /export \{ GRAPH, EXPORT_HASH \} from '\.\/(g-[a-z0-9-]+)'/.exec(current)
  if (!m) throw new Error('graph current.ts 가 가리키는 버전을 찾지 못했다')
  const bundlePath = path.join(repoDir, path.dirname(PRODUCT_FILES.graphCurrent), `${m[1]}.ts`)
  const src = readRequired(bundlePath, 'graph 번들')
  const literal = sliceLiteral(src, src.indexOf('=', src.indexOf('export const GRAPH')), '{', '}')
  if (!literal) throw new Error('graph 번들의 GRAPH 리터럴을 찾지 못했다')
  return { file: path.relative(repoDir, bundlePath), text: current + src, graph: JSON.parse(literal) }
}

/**
 * 입력 전부를 읽고 해시를 단다. 🔴 같은 바이트면 같은 해시 — manifest 가 입력을 고정한다.
 */
/**
 * 입력 전부의 원문과 해시. 🔴 manifest 생성과 apply 직전 재검사가 **같은 함수**를 쓴다 —
 *    apply 가 일부 파일만 다시 보면, 나머지가 바뀐 채로 옛 판정이 쓰인다.
 */
export function readInputs({ researchDir, repoDir }) {
  const research = {}
  for (const [k, rel] of Object.entries(RESEARCH_FILES)) {
    research[k] = readRequired(path.join(researchDir, rel), `연구 ${rel}`)
  }
  const admission = {}
  for (const [k, rel] of Object.entries(ADMISSION_FILES)) admission[k] = readOptional(path.join(researchDir, rel))
  const product = {}
  for (const k of ['articles', 'queue', 'types']) product[k] = readRequired(path.join(repoDir, PRODUCT_FILES[k]), PRODUCT_FILES[k])
  const bundle = loadGraphBundle(repoDir)
  const draftsDir = path.join(repoDir, 'drafts/magazine')
  const draftDirs = fs.existsSync(draftsDir)
    ? fs.readdirSync(draftsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : []
  const hashes = {
    research: Object.fromEntries(Object.keys(RESEARCH_FILES).map((k) => [k, sha256(research[k])])),
    admission: Object.fromEntries(Object.keys(ADMISSION_FILES).map((k) => [k, admission[k] === null ? 'ABSENT' : sha256(admission[k])])),
    product: {
      articles: sha256(product.articles),
      queue: sha256(product.queue),
      types: sha256(product.types),
      graphBundle: sha256(bundle.text),
      draftDirs: sha256(draftDirs.join('\n')),
    },
  }
  return { research, admission, product, bundle, draftDirs, hashes }
}

/** 두 해시 묶음에서 다른 입력의 이름 — 한쪽에만 있는 키도 다른 것으로 센다 */
export function diffHashes(want, got) {
  const out = []
  for (const group of new Set([...Object.keys(want ?? {}), ...Object.keys(got ?? {})])) {
    const a = want?.[group] ?? {}
    const b = got?.[group] ?? {}
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) out.push(`${group}.${k}`)
  }
  return out.sort()
}

/**
 * 입력 전부를 읽고 해시를 단다. 🔴 같은 바이트면 같은 해시 — manifest 가 입력을 고정한다.
 */
export async function loadInputs({ researchDir, repoDir }) {
  const { research, admission, product, bundle, draftDirs, hashes } = readInputs({ researchDir, repoDir })
  const slugModule = await import(pathToFileURL(path.join(researchDir, RESEARCH_FILES.slugModule)).href)
  if (typeof slugModule.proposeSlug !== 'function') throw new Error('m3-slug.mjs 에 proposeSlug 가 없다')

  return {
    hashes,
    proposeSlug: slugModule.proposeSlug,
    canonical: parseJsonl(research.canonical, RESEARCH_FILES.canonical),
    automation: parseJsonl(research.automation, RESEARCH_FILES.automation),
    rebaseline: parseJsonl(research.rebaseline, RESEARCH_FILES.rebaseline),
    buildIntents: parseJsonl(research.buildIntents, RESEARCH_FILES.buildIntents),
    buildEdges: parseJsonl(research.buildEdges, RESEARCH_FILES.buildEdges),
    buildMappings: parseJsonl(research.buildMappings, RESEARCH_FILES.buildMappings),
    buildManifest: JSON.parse(research.buildManifest),
    slugManifest: admission.slugManifest === null ? { slugs: {} } : JSON.parse(admission.slugManifest),
    ledger: parseJsonl(admission.ledger, ADMISSION_FILES.ledger),
    articles: parseArticlesSource(product.articles),
    queue: parseQueueSource(product.queue),
    unions: {
      cluster: readStringUnion(product.types, 'MagazineCluster'),
      ctaBoard: readStringUnion(product.queue, 'CtaBoard'),
      contentType: readStringUnion(product.queue, 'ContentType'),
      searchIntent: readStringUnion(product.queue, 'SearchIntent'),
      riskLevel: readStringUnion(product.queue, 'RiskLevel'),
    },
    graph: bundle.graph,
    graphFile: bundle.file,
    draftDirs,
  }
}

/**
 * 🔴 **판정 시각은 정확한 KST 시각 하나다.** 날짜만 받아 하루 끝으로 해석하지 않는다 —
 *    10:30 공개 글은 같은 날 10:29 에는 예약이고 10:30 에는 공개다.
 */
export function parseAt(at) {
  if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(at)) {
    throw new Error(`판정 시각은 YYYY-MM-DDTHH:MM:SS+09:00 이어야 한다: ${at}`)
  }
  const ms = new Date(at).getTime()
  if (Number.isNaN(ms)) throw new Error(`판정 시각이 날짜가 아니다: ${at}`)
  return { at, asOf: at.slice(0, 10), ms }
}

// ── 판정 ─────────────────────────────────────────────────────

/** 비교용 — 공백·문장부호를 걷어 낸 질문/제목 */
export const normalizeTitle = (s) => String(s ?? '').replace(/[\s?!.,·…"'「」()~]/g, '')

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/**
 * 🔴 **필수 필드 판정.** 값이 없거나 허용값 밖이면 이유를 돌려준다. 채워 넣지 않는다.
 *    정본 위치를 이유에 적는다 — 무엇을 어디에 채워야 풀리는지 바로 읽히게.
 */
export function requiredFieldProblems(ctx) {
  const { canon, build, unions, relations, slug } = ctx
  const problems = []
  if (!unions.cluster.has(build.magazineCluster)) problems.push('cluster — build intents.magazineCluster 없음/허용값 밖')
  else if (canon.magazineCluster && canon.magazineCluster !== build.magazineCluster) {
    problems.push(`cluster_conflict — canonical ${canon.magazineCluster} ≠ automation ${build.magazineCluster}`)
  }
  if (!unions.ctaBoard.has(build.communityDestination)) problems.push('cta — communityDestination 없음/허용값 밖')
  if (!unions.riskLevel.has(canon.riskLevel)) problems.push('riskLevel — canonical.riskLevel 없음')
  if (!VALIDATION_PROFILES.includes(build.verificationProfile)) problems.push('validationProfile — verificationProfile 없음/허용값 밖')
  if (!unions.contentType.has(canon.contentTypeHint)) problems.push('contentType — canonical.contentTypeHint 없음')
  else if (canon.contentTypeHint === 'SEASONAL') {
    const w = canon.publishWindow
    if (!w || !isDate(w.after) || !isDate(w.before) || w.after > w.before) problems.push('publishWindow — SEASONAL 인데 canonical.publishWindow 없음/형식 오류')
  }
  if (!unions.searchIntent.has(canon.searchIntentType)) problems.push('searchIntent — canonical.searchIntentType 없음')
  if (canon.seriesId !== undefined && canon.seriesId !== null) {
    if (typeof canon.seriesId !== 'string' || !Number.isInteger(canon.seriesOrder) || canon.seriesOrder < 1) {
      problems.push('series — seriesId 는 있는데 seriesOrder 가 1 이상의 정수가 아니다')
    }
  }
  if (!String(build.answerScope ?? '').trim()) problems.push('answerScope — 없음')
  if (!String(build.audienceSituation ?? '').trim()) problems.push('audienceSituation — 없음')
  if (!relations.direct.length && !relations.discovery) problems.push('relations — AUTOMATION_READY 관계가 하나도 없다')
  if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) problems.push(`slug — 영구 slug 를 정하지 못했다 (${slug || '빈 값'})`)
  return problems
}

/** 🔴 제목 계약 — 큐 작업 제목은 자동 제작에 넣을 최소 형식과 금지어를 통과해야 한다 */
export function titleProblems(title) {
  const out = []
  const t = checkTitleForm(title)
  if (t.level) out.push(`title_form — ${t.reason}`)
  const banned = BANNED_WORDS.filter((w) => String(title ?? '').includes(w))
  if (banned.length) out.push(`title_banned — ${banned.join('·')}`)
  return out
}

/** 의도의 AUTOMATION_READY 관계 — 직접 최대 3 + 발견 1. 우선순위 → edgeId 순 */
function relationsOf(intentId, edges) {
  const out = edges
    .filter((e) => e.fromIntentId === intentId && e.layers?.AUTOMATION_READY && RELATION_TO_SLOT[e.relationType])
    .sort((a, b) => (a.priority - b.priority) || (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0))
  const direct = []
  let discovery = null
  for (const e of out) {
    const slot = RELATION_TO_SLOT[e.relationType]
    const rel = { slot, toIntentId: e.toIntentId, relationType: e.relationType, anchorLabel: e.anchorLabel, readerReason: e.readerReason }
    if (slot === 'BRIDGE_DISCOVERY') { if (!discovery) discovery = rel } else if (direct.length < 3) direct.push(rel)
  }
  return { direct, discovery }
}

function productStateOf(slug, artBySlug, queueBySlug, nowMs) {
  const a = artBySlug.get(slug)
  if (a) return isPublic(a, nowMs) ? 'LIVE' : 'SCHEDULED'
  if (queueBySlug.has(slug)) return 'ALREADY_QUEUED'
  return 'ABSENT'
}

/**
 * 🔴 **모든 의도를 정확히 한 상태로 분류한다.** 순서가 우선순위다.
 *   ① 제품에 이미 있는가 (LIVE > SCHEDULED > ALREADY_QUEUED) — 연구 판정보다 제품 사실이 이긴다
 *   ② 대응 slug 가 제품 어디에도 없다 → DUPLICATE_OR_CONFLICT (재편입하지 않는다)
 *   ③ REJECT → HOLD → EXTEND_EXISTING → AUTO_READY 가 아닌 판정(INCOMPLETE)
 *   ④ 영토 판단 대기 → 중복 → 필수 필드·제목 → ELIGIBLE_NEW
 */
export function classifyIntents(inputs, { at }) {
  const time = parseAt(at)
  const nowMs = time.ms
  const canonById = new Map(inputs.canonical.map((x) => [x.intentId, x]))
  const autoById = new Map(inputs.automation.map((x) => [x.intentId, x]))
  const rebById = new Map(inputs.rebaseline.map((x) => [x.intentId, x]))
  const ids = inputs.buildIntents.map((x) => x.intentId)
  const missing = ids.filter((id) => !canonById.has(id) || !autoById.has(id))
  if (missing.length || canonById.size !== ids.length || autoById.size !== ids.length) {
    throw new Error(`연구 정본의 의도 집합이 서로 다르다 (build ${ids.length} · canonical ${canonById.size} · automation ${autoById.size} · 누락 ${missing.slice(0, 3).join(',')})`)
  }

  const artBySlug = new Map(inputs.articles.map((a) => [a.slug, a]))
  const queueBySlug = new Map(inputs.queue.map((q) => [q.slug, q]))
  const titleOwner = new Map()
  for (const a of inputs.articles) titleOwner.set(normalizeTitle(a.title), `article:${a.slug}`)
  for (const q of inputs.queue) if (!titleOwner.has(normalizeTitle(q.title))) titleOwner.set(normalizeTitle(q.title), `queue:${q.slug}`)

  /** 이미 다른 것이 쓰는 slug — 글·큐·원고 폴더·그래프 매핑·영구 slug 표 */
  const takenSlugs = new Map()
  const take = (slug, who) => { if (slug && !takenSlugs.has(slug)) takenSlugs.set(slug, who) }
  for (const a of inputs.articles) take(a.slug, 'articles.ts')
  for (const q of inputs.queue) take(q.slug, 'topic-queue.ts')
  for (const d of inputs.draftDirs) take(d, 'drafts/magazine')
  for (const m of inputs.graph.mappings) take(m.slug, 'graph 번들 매핑')
  for (const m of inputs.buildMappings) take(m.slug, '연구 build 매핑')
  const boundSlug = new Map(Object.entries(inputs.slugManifest.slugs ?? {}))
  for (const [intentId, slug] of boundSlug) take(slug, `영구 slug 표(${intentId})`)

  /** intentId → 기존 글로 답한 slug 들 */
  const answered = new Map()
  const addAnswer = (id, slug, via) => {
    if (!answered.has(id)) answered.set(id, [])
    if (!answered.get(id).some((x) => x.slug === slug)) answered.get(id).push({ slug, via })
  }
  for (const c of inputs.canonical) for (const s of c.existingSlugs ?? []) if (ANSWER_COVERAGE.has(s.coverage)) addAnswer(c.intentId, s.slug, `canonical:${s.coverage}`)
  for (const m of inputs.buildMappings) if (ANSWER_COVERAGE.has(m.coverage)) addAnswer(m.intentId, m.slug, `build:${m.coverage}`)
  for (const [id, slug] of boundSlug) addAnswer(id, slug, 'm3-slug-manifest')

  const rows = []
  const draft = []
  for (const build of inputs.buildIntents) {
    const id = build.intentId
    const canon = canonById.get(id)
    const auto = autoById.get(id)
    const row = { intentId: id, class: null, reasons: [], territoryId: build.territoryId, primaryQuery: build.primaryQuery,
      topicVerdict: build.topicVerdict, automationDecision: build.automationDecision }
    rows.push(row)

    const answers = (answered.get(id) ?? []).map((x) => ({ ...x, state: productStateOf(x.slug, artBySlug, queueBySlug, nowMs) }))
    const present = ['LIVE', 'SCHEDULED', 'ALREADY_QUEUED'].find((st) => answers.some((x) => x.state === st))
    if (present) {
      row.class = present
      row.reasons = answers.filter((x) => x.state === present).map((x) => `${x.slug} (${x.via})`)
      continue
    }
    if (answers.length) {
      row.class = 'DUPLICATE_OR_CONFLICT'
      row.reasons = answers.map((x) => `MAPPED_SLUG_ABSENT — ${x.slug} (${x.via}) 가 글·큐 어디에도 없다`)
      continue
    }
    if (build.automationDecision === 'REJECT') { row.class = 'REJECT'; row.reasons = [String(auto.verdictWhy ?? '')]; continue }
    if (build.automationDecision === 'HOLD') { row.class = 'HOLD'; row.reasons = [String(auto.verdictWhy ?? '')]; continue }
    if (build.topicVerdict === 'EXTEND_EXISTING') { row.class = 'EXTEND_EXISTING'; row.reasons = [String(auto.verdictWhy ?? '')]; continue }
    if (build.automationDecision !== 'PASS' || build.topicVerdict !== 'AUTO_READY_TOPIC') {
      row.class = 'INCOMPLETE'
      row.reasons = [`verdict — ${build.automationDecision}/${build.topicVerdict} 는 편입 대상 판정이 아니다`]
      continue
    }
    const bundle = rebById.get(id)?.decisionBundle ?? null
    if ((bundle && TERRITORY_BUNDLES.has(bundle)) || /후보/.test(String(build.territoryId))) {
      row.class = 'TERRITORY_DECISION_REQUIRED'
      row.reasons = [`${bundle ?? build.territoryId} — Foundation §14 영토 결정이 열려 있다`]
      continue
    }
    const relations = relationsOf(id, inputs.buildEdges)
    const slug = boundSlug.get(id) ?? inputs.proposeSlug(build.primaryQuery, build.territoryId)
    draft.push({ row, build, canon, auto, relations, slug })
  }

  // 중복 — 기존 글·큐의 제목, 다른 후보의 질문, slug 충돌
  const bySlug = new Map()
  const byQuestion = new Map()
  for (const d of draft) {
    if (d.slug) bySlug.set(d.slug, [...(bySlug.get(d.slug) ?? []), d.row.intentId])
    const q = normalizeTitle(d.build.primaryQuery)
    byQuestion.set(q, [...(byQuestion.get(q) ?? []), d.row.intentId])
  }
  for (const d of draft) {
    const dup = []
    const owner = titleOwner.get(normalizeTitle(d.build.primaryQuery))
    if (owner?.startsWith('article:')) dup.push(`TITLE_MATCHES_ARTICLE — ${owner}`)
    if (owner?.startsWith('queue:')) dup.push(`TITLE_MATCHES_QUEUE — ${owner}`)
    const sameQ = byQuestion.get(normalizeTitle(d.build.primaryQuery)).filter((x) => x !== d.row.intentId)
    if (sameQ.length) dup.push(`QUESTION_MATCHES_INTENT — ${sameQ.join(',')}`)
    if (d.slug && takenSlugs.has(d.slug) && boundSlug.get(d.row.intentId) !== d.slug) dup.push(`SLUG_TAKEN — ${d.slug} (${takenSlugs.get(d.slug)})`)
    if (dup.length) { d.row.class = 'DUPLICATE_OR_CONFLICT'; d.row.reasons = dup; continue }

    /**
     * 🔴 후보끼리 같은 slug 는 **중복 주제가 아니라 slug 사전의 공백**이다 (m3-slug.mjs —
     *    「가를 관점어가 사전에 없으면 실패로 끝내고 사전을 고친다」). 번호를 붙이지 않는다.
     */
    const sameSlug = d.slug ? bySlug.get(d.slug).filter((x) => x !== d.row.intentId) : []
    const problems = [
      ...requiredFieldProblems({ canon: d.canon, build: d.build, unions: inputs.unions, relations: d.relations, slug: d.slug }),
      ...(sameSlug.length ? [`slug_collision — ${d.slug} = ${sameSlug.join(',')} (slug 사전이 두 의도를 가르지 못한다)`] : []),
      ...titleProblems(d.build.primaryQuery),
    ]
    if (problems.length) { d.row.class = 'INCOMPLETE'; d.row.reasons = problems; continue }
    d.row.class = 'ELIGIBLE_NEW'
    d.row.reasons = []
  }

  rows.sort((a, b) => (a.intentId < b.intentId ? -1 : a.intentId > b.intentId ? 1 : 0))
  const counts = Object.fromEntries(CLASSES.map((c) => [c, rows.filter((r) => r.class === c).length]))
  const eligible = draft.filter((d) => d.row.class === 'ELIGIBLE_NEW')
  return { rows, counts, eligible, nowMs, artBySlug, queueBySlug, answered }
}

// ── 순위와 선정 ──────────────────────────────────────────────

/** 1차 실행 구간은 LOW/STANDARD 중심 — 등급은 막지 않고 순서만 뒤로 보낸다 */
const tierOf = (risk, profile) => (risk === 'LOW' && profile === 'STANDARD' ? 0 : profile === 'STANDARD' ? 1 : risk !== 'HIGH' ? 2 : 3)
const FIT_SCORE = { HIGH: 3, MEDIUM: 1 }

/**
 * 선정 근거를 점수로 남긴다 — 검색 증거 · cluster 공백 · 기존 글 연결 · 커뮤니티 전환.
 * 🔴 점수는 입력에서만 나온다. 시각·난수·파일 순서를 보지 않는다.
 */
function scoreOf(d, ctx) {
  const ev = d.build.evidence ?? {}
  const evidence = Math.min(ev.observedHits ?? 0, 10) + 2 * Math.min(ev.branchOpened ?? 0, 5) + 3 * Math.min(ev.communityWomen ?? 0, 3)
  const inCluster = ctx.clusterCount.get(d.build.magazineCluster) ?? 0
  const clusterGap = Math.max(0, 6 - Math.min(inCluster, 6))
  const rels = [...d.relations.direct, ...(d.relations.discovery ? [d.relations.discovery] : [])]
  const liveLinks = rels.filter((r) => ctx.liveSlugsOf(r.toIntentId).length > 0).length
  const connection = 2 * Math.min(liveLinks, 3)
  const community = FIT_SCORE[d.auto.priorCommunityFit] ?? 0
  return { total: evidence + clusterGap + connection + community, evidence, clusterGap, connection, community, inCluster, liveLinks }
}

export function compareCandidates(a, b) {
  return (a.tier - b.tier) || (b.score.total - a.score.total) || (a.intentId < b.intentId ? -1 : a.intentId > b.intentId ? 1 : 0)
}

/** 큐 행 — TopicQueueItem 모양. 키 순서가 출력 바이트를 정하므로 여기서 고정한다 */
function queueRowOf(d, { day, internalLinks }) {
  const c = d.canon
  const row = {
    day,
    slug: d.slug,
    title: d.build.primaryQuery,
    contentType: c.contentTypeHint,
    intent: c.searchIntentType,
    cluster: d.build.magazineCluster,
    target: DERIVED.target.value,
    validationProfile: d.build.verificationProfile,
    riskLevel: c.riskLevel,
    reviewMode: DERIVED.reviewMode.byRisk[c.riskLevel],
    imageMode: DERIVED.imageMode.value,
    autoEligible: DERIVED.autoEligible.value,
  }
  if (c.seriesId) { row.seriesId = c.seriesId; row.seriesOrder = c.seriesOrder }
  if (c.contentTypeHint === 'SEASONAL') row.publishWindow = { after: c.publishWindow.after, before: c.publishWindow.before }
  row.ctaBoard = d.build.communityDestination
  row.internalLinks = internalLinks
  row.whyNow = String(d.auto.verdictWhy ?? '')
  row.notes = (d.build.exclusions ?? []).join(' · ')
  row.intentId = d.row.intentId
  return row
}

/**
 * 계절 창과 시리즈 선행편 — 판정은 ELIGIBLE_NEW 로 두고 이번 구간에서만 뺀다.
 * producer `selectItems` 와 같은 비교를 쓴다 (asOf 문자열 비교 · 시리즈 다음 회차).
 */
function selectionBlock(d, { asOf, seriesNext }) {
  const c = d.canon
  if (c.contentTypeHint === 'SEASONAL') {
    // 분류가 이미 막았어야 한다 — 선정도 창 없는 계절 주제를 믿지 않는다
    if (!c.publishWindow) return 'WINDOW_MISSING — SEASONAL 인데 publishWindow 가 없다'
    if (asOf < c.publishWindow.after) return `WINDOW_NOT_OPEN — ${c.publishWindow.after} 이전`
    if (asOf > c.publishWindow.before) return `WINDOW_CLOSED — ${c.publishWindow.before} 경과`
  }
  if (c.seriesId) {
    const next = seriesNext.get(c.seriesId) ?? 1
    if (c.seriesOrder !== next) return `SERIES_PREREQ — ${c.seriesId} 다음 회차는 ${next} 인데 ${c.seriesOrder}`
  }
  return null
}

export function selectCandidates(inputs, classified, { at }) {
  const { asOf } = parseAt(at)
  const clusterCount = new Map()
  for (const x of [...inputs.articles, ...inputs.queue]) clusterCount.set(x.cluster, (clusterCount.get(x.cluster) ?? 0) + 1)
  const liveSlugsOf = (intentId) => (classified.answered.get(intentId) ?? [])
    .filter((x) => productStateOf(x.slug, classified.artBySlug, classified.queueBySlug, classified.nowMs) === 'LIVE')
    .map((x) => x.slug)
  const ranked = classified.eligible.map((d) => ({
    d, intentId: d.row.intentId,
    tier: tierOf(d.canon.riskLevel, d.build.verificationProfile),
    score: scoreOf(d, { clusterCount, liveSlugsOf }),
  }))
  ranked.sort(compareCandidates)

  const seriesNext = new Map()
  for (const x of [...inputs.articles, ...inputs.queue]) {
    if (!x.seriesId || !Number.isInteger(x.seriesOrder)) continue
    seriesNext.set(x.seriesId, Math.max(seriesNext.get(x.seriesId) ?? 1, x.seriesOrder + 1))
  }
  const days = inputs.queue.map((q) => q.day).filter(Number.isInteger)
  let nextDay = (days.length ? Math.max(...days) : 0) + 1

  const primary = []
  const fallback = []
  const excluded = []
  for (const r of ranked) {
    const block = selectionBlock(r.d, { asOf, seriesNext })
    if (block) { excluded.push({ intentId: r.intentId, reason: block }); continue }
    const target = primary.length < PRIMARY_COUNT ? primary : fallback.length < FALLBACK_COUNT ? fallback : null
    if (!target) { excluded.push({ intentId: r.intentId, reason: 'BEYOND_RUN — 이번 구간 8건 밖' }); continue }
    if (r.d.canon.seriesId) seriesNext.set(r.d.canon.seriesId, r.d.canon.seriesOrder + 1)
    const internalLinks = [...new Set([...r.d.relations.direct, ...(r.d.relations.discovery ? [r.d.relations.discovery] : [])]
      .flatMap((rel) => liveSlugsOf(rel.toIntentId)))].slice(0, 3)
    const day = target === primary ? nextDay++ : null
    target.push({
      intentId: r.intentId,
      tier: r.tier,
      score: r.score,
      queueRow: queueRowOf(r.d, { day, internalLinks }),
      /** 편입 장부 사건의 재료 — 실제 행은 정본 recordAdmission 이 만든다 */
      admissionRow: {
        intentId: r.intentId,
        slug: r.d.slug,
        title: r.d.build.primaryQuery,
        cluster: r.d.build.magazineCluster,
        directRelations: r.d.relations.direct.map(({ slot, toIntentId, anchorLabel, readerReason }) => ({ slot, toIntentId, anchorLabel, readerReason })),
        discoveryRelation: r.d.relations.discovery
          ? { slot: r.d.relations.discovery.slot, toIntentId: r.d.relations.discovery.toIntentId,
              anchorLabel: r.d.relations.discovery.anchorLabel, readerReason: r.d.relations.discovery.readerReason }
          : null,
        internalLinks,
      },
      evidence: {
        territoryId: r.d.build.territoryId,
        evidenceRefs: (r.d.canon.evidenceRefs ?? []).map((e) => e.evidencePath).filter(Boolean),
        relations: [...r.d.relations.direct, ...(r.d.relations.discovery ? [r.d.relations.discovery] : [])]
          .map((rel) => `${rel.slot}→${rel.toIntentId}${liveSlugsOf(rel.toIntentId).length ? `(${liveSlugsOf(rel.toIntentId).join(',')})` : ''}`),
      },
    })
  }
  return { primary, fallback, excluded }
}

// ── manifest ────────────────────────────────────────────────

/** 공개 글인데 제품 그래프 번들에 매핑이 없는 것 — 재작성하지 않고 보고만 한다 */
function driftOf(inputs, classified) {
  const mapped = new Set(inputs.graph.mappings.map((m) => m.slug))
  const research = new Map()
  for (const c of inputs.canonical) for (const s of c.existingSlugs ?? []) {
    research.set(s.slug, [...(research.get(s.slug) ?? []), `${c.intentId}:${s.coverage}`])
  }
  return inputs.articles
    .filter((a) => !mapped.has(a.slug))
    .map((a) => ({
      slug: a.slug,
      state: isPublic(a, classified.nowMs) ? 'LIVE' : 'SCHEDULED',
      publishAt: a.publishAt ?? a.publishedAt,
      researchIntents: research.get(a.slug) ?? [],
      kind: research.has(a.slug) ? 'BUNDLE_STALE — 연구 매핑은 있고 제품 번들에 없다' : 'NO_INTENT — 연구 정본에 대응 의도가 없다',
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
}

const manifestBody = (m) => { const { hash, ...body } = m; return body }
export const hashManifest = (m) => sha256(JSON.stringify(manifestBody(m)))

/**
 * 🔴 **같은 입력 → 바이트 단위 같은 manifest.** 시각·난수·파일 순서가 들어가지 않는다.
 *    큐 행과 그래프 행이 이 한 객체에서 나오고, 이 객체의 해시를 함께 단다.
 */
export function buildManifest(inputs, { at }) {
  const { asOf } = parseAt(at)
  const bm = inputs.buildManifest
  if (bm.graphVersion !== inputs.graph.graphVersion || bm.contentHash?.combined !== inputs.graph.contentHash?.combined) {
    throw new Error(`GRAPH_BUNDLE_MISMATCH — 연구 build ${bm.graphVersion}/${bm.contentHash?.combined} ≠ 제품 번들 ${inputs.graph.graphVersion}/${inputs.graph.contentHash?.combined}`)
  }
  const classified = classifyIntents(inputs, { at })
  const selection = selectCandidates(inputs, classified, { at })
  const m = {
    schema: G8_SCHEMA,
    at,
    asOf,
    inputs: inputs.hashes,
    /** 🔴 읽기만 한 제품 graph bundle. 이 도구는 이것을 갱신하지 않는다 — 편입 장부만 쓴다 */
    productGraphBundle: { graphVersion: inputs.graph.graphVersion, combined: inputs.graph.contentHash.combined,
      file: inputs.graphFile, updatedByThisTool: false },
    derived: DERIVED,
    counts: { intents: classified.rows.length, ...classified.counts,
      autoReadyTopic: inputs.buildIntents.filter((x) => x.topicVerdict === 'AUTO_READY_TOPIC').length,
      articles: inputs.articles.length, queue: inputs.queue.length },
    classification: classified.rows,
    selection: {
      primary: selection.primary.map(({ intentId, tier, score, evidence }) => ({ intentId, tier, score, evidence })),
      fallback: selection.fallback.map(({ intentId, tier, score, evidence }) => ({ intentId, tier, score, evidence })),
      excluded: selection.excluded,
    },
    queueRows: selection.primary.map((p) => p.queueRow),
    fallbackRows: selection.fallback.map((p) => p.queueRow),
    admissionRows: selection.primary.map((p) => p.admissionRow),
    drift: driftOf(inputs, classified),
  }
  m.hash = hashManifest(m)
  return m
}

// ── 쓰기 (명시적 apply 전용) ─────────────────────────────────

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
 * 🔴 **큐와 편입 장부가 같은 편입에서 왔는가.** G8 큐 행(intentId·g8ManifestHash)마다 장부 ADMITTED 사건이 있고,
 *    장부 사건마다 큐 행이 있거나 **등록된 글**이어야 한다. 영구 slug 표가 그 짝을 묶고 있어야 한다.
 *    급사 journal 이 남아 있으면 반쪽 상태일 수 있다 — 그것도 어긋남이다.
 *    🔴 제품 graph bundle 은 보지 않는다. 그것은 이 도구가 쓰지 않는다.
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

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.g8tmp-${process.pid}`
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeSync(fd, text); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
}
function restore(file, original) {
  if (original === null) { if (fs.existsSync(file)) fs.unlinkSync(file) } else writeAtomic(file, original)
}
const shaOrAbsent = (text) => (text === null ? 'ABSENT' : sha256(text))

/**
 * 🔴 **급사 복구.** journal 이 있다는 것은 앞선 apply 가 쓰는 도중 죽었다는 뜻이다(잠금을 지금 내가 쥐었으므로
 *    주인은 살아 있지 않다). 세 파일을 들어오기 전 바이트로 되돌린다.
 *    단, 파일이 그 apply 의 「전」 또는 「후」 바이트일 때만 — 그 사이 다른 writer(M-AUTO 등록)가 바꿨다면
 *    덮어쓰지 않고 RECOVERY_CONFLICT 로 멈춘다.
 */
export const JOURNAL_SCHEMA = 'g8-journal/1'

/**
 * 🔴 **journal 신원 검증** — 되돌리기 전에 「이 journal 이 지금 이 루트의 그 세 파일만 가리키는가」를 본다.
 *    schema · 정확히 3개 · 중복 0 · 현재 queueRoot/admissionRoot 에서 계산한 절대 경로와 정확히 일치.
 *    하나라도 어긋나면 어떤 파일도 쓰거나 지우지 않는다 — journal 자체도 남긴다.
 *    (앞판은 외부 경로를 가리킨 위조 journal 로 저장소 밖 파일을 **실제로 지웠다** — schema 가 틀려도.)
 */
export function checkJournalIdentity(j, expectedPaths) {
  const fail = (why) => ({ ok: false, code: 'RECOVERY_IDENTITY', why })
  if (!j || typeof j !== 'object') return fail('journal 이 객체가 아니다')
  if (j.schema !== JOURNAL_SCHEMA) return fail(`schema 가 ${JOURNAL_SCHEMA} 가 아니다 (${String(j.schema)})`)
  if (!Array.isArray(j.files)) return fail('files 가 배열이 아니다')
  const want = [...expectedPaths].sort()
  if (j.files.length !== want.length) return fail(`파일 수가 ${want.length} 이 아니다 (${j.files.length})`)
  const got = j.files.map((f) => f?.path)
  if (got.some((p) => typeof p !== 'string' || !path.isAbsolute(p))) return fail('절대 경로가 아닌 항목이 있다')
  if (new Set(got).size !== got.length) return fail('같은 경로가 두 번 있다')
  const sorted = [...got].sort()
  if (sorted.some((p, i) => p !== want[i])) return fail(`경로가 현재 루트의 세 파일과 다르다 (${sorted.join(', ')})`)
  for (const f of j.files) {
    if (!(f.before === null || typeof f.before === 'string')) return fail(`${f.path} 의 before 가 원문 또는 null 이 아니다`)
    if (typeof f.afterSha !== 'string') return fail(`${f.path} 의 afterSha 가 없다`)
  }
  return { ok: true }
}

function recoverJournal(journalPath, expectedPaths) {
  let j
  try { j = JSON.parse(fs.readFileSync(journalPath, 'utf8')) } catch (e) {
    return { ok: false, code: 'RECOVERY_IDENTITY', why: `journal 을 읽지 못했다: ${e.message}` }
  }
  const id = checkJournalIdentity(j, expectedPaths)
  if (!id.ok) return id
  const files = j.files
  for (const f of files) {
    const cur = shaOrAbsent(readOptional(f.path))
    if (cur !== shaOrAbsent(f.before) && cur !== f.afterSha) {
      return { ok: false, code: 'RECOVERY_CONFLICT', why: `${f.path} 가 급사 뒤 다른 writer 에 의해 바뀌었다 — 되돌리지 않는다` }
    }
  }
  for (const f of files) restore(f.path, f.before)
  const intact = files.every((f) => readOptional(f.path) === f.before)
  if (!intact) return { ok: false, code: 'RECOVERY_FAILED', why: '되돌린 뒤 바이트가 원본과 다르다' }
  fs.unlinkSync(journalPath)
  return { ok: true, manifestHash: j.manifestHash ?? null, files: files.map((f) => f.path) }
}

/**
 * 🔴 편입 장부 행은 **정본 m3-pipeline 의 recordAdmission 이 만든다.** 직접 append 하지 않는다.
 *    임시 사본에 차례로 적어 다음 장부 바이트를 얻고, 정본 validateLedger 로 다시 확인한다.
 *    한 건이라도 거부되면 null — 실제 장부에는 한 바이트도 쓰지 않는다.
 */
function stageAdmissions(pipeline, beforeLedger, rows, at) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-ledger-'))
  const stateFile = path.join(dir, 'm3-state.jsonl')
  try {
    fs.writeFileSync(stateFile, beforeLedger ?? '')
    for (const item of rows) {
      const r = pipeline.recordAdmission({ stateFile, item, at })
      if (!r.ok) return { ok: false, why: `${item.intentId}: ${r.why}` }
      if (!r.appended) return { ok: false, why: `${item.intentId}: 장부에 이미 있다 (idempotent) — 일부만 반영된 상태다` }
    }
    const text = fs.readFileSync(stateFile, 'utf8')
    const v = pipeline.validateLedger(parseJsonl(text, 'ledger'))
    return v.ok ? { ok: true, text } : { ok: false, why: v.problems[0] }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
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
 * 🔴 **명시적 apply.** 큐 1파일 + 편입 장부 2파일을 한 묶음으로 쓴다. 제품 graph bundle 은 쓰지 않는다.
 *    · 단일 writer 잠금(`m3-state.jsonl.lock` — 격리 장부와 같은 잠금 구현) 안에서만 읽고 쓴다
 *    · 잠금을 쥐면 먼저 앞선 급사의 journal 을 되돌린다
 *    · manifest 해시가 본문과 다르면 쓰지 않는다
 *    · 이미 전부 반영됐으면 아무것도 쓰지 않는다 (ALREADY_APPLIED)
 *    · manifest 에 기록된 **모든 입력**을 다시 해시해 하나라도 다르면 쓰지 않는다 (STALE_INPUT)
 *    · 장부가 정본 계약을 어기면 쓰지 않는다 (LEDGER_INVALID · ADMISSION_REJECTED)
 *    · 쓰기 전에 원본 바이트를 journal 에 적고, 실패하면 세 파일을 되돌린다
 *
 * @param {object} p
 * @param {object} p.manifest
 * @param {string} p.queueRoot      drafts/magazine/topic-queue.ts 를 가진 저장소 루트
 * @param {string} p.admissionRoot  편입 장부(contract/m3-slug-manifest.json · m3-state.jsonl)를 가진 연구 루트
 * @param {(stage:string)=>void} [p.faultHook]  시험 전용 — 단계마다 불린다
 */
export async function applyManifest({ manifest, queueRoot, admissionRoot, faultHook = testPauseHook() }) {
  if (manifest?.schema !== G8_SCHEMA) return { ok: false, code: 'SCHEMA', why: `manifest schema 가 ${G8_SCHEMA} 가 아니다` }
  if (hashManifest(manifest) !== manifest.hash) return { ok: false, code: 'HASH_MISMATCH', why: 'manifest 본문과 해시가 다르다' }
  /**
   * 🔴 **후보 0건이어도 여기서 돌아가지 않는다.** 앞선 급사의 journal 은 잠금 안에서만 되돌릴 수 있고,
   *    빈 manifest 가 그것을 건너뛰면 반쪽 상태가 남는다. pipeline 은 실제로 쓸 행이 있을 때만 읽는다.
   */
  let pipeline = null
  if (manifest.queueRows.length) {
    const pipelinePath = path.join(admissionRoot, RESEARCH_FILES.pipelineModule)
    if (!fs.existsSync(pipelinePath)) return { ok: false, code: 'PIPELINE_MISSING', why: pipelinePath }
    pipeline = await import(pathToFileURL(pipelinePath).href)
    if (typeof pipeline.recordAdmission !== 'function' || typeof pipeline.validateLedger !== 'function') {
      return { ok: false, code: 'PIPELINE_MISSING', why: 'm3-pipeline.mjs 에 recordAdmission · validateLedger 가 없다' }
    }
  }
  const ctx = { manifest, queueRoot, admissionRoot, faultHook, pipeline }
  /**
   * 🔴 **잠금 순서는 queue → admission 으로 고정이다** (`QUEUE_LOCK_ORDER`).
   *    queue 잠금은 M-AUTO 등록과 공유한다 — 큐를 읽기 전에 쥐고 쓴 뒤에 놓는다.
   */
  const queueFile = path.join(queueRoot, PRODUCT_FILES.queue)
  const ledgerPath = path.join(admissionRoot, ADMISSION_FILES.ledger)
  const locked = withQueueWriteLock(queueFile, () => {
    const inner = withQuarantineLock(ledgerPath, () => applyLocked(ctx), { waitMs: 0 })
    return inner.ok ? inner.value : { ok: false, code: 'LOCKED', why: `편입 장부 잠금: ${inner.why}` }
  }, { waitMs: 0 })
  if (!locked.ok) return { ok: false, code: 'LOCKED', why: `큐 writer 잠금: ${locked.why}` }
  return locked.value
}

/** 잠금 안에서만 불린다. 🔴 동기다 — 잠금은 이 함수가 돌아오는 순간 풀린다 */
function applyLocked({ manifest, queueRoot, admissionRoot, faultHook, pipeline }) {
  faultHook('locked:enter')
  const journalPath = path.join(admissionRoot, JOURNAL_FILE)
  const files = {
    queue: path.join(queueRoot, PRODUCT_FILES.queue),
    slugManifest: path.join(admissionRoot, ADMISSION_FILES.slugManifest),
    ledger: path.join(admissionRoot, ADMISSION_FILES.ledger),
  }
  let recovered = null
  if (fs.existsSync(journalPath)) {
    recovered = recoverJournal(journalPath, Object.values(files))
    if (!recovered.ok) return recovered
  }
  if (!manifest.queueRows.length) return { ok: true, code: 'NOTHING_TO_APPLY', written: [], recovered }

  const before = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readOptional(f)]))
  if (before.queue === null) return { ok: false, code: 'QUEUE_MISSING', why: files.queue, recovered }
  const articlesSource = readOptional(path.join(queueRoot, PRODUCT_FILES.articles))
  const stamped = manifest.queueRows.map((r) => ({ ...r, g8ManifestHash: manifest.hash }))

  // 이미 전부 반영됐는가 — 큐에서 빠진 행은 M-AUTO 가 등록한 것이다(장부·slug 표가 함께 있을 때만)
  const queue = parseQueueSource(before.queue)
  const ledger = parseJsonl(before.ledger ?? '', 'ledger')
  const slugs = before.slugManifest ? JSON.parse(before.slugManifest).slugs ?? {} : {}
  const registered = articlesSource ? new Set(parseArticlesSource(articlesSource).map((a) => a.slug)) : new Set()
  const complete = stamped.every((r) =>
    (registered.has(r.slug) || queue.some((x) => x.slug === r.slug && x.intentId === r.intentId && x.g8ManifestHash === manifest.hash))
    && ledger.some((x) => x.event === 'ADMITTED' && x.slug === r.slug && x.intentId === r.intentId)
    && slugs[r.intentId] === r.slug)
  if (complete) return { ok: true, code: 'ALREADY_APPLIED', written: [], recovered }

  // 🔴 manifest 가 읽은 입력 전부를 다시 해시한다 — 큐 하나만 보지 않는다
  let current
  try { current = readInputs({ researchDir: admissionRoot, repoDir: queueRoot }) } catch (e) {
    return { ok: false, code: 'STALE_INPUT', why: `입력을 다시 읽지 못했다: ${e.message}`, recovered }
  }
  const stale = diffHashes(manifest.inputs, current.hashes)
  if (stale.length) return { ok: false, code: 'STALE_INPUT', why: `manifest 이후 바뀌었다: ${stale.join(', ')}`, stale, recovered }

  const ledgerCheck = pipeline.validateLedger(ledger)
  if (!ledgerCheck.ok) return { ok: false, code: 'LEDGER_INVALID', why: ledgerCheck.problems[0], recovered }
  for (const r of stamped) {
    if (queue.some((x) => x.slug === r.slug)) return { ok: false, code: 'SLUG_IN_QUEUE', why: r.slug, recovered }
    if (slugs[r.intentId] && slugs[r.intentId] !== r.slug) return { ok: false, code: 'INTENT_BOUND_ELSEWHERE', why: `${r.intentId} → ${slugs[r.intentId]}`, recovered }
    if (Object.entries(slugs).some(([id, sl]) => sl === r.slug && id !== r.intentId)) return { ok: false, code: 'SLUG_BOUND_ELSEWHERE', why: r.slug, recovered }
  }

  const next = {}
  next.queue = insertQueueRows(before.queue, stamped)
  const sm = before.slugManifest ? JSON.parse(before.slugManifest) : { _note: '🔴 intentId ↔ slug 영구 대응. 한 번 정하면 바꾸지 않는다', asOf: manifest.asOf, slugs: {} }
  const nextSlugs = { ...(sm.slugs ?? {}) }
  for (const r of stamped) nextSlugs[r.intentId] = r.slug
  next.slugManifest = `${JSON.stringify({ ...sm, asOf: manifest.asOf, slugs: nextSlugs }, null, 2)}\n`
  const staged = stageAdmissions(pipeline, before.ledger, manifest.admissionRows, manifest.at)
  if (!staged.ok) return { ok: false, code: 'ADMISSION_REJECTED', why: staged.why, recovered }
  next.ledger = staged.text

  // 쓰기 전 검증 — M-AUTO 가 읽는 같은 파서로 읽힌다
  const parsed = parseQueueSource(next.queue)
  if (parsed.length !== queue.length + stamped.length) return { ok: false, code: 'RENDER_INVALID', why: '큐 행 수가 맞지 않는다', recovered }
  for (const r of stamped) {
    const got = parsed.find((x) => x.slug === r.slug)
    if (JSON.stringify(got) !== JSON.stringify(r)) return { ok: false, code: 'RENDER_INVALID', why: `${r.slug} 가 그대로 읽히지 않는다`, recovered }
  }

  faultHook('locked:ready')
  writeAtomic(journalPath, JSON.stringify({
    schema: 'g8-journal/1', manifestHash: manifest.hash, pid: process.pid,
    files: Object.keys(files).map((k) => ({ path: files[k], before: before[k], afterSha: sha256(next[k]) })),
  }))
  const written = []
  try {
    for (const k of ['queue', 'slugManifest', 'ledger']) {
      writeAtomic(files[k], next[k])
      written.push(k)
      faultHook(`after:${k}`)
    }
    const check = verifyConsistency({
      queueSource: readOptional(files.queue), articlesSource,
      ledgerSource: readOptional(files.ledger), slugManifestSource: readOptional(files.slugManifest),
    })
    faultHook('after:verify')
    if (!check.ok) throw new Error(`쓰기 뒤 대조 실패: ${check.problems.join(' / ')}`)
    fs.unlinkSync(journalPath)
    return { ok: true, code: 'APPLIED', written, rows: stamped.length, hash: manifest.hash, recovered }
  } catch (e) {
    for (const k of Object.keys(files)) restore(files[k], before[k])
    const intact = Object.keys(files).every((k) => readOptional(files[k]) === before[k])
    if (intact && fs.existsSync(journalPath)) fs.unlinkSync(journalPath)
    return { ok: false, code: 'ROLLED_BACK', why: e.message, written, restored: intact, recovered }
  }
}

/** CLI 용 — manifest 를 읽고 해시를 확인한다 */
export function readManifestFile(file) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { manifest: m, valid: m?.schema === G8_SCHEMA && hashManifest(m) === m.hash }
}
