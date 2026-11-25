/**
 * 글 하나의 **대화 계획** — 🔴 순수 함수. DB · 시계 · 네트워크 · provider 없음
 *
 * 계획은 코드가, 말은 모델이 정한다. 글 id 하나로 그 글에 Persona 댓글이 몇 개 달릴지, 자리마다 누가 어디에
 * 어떤 모양으로 언제쯤 말할지가 정해진다. 길이는 계획이 정하지 않는다 — 자리마다 뽑는 실제 댓글 하나의 꼴 값이 정한다(`persona-comment-form`). 저장하지 않는다 — 같은 글은 언제 다시 세워도 같은 계획이다.
 *
 * 🔴 숫자는 `persona-thread-target` 의 둘(글당 목표 평균 · 대화 마감)뿐이다. 크기 분포 · 자리 종류 수 · 간격이 거기서 나온다.
 *    뜨거운 글은 그 줄의 `hot` 칸이 크기 범위만 바꾼다 — 자리 종류 · 모양 · 간격은 같은 식이다.
 *
 * · 1번 자리는 첫 댓글 레인(`persona-comment-auto-lane`)의 것이다. 이 파일은 2번 자리부터 정한다.
 * · 자리 종류는 셋뿐이다 — 글에 답(새 사람) · 글쓴이가 앞 댓글에 답 · 다른 사람이 앞 댓글에 답.
 * · 자리가 지금 설 수 있는지(대상이 살아 있는지 · 사람이 있는지)는 부르는 쪽이 사실로 본다. 계획은 **먼저 서 볼 순서**만 준다.
 */
import { createHash } from 'node:crypto'

import { REAL_REACTION_SHARE, type ReactionType } from './persona-reaction-roles'
import {
  PLAN_AUTHOR_SEATS_MAX, PLAN_MIN_GAP_MS, PLAN_RUNNER_TICK_MS, THREAD_DEADLINE_MS, THREAD_SIZE_MIN, threadHotAt, threadMeanSizeAt, threadSizeMaxOf,
  type ThreadHot,
} from './persona-thread-target'

export { PLAN_MIN_GAP_MS, THREAD_DEADLINE_MS } from './persona-thread-target'

/** [0, 1) — sha256 앞 13자리. 계획의 모든 선택과 동률 순서가 이것 하나로 정해진다 */
export function unitOf(...parts: readonly string[]): number {
  const hex = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 13)
  return parseInt(hex, 16) / 2 ** 52
}

/** 글에 답(새 사람의 새 댓글) · 글쓴이 답글 · 다른 사람의 답글 */
export type PlanSeatKind = 'post' | 'author' | 'reply'

export type PlanSlot = {
  /** 이 글의 몇 번째 Persona 댓글인가(2부터) */
  ordinal: number
  kind: PlanSeatKind
  /** 이 자리의 모양 — 한마디(other) · 공감 · 되묻기 · 경험으로 답 */
  shape: ReactionType
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
  return binomialSizeCdf(THREAD_SIZE_MIN, n, (meanSize - THREAD_SIZE_MIN) / n)
}
/**
 * 🔴 **뜨거운 글 크기 분포(누적)** — 크기 = `sizeMin` + 이항(`sizeMax − sizeMin`, ½). 12~20 이면 평균 16 · 18 이상은 37/256(약 14%).
 *    보통 글과 같은 식(이항)이고 확률만 ½ 로 고정이다 — 새 숫자는 줄의 `hot` 칸뿐이다.
 */
export function hotSizeCdfOf(hot: ThreadHot): readonly (readonly [size: number, upTo: number])[] {
  return binomialSizeCdf(hot.sizeMin, hot.sizeMax - hot.sizeMin, 0.5)
}
function binomialSizeCdf(min: number, n: number, p: number): readonly (readonly [size: number, upTo: number])[] {
  let c = 1
  let acc = 0
  return Array.from({ length: n + 1 }, (_, k) => {
    if (k > 0) c = (c * (n - k + 1)) / k
    acc += c * p ** k * (1 - p) ** (n - k)
    return [min + k, k === n ? 1 : acc] as const
  })
}
/** 자리 종류가 허용하는 모양 — 그 안에서 실제 몫(`REAL_REACTION_SHARE`)으로 뽑는다 */
const SHAPES: Readonly<Record<PlanSeatKind, readonly ReactionType[]>> = {
  post: ['other', 'empathy', 'question', 'experience'],
  author: ['other', 'experience', 'question'],
  reply: ['other', 'empathy', 'question'],
}
/** 자리 종류의 몫 — 새 사람의 글에 답 절반 · 글쓴이 답글 4분의 1(상한 `PLAN_AUTHOR_SEATS_MAX`) · 나머지 답글 */
const POST_SHARE = 0.5
const AUTHOR_SHARE = 0.25
const pick = <T>(cdf: readonly (readonly [T, number])[], u: number): T => (cdf.find(([, upTo]) => u < upTo) ?? cdf[cdf.length - 1]!)[0]
/** 허용된 모양들의 누적 몫 — 몫 없는 모양은 빠지고 남은 몫을 1로 다시 맞춘다 */
const shapeCdfOf = (shapes: readonly ReactionType[]): readonly (readonly [ReactionType, number])[] => {
  const total = shapes.reduce((a, r) => a + (REAL_REACTION_SHARE[r] ?? 0), 0)
  let acc = 0
  return shapes.flatMap((r) => {
    const w = REAL_REACTION_SHARE[r] ?? 0
    if (w <= 0) return []
    acc += w / total
    return [[r, acc] as const]
  })
}
const SHAPE_CDF: Readonly<Record<PlanSeatKind, readonly (readonly [ReactionType, number])[]>> = {
  post: shapeCdfOf(SHAPES.post), author: shapeCdfOf(SHAPES.author), reply: shapeCdfOf(SHAPES.reply),
}

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

/**
 * @param publishedAtMs 공개 시각 — 그때 효력이 있던 줄(목표 평균 · 뜨거운 글 칸)을 쓴다. 모르면 마지막 줄
 * @param hot 이 글이 뜨거운가(`isHotThread`) — 🔴 기본값이 없다. 부르는 곳(생성 판정 · 발행 트랜잭션)이 같은 판독을 넘겨야
 *            한 곳만 고친 상태가 컴파일되지 않는다. 뜨거워도 그 줄에 `hot` 칸이 없으면 보통 글 계획이다(옛 글 소급 0).
 */
export function threadPlanOf(postId: string, publishedAtMs: number | null, hot: boolean): ThreadPlan {
  const hotLine = hot ? threadHotAt(publishedAtMs) : null
  // 🔴 같은 씨앗 — 보통 글이든 뜨거운 글이든 크기는 `plan-size` 한 번의 추첨이다
  const cdf = hotLine === null ? threadSizeCdfOf(threadMeanSizeAt(publishedAtMs)) : hotSizeCdfOf(hotLine)
  const size = pick(cdf, unitOf('plan-size', postId))
  const counts = kindCounts(size)
  const kinds = (Object.keys(counts) as PlanSeatKind[])
    .flatMap((k) => Array.from({ length: counts[k] }, (_, n) => ({ k, u: unitOf('plan-order', postId, k, String(n)) })))
    .sort((a, b) => a.u - b.u).map((x) => x.k)
  // 🔴 묻는 글에 답하는 사람이 앞쪽에 있어야 한다 — 세 번째 댓글 안에 "글에 답"이 하나는 온다
  const firstPost = kinds.indexOf('post')
  if (firstPost > 1) { kinds.splice(firstPost, 1); kinds.splice(1, 0, 'post') }
  const gaps = gapsOf(postId, size)
  const slots = kinds.map((kind, i): PlanSlot => {
    const ordinal = i + 2
    return { ordinal, kind, shape: pick(SHAPE_CDF[kind], unitOf('plan-shape', postId, String(ordinal))), gapMs: gaps[i]! }
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
