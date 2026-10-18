#!/usr/bin/env node
/**
 * M-GRAPH graph 참여 계약 변이 시험 (2026-10-18) — SEARCH_NODE · EDITORIAL_NON_SEARCH · UNRESOLVED 판정을 하나씩 망가뜨리면
 * 검사가 **실제로** 실패해야 한다.
 *
 *   node scripts/magazine-graph-participation-mutation.mjs
 *
 * coverage 계층: lib 사본을 임시 폴더에 만들고 MGRAPH_COVERAGE_LIB 로 주입한다 — 저장소 파일을 고치지 않는다.
 * resolver: 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다. 중간에 끊겨도 되돌린다.
 * 🔴 검출 = 기대한 반례 이름이 FAIL 로 찍히고 exit ≠ 0. 변이 지점 없음 · 지점 중복 · 적재 실패(LOAD_ERROR) · 요약 없음은 하네스 FAIL.
 * 🔴 무변이 상태에서 두 검사가 먼저 통과해야 한다.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const COVERAGE_LIB = path.join(HERE, 'lib', 'magazine-graph-coverage.mjs')
const COVERAGE_CHECK = path.join(HERE, 'magazine-graph-coverage-check.mjs')
const RESOLVER = path.join(ROOT, 'src', 'lib', 'magazine-graph.ts')
const GRAPH_CHECK = [path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(HERE, 'magazine-graph-check.mts')]]

const COVERAGE_MUTATIONS = [
  { id: 'PC1 editorial + mapping 충돌 판정 제거', from: '    if (sourceMappings.length > 0 && declared.length > 0) {', to: '    if (false) {',
    expect: '참여: editorial 선언 + mapping 동시' },
  { id: 'PC2 editorial 선언 형식 검사 제거(빈 hash 허용)', from: 'const validEditorial = (p) => p?.state === PARTICIPATION.EDITORIAL_NON_SEARCH',
    to: 'const validEditorial = (p) => true || p?.state === PARTICIPATION.EDITORIAL_NON_SEARCH', expect: '참여: editorial 선언의 hash 누락' },
  { id: 'PC3 UNRESOLVED 가 활성화를 막지 않는다', from: '      : row.participation !== PARTICIPATION.EDITORIAL_NON_SEARCH))',
    to: '      : false))', expect: '참여: unmapped + 분류 없음' },
  { id: 'PC4 SEARCH_NODE 미준비가 활성화를 막지 않는다', from: "      ? row.status !== 'READY'", to: '      ? false',
    expect: '참여: mapped + edge 없음' },
  { id: 'PC5 slug 이름으로 editorial 처리', from: '    const declared = editorialBySlug.get(article.slug) ?? []',
    to: "    const declared = editorialBySlug.get(article.slug) ?? (/editorial/.test(article.slug) ? [{ state: 'EDITORIAL_NON_SEARCH', reasonCode: 'NAME', evidenceHash: 'f'.repeat(64) }] : [])",
    expect: '참여: slug 이름·cluster 이름만으로는' },
  { id: 'PC6 공개 글 0편 cluster 활성 허용', from: '    ok: rows.length > 0 && blockers.length === 0,', to: '    ok: blockers.length === 0,',
    expect: '활성: 공개 글이 없는 cluster' },
  { id: 'PC7 같은 slug 의 editorial 선언 중복 허용', from: '      if (declared.length === 1 && validEditorial(declared[0])) {',
    to: '      if (declared.length >= 1 && validEditorial(declared[0])) {', expect: '참여: 같은 slug 의 editorial 선언 중복' },
]
const RESOLVER_MUTATIONS = [
  { id: 'PR1 resolver 가 editorial 사유를 버린다', from: "    return { reason: editorial ? 'EDITORIAL_NON_SEARCH' : 'NO_MAPPING' }",
    to: "    return { reason: 'NO_MAPPING' }", expect: 'resolver: 매핑 없음 + editorial 선언' },
  { id: 'PR2 resolver 가 다른 slug 의 선언도 editorial 로 본다',
    from: "(graph.participation ?? []).some((p) => p.slug === article.slug && p.state === 'EDITORIAL_NON_SEARCH')",
    to: "(graph.participation ?? []).some((p) => p.state === 'EDITORIAL_NON_SEARCH')", expect: 'resolver: 다른 slug 의 선언' },
]

const occurrences = (s, sub) => s.split(sub).length - 1
const lines = []
let detected = 0, harnessFail = 0

// ── coverage 계층 (사본 주입) ──
const TMP = fs.mkdtempSync(path.join(tmpdir(), 'mgraph-participation-mutation-'))
const coverageText = fs.readFileSync(COVERAGE_LIB, 'utf8')
const runCoverage = (text, tag) => {
  const lib = path.join(TMP, `${tag}.mjs`)
  fs.writeFileSync(lib, text)
  const r = spawnSync(process.execPath, [COVERAGE_CHECK], { encoding: 'utf8', env: { ...process.env, MGRAPH_COVERAGE_LIB: lib } })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const m = /M-GRAPH coverage 검사: (\d+) pass, (\d+) fail/.exec(out)
  return { status: r.status, out, pass: m ? +m[1] : null, fail: m ? +m[2] : null, load: /LOAD_ERROR/.test(out) }
}
const cb = runCoverage(coverageText, 'base')
if (cb.status !== 0 || cb.fail !== 0 || cb.load) { lines.push(`❌ coverage 무변이 사본이 통과하지 않는다 (status ${cb.status}) ${cb.out.slice(-200)}`); harnessFail++ }
else lines.push(`✅ coverage 무변이 사본 ${cb.pass} pass · 0 fail`)
for (const [i, mu] of COVERAGE_MUTATIONS.entries()) {
  const n = occurrences(coverageText, mu.from)
  if (n !== 1) { lines.push(`❌ ${mu.id} — 변이 지점 ${n}곳 (하네스 결함)`); harnessFail++; continue }
  const r = runCoverage(coverageText.replace(mu.from, mu.to), `m${i + 1}`)
  if (r.load || r.fail === null) { lines.push(`❌ ${mu.id} — 적재 실패·요약 없음(검출 아님)`); harnessFail++; continue }
  const hit = r.out.split('\n').some((l) => l.startsWith(`FAIL ${mu.expect}`))
  if (r.status !== 0 && r.fail > 0 && hit) { detected++; lines.push(`✅ ${mu.id} → 「${mu.expect}」 실패로 검출 (fail=${r.fail})`) }
  else { lines.push(`❌ ${mu.id} — 기대한 「${mu.expect}」 가 실패하지 않았다 (status ${r.status} fail=${r.fail})`); harnessFail++ }
}
fs.rmSync(TMP, { recursive: true, force: true })

// ── resolver (제자리 변이 · 해시 원복) ──
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const original = fs.readFileSync(RESOLVER)
const startHash = sha(RESOLVER)
const restore = () => fs.writeFileSync(RESOLVER, original)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130) })
process.on('uncaughtException', (e) => { restore(); console.error(e); process.exit(1) })
const runGraph = () => {
  const r = spawnSync(GRAPH_CHECK[0], GRAPH_CHECK[1], { encoding: 'utf8', cwd: ROOT })
  const summary = (r.stdout.match(/\d+ PASS · \d+ FAIL/g) ?? ['출력 없음']).pop()
  return { status: r.status, summary, failed: r.stdout.split('\n').filter((l) => l.startsWith('  FAIL ')).map((l) => l.slice(7)) }
}
const gb = runGraph()
if (gb.status !== 0) { lines.push(`❌ graph 검사가 무변이 상태에서 FAIL 이다 (${gb.summary})`); harnessFail++ }
else lines.push(`✅ graph 검사 무변이 ${gb.summary}`)
try {
  for (const mu of RESOLVER_MUTATIONS) {
    const n = occurrences(original.toString('utf8'), mu.from)
    if (n !== 1) { lines.push(`❌ ${mu.id} — 변이 지점 ${n}곳 (하네스 결함)`); harnessFail++; continue }
    let r
    try { fs.writeFileSync(RESOLVER, original.toString('utf8').replace(mu.from, mu.to)); r = runGraph() } finally { restore() }
    if (sha(RESOLVER) !== startHash) { lines.push(`❌ ${mu.id} — 원복 후 해시가 다르다`); harnessFail++; break }
    const hit = r.failed.some((l) => l.startsWith(mu.expect))
    if (r.status !== 0 && hit) { detected++; lines.push(`✅ ${mu.id} → 「${mu.expect}」 실패로 검출 (${r.summary})`) }
    else { lines.push(`❌ ${mu.id} — 기대한 「${mu.expect}」 가 실패하지 않았다 (${r.summary})`); harnessFail++ }
  }
} finally { restore() }
if (sha(RESOLVER) !== startHash) { lines.push('❌ 끝난 뒤 magazine-graph.ts 가 원본과 다르다'); harnessFail++ }
else lines.push('   원복 확인 — magazine-graph.ts 시작 해시와 같다')

const total = COVERAGE_MUTATIONS.length + RESOLVER_MUTATIONS.length
console.log(`M-GRAPH graph 참여 변이\n${lines.join('\n')}\nMUTATION detected=${detected}/${total} harnessFail=${harnessFail}`)
process.exit(harnessFail ? 1 : 0)
