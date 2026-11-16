/**
 * 🔴 **controller 한 슬롯의 recovery 단계 실행 — 시간·IO를 주입받는 유일한 실행부** (2026-11-05)
 *
 * 운영 스크립트(`scripts/stage-controller.mts`)는 진짜 시계·실제 DB·실제 intent 경로만 넘긴다.
 * 시험은 같은 함수에 고정 시계·임시 home·결정 IO spy를 넘겨 07:00→07:20→07:40→07:55 순서를 그대로 돌린다.
 * 운영 스크립트에 시각을 바꾸는 플래그를 두지 않는다(다른 날짜 결정을 쓰는 수동 통로가 된다).
 *
 * 이 함수 밖에 남는 것: 공급 lease 판정 · DB 연결 · 전날 결정/증거/preflight 계산(`compute`).
 * 이 함수가 소유하는 것: 기존 결정 읽기(있으면 읽기만) · recovery 판독 · `activeRecoveryDirective` 실행 ·
 * create-only 저장(`ensureStageDecision`).
 */
import type { ControllerResult } from '../../src/lib/stage-controller'
import {
  activeRecoveryDirective, retryFinalStageDecisionWrite,
  type ActiveRecoveryArtifact, type ActiveRecoveryDirective, type ActiveRecoveryPhase, type ActiveRecoveryPlan,
} from '../../src/lib/stage-active-recovery'
import { ensureStageDecision } from '../../src/lib/stage-decision-store'
import { DECISION_WRITER } from '../../src/lib/stage-decision-contract'
import type { RuntimeStage } from '../../src/lib/scale-profile'
import {
  claimStageRecoveryLaunch, createStageRecoveryIntent, readStageRecoveryArtifact,
  readStageRecoverySupplyReceipt, readStageRecoverySupplyStartClaim,
  stageRecoveryIntentCoversPlan, updateStageRecoveryIntent,
  type StageRecoveryArtifactRead, type StageRecoveryIntent,
} from './stage-recovery-intent.mjs'
import { readStageRecoverySourceReceipt } from './stage-recovery-source-receipt.mjs'
import { NO_RECOVERY_CLAIM, type StagePreflightRecoveryInput } from './stage-preflight-facts.mjs'

/**
 * `compute`가 preflight에 넣을 recovery 사실.
 *  · `none`     — 오늘 recovery 산출물이 없다
 *  · `unknown`  — 산출물이 손상됐다 → 비용 신원 모름(SUPPLY_COST_UNKNOWN) · 성과 0
 *  · `evaluate` — 정상 intent. `final`일 때만 lineage·exact 성과·exact 비용을 넣는다
 */
export type StageRecoveryFactsMode =
  | { kind: 'none' }
  | { kind: 'unknown'; reason: string }
  | { kind: 'evaluate'; intent: StageRecoveryIntent; final: boolean }

export type StageRecoveryComputed =
  | { kind: 'stop'; exitCode: number }
  | {
      kind: 'computed'
      result: ControllerResult
      plan: ActiveRecoveryPlan
      valid: { ok: true } | { ok: false; reason: string }
    }

type EnsureIo = Parameters<typeof ensureStageDecision>[0]

export type StageRecoveryStepDeps = {
  phase: ActiveRecoveryPhase
  kstDate: string
  /** intent 전이에 찍는 시각 */
  clock: () => Date
  /** recovery 산출물 home — 운영은 생략(현재 계정) */
  home?: string
  writeMode: 'apply' | 'dry-run' | 'flag-off'
  io: Pick<EnsureIo, 'read' | 'insert' | 'validate'>
  compute: (mode: StageRecoveryFactsMode) => Promise<StageRecoveryComputed>
  launch: (intent: StageRecoveryIntent) => Promise<boolean>
  log: (s: string) => void
  error: (s: string) => void
  /** 최종 저장 재시도 사이 대기 */
  wait?: (ms: number) => Promise<void>
}

export type StageRecoveryStepOutcome = {
  exitCode: number
  action: 'read-existing' | 'stopped' | 'invalid' | 'dry-run' | 'flag-off' | 'decided' | 'write-failed'
    | 'start-recovery' | 'wait-final' | 'cancel-and-wait-final'
  directive: ActiveRecoveryDirective['kind'] | null
  /** 이 슬롯이 StageDecision 행을 새로 만들었는가 */
  created: boolean
}

/**
 * recovery 사실 → preflight 입력(`StagePreflightRecoveryInput`).
 *  · 중간 슬롯: 시작 claim 회차로 장부 정합만 본다 — 비용 cohort·lineage 0(진행 중 미정산으로 자기 복구를 취소하지 않는다)
 *  · final 슬롯: 성공·실패 무관 시작 claim 회차를 비용 cohort에 넣는다. lineage는 intent done · 대상 일치 ·
 *    완주/원천 영수증이 claim 회차와 시간순으로 맞을 때만. 영수증 회차가 claim과 다르면 신원 불명이다.
 */
export function recoveryPreflightInputOf(
  mode: StageRecoveryFactsMode, target: RuntimeStage, now: Date, home?: string,
): StagePreflightRecoveryInput {
  if (mode.kind === 'none') return NO_RECOVERY_CLAIM
  if (mode.kind === 'unknown') return { kind: 'unknown', reason: mode.reason }
  const intent = mode.intent
  const start = readStageRecoverySupplyStartClaim(intent, home)
  if (start.kind === 'corrupt') return { kind: 'unknown', reason: start.reason }
  const claimRunId = start.kind === 'valid' ? start.claim.supplyRunId : null
  if (!mode.final) return { kind: 'known', claimRunId, includeCost: false }
  if (intent.state !== 'done' || intent.target !== target) return { kind: 'known', claimRunId, includeCost: true }
  const supplyReceipt = readStageRecoverySupplyReceipt(
    { kstDate: intent.kstDate, nonce: intent.nonce, deficit: intent.deficit }, home,
  )
  const sourceReceipt = readStageRecoverySourceReceipt(intent.kstDate, intent.nonce, home)
  if (supplyReceipt === null || sourceReceipt === null) return { kind: 'known', claimRunId, includeCost: true }
  if (supplyReceipt.supplyRunId !== claimRunId) {
    return { kind: 'unknown', reason: `완주 영수증 회차 ${supplyReceipt.supplyRunId} ≠ 시작 claim 회차 ${claimRunId ?? '없음'}` }
  }
  const createdAt = Date.parse(intent.createdAt)
  const receiptAt = Date.parse(sourceReceipt.writtenAt)
  const completedAt = Date.parse(supplyReceipt.completedAt)
  const inOrder = Number.isFinite(createdAt) && Number.isFinite(receiptAt) && Number.isFinite(completedAt)
    && receiptAt >= createdAt && receiptAt <= now.getTime()
    && completedAt >= createdAt && completedAt <= now.getTime()
  if (!inOrder) return { kind: 'known', claimRunId, includeCost: true }
  return {
    kind: 'known', claimRunId, includeCost: true,
    lineage: { sourceHashes: new Set(sourceReceipt.sourceHashes), createdAt: new Date(createdAt) },
  }
}

export function recoveryArtifactOf(read: StageRecoveryArtifactRead): ActiveRecoveryArtifact {
  if (read.kind === 'valid') return { kind: 'valid', state: read.intent.state }
  return read
}

function factsModeOf(read: StageRecoveryArtifactRead, final: boolean): StageRecoveryFactsMode {
  if (read.kind === 'absent') return { kind: 'none' }
  if (read.kind === 'corrupt') return { kind: 'unknown', reason: read.reason }
  return { kind: 'evaluate', intent: read.intent, final }
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export async function runStageRecoveryStep(d: StageRecoveryStepDeps): Promise<StageRecoveryStepOutcome> {
  const outcome = (
    exitCode: number, action: StageRecoveryStepOutcome['action'],
    directive: ActiveRecoveryDirective['kind'] | null = null, created = false,
  ): StageRecoveryStepOutcome => ({ exitCode, action, directive, created })

  // ① 오늘 결정이 이미 있으면 읽기만 한다 — 계산·recovery 전이·저장 0 (create-only)
  if (d.writeMode === 'apply') {
    let existing: unknown
    try { existing = await d.io.read() } catch (e) {
      d.error(`🔴 오늘 결정을 읽지 못했다 — ${message(e)}. 아무것도 쓰지 않았다`)
      return outcome(1, 'write-failed')
    }
    if (existing !== null && existing !== undefined) {
      const v = d.io.validate(existing)
      if (!v.ok) {
        d.error(`🔴 오늘 결정 행이 계약을 지키지 않는다 — ${v.reason}. 덮지 않는다`)
        return outcome(1, 'read-existing')
      }
      d.log(`\n   🟢 이미 있어 읽었다(덮지 않는다) — ${v.decision.state} · 공개 ${v.decision.release} · 준비 ${v.decision.capacity} · 계산·recovery 변경 0\n`)
      return outcome(0, 'read-existing')
    }
  }

  const final = d.phase === 'final'
  let read = readStageRecoveryArtifact(d.kstDate, d.home)
  if (read.kind === 'corrupt') d.error(`🔴 오늘 recovery 산출물이 손상됐다 — ${read.reason}. 중간 결정 0 · final은 비용 신원 모름으로 판정`)

  // ② final: 남은 active intent를 먼저 닫는다(07:50 provider 마감 뒤). 닫기 실패가 오늘의 유일한 결정을 막지 않는다
  if (final) {
    const pre = activeRecoveryDirective({ phase: 'final', artifact: recoveryArtifactOf(read) })
    if (pre.kind === 'finalize' && pre.closeActive && d.writeMode === 'apply' && read.kind === 'valid') {
      try {
        updateStageRecoveryIntent({
          intent: read.intent, state: 'failed', now: d.clock(), home: d.home,
          message: '07:55 최종 판정 마감 — 추가 공급 종료',
        })
      } catch (e) {
        d.error(`🔴 최종 판정 전 제한 복구 상태를 닫지 못했다 — ${message(e)} · 07:50 provider 마감은 이미 닫혔다`)
      }
      read = readStageRecoveryArtifact(d.kstDate, d.home)
    }
  }

  const computed = await d.compute(factsModeOf(read, final))
  if (computed.kind === 'stop') return outcome(computed.exitCode, 'stopped')
  if (!computed.valid.ok) {
    d.error(`🔴 계산한 결정이 계약을 지키지 않는다 — 저장하지 않는다: ${computed.valid.reason}`)
    return outcome(1, 'invalid')
  }
  const directive = final
    ? activeRecoveryDirective({ phase: 'final', artifact: recoveryArtifactOf(read) })
    : activeRecoveryDirective({ phase: 'intermediate', artifact: recoveryArtifactOf(read), plan: computed.plan })

  if (d.writeMode === 'dry-run') {
    d.log(`\n🔴 dry-run — recovery 지시 ${directive.kind} · DB write 0 · recovery 변경 0. 저장은 --apply + 정본 env 의 flag on 일 때만\n`)
    return outcome(0, 'dry-run', directive.kind)
  }
  if (d.writeMode === 'flag-off') {
    d.log('\n🔴 controller flag 가 on 이 아니다 — 저장하지 않는다 (consumer 는 옛 env/canary 단계로 돌아가지 않고 가장 안전한 d1 로 감속한다)\n')
    return outcome(0, 'flag-off', directive.kind)
  }

  const write = async (retry: boolean): Promise<StageRecoveryStepOutcome> => {
    const once = (): ReturnType<typeof ensureStageDecision> => ensureStageDecision({
      read: d.io.read, insert: d.io.insert, validate: d.io.validate,
      compute: () => computed.result.decision, by: DECISION_WRITER,
    })
    let out: Awaited<ReturnType<typeof ensureStageDecision>>
    try {
      out = retry ? await retryFinalStageDecisionWrite(once, d.wait) : await once()
    } catch (e) {
      d.error(`🔴 저장 경로에 닿지 못했다 — ${e instanceof Error ? e.name : 'Error'}. 아무것도 쓰지 않았다`)
      return outcome(1, 'write-failed', directive.kind)
    }
    if (!out.ok) {
      d.error(`🔴 저장 실패 ${out.code} — ${out.reason}`)
      return outcome(1, 'write-failed', directive.kind)
    }
    d.log(`\n   ${out.created ? '🟢 저장했다' : '🟢 이미 있어 읽었다(덮지 않는다)'} — ${out.decision.state} · 공개 ${out.decision.release} · 준비 ${out.decision.capacity}\n`)
    return outcome(0, 'decided', directive.kind, out.created)
  }

  switch (directive.kind) {
    case 'finalize':
      return write(true)
    case 'decide-now':
      return write(false)
    case 'wait-final':
      d.log(`\n🟡 오늘 recovery ${read.kind === 'valid' ? `intent ${read.intent.state}` : read.kind} — 중간 StageDecision write 0`)
      d.log('   07:55 최종 예약이 같은 정본으로 한 번 결정한다\n')
      return outcome(0, 'wait-final', directive.kind)
    case 'cancel-and-wait-final': {
      if (read.kind !== 'valid') return outcome(1, 'cancel-and-wait-final', directive.kind)
      const reason = computed.plan.kind === 'none' ? computed.plan.reason : '중대 결함'
      try {
        updateStageRecoveryIntent({
          intent: read.intent, state: 'failed', now: d.clock(), home: d.home, message: `복구 중 새 중대 차단: ${reason}`,
        })
      } catch (e) {
        d.error(`🔴 제한 복구를 취소하지 못했다 — ${message(e)}. StageDecision write 0 · 다음 예약이 다시 판정한다`)
        return outcome(1, 'cancel-and-wait-final', directive.kind)
      }
      d.log(`\n🟡 복구 중 중대 차단(${reason}) — intent failed · 중간 StageDecision write 0 · 07:55 최종 판정\n`)
      return outcome(0, 'cancel-and-wait-final', directive.kind)
    }
    case 'start-recovery': {
      const plan = computed.plan
      if (plan.kind !== 'recover') return outcome(1, 'start-recovery', directive.kind)
      let intent = read.kind === 'valid' ? read.intent
        : createStageRecoveryIntent({ kstDate: d.kstDate, plan, now: d.clock(), home: d.home }).intent
      if (!stageRecoveryIntentCoversPlan(intent, plan)) {
        d.log('\n🟡 오늘 제한 복구 intent보다 부족분이 커졌거나 대상이 달라졌다 — 두 번째 복구 0 · 중간 StageDecision write 0')
        d.log('   07:55 최종 예약이 같은 정본으로 한 번 결정한다\n')
        return outcome(0, 'start-recovery', directive.kind)
      }
      if (intent.state === 'requested') {
        const launch = claimStageRecoveryLaunch({ intent, now: d.clock(), message: plan.reason, home: d.home })
        intent = launch.intent
        if (launch.claimed) {
          if (!await d.launch(intent)) {
            updateStageRecoveryIntent({ intent, state: 'failed', now: d.clock(), message: 'worker 시작 실패', home: d.home })
            d.error('🔴 제한 복구 worker를 시작하지 못했다 — intent failed · 중간 StageDecision write 0 · 07:55 최종 판정')
            return outcome(1, 'start-recovery', directive.kind)
          }
          d.log(`\n🟡 ${plan.reason} — 제한 수집 ${intent.collectMax}건 · 공급 묶음 ${intent.worksetLimit}을 한 번 시작했다`)
        } else {
          d.log('\n🟡 오늘 제한 복구 실행권은 이미 다른 controller가 가져갔다 — 두 번째 worker 0')
        }
      } else {
        d.log(`\n🟡 오늘 제한 복구 intent ${intent.state} — 두 번째 복구를 만들지 않는다`)
      }
      d.log('   StageDecision write 0 · 07:55에 같은 정본으로 최종 재판정한다\n')
      return outcome(0, 'start-recovery', directive.kind)
    }
  }
}
