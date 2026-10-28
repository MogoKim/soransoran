#!/usr/bin/env node
/**
 * ArticlePlan CLI — G8 admission 을 사람이 승인하는 ArticlePlan(source/3)으로 잇고, 승인 entry 로만 큐 행을 만든다.
 *
 *   prepare      읽기 전용. 지정한 slug 하나의 DRAFT 후보 JSON 을 stdout 으로 낸다. 파일을 쓰지 않는다. 큐 행을 요구하지 않는다.
 *                node scripts/magazine-direct-spec-source-authoring.mjs prepare --slug <slug> --as-of <KST> \
 *                  --repo <제품 루트> --admission-root <연구 루트(contract/g8-admission · m3-slug-manifest · m3-state)> [--research-dir <연구 루트>]
 *                개정: [--revise --supersedes-spec <sha256:…>] — 승인됐지만 큐에서 철회된 글만. 기존 승인을 옮긴 DRAFT 후보에
 *                  supersedes{운영 디스크 article-spec specHash · 기존 sourceHash} 를 싣고 publishAt 은 비운다. approve 가 기존 entry 를 CAS 로 교체한다.
 *                원고 보존형 안전 개정: [--safety-revise --supersedes-spec <sha256:…> --draft <draft.md>] — 큐에 있고 원고가 회수된 글만.
 *                  글별 주제 금지 패턴 · 새 publishAt 만 바꾼다. 원고 sha256 을 고정한다(--draft 는 읽기만 한다).
 *                  approve · materialize 도 --safety-revise --draft 를 **명시해야** 한다(후보 종류만으로 승인하지 않는다) — 다시 대조하고,
 *                  materialize 는 기존 행을 CAS 교체한다. 일반 후보에 --safety-revise 를 주면 거부한다.
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

/** 보존할 원고 — 읽기만 한다(운영 경로여도 쓰지 않는다) */
const readDraft = () => (arg('--draft') ? readFileSync(resolve(arg('--draft'))) : null)
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
  // 🔴 개정(--revise --supersedes-spec <운영 디스크 article-spec specHash>) — 승인됐지만 큐에서 철회된 글만
  const safety = argv.includes('--safety-revise')
  if (safety && argv.includes('--revise')) usage('--revise 와 --safety-revise 는 함께 쓰지 않는다 — 개정 종류를 하나만 고른다')
  if ((argv.includes('--revise') || safety) && !arg('--supersedes-spec')) usage('--revise · --safety-revise 는 --supersedes-spec <sha256:...> 가 필요하다')
  if (!argv.includes('--revise') && !safety && arg('--supersedes-spec')) usage('--supersedes-spec 은 --revise · --safety-revise 와 함께만 쓴다')
  if (safety && !arg('--draft')) usage('--safety-revise 는 --draft <보존할 draft.md> 가 필요하다')
  const r = prepareCandidate({ repoRoot: resolve(repo), admissionRoot: resolve(admission), slug: arg('--slug'), asOf: arg('--as-of'),
    researchDir: arg('--research-dir') ? resolve(arg('--research-dir')) : null,
    ...(argv.includes('--revise') ? { revise: { supersedesSpecHash: arg('--supersedes-spec') } } : {}),
    ...(safety ? { revise: { supersedesSpecHash: arg('--supersedes-spec'), kind: 'safety' }, draft: readDraft() } : {}) })
  out(r.ok ? r.candidate : r, r.ok ? 0 : 1)
} else if (command === 'inspect') {
  out(inspectCandidate(readCandidate()), 0)
} else if (command === 'approve') {
  const repo = arg('--repo')
  const admission = arg('--admission-root')
  const outRoot = arg('--out-root')
  if (!repo || !admission || !outRoot) usage('--repo · --admission-root · --out-root 를 모두 명시해야 한다')
  if (argv.includes('--safety-revise') && !arg('--draft')) usage('--safety-revise 는 --draft <보존할 draft.md> 가 필요하다')
  if (!argv.includes('--safety-revise') && arg('--draft')) usage('--draft 는 --safety-revise 와 함께만 쓴다')
  const r = approveCandidate({
    candidate: readCandidate(), approver: arg('--approver'), at: arg('--at'), confirmCandidateHash: arg('--confirm-candidate-hash'),
    repoRoot: resolve(repo), admissionRoot: resolve(admission), outRoot: resolve(outRoot),
    researchDir: arg('--research-dir') ? resolve(arg('--research-dir')) : null,
    safety: argv.includes('--safety-revise'), draft: readDraft(),
  })
  out(r.ok ? { ok: true, written: r.written, path: r.path, sourceHash: r.sourceHash, ...(r.revised ? { revised: r.revised } : {}) } : r, r.ok ? 0 : 1)
} else if (command === 'materialize') {
  const repo = arg('--repo')
  const admission = arg('--admission-root')
  const outRoot = arg('--out-root')
  if (!repo || !admission || !outRoot || !arg('--slug')) usage('--slug · --repo · --admission-root · --out-root 를 모두 명시해야 한다')
  if (argv.includes('--safety-revise') && !arg('--draft')) usage('--safety-revise 는 --draft <보존할 draft.md> 가 필요하다')
  const r = materializePlan({ repoRoot: resolve(repo), admissionRoot: resolve(admission), outRoot: resolve(outRoot), slug: arg('--slug'),
    ...(argv.includes('--safety-revise') ? { safety: true, draft: readDraft() } : {}) })
  out(r.ok ? { ok: true, written: r.written, concurrentWrite: r.concurrentWrite, path: r.path, day: r.day, articlePlanHash: r.row.articlePlanHash, supersedes: r.supersedes,
    ...(r.safetyRevision ? { safetyRevision: r.safetyRevision } : {}) } : r, r.ok ? 0 : 1)
} else {
  usage(`모르는 명령이다: ${command}`)
}
