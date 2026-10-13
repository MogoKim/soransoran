#!/usr/bin/env node
/**
 * M-GRAPH 공개 판정 시각 변이 시험 (2026-10-13) — 시각 고정을 지운 코드로 graph 검사를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 *
 *   첫 CI 가 10:30:04 KST 에 「미공개 글이 링크에 뜬 경우 0」 으로 실패했다 — 검사 시작 때의 공개 목록과
 *   resolver 안의 공개 판정이 서로 다른 순간을 봤다. 고친 뒤 그 고정을 하나씩 지워 본다.
 *
 * 바꿀 문장이 파일에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 무효 = FAIL).
 * 🔴 파일을 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다. 중간에 끊겨도 되돌린다.
 *
 * 사용: node scripts/magazine-graph-now-mutation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const F = {
  lib: path.join(ROOT, 'src', 'lib', 'magazine.ts'),
  graph: path.join(ROOT, 'src', 'lib', 'magazine-graph.ts'),
  check: path.join(HERE, 'magazine-graph-check.mts'),
}
const CHECKS = [['graph 검사', path.join(ROOT, 'node_modules', '.bin', 'tsx'), [F.check]]]

const MUTATIONS = [
  { name: 'resolver 가 받은 now 를 버리고 진입 때 Date.now 를 다시 읽는다', edits: [{ file: F.graph,
    find: '  now: number = Date.now(),\n): ResolvedRelatedMagazine {\n  try {',
    replace: '  _now: number = Date.now(),\n): ResolvedRelatedMagazine {\n  const now = Date.now()\n  try {' }] },
  { name: 'graph 공개 후보에 now 전달 제거', edits: [{ file: F.graph,
    find: 'getAllMagazineArticles(now).map((a) => [a.slug, a])', replace: 'getAllMagazineArticles().map((a) => [a.slug, a])' }] },
  { name: 'fallback 에 now 전달 제거', edits: [{ file: F.graph,
    find: 'getRelatedMagazineArticles(article, MAX_DIRECT, now).map((a, i) =>', replace: 'getRelatedMagazineArticles(article, MAX_DIRECT).map((a, i) =>' }] },
  { name: '보충(legacy) 에 now 전달 제거', edits: [{ file: F.graph,
    find: '    const legacy = getRelatedMagazineArticles(article, MAX_DIRECT, now)', replace: '    const legacy = getRelatedMagazineArticles(article, MAX_DIRECT)' }] },
  { name: '공개 목록이 받은 now 를 무시한다', edits: [{ file: F.lib,
    find: 'MAGAZINE_ARTICLES.filter((a) => isPublicMagazineArticle(a, now)).sort', replace: 'MAGAZINE_ARTICLES.filter((a) => isPublicMagazineArticle(a)).sort' }] },
  { name: '같은 분류 연관 글이 받은 now 를 넘기지 않는다', edits: [{ file: F.lib,
    find: '  return getAllMagazineArticles(now)\n    .filter((a) => a.slug !== article.slug', replace: '  return getAllMagazineArticles()\n    .filter((a) => a.slug !== article.slug' }] },
  { name: '검사가 CHECK_NOW 대신 Date.now 를 다시 읽는다 (resolver 호출)', edits: [{ file: F.check,
    find: '=> resolveRelatedMagazine(a, env, now)', replace: '=> resolveRelatedMagazine(a, env, Date.now())' }] },
  { name: '검사의 미공개 집합만 다른 시각을 쓴다', edits: [{ file: F.check,
    find: '!isPublicMagazineArticle(a, now)).map((a) => a.slug)', replace: '!isPublicMagazineArticle(a)).map((a) => a.slug)' }] },
  { name: '검사의 공개 목록만 다른 시각을 쓴다', edits: [{ file: F.check,
    find: '  const list = getAllMagazineArticles(now)\n', replace: '  const list = getAllMagazineArticles()\n' }] },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })

const occurrences = (s, sub) => s.split(sub).length - 1
const runAll = () => CHECKS.map(([label, cmd, args]) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT })
  const summary = (r.stdout.match(/\d+ PASS · \d+ FAIL/g) ?? ['출력 없음']).pop()
  return { label, status: r.status, summary }
})

let bad = 0
let caught = 0
console.log('\nM-GRAPH 공개 판정 시각 변이 시험\n')
const base = runAll()
if (base.some((b) => b.status !== 0)) { bad++; console.log(`  ❌ 변이 없는 코드에서 검사가 FAIL 이다 (${base.map((b) => `${b.label} ${b.summary}`).join(' · ')})`) }
else console.log(`  기준선 (변이 없음) — PASS · ${base.map((b) => `${b.label} ${b.summary}`).join(' · ')}`)
try {
  for (const mu of MUTATIONS) {
    const invalid = mu.edits.find((e) => occurrences(originals[e.file].toString('utf8'), e.find) !== 1)
    if (invalid) { bad++; console.log(`  ❌ ${mu.name} — ${path.basename(invalid.file)} 에 바꿀 문장이 ${occurrences(originals[invalid.file].toString('utf8'), invalid.find)}번 있다 (변이 무효)`); continue }
    const mutated = {}
    for (const e of mu.edits) mutated[e.file] = (mutated[e.file] ?? originals[e.file].toString('utf8')).replace(e.find, e.replace)
    let res
    try {
      for (const [f, text] of Object.entries(mutated)) fs.writeFileSync(f, text)
      res = runAll()
    } finally { restoreAll() }
    if (files.some((f) => sha(f) !== startHashes[f])) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    const failed = res.filter((r) => r.status !== 0)
    if (failed.length === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어)`) }
    else { caught++; console.log(`  ✅ ${mu.name} — FAIL (${failed.map((r) => `${r.label} ${r.summary}`).join(' · ')})`) }
  }
} finally {
  restoreAll()
}
const drift = files.filter((f) => sha(f) !== startHashes[f])
if (drift.length) { bad++; console.log(`  ❌ 끝난 뒤 원본과 다른 파일: ${drift.map((f) => path.basename(f)).join(', ')}`) } else console.log('\n  원복 확인 — 변이 대상 파일 전부 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
