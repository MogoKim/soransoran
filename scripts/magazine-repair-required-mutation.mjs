#!/usr/bin/env node
/**
 * 입력 수리 필요 회계 변이 시험 — 방어 하나를 지운 코드로 `magazine-repair-required-check.mjs` 를 다시 돌려
 * **검사가 FAIL 로 바뀌는지** 본다. 바꿀 문장이 파일에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 무효 = FAIL).
 *
 * 🔴 파일을 제자리에서 바꾸고 **매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인**한다.
 *    중간에 끊겨도(SIGINT·SIGTERM·예외) 되돌린다. 끝에 전 파일 해시가 시작과 같아야 PASS 다.
 *
 * 사용: node scripts/magazine-repair-required-mutation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECK = path.join(HERE, 'magazine-repair-required-check.mjs')
const F = {
  kind: path.join(HERE, 'lib', 'magazine-failure-kind.mjs'),
  ready: path.join(HERE, 'magazine-auto-register-ready.mjs'),
  register: path.join(HERE, 'magazine-auto-register.mjs'),
  quarantine: path.join(HERE, 'lib', 'magazine-quarantine.mjs'),
  check: CHECK,
}

const MUTATIONS = [
  { name: 'BRIEF_FORMAT_CONTRACT 를 다시 CONTENT 로 계산', file: F.kind,
    find: "export const REPAIR_REQUIRED_CODES = ['BRIEF_FORMAT_CONTRACT', 'DRAFT_INVALID']",
    replace: "export const REPAIR_REQUIRED_CODES = ['DRAFT_INVALID']" },
  { name: 'DRAFT_INVALID 를 다시 CONTENT 로 계산', file: F.kind,
    find: "export const REPAIR_REQUIRED_CODES = ['BRIEF_FORMAT_CONTRACT', 'DRAFT_INVALID']",
    replace: "export const REPAIR_REQUIRED_CODES = ['BRIEF_FORMAT_CONTRACT']" },
  { name: 'repair-required 후보도 attempted += 1', file: F.ready,
    find: '      repairResults.push(r)\n',
    replace: '      repairResults.push(r)\n      attempted += 1\n' },
  { name: 'repair-required 후보에 recordFailure (일반 BLOCKED 경로로 흘린다)', file: F.ready,
    find: '    if (r.repairRequired) {',
    replace: '    if (r.repairRequired && false) {' },
  { name: 'repair-required 에서 회차 전체 중단', file: F.ready,
    find: '      continue // repair-required: 다음 후보',
    replace: "      budgetStop = { stop: true, code: 'REPAIR_REQUIRED', message: '입력 수리 필요' }\n      break" },
  { name: 'repair-required 뒤 정상 후보를 보지 않음', file: F.ready,
    find: '      continue // repair-required: 다음 후보',
    replace: '      break' },
  { name: 'drive 가 brief 계약 위반을 repair-required 로 표시하지 않음', file: F.register,
    find: '    if (!g0.ok && g0.code === BRIEF_FORMAT_CONTRACT_REASON) {\n      repairRequired = true\n',
    replace: '    if (!g0.ok && g0.code === BRIEF_FORMAT_CONTRACT_REASON) {\n' },
  { name: 'drive 가 brief echo draft 를 repair-required 로 표시하지 않음', file: F.register,
    find: '      if (echo.length) {\n        repairRequired = true\n',
    replace: '      if (echo.length) {\n' },
  /**
   * 🔴 HOME 격리 제거 — 검사가 **실제 경로에 닿기 전에** 스스로 멈춰야 한다 (mustSay 로 그 문장을 확인한다).
   *    이 변이는 검사 파일 자체를 바꾼다. 장부 lib 의 시험 모드 가드가 두 번째 방어선으로 남아 있다.
   */
  { name: '검사의 HOME 격리 제거', file: F.check,
    find: 'process.env.HOME = T\n',
    replace: '',
    mustSay: '격리 실패 — 검사 0건 실행' },
  { name: '시험 모드 운영 장부 가드 제거', file: F.quarantine,
    find: "  if (env.SORAN_MAGAZINE_TEST_MODE !== '1') return null\n",
    replace: '  return null\n' },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.map((m) => m.file))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })

const occurrences = (s, sub) => s.split(sub).length - 1
const lineOf = (out) => (out.match(/입력 수리 필요 회계 검사 \d+\/\d+/) ?? ['출력 없음'])[0]

let bad = 0
let caught = 0
console.log('\n입력 수리 필요 회계 변이 시험\n')
const base = spawnSync(process.execPath, [CHECK], { encoding: 'utf8' })
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 코드에서 검사가 FAIL 이다 (${lineOf(base.stdout)})`) } else console.log(`  기준선 (변이 없음) — PASS · ${lineOf(base.stdout)}`)
try {
  for (const mu of MUTATIONS) {
    const text = originals[mu.file].toString('utf8')
    const n = occurrences(text, mu.find)
    if (n !== 1) { bad++; console.log(`  ❌ ${mu.name} — ${path.basename(mu.file)} 에 바꿀 문장이 ${n}번 있다 (변이 무효)`); continue }
    fs.writeFileSync(mu.file, text.replace(mu.find, mu.replace))
    let r
    try { r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8' }) } finally { fs.writeFileSync(mu.file, originals[mu.file]) }
    if (sha(mu.file) !== startHashes[mu.file]) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    const failed = (r.stdout.match(/❌ [^\n]+/g) ?? [])
    if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어)`) } else if (mu.mustSay && !r.stdout.includes(mu.mustSay)) {
      bad++; console.log(`  ❌ ${mu.name} — FAIL 이지만 「${mu.mustSay}」 가 없다 (파일 접근 전에 멈췄는지 모른다)`)
    } else {
      caught++
      console.log(`  ✅ ${mu.name} — 검사 FAIL (${mu.mustSay ? `파일 접근 전 정지 · 「${mu.mustSay}」` : `${lineOf(r.stdout)} · 실패 항목 ${failed.length}`})`)
    }
  }
} finally {
  restoreAll()
}
const drift = files.filter((f) => sha(f) !== startHashes[f])
if (drift.length) { bad++; console.log(`  ❌ 끝난 뒤 원본과 다른 파일: ${drift.map((f) => path.basename(f)).join(', ')}`) } else console.log('\n  원복 확인 — 변이 대상 파일 전부 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
