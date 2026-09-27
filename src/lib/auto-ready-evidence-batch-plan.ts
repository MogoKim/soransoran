/**
 * 🔴 **자동 READY 증거 배치 검토 — 화면의 제출 계획 (순수 · DB 0 · 네트워크 0)** (2026-09-27 운영 P0)
 *
 * 왜 이 파일이 있는가 — 운영자가 실제로 겪은 결함이다.
 *   · 제출 뒤에도 입력·확인 UI 가 그대로라 성공했는지 알 수 없었다
 *   · 이미 처리된 행이 같은 결정 입력을 그대로 들고 다시 제출됐다
 *   · 중대 결함을 비운 행까지 **전부** 서버로 가서 "건너뜀" 결과만 쌓였다
 *   · 그래서 운영자가 같은 버튼을 여러 번 눌렀다
 *
 * 🔴 그래서 "무엇을 보낼지" 를 화면 밖 **순수 함수 하나**로 정한다. 화면은 이 계획의 `send` 만 보낸다.
 *    · 손대지 않은 행은 **보내지 않는다** (건너뜀 결과도 만들지 않는다)
 *    · 손댄 행에 빈칸·모순이 있으면 **막는다**(blocking) — 막힌 행이 하나라도 있으면 CTA 가 닫힌다
 *    · 서버의 지금 상태(authoritative)가 없거나 기록 대상이 아닌 행은 **입력 자체가 없다**(fail-closed)
 *    · 이미 이 사람이 기록한 행(`recorded`) · 이번 화면에서 성공한 행은 **기본으로 잠긴다**
 *    · 🔴 **재검토**(2026-09-27 P0 정정) — 잠긴 `recorded` 행은 운영자가 `재검토` 를 **명시적으로** 눌렀을 때만
 *      중대 결함 · 근거 칸이 다시 열린다(`reviewing`). 서버 계약은 같은 사람의 판정 변경을 append-only 로
 *      받는다 — 화면이 영구 잠금이면 "결함 없음" 을 잘못 누른 운영자가 고쳐서 철회할 길이 없다.
 *      재검토에서도 ready · reject 결정 칸은 **절대 다시 열리지 않는다**(결정은 한 번뿐). 성공하면 다시 잠긴다.
 * 🔴 결정 전 그림자(`undecided`)만 ready · reject 를 고른다. 이미 결정된 행(`decided`)에는
 *    결정 칸이 **없다** — 들어와도 계획이 버린다(결정을 바꾸지 않는다 · 폐기된 글을 다시 폐기하지 않는다).
 * 🔴 서버(`recordHumanBatch`)도 같은 규칙을 다시 잰다. 이 파일은 화면의 1차 방어이지 정본 경계가 아니다.
 */
import { DECLINE_REASONS } from './original-post-decision'

/** 행 입력 — 화면 칸 그대로(문자열). 비어 있으면 '' */
export type Entry = {
  decision: '' | 'ready' | 'reject'
  declineReason: string
  hardDefect: '' | 'no' | 'yes'
  reasons: string
  withdraw: boolean
}

export const EMPTY_ENTRY: Entry = { decision: '', declineReason: '', hardDefect: '', reasons: '', withdraw: false }

/**
 * 🔴 서버가 DB 에서 다시 읽은 **지금** 행 상태 — 화면은 이 값으로만 입력 칸을 정한다.
 *    · undecided   결정 전 그림자(machine:*) · 미발행 — ready · reject 결정 + 결함 기록
 *    · decided     사람 결정 표식 — 결정은 바꾸지 않는다. 결함 기록만(미발행 승인 + yes 는 철회 동반)
 *    · recorded    이미 결정됐고 **이 사용자의 지금 결속에 맞는 기록**이 있다 — 잠금
 *    · stale       묶음을 만든 뒤 DB 초안이 바뀌었다 — 새 묶음이 필요하다
 *    · missing     DB 에 행이 없다
 *    · unsupported 이 경계가 받지 않는 행(기계 후보 아님 · 다른 결정 경로 · 받지 않는 상태)
 */
export const ROW_PHASES = ['undecided', 'decided', 'recorded', 'stale', 'missing', 'unsupported'] as const
export type RowPhase = (typeof ROW_PHASES)[number]

export type MyReview = { hardDefect: 'yes' | 'no' | 'unmeasured'; reasons: string[]; reviewedAt: string; bundleDigest: string }

export type EvidenceRowState = {
  queueId: string
  phase: RowPhase
  status: string | null
  decidedBy: string | null
  published: boolean
  outcome: 'noEdit' | 'edited' | 'declined' | null
  declineReason: string | null
  /** 🔴 이 사용자의 지금 결속에 맞는 최신 사람 기록 — 없으면 null */
  mine: MyReview | null
  why: string
}

/** 서버로 가는 한 줄 — 서버 액션이 읽는 여섯 칸 그대로다 */
export type SendEntry = {
  queueId: string
  decision: 'ready' | 'reject' | null
  declineReason: string | null
  hardDefect: 'yes' | 'no'
  reasons: string[]
  withdraw: boolean
}

export type Blocking = { queueId: string; why: string }

export type BatchPlan = {
  send: SendEntry[]
  blocking: Blocking[]
  /** 손대지 않아 보내지 않는 행 수 */
  untouched: number
  /** 잠겨서(기록됨 · 입력 없음) 보내지 않는 행 수 */
  locked: number
}

/** 🔴 입력 칸 종류 — `decide`(결정 + 결함) · `record`(결함만) · null(입력 없음 · 잠금) */
export type Editable = 'decide' | 'record' | null

const NO_IDS: ReadonlySet<string> = new Set()

export function editableOf(
  state: EvidenceRowState | undefined, lockedIds: ReadonlySet<string>, reviewing: ReadonlySet<string> = NO_IDS,
): Editable {
  if (state === undefined) return null
  // 🔴 재검토는 `recorded` 행에서만 · 결함 기록(record)만 연다 — 결정 칸(decide)은 없다
  if (state.phase === 'recorded' && reviewing.has(state.queueId)) return 'record'
  if (lockedIds.has(state.queueId)) return null
  if (state.phase === 'undecided') return 'decide'
  if (state.phase === 'decided') return 'record'
  return null
}

/** 미발행 승인 글 — 결함 yes 면 철회와 사유가 함께 있어야 한다(서버 계약 그대로) */
export const isOpenApproved = (s: EvidenceRowState): boolean =>
  !s.published && (s.status === 'APPROVED' || s.status === 'EDITED')

const reasonLines = (t: string): string[] => t.split('\n').map((x) => x.trim()).filter(Boolean)
const isDeclineCode = (v: string): boolean => DECLINE_REASONS.some((r) => r.code === v)

/** 🔴 손댔는가 — 결정 · 결함 · 근거 · 철회 중 하나라도 */
export function isTouched(editable: Editable, e: Entry): boolean {
  if (editable === null) return false
  return (editable === 'decide' && e.decision !== '') || e.hardDefect !== '' || reasonLines(e.reasons).length > 0
    || (editable === 'record' && e.withdraw)
}

/**
 * 🔴 한 행의 막힘 사유 — 손대지 않았으면 null(보내지 않을 뿐 막지 않는다).
 *    손댔다면 서버가 거절할 조합을 **보내기 전에** 막는다.
 */
export function rowIssue(
  state: EvidenceRowState | undefined, e: Entry, lockedIds: ReadonlySet<string>, reviewing: ReadonlySet<string> = NO_IDS,
): string | null {
  const ed = editableOf(state, lockedIds, reviewing)
  if (ed === null || state === undefined || !isTouched(ed, e)) return null
  const reasons = reasonLines(e.reasons)
  if (ed === 'decide') {
    if (e.decision === '') return '결정 전 행입니다 — "그대로 내보낸다" 또는 "폐기" 를 골라야 기록됩니다'
    if (e.hardDefect === '') return '중대 결함 "있음" · "없음" 중 하나를 골라 주세요'
    if (e.decision === 'reject' && !isDeclineCode(e.declineReason)) return '폐기 사유를 골라 주세요'
    if (e.decision === 'ready' && e.hardDefect === 'yes') return '결함이 있으면 그대로 내보낼 수 없습니다 — 폐기를 고르세요'
    if (e.hardDefect === 'yes' && reasons.length === 0) return '결함 있음이면 근거를 한 줄 이상 적어 주세요'
    return null
  }
  if (e.hardDefect === '') return '중대 결함 "있음" · "없음" 중 하나를 골라 주세요'
  if (e.hardDefect === 'yes' && reasons.length === 0) return '결함 있음이면 근거를 한 줄 이상 적어 주세요'
  if (isOpenApproved(state) && e.hardDefect === 'yes') {
    if (!e.withdraw) return '미발행 승인 글에 결함 있음 — 철회와 철회 사유를 함께 골라야 기록됩니다'
    if (!isDeclineCode(e.declineReason)) return '철회 사유를 골라 주세요'
  }
  return null
}

/**
 * 🔴 **제출 계획** — 화면은 이 결과의 `send` 만 보낸다.
 *    `send` 가 비었거나 `blocking` 이 하나라도 있으면 CTA 는 닫힌다(`canSubmit`).
 */
export function planBatch(
  queueIds: readonly string[],
  states: ReadonlyMap<string, EvidenceRowState>,
  entries: Readonly<Record<string, Entry>>,
  lockedIds: ReadonlySet<string>,
  reviewing: ReadonlySet<string> = NO_IDS,
): BatchPlan {
  const send: SendEntry[] = []
  const blocking: Blocking[] = []
  let untouched = 0
  let locked = 0
  for (const id of queueIds) {
    const s = states.get(id)
    const e = entries[id] ?? EMPTY_ENTRY
    const ed = editableOf(s, lockedIds, reviewing)
    if (ed === null || s === undefined) { locked += 1; continue }
    if (!isTouched(ed, e)) { untouched += 1; continue }
    const why = rowIssue(s, e, lockedIds, reviewing)
    if (why !== null) { blocking.push({ queueId: id, why }); continue }
    if (e.hardDefect === '') { blocking.push({ queueId: id, why: '중대 결함을 골라 주세요' }); continue }
    // 🔴 결정 칸은 결정 전 행에서만 보낸다. 철회는 미발행 승인 + 결함 yes 에서만 보낸다
    const decision = ed === 'decide' && e.decision !== '' ? e.decision : null
    const withdraw = ed === 'record' && isOpenApproved(s) && e.hardDefect === 'yes' && e.withdraw
    send.push({
      queueId: id, decision,
      declineReason: decision === 'reject' || withdraw ? e.declineReason : null,
      hardDefect: e.hardDefect, reasons: reasonLines(e.reasons), withdraw,
    })
  }
  return { send, blocking, untouched, locked }
}

export const canSubmit = (p: BatchPlan): boolean => p.send.length > 0 && p.blocking.length === 0

/** 서버 결과 한 줄 — `HumanBatchResult` 와 같은 모양 */
export type RowResult = { queueId: string; result: string; why: string }

/** 🔴 결과는 세 가지로만 보인다 — 성공 · 건너뜀 · 거절 */
export type ResultTone = '성공' | '건너뜀' | '거절'
export const SUCCESS_RESULTS = ['recorded', 'decidedAndRecorded', 'withdrawnAndRecorded', 'unchanged'] as const

export function toneOf(result: string): ResultTone {
  if ((SUCCESS_RESULTS as readonly string[]).includes(result)) return '성공'
  if (result === 'skip') return '건너뜀'
  return '거절'
}

export function resultLabel(r: RowResult): string {
  switch (r.result) {
    case 'decidedAndRecorded': return '결정과 기록을 저장했습니다'
    case 'withdrawnAndRecorded': return '철회하고 기록을 저장했습니다'
    case 'recorded': return '기록을 저장했습니다'
    case 'unchanged': return '이미 기록되어 있습니다 — 새로 쓰지 않았습니다'
    case 'skip': return r.why === '' ? '건너뛰었습니다' : r.why
    default: return r.why === '' ? '거절됐습니다' : r.why
  }
}

/** 🔴 성공한 행은 잠근다 — 다음 계획에서 보내지 않는다 */
export function lockAfter(prev: ReadonlySet<string>, results: readonly RowResult[]): Set<string> {
  const next = new Set(prev)
  for (const r of results) if (toneOf(r.result) === '성공') next.add(r.queueId)
  return next
}

/** 🔴 `재검토` 버튼을 보이는가 — 잠긴 `recorded` 행이고 아직 재검토 중이 아닐 때만 */
export const canReview = (state: EvidenceRowState | undefined, reviewing: ReadonlySet<string>): boolean =>
  state !== undefined && state.phase === 'recorded' && !reviewing.has(state.queueId)

/** 🔴 성공한 행은 재검토를 닫는다 — 다시 잠기고 최신 판정만 보인다 */
export function reviewingAfter(prev: ReadonlySet<string>, results: readonly RowResult[]): Set<string> {
  const next = new Set(prev)
  for (const r of results) if (toneOf(r.result) === '성공') next.delete(r.queueId)
  return next
}

/** 확인 단계에 보이는 한 줄 — 무엇을 기록하는지 사람이 읽는 문장 */
export function describeSend(s: SendEntry): string {
  const reasonLabel = (code: string | null): string => DECLINE_REASONS.find((r) => r.code === code)?.label ?? String(code)
  const parts: string[] = []
  if (s.decision === 'ready') parts.push('결정: 그대로 내보낸다')
  if (s.decision === 'reject') parts.push(`결정: 폐기 (${reasonLabel(s.declineReason)})`)
  if (s.withdraw) parts.push(`철회 (${reasonLabel(s.declineReason)})`)
  parts.push(`중대 결함: ${s.hardDefect === 'yes' ? '있음' : '없음'}`)
  if (s.reasons.length > 0) parts.push(`근거 ${s.reasons.length}줄`)
  return parts.join(' · ')
}

export function phaseLabel(s: EvidenceRowState): string {
  switch (s.phase) {
    case 'undecided': return '결정 전'
    case 'decided': return '결정됨'
    case 'recorded': return '결정됨 · 내 기록 있음'
    case 'stale': return '묶음 이후 초안이 바뀜'
    case 'missing': return 'DB 에 없음'
    default: return '이 화면에서 기록하지 않음'
  }
}
