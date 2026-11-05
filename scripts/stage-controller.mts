#!/usr/bin/env tsx
/**
 * 🔴 **하루 단계 controller — 한 사다리 + 운영 신호 브레이크 → StageDecision 저장**
 *
 *   npm run stage:controller              dry-run — 결정을 계산해 보여 준다. DB write 0
 *   npm run stage:controller -- --apply   저장 — 🔴 정본 env 에 STAGE_CONTROLLER_ENABLED=on 일 때만
 *   npm run stage:controller -- --json    기계가 읽는 값
 *   npm run stage:controller -- --evidence-date=YYYY-MM-DD
 *                                         🔴 read-only — 그날의 운영 증거 판정만 보여 준다(결정 계산·저장 0)
 *
 * 🔴 **쓰는 곳은 하나다** — `ensureStageDecision` → `createStageDecision`(create 뿐 · 덮어쓰기 0).
 *
 * 🔴 **fail-closed = 지금 공개 단계를 지킨다.**
 *    · 전날 결정이 깨짐·읽기 예외 → 계산·저장 0 · exit 1 (다음 예약이 다시 읽는다 · `resolvePreviousAuthority`)
 *    · 전날 결정이 없음        → 이틀 전 행 하나로 권한만 잇는 HOLD(`bridgeHoldOf`) · 둘 다 없으면 첫 시작 d1
 *    · 재고를 못 읽음          → `inputFailureHoldOf` (전날 행이 없으면 d1)
 *    · 운영 신호를 모름        → 시험·증명일만 막는다
 *    · DB 자체에 못 닿음       → 아무것도 쓰지 못한다 · exit 1 (consumer 는 정본 fallback)
 *
 * 🔴 **한 사다리 · 한 관문** (2026-09-30 · source-slot-v1).
 *    · 시험 대상 = `trialPlanOf(전날 결정, 전날 운영 증거[조항 ⑦ 포함], 브레이크 날을 건넌 계획)`
 *    · 그 대상의 다음 증명일(오늘) 전체 슬롯 기준 preflight(`judgeNextPreflight` · D3~D100 한 함수) PASS 여야 연다
 *    · 🔴 계획이 없는 날은 평상일(0..Dn · 증명일 env 없음)이다 — 지금 단계 다음 칸 preflight 가 PASS 일 때만 REPROVE(2026-10-11)
 *    · 🔴 **지운 입력** — 14일 준비도(`stageVerdicts`) · 하루 시뮬레이션(`judgeOneDayCanary`) · 지속 승격
 *      (`d100:readiness` 자식 프로세스 · `judgePromotion`) · env 공개 단계(`SORAN_RELEASE_STAGE`) · env 천장
 *      (`SORAN_CAPACITY_STAGE` · `resolveCeiling`). 현재 단계의 입력원은 StageDecision 하나다.
 *    · 🔴 Persona 는 계약 유효 수(Persona 4상태 정본)만 받는다 — 하한 미달이면 FAIL, 읽기 실패면 UNKNOWN. 둘 다 시험을 열지 않는다
 *      (2026-09-30 실측 0 → D1→D3 부터 막힌다).
 */
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'

import { profileOf, releaseCapsOf, resolveRuntimeStage, type RuntimeStage } from '../src/lib/scale-profile'
import { kstDateString } from '../src/lib/release-canary'
import { isCalendarDate, nextStage, DECISION_WRITER, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import { ensureStageDecision, controllerEnabled, CONTROLLER_ENV } from '../src/lib/stage-decision-store'
import { readStageDecision, stageDecisionIo } from '../src/lib/stage-decision-repo'
import {
  decideStage, inputFailureHoldOf, authorityRowOf, leaseSafeHoldOf, validateForToday, qualitySignalOf, costSignalOf, errorSignalOf,
  sustainedReleaseOf, resolvePreviousAuthority, bridgeHoldOf,
  type HealthSignal, type ControllerResult, type DecisionRead,
} from '../src/lib/stage-controller'
import { unresolvedDefectCount, missingAutoPostCount } from '../src/lib/auto-ready-repo'
import { auditAwareGate, overdueAuditCount, retryableFailureCount } from '../src/lib/auto-ready-audit-store'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { observeJob, proofDaySupplyHealth, publishFailing, readProcessRuns, supplyFailing, SUPPLY_DATA_DIR } from './lib/runner-health.mjs'
import { PUBLISH_RUN_MAX_AGE_MS, readPublishRunRecord } from './lib/publish-run-record.mjs'
import { fillDbConnection, readCostSignals, readEnvKeys } from './lib/ops-signals.mjs'
import {
  judgeStageEvidence, trialPlanOf, carriedTrialPlanFor, evidenceReasonOf,
  type StageEvidenceVerdict, type StageEvidenceFacts, type EvidenceSideSignals, type TrialPlan,
} from '../src/lib/stage-evidence'
import { readStageEvidenceFacts } from '../src/lib/stage-evidence-repo'
import { personaCommentCapFor } from '../src/lib/stage-evidence'
import { COMMENT_STAGE_ENV, readCommentStage } from '../src/lib/persona-comment-stage'
import { judgeNextPreflight, slotTimesOn, type PreflightVerdict } from '../src/lib/stage-ladder-generic'
import { readPreflightFacts, PREFLIGHT_ENV_KEYS, RUNNER_GRID } from './lib/stage-preflight-facts.mjs'
import { readContractValidPersonas } from './lib/persona-reserve-facts.mjs'
import { probeSupplyLease } from './lib/supply-lease.mjs'
import { stageControllerLeaseDisposition } from './lib/ops-loop-templates'
import { loaderArgs } from './lib/runner-lease.mjs'
import {
  claimStageRecoveryLaunch, createStageRecoveryIntent, readStageRecoveryIntent,
  readStageRecoverySupplyReceipt, stageRecoveryIntentCoversPlan, stageRecoveryLogPath, updateStageRecoveryIntent,
  type StageRecoveryIntent,
} from './lib/stage-recovery-intent.mjs'
import {
  activeRecoveryDecisionDisposition, isFinalRecoveryControllerSlot, planActiveRecovery,
  retryFinalStageDecisionWrite,
} from '../src/lib/stage-active-recovery'
import { readStageRecoverySourceReceipt } from './lib/stage-recovery-source-receipt.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const JSON_OUT = argv.includes('--json')
/** 🔴 read-only 증거 조회 — 이 모드는 결정을 계산하지도 저장하지도 않는다 */
const EVIDENCE_DATE = argv.find((a) => a.startsWith('--evidence-date='))?.slice('--evidence-date='.length) ?? null
const NOW = new Date()
const TODAY = kstDateString(NOW)

const log = (s: string): void => { if (!JSON_OUT) console.log(s) }

function launchActiveRecovery(intent: StageRecoveryIntent): Promise<boolean> {
  return new Promise((resolveLaunch) => {
    let settled = false
    let logFd: number | null = null
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (logFd !== null) { closeSync(logFd); logFd = null }
      resolveLaunch(ok)
    }
    const timer = setTimeout(() => finish(false), 5_000)
    timer.unref()
    try {
      const script = fileURLToPath(new URL('./stage-active-recovery.mts', import.meta.url))
      logFd = openSync(stageRecoveryLogPath(intent.kstDate), 'a', 0o600)
      const child = spawn(process.execPath, [
        ...loaderArgs(), script,
        `--stage-recovery-date=${intent.kstDate}`,
        `--stage-recovery-nonce=${intent.nonce}`,
        `--stage-recovery-deficit=${intent.deficit}`,
      ], { cwd: process.cwd(), env: process.env, detached: true, stdio: ['ignore', logFd, logFd] })
      child.once('error', () => finish(false))
      child.once('spawn', () => { child.unref(); finish(true) })
    } catch { finish(false) }
  })
}

/**
 * 🔴 **KST 날짜 D · 단계 S 의 운영 증거 판정** — 읽기만 한다.
 *    어느 것이든 못 읽으면 그 칸은 모름이다 — PASS 가 되지 않는다(fail-closed = 지금 단계에 머문다).
 */
async function evidenceFor(prisma: PrismaClient, i: {
  kstDate: string; stage: RuntimeStage; decision: ValidatedStageDecision | null
}): Promise<StageEvidenceVerdict> {
  let facts: StageEvidenceFacts | null = null
  try {
    const ce = readEnvKeys([COMMENT_STAGE_ENV])
    const commentCapPerPost = ce.ok ? personaCommentCapFor(readCommentStage(ce.values).stage) : null
    facts = await readStageEvidenceFacts(prisma, {
      kstDate: i.kstDate, stage: i.stage, decision: i.decision, now: NOW, commentCapPerPost,
    })
  } catch (e) { log(`   ⬚ 운영 증거를 읽지 못했다 — ${(e as Error).name} (모름 = PASS 아님)`) }
  let side: EvidenceSideSignals | null = null
  try {
    const c = readCostSignals(new Date(`${i.kstDate}T12:00:00+09:00`))
    side = {
      cost: [
        { lane: 'supply', name: '공급 장부', health: c.supplyLedger.health },
        { lane: 'comment', name: '댓글 장부', health: c.commentLedger.health },
        { lane: 'audit', name: '감사 장부', health: c.auditLedger.health },
      ],
      // 🔴 과거 증명은 그날의 불변 공급 회차 기록만 쓴다. 지금 launchd health 는 오늘 브레이크에만 들어간다.
      errors: proofDaySupplyHealth(readProcessRuns(), i.kstDate),
      // §3.4 — 시행일 전 옛 판정과 시행일부터의 자연 proof 슬롯 비용 envelope를 한 입력으로 넘긴다.
      supplyCostEvidence: c.supplyCostEvidence,
    }
  } catch (e) { log(`   ⬚ 그날 장부를 읽지 못했다 — ${(e as Error).name} (모름 = PASS 아님)`) }
  return judgeStageEvidence(i.kstDate, i.stage, facts, side)
}

/**
 * 🔴 **전날의 계획을 되짚는다** (PR3 KEEP) — 전날이 브레이크 날(HOLD·PREPARE)이면 그 앞날들의 결정·증거로
 *    그날 계획을 다시 만든다. 저장 행에 새 칸을 두지 않는다. 최대 `PLAN_CARRY_MAX_DAYS` 행. 못 읽으면 잇지 않는다.
 */
async function carriedPlanFor(prisma: PrismaClient, previous: ValidatedStageDecision): Promise<TrialPlan | null> {
  return carriedTrialPlanFor(previous, {
    readDecision: async (kstDate) => {
      const r = await readStageDecision(prisma, kstDate)
      return r.found && r.result.ok ? r.result.decision : null
    },
    readEvidence: (decision) => evidenceFor(prisma, {
      kstDate: decision.kstDate, stage: decision.release, decision,
    }),
  })
}

/** 🔴 저장 결정 한 날짜 판독 — 없음 · 유효 · 깨짐. DB 예외는 그대로 던진다(`resolvePreviousAuthority` 가 멈춤으로 바꾼다) */
const decisionReader = (prisma: PrismaClient) => async (kstDate: string): Promise<DecisionRead> => {
  const r = await readStageDecision(prisma, kstDate)
  if (!r.found) return { kind: 'absent' }
  return r.result.ok ? { kind: 'valid', decision: r.result.decision } : { kind: 'broken', reason: r.result.reason }
}

function observeErrors(): HealthSignal {
  const pub = observeJob('com.soransoran.original-post-runner')
  const sup = observeJob('com.soransoran.supply-process')
  return errorSignalOf([
    { label: pub.label, loaded: pub.state === 'loaded', failing: publishFailing(pub, readPublishRunRecord(), NOW, PUBLISH_RUN_MAX_AGE_MS) },
    { label: sup.label, loaded: sup.state === 'loaded', failing: supplyFailing(sup, readProcessRuns().runs) },
  ])
}

/**
 * 마지막 controller 예약까지 공급 lease가 끝나지 않은 날의 안전 결정(`leaseSafeHoldOf`).
 * 오늘의 부분 Queue는 읽지 않고, 전날 보이던 공개를 넘지 않는 HOLD만 기록한다. 인증 권한은 행에 따로 남긴다.
 */
async function holdForSupplyLease(lease: 'busy' | 'unknown', flagOn: boolean): Promise<number> {
  if (!fillDbConnection()) {
    console.error('🔴 DATABASE_URL 이 없다 — 공급 lease 충돌 HOLD도 저장하지 못한다')
    return 1
  }
  const prisma = new PrismaClient()
  try {
    const authority = await resolvePreviousAuthority(TODAY, decisionReader(prisma))
    if (authority.kind === 'stop') {
      console.error(`🔴 ${authority.code} — ${authority.reason}. 공급 lease HOLD도 계산·저장하지 않는다`)
      return 1
    }
    // 🔴 다리(이틀 전 행)는 권한만 잇는다 — 신호를 못 본 HOLD 라 공개는 d1 이다(`signalBlindReleaseOf`). 계획은 되짚지 않는다
    const previous = authorityRowOf(authority)
    const evidence = previous === null ? null : await evidenceFor(prisma, {
      kstDate: previous.kstDate, stage: previous.release, decision: previous,
    })
    let carriedPlan: TrialPlan | null = null
    if (previous !== null && authority.kind === 'exact') {
      try { carriedPlan = await carriedPlanFor(prisma, previous) } catch {
        // 🔴 복원 실패는 인증을 지어내지 않는다. 전날 공개 단계 그대로 HOLD한다.
      }
    }
    const { decision, certified } = leaseSafeHoldOf({
      kstDate: TODAY, decidedAt: NOW.toISOString(), lease,
      authority, previousEvidence: evidence, carriedPlan,
    })
    const valid = validateForToday(decision)
    if (!valid.ok) { console.error(`🔴 공급 lease 충돌 HOLD가 계약을 지키지 않는다 — ${valid.reason}`); return 1 }
    if (JSON_OUT) console.log(JSON.stringify({ today: TODAY, apply: APPLY, flagOn, supplyLease: lease, safeHold: true, decision }, null, 2))
    else log(`\n🟡 SUPPLY_LEASE_${lease.toUpperCase()} — 마지막 예약이므로 부분 재고로 승격하지 않고 공개 ${decision.release} HOLD를 기록한다(인증 ${certified})\n`)
    if (!flagOn) {
      log(`🔴 ${CONTROLLER_ENV} 가 on 이 아니다 — 저장하지 않는다 (consumer 는 옛 env/canary 단계로 돌아가지 않고 가장 안전한 d1 로 감속한다)\n`)
      return 0
    }
    const io = stageDecisionIo(prisma, TODAY)
    const out = await ensureStageDecision({
      read: io.read, insert: io.insert, validate: io.validate, compute: () => decision, by: DECISION_WRITER,
    })
    if (!out.ok) { console.error(`🔴 공급 lease 충돌 HOLD 저장 실패 ${out.code} — ${out.reason}`); return 1 }
    log(`   ${out.created ? '🟢 안전 HOLD를 저장했다' : '🟢 이미 오늘 결정이 있어 읽었다'} — ${out.decision.state} · 공개 ${out.decision.release}\n`)
    return 0
  } catch (e) {
    console.error(`🔴 공급 lease 충돌 HOLD 경로 실패 — ${(e as Error).name}`)
    return 1
  } finally {
    await prisma.$disconnect()
  }
}

/** 🔴 `--evidence-date` — 그날 결정을 읽어 그 단계로 판정한다. write 0 */
async function evidenceOnly(date: string): Promise<number> {
  if (!isCalendarDate(date)) { console.error(`🔴 달력에 없는 날짜 — ${date}`); return 1 }
  if (!fillDbConnection()) { console.error('🔴 DATABASE_URL 이 없다'); return 1 }
  const prisma = new PrismaClient()
  try {
    const r = await readStageDecision(prisma, date)
    const decision = r.found && r.result.ok ? r.result.decision : null
    const stageArg = argv.find((a) => a.startsWith('--evidence-stage='))?.slice('--evidence-stage='.length)
    const stage = (stageArg !== undefined ? resolveRuntimeStage(stageArg, 'release').stage : decision?.release) ?? null
    if (stage === null) { console.error(`🔴 ${date} 결정이 없거나 깨졌다 — --evidence-stage 로 단계를 준다`); return 1 }
    const v = await evidenceFor(prisma, { kstDate: date, stage, decision })
    if (JSON_OUT) console.log(JSON.stringify({ date, decision: decision === null ? null : { state: decision.state, release: decision.release, contractVersion: decision.contractVersion }, evidence: v }, null, 2))
    else {
      log(`\n══ 운영 증거 ${date} · ${stage} (read-only · DB write 0) ══`)
      log(`   결정  ${decision === null ? '없음/깨짐' : `${decision.state} · 공개 ${decision.release} · ${decision.contractVersion}`}`)
      log(`   ${evidenceReasonOf(v)}`)
      if (decision !== null) {
        const plan = trialPlanOf(decision, v)
        log(`   ▸ 다음 날 시험  ${plan === null ? '없음 — 평상일(0..Dn) · 증명 기반이 없고 다음 단계 preflight PASS 인 날만 현재 단계 재인증' : `${plan.target} (기반 ${plan.base} · ${plan.basis})`}\n`)
      }
    }
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<number> {
  if (EVIDENCE_DATE !== null) return evidenceOnly(EVIDENCE_DATE)
  // 🔴 정본 env 에서 읽는 것은 controller 스위치 하나 — 단계 값은 읽지 않는다
  const env = readEnvKeys([CONTROLLER_ENV])
  const flagOn = controllerEnabled(env.values)
  log('\n══ 단계 controller (source-slot-v1) ══')
  log(`   ${TODAY} · ${APPLY ? '--apply' : 'dry-run'} · ${CONTROLLER_ENV}=${flagOn ? 'on' : 'off'}`)
  log('   🔴 단계 입력원은 StageDecision 하나 — env 단계 · env 천장 · canary/window 를 읽지 않는다')

  /**
   * 🔴 06:15 공급이 아직 Queue 도장을 마치지 않았으면 07:00 결정은 불완전한 재고를 보게 된다.
   *    apply만 커널 lease 뒤로 미룬다. 07:00·07:20·07:40은 DB read/write 0으로 물러나고 07:55가 다시 본다.
   *    마지막 07:55에도 끝나지 않으면 부분 재고로 승격하지 않고, 전날 증거의 지속 단계 HOLD만 기록한다.
   *    07:58은 07:55 뒤에도 결정이 없을 때 정본 read-only 사실을 다시 계산한다. 새 recovery/provider는
   *    열지 않고 create-only 저장만 하므로 07:55 결정이 뒤늦게 생겨도 덮어쓰지 않는다.
   *    probe 실패도 free로 간주하지 않는다. dry-run은 관측이므로 계속 계산한다.
   */
  if (APPLY) {
    const supplyLease = probeSupplyLease()
    const disposition = stageControllerLeaseDisposition(supplyLease, NOW)
    if (disposition === 'safe-hold') return holdForSupplyLease(supplyLease as 'busy' | 'unknown', flagOn)
    if (disposition === 'defer') {
      const code = supplyLease === 'busy' ? 'SUPPLY_LEASE_BUSY' : 'SUPPLY_LEASE_UNKNOWN'
      if (JSON_OUT) console.log(JSON.stringify({ today: TODAY, apply: APPLY, flagOn, deferred: true, code, supplyLease }, null, 2))
      else log(`\n🟡 ${code} — 공급 회차의 적재·READY 마감이 끝난 뒤 다음 예약이 재시도한다. DB read 0 · DB write 0\n`)
      return supplyLease === 'busy' ? 0 : 1
    }
  }

  if (!fillDbConnection()) {
    console.error('🔴 DATABASE_URL 이 없다 — 결정을 읽지도 쓰지도 못한다. 지금 공개 단계는 바뀌지 않는다')
    return 1
  }
  const prisma = new PrismaClient()
  try {
    const decidedAt = NOW.toISOString()
    const failures: string[] = []

    // ① 전날 결정 — 깨짐·읽기 예외면 대체 결정을 계산·저장하지 않는다(다음 예약이 다시 읽는다)
    const authority = await resolvePreviousAuthority(TODAY, decisionReader(prisma))
    if (authority.kind === 'stop') {
      if (JSON_OUT) console.log(JSON.stringify({ today: TODAY, apply: APPLY, flagOn, stopped: true, code: authority.code, reason: authority.reason }, null, 2))
      console.error(`🔴 ${authority.code} — ${authority.reason}. 결정 계산 0 · DB write 0 — 다음 예약이 다시 읽는다`)
      return 1
    }
    const previous: ValidatedStageDecision | null = authority.kind === 'exact' ? authority.previous : null
    /** 🔴 전날 행이 없을 때만 — 이틀 전 행. 권한만 잇고 시험을 열지 않는다 */
    const bridge: ValidatedStageDecision | null = authority.kind === 'bridge' ? authority.bridge : null
    if (previous !== null) log(`   전날 결정 ${previous.state} · 공개 ${previous.release} · ${previous.contractVersion}`)
    if (bridge !== null) log(`   🟡 전날 결정 없음 — 이틀 전 ${bridge.kstDate} ${bridge.state} · 공개 ${bridge.release} 로 권한만 잇는다(시험 없음)`)
    if (authority.kind === 'first-run') log('   전날·이틀 전 결정 없음 — 첫 시작(d1)')

    // ①-b 전날 운영 증거 · 이어진 계획
    const errorSignal = observeErrors()
    let evidence: StageEvidenceVerdict | null = null
    let carriedPlan: TrialPlan | null = null
    // 🔴 권한 행 — 전날 행, 없으면 다리(이틀 전 행). 증거는 그 행의 날짜·단계로만 판정한다
    const authorityRow = previous ?? bridge
    if (authorityRow !== null) {
      evidence = await evidenceFor(prisma, {
        kstDate: authorityRow.kstDate, stage: authorityRow.release, decision: authorityRow,
      })
      log(`   ${evidence.verdict === 'PASS' ? '🟢' : '🔴'} ${evidenceReasonOf(evidence)}`)
    }
    // 🔴 계획 되짚기는 인접한 전날 행에서만 — 다리 날은 시험을 열지 않는다
    if (previous !== null) {
      try { carriedPlan = await carriedPlanFor(prisma, previous) } catch (e) {
        log(`   ⬚ 지난 계획을 되짚지 못했다 — ${(e as Error).name} (잇지 않는다)`)
      }
      if (carriedPlan !== null) log(`   전날(브레이크 날)이 이은 계획  ${carriedPlan.target} (기반 ${carriedPlan.base} · ${carriedPlan.basis})`)
    }
    const sustained = sustainedReleaseOf(authorityRow, evidence, carriedPlan)
    const plan = previous === null ? null : trialPlanOf(previous, evidence, carriedPlan)
    log(`   지속 단계 ${sustained} · 시험 계획  ${plan === null ? '없음 — 평상일(0..Dn) · 증명 기반이 없고 다음 단계 preflight PASS 인 날만 현재 단계 재인증' : `${plan.target} (기반 ${plan.base} · ${plan.basis})`}`)

    // ② 시험 대상 preflight — 오늘(증명일) 전체 슬롯 기준
    let nextPreflight: PreflightVerdict | null = null
    let preflightTarget: RuntimeStage | null = null
    let publishedToday = 0
    let preflightDetail: Record<string, unknown> | null = null
    const finalRecoverySlot = isFinalRecoveryControllerSlot(NOW)
    try {
      const autoOpen = await auditAwareGate(prisma, readEnvKeys(PREFLIGHT_ENV_KEYS).values, NOW)
      const s = await loadPublishableStock(prisma, NOW, { autoReadyOpen: autoOpen.open })
      publishedToday = s.publishedToday
      /**
       * 🔴 preflight 대상 — 계획이 있으면 그 시험 대상, 없으면 **지금 단계의 다음 칸**(2026-10-11 Batch A1).
       *    계획이 없는 날은 평상일이 기본이다. 다음 단계 preflight 가 PASS 인지(현재 단계 재인증 여부)를 같은 관문으로 본다.
       */
      const target: RuntimeStage | null = previous === null ? null
        : plan !== null ? (plan.base === sustained ? plan.target : null)
          : nextStage(sustained)
      preflightTarget = target
      if (target !== null && previous !== null) {
        const pe = readEnvKeys(PREFLIGHT_ENV_KEYS)
        const recoveryIntent = finalRecoverySlot ? readStageRecoveryIntent(TODAY) : null
        const recoveryClaim = recoveryIntent === null ? null : {
          kstDate: recoveryIntent.kstDate, nonce: recoveryIntent.nonce, deficit: recoveryIntent.deficit,
        }
        const recoverySupplyReceipt = recoveryClaim === null ? null
          : readStageRecoverySupplyReceipt(recoveryClaim)
        const recoverySourceReceipt = recoveryIntent === null ? null
          : readStageRecoverySourceReceipt(TODAY, recoveryIntent.nonce)
        const recoveryReceiptAt = recoverySourceReceipt === null
          ? Number.NaN : Date.parse(recoverySourceReceipt.writtenAt)
        const recoveryCreatedAt = recoveryIntent === null
          ? Number.NaN : Date.parse(recoveryIntent.createdAt)
        const recoverySupplyCompletedAt = recoverySupplyReceipt === null
          ? Number.NaN : Date.parse(recoverySupplyReceipt.completedAt)
        const recoveryLineage = recoveryIntent !== null && recoverySourceReceipt !== null
          && recoverySupplyReceipt !== null
          && Number.isFinite(recoveryReceiptAt) && Number.isFinite(recoveryCreatedAt)
          && Number.isFinite(recoverySupplyCompletedAt)
          && recoveryReceiptAt >= recoveryCreatedAt && recoveryReceiptAt <= NOW.getTime()
          && recoverySupplyCompletedAt >= recoveryCreatedAt && recoverySupplyCompletedAt <= NOW.getTime()
          ? {
              sourceHashes: new Set(recoverySourceReceipt.sourceHashes),
              supplyRunId: recoverySupplyReceipt.supplyRunId,
              createdAt: new Date(recoveryCreatedAt),
            }
          : undefined
        const r = await readPreflightFacts(prisma, {
          loaded: s, autoOpen, proofSlots: slotTimesOn(TODAY, profileOf(target)),
          caps: releaseCapsOf(profileOf(target)), evidenceDate: previous.kstDate, env: pe.values,
          dataDir: SUPPLY_DATA_DIR, now: NOW, runnerHealth: errorSignal.health,
          recoveryLineage,
          // 🔴 Persona 4상태 정본의 계약 유효 수 — 활성 행 수를 넣지 않는다(읽지 못하면 null = 모름)
          contractValidPersonas: () => readContractValidPersonas(prisma, { now: NOW, repoRoot: process.cwd() }),
        })
        let boundedRecoveryReadyGain = 0
        if (finalRecoverySlot) {
          const recoveryReadyStock = r.facts.slotValidRecoveryReadyStock
          const receiptOk = recoverySupplyReceipt !== null
          if (recoveryIntent !== null && recoveryIntent.state === 'done'
            && recoveryIntent.target === target && receiptOk && recoveryLineage !== undefined
            && Number.isSafeInteger(recoveryReadyStock) && Number(recoveryReadyStock) >= 0) {
            boundedRecoveryReadyGain = Math.min(recoveryIntent.deficit, Number(recoveryReadyStock))
            log(`   제한 복구 READY lineage 검증 sources=${recoveryLineage.sourceHashes.size}`
              + ` slotValid=${recoveryReadyStock} gain=${boundedRecoveryReadyGain}/${recoveryIntent.deficit}`)
          } else if (recoveryIntent !== null) {
            log(`   제한 복구 READY 가산 0 — state=${recoveryIntent.state} target=${recoveryIntent.target}`
              + ` supplyReceipt=${receiptOk ? 'ok' : 'missing'}`
              + ` sourceReceipt=${recoveryLineage === undefined ? 'missing-or-invalid' : 'ok'}`
              + ` slotValidRecovery=${String(recoveryReadyStock)}`)
          }
        }
        nextPreflight = judgeNextPreflight(target, r.facts, RUNNER_GRID, { boundedRecoveryReadyGain })
        preflightDetail = r.detail
        log(`   ${target} preflight ${nextPreflight.verdict}${nextPreflight.codes.length > 0 ? ` [${nextPreflight.codes.join(',')}]` : ''}`
          + `${nextPreflight.warnings.length > 0 ? ` WARN [${nextPreflight.warnings.join(',')}]` : ''}`
          + ` (${Object.entries(nextPreflight.counts).map(([k, x]) => `${k}=${x}`).join(',')})`)
        for (const n of r.notes) log(`      ⬚ ${n}`)
      }
    } catch (e) { failures.push(`재고·preflight 를 읽지 못했다 — ${(e as Error).name}`) }

    // ③ 운영 신호 — 품질 · 비용 · 오류
    const signals: HealthSignal[] = []
    try {
      signals.push(qualitySignalOf({
        unresolvedDefects: await unresolvedDefectCount(prisma),
        missingPosts: await missingAutoPostCount(prisma),
        retryableFailures: await retryableFailureCount(prisma),
        overdueAudits: await overdueAuditCount(prisma, NOW),
      }))
    } catch (e) { signals.push(qualitySignalOf(null, (e as Error).name)) }
    const cost = readCostSignals(NOW)
    signals.push(costSignalOf([
      { name: '공급 장부', health: cost.supplyLedger.health, reasons: cost.supplyLedger.reasons },
      { name: '댓글 장부', health: cost.commentLedger.health, reasons: cost.commentLedger.reasons },
      { name: '감사 장부', health: cost.auditLedger.health, reasons: cost.auditLedger.reasons },
    ]))
    signals.push(errorSignal)

    // ④ 결정
    let result: ControllerResult
    if (failures.length > 0) {
      result = {
        // 🔴 입력 실패 날은 오늘 신호를 판정하지 못했다 — 전날 행이 없으면 d1, 인증은 행에 따로 남긴다(`inputFailureHoldOf`)
        decision: inputFailureHoldOf({
          kstDate: TODAY, decidedAt, reason: failures.join(' · '), certified: sustained, authority,
        }),
        brake: 'controllerFailure', sustained,
      }
    } else if (bridge !== null) {
      result = bridgeHoldOf({ kstDate: TODAY, decidedAt, bridge, bridgeEvidence: evidence, publishedToday, signals })
    } else {
      result = decideStage({
        kstDate: TODAY, decidedAt, previousDecision: previous, previousEvidence: evidence, carriedPlan,
        nextPreflight, publishedToday, signals,
      })
    }
    const v = validateForToday(result.decision)

    if (JSON_OUT) {
      console.log(JSON.stringify({ today: TODAY, apply: APPLY, flagOn, result, valid: v.ok, signals, failures, evidence, carriedPlan, plan, nextPreflight, preflightDetail }, null, 2))
    } else {
      for (const s of signals) log(`   ${s.health === 'ok' ? '🟢' : s.health === 'bad' ? '🔴' : '⚪'} ${s.axis.padEnd(8)} ${s.reasons.join(' · ') || '정상'}`)
      const d = result.decision
      log(`\n   ▸ 결정  ${d.state} · 공개 ${d.release} · 준비 ${d.capacity} · 브레이크 ${result.brake} · 지속 ${result.sustained}`)
      for (const r of d.reasons) log(`      · ${r}`)
      for (const b of d.blocks) log(`      🔴 ${b.code}: ${b.reason}`)
      log(`   검증  ${v.ok ? '🟢 통과' : `🔴 ${v.reason}`}`)
    }
    if (!v.ok) { console.error(`🔴 계산한 결정이 계약을 지키지 않는다 — 저장하지 않는다: ${v.reason}`); return 1 }

    if (!APPLY) { log('\n🔴 dry-run — DB write 0. 저장은 --apply + 정본 env 의 flag on 일 때만\n'); return 0 }
    if (!flagOn) {
      log(`\n🔴 ${CONTROLLER_ENV} 가 on 이 아니다 — 저장하지 않는다 (consumer 는 옛 env/canary 단계로 돌아가지 않고 가장 안전한 d1 로 감속한다)\n`)
      return 0
    }
    const io = stageDecisionIo(prisma, TODAY)
    /**
     * 기회 부족만 능동 복구한다. 오늘 결정이 이미 있으면 절대 복구를 시작하지 않고,
     * 품질·비용·오류·다른 preflight 결함은 기존 결과를 즉시 저장한다.
     * intent가 있는 정상 복구 흐름은 중간 예약에서 결정을 쓰지 않고 07:55 재판정을 기다린다.
     * 07:58은 결정 부재만 처리하는 fallback이고 새 복구는 시작하지 않는다.
     */
    const existingDecision = await io.read()
    if (existingDecision === null && !finalRecoverySlot) {
      const recoveryPlan = planActiveRecovery({
        target: preflightTarget, preflight: nextPreflight, signals, failures, now: NOW,
      })
      let intent = readStageRecoveryIntent(TODAY)
      const recoveryDisposition = activeRecoveryDecisionDisposition({
        plan: recoveryPlan, intentState: intent?.state ?? null, preflight: nextPreflight,
      })
      if (recoveryDisposition === 'recover' && recoveryPlan.kind === 'recover') {
        if (intent === null) intent = createStageRecoveryIntent({ kstDate: TODAY, plan: recoveryPlan, now: NOW }).intent
        if (!stageRecoveryIntentCoversPlan(intent, recoveryPlan)) {
          log('\n🟡 오늘 제한 복구 intent보다 부족분이 커졌거나 대상이 달라졌다 — 두 번째 복구 0 · 중간 StageDecision write 0')
          log('   07:55 최종 예약이 같은 정본으로 한 번 결정한다\n')
          return 0
        }
        if (intent.state === 'requested') {
          const launch = claimStageRecoveryLaunch({ intent, now: new Date(), message: recoveryPlan.reason })
          intent = launch.intent
          if (launch.claimed) {
            if (!await launchActiveRecovery(intent)) {
              updateStageRecoveryIntent({ intent, state: 'failed', now: new Date(), message: 'worker 시작 실패' })
              console.error('🔴 제한 복구 worker를 시작하지 못했다 — 오늘 결정을 아직 쓰지 않았다. 다음 예약이 다시 판정한다')
              return 1
            }
            log(`\n🟡 ${recoveryPlan.reason} — 제한 수집 ${intent.collectMax}건 · 공급 묶음 ${intent.worksetLimit}을 한 번 시작했다`)
          } else {
            log('\n🟡 오늘 제한 복구 실행권은 이미 다른 controller가 가져갔다 — 두 번째 worker 0')
          }
        } else {
          log(`\n🟡 오늘 제한 복구 intent ${intent.state} — 두 번째 복구를 만들지 않는다`)
        }
        log('   StageDecision write 0 · 07:55에 같은 정본으로 최종 재판정한다\n')
        return 0
      }
      if (recoveryDisposition === 'defer') {
        log(`\n🟡 제한 복구 ${intent === null ? '대기' : `intent ${intent.state}`} · ${recoveryPlan.reason} — 중간 StageDecision write 0`)
        log('   07:55 최종 예약이 같은 정본으로 한 번 결정한다\n')
        return 0
      }
      if (recoveryDisposition === 'cancel-and-decide' && intent !== null) {
        try {
          updateStageRecoveryIntent({
            intent, state: 'failed', now: new Date(),
            message: `복구 중 새 중대 차단: ${recoveryPlan.reason}`,
          })
        } catch (e) {
          console.error(`🔴 제한 복구를 취소하지 못해 StageDecision도 쓰지 않는다 — ${(e as Error).message}`)
          return 1
        }
      }
    } else if (existingDecision === null && finalRecoverySlot) {
      const intent = readStageRecoveryIntent(TODAY)
      if (intent !== null && (intent.state === 'requested' || intent.state === 'running')) {
        try {
          updateStageRecoveryIntent({
            intent, state: 'failed', now: new Date(), message: '07:55 최종 판정 마감 — 추가 공급 종료',
          })
        } catch (e) {
          const after = readStageRecoveryIntent(TODAY)
          const ended = after?.state === 'done' || after?.state === 'failed'
          console.error(`🔴 최종 판정 전 제한 복구 상태 기록을 닫지 못했다 — ${(e as Error).message}`
            + (ended ? ` · 재조회 결과 ${after.state}` : ' · 07:50 provider 마감은 이미 닫혔다'))
          // 07:55에는 provider 경계가 이미 닫혔다. 상태 파일 write 한 번의 실패가 오늘의
          // 유일한 StageDecision까지 없애면 다음날 또 같은 시험을 반복한다. 같은 정본 계산은 계속한다.
        }
      }
    }
    let out: Awaited<ReturnType<typeof ensureStageDecision>>
    const writeDecision = (): ReturnType<typeof ensureStageDecision> => ensureStageDecision({
      read: io.read, insert: io.insert, validate: io.validate,
      compute: () => result.decision, by: DECISION_WRITER,
    })
    try {
      out = finalRecoverySlot ? await retryFinalStageDecisionWrite(writeDecision) : await writeDecision()
    } catch (e) {
      console.error(`🔴 저장 경로에 닿지 못했다 — ${(e as Error).name}. 아무것도 쓰지 않았다`)
      return 1
    }
    if (!out.ok) { console.error(`🔴 저장 실패 ${out.code} — ${out.reason}`); return 1 }
    log(`\n   ${out.created ? '🟢 저장했다' : '🟢 이미 있어 읽었다(덮지 않는다)'} — ${out.decision.state} · 공개 ${out.decision.release} · 준비 ${out.decision.capacity}\n`)
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

process.exit(await main())
