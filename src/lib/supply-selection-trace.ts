/**
 * 🔴 **공급 선택 관측 trace v2** (2026-10-10 P0-B1 · v1 은 P0-B0) — 순수 함수 · DB · 네트워크 · provider 0
 *
 *   공급 한 회차에서 원천 하나하나가 **어느 단계에서 왜** 골라지거나 빠졌는지를 남긴다.
 *     생성 가능 판정(`worksetEligibility`) → JIT 선택(`selectJitWorkset`: raw 제외 · 슬롯 연결 · 최대 슬롯 보존
 *     · 재시도 예약 · 정본 순위 · EDF 배정) → 최종 묶음
 *   기록은 선택 함수에 넘긴 기록기(`WorksetTraceSink`)가 모은다. 이 파일은 모은 것을 **읽기만** 해서 조립한다.
 *
 * 🔴 **선택을 바꾸지 않는다.** 묶음 · 순서 · 배정은 trace 를 주든 안 주든 같다(검사가 digest 로 대조한다).
 * 🔴 **원문 없음.** 제목 · 본문 · 작성자 · URL · 원문 id 평문을 싣지 않는다 — `sha256(site::id)`(`articleIdHashOf`)와
 *    정본 원천 이름 · 숫자 · enum 만 남는다. 읽는 쪽(`readSupplySelectionTrace`)은 정해진 칸 밖의 칸을 거부한다.
 * 🔴 **판정은 원래 값으로.** 나이는 게시 시각에서 직접 잰 원래 값(반올림 없음) · 순위는 정본 rank 그대로.
 * 🔴 v1 기록은 `supply-selection-trace-v1.ts` 가 계속 읽는다(만드는 함수는 없다).
 */
import { createHash } from 'node:crypto'

import { mentionsMenopause } from './original-post-persona-match'
import {
  articleIdHashOf, compareReleaseRank, observationBucketOf, type SlotReleaseVerdict,
} from './source-slot-release'
import {
  JIT_SELECT_STEPS, maxSlotMatching, retryTierOf, runClockOf, sourceIdentityOf, worksetAxisOf, WGANG_SOURCE_SITE,
  type JitSelectionFacts, type JitSelectStep, type PriorOutcome, type Workset, type WorksetDrop, type WorksetRow,
  type WorksetTraceSink,
} from './supply-workset'
import {
  readSupplySelectionTraceV1, SELECTION_TRACE_VERSION_V1, type SupplySelectionTraceV1,
} from './supply-selection-trace-v1'

export const SELECTION_TRACE_KIND = 'supply-selection-trace'
export const SELECTION_TRACE_VERSION = 'selection-trace-v2'
/** 🔴 회차 파일 이름 — `supply-workset-` · `supply-opportunities-` 를 집는 다른 읽기 경로와 겹치지 않는다 */
export const selectionTraceFileName = (runId: string): string => `supply-selection-trace-${runId}.json`

const HOUR_MS = 3_600_000
const KST_MS = 9 * HOUR_MS

/** 🔴 원천이 멈춘(또는 들어간) 단계 — 생성 가능 판정에서 빠지면 `NOT_REACHED` · 그 밖은 JIT 선택 단계 그대로 */
export const TRACE_STAGES = ['NOT_REACHED', ...JIT_SELECT_STEPS] as const
export type TraceStage = (typeof TRACE_STAGES)[number]

/** 🔴 **최종 사유 하나** — 처음 멈춘 단계의 원인. 다른 원인을 한 값으로 합치지 않는다 */
export const TRACE_REASONS = [
  'HUMAN_DECIDED', 'QUEUE_SIBLING', 'ALREADY_QUEUED', 'CARRIED_OVER', 'TERMINAL', 'HARD_BLOCKED', 'PRE_GATED',
  'SLOT_INELIGIBLE', 'EVIDENCE_UNKNOWN',
  'RAW_NOT_AUTO_CONSUMED', 'SLOT_UNLINKABLE', 'CAP_REACHED', 'SELECTED_COVER', 'SELECTED_EXTRA',
  /** 🔴 기록끼리 맞지 않는다(단계 기록 없음 · 같은 원천 두 번 · 배정 슬롯에서 무효) — 정상 결과로 세지 않는다 */
  'TRACE_MISMATCH',
] as const
export type TraceReason = (typeof TRACE_REASONS)[number]

const DROP_REASON: Readonly<Record<Exclude<WorksetDrop, 'identityMissing' | 'slotUnassigned' | 'rawNotAutoConsumed'>, TraceReason>> = {
  humanDecided: 'HUMAN_DECIDED', queueSibling: 'QUEUE_SIBLING', alreadyQueued: 'ALREADY_QUEUED',
  carriedOver: 'CARRIED_OVER', terminal: 'TERMINAL', hardBlocked: 'HARD_BLOCKED', preGated: 'PRE_GATED',
  slotIneligible: 'SLOT_INELIGIBLE', slotUnknown: 'EVIDENCE_UNKNOWN',
}
const STEP_REASON: Readonly<Record<JitSelectStep, TraceReason>> = {
  RAW_EXCLUDED: 'RAW_NOT_AUTO_CONSUMED', SLOT_UNLINKABLE: 'SLOT_UNLINKABLE', CAP_REACHED: 'CAP_REACHED',
  SELECTED_COVER: 'SELECTED_COVER', SELECTED_EXTRA: 'SELECTED_EXTRA',
}

/** 🔴 지금 공급 순위(`compareReleaseRank`)가 실제로 쓰는 성분 그대로 — 기준 슬롯(가장 이른 부족 슬롯)의 정본 rank */
export type TraceRank = { commentsPct: number | null; viewsPct: number | null; ageAtSlotH: number | null; velocity: number | null }

export type TraceCandidate = {
  /** `sha256("<site>::<articleId>")` — 원문 id 평문 없음 */
  sourceHash: string
  /** 정본 원천 이름(`navercafe:wgang` …) */
  source: string
  axis: 'seed' | 'raw'
  retry: boolean
  retryTier: number | null
  retryWaitedH: number | null
  /** 🔴 재시도 예약으로 들어갔는가 */
  retryReserved: boolean
  /** 🔴 부족 슬롯(시각순)마다 그 슬롯에서 eligible 이면 원래 원문 나이(h · 반올림 없음), 아니면 null · 슬롯 판정까지 안 갔으면 null */
  slotAgesH: (number | null)[] | null
  lastValidSlot: number | null
  assignedSlot: number | null
  stage: TraceStage
  rank: TraceRank | null
  /** 🔴 기준 슬롯에서의 원래 원문 나이 */
  sourceAgeH: number | null
  /** 정본 관측 나이 구간(`observationBucketOf(sourceAgeH)`) */
  freshnessBand: string | null
  selected: boolean
  position: number | null
  reason: TraceReason
  menopauseCore: boolean
  wgangSource: boolean
}

type Count = { candidates: number; selected: number }
export type TraceSummary = {
  identityMissing: number
  candidates: number
  selected: number
  slots: number
  cap: number
  /** 🔴 원천마다 서로 다른 슬롯 하나로 덮을 수 있는 최대 슬롯 수(연결 가능한 자동 seed 원천 기준) */
  maxFillableSlots: number
  coverTarget: number
  coveredSlots: number
  fresh: Count
  retry: Count
  retryReserved: number
  rawExcluded: number
  unlinkable: number
  menopauseCore: Count
  wgang: Count
  menopauseWgang: Count
  byReason: Record<TraceReason, number>
  menopauseByReason: Record<TraceReason, number>
  wgangByReason: Record<TraceReason, number>
  /** 🔴 선택 원천의 배정 슬롯 시점 원래 나이 */
  selectedAgeH: { p50: number | null; p90: number | null }
  /** 🔴 선택 원천 중 게시 KST 날짜가 회차 KST 날짜와 같은 수 */
  selectedSameKstDay: number
  /**
   * 🔴 **순위 역전** — 고른 원천 s(재시도 예약 제외)보다 정본 순위가 엄격히 앞서는 미선택 원천 u 가 있고,
   *    s 를 u 로 바꿔도 덮는 슬롯 수가 줄지 않는 쌍의 수. 새 선택에서는 0 이어야 한다.
   */
  rankInversions: number
  /** 🔴 순위가 정본 rank 동률이라 갱년기 · wgang 이 순서를 정한 인접 비교 수(실측 0 이어도 그대로 적는다) */
  preferenceDecided: { menopause: number; wgang: number }
  mismatches: number
}

export type SupplySelectionTrace = {
  kind: typeof SELECTION_TRACE_KIND
  version: typeof SELECTION_TRACE_VERSION
  runId: string
  takenAt: string
  limit: number
  cap: number
  /** 부족 슬롯 — 시각순 */
  slots: string[]
  worksetDigest: string
  /** 🔴 선택 함수가 보고한 사실 — 요약 재계산과 같아야 한다(다르면 손상) */
  facts: JitSelectionFacts
  candidates: TraceCandidate[]
  summary: TraceSummary
}

// ─────────────────────────────────────────────────────────
// 기록기
// ─────────────────────────────────────────────────────────

export type SelectionRecord = {
  eligibility: Map<string, { row: WorksetRow; drop: WorksetDrop | null; verdict: SlotReleaseVerdict | null }>
  identityMissing: number
  jit: Map<string, { step: JitSelectStep; slotAt: Date | null; position: number | null; retryReserved: boolean }>
  /** 🔴 같은 원천이 같은 단계에 두 번 적혔다 — 그 원천은 TRACE_MISMATCH 다 */
  duplicated: Set<string>
}

/** 🔴 기록기 하나 — 공급 회차마다 새로 만든다. 선택 함수에 넘기는 것은 `sink` 뿐이다 */
export function createSelectionRecorder(): { sink: WorksetTraceSink; record: SelectionRecord } {
  const record: SelectionRecord = { eligibility: new Map(), identityMissing: 0, jit: new Map(), duplicated: new Set() }
  const sink: WorksetTraceSink = {
    eligibility: ({ row, key, drop, verdict }) => {
      if (key === null) { record.identityMissing += 1; return }
      if (record.eligibility.has(key)) record.duplicated.add(key)
      record.eligibility.set(key, { row, drop, verdict })
    },
    jit: ({ key, step, slotAt, position, retryReserved }) => {
      if (record.jit.has(key)) record.duplicated.add(key)
      record.jit.set(key, { step, slotAt, position, retryReserved })
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
 *    eligible 판정을 받은 행에만 부른다(게시 시각이 이미 정본 검증을 지났다). 못 읽으면 null — 지어내지 않는다.
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
  /** 이번 회차 부족 슬롯 — 선택 함수에 넘긴 것과 같은 목록(순서는 여기서 시각순으로 맞춘다) */
  slots: readonly Date[]
  record: SelectionRecord
  attempted: ReadonlyMap<string, PriorOutcome>
  picked: readonly WorksetRow[]
  workset: Workset
  facts: JitSelectionFacts
  /** 🔴 선택과 같은 판정 — `preGenerationRelease(row, slotAt, now)` */
  slotVerdict: (r: WorksetRow, slotAt: Date) => SlotReleaseVerdict
}): SupplySelectionTrace {
  // 🔴 선택과 같은 슬롯 목록 — 시각으로 하나 · 시각순
  const slots = [...new Map(input.slots.map((d) => [d.getTime(), d])).values()].sort((a, b) => a.getTime() - b.getTime())
  const slotIndex = new Map(slots.map((d, i) => [d.getTime(), i]))
  const position = new Map<string, number>()
  input.picked.forEach((r, i) => {
    const k = sourceIdentityOf(r.sourceSite, r.sourceArticleId)
    if (k !== null) position.set(k, i)
  })

  const candidates: TraceCandidate[] = []
  for (const [key, e] of input.record.eligibility) {
    const r = e.row
    const prior = input.attempted.get(key)
    const j = input.record.jit.get(key)
    const reachedSlot = e.drop === null || e.drop === 'slotIneligible' || e.drop === 'slotUnknown'
    const slotAgesH = reachedSlot
      ? slots.map((d) => (input.slotVerdict(r, d).verdict === 'eligible' ? rawAgeH(r, d) : null))
      : null
    const lastValid = slotAgesH === null ? -1 : slotAgesH.reduce<number>((m, a, i) => (a !== null ? i : m), -1)

    let stage: TraceStage
    let reason: TraceReason
    if (e.drop !== null) {
      stage = 'NOT_REACHED'
      reason = e.drop === 'identityMissing' || e.drop === 'slotUnassigned' || e.drop === 'rawNotAutoConsumed'
        ? 'TRACE_MISMATCH' : DROP_REASON[e.drop]
      if (j !== undefined) reason = 'TRACE_MISMATCH'
    } else if (j === undefined) {
      stage = 'NOT_REACHED'; reason = 'TRACE_MISMATCH'
    } else {
      stage = j.step; reason = STEP_REASON[j.step]
    }
    const pos = position.get(key) ?? null
    const selected = pos !== null
    if (selected !== (reason === 'SELECTED_COVER' || reason === 'SELECTED_EXTRA')) reason = 'TRACE_MISMATCH'
    if (j !== undefined && j.position !== pos) reason = 'TRACE_MISMATCH'
    if (input.record.duplicated.has(key)) reason = 'TRACE_MISMATCH'
    const assignedIdx = j?.slotAt == null ? null : (slotIndex.get(j.slotAt.getTime()) ?? -1)
    if (assignedIdx === -1 || (selected && (assignedIdx === null || slotAgesH?.[assignedIdx] == null))) reason = 'TRACE_MISMATCH'

    // 🔴 순위는 선택과 같은 기준 슬롯(가장 이른 부족 슬롯)의 정본 rank
    //    (그 슬롯에서 eligible 이 아니면 생성 가능 판정이 쓴 판정 그대로 — 순위 값과 그 시각은 같은 판정에서 꺼낸다)
    const atRef = reachedSlot && slots.length > 0 ? input.slotVerdict(r, slots[0]!) : null
    const ref = atRef !== null && (atRef.verdict === 'eligible' || e.verdict === null) ? atRef : e.verdict
    const rk = ref === null ? null : ref.rank
    const refSlot = ref === null ? null : new Date(ref.slotAt)
    const sourceAgeH = rk === null || rk.ageAtSlotH === null || refSlot === null ? null : rawAgeH(r, refSlot)
    candidates.push({
      sourceHash: articleIdHashOf(r.sourceSite, r.sourceArticleId),
      source: r.sourceSite,
      axis: worksetAxisOf(r),
      retry: prior !== undefined,
      retryTier: prior === undefined ? null : retryTierOf(prior),
      retryWaitedH: prior === undefined ? null : (input.takenAt.getTime() - runClockOf(prior)) / HOUR_MS,
      retryReserved: j?.retryReserved === true,
      slotAgesH,
      lastValidSlot: lastValid < 0 ? null : lastValid,
      assignedSlot: assignedIdx === null || assignedIdx < 0 ? null : assignedIdx,
      stage,
      rank: rk === null ? null : { commentsPct: rk.commentsPct, viewsPct: rk.viewsPct, ageAtSlotH: rk.ageAtSlotH, velocity: rk.velocity },
      sourceAgeH,
      freshnessBand: observationBucketOf(sourceAgeH),
      selected,
      position: pos,
      reason,
      menopauseCore: mentionsMenopause(`${r.input.title ?? ''}\n${r.input.bodyHead ?? ''}`),
      wgangSource: r.sourceSite === WGANG_SOURCE_SITE,
    })
  }
  candidates.sort((a, b) => (a.sourceHash < b.sourceHash ? -1 : a.sourceHash > b.sourceHash ? 1 : 0))
  const slotsIso = slots.map((d) => d.toISOString())
  return {
    kind: SELECTION_TRACE_KIND, version: SELECTION_TRACE_VERSION,
    runId: input.runId, takenAt: input.takenAt.toISOString(), limit: input.limit, cap: input.cap,
    slots: slotsIso,
    worksetDigest: worksetDigestOf(input.workset),
    facts: { ...input.facts },
    candidates,
    summary: summarizeTrace(candidates, input.record.identityMissing, { takenAt: input.takenAt.toISOString(), slots: slotsIso, cap: input.cap }),
  }
}

// ─────────────────────────────────────────────────────────
// 요약 — 🔴 후보 기록만으로 다시 계산된다(읽는 쪽이 대조한다)
// ─────────────────────────────────────────────────────────

const zeroReasons = (): Record<TraceReason, number> =>
  Object.fromEntries(TRACE_REASONS.map((r) => [r, 0])) as Record<TraceReason, number>

const pctl = (xs: readonly number[], q: number): number | null => {
  const v = [...xs].sort((a, b) => a - b)
  if (v.length === 0) return null
  const k = (v.length - 1) * q
  const f = Math.floor(k)
  const c = Math.min(f + 1, v.length - 1)
  return v[f]! + (v[c]! - v[f]!) * (k - f)
}

/** 🔴 정본 rank 부분만(동률이면 0) — 선호 · 열쇠 없음 */
const rankPart = (a: TraceCandidate, b: TraceCandidate): number =>
  compareReleaseRank({ ...a.rank!, tieBreak: '' }, { ...b.rank!, tieBreak: '' })
/** 🔴 선택과 같은 순위에서 열쇠만 뺀 엄격 비교 — 음수면 a 가 앞선다 */
const strictBefore = (a: TraceCandidate, b: TraceCandidate): number =>
  rankPart(a, b) || Number(b.menopauseCore) - Number(a.menopauseCore) || Number(b.wgangSource) - Number(a.wgangSource)

const matchable = (cs: readonly TraceCandidate[], nSlots: number): number =>
  maxSlotMatching(cs.map((c) => (c.slotAgesH ?? []).map((a) => a !== null)), nSlots)

export function summarizeTrace(
  cs: readonly TraceCandidate[], identityMissing: number, run: { takenAt: string; slots: readonly string[]; cap: number },
): TraceSummary {
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
  const n = run.slots.length
  const linkable = cs.filter((c) => c.stage === 'SELECTED_COVER' || c.stage === 'SELECTED_EXTRA' || c.stage === 'CAP_REACHED')
  const maxFillableSlots = matchable(linkable, n)
  const coverTarget = Math.min(run.cap, maxFillableSlots)
  const sel = cs.filter((c) => c.selected)
  const cover = sel.filter((c) => c.stage === 'SELECTED_COVER')
  const extra = sel.filter((c) => c.stage === 'SELECTED_EXTRA')
  const unselected = linkable.filter((c) => !c.selected)
  let rankInversions = 0
  for (const s of [...cover, ...extra]) {
    if (s.retryReserved || s.rank === null) continue
    for (const u of unselected) {
      if (u.rank === null || !(strictBefore(u, s) < 0)) continue
      if (s.stage === 'SELECTED_EXTRA' || matchable([...cover.filter((c) => c !== s), u], n) >= cover.length) rankInversions += 1
    }
  }
  const ordered = linkable.filter((c) => c.rank !== null).sort((a, b) => strictBefore(a, b) || (a.sourceHash < b.sourceHash ? -1 : 1))
  let menopause = 0
  let wgang = 0
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1]!, b = ordered[i]!
    if (rankPart(a, b) !== 0) continue
    if (a.menopauseCore !== b.menopauseCore) menopause += 1
    else if (a.wgangSource !== b.wgangSource) wgang += 1
  }
  const ages = sel.flatMap((c) => (c.assignedSlot === null ? [] : [c.slotAgesH?.[c.assignedSlot] ?? null])).filter((x): x is number => x !== null)
  const dayOf = (ms: number): string => new Date(ms + KST_MS).toISOString().slice(0, 10)
  const runDay = dayOf(Date.parse(run.takenAt))
  const selectedSameKstDay = sel.filter((c) => {
    if (c.assignedSlot === null) return false
    const age = c.slotAgesH?.[c.assignedSlot]
    return age != null && dayOf(Date.parse(run.slots[c.assignedSlot]!) - age * HOUR_MS) === runDay
  }).length
  return {
    identityMissing,
    candidates: cs.length,
    selected: sel.length,
    slots: n,
    cap: run.cap,
    maxFillableSlots,
    coverTarget,
    coveredSlots: new Set(sel.flatMap((c) => (c.assignedSlot === null ? [] : [c.assignedSlot]))).size,
    fresh: count((c) => !c.retry),
    retry: count((c) => c.retry),
    retryReserved: sel.filter((c) => c.retryReserved).length,
    rawExcluded: byReason.RAW_NOT_AUTO_CONSUMED,
    unlinkable: byReason.SLOT_UNLINKABLE,
    menopauseCore: count((c) => c.menopauseCore),
    wgang: count((c) => c.wgangSource),
    menopauseWgang: count((c) => c.menopauseCore && c.wgangSource),
    byReason, menopauseByReason, wgangByReason,
    selectedAgeH: { p50: pctl(ages, 0.5), p90: pctl(ages, 0.9) },
    selectedSameKstDay,
    rankInversions,
    preferenceDecided: { menopause, wgang },
    mismatches: byReason.TRACE_MISMATCH,
  }
}

// ─────────────────────────────────────────────────────────
// 읽기 · 검증 — 🔴 손상이나 빠진 칸을 정상으로 조용히 넘기지 않는다 · v1 은 v1 판독기가 읽는다
// ─────────────────────────────────────────────────────────

const TOP_KEYS = ['kind', 'version', 'runId', 'takenAt', 'limit', 'cap', 'slots', 'worksetDigest', 'facts', 'candidates', 'summary']
const FACT_KEYS = ['slots', 'cap', 'linkable', 'rawExcluded', 'unlinkable', 'maxFillableSlots', 'coverTarget', 'coveredSlots', 'retryReserve', 'retryReserved']
const CANDIDATE_KEYS = [
  'sourceHash', 'source', 'axis', 'retry', 'retryTier', 'retryWaitedH', 'retryReserved', 'slotAgesH', 'lastValidSlot',
  'assignedSlot', 'stage', 'rank', 'sourceAgeH', 'freshnessBand', 'selected', 'position', 'reason', 'menopauseCore', 'wgangSource',
]
const RANK_KEYS = ['commentsPct', 'viewsPct', 'ageAtSlotH', 'velocity']
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const sameKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o)
const numOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v))
const intOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0)
const isInt = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0
const strictIso = (v: unknown): boolean => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v

export type SelectionTraceRead =
  | { ok: true; version: 'v2'; trace: SupplySelectionTrace }
  | { ok: true; version: 'v1'; trace: SupplySelectionTraceV1 }
  | { ok: false; problems: string[] }

export function readSupplySelectionTrace(raw: unknown): SelectionTraceRead {
  if (isObj(raw) && raw.version === SELECTION_TRACE_VERSION_V1) {
    const v1 = readSupplySelectionTraceV1(raw)
    return v1.ok ? { ok: true, version: 'v1', trace: v1.trace } : { ok: false, problems: v1.problems.map((p) => `v1:${p}`) }
  }
  const p: string[] = []
  if (!isObj(raw)) return { ok: false, problems: ['NOT_OBJECT'] }
  if (!sameKeys(raw, TOP_KEYS)) p.push('TOP_KEYS')
  if (raw.kind !== SELECTION_TRACE_KIND) p.push('KIND')
  if (raw.version !== SELECTION_TRACE_VERSION) p.push('VERSION')
  if (typeof raw.runId !== 'string' || !/^\d{8}-\d{6}$/.test(raw.runId)) p.push('RUN_ID')
  if (!strictIso(raw.takenAt)) p.push('TAKEN_AT')
  if (!isInt(raw.limit) || !isInt(raw.cap)) p.push('LIMIT')
  const slots = Array.isArray(raw.slots) && raw.slots.every(strictIso) ? raw.slots as string[] : null
  if (slots === null || slots.some((s, i) => i > 0 && Date.parse(slots[i - 1]!) > Date.parse(s))) p.push('SLOTS')
  if (typeof raw.worksetDigest !== 'string' || !/^[0-9a-f]{64}$/.test(raw.worksetDigest)) p.push('WORKSET_DIGEST')
  if (!isObj(raw.facts) || !sameKeys(raw.facts, FACT_KEYS) || !FACT_KEYS.every((k) => isInt((raw.facts as Record<string, unknown>)[k]))) p.push('FACTS')
  if (!Array.isArray(raw.candidates)) return { ok: false, problems: [...p, 'CANDIDATES'] }
  const n = slots?.length ?? 0
  raw.candidates.forEach((c: unknown, i: number) => {
    const at = `candidates[${i}]`
    if (!isObj(c) || !sameKeys(c, CANDIDATE_KEYS)) { p.push(`${at}:KEYS`); return }
    if (typeof c.sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(c.sourceHash)) p.push(`${at}:SOURCE_HASH`)
    if (typeof c.source !== 'string' || !/^[a-z0-9]+(:[a-z0-9-]+)?$/.test(c.source)) p.push(`${at}:SOURCE`)
    if (c.axis !== 'seed' && c.axis !== 'raw') p.push(`${at}:AXIS`)
    if (typeof c.retry !== 'boolean' || typeof c.selected !== 'boolean' || typeof c.retryReserved !== 'boolean'
      || typeof c.menopauseCore !== 'boolean' || typeof c.wgangSource !== 'boolean') p.push(`${at}:BOOL`)
    if (!intOrNull(c.retryTier) || !numOrNull(c.retryWaitedH) || (c.retry === false) !== (c.retryTier === null)
      || (c.retryReserved === true && c.retry !== true)) p.push(`${at}:RETRY`)
    if (c.slotAgesH !== null && (!Array.isArray(c.slotAgesH) || c.slotAgesH.length !== n || !c.slotAgesH.every(numOrNull))) p.push(`${at}:SLOT_AGES`)
    for (const k of ['lastValidSlot', 'assignedSlot'] as const) {
      if (!intOrNull(c[k]) || (typeof c[k] === 'number' && (c[k] as number) >= n)) p.push(`${at}:${k}`)
    }
    if (!intOrNull(c.position)) p.push(`${at}:INT`)
    if (!(TRACE_STAGES as readonly unknown[]).includes(c.stage)) p.push(`${at}:STAGE`)
    if (!(TRACE_REASONS as readonly unknown[]).includes(c.reason)) p.push(`${at}:REASON`)
    if (c.rank !== null && (!isObj(c.rank) || !sameKeys(c.rank, RANK_KEYS) || !RANK_KEYS.every((k) => numOrNull((c.rank as Record<string, unknown>)[k])))) {
      p.push(`${at}:RANK`)
    }
    if (!numOrNull(c.sourceAgeH)) p.push(`${at}:SOURCE_AGE`)
    else if (c.freshnessBand !== observationBucketOf(c.sourceAgeH as number | null)) p.push(`${at}:BAND`)
    const sel = c.reason === 'SELECTED_COVER' || c.reason === 'SELECTED_EXTRA'
    if (c.selected !== (c.position !== null) || (c.reason !== 'TRACE_MISMATCH' && c.selected !== sel)) p.push(`${at}:SELECTED`)
    if (c.selected === true && c.reason !== 'TRACE_MISMATCH' && c.assignedSlot === null) p.push(`${at}:ASSIGNED`)
  })
  if (p.length > 0) return { ok: false, problems: p }
  const cs = raw.candidates as TraceCandidate[]
  const hashes = cs.map((c) => c.sourceHash)
  if (new Set(hashes).size !== hashes.length) p.push('DUPLICATE_SOURCE')
  if (hashes.some((h, i) => i > 0 && hashes[i - 1]! >= h)) p.push('ORDER')
  if (!isObj(raw.summary) || typeof raw.summary.identityMissing !== 'number') p.push('SUMMARY')
  else {
    const again = summarizeTrace(cs, raw.summary.identityMissing, { takenAt: raw.takenAt as string, slots: slots!, cap: raw.cap as number })
    if (JSON.stringify(raw.summary) !== JSON.stringify(again)) p.push('SUMMARY_MISMATCH')
    const f = raw.facts as JitSelectionFacts
    if (f.maxFillableSlots !== again.maxFillableSlots || f.coverTarget !== again.coverTarget
      || f.coveredSlots !== again.coveredSlots || f.retryReserved !== again.retryReserved
      || f.rawExcluded !== again.rawExcluded || f.slots !== n) p.push('FACTS_MISMATCH')
  }
  return p.length > 0 ? { ok: false, problems: p } : { ok: true, version: 'v2', trace: raw as unknown as SupplySelectionTrace }
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
    if (!back.ok || back.version !== 'v2') return { ok: false, stage: 'verify', error: back.ok ? 'VERSION' : back.problems.slice(0, 5).join(',') }
  } catch (e) {
    return { ok: false, stage: 'verify', error: e instanceof Error ? e.name : 'unknown' }
  }
  if (input.write === null) return { ok: true, trace, written: false }
  try { input.write(body) } catch (e) {
    return { ok: false, stage: 'write', error: e instanceof Error ? e.name : 'unknown' }
  }
  return { ok: true, trace, written: true }
}
