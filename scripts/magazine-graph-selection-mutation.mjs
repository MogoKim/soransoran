#!/usr/bin/env node
/**
 * M-GRAPH 다중 mapping 선택 정책 변이 시험 (2026-10-17) — 정책을 지운 resolver 로 graph 검사를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 *
 *   정책: edge priority → coverage ANSWERS 우선 → publishedAt 최신 → slug 오름차순 (`compareGraphCandidates`).
 *   cold-weather-joint-pain 공개 때 최신순만으로 고르다 명절 글 2편의 발견 카드가 바뀌었다.
 *
 * 바꿀 문장이 파일에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 무효 = FAIL).
 * 🔴 파일을 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다. 중간에 끊겨도 되돌린다.
 * 🔴 무변이 코드에서 검사가 먼저 PASS 여야 한다.
 *
 * 사용: node scripts/magazine-graph-selection-mutation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const GRAPH_LIB = path.join(ROOT, 'src', 'lib', 'magazine-graph.ts')
const CHECK = [path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(HERE, 'magazine-graph-check.mts')]]

const MUTATIONS = [
  { name: 'coverage 우선 비교 제거 (priority → 최신 → slug)',
    find: '    answers(a) - answers(b) ||\n', replace: '' },
  { name: 'ANSWERS_* 도 ANSWERS 로 취급 (비-ANSWERS 끼리 새 순위)',
    find: '(k.coverage === PREFERRED_COVERAGE ? 0 : 1)', replace: "(k.coverage?.startsWith(PREFERRED_COVERAGE) ? 0 : 1)" },
  { name: 'slug 결정 규칙 제거 (입력 순서 의존)',
    find: '    b.publishedAt.localeCompare(a.publishedAt) ||\n    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)\n',
    replace: '    b.publishedAt.localeCompare(a.publishedAt)\n' },
  { name: 'resolver 가 mapping coverage 를 후보에 싣지 않는다',
    find: '          coverage: m.coverage,\n', replace: '' },
  { name: 'resolver 가 정책 대신 예전 최신순으로 정렬한다',
    find: 'const bySelectionPolicy = (a: Cand, b: Cand) => compareGraphCandidates(keyOf(a), keyOf(b))',
    replace: 'const bySelectionPolicy = (a: Cand, b: Cand) => a.priority - b.priority || b.item.article.publishedAt.localeCompare(a.item.article.publishedAt)' },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const original = fs.readFileSync(GRAPH_LIB)
const startHash = sha(GRAPH_LIB)
const restore = () => fs.writeFileSync(GRAPH_LIB, original)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130) })
process.on('uncaughtException', (e) => { restore(); console.error(e); process.exit(1) })

const occurrences = (s, sub) => s.split(sub).length - 1
const run = () => {
  const r = spawnSync(CHECK[0], CHECK[1], { encoding: 'utf8', cwd: ROOT })
  const summary = (r.stdout.match(/\d+ PASS · \d+ FAIL/g) ?? ['출력 없음']).pop()
  const failed = r.stdout.split('\n').filter((l) => l.startsWith('  FAIL ')).map((l) => l.slice(7, 60))
  return { status: r.status, summary, failed }
}

let bad = 0
let caught = 0
console.log('\nM-GRAPH 다중 mapping 선택 정책 변이 시험\n')
const base = run()
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 코드에서 검사가 FAIL 이다 (${base.summary})`) }
else console.log(`  기준선 (변이 없음) — PASS · ${base.summary}`)
try {
  for (const mu of MUTATIONS) {
    const n = occurrences(original.toString('utf8'), mu.find)
    if (n !== 1) { bad++; console.log(`  ❌ ${mu.name} — 바꿀 문장이 ${n}번 있다 (변이 무효)`); continue }
    let res
    try {
      fs.writeFileSync(GRAPH_LIB, original.toString('utf8').replace(mu.find, mu.replace))
      res = run()
    } finally { restore() }
    if (sha(GRAPH_LIB) !== startHash) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    if (res.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어)`) }
    else { caught++; console.log(`  ✅ ${mu.name} — FAIL (${res.summary} · ${res.failed.slice(0, 2).join(' / ')})`) }
  }
} finally {
  restore()
}
if (sha(GRAPH_LIB) !== startHash) { bad++; console.log('  ❌ 끝난 뒤 magazine-graph.ts 가 원본과 다르다') } else console.log('\n  원복 확인 — magazine-graph.ts 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
