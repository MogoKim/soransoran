/**
 * 발행 후보 준비 — 🔴 **러너 · 관제 · 예측 · 준비도가 부르는 단 하나의 계획 함수** (2026-09-08)
 *
 * 🔴 왜 하나여야 하는가.
 *
 *    ① **같은 수를 세는 것으로는 부족하다.** 예전 판은 후보 수만 맞췄다.
 *       그런데 `prepareCandidates` 는 우선권을 넣은 최대 매칭을 쓰고,
 *       `forecastPublishing` 은 남은 후보에 `planBatch` 를 **우선권 없이 다시** 불렀다.
 *       같은 입력에서 러너는 `z-hot`, 예측은 `a-ever` 를 골랐다(재현 확인).
 *       화면이 "내일 이 글이 이 사람으로 나갑니다" 라고 적고 실제로는 다른 글이 나간다.
 *
 *    ② **나이는 흐른다.** 예전 판은 `ageDays` 스냅숏을 예측에 그대로 넘겼다.
 *       그래서 오늘 2일짜리 timely 후보 14건이 14일 뒤에도 2일로 남아 전부 발행됐다.
 *       실제 러너는 매일 나이를 다시 재므로 7일을 넘긴 것은 hold 된다.
 *
 *    그래서 이 파일은 **"어느 시점의 하루" 를 계획하는 함수** 하나를 내보내고,
 *    러너는 지금으로, 예측은 미래 날짜마다 그것을 부른다.
 *
 * 🔴 순수 함수다. DB · 네트워크 · 시각 조회 0 — 기준 시각은 인자로 받는다.
 */

import type { VoiceProvenance, CandidateProfile } from './original-post-voice-match'
import {
  judgeCandidate, orderForPublish,
  type FreshCandidate, type FreshVerdict, type HoldReason,
} from './supply-freshness'
import {
  planBatch,
  type BatchCaps, type BatchDraft, type BatchPlan, type PersonaForMatch,
} from './original-post-persona-match'

const DAY_MS = 86_400_000

/**
 * 🔴 Queue 한 줄. **`ageDays` 를 담지 않는다** — 나이는 계획 시점마다 다시 잰다.
 *    `capturedAt` 은 원문 **관측 시각 proxy** 다(게시 시각이 아니다 — MASTER §4.1).
 */
export type QueueCandidate = {
  queueId: string
  title: string
  body: string
  gateVerdict: string
  /** 줄 순서 기준값 (오래된 것이 작다) */
  createdAt: number
  /** 🔴 이미 배정된 persona 코드. 없으면 null — **null 을 박아 넘기지 않는다** */
  assignedPersonaCode: string | null
  /** 🔴 원문 관측 시각. 모르면 null → 그 시점에 `AGE_UNKNOWN` 으로 hold */
  capturedAt: Date | null
  /**
   * 🔴 **이 글을 어떤 Persona 의 말투로 썼는가** (2026-09-13).
   *    자동 초안이 남긴 근거. `profile: 'machine'` 이면 반드시 있어야 한다.
   */
  voice: VoiceProvenance | null
  /**
   * 🔴 **누가 만든 후보인가 — 필수다** (2026-09-13 2차 정정).
   *
   *    optional 로 두고 `?? 'human'` 으로 떨어뜨렸더니, `draftOf()` 가 이 값을
   *    옮기지 않는 것을 아무도 눈치채지 못했다 — 기계 후보가 사람 후보처럼 통과했고
   *    **P01 이 쓴 글이 P02 이름으로 배정됐다**(실측).
   *    타입을 필수로 두면 새 호출부가 생길 때 컴파일러가 묻는다.
   */
  profile: CandidateProfile
}

/** 🔴 그 시점의 나이 (일). 모르면 null */
export function ageDaysAt(capturedAt: Date | null, at: Date): number | null {
  if (capturedAt === null) return null
  return Math.floor((at.getTime() - capturedAt.getTime()) / DAY_MS)
}

export type HeldCandidate = {
  queueId: string
  hold: HoldReason
  reason: string
}

export type PreparedCandidates = {
  /** 🔴 그 시점의 자동 발행 대상 — **발행 우선순위 순서**다 */
  auto: BatchDraft[]
  /** 🔴 사람이 봐야 하는 것. 큐에서 지운 것이 아니다 */
  held: HeldCandidate[]
  /** 우선권을 반영한 최대 매칭 */
  batch: BatchPlan
  /** 그 글에 실제로 배정된 persona 의 점수 (없으면 후보 최고 점수, 그것도 없으면 0) */
  fitScoreOf: (queueId: string) => number
  verdicts: Map<string, FreshVerdict>
  /** 이 계획의 기준 시각 */
  at: Date
}

/** 🔴 발행 우선순위 계층 — 낮을수록 먼저 */
export function priorityTierOf(v: FreshVerdict, isRecovery: boolean): number {
  if (isRecovery) return 0
  if (v.topic === 'timely') return v.freshness === 'hot' ? 1 : 2
  return 3
}

const scoreFrom = (plan: BatchPlan, id: string): number => {
  const a = plan.assignments.find((x) => x.queueId === id)
  if (a === undefined) return 0
  const chosen = a.assigned === null ? a.eligible[0] : a.eligible.find((c) => c.code === a.assigned)
  return chosen?.score.total ?? 0
}

/**
 * 🔴 **어느 시점 하루의 계획.** 러너·관제·예측·준비도가 전부 이것을 부른다.
 *
 *    ① `at` 시점의 나이로 freshness 를 판정한다 → `expired` · `unknown` · **상한 복구**를 뺀다(hold)
 *    ② 남은 것으로 한 번 매칭해 **실제 배정 점수**를 얻는다 (상시 순서의 근거)
 *    ③ 그 점수로 발행 순서를 정한다 — 복구 → 현재성 hot → warm → 상시(적합도)
 *    ④ **그 순서를 우선권으로 넘겨** 다시 매칭한다.
 *       `maxMatch` 는 증가 경로라 총 배정 수는 그대로고, 자리 경쟁에서 신선한 글이 이긴다
 *
 *    🔴 hold 된 글은 ②④ 어디에도 들어가지 않는다 — **persona 자리를 선점하지 못한다.**
 */
export function prepareCandidates(input: {
  candidates: readonly QueueCandidate[]
  personas: readonly PersonaForMatch[]
  caps?: BatchCaps
  /** 🔴 기준 시각. 러너는 지금, 예측은 그 날 */
  at: Date
  /**
   * 🔴 **발행 lane 공정성** (2026-09-28 마스터 정책) — 참이면 이번 회차에 앞세울 lane 의 행이다.
   *    신선도 순서 안에서 **복구 행 → 앞세울 lane → 나머지 lane** 으로 안정 분할한다(각 묶음 안 순서 불변).
   *    배정 우선권(`priorityOf`)도 이 순서라 앞세운 lane 이 Persona 자리를 먼저 얻는다.
   *    🔴 주지 않으면 기존 동작 그대로다. 발행 권한(슬롯 · 상한 · 트랜잭션)은 바꾸지 않는다.
   */
  preferLane?: (queueId: string) => boolean
  /**
   * 🔴 **단계 증명일** (2026-09-29) — 참이면 앞세울 lane 이 **복구 행보다도** 먼저다:
   *    앞세울 lane(복구 → 나머지) → 다른 lane(복구 → 나머지). 각 묶음 안 순서 불변.
   *    `preferLane` 이 없으면 아무 일도 하지 않는다.
   */
  laneBeforeRecovery?: boolean
}): PreparedCandidates {
  const caps = input.caps ?? {}
  const at = input.at

  // ── ① freshness — **그 시점의 나이로** ──
  const isRecovery = (c: QueueCandidate): boolean => (c.assignedPersonaCode ?? '').trim() !== ''
  const verdicts = new Map<string, FreshVerdict>()
  for (const c of input.candidates) {
    verdicts.set(c.queueId, judgeCandidate({
      queueId: c.queueId, title: c.title, body: c.body,
      ageDays: ageDaysAt(c.capturedAt, at),
      isRecovery: isRecovery(c), seq: 0,
    }))
  }

  const held: HeldCandidate[] = []
  const keep: QueueCandidate[] = []
  for (const c of input.candidates) {
    const v = verdicts.get(c.queueId)!
    if (v.autoPublishable) keep.push(c)
    else held.push({ queueId: c.queueId, hold: v.hold!, reason: v.reason })
  }

  /**
   * 🔴 **`voice` 와 `profile` 을 반드시 옮긴다** (2026-09-13 정정).
   *    여기서 떨어뜨리면 matcher 는 그 글이 기계 글인지조차 모른다 —
   *    실제로 그랬고, P01 이 쓴 글이 P02 이름으로 배정됐다.
   */
  const draftOf = (c: QueueCandidate): BatchDraft => ({
    queueId: c.queueId, title: c.title, body: c.body,
    gateVerdict: c.gateVerdict, createdAt: c.createdAt,
    assignedPersonaCode: c.assignedPersonaCode,
    voice: c.voice, profile: c.profile,
  })

  // ── ② 1차 매칭 — 상시 순서의 근거가 되는 점수 ──
  const probe = planBatch(keep.map(draftOf), input.personas, caps)

  // ── ③ 발행 순서 ──
  const withFit: FreshCandidate[] = keep.map((c, i) => ({
    queueId: c.queueId, title: c.title, body: c.body,
    ageDays: ageDaysAt(c.capturedAt, at),
    isRecovery: isRecovery(c),
    fitScore: scoreFrom(probe, c.queueId),
    seq: i,
  }))
  const fresh = orderForPublish(withFit).ordered
  const pref = input.preferLane
  const ordered = pref === undefined ? fresh : input.laneBeforeRecovery === true ? [
    ...fresh.filter((c) => pref(c.queueId) && c.isRecovery),
    ...fresh.filter((c) => pref(c.queueId) && !c.isRecovery),
    ...fresh.filter((c) => !pref(c.queueId) && c.isRecovery),
    ...fresh.filter((c) => !pref(c.queueId) && !c.isRecovery),
  ] : [
    ...fresh.filter((c) => c.isRecovery),
    ...fresh.filter((c) => !c.isRecovery && pref(c.queueId)),
    ...fresh.filter((c) => !c.isRecovery && !pref(c.queueId)),
  ]
  const rank = new Map(ordered.map((c, i) => [c.queueId, i]))

  // ── ④ 우선권을 반영한 최대 매칭 ──
  const autoDrafts = [...keep]
    .sort((a, b) => (rank.get(a.queueId) ?? 0) - (rank.get(b.queueId) ?? 0))
    .map(draftOf)
  const batch = planBatch(autoDrafts, input.personas, caps, {
    priorityOf: (id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER,
  })

  return {
    auto: autoDrafts, held, batch,
    fitScoreOf: (id) => scoreFrom(batch, id),
    verdicts, at,
  }
}

/** 사람이 읽을 한 줄 — 화면과 JSON 이 같은 값을 쓴다 */
export function describePrepared(p: PreparedCandidates): string {
  const n = (r: HoldReason): number => p.held.filter((h) => h.hold === r).length
  return `자동 대상 ${p.auto.length}건 · 사람 검수 ${p.held.length}건`
    + ` (TTL ${n('TTL_EXPIRED')} · 시각미상 ${n('AGE_UNKNOWN')} · 상한 복구 ${n('RECOVERY_STALE')} — 삭제 아님)`
}
