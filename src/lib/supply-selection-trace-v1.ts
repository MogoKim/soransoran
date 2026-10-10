/**
 * 🔴 **공급 선택 trace v1 — 읽기 전용** (2026-10-10 P0-B1에서 분리)
 *
 *   v1 은 P0-B0(2026-10-10 08:15 · 12:15 자연 회차)가 남긴 판이다 — 그때 선택은 EDF 짝짓기 → 축 자리 · 재시도 예약석이었다.
 *   P0-B1 부터 새 회차는 v2(`supply-selection-trace.ts`)만 쓴다. 이 파일은 **이미 남은 v1 기록을 계속 읽기 위해서만** 있다 —
 *   만드는 함수가 없다. 판정 · 요약 · shadow 재계산은 v1 이 쓰인 그대로다(손상 · 누락을 정상으로 읽지 않는다).
 */
import { compareReleaseRank, observationBucketOf } from './source-slot-release'

/** v1 묶음 선택 단계 이름(그때의 `WORKSET_SELECT_STEPS`) — 읽기 검증에만 쓴다 */
export const V1_SELECT_STEPS = [
  'SLOT_UNASSIGNED', 'AXIS_QUOTA_ZERO', 'AXIS_QUOTA_FULL',
  'RETRY_RESERVED', 'RETRY_FILLED', 'RETRY_LIMIT_CUT',
  'FRESH_PICKED', 'FRESH_DISPLACED_BY_RETRY_RESERVE', 'FRESH_RANK_CUT',
] as const
export type V1SelectStep = (typeof V1_SELECT_STEPS)[number]

export const SELECTION_TRACE_KIND_V1 = 'supply-selection-trace'
export const SELECTION_TRACE_VERSION_V1 = 'selection-trace-v1'

/**
 * 🔴 **슬롯 짝짓기 단계 결과.**
 *    `NOT_REACHED`     생성 가능 판정에서 이미 빠졌다
 *    `NOT_APPLICABLE`  JIT 묶음이 아니다(배정 없이 고른 옛 판)
 *    `ASSIGNED`        부족 슬롯 하나에 배정됐다
 *    `UNLINKABLE`      부족 슬롯 어디에서도 eligible 이 아니다
 *    `NOT_MATCHED`     연결 가능한 슬롯이 있었지만 짝(EDF)에 들지 못했다
 *    `CAP_CUT`         짝에 들었지만 유료 상한(cap)에 잘렸다
 */
export const TRACE_EDF_STAGES_V1 = ['NOT_REACHED', 'NOT_APPLICABLE', 'ASSIGNED', 'UNLINKABLE', 'NOT_MATCHED', 'CAP_CUT'] as const
export type TraceEdfStageV1 = (typeof TRACE_EDF_STAGES_V1)[number]

/** 🔴 **최종 사유 하나** — 처음 멈춘 단계의 원인. 다른 원인을 한 값으로 합치지 않는다 */
export const TRACE_REASONS_V1 = [
  'HUMAN_DECIDED', 'QUEUE_SIBLING', 'ALREADY_QUEUED', 'CARRIED_OVER', 'TERMINAL', 'HARD_BLOCKED', 'PRE_GATED',
  'SLOT_INELIGIBLE', 'EVIDENCE_UNKNOWN',
  'SLOT_UNLINKABLE', 'EDF_NOT_MATCHED', 'EDF_CAP_CUT',
  'AXIS_QUOTA_ZERO', 'AXIS_QUOTA_FULL',
  'FRESH_DISPLACED_BY_RETRY_RESERVE', 'FRESH_RANK_CUT', 'RETRY_LIMIT_CUT',
  'SELECTED_FRESH', 'SELECTED_RETRY_RESERVED', 'SELECTED_RETRY_FILLED',
  /** 🔴 기록끼리 맞지 않는다(배정 없이 골랐다 · 단계 기록 없음 · 같은 원천 두 번) — 정상 결과로 세지 않는다 */
  'TRACE_MISMATCH',
] as const
export type TraceReasonV1 = (typeof TRACE_REASONS_V1)[number]

/** 🔴 지금 공급 순위(`compareReleaseRank`)가 실제로 쓰는 성분 그대로 — 새 점수가 아니다 */
export type TraceRankV1 = { commentsPct: number | null; viewsPct: number | null; ageAtSlotH: number | null; velocity: number | null }

export type TraceCandidateV1 = {
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
  edf: TraceEdfStageV1
  selectStep: V1SelectStep | null
  /** 🔴 지금 비교기가 받은 값 그대로 — `ageAtSlotH` 는 정본 판정이 0.001h 로 반올림한 값이다(기존 동작) */
  rank: TraceRankV1 | null
  /** 🔴 판정 슬롯에서의 **원래** 원문 나이(h · 반올림 없음) — 신선도 구간 · EDF 나이 비교는 이 값으로 한다 */
  sourceAgeH: number | null
  /** 정본 관측 나이 구간(`observationBucketOf(sourceAgeH)`) — 나이를 모르면 null */
  freshnessBand: string | null
  selected: boolean
  /** 최종 묶음 안 순서(0부터) — 고르지 않았으면 null */
  position: number | null
  reason: TraceReasonV1
  menopauseCore: boolean
  wgangSource: boolean
}

type Count = { candidates: number; selected: number }
export type TraceSummaryV1 = {
  /** 사이트나 id 를 몰라 열쇠가 없는 행 — 후보 기록에 들어가지 못한다 */
  identityMissing: number
  candidates: number
  selected: number
  fresh: Count
  retry: Count
  menopauseCore: Count
  wgang: Count
  menopauseWgang: Count
  byReason: Record<TraceReasonV1, number>
  menopauseByReason: Record<TraceReasonV1, number>
  wgangByReason: Record<TraceReasonV1, number>
  /** 🔴 배정된 원천 중, 같은 슬롯에 연결 가능했는데 짝에 못 든 **더 어린** 원천이 있는 수 */
  edfOlderOverFresher: number
  freshDisplacedByRetryReserve: number
  axisQuotaDropped: number
  mismatches: number
}

export type ShadowVerdictV1 = 'COMPUTED' | 'NO_STRICT_TIE' | 'UNKNOWN' | 'NO_CANDIDATE'
/**
 * 🔴 **정본 순위 shadow — 세기만 한다.** 모집단은 슬롯 판정까지 eligible 인 후보.
 *    같은 `(commentsPct, viewsPct)` · 같은 신선도 구간끼리만 동률이다(새 허용 오차 · 구간 없음).
 *    `qualityUnknown` 은 0 이나 "효과 없음" 으로 바꾸지 않는다.
 */
export type TraceShadowV1 = {
  population: number
  qualityUnknown: number
  noStrictTie: number
  strictTieGroups: number
  strictTieCandidates: number
  menopauseCouldReorder: number
  wgangCouldReorder: number
  menopause: ShadowVerdictV1
  wgang: ShadowVerdictV1
}

export type SupplySelectionTraceV1 = {
  kind: typeof SELECTION_TRACE_KIND_V1
  version: typeof SELECTION_TRACE_VERSION_V1
  runId: string
  takenAt: string
  limit: number
  cap: number
  jit: boolean
  slots: string[]
  /** 🔴 최종 묶음 파일 내용의 digest — 이 trace 가 어느 묶음을 설명하는지 */
  worksetDigest: string
  candidates: TraceCandidateV1[]
  summary: TraceSummaryV1
  shadow: TraceShadowV1
}

// ─────────────────────────────────────────────────────────
// 요약 · shadow — 🔴 후보 기록만으로 다시 계산된다(읽는 쪽이 대조한다)
// ─────────────────────────────────────────────────────────

const zeroReasons = (): Record<TraceReasonV1, number> =>
  Object.fromEntries(TRACE_REASONS_V1.map((r) => [r, 0])) as Record<TraceReasonV1, number>

export function summarizeTraceV1(cs: readonly TraceCandidateV1[], identityMissing: number): TraceSummaryV1 {
  const count = (f: (c: TraceCandidateV1) => boolean): Count => ({
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
const currentOrder = (a: TraceCandidateV1, b: TraceCandidateV1): number =>
  compareReleaseRank({ ...a.rank!, tieBreak: '' }, { ...b.rank!, tieBreak: '' })
  || (a.sourceHash < b.sourceHash ? -1 : a.sourceHash > b.sourceHash ? 1 : 0)

export function shadowOfV1(cs: readonly TraceCandidateV1[]): TraceShadowV1 {
  const pop = cs.filter((c) => c.edf !== 'NOT_REACHED' && c.rank !== null)
  const known = pop.filter((c) => c.rank!.commentsPct !== null && c.rank!.viewsPct !== null && c.freshnessBand !== null)
  const groups = new Map<string, TraceCandidateV1[]>()
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
  const verdict = (): ShadowVerdictV1 => {
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

export type SelectionTraceReadV1 = { ok: true; trace: SupplySelectionTraceV1 } | { ok: false; problems: string[] }

export function readSupplySelectionTraceV1(raw: unknown): SelectionTraceReadV1 {
  const p: string[] = []
  if (!isObj(raw)) return { ok: false, problems: ['NOT_OBJECT'] }
  if (!sameKeys(raw, TOP_KEYS)) p.push('TOP_KEYS')
  if (raw.kind !== SELECTION_TRACE_KIND_V1) p.push('KIND')
  if (raw.version !== SELECTION_TRACE_VERSION_V1) p.push('VERSION')
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
    if (!(TRACE_EDF_STAGES_V1 as readonly unknown[]).includes(c.edf)) p.push(`${at}:EDF`)
    if (c.selectStep !== null && !(V1_SELECT_STEPS as readonly unknown[]).includes(c.selectStep)) p.push(`${at}:STEP`)
    if (!(TRACE_REASONS_V1 as readonly unknown[]).includes(c.reason)) p.push(`${at}:REASON`)
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
  const cs = raw.candidates as TraceCandidateV1[]
  const hashes = cs.map((c) => c.sourceHash)
  if (new Set(hashes).size !== hashes.length) p.push('DUPLICATE_SOURCE')
  if (hashes.some((h, i) => i > 0 && hashes[i - 1]! >= h)) p.push('ORDER')
  if (!isObj(raw.summary) || typeof raw.summary.identityMissing !== 'number') p.push('SUMMARY')
  else if (JSON.stringify(raw.summary) !== JSON.stringify(summarizeTraceV1(cs, raw.summary.identityMissing))) p.push('SUMMARY_MISMATCH')
  if (JSON.stringify(raw.shadow) !== JSON.stringify(shadowOfV1(cs))) p.push('SHADOW_MISMATCH')
  return p.length > 0 ? { ok: false, problems: p } : { ok: true, trace: raw as unknown as SupplySelectionTraceV1 }
}
