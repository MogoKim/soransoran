/**
 * 대화 계획의 **목표 숫자** — 🔴 상수와 산수뿐. import 0 (고객·운영 화면 번들이 `persona-target-rules` 를 거쳐 읽는다)
 *
 * 🔴 **숫자는 둘이다 — 글당 목표 평균(`THREAD_TARGETS`)과 대화 마감(`THREAD_DEADLINE_MS`).**
 *    크기 분포 · 크기 범위 · 자리 종류 수 · 간격(`persona-thread-plan`) · 글당 구조 상한(`PERSONA_COMMENTS_PER_POST_MAX`) ·
 *    하루 댓글 총량과 한 사람 상한(`followup-profile-derive`)이 전부 여기서 나온다. 평균을 올릴 때 고칠 곳은 `THREAD_TARGETS` 한 줄뿐이다.
 */

const MIN = 60_000
const HOUR = 60 * MIN

/**
 * 🔴 **글당 목표 평균 Persona 댓글 수(첫 댓글 포함)** — 글은 공개 시각에 효력이 있던 줄을 쓴다.
 *    평균을 바꿀 때는 줄을 **덧붙인다**(`since` = 배포 시각). 있는 줄을 고치면 이미 공개된 글의 계획이 바뀌어
 *    끝난 대화에 새 자리가 열린다. 첫 줄보다 이른 글은 첫 줄을 쓴다.
 */
export const THREAD_TARGETS: readonly { since: string; meanSize: number }[] = [
  { since: '2026-11-19T22:00:00+09:00', meanSize: 6 },
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
/** 🔴 지금까지의 모든 줄 중 가장 큰 크기 — 글당 구조 상한(`PERSONA_COMMENTS_PER_POST_MAX`)이 이것이다 */
export const THREAD_SIZE_CAP = Math.max(...THREAD_TARGETS.map((t) => threadSizeMaxOf(t.meanSize)))

/** 🔴 글쓴이 답글 자리 상한 — 대화 감사가 FAIL 로 세는 구조 상한(`PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX`)이 이 값이다 */
export const PLAN_AUTHOR_SEATS_MAX = 3

/** 공개 시각에 효력이 있던 목표 평균. 모르면(null) 마지막 줄 */
export function threadMeanSizeAt(publishedAtMs: number | null): number {
  if (publishedAtMs === null) return THREAD_TARGETS[THREAD_TARGETS.length - 1]!.meanSize
  const inEffect = THREAD_TARGETS.filter((t) => Date.parse(t.since) <= publishedAtMs)
  return (inEffect[inEffect.length - 1] ?? THREAD_TARGETS[0]!).meanSize
}
