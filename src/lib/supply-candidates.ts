/**
 * 발행 후보 준비 — 🔴 **러너 · 관제 · 예측이 부르는 단 하나의 계획 함수** (2026-09-08 · 2026-09-30 판정 교체)
 *
 * 🔴 왜 하나여야 하는가.
 *
 *    ① **같은 수를 세는 것으로는 부족하다.** 예전 판은 후보 수만 맞췄다.
 *       그런데 `prepareCandidates` 는 우선권을 넣은 최대 매칭을 쓰고,
 *       `forecastPublishing` 은 남은 후보에 `planBatch` 를 **우선권 없이 다시** 불렀다.
 *       같은 입력에서 러너는 `z-hot`, 예측은 `a-ever` 를 골랐다(재현 확인).
 *
 *    ② **나이는 흐른다.** 계획 시점(`at`)마다 다시 잰다 — 스냅숏을 넘기지 않는다.
 *
 * 🔴 **공개 가치 판정은 `judgeSlotRelease` 하나다** (2026-09-30 · source-slot-v1).
 *    옛 판정(`supply-freshness` 의 TTL 3단 · 현재성/상시 키워드 분기 · `ageDaysAt` floor 일 나이 ·
 *    **초안 시각(`sourceCapturedAt`)을 원문 나이로 쓰던 것**)을 지웠다. 이제 각 행의 원문 증거 기록
 *    (`gateResults.sourceEvidence`)을 **예정 슬롯 시각 `at`** 으로 판정한다. 모르거나 가치가 사라진 행은
 *    hold 가 아니라 **만료 예정**이다 — 사람이 살리는 칸으로 보내지 않는다(발행 트랜잭션이 EXPIRED 로 옮긴다).
 *
 * 🔴 순수 함수다. DB · 네트워크 · 시각 조회 0 — 기준 시각은 인자로 받는다.
 */

import type { VoiceProvenance, CandidateProfile } from './original-post-voice-match'
import {
  judgeSlotRelease, compareReleaseRank,
  type ReleaseReason, type SlotReleaseVerdict,
} from './source-slot-release'
import {
  planBatch,
  type BatchCaps, type BatchDraft, type BatchPlan, type PersonaForMatch,
} from './original-post-persona-match'

/**
 * 🔴 Queue 한 줄. **나이를 담지 않는다** — 원문 증거 기록(`gateResults`)을 그대로 싣고 계획 시점마다 판정한다.
 *    🔴 `sourceCapturedAt`(초안 시각)을 싣지 않는다 — 그것이 옛 결함의 입력이었다.
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
  /** 🔴 그 행에 저장된 `gateResults` — 원문 증거 기록(`sourceEvidence`)을 여기서 읽는다 */
  gateResults: unknown
  /**
   * 🔴 **이 글을 어떤 Persona 의 말투로 썼는가** (2026-09-13).
   *    자동 초안이 남긴 근거. `profile: 'machine'` 이면 반드시 있어야 한다.
   */
  voice: VoiceProvenance | null
  /**
   * 🔴 **누가 만든 후보인가 — 필수다** (2026-09-13 2차 정정).
   *    optional 로 두면 `draftOf()` 가 이 값을 옮기지 않는 것을 아무도 눈치채지 못한다(P01→P02 배정 실측).
   */
  profile: CandidateProfile
}

/** 🔴 계획에서 뺀 행 — 이유는 정본 판정의 코드 그대로다 */
export type HeldCandidate = {
  queueId: string
  hold: ReleaseReason
  /** 🔴 원천 가치가 사라진 이유면 참 — 발행 트랜잭션 · 정리 계획이 EXPIRED 로 옮길 대상이다 */
  expires: boolean
  reason: string
}

export type PreparedCandidates = {
  /** 🔴 그 시점의 자동 발행 대상 — **발행 우선순위 순서**다 */
  auto: BatchDraft[]
  /** 🔴 공개 판정을 통과하지 못한 행 — 큐에서 지운 것이 아니다 */
  held: HeldCandidate[]
  /** 우선권을 반영한 최대 매칭 */
  batch: BatchPlan
  /** 그 글에 실제로 배정된 persona 의 점수 (없으면 후보 최고 점수, 그것도 없으면 0) */
  fitScoreOf: (queueId: string) => number
  /**
   * 🔴 **최종 판정 — 배정 결과까지 넣은 `judgeSlotRelease`** (행마다 하나). 계획에서 뺀 행은 첫 판정 그대로다.
   *    stage 증거 · 관제 · 예측이 이 값을 읽는다 — 다시 계산하지 않는다.
   */
  verdicts: Map<string, SlotReleaseVerdict>
  /** 이 계획의 기준 시각(= 예정 슬롯) */
  at: Date
}

const scoreFrom = (plan: BatchPlan, id: string): number => {
  const a = plan.assignments.find((x) => x.queueId === id)
  if (a === undefined) return 0
  const chosen = a.assigned === null ? a.eligible[0] : a.eligible.find((c) => c.code === a.assigned)
  return chosen?.score.total ?? 0
}

/**
 * 🔴 **어느 시점 하루의 계획.** 러너 · 관제 · 예측이 전부 이것을 부른다.
 *
 *    ① `at`(예정 슬롯)에서 정본 판정 — 배정은 아직이다(`pending`). eligible 이 아니면 뺀다(held)
 *       🔴 hard gate 는 부르는 쪽 선택기(`selectAutoTargets`)가 이미 통과시킨 행만 온다 — 결과를 그대로 넘긴다
 *    ② 발행 순서 — **복구(기존 배정) 행 먼저**, 그다음 정본 rank 사전식 비교(`compareReleaseRank`)
 *       🔴 복구도 판정을 면제받지 않는다 — 상했으면 ①에서 이미 빠졌다
 *    ③ 그 순서를 우선권으로 넘겨 최대 매칭
 *    ④ 배정 결과까지 넣어 **같은 함수로 최종 판정**을 남긴다(배정 불가 → `NO_PERSONA_AT_SLOT`)
 *
 *    🔴 빠진 글은 매칭에 들어가지 않는다 — **persona 자리를 선점하지 못한다.**
 */
export function prepareCandidates(input: {
  candidates: readonly QueueCandidate[]
  personas: readonly PersonaForMatch[]
  caps?: BatchCaps
  /** 🔴 기준 시각 = 예정 슬롯. 러너는 지금(도래 슬롯을 지금 채운다), 예측은 그 날 */
  at: Date
  /**
   * 🔴 **발행 lane 공정성** (2026-09-28 마스터 정책) — 참이면 이번 회차에 앞세울 lane 의 행이다.
   *    판정 순서 안에서 **복구 행 → 앞세울 lane → 나머지 lane** 으로 안정 분할한다(각 묶음 안 순서 불변).
   *    🔴 주지 않으면 기존 동작 그대로다. 발행 권한(슬롯 · 상한 · 트랜잭션)은 바꾸지 않는다.
   */
  preferLane?: (queueId: string) => boolean
  /**
   * 🔴 **단계 증명일** (2026-09-29) — 참이면 앞세울 lane 이 **복구 행보다도** 먼저다.
   *    `preferLane` 이 없으면 아무 일도 하지 않는다.
   */
  laneBeforeRecovery?: boolean
}): PreparedCandidates {
  const caps = input.caps ?? {}
  const at = input.at
  const isRecovery = (c: QueueCandidate): boolean => (c.assignedPersonaCode ?? '').trim() !== ''

  // ── ① 정본 판정 — 예정 슬롯 시각으로 · 배정은 아직 ──
  const first = new Map<string, SlotReleaseVerdict>()
  for (const c of input.candidates) {
    first.set(c.queueId, judgeSlotRelease({
      gateResults: c.gateResults, slotAt: at, now: at,
      hardGates: { ok: true, codes: [] }, assignment: 'pending', tieBreak: c.queueId,
    }))
  }
  const held: HeldCandidate[] = []
  const keep: QueueCandidate[] = []
  for (const c of input.candidates) {
    const v = first.get(c.queueId)!
    if (v.verdict === 'eligible') { keep.push(c); continue }
    const code = v.reasons[0]!
    held.push({ queueId: c.queueId, hold: code, expires: v.expires, reason: v.verdict })
  }

  /**
   * 🔴 **`voice` 와 `profile` 을 반드시 옮긴다** (2026-09-13 정정) — 떨어뜨리면 matcher 가 기계 글인지조차 모른다.
   */
  const draftOf = (c: QueueCandidate): BatchDraft => ({
    queueId: c.queueId, title: c.title, body: c.body,
    gateVerdict: c.gateVerdict, createdAt: c.createdAt,
    assignedPersonaCode: c.assignedPersonaCode,
    voice: c.voice, profile: c.profile,
  })

  // ── ② 발행 순서 — 복구 먼저 · 그다음 정본 rank ──
  const byRank = [...keep].sort((a, b) => compareReleaseRank(first.get(a.queueId)!.rank, first.get(b.queueId)!.rank))
  const fresh = [...byRank.filter(isRecovery), ...byRank.filter((c) => !isRecovery(c))]
  const pref = input.preferLane
  const ordered = pref === undefined ? fresh : input.laneBeforeRecovery === true ? [
    ...fresh.filter((c) => pref(c.queueId) && isRecovery(c)),
    ...fresh.filter((c) => pref(c.queueId) && !isRecovery(c)),
    ...fresh.filter((c) => !pref(c.queueId) && isRecovery(c)),
    ...fresh.filter((c) => !pref(c.queueId) && !isRecovery(c)),
  ] : [
    ...fresh.filter((c) => isRecovery(c)),
    ...fresh.filter((c) => !isRecovery(c) && pref(c.queueId)),
    ...fresh.filter((c) => !isRecovery(c) && !pref(c.queueId)),
  ]
  const rank = new Map(ordered.map((c, i) => [c.queueId, i]))

  // ── ③ 우선권을 반영한 최대 매칭 ──
  const autoDrafts = ordered.map(draftOf)
  const batch = planBatch(autoDrafts, input.personas, caps, {
    priorityOf: (id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER,
  })

  // ── ④ 최종 판정 — 배정 결과를 넣어 같은 함수로 ──
  const verdicts = new Map<string, SlotReleaseVerdict>(first)
  for (const a of batch.assignments) {
    const c = keep.find((x) => x.queueId === a.queueId)
    if (c === undefined) continue
    const ok = a.assigned !== null && (a.recoveryProblem ?? null) === null
    verdicts.set(c.queueId, judgeSlotRelease({
      gateResults: c.gateResults, slotAt: at, now: at, hardGates: { ok: true, codes: [] },
      assignment: ok ? { ok: true } : { ok: false, route: a.deferredBy.length > 0 ? 'defer' : 'exception', codes: [] },
      tieBreak: c.queueId,
    }))
  }

  return {
    auto: autoDrafts, held, batch,
    fitScoreOf: (id) => scoreFrom(batch, id),
    verdicts, at,
  }
}

/** 사람이 읽을 한 줄 — 화면과 JSON 이 같은 값을 쓴다 */
export function describePrepared(p: PreparedCandidates): string {
  const by = new Map<string, number>()
  for (const h of p.held) by.set(h.hold, (by.get(h.hold) ?? 0) + 1)
  const parts = [...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`)
  return `슬롯 판정(source-slot-v1) eligible ${p.auto.length}건 · 제외 ${p.held.length}건`
    + (parts.length === 0 ? '' : ` (${parts.join(' · ')})`)
    + ' — 🔴 제외 행은 사람이 살리는 칸이 아니다(원천 가치 없음 → 만료 예정)'
}
