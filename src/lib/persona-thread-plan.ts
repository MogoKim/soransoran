/**
 * 글 하나의 **대화 계획** — 🔴 순수 함수. DB · 시계 · 네트워크 · provider 없음
 *
 * 계획은 코드가, 말은 모델이 정한다. 글 id 하나로 그 글에 Persona 댓글이 몇 개 달릴지, 자리마다 누가 어디에
 * 어떤 모양·길이로 언제쯤 말할지가 정해진다. 저장하지 않는다 — 같은 글은 언제 다시 세워도 같은 계획이다.
 *
 * 🔴 숫자는 `persona-thread-target` 의 둘(글당 목표 평균 · 대화 마감)뿐이다. 크기 분포 · 자리 종류 수 · 간격이 거기서 나온다.
 *
 * · 1번 자리는 첫 댓글 레인(`persona-comment-auto-lane`)의 것이다. 이 파일은 2번 자리부터 정한다.
 * · 자리 종류는 셋뿐이다 — 글에 답(새 사람) · 글쓴이가 앞 댓글에 답 · 다른 사람이 앞 댓글에 답.
 * · 자리가 지금 설 수 있는지(대상이 살아 있는지 · 사람이 있는지)는 부르는 쪽이 사실로 본다. 계획은 **먼저 서 볼 순서**만 준다.
 */
import { createHash } from 'node:crypto'

import type { ReactionType } from './persona-reaction-roles'
import {
  PLAN_AUTHOR_SEATS_MAX, PLAN_MIN_GAP_MS, PLAN_RUNNER_TICK_MS, THREAD_DEADLINE_MS, THREAD_SIZE_MIN, threadMeanSizeAt, threadSizeMaxOf,
} from './persona-thread-target'

export { PLAN_MIN_GAP_MS, THREAD_DEADLINE_MS } from './persona-thread-target'

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

/**
 * 🔴 **크기 분포(누적) — 평균에서 나온다.** 크기 = 하한 + 이항(n, p) · n = 상한 − 하한 · p = (평균 − 하한) ÷ n.
 *    평균이 정확히 그 값이고, 가운데가 두텁고 양 끝이 얇다.
 */
export function threadSizeCdfOf(meanSize: number): readonly (readonly [size: number, upTo: number])[] {
  const n = threadSizeMaxOf(meanSize) - THREAD_SIZE_MIN
  const p = (meanSize - THREAD_SIZE_MIN) / n
  let c = 1
  let acc = 0
  return Array.from({ length: n + 1 }, (_, k) => {
    if (k > 0) c = (c * (n - k + 1)) / k
    acc += c * p ** k * (1 - p) ** (n - k)
    return [THREAD_SIZE_MIN + k, k === n ? 1 : acc] as const
  })
}
/** 길이 분포(누적) — 한 줄 30% · 한두 문장 50% · 서너 문장 20% */
const LENGTH_CDF: readonly (readonly [PlanLength, number])[] = [['short', 0.3], ['normal', 0.8], ['long', 1]]

const SHAPES: Readonly<Record<PlanSeatKind, readonly ReactionType[]>> = {
  post: ['other', 'empathy', 'question', 'experience'],
  author: ['other', 'experience', 'question'],
  reply: ['other', 'empathy', 'question'],
}
/** 자리 종류의 몫 — 새 사람의 글에 답 절반 · 글쓴이 답글 4분의 1(상한 `PLAN_AUTHOR_SEATS_MAX`) · 나머지 답글 */
const POST_SHARE = 0.5
const AUTHOR_SHARE = 0.25
const pick = <T>(cdf: readonly (readonly [T, number])[], u: number): T => (cdf.find(([, upTo]) => u < upTo) ?? cdf[cdf.length - 1]!)[0]

/** 자리 종류별 개수 — 4개 이상인 글은 글쓴이 아닌 사람이 3명 이상(첫 댓글 1 + 새 댓글 2)이 되게 한다 */
function kindCounts(size: number): Record<PlanSeatKind, number> {
  const extras = size - 1
  const post = size >= 4 ? Math.max(2, Math.round(extras * POST_SHARE)) : size === 3 ? 1 : 0
  const author = Math.min(PLAN_AUTHOR_SEATS_MAX, extras - post, Math.max(1, Math.round(extras * AUTHOR_SHARE)))
  return { post, author, reply: extras - post - author }
}

/**
 * 🔴 **간격 — 마감에서 역산한다.** 마감에서 자리마다 러너 틱 하나씩을 먼저 떼고, 남은 시간을 크기로 나눈 것이 평균 간격이다.
 *    자리마다 0.5~1.5배로 흩되 합은 흩기 전과 같게 맞춘다 — 큰 대화일수록 빨리 돌고, 어느 글이든 마감 안에 끝난다.
 *    (옛 식은 뒤 자리일수록 길어 큰 대화일수록 느렸다)
 */
function gapsOf(postId: string, size: number): number[] {
  const n = size - 1
  const base = Math.max(0, THREAD_DEADLINE_MS - size * PLAN_RUNNER_TICK_MS) / size
  const w = Array.from({ length: n }, (_, i) => 0.5 + unitOf('plan-gap', postId, String(i + 2)))
  const sum = w.reduce((a, b) => a + b, 0)
  return w.map((x) => Math.max(PLAN_MIN_GAP_MS, Math.floor((base * n * x) / sum)))
}

/** @param publishedAtMs 공개 시각 — 그때 효력이 있던 목표 평균을 쓴다. 모르면 마지막 줄 */
export function threadPlanOf(postId: string, publishedAtMs: number | null = null): ThreadPlan {
  const size = pick(threadSizeCdfOf(threadMeanSizeAt(publishedAtMs)), unitOf('plan-size', postId))
  const counts = kindCounts(size)
  const kinds = (Object.keys(counts) as PlanSeatKind[])
    .flatMap((k) => Array.from({ length: counts[k] }, (_, n) => ({ k, u: unitOf('plan-order', postId, k, String(n)) })))
    .sort((a, b) => a.u - b.u).map((x) => x.k)
  // 🔴 묻는 글에 답하는 사람이 앞쪽에 있어야 한다 — 세 번째 댓글 안에 "글에 답"이 하나는 온다
  const firstPost = kinds.indexOf('post')
  if (firstPost > 1) { kinds.splice(firstPost, 1); kinds.splice(1, 0, 'post') }
  const gaps = gapsOf(postId, size)
  let experienceGiven = false
  const slots = kinds.map((kind, i): PlanSlot => {
    const ordinal = i + 2
    const key = String(ordinal)
    let shape = SHAPES[kind][Math.floor(unitOf('plan-shape', postId, key) * SHAPES[kind].length)]!
    // 🔴 첫 "글에 답"은 경험으로 답한다 — 되묻기·공감만 달리는 글을 만들지 않는다
    if (kind === 'post' && !experienceGiven) { shape = 'experience'; experienceGiven = true }
    return { ordinal, kind, shape, length: pick(LENGTH_CDF, unitOf('plan-length', postId, key)), gapMs: gaps[i]! }
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
