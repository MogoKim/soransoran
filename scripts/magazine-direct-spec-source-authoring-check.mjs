#!/usr/bin/env node
/**
 * DIRECT_SPEC source 작성(prepare · approve) 반례 검사.
 *
 * 🔴 실제 함수와 실제 CLI 를 임시 루트에서 태운다. 제품 저장소 · G8 장부 · 연구 저장소는 매번 합성한다.
 *    운영 queue · articles · graph · 장부 · runtime 쓰기 0, 네트워크 · Chrome · 모델 호출 0.
 *    실제 저장소는 읽기 전용 확인 하나(S24c)만 하고, 끝에 실제 제품 파일 바이트가 그대로인지 본다.
 *
 * `authoringCases(lib, { cliPath })` 를 export 한다 — 변이 검사가 같은 반례를 변이 lib 으로 다시 돌린다.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..')
export const LIB_PATH = join(ROOT, 'scripts/lib/magazine-direct-spec-source-authoring.mjs')
export const CLI_PATH = join(ROOT, 'scripts/magazine-direct-spec-source-authoring.mjs')
const FIXTURE = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')
const fx = () => JSON.parse(readFileSync(FIXTURE, 'utf8'))

const TMPS = []
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), `dssa-${p}-`)); TMPS.push(d); return d }
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

const GV = 'g-20261015-aaaaaa'
const OLD_GV = 'g-20260923-bbbbbb'
const SLUG = 'dssa-target'
const INTENT = 'I-DSSA-01'
const MANIFEST = 'sha256:dssa-g8-manifest'
const AS_OF = '2026-10-16T09:00:00+09:00'
const AT = '2026-10-16T10:00:00+09:00'
const REL = [
  ['I-R1', 'rel-a', 'DIRECT_NEXT', '다음 질문으로 이어진다'],
  ['I-R2', 'rel-b', 'SAME_EXPERIENCE', '같은 밤 경험이다'],
  ['I-R3', 'rel-c', 'ACTION_OR_CONTEXT', '생활 조정으로 이어진다'],
  ['I-R4', 'rel-d', 'BRIDGE_DISCOVERY', '다른 영역의 질문이다'],
]

function queueRow(over = {}) {
  const { directSpecMode: _d, ...q } = fx().queueItem
  return { ...q, day: 9101, slug: SLUG, intentId: INTENT, g8ManifestHash: MANIFEST, ...over }
}

/** 합성 세계 — 제품 저장소 · G8 장부 · 연구 루트. mutate 로 반례 상태를 만든다 */
export function makeWorld(mutate = {}) {
  const base = tmp('world')
  const repo = join(base, 'repo'); const admission = join(base, 'admission'); const research = join(base, 'research')
  const graph = {
    graphVersion: GV,
    schemaVersion: { intent: 'intent/2', edge: 'edge/3', mapping: 'mapping/2', manifest: 'manifest/1' },
    contentHash: { intents: 'i0000000000000aa', edges: 'e0000000000000aa', mappings: 'm0000000000000aa', combined: 'c0000000000000aa' },
    generatedAt: '2026-10-15T00:00:00.000Z',
    edges: REL.map(([to, , slot, reason], i) => ({ id: `E-${i + 1}`, from: INTENT, to, type: 'NEXT', slot, anchor: 'a', reason,
      placement: 'FOOTER', priority: i + 1, fromCluster: 'sleep', toCluster: 'sleep', active: false })),
    mappings: REL.map(([intent, slug]) => ({ intent, slug, cluster: 'sleep' })),
    intents: [{ id: INTENT, cluster: 'sleep', board: 'menopause' }, ...REL.map(([id]) => ({ id, cluster: 'sleep', board: 'menopause' }))],
  }
  mutate.graph?.(graph)
  const exportHash = mutate.exportHash ?? createHash('sha256').update(JSON.stringify(graph)).digest('hex').slice(0, 16)
  const gdir = join(repo, 'src/content/magazine/graph'); mkdirSync(gdir, { recursive: true })
  writeFileSync(join(gdir, 'current.ts'), `// test\nexport { GRAPH, EXPORT_HASH } from './${mutate.pointer ?? GV}'\n`)
  writeFileSync(join(gdir, `${mutate.pointer ?? GV}.ts`), `import type { MagazineGraph } from './types'\n\nexport const GRAPH: MagazineGraph = ${JSON.stringify(graph, null, 2)} as const\n\n/** test */\nexport const EXPORT_HASH = '${exportHash}'\n`)
  const record = Object.fromEntries(REL.map(([, slug]) => [slug, { title: slug, description: 'd', cluster: 'sleep', publishedAt: '2026-10-01' }]))
  mutate.articles?.(record)
  mkdirSync(join(repo, 'src/content/magazine'), { recursive: true })
  writeFileSync(join(repo, 'src/content/magazine/articles.ts'), `const MAGAZINE_ARTICLE_RECORD = ${JSON.stringify(record, null, 2)}\n`)
  const queue = [queueRow()]
  mutate.queue?.(queue)
  mkdirSync(join(repo, 'drafts/magazine'), { recursive: true })
  writeFileSync(join(repo, 'drafts/magazine/topic-queue.ts'), `export const TOPIC_QUEUE: TopicQueueItem[] = ${JSON.stringify(queue, null, 2)}\n`)
  const ledger = [{ schemaVersion: 'm3ledger/2', event: 'ADMITTED', intentId: INTENT, slug: SLUG, title: 't', cluster: 'sleep',
    directRelations: [], discoveryRelation: null, internalLinks: [], at: '2026-10-15T15:00:00+09:00' }]
  mutate.ledger?.(ledger)
  const slugs = { [INTENT]: SLUG }
  mutate.slugs?.(slugs)
  mkdirSync(join(admission, 'contract'), { recursive: true })
  writeFileSync(join(admission, 'contract/m3-state.jsonl'), ledger.map((x) => JSON.stringify(x)).join('\n') + (ledger.length ? '\n' : ''))
  writeFileSync(join(admission, 'contract/m3-slug-manifest.json'), JSON.stringify({ slugs }, null, 2))
  const rmanifest = { graphVersion: OLD_GV, contentHash: { intents: graph.contentHash.intents, edges: 'e-old', mappings: 'm-old', combined: 'c-old' } }
  mutate.researchManifest?.(rmanifest)
  mkdirSync(join(research, 'contract/build/current'), { recursive: true })
  writeFileSync(join(research, 'contract/build/current/manifest.json'), JSON.stringify(rmanifest))
  writeFileSync(join(research, 'contract/build/current/intents.jsonl'), `${JSON.stringify({ intentId: INTENT, primaryQuery: '잠 설친 다음 날', audienceSituation: '밤에 깬다', answerScope: '생활 조정', exclusions: ['진단'] })}\n`)
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

const sourceFile = (outRoot) => join(outRoot, 'drafts/magazine/article-spec-source', `${GV}.json`)

export function authoringCases(lib, { cliPath = CLI_PATH } = {}) {
  const prepare = (w, extra = {}) => lib.prepareCandidate({ repoRoot: w.repo, admissionRoot: w.admission, slug: SLUG, asOf: AS_OF, ...extra })
  const ready = (w) => { const r = prepare(w); assert.equal(r.ok, true, r.why); return fill(r.candidate) }
  const approve = (w, c, extra = {}) => lib.approveCandidate({ candidate: c, approver: '창업자', at: AT, confirmCandidateHash: lib.candidateHashOf(c),
    repoRoot: w.repo, admissionRoot: w.admission, outRoot: join(w.base, 'out'), ...extra })
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
      assert.ok(c.unresolvedFields.includes('node.readerQuestion') && c.unresolvedFields.includes('hero.alt') && c.unresolvedFields.includes('node.ctaLabel'))
      for (const p of ['readerQuestion', 'outline', 'hubPath', 'ctaLabel', 'safetyConstraints']) assert.equal(c.entry.node[p], null, `prepare 가 ${p} 를 지어냈다`)
      assert.deepEqual(c.entry.hero, { alt: null, scene: null }); assert.equal(c.entry.publication.publishAt, null)
      assert.equal(existsSync(join(w.base, 'out')), false)
    }],
    ['S02 graphVersion 불일치(pointer≠bundle) · EXPORT_HASH 불일치 → blocker', () => {
      assert.ok(blockersOf(makeWorld({ graph: (g) => { g.graphVersion = OLD_GV } })).includes('GRAPH_VERSION_MISMATCH'))
      assert.ok(blockersOf(makeWorld({ exportHash: '0000000000000000' })).includes('GRAPH_EXPORT_HASH_MISMATCH'))
    }],
    ['S03 연구 intent hash 불일치 → RESEARCH_INTENT_HASH_MISMATCH · 같으면 참고만(entry 불변)', () => {
      const w = makeWorld({ researchManifest: (m) => { m.contentHash.intents = 'different' } })
      const r = prepare(w, { researchDir: w.research })
      assert.equal(r.ok, false); assert.equal(r.code, 'RESEARCH_INTENT_HASH_MISMATCH')
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
        x.entry.relations = { direct: REL.slice(0, 3).map(([, slug, slot, reason]) => ({ slug, source: 'M-GRAPH', relationType: slot, reason })),
          discovery: { slug: 'rel-d', source: 'M-GRAPH', relationType: 'BRIDGE_DISCOVERY', reason: REL[3][3] } }
      } })
      const a = approve(w, c, { researchDir: w.research })
      assert.equal(a.ok, false); assert.equal(a.code, 'RELATIONS_INVALID'); assert.ok(a.problems.includes('RELATION_NOT_IN_PRODUCT_GRAPH'))
    }],
    ['S05 G8 ADMITTED 없음 → ADMISSION_ABSENT', () => {
      assert.ok(blockersOf(makeWorld({ ledger: (l) => { l.length = 0 } })).includes('ADMISSION_ABSENT'))
    }],
    ['S06 slug·intentId·manifest 불일치 → blocker / 승인 시 신원 편집 거부', () => {
      assert.ok(blockersOf(makeWorld({ ledger: (l) => { l[0].intentId = 'I-OTHER' } })).includes('ADMISSION_ABSENT'))
      assert.ok(blockersOf(makeWorld({ ledger: (l) => { l.push({ ...l[0], slug: 'other-slug' }) } })).includes('ADMISSION_IDENTITY_CROSSED'))
      assert.ok(blockersOf(makeWorld({ slugs: (s) => { s[INTENT] = 'other-slug' } })).includes('SLUG_UNBOUND'))
      assert.ok(blockersOf(makeWorld({ queue: (q) => { delete q[0].g8ManifestHash } })).includes('QUEUE_NOT_G8_ADMITTED'))
      assert.ok(blockersOf(makeWorld({ queue: (q) => { q.push({ ...q[0] }) } })).includes('QUEUE_ROW_DUPLICATE'))
      const w = makeWorld(); const c = fill(prepare(w).candidate, { edit: (x) => { x.entry.g8ManifestHash = 'sha256:forged' } })
      const a = approve(w, c); assert.equal(a.code, 'CANDIDATE_IDENTITY_EDITED')
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
      // 같은 3+1 규칙을 승인 단계의 관계 판정 함수에 직접 대 본다
      const st = { graph: w2.graph, articles: Object.keys({ 'rel-a': 1, 'rel-b': 1, 'rel-c': 1, 'rel-d': 1 }).map((slug) => ({ slug, publishedAt: '2026-10-01' })) }
      const j = lib.judgeRelations({ relations: c.entry.relations, ...st, intentId: INTENT, slug: SLUG, queueRow: queueRow(), atMs: Date.parse(AT) })
      assert.ok(j.problems.includes('RELATIONS_DIRECT_NOT_3'))
      const j2 = lib.judgeRelations({ relations: { direct: ready(w2).entry.relations.direct, discovery: null }, ...st, intentId: INTENT, slug: SLUG, queueRow: queueRow(), atMs: Date.parse(AT) })
      assert.ok(j2.problems.includes('RELATIONS_DISCOVERY_NOT_1'))
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
      assert.ok(r.candidate.relationEvidence.find((e) => e.slug === 'rel-b').target === 'UNREGISTERED')
      assert.ok(r.candidate.blockers.includes('RELATIONS_INSUFFICIENT'))
      const w2 = makeWorld(); const c = ready(w2)
      const w3 = makeWorld({ articles: (a) => { delete a['rel-b'] } })
      const a = lib.approveCandidate({ candidate: c, approver: '창업자', at: AT, confirmCandidateHash: lib.candidateHashOf(c),
        repoRoot: w3.repo, admissionRoot: w3.admission, outRoot: join(w3.base, 'out') })
      assert.equal(a.ok, false)
    }],
    ['S11 승인 시각보다 뒤에 공개되는 관계 글 → RELATION_TARGET_NOT_YET_PUBLIC', () => {
      const w = makeWorld({ articles: (a) => { a['rel-c'].publishAt = '2026-10-16T09:30:00+09:00' } })
      const r = prepare(w)   // as-of 09:00 에는 아직 비공개 → 후보 부족
      assert.ok(r.candidate.blockers.includes('RELATIONS_INSUFFICIENT'))
      const w2 = makeWorld({ articles: (a) => { a['rel-c'].publishAt = '2026-10-16T08:00:00+09:00' } })
      const c = ready(w2)
      const a = approve(w2, c, { at: '2026-10-16T07:59:59+09:00' })
      assert.equal(a.ok, false); assert.ok(a.problems.includes('RELATION_TARGET_NOT_YET_PUBLIC'))
    }],
    ['S12 현재 graph 에서 증명되지 않는 M-GRAPH 관계(reason 변경) · HUB → 거부', () => {
      const w = makeWorld(); const c = ready(w); c.entry.relations.direct[1].reason = '사람이 지어낸 이유'
      assert.ok(approve(w, c).problems.includes('RELATION_NOT_IN_PRODUCT_GRAPH'))
      const c2 = ready(w); c2.entry.relations.discovery = { ...c2.entry.relations.discovery, source: 'HUB' }
      assert.ok(approve(w, c2).problems.includes('RELATION_HUB_UNPROVABLE'))
    }],
    ['S13 미해결 필드 → CANDIDATE_UNRESOLVED', () => {
      const w = makeWorld(); const a = approve(w, prepare(w).candidate)
      assert.equal(a.code, 'CANDIDATE_UNRESOLVED'); assert.ok(a.problems.includes('node.readerQuestion'))
      const c = ready(w); c.entry.hero.scene = null
      assert.ok(approve(w, c).problems.includes('hero.scene'))
    }],
    ['S14 빈 승인자 · 기계 승인자 → 거부', () => {
      const w = makeWorld(); const c = ready(w)
      assert.equal(approve(w, c, { approver: '  ' }).code, 'APPROVER_REQUIRED')
      for (const m of ['machine:codex', 'codex', 'Claude Code', 'bot-1', 'ci', 'system:auto']) assert.equal(approve(w, c, { approver: m }).code, 'APPROVER_MACHINE', m)
      assert.equal(approve(w, c, { at: '2026-10-16 10:00' }).code, 'APPROVED_AT_INVALID')
    }],
    ['S15 후보 해시 불일치 → CANDIDATE_HASH_MISMATCH', () => {
      const w = makeWorld(); const c = ready(w)
      assert.equal(approve(w, c, { confirmCandidateHash: c.candidateHash }).code, 'CANDIDATE_HASH_MISMATCH')  // prepare 때 해시 ≠ 채운 뒤 해시
    }],
    ['S16 prepare 뒤 graph·queue·articles·G8 변경 → STATE_CHANGED', () => {
      for (const [label, mut] of [
        ['queue', (w) => { const t = readFileSync(join(w.repo, 'drafts/magazine/topic-queue.ts'), 'utf8'); writeFileSync(join(w.repo, 'drafts/magazine/topic-queue.ts'), t.replace('"whyNow": "', '"whyNow": "바뀜 ')) }],
        ['articles', (w) => { const p = join(w.repo, 'src/content/magazine/articles.ts'); writeFileSync(p, readFileSync(p, 'utf8').replace('"title": "rel-a"', '"title": "rel-a 개정"')) }],
        ['graph', (w) => { const n = makeWorld({ graph: (g) => { g.contentHash.edges = 'e-new' } }); for (const f of ['current.ts', `${GV}.ts`]) writeFileSync(join(w.repo, 'src/content/magazine/graph', f), readFileSync(join(n.repo, 'src/content/magazine/graph', f))) }],
        ['G8', (w) => { const p = join(w.admission, 'contract/m3-state.jsonl'); writeFileSync(p, readFileSync(p, 'utf8').replace('15:00:00', '15:00:01')) }],
      ]) {
        const w = makeWorld(); const c = ready(w); mut(w)
        const a = approve(w, c)
        assert.equal(a.code, 'STATE_CHANGED', `${label}: ${a.code} ${a.why}`)
      }
    }],
    ['S17 runtime output → RUNTIME_OUTPUT_FORBIDDEN · 쓰기 0', () => {
      const w = makeWorld(); const c = ready(w)
      const rt = join(w.base, 'soransoran-magazine-runtime')
      const a = approve(w, c, { outRoot: rt })
      assert.equal(a.code, 'RUNTIME_OUTPUT_FORBIDDEN'); assert.equal(existsSync(rt), false)
      assert.equal(approve(w, c, { outRoot: null }).code, 'OUT_ROOT_REQUIRED')
    }],
    ['S18 기존 다른 entry 보존 · S19 같은 승인 멱등 · S20 다른 바이트 충돌', () => {
      const w = makeWorld(); const c = ready(w); const out = join(w.base, 'out'); const f = sourceFile(out)
      const other = { status: 'APPROVED', approvedBy: '창업자', approvedAt: '2026-10-15T10:00:00+09:00', g8ManifestHash: 'sha256:o',
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
    ['S18b 승인 artifact 는 실제 source 관문을 통과한다 (judgeDirectSpecSource)', async () => {
      const src = await import(pathToFileURL(join(ROOT, 'scripts/lib/magazine-direct-spec-source.mjs')).href)
      const w = makeWorld(); const c = ready(w); const out = join(w.base, 'out')
      assert.equal(approve(w, c).written, true)
      const j = src.judgeDirectSpecSource({ queueItem: queueRow(), draftsDir: join(out, 'drafts/magazine'), expectedGraphVersion: GV })
      assert.equal(j.ok, true, j.why); assert.equal(j.evidence.approvalStatus, 'APPROVED')
    }],
    ['S18c NO_IMAGE 큐 행에 hero 내용 → 관문 거부(GATE_REJECTED) · 쓰기 0', () => {
      const w = makeWorld({ queue: (q) => { q[0].imageMode = 'NO_IMAGE' } })
      const r = prepare(w); assert.equal(r.candidate.entry.hero, null)
      const c = fill(r.candidate, { edit: (x) => { x.entry.hero = fx().hero } })
      const a = approve(w, c); assert.equal(a.code, 'GATE_REJECTED'); assert.equal(existsSync(sourceFile(join(w.base, 'out'))), false)
    }],
    ['S18d 후보에 승인 필드 위조 → CANDIDATE_APPROVAL_FORGED', () => {
      const w = makeWorld(); const c = ready(w); c.entry.approvedBy = '창업자'
      assert.equal(approve(w, c).code, 'CANDIDATE_APPROVAL_FORGED')
      const c2 = ready(w); c2.entry.node.status = 'APPROVED'
      assert.equal(approve(w, c2).code, 'CANDIDATE_APPROVAL_FORGED')
    }],
    ['S21a 살아 있는 잠금 → LOCK_BUSY · 쓰기 0', () => {
      const w = makeWorld(); const c = ready(w); const f = sourceFile(join(w.base, 'out'))
      mkdirSync(dirname(f), { recursive: true }); writeFileSync(`${f}.lock`, JSON.stringify({ pid: process.pid }))
      assert.equal(approve(w, c).code, 'LOCK_BUSY'); assert.equal(existsSync(f), false)
    }],
    ['S21b 실제 다중 프로세스 동시 승인 → 쓴 writer 정확히 1', async () => {
      const w = makeWorld(); const c = ready(w); const cf = join(w.base, 'candidate.json'); writeFileSync(cf, JSON.stringify(c))
      const out = join(w.base, 'out'); const hash = lib.candidateHashOf(c)
      const run = () => new Promise((res) => {
        const p = spawn(process.execPath, [cliPath, 'approve', '--candidate', cf, '--approver', '창업자', '--at', AT, '--confirm-candidate-hash', hash,
          '--repo', w.repo, '--admission-root', w.admission, '--out-root', out], { stdio: ['ignore', 'pipe', 'pipe'] })
        let s = ''; p.stdout.on('data', (d) => { s += d })
        p.on('close', (code) => { try { res({ code, r: JSON.parse(s) }) } catch { res({ code, r: null }) } })
      })
      const results = await Promise.all(Array.from({ length: 8 }, run))
      const writers = results.filter((x) => x.r?.written === true).length
      COUNTS.concurrent = { processes: 8, writers, idempotent: results.filter((x) => x.r?.ok && x.r.written === false).length,
        lockBusy: results.filter((x) => x.r?.code === 'LOCK_BUSY').length }
      assert.equal(writers, 1, JSON.stringify(results.map((x) => x.r?.code ?? x.r?.written)))
      assert.ok(results.every((x) => x.r && (x.r.ok || x.r.code === 'LOCK_BUSY')), JSON.stringify(results.map((x) => x.r)))
      assert.equal(JSON.parse(readFileSync(sourceFile(out), 'utf8')).entries.length, 1)
    }],
    ['S22 쓰기 중 실패·급사 → 기존 artifact 불변 · 다음 승인은 잠금 회수 후 성공', () => {
      const w = makeWorld(); const out = join(w.base, 'out'); const f = sourceFile(out)
      const keep = `${JSON.stringify({ schema: 'magazine-article-spec-source/1', graphVersion: GV, entries: [] }, null, 2)}\n`
      mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, keep)
      const c = ready(w)
      const a = approve(w, c, { hooks: { beforeRename: () => { throw new Error('주입된 쓰기 실패') } } })
      assert.equal(a.code, 'ARTIFACT_WRITE_FAILED'); assert.equal(readFileSync(f, 'utf8'), keep)
      assert.deepEqual(readdirSync(dirname(f)).filter((x) => x.includes('.tmp-')), [])
      // 급사 — 자식이 rename 직전에 죽는다 (잠금·임시 파일이 남는다)
      const cf = join(w.base, 'c.json'); writeFileSync(cf, JSON.stringify(c))
      const driver = `const lib = await import(${JSON.stringify(pathToFileURL(LIB_PATH).href)}); const c = JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(cf)}, 'utf8'));
lib.approveCandidate({ candidate: c, approver: '창업자', at: ${JSON.stringify(AT)}, confirmCandidateHash: lib.candidateHashOf(c), repoRoot: ${JSON.stringify(w.repo)}, admissionRoot: ${JSON.stringify(w.admission)}, outRoot: ${JSON.stringify(out)}, hooks: { beforeRename: () => process.exit(9) } })`
      const k = spawnSync(process.execPath, ['--input-type=module', '-e', driver.replace(LIB_PATH, LIB_PATH)], { encoding: 'utf8' })
      assert.equal(k.status, 9, k.stderr); assert.equal(readFileSync(f, 'utf8'), keep, '급사가 기존 artifact 를 바꿨다')
      assert.ok(existsSync(`${f}.lock`), '급사 반례 준비 실패 — 잠금이 남지 않았다')
      const after = approve(w, c); assert.equal(after.ok, true, after.why); assert.equal(after.written, true)
    }],
    ['S23 승인 전 source artifact 0 — prepare·거부된 approve 뒤에도 파일 없음', () => {
      const w = makeWorld(); const out = join(w.base, 'out')
      const r = prepare(w, { researchDir: w.research }); approve(w, r.candidate); approve(w, fill(r.candidate), { approver: 'bot' })
      assert.equal(existsSync(sourceFile(out)), false)
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
    ['S24c 실제 저장소 prepare(읽기 전용) — 제품 graph 무결성 통과 · G8 행이 없으면 blocker · 쓰기 0', () => {
      const r = lib.prepareCandidate({ repoRoot: ROOT, admissionRoot: tmp('no-admission'), slug: 'palpitations-menopause', asOf: AS_OF })
      assert.equal(r.ok, true, r.why)
      assert.ok(!r.candidate.blockers.includes('GRAPH_EXPORT_HASH_MISMATCH') && !r.candidate.blockers.includes('GRAPH_VERSION_MISMATCH'), r.candidate.blockers.join(','))
      assert.ok(r.candidate.blockers.includes('QUEUE_NOT_G8_ADMITTED'))
    }],
    ['(수치) 승인·쓰기·외부 호출', () => { authoringCases.counts = COUNTS }],
  ]
}

async function main() {
  const lib = await import(pathToFileURL(LIB_PATH).href)
  const productFiles = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts', 'src/content/magazine/graph/current.ts']
  const before = productFiles.map((p) => readFileSync(join(ROOT, p), 'utf8'))
  const realSource = join(ROOT, 'drafts/magazine/article-spec-source')
  const realSourceBefore = existsSync(realSource)
  let pass = 0; let fail = 0
  for (const [name, fn] of authoringCases(lib)) {
    try { await fn(); pass++; console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name} — ${e.message.split('\n')[0]}`) }
  }
  const after = productFiles.map((p) => readFileSync(join(ROOT, p), 'utf8'))
  const unchanged = before.every((b, i) => b === after[i]) && existsSync(realSource) === realSourceBefore
  if (unchanged) { pass++; console.log('PASS S24d 실제 제품 queue·articles·graph 바이트 불변 · 실제 source artifact 생성 0') }
  else { fail++; console.log('FAIL S24d 실제 제품 파일 또는 source artifact 가 바뀌었다') }
  console.log(`\n수치: ${JSON.stringify(authoringCases.counts ?? {})}`)
  console.log(`\nDIRECT_SPEC source 작성 검사: ${pass} pass, ${fail} fail`)
  process.exit(fail ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-direct-spec-source-authoring-check.mjs')) await main()
