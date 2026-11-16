/**
 * 작업 완료 증거의 단방향 상태기계.
 *
 * 보고 문구가 상태를 올리지 않는다. 각 단계가 요구하는 실제 증거가 모두 있고,
 * 그 증거가 같은 change SHA를 가리킬 때만 다음 상태를 주장할 수 있다.
 */

export const DELIVERY_STAGES = [
  'PLANNED',
  'DESIGNED',
  'CODE_PASS',
  'MERGED',
  'DEPLOYED',
  'OPERATING_PASS',
] as const

export type DeliveryStage = (typeof DELIVERY_STAGES)[number]

export interface DeliveryEvidence {
  stage: DeliveryStage
  changeSha: string
  objective: string
  acceptance: string[]
  design?: {
    reference: string
    counterexamples: string[]
    rollback: string
  }
  code?: {
    exactHead: string
    clean: boolean
    checks: Array<{ name: string; passed: boolean }>
  }
  merge?: {
    pr: number
    mainSha: string
    containsChangeSha: boolean
  }
  deployment?: {
    expectedSha: string
    runtimeSha: string
    rollbackReady: boolean
  }
  operation?: {
    stageDecisionId: string
    runtimeSha: string
    naturalWindow: boolean
    verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  }
}

const SHA = /^[0-9a-f]{7,40}$/

function rank(stage: DeliveryStage): number {
  return DELIVERY_STAGES.indexOf(stage)
}

export function deliveryEvidenceProblems(evidence: DeliveryEvidence): string[] {
  const problems: string[] = []
  const atLeast = (stage: DeliveryStage) => rank(evidence.stage) >= rank(stage)

  if (!SHA.test(evidence.changeSha)) problems.push('CHANGE_SHA_INVALID')
  if (evidence.objective.trim() === '') problems.push('OBJECTIVE_MISSING')
  if (evidence.acceptance.length === 0 || evidence.acceptance.some((item) => item.trim() === '')) {
    problems.push('ACCEPTANCE_MISSING')
  }

  if (atLeast('DESIGNED')) {
    if (!evidence.design) problems.push('DESIGN_EVIDENCE_MISSING')
    else {
      if (evidence.design.reference.trim() === '') problems.push('DESIGN_REFERENCE_MISSING')
      if (evidence.design.counterexamples.length === 0) problems.push('COUNTEREXAMPLE_MISSING')
      if (evidence.design.rollback.trim() === '') problems.push('ROLLBACK_DESIGN_MISSING')
    }
  }

  if (atLeast('CODE_PASS')) {
    if (!evidence.code) problems.push('CODE_EVIDENCE_MISSING')
    else {
      if (evidence.code.exactHead !== evidence.changeSha) problems.push('CODE_HEAD_MISMATCH')
      if (!evidence.code.clean) problems.push('WORKTREE_DIRTY')
      if (evidence.code.checks.length === 0) problems.push('CHECKS_MISSING')
      if (evidence.code.checks.some((check) => !check.passed)) problems.push('CHECK_FAILED')
    }
  }

  if (atLeast('MERGED')) {
    if (!evidence.merge) problems.push('MERGE_EVIDENCE_MISSING')
    else {
      if (!Number.isInteger(evidence.merge.pr) || evidence.merge.pr <= 0) problems.push('PR_INVALID')
      if (!SHA.test(evidence.merge.mainSha)) problems.push('MAIN_SHA_INVALID')
      if (!evidence.merge.containsChangeSha) problems.push('CHANGE_NOT_IN_MAIN')
    }
  }

  if (atLeast('DEPLOYED')) {
    if (!evidence.deployment) problems.push('DEPLOYMENT_EVIDENCE_MISSING')
    else {
      if (evidence.deployment.expectedSha !== evidence.merge?.mainSha) problems.push('DEPLOY_EXPECTED_NOT_MAIN')
      if (evidence.deployment.runtimeSha !== evidence.deployment.expectedSha) problems.push('RUNTIME_SHA_MISMATCH')
      if (!evidence.deployment.rollbackReady) problems.push('ROLLBACK_NOT_READY')
    }
  }

  if (atLeast('OPERATING_PASS')) {
    if (!evidence.operation) problems.push('OPERATION_EVIDENCE_MISSING')
    else {
      if (evidence.operation.stageDecisionId.trim() === '') problems.push('STAGE_DECISION_MISSING')
      if (evidence.operation.runtimeSha !== evidence.deployment?.runtimeSha) problems.push('OPERATION_RUNTIME_MISMATCH')
      if (!evidence.operation.naturalWindow) problems.push('NATURAL_WINDOW_MISSING')
      if (evidence.operation.verdict !== 'PASS') problems.push('OPERATING_VERDICT_NOT_PASS')
    }
  }

  return [...new Set(problems)]
}

