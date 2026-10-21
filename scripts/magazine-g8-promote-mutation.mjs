#!/usr/bin/env node
/**
 * G8 편입기 변이 시험 — 관문 하나를 지운 lib 로 검사를 돌려 **검사가 FAIL 로 바뀌는지** 본다.
 *
 * 🔴 소스 문자열을 찾는 것으로 통과시키지 않는다. 변이마다 실제 검사(`magazine-g8-promote-check.mjs`)를
 *    변이된 lib 로 다시 돌린다.
 * 🔴 저장소 파일을 고치지 않는다. scripts/lib 를 임시 폴더로 복사해 그 사본만 바꾼다.
 *    바꿀 문장이 사본에 정확히 한 번 있어야 한다 — 없거나 여럿이면 변이 자체가 무효라 하네스 FAIL 이다.
 * 🔴 **검출로 세는 것** — 요약 줄(`G8 편입기 검사 n/m`)이 있고 · exit ≠ 0 이고 ·
 *      `expect` 가 있으면 그 반례 이름이 실패 줄에 있을 때만,
 *      없으면 「예외로 중단」 이 아닌 실제 기대 실패가 하나 이상 있을 때만.
 *    적재 실패 · 요약 없음 · 지점 0곳/여러 곳은 하네스 FAIL 이다. 무변이 기준선은 fail 0 이어야 한다.
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

/** 신원 입력 한 키를 manifest 에서 빼는 변이 — 그 입력이 바뀌어도 STALE_INPUT 이 나오지 않는다 */
const keyDrop = (key, line) => ({ name: `신원 입력 ${key} 제거`, find: `    ${line},\n`, replace: '', expect: `${key} 만 바뀜` })
const SNAP_LINE = '    ...SNAPSHOT_FILES.map((n) => [`snapshot.${n}`, sha256(texts.snapshot[n])]),'
const snapDrop = (n) => ({ name: `신원 입력 snapshot.${n} 제거`, find: SNAP_LINE,
  replace: SNAP_LINE.replace('SNAPSHOT_FILES.map(', `SNAPSHOT_FILES.filter((n) => n !== '${n}').map(`), expect: `snapshot.${n} 만 바뀜` })

const MUTATIONS = [
  // ── 신원 입력 15개 ──
  keyDrop('product.articles', "['product.articles', sha256(texts.articles)]"),
  keyDrop('product.topicQueue', "['product.topicQueue', sha256(texts.topicQueue)]"),
  keyDrop('product.draftsSlugSet', "['product.draftsSlugSet', sha256(texts.draftSlugs.join('\\n'))]"),
  keyDrop('product.graphCurrent', "['product.graphCurrent', sha256(texts.graphCurrent)]"),
  keyDrop('product.graphBundle', "['product.graphBundle', sha256(texts.graphBundle)]"),
  keyDrop('product.graphControl', "['product.graphControl', sha256(texts.graphControl)]"),
  keyDrop('product.graphResolver', "['product.graphResolver', sha256(texts.graphResolver)]"),
  keyDrop('research.slugManifest', "['research.slugManifest', absent(texts.slugManifest)]"),
  keyDrop('research.ledger', "['research.ledger', absent(texts.ledger)]"),
  keyDrop('research.slugModule', "['research.slugModule', sha256(texts.slugModule)]"),
  ...['g4-intents-canonical.jsonl', 'g4-automation-2026-09-23.jsonl', 'g5-graph-2026-09-23.jsonl', 'assets-published.jsonl', 'assets-queue.jsonl'].map(snapDrop),
  // ── 제품 bundle 대조 ──
  { name: 'EXPORT_HASH 대조 제거', find: "  if (sha16(JSON.stringify(payload)) !== exportHash) problems.push(", replace: '  if (false) problems.push(', expect: 'EXPORT_HASH 는 그대로' },
  { name: 'payload deep-equal 제거', find: '  if (JSON.stringify(recomputed) !== JSON.stringify(payload)) problems.push(', replace: '  if (false) problems.push(', expect: 'EXPORT_HASH 도 다시 맞춤' },
  { name: 'contentHash 필드별 대조 제거', find: '    if (core.contentHash[k] !== pc[k]) problems.push(', replace: '    if (false) problems.push(', expect: 'contentHash.participation 만 위조' },
  { name: 'control 판 대조 제거', find: '  if (parseControlText(texts.graphControl)?.graphVersion !== payload.graphVersion) problems.push(', replace: '  if (false) problems.push(', expect: 'control 이 다른 판' },
  // ── receipt 불변식 ──
  { name: 'receipt 파일명 대조 제거', find: '  if (path.basename(file) !== `${r.manifestHash}.json`) out.push(', replace: '  if (false) out.push(', expect: '위조 receipt(파일명)' },
  { name: 'receipt manifest 해시 대조 제거', find: '  if (hashManifest(r.manifest) !== r.manifestHash || r.manifest?.hash !== r.manifestHash) out.push(', replace: '  if (false) out.push(', expect: '위조 receipt(manifest 원문 변조' },
  { name: 'receiptHash 대조 제거', find: '  if (receiptHashOf(r) !== r.receiptHash) out.push(', replace: '  if (false) out.push(', expect: '위조 receipt(receiptHash 위조)' },
  { name: '기계 승인자 허용', find: '  else if (MACHINE_APPROVER.test(by)) out.push(', replace: '  else if (false) out.push(', expect: '위조 receipt(기계 승인자' },
  { name: 'confirm hash 대조 제거', find: "  if (approval?.confirmManifestHash !== manifestHash) out.push('CONFIRM_HASH_MISMATCH')", replace: '  void manifestHash', expect: '위조 receipt(confirm hash' },
  { name: 'receipt wx 제거 (rename 으로 덮어쓰기)', find: '  try { fs.linkSync(tmp, file) } finally {', replace: '  try { fs.renameSync(tmp, file) } finally {', expect: 'receipt 를 놓는 순간 이미 있으면' },
  // ── staged preflight ──
  { name: '부분 preflight write 허용', find: '  if (!staged.ok) return done({ ...staged, recovered })',
    replace: "  if (!staged.ok) { writeAtomic(path.join(researchDir, ADMISSION_FILES.slugManifest), '{\"slugs\":{}}\\n'); return done({ ...staged, recovered }) }", expect: '두 번째 slug 충돌' },
  { name: 'idempotent 를 신규 성공으로', find: '      if (!r.ok || !r.appended) return', replace: '      if (!r.ok) return', expect: '두 번째가 idempotent' },
  { name: '임시 verifyAdmissions 생략', find: "    if (!v.ok) return { ok: false, code: 'STAGED_VERIFY_FAILED'", replace: "    if (false) return { ok: false, code: 'STAGED_VERIFY_FAILED'", expect: '장부 관계가 receipt 와 다르다' },
  { name: 'append-only 접두 검사 제거', find: '    if (!ledgerAfter.subarray(0, before.length).equals(before)) return', replace: '    if (false) return', expect: '기존 장부 바이트를 바꾼다' },
  // ── commit-forward · 복구 ──
  { name: '복구에서 정본 pipeline 을 다시 부른다', find: "  if (bad.length) return { ok: false, code: 'RECOVERY_IDENTITY', why: bad.join(', ') }\n",
    replace: "  if (bad.length) return { ok: false, code: 'RECOVERY_IDENTITY', why: bad.join(', ') }\n  await import(pathToFileURL(path.join(researchDir, RESEARCH_FILES.pipelineModule)).href)\n", expect: '명시 복구 (의미 모듈 대역' },
  { name: 'ledger 를 before 길이로 되돌리는 경로', find: "      return { ok: false, code: 'LEDGER_CONFLICT',", replace: "      fs.truncateSync(L.path, L.beforeLength); return { ok: false, code: 'LEDGER_CONFLICT',", expect: 'ledger 에 다른 writer 가 붙였다' },
  { name: 'slug CONFLICT 덮어쓰기', find: "  else if (curSlug !== S.afterSha256) return { ok: false, code: 'SLUG_MANIFEST_CONFLICT', why: `${S.path} 가 before 도 after 도 아니다 — 덮지 않는다` }",
    replace: '  else if (curSlug !== S.afterSha256) writeAtomic(S.path, S.afterBytes)', expect: 'slug 표가 세 번째 상태' },
  { name: 'receipt CONFLICT 덮어쓰기', find: "return { ok: false, code: 'RECEIPT_CONFLICT', why: `${R.path} 가 journal 의 receipt 와 다르다 — 덮지 않는다` }",
    replace: 'writeAtomic(R.path, R.bytes)', expect: '다른 receipt 가 놓였다' },
  { name: 'ledger 접두(beforeLength · beforeSha) 검사 제거', find: 'cur.length < L.beforeLength || headSha !== L.beforeSha256 || ', replace: '', expect: 'ledger 앞부분이 같은 길이로 바뀌었다' },
  { name: 'journal 신원 검증 제거', find: "  if (bad.length) return { ok: false, code: 'RECOVERY_IDENTITY', why: bad.join(', ') }\n", replace: '  void bad\n', expect: '위조 journal(연구 밖 경로)' },
  { name: 'apply 앞 journal 복구 제거', find: '    recovered = await recoverJournal({ researchDir, repoDir, faultHook, knownLegacy })', replace: "    recovered = { ok: true, code: 'SKIPPED' }", expect: '잠금 없이 남은 journal' },
  // ── slug · legacy · 잠금 · 큐 · 재실행 ──
  { name: 'proposeSlug 를 assignSlugs 로 교체', find: '  return mod.proposeSlug\n', replace: '  return (q, t) => mod.assignSlugs([{ primaryQuery: q, territoryId: t }])[0]?.slug\n', expect: 'assignSlugs 를 불렀다' },
  { name: 'KNOWN_LEGACY 완화 (receipt 없으면 legacy)', find: '    else if (legacyKey.has(`${key}|${sha256(line)}`)) classes.KNOWN_LEGACY++', replace: '    else if (true) classes.KNOWN_LEGACY++', expect: '행 바이트가 다르면 UNKNOWN' },
  { name: '잠금 O_EXCL 제거', find: "  try { fd = fs.openSync(file, 'wx') } catch (e) {", replace: "  try { fd = fs.openSync(file, 'w') } catch (e) {", expect: '남은 잠금(죽은 PID)' },
  { name: 'stale 잠금 자동 탈취 (죽은 PID 면 지운다)', find: "    if (e.code !== 'EEXIST') throw e\n",
    replace: "    if (e.code !== 'EEXIST') throw e\n    try { process.kill(JSON.parse(fs.readFileSync(file, 'utf8')).pid, 0) } catch { fs.rmSync(file, { force: true }); return acquireLock(researchDir, manifestHash) }\n", expect: '남은 잠금(죽은 PID)' },
  { name: '큐 쓰기 복원', find: "  faultHook('journal:written')\n",
    replace: "  faultHook('journal:written')\n  writeAtomic(path.join(repoDir, PRODUCT_FILES.queue), insertQueueRows(fs.readFileSync(path.join(repoDir, PRODUCT_FILES.queue), 'utf8'), [{ day: 999, slug: manifest.admissions[0].slug }]))\n",
    expect: 'topic queue 바이트 불변' },
  { name: 'ALREADY_APPLIED 판정 완화', find: "  if (already.state === 'COMPLETE') return", replace: "  if (already.state !== 'ABSENT') return", expect: 'binding 이 빠졌다' },
  // ── 공용 helper (입력 수리 · DIRECT source 가 쓴다) ──
  { name: '입력 수리 journal 경로 대조 제거', find: '  if (sorted.some((p, i) => p !== want[i])) return failId(', replace: '  if (false) return failId(', expect: 'journal 신원 — 정상' },
  { name: 'G8 v1 큐 대조 무력화', find: '  return { ok: problems.length === 0, problems: [...new Set(problems)] }', replace: '  return { ok: true, problems: [] }', expect: 'G8 v1 큐 대조' },
  // ── 3차 (e213d7a NO-GO 결함) — M-AUTO 등록 · 큐 잠금 ──
  { name: 'M-AUTO 등록의 큐 writer 잠금 제거', file: 'magazine-register.mjs',
    find: '  const locked = withQueueWriteLock(queuePath, () => writeLocked(), { waitMs: REGISTER_QUEUE_LOCK_WAIT_MS })',
    replace: '  const locked = { ok: true, value: writeLocked() }' },
  { name: '스냅샷 원복 CAS 제거', file: 'lib/magazine-queue-lock.mjs',
    find: "  if (foreign.length) return { action: 'conflict', why: `회차 뒤 다른 writer 가 더한 행이",
    replace: "  if (false) return { action: 'conflict', why: `회차 뒤 다른 writer 가 더한 행이" },
  // ── 4차 (0c3df1b NO-GO 결함) ──
  { name: '잠금 키를 큐 파일 경로로 되돌림', file: 'lib/magazine-queue-lock.mjs',
    find: '  return join(queueLockDir(env), `${scope.scope}.queue`)',
    replace: "  return join(queueLockDir(env), `${scope.scope}-${String(queuePath).replace(/[^a-z0-9]/gi, '_').slice(-80)}.queue`)" },
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
const SUMMARY = /G8 편입기 검사 (\d+)\/(\d+)/

let bad = 0
let caught = 0
console.log('\nG8 편입기 변이 시험\n')
resetAll()
const base = runCheck()
const baseLine = (base.stdout.match(SUMMARY) ?? ['요약 없음'])[0]
if (base.status !== 0 || !SUMMARY.test(base.stdout)) { bad++; console.log(`  ❌ 변이 없는 사본에서 검사가 FAIL 이다 — 기준선이 깨졌다 (${baseLine})`) } else console.log(`  기준선 (변이 없음) — PASS · ${baseLine}`)

for (const mu of MUTATIONS) {
  const file = mu.file ?? DEFAULT_FILE
  const n = occurrences(originals[file], mu.find)
  if (n !== 1) { bad++; console.log(`  ❌ ${mu.name} — ${file} 에 바꿀 문장이 ${n}번 있다 (정확히 1번이어야 한다)`); continue }
  resetAll()
  fs.writeFileSync(path.join(tmp, file), originals[file].replace(mu.find, mu.replace))
  const r = runCheck()
  const summary = r.stdout.match(SUMMARY)
  const failedLines = r.stdout.split('\n').filter((l) => l.includes('❌'))
  const realFailures = failedLines.filter((l) => !l.includes('예외로 중단'))
  if (!summary) { bad++; console.log(`  ❌ ${mu.name} — 요약 없음 · 적재 실패(검출 아님): ${(r.stderr.split('\n').find(Boolean) ?? '').slice(0, 160)}`); continue }
  const hit = mu.expect ? failedLines.some((l) => l.includes(mu.expect)) : realFailures.length > 0
  if (r.status !== 0 && hit) { caught++; console.log(`  ✅ ${mu.name} — 검사 FAIL (${summary[0]}${mu.expect ? ` · 「${mu.expect}」` : ''})`) }
  else { bad++; console.log(`  ❌ ${mu.name} — ${r.status === 0 ? '검사가 여전히 PASS 다 (죽은 관문)' : `기대한 실패가 아니다 (${summary[0]} · ${failedLines[0]?.trim().slice(0, 120) ?? ''})`}`) }
}
fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
