#!/usr/bin/env node
/**
 * control 구조 편집 helper 변이 시험 (2026-10-18) — helper 계약이나 소비처 연결을 망가뜨리면
 * `magazine-graph-control-edit-check` 가 **실제로** 실패해야 한다.
 *
 *   node scripts/magazine-graph-control-edit-mutation.mjs
 *
 * helper: 사본을 임시 폴더에 만들고(상대 import 는 절대 경로로) MGRAPH_CONTROL_EDIT_LIB 로 주입한다 — 저장소 파일을 고치지 않는다.
 * 소비처: 제자리에서 옛 고정 문자열 치환으로 되돌리고, 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다.
 * 🔴 검출 = 기대한 반례 이름이 FAIL 로 찍히고 exit ≠ 0. 변이 지점 없음 · 지점 중복 · 적재 실패(LOAD_ERROR) · 요약 없음 · 원복 실패는 하네스 FAIL.
 * 🔴 무변이 상태에서 검사가 먼저 통과해야 한다.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const LIB = path.join(HERE, 'lib', 'magazine-graph-control-edit.mjs')
const CHECK = path.join(HERE, 'magazine-graph-control-edit-check.mjs')

const HELPER_MUTATIONS = [
  { id: 'CE2 중복 추가 허용', from: "  if (cs.includes(cluster)) fail('CLUSTER_ALREADY_PRESENT'", to: "  if (false) fail('CLUSTER_ALREADY_PRESENT'",
    expect: '이미 money-work 가 있으면' },
  { id: 'CE3 없는 cluster 제거 허용', from: "  if (!cs.includes(cluster)) fail('CLUSTER_NOT_PRESENT'", to: "  if (false) fail('CLUSTER_NOT_PRESENT'",
    expect: '없는 cluster 제거는' },
  { id: 'CE4 사후조건(cluster 기대값) 제거', from: '  if (JSON.stringify(after.enabledClusters) !== JSON.stringify(nextClusters)) {',
    to: '  if (false) {', expect: '사후조건: 편집 뒤 cluster' },
  { id: 'CE5 다른 control 필드 변경 허용', from: "  if (rest(before) !== rest(after)) fail('OTHER_FIELD_CHANGED'",
    to: "  if (false) fail('OTHER_FIELD_CHANGED'", expect: '대상 필드 밖이 바뀌면' },
  { id: 'CE6 하위 객체 변경을 못 보는 직렬화로 회귀', from: '  const rest = (o) => { const { enabledClusters: _drop, ...r } = o; return stable(r) }',
    to: '  const rest = (o) => { const { enabledClusters: _drop, ...r } = o; return JSON.stringify(r, Object.keys(r).sort()) }', expect: '대상 필드 밖이 바뀌면' },
]
const CONSUMER_MUTATIONS = [
  { id: 'CE1a direct-spec source 가 helper 대신 고정 문자열로 cluster-off', file: 'scripts/magazine-direct-spec-source-check.mjs',
    from: "removeCluster(readFileSync(p, 'utf8'), BASIS.sourceCluster)",
    to: "readFileSync(p, 'utf8').replace(\"enabledClusters: ['sleep', 'family']\", \"enabledClusters: ['family']\")", expect: '세 소비처가' },
  { id: 'CE1b graph-build 3b 가 helper 대신 고정 문자열', file: 'scripts/magazine-graph-build-check.mjs',
    from: "    const { text: control } = ensureCluster(pt.control, 'money-work')",
    to: "    const control = pt.control.replace(\"enabledClusters: ['sleep', 'family'],\", \"enabledClusters: ['sleep', 'family', 'money-work'],\")", expect: '세 소비처가' },
  { id: 'CE1c relation-policy 가 helper 대신 고정 문자열', file: 'scripts/magazine-relation-policy-check.mjs',
    from: "    const { text: control } = controlEdit.ensureCluster(productTexts.control, 'money-work')",
    to: "    const control = productTexts.control.replace(\"enabledClusters: ['sleep', 'family'],\", \"enabledClusters: ['sleep', 'family', 'money-work'],\")", expect: '세 소비처가' },
]

const occurrences = (s, sub) => s.split(sub).length - 1
const run = (env = {}) => {
  const r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env: { ...process.env, ...env } })
  const out = r.stdout ?? ''
  const m = /control 편집 검사: (\d+) pass, (\d+) fail/.exec(out)
  return { status: r.status, out, pass: m ? +m[1] : null, fail: m ? +m[2] : null, load: /LOAD_ERROR/.test(out) }
}
const lines = []
let detected = 0, harnessFail = 0
const judge = (mu, r) => {
  if (r.load || r.fail === null) { lines.push(`❌ ${mu.id} — 적재 실패·요약 없음(검출 아님)`); harnessFail++; return }
  const hit = r.out.split('\n').some((l) => l.startsWith(`FAIL ${mu.expect}`))
  if (r.status !== 0 && r.fail > 0 && hit) { detected++; lines.push(`✅ ${mu.id} → 「${mu.expect}」 실패로 검출 (fail=${r.fail})`) }
  else { lines.push(`❌ ${mu.id} — 기대한 「${mu.expect}」 가 실패하지 않았다 (status ${r.status} fail=${r.fail})`); harnessFail++ }
}

const base = run()
if (base.status !== 0 || base.fail !== 0 || base.load) { lines.push(`❌ 무변이 검사가 통과하지 않는다 ${base.out.slice(-200)}`); harnessFail++ }
else lines.push(`✅ 무변이 ${base.pass} pass · 0 fail`)

// ── helper (사본 주입) ──
const TMP = fs.mkdtempSync(path.join(tmpdir(), 'control-edit-mutation-'))
const libText = fs.readFileSync(LIB, 'utf8').replace(/from '\.\/([^']+)'/g, (_, rel) => `from '${path.join(path.dirname(LIB), rel)}'`)
for (const [i, mu] of HELPER_MUTATIONS.entries()) {
  const n = occurrences(libText, mu.from)
  if (n !== 1) { lines.push(`❌ ${mu.id} — 변이 지점 ${n}곳 (하네스 결함)`); harnessFail++; continue }
  const p = path.join(TMP, `m${i + 1}.mjs`)
  fs.writeFileSync(p, libText.replace(mu.from, mu.to))
  judge(mu, run({ MGRAPH_CONTROL_EDIT_LIB: p }))
}
fs.rmSync(TMP, { recursive: true, force: true })

// ── 소비처 (제자리 · 해시 원복) ──
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(CONSUMER_MUTATIONS.map((m) => path.join(ROOT, m.file)))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })
try {
  for (const mu of CONSUMER_MUTATIONS) {
    const f = path.join(ROOT, mu.file)
    const src = originals[f].toString('utf8')
    const n = occurrences(src, mu.from)
    if (n !== 1) { lines.push(`❌ ${mu.id} — 변이 지점 ${n}곳 (하네스 결함)`); harnessFail++; continue }
    let r
    try { fs.writeFileSync(f, src.replace(mu.from, mu.to)); r = run() } finally { restoreAll() }
    if (files.some((x) => sha(x) !== startHashes[x])) { lines.push(`❌ ${mu.id} — 원복 후 해시가 다르다`); harnessFail++; break }
    judge(mu, r)
  }
} finally { restoreAll() }
if (files.some((x) => sha(x) !== startHashes[x])) { lines.push('❌ 끝난 뒤 소비처 파일이 원본과 다르다'); harnessFail++ }
else lines.push('   원복 확인 — 소비처 3개 파일 시작 해시와 같다')

const total = HELPER_MUTATIONS.length + CONSUMER_MUTATIONS.length
console.log(`M-GRAPH control 편집 helper 변이\n${lines.join('\n')}\nMUTATION detected=${detected}/${total} harnessFail=${harnessFail}`)
process.exit(harnessFail ? 1 : 0)
