#!/usr/bin/env node
/**
 * 연구 current 전환 · 판별 계약 변이 시험 (2026-11-02 · release gate ②).
 *
 *   node scripts/magazine-research-current-mutation.mjs --research <연구>
 *
 * 🔴 핵심 방어를 하나씩 지운 코드로 검사를 다시 돌려 **끝까지 실행된 뒤 ❌ 단언이 생기는지** 본다.
 *    요약 줄(RESULT · 검사 n/m)이 없으면(모듈 로드 실패 · 시험 미실행) 잡은 것으로 세지 않는다.
 * 🔴 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다. 실제 연구 저장소는 검사가 tmp 로 복사해 읽기만 한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const argv = process.argv.slice(2)
const RESEARCH = argv.includes('--research') ? argv[argv.indexOf('--research') + 1] : null
if (!RESEARCH) { console.error('사용법 — --research <연구 저장소> 가 필요하다 (실제 입력 반례가 변이를 잡는다)'); process.exit(2) }
const F = {
  lib: path.join(HERE, 'lib', 'magazine-research-current.mjs'),
  cli: path.join(HERE, 'magazine-research-current.mjs'),
  g8: path.join(HERE, 'magazine-g8-promote-check.mjs'),
  bc: path.join(HERE, 'magazine-graph-build-check.mjs'),
}
const RCHECK = { cmd: [path.join(HERE, 'magazine-research-current-check.mjs'), '--research', RESEARCH], summary: /RESULT pass=\d+ fail=\d+/ }
const G8CHECK = { cmd: [F.g8], summary: /G8 편입기 검사 \d+\/\d+/ }
const BCHECK = { cmd: [F.bc], summary: /RESULT pass=\d+ fail=\d+/ }
const MUTATIONS = [
  { name: 'R1 제품 builder schema 판정 제거 (옛 연구 builder 산출 통과)', check: RCHECK, file: F.lib,
    find: "  if (m.schemaVersion !== BUILD_SCHEMA) fail('CANDIDATE_NOT_PRODUCT_BUILD',", replace: "  if (false) fail('CANDIDATE_NOT_PRODUCT_BUILD'," },
  { name: 'R2 파일 ↔ manifest 내용 해시 대조 제거', check: RCHECK, file: F.lib,
    find: "    if (sha16(body[k]) !== m.contentHash?.[k]) fail('CANDIDATE_CONTENT_HASH',", replace: "    if (false) fail('CANDIDATE_CONTENT_HASH'," },
  { name: 'R3 existingAssetRelation 재계산 대조 제거 (automation 옛 값 통과)', check: RCHECK, file: F.lib,
    find: "  if (stale.length) fail('CANDIDATE_ASSET_RELATION_STALE',", replace: "  if (false) fail('CANDIDATE_ASSET_RELATION_STALE'," },
  { name: 'R4 제품 builder 재계산 바이트 대조 제거 (단일 권위 해제)', check: RCHECK, file: F.lib,
    find: "  if (diff.length) fail('CANDIDATE_NOT_REBUILT',", replace: "  if (false) fail('CANDIDATE_NOT_REBUILT'," },
  { name: 'R5 bundle sha256 기대값 대조 제거', check: RCHECK, file: F.lib,
    find: '  if (sha256(bundle) !== expect.bundleSha256) fail(', replace: '  if (false) fail(' },
  { name: 'R6 같은 판 DIRECT_E2E fixture bundle 대조 제거', check: RCHECK, file: F.lib,
    find: '  if (fixtureBundle !== null && fixtureBundle !== bundle) fail(', replace: '  if (false) fail(' },
  { name: 'R7 rename 직전 CAS 제거 (다른 writer 의 current 를 덮는다)', check: RCHECK, file: F.lib,
    find: "  if (now !== expect) fail('RESEARCH_CURRENT_CAS_CONFLICT',", replace: "  if (false) fail('RESEARCH_CURRENT_CAS_CONFLICT'," },
  { name: 'R8 첫 쓰기 전 journal 생략 (급사 뒤 판정 불가)', check: RCHECK, file: F.lib,
    find: "    atomicJson(jpath, { schema: JOURNAL_SCHEMA, txId, op: 'install',", replace: "    void (() => atomicJson)(jpath, { schema: JOURNAL_SCHEMA, txId, op: 'install'," },
  { name: 'R9 잠금 O_EXCL 제거 (다른 writer 잠금을 덮는다)', check: RCHECK, file: F.lib,
    find: "  try { fd = openSync(p, 'wx') } catch (e) {", replace: "  try { fd = openSync(p, 'w') } catch (e) {" },
  { name: 'R10 no-clobber 제거 (다른 바이트의 같은 판 폴더를 그대로 쓴다)', check: RCHECK, file: F.lib,
    find: "  if (slotState === 'TAKEN') return", replace: "  if (false) return" },
  { name: 'R11 dry-run 이 실제로 쓴다', check: RCHECK, file: F.lib,
    find: "  if (!write) return { ok: true, code: 'DRY_RUN', plan }\n  const txId = randomUUID()\n  const lock = acquireLock(st.buildDir, txId)\n  if (!lock.ok) return { ok: false, code: 'RESEARCH_CURRENT_LOCKED', why: `다른 writer 가 잠금을 쥐고 있다 (${JSON.stringify(lock.held)})` }\n  try {\n    phase('locked', hooks)",
    replace: "  const txId = randomUUID()\n  const lock = acquireLock(st.buildDir, txId)\n  if (!lock.ok) return { ok: false, code: 'RESEARCH_CURRENT_LOCKED', why: `다른 writer 가 잠금을 쥐고 있다 (${JSON.stringify(lock.held)})` }\n  try {\n    phase('locked', hooks)" },
  { name: 'R12 recover 가 제삼자 current 를 from 으로 보고 고친다', check: RCHECK, file: F.lib,
    find: "  if (!outcome) return { ok: false, code: 'RECOVERY_REQUIRED',", replace: "  if (false) return { ok: false, code: 'RECOVERY_REQUIRED'," },
  { name: 'R13 rollback 대상 신원 검증 제거', check: RCHECK, file: F.lib,
    find: '  try { t = verifyRollbackTarget({ buildDir: st.buildDir, graphVersion: st.previous, knownLegacy }) } catch (e) {', replace: "  try { t = { kind: 'UNVERIFIED' } } catch (e) {" },
  { name: 'R14 CLI 가 같은 판 fixture bundle 을 대조하지 않는다', check: RCHECK, file: F.cli,
    find: '  return m.identity?.graphVersion === graphVersion ? readFileSync(join(dir, m.names.bundle), \'utf8\') : null', replace: '  return null' },
  { name: 'C1 g8-check 모르는 판을 081d9a 계약으로 돌린다 (조용한 대체)', check: G8CHECK, file: F.g8,
    find: '  return Object.hasOwn(contracts, pointer) ? contracts[pointer] : null', replace: "  return contracts[pointer] ?? contracts['g-20261021-081d9a']" },
  { name: 'C2 g8-check 판별 gate 가 snapshot 부재를 실행 가능으로 본다 (SKIP 복원)', check: G8CHECK, file: F.g8,
    find: '  return { contract: c, snapshot: snap, ok: Boolean(c) && fs.existsSync(snap) }', replace: '  return { contract: c, snapshot: snap, ok: true }' },
  { name: 'C3 build-check 모르는 snapshot 을 e0335 계약으로 돌린다', check: BCHECK, file: F.bc,
    find: 'export const finalContractOf = (name, contracts = FINAL_CONTRACTS) => (Object.hasOwn(contracts, name) ? contracts[name] : null)',
    replace: "export const finalContractOf = (name, contracts = FINAL_CONTRACTS) => contracts[name] ?? contracts['2026-10-21-money-work-retirement-next-e0335']" },
  { name: 'C4 build-check 계약 없는 snapshot 의 시험 0 제거 (조용한 SKIP)', check: RCHECK, file: F.bc,
    find: "    ok(FINAL !== null, `계약 없는 snapshot: ${FINAL_NAME}`)", replace: '    void FINAL' },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.map((m) => m.file))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })
const runCheck = (c) => spawnSync(process.execPath, c.cmd, { cwd: ROOT, encoding: 'utf8', timeout: 60 * 60 * 1000, maxBuffer: 1e8 })

let bad = 0
let caught = 0
console.log('\n연구 current 전환 변이 시험\n')
for (const c of [RCHECK, G8CHECK, BCHECK]) {
  const r = runCheck(c)
  const s = (r.stdout.match(c.summary) ?? [null]).pop()
  if (r.status !== 0 || !s) { bad++; console.log(`  ❌ 기준선 FAIL — ${path.basename(c.cmd[0])} (${s ?? '요약 없음'})`) } else console.log(`  기준선 ${path.basename(c.cmd[0])} — PASS · ${s}`)
}
try {
  for (const mu of MUTATIONS) {
    const n = originals[mu.file].toString('utf8').split(mu.find).length - 1
    if (n !== 1) { bad++; console.log(`  ❌ ${mu.name} — 바꿀 문장이 ${n}번 있다 (변이 무효)`); continue }
    let r
    try {
      fs.writeFileSync(mu.file, originals[mu.file].toString('utf8').replace(mu.find, mu.replace))
      r = runCheck(mu.check)
    } finally { restoreAll() }
    if (files.some((f) => sha(f) !== startHashes[f])) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    const s = (r.stdout.match(mu.check.summary) ?? [null]).pop()
    const failed = (r.stdout.match(/❌ [^\n]+/g) ?? [])
    if (!s) { bad++; console.log(`  ❌ ${mu.name} — 검사가 끝까지 돌지 않았다 (종료 ${r.status} ${r.signal ?? ''})`) }
    else if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어) · ${s}`) }
    else if (!failed.length) { bad++; console.log(`  ❌ ${mu.name} — FAIL 인데 단언 실패가 없다 · ${s}`) }
    else { caught++; console.log(`  ✅ ${mu.name} — FAIL (${s} · 예: ${failed[0].slice(2, 110)})`) }
  }
} finally { restoreAll() }
const drift = files.filter((f) => sha(f) !== startHashes[f])
if (drift.length) { bad++; console.log(`  ❌ 끝난 뒤 원본과 다른 파일: ${drift.map((f) => path.basename(f)).join(', ')}`) } else console.log('\n  원복 확인 — 변이 대상 파일 전부 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
