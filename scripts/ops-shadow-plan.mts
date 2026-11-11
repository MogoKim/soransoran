#!/usr/bin/env tsx
/**
 * 🔴 **ops shadow 한 사이클 — Observe → Plan → (Act 없음) → Verify → 기록** (2026-11-11 · Phase 1 S1/S2 · 권위 0)
 *
 *   npm run ops:shadow-plan                 # 지금 관측으로 한 사이클 · 감사 장부에 한 줄
 *   npm run ops:shadow-plan -- --json       # 기록을 그대로 출력
 *   npm run ops:shadow-plan -- --dry        # 기록하지 않는다(출력만)
 *   npm run ops:shadow-plan -- --out-dir=<…/ops-shadow> --data-dir=<…>   # 시험용 경로
 *   npm run ops:shadow-plan -- --now=<ISO>  # 재생 · 시험용 관측 시각 — 🔴 지금보다 미래는 거부한다(기록에 clock: injected)
 *
 * 🔴 **아무것도 실행하지 않는다.** 가드를 먼저 건다 — fetch · 자식 프로세스는 던지고, DB 는 읽기 전용 프록시다.
 *    공급 · 수집 · 발행 · 댓글 · provider 호출, DB · stage · 장부 쓰기 0. 쓰는 것은 저장소 밖 감사 장부 한 줄뿐이다.
 * 🔴 운영 결정의 권위는 지금도 controller · 공급 러너다. 이 기록은 다음 단계(원자 전환)의 근거 자료일 뿐이다.
 * 🔴 하루 닫기(`dayClose`)는 시계가 아니라 **마지막 자연 공급 회차의 완료**가 트리거다(`writerDueOf`).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  appendShadowRecord, defaultOpsShadowDir, installShadowCallGuard, readLatestTrace, readOnlyDb, readSupplyRuns,
} from './lib/ops-shadow-io.mjs'

const argv = process.argv.slice(2)
const flag = (name: string): string | null => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
if (argv.some((a) => a === '--apply' || a === '--execute' || a === '--call' || a === '--live')) {
  console.error('🔴 shadow 에는 실행 명령이 없다 — 관측·기록만 한다')
  process.exit(2)
}

// 🔴 가드를 **먼저** 건다 — 아래 import 가 모듈 초기화에서 무엇을 부르든 밖으로 나가지 못한다
installShadowCallGuard()

const {
  OPS_SHADOW_VERSION, costPerPaidSourceOf, cycleIdOf, dailyOperatingPlanOf, dailyOutcomeOf, freshCapacityFromTrace,
  inputHashOf, operatingEnvelopeOf, planDeficit, sanitizeObservation, writerDueOf,
} = await import('../src/lib/ops-shadow-plan')
const { kstDateString } = await import('../src/lib/release-canary')
const { profileOf } = await import('../src/lib/scale-profile')
const { readStageDecision } = await import('../src/lib/stage-decision-repo')
const { readStageEvidenceFacts } = await import('../src/lib/stage-evidence-repo')
const { PERSONA_COMMENTS_PER_POST_MAX } = await import('../src/lib/persona-target-rules')
const { classifyReservations, ledgerDateOf, previousLedgerDate, tallyOf } = await import('../src/lib/llm-ledger')
const { SUPPLY_RUN_WINDOW_MS } = await import('../src/lib/supply-schedule-contract')
const { readSpeakerLoad } = await import('../src/lib/content-core/speaker-load-file')
const { SPEAKER_LOAD_FILE } = await import('../src/lib/content-core/speaker-load-file')
const { createAttemptPool } = await import('../src/lib/content-core/speaker-availability')
const { defaultLedgerDir, ledgerPathOf, pidAlive, readLedgerDay, readOpenReservations, readSettleHold } = await import('./lib/llm-ledger-store.mjs')
const { limitsFromEnv } = await import('./lib/supply-llm-call.mjs')
const { fillDbConnection, readEnvKeys } = await import('./lib/ops-signals.mjs')
const { PREFLIGHT_ENV_KEYS } = await import('./lib/stage-preflight-facts.mjs')
const { SUPPLY_DATA_DIR } = await import('./lib/runner-health.mjs')
const { snapshot } = await import('./supply-process.mjs')

type ShadowRecord = import('../src/lib/ops-shadow-plan').ShadowRecord
const fail = (m: string, code = 3): never => { console.error(`🔴 ${m}`); process.exit(code) }

if (!fillDbConnection()) fail('DATABASE_URL 이 없다')
const envRead = readEnvKeys(PREFLIGHT_ENV_KEYS)
const env: Record<string, string | undefined> = { ...process.env, ...envRead.values }
const dataDir = flag('data-dir') ?? SUPPLY_DATA_DIR
const outDir = flag('out-dir') ?? defaultOpsShadowDir()
const nowFlag = flag('now')
const realNow = new Date()
const now = nowFlag === null ? realNow : new Date(nowFlag)
if (nowFlag !== null && (Number.isNaN(now.getTime()) || now.toISOString() !== nowFlag || now.getTime() > realNow.getTime())) {
  fail('--now 는 지금보다 과거인 엄격 ISO 시각만 받는다', 2)
}
const clock: 'real' | 'injected' = nowFlag === null ? 'real' : 'injected'
const kstDate = kstDateString(now)

/** runtime SHA — 배포 manifest 를 읽는다(자식 프로세스 git 은 막혀 있다) */
const runtimeSha = ((): string | null => {
  try {
    const m = JSON.parse(readFileSync(join(homedir(), 'Library', 'Application Support', 'soransoran', 'runtime-manifest.json'), 'utf-8')) as { sha?: unknown }
    return typeof m.sha === 'string' ? m.sha : null
  } catch { return null }
})()

const { PrismaClient } = await import('@prisma/client')
const raw = new PrismaClient()
const db = readOnlyDb(raw)
try {
  // ── controller 결정 — 관측된 의도 · 지금 발행기가 강제하는 공개 상한의 근거 ──
  const dec = await readStageDecision(db, kstDate)
  const validated = dec.found && dec.result.ok ? dec.result.decision : null
  if (validated === null) fail(`오늘(${kstDate}) controller 결정을 읽지 못했다 — 봉투 상한을 모른다(기록 0)`)
  const profile = profileOf(validated!.release)
  const slotsPerDay = profile.slots.reduce((n, s) => n + s.count, 0)
  const limits = limitsFromEnv(env as NodeJS.ProcessEnv)
  const envelope = operatingEnvelopeOf({
    publishHardCapPerDay: profile.dailyTarget, publishSlotsPerDay: slotsPerDay, supplyDailyUsd: limits.dailyUsd,
  })
  const plan = dailyOperatingPlanOf(envelope, kstDate, {
    kstDate: validated!.kstDate, state: validated!.state, releaseDailyTarget: profile.dailyTarget,
  })

  // ── 공급 판독 — 운영 러너와 같은 snapshot ──
  const snap = await snapshot(db, { env, now, dataDir })

  // ── 장부 — 공급 호출부와 같은 판독 ──
  const ledgerDir = defaultLedgerDir()
  const lDate = ledgerDateOf(now)
  const today = readLedgerDay(ledgerPathOf(ledgerDir, lDate))
  const openRead = readOpenReservations(ledgerDir)
  const split = classifyReservations({
    open: openRead.ok ? openRead.list : [], now, sessionId: 'ops-shadow', pid: process.pid, pidAlive,
  })

  // ── 화자 — 생성 러너의 유일한 입구(createAttemptPool) ──
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

  // ── 공급 회차 · 단가(표본이 완전할 때만) ──
  const runRead = readSupplyRuns(dataDir)
  const runs = runRead.runs
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
  const deficit = planDeficit(envelope, observation)
  const writer = writerDueOf(kstDate, now, runs, runRead.malformed)

  // 🔴 기록 · 해시는 정제된 관측으로만 — 보류 사유 · 예약 원문 없음
  const recorded = sanitizeObservation(observation)
  const cycleHash = inputHashOf({ envelope, plan, observation: recorded })
  const cycle: ShadowRecord = {
    v: OPS_SHADOW_VERSION, cycleId: cycleIdOf('cycle', kstDate, cycleHash), kind: 'cycle', kstDate,
    at: now.toISOString(), inputHash: cycleHash, runtimeSha, clock, authority: 'none',
    envelope, plan, observation: recorded, deficit, outcome: null, writer,
  }
  const records: ShadowRecord[] = [cycle]
  if (writer.due) {
    const facts = await readStageEvidenceFacts(db, {
      kstDate, stage: validated!.release, decision: validated, now, commentCapPerPost: PERSONA_COMMENTS_PER_POST_MAX,
    })
    const outcome = dailyOutcomeOf(envelope, plan, { posts: facts.posts, tally: today.ok ? tallyOf(today.entries) : null })
    const closeHash = inputHashOf({ envelope, plan, outcome, writerRun: writer.runId })
    const dayClose: ShadowRecord = {
      ...cycle, cycleId: cycleIdOf('dayClose', kstDate, closeHash), kind: 'dayClose',
      inputHash: closeHash, observation: null, deficit: null, outcome,
    }
    records.push(dayClose)
  }

  for (const r of records) {
    if (argv.includes('--json')) console.log(JSON.stringify(r))
    if (argv.includes('--dry')) continue
    const w = appendShadowRecord(outDir, r)
    console.log(`${w.written ? '🟢 기록' : '🟡 이미 있음(같은 사이클)'} ${r.kind} ${r.cycleId} → ${w.path}`)
  }
  console.log(`   계획 ${plan.dayKind} · 상한 ${plan.publishCap} · 부족 ${deficit.deficitAfterInFlight}`
    + ` · 가상 묶음 ${deficit.wouldRunSources} ($${deficit.wouldSpendUsd.toFixed(4)}) · 제한 ${deficit.limitedBy.join(',') || '-'}`
    + ` · writer ${writer.due ? 'due' : 'not-due'} · 🔴 실행 0 · 권위 0`)
} finally {
  await raw.$disconnect()
}
