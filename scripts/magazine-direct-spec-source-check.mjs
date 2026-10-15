#!/usr/bin/env node
/**
 * DIRECT_SPEC_V1 상류 source 관문 검사 + 변이 — producer 가 승인 source 로만 article-spec.json 을 만들고,
 * 재사용·등록도 같은 관문을 지나는가.
 *
 * 🔴 실제 진입 함수를 태운다: `planRun` · `runProducerFlow` · `supplyFromRunJson` · `legacyBriefTarget` ·
 *    `readRunTargets`/`fetchTargets` · `deliveryGate` · 등록 `gate`(auto-lane) · notify `judge` · `nextActionFor`.
 *    임시 HOME · 임시 drafts · 임시 장부만 쓴다.
 *    ChatGPT · Claude · Chrome · 9333/9344 · 네트워크 · 운영 queue · 운영 장부 · launchd 접근 0.
 *
 * 🔴 영구 계약에 지금 시점의 사실(특정 graphVersion 문자열 · source 폴더 부재 · opt-in 0)을 고정하지 않는다.
 *    제품 graphVersion 은 current.ts 에서 동적으로 읽고, source 부재·존재는 시험 폴더의 fixture 로 각각 본다.
 *
 * 반례
 *   S00 제품 current.ts 에서 graphVersion 을 동적으로 읽는다
 *   S01 exact graphVersion + 완전한 APPROVED source → spec 1 · 결정적 hash · run.json 신원 · fetch 관문까지 같은 specHash
 *   S02 stale graphVersion / source 부재 → spec · 패키지 · 선정 · 회수 0
 *   S03 필수 필드 각각 누락 → 0, 사유에 그 필드 이름 (원문 없음)
 *   S04 APPROVED 아님 (entry · 승인자) → 0
 *   S05 source hash drift · G8 manifest drift · schema 모름 → 0
 *   S06 같은 입력 재실행 → byte-identical · 두 번째 write 0
 *   S07 기존 다른 spec → 덮어쓰지 않고 차단 · 기존 바이트 보존
 *   S08 mixed direct+legacy → direct 는 spec, legacy 만 brief · legacy 바이트·지문 불변
 *   S09 selected 0 / reusable / no-work / UNKNOWN 의 기존 brief 의미 불변
 *   S10 legacy golden — 부모 47b8314e 로 만든 고정 기준과 run.json·todo 재료·메시지·지문이 같다 · 판정 호출 0
 *   S11 제품 코드는 fixture · 연구 저장소를 import 하지 않는다
 *   S12 비STANDARD · 모르는 mode 는 선정에서 빠진다
 *   R*  재사용 direct (P0) — spec 저장 직후 급사 → 다음 회차 source 부재·교체·승인 취소·stale 은 재사용·회수·등록 0,
 *       같은 source 면 멱등 재사용, spec 없는 재사용 폴더는 저장 후 재사용
 *   N*  운영 관측 (P1) — direct 보류는 알림 1건 · direct 원고 실패를 brief 누락과 분리 · legacy 문구 불변
 *   H*  hero 계약 — REQUIRED 는 alt·scene 필수, NO_IMAGE 는 둘 다 금지, OPTIONAL 은 ArticleSpec 계약
 *
 * 변이 (원본 옆 임시 사본 · import 뒤 즉시 삭제 · 원본 바이트 불변을 마지막에 확인)
 *   plan · brief-auto · flow · source · auto-lane · notify · webui 의 call-site 를 하나씩 끊는다.
 */
import assert from 'node:assert/strict'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync,
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
  lane: join(ROOT, 'scripts/lib/magazine-auto-lane.mjs'),
  notify: join(ROOT, 'scripts/magazine-producer-notify.mjs'),
  webui: join(ROOT, 'scripts/magazine-webui-runner.mjs'),
  run: join(ROOT, 'scripts/magazine-producer-run.mjs'),
  gate: join(ROOT, 'scripts/lib/magazine-delivery-gate.mjs'),
}
const FIXTURE = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')
const GOLDEN_DIR = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/legacy-golden')
const ORIGINAL = Object.fromEntries(Object.entries(PATHS).map(([k, p]) => [k, readFileSync(p, 'utf8')]))

// ── 격리 — import 전에 HOME · drafts 를 임시로 고정한다 (운영 장부 경로가 계산되기 전) ──
const TMPS = []
const tmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), `dssc-${prefix}-`)); TMPS.push(d); return d }
process.env.HOME = tmp('home')
process.env.SORAN_MAGAZINE_TEST_MODE = '1'
process.env.SORAN_MAGAZINE_DRAFTS_DIR = tmp('drafts-env')
const MUTANTS = []
process.on('exit', () => {
  for (const f of MUTANTS) { try { unlinkSync(f) } catch { /* 이미 지웠다 */ } }
  for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } }
})

const imp = (p) => import(pathToFileURL(p).href)
const real = {
  plan: await imp(PATHS.plan),
  brief: await imp(PATHS.brief),
  flow: await imp(PATHS.flow),
  source: await imp(PATHS.source),
  lane: await imp(PATHS.lane),
  notify: await imp(PATHS.notify),
  webui: await imp(PATHS.webui),
}
const { compileArticleSpec } = await imp(join(ROOT, 'scripts/lib/magazine-article-spec.mjs'))
const realGate = await imp(PATHS.gate)
const { deliveryGate } = realGate
const { directSpecRegenPacket } = await imp(join(ROOT, 'scripts/lib/magazine-direct-spec.mjs'))
const { readRunTargets, fetchTargets } = await imp(join(ROOT, 'scripts/lib/magazine-run-targets.mjs'))

// ── 입력 ─────────────────────────────────────────────────────
/** 🔴 지금 판을 고정하지 않는다 — 제품 current.ts 에서 읽는다 */
const GV = real.source.readProductGraphVersion(join(ROOT, 'src/content/magazine/graph/current.ts'))
const STALE_GV = 'g-20000101-000000'
const MANIFEST = 'sha256:dssc-g8-manifest-0001'
const TODAY = '2026-10-16'
const TOMORROW = '2026-10-17'
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
const removeSource = (draftsDir) => rmSync(real.source.directSpecSourcePath(draftsDir, GV), { force: true })
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
const INVENTORY = () => ({ inventoryDays: 0, counts: { live: 0, scheduled: 0, blocked: 0 } })
const specPathOf = (draftsDir) => join(draftsDir, DIRECT_SLUG, 'article-spec.json')

/** planRun 한 벌. `draftsDir` 를 주면 그 폴더에서 이어 돈다 (다음 회차) */
function runPlan(planMod, { queue, prepare = () => {}, sourceMod = real.source, spyJudge = false, draftsDir = null, today = TODAY, persistSpecFn = null } = {}) {
  const base = draftsDir ? dirname(draftsDir) : tmp('plan')
  const dd = draftsDir ?? join(base, 'drafts')
  const runsDir = join(dd, '_runs')
  mkdirSync(runsDir, { recursive: true })
  prepare(dd)
  const calls = { judge: 0, graph: 0 }
  const out = planMod.planRun({
    today, now: NOW, runsDir, draftsDir: dd,
    loadArticlesFn: () => [], loadQueueFn: () => structuredClone(queue),
    inventoryFn: INVENTORY, quarantinePath: join(base, 'quarantine.json'),
    heroExists: () => false, log: () => {},
    ...(persistSpecFn ? { persistSpecFn } : {}),
    ...(spyJudge ? {
      productGraphVersionFn: () => { calls.graph++; return GV },
      directSourceFn: (a) => { calls.judge++; return sourceMod.verifyDirectSpecIdentity(a) },
    } : {}),
  })
  const runFile = join(runsDir, today, 'run.json')
  const run = existsSync(runFile) ? JSON.parse(readFileSync(runFile, 'utf8')) : null
  const selDir = join(runsDir, today, 'selected')
  return {
    out, run, draftsDir: dd, runsDir, calls, runFile, today,
    spec: existsSync(specPathOf(dd)) ? readFileSync(specPathOf(dd), 'utf8') : null,
    packages: existsSync(selDir) ? readdirSync(selDir).sort() : [],
    selected: (run?.selected ?? []).map((s) => s.slug),
    reusable: (run?.reusable ?? []).map((s) => s.slug),
    held: run?.held ?? [],
  }
}
const heldOf = (r, slug = DIRECT_SLUG) => r.held.find((h) => h.slug === slug)
/** run.json 이 정하는 회수(provider) 대상 수 — webui `--fetch-run` 과 같은 계약 */
const providerTargets = (r) => fetchTargets(readRunTargets({ draftsDir: r.draftsDir, date: r.today }).targets).filter((t) => t.slug === DIRECT_SLUG).length
/** 등록 gate 통과 수 — 운영 등록은 run.json 이 아니라 큐 전체를 이 gate 로 거른다 */
const registerPass = (laneMod, draftsDir, queue = [directItem()]) => (laneMod.gate(DIRECT_SLUG, queue, draftsDir).ok ? 1 : 0)

function assertNothingForDirect(r, label) {
  assert.equal(r.spec, null, `${label}: article-spec.json 이 생겼다`)
  assert.ok(!r.selected.includes(DIRECT_SLUG), `${label}: direct 행이 선정됐다`)
  assert.ok(!r.packages.includes(DIRECT_SLUG), `${label}: direct 행에 brief 재료가 놓였다`)
  assert.equal(providerTargets(r), 0, `${label}: direct 행이 원고 회수(provider·probe) 대상이 됐다`)
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
  const heroEntry = (hero) => sourceEntry((e) => { e.hero = hero; return e })
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
    ['H1 REQUIRED + hero.alt 없음 — FIELDS_MISSING hero.alt', () => {
      const r = judge(directItem({ imageMode: 'REQUIRED' }), (d) => writeSource(d, { entries: [heroEntry({ scene: fx().hero.scene })] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.missingFields.includes('hero.alt')); assert.ok(r.evidence.blockers.includes('FIELDS_MISSING'))
    }],
    ['H2 REQUIRED + hero.scene 없음 — FIELDS_MISSING hero.scene', () => {
      const r = judge(directItem({ imageMode: 'REQUIRED' }), (d) => writeSource(d, { entries: [heroEntry({ alt: fx().hero.alt })] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.missingFields.includes('hero.scene')); assert.ok(r.evidence.blockers.includes('FIELDS_MISSING'))
    }],
    ['H3 NO_IMAGE + hero 내용 — HERO_FORBIDDEN', () => {
      const r = judge(directItem({ imageMode: 'NO_IMAGE' }), (d) => writeSource(d))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('HERO_FORBIDDEN'))
    }],
    ['H4 NO_IMAGE + hero 없음 — 준비됨 (hero.mode NO_IMAGE)', () => {
      const r = judge(directItem({ imageMode: 'NO_IMAGE' }), (d) => writeSource(d, { entries: [heroEntry(null)] }))
      assert.equal(r.ok, true, r.why); assert.equal(r.spec.hero.mode, 'NO_IMAGE')
    }],
    ['H5 OPTIONAL + hero 없음 — ArticleSpec 계약대로 준비됨', () => {
      const r = judge(directItem({ imageMode: 'OPTIONAL' }), (d) => writeSource(d, { entries: [heroEntry(null)] }))
      assert.equal(r.ok, true, r.why); assert.equal(r.spec.hero.required, false)
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
      const p = specPathOf(d)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, '{"other":"spec"}\n')
      const r = src.persistDirectSpecNoClobber({ spec: j.spec, draftsDir: d })
      assert.equal(r.ok, false); assert.equal(r.code, 'DIRECT_SPEC_SPEC_CONFLICT')
      assert.equal(readFileSync(p, 'utf8'), '{"other":"spec"}\n')
      const v = src.verifyDirectSpecIdentity({ queueItem: directItem(), draftsDir: d, expectedGraphVersion: GV })
      assert.equal(v.ok, false); assert.equal(v.code, 'DIRECT_SPEC_SPEC_CONFLICT')
    }],
  ]
}

function goldenCase(plan) {
  return ['S10 legacy golden — 부모 47b8314e 기준과 run.json · brief/review 재료 · report.md · 메시지 · 지문 동일', () => {
    const input = JSON.parse(readFileSync(join(GOLDEN_DIR, 'input.json'), 'utf8'))
    const expected = JSON.parse(readFileSync(join(GOLDEN_DIR, 'expected.json'), 'utf8'))
    const base = tmp('golden'); const draftsDir = join(base, 'drafts'); const runsDir = join(draftsDir, '_runs')
    mkdirSync(runsDir, { recursive: true })
    plan.planRun({ today: input.today, now: Date.parse(input.now), runsDir, draftsDir,
      loadArticlesFn: () => [], loadQueueFn: () => structuredClone(input.queue), inventoryFn: INVENTORY,
      quarantinePath: join(base, 'q.json'), heroExists: () => false, log: () => {} })
    const run = JSON.parse(readFileSync(join(runsDir, input.today, 'run.json'), 'utf8'))
    delete run.startedAt; delete run.finishedAt
    assert.deepEqual(run, expected.run, 'legacy run.json 이 부모 기준과 다르다')
    const sel = join(runsDir, input.today, 'selected')
    assert.deepEqual(readdirSync(sel).sort(), Object.keys(expected.packages).sort())
    for (const [slug, files] of Object.entries(expected.packages)) {
      for (const [f, bytes] of Object.entries(files)) assert.equal(readFileSync(join(sel, slug, f), 'utf8'), bytes, `${slug}/${f} 바이트가 부모 기준과 다르다`)
    }
    assert.equal(readFileSync(join(runsDir, input.today, 'report.md'), 'utf8'), expected.reportMd, 'legacy report.md 바이트가 부모 기준과 다르다')
    for (const row of run.selected) {
      mkdirSync(join(draftsDir, row.slug), { recursive: true })
      writeFileSync(join(draftsDir, row.slug, 'brief.md'), input.briefMd)
      const g = deliveryGate({ slug: row.slug, draftsDir, quarantinePath: join(base, 'q.json'), queueItem: row })
      assert.ok(g.message && g.messageFingerprint?.startsWith('sha256:'), `${row.slug}: legacy 메시지가 비었다`)
      assert.equal(g.message, expected.messages[row.slug].message, `${row.slug}: legacy 메시지가 부모 기준과 다르다`)
      assert.equal(g.messageFingerprint, expected.messages[row.slug].messageFingerprint)
    }
  }]
}

function planCases(plan, lane = real.lane) {
  return [
    goldenCase(plan),
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
      const t = fetchTargets(readRunTargets({ draftsDir: r.draftsDir, date: TODAY }).targets).find((x) => x.slug === DIRECT_SLUG)
      assert.ok(t, 'direct 행이 원고 회수 대상이 아니다')
      const g = deliveryGate({ slug: DIRECT_SLUG, draftsDir: r.draftsDir, quarantinePath: join(r.draftsDir, 'q.json'), queueItem: t.queueItem,
        directSourceDeps: { queue: () => [directItem()], expectedGraphVersion: () => GV } })
      assert.equal(g.ok, true, g.why); assert.equal(g.specHash, expected.specHash)
      assert.equal(existsSync(join(r.draftsDir, DIRECT_SLUG, 'brief.md')), false)
    }],
    ['S01b dry-run — 판정은 하되 spec write 0', () => {
      const base = tmp('dry'); const draftsDir = join(base, 'drafts'); writeSource(draftsDir)
      const out = plan.planRun({ today: TODAY, now: NOW, dryRun: true, runsDir: join(draftsDir, '_runs'), draftsDir,
        loadArticlesFn: () => [], loadQueueFn: () => [directItem()], log: () => {}, inventoryFn: INVENTORY,
        quarantinePath: join(base, 'q.json'), heroExists: () => false })
      assert.equal(out.run.selected[0]?.directSpec?.written, false)
      assert.equal(existsSync(join(draftsDir, DIRECT_SLUG)), false)
    }],
    ['S02p stale graphVersion → 선정·spec·패키지·회수 0', () => {
      const r = runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d, { graphVersion: STALE_GV, entries: [sourceEntry((e) => { e.node.graphVersion = STALE_GV; return e })] }) })
      const h = assertNothingForDirect(r, 'stale')
      assert.equal(h.code, 'DIRECT_SPEC_SOURCE_NOT_READY'); assert.equal(h.directSpec.observedGraphVersion, STALE_GV)
    }],
    ['S02q source 없음 → fail-closed · 전 필드 missing · sourcePath 는 현재 판', () => {
      const r = runPlan(plan, { queue: [directItem()] })
      const h = assertNothingForDirect(r, 'absent')
      assert.deepEqual(h.directSpec.blockers, ['SOURCE_ABSENT'])
      assert.equal(h.directSpec.expectedGraphVersion, GV); assert.equal(h.directSpec.observedGraphVersion, null)
      assert.equal(h.directSpec.missingFields.length, real.source.DIRECT_SPEC_REQUIRED_FIELDS.length)
      assert.ok(h.directSpec.sourcePath.endsWith(`article-spec-source/${GV}.json`))
    }],
    ...real.source.DIRECT_SPEC_REQUIRED_FIELDS.map((field) => [`S03p 필드 누락 ${field} → 선정·spec·패키지·회수 0`, () => {
      const r = runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d, { entries: [sourceEntry(missingMutation(field))] }) })
      assert.ok(assertNothingForDirect(r, field).directSpec.missingFields.includes(field))
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
    ['S08 mixed — direct 는 spec·패키지 0, legacy 는 패키지 1 · legacy 바이트·지문 = legacy-only 회차', () => {
      const mixed = runPlan(plan, { queue: [directItem(), legacyItem()], prepare: (d) => writeSource(d) })
      const only = runPlan(plan, { queue: [legacyItem()] })
      assert.deepEqual(mixed.selected.sort(), [DIRECT_SLUG, LEGACY_SLUG].sort())
      assert.ok(mixed.spec)
      assert.deepEqual(mixed.packages, [LEGACY_SLUG])
      const todo = (r, f) => readFileSync(join(r.runsDir, TODAY, 'selected', LEGACY_SLUG, f), 'utf8')
      assert.equal(todo(mixed, 'brief.todo.md'), todo(only, 'brief.todo.md'))
      assert.equal(todo(mixed, 'review.todo.md'), todo(only, 'review.todo.md'))
      const lrow = (r) => r.run.selected.find((s) => s.slug === LEGACY_SLUG)
      assert.deepEqual(lrow(mixed), lrow(only))
      for (const r of [mixed, only]) {
        mkdirSync(join(r.draftsDir, LEGACY_SLUG), { recursive: true })
        writeFileSync(join(r.draftsDir, LEGACY_SLUG, 'brief.md'), plan.briefTodo(legacyItem()))
      }
      const t = readRunTargets({ draftsDir: mixed.draftsDir, date: TODAY }).targets.find((x) => x.slug === LEGACY_SLUG)
      const q = join(tmp('lq'), 'q.json')
      const withRow = deliveryGate({ slug: LEGACY_SLUG, draftsDir: mixed.draftsDir, quarantinePath: q, queueItem: t.queueItem })
      const bare = deliveryGate({ slug: LEGACY_SLUG, draftsDir: only.draftsDir, quarantinePath: q })
      assert.ok(withRow.message && withRow.messageFingerprint, 'legacy 메시지가 비어 비교가 무의미하다')
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
    ['S10b legacy-only — 판정 함수·제품 graph 읽기 0', () => {
      const r = runPlan(plan, { queue: [legacyItem()], spyJudge: true })
      assert.deepEqual(r.calls, { judge: 0, graph: 0 }); assert.deepEqual(r.held, [])
      assert.ok(!('directSpec' in r.run.selected[0]))
    }],
    ...reuseCases(plan, lane),
  ]
}

/**
 * P0 — 재사용 direct. 1일차에 spec 을 저장한 직후 run.json 전에 죽었다고 두고, 2일차 회차를 본다.
 * 셋 다 센다: provider(run.json 회수 대상) · write(spec 바이트 변화) · register(등록 gate 통과).
 */
function crashedDay1() {
  const base = tmp('crash'); const draftsDir = join(base, 'drafts')
  writeSource(draftsDir)
  assert.throws(() => runPlan(real.plan, { queue: [directItem()], draftsDir, persistSpecFn: (a) => {
    const p = real.source.persistDirectSpecNoClobber(a)
    throw Object.assign(new Error('spec 저장 직후 급사'), { persisted: p })
  } }), /급사/)
  assert.ok(existsSync(specPathOf(draftsDir)), '급사 반례 준비 실패 — spec 이 저장되지 않았다')
  assert.equal(existsSync(join(draftsDir, '_runs', TODAY, 'run.json')), false, '급사 반례 준비 실패 — run.json 이 남았다')
  return draftsDir
}
const COUNTS = {}
function reuseCases(plan, lane) {
  const day2 = (draftsDir, label, prepare = () => {}) => {
    prepare(draftsDir)
    const before = readFileSync(specPathOf(draftsDir), 'utf8')
    const mtime = statSync(specPathOf(draftsDir)).mtimeMs
    const r = runPlan(plan, { queue: [directItem()], draftsDir, today: TOMORROW })
    const after = existsSync(specPathOf(draftsDir)) ? readFileSync(specPathOf(draftsDir), 'utf8') : null
    const counts = { provider: providerTargets(r), write: (after !== before || statSync(specPathOf(draftsDir)).mtimeMs !== mtime) ? 1 : 0, register: registerPass(lane, draftsDir) }
    COUNTS[label] = counts
    return { r, counts, before, after }
  }
  const blocked = (label, prepare, code) => [`R ${label} → 재사용 HOLD · provider·write·register 0`, () => {
    const d = crashedDay1()
    const { r, counts, before, after } = day2(d, label, prepare)
    assert.ok(!r.reusable.includes(DIRECT_SLUG), `${label}: direct 가 재사용 목록에 남았다`)
    assert.equal(heldOf(r)?.code, code, `${label}: HOLD 코드`)
    assert.deepEqual(counts, { provider: 0, write: 0, register: 0 }, `${label}: ${JSON.stringify(counts)}`)
    assert.equal(after, before)
  }]
  return [
    blocked('급사 후 source 부재', (d) => removeSource(d), 'DIRECT_SPEC_SOURCE_NOT_READY'),
    blocked('급사 후 source 교체(다른 승인 내용)', (d) => writeSource(d, { entries: [sourceEntry((e) => { e.node.readerQuestion = `${e.node.readerQuestion} 다시 승인`; return e })] }), 'DIRECT_SPEC_SPEC_CONFLICT'),
    blocked('급사 후 승인 취소', (d) => writeSource(d, { entries: [sourceEntry((e) => { e.status = 'REVOKED'; return e })] }), 'DIRECT_SPEC_SOURCE_NOT_READY'),
    blocked('급사 후 stale 판', (d) => writeSource(d, { graphVersion: STALE_GV, entries: [sourceEntry((e) => { e.node.graphVersion = STALE_GV; return e })] }), 'DIRECT_SPEC_SOURCE_NOT_READY'),
    blocked('급사 후 hash drift', (d) => { const e = sourceEntry(); e.node.outline = [...e.node.outline].reverse(); writeSource(d, { entries: [e] }) }, 'DIRECT_SPEC_SOURCE_NOT_READY'),
    ['R 급사 후 같은 source → 멱등 재사용 · write 0 · provider 1 · register 1', () => {
      const d = crashedDay1()
      const { r, counts } = day2(d, '급사 후 같은 source')
      assert.ok(r.reusable.includes(DIRECT_SLUG), '같은 source 인데 재사용되지 않았다')
      const row = r.run.reusable.find((x) => x.slug === DIRECT_SLUG)
      assert.equal(row.directSpec?.written, false); assert.equal(row.directSpec?.specHash, JSON.parse(readFileSync(specPathOf(d), 'utf8')).specHash)
      assert.deepEqual(counts, { provider: 1, write: 0, register: 1 })
    }],
    ...[['legacy 원고·변환물이 든', { 'draft.md': '---\ntitle: 예전 legacy 원고\n---\n\n본문\n', 'article-draft.ts': 'export const article = { legacy: true }\n' }],
      ['빈', {}]].map(([label, files]) => [`R 재사용 ${label} 폴더 · spec 없음 + exact source → DIRECT_SPEC_MISSING HOLD · 바이트 보존 · provider·write·register 0`, () => {
      const base = tmp('nospec'); const d = join(base, 'drafts'); writeSource(d)
      const dir = join(d, DIRECT_SLUG)
      mkdirSync(dir, { recursive: true })
      for (const [f, b] of Object.entries(files)) writeFileSync(join(dir, f), b)
      const r = runPlan(plan, { queue: [directItem()], draftsDir: d, today: TOMORROW })
      assert.equal(r.spec, null, 'spec 없는 재사용 폴더에 새 spec 을 썼다 — direct 승격')
      assert.ok(!r.reusable.includes(DIRECT_SLUG), '재사용 목록에 남았다')
      assert.equal(heldOf(r)?.code, 'DIRECT_SPEC_MISSING')
      assert.deepEqual(readdirSync(dir).sort(), Object.keys(files).sort(), '폴더에 새 파일이 생겼다')
      for (const [f, b] of Object.entries(files)) assert.equal(readFileSync(join(dir, f), 'utf8'), b)
      const counts = { provider: providerTargets(r), write: r.spec ? 1 : 0, register: registerPass(lane, d) }
      COUNTS[`재사용 ${label} 폴더 · spec 없음`] = counts
      assert.deepEqual(counts, { provider: 0, write: 0, register: 0 })
    }]),
    ['R selected 경로 수치 — 준비됨 provider 1 · write 1 · 등록 gate 1 / 부재 0·0·0', () => {
      const ok = runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d) })
      const no = runPlan(plan, { queue: [directItem()] })
      COUNTS['selected 준비됨'] = { provider: providerTargets(ok), write: ok.spec ? 1 : 0, register: registerPass(lane, ok.draftsDir) }
      COUNTS['selected source 부재'] = { provider: providerTargets(no), write: no.spec ? 1 : 0, register: registerPass(lane, no.draftsDir) }
      assert.deepEqual(COUNTS['selected 준비됨'].provider, 1); assert.equal(COUNTS['selected 준비됨'].write, 1)
      assert.deepEqual(COUNTS['selected source 부재'], { provider: 0, write: 0, register: 0 })
    }],
  ]
}

/**
 * P0 — 실제 전송 경계. plan 이 spec 을 저장한 뒤 source 를 바꾸고, 실제 `fetchSlug` · `fetchBatch` · regen 판정을 부른다.
 * probe(accessFn·probeFn) · Chrome(browserDeps.connect) · 예약(장부 바이트) · write(draft.md) 를 센다.
 * 🔴 exact source 도 실제 provider 는 부르지 않는다 — probe 가 실패를 돌려 그 앞에서 멈춘다(경계 도달 = probe 1).
 */
const SEND = {}
const SOURCE_STATES = [
  ['exact', null, null],
  ['부재', (d) => removeSource(d), 'DIRECT_SPEC_SOURCE_NOT_READY'],
  ['승인 취소', (d) => writeSource(d, { entries: [sourceEntry((e) => { e.status = 'REVOKED'; return e })] }), 'DIRECT_SPEC_SOURCE_NOT_READY'],
  ['stale', (d) => writeSource(d, { graphVersion: STALE_GV, entries: [sourceEntry((e) => { e.node.graphVersion = STALE_GV; return e })] }), 'DIRECT_SPEC_SOURCE_NOT_READY'],
  ['hash drift', (d) => { const e = sourceEntry(); e.node.outline = [...e.node.outline].reverse(); writeSource(d, { entries: [e] }) }, 'DIRECT_SPEC_SOURCE_NOT_READY'],
  ['다른 승인 내용', (d) => writeSource(d, { entries: [sourceEntry((e) => { e.node.readerQuestion = `${e.node.readerQuestion} 재승인`; return e })] }), 'DIRECT_SPEC_SPEC_CONFLICT'],
]
function sendCases(webui, gateMod = realGate, { record = false } = {}) {
  const planned = () => {
    const r = runPlan(real.plan, { queue: [directItem()], prepare: (d) => writeSource(d) })
    assert.ok(r.spec, 'plan 이 spec 을 쓰지 못했다 (반례 준비 실패)')
    return r
  }
  const deps = { queue: () => [directItem()], expectedGraphVersion: () => GV }
  const meter = (draftsDir, q) => {
    const m = { probe: 0, chrome: 0 }
    const ledgerBefore = existsSync(q) ? readFileSync(q, 'utf8') : null
    return {
      m,
      accessFn: async () => { m.probe++; return { status: 'DSSC_FAKE_PROBE_STOP' } },
      probeFn: async () => { m.probe++; return { status: 'DSSC_FAKE_PROBE_STOP' } },
      browserDeps: { connect: async () => { m.chrome++; throw new Error('Chrome 금지') }, ensureTab: async () => { m.chrome++; throw new Error('Chrome 금지') } },
      done: () => ({ probe: m.probe, chrome: m.chrome,
        reservation: (existsSync(q) ? readFileSync(q, 'utf8') : null) !== ledgerBefore ? 1 : 0,
        write: existsSync(join(draftsDir, DIRECT_SLUG, 'draft.md')) ? 1 : 0 }),
    }
  }
  return SOURCE_STATES.flatMap(([label, mutate, code]) => [
    [`P0 실제 fetchSlug(수동 --fetch 경로) — source ${label} → ${code ? `${code} · probe·Chrome·예약·write 0` : '관문 통과 · probe 1'}`, async () => {
      const r = planned(); mutate?.(r.draftsDir)
      const q = join(dirname(r.draftsDir), 'send-q.json')
      const row = r.run.selected.find((x) => x.slug === DIRECT_SLUG)
      const t = meter(r.draftsDir, q)
      const out = await webui.fetchSlug(DIRECT_SLUG, { quarantinePath: q, draftsDir: r.draftsDir, queueItem: row, quiet: true,
        dateHint: TODAY, accessFn: t.accessFn, browserDeps: t.browserDeps, directSourceDeps: deps })
      const c = t.done()
      if (record) SEND[`fetchSlug · ${label}`] = c
      if (code) {
        assert.equal(out.reason, code, `${label}: ${JSON.stringify(out).slice(0, 160)}`)
        assert.deepEqual(c, { probe: 0, chrome: 0, reservation: 0, write: 0 }, `${label}: ${JSON.stringify(c)}`)
      } else {
        assert.equal(c.probe, 1, `exact source 인데 전송 경계(probe)에 도달하지 못했다: ${JSON.stringify(out).slice(0, 160)}`)
        assert.deepEqual({ chrome: c.chrome, reservation: c.reservation, write: c.write }, { chrome: 0, reservation: 0, write: 0 })
      }
    }],
    [`P0 실제 fetchBatch(--fetch-run 경로) — source ${label} → ${code ? 'probe 0' : 'probe 1'}`, async () => {
      const r = planned(); mutate?.(r.draftsDir)
      const q = join(dirname(r.draftsDir), 'batch-q.json')
      const t = meter(r.draftsDir, q)
      const log = console.log
      console.log = () => {}
      try {
        await webui.fetchBatch({ date: TODAY, dryRun: false, draftsDir: r.draftsDir, quarantinePath: q,
          probeFn: t.probeFn, directSourceDeps: deps, resultPath: join(dirname(r.draftsDir), 'batch-result.json') })
      } finally { console.log = log }
      const c = t.done()
      if (record) SEND[`fetchBatch · ${label}`] = c
      assert.equal(c.probe, code ? 0 : 1, `${label}: ${JSON.stringify(c)}`)
      assert.deepEqual({ chrome: c.chrome, reservation: c.reservation, write: c.write }, { chrome: 0, reservation: 0, write: 0 })
    }],
    [`P0 direct regen 판정(deliveryGate+packet) — source ${label} → ${code ?? 'ok'}`, () => {
      const r = planned(); mutate?.(r.draftsDir)
      writeFileSync(join(r.draftsDir, DIRECT_SLUG, 'draft.md'), '---\ntitle: t\n---\n\n## 본문\n\n[CTA] /community/free | t | t\n')
      const spec = JSON.parse(r.spec)
      const dp = directSpecRegenPacket({ spec, failures: [{ code: 'X', label: 't', sentence: '' }] })
      const packet = { schemaVersion: 'regen-packet/3', slug: DIRECT_SLUG, profile: 'STANDARD', attempt: 1,
        failures: [{ code: 'X', label: 't', sentence: '' }], instruction: dp.instruction, specHash: dp.specHash, articleSpecSchemaVersion: dp.schemaVersion }
      const g = gateMod.deliveryGate({ slug: DIRECT_SLUG, draftsDir: r.draftsDir, quarantinePath: join(dirname(r.draftsDir), 'regen-q.json'),
        queueItem: directItem(), packet, directSourceDeps: deps })
      if (code) { assert.equal(g.ok, false); assert.equal(g.code, code); assert.equal(g.message, null) }
      else { assert.equal(g.ok, true, g.why); assert.equal(g.specHash, spec.specHash) }
    }],
  ])
}

function reportCases(plan) {
  const reportOf = (r) => readFileSync(join(r.runsDir, r.today, 'report.md'), 'utf8')
  const next = (md) => md.slice(md.indexOf('## 다음'))
  return [
    ['P2 report direct-only — brief.todo·brief.md 안내 0 · article-spec 기반 다음 행동', () => {
      const md = next(reportOf(runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d) })))
      assert.ok(!/brief\.todo|brief\.md|TODO/.test(md), `direct-only 보고에 brief 안내가 있다:\n${md}`)
      assert.ok(md.includes('article-spec.json') && md.includes(DIRECT_SLUG))
    }],
    ['P2 report mixed — brief 안내는 legacy slug 에만 · direct 에는 적용하지 않는다고 명시', () => {
      const md = next(reportOf(runPlan(plan, { queue: [directItem(), legacyItem()], prepare: (d) => writeSource(d) })))
      assert.ok(md.includes(`legacy 선정 1건(${LEGACY_SLUG})에만 해당`), `범위 없는 brief 안내:\n${md}`)
      assert.ok(md.includes('DIRECT_SPEC 행에는 적용하지 않는다'))
      assert.ok(!md.includes('selected/*/brief.todo.md'), 'mixed 보고에 범위 없는 일반 안내가 남았다')
    }],
  ]
}

function laneCases(lane) {
  return [
    ['R 등록 gate — 큐 전체 경로에서도 source 부재·다른 spec 은 차단, 같은 spec 만 통과', () => {
      const d = crashedDay1()
      assert.equal(registerPass(lane, d), 1, '같은 source·같은 spec 인데 등록 gate 가 막았다')
      removeSource(d)
      const g = lane.gate(DIRECT_SLUG, [directItem()], d)
      assert.equal(g.ok, false); assert.ok(g.blockedBy.some((b) => b.code === 'DIRECT_SPEC_SOURCE_NOT_READY'))
      writeSource(d, { entries: [sourceEntry((e) => { e.node.whyNow = 'x'; e.node.readerQuestion = `${e.node.readerQuestion}!`; return e })] })
      const c = lane.gate(DIRECT_SLUG, [directItem()], d)
      assert.equal(c.ok, false); assert.ok(c.blockedBy.some((b) => b.code === 'DIRECT_SPEC_SPEC_CONFLICT'))
      // legacy 판정은 그대로 — brief·review 없음
      const lg = lane.gate(LEGACY_SLUG, [legacyItem()], d)
      assert.deepEqual(lg.blockedBy.map((b) => b.code), ['BRIEF_MISSING', 'REVIEW_MISSING'])
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

function notifyCases(notify, webui) {
  const baseRun = (over = {}) => ({ status: 'COMPLETED', inventoryDays: 10, selected: [], skipped: [], reusable: [], held: [], ...over })
  const notReady = (slug) => ({ day: 1, slug, code: 'DIRECT_SPEC_SOURCE_NOT_READY', why: 'x',
    directSpec: { blockers: ['SOURCE_ABSENT'], expectedGraphVersion: GV, observedGraphVersion: null, missingFields: ['node.id'], sourcePath: `drafts/magazine/article-spec-source/${GV}.json` } })
  return [
    ['N1 direct 보류 3건(코드 3종) → 알림 정확히 1건 · legacy 알림은 보류 없는 회차와 동일', () => {
      const d = tmp('notify')
      const legacyRows = [{ slug: 'legacy-a' }]
      const withHeld = notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ selected: legacyRows, held: [
        notReady('direct-a'), { day: 2, slug: 'direct-b', code: 'UNKNOWN_MAGAZINE_AUTO_MODE', why: 'y' },
        { day: 3, slug: 'direct-c', code: 'DIRECT_SPEC_SPEC_CONFLICT', why: 'z' }, { day: 4, slug: 'legacy-held', code: 'DELIVERY_UNCERTAIN_HOLD', why: 'w' }] }) })
      const without = notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ selected: legacyRows }) })
      const directAlerts = withHeld.filter((a) => a.title.includes('DIRECT_SPEC 보류'))
      assert.equal(directAlerts.length, 1, '보류 알림이 정확히 1건이 아니다')
      assert.match(directAlerts[0].title, /보류 3건/)
      assert.ok(directAlerts[0].reason.includes(GV) && directAlerts[0].reason.includes('SOURCE_ABSENT'))
      assert.ok(!directAlerts[0].reason.includes('legacy-held'))
      assert.deepEqual(withHeld.filter((a) => !a.title.includes('DIRECT_SPEC 보류')), without)
    }],
    ['N2 direct 원고 없음 → DIRECT_SPEC 원고 알림 · "brief 가 아직 없다" 오보 0 · legacy 문구 그대로', () => {
      const d = tmp('notify2')
      mkdirSync(join(d, DIRECT_SLUG), { recursive: true }); writeFileSync(join(d, DIRECT_SLUG, 'article-spec.json'), '{}')
      const a = notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ selected: [{ slug: DIRECT_SLUG, directSpecMode: 'DIRECT_SPEC_V1', directSpec: { specHash: 'sha256:x' } }] }) })
      assert.ok(!a.some((x) => x.title.includes('brief')), `direct 행을 brief 누락으로 오보했다: ${JSON.stringify(a)}`)
      const dx = a.find((x) => x.title === '매거진 DIRECT_SPEC 원고가 만들어지지 않았다')
      assert.ok(dx && dx.next.includes('--probe'), 'spec 이 있는 direct 회수 실패 안내가 아니다')
      const nospec = notify.judge({ date: TODAY, runExists: true, draftsDir: tmp('notify3'), run: baseRun({ selected: [{ slug: DIRECT_SLUG, directSpecMode: 'DIRECT_SPEC_V1' }] }) })
      assert.ok(nospec.find((x) => x.title.startsWith('매거진 DIRECT_SPEC 원고')).next.includes('source 관문'))
      const leg = notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ selected: [{ slug: 'legacy-a' }, { slug: DIRECT_SLUG, directSpecMode: 'DIRECT_SPEC_V1' }] }) })
      const bm = leg.find((x) => x.title === '매거진 brief 가 아직 없다')
      assert.deepEqual(bm, { severity: 'ERROR', title: '매거진 brief 가 아직 없다',
        reason: '선정 2건 중 1건에 brief.md 가 없다 — 원고 회수를 시도하지 않았다',
        next: `_runs/${TODAY}/selected/{slug}/brief.todo.md 의 TODO 를 채워 drafts/magazine/{slug}/brief.md 로 저장한다` })
      mkdirSync(join(d, 'legacy-a'), { recursive: true }); writeFileSync(join(d, 'legacy-a', 'brief.md'), 'b')
      const ff = notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ selected: [{ slug: 'legacy-a' }] }) })
      assert.deepEqual(ff, [{ severity: 'ERROR', title: '매거진 원고가 만들어지지 않았다', reason: 'brief 는 있는데 1건에 draft.md 가 없다',
        next: 'ChatGPT 접근 상태를 본다 — node scripts/magazine-webui-runner.mjs --dry-run --probe' }])
    }],
    ['N4 reusable direct 원고 없음 → DIRECT_SPEC 원고 알림 정확히 1건 · brief 알림 0 · selected 와 겹쳐도 1건', () => {
      const d = tmp('notify4')
      mkdirSync(join(d, DIRECT_SLUG), { recursive: true }); writeFileSync(join(d, DIRECT_SLUG, 'article-spec.json'), '{}')
      const row = { slug: DIRECT_SLUG, directSpecMode: 'DIRECT_SPEC_V1', directSpec: { specHash: 'sha256:x' } }
      const only = notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ selected: [], reusable: [row] }) })
      const dx = only.filter((x) => x.title === '매거진 DIRECT_SPEC 원고가 만들어지지 않았다')
      assert.equal(dx.length, 1, `reusable direct 원고 실패가 알림되지 않았다: ${JSON.stringify(only)}`)
      assert.ok(!only.some((x) => x.title.includes('brief')))
      const both = notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ selected: [row], reusable: [row] }) })
      const bx = both.filter((x) => x.title === '매거진 DIRECT_SPEC 원고가 만들어지지 않았다')
      assert.equal(bx.length, 1); assert.match(bx[0].reason, /대상 1건/)
      // legacy reusable 은 지금처럼 원고 미생성 판정에 넣지 않는다 (legacy 알림 불변)
      assert.deepEqual(notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ reusable: [{ slug: 'legacy-r' }] }) }), [])
    }],
    ['N3 회수 계획 안내 — direct 는 "세션이 채워야 한다" 오보 0 · legacy 문구 그대로', () => {
      const base = { articleDraft: false, draftMd: false, brief: false, review: false }
      assert.equal(webui.nextActionFor({ ...base, queueItem: null, material: {} }), 'brief/review 미작성 — 세션이 채워야 한다')
      const withSpec = webui.nextActionFor({ ...base, queueItem: { directSpecMode: 'DIRECT_SPEC_V1' }, material: { articleSpec: true } })
      const noSpec = webui.nextActionFor({ ...base, queueItem: { directSpecMode: 'DIRECT_SPEC_V1' }, material: { articleSpec: false } })
      assert.ok(!withSpec.includes('세션이 채워야') && withSpec.includes('article-spec.json'))
      assert.ok(!noSpec.includes('세션이 채워야') && noSpec.includes('source 관문'))
    }],
  ]
}

async function flowCases(flow, plan, brief) {
  const drive = async ({ queue, prepare }) => {
    const base = tmp('flow'); const draftsDir = join(base, 'drafts'); const runsDir = join(draftsDir, '_runs')
    mkdirSync(runsDir, { recursive: true }); prepare?.(draftsDir)
    const qBySlug = new Map(queue.map((x) => [x.slug, x]))
    const briefed = []; let briefSpawns = 0
    const res = await flow.runProducerFlow({ dryRun: false, deps: {
      log: () => {}, checkLock: () => ({ ok: true }), checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
      checkOutstanding: () => ({ ok: true, message: '없음' }),
      runPlan: () => ({ status: plan.planRun({ today: TODAY, now: NOW, runsDir, draftsDir, loadArticlesFn: () => [], loadQueueFn: () => structuredClone(queue),
        inventoryFn: INVENTORY, quarantinePath: join(base, 'q.json'), heroExists: () => false, log: () => {} }).code }),
      readSupply: () => flow.supplyFromRunJson(JSON.parse(readFileSync(join(runsDir, TODAY, 'run.json'), 'utf8'))),
      runBrief: () => {
        briefSpawns++
        const sel = join(runsDir, TODAY, 'selected')
        for (const slug of existsSync(sel) ? readdirSync(sel) : []) if (brief.legacyBriefTarget(qBySlug.get(slug) ?? null).brief) briefed.push(slug)
        return { status: 0 }
      },
      runFetch: () => ({ status: 0 }), notify: () => ({ ok: true }),
    } })
    return { res, briefed, briefSpawns, draftsDir }
  }
  const supplyFlow = async (supply) => {
    let briefSpawns = 0
    await flow.runProducerFlow({ dryRun: false, deps: {
      log: () => {}, checkLock: () => ({ ok: true }), checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
      checkOutstanding: () => ({ ok: true, message: '없음' }), runPlan: () => ({ status: 0 }), readSupply: () => supply,
      runBrief: () => { briefSpawns++; return { status: 0 } }, runFetch: () => ({ status: 0 }), notify: () => ({ ok: true }),
    } })
    return briefSpawns
  }
  return [
    ['S08c 실제 flow mixed — brief 자식 1회 · 대상은 legacy 1건뿐', async () => {
      const r = await drive({ queue: [directItem(), legacyItem()], prepare: (d) => writeSource(d) })
      assert.equal(r.briefSpawns, 1); assert.deepEqual(r.briefed, [LEGACY_SLUG]); assert.equal(r.res.code, 0)
      assert.ok(existsSync(specPathOf(r.draftsDir)))
    }],
    ['S08d 실제 flow direct-only — brief 자식 0 · spec 1', async () => {
      const r = await drive({ queue: [directItem()], prepare: (d) => writeSource(d) })
      assert.equal(r.briefSpawns, 0); assert.ok(!r.res.ran.includes('brief')); assert.equal(r.res.code, 0)
      assert.ok(existsSync(specPathOf(r.draftsDir)))
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
      for (const [supply, want] of cases) assert.equal(await supplyFlow(supply), want, JSON.stringify(supply))
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
  return failures
}
let pass = 0
let fail = 0
const report = (ok, name, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

report(/^g-\d{8}-[0-9a-f]{6}$/.test(GV ?? ''), 'S00 제품 current.ts 에서 graphVersion 을 동적으로 읽는다', String(GV))

const productImportProblems = (text) => [...text.matchAll(/^\s*import[^\n]*?['"]([^'"]+)['"]/gm)]
  .map((m) => m[1]).filter((p) => /__fixtures__|soransoran-mgraph-research|contract\/build/.test(p))
{
  const bad = Object.keys(PATHS).flatMap((k) => productImportProblems(ORIGINAL[k]).map((p) => `${k}: ${p}`))
  report(bad.length === 0, 'S11 제품 코드가 fixture · 연구 저장소를 import 하지 않는다', bad.join(', '))
}

const ALL_REAL = [
  ...sourceCases(real.source), ...planCases(real.plan), ...laneCases(real.lane), ...briefCases(real.brief),
  ...notifyCases(real.notify, real.webui), ...await flowCases(real.flow, real.plan, real.brief),
  ...sendCases(real.webui, realGate, { record: true }), ...reportCases(real.plan),
]
for (const [name, fn] of ALL_REAL) {
  try { await fn(); report(true, name) } catch (e) { report(false, name, e.message.split('\n')[0]) }
}
console.log('\n── selected / reusable 별 provider(run.json 회수 대상) · write(spec 바이트 변화) · register(등록 gate 통과 — 원고 전 실제 등록은 registerTargets 가 별도로 막는다)')
for (const [k, v] of Object.entries(COUNTS)) console.log(`  ${k.padEnd(28)} provider ${v.provider} · write ${v.write} · register ${v.register}`)
console.log('\n── 실제 전송 경계 (plan 성공 뒤 source 변경) — probe · Chrome · 예약 · write')
for (const [k, v] of Object.entries(SEND)) console.log(`  ${k.padEnd(28)} probe ${v.probe} · Chrome ${v.chrome} · 예약 ${v.reservation} · write ${v.write}`)
const realPass = pass
const realFail = fail

// ── 변이 ───────────────────────────────────────────────────
const MUTATIONS = [
  ['plan', 'MP1', 'run.json directSpec 신원 제거', '        ...(directReady.has(i.slug) ? { directSpec: directSpecRow(directReady.get(i.slug), directPersisted.get(i.slug)) } : {}),\n', ''],
  ['plan', 'MP2', 'direct 행에 legacy brief 재료를 놓는다', '        if (directReady.has(item.slug)) continue\n', ''],
  ['plan', 'MP3', 'selected direct source 판정 우회', 'if (mode.mode !== DIRECT_SPEC_MODE || ready.has(item.slug)) continue', 'continue'],
  ['plan', 'MP4', 'expected graphVersion 전달 제거', 'return directSourceFn({ queueItem, draftsDir, expectedGraphVersion, repoRoot: REPO_ROOT })', 'return directSourceFn({ queueItem, draftsDir, repoRoot: REPO_ROOT })'],
  ['plan', 'MP5', 'spec 저장 제거', 'const p = persistSpecFn({ spec: j.spec, draftsDir })', 'const p = { ok: true, written: false }'],
  ['plan', 'MP6', 'NOT_READY HOLD 기록 제거', 'const held = [...directHeld]', 'const held = []'],
  ['plan', 'MP7', '모르는 mode 를 legacy 로 묻는다', "if (!mode.ok) { drop.push({ day: item.day, slug: item.slug, code: mode.code, why: mode.why }); continue }", 'if (!mode.ok) continue'],
  ['plan', 'MP8', '재사용 direct source 관문 우회 (P0)', '      if (mode.mode === DIRECT_SPEC_MODE) {\n        const j = judgeDirect(item)', '      if (false) {\n        const j = judgeDirect(item)'],
  ['plan', 'MP9', 'legacy run.json 필드 변경 (golden)', '        needsFullReview: false,\n        packageWritten: false,', '        needsFullReview: false,\n        packageWritten: false,\n        lane: \'auto\','],
  ['plan', 'MP10', 'legacy brief.todo 문구 변경 (golden)', '## 큐에서 온 사실', '## 큐 사실'],
  ['plan', 'MP11', 'legacy review.todo 문구 변경 (golden)', '## producer 가 채운 것', '## producer 가 채운 값'],
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
  ['source', 'MS9', 'REQUIRED hero alt·scene 검사 제거', "  if (queueItem?.imageMode === 'REQUIRED') {", '  if (false) {'],
  ['source', 'MS10', 'NO_IMAGE hero 금지 검사 제거', "  if (heroForbidden(entry, queueItem)) blockers.push('HERO_FORBIDDEN')\n", ''],
  ['source', 'MS11', '기존 spec 바이트 대조 제거 (재사용 신원)', "  if (existing.state === 'CONFLICT') {", '  if (false) {'],
  ['lane', 'MA1', '등록 gate 의 source 신원 검사 제거 (P0)', 'const v = verifyDirectSpecOnDisk({ slug, queue, draftsDir, expectedGraphVersion: expectedGraphVersionFn() })', "const v = { ok: true, existing: 'IDENTICAL' }"],
  ['gate', 'MD1', '전송 경계의 source 재검증 제거 (P0)', '    if (!sendable.ok) {\n      return { ok: false, code: sendable.code', '    if (false) {\n      return { ok: false, code: sendable.code'],
  ['webui', 'MW2', 'probe 를 전송 관문 앞으로 당긴다 (P0 순서)', 'WEBUI_PROBE_FIRST', ''],
  ['webui', 'MW3', 'fetchSlug 가 source 재검증 주입을 전달하지 않는다 (call-site)', '    : deliveryGate({ slug, draftsDir, packet, quarantinePath, queueItem, directSourceDeps })', '    : deliveryGate({ slug, draftsDir, packet, quarantinePath, queueItem })'],
  ['notify', 'MN3', '원고 미생성 판정에서 reusable 제외 (P1)', '  const directMissing = [...(run.selected ?? []), ...(run.reusable ?? [])]', '  const directMissing = [...(run.selected ?? [])]'],
  ['plan', 'MP12', '재사용 spec 없음에 새 spec 저장 되살림 (P1)', "        if (j.existing !== 'IDENTICAL') {\n          held.push({ day: item.day, slug: item.slug, code: 'DIRECT_SPEC_MISSING',", "        if (j.existing === 'ABSENT' && !dryRun) persistSpecFn({ spec: j.spec, draftsDir })\n        if (j.existing === 'CONFLICT') {\n          held.push({ day: item.day, slug: item.slug, code: 'DIRECT_SPEC_MISSING',"],
  ['plan', 'MP13', 'direct-only 보고에 일반 brief 안내 되살림 (P2)', '  if (!directSel.length) {\n    L.push(', '  if (true) {\n    L.push('],
  ['plan', 'MP14', 'mixed 보고에서 brief 안내 범위 구분 제거 (P2)', "      L.push(`legacy 선정 ${legacySel.length}건(${legacySel.join(', ')})에만 해당: \\`_runs/${run.date}/selected/{slug}/brief.todo.md\\` 의 TODO 를 채운 뒤`)", "      L.push('세션에서 `_runs/' + run.date + '/selected/*/brief.todo.md` 의 TODO 를 채운 뒤')"],
  ['notify', 'MN1', 'direct 보류 알림 제거 (P1)', '  if (directHold) alerts.push(directHold)\n', ''],
  ['notify', 'MN2', 'direct 행을 legacy brief 누락으로 오보 (P1)', "    const missing = rows.filter((x) => !isDirectRow(x)).map((x) => x.slug)", '    const missing = rows.map((x) => x.slug)'],
  ['webui', 'MW1', '회수 계획이 direct 에 "세션이 채워야 한다" 안내 (P1)', "  if (t.queueItem?.directSpecMode === DIRECT_SPEC_MODE) {\n    return t.material?.articleSpec", "  if (false) {\n    return t.material?.articleSpec"],
]
const MS2_SECOND = ["  if (entry.node?.graphVersion !== expectedGraphVersion) blockers.push('GRAPH_VERSION_STALE')\n", '']

console.log('\n── 변이 — 각 변이를 위 반례 중 하나가 잡아야 한다')
for (const [kind, id, label, from, to] of MUTATIONS) {
  let src = ORIGINAL[kind]
  if (id !== 'MW2' && !src.includes(from)) { report(false, `${id} ${label}`, '변이 지점을 찾지 못했다 (하네스 결함)'); continue }
  if (id === 'MW2') {
    // probe 블록을 잘라 전송 관문(deliveryGate) 앞으로 옮긴다
    const probeBlock = src.slice(src.indexOf('  if (accessFn) {\n    const p = await accessFn()'), src.indexOf('  // 🔴 관문을 쓰기 직전에 건넨다.'))
    const anchor = '  const gate = inputRepair\n'
    if (!probeBlock.includes('accessFn()') || !src.includes(anchor)) { report(false, `${id} ${label}`, '변이 지점을 찾지 못했다 (하네스 결함)'); continue }
    src = src.replace(probeBlock, '').replace(anchor, probeBlock.replaceAll('gate.messageFingerprint', 'null') + anchor)
  } else src = src.replace(from, to)
  if (id === 'MS2') src = src.replace(MS2_SECOND[0], MS2_SECOND[1])
  const path = join(dirname(PATHS[kind]), `.dssc-${id}-${process.pid}-${PATHS[kind].split('/').pop()}`)
  MUTANTS.push(path); writeFileSync(path, src)
  let caught = false
  let why = ''
  try {
    if (id === 'MS8') {
      const bad = productImportProblems(src)
      caught = bad.length > 0; why = bad.join(',')
    } else {
      let mod = await imp(path)
      let companion = null
      if (kind === 'gate') {
        // 🔴 실제 fetchSlug 가 변이 관문을 쓰게 webui 사본의 import 를 변이 관문으로 돌린다
        companion = join(dirname(PATHS.webui), `.dssc-${id}-${process.pid}-webui.mjs`)
        MUTANTS.push(companion)
        writeFileSync(companion, ORIGINAL.webui.replaceAll("'./lib/magazine-delivery-gate.mjs'", `'./lib/${path.split('/').pop()}'`))
      }
      const webuiForGate = companion ? await imp(companion) : null
      if (companion) unlinkSync(companion)
      const cases = kind === 'gate' ? sendCases(webuiForGate, mod)
        : kind === 'plan' ? [...planCases(mod), ...reportCases(mod)]
        : kind === 'brief' ? [...briefCases(mod), ...await flowCases(real.flow, real.plan, mod)]
          : kind === 'flow' ? await flowCases(mod, real.plan, real.brief)
            : kind === 'lane' ? [...laneCases(mod), ...reuseCases(real.plan, mod)]
              : kind === 'notify' ? notifyCases(mod, real.webui)
                : kind === 'webui' ? [...notifyCases(real.notify, mod), ...sendCases(mod)]
                  : sourceCases(mod)
      const failures = await runCases(cases)
      caught = failures.length > 0; why = failures[0] ?? '모든 반례가 통과했다'
    }
  } catch (e) { caught = false; why = `변이 적재 실패 — 하네스 결함이지 검출이 아니다: ${e.message.split('\n')[0]}` } finally { try { unlinkSync(path) } catch { /* 이미 지웠다 */ } }
  report(caught, `${id} ${label} → 잡혔다`, why.slice(0, 150))
}

// 원본 바이트 불변 · 변이 잔여 0
{
  const changed = Object.entries(PATHS).filter(([k, p]) => readFileSync(p, 'utf8') !== ORIGINAL[k]).map(([k]) => k)
  const residue = ['scripts', 'scripts/lib'].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.startsWith('.dssc-')))
  report(changed.length === 0 && residue.length === 0, '변이 뒤 원본 바이트 불변 · 임시 사본 잔여 0', [...changed, ...residue].join(', '))
}

console.log(`\nDIRECT_SPEC source 관문: ${pass} pass, ${fail} fail (실제 반례 ${realPass} pass · ${realFail} fail)`)
process.exit(fail === 0 ? 0 : 1)
