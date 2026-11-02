/**
 * 🔴 **연구 `contract/build/current` 전환 — 제품 builder 산출만 current 가 된다** (2026-11-02 · I-T6-03 release gate ②).
 *
 *    왜 생겼나. 연구 builder(`contract/build-graph.mjs`)와 제품 builder(`lib/magazine-graph-build.mjs`)가 같은 snapshot 에서
 *    다른 판을 만든다(3d32a6 ≠ 427d4d). 차이는 intent 의 `existingAssetRelation` — 연구 builder 는 automation 의 옛 문자열을
 *    복사하고, 제품 builder 는 built mappings 에서 다시 계산한다. ArticlePlan `--research-dir` 는 current 의 intents 해시가
 *    제품 graph 와 같아야 통과하므로, 두 builder 가 공존하면 연구 current 를 어느 쪽에도 맞출 수 없다.
 *
 *    결정 — **graph 의미 계산의 권위는 제품 builder 하나다.** 새 current 후보는 manifest 가 적은 입력(snapshot · 제품 파일 ·
 *    G8 장부 · effectiveAt · generatedAt)으로 `buildAll` 을 다시 돌린 결과와 **모든 파일이 바이트 동일**해야 한다.
 *    연구 builder 산출은 schema(`manifest/1`)부터 다르고, 같은 schema 로 위조해도 재계산 바이트가 다르다 — 승격 불가.
 *    옛 current(연구 builder 산출 ad8e89)는 **rollback 대상으로만** 읽는다 — 고정된 신원(KNOWN_LEGACY_CURRENTS)과 파일 해시로.
 *
 *    쓰기 계약 (연구 `contract/build/` 아래만):
 *      lock      `.research-current.lock` — O_EXCL. 있으면 RESEARCH_CURRENT_LOCKED 로 HOLD (지우지 않는다)
 *      journal   `.research-current.journal.json` — 첫 쓰기 전에 원자적으로. 있으면 새 전환 대신 RECOVERY_REQUIRED
 *      CAS       current · previous 링크를 판독 때 · 각 rename 직전에 다시 본다. 다르면 RESEARCH_CURRENT_CAS_CONFLICT — 상대 바이트 보존
 *      설치      `<graphVersion>/` no-clobber — 이미 있으면 바이트가 같을 때만 재사용, 다르면 CANDIDATE_SLOT_TAKEN
 *      교체      임시 symlink(`.swap-<txId>-*`) + rename. previous 먼저, current 나중
 *      복구      `recover` 만 journal 을 판정한다 — current 가 from 이면 previous 를 되돌리고, target 이면 previous 를 맞춘다.
 *                그 밖(제삼자 값)이면 아무것도 바꾸지 않고 RECOVERY_REQUIRED
 *    🔴 기본은 dry-run — 쓰기 0. `write: true` 일 때만 쓴다. 제품 저장소 · 제품 current/control 은 읽기만 한다.
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeSync } from 'node:fs'
import { join, relative } from 'node:path'

import { ADMISSION_FILES, BUILD_SCHEMA, INPUT_FILES, PRODUCT_FILES, buildAll, existingAssetSummaries, productLifecycleDrift, parseInputTexts, parseProductTexts, validateBuiltArtifacts } from './magazine-graph-build.mjs'

export const BUILD_REL = join('contract', 'build')
export const LOCK_NAME = '.research-current.lock'
export const JOURNAL_NAME = '.research-current.journal.json'
export const JOURNAL_SCHEMA = 'research-current-journal/1'

/**
 * 옛 연구 builder 산출 current — **rollback 대상으로만** 받는다. 새 후보로는 받지 않는다.
 *   파일 sha256 은 2026-11-02 실제 연구 저장소 `contract/build/g-20260923-ad8e89/` 판독값.
 */
export const KNOWN_LEGACY_CURRENTS = Object.freeze({
  'g-20260923-ad8e89': Object.freeze({
    'manifest.json': 'b2645877fbde385f4fc58c72358990ee94d1dbe7a1dbde78d07440c13c09989a',
    'intents.jsonl': '9ee93ab9699da4a3b48aef8534607283def63a80a76755d84c246d06e29ed929',
    'edges.jsonl': 'b18ccc3a39556a007fde13980ae23309ae3fb8aadfc7dfa9c446856bc688eeb9',
    'mappings.jsonl': '3d0b4257e6ae6fe20fced7111e09dba65156dc6f841cf5b313a5ead2cec0c5a2',
  }),
})

export class ResearchCurrentError extends Error {
  constructor(code, why, detail = null) { super(`${code}: ${why}`); this.code = code; this.why = why; this.detail = detail }
}
const fail = (code, why, detail) => { throw new ResearchCurrentError(code, why, detail) }
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const sha16 = (b) => sha256(b).slice(0, 16)

/** 폴더의 일반 파일 전부 — 상대 경로 → sha256 (symlink · 숨김 파일은 거부한다) */
export function treeOf(dir) {
  const out = {}
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const f = join(d, n)
      const st = lstatSync(f)
      if (st.isSymbolicLink()) fail('CANDIDATE_SHAPE', `후보 안에 symlink 가 있다: ${relative(dir, f)}`)
      if (st.isDirectory()) { walk(f); continue }
      out[relative(dir, f)] = sha256(readFileSync(f))
    }
  }
  walk(dir)
  return out
}

const readIn = (dir, rel, label) => {
  try { return readFileSync(join(dir, rel), 'utf8') } catch (e) { return fail('CANDIDATE_INPUT_MISSING', `${label} 를 읽지 못했다 (${rel}: ${e.code ?? e.message})`) }
}

/**
 * 🔴 **후보 = 제품 builder 재계산 결과** — 전부 맞아야 통과. 어긋나는 첫 사유로 멈춘다.
 *   expect  { graphVersion, semanticHash, exportHash, bundleSha256 } — 사람이 확인한 값 (기본값 없음)
 *   snapshotDir   manifest.inputHashes 와 같은 연구 snapshot
 *   productRoot   manifest.productHashes 와 같은 제품 파일 (resolver · control · articles)
 *   researchDir   manifest.admissionHashes 와 같은 G8 장부
 *   fixtureBundle 선택 — 같은 판의 고정 release fixture bundle (있으면 바이트 동일이어야 한다)
 */
export function verifyCandidate({ candidateDir, snapshotDir, productRoot, researchDir, expect, fixtureBundle = null }) {
  for (const k of ['graphVersion', 'semanticHash', 'exportHash', 'bundleSha256']) if (!expect?.[k]) fail('EXPECT_REQUIRED', `기대값 ${k} 가 없다 (기본값 없음)`)
  const manifestText = readIn(candidateDir, 'manifest.json', 'manifest')
  let m
  try { m = JSON.parse(manifestText) } catch (e) { fail('CANDIDATE_MANIFEST_INVALID', `manifest 를 읽지 못했다: ${e.message}`) }
  // ① 신원 — 제품 builder schema 만 · 사람이 확인한 판·해시
  if (m.schemaVersion !== BUILD_SCHEMA) fail('CANDIDATE_NOT_PRODUCT_BUILD', `manifest schema ${JSON.stringify(m.schemaVersion)} — 제품 builder(${BUILD_SCHEMA}) 산출만 current 가 된다`)
  if (m.graphVersion !== expect.graphVersion) fail('CANDIDATE_GRAPH_VERSION', `판 ${m.graphVersion} ≠ 기대 ${expect.graphVersion}`)
  if (m.semanticHash !== expect.semanticHash) fail('CANDIDATE_SEMANTIC_HASH', `semanticHash ${m.semanticHash} ≠ 기대 ${expect.semanticHash}`)
  if (m.exportHash !== expect.exportHash) fail('CANDIDATE_EXPORT_HASH', `exportHash ${m.exportHash} ≠ 기대 ${expect.exportHash}`)
  // ② 파일 ↔ manifest — 각 산출 파일의 내용 해시가 manifest 에 적힌 값
  const body = {}
  for (const [k, name] of [['intents', 'intents.jsonl'], ['edges', 'edges.jsonl'], ['mappings', 'mappings.jsonl'], ['participation', 'participation.jsonl']]) {
    body[k] = readIn(candidateDir, name, name)
    if (sha16(body[k]) !== m.contentHash?.[k]) fail('CANDIDATE_CONTENT_HASH', `${name} 해시 ${sha16(body[k])} ≠ manifest ${m.contentHash?.[k]}`)
  }
  const bundleRel = join('bundle', `${m.graphVersion}.ts`)
  const bundle = readIn(candidateDir, bundleRel, 'bundle')
  if (sha256(bundle) !== expect.bundleSha256) fail('CANDIDATE_BUNDLE_HASH', `bundle sha256 ${sha256(bundle)} ≠ 기대 ${expect.bundleSha256}`)
  if (!bundle.includes(`\nexport const EXPORT_HASH = '${m.exportHash}'\n`)) fail('CANDIDATE_BUNDLE_EXPORT_HASH', 'bundle EXPORT_HASH 가 manifest exportHash 와 다르다')
  if (fixtureBundle !== null && fixtureBundle !== bundle) fail('CANDIDATE_FIXTURE_BUNDLE_DRIFT', '같은 판의 DIRECT_E2E release fixture bundle 과 바이트가 다르다')
  // ③ existingAssetRelation — 모든 intent 가 built mappings 에서 다시 계산한 값 (automation 옛 문자열 거부)
  const rows = (t) => t.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const intents = rows(body.intents), mappings = rows(body.mappings)
  const summary = existingAssetSummaries(mappings)
  const stale = intents.filter((x) => x.existingAssetRelation !== summary(x.intentId)).map((x) => x.intentId)
  if (stale.length) fail('CANDIDATE_ASSET_RELATION_STALE', `existingAssetRelation 이 built mappings 와 다르다: ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ` 외 ${stale.length - 5}` : ''}`, { stale })
  // 제품 builder 의 산출 계약 검사 그대로 (위반이면 GraphBuildError 를 던진다)
  try { validateBuiltArtifacts({ intents, edges: rows(body.edges), mappings, participation: rows(body.participation) }) } catch (e) {
    fail('CANDIDATE_ARTIFACT_INVALID', e.why ?? e.message)
  }
  // ④ 입력 신원 — manifest 가 적은 입력과 지금 주어진 입력이 같다
  const inputTexts = Object.fromEntries(Object.values(INPUT_FILES).map((n) => [n, readIn(snapshotDir, n, `snapshot ${n}`)]))
  for (const [n, h] of Object.entries(m.inputHashes ?? {})) if (sha256(inputTexts[n] ?? '') !== h) fail('CANDIDATE_INPUT_DRIFT', `snapshot ${n} 가 manifest inputHashes 와 다르다`)
  const productTexts = Object.fromEntries(Object.entries(PRODUCT_FILES).map(([k, rel]) => [k, readIn(productRoot, rel, `제품 ${rel}`)]))
  for (const [rel, h] of Object.entries(m.productHashes ?? {})) {
    const k = Object.entries(PRODUCT_FILES).find(([, r]) => r === rel)?.[0]
    if (!k || sha256(productTexts[k]) !== h) fail('CANDIDATE_PRODUCT_DRIFT', `제품 ${rel} 가 manifest productHashes 와 다르다 — 후보를 만든 제품 판에서 검증한다`)
  }
  const admissionTexts = Object.fromEntries(Object.entries(ADMISSION_FILES).map(([k, rel]) => [k, readIn(researchDir, rel, `장부 ${rel}`)]))
  for (const [rel, h] of Object.entries(m.admissionHashes ?? {})) {
    const k = Object.entries(ADMISSION_FILES).find(([, r]) => r === rel)?.[0]
    if (!k || sha256(admissionTexts[k]) !== h) fail('CANDIDATE_ADMISSION_DRIFT', `연구 ${rel} 가 manifest admissionHashes 와 다르다`)
  }
  // ⑤ lifecycle drift 0 — 후보 시각에 snapshot 과 제품 공개 상태가 같다
  const drift = productLifecycleDrift({ inputs: parseInputTexts(inputTexts), articles: parseProductTexts(productTexts).articles, effectiveMs: Date.parse(m.effectiveAt) })
  if (drift.length) fail('CANDIDATE_LIFECYCLE_DRIFT', `effectiveAt ${m.effectiveAt} 에 lifecycle drift ${drift.map((d) => d.slug).join(',')}`)
  // ⑥ 단일 권위 — 제품 builder 로 다시 만든 결과와 파일 목록 · 바이트가 전부 같다 (readiness 재계산 포함)
  let rebuilt
  try { rebuilt = buildAll({ inputTexts, productTexts, admissionTexts, effectiveAt: m.effectiveAt, generatedAt: m.generatedAt }) } catch (e) {
    fail('CANDIDATE_REBUILD_FAILED', `제품 builder 재계산 실패: ${e.code ?? ''} ${e.why ?? e.message}`)
  }
  const want = Object.fromEntries(Object.entries(rebuilt.files).map(([k, v]) => [k, sha256(v)]))
  const got = treeOf(candidateDir)
  const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort()
  const diff = keys.filter((k) => want[k] !== got[k])
  if (diff.length) fail('CANDIDATE_NOT_REBUILT', `제품 builder 재계산과 다른 파일: ${diff.join(', ')}`, { diff })
  return { ok: true, graphVersion: m.graphVersion, tree: got, treeSha256: sha256(JSON.stringify(got)), manifest: m, intentsHash: m.contentHash.intents }
}

/** rollback 대상 판 — 제품 builder 산출(manifest 자기 일관) 또는 KNOWN_LEGACY_CURRENTS 고정 신원 */
export function verifyRollbackTarget({ buildDir, graphVersion, knownLegacy = KNOWN_LEGACY_CURRENTS }) {
  const dir = join(buildDir, graphVersion)
  if (!existsSync(dir)) fail('ROLLBACK_TARGET_MISSING', `${graphVersion} 폴더가 없다`)
  const legacy = knownLegacy[graphVersion]
  if (legacy) {
    for (const [f, h] of Object.entries(legacy)) {
      const got = existsSync(join(dir, f)) ? sha256(readFileSync(join(dir, f))) : null
      if (got !== h) fail('ROLLBACK_TARGET_DRIFT', `${graphVersion}/${f} 가 고정 신원과 다르다 (${got})`)
    }
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    for (const [k, name] of [['intents', 'intents.jsonl'], ['edges', 'edges.jsonl'], ['mappings', 'mappings.jsonl']]) {
      if (sha16(readFileSync(join(dir, name))) !== m.contentHash?.[k]) fail('ROLLBACK_TARGET_DRIFT', `${graphVersion}/${name} 가 manifest 와 다르다`)
    }
    return { ok: true, kind: 'KNOWN_LEGACY', graphVersion }
  }
  let m = null
  try { m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) } catch { m = null }
  if (m?.schemaVersion !== BUILD_SCHEMA || m.graphVersion !== graphVersion) fail('ROLLBACK_TARGET_UNKNOWN', `${graphVersion} 은 제품 builder 산출도 고정 legacy 도 아니다`)
  for (const [k, name] of [['intents', 'intents.jsonl'], ['edges', 'edges.jsonl'], ['mappings', 'mappings.jsonl'], ['participation', 'participation.jsonl']]) {
    if (sha16(readFileSync(join(dir, name))) !== m.contentHash?.[k]) fail('ROLLBACK_TARGET_DRIFT', `${graphVersion}/${name} 가 manifest 와 다르다`)
  }
  return { ok: true, kind: 'PRODUCT_BUILD', graphVersion }
}

// ── 링크 · lock · journal ─────────────────────────────────────

const linkOf = (p) => { try { return readlinkSync(p) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
function atomicJson(path, value) {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
  const fd = openSync(tmp, 'wx')
  try { writeSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, path)
}
function acquireLock(buildDir, txId) {
  const p = join(buildDir, LOCK_NAME)
  let fd
  try { fd = openSync(p, 'wx') } catch (e) {
    if (e.code !== 'EEXIST') throw e
    let held = null
    try { held = JSON.parse(readFileSync(p, 'utf8')) } catch { held = null }
    return { ok: false, held }
  }
  try { writeSync(fd, `${JSON.stringify({ txId, pid: process.pid, at: new Date().toISOString() })}\n`); fsyncSync(fd) } finally { closeSync(fd) }
  return { ok: true, path: p, txId }
}
const releaseLock = (lock) => { try { if (JSON.parse(readFileSync(lock.path, 'utf8')).txId === lock.txId) unlinkSync(lock.path) } catch { /* 이미 없다 */ } }
const pidAlive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

/** 🔴 시험 주입 — `SORAN_RESEARCH_CURRENT_TEST=1` 일 때만 단계 이름으로 멈춤(throw)·급사(SIGKILL)를 건다 */
function phase(name, hooks) {
  hooks?.[name]?.()
  const spec = process.env.SORAN_RESEARCH_CURRENT_TEST === '1' ? process.env.SORAN_RESEARCH_CURRENT_FAULT : null
  if (!spec) return
  const [what, at] = spec.split('@')
  if (at !== name) return
  if (what === 'kill') process.kill(process.pid, 'SIGKILL')
  if (what === 'throw') throw new Error(`FAULT_INJECTED@${name}`)
}

/** 링크 하나를 임시 symlink + rename 으로 — 직전에 CAS */
function swapLink({ buildDir, name, expect, to, txId, hooks, phaseName }) {
  const p = join(buildDir, name)
  const now = linkOf(p)
  if (now !== expect) fail('RESEARCH_CURRENT_CAS_CONFLICT', `${name} 가 ${JSON.stringify(expect)} 가 아니라 ${JSON.stringify(now)} 다 — 다른 writer 가 바꿨다 (보존)`, { name, expect, now })
  const tmp = join(buildDir, `.swap-${txId}-${name}`)
  symlinkSync(to, tmp)
  phase(phaseName, hooks)
  renameSync(tmp, p)
}

function readState(root) {
  const buildDir = join(root, BUILD_REL)
  if (!existsSync(buildDir)) fail('RESEARCH_BUILD_MISSING', `${BUILD_REL} 가 없다`)
  return { buildDir, current: linkOf(join(buildDir, 'current')), previous: linkOf(join(buildDir, 'previous')), journal: existsSync(join(buildDir, JOURNAL_NAME)) }
}

/**
 * 후보 설치 + current 원자 전환.
 *   write=false (기본) — 검증 · 계획만. 쓰기 0
 *   expectCurrent      사람이 본 current 링크 값 (CAS 기준)
 */
export function installCandidate({ researchDir, candidateDir, expectCurrent, verify, write = false, hooks = {} }) {
  const st = readState(researchDir)
  if (st.journal) return { ok: false, code: 'RECOVERY_REQUIRED', why: `${JOURNAL_NAME} 가 남아 있다 — 새 전환 전에 recover 로 판정한다` }
  if (st.current !== expectCurrent) return { ok: false, code: 'RESEARCH_CURRENT_CAS_CONFLICT', why: `current 가 ${JSON.stringify(st.current)} 다 (기대 ${expectCurrent})` }
  let v
  try { v = verify() } catch (e) { if (e instanceof ResearchCurrentError) return { ok: false, code: e.code, why: e.why }; throw e }
  const target = v.graphVersion
  if (target === st.current) return { ok: false, code: 'ALREADY_CURRENT', why: `${target} 는 이미 current 다` }
  const slot = join(st.buildDir, target)
  const slotState = existsSync(slot) ? (JSON.stringify(treeOf(slot)) === JSON.stringify(v.tree) ? 'SAME' : 'TAKEN') : 'EMPTY'
  if (slotState === 'TAKEN') return { ok: false, code: 'CANDIDATE_SLOT_TAKEN', why: `${target}/ 가 이미 있고 바이트가 다르다 — 덮지 않는다` }
  const plan = { from: st.current, previousBefore: st.previous, target, slot: slotState, treeSha256: v.treeSha256 }
  if (!write) return { ok: true, code: 'DRY_RUN', plan }
  const txId = randomUUID()
  const lock = acquireLock(st.buildDir, txId)
  if (!lock.ok) return { ok: false, code: 'RESEARCH_CURRENT_LOCKED', why: `다른 writer 가 잠금을 쥐고 있다 (${JSON.stringify(lock.held)})` }
  try {
    phase('locked', hooks)
    const again = readState(researchDir)
    if (again.journal) return { ok: false, code: 'RECOVERY_REQUIRED', why: '잠금 직후 journal 이 보인다' }
    if (again.current !== expectCurrent || again.previous !== st.previous) return { ok: false, code: 'RESEARCH_CURRENT_CAS_CONFLICT', why: `잠금 직후 current/previous 가 바뀌었다 (${again.current} · ${again.previous})` }
    const jpath = join(st.buildDir, JOURNAL_NAME)
    atomicJson(jpath, { schema: JOURNAL_SCHEMA, txId, op: 'install', from: st.current, previousBefore: st.previous, target, treeSha256: v.treeSha256, slotBefore: slotState, startedAt: new Date().toISOString() })
    phase('journaled', hooks)
    if (slotState === 'EMPTY') {
      const stage = join(st.buildDir, `.stage-${txId}`)
      cpSync(candidateDir, stage, { recursive: true, errorOnExist: true, force: false })
      if (JSON.stringify(treeOf(stage)) !== JSON.stringify(v.tree)) fail('CANDIDATE_COPY_DRIFT', '복사한 후보가 검증한 바이트와 다르다')
      phase('staged', hooks)
      if (existsSync(slot)) fail('CANDIDATE_SLOT_TAKEN', `${target}/ 가 설치 직전에 생겼다`)
      renameSync(stage, slot)
    }
    phase('installed', hooks)
    swapLink({ buildDir: st.buildDir, name: 'previous', expect: st.previous, to: st.current, txId, hooks, phaseName: 'previous-linked' })
    phase('previous-swapped', hooks)
    swapLink({ buildDir: st.buildDir, name: 'current', expect: st.current, to: target, txId, hooks, phaseName: 'current-linked' })
    phase('current-swapped', hooks)
    const after = readState(researchDir)
    if (after.current !== target || after.previous !== st.current) fail('POST_SWAP_DRIFT', `전환 뒤 current ${after.current} · previous ${after.previous}`)
    if (JSON.stringify(treeOf(slot)) !== JSON.stringify(v.tree)) fail('POST_SWAP_DRIFT', '설치된 판 바이트가 검증값과 다르다')
    unlinkSync(jpath)
    return { ok: true, code: 'INSTALLED', plan, txId }
  } catch (e) {
    // 🔴 실패 — current · previous 를 임의로 덮지 않는다. journal 은 남겨 recover 가 판정한다
    return { ok: false, code: e.code ?? 'INSTALL_FAILED', why: e.why ?? e.message, recovery: existsSync(join(st.buildDir, JOURNAL_NAME)) ? 'RECOVERY_REQUIRED' : null }
  } finally { releaseLock(lock) }
}

/** rollback — current 를 previous 판으로 · previous 는 방금 내린 판으로. 대상 판은 verifyRollbackTarget 을 지나야 한다 */
export function rollbackCurrent({ researchDir, expectCurrent, expectPrevious, write = false, knownLegacy = KNOWN_LEGACY_CURRENTS, hooks = {} }) {
  const st = readState(researchDir)
  if (st.journal) return { ok: false, code: 'RECOVERY_REQUIRED', why: `${JOURNAL_NAME} 가 남아 있다` }
  if (st.current !== expectCurrent || st.previous !== expectPrevious) return { ok: false, code: 'RESEARCH_CURRENT_CAS_CONFLICT', why: `current ${st.current} · previous ${st.previous} (기대 ${expectCurrent} · ${expectPrevious})` }
  let t
  try { t = verifyRollbackTarget({ buildDir: st.buildDir, graphVersion: st.previous, knownLegacy }) } catch (e) {
    if (e instanceof ResearchCurrentError) return { ok: false, code: e.code, why: e.why }
    return { ok: false, code: 'ROLLBACK_TARGET_UNREADABLE', why: e.message }
  }
  const plan = { from: st.current, to: st.previous, targetKind: t.kind }
  if (!write) return { ok: true, code: 'DRY_RUN', plan }
  const txId = randomUUID()
  const lock = acquireLock(st.buildDir, txId)
  if (!lock.ok) return { ok: false, code: 'RESEARCH_CURRENT_LOCKED', why: `다른 writer 가 잠금을 쥐고 있다 (${JSON.stringify(lock.held)})` }
  try {
    const jpath = join(st.buildDir, JOURNAL_NAME)
    atomicJson(jpath, { schema: JOURNAL_SCHEMA, txId, op: 'rollback', from: st.current, previousBefore: st.previous, target: st.previous, startedAt: new Date().toISOString() })
    swapLink({ buildDir: st.buildDir, name: 'current', expect: st.current, to: st.previous, txId, hooks, phaseName: 'rollback-current-linked' })
    phase('rollback-current-swapped', hooks)
    swapLink({ buildDir: st.buildDir, name: 'previous', expect: st.previous, to: st.current, txId, hooks, phaseName: 'rollback-previous-linked' })
    unlinkSync(jpath)
    return { ok: true, code: 'ROLLED_BACK', plan, txId }
  } catch (e) {
    return { ok: false, code: e.code ?? 'ROLLBACK_FAILED', why: e.why ?? e.message, recovery: 'RECOVERY_REQUIRED' }
  } finally { releaseLock(lock) }
}

/**
 * 급사 뒤 복구 — journal · 링크 · lock 을 보고 판정한다.
 *   install  current=from → previous 를 previousBefore 로 되돌림 (설치 폴더는 검증 바이트면 둔다) → RECOVERED_NOT_SWITCHED
 *            current=target → previous 를 from 으로 맞춤 → RECOVERED_SWITCHED
 *   rollback current=from → previous 를 previousBefore 로 · current=target → previous 를 from 으로
 *   그 밖 · lock 의 주인이 살아 있음 · lock 이 다른 tx → 아무것도 바꾸지 않고 RECOVERY_REQUIRED
 */
export function recoverCurrent({ researchDir, write = false }) {
  const st = readState(researchDir)
  const jpath = join(st.buildDir, JOURNAL_NAME)
  const lockPath = join(st.buildDir, LOCK_NAME)
  const leftovers = readdirSync(st.buildDir).filter((n) => n.startsWith('.swap-') || n.startsWith('.stage-'))
  if (!st.journal) {
    if (existsSync(lockPath) || leftovers.length) return { ok: false, code: 'RECOVERY_REQUIRED', why: `journal 없이 조각이 남았다 (${[existsSync(lockPath) ? LOCK_NAME : null, ...leftovers].filter(Boolean).join(', ')}) — 사람이 본다` }
    return { ok: true, code: 'NOTHING_TO_RECOVER' }
  }
  let j
  try { j = JSON.parse(readFileSync(jpath, 'utf8')) } catch (e) { return { ok: false, code: 'RECOVERY_REQUIRED', why: `journal 을 읽지 못했다: ${e.message}` } }
  if (j.schema !== JOURNAL_SCHEMA) return { ok: false, code: 'RECOVERY_REQUIRED', why: `journal schema ${j.schema}` }
  let lock = null
  if (existsSync(lockPath)) {
    try { lock = JSON.parse(readFileSync(lockPath, 'utf8')) } catch { lock = null }
    if (!lock || lock.txId !== j.txId) return { ok: false, code: 'RECOVERY_REQUIRED', why: 'lock 이 이 journal 의 tx 가 아니다' }
    if (pidAlive(lock.pid) && lock.pid !== process.pid) return { ok: false, code: 'RESEARCH_CURRENT_LOCKED', why: `tx 주인(pid ${lock.pid})이 살아 있다` }
  }
  const outcome = st.current === j.from ? 'NOT_SWITCHED' : st.current === j.target ? 'SWITCHED' : null
  if (!outcome) return { ok: false, code: 'RECOVERY_REQUIRED', why: `current ${st.current} 가 tx 의 from(${j.from})도 target(${j.target})도 아니다 — 바꾸지 않는다` }
  const wantPrevious = outcome === 'SWITCHED' ? j.from : j.previousBefore
  const plan = { op: j.op, outcome, previousNow: st.previous, wantPrevious, leftovers }
  if (!write) return { ok: true, code: 'DRY_RUN', plan }
  const mine = leftovers.filter((n) => n.startsWith(`.swap-${j.txId}-`) || n === `.stage-${j.txId}`)
  if (mine.length !== leftovers.length) return { ok: false, code: 'RECOVERY_REQUIRED', why: `다른 tx 의 조각이 있다: ${leftovers.filter((n) => !mine.includes(n)).join(', ')}` }
  for (const n of mine) rmSync(join(st.buildDir, n), { recursive: true, force: true })
  if (st.previous !== wantPrevious) {
    const tmp = join(st.buildDir, `.swap-${j.txId}-recover-previous`)
    if (wantPrevious === null) unlinkSync(join(st.buildDir, 'previous'))
    else { symlinkSync(wantPrevious, tmp); renameSync(tmp, join(st.buildDir, 'previous')) }
  }
  unlinkSync(jpath)
  if (lock) unlinkSync(lockPath)
  return { ok: true, code: outcome === 'SWITCHED' ? 'RECOVERED_SWITCHED' : 'RECOVERED_NOT_SWITCHED', plan }
}

