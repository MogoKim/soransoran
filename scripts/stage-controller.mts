#!/usr/bin/env tsx
/**
 * 🔴 **하루 단계 controller — 정본 사다리 + 운영 신호 브레이크 → StageDecision 저장**
 *
 *   npm run stage:controller              dry-run — 결정을 계산해 보여 준다. DB write 0
 *   npm run stage:controller -- --apply   저장 — 🔴 정본 env 에 STAGE_CONTROLLER_ENABLED=on 일 때만
 *   npm run stage:controller -- --json    기계가 읽는 값
 *   npm run stage:controller -- --evidence-date=YYYY-MM-DD
 *                                         🔴 read-only — 그날의 운영 증거 판정만 보여 준다(결정 계산·저장 0)
 *
 * 🔴 **쓰는 곳은 하나다** — `ensureStageDecision` → `createStageDecision`(create 뿐 · 덮어쓰기 0).
 *    그날 결정이 이미 있으면 **다시 계산하지도 덮지도 않고** 읽기만 한다.
 *
 * 🔴 **fail-closed = 지금 공개 단계를 지킨다.**
 *    · 재고·전날 결정을 못 읽음 → `holdAtCurrent` (지금 단계 그대로 HOLD)
 *    · 운영 신호를 모름        → 승격·시험만 막는다
 *    · DB 자체에 못 닿음       → 아무것도 쓰지 못한다 · exit 1 (consumer 는 정본 fallback)
 *
 * 🔴 판정에 새 숫자를 넣지 않는다 — 재고·시험·승격·품질·비용·오류 전부 정본 함수의 값이다.
 *
 * 🔴 **승격은 날짜가 아니라 운영 증거로 한다** (2026-09-29 P0 · 마스터 결정).
 *    내일 시험 대상은 `trialPlanOf(전날 결정, 전날 운영 증거)` 다 — PASS 면 한 칸 위, 전날이 시험인데
 *    PASS 가 아니면(FAIL · 모름) **같은 단계를 다시** 시험한다. 증거를 못 읽으면 모름 = PASS 아님.
 *
 * 🔴 **D1 → D50 한 사다리** (2026-09-29 generic scheduler 배선).
 *    · 천장은 `resolveCeiling` 으로 읽는다 — d20·d30·d50 은 그대로, d100 은 승인으로 적히되 열 수 있는 천장은 d50.
 *      지금 운영값 d10 이면 d20 시험은 CEILING 으로 막힌다(천장은 사람이 올린다 · 이 controller 는 올리지 않는다).
 *    · D20 이상 시험 대상이면 preflight 사실(`readPreflightFacts`)을 모아 `judgeNextPreflight` 로 판정해 넘긴다.
 *    · 준비도 판정은 천장 단계까지 만든다(`stageVerdicts({ upTo })`) — 천장 d10 이면 예전과 같다.
 */
import { execFileSync } from 'node:child_process'

import { PrismaClient } from '@prisma/client'

import { profileOf, resolveRuntimeStage, stageRank, type RuntimeStage, type StageVerdict } from '../src/lib/scale-profile'
import { simulateStage, stageVerdicts } from '../src/lib/scale-readiness'
import { judgeOneDayCanary, kstDateString, slotsLeftToday } from '../src/lib/release-canary'
import { previousKstDate, isCalendarDate, DECISION_WRITER, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import { ensureStageDecision, controllerEnabled, CONTROLLER_ENV } from '../src/lib/stage-decision-store'
import { readStageDecision, stageDecisionIo } from '../src/lib/stage-decision-repo'
import type { DatedCanary } from '../src/lib/stage-ladder'
import type { PromotionVerdict } from '../src/lib/d100-capacity'
import {
  decideStage, holdAtCurrent, validateForToday, qualitySignalOf, costSignalOf, errorSignalOf,
  sustainedReleaseOf, type HealthSignal, type ControllerResult,
} from '../src/lib/stage-controller'
import { confirmedDefectCount, missingAutoPostCount } from '../src/lib/auto-ready-repo'
import { auditAwareGate, overdueAuditCount, retryableFailureCount } from '../src/lib/auto-ready-audit-store'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { observeJob, readProcessRuns, supplyFailing } from './lib/runner-health.mjs'
import { fillDbConnection, readCostSignals, readEnvKeys } from './lib/ops-signals.mjs'
import { judgeStageEvidence, trialPlanOf, evidenceReasonOf, type StageEvidenceVerdict, type StageEvidenceFacts, type EvidenceSideSignals } from '../src/lib/stage-evidence'
import { readStageEvidenceFacts } from '../src/lib/stage-evidence-repo'
import { personaCommentCapFor } from '../src/lib/stage-evidence'
import { COMMENT_STAGE_ENV, readCommentStage } from '../src/lib/persona-comment-stage'
import { resolveCeiling, needsExtendedGate, judgeNextPreflight, type PreflightVerdict } from '../src/lib/stage-ladder-generic'
import { readPreflightFacts, PREFLIGHT_ENV_KEYS, RUNNER_GRID } from './lib/stage-preflight-facts.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const JSON_OUT = argv.includes('--json')
/** 🔴 read-only 증거 조회 — 이 모드는 결정을 계산하지도 저장하지도 않는다 */
const EVIDENCE_DATE = argv.find((a) => a.startsWith('--evidence-date='))?.slice('--evidence-date='.length) ?? null
const NOW = new Date()
const TODAY = kstDateString(NOW)

const log = (s: string): void => { if (!JSON_OUT) console.log(s) }

/**
 * 🔴 **지속 승격 판정은 `d100:readiness --json` 의 것을 그대로 받는다.**
 *    같은 조립을 여기 다시 쓰면 두 벌이 된다. 못 받으면 `null` — 사다리는 SUSTAIN 을 열지 않는다.
 */
function readPromotion(): { promotion: PromotionVerdict | null; note: string } {
  try {
    const out = execFileSync(process.execPath, [
      ...process.execArgv, 'scripts/d100-master-readiness.mts', '--json',
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, timeout: 180_000 })
    const j = JSON.parse(out) as { promotion?: PromotionVerdict }
    return j.promotion === undefined
      ? { promotion: null, note: '준비도 JSON 에 promotion 이 없다' }
      : { promotion: j.promotion, note: 'd100:readiness 정본 judgePromotion' }
  } catch (e) {
    return { promotion: null, note: `준비도를 읽지 못했다 — ${(e as Error).name} (지속 승격을 열지 않는다)` }
  }
}

/**
 * 🔴 **KST 날짜 D · 단계 S 의 운영 증거 판정** — 읽기만 한다.
 *    DB 사실(`readStageEvidenceFacts`) · 그날 장부(`readCostSignals` · 정본 `judgeCost`) · 러너 최근 회차.
 *    어느 것이든 못 읽으면 그 칸은 모름이다 — PASS 가 되지 않는다(fail-closed = 지금 단계에 머문다).
 */
async function evidenceFor(prisma: PrismaClient, i: {
  kstDate: string; stage: RuntimeStage; decision: ValidatedStageDecision | null; errors: HealthSignal
}): Promise<StageEvidenceVerdict> {
  let facts: StageEvidenceFacts | null = null
  try {
    /**
     * 🔴 글당 Persona 댓글 상한은 **정본 env 의 댓글 단계**에서 온다(`personaCommentCapFor`).
     *    정본 env 를 못 읽었으면 모른다(null) — 무인 댓글 루프가 쓰는 같은 파일이다.
     */
    const ce = readEnvKeys([COMMENT_STAGE_ENV])
    const commentCapPerPost = ce.ok ? personaCommentCapFor(readCommentStage(ce.values).stage) : null
    facts = await readStageEvidenceFacts(prisma, {
      kstDate: i.kstDate, stage: i.stage, decision: i.decision, now: NOW, commentCapPerPost,
    })
  } catch (e) { log(`   ⬚ 운영 증거를 읽지 못했다 — ${(e as Error).name} (모름 = PASS 아님)`) }
  let side: EvidenceSideSignals | null = null
  try {
    // 🔴 그날의 장부 — 장부 날짜 경계는 KST 다(정본 `ledgerDateOf`). 정오는 그 날짜 안의 한 시각일 뿐이다
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

function observeErrors(): HealthSignal {
  const pub = observeJob('com.soransoran.original-post-runner')
  const sup = observeJob('com.soransoran.supply-process')
  return errorSignalOf([
    { label: pub.label, loaded: pub.state === 'loaded', failing: pub.launchdFailing },
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
    if (JSON_OUT) console.log(JSON.stringify({ date, decision: decision === null ? null : { state: decision.state, release: decision.release }, evidence: v }, null, 2))
    else {
      log(`\n══ 운영 증거 ${date} · ${stage} (read-only · DB write 0) ══`)
      log(`   결정  ${decision === null ? '없음/깨짐' : `${decision.state} · 공개 ${decision.release}`}`)
      log(`   ${evidenceReasonOf(v)}`)
      if (decision !== null) {
        const plan = trialPlanOf(decision, v)
        log(`   ▸ 다음 날 시험  ${plan === null ? '없음 — 지금 단계를 지킨다' : `${plan.target} (기반 ${plan.base} · ${plan.basis})`}\n`)
      }
    }
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<number> {
  if (EVIDENCE_DATE !== null) return evidenceOnly(EVIDENCE_DATE)
  const env = readEnvKeys(['SORAN_RELEASE_STAGE', 'SORAN_CAPACITY_STAGE', CONTROLLER_ENV])
  const envRelease = resolveRuntimeStage(env.values.SORAN_RELEASE_STAGE, 'release')
  /**
   * 🔴 **승인 천장 — `resolveCeiling`** (2026-09-29). d100 을 적어도 d1 로 떨어지지 않고, 열 수 있는 천장(d50)으로 묶인다.
   *    모르는 값은 d1(fail-closed). 사다리에는 **열 수 있는 천장**만 넘긴다 — 이 controller 는 천장을 올리지 않는다.
   */
  const ceilingRes = resolveCeiling(env.values.SORAN_CAPACITY_STAGE)
  const ceiling = { stage: ceilingRes.operable, fromEnv: ceilingRes.fallbackReason === null }
  const flagOn = controllerEnabled(env.values)
  log('\n══ 단계 controller ══')
  log(`   ${TODAY} · ${APPLY ? '--apply' : 'dry-run'} · ${CONTROLLER_ENV}=${flagOn ? 'on' : 'off'}`)
  log(`   env 공개 ${envRelease.stage}${envRelease.fromEnv ? '' : ' (env 값 아님)'} · 승인 천장 ${ceilingRes.authorized}`
    + `${ceilingRes.authorized !== ceilingRes.operable ? ` (러너가 담는 천장 ${ceilingRes.operable})` : ''}${ceiling.fromEnv ? '' : ' (env 값 아님)'}`)

  if (!fillDbConnection()) {
    console.error('🔴 DATABASE_URL 이 없다 — 결정을 읽지도 쓰지도 못한다. 지금 공개 단계는 바뀌지 않는다')
    return 1
  }
  const prisma = new PrismaClient()
  try {
    const decidedAt = NOW.toISOString()
    const failures: string[] = []

    // ① 전날 결정 — 시험 기반과 지속 공개 단계의 정본
    let previous: ValidatedStageDecision | null = null
    const prevDate = previousKstDate(TODAY)
    try {
      if (prevDate !== null) {
        const r = await readStageDecision(prisma, prevDate)
        if (r.found && r.result.ok) previous = r.result.decision
        else if (r.found && !r.result.ok) log(`   🔴 전날 결정이 깨졌다 — ${r.result.reason} (기반으로 쓰지 않는다)`)
      }
    } catch (e) { failures.push(`전날 결정을 읽지 못했다 — ${(e as Error).name}`) }

    // ①-b 전날 운영 증거 — 🔴 시험 대상은 날짜가 아니라 이 판정과 전날 결정이 정한다
    const errorSignal = observeErrors()
    let evidence: StageEvidenceVerdict | null = null
    if (previous !== null) {
      evidence = await evidenceFor(prisma, {
        kstDate: previous.kstDate, stage: previous.release, decision: previous, errors: errorSignal,
      })
      log(`   ${evidence.verdict === 'PASS' ? '🟢' : '🔴'} ${evidenceReasonOf(evidence)}`)
    }
    const plan = previous === null ? null : trialPlanOf(previous, evidence)
    log(`   시험 계획  ${plan === null ? '없음 — 지금 단계를 지킨다' : `${plan.target} (기반 ${plan.base} · ${plan.basis})`}`)

    // ② 재고 판정 · 하루 시험 — 발행 러너와 같은 조립(loadPublishableStock)
    let verdicts: StageVerdict[] = []
    let daily: DatedCanary | null = null
    let nextPreflight: PreflightVerdict | null = null
    let publishedToday = 0
    try {
      /**
       * 🔴 **러너와 같은 열림 판정으로 읽는다** (2026-09-29 generic scheduler 배선).
       *    앞판은 `autoReadyOpen` 을 넘기지 않아(기본 닫힘) 자동 READY 가 열린 날에도 하루 시험 판정이
       *    자동 재고를 **0 으로** 봤다 — 러너(`auditAwareGate`)는 그 재고로 발행한다. 사람 재고로는 채울 수 없는
       *    D20 이상 시험이 영영 열리지 않는다. 정본 env 에서 스위치 키 하나만 읽는다.
       */
      const autoOpen = await auditAwareGate(prisma, readEnvKeys(PREFLIGHT_ENV_KEYS).values, NOW)
      const s = await loadPublishableStock(prisma, NOW, { autoReadyOpen: autoOpen.open })
      publishedToday = s.publishedToday
      const axis = { now: NOW, publishedToday }
      // 🔴 천장 단계까지 판정한다 — 천장 d10 이면 예전과 같은 네 단계다
      verdicts = stageVerdicts({ queue: s.queueCandidates, personas: s.personas as never, history: s.history, axis, upTo: ceiling.stage })
      // 🔴 앞판: `nextStage(previous.release)` — 전날 시험이 실패해도 날짜만으로 한 칸 올렸다
      const base = plan?.base ?? null
      const target = plan?.target ?? null
      if (base !== null && target !== null) {
        const slotsLeft = slotsLeftToday(target, NOW)
        const sim = simulateStage({
          stage: target, queue: s.queueCandidates, personas: s.personas as never, history: s.history,
          axis, days: 1, anchor: 'now', dailyCap: Math.max(0, profileOf(target).dailyTarget - publishedToday),
        })
        daily = {
          kstDate: TODAY, stage: target, builtAt: decidedAt, trialBase: base,
          verdict: judgeOneDayCanary(sim, { publishedToday, slotsLeft }),
        }
        /**
         * 🔴 **D20 이상 시험 대상 — preflight 사실을 모아 판정한다.** d3~d10 은 #620 관문 그대로라 모으지 않는다.
         *    천장 위 대상도 모으지 않는다 — 사다리가 CEILING 으로 막는다(이유가 둘로 갈리지 않게).
         *    못 모은 칸은 모름(UNKNOWN)이다 — 사다리가 시험을 열지 않는다.
         */
        if (needsExtendedGate(target) && previous !== null && stageRank(target) <= stageRank(ceiling.stage)) {
          const pe = readEnvKeys(PREFLIGHT_ENV_KEYS)
          const r = await readPreflightFacts(prisma, { loaded: s, autoOpen, evidenceDate: previous.kstDate, env: pe.values })
          nextPreflight = judgeNextPreflight(target, r.facts, RUNNER_GRID)
          log(`   ${target} preflight ${nextPreflight.verdict}${nextPreflight.codes.length > 0 ? ` [${nextPreflight.codes.join(',')}]` : ''}`
            + ` (${Object.entries(nextPreflight.counts).map(([k, x]) => `${k}=${x}`).join(',')})`)
          for (const n of r.notes) log(`      ⬚ ${n}`)
        }
      }
    } catch (e) { failures.push(`재고를 읽지 못했다 — ${(e as Error).name}`) }

    // ③ 지속 승격 — 정본 준비도
    const promo = readPromotion()
    log(`   지속 승격 판정  ${promo.promotion === null ? '없음' : `${promo.promotion.current}→${promo.promotion.next} ready=${promo.promotion.ready}`} · ${promo.note}`)

    // ④ 운영 신호 — 품질 · 비용 · 오류
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

    // ⑤ 결정
    let result: ControllerResult
    if (failures.length > 0) {
      const current = sustainedReleaseOf(previous, envRelease.stage)
      result = {
        decision: holdAtCurrent({ kstDate: TODAY, decidedAt, current, ceiling: ceiling.stage, reason: failures.join(' · ') }),
        brake: 'controllerFailure', sustained: current,
      }
    } else {
      result = decideStage({
        kstDate: TODAY, decidedAt, envRelease: envRelease.stage, authorizedCeiling: ceiling.stage,
        previousDecision: previous, previousEvidence: evidence, verdicts, daily, nextPreflight, promotion: promo.promotion, publishedToday, signals,
      })
    }
    const v = validateForToday(result.decision)

    if (JSON_OUT) {
      console.log(JSON.stringify({ today: TODAY, apply: APPLY, flagOn, ceiling: ceilingRes, result, valid: v.ok, signals, failures, evidence, plan, nextPreflight }, null, 2))
    } else {
      for (const s of signals) log(`   ${s.health === 'ok' ? '🟢' : s.health === 'bad' ? '🔴' : '⚪'} ${s.axis.padEnd(8)} ${s.reasons.join(' · ') || '정상'}`)
      const d = result.decision
      log(`\n   ▸ 결정  ${d.state} · 공개 ${d.release} · 천장 ${d.capacity} · 브레이크 ${result.brake} · 지속 ${result.sustained}`)
      for (const r of d.reasons) log(`      · ${r}`)
      for (const b of d.blocks) log(`      🔴 ${b.code}: ${b.reason}`)
      log(`   검증  ${v.ok ? '🟢 통과' : `🔴 ${v.reason}`}`)
    }
    if (!v.ok) { console.error(`🔴 계산한 결정이 계약을 지키지 않는다 — 저장하지 않는다: ${v.reason}`); return 1 }

    if (!APPLY) { log('\n🔴 dry-run — DB write 0. 저장은 --apply + 정본 env 의 flag on 일 때만\n'); return 0 }
    if (!flagOn) {
      log(`\n🔴 ${CONTROLLER_ENV} 가 on 이 아니다 — 저장하지 않는다 (러너는 기존 env/canary 경로로 돈다)\n`)
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
      // 🔴 DB 에 못 닿았다 — 아무것도 쓰지 않았다. 지금 공개 단계는 바뀌지 않는다
      console.error(`🔴 저장 경로에 닿지 못했다 — ${(e as Error).name}. 아무것도 쓰지 않았다`)
      return 1
    }
    if (!out.ok) { console.error(`🔴 저장 실패 ${out.code} — ${out.reason}`); return 1 }
    log(`\n   ${out.created ? '🟢 저장했다' : '🟢 이미 있어 읽었다(덮지 않는다)'} — ${out.decision.state} · 공개 ${out.decision.release} · 천장 ${out.decision.capacity}\n`)
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

process.exit(await main())
