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
 *    · 재고·전날 결정을 못 읽음 → `holdAtCurrent`
 *    · 운영 신호를 모름        → 시험·증명일만 막는다
 *    · DB 자체에 못 닿음       → 아무것도 쓰지 못한다 · exit 1 (consumer 는 정본 fallback)
 *
 * 🔴 **한 사다리 · 한 관문** (2026-09-30 · source-slot-v1).
 *    · 시험 대상 = `trialPlanOf(전날 결정, 전날 운영 증거[조항 ⑦ 포함], 브레이크 날을 건넌 계획)`
 *    · 그 대상의 다음 증명일(오늘) 전체 슬롯 기준 preflight(`judgeNextPreflight` · D3~D100 한 함수) PASS 여야 연다
 *    · 🔴 **지운 입력** — 14일 준비도(`stageVerdicts`) · 하루 시뮬레이션(`judgeOneDayCanary`) · 지속 승격
 *      (`d100:readiness` 자식 프로세스 · `judgePromotion`) · env 공개 단계(`SORAN_RELEASE_STAGE`) · env 천장
 *      (`SORAN_CAPACITY_STAGE` · `resolveCeiling`). 현재 단계의 입력원은 StageDecision 하나다.
 *    · 🔴 Persona 는 계약 유효 수(Persona 4상태 정본)만 받는다 — 하한 미달이면 FAIL, 읽기 실패면 UNKNOWN. 둘 다 시험을 열지 않는다
 *      (2026-09-30 실측 0 → D1→D3 부터 막힌다).
 */
import { PrismaClient } from '@prisma/client'

import { profileOf, releaseCapsOf, resolveRuntimeStage, type RuntimeStage } from '../src/lib/scale-profile'
import { kstDateString } from '../src/lib/release-canary'
import { previousKstDate, isCalendarDate, DECISION_WRITER, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import { ensureStageDecision, controllerEnabled, CONTROLLER_ENV } from '../src/lib/stage-decision-store'
import { readStageDecision, stageDecisionIo } from '../src/lib/stage-decision-repo'
import {
  decideStage, holdAtCurrent, validateForToday, qualitySignalOf, costSignalOf, errorSignalOf,
  sustainedReleaseOf, type HealthSignal, type ControllerResult,
} from '../src/lib/stage-controller'
import { confirmedDefectCount, missingAutoPostCount } from '../src/lib/auto-ready-repo'
import { auditAwareGate, overdueAuditCount, retryableFailureCount } from '../src/lib/auto-ready-audit-store'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { observeJob, publishFailing, readProcessRuns, supplyFailing, SUPPLY_DATA_DIR } from './lib/runner-health.mjs'
import { PUBLISH_RUN_MAX_AGE_MS, readPublishRunRecord } from './lib/publish-run-record.mjs'
import { fillDbConnection, readCostSignals, readEnvKeys } from './lib/ops-signals.mjs'
import {
  judgeStageEvidence, trialPlanOf, trialPlanThrough, evidenceReasonOf, PLAN_CARRY_MAX_DAYS,
  type StageEvidenceVerdict, type StageEvidenceFacts, type EvidenceSideSignals, type TrialPlan,
} from '../src/lib/stage-evidence'
import { readStageEvidenceFacts } from '../src/lib/stage-evidence-repo'
import { personaCommentCapFor } from '../src/lib/stage-evidence'
import { COMMENT_STAGE_ENV, readCommentStage } from '../src/lib/persona-comment-stage'
import { judgeNextPreflight, slotTimesOn, type PreflightVerdict } from '../src/lib/stage-ladder-generic'
import { readPreflightFacts, PREFLIGHT_ENV_KEYS, RUNNER_GRID } from './lib/stage-preflight-facts.mjs'
import { readContractValidPersonas } from './lib/persona-reserve-facts.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const JSON_OUT = argv.includes('--json')
/** 🔴 read-only 증거 조회 — 이 모드는 결정을 계산하지도 저장하지도 않는다 */
const EVIDENCE_DATE = argv.find((a) => a.startsWith('--evidence-date='))?.slice('--evidence-date='.length) ?? null
const NOW = new Date()
const TODAY = kstDateString(NOW)

const log = (s: string): void => { if (!JSON_OUT) console.log(s) }

/**
 * 🔴 **KST 날짜 D · 단계 S 의 운영 증거 판정** — 읽기만 한다.
 *    어느 것이든 못 읽으면 그 칸은 모름이다 — PASS 가 되지 않는다(fail-closed = 지금 단계에 머문다).
 */
async function evidenceFor(prisma: PrismaClient, i: {
  kstDate: string; stage: RuntimeStage; decision: ValidatedStageDecision | null; errors: HealthSignal
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
        { name: '공급 장부', health: c.supplyLedger.health },
        { name: '댓글 장부', health: c.commentLedger.health },
        { name: '감사 장부', health: c.auditLedger.health },
      ],
      errors: i.errors.health,
    }
  } catch (e) { log(`   ⬚ 그날 장부를 읽지 못했다 — ${(e as Error).name} (모름 = PASS 아님)`) }
  return judgeStageEvidence(i.kstDate, i.stage, facts, side)
}

/**
 * 🔴 **전날의 계획을 되짚는다** (PR3 KEEP) — 전날이 브레이크 날(HOLD·PREPARE)이면 그 앞날들의 결정·증거로
 *    그날 계획을 다시 만든다. 저장 행에 새 칸을 두지 않는다. 최대 `PLAN_CARRY_MAX_DAYS` 행. 못 읽으면 잇지 않는다.
 */
async function carriedPlanFor(prisma: PrismaClient, previous: ValidatedStageDecision, errors: HealthSignal): Promise<TrialPlan | null> {
  const isHold = (d: ValidatedStageDecision): boolean => d.state === 'HOLD' || d.state === 'PREPARE'
  if (!isHold(previous)) return null
  const days: { decision: ValidatedStageDecision; evidence: StageEvidenceVerdict | null }[] = []
  let date = previous.kstDate
  for (let k = 0; k < PLAN_CARRY_MAX_DAYS; k += 1) {
    const d = previousKstDate(date)
    if (d === null) break
    const r = await readStageDecision(prisma, d)
    if (!r.found || !r.result.ok) break
    const dec = r.result.decision
    const hold = isHold(dec)
    days.unshift({ decision: dec, evidence: hold ? null : await evidenceFor(prisma, { kstDate: d, stage: dec.release, decision: dec, errors }) })
    date = d
    if (!hold) break
  }
  return trialPlanThrough(days)
}

function observeErrors(): HealthSignal {
  const pub = observeJob('com.soransoran.original-post-runner')
  const sup = observeJob('com.soransoran.supply-process')
  return errorSignalOf([
    { label: pub.label, loaded: pub.state === 'loaded', failing: publishFailing(pub, readPublishRunRecord(), NOW, PUBLISH_RUN_MAX_AGE_MS) },
    { label: sup.label, loaded: sup.state === 'loaded', failing: supplyFailing(sup, readProcessRuns().runs) },
  ])
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
    const v = await evidenceFor(prisma, { kstDate: date, stage, decision, errors: observeErrors() })
    if (JSON_OUT) console.log(JSON.stringify({ date, decision: decision === null ? null : { state: decision.state, release: decision.release, contractVersion: decision.contractVersion }, evidence: v }, null, 2))
    else {
      log(`\n══ 운영 증거 ${date} · ${stage} (read-only · DB write 0) ══`)
      log(`   결정  ${decision === null ? '없음/깨짐' : `${decision.state} · 공개 ${decision.release} · ${decision.contractVersion}`}`)
      log(`   ${evidenceReasonOf(v)}`)
      if (decision !== null) {
        const plan = trialPlanOf(decision, v)
        log(`   ▸ 다음 날 시험  ${plan === null ? '없음 — 지금 단계를 다시 증명한다' : `${plan.target} (기반 ${plan.base} · ${plan.basis})`}\n`)
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

  if (!fillDbConnection()) {
    console.error('🔴 DATABASE_URL 이 없다 — 결정을 읽지도 쓰지도 못한다. 지금 공개 단계는 바뀌지 않는다')
    return 1
  }
  const prisma = new PrismaClient()
  try {
    const decidedAt = NOW.toISOString()
    const failures: string[] = []

    // ① 전날 결정
    let previous: ValidatedStageDecision | null = null
    const prevDate = previousKstDate(TODAY)
    try {
      if (prevDate !== null) {
        const r = await readStageDecision(prisma, prevDate)
        if (r.found && r.result.ok) previous = r.result.decision
        else if (r.found && !r.result.ok) log(`   🔴 전날 결정이 깨졌다 — ${r.result.reason} (기반으로 쓰지 않는다)`)
      }
    } catch (e) { failures.push(`전날 결정을 읽지 못했다 — ${(e as Error).name}`) }
    if (previous !== null && previous.contractVersion !== undefined) {
      log(`   전날 결정 ${previous.state} · 공개 ${previous.release} · ${previous.contractVersion}`)
    }

    // ①-b 전날 운영 증거 · 이어진 계획
    const errorSignal = observeErrors()
    let evidence: StageEvidenceVerdict | null = null
    let carriedPlan: TrialPlan | null = null
    if (previous !== null) {
      evidence = await evidenceFor(prisma, {
        kstDate: previous.kstDate, stage: previous.release, decision: previous, errors: errorSignal,
      })
      log(`   ${evidence.verdict === 'PASS' ? '🟢' : '🔴'} ${evidenceReasonOf(evidence)}`)
      try { carriedPlan = await carriedPlanFor(prisma, previous, errorSignal) } catch (e) {
        log(`   ⬚ 지난 계획을 되짚지 못했다 — ${(e as Error).name} (잇지 않는다)`)
      }
      if (carriedPlan !== null) log(`   전날(브레이크 날)이 이은 계획  ${carriedPlan.target} (기반 ${carriedPlan.base} · ${carriedPlan.basis})`)
    }
    const sustained = sustainedReleaseOf(previous, evidence)
    const plan = previous === null ? null : trialPlanOf(previous, evidence, carriedPlan)
    log(`   지속 단계 ${sustained} · 시험 계획  ${plan === null ? '없음 — 지금 단계를 다시 증명한다' : `${plan.target} (기반 ${plan.base} · ${plan.basis})`}`)

    // ② 시험 대상 preflight — 오늘(증명일) 전체 슬롯 기준
    let nextPreflight: PreflightVerdict | null = null
    let publishedToday = 0
    let preflightDetail: Record<string, unknown> | null = null
    try {
      const autoOpen = await auditAwareGate(prisma, readEnvKeys(PREFLIGHT_ENV_KEYS).values, NOW)
      const s = await loadPublishableStock(prisma, NOW, { autoReadyOpen: autoOpen.open })
      publishedToday = s.publishedToday
      if (plan !== null && previous !== null && plan.base === sustained) {
        const target = plan.target
        const pe = readEnvKeys(PREFLIGHT_ENV_KEYS)
        const r = await readPreflightFacts(prisma, {
          loaded: s, autoOpen, proofSlots: slotTimesOn(TODAY, profileOf(target)),
          caps: releaseCapsOf(profileOf(target)), evidenceDate: previous.kstDate, env: pe.values,
          dataDir: SUPPLY_DATA_DIR, now: NOW, runnerHealth: errorSignal.health,
          // 🔴 Persona 4상태 정본의 계약 유효 수 — 활성 행 수를 넣지 않는다(읽지 못하면 null = 모름)
          contractValidPersonas: () => readContractValidPersonas(prisma, { now: NOW, repoRoot: process.cwd() }),
        })
        nextPreflight = judgeNextPreflight(target, r.facts, RUNNER_GRID)
        preflightDetail = r.detail
        log(`   ${target} preflight ${nextPreflight.verdict}${nextPreflight.codes.length > 0 ? ` [${nextPreflight.codes.join(',')}]` : ''}`
          + ` (${Object.entries(nextPreflight.counts).map(([k, x]) => `${k}=${x}`).join(',')})`)
        for (const n of r.notes) log(`      ⬚ ${n}`)
      }
    } catch (e) { failures.push(`재고·preflight 를 읽지 못했다 — ${(e as Error).name}`) }

    // ③ 운영 신호 — 품질 · 비용 · 오류
    const signals: HealthSignal[] = []
    try {
      signals.push(qualitySignalOf({
        confirmedDefects: await confirmedDefectCount(prisma),
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
        decision: holdAtCurrent({ kstDate: TODAY, decidedAt, current: sustained, reason: failures.join(' · ') }),
        brake: 'controllerFailure', sustained,
      }
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
      log(`\n🔴 ${CONTROLLER_ENV} 가 on 이 아니다 — 저장하지 않는다 (러너는 롤백 env 경로로 돈다)\n`)
      return 0
    }
    const io = stageDecisionIo(prisma, TODAY)
    let out: Awaited<ReturnType<typeof ensureStageDecision>>
    try {
      out = await ensureStageDecision({
        read: io.read, insert: io.insert, validate: io.validate,
        compute: () => result.decision, by: DECISION_WRITER,
      })
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
