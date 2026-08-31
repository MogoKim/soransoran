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
