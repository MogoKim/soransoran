#!/usr/bin/env node
/**
 * CTA 수리 ↔ auto-register 전역 잠금 변이 — 잠금을 빼거나 순서를 뒤집으면 `magazine-cta-repair-lock-check.mjs` 가 **단언으로** 실패해야 한다.
 *
 * 🔴 변이는 임시 루트 사본에만 넣고, 그 루트에서 검사를 자식 프로세스로 **실경로**로 띄운다(결과 요약 줄이 없으면 「실행 안 됨」).
 * 🔴 지점은 정확히 1곳 · 변이 사본은 문법 검사를 지나야 한다 · 실행 실패는 "잡혔다" 가 아니다 · stdout · stderr 를 모두 읽는다.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, makeRoot } from './magazine-direct-topic-forbidden-check.mjs'

const LIB = 'scripts/lib/magazine-draft-cta-repair.mjs'
const CHECK = 'scripts/magazine-cta-repair-lock-check.mjs'
const SUMMARY = /전역 잠금 검사: \d+ pass, \d+ fail/
/** 잠금 순서를 뒤집은 판 — 원고 lease 를 먼저 잡고 전역 잠금을 나중에 잡는다 */
const FORWARD = "  const globalLock = acquireLock({ path: ctaRepairGlobalLockPath(draftsDir), label: 'draft-cta-repair' })\n  if (!globalLock.ok) return fail(globalLock.code, `auto-register 전역 잠금을 잡지 못했다 — ${globalLock.message} (원고 lease · 조각 · 쓰기 0)`)\n  try {\n    return underGlobalLock({ args, F, slug, draftsDir, quarantinePath, step, nowMs })\n  } finally {\n    globalLock.release()\n  }\n}\n\n/** 전역 잠금 안 — 원고 lease 를 잡고 남은 transaction · 새 수리를 한다 */\nfunction underGlobalLock({ args, F, slug, draftsDir, quarantinePath, step, nowMs }) {\n  const fail = (code, why) => ({ ok: false, code, why })\n  const lease = acquireManuscriptLease({ slug, work: 'cta-repair', path: quarantinePath })\n  if (!lease.ok) return fail(lease.code, lease.why)\n"
const REVERSED = "  const lease = acquireManuscriptLease({ slug, work: 'cta-repair', path: quarantinePath })\n  if (!lease.ok) return fail(lease.code, lease.why)\n  const globalLock = acquireLock({ path: ctaRepairGlobalLockPath(draftsDir), label: 'draft-cta-repair' })\n  if (!globalLock.ok) { lease.release(); return fail(globalLock.code, globalLock.message) }\n  try {\n    return underGlobalLock({ args, F, slug, draftsDir, quarantinePath, step, nowMs, lease })\n  } finally {\n    globalLock.release()\n  }\n}\n\nfunction underGlobalLock({ args, F, slug, draftsDir, quarantinePath, step, nowMs, lease }) {\n  const fail = (code, why) => ({ ok: false, code, why })\n"
const MUTATIONS = [
  ['ML1', '전역 잠금 제거', LIB, "  const globalLock = acquireLock({ path: ctaRepairGlobalLockPath(draftsDir), label: 'draft-cta-repair' })", '  const globalLock = { ok: true, release: () => {} }'],
  ['ML2', '잠금 순서 뒤집기 (원고 lease → 전역 잠금)', LIB, FORWARD, REVERSED],
  ['ML3', '전역 잠금 실패를 무시하고 진행', LIB, '  if (!globalLock.ok) return fail(globalLock.code', '  if (false) return fail(globalLock.code'],
  ['ML4', 'auto-register 와 다른 잠금 파일', LIB, "export const ctaRepairGlobalLockPath = (draftsDir) => join(draftsDir, '_runs', '.auto-register.lock')", "export const ctaRepairGlobalLockPath = (draftsDir) => join(draftsDir, '_runs', '.cta-repair.lock')"],
  ['ML5', '전역 잠금을 풀지 않는다', LIB, '    globalLock.release()\n', '    void 0\n'],
]

const LOAD_FAILURE = /SyntaxError|Cannot find module|is not defined|ERR_MODULE_NOT_FOUND/
const originals = new Map([...new Set(MUTATIONS.map((m) => m[2]))].map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]))
let pass = 0
let fail = 0
for (const [id, label, file, from, to] of MUTATIONS) {
  const mut = realpathSync(makeRoot())
  const p = join(mut, file)
  const text = readFileSync(p, 'utf8')
  const count = text.split(from).length - 1
  if (count !== 1) { fail += 1; console.log(`FAIL ${id} ${label} — 변이 지점이 정확히 1곳이 아니다 (${count}곳) — 하네스 결함`); continue }
  writeFileSync(p, text.replace(from, to))
  if (spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' }).status !== 0) { fail += 1; console.log(`FAIL ${id} ${label} — 변이 사본이 문법 오류다 — 하네스 결함`); continue }
  const r = spawnSync(process.execPath, [join(mut, CHECK)], { encoding: 'utf8', timeout: 600000, cwd: mut })
  const lines = `${r.stdout}\n${r.stderr}`.split('\n')
  const failed = lines.filter((l) => l.startsWith('FAIL '))
  const real = failed.filter((l) => !LOAD_FAILURE.test(l))
  const summary = lines.find((l) => SUMMARY.test(l))
  if (!summary) { fail += 1; console.log(`FAIL ${id} ${label} — 검사가 돌지 않았다(결과 요약 없음) — 하네스 결함`); continue }
  if (real.length) { pass += 1; console.log(`PASS ${id} ${label} → 잡혔다 — ${real[0].slice(5, 170)}`) }
  else if (failed.length || r.status !== 0) { fail += 1; console.log(`FAIL ${id} ${label} — 실행 실패만 났다 — ${(failed[0] ?? r.stderr).slice(0, 200)}`) }
  else { fail += 1; console.log(`FAIL ${id} ${label} → 모든 반례가 통과했다`) }
}
for (const [f, t] of originals) if (readFileSync(join(ROOT, f), 'utf8') !== t) { fail += 1; console.log(`FAIL 원본 ${f} 가 바뀌었다`) }
console.log(`\nCTA 수리 ↔ auto-register 전역 잠금 변이: ${pass} pass, ${fail} fail`)
if (fail) process.exitCode = 1
