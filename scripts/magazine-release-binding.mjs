#!/usr/bin/env node
/**
 * runtime 출처 결속 생성기 — `src/content/magazine/release-binding.ts` 를 지금 graph 판의 Bundle 정적 컴파일 결과로 만든다 (S3-P2).
 *
 *   node scripts/magazine-release-binding.mjs            대조만(기본) — 다르면 exit 1 · 쓰기 0
 *   node scripts/magazine-release-binding.mjs --write    같지 않으면 원자 교체(temp → fsync → rename)
 *   --root <dir>                                         제품 루트(검사용 · 기본 이 저장소)
 *
 * 🔴 지금 graph 판은 control.ts 의 엄격 판독 값이다. 그 판의 Bundle(`src/content/magazine/plan-input/<판>.json`)이 없으면 결속은 null 이다 —
 *    runtime 은 출처를 쓰지 않는다(폴백). Bundle 은 있는데 읽지 못하면 exit 1 · 쓰기 0(모르면 막는다).
 * 🔴 graph 승격이 판을 바꾸면 같은 변경에서 이 생성기를 다시 돌린다 — 검사가 어긋남을 잡는다(release 는 어긋난 결속에서 0).
 */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileContentPlans, releaseBindingOf, strictControlGraphVersion } from './lib/magazine-content-plan.mjs'
import { BINDING_PATH, bundleFilePath, renderBindingFile } from './lib/magazine-release.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * @returns {{ ok: boolean, code: string|null, graphVersion: string|null, expected: string|null, current: string|null, why?: string }}
 */
export function expectedBindingText(root) {
  const controlPath = join(root, 'src/content/magazine/graph/control.ts')
  const controlText = existsSync(controlPath) ? readFileSync(controlPath, 'utf8') : null
  const graphVersion = controlText === null ? null : strictControlGraphVersion(controlText)
  const currentPath = join(root, BINDING_PATH)
  const current = existsSync(currentPath) ? readFileSync(currentPath, 'utf8') : null
  if (!graphVersion) return { ok: false, code: 'CONTROL_UNREADABLE', graphVersion: null, expected: null, current, why: 'control.ts 를 엄격 판독하지 못했다' }
  const bundlePath = join(root, bundleFilePath(graphVersion))
  if (!existsSync(bundlePath)) return { ok: true, code: null, graphVersion, expected: renderBindingFile(null), current }
  try {
    const compiled = compileContentPlans({ bundle: readFileSync(bundlePath, 'utf8') })
    return { ok: true, code: null, graphVersion, expected: renderBindingFile(releaseBindingOf(compiled)), current }
  } catch (e) {
    return { ok: false, code: e?.code ?? 'BUNDLE_UNREADABLE', graphVersion, expected: null, current, why: e?.why ?? e?.message }
  }
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`
  const fd = openSync(tmp, 'wx', 0o644)
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
  try { renameSync(tmp, path) } catch (e) { rmSync(tmp, { force: true }); throw e }
  const dfd = openSync(dirname(path), 'r')
  try { fsyncSync(dfd) } finally { closeSync(dfd) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : resolve(HERE, '..')
  const write = argv.includes('--write')
  const r = expectedBindingText(root)
  if (!r.ok) { console.log(JSON.stringify({ ok: false, code: r.code, why: r.why })); process.exit(1) }
  const same = r.current === r.expected
  if (same) { console.log(JSON.stringify({ ok: true, code: 'BINDING_CURRENT', graphVersion: r.graphVersion })); process.exit(0) }
  if (!write) { console.log(JSON.stringify({ ok: false, code: 'BINDING_STALE', graphVersion: r.graphVersion, why: `${BINDING_PATH} 가 컴파일 결과와 다르다 — --write 로 다시 만든다` })); process.exit(1) }
  writeAtomic(join(root, BINDING_PATH), r.expected)
  console.log(JSON.stringify({ ok: true, code: 'BINDING_WRITTEN', graphVersion: r.graphVersion }))
}
