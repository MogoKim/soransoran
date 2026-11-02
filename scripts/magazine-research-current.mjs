#!/usr/bin/env node
/**
 * 연구 `contract/build/current` 전환 CLI — 제품 builder 산출만 current 로 올린다 (2026-11-02 · lib 머리말 참조).
 *
 *   verify    node scripts/magazine-research-current.mjs verify --research-dir <연구> --candidate-dir <제품 build 산출 판 폴더> \
 *               --snapshot <reconciled/…> --product-root <후보를 만든 제품 판> \
 *               --expect-graph-version <g-…> --expect-semantic <16> --expect-export <16> --expect-bundle-sha256 <64>
 *   install   verify 인자 + --expect-current <지금 current 링크 값> [--write]
 *   rollback  --research-dir <연구> --expect-current <g-…> --expect-previous <g-…> [--write]
 *   recover   --research-dir <연구> [--write]
 *
 * 🔴 기본은 dry-run — 연구 파일 쓰기 0. `--write` 가 있을 때만 쓴다.
 * 🔴 운영 runtime 을 연구 · 후보 · 제품 루트로 받지 않는다. 제품 루트는 읽기만 한다.
 * 종료 코드: 0 성공(dry-run 포함) · 1 거부(구조화 코드) · 2 사용법 오류
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ResearchCurrentError, installCandidate, recoverCurrent, rollbackCurrent, verifyCandidate } from './lib/magazine-research-current.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const cmd = argv[0]
const arg = (n) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const usage = (why) => { process.stderr.write(`사용법 오류 — ${why}\n`); process.exit(2) }
const out = (v) => { process.stdout.write(`${JSON.stringify(v, null, 2)}\n`); process.exit(v.ok ? 0 : 1) }
const need = (n) => arg(n) ?? usage(`${n} 가 필요하다 (기본값 없음)`)
const real = (p, label) => {
  const r = realpathSync(resolve(p))
  if (/(^|\/)soransoran-magazine-runtime(\/|$)/.test(r)) usage(`${label} 가 운영 runtime 이다 — 받지 않는다 (${r})`)
  return r
}

/** DIRECT_E2E 고정 release fixture — 같은 판이면 bundle 바이트를 대조한다 (fixture 는 판이 바뀌어도 그대로다) */
function fixtureBundleFor(graphVersion) {
  const dir = join(ROOT, 'scripts', '__fixtures__', 'magazine', 'rehearsal-direct-e2e')
  if (!existsSync(join(dir, 'manifest.json'))) return null
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  return m.identity?.graphVersion === graphVersion ? readFileSync(join(dir, m.names.bundle), 'utf8') : null
}

const verifyArgs = () => {
  const expect = { graphVersion: need('--expect-graph-version'), semanticHash: need('--expect-semantic'), exportHash: need('--expect-export'), bundleSha256: need('--expect-bundle-sha256') }
  const p = { candidateDir: real(need('--candidate-dir'), '--candidate-dir'), snapshotDir: real(need('--snapshot'), '--snapshot'),
    productRoot: real(need('--product-root'), '--product-root'), researchDir: real(need('--research-dir'), '--research-dir'), expect }
  return { ...p, fixtureBundle: fixtureBundleFor(expect.graphVersion) }
}
const guard = (fn) => { try { return fn() } catch (e) { if (e instanceof ResearchCurrentError) return { ok: false, code: e.code, why: e.why }; throw e } }

if (!cmd || cmd === '--help') { process.stdout.write('연구 current 전환 — verify · install · rollback · recover (인자는 머리말). 인자 없이는 아무것도 읽거나 쓰지 않는다.\n'); process.exit(0) }
const write = argv.includes('--write')
if (cmd === 'verify') {
  const a = verifyArgs()
  out(guard(() => { const v = verifyCandidate(a); return { ok: true, code: 'VERIFIED', graphVersion: v.graphVersion, intentsHash: v.intentsHash, treeSha256: v.treeSha256, fixtureBundleCompared: a.fixtureBundle !== null } }))
} else if (cmd === 'install') {
  const a = verifyArgs()
  out(guard(() => installCandidate({ researchDir: a.researchDir, candidateDir: a.candidateDir, expectCurrent: need('--expect-current'), verify: () => verifyCandidate(a), write })))
} else if (cmd === 'rollback') {
  out(guard(() => rollbackCurrent({ researchDir: real(need('--research-dir'), '--research-dir'), expectCurrent: need('--expect-current'), expectPrevious: need('--expect-previous'), write })))
} else if (cmd === 'recover') {
  out(guard(() => recoverCurrent({ researchDir: real(need('--research-dir'), '--research-dir'), write })))
} else usage(`모르는 명령 ${cmd}`)
