#!/usr/bin/env node
/**
 * 자동 병합 복구 변이 시험 — 방어를 지운 코드로 복구 검사·launchd 검사를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 * 바꿀 문장이 파일에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 무효 = FAIL).
 *
 * 🔴 필수 검사·exact head 는 관문이 두 겹이다(관찰 + 판정 · 판정 + merge 직전 재조회).
 *    한 겹만 지우면 다른 겹이 막아 변이가 살아남는 것이 정상이다 — 그래서 **관문 전체**를 지운다.
 * 🔴 파일을 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다. 중간에 끊겨도 되돌린다.
 *
 * 사용: node scripts/magazine-auto-merge-recovery-mutation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const F = {
  merge: path.join(HERE, 'magazine-auto-merge.mjs'),
  gate: path.join(HERE, 'lib', 'magazine-merge-gate.mjs'),
  install: path.join(HERE, 'magazine-launchd-install.mts'),
}
const CHECKS = [
  ['복구 검사', process.execPath, [path.join(HERE, 'magazine-auto-merge-recovery-check.mjs')]],
  ['launchd 검사', path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(HERE, 'magazine-launchd-check.mts')]],
]

const MUTATIONS = [
  { name: 'CI 관찰 상한을 30분에서 20분으로', edits: [{ file: F.merge,
    find: 'export const CI_OBSERVE_MS = 30 * 60 * 1000', replace: 'export const CI_OBSERVE_MS = 20 * 60 * 1000' }] },
  { name: '02:00 복구 job 제거', edits: [{ file: F.install,
    find: "  'com.soransoran.magazine-auto-merge-recovery',\n", replace: '' }] },
  { name: '필수 검사 관문 제거 (관찰 종료 조건 + 판정)', edits: [
    { file: F.merge, find: "      const requiredSettled = REQUIRED_CHECKS.every((n) => byName.get(n)?.status === 'completed')",
      replace: '      const requiredSettled = true' },
    { file: F.gate, find: '    const missing = REQUIRED_CHECKS.filter((n) => {', replace: '    const missing = [].filter((n) => {' }] },
  { name: 'exact-head 관문 제거 (merge 직전 재조회)', edits: [{ file: F.merge,
    find: '    if (fresh.headRefOid !== sha) report.blockedBy.push(', replace: '    if (false) report.blockedBy.push(' }] },
  { name: 'exact-head 병합 제거 (--match-head-commit)', edits: [{ file: F.merge,
    find: "    const r = exec('gh', ['pr', 'merge', String(number), '--squash', '--match-head-commit', sha])",
    replace: "    const r = exec('gh', ['pr', 'merge', String(number), '--squash'])" }] },
  { name: '자동 PR 2건 이상 차단 제거', edits: [{ file: F.merge,
    find: "  if (found.prs.length > 1) return fail('MULTIPLE_AUTO_PRS',", replace: "  if (false) return fail('MULTIPLE_AUTO_PRS'," }] },
  { name: 'no-op 멱등성 제거 — PR 0건을 실패로', edits: [{ file: F.merge,
    find: "  if (found.prs.length === 0) { log('자동 PR 이 없다 — 할 것이 없다'); return report }",
    replace: "  if (found.prs.length === 0) return fail('NO_AUTO_PR', '자동 PR 이 없다')" }] },
  { name: 'no-op 멱등성 제거 — 이미 병합된 PR 도 대상으로 (--state all)', edits: [{ file: F.merge,
    find: "    const r = exec('gh', ['pr', 'list', '--state', 'open',", replace: "    const r = exec('gh', ['pr', 'list', '--state', 'all'," }] },
  { name: '01:00 병합과 동시 실행 차단(잠금) 제거', edits: [{ file: F.merge,
    find: '  if (!lock.ok) {\n    return { ...base, outcome: \'DEFERRED\'', replace: '  if (false) {\n    return { ...base, outcome: \'DEFERRED\'' }] },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })

const occurrences = (s, sub) => s.split(sub).length - 1
const runAll = () => CHECKS.map(([label, cmd, args]) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT })
  const summary = (r.stdout.match(/자동 병합 복구 검사 \d+\/\d+|\d+ PASS · \d+ FAIL/g) ?? ['출력 없음']).pop()
  return { label, status: r.status, summary }
})

let bad = 0
let caught = 0
console.log('\n자동 병합 복구 변이 시험\n')
const base = runAll()
if (base.some((b) => b.status !== 0)) { bad++; console.log(`  ❌ 변이 없는 코드에서 검사가 FAIL 이다 (${base.map((b) => `${b.label} ${b.summary}`).join(' · ')})`) }
else console.log(`  기준선 (변이 없음) — PASS · ${base.map((b) => `${b.label} ${b.summary}`).join(' · ')}`)
try {
  for (const mu of MUTATIONS) {
    const invalid = mu.edits.find((e) => occurrences(originals[e.file].toString('utf8'), e.find) !== 1)
    if (invalid) { bad++; console.log(`  ❌ ${mu.name} — ${path.basename(invalid.file)} 에 바꿀 문장이 ${occurrences(originals[invalid.file].toString('utf8'), invalid.find)}번 있다 (변이 무효)`); continue }
    const mutated = {}
    for (const e of mu.edits) mutated[e.file] = (mutated[e.file] ?? originals[e.file].toString('utf8')).replace(e.find, e.replace)
    let res
    try {
      for (const [f, text] of Object.entries(mutated)) fs.writeFileSync(f, text)
      res = runAll()
    } finally { restoreAll() }
    if (files.some((f) => sha(f) !== startHashes[f])) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    const failed = res.filter((r) => r.status !== 0)
    if (failed.length === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어)`) }
    else { caught++; console.log(`  ✅ ${mu.name} — FAIL (${failed.map((r) => `${r.label} ${r.summary}`).join(' · ')})`) }
  }
} finally {
  restoreAll()
}
const drift = files.filter((f) => sha(f) !== startHashes[f])
if (drift.length) { bad++; console.log(`  ❌ 끝난 뒤 원본과 다른 파일: ${drift.map((f) => path.basename(f)).join(', ')}`) } else console.log('\n  원복 확인 — 변이 대상 파일 전부 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
