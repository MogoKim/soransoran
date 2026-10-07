#!/usr/bin/env node
/**
 * page 0건 복구 변이 시험 — 관문 하나를 바꾼 lib 로 `chatgpt-zero-page-check.mjs` 를 다시 돌려
 * **검사가 FAIL 로 바뀌는지** 본다. 저장소 파일은 고치지 않는다 — scripts/lib 를 임시 폴더에 복사해 사본만 바꾼다.
 * 바꿀 문장이 사본에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 자체가 무효라 FAIL).
 *
 * 🔴 검사 쪽에 실제 CDP 포트(9333/9344) 차단이 있다 — 변이가 주입을 무너뜨려도 운영 Chrome 에 닿지 않는다.
 *
 * 사용: node scripts/chatgpt-zero-page-mutation.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECK = path.join(HERE, 'chatgpt-zero-page-check.mjs')
const SESSION = 'chatgpt-session.mjs'
const PROFILE = 'chatgpt-automation-profile.mjs'

const MUTATIONS = [
  { name: 'page 0건 복구 제거', file: SESSION,
    find: '  if (first.ok || first.zeroPage !== true) return first',
    replace: '  if (true) return first' },
  { name: 'fail-closed 완화 — 어떤 불일치에서든 탭을 연다', file: SESSION,
    find: '  if (first.ok || first.zeroPage !== true) return first',
    replace: "  if (first.ok || first.code !== 'AUTOMATION_PROFILE_MISMATCH') return first" },
  { name: 'fail-closed 완화 — 목록 읽기 실패를 page 0건으로 본다', file: PROFILE,
    find: "    return { ok: false, why: 'CDP 페이지 목록을 읽지 못했다 — 어떤 창인지 모른다' }",
    replace: "    return { ok: false, zeroPage: true, why: 'CDP 페이지 목록을 읽지 못했다 — 어떤 창인지 모른다' }" },
  { name: 'fail-closed 완화 — 남의 페이지가 있어도 page 0건으로 본다', file: PROFILE,
    find: "  const bad = list.filter((t) => !allowed.has(hostOf(t.url)))\n  if (bad.length) {",
    replace: "  const bad = list.filter((t) => !allowed.has(hostOf(t.url)))\n  if (bad.length && list.length > bad.length) {" },
  { name: '/json/new 실패를 무시', file: SESSION,
    find: '  if (!opened.ok) {',
    replace: '  if (false) {' },
  { name: '열린 target 의 ChatGPT 검사 제거', file: SESSION,
    find: '  if (!isChatgptTarget(opened.target)) {',
    replace: '  if (false) {' },
  { name: '탭을 연 뒤 전체 신원 재검사 제거', file: SESSION,
    find: '  let again = await verifyProfileFn(args)',
    replace: '  let again = { ...first, ok: true, zeroPage: false }' },
  { name: 'hero 경로(ensureChrome)에서 복구 제거', file: SESSION,
    find: '  const verify = (a) => verifyWithZeroPageBootstrap(verifyProfileFn, a, { openTargetFn, closeTargetFn, listTargetsFn })',
    replace: '  const verify = (a) => verifyProfileFn(a)' },
  { name: '실패 cleanup 제거 — 연 탭을 남긴다', file: SESSION,
    find: '    const cl = await cleanup()',
    replace: "    const cl = { closeAttempted: false, closed: false, residue: 'none' }" },
  { name: '기존 target 까지 닫기 — 목록의 ChatGPT page 를 전부 닫는다', file: SESSION,
    find: '    const c = await closeTargetFn(targetId)',
    replace: '    const all = await listTargetsFn(); for (const t of all?.targets ?? []) if (t?.id !== targetId && isChatgptTarget(t)) await closeTargetFn(t.id)\n    const c = await closeTargetFn(targetId)' },
  { name: 'close 실패 무시 — 닫았다고 기록한다', file: SESSION,
    find: "    if (!c?.ok) return { closeAttempted: true, closed: false, residue: 'present', closeWhy: c?.why ?? '사유 없음' }",
    replace: "    if (!c?.ok) return { closeAttempted: true, closed: true, residue: 'none' }" },
  { name: 'id 없을 때 추측해서 닫기', file: SESSION,
    find: "    if (typeof targetId !== 'string' || !TARGET_ID_RE.test(targetId)) {",
    replace: "    if (false) {" },
  { name: 'hero 경로 post 실패 cleanup 제거', file: SESSION,
    find: '      if (own && TARGET_ID_RE.test(own)) {',
    replace: '      if (false) {' },
]

const occurrences = (s, sub) => s.split(sub).length - 1
const originals = Object.fromEntries([SESSION, PROFILE].map((f) => [f, fs.readFileSync(path.join(HERE, 'lib', f), 'utf8')]))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-page-mutation-'))
const libDir = path.join(tmp, 'lib')
fs.cpSync(path.join(HERE, 'lib'), libDir, { recursive: true })
const resetAll = () => { for (const [f, text] of Object.entries(originals)) fs.writeFileSync(path.join(libDir, f), text) }
const runCheck = () => spawnSync('node', [CHECK], { encoding: 'utf8', env: { ...process.env, CHATGPT_ZERO_PAGE_LIB_DIR: libDir } })
const lineOf = (r) => (r.stdout.match(/page 0건 복구 검사 \d+\/\d+/) ?? [r.stderr.split('\n').find(Boolean) ?? '출력 없음'])[0]

let bad = 0
let caught = 0
console.log('\npage 0건 복구 변이 시험\n')
resetAll()
const base = runCheck()
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 사본에서 검사가 FAIL 이다 (${lineOf(base)})`) } else console.log(`  기준선 (변이 없음) — PASS · ${lineOf(base)}`)
for (const mu of MUTATIONS) {
  const n = occurrences(originals[mu.file], mu.find)
  if (n !== 1) { bad++; console.log(`  ❌ ${mu.name} — ${mu.file} 에 바꿀 문장이 ${n}번 있다`); continue }
  resetAll()
  fs.writeFileSync(path.join(libDir, mu.file), originals[mu.file].replace(mu.find, mu.replace))
  const r = runCheck()
  const failed = (r.stdout.match(/❌ [^\n]+/g) ?? []).length
  const touchedReal = /실제 CDP 에 닿으려 했다/.test(r.stdout)
  if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 관문)`) } else { caught++; console.log(`  ✅ ${mu.name} — 검사 FAIL (${lineOf(r)} · 실패 항목 ${failed}${touchedReal ? ' · 실제 CDP 시도는 차단됨' : ''})`) }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
