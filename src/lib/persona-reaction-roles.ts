/**
 * 반응 역할 **어휘 정본** — 🔴 순수 상수. 여기 없는 값은 어디서도 쓰지 않는다
 *
 * 🔴 **왜 여기로 올렸나** (2026-09-09).
 *
 *    댓글 분산 planner 가 `share` 라는 역할을 배정하고 있었다. 그런데 생성기가 받는
 *    `REACTION_TYPES` 에는 `share` 가 없다 — planner 가 고른 것을 `buildPrompt` 가
 *    `REACTION_TYPE_INVALID` 로 거부한다. **계획과 생성이 다른 낱말을 쓰고 있었다.**
 *
 *    어휘가 두 곳에 있으면 언젠가 갈린다. 그래서 정본을 `src/lib` 로 올리고
 *    `scripts/lib/persona-prompt.ts` 는 여기서 다시 내보낸다.
 *    scripts 는 src 를 import 할 수 있지만 그 반대는 Next 빌드 경계를 넘는다 —
 *    그래서 방향은 이쪽이다.
 */

/** 🔴 생성기가 받는 전체 어휘. 늘리려면 프롬프트의 REACTION_GUIDE 도 함께 늘린다 */
export const REACTION_TYPES = [
  'empathy', 'question', 'rebuttal', 'experience', 'information', 'other',
] as const

export type ReactionType = (typeof REACTION_TYPES)[number]

export const isReactionType = (v: unknown): v is ReactionType =>
  typeof v === 'string' && (REACTION_TYPES as readonly string[]).includes(v)

/**
 * 🔴 이번 범위에서 **만들지 않는** 역할.
 *
 *    `advice` · `caution` 은 전면 금지다. 둘은 애초에 `REACTION_TYPES` 에도 없지만,
 *    "없으니 괜찮다" 로 두지 않는다 — 어휘가 늘어날 때 조용히 들어오는 자리다.
 */
export const FORBIDDEN_REACTION_ROLES: readonly string[] = ['advice', 'caution']

/**
 * 🔴 **댓글 분산 planner 가 배정할 수 있는 역할.**
 *
 *    `REACTION_TYPES` 의 부분집합이어야 한다 — 아니면 planner 가 고른 것을
 *    생성기가 거부한다. `persona-comment-engine-check` 가 부분집합임을 행동으로 잠근다.
 *
 *    `rebuttal`(반박)·`information`(정보)·`other` 는 넣지 않는다.
 *    반박은 첫 댓글로 붙을 자리가 아니고, 정보 제공은 조언 금지선에 너무 가깝다.
 */
export const COMMENT_REACTION_ROLES: readonly ReactionType[] = ['empathy', 'question', 'experience']
