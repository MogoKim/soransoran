#!/usr/bin/env node
/**
 * 입력 수리 반례의 큐 분리 변이 시험 (2026-10-12 · PR #690 CI 실패).
 *
 *   실제 큐가 바뀌는 세 모양에서 검사를 돌린다 — 저장소를 임시 mini 사본으로 복사하고 **사본의 큐만** 바꾼다.
 *     main   지금 큐 그대로
 *     pr690  gray·autumn 이 정상 등록돼 빠진 큐 (10/12 PR #690 모양)
 *     none   gray·cold·autumn 이 모두 빠진 큐
 *   기준선: 세 모양 모두 PASS.  변이: 분리 장치를 하나씩 지운 사본이 어느 모양에서든 **단언 실패**로 FAIL.
 *
 * 🔴 저장소·runtime 파일을 바꾸지 않는다 — 변이도 mini 사본에만 건다. 운영 HOME·장부·Chrome·네트워크 0
 *    (각 검사가 스스로 임시 HOME·시험 모드로 돈다).
 *
 * 사용: node scripts/magazine-input-repair-fixture-mutation.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)
const L = await import(pathToFileURL(path.join(HERE, 'lib', 'magazine-load.mjs')).href)
const QL = await import(pathToFileURL(path.join(HERE, 'lib', 'magazine-queue-lock.mjs')).href)

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'input-repair-fixture-mut-')))
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }))

const CHECKS = {
  repair: { rel: 'scripts/magazine-input-repair-check.mjs', line: /입력 수리 검사 \d+\/\d+/g },
  recovery: { rel: 'scripts/magazine-auto-recovery-check.mjs', line: /자동 회복 계약 검사 \d+\/\d+/g },
}
const SHAPES = {
  main: [],
  pr690: ['gray-hair-leave-as-is', 'autumn-low-mood'],
  none: ['gray-hair-leave-as-is', 'cold-weather-joint-pain', 'autumn-low-mood'],
}
const MUTATIONS = [
  { name: '반례 큐 행을 다시 실제 큐에서 찾는다 (앞판)', check: 'repair', shapes: ['pr690', 'none'],
    edits: [{ rel: CHECKS.repair.rel, find: 'const QUEUE = RQ.fixtureQueue()', replace: 'const QUEUE = L.loadQueue()' }] },
  { name: 'fixture 에 없는 slug 를 undefined 로 넘긴다 (던지지 않음)', check: 'repair', shapes: ['main'],
    edits: [{ rel: CHECKS.repair.rel, find: "  if (!it) throw new Error(`고정 큐 fixture 에 ${slug} 행이 없다 — 반례를 실제 큐에 기대지 않는다`)\n", replace: '' }] },
  { name: 'mini 사본 큐에 수리 대상 행을 보장하지 않는다 (실제 큐 복사본 그대로)', check: 'repair', shapes: ['pr690', 'none'],
    edits: [{ rel: CHECKS.repair.rel, find: "  fs.writeFileSync(miniQueue, RQ.withFixtureRows(fs.readFileSync(miniQueue, 'utf8'), [GRAY, COLD, AUTUMN]).src)\n", replace: '' }] },
  { name: '⑩ 정상 글을 큐에 없는 행으로 판정 (자동 레인 확인 없이 저절로 참)', check: 'repair', shapes: ['main'],
    edits: [{ rel: CHECKS.repair.rel, find: "    isAuto(item('job-credentials')) && isAuto(item(NORMAL_DRAFT)) && ", replace: "    isAuto({ slug: 'avoiding-gatherings' }) && " }] },
  { name: '자동 회복 F 절의 cold 행을 실제 큐에서 찾는다', check: 'recovery', shapes: ['none'],
    edits: [{ rel: CHECKS.recovery.rel, find: "  const coldItem = (await import('./fixtures/magazine-format-contract/repair-queue-rows.mjs')).fixtureQueue([COLD])[0]",
      replace: '  const coldItem = L.loadQueue().find((q) => q.slug === COLD)' }] },
]

/** 저장소 → mini 사본 (scripts · drafts/magazine(_runs 제외) · src/content/magazine · public/magazine 일부) */
function buildMini(name, shape) {
  const M = path.join(ROOT, name)
  for (const rel of ['scripts', 'drafts/magazine', 'src/content/magazine', 'public/magazine/avoiding-gatherings', '.gitignore', 'package.json']) {
    const from = path.join(REPO, rel)
    if (!fs.existsSync(from)) continue
    fs.mkdirSync(path.dirname(path.join(M, rel)), { recursive: true })
    fs.cpSync(from, path.join(M, rel), { recursive: true, filter: (src) => !src.includes(`${path.sep}_runs${path.sep}`) })
  }
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(M, 'node_modules'))
  const q = path.join(M, 'drafts', 'magazine', 'topic-queue.ts')
  let src = fs.readFileSync(q, 'utf8')
  for (const slug of SHAPES[shape]) {
    const it = L.parseQueueSource(src).find((x) => x.slug === slug)
    if (it) src = QL.removeQueueDay(src, it.day)
  }
  fs.writeFileSync(q, src)
  const left = L.parseQueueSource(src).map((x) => x.slug)
  if (SHAPES[shape].some((s) => left.includes(s))) throw new Error(`${shape} 모양을 만들지 못했다`)
  return M
}
const runIn = (M, key) => spawnSync(process.execPath, [path.join(M, CHECKS[key].rel)], { cwd: M, encoding: 'utf8', maxBuffer: 1e8 })
const lineOf = (out, key) => (out.match(CHECKS[key].line) ?? ['출력 없음']).pop()

let bad = 0
let caught = 0
console.log('\n입력 수리 반례 큐 분리 변이 시험\n')
const base = {}
for (const shape of Object.keys(SHAPES)) {
  base[shape] = buildMini(`base-${shape}`, shape)
  for (const key of Object.keys(CHECKS)) {
    const r = runIn(base[shape], key)
    if (r.status !== 0) { bad++; console.log(`  ❌ 기준선 ${shape} · ${key} — FAIL (${lineOf(r.stdout, key)}) ${(r.stdout.match(/❌[^\n]+/) ?? [''])[0].slice(0, 120)}`) } else console.log(`  기준선 ${shape.padEnd(5)} · ${key.padEnd(8)} — PASS · ${lineOf(r.stdout, key)}`)
  }
}
for (const [i, mu] of MUTATIONS.entries()) {
  const hits = []
  let invalid = null
  for (const shape of mu.shapes) {
    const M = buildMini(`mut-${i}-${shape}`, shape)
    for (const e of mu.edits) {
      const f = path.join(M, e.rel)
      const text = fs.readFileSync(f, 'utf8')
      const n = text.split(e.find).length - 1
      if (n !== 1) { invalid = `${e.rel} 에 바꿀 문장이 ${n}번 있다`; break }
      fs.writeFileSync(f, text.replace(e.find, e.replace))
    }
    if (invalid) break
    const r = runIn(M, mu.check)
    const failed = r.stdout.match(/❌ [^\n]+/g) ?? []
    const crashed = failed.some((x) => /예외로 중단/.test(x))
    hits.push({ shape, status: r.status, line: lineOf(r.stdout, mu.check), asserts: failed.filter((x) => !/예외로 중단/.test(x)).length, crashed, first: (failed.find((x) => !/예외로 중단/.test(x)) ?? failed[0] ?? '').slice(0, 100) })
    fs.rmSync(M, { recursive: true, force: true })
  }
  if (invalid) { bad++; console.log(`  ❌ ${mu.name} — 변이 무효 (${invalid})`); continue }
  const passed = hits.filter((h) => h.status === 0)
  const deadAssert = hits.filter((h) => h.status !== 0 && h.asserts === 0)
  if (passed.length) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS (${passed.map((h) => h.shape).join(',')}) — 죽은 방어`) }
  else if (deadAssert.length) { bad++; console.log(`  ❌ ${mu.name} — 단언이 아니라 예외로만 멈췄다 (${deadAssert.map((h) => h.shape).join(',')})`) }
  else { caught++; console.log(`  ✅ ${mu.name} — FAIL ${hits.map((h) => `[${h.shape}: ${h.line} · 실패 단언 ${h.asserts}${h.crashed ? ' · 예외 포함' : ''}]`).join(' ')} · 예: ${hits[0].first.replace(/^❌\s*/, '')}`) }
}
const realQueue = fs.readFileSync(path.join(REPO, 'drafts', 'magazine', 'topic-queue.ts'), 'utf8')
console.log(`\n  저장소 큐 불변 — ${L.parseQueueSource(realQueue).length}행 (변이·모양은 mini 사본에만)`)
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
