/**
 * 🔴 **다음 단계 추가 댓글 profile 후보 — D10 실측에서만 산출한다** (2026-10-15 · D20 준비 · CURRENT C-20)
 *
 *   순수 함수다. DB · 파일 · env · 시각 조회 0 — 실측은 부르는 쪽(`scripts/d20-readiness.mts`)이 정본 판독기로 읽어 넣는다.
 *
 * 🔴 **값을 지어내지 않는다.** D10 증명일 운영 증거가 PASS 가 아니거나, 그날 추가 댓글 비용이 정산되지 않았거나,
 *    추가 댓글이 0건이라 단가를 잴 수 없으면 후보를 내지 않는다(UNKNOWN). 추정 · 할증 · 최솟값 없음.
 * 🔴 **산출물은 승인 전 후보다** — `approvedBy` · `approvedAt` 이 null 이라 `validateFollowupProfile` 이 거부한다
 *    (그날 추가 댓글 0건 · fail-closed). 창업자 승인이 들어간 파일만 설치된다.
 * 🔴 첫 댓글 예산이 먼저다 — 그날 첫 댓글(글마다 1건) 비용 + 추가 댓글 한도가 댓글 장부 하루 상한을 넘으면
 *    BLOCK(`COMMENT_BUDGET_SHORT`) — 상한을 올릴지는 창업자 비용 결정이다. 코드가 상한을 고치지 않는다.
 *
 * 식 (단계 S = 다음 단계 · 직전 단계 P = 실측 단계)
 * ```
 *   dailyCount(S)         = 하루 목표 글(S) × 글당 추가 상한(FOLLOWUP_EXTRA_PER_POST_MAX = 4)       — P profile 과 같은 규칙
 *   usdPerAccepted(P)     = P 증명일 추가 댓글 정산 USD 합 / 그날 실제 발행된 추가 댓글 수           — 실패 · 버린 요청 비용 포함
 *   dailyUsd(S)           = dailyCount(S) × usdPerAccepted(P)                                       — 0.0001 USD 올림(표기)
 *   runMax(S)             = max(runMax(P), ⌈dailyCount(S) / 하루 댓글 러너 회차⌉)
 *   perPersonaDailyMax(S) = max(perPersonaDailyMax(P), ⌈dailyCount(S) / 계약 유효 Persona⌉)
 *   첫 댓글 예산          = 하루 목표 글(S) × (P 첫 댓글 정산 USD 합 / P 실제 공개 첫 댓글 수)
 *                           — 분모는 정본 증거 `firstCommentOk`(자동 출처 · 60분 안 첫 댓글이 붙은 글). 장부 정산 요청 수가
 *                             아니다(재시도 · 실패 요청이 섞이면 단가가 낮게 잡힌다)
 *   예산 판정             = 첫 댓글 예산 + dailyUsd(S) ≤ 댓글 장부 하루 상한
 * ```
 */
import {
  FOLLOWUP_EXTRA_PER_POST_MAX, FOLLOWUP_PROFILE_VERSION, validateFollowupProfile, type FollowupProfile,
} from './persona-comment-followup'

/** 🔴 한 단계(P) 증명일 하루의 실측 — 정본 판독기 결과만 넣는다 */
export type FollowupMeasure = {
  /** 실측 단계 (지금은 'd10') */
  stage: string
  /** KST 날짜 */
  kstDate: string
  /** 🔴 그날 운영 증거 판정(`judgeStageEvidence`) — 'PASS' 일 때만 쓴다 */
  evidenceVerdict: string
  /** 그날 설치돼 있던 profile 원본(파일 JSON) */
  installedProfile: unknown
  /** 장부 `commentFollowupGen` — 정산 줄 수 · 정산 USD 합 · 미정산(예약만) 줄 수 */
  followup: { settled: number; settledUsd: number; open: number }
  /** 장부 `commentGen` — 첫 댓글 provider 요청(재시도 · 실패 포함) */
  first: { settled: number; settledUsd: number; open: number }
  /** 🔴 그날 실제 공개된 provenance-valid 첫 댓글 수 — 정본 증거 `counts.firstCommentOk`. 모르면 null */
  acceptedFirstComments: number | null
  /** 🔴 그날 실제로 발행된 추가 댓글 수(큐 → 공개 댓글 행) */
  acceptedFollowups: number
}

export type FollowupDeriveCode =
  | 'MEASURE_MISSING' | 'MEASURE_NOT_PASS' | 'MEASURE_PROFILE_INVALID'
  | 'COST_UNSETTLED' | 'FOLLOWUP_UNMEASURED' | 'FIRST_UNMEASURED'
  | 'PERSONA_UNKNOWN' | 'COMMENT_CAP_UNKNOWN' | 'COMMENT_BUDGET_SHORT'

/** 🔴 BLOCK 은 사람 결정 · 앞 단계 재증명이 필요한 것 — 나머지는 모름(UNKNOWN) */
const BLOCKING: readonly FollowupDeriveCode[] = ['MEASURE_NOT_PASS', 'MEASURE_PROFILE_INVALID', 'COMMENT_BUDGET_SHORT']

export type FollowupCandidate = Omit<FollowupProfile, 'approvedBy' | 'approvedAt'> & { approvedBy: null; approvedAt: null }

export type FollowupDerive = {
  verdict: 'CANDIDATE' | 'UNKNOWN' | 'BLOCK'
  codes: FollowupDeriveCode[]
  candidate: FollowupCandidate | null
  counts: Record<string, number>
}

const ceil4 = (x: number): number => Math.ceil(x * 10_000) / 10_000

export function deriveFollowupProfile(i: {
  measure: FollowupMeasure | null
  /** 다음 단계 이름(`d20`)과 하루 목표 글 */
  targetStage: string
  targetDailyPosts: number
  /** 하루 댓글 러너 회차(`RUNNER_GRID.commentSlots.length`) */
  commentRunsPerDay: number
  /** 계약 유효 Persona — 모르면 null */
  contractValidPersonas: number | null
  /** 댓글 장부 하루 상한(USD) — 모르면 null */
  commentDailyUsdCap: number | null
}): FollowupDerive {
  const codes = new Set<FollowupDeriveCode>()
  const counts: Record<string, number> = {}
  const dailyCount = i.targetDailyPosts * FOLLOWUP_EXTRA_PER_POST_MAX
  counts.dailyCount = dailyCount
  const out = (candidate: FollowupCandidate | null): FollowupDerive => {
    const list = [...codes]
    const verdict = list.some((c) => BLOCKING.includes(c)) ? 'BLOCK' : list.length > 0 || candidate === null ? 'UNKNOWN' : 'CANDIDATE'
    return { verdict, codes: list, candidate: verdict === 'CANDIDATE' ? candidate : null, counts }
  }
  const m = i.measure
  if (m === null) { codes.add('MEASURE_MISSING'); return out(null) }
  if (m.evidenceVerdict !== 'PASS') codes.add('MEASURE_NOT_PASS')
  const base = validateFollowupProfile(m.installedProfile, m.stage)
  if (!base.ok) codes.add('MEASURE_PROFILE_INVALID')
  // 🔴 미정산을 추정으로 정산하지 않는다
  if (m.followup.open > 0 || m.first.open > 0) codes.add('COST_UNSETTLED')
  if (!(m.followup.settled > 0) || !(m.acceptedFollowups > 0) || !(m.followup.settledUsd > 0)) codes.add('FOLLOWUP_UNMEASURED')
  if (m.acceptedFirstComments === null || !(m.acceptedFirstComments > 0) || !(m.first.settledUsd > 0)) codes.add('FIRST_UNMEASURED')
  if (i.contractValidPersonas === null || !(i.contractValidPersonas > 0)) codes.add('PERSONA_UNKNOWN')
  if (i.commentDailyUsdCap === null || !(i.commentDailyUsdCap > 0)) codes.add('COMMENT_CAP_UNKNOWN')
  if (!base.ok || codes.has('FOLLOWUP_UNMEASURED') || codes.has('PERSONA_UNKNOWN')) return out(null)

  const usdPerAccepted = m.followup.settledUsd / m.acceptedFollowups
  const dailyUsd = ceil4(dailyCount * usdPerAccepted)
  const runMax = Math.max(base.profile.runMax, Math.ceil(dailyCount / Math.max(1, i.commentRunsPerDay)))
  const perPersonaDailyMax = Math.max(base.profile.perPersonaDailyMax, Math.ceil(dailyCount / i.contractValidPersonas!))
  Object.assign(counts, { usdPerAccepted, dailyUsd, runMax, perPersonaDailyMax })
  if (!codes.has('FIRST_UNMEASURED') && i.commentDailyUsdCap !== null && i.commentDailyUsdCap > 0) {
    const firstUsd = i.targetDailyPosts * (m.first.settledUsd / m.acceptedFirstComments!)
    counts.firstCommentUsd = firstUsd
    counts.commentUsdNeeded = firstUsd + dailyUsd
    counts.commentDailyUsdCap = i.commentDailyUsdCap
    if (firstUsd + dailyUsd > i.commentDailyUsdCap) codes.add('COMMENT_BUDGET_SHORT')
  }
  return out({
    v: FOLLOWUP_PROFILE_VERSION, stage: i.targetStage, dailyCount, dailyUsd, runMax, perPersonaDailyMax,
    approvedBy: null, approvedAt: null,
  })
}
