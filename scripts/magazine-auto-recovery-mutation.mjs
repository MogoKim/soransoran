#!/usr/bin/env node
/**
 * 자동 회복 계약 변이 시험 — 방어를 지운 코드로 `magazine-auto-recovery-check.mjs` (격리 변이는 G8·m3a 검사)를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 * 바꿀 문장이 파일에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 무효 = FAIL).
 * 🔴 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다. 중간에 끊겨도 되돌린다.
 *
 * 사용: node scripts/magazine-auto-recovery-mutation.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
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
  reconcile: path.join(HERE, 'lib', 'magazine-lineage-reconcile.mjs'),
  repair: path.join(HERE, 'lib', 'magazine-input-repair.mjs'),
  pexit: path.join(HERE, 'lib', 'magazine-producer-exit.mjs'),
  gate: path.join(HERE, 'lib', 'magazine-delivery-gate.mjs'),
  qlock: path.join(HERE, 'lib', 'magazine-queue-lock.mjs'),
  g8check: path.join(HERE, 'magazine-g8-promote-check.mjs'),
  m3acheck: path.join(HERE, 'magazine-m3a-check.mjs'),
}
/** 변이마다 돌릴 검사 — 기본은 자동 회복 계약 검사. 🔴 격리 변이는 운영 HOME 이 아닌 임시 HOME 으로 띄운다 (변이가 운영 queue-locks 에 닿지 않게) */
const CHECKS = {
  recovery: { file: CHECK, line: /자동 회복 계약 검사 \d+\/\d+/g, fail: /❌ [^\n]+/g },
  g8: { file: F.g8check, line: /G8 편입기 검사 \d+\/\d+/g, fail: /❌ [^\n]+/g },
  m3a: { file: F.m3acheck, line: /\d+ PASS · \d+ FAIL/g, fail: /^ {2}FAIL [^\n]+/gm, tmpHome: true },
}
const MUTATIONS = [
  // ── C 예산 계보 ──
  { name: 'C 계보 무시 — 전체 횟수로만 판정 (앞판)', edits: [{ file: F.quarantine, find: '  const used = lineage.calls\n', replace: '  const used = total\n' }] },
  { name: 'C 전체 상한 4 제거', edits: [{ file: F.quarantine, find: "  const exhaustedBy = total >= capTotal ? 'TOTAL'", replace: "  const exhaustedBy = false ? 'TOTAL'" }] },
  { name: 'C 같은 증거로 계보 재개방 허용', edits: [{ file: F.quarantine, find: "  if (p.regenLineage?.evidenceKey === key || seen.includes(key)) return { entry: p, opened: false, reason: 'SAME_EVIDENCE' }", replace: "  if (false) return { entry: p, opened: false, reason: 'SAME_EVIDENCE' }" }] },
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
  { name: 'A 장부에 원고 앞부분까지 저장', edits: [{ file: F.quarantine, find: "    violations: sanitizeViolations(e.violations ?? e.invalid), at: now }", replace: "    violations: sanitizeViolations(e.violations ?? e.invalid), responseExcerpt: e.responseExcerpt ?? null, at: now }" }] },
  { name: 'A 위반 why 160자 상한 제거', edits: [{ file: F.quarantine, find: ".replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, VIOLATION_WHY_MAX)", replace: ".replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim()" }] },
  { name: 'A 코드명을 why 로 지어내는 경로 (앞판)', edits: [{ file: F.quarantine, find: "    if (!code || !why || why === code) continue\n", replace: "    if (!code) continue\n    if (!why) { out.push({ code, why: code }); continue }\n" }] },
  { name: 'A 정산 안 된 응답도 교정', edits: [{ file: F.register, find: '    && row?.settled === true\n', replace: '' }] },
  // ── E 정산 원자성 ──
  { name: 'E 예약 해제와 결말 기록을 두 번에 (앞판 release → 기록)', edits: [{ file: F.quarantine,
    find: "    phaseHook('before-commit')\n    settled = true\n    return { ...cur, [slug]: next }\n  }, path)\n",
    replace: "    settled = true\n    return { ...cur, [slug]: clearDelivery(e) }\n  }, path)\n  phaseHook('before-commit')\n  updateQuarantine((cur) => ({ ...cur, [slug]: { ...cur[slug], ...(lineage || outcome ? { ...(outcome?.kind === 'FIRST_RESPONSE_INVALID' ? { firstResponseInvalid: firstResponseInvalidRecord(outcome.evidence, now) } : {}) } : {}) } }), path)\n" }] },
  { name: 'E 예약 ID CAS 제거', edits: [{ file: F.quarantine, find: "    if (!e || e.delivery?.reservationId !== reservationId) return cur\n    let next = clearDelivery(e)", replace: "    if (!e) return cur\n    let next = clearDelivery(e)" }] },
  { name: 'E 증거 부족 정산 허용', edits: [{ file: F.quarantine, find: "  if (outcome && outcome.kind === 'FIRST_RESPONSE_INVALID' && !identifiedInvalidRecord(firstResponseInvalidRecord(outcome.evidence, now))) {", replace: "  if (false) {" }] },
  // ── F 입력 수리 계보 영수증 ──
  { name: 'F 교체 전 영수증을 남기지 않음', edits: [{ file: F.repair, find: "    writeLineagePending({ draftsDir, slug: t.slug, beforeSha:", replace: "    void ({ draftsDir, slug: t.slug, beforeSha:" }] },
  { name: 'F 계보 기록 실패를 APPLIED 로 숨김', edits: [{ file: F.repair, find: "    if (!lineage.ok || !['OPENED', 'SAME_EVIDENCE'].includes(lineage.status)) {", replace: "    if (false) {" }] },
  { name: 'F 다음 회차가 영수증을 완성하지 않음', edits: [{ file: F.repair, find: "  const lineagePending = completeAllPendingLineages({ draftsDir, path: quarantinePath })", replace: "  const lineagePending = []" }] },
  { name: 'F 원복된 교체(교체 전 sha)도 계보를 연다', edits: [{ file: F.reconcile, find: "  if (cur === j.beforeSha) {", replace: "  if (false) {" }] },
  { name: 'F 수동 편집 draft 도 계보를 연다 (CONFLICT 제거)', edits: [{ file: F.reconcile, find: "  if (cur !== j.afterSha) return { ok: false, status: 'CONFLICT'", replace: "  if (false) return { ok: false, status: 'CONFLICT'" }] },
  { name: 'F producer 가 LINEAGE_PENDING 을 성공으로 봄', edits: [{ file: F.pexit, find: "  'LINEAGE_PENDING'])", replace: "  ])" }] },
  // ── G 옛 행 대조 ──
  { name: 'G 영수증 여러 개도 대조 (애매 허용)', edits: [{ file: F.reconcile, find: '  if (receipts.length !== 1) return no(', replace: '  if (receipts.length < 1) return no(' }] },
  { name: 'G 지금 draft 검증 생략', edits: [{ file: F.reconcile, find: '  if (!draft.ok) return no(draft.why)\n', replace: '' }] },
  { name: 'G 결과 행 APPLIED 확인 생략', edits: [{ file: F.reconcile, find: "  if (!(row.type === 'DRAFT_INVALID_BRIEF_ECHO' && row.outcome === 'APPLIED' && row.candidateApplied === true && row.sent === true)) {", replace: "  if (false) {" }] },
  { name: 'G gray — 전송 예약 남은 행도 대조 (신원 미확인 허용)', edits: [{ file: F.reconcile, find: "  if (entry.delivery) return no('전송 예약·전송불명 기록이 있다 — 응답을 특정하지 못한 것일 수 있다')\n", replace: '' }] },
  { name: 'G 일반 전송 관문이 교정 대기를 보지 않음', edits: [{ file: F.gate, find: '    if (recorded || legacy?.ok) {', replace: '    if (false) {' }] },
  // ── 격리 — 운영 queue-locks ──
  { name: '격리 G8 검사가 임시 잠금 폴더를 쓰지 않음', check: 'g8', edits: [{ file: F.g8check, find: 'process.env.SORAN_MAGAZINE_QUEUE_LOCK_DIR = TEST_LOCK_DIR\n', replace: '' }] },
  { name: '격리 잠금 모듈의 시험 모드 운영 위치 거부 제거', check: 'g8', edits: [{ file: F.qlock, find: "  if (ops.includes(dir)) throw blocked(`시험 모드에서 운영 queue-locks 에 닿으려 했다 — 잠금 0: ${dir}`)\n", replace: '' }] },
  { name: '격리 m3a 검사가 임시 잠금 폴더를 쓰지 않음', check: 'm3a', edits: [{ file: F.m3acheck, find: 'setQueueLockDirForTest(M3A_LOCK_DIR)\n', replace: '' }] },
  // ── 재검토 P1 — 운영 큐 잠금 위치는 고정 하나 ──
  { name: 'P1 운영 모드 임시 폴더 주입 허용 (8a85f18 판 — writer 마다 다른 잠금)', edits: [{ file: F.qlock,
    find: "    if (injected) throw blocked('SORAN_MAGAZINE_QUEUE_LOCK_DIR 는 SORAN_MAGAZINE_TEST_MODE=1 에서만 쓴다 — 운영 writer 는 고정 잠금 위치 하나만 쓴다')",
    replace: '    if (injected) return resolve(String(injected))' }] },
  // ── 재검토 P1 — gray 대조는 migration 한 사건만 ──
  { name: 'P1 gray — 지금 요청 지문 대조 제거 (임의 지문 승인 · 8a85f18 판)', edits: [{ file: F.reconcile, find: "  if (messageFingerprint !== mig.messageFingerprint) return no(", replace: "  if (false) return no(" }] },
  { name: 'P1 gray — brief SHA-256 대조 제거', edits: [{ file: F.reconcile, find: "  if (briefSha256 !== mig.briefSha256) return no(", replace: "  if (false) return no(" }] },
  { name: 'P1 gray — 장부 사건 키 대조 제거 (다른 과거 CONTENT 행 승인)', edits: [{ file: F.reconcile, find: "  if (legacyLedgerKey !== mig.legacyLedgerKey) return no(", replace: "  if (false) return no(" }] },
  { name: 'P1 gray — slug 무관하게 migration 적용', edits: [{ file: F.reconcile, find: '  const mig = migrations.find((x) => x.slug === slug)\n', replace: '  const mig = migrations[0]\n' },
    { file: F.reconcile, find: "  if (!migrations.some((x) => x.slug === slug)) return { ok: true, status: 'NOT_RECONCILED'", replace: "  if (false) return { ok: true, status: 'NOT_RECONCILED'" }] },
  // ── 2026-10-12 cold — 1회성 복구 (J) ──
  { name: 'J 원고 4파일 신원 대조 제거 (개방 전 확인 · 판정 둘 다)', edits: [
    { file: F.reconcile, find: "    if (fileMiss) { out.push(", replace: "    if (false) { out.push(" },
    { file: F.reconcile, find: "    if (shas?.[k] !== id[k]) return no(", replace: "    if (false) return no(" }] },
  { name: 'J attempts·regenCalls 대조 제거', edits: [
    { file: F.reconcile, find: "  if (entry.attempts !== id.attempts) return no(", replace: "  if (false) return no(" },
    { file: F.reconcile, find: "  if (entry.regenCalls !== id.regenCalls) return no(", replace: "  if (false) return no(" }] },
  { name: 'J 계보 id 대조 제거', edits: [{ file: F.reconcile, find: "  if (entry.regenLineage?.id !== id.lineageId) return no(", replace: "  if (false) return no(" }] },
  { name: 'J 장부 잠금 안 재판정 제거 (동시 개방)', edits: [{ file: F.reconcile, find: "      if (!again.ok) { raced = again.why; return store }\n      const prev = store[rec.slug]", replace: "      const prev = store[rec.slug]" }] },
  { name: 'J 복구 계보 키 확인 제거 (손으로 만든 계보가 예산을 연다)', edits: [{ file: F.quarantine, find: "  return rec && l.evidenceKey === recoveryKeyOf(rec) ? rec : null", replace: "  return rec ?? null" }] },
  { name: 'J 복구 1회 상한 무시 (계보·전체 상한 모두 일반 계보처럼 2회)', edits: [
    { file: F.quarantine, find: "  const capCalls = rec ? rec.extraCalls : maxCalls", replace: "  const capCalls = maxCalls" },
    { file: F.quarantine, find: "  const capTotal = rec ? maxTotal + rec.extraCalls : maxTotal", replace: "  const capTotal = rec ? maxTotal + maxCalls : maxTotal" }] },
  { name: 'J slug 한정 제거 (다른 글에도 복구 계보가 통한다)', edits: [{ file: F.quarantine, find: "  const rec = recoveries.find((r) => r.id === l.recoveryId && r.slug === slug)", replace: "  const rec = recoveries.find((r) => r.id === l.recoveryId)" }] },
  // ── 2026-10-12 cold — QA 재생성 패킷 ──
  { name: 'I 꼬리 3줄에 빠진 FAIL 줄을 싣지 않음 (앞판 — description 누락)', edits: [{ file: F.register,
    find: "    ...fails.filter((x) => !isBody(x) && !tail.includes(x)).map((x) => ({ code: 'QA_FAIL_ITEM', label: x })),\n", replace: '' }] },
  { name: 'I 꼬리에 이미 있는 FAIL 줄도 다시 실음 (기존 재생성 HOLD 패킷·지문 변경)', edits: [{ file: F.register,
    find: '    ...fails.filter((x) => !isBody(x) && !tail.includes(x))', replace: '    ...fails.filter((x) => !isBody(x))' }] },
  { name: 'I 발행 길이 줄의 목표치·계산법 제거', edits: [{ file: F.register, find: '  if (!m) return line\n', replace: '  if (!m || true) return line\n' }] },
  { name: 'P1 gray — 한 번 기록 뒤에도 다시 기록 (재실행 쓰기)', edits: [{ file: F.reconcile, find: "  if (entry.firstResponseInvalid) return no('이미 최초 응답 기록이 있다 (migration 은 한 번만)')\n", replace: '' }] },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })
const occurrences = (s, sub) => s.split(sub).length - 1
const lineOf = (out, re = CHECKS.recovery.line) => (out.match(re) ?? ['출력 없음']).pop()
/** 🔴 임시 HOME 으로 띄우는 검사 — 변이가 격리를 지워도 잠금은 임시 HOME 아래로만 간다 (운영 queue-locks 접근 0) */
const runCheck = (key) => {
  const c = CHECKS[key]
  if (!c.tmpHome) return spawnSync(process.execPath, [c.file], { encoding: 'utf8', cwd: ROOT, maxBuffer: 1e8 })
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-recovery-mut-home-'))
  try { return spawnSync(process.execPath, [c.file], { encoding: 'utf8', cwd: ROOT, maxBuffer: 1e8, env: { ...process.env, HOME: home } }) } finally { fs.rmSync(home, { recursive: true, force: true }) }
}

let bad = 0
let caught = 0
console.log('\n자동 회복 계약 변이 시험\n')
for (const key of [...new Set(['recovery', ...MUTATIONS.map((m) => m.check ?? 'recovery')])]) {
  const base = runCheck(key)
  if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 코드에서 ${key} 검사가 FAIL 이다 (${lineOf(base.stdout, CHECKS[key].line)})`) } else console.log(`  기준선 (변이 없음 · ${key}) — PASS · ${lineOf(base.stdout, CHECKS[key].line)}`)
}
try {
  for (const mu of MUTATIONS) {
    const invalid = mu.edits.find((e) => occurrences(originals[e.file].toString('utf8'), e.find) !== 1)
    if (invalid) { bad++; console.log(`  ❌ ${mu.name} — ${path.basename(invalid.file)} 에 바꿀 문장이 ${occurrences(originals[invalid.file].toString('utf8'), invalid.find)}번 있다 (변이 무효)`); continue }
    const mutated = {}
    for (const e of mu.edits) mutated[e.file] = (mutated[e.file] ?? originals[e.file].toString('utf8')).replace(e.find, e.replace)
    let r
    try {
      for (const [f, text] of Object.entries(mutated)) fs.writeFileSync(f, text)
      r = runCheck(mu.check ?? 'recovery')
    } finally { restoreAll() }
    if (files.some((f) => sha(f) !== startHashes[f])) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    const failed = (r.stdout.match(CHECKS[mu.check ?? 'recovery'].fail) ?? [])
    const crashed = /예외로 중단/.test(r.stdout)
    if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어)`) }
    else if (crashed && failed.length <= 1) { bad++; console.log(`  ❌ ${mu.name} — 단언이 아니라 예외로만 멈췄다 (${lineOf(r.stdout)})`) }
    else { caught++; console.log(`  ✅ ${mu.name} — FAIL (${lineOf(r.stdout, CHECKS[mu.check ?? 'recovery'].line)} · 실패 단언 ${failed.length - (crashed ? 1 : 0)}${crashed ? ' · 예외 포함' : ''} · 예: ${(failed.find((x) => !/예외로 중단/.test(x)) ?? failed[0] ?? '').replace(/^\s*(❌|FAIL)\s*/, '').slice(0, 110)})`) }
  }
} finally { restoreAll() }
const drift = files.filter((f) => sha(f) !== startHashes[f])
if (drift.length) { bad++; console.log(`  ❌ 끝난 뒤 원본과 다른 파일: ${drift.map((f) => path.basename(f)).join(', ')}`) } else console.log('\n  원복 확인 — 변이 대상 파일 전부 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
