/**
 * 🔴 **검토자 출처(reviewer provenance) — 정본은 이 파일 하나다** (2026-09-25 · auto-ready 증거)
 *
 * 왜 필요한가 — `decidedBy` 에는 `'founder'` 하나만 들어간다. 그런데 그 값을 쓰는 스크립트
 * (`publish:machine-review` · `original-post-decide`)는 **누가 실행했든** `'founder'` 를 적는다.
 * Codex·Claude 가 돌려도 창업자가 본 것처럼 남는다. 그 값을 그대로 "사람 정답 표본" 으로 세면
 * 자동 READY 정확도가 **기계가 기계를 채점한 값**이 된다.
 *
 * 🔴 **두 가지를 섞지 않는다.**
 *    · 운영 승인 표식 — `decidedBy='founder'`(`LEGACY_DECISION_MARK`). 발행 게이트가 읽는다.
 *      Codex/Claude 판정도 운영 승인 근거가 될 수 있다 — 이 값의 뜻은 그대로 둔다.
 *    · 정답 표본 출처 — `ReviewerKind`. 자동 READY 증거는 **이것만** 본다.
 *      사람 종류(`human:*`)만 정답 표본이 된다. 🔴 모르는 문자열은 사람이 아니다(fail-closed).
 *
 * 🔴 **legacy `founder` 행은 자동으로 사람 표본이 되지 않는다.** 누가 검토했는지 DB 에 없기
 *    때문이다. 사람이 배치 검토 묶음을 보고 `human:*` 검토 기록을 남긴 행만 표본이 된다.
 */

/** 🔴 운영 승인 표식 — 옛 계약 그대로다. 사람 정답 표본을 뜻하지 **않는다** */
export const LEGACY_DECISION_MARK = 'founder'

/** 🔴 검토자 종류 — 닫힌 목록이다. 새 종류는 여기에만 더한다 */
export const REVIEWER_KINDS = [
  /** 🔴 예약값 — 지금 어떤 경로도 이 값을 쓰지 않는다. 사람 기록은 human:operator + reviewerUserId 다 */
  'human:founder',
  'human:operator',
  'codex:master-review',
  'model:semantic-audit',
  'machine:auto-ready',
] as const
export type ReviewerKind = (typeof REVIEWER_KINDS)[number]

/** 🔴 사람 정답 표본이 될 수 있는 종류 — 이 둘뿐이다 */
export const HUMAN_REVIEWER_KINDS = ['human:founder', 'human:operator'] as const satisfies readonly ReviewerKind[]
export type HumanReviewerKind = (typeof HUMAN_REVIEWER_KINDS)[number]

/** 🔴 CLI importer 가 쓸 수 있는 종류 — 비사람뿐이다. 사람 기록은 관리자 서버 경계만 쓴다 */
export const NON_HUMAN_IMPORTABLE: readonly ReviewerKind[] = ['codex:master-review', 'model:semantic-audit']

/** 🔴 정확히 일치할 때만 종류로 인정한다 — 대소문자·공백·접두사 추정 없음 */
export function parseReviewerKind(v: unknown): ReviewerKind | null {
  return typeof v === 'string' && (REVIEWER_KINDS as readonly string[]).includes(v) ? v as ReviewerKind : null
}

export function isHumanReviewer(v: unknown): v is HumanReviewerKind {
  const k = parseReviewerKind(v)
  return k !== null && (HUMAN_REVIEWER_KINDS as readonly string[]).includes(k)
}

/**
 * 🔴 **로그인 세션 → 사람 검토자 종류** — 서버 경계만 부른다. 요청 본문은 이 값을 정하지 못한다.
 *    · 관리자가 아니면 null(기록 거절)
 *    · 인증된 관리자는 모두 `human:operator` 다 — **누구인지의 정본은 `reviewerUserId`(User.id)** 다
 *    🔴 `human:founder` 는 예약값이다. env allowlist 로 나누지 않는다(2026-09-25 마스터 운영 단순화).
 */
export function resolveHumanReviewer(user: { isAdmin: boolean }): HumanReviewerKind | null {
  return user.isAdmin ? 'human:operator' : null
}
