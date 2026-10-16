#!/usr/bin/env node
/**
 * M-GRAPH 결정적 build · readiness 반례 검사.
 *
 *   node scripts/magazine-graph-build-check.mjs [--real-input <연구 입력 폴더> --real-product <제품 루트>]
 *
 * 합성 fixture 만 쓴다(임시 폴더). 운영 연구 폴더 · 제품 graph 파일을 쓰지 않는다.
 * `--real-input` 을 주면 실제 입력으로 현재 제품 bundle 과의 의미·해시 동일성을 **추가로** 본다(읽기 전용).
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
  reciprocalPolicy: 'ONE_WAY', reciprocalGroupId: null, backlinkStatus: 'NONE', backlinkPlan: null, reciprocalWhy: null, ...extra })

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
const ARTICLES = `export const MAGAZINE_ARTICLE_RECORD: Record<string, MagazineArticle> = ${JSON.stringify({
  p1: art('fam', '2026-10-01T10:30:00+09:00'), p2: art('fam', '2026-10-02T10:30:00+09:00'), p3: art('fam', '2026-10-03T10:30:00+09:00'),
  d: art('rel', '2026-10-04T10:30:00+09:00'), h: art('fam', '2026-10-05T10:30:00+09:00'),
  u: art('fam', '2026-12-31T10:30:00+09:00'), w: art('fam', '2026-10-06T10:30:00+09:00'),
}, null, 2)}\n`
const ADMISSION = { slugManifest: JSON.stringify({ slugs: { 'I-X': 'x-slug' } }), ledger: '' }

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const inputTextsOf = (w) => ({
  'g4-intents-canonical.jsonl': jsonl(w.canonical), 'g4-automation-2026-09-23.jsonl': jsonl(w.automation),
  'g5-graph-2026-09-23.jsonl': jsonl(w.graph), 'assets-published.jsonl': jsonl(w.published), 'assets-queue.jsonl': jsonl(w.queued),
})
const EFF = '2026-10-15T13:00:00+09:00'
const GEN = '2026-10-15T04:43:55.080Z'
const build = ({ world = baseWorld(), control = controlText(), admission = ADMISSION, effectiveAt = EFF, generatedAt = GEN } = {}) =>
  lib.buildAll({ inputTexts: inputTextsOf(world), productTexts: { resolver: RESOLVER, control, articles: ARTICLES },
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
  'src/content/magazine/graph/current.ts': "export { GRAPH, EXPORT_HASH } from './g-00000000-000000'\n" })
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
  for (const [name, mutate] of Object.entries(cases)) {
    const w = baseWorld(); mutate(w)
    let code = null, built = null
    try { built = build({ world: w }) } catch (e) { code = e.code }
    eq([code, built === null], ['INPUT_SCHEMA_INVALID', true], name)
  }
})

// ── 실제 입력 동일성 (선택) ──
const realInput = argOf('--real-input'), realProduct = argOf('--real-product')
if (realInput && realProduct) {
  test('실제 입력 — 2026-10-15 family 입력이 현재 제품 bundle 과 같은 판 · 같은 EXPORT_HASH · 같은 GRAPH 본문', () => {
    const read = (p) => readFileSync(p, 'utf8')
    const inputTexts = Object.fromEntries(Object.values(lib.INPUT_FILES).map((n) => [n, read(join(realInput, n))]))
    const productTexts = Object.fromEntries(Object.entries(lib.PRODUCT_FILES).map(([k, rel]) => [k, read(join(realProduct, rel))]))
    const b = lib.buildAll({ inputTexts, productTexts, admissionTexts: null, effectiveAt: EFF, generatedAt: GEN })
    eq([b.graphVersion, b.manifest.contentHash.combined, b.manifest.exportHash], ['g-20261015-d5f6fe', 'd5f6fe78fc422b1b', '87c775af6cd5ea0f'], '판')
    const strip = (t) => t.split('\n').slice(3).join('\n')
    eq(strip(b.files[`bundle/${b.graphVersion}.ts`]), strip(read(join(realProduct, `src/content/magazine/graph/${b.graphVersion}.ts`))), 'GRAPH 본문')
  })
  test('실제 입력 — 첫 graph 행 edgeId 를 null 로 손상하면 INPUT_SCHEMA_INVALID (bundle 0)', () => {
    const read = (p) => readFileSync(p, 'utf8')
    const inputTexts = Object.fromEntries(Object.values(lib.INPUT_FILES).map((n) => [n, read(join(realInput, n))]))
    const rows = inputTexts['g5-graph-2026-09-23.jsonl'].trim().split('\n')
    rows[0] = JSON.stringify({ ...JSON.parse(rows[0]), edgeId: null })
    inputTexts['g5-graph-2026-09-23.jsonl'] = rows.join('\n') + '\n'
    const productTexts = Object.fromEntries(Object.entries(lib.PRODUCT_FILES).map(([k, rel]) => [k, read(join(realProduct, rel))]))
    let code = null, built = null
    try { built = lib.buildAll({ inputTexts, productTexts, admissionTexts: null, effectiveAt: EFF, generatedAt: GEN }) } catch (e) { code = e.code }
    eq([code, built === null], ['INPUT_SCHEMA_INVALID', true], '손상 입력')
  })
} else {
  results.push('  ⏭  실제 입력 동일성 — --real-input · --real-product 미지정 (통과로 세지 않는다)')
}

rmSync(TMP, { recursive: true, force: true })
process.stdout.write(`M-GRAPH 결정적 build 검사\n${results.join('\n')}\nRESULT pass=${pass} fail=${failN}\n`)
process.exit(failN ? 1 : 0)
