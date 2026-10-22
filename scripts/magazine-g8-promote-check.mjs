#!/usr/bin/env node
/**
 * G8 편입기 검사 — 임시 fixture 에서만 쓴다. 운영 파일·연구 정본에는 쓰지 않는다.
 *
 * 무엇을 보나 (g8-promotion/2 — G8 은 GRAPH_READY intent 의 영구 신원 admission 도구다)
 *   Ⓐ dry-run — 후보는 builder GRAPH_READY 뿐 · 큐 행·콘텐츠 계획 필드 0 · 입력 15개 · 결정적 · 쓰기 0 · 연구 current 미사용
 *   Ⓑ snapshot ↔ 제품 bundle — payload · contentHash · EXPORT_HASH · graphVersion · semanticHash · current · control 전부 대조
 *   Ⓒ receipt 불변식 — 파일명 · manifest 해시 · receiptHash · 사람 승인 · confirm hash
 *   Ⓓ 신원 입력 15개 — 하나씩 바뀌면 journal 전에 STALE_INPUT · 쓰기 0
 *   Ⓔ staged preflight — 한 admission 이라도 실패하면 세 파일 쓰기 0
 *   Ⓕ apply — 세 파일만 · 제품·큐 바이트 불변 · ALREADY_APPLIED · 반쪽 상태는 INCONSISTENT
 *   Ⓖ 급사 7지점 — 잠금 유지 · 명시 stale lock 경로만 · commit-forward 로 ADMITTED · ledger 단조 증가
 *   Ⓗ CONFLICT — receipt · slug manifest · ledger 가 before 도 after 도 아니면 덮지 않는다
 *   Ⓘ KNOWN_LEGACY — 정확한 열거만 · UNKNOWN 실패
 *   Ⓙ 잠금 — O_EXCL · 자동 탈취 0 · 실제 자식 프로세스 동시 apply · 실제 SIGKILL
 *   Ⓚ 공용 helper — journal 신원 · G8 v1 큐 대조(DIRECT source 가 아직 쓴다)
 *   ⑬ ⑮ ⑯ ⑰ ⑱ M-AUTO 등록의 큐 writer 잠금 · 쌍 원복 · durable transaction (다른 큐 writer 와의 경합)
 *   ⑪ (연구 디렉터리가 있을 때만) 정본 pipeline 사본 대조 · 실제 장부 KNOWN_LEGACY · 실제 snapshot dry-run
 *
 * 🔴 `G8_PROMOTER_LIB` 는 변이 시험(`magazine-g8-promote-mutation.mjs`)이 바꾼 lib 를 넣는 자리다.
 *    그때는 CLI 자식 프로세스도 변이된 lib 옆의 CLI 사본을 쓴다 — 운영 CLI 는 이 변수를 읽지 않는다.
 *
 * 사용: node scripts/magazine-g8-promote-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArticlesSource, parseQueueSource } from './lib/magazine-load.mjs'

/**
 * 🔴 큐 writer 잠금은 논리 scope 하나다. 이 검사는 **자기만의 시험 scope** 를 쓴다 —
 *    운영 scope 잠금과 절대 겹치지 않고, 자식 프로세스도 같은 값을 물려받는다.
 */
process.env.SORAN_MAGAZINE_TEST_MODE = '1'
process.env.SORAN_MAGAZINE_QUEUE_LOCK_SCOPE = `test-g8-check-${process.pid}`
const TEST_SCOPE = process.env.SORAN_MAGAZINE_QUEUE_LOCK_SCOPE
/**
 * 🔴 잠금 **파일**도 운영 queue-locks 밖에 둔다 — 자식도 물려받는다 (2026-10-11 실측).
 *    앞판은 시험 scope 이름만 달랐을 뿐 `~/Library/Application Support/soransoran/queue-locks/` 안에 만들고 지웠다.
 */
const TEST_LOCK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-check-locks-'))
process.env.SORAN_MAGAZINE_QUEUE_LOCK_DIR = TEST_LOCK_DIR

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const LIB = process.env.G8_PROMOTER_LIB ?? path.join(HERE, 'lib/magazine-g8-promoter.mjs')
const lib = await import(pathToFileURL(LIB).href)
const builder = await import(pathToFileURL(path.join(path.dirname(LIB), 'magazine-graph-build.mjs')).href)
const CLI_REAL = path.join(HERE, 'magazine-g8-promote.mjs')
const PIPELINE_FIXTURE = path.join(HERE, '__fixtures__/magazine-g8')
const GEFF = '2026-10-15T13:00:00+09:00'
const AT = '2026-10-15T14:00:00+09:00'
const COMMITTED = '2026-10-15T15:00:00+09:00'

let pass = 0
let fail = 0
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}\n     기대 ${JSON.stringify(want)}\n     실제 ${JSON.stringify(got)}`) }
}
const finish = () => { console.log(`\n${fail ? '🔴' : '✅'} G8 편입기 검사 ${pass}/${pass + fail}\n`) }
process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e.message}`); finish(); process.exit(1) })
process.on('unhandledRejection', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.message ?? e}`); finish(); process.exit(1) })

/**
 * 🔴 변이 시험에서는 CLI 도 변이된 lib 를 써야 한다 — 그렇지 않으면 자식 프로세스 시험이 원본 lib 를 검사한다.
 *    변이 lib 폴더(…/lib) 옆에 CLI 사본을 둔다 — 같은 상대 경로 import 를 그대로 쓴다.
 */
function cliPath() {
  if (!process.env.G8_PROMOTER_LIB) return CLI_REAL
  const copy = path.join(path.dirname(path.dirname(LIB)), 'magazine-g8-promote.mjs')
  if (!fs.existsSync(copy)) fs.copyFileSync(CLI_REAL, copy)
  return copy
}
const CLI = cliPath()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(file, ms = 15000) {
  const until = Date.now() + ms
  while (!fs.existsSync(file)) { if (Date.now() > until) return false; await sleep(20) }
  return true
}
const exitOf = (child) => new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })))
const stdoutOf = (child) => { let s = ''; child.stdout.on('data', (d) => { s += d }); return () => s }
const parseJson = (text, fallback) => { try { return JSON.parse(text) } catch { return fallback } }
const write = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const fixtures = []

/** 디렉터리 전체의 파일 → sha256. 새 파일·지운 파일·바뀐 바이트를 모두 잡는다 */
function snapshot(root) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name)
      if (e.isSymbolicLink()) out[path.relative(root, f)] = `LINK:${fs.readlinkSync(f)}`
      else if (e.isDirectory()) { out[`${path.relative(root, f)}/`] = 'DIR'; walk(f) } else out[path.relative(root, f)] = lib.sha256(fs.readFileSync(f, 'utf8'))
    }
  }
  walk(root)
  return out
}

// ── G8 fixture ──────────────────────────────────────────────
// X1 · X2: GRAPH_READY(direct 2 · discovery 1 · reverse 1). Y: GRAPH_INCOMPLETE(direct 1). Z: BLOCKED(꺼진 cluster).
const intent = (intentId, magazineCluster, extra = {}) => ({ intentId, primaryQuery: `${intentId} 질문`, territoryId: 'T3', magazineCluster,
  audienceSituation: 's', policyScope: 'ALLOWED', policyScopeWhy: 'w', verificationProfile: 'STANDARD', profileSpec: {},
  automationDecision: 'PASS', topicVerdict: 'AUTO_READY_TOPIC', verdictWhy: 'v', runtimeState: 'UNPUBLISHED',
  evidence: { refs: 2 }, existingAssetRelation: '없음', ...extra })
const canon = (intentId, slugs = []) => ({ intentId, answerScope: 'a', exclusions: [], existingSlugs: slugs.map((slug) => ({ slug, coverage: 'ANSWERS', cluster: 'fam' })) })
const edge = (edgeId, fromIntentId, toIntentId, relationType, placement, extra = {}) => ({ edgeId, fromIntentId, toIntentId, relationType,
  readerReason: `${fromIntentId}에서 ${toIntentId}로 가는 이유`, anchorLabel: `${toIntentId} 보기`, placement, priority: 1,
  reciprocalPolicy: 'ONE_WAY', reciprocalGroupId: null, backlinkPlan: null, reciprocalWhy: null, ...extra })
const SNAPSHOT_TEXTS = {
  'g4-intents-canonical.jsonl': jsonl([canon('I-X1'), canon('I-X2'), canon('I-P1', ['p1']), canon('I-P2', ['p2']), canon('I-P3', ['p3']), canon('I-D', ['d']), canon('I-Y'), canon('I-Z')]),
  'g4-automation-2026-09-23.jsonl': jsonl([intent('I-X1', 'fam', { primaryQuery: '배우고 싶은 것을 고를 때' }), intent('I-X2', 'fam', { primaryQuery: '하루 일과를 다시 짤 때' }),
    intent('I-P1', 'fam'), intent('I-P2', 'fam'), intent('I-P3', 'fam'), intent('I-D', 'rel'),
    intent('I-Y', 'fam', { primaryQuery: '한 가지만 이어지는 질문' }), intent('I-Z', 'off', { primaryQuery: '꺼진 분류의 질문' })]),
  'g5-graph-2026-09-23.jsonl': jsonl([
    edge('E-0001', 'I-X1', 'I-P1', 'NEXT_QUESTION', 'FOOTER_NEXT', { reverseEdgeId: 'E-0007' }),
    edge('E-0002', 'I-X1', 'I-P2', 'SIBLING', 'FOOTER_SIBLING'),
    edge('E-0003', 'I-X1', 'I-D', 'BRIDGE', 'FOOTER_BRIDGE'),
    edge('E-0004', 'I-X2', 'I-P2', 'NEXT_QUESTION', 'FOOTER_NEXT', { reverseEdgeId: 'E-0008' }),
    edge('E-0005', 'I-X2', 'I-P3', 'SIBLING', 'FOOTER_SIBLING'),
    edge('E-0006', 'I-X2', 'I-D', 'BRIDGE', 'FOOTER_BRIDGE'),
    edge('E-0007', 'I-P1', 'I-X1', 'NEXT_QUESTION', 'FOOTER_NEXT', { reverseEdgeId: 'E-0001' }),
    edge('E-0008', 'I-P2', 'I-X2', 'NEXT_QUESTION', 'FOOTER_NEXT', { reverseEdgeId: 'E-0004' }),
    edge('E-0009', 'I-Y', 'I-P1', 'NEXT_QUESTION', 'FOOTER_NEXT'),
    edge('E-0010', 'I-Y', 'I-D', 'BRIDGE', 'FOOTER_BRIDGE'),
    edge('E-0011', 'I-Z', 'I-P1', 'NEXT_QUESTION', 'FOOTER_NEXT'),
    edge('E-0012', 'I-Z', 'I-P2', 'SIBLING', 'FOOTER_SIBLING'),
    edge('E-0013', 'I-Z', 'I-D', 'BRIDGE', 'FOOTER_BRIDGE'),
  ]),
  'assets-published.jsonl': jsonl(['p1', 'p2', 'p3', 'd'].map((slug) => ({ slug, assetState: 'LIVE' }))),
  'assets-queue.jsonl': '',
}
const RESOLVER = `export const IMPLEMENTED_SURFACES = [\n  'CTA_END',\n  'FOOTER_NEXT',\n  'FOOTER_SIBLING',\n  'FOOTER_BRIDGE',\n] as const
export const FOOTER_SURFACES = ['FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE'] as const
export const MAGAZINE_RELATION_TYPES = [\n  'PREREQUISITE',\n  'NEXT_QUESTION',\n  'SIBLING',\n  'SERIES',\n  'BRIDGE',\n  'ACTION',\n  'COMMUNITY',\n] as const\n`
const controlText = (gv) => `export const CONTROL: MagazineGraphControl = {\n  graphVersion: '${gv}',\n  enabled: true,\n  enabledClusters: ["fam","rel"],\n  surfaces: {"CTA_END":true,"FOOTER_NEXT":true,"FOOTER_SIBLING":true,"FOOTER_BRIDGE":true},\n  killSwitch: {"tripped":false,"trippedAt":null,"trippedBy":null,"reason":null},\n  previousGraphVersion: null,\n} as const\n`
const art = (title, cluster, publishAt) => ({ title, cluster, publishedAt: publishAt.slice(0, 10), status: 'SCHEDULED', publishAt })
const ARTICLES_TEXT = `export const MAGAZINE_ARTICLE_RECORD: Record<string, MagazineArticle> = ${JSON.stringify({
  p1: art('첫째 공개 글', 'fam', '2026-10-01T10:30:00+09:00'), p2: art('둘째 공개 글', 'fam', '2026-10-02T10:30:00+09:00'),
  p3: art('셋째 공개 글', 'fam', '2026-10-03T10:30:00+09:00'), d: art('넷째 공개 글', 'rel', '2026-10-04T10:30:00+09:00') }, null, 2)}\n`
const SLUG_TABLE = { '배우고 싶은 것을 고를 때': 'learn-pick', '하루 일과를 다시 짤 때': 'day-plan', '한 가지만 이어지는 질문': 'one-link', '꺼진 분류의 질문': 'off-cluster' }
/** 🔴 G8 은 순수 proposeSlug 만 쓴다 — 나머지 둘은 부르면 던진다 (assignSlugs · collectTakenSlugs 호출 0 반례) */
const SLUG_MODULE = `const T = ${JSON.stringify(SLUG_TABLE)}
export function proposeSlug(q) { return T[q] ?? '' }
export function assignSlugs() { throw new Error('G8 이 assignSlugs 를 불렀다') }
export function collectTakenSlugs() { throw new Error('G8 이 collectTakenSlugs 를 불렀다') }
`
const LEGACY_LINE = JSON.stringify({ schemaVersion: 'm3ledger/2', event: 'ADMITTED', intentId: 'I-LEG', slug: 'legacy-slug', title: '예전 편입 주제', cluster: 'fam',
  directRelations: [], discoveryRelation: null, internalLinks: [], at: '2026-09-24T09:00:00+09:00' })
const LEGACY_LIST = [{ intentId: 'I-LEG', slug: 'legacy-slug', lineSha256: lib.sha256(LEGACY_LINE) }]
const BUILT = builder.buildAll({ inputTexts: SNAPSHOT_TEXTS, productTexts: { resolver: RESOLVER, control: controlText('g-00000000-000000'), articles: ARTICLES_TEXT },
  admissionTexts: null, effectiveAt: GEFF, generatedAt: '2026-10-15T04:00:00.000Z' })
const GV = BUILT.graphVersion

/**
 * @param {{ legacy?: boolean, pipelineSrc?: string|null }} o
 *   legacy — 장부에 receipt 없는 편입 1행 + slug binding (KNOWN_LEGACY 반례용 · in-process 에서 knownLegacy 를 함께 준다)
 *   pipelineSrc — 정본 recordAdmission 을 감싼 시험 대역 (staged preflight 반례용)
 */
function makeG8({ legacy = false, pipelineSrc = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-check-'))
  fixtures.push({ dir })
  const research = path.join(dir, 'research')
  const repo = path.join(dir, 'repo')
  const snap = path.join(research, 'reconciled', 'fx-snapshot')
  for (const [n, t] of Object.entries(SNAPSHOT_TEXTS)) write(snap, n, t)
  write(repo, lib.PRODUCT_FILES.articles, ARTICLES_TEXT)
  const realQueue = fs.readFileSync(path.join(REPO, 'drafts/magazine/topic-queue.ts'), 'utf8')
  const header = realQueue.slice(0, realQueue.indexOf('export const TOPIC_QUEUE'))
  write(repo, lib.PRODUCT_FILES.queue, `${header}export const TOPIC_QUEUE: TopicQueueItem[] = [\n${lib.renderQueueRow({ day: 10, slug: 'queued-one', title: '큐에 있던 주제',
    contentType: 'EVERGREEN', intent: '상황', cluster: 'fam', target: '50대', riskLevel: 'LOW', reviewMode: 'SUMMARY_ONLY', imageMode: 'OPTIONAL',
    autoEligible: true, ctaBoard: '/community/free', internalLinks: [], whyNow: '기존 행', notes: '기존 행' })}]\n`)
  write(repo, lib.PRODUCT_FILES.graphCurrent, `export { GRAPH, EXPORT_HASH } from './${GV}'\n`)
  write(repo, `src/content/magazine/graph/${GV}.ts`, BUILT.files[`bundle/${GV}.ts`])
  write(repo, lib.PRODUCT_FILES.graphControl, controlText(GV))
  write(repo, lib.PRODUCT_FILES.graphResolver, RESOLVER)
  fs.mkdirSync(path.join(repo, 'drafts/magazine/draft-only'), { recursive: true })
  for (const f of ['m3-pipeline.mjs', 'm3-product.mjs']) { fs.mkdirSync(path.join(research, 'contract'), { recursive: true }); fs.copyFileSync(path.join(PIPELINE_FIXTURE, f), path.join(research, 'contract', f)) }
  if (pipelineSrc) {
    fs.renameSync(path.join(research, 'contract/m3-pipeline.mjs'), path.join(research, 'contract/m3-pipeline-real.mjs'))
    write(research, 'contract/m3-pipeline.mjs', pipelineSrc)
  }
  write(research, lib.RESEARCH_FILES.slugModule, SLUG_MODULE)
  write(research, lib.ADMISSION_FILES.slugManifest, `${JSON.stringify({ _note: 'fixture', asOf: '2026-09-24', slugs: legacy ? { 'I-LEG': 'legacy-slug' } : {} }, null, 2)}\n`)
  if (legacy) write(research, lib.ADMISSION_FILES.ledger, `${LEGACY_LINE}\n`)
  return { dir, research, repo, snapshot: snap, legacyList: legacy ? LEGACY_LIST : [] }
}
const filesOfG8 = (f) => ({ slug: path.join(f.research, lib.ADMISSION_FILES.slugManifest), ledger: path.join(f.research, lib.ADMISSION_FILES.ledger) })
const research3 = (f) => {
  const fl = filesOfG8(f)
  const rd = path.join(f.research, lib.RECEIPT_DIR)
  return {
    slug: fs.existsSync(fl.slug) ? fs.readFileSync(fl.slug, 'utf8') : null,
    ledger: fs.existsSync(fl.ledger) ? fs.readFileSync(fl.ledger, 'utf8') : null,
    receipts: fs.existsSync(rd) ? fs.readdirSync(rd).sort().map((n) => `${n}:${lib.sha256(fs.readFileSync(path.join(rd, n), 'utf8'))}`) : [],
    journal: fs.existsSync(path.join(f.research, lib.JOURNAL_FILE)),
    lock: fs.existsSync(path.join(f.research, lib.LOCK_FILE)),
  }
}
const build = (f, o = {}) => lib.buildManifest({ repoDir: f.repo, researchDir: f.research, snapshotDir: f.snapshot, at: o.at ?? AT })
const approvalOf = (m, o = {}) => ({ approvedBy: '김운영', approvedAt: '2026-10-15T14:30:00+09:00', confirmManifestHash: m.hash, ...o })
const apply = (f, m, o = {}) => lib.applyAdmissions({ manifest: m, repoDir: f.repo, researchDir: f.research, snapshotDir: f.snapshot,
  approval: o.approval ?? approvalOf(m), committedAt: o.committedAt ?? COMMITTED, faultHook: o.faultHook ?? (() => {}), knownLegacy: f.legacyList })
const verifyNow = (f) => lib.verifyAdmissionState({ researchDir: f.research, repoDir: f.repo, knownLegacy: f.legacyList })
const ledgerRows = (text) => (text ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const codeOf = async (p) => { try { await p; return 'NO_THROW' } catch (e) { return e.code ?? e.message } }

// ── Ⓐ dry-run ──────────────────────────────────────────────
console.log('Ⓐ dry-run — 후보는 builder GRAPH_READY 뿐 · 콘텐츠 계획 필드 0 · 쓰기 0')
{
  const f = makeG8()
  const pre = { r: snapshot(f.research), p: snapshot(f.repo) }
  const m = await build(f)
  const m2 = await build(f)
  expect('schema g8-promotion/2 · 같은 입력 → 같은 hash', [m.schema, m.hash === m2.hash, m.hash === lib.hashManifest(m)], ['g8-promotion/2', true, true])
  expect('hash = hash 를 뺀 canonical JSON sha256', m.hash, lib.sha256(lib.canonicalJson(Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'hash')))))
  expect('후보 = GRAPH_READY 두 개 (I-X1 · I-X2) · INCOMPLETE · BLOCKED 0', m.admissions.map((a) => a.intentId), ['I-X1', 'I-X2'])
  const ready = builder.computeGraphAndReadiness({ inputTexts: SNAPSHOT_TEXTS, productTexts: { resolver: RESOLVER, control: controlText(GV), articles: ARTICLES_TEXT },
    admissionTexts: { slugManifest: fs.readFileSync(filesOfG8(f).slug, 'utf8'), ledger: null }, effectiveAt: GEFF }).readiness.rows
  expect('builder 판정 — Y GRAPH_INCOMPLETE · Z BLOCKED', ready.filter((r) => ['I-Y', 'I-Z'].includes(r.intentId)).map((r) => r.status), ['GRAPH_INCOMPLETE', 'BLOCKED'])
  const x1 = m.admissions[0]
  expect('관계 신원 — direct E-0001 · E-0002 · discovery E-0003 · reverse E-0007',
    [x1.slug, x1.direct.map((x) => x.edgeId), x1.discovery.edgeId, x1.reverse, x1.direct[0].anchorLabel, x1.direct[0].targetSlug], ['learn-pick', ['E-0001', 'E-0002'], 'E-0003', ['E-0007'], 'I-P1 보기', 'p1'])
  expect('큐 행 · 콘텐츠 계획 필드 0', ['queueRows', 'fallbackRows', 'selection', 'classification'].filter((k) => k in m)
    .concat(JSON.stringify(m.admissions).match(/contentType|searchIntent|riskLevel|ctaBoard|validationProfile/g) ?? []), [])
  expect('manifest 필드 (graphEffectiveAt 없음)', Object.keys(m).sort(), ['admissions', 'at', 'graph', 'hash', 'identityInputHashes', 'readiness', 'refused', 'schema', 'snapshot'])
  expect('신원 입력 정확히 15개', Object.keys(m.identityInputHashes), ['product.articles', 'product.topicQueue', 'product.draftsSlugSet', 'product.graphCurrent',
    'product.graphBundle', 'product.graphControl', 'product.graphResolver', 'research.slugManifest', 'research.ledger', 'research.slugModule',
    ...lib.SNAPSHOT_FILES.map((n) => `snapshot.${n}`)])
  expect('graph · readiness 블록', [m.graph.graphVersion, m.graph.contentHash.combined, m.readiness.inputs.graphVersion, typeof m.readiness.readinessFileSha256, m.snapshot.name],
    [GV, BUILT.manifest.contentHash.combined, GV, 'string', 'fx-snapshot'])
  expect('dry-run 쓰기 0 · 연구 current 없이 돈다', [JSON.stringify(snapshot(f.research)) === JSON.stringify(pre.r), JSON.stringify(snapshot(f.repo)) === JSON.stringify(pre.p),
    fs.existsSync(path.join(f.research, 'contract/build'))], [true, true, false])
  {
    // 🔴 --at 이 snapshot 의 공개 글보다 이르면 그 시각의 제품과 snapshot lifecycle 이 다르다 — 거부
    let e = null
    try { await build(f, { at: '2026-09-30T00:00:00+09:00' }) } catch (x) { e = x }
    expect('--at 시각에 snapshot lifecycle 이 제품과 다르면 GRAPH_BUNDLE_MISMATCH (lifecycle drift)', [e?.code, String(e?.why ?? '').includes('INPUT_PRODUCT_LIFECYCLE_DRIFT')], ['GRAPH_BUNDLE_MISMATCH', true])
  }
  expect('시각은 실제 KST 초 단위만', [await codeOf(build(f, { at: '2026-10-15' })), await codeOf(build(f, { at: '2026-02-30T13:00:00+09:00' }))], ['AT_INVALID', 'AT_INVALID'])
  {
    // 🔴 시간축 회귀 (2026-10-22 P1) — readiness 는 --at 으로 계산한다. 판 이름은 제품 current 그대로
    // 거부되면 예외가 아니라 이 반례의 실패로 드러나게 감싼다
    const nextDay = await build(f, { at: '2026-10-16T00:30:00+09:00' }).catch((e) => ({ graph: { graphVersion: e.code }, readiness: { inputs: {} }, admissions: [] }))
    expect('다른 날 --at — 판 이름 = 제품 current · readiness 시각 = --at · readinessHash 가 다르다 · 후보 같음',
      [nextDay.graph.graphVersion, nextDay.readiness.inputs.graphVersion, nextDay.readiness.inputs.effectiveAt, nextDay.readiness.readinessHash !== m.readiness.readinessHash,
        nextDay.admissions.map((a) => a.intentId)], [GV, GV, '2026-10-16T00:30:00+09:00', true, ['I-X1', 'I-X2']])
    expect('같은 날 다른 시각도 readiness 시각을 따른다', [m.readiness.inputs.effectiveAt, (await build(f, { at: GEFF })).readiness.inputs.effectiveAt], [AT, GEFF])
  }
  const cli = (args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8' })
  const base = ['--research', f.research, '--repo', f.repo, '--snapshot', f.snapshot, '--at', AT]
  const drop = (k) => base.filter((x, i) => x !== k && base[i - 1] !== k)
  expect('CLI — --snapshot · --at · --research 각각 없으면 exit 2 (기본값 없음)', ['--snapshot', '--at', '--research'].map((k) => cli(drop(k)).status), [2, 2, 2])
  expect('CLI — 없앤 --graph-effective-at 은 거부 (exit 2)', cli([...base, '--graph-effective-at', GEFF]).status, 2)
  const j = cli([...base, '--json'])
  expect('CLI dry-run — 같은 manifest · 쓰기 0', [j.status, parseJson(j.stdout, {}).hash, JSON.stringify(snapshot(f.research)) === JSON.stringify(pre.r)], [0, m.hash, true])
  expect('CLI — 옛 --queue-root 는 거부', cli([...base, '--queue-root', f.repo]).status, 2)
}
{
  // 신원 검사 — GRAPH_READY 라도 이미 쓰인 slug · 제목 · 편입은 빠진다(새 후보를 만들지 않는다)
  const f = makeG8()
  fs.mkdirSync(path.join(f.repo, 'drafts/magazine/learn-pick'), { recursive: true })
  const qf = path.join(f.repo, lib.PRODUCT_FILES.queue)
  fs.writeFileSync(qf, lib.insertQueueRows(fs.readFileSync(qf, 'utf8'), [{ day: 11, slug: 'other-slug', title: '하루 일과를 다시 짤 때', contentType: 'EVERGREEN', intent: '상황',
    cluster: 'fam', target: '50대', riskLevel: 'LOW', reviewMode: 'SUMMARY_ONLY', imageMode: 'OPTIONAL', autoEligible: true, ctaBoard: '/community/free', internalLinks: [], whyNow: 'w', notes: 'n' }]))
  const m = await build(f)
  expect('원고 폴더와 같은 slug · 큐와 같은 제목 → refused · admission 0', [m.admissions.length, m.refused.map((r) => `${r.intentId}:${r.why[0].split(' ')[0]}`)],
    [0, ['I-X1:SLUG_TAKEN', 'I-X2:TITLE_TAKEN']])
}

// ── Ⓑ snapshot ↔ 제품 bundle ────────────────────────────────
console.log('Ⓑ snapshot ↔ 제품 bundle — 선언값이 아니라 재계산으로 대조한다')
{
  const bundleRel = `src/content/magazine/graph/${GV}.ts`
  const tamper = async (name, mutate, token) => {
    const f = makeG8()
    mutate(f)
    let r = null
    try { await build(f) } catch (e) { r = e }
    expect(`${name} → GRAPH_BUNDLE_MISMATCH (${token})`, [r?.code, String(r?.why ?? '').includes(token)], ['GRAPH_BUNDLE_MISMATCH', true])
  }
  const edit = (f, rel, fn) => { const p = path.join(f.repo, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))) }
  const reExport = (text) => {
    const { payload } = lib.readBundlePayload(text)
    return text.replace(/export const EXPORT_HASH = '[0-9a-f]+'/, `export const EXPORT_HASH = '${lib.sha256(JSON.stringify(payload)).slice(0, 16)}'`)
  }
  await tamper('payload edge 이유를 바꾸고 EXPORT_HASH 는 그대로', (f) => edit(f, bundleRel, (t) => t.replace('I-X1에서 I-P1로 가는 이유', 'I-X1에서 I-P1로 가는 다른 이유')), 'EXPORT_HASH')
  await tamper('payload edge 이유를 바꾸고 EXPORT_HASH 도 다시 맞춤', (f) => edit(f, bundleRel, (t) => reExport(t.replace('I-X1에서 I-P1로 가는 이유', 'I-X1에서 I-P1로 가는 다른 이유'))), 'PAYLOAD')
  await tamper('payload contentHash.participation 만 위조 (EXPORT_HASH 재계산)', (f) => edit(f, bundleRel, (t) => reExport(t.replace(/"combined": "([0-9a-f]+)"/, '"participation": "0000000000000000",\n    "combined": "$1"'))), 'CONTENT_HASH.participation')
  await tamper('control 이 다른 판을 가리킨다 (제품 폴백)', (f) => edit(f, lib.PRODUCT_FILES.graphControl, (t) => t.replace(GV, 'g-20261015-000000')), 'CONTROL')
  const pointTo = (f, name) => {
    fs.copyFileSync(path.join(f.repo, bundleRel), path.join(f.repo, `src/content/magazine/graph/${name}.ts`))
    edit(f, lib.PRODUCT_FILES.graphCurrent, () => `export { GRAPH, EXPORT_HASH } from './${name}'\n`)
  }
  await tamper('current 가 접미사가 다른 이름의 사본을 가리킨다', (f) => pointTo(f, 'g-20261015-000000'), 'GRAPH_VERSION_MISMATCH')
  await tamper('current 가 접미사는 같고 날짜만 다른 사본을 가리킨다', (f) => pointTo(f, `g-20261014-${GV.slice(-6)}`), 'CURRENT')
}

// ── Ⓒ receipt 불변식 ─────────────────────────────────────────
console.log('Ⓒ receipt — 파일명 · manifest 해시 · receiptHash · 사람 승인 · confirm hash')
const APPLIED = await (async () => { const f = makeG8({ legacy: true }); const m = await build(f); const r = await apply(f, m); return { f, m, r } })()
{
  const { f, m, r } = APPLIED
  expect('apply → APPLIED (receipt · slug · ledger)', [r.code, r.written], ['APPLIED', ['receipt', 'slugManifest', 'ledger']])
  const file = lib.receiptPathOf(f.research, m.hash)
  const text = fs.readFileSync(file, 'utf8')
  const rc = JSON.parse(text)
  expect('receipt 구조', [rc.schema, rc.manifestHash, rc.manifest.hash, lib.hashManifest(rc.manifest), rc.approval.confirmManifestHash, rc.committedAt, rc.receiptHash === lib.receiptHashOf(rc)],
    ['g8-admission-receipt/1', m.hash, m.hash, m.hash, m.hash, COMMITTED, true])
  expect('receipt 원문 = manifest 원문 전체', lib.canonicalJson(rc.manifest), lib.canonicalJson(m))
  const forged = (name, mk, token) => {
    const { file: ff, text: tt } = mk()
    const v = lib.verifyAdmissions({ receipts: [{ file: ff, text: tt }], slugManifestText: fs.readFileSync(filesOfG8(f).slug, 'utf8'),
      ledgerText: fs.readFileSync(filesOfG8(f).ledger, 'utf8'), payloadOf: lib.productPayloadOf(f.repo), knownLegacy: f.legacyList })
    expect(`위조 receipt(${name}) → ${token}`, [v.ok, v.problems.some((p) => p.includes(token))], [false, true])
  }
  const rehash = (o) => { o.receiptHash = lib.receiptHashOf(o); return `${JSON.stringify(o, null, 2)}\n` }
  forged('파일명', () => ({ file: path.join(path.dirname(file), `${'0'.repeat(64)}.json`), text }), 'RECEIPT_FILENAME')
  forged('manifest 원문 변조 · receiptHash 재계산', () => ({ file, text: rehash({ ...rc, manifest: { ...rc.manifest, at: '2026-10-15T14:00:01+09:00' } }) }), 'RECEIPT_MANIFEST_HASH')
  forged('receiptHash 위조', () => ({ file, text: `${JSON.stringify({ ...rc, receiptHash: '0'.repeat(64) }, null, 2)}\n` }), 'RECEIPT_HASH')
  forged('기계 승인자 · receiptHash 재계산', () => ({ file, text: rehash({ ...rc, approval: { ...rc.approval, approvedBy: 'claude-code' } }) }), 'APPROVER_MACHINE')
  forged('confirm hash 불일치 · receiptHash 재계산', () => ({ file, text: rehash({ ...rc, approval: { ...rc.approval, confirmManifestHash: '1'.repeat(64) } }) }), 'CONFIRM_HASH_MISMATCH')
  forged('approval 만 바꾸고 receiptHash 그대로', () => ({ file, text: `${JSON.stringify({ ...rc, approval: { ...rc.approval, approvedAt: '2026-10-15T14:31:00+09:00' } }, null, 2)}\n` }), 'RECEIPT_HASH')
}
{
  // apply 단계의 승인 형식 — 쓰기 0
  const f = makeG8()
  const m = await build(f)
  const pre = research3(f)
  const bad = []
  for (const approval of [approvalOf(m, { approvedBy: 'codex' }), approvalOf(m, { approvedBy: '' }), approvalOf(m, { approvedAt: '2026-10-15' }), approvalOf(m, { confirmManifestHash: '0'.repeat(64) })]) {
    const r = await apply(f, m, { approval })
    bad.push(r.code)
  }
  expect('기계 · 빈 승인자 · 시각 형식 · confirm 불일치 → APPROVAL_INVALID · 쓰기 0', [bad, JSON.stringify(research3(f)) === JSON.stringify(pre)],
    [['APPROVAL_INVALID', 'APPROVAL_INVALID', 'APPROVAL_INVALID', 'APPROVAL_INVALID'], true])
  const tampered = { ...m, at: '2026-10-15T14:00:01+09:00' }
  expect('manifest 본문 변조 → HASH_MISMATCH · 쓰기 0', [(await apply(f, tampered)).code, JSON.stringify(research3(f)) === JSON.stringify(pre)], ['HASH_MISMATCH', true])
}
{
  // receipt 는 wx — 놓는 순간 다른 receipt 가 있으면 덮지 않는다(급사로 끝나고 다른 파일은 그대로)
  const f = makeG8()
  const m = await build(f)
  const foreign = '{"foreign":true}\n'
  let threw = null
  try {
    await apply(f, m, { faultHook: (s, arg) => { if (s === 'receipt:before') write(path.dirname(arg.file), path.basename(arg.file), foreign) } })
  } catch (e) { threw = e.code ?? e.message }
  expect('receipt 를 놓는 순간 이미 있으면 EEXIST 로 멈추고 기존 바이트 보존', [threw, fs.readFileSync(lib.receiptPathOf(f.research, m.hash), 'utf8')], ['EEXIST', foreign])
}

// ── Ⓓ 신원 입력 15개 ─────────────────────────────────────────
console.log('Ⓓ 신원 입력 15개 — 하나씩 바뀌면 journal 전에 STALE_INPUT · 쓰기 0')
{
  const append = (file, extra = '\n// 시험 변경\n') => fs.appendFileSync(file, extra)
  const cases = [
    ['product.articles', (f) => append(path.join(f.repo, lib.PRODUCT_FILES.articles))],
    ['product.topicQueue', (f) => append(path.join(f.repo, lib.PRODUCT_FILES.queue))],
    ['product.draftsSlugSet', (f) => fs.mkdirSync(path.join(f.repo, 'drafts/magazine/new-draft'))],
    ['product.graphCurrent', (f) => append(path.join(f.repo, lib.PRODUCT_FILES.graphCurrent))],
    ['product.graphBundle', (f) => append(path.join(f.repo, `src/content/magazine/graph/${GV}.ts`))],
    ['product.graphControl', (f) => append(path.join(f.repo, lib.PRODUCT_FILES.graphControl))],
    ['product.graphResolver', (f) => append(path.join(f.repo, lib.PRODUCT_FILES.graphResolver))],
    ['research.slugManifest', (f) => fs.writeFileSync(filesOfG8(f).slug, JSON.stringify(JSON.parse(fs.readFileSync(filesOfG8(f).slug, 'utf8'))))],
    ['research.ledger', (f) => fs.writeFileSync(filesOfG8(f).ledger, '')],
    ['research.slugModule', (f) => append(path.join(f.research, lib.RESEARCH_FILES.slugModule))],
    ...lib.SNAPSHOT_FILES.map((n) => [`snapshot.${n}`, (f) => append(path.join(f.snapshot, n), '\n')]),
  ]
  expect('반례가 15개 키 전부를 덮는다', cases.length, 15)
  for (const [key, mutate] of cases) {
    const f = makeG8()
    const m = await build(f)
    mutate(f)
    const pre = research3(f)
    const r = await apply(f, m)
    expect(`${key} 만 바뀜 → STALE_INPUT · 그 키 · journal 0 · 세 파일 쓰기 0`, [r.code, r.stale, JSON.stringify(research3(f)) === JSON.stringify(pre)], ['STALE_INPUT', [key], true])
  }
}

// ── Ⓔ staged preflight ───────────────────────────────────────
console.log('Ⓔ staged preflight — 임시 공간에서 세 최종 상태를 만들고 검증 · 하나라도 실패하면 쓰기 0')
{
  /** 정본 recordAdmission 을 감싼 시험 대역 — 정본 함수의 의미는 그대로 두고 호출 결과만 바꾼다 */
  const wrapper = (body) => `import * as real from './m3-pipeline-real.mjs'
export const validateLedger = real.validateLedger
let n = 0
export function recordAdmission(a) { n++; ${body} }
`
  const cases = [
    ['두 admission 중 두 번째 slug 충돌(정본이 거부)', wrapper("if (n === 2) return { ok: false, why: '🔴 이 slug 는 이미 다른 intent 의 것이다 (시험)' }; return real.recordAdmission(a)"), false, 'ADMISSION_REJECTED'],
    ['두 번째가 idempotent(appended=false) — 새 성공으로 세지 않는다', wrapper("if (n === 2) return { ok: true, appended: false, idempotent: true }; return real.recordAdmission(a)"), false, 'ADMISSION_REJECTED'],
    ['장부 관계가 receipt 와 다르다 — 임시 verifyAdmissions 가 막는다', wrapper('return real.recordAdmission({ ...a, item: { ...a.item, discoveryRelation: null } })'), false, 'STAGED_VERIFY_FAILED'],
    ['기존 장부 바이트를 바꾼다 — append-only 접두 위반', wrapper("const r = real.recordAdmission(a); const fs = globalThis.process.getBuiltinModule('node:fs'); const t = fs.readFileSync(a.stateFile, 'utf8'); fs.writeFileSync(a.stateFile, t.replace('예전 편입 주제', '예전 편입 주X')); return r"), true, 'LEDGER_NOT_APPEND_ONLY'],
  ]
  for (const [name, src, legacy, code] of cases) {
    const f = makeG8({ pipelineSrc: src, legacy })
    const m = await build(f)
    const pre = { r: research3(f), p: snapshot(f.repo) }
    const r = await apply(f, m)
    expect(`${name} → ${code} · 세 파일 · 제품 쓰기 0 · journal 0 · 잠금 0`, [r.code, JSON.stringify(research3(f)) === JSON.stringify(pre.r), JSON.stringify(snapshot(f.repo)) === JSON.stringify(pre.p)], [code, true, true])
  }
}

// ── Ⓕ apply · ALREADY_APPLIED ───────────────────────────────
console.log('Ⓕ apply — 연구 세 파일만 · 제품·큐 바이트 불변 · ALREADY_APPLIED')
{
  const f = makeG8({ legacy: true })
  const m = await build(f)
  const pre = { r: research3(f), p: snapshot(f.repo), slug: JSON.parse(fs.readFileSync(filesOfG8(f).slug, 'utf8')) }
  const r = await apply(f, m)
  const post = research3(f)
  const slugAfter = JSON.parse(post.slug)
  expect('APPLIED · 제품 파일 · topic queue 바이트 불변', [r.code, JSON.stringify(snapshot(f.repo)) === JSON.stringify(pre.p)], ['APPLIED', true])
  expect('slug 표 — 기존 키 그대로 · 두 키만 추가 · 다른 최상위 필드 불변', [slugAfter.slugs, slugAfter._note, slugAfter.asOf],
    [{ 'I-LEG': 'legacy-slug', 'I-X1': 'learn-pick', 'I-X2': 'day-plan' }, pre.slug._note, pre.slug.asOf])
  expect('ledger — 기존 바이트로 시작 · ADMITTED 2행 추가', [post.ledger.startsWith(pre.r.ledger), ledgerRows(post.ledger).map((x) => `${x.event}:${x.intentId}:${x.slug}`)],
    [true, ['ADMITTED:I-LEG:legacy-slug', 'ADMITTED:I-X1:learn-pick', 'ADMITTED:I-X2:day-plan']])
  expect('장부 관계 = receipt 관계 (slot · toIntentId · anchorLabel · readerReason)', ledgerRows(post.ledger)[1].directRelations,
    m.admissions[0].direct.map(({ slot, toIntentId, anchorLabel, readerReason }) => ({ slot, toIntentId, anchorLabel, readerReason })))
  expect('verifyAdmissions PASS — CURRENT 2 · KNOWN_LEGACY 1 · journal 0 · 잠금 0', [verifyNow(f).ok, verifyNow(f).classes, post.journal, post.lock],
    [true, { CURRENT: 2, KNOWN_LEGACY: 1, UNKNOWN: 0 }, false, false])
  const again = await apply(f, m)
  expect('같은 manifest 재실행 → ALREADY_APPLIED · 쓰기 0', [again.code, JSON.stringify(research3(f)) === JSON.stringify(post)], ['ALREADY_APPLIED', true])
  const sm = JSON.parse(post.slug)
  delete sm.slugs['I-X2']
  fs.writeFileSync(filesOfG8(f).slug, `${JSON.stringify(sm, null, 2)}\n`)
  const broken = research3(f)
  const r3 = await apply(f, m)
  expect('receipt 는 있는데 binding 이 빠졌다 → ALREADY_APPLIED 아님 · ADMISSION_INCONSISTENT · 쓰기 0', [r3.code, JSON.stringify(research3(f)) === JSON.stringify(broken)], ['ADMISSION_INCONSISTENT', true])
}

// ── Ⓖ 급사 7지점 ────────────────────────────────────────────
console.log('Ⓖ 급사 7지점 — 잠금 유지 · 명시 stale lock 경로 · commit-forward 로 ADMITTED · ledger 단조 증가')
class Crash extends Error { constructor() { super('시험 급사'); this.code = 'TEST_CRASH' } }
const crashAt = (stage) => (s, arg) => {
  if (s !== stage) return
  if (s === 'ledger:append') arg.appendLedger(arg.file, arg.bytes.subarray(0, Math.floor(arg.bytes.length / 2)))
  if (s === 'receipt:before') write(path.dirname(arg.file), `${path.basename(arg.file)}.g8tmp-99999`, '{"반쪽')
  throw new Crash()
}
/** 🔴 잠금 파일이 없으면 null — 변이가 잠금을 지워도 예외가 아니라 그 반례의 실패로 드러나게 한다 */
const lockText = (f) => { const p = path.join(f.research, lib.LOCK_FILE); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }
const lockSha = (f) => { const t = lockText(f); return t === null ? 'NO_LOCK' : lib.sha256(t) }
/** 🔴 복구 중 의미 함수 호출 0 — 정본 pipeline · slug 모듈을 「부르면 던지는」 대역으로 바꾼 자식 프로세스에서 복구한다 */
function recoverInChild(f, sha, operator = '김운영') {
  const keep = {}
  for (const rel of [lib.RESEARCH_FILES.pipelineModule, lib.RESEARCH_FILES.slugModule]) {
    const p = path.join(f.research, rel)
    keep[p] = fs.readFileSync(p, 'utf8')
    fs.writeFileSync(p, "throw new Error('복구가 의미 판정 모듈을 불렀다')\n")
  }
  try {
    const r = spawnSync('node', [CLI, '--recover-stale-lock', '--research', f.research, '--repo', f.repo, '--lock-sha256', sha, '--operator', operator], { encoding: 'utf8' })
    return { status: r.status, j: parseJson(r.stdout, { code: `출력 없음 ${r.stderr.slice(0, 160)}` }) }
  } finally { for (const [p, t] of Object.entries(keep)) fs.writeFileSync(p, t) }
}
for (const stage of ['journal:before', 'journal:written', 'receipt:before', 'receipt:written', 'slug:written', 'ledger:append', 'ledger:written']) {
  const f = makeG8()
  const m = await build(f)
  const lengths = [0]
  const crash = await codeOf(apply(f, m, { faultHook: crashAt(stage) }))
  const mid = research3(f)
  lengths.push(Buffer.byteLength(mid.ledger ?? ''))
  expect(`급사(${stage}) — 잠금 남음 · journal ${stage === 'journal:before' ? '없음' : '있음'}`, [crash, mid.lock, mid.journal], ['TEST_CRASH', true, stage !== 'journal:before'])
  const lockBytes = lockText(f)
  const blocked = await apply(f, m)
  expect(`급사(${stage}) 뒤 apply → ADMISSION_LOCKED · 잠금 자동 삭제 0`, [blocked.code, lockText(f) === lockBytes], ['ADMISSION_LOCKED', true])
  const wrong = recoverInChild(f, '0'.repeat(64))
  expect(`급사(${stage}) — 잘못된 잠금 sha 로는 아무것도 하지 않는다`, [wrong.j.code, JSON.stringify(research3(f)) === JSON.stringify(mid)], ['LOCK_SHA_MISMATCH', true])
  const rec = recoverInChild(f, lockSha(f))
  const after = research3(f)
  lengths.push(Buffer.byteLength(after.ledger ?? ''))
  expect(`급사(${stage}) — 명시 복구 (의미 모듈 대역 · 자식 프로세스)`, [rec.status, rec.j.code], [0, stage === 'journal:before' ? 'STALE_LOCK_RELEASED' : 'STALE_LOCK_RECOVERED'])
  const fin = await apply(f, m)
  lengths.push(Buffer.byteLength(research3(f).ledger ?? ''))
  expect(`급사(${stage}) — 재실행 뒤 ADMITTED (세 곳 일치 · 행 정확히 2 · 잠금 · journal · 임시 조각 0)`,
    [fin.code, verifyNow(f).ok, ledgerRows(research3(f).ledger).length, research3(f).lock, research3(f).journal,
      fs.readdirSync(path.join(f.research, lib.RECEIPT_DIR)).filter((n) => n.includes('g8tmp')).length],
    [stage === 'journal:before' ? 'APPLIED' : 'ALREADY_APPLIED', true, 2, false, false, 0])
  expect(`급사(${stage}) — ledger 길이 단조 증가`, lengths.every((x, i) => i === 0 || x >= lengths[i - 1]), true)
}

// ── Ⓗ CONFLICT ──────────────────────────────────────────────
console.log('Ⓗ CONFLICT — before 도 after 도 아니면 덮지 않는다 · ledger 를 줄이지 않는다')
{
  const conflict = async (name, stage, disturb, code) => {
    const f = makeG8({ legacy: true })
    const m = await build(f)
    await codeOf(apply(f, m, { faultHook: crashAt(stage) }))
    disturb(f, m)
    const pre = research3(f)
    const r = await lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: lockSha(f), operator: '김운영', knownLegacy: f.legacyList })
    const post = research3(f)
    expect(`${name} → ${code} · 세 파일 그대로 · journal 유지`, [r.code, post.slug === pre.slug, post.ledger === pre.ledger, JSON.stringify(post.receipts) === JSON.stringify(pre.receipts), post.journal],
      [code, true, true, true, true])
  }
  await conflict('다른 receipt 가 놓였다', 'journal:written', (f, m) => write(f.research, path.relative(f.research, lib.receiptPathOf(f.research, m.hash)), '{"other":1}\n'), 'RECEIPT_CONFLICT')
  await conflict('slug 표가 세 번째 상태', 'receipt:written', (f) => fs.writeFileSync(filesOfG8(f).slug, '{"slugs":{"I-Q":"q"}}\n'), 'SLUG_MANIFEST_CONFLICT')
  await conflict('ledger 에 다른 writer 가 붙였다', 'slug:written', (f) => fs.appendFileSync(filesOfG8(f).ledger, `${JSON.stringify({ schemaVersion: 'm3ledger/2', event: 'ADMITTED', intentId: 'I-Q', slug: 'q', at: '2026-10-15T15:00:00+09:00' })}\n`), 'LEDGER_CONFLICT')
  await conflict('ledger 앞부분이 같은 길이로 바뀌었다', 'slug:written', (f) => fs.writeFileSync(filesOfG8(f).ledger, fs.readFileSync(filesOfG8(f).ledger, 'utf8').replace('예전 편입 주제', '예전 편입 주X')), 'LEDGER_CONFLICT')
  {
    // 위조 journal — 다른 경로를 가리키면 아무것도 쓰지 않는다
    const f = makeG8()
    const m = await build(f)
    await codeOf(apply(f, m, { faultHook: crashAt('journal:written') }))
    const jp = path.join(f.research, lib.JOURNAL_FILE)
    const j = JSON.parse(fs.readFileSync(jp, 'utf8'))
    const victim = path.join(f.dir, 'victim.txt')
    fs.writeFileSync(victim, '연구 밖 파일')
    fs.writeFileSync(jp, JSON.stringify({ ...j, slugManifest: { ...j.slugManifest, path: victim } }))
    const pre = { r: snapshot(f.research), v: fs.readFileSync(victim, 'utf8') }
    const r = await lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: lockSha(f), operator: '김운영', knownLegacy: f.legacyList })
    const post = snapshot(f.research)
    delete pre.r[lib.LOCK_FILE]; delete post[lib.LOCK_FILE]
    expect('위조 journal(연구 밖 경로) → RECOVERY_IDENTITY · 외부 파일 · 연구 파일 변경 0', [r.code, JSON.stringify(post) === JSON.stringify(pre.r), fs.readFileSync(victim, 'utf8') === pre.v], ['RECOVERY_IDENTITY', true, true])
  }
  {
    // journal 이 남았는데 잠금은 없다(사람이 잠금만 지웠다) — 다음 apply 가 먼저 완성한다
    const f = makeG8()
    const m = await build(f)
    await codeOf(apply(f, m, { faultHook: crashAt('slug:written') }))
    fs.rmSync(path.join(f.research, lib.LOCK_FILE))
    const r = await apply(f, m)
    expect('잠금 없이 남은 journal → apply 가 먼저 완성 · ALREADY_APPLIED', [r.code, r.recovered?.code, verifyNow(f).ok], ['ALREADY_APPLIED', 'RECOVERED', true])
  }
}

// ── Ⓘ KNOWN_LEGACY ──────────────────────────────────────────
console.log('Ⓘ KNOWN_LEGACY — intentId · slug · 행 sha256 정확한 열거만')
{
  expect('운영 KNOWN_LEGACY 는 정확히 5행 · 64자 sha256', [lib.KNOWN_LEGACY_ADMISSIONS.length, lib.KNOWN_LEGACY_ADMISSIONS.every((x) => /^[0-9a-f]{64}$/.test(x.lineSha256))], [5, true])
  const v = (ledger, slugs, list = LEGACY_LIST, journalPresent = false) => lib.verifyAdmissions({ receipts: [], slugManifestText: JSON.stringify({ slugs }), ledgerText: ledger,
    payloadOf: () => null, knownLegacy: list, journalPresent })
  const ok = v(`${LEGACY_LINE}\n`, { 'I-LEG': 'legacy-slug' })
  expect('열거된 legacy 행 → KNOWN_LEGACY', [ok.ok, ok.classes], [true, { CURRENT: 0, KNOWN_LEGACY: 1, UNKNOWN: 0 }])
  const altered = v(`${LEGACY_LINE.replace('예전 편입 주제', '예전 편입 주X')}\n`, { 'I-LEG': 'legacy-slug' })
  expect('같은 intent · slug 라도 행 바이트가 다르면 UNKNOWN', [altered.ok, altered.classes.UNKNOWN], [false, 1])
  const other = v(`${LEGACY_LINE}\n${JSON.stringify({ schemaVersion: 'm3ledger/2', event: 'ADMITTED', intentId: 'I-NEW', slug: 'new-slug', at: '2026-10-01T09:00:00+09:00' })}\n`, { 'I-LEG': 'legacy-slug', 'I-NEW': 'new-slug' })
  expect('receipt 없는 새 행 → UNKNOWN (receipt 가 없다고 legacy 가 아니다)', [other.ok, other.classes.UNKNOWN, other.problems.some((p) => p.startsWith('UNKNOWN_ADMISSION'))], [false, 1, true])
  const binding = v(`${LEGACY_LINE}\n`, { 'I-LEG': 'legacy-slug', 'I-ODD': 'odd-slug' })
  expect('설명되지 않는 slug binding → 실패', [binding.ok, binding.problems.some((p) => p.startsWith('UNEXPLAINED_BINDING'))], [false, true])
  const pending = v(`${LEGACY_LINE}\n`, { 'I-LEG': 'legacy-slug' }, LEGACY_LIST, true)
  expect('journal 이 남아 있으면 일관 상태가 아니다', [pending.ok, pending.problems[0].split(' ')[0]], [false, 'ADMISSION_IN_PROGRESS'])
}

// ── Ⓙ 잠금 · 실제 자식 프로세스 ──────────────────────────────
console.log('Ⓙ 잠금 — O_EXCL · 자동 탈취 0 · 실제 자식 프로세스 · 실제 SIGKILL')
const saveManifest = (f, mm) => { const p = path.join(f.dir, 'manifest.json'); fs.writeFileSync(p, JSON.stringify(mm)); return p }
const applyArgs = (f, mPath, hash) => [CLI, '--apply', '--manifest', mPath, '--confirm-hash', hash, '--snapshot', f.snapshot, '--research', f.research, '--repo', f.repo,
  '--approved-by', '김운영', '--approved-at', '2026-10-15T14:30:00+09:00', '--committed-at', COMMITTED]
const testEnv = (gate, stage) => ({ ...process.env, SORAN_MAGAZINE_TEST_MODE: '1', G8_TEST_GATE: gate, G8_TEST_PAUSE_AT: stage })
{
  // 남은 잠금 — 죽은 PID 여도 자동으로 지우지 않는다
  const f = makeG8()
  const m = await build(f)
  const stale = `${JSON.stringify({ schema: lib.LOCK_SCHEMA, host: 'other-host', pid: 999999, startedAt: '2026-10-01T00:00:00.000Z', manifestHash: 'x' })}\n`
  write(f.research, lib.LOCK_FILE, stale)
  const pre = research3(f)
  const r = await apply(f, m)
  expect('남은 잠금(죽은 PID) → ADMISSION_LOCKED · 잠금 바이트 그대로 · 쓰기 0', [r.code, lockText(f) === stale, JSON.stringify(research3(f)) === JSON.stringify(pre)], ['ADMISSION_LOCKED', true, true])
  expect('명시 경로 — 기계 operator 거부', (await lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: lib.sha256(stale), operator: 'bot' })).code, 'OPERATOR_INVALID')
  const rel = await lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: lib.sha256(stale), operator: '김운영' })
  expect('명시 경로 — sha 확인 · journal 없음 → 잠금만 놓는다 · 그 뒤 apply APPLIED', [rel.code, research3(f).lock, (await apply(f, m)).code], ['STALE_LOCK_RELEASED', false, 'APPLIED'])
}
{
  // 🔴 확인-덮어쓰기 경쟁 (2026-10-22 P1) — 확인한 그 잠금만 넘겨받는다
  const NEW_HOLDER = `${JSON.stringify({ schema: lib.LOCK_SCHEMA, host: 'new-holder', pid: 424242, startedAt: '2026-10-22T00:00:00.000Z', manifestHash: 'new' })}\n`
  const staleState = async () => {
    const f = makeG8()
    const m = await build(f)
    await codeOf(apply(f, m, { faultHook: crashAt('slug:written') }))
    return { f, m, sha: lockSha(f), lockPath: path.join(f.research, lib.LOCK_FILE) }
  }
  const quiet = (f) => { const s = research3(f); delete s.lock; return JSON.stringify(s) }
  const placeNewHolder = (lockPath) => { fs.rmSync(lockPath, { force: true }); fs.writeFileSync(lockPath, NEW_HOLDER, { flag: 'wx' }) }
  {
    const { f, sha, lockPath } = await staleState()
    const pre = quiet(f)
    const r = await lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: sha, operator: '김운영', knownLegacy: f.legacyList,
      faultHook: (s) => { if (s === 'lock:checked') placeNewHolder(lockPath) } })
    expect('확인 직후 새 holder 잠금으로 바뀜 → LOCK_RACE · 새 holder 바이트 보존 · journal · receipt · slug · ledger 쓰기 0 · takeover 표식 0',
      [r.code, lockText(f), quiet(f) === pre, fs.existsSync(`${lockPath}.takeover`), fs.readdirSync(path.dirname(lockPath)).filter((n) => n.includes('.claimed-')).length],
      ['LOCK_RACE', NEW_HOLDER, true, false, 0])
  }
  {
    const { f, sha, lockPath } = await staleState()
    const pre = quiet(f)
    const r = await lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: sha, operator: '김운영', knownLegacy: f.legacyList,
      faultHook: (s) => { if (s === 'lock:claimed') fs.writeFileSync(lockPath, NEW_HOLDER, { flag: 'wx' }) } })
    expect('stale 잠금을 떼어 낸 사이 새 holder 가 먼저 잠금 → LOCK_RACE · 새 holder 바이트 보존 · 쓰기 0', [r.code, lockText(f), quiet(f) === pre], ['LOCK_RACE', NEW_HOLDER, true])
  }
  {
    const { f, sha } = await staleState()
    let second = null
    const first = await lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: sha, operator: '김운영', knownLegacy: f.legacyList,
      faultHook: (s) => { if (s === 'lock:checked' && !second) second = lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: sha, operator: '박운영', knownLegacy: f.legacyList }) } })
    const r2 = await second
    expect('동시 복구 두 개 — 먼저 시작한 하나만 takeover · 다른 하나는 LOCK_RACE · 결과 ADMITTED', [first.code, r2.code, verifyNow(f).ok, research3(f).lock, research3(f).journal],
      ['STALE_LOCK_RECOVERED', 'LOCK_RACE', true, false, false])
  }
  {
    const { f, sha, lockPath } = await staleState()
    fs.writeFileSync(`${lockPath}.takeover`, '{"host":"dead"}\n')
    const pre = { lock: lockText(f), q: quiet(f) }
    const r = await lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: sha, operator: '김운영', knownLegacy: f.legacyList })
    expect('남은 takeover 표식 → LOCK_RACE · 자동으로 지우지 않는다 · 잠금 · 상태 그대로', [r.code, fs.existsSync(`${lockPath}.takeover`), lockText(f) === pre.lock, quiet(f) === pre.q], ['LOCK_RACE', true, true, true])
  }
  {
    const { f, m, sha } = await staleState()
    const r = await lib.recoverStaleLock({ researchDir: f.research, repoDir: f.repo, expectLockSha256: sha, operator: '김운영', knownLegacy: f.legacyList })
    expect('경쟁 없는 stale 복구는 그대로 — commit-forward 완성 · 재실행 ALREADY_APPLIED', [r.code, (await apply(f, m)).code, verifyNow(f).ok], ['STALE_LOCK_RECOVERED', 'ALREADY_APPLIED', true])
  }
}
{
  // 실제 자식 두 개 — 하나가 잠금을 쥔 동안 다른 하나는 쓰기 0
  const f = makeG8()
  const m = await build(f)
  const mPath = saveManifest(f, m)
  const gate = path.join(f.dir, 'gate-locked')
  const a = spawn('node', applyArgs(f, mPath, m.hash), { env: testEnv(gate, 'locked'), stdio: ['ignore', 'pipe', 'pipe'] })
  const outA = stdoutOf(a)
  const exitA = exitOf(a)
  const reached = await waitFor(`${gate}.reached`)
  const mid = research3(f)
  const b = spawnSync('node', applyArgs(f, mPath, m.hash), { encoding: 'utf8', timeout: 30000 })
  const jB = parseJson(b.stdout, { code: `출력 없음 ${b.stderr.slice(0, 120)}` })
  const midAfterB = research3(f)
  fs.writeFileSync(`${gate}.go`, '')
  const exA = await exitA
  expect('A 가 잠금을 쥔 동안 B → ADMISSION_LOCKED · 쓰기 0', [reached, b.status, jB.code, JSON.stringify(midAfterB) === JSON.stringify(mid)], [true, 1, 'ADMISSION_LOCKED', true])
  expect('A 는 완주 · 세 곳 일치', [exA.code, parseJson(outA(), {}).code, verifyNow(f).ok], [0, 'APPLIED', true])
}
{
  // 실제 SIGKILL — slug 교체 직후
  const f = makeG8()
  const m = await build(f)
  const mPath = saveManifest(f, m)
  const gate = path.join(f.dir, 'gate-kill')
  const child = spawn('node', applyArgs(f, mPath, m.hash), { env: testEnv(gate, 'slug:written'), stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = exitOf(child)
  const reached = await waitFor(`${gate}.reached`)
  child.kill('SIGKILL')
  const ex = await exited
  const mid = research3(f)
  expect('SIGKILL(slug:written) — 실제로 반쪽 상태 (receipt · slug 있음 · ledger 없음 · 잠금 · journal 남음)', [reached, ex.signal, mid.receipts.length, mid.slug.includes('learn-pick'), mid.ledger, mid.lock, mid.journal],
    [true, 'SIGKILL', 1, true, null, true, true])
  const blocked = spawnSync('node', applyArgs(f, mPath, m.hash), { encoding: 'utf8' })
  expect('SIGKILL 뒤 일반 apply → ADMISSION_LOCKED (자동 탈취 0)', parseJson(blocked.stdout, {}).code, 'ADMISSION_LOCKED')
  const rec = recoverInChild(f, lockSha(f))
  const v = spawnSync('node', [CLI, '--verify', '--research', f.research, '--repo', f.repo], { encoding: 'utf8' })
  expect('명시 복구 → STALE_LOCK_RECOVERED · --verify PASS · 행 2', [rec.j.code, v.status, ledgerRows(research3(f).ledger).length], ['STALE_LOCK_RECOVERED', 0, 2])
}

// ── Ⓚ 공용 helper ────────────────────────────────────────────
console.log('Ⓚ 공용 helper — 입력 수리 journal 신원 · G8 v1 큐 대조')
{
  const paths = ['/a/x', '/a/y', '/a/z']
  const files = paths.map((p) => ({ path: p, before: null, afterSha: 'ABSENT' }))
  const id = (j) => lib.checkJournalIdentity(j, paths).ok
  expect('journal 신원 — 정상 · schema · 개수 · 상대 경로 · 중복 · 다른 경로', [id({ schema: lib.JOURNAL_SCHEMA, files }), id({ schema: 'x', files }), id({ schema: lib.JOURNAL_SCHEMA, files: files.slice(1) }),
    id({ schema: lib.JOURNAL_SCHEMA, files: [{ ...files[0], path: 'a/x' }, ...files.slice(1)] }), id({ schema: lib.JOURNAL_SCHEMA, files: [files[0], files[0], files[2]] }),
    id({ schema: lib.JOURNAL_SCHEMA, files: [{ ...files[0], path: '/b/x' }, ...files.slice(1)] })], [true, false, false, false, false, false])
  const f = makeG8()
  const q = fs.readFileSync(path.join(f.repo, lib.PRODUCT_FILES.queue), 'utf8')
  const withG8 = lib.insertQueueRows(q, [{ day: 30, slug: 'g8-row', title: '예전 G8 행', contentType: 'EVERGREEN', intent: '상황', cluster: 'fam', target: '50대', riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY', imageMode: 'REQUIRED', autoEligible: true, ctaBoard: '/community/free', internalLinks: [], whyNow: 'w', notes: 'n', intentId: 'I-OLD', g8ManifestHash: 'h' }])
  expect('G8 v1 큐 대조 — 장부 없는 G8 큐 행 · binding 없음을 잡는다', lib.verifyConsistency({ queueSource: withG8, ledgerSource: '', slugManifestSource: '{"slugs":{}}' }).problems.map((p) => p.split(' ')[0]),
    ['QUEUE_WITHOUT_ADMISSION', 'SLUG_UNBOUND'])
}

// ── ⑬ topic-queue 공용 writer 잠금 ──────────────────────────
console.log('⑬ 다른 큐 writer 대 M-AUTO 등록 — 같은 큐 writer 잠금 (실제 자식 프로세스)')
const qlock = await import(pathToFileURL(path.join(path.dirname(LIB), 'magazine-queue-lock.mjs')).href)
const { classifyFailure } = await import(pathToFileURL(path.join(HERE, 'lib/magazine-failure-kind.mjs')).href)
const REG = (() => {
  if (!process.env.G8_PROMOTER_LIB) return path.join(HERE, 'magazine-register.mjs')
  const copy = path.join(path.dirname(path.dirname(LIB)), 'magazine-register.mjs')
  if (!fs.existsSync(copy)) fs.copyFileSync(path.join(HERE, 'magazine-register.mjs'), copy)
  return copy
})()
/** 등록 시험 fixture — 큐(queued-one day 10 · queued-two day 12) 를 가진 repo */
function makeQueueRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-check-q-'))
  fixtures.push({ dir })
  const repo = path.join(dir, 'repo')
  const realQueue = fs.readFileSync(path.join(REPO, 'drafts/magazine/topic-queue.ts'), 'utf8')
  const header = realQueue.slice(0, realQueue.indexOf('export const TOPIC_QUEUE'))
  const qRow = (day, slug, title, cluster) => lib.renderQueueRow({ day, slug, title, contentType: 'EVERGREEN', intent: '상황', cluster,
    target: '50대', riskLevel: 'LOW', reviewMode: 'SUMMARY_ONLY', imageMode: 'OPTIONAL', autoEligible: true, ctaBoard: '/community/free',
    internalLinks: [], whyNow: '기존 행', notes: '기존 행' })
  write(repo, 'drafts/magazine/topic-queue.ts', `${header}export const TOPIC_QUEUE: TopicQueueItem[] = [\n${qRow(10, 'queued-one', '큐에 이미 있는 주제 질문', 'family')}${qRow(12, 'queued-two', '큐에 있는 주제 제목', 'relationship')}]\n`)
  return { dir, repo }
}
const fresh = () => makeQueueRepo()
const filesOf = (f) => ({ queue: path.join(f.repo, 'drafts/magazine/topic-queue.ts') })
/** M-AUTO 등록과 같은 함수(`applyWrite`) — queued-one(day 10)을 등록하고 큐에서 지운다 */
const regArgs = (f, arts) => ['--input-type=module', '-e', `const { applyWrite } = await import(${JSON.stringify(REG)}); const fs = await import('node:fs');
const r = applyWrite({ slug: 'queued-one', _internal: { draft: { literal: "{\\n  title: '등록 글',\\n  publishedAt: '',\\n}" }, norm: { date: '2026-10-08', publishAt: '2026-10-08T10:30:00+09:00' }, item: { day: 10 }, articlesSrc: fs.readFileSync(${JSON.stringify(arts)}, 'utf8') } },
  { articlesPath: ${JSON.stringify(arts)}, queuePath: ${JSON.stringify(path.join(f.repo, 'drafts/magazine/topic-queue.ts'))} })
console.log(JSON.stringify(r))`]
const regArticles = (f, name = 'register-articles.ts') => { const p = path.join(f.dir, name); fs.writeFileSync(p, 'export const MAGAZINE_ARTICLE_RECORD = {\n} satisfies Record<string, MagazineArticleBody>\n'); return p }
const hasQueued = (text) => parseQueueSource(text).some((r) => r.slug === 'queued-one')
const parsesOk = (text) => { try { return Array.isArray(parseQueueSource(text)) } catch { return false } }
/** 다른 큐 writer 가 넣는 행 — 등록과 같은 큐 writer 잠금 안에서 쓴다 */
const WRITER_ROWS = [1, 2, 3, 4, 5].map((i) => ({ day: 40 + i, slug: `other-writer-${i}`, title: `다른 writer 주제 ${i}`, contentType: 'EVERGREEN', intent: '상황', cluster: 'daily',
  target: '50대', riskLevel: 'LOW', reviewMode: 'SUMMARY_ONLY', imageMode: 'REQUIRED', autoEligible: true, ctaBoard: '/community/free', internalLinks: [], whyNow: 'other-writer', notes: 'n' }))
const writerRows = (text) => parseQueueSource(text).filter((r) => r.whyNow === 'other-writer').length
/**
 * 🔴 **다른 큐 writer (실제 자식 프로세스)** — G8 v1 apply 가 하던 「큐 writer 잠금 → 행 삽입」 과 같은 경로다.
 *    G8 은 더 이상 큐를 쓰지 않지만, 등록이 다른 writer 와 같은 잠금을 공유한다는 계약은 그대로 지킨다.
 */
const writerArgs = (queuePath, gate = null, libPath = LIB) => ['--input-type=module', '-e', `const qlock = await import(${JSON.stringify(pathToFileURL(path.join(path.dirname(libPath), 'magazine-queue-lock.mjs')).href)});
const lib = await import(${JSON.stringify(pathToFileURL(libPath).href)}); const fs = await import('node:fs')
const gate = ${JSON.stringify(gate)}
const r = qlock.withQueueWriteLock(${JSON.stringify(queuePath)}, () => {
  if (gate) { fs.writeFileSync(gate + '.reached', String(process.pid)); while (!fs.existsSync(gate + '.go')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20) }
  fs.writeFileSync(${JSON.stringify(queuePath)}, lib.insertQueueRows(fs.readFileSync(${JSON.stringify(queuePath)}, 'utf8'), ${JSON.stringify(WRITER_ROWS)}))
  return 'WROTE'
}, { waitMs: 0 })
console.log(JSON.stringify(r.ok ? { code: 'WROTE' } : { code: 'LOCKED', why: r.why }))`]
const runWriter = (queuePath, libPath) => { const r = spawnSync('node', writerArgs(queuePath, null, libPath), { encoding: 'utf8', timeout: 20000 }); return { status: r.status, j: parseJson(r.stdout, { code: `출력 없음 ${r.stderr.slice(0, 120)}` }) } }

{
  // A: 다른 writer 가 큐 잠금을 쥔 채 멈춘 사이 등록이 시도한다
  const f = fresh()
  const arts = regArticles(f)
  const artsPre = fs.readFileSync(arts, 'utf8')
  const queueFile = filesOf(f).queue
  const pre = fs.readFileSync(queueFile, 'utf8')
  const gate = path.join(f.dir, 'gate-writer-holds')
  const w = spawn('node', writerArgs(queueFile, gate), { stdio: ['ignore', 'pipe', 'pipe'] })
  const outW = stdoutOf(w)
  const exitW = exitOf(w)
  const reached = await waitFor(`${gate}.reached`)
  const restoreWhileHeld = qlock.restoreQueueSnapshot({ path: queueFile, existed: true, bytes: Buffer.from(pre), queueCas: { day: 10 } }, { waitMs: 0 })
  const reg = spawnSync('node', regArgs(f, arts), { encoding: 'utf8', timeout: 20000 })
  const jReg = parseJson(reg.stdout, { ok: null, code: `출력 없음 ${reg.stderr.slice(0, 120)}` })
  const mid = fs.readFileSync(queueFile, 'utf8')
  fs.writeFileSync(`${gate}.go`, '')
  const exW = await exitW
  const fin = fs.readFileSync(queueFile, 'utf8')
  expect('다른 writer 가 큐 잠금을 쥔 동안 등록은 queue_writer_locked · 쓰기 0', [reached, jReg.ok, jReg.code, mid === pre, fs.readFileSync(arts, 'utf8') === artsPre],
    [true, false, qlock.QUEUE_LOCKED_CODE, true, true])
  expect('다른 writer 가 큐 잠금을 쥔 동안 스냅샷 원복도 덮지 않는다 (queue_writer_locked)', [restoreWhileHeld.restored, restoreWhileHeld.failure?.errorName], [false, qlock.QUEUE_LOCKED_CODE])
  expect('그 뒤 다른 writer 는 완주 (교착 0)', [exW.code, parseJson(outW(), {}).code], [0, 'WROTE'])
  expect('lost update 0 — 등록이 실패라 했으니 queued-one 이 남고 writer 행 5 가 있다', [hasQueued(fin), writerRows(fin)], [true, 5])
  expect('최종 큐 파싱 PASS (7행)', [parsesOk(fin), parseQueueSource(fin).length], [true, 7])
  expect('잠금 파일이 남지 않는다', fs.existsSync(qlock.queueLockFile(queueFile)), false)
  expect('등록의 잠금 실패는 INFRA — 원고 실패 횟수에 넣지 않는다', classifyFailure({ message: `REGISTER_BLOCKED: ${jReg.why ?? ''}`, sent: false }).kind, 'INFRA')
}
{
  // B: 등록이 큐 잠금을 쥔 채(큐를 읽기 직전) 멈춘 사이 다른 writer 가 시도한다
  const f = fresh()
  const arts = regArticles(f)
  const queueFile = filesOf(f).queue
  const pre = fs.readFileSync(queueFile, 'utf8')
  const gate = path.join(f.dir, 'gate-reg-holds')
  const reg = spawn('node', regArgs(f, arts), { env: { ...process.env, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_QUEUE_TEST_GATE: gate, SORAN_QUEUE_TEST_PAUSE_AT: 'register:locked' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const outReg = stdoutOf(reg)
  const exitReg = exitOf(reg)
  const reached = await waitFor(`${gate}.reached`)
  const w = runWriter(queueFile)
  const mid = fs.readFileSync(queueFile, 'utf8')
  fs.writeFileSync(`${gate}.go`, '')
  const exReg = await exitReg
  const jReg = parseJson(outReg(), { ok: null })
  const fin = fs.readFileSync(queueFile, 'utf8')
  expect('등록이 큐 잠금을 쥔 동안 다른 writer 는 LOCKED · 쓰기 0', [reached, w.j.code, mid === pre], [true, 'LOCKED', true])
  expect('그 뒤 등록은 완주 (교착 0)', [exReg.code, jReg.ok], [0, true])
  expect('lost update 0 — 등록이 지운 queued-one 은 없고 writer 행도 없다', [hasQueued(fin), writerRows(fin)], [false, 0])
  expect('최종 큐 파싱 PASS (1행)', [parsesOk(fin), parseQueueSource(fin).length], [true, 1])
}
{
  // C: auto-register 스냅샷 원복 — 이 회차 등록의 결과일 때만 되돌린다
  const f = fresh()
  const queueFile = filesOf(f).queue
  const S = fs.readFileSync(queueFile)
  const entry = { path: queueFile, existed: true, bytes: S, queueCas: { day: 10 } }
  expect('원복 — 큐가 스냅샷 그대로면 할 일 없음', qlock.restoreQueueSnapshot(entry), { restored: false, failure: null })
  fs.writeFileSync(queueFile, qlock.removeQueueDay(S.toString('utf8'), 10))
  expect('원복 — 이 회차 등록이 지운 것이면 스냅샷으로 되돌린다', [qlock.restoreQueueSnapshot(entry).restored, fs.readFileSync(queueFile).equals(S)], [true, true])
  fs.writeFileSync(queueFile, String(S).replace(/\n$/, '\n// 부분 쓰기 잔여 (시험)\n'))
  expect('원복 — register 원복 실패 잔여(새 행 없음)도 되돌린다 (m3a 반례9-C 와 같은 상황)', [qlock.restoreQueueSnapshot(entry).restored, fs.readFileSync(queueFile).equals(S)], [true, true])
  fs.writeFileSync(queueFile, String(S).slice(0, 200))
  const broken = fs.readFileSync(queueFile, 'utf8')
  const rb = qlock.restoreQueueSnapshot(entry)
  expect('원복 — 지금 큐를 읽을 수 없으면 덮지 않는다', [rb.restored, rb.failure?.errorName, fs.readFileSync(queueFile, 'utf8') === broken], [false, qlock.QUEUE_CHANGED_CODE, true])
  fs.writeFileSync(queueFile, S)
  expect('원복 대조용 다른 writer', runWriter(queueFile).j.code, 'WROTE')
  const withW = fs.readFileSync(queueFile, 'utf8')
  const r1 = qlock.restoreQueueSnapshot(entry)
  expect('원복 — 회차 뒤 다른 writer 가 넣은 행을 옛 바이트로 덮지 않는다', [r1.restored, r1.failure?.errorName, fs.readFileSync(queueFile, 'utf8') === withW], [false, qlock.QUEUE_CHANGED_CODE, true])
  const both = qlock.removeQueueDay(withW, 10)
  fs.writeFileSync(queueFile, both)
  const r2 = qlock.restoreQueueSnapshot(entry)
  expect('원복 — 등록 + 다른 writer 가 섞였으면 덮지 않는다', [r2.restored, r2.failure?.errorName, fs.readFileSync(queueFile, 'utf8') === both], [false, qlock.QUEUE_CHANGED_CODE, true])
}

// ── ⑮ worktree 독립 논리 잠금 ───────────────────────────────
console.log('⑮ 큐 writer 잠금은 경로가 아니라 논리 큐 하나다 — 서로 다른 repo 경로 (실제 자식 프로세스)')
/** 등록 자식 — 큐 경로·등록 파일·slug·day·날짜를 고른다 (applyWrite 는 M-AUTO 등록과 같은 함수) */
const regArgsFor = ({ queuePath, arts, slug = 'queued-one', day = 10, date = '2026-10-08' }) => ['--input-type=module', '-e', `const { applyWrite } = await import(${JSON.stringify(REG)}); const fs = await import('node:fs');
const r = applyWrite({ slug: ${JSON.stringify(slug)}, _internal: { draft: { literal: "{\\n  title: '등록 글',\\n  publishedAt: '',\\n}" }, norm: { date: ${JSON.stringify(date)}, publishAt: ${JSON.stringify(`${date}T10:30:00+09:00`)} }, item: { day: ${day} }, articlesSrc: fs.readFileSync(${JSON.stringify(arts)}, 'utf8') } },
  { articlesPath: ${JSON.stringify(arts)}, queuePath: ${JSON.stringify(queuePath)} })
console.log(JSON.stringify(r))`]
const slugsIn = (arts) => lib.sha256 && (() => { try { return Object.keys(Function(`return (${fs.readFileSync(arts, 'utf8').replace(/^[^=]*=/, '').replace(/} satisfies[\s\S]*$/, '}')})`)()) } catch { return null } })()
{
  expect('운영 scope 는 경로와 무관하게 하나다', [qlock.queueLockBase('/a/topic-queue.ts', {}) === qlock.queueLockBase('/b/other/topic-queue.ts', {}),
    qlock.queueLockBase('/a/topic-queue.ts', {}).endsWith(`${qlock.QUEUE_LOCK_SCOPE}.queue`)], [true, true])
  let called = 0
  // 🔴 잠금 폴더를 함께 준다 — scope 판정을 지운 변이에서도 잠금은 임시 폴더로만 간다 (운영 queue-locks 접근 0)
  const blocked = qlock.withQueueWriteLock('/x/topic-queue.ts', () => { called++ }, { env: { SORAN_MAGAZINE_QUEUE_LOCK_SCOPE: 'test-x', SORAN_MAGAZINE_QUEUE_LOCK_DIR: TEST_LOCK_DIR } })
  expect('시험 모드 밖 scope 주입은 잠금 거부 · 임계구역 실행 0', [blocked.ok, blocked.code, called], [false, qlock.QUEUE_LOCK_SCOPE_BLOCKED_CODE, 0])
  // 🔴 scope 주입 판정만 따로 본다 — 위 반례는 잠금 폴더 주입 가드가 같은 코드로 먼저 막아 scope 가드를 가린다(2026-10-22 죽은 변이 실측)
  expect('scope 주입 판정 단독 — 시험 모드 밖 거부 · 시험 모드 test- 허용', [qlock.resolveQueueLockScope({ SORAN_MAGAZINE_QUEUE_LOCK_SCOPE: 'test-x' }).ok,
    qlock.resolveQueueLockScope({ SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_QUEUE_LOCK_SCOPE: 'test-x' }).ok], [false, true])
  const badName = qlock.withQueueWriteLock('/x/topic-queue.ts', () => { called++ }, { env: { SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_QUEUE_LOCK_SCOPE: 'prod', SORAN_MAGAZINE_QUEUE_LOCK_DIR: TEST_LOCK_DIR } })
  expect('시험 scope 이름은 test- 로 시작해야 한다', [badName.ok, called], [false, 0])
  // 🔴 운영 queue-locks 격리 (2026-10-11) — 거부는 파일 접근 전에 일어난다
  expect('시험 잠금 폴더는 임시 폴더다 (운영 queue-locks 아님)',
    [qlock.queueLockDir() === TEST_LOCK_DIR, qlock.operationalQueueLockDirs().includes(qlock.queueLockDir())], [true, false])
  // 🔴 운영 위치 판정은 **경로 계산만**으로 본다 (`queueLockDir` 은 파일을 건드리지 않는다) — 가드를 지운 변이에서도 운영 queue-locks 접근 0
  const opDir = qlock.operationalQueueLockDirs()[0]
  const dirOf = (env) => { try { return qlock.queueLockDir(env) } catch (e) { return e.code } }
  expect('🔴 시험 모드가 운영 queue-locks 를 가리키면 경로 단계에서 거부', dirOf({ SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_QUEUE_LOCK_DIR: opDir }), qlock.QUEUE_LOCK_SCOPE_BLOCKED_CODE)
  const fakeHome = path.join(os.tmpdir(), `g8-fake-op-home-${process.pid}`)
  const extra = qlock.withQueueWriteLock('/x/topic-queue.ts', () => { called++ }, { env: { SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_QUEUE_LOCK_SCOPE: 'test-x',
    SORAN_MAGAZINE_GUARD_EXTRA_OPERATIONAL_HOME: fakeHome, SORAN_MAGAZINE_QUEUE_LOCK_DIR: path.join(fakeHome, 'Library', 'Application Support', 'soransoran', 'queue-locks') } })
  expect('🔴 가짜 운영 위치로도 같은 가드가 막는다 (파일 0)', [extra.ok, called, fs.existsSync(fakeHome)], [false, 0, false])
  expect('🔴 운영 실행에 임시 폴더 잠금 위치 주입도 거부 (운영 writer 는 고정 위치 하나)', dirOf({ SORAN_MAGAZINE_QUEUE_LOCK_DIR: TEST_LOCK_DIR }), qlock.QUEUE_LOCK_SCOPE_BLOCKED_CODE)
  expect('운영 실행에 임시 폴더 밖 잠금 폴더 주입은 거부 (운영 상호배제를 흩지 않는다)', dirOf({ SORAN_MAGAZINE_QUEUE_LOCK_DIR: path.join(REPO, '.not-tmp-locks') }), qlock.QUEUE_LOCK_SCOPE_BLOCKED_CODE)
  expect('시험 모드 · HOME 이 운영 위치면(주입 없음) 경로 단계에서 거부', dirOf({ SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_GUARD_EXTRA_OPERATIONAL_HOME: os.homedir() }), qlock.QUEUE_LOCK_SCOPE_BLOCKED_CODE)
  expect('운영 실행이 운영 위치를 주입으로 가리켜도 거부 (주입 경로로는 운영 잠금 0)', dirOf({ SORAN_MAGAZINE_QUEUE_LOCK_DIR: opDir }), qlock.QUEUE_LOCK_SCOPE_BLOCKED_CODE)
  const f = fresh()
  const arts = regArticles(f)
  const pre = { q: fs.readFileSync(filesOf(f).queue, 'utf8'), a: fs.readFileSync(arts, 'utf8') }
  const r = spawnSync('node', regArgsFor({ queuePath: filesOf(f).queue, arts }), { encoding: 'utf8', env: { ...process.env, SORAN_MAGAZINE_TEST_MODE: '' } })
  const j = parseJson(r.stdout, { ok: null })
  expect('운영 등록 자식이 scope 주입을 보면 쓰기 0', [j.ok, j.code, fs.readFileSync(filesOf(f).queue, 'utf8') === pre.q, fs.readFileSync(arts, 'utf8') === pre.a],
    [false, qlock.QUEUE_LOCK_SCOPE_BLOCKED_CODE, true, true])
}
const twoWorktrees = () => {
  const f = fresh()
  const repoB = path.join(f.dir, 'other-worktree', 'repo')
  fs.mkdirSync(path.dirname(repoB), { recursive: true })
  fs.cpSync(f.repo, repoB, { recursive: true })
  return { f, repoB, queueB: path.join(repoB, 'drafts/magazine/topic-queue.ts'), artsB: regArticles(f, 'register-articles-b.ts') }
}
{
  // A 경로 writer 가 잠금을 쥔 동안 B 경로 register
  const { f, queueB, artsB } = twoWorktrees()
  expect('두 repo 의 큐 파일 실제 경로가 다르다', fs.realpathSync(filesOf(f).queue) !== fs.realpathSync(queueB), true)
  const preB = { q: fs.readFileSync(queueB, 'utf8'), a: fs.readFileSync(artsB, 'utf8') }
  const gate = path.join(f.dir, 'gate-ab')
  const w = spawn('node', writerArgs(filesOf(f).queue, gate), { stdio: ['ignore', 'pipe', 'pipe'] })
  const outW = stdoutOf(w)
  const exitW = exitOf(w)
  const reached = await waitFor(`${gate}.reached`)
  const reg = spawnSync('node', regArgsFor({ queuePath: queueB, arts: artsB }), { encoding: 'utf8', timeout: 20000 })
  const jReg = parseJson(reg.stdout, { ok: null, code: `출력 없음 ${reg.stderr.slice(0, 120)}` })
  const midB = { q: fs.readFileSync(queueB, 'utf8'), a: fs.readFileSync(artsB, 'utf8') }
  fs.writeFileSync(`${gate}.go`, '')
  const exW = await exitW
  expect('A 경로 writer 가 쥔 동안 B 경로 등록은 queue_writer_locked · B 쓰기 0', [reached, jReg.ok, jReg.code, JSON.stringify(midB) === JSON.stringify(preB)], [true, false, qlock.QUEUE_LOCKED_CODE, true])
  expect('A 경로 writer 는 완주', [exW.code, parseJson(outW(), {}).code], [0, 'WROTE'])
}
{
  // B 경로 register 가 잠금을 쥔 동안 A 경로 writer
  const { f, queueB, artsB } = twoWorktrees()
  const preA = fs.readFileSync(filesOf(f).queue, 'utf8')
  const gate = path.join(f.dir, 'gate-ba')
  const reg = spawn('node', regArgsFor({ queuePath: queueB, arts: artsB }), { env: { ...process.env, SORAN_QUEUE_TEST_GATE: gate, SORAN_QUEUE_TEST_PAUSE_AT: 'register:locked' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const outReg = stdoutOf(reg)
  const exitReg = exitOf(reg)
  const reached = await waitFor(`${gate}.reached`)
  const w = runWriter(filesOf(f).queue)
  const midA = fs.readFileSync(filesOf(f).queue, 'utf8')
  fs.writeFileSync(`${gate}.go`, '')
  const exReg = await exitReg
  const jReg = parseJson(outReg(), { ok: null })
  expect('B 경로 등록이 쥔 동안 A 경로 writer 는 LOCKED · A 쓰기 0', [reached, w.j.code, midA === preA], [true, 'LOCKED', true])
  expect('B 경로 등록은 완주 · B 큐에서 queued-one 제거', [exReg.code, jReg.ok, hasQueued(fs.readFileSync(queueB, 'utf8'))], [0, true, false])
}

// ── ⑯ 등록 쌍 원복 원자성 ───────────────────────────────────
console.log('⑯ articles.ts · topic-queue.ts 원복은 같은 임계구역에서 함께 판정한다')
/** 실제 등록 자식이 두 파일을 쓴 뒤 「실패」를 보고하고, 내부 원복까지 실패한다 (두 파일을 읽기 전용으로 만든 뒤 던진다) */
const residueArgs = ({ queuePath, arts }) => ['--input-type=module', '-e', `const { applyWrite } = await import(${JSON.stringify(REG)}); const fs = await import('node:fs');
const write = (p, d) => { fs.writeFileSync(p, d); if (p === ${JSON.stringify(queuePath)}) { fs.chmodSync(p, 0o444); fs.chmodSync(${JSON.stringify(arts)}, 0o444); throw new Error('EIO 시험 주입 — 쓴 뒤 실패') } }
const r = applyWrite({ slug: 'queued-one', _internal: { draft: { literal: "{\\n  title: '등록 글',\\n  publishedAt: '',\\n}" }, norm: { date: '2026-10-08', publishAt: '2026-10-08T10:30:00+09:00' }, item: { day: 10 }, articlesSrc: fs.readFileSync(${JSON.stringify(arts)}, 'utf8') } },
  { articlesPath: ${JSON.stringify(arts)}, queuePath: ${JSON.stringify(queuePath)}, write })
console.log(JSON.stringify(r))`]
/** 다른 worktree 의 writer — 같은 코드를 다른 경로에 두고 거기서 실행한다 */
const otherWorktreeLib = (f) => {
  const root = path.join(f.dir, 'writer-worktree', 'scripts')
  fs.mkdirSync(root, { recursive: true })
  fs.cpSync(path.dirname(LIB), path.join(root, 'lib'), { recursive: true })
  return path.join(root, 'lib', path.basename(LIB))
}
{
  const f = fresh()
  const arts = regArticles(f)
  const queuePath = filesOf(f).queue
  const snapA = fs.readFileSync(arts)
  const snapQ = fs.readFileSync(queuePath)
  const pair = { articles: { path: arts, existed: true, bytes: snapA, pairWithQueue: true },
    queue: { path: queuePath, existed: true, bytes: snapQ, queueCas: { day: 10, slug: 'queued-one' } }, slug: 'queued-one' }
  const res = spawnSync('node', residueArgs({ queuePath, arts }), { encoding: 'utf8' })
  for (const p of [arts, queuePath]) fs.chmodSync(p, 0o644)
  const jr = parseJson(res.stdout, { ok: null })
  const aTxt = () => fs.readFileSync(arts, 'utf8')
  expect('반례 준비 — 등록이 두 파일을 쓴 뒤 실패하고 내부 원복도 실패했다 (실제 자식)',
    [jr.ok, jr.rolledBack, /원복도 실패/.test(jr.why ?? ''), aTxt().includes("'queued-one'"), hasQueued(fs.readFileSync(queuePath, 'utf8'))], [false, true, true, true, false])
  const w = runWriter(queuePath, otherWorktreeLib(f))
  expect('그 직후 다른 worktree 의 writer 가 같은 큐에 행을 더한다 (실제 자식)', [w.status, w.j.code], [0, 'WROTE'])
  const before = { a: aTxt(), q: fs.readFileSync(queuePath, 'utf8') }
  const r = qlock.restoreRegisterPair(pair)
  const after = { a: aTxt(), q: fs.readFileSync(queuePath, 'utf8') }
  expect('쌍 원복 — 큐에 다른 writer 행이 있으면 둘 다 되돌리지 않는다', [r.restored, r.failures[0]?.errorName, JSON.stringify(after) === JSON.stringify(before)], [[], qlock.PAIR_REFUSED_CODE, true])
  expect('정합성 — 글은 articles 에 남고 큐 행은 빠진 「등록됨」 상태 · writer 행 5 보존',
    [after.a.includes("'queued-one'"), hasQueued(after.q), writerRows(after.q)], [true, false, 5])
  const { restoreSnapshot } = await import(pathToFileURL(path.join(HERE, 'magazine-auto-register.mjs')).href)
  const wired = restoreSnapshot([pair.articles, pair.queue])
  expect('auto-register restoreSnapshot 도 같은 쌍 판정을 쓴다 (둘 다 그대로)', [wired.restored, wired.failures[0]?.errorName, aTxt() === before.a], [[], qlock.PAIR_REFUSED_CODE, true])
}
{
  // 다른 writer 가 없으면 둘 다 한 임계구역에서 되돌린다
  const f = fresh()
  const arts = regArticles(f)
  const queuePath = filesOf(f).queue
  const pair = { articles: { path: arts, existed: true, bytes: fs.readFileSync(arts), pairWithQueue: true },
    queue: { path: queuePath, existed: true, bytes: fs.readFileSync(queuePath), queueCas: { day: 10, slug: 'queued-one' } }, slug: 'queued-one' }
  const reg = spawnSync('node', regArgsFor({ queuePath, arts }), { encoding: 'utf8' })
  expect('등록 (실제 자식)', parseJson(reg.stdout, {}).ok, true)
  const r = qlock.restoreRegisterPair(pair)
  expect('쌍 원복 — 다른 writer 가 없으면 두 파일 모두 스냅샷 바이트', [r.failures, fs.readFileSync(arts).equals(pair.articles.bytes), fs.readFileSync(queuePath).equals(pair.queue.bytes)], [[], true, true])
  // 쓰는 도중 실패 — 이미 쓴 파일을 원복 직전 바이트로 되돌리고 증거를 남긴다
  spawnSync('node', regArgsFor({ queuePath, arts }), { encoding: 'utf8' })
  const mid = { a: fs.readFileSync(arts, 'utf8'), q: fs.readFileSync(queuePath, 'utf8') }
  const failing = qlock.restoreRegisterPair(pair, { writeFile: (p, d) => { if (p === queuePath) throw new Error('EIO 주입'); fs.writeFileSync(p, d) } })
  expect('쌍 원복 중 실패 — queue_pair_restore_failed · 두 파일 원복 직전 바이트', [failing.restored, failing.failures[0]?.errorName,
    /원복 직전으로 되돌림/.test(failing.failures[0]?.errorDetail ?? ''), fs.readFileSync(arts, 'utf8') === mid.a, fs.readFileSync(queuePath, 'utf8') === mid.q],
  [[], qlock.PAIR_FAILED_CODE, true, true, true])
  // 큐 writer 잠금을 다른 프로세스가 쥐고 있으면 아무것도 하지 않는다
  const gate = path.join(f.dir, 'gate-pair')
  const w = spawn('node', writerArgs(queuePath, gate), { stdio: ['ignore', 'pipe', 'pipe'] })
  const exitW = exitOf(w)
  await waitFor(`${gate}.reached`)
  const held = qlock.restoreRegisterPair(pair, { waitMs: 0 })
  const heldState = { a: fs.readFileSync(arts, 'utf8'), q: fs.readFileSync(queuePath, 'utf8') }
  fs.writeFileSync(`${gate}.go`, '')
  await exitW
  expect('잠금을 남이 쥐면 쌍 원복 0 (queue_writer_locked)', [held.restored, held.failures[0]?.errorName, heldState.a === mid.a, heldState.q === mid.q], [[], qlock.QUEUE_LOCKED_CODE, true, true])
}

// ── ⑰ register 대 register ──────────────────────────────────
console.log('⑰ 서로 다른 slug·날짜 등록 두 개 동시 실행 — 잠금 안 재검사 (실제 자식 프로세스)')
{
  const f = fresh()
  const arts = regArticles(f)
  const queuePath = filesOf(f).queue
  const gate = path.join(f.dir, 'gate-rr')
  const r1 = spawn('node', regArgsFor({ queuePath, arts, slug: 'queued-one', day: 10, date: '2026-10-08' }),
    { env: { ...process.env, SORAN_QUEUE_TEST_GATE: gate, SORAN_QUEUE_TEST_PAUSE_AT: 'register:locked' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const out1 = stdoutOf(r1)
  const exit1 = exitOf(r1)
  const reached = await waitFor(`${gate}.reached`)
  const r2 = spawn('node', regArgsFor({ queuePath, arts, slug: 'queued-two', day: 12, date: '2026-10-09' }), { stdio: ['ignore', 'pipe', 'pipe'] })
  const out2 = stdoutOf(r2)
  const exit2 = exitOf(r2)
  await sleep(300)
  fs.writeFileSync(`${gate}.go`, '')
  const [e1, e2] = [await exit1, await exit2]
  const j1 = parseJson(out1(), { ok: null })
  const j2 = parseJson(out2(), { ok: null })
  const finalSlugs = slugsIn(arts)
  const finalQueue = fs.readFileSync(queuePath, 'utf8')
  expect('등록 두 개 모두 완주', [reached, e1.code, e2.code, j1.ok, j2.ok], [true, 0, 0, true, true])
  expect('lost update 0 — 등록 글 2개 모두 보존', (finalSlugs ?? []).sort(), ['queued-one', 'queued-two'])
  expect('큐 두 행 모두 정확히 제거 · 큐 파싱 PASS', [parsesOk(finalQueue), parseQueueSource(finalQueue).map((x) => x.slug)], [true, []])
}
{
  const { applyWrite } = await import(pathToFileURL(REG).href)
  const mk = (f, arts, slug, day, date) => applyWrite({ slug, _internal: { draft: { literal: "{\n  title: '등록 글',\n  publishedAt: '',\n}" },
    norm: { date, publishAt: `${date}T10:30:00+09:00` }, item: { day }, articlesSrc: fs.readFileSync(arts, 'utf8') } }, { articlesPath: arts, queuePath: filesOf(f).queue })
  const f = fresh()
  const arts = regArticles(f)
  expect('재검사 준비 — queued-two 등록', mk(f, arts, 'queued-two', 12, '2026-10-09').ok, true)
  const pre = { a: fs.readFileSync(arts, 'utf8'), q: fs.readFileSync(filesOf(f).queue, 'utf8') }
  const slot = mk(f, arts, 'queued-one', 10, '2026-10-09')
  expect('잠금 안 재검사 — 같은 날짜 슬롯이면 쓰기 0', [slot.ok, /슬롯이 이미 차 있다/.test(slot.why ?? ''), fs.readFileSync(arts, 'utf8') === pre.a, fs.readFileSync(filesOf(f).queue, 'utf8') === pre.q], [false, true, true, true])
  const f2 = fresh()
  const arts2 = regArticles(f2)
  fs.writeFileSync(arts2, fs.readFileSync(arts2, 'utf8').replace('} satisfies', "  'queued-one': { title: '먼저 들어온 글', publishedAt: '2026-10-01' },\n} satisfies"))
  const pre2 = { a: fs.readFileSync(arts2, 'utf8'), q: fs.readFileSync(filesOf(f2).queue, 'utf8') }
  const dup = mk(f2, arts2, 'queued-one', 10, '2026-10-08')
  expect('잠금 안 재검사 — 이미 있는 slug 면 쓰기 0', [dup.ok, /이미 articles\.ts 에 있다/.test(dup.why ?? ''), fs.readFileSync(arts2, 'utf8') === pre2.a, fs.readFileSync(filesOf(f2).queue, 'utf8') === pre2.q], [false, true, true, true])
  // 🔴 실제 articles.ts 사본 — fixture 모양만으로 통과시키지 않는다 (실제 파일은 `const MAGAZINE_ARTICLE_RECORD` · export 없음)
  const fr = fresh()
  const realCopy = path.join(fr.dir, 'real-articles.ts')
  fs.copyFileSync(path.join(REPO, 'src/content/magazine/articles.ts'), realCopy)
  const realBefore = parseArticlesSource(fs.readFileSync(realCopy, 'utf8')).length
  const real = mk(fr, realCopy, 'queued-one', 10, '2099-01-15')
  const realAfter = parseArticlesSource(fs.readFileSync(realCopy, 'utf8'))
  expect('실제 articles.ts 사본에도 잠금 안 재검사 뒤 등록된다 (+1 · 큐 행 제거)', [real.ok, real.why ?? null, realAfter.length - realBefore, realAfter.some((a) => a.slug === 'queued-one'),
    hasQueued(fs.readFileSync(filesOf(fr).queue, 'utf8'))], [true, null, 1, true, false])
  const f3 = fresh()
  const arts3 = path.join(f3.dir, 'no-anchor.ts')
  fs.writeFileSync(arts3, 'export const MAGAZINE_ARTICLE_RECORD = {\n}\n')
  const anchor = mk(f3, arts3, 'queued-one', 10, '2026-10-08')
  expect('잠금 안 재검사 — 삽입 위치가 없으면 쓰기 0', [anchor.ok, /삽입 위치/.test(anchor.why ?? ''), hasQueued(fs.readFileSync(filesOf(f3).queue, 'utf8'))], [false, true, true])
}

// ── ⑱ register durable transaction ──────────────────────────
console.log('⑱ register — articles·queue 쓰기는 durable transaction (실제 register CLI · 실제 SIGKILL)')
/** 실제 register CLI 가 도는 미니 저장소 — 검사 대상 lib·register 사본 + articles · queue · draft */
function makeMiniRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-check-reg-'))
  fixtures.push({ dir: root })
  fs.cpSync(path.dirname(LIB), path.join(root, 'scripts/lib'), { recursive: true })
  fs.copyFileSync(REG, path.join(root, 'scripts/magazine-register.mjs'))
  const w = (rel, t) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
  // 🔴 실제 articles.ts 와 같은 모양 — `const MAGAZINE_ARTICLE_RECORD` (export 없음)
  w('src/content/magazine/articles.ts', "import type { MagazineArticleBody } from './types'\n\nconst MAGAZINE_ARTICLE_RECORD = {\n  'old-article': { title: '기존 글', publishedAt: '2026-09-01' },\n} satisfies Record<string, MagazineArticleBody>\n\nexport const ALL = MAGAZINE_ARTICLE_RECORD\n")
  const real = fs.readFileSync(path.join(REPO, 'drafts/magazine/topic-queue.ts'), 'utf8')
  const header = real.slice(0, real.indexOf('export const TOPIC_QUEUE'))
  const row = (day, slug) => lib.renderQueueRow({ day, slug, title: `등록 시험 주제 ${slug}`, contentType: 'EVERGREEN', intent: '질문', cluster: 'daily',
    target: '50대', validationProfile: 'STANDARD', riskLevel: 'LOW', reviewMode: 'SUMMARY_ONLY', imageMode: 'OPTIONAL', autoEligible: true,
    ctaBoard: '/community/free', internalLinks: [], whyNow: '시험', notes: '시험' })
  w('drafts/magazine/topic-queue.ts', `${header}export const TOPIC_QUEUE: TopicQueueItem[] = [\n${row(10, 'reg-one')}${row(12, 'reg-two')}]\n`)
  for (const slug of ['reg-one', 'reg-two']) {
    w(`drafts/magazine/${slug}/article-draft.ts`, `export const DRAFT = {\n  title: '등록 시험 ${slug}',\n  description: '설명',\n  cluster: 'daily',\n  publishedAt: '',\n  body: [],\n}\n`)
    w(`drafts/magazine/${slug}/review.ts`, 'export const REVIEW = {}\n')
  }
  fs.mkdirSync(path.join(root, 'drafts/magazine/_runs'), { recursive: true })
  return {
    root, cli: path.join(root, 'scripts/magazine-register.mjs'),
    articles: path.join(root, 'src/content/magazine/articles.ts'), queue: path.join(root, 'drafts/magazine/topic-queue.ts'),
    journal: path.join(root, 'drafts/magazine/_runs/.register-journal.json'),
  }
}
const regCli = (m, extraEnv = {}) => [m.cli, '--slug', 'reg-one', '--publish-at', '2026-10-20', '--write', '--json']
const occurrences = (text, slug) => (text.match(new RegExp(`'${slug}':`, 'g')) ?? []).length
const miniState = (m) => ({ articles: fs.readFileSync(m.articles, 'utf8'), queue: fs.readFileSync(m.queue, 'utf8'), journal: fs.existsSync(m.journal) ? fs.readFileSync(m.journal, 'utf8') : null })
const testLockLeft = () => fs.existsSync(path.join(qlock.queueLockDir(), `${TEST_SCOPE}.queue.lock`))
async function killRegisterAt(m, stage) {
  const gate = path.join(m.root, `gate-${stage.replace(/:/g, '-')}`)
  const child = spawn('node', regCli(m), { env: { ...process.env, SORAN_QUEUE_TEST_GATE: gate, SORAN_QUEUE_TEST_PAUSE_AT: stage }, cwd: m.root, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = exitOf(child)
  const reached = await waitFor(`${gate}.reached`)
  child.kill('SIGKILL')
  const ex = await exited
  return { reached, signal: ex.signal }
}
const runRegister = (m) => { const r = spawnSync('node', regCli(m), { encoding: 'utf8', cwd: m.root }); return { status: r.status, j: parseJson(r.stdout, { verdict: `출력 없음 ${r.stderr.slice(0, 160)}` }) } }
{
  // A. articles 쓰기 직후 SIGKILL
  const m = makeMiniRepo()
  const k = await killRegisterAt(m, 'register:after-articles')
  const mid = miniState(m)
  expect('A 급사 — 실제 SIGKILL · articles 에 글 1 · 큐에 행이 남음 · journal 있음', [k.reached, k.signal, occurrences(mid.articles, 'reg-one'), hasQueued(mid.queue.replace(/reg-one/g, 'queued-one')), mid.journal !== null],
    [true, 'SIGKILL', 1, true, true])
  const n = runRegister(m)
  const fin = miniState(m)
  expect('A 다음 실제 register CLI — 복구(ROLLED_BACK) 뒤 정확히 한 번 등록', [n.status, n.j.verdict, n.j.applied, n.j.recovered?.action], [0, 'READY', true, 'ROLLED_BACK'])
  expect('A 결과 — articles 에 reg-one 1 · 기존 글 보존 · 큐 reg-one 0 · journal 0 · 잠금 0',
    [occurrences(fin.articles, 'reg-one'), occurrences(fin.articles, 'old-article'), parseQueueSource(fin.queue).some((r) => r.slug === 'reg-one'), fin.journal, testLockLeft()], [1, 1, false, null, false])
}
{
  // B. queue 쓰기 직후 · journal 삭제 전 SIGKILL
  const m = makeMiniRepo()
  const k = await killRegisterAt(m, 'register:after-queue')
  const mid = miniState(m)
  expect('B 급사 — 실제 SIGKILL · 두 파일 다 썼고 journal 만 남음', [k.reached, k.signal, occurrences(mid.articles, 'reg-one'), parseQueueSource(mid.queue).some((r) => r.slug === 'reg-one'), mid.journal !== null],
    [true, 'SIGKILL', 1, false, true])
  const n = runRegister(m)
  const fin = miniState(m)
  expect('B 다음 실행 — 이미 완주한 transaction 을 인식(COMPLETED) · 다시 쓰지 않는다', [n.status, n.j.verdict, n.j.recovered?.action, fin.articles === mid.articles, fin.queue === mid.queue], [0, 'READY', 'COMPLETED', true, true])
  expect('B 결과 — 중복 글 0 · 큐 행 0 · journal 0 · 잠금 0', [occurrences(fin.articles, 'reg-one'), parseQueueSource(fin.queue).some((r) => r.slug === 'reg-one'), fin.journal, testLockLeft()], [1, false, null, false])
  const again = runRegister(m)
  expect('B 한 번 더 실행해도 두 번 등록되지 않는다', [again.status, again.j.verdict, occurrences(fs.readFileSync(m.articles, 'utf8'), 'reg-one')], [1, 'BLOCKED', 1])
}
{
  // C. 급사 뒤 다른 writer 가 대상 파일을 바꿨다
  for (const [name, mutate] of [
    ['articles', (m) => fs.writeFileSync(m.articles, fs.readFileSync(m.articles, 'utf8').replace('} satisfies', "  'other-writer': { title: '다른 writer 의 글', publishedAt: '2026-10-25' },\n} satisfies"))],
    ['queue', (m) => fs.writeFileSync(m.queue, lib.insertQueueRows(fs.readFileSync(m.queue, 'utf8'), [{ day: 99, slug: 'g8-added', title: 'G8 이 더한 주제입니다', contentType: 'EVERGREEN', intent: '질문', cluster: 'daily',
      target: '50대', validationProfile: 'STANDARD', riskLevel: 'LOW', reviewMode: 'SUMMARY_ONLY', imageMode: 'REQUIRED', autoEligible: true, ctaBoard: '/community/free', internalLinks: [], whyNow: 'w', notes: 'n' }]))],
  ]) {
    const m = makeMiniRepo()
    await killRegisterAt(m, 'register:after-articles')
    mutate(m)
    const pre = miniState(m)
    const n = runRegister(m)
    const post = miniState(m)
    expect(`C 급사 뒤 다른 writer 가 ${name} 를 바꿨다 → RECOVERY_CONFLICT · 쓰기 0 · journal 유지`,
      [n.status, n.j.verdict, /RECOVERY_CONFLICT/.test((n.j.reasons ?? []).join(' ')), JSON.stringify(post) === JSON.stringify(pre), post.journal !== null], [1, 'BLOCKED', true, true, true])
  }
}
{
  // D. 위조 journal — 저장소 밖 경로 · 상대 · 중복 · 누락 · 추가 · schema
  const reg = await import(pathToFileURL(REG).href)
  const forged = async (name, makeFiles, extra = {}) => {
    const m = makeMiniRepo()
    const victim = path.join(path.dirname(m.root), `victim-${path.basename(m.root)}.txt`)
    fs.writeFileSync(victim, '저장소 밖 파일 — 바뀌거나 지워지면 안 된다')
    fixtures.push({ dir: victim })
    const canon = (f) => path.join(fs.realpathSync(path.dirname(f)), path.basename(f))
    const queueNow = fs.readFileSync(m.queue, 'utf8')
    const files = makeFiles({ victim, articles: canon(m.articles), queue: canon(m.queue), queueNow })
    fs.writeFileSync(m.journal, JSON.stringify({ schema: reg.REGISTER_JOURNAL_SCHEMA, txId: 'forged', slug: 'reg-one', files, ...extra }))
    const pre = { ...miniState(m), victim: fs.readFileSync(victim, 'utf8') }
    const n = runRegister(m)
    const post = { ...miniState(m), victim: fs.existsSync(victim) ? fs.readFileSync(victim, 'utf8') : null }
    expect(`D 위조 journal(${name}) → RECOVERY_IDENTITY · 외부 파일·대상 파일·journal 변경 0`,
      [n.status, /RECOVERY_IDENTITY/.test((n.j.reasons ?? []).join(' ')), JSON.stringify(post) === JSON.stringify(pre)], [1, true, true])
  }
  // 🔴 위조 항목이 CAS 를 통과하도록 만든다 — 신원 검증이 없으면 외부 파일이 실제로 바뀐다
  const victimAfter = ({ victim }) => ({ role: 'articles', path: victim, before: '덮어쓴 내용', afterSha: lib.sha256(fs.readFileSync(victim, 'utf8')) })
  const queueBefore = ({ queue, queueNow }) => ({ role: 'queue', path: queue, before: queueNow, afterSha: 'not-this' })
  await forged('저장소 밖 경로', (x) => [victimAfter(x), queueBefore(x)])
  await forged('상대 경로', (x) => [{ ...victimAfter(x), path: 'src/content/magazine/articles.ts' }, queueBefore(x)])
  await forged('중복 경로', (x) => [{ ...queueBefore(x), role: 'articles' }, queueBefore(x)])
  await forged('누락', (x) => [queueBefore(x)])
  await forged('추가', (x) => [{ ...victimAfter(x), path: x.articles }, queueBefore(x), victimAfter(x)])
  await forged('schema', (x) => [{ ...victimAfter(x), path: x.articles }, queueBefore(x)], { schema: 'register-journal/0' })
}


// ── ⑪ 실제 연구 정본 (읽기만) ────────────────────────────────
const REAL_RESEARCH = path.resolve(REPO, '..', 'soransoran-mgraph-research')
const REAL_SNAPSHOT = path.join(REAL_RESEARCH, 'reconciled', '2026-10-21-money-work-retirement-next-e0335')
if (fs.existsSync(path.join(REAL_RESEARCH, lib.ADMISSION_FILES.ledger))) {
  console.log('⑪ 실제 연구 정본 (읽기만)')
  for (const f of ['m3-pipeline.mjs', 'm3-product.mjs']) {
    expect(`fixture ${f} = 연구 정본 바이트`, lib.sha256(fs.readFileSync(path.join(PIPELINE_FIXTURE, f), 'utf8')), lib.sha256(fs.readFileSync(path.join(REAL_RESEARCH, 'contract', f), 'utf8')))
  }
  const v = lib.verifyAdmissionState({ researchDir: REAL_RESEARCH, repoDir: REPO })
  expect('실제 장부 — receipt 또는 KNOWN_LEGACY 로만 설명된다 (UNKNOWN 0 · 문제 0)', [v.classes.UNKNOWN, v.problems], [0, []])
  const pointer = /from '\.\/(g-[a-z0-9-]+)'/.exec(fs.readFileSync(path.join(REPO, lib.PRODUCT_FILES.graphCurrent), 'utf8'))?.[1]
  if (fs.existsSync(REAL_SNAPSHOT) && pointer === 'g-20261021-081d9a') {
    const pre = snapshot(path.join(REAL_RESEARCH, 'contract'))
    const m = await lib.buildManifest({ repoDir: REPO, researchDir: REAL_RESEARCH, snapshotDir: REAL_SNAPSHOT, at: '2026-10-22T00:30:00+09:00' })
    expect('실제 dry-run — readiness 시각 = --at(다음 날 00:30) · 판 이름 = 제품 current', [m.readiness.inputs.effectiveAt, m.readiness.inputs.graphVersion], ['2026-10-22T00:30:00+09:00', 'g-20261021-081d9a'])
    expect('실제 snapshot dry-run — 후보 I-T6-05 하나 · E-0188 · E-0329 + E-0100 · reverse E-0099',
      m.admissions.map((a) => [a.intentId, a.direct.map((x) => x.edgeId), a.discovery?.edgeId, a.reverse]), [['I-T6-05', ['E-0188', 'E-0329'], 'E-0100', ['E-0099']]])
    expect('실제 dry-run — 연구 contract 쓰기 0', JSON.stringify(snapshot(path.join(REAL_RESEARCH, 'contract'))) === JSON.stringify(pre), true)
  } else console.log('  SKIP 실제 snapshot dry-run — 제품 graph 가 g-20261021-081d9a 가 아니거나 snapshot 이 없다 (통과로 세지 않는다)')
} else {
  console.log('⑪ 실제 연구 정본 — SKIP (연구 디렉터리가 없다 · fixture Ⓐ~Ⓘ 가 같은 반례를 본다)')
}

{
  // 🔴 이 검사가 만든 시험 scope 잠금만 치운다 — 주인이 죽은 것만. 산 주인이 남아 있으면 그것이 결함이다
  const lockDir = qlock.queueLockDir()
  const leftovers = fs.existsSync(lockDir) ? fs.readdirSync(lockDir).filter((n) => n.startsWith(TEST_SCOPE)) : []
  let live = 0
  for (const n of leftovers) {
    const file = path.join(lockDir, n)
    let pid = null
    try { pid = JSON.parse(fs.readFileSync(file, 'utf8')).pid } catch { /* 깨진 잠금 — 아래에서 지운다 */ }
    let alive = false
    try { if (pid) { process.kill(pid, 0); alive = true } } catch { alive = false }
    if (alive) live++
    else fs.rmSync(file, { force: true })
  }
  expect('시험 scope 잠금을 쥔 산 프로세스 0', live, 0)
  // 🔴 이 검사의 모든 잠금은 임시 폴더에서 일어났다 — 운영 queue-locks 접근 0 (파일 접근 전 거부 가드가 함께 지킨다)
  expect('끝까지 잠금 폴더 = 시험 임시 폴더 (운영 queue-locks 아님)', [lockDir === TEST_LOCK_DIR, qlock.operationalQueueLockDirs().includes(lockDir)], [true, false])
}
for (const d of fixtures) fs.rmSync(d.dir, { recursive: true, force: true })
fs.rmSync(TEST_LOCK_DIR, { recursive: true, force: true })
finish()
process.exitCode = fail ? 1 : 0
