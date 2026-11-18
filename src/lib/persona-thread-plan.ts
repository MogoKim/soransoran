/**
 * 글 하나의 **대화 계획** — 🔴 순수 함수. DB · 시계 · 네트워크 · provider 없음
 *
 * 계획은 코드가, 말은 모델이 정한다. 글 id 하나로 그 글에 Persona 댓글이 몇 개 달릴지, 자리마다 누가 어디에
 * 어떤 모양·길이로 언제쯤 말할지가 정해진다. 저장하지 않는다 — 같은 글은 언제 다시 세워도 같은 계획이다.
 *
 * · 1번 자리는 첫 댓글 레인(`persona-comment-auto-lane`)의 것이다. 이 파일은 2번 자리부터 정한다.
 * · 자리 종류는 셋뿐이다 — 글에 답(새 사람) · 글쓴이가 앞 댓글에 답 · 다른 사람이 앞 댓글에 답.
 * · 자리가 지금 설 수 있는지(대상이 살아 있는지 · 사람이 있는지)는 부르는 쪽이 사실로 본다. 계획은 **먼저 서 볼 순서**만 준다.
 */
import { createHash } from 'node:crypto'

import type { ReactionType } from './persona-reaction-roles'

/** [0, 1) — sha256 앞 13자리. 계획의 모든 선택과 동률 순서가 이것 하나로 정해진다 */
export function unitOf(...parts: readonly string[]): number {
  const hex = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 13)
  return parseInt(hex, 16) / 2 ** 52
}

/** 글에 답(새 사람의 새 댓글) · 글쓴이 답글 · 다른 사람의 답글 */
export type PlanSeatKind = 'post' | 'author' | 'reply'
/** 한 줄(20자 안팎) · 한두 문장 · 서너 문장 */
export type PlanLength = 'short' | 'normal' | 'long'

export type PlanSlot = {
  /** 이 글의 몇 번째 Persona 댓글인가(2부터) */
  ordinal: number
  kind: PlanSeatKind
  /** 이 자리의 모양 — 한마디(other) · 공감 · 되묻기 · 경험으로 답 */
  shape: ReactionType
  length: PlanLength
  /** 앞 Persona 댓글에서 이만큼 지난 뒤에 선다 */
  gapMs: number
}

export type ThreadPlan = { size: number; slots: readonly PlanSlot[] }

/** 🔴 글당 Persona 댓글 수 분포(누적) — 평균 4.5 · 최대 10 */
export const PLAN_SIZE_CDF: readonly (readonly [size: number, upTo: number])[] = [
  [2, 0.10], [3, 0.30], [4, 0.55], [5, 0.75], [6, 0.87], [7, 0.93], [8, 0.98], [10, 1],
]
/** 길이 분포(누적) — 한 줄 30% · 한두 문장 50% · 서너 문장 20% */
const LENGTH_CDF: readonly (readonly [PlanLength, number])[] = [['short', 0.3], ['normal', 0.8], ['long', 1]]

const MIN = 60_000
/** 🔴 가장 짧은 간격 — 발행 트랜잭션이 다시 보는 하한이다 */
export const PLAN_MIN_GAP_MS = 10 * MIN
/** 자리가 뒤로 갈수록 이만큼씩 더 띄우고(상한 60분), 그 위에 0~30분을 글·자리마다 결정적으로 흩는다 */
const GAP_STEP_MS = 10 * MIN
const GAP_BASE_MAX_MS = 60 * MIN
const GAP_JITTER_MS = 30 * MIN

const SHAPES: Readonly<Record<PlanSeatKind, readonly ReactionType[]>> = {
  post: ['other', 'empathy', 'question', 'experience'],
  author: ['other', 'experience', 'question'],
  reply: ['other', 'empathy', 'question'],
}

const pick = <T>(cdf: readonly (readonly [T, number])[], u: number): T => (cdf.find(([, upTo]) => u < upTo) ?? cdf[cdf.length - 1]!)[0]

/** 자리 종류별 개수 — 4개 이상인 글은 글쓴이 아닌 사람이 3명 이상(첫 댓글 1 + 새 댓글 2)이 되게 한다 */
function kindCounts(size: number): Record<PlanSeatKind, number> {
  const extras = size - 1
  const post = size >= 4 ? Math.max(2, Math.round(extras * 0.5)) : size === 3 ? 1 : 0
  const author = Math.min(3, extras - post, Math.max(1, Math.round(extras * 0.3)))
  return { post, author, reply: extras - post - author }
}

export function threadPlanOf(postId: string): ThreadPlan {
  const size = pick(PLAN_SIZE_CDF, unitOf('plan-size', postId))
  const counts = kindCounts(size)
  const kinds = (Object.keys(counts) as PlanSeatKind[])
    .flatMap((k) => Array.from({ length: counts[k] }, (_, n) => ({ k, u: unitOf('plan-order', postId, k, String(n)) })))
    .sort((a, b) => a.u - b.u).map((x) => x.k)
  // 🔴 묻는 글에 답하는 사람이 앞쪽에 있어야 한다 — 세 번째 댓글 안에 "글에 답"이 하나는 온다
  const firstPost = kinds.indexOf('post')
  if (firstPost > 1) { kinds.splice(firstPost, 1); kinds.splice(1, 0, 'post') }
  let experienceGiven = false
  const slots = kinds.map((kind, i): PlanSlot => {
    const ordinal = i + 2
    const key = String(ordinal)
    let shape = SHAPES[kind][Math.floor(unitOf('plan-shape', postId, key) * SHAPES[kind].length)]!
    // 🔴 첫 "글에 답"은 경험으로 답한다 — 되묻기·공감만 달리는 글을 만들지 않는다
    if (kind === 'post' && !experienceGiven) { shape = 'experience'; experienceGiven = true }
    return {
      ordinal, kind, shape,
      length: pick(LENGTH_CDF, unitOf('plan-length', postId, key)),
      gapMs: PLAN_MIN_GAP_MS + Math.min(GAP_BASE_MAX_MS - PLAN_MIN_GAP_MS, i * GAP_STEP_MS)
        + Math.floor(unitOf('plan-gap', postId, key) * GAP_JITTER_MS),
    }
  })
  return { size, slots }
}

/**
 * 이 순번의 자리. 순번은 지운 댓글까지 세어 올라가므로 계획 크기를 넘을 수 있다 — 그때는 마지막 자리를 쓴다
 * (계획을 다 채웠는지는 **살아 있는 댓글 수**로 부르는 쪽이 본다).
 */
export function planSlotAt(plan: ThreadPlan, ordinal: number): PlanSlot | null {
  if (plan.slots.length === 0 || ordinal < 2) return null
  return plan.slots[Math.min(ordinal, plan.size) - 2] ?? plan.slots[plan.slots.length - 1]!
}
