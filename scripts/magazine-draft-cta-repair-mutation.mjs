#!/usr/bin/env node
/**
 * 원고 CTA 무전송 수리 변이 — 관문을 하나씩 끊으면 `ctaRepairCases` 중 하나가 **단언으로** 실패해야 한다.
 *
 * 🔴 변이는 임시 루트 사본에만 넣는다 — 작업 트리 원본 바이트 0 변경(마지막에 확인).
 * 🔴 지점은 정확히 1곳 · 변이 사본은 문법 검사를 지나야 한다 · 실행 실패는 "잡혔다" 가 아니다.
 * MR = 수리 계약 · no-clobber transaction · 급사 복구 / MP = 영수증 자체 검증(P2).
 * (안전 개정 prepare 의 영수증 대조 변이는 authoring 변이 MAS18 이 맡는다)
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, makeRoot, runCases } from './magazine-direct-topic-forbidden-check.mjs'
import { ctaRepairCases } from './magazine-draft-cta-repair-check.mjs'

const LIB = 'scripts/lib/magazine-draft-cta-repair.mjs'
const MUTATIONS = [
  ['MR1', '원고 해시 대조 제거', "  if (oldDraftHash !== expectDraftHash) return { ...fail('DRAFT_HASH_MISMATCH'", "  if (false) return { ...fail('DRAFT_HASH_MISMATCH'"],
  ['MR2', '옛 문장 대조 제거', "  if (oldText !== expectOldText) return fail('OLD_TEXT_MISMATCH'", "  if (false) return fail('OLD_TEXT_MISMATCH'"],
  ['MR3', '[CTA] 줄 개수 검사 제거', "  if (ctaIdx.length !== 1) return fail('CTA_COUNT'", "  if (ctaIdx.length === 0) return fail('CTA_COUNT'"],
  ['MR4', '등록 영수증 검사 제거', "  if (existsSync(join(dir, ARTICLE_SPEC_REGISTER_LEDGER))) return fail('REGISTERED'", "  if (false) return fail('REGISTERED'"],
  ['MR5', '미정산 전송 예약 검사 제거', "  if (d?.reservationId || d?.kind === 'DELIVERY_UNCERTAIN' || entry?.sent === null) return fail('DELIVERY_UNSETTLED'", "  if (false) return fail('DELIVERY_UNSETTLED'"],
  ['MR6', 'article-draft.ts 검사 제거', "  if (existsSync(join(dir, 'article-draft.ts'))) return fail('ARTICLE_DRAFT_EXISTS'", "  if (false) return fail('ARTICLE_DRAFT_EXISTS'"],
  ['MR7', '떼어 내기 직전 lease 재확인 제거', "  if (!leaseHeld(lease)) return fail('LOCK_LOST', '떼어 내기 직전", "  if (false) return fail('LOCK_LOST', '떼어 내기 직전"],
  ['MR8', '떼어 낸 owned 의 옛 해시 재확인 제거 (경쟁 writer 를 owned 에 가둔 채 설치)', '  if (hashOr(readOr(F.owned)) !== q.oldDraftHash) {', '  if (false) {'],
  ['MR9', '새 원고 설치를 덮어쓰기 rename 으로 (canonical 을 차지한 경쟁 writer 를 덮는다)', "  try { step('install:link'); linkSync(F.next, F.draft) }", "  try { step('install:link'); renameSync(F.next, F.draft) }"],
  ['MR10', '영수증 설치를 덮어쓰기 rename 으로 (남의 영수증을 덮는다)', '      linkSync(F.receipt, receiptAbs)', '      renameSync(F.receipt, receiptAbs)'],
  ['MR11', '다른 영수증을 멱등으로 받아 준다', "  if (!same) return { ok: false, code: 'RECEIPT_CONFLICT'", "  if (false) return { ok: false, code: 'RECEIPT_CONFLICT'"],
  ['MR12', 'DIRECT 아닌 글도 고친다', "  if (!mode.ok || mode.mode !== DIRECT_SPEC_MODE) return fail('NOT_DIRECT'", "  if (!mode.ok) return fail('NOT_DIRECT'"],
  ['MR13', '셋째 칸 대신 label 칸까지 바꾼다', '  nextLines[ctaIdx[0]] = `${head}${href}${sep1}${label}${sep2}${text}${tail}`', '  nextLines[ctaIdx[0]] = `${head}${href}${sep1}${text}${sep2}${text}${tail}`'],
  ['MR14', '새 문장의 | · 줄바꿈 검사 제거 (href · label 주입)', "  if (typeof text !== 'string' || text !== text.trim() || !text || /[|\\r\\n]/.test(text) || [...text].length > CTA_TEXT_MAX) {", "  if (typeof text !== 'string' || !text) {"],
  ['MR15', '미리보기가 쓴다 (기본 쓰기)', '  const { write = false, hooks = {}, quarantinePath, slug, draftsDir, nowMs = Date.now() } = args', '  const { write = true, hooks = {}, quarantinePath, slug, draftsDir, nowMs = Date.now() } = args'],
  ['MR16', 'journal 을 쓰지 않고 원고를 바꾼다', "  try { writeFragment(F.journal, journalBytes(journal), 'journal', step) } catch", '  try { /* journal 없음 */ } catch'],
  ['MR17', '남은 transaction 을 먼저 복구하지 않는다', '    if (existsSync(F.journal)) {', '    if (false) {'],
  ['MR18', 'canonical 외부 바이트에서도 영수증 · 정리로 진행', "  if (canon !== j.newDraftHash) return hold('canonical 원고가 journal 의", "  if (false) return hold('canonical 원고가 journal 의"],
  ['MR19', '복구가 owned 조각 해시를 대조하지 않는다', '  if (hashOr(readOr(F.owned)) !== null && hashOr(readOr(F.owned)) !== j.oldDraftHash) return hold(', '  if (false) return hold('],
  ['MR20', '옛 원고 복구를 덮어쓰기 rename 으로', "    try { step('restore:link'); linkSync(F.owned, F.draft) }", "    try { step('restore:link'); renameSync(F.owned, F.draft) }"],
  ['MR21', '쓴 영수증을 다시 읽어 검증하지 않는다', "  if (!v.ok || readOr(receiptAbs)?.toString('utf8') !== expected) return hold(", '  if (false) return hold('],
  ['MR22', '정리 직전 canonical 확인 제거', "  if (hashOr(readOr(F.draft)) !== j.newDraftHash) return hold('정리 직전", "  if (false) return hold('정리 직전"],
  ['MR23', '옛 원고인데 영수증 자리에 기록이 있어도 정리', "    if (existsSync(receiptAbs)) return hold('원고는 옛 바이트인데", "    if (false) return hold('원고는 옛 바이트인데"],
  ['MR24', 'journal 의 영수증 자리 신원 검증 제거', '  if (j.receiptPath !== relative(', '  if (false && j.receiptPath !== relative('],
  ['MR25', 'journal 필드 집합 검증 제거', "  if (Object.keys(j).sort().join(',') !== JOURNAL_KEYS.join(',') || j.schema !== CTA_REPAIR_JOURNAL_SCHEMA)", '  if (j.schema !== CTA_REPAIR_JOURNAL_SCHEMA)'],
  ['MR26', '미리보기가 남은 transaction 을 알리지 않는다', "    if (pending.length) return fail('CTA_REPAIR_PENDING'", "    if (false) return fail('CTA_REPAIR_PENDING'"],
  ['MR27', 'journal 없는 조각을 받아 준다', '      if (stray.length) return fail(', '      if (false) return fail('],
  ['MR28', '설치 직전 lease 재확인 제거', "  if (!leaseHeld(lease)) {\n    // lease 없이는 지우지 않는다", "  if (false) {\n    // lease 없이는 지우지 않는다"],
  ['MR29', '설치 실패 시 옛 원고를 되돌리지 않는다', "    return back('INSTALL_FAILED'", "    return fail('INSTALL_FAILED'"],
  ['MR30', '기계 승인자로 수리를 시작한다', "  if (!isHumanApprover(approver)) return fail('APPROVER_MACHINE'", "  if (false) return fail('APPROVER_MACHINE'"],
  ['MP1', '영수증 필드 집합 검사 제거 (P2)', "  if (keys.join(',') !== RECEIPT_KEYS.join(',')) return", '  if (false) return'],
  ['MP2', '영수증 판 검사 제거 (P2)', '  if (r.schema !== CTA_REPAIR_RECEIPT_SCHEMA) return', '  if (false) return'],
  ['MP3', '영수증 해시 형식 검사 제거 (P2)', "  if (!SHA256_RE.test(String(r.oldDraftHash)) || !SHA256_RE.test(String(r.newDraftHash)) || r.oldDraftHash === r.newDraftHash) return", '  if (false) return'],
  ['MP4', '영수증 옛 문장 검사 제거 (P2)', "  if (typeof r.oldText !== 'string' || !r.oldText || /[|\\r\\n]/.test(r.oldText)) return", '  if (false) return'],
  ['MP5', '영수증 새 문장 규칙 제거 (P2)', '  if (tp) return `새 문장:', '  if (false) return `새 문장:'],
  ['MP6', '영수증 CTA 행 검사 제거 (P2)', '  if (!Number.isInteger(r.ctaLine) || r.ctaLine < 1) return', '  if (false) return'],
  ['MP7', '영수증 href 검사 제거 (P2)', "  if (typeof r.href !== 'string' || !/^\\/[^\\s|]*$/.test(r.href)) return", '  if (false) return'],
  ['MP8', '영수증 label 검사 제거 (P2)', "  if (typeof r.label !== 'string' || !r.label || r.label !== r.label.trim() || /[|\\r\\n]/.test(r.label)) return", '  if (false) return'],
  ['MP9', '영수증 사람 승인자 검사 제거 (P2)', '  if (!isHumanApprover(r.approver) || r.approver !== r.approver.trim()) return', '  if (false) return'],
  ['MP10', '영수증 KST 검사 제거 (P2)', '  if (!isPastKst(r.at, nowMs)) return', '  if (false) return'],
  ['MP11', '영수증 자리(이름 · 날짜 폴더) 검사 제거 (P2)', '  if (basename(receiptPath) !== basename(place) ||', '  if (false && basename(receiptPath) !== basename(place) ||'],
  ['MP12', '영수증 새 해시 = 지금 원고 대조 제거', '  if (r.newDraftHash !== draftHash) return fail(', '  if (false) return fail('],
]

const LOAD_FAILURE = /SyntaxError|Cannot find module|is not defined/
const original = readFileSync(join(ROOT, LIB), 'utf8')
let pass = 0
let fail = 0
for (const [id, label, from, to] of MUTATIONS) {
  const mut = makeRoot()
  const p = join(mut, LIB)
  const text = readFileSync(p, 'utf8')
  const count = text.split(from).length - 1
  if (count !== 1) { fail += 1; console.log(`FAIL ${id} ${label} — 변이 지점이 정확히 1곳이 아니다 (${count}곳) — 하네스 결함`); continue }
  writeFileSync(p, text.replace(from, to))
  if (spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' }).status !== 0) { fail += 1; console.log(`FAIL ${id} ${label} — 변이 사본이 문법 오류다 — 하네스 결함`); continue }
  const out = []
  const log = console.log
  console.log = (...a) => out.push(a.join(' '))
  let r
  try { r = await runCases(ctaRepairCases({ root: () => makeRoot(mut) })) } finally { console.log = log }
  const failed = out.filter((l) => l.startsWith('FAIL '))
  const real = failed.filter((l) => !LOAD_FAILURE.test(l))
  if (real.length) { pass += 1; console.log(`PASS ${id} ${label} → 잡혔다 — ${real[0].slice(5, 150)}`) }
  else if (failed.length) { fail += 1; console.log(`FAIL ${id} ${label} — 실행 실패만 났다 — ${failed[0].slice(5, 200)}`) }
  else { fail += 1; console.log(`FAIL ${id} ${label} → 모든 반례가 통과했다 (${r.pass} pass)`) }
}
if (readFileSync(join(ROOT, LIB), 'utf8') !== original) { fail += 1; console.log(`FAIL 원본 ${LIB} 가 바뀌었다`) }
console.log(`\n원고 CTA 무전송 수리 변이: ${pass} pass, ${fail} fail`)
if (fail) process.exitCode = 1
