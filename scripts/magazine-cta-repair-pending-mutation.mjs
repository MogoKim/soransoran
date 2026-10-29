#!/usr/bin/env node
/**
 * CTA 수리 진행 중 slug HOLD 변이 — 경로별 가드를 하나씩 끊으면 `magazine-cta-repair-pending-check.mjs` 가 **단언으로** 실패해야 한다.
 *
 * 🔴 변이는 임시 루트 사본에만 넣는다 — 그 루트에서 검사를 자식 프로세스로 돌린다(소비자 모듈이 변이된 사본이다).
 * 🔴 지점은 정확히 1곳 · 변이 사본은 문법 검사를 지나야 한다 · 실행 실패는 "잡혔다" 가 아니다 · stdout · stderr 를 모두 읽는다.
 * 🔴 자식은 **실경로**로 띄운다 — tmpdir 은 /var → /private/var 심볼릭 링크라 그대로 띄우면 검사의 isMain 이 거짓이 되어
 *    반례가 하나도 돌지 않고 exit 0 으로 끝난다. 결과 요약 줄이 없으면 「실행 안 됨」으로 센다.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, makeRoot } from './magazine-direct-topic-forbidden-check.mjs'

const LIB = 'scripts/lib/magazine-draft-cta-repair.mjs'
const MUTATIONS = [
  ['MG1', 'producer plan 가드 제거', 'scripts/magazine-producer-plan.mjs', '      if (cta.pending) {\n        held.push(', '      if (false) {\n        held.push('],
  ['MG2', 'fetchBatch 계획표 가드 제거', 'scripts/magazine-webui-runner.mjs', '    if (c.pending) ctaHeld.set(t.slug, c)', '    if (false) ctaHeld.set(t.slug, c)'],
  ['MG3', 'fetchSlug 가드 제거 (수동 단건 · 재생성 우회)', 'scripts/magazine-webui-runner.mjs', '  const cta = ctaRepairPendingState({ draftsDir: opts.draftsDir ?? DRAFTS_DIR, slug })\n  if (cta.pending)', '  const cta = ctaRepairPendingState({ draftsDir: opts.draftsDir ?? DRAFTS_DIR, slug })\n  if (false)'],
  ['MG4', 'recoverSlug 가드 제거', 'scripts/magazine-webui-runner.mjs', '  const cta = ctaRepairPendingState({ draftsDir, slug })\n  if (cta.pending) return ctaRepairHeld', '  const cta = ctaRepairPendingState({ draftsDir, slug })\n  if (false) return ctaRepairHeld'],
  ['MG5', 'auto-register drive 가드 제거', 'scripts/magazine-auto-register.mjs', '  if (ctaPending.pending) {', '  if (false) {'],
  ['MG6', 'drive 가 HOLD 로 표시하지 않는다 (시도 · 장부 기록)', 'scripts/magazine-auto-register.mjs', '    held = true\n    return stop(\'gate\', ctaPending.code', '    return stop(\'gate\', ctaPending.code'],
  ['MG7', '판정이 조각을 보지 않는다', LIB, '  const fragments = pendingFragments(F)\n  if (!fragments.length) return { pending: false }', '  const fragments = []\n  if (!fragments.length) return { pending: false }'],
  ['MG8', '판정이 journal 만 본다 (owned · new 조각만 남은 상태를 놓친다)', LIB, "  if (!existsSync(F.journal)) return hold('journal 없이 CTA 수리 조각이 있다')", "  if (!existsSync(F.journal)) return { pending: false }"],
  ['MG9', '외부 writer canonical 을 RECOVERY_REQUIRED 로 가르지 않는다', LIB, '  if (canon !== null && canon !== j.oldDraftHash && canon !== j.newDraftHash) return hold(', '  if (false) return hold('],
  ['MG10', '운영 알림이 CTA HOLD 를 싣지 않는다', 'scripts/magazine-producer-notify.mjs', "  'CTA_REPAIR_PENDING', 'CTA_REPAIR_RECOVERY_REQUIRED'])", '  ])'],
  ['MG11', 'plan held 에 조각 목록을 싣지 않는다', 'scripts/magazine-producer-plan.mjs', 'why: cta.why, ctaRepair: { fragments: cta.fragments } })', 'why: cta.why })'],
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
  const r = spawnSync(process.execPath, [join(mut, 'scripts/magazine-cta-repair-pending-check.mjs')], { encoding: 'utf8', timeout: 600000, cwd: mut })
  const lines = `${r.stdout}\n${r.stderr}`.split('\n')
  const failed = lines.filter((l) => l.startsWith('FAIL '))
  const real = failed.filter((l) => !LOAD_FAILURE.test(l))
  const summary = lines.find((l) => /HOLD 검사: \d+ pass, \d+ fail/.test(l))
  if (!summary) { fail += 1; console.log(`FAIL ${id} ${label} — 검사가 돌지 않았다(결과 요약 없음) — 하네스 결함`); continue }
  if (real.length) { pass += 1; console.log(`PASS ${id} ${label} → 잡혔다 — ${real[0].slice(5, 170)}`) }
  else if (failed.length || r.status !== 0) { fail += 1; console.log(`FAIL ${id} ${label} — 실행 실패만 났다 — ${(failed[0] ?? r.stderr).slice(0, 200)}`) }
  else { fail += 1; console.log(`FAIL ${id} ${label} → 모든 반례가 통과했다`) }
}
for (const [f, t] of originals) if (readFileSync(join(ROOT, f), 'utf8') !== t) { fail += 1; console.log(`FAIL 원본 ${f} 가 바뀌었다`) }
console.log(`\nCTA 수리 진행 중 slug HOLD 변이: ${pass} pass, ${fail} fail`)
if (fail) process.exitCode = 1
