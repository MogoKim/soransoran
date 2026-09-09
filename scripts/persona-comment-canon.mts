#!/usr/bin/env tsx
/**
 * 채점 artifact **승격·점검** — 🔴 winner 를 정하지 않는다. DB write 0 · 네트워크 0
 *
 * 🔴 **무엇을 하는가.**
 *    유료 회차의 `summary/samples/key` 를 정본 옆 **공용 경로**로 원자적으로 옮긴다.
 *    그래야 개발 트리와 runtime worktree 가 같은 artifact SHA 를 본다.
 *
 * 🔴 **무엇을 하지 않는가.**
 *    winner 를 정하지 않는다. 확정 정본 파일(`persona-comment-model.json`)을 쓰지 않는다 —
 *    그것은 사람이 blind 표본을 채점한 뒤의 결정이고, 도구가 대신할 일이 아니다.
 *
 * 사용법
 *   npm run persona:comment-canon                     상태만 (아무것도 옮기지 않는다)
 *   npm run persona:comment-canon -- --promote=<runId> 🔴 그 회차를 공용 경로로 옮긴다
 */
import { ARTIFACT_ROOT, MODEL_CANON_FILE, readConfirmedSelection } from '../src/lib/persona-comment-provenance'
import {
  hashPromoted, listPromoted, promoteRun, promotionStatus,
} from './lib/persona-comment-canon-store'
import { EVAL_ROOT, listRuns } from './lib/persona-comment-eval-store'

const promoteArg = process.argv.find((a) => a.startsWith('--promote='))
const RUN_ID = promoteArg === undefined ? null : promoteArg.slice('--promote='.length)

console.log('\n══ 채점 artifact 승격·점검 (🔴 winner 를 정하지 않는다) ══\n')
console.log(`  유료 회차 저장소  ${EVAL_ROOT}`)
console.log(`  공용 정본 경로    ${ARTIFACT_ROOT}`)
console.log(`  확정 정본 파일    ${MODEL_CANON_FILE}`)

const local = listRuns()
const shared = listPromoted()
console.log(`\n  로컬 회차 ${local.length}건 ${local.length === 0 ? '(없다)' : `— ${local.join(' · ')}`}`)
console.log(`  공용 회차 ${shared.length}건 ${shared.length === 0 ? '(없다)' : `— ${shared.join(' · ')}`}`)

if (RUN_ID !== null) {
  const before = promotionStatus(RUN_ID)
  console.log(`\n  ── 승격 ${RUN_ID}`)
  console.log(`     로컬 ${before.inLocal === null ? '🔴 없음' : Object.entries(before.inLocal).map(([n, h]) => `${n}=${h}`).join(' · ')}`)
  console.log(`     공용 ${before.inShared === null ? '(아직 없음)' : Object.entries(before.inShared).map(([n, h]) => `${n}=${h}`).join(' · ')}`)
  const r = promoteRun({ runId: RUN_ID })
  if (!r.ok) {
    console.log(`\n  🔴 ${r.reason}\n`)
    process.exit(1)
  }
  console.log(`\n  ${r.already ? '🟡' : '✅'} ${r.reason}`)
  console.log(`     SHA ${Object.entries(r.hashes).map(([n, h]) => `${n}=${h}`).join(' · ')}`)
}

/**
 * 🔴 **정본이 가리키는 회차를 공용 경로에서 실제로 읽어 본다.**
 *    `readConfirmedSelection` 이 쓰는 것과 같은 경로다 — 여기서 통과하면 runtime 에서도 통과한다.
 */
const confirmed = readConfirmedSelection()
console.log(`\n  확정 상태  ${confirmed.selection?.status ?? '없음'} · winner ${confirmed.selection?.winner ?? '(없음)'}`)
console.log(`             ${confirmed.detail}`)
if (confirmed.canon !== null) {
  const h = hashPromoted(confirmed.canon.runId)
  console.log(`  공용 SHA   ${h === null ? '🔴 읽지 못했다' : Object.entries(h).map(([n, v]) => `${n}=${v}`).join(' · ')}`)
  console.log(`  정본 SHA   summary.json=${confirmed.canon.artifactSha.summary}`
    + ` · samples.json=${confirmed.canon.artifactSha.samples}`
    + ` · key.json=${confirmed.canon.artifactSha.key}`)
}

console.log('\n  🔴 이 명령은 winner 를 정하지 않았다 — 확정 정본 파일 미수정 · DB write 0\n')
process.exit(0)
