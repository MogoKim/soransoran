/**
 * 대화 계획의 **목표 숫자** — 🔴 상수와 산수뿐. import 0 (고객·운영 화면 번들이 `persona-target-rules` 를 거쳐 읽는다)
 *
 * 🔴 **숫자는 둘이다 — 글당 목표 평균(`THREAD_TARGETS`)과 대화 마감(`THREAD_DEADLINE_MS`).**
 *    크기 분포 · 크기 범위 · 자리 종류 수 · 간격(`persona-thread-plan`) · 글당 구조 상한(`PERSONA_COMMENTS_PER_POST_MAX`) ·
 *    하루 댓글 총량과 한 사람 상한(`followup-profile-derive`)이 전부 여기서 나온다. 평균을 올릴 때 고칠 곳은 `THREAD_TARGETS` 한 줄뿐이다.
 *    뜨거운 글의 크기 범위(`hot`)도 그 줄 안에 있다 — 줄과 함께 효력이 생기고, 옛 글에는 소급되지 않는다.
 */

const MIN = 60_000
const HOUR = 60 * MIN

/**
 * 🔴 **뜨거운 글** (2026-11-25 밤 4 · 창업자 11-24 승인) — 원천에서 댓글이 많이 달린 글은 대화를 더 길게 계획한다.
 *    뜨거운가 = 그 글 원천의 댓글 수 상대 위치(`sourceStats.commentsPct`)가 `commentsPctMin` 이상(판독은 `persona-thread-hot`).
 *    크기 = `sizeMin` + 이항(`sizeMax − sizeMin`, ½) — 보통 글과 같은 씨앗이다(`persona-thread-plan`).
 *    문턱 0.85 의 근거: 최근 14일 공개 344편 중 9.3% — D50(50편)이면 하루 약 4.7편(11-25 아침 호스트 읽기 전용 실측).
 */
export type ThreadHot = { commentsPctMin: number; sizeMin: number; sizeMax: number }

/**
 * 🔴 **글당 목표 평균 Persona 댓글 수(첫 댓글 포함)** — 글은 공개 시각에 효력이 있던 줄을 쓴다.
 *    평균을 바꿀 때는 줄을 **덧붙인다**(`since` = 배포 시각). 있는 줄을 고치면 이미 공개된 글의 계획이 바뀌어
 *    끝난 대화에 새 자리가 열린다. 첫 줄보다 이른 글은 첫 줄을 쓴다. `hot` 이 없는 줄의 글은 뜨거울 수 없다.
 *    🔴 한 줄은 한 줄에 적는다(`since` 와 `hot` 이 같은 줄) — 배포 게이트가 그 줄을 grep 으로 찾는다.
 */
export const THREAD_TARGETS: readonly { since: string; meanSize: number; hot?: ThreadHot }[] = [
  { since: '2026-11-19T22:00:00+09:00', meanSize: 6 },
  { since: '2026-11-26T00:00:00+09:00', meanSize: 7, hot: { commentsPctMin: 0.85, sizeMin: 12, sizeMax: 20 } },
]
/** 🔴 대화 마감 — 공개 뒤 이 시간이 지나면 새 자리를 열지 않는다. 간격이 이것에서 역산된다 */
export const THREAD_DEADLINE_MS = 8 * HOUR
/** 🔴 가장 짧은 간격 — 발행 트랜잭션이 다시 보는 하한이다(`FOLLOWUP_MIN_GAP_MS`) */
export const PLAN_MIN_GAP_MS = 10 * MIN
/**
 * 댓글 러너 틱 간격(`COMMENT_RUNNER_MAX_GAP_MINUTES`) — 자리마다 다음 틱까지 기다리는 시간을 마감 안에 미리 남긴다.
 * 🔴 이 파일은 scripts 를 import 하지 않는다. 같은 값인지는 `persona-comment-followup-check` 가 잰다.
 */
export const PLAN_RUNNER_TICK_MS = 20 * MIN

/** 크기 하한 — 첫 댓글 하나로 끝나는 글은 계획하지 않는다 */
export const THREAD_SIZE_MIN = 2
/** 평균 → 크기 상한. 평균 6 이면 12 */
export const threadSizeMaxOf = (meanSize: number): number => Math.ceil(meanSize * 2)
/** 한 줄이 낼 수 있는 가장 큰 크기 — 보통 글 상한과 뜨거운 글 상한 중 큰 쪽 */
export const threadLineSizeMaxOf = (t: { meanSize: number; hot?: ThreadHot }): number =>
  Math.max(threadSizeMaxOf(t.meanSize), t.hot?.sizeMax ?? 0)
/**
 * 🔴 지금까지의 모든 줄 중 가장 큰 크기(뜨거운 글 포함) — 글당 구조 상한(`PERSONA_COMMENTS_PER_POST_MAX`)이 이것이다.
 *    모듈을 읽을 때 정해진다 — 줄을 덧붙이면 `since` 와 무관하게 **배포 즉시** 상한이 바뀐다(밤 4: 12 → 20).
 */
export const THREAD_SIZE_CAP = Math.max(...THREAD_TARGETS.map(threadLineSizeMaxOf))

/** 🔴 글쓴이 답글 자리 상한 — 대화 감사가 FAIL 로 세는 구조 상한(`PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX`)이 이 값이다 */
export const PLAN_AUTHOR_SEATS_MAX = 3

/** 공개 시각에 효력이 있던 줄. 모르면(null) 마지막 줄 — 평균과 뜨거운 글 칸이 같은 선택을 쓴다 */
function threadTargetAt(publishedAtMs: number | null): (typeof THREAD_TARGETS)[number] {
  if (publishedAtMs === null) return THREAD_TARGETS[THREAD_TARGETS.length - 1]!
  const inEffect = THREAD_TARGETS.filter((t) => Date.parse(t.since) <= publishedAtMs)
  return inEffect[inEffect.length - 1] ?? THREAD_TARGETS[0]!
}

/** 공개 시각에 효력이 있던 목표 평균. 모르면(null) 마지막 줄 */
export function threadMeanSizeAt(publishedAtMs: number | null): number {
  return threadTargetAt(publishedAtMs).meanSize
}

/** 🔴 공개 시각에 효력이 있던 줄의 뜨거운 글 칸 — 그 줄에 없으면 null(그 글은 뜨거울 수 없다). 모르면(null) 마지막 줄 */
export function threadHotAt(publishedAtMs: number | null): ThreadHot | null {
  return threadTargetAt(publishedAtMs).hot ?? null
}
