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
 *    14:40 publishable stock = 0 · 14:47 D5 evidence = `PUBLISH_NOT_AUTO_READY,AUDIT_DEFECT` 로 FAIL.
 *
 *    🔴 **보정 전 shape**: canon §3.4 가 증명일 미상 0 을 요구하는데, `judgeCost` 가 미상을 FAIL 로 올리지 않아
 *       stage-evidence 가 `SUPPLY_USAGE_UNKNOWN` 조차 올리지 않았다 — AUDIT_DEFECT 아래 가려짐.
 *
 * 🔴 **이 리허설이 증명하는 것 (production-shaped fixture).**
 *    ① **보정 전**(옛 호출 경로 · side.supplyUsageUnknown undefined): evidence FAIL [PUBLISH_NOT_AUTO_READY,AUDIT_DEFECT]
 *       — 미상 신호가 올라오지 않는다(옛 코드 재현).
 *    ② **보정 후**(지금 호출 경로 · supplyUsageUnknown = relevantUsageUnknownCount(ledger)):
 *       evidence FAIL [PUBLISH_NOT_AUTO_READY,AUDIT_DEFECT,SUPPLY_USAGE_UNKNOWN] — 미상 신호가 함께 올라온다.
 *    ③ **보정 후 + 깨끗한 날**(5/5 자동 발행 · 감사 깨끗 · 미상 0 · 상한 안):
 *       evidence PASS — D5 운영 PASS 가 열린다.
 *    ④ **보정 후 + 미상만 1건 남은 가상의 "clean later" shape**(5/5 · 감사 깨끗 · 그러나 미상 1):
 *       evidence FAIL [SUPPLY_USAGE_UNKNOWN] — §3.4 가 요구하는 "미상 0" 을 지킨다.
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
const sideWithoutFix: EvidenceSideSignals = {
  cost: [
    { name: '공급 장부', health: costOk.health },
    { name: '댓글 장부', health: 'ok' },
    { name: '감사 장부', health: 'ok' },
  ],
  errors: 'ok',
  // 🔴 보정 전 — 호출부가 supplyUsageUnknown 을 안 넘김 (옛 코드 재현). undefined → stage-evidence 가 체크 skip
}
const relevantUnknown = relevantUsageUnknownCount(SUPPLY_LEDGER_14_15)
const sideWithFix: EvidenceSideSignals = {
  ...sideWithoutFix,
  supplyUsageUnknown: relevantUnknown,  // 🔴 지금 코드 — stage-controller.evidenceFor 가 명시적으로 넘김
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
console.log('   ✅ 보정 전 shape: SUPPLY_USAGE_UNKNOWN 미출현 · AUDIT_DEFECT 로만 FAIL (옛 10-16 14:47 실측 재현)')
console.log('   ✅ 보정 후 shape: SUPPLY_USAGE_UNKNOWN 함께 올라옴 — §3.4 "증명일 미상 0" 이 평가됨')

console.log('\n③ 5/5 깨끗한 shape — 미상 0 · 감사 깨끗 · 상한 안\n')
const cleanLedger: readonly LedgerEntry[] = SUPPLY_LEDGER_14_15.filter((e) => e.status === 'settled')
const cleanCost = judgeCost({
  uses: true, tally: tallyOf(cleanLedger), ledgerError: null, settleHold: null, capUsd: 0.5,
})
const cleanSide: EvidenceSideSignals = {
  cost: [
    { name: '공급 장부', health: cleanCost.health },
    { name: '댓글 장부', health: 'ok' }, { name: '감사 장부', health: 'ok' },
  ],
  errors: 'ok', supplyUsageUnknown: relevantUsageUnknownCount(cleanLedger),
}
const cleanV = judgeStageEvidence(PROOF, 'd5', FACTS_CLEAN, cleanSide)
PRINT('보정 후 · 깨끗한 shape ', cleanV)
if (cleanV.verdict !== 'PASS') {
  console.error(`🔴 FAIL — 깨끗한 shape 는 PASS 여야 한다 (${cleanV.verdict} ${cleanV.codes.join(',')})`); process.exit(1)
}
console.log('   ✅ 5/5 자동 발행 · 감사 깨끗 · 미상 0 → D5 운영 PASS')

console.log('\n④ 가상의 "clean later" shape — 5/5 자동 발행 · 감사 깨끗 · 그러나 미상 1건 (경계 반례)\n')
const edgeSide: EvidenceSideSignals = { ...cleanSide, supplyUsageUnknown: 1 }
const edgeV = judgeStageEvidence(PROOF, 'd5', FACTS_CLEAN, edgeSide)
PRINT('보정 후 · 미상 1건 남음  ', edgeV)
if (edgeV.verdict !== 'FAIL' || !edgeV.codes.includes('SUPPLY_USAGE_UNKNOWN')) {
  console.error('🔴 FAIL — 미상 1건이면 다른 모든 조건이 깨끗해도 FAIL 이어야 한다'); process.exit(1)
}
console.log('   ✅ §3.4 "증명일 미상 0" 가 지켜진다 — 다른 축이 깨끗해도 미상이 FAIL 을 만든다')

console.log('\n⑤ bounded JIT replacement — 후속 자식 커밋 범위\n')
console.log('   현재 scripts/supply-process.mts 는 한 workset(workset-v4)만 뽑아 judge→draft→fill 세로 흐름을')
console.log('   **한 번** 돌린다. SEED 가 소진되면 cap 30 · 일 예산 안이어도 그 회차의 추가 유료 호출은 없다.')
console.log('   10-16 14:15 shape: SEED 10 · AUTO_ADOPT 4 · loaded 3 · warning-free 1 · publishable stock 14:40=0.')
console.log('   🔴 bounded replacement(수요 미달 시 unused eligible sources/Personas 로 cap 30 · 일 예산 안에서')
console.log('      결정적 재선택) 는 scripts/supply-process.mts 와 src/lib/supply-workset.ts 에서 보강한다 —')
console.log('      두 파일은 현재 quality-contract.fingerprint.json 대상이 아니므로 품질 계약 digest 를 바꾸지')
console.log('      않고 추가할 수 있다. 이 커밋 범위에는 포함하지 않는다(후속 자식 커밋에서 공급 계약을 별도 보강).')
console.log('   이 커밋의 B 보정이 proof-day FAIL 신호를 캐노니컬하게 올려 D5 운영 PASS 조건이 올바르게 평가되는 것이')
console.log('   선행조건이다 — shortfall 재공급 설계와 테스트는 그 위에 얹는다.')

console.log('\n🟢 모든 검증 통과 — DB 0 · 네트워크 0 · 공급 러너 0 · provider 0 · stage/env/READY write 0\n')
process.exit(0)
