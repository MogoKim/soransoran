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
 *    🔴 (2026-11-02 P1-1) current · previous · **control.json** 은 한 transaction 이다. control 은 손으로 쓰지 않고
 *       후보 manifest · 제품 control.ts 에서만 만든다(`buildInstallControl` — 필드별 권위는 그 함수 머리말).
 *    쓰기 계약 (연구 `contract/build/` 아래만):
 *      lock      `.research-current.lock` — O_EXCL. 있으면 RESEARCH_CURRENT_LOCKED 로 HOLD (지우지 않는다)
 *      journal   `.research-current.journal.json` — 첫 쓰기 전에 원자적으로. 있으면 새 전환 대신 RECOVERY_REQUIRED
 *      CAS       current · previous 링크 · control.json sha256 을 판독 때 · 각 쓰기 직전에 다시 본다. 다르면 RESEARCH_CURRENT_CAS_CONFLICT — 상대 바이트 보존
 *      설치      `<graphVersion>/` no-clobber — 이미 있으면 바이트가 같을 때만 재사용, 다르면 CANDIDATE_SLOT_TAKEN
 *      교체      임시 symlink · 임시 파일(`.swap-<txId>-*`) + rename. previous → current → control 순. journal 에 control 전·후 바이트
 *      복구      `recover` 만 journal 을 판정한다 — 세 항목을 전환 전(A) 또는 전환 후(B) 한 상태로만 맞춘다.
 *                그 밖(제삼자 값 · 제삼자 control 바이트)이면 아무것도 바꾸지 않고 RECOVERY_REQUIRED
 *      검증      `checkCurrent` — 설치된 current · control · previous 의 공식 검증 (옛 validate-graph · promote-regression 대체)
 *    🔴 기본은 dry-run — 쓰기 0. `write: true` 일 때만 쓴다. 제품 저장소 · 제품 current/control 은 읽기만 한다.
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeSync } from 'node:fs'
import { join, relative } from 'node:path'

import { ADMISSION_FILES, BUILD_SCHEMA, INPUT_FILES, PRODUCT_FILES, buildAll, existingAssetSummaries, parseControlText, productLifecycleDrift, parseInputTexts, parseProductTexts, validateBuiltArtifacts } from './magazine-graph-build.mjs'

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

// ── control ───────────────────────────────────────────────────

export const CONTROL_NAME = 'control.json'
export const CONTROL_SCHEMA = 'control/1'
const PRODUCT_CONTROL_REL = 'src/content/magazine/graph/control.ts'
/**
 * 🔴 **연구 control 의 권위** — 손으로 쓰지 않는다. 필드마다 출처가 하나다.
 *   graphVersion           후보 manifest (설치) · 내리는 대상 판 (rollback)
 *   previousGraphVersion   CAS 로 고정한 직전 current 링크
 *   enabled · enabledClusters · surfaces · killSwitch
 *                          제품 control.ts (`parseControlText` — builder 와 같은 parser). 후보 manifest 가 그 바이트로 build 됐거나
 *                          제품이 이미 같은 판을 가리켜야 한다. kill switch 가 켜져 있으면 세부를 옮길 수 없어 HOLD
 *   fallback               아래 상수 — 제품 resolver 의 폴백 계약 설명 (판마다 바뀌지 않는다)
 *   authority              어디서 만들었는지 — 제품 control sha256 · 후보 트리 sha256
 */
export const CONTROL_FALLBACK = Object.freeze({
  alwaysAvailable: true,
  behaviour: 'getRelatedMagazineArticles(같은 cluster 최신 3편)',
  triggers: ['DISABLED', 'VERSION_MISMATCH', 'CLUSTER_NOT_ENABLED', 'EXCEPTION', 'NO_MAPPING', 'KILL_SWITCH_TRIPPED'],
})
const CONTROL_NOTE = '🔴 자동 생성 — scripts/magazine-research-current.mjs 만 쓴다. 손으로 고치지 않는다 (제품 control.ts 가 런타임 권위다)'
const controlText = (c) => `${JSON.stringify(c, null, 2)}\n`

/** 설치용 control — 후보와 제품 control.ts 에서만 만든다. 모순이면 거부 */
export function buildInstallControl({ manifest, target, previousGraphVersion, productControlText, treeSha256, updatedAt }) {
  const parsed = parseControlText(productControlText)
  if (!parsed) fail('CONTROL_PRODUCT_UNREADABLE', '제품 control.ts 를 읽지 못했다')
  const productSha = sha256(productControlText)
  const builtWith = manifest?.productHashes?.[PRODUCT_CONTROL_REL]
  if (productSha !== builtWith && parsed.graphVersion !== target) {
    fail('CONTROL_PRODUCT_CONTRADICTS_CANDIDATE', `제품 control.ts(${parsed.graphVersion}) 가 후보를 만든 바이트도 아니고 후보 판(${target})도 아니다`)
  }
  if (parsed.killSwitchTripped) fail('CONTROL_KILL_SWITCH_TRIPPED', '제품 kill switch 가 켜져 있다 — 세부(누가·왜)를 옮길 수 없어 전환하지 않는다')
  const implemented = new Set(manifest?.implementedSurfaces ?? [])
  const bad = Object.entries(parsed.surfaces).filter(([k, v]) => v && !implemented.has(k)).map(([k]) => k)
  if (bad.length) fail('CONTROL_SURFACE_NOT_IMPLEMENTED', `켜진 표면이 후보의 구현 표면이 아니다: ${bad.join(', ')}`)
  return {
    schemaVersion: CONTROL_SCHEMA, graphVersion: target, previousGraphVersion, updatedAt,
    enabled: parsed.enabled, enabledClusters: [...parsed.enabledClusters].sort(), surfaces: parsed.surfaces,
    killSwitch: { tripped: false, trippedAt: null, trippedBy: null, reason: null },
    fallback: CONTROL_FALLBACK,
    authority: { builder: 'product', productControlSha256: productSha, candidateTreeSha256: treeSha256 },
    note: CONTROL_NOTE,
  }
}

/** rollback 용 control — 지금 control 의 값을 그대로 두고 판 신원만 내린다 */
function rollbackControl({ current, to, from, updatedAt }) {
  return { ...current, schemaVersion: CONTROL_SCHEMA, graphVersion: to, previousGraphVersion: from, updatedAt,
    authority: { ...(current?.authority ?? {}), rollbackOf: from }, note: CONTROL_NOTE }
}

// ── 링크 · lock · journal ─────────────────────────────────────

const linkOf = (p) => { try { return readlinkSync(p) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
const fileSha = (p) => { try { return sha256(readFileSync(p)) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
function atomicWrite(path, text, tmpName = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`) {
  const fd = openSync(tmpName, 'wx')
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmpName, path)
}
const atomicJson = (path, value) => atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
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

function readState(root) {
  const buildDir = join(root, BUILD_REL)
  if (!existsSync(buildDir)) fail('RESEARCH_BUILD_MISSING', `${BUILD_REL} 가 없다`)
  return { buildDir, current: linkOf(join(buildDir, 'current')), previous: linkOf(join(buildDir, 'previous')),
    controlSha: fileSha(join(buildDir, CONTROL_NAME)), journal: existsSync(join(buildDir, JOURNAL_NAME)) }
}
/** 🔴 각 쓰기 직전 — current · previous · control 세 항목이 기대 상태 그대로인가. 다르면 다른 writer 다 (보존) */
function guard3(root, want, at) {
  const s = readState(root)
  const now = { current: s.current, previous: s.previous, controlSha: s.controlSha }
  if (now.current !== want.current || now.previous !== want.previous || now.controlSha !== want.controlSha) {
    fail('RESEARCH_CURRENT_CAS_CONFLICT', `${at} 직전 상태가 다르다 — 다른 writer 가 바꿨다 (보존): ${JSON.stringify(now)} ≠ ${JSON.stringify(want)}`, { now, want })
  }
}
const swapLink = (buildDir, name, to, txId) => { const tmp = join(buildDir, `.swap-${txId}-${name}`); symlinkSync(to, tmp); renameSync(tmp, join(buildDir, name)) }

/**
 * 세 항목 전환 — previous → current → control 순. 단계마다 guard3 · phase.
 *   before  { current, previous, controlSha }   after { current, previous, controlText }
 */
function switchThree({ root, buildDir, before, after, txId, hooks, prefix }) {
  const afterSha = sha256(after.controlText)
  guard3(root, before, `${prefix}previous`)
  phase(`${prefix}previous-linking`, hooks)
  swapLink(buildDir, 'previous', after.previous, txId)
  phase(`${prefix}previous-swapped`, hooks)
  guard3(root, { ...before, previous: after.previous }, `${prefix}current`)
  phase(`${prefix}current-linking`, hooks)
  swapLink(buildDir, 'current', after.current, txId)
  phase(`${prefix}current-swapped`, hooks)
  guard3(root, { current: after.current, previous: after.previous, controlSha: before.controlSha }, `${prefix}control`)
  atomicWrite(join(buildDir, CONTROL_NAME), after.controlText, join(buildDir, `.swap-${txId}-control`))
  phase(`${prefix}control-written`, hooks)
  guard3(root, { current: after.current, previous: after.previous, controlSha: afterSha }, `${prefix}done`)
}

/**
 * 후보 설치 + current · previous · control 원자 전환.
 *   write=false (기본) — 검증 · 계획만. 쓰기 0
 *   expectCurrent · expectControlSha256  사람이 본 값 (CAS 기준)
 *   productControlText                    제품 control.ts 바이트 (새 control 의 권위)
 */
export function installCandidate({ researchDir, candidateDir, expectCurrent, expectControlSha256, productControlText, verify, write = false, hooks = {}, now = () => new Date().toISOString() }) {
  const st = readState(researchDir)
  if (st.journal) return { ok: false, code: 'RECOVERY_REQUIRED', why: `${JOURNAL_NAME} 가 남아 있다 — 새 전환 전에 recover 로 판정한다` }
  if (st.current !== expectCurrent) return { ok: false, code: 'RESEARCH_CURRENT_CAS_CONFLICT', why: `current 가 ${JSON.stringify(st.current)} 다 (기대 ${expectCurrent})` }
  if (st.controlSha !== expectControlSha256) return { ok: false, code: 'RESEARCH_CONTROL_CAS_CONFLICT', why: `control.json sha256 ${st.controlSha} ≠ 기대 ${expectControlSha256}` }
  let v, control
  try {
    v = verify()
    control = buildInstallControl({ manifest: v.manifest, target: v.graphVersion, previousGraphVersion: st.current, productControlText, treeSha256: v.treeSha256, updatedAt: now() })
  } catch (e) { if (e instanceof ResearchCurrentError) return { ok: false, code: e.code, why: e.why }; throw e }
  const target = v.graphVersion
  if (target === st.current) return { ok: false, code: 'ALREADY_CURRENT', why: `${target} 는 이미 current 다` }
  const slot = join(st.buildDir, target)
  const slotState = existsSync(slot) ? (JSON.stringify(treeOf(slot)) === JSON.stringify(v.tree) ? 'SAME' : 'TAKEN') : 'EMPTY'
  if (slotState === 'TAKEN') return { ok: false, code: 'CANDIDATE_SLOT_TAKEN', why: `${target}/ 가 이미 있고 바이트가 다르다 — 덮지 않는다` }
  const controlAfter = controlText(control)
  const before = { current: st.current, previous: st.previous, controlSha: st.controlSha }
  const plan = { from: st.current, previousBefore: st.previous, target, slot: slotState, treeSha256: v.treeSha256, controlBeforeSha256: st.controlSha, controlAfterSha256: sha256(controlAfter), control }
  if (!write) return { ok: true, code: 'DRY_RUN', plan }
  const txId = randomUUID()
  const lock = acquireLock(st.buildDir, txId)
  if (!lock.ok) return { ok: false, code: 'RESEARCH_CURRENT_LOCKED', why: `다른 writer 가 잠금을 쥐고 있다 (${JSON.stringify(lock.held)})` }
  try {
    phase('locked', hooks)
    if (readState(researchDir).journal) return { ok: false, code: 'RECOVERY_REQUIRED', why: '잠금 직후 journal 이 보인다' }
    guard3(researchDir, before, 'locked')
    const jpath = join(st.buildDir, JOURNAL_NAME)
    const controlBefore = st.controlSha === null ? null : readFileSync(join(st.buildDir, CONTROL_NAME), 'utf8')
    atomicJson(jpath, { schema: JOURNAL_SCHEMA, txId, op: 'install', from: st.current, previousBefore: st.previous, target, treeSha256: v.treeSha256, slotBefore: slotState,
      controlBefore: { sha256: st.controlSha, text: controlBefore }, controlAfter: { sha256: sha256(controlAfter), text: controlAfter }, startedAt: now() })
    phase('journaled', hooks)
    if (slotState === 'EMPTY') {
      const stage = join(st.buildDir, `.stage-${txId}`)
      cpSync(candidateDir, stage, { recursive: true, errorOnExist: true, force: false })
      if (JSON.stringify(treeOf(stage)) !== JSON.stringify(v.tree)) fail('CANDIDATE_COPY_DRIFT', '복사한 후보가 검증한 바이트와 다르다')
      phase('staged', hooks)
      guard3(researchDir, before, 'slot')
      if (existsSync(slot)) fail('CANDIDATE_SLOT_TAKEN', `${target}/ 가 설치 직전에 생겼다`)
      renameSync(stage, slot)
    }
    phase('installed', hooks)
    switchThree({ root: researchDir, buildDir: st.buildDir, before, after: { current: target, previous: st.current, controlText: controlAfter }, txId, hooks, prefix: '' })
    if (JSON.stringify(treeOf(slot)) !== JSON.stringify(v.tree)) fail('POST_SWAP_DRIFT', '설치된 판 바이트가 검증값과 다르다')
    unlinkSync(jpath)
    return { ok: true, code: 'INSTALLED', plan, txId }
  } catch (e) {
    // 🔴 실패 — current · previous · control 을 임의로 덮지 않는다. journal 은 남겨 recover 가 판정한다
    return { ok: false, code: e.code ?? 'INSTALL_FAILED', why: e.why ?? e.message, recovery: existsSync(join(st.buildDir, JOURNAL_NAME)) ? 'RECOVERY_REQUIRED' : null }
  } finally { releaseLock(lock) }
}

/** rollback — current 를 previous 판으로 · previous 는 방금 내린 판으로 · control 도 그 판으로. 대상 판은 verifyRollbackTarget 을 지나야 한다 */
export function rollbackCurrent({ researchDir, expectCurrent, expectPrevious, expectControlSha256, write = false, knownLegacy = KNOWN_LEGACY_CURRENTS, hooks = {}, now = () => new Date().toISOString() }) {
  const st = readState(researchDir)
  if (st.journal) return { ok: false, code: 'RECOVERY_REQUIRED', why: `${JOURNAL_NAME} 가 남아 있다` }
  if (st.current !== expectCurrent || st.previous !== expectPrevious) return { ok: false, code: 'RESEARCH_CURRENT_CAS_CONFLICT', why: `current ${st.current} · previous ${st.previous} (기대 ${expectCurrent} · ${expectPrevious})` }
  if (st.controlSha !== expectControlSha256) return { ok: false, code: 'RESEARCH_CONTROL_CAS_CONFLICT', why: `control.json sha256 ${st.controlSha} ≠ 기대 ${expectControlSha256}` }
  let t
  try { t = verifyRollbackTarget({ buildDir: st.buildDir, graphVersion: st.previous, knownLegacy }) } catch (e) {
    if (e instanceof ResearchCurrentError) return { ok: false, code: e.code, why: e.why }
    return { ok: false, code: 'ROLLBACK_TARGET_UNREADABLE', why: e.message }
  }
  let cur
  try { cur = JSON.parse(readFileSync(join(st.buildDir, CONTROL_NAME), 'utf8')) } catch (e) { return { ok: false, code: 'RESEARCH_CONTROL_UNREADABLE', why: e.message } }
  if (cur.graphVersion !== st.current) return { ok: false, code: 'RESEARCH_CONTROL_MISMATCH', why: `control.graphVersion ${cur.graphVersion} ≠ current ${st.current} — 먼저 맞춘다` }
  const controlAfter = controlText(rollbackControl({ current: cur, to: st.previous, from: st.current, updatedAt: now() }))
  const before = { current: st.current, previous: st.previous, controlSha: st.controlSha }
  const plan = { from: st.current, to: st.previous, targetKind: t.kind, controlAfterSha256: sha256(controlAfter) }
  if (!write) return { ok: true, code: 'DRY_RUN', plan }
  const txId = randomUUID()
  const lock = acquireLock(st.buildDir, txId)
  if (!lock.ok) return { ok: false, code: 'RESEARCH_CURRENT_LOCKED', why: `다른 writer 가 잠금을 쥐고 있다 (${JSON.stringify(lock.held)})` }
  try {
    guard3(researchDir, before, 'rollback-locked')
    const jpath = join(st.buildDir, JOURNAL_NAME)
    atomicJson(jpath, { schema: JOURNAL_SCHEMA, txId, op: 'rollback', from: st.current, previousBefore: st.previous, target: st.previous,
      controlBefore: { sha256: st.controlSha, text: readFileSync(join(st.buildDir, CONTROL_NAME), 'utf8') }, controlAfter: { sha256: sha256(controlAfter), text: controlAfter }, startedAt: now() })
    phase('rollback-journaled', hooks)
    switchThree({ root: researchDir, buildDir: st.buildDir, before, after: { current: st.previous, previous: st.current, controlText: controlAfter }, txId, hooks, prefix: 'rollback-' })
    unlinkSync(jpath)
    return { ok: true, code: 'ROLLED_BACK', plan, txId }
  } catch (e) {
    return { ok: false, code: e.code ?? 'ROLLBACK_FAILED', why: e.why ?? e.message, recovery: existsSync(join(st.buildDir, JOURNAL_NAME)) ? 'RECOVERY_REQUIRED' : null }
  } finally { releaseLock(lock) }
}

/**
 * 급사 뒤 복구 — journal 이 적은 두 상태 중 하나로만 맞춘다.
 *   A (전환 전)  current=from   · previous=previousBefore · control=controlBefore
 *   B (전환 후)  current=target · previous=from           · control=controlAfter
 *   current 가 from 이면 A 로, target 이면 B 로. previous · control 이 그 tx 의 두 값 밖(제삼자)이면 아무것도 바꾸지 않고 RECOVERY_REQUIRED.
 *   current 가 from 인데 control 이 이미 controlAfter 면(순서상 불가능) 역시 RECOVERY_REQUIRED.
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
  if (j.schema !== JOURNAL_SCHEMA || !j.controlBefore || !j.controlAfter) return { ok: false, code: 'RECOVERY_REQUIRED', why: `journal 형식이 다르다 (${j.schema})` }
  let lock = null
  if (existsSync(lockPath)) {
    try { lock = JSON.parse(readFileSync(lockPath, 'utf8')) } catch { lock = null }
    if (!lock || lock.txId !== j.txId) return { ok: false, code: 'RECOVERY_REQUIRED', why: 'lock 이 이 journal 의 tx 가 아니다' }
    if (pidAlive(lock.pid) && lock.pid !== process.pid) return { ok: false, code: 'RESEARCH_CURRENT_LOCKED', why: `tx 주인(pid ${lock.pid})이 살아 있다` }
  }
  const outcome = st.current === j.from ? 'NOT_SWITCHED' : st.current === j.target ? 'SWITCHED' : null
  if (!outcome) return { ok: false, code: 'RECOVERY_REQUIRED', why: `current ${st.current} 가 tx 의 from(${j.from})도 target(${j.target})도 아니다 — 바꾸지 않는다` }
  if (![j.previousBefore, j.from].includes(st.previous)) return { ok: false, code: 'RECOVERY_REQUIRED', why: `previous ${st.previous} 가 tx 의 값이 아니다 — 바꾸지 않는다` }
  const okControl = outcome === 'NOT_SWITCHED' ? [j.controlBefore.sha256] : [j.controlBefore.sha256, j.controlAfter.sha256]
  if (!okControl.includes(st.controlSha)) return { ok: false, code: 'RECOVERY_REQUIRED', why: `control.json(${st.controlSha}) 이 이 tx 의 ${outcome === 'NOT_SWITCHED' ? '전' : '전·후'} 바이트가 아니다 — 제삼자 바이트를 덮지 않는다` }
  const want = outcome === 'SWITCHED' ? { previous: j.from, control: j.controlAfter } : { previous: j.previousBefore, control: j.controlBefore }
  const plan = { op: j.op, outcome, previousNow: st.previous, wantPrevious: want.previous, controlNow: st.controlSha, wantControl: want.control.sha256, leftovers }
  if (!write) return { ok: true, code: 'DRY_RUN', plan }
  const mine = leftovers.filter((n) => n.startsWith(`.swap-${j.txId}-`) || n === `.stage-${j.txId}`)
  if (mine.length !== leftovers.length) return { ok: false, code: 'RECOVERY_REQUIRED', why: `다른 tx 의 조각이 있다: ${leftovers.filter((n) => !mine.includes(n)).join(', ')}` }
  for (const n of mine) rmSync(join(st.buildDir, n), { recursive: true, force: true })
  if (st.previous !== want.previous) {
    if (want.previous === null) unlinkSync(join(st.buildDir, 'previous'))
    else swapLink(st.buildDir, 'previous', want.previous, `${j.txId}-recover`)
  }
  if (st.controlSha !== want.control.sha256) atomicWrite(join(st.buildDir, CONTROL_NAME), want.control.text, join(st.buildDir, `.swap-${j.txId}-recover-control`))
  unlinkSync(jpath)
  if (lock) unlinkSync(lockPath)
  return { ok: true, code: outcome === 'SWITCHED' ? 'RECOVERED_SWITCHED' : 'RECOVERED_NOT_SWITCHED', plan }
}

/**
 * 🔴 **공식 current · control 검증** (옛 `validate-graph` · `promote-regression` 의 대체).
 *    설치된 판이 제품 builder 산출로 자기 일관인지 · control 이 current · previous 와 맞는지 · 조각이 없는지.
 *    재계산은 하지 않는다 — 설치 때 verify 가 했다. 여기서는 그 뒤 바뀐 바이트가 없는지를 본다.
 */
export function checkCurrent({ researchDir, knownLegacy = KNOWN_LEGACY_CURRENTS }) {
  const st = readState(researchDir)
  const problems = []
  if (st.journal) problems.push(`${JOURNAL_NAME} 가 남아 있다`)
  if (existsSync(join(st.buildDir, LOCK_NAME))) problems.push(`${LOCK_NAME} 가 남아 있다`)
  const leftovers = readdirSync(st.buildDir).filter((n) => n.startsWith('.swap-') || n.startsWith('.stage-'))
  if (leftovers.length) problems.push(`조각: ${leftovers.join(', ')}`)
  const dir = st.current ? join(st.buildDir, st.current) : null
  let m = null
  try { m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) } catch { m = null }
  if (!m || m.schemaVersion !== BUILD_SCHEMA) problems.push(`current ${st.current} 는 제품 builder 산출이 아니다 (${m?.schemaVersion ?? '읽지 못함'})`)
  else {
    if (m.graphVersion !== st.current) problems.push(`current 링크 ${st.current} ≠ manifest ${m.graphVersion}`)
    const body = {}
    for (const [k, n] of [['intents', 'intents.jsonl'], ['edges', 'edges.jsonl'], ['mappings', 'mappings.jsonl'], ['participation', 'participation.jsonl']]) {
      body[k] = existsSync(join(dir, n)) ? readFileSync(join(dir, n), 'utf8') : ''
      if (sha16(body[k]) !== m.contentHash?.[k]) problems.push(`${n} 가 manifest 와 다르다`)
    }
    const bundle = existsSync(join(dir, 'bundle', `${m.graphVersion}.ts`)) ? readFileSync(join(dir, 'bundle', `${m.graphVersion}.ts`), 'utf8') : ''
    if (!bundle.includes(`\nexport const EXPORT_HASH = '${m.exportHash}'\n`)) problems.push('bundle EXPORT_HASH 가 manifest 와 다르다')
    const rows = (t) => t.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    try {
      const intents = rows(body.intents), mappings = rows(body.mappings)
      const summary = existingAssetSummaries(mappings)
      const stale = intents.filter((x) => x.existingAssetRelation !== summary(x.intentId)).length
      if (stale) problems.push(`existingAssetRelation 이 mappings 와 다른 intent ${stale}`)
      validateBuiltArtifacts({ intents, edges: rows(body.edges), mappings, participation: rows(body.participation) })
    } catch (e) { problems.push(`산출 계약: ${e.why ?? e.message}`) }
  }
  let c = null
  try { c = JSON.parse(readFileSync(join(st.buildDir, CONTROL_NAME), 'utf8')) } catch { c = null }
  if (!c) problems.push('control.json 을 읽지 못했다')
  else {
    if (c.schemaVersion !== CONTROL_SCHEMA) problems.push(`control schema ${c.schemaVersion}`)
    if (c.graphVersion !== st.current) problems.push(`control.graphVersion ${c.graphVersion} ≠ current ${st.current}`)
    if (c.previousGraphVersion !== st.previous) problems.push(`control.previousGraphVersion ${c.previousGraphVersion} ≠ previous ${st.previous}`)
    if (c.authority?.builder !== 'product') problems.push('control 이 제품 builder 권위로 만들어지지 않았다')
    if (dir && existsSync(dir) && !c.authority?.rollbackOf && c.authority?.candidateTreeSha256 !== sha256(JSON.stringify(treeOf(dir)))) problems.push('control.authority 의 후보 트리 해시가 설치된 판과 다르다')
  }
  if (st.previous) { try { verifyRollbackTarget({ buildDir: st.buildDir, graphVersion: st.previous, knownLegacy }) } catch (e) { problems.push(`previous: ${e.why ?? e.message}`) } }
  return problems.length ? { ok: false, code: 'RESEARCH_CURRENT_INVALID', problems, current: st.current } : { ok: true, code: 'CURRENT_VALID', current: st.current, previous: st.previous }
}
