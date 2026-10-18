#!/usr/bin/env node
/**
 * M-GRAPH 결정적 build · readiness 반례 검사.
 *
 *   node scripts/magazine-graph-build-check.mjs [--old-input <2026-10-15-family> --new-input <2026-10-17-money-work> --real-product <제품 루트>]
 *
 * 합성 fixture 만 쓴다(임시 폴더). 운영 연구 폴더 · 제품 graph 파일을 쓰지 않는다.
 * 실제 입력을 주면 lifecycle 계약 기준 재현성 증거를 **추가로** 본다(읽기 전용) — old 거부 11건 · new 2회 동일 · semantic delta whitelist · readiness.
 *
 * 🔴 변이 하네스가 lib · CLI 사본을 주입한다: MGRAPH_BUILD_LIB · MGRAPH_BUILD_CLI (없으면 저장소 파일).
 *    적재 실패는 `LOAD_ERROR` 로 따로 알린다 — 검출로 세지 않게 하기 위해서다.
 * 마지막 줄: `RESULT pass=<n> fail=<n>` · 실패가 있으면 exit 1
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ensureCluster, readControl } from './lib/magazine-graph-control-edit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = process.env.MGRAPH_BUILD_LIB ?? join(HERE, 'lib/magazine-graph-build.mjs')
const CLI = process.env.MGRAPH_BUILD_CLI ?? join(HERE, 'magazine-graph-build.mjs')
let lib
try { lib = await import(pathToFileURL(LIB).href) } catch (e) {
  process.stdout.write(`LOAD_ERROR ${e.message}\n`); process.exit(3)
}

const argv = process.argv.slice(2)
const argOf = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1] }

let pass = 0, failN = 0
const results = []
const test = (name, fn) => {
  // 🔴 실패 문구는 자른다 — 산출 전체를 비교한 실패가 수 MB 를 찍으면 하네스가 RESULT 줄을 못 받는다
  try { fn(); pass++; results.push(`  ✅ ${name}`) } catch (e) { failN++; results.push(`  ❌ ${name} — ${String(e.message).slice(0, 400)}`) }
}
const eq = (a, b, why) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${why}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`) }
const ok = (v, why) => { if (!v) throw new Error(why) }
const sha = (s) => createHash('sha256').update(s).digest('hex')
const TMP = mkdtempSync(join(tmpdir(), 'mgraph-build-check-'))

// ── 합성 fixture ──
// X: 미등록 PASS(fam). 근거 — P1 NEXT · P2 SIBLING · D BRIDGE(rel) · reverse P1→X.
// 누출 미끼 — H(HOLD·공개) · U(PASS·미래 공개) · W(빈 이유) · 제목만 비슷한 T(edge 없음).
// Y: 미등록 PASS(off cluster). Z: 미등록 PASS(fam) edge 0.
const intent = (intentId, magazineCluster, extra = {}) => ({ intentId, primaryQuery: `${intentId} 질문`, territoryId: 'T3', magazineCluster,
  audienceSituation: 's', policyScope: 'ALLOWED', policyScopeWhy: 'w', verificationProfile: 'STANDARD', profileSpec: {},
  automationDecision: 'PASS', topicVerdict: 'AUTO_READY_TOPIC', verdictWhy: 'v', runtimeState: 'UNPUBLISHED',
  evidence: { refs: 2 }, existingAssetRelation: '없음', ...extra })
const canon = (intentId, slugs = []) => ({ intentId, answerScope: 'a', exclusions: [], existingSlugs: slugs.map((slug) => ({ slug, coverage: 'ANSWERS', cluster: 'fam' })) })
const edge = (edgeId, fromIntentId, toIntentId, relationType, placement, extra = {}) => ({ edgeId, fromIntentId, toIntentId, relationType,
  readerReason: `${fromIntentId}에서 ${toIntentId}로 가는 이유`, anchorLabel: `${toIntentId} 보기`, placement, priority: 1,
  reciprocalPolicy: 'ONE_WAY', reciprocalGroupId: null, backlinkPlan: null, reciprocalWhy: null, ...extra })

function baseWorld() {
  return {
    automation: [intent('I-X', 'fam'), intent('I-P1', 'fam'), intent('I-P2', 'fam'), intent('I-P3', 'fam'), intent('I-D', 'rel'),
      intent('I-H', 'fam', { automationDecision: 'HOLD' }), intent('I-U', 'fam'), intent('I-W', 'fam'), intent('I-T', 'fam'),
      intent('I-Y', 'off'), intent('I-Z', 'fam')],
    canonical: [canon('I-X'), canon('I-P1', ['p1']), canon('I-P2', ['p2']), canon('I-P3', ['p3']), canon('I-D', ['d']),
      canon('I-H', ['h']), canon('I-U', ['u']), canon('I-W', ['w']), canon('I-T'), canon('I-Y'), canon('I-Z')],
    graph: [
      edge('E-0001', 'I-X', 'I-P1', 'NEXT_QUESTION', 'FOOTER_NEXT', { reverseEdgeId: 'E-0007' }),
      edge('E-0002', 'I-X', 'I-P2', 'SIBLING', 'FOOTER_SIBLING'),
      edge('E-0003', 'I-X', 'I-D', 'BRIDGE', 'FOOTER_BRIDGE'),
      edge('E-0004', 'I-X', 'I-H', 'NEXT_QUESTION', 'FOOTER_NEXT'),
      edge('E-0005', 'I-X', 'I-U', 'SIBLING', 'FOOTER_SIBLING'),
      edge('E-0006', 'I-X', 'I-W', 'ACTION', 'FOOTER_SIBLING', { readerReason: '' }),
      edge('E-0007', 'I-P1', 'I-X', 'NEXT_QUESTION', 'FOOTER_NEXT', { reverseEdgeId: 'E-0001' }),
      edge('E-0008', 'I-P1', 'I-P2', 'SIBLING', 'FOOTER_SIBLING'),
      edge('E-0009', 'I-Y', 'I-P3', 'NEXT_QUESTION', 'FOOTER_NEXT'),
      edge('E-0010', 'I-Y', 'I-P1', 'SIBLING', 'FOOTER_SIBLING'),
      edge('E-0011', 'I-Y', 'I-D', 'BRIDGE', 'FOOTER_BRIDGE'),
      edge('E-0012', 'I-X', '/community/free', 'COMMUNITY', 'CTA_END'),
    ],
    published: ['p1', 'p2', 'p3', 'd', 'h', 'w'].map((slug) => ({ slug, assetState: 'LIVE' })),
    queued: [],
  }
}
const RESOLVER = `export const IMPLEMENTED_SURFACES = [\n  'CTA_END',\n  'FOOTER_NEXT',\n  'FOOTER_SIBLING',\n  'FOOTER_BRIDGE',\n] as const
export const FOOTER_SURFACES = ['FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE'] as const
export const MAGAZINE_RELATION_TYPES = [\n  'PREREQUISITE',\n  'NEXT_QUESTION',\n  'SIBLING',\n  'SERIES',\n  'BRIDGE',\n  'ACTION',\n  'COMMUNITY',\n] as const\n`
const controlText = ({ enabled = true, clusters = ['fam', 'rel'], bridge = true, tripped = false } = {}) => `export const CONTROL: MagazineGraphControl = {
  graphVersion: 'g-00000000-000000',
  enabled: ${enabled},
  enabledClusters: ${JSON.stringify(clusters)},
  surfaces: {"CTA_END":true,"FOOTER_NEXT":true,"FOOTER_SIBLING":true,"FOOTER_BRIDGE":${bridge}},
  killSwitch: {"tripped":${tripped},"trippedAt":null,"trippedBy":null,"reason":null},
  previousGraphVersion: null,
} as const\n`
const art = (cluster, publishAt) => ({ title: 't', cluster, publishedAt: publishAt.slice(0, 10), status: 'SCHEDULED', publishAt })
const BASE_ARTICLES = {
  p1: art('fam', '2026-10-01T10:30:00+09:00'), p2: art('fam', '2026-10-02T10:30:00+09:00'), p3: art('fam', '2026-10-03T10:30:00+09:00'),
  d: art('rel', '2026-10-04T10:30:00+09:00'), h: art('fam', '2026-10-05T10:30:00+09:00'),
  u: art('fam', '2026-12-31T10:30:00+09:00'), w: art('fam', '2026-10-06T10:30:00+09:00'),
}
const articlesText = (extra = {}) => `export const MAGAZINE_ARTICLE_RECORD: Record<string, MagazineArticle> = ${JSON.stringify({ ...BASE_ARTICLES, ...extra }, null, 2)}\n`
const ARTICLES = articlesText()
const ADMISSION = { slugManifest: JSON.stringify({ slugs: { 'I-X': 'x-slug' } }), ledger: '' }

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const inputTextsOf = (w) => ({
  'g4-intents-canonical.jsonl': jsonl(w.canonical), 'g4-automation-2026-09-23.jsonl': jsonl(w.automation),
  'g5-graph-2026-09-23.jsonl': jsonl(w.graph), 'assets-published.jsonl': jsonl(w.published), 'assets-queue.jsonl': jsonl(w.queued),
})
const EFF = '2026-10-15T13:00:00+09:00'
const GEN = '2026-10-15T04:43:55.080Z'
const build = ({ world = baseWorld(), control = controlText(), admission = ADMISSION, effectiveAt = EFF, generatedAt = GEN, articles = ARTICLES } = {}) =>
  lib.buildAll({ inputTexts: inputTextsOf(world), productTexts: { resolver: RESOLVER, control, articles },
    admissionTexts: admission, effectiveAt, generatedAt })
const row = (b, id) => b.readiness.rows.find((r) => r.intentId === id)

// ── 기준 ──
test('기준 — X 는 direct 2 · discovery 1 · reverse 1 로 GRAPH_READY', () => {
  const x = row(build(), 'I-X')
  eq([x.direct.count, x.discovery.count, x.reverse.count, x.status], [2, 1, 1, 'GRAPH_READY'], 'X')
  eq(x.direct.targets.map((t) => t.slug), ['p1', 'p2'], 'direct 대상')
  eq(x.discovery.targets.map((t) => t.slug), ['d'], 'discovery 대상')
})

// ── 반례 1 — 실행 날짜(벽시계)가 바뀌어도 effectiveAt 이 같으면 불변 ──
test('반례1 — 벽시계를 2031년으로 옮겨도 graphVersion · contentHash · semanticHash 가 같다', () => {
  const a = build()
  const RealDate = Date
  const shifted = RealDate.parse('2031-03-03T03:03:03.000Z')
  globalThis.Date = class extends RealDate { constructor(...x) { x.length ? super(...x) : super(shifted) } static now() { return shifted } }
  let b
  try { b = build() } finally { globalThis.Date = RealDate }
  eq([b.graphVersion, b.manifest.contentHash, b.manifest.semanticHash], [a.graphVersion, a.manifest.contentHash, a.manifest.semanticHash], '시각 의존')
  eq(b.files, a.files, '산출 바이트')
  ok(a.graphVersion.startsWith('g-20261015-'), `graphVersion 날짜는 effectiveAt 의 KST 날짜다: ${a.graphVersion}`)
})
test('반례1b — effectiveAt 의 KST 날짜만 graphVersion 날짜를 바꾼다(UTC 날짜 아님)', () => {
  const a = build({ effectiveAt: '2026-10-16T08:59:59+09:00' })
  ok(a.graphVersion.startsWith('g-20261016-'), `KST 날짜: ${a.graphVersion}`)
  eq(a.manifest.contentHash, build().manifest.contentHash, 'contentHash 는 날짜와 무관')
})

// ── 반례 2 — generatedAt 만 바뀌면 의미 불변 ──
test('반례2 — generatedAt 만 바꾸면 graphVersion · contentHash · semanticHash 불변, EXPORT_HASH(무결성)만 바뀐다', () => {
  const a = build(), b = build({ generatedAt: '2027-01-01T00:00:00.000Z' })
  eq([b.graphVersion, b.manifest.contentHash, b.manifest.semanticHash], [a.graphVersion, a.manifest.contentHash, a.manifest.semanticHash], 'generatedAt 의존')
  ok(a.manifest.exportHash !== b.manifest.exportHash, 'EXPORT_HASH 는 bundle 무결성 해시라 generatedAt 을 포함해야 한다')
  eq(b.readiness, a.readiness, 'readiness 는 generatedAt 과 무관')
})
test('반례2b — 시각 형식이 모호하면 거부(벽시계로 대신하지 않는다)', () => {
  for (const [k, v, code] of [['effectiveAt', '2026-10-15T13:00:00', 'EFFECTIVE_AT_INVALID'], ['effectiveAt', null, 'EFFECTIVE_AT_INVALID'],
    ['generatedAt', '2026-10-15T04:43:55Z', 'GENERATED_AT_INVALID'], ['generatedAt', null, 'GENERATED_AT_INVALID']]) {
    let code2 = null
    try { build({ [k]: v }) } catch (e) { code2 = e.code }
    eq(code2, code, `${k}=${v}`)
  }
})
test('반례2c — 입력 파일이 없으면 다른 위치로 대신 읽지 않고 INPUT_MISSING', () => {
  const t = inputTextsOf(baseWorld()); delete t['assets-queue.jsonl']
  let code = null
  try { lib.buildAll({ inputTexts: t, productTexts: { resolver: RESOLVER, control: controlText(), articles: ARTICLES }, admissionTexts: ADMISSION, effectiveAt: EFF, generatedAt: GEN }) } catch (e) { code = e.code }
  eq(code, 'INPUT_MISSING', '누락 입력')
})

// ── CLI 반례 3 · 4 · 5 ──
const writeTree = (root, files) => { for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) } }
const treeHash = (root) => {
  const out = []
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : out.push(`${relative(root, p)}:${sha(readFileSync(p))}`) } }
  walk(root)
  return sha(out.join('\n'))
}
const input1 = join(TMP, 'in1'), input2 = join(TMP, 'deep/other/in2'), product = join(TMP, 'product'), adm = join(TMP, 'adm')
writeTree(input1, inputTextsOf(baseWorld()))
writeTree(input2, inputTextsOf(baseWorld()))
writeTree(product, { 'src/lib/magazine-graph.ts': RESOLVER, 'src/content/magazine/graph/control.ts': controlText(), 'src/content/magazine/articles.ts': ARTICLES,
  'src/content/magazine/graph/current.ts': "export { GRAPH, EXPORT_HASH } from './g-00000000-000000'\n",
  '.git/HEAD': 'ref: refs/heads/main\n', 'scripts/tool.mjs': '// x\n', 'docs/note.md': '# n\n' })
writeTree(adm, { 'contract/m3-slug-manifest.json': ADMISSION.slugManifest, 'contract/m3-state.jsonl': '' })
const runCli = (inputRoot, outDir, extra = []) => {
  try {
    const out = execFileSync(process.execPath, [CLI, '--input-root', inputRoot, '--product-root', product, '--effective-at', EFF,
      '--generated-at', GEN, '--out-dir', outDir, '--admission-root', adm, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, json: JSON.parse(out) }
  } catch (e) { return { code: e.status, json: (() => { try { return JSON.parse(e.stdout) } catch { return null } })() } }
}
const graphDir = join(product, 'src/content/magazine/graph')
const productBefore = treeHash(product)
const r1 = runCli(input1, join(TMP, 'out1'))
const r2 = runCli(input1, join(TMP, 'out2'))
const r3 = runCli(input2, join(TMP, 'x/y/out3'))
test('반례3 — 같은 입력 2회 CLI 산출물 전체가 byte-identical', () => {
  eq([r1.code, r2.code], [0, 0], `CLI 종료 코드 ${JSON.stringify(r1.json)}`)
  eq(treeHash(join(TMP, 'out1')), treeHash(join(TMP, 'out2')), '두 회차 트리 해시')
})
test('반례3b — 같은 폴더에 다시 돌리면 UNCHANGED, 내용이 다른 같은 판 폴더는 덮어쓰지 않는다', () => {
  const again = runCli(input1, join(TMP, 'out1'))
  eq([again.code, again.json?.result], [0, 'UNCHANGED'], '재실행')
  const stage = join(TMP, 'out1', r1.json.graphVersion)
  writeFileSync(join(stage, 'readiness.json'), '{}\n')
  const conflict = runCli(input1, join(TMP, 'out1'))
  eq([conflict.code, conflict.json?.code], [1, 'OUT_STAGE_CONFLICT'], '충돌')
  eq(readFileSync(join(stage, 'readiness.json'), 'utf8'), '{}\n', '충돌 시 기존 파일 보존')
})
test('반례4 — build 만으로 제품 current.ts · control.ts 변경 0, 판 전환 파일을 쓰지 않는다', () => {
  eq(treeHash(product), productBefore, '제품 트리')
  const files = readdirSync(join(TMP, 'out2', r2.json.graphVersion))
  ok(!files.includes('current.ts') && !files.includes('control.ts'), `산출에 판 전환 파일: ${files}`)
  eq(r2.json.result, 'WRITTEN', 'result')
})
test('반례4b — out-dir 가 제품 graph 폴더 · src 아래 · 입력 아래면 거부하고 아무것도 쓰지 않는다', () => {
  for (const out of [graphDir, join(product, 'src/tmp-out'), join(input1, 'out')]) {
    const r = runCli(input1, out)
    eq([r.code, r.json?.code], [1, 'OUT_DIR_FORBIDDEN'], out)
  }
  const looksLikeGraph = join(TMP, 'fake-graph'); writeTree(looksLikeGraph, { 'current.ts': 'x', 'control.ts': 'y' })
  const r = runCli(input1, looksLikeGraph)
  eq([r.code, r.json?.code], [1, 'OUT_DIR_FORBIDDEN'], 'current/control 가 있는 폴더')
  eq(treeHash(product), productBefore, '제품 트리')
  ok(!existsSync(join(input1, 'out')), '입력 아래에 썼다')
})
test('반례5 — input-root · out-dir 경로가 달라도 같은 입력이면 같은 의미 · 같은 바이트', () => {
  eq(r3.code, 0, 'CLI')
  eq([r3.json.graphVersion, r3.json.semanticHash], [r1.json.graphVersion, r1.json.semanticHash], '의미')
  // out1 은 반례3b 가 일부러 훼손했다 — 손대지 않은 out2 와 비교한다
  eq(treeHash(join(TMP, 'x/y/out3')), treeHash(join(TMP, 'out2')), '바이트(경로가 산출에 새지 않는다)')
})

// ── 반례 6 — 생산 최소선 ──
test('반례6 — direct 1 이면 GRAPH_READY=false (DIRECT_SHORT)', () => {
  const w = baseWorld(); w.graph = w.graph.filter((e) => e.edgeId !== 'E-0002')
  const x = row(build({ world: w }), 'I-X')
  eq([x.direct.count, x.graphReady, x.status], [1, false, 'GRAPH_INCOMPLETE'], 'X')
  ok(x.shortfall.includes('DIRECT_SHORT(1/2)'), x.shortfall.join(','))
})
test('반례6b — discovery 0 이면 GRAPH_READY=false (DISCOVERY_SHORT)', () => {
  const w = baseWorld(); w.graph = w.graph.filter((e) => e.edgeId !== 'E-0003')
  const x = row(build({ world: w }), 'I-X')
  eq([x.discovery.count, x.graphReady], [0, false], 'X')
  ok(x.shortfall.includes('DISCOVERY_SHORT(0/1)'), x.shortfall.join(','))
})
test('반례6c — 생산 최소(2+1)와 표시 목표(3+1)를 섞지 않는다: direct 4 근거면 count 4 · 표시 3', () => {
  const w = baseWorld()
  w.graph.push(edge('E-0013', 'I-X', 'I-P3', 'ACTION', 'FOOTER_SIBLING'))
  w.automation.push(intent('I-Q', 'fam')); w.canonical.push(canon('I-Q', ['p3b']))
  w.published.push({ slug: 'p3b', assetState: 'LIVE' })
  w.graph.push(edge('E-0014', 'I-X', 'I-Q', 'PREREQUISITE', 'FOOTER_SIBLING'))
  const arts = ARTICLES.replace('"w": {', '"p3b": {"title":"t","cluster":"fam","publishedAt":"2026-10-07","status":"SCHEDULED","publishAt":"2026-10-07T10:30:00+09:00"},\n  "w": {')
  const b = lib.buildAll({ inputTexts: inputTextsOf(w), productTexts: { resolver: RESOLVER, control: controlText(), articles: arts }, admissionTexts: ADMISSION, effectiveAt: EFF, generatedAt: GEN })
  const x = row(b, 'I-X')
  eq([x.direct.count, x.display.direct.length, x.status], [4, 3, 'GRAPH_READY'], 'X')
  eq(lib.READINESS_POLICY, { productionMinimum: { direct: 2, discovery: 1 }, displayTarget: { directMax: 3, discovery: 1 } }, '정책 숫자')
})

// ── 반례 7 — 약한 근거 · 미공개 · HOLD · control-off · 표면/cluster 꺼짐 누출 0 ──
test('반례7 — HOLD · 미래 공개 · 빈 이유 · 제목 유사(edge 없음)는 근거로 세지 않는다', () => {
  const x = row(build(), 'I-X')
  const counted = [...x.direct.targets, ...x.discovery.targets].map((t) => t.toIntentId)
  for (const leak of ['I-H', 'I-U', 'I-W', 'I-T']) ok(!counted.includes(leak), `${leak} 가 근거로 셌다`)
  const why = Object.fromEntries(x.rejected.map((r) => [r.toIntentId, r.why.join(',')]))
  ok(/AUTOMATION_READY_FALSE/.test(why['I-H']), `HOLD: ${why['I-H']}`)
  ok(/TARGET_NOT_PUBLIC/.test(why['I-U']), `미래: ${why['I-U']}`)
  ok(/WEAK_REASON_OR_ANCHOR/.test(why['I-W']), `빈 이유: ${why['I-W']}`)
})
test('반례7b — control 꺼짐 · kill switch 면 count 0 · BLOCKED', () => {
  for (const [c, b] of [[controlText({ enabled: false }), 'CONTROL_DISABLED'], [controlText({ tripped: true }), 'KILL_SWITCH_TRIPPED']]) {
    const x = row(build({ control: c }), 'I-X')
    eq([x.direct.count, x.discovery.count, x.status], [0, 0, 'BLOCKED'], b)
    ok(x.blockers.includes(b), x.blockers.join(','))
    eq(x.display, { direct: [], discovery: null }, '표시 0')
  }
})
test('반례7c — FOOTER_BRIDGE 꺼짐이면 discovery 0, cluster 꺼짐이면 count 0 · CLUSTER_DISABLED', () => {
  const x = row(build({ control: controlText({ bridge: false }) }), 'I-X')
  eq([x.discovery.count, x.graphReady], [0, false], 'bridge off')
  const y = row(build(), 'I-Y')
  eq([y.direct.count, y.discovery.count, y.status], [0, 0, 'BLOCKED'], 'Y')
  ok(y.blockers.includes('CLUSTER_DISABLED'), y.blockers.join(','))
  eq([y.direct.ifClusterEnabled, y.discovery.ifClusterEnabled], [2, 1], 'cluster 를 켰을 때의 근거는 따로 보인다')
})
test('반례7d — 출발 cluster 가 꺼진 공개 글은 reverse 로 세지 않는다', () => {
  const x = row(build({ control: controlText({ clusters: ['rel'] }) }), 'I-X')
  eq(x.reverse.count, 0, 'reverse')
})

// ── 반례 8 — reverse 불일치 · G8 미충족은 명시 blocker ──
test('반례8 — reverseEdgeId 가 없는 edge 를 가리키면 REVERSE_LINK_MISMATCH', () => {
  const w = baseWorld(); w.graph[0] = { ...w.graph[0], reverseEdgeId: 'E-9999' }
  const x = row(build({ world: w }), 'I-X')
  ok(x.blockers.includes('REVERSE_LINK_MISMATCH') && !x.graphReady, x.blockers.join(','))
})
test('반례8b — reverse 방향이 반대가 아니면 REVERSE_LINK_MISMATCH', () => {
  const w = baseWorld(); w.graph[0] = { ...w.graph[0], reverseEdgeId: 'E-0008' }
  ok(row(build({ world: w }), 'I-X').blockers.includes('REVERSE_LINK_MISMATCH'), 'mismatch')
})
test('반례8c — 공개 reverse 가 없으면 REVERSE_LINK_ABSENT 로 GRAPH_READY=false', () => {
  const w = baseWorld(); w.graph = w.graph.filter((e) => e.edgeId !== 'E-0007').map((e) => e.edgeId === 'E-0001' ? { ...e, reverseEdgeId: null } : e)
  const x = row(build({ world: w }), 'I-X')
  ok(x.shortfall.includes('REVERSE_LINK_ABSENT') && !x.graphReady, x.shortfall.join(','))
})
test('반례8d — G8 장부 미판독 · 미편입은 명시 blocker, 편입이면 slug', () => {
  eq(row(build({ admission: null }), 'I-X').admission, { state: 'UNREAD', slug: null, blockers: ['G8_ADMISSION_UNREAD'] }, 'UNREAD')
  eq(row(build(), 'I-X').admission, { state: 'NOT_ADMITTED', slug: 'x-slug', blockers: ['G8_NOT_ADMITTED'] }, 'NOT_ADMITTED')
  const admitted = { ...ADMISSION, ledger: JSON.stringify({ event: 'ADMITTED', intentId: 'I-X', slug: 'x-slug' }) + '\n' }
  eq(row(build({ admission: admitted }), 'I-X').admission, { state: 'ADMITTED', slug: 'x-slug', blockers: [] }, 'ADMITTED')
})

// ── 반례 9 — 미등록 intent 누락 0 ──
test('반례9 — 미등록 intent 전부가 한 행씩(edge 0 · HOLD 포함), 등록 intent 는 0행', () => {
  const b = build()
  const ids = b.readiness.rows.map((r) => r.intentId)
  eq(ids, ['I-T', 'I-X', 'I-Y', 'I-Z'], '미등록 행')
  eq(b.readiness.totals.unregistered + b.readiness.totals.registered, b.readiness.totals.intents, '합계')
  eq(b.readiness.totals.inventoried, b.readiness.totals.unregistered, '누락')
  eq(row(b, 'I-Z').status, 'GRAPH_INCOMPLETE', 'edge 0 intent')
})

// ── 반례 10 — symlink 로 쓰기 경계 우회 ──
const inputBefore = treeHash(input1), admBefore = treeHash(adm)
const fileList = (root) => { const out = []; const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); out.push(relative(root, p)); if (statSync(p).isDirectory()) walk(p) } }; walk(root); return out }
const productListBefore = fileList(product)
const safe = join(TMP, 'safe'); mkdirSync(safe, { recursive: true })
test('반례10 — 안전해 보이는 symlink(safe/alias → 제품 src) 아래 out-dir 는 OUT_DIR_FORBIDDEN · write 0', () => {
  symlinkSync(join(product, 'src'), join(safe, 'alias'))
  const r = runCli(input1, join(safe, 'alias/mgraph-escape'))
  eq([r.code, r.json?.code], [1, 'OUT_DIR_FORBIDDEN'], 'symlink 조상')
  ok(!existsSync(join(product, 'src/mgraph-escape')), '제품 src 안에 산출물이 생겼다')
  eq(fileList(product), productListBefore, '제품 파일 목록'); eq(treeHash(product), productBefore, '제품 바이트')
})
test('반례10b — out-dir 자신 · 깊은 조상 symlink 가 input · admission · 제품 src 로 귀결되거나 끊어진 symlink 면 거부', () => {
  symlinkSync(input1, join(safe, 'to-input')); symlinkSync(adm, join(safe, 'to-adm')); symlinkSync(product, join(safe, 'to-product'))
  symlinkSync(join(TMP, 'nowhere'), join(safe, 'dangling'))
  for (const out of [join(safe, 'to-input'), join(safe, 'to-adm/x'), join(safe, 'to-product/src/content/y'), join(safe, 'dangling/z')]) {
    const r = runCli(input1, out)
    eq([r.code, r.json?.code], [1, 'OUT_DIR_FORBIDDEN'], out)
  }
  ok(!existsSync(join(TMP, 'nowhere')), '끊어진 symlink 를 따라 썼다')
  eq(fileList(product), productListBefore, '제품 파일 목록'); eq(treeHash(product), productBefore, '제품 바이트')
  eq([treeHash(input1), treeHash(adm)], [inputBefore, admBefore], '입력 · 장부 바이트')
})
test('반례10c — 금지 구역 밖을 가리키는 symlink 는 막지 않고 실제 위치에 쓴다', () => {
  mkdirSync(join(TMP, 'real-out')); symlinkSync(join(TMP, 'real-out'), join(safe, 'ok-link'))
  const r = runCli(input1, join(safe, 'ok-link/o'))
  eq([r.code, r.json?.result], [0, 'WRITTEN'], 'symlink 안전 경로')
  eq(treeHash(join(TMP, 'real-out/o')), treeHash(join(TMP, 'out2')), '같은 바이트')
})
test('반례10d — 판정 뒤 mkdir 전 · rename 전에 경로가 symlink 로 바뀌면 OUT_DIR_CHANGED · 제품 write 0', () => {
  const b = build()
  for (const when of ['afterPlan', 'beforeRename']) {
    const parent = join(TMP, `race-${when}`); mkdirSync(parent)
    const out = join(parent, 'sub/out')
    const plan = lib.planOutDir({ outDir: out, forbidden: [{ label: '제품 src', path: join(product, 'src') }] })
    const swap = () => { renameSync(parent, `${parent}-moved`); symlinkSync(join(product, 'src'), parent) }
    let code = null
    try { lib.writeStage({ plan, graphVersion: b.graphVersion, files: b.files, hooks: { [when]: swap } }) } catch (e) { code = e.code }
    eq(code, 'OUT_DIR_CHANGED', when)
    eq(fileList(product), productListBefore, `${when} 제품 파일 목록`); eq(treeHash(product), productBefore, `${when} 제품 바이트`)
  }
})

// ── 반례 11 — 존재하지 않는 effectiveAt ──
test('반례11 — 달력에 없는 날짜 · 범위 밖 시분초 · offset 은 EFFECTIVE_AT_INVALID', () => {
  for (const t of ['2026-02-30T13:00:00+09:00', '2026-04-31T00:00:00Z', '2025-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-00-10T00:00:00Z',
    '2026-10-15T24:00:00+09:00', '2026-10-15T12:60:00+09:00', '2026-10-15T12:00:60+09:00',
    '2026-10-15T13:00:00+14:30', '2026-10-15T13:00:00+25:00', '2026-10-15T13:00:00+09:60', '2026-10-15T13:00:00-99:00']) {
    let code = null
    try { lib.parseEffectiveAt(t) } catch (e) { code = e.code }
    eq(code, 'EFFECTIVE_AT_INVALID', t)
  }
})
test('반례11b — Z · 양수 · 음수 offset · 윤일 · KST 날짜 경계는 받는다', () => {
  const cases = [['2026-10-15T13:00:00+09:00', '20261015'], ['2026-10-15T14:59:59Z', '20261015'], ['2026-10-15T15:00:00Z', '20261016'],
    ['2026-10-15T10:00:00-05:00', '20261016'], ['2026-10-16T08:59:59+09:00', '20261016'], ['2024-02-29T12:00:00Z', '20240229'],
    ['2026-10-15T00:00:00+14:00', '20261014'], ['2026-10-15T23:59:59-12:00', '20261016']]
  for (const [t, d] of cases) eq(lib.parseEffectiveAt(t).versionDate, d, t)
})

// ── 반례 12 — 손상된 연구 입력 ──
test('반례12 — 신원 · 구조 손상은 bundle 을 만들지 않고 INPUT_SCHEMA_INVALID', () => {
  const cases = {
    'edgeId null': (w) => { w.graph[0].edgeId = null },
    'edgeId 빈 문자열': (w) => { w.graph[0].edgeId = '' },
    'edgeId 중복': (w) => { w.graph[1].edgeId = w.graph[0].edgeId },
    'relationType 미지': (w) => { w.graph[0].relationType = 'FRIEND' },
    'placement 미지': (w) => { w.graph[0].placement = 'SIDEBAR' },
    'to intent 미지': (w) => { w.graph[0].toIntentId = 'I-NOPE' },
    'from intent null': (w) => { w.graph[0].fromIntentId = null },
    'priority 문자열': (w) => { w.graph[0].priority = '1' },
    'backlinkPlan 손상': (w) => { w.graph[0].backlinkPlan = { fromIntentId: 'I-X' } },
    'automation intentId 누락': (w) => { delete w.automation[0].intentId },
    'canonical intentId 중복': (w) => { w.canonical[1].intentId = w.canonical[0].intentId },
    'intent 집합 불일치': (w) => { w.canonical.push(canon('I-EXTRA')) },
    'published slug null': (w) => { w.published[0].slug = null },
  }
  // 🔴 신원 손상은 **입력 경계**에서 멈춰야 한다 — 산출 검증이 뒤에서 잡아 입력 검증 변이를 가리지 않게 사유 출처까지 본다
  const INPUT_LAYER = new Set(['edgeId null', 'edgeId 빈 문자열', 'edgeId 중복', 'automation intentId 누락', 'canonical intentId 중복', 'intent 집합 불일치', 'published slug null'])
  for (const [name, mutate] of Object.entries(cases)) {
    const w = baseWorld(); mutate(w)
    let err = null, built = null
    try { built = build({ world: w }) } catch (e) { err = e }
    eq([err?.code, built === null], ['INPUT_SCHEMA_INVALID', true], name)
    const atBuilt = String(err.why).startsWith('산출 계약')
    eq(atBuilt ? 'built' : 'input', INPUT_LAYER.has(name) ? 'input' : 'built', `${name} 를 막은 경계`)
  }
})

// ── 반례 13 — product-root 전체가 읽기 전용 ──
test('반례13 — product-root 자체 · .git · scripts · docs 아래와 그리로 귀결되는 symlink 는 OUT_DIR_FORBIDDEN · write 0', () => {
  symlinkSync(product, join(safe, 'to-product-root'))
  const outs = [product, join(product, '.git/mgraph-stage'), join(product, 'scripts/out'), join(product, 'docs/out'), join(product, 'new-dir/out'),
    join(safe, 'to-product-root'), join(safe, 'to-product-root/.git/mgraph-stage')]
  for (const out of outs) {
    const r = runCli(input1, out)
    eq([r.code, r.json?.code], [1, 'OUT_DIR_FORBIDDEN'], out)
    ok(/product-root/.test(r.json?.why ?? ''), `거부 사유가 product-root 가 아니다: ${r.json?.why}`)
  }
  eq(fileList(product), productListBefore, '제품 파일 목록'); eq(treeHash(product), productBefore, '제품 바이트')
  eq([treeHash(input1), treeHash(adm)], [inputBefore, admBefore], '입력 · 장부 바이트')
})

// ── 반례 14 — intent/2 · edge/3 필수 필드 ──
test('반례14 — 빈 집합 · 필수 필드 누락 · 계약 밖 enum/type 은 build 전 INPUT_SCHEMA_INVALID (사유까지 대조)', () => {
  const del = (k) => (w) => { delete w.automation[0][k] }
  const cases = [
    ['세 집합 모두 빈 입력 — canonical', (w) => { w.canonical = []; w.automation = []; w.graph = [] }, 'canonical intent 가 0개'],
    ['세 집합 모두 빈 입력 — automation', (w) => { w.canonical = []; w.automation = []; w.graph = [] }, 'automation intent 가 0개'],
    ['세 집합 모두 빈 입력 — graph', (w) => { w.canonical = []; w.automation = []; w.graph = [] }, 'graph edge 가 0개'],
    ['primaryQuery 누락', del('primaryQuery'), 'primaryQuery 누락'],
    ['audienceSituation 빈 문자열', (w) => { w.automation[0].audienceSituation = ' ' }, 'audienceSituation 누락'],
    ['territoryId 누락', del('territoryId'), 'territoryId 형식 오류'],
    ['policyScope 누락', del('policyScope'), 'policyScope 계약 밖'],
    ['verificationProfile 계약 밖', (w) => { w.automation[0].verificationProfile = 'LOOSE' }, 'verificationProfile 계약 밖'],
    ['automationDecision 계약 밖', (w) => { w.automation[0].automationDecision = 'MAYBE' }, 'automationDecision 계약 밖'],
    ['topicVerdict 누락', del('topicVerdict'), 'topicVerdict 계약 밖'],
    ['runtimeState 계약 밖', (w) => { w.automation[0].runtimeState = 'LIVE' }, 'runtimeState 계약 밖'],
    ['evidence 누락', del('evidence'), 'evidence 누락'],
    ['profileSpec 누락', del('profileSpec'), 'profileSpec 누락'],
    ['verdictWhy 누락', del('verdictWhy'), 'verdictWhy 누락'],
    ['automation communityDestination 계약 밖', (w) => { w.automation[0].communityDestination = '/community/x' }, 'communityDestination 이 게시판 계약 밖'],
    ['canonical communityDestination 계약 밖(산출에 쓰일 때)', (w) => { w.canonical[0].communityDestination = '/x' }, 'intent I-X communityDestination 이 게시판 계약 밖'],
    ['reciprocalPolicy 누락', (w) => { delete w.graph[0].reciprocalPolicy }, 'reciprocalPolicy 계약 밖'],
    ['reciprocalPolicy 계약 밖', (w) => { w.graph[0].reciprocalPolicy = 'SOMETIMES' }, 'reciprocalPolicy 계약 밖'],
    ['priority 0', (w) => { w.graph[0].priority = 0 }, 'priority 계약 밖'],
    ['priority 1.5', (w) => { w.graph[0].priority = 1.5 }, 'priority 계약 밖'],
  ]
  for (const [name, mutate, why] of cases) {
    const w = baseWorld(); mutate(w)
    let err = null, built = null
    try { built = build({ world: w }) } catch (e) { err = e }
    eq([err?.code, built === null], ['INPUT_SCHEMA_INVALID', true], name)
    ok(String(err.why).includes(why), `${name}: 사유에 「${why}」 가 없다 — ${err.why}`)
  }
})
test('반례14b — nullable · builder 기본값은 그대로 받는다(runtimeState 없음 · communityDestination null · cluster null)', () => {
  const w = baseWorld()
  delete w.automation[1].runtimeState; w.automation[1].communityDestination = null; w.automation[2].magazineCluster = null
  w.automation[3].retryPolicy = null; w.automation[3].duplicateReason = null
  const b = build({ world: w })
  const i1 = b.layers.intents.find((x) => x.intentId === 'I-P1')
  eq([i1.runtimeState, i1.communityDestination], ['UNPUBLISHED', '/community/free'], '기본값')
})

// ── 반례 15 — 산출 계약(intent/2 · edge/3 · mapping/2) 한 곳 ──
const rejectWhy = (fn) => { try { fn(); return null } catch (e) { return { code: e.code, why: String(e.why) } } }
/** mapping 을 손댄 산출 반례는 intent 요약도 그 mappings 로 다시 맞춘다 — 다른 계약을 시험할 때 요약 일관성 검사가 끼어들지 않게 */
const resync = (l) => { const f = lib.existingAssetSummaries(l.mappings); for (const x of l.intents) x.existingAssetRelation = f(x.intentId); return l }
test('반례15 — runtimeState ACTIVE · FALLBACK 은 통과, 미지 값은 거부', () => {
  for (const st of ['ACTIVE', 'FALLBACK']) {
    const w = baseWorld(); w.automation[0].runtimeState = st
    eq(build({ world: w }).layers.intents[0].runtimeState, st, st)
  }
  const w = baseWorld(); w.automation[0].runtimeState = 'GONE'
  const r = rejectWhy(() => build({ world: w }))
  ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes('runtimeState 계약 밖'), JSON.stringify(r))
})
test('반례15b — priority 4 · evidence.refs 문자열 · COMMUNITY /community/other · activateWhen 누락 · mapping coverage·publishedAt 계약 밖은 거부', () => {
  const plan = { fromIntentId: 'I-P1', toIntentId: 'I-X', relationType: 'NEXT_QUESTION', readerReason: 'r', anchorLabel: 'a' }
  const cases = [
    ['priority 4', (w) => { w.graph[0].priority = 4 }, 'priority 계약 밖'],
    ['evidence.refs 문자열', (w) => { w.automation[0].evidence = { refs: '2' } }, 'evidence.refs 가 수가 아니다'],
    ['COMMUNITY /community/other', (w) => { w.graph.find((e) => e.relationType === 'COMMUNITY').toIntentId = '/community/other' }, 'COMMUNITY 도착이 게시판 계약 밖'],
    ['backlinkPlan.activateWhen 누락', (w) => { w.graph[0].backlinkPlan = { ...plan } }, 'backlinkPlan.activateWhen 누락'],
    ['mapping coverage 계약 밖', (w) => { w.canonical[1].existingSlugs[0].coverage = 'MAYBE' }, 'coverage 계약 밖'],
    ['mapping publishedAt 형식 오류', (w) => { w.canonical[1].existingSlugs[0].publishedAt = '2026/10/01' }, 'publishedAt 형식 오류'],
  ]
  for (const [name, mutate, why] of cases) {
    const w = baseWorld(); mutate(w)
    const r = rejectWhy(() => build({ world: w }))
    ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes(why), `${name}: ${JSON.stringify(r)}`)
  }
  const w = baseWorld(); w.graph[0].backlinkPlan = { ...plan, activateWhen: '두 글이 공개되면' }
  w.canonical[1].existingSlugs[0].publishedAt = '2026-10-01'
  ok(build({ world: w }).graphVersion, 'activateWhen 이 있는 backlinkPlan · 정상 publishedAt 은 통과')
})
test('반례15c — builder 가 만들 수 없는 산출 손상도 산출 계약이 잡는다(assetState · mapping intent · layers)', () => {
  const layers = build().layers
  const clone = () => JSON.parse(JSON.stringify(layers))
  eq(rejectWhy(() => lib.validateBuiltArtifacts(clone())), null, '정상 산출 통과')
  const cases = [
    ['mapping assetState 계약 밖', (l) => { l.mappings[0].assetState = 'GONE' }, 'assetState 계약 밖'],
    ['mapping intentId 미지', (l) => { l.mappings[0].intentId = 'I-NOPE' }, 'intentId 가 intent 집합에 없다'],
    ['edge layers 문자열', (l) => { l.edges[0].layers.AUTOMATION_READY = 'true' }, 'layers 가 boolean 이 아니다'],
    ['edge 슬롯이 관계와 다름', (l) => { l.edges[0].recommendationSlot = 'BRIDGE_DISCOVERY' }, 'recommendationSlot 이 관계에서 파생된 값이 아니다'],
  ]
  for (const [name, mutate, why] of cases) {
    const l = clone(); mutate(l)
    const r = rejectWhy(() => lib.validateBuiltArtifacts(l))
    ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes(why), `${name}: ${JSON.stringify(r)}`)
  }
})

// ── 반례 16 — 산출 날짜 의미 · 최종 산출 신원 (validateBuiltArtifacts 직접 호출 — 입력 검증이 가리지 않는다) ──
test('반례16 — 불가능한 publishedAt · publishAt 은 거부, 윤일 · 월말 · 00:00:00 · 23:59:59 · null 은 통과', () => {
  const layers = build().layers
  const withMapping = (patch) => { const l = JSON.parse(JSON.stringify(layers)); Object.assign(l.mappings[0], patch); return l }
  for (const [patch, why] of [
    [{ publishedAt: '2026-02-30' }, 'publishedAt 형식 오류'], [{ publishedAt: '2025-02-29' }, 'publishedAt 형식 오류'],
    [{ publishedAt: '2026-13-01' }, 'publishedAt 형식 오류'],
    [{ publishAt: '2026-10-15T25:61:61+09:00' }, 'publishAt 형식 오류'], [{ publishAt: '2026-02-30T10:30:00+09:00' }, 'publishAt 형식 오류'],
    [{ publishAt: '2026-10-15T24:00:00+09:00' }, 'publishAt 형식 오류'], [{ publishAt: '2026-10-15T10:30:00+00:00' }, 'publishAt 형식 오류'],
  ]) {
    const r = rejectWhy(() => lib.validateBuiltArtifacts(withMapping(patch)))
    ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes(why), `${JSON.stringify(patch)}: ${JSON.stringify(r)}`)
  }
  for (const patch of [{ publishedAt: '2024-02-29' }, { publishedAt: '2026-12-31' }, { publishedAt: '2026-04-30' }, { publishedAt: null, publishAt: null },
    { publishAt: '2024-02-29T10:30:00+09:00' }, { publishAt: '2026-10-15T00:00:00+09:00' }, { publishAt: '2026-10-15T23:59:59+09:00' }]) {
    eq(rejectWhy(() => lib.validateBuiltArtifacts(withMapping(patch))), null, JSON.stringify(patch))
  }
})
test('반례16b — 최종 산출의 빈·형식 밖 edgeId · 중복 edgeId · 중복 intentId · 중복 (intentId, slug) 는 거부', () => {
  const layers = build().layers
  const clone = () => JSON.parse(JSON.stringify(layers))
  const cases = [
    ['빈 edgeId', (l) => { l.edges[0].edgeId = '' }, '산출 edge 1번 신원 형식 오류'],
    ['형식 밖 edgeId', (l) => { l.edges[0].edgeId = 'X-1' }, '산출 edge 1번 신원 형식 오류'],
    ['중복 edgeId', (l) => { l.edges[1].edgeId = l.edges[0].edgeId }, '산출 edge 신원 중복'],
    ['중복 intentId', (l) => { l.intents.push({ ...l.intents[0] }) }, '산출 intent 신원 중복'],
    ['빈 intentId', (l) => { l.intents.push({ ...l.intents[0], intentId: '' }) }, '산출 intent'],
    ['중복 (intentId, slug)', (l) => { l.mappings.push({ ...l.mappings[0] }) }, '산출 mapping 신원 중복'],
  ]
  for (const [name, mutate, why] of cases) {
    const l = clone(); mutate(l)
    const r = rejectWhy(() => lib.validateBuiltArtifacts(l))
    ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes(why), `${name}: ${JSON.stringify(r)}`)
  }
  const l = clone(); l.mappings.push({ ...l.mappings[0], slug: `${l.mappings[0].slug}-2` })
  eq(rejectWhy(() => lib.validateBuiltArtifacts(resync(l))), null, '같은 intent 의 다른 slug 는 정상')
})

// ── 반례 17 — lifecycle 정합: 공개(LIVE) 글에 공개 전 coverage 가 남으면 build 전 거부 ──
test('반례17 — LIVE + SCHEDULED_NOT_YET_PUBLIC · QUEUED_NOT_PUBLIC 는 INPUT_SCHEMA_INVALID, LIVE + ANSWERS · 비공개 + 공개 전 coverage 는 통과', () => {
  const layers = build().layers
  const live = layers.mappings.findIndex((m) => m.assetState === 'LIVE')
  const withMapping = (patch, i = live) => { const l = JSON.parse(JSON.stringify(layers)); Object.assign(l.mappings[i], patch); return resync(l) }
  for (const cov of ['SCHEDULED_NOT_YET_PUBLIC', 'QUEUED_NOT_PUBLIC']) {
    const r = rejectWhy(() => lib.validateBuiltArtifacts(withMapping({ coverage: cov })))
    ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes(`lifecycle 모순 — LIVE 인데 coverage ${cov}`), `${cov}: ${JSON.stringify(r)}`)
  }
  eq(rejectWhy(() => lib.validateBuiltArtifacts(withMapping({ coverage: 'ANSWERS' }))), null, 'LIVE + ANSWERS')
  for (const cov of ['SCHEDULED_NOT_YET_PUBLIC', 'QUEUED_NOT_PUBLIC']) {
    eq(rejectWhy(() => lib.validateBuiltArtifacts(withMapping({ assetState: 'QUEUED', coverage: cov }))), null, `QUEUED + ${cov} 는 모순이 아니다`)
  }
})
test('반례17b — 입력에서 공개 글의 coverage 가 공개 전이면 build 가 멈추고 CLI 산출 write 0', () => {
  const w = baseWorld(); w.canonical[1].existingSlugs[0].coverage = 'QUEUED_NOT_PUBLIC'
  const r = rejectWhy(() => build({ world: w }))
  ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes('lifecycle 모순'), JSON.stringify(r))
  const inStale = join(TMP, 'in-stale'); writeTree(inStale, inputTextsOf(w))
  const out = join(TMP, 'out-stale'); const c = runCli(inStale, out)
  eq([c.code, c.json?.code], [1, 'INPUT_SCHEMA_INVALID'], 'CLI')
  ok(!existsSync(out), 'out-dir 가 만들어졌다')
})

// ── 반례 18 — existing asset 권위는 built mappings 하나 (automation.existingAssetRelation 은 legacy) ──
test('반례18 — canonical mapping 있음 + automation 「없음」 → 산출은 mapping, mapping 없음 + automation 주장 → 산출 「없음」', () => {
  const w = baseWorld()
  w.automation.find((a) => a.intentId === 'I-P1').existingAssetRelation = '없음'
  w.automation.find((a) => a.intentId === 'I-Z').existingAssetRelation = 'ghost(PUBLISHED/ANSWERS)'
  const b = build({ world: w })
  const at = (id) => b.layers.intents.find((x) => x.intentId === id).existingAssetRelation
  eq([at('I-P1'), at('I-Z')], ['p1(PUBLISHED/ANSWERS)', '없음'], '산출 요약')
})
test('반례18b — LIVE · SCHEDULED · QUEUED · BLOCKED 상태 요약과 다중 mapping 순서(canonical 순서)가 정확하고 결정적이다', () => {
  const w = baseWorld()
  w.automation.push(intent('I-S', 'fam', { existingAssetRelation: '아무 값' }))
  w.canonical.push({ intentId: 'I-S', answerScope: 'a', exclusions: [], existingSlugs: [
    { slug: 'zz-queue', coverage: 'QUEUED_NOT_PUBLIC', cluster: 'fam' }, { slug: 'aa-live', coverage: 'ANSWERS', cluster: 'fam' },
    { slug: 'mm-sched', coverage: 'SCHEDULED_NOT_YET_PUBLIC', cluster: 'fam' }, { slug: 'bb-block', coverage: 'ADJACENT', cluster: 'fam' }] })
  w.published.push({ slug: 'aa-live', assetState: 'LIVE' }, { slug: 'mm-sched', assetState: 'SCHEDULED_NOT_YET_PUBLIC' })
  w.queued.push({ slug: 'zz-queue' })
  const want = 'zz-queue(QUEUED/QUEUED_NOT_PUBLIC), aa-live(PUBLISHED/ANSWERS), mm-sched(SCHEDULED_NOT_YET_PUBLIC/SCHEDULED_NOT_YET_PUBLIC), bb-block(BLOCKED/ADJACENT)'
  // 🔴 snapshot 의 LIVE · SCHEDULED 는 제품 글과 맞아야 한다(제품 lifecycle 관문) — 제품에 없는 LIVE 는 실제로 있을 수 없는 fixture 다
  const articles = articlesText({ 'aa-live': art('fam', '2026-10-01T10:30:00+09:00'), 'mm-sched': art('fam', '2026-12-01T10:30:00+09:00') })
  const one = build({ world: w, articles }), two = build({ world: w, articles })
  eq(one.layers.intents.find((x) => x.intentId === 'I-S').existingAssetRelation, want, '요약')
  eq(two.files, one.files, '같은 입력 두 번 — 산출 바이트')
})
test('반례18c — 모든 intent 의 산출 요약 = mappings, 요약을 mappings 와 다르게 고친 산출은 INPUT_SCHEMA_INVALID', () => {
  const l = build().layers
  const f = lib.existingAssetSummaries(l.mappings)
  eq(l.intents.filter((x) => x.existingAssetRelation !== f(x.intentId)).map((x) => x.intentId), [], '요약 ≠ mappings')
  const bad = JSON.parse(JSON.stringify(l)); bad.intents.find((x) => x.intentId === 'I-P1').existingAssetRelation = '없음'
  const r = rejectWhy(() => lib.validateBuiltArtifacts(bad))
  ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes('I-P1 existingAssetRelation 이 mappings 와 다르다'), JSON.stringify(r))
})

// ── 반례 19 — snapshot ↔ 제품 lifecycle 대조 (published > queue · effectiveAt 만 · slug 별 1건) ──
const lc = (inputs, arts, eff) => lib.productLifecycleDrift({ inputs: { canonical: [], queued: [], published: [], ...inputs }, articles: arts, effectiveMs: Date.parse(eff) })
const pa = (slug, publishAt, status = 'SCHEDULED') => ({ slug, title: slug, cluster: 'fam', publishedAt: publishAt.slice(0, 10), status, publishAt })
const T = '2026-10-17T10:30:00+09:00', T_1 = '2026-10-17T10:29:59+09:00'
test('반례19 — 공개 1초 전 queue 는 통과, 공개 경계(publishAt 그 시각)부터 queue-only 는 drift', () => {
  const arts = [pa('q1', T)]
  eq(lc({ queued: [{ slug: 'q1' }] }, arts, T_1), [], '1초 전')
  const d = lc({ queued: [{ slug: 'q1' }] }, arts, T)
  eq(d.map((x) => x.slug), ['q1'], '경계'); ok(d[0].reasons.some((r) => r.includes('QUEUE')), d[0].reasons.join(','))
})
test('반례19b — published LIVE 와 queue 의 교차 중복은 drift 0 (published > queue · queue 는 provenance 사본)', () => {
  eq(lc({ published: [{ slug: 'x', assetState: 'LIVE' }], queued: [{ slug: 'x' }] }, [pa('x', '2026-10-01T10:30:00+09:00')], T), [], '교차')
})
test('반례19c — 미래 글 · 제품에 없는 글을 LIVE 로 기록하면 drift', () => {
  const d = lc({ published: [{ slug: 'f', assetState: 'LIVE' }, { slug: 'gone', assetState: 'LIVE' }] }, [pa('f', '2026-12-01T10:30:00+09:00')], T)
  eq(d.map((x) => x.slug), ['f', 'gone'], 'LIVE drift')
  ok(d[0].reasons[0].includes('아직 공개 전') && d[1].reasons[0].includes('없음'), JSON.stringify(d))
})
test('반례19d — raw status 가 SCHEDULED 여도 publishAt 이 지나면 공개, DRAFT 는 시각이 지나도 비공개', () => {
  eq(lc({ queued: [{ slug: 's' }] }, [pa('s', '2026-10-01T10:30:00+09:00', 'SCHEDULED')], T).map((x) => x.slug), ['s'], 'SCHEDULED 지난 글')
  eq(lc({ queued: [{ slug: 'dr' }] }, [pa('dr', '2026-10-01T10:30:00+09:00', 'DRAFT')], T), [], 'DRAFT')
})
test('반례19e — canonical 의 공개 slug 가 assets 에서 빠지면 drift, canonical 밖 제품 글은 mapping 을 강제하지 않는다', () => {
  const canonical = [{ intentId: 'I-1', existingSlugs: [{ slug: 'c1' }] }]
  const d = lc({ canonical }, [pa('c1', '2026-10-01T10:30:00+09:00'), pa('free', '2026-10-01T10:30:00+09:00')], T)
  eq(d.map((x) => x.slug), ['c1'], 'canonical 공개 누락만'); ok(d[0].reasons[0].includes('ABSENT'), d[0].reasons[0])
})
test('반례19f — published · queue 각 파일 안의 slug 중복은 drift', () => {
  const arts = [pa('a', '2026-12-01T10:30:00+09:00'), pa('b', '2026-12-01T10:30:00+09:00')]
  const d = lc({ published: [{ slug: 'a', assetState: 'SCHEDULED_NOT_YET_PUBLIC' }, { slug: 'a', assetState: 'SCHEDULED_NOT_YET_PUBLIC' }], queued: [{ slug: 'b' }, { slug: 'b' }] }, arts, T)
  eq(d.map((x) => [x.slug, x.reasons]), [['a', ['assets-published 안에서 slug 중복']], ['b', ['assets-queue 안에서 slug 중복']]], '중복')
})
test('반례19g — 한 slug 의 여러 근거는 한 건으로 모은다', () => {
  const d = lc({ queued: [{ slug: 'm' }, { slug: 'm' }], canonical: [{ intentId: 'I-1', existingSlugs: [{ slug: 'm' }] }] }, [pa('m', '2026-10-01T10:30:00+09:00')], T)
  eq(d.length, 1, 'slug 1건'); eq(d[0].reasons.length, 2, '사유 2개')
})
test('반례19h — 벽시계가 아니라 effectiveAt 으로 본다(지금은 공개됐지만 effectiveAt 에는 공개 전)', () => {
  eq(lc({ queued: [{ slug: 'later' }] }, [pa('later', '2026-10-16T10:30:00+09:00')], '2026-10-15T13:00:00+09:00'), [], 'effectiveAt 기준')
})
test('반례19i — build 는 drift 면 INPUT_PRODUCT_LIFECYCLE_DRIFT 로 멈추고 CLI 산출 write 0 · 입력 · 제품 불변, 같은 입력 반복 결과 동일', () => {
  const w = baseWorld(); w.queued.push({ slug: 'qpub' }); w.canonical[0].existingSlugs = [{ slug: 'qpub', coverage: 'QUEUED_NOT_PUBLIC', cluster: 'fam' }]
  const articles = articlesText({ qpub: art('fam', '2026-10-10T10:30:00+09:00') })
  const r1 = rejectWhy(() => build({ world: w, articles })), r2 = rejectWhy(() => build({ world: w, articles }))
  ok(r1?.code === 'INPUT_PRODUCT_LIFECYCLE_DRIFT' && r1.why.includes('qpub'), JSON.stringify(r1)); eq(r2, r1, '반복 동일')
  const inDrift = join(TMP, 'in-drift'); writeTree(inDrift, inputTextsOf(w))
  const prodDrift = join(TMP, 'product-drift'); writeTree(prodDrift, { 'src/lib/magazine-graph.ts': RESOLVER, 'src/content/magazine/graph/control.ts': controlText(), 'src/content/magazine/articles.ts': articles })
  const before = [treeHash(inDrift), treeHash(prodDrift)]
  const out = join(TMP, 'out-drift')
  let code = null, json = null
  try { execFileSync(process.execPath, [CLI, '--input-root', inDrift, '--product-root', prodDrift, '--effective-at', EFF, '--generated-at', GEN, '--out-dir', out], { stdio: ['ignore', 'pipe', 'pipe'] }); code = 0 }
  catch (e) { code = e.status; try { json = JSON.parse(e.stdout) } catch { /* 요약 없음 */ } }
  eq([code, json?.code], [1, 'INPUT_PRODUCT_LIFECYCLE_DRIFT'], 'CLI'); ok(!existsSync(out), 'out-dir 가 생겼다')
  eq([treeHash(inDrift), treeHash(prodDrift)], before, '입력 · 제품 바이트')
})

// ── 반례 20 — SCHEDULED 제품 신원 ──
test('반례20 — 제품에 없는 phantom SCHEDULED · DRAFT · BLOCKED 를 SCHEDULED 로 기록하면 drift', () => {
  const sched = (slug) => ({ published: [{ slug, assetState: 'SCHEDULED_NOT_YET_PUBLIC' }] })
  const d1 = lc(sched('ph'), [], T)
  eq(d1.map((x) => [x.slug, x.reasons]), [['ph', ['snapshot 은 SCHEDULED 인데 제품에 글이 없다']]], 'phantom')
  for (const st of ['DRAFT', 'BLOCKED']) {
    const d = lc(sched('s'), [pa('s', '2026-12-01T10:30:00+09:00', st)], T)
    eq(d.map((x) => [x.slug, x.reasons]), [['s', [`snapshot 은 SCHEDULED 인데 제품 status 가 ${st}`]]], st)
  }
})
test('반례20b — 미래 publishAt 의 정상 예약은 통과, 경계가 지난 SCHEDULED 는 기존 공개 drift', () => {
  const sched = { published: [{ slug: 's', assetState: 'SCHEDULED_NOT_YET_PUBLIC' }] }
  eq(lc(sched, [pa('s', '2026-12-01T10:30:00+09:00')], T), [], '정상 예약')
  const d = lc(sched, [pa('s', T)], T)
  eq(d.length, 1, 'slug 1건'); ok(d[0].reasons[0].includes('공개인데 snapshot 은 SCHEDULED'), d[0].reasons.join(','))
})

// ── 반례 21 — resolver 다중 mapping 선택 정책이 읽는 coverage 를 slim export 가 싣는다 ──
test('반례21 — slim 의 모든 LIVE mapping 이 산출 layer 의 coverage 를 그대로 싣는다', () => {
  const b = build()
  const want = b.layers.mappings.filter((x) => x.assetState === 'LIVE').map((x) => `${x.intentId}|${x.slug}|${x.coverage}`)
  eq(b.slim.mappings.map((m) => `${m.intent}|${m.slug}|${m.coverage}`), want, 'slim mapping coverage')
  ok(b.files[`bundle/${b.graphVersion}.ts`].includes('"coverage": "ANSWERS"'), 'bundle 텍스트에 coverage 가 없다')
})
test('반례21b — coverage 가 없거나 계약 밖 · 공개 전인 slim mapping 은 export 자체 검사가 거부한다', () => {
  const slim = build().slim
  const surfaces = ['CTA_END', 'FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE']
  for (const [label, cov] of [['없음', undefined], ['계약 밖', 'GREAT'], ['공개 전', 'QUEUED_NOT_PUBLIC']]) {
    const bad = { ...slim, mappings: slim.mappings.map((m, i) => (i === 0 ? { ...m, coverage: cov } : m)) }
    ok(lib.exportProblems(bad, surfaces).some((p) => p.startsWith('EXPORT_MAPPING_COVERAGE_MISSING')), label)
  }
  eq(lib.exportProblems(slim, surfaces), [], '정상 slim')
})

// ── 반례 22 — graph 참여(EDITORIAL_NON_SEARCH) 선언 (2026-10-18) ──
const ED_EVIDENCE = [{ ref: 'account-2/evidence/serpapi/a.json', sha256: 'a'.repeat(64) }, { ref: 'concept-coverage-gaps.jsonl#C6-06', sha256: 'b'.repeat(64) }]
const edDecl = (over = {}) => ({ state: 'EDITORIAL_NON_SEARCH', reasonCode: 'BOUNDED_RESEARCH_EXHAUSTED', evidence: ED_EVIDENCE,
  evidenceHash: lib.editorialEvidenceHash(ED_EVIDENCE), ...over })
const ED_ARTICLES = articlesText({ ed: art('fam', '2026-10-01T10:30:00+09:00') })
const edWorld = (decl = edDecl()) => { const w = baseWorld(); w.published.push({ slug: 'ed', assetState: 'LIVE', graphParticipation: decl }); return w }
test('반례22 — editorial 선언은 participation 산출 · slim 판정 · contentHash 로 운반되고 graphVersion 을 바꾼다', () => {
  const plain = (() => { const w = baseWorld(); w.published.push({ slug: 'ed', assetState: 'LIVE' }); return build({ world: w, articles: ED_ARTICLES }) })()
  const b = build({ world: edWorld(), articles: ED_ARTICLES })
  eq(b.layers.participation.map((p) => [p.slug, p.state, p.reasonCode, p.evidenceHash]), [['ed', 'EDITORIAL_NON_SEARCH', 'BOUNDED_RESEARCH_EXHAUSTED', lib.editorialEvidenceHash(ED_EVIDENCE)]], 'layer')
  eq(b.slim.participation, [{ slug: 'ed', state: 'EDITORIAL_NON_SEARCH', reasonCode: 'BOUNDED_RESEARCH_EXHAUSTED', evidenceHash: lib.editorialEvidenceHash(ED_EVIDENCE) }], 'slim')
  ok(typeof b.manifest.contentHash.participation === 'string', 'contentHash.participation 없음')
  ok(b.graphVersion !== plain.graphVersion, '선언을 더해도 graphVersion 이 같다')
  ok(b.files['participation.jsonl']?.includes('"slug":"ed"'), 'participation.jsonl 없음')
  ok(b.files[`bundle/${b.graphVersion}.ts`].includes('"participation"'), 'bundle 에 participation 없음')
  eq(lib.editorialEvidenceHash([...ED_EVIDENCE].reverse()), lib.editorialEvidenceHash(ED_EVIDENCE), '근거 순서와 무관한 hash')
})
test('반례22b — editorial 선언과 canonical mapping 이 같은 slug 에 동시에 있으면 INPUT_SCHEMA_INVALID', () => {
  const w = edWorld(); w.canonical.find((c) => c.intentId === 'I-T').existingSlugs = [{ slug: 'ed', coverage: 'ANSWERS', cluster: 'fam' }]
  const r = rejectWhy(() => build({ world: w, articles: ED_ARTICLES }))
  ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes('canonical mapping 이 있다'), JSON.stringify(r))
})
test('반례22c — provenance 누락·빈 hash·hash 불일치·reasonCode 계약 밖·state 계약 밖·근거 0·근거 hash 형식 밖·근거 중복은 INPUT_SCHEMA_INVALID', () => {
  const cases = [
    ['hash 누락', edDecl({ evidenceHash: undefined }), 'evidenceHash'],
    ['빈 hash', edDecl({ evidenceHash: '' }), 'evidenceHash'],
    ['hash 불일치', edDecl({ evidenceHash: 'c'.repeat(64) }), 'evidenceHash'],
    ['reasonCode 누락', edDecl({ reasonCode: undefined }), 'reasonCode'],
    ['reasonCode 계약 밖', edDecl({ reasonCode: 'LOOKS_EDITORIAL' }), 'reasonCode'],
    ['state 계약 밖', edDecl({ state: 'SEARCH_NODE' }), 'state'],
    ['근거 0', edDecl({ evidence: [], evidenceHash: lib.editorialEvidenceHash([]) }), '근거 신원·hash 누락'],
    ['근거 hash 형식 밖', edDecl({ evidence: [{ ref: 'x', sha256: '' }] }), '근거 신원·hash 누락'],
    ['근거 신원 누락', edDecl({ evidence: [{ ref: '', sha256: 'a'.repeat(64) }] }), '근거 신원·hash 누락'],
    ['근거 중복', edDecl({ evidence: [ED_EVIDENCE[0], ED_EVIDENCE[0]] }), '근거 신원 중복'],
  ]
  for (const [label, decl, want] of cases) {
    const r = rejectWhy(() => build({ world: edWorld(decl), articles: ED_ARTICLES }))
    ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes(want), `${label}: ${JSON.stringify(r)}`)
  }
  for (const decl of [null, 'EDITORIAL_NON_SEARCH', { state: 'EDITORIAL_NON_SEARCH' }]) {
    const r = rejectWhy(() => build({ world: edWorld(decl), articles: ED_ARTICLES }))
    ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.includes('graphParticipation 형식 오류'), `구조 ${JSON.stringify(decl)}: ${JSON.stringify(r)}`)
  }
})
test('반례22d — 선언이 없으면 participation 키 · participation.jsonl · contentHash.participation 이 없다(롤백 bundle 호환)', () => {
  const b = build()
  eq([b.layers.participation, 'participation' in b.slim, 'participation' in b.manifest.contentHash, 'participation.jsonl' in b.files, 'participation' in b.slim.schemaVersion],
    [[], false, false, false, false], '선언 없는 판')
})
test('반례22f — 깨진 participation 행(null · 비객체 · 근거 없음 · 근거 객체 · 근거 원소 null · 배열 아님)은 TypeError 없이 GraphBuildError INPUT_SCHEMA_INVALID', () => {
  const good = build({ world: edWorld(), articles: ED_ARTICLES }).layers
  const ok1 = good.participation[0]
  const cases = [
    ['null 행', [null], '객체가 아니다'],
    ['문자열 행', ['ed'], '객체가 아니다'],
    ['근거 undefined', [{ ...ok1, evidence: undefined }], '근거 목록이 배열이 아니다'],
    ['근거 객체', [{ ...ok1, evidence: { ref: 'x', sha256: 'a'.repeat(64) } }], '근거 목록이 배열이 아니다'],
    ['근거 원소 null', [{ ...ok1, evidence: [null] }], '근거 신원·hash 누락'],
    ['participation 이 배열 아님', { 0: ok1 }, '배열이 아니다'],
  ]
  for (const [label, participation, want] of cases) {
    let err = null
    try { lib.validateBuiltArtifacts({ ...good, participation }) } catch (e) { err = e }
    ok(err instanceof lib.GraphBuildError, `${label}: GraphBuildError 아님 — ${err?.constructor?.name} ${String(err?.message).slice(0, 120)}`)
    ok(err.code === 'INPUT_SCHEMA_INVALID' && String(err.why).includes(want), `${label}: ${err.code} ${String(err.why).slice(0, 160)}`)
  }
})
test('반례22g — 판정을 운반하는 bundle 만 schemaVersion.participation = participation/1 · 짝이 어긋나면 export 가 거부 · EXPORT_HASH 가 표식을 덮는다', () => {
  const b = build({ world: edWorld(), articles: ED_ARTICLES })
  eq(b.slim.schemaVersion.participation, 'participation/1', '표식')
  ok(b.files[`bundle/${b.graphVersion}.ts`].includes('"participation": "participation/1"'), 'bundle 텍스트에 표식 없음')
  const surfaces = ['CTA_END', 'FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE']
  const { participation: _drop, ...noMarker } = b.slim.schemaVersion
  ok(lib.exportProblems({ ...b.slim, schemaVersion: noMarker }, surfaces).some((x) => x.startsWith('EXPORT_PARTICIPATION_SCHEMA_MISSING')), '표식 없음')
  ok(lib.exportProblems({ ...b.slim, schemaVersion: { ...noMarker, participation: 'participation/2' } }, surfaces).some((x) => x.startsWith('EXPORT_PARTICIPATION_SCHEMA_MISSING')), '다른 표식')
  const plain = build().slim
  ok(lib.exportProblems({ ...plain, schemaVersion: { ...plain.schemaVersion, participation: 'participation/1' } }, surfaces).includes('EXPORT_PARTICIPATION_SCHEMA_ORPHAN'), '판정 없는 표식')
  ok(lib.exportProblems({ ...plain, participation: [] }, surfaces).includes('EXPORT_PARTICIPATION_SCHEMA_ORPHAN'), '빈 판정 키')
  ok(lib.bundleText({ ...b.slim, schemaVersion: noMarker }).exportHash !== b.manifest.exportHash, 'EXPORT_HASH 가 표식을 덮지 않는다')
  const row = b.files['participation.jsonl'].trim()
  ok(row.includes('"schemaVersion":"participation/1"'), 'contentHash 가 덮는 산출 행에 schema 가 없다')
})
test('반례22e — 검색 mapping 과 겹치거나 hash 형식 밖인 slim participation 은 export 자체 검사가 거부한다', () => {
  const slim = build({ world: edWorld(), articles: ED_ARTICLES }).slim
  const surfaces = ['CTA_END', 'FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE']
  eq(lib.exportProblems(slim, surfaces), [], '정상 slim')
  const mappedSlug = slim.mappings[0].slug
  for (const [label, p] of [['mapping 과 겹침', { ...slim.participation[0], slug: mappedSlug }], ['빈 hash', { ...slim.participation[0], evidenceHash: '' }], ['reasonCode 밖', { ...slim.participation[0], reasonCode: 'X' }]]) {
    ok(lib.exportProblems({ ...slim, participation: [p] }, surfaces).some((x) => x.startsWith('EXPORT_PARTICIPATION_INVALID')), label)
  }
})

// ── 실제 입력 재현성 (선택) — 2026-10-17 lifecycle 계약 기준 네 증거 중 1~3 ──
//    4 (resolver 화면 결과)는 TS 런타임이 필요해 이 검사 밖 시뮬레이션으로 본다
const oldInput = argOf('--old-input'), newInput = argOf('--new-input'), realProduct = argOf('--real-product')
const readText = (p) => readFileSync(p, 'utf8')
const inputsAt = (dir) => Object.fromEntries(Object.values(lib.INPUT_FILES).map((n) => [n, readText(join(dir, n))]))
const productAt = (root) => Object.fromEntries(Object.entries(lib.PRODUCT_FILES).map(([k, rel]) => [k, readText(join(root, rel))]))
const parseArticlesForReal = () => lib.parseProductTexts(productAt(realProduct)).articles
// 🔴 old(10-15) · new(money-work) snapshot 이 제품과 맞던 마지막 시각 — cold-weather-joint-pain 공개(2026-10-16 10:30) 1초 전.
//    그 뒤 시각에서 두 snapshot 이 거부되는 것은 아래 「실제 입력 4」가 본다
const REAL_EFF = '2026-10-16T10:29:59+09:00', REAL_GEN = '2026-10-16T15:00:00.000Z'
/** 2026-10-15-family 의 lifecycle 모순 — 2026-10-17 본문 대조 감사 대상과 같은 11건 */
const LIFECYCLE_11 = ['I-T0-02|moment-body-changed', 'I-T1-17|dry-eyes-menopause', 'I-T2-10|autumn-low-mood', 'I-T3-04|husband-retired-at-home',
  'I-T4-04|checkup-items-50s', 'I-T4-05|hormone-therapy-who', 'I-T4-06|bone-density-test-when', 'I-T5-06|irp-tax-benefit',
  'I-T6-01|starting-work-at-this-age', 'I-T6-04|certificate-in-50s', 'I-T8-05|menopause-supplements-talk']
/** 감사로 승인된 mapping 변화 — 이 밖의 mapping 변화는 0 이어야 한다 */
const APPROVED_MAPPING = {
  'I-T0-02|moment-body-changed': 'ANSWERS_PARTIAL', 'I-T1-17|dry-eyes-menopause': 'ANSWERS_PARTIAL', 'I-T2-10|autumn-low-mood': 'ANSWERS_PARTIAL',
  'I-T3-04|husband-retired-at-home': 'ANSWERS', 'I-T4-04|checkup-items-50s': 'ANSWERS', 'I-T4-05|hormone-therapy-who': 'ANSWERS',
  'I-T4-06|bone-density-test-when': 'ANSWERS', 'I-T5-06|irp-tax-benefit': 'ANSWERS_PARTIAL', 'I-T6-01|starting-work-at-this-age': 'REMOVED',
  'I-T6-04|certificate-in-50s': 'ANSWERS', 'I-T8-05|menopause-supplements-talk': 'ANSWERS',
}
const runRealCli = (input, out) => {
  try {
    execFileSync(process.execPath, [CLI, '--input-root', input, '--product-root', realProduct, '--effective-at', REAL_EFF, '--generated-at', REAL_GEN, '--out-dir', out], { stdio: ['ignore', 'pipe', 'pipe'] })
    return 0
  } catch (e) { return e.status }
}
if (oldInput && newInput && realProduct) {
  const product = lib.parseProductTexts(productAt(realProduct))
  const layersAt = (dir) => lib.buildGraphLayers({ inputs: lib.parseInputTexts(inputsAt(dir)), implementedSurfaces: product.implemented })
  test('실제 입력 1 — 2026-10-15-family 는 정확히 lifecycle 모순 11건으로 INPUT_SCHEMA_INVALID · bundle 0 · write 0 · 다른 모순 0', () => {
    const r = rejectWhy(() => lib.buildAll({ inputTexts: inputsAt(oldInput), productTexts: productAt(realProduct), admissionTexts: null, effectiveAt: REAL_EFF, generatedAt: REAL_GEN }))
    ok(r?.code === 'INPUT_SCHEMA_INVALID' && r.why.startsWith('산출 계약 11건 — '), JSON.stringify(r).slice(0, 300))
    const l = layersAt(oldInput)
    eq(l.mappings.filter((m) => m.assetState === 'LIVE' && lib.PRE_PUBLIC_COVERAGES.includes(m.coverage)).map((m) => `${m.intentId}|${m.slug}`).sort(), [...LIFECYCLE_11].sort(), '모순 11건 신원')
    const out = join(TMP, 'real-old-out')
    eq(runRealCli(oldInput, out), 1, 'CLI 종료 코드'); ok(!existsSync(out), 'old 입력으로 out-dir 가 만들어졌다')
  })
  test('실제 입력 2 — 2026-10-17-money-work 는 같은 effectiveAt · generatedAt 2회 build 가 목록 · 바이트 · manifest · hash 까지 동일', () => {
    const a = join(TMP, 'real-new-a'), b = join(TMP, 'real-new-b')
    eq([runRealCli(newInput, a), runRealCli(newInput, b)], [0, 0], 'CLI 종료 코드')
    eq(treeHash(a), treeHash(b), '트리 해시'); eq(fileList(a), fileList(b), '파일 목록')
  })
  test('실제 입력 3 — semantic delta whitelist: intent 는 감사 11건의 existingAssetRelation 만 · mapping 은 승인 11건만 · authored edge 추가는 E-0329 만 · generated tuple 집합 동일', () => {
    const o = layersAt(oldInput), n = layersAt(newInput)
    const J = (x) => JSON.stringify(x)
    const audited = new Set(LIFECYCLE_11.map((k) => k.split('|')[0]))
    const oi = new Map(o.intents.map((x) => [x.intentId, x]))
    eq(n.intents.map((x) => x.intentId), o.intents.map((x) => x.intentId), 'intent 목록 · 순서')
    const intentDiff = n.intents.flatMap((b) => { const a = oi.get(b.intentId); return Object.keys({ ...a, ...b }).filter((k) => J(a[k]) !== J(b[k])).map((k) => `${b.intentId}.${k}`) })
    eq(intentDiff.filter((d) => !(d.endsWith('.existingAssetRelation') && audited.has(d.split('.')[0]))), [], '승인 밖 intent 변화')
    const mk = (m) => `${m.intentId}|${m.slug}`
    const om = new Map(o.mappings.map((m) => [mk(m), m])), nm = new Map(n.mappings.map((m) => [mk(m), m]))
    const mapDiff = {}
    for (const [k, a] of om) { const b = nm.get(k); if (!b) mapDiff[k] = 'REMOVED'; else if (J(a) !== J(b)) { const keys = Object.keys({ ...a, ...b }).filter((x) => J(a[x]) !== J(b[x])); ok(keys.every((x) => ['coverage', 'publishedAt'].includes(x)), `${k} 승인 밖 필드 ${keys}`); mapDiff[k] = b.coverage } }
    for (const k of nm.keys()) if (!om.has(k)) mapDiff[k] = 'ADDED'
    eq(mapDiff, APPROVED_MAPPING, 'mapping 변화')
    const auth = (L) => new Map(L.edges.filter((e) => !e.generatedBy).map((e) => [e.edgeId, e]))
    const oa = auth(o), na = auth(n)
    eq([...na.keys()].filter((id) => !oa.has(id)), ['E-0329'], '신규 authored edge')
    eq([...oa.keys()].filter((id) => !na.has(id)), [], '사라진 authored edge')
    const e329 = na.get('E-0329')
    eq([e329.fromIntentId, e329.toIntentId, e329.relationType, e329.placement, e329.priority, e329.reciprocalPolicy, e329.readerReason, e329.anchorLabel],
      ['I-T6-05', 'I-T6-01', 'NEXT_QUESTION', 'FOOTER_NEXT', 2, 'ONE_WAY', '배울 것을 고른 다음에는 지금 조건으로 일을 다시 시작하려면 어디부터 알아볼지 묻게 된다', '재취업은 어디부터 알아볼까'], 'E-0329 고정값')
    const tup = (e) => J([e.fromIntentId, e.toIntentId, e.relationType, e.placement, e.readerReason])
    const oById = new Map(o.edges.map((e) => [e.edgeId, e])), nById = new Map(n.edges.map((e) => [e.edgeId, e]))
    const liveChanged = new Set(['I-T6-01']) // starting-work-at-this-age 매핑 제거로 LIVE slug 목록이 바뀐 intent
    const DERIVED = new Set(['fromLive', 'toLive'])
    for (const [id, a] of oa) {
      const b = na.get(id)
      for (const k of Object.keys({ ...a, ...b }).filter((x) => J(a[x]) !== J(b[x]))) {
        if (k === 'reverseEdgeId') { ok(oById.get(a.reverseEdgeId)?.generatedBy && tup(oById.get(a.reverseEdgeId)) === tup(nById.get(b.reverseEdgeId)), `${id} reverseEdgeId 가 다른 의미의 edge 로 옮겨 갔다`); continue }
        ok(DERIVED.has(k) && (liveChanged.has(a.fromIntentId) || liveChanged.has(a.toIntentId)), `${id}.${k} 승인 밖 변화`)
        const removed = [...(a[k] ?? [])].filter((x) => !(b[k] ?? []).includes(x)), addedLive = [...(b[k] ?? [])].filter((x) => !(a[k] ?? []).includes(x))
        eq([removed, addedLive], [['starting-work-at-this-age'], []], `${id}.${k}`)
      }
    }
    const og = o.edges.filter((e) => e.generatedBy), ng = n.edges.filter((e) => e.generatedBy)
    eq(ng.map(tup).sort(), og.map(tup).sort(), 'generated 의미 tuple 집합')
    const gBy = new Map(og.map((e) => [tup(e), e]))
    for (const e of ng) { const a = gBy.get(tup(e)); eq(Object.keys({ ...a, ...e }).filter((k) => !['edgeId', 'reverseEdgeId'].includes(k) && J(a[k]) !== J(e[k])), [], `generated ${e.edgeId} 기타 필드`) }
  })
  test('실제 입력 3b — money-work 를 켠 control 사본에서 GRAPH_READY 는 I-T6-05 하나 · direct E-0188 · E-0329 · discovery E-0100 · reverse E-0099', () => {
    const pt = productAt(realProduct)
    // 🔴 money-work 를 켠 control 사본 — 구조 편집(멱등). 이미 켜진 control 이어도 준비가 실패하지 않는다
    const { text: control } = ensureCluster(pt.control, 'money-work')
    ok(readControl(control).enabledClusters.includes('money-work'), 'money-work 사본 준비 실패')
    const b = lib.buildAll({ inputTexts: inputsAt(newInput), productTexts: { ...pt, control }, admissionTexts: null, effectiveAt: REAL_EFF, generatedAt: REAL_GEN })
    eq(b.readiness.rows.filter((r) => r.graphReady).map((r) => r.intentId), ['I-T6-05'], 'GRAPH_READY')
    const x = b.readiness.rows.find((r) => r.intentId === 'I-T6-05')
    eq(x.direct.targets.map((t) => `${t.edgeId}→${t.toIntentId}/${t.slug}`), ['E-0188→I-T6-04/certificate-in-50s', 'E-0329→I-T6-01/rehire-where-to-start'], 'direct')
    eq(x.discovery.targets.map((t) => t.edgeId), ['E-0100'], 'discovery')
    ok(x.reverse.sources.some((s) => s.edgeId === 'E-0099'), `reverse ${JSON.stringify(x.reverse.sources)}`)
    eq(b.layers.mappings.filter((m) => m.slug === 'starting-work-at-this-age').length, 0, 'starting-work-at-this-age graph 매핑 0')
  })
  test('실제 입력 3c — 새 snapshot: raw legacy existingAssetRelation 불일치는 산출에 남지 않는다(전 intent 요약 = mappings)', () => {
    const inputs = lib.parseInputTexts(inputsAt(newInput))
    const l = lib.buildGraphLayers({ inputs, implementedSurfaces: product.implemented })
    const f = lib.existingAssetSummaries(l.mappings)
    eq(l.intents.filter((x) => x.existingAssetRelation !== f(x.intentId)).map((x) => x.intentId), [], '산출 요약 ≠ mappings')
    const raw = new Map(inputs.automation.map((a) => [a.intentId, a.existingAssetRelation]))
    // 감사 11 + legacy 6(automation 이 canonical 을 못 따라온 행) + canonical state 가 QUEUED 로 남은 공개 글 2
    eq(l.intents.filter((x) => raw.get(x.intentId) !== x.existingAssetRelation).map((x) => x.intentId).sort(),
      [...LIFECYCLE_11.map((k) => k.split('|')[0]), 'I-T3-06', 'I-T7-05', 'I-T6-12', 'I-T6-13', 'I-T8-38', 'I-T4-15', 'I-T5-07', 'I-T1-26'].sort(), 'raw ≠ 산출 집합')
    const at = (id) => l.intents.find((x) => x.intentId === id).existingAssetRelation
    eq(['I-T3-06', 'I-T7-05', 'I-T6-12', 'I-T6-13', 'I-T8-38', 'I-T4-15'].map(at),
      ['child-marriage-silence(PUBLISHED/ANSWERS)', 'alone-pastime(PUBLISHED/ANSWERS)', 'retirement-others-what-work(PUBLISHED/ANSWERS)',
        'job-credentials(PUBLISHED/ANSWERS)', 'gray-hair-leave-as-is(PUBLISHED/ANSWERS)', 'clinic-booking-app(PUBLISHED/ANSWERS)'], 'legacy 6건 산출')
    eq(at('I-T6-01'), 'rehire-where-to-start(PUBLISHED/ANSWERS)', 'I-T6-01 산출')
  })
  test('실제 입력 4 — 제품 lifecycle 경계: money-work 10:29:59 = cold-weather · 10:30:00 = cold-weather + kimjang · kimjang-live = cold-weather · kimjang-cold-live = 0 · 교차 8건 drift 0', () => {
    const root = dirname(newInput)
    const articles = parseArticlesForReal()
    const at = (snap, eff) => lib.productLifecycleDrift({ inputs: lib.parseInputTexts(inputsAt(join(root, snap))), articles, effectiveMs: Date.parse(eff) }).map((d) => d.slug)
    eq(at('2026-10-17-money-work', '2026-10-17T10:29:59+09:00'), ['cold-weather-joint-pain'], 'old 10:29:59')
    eq(at('2026-10-17-money-work', '2026-10-17T10:30:00+09:00'), ['cold-weather-joint-pain', 'kimjang-back-pain-prep'], 'old 10:30:00')
    eq(at('2026-10-17-money-work-kimjang-live', '2026-10-17T10:30:00+09:00'), ['cold-weather-joint-pain'], 'kimjang-live')
    eq(at('2026-10-17-money-work-kimjang-cold-live', '2026-10-17T10:30:00+09:00'), [], 'kimjang-cold-live')
    const r = rejectWhy(() => lib.buildAll({ inputTexts: inputsAt(join(root, '2026-10-17-money-work')), productTexts: productAt(realProduct), admissionTexts: null, effectiveAt: '2026-10-17T10:30:00+09:00', generatedAt: REAL_GEN }))
    ok(r?.code === 'INPUT_PRODUCT_LIFECYCLE_DRIFT' && r.why.startsWith('2개 slug'), JSON.stringify(r).slice(0, 200))
  })
  test('실제 입력 — 새 snapshot 에서 automation 첫 행 primaryQuery 를 지우면 INPUT_SCHEMA_INVALID (bundle 0)', () => {
    const inputTexts = inputsAt(newInput)
    const rows = inputTexts['g4-automation-2026-09-23.jsonl'].trim().split('\n')
    const first = JSON.parse(rows[0]); delete first.primaryQuery; rows[0] = JSON.stringify(first)
    inputTexts['g4-automation-2026-09-23.jsonl'] = rows.join('\n') + '\n'
    const r = rejectWhy(() => lib.buildAll({ inputTexts, productTexts: productAt(realProduct), admissionTexts: null, effectiveAt: REAL_EFF, generatedAt: REAL_GEN }))
    ok(r?.code === 'INPUT_SCHEMA_INVALID' && /primaryQuery 누락/.test(r.why), JSON.stringify(r).slice(0, 300))
  })
  test('실제 입력 — 새 snapshot 의 첫 graph 행 edgeId 를 null 로 손상하면 INPUT_SCHEMA_INVALID (bundle 0)', () => {
    const inputTexts = inputsAt(newInput)
    const rows = inputTexts['g5-graph-2026-09-23.jsonl'].trim().split('\n')
    rows[0] = JSON.stringify({ ...JSON.parse(rows[0]), edgeId: null })
    inputTexts['g5-graph-2026-09-23.jsonl'] = rows.join('\n') + '\n'
    const r = rejectWhy(() => lib.buildAll({ inputTexts, productTexts: productAt(realProduct), admissionTexts: null, effectiveAt: REAL_EFF, generatedAt: REAL_GEN }))
    eq(r?.code, 'INPUT_SCHEMA_INVALID', '손상 입력')
  })
} else {
  results.push('  ⏭  실제 입력 재현성 — --old-input · --new-input · --real-product 미지정 (통과로 세지 않는다)')
}

rmSync(TMP, { recursive: true, force: true })
process.stdout.write(`M-GRAPH 결정적 build 검사\n${results.join('\n')}\nRESULT pass=${pass} fail=${failN}\n`)
process.exit(failN ? 1 : 0)
