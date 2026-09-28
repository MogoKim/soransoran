#!/usr/bin/env tsx
/**
 * 🔴 **하루 단계 controller — 정본 사다리 + 운영 신호 브레이크 → StageDecision 저장**
 *
 *   npm run stage:controller              dry-run — 결정을 계산해 보여 준다. DB write 0
 *   npm run stage:controller -- --apply   저장 — 🔴 정본 env 에 STAGE_CONTROLLER_ENABLED=on 일 때만
 *   npm run stage:controller -- --json    기계가 읽는 값
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
 */
import { execFileSync } from 'node:child_process'

import { PrismaClient } from '@prisma/client'

import { PROFILES, resolveStage, type ReleaseStage, type StageVerdict } from '../src/lib/scale-profile'
import { simulateStage, stageVerdicts } from '../src/lib/scale-readiness'
import { judgeOneDayCanary, kstDateString, slotsLeftToday } from '../src/lib/release-canary'
import { previousKstDate, nextStage, DECISION_WRITER, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import { ensureStageDecision, controllerEnabled, CONTROLLER_ENV } from '../src/lib/stage-decision-store'
import { readStageDecision, stageDecisionIo } from '../src/lib/stage-decision-repo'
import type { DatedCanary } from '../src/lib/stage-ladder'
import type { PromotionVerdict } from '../src/lib/d100-capacity'
import {
  decideStage, holdAtCurrent, validateForToday, qualitySignalOf, costSignalOf, errorSignalOf,
  sustainedReleaseOf, type HealthSignal, type ControllerResult,
} from '../src/lib/stage-controller'
import { confirmedDefectCount, missingAutoPostCount } from '../src/lib/auto-ready-repo'
import { overdueAuditCount, retryableFailureCount } from '../src/lib/auto-ready-audit-store'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { observeJob, readProcessRuns, supplyFailing } from './lib/runner-health.mjs'
import { fillDbConnection, readCostSignals, readEnvKeys } from './lib/ops-signals.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const JSON_OUT = argv.includes('--json')
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

async function main(): Promise<number> {
  const env = readEnvKeys(['SORAN_RELEASE_STAGE', 'SORAN_CAPACITY_STAGE', CONTROLLER_ENV])
  const envRelease = resolveStage(env.values.SORAN_RELEASE_STAGE, 'release')
  const ceiling = resolveStage(env.values.SORAN_CAPACITY_STAGE, 'capacity')
  const flagOn = controllerEnabled(env.values)
  log('\n══ 단계 controller ══')
  log(`   ${TODAY} · ${APPLY ? '--apply' : 'dry-run'} · ${CONTROLLER_ENV}=${flagOn ? 'on' : 'off'}`)
  log(`   env 공개 ${envRelease.stage}${envRelease.fromEnv ? '' : ' (env 값 아님)'} · 승인 천장 ${ceiling.stage}${ceiling.fromEnv ? '' : ' (env 값 아님)'}`)

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

    // ② 재고 판정 · 하루 시험 — 발행 러너와 같은 조립(loadPublishableStock)
    let verdicts: StageVerdict[] = []
    let daily: DatedCanary | null = null
    let publishedToday = 0
    try {
      const s = await loadPublishableStock(prisma, NOW)
      publishedToday = s.publishedToday
      const axis = { now: NOW, publishedToday }
      verdicts = stageVerdicts({ queue: s.queueCandidates, personas: s.personas as never, history: s.history, axis })
      const base = previous?.release ?? null
      const target = base === null ? null : nextStage(base)
      if (base !== null && target !== null) {
        const slotsLeft = slotsLeftToday(target, NOW)
        const sim = simulateStage({
          stage: target, queue: s.queueCandidates, personas: s.personas as never, history: s.history,
          axis, days: 1, anchor: 'now', dailyCap: Math.max(0, PROFILES[target].dailyTarget - publishedToday),
        })
        daily = {
          kstDate: TODAY, stage: target, builtAt: decidedAt, trialBase: base,
          verdict: judgeOneDayCanary(sim, { publishedToday, slotsLeft }),
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
      { name: '공급·댓글 장부', health: cost.supplyLedger.health, reasons: cost.supplyLedger.reasons },
      { name: '감사 장부', health: cost.auditLedger.health, reasons: cost.auditLedger.reasons },
    ]))
    const pub = observeJob('com.soransoran.original-post-runner')
    const sup = observeJob('com.soransoran.supply-process')
    signals.push(errorSignalOf([
      { label: pub.label, loaded: pub.state === 'loaded', failing: pub.launchdFailing },
      { label: sup.label, loaded: sup.state === 'loaded', failing: supplyFailing(sup, readProcessRuns().runs) },
    ]))

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
        previousDecision: previous, verdicts, daily, promotion: promo.promotion, publishedToday, signals,
      })
    }
    const v = validateForToday(result.decision)

    if (JSON_OUT) {
      console.log(JSON.stringify({ today: TODAY, apply: APPLY, flagOn, result, valid: v.ok, signals, failures }, null, 2))
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
