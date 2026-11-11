/**
 * 🔴 **ops shadow 한 사이클 — 공용 본문** (2026-11-11 · Phase 1 S1/S2 + Phase 2 observer · 권위 0)
 *
 *    손 실행(`scripts/ops-shadow-plan.mts`)과 observer(`scripts/ops-shadow-observer.mts`)가 **이 함수 하나**를 부른다 —
 *    관측 · 계획 · 기록 규칙이 두 벌로 갈라지지 않게. 다른 것은 관측 시각 · 기록 날짜 · 출처(`source`)뿐이다.
 *
 *    🔴 가드(`installShadowCallGuard`)가 걸려 있어야만 돈다 — fetch · 자식 프로세스 0, DB 는 읽기 전용 프록시.
 *    🔴 `backfill`(완료 뒤 늦게 본 자연 회차)은 **최소 marker 한 줄**만 쓴다 — 결정 · 장부 · DB · 공급 snapshot 을 읽지 않고
 *       봉투 · 계획 · 관측 · 부족분 · 결과 · writer · dayClose 가 없다. 지금 상태를 지난 시각처럼 적지 않는다.
 *    🔴 관측 시각(`at`)은 언제나 실제로 본 시각이다(observer 는 그 tick). 회차 완료 시각은 `source.completedAt` 출처로만 남는다.
 *    🔴 cycle id — 자연 회차는 회차 열쇠(`naturalRunKeyOf`), 손 실행은 입력 해시. dayClose 는 그날 마지막 자연 회차의
 *       열쇠로 고정한다(마감 뒤 측정값이 바뀌어도 dayClose 는 한 줄).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { NaturalRunSource, ShadowBackfillMarker, ShadowObservedRecord, ShadowRecord, ShadowSource } from '../../src/lib/ops-shadow-plan'
import { appendShadowRecord, isShadowGuardInstalled, readLatestTrace, readOnlyDb, readSupplyRuns } from './ops-shadow-io.mjs'

export type ShadowCycleOptions = {
  /** 🔴 실제 관측 시각 — 손 실행은 지금(또는 과거 주입) · observer 는 그 tick 의 시각(회차 완료 시각이 아니다) */
  now: Date
  clock: ShadowRecord['clock']
  /** 기록 날짜(KST) — 손 실행은 관측 시각의 날짜, observer 는 회차의 자연 증거 시각의 날짜 */
  kstDate: string
  source: ShadowSource
  dataDir: string
  outDir: string
  dry: boolean
  json: boolean
  log: (line: string) => void
}

export type ShadowCycleResult =
  | { ok: true; records: ShadowRecord[]; written: number }
  /** 그날 controller 결정을 읽지 못했다 — 봉투 상한을 모른다(기록 0) */
  | { ok: false; code: 'DECISION_MISSING'; records: []; written: 0 }

/** runtime SHA — 배포 manifest 를 읽는다(자식 프로세스 git 은 막혀 있다) */
function readRuntimeSha(): string | null {
  try {
    const m = JSON.parse(readFileSync(join(homedir(), 'Library', 'Application Support', 'soransoran', 'runtime-manifest.json'), 'utf-8')) as { sha?: unknown }
    return typeof m.sha === 'string' ? m.sha : null
  } catch { return null }
}

/**
 * 🔴 **backfill marker** — 늦게 본 자연 회차 한 줄. 결정 · 장부 · DB · 공급 snapshot 을 **부르지 않는다**(연결도 하지 않는다).
 *    cycle id 는 회차 열쇠라 causal 기록과 같은 자리다 — 둘 중 먼저 쓴 한 줄만 남는다.
 */
async function writeBackfillMarker(o: ShadowCycleOptions, source: NaturalRunSource<'backfill'>): Promise<ShadowCycleResult> {
  const { OPS_SHADOW_VERSION, cycleIdOf, inputHashOf } = await import('../../src/lib/ops-shadow-plan')
  const marker: ShadowBackfillMarker = {
    v: OPS_SHADOW_VERSION, cycleId: cycleIdOf('cycle', o.kstDate, source.key), kind: 'cycle', kstDate: o.kstDate,
    at: o.now.toISOString(), inputHash: inputHashOf({ source }), runtimeSha: readRuntimeSha(), clock: o.clock, source,
    authority: 'none', envelope: null, plan: null, observation: null, deficit: null, outcome: null, writer: null,
  }
  let written = 0
  if (o.json) o.log(JSON.stringify(marker))
  if (!o.dry) {
    const w = appendShadowRecord(o.outDir, marker)
    if (w.written) written = 1
    o.log(`${w.written ? '🟢 기록' : '🟡 이미 있음(같은 사이클)'} backfill marker ${marker.cycleId} → ${w.path}`)
  }
  o.log('   backfill — 결정 · 장부 · DB · snapshot 읽기 0 · 계획 · 부족분 · 결과 · dayClose 없음 · 🔴 실행 0 · 권위 0')
  return { ok: true, records: [marker], written }
}

export async function runShadowCycle(o: ShadowCycleOptions): Promise<ShadowCycleResult> {
  if (!isShadowGuardInstalled()) throw new Error('OPS_SHADOW_GUARD_MISSING — installShadowCallGuard() 를 먼저 부른다')
  const source = o.source
  // 🔴 backfill 은 여기서 끝난다 — 아래의 결정 · 장부 · DB · snapshot 을 하나도 부르지 않는다
  if (source.kind === 'naturalRun' && source.mode === 'backfill') return writeBackfillMarker(o, source)
  const {
    OPS_SHADOW_VERSION, costPerPaidSourceOf, cycleIdOf, dailyOperatingPlanOf, dailyOutcomeOf, freshCapacityFromTrace,
    inputHashOf, naturalRunKeyOf, operatingEnvelopeOf, planDeficit, sanitizeObservation, writerDueOf,
  } = await import('../../src/lib/ops-shadow-plan')
  const { profileOf } = await import('../../src/lib/scale-profile')
  const { readStageDecision } = await import('../../src/lib/stage-decision-repo')
  const { readStageEvidenceFacts } = await import('../../src/lib/stage-evidence-repo')
  const { PERSONA_COMMENTS_PER_POST_MAX } = await import('../../src/lib/persona-target-rules')
  const { classifyReservations, ledgerDateOf, previousLedgerDate, tallyOf } = await import('../../src/lib/llm-ledger')
  const { SUPPLY_RUN_WINDOW_MS } = await import('../../src/lib/supply-schedule-contract')
  const { readSpeakerLoad, SPEAKER_LOAD_FILE } = await import('../../src/lib/content-core/speaker-load-file')
  const { createAttemptPool } = await import('../../src/lib/content-core/speaker-availability')
  const { defaultLedgerDir, ledgerPathOf, pidAlive, readLedgerDay, readOpenReservations, readSettleHold } = await import('./llm-ledger-store.mjs')
  const { limitsFromEnv } = await import('./supply-llm-call.mjs')
  const { fillDbConnection, readEnvKeys } = await import('./ops-signals.mjs')
  const { PREFLIGHT_ENV_KEYS } = await import('./stage-preflight-facts.mjs')
  const { snapshot } = await import('../supply-process.mjs')

  if (!fillDbConnection()) throw new Error('DATABASE_URL 이 없다')
  const env: Record<string, string | undefined> = { ...process.env, ...readEnvKeys(PREFLIGHT_ENV_KEYS).values }
  const { now, kstDate, dataDir } = o
  const runtimeSha = readRuntimeSha()

  const { PrismaClient } = await import('@prisma/client')
  const raw = new PrismaClient()
  const db = readOnlyDb(raw)
  try {
    // ── controller 결정 — 관측된 의도 · 지금 발행기가 강제하는 공개 상한의 근거 ──
    const dec = await readStageDecision(db, kstDate)
    const validated = dec.found && dec.result.ok ? dec.result.decision : null
    if (validated === null) {
      o.log(`🔴 ${kstDate} controller 결정을 읽지 못했다 — 봉투 상한을 모른다(기록 0)`)
      return { ok: false, code: 'DECISION_MISSING', records: [], written: 0 }
    }
    const profile = profileOf(validated.release)
    const slotsPerDay = profile.slots.reduce((n, s) => n + s.count, 0)
    const limits = limitsFromEnv(env as NodeJS.ProcessEnv)
    const envelope = operatingEnvelopeOf({
      publishHardCapPerDay: profile.dailyTarget, publishSlotsPerDay: slotsPerDay, supplyDailyUsd: limits.dailyUsd,
    })
    const plan = dailyOperatingPlanOf(envelope, kstDate, {
      kstDate: validated.kstDate, state: validated.state, releaseDailyTarget: profile.dailyTarget,
    })

    // ── 장부 · 공급 회차 ──
    const ledgerDir = defaultLedgerDir()
    const lDate = ledgerDateOf(now)
    const today = readLedgerDay(ledgerPathOf(ledgerDir, lDate))
    const runRead = readSupplyRuns(dataDir)
    const runs = runRead.runs

    // ── 관측 · 부족분 — 여기 오는 것은 손 실행 · causal 뿐(backfill 은 위에서 marker 만 쓰고 끝났다) ──
    let recorded: ShadowObservedRecord['observation'] = null
    let deficit: ShadowObservedRecord['deficit'] = null
    {
      const snap = await snapshot(db, { env, now, dataDir })
      const openRead = readOpenReservations(ledgerDir)
      const split = classifyReservations({
        open: openRead.ok ? openRead.list : [], now, sessionId: 'ops-shadow', pid: process.pid, pidAlive,
      })
      // 화자 — 생성 러너의 유일한 입구(createAttemptPool)
      const speakerRaw = ((): unknown => { try { return JSON.parse(readFileSync(join(dataDir, SPEAKER_LOAD_FILE), 'utf-8')) } catch { return null } })()
      const reader = readSpeakerLoad(speakerRaw, now, null)
      const codes = speakerRaw !== null && typeof speakerRaw === 'object' && (speakerRaw as { byCode?: unknown }).byCode !== null
        && typeof (speakerRaw as { byCode?: unknown }).byCode === 'object'
        ? Object.keys((speakerRaw as { byCode: Record<string, unknown> }).byCode) : []
      const attemptableSpeakers = !reader.loaded || reader.attemptCapacityOf === null ? null
        : createAttemptPool({
          attemptCapacity: codes.map((code) => ({ code, attemptCapacity: reader.attemptCapacityOf!(code) })),
          attemptDemand: codes.length,
        }).attemptSupply
      // 단가 — 표본이 완전할 때만
      const days = new Map<string, boolean>()
      const byLedgerRun = new Map<string, { settledUsd: number; settled: number; unsettled: number; blocked: number }>()
      let d = lDate
      for (let i = 0; i < 3; i += 1) {
        const r = readLedgerDay(ledgerPathOf(ledgerDir, d))
        days.set(d, r.ok)
        if (r.ok) {
          for (const e of r.entries) {
            if (e.stage === 'countTokens') continue
            const ev = byLedgerRun.get(e.runId) ?? { settledUsd: 0, settled: 0, unsettled: 0, blocked: 0 }
            if (e.status === 'settled' && e.settledUsd !== null) { ev.settledUsd += e.settledUsd; ev.settled += 1 }
            else if (e.status === 'blocked') ev.blocked += 1
            else ev.unsettled += 1
            byLedgerRun.set(e.runId, ev)
          }
        }
        d = previousLedgerDate(d)
      }
      const sampled = runs.map((r) => ({ runId: r.runId, paidSources: r.paidSources, ledgerDate: ledgerDateOf(new Date(r.startedAt)) }))
      // 🔴 회차 기록을 못 읽거나 깨진 회차가 있으면 진행 여부를 모른다(null · 가상 묶음 0)
      const inProgress = !runRead.readable || runRead.malformed.length > 0 ? null
        : runs.some((r) => r.status !== 'done' && now.getTime() - Date.parse(r.startedAt) < SUPPLY_RUN_WINDOW_MS)
      const nowMinute = Math.floor((now.getTime() + 9 * 3_600_000) % 86_400_000 / 60_000)
      const slotsDueSoFar = profile.slots.filter((s) => s.hour * 60 + s.minute <= nowMinute).reduce((n, s) => n + s.count, 0)
      const observation = {
        at: now.toISOString(), kstDate,
        jit: snap.jit === null ? null : { slots: snap.jit.slots, readyFilled: snap.jit.readyFilled },
        inFlightExpectedReady: snap.classification === null ? null : snap.classification.counts.autoReadyPending,
        sourceYieldHigh: snap.sourceYield?.high ?? null,
        attemptableSpeakers,
        freshSourceCandidates: freshCapacityFromTrace(readLatestTrace(dataDir), now),
        ledger: {
          ok: today.ok && openRead.ok,
          limits,
          tally: today.ok ? tallyOf(today.entries) : tallyOf([]),
          settleHold: readSettleHold(ledgerDir),
          unresolved: split.unresolved,
        },
        costPerPaidSourceUsd: costPerPaidSourceOf(sampled, days, byLedgerRun),
        slotsDueSoFar,
        supplyRunInProgress: inProgress,
      }
      deficit = planDeficit(envelope, observation)
      // 🔴 기록 · 해시는 정제된 관측으로만 — 보류 사유 · 예약 원문 없음
      recorded = sanitizeObservation(observation)
    }
    const writer = writerDueOf(kstDate, now, runs, runRead.malformed)

    const cycleHash = inputHashOf({ envelope, plan, observation: recorded, source })
    const cycle: ShadowObservedRecord = {
      v: OPS_SHADOW_VERSION,
      cycleId: cycleIdOf('cycle', kstDate, source.kind === 'naturalRun' ? source.key : cycleHash),
      kind: 'cycle', kstDate, at: now.toISOString(), inputHash: cycleHash, runtimeSha, clock: o.clock, source,
      authority: 'none', envelope, plan, observation: recorded, deficit, outcome: null, writer,
    }
    const records: ShadowRecord[] = [cycle]
    if (writer.due && writer.runId !== null && writer.completedAt !== null) {
      const facts = await readStageEvidenceFacts(db, {
        kstDate, stage: validated.release, decision: validated, now, commentCapPerPost: PERSONA_COMMENTS_PER_POST_MAX,
      })
      const outcome = dailyOutcomeOf(envelope, plan, { posts: facts.posts, tally: today.ok ? tallyOf(today.entries) : null })
      const closeHash = inputHashOf({ envelope, plan, outcome, writerRun: writer.runId, source })
      const dayClose: ShadowObservedRecord = {
        ...cycle,
        // 🔴 그날 마지막 자연 회차로 고정 — 마감 뒤 측정값이 바뀌어도 dayClose 는 한 줄
        cycleId: cycleIdOf('dayClose', kstDate, naturalRunKeyOf(writer.runId, writer.completedAt)),
        kind: 'dayClose', inputHash: closeHash, observation: null, deficit: null, outcome,
      }
      records.push(dayClose)
    }

    let written = 0
    for (const r of records) {
      if (o.json) o.log(JSON.stringify(r))
      if (o.dry) continue
      const w = appendShadowRecord(o.outDir, r)
      if (w.written) written += 1
      o.log(`${w.written ? '🟢 기록' : '🟡 이미 있음(같은 사이클)'} ${r.kind} ${r.cycleId} → ${w.path}`)
    }
    o.log(`   계획 ${plan.dayKind} · 상한 ${plan.publishCap}`
      + (deficit === null ? ' · backfill(부족분 계획 없음)' : ` · 부족 ${deficit.deficitAfterInFlight} · 가상 묶음 ${deficit.wouldRunSources}`
        + ` ($${deficit.wouldSpendUsd.toFixed(4)}) · 제한 ${deficit.limitedBy.join(',') || '-'}`)
      + ` · writer ${writer.due ? 'due' : 'not-due'} · 🔴 실행 0 · 권위 0`)
    return { ok: true, records, written }
  } finally {
    await raw.$disconnect()
  }
}
