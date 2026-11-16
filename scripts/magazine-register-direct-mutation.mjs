#!/usr/bin/env node
/**
 * register DIRECT · legacy 재료 판정 변이 — 판정을 하나씩 끊으면 `magazine-register-direct-check.mjs` 의
 * **겨냥한 반례**가 단언으로 실패해야 한다.
 *
 * 🔴 변이는 임시 루트 사본에만 넣는다 — 그 루트에서 검사를 자식 프로세스로 돌린다(원본 0).
 * 🔴 지점은 정확히 1곳 · 변이 사본은 문법 검사를 지나야 한다 · 모듈 로드 실패는 "잡혔다" 가 아니다.
 * 🔴 겨냥한 반례 id 가 FAIL 줄에 있어야 잡힌 것이다 — 다른 반례가 우연히 깨진 것은 세지 않는다.
 * 🔴 자식은 **실경로**로 띄운다(/var → /private/var) — 결과 요약 줄이 없으면 「실행 안 됨」으로 센다.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, makeRoot } from './magazine-direct-topic-forbidden-check.mjs'

const REG = 'scripts/magazine-register.mjs'
const CHECK = 'scripts/magazine-register-direct-check.mjs'
const MUTATIONS = [
  ['MR1', 'DIRECT 분기 제거 (DIRECT 도 review.ts 를 요구)', REG, '  } else if (mode.mode === DIRECT_SPEC_MODE) {', '  } else if (false) {', ['D01', 'D02', 'D14']],
  ['MR2', 'legacy review.ts 요구 제거', REG, "  } else if (!existsSync(join(dir, 'review.ts'))) {", '  } else if (false) {', ['D03']],
  ['MR3', 'verifyDirectSpecOnDisk 우회', REG, '    const v = verifyDirectSpecOnDisk({', "    const v = { ok: true, spec: { specHash: 'bypass' } } ?? verifyDirectSpecOnDisk({", ['D04', 'D05', 'D06', 'D07']],
  ['MR4', 'mode 오류를 legacy 로 강등', REG, '  const mode = item ? resolveMagazineAutoMode(item) :',
    '  const mode = item ? { ok: true, mode: resolveMagazineAutoMode(item).mode ?? LEGACY_BRIEF_MODE } :', ['D08', 'D09']],
  ['MR5', '검사가 실제 register 대신 READY 대역을 쓴다 (CLI)', CHECK, "  const r = spawnSync(process.execPath, ['scripts/magazine-register.mjs'",
    "  const r = { status: 0, stdout: JSON.stringify({ verdict: 'READY', reasons: [], notes: [] }) } ?? spawnSync(process.execPath, ['scripts/magazine-register.mjs'", ['D02']],
  ['MR6', 'drive 시험이 실제 register 대신 READY 대역을 쓴다', CHECK, "registerCalls.push(file); return real(file, args, opts) }",
    "registerCalls.push(file); return { code: 0, stdout: '', stderr: '', json: { verdict: 'READY' } } }", ['D14']],
]
const LOAD_FAILURE = /SyntaxError|Cannot find module|is not defined|ERR_MODULE_NOT_FOUND/

const originals = new Map([...new Set(MUTATIONS.map((m) => m[2]))].map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]))
let pass = 0
let fail = 0
for (const [id, label, file, from, to, targets] of MUTATIONS) {
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
  const hit = real.filter((l) => targets.some((t) => l.startsWith(`FAIL ${t} `)))
  const summary = lines.find((l) => /재료 판정: \d+ pass, \d+ fail/.test(l))
  if (!summary) { fail += 1; console.log(`FAIL ${id} ${label} — 검사가 돌지 않았다(결과 요약 없음) — 하네스 결함 ${(r.stderr || '').slice(0, 200)}`); continue }
  if (hit.length) { pass += 1; console.log(`PASS ${id} ${label} → 잡혔다 — ${hit.map((l) => l.slice(5, 8)).join(' · ')} — ${hit[0].slice(5, 160)}`) }
  else if (failed.length) { fail += 1; console.log(`FAIL ${id} ${label} — 겨냥한 반례(${targets.join(' · ')})가 아닌 실패만 났다 — ${failed[0].slice(0, 200)}`) }
  else { fail += 1; console.log(`FAIL ${id} ${label} → 모든 반례가 통과했다`) }
}
for (const [f, t] of originals) if (readFileSync(join(ROOT, f), 'utf8') !== t) { fail += 1; console.log(`FAIL 원본 ${f} 가 바뀌었다`) }
console.log(`\nregister DIRECT · legacy 재료 판정 변이: ${pass} pass, ${fail} fail`)
if (fail) process.exitCode = 1
