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
  rule: path.join(ROOT, 'src', 'lib', 'magazine-provenance-rule.mjs'),
  check: path.join(HERE, 'magazine-graph-check.mts'),
}
const CHECKS = [['graph 검사', path.join(ROOT, 'node_modules', '.bin', 'tsx'), [F.check]]]

const MUTATIONS = [
  { name: 'resolver 가 받은 now 를 버리고 진입 때 Date.now 를 다시 읽는다', edits: [{ file: F.graph,
    find: '  now: number = Date.now(),\n): ResolvedRelatedMagazine {\n  try {',
    replace: '  _now: number = Date.now(),\n): ResolvedRelatedMagazine {\n  const now = Date.now()\n  try {' }] },
  // 🔴 2026-10-18 — edge 단위 선택(#758)이 공개 후보 · 보충을 resolveFromGraph 인자로 옮겼다. 지점도 그 호출로 옮긴다
  { name: 'graph 공개 후보에 now 전달 제거', edits: [{ file: F.graph,
    find: 'resolveFromGraph(article, GRAPH, getAllMagazineArticles(now), () =>', replace: 'resolveFromGraph(article, GRAPH, getAllMagazineArticles(), () =>' }] },
  { name: 'fallback 에 now 전달 제거', edits: [{ file: F.graph,
    find: 'getRelatedMagazineArticles(article, MAX_DIRECT, now).map((a, i) =>', replace: 'getRelatedMagazineArticles(article, MAX_DIRECT).map((a, i) =>' }] },
  { name: '보충(legacy) 에 now 전달 제거', edits: [{ file: F.graph,
    find: '() =>\n      getRelatedMagazineArticles(article, MAX_DIRECT, now),\n', replace: '() =>\n      getRelatedMagazineArticles(article, MAX_DIRECT),\n' }] },
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
  // ── S3 P1 (2026-11-12 · 11-13 수리) — vNext Article 출처 overlay: 공유 규칙 하나 · canonical 우선 · 중복 · 결속 · 관문 뒤 · rollback 폴백 (검사 ④-P) ──
  { name: '출처가 canonical 같은 slug(다른 intent)를 이긴다', edits: [{ file: F.rule,
    find: '    if (intentsOfSlug.has(r.slug)) continue', replace: '    if (intentsOfSlug.get(r.slug)?.has(intentId)) continue' }] },
  { name: '출처가 canonical 같은 intent(미공개 · 다른 slug)를 무시하고 두 번째 글을 붙인다', edits: [{ file: F.rule,
    find: '    if (slugsOfIntent.has(intentId)) continue', replace: '    if (false) continue' }] },
  { name: '출처 overlay 가 현재 graph 에 없는 intent 도 더한다(rollback 무시)', edits: [{ file: F.rule,
    find: '    if (!intents.has(intentId)) continue', replace: '    if (false) continue' }] },
  { name: '출처 intent 중복에서 고르지 않는 대신 둘 다 더한다', edits: [{ file: F.rule,
    find: '    if (claims.get(intentId) > 1) continue', replace: '    if (false) continue' }] },
  { name: '결속 없음(운영 기본값)을 결속으로 본다 — P1 에서 출처가 켜진다', edits: [{ file: F.rule,
    find: '  if (!binding) return false\n', replace: '  if (!binding) return true\n' }] },
  { name: '결속이 graphVersion 을 대조하지 않는다', edits: [{ file: F.rule,
    find: '  if (release.graphVersion !== binding.graphVersion) return false\n', replace: '' }] },
  { name: '결속이 bundleHash 를 대조하지 않는다', edits: [{ file: F.rule,
    find: '  if (release.bundleHash !== binding.bundleHash) return false\n', replace: '' }] },
  { name: '결속이 policyBoard 를 대조하지 않는다', edits: [{ file: F.rule,
    find: "  if (!release.policyBoard || release.policyBoard.id !== binding.policyBoard.id || release.policyBoard.hash !== binding.policyBoard.hash) return false\n", replace: '' }] },
  { name: '결속이 planHash 를 대조하지 않는다', edits: [{ file: F.rule,
    find: ' && binding.planHashOf[release.intentId] === release.planHash\n', replace: '\n' }] },
  { name: '결속이 컴파일 plan 없는 intent(intentId 위조)를 받아들인다', edits: [{ file: F.rule,
    find: "own(binding.planHashOf, release.intentId) && binding.planHashOf[release.intentId] === release.planHash",
    replace: "(!own(binding.planHashOf, release.intentId) || binding.planHashOf[release.intentId] === release.planHash)" }] },
  { name: '출처가 있는 글은 kill switch 관문보다 먼저 graph 로 간다', edits: [{ file: F.graph,
    find: "    if (!runtime.enabled) return fallback(article, 'DISABLED', now)",
    replace: "    if (!runtime.enabled && !article.release) return fallback(article, 'DISABLED', now)" }] },
  { name: 'resolver 가 출처 overlay 를 쓰지 않는다(canonical mapping 만)', edits: [{ file: F.graph,
    find: '  const mappings = effectiveGraphMappings(graph, published, binding)\n', replace: '  const mappings = graph.mappings\n' }] },
  { name: 'resolver 가 공유 규칙 대신 자기 사본(canonical 우선 없음)을 쓴다', edits: [{ file: F.graph,
    find: '  const overlay = provenanceOverlay({\n', replace: '  const overlay = rows.map((r) => ({ intent: r.release.intentId, slug: r.slug })) || provenanceOverlay({\n' }] },
  { name: '운영이 읽지 않는 출처 진단(dropped)을 되살린다', edits: [{ file: F.rule,
    find: '  return overlay\n}', replace: '  return overlay\n}\nexport const dropped = []' }] },
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
