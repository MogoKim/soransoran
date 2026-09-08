import type { BoardType, MicroSeedCandidateStatus } from '@prisma/client'
// 🔴 3축 필드는 post-visibility 가 유일한 지점이다 (C-2). 여기서 값을 새로 적지 않는다.
import { MICRO_SEED_POST_VISIBILITY_FLAGS } from './post-visibility'
// 🔴 실회원 판별은 단일 정본이다. 여기서 다시 쓰지 않는다
import { judgeRealMember } from './real-member-gate'

/**
 * Micro Seed write-path 가드
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-3 · §6-9-C · §6-9-E · §6-10
 *
 * publisher 가 DB 에 쓰기 **전에** 통과해야 하는 판정들을 모은다.
 *
 * 🔴 이 파일은 아무것도 쓰지 않는다
 *    DB 접속 없음 · Sheet API 없음 · 네트워크 없음. 순수 판정만 한다.
 *    실제 UPDATE · Post 생성은 publisher(PR-C2b)의 일이다.
 *
 * 🔴 실측값을 **인자로 요구**한다
 *    "조회했는지" 를 사람이 기억하는 방식으로 두지 않는다. 조회 결과가 없으면
 *    호출 자체가 성립하지 않도록 시그니처를 짠다 — §6-3 이 경고한
 *    "실측 없이 HOLD 복귀 → 이중 발행" 을 타입으로 막는 방법이다.
 */

// ─────────────────────────────────────────────────────────
// 운영 상수 (§6-9-F)
// ─────────────────────────────────────────────────────────

/** PROCESSING 이 이 시간을 넘기면 정체로 본다. 수동 실행 주기 대비 넉넉하게 잡았다 */
export const PROCESSING_TIMEOUT_MINUTES = 30

/** 🔴 코드 상수. 초과하면 FAILED 로 고정한다 — 무한 루프 차단 */
export const MAX_ATTEMPT_COUNT = 3

/**
 * 예약 유예창 (§6-2 · 정책 21 · R5).
 *
 * 🔴 왜 창이 필요한가 — 정본 세 곳이 달랐다
 *    §6-2 상태 기계는 "예약시각 경과 → HOLD 복귀" 라 하고,
 *    schema 의 `@@index([status, scheduledPublishAt])` 주석은 "예약시각이 **지난**
 *    승인 후보를 고른다" 고 하며, 획득 SQL 에는 예약 조건이 아예 없었다.
 *
 *    도래하는 순간 HOLD 로 보내면 발행 창이 0 이라 예약 발행이 성립하지 않는다.
 *    반대로 조건 없이 집으면 사흘 전 예약도 지금 나가서 "왜 지금?" 이 된다.
 *    창업자 확정(2026-08-25): **도래 후 30분 안이면 발행, 넘으면 HOLD.**
 *    셋이 이 해석에서 모두 성립한다 — §6-2 의 "경과" 를 "유예를 넘긴 경과" 로 읽는다.
 *
 * 🔴 값을 PROCESSING_TIMEOUT_MINUTES 와 맞췄다. 둘 다 수동 실행 주기가 근거다.
 *    다만 **별개의 상수로 둔다** — 하나를 바꿀 이유와 다른 하나를 바꿀 이유가 다르다.
 */
export const PUBLISH_GRACE_MINUTES = 30

/**
 * §6-9-D 발행 게시판 화이트리스트.
 *
 * 🔴 BoardType enum 에 MAGAZINE 이 실재한다. 타입만으로는 못 막는다 —
 *    매거진 영역에 Micro Seed 가 발행되면 Codex[1] 도메인 침범이자 정책 13 위반이다.
 */
export const PUBLISHABLE_BOARD_TYPES = ['FREE', 'MENOPAUSE'] as const satisfies readonly BoardType[]

/** Sheet 의 board 문자열 → BoardType. 화이트리스트 밖은 매핑 자체가 없다 */
export const BOARD_TYPE_BY_SHEET_VALUE: Record<string, BoardType> = {
  free: 'FREE',
  menopause: 'MENOPAUSE',
}

/** §10-1 · 정책 12 — unao_legacy 는 학습 자산이며 직접 발행 금지 */
export const PUBLISHABLE_RAW_ORIGINS = ['live'] as const

// ─────────────────────────────────────────────────────────
// ① 원자적 획득 결과 해석 (§6-10 1차 방어)
// ─────────────────────────────────────────────────────────

/**
 * 획득 SQL. **문자열 상수일 뿐 여기서 실행하지 않는다.**
 *
 * 🔴 `attemptCount < ${MAX_ATTEMPT_COUNT}` 를 조건에 넣는다.
 *    워커가 크래시로 죽으면 실패 경로를 못 밟아 attemptCount 가 늘지 않는다.
 *    조건에 두면 상한을 넘긴 후보를 애초에 집지 않는다.
 *
 * 🔴 processingStartedAt 과 processingBy 를 **같은 UPDATE 에서** 쓴다.
 *    나눠 쓰면 그 사이에 죽었을 때 소유자를 알 수 없는 PROCESSING 이 남는다.
 *
 * 🔴 예약 유예창을 **조건에 넣는다** ($3 = now, $4 = now - PUBLISH_GRACE_MINUTES).
 *    코드에서 창을 판정하고 SQL 에서는 안 보면, 판정과 획득 사이에 시각이 흘러
 *    창을 벗어난 후보를 집을 수 있다. 같은 UPDATE 안에서 확인해야 원자적이다.
 *
 *    시각을 파라미터로 받는 이유: 판정에 쓴 시계와 획득에 쓴 시계를 같게 하기 위해서다.
 *    (processingStartedAt 의 now() 는 DB 시계지만 둘 다 UTC 라 어긋나지 않는다)
 */
export const ACQUIRE_CANDIDATE_SQL = `
UPDATE "MicroSeedCandidate"
   SET status = 'PROCESSING',
       "processingStartedAt" = now(),
       "processingBy" = $2
 WHERE id = $1
   AND status = 'PENDING'
   AND "attemptCount" < ${MAX_ATTEMPT_COUNT}
   AND "scheduledPublishAt" IS NOT NULL
   AND "scheduledPublishAt" <= $3
   AND "scheduledPublishAt" >= $4
RETURNING id;
`.trim()

export type AcquireOutcome =
  /** 획득 성공. 이 워커가 소유자다 */
  | { kind: 'ACQUIRED' }
  /**
   * 집지 못했다. **이유는 아직 모른다.**
   * 🔴 "다른 워커가 가져갔다" 로 단정하지 않는다 — WHERE 절에 조건이 셋이라
   *    status 가 PENDING 이 아니거나 attemptCount 가 상한을 넘겼을 수도 있다.
   *    C2b 가 현재 상태를 재조회해 분류해야 한다.
   */
  | { kind: 'NOT_ACQUIRED_NEEDS_RECLASSIFY'; reason: string }
  /** 있을 수 없는 결과. id 가 PK 인데 여러 행이 바뀌었다 */
  | { kind: 'ABORT'; reason: string }

/**
 * 획득 SQL 의 반환 행 수를 해석한다.
 *
 * @param rowCount RETURNING 이 돌려준 행 수
 */
export function interpretAcquireResult(rowCount: number): AcquireOutcome {
  if (!Number.isInteger(rowCount) || rowCount < 0) {
    return { kind: 'ABORT', reason: `행 수가 비정상이다: ${JSON.stringify(rowCount)}` }
  }
  if (rowCount === 1) return { kind: 'ACQUIRED' }
  if (rowCount === 0) {
    return {
      kind: 'NOT_ACQUIRED_NEEDS_RECLASSIFY',
      reason:
        '획득하지 못했다. 다른 워커 · PENDING 아님 · attemptCount 상한 중 무엇인지 ' +
        '현재 상태를 재조회해 분류해야 한다',
    }
  }
  // id 는 PK 다. 2행 이상이 바뀌었다면 데이터나 쿼리가 깨진 것이므로 진행하지 않는다.
  return { kind: 'ABORT', reason: `id 는 PK 인데 ${rowCount}행이 반환됐다. 진행하지 않는다` }
}

// ─────────────────────────────────────────────────────────
// ①-B 예약 유예창 판정 (§6-2 · 정책 21)
// ─────────────────────────────────────────────────────────

/** 예약 시각을 실측하지 않고 창을 판정하려 했다는 뜻 */
export class PublishWindowWithoutScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublishWindowWithoutScheduleError'
  }
}

export type PublishWindowVerdict =
  /** 아직 예약 시각이 오지 않았다. 오류가 아니다 — 기다린다 */
  | { kind: 'TOO_EARLY'; reason: string }
  /** 창 안이다. 발행 대상 */
  | { kind: 'IN_WINDOW' }
  /** 유예를 넘겼다. 발행하지 않고 HOLD 로 되돌린다 */
  | { kind: 'TOO_LATE'; reason: string }
  /** 예약 시각 자체가 없다. PENDING 인데 비어 있으면 R8 이 먼저 걸렸어야 한다 */
  | { kind: 'NOT_SCHEDULED'; reason: string }

/**
 * 지금 이 후보를 발행해도 되는 시각인가.
 *
 * 🔴 `undefined` 는 던진다. select 에서 빠뜨린 것과 "예약이 없다"(null) 는 다른 사건이다.
 *    미실측을 null 로 뭉뚱그리면 조회 실패가 "예약 없음" 으로 둔갑한다.
 *
 * 🔴 여기서 시각을 밀지 않는다. TOO_LATE 는 HOLD 사유일 뿐이며,
 *    재예약은 사람이 micro-seed:reschedule-live 로 명시 지시한다 (정책 21).
 *
 * @param scheduledPublishAt DB 실측값. undefined 면 미실측
 * @param now                판정 기준 시각. 획득 SQL 에 넘기는 것과 **같은 값**이어야 한다
 * @param graceMinutes       유예. 기본 PUBLISH_GRACE_MINUTES
 */
export function resolvePublishWindow(
  scheduledPublishAt: Date | null | undefined,
  now: Date,
  graceMinutes: number = PUBLISH_GRACE_MINUTES,
): PublishWindowVerdict {
  if (scheduledPublishAt === undefined) {
    throw new PublishWindowWithoutScheduleError(
      'scheduledPublishAt 을 실측하지 못했다. select 에 포함한 뒤 다시 판정한다.',
    )
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new PublishWindowWithoutScheduleError(`판정 기준 시각이 올바르지 않다: ${JSON.stringify(now)}`)
  }
  if (scheduledPublishAt === null) {
    return { kind: 'NOT_SCHEDULED', reason: '예약 시각이 없다. 발행하지 않는다 (R8)' }
  }
  if (Number.isNaN(scheduledPublishAt.getTime())) {
    return { kind: 'NOT_SCHEDULED', reason: '예약 시각이 유효한 날짜가 아니다 (R4)' }
  }

  const scheduled = scheduledPublishAt.getTime()
  const nowMs = now.getTime()
  const graceMs = graceMinutes * 60_000

  if (scheduled > nowMs) {
    const mins = Math.ceil((scheduled - nowMs) / 60_000)
    return { kind: 'TOO_EARLY', reason: `예약 시각이 아직 오지 않았다 (${mins}분 남음). 기다린다` }
  }
  if (scheduled < nowMs - graceMs) {
    const mins = Math.floor((nowMs - scheduled) / 60_000)
    return {
      kind: 'TOO_LATE',
      reason:
        `예약 시각이 ${mins}분 지났다 (유예 ${graceMinutes}분 초과). 발행하지 않고 HOLD 로 되돌린다. ` +
        '재예약은 micro-seed:reschedule-live 로 명시 지시한다',
    }
  }
  return { kind: 'IN_WINDOW' }
}

// ─────────────────────────────────────────────────────────
// ② PROCESSING timeout 복구 (§6-3)
// ─────────────────────────────────────────────────────────

/** 실측 없이 복구를 시도했다는 뜻. §6-3 이 경고한 이중 발행 경로다 */
export class TimeoutRecoveryWithoutProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutRecoveryWithoutProbeError'
  }
}

export type TimeoutProbe = {
  /**
   * DB 실측 결과 — 이 후보로 만들어진 Post 가 있는가.
   * 🔴 undefined 를 넘기면 던진다. "모르겠다" 로 복구할 수 없다.
   */
  hasPost: boolean | undefined
  /** Post 가 이 후보(sheetCandidateId)와 연결돼 있는가. 아니면 다른 경로로 이미 발행된 것이다 */
  postLinkedToCandidate?: boolean
  /**
   * 현재까지의 시도 횟수 (DB 실측).
   * 🔴 0 으로 보정하지 않는다 — 실측하지 못한 채 복구하면 재시도 제한이 무력해진다.
   *    select 에서 빠뜨린 것과 "아직 0 회" 는 다른 사건이다.
   */
  attemptCount: number
}

export type TimeoutRecovery = {
  nextStatus: Extract<MicroSeedCandidateStatus, 'PUBLISHED' | 'SKIPPED' | 'HOLD' | 'FAILED'>
  nextAttemptCount: number
  reason: string
}

/**
 * timeout 된 PROCESSING 후보를 어디로 보낼지 정한다.
 *
 * 🔴 PENDING 을 돌려주지 않는다 (§5-4 · 정책 14).
 *    PENDING 으로 되돌리면 worker 가 사람 승인 없이 다시 집는다 — 자동 재발행이다.
 *    HOLD 로 보내면 창업자가 다시 보고 승인해야 한다.
 *
 * 🔴 실측이 먼저다.
 *    DB 발행 성공 → Sheet 갱신 실패 → timeout → HOLD 복귀
 *    → 창업자가 "아직 발행 안 됐네" 하고 재승인 → 이중 발행
 *    즉 복구 장치 자체가 실측 없이는 사고의 원인이 된다 (§6-3).
 */
export function resolveTimeoutRecovery(probe: TimeoutProbe): TimeoutRecovery {
  if (probe.hasPost === undefined || probe.hasPost === null) {
    throw new TimeoutRecoveryWithoutProbeError(
      'DB 실측 없이 timeout 을 복구할 수 없다. hasPost 를 확인한 뒤 다시 호출한다 (§6-3).',
    )
  }

  // 🔴 실측하지 못한 attemptCount 를 0 으로 보정하지 않는다.
  //    보정하면 select 누락이 "아직 0 회" 로 둔갑해 상한이 영원히 오지 않는다.
  if (!Number.isInteger(probe.attemptCount) || probe.attemptCount < 0) {
    throw new TimeoutRecoveryWithoutProbeError(
      `attemptCount 를 실측하지 못했다 (${JSON.stringify(probe.attemptCount)}). ` +
        '0 으로 보정하면 재시도 제한이 무력해진다 (§6-9-F).',
    )
  }
  const attemptCount = probe.attemptCount

  // ── 이미 발행돼 있다 → Sheet 를 정정한다. 재시도가 아니다 ──
  if (probe.hasPost) {
    // 이 후보로 만들어진 Post 면 발행 성공(Sheet 갱신만 실패한 것),
    // 아니면 다른 경로로 이미 나간 것이므로 중복이다.
    const linked = probe.postLinkedToCandidate !== false
    return linked
      ? {
          nextStatus: 'PUBLISHED',
          nextAttemptCount: attemptCount,
          reason: 'timeout 실측: Post 가 존재하고 이 후보와 연결돼 있다. 발행 성공으로 정정한다',
        }
      : {
          nextStatus: 'SKIPPED',
          nextAttemptCount: attemptCount,
          reason: 'timeout 실측: 다른 경로로 이미 발행된 원문이다. 중복 발행하지 않는다',
        }
  }

  // ── 미발행 → 상한을 넘겼으면 고정, 아니면 HOLD 로 되돌린다 ──
  const nextAttemptCount = attemptCount + 1
  if (nextAttemptCount >= MAX_ATTEMPT_COUNT) {
    return {
      nextStatus: 'FAILED',
      nextAttemptCount,
      reason: `timeout 실측: Post 부재. 시도 ${nextAttemptCount}/${MAX_ATTEMPT_COUNT} 로 상한에 도달해 FAILED 로 고정한다`,
    }
  }
  return {
    nextStatus: 'HOLD',
    nextAttemptCount,
    reason: `timeout 실측: Post 부재. HOLD 로 되돌린다 (시도 ${nextAttemptCount}/${MAX_ATTEMPT_COUNT})`,
  }
}

/** 시도 상한에 도달했는가. 도달하면 재시도 경로를 열지 않는다 */
export function isAttemptExhausted(attemptCount: number): boolean {
  if (!Number.isInteger(attemptCount)) return true
  return attemptCount >= MAX_ATTEMPT_COUNT
}

// ─────────────────────────────────────────────────────────
// ③ 시스템 작성자 검증 (§5-2A · §6-9-E)
// ─────────────────────────────────────────────────────────

export type AuthorProbe = {
  id: string
  /** User row 가 실제로 있는가 (DB 실측) */
  exists: boolean
  /**
   * 🔴 **방어적 보조 지표** — 정본이 아니다 (2026-09-08 정정).
   *    `User.providerId` 는 NextAuth adapter 가 채우지 않는다 (`src/lib/auth.ts` §signIn).
   *    그래도 남긴다 — 누군가 수동으로 넣어 둔 값은 막아야 한다.
   *    `null` = 실측했고 비어 있음(시스템 User) / `undefined` = **select 하지 않음**.
   */
  providerId: string | null
  /**
   * 🔴 **실회원 판별 정본** — 그 User 에 연결된 `Account` 행 수.
   *    카카오 로그인이 만드는 것은 `Account` 이지 `User.providerId` 가 아니다.
   *    `undefined`(select 누락) · `null`(알 수 없음) 은 **막는다** — fail-closed.
   */
  accountCount: number | null
  isBlocked: boolean
}

export type AuthorVerdict = { ok: true } | { ok: false; reason: string }

/**
 * 시스템 작성자로 발행해도 되는지 판정한다.
 *
 * 🔴 폴백을 두지 않는다. 하나라도 어긋나면 발행하지 않는다 —
 *    누가 썼는지 모르는 글이 남으면 takedown 대상을 고를 기준이 사라진다.
 */
export function verifyPublishAuthor(probe: AuthorProbe): AuthorVerdict {
  if (!probe || typeof probe !== 'object') {
    return { ok: false, reason: '작성자 실측값이 없다. 조회하지 않고 발행할 수 없다' }
  }

  const id = typeof probe.id === 'string' ? probe.id.trim() : ''
  if (!id) return { ok: false, reason: '작성자 ID 가 비어 있다. 발행하지 않는다 (§6-9-E)' }

  // 🔴 실측 누락을 통과시키지 않는다.
  //    publisher 가 select 에서 빠뜨린 필드는 undefined 로 온다. 그걸 "문제 없음" 으로
  //    읽으면 조회하지 않은 채 발행하게 된다 — 검사하지 않은 것은 위반 없음이 아니다.
  if (typeof probe.exists !== 'boolean') {
    return { ok: false, reason: `exists 를 실측하지 못했다 (${JSON.stringify(probe.exists)}). User row 조회 결과가 필요하다` }
  }
  if (probe.providerId === undefined) {
    return { ok: false, reason: 'providerId 를 실측하지 못했다. select 에 providerId 를 포함해야 한다 (방어적 보조 지표)' }
  }
  if (typeof probe.isBlocked !== 'boolean') {
    return { ok: false, reason: `isBlocked 를 실측하지 못했다 (${JSON.stringify(probe.isBlocked)}). select 에 isBlocked 를 포함해야 한다` }
  }

  if (!probe.exists) {
    return { ok: false, reason: `작성자 User row 가 없다 (id=${id}). 임의 계정으로 대체하지 않는다` }
  }

  // 🚫 회원 계정 재사용 금지 — 실회원 이름으로 발행되면 되돌리기 어렵다.
  //    🔴 판정은 `judgeRealMember` 하나뿐이다 (src/lib/real-member-gate.ts).
  //    정본은 `Account` 이고, 실측하지 못했으면 막는다 — 조회하지 않고 발행하지 않는다
  const real = judgeRealMember({ accountCount: probe.accountCount, providerId: probe.providerId })
  if (real.real) {
    return { ok: false, reason: `작성자를 쓸 수 없다 — ${real.reason}` }
  }

  if (probe.isBlocked) {
    return { ok: false, reason: '작성자가 차단된 계정이다. 발행하지 않는다' }
  }

  return { ok: true }
}

// ─────────────────────────────────────────────────────────
// ④ 3축 플래그 강제 (§6-9-C)
// ─────────────────────────────────────────────────────────

/**
 * Post 생성 시 박는 고정값.
 *
 * 🔴 3축 필드는 여기서 직접 쓰지 않는다.
 *    post-visibility.ts 가 3축의 유일한 지점이다(C-2). 읽기 판정과 쓰기 값이
 *    다른 파일에 있으면 두 값이 갈라진다 — 그래서 게이트에서 가져와 펼친다.
 *    check:visibility 가 이 규칙을 강제한다.
 *
 * 🔴 source 는 여기 둔다. "내부 공급인가" 는 "보이는가" 와 다른 축이라
 *    게이트에 넣으면 한 필드가 두 질문에 답하려다 실패한다.
 */
export const MICRO_SEED_POST_FLAGS = {
  ...MICRO_SEED_POST_VISIBILITY_FLAGS,
  source: 'SYSTEM',
  /**
   * 🔴 발행은 PUBLISHED 로 시작한다. 입력으로 뒤집을 수 없다.
   *    HIDDEN 으로 만들면 §12-0 완료 조건("커뮤니티 목록에 정상 노출")을 만족하지 못하고,
   *    무엇보다 isCommunityVisible() 이 status === 'PUBLISHED' 만 보므로
   *    레인의 목적(커뮤니티 생활감)이 사라진다 (§4 축 1).
   *
   *    🚫 status 는 3축이 아니다. Micro Seed 특유의 정책이 아니라 일반 글과 같은 값이라
   *       post-visibility 의 상수로 올리지 않았다 — 게이트는 3축만 담당한다.
   *       숨김 전환은 TAKEDOWN 경로가 Post.status = HIDDEN 으로 따로 처리한다 (§6-6).
   */
  status: 'PUBLISHED',
} as const

export type MicroSeedPostInput = {
  boardType: BoardType
  title: string
  content: string
  authorId: string
  sheetCandidateId: string
  sourceSite: string
  sourceUrl: string
  sourceArticleId: string
  sourceCapturedAt: Date
  publishAt?: Date | null
}

/**
 * Post 생성 payload 를 만든다. **Post 를 만드는 유일한 입구여야 한다.**
 *
 * 🔴 3축 플래그를 마지막에 펼친다. 호출자가 무엇을 넘기든 덮어쓴다 —
 *    입력으로 뒤집을 수 있으면 상수가 아니다.
 */
export function buildMicroSeedPostData(input: MicroSeedPostInput & Record<string, unknown>) {
  const { boardType, title, content, authorId, sheetCandidateId } = input
  return {
    boardType,
    title,
    content,
    authorId,
    sheetCandidateId,
    sourceSite: input.sourceSite,
    sourceUrl: input.sourceUrl,
    sourceArticleId: input.sourceArticleId,
    sourceCapturedAt: input.sourceCapturedAt,
    publishAt: input.publishAt ?? null,
    // 🔴 항상 마지막. 위에서 무엇이 왔든 이 값이 이긴다.
    ...MICRO_SEED_POST_FLAGS,
  }
}

// ─────────────────────────────────────────────────────────
// ⑤ board · origin 제한 (§6-9-D · §10-1)
// ─────────────────────────────────────────────────────────

export type BoardVerdict = { ok: true; boardType: BoardType } | { ok: false; reason: string }

/** Sheet 의 board 값을 BoardType 으로 바꾼다. 화이트리스트 밖은 매핑하지 않는다 */
export function resolvePublishableBoard(sheetBoard: unknown): BoardVerdict {
  const value = typeof sheetBoard === 'string' ? sheetBoard.trim().toLowerCase() : ''
  if (!value) return { ok: false, reason: 'board 가 비었다' }

  const boardType = BOARD_TYPE_BY_SHEET_VALUE[value]
  if (!boardType) {
    return {
      ok: false,
      reason: `board 는 ${Object.keys(BOARD_TYPE_BY_SHEET_VALUE).join(' · ')} 만 허용한다. 받은 값: ${String(sheetBoard)}`,
    }
  }
  // 매핑표와 화이트리스트가 갈라지는 것을 막는 2차 확인이다.
  if (!(PUBLISHABLE_BOARD_TYPES as readonly string[]).includes(boardType)) {
    return { ok: false, reason: `${boardType} 은 발행 대상이 아니다` }
  }
  return { ok: true, boardType }
}

export type OriginVerdict = { ok: true } | { ok: false; reason: string }

/**
 * 원문 출처가 발행 가능한가.
 *
 * 🔴 §10-1 은 "문서 규칙으로만 두지 않고 후보 쿼리에서 코드로 배제" 하라고 요구한다.
 *    publisher 는 픽업 쿼리에도 origin='live' 를 넣어야 하며, 이 함수는 그 뒤의 2차 확인이다.
 */
export function verifyPublishableOrigin(origin: unknown): OriginVerdict {
  const value = typeof origin === 'string' ? origin.trim() : ''
  if (!value) return { ok: false, reason: '원문 origin 이 비었다' }
  if (!(PUBLISHABLE_RAW_ORIGINS as readonly string[]).includes(value)) {
    return {
      ok: false,
      reason: `origin='${value}' 은 직접 발행 금지다 (정책 12 · §10-1). 학습·분석 자산이다`,
    }
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────
// ⑥ 최종 발행 가능 판정
// ─────────────────────────────────────────────────────────

export type PublishablePlanRow = {
  candidateId?: string
  decision: string
  rules?: string[]
  /** 판정되지 않은 게이트 목록. 하나라도 있으면 발행하지 않는다 */
  unchecked?: string[]
}

export type PublishVerdict = { ok: true } | { ok: false; reason: string }

/**
 * plan 한 행이 발행 가능한지 본다.
 *
 * 🔴 이것만으로 발행하지 않는다.
 *    plan 은 guardCandidate 를 주입받는 구조라, 가짜 guard 를 넣으면
 *    unchecked 가 빈 PASS 를 만들 수 있다. publisher 는 발행 직전
 *    guardMicroSeedCandidate() 를 **직접 호출해 재판정**해야 한다.
 *    이 함수는 그 앞에 두는 1차 체다.
 */
export function verifyPublishablePlanRow(row: PublishablePlanRow): PublishVerdict {
  if (!row || typeof row !== 'object') return { ok: false, reason: 'plan 행이 없다' }

  if (row.decision !== 'PASS') {
    const rules = row.rules?.length ? ` [${row.rules.join(', ')}]` : ''
    return { ok: false, reason: `판정이 PASS 가 아니다: ${row.decision}${rules}` }
  }

  const unchecked = row.unchecked ?? []
  if (unchecked.length > 0) {
    return {
      ok: false,
      reason: `판정되지 않은 게이트가 있다: ${unchecked.join(', ')}. 검사하지 않은 것은 위반 없음이 아니다`,
    }
  }

  return { ok: true }
}

// ─────────────────────────────────────────────────────────
// ⑦ Sheet 쓰기 열 화이트리스트 (§6-7-A)
// ─────────────────────────────────────────────────────────

/**
 * publisher 가 Sheet 에 쓸 수 있는 열.
 *
 * 🔴 스코프로는 이걸 막을 수 없다.
 *    Google 은 셀 단위 스코프를 주지 않는다 — write 를 열면 `spreadsheets` 전체다.
 *    즉 "창업자 칸을 건드리지 마라" 를 강제하는 것은 **코드가 유일한 방어선**이다.
 *
 * 🔴 status(2열)는 창업자 편집 칸인데 시스템도 쓴다.
 *    이 겹침이 §6-3 사고의 무대다 — 시스템이 PUBLISHED 로 바꾸는 동안
 *    창업자가 같은 칸을 보고 있다. 그래서 허용하되 목록에 명시해 둔다.
 *
 * 🚫 board · founderTitle · scheduledPublishAt · declineReason 은 창업자 것이다.
 *    시스템이 쓰면 창업자가 적은 값이 조용히 사라진다.
 * 🚫 나머지 시스템 칸(candidateId · source* · dedupKey 등)은 collector 가 적재할 때
 *    정해지는 값이다. publisher 가 고칠 이유가 없고, 고치면 원장과 갈라진다.
 */
export const SHEET_WRITABLE_COLUMNS = [
  'status',
  'holdReason',
  'postUrl',
  'updatedBySystemAt',
] as const

export type SheetWriteVerdict = { ok: true } | { ok: false; reason: string }

/**
 * 발행 시도의 최종 결과. **DB status 를 바꾸는 모든 경로가 여기에 대응한다.**
 *
 * 🔴 성공만 Sheet 에 쓰면 원장이 갈라진다
 *    TOO_LATE · 재판정 실패 · attempt 소진은 전부 DB status 를 바꾼다.
 *    그때 Sheet 를 그대로 두면 창업자 화면에는 PENDING 이 남아 "아직 발행 안 됐네" 로 읽히고,
 *    실제로는 HOLD·FAILED 다. 그 상태에서 재승인하면 §6-3 의 이중 발행 경로로 들어간다.
 */
export type PublishOutcome =
  | { kind: 'PUBLISHED'; postUrl: string; at: Date }
  | { kind: 'HOLD'; reason: string }
  | { kind: 'FAILED'; reason: string }
  /**
   * 다른 경로로 이미 발행된 원문. **이 후보로는 발행하지 않는다** (§6-10).
   *
   * 🔴 postUrl 을 쓰지 않는다. Post 는 존재하지만 **다른 후보**에 연결돼 있다 —
   *    이 행에 그 링크를 적으면 "이 후보가 저 글을 냈다" 는 거짓이 된다.
   */
  | { kind: 'SKIPPED'; reason: string }

/**
 * 결과 → Sheet 에 쓸 셀. §6-7-A 허용 열만 나온다.
 *
 * 🔴 postUrl · updatedBySystemAt 은 **PUBLISHED 에만** 실린다.
 *    Post 가 없는데 postUrl 이 있으면 원장이 거짓말을 한다. 실패 경로에서 이 열이
 *    나오지 않는다는 것을 함수 모양으로 보장하고, fixture 가 그걸 잠근다.
 *
 * 🔴 resolveTimeoutRecovery 가 돌려주는 4상태(PUBLISHED · SKIPPED · HOLD · FAILED)를
 *    **모두** 다룬다. 하나라도 빠지면 그 분기에서 undefined 가 나와 write 가 터진다 —
 *    recover scanner(R-2)가 SKIPPED 를 만나는 순간이 정확히 그 지점이다.
 *
 * 🔴 FAILED · SKIPPED 도 holdReason 열에 사유를 쓴다
 *    Sheet 17열에 failureReason 이 없다(§6-7-A). 사유를 버리는 것보다 홀드 사유 칸에
 *    적어 창업자가 화면에서 이유를 보는 편이 낫다 — DB 에는 failureReason 으로 따로 남는다.
 */
export function buildSheetWriteCells(outcome: PublishOutcome): Record<string, string> {
  switch (outcome.kind) {
    case 'PUBLISHED':
      return {
        status: 'PUBLISHED',
        postUrl: outcome.postUrl,
        updatedBySystemAt: kstStamp(outcome.at),
      }
    case 'HOLD':
      return { status: 'HOLD', holdReason: outcome.reason }
    case 'FAILED':
      return { status: 'FAILED', holdReason: outcome.reason }
    case 'SKIPPED':
      // 🔴 postUrl 없음 — Post 는 다른 후보의 것이다 (§6-10 2·3차 방어).
      return { status: 'SKIPPED', holdReason: outcome.reason }
  }
}

/** `YYYY-MM-DD HH:mm` (KST). Sheet 가 읽는 형식이며 parseKst 가 되읽을 수 있다 */
function kstStamp(at: Date): string {
  const k = new Date(at.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

/**
 * Sheet 에 쓰려는 열들이 화이트리스트 안에 있는지 본다.
 *
 * 🔴 이 함수는 아무것도 쓰지 않는다. 판정만 한다 —
 *    실제 write 는 PR-C2b 가 하고, 그 앞에 이 게이트를 둔다.
 *
 * @param columns 쓰려는 열 이름 목록
 */
export function verifySheetWriteColumns(columns: unknown): SheetWriteVerdict {
  if (!Array.isArray(columns)) {
    return { ok: false, reason: `쓰려는 열 목록이 배열이 아니다: ${JSON.stringify(columns)}` }
  }
  if (columns.length === 0) {
    return { ok: false, reason: '쓰려는 열이 없다. 빈 write 는 의도를 알 수 없다' }
  }

  const allowed = new Set<string>(SHEET_WRITABLE_COLUMNS)
  const rejected: string[] = []

  for (const raw of columns) {
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name) {
      rejected.push(JSON.stringify(raw))
      continue
    }
    if (!allowed.has(name)) rejected.push(name)
  }

  if (rejected.length) {
    return {
      ok: false,
      reason:
        `Sheet 에 쓸 수 없는 열이다: ${rejected.join(', ')}. ` +
        `허용: ${SHEET_WRITABLE_COLUMNS.join(' · ')} (§6-7-A)`,
    }
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────
// ⑧ cap 실측 강제 (§6-5 · §6-9-F)
// ─────────────────────────────────────────────────────────

/** cap 을 실측하지 않고 판정하려 했다는 뜻 */
export class CapContextNotMeasuredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapContextNotMeasuredError'
  }
}

export type CapContext = {
  /** PUBLISHED 인 후보가 아직 0건인가 (DB 실측) */
  isFirstRun: boolean
  /** 오늘 PUBLISHED 로 전이한 건수 (DB 실측) */
  publishedToday: number
}

/**
 * validateBatch 에 넘길 cap context 를 검증한다.
 *
 * 🔴 validateBatch 는 `context.isFirstRun ?? false` · `context.publishedToday ?? 0` 으로
 *    받는다. 즉 **안 넘기면 cap 이 조용히 열린다** — first-run 이 아닌 것으로 보이고
 *    오늘 발행량이 0 으로 보인다. hasPost 미실측과 같은 종류의 사고다.
 *
 *    그래서 publisher 는 이 함수를 통과한 값만 넘긴다. 보정하지 않고 던진다.
 *
 * @throws CapContextNotMeasuredError 실측되지 않았을 때
 */
export function requireCapContext(ctx: unknown): CapContext {
  if (!ctx || typeof ctx !== 'object') {
    throw new CapContextNotMeasuredError(
      'cap context 가 없다. isFirstRun · publishedToday 를 DB 에서 실측해 넘긴다 (§6-9-F).',
    )
  }

  const { isFirstRun, publishedToday } = ctx as Partial<CapContext>

  if (typeof isFirstRun !== 'boolean') {
    throw new CapContextNotMeasuredError(
      `isFirstRun 을 실측하지 못했다 (${JSON.stringify(isFirstRun)}). ` +
        'false 로 보정하면 first-run guard 가 조용히 열린다.',
    )
  }

  if (!Number.isInteger(publishedToday) || (publishedToday as number) < 0) {
    throw new CapContextNotMeasuredError(
      `publishedToday 를 실측하지 못했다 (${JSON.stringify(publishedToday)}). ` +
        '0 으로 보정하면 daily cap 이 조용히 열린다.',
    )
  }

  return { isFirstRun, publishedToday: publishedToday as number }
}

// ─────────────────────────────────────────────────────────
// ⑨ Post 생성 입구 단일화 (§6-9-C)
// ─────────────────────────────────────────────────────────

/** 3축 플래그를 직접 만졌다는 뜻. buildMicroSeedPostData 를 거쳐야 한다 */
export class PostDataBypassError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PostDataBypassError'
  }
}

/**
 * Post 생성 payload 가 buildMicroSeedPostData 를 거쳤는지 확인한다.
 *
 * 🔴 buildMicroSeedPostData 가 3축을 강제해도, publisher 가 그 함수를 거치지 않고
 *    prisma.post.create({ data: {...} }) 를 직접 부르면 우회된다.
 *    함수가 있다는 것과 그 함수만 쓰인다는 것은 다르다.
 *
 *    그래서 create 직전에 이 게이트를 통과시킨다 — 값이 게이트 상수와
 *    **정확히 일치**하지 않으면 던진다.
 *
 * 🔴 3축 값은 post-visibility.ts 의 MICRO_SEED_POST_VISIBILITY_FLAGS 에서만 온다 (C-2).
 *    여기서 true/false 를 다시 적지 않고 그 상수와 대조한다 —
 *    숫자를 두 곳에 적으면 언젠가 갈라진다.
 */
export function assertMicroSeedPostData(data: unknown): asserts data is ReturnType<typeof buildMicroSeedPostData> {
  if (!data || typeof data !== 'object') {
    throw new PostDataBypassError('Post 생성 데이터가 없다. buildMicroSeedPostData 로 만든다.')
  }

  const d = data as Record<string, unknown>
  const mismatched: string[] = []

  for (const [key, expected] of Object.entries(MICRO_SEED_POST_VISIBILITY_FLAGS)) {
    if (d[key] !== expected) mismatched.push(`${key}=${JSON.stringify(d[key])} (기대 ${expected})`)
  }
  if (d.source !== MICRO_SEED_POST_FLAGS.source) {
    mismatched.push(`source=${JSON.stringify(d.source)} (기대 ${MICRO_SEED_POST_FLAGS.source})`)
  }
  if (d.status !== MICRO_SEED_POST_FLAGS.status) {
    mismatched.push(`status=${JSON.stringify(d.status)} (기대 ${MICRO_SEED_POST_FLAGS.status})`)
  }

  if (mismatched.length) {
    throw new PostDataBypassError(
      `Post 생성 데이터가 게이트를 거치지 않았다: ${mismatched.join(' · ')}. ` +
        'buildMicroSeedPostData() 로만 만든다 (§6-9-C).',
    )
  }
}
