#!/usr/bin/env node
/**
 * ArticlePlan CLI — G8 admission 을 사람이 승인하는 ArticlePlan(source/2)으로 잇고, 승인 entry 로만 큐 행을 만든다.
 *
 *   prepare      읽기 전용. 지정한 slug 하나의 DRAFT 후보 JSON 을 stdout 으로 낸다. 파일을 쓰지 않는다. 큐 행을 요구하지 않는다.
 *                node scripts/magazine-direct-spec-source-authoring.mjs prepare --slug <slug> --as-of <KST> \
 *                  --repo <제품 루트> --admission-root <연구 루트(contract/g8-admission · m3-slug-manifest · m3-state)> [--research-dir <연구 루트>]
 *   inspect      읽기 전용. 후보 파일의 지금 해시 · 미해결 필드 · 차단 사유를 낸다.
 *                node scripts/magazine-direct-spec-source-authoring.mjs inspect --candidate <file>
 *   approve      source artifact 의 유일한 쓰기. 사람이 채운 후보를 다시 전부 검증하고 승인 entry 하나를 원자적으로 더한다.
 *                node scripts/magazine-direct-spec-source-authoring.mjs approve --candidate <file> --approver <이름> \
 *                  --at <KST> --confirm-candidate-hash <sha256:…> --repo <제품 루트> --admission-root <연구 루트> \
 *                  --out-root <쓸 저장소 루트> [--research-dir <연구 루트>]
 *   materialize  큐의 유일한 ArticlePlan 쓰기. 승인 entry 하나로 topic-queue 행 하나를 큐 writer lock 안에서 더한다.
 *                node scripts/magazine-direct-spec-source-authoring.mjs materialize --slug <slug> \
 *                  --repo <제품 루트> --admission-root <연구 루트> --out-root <쓸 저장소 루트>
 *
 * 🔴 기본 실행(명령 없음)은 도움말이다. 자동 승인 · 자동 후보 선택 · 자동 materialize 가 없다.
 * 🔴 운영 runtime 작업장에는 쓰지 않는다. 연구 receipt · slug manifest · ledger · articles · graph 를 쓰지 않는다.
 * 🔴 네트워크 · Chrome · CDP · 모델 호출 0.
 *
 * 종료 코드: 0 성공 · 1 거부(구조화 코드) · 2 사용법 오류
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  approveCandidate, inspectCandidate, materializePlan, prepareCandidate,
} from './lib/magazine-direct-spec-source-authoring.mjs'

const argv = process.argv.slice(2)
const command = argv[0]
const arg = (name) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const out = (value, code) => { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); process.exit(code) }
const usage = (why) => { process.stderr.write(`사용법 오류 — ${why}\n`); process.exit(2) }
const readCandidate = () => {
  const p = arg('--candidate')
  if (!p) usage('--candidate 가 필요하다')
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { return usage(`후보 파일을 읽지 못했다: ${e.message}`) }
}

if (!command || command === '--help' || command === 'help') {
  process.stdout.write(`ArticlePlan — prepare(읽기 전용) · inspect(읽기 전용) · approve(source artifact 쓰기) · materialize(큐 행 쓰기)\n`
    + '자세한 인자는 파일 머리말을 본다. 명령 없이 실행하면 아무것도 읽거나 쓰지 않는다.\n')
  process.exit(0)
}

if (command === 'prepare') {
  const repo = arg('--repo')
  const admission = arg('--admission-root')
  if (!repo || !admission) usage('--repo 와 --admission-root 를 명시해야 한다')
  const r = prepareCandidate({ repoRoot: resolve(repo), admissionRoot: resolve(admission), slug: arg('--slug'), asOf: arg('--as-of'),
    researchDir: arg('--research-dir') ? resolve(arg('--research-dir')) : null })
  out(r.ok ? r.candidate : r, r.ok ? 0 : 1)
} else if (command === 'inspect') {
  out(inspectCandidate(readCandidate()), 0)
} else if (command === 'approve') {
  const repo = arg('--repo')
  const admission = arg('--admission-root')
  const outRoot = arg('--out-root')
  if (!repo || !admission || !outRoot) usage('--repo · --admission-root · --out-root 를 모두 명시해야 한다')
  const r = approveCandidate({
    candidate: readCandidate(), approver: arg('--approver'), at: arg('--at'), confirmCandidateHash: arg('--confirm-candidate-hash'),
    repoRoot: resolve(repo), admissionRoot: resolve(admission), outRoot: resolve(outRoot),
    researchDir: arg('--research-dir') ? resolve(arg('--research-dir')) : null,
  })
  out(r.ok ? { ok: true, written: r.written, path: r.path, sourceHash: r.sourceHash } : r, r.ok ? 0 : 1)
} else if (command === 'materialize') {
  const repo = arg('--repo')
  const admission = arg('--admission-root')
  const outRoot = arg('--out-root')
  if (!repo || !admission || !outRoot || !arg('--slug')) usage('--slug · --repo · --admission-root · --out-root 를 모두 명시해야 한다')
  const r = materializePlan({ repoRoot: resolve(repo), admissionRoot: resolve(admission), outRoot: resolve(outRoot), slug: arg('--slug') })
  out(r.ok ? { ok: true, written: r.written, path: r.path, day: r.day, articlePlanHash: r.row.articlePlanHash } : r, r.ok ? 0 : 1)
} else {
  usage(`모르는 명령이다: ${command}`)
}
