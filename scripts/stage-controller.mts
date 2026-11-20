#!/usr/bin/env tsx
/**
 * 🔴 **하루 단계 controller — 한 사다리 + 운영 신호 브레이크 → StageDecision 저장**
 *
 *   npm run stage:controller              dry-run — 결정을 계산해 보여 준다. DB write 0
 *   npm run stage:controller -- --apply   저장 — 🔴 정본 env 에 STAGE_CONTROLLER_ENABLED=on 일 때만
 *   npm run stage:controller -- --json    기계가 읽는 값
 *   npm run stage:controller -- --evidence-date=YYYY-MM-DD [--evidence-days=N] [--evidence-stage=dN]
 *                                         🔴 read-only — 그날(부터 거꾸로 N일)의 하루 판정만 보여 준다(결정 계산·저장 0)
 *
 * 🔴 **쓰는 곳은 하나다** — `ensureStageDecision` → `createStageDecision`(create 뿐 · 덮어쓰기 0).
 *
 * 🔴 **fail-closed = 지금 공개 단계를 지킨다.**
 *    · 전날 결정이 깨짐·읽기 예외 → 계산·저장 0 · exit 1 (다음 예약이 다시 읽는다 · `resolvePreviousAuthority`)
 *    · 전날 결정이 없음        → 이틀 전 행 하나로 권한만 잇는 HOLD(`bridgeHoldOf`) · 둘 다 없으면 첫 시작 d1
 *    · 재고를 못 읽음          → `inputFailureHoldOf` (전날 행이 없으면 d1)
 *    · 운영 신호를 모름        → 올림만 막는다
 *    · DB 자체에 못 닿음       → 아무것도 쓰지 못한다 · exit 1 (consumer 는 정본 fallback)
 *
 * 🔴 **한 사다리** — 열린 단계의 하루 판정(`judgeStageEvidence` · 수 + 결의 비율 + 무결성)이 연속 통과하고 올라갈 칸의
 *    관문(`judgeNextPreflight` · Persona · 발행 구조)이 PASS 인 날 한 칸 올린다. 판정이 미달이어도 내리지 않는다 —
 *    공개 단계가 내려가는 길은 품질·비용·오류 브레이크뿐이다. 현재 단계의 입력원은 StageDecision 하나다.
 */
import { PrismaClient } from '@prisma/client'

import { profileOf, releaseCapsOf, resolveRuntimeStage, type RuntimeStage } from '../src/lib/scale-profile'
import { kstDateString } from '../src/lib/release-canary'
import {
  isCalendarDate, nextStage, previousKstDate, DECISION_WRITER, type StageDecision, type ValidatedStageDecision,
} from '../src/lib/stage-decision-contract'
import { ensureStageDecision, controllerEnabled, CONTROLLER_ENV } from '../src/lib/stage-decision-store'
import { readStageDecision, stageDecisionIo } from '../src/lib/stage-decision-repo'
import {
  decideStage, inputFailureHoldOf, authorityRowOf, leaseSafeHoldOf, validateForToday, qualitySignalOf, costSignalOf, errorSignalOf,
  openStageOf, resolvePreviousAuthority, bridgeHoldOf,
  type HealthSignal, type ControllerResult, type DecisionRead,
} from '../src/lib/stage-controller'
import { consecutivePassDays, type LadderDay } from '../src/lib/stage-ladder'
import { LADDER_RULE } from '../src/lib/ladder-table'
import { unresolvedDefectCount, missingAutoPostCount } from '../src/lib/auto-ready-repo'
import { auditAwareGate, overdueAuditCount, retryableFailureCount } from '../src/lib/auto-ready-audit-store'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { observeJob, publishFailing, readProcessRuns, supplyFailing, SUPPLY_DATA_DIR } from './lib/runner-health.mjs'
import { PUBLISH_RUN_MAX_AGE_MS, readPublishRunRecord } from './lib/publish-run-record.mjs'
import { fillDbConnection, readCostSignals, readEnvKeys } from './lib/ops-signals.mjs'
import {
  judgeStageEvidence, evidenceReasonOf, evidencePlainLineOf,
  type StageEvidenceVerdict, type StageEvidenceFacts, type EvidenceSideSignals,
} from '../src/lib/stage-evidence'
import { readStageEvidenceFacts } from '../src/lib/stage-evidence-repo'
import { judgeNextPreflight, preflightLogLine, preflightPlainLinesOf, slotTimesOn, type PreflightVerdict } from '../src/lib/stage-ladder-generic'
import { readPreflightFacts, PREFLIGHT_ENV_KEYS, RUNNER_GRID } from './lib/stage-preflight-facts.mjs'
import { readPersonaCapacity } from './lib/persona-reserve-facts.mjs'
import { probeSupplyLease } from './lib/supply-lease.mjs'
import { stageControllerLeaseDisposition } from './lib/ops-loop-templates'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const JSON_OUT = argv.includes('--json')
const argOf = (name: string): string | null => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
/** 🔴 read-only 판정 조회 — 이 모드는 결정을 계산하지도 저장하지도 않는다 */
const EVIDENCE_DATE = argOf('evidence-date')
const NOW = new Date()
const TODAY = kstDateString(NOW)

const log = (s: string): void => { if (!JSON_OUT) console.log(s) }

/**
 * KST 날짜 D · 단계 S 의 하루 판정 — 읽기만 한다.
 * 어느 것이든 못 읽으면 그 칸은 모름이다 — PASS 가 되지 않는다.
 */
async function evidenceFor(prisma: PrismaClient, i: {
  kstDate: string; stage: RuntimeStage; decision: ValidatedStageDecision | null
}): Promise<StageEvidenceVerdict> {
  let facts: StageEvidenceFacts | null = null
  try {
    facts = await readStageEvidenceFacts(prisma, { kstDate: i.kstDate, stage: i.stage, decision: i.decision, now: NOW })
  } catch (e) { log(`   ⬚ ${i.kstDate} 사실을 읽지 못했다 — ${(e as Error).name} (모름 = PASS 아님)`) }
  let side: EvidenceSideSignals | null = null
  try {
    const c = readCostSignals(new Date(`${i.kstDate}T12:00:00+09:00`))
    side = {
      cost: [
        { lane: 'comment', name: '댓글 장부', health: c.commentLedger.health },
        { lane: 'audit', name: '감사 장부', health: c.auditLedger.health },
      ],
      supplyCostEvidence: c.supplyCostEvidence,
    }
  } catch (e) { log(`   ⬚ ${i.kstDate} 장부를 읽지 못했다 — ${(e as Error).name} (모름 = PASS 아님)`) }
  return judgeStageEvidence(i.kstDate, i.stage, facts, side)
}

/** 저장 결정 한 날짜 판독 — 없음 · 유효 · 깨짐. DB 예외는 그대로 던진다(`resolvePreviousAuthority` 가 멈춤으로 바꾼다) */
const decisionReader = (prisma: PrismaClient) => async (kstDate: string): Promise<DecisionRead> => {
  const r = await readStageDecision(prisma, kstDate)
  if (!r.found) return { kind: 'absent' }
  return r.result.ok ? { kind: 'valid', decision: r.result.decision } : { kind: 'broken', reason: r.result.reason }
}

/** 그 날짜의 유효한 결정 행 — 없거나 깨졌거나 못 읽었으면 null(연속을 세지 않고 · 열린 단계를 되찾지 않는다) */
async function validRowOf(prisma: PrismaClient, kstDate: string | null): Promise<ValidatedStageDecision | null> {
  if (kstDate === null) return null
  try {
    const r = await readStageDecision(prisma, kstDate)
    return r.found && r.result.ok ? r.result.decision : null
  } catch { return null }
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
 * 계산한 결정을 저장한다 — create-only. 오늘 행이 이미 있으면 읽기만 한다(덮지 않는다).
 * dry-run · flag off 는 여기 오기 전에 걸러진다.
 */
async function saveDecision(prisma: PrismaClient, decision: StageDecision): Promise<number> {
  const io = stageDecisionIo(prisma, TODAY)
  try {
    const out = await ensureStageDecision({
      read: io.read, insert: io.insert, validate: io.validate, compute: () => decision, by: DECISION_WRITER,
    })
    if (!out.ok) { console.error(`🔴 저장 실패 ${out.code} — ${out.reason}`); return 1 }
    log(`\n   ${out.created ? '🟢 저장했다' : '🟢 이미 있어 읽었다(덮지 않는다)'} — ${out.decision.state} · 공개 ${out.decision.release} · 준비 ${out.decision.capacity}\n`)
    return 0
  } catch (e) {
    console.error(`🔴 저장 경로에 닿지 못했다 — ${(e as Error).name}. 아무것도 쓰지 않았다`)
    return 1
  }
}

const FLAG_OFF_NOTE = `🔴 ${CONTROLLER_ENV} 가 on 이 아니다 — 저장하지 않는다 (consumer 는 옛 env/canary 단계로 돌아가지 않고 가장 안전한 d1 로 감속한다)\n`

/**
 * 마지막 controller 예약까지 공급 lease가 끝나지 않은 날의 안전 결정(`leaseSafeHoldOf`).
 * 오늘의 부분 Queue는 읽지 않고, 전날 보이던 공개를 넘지 않는 HOLD만 기록한다. 열린 단계는 행에 따로 남긴다.
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
    const row = authorityRowOf(authority)
    const { decision, certified } = leaseSafeHoldOf({
      kstDate: TODAY, decidedAt: NOW.toISOString(), lease, authority,
      dayBefore: row === null ? null : await validRowOf(prisma, previousKstDate(row.kstDate)),
    })
    const valid = validateForToday(decision)
    if (!valid.ok) { console.error(`🔴 공급 lease 충돌 HOLD가 계약을 지키지 않는다 — ${valid.reason}`); return 1 }
    if (JSON_OUT) console.log(JSON.stringify({ today: TODAY, apply: APPLY, flagOn, supplyLease: lease, safeHold: true, decision }, null, 2))
    else log(`\n🟡 SUPPLY_LEASE_${lease.toUpperCase()} — 마지막 예약이므로 부분 재고로 올리지 않고 공개 ${decision.release} HOLD를 기록한다(열린 단계 ${certified})\n`)
    if (!flagOn) { log(FLAG_OFF_NOTE); return 0 }
    return await saveDecision(prisma, decision)
  } catch (e) {
    console.error(`🔴 공급 lease 충돌 HOLD 경로 실패 — ${(e as Error).name}`)
    return 1
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * 🔴 `--evidence-date` — 그날부터 거꾸로 `--evidence-days`(기본 1)일의 하루 판정을 보여 준다. **write 0**:
 *    부르는 것은 `readStageDecision`(findUnique) · `readStageEvidenceFacts`(findMany 뿐) · `readCostSignals`(장부 파일 읽기)다.
 *    결정을 계산하지 않고 `ensureStageDecision` 에 닿지 않는다.
 */
async function evidenceOnly(date: string): Promise<number> {
  if (!isCalendarDate(date)) { console.error(`🔴 달력에 없는 날짜 — ${date}`); return 1 }
  const days = Number(argOf('evidence-days') ?? '1')
  if (!Number.isInteger(days) || days < 1 || days > 31) { console.error('🔴 --evidence-days 는 1~31 정수'); return 1 }
  if (!fillDbConnection()) { console.error('🔴 DATABASE_URL 이 없다'); return 1 }
  const stageArg = argOf('evidence-stage')
  const prisma = new PrismaClient()
  try {
    const out: { date: string; decision: { state: string; release: string; contractVersion: string } | null; evidence: StageEvidenceVerdict }[] = []
    let cursor: string | null = date
    for (let k = 0; k < days && cursor !== null; k += 1, cursor = previousKstDate(cursor)) {
      const r = await readStageDecision(prisma, cursor)
      const decision = r.found && r.result.ok ? r.result.decision : null
      const stage = (stageArg !== null ? resolveRuntimeStage(stageArg, 'release').stage : decision?.release) ?? null
      if (stage === null) { console.error(`🔴 ${cursor} 결정이 없거나 깨졌다 — --evidence-stage 로 단계를 준다`); return 1 }
      const v = await evidenceFor(prisma, { kstDate: cursor, stage, decision })
      out.push({ date: cursor, decision: decision === null ? null : { state: decision.state, release: decision.release, contractVersion: decision.contractVersion }, evidence: v })
    }
    if (JSON_OUT) console.log(JSON.stringify(days === 1 ? out[0] : out, null, 2))
    else {
      log(`\n══ 하루 판정 ${date}${days > 1 ? ` 부터 거꾸로 ${days}일` : ''} (read-only · DB write 0) ══`)
      for (const o of out) {
        log(`   ${o.date} · ${o.evidence.stage} · 결정 ${o.decision === null ? '없음/깨짐' : `${o.decision.state} · 공개 ${o.decision.release}`}`)
        const plain = evidencePlainLineOf(o.evidence)
        if (plain !== null) log(`   ▸ ${plain}`)
        log(`   ${evidenceReasonOf(o.evidence)}\n`)
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
  log('\n══ 단계 controller ══')
  log(`   ${TODAY} · ${APPLY ? '--apply' : 'dry-run'} · ${CONTROLLER_ENV}=${flagOn ? 'on' : 'off'}`)

  /**
   * 🔴 06:15 공급이 아직 Queue 도장을 마치지 않았으면 07:00 결정은 불완전한 재고를 보게 된다.
   *    apply만 커널 lease 뒤로 미룬다. 앞 예약들은 DB read/write 0으로 물러나고 다음 예약이 다시 본다.
   *    마지막 예약에도 끝나지 않으면 부분 재고로 올리지 않고 HOLD만 기록한다.
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
    // 오늘 행이 이미 있으면 계산하지 않는다 — 하루 결정은 하나다
    if (APPLY) {
      const today = await readStageDecision(prisma, TODAY)
      if (today.found) {
        if (!today.result.ok) { console.error(`🔴 오늘 결정 행이 계약을 지키지 않는다 — ${today.result.reason}. 덮지 않는다`); return 1 }
        const d = today.result.decision
        log(`\n   🟢 이미 있어 읽었다(덮지 않는다) — ${d.state} · 공개 ${d.release} · 준비 ${d.capacity} · 계산 0\n`)
        return 0
      }
    }
    const computed = await computeToday(prisma, flagOn)
    if (computed === null) return 1
    const v = validateForToday(computed.decision)
    if (!v.ok) { console.error(`🔴 계산한 결정이 계약을 지키지 않는다 — 저장하지 않는다: ${v.reason}`); return 1 }
    if (!APPLY) { log('\n🔴 dry-run — DB write 0. 저장은 --apply + 정본 env 의 flag on 일 때만\n'); return 0 }
    if (!flagOn) { log(`\n${FLAG_OFF_NOTE}`); return 0 }
    return await saveDecision(prisma, computed.decision)
  } finally {
    await prisma.$disconnect()
  }
}

/** 오늘 결정 계산 — 전날 권한 · 이틀의 하루 판정 · 올라갈 칸의 관문 · 운영 신호. 저장하지 않는다. 멈춤이면 null */
async function computeToday(prisma: PrismaClient, flagOn: boolean): Promise<ControllerResult | null> {
  const decidedAt = NOW.toISOString()
  const failures: string[] = []

  // ① 전날 결정 — 깨짐·읽기 예외면 대체 결정을 계산·저장하지 않는다(다음 예약이 다시 읽는다)
  const authority = await resolvePreviousAuthority(TODAY, decisionReader(prisma))
  if (authority.kind === 'stop') {
    if (JSON_OUT) console.log(JSON.stringify({ today: TODAY, apply: APPLY, flagOn, stopped: true, code: authority.code, reason: authority.reason }, null, 2))
    console.error(`🔴 ${authority.code} — ${authority.reason}. 결정 계산 0 · DB write 0 — 다음 예약이 다시 읽는다`)
    return null
  }
  const previous: ValidatedStageDecision | null = authority.kind === 'exact' ? authority.previous : null
  /** 전날 행이 없을 때만 — 이틀 전 행. 권한만 잇고 올리지 않는다 */
  const bridge: ValidatedStageDecision | null = authority.kind === 'bridge' ? authority.bridge : null
  if (previous !== null) log(`   전날 결정 ${previous.state} · 공개 ${previous.release}`)
  if (bridge !== null) log(`   🟡 전날 결정 없음 — 이틀 전 ${bridge.kstDate} ${bridge.state} · 공개 ${bridge.release} 로 권한만 잇는다(올림 없음)`)
  if (authority.kind === 'first-run') log('   전날·이틀 전 결정 없음 — 첫 시작(d1)')

  // ①-b 전날과 이틀 전의 하루 판정 — 연속 통과를 센다(저장하지 않고 매일 다시 판정한다)
  const errorSignal = observeErrors()
  let evidence: StageEvidenceVerdict | null = null
  let dayBefore: LadderDay | null = null
  if (previous !== null) {
    evidence = await evidenceFor(prisma, { kstDate: previous.kstDate, stage: previous.release, decision: previous })
    const before = await validRowOf(prisma, previousKstDate(previous.kstDate))
    if (before !== null) {
      dayBefore = { decision: before, evidence: await evidenceFor(prisma, { kstDate: before.kstDate, stage: before.release, decision: before }) }
    }
  }
  const sustained = openStageOf(previous ?? bridge, dayBefore?.decision ?? null)
  const passDays = consecutivePassDays(TODAY, sustained, [previous === null ? null : { decision: previous, evidence }, dayBefore])
  for (const v of [dayBefore?.evidence ?? null, evidence]) {
    if (v === null) continue
    const plain = evidencePlainLineOf(v)
    if (plain !== null) log(`   ▸ ${plain}`)
    log(`   ${v.verdict === 'PASS' ? '🟢' : '🔴'} ${evidenceReasonOf(v)}`)
  }
  log(`   ▸ 열린 단계 ${sustained} · 연속 통과 ${Math.min(passDays, LADDER_RULE.consecutiveDays)}/${LADDER_RULE.consecutiveDays}일`)

  // ② 올라갈 칸의 관문 — 오늘 전체 슬롯 기준. 올릴 날이 아니어도 매일 본다(막힌 이유를 미리 안다)
  let nextPreflight: PreflightVerdict | null = null
  let publishedToday = 0
  let preflightDetail: Record<string, unknown> | null = null
  try {
    const pe = readEnvKeys(PREFLIGHT_ENV_KEYS)
    const autoOpen = await auditAwareGate(prisma, pe.values, NOW)
    const s = await loadPublishableStock(prisma, NOW, { autoReadyOpen: autoOpen.open })
    publishedToday = s.publishedToday
    const target = previous === null ? null : nextStage(sustained)
    if (target !== null && previous !== null) {
      const r = await readPreflightFacts(prisma, {
        loaded: s, autoOpen, proofSlots: slotTimesOn(TODAY, profileOf(target)),
        caps: releaseCapsOf(profileOf(target)), evidenceDate: previous.kstDate, env: pe.values,
        dataDir: SUPPLY_DATA_DIR, now: NOW,
        // 🔴 Persona 4상태 정본의 계약 유효 수 + stage-active 수 — 한 판독(활성 행 수 아님 · 못 읽으면 null = 모름)
        personaCapacity: () => readPersonaCapacity(prisma, { now: NOW, repoRoot: process.cwd() }),
      })
      nextPreflight = judgeNextPreflight(target, r.facts, RUNNER_GRID)
      preflightDetail = r.detail
      log(preflightLogLine(target, nextPreflight))
      for (const line of preflightPlainLinesOf(nextPreflight)) log(`   ▸ ${line}`)
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
      // 입력 실패 날은 오늘 신호를 판정하지 못했다 — 전날 행이 없으면 d1, 열린 단계는 행에 따로 남긴다(`inputFailureHoldOf`)
      decision: inputFailureHoldOf({ kstDate: TODAY, decidedAt, reason: failures.join(' · '), certified: sustained, authority }),
      brake: 'controllerFailure', sustained, passDays: 0,
    }
  } else if (bridge !== null) {
    result = bridgeHoldOf({ kstDate: TODAY, decidedAt, bridge, publishedToday, signals })
  } else {
    result = decideStage({
      kstDate: TODAY, decidedAt, previousDecision: previous, previousEvidence: evidence, dayBefore,
      nextPreflight, publishedToday, signals,
    })
  }
  const v = validateForToday(result.decision)

  if (JSON_OUT) {
    console.log(JSON.stringify({ today: TODAY, apply: APPLY, flagOn, result, valid: v.ok, signals, failures, evidence, dayBefore, nextPreflight, preflightDetail }, null, 2))
  } else {
    for (const s of signals) log(`   ${s.health === 'ok' ? '🟢' : s.health === 'bad' ? '🔴' : '⚪'} ${s.axis.padEnd(8)} ${s.reasons.join(' · ') || '정상'}`)
    const d = result.decision
    log(`\n   ▸ 결정  ${d.state} · 공개 ${d.release} · 준비 ${d.capacity} · 브레이크 ${result.brake} · 열린 단계 ${result.sustained}`)
    for (const r of d.reasons) log(`      · ${r}`)
    for (const b of d.blocks) log(`      🔴 ${b.code}: ${b.reason}`)
    log(`   검증  ${v.ok ? '🟢 통과' : `🔴 ${v.reason}`}`)
  }
  return result
}

process.exit(await main())
