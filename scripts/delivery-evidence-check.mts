import assert from 'node:assert/strict'
import { deliveryEvidenceProblems, type DeliveryEvidence } from '../src/lib/delivery-evidence'

const base: DeliveryEvidence = {
  stage: 'OPERATING_PASS',
  changeSha: 'abcdef1',
  objective: '실제 운영 결과로 완료를 판정한다',
  acceptance: ['exact-head 검증', '자연 운영창 판정'],
  design: { reference: 'docs/operations/CURRENT-MILESTONE.md', counterexamples: ['로그만 있고 runtime SHA가 다름'], rollback: '직전 pin 복구' },
  code: { exactHead: 'abcdef1', clean: true, checks: [{ name: 'typecheck', passed: true }] },
  merge: { pr: 1, mainSha: '1234567', containsChangeSha: true },
  deployment: { expectedSha: '1234567', runtimeSha: '1234567', rollbackReady: true },
  operation: { stageDecisionId: 'decision-1', runtimeSha: '1234567', naturalWindow: true, verdict: 'PASS' },
}

const cases: Array<[string, DeliveryEvidence, string[]]> = [
  ['complete evidence passes', base, []],
  ['CODE_PASS rejects a different head', { ...base, stage: 'CODE_PASS', code: { ...base.code!, exactHead: '7654321' } }, ['CODE_HEAD_MISMATCH']],
  ['MERGED rejects an uncontained change', { ...base, stage: 'MERGED', merge: { ...base.merge!, containsChangeSha: false } }, ['CHANGE_NOT_IN_MAIN']],
  ['DEPLOYED rejects a stale runtime', { ...base, stage: 'DEPLOYED', deployment: { ...base.deployment!, runtimeSha: '7654321' } }, ['RUNTIME_SHA_MISMATCH']],
  ['OPERATING_PASS rejects a synthetic window', { ...base, operation: { ...base.operation!, naturalWindow: false } }, ['NATURAL_WINDOW_MISSING']],
  ['OPERATING_PASS rejects UNKNOWN', { ...base, operation: { ...base.operation!, verdict: 'UNKNOWN' } }, ['OPERATING_VERDICT_NOT_PASS']],
]

for (const [name, evidence, expected] of cases) {
  const actual = deliveryEvidenceProblems(evidence)
  for (const problem of expected) assert(actual.includes(problem), `${name}: missing ${problem}`)
  if (expected.length === 0) assert.deepEqual(actual, [], `${name}: ${actual.join(',')}`)
  process.stdout.write(`PASS ${name}\n`)
}

process.stdout.write(`delivery-evidence-check: ${cases.length} pass / 0 fail\n`)
