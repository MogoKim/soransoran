#!/usr/bin/env node
/**
 * 연구 current 전환 검사 (2026-11-02 · release gate ②).
 *
 *   node scripts/magazine-research-current-check.mjs                       hermetic — 합성 연구 폴더로 CAS · 실패 · 급사 · 복구 · rollback
 *   node scripts/magazine-research-current-check.mjs --research <연구>       + 실제 입력 — 연구 사본(tmp)에서 후보 검증 · 전환 · 소비자 · graph-check
 *
 * 🔴 실제 연구 저장소는 읽기만 한다 (tmp 로 복사). 제품 저장소도 읽기만 한다 — 승격 판 graph-check 는 tmp 제품 사본에서.
 * 🔴 `--research` 를 주지 않으면 실제 입력 시험은 ⏭ 로 남고 통과로 세지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

import * as RC from './lib/magazine-research-current.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const argv = process.argv.slice(2)
const argOf = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] ?? null : null)
const TMP = mkdtempSync(join(tmpdir(), 'research-current-check-'))
let pass = 0
let failN = 0
const results = []
const ok = (name, cond, detail = '') => { if (cond) { pass++; results.push(`  ✅ ${name}`) } else { failN++; results.push(`  ❌ ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}` : ''}`) } }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const linkOf = (p) => { try { return readlinkSync(p) } catch { return null } }
const treeSnap = (dir) => { const o = {}; const walk = (d) => { for (const n of readdirSync(d).sort()) { const f = join(d, n); const l = linkOf(f); if (l !== null) o[f.slice(dir.length)] = `->${l}`; else if (existsSync(f) && readdirSync(d, { withFileTypes: true }).find((e) => e.name === n).isDirectory()) walk(f); else o[f.slice(dir.length)] = sha(readFileSync(f)) } }; walk(dir); return JSON.stringify(o) }

// ─────────────────────────────────────────────────────────
// ① hermetic — 합성 연구 폴더 · 검증은 주입 (전환 엔진만 본다)
// ─────────────────────────────────────────────────────────
function synth(label) {
  const r = join(TMP, label)
  const b = join(r, 'contract', 'build')
  // 옛 연구 builder 모양(manifest/1 · contentHash = 파일 sha256 앞 16자) — rollback 대상 검증이 실제와 같은 규칙으로 본다
  for (const g of ['g-old', 'g-older']) {
    mkdirSync(join(b, g), { recursive: true })
    const ch = {}
    for (const [k, n] of [['intents', 'intents.jsonl'], ['edges', 'edges.jsonl'], ['mappings', 'mappings.jsonl']]) { writeFileSync(join(b, g, n), `${g}-${k}\n`); ch[k] = sha(`${g}-${k}\n`).slice(0, 16) }
    writeFileSync(join(b, g, 'manifest.json'), JSON.stringify({ schemaVersion: 'manifest/1', graphVersion: g, contentHash: ch }))
  }
  symlinkSync('g-old', join(b, 'current')); symlinkSync('g-older', join(b, 'previous'))
  const cand = join(r, 'cand')
  mkdirSync(cand, { recursive: true }); writeFileSync(join(cand, 'x.txt'), 'new'); mkdirSync(join(cand, 'bundle')); writeFileSync(join(cand, 'bundle', 'b.ts'), 'b')
  const verify = () => ({ ok: true, graphVersion: 'g-new', tree: RC.treeOf(cand), treeSha256: 't' })
  return { r, b, cand, verify }
}
const links = (b) => [linkOf(join(b, 'current')), linkOf(join(b, 'previous'))]
const residue = (b) => readdirSync(b).filter((n) => n.startsWith('.'))

{
  const s = synth('dry')
  const before = treeSnap(s.r)
  const d = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', verify: s.verify })
  ok('반례10 dry-run — 계획만 · 연구 파일 쓰기 0', d.code === 'DRY_RUN' && treeSnap(s.r) === before, d)
  const w = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', verify: s.verify, write: true })
  ok('반례1 정상 후보 → current 원자 전환 (current=g-new · previous=g-old · 조각 0)', w.code === 'INSTALLED' && JSON.stringify(links(s.b)) === '["g-new","g-old"]' && residue(s.b).length === 0 &&
    readFileSync(join(s.b, 'g-new', 'x.txt'), 'utf8') === 'new', { w, links: links(s.b), residue: residue(s.b) })
  const again = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', verify: s.verify, write: true })
  ok('CAS — 낡은 expect-current 로 다시 설치하면 CAS 충돌 · 그대로', again.code === 'RESEARCH_CURRENT_CAS_CONFLICT' && JSON.stringify(links(s.b)) === '["g-new","g-old"]', again)
  const rb = RC.rollbackCurrent({ researchDir: s.r, expectCurrent: 'g-new', expectPrevious: 'g-old', write: true, knownLegacy: { 'g-old': {} } })
  ok('반례9 rollback — current 가 옛 판으로 정확히 복귀 (current=g-old · previous=g-new)', rb.code === 'ROLLED_BACK' && JSON.stringify(links(s.b)) === '["g-old","g-new"]' && residue(s.b).length === 0, { rb, links: links(s.b) })
  const unknown = RC.rollbackCurrent({ researchDir: s.r, expectCurrent: 'g-old', expectPrevious: 'g-new', knownLegacy: {} })
  ok('rollback 대상 신원 — 고정 legacy 도 제품 build 도 아니면 ROLLBACK_TARGET_UNKNOWN · 링크 그대로', unknown.code === 'ROLLBACK_TARGET_UNKNOWN' && JSON.stringify(links(s.b)) === '["g-old","g-new"]', unknown)
  writeFileSync(join(s.b, 'g-new', 'x.txt'), 'tampered')
  writeFileSync(join(s.b, 'g-old', 'edges.jsonl'), 'tampered\n')
  const drift = RC.rollbackCurrent({ researchDir: s.r, expectCurrent: 'g-old', expectPrevious: 'g-new', knownLegacy: { 'g-new': {} } })
  ok('rollback 대상 바이트가 manifest 와 다르면 거부 (legacy 판도 파일 해시로 본다)', drift.ok === false, drift)
}
{
  const s = synth('cas')
  const before = links(s.b)
  const r = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', verify: s.verify, write: true,
    hooks: { 'previous-swapped': () => { rmSync(join(s.b, 'current')); symlinkSync('g-older', join(s.b, 'current')) } } })
  ok('반례6 판독 뒤 다른 writer 가 current 교체 → CAS 충돌 · 상대 값(g-older) 보존 · journal 남김', r.code === 'RESEARCH_CURRENT_CAS_CONFLICT' && linkOf(join(s.b, 'current')) === 'g-older' &&
    existsSync(join(s.b, RC.JOURNAL_NAME)), { r, links: links(s.b), before })
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  ok('반례6 뒤 recover — current 가 tx 의 from·target 이 아니면 아무것도 바꾸지 않고 RECOVERY_REQUIRED', rec.code === 'RECOVERY_REQUIRED' && linkOf(join(s.b, 'current')) === 'g-older', rec)
}
{
  const s = synth('lock')
  writeFileSync(join(s.b, RC.LOCK_NAME), JSON.stringify({ txId: 'other', pid: process.pid }))
  const r = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', verify: s.verify, write: true })
  ok('다른 writer 잠금 → RESEARCH_CURRENT_LOCKED HOLD · 잠금 보존 · current 그대로', r.code === 'RESEARCH_CURRENT_LOCKED' && existsSync(join(s.b, RC.LOCK_NAME)) && JSON.stringify(links(s.b)) === '["g-old","g-older"]', r)
}
{
  const s = synth('slot')
  mkdirSync(join(s.b, 'g-new')); writeFileSync(join(s.b, 'g-new', 'x.txt'), 'other')
  const r = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', verify: s.verify, write: true })
  ok('no-clobber — 같은 판 폴더가 다른 바이트로 있으면 CANDIDATE_SLOT_TAKEN · 그 폴더 보존', r.code === 'CANDIDATE_SLOT_TAKEN' && readFileSync(join(s.b, 'g-new', 'x.txt'), 'utf8') === 'other', r)
}
// 반례7 — 단계별 실패(throw) → 기존 current 보존 · recover 로 원상
for (const at of ['staged', 'installed', 'previous-linked', 'current-linked']) {
  const s = synth(`throw-${at}`)
  process.env.SORAN_RESEARCH_CURRENT_TEST = '1'
  process.env.SORAN_RESEARCH_CURRENT_FAULT = `throw@${at}`
  const r = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', verify: s.verify, write: true })
  delete process.env.SORAN_RESEARCH_CURRENT_FAULT
  ok(`반례7 ${at} 실패 → current=g-old 보존 · journal 남김(RECOVERY_REQUIRED)`, !r.ok && linkOf(join(s.b, 'current')) === 'g-old' && r.recovery === 'RECOVERY_REQUIRED', { r, links: links(s.b) })
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  ok(`반례7 ${at} 뒤 recover → 원상(current=g-old · previous=g-older) · 조각 0`, rec.code === 'RECOVERED_NOT_SWITCHED' && JSON.stringify(links(s.b)) === '["g-old","g-older"]' && residue(s.b).length === 0, { rec, links: links(s.b), residue: residue(s.b) })
}
// 반례8 — 단계별 실제 SIGKILL → 다음 명시적 recover 로 복구
const LIB = pathToFileURL(join(HERE, 'lib', 'magazine-research-current.mjs')).href
for (const [at, want, links2] of [['journaled', 'RECOVERED_NOT_SWITCHED', '["g-old","g-older"]'], ['staged', 'RECOVERED_NOT_SWITCHED', '["g-old","g-older"]'],
  ['previous-swapped', 'RECOVERED_NOT_SWITCHED', '["g-old","g-older"]'], ['current-linked', 'RECOVERED_NOT_SWITCHED', '["g-old","g-older"]'], ['current-swapped', 'RECOVERED_SWITCHED', '["g-new","g-old"]']]) {
  const s = synth(`kill-${at}`)
  const child = join(TMP, `kill-${at}.mjs`)
  writeFileSync(child, `const RC = await import(${JSON.stringify(LIB)})
RC.installCandidate({ researchDir: ${JSON.stringify(s.r)}, candidateDir: ${JSON.stringify(s.cand)}, expectCurrent: 'g-old', write: true,
  verify: () => ({ ok: true, graphVersion: 'g-new', tree: RC.treeOf(${JSON.stringify(s.cand)}), treeSha256: 't' }) })
`)
  const k = spawnSync(process.execPath, [child], { env: { ...process.env, SORAN_RESEARCH_CURRENT_TEST: '1', SORAN_RESEARCH_CURRENT_FAULT: `kill@${at}` }, encoding: 'utf8' })
  const dry = RC.recoverCurrent({ researchDir: s.r })
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  ok(`반례8 ${at} 실제 SIGKILL → recover dry-run 은 쓰기 0 · --write 로 ${want} · 링크 ${links2} · lock·조각 0`,
    k.signal === 'SIGKILL' && dry.code === 'DRY_RUN' && rec.code === want && JSON.stringify(links(s.b)) === links2 && residue(s.b).length === 0, { signal: k.signal, dry: dry.code, rec, links: links(s.b), residue: residue(s.b) })
}
{
  const s = synth('rb-kill')
  RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', verify: s.verify, write: true })
  const child = join(TMP, 'rb-kill.mjs')
  writeFileSync(child, `const RC = await import(${JSON.stringify(LIB)})
RC.rollbackCurrent({ researchDir: ${JSON.stringify(s.r)}, expectCurrent: 'g-new', expectPrevious: 'g-old', write: true, knownLegacy: { 'g-old': {} } })
`)
  const k = spawnSync(process.execPath, [child], { env: { ...process.env, SORAN_RESEARCH_CURRENT_TEST: '1', SORAN_RESEARCH_CURRENT_FAULT: 'kill@rollback-current-swapped' }, encoding: 'utf8' })
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  ok('반례8 rollback 중 SIGKILL → recover 가 rollback 을 끝낸다 (current=g-old · previous=g-new)', k.signal === 'SIGKILL' && rec.code === 'RECOVERED_SWITCHED' && JSON.stringify(links(s.b)) === '["g-old","g-new"]', { rec, links: links(s.b) })
}
{
  const s = synth('orphan')
  writeFileSync(join(s.b, '.swap-zzz-current'), 'x')
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  ok('journal 없는 조각 → 지우지 않고 RECOVERY_REQUIRED', rec.code === 'RECOVERY_REQUIRED' && existsSync(join(s.b, '.swap-zzz-current')), rec)
  const inst = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', verify: s.verify, write: true })
  writeFileSync(join(s.b, RC.JOURNAL_NAME), '{}')
  const inst2 = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: inst.ok ? 'g-new' : 'g-old', verify: s.verify, write: true })
  ok('journal 이 남아 있으면 새 전환 대신 RECOVERY_REQUIRED', inst2.code === 'RECOVERY_REQUIRED', inst2)
}

// ─────────────────────────────────────────────────────────
// ② 실제 입력 — 연구 사본 · 제품 builder 후보 · 소비자 · graph-check
// ─────────────────────────────────────────────────────────
const REAL = argOf('--research')
const SNAP_NAME = '2026-11-02-money-work-age-learning-live'
const EXPECT = { graphVersion: 'g-20261102-427d4d', semanticHash: '4aacc9d7b38c25cd', exportHash: 'cb57795ed0dd8ec4', bundleSha256: '26988e25fd06671563ff855418add012d6614083021b54b77a7db95d9d5c10bf' }
const run = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1e8, ...opts })
if (REAL) {
  const R = join(TMP, 'research')
  cpSync(resolve(REAL), R, { recursive: true, verbatimSymlinks: true })
  const snap = join(R, 'reconciled', SNAP_NAME)
  const realBefore = treeSnap(join(resolve(REAL), 'contract', 'build'))
  // 제품 builder 후보 (CLI 그대로)
  const out = join(TMP, 'cand-out')
  const b = run([join(HERE, 'magazine-graph-build.mjs'), '--input-root', snap, '--product-root', ROOT, '--effective-at', '2026-11-02T11:00:00+09:00', '--generated-at', '2026-11-02T02:00:00.000Z', '--out-dir', out, '--admission-root', R])
  const cand = join(out, EXPECT.graphVersion)
  ok('후보 — 제품 builder CLI 산출', b.status === 0 && existsSync(join(cand, 'manifest.json')), b.stdout.slice(0, 300) + b.stderr.slice(0, 300))
  const V = (dir) => { try { return RC.verifyCandidate({ candidateDir: dir, snapshotDir: snap, productRoot: ROOT, researchDir: R, expect: EXPECT,
    fixtureBundle: readFileSync(join(HERE, '__fixtures__', 'magazine', 'rehearsal-direct-e2e', 'g-20261102-427d4d.ts.txt'), 'utf8') }) } catch (e) { return { ok: false, code: e.code, why: e.why, detail: e.detail } } }
  const good = V(cand)
  let fxDrift
  try { RC.verifyCandidate({ candidateDir: cand, snapshotDir: snap, productRoot: ROOT, researchDir: R, expect: EXPECT, fixtureBundle: 'drifted fixture' }); fxDrift = { code: 'NONE' } } catch (e) { fxDrift = { code: e.code } }
  ok('D 같은 판 DIRECT_E2E fixture bundle 과 바이트가 다르면 → CANDIDATE_FIXTURE_BUNDLE_DRIFT', fxDrift.code === 'CANDIDATE_FIXTURE_BUNDLE_DRIFT', fxDrift)
  ok('B 정상 후보 검증 — 판 · semantic · export · bundle · 파일↔manifest · existingAssetRelation · lifecycle · 재계산 바이트 · fixture bundle', good.ok === true, good)
  // 변조 반례
  const tamper = (label, f) => { const d = join(TMP, `t-${label}`); cpSync(cand, d, { recursive: true }); f(d); return V(d) }
  const edit = (d, n, fn) => writeFileSync(join(d, n), fn(readFileSync(join(d, n), 'utf8')))
  const mani = (d, fn) => { const m = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')); fn(m); writeFileSync(join(d, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`) }
  for (const n of ['intents.jsonl', 'edges.jsonl', 'mappings.jsonl', 'participation.jsonl']) {
    const r = tamper(n, (d) => edit(d, n, (t) => t.replace('"', '"​')))
    ok(`반례3 ${n} 한 글자 변조 → CANDIDATE_CONTENT_HASH`, r.code === 'CANDIDATE_CONTENT_HASH', r)
  }
  ok('반례4 manifest 필드(counts) 변조 → CANDIDATE_NOT_REBUILT', tamper('mcount', (d) => mani(d, (m) => { m.counts.edges += 1 })).code === 'CANDIDATE_NOT_REBUILT')
  ok('반례4 semanticHash 변조 → CANDIDATE_SEMANTIC_HASH', tamper('msem', (d) => mani(d, (m) => { m.semanticHash = '0'.repeat(16) })).code === 'CANDIDATE_SEMANTIC_HASH')
  ok('반례4 exportHash 변조 → CANDIDATE_EXPORT_HASH', tamper('mexp', (d) => mani(d, (m) => { m.exportHash = '0'.repeat(16) })).code === 'CANDIDATE_EXPORT_HASH')
  ok('반례4 bundle 한 글자 변조 → CANDIDATE_BUNDLE_HASH', tamper('bundle', (d) => edit(d, join('bundle', `${EXPECT.graphVersion}.ts`), (t) => t.replace('"edges"', '"edges" '))).code === 'CANDIDATE_BUNDLE_HASH')
  // 옛 연구 builder 산출 — 그대로 · 같은 schema 로 위조해도
  const rbOut = join(TMP, 'rb-out')
  const rb = run([join(R, 'contract', 'build-graph.mjs'), '--in', join('reconciled', SNAP_NAME), '--out-dir', rbOut], { cwd: R })
  const rbDir = existsSync(rbOut) ? join(rbOut, readdirSync(rbOut).find((n) => n.startsWith('g-')) ?? 'none') : null
  const rbr = rbDir && existsSync(rbDir) ? V(rbDir) : { code: 'NO_RESEARCH_BUILD', why: rb.stderr.slice(0, 200) }
  ok('반례2 옛 연구 builder 후보(3d32a6) → CANDIDATE_NOT_PRODUCT_BUILD', rbDir?.endsWith('g-20261102-3d32a6') && rbr.code === 'CANDIDATE_NOT_PRODUCT_BUILD', { rbDir, rbr })
  const forged = tamper('forged', (d) => {
    cpSync(join(rbDir, 'intents.jsonl'), join(d, 'intents.jsonl'))
    mani(d, (m) => { m.contentHash.intents = sha(readFileSync(join(d, 'intents.jsonl'))).slice(0, 16) })
  })
  ok('반례5 existingAssetRelation 을 연구 builder(automation 옛 값)로 되돌림 · manifest 해시까지 맞춤 → CANDIDATE_ASSET_RELATION_STALE (23 intent)', forged.code === 'CANDIDATE_ASSET_RELATION_STALE' && forged.detail?.stale?.length === 23, { code: forged.code, stale: forged.detail?.stale?.length })
  // 실제 전환 — 연구 사본에서 CLI 그대로
  const cli = (...a) => run([join(HERE, 'magazine-research-current.mjs'), ...a])
  const common = ['--research-dir', R, '--candidate-dir', cand, '--snapshot', snap, '--product-root', ROOT, '--expect-graph-version', EXPECT.graphVersion,
    '--expect-semantic', EXPECT.semanticHash, '--expect-export', EXPECT.exportHash, '--expect-bundle-sha256', EXPECT.bundleSha256]
  const cv = cli('verify', ...common.filter((x, i, a) => !(x === '--research-dir' || a[i - 1] === '--research-dir')), '--research-dir', R)
  let cvj = null; try { cvj = JSON.parse(cv.stdout) } catch { cvj = null }
  ok('D CLI verify — 같은 판 fixture bundle 을 실제로 대조했다 (fixtureBundleCompared)', cv.status === 0 && cvj?.code === 'VERIFIED' && cvj.fixtureBundleCompared === true, cv.stdout.slice(0, 300))
  const oldCur = linkOf(join(R, 'contract', 'build', 'current'))
  const beforeDry = treeSnap(join(R, 'contract'))
  const dry = cli('install', ...common, '--expect-current', oldCur)
  ok('반례10 실제 install dry-run — 연구 사본 contract 쓰기 0', dry.status === 0 && JSON.parse(dry.stdout).code === 'DRY_RUN' && treeSnap(join(R, 'contract')) === beforeDry, dry.stdout.slice(0, 300))
  const w = cli('install', ...common, '--expect-current', oldCur, '--write')
  const B = join(R, 'contract', 'build')
  ok('반례1 실제 install — current=427d4d · previous=옛 current · 설치 판 = 후보 바이트', w.status === 0 && linkOf(join(B, 'current')) === EXPECT.graphVersion && linkOf(join(B, 'previous')) === oldCur &&
    JSON.stringify(RC.treeOf(join(B, EXPECT.graphVersion))) === JSON.stringify(RC.treeOf(cand)), w.stdout.slice(0, 300))
  // 소비자 — 연구 도구는 형제 `soransoran-magazine-runtime` 의 제품 파일을 읽는다 → 이 제품 저장소를 그 자리에 (읽기만)
  symlinkSync(ROOT, join(TMP, 'soransoran-magazine-runtime'))
  for (const t of ['m3-reconcile', 'm3-rank', 'm3-slug']) {
    const r = run([join(R, 'contract', `${t}.mjs`)], { cwd: R })
    ok(`B 소비자 ${t} — 새 current 로 종료 0`, r.status === 0, r.stderr.slice(-300))
  }
  // 승격 판 제품 사본 (tmp) — graph-check · G8 dry-run · ArticlePlan prepare(--research-dir)
  const P = join(TMP, 'product-promoted')
  const P0 = join(TMP, 'product-current')
  for (const dst of [P, P0]) {
    const files = spawnSync('/usr/bin/git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
    for (const f of files) { mkdirSync(dirname(join(dst, f)), { recursive: true }); cpSync(join(ROOT, f), join(dst, f)) }
    symlinkSync(join(ROOT, 'node_modules'), join(dst, 'node_modules'))
  }
  const G = join(P, 'src', 'content', 'magazine', 'graph')
  const prevGv = /from '\.\/(g-[0-9a-f-]+)'/.exec(readFileSync(join(G, 'current.ts'), 'utf8'))[1]
  cpSync(join(cand, 'bundle', `${EXPECT.graphVersion}.ts`), join(G, `${EXPECT.graphVersion}.ts`))
  writeFileSync(join(G, 'current.ts'), readFileSync(join(G, 'current.ts'), 'utf8').replace(`'./${prevGv}'`, `'./${EXPECT.graphVersion}'`))
  writeFileSync(join(G, 'control.ts'), readFileSync(join(G, 'control.ts'), 'utf8').replace(`graphVersion: '${prevGv}',`, `graphVersion: '${EXPECT.graphVersion}',`).replace(/previousGraphVersion: '[^']*',/, `previousGraphVersion: '${prevGv}',`))
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx')
  const gc = (dir) => { const r = spawnSync(tsx, ['scripts/magazine-graph-check.mts'], { cwd: dir, encoding: 'utf8', maxBuffer: 1e8 }); return (/(\d+) PASS · (\d+) FAIL/.exec(r.stdout) ?? []).slice(1).map(Number) }
  const gcCand = gc(P)
  const gcCur = gc(P0)
  ok('반례12 candidate 판 graph-check 339/0', JSON.stringify(gcCand) === '[339,0]', gcCand)
  ok('반례13 지금 current(081d9a) graph-check 336/3 그대로 재현 — 수리가 실패를 숨기지 않는다', JSON.stringify(gcCur) === '[336,3]', gcCur)
  const g8 = run([join(P, 'scripts', 'magazine-g8-promote.mjs'), '--snapshot', snap, '--research', R, '--repo', P, '--at', '2026-11-02T11:00:00+09:00', '--out', join(TMP, 'g8.json')], { cwd: P })
  const g8m = existsSync(join(TMP, 'g8.json')) ? JSON.parse(readFileSync(join(TMP, 'g8.json'), 'utf8')) : null
  ok('B G8 dry-run (새 current · 승격 판) — manifest b5dc90be… · 후보 I-T6-03 하나', g8.status === 0 && g8m?.hash === 'b5dc90be4649d59760c03aefd1c6cc68055e13300c15322689cc8b0ef06839c0' &&
    JSON.stringify(g8m.admissions.map((a) => a.intentId)) === '["I-T6-03"]', g8.stdout.slice(-300))
  // ArticlePlan prepare 는 G8 receipt 가 있어야 한다 — 버리는 연구 사본(RH)에만 apply 리허설 (실제 연구 장부 0)
  const RH = join(TMP, 'research-rehearsal')
  cpSync(R, RH, { recursive: true, verbatimSymlinks: true })
  const ap = run([join(P, 'scripts', 'magazine-g8-promote.mjs'), '--apply', '--manifest', join(TMP, 'g8.json'), '--confirm-hash', g8m?.hash ?? '-', '--snapshot', join(RH, 'reconciled', SNAP_NAME), '--research', RH, '--repo', P,
    '--approved-by', 'REHEARSAL-check-not-approval', '--approved-at', '2026-11-02T11:00:00+09:00', '--committed-at', '2026-11-02T11:00:00+09:00'], { cwd: P })
  const asOf = `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19)}+09:00`
  const prep = run([join(P, 'scripts', 'magazine-direct-spec-source-authoring.mjs'), 'prepare', '--slug', 'resume-age', '--as-of', asOf, '--repo', P, '--admission-root', RH, '--research-dir', RH], { cwd: P })
  let pj = null; try { pj = JSON.parse(prep.stdout) } catch { pj = null }
  ok('B ArticlePlan prepare --research-dir (새 current) — DRAFT · INTENTS_HASH_EQUAL · relationsUsable', ap.status === 0 && pj?.status === 'DRAFT' && pj.research?.reason === 'INTENTS_HASH_EQUAL' && pj.research?.relationsUsable === true, { apply: ap.status, prep: prep.stdout.slice(0, 300) })
  // 옛 current 로 되돌리면 --research-dir 가 막힌다
  const rbk = cli('rollback', '--research-dir', RH, '--expect-current', EXPECT.graphVersion, '--expect-previous', oldCur, '--write')
  const prepOld = run([join(P, 'scripts', 'magazine-direct-spec-source-authoring.mjs'), 'prepare', '--slug', 'resume-age', '--as-of', asOf, '--repo', P, '--admission-root', RH, '--research-dir', RH], { cwd: P })
  let po = null; try { po = JSON.parse(prepOld.stdout) } catch { po = null }
  ok('반례9 실제 rollback → current 가 옛 판으로 정확히 복귀', rbk.status === 0 && linkOf(join(RH, 'contract', 'build', 'current')) === oldCur && linkOf(join(RH, 'contract', 'build', 'previous')) === EXPECT.graphVersion, rbk.stdout.slice(0, 300))
  ok('B 옛 current 를 --research-dir 로 쓰면 RESEARCH_INTENT_HASH_MISMATCH', po?.code === 'RESEARCH_INTENT_HASH_MISMATCH', prepOld.stdout.slice(0, 300))
  // C build-check — 계약 없는 snapshot 은 SKIP 이 아니라 FAIL (부모 snapshot 을 넣어 본다)
  const bcU = run([join(HERE, 'magazine-graph-build-check.mjs'), '--final-input', join(R, 'reconciled', '2026-11-01-money-work-resume-i-t6-03'), '--real-product', ROOT])
  ok('C build-check 에 계약 없는 snapshot → 종료 1 · 「계약 없는 snapshot」', bcU.status === 1 && bcU.stdout.includes('계약 없는 snapshot'), bcU.stdout.slice(-300))
  ok('실제 연구 저장소 contract/build 바이트·링크 불변', treeSnap(join(resolve(REAL), 'contract', 'build')) === realBefore)
} else {
  results.push('  ⏭  실제 입력 — --research 미지정 (통과로 세지 않는다)')
}

rmSync(TMP, { recursive: true, force: true })
process.stdout.write(`연구 current 전환 검사\n${results.join('\n')}\nRESULT pass=${pass} fail=${failN}\n`)
process.exit(failN ? 1 : 0)
