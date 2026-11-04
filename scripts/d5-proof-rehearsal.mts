#!/usr/bin/env tsx
/**
 * 🔴 **D5 proof-day 리허설 — 2026-10-16 14:15/14:47 shape 재현 (DB 0 · 네트워크 0 · 공급 러너 0)**
 *
 *    npm run d5:rehearsal
 *
 * 🔴 **왜 생겼나 (운영 반례 2026-10-16).**
 *    14:15 자연 공급 회차: SEED 10 · provider calls 24 · AUTO_ADOPT 4 · HOLD 6 · loaded 3 · cut 1.
 *    적재 3건 중 2건은 `SEMANTIC_DROPPED_FROM_SOURCE:2` 로 autoReady 받지 못했고, 1건이 warning-free 발행.
 *    같은 회차 Google draftGen 1건이 `usageUnknown` 으로 끝났다(양수 reservedUsd · 뒤에 별도 attemptId 재시도 정산).
 *    14:40 publishable stock = 0 · 14:47 당시 D5 evidence는 `PUBLISH_NOT_AUTO_READY,AUDIT_DEFECT` 로 FAIL.
 *
 *    🔴 **보정 전 shape**: canon §3.4 가 증명일 미상 0 을 요구하는데, `judgeCost` 가 미상을 FAIL 로 올리지 않아
 *       stage-evidence 가 `SUPPLY_USAGE_UNKNOWN` 조차 올리지 않았다 — AUDIT_DEFECT 아래 가려짐.
 *
 * 🔴 **이 리허설이 증명하는 것 (production-shaped fixture).**
 *    ① **옛 결함 입력 재현**(비용 증거를 만들지 못한 호출): 현재 evidence는
 *       FAIL [PUBLISH_NOT_AUTO_READY,AUDIT_DEFECT,COST_UNKNOWN]이다. 옛 코드는 이 입력에서 비용 미상 신호를
 *       건너뛰었지만, 현재 계약은 필수 nullable 입력이며 `null`을 `COST_UNKNOWN`으로 닫는다.
 *    ② **시행일 전 보정 경로**(`legacyUsageUnknownRequests = relevantUsageUnknownCount(ledger)`):
 *       evidence FAIL [PUBLISH_NOT_AUTO_READY,AUDIT_DEFECT,SUPPLY_USAGE_UNKNOWN] — 과거 날짜는 당시의
 *       하루 전체 미상 0 계약을 그대로 적용해 소급 승격하지 않는다.
 *    ③ **보정 후 + 깨끗한 날**(5/5 자동 발행 · 감사 깨끗 · 미상 0 · 상한 안):
 *       evidence PASS — D5 운영 PASS 가 열린다.
 *    ④ **시행일 전 + 미상만 1건 남은 가상의 "clean later" shape**(5/5 · 감사 깨끗 · 그러나 미상 1):
 *       evidence FAIL [SUPPLY_USAGE_UNKNOWN] — 옛 날짜의 "미상 0" 계약을 지킨다.
 *    ⑤ **시행일 이후 공용 envelope**: clean·bounded는 PASS, 귀속 불완전은 UNKNOWN이다.
 *
 * 🔴 **isolated 범위.** DB · 공급 러너 · 발행 러너 · 댓글 러너 · provider · launchd · stage/env/READY write 0.
 *    오직 순수 함수(`judgeStageEvidence` · `relevantUsageUnknownCount`)만 지나며,
 *    장부 entries 와 사실 묶음(`StageEvidenceFacts`)은 코드가 손으로 짓는 production-shaped fixture 다.
 */
import { tallyOf, relevantUsageUnknownCount, type LedgerEntry } from '../src/lib/llm-ledger'
import { judgeCost } from '../src/lib/ops-status'
import { personaCommentCapFor } from '../src/lib/stage-evidence'
import {
  judgeStageEvidence, evidenceReasonOf,
  type EvidencePost, type EvidenceSideSignals, type StageEvidenceFacts,
} from '../src/lib/stage-evidence'
import { DECISION_WRITER } from '../src/lib/stage-decision-contract'
import { AUTO_FIRST_COMMENT_WINDOW_MS } from '../src/lib/persona-comment-auto-lane'

// ── 운영 실측 그대로 ──
const PROOF = '2026-10-16'
const T0 = Date.parse(`${PROOF}T08:00:00+09:00`)
const HOUR = 3600_000
const MIN = 60_000

// ① 10-16 14:15 자연 공급 회차의 공급 장부 — Google draftGen timeout 1건 usageUnknown + 뒤에 별도 attemptId 재시도 정산
const SUPPLY_LEDGER_14_15: readonly LedgerEntry[] = [
  // 24 provider calls 중 대표 몇 건 (판정은 수가 아니라 모양으로 한다)
  {
    runId: '20261016-051504', stage: 'draftGen', attemptId: 'a-draft-timeout',
    requestNo: 7, provider: 'google', apiModelId: 'gemini-2.5-flash', model: 'flash',
    status: 'usageUnknown', blockCode: null,
    countedInputTokens: 1800, maxOutputTokens: 1024, reservedUsd: 0.006152,
    inputTokens: null, outputTokens: null, cacheWriteTokens: null, cacheReadTokens: null,
    usageKeys: [], settledUsd: null, pricingVersion: 'google-v1',
    startedAt: `${PROOF}T14:15:30+09:00`, endedAt: `${PROOF}T14:16:00+09:00`,
    errorCode: 'TIMEOUT', runKind: 'scheduled', runSlot: `${PROOF} 14:15`,
  },
  {
    runId: '20261016-051504', stage: 'draftGen', attemptId: 'a-draft-retry',
    requestNo: 8, provider: 'google', apiModelId: 'gemini-2.5-flash', model: 'flash',
    status: 'settled', blockCode: null,
    countedInputTokens: 1800, maxOutputTokens: 1024, reservedUsd: 0.006152,
    inputTokens: 1800, outputTokens: 320, cacheWriteTokens: 0, cacheReadTokens: 0,
    usageKeys: ['inputTokens', 'outputTokens'], settledUsd: 0.0049, pricingVersion: 'google-v1',
    startedAt: `${PROOF}T14:40:00+09:00`, endedAt: `${PROOF}T14:40:12+09:00`,
    errorCode: null, runKind: 'scheduled', runSlot: `${PROOF} 14:15`,
  },
  // 정상 정산 몇 건
  {
    runId: '20261016-051504', stage: 'judge', attemptId: 'a-j1', requestNo: 0,
    provider: 'anthropic', apiModelId: 'claude-haiku', model: 'haiku',
    status: 'settled', blockCode: null,
    countedInputTokens: 2500, maxOutputTokens: 256, reservedUsd: 0.0012,
    inputTokens: 2500, outputTokens: 180, cacheWriteTokens: 0, cacheReadTokens: 0,
    usageKeys: ['inputTokens', 'outputTokens'], settledUsd: 0.0010, pricingVersion: 'anthropic-v1',
    startedAt: `${PROOF}T14:15:40+09:00`, endedAt: `${PROOF}T14:15:48+09:00`,
    errorCode: null, runKind: 'scheduled', runSlot: `${PROOF} 14:15`,
  },
]

// ② 10-16 14:47 D5 evidence facts (production shape) — AUDIT_DEFECT + published 3/5
const authors = ['persona-A', 'persona-B', 'persona-C']
const PROOF_POSTS_3: readonly EvidencePost[] = authors.map((pid, i) => ({
  postId: `p-${i}`, queueId: `q-${i}`,
  publishedAtMs: T0 + i * 2 * HOUR, unattended: true, queueRows: 1, publishLogs: 1,
  authorPersonaId: pid, decider: 'auto', release: 'STAMPED_ELIGIBLE',
  personaComments: [{
    personaId: `c-${i}`, createdAtMs: T0 + i * 2 * HOUR + 12 * MIN, topLevel: true, provenance: 'auto' as const,
  }],
}))
const FACTS_14_47: StageEvidenceFacts = {
  kstDate: PROOF, stage: 'd5',
  decision: { kstDate: PROOF, state: 'TRIAL', release: 'd5', decidedBy: DECISION_WRITER },
  posts: PROOF_POSTS_3,
  orphanPublishLogs: 0, unloggedPublishes: 0,
  commentCapPerPost: personaCommentCapFor('bootstrap-auto'),
  audits: {
    rows: [{ postId: 'p-0', queueId: 'q-0', judged: true, defectYes: true, retryable: false, overdue: false }],
  },
}

// ③ 5/5 깨끗한 "fix 가 성립할 때" fixture
const authors5 = ['pa','pb','pc','pd','pe']
const CLEAN_5: readonly EvidencePost[] = authors5.map((pid, i) => ({
  postId: `cp-${i}`, queueId: `cq-${i}`,
  publishedAtMs: T0 + i * HOUR, unattended: true, queueRows: 1, publishLogs: 1,
  authorPersonaId: pid, decider: 'auto', release: 'STAMPED_ELIGIBLE',
  personaComments: [{
    personaId: `cc-${i}`, createdAtMs: T0 + i * HOUR + 10 * MIN, topLevel: true, provenance: 'auto' as const,
  }],
}))
const FACTS_CLEAN: StageEvidenceFacts = {
  kstDate: PROOF, stage: 'd5',
  decision: { kstDate: PROOF, state: 'TRIAL', release: 'd5', decidedBy: DECISION_WRITER },
  posts: CLEAN_5, orphanPublishLogs: 0, unloggedPublishes: 0,
  commentCapPerPost: personaCommentCapFor('bootstrap-auto'),
  audits: {
    rows: Array.from({ length: 1 }, (_, i) => ({
      postId: `cp-${i}`, queueId: `cq-${i}`, judged: true, defectYes: false, retryable: false, overdue: false,
    })),
  },
}

// 비용 side — 상한은 공급 $0.50 가정(승인 천장), 미상이 있어도 health 는 ok (judgeCost 는 미상 안 봄 — 그래서 보정 전 재현)
const supplyTally = tallyOf(SUPPLY_LEDGER_14_15)
const costOk = judgeCost({
  uses: true, tally: supplyTally, ledgerError: null, settleHold: null, capUsd: 0.5,
})
const legacyCostEvidence = (unknown: number) => ({
  legacyUsageUnknownRequests: unknown,
  wholeDayCriticalHealth: 'ok' as const,
  envelope: { settledRequests: 20, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsd: 0.08, budgetUsd: 0.5 },
})
const sideWithoutFix: EvidenceSideSignals = {
  cost: [
    { lane: 'supply', name: '공급 장부', health: costOk.health },
    { lane: 'comment', name: '댓글 장부', health: 'ok' },
    { lane: 'audit', name: '감사 장부', health: 'ok' },
  ],
  errors: 'ok',
  // 옛 호출 재현. 현재 계약은 누락을 조용히 건너뛰지 않고 COST_UNKNOWN으로 닫는다.
  supplyCostEvidence: null,
}
const relevantUnknown = relevantUsageUnknownCount(SUPPLY_LEDGER_14_15)
const sideWithFix: EvidenceSideSignals = {
  ...sideWithoutFix,
  supplyCostEvidence: legacyCostEvidence(relevantUnknown),
}

const PRINT = (label: string, v: ReturnType<typeof judgeStageEvidence>): void => {
  console.log(`   ▸ ${label}  ${evidenceReasonOf(v)}`)
}

console.log('\n══ D5 proof-day 리허설 — 2026-10-16 shape (DB 0 · 네트워크 0 · 공급 러너 0) ══\n')
console.log(`① 14:15 공급 장부 — relevantUsageUnknownCount = ${relevantUnknown}`)
console.log(`   공급 tally: settled=$${supplyTally.settledUsd.toFixed(4)} · 미상 예약 $${supplyTally.usageUnknownUsd.toFixed(6)} (= 1건 timeout) · 상한 $0.5000`)
console.log(`   judgeCost 결과: health=${costOk.health} — 🔴 미상을 보지 않는다(그래서 보정이 필요했다)`)

console.log('\n② 14:47 D5 evidence — 10-16 shape (published 3/5 · 감사 결함 1건)\n')
const beforeFix = judgeStageEvidence(PROOF, 'd5', FACTS_14_47, sideWithoutFix)
PRINT('보정 전 (옛 호출)       ', beforeFix)
const afterFix = judgeStageEvidence(PROOF, 'd5', FACTS_14_47, sideWithFix)
PRINT('보정 후 (지금 호출)      ', afterFix)
if (beforeFix.codes.includes('SUPPLY_USAGE_UNKNOWN')) {
  console.error('🔴 FAIL — 보정 전에도 SUPPLY_USAGE_UNKNOWN 가 올라왔다 (옛 재현이 아니다)'); process.exit(1)
}
if (!afterFix.codes.includes('SUPPLY_USAGE_UNKNOWN')) {
  console.error('🔴 FAIL — 보정 후에 SUPPLY_USAGE_UNKNOWN 가 올라오지 않았다 (B 미작동)'); process.exit(1)
}
if (afterFix.verdict !== 'FAIL') {
  console.error(`🔴 FAIL — 보정 후 verdict 가 FAIL 이 아니다 (${afterFix.verdict})`); process.exit(1)
}
console.log('   ✅ 보정 전 shape: SUPPLY_USAGE_UNKNOWN 미출현 · AUDIT_DEFECT/COST_UNKNOWN 아래 가려짐 (옛 10-16 14:47 실측 재현)')
console.log('   ✅ 보정 후 shape: SUPPLY_USAGE_UNKNOWN 함께 올라옴 — §3.4 "증명일 미상 0" 이 평가됨')

console.log('\n③ 5/5 깨끗한 shape — 미상 0 · 감사 깨끗 · 상한 안\n')
const cleanLedger: readonly LedgerEntry[] = SUPPLY_LEDGER_14_15.filter((e) => e.status === 'settled')
const cleanCost = judgeCost({
  uses: true, tally: tallyOf(cleanLedger), ledgerError: null, settleHold: null, capUsd: 0.5,
})
const cleanSide: EvidenceSideSignals = {
  cost: [
    { lane: 'supply', name: '공급 장부', health: cleanCost.health },
    { lane: 'comment', name: '댓글 장부', health: 'ok' },
    { lane: 'audit', name: '감사 장부', health: 'ok' },
  ],
  errors: 'ok', supplyCostEvidence: legacyCostEvidence(relevantUsageUnknownCount(cleanLedger)),
}
const cleanV = judgeStageEvidence(PROOF, 'd5', FACTS_CLEAN, cleanSide)
PRINT('보정 후 · 깨끗한 shape ', cleanV)
if (cleanV.verdict !== 'PASS') {
  console.error(`🔴 FAIL — 깨끗한 shape 는 PASS 여야 한다 (${cleanV.verdict} ${cleanV.codes.join(',')})`); process.exit(1)
}
console.log('   ✅ 5/5 자동 발행 · 감사 깨끗 · 미상 0 → D5 운영 PASS')

console.log('\n④ 가상의 "clean later" shape — 5/5 자동 발행 · 감사 깨끗 · 그러나 미상 1건 (경계 반례)\n')
const edgeSide: EvidenceSideSignals = { ...cleanSide, supplyCostEvidence: legacyCostEvidence(1) }
const edgeV = judgeStageEvidence(PROOF, 'd5', FACTS_CLEAN, edgeSide)
PRINT('보정 후 · 미상 1건 남음  ', edgeV)
if (edgeV.verdict !== 'FAIL' || !edgeV.codes.includes('SUPPLY_USAGE_UNKNOWN')) {
  console.error('🔴 FAIL — 미상 1건이면 다른 모든 조건이 깨끗해도 FAIL 이어야 한다'); process.exit(1)
}
console.log('   ✅ §3.4 "증명일 미상 0" 가 지켜진다 — 다른 축이 깨끗해도 미상이 FAIL 을 만든다')

console.log('\n⑤ 시행일 이후 공용 비용 envelope — clean · bounded · 귀속 불완전\n')
const EFFECTIVE = '2026-11-05'
const effectiveFacts: StageEvidenceFacts = {
  ...FACTS_CLEAN,
  kstDate: EFFECTIVE,
  decision: { kstDate: EFFECTIVE, state: 'TRIAL', release: 'd5', decidedBy: DECISION_WRITER },
}
const effectiveSide = (
  envelope: NonNullable<EvidenceSideSignals['supplyCostEvidence']>['envelope'],
): EvidenceSideSignals => ({
  ...cleanSide,
  supplyCostEvidence: { legacyUsageUnknownRequests: 99, wholeDayCriticalHealth: 'ok', envelope },
})
const effectiveClean = judgeStageEvidence(EFFECTIVE, 'd5', effectiveFacts, effectiveSide({
  settledRequests: 1, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsd: 0.004, budgetUsd: 0.5,
}))
const effectiveBounded = judgeStageEvidence(EFFECTIVE, 'd5', effectiveFacts, effectiveSide({
  settledRequests: 20, usageUnknownRequests: 1, overrunRequests: 0, ineligibleRequests: 0, riskUsd: 0.09, budgetUsd: 0.5,
}))
const effectiveBroken = judgeStageEvidence(EFFECTIVE, 'd5', effectiveFacts, effectiveSide({
  settledRequests: 20, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 1, riskUsd: 0.08, budgetUsd: 0.5,
}))
PRINT('시행일 이후 · clean       ', effectiveClean)
PRINT('시행일 이후 · bounded     ', effectiveBounded)
PRINT('시행일 이후 · 귀속 불완전 ', effectiveBroken)
if (effectiveClean.verdict !== 'PASS' || effectiveBounded.verdict !== 'PASS') {
  console.error('🔴 FAIL — 시행일 이후 clean·bounded envelope가 PASS를 열지 못했다'); process.exit(1)
}
if (effectiveBroken.verdict !== 'UNKNOWN' || !effectiveBroken.codes.includes('COST_UNKNOWN')) {
  console.error('🔴 FAIL — 시행일 이후 귀속 불완전을 UNKNOWN으로 닫지 못했다'); process.exit(1)
}
console.log('   ✅ 11-05 이후 경로가 옛 SUPPLY_USAGE_UNKNOWN 상한이 아니라 공용 envelope 판정을 쓴다')

console.log('\n⑥ 자연 공급 경계 — 현재 계약\n')
console.log('   scripts/supply-process.mts 는 자연 회차마다 현재 수요와 유료 상한 안에서 workset-v4 한 벌을 처리한다.')
console.log('   그 회차에 선택되지 않은 적격 원천은 버리거나 수동 보충하지 않고 다음 자연 공급 회차의 후보로 남긴다.')
console.log('   같은 회차에서 provider 호출을 재귀적으로 반복하는 별도 복구 owner 는 두지 않는다. 부족분은 이후')
console.log('   자연 회차에서 다시 계산하며, 하루 비용·품질·감사 계약을 그대로 적용한다.')
console.log('   이 리허설은 공급량을 조작하지 않고 비용 증거와 운영 판정 경계를 검증한다. 공급량 회귀는')
console.log('   supply JIT/workset 전용 검사와 자연 운영 증거에서 별도로 확인한다.')

console.log('\n🟢 모든 검증 통과 — DB 0 · 네트워크 0 · 공급 러너 0 · provider 0 · stage/env/READY write 0\n')
process.exit(0)
