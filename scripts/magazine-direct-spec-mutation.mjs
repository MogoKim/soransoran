#!/usr/bin/env node
/**
 * `DIRECT_SPEC_V1` adapter · delivery-gate wiring 변이 — 변이가 통과하면 상위 검사가 FAIL 해야 한다.
 *
 * 🔴 각 변이는 소스를 string 으로 복제한 뒤 좁은 regex 치환 하나로 결함을 심는다.
 *    변이본은 변이가 가리키는 파일 **옆**에 임시 저장돼 상대 import 가 그대로 돈다.
 *    dynamic import 뒤 즉시 지운다. 저장소 다른 파일은 바뀌지 않는다. 네트워크 0 · ChatGPT 0.
 *
 * 변이:
 *   M1  (adapter) persist 제거 — `compileAndPersistDirectSpec` 가 디스크에 쓰지 않는다
 *       catch: `directSpecMessageFor` 가 DIRECT_SPEC_MISSING 으로 fail-closed 해야 한다
 *   M2  (adapter) spec verify 제거 — `readDirectSpec` 가 verifyArticleSpec 결과를 믿지 않는다
 *       catch: 손상된 spec 이 fail-closed 되지 않는다 (ARTICLE_SPEC_HASH)
 *   M3  (adapter) 모르는-mode 차단 제거 — `resolveMagazineAutoMode` 가 unknown 을 legacy 로 묻는다
 *       catch: unknown mode 가 ok:false 가 아니다 → legacy provider 로 샐 수 있다
 *   M4  (adapter) identity 운반 제거 — `directSpecRegenPacket` instruction 에서 specHash 라인이 빠진다
 *       catch: QA 재생성이 identity 를 운반하지 않는다
 *   M5  (adapter) 재실행 중복 호출 — `registerDirectSpecSidecar` 가 멱등 가드를 지웠다
 *       catch: 두 번째 호출이 written=true 로 돌아와 identity 가 두 번 적힌다
 *   M6  (delivery-gate) direct wiring 제거 — `deliveryGate` 의 direct 분기가 사라졌다
 *       catch: DIRECT_SPEC_V1 queueItem 도 legacy 경로를 지나 brief.md 를 읽는다 (specHash 운반 끊김)
 *   M7  (adapter) sidecar 전체 신원 대조 제거 — 같은 specHash 면 다른 graphNodeId 도 멱등으로 인정한다
 *       catch: 기존 등록 영수증의 graph/spec 신원이 달라지면 fail-closed 해야 한다
 *
 *   T1~T10 (2026-10-19 · 원고 제목 = spec 제목) — 최초 원고 대조 제거 · 재생성 후보 대조 우회 · 정규화 완화 ·
 *       항상 통과 · 최초/재생성 prompt 불변 문구 제거 · mismatch 코드 덮어쓰기 · 형식 재생성 뒤로 이동 ·
 *       mismatch 에도 형식 재생성 허용. 지점은 `patchOnce` 로 정확히 1곳이다.
 *       auto-register 변이는 drive 를 provider·Chrome 0 으로 태운다 (재생성·교체·등록은 주입 함수가 센다).
 *
 * 🔴 task 가 요구한 세 변이 — **wiring 제거(M6) · unknown-mode 차단 제거(M3) · verify 제거(M2)** —
 *    는 모두 regression 를 catch 한다. 그 밖의 변이(M1·M4·M5·M7)는 adapter 의 결정론·identity·멱등을 추가로 지킨다.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const ADAPTER_PATH = join(ROOT, 'scripts/lib/magazine-direct-spec.mjs')
const DELIVERY_GATE_PATH = join(ROOT, 'scripts/lib/magazine-delivery-gate.mjs')
const AUTO_REGISTER_PATH = join(ROOT, 'scripts/magazine-auto-register.mjs')
const FIXTURE_INPUT = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')

const ADAPTER_ORIGINAL = readFileSync(ADAPTER_PATH, 'utf8')
const DELIVERY_GATE_ORIGINAL = readFileSync(DELIVERY_GATE_PATH, 'utf8')
const AUTO_REGISTER_ORIGINAL = readFileSync(AUTO_REGISTER_PATH, 'utf8')
const TARGETS = {
  adapter: { path: ADAPTER_PATH, original: ADAPTER_ORIGINAL, base: 'magazine-direct-spec' },
  deliveryGate: { path: DELIVERY_GATE_PATH, original: DELIVERY_GATE_ORIGINAL, base: 'magazine-delivery-gate' },
  autoRegister: { path: AUTO_REGISTER_PATH, original: AUTO_REGISTER_ORIGINAL, base: 'magazine-auto-register' },
}
/**
 * 🔴 문자열 지점 정확히 1곳 치환 (2026-10-19 · 제목 관문 변이). 0곳·여러 곳이면 throw —
 *    지점이 사라진 변이를 "검출" 로 세지 않는다 (mutate 가 FAIL 로 센다).
 */
function patchOnce(from, to) {
  return (src) => {
    const n = src.split(from).length - 1
    if (n !== 1) throw new Error(`변이 지점이 ${n}곳이다 (정확히 1곳이어야 한다): ${from.slice(0, 80)}`)
    return src.replace(from, () => to)
  }
}
function replaceAfter(source, marker, pattern, replacement) {
  const at = source.indexOf(marker)
  if (at === -1) return source
  return source.slice(0, at) + source.slice(at).replace(pattern, replacement)
}
function loadFixture() { return JSON.parse(readFileSync(FIXTURE_INPUT, 'utf8')) }
const TMPS = []
function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`))
  TMPS.push(d); return d
}
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

/**
 * 변이본은 **원본 파일 옆**에 저장한다 — 상대 import (`./magazine-article-spec.mjs` 등) 가 그대로 돈다.
 * target: 'adapter' | 'deliveryGate' | 'autoRegister'
 */
async function withMutant(id, target, patch, assertion) {
  const t = TARGETS[target]
  if (!t) throw new Error(`${id}: 모르는 변이 대상 ${target}`)
  const sourcePath = t.path
  const original = t.original
  const patched = patch(original)
  if (patched === original) throw new Error(`${id}: 패치가 ${target} 소스를 바꾸지 못했다 — anchor 가 틀렸다`)
  const baseName = t.base
  const mutantPath = join(dirname(sourcePath), `.${baseName}.__mutant.${id}.mjs`)
  writeFileSync(mutantPath, patched, 'utf8')
  try {
    const mod = await import(pathToFileURL(mutantPath).href + `?t=${Date.now()}`)
    await assertion(mod)
  } finally {
    try { unlinkSync(mutantPath) } catch { /* best effort */ }
  }
}

let pass = 0, fail = 0
async function mutate(id, label, target, patch, assertion) {
  try { await withMutant(id, target, patch, assertion); pass++; console.log(`PASS ${id} ${label}`) }
  catch (e) { fail++; console.error(`FAIL ${id} ${label}: ${e?.stack ?? e}`) }
}

// Baseline — 원본 adapter · delivery-gate 가 각 반례를 **catch 한다** 는 것부터 확인한다.
// 변이 테스트는 "변이가 통과하면 catch 가 깨진다" 를 보여 주지만, 그 전에 **원본은 catch 한다** 를 못 보이면
// 변이가 catch 됐다는 말에 의미가 없다. — "변이 하네스가 운영 코드를 실제로 태운다" (가짜 fixture ≠ 운영) 보증.
import * as adapter from './lib/magazine-direct-spec.mjs'
import { ARTICLE_SPEC_FILENAME, ARTICLE_SPEC_REGISTER_LEDGER, DIRECT_SPEC_MODE, DIRECT_SPEC_OPT_IN_FIELD, LEGACY_BRIEF_MODE, UNKNOWN_MAGAZINE_AUTO_MODE } from './lib/magazine-direct-spec.mjs'
import { deliveryGate } from './lib/magazine-delivery-gate.mjs'
import { saveQuarantine } from './lib/magazine-quarantine.mjs'
import { ARTICLE_SPEC_SCHEMA } from './lib/magazine-article-spec.mjs'
import { mkdirSync as _mkdirSync, existsSync } from 'node:fs'
import { drive } from './magazine-auto-register.mjs'
import {
  ARTICLE_PLAN_OPTIONAL, ARTICLE_PLAN_REQUIRED, DIRECT_SPEC_SOURCE_SCHEMA, directSpecSourceHash, directSpecSourcePath, productBasisFor, queueRowFromEntry,
  readProductGraphState, readProductGraphVersion,
} from './lib/magazine-direct-spec-source.mjs'

/** direct · legacy 공용 sandbox — article-spec.json 과 brief.md 를 같이 둔다.
 *    🔴 legacy brief.md 는 adapter 조립 brief 에서 **specHash 라인을 뺀** 글자다. 그래야 변이가
 *       direct 경로를 지웠을 때 legacy 가 specHash 를 "의도치 않게" 운반해 catch 가 깨지는 일이 없다. */
function makeSandbox(prefix) {
  const input = loadFixture()
  // 🔴 전송 관문은 현재 제품 판 basis 를 다시 맞춘다 — fixture 를 현재 graphVersion 에 둔다
  input.node.graphVersion = readProductGraphVersion(join(ROOT, 'src/content/magazine/graph/current.ts'))
  const d = tmp(prefix)
  const persisted = adapter.compileAndPersistDirectSpec({ input, draftsDir: d })
  const slug = persisted.spec.identity.slug
  _mkdirSync(join(d, slug), { recursive: true })
  const legacyBrief = adapter.directSpecBriefText(persisted.spec)
    .split('\n')
    .filter((line) => !line.includes('specHash'))
    .join('\n')
  writeFileSync(join(d, slug, 'brief.md'), legacyBrief, 'utf8')
  const quarantinePath = join(d, 'quarantine.json')
  saveQuarantine({}, quarantinePath)
  // 🔴 전송 경계는 정본 큐 행 + 현재 승인 source 로 다시 검증한다 — 시험 판·큐·승인 source 를 놓는다
  const gv = input.node.graphVersion
  const productBasis = productBasisFor(readProductGraphState(ROOT), { intentId: input.node.intentId, queueCluster: input.queueItem.cluster })
  const entry = { status: 'APPROVED', approvedBy: 'mutation', approvedAt: '2026-10-15T12:00:00+09:00',
    // source/2 — 연구 G8 receipt 신원 · 승인 plan(= fixture 큐 행의 plan 필드)
    admission: { g8ManifestHash: input.queueItem.g8ManifestHash, receiptHash: 'mutation-receipt', graphVersion: gv, readinessHash: 'mutation-readiness' },
    plan: Object.fromEntries([...ARTICLE_PLAN_REQUIRED, ...ARTICLE_PLAN_OPTIONAL].filter((k) => input.queueItem[k] !== undefined).map((k) => [k, input.queueItem[k]])),
    node: input.node, relations: input.relations,
    hero: input.hero, publication: input.publication, productBasis }
  entry.sourceHash = directSpecSourceHash(entry)
  // 🔴 DIRECT 큐 행은 승인 entry 의 복제다(materialize 와 같은 함수) — compile 입력 필드는 fixture 그대로다
  input.queueItem = queueRowFromEntry(entry, { day: input.queueItem.day })
  const sp = directSpecSourcePath(d, gv)
  _mkdirSync(dirname(sp), { recursive: true })
  writeFileSync(sp, JSON.stringify({ schema: DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: gv, entries: [entry] }))
  const directSourceDeps = { queue: () => [input.queueItem], expectedGraphVersion: () => gv, productRoot: () => ROOT }
  return { input, draftsDir: d, slug, specHash: persisted.specHash, quarantinePath, directSourceDeps }
}

// ── 제목 관문 drive sandbox (2026-10-19) ──────────────────────
/** frontmatter title 만 바꿔 끼우는 시험 원고 */
function titledManuscript(title, body = '잠들기 전 내일 할 일을 짧게 적고 휴대전화를 멀리 두어 보세요.') {
  return ['---', `title: ${title}`,
    'description: 잠들기 전 반복되는 생각을 줄이고 편안한 밤 루틴을 만드는 방법을 살펴봅니다.',
    'cluster: sleep', 'medical: false', '---', '',
    '하루를 마치고 불을 끈 뒤에도 생각이 이어지는 밤이 있습니다.', '',
    '## 오늘 밤에 할 수 있는 일', '', body, '',
    '[CTA] /community/free | 밤 이야기를 나눠요 | 오늘 밤 떠오른 생각을 남겨 주세요', ''].join('\n')
}
const WRONG_TITLE = '잠 못 든 다음 날, 무엇부터 할까요'
/**
 * auto-register drive 를 provider·Chrome 0 으로 태운다. `draftTitle` 이 없으면 원고 제목 = spec 제목.
 * `qaFailsFirst` 만큼 QA 가 FAIL 한 뒤 통과하고, 재생성 후보는 `candidate` 글자다.
 */
function titleDriveSandbox(prefix, { draftTitle = null, draftText = null, qaFailsFirst = 0, candidate = null } = {}) {
  const sb = makeSandbox(prefix)
  const spec = adapter.readDirectSpec({ slug: sb.slug, draftsDir: sb.draftsDir }).spec
  const dir = join(sb.draftsDir, sb.slug)
  writeFileSync(join(dir, 'draft.md'), draftText ?? titledManuscript(draftTitle ?? spec.identity.title), 'utf8')
  writeFileSync(join(dir, 'article-draft.ts'), 'export const article = {}\n', 'utf8')
  const calls = { regen: 0, apply: 0, register: 0 }
  let qaRuns = 0
  const deps = {
    draftsDir: sb.draftsDir, quarantinePath: sb.quarantinePath,
    loadQueue: () => [sb.input.queueItem], queueItem: sb.input.queueItem,
    progress: () => ({ hasDraftMd: true }), heroFilePath: () => join(sb.draftsDir, 'hero.webp'),
    now: Date.parse('2026-10-15T03:00:00Z'), firstFetchResult: null, candidateDir: sb.draftsDir,
    run: (cmd) => {
      const name = String(cmd).split('/').pop()
      if (name === 'magazine-batch-qa.mjs') return { code: 0, json: { results: [{ slug: sb.slug, verdict: 'READY_TO_SCHEDULE', checks: { heroOk: true }, blockedBy: [] }] } }
      if (name === 'magazine-register.mjs') { calls.register += 1; return { code: 0, json: { verdict: 'READY' } } }
      if (name === 'magazine-qa.mjs' && ++qaRuns <= qaFailsFirst) return { code: 1, stdout: '  ✗ FAIL [본문] 본문 1100자 — 허용 1200~3000자 밖\n', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    },
    attemptRegeneration: ({ runner }) => { calls.regen += 1; runner({}); return { ok: true, regenCalls: calls.regen } },
    regenRunner: ({ draftOut }) => { writeFileSync(draftOut, candidate ?? '', 'utf8'); return { ok: true } },
    applyRegenCandidate: ({ candidatePath, draftMd }) => {
      calls.apply += 1
      writeFileSync(draftMd, readFileSync(candidatePath, 'utf8'), 'utf8')
      return { ok: true, heroCarried: false }
    },
  }
  const receipt = join(dir, ARTICLE_SPEC_REGISTER_LEDGER)
  return { ...sb, spec, dir, deps, calls, receipt }
}
const DRIVE_OPTS = { write: true, publishAt: '2026-10-22', autoLane: true }
/** 제목도 다르고 CTA 도 없는 원고 — 제목 mismatch 가 형식 재생성보다 먼저 막아야 한다 */
const WRONG_TITLE_NO_CTA = titledManuscript(WRONG_TITLE).split('\n').filter((l) => !l.startsWith('[CTA]')).join('\n')
/** 최초 원고 제목 대조 블록 (변이 지점) */
const INITIAL_TITLE_GATE = "  if (isDirectMode) {\n    const t = directSpecTitleCheck({ spec: directSpec, manuscript: readFileSync(p.draftMd, 'utf8') })\n    if (!t.ok) return stop('article', t.code, t.why, { expectedTitle: t.expected, actualTitle: t.actual })\n  }\n"
/** 형식 재생성 루프의 끝 (T8 이 제목 대조를 옮겨 놓는 자리) */
const FORMAT_LOOP_END = "      fmt = judgeManuscriptFormat(readFileSync(p.draftMd, 'utf8'))\n    }\n  }\n"

async function baseline() {
  console.log('\n── baseline (원본 adapter 는 반례를 catch 한다) ──')

  // B1 (M1 짝): compile 생략 상태 (persist 안 함) — 디스크 비어 있으므로 messageFor FAIL
  {
    const d = tmp('ds-base-b1')
    const r = adapter.directSpecMessageFor({ slug: 'canary-direct-spec-01', draftsDir: d })
    assert.equal(r.ok, false, 'B1 원본은 spec 없음을 catch 해야 한다')
    assert.equal(r.code, 'DIRECT_SPEC_MISSING')
    pass++; console.log('PASS B1 compile 생략 상태 — DIRECT_SPEC_MISSING')
  }

  // B2 (M2 짝): verify — 손상 spec 을 쓰면 ARTICLE_SPEC_HASH 로 FAIL
  {
    const d = tmp('ds-base-b2')
    const input = loadFixture()
    const p = adapter.compileAndPersistDirectSpec({ input, draftsDir: d })
    const specPath = join(d, p.spec.identity.slug, ARTICLE_SPEC_FILENAME)
    const spec = JSON.parse(readFileSync(specPath, 'utf8'))
    spec.editorial.outline[0] = '손상된 outline'
    writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n', 'utf8')
    const r = adapter.readDirectSpec({ slug: p.spec.identity.slug, draftsDir: d })
    assert.equal(r.ok, false, 'B2 원본은 손상 spec 을 catch 해야 한다')
    assert.equal(r.code, 'ARTICLE_SPEC_HASH')
    pass++; console.log('PASS B2 손상 spec — ARTICLE_SPEC_HASH')
  }

  // B3 (M3 짝): 모르는 directSpecMode 는 **ok:false** — legacy provider 로도 보내지 않는다
  {
    const r1 = adapter.resolveMagazineAutoMode({ slug: 'none' })
    assert.equal(r1.ok, true)
    assert.equal(r1.mode, adapter.LEGACY_BRIEF_MODE, 'B3 opt-in 없음 → legacy (ok:true)')
    const r2 = adapter.resolveMagazineAutoMode({ [DIRECT_SPEC_OPT_IN_FIELD]: 'DIRECT_SPEC_V2' })
    assert.equal(r2.ok, false, 'B3 원본은 모르는 mode 를 ok:false 로 돌려줘야 한다')
    assert.equal(r2.code, UNKNOWN_MAGAZINE_AUTO_MODE)
    pass++; console.log('PASS B3 unknown mode → ok:false (fail-closed)')
  }

  // B4 (M4 짝): regen 패킷 instruction 에 specHash 가 글자로 들어간다
  {
    const d = tmp('ds-base-b4')
    const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
    const pkt = adapter.directSpecRegenPacket({ spec: p.spec, failures: [{ code: 'B4', label: 't' }] })
    assert.ok(pkt.instruction.includes(p.specHash), 'B4 원본은 instruction 에 specHash 를 적어야 한다')
    pass++; console.log('PASS B4 regen 패킷에 specHash 운반')
  }

  // B5 (M5 짝): 같은 specHash 두 번 → written=false (멱등)
  {
    const d = tmp('ds-base-b5')
    const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
    const r1 = adapter.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
    const r2 = adapter.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
    assert.equal(r1.written, true)
    assert.equal(r2.written, false, 'B5 원본은 멱등해야 한다')
    pass++; console.log('PASS B5 register 멱등')
  }

  // B6 (M6 짝): direct wiring 이 deliveryGate 에서 실제로 돈다 — direct message 가 specHash 를 운반
  {
    const { draftsDir, slug, specHash, quarantinePath, directSourceDeps } = makeSandbox('ds-base-b6')
    const g = deliveryGate({ slug, draftsDir, quarantinePath, directSourceDeps,
      queueItem: { [DIRECT_SPEC_OPT_IN_FIELD]: DIRECT_SPEC_MODE } })
    assert.equal(g.ok, true, 'B6 원본은 direct wiring 을 통과시켜야 한다')
    assert.equal(g.mode, DIRECT_SPEC_MODE)
    assert.equal(g.specHash, specHash)
    assert.ok(g.message.includes(specHash), 'B6 원본은 message 에 specHash 를 넣어야 한다')
    assert.ok(g.message.includes(ARTICLE_SPEC_SCHEMA))
    pass++; console.log('PASS B6 direct wiring 이 deliveryGate 를 지난다 (specHash 운반)')
  }

  // B7 compileAndPersistDirectSpec 는 verify 실패를 catch 한다 — 쓰기 전 throw
  {
    const d = tmp('ds-base-b7')
    const input = loadFixture()
    input.node.status = 'DRAFT' // APPROVED 가 아니다 — verify 실패
    let threw = null
    try { adapter.compileAndPersistDirectSpec({ input, draftsDir: d }) }
    catch (e) { threw = e }
    assert.ok(threw, 'B7 원본은 verify 실패를 throw 해야 한다')
    assert.equal(threw.code, 'ARTICLE_SPEC_NODE_NOT_APPROVED')
    pass++; console.log('PASS B7 compileAndPersistDirectSpec 가 verify 실패를 catch 한다')
  }

  // B8 (M7 짝): 같은 specHash 여도 graph/spec 신원이 다르면 멱등으로 인정하지 않는다
  {
    const d = tmp('ds-base-b8')
    const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
    adapter.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
    const receiptPath = join(d, p.spec.identity.slug, ARTICLE_SPEC_REGISTER_LEDGER)
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    receipt.graphNodeId = 'wrong-graph-node'
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8')
    assert.throws(
      () => adapter.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' }),
      (e) => e.code === 'DIRECT_SPEC_REGISTER_IDENTITY',
      'B8 원본은 같은 specHash 의 다른 graphNodeId 를 catch 해야 한다',
    )
    pass++; console.log('PASS B8 sidecar 전체 identity 대조')
  }

  // B9 (T1·T3·T4 짝): 최초 원고 제목이 다르면 DIRECT_SPEC_TITLE_MISMATCH — 등록·영수증 0
  {
    const s = titleDriveSandbox('ds-base-b9', { draftTitle: WRONG_TITLE })
    const r = drive(s.slug, DRIVE_OPTS, s.deps)
    assert.equal(r.blockedBy?.[0]?.code, adapter.DIRECT_SPEC_TITLE_MISMATCH, 'B9 원본은 최초 원고 제목 drift 를 막아야 한다')
    assert.equal(s.calls.register, 0)
    assert.equal(existsSync(s.receipt), false)
    pass++; console.log('PASS B9 최초 원고 제목 drift — DIRECT_SPEC_TITLE_MISMATCH · 등록 0')
  }

  // B10 (T2·T7 짝): 재생성 후보가 제목을 바꾸면 교체 0 · 코드 그대로
  {
    const s = titleDriveSandbox('ds-base-b10', { qaFailsFirst: 1, candidate: titledManuscript(WRONG_TITLE, '본문만 바뀌어야 하는데 제목도 바뀌었다.') })
    const r = drive(s.slug, DRIVE_OPTS, s.deps)
    assert.equal(r.blockedBy?.[0]?.code, adapter.DIRECT_SPEC_TITLE_MISMATCH, 'B10 원본은 재생성 후보의 제목 drift 를 막아야 한다')
    assert.equal(s.calls.apply, 0)
    assert.equal(s.calls.register, 0)
    pass++; console.log('PASS B10 재생성 후보 제목 drift — 교체 0 · 등록 0')
  }

  // B11 (짝 없음 — 정상 경로): 제목이 같은 재생성은 교체되고 등록까지 간다
  {
    const s0 = titleDriveSandbox('ds-base-b11-probe')
    const s = titleDriveSandbox('ds-base-b11', { qaFailsFirst: 1, candidate: titledManuscript(s0.spec.identity.title, '본문만 고쳤다. 제목은 그대로다.') })
    const r = drive(s.slug, DRIVE_OPTS, s.deps)
    assert.equal(r.verdict, 'DONE', JSON.stringify(r.blockedBy))
    assert.equal(s.calls.apply, 1)
    pass++; console.log('PASS B11 제목이 같은 재생성 — 교체 · 등록')
  }

  // B13 (T8·T9·T10 짝): 제목도 다르고 형식도 틀린 원고 — 형식 재생성(provider) 0 으로 제목 mismatch
  {
    const s = titleDriveSandbox('ds-base-b13', { draftText: WRONG_TITLE_NO_CTA, candidate: titledManuscript(WRONG_TITLE) })
    const r = drive(s.slug, DRIVE_OPTS, s.deps)
    assert.equal(r.blockedBy?.[0]?.code, adapter.DIRECT_SPEC_TITLE_MISMATCH, 'B13 원본은 제목 mismatch 로 먼저 막아야 한다')
    assert.equal(s.calls.regen, 0, 'B13 원본은 형식 재생성을 걸지 않아야 한다')
    assert.equal(s.calls.apply, 0)
    pass++; console.log('PASS B13 제목+형식 위반 — 형식 재생성 0 · 제목 mismatch')
  }

  // B12 (T5·T6 짝): 최초·재생성 prompt 에 제목 불변 문구
  {
    const { draftsDir, slug } = makeSandbox('ds-base-b12')
    const spec = adapter.readDirectSpec({ slug, draftsDir }).spec
    assert.ok(adapter.directSpecMessageFor({ slug, draftsDir }).message.includes(adapter.DIRECT_SPEC_TITLE_LOCK_LINE))
    assert.ok(adapter.directSpecRegenPromptText({ spec, packet: { instruction: 'x' } }).includes(adapter.DIRECT_SPEC_TITLE_LOCK_LINE))
    pass++; console.log('PASS B12 최초·재생성 prompt 제목 불변 문구')
  }
}

// ── 변이 ─────────────────────────────────────────────────
console.log('\n── 변이 (변이가 통과하면 adapter 검사가 catch 한다) ──')

async function runMutations() {
  // M1 compileAndPersistDirectSpec 안의 `atomicWriteJson(specPath, compiled)` 를 지운다
  await mutate('M1', 'persist 제거 — compile 뒤 디스크에 쓰지 않는다', 'adapter',
    (src) => src.replace(/\n(\s*)atomicWriteJson\(specPath, compiled\)\n/,
      "\n$1// mutant M1: persist 생략\n"),
    async (mod) => {
      const d = tmp('ds-m1')
      const p = mod.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
      assert.equal(p.specHash.startsWith('sha256:'), true, 'compile 자체는 돈다')
      const m = mod.directSpecMessageFor({ slug: p.spec.identity.slug, draftsDir: d })
      assert.equal(m.ok, false, 'M1 catch — messageFor 는 spec 없음을 fail-closed 로 돌려줘야 한다')
      assert.equal(m.code, 'DIRECT_SPEC_MISSING')
    })

  // M2 readDirectSpec 안의 verifyArticleSpec 호출 자리를 "그냥 ok" 로 바꾼다
  await mutate('M2', 'spec verify 제거 — readDirectSpec 가 verify 결과를 믿지 않는다', 'adapter',
    (src) => src.replace(
      /const v = verifyArticleSpec\(parsed\)\n\s*if \(!v\.ok\) return \{ ok: false, code: v\.code, why: v\.why \}/,
      'const v = { ok: true } // mutant M2: verify skip'),
    async (mod) => {
      const d = tmp('ds-m2')
      const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
      const specPath = join(d, p.spec.identity.slug, ARTICLE_SPEC_FILENAME)
      const spec = JSON.parse(readFileSync(specPath, 'utf8'))
      spec.editorial.outline[0] = '손상된 outline'
      writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n', 'utf8')
      const r = mod.readDirectSpec({ slug: p.spec.identity.slug, draftsDir: d })
      assert.equal(r.ok, true, 'M2 변이본은 손상을 통과시킨다')
      const m = mod.directSpecMessageFor({ slug: p.spec.identity.slug, draftsDir: d })
      assert.equal(m.ok, true, 'M2 변이본은 손상 spec 으로 message 를 조립한다 — 변이 성공')
      assert.ok(m.message.includes('손상된 outline'), 'M2 catch — 변이가 통과하면 손상 글자가 provider 로 흘러간다')
    })

  // M3 resolveMagazineAutoMode 의 **모르는-mode 차단 블록**을 제거해 legacy 로 묻어 넘긴다
  await mutate('M3', 'unknown-mode 차단 제거 — resolveMagazineAutoMode 가 모름을 legacy 로 묻는다', 'adapter',
    (src) => src.replace(
      /\n  return \{\n    ok: false,\n    mode: null,\n    code: UNKNOWN_MAGAZINE_AUTO_MODE,\n    why: `모르는 directSpecMode[\s\S]*?`,\n  \}\n/,
      "\n  // mutant M3: unknown-mode 차단 제거 — legacy 로 묻어 넘긴다\n  return { ok: true, mode: LEGACY_BRIEF_MODE, reason: 'mutant M3: unknown → legacy fallback' }\n"),
    async (mod) => {
      // 명시 LEGACY · 명시 DIRECT 는 그대로 돈다
      const rLegacy = mod.resolveMagazineAutoMode({ slug: 'none' })
      assert.equal(rLegacy.ok, true)
      assert.equal(rLegacy.mode, mod.LEGACY_BRIEF_MODE)
      const rDirect = mod.resolveMagazineAutoMode({ [mod.DIRECT_SPEC_OPT_IN_FIELD]: mod.DIRECT_SPEC_MODE })
      assert.equal(rDirect.mode, mod.DIRECT_SPEC_MODE)
      // 모르는 mode — 변이본은 legacy 로 묻는다 (ok:true · code 없음) · 원본은 ok:false · code:UNKNOWN_MAGAZINE_AUTO_MODE
      const rUnknown = mod.resolveMagazineAutoMode({ [mod.DIRECT_SPEC_OPT_IN_FIELD]: 'DIRECT_SPEC_V2' })
      assert.equal(rUnknown.ok, true,
        'M3 catch — 변이본은 모르는 mode 를 ok:true 로 묻는다 (bounded rollback 계약 깨짐: legacy provider 로 흘러갈 수 있다)')
      assert.notEqual(rUnknown.code, mod.UNKNOWN_MAGAZINE_AUTO_MODE)
    })

  // M4 directSpecRegenPacket 의 instruction 조립에서 specHash 라인을 뺀다
  await mutate('M4', 'identity 운반 제거 — regen 패킷 instruction 에서 specHash 라인이 빠진다', 'adapter',
    (src) => replaceAfter(src, 'export function directSpecRegenPacket',
      /`원고의 schemaVersion 과 specHash 는 유지합니다: \$\{spec\.schemaVersion\} \/ \$\{spec\.specHash\}\.`,\n/,
      "// mutant M4: specHash 라인 제거\n"),
    async (mod) => {
      const d = tmp('ds-m4')
      const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
      const pkt = mod.directSpecRegenPacket({ spec: p.spec, failures: [{ code: 'M4', label: 't' }] })
      assert.ok(!pkt.instruction.includes(p.specHash),
        'M4 catch — 변이본의 instruction 글자가 specHash 를 운반하지 않는다 (QA 재생성 자리에서 identity 유실)')
    })

  // M5 registerDirectSpecSidecar 의 멱등 가드 (`if (existsSync(path))` 블록) 를 뺀다
  await mutate('M5', '재실행 중복 호출 — register 멱등 가드 제거', 'adapter',
    (src) => src.replace(
      /if \(existsSync\(path\)\) \{\n[\s\S]*?return \{ written: false, path, specHash: spec\.specHash, record: prev \}\n\s*\}\n/,
      '// mutant M5: 멱등 가드 제거\n'),
    async (mod) => {
      const d = tmp('ds-m5')
      const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
      const r1 = mod.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
      const r2 = mod.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
      assert.equal(r1.written, true)
      assert.equal(r2.written, true,
        'M5 catch — 변이본은 멱등하지 않아 identity 가 두 번 쓰인다 (재실행이 중복 등록을 만든다)')
    })

  // M6 delivery-gate.mjs 안의 direct wiring 블록을 통째로 제거한다 — direct queueItem 도 legacy 경로를 지난다
  await mutate('M6', 'direct wiring 제거 — deliveryGate 가 direct 분기를 지운다', 'deliveryGate',
    (src) => replaceAfter(src, 'export function deliveryGate',
      /\n  if \(resolved\.mode === DIRECT_SPEC_MODE \|\| persistedDirectIdentity\(\{ slug, draftsDir, packet \}\)\) \{\n[\s\S]*?\n  \}\n  const draftPath/,
      '\n  // mutant M6: direct 분기 제거 — direct queueItem 도 legacy 경로를 지난다\n  const draftPath'),
    async (mod) => {
      const { draftsDir, slug, specHash, quarantinePath } = makeSandbox('ds-m6')
      const g = mod.deliveryGate({ slug, draftsDir, quarantinePath,
        queueItem: { [DIRECT_SPEC_OPT_IN_FIELD]: DIRECT_SPEC_MODE } })
      // 변이본은 legacy 경로를 탄다 — legacy plannedMessageFor 는 queueItem 을 받지 않으므로 brief.md 를 읽는다.
      // 결과: ok 여도 message 에 specHash 가 없고(mode direct 가 아니다), 그래서 identity 운반이 끊긴다.
      assert.notEqual(g.mode, DIRECT_SPEC_MODE,
        'M6 catch — direct 분기가 제거됐는데도 mode 가 direct 로 돈다 (anchor 틀림)')
      if (g.ok && g.message) {
        assert.ok(!g.message.includes(specHash),
          'M6 catch — direct wiring 가 제거됐는데 message 가 여전히 specHash 를 담고 있다 (불가능)')
      }
      assert.notEqual(g.specHash, specHash,
        'M6 catch — direct wiring 가 제거됐는데 specHash 가 운반된다 (불가능)')
    })

  // M7 sidecar 대조 필드를 specHash 하나로 줄인다 — 같은 해시의 다른 graphNodeId 를 허용한다
  await mutate('M7', 'sidecar 전체 신원 대조 제거 — 같은 specHash 의 다른 graphNodeId 허용', 'adapter',
    (src) => src.replace(
      "const identityFields = ['schema', 'schemaVersion', 'mode', 'specHash', 'slug', 'graphNodeId', 'intentId', 'publishAt']",
      "const identityFields = ['specHash'] // mutant M7: 나머지 identity 대조 제거"),
    async (mod) => {
      const d = tmp('ds-m7')
      const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
      mod.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
      const receiptPath = join(d, p.spec.identity.slug, ARTICLE_SPEC_REGISTER_LEDGER)
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
      receipt.graphNodeId = 'wrong-graph-node'
      writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8')
      const r = mod.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
      assert.equal(r.written, false,
        'M7 catch — 변이본은 같은 specHash 라는 이유로 다른 graphNodeId 영수증을 멱등으로 인정한다')
    })

  // ── 제목 관문 변이 (2026-10-19) — 지점은 정확히 1곳 (patchOnce) ──
  // T1 최초 원고 제목 대조 제거 → 다른 제목이 그대로 등록·영수증까지 간다
  await mutate('T1', '최초 원고 제목 대조 제거', 'autoRegister',
    patchOnce(INITIAL_TITLE_GATE, '  // mutant T1: 최초 원고 제목 대조 제거\n'),
    async (mod) => {
      const s = titleDriveSandbox('ds-t1', { draftTitle: WRONG_TITLE })
      const r = mod.drive(s.slug, DRIVE_OPTS, s.deps)
      assert.equal(r.verdict, 'DONE', `T1 catch — 변이본은 제목 drift 를 등록해야 한다 (실제: ${JSON.stringify(r.blockedBy)})`)
      assert.equal(s.calls.register, 1)
      assert.equal(existsSync(s.receipt), true, 'T1 catch — spec 과 다른 제목에 specHash 영수증이 남는다')
    })

  // T2 재생성 후보 제목 대조 우회 → 제목이 바뀐 후보로 원고를 교체하고 등록한다
  await mutate('T2', '재생성 경로 제목 대조 우회', 'autoRegister',
    patchOnce('      if (isDirectMode && existsSync(candidate)) {\n', '      if (false) { // mutant T2: 재생성 후보 제목 대조 우회\n'),
    async (mod) => {
      const s = titleDriveSandbox('ds-t2', { qaFailsFirst: 1, candidate: titledManuscript(WRONG_TITLE, '본문만 바뀌어야 하는데 제목도 바뀌었다.') })
      const r = mod.drive(s.slug, DRIVE_OPTS, s.deps)
      assert.equal(s.calls.apply, 1, 'T2 catch — 변이본은 제목이 바뀐 후보로 원고를 교체해야 한다')
      assert.equal(r.verdict, 'DONE', `T2 catch — 교체된 다른 제목이 등록된다 (실제: ${JSON.stringify(r.blockedBy)})`)
      assert.ok(readFileSync(join(s.dir, 'draft.md'), 'utf8').includes(`title: ${WRONG_TITLE}`))
    })

  // T3 정규화 비교 → 끝 구두점·공백·대소문자 차이를 같은 제목으로 본다
  await mutate('T3', '제목 비교를 정규화로 완화', 'adapter',
    patchOnce("expected !== '' && actual === expected) return",
      "expected !== '' && String(actual).replace(/[\\s\\p{P}]/gu, '').toLowerCase() === expected.replace(/[\\s\\p{P}]/gu, '').toLowerCase()) return"),
    async (mod) => {
      const spec = { identity: { title: '퇴직금을 IRP에 넣어야 하나요' } }
      const r = mod.directSpecTitleCheck({ spec, manuscript: titledManuscript('퇴직금을  irp에 넣어야 하나요?') })
      assert.equal(r.ok, true, 'T3 catch — 변이본은 정규화로 다른 제목을 통과시킨다')
    })

  // T4 대조 함수가 항상 통과
  await mutate('T4', '제목 대조 함수 항상 통과', 'adapter',
    patchOnce("if (typeof expected === 'string' && expected !== '' && actual === expected) return { ok: true, title: expected }",
      'return { ok: true, title: expected } // mutant T4'),
    async (mod) => {
      const r = mod.directSpecTitleCheck({ spec: { identity: { title: '가' } }, manuscript: titledManuscript('나') })
      assert.equal(r.ok, true, 'T4 catch — 변이본은 다른 제목을 통과시킨다')
    })

  // T5 최초 전송 prompt 의 제목 불변 문구 제거
  await mutate('T5', '최초 prompt 제목 불변 문구 제거', 'adapter',
    patchOnce("  'frontmatter 의 --- 부터 CTA 줄까지 전부 포함합니다.',\n  DIRECT_SPEC_TITLE_LOCK_LINE,\n",
      "  'frontmatter 의 --- 부터 CTA 줄까지 전부 포함합니다.',\n"),
    async (mod) => {
      const { draftsDir, slug } = makeSandbox('ds-t5')
      const m = mod.directSpecMessageFor({ slug, draftsDir })
      assert.equal(m.ok, true)
      assert.ok(!m.message.includes(mod.DIRECT_SPEC_TITLE_LOCK_LINE), 'T5 catch — 변이본 최초 message 에 제목 불변 문구가 없다')
    })

  // T6 재생성 prompt 의 제목 불변 문구 제거
  await mutate('T6', '재생성 prompt 제목 불변 문구 제거', 'adapter',
    patchOnce("    '실패하지 않은 frontmatter 값·문단·소제목·문장·순서·CTA 는 유지하고 새 주장을 추가하지 마세요.',\n    DIRECT_SPEC_TITLE_LOCK_LINE,\n",
      "    '실패하지 않은 frontmatter 값·문단·소제목·문장·순서·CTA 는 유지하고 새 주장을 추가하지 마세요.',\n"),
    async (mod) => {
      const { draftsDir, slug } = makeSandbox('ds-t6')
      const spec = mod.readDirectSpec({ slug, draftsDir }).spec
      const text = mod.directSpecRegenPromptText({ spec, packet: { instruction: 'x' } })
      assert.ok(!text.includes(mod.DIRECT_SPEC_TITLE_LOCK_LINE), 'T6 catch — 변이본 재생성 prompt 에 제목 불변 문구가 없다')
    })

  // T7 재생성 mismatch 코드를 호출 자리의 일반 코드로 덮는다 → 결과에 DIRECT_SPEC_TITLE_MISMATCH 가 없다
  await mutate('T7', '재생성 mismatch 코드 덮어쓰기', 'autoRegister',
    patchOnce('(rr?.code === DIRECT_SPEC_TITLE_MISMATCH ? rr.code : fallback)', 'fallback /* mutant T7 */'),
    async (mod) => {
      const s = titleDriveSandbox('ds-t7', { qaFailsFirst: 1, candidate: titledManuscript(WRONG_TITLE) })
      const r = mod.drive(s.slug, DRIVE_OPTS, s.deps)
      assert.equal(r.verdict, 'BLOCKED')
      assert.equal(r.blockedBy?.[0]?.code, 'QA_FAIL', 'T7 catch — 변이본은 제목 계약 위반을 일반 QA_FAIL 로 덮는다')
    })

  // ── 제목 대조 순서 변이 — 제목도 다르고 CTA 도 없는 원고 (WRONG_TITLE_NO_CTA) ──
  /** 변이본이 제목 mismatch 원고에 형식 재생성(provider)을 걸었는가 — 이것이 결함이다 */
  const formatRegenRanOnMismatch = async (mod, prefix, id) => {
    const s = titleDriveSandbox(prefix, { draftText: WRONG_TITLE_NO_CTA, candidate: titledManuscript(WRONG_TITLE) })
    const r = mod.drive(s.slug, DRIVE_OPTS, s.deps)
    assert.equal(s.calls.regen, 1, `${id} catch — 변이본은 제목이 다른 원고에 형식 재생성(provider)을 건다 (실제 regen=${s.calls.regen} · ${JSON.stringify(r.blockedBy)})`)
    assert.equal(r.regenHistory?.[0]?.stage, 'article', `${id} catch — 형식 재생성 자리에서 provider 가 불렸다`)
  }

  // T8 최초 제목 대조를 형식 재생성 루프 뒤로 옮긴다 (adcb2414 의 순서)
  await mutate('T8', '최초 제목 대조를 형식 재생성 뒤로 이동', 'autoRegister',
    (src) => patchOnce(FORMAT_LOOP_END, `${FORMAT_LOOP_END}${INITIAL_TITLE_GATE}`)(patchOnce(INITIAL_TITLE_GATE, '  // mutant T8: 제목 대조를 형식 재생성 뒤로 옮김\n')(src)),
    (mod) => formatRegenRanOnMismatch(mod, 'ds-t8', 'T8'))

  // T9 제목 mismatch 여도 형식이 틀리면 막지 않고 형식 재생성으로 보낸다
  await mutate('T9', '제목 mismatch 에도 형식 재생성 허용', 'autoRegister',
    patchOnce("    if (!t.ok) return stop('article', t.code, t.why, { expectedTitle: t.expected, actualTitle: t.actual })\n",
      "    if (!t.ok && judgeManuscriptFormat(readFileSync(p.draftMd, 'utf8')).ok) return stop('article', t.code, t.why, { expectedTitle: t.expected, actualTitle: t.actual }) // mutant T9\n"),
    (mod) => formatRegenRanOnMismatch(mod, 'ds-t9', 'T9'))

  // T10 최초 제목 대조 제거 — 형식 위반 원고에서는 provider 재생성이 먼저 돈다 (T1 은 형식 정상 원고의 등록 경로)
  await mutate('T10', '최초 제목 대조 제거 (형식 위반 원고)', 'autoRegister',
    patchOnce(INITIAL_TITLE_GATE, '  // mutant T10: 최초 원고 제목 대조 제거\n'),
    (mod) => formatRegenRanOnMismatch(mod, 'ds-t10', 'T10'))
}

await baseline()
await runMutations()

console.log(`\nDIRECT_SPEC_V1 mutation: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
