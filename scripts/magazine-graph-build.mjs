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
 * 🔴 current.ts · control.ts 를 쓰지 않는다. out-dir 의 **실제 경로**(symlink 해소)가 product-root · 입력 · 장부 아래면 받지 않는다.
 *    판정 뒤 경로가 바뀌면 OUT_DIR_CHANGED 로 멈춘다.
 * 🔴 같은 graphVersion 폴더가 이미 있으면 바이트가 같을 때만 통과(UNCHANGED), 다르면 거부한다.
 *
 * 종료 코드: 0 성공 · 1 거부(구조화 코드) · 2 사용법 오류
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  ADMISSION_FILES, GraphBuildError, INPUT_FILES, PRODUCT_FILES, buildAll, planOutDir, topCandidates, writeStage,
} from './lib/magazine-graph-build.mjs'

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

// 🔴 쓰기 경계 — **실제 경로**로 판정한다(조상 symlink 우회 차단).
//    product-root 는 통째로 읽기 전용이다(src 만이 아니라 .git · scripts · docs · 루트 자체까지). 입력 · 장부도 같다
const forbidden = [{ label: 'product-root', path: productRoot }, { label: 'input-root', path: inputRoot }]
if (admissionRoot) forbidden.push({ label: 'admission-root', path: admissionRoot })
let plan
try { plan = planOutDir({ outDir, forbidden }) } catch (e) {
  if (e instanceof GraphBuildError) refuse(e.code, e.why)
  throw e
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

let result
try { result = writeStage({ plan, graphVersion: built.graphVersion, files: built.files }) } catch (e) {
  if (e instanceof GraphBuildError) refuse(e.code, e.why)
  throw e
}
const stage = join(plan.canon, built.graphVersion)

const r = built.readiness
process.stdout.write(`${JSON.stringify({
  ok: true, result, graphVersion: built.graphVersion, stage,
  contentHash: built.manifest.contentHash, semanticHash: built.manifest.semanticHash, exportHash: built.manifest.exportHash,
  readiness: { totals: r.totals, blockerCounts: r.blockerCounts, shortfallCounts: r.shortfallCounts, admissionCounts: r.admissionCounts,
    top: topCandidates(r).map((x) => ({ intentId: x.intentId, status: x.status, cluster: x.cluster, direct: x.direct.count,
      discovery: x.discovery.count, reverse: x.reverse.count, blockers: x.blockers, shortfall: x.shortfall })) },
}, null, 2)}\n`)
