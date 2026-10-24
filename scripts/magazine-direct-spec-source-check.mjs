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
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { removeCluster } from './lib/magazine-graph-control-edit.mjs'

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
  regen: join(ROOT, 'scripts/lib/magazine-regen.mjs'),
  repair: join(ROOT, 'scripts/lib/magazine-input-repair.mjs'),
  exit: join(ROOT, 'scripts/lib/magazine-producer-exit.mjs'),
  session: join(ROOT, 'scripts/lib/chatgpt-session.mjs'),
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
const realRegen = await imp(PATHS.regen)
const realRepair = await imp(PATHS.repair)
const { randomUUID } = await import('node:crypto')
const { deliveryGate } = realGate
const realDirect = await imp(join(ROOT, 'scripts/lib/magazine-direct-spec.mjs'))
const { directSpecRegenPacket } = realDirect
const { sliceLiteral } = await imp(join(ROOT, 'scripts/lib/magazine-load.mjs'))
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
/** 🔴 승인 basis — 소비 관문과 같은 helper 로 실제 제품 판에서 계산한다 */
const BASIS = real.source.productBasisFor(real.source.readProductGraphState(ROOT), { intentId: 'I-DSSC-01', queueCluster: fx().queueItem.cluster })

/**
 * 🔴 DIRECT 큐 행은 승인 entry 의 복제다 — materialize 와 같은 `queueRowFromEntry` 로 만든다 (source/2).
 *    plan 을 바꾸는 반례는 `pairWith` 로 entry 와 큐 행을 **함께** 바꾼다 — 한쪽만 바꾸면 SOURCE_QUEUE_DRIFT 다.
 */
const directItem = (over = {}, entry = sourceEntry()) => ({ ...real.source.queueRowFromEntry(entry, { day: 9001 }), ...over })
const legacyItem = () => {
  const { intentId: _i, g8ManifestHash: _g, directSpecMode: _d, ...q } = fx().queueItem
  return { ...q, day: 9002, slug: LEGACY_SLUG }
}
const ADMISSION = { g8ManifestHash: MANIFEST, receiptHash: 'dssc-receipt-hash-0001', graphVersion: GV, readinessHash: 'dssc-readiness-hash-0001' }
/** 승인 plan — fixture 큐 행의 plan 필드 (선택 필드는 있을 때만) */
const planOf = (q) => ({
  ...Object.fromEntries(real.source.ARTICLE_PLAN_REQUIRED.map((k) => [k, q[k]])),
  ...Object.fromEntries(real.source.ARTICLE_PLAN_OPTIONAL.filter((k) => q[k] !== undefined).map((k) => [k, q[k]])),
})
function sourceEntry(mutate = (e) => e, { rehash = true, plan = {} } = {}) {
  const f = fx()
  let entry = {
    status: 'APPROVED', approvedBy: 'dssc-test-approver', approvedAt: '2026-10-15T12:00:00+09:00',
    admission: { ...ADMISSION },
    plan: { ...planOf(f.queueItem), ...plan },
    node: { ...f.node, id: 'I-DSSC-01', intentId: 'I-DSSC-01', slug: DIRECT_SLUG, graphVersion: GV },
    relations: f.relations, hero: f.hero, publication: f.publication, productBasis: BASIS,
  }
  entry = mutate(structuredClone(entry)) ?? entry
  if (rehash) entry.sourceHash = real.source.directSpecSourceHash(entry)
  return entry
}
/**
 * 다른 내용으로 **다시 승인**한 entry. 재승인은 sourceHash 를 바꾸므로 큐 행도 새 articlePlanHash 로 다시
 * materialize 돼야 한다 — 큐가 옛 승인을 가리키면 ARTICLE_PLAN_HASH_DRIFT(NOT_READY), 새 승인을 가리키면
 * 디스크의 옛 spec 과 SPEC_CONFLICT 다.
 */
const reapproved = (tag = '재승인') => sourceEntry((e) => { e.node.readerQuestion = `${e.node.readerQuestion} ${tag}`; return e })
/**
 * opt-in 을 철회한 행. `keepG8` 이면 G8 해시를 남긴다 → G8_ROW_NOT_DIRECT (legacy 로 보내지 않는다).
 * 해시까지 지우면 G8 행이 아니다 → persisted direct 흔적이 정본 큐로 DIRECT_SPEC_MODE_WITHDRAWN 을 낸다.
 */
const withdrawnItem = ({ by = 'mode', keepG8 }) => {
  let q = by === 'mode' ? directItem({ directSpecMode: 'LEGACY_BRIEF_V1' }) : (({ directSpecMode: _m, ...x }) => x)(directItem())
  if (!keepG8) q = (({ g8ManifestHash: _g, articlePlanHash: _p, ...x }) => x)(q)
  return q
}
const WITHDRAWN_STATES = [
  ['opt-in 철회(LEGACY_BRIEF_V1) · G8 해시 유지', { by: 'mode', keepG8: true }, 'G8_ROW_NOT_DIRECT'],
  ['opt-in 철회(필드 제거) · G8 해시 유지', { by: 'field', keepG8: true }, 'G8_ROW_NOT_DIRECT'],
  ['opt-in 철회(LEGACY_BRIEF_V1) · G8 해시도 제거', { by: 'mode', keepG8: false }, 'DIRECT_SPEC_MODE_WITHDRAWN'],
  ['opt-in 철회(필드 제거) · G8 해시도 제거', { by: 'field', keepG8: false }, 'DIRECT_SPEC_MODE_WITHDRAWN'],
].map(([label, opt, code]) => [label, () => withdrawnItem(opt), () => [withdrawnItem(opt)], code])
/** plan · entry 를 함께 바꾼 승인 한 쌍 — 큐 행은 그 entry 의 복제다 */
const pairWith = ({ plan = {}, mutate = (e) => e } = {}) => {
  const entry = sourceEntry(mutate, { plan })
  return { entry, item: directItem({}, entry) }
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
  // 🔴 direct 계약은 2~3 — 1개면 누락이다
  if (field === 'relations.direct') e.relations.direct = e.relations.direct.slice(0, 1)
  else if (field === 'node.outline') e.node.outline = e.node.outline.slice(0, 2)
  else deleteAt(e, field)
  return e
}
const INVENTORY = () => ({ inventoryDays: 0, counts: { live: 0, scheduled: 0, blocked: 0 } })
const specPathOf = (draftsDir) => join(draftsDir, DIRECT_SLUG, 'article-spec.json')

/**
 * 🔴 **source/2 ArticlePlan 계약 반례** (2026-10-22 · PR C).
 *    G8 행 계약(G8_ROW_NOT_DIRECT) · articlePlanHash · queue 복제 필드 drift · internalLinks · legacy 불변 · source/1 거부.
 *    복제 필드 손편집은 **필드마다** 따로 본다 — drift 목록에 그 필드가 정확히 실려야 한다.
 */
const REPLICA_EDITS = {
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
  internalLinks: (q) => q.internalLinks.slice(0, 1),
  whyNow: (q) => `${q.whyNow} 덧붙임`,
  notes: (q) => `${q.notes} 덧붙임`,
  directSpecMode: () => 'DIRECT_SPEC_V1-EDIT',
}
function planContractCases(src, judge) {
  const ready = (item, entry = sourceEntry()) => judge(item, (d) => writeSource(d, { entries: [entry] }))
  const { resolveMagazineAutoMode, G8_ROW_NOT_DIRECT } = realDirect
  return [
    ['P01 source/2 승인 entry + 그 복제 큐 행 → 준비됨 · articlePlanHash = entry.sourceHash', () => {
      const entry = sourceEntry(); const item = directItem({}, entry)
      assert.equal(item.articlePlanHash, entry.sourceHash); assert.equal(item.g8ManifestHash, entry.admission.g8ManifestHash)
      const r = ready(item, entry); assert.equal(r.ok, true, r.why); assert.deepEqual(r.evidence.queueDrift, [])
    }],
    ['P02 source/1(plan·admission 없음) → SOURCE_SCHEMA_UNKNOWN', () => {
      const r = judge(directItem(), (d) => writeSource(d, { schema: 'magazine-article-spec-source/1' }))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('SOURCE_SCHEMA_UNKNOWN'))
    }],
    ['P03 G8_ROW_NOT_DIRECT — 해시 하나만 · DIRECT 아님 · intentId 만 있는 legacy 는 영향 없음', () => {
      const item = directItem()
      const { articlePlanHash: _p, ...noPlan } = item
      const { g8ManifestHash: _g, ...noManifest } = item
      for (const [label, row] of [['articlePlanHash 없음', noPlan], ['g8ManifestHash 없음', noManifest],
        ['LEGACY_BRIEF_V1', { ...item, directSpecMode: 'LEGACY_BRIEF_V1' }], ['directSpecMode 없음', (({ directSpecMode: _d, ...q }) => q)(item)]]) {
        const m = resolveMagazineAutoMode(row)
        assert.deepEqual({ ok: m.ok, code: m.code }, { ok: false, code: G8_ROW_NOT_DIRECT }, label)
      }
      // ArticleSpec 직전 관문도 같은 사유를 싣는다
      assert.ok(ready(noPlan).evidence.blockers.includes(G8_ROW_NOT_DIRECT), 'judge 가 해시 하나만 있는 행을 G8 행으로 보지 않았다')
      // 🔴 intentId 만 있는 기존 행 — 대상이 아니다 (legacy 로 그대로 간다)
      const intentOnly = { ...legacyItem(), intentId: 'I-LEGACY-ONLY' }
      assert.deepEqual(resolveMagazineAutoMode(intentOnly), resolveMagazineAutoMode(legacyItem()))
      assert.equal(resolveMagazineAutoMode(intentOnly).mode, 'LEGACY_BRIEF_V1')
      assert.equal(resolveMagazineAutoMode(item).mode, 'DIRECT_SPEC_V1')
    }],
    ['P04 articlePlanHash 위조 — 다른 승인 해시 · 임의 해시 → ARTICLE_PLAN_HASH_DRIFT', () => {
      const other = sourceEntry((e) => { e.approvedAt = '2026-10-15T12:00:01+09:00'; return e })
      for (const forged of [other.sourceHash, 'sha256:forged', 'x']) {
        const r = ready(directItem({ articlePlanHash: forged }))
        assert.equal(r.ok, false, forged); assert.ok(r.evidence.blockers.includes('ARTICLE_PLAN_HASH_DRIFT'), `${forged}: ${r.evidence.blockers}`)
        assert.ok(!r.evidence.queueDrift.includes('articlePlanHash'), 'articlePlanHash 는 전용 사유로 본다')
      }
    }],
    ...real.source.QUEUE_REPLICA_FIELDS.map((field) => [`P05 큐 복제 필드 손편집 ${field} → SOURCE_QUEUE_DRIFT [${field}]`, () => {
      const item = directItem()
      const edit = REPLICA_EDITS[field]
      assert.ok(edit, `${field} 편집 반례가 없다 — QUEUE_REPLICA_FIELDS 와 반례 표가 어긋났다`)
      const edited = { ...item, [field]: edit(item) }
      assert.notEqual(JSON.stringify(edited[field]), JSON.stringify(item[field]), `${field} 반례가 값을 바꾸지 않았다`)
      const r = ready(edited)
      assert.equal(r.ok, false, `${field} 손편집이 통과했다`)
      assert.ok(r.evidence.blockers.includes('SOURCE_QUEUE_DRIFT'), `${field}: ${r.evidence.blockers}`)
      assert.ok(r.evidence.queueDrift.includes(field), `${field}: drift 목록 ${r.evidence.queueDrift}`)
    }]),
    ['P05b 승인에 없는 선택 키를 빈 값으로 더해도 drift — 키 존재 여부까지 본다 · day 0 은 drift', () => {
      const r = ready({ ...directItem(), seriesId: '' })
      assert.ok(r.evidence.queueDrift.includes('seriesId'), r.evidence.queueDrift.join(','))
      assert.ok(ready(directItem({ day: 0 })).evidence.queueDrift.includes('day'))
      assert.deepEqual(ready(directItem({ day: 77 })).evidence.queueDrift, [], 'day 는 파생값 — 양의 정수면 값은 비교하지 않는다')
    }],
    ['P06 internalLinks — direct 순서 뒤 discovery · 중복만 제거 · 개수로 자르지 않는다', () => {
      const rel = (slug) => ({ slug, source: 'M-GRAPH', relationType: 'DIRECT_NEXT', reason: 'r' })
      const relations = { direct: ['d-1', 'd-2', 'd-3', 'd-2', 'd-4'].map(rel), discovery: { ...rel('d-1'), relationType: 'BRIDGE_DISCOVERY' } }
      assert.deepEqual(src.internalLinksOf(relations), ['d-1', 'd-2', 'd-3', 'd-4'])
      assert.deepEqual(src.internalLinksOf({ direct: [rel('a'), rel('b'), rel('c')], discovery: { ...rel('z') } }), ['a', 'b', 'c', 'z'])
      const row = src.queueRowFromEntry({ ...sourceEntry(), relations }, { day: 1 })
      assert.deepEqual(row.internalLinks, ['d-1', 'd-2', 'd-3', 'd-4'])
      // 기본 fixture — direct 3 + discovery 1 → 4개 전부 (3개로 자르면 drift)
      const item = directItem()
      assert.equal(item.internalLinks.length, 4, item.internalLinks.join(','))
      assert.ok(ready({ ...item, internalLinks: item.internalLinks.slice(0, 3) }).evidence.queueDrift.includes('internalLinks'))
      assert.ok(ready({ ...item, internalLinks: [...item.internalLinks].reverse() }).evidence.queueDrift.includes('internalLinks'))
    }],
    ['P07 승인 entry 의 admission.g8ManifestHash 와 큐 행이 다르면 MANIFEST_DRIFT (entry 쪽 변경)', () => {
      const entry = sourceEntry((e) => { e.admission.g8ManifestHash = 'sha256:dssc-other'; return e })
      const item = { ...directItem({}, entry), g8ManifestHash: MANIFEST }
      const r = ready(item, entry)
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('MANIFEST_DRIFT'), r.evidence.blockers.join(','))
    }],
  ]
}

/** planRun 한 벌. `draftsDir` 를 주면 그 폴더에서 이어 돈다 (다음 회차) */
function runPlan(planMod, { queue, prepare = () => {}, sourceMod = real.source, spyJudge = false, draftsDir = null, today = TODAY, persistSpecFn = null, directSourceFnOverride = null } = {}) {
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
    ...(directSourceFnOverride ? { directSourceFn: directSourceFnOverride } : {}),
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
/** 제품 graph 판 4파일을 임시 루트에 복사하고 mutate 로 승인 뒤 판 변경을 만든다 */
const GRAPH_FILES = ['src/content/magazine/graph/current.ts', `src/content/magazine/graph/${GV}.ts`, 'src/content/magazine/graph/control.ts', 'src/lib/magazine-graph.ts']
function basisRoot(mut = null) {
  const root = tmp('basis-root')
  for (const f of GRAPH_FILES) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), readFileSync(join(ROOT, f))) }
  if (typeof mut === 'function') mut(root)
  else if (mut) {
    const [file, from, to] = mut
    const t = readFileSync(join(root, file), 'utf8')
    assert.ok(t.includes(from), `basis 반례 준비 실패 — ${file} 에 ${from} 이 없다`)
    writeFileSync(join(root, file), t.replace(from, to))
  }
  return root
}
const CONTROL = 'src/content/magazine/graph/control.ts'
/** control.ts 의 CONTROL 객체를 같은 값의 다른 표기로 바꾼다 — 실제 파일의 다른 부분은 그대로 */
function rewriteControl(root, body) {
  const p = join(root, CONTROL)
  const t = readFileSync(p, 'utf8')
  const start = t.indexOf('{', t.indexOf('=', t.indexOf('export const CONTROL')))
  const end = t.indexOf('} as const', start)
  assert.ok(start !== -1 && end !== -1, 'control 반례 준비 실패')
  writeFileSync(p, t.slice(0, start) + body + t.slice(end))
}
const REAL_CONTROL = real.source.parseGraphControl(readFileSync(join(ROOT, CONTROL), 'utf8'))
/** 정상 TypeScript — 여러 줄 · 끝 쉼표 · 주석 */
const MULTILINE_CONTROL = (root) => rewriteControl(root, `{
  // 여러 줄 표기
  graphVersion: '${REAL_CONTROL.graphVersion}',
  enabled: ${REAL_CONTROL.enabled},
  enabledClusters: [
${REAL_CONTROL.enabledClusters.map((c) => `    '${c}',`).join('\n')}
  ],
  surfaces: {
${Object.entries(REAL_CONTROL.surfaces).map(([k, v]) => `    ${k}: ${v},`).join('\n')}
  },
  killSwitch: {
    tripped: ${REAL_CONTROL.killSwitch.tripped},
    trippedAt: null,
    trippedBy: null,
    reason: null,
  },
  /** 끝 쉼표 */
  previousGraphVersion: null,
}`)
const MALFORMED_CONTROL = (root) => rewriteControl(root, `{
  graphVersion: '${REAL_CONTROL.graphVersion}',
  enabled: true,
  enabledClusters: [ 'sleep', 'family'
  surfaces: { FOOTER_NEXT: true },
}`)
const TYPE_ERROR_CONTROL = (root) => rewriteControl(root, `{
  graphVersion: '${REAL_CONTROL.graphVersion}',
  enabled: 'true',
  enabledClusters: 'sleep,family',
  surfaces: { FOOTER_NEXT: true, FOOTER_SIBLING: true, FOOTER_BRIDGE: true },
  killSwitch: { tripped: false },
}`)
/**
 * bundle 의 GRAPH 를 바꾸고 EXPORT_HASH 를 **다시 맞춘다** — 문법·판·해시는 정상이고 구조만 틀린 판.
 */
const BUNDLE = `src/content/magazine/graph/${GV}.ts`
const rewriteBundle = (edit) => (root) => {
  const p = join(root, BUNDLE)
  const t = readFileSync(p, 'utf8')
  const start = t.indexOf('{', t.indexOf('=', t.indexOf('export const GRAPH')))
  const literal = sliceLiteral(t, start, '{', '}')
  assert.ok(literal, 'bundle 반례 준비 실패')
  const graph = JSON.parse(literal)
  edit(graph)
  const out = t.slice(0, start) + JSON.stringify(graph, null, 2) + t.slice(start + literal.length)
  const hash = createHash('sha256').update(JSON.stringify(graph)).digest('hex').slice(0, 16)
  writeFileSync(p, out.replace(/export const EXPORT_HASH = '[0-9a-f]+'/, `export const EXPORT_HASH = '${hash}'`))
}
/** 판독 불가 — 던지지 않고 PRODUCT_BASIS_UNREADABLE 로 HOLD 해야 한다 */
const BASIS_UNREADABLE = [
  ['control 파싱 불가(괄호 누락)', MALFORMED_CONTROL],
  ['control 필드 형식 오류', TYPE_ERROR_CONTROL],
  ['bundle intents:null (해시 일치)', rewriteBundle((g) => { g.intents = null })],
  ['bundle intents 누락 (해시 일치)', rewriteBundle((g) => { delete g.intents })],
  ['bundle 잘못된 intent 원소 (해시 일치)', rewriteBundle((g) => { g.intents = [...g.intents, { id: 42, cluster: ['sleep'] }] })],
]
const BASIS_DRIFTS = [
  ['graph off', [CONTROL, '  enabled: true,', '  enabled: false,']],
  ['kill switch', [CONTROL, '"tripped":false', '"tripped":true']],
  // 🔴 승인 basis 의 sourceCluster 를 실제 control 사본에서 구조적으로 끈다 — 현재 cluster 목록 문자열에 기대지 않는다
  ['cluster off', (root) => { const p = join(root, CONTROL); writeFileSync(p, removeCluster(readFileSync(p, 'utf8'), BASIS.sourceCluster)) }],
  ['surface off', [CONTROL, '"FOOTER_SIBLING":true', '"FOOTER_SIBLING":false']],
  ['resolver 계약 변경', ['src/lib/magazine-graph.ts', "  'FOOTER_BRIDGE',\n] as const\n\n/** 하단", "] as const\n\n/** 하단"]],
]

function sourceCases(src) {
  const judge = (queueItem, prepare) => {
    const d = tmp('judge')
    prepare?.(d)
    return src.judgeDirectSpecSource({ queueItem, draftsDir: d, expectedGraphVersion: GV, productRoot: ROOT })
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
    ['S12a 비STANDARD 프로필(승인 plan · 큐 행 함께) — PROFILE_NOT_STANDARD', () => {
      const p = pairWith({ plan: { validationProfile: 'MEDICAL' } })
      const r = judge(p.item, (d) => writeSource(d, { entries: [p.entry] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('PROFILE_NOT_STANDARD'))
      assert.deepEqual(r.evidence.queueDrift, [], '쌍으로 바꿨는데 drift 가 났다 — 반례가 다른 사유로 막힌다')
    }],
    ['H1 REQUIRED + hero.alt 없음 — FIELDS_MISSING hero.alt', () => {
      const p = pairWith({ plan: { imageMode: 'REQUIRED' }, mutate: (e) => { e.hero = { scene: fx().hero.scene }; return e } })
      const r = judge(p.item, (d) => writeSource(d, { entries: [p.entry] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.missingFields.includes('hero.alt')); assert.ok(r.evidence.blockers.includes('FIELDS_MISSING'))
    }],
    ['H2 REQUIRED + hero.scene 없음 — FIELDS_MISSING hero.scene', () => {
      const p = pairWith({ plan: { imageMode: 'REQUIRED' }, mutate: (e) => { e.hero = { alt: fx().hero.alt }; return e } })
      const r = judge(p.item, (d) => writeSource(d, { entries: [p.entry] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.missingFields.includes('hero.scene')); assert.ok(r.evidence.blockers.includes('FIELDS_MISSING'))
    }],
    ['H3 NO_IMAGE + hero 내용 — HERO_FORBIDDEN', () => {
      const p = pairWith({ plan: { imageMode: 'NO_IMAGE' } })
      const r = judge(p.item, (d) => writeSource(d, { entries: [p.entry] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('HERO_FORBIDDEN'))
      assert.deepEqual(r.evidence.queueDrift, [])
    }],
    ['H4 NO_IMAGE + hero 없음 — 준비됨 (hero.mode NO_IMAGE)', () => {
      const p = pairWith({ plan: { imageMode: 'NO_IMAGE' }, mutate: (e) => { e.hero = null; return e } })
      const r = judge(p.item, (d) => writeSource(d, { entries: [p.entry] }))
      assert.equal(r.ok, true, r.why); assert.equal(r.spec.hero.mode, 'NO_IMAGE')
    }],
    ['H5 OPTIONAL — hero 없음은 FIELDS_MISSING(hero.alt·scene) · 완전한 hero 는 통과', () => {
      const p = pairWith({ plan: { imageMode: 'OPTIONAL' }, mutate: (e) => { e.hero = null; return e } })
      const r = judge(p.item, (d) => writeSource(d, { entries: [p.entry] }))
      assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('FIELDS_MISSING'))
      assert.ok(r.evidence.missingFields.includes('hero.alt') && r.evidence.missingFields.includes('hero.scene'), r.evidence.missingFields.join(','))
      const pf = pairWith({ plan: { imageMode: 'OPTIONAL' } })
      const full = judge(pf.item, (d) => writeSource(d, { entries: [pf.entry] }))
      assert.equal(full.ok, true, full.why); assert.equal(full.spec.hero.mode, 'OPTIONAL')
    }],
    ...planContractCases(src, judge),
    ['B1 승인 basis — 같은 graphVersion 에서 graph off·kill switch·cluster off·surface off·resolver 계약 변경은 PRODUCT_BASIS_DRIFT · productRoot 없으면 UNVERIFIED', () => {
      const base = basisRoot()
      const ok = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: (() => { const d = tmp('b1'); writeSource(d); return d })(), expectedGraphVersion: GV, productRoot: base })
      assert.equal(ok.ok, true, ok.why)
      const realRoot = judge(directItem(), (d) => writeSource(d))
      assert.equal(realRoot.ok, true, realRoot.why)
      const d0 = tmp('b1-unverified'); writeSource(d0)
      const un = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: d0, expectedGraphVersion: GV })
      assert.equal(un.ok, false); assert.ok(un.evidence.blockers.includes('PRODUCT_BASIS_UNVERIFIED'))
      for (const [label, mut] of BASIS_DRIFTS) {
        const root = basisRoot(mut)
        const d = tmp('b1-drift'); writeSource(d)
        const r = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: d, expectedGraphVersion: GV, productRoot: root })
        assert.equal(r.ok, false, `${label}: 승인 뒤 판이 바뀌었는데 통과했다`)
        assert.ok(r.evidence.blockers.includes('PRODUCT_BASIS_DRIFT'), `${label}: ${r.evidence.blockers}`)
      }
      const missing = tmp('b1-missing'); writeSource(missing, { entries: [sourceEntry((e) => { delete e.productBasis; return e })] })
      assert.ok(src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: missing, expectedGraphVersion: GV, productRoot: ROOT }).evidence.blockers.includes('PRODUCT_BASIS_MISSING'))
    }],
    ['B2 control 표기 — 여러 줄·끝 쉼표는 한 줄 판과 같은 basis · control 파싱 불가·형식 오류 · bundle 구조 결함(해시 일치)은 던지지 않고 PRODUCT_BASIS_UNREADABLE', () => {
      const multi = basisRoot(MULTILINE_CONTROL)
      assert.notEqual(readFileSync(join(multi, CONTROL), 'utf8'), readFileSync(join(ROOT, CONTROL), 'utf8'), '여러 줄 반례 준비 실패')
      const st = src.readProductGraphState(multi)
      assert.equal(st.ok, true, st.why); assert.deepEqual(st.blockers, [])
      assert.deepEqual(src.productBasisFor(st, { intentId: 'I-DSSC-01', queueCluster: fx().queueItem.cluster }), BASIS)
      const dm = tmp('b2-multi'); writeSource(dm)
      const okMulti = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: dm, expectedGraphVersion: GV, productRoot: multi })
      assert.equal(okMulti.ok, true, okMulti.why)
      for (const [label, mut] of BASIS_UNREADABLE) {
        const root = basisRoot(mut)
        let cur
        assert.doesNotThrow(() => { cur = src.currentProductBasis(root, { intentId: 'I-DSSC-01', queueCluster: 'sleep' }) }, `${label}: currentProductBasis 가 던졌다`)
        assert.deepEqual({ ok: cur.ok, code: cur.code }, { ok: false, code: 'PRODUCT_BASIS_UNREADABLE' }, label)
        let st
        assert.doesNotThrow(() => { st = src.readProductGraphState(root) }, `${label}: readProductGraphState 가 던졌다`)
        assert.equal(st.ok, false, `${label}: 판독 실패를 ok 로 돌려줬다`)
        // 🔴 bundle 반례는 해시가 맞는 채 구조만 틀렸다 — 해시 불일치가 아니라 구조 판독 실패로 막혀야 한다
        if (label.startsWith('bundle')) assert.equal(st.code, 'GRAPH_BUNDLE_UNREADABLE', `${label}: ${st.code}`)
        const d = tmp('b2-bad'); writeSource(d)
        let r
        assert.doesNotThrow(() => { r = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: d, expectedGraphVersion: GV, productRoot: root }) }, `${label}: judge 가 던졌다`)
        assert.equal(r.ok, false); assert.ok(r.evidence.blockers.includes('PRODUCT_BASIS_UNREADABLE'), `${label}: ${r.evidence.blockers}`)
      }
    }],
    ['S06 같은 입력 → 같은 바이트 · 두 번째 write 0', () => {
      const d1 = tmp('idem1'); const d2 = tmp('idem2')
      writeSource(d1); writeSource(d2)
      const j1 = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: d1, expectedGraphVersion: GV, productRoot: ROOT })
      const j2 = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: d2, expectedGraphVersion: GV, productRoot: ROOT })
      assert.equal(j1.ok, true, j1.why); assert.equal(j1.spec.specHash, j2.spec.specHash)
      const a = src.persistDirectSpecNoClobber({ spec: j1.spec, draftsDir: d1 })
      const b = src.persistDirectSpecNoClobber({ spec: j2.spec, draftsDir: d2 })
      assert.equal(readFileSync(a.path, 'utf8'), readFileSync(b.path, 'utf8'))
      const again = src.persistDirectSpecNoClobber({ spec: j1.spec, draftsDir: d1 })
      assert.equal(again.ok, true); assert.equal(again.written, false)
    }],
    ['S07 기존 다른 spec — DIRECT_SPEC_SPEC_CONFLICT · 기존 바이트 보존', () => {
      const d = tmp('conflict'); writeSource(d)
      const j = src.judgeDirectSpecSource({ queueItem: directItem(), draftsDir: d, expectedGraphVersion: GV, productRoot: ROOT })
      assert.equal(j.ok, true, j.why)
      const p = specPathOf(d)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, '{"other":"spec"}\n')
      const r = src.persistDirectSpecNoClobber({ spec: j.spec, draftsDir: d })
      assert.equal(r.ok, false); assert.equal(r.code, 'DIRECT_SPEC_SPEC_CONFLICT')
      assert.equal(readFileSync(p, 'utf8'), '{"other":"spec"}\n')
      const v = src.verifyDirectSpecIdentity({ queueItem: directItem(), draftsDir: d, expectedGraphVersion: GV, productRoot: ROOT })
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
      // 🔴 G8 행은 두 해시를 함께 운반한다 — 하나만 실리면 하류 전송 관문이 G8_ROW_NOT_DIRECT 로 막는다
      assert.deepEqual({ g8ManifestHash: r.run.selected[0].g8ManifestHash, articlePlanHash: r.run.selected[0].articlePlanHash },
        { g8ManifestHash: MANIFEST, articlePlanHash: directItem().articlePlanHash })
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
        directSourceDeps: { queue: () => [directItem()], expectedGraphVersion: () => GV, productRoot: () => ROOT } })
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
    ['S12b 모르는 directSpecMode(G8 해시 없는 행) → 선정 0 · HOLD UNKNOWN_MAGAZINE_AUTO_MODE · legacy 는 계속', () => {
      const unknown = { ...legacyItem(), day: 9001, slug: DIRECT_SLUG, directSpecMode: 'DIRECT_SPEC_V9' }
      const r = runPlan(plan, { queue: [unknown, legacyItem()] })
      assert.deepEqual(r.selected, [LEGACY_SLUG])
      assert.equal(heldOf(r).code, 'UNKNOWN_MAGAZINE_AUTO_MODE')
    }],
    ['S12d G8 행의 모르는 mode · 해시 하나만 · legacy 철회 → 선정 0 · HOLD G8_ROW_NOT_DIRECT · legacy brief 재료 0 · legacy 는 계속', () => {
      const { articlePlanHash: _p, ...oneHash } = directItem()
      for (const [label, row] of [['모르는 mode', directItem({ directSpecMode: 'DIRECT_SPEC_V9' })], ['articlePlanHash 없음', oneHash],
        ['LEGACY_BRIEF_V1', withdrawnItem({ by: 'mode', keepG8: true })]]) {
        const r = runPlan(plan, { queue: [row, legacyItem()] })
        assert.deepEqual(r.selected, [LEGACY_SLUG], label)
        assert.equal(heldOf(r)?.code, 'G8_ROW_NOT_DIRECT', label)
        assert.equal(existsSync(join(r.runsDir, TODAY, 'selected', DIRECT_SLUG)), false, `${label}: G8 행에 legacy 작업 재료를 만들었다`)
      }
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
    ...identityCases(plan),
  ]
}

/**
 * 🔴 **큐 신원 중복 관문 (producer 공용 · 2026-10-22 PR C)**.
 *    같은 slug 또는 같은 non-empty intentId 가 큐 전체에서 2번 이상이면 그 행 전부(첫 행 포함) HOLD.
 *    selected · reusable 0 · DIRECT 판정 · spec 저장 · brief/review TODO · 회수 대상 0 · 순서 무관 · 고유 행은 계속.
 */
function identityCases(plan) {
  const L = (slug, day, extra = {}) => ({ ...legacyItem(), day, slug, ...extra })
  const run = (queue, { prepare = (d) => writeSource(d), today = TODAY } = {}) => {
    const judged = []; const persisted = []
    const r = runPlan(plan, { queue, prepare, today,
      directSourceFnOverride: (a) => { judged.push(a.queueItem.slug); return real.source.verifyDirectSpecIdentity(a) },
      persistSpecFn: (a) => { persisted.push(a.spec.identity.slug); return real.source.persistDirectSpecNoClobber(a) } })
    const targets = readRunTargets({ draftsDir: r.draftsDir, date: today }).targets.map((t) => t.slug)
    return { ...r, judged, persisted, targets }
  }
  const dupHeld = (r) => r.held.filter((h) => h.code === 'QUEUE_IDENTITY_DUPLICATE')
    .map((h) => `${h.day}:${h.slug}:${h.intentId ?? '-'}`).sort()
  /** 중복 행이 어디에도 흘러가지 않았다 — selected · reusable · 판정 · spec · TODO · 회수 */
  const noFlow = (r, slugs, label) => {
    for (const slug of slugs) {
      assert.ok(!r.selected.includes(slug), `${label}: ${slug} 선정`); assert.ok(!r.reusable.includes(slug), `${label}: ${slug} 재사용`)
      assert.ok(!r.judged.includes(slug), `${label}: ${slug} DIRECT 판정`); assert.ok(!r.persisted.includes(slug), `${label}: ${slug} spec 저장`)
      assert.ok(!r.packages.includes(slug), `${label}: ${slug} brief/review TODO`); assert.ok(!r.targets.includes(slug), `${label}: ${slug} 회수 대상`)
    }
  }
  return [
    ['Q1 같은 slug DIRECT 1 + LEGACY 1 → 둘 다 HOLD · 선정 0 · DIRECT 판정·spec·TODO·회수 0 · 고유 행은 계속 · 순서 무관', () => {
      const q = [directItem(), L(DIRECT_SLUG, 9100), legacyItem()]
      const a = run(q); const b = run([...q].reverse())
      for (const [label, r] of [['정순', a], ['역순', b]]) {
        assert.deepEqual(dupHeld(r), [`9001:${DIRECT_SLUG}:I-DSSC-01`, `9100:${DIRECT_SLUG}:-`], `${label}: ${JSON.stringify(r.held)}`)
        assert.deepEqual(r.selected, [LEGACY_SLUG], label); noFlow(r, [DIRECT_SLUG], label)
        assert.equal(r.spec, null, `${label}: spec 저장`)
      }
      assert.deepEqual(a.run.held, b.run.held, 'held 가 큐 순서에 따라 달라졌다')
      assert.deepEqual(a.run.selected, b.run.selected, '선정이 큐 순서에 따라 달라졌다')
    }],
    ['Q2 같은 slug LEGACY 2 → 둘 다 HOLD (DIRECT 조합이 아니어도)', () => {
      const r = run([L('dup-legacy', 9110), L('dup-legacy', 9111), legacyItem()])
      assert.deepEqual(dupHeld(r), ['9110:dup-legacy:-', '9111:dup-legacy:-']); assert.deepEqual(r.selected, [LEGACY_SLUG]); noFlow(r, ['dup-legacy'], 'LEGACY 2')
    }],
    ['Q3 같은 intentId · 서로 다른 slug 2개 → 둘 다 HOLD', () => {
      const r = run([L('intent-a', 9120, { intentId: 'I-DUP' }), L('intent-b', 9121, { intentId: 'I-DUP' }), legacyItem()])
      assert.deepEqual(dupHeld(r), ['9120:intent-a:I-DUP', '9121:intent-b:I-DUP']); assert.deepEqual(r.selected, [LEGACY_SLUG]); noFlow(r, ['intent-a', 'intent-b'], 'intent')
    }],
    ['Q4 slug 중복과 intent 중복이 겹치는 3행 → 관련 행 전부 HOLD · 행마다 정확히 1번(중복 보고 0)', () => {
      const r = run([L('ov-1', 9130, { intentId: 'I-OV-1' }), L('ov-1', 9131, { intentId: 'I-OV-2' }), L('ov-2', 9132, { intentId: 'I-OV-2' }), legacyItem()])
      assert.deepEqual(dupHeld(r), ['9130:ov-1:I-OV-1', '9131:ov-1:I-OV-2', '9132:ov-2:I-OV-2'])
      assert.equal(r.held.filter((h) => h.code === 'QUEUE_IDENTITY_DUPLICATE').length, 3, '같은 행을 두 번 보고했다')
      assert.deepEqual(r.selected, [LEGACY_SLUG]); noFlow(r, ['ov-1', 'ov-2'], '겹침')
    }],
    ['Q5 중복 행이 produceCount 밖 · 미래 publishWindow 여도 전부 HOLD · 앞쪽 고유 5행은 그대로 선정', () => {
      const uniq = Array.from({ length: 5 }, (_, i) => L(`uniq-${i}`, 9140 + i))
      const r = run([...uniq, L('late-dup', 9990), L('late-dup', 9991, { contentType: 'SEASONAL', publishWindow: { after: '2027-01-01', before: '2027-02-01' } })])
      assert.deepEqual(dupHeld(r), ['9990:late-dup:-', '9991:late-dup:-'])
      assert.deepEqual(r.selected.slice().sort(), uniq.map((x) => x.slug).sort()); noFlow(r, ['late-dup'], 'produceCount 밖')
    }],
    ['Q6 selected 와 reusable 로 나뉠 행(같은 intentId · 한쪽만 draft 폴더) → 둘 다 HOLD · 재사용 0', () => {
      const prepare = (d) => { writeSource(d); mkdirSync(join(d, 'split-a'), { recursive: true }) }
      const r = run([L('split-a', 9150, { intentId: 'I-SPLIT' }), L('split-b', 9151, { intentId: 'I-SPLIT' }), legacyItem()], { prepare })
      assert.deepEqual(dupHeld(r), ['9150:split-a:I-SPLIT', '9151:split-b:I-SPLIT'])
      for (const slug of ['split-a', 'split-b']) assert.deepEqual(r.held.filter((h) => h.slug === slug).map((h) => h.code), ['QUEUE_IDENTITY_DUPLICATE'], slug)
      noFlow(r, ['split-a', 'split-b'], '분할')
    }],
    ['Q7 신원 중복이 없으면 run.json held · 선정은 관문 이전과 같다 (고유 큐 결과 불변)', () => {
      const r = run([directItem(), legacyItem()])
      assert.deepEqual(dupHeld(r), []); assert.deepEqual(r.selected.slice().sort(), [DIRECT_SLUG, LEGACY_SLUG].sort())
      assert.deepEqual(r.judged, [DIRECT_SLUG]); assert.deepEqual(r.persisted, [DIRECT_SLUG])
    }],
    ['Q8 run.json held — 중복 행 전부의 day · slug · intentId · 코드 · 이유 · 순서 무관 동일', () => {
      const q = [L('dup-x', 9160, { intentId: 'I-X' }), legacyItem(), L('dup-x', 9161), L('dup-y', 9162, { intentId: 'I-X' })]
      const a = run(q).run.held.filter((h) => h.code === 'QUEUE_IDENTITY_DUPLICATE')
      const b = run([...q].reverse()).run.held.filter((h) => h.code === 'QUEUE_IDENTITY_DUPLICATE')
      assert.deepEqual(a, b, '큐 순서에 따라 held 가 달라졌다')
      assert.deepEqual(a.map((h) => [h.day, h.slug, h.intentId]), [[9160, 'dup-x', 'I-X'], [9161, 'dup-x', null], [9162, 'dup-y', 'I-X']])
      assert.ok(a.every((h) => typeof h.why === 'string' && h.why.includes('큐 신원 중복')), JSON.stringify(a))
    }],
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
  const day2 = (draftsDir, label, prepare = () => {}, queue = [directItem()]) => {
    prepare(draftsDir)
    const before = readFileSync(specPathOf(draftsDir), 'utf8')
    const mtime = statSync(specPathOf(draftsDir)).mtimeMs
    const r = runPlan(plan, { queue, draftsDir, today: TOMORROW })
    const after = existsSync(specPathOf(draftsDir)) ? readFileSync(specPathOf(draftsDir), 'utf8') : null
    const counts = { provider: providerTargets(r), write: (after !== before || statSync(specPathOf(draftsDir)).mtimeMs !== mtime) ? 1 : 0, register: registerPass(lane, draftsDir, queue) }
    COUNTS[label] = counts
    return { r, counts, before, after }
  }
  const blocked = (label, prepare, code, queue) => [`R ${label} → 재사용 HOLD · provider·write·register 0`, () => {
    const d = crashedDay1()
    const { r, counts, before, after } = day2(d, label, prepare, queue)
    assert.ok(!r.reusable.includes(DIRECT_SLUG), `${label}: direct 가 재사용 목록에 남았다`)
    assert.equal(heldOf(r)?.code, code, `${label}: HOLD 코드`)
    assert.deepEqual(counts, { provider: 0, write: 0, register: 0 }, `${label}: ${JSON.stringify(counts)}`)
    assert.equal(after, before)
  }]
  return [
    blocked('급사 후 source 부재', (d) => removeSource(d), 'DIRECT_SPEC_SOURCE_NOT_READY'),
    blocked('급사 후 source 교체(다른 승인 내용 · 큐도 새 승인으로)', (d) => writeSource(d, { entries: [reapproved('다시 승인')] }), 'DIRECT_SPEC_SPEC_CONFLICT',
      [directItem({}, reapproved('다시 승인'))]),
    blocked('급사 후 source 교체(다른 승인 내용 · 큐는 옛 승인)', (d) => writeSource(d, { entries: [reapproved('다시 승인')] }), 'DIRECT_SPEC_SOURCE_NOT_READY'),
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
  ['다른 승인 내용 · 큐도 새 승인으로', (d) => writeSource(d, { entries: [reapproved()] }), 'DIRECT_SPEC_SPEC_CONFLICT', () => [directItem({}, reapproved())]],
  ['다른 승인 내용 · 큐는 옛 승인', (d) => writeSource(d, { entries: [reapproved()] }), 'DIRECT_SPEC_SOURCE_NOT_READY'],
]
function sendCases(webui, gateMod = realGate, { record = false } = {}) {
  const planned = () => {
    const r = runPlan(real.plan, { queue: [directItem()], prepare: (d) => writeSource(d) })
    assert.ok(r.spec, 'plan 이 spec 을 쓰지 못했다 (반례 준비 실패)')
    return r
  }
  const baseDeps = { queue: () => [directItem()], expectedGraphVersion: () => GV, productRoot: () => ROOT }
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
  // 🔴 상태마다 정본 큐가 다를 수 있다 — 재승인은 큐 행도 새 articlePlanHash 로 바뀐다
  return SOURCE_STATES.flatMap(([label, mutate, code, queueFn]) => {
    const deps = { ...baseDeps, queue: queueFn ?? baseDeps.queue }
    return [
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
    ]
  })
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
      assert.ok(md.includes('DIRECT_SPEC 행(선정·재사용)에는 적용하지 않는다'))
      assert.ok(!md.includes('selected/*/brief.todo.md'), 'mixed 보고에 범위 없는 일반 안내가 남았다')
    }],
  ]
}

const NEXT_SHAPES = {}
function reuseReportCases(plan) {
  const nextOf = (md) => md.slice(md.indexOf('## 다음'))
  return [
    ['P2b report reusable-only direct — brief.todo·brief.md·TODO 0 · article-spec 회수/재사용 안내', () => {
      const d = crashedDay1()
      const r = runPlan(plan, { queue: [directItem()], draftsDir: d, today: TOMORROW })
      assert.deepEqual(r.selected, []); assert.deepEqual(r.reusable, [DIRECT_SLUG])
      const md = nextOf(readFileSync(join(r.runsDir, TOMORROW, 'report.md'), 'utf8'))
      NEXT_SHAPES['selected=[] · reusable=[direct]'] = md
      assert.ok(!/brief\.todo|brief\.md|TODO/.test(md), `reusable-only direct 보고에 brief 안내:\n${md}`)
      assert.ok(md.includes('article-spec.json') && md.includes(DIRECT_SLUG) && md.includes('재사용'))
    }],
    ['P2b report selected legacy + reusable direct — brief 안내는 legacy slug 에만 · direct 재사용에는 미적용 명시', () => {
      const d = crashedDay1()
      const r = runPlan(plan, { queue: [directItem(), legacyItem()], draftsDir: d, today: TOMORROW })
      assert.deepEqual(r.selected, [LEGACY_SLUG]); assert.deepEqual(r.reusable, [DIRECT_SLUG])
      const md = nextOf(readFileSync(join(r.runsDir, TOMORROW, 'report.md'), 'utf8'))
      NEXT_SHAPES['selected=[legacy] · reusable=[direct]'] = md
      assert.ok(md.includes(`legacy 선정 1건(${LEGACY_SLUG})에만 해당`) && md.includes('DIRECT_SPEC 행(선정·재사용)에는 적용하지 않는다'), md)
      assert.ok(md.includes(`DIRECT_SPEC 1건(${DIRECT_SLUG})`))
      assert.ok(!md.includes('selected/*/brief.todo.md'))
    }],
    ['P2b report selected·reusable 같은 direct slug → 한 번만 센다', () => {
      const row = { day: 1, slug: DIRECT_SLUG, title: 't', contentType: 'EVERGREEN', riskLevel: 'LOW', publishWindow: null,
        directSpec: { specHash: 'sha256:0123456789abcdef0123' }, packageWritten: false }
      const md = nextOf(plan.report({ date: TODAY, inventoryDays: 0, produceCount: 5, reviewCount: 1, counts: { live: 0, scheduled: 0, blocked: 0 },
        selected: [row], reusable: [{ ...row, stage: 'NEEDS_BRIEF' }], held: [], skipped: [] }))
      assert.ok(md.includes(`DIRECT_SPEC 1건(${DIRECT_SLUG})`), md)
    }],
  ]
}

/**
 * P0 — persisted direct 의 legacy 강등. plan 이 spec 을 저장했고 폴더에 brief.md 도 있다 (legacy provider 가 가능한 모양).
 * 그 뒤 큐 행이 삭제되거나 opt-in 이 철회된 상태에서 실제 `fetchOne`(수동 --fetch) · `attemptRegeneration` 을 부른다.
 */
const DOWNGRADE = {}
const DOWNGRADE_STATES = [
  ['큐 삭제', null, () => [], 'DIRECT_SPEC_NOT_IN_QUEUE'],
  ...WITHDRAWN_STATES,
  ['exact direct', () => directItem(), () => [directItem()], null],
]
function downgradeCases(webui, regen) {
  const setup = ({ brief }) => {
    const r = runPlan(real.plan, { queue: [directItem()], prepare: (d) => writeSource(d) })
    assert.ok(r.spec, '반례 준비 실패 — spec 이 없다')
    if (brief) writeFileSync(join(r.draftsDir, DIRECT_SLUG, 'brief.md'), real.plan.briefTodo(legacyItem()))
    return r
  }
  const cases = []
  for (const [label, queueItemFn, queueFn, code] of DOWNGRADE_STATES) {
    for (const brief of [true, false]) {
      cases.push([`P0 fetchOne(수동 --fetch) — ${label}${brief ? ' · brief.md 있음' : ''} → ${code ?? '관문 통과 · probe 1'}`, async () => {
        const r = setup({ brief })
        const base = dirname(r.draftsDir); const q = join(base, 'one-q.json')
        const m = { probe: 0, chrome: 0 }
        const deps = { queue: queueFn, expectedGraphVersion: () => GV, productRoot: () => ROOT }
        const log = console.log; const err = console.error
        console.log = () => {}; console.error = () => {}
        let out
        try {
          out = await webui.fetchOne(DIRECT_SLUG, { quarantinePath: q, draftsDir: r.draftsDir, queueItem: queueItemFn ? queueItemFn() : null,
            directSourceDeps: deps, resultPath: join(base, 'one-result.json'), exit: () => {},
            probeFn: async () => { m.probe++; return { status: 'DSSC_FAKE_PROBE_STOP' } },
            browserDeps: { connect: async () => { m.chrome++; throw new Error('Chrome 금지') }, ensureTab: async () => { m.chrome++; throw new Error('Chrome 금지') } } })
        } finally { console.log = log; console.error = err }
        const c = { probe: m.probe, chrome: m.chrome, reservation: existsSync(q) && readFileSync(q, 'utf8').includes(DIRECT_SLUG) ? 1 : 0,
          write: existsSync(join(r.draftsDir, DIRECT_SLUG, 'draft.md')) ? 1 : 0 }
        if (brief) DOWNGRADE[`fetchOne · ${label}`] = { ...c, reason: out.result.reason }
        if (code) {
          assert.equal(out.result.reason, code, `${label}: ${JSON.stringify(out.result).slice(0, 180)}`)
          assert.deepEqual(c, { probe: 0, chrome: 0, reservation: 0, write: 0 })
        } else {
          assert.equal(c.probe, 1, `exact direct 가 전송 경계에 도달하지 못했다: ${JSON.stringify(out.result).slice(0, 180)}`)
          assert.deepEqual({ chrome: c.chrome, reservation: c.reservation, write: c.write }, { chrome: 0, reservation: 0, write: 0 })
        }
      }])
    }
    cases.push([`P0 attemptRegeneration — ${label} → ${code ? `${code} · runner 0 · packet 0` : 'runner 1'}`, () => {
      const r = setup({ brief: true })
      writeFileSync(join(r.draftsDir, DIRECT_SLUG, 'draft.md'), '---\ntitle: t\n---\n\n## 본문\n\n[CTA] /community/free | t | t\n')
      const base = dirname(r.draftsDir); const packetDir = join(base, 'packets'); mkdirSync(packetDir, { recursive: true })
      const seen = []
      const runner = (a) => { seen.push({ packetExists: existsSync(a.packetPath), specHash: a.packet.specHash ?? null }); return { ok: false, why: '시험 runner — 보내지 않는다' } }
      const out = regen.attemptRegeneration({ slug: DIRECT_SLUG, profile: 'STANDARD', failures: [{ code: 'X', label: 't', sentence: '' }], runner,
        quarantinePath: join(base, 'regen-q.json'), packetDir, draftsDir: r.draftsDir,
        queueItem: queueItemFn ? queueItemFn() : null, directSourceDeps: { queue: queueFn, expectedGraphVersion: () => GV, productRoot: () => ROOT } })
      const c = { runner: seen.length, packet: seen.filter((x) => x.packetExists).length, packetResidue: readdirSync(packetDir).length,
        reservation: existsSync(join(base, 'regen-q.json')) && readFileSync(join(base, 'regen-q.json'), 'utf8').includes(DIRECT_SLUG) ? 1 : 0 }
      DOWNGRADE[`attemptRegeneration · ${label}`] = { ...c, code: out.code ?? (out.ok ? 'ok' : null) }
      if (code) {
        assert.equal(out.code, code, `${label}: ${JSON.stringify(out).slice(0, 180)}`)
        assert.deepEqual(c, { runner: 0, packet: 0, packetResidue: 0, reservation: 0 })
      } else {
        assert.equal(c.runner, 1, `exact direct regen 이 runner 에 닿지 못했다: ${JSON.stringify(out).slice(0, 180)}`)
        assert.equal(seen[0].specHash, JSON.parse(r.spec).specHash, 'direct regen packet 이 spec 신원을 운반하지 않는다')
        assert.equal(c.packetResidue, 0)
      }
    }])
  }
  cases.push(['P0 진짜 legacy (direct 흔적 없음) — fetchOne 은 legacy 그대로 (brief_missing 판정 불변)', async () => {
    const base = tmp('truelegacy'); const d = join(base, 'drafts'); mkdirSync(join(d, LEGACY_SLUG), { recursive: true })
    const log = console.log; const err = console.error
    console.log = () => {}; console.error = () => {}
    let out
    try {
      out = await webui.fetchOne(LEGACY_SLUG, { quarantinePath: join(base, 'q.json'), draftsDir: d, queueItem: legacyItem(), exit: () => {},
        directSourceDeps: { queue: () => [], expectedGraphVersion: () => GV, productRoot: () => ROOT }, probeFn: async () => { throw new Error('probe 금지') } })
    } finally { console.log = log; console.error = err }
    assert.equal(out.result.reason, 'brief_missing')
  }])
  return cases
}

/**
 * P0-1 — packet-only direct 신원. article-spec · 등록 영수증 · brief 가 모두 없고 유효한 direct regen packet 만 있다.
 * 실제 `fetchOne(--regen-packet)` wrapper 를 태운다.
 */
const PACKET_ONLY = {}
function packetOnlyCases(webui) {
  const setup = () => {
    const r = runPlan(real.plan, { queue: [directItem()], prepare: (d) => writeSource(d) })
    const spec = JSON.parse(r.spec)
    rmSync(specPathOf(r.draftsDir))   // 🔴 spec 도 영수증도 brief 도 없다 — packet 만 direct 신원이다
    writeFileSync(join(r.draftsDir, DIRECT_SLUG, 'draft.md'), '---\ntitle: t\n---\n\n## 본문\n\n[CTA] /community/free | t | t\n')
    const base = dirname(r.draftsDir); const packetDir = join(base, 'packets'); mkdirSync(packetDir, { recursive: true })
    const attemptId = randomUUID()
    const dp = directSpecRegenPacket({ spec, failures: [{ code: 'X', label: 't', sentence: '' }] })
    const packet = { schemaVersion: 'regen-packet/3', slug: DIRECT_SLUG, profile: 'STANDARD', attempt: 1, attemptId,
      failures: [{ code: 'X', label: 't', sentence: '' }], instruction: dp.instruction, specHash: dp.specHash, articleSpecSchemaVersion: dp.schemaVersion }
    const packetPath = join(packetDir, `${DIRECT_SLUG}.${attemptId}.json`)
    writeFileSync(packetPath, JSON.stringify(packet))
    return { r, base, packetPath, packetBytes: readFileSync(packetPath, 'utf8') }
  }
  const states = [
    ['큐 삭제', null, () => [], 'DIRECT_SPEC_NOT_IN_QUEUE'],
    ...WITHDRAWN_STATES,
    ['현재 큐 exact direct · spec 없음', () => directItem(), () => [directItem()], 'DIRECT_SPEC_MISSING'],
  ]
  return [
    ...states.map(([label, qi, queue, code]) => [`P0-1 fetchOne(--regen-packet) packet-only — ${label} → ${code} · provider·probe·Chrome·예약·write 0`, async () => {
      const { r, base, packetPath, packetBytes } = setup()
      const q = join(base, 'pk-q.json'); const draftOut = join(base, 'regen-out.md')
      const draftBefore = readFileSync(join(r.draftsDir, DIRECT_SLUG, 'draft.md'), 'utf8')
      const m = { probe: 0, chrome: 0 }
      const log = console.log; const err = console.error
      console.log = () => {}; console.error = () => {}
      let out
      try {
        out = await webui.fetchOne(DIRECT_SLUG, { regenPacket: packetPath, draftOut, quarantinePath: q, draftsDir: r.draftsDir,
          queueItem: qi ? qi() : null, directSourceDeps: { queue, expectedGraphVersion: () => GV, productRoot: () => ROOT }, resultPath: join(base, 'pk-result.json'), exit: () => {},
          probeFn: async () => { m.probe++; return { status: 'DSSC_FAKE_PROBE_STOP' } },
          browserDeps: { connect: async () => { m.chrome++; throw new Error('Chrome 금지') }, ensureTab: async () => { m.chrome++; throw new Error('Chrome 금지') } } })
      } finally { console.log = log; console.error = err }
      const c = { probe: m.probe, chrome: m.chrome, reservation: existsSync(q) && readFileSync(q, 'utf8').includes(DIRECT_SLUG) ? 1 : 0,
        write: (existsSync(draftOut) ? 1 : 0) + (readFileSync(join(r.draftsDir, DIRECT_SLUG, 'draft.md'), 'utf8') !== draftBefore ? 1 : 0),
        packetWrite: readFileSync(packetPath, 'utf8') !== packetBytes ? 1 : 0 }
      PACKET_ONLY[label] = { ...c, reason: out.result.reason }
      assert.equal(out.result.reason, code, `${label}: ${JSON.stringify(out.result).slice(0, 180)}`)
      assert.deepEqual(c, { probe: 0, chrome: 0, reservation: 0, write: 0, packetWrite: 0 })
    }]),
    ['P0-1 진짜 legacy packet (direct 흔적 없음 · brief 없음) → brief_missing 판정 불변', async () => {
      const base = tmp('legacy-packet'); const d = join(base, 'drafts'); mkdirSync(join(d, LEGACY_SLUG), { recursive: true })
      const attemptId = randomUUID(); const pd = join(base, 'packets'); mkdirSync(pd)
      const pp = join(pd, `${LEGACY_SLUG}.${attemptId}.json`)
      writeFileSync(pp, JSON.stringify({ schemaVersion: 'regen-packet/3', slug: LEGACY_SLUG, profile: 'STANDARD', attempt: 1, attemptId, failures: [{ code: 'X' }], instruction: 'x' }))
      const log = console.log; const err = console.error
      console.log = () => {}; console.error = () => {}
      let out
      try {
        out = await webui.fetchOne(LEGACY_SLUG, { regenPacket: pp, draftOut: join(base, 'o.md'), quarantinePath: join(base, 'q.json'), draftsDir: d,
          queueItem: legacyItem(), exit: () => {}, probeFn: async () => { throw new Error('probe 금지') } })
      } finally { console.log = log; console.error = err }
      assert.equal(out.result.reason, 'brief_missing')
    }],
  ]
}

/**
 * P0-2 — DIRECT_SPEC 행의 입력 수리 우회. 실제 `scanRepairTargets` · `runInputRepair` · `fetchOne(inputRepair)` 를 태운다.
 */
const REPAIR_COUNTS = {}
function repairCases(repair, webui) {
  const BAD_BRIEF = '엉터리 brief — 형식 계약을 지키지 않는다\n'
  const ECHO_DRAFT = '---\ntitle: t\n---\n\n## 검색 의도\n\n## 글 구조\n\n## 반드시 그대로 넣을 문장\n\n본문\n'
  const folder = (d, slug, { brief = BAD_BRIEF, draft = null, spec = null } = {}) => {
    mkdirSync(join(d, slug), { recursive: true })
    if (brief) writeFileSync(join(d, slug, 'brief.md'), brief)
    if (draft) writeFileSync(join(d, slug, 'draft.md'), draft)
    if (spec) writeFileSync(join(d, slug, 'article-spec.json'), spec)
  }
  // 🔴 persisted 흔적만으로 막혀야 하는 반례 — G8 해시까지 지운 legacy 행이다 (해시가 남으면 mode 판정이 먼저 막아 흔적 검사가 가려진다)
  const withdrawn = () => withdrawnItem({ by: 'mode', keepG8: false })
  const withdrawnG8 = () => withdrawnItem({ by: 'mode', keepG8: true })
  return [
    ['P0-2 scanRepairTargets — current direct(BRIEF·DRAFT_ECHO)·persisted 철회·모르는 mode 는 대상 0 · legacy 대상은 legacy-only 와 deep-equal', () => {
      const d = tmp('scan')
      folder(d, DIRECT_SLUG)                                                    // current direct + 잔여 brief
      folder(d, 'direct-echo', { brief: null, draft: ECHO_DRAFT })              // current direct + brief echo draft (brief 없음은 대상 아님)
      folder(d, 'direct-echo2', { draft: ECHO_DRAFT })                          // current direct + brief + echo draft
      folder(d, 'persisted-withdrawn', { spec: '{}' })                          // 철회됐지만 spec 흔적
      folder(d, 'unknown-mode')
      folder(d, 'g8-withdrawn')                                                 // G8 해시를 단 채 legacy 로 철회된 행
      folder(d, LEGACY_SLUG)                                                    // 진짜 legacy
      const queue = [directItem(), directItem({ slug: 'direct-echo', day: 9003 }), directItem({ slug: 'direct-echo2', day: 9004 }),
        { ...withdrawn(), slug: 'persisted-withdrawn', day: 9005 }, directItem({ slug: 'unknown-mode', day: 9006, directSpecMode: 'X' }),
        { ...withdrawnG8(), slug: 'g8-withdrawn', day: 9007 }, legacyItem()]
      const scan = repair.scanRepairTargets({ queue, draftsDir: d, store: {} })
      assert.deepEqual(scan.targets.map((t) => t.slug), [LEGACY_SLUG], `direct 행이 입력 수리 대상이 됐다: ${scan.targets.map((t) => `${t.slug}:${t.type}`)}`)
      const only = repair.scanRepairTargets({ queue: [legacyItem()], draftsDir: d, store: {} })
      assert.deepEqual(scan.targets, only.targets, 'legacy 입력 수리 대상이 direct 행 유무에 따라 달라졌다')
      assert.equal(only.targets[0]?.type, repair.REPAIR.BRIEF, 'legacy 대상이 없어 비교가 무의미하다')
      const skippedDirect = scan.skipped.filter((x) => x.reason === 'DIRECT_SPEC_INPUT_REPAIR_FORBIDDEN').map((x) => x.slug).sort()
      assert.deepEqual(skippedDirect, [DIRECT_SLUG, 'direct-echo2', 'g8-withdrawn', 'persisted-withdrawn', 'unknown-mode'].sort())
    }],
    ['P0-2 runInputRepair — direct 행만 있으면 generateBrief · runRepairFetch · repairGate 호출 0', async () => {
      const d = tmp('runrepair'); folder(d, DIRECT_SLUG, { draft: ECHO_DRAFT }); folder(d, 'persisted-withdrawn', { spec: '{}' })
      const calls = { generateBrief: 0, runRepairFetch: 0, repairGate: 0, convertCheck: 0 }
      const deps = Object.fromEntries(Object.keys(calls).map((k) => [k, (...a) => { calls[k]++; throw new Error(`${k} 호출 금지`) }]))
      const out = await repair.runInputRepair({ draftsDir: d, queue: [directItem(), { ...withdrawn(), slug: 'persisted-withdrawn', day: 9005 }],
        ledger: { ok: true, store: {} }, quarantinePath: join(dirname(d), `${randomUUID()}-q.json`), deps: { ...deps, log: () => {} }, tmpDir: join(d, '_tmp') })
      REPAIR_COUNTS['runInputRepair · direct 행'] = { ...calls, results: out.results.length }
      assert.equal(out.ok, true); assert.equal(out.results.length, 0)
      assert.deepEqual(calls, { generateBrief: 0, runRepairFetch: 0, repairGate: 0, convertCheck: 0 })
    }],
    ...[
      ['current exact direct', () => directItem(), () => [directItem()], 'DIRECT_SPEC_INPUT_REPAIR_FORBIDDEN', false],
      ['persisted direct · 큐 삭제', null, () => [], 'DIRECT_SPEC_NOT_IN_QUEUE', true],
      ['persisted direct · opt-in 철회 · G8 해시 유지', withdrawnG8, () => [withdrawnG8()], 'G8_ROW_NOT_DIRECT', true],
      ['persisted direct · opt-in 철회 · G8 해시도 제거', withdrawn, () => [withdrawn()], 'DIRECT_SPEC_MODE_WITHDRAWN', true],
    ].map(([label, qi, queue, code, persisted]) => [`P0-2 fetchOne(inputRepair BRIEF_ECHO) — ${label} → ${code} · probe·Chrome·예약·write 0`, async () => {
      const r = persisted ? runPlan(real.plan, { queue: [directItem()], prepare: (dd) => writeSource(dd) }) : null
      const d = r?.draftsDir ?? join(tmp('ir-cur'), 'drafts')
      if (!r) writeSource(d)
      folder(d, DIRECT_SLUG, { brief: BAD_BRIEF, draft: ECHO_DRAFT })
      const base = dirname(d); const q = join(base, 'ir-q.json'); const draftOut = join(base, 'ir-out.md')
      const m = { probe: 0, chrome: 0 }
      const log = console.log; const err = console.error
      console.log = () => {}; console.error = () => {}
      let out
      try {
        out = await webui.fetchOne(DIRECT_SLUG, { inputRepair: { type: 'BRIEF_ECHO' }, draftOut, quarantinePath: q, draftsDir: d,
          queueItem: qi ? qi() : null, directSourceDeps: { queue, expectedGraphVersion: () => GV, productRoot: () => ROOT }, resultPath: join(base, 'ir-result.json'), exit: () => {},
          probeFn: async () => { m.probe++; return { status: 'DSSC_FAKE_PROBE_STOP' } },
          browserDeps: { connect: async () => { m.chrome++; throw new Error('Chrome 금지') }, ensureTab: async () => { m.chrome++; throw new Error('Chrome 금지') } } })
      } finally { console.log = log; console.error = err }
      const c = { probe: m.probe, chrome: m.chrome, reservation: existsSync(q) && readFileSync(q, 'utf8').includes(DIRECT_SLUG) ? 1 : 0,
        write: (existsSync(draftOut) ? 1 : 0) + (readFileSync(join(d, DIRECT_SLUG, 'draft.md'), 'utf8') !== ECHO_DRAFT ? 1 : 0) }
      REPAIR_COUNTS[`fetchOne inputRepair · ${label}`] = { ...c, reason: out.result.reason }
      assert.equal(out.result.reason, code, `${label}: ${JSON.stringify(out.result).slice(0, 180)}`)
      assert.deepEqual(c, { probe: 0, chrome: 0, reservation: 0, write: 0 })
    }]),
  ]
}

/**
 * P1 — 승인 basis drift 를 **실제 소비 경계 다섯 곳**에서 본다. 같은 graphVersion 에서 판만 바꾼다.
 *    selected(plan) · reusable(plan 2일차) · register(등록 gate) · send(fetchSlug) · regen(attemptRegeneration).
 */
const BASIS_COUNTS = {}
function basisDriftCases(plan, lane, webui, regen) {
  const wrap = (root) => (a) => real.source.verifyDirectSpecIdentity({ ...a, productRoot: root })
  const cases = []
  const plans = [
    ['판 그대로(대조군)', null, null],
    ['control 여러 줄·끝 쉼표(정상)', MULTILINE_CONTROL, null],
    ...BASIS_DRIFTS.map(([l, m]) => [l, m, 'PRODUCT_BASIS_DRIFT']),
    ...BASIS_UNREADABLE.map(([l, m]) => [l, m, 'PRODUCT_BASIS_UNREADABLE']),
  ]
  for (const [label, mut, want] of plans) {
    cases.push([`P1 basis ${label} — selected · reusable · register · send · regen ${want ? `모두 0 (${want})` : '진행'}`, async () => {
      const root = basisRoot(mut)
      // selected
      const sel = runPlan(plan, { queue: [directItem()], prepare: (d) => writeSource(d) , directSourceFnOverride: wrap(root) })
      // reusable — 1일차(실제 판)로 spec 을 남긴 뒤 2일차를 바뀐 판으로
      const d = crashedDay1()
      const reuse = runPlan(plan, { queue: [directItem()], draftsDir: d, today: TOMORROW, directSourceFnOverride: wrap(root) })
      const selectedProvider = providerTargets(sel)
      const reusableProvider = providerTargets(reuse)   // 🔴 regen 용 draft.md 를 쓰기 전에 센다
      const register = lane.gate(DIRECT_SLUG, [directItem()], d, { productRootFn: () => root }).ok ? 1 : 0
      // send — 실제 fetchSlug, probe 직전에서 멈추는 가짜 probe
      let probes = 0
      const q = join(dirname(d), 'basis-q.json')
      const deps = { queue: () => [directItem()], expectedGraphVersion: () => GV, productRoot: () => root }
      const sent = await webui.fetchSlug(DIRECT_SLUG, { quarantinePath: q, draftsDir: d, queueItem: directItem(), quiet: true, dateHint: TODAY,
        accessFn: async () => { probes++; return { status: 'DSSC_FAKE_PROBE_STOP' } }, directSourceDeps: deps })
      // regen — 실제 attemptRegeneration, runner 호출 수
      writeFileSync(join(d, DIRECT_SLUG, 'draft.md'), '---\ntitle: t\n---\n\n## 본문\n\n[CTA] /community/free | t | t\n')
      let runner = 0
      const pd = join(dirname(d), 'basis-packets'); mkdirSync(pd, { recursive: true })
      const rg = regen.attemptRegeneration({ slug: DIRECT_SLUG, profile: 'STANDARD', failures: [{ code: 'X', label: 't', sentence: '' }],
        runner: () => { runner++; return { ok: false, why: '시험 runner' } }, quarantinePath: join(dirname(d), 'basis-regen-q.json'), packetDir: pd,
        draftsDir: d, queueItem: directItem(), directSourceDeps: deps })
      const c = { selectedSpec: sel.spec ? 1 : 0, selectedProvider, reusableProvider, register, sendProbe: probes, regenRunner: runner }
      BASIS_COUNTS[label] = { ...c, sendReason: sent.reason ?? 'probe', regenCode: rg.code ?? null }
      if (want) {
        assert.deepEqual(c, { selectedSpec: 0, selectedProvider: 0, reusableProvider: 0, register: 0, sendProbe: 0, regenRunner: 0 }, `${label}: ${JSON.stringify(c)}`)
        assert.ok(heldOf(sel)?.directSpec?.blockers.includes(want), `${label}: selected HOLD 사유 ${heldOf(sel)?.directSpec?.blockers}`)
        assert.ok(heldOf(reuse)?.directSpec?.blockers.includes(want), `${label}: reusable HOLD 사유`)
        assert.equal(sent.reason, 'DIRECT_SPEC_SOURCE_NOT_READY'); assert.equal(rg.code, 'DIRECT_SPEC_SOURCE_NOT_READY')
      } else {
        assert.deepEqual(c, { selectedSpec: 1, selectedProvider: 1, reusableProvider: 1, register: 1, sendProbe: 1, regenRunner: 1 }, `대조군: ${JSON.stringify(c)}`)
      }
    }])
  }
  return cases
}

function laneCases(lane) {
  return [
    ['R 등록 gate — 큐 전체 경로에서도 source 부재·다른 spec 은 차단, 같은 spec 만 통과', () => {
      const d = crashedDay1()
      assert.equal(registerPass(lane, d), 1, '같은 source·같은 spec 인데 등록 gate 가 막았다')
      removeSource(d)
      const g = lane.gate(DIRECT_SLUG, [directItem()], d)
      assert.equal(g.ok, false); assert.ok(g.blockedBy.some((b) => b.code === 'DIRECT_SPEC_SOURCE_NOT_READY'))
      const again = reapproved('!')
      writeSource(d, { entries: [again] })
      // 재승인 + 큐도 새 승인으로 → 디스크의 옛 spec 과 SPEC_CONFLICT · 큐가 옛 승인을 가리키면 NOT_READY
      const c = lane.gate(DIRECT_SLUG, [directItem({}, again)], d)
      assert.equal(c.ok, false); assert.ok(c.blockedBy.some((b) => b.code === 'DIRECT_SPEC_SPEC_CONFLICT'), JSON.stringify(c.blockedBy))
      const stale = lane.gate(DIRECT_SLUG, [directItem()], d)
      assert.equal(stale.ok, false); assert.ok(stale.blockedBy.some((b) => b.code === 'DIRECT_SPEC_SOURCE_NOT_READY'), JSON.stringify(stale.blockedBy))
      // G8 해시 하나만 남긴 행 → 등록 gate 도 G8_ROW_NOT_DIRECT (legacy brief 판정으로 가지 않는다)
      const { articlePlanHash: _p, ...oneHash } = directItem({}, again)
      const g8 = lane.gate(DIRECT_SLUG, [oneHash], d)
      assert.equal(g8.ok, false); assert.deepEqual(g8.blockedBy.map((b) => b.code), ['G8_ROW_NOT_DIRECT'])
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
    ['N1c 큐 신원 중복 → 「매거진 queue 신원 중복」 알림 정확히 1건 · 대상 day·slug·intentId · DIRECT 보류 알림과 섞지 않는다', () => {
      const d = tmp('notify-identity')
      const held = [{ day: 9001, slug: 'dup-a', intentId: 'I-DUP', code: 'QUEUE_IDENTITY_DUPLICATE', why: 'x' }, { day: 9002, slug: 'dup-a', intentId: null, code: 'QUEUE_IDENTITY_DUPLICATE', why: 'y' }]
      const a = notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ held }) })
      const id = a.filter((x) => x.title.includes('매거진 queue 신원 중복'))
      assert.equal(id.length, 1, JSON.stringify(a)); assert.match(id[0].title, /2행/)
      assert.ok(id[0].reason.includes('day 9001 dup-a(I-DUP)') && id[0].reason.includes('day 9002 dup-a'), id[0].reason)
      assert.ok(!a.some((x) => x.title.includes('DIRECT_SPEC 보류')), 'DIRECT 보류 알림에 섞었다')
      assert.equal(notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun() }).filter((x) => x.title.includes('신원 중복')).length, 0)
    }],
    ['N1b G8_ROW_NOT_DIRECT 보류 → direct 보류 알림 1건 · ArticlePlan materialize 안내', () => {
      const d = tmp('notify-g8')
      const a = notify.judge({ date: TODAY, runExists: true, draftsDir: d, run: baseRun({ held: [{ day: 1, slug: 'g8-row', code: 'G8_ROW_NOT_DIRECT', why: 'x' }] }) })
      const direct = a.filter((x) => x.title.includes('DIRECT_SPEC 보류'))
      assert.equal(direct.length, 1, `G8_ROW_NOT_DIRECT 보류가 조용히 묻혔다: ${JSON.stringify(a)}`)
      assert.ok(direct[0].reason.includes('g8-row G8_ROW_NOT_DIRECT') && direct[0].next.includes('materialize'), JSON.stringify(direct[0]))
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
      // 🔴 성공한 회수처럼 — DIRECT 선정 행에 원고를 남기고 이번 회차 결과를 돌려준다
      runFetch: () => {
        const run = JSON.parse(readFileSync(join(runsDir, TODAY, 'run.json'), 'utf8'))
        for (const s of run.selected.filter((x) => x.directSpec)) writeFileSync(join(draftsDir, s.slug, 'draft.md'), PASS_DRAFT)
        return { status: 0, startedAt: Date.now() - 1000, report: { ok: true, body: { writtenAt: new Date().toISOString(), results: [] } } }
      },
      draftExists: (slug) => existsSync(join(draftsDir, slug, 'draft.md')),
      notify: () => ({ ok: true }),
    } })
    return { res, briefed, briefSpawns, draftsDir }
  }
  const supplyFlow = async (supply) => {
    let briefSpawns = 0
    await flow.runProducerFlow({ dryRun: false, deps: {
      log: () => {}, checkLock: () => ({ ok: true }), checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
      checkOutstanding: () => ({ ok: true, message: '없음' }), runPlan: () => ({ status: 0 }), readSupply: () => supply,
      runBrief: () => { briefSpawns++; return { status: 0 } }, runFetch: () => ({ status: 0, startedAt: Date.now() - 1000, report: { ok: true, body: { writtenAt: new Date().toISOString(), results: [] } } }), notify: () => ({ ok: true }),
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
      assert.deepEqual(flow.supplyFromRunJson({ selected: [{ slug: 'a' }, { slug: 'b', directSpec: {} }], reusable: [1] }), { selected: 2, reusable: 1, legacySelected: 1, directSlugs: ['b'] })
      assert.deepEqual(flow.supplyFromRunJson({}), { selected: null, reusable: 0, legacySelected: null, directSlugs: [] })
    }],
  ]
}

/**
 * P0-3 — brief 없는 DIRECT 원고 회수 (2026-10-24 첫 DIRECT 자연 회차 재현).
 *    age-learning 은 선정 · article-spec 까지 정상이었는데 회수가 brief_missing · 전송 0 으로 끝났다.
 *    runner 는 DIRECT 의 brief 검사를 건너뛰고 완성된 message 를 넘기는데, `fetchManuscript` 가
 *    message 유무와 무관하게 brief 부터 찾았다. 위 send 반례는 probe 에서 멈춰 그 안에 들어가지 못했다.
 * 🔴 여기서는 probe 를 통과시키고 **실제 `fetchManuscript`** 를 가짜 ChatGPT 화면까지 태운다 —
 *    composer 입력 · send 1 · 새 응답 · 원고 관문 · draft.md 저장 · 장부 정산까지. 실제 Chrome · provider 0.
 */
const BRIEF_FREE = {}
const PASS_DRAFT = readFileSync(join(ROOT, 'scripts/__fixtures__/magazine/manuscript-pass.draft.md'), 'utf8')
const realSession = await imp(PATHS.session)
const realQuarantine = await imp(join(ROOT, 'scripts/lib/magazine-quarantine.mjs'))
const { classifyFailure } = await imp(join(ROOT, 'scripts/lib/magazine-failure-kind.mjs'))
/** 가짜 ChatGPT — send 전에는 응답 0, 누른 뒤에는 새 assistant 응답 1(코드블록 = manuscript) */
function fakeChat(manuscript = PASS_DRAFT) {
  const m = { ensureTab: 0, connect: 0, send: 0, typed: '' }
  const page = () => {
    let sent = false
    const composer = { async click() {}, async innerText() { return m.typed } }
    const sendBtn = { async click() { m.send++; sent = true } }
    return {
      async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
      url: () => 'https://chatgpt.com/c/dssc-fake',
      async evaluate(fn) {
        if (fn?.name !== 'readConversationDom') return null
        return sent
          ? { readOk: true, stop: false, units: [{ id: 'dssc-a1', role: 'assistant', source: 'new', candidates: [{ form: 'code-block', text: manuscript }], text: '', hasActions: true }] }
          : { readOk: true, stop: false, units: [] }
      },
      locator(sel) { const l = /send-button|보내기|Send/.test(String(sel ?? '')) ? sendBtn : composer; return { first: () => l, ...l } },
      keyboard: { async insertText(t) { m.typed += String(t ?? '') }, async press() {} },
    }
  }
  return {
    m,
    deps: { pollMs: 5, stablePolls: 2, timeoutMs: 2000, connectTimeoutMs: 500,
      ensureTab: async () => { m.ensureTab++; return { ok: true } },
      connect: async () => { m.connect++; return { contexts: () => [{ pages: () => [], newPage: async () => page() }], async close() {} } } },
  }
}
/**
 * 🔴 운영 격리 기록과 같은 모양 (2026-10-24 운영 장부 읽기 전용 확인).
 *    00:10 회수가 brief_missing 으로 끝나며 runner 가 적은 delivery(recordDelivery · classifyFailure) 위에
 *    01:00 auto-register 의 --fetch 실패가 recordFailure 로 top-level(kind CONTENT · attempts 1 · fingerprint null)을 얹었다.
 *    둘 다 실제 기록 함수로 같은 순서로 만든다 — fixture 가 실제보다 약하면 재시도 판정을 시험하지 못한다.
 */
const briefMissingRecord = (slug, q) => realQuarantine.updateQuarantine((cur) => {
  const delivered = realQuarantine.recordDelivery(cur[slug], {
    sent: false, messageFingerprint: null, now: NOW, date: TODAY, reason: 'brief_missing', stage: null,
    kind: classifyFailure({ code: 'brief_missing', stage: null, message: '', sent: false }).kind,
  })
  return { ...cur, [slug]: { ...delivered, ...realQuarantine.recordFailure({ entry: delivered, fingerprint: null, now: NOW + 1,
    reasons: ['FETCH_FAILED: 회수 실패 — brief_missing · 전송 0건'], sent: false }) } }
}, q)
function briefFreeCases(webui, session = realSession) {
  const planned = () => {
    const r = runPlan(real.plan, { queue: [directItem()], prepare: (d) => writeSource(d) })
    assert.ok(r.spec, 'plan 이 spec 을 쓰지 못했다 (반례 준비 실패)')
    assert.ok(!existsSync(join(r.draftsDir, DIRECT_SLUG, 'brief.md')), 'DIRECT 폴더에 brief.md 가 있다 (반례 준비 실패)')
    return r
  }
  const deps = { queue: () => [directItem()], expectedGraphVersion: () => GV, productRoot: () => ROOT }
  const quiet = async (fn) => {
    const log = console.log; const err = console.error
    console.log = () => {}; console.error = () => {}
    try { return await fn() } finally { console.log = log; console.error = err }
  }
  const sendOne = async (r, q) => {
    const row = r.run.selected.find((x) => x.slug === DIRECT_SLUG)
    const chat = fakeChat()
    const m = { probe: 0 }
    const out = await quiet(() => webui.fetchSlug(DIRECT_SLUG, { quarantinePath: q, draftsDir: r.draftsDir, queueItem: row, quiet: true,
      dateHint: TODAY, accessFn: async () => { m.probe++; return { status: session.STATUS.OK } }, browserDeps: chat.deps, directSourceDeps: deps }))
    return { out, chat, probe: m.probe }
  }
  const delivered = (r, q, { out, chat, probe }, label) => {
    const draft = join(r.draftsDir, DIRECT_SLUG, 'draft.md')
    const c = { probe, ensureTab: chat.m.ensureTab, connect: chat.m.connect, send: chat.m.send, write: existsSync(draft) ? 1 : 0 }
    BRIEF_FREE[label] = c
    assert.equal(out.status, 'ok', `${label}: ${JSON.stringify(out).slice(0, 220)}`)
    assert.deepEqual(c, { probe: 1, ensureTab: 1, connect: 1, send: 1, write: 1 }, `${label}: ${JSON.stringify(c)}`)
    assert.equal(out.mode, 'DIRECT_SPEC_V1')
    assert.equal(readFileSync(draft, 'utf8'), PASS_DRAFT, '저장한 원고가 응답과 다르다')
    // 🔴 보낸 글자가 관문이 판정한 DIRECT message 그 자체다 — legacy 강등 · brief 조립 0
    assert.equal(out.messageFingerprint, realQuarantine.deliveryFingerprintOf(chat.m.typed), '보낸 글자의 지문이 판정 지문과 다르다')
    assert.ok(!existsSync(join(r.draftsDir, DIRECT_SLUG, 'brief.md')), 'brief.md 가 만들어졌다 (가짜 brief 금지)')
    const st = realQuarantine.readQuarantine(q)
    assert.ok(st.ok && st.store[DIRECT_SLUG] && st.store[DIRECT_SLUG].delivery === undefined, `전송 예약이 정산되지 않았다: ${JSON.stringify(st.store[DIRECT_SLUG])}`)
  }
  return [
    ['P0-3 실제 fetchSlug — DIRECT message 있음 · brief 없음 → 실제 fetchManuscript · send 1 · draft 저장 · 예약 정산', async () => {
      const r = planned(); const q = join(dirname(r.draftsDir), 'bf-q.json')
      delivered(r, q, await sendOne(r, q), 'fetchSlug · brief 없음')
    }],
    ['P0-3 실제 fetchBatch(--fetch-run) — DIRECT brief 없음 → send 1 · draft 저장', async () => {
      const r = planned(); const q = join(dirname(r.draftsDir), 'bf-batch-q.json')
      const chat = fakeChat(); const m = { probe: 0 }
      const b = await quiet(() => webui.fetchBatch({ date: TODAY, dryRun: false, draftsDir: r.draftsDir, quarantinePath: q,
        probeFn: async () => { m.probe++; return { status: session.STATUS.OK } }, browserDeps: chat.deps, directSourceDeps: deps,
        resultPath: join(dirname(r.draftsDir), 'bf-batch-result.json') }))
      const c = { probe: m.probe, send: chat.m.send, write: existsSync(join(r.draftsDir, DIRECT_SLUG, 'draft.md')) ? 1 : 0 }
      BRIEF_FREE['fetchBatch · brief 없음'] = c
      assert.deepEqual(c, { probe: 1, send: 1, write: 1 }, JSON.stringify({ c, results: b?.results }).slice(0, 260))
    }],
    ['P0-3 격리 재시도 — 옛 회수가 남긴 기록(sent=false · fingerprint=null) 위에서 다음 회수가 막히지 않는다', async () => {
      const r = planned(); const q = join(dirname(r.draftsDir), 'bf-retry-q.json')
      briefMissingRecord(DIRECT_SLUG, q)
      const before = realQuarantine.readQuarantine(q).store[DIRECT_SLUG]
      assert.deepEqual({ sent: before.delivery.sent, fp: before.delivery.messageFingerprint, reason: before.delivery.reason,
        kind: before.kind, attempts: before.attempts, fingerprint: before.fingerprint },
        { sent: false, fp: null, reason: 'brief_missing', kind: 'CONTENT', attempts: 1, fingerprint: null }, '운영 기록과 같은 모양을 만들지 못했다 (반례 준비 실패)')
      assert.equal(realQuarantine.deliveryHoldsFetch(before, 'sha256:any'), null, '지문 없는 기록이 전송 HOLD 가 됐다')
      // 🔴 등록 준비(auto-register-ready)는 draft 지문(없으면 null)으로 본다 — attempts 1 < 2 → RETRYING
      const jq = realQuarantine.judgeQuarantine({ entry: before, slug: DIRECT_SLUG, fingerprint: null, now: NOW + 2 })
      assert.deepEqual({ skip: jq.skip, code: jq.code }, { skip: false, code: 'RETRYING' }, '운영 기록이 격리로 읽혔다')
      delivered(r, q, await sendOne(r, q), '격리 재시도 · brief_missing 기록 위')
    }],
    ['P0-3 실제 fetchManuscript — message 있음 · briefPath 없음 → brief 를 찾지 않고 연결 단계까지 간다', async () => {
      const d = tmp('bf-sess')
      const m = { ensureTab: 0, connect: 0 }
      const out = await session.fetchManuscript({ briefPath: join(d, 'brief.md'), outPath: join(d, 'draft.md'), promptText: null, message: 'DIRECT 완성 메시지',
        timeoutMs: 100, connectTimeoutMs: 100,
        ensureTab: async () => { m.ensureTab++; return { ok: true } }, connect: async () => { m.connect++; throw new Error('DSSC_STOP_AT_CONNECT') } })
      assert.notEqual(out.reason, 'brief_missing', JSON.stringify(out))
      assert.deepEqual({ ...m, reason: out.reason, sent: out.sent }, { ensureTab: 1, connect: 1, reason: 'connect_failed', sent: false })
    }],
    ['P0-3 legacy 불변 — 실제 fetchManuscript · message 없음 · brief 없음 → brief_missing · 탭·연결·전송 0', async () => {
      const d = tmp('bf-legacy')
      const m = { ensureTab: 0, connect: 0 }
      const out = await session.fetchManuscript({ briefPath: join(d, 'brief.md'), outPath: join(d, 'draft.md'), promptText: '시험',
        ensureTab: async () => { m.ensureTab++; return { ok: true } }, connect: async () => { m.connect++; throw new Error('Chrome 금지') } })
      assert.deepEqual({ ...m, out }, { ensureTab: 0, connect: 0, out: { ok: false, reason: 'brief_missing', sent: false } })
    }],
    ['P0-3 legacy 불변 — 실제 fetchSlug · legacy 행 · brief 없음 → brief_missing skip · probe·Chrome·장부 0', async () => {
      const base = tmp('bf-legacy-slug'); const d = join(base, 'drafts'); mkdirSync(join(d, LEGACY_SLUG), { recursive: true })
      const q = join(base, 'q.json')
      const chat = fakeChat(); const m = { probe: 0 }
      const out = await quiet(() => webui.fetchSlug(LEGACY_SLUG, { quarantinePath: q, draftsDir: d, queueItem: legacyItem(), quiet: true, dateHint: TODAY,
        accessFn: async () => { m.probe++; return { status: session.STATUS.OK } }, browserDeps: chat.deps, directSourceDeps: deps }))
      const c = { probe: m.probe, ensureTab: chat.m.ensureTab, connect: chat.m.connect, send: chat.m.send, ledger: existsSync(q) ? 1 : 0 }
      BRIEF_FREE['legacy fetchSlug · brief 없음'] = c
      assert.deepEqual({ status: out.status, reason: out.reason, sent: out.sent }, { status: 'skipped', reason: 'brief_missing', sent: false })
      assert.deepEqual(c, { probe: 0, ensureTab: 0, connect: 0, send: 0, ledger: 0 })
    }],
    ['P0-3 빈 message · 문자열 아닌 message → message_invalid · brief 로 대신 조립하지 않는다 · 연결 0', async () => {
      const d = tmp('bf-empty'); writeFileSync(join(d, 'brief.md'), '# 있는 brief\n')
      for (const message of ['', '   \n', 42]) {
        const m = { ensureTab: 0, connect: 0 }
        const out = await session.fetchManuscript({ briefPath: join(d, 'brief.md'), outPath: join(d, 'draft.md'), promptText: '시험', message,
          ensureTab: async () => { m.ensureTab++; return { ok: true } }, connect: async () => { m.connect++; throw new Error('Chrome 금지') } })
        assert.deepEqual({ ...m, reason: out.reason, sent: out.sent }, { ensureTab: 0, connect: 0, reason: 'message_invalid', sent: false }, JSON.stringify(message))
      }
    }],
  ]
}

/**
 * P0-4 — DIRECT 무전송 회수(`recoverSlug`). 보냈는데 응답 판독이 끝나지 않은 DIRECT 글(DELIVERY_UNCERTAIN)을
 *    다시 보내지 않고 기존 대화에서 원문만 읽어 저장한다. 앞판은 DIRECT 에서도 brief.md 를 직접 읽어 ENOENT 로 터졌다.
 * 🔴 legacy 는 brief 의 대조 문장(requiredMarkers)을 그대로 요구한다 — 문장이 빠진 응답은 저장 0 · 장부 불변.
 */
const RECOVER = {}
const RECOVER_URL = 'https://chatgpt.com/c/6abc5296-452c-83ee-8788-0000d55c0004'
/** 🔴 시험 legacy brief 도 실제 brief 형식 계약(judgeBriefFormatContract)을 지닌다 — m3a-check 와 같은 블록 */
const LEGACY_BRIEF_FORMAT = [
  '[CTA] /community/free | 자유게시판에 이야기 남기기 | CTA 앞에 붙일 한 문장', '',
  '### 쓸 수 있는 표기가 전부다', '',
  '| 표기 | 쓰임 |', '|---|---|', '| `## ` | h2 |', '| `### ` | h3 |', '| `> ` | 인용 |', '| `- ` | 목록 |',
  '| `[CTA] href \\| 문구 \\| 앞 문장` | 마지막에 정확히 1개 |', '',
  '### 공통 금지', '',
  '🚫 표 · 코드블록 · 외부 링크 · 마크다운 이미지 · h1 · h4 이하 · HTML · 번호 목록',
].join('\n')
const { writeFetchResults } = await imp(join(ROOT, 'scripts/lib/magazine-fetch-result.mjs'))
/** 가짜 ChatGPT 대화 — 사용자 메시지 1(우리가 보낸 글자) · assistant 응답 1. composer·send 를 세어 0 인지 본다 */
function fakeConversation(userText, manuscript = PASS_DRAFT) {
  const m = { ensureTab: 0, connect: 0, goto: 0, send: 0, typed: 0 }
  const page = {
    async close() {}, async goto() { m.goto++ }, async waitForSelector() {}, async waitForTimeout() {},
    url: () => RECOVER_URL,
    async evaluate(fn) {
      if (fn?.name !== 'readConversationDom') return null
      return { readOk: true, stop: false, units: [
        { id: 'dssc-u1', role: 'user', source: 'old', candidates: [], text: userText, hasActions: false },
        { id: 'dssc-r1', role: 'assistant', source: 'old', candidates: [{ form: 'code-block', text: manuscript }], text: '', hasActions: true },
      ] }
    },
    locator() { const l = { async click() { m.send++ }, async innerText() { return '' } }; return { first: () => l, ...l } },
    keyboard: { async insertText() { m.typed++ }, async press() { m.typed++ } },
  }
  return { m, deps: { settleMs: 0, connectTimeoutMs: 500,
    ensureTab: async () => { m.ensureTab++; return { ok: true } },
    connect: async () => { m.connect++; return { contexts: () => [{ pages: () => [], newPage: async () => page }], async close() {} } } } }
}
/** 보냈는데 모른다 — 장부 DELIVERY_UNCERTAIN(예약 ID) + 그날 회수 결과의 sent=true 실패 행. 둘 다 실제 기록 함수로 만든다 */
function seedUncertain({ slug, draftsDir, q, rp, queueItem, directSourceDeps }) {
  const g = realGate.deliveryGate({ slug, draftsDir, quarantinePath: q, queueItem, directSourceDeps })
  assert.equal(g.ok, true, `반례 준비 실패: ${g.why}`)
  realQuarantine.updateQuarantine((cur) => ({ ...cur, [slug]: realQuarantine.recordDelivery(cur[slug], {
    sent: null, messageFingerprint: g.messageFingerprint, kind: 'DELIVERY_UNCERTAIN', reason: 'response_timeout', stage: 'await-response',
    now: NOW, date: TODAY, reservationId: 'dssc-reservation-1' }) }), q)
  writeFetchResults(rp, { date: TODAY, mode: 'fetch-run', sentTotal: 1, results: [{ slug, status: 'failed', reason: 'response_timeout',
    stage: 'await-response', sent: true, messageFingerprint: g.messageFingerprint, conversationUrl: RECOVER_URL }] })
  return g
}
function recoverCases(webui) {
  const deps = { queue: () => [directItem()], expectedGraphVersion: () => GV, productRoot: () => ROOT }
  const ok = async () => ({ status: realSession.STATUS.OK })
  return [
    ['P0-4 실제 recoverSlug — DIRECT DELIVERY_UNCERTAIN · brief 없음 → 기존 대화에서 저장 · send 0 · 예약 해제', async () => {
      const r = runPlan(real.plan, { queue: [directItem()], prepare: (d) => writeSource(d) })
      assert.ok(r.spec && !existsSync(join(r.draftsDir, DIRECT_SLUG, 'brief.md')), '반례 준비 실패')
      const q = join(dirname(r.draftsDir), 'rc-q.json'); const rp = join(dirname(r.draftsDir), 'rc-result.json')
      const g = seedUncertain({ slug: DIRECT_SLUG, draftsDir: r.draftsDir, q, rp, queueItem: directItem(), directSourceDeps: deps })
      assert.equal(g.mode, 'DIRECT_SPEC_V1')
      const conv = fakeConversation(g.message)
      const out = await webui.recoverSlug(DIRECT_SLUG, { conversationUrl: RECOVER_URL, date: TODAY, resultPath: rp, quarantinePath: q,
        draftsDir: r.draftsDir, browserDeps: conv.deps, accessFn: ok, directSourceDeps: deps })
      const draft = join(r.draftsDir, DIRECT_SLUG, 'draft.md')
      const c = { connect: conv.m.connect, goto: conv.m.goto, send: conv.m.send, typed: conv.m.typed, write: existsSync(draft) ? 1 : 0 }
      RECOVER['DIRECT recover · brief 없음'] = c
      assert.equal(out.status, 'ok', JSON.stringify(out).slice(0, 220))
      assert.deepEqual(c, { connect: 1, goto: 1, send: 0, typed: 0, write: 1 })
      assert.equal(readFileSync(draft, 'utf8'), PASS_DRAFT)
      assert.equal(out.released, true, '전송불명 예약이 풀리지 않았다')
      assert.ok(!existsSync(join(r.draftsDir, DIRECT_SLUG, 'brief.md')), 'brief.md 가 만들어졌다 (가짜 brief 금지)')
    }],
    ['P0-4 legacy 불변 — 실제 recoverSlug · brief 대조 문장이 빠진 응답 → markers_missing · 저장 0 · 장부 불변', async () => {
      const base = tmp('rc-legacy'); const d = join(base, 'drafts'); mkdirSync(join(d, LEGACY_SLUG), { recursive: true })
      writeFileSync(join(d, LEGACY_SLUG, 'brief.md'), `${LEGACY_BRIEF_FORMAT}\n\n# legacy brief\n\n## 반드시 그대로 넣을 문장\n1. 응답에 없는 지정 문장 DSSC-MARKER\n`)
      const q = join(base, 'q.json'); const rp = join(base, 'result.json')
      const g = seedUncertain({ slug: LEGACY_SLUG, draftsDir: d, q, rp, queueItem: legacyItem(), directSourceDeps: deps })
      assert.notEqual(g.mode, 'DIRECT_SPEC_V1', 'legacy 행이 direct 로 판정됐다 (반례 준비 실패)')
      const before = readFileSync(q, 'utf8')
      const conv = fakeConversation(g.message)
      const out = await webui.recoverSlug(LEGACY_SLUG, { conversationUrl: RECOVER_URL, date: TODAY, resultPath: rp, quarantinePath: q,
        draftsDir: d, browserDeps: conv.deps, accessFn: ok, directSourceDeps: deps })
      RECOVER['legacy recover · 대조 문장 없음'] = { reason: out.reason, send: conv.m.send, write: existsSync(join(d, LEGACY_SLUG, 'draft.md')) ? 1 : 0 }
      assert.deepEqual({ status: out.status, reason: out.reason }, { status: 'failed', reason: 'markers_missing' }, JSON.stringify(out).slice(0, 200))
      assert.ok(!existsSync(join(d, LEGACY_SLUG, 'draft.md')), 'legacy 대조 문장 없이 저장했다')
      assert.equal(readFileSync(q, 'utf8'), before, '실패한 회수가 장부를 바꿨다')
    }],
  ]
}

/**
 * P1-5 — producer 회차 판정. 유일한 DIRECT 원고가 실패해도 OK · exit 0 · handoff OK 였다 (2026-10-24).
 *    실제 runProducerFlow 에 회수 결과(표준 결과 파일 모양)와 디스크 원고를 주고 판정 · handoff 를 본다.
 *    legacy 개별 실패는 기존대로 OK 다. 결과 파일 부재 · 손상 · 이전 회차 파일은 거짓 OK 가 되지 않는다.
 */
const VERDICTS = {}
const handoffMod = await imp(join(ROOT, 'scripts/lib/magazine-handoff.mjs'))
function producerVerdictCases(flow) {
  const fresh = (results = []) => ({ ok: true, body: { writtenAt: new Date(Date.now() + 1).toISOString(), results } })
  const runFlow = async ({ supply, report, startedAt = Date.now(), drafted = [], fetchStatus = 0, fetchSpawned = true }) => {
    const notes = []
    const res = await flow.runProducerFlow({ dryRun: false, deps: {
      log: () => {}, checkLock: () => ({ ok: true }), checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
      checkOutstanding: () => ({ ok: true, message: '없음' }), runPlan: () => ({ status: 0 }), readSupply: () => supply,
      runBrief: () => ({ status: 0 }),
      runFetch: () => (fetchSpawned ? { status: fetchStatus, startedAt, resultFile: '/x/fetch.json', report } : { spawnError: 'ENOENT', status: null }),
      draftExists: (slug) => drafted.includes(slug),
      notify: async (ctx) => { notes.push(ctx); return { ok: true } },
    } })
    return { res, notes }
  }
  const directRun = flow.supplyFromRunJson({ selected: [{ slug: DIRECT_SLUG, directSpec: { specHash: 'sha256:x' } }], reusable: [] })
  const reuseRun = flow.supplyFromRunJson({ selected: [], reusable: [{ slug: DIRECT_SLUG, directSpec: { specHash: 'sha256:x' } }] })
  const legacyRun = flow.supplyFromRunJson({ selected: [{ slug: LEGACY_SLUG }], reusable: [] })
  const mixedRun = flow.supplyFromRunJson({ selected: [{ slug: DIRECT_SLUG, directSpec: { specHash: 'sha256:x' } }, { slug: LEGACY_SLUG }], reusable: [] })
  const partial = (label, r, outcome, slug = null) => {
    VERDICTS[label] = { verdict: r.res.verdict, code: r.res.code }
    assert.deepEqual({ verdict: r.res.verdict, code: r.res.code }, { verdict: 'PARTIAL', code: 3 }, `${label}: ${r.res.reason}`)
    assert.ok(r.res.reason.includes(outcome) && (!slug || r.res.reason.includes(slug)), r.res.reason)
    assert.ok(r.res.fetchResult?.failures?.some((f) => f.outcome === outcome && (!slug || f.slug === slug)), JSON.stringify(r.res.fetchResult))
  }
  return [
    ['P1-5 DIRECT 선정 1 · 원고 0 (brief_missing 실패 행) → PARTIAL(3) · 이유에 slug · handoff 에 남고 등록은 진행', async () => {
      const r = await runFlow({ supply: directRun, report: fresh([{ slug: DIRECT_SLUG, status: 'failed', reason: 'brief_missing', sent: false }]) })
      partial('DIRECT 선정 · 원고 0', r, 'DIRECT_MANUSCRIPT_MISSING', DIRECT_SLUG)
      assert.ok(r.res.reason.includes('brief_missing'), r.res.reason)
      const date = '2026-10-24'
      handoffMod.writeHandoff({ date, verdict: r.res.verdict, code: r.res.code, ran: r.res.ran, repair: r.res.repair, fetch: r.res.fetchResult })
      const h = handoffMod.readHandoff(date)
      assert.deepEqual({ verdict: h.verdict, code: h.code, direct: h.fetch?.direct, f: h.fetch?.failures },
        { verdict: 'PARTIAL', code: 3, direct: { expected: 1, drafted: 0 }, f: [{ slug: DIRECT_SLUG, type: 'DIRECT', outcome: 'DIRECT_MANUSCRIPT_MISSING' }] })
      const j = handoffMod.judgeHandoff({ handoff: h, producerLockHeld: false, waitedMs: 0 })
      assert.deepEqual({ ready: j.ready, code: j.code }, { ready: true, code: 'HANDOFF_OK' }, '등록 단계가 기존 관문대로 진행하지 않는다')
      assert.equal(r.notes.length, 1)
    }],
    ['P1-5 DIRECT 재사용 1 · 원고 0 (DELIVERY_UNCERTAIN HOLD) → PARTIAL(3)', async () => {
      partial('DIRECT 재사용 · HOLD', await runFlow({ supply: reuseRun, report: fresh([{ slug: DIRECT_SLUG, status: 'held', reason: 'DELIVERY_UNCERTAIN_HOLD', sent: false }]) }), 'DIRECT_MANUSCRIPT_MISSING', DIRECT_SLUG)
    }],
    ['P1-5 DIRECT 원고 저장됨 → OK(0)', async () => {
      const r = await runFlow({ supply: directRun, report: fresh([{ slug: DIRECT_SLUG, status: 'ok', sent: true }]), drafted: [DIRECT_SLUG] })
      VERDICTS['DIRECT 원고 저장'] = { verdict: r.res.verdict, code: r.res.code }
      assert.deepEqual({ verdict: r.res.verdict, code: r.res.code, f: r.res.fetchResult?.failures }, { verdict: 'OK', code: 0, f: [] })
      // 🔴 결과 행만 ok 이고 디스크에 원고가 없으면 해결이 아니다 — 등록이 읽는 것은 디스크다
      partial('결과 ok · 디스크 원고 없음', await runFlow({ supply: directRun, report: fresh([{ slug: DIRECT_SLUG, status: 'ok', sent: true }]) }), 'DIRECT_MANUSCRIPT_MISSING', DIRECT_SLUG)
    }],
    ['P1-5 결과 파일 부재 · 손상 → PARTIAL(3) FETCH_RESULT_MISSING (DIRECT 없어도)', async () => {
      partial('결과 부재 · legacy', await runFlow({ supply: legacyRun, report: { ok: false, why: '회수 결과 파일이 없다' } }), 'FETCH_RESULT_MISSING')
      partial('결과 손상 · DIRECT', await runFlow({ supply: directRun, report: { ok: false, why: '회수 결과 파싱 실패' }, drafted: [DIRECT_SLUG] }), 'FETCH_RESULT_MISSING')
      partial('결과 없음(null)', await runFlow({ supply: legacyRun, report: null }), 'FETCH_RESULT_MISSING')
    }],
    ['P1-5 이전 회수가 쓴 결과(writtenAt < 시작) → PARTIAL(3) FETCH_RESULT_STALE', async () => {
      const old = { ok: true, body: { writtenAt: new Date(Date.now() - 3600e3).toISOString(), results: [{ slug: DIRECT_SLUG, status: 'ok' }] } }
      partial('이전 회수 결과', await runFlow({ supply: legacyRun, report: old }), 'FETCH_RESULT_STALE')
    }],
    ['P1-5 legacy 불변 — legacy 개별 실패만 있으면 OK(0) · SYSTEM 아님', async () => {
      const r = await runFlow({ supply: legacyRun, report: fresh([{ slug: LEGACY_SLUG, status: 'failed', reason: 'invalid_manuscript', sent: true }]) })
      VERDICTS['legacy 개별 실패'] = { verdict: r.res.verdict, code: r.res.code }
      assert.deepEqual({ verdict: r.res.verdict, code: r.res.code }, { verdict: 'OK', code: 0 }, r.res.reason)
      const m = await runFlow({ supply: mixedRun, report: fresh([{ slug: DIRECT_SLUG, status: 'ok' }, { slug: LEGACY_SLUG, status: 'failed', reason: 'invalid_manuscript' }]), drafted: [DIRECT_SLUG] })
      assert.deepEqual({ verdict: m.res.verdict, code: m.res.code }, { verdict: 'OK', code: 0 }, m.res.reason)
    }],
    ['P1-5 회수 전역 실패 · 실행 실패는 기존대로 SYSTEM(1)', async () => {
      const a = await runFlow({ supply: directRun, report: fresh([]), fetchStatus: 1 })
      const b = await runFlow({ supply: directRun, report: null, fetchSpawned: false })
      assert.deepEqual([a.res.verdict, a.res.code, b.res.verdict, b.res.code], ['SYSTEM', 1, 'SYSTEM', 1])
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
  ...downgradeCases(real.webui, realRegen), ...reuseReportCases(real.plan),
  ...packetOnlyCases(real.webui), ...repairCases(realRepair, real.webui),
  ...basisDriftCases(real.plan, real.lane, real.webui, realRegen),
  ...briefFreeCases(real.webui), ...recoverCases(real.webui), ...producerVerdictCases(real.flow),
]
for (const [name, fn] of ALL_REAL) {
  try { await fn(); report(true, name) } catch (e) { report(false, name, e.message.split('\n')[0]) }
}
console.log('\n── selected / reusable 별 provider(run.json 회수 대상) · write(spec 바이트 변화) · register(등록 gate 통과 — 원고 전 실제 등록은 registerTargets 가 별도로 막는다)')
for (const [k, v] of Object.entries(COUNTS)) console.log(`  ${k.padEnd(28)} provider ${v.provider} · write ${v.write} · register ${v.register}`)
console.log('\n── 실제 전송 경계 (plan 성공 뒤 source 변경) — probe · Chrome · 예약 · write')
for (const [k, v] of Object.entries(SEND)) console.log(`  ${k.padEnd(28)} probe ${v.probe} · Chrome ${v.chrome} · 예약 ${v.reservation} · write ${v.write}`)
console.log('\n── persisted direct 강등 차단 — 실제 fetchOne(brief.md 있음) · attemptRegeneration')
console.log('\n── 승인 basis drift — selected · reusable · register · send · regen')
for (const [k, v] of Object.entries(BASIS_COUNTS)) console.log(`  ${k.padEnd(20)} ${JSON.stringify(v)}`)
for (const [k, v] of Object.entries(DOWNGRADE)) console.log(`  ${k.padEnd(40)} ${JSON.stringify(v)}`)
console.log('\n── packet-only direct · fetchOne(--regen-packet)')
for (const [k, v] of Object.entries(PACKET_ONLY)) console.log(`  ${k.padEnd(36)} ${JSON.stringify(v)}`)
console.log('\n── brief 없는 DIRECT 회수 · legacy 불변 — 실제 fetchManuscript')
for (const [k, v] of Object.entries(BRIEF_FREE)) console.log(`  ${k.padEnd(36)} ${JSON.stringify(v)}`)
console.log('\n── 무전송 회수(recoverSlug) — DIRECT brief 없음 · legacy 대조 문장')
for (const [k, v] of Object.entries(RECOVER)) console.log(`  ${k.padEnd(36)} ${JSON.stringify(v)}`)
console.log('\n── producer 회차 판정 — DIRECT 원고 · 회수 결과')
for (const [k, v] of Object.entries(VERDICTS)) console.log(`  ${k.padEnd(28)} ${JSON.stringify(v)}`)
console.log('\n── 입력 수리 우회 차단')
for (const [k, v] of Object.entries(REPAIR_COUNTS)) console.log(`  ${k.padEnd(40)} ${JSON.stringify(v)}`)
console.log('\n── report "다음" 절 실제 모양')
for (const [k, v] of Object.entries(NEXT_SHAPES)) console.log(`  [${k}]\n${v.split('\n').map((l) => `    ${l}`).join('\n')}`)
const realPass = pass
const realFail = fail

// ── 변이 ───────────────────────────────────────────────────
const MUTATIONS = [
  ['plan', 'MP1', 'run.json directSpec 신원 제거', '        ...(directReady.has(i.slug) ? { directSpec: directSpecRow(directReady.get(i.slug), directPersisted.get(i.slug)) } : {}),\n', ''],
  ['plan', 'MP2', 'direct 행에 legacy brief 재료를 놓는다', '        if (directReady.has(item.slug)) continue\n', ''],
  ['plan', 'MP3', 'selected direct source 판정 우회', 'if (mode.mode !== DIRECT_SPEC_MODE || ready.has(item.slug)) continue', 'continue'],
  ['plan', 'MP4', 'expected graphVersion 전달 제거', 'return directSourceFn({ queueItem, draftsDir, expectedGraphVersion, repoRoot: REPO_ROOT, productRoot: REPO_ROOT })', 'return directSourceFn({ queueItem, draftsDir, repoRoot: REPO_ROOT, productRoot: REPO_ROOT })'],
  ['plan', 'MP16', 'plan 이 승인 basis 제품 루트를 넘기지 않는다 (P1 call-site)', 'return directSourceFn({ queueItem, draftsDir, expectedGraphVersion, repoRoot: REPO_ROOT, productRoot: REPO_ROOT })', 'return directSourceFn({ queueItem, draftsDir, expectedGraphVersion, repoRoot: REPO_ROOT })'],
  ['plan', 'MP5', 'spec 저장 제거', 'const p = persistSpecFn({ spec: j.spec, draftsDir })', 'const p = { ok: true, written: false }'],
  ['plan', 'MP6', 'NOT_READY HOLD 기록 제거', 'const held = [...gated.identityHeld, ...directHeld]', 'const held = [...gated.identityHeld]'],
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
  ['source', 'MS4', 'G8 manifest 대조 제거', "if (entry.admission?.g8ManifestHash !== queueItem?.g8ManifestHash) blockers.push('MANIFEST_DRIFT')", ''],
  ['source', 'MS5', '필수 필드 검사 제거', "if (evidence.missingFields.length) blockers.push('FIELDS_MISSING')", ''],
  ['source', 'MS6', '기존 spec 을 덮어쓴다', 'if (existsSync(path)) return sameOrConflict()', 'if (existsSync(path)) unlinkSync(path)'],
  ['source', 'MS7', 'STANDARD 검사 제거', "if (!lane.ok || lane.profile !== DIRECT_SPEC_CANARY_PROFILE) blockers.push('PROFILE_NOT_STANDARD')", ''],
  ['source', 'MS8', '운영 fixture 를 제품 코드에서 import', "import { createHash } from 'node:crypto'", "import { createHash } from 'node:crypto'\nimport '../__fixtures__/magazine/direct-spec/canary.input.json' with { type: 'json' }"],
  ['source', 'MS9', 'hero alt·scene 검사 제거', '  if (heroRequired(queueItem?.imageMode)) {', '  if (false) {'],
  ['source', 'MS12', '소비 관문이 OPTIONAL hero 를 요구하지 않는다 (P1)', "  return imageMode === 'REQUIRED' || imageMode === 'OPTIONAL'", "  return imageMode === 'REQUIRED'"],
  ['source', 'MS13', '승인 basis exact-match 제거 (P1)', "      else if (canonicalJson(entry.productBasis) !== canonicalJson(b)) blockers.push('PRODUCT_BASIS_DRIFT')\n", ''],
  ['source', 'MS15', 'control 파싱 예외를 다시 던진다 (P1)', "  try { raw = evalLiteral(literal, 'control.ts') } catch { return null }", "  raw = evalLiteral(literal, 'control.ts')"],
  ['source', 'MS17', 'bundle 구조 검증 제거 (P1 — intents null 이 TypeError 로 번진다)', "  if (!graphBundleShapeOk(graph)) return { ok: false, code: 'GRAPH_BUNDLE_UNREADABLE'", "  if (false) return { ok: false, code: 'GRAPH_BUNDLE_UNREADABLE'"],
  ['source', 'MS16', 'control 필드 형식 검증 제거 (P1)', "  if (typeof enabled !== 'boolean') return null\n  if (!Array.isArray(enabledClusters) || !enabledClusters.every((c) => typeof c === 'string' && c.trim())) return null\n", ''],
  ['source', 'MS14', 'productRoot 없을 때 통과 (P1 fail-closed 제거)', "  if (!productRoot) blockers.push('PRODUCT_BASIS_UNVERIFIED')", '  if (!productRoot) {}'],
  ['source', 'MS10', 'NO_IMAGE hero 금지 검사 제거', "  if (heroForbidden(entry, queueItem)) blockers.push('HERO_FORBIDDEN')\n", ''],
  ['source', 'MS11', '기존 spec 바이트 대조 제거 (재사용 신원)', "  if (existing.state === 'CONFLICT') {", '  if (false) {'],
  ['lane', 'MA1', '등록 gate 의 source 신원 검사 제거 (P0)', 'const v = verifyDirectSpecOnDisk({ slug, queue, draftsDir, expectedGraphVersion: expectedGraphVersionFn(), productRoot: productRootFn() })', "const v = { ok: true, existing: 'IDENTICAL' }"],
  ['lane', 'MA2', '등록 gate 가 승인 basis 제품 루트를 넘기지 않는다 (P1 call-site)', 'expectedGraphVersion: expectedGraphVersionFn(), productRoot: productRootFn() })', 'expectedGraphVersion: expectedGraphVersionFn() })'],
  ['gate', 'MD2', '전송 관문이 승인 basis 제품 루트를 넘기지 않는다 (P1 call-site)', '      productRoot: deps.productRoot?.() ?? null })', '      productRoot: null })'],
  ['gate', 'MD1', '전송 경계의 source 재검증 제거 (P0)', '    const sendable = sourceCheck()\n    if (!sendable.ok) return blocked(sendable)', '    const sendable = { ok: true }'],
  ['gate', 'MG1', 'persisted direct 신원 라우팅 제거 — 큐 삭제·철회 모두 legacy 강등 (P0)', 'if (resolved.mode === DIRECT_SPEC_MODE || persistedDirectIdentity({ slug, draftsDir, packet })) {', 'if (resolved.mode === DIRECT_SPEC_MODE) {'],
  ['gate', 'MG2', '큐 삭제(queueItem=null)만 legacy 강등 (P0)', 'if (resolved.mode === DIRECT_SPEC_MODE || persistedDirectIdentity({ slug, draftsDir, packet })) {', 'if (resolved.mode === DIRECT_SPEC_MODE || (queueItem && persistedDirectIdentity({ slug, draftsDir, packet }))) {'],
  ['gate', 'MG3', 'opt-in 철회만 legacy 강등 (P0)', 'if (resolved.mode === DIRECT_SPEC_MODE || persistedDirectIdentity({ slug, draftsDir, packet })) {', 'if (resolved.mode === DIRECT_SPEC_MODE || (!queueItem && persistedDirectIdentity({ slug, draftsDir, packet }))) {'],
  ['gate', 'MG4', '철회 경로의 정본 큐 선행 판정 제거 (P0)', '      const early = sourceCheck()\n      if (!early.ok) return blocked(early)', '      const early = { ok: true }'],
  ['webui', 'MW4', 'fetchSlug 의 persisted direct 판정 제거 (P0)', '(modeDecision.mode === DIRECT_SPEC_MODE\n    || persistedDirectIdentity({ slug, draftsDir, packet: packetRead?.ok ? packetRead.packet : null }))', '(modeDecision.mode === DIRECT_SPEC_MODE)'],
  ['webui', 'MW5', 'fetchOne 이 source 재검증 주입을 전달하지 않는다 (call-site)', '    draftsDir, browserDeps, accessFn, draftOut, inputRepair, queueItem, directSourceDeps })', '    draftsDir, browserDeps, accessFn, draftOut, inputRepair, queueItem })'],
  ['regen', 'MR1', 'attemptRegeneration 이 source 재검증 주입을 전달하지 않는다 (call-site)', '  const gate = deliveryGate({ slug, draftsDir, packet, quarantinePath, queueItem, directSourceDeps })', '  const gate = deliveryGate({ slug, draftsDir, packet, quarantinePath, queueItem })'],
  ['webui', 'MW6', 'wrapper 가 packet direct 신원을 버린다 (P0-1)', 'persistedDirectIdentity({ slug, draftsDir, packet: packetRead?.ok ? packetRead.packet : null })', 'persistedDirectIdentity({ slug, draftsDir })'],
  ['webui', 'MW7', 'fetchOne 입력 수리가 direct 를 우회해 inputRepairGate 로 간다 (P0-2)', '  if (inputRepair && isDirect) {', '  if (false) {'],
  ['repair', 'MI1', 'scanRepairTargets 의 direct 행 필터 제거 (P0-2)', "    if (!mode.ok || mode.mode !== LEGACY_BRIEF_MODE || persistedDirectIdentity({ slug, draftsDir })) {", '    if (false) {'],
  ['repair', 'MI2', 'scanRepairTargets 가 persisted direct 흔적을 보지 않는다 (P0-2)', "    if (!mode.ok || mode.mode !== LEGACY_BRIEF_MODE || persistedDirectIdentity({ slug, draftsDir })) {", '    if (!mode.ok || mode.mode !== LEGACY_BRIEF_MODE) {'],
  ['plan', 'MP15', 'report 가 reusable direct 를 보지 않는다 (P2)', '[...new Set([...run.selected, ...(run.reusable ?? [])].filter((s) => s?.directSpec).map((s) => s.slug))]', '[...new Set([...run.selected].filter((s) => s?.directSpec).map((s) => s.slug))]'],
  ['webui', 'MW2', 'probe 를 전송 관문 앞으로 당긴다 (P0 순서)', 'WEBUI_PROBE_FIRST', ''],
  ['webui', 'MW3', 'fetchSlug 가 source 재검증 주입을 전달하지 않는다 (call-site)', '    : deliveryGate({ slug, draftsDir, packet, quarantinePath, queueItem, directSourceDeps })', '    : deliveryGate({ slug, draftsDir, packet, quarantinePath, queueItem })'],
  ['notify', 'MN3', '원고 미생성 판정에서 reusable 제외 (P1)', '  const directMissing = [...(run.selected ?? []), ...(run.reusable ?? [])]', '  const directMissing = [...(run.selected ?? [])]'],
  ['plan', 'MP12', '재사용 spec 없음에 새 spec 저장 되살림 (P1)', "        if (j.existing !== 'IDENTICAL') {\n          held.push({ day: item.day, slug: item.slug, code: 'DIRECT_SPEC_MISSING',", "        if (j.existing === 'ABSENT' && !dryRun) persistSpecFn({ spec: j.spec, draftsDir })\n        if (j.existing === 'CONFLICT') {\n          held.push({ day: item.day, slug: item.slug, code: 'DIRECT_SPEC_MISSING',"],
  ['plan', 'MP13', 'direct-only 보고에 일반 brief 안내 되살림 (P2)', '  if (!directSel.length) {\n    L.push(', '  if (true) {\n    L.push('],
  ['plan', 'MP14', 'mixed 보고에서 brief 안내 범위 구분 제거 (P2)', "      L.push(`legacy 선정 ${legacySel.length}건(${legacySel.join(', ')})에만 해당: \\`_runs/${run.date}/selected/{slug}/brief.todo.md\\` 의 TODO 를 채운 뒤`)", "      L.push('세션에서 `_runs/' + run.date + '/selected/*/brief.todo.md` 의 TODO 를 채운 뒤')"],
  ['plan', 'MP17', 'run.json 이 articlePlanHash 를 운반하지 않는다 (PR C)', "        ...(i.articlePlanHash ? { articlePlanHash: i.articlePlanHash } : {}),\n", ''],
  ['notify', 'MN4', 'G8_ROW_NOT_DIRECT 보류를 direct 보류 알림에서 뺀다 (PR C)', "'UNKNOWN_MAGAZINE_AUTO_MODE', 'G8_ROW_NOT_DIRECT', ", "'UNKNOWN_MAGAZINE_AUTO_MODE', "],
  ['plan', 'MQI1', '큐 신원 — slug 중복 검사 제거', 'const duplicated = (item) => (slugs.get(key(item?.slug)) ?? 0) > 1 || (intents.get(key(item?.intentId)) ?? 0) > 1', 'const duplicated = (item) => (intents.get(key(item?.intentId)) ?? 0) > 1'],
  ['plan', 'MQI2', '큐 신원 — intentId 중복 검사 제거', 'const duplicated = (item) => (slugs.get(key(item?.slug)) ?? 0) > 1 || (intents.get(key(item?.intentId)) ?? 0) > 1', 'const duplicated = (item) => (slugs.get(key(item?.slug)) ?? 0) > 1'],
  ['plan', 'MQI3', '큐 신원 — 첫 행만 HOLD 하고 나머지는 통과', '  return { unique: queue.filter((item) => !duplicated(item)), held }', '  const first = queue.findIndex(duplicated)\n  return { unique: queue.filter((item, i) => !duplicated(item) || i !== first), held: held.filter((h) => h.slug === queue[first]?.slug && h.day === queue[first]?.day) }'],
  ['plan', 'MQI4', '큐 신원 — 선정 범위(produceCount)만 보고 뒤쪽 중복을 무시', '  const identity = splitQueueIdentityDuplicates(queue)', '  const identity = ((s) => ({ ...s, unique: [...s.unique, ...queue.slice(produceCount)] }))(splitQueueIdentityDuplicates(queue.slice(0, produceCount)))'],
  ['plan', 'MQI5', '큐 신원 — DIRECT+LEGACY 조합만 막고 LEGACY+LEGACY 허용', 'const duplicated = (item) => (slugs.get(key(item?.slug)) ?? 0) > 1 || (intents.get(key(item?.intentId)) ?? 0) > 1', "const duplicated = (item) => ((slugs.get(key(item?.slug)) ?? 0) > 1 || (intents.get(key(item?.intentId)) ?? 0) > 1) && queue.some((x) => x.directSpecMode === 'DIRECT_SPEC_V1' && (x.slug === item.slug || (key(x.intentId) && x.intentId === item.intentId)))"],
  ['plan', 'MQI6', '큐 신원 — 중복 행을 reusable 후보로 통과시킨다', '    for (const item of reusableRaw) {', '    for (const item of [...reusableRaw, ...queue.filter((q) => gated.identityHeld.some((h) => h.slug === q.slug && h.day === q.day) && draftExists(q.slug))]) {'],
  ['plan', 'MQI7', '큐 신원 — run.held 기록 제거', '    const held = [...gated.identityHeld, ...directHeld]', '    const held = [...directHeld]'],
  ['notify', 'MQI8', '큐 신원 — 운영 알림 제거', '  if (identityAlert) alerts.push(identityAlert)\n', ''],
  ['notify', 'MN1', 'direct 보류 알림 제거 (P1)', '  if (directHold) alerts.push(directHold)\n', ''],
  ['notify', 'MN2', 'direct 행을 legacy brief 누락으로 오보 (P1)', "    const missing = rows.filter((x) => !isDirectRow(x)).map((x) => x.slug)", '    const missing = rows.map((x) => x.slug)'],
  ['session', 'MSE1', 'fetchManuscript 옛 구현 복원 — message 와 무관하게 brief 를 먼저 요구 (P0-3)', "  if (plannedMessage !== null && (typeof plannedMessage !== 'string' || !plannedMessage.trim())) {\n    return { ok: false, reason: 'message_invalid', sent: false, errorDetail: '보낼 message 가 비었거나 문자열이 아니다 (한 글자도 보내지 않았다)' }\n  }\n  if (plannedMessage === null && !existsSync(briefPath)) return { ok: false, reason: 'brief_missing', sent: false }\n", "  if (!existsSync(briefPath)) return { ok: false, reason: 'brief_missing', sent: false }\n"],
  ['session', 'MSE2', '빈·문자열 아닌 message 차단 제거 (P0-3)', "  if (plannedMessage !== null && (typeof plannedMessage !== 'string' || !plannedMessage.trim())) {\n    return { ok: false, reason: 'message_invalid', sent: false, errorDetail: '보낼 message 가 비었거나 문자열이 아니다 (한 글자도 보내지 않았다)' }\n  }\n", ''],
  ['session', 'MSE3', 'message 없는 legacy 의 brief 필수 검사 제거 (P0-3)', "  if (plannedMessage === null && !existsSync(briefPath)) return { ok: false, reason: 'brief_missing', sent: false }\n", ''],
  ['webui', 'MW8', 'recoverSlug 옛 구현 복원 — DIRECT 에서도 brief.md 를 읽는다 (P0-4)', "      requiredMarkers: gate.mode === DIRECT_SPEC_MODE ? [] : markersOf(readFileSync(join(draftsDir, slug, 'brief.md'), 'utf8')),\n", "      requiredMarkers: markersOf(readFileSync(join(draftsDir, slug, 'brief.md'), 'utf8')),\n"],
  ['webui', 'MW9', 'recoverSlug 가 legacy 대조 문장도 버린다 (P0-4)', "      requiredMarkers: gate.mode === DIRECT_SPEC_MODE ? [] : markersOf(readFileSync(join(draftsDir, slug, 'brief.md'), 'utf8')),\n", "      requiredMarkers: [],\n"],
  ['exit', 'MX1', '회수 결과 부재를 문제없음으로 읽는다 (P1-5)', "  if (!body) failures.push({ slug: null, type: 'FETCH_RESULT', outcome: 'FETCH_RESULT_MISSING', reason: report?.why ?? '회수 결과를 읽지 못했다' })\n", "  if (!body) {}\n"],
  ['exit', 'MX2', '이전 회수 결과를 이번 것으로 읽는다 (P1-5)', "  else if (Number.isFinite(startedAt) && !(Date.parse(body.writtenAt ?? '') >= startedAt)) {", "  else if (false) {"],
  ['exit', 'MX3', 'DIRECT 원고 미해결을 PARTIAL 에서 뺀다 (P1-5)', "  if (unresolved.length > 0 || fetchUnresolved.length > 0) {", "  if (unresolved.length > 0) {"],
  ['exit', 'MX4', '결과 행이 ok 면 디스크 원고 없이도 해결로 본다 (P1-5)', "    if (draftExists(slug)) { drafted++; continue }\n", "    if (draftExists(slug) || (fresh?.results ?? []).some((r) => r?.slug === slug && r.status === 'ok')) { drafted++; continue }\n"],
  ['flow', 'MF3', 'flow 가 회수 결과 판정을 연결하지 않는다 (P1-5)', "    fetchResult = summarizeFetchStage({", "    fetchResult = null && summarizeFetchStage({"],
  ['flow', 'MF4', '공급 신호가 재사용 DIRECT 를 빼먹는다 (P1-5)', "    directSlugs: [...(selected ?? []), ...(Array.isArray(j?.reusable) ? j.reusable : [])]", "    directSlugs: [...(selected ?? [])]"],
  ['webui', 'MW1', '회수 계획이 direct 에 "세션이 채워야 한다" 안내 (P1)', "  if (t.queueItem?.directSpecMode === DIRECT_SPEC_MODE) {\n    return t.material?.articleSpec", "  if (false) {\n    return t.material?.articleSpec"],
]
const MS2_SECOND = ["  if (entry.node?.graphVersion !== expectedGraphVersion || entry.admission?.graphVersion !== expectedGraphVersion) blockers.push('GRAPH_VERSION_STALE')\n", '']

console.log('\n── 변이 — 각 변이를 위 반례 중 하나가 잡아야 한다')
for (const [kind, id, label, from, to] of MUTATIONS) {
  let src = ORIGINAL[kind]
  if (id !== 'MW2' && src.split(from).length !== 2) { report(false, `${id} ${label}`, `변이 지점이 ${src.split(from).length - 1}곳이다 — 정확히 1곳이어야 한다 (하네스 결함)`); continue }
  if (id === 'MW2') {
    // probe 블록을 잘라 전송 관문(deliveryGate) 앞으로 옮긴다
    const probeBlock = src.slice(src.indexOf('  if (accessFn) {\n    const p = await accessFn()'), src.indexOf('  // 🔴 관문을 쓰기 직전에 건넨다.'))
    const anchor = '  const gate = inputRepair\n'
    if (!probeBlock.includes('accessFn()') || !src.includes(anchor)) { report(false, `${id} ${label}`, '변이 지점을 찾지 못했다 (하네스 결함)'); continue }
    src = src.replace(probeBlock, '').replace(anchor, probeBlock.replaceAll('gate.messageFingerprint', 'null') + anchor)
  } else src = src.replace(from, to)
  if (id === 'MS2') {
    // 🔴 두 번째 지점도 정확히 하나여야 한다 — 못 찾으면 변이가 반쪽이 되어 검출 결과가 뜻을 잃는다
    if (!src.includes(MS2_SECOND[0])) { report(false, `${id} ${label}`, '두 번째 변이 지점을 찾지 못했다 (하네스 결함)'); continue }
    src = src.replace(MS2_SECOND[0], MS2_SECOND[1])
  }
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
      let regenForGate = null
      if (kind === 'exit') {
        // 🔴 실제 runProducerFlow 가 변이 판정을 쓰게 flow 사본의 import 를 변이 exit 로 돌린다
        companion = join(dirname(PATHS.flow), `.dssc-${id}-${process.pid}-flow.mjs`)
        MUTANTS.push(companion)
        const spec = "'./magazine-producer-exit.mjs'"
        if (ORIGINAL.flow.split(spec).length !== 2) throw new Error('flow 의 producer-exit import 가 정확히 1곳이 아니다')
        writeFileSync(companion, ORIGINAL.flow.replace(spec, `'./${path.split('/').pop()}'`))
      }
      if (kind === 'session') {
        // 🔴 실제 fetchSlug·fetchBatch 가 변이 session 을 쓰게 webui 사본의 import 를 변이 session 으로 돌린다
        companion = join(dirname(PATHS.webui), `.dssc-${id}-${process.pid}-webui.mjs`)
        MUTANTS.push(companion)
        const spec = "'./lib/chatgpt-session.mjs'"
        if (ORIGINAL.webui.split(spec).length !== 2) throw new Error('webui 의 chatgpt-session import 가 정확히 1곳이 아니다')
        writeFileSync(companion, ORIGINAL.webui.replace(spec, `'./lib/${path.split('/').pop()}'`))
      }
      if (kind === 'gate') {
        // 🔴 실제 fetchSlug·fetchOne·attemptRegeneration 이 변이 관문을 쓰게 사본의 import 를 변이 관문으로 돌린다
        companion = join(dirname(PATHS.webui), `.dssc-${id}-${process.pid}-webui.mjs`)
        const regenCompanion = join(dirname(PATHS.regen), `.dssc-${id}-${process.pid}-regen.mjs`)
        MUTANTS.push(companion, regenCompanion)
        writeFileSync(companion, ORIGINAL.webui.replaceAll("'./lib/magazine-delivery-gate.mjs'", `'./lib/${path.split('/').pop()}'`))
        writeFileSync(regenCompanion, ORIGINAL.regen.replaceAll("'./magazine-delivery-gate.mjs'", `'./${path.split('/').pop()}'`))
        regenForGate = await imp(regenCompanion)
        unlinkSync(regenCompanion)
      }
      const webuiForGate = companion ? await imp(companion) : null
      if (companion) unlinkSync(companion)
      const cases = kind === 'gate' ? [...sendCases(webuiForGate, mod), ...downgradeCases(webuiForGate, regenForGate), ...packetOnlyCases(webuiForGate), ...basisDriftCases(real.plan, real.lane, webuiForGate, regenForGate)]
        : kind === 'session' ? briefFreeCases(webuiForGate, mod)
        : kind === 'exit' ? producerVerdictCases(webuiForGate)
        : kind === 'regen' ? downgradeCases(real.webui, mod)
        : kind === 'repair' ? repairCases(mod, real.webui)
        : kind === 'plan' ? [...planCases(mod), ...reportCases(mod), ...reuseReportCases(mod)]
        : kind === 'brief' ? [...briefCases(mod), ...await flowCases(real.flow, real.plan, mod)]
          : kind === 'flow' ? [...await flowCases(mod, real.plan, real.brief), ...producerVerdictCases(mod)]
            : kind === 'lane' ? [...laneCases(mod), ...reuseCases(real.plan, mod), ...basisDriftCases(real.plan, mod, real.webui, realRegen)]
              : kind === 'notify' ? notifyCases(mod, real.webui)
                : kind === 'webui' ? [...notifyCases(real.notify, mod), ...sendCases(mod), ...downgradeCases(mod, realRegen), ...packetOnlyCases(mod), ...repairCases(realRepair, mod), ...briefFreeCases(mod), ...recoverCases(mod)]
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

/**
 * 🔴 **부속 검사 — source 작성(prepare · approve)** (2026-10-15).
 *    승인 artifact 를 만드는 상류 절차의 반례·변이를 같은 CI 경로에서 돌린다.
 *    두 부속 검사의 성공을 pass 에 **각각** 센다 — 이 블록이 통째로 사라지면 합계가 줄어 상위 검사
 *    (magazine-auto-register-check 의 exact 합계 · 두 요약 표식)가 실패한다.
 */
{
  const { spawnSync } = await import('node:child_process')
  for (const [file, marker] of [
    ['scripts/magazine-direct-spec-source-authoring-check.mjs', /DIRECT_SPEC source 작성 검사: \d+ pass, 0 fail/],
    ['scripts/magazine-direct-spec-source-authoring-mutation.mjs', /DIRECT_SPEC source 작성 변이: \d+ pass, 0 fail/],
  ]) {
    const r = spawnSync(process.execPath, [join(ROOT, file)], { encoding: 'utf8', maxBuffer: 1e8, env: process.env })
    const ok = r.status === 0 && marker.test(r.stdout)
    const summary = (r.stdout.match(/DIRECT_SPEC source 작성 (?:검사|변이): .*$/m) ?? ['요약 없음'])[0]
    console.log(`${ok ? 'PASS' : 'FAIL'} 부속 ${file} — ${summary}`)
    if (ok) pass++
    else fail++
  }
}

console.log(`\nDIRECT_SPEC source 관문: ${pass} pass, ${fail} fail (실제 반례 ${realPass} pass · ${realFail} fail)`)
process.exit(fail === 0 ? 0 : 1)
