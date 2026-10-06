#!/usr/bin/env node
/**
 * G8 편입기 변이 시험 — 관문 하나를 지운 lib 로 검사를 돌려 **검사가 FAIL 로 바뀌는지** 본다.
 *
 * 🔴 소스 문자열을 찾는 것으로 통과시키지 않는다. 변이마다 실제 검사(`magazine-g8-promote-check.mjs`)를
 *    변이된 lib 로 다시 돌리고, 종료 코드가 0 이 아니어야 PASS 다.
 * 🔴 저장소 파일을 고치지 않는다. scripts/lib 를 임시 폴더로 복사해 그 사본만 바꾼다.
 *    바꿀 문장이 사본에 정확히 한 번 있어야 한다 — 없거나 여럿이면 변이 자체가 무효라 FAIL 이다.
 *
 * 사용: node scripts/magazine-g8-promote-mutation.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECK = path.join(HERE, 'magazine-g8-promote-check.mjs')
const LIB_NAME = 'magazine-g8-promoter.mjs'

const MUTATIONS = [
  { name: 'AUTO_READY 필터 제거',
    find: "    if (build.automationDecision !== 'PASS' || build.topicVerdict !== 'AUTO_READY_TOPIC') {",
    replace: '    if (false) {' },
  { name: '기존 글 중복 필터 제거',
    find: "    if (owner?.startsWith('article:')) dup.push",
    replace: '    if (false) dup.push' },
  { name: '기존 큐 중복 필터 제거',
    find: "    if (owner?.startsWith('queue:')) dup.push",
    replace: '    if (false) dup.push' },
  { name: '필수 필드 fail-closed 제거',
    find: '      ...requiredFieldProblems({ canon: d.canon, build: d.build, unions: inputs.unions, relations: d.relations, slug: d.slug }),\n',
    replace: '' },
  { name: '제목 계약 제거',
    find: '      ...titleProblems(d.build.primaryQuery),\n',
    replace: '' },
  { name: '시리즈 선행 조건 제거',
    find: '    if (c.seriesOrder !== next) return',
    replace: '    if (false) return' },
  { name: 'publishWindow 제거',
    find: "  if (c.contentTypeHint === 'SEASONAL') {\n    // 분류가",
    replace: '  if (false) {\n    // 분류가' },
  { name: '결정적 정렬 제거',
    find: '  ranked.sort(compareCandidates)\n',
    replace: '' },
  { name: 'queue/graph 동일 manifest 계약 제거',
    find: '  return { ok: problems.length === 0, problems: [...new Set(problems)] }',
    replace: '  return { ok: true, problems: [] }' },
  { name: 'apply idempotence 제거',
    find: "  if (flags.every(Boolean)) return { ok: true, code: 'ALREADY_APPLIED', written: [] }\n",
    replace: '' },
]

const occurrences = (s, sub) => s.split(sub).length - 1
const original = fs.readFileSync(path.join(HERE, 'lib', LIB_NAME), 'utf8')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-mutation-'))
const libDir = path.join(tmp, 'lib')
fs.cpSync(path.join(HERE, 'lib'), libDir, { recursive: true })
const target = path.join(libDir, LIB_NAME)
const runCheck = () => spawnSync('node', [CHECK], { encoding: 'utf8', env: { ...process.env, G8_PROMOTER_LIB: target } })

let bad = 0
let caught = 0
console.log('\nG8 편입기 변이 시험\n')
fs.writeFileSync(target, original)
const base = runCheck()
const baseLine = (base.stdout.match(/G8 편입기 검사 \d+\/\d+/) ?? ['?'])[0]
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 사본에서 검사가 FAIL 이다 — 기준선이 깨졌다 (${baseLine})`) } else console.log(`  기준선 (변이 없음) — PASS · ${baseLine}`)

for (const mu of MUTATIONS) {
  const n = occurrences(original, mu.find)
  if (n !== 1) { bad++; console.log(`  ❌ ${mu.name} — 바꿀 문장이 ${n}번 있다 (정확히 1번이어야 한다)`); continue }
  fs.writeFileSync(target, original.replace(mu.find, mu.replace))
  const r = runCheck()
  const failed = (r.stdout.match(/❌ [^\n]+/g) ?? []).length
  const line = (r.stdout.match(/G8 편입기 검사 \d+\/\d+/) ?? [r.stderr.split('\n').find(Boolean) ?? '출력 없음'])[0]
  if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 관문)`) } else { caught++; console.log(`  ✅ ${mu.name} — 검사 FAIL (${line} · 실패 항목 ${failed})`) }
}
fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
