#!/usr/bin/env tsx
/**
 * 🔴 **D1→D100 단계 스케줄러 검사 — 운영 상태 기계 하나로 본다** (2026-09-29 generic scheduler 배선)
 *
 *   DB 0 · 네트워크 0 · 유료 호출 0 · 운영 env 0. 파일 write 는 OS 임시 디렉터리의 가짜 env 하나(롤백 확인)뿐이다.
 *
 *   ① 단계 목록 · 목표 — 러너 단계 d1~d50 · d100 은 표현만 · 목표는 창업자 계획(`d100Plan`)과 같다
 *   ② (2026-09-30) 승인 천장 env 는 없다 — 러너 단계 해석만 남는다(d100 은 러너 밖)
 *   ③ 슬롯 · 러너 — 08:00~22:00 · heartbeat 격자 · 60분 안 댓글 3회(43회 · 간격 ≤20분) · 하루 시뮬레이션
 *   ④ preflight(D3~D100 한 함수) — slot-valid 기회 · 처리량 · 지연 · 계약 유효 Persona canary 하한 · 비용 상한 · 러너
 *   ⑤ 상태 기계 — **운영 `decideStage` 를 여러 날 돌린다**(저장 계약 · 증거 판정 · consumer 까지 한 줄로)
 *   ⑥ 러너 연결 — consumer env(결정 그대로 · canary 없음) → `resolveScale` · catch-up · 증명일 · 발행 천장
 *   ⑦ 롤백 — `stage:switch --off` → consumer 는 d1 을 명시해서 넣는다(옛 env/canary 단계로 돌아가지 않는다)
 *   ⑧ 증거 본체 — d1~d10 두 입구 동일 · 사람 물량 0건 · REPROVE 증명일
 *
 * 🔴 러너 사실(격자 · 댓글 예약표 · 회차 상한)은 **정본 템플릿에서 읽는다**(`RUNNER_GRID`).
 *    단가 셋만 fixture 다: 댓글 $0.00222(= `persona-comment-loop-check` 가 운영 장부와 대조하는 실측 1건) ·
 *    감사 $0.005 · 공급 READY 1건당 $0.008(가정 — 장부 실측 전). 🔴 운영 단가는 controller 가 전날 장부에서 읽는다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  GENERIC_STAGES, genericNextStage, genericDailyTarget, HIGHEST_RUNTIME_STAGE,
  validPublishMinutes, publishCapacityOf, deriveSlots, genericProfileOf, verifyGenericProfile, commentCoverageOf,
  judgeNextPreflight, readyCapacityOf, trialBlocks, firstSlotOn,
  type PreflightFacts, type ReadyCohortFact, type GenericStage, type PreflightVerdict, type PreflightCode,
} from '../src/lib/stage-ladder-generic'
import {
  PROFILES, RELEASE_STAGES, RUNTIME_STAGES, RUNTIME_PROFILES, resolveRuntimeStage, minuteOfDay, profileOf,
  stageRank, isRuntimeStage, CAPACITY_ENV, RELEASE_ENV,
  type RuntimeStage,
} from '../src/lib/scale-profile'
import { PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE, judgeCatchUp, simulateDay } from '../src/lib/publish-slot-catchup'
import { allStageCronLines } from '../src/lib/scale-workflow-render'
import {
  AUTO_FIRST_COMMENT_WINDOW_MINUTES, COMMENT_LOOP_DAILY_USD_DEFAULT, COMMENT_LOOP_DAILY_USD_MAX,
} from '../src/lib/persona-comment-auto-lane'
import {
  d100Plan, PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET, schedulerSupportOf,
} from '../src/lib/d100-capacity'
import {
  SUPPLY_PROOF_LAST_PUBLISH_MINUTE, SUPPLY_PROOF_RUNS_PER_DAY,
  SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS, SUPPLY_WORKSET_PER_RUN,
  supplyProofBudgetUsd, supplyProofRunSlots, supplyRunSlotMinuteOf,
} from '../src/lib/supply-schedule-contract'
import { SUPPLY_DAILY_USD_APPROVED } from '../src/lib/supply-schedule-contract'
import {
  judgeStageEvidence, judgeEvidenceForTarget, trialPlanOf, carriedTrialPlanFor, PROOF_STATES,
  type EvidencePost, type EvidenceSideSignals, type StageEvidenceFacts, type StageEvidenceVerdict,
} from '../src/lib/stage-evidence'
import { auditTarget } from '../src/lib/auto-ready-v2'
import {
  validateStoredDecision, nextStage, STAGE_DECISION_VERSION, DECISION_WRITER, TRANSITION_STATES,
  type ValidatedStageDecision, type StageDecision,
} from '../src/lib/stage-decision-contract'
import {
  decideStage, consumerEnvOf, validateForToday, sustainedReleaseOf, leaseSafeHoldOf, type HealthSignal, type ControllerResult,
  resolvePreviousAuthority, bridgeHoldOf, inputFailureHoldOf, signalBlindReleaseOf, heldReleaseOf, type DecisionRead,
  CERTIFIED_ROLLOUT_PHASE, certifiedProvenanceOf, type CertifiedRolloutPhase,
} from '../src/lib/stage-controller'
import { preparedStageOf } from '../src/lib/stage-ladder'
import { resolveScale, boundedReleaseStage } from '../src/lib/scale-runtime'
import { proofDayOf, PROOF_STAGE_ENV } from '../src/lib/stage-proof-day'
import { CONTROLLER_ENV, controllerEnabled } from '../src/lib/stage-decision-store'
import {
  RUNNER_GRID, futureAdditionalOf, measuredFutureSourceOpportunities, slotValidOpportunitiesOf,
} from './lib/stage-preflight-facts.mjs'
import { settledUnitUsd, settledTotalUsd, cappedBy } from './lib/stage-preflight-facts.mjs'
import { fakeSourceEvidence } from './lib/fake-source-evidence.mjs'
import { OPPORTUNITY_INVENTORY_AXIS, OPPORTUNITY_INVENTORY_BASIS, OPPORTUNITY_KIND, OPPORTUNITY_VERSION } from '../src/lib/supply-workset'
import { COMMENT_RUNNER_SLOTS, COMMENT_RUNNER_MAX_GAP_MINUTES } from './lib/persona-comment-runner-template'
import { readEnvKeys } from './lib/ops-signals.mjs'
import { markedStageEnv } from './lib/stage-decision-fixture'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const section = (s: string): void => console.log(`\n── ${s} ──`)

const GRID = RUNNER_GRID
/** 🔴 fixture 단가 — 머리말 참고 */
const COMMENT_USD = 0.00222
const AUDIT_USD = 0.005
const AUDIT_CAP = 0.30
const SUPPLY_USD_PER_READY = 0.008

const D0 = '2026-09-29'
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const at0700 = (d: string): string => new Date(`${d}T07:00:00+09:00`).toISOString()
const SIDE_OK: EvidenceSideSignals = {
  cost: [
    { lane: 'supply', name: '공급', health: 'ok' },
    { lane: 'comment', name: '댓글', health: 'ok' },
    { lane: 'audit', name: '감사', health: 'ok' },
  ], errors: 'ok',
  supplyCostEvidence: {
    legacyUsageUnknownRequests: 0,
    wholeDayCriticalHealth: 'ok',
    envelope: { settledRequests: 20, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsd: 0.08, budgetUsd: 1 },
  },
}

// ─────────────────────────────────────────────────────────
section('① 단계 목록 · 목표')
check('러너 단계 = RELEASE_STAGES(d1·d3·d5·d10) + d20·d30·d50 · 표현 단계는 그 위 d100',
  RELEASE_STAGES.every((s, i) => RUNTIME_STAGES[i] === s) && RUNTIME_STAGES.join(',') === 'd1,d3,d5,d10,d20,d30,d50'
  && GENERIC_STAGES.join(',') === 'd1,d3,d5,d10,d20,d30,d50,d100')
check('🔴 RELEASE_STAGES · PROFILES 는 d1~d10 그대로다(GitHub 예약 합집합 불변 · D100 용량표 슬롯은 RUNTIME_PROFILES 를 읽는다)',
  RELEASE_STAGES.join(',') === 'd1,d3,d5,d10' && Object.keys(PROFILES).join(',') === 'd1,d3,d5,d10')
check('🔴 d1~d10 러너 프로필은 PROFILES 와 같은 객체다(값 불변)', RELEASE_STAGES.every((s) => RUNTIME_PROFILES[s] === PROFILES[s]))
for (const s of ['d20', 'd30', 'd50', 'd100'] as const) {
  check(`${s} 목표 ${genericDailyTarget(s)} = 창업자 계획 publicPostsPerDay ${d100Plan(s).publicPostsPerDay}`,
    genericDailyTarget(s) === d100Plan(s).publicPostsPerDay)
}
check('d100 은 러너 단계가 아니다(표현만)', !isRuntimeStage('d100') && HIGHEST_RUNTIME_STAGE === 'd50')
check('다음 칸(저장 계약 정본) d10 → d20 · d30 → d50 · d50 → 없음',
  nextStage('d10') === 'd20' && nextStage('d30') === 'd50' && nextStage('d50') === null)
check('표현 사다리 d50 → d100 · d100 → 없음', genericNextStage('d50') === 'd100' && genericNextStage('d100') === null)

// ─────────────────────────────────────────────────────────
section('② 🔴 승인 천장 env 없음 — 러너 단계 해석만')
check('러너 env 해석 — d20 은 d20 · d100 은 러너 밖이라 d1', resolveRuntimeStage('d20').stage === 'd20' && resolveRuntimeStage('d100').stage === 'd1')
check('🔴 🔴 **천장 해석(resolveCeiling) · D20 전용 관문(needsExtendedGate) 이 없다 — D3~D100 한 관문**', (() => {
  const src = readFileSync('src/lib/stage-ladder-generic.ts', 'utf-8')
  return !/export function resolveCeiling|export function needsExtendedGate|export function extendedTrialBlocks/.test(src)
    && /export function trialBlocks/.test(src)
})())
check('capacity 칸 = 다음 증명 단계 — d10 → d20 · d50 → d50(맨 위)', preparedStageOf('d10') === 'd20' && preparedStageOf('d50') === 'd50')

// ─────────────────────────────────────────────────────────
section('③ 슬롯 · 러너 — 08:00~22:00 · 격자 · 첫 댓글')
const valid = validPublishMinutes(GRID)
const cap = publishCapacityOf(GRID)
console.log(`   유효 발행 분 ${valid.length}개 (격자 ${GRID.gridMinutes}분 · 회차당 ${GRID.perRunMax}건 · 댓글 회차 ${GRID.commentSlots.length}개 · 시도 ${GRID.attempts}회) → 하루 용량 ${cap}건`)
{
  const mins = COMMENT_RUNNER_SLOTS.map(minuteOfDay)
  const gaps = mins.slice(1).map((m, i) => m - mins[i]!)
  check(`댓글 러너 ${COMMENT_RUNNER_SLOTS.length}회/day · 최대 간격 ${Math.max(...gaps)}분 ≤ ${COMMENT_RUNNER_MAX_GAP_MINUTES}분`,
    COMMENT_RUNNER_SLOTS.length === 43 && Math.max(...gaps) <= 20 && COMMENT_RUNNER_MAX_GAP_MINUTES === 20)
}
check('유효 발행 분은 전부 창(08:00~22:00) 안 · 격자 위 · 60분 안 댓글 3회',
  valid.every((m) => m >= PUBLISH_WINDOW_START_MINUTE && m <= PUBLISH_WINDOW_END_MINUTE && m % GRID.gridMinutes === 0
    && commentCoverageOf(m, GRID).runs >= GRID.attempts))
for (const s of RUNTIME_STAGES) {
  const p = profileOf(s)
  const probs = verifyGenericProfile(p, GRID)
  const mins = p.slots.map(minuteOfDay)
  const waits = mins.map((m) => commentCoverageOf(m, GRID).firstWait ?? 999)
  check(`${s} (${p.dailyTarget}/day) — 창 · 격자 · 시도 3회 · 한 분 한 건 · 첫 댓글 대기 최대 ${Math.max(...waits)}분 ≤ 20`,
    probs.length === 0 && Math.max(...waits) <= 20 && p.slots.every((x) => x.count === 1), probs.join(' / '))
  // 🔴 하루 시뮬레이션 — 10분 heartbeat 가 08:00~22:00 에 오면 목표를 정확히 채우고 넘지 않는다
  const arrivals: Date[] = []
  for (let m = PUBLISH_WINDOW_START_MINUTE; m <= PUBLISH_WINDOW_END_MINUTE; m += GRID.gridMinutes) {
    arrivals.push(new Date(Date.parse(`${D0}T00:00:00+09:00`) + m * 60_000))
  }
  const sim = simulateDay({ stage: s, arrivals })
  check(`${s} — heartbeat 하루 시뮬레이션 ${sim.published}/${sim.target}건 (넘지 않는다)`, sim.published === sim.target && sim.meetsTarget)
}
for (const s of ['d20', 'd30', 'd50'] as const) {
  const d = deriveSlots(genericDailyTarget(s), GRID)
  check(`🔴 ${s} 러너 프로필 슬롯 = deriveSlots 결과 그대로(손으로 고치지 않았다)`,
    d.ok && JSON.stringify(d.slots) === JSON.stringify(profileOf(s).slots))
  check(`${s} Persona 간격은 d10 운영값 그대로`, profileOf(s).postsPerWeek === PROFILES.d10.postsPerWeek
    && profileOf(s).minDaysBetween === PROFILES.d10.minDaysBetween)
}
check('🔴 GitHub 예약 합집합은 d1~d10 그대로 10회 — D20 이상은 로컬 heartbeat 격자로 돈다(yml 불변)', allStageCronLines().length === 10)
const g100 = genericProfileOf('d100', GRID)
check(`🔴 [blocker 실측] d100 은 지금 러너로 담을 수 없다 — 용량 ${cap} < 100`, !g100.ok && cap < 100)
check('반례 — 22시에 가까운 슬롯은 시도 3회가 안 돼 계약 위반', verifyGenericProfile({
  dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 21, minute: 40, count: 1 }],
}, GRID).some((p) => p.includes('댓글 시도')))
check('반례 — 격자 밖 분(09:35)은 계약 위반', verifyGenericProfile({
  dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 9, minute: 35, count: 1 }],
}, GRID).some((p) => p.includes('격자')))
check('반례 — 목표 0 · 101 · 소수는 만들지 않는다', !deriveSlots(0, GRID).ok && !deriveSlots(101, GRID).ok && !deriveSlots(2.5, GRID).ok)

// ─────────────────────────────────────────────────────────
section('④ preflight — slot-valid 기회 · 처리량 · 지연 · 계약 유효 Persona · 비용 상한 · 러너')
/**
 * 🔴 경계값 fixture — 각 칸이 그 단계를 **딱** 채운다(기회 = 목표 · cohort 공개 = 목표 · 손실 0 · 대기 0 ·
 *    용량 = 필요량(= 목표)을 겨우 채움 · Persona = canary 하한). 넉넉한 값으로 PASS 를 만들면 경계 반례가 헛돈다.
 */
const RUNS = SUPPLY_WORKSET_PER_RUN * SUPPLY_PROOF_RUNS_PER_DAY
/** 🔴 미래 순유입 합집합 반례의 실제 산출 — 아래 D20 preflight 판정에 그대로 넣는다 */
const FUTURE_UNION: {
  overlap: number | null; distinct: number | null
  /** H1 반례 — 현재 원천 300(이른 슬롯) · y=0.1 · 순유입 17(늦은 슬롯) */
  pooledCurrent: number | null; pooled: number | null; oldPooled: number | null
} = { overlap: null, distinct: null, pooledCurrent: null, pooled: null, oldPooled: null }
const d3LastPublishMinute = Math.max(...profileOf('d3').slots.map((slot) => slot.hour * 60 + slot.minute))
check('🔴 당일 증명 회차 경계는 가장 이른 D3 마지막 발행 슬롯 19:00과 맞고 5회다',
  SUPPLY_PROOF_LAST_PUBLISH_MINUTE === d3LastPublishMinute
  && supplyProofRunSlots(SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS).length === 5)
check('launchd 가 1분 늦게 시작한 08:16은 08:15 자연 공급 회차에 귀속된다',
  supplyRunSlotMinuteOf(8 * 60 + 16) === 8 * 60 + 15)
check('08:15 회차의 45분 창이 끝난 09:00은 가까운 회차로 추정하지 않는다',
  supplyRunSlotMinuteOf(9 * 60) === null)
{
  const target = '2026-11-03'
  const now = new Date(`${target}T07:00:00+09:00`)
  const runIdAt = (date: string, hour = 8, minute = 15): string => {
    const iso = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`).toISOString()
    return iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  }
  const snapshotAt = (
    targetDir: string, date: string, ids: readonly string[], hour = 8, minute = 15, evidenceAt?: Date,
    origin: 'natural' | 'scheduled-followup' | 'event' | 'manual' | 'legacy' = 'natural',
  ): void => {
    const written = ids.length
    const runId = runIdAt(date, hour, minute)
    const runAt = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`)
    const takenAt = new Date(runAt.getTime() + 10 * 60_000).toISOString()
    const budgetSlot = SUPPLY_RUN_SLOTS_KST.find((slot) => {
      const start = slot.hour * 60 + slot.minute
      const actual = hour * 60 + minute
      return actual >= start && actual < start + SUPPLY_RUN_WINDOW_MS / 60_000
    })
    const budgetWindow = budgetSlot === undefined ? `${date} 00:00`
      : `${date} ${String(budgetSlot.hour).padStart(2, '0')}:${String(budgetSlot.minute).padStart(2, '0')}`
    const evidence = ids.map((id) => fakeSourceEvidence(evidenceAt ?? new Date(takenAt), {
      site: 'navercafe:fixture', id, ageH: 3,
    }))
    const snapshot = {
      kind: OPPORTUNITY_KIND, version: OPPORTUNITY_VERSION, runId, takenAt,
      inventory: {
        basis: OPPORTUNITY_INVENTORY_BASIS, axis: OPPORTUNITY_INVENTORY_AXIS,
        counts: { inputRows: written, lifecyclePassed: written, autoSeed: written, evidenceMissing: 0, written },
      },
      evidence,
    }
    writeFileSync(join(targetDir, `supply-opportunities-${runId}.json`), JSON.stringify(snapshot))
    writeFileSync(join(targetDir, `supply-process-${runId}.run.json`), JSON.stringify({
      runId, startedAt: runAt.toISOString(), status: 'done', completedAt: takenAt, runtimeSha: 'fixture-runtime-sha',
      runTokenShadow: origin === 'natural'
        ? {
            ok: true, code: null, tokenId: `token-${runId}`, trigger: 'scheduled', launchTrigger: 'scheduled',
            absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow,
          }
        : origin === 'scheduled-followup'
          ? {
              ok: true, code: null, tokenId: `token-${runId}`, trigger: 'scheduled', launchTrigger: 'scheduled',
              absorbedTrigger: 'scheduled', absorbedAt: new Date(`${date}T08:15:00+09:00`).toISOString(),
              pass: 1, budgetWindow,
            }
        : origin === 'event'
          ? {
              ok: true, code: null, tokenId: `token-${runId}`, trigger: 'scheduled', launchTrigger: 'scheduled',
              absorbedTrigger: 'event', absorbedAt: runAt.toISOString(), pass: 0, budgetWindow,
            }
          : origin === 'manual' ? {
              ok: true, code: null, tokenId: `token-${runId}`, trigger: 'manual', launchTrigger: 'manual',
              absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow,
            } : {
              ok: true, code: null, tokenId: `token-${runId}`, trigger: 'scheduled', budgetWindow,
            },
      opportunityInventory: { status: 'written', runId, observedAt: takenAt, written, reason: null },
    }))
  }
  const SAMPLE_DATES = ['2026-10-31', '2026-11-01', '2026-11-02']
  const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, k) => `${prefix}-${k}`)
  type DayPlan = {
    baseline?: readonly string[] | null; inflow0815: readonly string[]; skip?: readonly number[]
    origin?: 'natural' | 'event'; evidenceAt?: (date: string) => Date
    /** 기준선 원천이 소진돼 뒤 회차 inventory 에서 빠진다(재고 수준은 그대로 · 원천은 교체) */
    dropBaseline?: boolean
  }
  /** 🔴 하루 = 06:15 기준선 회차 + 남은 proof 공급 회차 넷. 08:15 회차가 순유입을 처음 보고, 뒤 회차는 같은 원천을 다시 본다 */
  const writeDay = (targetDir: string, date: string, p: DayPlan): void => {
    const base = p.baseline === undefined ? ids(`${date}-base`, 5) : p.baseline
    if (base !== null) snapshotAt(targetDir, date, base, 6, 15, p.evidenceAt?.(date))
    const seen = [...(base === null || p.dropBaseline === true ? [] : base), ...p.inflow0815]
    for (const [h, m] of [[8, 15], [12, 15], [14, 15], [17, 15]] as const) {
      if (p.skip?.includes(h)) continue
      snapshotAt(targetDir, date, seen, h, m, p.evidenceAt?.(date), p.origin ?? 'natural')
    }
  }
  const at = (h: number, m: number): Date =>
    new Date(`${target}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`)
  // 증명 슬롯 20 — 이른 3개(08:00·08:20·08:40)는 아무도 못 채운다 · 늦은 17개 09:00~10:20(5분 간격)
  const PROOF20 = [at(8, 0), at(8, 20), at(8, 40), ...Array.from({ length: 17 }, (_, k) => at(9 + Math.floor((k * 5) / 60), (k * 5) % 60))]
  const LATE = 9 * 60
  const kstMinute = (d: Date): number => { const w = new Date(d.getTime() + 9 * 3600_000); return w.getUTCHours() * 60 + w.getUTCMinutes() }
  const opp = (key: string, ok: (minute: number) => boolean) => ({ key, validAt: (slot: Date) => ok(kstMinute(slot)) })
  const lateOnly = (prefix: string, n: number) => ids(prefix, n).map((k) => opp(k, (m) => m >= LATE))
  const earlyOnly = (prefix: string, n: number) => ids(prefix, n).map((k) => opp(k, (m) => m < LATE))
  const futureOf = (dataDir: string, o: {
    ready?: ReturnType<typeof opp>[]; current?: ReturnType<typeof opp>[]; y?: number | null; kstDate?: string
  } = {}): number | null => measuredFutureSourceOpportunities({
    dataDir, kstDate: o.kstDate ?? target, now, proofSlots: PROOF20,
    ready: o.ready ?? [], current: o.current ?? [], readyPerSourceLow: o.y === undefined ? 1 : o.y,
  })
  const scenario = (name: string, plans: (date: string) => DayPlan): string => {
    const d = mkdtempSync(join(tmpdir(), `future-inflow-${name}-`))
    for (const date of SAMPLE_DATES) writeDay(d, date, plans(date))
    return d
  }
  const dirs: string[] = []
  const keep = (d: string): string => { dirs.push(d); return d }

  // ① 재현 — READY 10 · 미래 원천 17 이 모두 늦은 17슬롯에서만 유효 · 이른 3슬롯은 못 채운다
  const overlap = keep(scenario('overlap', (date) => ({ inflow0815: ids(`${date}-new`, 17) })))
  const ready10 = lateOnly('ready', 10)
  FUTURE_UNION.overlap = futureOf(overlap, { ready: ready10 })
  check('🔴🔴 합집합 — READY 10 이 늦은 17슬롯을 먼저 쓰면 순유입 17 은 남은 늦은 7슬롯만 채운다 → 추가 7',
    FUTURE_UNION.overlap === 7, String(FUTURE_UNION.overlap))
  check('🔴 같은 겹침 — 현재 원천 10 이 늦은 슬롯만 유효해도 같은 슬롯을 다툰다(추가 7)',
    futureOf(overlap, { current: lateOnly('cur', 10) }) === 7)

  // ② 서로 다른 슬롯의 순유입 — READY 3 은 이른 슬롯, 순유입 17 은 늦은 슬롯 → 20/20
  FUTURE_UNION.distinct = futureOf(overlap, { ready: earlyOnly('ready', 3) })
  check('🟢 서로 다른 슬롯 — READY 3(이른) + 순유입 17(늦은) → 추가 17(85~90 선행 재고 없음)',
    FUTURE_UNION.distinct === 17, String(FUTURE_UNION.distinct))
  const turnover = keep(scenario('turnover', (date) => ({
    baseline: ids(`${date}-old`, 17), inflow0815: ids(`${date}-new`, 17), dropBaseline: true,
  })))
  check('🟢 재고 수준은 17→17 그대로여도 원천이 통째로 바뀌었으면 새 원천 17 을 순유입으로 센다(재고 차이 0 이 아니다)',
    futureOf(turnover, { ready: earlyOnly('ready', 3) }) === 17)
  const noInflow = keep(scenario('flat', (date) => ({ baseline: ids(`${date}-old`, 17), inflow0815: [] })))
  check('🔴 재고가 많아도(기준선 17 을 다시 봄) 새로 들어온 원천이 없으면 추가 0 — 재고 수준은 유입이 아니다',
    futureOf(noInflow, { ready: earlyOnly('ready', 3) }) === 0)
  const weakDay = keep(scenario('weak', (date) => ({ inflow0815: ids(`${date}-new`, date === '2026-11-01' ? 12 : 17) })))
  check('🔴 3일 중 가장 약한 날의 추가분을 쓴다(17·12·17 → 12)', futureOf(weakDay, { ready: earlyOnly('ready', 3) }) === 12)
  check('🔴 하한 수율로 할인한다 — 순유입 17 × 0.5 → 8(현재 0)', futureOf(overlap, { y: 0.5 }) === 8)
  const stale = keep(scenario('stale', (date) => ({
    inflow0815: ids(`${date}-new`, 17), evidenceAt: (d) => new Date(`${addDays(d, -4)}T00:00:00+09:00`),
  })))
  check('🔴 순유입이어도 그날 같은 슬롯에서 신선도·품질 관문을 못 넘으면 추가 0', futureOf(stale, { ready: earlyOnly('ready', 3) }) === 0)

  // ③ H1 — 수율은 묶음마다 따로 곱한다. 현재 원천 300(이른 3슬롯만) · y=0.1 · 순유입 17(늦은 17슬롯만)
  const early300 = earlyOnly('cur', 300)
  const pooled = futureOf(overlap, { current: early300, y: 0.1 })
  const pooledCurrent = slotValidOpportunitiesOf({ slots: PROOF20, ready: [], sources: early300, readyPerSource: 0.1 }).total
  FUTURE_UNION.pooledCurrent = pooledCurrent
  FUTURE_UNION.pooled = pooled
  FUTURE_UNION.oldPooled = slotValidOpportunitiesOf({
    slots: PROOF20, ready: [], sources: [...early300, ...lateOnly('in', 17)], readyPerSource: 0.1,
  }).total - pooledCurrent
  check('🔴🔴 H1 — 현재 300(이른) 의 남는 수율을 순유입(늦은 17)에 빌려주지 않는다: 현재 3 + 추가 floor(17×0.1)=1 = 4',
    pooledCurrent === 3 && pooled === 1, `current=${pooledCurrent} future=${String(pooled)}`)
  check('🔴 H1 순수 산식 — 합집합 겹침 상한(17)과 순유입 자기 수율 상한(1) 중 작은 값',
    futureAdditionalOf({ slots: PROOF20, ready: [], current: early300, inflow: lateOnly('in', 17), readyPerSource: 0.1 }) === 1
    && futureAdditionalOf({ slots: PROOF20, ready: lateOnly('ready', 10), current: [], inflow: lateOnly('in', 17), readyPerSource: 1 }) === 7)

  // ④ 증명된 누락은 0 · 기준선 없음과 손상은 모름(null)
  const skipped = keep(scenario('skip', (date) => ({ inflow0815: ids(`${date}-new`, 17), skip: date === '2026-11-01' ? [14] : [] })))
  check('🟢 M2 — 표본일 하나에 14:15 자연 회차만 빠져도 08:15 이 이미 본 순유입 17 은 센다(UNKNOWN 아님)',
    futureOf(skipped, { ready: earlyOnly('ready', 3) }) === 17)
  const skippedInflow = keep(scenario('skip-inflow', (date) => ({ inflow0815: ids(`${date}-new`, 17), skip: date === '2026-11-01' ? [8] : [] })))
  check('🔴 M2 — 순유입을 처음 볼 08:15 회차가 빠지면 그 원천은 12:15 에야 보인다 → 그날 늦은 가용(증명 슬롯 뒤) · 추가 0',
    futureOf(skippedInflow, { ready: earlyOnly('ready', 3) }) === 0)
  const noNatural = keep(scenario('no-natural', (date) => ({ inflow0815: ids(`${date}-new`, 17), skip: date === '2026-11-01' ? [8, 12, 14, 17] : [] })))
  check('🔴 M2 — 기준선은 있고 자연 공급 회차가 하루 통째로 없으면 그날 추가 0 → 3일 최솟값 0',
    futureOf(noNatural, { ready: earlyOnly('ready', 3) }) === 0)
  const noBase = keep(scenario('nobase', (date) => ({ inflow0815: ids(`${date}-new`, 17), baseline: date === SAMPLE_DATES[0] ? null : undefined })))
  check('🔴 첫 표본일 07:00 기준선 inventory 가 없으면 순유입을 셀 수 없다 → UNKNOWN', futureOf(noBase) === null)
  const eventOnly = keep(scenario('event', (date) => ({ inflow0815: ids(`${date}-new`, 17), origin: 'event' })))
  check('🔴 슬롯 창 안 event kickstart 회차는 자연 표본이 아니다 → 추가 0(부풀리지 않는다)', futureOf(eventOnly, { ready: earlyOnly('ready', 3) }) === 0)
  const corrupt = keep(scenario('corrupt', (date) => ({ inflow0815: ids(`${date}-new`, 17) })))
  writeFileSync(join(corrupt, `supply-opportunities-${runIdAt('2026-11-01', 12, 15)}.json`), '{')
  check('🔴 M2 — 남은 슬롯 표본 하나라도 손상이면 여전히 UNKNOWN(누락이 아니다)', futureOf(corrupt) === null)
  const orphan = keep(scenario('orphan', (date) => ({ inflow0815: ids(`${date}-new`, 17) })))
  rmSync(join(orphan, `supply-opportunities-${runIdAt('2026-11-01', 14, 15)}.json`))
  check('🔴 M2 — 자연 회차가 snapshot written 을 주장하는데 파일이 없으면 손상 → UNKNOWN', futureOf(orphan) === null)
  const twoDays = keep(mkdtempSync(join(tmpdir(), 'future-inflow-two-')))
  for (const date of SAMPLE_DATES.slice(1)) writeDay(twoDays, date, { inflow0815: ids(`${date}-new`, 17) })
  check('🔴 표본 3일 중 하루가 통째로 없으면(기준선 없음) UNKNOWN', futureOf(twoDays) === null)
  check('🔴 하한 수율을 모르거나 kstDate·now 날짜가 어긋나면 UNKNOWN',
    futureOf(overlap, { y: null }) === null && futureOf(overlap, { kstDate: '2026-11-05' }) === null)

  // ⑤ M2 — 끝난 failed 회차도 snapshot·marker 가 온전하면 표본이다 · running · marker 손상은 모름
  const runPath = (dir: string, date: string, h: number, m: number): string =>
    join(dir, `supply-process-${runIdAt(date, h, m)}.run.json`)
  const patchRun = (dir: string, date: string, h: number, m: number, patch: Record<string, unknown>): void => {
    const path = runPath(dir, date, h, m)
    writeFileSync(path, JSON.stringify({ ...(JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>), ...patch }))
  }
  const markerOf = (dir: string, date: string, h: number, m: number): Record<string, unknown> =>
    (JSON.parse(readFileSync(runPath(dir, date, h, m), 'utf-8')) as { opportunityInventory: Record<string, unknown> }).opportunityInventory
  const inflowPlan = (date: string): DayPlan => ({ inflow0815: ids(`${date}-new`, 17) })
  const failedOk = keep(scenario('failed-written', inflowPlan))
  patchRun(failedOk, '2026-11-01', 8, 15, { status: 'failed' })
  patchRun(failedOk, '2026-11-02', 6, 15, { status: 'failed' })
  check('🟢 M2 — 다른 단계가 실패한(failed) 자연 회차도 snapshot·marker·runId·시각·SHA 가 온전하면 표본·기준선이다(대조와 같은 17)',
    futureOf(failedOk, { ready: earlyOnly('ready', 3) }) === 17 && futureOf(overlap, { ready: earlyOnly('ready', 3) }) === 17)
  const failedBadMarker = keep(scenario('failed-bad-marker', inflowPlan))
  patchRun(failedBadMarker, '2026-11-01', 8, 15, {
    status: 'failed',
    opportunityInventory: { ...markerOf(failedBadMarker, '2026-11-01', 8, 15), status: 'failed', written: null, reason: 'write EIO' },
  })
  const failedDriftMarker = keep(scenario('failed-drift-marker', inflowPlan))
  patchRun(failedDriftMarker, '2026-11-01', 8, 15, {
    status: 'failed',
    opportunityInventory: { ...markerOf(failedDriftMarker, '2026-11-01', 8, 15), observedAt: '2026-11-01T00:00:00.000Z' },
  })
  check('🔴 M2 — failed 회차의 marker 가 written 이 아니거나 snapshot 과 어긋나면 UNKNOWN',
    futureOf(failedBadMarker) === null && futureOf(failedDriftMarker) === null)
  const runningWritten = keep(scenario('running-written', inflowPlan))
  patchRun(runningWritten, '2026-11-01', 8, 15, { status: 'running', completedAt: null })
  const runningBaseline = keep(scenario('running-baseline', inflowPlan))
  patchRun(runningBaseline, '2026-11-01', 6, 15, { status: 'running', completedAt: null })
  const unknownStatus = keep(scenario('unknown-status', inflowPlan))
  patchRun(unknownStatus, '2026-11-01', 8, 15, { status: 'partial' })
  check('🔴 M2 — running(완료 시각 없음)·모르는 상태는 snapshot·marker 가 written 이어도 UNKNOWN(표본·기준선 모두)',
    futureOf(runningWritten) === null && futureOf(runningBaseline) === null && futureOf(unknownStatus) === null)
  /** 2026-11-01 14:15 자연 회차의 기회 파일을 지우고 marker 를 비운다 — snapshot 을 주장하지 않는 회차 기록만 남는다 */
  const noSnapshot = (name: string, patch: Record<string, unknown>): string => {
    const dir = keep(scenario(name, inflowPlan))
    rmSync(join(dir, `supply-opportunities-${runIdAt('2026-11-01', 14, 15)}.json`))
    patchRun(dir, '2026-11-01', 14, 15, { opportunityInventory: null, ...patch })
    return dir
  }
  check('🟢 M2 대조 — 끝난(done) 자연 회차가 snapshot 없이 written 도 주장하지 않으면 증명된 누락 → 슬롯 0 · 08:15 순유입 17',
    futureOf(noSnapshot('nosnap-done', {}), { ready: earlyOnly('ready', 3) }) === 17)
  check('🔴 M2 — running 자연 회차가 snapshot 없이 marker 도 없으면 누락이 아니라 UNKNOWN',
    futureOf(noSnapshot('nosnap-running', { status: 'running', completedAt: null }), { ready: earlyOnly('ready', 3) }) === null)
  check('🔴 M2 — 모르는 상태(partial) 자연 회차가 snapshot 없이 marker 도 없으면 UNKNOWN',
    futureOf(noSnapshot('nosnap-unknown', { status: 'partial' }), { ready: earlyOnly('ready', 3) }) === null)
  check('🔴 M2 — done 이어도 completedAt 이 깨졌거나 판정 시각 뒤면 snapshot 없는 회차는 UNKNOWN',
    futureOf(noSnapshot('nosnap-bad-completed', { completedAt: 'not-a-date' }), { ready: earlyOnly('ready', 3) }) === null
    && futureOf(noSnapshot('nosnap-future-completed', { completedAt: '2026-11-05T00:00:00.000Z' }), { ready: earlyOnly('ready', 3) }) === null)

  // ⑥ 기준선 provenance — 07:00 판정의 기준선은 그날 06:15 자연 proof 슬롯 하나다
  /** 표본일 전날 22:15 자연 회차 — 06:15 이 없을 때 앞판이 내려가 읽던 "전날 밤" 기준선 */
  const priorNight = (dir: string): void => {
    for (const date of SAMPLE_DATES) snapshotAt(dir, addDays(date, -1), ids(`${date}-base`, 5), 22, 15)
  }
  const missingAll = keep(scenario('base-missing-all', (date) => ({ ...inflowPlan(date), baseline: null })))
  priorNight(missingAll)
  check('🔴🔴 기준선 — 세 표본일 모두 06:15 이 없고 전날 밤 22:15 자연 snapshot 이 온전해도 UNKNOWN(전날 밤으로 내려가지 않는다)',
    futureOf(missingAll) === null)
  const priorControl = keep(scenario('base-prior-control', inflowPlan))
  priorNight(priorControl)
  check('🟢 기준선 대조 — 06:15 이 있으면 같은 전날 밤 회차가 있어도 06:15 로 센다(17)',
    futureOf(priorControl, { ready: earlyOnly('ready', 3) }) === 17)
  const nonNaturalBase = (origin: 'event' | 'manual'): string => {
    const dir = keep(scenario(`base-${origin}`, (date) => ({ ...inflowPlan(date), baseline: null })))
    for (const date of SAMPLE_DATES) snapshotAt(dir, date, ids(`${date}-base`, 5), 6, 15, undefined, origin)
    priorNight(dir)
    return dir
  }
  check('🔴 기준선 — 세 표본일의 06:15 이 event·manual 회차뿐이면 UNKNOWN(비자연 회차를 기준선으로 쓰지 않는다)',
    futureOf(nonNaturalBase('event')) === null && futureOf(nonNaturalBase('manual')) === null)
  const corruptBase = keep(scenario('base-corrupt', inflowPlan))
  writeFileSync(join(corruptBase, `supply-opportunities-${runIdAt('2026-11-01', 6, 15)}.json`), '{')
  const noShaBase = keep(scenario('base-no-sha', inflowPlan))
  patchRun(noShaBase, '2026-11-01', 6, 15, { runtimeSha: '' })
  check('🔴 기준선 — 06:15 snapshot 손상 · runtimeSha 없음이면 UNKNOWN',
    futureOf(corruptBase) === null && futureOf(noShaBase) === null)
  check('🔴 기준선 — 창이 끝난 proof 슬롯이 없는 06:50 판정은 UNKNOWN(전날 밤으로 내려가지 않는다)',
    measuredFutureSourceOpportunities({
      dataDir: priorControl, kstDate: target, now: new Date(`${target}T06:50:00+09:00`), proofSlots: PROOF20,
      ready: [], current: [], readyPerSourceLow: 1,
    }) === null)
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
}
const cohortFor = (s: GenericStage, o: Partial<ReadyCohortFact> = {}): ReadyCohortFact => {
  const usd = o.usdPerSlotValidResult === undefined ? SUPPLY_USD_PER_READY : o.usdPerSlotValidResult
  return {
    sources: RUNS, published: genericDailyTarget(s), lost: 0, scheduled: 0, unknown: 0,
    usdPerSlotValidResult: usd, ...o,
    trialCost: o.trialCost === undefined ? (usd === null ? null : {
      settledRequests: 20, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0,
      riskUsdPerSlotValidResult: usd,
    }) : o.trialCost,
  }
}
const factsFor = (s: GenericStage, o: Partial<PreflightFacts> = {}): PreflightFacts => ({
  proofKstDate: '2026-11-05',
  slotValidOpportunities: genericDailyTarget(s), readyCohort: cohortFor(s), latencyP50H: 20, latencyP90H: 60,
  contractValidPersonas: s === 'd1' ? 1 : PERSONA_CANARY_FLOOR[s],
  commentUsdPerRequest: COMMENT_USD, commentDailyUsdCap: COMMENT_LOOP_DAILY_USD_MAX,
  auditUsdPerCall: AUDIT_USD, auditDailyUsdCap: AUDIT_CAP,
  supplyDailyUsdCap: SUPPLY_DAILY_USD_APPROVED, runnerHealth: 'ok', ...o,
})
const D20_TRANSITION = judgeNextPreflight('d20', factsFor('d20', {
    readyCohort: cohortFor('d20', { sources: 95, published: 19, lost: 0, scheduled: 1, unknown: 1, usdPerSlotValidResult: 0.0502934 }),
  }), GRID)
check('🔴 D20 전환일 실측 — READY 21/원천 95 × 20원천 × 당일 5회 = 용량 22 · 최대 필요 21을 채운다',
  D20_TRANSITION.counts.readyCapacity === 22 && D20_TRANSITION.counts.readyNeededMax === 21
  && !D20_TRANSITION.codes.includes('THROUGHPUT_SHORT'))
check('🔴 D20 전환일 반례 — 같은 실측에서 묶음 18이면 용량 19라 최대 필요 21을 못 채운다',
  readyCapacityOf(21, 95, 18, SUPPLY_PROOF_RUNS_PER_DAY) === 19
  && (readyCapacityOf(21, 95, 18, SUPPLY_PROOF_RUNS_PER_DAY) ?? 0) < (D20_TRANSITION.counts.readyNeededMax ?? 0))
check('🔴 비용 변동 경계 — 결과당 실측 비용이 30% 상승하면 D20은 $1.20 증명 예산을 넘어 자동으로 열리지 않는다',
  judgeNextPreflight('d20', factsFor('d20', {
    readyCohort: cohortFor('d20', {
      sources: 95, published: 19, lost: 0, scheduled: 1, unknown: 1,
      usdPerSlotValidResult: 0.0502934 * 1.3,
    }),
  }), GRID).codes.includes('SUPPLY_COST_SHORT'))
const COST_EDGE_PASS = judgeNextPreflight('d20', factsFor('d20', {
  readyCohort: cohortFor('d20', { usdPerSlotValidResult: 0.058 }),
}), GRID)
const COST_EDGE_FAIL = judgeNextPreflight('d20', factsFor('d20', {
  readyCohort: cohortFor('d20', { usdPerSlotValidResult: 0.060001 }),
}), GRID)
check('🔴 공급 비용·처리량 경계는 같은 목표 20을 센다 — $0.058은 용량 20·$1.16으로 PASS, $0.060001은 $1.20 초과 FAIL',
  COST_EDGE_PASS.counts.readyCapacity === 20
  && Math.abs((COST_EDGE_PASS.counts.supplyDailyUsdNeeded ?? 0) - 1.16) < 1e-9
  && !COST_EDGE_PASS.codes.includes('THROUGHPUT_SHORT')
  && !COST_EDGE_PASS.codes.includes('SUPPLY_COST_SHORT')
  && COST_EDGE_FAIL.codes.includes('SUPPLY_COST_SHORT'))
check('비용 상한 정본 — 공급 승인 천장 $1.20 · 댓글 기본 $0.20 / 승인 천장 $0.50',
  SUPPLY_DAILY_USD_APPROVED === 1.2
  && COMMENT_LOOP_DAILY_USD_DEFAULT === 0.2 && COMMENT_LOOP_DAILY_USD_MAX === 0.5)
check('🔴 저예산 7회 profile은 앞 5회 몫만 비용 용량으로 센다 — 실측 D20은 막고 저비용 D10은 연다',
  supplyProofBudgetUsd(1.19) === 1.19 * 5 / 7
  && judgeNextPreflight('d20', factsFor('d20', {
    supplyDailyUsdCap: 1.19,
    readyCohort: cohortFor('d20', { sources: 95, published: 19, lost: 0, scheduled: 1, unknown: 1, usdPerSlotValidResult: 0.0502934 }),
  }), GRID).codes.includes('SUPPLY_COST_SHORT')
  && !judgeNextPreflight('d10', factsFor('d10', { supplyDailyUsdCap: 0.5 }), GRID).codes.includes('SUPPLY_COST_SHORT'))
for (const s of ['d3', 'd5', 'd10', 'd20', 'd30', 'd50'] as const) {
  const v = judgeNextPreflight(s, factsFor(s), GRID)
  check(`${s} preflight PASS — 댓글 ${v.counts.firstComments}건 · 감사 ${v.counts.auditExpected}건 · READY ${v.counts.readyNeeded}건 비용 상한 안`,
    v.verdict === 'PASS', `${v.verdict} [${v.codes.join(',')}]`)
}
{
  const enough = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: 16, futureSupplyCapacity: 4,
  }), GRID)
  const short = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: 16, futureSupplyCapacity: 3,
  }), GRID)
  const unknown = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: 16, futureSupplyCapacity: null,
  }), GRID)
  const alreadyEnough = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: 20, futureSupplyCapacity: null,
  }), GRID)
  check('🔴 현재 16 + 보수 미래 4 = D20 기회 PASS (미래를 READY 재고로 세지 않고 opportunity 축만 보완)',
    enough.verdict === 'PASS' && enough.counts.opportunitiesCurrent === 16
    && enough.counts.opportunitiesFuture === 4 && enough.counts.opportunities === 20)
  check('🔴 현재 16 + 미래 3이면 SHORT, 미래 수율 모름이면 UNKNOWN',
    short.codes.includes('OPPORTUNITY_SHORT') && unknown.codes.includes('OPPORTUNITY_UNKNOWN'))
  const oldArithmetic = judgeNextPreflight('d20', factsFor('d20', { slotValidOpportunities: 10, futureSupplyCapacity: 17 }), GRID)
  const unionVerdict = judgeNextPreflight('d20', factsFor('d20', { slotValidOpportunities: 10, futureSupplyCapacity: FUTURE_UNION.overlap }), GRID)
  const distinctVerdict = judgeNextPreflight('d20', factsFor('d20', { slotValidOpportunities: 3, futureSupplyCapacity: FUTURE_UNION.distinct }), GRID)
  check('🔴 반례 고정 — 고치기 전 산식(재고 17 − 현재 원천 0 = 17)은 READY 10 + 17 → D20 기회 20 PASS 였다',
    oldArithmetic.counts.opportunities === 20 && !oldArithmetic.codes.includes('OPPORTUNITY_SHORT'))
  check('🔴🔴 합집합 산출(READY 10 + 추가 7)을 넣으면 D20 기회 17/20 → OPPORTUNITY_SHORT · 시험을 열지 않는다',
    unionVerdict.counts.opportunities === 17 && unionVerdict.codes.includes('OPPORTUNITY_SHORT'),
    `opp=${String(unionVerdict.counts.opportunities)} [${unionVerdict.codes.join(',')}]`)
  check('🟢 서로 다른 슬롯 산출(READY 3 + 추가 17)이면 D20 기회 20 — 실시간 JIT 순유입만으로 연다',
    distinctVerdict.counts.opportunities === 20 && !distinctVerdict.codes.includes('OPPORTUNITY_SHORT'))
  const pooledVerdict = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: FUTURE_UNION.pooledCurrent, futureSupplyCapacity: FUTURE_UNION.pooled,
  }), GRID)
  check('🔴🔴 H1 — 같은 사실로 D20 은 OPPORTUNITY_SHORT(4/20) · 고치기 전 합집합 단독 산식은 추가 17 → 20/20 거짓 PASS 였다',
    pooledVerdict.counts.opportunities === 4 && pooledVerdict.codes.includes('OPPORTUNITY_SHORT')
    && FUTURE_UNION.oldPooled === 17,
    `opp=${String(pooledVerdict.counts.opportunities)} old=${String(FUTURE_UNION.oldPooled)} [${pooledVerdict.codes.join(',')}]`)
  check('🟢 현재 기회가 이미 목표면 미래를 몰라도 기존 PASS를 훼손하지 않는다',
    alreadyEnough.verdict === 'PASS' && !alreadyEnough.codes.includes('OPPORTUNITY_UNKNOWN'))
}
{
  const s20 = judgeNextPreflight('d20', factsFor('d20'), GRID)
  check('🔴 canary 하한(d20 40명)이면 연다 — 지속 목표(60명)로 막지 않는다',
    PERSONA_CANARY_FLOOR.d20 === 40 && PERSONA_SUSTAINED_TARGET.d20 === 60 && s20.verdict === 'PASS' && s20.counts.personaFloor === 40)
  check('Persona canary 하한 미달(39) → FAIL PERSONA_SHORT',
    judgeNextPreflight('d20', factsFor('d20', { contractValidPersonas: 39 }), GRID).codes.includes('PERSONA_SHORT'))
}
const pf100 = judgeNextPreflight('d100', factsFor('d100'), GRID)
console.log(`   d100: ${pf100.verdict} [${pf100.codes.join(',')}] · 댓글 감당 ${pf100.counts.commentAffordable}건/day`)
check('🔴 [blocker 실측] d100 — 상한을 D20까지만 열어도 발행 용량·슬롯이 부족해 자동 통과하지 않는다',
  pf100.verdict === 'FAIL' && pf100.codes.includes('PUBLISH_CAPACITY_SHORT') && pf100.codes.includes('SLOTS_INFEASIBLE'))
const pfCases: { name: string; s: GenericStage; o: Partial<PreflightFacts>; want: 'FAIL' | 'UNKNOWN'; code: PreflightCode }[] = [
  { name: 'slot-valid 기회 19 < 20', s: 'd20', o: { slotValidOpportunities: 19 }, want: 'FAIL', code: 'OPPORTUNITY_SHORT' },
  { name: '기회 모름', s: 'd20', o: { slotValidOpportunities: null }, want: 'UNKNOWN', code: 'OPPORTUNITY_UNKNOWN' },
  { name: 'D3 도 같은 관문 — 기회 2 < 3', s: 'd3', o: { slotValidOpportunities: 2 }, want: 'FAIL', code: 'OPPORTUNITY_SHORT' },
  { name: '수율이 필요량 아래(처리량 부족)', s: 'd20', o: { readyCohort: cohortFor('d20', { sources: Math.ceil(RUNS / 0.9) }) }, want: 'FAIL', code: 'THROUGHPUT_SHORT' },
  { name: 'cohort 모름', s: 'd20', o: { readyCohort: null }, want: 'UNKNOWN', code: 'THROUGHPUT_UNKNOWN' },
  { name: '지연 미관측', s: 'd5', o: { latencyP90H: null }, want: 'UNKNOWN', code: 'LATENCY_UNKNOWN' },
  { name: '🔴 계약 유효 Persona 모름(읽기 실패)', s: 'd3', o: { contractValidPersonas: null }, want: 'UNKNOWN', code: 'PERSONA_UNKNOWN' },
  { name: '🔴 계약 유효 Persona 0 < D3 하한 24 (2026-09-30 운영 실측) — D1→D3 부터 막힌다', s: 'd3', o: { contractValidPersonas: 0 }, want: 'FAIL', code: 'PERSONA_SHORT' },
  { name: '러너 최근 회차 실패', s: 'd5', o: { runnerHealth: 'bad' }, want: 'FAIL', code: 'RUNNER_BAD' },
  { name: '러너 모름', s: 'd5', o: { runnerHealth: null }, want: 'UNKNOWN', code: 'RUNNER_UNKNOWN' },
  { name: '댓글 단가 모름', s: 'd20', o: { commentUsdPerRequest: null }, want: 'UNKNOWN', code: 'COMMENT_COST_UNKNOWN' },
  { name: '댓글 단가 0 은 모름', s: 'd20', o: { commentUsdPerRequest: 0 }, want: 'UNKNOWN', code: 'COMMENT_COST_UNKNOWN' },
  { name: '댓글 상한 모름', s: 'd20', o: { commentDailyUsdCap: null }, want: 'UNKNOWN', code: 'COMMENT_COST_UNKNOWN' },
  { name: '댓글 단가 $0.026 × 20 > $0.50', s: 'd20', o: { commentUsdPerRequest: 0.026 }, want: 'FAIL', code: 'COMMENT_COST_SHORT' },
  { name: '감사 단가 $0.05 × 10 > $0.30', s: 'd50', o: { auditUsdPerCall: 0.05 }, want: 'FAIL', code: 'AUDIT_COST_SHORT' },
  { name: '감사 상한 모름', s: 'd20', o: { auditDailyUsdCap: null }, want: 'UNKNOWN', code: 'AUDIT_COST_UNKNOWN' },
  { name: '공급 결과당 비용 $0.025 × 목표 50 > $1.20', s: 'd50', o: { readyCohort: cohortFor('d50', { usdPerSlotValidResult: 0.025 }) }, want: 'FAIL', code: 'SUPPLY_COST_SHORT' },
  { name: '🔴 결말이 전부 대기(공개 0 · 대기 5) → 필요량 상한을 모른다 → UNKNOWN', s: 'd5', o: { readyCohort: cohortFor('d5', { published: 0, unknown: 5 }) }, want: 'UNKNOWN', code: 'READY_REQUIREMENT_UNKNOWN' },
  { name: '🔴 실측 손실 1 · 같은 cohort 용량 5 → 필요 READY 6 → 처리량 부족', s: 'd5', o: { readyCohort: cohortFor('d5', { lost: 1, sources: Math.ceil((RUNS * 6) / 5) }) }, want: 'FAIL', code: 'THROUGHPUT_SHORT' },
  { name: '결과당 공급 비용 모름(미연결 · legacy)', s: 'd20', o: { readyCohort: cohortFor('d20', { usdPerSlotValidResult: null }) }, want: 'UNKNOWN', code: 'SUPPLY_COST_UNKNOWN' },
  { name: '공급 상한 모름', s: 'd20', o: { supplyDailyUsdCap: null }, want: 'UNKNOWN', code: 'SUPPLY_COST_UNKNOWN' },
]
for (const c of pfCases) {
  const v = judgeNextPreflight(c.s, factsFor(c.s, c.o), GRID)
  check(`${c.s} ${c.name} → ${c.want} ${c.code}`, v.verdict === c.want && v.codes.includes(c.code), `${v.verdict} [${v.codes.join(',')}]`)
}
check('댓글 러너 용량 부족 → FAIL', judgeNextPreflight('d50', factsFor('d50'), { ...GRID, commentRunRequestCap: 1, commentSlots: GRID.commentSlots.slice(0, 40) }).codes.includes('COMMENT_RUNNER_SHORT'))
check(`감사 표본 = 정본 auditTarget 20% (d20 → ${auditTarget(20)} · d50 → ${auditTarget(50)})`,
  judgeNextPreflight('d20', factsFor('d20'), GRID).counts.auditExpected === 4 && auditTarget(50) === 10)
// 장부 → 단가 (controller 가 쓰는 순수 함수)
{
  const e = (stage: string, status: string, usd: number | null) => ({ stage, status, settledUsd: usd }) as never
  check('정산 단가 — 정산된 유료만 · countTokens·예약 제외', settledUnitUsd([e('commentGen', 'settled', 0.002), e('commentGen', 'settled', 0.004),
    e('countTokens', 'settled', 1), e('commentGen', 'reserved', null)]) === 0.003)
  check('정산 건 없음·못 읽음 → 모름(null)', settledUnitUsd([]) === null && settledUnitUsd(null) === null && settledTotalUsd(null) === null)
  check('상한 — 두 값 중 낮은 쪽 · 하나라도 모르면 모름', cappedBy(0.3, 0.5) === 0.3 && cappedBy(0.9, 0.5) === 0.5 && cappedBy(null, 0.5) === null)
}

// ─────────────────────────────────────────────────────────
section('⑤ 상태 기계 — 운영 decideStage 를 날마다 돌린다')

/** 증거일의 운영 모양 */
type DayMode = 'perfect' | 'human' | 'mixed' | 'manualRun' | 'late' | 'dup' | 'auditShort' | 'auditOutside' | 'costUnknown' | 'unread'

const OK_SIGNALS: HealthSignal[] = [
  { axis: 'quality', health: 'ok', reasons: [] }, { axis: 'cost', health: 'ok', reasons: [] }, { axis: 'errors', health: 'ok', reasons: [] },
]

/** 🔴 그날 실제로 일어난 일 — 결정의 공개 단계 슬롯에 글이 나가고 댓글 러너 예약표대로 첫 댓글이 붙는다 */
function factsOfDay(d: StageDecision, mode: DayMode): StageEvidenceFacts | null {
  if (mode === 'unread') return null
  const p = profileOf(d.release)
  const posts: EvidencePost[] = p.slots.map((sl, i) => {
    const m = minuteOfDay(sl)
    const t = Date.parse(`${d.kstDate}T00:00:00+09:00`) + m * 60_000
    const wait = commentCoverageOf(m, GRID).firstWait ?? 999
    const human = mode === 'human' || (mode === 'mixed' && i === 0)
    return {
      postId: `p-${d.kstDate}-${i}`, queueId: `q-${d.kstDate}-${i}`, publishedAtMs: t,
      unattended: mode !== 'manualRun', queueRows: 1, publishLogs: 1, authorPersonaId: `a-${i}`,
      decider: human ? 'human' : 'auto', release: 'STAMPED_ELIGIBLE' as const,
      personaComments: [
        { personaId: `c-${i}`, createdAtMs: t + (mode === 'late' && i === 0 ? (AUTO_FIRST_COMMENT_WINDOW_MINUTES + 1) : wait) * 60_000, topLevel: true, provenance: 'auto' as const },
        ...(mode === 'dup' && i === 0 ? [{ personaId: `c-${i}`, createdAtMs: t + 90 * 60_000, topLevel: false, provenance: 'auto' as const }] : []),
      ],
    }
  })
  const auto = posts.filter((x) => x.decider === 'auto' && x.unattended)
  const want = auditTarget(auto.length)
  const sample = auto.slice(0, mode === 'auditShort' ? Math.max(0, want - 1) : want)
  const rows = sample.map((x) => ({ postId: x.postId, queueId: x.queueId ?? '', judged: true, defectYes: false, retryable: false, overdue: false }))
  if (mode === 'auditOutside') rows.push({ postId: 'elsewhere', queueId: 'elsewhere', judged: true, defectYes: false, retryable: false, overdue: false })
  return {
    kstDate: d.kstDate, stage: d.release,
    decision: { kstDate: d.kstDate, state: d.state, release: d.release, decidedBy: d.decidedBy },
    posts, orphanPublishLogs: 0, unloggedPublishes: 0, commentCapPerPost: 1,
    audits: { rows },
  }
}
const evidenceOfDay = (d: StageDecision, mode: DayMode): StageEvidenceVerdict =>
  judgeStageEvidence(d.kstDate, d.release, factsOfDay(d, mode),
    mode === 'costUnknown'
      ? { cost: [{ lane: 'comment', name: '댓글', health: 'unknown' }], errors: 'ok', supplyCostEvidence: SIDE_OK.supplyCostEvidence }
      : SIDE_OK)

type DayOpts = {
  facts?: (s: GenericStage) => PreflightFacts
  runAt?: (kstDate: string) => string
  signals?: HealthSignal[]
}
type Day = { decision: StageDecision; valid: ValidatedStageDecision | null; result: ControllerResult; evidence: StageEvidenceVerdict | null; reason: string }

/** 🔴 07:00 controller 한 번 — controller 스크립트와 같은 순서: 전날 증거 → 계획 → 그 대상 preflight(D3~D100) → 결정 → 저장 검증 */
function runDay(kstDate: string, prev: ValidatedStageDecision | null, prevMode: DayMode | null, o: DayOpts = {}): Day {
  const runAt = (o.runAt ?? at0700)(kstDate)
  const evidence = prev === null || prevMode === null ? null : evidenceOfDay(prev, prevMode)
  const plan = prev === null ? null : trialPlanOf(prev, evidence)
  // 🔴 controller 와 같다 — 계획이 있으면 그 대상, 없으면 지속 단계의 다음 칸(현재 단계 재인증 여부 · 2026-10-11 Batch A1)
  const sustained = sustainedReleaseOf(prev, evidence)
  const target = prev === null ? null : plan !== null ? (plan.base === sustained ? plan.target : null) : nextStage(sustained)
  const nextPreflight: PreflightVerdict | null = target === null ? null
    : judgeNextPreflight(target, (o.facts ?? ((s) => factsFor(s)))(target), GRID)
  const result = decideStage({
    kstDate, decidedAt: runAt, previousDecision: prev, previousEvidence: evidence,
    nextPreflight, publishedToday: 0, signals: o.signals ?? OK_SIGNALS,
  })
  const v = validateForToday(result.decision)
  return { decision: result.decision, valid: v.ok ? v.decision : null, result, evidence, reason: v.ok ? '' : v.reason }
}

/** 🔴 시작 행 — controller 가 쓴 HOLD/REPROVE · capacity 는 다음 증명 단계 */
function startRow(release: RuntimeStage, state: 'HOLD' | 'REPROVE' = 'HOLD'): ValidatedStageDecision {
  const capacity = preparedStageOf(release)
  const r = validateStoredDecision({
    row: {
      kstDate: D0, capacity, release, state, reasons: [], blocks: [], dayPinned: false, supply: null,
      decidedAt: at0700(D0), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null,
    }, expectKstDate: D0,
  })
  if (!r.ok) throw new Error(r.reason)
  return r.decision
}

/** 🔴 여러 날 — 날마다 앞날의 운영 모양(mode)을 받는다 */
function walk(start: ValidatedStageDecision, modes: readonly DayMode[], o: DayOpts | ((i: number) => DayOpts) = {}): { days: Day[]; trace: string; allValid: boolean } {
  const days: Day[] = []
  let prev: ValidatedStageDecision | null = start
  for (let i = 0; i < modes.length; i += 1) {
    const d = runDay(addDays(D0, i + 1), prev, modes[i]!, typeof o === 'function' ? o(i) : o)
    days.push(d)
    prev = d.valid
  }
  const trace = days.map((d) => `${d.decision.state}:${d.decision.release}`).join(' ')
  return { days, trace, allValid: days.every((d) => d.valid !== null) }
}
const tr = (d: Day): string => `${d.decision.state}:${d.decision.release}`
const basisOf = (d: Day): string | null => (d.decision.transition?.kind === 'TRIAL' ? d.decision.transition.basis ?? null : null)
const baseOf = (d: Day): string | null => (d.decision.transition?.kind === 'TRIAL' ? d.decision.transition.trialBase : null)
const blocked = (d: Day, code: string): boolean => d.decision.blocks.some((b) => b.code === code)

// S0 — controller가 쓰는 실제 과거 검색 정본: 누락·깨진 날짜·3일 상한을 포함한다
{
  const historyRow = (
    kstDate: string,
    release: RuntimeStage,
    state: 'HOLD' | 'PREPARE' | 'TRIAL',
  ): ValidatedStageDecision => {
    const transition = state === 'TRIAL'
      ? {
          kind: 'TRIAL' as const,
          trialBase: release === 'd5' ? 'd3' as const : 'd1' as const,
          previousKstDate: addDays(kstDate, -1), target: release,
          basis: 'PASS' as const,
        }
      : null
    const v = validateStoredDecision({
      row: {
        kstDate, capacity: preparedStageOf(release), release, state,
        reasons: [], blocks: [], dayPinned: false, supply: null,
        decidedAt: at0700(kstDate), contractVersion: STAGE_DECISION_VERSION,
        decidedBy: DECISION_WRITER, transition,
      },
      expectKstDate: kstDate,
    })
    if (!v.ok) throw new Error(v.reason)
    return v.decision
  }
  const previous = historyRow(D0, 'd3', 'HOLD')
  const seed = historyRow(addDays(D0, -3), 'd5', 'TRIAL')
  const hold1 = historyRow(addDays(D0, -2), 'd3', 'HOLD')
  const hold2 = historyRow(addDays(D0, -1), 'd3', 'PREPARE')
  const full = new Map([seed, hold1, hold2].map((d) => [d.kstDate, d]))
  const calls: string[] = []
  const carried = await carriedTrialPlanFor(previous, {
    readDecision: async (date) => { calls.push(date); return full.get(date) ?? null },
    readEvidence: async (decision) => decision.kstDate === seed.kstDate
      ? evidenceOfDay(decision, 'perfect') : null,
  })
  check('🔴 S0 실제 검색 — 최신→과거 3일을 읽고 PASS seed에서 d10 계획을 복원한다',
    calls.join(',') === [hold2.kstDate, hold1.kstDate, seed.kstDate].join(',')
    && carried?.base === 'd5' && carried.target === 'd10' && carried.basis === 'PASS')

  const missing = await carriedTrialPlanFor(previous, {
    readDecision: async () => null,
    readEvidence: async () => { throw new Error('누락 행의 증거를 읽으면 안 된다') },
  })
  check('🔴 S0 과거 결정이 누락·깨졌으면 계획을 지어내지 않는다', missing === null)

  const wrongDate = await carriedTrialPlanFor(previous, {
    readDecision: async () => seed,
    readEvidence: async () => evidenceOfDay(seed, 'perfect'),
  })
  check('🔴 S0 저장소가 요청과 다른 날짜 행을 돌려주면 계획을 잇지 않는다', wrongDate === null)

  const overLimitRows = new Map([
    historyRow(addDays(D0, -1), 'd3', 'HOLD'),
    historyRow(addDays(D0, -2), 'd3', 'HOLD'),
    historyRow(addDays(D0, -3), 'd3', 'HOLD'),
    historyRow(addDays(D0, -4), 'd5', 'TRIAL'),
  ].map((d) => [d.kstDate, d]))
  const overLimit = await carriedTrialPlanFor(previous, {
    readDecision: async (date) => overLimitRows.get(date) ?? null,
    readEvidence: async (decision) => decision.state === 'TRIAL' ? evidenceOfDay(decision, 'perfect') : null,
  })
  check('🔴 S0 3일보다 오래된 인증 seed는 읽지 않고 계획을 버린다', overLimit === null)

  let nonCarryReads = 0
  const nonCarry = await carriedTrialPlanFor(seed, {
    readDecision: async () => { nonCarryReads += 1; return null },
    readEvidence: async () => null,
  })
  check('🔴 S0 TRIAL·REPROVE 같은 증명일에는 이월 검색 자체를 하지 않는다', nonCarry === null && nonCarryReads === 0)
}

// S-CERT — 인증 권한과 다음 시험 계획을 나눈다: brake·lease HOLD 가 낮춘 공개는 인증을 지우지 않는다
{
  const BAD_COST: HealthSignal[] = [
    { axis: 'quality', health: 'ok', reasons: [] }, { axis: 'cost', health: 'bad', reasons: ['UNSETTLED_OVERRUN'] },
    { axis: 'errors', health: 'ok', reasons: [] },
  ]
  const validated = (row: Record<string, unknown>): ValidatedStageDecision | string => {
    const v = validateStoredDecision({ row, expectKstDate: row.kstDate as string })
    return v.ok ? v.decision : v.reason
  }
  const rowOf = (kstDate: string, release: RuntimeStage, state: string, transition: unknown, contractVersion: string = STAGE_DECISION_VERSION) => ({
    kstDate, capacity: preparedStageOf(release), release, state, reasons: [], blocks: [], dayPinned: false, supply: null,
    decidedAt: at0700(kstDate), contractVersion, decidedBy: DECISION_WRITER, transition,
  })

  /** 🔴 controller 스크립트 main 과 같은 조립 — 저장소에서 전날 행 · 그 증거 · 되짚은 계획을 읽고 decideStage → 저장 검증 */
  const passDay = addDays(D0, -10)
  const store = new Map<string, ValidatedStageDecision>()
  const evidenceOf = (d: ValidatedStageDecision): StageEvidenceVerdict =>
    evidenceOfDay(d, d.kstDate === passDay ? 'perfect' : 'unread')
  const controllerDay = async (kstDate: string, signals: HealthSignal[]): Promise<Day> => {
    const prev = store.get(addDays(kstDate, -1)) ?? null
    const evidence = prev === null ? null : evidenceOf(prev)
    const carried = prev === null ? null : await carriedTrialPlanFor(prev, {
      readDecision: async (date) => store.get(date) ?? null, readEvidence: async (d) => evidenceOf(d),
    })
    const sustained = sustainedReleaseOf(prev, evidence, carried)
    const plan = prev === null ? null : trialPlanOf(prev, evidence, carried)
    const target = plan !== null ? (plan.base === sustained ? plan.target : null) : nextStage(sustained)
    // 다음 칸 preflight 는 모름 — 시험·재인증 없이 평상 PREPARE 가 이어지는 날
    const nextPreflight = target === null ? null : judgeNextPreflight(target, factsFor(target, { contractValidPersonas: null }), GRID)
    const result = decideStage({
      kstDate, decidedAt: at0700(kstDate), previousDecision: prev, previousEvidence: evidence, carriedPlan: carried,
      nextPreflight, publishedToday: 0, signals,
    })
    const v = validateForToday(result.decision)
    if (v.ok) store.set(kstDate, v.decision)
    return { decision: result.decision, valid: v.ok ? v.decision : null, result, evidence, reason: v.ok ? '' : v.reason }
  }
  const seed = validated(rowOf(passDay, 'd10', 'TRIAL', {
    kind: 'TRIAL', trialBase: 'd5', previousKstDate: addDays(passDay, -1), target: 'd10', basis: 'PASS',
  }))
  if (typeof seed === 'string') throw new Error(seed)
  store.set(passDay, seed)
  check('S-CERT 시작 — 운영 d10 시험일이 증거 PASS 다', evidenceOf(seed).verdict === 'PASS')

  const normal: Day[] = []
  for (let k = 1; k <= 6; k += 1) normal.push(await controllerDay(addDays(passDay, k), OK_SIGNALS))
  console.log(`   S-CERT 평상 사슬: ${normal.map(tr).join(' ')}`)
  check('S-CERT PASS 뒤 6일 평상 PREPARE d10 — 시험·재인증 없이 공개 d10 유지 · 저장 계약 통과',
    normal.every((d) => tr(d) === 'PREPARE:d10' && d.valid !== null && d.decision.transition === null), normal.map((d) => d.reason).join(' / '))

  /**
   * 🔴 **H2 배포 단계 — 이 판은 reader 판이다.** validator · `sustainedReleaseOf` 는 `CERTIFIED` 행을 읽고,
   *    controller 경로는 쓰지 않는다(write 0). writer 활성은 reader 판 배포·rollback 호환 확인 뒤의 별도 릴리스다.
   *    🔴 아래 기대값은 `READER_READY` 기준이다 — writer 를 켜는 릴리스는 이 단언부터 일부러 바꿔야 한다.
   */
  const phase: CertifiedRolloutPhase = CERTIFIED_ROLLOUT_PHASE
  check('🔴🔴 H2 — 이 판의 CERTIFIED 단계는 READER_READY 다(코드 상수 · env·문자열 파싱 없음)', phase === 'READER_READY', phase)
  check('🔴 H2 writer 계약 — READER_READY 는 인증이 높아도 null · WRITER_ACTIVE 만 공개보다 높은 인증을 CERTIFIED 로 쓴다',
    certifiedProvenanceOf('READER_READY', 'd5', 'd10') === null
    && certifiedProvenanceOf('WRITER_ACTIVE', 'd10', 'd10') === null
    && certifiedProvenanceOf('WRITER_ACTIVE', 'd5', 'd10')?.kind === 'CERTIFIED')

  const brakeDay = await controllerDay(addDays(passDay, 7), BAD_COST)
  check('🔴🔴 S-CERT reader 판 write 0 — PASS 가 7일 전인 날 비용 bad → 감속 PREPARE d5 · 행에 CERTIFIED 를 쓰지 않는다',
    tr(brakeDay) === 'PREPARE:d5' && brakeDay.result.brake === 'slowdown' && brakeDay.valid !== null
    && brakeDay.result.sustained === 'd10' && brakeDay.decision.transition === null, `${tr(brakeDay)} ${brakeDay.reason}`)
  const after = await controllerDay(addDays(passDay, 8), OK_SIGNALS)
  check('🔴 S-CERT reader 판 한계 고정 — 이월 밖 감속은 다음 정상일에도 d5 로 남는다(BRAKE_DEMOTION_PERSISTS 는 writer 활성 전 미해소)',
    tr(after) === 'PREPARE:d5' && after.result.sustained === 'd5', tr(after))

  // 🔴 reader 수용 — writer 활성 판이 쓸 같은 행(합성 CERTIFIED)을 이 판의 validator · controller 가 읽는다
  const certifiedRow = validated(rowOf(brakeDay.decision.kstDate, 'd5', 'PREPARE',
    certifiedProvenanceOf('WRITER_ACTIVE', 'd5', 'd10')))
  if (typeof certifiedRow === 'string') throw new Error(certifiedRow)
  check('🔴 S-CERT reader 수용 — 합성 CERTIFIED d10 행이 저장 계약을 지나고 지속 단계 d10 으로 읽힌다',
    certifiedRow.transition?.kind === 'CERTIFIED' && sustainedReleaseOf(certifiedRow, evidenceOf(certifiedRow), null) === 'd10')
  store.set(certifiedRow.kstDate, certifiedRow)
  const afterReader = await controllerDay(addDays(passDay, 8), OK_SIGNALS)
  check('🔴🔴 S-CERT reader 수용 — 전날이 합성 CERTIFIED 행이면 다음 정상일 인증 d10 복원 · 새 행엔 인증 칸 없음',
    tr(afterReader) === 'PREPARE:d10' && afterReader.result.sustained === 'd10' && afterReader.decision.transition === null, tr(afterReader))

  // 🔴 고치기 전 코드의 경로 — 같은 brake 행이 인증 칸 없이 저장되면 되짚을 PASS 가 3일 밖이라 d5 로 떨어진다
  const legacyBrake = validated({ ...rowOf(brakeDay.decision.kstDate, 'd5', 'PREPARE', null) })
  if (typeof legacyBrake === 'string') throw new Error(legacyBrake)
  const legacyCarried = await carriedTrialPlanFor(legacyBrake, {
    readDecision: async (date) => store.get(date) ?? null, readEvidence: async (d) => evidenceOf(d),
  })
  check('🔴 S-CERT 반례 고정 — 인증 칸이 없던 옛 행이면 이월 계획 null · 지속 d5(고치기 전 결과)',
    legacyCarried === null && sustainedReleaseOf(legacyBrake, evidenceOf(legacyBrake), legacyCarried) === 'd5')

  const bad2 = await controllerDay(addDays(passDay, 9), BAD_COST)
  const bad3 = await controllerDay(addDays(passDay, 10), BAD_COST)
  check('🔴 S-CERT reader 판 한계 고정 — 이틀 연속 brake 면 첫날만 인증 d10 아래 d5 · 인증 칸을 쓰지 않으니 둘째 날 d3 로 내려간다',
    tr(bad2) === 'PREPARE:d5' && bad2.decision.transition === null
    && tr(bad3) === 'PREPARE:d3' && bad3.decision.transition === null,
    [bad2, bad3].map(tr).join(' '))

  // D — lease 안전 HOLD: 어제 brake d3 · 인증 d5(합성 CERTIFIED) · 오늘 lease busy → 공개 d3 HOLD(올리지 않음)
  const yBrake = validated(rowOf(D0, 'd3', 'PREPARE', { kind: 'CERTIFIED', certified: 'd5' }))
  if (typeof yBrake === 'string') throw new Error(yBrake)
  const today = addDays(D0, 1)
  const lease = leaseSafeHoldOf({
    kstDate: today, decidedAt: new Date(`${today}T07:55:00+09:00`).toISOString(), lease: 'busy',
    authority: { kind: 'exact', previous: yBrake }, previousEvidence: evidenceOfDay(yBrake, 'unread'), carriedPlan: null,
  })
  const leaseValid = validateForToday(lease.decision)
  check('🔴🔴 D lease busy + 어제 brake d3(합성 인증 d5) → HOLD d3 · d5 로 올리지 않는다 · reader 판은 인증 칸을 쓰지 않는다',
    lease.decision.state === 'HOLD' && lease.decision.release === 'd3' && lease.certified === 'd5'
    && lease.decision.transition === null && leaseValid.ok,
    `${lease.decision.state}:${lease.decision.release} ${leaseValid.ok ? '' : leaseValid.reason}`)
  check('🔴 D 반례 고정 — 고치기 전 공식(sustainedReleaseOf 그대로)은 같은 입력에서 d5 를 공개했다',
    sustainedReleaseOf(yBrake, evidenceOfDay(yBrake, 'unread'), null) === 'd5')
  const nextAfter = (prev: ValidatedStageDecision) => decideStage({
    kstDate: addDays(prev.kstDate, 1), decidedAt: at0700(addDays(prev.kstDate, 1)), previousDecision: prev,
    previousEvidence: evidenceOfDay(prev, 'unread'), carriedPlan: null,
    nextPreflight: judgeNextPreflight('d10', factsFor('d10', { contractValidPersonas: null }), GRID), publishedToday: 0, signals: OK_SIGNALS,
  })
  const fromCertified = nextAfter(yBrake)
  check('🔴 D reader 수용 — 전날이 합성 CERTIFIED d5 행이면 신호 ok 인 다음 controller 가 인증 d5 복원',
    fromCertified.decision.release === 'd5' && fromCertified.sustained === 'd5',
    `${fromCertified.decision.state}:${fromCertified.decision.release}`)
  if (leaseValid.ok) {
    const next = nextAfter(leaseValid.decision)
    check('🔴 D reader 판 한계 고정 — 인증 칸 없는 lease HOLD 다음 날은 d3 유지(writer 활성 전 복원 없음)',
      next.decision.release === 'd3' && next.sustained === 'd3', `${next.decision.state}:${next.decision.release}`)
  }
  const plainPrev = validated(rowOf(D0, 'd5', 'PREPARE', null))
  const trialFail = validated(rowOf(D0, 'd10', 'TRIAL', { kind: 'TRIAL', trialBase: 'd5', previousKstDate: addDays(D0, -1), target: 'd10', basis: 'PASS' }))
  if (typeof plainPrev === 'string' || typeof trialFail === 'string') throw new Error('S-CERT 행 검증 실패')
  const leaseOf = (p: ValidatedStageDecision | null) => leaseSafeHoldOf({
    kstDate: today, decidedAt: new Date(`${today}T07:55:00+09:00`).toISOString(), lease: 'unknown',
    authority: p === null ? { kind: 'first-run' } : { kind: 'exact', previous: p },
    previousEvidence: p === null ? null : evidenceOfDay(p, 'unread'), carriedPlan: null,
  }).decision
  check('D lease HOLD — 평상 d5 는 d5 그대로(인증 칸 없음) · 시험 d10 미증명은 기반 d5 · 전날 결정 없음은 d1',
    leaseOf(plainPrev).release === 'd5' && leaseOf(plainPrev).transition === null
    && leaseOf(trialFail).release === 'd5' && leaseOf(null).release === 'd1')

  // S-BLIND — 신호를 보지 못한 HOLD 는 인접한 전날 행일 때만 보이던 공개를 지킨다. 다리·첫 시작은 보이는 공개가 d1 이다
  {
    const bridgeRow = validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd10' }))
    if (typeof bridgeRow === 'string') throw new Error(bridgeRow)
    const decidedAt = new Date(`${today}T07:55:00+09:00`).toISOString()
    const bridgeAuth = { kind: 'bridge', bridge: bridgeRow } as const
    const exactAuth = { kind: 'exact', previous: bridgeRow } as const
    const firstAuth = { kind: 'first-run' } as const
    const failOf = (authority: typeof bridgeAuth | typeof exactAuth | typeof firstAuth, certified: 'd1' | 'd5' | 'd10') =>
      inputFailureHoldOf({ kstDate: today, decidedAt, authority, certified, reason: 'fixture 재고 읽기 실패' })
    const leaseBy = (authority: typeof bridgeAuth | typeof exactAuth | typeof firstAuth) => leaseSafeHoldOf({
      kstDate: today, decidedAt, lease: 'busy', authority,
      previousEvidence: authority.kind === 'first-run' ? null : evidenceOfDay(bridgeRow, 'unread'), carriedPlan: null,
    })
    const bf = failOf(bridgeAuth, 'd10')
    const bl = leaseBy(bridgeAuth)
    check('🔴🔴 S-BLIND 다리 + 입력 실패 → 보이는 공개 d1 HOLD(이틀 전 d5 를 되살리지 않는다) · 숨은 인증 d10 은 reader 판에서 행에 쓰지 않는다',
      bf.state === 'HOLD' && bf.release === 'd1' && bf.capacity === 'd1' && bf.transition === null && validateForToday(bf).ok,
      `${bf.state}:${bf.release}`)
    check('🔴🔴 S-BLIND 다리 + lease 안전 HOLD → 보이는 공개 d1 · 인증 d10 은 숨겨 둔다 · reader 판은 CERTIFIED 0',
      bl.decision.state === 'HOLD' && bl.decision.release === 'd1' && bl.certified === 'd10'
      && bl.decision.transition === null && validateForToday(bl.decision).ok,
      `${bl.decision.state}:${bl.decision.release}`)
    check('🔴 S-BLIND 반례 고정 — 고치기 전 공식(heldReleaseOf 그대로)은 같은 다리 입력에서 d5 를 공개했다',
      heldReleaseOf(bridgeRow, 'd10') === 'd5' && signalBlindReleaseOf(bridgeAuth, 'd10') === 'd1')
    const ef = failOf(exactAuth, 'd10')
    const el = leaseBy(exactAuth)
    check('🔴 S-BLIND 인접 전날 행은 보이던 공개를 보존한다 — 입력 실패·lease 모두 d5(올리지도 내리지도 않는다)',
      ef.release === 'd5' && el.decision.release === 'd5' && el.certified === 'd10'
      && ef.transition === null && el.decision.transition === null)
    const ff = failOf(firstAuth, 'd1')
    const fl = leaseBy(firstAuth)
    check('🔴 S-BLIND 첫 시작은 입력 실패·lease 모두 d1 · 인증 d1',
      ff.release === 'd1' && fl.decision.release === 'd1' && fl.certified === 'd1'
      && ff.transition === null && fl.decision.transition === null)
    check('🔴 S-BLIND reader 판 전이 0 — 어떤 권한이든 신호 없는 HOLD 는 CERTIFIED 를 쓰지 않는다',
      [bf, bl.decision, ef, el.decision, ff, fl.decision].every((d) => d.transition === null))
    check('🔴 S-BLIND writer 활성 판에서만 숨은 인증 d10 이 행에 남는다(d1 공개 + CERTIFIED d10)',
      certifiedProvenanceOf('WRITER_ACTIVE', bf.release, 'd10')?.kind === 'CERTIFIED'
      && certifiedProvenanceOf('READER_READY', bf.release, 'd10') === null)
    const bridgeSignalAware = bridgeHoldOf({
      kstDate: today, decidedAt, bridge: bridgeRow, bridgeEvidence: evidenceOfDay(bridgeRow, 'unread'),
      publishedToday: 0, signals: OK_SIGNALS,
    })
    const bridgeBad = bridgeHoldOf({
      kstDate: today, decidedAt, bridge: bridgeRow, bridgeEvidence: evidenceOfDay(bridgeRow, 'unread'),
      publishedToday: 0, signals: BAD_COST,
    })
    check('🔴 S-BLIND 정상 bridgeHoldOf 는 그대로 신호를 본다 — ok 는 holdUnknown · bad 는 slowdown d5다',
      bridgeSignalAware.decision.release === 'd5' && bridgeSignalAware.brake === 'holdUnknown'
      && bridgeBad.decision.release === 'd5' && bridgeBad.brake === 'slowdown',
      `${bridgeSignalAware.decision.release} ${bridgeBad.decision.release}`)
  }

  // 저장 계약 — 구조화된 인증 칸만 받는다(문구 파싱 없음) · 옛 행은 그대로 읽힌다
  check('🔴 계약 — CERTIFIED 는 공개보다 높아야 하고 HOLD·PREPARE·v5 에만 붙는다',
    typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd5' })) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd3' })) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd99' })) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'REPROVE', { kind: 'CERTIFIED', certified: 'd10' })) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd10' }, 'stage-decision-v4')) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd10' })) !== 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', null)) !== 'string')

  // S-GAP (M3) — 전날 행 읽기 실패·깨짐은 계산·저장 0 · 하루 누락은 이틀 전 행 하나로 권한만 잇는다
  {
    type Slot = ValidatedStageDecision | 'broken' | 'throw'
    const rows = new Map<string, Slot>()
    const reads: string[] = []
    let computes = 0
    let writes = 0
    const read = async (date: string): Promise<DecisionRead> => {
      reads.push(date)
      const r = rows.get(date)
      if (r === 'throw') throw new Error('PrismaClientKnownRequestError')
      if (r === 'broken') return { kind: 'broken', reason: 'fixture broken row' }
      return r === undefined ? { kind: 'absent' } : { kind: 'valid', decision: r }
    }
    /** controller main 과 같은 조립 — 권한 판정 → (멈춤 | 다리 HOLD | decideStage) → 저장 검증 */
    const assemble = async (kstDate: string, signals: HealthSignal[]) => {
      reads.length = 0
      const a = await resolvePreviousAuthority(kstDate, read)
      if (a.kind === 'stop') return { stop: a.code, reads: [...reads] } as const
      computes += 1
      let result: ControllerResult
      if (a.kind === 'bridge') {
        result = bridgeHoldOf({
          kstDate, decidedAt: at0700(kstDate), bridge: a.bridge, bridgeEvidence: evidenceOfDay(a.bridge, 'unread'),
          publishedToday: 0, signals,
        })
      } else {
        const prev = a.kind === 'exact' ? a.previous : null
        const evidence = prev === null ? null : evidenceOfDay(prev, 'unread')
        const sustained = sustainedReleaseOf(prev, evidence, null)
        const plan = prev === null ? null : trialPlanOf(prev, evidence, null)
        const target = plan !== null ? (plan.base === sustained ? plan.target : null) : nextStage(sustained)
        result = decideStage({
          kstDate, decidedAt: at0700(kstDate), previousDecision: prev, previousEvidence: evidence, carriedPlan: null,
          // 🔴 preflight 는 열려 있다 — 다리 날이 그래도 시험을 열지 않는지 본다
          nextPreflight: target === null ? null : judgeNextPreflight(target, factsFor(target), GRID), publishedToday: 0, signals,
        })
      }
      const v = validateForToday(result.decision)
      if (v.ok) { rows.set(kstDate, v.decision); writes += 1 }
      return { decision: result.decision, valid: v.ok, reads: [...reads], authority: a.kind } as const
    }
    const X = addDays(D0, 20)
    const brakeRow = validated(rowOf(X, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd10' }))
    if (typeof brakeRow === 'string') throw new Error(brakeRow)

    rows.set(X, 'throw')
    const thrown = await assemble(addDays(X, 1), OK_SIGNALS)
    check('🔴🔴 S-GAP 전날 행 읽기 예외 → PREVIOUS_READ_ERROR · 결정 계산 0 · 저장 0 (d1 대체 행을 쓰지 않는다)',
      'stop' in thrown && thrown.stop === 'PREVIOUS_READ_ERROR' && computes === 0 && writes === 0 && !rows.has(addDays(X, 1)))
    rows.set(X, 'broken')
    rows.set(addDays(X, -1), brakeRow)
    const broken = await assemble(addDays(X, 1), OK_SIGNALS)
    check('🔴🔴 S-GAP 전날 행 깨짐 → PREVIOUS_BROKEN · 계산·저장 0 · 이틀 전 유효 행으로 건너뛰지 않는다(읽은 날 = 전날 하나)',
      'stop' in broken && broken.stop === 'PREVIOUS_BROKEN' && computes === 0 && writes === 0
      && broken.reads.length === 1 && broken.reads[0] === X)

    rows.clear()
    rows.set(X, brakeRow)
    const gap = await assemble(addDays(X, 2), OK_SIGNALS)
    check('🔴🔴 S-GAP 하루 누락 + 이틀 전 유효(공개 d5 · 합성 인증 d10) → 시험 없음 · 공개 d5 HOLD/PREPARE · reader 판은 인증 칸을 쓰지 않는다',
      !('stop' in gap) && gap.authority === 'bridge' && gap.valid
      && (gap.decision.state === 'HOLD' || gap.decision.state === 'PREPARE') && gap.decision.release === 'd5'
      && gap.decision.transition === null
      && gap.reads.join(',') === `${addDays(X, 1)},${X}`,
      'stop' in gap ? gap.stop : `${gap.decision.state}:${gap.decision.release} reads=${gap.reads.join(',')}`)
    const gapNext = await assemble(addDays(X, 3), OK_SIGNALS)
    check('🔴 S-GAP 다음 날 — 다리 행이 전날 행이 되어 정상 연속(이력 검색 없음) · reader 판 한계: 인증 칸이 없어 d5 유지',
      !('stop' in gapNext) && gapNext.authority === 'exact' && gapNext.valid && gapNext.decision.release === 'd5'
      && gapNext.reads.length === 1,
      'stop' in gapNext ? gapNext.stop : `${gapNext.decision.state}:${gapNext.decision.release}`)
    const plainRow = validated(rowOf(X, 'd5', 'PREPARE', null))
    if (typeof plainRow === 'string') throw new Error(plainRow)
    rows.clear()
    rows.set(X, plainRow)
    const gapPlain = await assemble(addDays(X, 2), OK_SIGNALS)
    const exactPlain = decideStage({
      kstDate: addDays(X, 1), decidedAt: at0700(addDays(X, 1)), previousDecision: plainRow,
      previousEvidence: evidenceOfDay(plainRow, 'unread'), carriedPlan: null,
      nextPreflight: judgeNextPreflight('d10', factsFor('d10'), GRID), publishedToday: 0, signals: OK_SIGNALS,
    })
    check('🔴 S-GAP 다리 날은 preflight PASS 여도 TRIAL·REPROVE 를 열지 않는다(인접 전날이면 여는 같은 입력 대조)',
      !('stop' in gapPlain) && gapPlain.decision.state !== 'TRIAL' && gapPlain.decision.state !== 'REPROVE'
      && gapPlain.decision.release === 'd5'
      && (exactPlain.decision.state === 'REPROVE' || exactPlain.decision.state === 'TRIAL'),
      `${'stop' in gapPlain ? gapPlain.stop : gapPlain.decision.state} / 대조 ${exactPlain.decision.state}`)
    rows.clear()
    rows.set(X, brakeRow)
    const gapBrake = await assemble(addDays(X, 2), BAD_COST)
    check('🔴 S-GAP 다리 날 비용 bad → 공개 d5(합성 인증 d10 아래 칸) · reader 판 write 0',
      !('stop' in gapBrake) && gapBrake.decision.release === 'd5' && gapBrake.decision.transition === null)

    rows.clear()
    const first = await assemble(addDays(X, 2), OK_SIGNALS)
    check('🟢 S-GAP 전날·이틀 전 모두 진짜 없음 → 첫 시작 d1 · 읽은 날은 둘뿐(그 앞을 훑지 않는다)',
      !('stop' in first) && first.authority === 'first-run' && first.valid && first.decision.release === 'd1'
      && first.reads.length === 2)
    rows.clear()
    rows.set(X, 'broken')
    const deepBroken = await assemble(addDays(X, 2), OK_SIGNALS)
    check('🔴 S-GAP 전날 없음 + 이틀 전 깨짐 → 진짜 첫 시작이 아니다 → PREVIOUS_BROKEN · 저장 0',
      'stop' in deepBroken && deepBroken.stop === 'PREVIOUS_BROKEN' && !rows.has(addDays(X, 2)))
  }
}

// S1 — 전부 PASS → 날마다 한 칸 · 맨 위 d50 에서 멈춘다
{
  const w = walk(startRow('d1'), ['perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect'])
  console.log(`   S1 전부 PASS: ${w.trace}`)
  check('🟢 S1 PASS 다음 날마다 한 칸 — d3 → d5 → d10 → d20 → d30 → d50 (날짜로 기다리지 않는다)',
    w.days.slice(0, 6).map(tr).join(' ') === 'TRIAL:d3 TRIAL:d5 TRIAL:d10 TRIAL:d20 TRIAL:d30 TRIAL:d50', w.trace)
  check('S1 근거 — 자연 exact d1을 포함해 전부 PASS · 기반은 전날 공개', w.days.slice(0, 6).every((d) => basisOf(d) === 'PASS')
    && w.days.slice(0, 6).every((d, i) => baseOf(d) === (i === 0 ? 'd1' : w.days[i - 1]!.decision.release)))
  check('S1 모든 결정이 저장 계약을 통과한다', w.allValid, w.days.map((d) => d.reason).filter((x) => x !== '').join(' / '))
  check('🔴 S1 d50 PASS 뒤 — 지속 d50(증명됐다) · 위 칸 없음 → 평상일 HOLD d50(재증명할 다음 칸이 없다) · 러너 밖(d100)으로 가지 않는다',
    tr(w.days[6]!) === 'HOLD:d50' && w.days.every((d) => stageRank(d.decision.release) <= stageRank('d50')), w.trace)
  check('S1 d20 시험은 07:00 에 열려 08:00 첫 슬롯부터 20건 — 결정의 capacity 는 다음 증명 d30',
    w.days[3]!.decision.capacity === 'd30' && firstSlotOn(w.days[3]!.decision.kstDate, profileOf('d20'))!.toISOString()
      === new Date(`${w.days[3]!.decision.kstDate}T08:00:00+09:00`).toISOString())
  check('🔴 S1 어느 날도 SUSTAIN 을 만들지 않는다', w.days.every((d) => d.decision.state !== 'SUSTAIN'))
}

// S2 — 🔴 계약 유효 Persona 를 읽지 못함(null) → 바닥에서 올라가지 않는다
{
  const w = walk(startRow('d1'), Array.from({ length: 5 }, () => 'perfect' as const), { facts: (s) => factsFor(s, { contractValidPersonas: null }) })
  console.log(`   S2 Persona 모름: ${w.trace}`)
  check('🔴 🔴 S2 contractValidPersonas=null 5일 — d3 도 열리지 않는다(PREFLIGHT_UNKNOWN) · 바닥 PREPARE',
    w.days.every((d) => tr(d) === 'PREPARE:d1' && blocked(d, 'PREFLIGHT_UNKNOWN')), w.trace)
  check('S2 모든 결정이 저장 계약을 통과한다', w.allValid)
}

// S2b — 🔴 오늘 운영 모양(2026-09-30 실측): 계약 유효 Persona 0 → D3 하한 24 미달 → D1→D3 시험부터 열리지 않는다
{
  const w = walk(startRow('d1'), Array.from({ length: 5 }, () => 'perfect' as const), { facts: (s) => factsFor(s, { contractValidPersonas: 0 }) })
  console.log(`   S2b Persona 0: ${w.trace}`)
  check('🔴 🔴 S2b contractValidPersonas=0 5일 — d3 시험이 한 번도 열리지 않는다(PREFLIGHT_FAIL) · 바닥 PREPARE',
    w.days.every((d) => tr(d) === 'PREPARE:d1' && blocked(d, 'PREFLIGHT_FAIL')), w.trace)
  check('S2b 모든 결정이 저장 계약을 통과한다', w.allValid)
}

// S3 — FAIL · UNKNOWN · 모름 → 같은 단계 재시험
{
  const modes: DayMode[] = ['perfect', 'perfect', 'perfect', 'late', 'costUnknown', 'unread', 'perfect']
  const w = walk(startRow('d5', 'REPROVE'), modes)
  console.log(`   S3 d30 에서 FAIL·UNKNOWN·못 읽음: ${w.trace}`)
  check('S3 앞 셋 — REPROVE d5 PASS → d10 → d20 → d30', w.days.slice(0, 3).map(tr).join(' ') === 'TRIAL:d10 TRIAL:d20 TRIAL:d30', w.trace)
  check('🔴 S3 d30 첫 댓글 61분(FAIL) → 다음 날 d30 재시험(기반 d20 · RETEST)', tr(w.days[3]!) === 'TRIAL:d30'
    && basisOf(w.days[3]!) === 'RETEST' && baseOf(w.days[3]!) === 'd20' && w.days[3]!.evidence?.verdict === 'FAIL')
  check('🔴 S3 비용 모름(UNKNOWN) → 또 d30 재시험', tr(w.days[4]!) === 'TRIAL:d30' && basisOf(w.days[4]!) === 'RETEST' && w.days[4]!.evidence?.verdict === 'UNKNOWN')
  check('🔴 S3 증거를 못 읽음 → 또 d30 재시험', tr(w.days[5]!) === 'TRIAL:d30' && basisOf(w.days[5]!) === 'RETEST')
  check('S3 PASS 가 난 다음 날에야 d50', tr(w.days[6]!) === 'TRIAL:d50' && basisOf(w.days[6]!) === 'PASS')
}

// S4 — 날짜만으로는 오르지 않는다 · HOLD 날도 실질 증거가 완전할 때만 PASS
{
  const w = walk(startRow('d5', 'REPROVE'), Array.from({ length: 10 }, () => 'unread' as const))
  check('🔴 🔴 S4 증거 없는 10일(d10 preflight 초록) — REPROVE d5 에 머문다(시험 0 · 올라가지 않는다)', w.days.every((d) => tr(d) === 'REPROVE:d5'), w.trace)
  const h = walk(startRow('d10', 'HOLD'), ['perfect', 'perfect'])
  check('🟢 S4 HOLD d10 자연 exact-N PASS → 다음 날 바로 TRIAL d20 → 그 PASS 다음 날 TRIAL d30',
    h.trace === 'TRIAL:d20 TRIAL:d30' && h.days[0]!.evidence?.verdict === 'PASS', h.trace)
  check('🔴 S4 지정 증명일 표식은 REPROVE만 받는다(HOLD 자연 증거는 표식과 별개)',
    PROOF_STATES.includes('REPROVE') && !PROOF_STATES.includes('HOLD') && TRANSITION_STATES.includes('REPROVE'))
}

// S5 — 사람 물량은 0건
for (const m of ['human', 'mixed', 'manualRun'] as const) {
  const w = walk(startRow('d10', 'REPROVE'), ['perfect', m])
  check(`🔴 S5 ${m} — TRIAL d20 날 사람/수동 물량 → FAIL PUBLISH_NOT_AUTO_READY → d20 재시험`,
    tr(w.days[0]!) === 'TRIAL:d20' && tr(w.days[1]!) === 'TRIAL:d20' && basisOf(w.days[1]!) === 'RETEST'
    && w.days[1]!.evidence?.codes.includes('PUBLISH_NOT_AUTO_READY') === true, `${w.trace} ${JSON.stringify(w.days[1]!.evidence?.codes)}`)
}

// S7 — 한 관문 (preflight · 첫 슬롯) — D3~D100 같은 구조
{
  const base = (o: DayOpts): Day => runDay(addDays(D0, 1), startRow('d10', 'REPROVE'), 'perfect', o)
  const green = base({})
  check('S7 기준선 — REPROVE d10 PASS · preflight 초록 → TRIAL d20', tr(green) === 'TRIAL:d20' && green.valid !== null)
  const cases: { name: string; o: DayOpts; code: string }[] = [
    { name: 'slot-valid 기회 모자람', o: { facts: (s) => factsFor(s, { slotValidOpportunities: 5 }) }, code: 'PREFLIGHT_FAIL' },
    { name: '처리량 모자람', o: { facts: (s) => factsFor(s, { readyCohort: cohortFor(s, { sources: 10_000 }) }) }, code: 'PREFLIGHT_FAIL' },
    { name: 'Persona canary 하한 미달', o: { facts: (s) => factsFor(s, { contractValidPersonas: 10 }) }, code: 'PREFLIGHT_FAIL' },
    { name: '댓글 비용 초과', o: { facts: (s) => factsFor(s, { commentUsdPerRequest: 0.05 }) }, code: 'PREFLIGHT_FAIL' },
    { name: '공급 비용 모름', o: { facts: (s) => factsFor(s, { readyCohort: cohortFor(s, { usdPerSlotValidResult: null }) }) }, code: 'PREFLIGHT_UNKNOWN' },
    { name: '08:30 에 늦게 돈 controller', o: { runAt: (d) => new Date(`${d}T08:30:00+09:00`).toISOString() }, code: 'LATE_START' },
  ]
  for (const c of cases) {
    const d = base(c.o)
    check(`🔴 S7 ${c.name} → d20 을 열지 않는다 · ${c.code} · d10 평상일(증명일 아님 · 0..10)`, tr(d) === 'PREPARE:d10' && blocked(d, c.code) && d.valid !== null,
      `${tr(d)} ${JSON.stringify(d.decision.blocks.map((b) => b.code))}`)
  }
  check('🔴 S7 preflight 없이(null) 시험 → PREFLIGHT_UNKNOWN', trialBlocks({
    target: 'd20', kstDate: D0, runAt: at0700(D0), preflight: null,
  }).some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
  check('🔴 S7 다른 단계(d30) preflight 초록으로 d20 을 열지 않는다', trialBlocks({
    target: 'd20', kstDate: D0, runAt: at0700(D0), preflight: judgeNextPreflight('d30', factsFor('d30'), GRID),
  }).some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
  // 🔴 (2026-09-30) d3~d10 도 같은 관문이다 — 사실을 모르면 d5 도 열리지 않는다
  const d5 = runDay(addDays(D0, 1), startRow('d3', 'REPROVE'), 'perfect', { facts: (s) => factsFor(s, {
    slotValidOpportunities: null, contractValidPersonas: null, commentUsdPerRequest: null, auditUsdPerCall: null, readyCohort: null,
  }) })
  check('🔴 🔴 S7 d3~d10 시험도 같은 관문을 지난다(사실 전부 모름 → d5 열지 않음 · 평상일 PREPARE d3)',
    tr(d5) === 'PREPARE:d3' && blocked(d5, 'PREFLIGHT_UNKNOWN'), tr(d5))
}

// S12 — 🔴 평상일 0..Dn vs 증명일 exact N (2026-10-11 Batch A1 반례 ①③ · 증명 기반 없음 + 다음 단계 PASS → 현재 단계 재인증)
{
  const blockedD10 = (s: GenericStage): PreflightFacts => factsFor(s, s === 'd10' ? { readyCohort: cohortFor(s, { sources: 10_000 }) } : {})
  // 반례 ① d5 지속 · d10 막힘 — 날마다 평상일. 증명일 env 없음(자동 5편 강제 없음)
  const w = walk(startRow('d5', 'HOLD'), Array.from({ length: 5 }, () => 'perfect' as const), { facts: blockedD10 })
  check('🔴 🔴 S12 반례① d5 지속 · d10 preflight 막힘 5일 → 날마다 PREPARE d5(평상일) · REPROVE 0',
    w.days.every((d) => tr(d) === 'PREPARE:d5' && blocked(d, 'PREFLIGHT_FAIL')), w.trace)
  check('🔴 🔴 S12 반례① 평상일 consumer env — 증명일 두 칸이 비었다(0..5 · 자동 target 앞세움 없음)',
    w.days.every((d) => d.valid !== null && consumerEnvOf({ ok: true, decision: d.valid })[PROOF_STAGE_ENV] === ''
      && proofDayOf(consumerEnvOf({ ok: true, decision: d.valid }), new Date(`${d.decision.kstDate}T09:00:00+09:00`)) === null))
  // 반례 ③ 평상일 부족분은 빚이 아니다 — 평상일에 0편이든 2편이든 다음 날 결정은 같다
  const short = runDay(addDays(D0, 2), w.days[0]!.valid, 'unread', { facts: blockedD10 })
  const full = runDay(addDays(D0, 2), w.days[0]!.valid, 'perfect', { facts: blockedD10 })
  check('🔴 🔴 S12 반례③ 평상일 부족(0편 · 못 읽음)과 완벽한 날의 다음 결정이 같다 — 이월 빚 0',
    tr(short) === tr(full) && tr(short) === 'PREPARE:d5' && short.decision.release === 'd5', `${tr(short)} vs ${tr(full)}`)
  // 자연 exact-N 증거 + d10 preflight PASS 인 날 — 불필요한 재인증 없이 바로 d10
  const healed = walk(startRow('d5', 'HOLD'), ['perfect', 'perfect', 'perfect'], (i) => (i === 0 ? { facts: blockedD10 } : {}))
  check('🟢 S12 자연 증거 승계 — 막힌 날 PREPARE d5 → preflight 회복 즉시 TRIAL d10 → PASS 뒤 TRIAL d20',
    healed.trace === 'PREPARE:d5 TRIAL:d10 TRIAL:d20' && basisOf(healed.days[1]!) === 'PASS', healed.trace)
  check('S12 실제 다음 시험일만 증명일 env 를 받는다', healed.days[1]!.valid !== null
    && consumerEnvOf({ ok: true, decision: healed.days[1]!.valid })[PROOF_STAGE_ENV] === 'd10')
  check('S12 모든 결정이 저장 계약을 통과한다', w.allValid && healed.allValid)
}
{
}

// S8 — 운영 신호 브레이크는 증명일을 되돌린다
{
  const bad = runDay(addDays(D0, 1), startRow('d5', 'REPROVE'), 'unread', {
    signals: [{ axis: 'quality', health: 'bad', reasons: ['확정 결함 1건'] }, ...OK_SIGNALS.slice(1)],
  })
  check('🔴 S8 품질 나쁨 → 감속 · 증명일 아님(HOLD/PREPARE)', bad.result.brake === 'slowdown' && !PROOF_STATES.includes(bad.decision.state), tr(bad))
  const unk = runDay(addDays(D0, 1), startRow('d5', 'REPROVE'), 'unread', {
    signals: [OK_SIGNALS[0]!, { axis: 'cost', health: 'unknown', reasons: [] }, OK_SIGNALS[2]!],
  })
  check('🔴 S8 비용 모름 → REPROVE 를 되돌린다(자동 target 을 앞세우지 않는다)', unk.result.brake === 'holdUnknown'
    && unk.decision.release === 'd5' && !PROOF_STATES.includes(unk.decision.state), tr(unk))
}

// S9 — 러너 맨 위는 d50 · capacity 도 d50 을 넘지 않는다
{
  const w = walk(startRow('d30', 'REPROVE'), Array.from({ length: 5 }, () => 'perfect' as const))
  check('🔴 S9 d50 위는 열리지 않는다 · capacity ≤ d50', w.days.every((d) => stageRank(d.decision.release) <= stageRank('d50')
    && stageRank(d.decision.capacity) <= stageRank('d50')) && w.allValid && tr(w.days[0]!) === 'TRIAL:d50', w.trace)
}

// S10 — 중복 · 감사 표본
for (const [m, code] of [['dup', 'DUP_COMMENT'], ['auditShort', 'AUDIT_COVERAGE_SHORT'], ['auditOutside', 'AUDIT_OUTSIDE_TARGET']] as const) {
  const w = walk(startRow('d10', 'REPROVE'), ['perfect', m])
  check(`🔴 S10 ${m} → FAIL ${code} → d20 재시험`, tr(w.days[1]!) === 'TRIAL:d20' && basisOf(w.days[1]!) === 'RETEST'
    && w.days[1]!.evidence?.codes.includes(code) === true, `${w.trace} ${JSON.stringify(w.days[1]!.evidence?.codes)}`)
}

// S11 — D100 용량표는 러너 프로필과 같다 · 승격은 TRIAL → 증거 PASS 하나뿐
{
  check('🔴 S11 D100 용량표 = 러너 프로필 — d20·d30·d50 감당(슬롯 = RUNTIME_PROFILES) · d100 은 schedulerUnsupported',
    (['d20', 'd30', 'd50'] as const).every((s) => {
      const sc = schedulerSupportOf(s)
      return sc.supported && sc.releaseStage === s && sc.scheduledSlotsPerDay === RUNTIME_PROFILES[s].slots.length
        && sc.actualDailyPublishable === d100Plan(s).publicPostsPerDay
    }) && !schedulerSupportOf('d100').supported && schedulerSupportOf('d100').reason === 'schedulerUnsupported')
  check('🔴 🔴 S11 지속 승격(judgePromotion → SUSTAIN) 경로가 없다 — v5 는 SUSTAIN 을 저장하지 않는다', (() => {
    const cap = readFileSync('src/lib/d100-capacity.ts', 'utf-8')
    const v = validateStoredDecision({ row: {
      kstDate: D0, capacity: 'd5', release: 'd5', state: 'SUSTAIN', reasons: [], blocks: [], dayPinned: false, supply: null,
      decidedAt: at0700(D0), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: { kind: 'SUSTAIN', from: 'd3', to: 'd5' },
    }, expectKstDate: D0 })
    return !/export function judgePromotion/.test(cap) && !v.ok
  })())
}

// 저장 계약
{
  const V = (o: Partial<Record<keyof StageDecision, unknown>>): boolean => validateStoredDecision({
    row: {
      kstDate: D0, capacity: 'd20', release: 'd10', state: 'REPROVE', reasons: [], blocks: [], dayPinned: false, supply: null,
      decidedAt: at0700(D0), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null, ...o,
    }, expectKstDate: D0,
  }).ok
  const trial = (o: Record<string, unknown>): Partial<Record<keyof StageDecision, unknown>> => ({
    state: 'TRIAL', release: 'd20',
    transition: { kind: 'TRIAL', trialBase: 'd10', previousKstDate: addDays(D0, -1), target: 'd20', basis: 'PASS', ...o },
  })
  check('계약 — REPROVE d10 (천장 d20) 통과 · REPROVE 에 전이 근거가 붙으면 거절',
    V({}) && !V({ transition: { kind: 'SUSTAIN', from: 'd5', to: 'd10' } }))
  check('계약 — TRIAL d20 (기반 d10 · PASS) 통과', V(trial({})))
  check('🔴 계약 — TRIAL d20 이 기반 d5 에서 뛰면 거절 · 근거 없으면 거절', !V(trial({ trialBase: 'd5' })) && !V(trial({ basis: undefined })))
  check('🔴 계약 — TRIAL 에 PREFLIGHT_FAIL · PREFLIGHT_UNKNOWN · LATE_START 가 붙으면 거절',
    (['PREFLIGHT_FAIL', 'PREFLIGHT_UNKNOWN', 'LATE_START'] as const).every((code) => !V({ ...trial({}), blocks: [{ code, reason: 'x' }] })))
  check('🔴 계약 — 공개가 천장 위(d30 > d20)면 거절 · d100 은 저장 단계가 아니다',
    !V({ release: 'd30' }) && !V({ capacity: 'd100' }) && !V({ release: 'd100', capacity: 'd100' }))
}

// ─────────────────────────────────────────────────────────
section('⑥ 러너 연결 — consumer env → 러너 설정 · catch-up · 증명일 · 발행 천장')
{
  const w = walk(startRow('d10', 'REPROVE'), ['perfect'])
  const t = w.days[0]!
  const env = t.valid === null ? {} : consumerEnvOf({ ok: true, decision: t.valid })
  check('🔴 consumer — TRIAL d20 → 공개 d20 그대로(canary 없음) · capacity d30 · 증명일 d20',
    env.SORAN_RELEASE_STAGE === 'd20' && env.SORAN_CAPACITY_STAGE === 'd30' && env[PROOF_STAGE_ENV] === 'd20'
    && !Object.keys(env).some((k) => /CANARY|WINDOW/.test(k)), JSON.stringify(env))
  const now = new Date(`${t.decision.kstDate}T08:00:00+09:00`)
  const sc = resolveScale(env)
  check('🟢 러너 — 결정 env 그대로 → 공개 d20 · 하루 20건', sc.releaseStage === 'd20' && sc.releaseProfile.dailyTarget === 20, JSON.stringify(sc.notes))
  const cu = judgeCatchUp({ stage: sc.releaseStage, now, trigger: 'local', cron: null, publishedToday: 0 })
  check('러너 — 08:00 heartbeat 가 d20 첫 슬롯을 낸다(1건)', cu.run && cu.allowed === 1)
  const late = judgeCatchUp({ stage: 'd20', now: new Date(`${t.decision.kstDate}T22:10:00+09:00`), trigger: 'local', cron: null, publishedToday: 19 })
  check('🔴 러너 — 22:00 넘은 backlog 는 버린다', !late.run)
  const proof = proofDayOf(env, now)
  check('러너 — 증명일 d20 · 목표 20', proof !== null && proof.stage === 'd20' && proof.target === 20)
  check('🔴 발행 트랜잭션 천장 — 같은 env 로 d20 · d10 env 면 d20 요청도 d10 으로 누른다(옛 canary 키는 무시)',
    boundedReleaseStage('d20', env, now) === 'd20'
    && boundedReleaseStage('d20', markedStageEnv({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10', SORAN_RELEASE_CANARY_STAGE: 'd20', SORAN_RELEASE_CANARY_DATE: t.decision.kstDate }), now) === 'd10')
  const r = walk(startRow('d5', 'REPROVE'), ['unread']).days[0]! // d10 preflight 초록 · 증명 기반 없음 — 현재 단계 재인증(RETEST)
  const renv = r.valid === null ? {} : consumerEnvOf({ ok: true, decision: r.valid })
  check('consumer — REPROVE d5 → 공개 d5 · 증명일 d5', tr(r) === 'REPROVE:d5' && renv.SORAN_RELEASE_STAGE === 'd5'
    && renv[PROOF_STAGE_ENV] === 'd5', JSON.stringify(renv))
  const henv = consumerEnvOf({ ok: true, decision: startRow('d10', 'HOLD') })
  check('consumer — HOLD d10 → 증명일 아님(빈 값) · 공정성 그대로', henv[PROOF_STAGE_ENV] === '' && henv.SORAN_RELEASE_STAGE === 'd10')
}

// ─────────────────────────────────────────────────────────
section('⑦ 롤백 — stage:switch --off')
{
  const dir = mkdtempSync(join(tmpdir(), 'stage-scheduler-check-'))
  const envFile = join(dir, 'env.local')
  try {
    writeFileSync(envFile, `SORAN_CAPACITY_STAGE=d20\n${CONTROLLER_ENV}=on\nOTHER=1\n`, { mode: 0o600 })
    check('롤백 전 — controller on', controllerEnabled(readEnvKeys([CONTROLLER_ENV], envFile).values))
    const r = spawnSync(process.execPath, [...process.execArgv, 'scripts/stage-controller-switch.mts', '--off', '--apply', `--env=${envFile}`], { encoding: 'utf-8' })
    const after = readEnvKeys([CONTROLLER_ENV, 'SORAN_CAPACITY_STAGE', 'OTHER'], envFile).values
    check('🔴 stage:switch --off → controller off · 다른 키 그대로', r.status === 0 && !controllerEnabled(after)
      && after.SORAN_CAPACITY_STAGE === 'd20' && after.OTHER === '1', `${r.status} ${r.stderr.slice(-200)}`)
    check('🔴 off 면 consumer 는 d1 을 명시해서 넣는다(env 파일 단계가 이기는 legacy 경로 없음)', (() => {
      const e = consumerEnvOf({ ok: false, code: 'NO_DECISION', fallback: 'safest', reason: 'off' })
      return e.SORAN_RELEASE_STAGE === 'd1' && e.SORAN_CAPACITY_STAGE === 'd1' && e.SORAN_STAGE_DECISION_DATE === ''
    })())
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
section('⑧ 증거 본체 — d1~d10 두 입구 동일 · REPROVE 증명일')
{
  const row = (release: RuntimeStage, state: StageDecision['state']): StageDecision => ({
    kstDate: D0, capacity: preparedStageOf(release), release, state, reasons: [], blocks: [], dayPinned: false, supply: null,
    decidedAt: at0700(D0), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null,
  })
  for (const s of RELEASE_STAGES) {
    const f = factsOfDay(row(s, 'TRIAL'), 'perfect')!
    const a = judgeStageEvidence(D0, s, f, SIDE_OK)
    const b = judgeEvidenceForTarget(D0, s, PROFILES[s].dailyTarget, f, SIDE_OK)
    check(`${s} — 두 입구가 같은 판정 (${a.verdict})`, JSON.stringify(a) === JSON.stringify(b) && a.verdict === 'PASS', JSON.stringify(a.codes))
  }
  for (const s of ['d20', 'd30', 'd50'] as const) {
    const v = judgeStageEvidence(D0, s, factsOfDay(row(s, 'TRIAL'), 'perfect'), SIDE_OK)
    check(`${s} — 러너 슬롯대로 자동 ${profileOf(s).dailyTarget}편 · 첫 댓글(예약표) · 감사 ${auditTarget(profileOf(s).dailyTarget)} → PASS`,
      v.verdict === 'PASS' && v.counts.autoTargets === profileOf(s).dailyTarget, JSON.stringify(v.codes))
  }
  check('🟢 REPROVE 날 완전한 운영 → PASS', judgeStageEvidence(D0, 'd10', factsOfDay(row('d10', 'REPROVE'), 'perfect'), SIDE_OK).verdict === 'PASS')
  const hold = judgeStageEvidence(D0, 'd10', factsOfDay(row('d10', 'HOLD'), 'perfect'), SIDE_OK)
  check('🟢 HOLD · PREPARE 날도 자연 exact-N과 모든 실질 증거를 채우면 운영 PASS', hold.verdict === 'PASS'
    && judgeStageEvidence(D0, 'd5', factsOfDay(row('d5', 'PREPARE'), 'perfect'), SIDE_OK).verdict === 'PASS')
  check('비용·러너 모름 → UNKNOWN (PASS 아님)', judgeStageEvidence(D0, 'd20', factsOfDay(row('d20', 'TRIAL'), 'perfect'), null).verdict === 'UNKNOWN')
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 운영 decideStage · 저장 계약 · 증거 본체 · consumer · 러너 설정을 한 줄로 돌렸다. DB 0 · 운영 env 0 · 유료 호출 0.')
process.exit(fail === 0 ? 0 : 1)
