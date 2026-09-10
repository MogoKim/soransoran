/**
 * 수집 **운영 판정 정본** — 🔴 순수 함수. `supply:health` 와 `wave-c:readiness` 가 **이것 하나**를 쓴다
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-10, Codex 지적).
 *
 *    같은 시점에 두 명령이 정반대를 말했다.
 *
 *      supply:health   전체 HEALTHY · navercafe 두 source RUN_OK · currentPerDay 80
 *      wave-c          remonterrace BROKEN 0/4
 *
 *    둘 다 같은 회차 기록을 읽는데 판정이 갈린 이유는 세 가지다.
 *
 *      ① `judgeRunHealth` 가 **trigger 를 보지 않았다** — 손으로 돌린 회차 하나가
 *         예약 실패를 덮었다. "누가 돌렸는지" 를 묻지 않으면 예약 증거가 아니다.
 *      ② **legacy 기록을 `RUN_OK`(HEALTHY)** 로 냈다. `bodyRows` 가 없어
 *         본문을 읽었는지 알 수 없는 회차인데 성공이라고 말한 것이다.
 *      ③ `loaded 슬롯 × 상한` 을 **`currentPerDay`** 라고 불렀다.
 *         그 이름은 "지금 실제로 나오는 양" 으로 읽힌다.
 *
 *    판정이 두 곳에 있으면 언젠가 갈린다. 그래서 **한 함수**로 모은다.
 *
 * 🔴 이 파일은 파일도 DB 도 읽지 않는다. 넘겨받은 회차 기록만 본다.
 */
import {
  collapseByRunId, isDetailSuccess, isScheduledAlive, judgeDetailHealth, judgeRunHealth,
  latestTerminal, manualPreflightOk, observedRows,
  type CollectRunRecord, type DetailHealth, type RunHealth,
} from './collect-run-record'
import { judgeSlotEvidence, judgeSlotHealth, type SlotHealth, type Slot } from './runtime-evidence'

export type OpsLevel = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'INFO'

export type SourceOperations = {
  sourceId: string
  /** 🔴 **예약** 회차만으로 판정한 liveness. 수동은 여기 들어오지 않는다 */
  scheduled: {
    health: SlotHealth
    succeeded: number
    expected: number
    elapsed: number
    matchedRunIds: readonly string[]
  }
  /** 최신 종료 회차 상태 — 🔴 legacy·manual 여부를 반영한다 */
  latestRun: RunHealth
  detail: DetailHealth
  /** 🔴 INFO 일 뿐이다. 예약 실패·미관측을 덮지 못한다 */
  manual: { ok: boolean; runId: string | null; detail: string }
  observed: { rows: number; runs: number; repeated: number; skippedSeen: number }
  /** 🔴 **설정된** 능력. `current` 가 아니다 */
  configuredPerDay: number
  /** 🔴 한 source 의 운영 등급 — 예약 실패가 수동 성공에 덮이지 않는다 */
  level: OpsLevel
  codes: string[]
  reason: string
}

/**
 * 🔴 **한 source 의 운영 사실을 한 번에 판정한다.**
 *
 *    등급 규칙은 하나다 — **예약 수집이 우선한다.**
 *    수동 preflight 가 성공해도 예약이 BROKEN 이면 그 source 는 CRITICAL 이다.
 *    관측 전(PENDING)은 실패가 아니지만 HEALTHY 도 아니다 — INFO 다.
 */
export function judgeSourceOperations(input: {
  sourceId: string
  records: readonly CollectRunRecord[]
  slots: readonly Slot[]
  /** 이 시각 이후의 회차만 증거로 쓴다 (runtime 전환 시각) */
  since: number
  now: number
  expected: number
  configuredPerDay: number
}): SourceOperations {
  const records = collapseByRunId(input.records)

  // ── 예약 liveness — 🔴 trigger === 'schedule' 만 ──
  const scheduledRuns = records
    .filter((r) => r.trigger === 'schedule' && isScheduledAlive(r))
    .map((r) => ({ runId: r.runId, at: Date.parse(r.startedAt) }))
  const slot = judgeSlotEvidence({
    runs: scheduledRuns, slots: input.slots,
    since: input.since, now: input.now, expected: input.expected,
  })
  const slotHealth = judgeSlotHealth(slot)
  const matchedRunIds = slot.matchedRunIds ?? []

  const latestRun = judgeRunHealth(records)
  const latest = latestTerminal(records)
  const detail = judgeDetailHealth(latest)
  const manual = manualPreflightOk(records)
  const observed = observedRows(records, matchedRunIds)

  /**
   * 🔴 **등급은 예약이 정한다.**
   *    수동 성공은 codes 에 남지만 등급을 올리지 못한다.
   */
  const codes: string[] = []
  let level: OpsLevel
  let reason: string

  if (slotHealth.health === 'BROKEN' || slotHealth.health === 'DEGRADED') {
    level = 'CRITICAL'
    codes.push(`SCHEDULED_${slotHealth.health}`)
    reason = `예약 수집 ${slotHealth.health} — ${slotHealth.reason}`
  } else if (slotHealth.health === 'OBSERVATION_PENDING') {
    // 🔴 아직 볼 것이 없다. 실패가 아니지만 "정상" 도 아니다
    level = 'INFO'
    codes.push('SCHEDULED_OBSERVATION_PENDING')
    reason = `예약 수집 미관측 — ${slotHealth.reason}`
  } else if (slotHealth.health === 'ACCUMULATING') {
    level = 'INFO'
    codes.push('SCHEDULED_ACCUMULATING')
    reason = `예약 수집 관찰 중 — ${slotHealth.reason}`
  } else {
    level = 'HEALTHY'
    codes.push('SCHEDULED_OK')
    reason = `예약 수집 정상 — ${slotHealth.reason}`
  }

  // 🔴 최신 회차가 실패면 그 사실을 함께 올린다 (예약이 OK 여도)
  if (latestRun.level === 'CRITICAL') {
    level = 'CRITICAL'
    codes.push(latestRun.code)
    reason = `${reason} · 최신 회차 ${latestRun.reason}`
  } else if (latestRun.level === 'WARNING' && level === 'HEALTHY') {
    level = 'WARNING'
    codes.push(latestRun.code)
  } else if (latestRun.code !== 'RUN_OK') {
    codes.push(latestRun.code)
  }

  // 🔴 상세 경로가 죽었으면 예약이 돌아도 CRITICAL 이다
  if (detail === 'BODY_EMPTY') {
    level = 'CRITICAL'
    codes.push('DETAIL_BODY_EMPTY')
    reason = `${reason} · 상세를 열었지만 본문을 읽지 못했다`
  } else if (detail === 'UNKNOWN_LEGACY') {
    // 🔴 모르는 것은 모른다 — HEALTHY 로 올리지 않는다
    codes.push('DETAIL_UNKNOWN_LEGACY')
    if (level === 'HEALTHY') level = 'INFO'
  } else if (detail === 'NO_NEW') {
    codes.push('DETAIL_NO_NEW')
  }

  // 🔴 수동은 INFO 로만 남는다. 등급을 절대 올리지 않는다
  if (manual.ok) codes.push('MANUAL_PREFLIGHT_OK')

  return {
    sourceId: input.sourceId,
    scheduled: {
      health: slotHealth.health,
      succeeded: slot.succeeded,
      expected: slot.expected,
      elapsed: slot.elapsed,
      matchedRunIds,
    },
    latestRun,
    detail,
    manual,
    observed,
    configuredPerDay: input.configuredPerDay,
    level,
    codes,
    reason,
  }
}

/**
 * 🔴 **설정 준비도와 운영 준비도를 나눈다.**
 *
 *    등록만으로 `READY` 를 내면 "job 을 올렸으니 능력이 있다" 가 된다 —
 *    그 job 이 8회 연속 죽어 있어도 READY 였다.
 */
export type OperationalReadiness = {
  /** job 이 올라와 있고 계획이 성립하는가 — 🔴 설정의 문제 */
  configuration: 'READY' | 'BLOCKED'
  /** 그 job 이 실제로 돌아 산출을 냈는가 — 🔴 운영의 문제 */
  operational: 'READY' | 'BLOCKED' | 'PENDING'
  reasons: string[]
}

export function judgeOperationalReadiness(input: {
  configurationReady: boolean
  configurationReasons: readonly string[]
  perSource: readonly SourceOperations[]
}): OperationalReadiness {
  const reasons: string[] = [...input.configurationReasons]
  const broken = input.perSource.filter((s) => s.level === 'CRITICAL')
  const pending = input.perSource.filter(
    (s) => s.scheduled.health === 'OBSERVATION_PENDING' || s.scheduled.health === 'ACCUMULATING',
  )
  for (const s of broken) reasons.push(`${s.sourceId}: ${s.reason}`)

  const operational: OperationalReadiness['operational'] = broken.length > 0
    ? 'BLOCKED'
    // 🔴 아직 관측이 없으면 READY 라고 말하지 않는다 — 모른다
    : pending.length > 0 ? 'PENDING' : 'READY'
  if (operational === 'PENDING') {
    for (const s of pending) reasons.push(`${s.sourceId}: ${s.reason}`)
  }

  return {
    configuration: input.configurationReady ? 'READY' : 'BLOCKED',
    operational,
    reasons,
  }
}
