#!/usr/bin/env node
/**
 * M-GRAPH edge 단위 선택 정책 변이 시험 (2026-10-17) — 정책을 지운 resolver 로 graph 검사를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 *
 *   edge 안 대표 1개: coverage ANSWERS → publishedAt 최신 → slug (`compareEdgeTargets`)
 *   edge 대표 사이:   priority → publishedAt 최신 → edgeId → slug, coverage 비교 없음 (`compareEdgePicks`)
 *   slug 중복은 대표 선택 · 정렬 뒤에 뺀다.
 *   cold-weather-joint-pain 공개 때 최신순만으로 고르다 명절 글 2편의 발견 카드가 바뀌었다.
 *
 * 한 변이는 edit 여러 개일 수 있다. 각 문장이 파일에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 무효 = FAIL).
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
  // ── edge 안 대표 선택 (compareEdgeTargets) ──
  { name: 'edge 안 coverage 우선 비교 제거 (최신 → slug)', edits: [
    { find: '    answers(a) - answers(b) ||\n', replace: '' }] },
  { name: 'ANSWERS_* 도 ANSWERS 로 취급 (비-ANSWERS 끼리 새 순위)', edits: [
    { find: '(t.coverage === PREFERRED_COVERAGE ? 0 : 1)', replace: '(t.coverage?.startsWith(PREFERRED_COVERAGE) ? 0 : 1)' }] },
  { name: 'edge 안 slug 결정 규칙 제거 (입력 순서 의존)', edits: [
    { find: '    b.article.publishedAt.localeCompare(a.article.publishedAt) ||\n    byString(a.article.slug, b.article.slug)\n  )',
      replace: '    b.article.publishedAt.localeCompare(a.article.publishedAt)\n  )' }] },
  { name: 'resolver 가 mapping coverage 를 대상에 싣지 않는다', edits: [
    { find: 'targets.push({ article, coverage: m.coverage })', replace: 'targets.push({ article })' }] },
  { name: 'edge 안 대표를 예전 최신순만으로 고른다', edits: [
    { find: 'const [rep] = targets.sort(compareEdgeTargets)', replace: 'const [rep] = targets.sort((a, b) => b.article.publishedAt.localeCompare(a.article.publishedAt))' }] },
  { name: 'edge 별 대표 선택 제거 (입력 순서 첫 글)', edits: [
    { find: 'const [rep] = targets.sort(compareEdgeTargets)', replace: 'const [rep] = targets' }] },
  { name: '한 edge 의 mapping 여러 개를 모두 후보로 방출', edits: [
    { find: '    const [rep] = targets.sort(compareEdgeTargets)\n    const pick: EdgePick<A> = { edge, article: rep.article, coverage: rep.coverage }\n    if (edge.slot === DISCOVERY_SLOT) discovery.push(pick)\n    else direct.push(pick)\n',
      replace: '    for (const rep of targets.sort(compareEdgeTargets)) {\n      const pick: EdgePick<A> = { edge, article: rep.article, coverage: rep.coverage }\n      if (edge.slot === DISCOVERY_SLOT) discovery.push(pick)\n      else direct.push(pick)\n    }\n' }] },
  { name: '대표 선택 전 slug dedupe (앞 edge 가 고른 글을 뒤 edge 후보에서 미리 뺀다)', edits: [
    { find: '  const discovery: EdgePick<A>[] = []\n\n  for (const edge of graph.edges) {',
      replace: '  const discovery: EdgePick<A>[] = []\n  const claimed = new Set<string>()\n\n  for (const edge of graph.edges) {' },
    { find: '      if (m.slug === selfSlug) continue // 🔴 자기 링크 원천 차단', replace: '      if (m.slug === selfSlug || claimed.has(m.slug)) continue' },
    { find: '    const pick: EdgePick<A> = { edge, article: rep.article, coverage: rep.coverage }\n',
      replace: '    const pick: EdgePick<A> = { edge, article: rep.article, coverage: rep.coverage }\n    claimed.add(rep.article.slug)\n' }] },
  // ── edge 대표 사이 순서 (compareEdgePicks) ──
  { name: '서로 다른 edge 에 coverage 전역 정렬을 다시 적용', edits: [
    { find: '    a.edge.priority - b.edge.priority ||\n',
      replace: '    a.edge.priority - b.edge.priority ||\n    (a.coverage === PREFERRED_COVERAGE ? 0 : 1) - (b.coverage === PREFERRED_COVERAGE ? 0 : 1) ||\n' }] },
  { name: 'edge 사이 결정적 tie-break(edgeId · slug) 제거', edits: [
    { find: '    b.article.publishedAt.localeCompare(a.article.publishedAt) ||\n    byString(a.edge.id, b.edge.id) ||\n    byString(a.article.slug, b.article.slug)\n',
      replace: '    b.article.publishedAt.localeCompare(a.article.publishedAt)\n' }] },
  { name: '대표 정렬 뒤 slug 중복 제거를 뺀다', edits: [
    { find: 'return { direct: ownSlugs(direct.sort(compareEdgePicks)), discovery: ownSlugs(discovery.sort(compareEdgePicks)) }',
      replace: 'return { direct: direct.sort(compareEdgePicks), discovery: discovery.sort(compareEdgePicks) }' }] },
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
console.log('\nM-GRAPH edge 단위 선택 정책 변이 시험\n')
const base = run()
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 코드에서 검사가 FAIL 이다 (${base.summary})`) }
else console.log(`  기준선 (변이 없음) — PASS · ${base.summary}`)
try {
  for (const mu of MUTATIONS) {
    const invalid = mu.edits.find((e) => occurrences(original.toString('utf8'), e.find) !== 1)
    if (invalid) { bad++; console.log(`  ❌ ${mu.name} — 바꿀 문장이 ${occurrences(original.toString('utf8'), invalid.find)}번 있다 (변이 무효)`); continue }
    let res
    try {
      fs.writeFileSync(GRAPH_LIB, mu.edits.reduce((s, e) => s.replace(e.find, e.replace), original.toString('utf8')))
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
