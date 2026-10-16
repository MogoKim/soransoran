#!/usr/bin/env node
/**
 * M-GRAPH 결정적 build · export · readiness CLI.
 *
 *   node scripts/magazine-graph-build.mjs \
 *     --input-root <연구 입력 다섯 파일 폴더> --product-root <제품 저장소 루트> \
 *     --effective-at 2026-10-15T13:00:00+09:00 --generated-at 2026-10-15T04:43:55.080Z \
 *     --out-dir <산출 폴더> [--admission-root <G8 장부 루트>]
 *
 * 산출: <out-dir>/<graphVersion>/{intents,edges,mappings}.jsonl · manifest.json · readiness.json · bundle/<graphVersion>.ts
 *
 * 🔴 모든 입력은 명시한다. 기본 경로 · 벽시계가 없다.
 * 🔴 읽기 전용: input-root · product-root · admission-root. 쓰기는 out-dir 하나뿐이다.
 * 🔴 current.ts · control.ts 를 쓰지 않는다. 제품 graph 폴더나 src 아래를 out-dir 로 받지 않는다.
 * 🔴 같은 graphVersion 폴더가 이미 있으면 바이트가 같을 때만 통과(UNCHANGED), 다르면 거부한다.
 *
 * 종료 코드: 0 성공 · 1 거부(구조화 코드) · 2 사용법 오류
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { ADMISSION_FILES, GraphBuildError, INPUT_FILES, PRODUCT_FILES, buildAll, topCandidates } from './lib/magazine-graph-build.mjs'

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const usage = (why) => { process.stderr.write(`사용법 오류 — ${why}\n`); process.exit(2) }
const refuse = (code, why) => { process.stdout.write(`${JSON.stringify({ ok: false, code, why }, null, 2)}\n`); process.exit(1) }

if (argv.includes('--help') || !argv.length) {
  process.stdout.write('M-GRAPH 결정적 build — 인자는 파일 머리말을 본다. 인자 없이는 아무것도 읽거나 쓰지 않는다.\n')
  process.exit(0)
}

const required = ['--input-root', '--product-root', '--effective-at', '--generated-at', '--out-dir']
for (const name of required) if (!arg(name)) usage(`${name} 를 명시해야 한다`)
const inputRoot = resolve(arg('--input-root'))
const productRoot = resolve(arg('--product-root'))
const outDir = resolve(arg('--out-dir'))
const admissionRoot = arg('--admission-root') ? resolve(arg('--admission-root')) : null

const inside = (child, parent) => { const r = relative(parent, child); return r === '' || (!r.startsWith('..') && !r.startsWith(sep) && r !== '..') }
// 🔴 쓰기 경계 — 입력 폴더 · 제품 src 아래에는 쓰지 않는다
if (inside(outDir, join(productRoot, 'src'))) refuse('OUT_DIR_FORBIDDEN', `out-dir 가 제품 src 아래다: ${outDir}`)
for (const root of [inputRoot, admissionRoot].filter(Boolean)) {
  if (inside(outDir, root)) refuse('OUT_DIR_FORBIDDEN', `out-dir 가 읽기 전용 입력 아래다: ${outDir}`)
}
if (existsSync(join(outDir, 'current.ts')) || existsSync(join(outDir, 'control.ts'))) {
  refuse('OUT_DIR_FORBIDDEN', 'out-dir 에 current.ts · control.ts 가 있다 — 제품 graph 폴더로 보인다. build 는 판 전환을 하지 않는다')
}

const readOrNull = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const inputTexts = Object.fromEntries(Object.values(INPUT_FILES).map((name) => [name, readOrNull(join(inputRoot, name))]))
const productTexts = Object.fromEntries(Object.entries(PRODUCT_FILES).map(([k, rel]) => [k, readOrNull(join(productRoot, rel))]))
const admissionTexts = admissionRoot
  ? Object.fromEntries(Object.entries(ADMISSION_FILES).map(([k, rel]) => [k, readOrNull(join(admissionRoot, rel))]))
  : null

let built
try {
  built = buildAll({ inputTexts, productTexts, admissionTexts, effectiveAt: arg('--effective-at'), generatedAt: arg('--generated-at') })
} catch (e) {
  if (e instanceof GraphBuildError) refuse(e.code, e.why)
  throw e
}

const stage = join(outDir, built.graphVersion)
const listFiles = (dir) => {
  const out = []
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : out.push(relative(dir, p)) } }
  walk(dir)
  return out.sort()
}
let result = 'WRITTEN'
if (existsSync(stage)) {
  const have = listFiles(stage)
  const want = Object.keys(built.files).sort()
  const same = have.length === want.length && want.every((f, i) => have[i] === f && readFileSync(join(stage, f), 'utf8') === built.files[f])
  if (!same) refuse('OUT_STAGE_CONFLICT', `${built.graphVersion} 폴더가 이미 있고 내용이 다르다 — 덮어쓰지 않는다`)
  result = 'UNCHANGED'
} else {
  mkdirSync(outDir, { recursive: true })
  const tmp = mkdtempSync(join(outDir, `.${built.graphVersion}.tmp-`))
  try {
    for (const [rel, text] of Object.entries(built.files)) {
      mkdirSync(dirname(join(tmp, rel)), { recursive: true })
      writeFileSync(join(tmp, rel), text)
    }
    renameSync(tmp, stage)
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true })
    throw e
  }
}

const r = built.readiness
process.stdout.write(`${JSON.stringify({
  ok: true, result, graphVersion: built.graphVersion, stage,
  contentHash: built.manifest.contentHash, semanticHash: built.manifest.semanticHash, exportHash: built.manifest.exportHash,
  readiness: { totals: r.totals, blockerCounts: r.blockerCounts, shortfallCounts: r.shortfallCounts, admissionCounts: r.admissionCounts,
    top: topCandidates(r).map((x) => ({ intentId: x.intentId, status: x.status, cluster: x.cluster, direct: x.direct.count,
      discovery: x.discovery.count, reverse: x.reverse.count, blockers: x.blockers, shortfall: x.shortfall })) },
}, null, 2)}\n`)
