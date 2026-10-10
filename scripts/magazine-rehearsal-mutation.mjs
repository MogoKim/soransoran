#!/usr/bin/env node
/**
 * 매거진 rehearsal 변이 시험 — 핵심 경계·단계를 지운 코드로 `magazine-rehearsal-check.mjs` 를 다시 돌려
 * **끝까지 실행된 뒤 단언이 FAIL 로 바뀌는지** 본다 (2026-10-10).
 *
 * 🔴 예외로만 멈춘 것은 잡은 것으로 세지 않는다 — 검사 요약 줄이 있어야 하고 ❌ 단언이 하나 이상이어야 한다.
 * 🔴 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다 (rehearsal 은 작업 트리를 복사하므로
 *    변이가 임시 루트 안의 실제 래퍼·fixture·guard 에 그대로 들어간다).
 *
 * 사용: node scripts/magazine-rehearsal-mutation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const CHECK = path.join(HERE, 'magazine-rehearsal-check.mjs')
const F = {
  guard: path.join(HERE, 'lib', 'magazine-rehearsal-guard.mjs'),
  scen: path.join(HERE, 'lib', 'magazine-rehearsal-scenarios.mjs'),
  sandbox: path.join(HERE, 'lib', 'magazine-rehearsal-sandbox.mjs'),
  bin: path.join(HERE, 'lib', 'magazine-rehearsal-bin.mjs'),
  orch: path.join(HERE, 'magazine-rehearsal.mjs'),
  merge: path.join(HERE, 'magazine-auto-merge.mjs'),
  quarantine: path.join(HERE, 'lib', 'magazine-quarantine.mjs'),
}
const MUTATIONS = [
  { name: '① guard 의 임시 루트 밖 쓰기 차단 제거', scenarios: 'S1', edits: [{ file: F.guard,
    find: 'function checkWrite(op, ...paths) {\n', replace: 'function checkWrite(op, ...paths) {\n  return\n' }] },
  { name: '② 네트워크(TCP)/CDP 차단 제거', scenarios: 'S1', edits: [{ file: F.guard,
    find: "    violate(Number(t.port) === 9333 || Number(t.port) === 9344 ? 'CDP_CONNECT' : 'NETWORK_CONNECT', t)\n", replace: '' }] },
  { name: '③ 실제 wrapper 대신 가짜 성공값', scenarios: 'S1', edits: [{ file: F.scen,
    find: '  const r = spawnSync(process.execPath, [join(sb.repo, \'scripts\', e.script), ...e.args], {',
    replace: '  const r = { status: 0, stdout: \'\', stderr: \'\' } || spawnSync(process.execPath, [join(sb.repo, \'scripts\', e.script), ...e.args], {' }] },
  { name: '④ producer 단계 생략', scenarios: 'S1', edits: [{ file: F.orch,
    find: "  stages.push(runStage(sb, { name: 'producer', entry: 'producer', kst: KST(date, '00:10') }))\n", replace: '' }] },
  { name: '⑤ auto-register 단계 생략', scenarios: 'S1', edits: [{ file: F.orch,
    find: "  stages.push(runStage(sb, { name: 'register', entry: 'register', kst: KST(date, '01:00') }))\n", replace: '' }] },
  { name: '⑥ exact-head 관문 제거 (--match-head-commit 없이 merge)', scenarios: 'S1', edits: [{ file: F.merge,
    find: "exec('gh', ['pr', 'merge', String(number), '--squash', '--match-head-commit', sha])", replace: "exec('gh', ['pr', 'merge', String(number), '--squash'])" }] },
  { name: '⑦ 02:00 recovery 단계 제거', scenarios: 'S4', edits: [{ file: F.orch,
    find: "  stages.push(runStage(sb, { name: 'recover', entry: 'recover', kst: KST(date, '02:00') }))\n", replace: '' }] },
  { name: '⑧ 공개 전 404 관문 제거 (예약 글이 바로 보인다)', scenarios: 'S6', edits: [{ file: F.bin,
    find: '    return L.parseArticlesSource(src).filter((a) => G.isPublic(a, Date.now()))', replace: '    void G\n    return L.parseArticlesSource(src)' }] },
  { name: '⑨ HOLD 후보를 다시 전송 (전송불명 HOLD 판정 제거)', scenarios: 'S3', edits: [{ file: F.quarantine,
    find: "  if (d.kind !== 'DELIVERY_UNCERTAIN') return null\n  return {", replace: "  if (true) return null\n  return {" }] },
  { name: '⑩ 잔여 lock/journal 검사 제거', scenarios: 'S1', edits: [{ file: F.scen,
    find: '  return [...new Set(hits)].sort()', replace: '  return []' }] },
  { name: '⑪ 결과 보고에서 실패 단계를 성공으로 기록', scenarios: 'S5', edits: [{ file: F.scen,
    find: 'kst, exit: r.status, signal', replace: 'kst, exit: 0, signal' }] },
  { name: '⑫ 고정 시각 대신 실제 시각', scenarios: 'S1', edits: [{ file: F.sandbox,
    find: '    SORAN_REHEARSAL_CLOCK: `${clock.fakeMs}:${clock.realMs}:${clock.speed}`,\n', replace: '' }] },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })
const occurrences = (s, sub) => s.split(sub).length - 1
const summary = (out) => (out.match(/리허설 검사 \d+\/\d+/g) ?? [null]).pop()

let bad = 0
let caught = 0
console.log('\n매거진 rehearsal 변이 시험\n')
const base = spawnSync(process.execPath, [CHECK, '--scenario', 'S1,S3,S4,S5,S6'], { encoding: 'utf8', cwd: ROOT, timeout: 60 * 60 * 1000 })
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 코드에서 검사가 FAIL 이다 (${summary(base.stdout) ?? '요약 없음'})`) } else console.log(`  기준선 (변이 없음) — PASS · ${summary(base.stdout)}`)
try {
  for (const mu of MUTATIONS) {
    const invalid = mu.edits.find((e) => occurrences(originals[e.file].toString('utf8'), e.find) !== 1)
    if (invalid) { bad++; console.log(`  ❌ ${mu.name} — ${path.basename(invalid.file)} 에 바꿀 문장이 ${occurrences(originals[invalid.file].toString('utf8'), invalid.find)}번 있다 (변이 무효)`); continue }
    const mutated = {}
    for (const e of mu.edits) mutated[e.file] = (mutated[e.file] ?? originals[e.file].toString('utf8')).replace(e.find, e.replace)
    let r
    try {
      for (const [f, text] of Object.entries(mutated)) fs.writeFileSync(f, text)
      r = spawnSync(process.execPath, [CHECK, '--scenario', mu.scenarios], { encoding: 'utf8', cwd: ROOT, timeout: 60 * 60 * 1000 })
    } finally { restoreAll() }
    if (files.some((f) => sha(f) !== startHashes[f])) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    // 🔴 변이 회차가 남긴 실패 증거(임시 루트·보고서)는 변이 시험의 산출물이 아니다 — 지운다
    for (const m of r.stdout.matchAll(/(?:보존|보고서|실패 증거\(임시 루트 보존\)): (\S+)/g)) {
      const p = path.dirname(m[1])
      if (p.startsWith(path.resolve(os.tmpdir())) || p.startsWith('/private/var/folders/') || p.startsWith('/var/folders/')) fs.rmSync(p, { recursive: true, force: true })
    }
    const s = summary(r.stdout)
    const failed = (r.stdout.match(/❌ [^\n]+/g) ?? []).filter((l) => !/│/.test(l))
    if (!s) { bad++; console.log(`  ❌ ${mu.name} — 검사가 끝까지 돌지 않았다 (예외로만 멈춤 · 종료 ${r.status} ${r.signal ?? ''})`) }
    else if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어) · ${s}`) }
    else if (failed.length === 0) { bad++; console.log(`  ❌ ${mu.name} — FAIL 인데 단언 실패가 없다 · ${s}`) }
    else { caught++; console.log(`  ✅ ${mu.name} — FAIL (${s} · 실패 단언 ${failed.length} · 예: ${failed[0].slice(4, 90)})`) }
  }
} finally { restoreAll() }
const drift = files.filter((f) => sha(f) !== startHashes[f])
if (drift.length) { bad++; console.log(`  ❌ 끝난 뒤 원본과 다른 파일: ${drift.map((f) => path.basename(f)).join(', ')}`) } else console.log('\n  원복 확인 — 변이 대상 파일 전부 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
