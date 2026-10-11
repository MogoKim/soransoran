#!/usr/bin/env node
/**
 * 자동 회복 계약 변이 시험 — 방어를 지운 코드로 `magazine-auto-recovery-check.mjs` 를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 * 바꿀 문장이 파일에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 무효 = FAIL).
 * 🔴 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다. 중간에 끊겨도 되돌린다.
 *
 * 사용: node scripts/magazine-auto-recovery-mutation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const CHECK = path.join(HERE, 'magazine-auto-recovery-check.mjs')
const F = {
  quarantine: path.join(HERE, 'lib', 'magazine-quarantine.mjs'),
  regen: path.join(HERE, 'lib', 'magazine-regen.mjs'),
  body: path.join(HERE, 'lib', 'magazine-body-length.mjs'),
  qa: path.join(HERE, 'magazine-qa.mjs'),
  batch: path.join(HERE, 'magazine-batch-qa.mjs'),
  register: path.join(HERE, 'magazine-auto-register.mjs'),
  session: path.join(HERE, 'lib', 'chatgpt-session.mjs'),
}
const MUTATIONS = [
  // ── C 예산 계보 ──
  { name: 'C 계보 무시 — 전체 횟수로만 판정 (앞판)', edits: [{ file: F.quarantine, find: '  const used = lineage.calls\n', replace: '  const used = total\n' }] },
  { name: 'C 전체 상한 4 제거', edits: [{ file: F.quarantine, find: "  const exhaustedBy = total >= maxTotal ? 'TOTAL'", replace: "  const exhaustedBy = false ? 'TOTAL'" }] },
  { name: 'C 같은 증거로 계보 재개방 허용', edits: [{ file: F.quarantine, find: '    if (prev.regenLineage?.evidenceKey === key || seen.includes(key)) {', replace: '    if (false) {' }] },
  { name: 'C 옛 행 이관을 0회로 (예산 되살림)', edits: [{ file: F.quarantine, find: "  return { id: 'legacy', origin: 'LEGACY', evidenceKey: null, calls: used,", replace: "  return { id: 'legacy', origin: 'LEGACY', evidenceKey: null, calls: 0 * used," }] },
  { name: 'C 자기 시도 원복이 계보를 되돌리지 않음', edits: [{ file: F.quarantine, find: '        ...(inLineage ? {', replace: '        ...(false ? {' }] },
  { name: 'C 원고 그대로일 때 전체 횟수를 2로 덮음 (앞판)', edits: [{ file: F.quarantine,
    find: "    return { ...cur, [slug]: { ...prev, regenLineage: { ...prev.regenLineage, calls: Math.max(prev.regenLineage.calls, MAX_REGEN_CALLS) } } }",
    replace: "    return { ...cur, [slug]: { ...prev, regenCalls: MAX_REGEN_CALLS, regenLineage: { ...prev.regenLineage, calls: Math.max(prev.regenLineage.calls, MAX_REGEN_CALLS) } } }" }] },
  { name: 'C 등록 성공 때 계보 정리 누락', edits: [{ file: F.regen, find: 'regenAttemptIds, regenLineage, regenLineageKeys, firstResponseInvalid, ...rest', replace: 'regenAttemptIds, regenLineageKeys, firstResponseInvalid, ...rest' }] },
  // ── B 길이 정본 ──
  { name: 'B hard 기준 완화 (3000 → 3500)', edits: [{ file: F.body, find: 'export const HARD_BODY = Object.freeze({ min: 800, max: 3000 })', replace: 'export const HARD_BODY = Object.freeze({ min: 800, max: 3500 })' }] },
  { name: 'B QA 의 hard FAIL 제거 (앞판 — WARN 만)', edits: [{ file: F.qa, find: '  if (!body.hard.ok) report.fail(', replace: '  if (false) report.fail(' }] },
  { name: 'B batch 가 다른 계산을 씀', edits: [{ file: F.batch, find: 'const bodyText = publishText', replace: "const bodyText = (a) => publishText(a).replace(/\\s/g, '')" }] },
  { name: 'B batch 길이 실패를 재생성 코드에서 뺌 (앞판)', edits: [{ file: F.register, find: '|BODY_TOO_SHORT$|BODY_TOO_LONG$)/', replace: ')/' }] },
  // ── A 최초 응답 ──
  { name: 'A 교정 판정이 응답 신원을 보지 않음', edits: [{ file: F.register, find: '    && Boolean(row?.conversationUrl && row?.assistantMessageId)\n', replace: '' }] },
  { name: 'A 응답 앞부분 200자 제한 제거', edits: [{ file: F.session, find: ".replace(/\\s+/g, ' ').trim().slice(0, RESPONSE_EXCERPT_MAX)", replace: ".replace(/\\s+/g, ' ').trim()" }] },
  { name: 'A 증거에서 응답 sha256 누락', edits: [{ file: F.register, find: '    responseSha256: row?.responseSha256 ?? null, length: row?.length ?? null,\n    responseExcerpt:', replace: '    length: row?.length ?? null,\n    responseExcerpt:' }] },
  { name: 'A 장부에 응답 앞부분까지 저장', edits: [{ file: F.quarantine, find: 'firstResponseInvalid: { ...keep, at: now } }', replace: 'firstResponseInvalid: { ...evidence, ...keep, at: now } }' }] },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })
const occurrences = (s, sub) => s.split(sub).length - 1
const lineOf = (out) => (out.match(/자동 회복 계약 검사 \d+\/\d+/g) ?? ['출력 없음']).pop()

let bad = 0
let caught = 0
console.log('\n자동 회복 계약 변이 시험\n')
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
