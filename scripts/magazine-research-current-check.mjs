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
import { spawn, spawnSync } from 'node:child_process'
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
// ① hermetic — 합성 연구 폴더 · 후보 검증은 주입 (전환 엔진 · control · fence 만 본다)
// ─────────────────────────────────────────────────────────
const PRODUCT_CONTROL = (gv = 'g-prod', { tripped = false, surfaces = '{"CTA_END":true,"FOOTER_NEXT":true,"FOOTER_SIBLING":true,"FOOTER_BRIDGE":true,"SERIES_NAV":false,"BODY_INLINE_OR_TOP":false,"BODY_CALLOUT":false}' } = {}) =>
  `import type { MagazineGraphControl } from './types'\n\nexport const CONTROL: MagazineGraphControl = {\n  graphVersion: '${gv}',\n  enabled: true,\n  enabledClusters: ['sleep', 'family', 'money-work'],\n  surfaces: ${surfaces},\n  killSwitch: {"tripped":${tripped},"trippedAt":null,"trippedBy":null,"reason":null},\n  previousGraphVersion: 'g-prev',\n} as const\n`
const IMPLEMENTED = ['CTA_END', 'FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE']
function synth(label, { productControl = PRODUCT_CONTROL() } = {}) {
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
  writeFileSync(join(b, 'control.json'), `${JSON.stringify({ schemaVersion: 'control/1', graphVersion: 'g-old', enabled: false, previousGraphVersion: 'g-older' }, null, 2)}`)
  const cand = join(r, 'cand')
  mkdirSync(cand, { recursive: true }); writeFileSync(join(cand, 'x.txt'), 'new'); mkdirSync(join(cand, 'bundle')); writeFileSync(join(cand, 'bundle', 'b.ts'), 'b')
  const tree = RC.treeOf(cand)
  const manifest = { productHashes: { 'src/content/magazine/graph/control.ts': sha(PRODUCT_CONTROL()) }, implementedSurfaces: IMPLEMENTED }
  const verify = () => ({ ok: true, graphVersion: 'g-new', tree, treeSha256: sha(JSON.stringify(tree)), manifest })
  return { r, b, cand, verify, productControl, controlSha: () => (existsSync(join(b, 'control.json')) ? sha(readFileSync(join(b, 'control.json'))) : null) }
}
const links = (b) => [linkOf(join(b, 'current')), linkOf(join(b, 'previous'))]
const residue = (b) => readdirSync(b).filter((n) => n.startsWith('.'))
const ctl = (b) => { try { return JSON.parse(readFileSync(join(b, 'control.json'), 'utf8')) } catch { return {} } }
const install = (s, extra = {}) => RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', expectControlSha256: s.controlSha(), productControlText: s.productControl, verify: s.verify, write: true, ...extra })
const triple = (s) => JSON.stringify([...links(s.b), ctl(s.b).graphVersion, ctl(s.b).previousGraphVersion])

{
  const s = synth('dry')
  const before = treeSnap(s.r)
  const d = install(s, { write: false })
  ok('반례10 dry-run — 계획(새 control 포함)만 · 연구 파일 쓰기 0', d.code === 'DRY_RUN' && d.plan.control.graphVersion === 'g-new' && treeSnap(s.r) === before, d.code)
  const w = install(s)
  const c = ctl(s.b)
  ok('반례1 정상 install → current=g-new · previous=g-old · control.graphVersion=g-new · control.previousGraphVersion=g-old · 조각 0', w.code === 'INSTALLED' && triple(s) === '["g-new","g-old","g-new","g-old"]' && residue(s.b).length === 0, { w: w.code, triple: triple(s) })
  ok('control 권위 — enabled·clusters·surfaces 는 제품 control.ts · killSwitch 꺼짐 · authority(제품 control sha · 후보 트리 sha)', c.enabled === true && JSON.stringify(c.enabledClusters) === '["family","money-work","sleep"]' &&
    c.surfaces?.FOOTER_NEXT === true && c.surfaces?.SERIES_NAV === false && c.killSwitch?.tripped === false && c.authority?.productControlSha256 === sha(PRODUCT_CONTROL()) && c.authority?.candidateTreeSha256 === sha(JSON.stringify(RC.treeOf(s.cand))), c)
  const chk = RC.checkCurrent({ researchDir: s.r, knownLegacy: { 'g-old': {} } })
  ok('공식 check — 합성 판은 제품 builder 산출이 아니라 거부 (control 일치 항목은 문제 없음)', chk.ok === false && chk.problems.every((x) => !x.startsWith('control')), chk.problems)
  const again = install(s)
  ok('CAS — 낡은 expect-current 로 다시 설치하면 CAS 충돌 · 그대로', again.code === 'RESEARCH_CURRENT_CAS_CONFLICT' && triple(s) === '["g-new","g-old","g-new","g-old"]', again)
  const rb = RC.rollbackCurrent({ researchDir: s.r, expectCurrent: 'g-new', expectPrevious: 'g-old', expectControlSha256: s.controlSha(), write: true, knownLegacy: { 'g-old': {} } })
  ok('반례9 rollback — current·previous·control 이 옛 판으로 (g-old · g-new · control g-old/g-new)', rb.code === 'ROLLED_BACK' && triple(s) === '["g-old","g-new","g-old","g-new"]' && residue(s.b).length === 0, { rb: rb.code, triple: triple(s) })
  const unknown = RC.rollbackCurrent({ researchDir: s.r, expectCurrent: 'g-old', expectPrevious: 'g-new', expectControlSha256: s.controlSha(), knownLegacy: {} })
  ok('rollback 대상 신원 — 고정 legacy 도 제품 build 도 아니면 ROLLBACK_TARGET_UNKNOWN · 그대로', unknown.code === 'ROLLBACK_TARGET_UNKNOWN' && triple(s) === '["g-old","g-new","g-old","g-new"]', unknown)
}
{
  const s = synth('ctl-drift')
  const before = treeSnap(s.r)
  const r = RC.installCandidate({ researchDir: s.r, candidateDir: s.cand, expectCurrent: 'g-old', expectControlSha256: '0'.repeat(64), productControlText: s.productControl, verify: s.verify, write: true })
  ok('반례2 control drift(기대 sha 와 다름) → RESEARCH_CONTROL_CAS_CONFLICT · 쓰기 0', r.code === 'RESEARCH_CONTROL_CAS_CONFLICT' && treeSnap(s.r) === before, r)
}
for (const [label, pc, code] of [['contradict', PRODUCT_CONTROL('g-other'), 'CONTROL_PRODUCT_CONTRADICTS_CANDIDATE'], ['tripped', PRODUCT_CONTROL('g-new', { tripped: true }), 'CONTROL_KILL_SWITCH_TRIPPED'],
  ['surface', PRODUCT_CONTROL('g-new', { surfaces: '{"CTA_END":true,"SERIES_NAV":true}' }), 'CONTROL_SURFACE_NOT_IMPLEMENTED'], ['unreadable', 'export const NOPE = 1', 'CONTROL_PRODUCT_UNREADABLE']]) {
  const s = synth(`ctl-${label}`, { productControl: pc })
  const before = treeSnap(s.r)
  const r = install(s)
  ok(`control 모순 반례(${label}) → ${code} · 쓰기 0`, r.code === code && treeSnap(s.r) === before, r)
}
{
  const s = synth('ctl-third')
  const r = install(s, { hooks: { 'current-swapped': () => writeFileSync(join(s.b, 'control.json'), 'THIRD PARTY') } })
  ok('반례6 다른 writer 가 control 변경 → CAS 충돌 · 외부 바이트 보존 · journal 남김', r.code === 'RESEARCH_CURRENT_CAS_CONFLICT' && readFileSync(join(s.b, 'control.json'), 'utf8') === 'THIRD PARTY' && existsSync(join(s.b, RC.JOURNAL_NAME)), r)
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  ok('반례6 뒤 recover — 제삼자 control 바이트는 덮지 않고 RECOVERY_REQUIRED', rec.code === 'RECOVERY_REQUIRED' && readFileSync(join(s.b, 'control.json'), 'utf8') === 'THIRD PARTY', rec)
}
{
  const s = synth('cas-link')
  const r = install(s, { hooks: { 'previous-swapped': () => { rmSync(join(s.b, 'current')); symlinkSync('g-older', join(s.b, 'current')) } } })
  ok('판독 뒤 다른 writer 가 current 교체 → CAS 충돌 · 상대 값(g-older) 보존', r.code === 'RESEARCH_CURRENT_CAS_CONFLICT' && linkOf(join(s.b, 'current')) === 'g-older', r)
  ok('그 뒤 recover — current 가 tx 값이 아니면 RECOVERY_REQUIRED · 그대로', RC.recoverCurrent({ researchDir: s.r, write: true }).code === 'RECOVERY_REQUIRED' && linkOf(join(s.b, 'current')) === 'g-older')
}
{
  const s = synth('lock')
  writeFileSync(join(s.b, RC.LOCK_NAME), JSON.stringify({ txId: 'other', pid: process.pid }))
  const r = install(s)
  ok('다른 writer 잠금 → RESEARCH_CURRENT_LOCKED HOLD · 잠금 보존 · 그대로', r.code === 'RESEARCH_CURRENT_LOCKED' && existsSync(join(s.b, RC.LOCK_NAME)) && JSON.stringify(links(s.b)) === '["g-old","g-older"]', r)
}
{
  const s = synth('slot')
  mkdirSync(join(s.b, 'g-new')); writeFileSync(join(s.b, 'g-new', 'x.txt'), 'other')
  const r = install(s)
  ok('no-clobber — 같은 판 폴더가 다른 바이트로 있으면 CANDIDATE_SLOT_TAKEN · 그 폴더 보존', r.code === 'CANDIDATE_SLOT_TAKEN' && readFileSync(join(s.b, 'g-new', 'x.txt'), 'utf8') === 'other', r)
}
// 반례7 — 단계별 실패(throw) → 세 항목 보존 · recover 로 원상
for (const at of ['staged', 'installed', 'previous-linking', 'current-linking']) {
  const s = synth(`throw-${at}`)
  const c0 = s.controlSha()
  process.env.SORAN_RESEARCH_CURRENT_TEST = '1'
  process.env.SORAN_RESEARCH_CURRENT_FAULT = `throw@${at}`
  const r = install(s)
  delete process.env.SORAN_RESEARCH_CURRENT_FAULT
  ok(`반례7 ${at} 실패 → current=g-old · control 그대로 · journal 남김`, !r.ok && linkOf(join(s.b, 'current')) === 'g-old' && s.controlSha() === c0 && r.recovery === 'RECOVERY_REQUIRED', { r, links: links(s.b) })
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  ok(`반례7 ${at} 뒤 recover → 원상(g-old · g-older · control 원래 바이트) · 조각 0`, rec.code === 'RECOVERED_NOT_SWITCHED' && JSON.stringify(links(s.b)) === '["g-old","g-older"]' && s.controlSha() === c0 && residue(s.b).length === 0, { rec, residue: residue(s.b) })
}
// 반례3·4·8 — 단계별 실제 SIGKILL → 다음 명시적 recover 가 세 항목을 한 상태로
const LIB = pathToFileURL(join(HERE, 'lib', 'magazine-research-current.mjs')).href
const killChild = (s, at, body) => {
  const child = join(TMP, `kill-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(child, `const RC = await import(${JSON.stringify(LIB)})\n${body}\n`)
  return spawnSync(process.execPath, [child], { env: { ...process.env, SORAN_RESEARCH_CURRENT_TEST: '1', SORAN_RESEARCH_CURRENT_FAULT: `kill@${at}` }, encoding: 'utf8' })
}
for (const [at, want, tri] of [['journaled', 'RECOVERED_NOT_SWITCHED', null], ['staged', 'RECOVERED_NOT_SWITCHED', null], ['previous-swapped', 'RECOVERED_NOT_SWITCHED', null],
  ['current-swapped', 'RECOVERED_SWITCHED', '["g-new","g-old","g-new","g-old"]'], ['control-written', 'RECOVERED_SWITCHED', '["g-new","g-old","g-new","g-old"]']]) {
  const s = synth(`kill-${at}`)
  const c0 = readFileSync(join(s.b, 'control.json'), 'utf8')
  const k = killChild(s, at, `const tree = RC.treeOf(${JSON.stringify(s.cand)})
RC.installCandidate({ researchDir: ${JSON.stringify(s.r)}, candidateDir: ${JSON.stringify(s.cand)}, expectCurrent: 'g-old', expectControlSha256: ${JSON.stringify(s.controlSha())}, write: true,
  productControlText: ${JSON.stringify(s.productControl)},
  verify: () => ({ ok: true, graphVersion: 'g-new', tree, treeSha256: ${JSON.stringify(sha(JSON.stringify(RC.treeOf(s.cand))))}, manifest: ${JSON.stringify(s.verify().manifest)} }) })`)
  const dry = RC.recoverCurrent({ researchDir: s.r })
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  const state = tri ? triple(s) : JSON.stringify([...links(s.b), readFileSync(join(s.b, 'control.json'), 'utf8') === c0])
  const wantState = tri ?? '["g-old","g-older",true]'
  const label = at === 'current-swapped' ? '반례3 current 교체 뒤 control 전' : at === 'control-written' ? '반례4 control 교체 뒤 journal 정리 전' : `반례8 ${at}`
  ok(`${label} 실제 SIGKILL → recover dry-run 쓰기 0 · --write 로 ${want} · 세 항목 ${wantState} · lock·조각 0`, k.signal === 'SIGKILL' && dry.code === 'DRY_RUN' && rec.code === want && state === wantState && residue(s.b).length === 0,
    { signal: k.signal, dry: dry.code, rec: rec.code, state, residue: residue(s.b) })
}
// 반례5 — rollback 단계별 실제 SIGKILL
for (const at of ['rollback-journaled', 'rollback-previous-swapped', 'rollback-current-swapped', 'rollback-control-written']) {
  const s = synth(`rbkill-${at}`)
  install(s)
  const c1 = s.controlSha()
  const k = killChild(s, at, `RC.rollbackCurrent({ researchDir: ${JSON.stringify(s.r)}, expectCurrent: 'g-new', expectPrevious: 'g-old', expectControlSha256: ${JSON.stringify(c1)}, write: true, knownLegacy: { 'g-old': {} } })`)
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  const t = triple(s)
  const okState = (rec.code === 'RECOVERED_SWITCHED' && t === '["g-old","g-new","g-old","g-new"]') || (rec.code === 'RECOVERED_NOT_SWITCHED' && t === '["g-new","g-old","g-new","g-old"]' && s.controlSha() === c1)
  ok(`반례5 rollback ${at} 실제 SIGKILL → recover 가 세 항목을 rollback 전·후 한 상태로 (${rec.code})`, k.signal === 'SIGKILL' && okState && residue(s.b).length === 0, { rec: rec.code, t })
}
{
  const s = synth('orphan')
  writeFileSync(join(s.b, '.swap-zzz-current'), 'x')
  const rec = RC.recoverCurrent({ researchDir: s.r, write: true })
  ok('journal 없는 조각 → 지우지 않고 RECOVERY_REQUIRED', rec.code === 'RECOVERY_REQUIRED' && existsSync(join(s.b, '.swap-zzz-current')), rec)
  rmSync(join(s.b, '.swap-zzz-current'))
  writeFileSync(join(s.b, RC.JOURNAL_NAME), '{}')
  ok('journal 이 남아 있으면 새 전환 대신 RECOVERY_REQUIRED', install(s).code === 'RECOVERY_REQUIRED')
}

// ── legacy fence (hermetic) — 합성 도구 바이트 · 고정 sha 주입 ──
const F = await import(pathToFileURL(join(HERE, 'lib', 'magazine-research-legacy-fence.mjs')).href)
function fenceSynth(label) {
  const r = join(TMP, label)
  mkdirSync(join(r, 'contract'), { recursive: true })
  const tools = {}
  for (const n of ['build-graph', 'promote-graph', 'validate-graph']) {
    const text = `// ${n} 원본\nconsole.log('${n}')\n`
    writeFileSync(join(r, 'contract', `${n}.mjs`), text)
    tools[`contract/${n}.mjs`] = { sha256: sha(text), replacement: 'new', why: 'old' }
  }
  return { r, tools, snap: () => treeSnap(join(r, 'contract')) }
}
const FLIB = pathToFileURL(join(HERE, 'lib', 'magazine-research-legacy-fence.mjs')).href
{
  const f = fenceSynth('fence-ok')
  const s0 = f.snap()
  const dry = F.runFence({ root: f.r, op: 'apply', tools: f.tools })
  ok('fence dry-run — 쓰기 0', dry.code === 'DRY_RUN' && f.snap() === s0, dry)
  const a = F.runFence({ root: f.r, op: 'apply', write: true, tools: f.tools })
  const st = F.fenceStatus(f.r, f.tools)
  ok('fence apply — 세 파일 RETIRED · 백업 OK · journal·lock 0 · receipt', a.code === 'RETIRED' && st.files.every((x) => x.state === 'RETIRED' && x.backup === 'OK') && !st.journal && !st.locked && existsSync(join(f.r, F.FENCE_DIR, 'receipt.json')), st)
  const run3 = spawnSync(process.execPath, [join(f.r, 'contract', 'promote-graph.mjs')], { encoding: 'utf8' })
  ok('퇴역 stub — 실행하면 LEGACY_GRAPH_TOOL_RETIRED · 새 명령 안내 · 종료 3', run3.status === 3 && run3.stderr.includes('LEGACY_GRAPH_TOOL_RETIRED') && run3.stderr.includes('"replacement"'), run3.stderr.slice(0, 200))
  const s1 = f.snap()
  const again = F.runFence({ root: f.r, op: 'apply', write: true, tools: f.tools })
  ok('fence 멱등 — 이미 퇴역된 같은 바이트에 재실행 → ALREADY_RETIRED · 쓰기 0', again.code === 'ALREADY_RETIRED' && f.snap() === s1, again)
  const rb = F.runFence({ root: f.r, op: 'rollback', write: true, tools: f.tools })
  ok('반례10 fence rollback → 세 파일 원래 고정 sha256 복원', rb.code === 'RESTORED' && F.fenceStatus(f.r, f.tools).files.every((x) => x.state === 'ORIGINAL' && x.sha256 === f.tools[x.rel].sha256), rb)
}
{
  const f = fenceSynth('fence-drift')
  writeFileSync(join(f.r, 'contract', 'validate-graph.mjs'), '// 누가 고쳤다\n')
  const s0 = f.snap()
  const a = F.runFence({ root: f.r, op: 'apply', write: true, tools: f.tools })
  ok('반례8 legacy 파일 하나 hash drift → LEGACY_TOOL_DRIFT · 퇴역 적용 0 (나머지 두 파일도 그대로)', a.code === 'LEGACY_TOOL_DRIFT' && f.snap() === s0, a.code)
}
for (const at of ['apply-journaled', 'apply-backed-up:promote-graph.mjs', 'apply-replaced:build-graph.mjs']) {
  const f = fenceSynth(`fence-kill-${at.replace(/[:.]/g, '-')}`)
  const child = join(TMP, `fk-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(child, `const F = await import(${JSON.stringify(FLIB)})\nF.runFence({ root: ${JSON.stringify(f.r)}, op: 'apply', write: true, tools: ${JSON.stringify(f.tools)} })\n`)
  const k = spawnSync(process.execPath, [child], { env: { ...process.env, SORAN_RESEARCH_CURRENT_TEST: '1', SORAN_LEGACY_FENCE_FAULT: `kill@${at}` }, encoding: 'utf8' })
  const mid = F.fenceStatus(f.r, f.tools)
  rmSync(join(f.r, F.FENCE_LOCK), { force: true }) // 🔴 급사한 tx 의 잠금 — 사람이 pid 사망을 확인하고 지운다 (자동으로 지우지 않는다)
  const fin = F.runFence({ root: f.r, op: 'apply', write: true, tools: f.tools })
  const st = F.fenceStatus(f.r, f.tools)
  ok(`반례9 fence apply ${at} 실제 SIGKILL → 같은 명령 재실행으로 완성 (세 파일 RETIRED · 백업 OK · journal 0 · 임시 조각 0)`, k.signal === 'SIGKILL' && Boolean(mid.journal) && fin.code === 'RETIRED' &&
    st.files.every((x) => x.state === 'RETIRED' && x.backup === 'OK') && !st.journal && readdirSync(join(f.r, F.FENCE_DIR)).every((n) => !n.startsWith('.tmp-')), { fin: fin.code, st: st.files.map((x) => x.state) })
}
{
  const f = fenceSynth('fence-race')
  const tgt = join(f.r, 'contract', 'promote-graph.mjs')
  const a = F.runFence({ root: f.r, op: 'apply', write: true, tools: f.tools, hooks: { 'apply-backed-up:promote-graph.mjs': () => writeFileSync(tgt, '// 다른 writer\n') } })
  ok('fence 교체 직전에 다른 writer 가 파일을 바꿈 → LEGACY_TOOL_DRIFT · 그 바이트 보존', a.code === 'LEGACY_TOOL_DRIFT' && readFileSync(tgt, 'utf8') === '// 다른 writer\n', a)
}
{
  const f = fenceSynth('fence-nobackup')
  F.runFence({ root: f.r, op: 'apply', write: true, tools: f.tools })
  const b = existsSync(join(f.r, F.FENCE_DIR)) ? readdirSync(join(f.r, F.FENCE_DIR)).find((n) => n.startsWith('build-graph.mjs.')) : undefined
  if (b) rmSync(join(f.r, F.FENCE_DIR, b))
  ok('fence apply 가 원본 백업을 남겼다 (build-graph)', Boolean(b))
  const s0 = f.snap()
  const r = F.runFence({ root: f.r, op: 'rollback', write: true, tools: f.tools })
  ok('fence rollback — 원본 백업이 없으면 LEGACY_BACKUP_DRIFT · 쓰기 0', r.code === 'LEGACY_BACKUP_DRIFT' && f.snap() === s0, r)
}
{
  const f = fenceSynth('fence-opmix')
  mkdirSync(join(f.r, F.FENCE_DIR), { recursive: true })
  writeFileSync(join(f.r, F.FENCE_DIR, 'journal.json'), JSON.stringify({ schema: F.FENCE_SCHEMA, txId: 't', op: 'rollback' }))
  const s0 = f.snap()
  const r = F.runFence({ root: f.r, op: 'apply', write: true, tools: f.tools })
  ok('fence — 다른 op 의 journal 이 남아 있으면 RECOVERY_REQUIRED · 쓰기 0', r.code === 'RECOVERY_REQUIRED' && f.snap() === s0, r)
}
{
  const f = fenceSynth('fence-lock')
  writeFileSync(join(f.r, F.FENCE_LOCK), 'held')
  const s0 = f.snap()
  ok('fence 잠금이 있으면 LEGACY_FENCE_LOCKED · 쓰기 0 · 잠금 보존', F.runFence({ root: f.r, op: 'apply', write: true, tools: f.tools }).code === 'LEGACY_FENCE_LOCKED' && f.snap() === s0)
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
  const B = join(R, 'contract', 'build')
  const ctlSha = () => sha(readFileSync(join(B, 'control.json')))
  const oldCtl = ctlSha()
  const dry = cli('install', ...common, '--expect-current', oldCur, '--expect-control-sha256', oldCtl)
  ok('반례10 실제 install dry-run — 연구 사본 contract 쓰기 0', dry.status === 0 && JSON.parse(dry.stdout).code === 'DRY_RUN' && treeSnap(join(R, 'contract')) === beforeDry, dry.stdout.slice(0, 300))
  const wDrift = cli('install', ...common, '--expect-current', oldCur, '--expect-control-sha256', '0'.repeat(64), '--write')
  ok('반례2 실제 control drift(기대 sha 다름) → RESEARCH_CONTROL_CAS_CONFLICT · 쓰기 0', wDrift.status === 1 && JSON.parse(wDrift.stdout).code === 'RESEARCH_CONTROL_CAS_CONFLICT' && treeSnap(join(R, 'contract')) === beforeDry)
  const w = cli('install', ...common, '--expect-current', oldCur, '--expect-control-sha256', oldCtl, '--write')
  const c1 = JSON.parse(readFileSync(join(B, 'control.json'), 'utf8'))
  ok('반례1 실제 install — current=427d4d · previous=ad8e89 · control.graphVersion=427d4d · control.previousGraphVersion=ad8e89 · 설치 판 = 후보 바이트', w.status === 0 && linkOf(join(B, 'current')) === EXPECT.graphVersion && linkOf(join(B, 'previous')) === oldCur &&
    c1.graphVersion === EXPECT.graphVersion && c1.previousGraphVersion === oldCur && oldCur === 'g-20260923-ad8e89' && JSON.stringify(RC.treeOf(join(B, EXPECT.graphVersion))) === JSON.stringify(RC.treeOf(cand)), w.stdout.slice(0, 300))
  const pctl = readFileSync(join(ROOT, 'src', 'content', 'magazine', 'graph', 'control.ts'), 'utf8')
  ok('새 control 권위 — 제품 control.ts 의 enabled · clusters · surfaces · authority.productControlSha256', c1.authority?.productControlSha256 === sha(pctl) && c1.enabled === true && c1.enabledClusters?.includes('money-work') && c1.surfaces?.FOOTER_BRIDGE === true, c1)
  const chk = cli('check', '--research-dir', R)
  ok('B 공식 validator(check) — 새 current · control · previous 정합 CURRENT_VALID', chk.status === 0 && JSON.parse(chk.stdout).code === 'CURRENT_VALID', chk.stdout.slice(0, 400))
  {
    const RT = join(TMP, 'research-ctl-tamper')
    cpSync(R, RT, { recursive: true, verbatimSymlinks: true })
    const cf = join(RT, 'contract', 'build', 'control.json')
    writeFileSync(cf, JSON.stringify({ ...JSON.parse(readFileSync(cf, 'utf8')), graphVersion: oldCur }, null, 2))
    const bad = JSON.parse(cli('check', '--research-dir', RT).stdout)
    ok('공식 validator — control.graphVersion 이 current 와 다르면 RESEARCH_CURRENT_INVALID', bad.code === 'RESEARCH_CURRENT_INVALID' && bad.problems.some((x) => x.startsWith('control.graphVersion')), bad)
  }
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
  const rbk = cli('rollback', '--research-dir', RH, '--expect-current', EXPECT.graphVersion, '--expect-previous', oldCur, '--expect-control-sha256', sha(readFileSync(join(RH, 'contract', 'build', 'control.json'))), '--write')
  let rc = {}
  try { rc = JSON.parse(readFileSync(join(RH, 'contract', 'build', 'control.json'), 'utf8')) } catch { rc = {} }
  const prepOld = run([join(P, 'scripts', 'magazine-direct-spec-source-authoring.mjs'), 'prepare', '--slug', 'resume-age', '--as-of', asOf, '--repo', P, '--admission-root', RH, '--research-dir', RH], { cwd: P })
  let po = null; try { po = JSON.parse(prepOld.stdout) } catch { po = null }
  ok('반례9 실제 rollback → current=ad8e89 · previous=427d4d · control.graphVersion=ad8e89 · control.previousGraphVersion=427d4d', rbk.status === 0 && linkOf(join(RH, 'contract', 'build', 'current')) === oldCur &&
    linkOf(join(RH, 'contract', 'build', 'previous')) === EXPECT.graphVersion && rc.graphVersion === oldCur && rc.previousGraphVersion === EXPECT.graphVersion, rbk.stdout.slice(0, 300))
  ok('B 옛 current 를 --research-dir 로 쓰면 RESEARCH_INTENT_HASH_MISMATCH', po?.code === 'RESEARCH_INTENT_HASH_MISMATCH', prepOld.stdout.slice(0, 300))
  // ── P1-2 legacy writer 차단 — 연구 사본에서 ──
  const LEGACY = ['build-graph.mjs', 'promote-graph.mjs', 'validate-graph.mjs', 'export-graph.mjs', 'deliver-to-product.mjs', 'fault-injection.test.mjs', 'promote-regression.test.mjs', 'delivery.test.mjs', 'm3-e2e.mjs']
  // 다중 프로세스 — research-current 잠금을 살아 있는 프로세스가 쥔 동안 옛 promote-graph --rollback (fence 없음 → 잠금을 모르고 쓴다)
  const RU = join(TMP, 'research-unfenced')
  cpSync(R, RU, { recursive: true, verbatimSymlinks: true })
  const holder = (root) => spawn(process.execPath, ['-e', `const fs=require('fs');fs.writeFileSync(${JSON.stringify(join(root, 'contract', 'build', RC.LOCK_NAME))}, JSON.stringify({txId:'holder',pid:process.pid}));setTimeout(()=>{},4000)`], { stdio: 'ignore' })
  const waitLock = (root) => { for (let i = 0; i < 200 && !existsSync(join(root, 'contract', 'build', RC.LOCK_NAME)); i++) spawnSync('/bin/sleep', ['0.02']) }
  const hu = holder(RU); waitLock(RU)
  const bu = treeSnap(join(RU, 'contract', 'build'))
  const lu = run([join(RU, 'contract', 'promote-graph.mjs'), '--rollback'], { cwd: RU })
  const changedUnfenced = treeSnap(join(RU, 'contract', 'build')) !== bu
  hu.kill()
  ok('대조 — fence 가 없으면 옛 promote-graph 는 research-current 잠금을 무시하고 current·control 을 쓴다 (차단이 필요한 이유)', lu.status === 0 && changedUnfenced, { status: lu.status, changedUnfenced })
  const fence = (...a) => run([join(HERE, 'magazine-research-legacy-fence.mjs'), ...a, '--research', R])
  const fdry = fence('apply')
  ok('fence 실제 사본 dry-run — 9개 ORIGINAL · 쓰기 0', fdry.status === 0 && JSON.parse(fdry.stdout).plan.todo.length === 9 && !existsSync(join(R, 'contract', '.legacy-retired')))
  const fw = fence('apply', '--write')
  ok('fence 실제 사본 apply — 9개 RETIRED', fw.status === 0 && JSON.parse(fw.stdout).code === 'RETIRED', fw.stdout.slice(0, 300))
  const hf = holder(R); waitLock(R)
  const bf = treeSnap(join(R, 'contract', 'build'))
  const lf = run([join(R, 'contract', 'promote-graph.mjs'), '--rollback'], { cwd: R })
  const lf2 = run([join(R, 'contract', 'promote-graph.mjs')], { cwd: R })
  ok('반례7 · 다중 프로세스 — 잠금을 쥔 다른 프로세스가 있는 동안 퇴역 promote-graph(--rollback · 승격) → LEGACY_GRAPH_TOOL_RETIRED · current·previous·control 쓰기 0',
    lf.status === 3 && lf2.status === 3 && lf.stderr.includes('LEGACY_GRAPH_TOOL_RETIRED') && treeSnap(join(R, 'contract', 'build')) === bf, { lf: lf.status, lf2: lf2.status })
  hf.kill(); rmSync(join(B, RC.LOCK_NAME), { force: true })
  for (const n of LEGACY) {
    const r = run([join(R, 'contract', n)], { cwd: R })
    ok(`퇴역 consumer ${n} — LEGACY_GRAPH_TOOL_RETIRED · 대체 명령 안내 · 종료 3`, r.status === 3 && r.stderr.includes('LEGACY_GRAPH_TOOL_RETIRED') && r.stderr.includes('"replacement"'), r.stderr.slice(0, 160))
  }
  for (const t of ['m3-reconcile', 'm3-rank', 'm3-slug']) {
    const r = run([join(R, 'contract', `${t}.mjs`)], { cwd: R })
    ok(`반례11 계속 지원 ${t} — fence 뒤 새 current 로 종료 0`, r.status === 0, r.stderr.slice(-300))
  }
  ok('반례11 계속 지원 check — fence 뒤에도 CURRENT_VALID', JSON.parse(cli('check', '--research-dir', R).stdout).code === 'CURRENT_VALID')
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
