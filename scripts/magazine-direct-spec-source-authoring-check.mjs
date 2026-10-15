#!/usr/bin/env node
/**
 * DIRECT_SPEC source 작성(prepare · approve) 반례 검사.
 *
 * 🔴 실제 함수와 실제 CLI 를 임시 루트에서 태운다. 제품 저장소 · control · G8 장부 · 연구 저장소는 매번 합성한다.
 *    운영 queue · articles · graph · 장부 · runtime 쓰기 0, 네트워크 · Chrome · 모델 호출 0.
 *    실제 저장소는 읽기 전용 확인 하나(S24c)만 하고, 끝에 실제 제품 파일 바이트가 그대로인지 본다.
 *
 * `authoringCases(lib, { cliPath })` · `linkCases(blockText)` 를 export 한다 — 변이 검사가 같은 반례를 다시 돌린다.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..')
export const LIB_PATH = join(ROOT, 'scripts/lib/magazine-direct-spec-source-authoring.mjs')
export const CLI_PATH = join(ROOT, 'scripts/magazine-direct-spec-source-authoring.mjs')
export const SOURCE_CHECK_PATH = join(ROOT, 'scripts/magazine-direct-spec-source-check.mjs')
const FIXTURE = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')
const RESOLVER_TEXT = readFileSync(join(ROOT, 'src/lib/magazine-graph.ts'), 'utf8')
const fx = () => JSON.parse(readFileSync(FIXTURE, 'utf8'))

// 🔴 macOS 의 /var → /private/var symlink 를 피한다 — 출력 루트는 canonical 경로여야 한다
const TMP_BASE = realpathSync(tmpdir())
const TMPS = []
const tmp = (p) => { const d = mkdtempSync(join(TMP_BASE, `dssa-${p}-`)); TMPS.push(d); return d }
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

const GV = 'g-20261015-aaaaaa'
const OLD_GV = 'g-20260923-bbbbbb'
const SLUG = 'dssa-target'
const INTENT = 'I-DSSA-01'
const MANIFEST = 'sha256:dssa-g8-manifest'
// 🔴 실제 시계보다 과거 — CLI(실제 Date.now())도 같은 시각으로 승인할 수 있게
const AS_OF = '2026-10-14T09:00:00+09:00'
const AT = '2026-10-14T10:00:00+09:00'
const NOW = Date.parse('2026-10-14T12:00:00+09:00')
const REL = [
  ['I-R1', 'rel-a', 'DIRECT_NEXT', 'NEXT_QUESTION', 'FOOTER_NEXT', '다음 질문으로 이어진다'],
  ['I-R2', 'rel-b', 'SAME_EXPERIENCE', 'SIBLING', 'FOOTER_SIBLING', '같은 밤 경험이다'],
  ['I-R3', 'rel-c', 'ACTION_OR_CONTEXT', 'ACTION', 'FOOTER_NEXT', '생활 조정으로 이어진다'],
  ['I-R4', 'rel-d', 'BRIDGE_DISCOVERY', 'BRIDGE', 'FOOTER_BRIDGE', '다른 영역의 질문이다'],
]
const RESEARCH_INTENTS = `${JSON.stringify({ schemaVersion: 'intent/2', intentId: INTENT, primaryQuery: '잠 설친 다음 날', audienceSituation: '밤에 깬다', answerScope: '생활 조정', exclusions: ['진단'] })}\n`
const h16 = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16)

function queueRow(over = {}) {
  const { directSpecMode: _d, ...q } = fx().queueItem
  return { ...q, day: 9101, slug: SLUG, intentId: INTENT, g8ManifestHash: MANIFEST, ...over }
}

/** 합성 세계 — 제품 저장소(작업 트리) · G8 장부 · 연구 루트. mutate 로 반례 상태를 만든다 */
export function makeWorld(mutate = {}) {
  const base = tmp('world')
  const repo = join(base, 'repo'); const admission = join(base, 'admission'); const research = join(base, 'research')
  const graph = {
    graphVersion: GV,
    schemaVersion: { intent: 'intent/2', edge: 'edge/3', mapping: 'mapping/2', manifest: 'manifest/1' },
    contentHash: { intents: h16(RESEARCH_INTENTS), edges: 'e0000000000000aa', mappings: 'm0000000000000aa', combined: 'c0000000000000aa' },
    generatedAt: '2026-10-15T00:00:00.000Z',
    edges: REL.map(([to, , slot, type, placement, reason], i) => ({ id: `E-${i + 1}`, from: INTENT, to, type, slot, anchor: 'a', reason,
      placement, priority: i + 1, fromCluster: 'sleep', toCluster: 'sleep', active: false })),
    mappings: REL.map(([intent, slug]) => ({ intent, slug, cluster: 'sleep' })),
    intents: [{ id: INTENT, cluster: 'sleep', board: 'menopause' }, ...REL.map(([id]) => ({ id, cluster: 'sleep', board: 'menopause' }))],
  }
  mutate.graph?.(graph)
  const exportHash = mutate.exportHash ?? createHash('sha256').update(JSON.stringify(graph)).digest('hex').slice(0, 16)
  const gdir = join(repo, 'src/content/magazine/graph'); mkdirSync(gdir, { recursive: true })
  writeFileSync(join(repo, '.git'), 'gitdir: /dev/null\n')
  writeFileSync(join(gdir, 'current.ts'), `// test\nexport { GRAPH, EXPORT_HASH } from './${mutate.pointer ?? GV}'\n`)
  writeFileSync(join(gdir, `${mutate.pointer ?? GV}.ts`), `import type { MagazineGraph } from './types'\n\nexport const GRAPH: MagazineGraph = ${JSON.stringify(graph, null, 2)} as const\n\n/** test */\nexport const EXPORT_HASH = '${exportHash}'\n`)
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
  const queue = [queueRow()]
  mutate.queue?.(queue)
  mkdirSync(join(repo, 'drafts/magazine'), { recursive: true })
  writeFileSync(join(repo, 'drafts/magazine/topic-queue.ts'), `export const TOPIC_QUEUE: TopicQueueItem[] = ${JSON.stringify(queue, null, 2)}\n`)
  const ledger = [{ schemaVersion: 'm3ledger/2', event: 'ADMITTED', intentId: INTENT, slug: SLUG, title: 't', cluster: 'sleep',
    directRelations: [], discoveryRelation: null, internalLinks: [], at: '2026-10-13T15:00:00+09:00' }]
  mutate.ledger?.(ledger)
  const slugs = { [INTENT]: SLUG }
  mutate.slugs?.(slugs)
  mkdirSync(join(admission, 'contract'), { recursive: true })
  writeFileSync(join(admission, 'contract/m3-state.jsonl'), ledger.map((x) => JSON.stringify(x)).join('\n') + (ledger.length ? '\n' : ''))
  writeFileSync(join(admission, 'contract/m3-slug-manifest.json'), JSON.stringify({ slugs }, null, 2))
  const rIntents = mutate.researchIntents ?? RESEARCH_INTENTS
  const rmanifest = { graphVersion: OLD_GV, contentHash: { intents: h16(RESEARCH_INTENTS), edges: 'e-old', mappings: 'm-old', combined: 'c-old' } }
  mutate.researchManifest?.(rmanifest)
  mkdirSync(join(research, 'contract/build/current'), { recursive: true })
  writeFileSync(join(research, 'contract/build/current/manifest.json'), JSON.stringify(rmanifest))
  writeFileSync(join(research, 'contract/build/current/intents.jsonl'), rIntents)
  return { base, repo, admission, research, graph }
}

/** 사람이 채운다고 가정한 값 — fixture 의 승인 node 문장을 그대로 쓴다(시험 전용) */
function fill(candidate, over = {}) {
  const c = structuredClone(candidate)
  const n = fx().node
  Object.assign(c.entry.node, { readerQuestion: n.readerQuestion, scope: n.scope, outline: n.outline, evidence: n.evidence,
    safetyConstraints: n.safetyConstraints, hubPath: n.hubPath, ctaLabel: n.ctaLabel })
  if (c.entry.hero) c.entry.hero = fx().hero
  c.entry.publication = { publishAt: '2026-10-22T10:30:00+09:00' }
  over.edit?.(c)
  return c
}

const sourceFile = (repo) => join(repo, 'drafts/magazine/article-spec-source', `${GV}.json`)

export function authoringCases(lib, { cliPath = CLI_PATH } = {}) {
  const prepare = (w, extra = {}) => lib.prepareCandidate({ repoRoot: w.repo, admissionRoot: w.admission, slug: SLUG, asOf: AS_OF, nowMs: NOW, ...extra })
  const ready = (w, extra) => { const r = prepare(w, extra); assert.equal(r.ok, true, r.why); return fill(r.candidate) }
  const approve = (w, c, extra = {}) => lib.approveCandidate({ candidate: c, approver: '창업자', at: AT, confirmCandidateHash: lib.candidateHashOf(c),
    repoRoot: w.repo, admissionRoot: w.admission, outRoot: w.repo, nowMs: NOW, ...extra })
  const blockersOf = (w, extra) => { const r = prepare(w, extra); assert.equal(r.ok, true, r.why); return r.candidate.blockers }
  const COUNTS = {}

  return [
    ['S01 prepare 는 DRAFT 만 — APPROVED·approvedBy·approvedAt 0 · 파일 0', () => {
      const w = makeWorld(); const r = prepare(w)
      assert.equal(r.ok, true, r.why)
      const c = r.candidate
      assert.equal(c.schema, 'magazine-article-spec-source-candidate/1'); assert.equal(c.status, 'DRAFT'); assert.equal(c.entry.node.status, 'DRAFT')
      assert.ok(!JSON.stringify(c).includes('APPROVED'), 'prepare 가 APPROVED 를 만들었다')
      for (const k of ['approvedBy', 'approvedAt', 'status', 'sourceHash']) assert.ok(!(k in c.entry), `entry.${k}`)
      assert.equal(c.candidateHash, lib.candidateHashOf(c))
      assert.deepEqual(c.blockers, [])
      assert.deepEqual(c.entry.relations.direct.map((x) => x.slug), ['rel-a', 'rel-b', 'rel-c']); assert.equal(c.entry.relations.discovery.slug, 'rel-d')
      assert.equal(c.provenance['relations.direct'].status, 'DERIVED'); assert.equal(c.provenance['node.readerQuestion'].status, 'UNRESOLVED')
      assert.ok(c.provenance['relations.direct'].activation.every((x) => x.active === false && x.activation === 'PREACTIVATION' && /preactivation/.test(x.basis)))
      assert.ok(c.unresolvedFields.includes('node.readerQuestion') && c.unresolvedFields.includes('hero.alt') && c.unresolvedFields.includes('node.ctaLabel'))
      for (const p of ['readerQuestion', 'outline', 'hubPath', 'ctaLabel', 'safetyConstraints']) assert.equal(c.entry.node[p], null, `prepare 가 ${p} 를 지어냈다`)
      assert.deepEqual(c.entry.hero, { alt: null, scene: null }); assert.equal(c.entry.publication.publishAt, null)
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
      const tampered = makeWorld({ researchIntents: RESEARCH_INTENTS.replace('생활 조정', '바뀐 범위') })   // manifest 그대로 · 본문만 변조
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
    ['S04 오래된 연구 edge/mapping — 제품 graph 에 없는 관계는 후보 0 · 승인 거부', () => {
      const w = makeWorld({ graph: (g) => { g.edges = [] } })
      const r = prepare(w, { researchDir: w.research })
      assert.ok(r.candidate.blockers.includes('RELATIONS_INSUFFICIENT')); assert.equal(r.candidate.entry.relations.direct, null)
      const c = fill(r.candidate, { edit: (x) => {
        x.blockers = []
        x.entry.relations = { direct: REL.slice(0, 3).map(([, slug, slot, , , reason]) => ({ slug, source: 'M-GRAPH', relationType: slot, reason })),
          discovery: { slug: 'rel-d', source: 'M-GRAPH', relationType: 'BRIDGE_DISCOVERY', reason: REL[3][5] } }
      } })
      const a = approve(w, c, { researchDir: w.research })
      assert.equal(a.ok, false); assert.equal(a.code, 'RELATIONS_INVALID'); assert.ok(a.problems.includes('RELATION_NOT_IN_PRODUCT_GRAPH'))
    }],
    ['S05 G8 ADMITTED 없음 → ADMISSION_ABSENT', () => {
      assert.ok(blockersOf(makeWorld({ ledger: (l) => { l.length = 0 } })).includes('ADMISSION_ABSENT'))
    }],
    ['S06 slug·intentId·manifest 불일치 · forged schema · 중복 · 교차 신원 → blocker / 승인 시 신원 편집 거부', () => {
      assert.ok(blockersOf(makeWorld({ ledger: (l) => { l[0].intentId = 'I-OTHER' } })).includes('ADMISSION_ABSENT'))
      const crossed = blockersOf(makeWorld({ ledger: (l) => { l.push({ ...l[0], slug: 'other-slug' }) } }))
      assert.ok(crossed.includes('ADMISSION_IDENTITY_CROSSED') && crossed.includes('G8_INCONSISTENT'), crossed.join(','))
      assert.ok(blockersOf(makeWorld({ ledger: (l) => { l.push({ ...l[0] }) } })).includes('ADMISSION_DUPLICATE'))
      assert.ok(blockersOf(makeWorld({ ledger: (l) => { l[0].schemaVersion = 'm3ledger/9' } })).includes('ADMISSION_SCHEMA_INVALID'))
      assert.ok(blockersOf(makeWorld({ ledger: (l) => { delete l[0].at } })).includes('ADMISSION_SCHEMA_INVALID'))
      const unbound = blockersOf(makeWorld({ slugs: (s) => { s[INTENT] = 'other-slug' } }))
      assert.ok(unbound.includes('SLUG_UNBOUND') && unbound.includes('G8_INCONSISTENT'))
      assert.ok(blockersOf(makeWorld({ queue: (q) => { delete q[0].g8ManifestHash } })).includes('QUEUE_NOT_G8_ADMITTED'))
      assert.ok(blockersOf(makeWorld({ queue: (q) => { q.push({ ...q[0] }) } })).includes('QUEUE_ROW_DUPLICATE'))
      const wj = makeWorld(); writeFileSync(join(wj.admission, 'contract/.g8-apply.journal.json'), '{}')
      assert.ok(blockersOf(wj).includes('G8_INCONSISTENT'), '급사 journal 이 남았는데 G8 정합으로 봤다')
      const w = makeWorld(); const c = fill(prepare(w).candidate, { edit: (x) => { x.entry.g8ManifestHash = 'sha256:forged' } })
      assert.equal(approve(w, c).code, 'CANDIDATE_IDENTITY_EDITED')
    }],
    ['S07 STANDARD 아님 → PROFILE_NOT_STANDARD', () => {
      assert.ok(blockersOf(makeWorld({ queue: (q) => { q[0].validationProfile = 'MEDICAL' } })).includes('PROFILE_NOT_STANDARD'))
    }],
    ['S08 관계 3+1 부족 → 후보 blocker · 승인 거부 (숫자를 맞추려 만들지 않는다)', () => {
      const w = makeWorld({ graph: (g) => { g.edges = g.edges.filter((e) => e.slot !== 'SAME_EXPERIENCE') } })
      const r = prepare(w)
      assert.ok(r.candidate.blockers.includes('RELATIONS_INSUFFICIENT')); assert.equal(r.candidate.entry.relations.direct, null)
      const w2 = makeWorld(); const c = ready(w2); c.entry.relations.direct = c.entry.relations.direct.slice(0, 2)
      const a = approve(w2, c)
      assert.equal(a.code, 'CANDIDATE_UNRESOLVED'); assert.ok(a.problems.includes('relations.direct'))
      const st = lib.readCurrentState({ repoRoot: w2.repo, admissionRoot: w2.admission, slug: SLUG })
      assert.ok(lib.judgeRelations({ relations: c.entry.relations, state: st, intentId: INTENT, slug: SLUG, atMs: Date.parse(AT) }).problems.includes('RELATIONS_DIRECT_NOT_3'))
      assert.ok(lib.judgeRelations({ relations: { direct: ready(w2).entry.relations.direct, discovery: null }, state: st, intentId: INTENT, slug: SLUG, atMs: Date.parse(AT) }).problems.includes('RELATIONS_DISCOVERY_NOT_1'))
    }],
    ['S09 관계 중복·자기 자신 → 거부', () => {
      const w = makeWorld(); const c = ready(w); c.entry.relations.direct[2] = { ...c.entry.relations.direct[0] }
      assert.ok(approve(w, c).problems.includes('RELATION_DUPLICATE'))
      const c2 = ready(w); c2.entry.relations.direct[0] = { ...c2.entry.relations.direct[0], slug: SLUG }
      assert.ok(approve(w, c2).problems.includes('RELATION_SELF'))
    }],
    ['S10 미등록 관계 글 → 후보 eligible 0 · 승인 거부', () => {
      const w = makeWorld({ articles: (a) => { delete a['rel-b'] } })
      const r = prepare(w)
      assert.equal(r.candidate.relationEvidence.find((e) => e.slug === 'rel-b').target, 'UNREGISTERED')
      assert.ok(r.candidate.blockers.includes('RELATIONS_INSUFFICIENT'))
      const st = lib.readCurrentState({ repoRoot: w.repo, admissionRoot: w.admission, slug: SLUG })
      assert.ok(lib.judgeRelations({ relations: ready(makeWorld()).entry.relations, state: st, intentId: INTENT, slug: SLUG, atMs: Date.parse(AT) }).problems.includes('RELATION_TARGET_UNREGISTERED'))
    }],
    ['S11 승인 시각보다 뒤에 공개되는 관계 글 → RELATION_TARGET_NOT_YET_PUBLIC', () => {
      const w = makeWorld({ articles: (a) => { a['rel-c'].publishAt = '2026-10-14T09:30:00+09:00' } })
      assert.ok(prepare(w).candidate.blockers.includes('RELATIONS_INSUFFICIENT'))   // as-of 09:00 에는 아직 비공개
      const w2 = makeWorld({ articles: (a) => { a['rel-c'].publishAt = '2026-10-14T08:00:00+09:00' } })
      const c = ready(w2)
      // 승인 시각이 후보 asOf 보다 앞이면 그 전에 막힌다 — 관계 판정 자체는 함수로 본다
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
      // 미래 공개 관계 — rel-c 는 10/20 공개. 승인을 10/21 로 적어 통과시키려는 시도
      const wf = makeWorld({ articles: (a) => { a['rel-c'].publishAt = '2026-10-20T10:30:00+09:00' } })
      const pf = prepare(wf, { asOf: '2026-10-21T09:00:00+09:00', nowMs: Date.parse('2026-10-22T00:00:00+09:00') })   // 미래 시점에서 만든 후보라고 가정
      assert.equal(pf.ok, true, pf.why)
      const cf = fill(pf.candidate)
      const af = approve(wf, cf, { at: '2026-10-21T10:00:00+09:00' })   // 실제 지금은 10/14 12:00
      assert.equal(af.code, 'APPROVED_AT_FUTURE')
      assert.equal(existsSync(sourceFile(wf.repo)), false)
    }],
    ['S12 현재 graph 에서 증명되지 않는 M-GRAPH 관계(reason 변경) · HUB → 거부', () => {
      const w = makeWorld(); const c = ready(w); c.entry.relations.direct[1].reason = '사람이 지어낸 이유'
      assert.ok(approve(w, c).problems.includes('RELATION_NOT_IN_PRODUCT_GRAPH'))
      const c2 = ready(w); c2.entry.relations.discovery = { ...c2.entry.relations.discovery, source: 'HUB' }
      assert.ok(approve(w, c2).problems.includes('RELATION_HUB_UNPROVABLE'))
    }],
    ['C1 M-GRAPH control — graph off · kill switch · cluster off → blocker', () => {
      assert.ok(blockersOf(makeWorld({ control: (c) => { c.enabled = false } })).includes('GRAPH_CONTROL_DISABLED'))
      assert.ok(blockersOf(makeWorld({ control: (c) => { c.killSwitch.tripped = true } })).includes('GRAPH_KILL_SWITCH_TRIPPED'))
      assert.ok(blockersOf(makeWorld({ control: (c) => { c.enabledClusters = ['family'] } })).includes('GRAPH_CLUSTER_DISABLED'))
    }],
    ['C2 surface — BODY_CALLOUT · 끈 surface · 미구현 surface 관계는 eligible 0 · 승인 거부', () => {
      const callout = makeWorld({ graph: (g) => { g.edges[2].placement = 'BODY_CALLOUT' } })
      const r = prepare(callout)
      const ev = r.candidate.relationEvidence.find((e) => e.edgeId === 'E-3')
      assert.equal(ev.surfaceOk, false); assert.equal(ev.eligible, false); assert.ok(r.candidate.blockers.includes('RELATIONS_INSUFFICIENT'))
      const off = makeWorld({ control: (c) => { c.surfaces.FOOTER_SIBLING = false } })
      assert.ok(prepare(off).candidate.blockers.includes('RELATIONS_INSUFFICIENT'))
      const notImpl = makeWorld({ resolver: (t) => t.replace("  'FOOTER_BRIDGE',\n] as const\n\n/** 하단", "] as const\n\n/** 하단") })
      assert.ok(prepare(notImpl).candidate.blockers.includes('RELATIONS_INSUFFICIENT'))
      // 승인 단계 — 사람이 BODY_CALLOUT edge 를 관계로 적어도 거부
      const w = makeWorld(); const c = ready(w)
      const wc = makeWorld({ graph: (g) => { g.edges[2].placement = 'BODY_CALLOUT' } })
      const st = lib.readCurrentState({ repoRoot: wc.repo, admissionRoot: wc.admission, slug: SLUG })
      assert.ok(lib.judgeRelations({ relations: c.entry.relations, state: st, intentId: INTENT, slug: SLUG, atMs: Date.parse(AT) }).problems.includes('RELATION_SURFACE_DISABLED'))
      const wt = makeWorld({ graph: (g) => { g.edges[3].type = 'SIBLING' } })   // discovery 는 BRIDGE type 만
      const st2 = lib.readCurrentState({ repoRoot: wt.repo, admissionRoot: wt.admission, slug: SLUG })
      assert.ok(lib.judgeRelations({ relations: c.entry.relations, state: st2, intentId: INTENT, slug: SLUG, atMs: Date.parse(AT) }).problems.includes('RELATION_TYPE_INVALID'))
    }],
    ['C3 active=false 만으로는 거부하지 않는다 — preactivation 근거 기록 · active=true 도 같은 조건', () => {
      const w = makeWorld({ graph: (g) => { g.edges[0].active = true } })
      const r = prepare(w)
      assert.deepEqual(r.candidate.blockers, [])
      const act = r.candidate.provenance['relations.direct'].activation
      assert.equal(act[0].activation, 'ACTIVE'); assert.equal(act[1].activation, 'PREACTIVATION')
    }],
    ['S13 미해결 필드 → CANDIDATE_UNRESOLVED', () => {
      const w = makeWorld(); const a = approve(w, prepare(w).candidate)
      assert.equal(a.code, 'CANDIDATE_UNRESOLVED'); assert.ok(a.problems.includes('node.readerQuestion'))
      const c = ready(w); c.entry.hero.scene = null
      assert.ok(approve(w, c).problems.includes('hero.scene'))
    }],
    ['H1 hero — OPTIONAL 도 alt·scene 승인 전 필수 · NO_IMAGE 만 hero=null', () => {
      const w = makeWorld({ queue: (q) => { q[0].imageMode = 'OPTIONAL' } })
      const r = prepare(w)
      assert.deepEqual(r.candidate.entry.hero, { alt: null, scene: null })
      assert.ok(r.candidate.unresolvedFields.includes('hero.alt') && r.candidate.unresolvedFields.includes('hero.scene'))
      assert.equal(r.candidate.provenance['hero.alt'].status, 'UNRESOLVED')
      const c = fill(r.candidate, { edit: (x) => { x.entry.hero = { alt: null, scene: null } } })
      const a = approve(w, c); assert.equal(a.code, 'CANDIDATE_UNRESOLVED'); assert.ok(a.problems.includes('hero.alt'))
      const ok = approve(w, fill(r.candidate)); assert.equal(ok.ok, true, ok.why)
      const wn = makeWorld({ queue: (q) => { q[0].imageMode = 'NO_IMAGE' } })
      const rn = prepare(wn); assert.equal(rn.candidate.entry.hero, null); assert.ok(!rn.candidate.unresolvedFields.some((f) => f.startsWith('hero')))
    }],
    ['S14 빈 승인자 · 기계 승인자 → 거부', () => {
      const w = makeWorld(); const c = ready(w)
      assert.equal(approve(w, c, { approver: '  ' }).code, 'APPROVER_REQUIRED')
      for (const m of ['machine:codex', 'codex', 'Claude Code', 'bot-1', 'ci', 'system:auto']) assert.equal(approve(w, c, { approver: m }).code, 'APPROVER_MACHINE', m)
      assert.equal(approve(w, c, { at: '2026-10-14 10:00' }).code, 'APPROVED_AT_INVALID')
    }],
    ['S15 후보 해시 불일치 → CANDIDATE_HASH_MISMATCH', () => {
      const w = makeWorld(); const c = ready(w)
      assert.equal(approve(w, c, { confirmCandidateHash: c.candidateHash }).code, 'CANDIDATE_HASH_MISMATCH')
    }],
    ['S16 prepare 뒤 graph·control·queue·articles·G8 변경 → STATE_CHANGED', () => {
      for (const [label, mut] of [
        ['queue', (w) => { const p = join(w.repo, 'drafts/magazine/topic-queue.ts'); writeFileSync(p, readFileSync(p, 'utf8').replace('"whyNow": "', '"whyNow": "바뀜 ')) }],
        ['articles', (w) => { const p = join(w.repo, 'src/content/magazine/articles.ts'); writeFileSync(p, readFileSync(p, 'utf8').replace('"title": "rel-a"', '"title": "rel-a 개정"')) }],
        ['graph', (w) => { const n = makeWorld({ graph: (g) => { g.contentHash.edges = 'e-new' } }); for (const f of ['current.ts', `${GV}.ts`]) writeFileSync(join(w.repo, 'src/content/magazine/graph', f), readFileSync(join(n.repo, 'src/content/magazine/graph', f))) }],
        ['control', (w) => { const p = join(w.repo, 'src/content/magazine/graph/control.ts'); const t = readFileSync(p, 'utf8'); const n = t.replace("['sleep','family']", "['sleep','family','daily']"); assert.notEqual(n, t, 'control 반례 준비 실패'); writeFileSync(p, n) }],
        ['G8', (w) => { const p = join(w.admission, 'contract/m3-state.jsonl'); writeFileSync(p, readFileSync(p, 'utf8').replace('15:00:00', '15:00:01')) }],
      ]) {
        const w = makeWorld(); const c = ready(w)
        const snap = () => [join(w.repo, 'drafts/magazine/topic-queue.ts'), join(w.repo, 'src/content/magazine/articles.ts'),
          join(w.repo, 'src/content/magazine/graph', `${GV}.ts`), join(w.repo, 'src/content/magazine/graph/control.ts'),
          join(w.admission, 'contract/m3-state.jsonl')].map((p) => readFileSync(p, 'utf8')).join('\u0000')
        const before = snap(); mut(w); assert.notEqual(snap(), before, `${label}: 반례가 아무것도 바꾸지 않았다`)
        const a = approve(w, c)
        assert.equal(a.code, 'STATE_CHANGED', `${label}: ${a.code} ${a.why}`)
      }
    }],
    ['S17 출력 경로 신원 — runtime · repo 와 다른 루트 · 없는 디렉터리 · symlink 조상 · 없는 symlink 하위 경로 · 대상 폴더 symlink', () => {
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
      assert.equal(approve(w, c, { outRoot: join(link, 'new-subdir') }).code, 'OUT_ROOT_NOT_DIRECTORY')   // 없는 symlink 하위 경로
      const repoLink = join(w.base, 'repo-link'); symlinkSync(w.repo, repoLink)
      assert.equal(approve(w, c, { outRoot: repoLink }).code, 'OUT_ROOT_SYMLINK')
      // 대상 폴더(article-spec-source)가 runtime 을 가리키는 symlink
      mkdirSync(join(w.repo, 'drafts/magazine'), { recursive: true })
      symlinkSync(runtime, join(w.repo, 'drafts/magazine/article-spec-source'))
      assert.equal(approve(w, c).code, 'OUT_PATH_SYMLINK')
      assert.deepEqual(readdirSync(runtime), ['.git'], 'runtime 에 무언가 쓰였다')
      const nogit = makeWorld(); rmSync(join(nogit.repo, '.git'))
      assert.equal(approve(nogit, ready(nogit)).code, 'OUT_ROOT_NOT_WORKTREE')
    }],
    ['S18 기존 다른 entry 보존 · S19 같은 승인 멱등 · S20 다른 바이트 충돌', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      const other = { status: 'APPROVED', approvedBy: '창업자', approvedAt: '2026-10-13T10:00:00+09:00', g8ManifestHash: 'sha256:o',
        node: { slug: 'aaa-other', intentId: 'I-OTHER', graphVersion: GV }, relations: {}, hero: null, publication: {}, sourceHash: 'sha256:x' }
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, `${JSON.stringify({ schema: 'magazine-article-spec-source/1', graphVersion: GV, entries: [other] }, null, 2)}\n`)
      const a1 = approve(w, c); assert.equal(a1.ok, true, a1.why); assert.equal(a1.written, true)
      const doc = JSON.parse(readFileSync(f, 'utf8'))
      assert.deepEqual(doc.entries.map((x) => x.node.slug), ['aaa-other', SLUG]); assert.deepEqual(doc.entries[0], other)
      const bytes = readFileSync(f, 'utf8')
      const a2 = approve(w, c); assert.equal(a2.ok, true); assert.equal(a2.written, false); assert.equal(readFileSync(f, 'utf8'), bytes)
      const a3 = approve(w, c, { approver: '다른 사람' }); assert.equal(a3.code, 'ARTIFACT_CONFLICT'); assert.equal(readFileSync(f, 'utf8'), bytes)
      COUNTS.idempotent = { first: a1.written, second: a2.written }
    }],
    ['W1 CAS — 읽은 뒤 외부 writer 가 바꾸거나 새로 만들면 멈추고 외부 바이트를 그대로 둔다', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, `${JSON.stringify({ schema: 'magazine-article-spec-source/1', graphVersion: GV, entries: [] }, null, 2)}\n`)
      const external = `${JSON.stringify({ schema: 'magazine-article-spec-source/1', graphVersion: GV, entries: [{ node: { slug: 'zzz-external', intentId: 'I-EXT' } }] }, null, 2)}\n`
      const a = approve(w, c, { hooks: { beforeRename: () => writeFileSync(f, external) } })
      assert.equal(a.code, 'ARTIFACT_CHANGED_DURING_WRITE'); assert.equal(readFileSync(f, 'utf8'), external, '외부 writer 바이트를 덮었다')
      const w2 = makeWorld(); const c2 = ready(w2); const f2 = sourceFile(w2.repo)
      const b = approve(w2, c2, { hooks: { beforeRename: () => writeFileSync(f2, external) } })   // 없던 파일이 생긴다
      assert.equal(b.code, 'ARTIFACT_CHANGED_DURING_WRITE'); assert.equal(readFileSync(f2, 'utf8'), external)
      assert.deepEqual(readdirSync(dirname(f2)).filter((x) => x.includes('.tmp-')), [])
      COUNTS.cas = { changed: a.code, created: b.code }
    }],
    ['S18b 승인 artifact 는 실제 source 관문을 통과한다 (judgeDirectSpecSource)', async () => {
      const src = await import(pathToFileURL(join(ROOT, 'scripts/lib/magazine-direct-spec-source.mjs')).href)
      const w = makeWorld(); const c = ready(w)
      assert.equal(approve(w, c).written, true)
      const j = src.judgeDirectSpecSource({ queueItem: queueRow(), draftsDir: join(w.repo, 'drafts/magazine'), expectedGraphVersion: GV })
      assert.equal(j.ok, true, j.why); assert.equal(j.evidence.approvalStatus, 'APPROVED')
    }],
    ['S18c NO_IMAGE 큐 행에 hero 내용 → 관문 거부(GATE_REJECTED) · 쓰기 0', () => {
      const w = makeWorld({ queue: (q) => { q[0].imageMode = 'NO_IMAGE' } })
      const r = prepare(w); assert.equal(r.candidate.entry.hero, null)
      const c = fill(r.candidate, { edit: (x) => { x.entry.hero = fx().hero } })
      assert.equal(approve(w, c).code, 'GATE_REJECTED'); assert.equal(existsSync(sourceFile(w.repo)), false)
    }],
    ['S18d 후보에 승인 필드 위조 → CANDIDATE_APPROVAL_FORGED', () => {
      const w = makeWorld(); const c = ready(w); c.entry.approvedBy = '창업자'
      assert.equal(approve(w, c).code, 'CANDIDATE_APPROVAL_FORGED')
      const c2 = ready(w); c2.entry.node.status = 'APPROVED'
      assert.equal(approve(w, c2).code, 'CANDIDATE_APPROVAL_FORGED')
    }],
    ['S21a 살아 있는 잠금 → LOCK_BUSY · 쓰기 0', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(w.repo)
      mkdirSync(dirname(f), { recursive: true }); writeFileSync(`${f}.lock`, JSON.stringify({ pid: process.pid }))
      assert.equal(approve(w, c).code, 'LOCK_BUSY'); assert.equal(existsSync(f), false)
    }],
    ['S21b 실제 다중 프로세스 동시 승인 → 쓴 writer 정확히 1', async () => {
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
      COUNTS.concurrent = { processes: 8, writers, idempotent: results.filter((x) => x.r?.ok && x.r.written === false).length,
        lockBusy: results.filter((x) => x.r?.code === 'LOCK_BUSY').length }
      assert.equal(writers, 1, JSON.stringify(results.map((x) => x.r?.code ?? x.r?.written)))
      assert.ok(results.every((x) => x.r && (x.r.ok || x.r.code === 'LOCK_BUSY')), JSON.stringify(results.map((x) => x.r)))
      assert.equal(JSON.parse(readFileSync(sourceFile(w.repo), 'utf8')).entries.length, 1)
    }],
    ['S22 쓰기 중 실패·급사 → 기존 artifact 불변 · 다음 승인은 잠금 회수 후 성공', () => {
      const w = makeWorld(); const f = sourceFile(w.repo)
      const keep = `${JSON.stringify({ schema: 'magazine-article-spec-source/1', graphVersion: GV, entries: [] }, null, 2)}\n`
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
      const after = approve(w, c); assert.equal(after.ok, true, after.why); assert.equal(after.written, true)
    }],
    ['S23 승인 전 source artifact 0 — prepare·거부된 approve 뒤에도 파일 없음', () => {
      const w = makeWorld()
      const r = prepare(w, { researchDir: w.research }); approve(w, r.candidate); approve(w, fill(r.candidate), { approver: 'bot' })
      assert.equal(existsSync(sourceFile(w.repo)), false)
    }],
    ['S24a 생산자는 legacy·producer 경로에서 import 되지 않는다', () => {
      const users = spawnSync('grep', ['-rl', 'magazine-direct-spec-source-authoring', join(ROOT, 'scripts'), join(ROOT, 'src')], { encoding: 'utf8' }).stdout
        .split('\n').filter(Boolean).map((p) => p.replace(`${ROOT}/`, '')).filter((p) => !/source-authoring|direct-spec-source-check\.mjs$/.test(p))
      assert.deepEqual(users, [], `생산자를 import 하는 운영 경로: ${users}`)
    }],
    ['S24b CLI 기본 실행은 도움말 — 읽기·쓰기 0 · 모르는 명령은 사용법 오류', () => {
      const h = spawnSync(process.execPath, [cliPath], { encoding: 'utf8', cwd: tmp('cli') })
      assert.equal(h.status, 0); assert.match(h.stdout, /prepare/)
      assert.equal(spawnSync(process.execPath, [cliPath, 'write-now'], { encoding: 'utf8' }).status, 2)
      assert.equal(spawnSync(process.execPath, [cliPath, 'approve', '--candidate', '/nonexistent'], { encoding: 'utf8' }).status, 2)
    }],
    ['S24c 실제 저장소 prepare(읽기 전용) — 제품 graph·control·surface 판독 통과 · G8 행이 없으면 blocker · 쓰기 0', () => {
      const r = lib.prepareCandidate({ repoRoot: ROOT, admissionRoot: tmp('no-admission'), slug: 'palpitations-menopause', asOf: AS_OF, nowMs: NOW })
      assert.equal(r.ok, true, r.why)
      const bad = r.candidate.blockers.filter((b) => /^GRAPH_(EXPORT|VERSION|CONTROL|KILL|SURFACE)/.test(b))
      assert.deepEqual(bad, [], `실제 제품 graph·control 판독 실패: ${bad}`)
      assert.deepEqual(r.candidate.identity.relationSurfaces, ['FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE'])
      assert.ok(r.candidate.blockers.includes('QUEUE_NOT_G8_ADMITTED'))
    }],
    ['(수치) 승인·쓰기·외부 호출', () => { authoringCases.counts = COUNTS }],
  ]
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
    const driver = `const { join } = await import('node:path'); const ROOT = ${JSON.stringify(root)}; let fail = 0;\n${blockText}\nprocess.stdout.write('\\n@@' + JSON.stringify({ fail }))`
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', driver], { encoding: 'utf8' })
    const m = /@@(\{.*\})/.exec(r.stdout ?? '')
    if (!m) throw new Error(`연결 블록 실행 실패: ${r.stderr}`)
    return JSON.parse(m[1]).fail
  }
  const A = 'scripts/magazine-direct-spec-source-authoring-check.mjs'
  const M = 'scripts/magazine-direct-spec-source-authoring-mutation.mjs'
  return [
    ['L1 부속 검사 연결 — 실패 종료·통과 표식 없음을 fail 로 센다 · 둘 다 통과면 0', () => {
      assert.equal(runBlock({ [A]: 'process.exit(1)', [M]: "console.log('DIRECT_SPEC source 작성 변이: 1 pass, 0 fail')" }), 1, 'check 실패를 무시했다')
      assert.equal(runBlock({ [A]: "console.log('DIRECT_SPEC source 작성 검사: 1 pass, 0 fail')", [M]: "console.log('요약 없음')" }), 1, 'mutation 표식 없음을 무시했다')
      assert.equal(runBlock({ [A]: "console.log('DIRECT_SPEC source 작성 검사: 1 pass, 0 fail')", [M]: "console.log('DIRECT_SPEC source 작성 변이: 1 pass, 0 fail')" }), 0)
    }],
  ]
}

async function main() {
  const lib = await import(pathToFileURL(LIB_PATH).href)
  const productFiles = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts', 'src/content/magazine/graph/current.ts', 'src/content/magazine/graph/control.ts']
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
  if (unchanged) { pass++; console.log('PASS S24d 실제 제품 queue·articles·graph·control 바이트 불변 · 실제 source artifact 생성 0') }
  else { fail++; console.log('FAIL S24d 실제 제품 파일 또는 source artifact 가 바뀌었다') }
  console.log(`\n수치: ${JSON.stringify(authoringCases.counts ?? {})}`)
  console.log(`\nDIRECT_SPEC source 작성 검사: ${pass} pass, ${fail} fail`)
  process.exit(fail ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-direct-spec-source-authoring-check.mjs')) await main()
