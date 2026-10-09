#!/usr/bin/env node
/**
 * 입력 수리 변이 시험 — 방어를 지운 코드로 `magazine-input-repair-check.mjs` 를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 * 바꿀 문장이 파일에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 무효 = FAIL).
 * 🔴 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다. 중간에 끊겨도 되돌린다.
 *
 * 사용: node scripts/magazine-input-repair-mutation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const CHECK = path.join(HERE, 'magazine-input-repair-check.mjs')
const F = {
  lane: path.join(HERE, 'lib', 'magazine-input-repair.mjs'),
  quarantine: path.join(HERE, 'lib', 'magazine-quarantine.mjs'),
  webui: path.join(HERE, 'magazine-webui-runner.mjs'),
}
const MUTATIONS = [
  { name: 'brief 후보 검증 제거', edits: [{ file: F.lane, find: '  if (!contract.ok || !verdict.ok) {', replace: '  if (false) {' }] },
  { name: 'brief/review 쌍 원자 교체 제거 (journal 없이 바로 쓰기)', edits: [{ file: F.lane,
    find: '  save()\n  phaseHook(tx.phase)\n  for (const f of tx.files) if (f.existed) copyFileSync(f.path, f.backup)',
    replace: '  for (const f of files) writeFileSync(f.path, f.text)\n  return { ok: true }\n  for (const f of tx.files) if (f.existed) copyFileSync(f.path, f.backup)' }] },
  { name: 'DRAFT_INVALID 를 일반 최초 요청으로 다시 보냄', edits: [{ file: F.webui,
    find: '  const gate = inputRepair ? inputRepairGate({ slug, draftsDir, quarantinePath })', replace: '  const gate = false ? inputRepairGate({ slug, draftsDir, quarantinePath })' }] },
  { name: '수리 지문 중복 방지 제거', edits: [{ file: F.quarantine,
    find: '  return Boolean(fingerprint) && Array.isArray(entry?.inputRepairFingerprints) && entry.inputRepairFingerprints.includes(fingerprint)', replace: '  return false' }] },
  { name: '전송불명을 재전송 가능(실패)으로', edits: [{ file: F.lane,
    find: '      const uncertain = row.sent !== false && !settled', replace: '      const uncertain = false' }] },
  { name: '임시 candidate 검증 제거', edits: [{ file: F.lane, find: '    if (!v.ok || !f.ok || !c?.ok) {', replace: '    if (false) {' }] },
  { name: '원본을 검증 전에 교체', edits: [{ file: F.lane,
    find: '    const v = validateManuscript(text)', replace: "    commitFiles({ dir, files: [{ path: draftPath, text }], phaseHook: deps.phaseHook })\n    const v = validateManuscript(text)" }] },
  { name: '입력 수리를 CONTENT attempts · regenCalls 로 계산', edits: [{ file: F.quarantine,
    find: '    if (inputRepair) entry = recordInputRepairCall({ entry, now, fingerprint: inputRepair.fingerprint })',
    replace: '    if (inputRepair) entry = { ...recordInputRepairCall({ entry, now, fingerprint: inputRepair.fingerprint }), attempts: (entry.attempts ?? 0) + 1, regenCalls: (entry.regenCalls ?? 0) + 1 }' }] },
  { name: 'HOLD runner 차단 제거', edits: [{ file: F.lane,
    find: "export const hasDeliveryUncertain = (entry) => entry?.delivery?.kind === 'DELIVERY_UNCERTAIN'", replace: 'export const hasDeliveryUncertain = () => false' }] },
  { name: '회차 상한 제거', edits: [{ file: F.lane, find: '  const chosen = targets.slice(0, max)', replace: '  const chosen = targets' }] },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })
const occurrences = (s, sub) => s.split(sub).length - 1
const lineOf = (out) => (out.match(/입력 수리 검사 \d+\/\d+/g) ?? ['출력 없음']).pop()

let bad = 0
let caught = 0
console.log('\n입력 수리 변이 시험\n')
const base = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', cwd: ROOT })
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 코드에서 검사가 FAIL 이다 (${lineOf(base.stdout)})`) } else console.log(`  기준선 (변이 없음) — PASS · ${lineOf(base.stdout)}`)
try {
  for (const mu of MUTATIONS) {
    const invalid = mu.edits.find((e) => occurrences(originals[e.file].toString('utf8'), e.find) !== 1)
    if (invalid) { bad++; console.log(`  ❌ ${mu.name} — ${path.basename(invalid.file)} 에 바꿀 문장이 ${occurrences(originals[invalid.file].toString('utf8'), invalid.find)}번 있다 (변이 무효)`); continue }
    const mutated = {}
    for (const e of mu.edits) mutated[e.file] = (mutated[e.file] ?? originals[e.file].toString('utf8')).replace(e.find, e.replace)
    let r
    try {
      for (const [f, text] of Object.entries(mutated)) fs.writeFileSync(f, text)
      r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', cwd: ROOT })
    } finally { restoreAll() }
    if (files.some((f) => sha(f) !== startHashes[f])) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    const failed = (r.stdout.match(/❌ [^\n]+/g) ?? [])
    const crashed = /예외로 중단/.test(r.stdout)
    if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어)`) }
    else if (crashed && failed.length <= 1) { bad++; console.log(`  ❌ ${mu.name} — 단언이 아니라 예외로만 멈췄다 (${lineOf(r.stdout)})`) }
    else { caught++; console.log(`  ✅ ${mu.name} — FAIL (${lineOf(r.stdout)} · 실패 단언 ${failed.length - (crashed ? 1 : 0)}${crashed ? ' · 예외 포함' : ''})`) }
  }
} finally { restoreAll() }
const drift = files.filter((f) => sha(f) !== startHashes[f])
if (drift.length) { bad++; console.log(`  ❌ 끝난 뒤 원본과 다른 파일: ${drift.map((f) => path.basename(f)).join(', ')}`) } else console.log('\n  원복 확인 — 변이 대상 파일 전부 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
