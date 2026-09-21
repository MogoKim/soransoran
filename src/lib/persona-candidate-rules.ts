/**
 * 승인 대기열 상태 전환 규칙 — 🔴 순수 함수. DB · 세션 · 네트워크 없음
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §13
 *
 * 🔴 규칙을 server action 안에 두지 않는다.
 *    거기 두면 DB 없이는 검증할 수 없고, 검증할 수 없는 규칙은 조용히 깨진다.
 *    여기 있으면 fixture 가 전이표를 전수로 확인한다.
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다.
 */

/** 대기열 상태 — Prisma enum PersonaCandidateStatus 와 같은 값 */
export type CandidateStatus =
  | 'PENDING' | 'APPROVED' | 'EDITED' | 'DECLINED' | 'PUBLISHED' | 'EXPIRED'

/** 사람이 내리는 결정 — 🔴 PUBLISHED 는 여기 없다 */
export type CandidateDecision = 'approve' | 'decline'

/**
 * 폐기 사유 코드.
 *
 * 🔴 자유 텍스트가 아니라 코드인 이유 — 집계되지 않으면 개선 근거가 되지 못한다.
 *    특히 앞의 둘은 **"Gate 가 통과시켰는데 사람이 걸러낸 것"** 이라
 *    그대로 Gate 보강 대상이 된다. 대기열이 계측 장치인 이유가 여기 있다.
 */
export const DECLINE_REASONS = [
  { code: 'GATE_MISS_SAFETY', label: 'Gate 통과했으나 안전 문제 (유출 · 식별 · 조언)' },
  { code: 'GATE_MISS_AI_TONE', label: 'Gate 통과했으나 AI 티 — 사람 글로 안 읽힘' },
  { code: 'PERSONA_MISMATCH', label: '페르소나 설정과 맞지 않음' },
  { code: 'CONTEXT_MISMATCH', label: '글 맥락과 맞지 않음' },
  { code: 'REDUNDANT', label: '이미 비슷한 반응이 달려 있음' },
  { code: 'LOW_VALUE', label: '틀리진 않으나 굳이 달 필요 없음' },
  { code: 'OTHER', label: '기타' },
] as const

export type DeclineReasonCode = (typeof DECLINE_REASONS)[number]['code']

const DECLINE_CODE_SET: ReadonlySet<string> = new Set(DECLINE_REASONS.map((r) => r.code))

export const isDeclineReasonCode = (v: unknown): v is DeclineReasonCode =>
  typeof v === 'string' && DECLINE_CODE_SET.has(v)

/**
 * 🔴 PENDING 만 결정할 수 있다.
 *
 *    이미 결정된 것을 다시 뒤집으면 decidedAt 이 덮어써져
 *    "언제 누가 정했나" 가 사라진다. 되돌리기가 필요하면 그건 별도 기능이지
 *    같은 버튼이 아니다.
 */
export const canDecide = (status: CandidateStatus): boolean => status === 'PENDING'

export type DecisionInput = {
  status: CandidateStatus
  decision: CandidateDecision
  declineReason?: string | null
}

export type DecisionPlan =
  | { ok: true; nextStatus: Extract<CandidateStatus, 'APPROVED' | 'DECLINED'>; declineReason: string | null }
  | { ok: false; error: string }

/**
 * 🔴 **승인해 둔 것을 거둬들이는 전이** (2026-09-21).
 *
 *    `canDecide` 는 `PENDING` 만 허용한다. 그 제한은 옳다 — 같은 버튼으로 결정을
 *    뒤집으면 `decidedAt` 이 덮어써져 "언제 누가 정했나" 가 사라지기 때문이다.
 *
 *    그런데 **승인만 해 두고 아직 공개하지 않은 후보를 거둬들일 길이 없었다.**
 *    실측으로 그런 후보가 둘 있었다: 하나는 화자의 생활사에 없는 경험을 말했고
 *    (`menopauseStatus="전"` 인 사람이 "작년에 겪었다"), 하나는 붙일 글이 없었다
 *    (`targetPostId=null`). 둘 다 공개되면 안 되는데, 공식 경로로는 상태를 바꿀 수
 *    없어 **승인 대기 2건** 으로 계속 세어졌다.
 *
 * 🔴 **결정을 뒤집는 것이 아니라 거둬들이는 것이다.** 그래서 이름도 버튼도 따로 둔다.
 * 🔴 **공개된 것은 거둘 수 없다.** `PUBLISHED` 는 여기서 손대지 않는다 —
 *    이미 나간 댓글을 내리는 일은 삭제 경로이지 이 전이가 아니다.
 * 🔴 **컬럼을 새로 만들지 않는다.** 원래 승인 도장은 `declineReason` 안에 함께 적어
 *    남긴다 — 그래야 "승인했었다" 는 사실이 사라지지 않는다.
 */
export const WITHDRAWABLE_STATUSES = ['APPROVED', 'EDITED'] as const
export type WithdrawableStatus = (typeof WITHDRAWABLE_STATUSES)[number]

export const canWithdraw = (status: CandidateStatus): status is WithdrawableStatus =>
  (WITHDRAWABLE_STATUSES as readonly string[]).includes(status)

/** 🔴 철회 사유 — 폐기 사유와 **같은 코드 집합**을 쓴다. 집계가 갈라지지 않게 */
export type WithdrawInput = {
  status: CandidateStatus
  /** 🔴 이미 공개됐으면 거둘 수 없다 */
  publishedCommentId: string | null
  reason: string
  /** 원래 승인 도장 — 🔴 사라지지 않게 사유 문자열에 함께 적는다 */
  approvedBy: string | null
  approvedAt: Date | null
}

export type WithdrawPlan =
  | { ok: true; nextStatus: Extract<CandidateStatus, 'DECLINED'>; declineReason: string }
  | { ok: false; error: string }

/** 🔴 철회한 것임을 한눈에 알 수 있게 머리를 붙인다 — 사람이 폐기한 것과 구분된다 */
export const WITHDRAW_PREFIX = 'WITHDRAWN'

export function planWithdrawal(input: WithdrawInput): WithdrawPlan {
  if (input.publishedCommentId !== null && input.publishedCommentId !== '') {
    return { ok: false, error: '이미 공개된 댓글입니다. 거둬들일 수 없습니다.' }
  }
  if (!canWithdraw(input.status)) {
    return {
      ok: false,
      error: `승인된 것만 거둬들일 수 있습니다 (${WITHDRAWABLE_STATUSES.join(' · ')}). 현재 ${input.status}`,
    }
  }
  const reason = (input.reason ?? '').trim()
  if (reason === '') return { ok: false, error: '거둬들이는 사유를 선택해 주세요.' }
  // 🔴 코드가 아니면 받지 않는다 — 폐기와 같은 원칙이다
  if (!isDeclineReasonCode(reason)) return { ok: false, error: '알 수 없는 사유입니다.' }
  /**
   * 🔴 **원래 승인 도장을 함께 적는다.** 새 컬럼을 만들 수 없으므로 여기 남긴다 —
   *    이것이 없으면 "승인된 적이 있었다" 는 사실이 통째로 사라진다.
   */
  const stamp = `prev=${input.approvedBy ?? '(모름)'}@${input.approvedAt?.toISOString() ?? '(모름)'}`
  return {
    ok: true, nextStatus: 'DECLINED',
    declineReason: `${WITHDRAW_PREFIX}:${reason}:${stamp}`,
  }
}

/** 🔴 거둬들인 것인가 — 집계가 폐기와 철회를 가를 수 있게 */
export function isWithdrawn(declineReason: string | null): boolean {
  return (declineReason ?? '').startsWith(`${WITHDRAW_PREFIX}:`)
}

/** 🔴 사유 코드만 꺼낸다 — 집계는 이 값을 쓴다 */
export function withdrawReasonCode(declineReason: string | null): DeclineReasonCode | null {
  const raw = declineReason ?? ''
  if (!raw.startsWith(`${WITHDRAW_PREFIX}:`)) return null
  const code = raw.slice(WITHDRAW_PREFIX.length + 1).split(':')[0] ?? ''
  return isDeclineReasonCode(code) ? code : null
}

/**
 * 결정을 검사하고 다음 상태를 낸다.
 *
 * 🔴 여기서 나오는 nextStatus 는 APPROVED · DECLINED 뿐이다.
 *    PUBLISHED 는 사람이 누르는 버튼으로 도달하지 않는다 —
 *    발행은 DB 발행 성공을 확인한 경로만 설정할 수 있다(MicroSeed 와 같은 원칙).
 *    EDITED 는 editedText · editDiff 가 필요해 이번 범위에서 제외했다.
 */
export function planDecision(input: DecisionInput): DecisionPlan {
  if (!canDecide(input.status)) {
    return { ok: false, error: `대기(PENDING) 상태만 결정할 수 있습니다. 현재 ${input.status}` }
  }
  if (input.decision === 'approve') {
    // 🔴 승인은 발행이 아니다. APPROVED 에 머문다
    return { ok: true, nextStatus: 'APPROVED', declineReason: null }
  }
  const reason = (input.declineReason ?? '').trim()
  if (reason === '') return { ok: false, error: '폐기 사유를 선택해 주세요.' }
  // 🔴 코드가 아니면 받지 않는다. 자유 텍스트를 허용하면 집계가 무너진다
  if (!isDeclineReasonCode(reason)) return { ok: false, error: '알 수 없는 폐기 사유입니다.' }
  return { ok: true, nextStatus: 'DECLINED', declineReason: reason }
}
