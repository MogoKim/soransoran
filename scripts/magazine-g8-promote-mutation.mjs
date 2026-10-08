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
    find: "  if (complete) return { ok: true, code: 'ALREADY_APPLIED', written: [], recovered }\n",
    replace: '' },
  // ── 2차 (c27fb23 NO-GO 결함) ──
  { name: 'apply 재해시를 큐 하나로 축소',
    find: '  const stale = diffHashes(manifest.inputs, current.hashes)',
    replace: '  const stale = diffHashes({ product: { queue: manifest.inputs.product.queue } }, { product: { queue: current.hashes.product.queue } })' },
  { name: '단일 writer 잠금 제거 (편입 장부 잠금)',
    find: '    const inner = withQuarantineLock(ledgerPath, () => applyLocked(ctx), { waitMs: 0 })',
    replace: '    const inner = { ok: true, value: applyLocked(ctx) }' },
  { name: '급사 journal 복구 제거',
    find: '  if (fs.existsSync(journalPath)) {\n    recovered = recoverJournal(journalPath, Object.values(files))',
    replace: '  if (false) {\n    recovered = recoverJournal(journalPath, Object.values(files))' },
  { name: '정본 recordAdmission 대신 장부 직접 append',
    find: '  const staged = stageAdmissions(pipeline, before.ledger, manifest.admissionRows, manifest.at)',
    replace: "  const staged = { ok: true, text: (before.ledger ?? '') + manifest.admissionRows.map((r) => `${JSON.stringify({ schemaVersion: 'm3ledger/2', event: 'ADMITTED', ...r, at: manifest.at })}\\n`).join('') }" },
  { name: '부분 답변·범위 확장을 완료 답변으로 되돌림',
    find: "  'ANSWERS', 'ANSWERS_WITH_DEFECT',\n",
    replace: "  'ANSWERS', 'ANSWERS_WITH_DEFECT', 'ANSWERS_PARTIAL', 'ANSWERS_WITH_SCOPE_EXPANSION',\n" },
  { name: '판정 시각을 그날 23:59:59 로 해석',
    find: '  const nowMs = time.ms\n',
    replace: '  const nowMs = new Date(`${time.asOf}T23:59:59+09:00`).getTime()\n' },
  // ── 3차 (e213d7a NO-GO 결함) ──
  { name: '빈 manifest 를 잠금·복구 전에 반환',
    find: '  let pipeline = null\n',
    replace: "  if (!manifest.queueRows.length) return { ok: true, code: 'NOTHING_TO_APPLY', written: [] }\n  let pipeline = null\n" },
  { name: 'G8 apply 의 큐 writer 잠금 제거',
    find: '  const locked = withQueueWriteLock(queueFile, () => {',
    replace: '  const locked = ((_, fn) => ({ ok: true, value: fn() }))(queueFile, () => {' },
  { name: 'M-AUTO 등록의 큐 writer 잠금 제거', file: 'magazine-register.mjs',
    find: '  const locked = withQueueWriteLock(queuePath, () => writeLocked(), { waitMs: REGISTER_QUEUE_LOCK_WAIT_MS })',
    replace: '  const locked = { ok: true, value: writeLocked() }' },
  { name: '스냅샷 원복 CAS 제거', file: 'lib/magazine-queue-lock.mjs',
    find: "  if (foreign.length) return { action: 'conflict', why: `회차 뒤 다른 writer 가 더한 행이",
    replace: "  if (false) return { action: 'conflict', why: `회차 뒤 다른 writer 가 더한 행이" },
  { name: 'journal 신원 검증 제거',
    find: '  const id = checkJournalIdentity(j, expectedPaths)\n',
    replace: '  const id = { ok: true }\n' },
  // ── 4차 (0c3df1b NO-GO 결함) ──
  { name: '잠금 키를 큐 파일 경로로 되돌림', file: 'lib/magazine-queue-lock.mjs',
    find: '  return join(QUEUE_LOCK_DIR, `${scope.scope}.queue`)',
    replace: "  return join(QUEUE_LOCK_DIR, `${scope.scope}-${String(queuePath).replace(/[^a-z0-9]/gi, '_').slice(-80)}.queue`)" },
  { name: '시험 scope 주입의 운영 차단 제거', file: 'lib/magazine-queue-lock.mjs',
    find: "  if (env.SORAN_MAGAZINE_TEST_MODE !== '1') {\n    return { ok: false, why: 'SORAN_MAGAZINE_QUEUE_LOCK_SCOPE",
    replace: "  if (false) {\n    return { ok: false, why: 'SORAN_MAGAZINE_QUEUE_LOCK_SCOPE" },
  { name: '쌍 원복 — 큐 판정 전에 articles 독립 원복', file: 'lib/magazine-queue-lock.mjs',
    find: "    if (da.action === 'conflict' || dq.action === 'conflict') {",
    replace: "    if (da.action === 'conflict') {" },
  { name: '쌍 원복 — 쓰기 실패 보상 제거', file: 'lib/magazine-queue-lock.mjs',
    find: '      for (const step of done.reverse()) {',
    replace: '      for (const step of []) {' },
  { name: '쌍 원복 — 큐 writer 잠금 제거', file: 'lib/magazine-queue-lock.mjs',
    find: '  const locked = withQueueWriteLock(queue.path, () => {\n    const nowA',
    replace: '  const locked = ((_, fn) => ({ ok: true, value: fn() }))(queue.path, () => {\n    const nowA' },
  { name: '등록 — 계획 시점 articles 사본으로 쓰기', file: 'magazine-register.mjs',
    find: "    const articlesNow = existsSync(articlesPath) ? readFileSync(articlesPath, 'utf8') : ''",
    replace: '    const articlesNow = articlesSrc' },
  { name: '등록 — 잠금 안 중복 재검사 제거', file: 'magazine-register.mjs',
    find: '    if (current.articles.some((a) => a.slug === p.slug)) return',
    replace: '    if (false) return' },
  { name: '등록 — 잠금 안 슬롯 재검사 제거', file: 'magazine-register.mjs',
    find: '    if (taken.has(norm.date)) return',
    replace: '    if (false) return' },
  { name: '등록 — 재검사 파서가 export const 만 본다 (실제 articles.ts 는 export 없음)', file: 'magazine-register.mjs',
    find: '/\\bconst\\s+[A-Za-z_$][\\w$]*\\s*(?::[^=\\n]+)?=\\s*\\{/g',
    replace: '/\\bexport const\\s+[A-Za-z_$][\\w$]*\\s*(?::[^=\\n]+)?=\\s*\\{/g' },
  // ── 5차 (3c057cb · Codex P0 — register durable transaction) ──
  { name: '등록 transaction — journal 기록 제거', file: 'magazine-register.mjs',
    find: '    try { atomicWrite(jp, JSON.stringify(journal), dirname(jp)) } catch (e) {',
    replace: '    try { void journal } catch (e) {' },
  { name: '등록 transaction — 미완료 journal 복구 제거', file: 'magazine-register.mjs',
    find: "  if (!existsSync(jp)) return { ok: true, action: 'NONE' }",
    replace: "  return { ok: true, action: 'NONE' }" },
  { name: '등록 transaction — journal 신원 검증 제거', file: 'magazine-register.mjs',
    find: '  const id = checkRegisterJournalIdentity(j, { articlesPath, queuePath })',
    replace: '  const id = { ok: true }' },
  { name: '등록 transaction — 완주 인식 제거', file: 'magazine-register.mjs',
    find: "  if (sa === 'after' && sq === 'after') {",
    replace: '  if (false) {' },
  { name: '등록 transaction — 다른 writer 변경(CONFLICT) 판정 제거', file: 'magazine-register.mjs',
    find: "    return cur === f.afterSha ? 'after' : cur === sha(f.before) ? 'before' : 'other'",
    replace: "    return cur === f.afterSha ? 'after' : 'before'" },
]

const occurrences = (s, sub) => s.split(sub).length - 1
/** 변이할 수 있는 파일 — scripts/ 기준. 사본 안에서 같은 상대 경로로 서로를 import 한다 */
const DEFAULT_FILE = `lib/${LIB_NAME}`
const FILES = [...new Set([DEFAULT_FILE, ...MUTATIONS.map((m) => m.file ?? DEFAULT_FILE)])]
const originals = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(HERE, f), 'utf8')]))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-mutation-'))
fs.cpSync(path.join(HERE, 'lib'), path.join(tmp, 'lib'), { recursive: true })
const target = path.join(tmp, 'lib', LIB_NAME)
/** 변이마다 모든 사본을 원본으로 되돌린 뒤 하나만 바꾼다 — 변이가 쌓이지 않는다 */
const resetAll = () => { for (const f of FILES) fs.writeFileSync(path.join(tmp, f), originals[f]) }
const runCheck = () => spawnSync('node', [CHECK], { encoding: 'utf8', env: { ...process.env, G8_PROMOTER_LIB: target } })

let bad = 0
let caught = 0
console.log('\nG8 편입기 변이 시험\n')
resetAll()
const base = runCheck()
const baseLine = (base.stdout.match(/G8 편입기 검사 \d+\/\d+/) ?? ['?'])[0]
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 사본에서 검사가 FAIL 이다 — 기준선이 깨졌다 (${baseLine})`) } else console.log(`  기준선 (변이 없음) — PASS · ${baseLine}`)

for (const mu of MUTATIONS) {
  const file = mu.file ?? DEFAULT_FILE
  const n = occurrences(originals[file], mu.find)
  if (n !== 1) { bad++; console.log(`  ❌ ${mu.name} — ${file} 에 바꿀 문장이 ${n}번 있다 (정확히 1번이어야 한다)`); continue }
  resetAll()
  fs.writeFileSync(path.join(tmp, file), originals[file].replace(mu.find, mu.replace))
  const r = runCheck()
  const failed = (r.stdout.match(/❌ [^\n]+/g) ?? []).length
  const line = (r.stdout.match(/G8 편입기 검사 \d+\/\d+/) ?? [r.stderr.split('\n').find(Boolean) ?? '출력 없음'])[0]
  if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 관문)`) } else { caught++; console.log(`  ✅ ${mu.name} — 검사 FAIL (${line} · 실패 항목 ${failed})`) }
}
fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
