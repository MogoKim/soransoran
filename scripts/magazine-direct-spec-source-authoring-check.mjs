#!/usr/bin/env node
/**
 * ArticlePlan(source/2) 반례 검사 — prepare · approve · materialize · 소비 관문 · producer 선택.
 *
 * 🔴 실제 함수와 실제 CLI 를 임시 루트에서 태운다. 제품 저장소 · control · 연구 G8 admission(receipt · slug manifest · ledger)은
 *    매번 합성한다 — receipt 는 실제 G8 편입기의 `hashManifest` · `makeReceipt` 로 만든다(자기 불변식을 흉내 내지 않는다).
 *    운영 queue · articles · graph · 연구 정본 · runtime 쓰기 0, 네트워크 · Chrome · 모델 호출 0.
 *    큐 writer lock 은 시험 모드 임시 폴더에서만 쥔다. 실제 저장소는 읽기 전용 확인 하나(S24c)만 하고,
 *    끝에 실제 제품 파일 바이트가 그대로인지 본다.
 *
 * 필수 리허설(E1) — receipt → prepare → fixture plan → approve → materialize → compileArticleSpec → producer 가 DIRECT 로만 선택.
 *
 * `authoringCases(lib, { cliPath, source, direct })` · `linkCases(blockText)` 를 export 한다 —
 * 변이 검사가 변이 lib · source · direct 모듈로 같은 반례를 다시 돌린다.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..')
export const LIB_PATH = join(ROOT, 'scripts/lib/magazine-direct-spec-source-authoring.mjs')
export const CLI_PATH = join(ROOT, 'scripts/magazine-direct-spec-source-authoring.mjs')
export const SOURCE_CHECK_PATH = join(ROOT, 'scripts/magazine-direct-spec-source-check.mjs')
export const SOURCE_PATH = join(ROOT, 'scripts/lib/magazine-direct-spec-source.mjs')
export const DIRECT_PATH = join(ROOT, 'scripts/lib/magazine-direct-spec.mjs')
const FIXTURE = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')
const RESOLVER_TEXT = readFileSync(join(ROOT, 'src/lib/magazine-graph.ts'), 'utf8')
const QUEUE_TEXT = readFileSync(join(ROOT, 'drafts/magazine/topic-queue.ts'), 'utf8')
/** 🔴 plan 허용값은 실제 topic-queue.ts 의 union 이다 — 합성 큐도 같은 머리말(타입 선언)을 쓴다 */
const QUEUE_HEADER = QUEUE_TEXT.slice(0, QUEUE_TEXT.indexOf('export const TOPIC_QUEUE'))
const fx = () => JSON.parse(readFileSync(FIXTURE, 'utf8'))

// 🔴 macOS 의 /var → /private/var symlink 를 피한다 — 출력 루트는 canonical 경로여야 한다
const TMP_BASE = realpathSync(tmpdir())
const TMPS = []
const tmp = (p) => { const d = mkdtempSync(join(TMP_BASE, `dssa-${p}-`)); TMPS.push(d); return d }
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
// 🔴 producer 모듈을 import 하기 전에 격리한다 — HOME · drafts · 큐 writer lock 은 시험 모드 임시 폴더다
process.env.HOME = tmp('home')
process.env.SORAN_MAGAZINE_TEST_MODE = '1'
process.env.SORAN_MAGAZINE_DRAFTS_DIR = tmp('drafts-env')
process.env.SORAN_MAGAZINE_QUEUE_LOCK_DIR = tmp('qlock')

const imp = (p) => import(pathToFileURL(p).href)
const g8 = await imp(join(ROOT, 'scripts/lib/magazine-g8-promoter.mjs'))
const { parseArticlesSource, parseQueueSource } = await imp(join(ROOT, 'scripts/lib/magazine-load.mjs'))
const { verifyArticleSpec } = await imp(join(ROOT, 'scripts/lib/magazine-article-spec.mjs'))
const { withQueueWriteLock } = await imp(join(ROOT, 'scripts/lib/magazine-queue-lock.mjs'))
const producerPlan = await imp(join(ROOT, 'scripts/magazine-producer-plan.mjs'))
const briefAuto = await imp(join(ROOT, 'scripts/magazine-brief-auto.mjs'))
const REAL = { source: await imp(SOURCE_PATH), direct: await imp(DIRECT_PATH) }

const GV = 'g-20261015-aaaaaa'
const OLD_GV = 'g-20260923-bbbbbb'
const SLUG = 'dssa-target'
const INTENT = 'I-DSSA-01'
// 🔴 실제 시계보다 과거 — CLI(실제 Date.now())도 같은 시각으로 승인할 수 있게
const AS_OF = '2026-10-14T09:00:00+09:00'
const AT = '2026-10-14T10:00:00+09:00'
const NOW = Date.parse('2026-10-14T12:00:00+09:00')
const TODAY = '2026-10-14'
const REL = [
  ['I-R1', 'rel-a', 'DIRECT_NEXT', 'NEXT_QUESTION', 'FOOTER_NEXT', '다음 질문으로 이어진다'],
  ['I-R2', 'rel-b', 'SAME_EXPERIENCE', 'SIBLING', 'FOOTER_SIBLING', '같은 밤 경험이다'],
  ['I-R3', 'rel-c', 'ACTION_OR_CONTEXT', 'ACTION', 'FOOTER_NEXT', '생활 조정으로 이어진다'],
  ['I-R4', 'rel-d', 'BRIDGE_DISCOVERY', 'BRIDGE', 'FOOTER_BRIDGE', '다른 영역의 질문이다'],
]
const RESEARCH_INTENTS = `${JSON.stringify({ schemaVersion: 'intent/2', intentId: INTENT, primaryQuery: '잠 설친 다음 날', audienceSituation: '밤에 깬다', answerScope: '생활 조정', exclusions: ['진단'] })}\n`
const h16 = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16)
const DROP_G8 = ({ intentId: _i, g8ManifestHash: _g, directSpecMode: _d, articlePlanHash: _p, ...q }) => q
/** 큐에 원래 있던 legacy 행 — G8 신원 없음 · STANDARD */
const LEGACY_ROW = () => ({ ...DROP_G8(fx().queueItem), day: 22, slug: 'dssa-legacy', internalLinks: [] })
/** 사람이 정한다고 가정한 plan — fixture 큐 행의 plan 필드(시험 전용) */
const PLAN = () => Object.fromEntries(REAL.source.ARTICLE_PLAN_REQUIRED.map((k) => [k, fx().queueItem[k]]))

/** 제품 bundle edge → receipt 관계 */
const receiptRel = (graph, e) => ({ edgeId: e.id, slot: e.slot, toIntentId: e.to, anchorLabel: e.anchor, readerReason: e.reason,
  targetSlug: graph.mappings.find((m) => m.intent === e.to)?.slug })
export function admissionOf(graph) {
  const mine = graph.edges.filter((e) => e.from === INTENT)
  return { intentId: INTENT, slug: SLUG, cluster: 'sleep', primaryQuery: '잠 설친 다음 날', territoryId: 'T1',
    direct: mine.filter((e) => e.slot !== 'BRIDGE_DISCOVERY').map((e) => receiptRel(graph, e)),
    discovery: receiptRel(graph, mine.find((e) => e.slot === 'BRIDGE_DISCOVERY')), reverse: [] }
}
/** 실제 G8 함수로 만든 receipt — 파일명 = manifestHash · receiptHash 는 승인 포함 본문 해시 */
export function receiptFor(admissions, { graphVersion = GV, at = '2026-10-13T14:00:00+09:00' } = {}) {
  const manifest = { schema: g8.G8_SCHEMA, at, snapshot: { name: 'dssa-snapshot', inputSha256: {} },
    graph: { graphVersion, contentHash: { combined: 'dssa' }, graphSemanticHash: 'dssa-semantic', exportHash: 'dssa-export' },
    readiness: { readinessHash: 'dssa-readiness-0001', readinessFileSha256: 'dssa-readiness-file', inputs: {} },
    identityInputHashes: {}, admissions, refused: [] }
  manifest.hash = g8.hashManifest(manifest)
  return g8.makeReceipt({ manifest, approval: { approvedBy: '창업자', approvedAt: '2026-10-13T14:30:00+09:00', confirmManifestHash: manifest.hash },
    committedAt: '2026-10-13T15:00:00+09:00' })
}
/** recordAdmission 이 쓰는 형태의 ADMITTED 사건 — 관계는 receipt 와 같은 네 필드 */
const ledgerRowOf = (a) => ({ schemaVersion: 'm3ledger/2', event: 'ADMITTED', intentId: a.intentId, slug: a.slug, title: a.primaryQuery, cluster: a.cluster,
  directRelations: a.direct.map(({ slot, toIntentId, anchorLabel, readerReason }) => ({ slot, toIntentId, anchorLabel, readerReason })),
  discoveryRelation: a.discovery ? { slot: a.discovery.slot, toIntentId: a.discovery.toIntentId, anchorLabel: a.discovery.anchorLabel, readerReason: a.discovery.readerReason } : null,
  internalLinks: [], at: '2026-10-13T15:00:00+09:00' })

const bundleText = (graph, exportHash) => `import type { MagazineGraph } from './types'\n\nexport const GRAPH: MagazineGraph = ${JSON.stringify(graph, null, 2)} as const\n\n/** test */\nexport const EXPORT_HASH = '${exportHash}'\n`
const exportHashOf = (graph) => createHash('sha256').update(JSON.stringify(graph)).digest('hex').slice(0, 16)
/** 실제 큐와 같은 형식(원소마다 끝 쉼표) — 공용 렌더러로 쓴다 */
export const queueFileText = (rows) => `${QUEUE_HEADER}export const TOPIC_QUEUE: TopicQueueItem[] = [\n${rows.map(g8.renderQueueRow).join('')}]\n`

/**
 * 합성 세계 — 제품 저장소(작업 트리) · 연구 G8 admission 루트 · 연구 참고 루트. mutate 로 반례 상태를 만든다.
 * 🔴 receipt 는 **바꾸기 전** graph 로 만든다 — graph 를 바꾸는 반례는 「receipt 이후 제품 판이 달라진」 상태다.
 */
export function makeWorld(mutate = {}) {
  const base = tmp('world')
  const repo = join(base, 'repo'); const admission = join(base, 'admission'); const research = join(base, 'research')
  const graph = {
    graphVersion: GV,
    schemaVersion: { intent: 'intent/2', edge: 'edge/3', mapping: 'mapping/2', manifest: 'manifest/1' },
    contentHash: { intents: h16(RESEARCH_INTENTS), edges: 'e0000000000000aa', mappings: 'm0000000000000aa', combined: 'c0000000000000aa' },
    generatedAt: '2026-10-15T00:00:00.000Z',
    edges: REL.map(([to, slug, slot, type, placement, reason], i) => ({ id: `E-${i + 1}`, from: INTENT, to, type, slot, anchor: `a-${slug}`, reason,
      placement, priority: i + 1, fromCluster: 'sleep', toCluster: 'sleep', active: false })),
    mappings: REL.map(([intent, slug]) => ({ intent, slug, cluster: 'sleep' })),
    intents: [{ id: INTENT, cluster: 'sleep', board: 'menopause' }, ...REL.map(([id]) => ({ id, cluster: 'sleep', board: 'menopause' }))],
  }
  mutate.receiptGraph?.(graph)
  const adm = admissionOf(graph)
  mutate.admission?.(adm)
  const receiptGraph = structuredClone(graph)
  mutate.graph?.(graph)
  const pointer = mutate.pointer ?? GV
  const gdir = join(repo, 'src/content/magazine/graph'); mkdirSync(gdir, { recursive: true })
  writeFileSync(join(repo, '.git'), 'gitdir: /dev/null\n')
  writeFileSync(join(gdir, 'current.ts'), `// test\nexport { GRAPH, EXPORT_HASH } from './${pointer}'\n`)
  writeFileSync(join(gdir, `${pointer}.ts`), bundleText(graph, mutate.exportHash ?? exportHashOf(graph)))
  // receipt 가 가리키는 판이 current 와 다르면 그 판 bundle 도 둔다(제품 저장소는 과거 판을 지운 적이 없다)
  const receiptGv = mutate.receiptGraphVersion ?? GV
  if (receiptGv !== pointer) {
    const old = { ...receiptGraph, graphVersion: receiptGv }
    writeFileSync(join(gdir, `${receiptGv}.ts`), bundleText(old, exportHashOf(old)))
  }
  const control = { graphVersion: GV, enabled: true, enabledClusters: ['sleep', 'family'],
    surfaces: { CTA_END: true, FOOTER_NEXT: true, FOOTER_SIBLING: true, FOOTER_BRIDGE: true, SERIES_NAV: false, BODY_INLINE_OR_TOP: false, BODY_CALLOUT: false },
    killSwitch: { tripped: false, trippedAt: null, trippedBy: null, reason: null } }
  mutate.control?.(control)
  writeFileSync(join(gdir, 'control.ts'), `export const CONTROL: MagazineGraphControl = {\n  graphVersion: '${control.graphVersion}',\n  enabled: ${control.enabled},\n  enabledClusters: ${JSON.stringify(control.enabledClusters).replace(/"/g, "'")},\n  surfaces: ${JSON.stringify(control.surfaces)},\n  killSwitch: ${JSON.stringify(control.killSwitch)},\n  previousGraphVersion: null,\n} as const\n`)
  mkdirSync(join(repo, 'src/lib'), { recursive: true })
  writeFileSync(join(repo, 'src/lib/magazine-graph.ts'), mutate.resolver ? mutate.resolver(RESOLVER_TEXT) : RESOLVER_TEXT)
  const record = Object.fromEntries(REL.map(([, slug]) => [slug, { title: slug, description: 'd', cluster: 'sleep', publishedAt: '2026-10-01' }]))
  mutate.articles?.(record)
  writeFileSync(join(repo, 'src/content/magazine/articles.ts'), `const MAGAZINE_ARTICLE_RECORD = ${JSON.stringify(record, null, 2)}\n`)
  const queue = [LEGACY_ROW()]
  mutate.queue?.(queue)
  mkdirSync(join(repo, 'drafts/magazine'), { recursive: true })
  writeFileSync(join(repo, 'drafts/magazine/topic-queue.ts'), queueFileText(queue))
  // ── 연구 G8 admission ──
  const receipt = receiptFor([adm], { graphVersion: receiptGv })
  mutate.receipt?.(receipt)
  const rdir = join(admission, 'contract/g8-admission'); mkdirSync(rdir, { recursive: true })
  if (!mutate.noReceipt) writeFileSync(join(rdir, `${mutate.receiptName ?? receipt.manifestHash}.json`), g8.receiptBytes(receipt))
  for (const extra of mutate.extraReceipts?.(adm) ?? []) writeFileSync(join(rdir, `${extra.manifestHash}.json`), g8.receiptBytes(extra))
  const ledger = [ledgerRowOf(adm)]
  mutate.ledger?.(ledger)
  const slugs = { [INTENT]: SLUG }
  mutate.slugs?.(slugs)
  writeFileSync(join(admission, 'contract/m3-state.jsonl'), ledger.map((x) => JSON.stringify(x)).join('\n') + (ledger.length ? '\n' : ''))
  writeFileSync(join(admission, 'contract/m3-slug-manifest.json'), JSON.stringify({ slugs }, null, 2))
  if (mutate.journal) writeFileSync(join(admission, 'contract/.g8-admission.journal.json'), '{}')
  if (mutate.lock) writeFileSync(join(admission, 'contract/.g8-admission.lock'), '{}')
  // ── 연구 참고(intent hint) ──
  const rIntents = mutate.researchIntents ?? RESEARCH_INTENTS
  const rmanifest = { graphVersion: OLD_GV, contentHash: { intents: h16(RESEARCH_INTENTS), edges: 'e-old', mappings: 'm-old', combined: 'c-old' } }
  mutate.researchManifest?.(rmanifest)
  mkdirSync(join(research, 'contract/build/current'), { recursive: true })
  writeFileSync(join(research, 'contract/build/current/manifest.json'), JSON.stringify(rmanifest))
  writeFileSync(join(research, 'contract/build/current/intents.jsonl'), rIntents)
  return { base, repo, admission, research, graph, receipt, adm }
}

/** source/3 — 사람이 정한 글별 주제 금지 패턴(시험 전용 · 공통 목록·지침 문장과 겹치지 않는다) */
const TOPIC_PATTERNS = ['수면제를 드세요', '불면증 진단입니다']
/** 사람이 채운다고 가정한 값 — fixture 의 승인 node 문장 · plan 을 그대로 쓴다(시험 전용) */
function fill(candidate, over = {}) {
  const c = structuredClone(candidate)
  const n = fx().node
  Object.assign(c.entry.node, { readerQuestion: n.readerQuestion, scope: n.scope, outline: n.outline, evidence: n.evidence,
    safetyConstraints: n.safetyConstraints, forbiddenPatterns: [...TOPIC_PATTERNS], hubPath: n.hubPath, ctaLabel: n.ctaLabel })
  c.entry.plan = { ...PLAN(), ...(over.plan ?? {}) }
  c.entry.hero = ['REQUIRED', 'OPTIONAL'].includes(c.entry.plan.imageMode) ? fx().hero : null
  c.entry.publication = { publishAt: '2026-10-22T10:30:00+09:00' }
  over.edit?.(c)
  return c
}

const sourceFile = (repo) => join(repo, 'drafts/magazine/article-spec-source', `${GV}.json`)
const queueFile = (repo) => join(repo, 'drafts/magazine/topic-queue.ts')
const queueOf = (repo) => parseQueueSource(readFileSync(queueFile(repo), 'utf8'))
const plain = (v) => JSON.parse(JSON.stringify(v))
/** 개정 반례 — 운영 디스크에서 사람이 읽었다고 가정한 옛 specHash · 새 공개 시각 */
const OLD_SPEC = `sha256:${'a'.repeat(64)}`
const NEW_AT = '2026-10-23T10:30:00+09:00'

/** 큐 복제 필드 손편집 — 필드마다 값을 실제로 바꾼다 (QUEUE_REPLICA_FIELDS 와 1:1) */
export const REPLICA_EDITS = {
  title: (q) => `${q.title} (손으로 고침)`,
  contentType: () => 'COMMUNITY',
  intent: () => '방법',
  cluster: () => 'family',
  target: (q) => `${q.target} 일부`,
  validationProfile: () => 'MEDICAL',
  riskLevel: () => 'HIGH',
  reviewMode: () => 'FULL_REVIEW',
  imageMode: () => 'OPTIONAL',
  autoEligible: () => false,
  seriesId: () => 'hand-added-series',
  seriesOrder: () => 2,
  season: () => '가을',
  calendarEvent: () => '추석',
  publishWindow: () => ({ after: '2026-10-01', before: '2026-12-31' }),
  ctaBoard: () => '/community/free',
  internalLinks: (q) => q.internalLinks.slice(0, 3),
  whyNow: (q) => `${q.whyNow} 덧붙임`,
  notes: (q) => `${q.notes} 덧붙임`,
  directSpecMode: () => 'DIRECT_SPEC_V1-EDIT',
}

export function authoringCases(lib, { cliPath = CLI_PATH, source = REAL.source, direct = REAL.direct } = {}) {
  const prepare = (w, extra = {}) => lib.prepareCandidate({ repoRoot: w.repo, admissionRoot: w.admission, slug: SLUG, asOf: AS_OF, nowMs: NOW, ...extra })
  const ready = (w, over, extra) => { const r = prepare(w, extra); assert.equal(r.ok, true, `${r.code} ${r.why}`); return fill(r.candidate, over) }
  const approve = (w, c, extra = {}) => lib.approveCandidate({ candidate: c, approver: '창업자', at: AT, confirmCandidateHash: lib.candidateHashOf(c),
    repoRoot: w.repo, admissionRoot: w.admission, outRoot: w.repo, nowMs: NOW, ...extra })
  const materialize = (w, extra = {}) => lib.materializePlan({ repoRoot: w.repo, admissionRoot: w.admission, slug: SLUG, outRoot: w.repo, ...extra })
  const approved = (w, over) => { const a = approve(w, ready(w, over)); assert.equal(a.ok, true, `${a.code} ${a.why}`); return a }
  const queued = (w, over) => { const a = approved(w, over); const m = materialize(w); assert.equal(m.ok, true, `${m.code} ${m.why}`); return { a, m } }
  const rejected = (w, extra) => { const r = prepare(w, extra); assert.equal(r.ok, false, '거부돼야 할 admission 으로 후보를 만들었다'); return r }
  const blockersOf = (w, extra) => { const r = prepare(w, extra); assert.equal(r.ok, true, `${r.code} ${r.why}`); return r.candidate.blockers }
  const judgeRow = (w, row) => source.judgeDirectSpecSource({ queueItem: row, draftsDir: join(w.repo, 'drafts/magazine'), expectedGraphVersion: GV, productRoot: w.repo })
  /** 충돌 뒤 큐에 남은 내 slug·intent 행(변조 행)은 실제 소비 관문과 producer 선택이 HOLD 해야 한다 (자동 생산 대상 0) */
  const assertHeld = (w, blocker) => {
    const q = queueOf(w.repo)
    const rows = q.filter((x) => x.slug === SLUG || x.intentId === INTENT)
    assert.ok(rows.length >= 1, '반례 준비 실패 — 남은 행이 없다')
    const draftsDir = join(w.repo, 'drafts/magazine')
    const judge = (item) => source.verifyDirectSpecIdentity({ queueItem: item, draftsDir, expectedGraphVersion: GV, productRoot: w.repo })
    for (const r of rows) {
      const j = judge(r)
      if (r.directSpecMode === 'DIRECT_SPEC_V1' && r.g8ManifestHash) {
        assert.equal(j.ok, false, `남은 행 ${r.slug} 이 소비 관문을 통과했다`)
        assert.ok(j.evidence.blockers.includes(blocker), `${r.slug}: ${j.evidence.blockers}`)
      }
    }
    const articles = parseArticlesSource(readFileSync(join(w.repo, 'src/content/magazine/articles.ts'), 'utf8'))
    const sel = producerPlan.selectWithDirectGate({ queue: q, articles, today: TODAY, produceCount: 5, reviewCount: 0, draftExists: () => false, judgeDirect: judge })
    assert.ok(!sel.directReady.has(SLUG) && ![...sel.directReady.values()].some((x) => x.spec?.identity?.intentId === INTENT), 'producer 가 충돌 행을 DIRECT 준비로 골랐다')
    assert.ok(!sel.selected.some((x) => x.slug === SLUG || x.intentId === INTENT), 'producer 가 충돌 행을 선정했다')
  }
  const COUNTS = {}

  return [
    // ── A. admission-only prepare ───────────────────────────────
    ['S01 prepare 는 DRAFT 만 · 큐 행 없이 성공 — APPROVED·approvedBy·approvedAt 0 · 파일 0 · 관계는 receipt edge', () => {
      const w = makeWorld(); const r = prepare(w)
      assert.equal(r.ok, true, `${r.code} ${r.why}`)
      assert.ok(!queueOf(w.repo).some((q) => q.slug === SLUG), '반례 준비 실패 — 큐에 이 slug 가 있다')
      const c = r.candidate
      assert.equal(c.schema, 'magazine-article-spec-source-candidate/3'); assert.equal(c.status, 'DRAFT'); assert.equal(c.entry.node.status, 'DRAFT')
      assert.ok(!JSON.stringify(c).includes('APPROVED'), 'prepare 가 APPROVED 를 만들었다')
      for (const k of ['approvedBy', 'approvedAt', 'status', 'sourceHash', 'productBasis']) assert.ok(!(k in c.entry), `entry.${k}`)
      assert.equal(c.candidateHash, lib.candidateHashOf(c))
      assert.deepEqual(c.blockers, [])
      assert.deepEqual(c.entry.admission, { g8ManifestHash: w.receipt.manifestHash, receiptHash: w.receipt.receiptHash, graphVersion: GV, readinessHash: 'dssa-readiness-0001' })
      assert.deepEqual(c.entry.relations.direct.map((x) => x.slug), ['rel-a', 'rel-b', 'rel-c']); assert.equal(c.entry.relations.discovery.slug, 'rel-d')
      assert.deepEqual(c.identity.admission.edges, ['E-1', 'E-2', 'E-3', 'E-4'])
      assert.ok(Object.values(c.entry.plan).every((v) => v === null), 'prepare 가 plan 을 지어냈다')
      for (const k of source.ARTICLE_PLAN_REQUIRED) assert.ok(c.unresolvedFields.includes(`plan.${k}`), `plan.${k} 가 미해결로 남지 않았다`)
      for (const p of ['readerQuestion', 'outline', 'hubPath', 'ctaLabel', 'safetyConstraints', 'forbiddenPatterns']) assert.equal(c.entry.node[p], null, `prepare 가 ${p} 를 지어냈다`)
      assert.ok(c.unresolvedFields.includes('node.forbiddenPatterns'), 'source/3 글별 주제 금지 패턴이 미해결로 남지 않았다')
      assert.equal(c.provenance['relations.direct'].status, 'DERIVED'); assert.equal(c.provenance['plan.title'].status, 'UNRESOLVED')
      assert.equal(c.entry.publication.publishAt, null); assert.equal(c.hint.primaryQuery, '잠 설친 다음 날')
      assert.equal(existsSync(sourceFile(w.repo)), false)
    }],
    ['S02 graphVersion 불일치(pointer≠bundle·control) · EXPORT_HASH 불일치 → blocker', () => {
      assert.ok(blockersOf(makeWorld({ graph: (g) => { g.graphVersion = OLD_GV } })).includes('GRAPH_VERSION_MISMATCH'))
      assert.ok(blockersOf(makeWorld({ exportHash: '0000000000000000' })).includes('GRAPH_EXPORT_HASH_MISMATCH'))
      assert.ok(blockersOf(makeWorld({ control: (c) => { c.graphVersion = OLD_GV } })).includes('GRAPH_CONTROL_VERSION_MISMATCH'))
    }],
    ['S03 연구 intent hash 불일치 · 본문만 변조 · schema · 중복 → 거부 / 같으면 참고만(entry 불변)', () => {
      const w = makeWorld({ researchManifest: (m) => { m.contentHash.intents = 'different' } })
      assert.equal(prepare(w, { researchDir: w.research }).code, 'RESEARCH_INTENTS_BODY_MISMATCH')
      const tampered = makeWorld({ researchIntents: RESEARCH_INTENTS.replace('생활 조정', '바뀐 범위') })
      assert.equal(prepare(tampered, { researchDir: tampered.research }).code, 'RESEARCH_INTENTS_BODY_MISMATCH')
      const badSchema = RESEARCH_INTENTS.replace('intent/2', 'intent/9')
      const ws = makeWorld({ researchIntents: badSchema, researchManifest: (m) => { m.contentHash.intents = h16(badSchema) }, graph: (g) => { g.contentHash.intents = h16(badSchema) } })
      assert.equal(prepare(ws, { researchDir: ws.research }).code, 'RESEARCH_INTENT_SCHEMA')
      const dup = RESEARCH_INTENTS + RESEARCH_INTENTS
      const wd = makeWorld({ researchIntents: dup, researchManifest: (m) => { m.contentHash.intents = h16(dup) }, graph: (g) => { g.contentHash.intents = h16(dup) } })
      assert.equal(prepare(wd, { researchDir: wd.research }).code, 'RESEARCH_INTENT_DUPLICATE')
      const wp = makeWorld({ graph: (g) => { g.contentHash.intents = 'product-different' } })
      assert.equal(prepare(wp, { researchDir: wp.research }).code, 'RESEARCH_INTENT_HASH_MISMATCH')
      const w2 = makeWorld(); const a = prepare(w2); const b = prepare(w2, { researchDir: w2.research })
      assert.equal(b.candidate.research.used, true); assert.equal(b.candidate.research.relationsUsable, false)
      assert.deepEqual(b.candidate.entry, a.candidate.entry, '연구 참고가 entry 를 채웠다')
    }],
    ['A01 receipt 없음 → RECEIPT_ABSENT · 같은 slug receipt 두 개 → RECEIPT_DUPLICATE · receipt 변조 → RECEIPT_INVALID', () => {
      assert.equal(rejected(makeWorld({ noReceipt: true })).code, 'RECEIPT_ABSENT')
      const dup = rejected(makeWorld({ extraReceipts: (adm) => [receiptFor([adm], { at: '2026-10-13T14:00:01+09:00' })] }))
      assert.equal(dup.code, 'RECEIPT_DUPLICATE', dup.problems.join(','))
      for (const [label, m] of [['receiptHash', (r) => { r.receiptHash = 'x' }], ['승인 위조', (r) => { r.approval.approvedBy = '대리인' }],
        ['기계 승인 receipt', (r) => { r.approval.approvedBy = 'codex'; r.receiptHash = g8.receiptHashOf(r) }],
        ['manifest 변조', (r) => { r.manifest.at = '2026-10-13T14:00:01+09:00'; r.receiptHash = g8.receiptHashOf(r) }]]) {
        assert.equal(rejected(makeWorld({ receipt: m })).code, 'RECEIPT_INVALID', label)
      }
      assert.equal(rejected(makeWorld({ receiptName: 'not-the-hash' })).code, 'RECEIPT_INVALID', '파일명 ≠ manifestHash')
    }],
    ['A02 slug binding 불일치 — 다른 slug · 다른 intent 가 같은 slug · binding 없음 → SLUG_BINDING_MISMATCH', () => {
      for (const [label, m] of [['다른 slug', (s) => { s[INTENT] = 'other-slug' }], ['같은 slug 두 주인', (s) => { s['I-OTHER'] = SLUG }],
        ['binding 없음', (s) => { delete s[INTENT] }]]) {
        const r = rejected(makeWorld({ slugs: m }))
        assert.equal(r.code, 'SLUG_BINDING_MISMATCH', `${label}: ${r.code} ${r.problems}`)
      }
    }],
    ['A03 ledger 불일치 — 사건 없음 · 중복 · 관계 1글자 · discovery · schema · at 없음 · 교차 신원 → LEDGER_MISMATCH', () => {
      for (const [label, m] of [
        ['사건 없음', (l) => { l.length = 0 }],
        ['중복', (l) => { l.push({ ...l[0] }) }],
        ['관계 1글자', (l) => { l[0].directRelations[1].readerReason += '.' }],
        ['discovery 없음', (l) => { l[0].discoveryRelation = null }],
        ['schema', (l) => { l[0].schemaVersion = 'm3ledger/9' }],
        ['at 없음', (l) => { delete l[0].at }],
        ['교차 신원', (l) => { l.push({ ...l[0], slug: 'other-slug' }) }],
      ]) {
        const r = rejected(makeWorld({ ledger: m }))
        assert.equal(r.code, 'LEDGER_MISMATCH', `${label}: ${r.code} ${r.problems}`)
      }
    }],
    ['A04 G8 전체 판정 — receipt 도 KNOWN_LEGACY 도 아닌 ADMITTED 행 → G8_INCONSISTENT', () => {
      const r = rejected(makeWorld({ ledger: (l) => { l.push({ ...l[0], intentId: 'I-STRAY', slug: 'stray-slug' }) }, slugs: (s) => { s['I-STRAY'] = 'stray-slug' } }))
      assert.equal(r.code, 'G8_INCONSISTENT', `${r.code} ${r.problems}`)
      assert.ok(r.verifyProblems.some((p) => p.startsWith('UNKNOWN_ADMISSION')), r.verifyProblems.join(' | '))
    }],
    ['A05 진행 중 admission — journal 잔존 → ADMISSION_IN_PROGRESS · lock 잔존 → ADMISSION_LOCKED · 둘 다 지우지 않는다', () => {
      const wj = makeWorld({ journal: true })
      assert.equal(rejected(wj).code, 'ADMISSION_IN_PROGRESS')
      assert.ok(existsSync(join(wj.admission, 'contract/.g8-admission.journal.json')), 'journal 을 지웠다')
      const wl = makeWorld({ lock: true })
      assert.equal(rejected(wl).code, 'ADMISSION_LOCKED')
      assert.ok(existsSync(join(wl.admission, 'contract/.g8-admission.lock')), 'lock 을 지웠다')
    }],
    ['A06 graph drift — receipt edge 근거 변경 · edge 삭제 · 대상 mapping 변경 · receipt 판 ≠ current · cluster 변경 → 각자 거부', () => {
      const reason = rejected(makeWorld({ graph: (g) => { g.edges[1].reason = '제품에서 바뀐 이유' } }))
      assert.ok(reason.problems.includes('RECEIPT_EDGE_DRIFT'), reason.problems.join(','))
      const gone = rejected(makeWorld({ graph: (g) => { g.edges = g.edges.filter((e) => e.id !== 'E-2') } }))
      assert.ok(gone.problems.includes('RECEIPT_EDGE_DRIFT'), gone.problems.join(','))
      const mapping = rejected(makeWorld({ graph: (g) => { g.mappings[0].slug = 'rel-a-renamed' } }))
      assert.equal(mapping.code, 'RECEIPT_EDGE_DRIFT', mapping.problems.join(','))
      const stale = rejected(makeWorld({ receiptGraphVersion: OLD_GV }))
      assert.equal(stale.code, 'ADMISSION_GRAPH_STALE', `${stale.code} ${stale.problems}`)
      const cluster = rejected(makeWorld({ graph: (g) => { g.intents[0].cluster = 'family' } }))
      assert.equal(cluster.code, 'ADMISSION_CLUSTER_DRIFT', `${cluster.code} ${cluster.problems}`)
    }],
    ['A07 이미 계획됨 — 큐 행(slug · intent) · 승인 entry · 등록 글 → ALREADY_QUEUED · ALREADY_PLANNED · SLUG_ALREADY_REGISTERED', () => {
      assert.equal(rejected(makeWorld({ queue: (q) => { q.push({ ...LEGACY_ROW(), day: 50, slug: SLUG }) } })).code, 'ALREADY_QUEUED')
      assert.equal(rejected(makeWorld({ queue: (q) => { q.push({ ...LEGACY_ROW(), day: 51, slug: 'other', intentId: INTENT }) } })).code, 'ALREADY_QUEUED')
      const w = makeWorld(); approved(w)
      assert.equal(rejected(w).code, 'ALREADY_PLANNED')
      assert.equal(rejected(makeWorld({ articles: (a) => { a[SLUG] = { title: 't', description: 'd', cluster: 'sleep', publishedAt: '2026-10-01' } } })).code, 'SLUG_ALREADY_REGISTERED')
    }],
    // ── 관계 ───────────────────────────────────────────────
    ['S08 receipt 관계 부족(direct 1 · discovery 0) → 후보 blocker · 승인 거부 (숫자를 맞추려 만들지 않는다)', () => {
      const w = makeWorld({ admission: (a) => { a.direct = a.direct.slice(0, 1) } })
      const r = prepare(w)
      assert.equal(r.ok, true, r.why); assert.ok(r.candidate.blockers.includes('RELATIONS_DIRECT_COUNT_INVALID'), r.candidate.blockers.join(','))
      assert.equal(approve(w, fill(r.candidate)).code, 'CANDIDATE_BLOCKED')
      assert.ok(blockersOf(makeWorld({ admission: (a) => { a.discovery = null } })).includes('RELATIONS_DISCOVERY_NOT_1'))
    }],
    ['S08b 관계 수량 경계 — 2+1 · 3+1 통과 · direct 1·4 · discovery 0·2 거부 · direct 2 에서도 중복·self·미공개·근거 불일치 · HUB 거부', () => {
      const w = makeWorld()
      const st = lib.readCurrentState({ repoRoot: w.repo, admissionRoot: w.admission, slug: SLUG })
      assert.equal(st.ok, true, st.why)
      const judge = (relations, s = st, at = AT) => lib.judgeRelations({ relations, state: s, intentId: INTENT, slug: SLUG, atMs: Date.parse(at) })
      const R = st.relations
      assert.equal(judge(R).ok, true, 'direct 3 + discovery 1')
      assert.equal(judge({ direct: R.direct.slice(0, 2), discovery: R.discovery }).ok, true, 'direct 2 + discovery 1')
      assert.ok(judge({ direct: R.direct.slice(0, 1), discovery: R.discovery }).problems.includes('RELATIONS_DIRECT_COUNT_INVALID'), 'direct 1')
      assert.ok(judge({ direct: [...R.direct, { ...R.direct[0], slug: 'rel-x' }], discovery: R.discovery }).problems.includes('RELATIONS_DIRECT_COUNT_INVALID'), 'direct 4')
      assert.ok(judge({ direct: R.direct, discovery: null }).problems.includes('RELATIONS_DISCOVERY_NOT_1'), 'discovery 0')
      assert.ok(judge({ direct: R.direct, discovery: [R.discovery, R.discovery] }).problems.includes('RELATIONS_DISCOVERY_NOT_1'), 'discovery 2')
      const two = R.direct.slice(0, 2)
      assert.ok(judge({ direct: [two[0], two[0]], discovery: R.discovery }).problems.includes('RELATION_DUPLICATE'), '2개 중복')
      assert.ok(judge({ direct: [two[0], { ...two[1], slug: SLUG }], discovery: R.discovery }).problems.includes('RELATION_SELF'), '2개 self')
      assert.ok(judge({ direct: [two[0], { ...two[1], reason: '근거에 없는 이유' }], discovery: R.discovery }).problems.includes('RELATION_NOT_IN_PRODUCT_GRAPH'), '2개 근거 불일치')
      assert.ok(judge({ direct: two, discovery: { ...R.discovery, source: 'HUB' } }).problems.includes('RELATION_HUB_UNPROVABLE'), 'HUB')
      const wf = makeWorld({ articles: (a) => { a['rel-b'].publishAt = '2026-10-20T10:30:00+09:00' } })
      const stf = lib.readCurrentState({ repoRoot: wf.repo, admissionRoot: wf.admission, slug: SLUG })
      assert.ok(judge({ direct: two, discovery: R.discovery }, stf).problems.includes('RELATION_TARGET_NOT_YET_PUBLIC'), '2개 미공개')
      // 실제 승인 — receipt 의 direct 가 2개인 세계에서 그대로 승인된다
      const w2 = makeWorld({ admission: (a) => { a.direct = a.direct.slice(0, 2) } })
      const a2 = approve(w2, ready(w2)); assert.equal(a2.ok, true, JSON.stringify(a2).slice(0, 240))
    }],
    ['S08c receipt direct 4개 → 자동으로 3개를 자르지 않는다 · 후보 blocker · 승인 거부', () => {
      const w = makeWorld({
        receiptGraph: (g) => { g.edges.splice(3, 0, { id: 'E-5', from: INTENT, to: 'I-R5', type: 'NEXT_QUESTION', slot: 'DIRECT_NEXT', anchor: 'a-rel-e', reason: '또 다른 다음 질문이다', placement: 'FOOTER_NEXT', priority: 5, fromCluster: 'sleep', toCluster: 'sleep', active: false })
          g.mappings.push({ intent: 'I-R5', slug: 'rel-e', cluster: 'sleep' }); g.intents.push({ id: 'I-R5', cluster: 'sleep', board: 'menopause' }) },
        articles: (a) => { a['rel-e'] = { title: 'rel-e', description: 'd', cluster: 'sleep', publishedAt: '2026-10-01' } },
      })
      const r = prepare(w)
      assert.equal(r.ok, true, `${r.code} ${r.why}`)
      assert.equal(r.candidate.entry.relations.direct.length, 4, '후보가 receipt 관계를 잘랐다')
      assert.ok(r.candidate.blockers.includes('RELATIONS_DIRECT_COUNT_INVALID'))
      assert.equal(approve(w, fill(r.candidate)).code, 'CANDIDATE_BLOCKED')
    }],
    ['S09 관계를 사람이 바꾸면 거부 — 중복·자기 자신·근거 변경·HUB·순서 → CANDIDATE_IDENTITY_EDITED', () => {
      const w = makeWorld()
      for (const [label, edit] of [
        ['중복', (c) => { c.entry.relations.direct[2] = { ...c.entry.relations.direct[0] } }],
        ['self', (c) => { c.entry.relations.direct[0] = { ...c.entry.relations.direct[0], slug: SLUG } }],
        ['근거', (c) => { c.entry.relations.direct[1].reason = '사람이 지어낸 이유' }],
        ['HUB', (c) => { c.entry.relations.discovery = { ...c.entry.relations.discovery, source: 'HUB' } }],
        ['순서', (c) => { c.entry.relations.direct.reverse() }],
      ]) {
        const a = approve(w, ready(w, { edit }))
        assert.equal(a.code, 'CANDIDATE_IDENTITY_EDITED', `${label}: ${a.code}`); assert.ok(a.problems.includes('relations'), label)
      }
    }],
    ['S10 미등록 관계 글 → 후보 blocker(조용히 빼지 않는다) · 승인 거부', () => {
      const w = makeWorld({ articles: (a) => { delete a['rel-b'] } })
      const r = prepare(w)
      assert.equal(r.candidate.relationEvidence.find((e) => e.slug === 'rel-b').target, 'UNREGISTERED')
      assert.deepEqual(r.candidate.entry.relations.direct.map((x) => x.slug), ['rel-a', 'rel-b', 'rel-c'], 'receipt 관계를 빼서 맞췄다')
      assert.ok(r.candidate.blockers.includes('RELATION_TARGET_UNREGISTERED'))
      assert.equal(approve(w, fill(r.candidate)).code, 'CANDIDATE_BLOCKED')
    }],
    ['S11 asOf 이후 공개되는 관계 글 → RELATION_TARGET_NOT_YET_PUBLIC', () => {
      const w = makeWorld({ articles: (a) => { a['rel-c'].publishAt = '2026-10-14T09:30:00+09:00' } })
      const r = prepare(w)
      assert.equal(r.candidate.relationEvidence.find((e) => e.slug === 'rel-c').target, 'FUTURE')
      assert.ok(r.candidate.blockers.includes('RELATION_TARGET_NOT_YET_PUBLIC'))
      const w2 = makeWorld({ articles: (a) => { a['rel-c'].publishAt = '2026-10-14T08:00:00+09:00' } })
      const c = ready(w2)
      assert.equal(approve(w2, c, { at: '2026-10-14T07:59:59+09:00' }).code, 'APPROVED_AT_BEFORE_CANDIDATE')
      const st = lib.readCurrentState({ repoRoot: w2.repo, admissionRoot: w2.admission, slug: SLUG })
      assert.ok(lib.judgeRelations({ relations: c.entry.relations, state: st, intentId: INTENT, slug: SLUG, atMs: Date.parse('2026-10-14T07:59:59+09:00') }).problems.includes('RELATION_TARGET_NOT_YET_PUBLIC'))
    }],
    ['T1 시각 fail-closed — 실제 KST · asOf≤now · at≤now · at≥asOf · 미래 시각으로 미래 공개 관계 승인 거부', () => {
      const w = makeWorld()
      assert.equal(prepare(w, { asOf: '2026-02-30T09:00:00+09:00' }).code, 'AS_OF_INVALID')
      assert.equal(prepare(w, { asOf: '2026-10-14T09:00:00Z' }).code, 'AS_OF_INVALID')
      assert.equal(prepare(w, { asOf: '2026-10-14T12:00:01+09:00' }).code, 'AS_OF_FUTURE')
      const c = ready(w)
      assert.equal(approve(w, c, { at: '2026-02-30T10:00:00+09:00' }).code, 'APPROVED_AT_INVALID')
      assert.equal(approve(w, c, { at: '2026-10-14T08:59:59+09:00' }).code, 'APPROVED_AT_BEFORE_CANDIDATE')
      const wf = makeWorld({ articles: (a) => { a['rel-c'].publishAt = '2026-10-20T10:30:00+09:00' } })
      const pf = prepare(wf, { asOf: '2026-10-21T09:00:00+09:00', nowMs: Date.parse('2026-10-22T00:00:00+09:00') })
      assert.equal(pf.ok, true, pf.why)
      const af = approve(wf, fill(pf.candidate), { at: '2026-10-21T10:00:00+09:00' })
      assert.equal(af.code, 'APPROVED_AT_FUTURE')
      assert.equal(existsSync(sourceFile(wf.repo)), false)
    }],
    ['C1 M-GRAPH control — graph off · kill switch · cluster off → blocker', () => {
      assert.ok(blockersOf(makeWorld({ control: (c) => { c.enabled = false } })).includes('GRAPH_CONTROL_DISABLED'))
      assert.ok(blockersOf(makeWorld({ control: (c) => { c.killSwitch.tripped = true } })).includes('GRAPH_KILL_SWITCH_TRIPPED'))
      assert.ok(blockersOf(makeWorld({ control: (c) => { c.enabledClusters = ['family'] } })).includes('GRAPH_CLUSTER_DISABLED'))
    }],
    ['C2 surface · type — 꺼진 surface · BODY_CALLOUT · 미구현 surface · discovery type 오류 → blocker (receipt 관계를 빼지 않는다)', () => {
      const callout = prepare(makeWorld({ graph: (g) => { g.edges[2].placement = 'BODY_CALLOUT' } }))
      assert.equal(callout.candidate.relationEvidence.find((e) => e.edgeId === 'E-3').surfaceOk, false)
      assert.ok(callout.candidate.blockers.includes('RELATION_SURFACE_DISABLED')); assert.equal(callout.candidate.entry.relations.direct.length, 3)
      assert.ok(blockersOf(makeWorld({ control: (c) => { c.surfaces.FOOTER_SIBLING = false } })).includes('RELATION_SURFACE_DISABLED'))
      const notImpl = makeWorld({ resolver: (t) => t.replace("  'FOOTER_BRIDGE',\n] as const\n\n/** 하단", "] as const\n\n/** 하단") })
      assert.ok(blockersOf(notImpl).includes('RELATION_SURFACE_DISABLED'))
      assert.ok(blockersOf(makeWorld({ graph: (g) => { g.edges[3].type = 'SIBLING' } })).includes('RELATION_TYPE_INVALID'))
    }],
    ['C3 active=false 만으로는 거부하지 않는다 — preactivation 근거 기록 · active=true 도 같은 조건', () => {
      const r = prepare(makeWorld({ graph: (g) => { g.edges[0].active = true } }))
      assert.deepEqual(r.candidate.blockers, [])
      const ev = Object.fromEntries(r.candidate.relationEvidence.map((e) => [e.edgeId, e.activation]))
      assert.equal(ev['E-1'], 'ACTIVE'); assert.equal(ev['E-2'], 'PREACTIVATION')
    }],
    // ── B·C. plan · 승인 ─────────────────────────────────────
    ['S13 미해결 필드 → plan 먼저 PLAN_INVALID · node 문장 → CANDIDATE_UNRESOLVED · hero', () => {
      const w = makeWorld()
      const raw = approve(w, prepare(w).candidate)
      assert.equal(raw.code, 'PLAN_INVALID'); assert.ok(raw.problems.includes('PLAN_REQUIRED_MISSING:title'))
      const noNode = approve(w, ready(w, { edit: (c) => { c.entry.node.readerQuestion = null } }))
      assert.equal(noNode.code, 'CANDIDATE_UNRESOLVED'); assert.ok(noNode.problems.includes('node.readerQuestion'))
      const noScene = approve(w, ready(w, { edit: (c) => { c.entry.hero.scene = null } }))
      assert.ok(noScene.problems.includes('hero.scene'))
    }],
    ...REAL.source.ARTICLE_PLAN_REQUIRED.map((k) => [`P01 plan 필수 ${k} null·빈 값 → PLAN_INVALID PLAN_REQUIRED_MISSING:${k}`, () => {
      const w = makeWorld()
      for (const v of [null, '']) {
        if (v === '' && !['title', 'target', 'whyNow', 'notes'].includes(k)) continue
        const a = approve(w, ready(w, { plan: { [k]: v } }))
        assert.equal(a.code, 'PLAN_INVALID', `${k}=${JSON.stringify(v)}: ${a.code}`); assert.ok(a.problems.includes(`PLAN_REQUIRED_MISSING:${k}`), a.problems.join(','))
      }
      assert.equal(existsSync(sourceFile(w.repo)), false)
    }]),
    ...['contentType', 'intent', 'riskLevel', 'validationProfile', 'reviewMode', 'ctaBoard', 'imageMode'].map((k) => [`P02 plan ${k} union 밖 값 → PLAN_VALUE_NOT_IN_UNION:${k} (임의 문자열 완화 금지)`, () => {
      const w = makeWorld()
      let tried = 0
      for (const v of ['UNKNOWN', `${fx().queueItem[k]} `, String(fx().queueItem[k]).toLowerCase()]) {
        if (v === fx().queueItem[k]) continue
        tried++
        const a = approve(w, ready(w, { plan: { [k]: v } }))
        assert.equal(a.code, 'PLAN_INVALID', `${k}=${v}: ${a.code}`); assert.ok(a.problems.includes(`PLAN_VALUE_NOT_IN_UNION:${k}`), a.problems.join(','))
      }
      assert.ok(tried >= 2, `${k}: 반례 값이 모자란다`)
    }]),
    ['P03 plan 선택 필드 — season union · publishWindow 형식 · series 짝 · 모르는 키 → 거부 / 정상 선택 필드는 승인 entry 에 실린다', () => {
      const w = makeWorld()
      const bad = (plan, code) => { const a = approve(w, ready(w, { plan })); assert.equal(a.code, 'PLAN_INVALID', JSON.stringify(plan)); assert.ok(a.problems.includes(code), `${JSON.stringify(plan)}: ${a.problems}`) }
      bad({ season: '장마' }, 'PLAN_VALUE_NOT_IN_UNION:season')
      bad({ publishWindow: { after: '2026-12-01', before: '2026-11-01' } }, 'PLAN_VALUE_INVALID:publishWindow')
      bad({ publishWindow: { after: '2026/11/01', before: '2026-12-01' } }, 'PLAN_VALUE_INVALID:publishWindow')
      bad({ seriesId: 'sleep-series' }, 'PLAN_SERIES_INCOMPLETE')
      bad({ seriesId: 'sleep-series', seriesOrder: 0 }, 'PLAN_VALUE_INVALID:seriesOrder')
      bad({ calendarEvent: '  ' }, 'PLAN_VALUE_INVALID:calendarEvent')
      bad({ hubSlug: 'x' }, 'PLAN_UNKNOWN_FIELD:hubSlug')
      const ok = approve(w, ready(w, { plan: { season: '가을', publishWindow: { after: '2026-10-01', before: '2026-12-31' }, calendarEvent: '추석', seriesId: null } }))
      assert.equal(ok.ok, true, `${ok.code} ${ok.why}`)
      assert.deepEqual(Object.keys(ok.entry.plan).sort(), [...REAL.source.ARTICLE_PLAN_REQUIRED, 'season', 'publishWindow', 'calendarEvent'].sort(), 'null 선택 키가 실렸다')
    }],
    ['P04 plan 제목 계약 — 한 단어 제목 → PLAN_TITLE_INVALID', () => {
      const w = makeWorld()
      const a = approve(w, ready(w, { plan: { title: '수면' } }))
      assert.equal(a.code, 'PLAN_INVALID'); assert.ok(a.problems.some((p) => p.startsWith('PLAN_TITLE_INVALID')), a.problems.join(','))
    }],
    ['S07 plan validationProfile STANDARD 아님 → 실제 관문 거부(GATE_REJECTED · PROFILE_NOT_STANDARD) · 쓰기 0', () => {
      const w = makeWorld(); const a = approve(w, ready(w, { plan: { validationProfile: 'MEDICAL' } }))
      assert.equal(a.code, 'GATE_REJECTED'); assert.ok(a.problems.includes('PROFILE_NOT_STANDARD')); assert.equal(existsSync(sourceFile(w.repo)), false)
    }],
    ['H1 hero — OPTIONAL 도 alt·scene 승인 전 필수 · NO_IMAGE 는 hero 내용 금지', () => {
      const w = makeWorld()
      const opt = approve(w, ready(w, { plan: { imageMode: 'OPTIONAL' }, edit: (c) => { c.entry.hero = { alt: null, scene: null } } }))
      assert.equal(opt.code, 'CANDIDATE_UNRESOLVED'); assert.ok(opt.problems.includes('hero.alt') && opt.problems.includes('hero.scene'))
      const noImg = approve(w, ready(w, { plan: { imageMode: 'NO_IMAGE' }, edit: (c) => { c.entry.hero = fx().hero } }))
      assert.equal(noImg.code, 'GATE_REJECTED'); assert.ok(noImg.problems.includes('HERO_FORBIDDEN'))
      assert.equal(existsSync(sourceFile(w.repo)), false)
      const okNo = approve(w, ready(w, { plan: { imageMode: 'NO_IMAGE' } })); assert.equal(okNo.ok, true, okNo.why); assert.equal(okNo.entry.hero, null)
    }],
    ['S14 빈 승인자 · 기계 승인자 → 거부', () => {
      const w = makeWorld(); const c = ready(w)
      assert.equal(approve(w, c, { approver: '  ' }).code, 'APPROVER_REQUIRED')
      for (const m of ['machine:codex', 'codex', 'Claude Code', 'bot-1', 'ci', 'system:auto', 'agent']) assert.equal(approve(w, c, { approver: m }).code, 'APPROVER_MACHINE', m)
      assert.equal(approve(w, c, { at: '2026-10-14 10:00' }).code, 'APPROVED_AT_INVALID')
      assert.equal(existsSync(sourceFile(w.repo)), false)
    }],
    ['S15 후보 해시 불일치 → CANDIDATE_HASH_MISMATCH', () => {
      const w = makeWorld(); const c = ready(w)
      assert.equal(approve(w, c, { confirmCandidateHash: c.candidateHash }).code, 'CANDIDATE_HASH_MISMATCH')
    }],
    ['S16 prepare 뒤 graph·control·articles·G8 사건 변경 → STATE_CHANGED · 무관한 큐 변경은 승인을 막지 않는다', () => {
      for (const [label, mut] of [
        ['articles', (w) => { const p = join(w.repo, 'src/content/magazine/articles.ts'); writeFileSync(p, readFileSync(p, 'utf8').replace('"title": "rel-a"', '"title": "rel-a 개정"')) }],
        ['graph', (w) => { const n = makeWorld({ graph: (g) => { g.contentHash.edges = 'e-new' } }); for (const f of ['current.ts', `${GV}.ts`]) writeFileSync(join(w.repo, 'src/content/magazine/graph', f), readFileSync(join(n.repo, 'src/content/magazine/graph', f))) }],
        ['control', (w) => { const p = join(w.repo, 'src/content/magazine/graph/control.ts'); const t = readFileSync(p, 'utf8'); const n = t.replace("['sleep','family']", "['sleep','family','daily']"); assert.notEqual(n, t, 'control 반례 준비 실패'); writeFileSync(p, n) }],
        ['G8 사건', (w) => { const p = join(w.admission, 'contract/m3-state.jsonl'); writeFileSync(p, readFileSync(p, 'utf8').replace('15:00:00', '15:00:01')) }],
      ]) {
        const w = makeWorld(); const c = ready(w)
        mut(w)
        const a = approve(w, c)
        assert.equal(a.code, 'STATE_CHANGED', `${label}: ${a.code} ${a.why}`)
      }
      const wq = makeWorld(); const cq = ready(wq)
      writeFileSync(queueFile(wq.repo), queueFileText([LEGACY_ROW(), { ...LEGACY_ROW(), day: 23, slug: 'dssa-legacy-2' }]))
      const aq = approve(wq, cq); assert.equal(aq.ok, true, `무관한 큐 변경이 승인을 막았다: ${aq.code} ${aq.why}`)
    }],
    ['S16b 승인 직전 admission 재대조 — prepare 뒤 binding · ledger · journal · receipt · mapping 이 바뀌면 그 사유로 거부 · 쓰기 0', () => {
      for (const [label, mut, code] of [
        ['binding', (w) => writeFileSync(join(w.admission, 'contract/m3-slug-manifest.json'), JSON.stringify({ slugs: { [INTENT]: 'other' } })), 'SLUG_BINDING_MISMATCH'],
        ['ledger', (w) => writeFileSync(join(w.admission, 'contract/m3-state.jsonl'), ''), 'LEDGER_MISMATCH'],
        ['journal', (w) => writeFileSync(join(w.admission, 'contract/.g8-admission.journal.json'), '{}'), 'ADMISSION_IN_PROGRESS'],
        ['receipt 삭제', (w) => rmSync(join(w.admission, 'contract/g8-admission'), { recursive: true }), 'RECEIPT_ABSENT'],
        ['mapping', (w) => { const n = makeWorld({ graph: (g) => { g.mappings[0].slug = 'rel-a-renamed' } }); writeFileSync(join(w.repo, 'src/content/magazine/graph', `${GV}.ts`), readFileSync(join(n.repo, 'src/content/magazine/graph', `${GV}.ts`))) }, 'RECEIPT_EDGE_DRIFT'],
      ]) {
        const w = makeWorld(); const c = ready(w); mut(w)
        const a = approve(w, c)
        assert.equal(a.code, code, `${label}: ${a.code} ${a.why}`); assert.equal(existsSync(sourceFile(w.repo)), false, label)
      }
    }],
    ['S17 출력 경로 신원 — runtime · repo 와 다른 루트 · 없는 디렉터리 · symlink 조상 · 대상 폴더 symlink', () => {
      const w = makeWorld(); const c = ready(w)
      const runtime = join(w.base, 'soransoran-magazine-runtime'); mkdirSync(runtime)
      writeFileSync(join(runtime, '.git'), 'gitdir: /dev/null\n')
      assert.equal(approve(w, c, { outRoot: runtime }).code, 'RUNTIME_OUTPUT_FORBIDDEN')
      const other = join(w.base, 'other'); mkdirSync(other)
      assert.equal(approve(w, c, { outRoot: other }).code, 'OUT_ROOT_NOT_REPO')
      assert.equal(approve(w, c, { outRoot: join(w.base, 'missing') }).code, 'OUT_ROOT_NOT_DIRECTORY')
      assert.equal(approve(w, c, { outRoot: null }).code, 'OUT_ROOT_REQUIRED')
      const link = join(w.base, 'link-to-runtime'); symlinkSync(runtime, link)
      assert.equal(approve(w, c, { outRoot: link }).code, 'OUT_ROOT_SYMLINK')
      assert.equal(approve(w, c, { outRoot: join(link, 'new-subdir') }).code, 'OUT_ROOT_NOT_DIRECTORY')
      const repoLink = join(w.base, 'repo-link'); symlinkSync(w.repo, repoLink)
      assert.equal(approve(w, c, { outRoot: repoLink }).code, 'OUT_ROOT_SYMLINK')
      symlinkSync(runtime, join(w.repo, 'drafts/magazine/article-spec-source'))
      assert.equal(approve(w, c).code, 'OUT_PATH_SYMLINK')
      assert.deepEqual(readdirSync(runtime), ['.git'], 'runtime 에 무언가 쓰였다')
      const nogit = makeWorld(); rmSync(join(nogit.repo, '.git'))
      assert.equal(approve(nogit, ready(nogit)).code, 'OUT_ROOT_NOT_WORKTREE')
    }],
    ['S18 기존 다른 entry 보존 · S19 같은 승인 다시 → ALREADY_PLANNED · 바이트 불변', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      const other = { status: 'APPROVED', approvedBy: '창업자', approvedAt: '2026-10-13T10:00:00+09:00', admission: { g8ManifestHash: 'o' },
        node: { slug: 'aaa-other', intentId: 'I-OTHER', graphVersion: GV }, relations: {}, hero: null, publication: {}, sourceHash: 'sha256:x' }
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, `${JSON.stringify({ schema: REAL.source.DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: GV, entries: [other] }, null, 2)}\n`)
      const a1 = approve(w, c); assert.equal(a1.ok, true, a1.why); assert.equal(a1.written, true)
      const doc = JSON.parse(readFileSync(f, 'utf8'))
      assert.deepEqual(doc.entries.map((x) => x.node.slug), ['aaa-other', SLUG]); assert.deepEqual(doc.entries[0], other)
      const bytes = readFileSync(f, 'utf8')
      const a2 = approve(w, c); assert.equal(a2.code, 'ALREADY_PLANNED'); assert.equal(readFileSync(f, 'utf8'), bytes)
      const a3 = approve(w, c, { approver: '다른 사람' }); assert.equal(a3.code, 'ALREADY_PLANNED'); assert.equal(readFileSync(f, 'utf8'), bytes)
      COUNTS.replan = { first: a1.written, second: a2.code }
    }],
    ['S19b 경쟁 — 판독 뒤 lock 전에 다른 승인이 같은 slug entry 를 쓰면 lock 안에서 ALREADY_PLANNED · 외부 바이트 보존', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      const racer = `${JSON.stringify({ schema: REAL.source.DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: GV, entries: [{ node: { slug: SLUG, intentId: INTENT } }] }, null, 2)}\n`
      const a = approve(w, c, { hooks: { beforeLock: () => writeFileSync(f, racer) } })
      assert.equal(a.code, 'ALREADY_PLANNED', `${a.code} ${a.why}`); assert.equal(readFileSync(f, 'utf8'), racer, '경쟁 승인을 덮었다')
    }],
    ['S18e 기존 source/1 artifact → ARTIFACT_IDENTITY · 덮어쓰지 않는다', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      mkdirSync(dirname(f), { recursive: true })
      const v1 = `${JSON.stringify({ schema: 'magazine-article-spec-source/1', graphVersion: GV, entries: [] }, null, 2)}\n`
      writeFileSync(f, v1)
      assert.equal(approve(w, c).code, 'ARTIFACT_IDENTITY'); assert.equal(readFileSync(f, 'utf8'), v1)
    }],
    ['W1 CAS — 읽은 뒤 외부 writer 가 바꾸거나 새로 만들면 멈추고 외부 바이트를 그대로 둔다', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, `${JSON.stringify({ schema: REAL.source.DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: GV, entries: [] }, null, 2)}\n`)
      const external = `${JSON.stringify({ schema: REAL.source.DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: GV, entries: [{ node: { slug: 'zzz-external', intentId: 'I-EXT' } }] }, null, 2)}\n`
      const a = approve(w, c, { hooks: { beforeRename: () => writeFileSync(f, external) } })
      assert.equal(a.code, 'ARTIFACT_CHANGED_DURING_WRITE'); assert.equal(readFileSync(f, 'utf8'), external, '외부 writer 바이트를 덮었다')
      const w2 = makeWorld(); const c2 = ready(w2); const f2 = sourceFile(w2.repo)
      const b = approve(w2, c2, { hooks: { beforeRename: () => writeFileSync(f2, external) } })
      assert.equal(b.code, 'ARTIFACT_CHANGED_DURING_WRITE'); assert.equal(readFileSync(f2, 'utf8'), external)
      assert.deepEqual(readdirSync(dirname(f2)).filter((x) => x.includes('.tmp-')), [])
      COUNTS.cas = { changed: a.code, created: b.code }
    }],
    ['S18b 승인 entry — source/3 · admission · plan · productBasis · sourceHash · 그 복제 큐 행은 실제 관문 통과', () => {
      const w = makeWorld(); const a = approved(w)
      const doc = JSON.parse(readFileSync(sourceFile(w.repo), 'utf8'))
      assert.equal(doc.schema, 'magazine-article-spec-source/3')
      assert.deepEqual(doc.entries[0].node.forbiddenPatterns, TOPIC_PATTERNS)
      const e = doc.entries[0]
      assert.deepEqual(Object.keys(e).sort(), ['admission', 'approvedAt', 'approvedBy', 'hero', 'node', 'plan', 'productBasis', 'publication', 'relations', 'sourceHash', 'status'])
      assert.deepEqual(e.admission, { g8ManifestHash: w.receipt.manifestHash, receiptHash: w.receipt.receiptHash, graphVersion: GV, readinessHash: 'dssa-readiness-0001' })
      assert.deepEqual(e.plan, PLAN()); assert.equal(e.sourceHash, source.directSpecSourceHash(e)); assert.equal(a.sourceHash, e.sourceHash)
      assert.deepEqual(e.productBasis, source.productBasisFor(source.readProductGraphState(w.repo), { intentId: INTENT, queueCluster: 'sleep' }))
      const j = judgeRow(w, source.queueRowFromEntry(e, { day: 23 }))
      assert.equal(j.ok, true, j.why)
    }],
    ['S18d 후보에 승인 필드 위조 → CANDIDATE_APPROVAL_FORGED · admission 편집 → CANDIDATE_IDENTITY_EDITED', () => {
      const w = makeWorld()
      assert.equal(approve(w, ready(w, { edit: (c) => { c.entry.approvedBy = '창업자' } })).code, 'CANDIDATE_APPROVAL_FORGED')
      assert.equal(approve(w, ready(w, { edit: (c) => { c.entry.node.status = 'APPROVED' } })).code, 'CANDIDATE_APPROVAL_FORGED')
      assert.equal(approve(w, ready(w, { edit: (c) => { c.entry.productBasis = {} } })).code, 'CANDIDATE_APPROVAL_FORGED')
      const ad = approve(w, ready(w, { edit: (c) => { c.entry.admission.g8ManifestHash = 'forged' } }))
      assert.equal(ad.code, 'CANDIDATE_IDENTITY_EDITED'); assert.ok(ad.problems.includes('admission'))
    }],
    ['S21a 살아 있는 잠금 → LOCK_BUSY · 쓰기 0', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      mkdirSync(dirname(f), { recursive: true }); writeFileSync(`${f}.lock`, JSON.stringify({ pid: process.pid }))
      assert.equal(approve(w, c).code, 'LOCK_BUSY'); assert.equal(existsSync(f), false)
    }],
    ['S21c 읽을 수 없는 최근 잠금(빈 파일) → 회수하지 않고 LOCK_BUSY', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      mkdirSync(dirname(f), { recursive: true }); writeFileSync(`${f}.lock`, '')
      assert.equal(approve(w, c).code, 'LOCK_BUSY'); assert.equal(existsSync(f), false); assert.equal(readFileSync(`${f}.lock`, 'utf8'), '')
    }],
    ['S21e 죽은 PID 가 적힌 기존 잠금 → 회수하지 않고 LOCK_BUSY · 잠금 바이트 보존 · source·큐 쓰기 0', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo); const q0 = readFileSync(queueFile(w.repo), 'utf8')
      mkdirSync(dirname(f), { recursive: true })
      const dead = JSON.stringify({ pid: 2147483646, token: 'dead-holder' }); writeFileSync(`${f}.lock`, dead)
      const a = approve(w, c)
      assert.equal(a.code, 'LOCK_BUSY', `${a.code} ${a.why}`); assert.equal(readFileSync(`${f}.lock`, 'utf8'), dead, '죽은 주인의 잠금을 지웠다')
      assert.equal(existsSync(f), false); assert.equal(readFileSync(queueFile(w.repo), 'utf8'), q0)
    }],
    ['S21f 기존 잠금을 본 직후 새 holder 로 바뀐 경쟁 → 새 holder 잠금 그대로 · LOCK_BUSY · source·큐 쓰기 0', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo); const q0 = readFileSync(queueFile(w.repo), 'utf8')
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(`${f}.lock`, JSON.stringify({ pid: 2147483646, token: 'dead-holder' }))
      const fresh = JSON.stringify({ pid: process.pid, token: 'new-holder' })
      let observed = 0
      const a = approve(w, c, { hooks: { lockObserved: ({ lockPath }) => { observed++; writeFileSync(lockPath, fresh) } } })
      assert.equal(observed, 1, '반례 준비 실패 — 기존 잠금 관측 지점을 지나지 않았다')
      assert.equal(a.code, 'LOCK_BUSY', `${a.code} ${a.why}`); assert.equal(readFileSync(`${f}.lock`, 'utf8'), fresh, '새 holder 의 잠금을 지웠다')
      assert.equal(existsSync(f), false); assert.equal(readFileSync(queueFile(w.repo), 'utf8'), q0)
    }],
    ['S21d 쓰기 직전 잠금 소유권을 잃으면 LOCK_LOST · 쓰기 0', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      let seen = null
      const other = JSON.stringify({ pid: process.pid, token: 'other-writer' })
      const a = approve(w, c, { hooks: { beforeRename: () => { writeFileSync(`${f}.lock`, other); seen = statSync(`${f}.lock`, { bigint: true }) } } })
      assert.equal(a.code, 'LOCK_LOST'); assert.equal(existsSync(f), false)
      assert.equal(readFileSync(`${f}.lock`, 'utf8'), other, '남의 잠금 바이트가 바뀌었다')
      // 🔴 이미 잃은 잠금은 release 가 건드리지 않는다 — 경로 이동(rename·link)이 있었으면 ctime 이 바뀐다
      const after = statSync(`${f}.lock`, { bigint: true })
      assert.deepEqual([after.ino, after.ctimeNs], [seen.ino, seen.ctimeNs], '남의 잠금 경로를 움직였다 (rename·link)')
      assert.deepEqual(readdirSync(dirname(f)).filter((x) => x.includes('.release-')), [], '.release-* 잔존')
    }],
    ['S21g 해제 — 소유를 확인한 직후 다른 holder 로 바뀌면 떼어 낸 잠금을 제자리에 되돌린다 · 남의 잠금 바이트 그대로 · .release-* 0', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      const other = JSON.stringify({ pid: process.pid, token: 'other-after-owns' })
      let raced = 0
      const a = approve(w, c, { hooks: { beforeReleaseRename: ({ lockPath }) => { raced++; writeFileSync(lockPath, other) } } })
      assert.equal(raced, 1, '반례 준비 실패 — 해제 경쟁 지점을 지나지 않았다')
      assert.equal(a.ok, true, `${a.code} ${a.why}`)
      assert.equal(existsSync(`${f}.lock`) ? readFileSync(`${f}.lock`, 'utf8') : null, other, '해제가 남의 잠금을 지웠다')
      assert.deepEqual(readdirSync(dirname(f)).filter((n) => n.includes('.release-')), [], '.release-* 잔존')
    }],
    ['S21b 실제 다중 프로세스 동시 승인 → 쓴 writer 정확히 1 · 나머지는 LOCK_BUSY 또는 ALREADY_PLANNED', async () => {
      const w = makeWorld(); const c = ready(w); const cf = join(w.base, 'candidate.json'); writeFileSync(cf, JSON.stringify(c))
      const hash = lib.candidateHashOf(c)
      const run = () => new Promise((res) => {
        const p = spawn(process.execPath, [cliPath, 'approve', '--candidate', cf, '--approver', '창업자', '--at', AT, '--confirm-candidate-hash', hash,
          '--repo', w.repo, '--admission-root', w.admission, '--out-root', w.repo], { stdio: ['ignore', 'pipe', 'pipe'] })
        let s = ''; p.stdout.on('data', (d) => { s += d })
        p.on('close', (code) => { try { res({ code, r: JSON.parse(s) }) } catch { res({ code, r: null }) } })
      })
      const results = await Promise.all(Array.from({ length: 8 }, run))
      const writers = results.filter((x) => x.r?.written === true).length
      COUNTS.concurrent = { processes: 8, writers, alreadyPlanned: results.filter((x) => x.r?.code === 'ALREADY_PLANNED').length,
        lockBusy: results.filter((x) => x.r?.code === 'LOCK_BUSY').length }
      assert.equal(writers, 1, JSON.stringify(results.map((x) => x.r?.code ?? x.r?.written)))
      assert.ok(results.every((x) => x.r && (x.r.written === true || ['LOCK_BUSY', 'ALREADY_PLANNED'].includes(x.r.code))), JSON.stringify(results.map((x) => x.r)))
      assert.equal(JSON.parse(readFileSync(sourceFile(w.repo), 'utf8')).entries.length, 1)
    }],
    ['S22 쓰기 중 실패·급사 → 기존 artifact 불변 · 남은 잠금은 회수하지 않고 LOCK_BUSY · 사람이 지운 뒤에만 승인', () => {
      const w = makeWorld(); const f = sourceFile(w.repo)
      const keep = `${JSON.stringify({ schema: REAL.source.DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: GV, entries: [] }, null, 2)}\n`
      mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, keep)
      const c = ready(w)
      const a = approve(w, c, { hooks: { beforeRename: () => { throw new Error('주입된 쓰기 실패') } } })
      assert.equal(a.code, 'ARTIFACT_WRITE_FAILED'); assert.equal(readFileSync(f, 'utf8'), keep)
      assert.deepEqual(readdirSync(dirname(f)).filter((x) => x.includes('.tmp-')), [])
      const cf = join(w.base, 'c.json'); writeFileSync(cf, JSON.stringify(c))
      const driver = `const lib = await import(${JSON.stringify(pathToFileURL(LIB_PATH).href)}); const c = JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(cf)}, 'utf8'));
lib.approveCandidate({ candidate: c, approver: '창업자', at: ${JSON.stringify(AT)}, confirmCandidateHash: lib.candidateHashOf(c), repoRoot: ${JSON.stringify(w.repo)}, admissionRoot: ${JSON.stringify(w.admission)}, outRoot: ${JSON.stringify(w.repo)}, nowMs: ${NOW}, hooks: { beforeRename: () => process.exit(9) } })`
      const k = spawnSync(process.execPath, ['--input-type=module', '-e', driver], { encoding: 'utf8' })
      assert.equal(k.status, 9, k.stderr); assert.equal(readFileSync(f, 'utf8'), keep, '급사가 기존 artifact 를 바꿨다')
      assert.ok(existsSync(`${f}.lock`), '급사 반례 준비 실패 — 잠금이 남지 않았다')
      // 🔴 급사가 남긴 잠금은 자동으로 회수하지 않는다 — 바이트 보존 · LOCK_BUSY · 쓰기 0. 사람이 지운 뒤에만 승인된다
      const left = readFileSync(`${f}.lock`, 'utf8')
      const busy = approve(w, c); assert.equal(busy.code, 'LOCK_BUSY'); assert.equal(readFileSync(`${f}.lock`, 'utf8'), left); assert.equal(readFileSync(f, 'utf8'), keep)
      rmSync(`${f}.lock`)
      const after = approve(w, c); assert.equal(after.ok, true, after.why); assert.equal(after.written, true)
    }],
    ['S23 승인 전 source artifact 0 · 큐 쓰기 0 — prepare·거부된 approve 뒤에도 파일 없음', () => {
      const w = makeWorld(); const q = readFileSync(queueFile(w.repo), 'utf8')
      const r = prepare(w, { researchDir: w.research }); approve(w, r.candidate); approve(w, fill(r.candidate), { approver: 'bot' })
      assert.equal(existsSync(sourceFile(w.repo)), false); assert.equal(readFileSync(queueFile(w.repo), 'utf8'), q)
    }],
    // ── D. materialize ────────────────────────────────────────
    ['M01 materialize — 승인 entry 의 복제 행 1개 · slug · DIRECT_SPEC_V1 · intentId · g8ManifestHash · articlePlanHash · day=max+1 · 다시 읽어 같음', () => {
      const w = makeWorld({ queue: (q) => { q.push({ ...LEGACY_ROW(), day: 105, slug: 'dssa-legacy-105' }, { ...LEGACY_ROW(), day: 40, slug: 'dssa-legacy-40' }) } })
      const before = queueOf(w.repo); const sourceBytes = () => readFileSync(sourceFile(w.repo), 'utf8')
      const a = approved(w)
      const s0 = sourceBytes()
      const m = materialize(w); assert.equal(m.ok, true, `${m.code} ${m.why}`)
      const after = queueOf(w.repo)
      const row = after.find((q) => q.slug === SLUG)
      assert.equal(m.day, 106); assert.equal(row.day, 106)
      assert.deepEqual(plain(row), plain(m.row))
      assert.deepEqual({ slug: row.slug, directSpecMode: row.directSpecMode, intentId: row.intentId, g8ManifestHash: row.g8ManifestHash, articlePlanHash: row.articlePlanHash },
        { slug: SLUG, directSpecMode: 'DIRECT_SPEC_V1', intentId: INTENT, g8ManifestHash: w.receipt.manifestHash, articlePlanHash: a.sourceHash })
      for (const k of REAL.source.ARTICLE_PLAN_REQUIRED) assert.deepEqual(row[k], PLAN()[k], `큐 ${k} 가 승인 plan 과 다르다`)
      assert.equal(row.cluster, 'sleep'); assert.equal(row.autoEligible, true)
      assert.deepEqual(plain(row.internalLinks), ['rel-a', 'rel-b', 'rel-c', 'rel-d'], 'internalLinks — direct 순서 뒤 discovery · 무절단')
      assert.deepEqual(Object.keys(row), Object.keys(source.queueRowFromEntry(a.entry, { day: 106 })), '키 순서가 고정되지 않았다')
      assert.deepEqual(plain(after.filter((q) => q.slug !== SLUG)), plain(before), '다른 행이 바뀌었다')
      assert.equal(sourceBytes(), s0, 'materialize 가 승인 artifact 를 바꿨다')
      assert.equal(materialize(w).code, 'ALREADY_QUEUED')
      assert.equal(queueOf(w.repo).filter((q) => q.slug === SLUG).length, 1)
      const e = makeWorld({ queue: (q) => { q.length = 0 } }); approved(e); assert.equal(materialize(e).day, 1, '빈 큐는 day 1')
    }],
    ['M02 materialize 거부 — 승인 entry 없음 · source/1 artifact · sourceHash drift · 기계 승인자 entry · plan union 밖 → 큐 바이트 불변', () => {
      const w = makeWorld(); const q0 = readFileSync(queueFile(w.repo), 'utf8')
      assert.equal(materialize(w).code, 'PLAN_NOT_APPROVED'); assert.equal(readFileSync(queueFile(w.repo), 'utf8'), q0)
      const editEntry = (mut) => {
        const wx = makeWorld(); approved(wx); const f = sourceFile(wx.repo); const d = JSON.parse(readFileSync(f, 'utf8')); mut(d)
        writeFileSync(f, `${JSON.stringify(d, null, 2)}\n`); return { wx, q: readFileSync(queueFile(wx.repo), 'utf8') }
      }
      for (const [label, mut, code] of [
        ['source/1', (d) => { d.schema = 'magazine-article-spec-source/1' }, 'PLAN_SCHEMA_UNKNOWN'],
        ['sourceHash drift', (d) => { d.entries[0].plan.title = '승인 뒤 바꾼 제목입니다' }, 'PLAN_HASH_DRIFT'],
        ['기계 승인자', (d) => { d.entries[0].approvedBy = 'codex'; d.entries[0].sourceHash = source.directSpecSourceHash(d.entries[0]) }, 'PLAN_NOT_APPROVED'],
        ['union 밖', (d) => { d.entries[0].plan.ctaBoard = '/community/x'; d.entries[0].sourceHash = source.directSpecSourceHash(d.entries[0]) }, 'PLAN_INVALID'],
        ['admission 다른 receipt', (d) => { d.entries[0].admission.receiptHash = 'other'; d.entries[0].sourceHash = source.directSpecSourceHash(d.entries[0]) }, 'ADMISSION_DRIFT'],
        ['관계 다름', (d) => { d.entries[0].relations.direct.reverse(); d.entries[0].sourceHash = source.directSpecSourceHash(d.entries[0]) }, 'RELATIONS_DRIFT'],
      ]) {
        const { wx, q } = editEntry(mut)
        const m = materialize(wx)
        assert.equal(m.code, code, `${label}: ${m.code} ${m.why}`); assert.equal(readFileSync(queueFile(wx.repo), 'utf8'), q, label)
      }
    }],
    ['M03 materialize 직전 재대조 — 승인 뒤 binding · ledger · receipt edge · journal 이 바뀌면 거부 · 큐 바이트 불변', () => {
      for (const [label, mut, code] of [
        ['binding', (w) => writeFileSync(join(w.admission, 'contract/m3-slug-manifest.json'), JSON.stringify({ slugs: { [INTENT]: 'other' } })), 'SLUG_BINDING_MISMATCH'],
        ['ledger', (w) => { const p = join(w.admission, 'contract/m3-state.jsonl'); writeFileSync(p, readFileSync(p, 'utf8') + readFileSync(p, 'utf8')) }, 'LEDGER_MISMATCH'],
        ['journal', (w) => writeFileSync(join(w.admission, 'contract/.g8-admission.journal.json'), '{}'), 'ADMISSION_IN_PROGRESS'],
        ['mapping', (w) => { const n = makeWorld({ graph: (g) => { g.mappings[0].slug = 'rel-a-renamed' } }); writeFileSync(join(w.repo, 'src/content/magazine/graph', `${GV}.ts`), readFileSync(join(n.repo, 'src/content/magazine/graph', `${GV}.ts`))) }, 'RECEIPT_EDGE_DRIFT'],
        // 승인 뒤 control 만 바뀌었다 — admission 은 그대로지만 승인 basis 가 지금 판과 다르다 → 실제 관문 사전검사가 막는다
        ['control', (w) => { const p = join(w.repo, 'src/content/magazine/graph/control.ts'); writeFileSync(p, readFileSync(p, 'utf8').replace("['sleep','family']", "['sleep','family','daily']")) }, 'GATE_REJECTED'],
      ]) {
        const w = makeWorld(); approved(w); const q0 = readFileSync(queueFile(w.repo), 'utf8'); mut(w)
        const m = materialize(w)
        assert.equal(m.code, code, `${label}: ${m.code} ${m.why}`); assert.equal(readFileSync(queueFile(w.repo), 'utf8'), q0, label)
      }
    }],
    ['M04 큐 writer lock — 다른 writer 가 쥐고 있으면 queue_writer_locked · 쓰기 0 · 외부 writer 끼어들기 → QUEUE_CHANGED · 외부 바이트 보존', () => {
      const w = makeWorld(); approved(w); const q0 = readFileSync(queueFile(w.repo), 'utf8')
      const held = withQueueWriteLock(queueFile(w.repo), () => materialize(w))
      assert.equal(held.ok, true, held.why); assert.equal(held.value.code, 'queue_writer_locked', JSON.stringify(held.value)); assert.equal(readFileSync(queueFile(w.repo), 'utf8'), q0)
      const external = queueFileText([LEGACY_ROW(), { ...LEGACY_ROW(), day: 77, slug: 'external-writer' }])
      const m = materialize(w, { hooks: { beforeWrite: ({ queuePath }) => writeFileSync(queuePath, external) } })
      assert.equal(m.code, 'QUEUE_CHANGED'); assert.equal(readFileSync(queueFile(w.repo), 'utf8'), external, '외부 writer 바이트를 덮었다')
      // 경쟁 — 판독 뒤 lock 전에 다른 writer 가 같은 slug 행을 넣었다 → lock 안에서 ALREADY_QUEUED
      const w2 = makeWorld(); approved(w2)
      const racer = queueFileText([LEGACY_ROW(), { ...LEGACY_ROW(), day: 90, slug: SLUG }])
      const r = materialize(w2, { hooks: { beforeLock: ({ queuePath }) => writeFileSync(queuePath, racer) } })
      assert.equal(r.code, 'ALREADY_QUEUED', `${r.code} ${r.why}`); assert.equal(readFileSync(queueFile(w2.repo), 'utf8'), racer)
    }],
    ['M05 쓴 뒤 다른 writer 가 내 행을 바꾸면 QUEUE_WRITE_CONFLICT · 관측 바이트 보존 · 남은 행은 소비 관문 · producer 선택이 HOLD', () => {
      const w = makeWorld(); approved(w); const q0 = readFileSync(queueFile(w.repo), 'utf8'); const s0 = readFileSync(sourceFile(w.repo), 'utf8')
      let observed = null
      const m = materialize(w, { hooks: { afterWrite: ({ queuePath }) => { observed = readFileSync(queuePath, 'utf8').replace(`slug: '${SLUG}',\n    title: '${PLAN().title}'`, `slug: '${SLUG}',\n    title: '${PLAN().title} (다른 writer)'`); writeFileSync(queuePath, observed) } } })
      assert.notEqual(observed, null); assert.ok(observed.includes('(다른 writer)'), '반례 준비 실패 — 내 행 제목을 바꾸지 못했다')
      assert.equal(m.ok, false); assert.equal(m.code, 'QUEUE_WRITE_CONFLICT', `${m.code} ${m.why}`); assert.ok(m.problems.includes('ROW_CHANGED'), m.problems.join(','))
      const now = readFileSync(queueFile(w.repo), 'utf8')
      assert.equal(now, observed, '다른 writer 가 쓴 바이트를 덮었다'); assert.notEqual(now, q0, '이전 큐 전체로 되돌렸다')
      assert.equal(readFileSync(sourceFile(w.repo), 'utf8'), s0, '승인 artifact 가 바뀌었다')
      assertHeld(w, 'SOURCE_QUEUE_DRIFT')
    }],
    ['M05c 쓴 뒤 외부 writer 가 별도 정상 행을 더해도 내 행이 그대로면 성공 · concurrentWrite=true · DIRECT 행과 외부 행 모두 보존', () => {
      const w = makeWorld(); approved(w); const s0 = readFileSync(sourceFile(w.repo), 'utf8')
      let external = null
      const m = materialize(w, { hooks: { afterWrite: ({ queuePath }) => {
        external = g8.insertQueueRows(readFileSync(queuePath, 'utf8'), [{ ...LEGACY_ROW(), day: 500, slug: 'external-writer-row' }]); writeFileSync(queuePath, external) } } })
      assert.deepEqual({ ok: m.ok, written: m.written, concurrentWrite: m.concurrentWrite }, { ok: true, written: true, concurrentWrite: true }, `${m.code} ${m.why}`)
      assert.equal(readFileSync(queueFile(w.repo), 'utf8'), external, '외부 writer 바이트가 바뀌었다')
      const q = queueOf(w.repo)
      assert.ok(q.some((x) => x.slug === 'external-writer-row'), '외부 행이 사라졌다')
      assert.deepEqual(plain(q.find((x) => x.slug === SLUG)), plain(m.row), 'DIRECT 행이 승인 행과 다르다')
      assert.equal(readFileSync(sourceFile(w.repo), 'utf8'), s0)
    }],
    ['M05d 쓴 뒤 다른 writer 가 주석만 더해도 성공 · concurrentWrite=true · 그 바이트 보존', () => {
      const w = makeWorld(); approved(w)
      let observed = null
      const m = materialize(w, { hooks: { afterWrite: ({ queuePath }) => { observed = `${readFileSync(queuePath, 'utf8')}// 다른 writer 의 주석\n`; writeFileSync(queuePath, observed) } } })
      assert.deepEqual({ ok: m.ok, concurrentWrite: m.concurrentWrite }, { ok: true, concurrentWrite: true }, `${m.code} ${m.why}`)
      assert.equal(readFileSync(queueFile(w.repo), 'utf8'), observed)
    }],
    ['M05h 쓴 뒤 다른 writer 가 내 행의 day 만 바꾸면(소비 관문은 통과) QUEUE_WRITE_CONFLICT(ROW_CHANGED) · 관측 바이트 보존', () => {
      const w = makeWorld(); approved(w)
      let observed = null
      const m = materialize(w, { hooks: { afterWrite: ({ queuePath }) => { observed = readFileSync(queuePath, 'utf8').replace(`day: 23,\n    slug: '${SLUG}'`, `day: 99,\n    slug: '${SLUG}'`); writeFileSync(queuePath, observed) } } })
      assert.ok(observed.includes('day: 99,'), '반례 준비 실패 — day 를 바꾸지 못했다')
      assert.equal(m.code, 'QUEUE_WRITE_CONFLICT', `${m.code} ${m.why}`); assert.deepEqual(m.problems, ['ROW_CHANGED'])
      assert.equal(readFileSync(queueFile(w.repo), 'utf8'), observed)
    }],
    ['M05e 쓴 뒤 다른 writer 가 내 행을 지우면 QUEUE_WRITE_CONFLICT(ROW_MISSING) · 관측 바이트 보존', () => {
      const w = makeWorld(); approved(w); const q0 = readFileSync(queueFile(w.repo), 'utf8')
      const m = materialize(w, { hooks: { afterWrite: ({ queuePath }) => writeFileSync(queuePath, q0) } })
      assert.equal(m.code, 'QUEUE_WRITE_CONFLICT', `${m.code} ${m.why}`); assert.ok(m.problems.includes('ROW_MISSING'), m.problems.join(','))
      assert.equal(readFileSync(queueFile(w.repo), 'utf8'), q0)
    }],
    ['M05f 쓴 뒤 같은 slug · 같은 intent 행이 하나 더 생기면 QUEUE_WRITE_CONFLICT(ROW_DUPLICATE) · 관측 바이트 보존', () => {
      for (const [label, dup] of [['같은 slug', { ...LEGACY_ROW(), day: 600, slug: SLUG }], ['같은 intent', { ...LEGACY_ROW(), day: 601, slug: 'other-slug', intentId: INTENT }]]) {
        const w = makeWorld(); approved(w)
        let observed = null
        const m = materialize(w, { hooks: { afterWrite: ({ queuePath }) => { observed = g8.insertQueueRows(readFileSync(queuePath, 'utf8'), [dup]); writeFileSync(queuePath, observed) } } })
        assert.equal(m.code, 'QUEUE_WRITE_CONFLICT', `${label}: ${m.code} ${m.why}`); assert.ok(m.problems.includes('ROW_DUPLICATE'), `${label}: ${m.problems}`)
        assert.equal(readFileSync(queueFile(w.repo), 'utf8'), observed, label)
      }
    }],
    ['M05g 쓴 뒤 내 행은 그대로인데 승인 source 가 철회되면 실제 소비 관문이 막아 QUEUE_WRITE_CONFLICT(GATE_REJECTED)', () => {
      const w = makeWorld(); approved(w)
      const m = materialize(w, { hooks: { afterWrite: ({ queuePath }) => {
        const f = sourceFile(w.repo); const d = JSON.parse(readFileSync(f, 'utf8')); d.entries[0].status = 'REVOKED'; writeFileSync(f, `${JSON.stringify(d, null, 2)}\n`)
        writeFileSync(queuePath, `${readFileSync(queuePath, 'utf8')}// 다른 writer\n`) } } })
      assert.equal(m.code, 'QUEUE_WRITE_CONFLICT', `${m.code} ${m.why}`); assert.ok(m.problems.includes('GATE_REJECTED'), m.problems.join(','))
      assertHeld(w, 'NOT_APPROVED')
    }],
    ['M05b 큐 끝 원소에 쉼표가 없어 새 행을 넣으면 읽히지 않는 큐 → QUEUE_RENDER_INVALID · 쓰기 0', () => {
      const w = makeWorld(); approved(w)
      const p = queueFile(w.repo)
      const noTrailing = readFileSync(p, 'utf8').replace(/},\n]\n$/, '}\n]\n')
      assert.notEqual(noTrailing, readFileSync(p, 'utf8'), '반례 준비 실패 — 끝 쉼표를 지우지 못했다')
      writeFileSync(p, noTrailing)
      assert.equal(queueOf(w.repo).length, 1, '반례 준비 실패 — 기존 큐가 읽히지 않는다')
      const m = materialize(w)
      assert.equal(m.code, 'QUEUE_RENDER_INVALID', `${m.code} ${m.why}`); assert.equal(readFileSync(p, 'utf8'), noTrailing)
    }],
    ['M06 materialize 출력 경로 — runtime · 다른 루트 → 거부 · 큐 0', () => {
      const w = makeWorld(); approved(w); const q0 = readFileSync(queueFile(w.repo), 'utf8')
      const runtime = join(w.base, 'soransoran-magazine-runtime'); mkdirSync(runtime); writeFileSync(join(runtime, '.git'), 'gitdir: /dev/null\n')
      assert.equal(materialize(w, { outRoot: runtime }).code, 'RUNTIME_OUTPUT_FORBIDDEN')
      assert.equal(materialize(w, { outRoot: w.admission }).code, 'OUT_ROOT_NOT_REPO')
      assert.equal(readFileSync(queueFile(w.repo), 'utf8'), q0)
      // 큐 파일이 runtime 쪽을 가리키는 symlink → 쓰지 않는다
      const target = join(runtime, 'topic-queue.ts'); writeFileSync(target, q0)
      rmSync(queueFile(w.repo)); symlinkSync(target, queueFile(w.repo))
      assert.equal(materialize(w).code, 'OUT_PATH_SYMLINK'); assert.equal(readFileSync(target, 'utf8'), q0, 'symlink 너머 runtime 큐를 썼다')
    }],
    // ── E. fail-closed · 복제 필드 ─────────────────────────────────
    ['E01 G8_ROW_NOT_DIRECT — 해시 하나만 · DIRECT 아님 · 모르는 mode / intentId 만 있는 legacy 는 결과 불변', () => {
      const w = makeWorld(); queued(w); const row = plain(queueOf(w.repo).find((q) => q.slug === SLUG))
      const { articlePlanHash: _p, ...noPlan } = row
      const { g8ManifestHash: _g, ...noManifest } = row
      const { directSpecMode: _d, ...noMode } = row
      for (const [label, r] of [['articlePlanHash 없음', noPlan], ['g8ManifestHash 없음', noManifest], ['directSpecMode 없음', noMode],
        ['LEGACY_BRIEF_V1', { ...row, directSpecMode: 'LEGACY_BRIEF_V1' }], ['모르는 mode', { ...row, directSpecMode: 'X' }]]) {
        const m = direct.resolveMagazineAutoMode(r)
        assert.deepEqual({ ok: m.ok, code: m.code }, { ok: false, code: 'G8_ROW_NOT_DIRECT' }, label)
      }
      assert.ok(judgeRow(w, noPlan).evidence.blockers.includes('G8_ROW_NOT_DIRECT'), 'ArticleSpec 직전 관문이 해시 하나만 있는 행을 통과시켰다')
      assert.equal(direct.resolveMagazineAutoMode(row).mode, 'DIRECT_SPEC_V1')
      const legacy = LEGACY_ROW()
      for (const r of [legacy, { ...legacy, intentId: 'I-LEGACY-ONLY' }, { ...legacy, intentId: 'I-LEGACY-ONLY', directSpecMode: 'LEGACY_BRIEF_V1' }]) {
        assert.deepEqual(direct.resolveMagazineAutoMode(r), { ok: true, mode: 'LEGACY_BRIEF_V1', reason: '명시 legacy 또는 opt-in 없음' }, JSON.stringify(r).slice(0, 80))
      }
      assert.deepEqual(briefAuto.legacyBriefTarget({ ...legacy, intentId: 'I-LEGACY-ONLY' }), { brief: true })
    }],
    ...REAL.source.QUEUE_REPLICA_FIELDS.map((field) => [`E02 큐 복제 필드 손편집 ${field} → SOURCE_QUEUE_DRIFT [${field}]`, () => {
      const w = makeWorld(); queued(w); const row = plain(queueOf(w.repo).find((q) => q.slug === SLUG))
      assert.equal(judgeRow(w, row).ok, true, '반례 준비 실패 — 원래 행이 관문을 통과하지 못한다')
      const edit = REPLICA_EDITS[field]
      assert.ok(edit, `${field} 편집 반례가 없다 — QUEUE_REPLICA_FIELDS 와 반례 표가 어긋났다`)
      const edited = { ...row, [field]: edit(row) }
      assert.notEqual(JSON.stringify(edited[field]), JSON.stringify(row[field]), `${field} 반례가 값을 바꾸지 않았다`)
      const r = judgeRow(w, edited)
      assert.equal(r.ok, false, `${field} 손편집이 통과했다`)
      assert.ok(r.evidence.blockers.includes('SOURCE_QUEUE_DRIFT') && r.evidence.queueDrift.includes(field), `${field}: ${r.evidence.blockers} · ${r.evidence.queueDrift}`)
    }]),
    ['E03 articlePlanHash 위조 — 임의 해시 → ARTICLE_PLAN_HASH_DRIFT · g8ManifestHash 위조 → MANIFEST_DRIFT', () => {
      const w = makeWorld(); queued(w); const row = plain(queueOf(w.repo).find((q) => q.slug === SLUG))
      for (const forged of ['sha256:forged', `sha256:${'0'.repeat(64)}`]) {
        const r = judgeRow(w, { ...row, articlePlanHash: forged })
        assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('ARTICLE_PLAN_HASH_DRIFT'), r.evidence.blockers.join(','))
      }
      const m = judgeRow(w, { ...row, g8ManifestHash: 'forged' })
      assert.equal(m.ok, false); assert.ok(m.evidence.blockers.includes('MANIFEST_DRIFT'))
    }],
    ['E04 internalLinks — direct 순서 뒤 discovery · 중복만 제거 · 개수로 자르지 않는다', () => {
      const rel = (slug, relationType = 'DIRECT_NEXT') => ({ slug, source: 'M-GRAPH', relationType, reason: 'r' })
      assert.deepEqual(source.internalLinksOf({ direct: ['d-1', 'd-2', 'd-3', 'd-2', 'd-4'].map((s) => rel(s)), discovery: rel('d-1', 'BRIDGE_DISCOVERY') }), ['d-1', 'd-2', 'd-3', 'd-4'])
      assert.deepEqual(source.internalLinksOf({ direct: [rel('a'), rel('b'), rel('c')], discovery: rel('z', 'BRIDGE_DISCOVERY') }), ['a', 'b', 'c', 'z'])
      assert.deepEqual(source.internalLinksOf({ direct: [rel('a'), rel('b')], discovery: rel('a', 'BRIDGE_DISCOVERY') }), ['a', 'b'])
      const w = makeWorld(); queued(w); const row = plain(queueOf(w.repo).find((q) => q.slug === SLUG))
      assert.deepEqual(row.internalLinks, ['rel-a', 'rel-b', 'rel-c', 'rel-d'])
      assert.ok(judgeRow(w, { ...row, internalLinks: [...row.internalLinks].reverse() }).evidence.queueDrift.includes('internalLinks'), '순서 뒤집기가 통과했다')
    }],
    // ── 필수 리허설 ───────────────────────────────────────────
    ['E1 리허설 — receipt → prepare → plan → approve → materialize → compileArticleSpec → producer 가 DIRECT 로만 선택', () => {
      const w = makeWorld()
      const p = prepare(w); assert.equal(p.ok, true, p.why)
      const a = approve(w, fill(p.candidate)); assert.equal(a.ok, true, `${a.code} ${a.why}`)
      const m = materialize(w); assert.equal(m.ok, true, `${m.code} ${m.why}`)
      const queue = queueOf(w.repo); const row = queue.find((q) => q.slug === SLUG)
      const draftsDir = join(w.repo, 'drafts/magazine')
      const judgeDirect = (item) => source.verifyDirectSpecIdentity({ queueItem: item, draftsDir, expectedGraphVersion: GV, productRoot: w.repo })
      const v = judgeDirect(row)
      assert.equal(v.ok, true, v.why); assert.equal(verifyArticleSpec(v.spec).ok, true)
      assert.deepEqual({ title: v.spec.identity.title, admission: v.spec.identity.admissionManifestHash, intentId: v.spec.identity.intentId,
        direct: v.spec.navigation.direct.map((x) => x.slug), discovery: v.spec.navigation.discovery.slug },
      { title: PLAN().title, admission: w.receipt.manifestHash, intentId: INTENT, direct: ['rel-a', 'rel-b', 'rel-c'], discovery: 'rel-d' })
      assert.equal(direct.resolveMagazineAutoMode(row).mode, 'DIRECT_SPEC_V1')
      assert.equal(briefAuto.legacyBriefTarget(row).status, 'SKIP_DIRECT')
      const articles = parseArticlesSource(readFileSync(join(w.repo, 'src/content/magazine/articles.ts'), 'utf8'))
      const select = (q) => producerPlan.selectWithDirectGate({ queue: q, articles, today: TODAY, produceCount: 5, reviewCount: 0, draftExists: () => false, judgeDirect })
      const sel = select(queue)
      assert.deepEqual(sel.selected.map((x) => x.slug).sort(), ['dssa-legacy', SLUG].sort())
      assert.ok(sel.directReady.has(SLUG), 'G8 행이 DIRECT 준비로 선택되지 않았다'); assert.deepEqual(sel.directHeld, [])
      assert.equal(sel.directReady.get(SLUG).spec.specHash, v.spec.specHash)
      // 손편집 · 해시 하나만 → 선정에서 빠지고 legacy 는 계속 · legacy brief 로 가지 않는다
      const editedQueue = queue.map((q) => (q.slug === SLUG ? { ...plain(q), title: `${q.title} (손편집)` } : q))
      const e = select(editedQueue)
      assert.deepEqual(e.selected.map((x) => x.slug), ['dssa-legacy'])
      assert.equal(e.directHeld[0]?.code, 'DIRECT_SPEC_SOURCE_NOT_READY'); assert.ok(e.directHeld[0].directSpec.blockers.includes('SOURCE_QUEUE_DRIFT'))
      const oneHash = queue.map((q) => (q.slug === SLUG ? (({ articlePlanHash: _p, ...x }) => x)(plain(q)) : q))
      const o = select(oneHash)
      assert.deepEqual(o.selected.map((x) => x.slug), ['dssa-legacy']); assert.equal(o.directHeld[0]?.code, 'G8_ROW_NOT_DIRECT')
      COUNTS.rehearsal = { prepareBlockers: p.candidate.blockers.length, approved: a.written, queuedDay: m.day, specHash: v.spec.specHash, selected: sel.selected.length, directReady: sel.directReady.size }
    }],
    // ── 범위 · CLI · 실제 저장소 ─────────────────────────────────
    ['S24a 생산자는 legacy·producer 경로에서 import 되지 않는다', () => {
      const users = spawnSync('grep', ['-rlE', "(from|import\\() *'[^']*magazine-direct-spec-source-authoring", join(ROOT, 'scripts'), join(ROOT, 'src')], { encoding: 'utf8' }).stdout
        .split('\n').filter(Boolean).map((p) => p.replace(`${ROOT}/`, '')).filter((p) => !/source-authoring|direct-spec-source-check\.mjs$/.test(p))
      assert.deepEqual(users, [], `생산자를 import 하는 운영 경로: ${users}`)
    }],
    ['S24b CLI 기본 실행은 도움말 — 읽기·쓰기 0 · 모르는 명령 · 인자 누락은 사용법 오류 · CLI materialize 실제 실행', () => {
      const h = spawnSync(process.execPath, [cliPath], { encoding: 'utf8', cwd: tmp('cli') })
      assert.equal(h.status, 0); assert.match(h.stdout, /prepare/); assert.match(h.stdout, /materialize/)
      assert.equal(spawnSync(process.execPath, [cliPath, 'write-now'], { encoding: 'utf8' }).status, 2)
      assert.equal(spawnSync(process.execPath, [cliPath, 'approve', '--candidate', '/nonexistent'], { encoding: 'utf8' }).status, 2)
      assert.equal(spawnSync(process.execPath, [cliPath, 'materialize', '--repo', '/x'], { encoding: 'utf8' }).status, 2)
      const w = makeWorld(); const a = approved(w)
      const r = spawnSync(process.execPath, [cliPath, 'materialize', '--slug', SLUG, '--repo', w.repo, '--admission-root', w.admission, '--out-root', w.repo], { encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr || r.stdout); const out = JSON.parse(r.stdout)
      assert.deepEqual({ ok: out.ok, written: out.written, concurrentWrite: out.concurrentWrite, day: out.day, articlePlanHash: out.articlePlanHash },
        { ok: true, written: true, concurrentWrite: false, day: 23, articlePlanHash: a.sourceHash }, 'CLI 가 성공 · concurrentWrite 를 사실대로 내지 않는다')
    }],
    ['S24c 실제 저장소 prepare(읽기 전용) — 연구 admission 없는 루트면 RECEIPT_ABSENT · 실제 graph·control 판독 통과 · 쓰기 0', () => {
      const empty = tmp('no-admission'); mkdirSync(join(empty, 'contract'), { recursive: true })
      const r = lib.prepareCandidate({ repoRoot: ROOT, admissionRoot: empty, slug: 'age-learning', asOf: AS_OF, nowMs: NOW })
      assert.equal(r.code, 'RECEIPT_ABSENT', `${r.code} ${r.why}`)
      const st = source.readProductGraphState(ROOT)
      assert.equal(st.ok, true, st.why); assert.deepEqual(st.blockers, [], `실제 제품 graph·control 판독 실패: ${st.blockers}`)
    }],
    // ── G. 개정(revise · supersedes) — 승인됐지만 큐에서 철회된 글의 재승인 (2026-10-26) ──────────
    ['RV1 개정 — 철회 뒤 prepare --revise · 사람이 새 publishAt · approve 가 기존 entry 를 교체 · materialize 가 새 행 (supersedes 보존)', () => {
      const w = makeWorld(); const { a } = queued(w)
      writeFileSync(queueFile(w.repo), queueFileText(queueOf(w.repo).filter((x) => x.slug !== SLUG)))
      const p = prepare(w, { revise: { supersedesSpecHash: OLD_SPEC } })
      assert.equal(p.ok, true, `${p.code} ${p.why}`)
      const c = p.candidate
      assert.deepEqual(c.entry.supersedes, { specHash: OLD_SPEC, sourceHash: a.sourceHash })
      assert.deepEqual(c.revision, { baseSourceHash: a.sourceHash, supersedesSpecHash: OLD_SPEC })
      assert.deepEqual(c.unresolvedFields, ['publication.publishAt'], '개정 후보가 publishAt 외의 사람 필드를 비웠거나 옛 시각을 옮겼다')
      assert.deepEqual(c.entry.plan, a.entry.plan); assert.equal(c.entry.node.status, 'DRAFT')
      c.entry.publication = { publishAt: NEW_AT }
      const r = approve(w, c)
      assert.equal(r.ok, true, `${r.code} ${r.why}`)
      const doc = JSON.parse(readFileSync(sourceFile(w.repo), 'utf8'))
      assert.equal(doc.entries.length, 1, '개정이 entry 를 더했다 (교체가 아니다)')
      const e = doc.entries[0]
      assert.notEqual(e.sourceHash, a.sourceHash); assert.equal(e.publication.publishAt, NEW_AT)
      assert.deepEqual(e.supersedes, { specHash: OLD_SPEC, sourceHash: a.sourceHash })
      assert.equal(e.sourceHash, source.directSpecSourceHash(e))
      const m = materialize(w)
      assert.equal(m.ok, true, `${m.code} ${m.why}`)
      assert.equal(m.row.articlePlanHash, e.sourceHash); assert.deepEqual(m.supersedes, e.supersedes)
      assert.equal(queueOf(w.repo).filter((x) => x.slug === SLUG || x.intentId === INTENT).length, 1)
      const j = judgeRow(w, m.row); assert.equal(j.ok, true, j.why)
      COUNTS.revise = { entries: doc.entries.length, supersedes: Boolean(e.supersedes), queueRows: 1 }
    }],
    ['RV2 큐 행이 남아 있으면 개정하지 않는다 → ALREADY_QUEUED', () => {
      const w = makeWorld(); queued(w)
      assert.equal(prepare(w, { revise: { supersedesSpecHash: OLD_SPEC } }).code, 'ALREADY_QUEUED')
    }],
    ['RV3 기존 승인 없이 개정 → REVISE_BASE_ABSENT · 등록된 slug → SLUG_ALREADY_REGISTERED', () => {
      assert.equal(prepare(makeWorld(), { revise: { supersedesSpecHash: OLD_SPEC } }).code, 'REVISE_BASE_ABSENT')
      // 기준 승인의 sourceHash 가 본문과 다르다(승인 뒤 손편집) — 개정 기준이 아니다
      const wt = makeWorld(); queued(wt)
      writeFileSync(queueFile(wt.repo), queueFileText(queueOf(wt.repo).filter((x) => x.slug !== SLUG)))
      const doc = JSON.parse(readFileSync(sourceFile(wt.repo), 'utf8')); doc.entries[0].plan.title = `${doc.entries[0].plan.title} 손편집`
      writeFileSync(sourceFile(wt.repo), `${JSON.stringify(doc, null, 2)}\n`)
      assert.equal(prepare(wt, { revise: { supersedesSpecHash: OLD_SPEC } }).code, 'REVISE_BASE_ABSENT')
      const w = makeWorld({ articles: (r) => { r[SLUG] = { title: 't', description: 'd', cluster: 'sleep', publishedAt: '2026-10-01' } } })
      assert.equal(prepare(w, { revise: { supersedesSpecHash: OLD_SPEC } }).code, 'SLUG_ALREADY_REGISTERED')
    }],
    ['RV4 old specHash 형식 위반 → SUPERSEDES_INVALID (읽기도 전에)', () => {
      for (const h of ['', 'sha256:abc', OLD_SPEC.toUpperCase()]) assert.equal(prepare(makeWorld(), { revise: { supersedesSpecHash: h } }).code, 'SUPERSEDES_INVALID', h)
    }],
    ['RV5 prepare 뒤 기준 승인이 바뀌었다 → REVISE_BASE_CHANGED · artifact 바이트 불변', () => {
      const w = makeWorld(); queued(w)
      writeFileSync(queueFile(w.repo), queueFileText(queueOf(w.repo).filter((x) => x.slug !== SLUG)))
      const p = prepare(w, { revise: { supersedesSpecHash: OLD_SPEC } }); assert.equal(p.ok, true, p.why)
      const c = p.candidate; c.entry.publication = { publishAt: NEW_AT }
      const doc = JSON.parse(readFileSync(sourceFile(w.repo), 'utf8'))
      doc.entries[0].approvedAt = '2026-10-16T09:00:00+09:00'; doc.entries[0].sourceHash = source.directSpecSourceHash(doc.entries[0])
      writeFileSync(sourceFile(w.repo), `${JSON.stringify(doc, null, 2)}\n`)
      const before = readFileSync(sourceFile(w.repo), 'utf8')
      assert.equal(approve(w, c).code, 'REVISE_BASE_CHANGED')
      assert.equal(readFileSync(sourceFile(w.repo), 'utf8'), before)
    }],
    ['RV6 일반 후보에 supersedes 를 끼우면 → CANDIDATE_APPROVAL_FORGED · 개정 후보의 supersedes 손편집 → CANDIDATE_REVISION_EDITED', () => {
      const w = makeWorld(); const c = ready(w); c.entry.supersedes = { specHash: OLD_SPEC, sourceHash: OLD_SPEC }
      assert.equal(approve(w, c).code, 'CANDIDATE_APPROVAL_FORGED')
      const w2 = makeWorld(); queued(w2)
      writeFileSync(queueFile(w2.repo), queueFileText(queueOf(w2.repo).filter((x) => x.slug !== SLUG)))
      const p = prepare(w2, { revise: { supersedesSpecHash: OLD_SPEC } }); assert.equal(p.ok, true, p.why)
      const c2 = p.candidate; c2.entry.publication = { publishAt: NEW_AT }; c2.entry.supersedes = { ...c2.entry.supersedes, specHash: `sha256:${'b'.repeat(64)}` }
      assert.equal(approve(w2, c2).code, 'CANDIDATE_REVISION_EDITED')
    }],
    ['RV7 같은 개정 승인을 다시 실행 → REVISE_BASE_CHANGED · artifact 바이트 불변 (멱등 — 두 번째 쓰기 0)', () => {
      const w = makeWorld(); queued(w)
      writeFileSync(queueFile(w.repo), queueFileText(queueOf(w.repo).filter((x) => x.slug !== SLUG)))
      const p = prepare(w, { revise: { supersedesSpecHash: OLD_SPEC } }); assert.equal(p.ok, true, p.why)
      const c = p.candidate; c.entry.publication = { publishAt: NEW_AT }
      assert.equal(approve(w, c).ok, true)
      const once = readFileSync(sourceFile(w.repo), 'utf8')
      assert.equal(approve(w, c).code, 'REVISE_BASE_CHANGED')
      assert.equal(readFileSync(sourceFile(w.repo), 'utf8'), once)
    }],
    ['RV8 개정해도 spec 이 그대로(같은 publishAt · 대체 대상 = 지금 spec) → SUPERSEDES_NOOP', () => {
      const w = makeWorld(); const { a } = queued(w)
      const row = queueOf(w.repo).find((x) => x.slug === SLUG)
      const cur = source.judgeDirectSpecSource({ queueItem: row, draftsDir: '/nonexistent-dssa', expectedGraphVersion: GV, productRoot: w.repo,
        exists: () => true, readFile: () => JSON.stringify({ schema: source.DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: GV, entries: [a.entry] }) })
      assert.equal(cur.ok, true, cur.why)
      writeFileSync(queueFile(w.repo), queueFileText(queueOf(w.repo).filter((x) => x.slug !== SLUG)))
      const p = prepare(w, { revise: { supersedesSpecHash: cur.spec.specHash } }); assert.equal(p.ok, true, p.why)
      const c = p.candidate; c.entry.publication = { ...a.entry.publication }
      assert.equal(approve(w, c).code, 'SUPERSEDES_NOOP')
    }],
    // ── H. source/2 → source/3 (글별 주제 금지 패턴 · 2026-10-28) ──────────
    ['RV9 source/2 기준 개정 — 패턴은 지어내지 않고 미해결 · 사람이 채우면 source/3 으로 교체 · 그 행은 spec/2', () => {
      const w = makeWorld(); toSourceV2(w, queued)
      const p = prepare(w, { revise: { supersedesSpecHash: OLD_SPEC } }); assert.equal(p.ok, true, `${p.code} ${p.why}`)
      const c = p.candidate
      assert.equal(c.entry.node.forbiddenPatterns, null, '옛 source/2 기준에 없는 패턴을 지어냈다')
      assert.deepEqual(c.unresolvedFields, ['node.forbiddenPatterns', 'publication.publishAt'])
      assert.equal(c.provenance['node.forbiddenPatterns'].status, 'UNRESOLVED')
      c.entry.publication = { publishAt: NEW_AT }
      assert.equal(approve(w, c).code, 'CANDIDATE_UNRESOLVED', '패턴 없이 source/3 승인을 썼다')
      c.entry.node.forbiddenPatterns = [...TOPIC_PATTERNS]
      const r = approve(w, c); assert.equal(r.ok, true, `${r.code} ${r.why}`)
      const doc = JSON.parse(readFileSync(sourceFile(w.repo), 'utf8'))
      assert.equal(doc.schema, 'magazine-article-spec-source/3'); assert.equal(doc.entries.length, 1)
      assert.deepEqual(doc.entries[0].node.forbiddenPatterns, TOPIC_PATTERNS)
      const m = materialize(w); assert.equal(m.ok, true, `${m.code} ${m.why}`)
      const j = judgeRow(w, m.row); assert.equal(j.ok, true, j.why)
      assert.equal(j.spec.schemaVersion, 'magazine-article-spec/2'); assert.deepEqual(j.spec.safety.topicForbiddenPatterns, TOPIC_PATTERNS)
    }],
    ['RV10 source/2 artifact 에 다른 승인 entry 가 남으면 판을 올리지 않는다 → ARTIFACT_SCHEMA_MIGRATION_BLOCKED · 바이트 불변', () => {
      const w = makeWorld(); toSourceV2(w, queued, { other: true })
      const p = prepare(w, { revise: { supersedesSpecHash: OLD_SPEC } }); assert.equal(p.ok, true, `${p.code} ${p.why}`)
      const c = p.candidate; c.entry.publication = { publishAt: NEW_AT }; c.entry.node.forbiddenPatterns = [...TOPIC_PATTERNS]
      const before = readFileSync(sourceFile(w.repo), 'utf8')
      assert.equal(approve(w, c).code, 'ARTIFACT_SCHEMA_MIGRATION_BLOCKED')
      assert.equal(readFileSync(sourceFile(w.repo), 'utf8'), before)
    }],
    ['RV11 공통 금지어 · topicConstraints 문장 · 빈 배열을 패턴으로 → 승인 0 · 바이트 불변', () => {
      for (const [label, patterns, code] of [
        ['공통 금지어', ['완치'], 'TOPIC_PATTERNS_INVALID'],
        ['지침 문장', [fx().node.safetyConstraints[0]], 'TOPIC_PATTERNS_INVALID'],
        ['빈 배열', [], 'CANDIDATE_UNRESOLVED'],
      ]) {
        const w = makeWorld(); const c = ready(w); c.entry.node.forbiddenPatterns = patterns
        assert.equal(approve(w, c).code, code, label)
        assert.equal(existsSync(sourceFile(w.repo)), false, `${label} — artifact 를 썼다`)
      }
    }],
    ['(수치) 승인·쓰기·외부 호출', () => { authoringCases.counts = COUNTS }],
  ]
}

/**
 * 운영 실제 상태 재현 — 승인 entry 가 source/2(패턴 없음)이고 큐에서 철회됐다.
 * `other` 면 같은 artifact 에 다른 글의 source/2 승인 entry 를 하나 더 둔다.
 */
function toSourceV2(w, queued, { other = false } = {}) {
  queued(w)
  writeFileSync(queueFile(w.repo), queueFileText(queueOf(w.repo).filter((x) => x.slug !== SLUG)))
  const doc = JSON.parse(readFileSync(sourceFile(w.repo), 'utf8'))
  const strip = (e) => { delete e.node.forbiddenPatterns; e.sourceHash = REAL.source.directSpecSourceHash(e); return e }
  const entries = [strip(doc.entries[0])]
  if (other) {
    const o = structuredClone(entries[0])
    Object.assign(o.node, { id: 'I-OTHER-01', intentId: 'I-OTHER-01', slug: 'zzz-other-v2' })
    entries.push(strip(o))
  }
  writeFileSync(sourceFile(w.repo), `${JSON.stringify({ schema: REAL.source.DIRECT_SPEC_SOURCE_SCHEMA_V2, graphVersion: GV, entries }, null, 2)}\n`)
}

/**
 * 부속 검사 연결 — source-check 의 실제 연결 블록을 떼어, 실패하는 가짜 부속 검사로 돌린다.
 * 🔴 실패를 fail 로 세지 않으면(무시하면) 단언이 깨져야 한다.
 */
export function extractLinkBlock(sourceCheckText) {
  const start = sourceCheckText.indexOf("{\n  const { spawnSync } = await import('node:child_process')")
  const end = sourceCheckText.indexOf('\n}\n', start)
  if (start === -1 || end === -1) throw new Error('source-check 의 부속 검사 연결 블록을 찾지 못했다')
  return sourceCheckText.slice(start, end + 2)
}
export function linkCases(blockText) {
  const runBlock = (fakes) => {
    const root = tmp('link')
    for (const [rel, body] of Object.entries(fakes)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body) }
    const driver = `const { join } = await import('node:path'); const ROOT = ${JSON.stringify(root)}; let fail = 0; let pass = 0;\n${blockText}\nprocess.stdout.write('\\n@@' + JSON.stringify({ fail, pass }))`
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', driver], { encoding: 'utf8' })
    const m = /@@(\{.*\})/.exec(r.stdout ?? '')
    if (!m) throw new Error(`연결 블록 실행 실패: ${r.stderr}`)
    return JSON.parse(m[1])
  }
  const A = 'scripts/magazine-direct-spec-source-authoring-check.mjs'
  const M = 'scripts/magazine-direct-spec-source-authoring-mutation.mjs'
  return [
    ['L1 부속 검사 연결 — 실패 종료·통과 표식 없음은 fail · 성공은 각각 pass 로 센다', () => {
      assert.deepEqual(runBlock({ [A]: 'process.exit(1)', [M]: "console.log('DIRECT_SPEC source 작성 변이: 1 pass, 0 fail')" }), { fail: 1, pass: 1 }, 'check 실패를 무시했다')
      assert.deepEqual(runBlock({ [A]: "console.log('DIRECT_SPEC source 작성 검사: 1 pass, 0 fail')", [M]: "console.log('요약 없음')" }), { fail: 1, pass: 1 }, 'mutation 표식 없음을 무시했다')
      assert.deepEqual(runBlock({ [A]: "console.log('DIRECT_SPEC source 작성 검사: 1 pass, 0 fail')", [M]: "console.log('DIRECT_SPEC source 작성 변이: 1 pass, 0 fail')" }), { fail: 0, pass: 2 }, '두 부속 성공이 pass 에 각각 들어가지 않았다')
    }],
  ]
}

async function main() {
  const lib = await import(pathToFileURL(LIB_PATH).href)
  const productFiles = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts', 'src/content/magazine/graph/current.ts', 'src/content/magazine/graph/control.ts',
    ...readdirSync(join(ROOT, 'src/content/magazine/graph')).filter((f) => /^g-.*\.ts$/.test(f)).map((f) => `src/content/magazine/graph/${f}`)]
  const before = productFiles.map((p) => readFileSync(join(ROOT, p), 'utf8'))
  const realSource = join(ROOT, 'drafts/magazine/article-spec-source')
  const realSourceBefore = existsSync(realSource)
  let pass = 0; let fail = 0
  const cases = [...authoringCases(lib), ...linkCases(extractLinkBlock(readFileSync(SOURCE_CHECK_PATH, 'utf8')))]
  for (const [name, fn] of cases) {
    try { await fn(); pass++; console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name} — ${e.message.split('\n')[0]}`) }
  }
  const after = productFiles.map((p) => readFileSync(join(ROOT, p), 'utf8'))
  const unchanged = before.every((b, i) => b === after[i]) && existsSync(realSource) === realSourceBefore
  if (unchanged) { pass++; console.log(`PASS S24d 실제 제품 queue·articles·graph(판 ${productFiles.length - 4}개)·control 바이트 불변 · 실제 source artifact 생성 0`) }
  else { fail++; console.log('FAIL S24d 실제 제품 파일 또는 source artifact 가 바뀌었다') }
  console.log(`\n수치: ${JSON.stringify(authoringCases.counts ?? {})}`)
  console.log(`\nDIRECT_SPEC source 작성 검사: ${pass} pass, ${fail} fail`)
  process.exit(fail ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-direct-spec-source-authoring-check.mjs')) await main()
