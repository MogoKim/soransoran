/**
 * 매칭 결과 저장 규칙 — 🔴 순수 함수. DB · 세션 · 네트워크 · 파일 IO 없음
 *
 * 정본: docs/operations/2026-09-02-original-post-lane-strategy.md §5
 *
 * 파이프라인에서 이 파일이 채우는 자리
 *   … → ⑤ Founder Decision → ⑥ Matching **→ 배정 저장(여기) →** ⑦ Persona Publish
 *
 * 🔴 **배정은 발행이 아니다.**
 *    matchedPersonaId 가 채워져도 Post 는 생기지 않는다. createdPostId 는 그대로 비어 있다.
 *    발행 경로는 별도 승인 대상이다.
 *
 * 🔴 **점수를 저장하는 것이 아니라 근거를 저장한다.**
 *    점수는 순수 함수의 산물이라 dry-run 이 언제든 다시 낸다.
 *    다시 낼 수 없는 것은 **그때의 규칙**뿐이고, 그래서 ruleVersion 이 필수다.
 *
 * 🔴 **blockedBy 전문을 담지 않는다.** 누가 왜 탈락했는지는 dry-run 이 다시 낸다 —
 *    담는 것은 "왜 이 사람이었나" 에 답할 최소치뿐이다.
 *
 * 🔴 이 파일은 고객 경로에서 import 되지 않는다. import 가 하나도 없다(fixture 가 강제).
 */

/** 대기열 상태 — Prisma enum OriginalPostCandidateStatus 와 같은 값 */
export const QUEUE_STATUSES = [
  'PENDING', 'APPROVED', 'EDITED', 'DECLINED', 'PUBLISHED', 'EXPIRED',
] as const
export type QueueStatus = (typeof QUEUE_STATUSES)[number]

/**
 * 🔴 배정할 수 있는 상태는 둘뿐이다.
 *
 *    APPROVED   승인됐고 발행을 기다린다 — 여기서 작성자를 정한다
 *    EDITED     수정 후 승인. 발행될 글은 수정본이므로 역시 작성자가 필요하다
 *
 *    PENDING    아직 사람이 결정하기 전이다. 작성자를 미리 정할 이유가 없다
 *    DECLINED   폐기된 것이다
 *    EXPIRED    기한이 지났다
 *    PUBLISHED  🔴 이미 나갔다. 바꾸면 "누가 썼나" 가 어긋난다
 *
 *    persona-target-rules.ts 의 canSetTarget 과 정확히 대칭이다 —
 *    저쪽은 "어느 글에", 이쪽은 "어느 페르소나가".
 */
export const ASSIGNABLE_STATUSES: readonly QueueStatus[] = ['APPROVED', 'EDITED']

export const canSetMatch = (status: QueueStatus): boolean =>
  ASSIGNABLE_STATUSES.includes(status)

/**
 * 🔴 규칙 판. 저장된 점수가 어느 규칙의 산물인지 없으면 비교가 불가능하다.
 *
 *    "E-2a" = 점수 3단 보정(간헐 0.6 · 갱년기 후 0.7) + 죽은 축 제거
 *           + 배치 순차 할당 + 한국어 길이 밴드
 *    규칙이 바뀌면 이 값을 올린다. 옛 배정을 조용히 새 규칙으로 읽지 않기 위해서다.
 */
export const RULE_VERSION = 'E-2a'

export type ScoreBreakdownLike = {
  topicFit: number
  lifeConsistency: number
  voiceFit: number
  activitySpread: number
  interest: number
}

export type MatchMeta = {
  /** 🔴 가중 무작위라 seed 없이는 결과를 재현할 수 없다 */
  seed: string
  /** 배정된 페르소나의 총점 */
  total: number
  /** 🔴 점수만 남기면 "왜 이 사람이었나" 에 답할 수 없다 */
  breakdown: ScoreBreakdownLike
  /** 상위 후보 — 대안이 있었는지. 단독이었다면 재검토 신호다 */
  top: { code: string; total: number }[]
  eligibleCount: number
  blockedCount: number
  ruleVersion: string
}

export type MatchInput = {
  status: QueueStatus
  /** 🔴 발행된 글의 배정은 바꾸지 않는다. status 와 무관하게 본다 */
  createdPostId: string | null
  /** 배정할 페르소나 code — 없으면 저장하지 않는다 */
  assigned: string | null
  seed: string
  eligible: readonly { code: string; score: { total: number; breakdown: ScoreBreakdownLike } }[]
  top: readonly { code: string; score: { total: number } }[]
  blockedCount: number
}

export type StorePlan =
  | { ok: true; personaCode: string; meta: MatchMeta }
  | { ok: false; reason: string }

export const SKIP_REASONS = [
  'PUBLISHED_OR_CREATED',
  'NOT_ASSIGNABLE',
  'NO_ASSIGNMENT',
  'ASSIGNED_NOT_ELIGIBLE',
] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

export const SKIP_LABEL: Record<SkipReason, string> = {
  PUBLISHED_OR_CREATED: '🔴 이미 발행됐다 — 배정을 바꾸지 않는다',
  NOT_ASSIGNABLE: '배정할 수 있는 상태가 아니다 (APPROVED · EDITED 만)',
  NO_ASSIGNMENT: '이 배치에서 배정되지 않았다 (후보 없음 또는 여력 소진)',
  ASSIGNED_NOT_ELIGIBLE: '🔴 배정된 코드가 후보 목록에 없다 — 계산이 어긋났다',
}

/**
 * 무엇을 저장할지 정한다.
 *
 * 🔴 순서가 규칙이다. 발행 여부를 **가장 먼저** 본다 —
 *    status 가 어떤 값이든 createdPostId 가 있으면 그 글은 이미 세상에 나갔다.
 *
 * 🔴 배정되지 않은 건은 **저장하지 않는다.**
 *    "후보가 없다" 와 "여력이 소진돼 다음 주기로 밀렸다" 는 둘 다 배정이 아니다 —
 *    null 을 써 넣으면 "배정을 시도했고 실패했다" 는 기록이 되는데, 그건 사실이 아니다.
 *    다음 배치가 다시 계산한다.
 */
export function planStore(input: MatchInput): StorePlan {
  // ── ① 🔴 발행된 것은 건드리지 않는다 (status 무관) ──
  if (input.createdPostId !== null && input.createdPostId.trim() !== '') {
    return { ok: false, reason: SKIP_LABEL.PUBLISHED_OR_CREATED }
  }
  if (input.status === 'PUBLISHED') {
    return { ok: false, reason: SKIP_LABEL.PUBLISHED_OR_CREATED }
  }
  // ── ② APPROVED · EDITED 만 ──
  if (!canSetMatch(input.status)) {
    return { ok: false, reason: `${SKIP_LABEL.NOT_ASSIGNABLE} — 현재 ${input.status}` }
  }
  // ── ③ 배정이 없으면 저장하지 않는다 ──
  const code = (input.assigned ?? '').trim()
  if (code === '') return { ok: false, reason: SKIP_LABEL.NO_ASSIGNMENT }

  // ── ④ 🔴 배정된 코드가 후보 안에 있어야 한다. 없으면 계산이 어긋난 것이다 ──
  const hit = input.eligible.find((e) => e.code === code)
  if (hit === undefined) return { ok: false, reason: `${SKIP_LABEL.ASSIGNED_NOT_ELIGIBLE} (${code})` }

  return {
    ok: true,
    personaCode: code,
    meta: buildMatchMeta({
      seed: input.seed,
      total: hit.score.total,
      breakdown: hit.score.breakdown,
      top: input.top.map((t) => ({ code: t.code, total: t.score.total })),
      eligibleCount: input.eligible.length,
      blockedCount: input.blockedCount,
    }),
  }
}

/** 🔴 담는 것은 "왜 이 사람이었나" 에 답할 최소치뿐이다 */
export function buildMatchMeta(input: {
  seed: string
  total: number
  breakdown: ScoreBreakdownLike
  top: { code: string; total: number }[]
  eligibleCount: number
  blockedCount: number
}): MatchMeta {
  return {
    seed: input.seed,
    total: input.total,
    breakdown: { ...input.breakdown },
    top: input.top.map((t) => ({ code: t.code, total: t.total })),
    eligibleCount: input.eligibleCount,
    blockedCount: input.blockedCount,
    ruleVersion: RULE_VERSION,
  }
}

/** matchMeta 에 허용되는 키. 🔴 이 밖의 것은 담지 않는다 */
export const MATCH_META_KEYS: readonly string[] = [
  'seed', 'total', 'breakdown', 'top', 'eligibleCount', 'blockedCount', 'ruleVersion',
]

/**
 * 🔴 저장 직전 실측 방어. 타입으로 막았어도 한 번 더 본다 —
 *    타입은 이 파일을 거쳐 갈 때만 유효하고, 호출부가 객체를 직접 만들 수 있다.
 */
export function assertMatchMeta(meta: MatchMeta): void {
  for (const key of Object.keys(meta)) {
    if (!MATCH_META_KEYS.includes(key)) {
      throw new Error(
        `matchMeta 에 허용되지 않은 키가 있다: ${key}\n` +
          `  담는 것은 ${MATCH_META_KEYS.join(' · ')} 뿐이다 —\n` +
          '  누가 왜 탈락했는지(blockedBy)는 dry-run 이 언제든 다시 낸다.',
      )
    }
  }
  if (meta.ruleVersion.trim() === '') throw new Error('ruleVersion 이 비어 있다 — 어느 규칙의 산물인지 알 수 없다')
  if (meta.seed.trim() === '') throw new Error('seed 가 비어 있다 — 결과를 재현할 수 없다')
}

/** 🔴 저장 직전 실측 방어 — 배정 말고 다른 것이 data 에 섞이지 않았는가 */
export const ALLOWED_WRITE_KEYS: readonly string[] = ['matchedPersonaId', 'matchedAt', 'matchMeta']

export const FORBIDDEN_WRITE_KEYS: readonly string[] = [
  'status', 'createdPostId', 'draftTitle', 'draftBody', 'editedTitle', 'editedBody',
  'gateVerdict', 'gateResults', 'decidedBy', 'decidedAt', 'declineReason',
  'sourceRawContentId', 'dedupKey',
]

export function assertMatchWrite(data: Record<string, unknown>): void {
  for (const key of FORBIDDEN_WRITE_KEYS) {
    if (key in data) {
      throw new Error(
        `쓰기 대상에 ${key} 가 있다. 배정은 세 컬럼만 만진다 —\n` +
          '  상태 전환 · 발행 연결 · 초안 본문은 각각 별도 경로다.',
      )
    }
  }
  for (const key of Object.keys(data)) {
    if (!ALLOWED_WRITE_KEYS.includes(key)) {
      throw new Error(`쓰기 대상에 허용되지 않은 필드가 있다: ${key} (허용 ${ALLOWED_WRITE_KEYS.join(' · ')})`)
    }
  }
}
