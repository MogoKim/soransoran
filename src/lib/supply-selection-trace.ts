/**
 * 🔴 **공급 선택 관측 trace** (2026-10-10 P0-B0) — 순수 함수 · DB · 네트워크 · provider 0
 *
 *   공급 한 회차에서 원천 하나하나가 **어느 단계에서 왜** 골라지거나 빠졌는지를 남긴다.
 *     생성 가능 판정(`worksetEligibility`) → 슬롯 짝짓기(`assignSourceSlots` · EDF) → 묶음 선택(`selectWorkset`:
 *     축 자리 · 재시도 예약석 · 순위) → 최종 묶음
 *   기록은 각 함수에 넘긴 기록기(`WorksetTraceSink`)가 모은다. 이 파일은 모은 것을 **읽기만** 해서 조립한다.
 *
 * 🔴 **선택을 바꾸지 않는다.** 이 파일은 `assignSourceSlots` · `selectWorkset` 의 반환값을 받지 않고 고치지 않는다.
 *    shadow(정본 순위의 갱년기 · wgang 동률 선호)는 **세기만** 한다 — 실제 선택에 적용하지 않는다.
 * 🔴 **원문 없음.** 제목 · 본문 · 작성자 · URL · 원문 id 평문을 싣지 않는다 — `sha256(site::id)`(`articleIdHashOf`)와
 *    정본 원천 이름 · 숫자 · enum 만 남는다. 읽는 쪽(`readSupplySelectionTrace`)은 정해진 칸 밖의 칸을 거부한다.
 * 🔴 **동등 품질을 새로 정의하지 않는다.** 공급 품질은 지금 공급 코드가 쓰는 값(`commentsPct` · `viewsPct`) 그대로,
 *    신선도 구간은 정본 `observationBucketOf` 그대로다. 둘 중 하나라도 없으면 그 후보의 shadow 는 UNKNOWN 이다.
 */
import { createHash } from 'node:crypto'

import type { SourceId } from './collect-schedule'
import { mentionsMenopause } from './original-post-persona-match'
import {
  articleIdHashOf, compareReleaseRank, observationBucketOf, type SlotReleaseVerdict,
} from './source-slot-release'
import {
  retryTierOf, runClockOf, sourceIdentityOf, worksetAxisOf, WORKSET_SELECT_STEPS, WORKSET_VERSION_JIT,
  type PriorOutcome, type Workset, type WorksetDrop, type WorksetRow, type WorksetSelectStep, type WorksetTraceSink,
} from './supply-workset'

export const SELECTION_TRACE_KIND = 'supply-selection-trace'
export const SELECTION_TRACE_VERSION = 'selection-trace-v1'
/** 🔴 회차 파일 이름 — `supply-workset-` · `supply-opportunities-` 를 집는 다른 읽기 경로와 겹치지 않는다 */
export const selectionTraceFileName = (runId: string): string => `supply-selection-trace-${runId}.json`

/** 🔴 정본 원천 이름 — 수집 일정(`SourceId`)과 같은 글자다. 새 원천 판정을 만들지 않는다 */
const WGANG_SOURCE: SourceId = 'navercafe:wgang'
const HOUR_MS = 3_600_000

/**
 * 🔴 **슬롯 짝짓기 단계 결과.**
 *    `NOT_REACHED`     생성 가능 판정에서 이미 빠졌다
 *    `NOT_APPLICABLE`  JIT 묶음이 아니다(배정 없이 고른 옛 판)
 *    `ASSIGNED`        부족 슬롯 하나에 배정됐다
 *    `UNLINKABLE`      부족 슬롯 어디에서도 eligible 이 아니다
 *    `NOT_MATCHED`     연결 가능한 슬롯이 있었지만 짝(EDF)에 들지 못했다
 *    `CAP_CUT`         짝에 들었지만 유료 상한(cap)에 잘렸다
 */
export const TRACE_EDF_STAGES = ['NOT_REACHED', 'NOT_APPLICABLE', 'ASSIGNED', 'UNLINKABLE', 'NOT_MATCHED', 'CAP_CUT'] as const
export type TraceEdfStage = (typeof TRACE_EDF_STAGES)[number]

/** 🔴 **최종 사유 하나** — 처음 멈춘 단계의 원인. 다른 원인을 한 값으로 합치지 않는다 */
export const TRACE_REASONS = [
  'HUMAN_DECIDED', 'QUEUE_SIBLING', 'ALREADY_QUEUED', 'CARRIED_OVER', 'TERMINAL', 'HARD_BLOCKED', 'PRE_GATED',
  'SLOT_INELIGIBLE', 'EVIDENCE_UNKNOWN',
  'SLOT_UNLINKABLE', 'EDF_NOT_MATCHED', 'EDF_CAP_CUT',
  'AXIS_QUOTA_ZERO', 'AXIS_QUOTA_FULL',
  'FRESH_DISPLACED_BY_RETRY_RESERVE', 'FRESH_RANK_CUT', 'RETRY_LIMIT_CUT',
  'SELECTED_FRESH', 'SELECTED_RETRY_RESERVED', 'SELECTED_RETRY_FILLED',
  /** 🔴 기록끼리 맞지 않는다(배정 없이 골랐다 · 단계 기록 없음 · 같은 원천 두 번) — 정상 결과로 세지 않는다 */
  'TRACE_MISMATCH',
] as const
export type TraceReason = (typeof TRACE_REASONS)[number]

const DROP_REASON: Readonly<Record<Exclude<WorksetDrop, 'identityMissing' | 'slotUnassigned'>, TraceReason>> = {
  humanDecided: 'HUMAN_DECIDED', queueSibling: 'QUEUE_SIBLING', alreadyQueued: 'ALREADY_QUEUED',
  carriedOver: 'CARRIED_OVER', terminal: 'TERMINAL', hardBlocked: 'HARD_BLOCKED', preGated: 'PRE_GATED',
  slotIneligible: 'SLOT_INELIGIBLE', slotUnknown: 'EVIDENCE_UNKNOWN',
}
const STEP_REASON: Readonly<Record<Exclude<WorksetSelectStep, 'SLOT_UNASSIGNED'>, TraceReason>> = {
  AXIS_QUOTA_ZERO: 'AXIS_QUOTA_ZERO', AXIS_QUOTA_FULL: 'AXIS_QUOTA_FULL',
  RETRY_RESERVED: 'SELECTED_RETRY_RESERVED', RETRY_FILLED: 'SELECTED_RETRY_FILLED', RETRY_LIMIT_CUT: 'RETRY_LIMIT_CUT',
  FRESH_PICKED: 'SELECTED_FRESH', FRESH_DISPLACED_BY_RETRY_RESERVE: 'FRESH_DISPLACED_BY_RETRY_RESERVE',
  FRESH_RANK_CUT: 'FRESH_RANK_CUT',
}
const EDF_REASON: Readonly<Record<'UNLINKABLE' | 'NOT_MATCHED' | 'CAP_CUT', TraceReason>> = {
  UNLINKABLE: 'SLOT_UNLINKABLE', NOT_MATCHED: 'EDF_NOT_MATCHED', CAP_CUT: 'EDF_CAP_CUT',
}

/** 🔴 지금 공급 순위(`compareReleaseRank`)가 실제로 쓰는 성분 그대로 — 새 점수가 아니다 */
export type TraceRank = { commentsPct: number | null; viewsPct: number | null; ageAtSlotH: number | null; velocity: number | null }

export type TraceCandidate = {
  /** `sha256("<site>::<articleId>")` — 원문 id 평문 없음 */
  sourceHash: string
  /** 정본 원천 이름(`navercafe:wgang` …) */
  source: string
  axis: 'seed' | 'raw'
  retry: boolean
  /** `retryTierOf` — 재시도가 아니면 null */
  retryTier: number | null
  /** 마지막 결과 회차 시각(`runClockOf`)부터 이번 회차까지 — 재시도가 아니면 null */
  retryWaitedH: number | null
  /** 🔴 부족 슬롯마다 그 슬롯에서 eligible 이면 그 시점 원문 나이(h), 아니면 null. 슬롯 판정까지 안 갔으면 null */
  slotAgesH: (number | null)[] | null
  /** 마지막으로 eligible 인 부족 슬롯 번호(EDF 마감) — 없으면 null */
  lastValidSlot: number | null
  assignedSlot: number | null
  edfRound: number | null
  edf: TraceEdfStage
  selectStep: WorksetSelectStep | null
  /** 🔴 지금 비교기가 받은 값 그대로 — `ageAtSlotH` 는 정본 판정이 0.001h 로 반올림한 값이다(기존 동작) */
  rank: TraceRank | null
  /** 🔴 판정 슬롯에서의 **원래** 원문 나이(h · 반올림 없음) — 신선도 구간 · EDF 나이 비교는 이 값으로 한다 */
  sourceAgeH: number | null
  /** 정본 관측 나이 구간(`observationBucketOf(sourceAgeH)`) — 나이를 모르면 null */
  freshnessBand: string | null
  selected: boolean
  /** 최종 묶음 안 순서(0부터) — 고르지 않았으면 null */
  position: number | null
  reason: TraceReason
  menopauseCore: boolean
  wgangSource: boolean
}

type Count = { candidates: number; selected: number }
export type TraceSummary = {
  /** 사이트나 id 를 몰라 열쇠가 없는 행 — 후보 기록에 들어가지 못한다 */
  identityMissing: number
  candidates: number
  selected: number
  fresh: Count
  retry: Count
  menopauseCore: Count
  wgang: Count
  menopauseWgang: Count
  byReason: Record<TraceReason, number>
  menopauseByReason: Record<TraceReason, number>
  wgangByReason: Record<TraceReason, number>
  /** 🔴 배정된 원천 중, 같은 슬롯에 연결 가능했는데 짝에 못 든 **더 어린** 원천이 있는 수 */
  edfOlderOverFresher: number
  freshDisplacedByRetryReserve: number
  axisQuotaDropped: number
  mismatches: number
}

export type ShadowVerdict = 'COMPUTED' | 'NO_STRICT_TIE' | 'UNKNOWN' | 'NO_CANDIDATE'
/**
 * 🔴 **정본 순위 shadow — 세기만 한다.** 모집단은 슬롯 판정까지 eligible 인 후보.
 *    같은 `(commentsPct, viewsPct)` · 같은 신선도 구간끼리만 동률이다(새 허용 오차 · 구간 없음).
 *    `qualityUnknown` 은 0 이나 "효과 없음" 으로 바꾸지 않는다.
 */
export type TraceShadow = {
  population: number
  qualityUnknown: number
  noStrictTie: number
  strictTieGroups: number
  strictTieCandidates: number
  menopauseCouldReorder: number
  wgangCouldReorder: number
  menopause: ShadowVerdict
  wgang: ShadowVerdict
}

export type SupplySelectionTrace = {
  kind: typeof SELECTION_TRACE_KIND
  version: typeof SELECTION_TRACE_VERSION
  runId: string
  takenAt: string
  limit: number
  cap: number
  jit: boolean
  slots: string[]
  /** 🔴 최종 묶음 파일 내용의 digest — 이 trace 가 어느 묶음을 설명하는지 */
  worksetDigest: string
  candidates: TraceCandidate[]
  summary: TraceSummary
  shadow: TraceShadow
}

// ─────────────────────────────────────────────────────────
// 기록기
// ─────────────────────────────────────────────────────────

export type SelectionRecord = {
  eligibility: Map<string, { row: WorksetRow; drop: WorksetDrop | null; verdict: SlotReleaseVerdict | null }>
  identityMissing: number
  assignment: Map<string, { slotAt: Date; round: number; kept: boolean }>
  selection: Map<string, WorksetSelectStep>
  /** 🔴 같은 원천이 같은 단계에 두 번 적혔다 — 그 원천은 TRACE_MISMATCH 다 */
  duplicated: Set<string>
}

/** 🔴 기록기 하나 — 공급 회차마다 새로 만든다. 선택 함수에 넘기는 것은 `sink` 뿐이다 */
export function createSelectionRecorder(): { sink: WorksetTraceSink; record: SelectionRecord } {
  const record: SelectionRecord = {
    eligibility: new Map(), identityMissing: 0, assignment: new Map(), selection: new Map(), duplicated: new Set(),
  }
  const sink: WorksetTraceSink = {
    eligibility: ({ row, key, drop, verdict }) => {
      if (key === null) { record.identityMissing += 1; return }
      if (record.eligibility.has(key)) record.duplicated.add(key)
      record.eligibility.set(key, { row, drop, verdict })
    },
    assignment: ({ key, slotAt, round, kept }) => {
      const prev = record.assignment.get(key)
      if (prev !== undefined && prev.kept && kept) record.duplicated.add(key)
      if (prev === undefined || kept) record.assignment.set(key, { slotAt, round, kept })
    },
    selection: ({ key, step }) => {
      if (record.selection.has(key)) record.duplicated.add(key)
      record.selection.set(key, step)
    },
  }
  return { sink, record }
}

// ─────────────────────────────────────────────────────────
// 조립
// ─────────────────────────────────────────────────────────

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
/** 🔴 묶음 digest — 같은 묶음이면 같은 값(관측 전후 · on/off 대조에 쓴다) */
export const worksetDigestOf = (w: Workset): string => sha256(JSON.stringify(w))

/**
 * 🔴 **원래 원문 나이(h) — 반올림 없음.** 정본 판정과 같은 식(`max(0, 슬롯 − 게시)`)을 증거 기록의 게시 시각으로 잰다.
 *    정본 `rank.ageAtSlotH` 는 비교기용으로 0.001h 에 반올림돼 있다 — 그 값으로 구간 · EDF 나이를 재면
 *    2.9996h 가 3h 구간으로 넘어가고 0.001h 미만 차이가 동률이 된다. 판정용으로는 이 값을 쓴다.
 *    🔴 eligible 판정을 받은 행에만 부른다(게시 시각이 이미 정본 검증을 지났다). 못 읽으면 null.
 */
const rawAgeH = (r: WorksetRow, slotAt: Date): number | null => {
  const posted = Date.parse(r.evidence?.postedAt ?? '')
  return Number.isFinite(posted) ? Math.max(0, slotAt.getTime() - posted) / HOUR_MS : null
}

export function buildSupplySelectionTrace(input: {
  runId: string
  takenAt: Date
  limit: number
  cap: number
  /** 이번 회차 부족 슬롯 — `assignSourceSlots` 에 넘긴 것과 같은 목록 */
  slots: readonly Date[]
  record: SelectionRecord
  attempted: ReadonlyMap<string, PriorOutcome>
  picked: readonly WorksetRow[]
  workset: Workset
  /** 🔴 짝짓기와 같은 판정 — `preGenerationRelease(row, slotAt, now)` */
  slotVerdict: (r: WorksetRow, slotAt: Date) => SlotReleaseVerdict
}): SupplySelectionTrace {
  const jit = input.workset.version === WORKSET_VERSION_JIT
  const slotIndex = new Map(input.slots.map((d, i) => [d.getTime(), i]))
  const position = new Map<string, number>()
  input.picked.forEach((r, i) => {
    const k = sourceIdentityOf(r.sourceSite, r.sourceArticleId)
    if (k !== null) position.set(k, i)
  })

  const candidates: TraceCandidate[] = []
  for (const [key, e] of input.record.eligibility) {
    const r = e.row
    const prior = input.attempted.get(key)
    const reachedSlot = e.drop === null || e.drop === 'slotIneligible' || e.drop === 'slotUnknown'
    const slotAgesH = reachedSlot
      ? input.slots.map((d) => {
        const v = input.slotVerdict(r, d)
        return v.verdict === 'eligible' ? rawAgeH(r, d) : null
      })
      : null
    const lastValid = slotAgesH === null ? -1 : slotAgesH.reduce<number>((m, a, i) => (a !== null ? i : m), -1)
    const asg = input.record.assignment.get(key)
    const step = input.record.selection.get(key) ?? null
    const linkable = slotAgesH !== null && slotAgesH.some((a) => a !== null)

    let edf: TraceEdfStage
    if (e.drop !== null) edf = 'NOT_REACHED'
    else if (!jit) edf = 'NOT_APPLICABLE'
    else if (asg?.kept === true) edf = 'ASSIGNED'
    else if (!linkable) edf = 'UNLINKABLE'
    else if (asg !== undefined) edf = 'CAP_CUT'
    else edf = 'NOT_MATCHED'

    let reason: TraceReason
    if (e.drop !== null) {
      reason = e.drop === 'identityMissing' || e.drop === 'slotUnassigned' ? 'TRACE_MISMATCH' : DROP_REASON[e.drop]
      if (step !== null) reason = 'TRACE_MISMATCH'
    } else if (edf === 'UNLINKABLE' || edf === 'NOT_MATCHED' || edf === 'CAP_CUT') {
      reason = step === 'SLOT_UNASSIGNED' ? EDF_REASON[edf] : 'TRACE_MISMATCH'
    } else if (step === null || step === 'SLOT_UNASSIGNED') {
      reason = 'TRACE_MISMATCH'
    } else {
      reason = STEP_REASON[step]
    }
    const pos = position.get(key) ?? null
    if ((pos !== null) !== reason.startsWith('SELECTED_')) reason = 'TRACE_MISMATCH'
    if (input.record.duplicated.has(key)) reason = 'TRACE_MISMATCH'
    const assignedIdx = asg?.kept === true ? slotIndex.get(asg.slotAt.getTime()) : undefined
    if (asg?.kept === true && assignedIdx === undefined) reason = 'TRACE_MISMATCH'

    const rk = e.verdict?.rank ?? null
    // 🔴 판정 슬롯에서의 원래 나이 — 정본 판정이 나이를 쟀을 때(rank.ageAtSlotH 있음)만
    const sourceAgeH = e.verdict === null || rk === null || rk.ageAtSlotH === null ? null : rawAgeH(r, new Date(e.verdict.slotAt))
    candidates.push({
      sourceHash: articleIdHashOf(r.sourceSite, r.sourceArticleId),
      source: r.sourceSite,
      axis: worksetAxisOf(r),
      retry: prior !== undefined,
      retryTier: prior === undefined ? null : retryTierOf(prior),
      retryWaitedH: prior === undefined ? null : (input.takenAt.getTime() - runClockOf(prior)) / HOUR_MS,
      slotAgesH,
      lastValidSlot: lastValid < 0 ? null : lastValid,
      assignedSlot: assignedIdx ?? null,
      edfRound: asg === undefined ? null : asg.round,
      edf,
      selectStep: step,
      // 🔴 지금 비교기가 받은 값 그대로(trace 가 다시 반올림하지 않는다)
      rank: rk === null ? null : {
        commentsPct: rk.commentsPct, viewsPct: rk.viewsPct, ageAtSlotH: rk.ageAtSlotH, velocity: rk.velocity,
      },
      sourceAgeH,
      freshnessBand: observationBucketOf(sourceAgeH),
      selected: pos !== null,
      position: pos,
      reason,
      menopauseCore: mentionsMenopause(`${r.input.title ?? ''}\n${r.input.bodyHead ?? ''}`),
      wgangSource: r.sourceSite === WGANG_SOURCE,
    })
  }
  candidates.sort((a, b) => (a.sourceHash < b.sourceHash ? -1 : a.sourceHash > b.sourceHash ? 1 : 0))

  return {
    kind: SELECTION_TRACE_KIND, version: SELECTION_TRACE_VERSION,
    runId: input.runId, takenAt: input.takenAt.toISOString(), limit: input.limit, cap: input.cap, jit,
    slots: input.slots.map((d) => d.toISOString()),
    worksetDigest: worksetDigestOf(input.workset),
    candidates,
    summary: summarizeTrace(candidates, input.record.identityMissing),
    shadow: shadowOf(candidates),
  }
}

// ─────────────────────────────────────────────────────────
// 요약 · shadow — 🔴 후보 기록만으로 다시 계산된다(읽는 쪽이 대조한다)
// ─────────────────────────────────────────────────────────

const zeroReasons = (): Record<TraceReason, number> =>
  Object.fromEntries(TRACE_REASONS.map((r) => [r, 0])) as Record<TraceReason, number>

export function summarizeTrace(cs: readonly TraceCandidate[], identityMissing: number): TraceSummary {
  const count = (f: (c: TraceCandidate) => boolean): Count => ({
    candidates: cs.filter(f).length, selected: cs.filter((c) => f(c) && c.selected).length,
  })
  const byReason = zeroReasons()
  const menopauseByReason = zeroReasons()
  const wgangByReason = zeroReasons()
  for (const c of cs) {
    byReason[c.reason] += 1
    if (c.menopauseCore) menopauseByReason[c.reason] += 1
    if (c.wgangSource) wgangByReason[c.reason] += 1
  }
  const notPaired = cs.filter((c) => c.edf === 'NOT_MATCHED' || c.edf === 'CAP_CUT')
  const edfOlderOverFresher = cs.filter((c) => {
    if (c.edf !== 'ASSIGNED' || c.assignedSlot === null || c.slotAgesH === null) return false
    const mine = c.slotAgesH[c.assignedSlot]
    if (mine === null || mine === undefined) return false
    return notPaired.some((o) => {
      const a = o.slotAgesH?.[c.assignedSlot!]
      return a !== null && a !== undefined && a < mine
    })
  }).length
  return {
    identityMissing,
    candidates: cs.length,
    selected: cs.filter((c) => c.selected).length,
    fresh: count((c) => !c.retry),
    retry: count((c) => c.retry),
    menopauseCore: count((c) => c.menopauseCore),
    wgang: count((c) => c.wgangSource),
    menopauseWgang: count((c) => c.menopauseCore && c.wgangSource),
    byReason, menopauseByReason, wgangByReason,
    edfOlderOverFresher,
    freshDisplacedByRetryReserve: byReason.FRESH_DISPLACED_BY_RETRY_RESERVE,
    axisQuotaDropped: byReason.AXIS_QUOTA_ZERO + byReason.AXIS_QUOTA_FULL,
    mismatches: byReason.TRACE_MISMATCH,
  }
}

/** 🔴 지금 공급 순위 그대로 — `compareReleaseRank`(마지막 열쇠만 해시) */
const currentOrder = (a: TraceCandidate, b: TraceCandidate): number =>
  compareReleaseRank({ ...a.rank!, tieBreak: '' }, { ...b.rank!, tieBreak: '' })
  || (a.sourceHash < b.sourceHash ? -1 : a.sourceHash > b.sourceHash ? 1 : 0)

export function shadowOf(cs: readonly TraceCandidate[]): TraceShadow {
  const pop = cs.filter((c) => c.edf !== 'NOT_REACHED' && c.rank !== null)
  const known = pop.filter((c) => c.rank!.commentsPct !== null && c.rank!.viewsPct !== null && c.freshnessBand !== null)
  const groups = new Map<string, TraceCandidate[]>()
  for (const c of known) {
    const k = `${c.rank!.commentsPct}|${c.rank!.viewsPct}|${c.freshnessBand}`
    groups.set(k, [...(groups.get(k) ?? []), c])
  }
  let strictTieGroups = 0
  let strictTieCandidates = 0
  let menopauseCouldReorder = 0
  let wgangCouldReorder = 0
  for (const g of groups.values()) {
    if (g.length < 2) continue
    strictTieGroups += 1
    strictTieCandidates += g.length
    const cur = [...g].sort(currentOrder)
    // 🔴 stable sort — 같은 선호 값끼리는 지금 순서 그대로
    const byMeno = [...cur].sort((a, b) => Number(b.menopauseCore) - Number(a.menopauseCore))
    const byMenoWgang = [...byMeno].sort((a, b) =>
      Number(b.menopauseCore) - Number(a.menopauseCore) || Number(b.wgangSource) - Number(a.wgangSource))
    menopauseCouldReorder += byMeno.filter((c, i) => c.menopauseCore && i < cur.indexOf(c)).length
    wgangCouldReorder += byMenoWgang.filter((c, i) => c.wgangSource && i < byMeno.indexOf(c)).length
  }
  const verdict = (): ShadowVerdict => {
    if (pop.length === 0) return 'NO_CANDIDATE'
    if (strictTieCandidates > 0) return 'COMPUTED'
    return known.length < pop.length ? 'UNKNOWN' : 'NO_STRICT_TIE'
  }
  return {
    population: pop.length,
    qualityUnknown: pop.length - known.length,
    noStrictTie: known.length - strictTieCandidates,
    strictTieGroups, strictTieCandidates, menopauseCouldReorder, wgangCouldReorder,
    menopause: verdict(), wgang: verdict(),
  }
}

// ─────────────────────────────────────────────────────────
// 읽기 · 검증 — 🔴 손상이나 빠진 칸을 정상으로 조용히 넘기지 않는다
// ─────────────────────────────────────────────────────────

const TOP_KEYS = ['kind', 'version', 'runId', 'takenAt', 'limit', 'cap', 'jit', 'slots', 'worksetDigest', 'candidates', 'summary', 'shadow']
const CANDIDATE_KEYS = [
  'sourceHash', 'source', 'axis', 'retry', 'retryTier', 'retryWaitedH', 'slotAgesH', 'lastValidSlot', 'assignedSlot',
  'edfRound', 'edf', 'selectStep', 'rank', 'sourceAgeH', 'freshnessBand', 'selected', 'position', 'reason', 'menopauseCore', 'wgangSource',
]
const RANK_KEYS = ['commentsPct', 'viewsPct', 'ageAtSlotH', 'velocity']
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const sameKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o)
const numOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v))
const intOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0)
const strictIso = (v: unknown): boolean => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v

export type SelectionTraceRead = { ok: true; trace: SupplySelectionTrace } | { ok: false; problems: string[] }

export function readSupplySelectionTrace(raw: unknown): SelectionTraceRead {
  const p: string[] = []
  if (!isObj(raw)) return { ok: false, problems: ['NOT_OBJECT'] }
  if (!sameKeys(raw, TOP_KEYS)) p.push('TOP_KEYS')
  if (raw.kind !== SELECTION_TRACE_KIND) p.push('KIND')
  if (raw.version !== SELECTION_TRACE_VERSION) p.push('VERSION')
  if (typeof raw.runId !== 'string' || !/^\d{8}-\d{6}$/.test(raw.runId)) p.push('RUN_ID')
  if (!strictIso(raw.takenAt)) p.push('TAKEN_AT')
  if (!intOrNull(raw.limit) || raw.limit === null || !intOrNull(raw.cap) || raw.cap === null) p.push('LIMIT')
  if (typeof raw.jit !== 'boolean') p.push('JIT')
  const slots = Array.isArray(raw.slots) && raw.slots.every(strictIso) ? raw.slots as string[] : null
  if (slots === null) p.push('SLOTS')
  if (typeof raw.worksetDigest !== 'string' || !/^[0-9a-f]{64}$/.test(raw.worksetDigest)) p.push('WORKSET_DIGEST')
  if (!Array.isArray(raw.candidates)) return { ok: false, problems: [...p, 'CANDIDATES'] }
  const n = slots?.length ?? 0
  raw.candidates.forEach((c: unknown, i: number) => {
    const at = `candidates[${i}]`
    if (!isObj(c) || !sameKeys(c, CANDIDATE_KEYS)) { p.push(`${at}:KEYS`); return }
    if (typeof c.sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(c.sourceHash)) p.push(`${at}:SOURCE_HASH`)
    if (typeof c.source !== 'string' || !/^[a-z0-9]+(:[a-z0-9-]+)?$/.test(c.source)) p.push(`${at}:SOURCE`)
    if (c.axis !== 'seed' && c.axis !== 'raw') p.push(`${at}:AXIS`)
    if (typeof c.retry !== 'boolean' || typeof c.selected !== 'boolean'
      || typeof c.menopauseCore !== 'boolean' || typeof c.wgangSource !== 'boolean') p.push(`${at}:BOOL`)
    if (!intOrNull(c.retryTier) || !numOrNull(c.retryWaitedH) || (c.retry === false) !== (c.retryTier === null)) p.push(`${at}:RETRY`)
    if (c.slotAgesH !== null && (!Array.isArray(c.slotAgesH) || c.slotAgesH.length !== n || !c.slotAgesH.every(numOrNull))) p.push(`${at}:SLOT_AGES`)
    for (const k of ['lastValidSlot', 'assignedSlot'] as const) {
      if (!intOrNull(c[k]) || (typeof c[k] === 'number' && (c[k] as number) >= n)) p.push(`${at}:${k}`)
    }
    if (!intOrNull(c.edfRound) || !intOrNull(c.position)) p.push(`${at}:INT`)
    if (!(TRACE_EDF_STAGES as readonly unknown[]).includes(c.edf)) p.push(`${at}:EDF`)
    if (c.selectStep !== null && !(WORKSET_SELECT_STEPS as readonly unknown[]).includes(c.selectStep)) p.push(`${at}:STEP`)
    if (!(TRACE_REASONS as readonly unknown[]).includes(c.reason)) p.push(`${at}:REASON`)
    if (c.rank !== null && (!isObj(c.rank) || !sameKeys(c.rank, RANK_KEYS) || !RANK_KEYS.every((k) => numOrNull((c.rank as Record<string, unknown>)[k])))) {
      p.push(`${at}:RANK`)
    }
    if (!numOrNull(c.sourceAgeH)) p.push(`${at}:SOURCE_AGE`)
    // 🔴 구간은 원래 나이에서만 나온다 — 따로 적힌 구간이 나이와 어긋나면 손상이다
    else if (c.freshnessBand !== observationBucketOf(c.sourceAgeH as number | null)) p.push(`${at}:BAND`)
    const sel = typeof c.reason === 'string' && c.reason.startsWith('SELECTED_')
    if (c.selected !== (c.position !== null) || (c.reason !== 'TRACE_MISMATCH' && c.selected !== sel)) p.push(`${at}:SELECTED`)
    if ((c.edf === 'ASSIGNED') !== (c.assignedSlot !== null)) p.push(`${at}:ASSIGNED`)
  })
  if (p.length > 0) return { ok: false, problems: p }
  const cs = raw.candidates as TraceCandidate[]
  const hashes = cs.map((c) => c.sourceHash)
  if (new Set(hashes).size !== hashes.length) p.push('DUPLICATE_SOURCE')
  if (hashes.some((h, i) => i > 0 && hashes[i - 1]! >= h)) p.push('ORDER')
  if (!isObj(raw.summary) || typeof raw.summary.identityMissing !== 'number') p.push('SUMMARY')
  else if (JSON.stringify(raw.summary) !== JSON.stringify(summarizeTrace(cs, raw.summary.identityMissing))) p.push('SUMMARY_MISMATCH')
  if (JSON.stringify(raw.shadow) !== JSON.stringify(shadowOf(cs))) p.push('SHADOW_MISMATCH')
  return p.length > 0 ? { ok: false, problems: p } : { ok: true, trace: raw as unknown as SupplySelectionTrace }
}

export const serializeSelectionTrace = (t: SupplySelectionTrace): string => `${JSON.stringify(t, null, 2)}\n`

// ─────────────────────────────────────────────────────────
// 🔴 남기기 — 실패해도 던지지 않는다 · 선택 · 유료 단계 · DB 를 건드리지 않는다
// ─────────────────────────────────────────────────────────

export type TraceRecordOutcome =
  | { ok: true; trace: SupplySelectionTrace; written: boolean }
  | { ok: false; stage: 'build' | 'verify' | 'write'; error: string }

/**
 * 🔴 **조립 → 직렬화한 글자를 다시 읽어 검증 → 쓰기**, 각 단계를 한 번씩만 한다(재시도 없음).
 *    검증을 통과하지 못한 trace 는 쓰지 않는다. 어떤 실패도 호출부로 던지지 않는다 — 관측 실패가
 *    묶음 · 유료 호출 · 적재를 바꾸거나 되풀이하게 하지 않는다. 오류 문구에는 원천 값이 없다(코드 · 경로만).
 */
export function recordSelectionTraceSafely(input: {
  build: () => SupplySelectionTrace
  /** null 이면 쓰지 않는다(dry-run) */
  write: ((body: string) => void) | null
}): TraceRecordOutcome {
  let trace: SupplySelectionTrace
  try { trace = input.build() } catch (e) {
    return { ok: false, stage: 'build', error: e instanceof Error ? e.name : 'unknown' }
  }
  const body = serializeSelectionTrace(trace)
  try {
    const back = readSupplySelectionTrace(JSON.parse(body))
    if (!back.ok) return { ok: false, stage: 'verify', error: back.problems.slice(0, 5).join(',') }
  } catch (e) {
    return { ok: false, stage: 'verify', error: e instanceof Error ? e.name : 'unknown' }
  }
  if (input.write === null) return { ok: true, trace, written: false }
  try { input.write(body) } catch (e) {
    return { ok: false, stage: 'write', error: e instanceof Error ? e.name : 'unknown' }
  }
  return { ok: true, trace, written: true }
}
