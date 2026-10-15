#!/usr/bin/env node
/**
 * DIRECT_SPEC_V1 상류 source 관문 검사 + 변이 — producer 가 승인 source 로만 article-spec.json 을 만드는가.
 *
 * 🔴 실제 진입 함수를 태운다: `planRun` · `runProducerFlow` · `supplyFromRunJson` · `legacyBriefTarget` ·
 *    `readRunTargets`/`fetchTargets` · `deliveryGate`. 임시 HOME · 임시 drafts · 임시 장부만 쓴다.
 *    ChatGPT · Claude · Chrome · 9333/9344 · 네트워크 · 운영 queue · 운영 장부 · launchd 접근 0.
 *
 * 반례
 *   S00 실제 저장소 — 제품 graphVersion 을 읽고, 승인 source 가 없어 NOT_READY 이며, 운영 큐 opt-in 0
 *   S01 exact graphVersion + 완전한 APPROVED source → spec 1 · 결정적 hash · run.json 신원 · fetch 관문까지 같은 specHash
 *   S02 stale graphVersion → spec · 패키지 · 선정 0
 *   S03 필수 필드 각각 누락 → spec · 패키지 · 선정 0, 사유에 그 필드 이름 (원문 없음)
 *   S04 APPROVED 아님 (entry · node · 승인자) → 0
 *   S05 source hash drift · G8 manifest drift → 0
 *   S06 같은 입력 재실행 → byte-identical · 두 번째 write 0
 *   S07 기존 다른 spec → 덮어쓰지 않고 차단 · 기존 바이트 보존
 *   S08 mixed direct+legacy → direct 는 spec, legacy 만 brief · legacy 바이트·지문 불변
 *   S09 selected 0 / reusable / no-work / UNKNOWN 의 기존 brief 의미 불변
 *   S10 legacy-only 회차는 HEAD 의 plan 과 run.json·패키지 바이트가 같고, 판정 함수 호출 0
 *   S11 제품 코드는 fixture · 연구 저장소를 import 하지 않는다
 *   S12 비STANDARD · 모르는 mode 는 선정에서 빠진다 (legacy brief 로 묻지 않는다)
 *
 * 변이 (원본 옆 임시 사본 · import 뒤 즉시 삭제 · 원본 바이트 불변을 마지막에 확인)
 *   plan · brief-auto · flow · source 의 call-site 를 하나씩 끊는다. 모두 위 반례 중 하나가 잡아야 한다.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PATHS = {
  plan: join(ROOT, 'scripts/magazine-producer-plan.mjs'),
  brief: join(ROOT, 'scripts/magazine-brief-auto.mjs'),
  flow: join(ROOT, 'scripts/lib/magazine-producer-flow.mjs'),
  source: join(ROOT, 'scripts/lib/magazine-direct-spec-source.mjs'),
  run: join(ROOT, 'scripts/magazine-producer-run.mjs'),
}
const FIXTURE = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')
const ORIGINAL = Object.fromEntries(Object.entries(PATHS).map(([k, p]) => [k, readFileSync(p, 'utf8')]))

// ── 격리 — import 전에 HOME · drafts 를 임시로 고정한다 (운영 장부 경로가 계산되기 전) ──
const TMPS = []
const tmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), `dssc-${prefix}-`)); TMPS.push(d); return d }
const HOME = tmp('home')
process.env.HOME = HOME
process.env.SORAN_MAGAZINE_TEST_MODE = '1'
process.env.SORAN_MAGAZINE_DRAFTS_DIR = tmp('drafts-env')
const MUTANTS = []
process.on('exit', () => {
  for (const f of MUTANTS) { try { unlinkSync(f) } catch { /* 이미 지웠다 */ } }
  for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } }
})

const real = {
  plan: await import(pathToFileURL(PATHS.plan).href),
  brief: await import(pathToFileURL(PATHS.brief).href),
  flow: await import(pathToFileURL(PATHS.flow).href),
  source: await import(pathToFileURL(PATHS.source).href),
}
const { compileArticleSpec } = await import(pathToFileURL(join(ROOT, 'scripts/lib/magazine-article-spec.mjs')).href)
const { deliveryGate } = await import(pathToFileURL(join(ROOT, 'scripts/lib/magazine-delivery-gate.mjs')).href)
const { readRunTargets, fetchTargets } = await import(pathToFileURL(join(ROOT, 'scripts/lib/magazine-run-targets.mjs')).href)
const { loadQueue } = await import(pathToFileURL(join(ROOT, 'scripts/lib/magazine-load.mjs')).href)

// ── 입력 ─────────────────────────────────────────────────────
const GV = real.source.readProductGraphVersion(join(ROOT, 'src/content/magazine/graph/current.ts'))
const STALE_GV = 'g-20260923-ad8e89'
const MANIFEST = 'sha256:dssc-g8-manifest-0001'
const TODAY = '2026-10-16'
const NOW = Date.parse('2026-10-16T00:10:00+09:00')
const DIRECT_SLUG = 'canary-direct-src-01'
const LEGACY_SLUG = 'canary-legacy-src-02'
const fx = () => JSON.parse(readFileSync(FIXTURE, 'utf8'))

const directItem = (over = {}) => {
  const q = fx().queueItem
  return { ...q, day: 9001, slug: DIRECT_SLUG, intentId: 'I-DSSC-01', g8ManifestHash: MANIFEST, directSpecMode: 'DIRECT_SPEC_V1', ...over }
}
const legacyItem = () => {
  const { intentId: _i, g8ManifestHash: _g, directSpecMode: _d, ...q } = fx().queueItem
  return { ...q, day: 9002, slug: LEGACY_SLUG }
}
function sourceEntry(mutate = (e) => e, { rehash = true } = {}) {
  const f = fx()
  let entry = {
    status: 'APPROVED', approvedBy: 'dssc-test-approver', approvedAt: '2026-10-15T12:00:00+09:00',
    g8ManifestHash: MANIFEST,
    node: { ...f.node, id: 'I-DSSC-01', intentId: 'I-DSSC-01', slug: DIRECT_SLUG, graphVersion: GV },
    relations: f.relations, hero: f.hero, publication: f.publication,
  }
  entry = mutate(structuredClone(entry)) ?? entry
  if (rehash) entry.sourceHash = real.source.directSpecSourceHash(entry)
  return entry
}
function writeSource(draftsDir, { graphVersion = GV, entries = [sourceEntry()], schema = real.source.DIRECT_SPEC_SOURCE_SCHEMA } = {}) {
  const p = real.source.directSpecSourcePath(draftsDir, GV)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `${JSON.stringify({ schema, graphVersion, entries }, null, 2)}\n`)
  return p
}
const deleteAt = (obj, path) => {
  const keys = path.split('.')
  const last = keys.pop()
  const parent = keys.reduce((o, k) => o?.[k], obj)
  if (parent) delete parent[last]
}
const missingMutation = (field) => (e) => {
  if (field === 'relations.direct') e.relations.direct = e.relations.direct.slice(0, 2)
  else if (field === 'node.outline') e.node.outline = e.node.outline.slice(0, 2)
  else deleteAt(e, field)
  return e
}

/** planRun 한 벌 — 전부 임시 경로. 반환: run.json · 파일 상태 · 판정 호출 수 */
function runPlan(planMod, { queue, prepare = () => {}, sourceMod = real.source, spyJudge = false } = {}) {
  const base = tmp('plan')
  const draftsDir = join(base, 'drafts')
  const runsDir = join(draftsDir, '_runs')
  mkdirSync(runsDir, { recursive: true })
  prepare(draftsDir)
  const calls = { judge: 0, graph: 0 }
  const out = planMod.planRun({
    today: TODAY, now: NOW, runsDir, draftsDir,
    loadArticlesFn: () => [], loadQueueFn: () => structuredClone(queue),
    inventoryFn: () => ({ inventoryDays: 0, counts: { live: 0, scheduled: 0, blocked: 0 } }),
    quarantinePath: join(base, 'quarantine.json'),
    heroExists: () => false, log: () => {},
    ...(spyJudge ? {
      productGraphVersionFn: () => { calls.graph++; return GV },
      directSourceFn: (a) => { calls.judge++; return sourceMod.judgeDirectSpecSource(a) },
    } : {}),
  })
  const runFile = join(runsDir, TODAY, 'run.json')
  const run = existsSync(runFile) ? JSON.parse(readFileSync(runFile, 'utf8')) : null
  const specPath = join(draftsDir, DIRECT_SLUG, 'article-spec.json')
  const selDir = join(runsDir, TODAY, 'selected')
  return {
    out, run, draftsDir, runsDir, calls, runFile,
    spec: existsSync(specPath) ? readFileSync(specPath, 'utf8') : null,
    packages: existsSync(selDir) ? readdirSync(selDir).sort() : [],
    selected: (run?.selected ?? []).map((s) => s.slug),
    held: run?.held ?? [],
  }
}
const heldOf = (r, slug = DIRECT_SLUG) => r.held.find((h) => h.slug === slug)
function assertNothingForDirect(r, label) {
  assert.equal(r.spec, null, `${label}: article-spec.json 이 생겼다`)
  assert.ok(!r.selected.includes(DIRECT_SLUG), `${label}: direct 행이 선정됐다`)
  assert.ok(!r.packages.includes(DIRECT_SLUG), `${label}: direct 행에 brief 재료가 놓였다`)
  const fetchSet = fetchTargets(readRunTargets({ draftsDir: r.draftsDir, date: TODAY }).targets).map((t) => t.slug)
  assert.ok(!fetchSet.includes(DIRECT_SLUG), `${label}: direct 행이 원고 회수(provider·probe) 대상이 됐다`)
  const h = heldOf(r)
  assert.ok(h, `${label}: slug HOLD 기록이 없다`)
  return h
}

// ── 반례 묶음 — 모듈을 받아 실패 목록을 돌려준다 (실제·변이 공용) ──────────────
function sourceCases(src) {
  const judge = (queueItem, prepare) => {
    const d = tmp('judge')
    prepare?.(d)
    return src.judgeDirectSpecSource({ queueItem, draftsDir: d, expectedGraphVersion: GV })
  }
  return [
    ['S02 stale graphVersion — NOT_READY · observed 기록', () => {
      const r = judge(directItem(), (d) => writeSource(d, { graphVersion: STALE_GV, entries: [sourceEntry((e) => { e.node.graphVersion = STALE_GV; return e })] }))
      assert.equal(r.ok, false); assert.equal(r.code, 'DIRECT_SPEC_SOURCE_NOT_READY')
      assert.equal(r.evidence.expectedGraphVersion, GV); assert.equal(r.evidence.observedGraphVersion, STALE_GV)
      assert.ok(r.evidence.blockers.includes('GRAPH_VERSION_STALE'))
    }],
    ...real.source.DIRECT_SPEC_REQUIRED_FIELDS.map((field) => [`S03 필드 누락 ${field} — NOT_READY · FIELDS_MISSING`, () => {
      const r = judge(directItem(), (d) => writeSource(d, { entries: [sourceEntry(missingMutation(field))] }))
      assert.equal(r.ok, false, `${field} 없이 준비됐다`)
      assert.ok(r.evidence.missingFields.includes(field), `missingFields 에 ${field} 가 없다`)
      if (!['node.intentId', 'node.slug'].includes(field)) assert.ok(r.evidence.blockers.includes('FIELDS_MISSING'), `${field}: FIELDS_MISSING 사유가 없다`)
      assert.ok(!JSON.stringify(r.evidence).includes(fx().node.readerQuestion), 'evidence 에 source 원문이 들어갔다')
    }]),
    ['S04a entry.status DRAFT (node 는 APPROVED) — NOT_APPROVED', () => {
      const r = judge(directItem(), (d) => writeSource(d, { entries: [sourceEntry((e) => { e.status = 'DRAFT'; return e })] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('NOT_APPROVED')); assert.equal(r.evidence.approvalStatus, 'DRAFT')
    }],
    ['S04b 승인자 없음 — NOT_APPROVED', () => {
      const r = judge(directItem(), (d) => writeSource(d, { entries: [sourceEntry((e) => { e.approvedBy = ''; return e })] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('NOT_APPROVED'))
    }],
    ['S05a source hash drift — SOURCE_HASH_DRIFT', () => {
      const entry = sourceEntry()
      entry.node.readerQuestion = `${entry.node.readerQuestion} (승인 뒤 바뀜)`
      const r = judge(directItem(), (d) => writeSource(d, { entries: [entry] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('SOURCE_HASH_DRIFT'))
    }],
    ['S05b G8 manifest drift — MANIFEST_DRIFT', () => {
      const r = judge(directItem({ g8ManifestHash: 'sha256:dssc-other-manifest' }), (d) => writeSource(d))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('MANIFEST_DRIFT'))
    }],
    ['S05c schema 모름 — SOURCE_SCHEMA_UNKNOWN', () => {
      const r = judge(directItem(), (d) => writeSource(d, { schema: 'magazine-article-spec-source/0' }))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('SOURCE_SCHEMA_UNKNOWN'))
    }],
    ['S12a 비STANDARD 프로필 — PROFILE_NOT_STANDARD', () => {
      const r = judge(directItem({ validationProfile: 'MEDICAL' }), (d) => writeSource(d))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('PROFILE_NOT_STANDARD'))
    }],
    ['S06 같은 입력 → 같은 바이트 · 두 번째 write 0', () => {
      const d1 = tmp('idem1'); const d2 = tmp('idem2')
      writeSource(d1); writeSource(d2)
      const j1 = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: d1, expectedGraphVersion: GV })
      const j2 = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: d2, expectedGraphVersion: GV })
      assert.equal(j1.ok, true, j1.why); assert.equal(j1.spec.specHash, j2.spec.specHash)
      const a = src.persistDirectSpecNoClobber({ spec: j1.spec, draftsDir: d1 })
      const b = src.persistDirectSpecNoClobber({ spec: j2.spec, draftsDir: d2 })
      assert.equal(readFileSync(a.path, 'utf8'), readFileSync(b.path, 'utf8'))
      const again = src.persistDirectSpecNoClobber({ spec: j1.spec, draftsDir: d1 })
      assert.equal(again.ok, true); assert.equal(again.written, false)
    }],
    ['S07 기존 다른 spec — DIRECT_SPEC_SPEC_CONFLICT · 기존 바이트 보존', () => {
      const d = tmp('conflict'); writeSource(d)
      const j = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: d, expectedGraphVersion: GV })
      assert.equal(j.ok, true, j.why)
      const p = join(d, DIRECT_SLUG, 'article-spec.json')
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, '{"other":"spec"}\n')
      const r = src.persistDirectSpecNoClobber({ spec: j.spec, draftsDir: d })
      assert.equal(r.ok, false); assert.equal(r.code, 'DIRECT_SPEC_SPEC_CONFLICT')
      assert.equal(readFileSync(p, 'utf8'), '{"other":"spec"}\n')
    }],
  ]
}

function planCases(plan) {
  return [
    ['S01 exact + APPROVED → spec 1 · run.json 신원 · fetch 관문 같은 specHash', () => {
      const r = runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d) })
      assert.equal(r.out.code, 0)
      assert.ok(r.spec, 'article-spec.json 이 없다')
      assert.deepEqual(r.selected, [DIRECT_SLUG])
      assert.ok(!r.packages.includes(DIRECT_SLUG), 'direct 행에 legacy brief 재료가 놓였다')
      const row = r.run.selected[0].directSpec
      assert.ok(row, 'run.json selected 행에 directSpec 이 없다')
      const f = fx()
      const expected = compileArticleSpec({
        node: sourceEntry().node, queueItem: { ...directItem(), validationProfile: 'STANDARD' },
        relations: f.relations, publication: f.publication, hero: f.hero,
      })
      assert.deepEqual(
        { mode: row.mode, slug: row.slug, intentId: row.intentId, graphVersion: row.graphVersion, g8ManifestHash: row.g8ManifestHash, schemaVersion: row.schemaVersion, specHash: row.specHash, written: row.written },
        { mode: 'DIRECT_SPEC_V1', slug: DIRECT_SLUG, intentId: 'I-DSSC-01', graphVersion: GV, g8ManifestHash: MANIFEST, schemaVersion: 'magazine-article-spec/1', specHash: expected.specHash, written: true },
      )
      assert.equal(row.sourceHash, sourceEntry().sourceHash)
      assert.equal(JSON.parse(r.spec).specHash, expected.specHash)
      const targets = readRunTargets({ draftsDir: r.draftsDir, date: TODAY }).targets
      const t = fetchTargets(targets).find((x) => x.slug === DIRECT_SLUG)
      assert.ok(t, 'direct 행이 원고 회수 대상이 아니다')
      const g = deliveryGate({ slug: DIRECT_SLUG, draftsDir: r.draftsDir, quarantinePath: join(r.draftsDir, 'q.json'), queueItem: t.queueItem })
      assert.equal(g.ok, true, g.why); assert.equal(g.specHash, expected.specHash)
      assert.equal(existsSync(join(r.draftsDir, DIRECT_SLUG, 'brief.md')), false)
    }],
    ['S01b dry-run — 판정은 하되 spec write 0', () => {
      const base = tmp('dry'); const draftsDir = join(base, 'drafts'); writeSource(draftsDir)
      const out = plan.planRun({ today: TODAY, now: NOW, dryRun: true, runsDir: join(draftsDir, '_runs'), draftsDir,
        loadArticlesFn: () => [], loadQueueFn: () => [directItem()], log: () => {},
        inventoryFn: () => ({ inventoryDays: 0, counts: { live: 0, scheduled: 0, blocked: 0 } }),
        quarantinePath: join(base, 'q.json'), heroExists: () => false })
      assert.equal(out.run.selected[0]?.directSpec?.written, false)
      assert.equal(existsSync(join(draftsDir, DIRECT_SLUG)), false)
    }],
    ['S02p stale graphVersion → 선정·spec·패키지·회수 0', () => {
      const r = runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d, { graphVersion: STALE_GV, entries: [sourceEntry((e) => { e.node.graphVersion = STALE_GV; return e })] }) })
      const h = assertNothingForDirect(r, 'stale')
      assert.equal(h.code, 'DIRECT_SPEC_SOURCE_NOT_READY'); assert.equal(h.directSpec.observedGraphVersion, STALE_GV)
    }],
    ['S02q source 없음 → NOT_READY · 전 필드 missing · sourcePath', () => {
      const r = runPlan(plan, { queue: [directItem()] })
      const h = assertNothingForDirect(r, 'absent')
      assert.deepEqual(h.directSpec.blockers, ['SOURCE_ABSENT'])
      assert.equal(h.directSpec.expectedGraphVersion, GV); assert.equal(h.directSpec.observedGraphVersion, null)
      assert.equal(h.directSpec.missingFields.length, real.source.DIRECT_SPEC_REQUIRED_FIELDS.length)
      assert.ok(h.directSpec.sourcePath.endsWith(`article-spec-source/${GV}.json`))
    }],
    ...real.source.DIRECT_SPEC_REQUIRED_FIELDS.map((field) => [`S03p 필드 누락 ${field} → 선정·spec·패키지·회수 0`, () => {
      const r = runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d, { entries: [sourceEntry(missingMutation(field))] }) })
      const h = assertNothingForDirect(r, field)
      assert.ok(h.directSpec.missingFields.includes(field))
    }]),
    ['S04p 미승인 → 0', () => {
      const r = runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d, { entries: [sourceEntry((e) => { e.status = 'PENDING'; return e })] }) })
      assert.equal(assertNothingForDirect(r, 'pending').directSpec.approvalStatus, 'PENDING')
    }],
    ['S05p hash drift → 0', () => {
      const e = sourceEntry(); e.node.outline = [...e.node.outline].reverse()
      const r = runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d, { entries: [e] }) })
      assert.ok(assertNothingForDirect(r, 'drift').directSpec.blockers.includes('SOURCE_HASH_DRIFT'))
    }],
    ['S08 mixed — direct 는 spec·패키지 0, legacy 는 패키지 1 · legacy 바이트 = legacy-only 회차', () => {
      const mixed = runPlan(plan, { queue: [directItem(), legacyItem()], prepare: (d) => writeSource(d) })
      const only = runPlan(plan, { queue: [legacyItem()] })
      assert.deepEqual(mixed.selected.sort(), [DIRECT_SLUG, LEGACY_SLUG].sort())
      assert.ok(mixed.spec)
      assert.deepEqual(mixed.packages, [LEGACY_SLUG])
      const todo = (r) => readFileSync(join(r.runsDir, TODAY, 'selected', LEGACY_SLUG, 'brief.todo.md'), 'utf8')
      assert.equal(todo(mixed), todo(only))
      const lrow = (r) => r.run.selected.find((s) => s.slug === LEGACY_SLUG)
      assert.deepEqual(lrow(mixed), lrow(only))
      // legacy 지문 — 같은 brief.md 를 놓고 run.json 행을 운반해도 queueItem 없음과 같은 바이트
      for (const r of [mixed, only]) {
        mkdirSync(join(r.draftsDir, LEGACY_SLUG), { recursive: true })
        writeFileSync(join(r.draftsDir, LEGACY_SLUG, 'brief.md'), real.plan.briefTodo(legacyItem()))
      }
      const t = readRunTargets({ draftsDir: mixed.draftsDir, date: TODAY }).targets.find((x) => x.slug === LEGACY_SLUG)
      const q = join(tmp('lq'), 'q.json')
      const withRow = deliveryGate({ slug: LEGACY_SLUG, draftsDir: mixed.draftsDir, quarantinePath: q, queueItem: t.queueItem })
      const bare = deliveryGate({ slug: LEGACY_SLUG, draftsDir: only.draftsDir, quarantinePath: q })
      assert.equal(withRow.message, bare.message); assert.equal(withRow.messageFingerprint, bare.messageFingerprint)
    }],
    ['S12b 모르는 directSpecMode → 선정 0 · HOLD UNKNOWN_MAGAZINE_AUTO_MODE · legacy 는 계속', () => {
      const r = runPlan(plan, { queue: [directItem({ directSpecMode: 'DIRECT_SPEC_V9' }), legacyItem()] })
      assert.deepEqual(r.selected, [LEGACY_SLUG])
      assert.equal(heldOf(r).code, 'UNKNOWN_MAGAZINE_AUTO_MODE')
    }],
    ['S12c 준비 안 된 direct 가 빠지면 legacy 가 그 슬롯을 받는다', () => {
      const legacies = Array.from({ length: 5 }, (_, i) => ({ ...legacyItem(), day: 9010 + i, slug: `canary-legacy-fill-${i}` }))
      const r = runPlan(plan, { queue: [directItem({ day: 1 }), ...legacies] })
      assert.equal(r.selected.length, 5); assert.ok(!r.selected.includes(DIRECT_SLUG))
    }],
    ['S10 legacy-only — 판정 함수·제품 graph 읽기 0', () => {
      const r = runPlan(plan, { queue: [legacyItem()], spyJudge: true })
      assert.deepEqual(r.calls, { judge: 0, graph: 0 }); assert.deepEqual(r.held, [])
      assert.ok(!('directSpec' in r.run.selected[0]))
    }],
  ]
}

function briefCases(brief) {
  return [
    ['S08b brief 대상 — legacy 만 · direct 는 SKIP_DIRECT · 모르는 mode 는 HOLD', () => {
      assert.deepEqual(brief.legacyBriefTarget(legacyItem()), { brief: true })
      assert.deepEqual(brief.legacyBriefTarget(null), { brief: true })
      assert.equal(brief.legacyBriefTarget(directItem()).status, 'SKIP_DIRECT')
      assert.equal(brief.legacyBriefTarget(directItem({ directSpecMode: 'X' })).status, 'HOLD')
    }],
  ]
}

async function flowCases(flow, plan, brief) {
  /** 실제 runProducerFlow + 실제 planRun + 실제 run.json 해석 — brief 는 실제 대상 판정으로 센다 */
  const drive = async ({ queue, prepare }) => {
    const base = tmp('flow'); const draftsDir = join(base, 'drafts'); const runsDir = join(draftsDir, '_runs')
    mkdirSync(runsDir, { recursive: true }); prepare?.(draftsDir)
    const qBySlug = new Map(queue.map((x) => [x.slug, x]))
    const briefed = []; let briefSpawns = 0; let fetchSpawns = 0
    const res = await flow.runProducerFlow({ dryRun: false, deps: {
      log: () => {}, checkLock: () => ({ ok: true }), checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
      checkOutstanding: () => ({ ok: true, message: '없음' }),
      runPlan: () => ({ status: plan.planRun({ today: TODAY, now: NOW, runsDir, draftsDir, loadArticlesFn: () => [], loadQueueFn: () => structuredClone(queue),
        inventoryFn: () => ({ inventoryDays: 0, counts: { live: 0, scheduled: 0, blocked: 0 } }), quarantinePath: join(base, 'q.json'), heroExists: () => false, log: () => {} }).code }),
      readSupply: () => flow.supplyFromRunJson(JSON.parse(readFileSync(join(runsDir, TODAY, 'run.json'), 'utf8'))),
      runBrief: () => {
        briefSpawns++
        const sel = join(runsDir, TODAY, 'selected')
        for (const slug of existsSync(sel) ? readdirSync(sel) : []) if (brief.legacyBriefTarget(qBySlug.get(slug) ?? null).brief) briefed.push(slug)
        return { status: 0 }
      },
      runFetch: () => { fetchSpawns++; return { status: 0 } },
      notify: () => ({ ok: true }),
    } })
    return { res, briefed, briefSpawns, fetchSpawns, draftsDir }
  }
  const supplyFlow = async (supply) => {
    let briefSpawns = 0
    const res = await flow.runProducerFlow({ dryRun: false, deps: {
      log: () => {}, checkLock: () => ({ ok: true }), checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
      checkOutstanding: () => ({ ok: true, message: '없음' }), runPlan: () => ({ status: 0 }), readSupply: () => supply,
      runBrief: () => { briefSpawns++; return { status: 0 } }, runFetch: () => ({ status: 0 }), notify: () => ({ ok: true }),
    } })
    return { res, briefSpawns }
  }
  return [
    ['S08c 실제 flow mixed — brief 자식 1회 · 대상은 legacy 1건뿐', async () => {
      const r = await drive({ queue: [directItem(), legacyItem()], prepare: (d) => writeSource(d) })
      assert.equal(r.briefSpawns, 1); assert.deepEqual(r.briefed, [LEGACY_SLUG]); assert.equal(r.res.code, 0)
      assert.ok(existsSync(join(r.draftsDir, DIRECT_SLUG, 'article-spec.json')))
    }],
    ['S08d 실제 flow direct-only — brief 자식 0 · spec 1', async () => {
      const r = await drive({ queue: [directItem()], prepare: (d) => writeSource(d) })
      assert.equal(r.briefSpawns, 0); assert.ok(!r.res.ran.includes('brief')); assert.equal(r.res.code, 0)
      assert.ok(existsSync(join(r.draftsDir, DIRECT_SLUG, 'article-spec.json')))
    }],
    ['S08e 실제 flow source 없음 — brief 0 · spec 0 · 선정 0(NO_WORK)', async () => {
      const r = await drive({ queue: [directItem()] })
      assert.equal(r.briefSpawns, 0); assert.equal(existsSync(join(r.draftsDir, DIRECT_SLUG)), false)
    }],
    ['S09 공급 의미 불변 — NO_WORK·REUSE_READY 는 brief 0, UNKNOWN·옛 신호·legacy≥1 은 brief 1', async () => {
      const cases = [
        [{ selected: 0, reusable: 0 }, 0], [{ selected: 0, reusable: 2 }, 0], [{ selected: null, reusable: 0 }, 1],
        [{ selected: 2, reusable: 0 }, 1], [{ selected: 2, reusable: 0, legacySelected: 1 }, 1],
        [{ selected: 2, reusable: 0, legacySelected: 0 }, 0], [{ selected: 0, reusable: 0, legacySelected: 0 }, 0],
      ]
      for (const [supply, want] of cases) assert.equal((await supplyFlow(supply)).briefSpawns, want, JSON.stringify(supply))
      assert.deepEqual(flow.supplyFromRunJson({ selected: [{ slug: 'a' }, { slug: 'b', directSpec: {} }], reusable: [1] }), { selected: 2, reusable: 1, legacySelected: 1 })
      assert.deepEqual(flow.supplyFromRunJson({}), { selected: null, reusable: 0, legacySelected: null })
    }],
  ]
}

// ── 실행기 ─────────────────────────────────────────────────
async function runCases(cases) {
  const failures = []
  for (const [name, fn] of cases) {
    try { await fn() } catch (e) { failures.push(`${name} — ${e.message.split('\n')[0]}`) }
  }
  return { total: cases.length, failures }
}

let pass = 0
let fail = 0
const report = (ok, name, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// S00 실제 저장소 (읽기 전용)
{
  const ok = (() => {
    try {
      assert.equal(GV, 'g-20261015-d5f6fe', `제품 graphVersion 이 감사 시점과 다르다: ${GV}`)
      const r = real.source.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: join(ROOT, 'drafts/magazine'), expectedGraphVersion: GV, repoRoot: ROOT })
      assert.equal(r.ok, false); assert.deepEqual(r.evidence.blockers, ['SOURCE_ABSENT'])
      assert.equal(r.evidence.sourcePath, `drafts/magazine/article-spec-source/${GV}.json`)
      assert.equal(loadQueue().filter((q) => q.directSpecMode).length, 0, '운영 큐에 opt-in 행이 있다')
      assert.equal(existsSync(join(ROOT, 'drafts/magazine/article-spec-source')), false)
      return true
    } catch (e) { console.log(`  ${e.message}`); return false }
  })()
  report(ok, 'S00 실제 저장소 — 제품 graphVersion · source 부재 NOT_READY · 운영 opt-in 0')
}

// S10 legacy-only — HEAD plan 과 run.json·패키지 바이트 비교
{
  const headSrc = spawnSync('git', ['show', 'HEAD:scripts/magazine-producer-plan.mjs'], { cwd: ROOT, encoding: 'utf8' })
  let ok = headSrc.status === 0
  if (ok) {
    const headPath = join(ROOT, 'scripts', `.dssc-head-${process.pid}-magazine-producer-plan.mjs`)
    MUTANTS.push(headPath); writeFileSync(headPath, headSrc.stdout)
    try {
      const head = await import(pathToFileURL(headPath).href)
      const queue = [legacyItem(), { ...legacyItem(), day: 9003, slug: 'canary-legacy-src-03' }]
      const a = runPlan(head, { queue }); const b = runPlan(real.plan, { queue })
      const strip = (run) => JSON.stringify({ ...run, startedAt: null, finishedAt: null })
      assert.equal(strip(b.run), strip(a.run))
      for (const slug of a.packages) for (const f of ['brief.todo.md', 'review.todo.md']) {
        assert.equal(readFileSync(join(b.runsDir, TODAY, 'selected', slug, f), 'utf8'), readFileSync(join(a.runsDir, TODAY, 'selected', slug, f), 'utf8'))
      }
      assert.deepEqual(b.packages, a.packages)
    } catch (e) { ok = false; console.log(`  ${e.message.split('\n')[0]}`) } finally { unlinkSync(headPath) }
  }
  report(ok, 'S10 legacy-only 회차 — HEAD plan 과 run.json · brief/review 재료 바이트 동일')
}

// S11 제품 코드는 fixture · 연구 저장소를 import 하지 않는다
const productImportProblems = (text) => [...text.matchAll(/^\s*import[^\n]*?['"]([^'"]+)['"]/gm)]
  .map((m) => m[1]).filter((p) => /__fixtures__|soransoran-mgraph-research|contract\/build/.test(p))
{
  const bad = ['plan', 'brief', 'flow', 'source', 'run'].flatMap((k) => productImportProblems(ORIGINAL[k]).map((p) => `${k}: ${p}`))
  report(bad.length === 0, 'S11 제품 코드가 fixture · 연구 저장소를 import 하지 않는다', bad.join(', '))
}

for (const [name, fn] of [...sourceCases(real.source), ...planCases(real.plan), ...briefCases(real.brief), ...await flowCases(real.flow, real.plan, real.brief)]) {
  try { await fn(); report(true, name) } catch (e) { report(false, name, e.message.split('\n')[0]) }
}
const realPass = pass
const realFail = fail

// ── 변이 ───────────────────────────────────────────────────
const MUTATIONS = [
  ['plan', 'MP1', 'run.json directSpec 신원 제거', '        ...(directReady.has(i.slug) ? { directSpec: directSpecRow(directReady.get(i.slug), directPersisted.get(i.slug)) } : {}),\n', ''],
  ['plan', 'MP2', 'direct 행에 legacy brief 재료를 놓는다', '        if (directReady.has(item.slug)) continue\n', ''],
  ['plan', 'MP3', 'direct source 판정 우회 (legacy 처럼 선정)', 'if (mode.mode !== DIRECT_SPEC_MODE || ready.has(item.slug)) continue', 'continue'],
  ['plan', 'MP4', 'expected graphVersion 전달 제거', 'return directSourceFn({ queueItem, draftsDir, expectedGraphVersion, repoRoot: REPO_ROOT })', 'return directSourceFn({ queueItem, draftsDir, repoRoot: REPO_ROOT })'],
  ['plan', 'MP5', 'spec 저장 제거', 'const p = persistSpecFn({ spec: j.spec, draftsDir })', 'const p = { ok: true, written: false }'],
  ['plan', 'MP6', 'NOT_READY HOLD 기록 제거', 'const held = [...directHeld]', 'const held = []'],
  ['plan', 'MP7', '모르는 mode 를 legacy 로 묻는다', "if (!mode.ok) { drop.push({ day: item.day, slug: item.slug, code: mode.code, why: mode.why }); continue }", 'if (!mode.ok) continue'],
  ['brief', 'MB1', 'brief-auto 가 direct 행에도 brief 를 만든다', 'if (mode.mode !== LEGACY_BRIEF_MODE) {', 'if (false) {'],
  ['flow', 'MF1', 'direct-only 회차에도 brief 자식을 띄운다', "const directOnly = supplyState === 'NEW_WORK' && legacySelected === 0", 'const directOnly = false'],
  ['flow', 'MF2', 'legacySelected 를 selected 전체로 센다', 'legacySelected: selected ? selected.filter((s) => !s?.directSpec).length : null,', 'legacySelected: selected ? selected.length : null,'],
  ['source', 'MS1', 'APPROVED 검사 제거', "if (entry.status !== 'APPROVED' || entry.node?.status !== 'APPROVED' || !String(entry.approvedBy ?? '').trim() || !String(entry.approvedAt ?? '').trim()) {", 'if (false) {'],
  ['source', 'MS2', 'stale research 허용 (graphVersion 검사 제거)', "  if (evidence.observedGraphVersion !== expectedGraphVersion) blockers.push('GRAPH_VERSION_STALE')\n", ''],
  ['source', 'MS3', 'source hash 검사 제거', "if (entry.sourceHash !== directSpecSourceHash(entry)) blockers.push('SOURCE_HASH_DRIFT')", ''],
  ['source', 'MS4', 'G8 manifest 대조 제거', "if (entry.g8ManifestHash !== queueItem?.g8ManifestHash) blockers.push('MANIFEST_DRIFT')", ''],
  ['source', 'MS5', '필수 필드 검사 제거', "if (evidence.missingFields.length) blockers.push('FIELDS_MISSING')", ''],
  ['source', 'MS6', '기존 spec 을 덮어쓴다', 'if (existsSync(path)) return sameOrConflict()', 'if (existsSync(path)) unlinkSync(path)'],
  ['source', 'MS7', 'STANDARD 검사 제거', "if (!lane.ok || lane.profile !== DIRECT_SPEC_CANARY_PROFILE) blockers.push('PROFILE_NOT_STANDARD')", ''],
  ['source', 'MS8', '운영 fixture 를 제품 코드에서 import', "import { createHash } from 'node:crypto'", "import { createHash } from 'node:crypto'\nimport '../__fixtures__/magazine/direct-spec/canary.input.json' with { type: 'json' }"],
]
// MS2 는 node.graphVersion 검사까지 지워야 '연구 판 허용' 이 된다
const MS2_SECOND = ["  if (entry.node?.graphVersion !== expectedGraphVersion) blockers.push('GRAPH_VERSION_STALE')\n", '']

console.log('\n── 변이 — 각 변이를 위 반례 중 하나가 잡아야 한다')
for (const [kind, id, label, from, to] of MUTATIONS) {
  let caught = false
  let why = ''
  let src = ORIGINAL[kind]
  if (!src.includes(from)) { report(false, `${id} ${label}`, '변이 지점을 찾지 못했다 (하네스 결함)'); continue }
  src = src.replace(from, to)
  if (id === 'MS2') src = src.replace(MS2_SECOND[0], MS2_SECOND[1])
  const path = join(dirname(PATHS[kind]), `.dssc-${id}-${process.pid}-${PATHS[kind].split('/').pop()}`)
  MUTANTS.push(path); writeFileSync(path, src)
  try {
    if (id === 'MS8') {
      const bad = productImportProblems(src)
      caught = bad.length > 0; why = bad.join(',')
    } else {
      const mod = await import(pathToFileURL(path).href)
      const cases = kind === 'plan' ? planCases(mod)
        : kind === 'brief' ? [...briefCases(mod), ...await flowCases(real.flow, real.plan, mod)]
          : kind === 'flow' ? await flowCases(mod, real.plan, real.brief)
            : sourceCases(mod)
      const r = await runCases(cases)
      caught = r.failures.length > 0; why = r.failures[0] ?? '모든 반례가 통과했다'
    }
  } catch (e) { caught = true; why = `적재 실패: ${e.message.split('\n')[0]}` } finally { try { unlinkSync(path) } catch { /* 이미 지웠다 */ } }
  report(caught, `${id} ${label} → 잡혔다`, caught ? why.slice(0, 140) : why)
}

// 원본 바이트 불변 · 변이 잔여 0
{
  const changed = Object.entries(PATHS).filter(([k, p]) => readFileSync(p, 'utf8') !== ORIGINAL[k]).map(([k]) => k)
  const residue = ['scripts', 'scripts/lib'].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.startsWith('.dssc-')))
  report(changed.length === 0 && residue.length === 0, '변이 뒤 원본 바이트 불변 · 임시 사본 잔여 0', [...changed, ...residue].join(', '))
}

console.log(`\nDIRECT_SPEC source 관문: ${pass} pass, ${fail} fail (실제 반례 ${realPass} pass · ${realFail} fail)`)
process.exit(fail === 0 ? 0 : 1)
