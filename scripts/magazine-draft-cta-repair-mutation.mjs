#!/usr/bin/env node
/**
 * 원고 CTA 무전송 수리 변이 — 관문을 하나씩 끊으면 `ctaRepairCases` 중 하나가 **단언으로** 실패해야 한다.
 *
 * 🔴 변이는 임시 루트 사본에만 넣는다 — 작업 트리 원본 바이트 0 변경(마지막에 확인).
 * 🔴 지점은 정확히 1곳 · 변이 사본은 문법 검사를 지나야 한다 · 실행 실패는 "잡혔다" 가 아니다.
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
  ['MR7', '교체 직전 lease 재확인 제거', '    if (!leaseHeld(lease)) { try { unlinkSync(tmp)', '    if (false) { try { unlinkSync(tmp)'],
  ['MR8', '교체 직전 원고 CAS 제거 (경쟁 writer 를 덮는다)', "    if (current !== q.oldBytes) { try { unlinkSync(tmp)", "    if (false) { try { unlinkSync(tmp)"],
  ['MR9', '교체 뒤 확인 제거 (경쟁 writer 위에 영수증)', "    if (observed !== q.newBytes) return fail('CONCURRENT_WRITER'", "    if (false) return fail('CONCURRENT_WRITER'"],
  ['MR10', '영수증을 no-clobber 없이 덮어쓴다', "      const fd = openSync(q.receiptPath, 'wx')", "      const fd = openSync(q.receiptPath, 'w')"],
  ['MR11', '다른 영수증을 멱등으로 받아 준다', "  if (!same) return { ok: false, code: 'RECEIPT_CONFLICT'", "  if (false) return { ok: false, code: 'RECEIPT_CONFLICT'"],
  ['MR12', 'DIRECT 아닌 글도 고친다', "  if (!mode.ok || mode.mode !== DIRECT_SPEC_MODE) return fail('NOT_DIRECT'", "  if (!mode.ok) return fail('NOT_DIRECT'"],
  ['MR13', '셋째 칸 대신 label 칸까지 바꾼다', '  nextLines[ctaIdx[0]] = `${head}${href}${sep1}${label}${sep2}${text}${tail}`', '  nextLines[ctaIdx[0]] = `${head}${href}${sep1}${text}${sep2}${text}${tail}`'],
  ['MR14', '새 문장의 | · 줄바꿈 검사 제거 (href · label 주입)', "  if (typeof text !== 'string' || text !== text.trim() || !text || /[|\\r\\n]/.test(text) || [...text].length > CTA_TEXT_MAX) {", "  if (typeof text !== 'string' || !text) {"],
  ['MR15', '미리보기가 쓴다 (기본 쓰기)', "  const { write = false, hooks = {}, quarantinePath, slug } = args", "  const { write = true, hooks = {}, quarantinePath, slug } = args"],
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
