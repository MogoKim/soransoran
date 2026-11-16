import type { BoardType } from '@prisma/client'

/**
 * 홈 인기글 점수 · 게시판별 상위 · 갱년기톡 최소 배분과 그 진단.
 * DB 를 모르는 순수 함수로 둔다 — 표본 데이터만으로 확인할 수 있어야 한다.
 * 🔴 값 import 를 두지 않는다(`import type` 만) — 변이 하네스가 이 파일을 임시 디렉터리에서 그대로 import 한다.
 */

/**
 * 점수 계산에 필요한 최소 입력. 목록 렌더용 필드까지 요구하지 않는다.
 *
 * 🔴 반응은 `realReactions` 다 — 댓글 단 실회원 수(글쓴이 제외) + 비회원 댓글(상한 3)
 *    (popularity-db.ts withRealReactions). 화면 표시용 `_count.comments` 를 받지 않는다.
 *    그 숫자에는 Persona·운영 댓글과 한 사람의 연속 댓글이 섞여 있고,
 *    타입에서 빼 두어야 누가 "있는 숫자" 를 그대로 넘겨 점수를 부풀리지 못한다.
 */
export type ScorablePost = {
  id: string
  boardType: BoardType
  createdAt: Date
  /** 실제 사람 반응 신호 — Persona · 운영 · Micro Seed 원문 · 삭제 · 글쓴이 답글 제외, 사람 단위 */
  realReactions: number
}

/**
 * 점수 = (실반응 신호 + 1) / (경과시간h + 4)^0.8
 *
 *   +1    댓글 0 인 글도 최신성으로 겨루게 한다. 없으면 전부 0 이 되어 정렬이 죽는다.
 *   +4h   방금 올라온 글의 점수가 치솟는 것을 막는다.
 *   0.8   하루 지난 글은 살아남고, 한 달 전 글은 댓글이 많아도 내려가는 기울기다.
 *
 * 조회수·좋아요는 늘어나는 경로가 없어 넣지 않는다. 항상 0 인 값은 순서를 바꾸지 못한다.
 *
 * 🔴 Persona 댓글은 점수를 움직이지 않는다. Persona 댓글이 많이 달린 글도 실반응이 없으면
 *    댓글 0 인 같은 나이의 글과 같은 점수다 — 활발한 척이 홈 상단 자리를 사지 못한다.
 * 🔴 게시판 보너스가 없다. 갱년기톡 최소는 점수가 아니라 배분(fillMenopauseMinimum)에서 지킨다.
 */
const DECAY_OFFSET_HOURS = 4
const DECAY_EXPONENT = 0.8
const HOUR_MS = 3_600_000

export function popularityScore(post: ScorablePost, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - post.createdAt.getTime()) / HOUR_MS)
  return (post.realReactions + 1) / Math.pow(ageHours + DECAY_OFFSET_HOURS, DECAY_EXPONENT)
}

/** 최소 노출을 보장받는 게시판. 서비스의 정체성이라 사라지면 다른 서비스로 보인다. */
const GUARANTEED_BOARD: BoardType = 'MENOPAUSE'

type Scored<T> = { post: T; score: number }

function byScore<T extends ScorablePost>(a: Scored<T>, b: Scored<T>): number {
  // 점수가 같으면 최신 글을 위로 둔다. 순서가 매 요청마다 흔들리지 않게 하는 장치이기도 하다.
  // 🔴 시각까지 같으면 id 내림차순 — 일괄 발행은 같은 시각 글을 실제로 만든다. 입력 순서를 따르면
  //    같은 데이터에 요청마다 다른 순서가 나온다(게시판 목록이 `id desc` 를 두는 것과 같은 이유).
  return (
    b.score - a.score ||
    b.post.createdAt.getTime() - a.post.createdAt.getTime() ||
    (a.post.id < b.post.id ? 1 : a.post.id > b.post.id ? -1 : 0)
  )
}

/** 점수를 매겨 점수순으로 세운다. 같은 글이 두 번 들어와도 한 번만 싣는다. */
function rankByScore<T extends ScorablePost>(posts: readonly T[], now: Date): Scored<T>[] {
  const seen = new Set<string>()
  const all: Scored<T>[] = []
  for (const post of posts) {
    if (seen.has(post.id)) continue
    seen.add(post.id)
    all.push({ post, score: popularityScore(post, now) })
  }
  return all.sort(byScore)
}

/**
 * 게시판 하나의 점수순 상위 — 데스크톱 홈의 게시판별 열.
 *
 * 🔴 갱년기톡 최소(fillMenopauseMinimum)를 적용하지 않는다.
 *    최소는 두 게시판을 한 줄에 섞을 때 자유게시판 독식을 막는 장치다 — 열이 나뉘면 할 일이 없다.
 * 🔴 다른 게시판 글은 받아도 버린다. 열에 섞이면 "갱년기톡" 머리 아래 자유게시판 글이 뜬다.
 * 후보가 모자라면 있는 만큼만 — 최신 글로 채우지 않는다.
 */
export function pickBoardPopular<T extends ScorablePost>({
  posts,
  boardType,
  take,
  now,
}: {
  posts: readonly T[]
  boardType: BoardType
  take: number
  now: Date
}): T[] {
  const limit = Math.max(0, Math.trunc(take))
  if (limit === 0) return []
  return rankByScore(posts.filter((p) => p.boardType === boardType), now)
    .slice(0, limit)
    .map((e) => e.post)
}

/**
 * 끼워 넣어도 되는 최근 글인가 — 작성 시각(createdAt) 경과 시간이 상한 이하(경계 포함).
 * 미래 시각(시계 차이)은 신선하다 — 점수의 `max(0, 경과)` 와 같은 방향이다.
 */
export function isWithinFreshWindow(post: { createdAt: Date }, freshHours: number, now: Date): boolean {
  return now.getTime() - post.createdAt.getTime() <= freshHours * HOUR_MS
}

/**
 * 모바일 홈 "섞은 20" 의 **남은 자동 자리**를 채운다 — 갱년기톡 최소를 최종 목록에서 지킨다.
 *
 * 🔴 고정(PIN)·숨김(HIDE)을 얹은 **뒤**에 부른다(home-exposure-rules.ts applyHomeExposure 의 fill).
 *    중간 후보(take × 2)에서 최소를 맞추면 보장분이 21위 아래로 밀려 최종 자르기에서 전부 잘릴 수 있다.
 *
 *   1. 자연 점수순으로 남은 자리를 채운다.
 *   2. 갱년기톡(고정 포함)이 최소에 못 미치면, 자연 순위 밖의 **최근(freshHours 안) 갱년기톡**을
 *      점수 높은 순으로 꺼내 **점수가 가장 낮은 자유게시판 글부터** 바꾼다.
 *   3. 다시 점수순으로 세운다 — 보장된 글도 자기 점수 자리에 선다(화면 순번을 꾸미지 않는다).
 *
 * 🔴 자연 순위에 든 오래된 갱년기톡은 막지도 빼지도 않고 최소에 센다. 나이 상한은 끼워 넣는 글에만 건다.
 * 🔴 자유게시판 글이 모자라면 1 에서 이미 갱년기톡으로 채워진다 — 별도 분기가 없다.
 * 후보가 모자라면 있는 만큼만. 최신 글·다른 게시판 글로 채우지 않는다.
 */
export function fillMenopauseMinimum<T extends ScorablePost>(
  rest: readonly T[],
  {
    slots,
    pinned,
    minimum,
    freshHours,
    now,
  }: { slots: number; pinned: readonly { boardType: BoardType }[]; minimum: number; freshHours: number; now: Date },
): T[] {
  const limit = Math.max(0, Math.trunc(slots))
  if (limit === 0) return []
  const isGuaranteed = (e: Scored<T>) => e.post.boardType === GUARANTEED_BOARD

  const pool = rankByScore(rest, now)
  const chosen = pool.slice(0, limit)
  const pinnedGuaranteed = pinned.filter((p) => p.boardType === GUARANTEED_BOARD).length
  const need = Math.min(Math.max(0, Math.trunc(minimum) - pinnedGuaranteed), limit)
  let have = chosen.filter(isGuaranteed).length
  // 이미 점수순이라 앞에서부터 꺼내면 차순위가 나온다.
  const waiting = pool.slice(limit).filter((e) => isGuaranteed(e) && isWithinFreshWindow(e.post, freshHours, now))

  for (let i = chosen.length - 1; i >= 0 && have < need && waiting.length > 0; i -= 1) {
    if (isGuaranteed(chosen[i])) continue
    const next = waiting.shift()
    if (!next) break
    chosen[i] = next
    have += 1
  }

  return chosen.sort(byScore).map((e) => e.post)
}

/** 갱년기톡 최소가 모자란 원인 — 여럿이 함께 설 수 있다 */
export type MenopauseShortReason = 'eligible-short' | 'fresh-short' | 'slots-short'

/** 어드민 홈 노출이 보여 주는 갱년기톡 최소 진단 — 관측용이다. 판정 엔진이 아니다. */
export type MenopauseQuota = {
  minimum: number
  freshHours: number
  /** 최종 목록의 갱년기톡 수 (고정 포함) */
  shown: number
  /** 그중 고정 글 */
  pinned: number
  /** 노출 가능한 갱년기톡 = 고정 + 자동 후보(숨김 제외) — 나이 무관 */
  eligible: number
  /** 자동 후보 중 최근(freshHours 안) 갱년기톡 */
  freshEligible: number
  /** 고정 뒤 남은 자동 자리 */
  slots: number
  deficit: number
  reasons: MenopauseShortReason[]
  /** 🔴 원인 없이 모자라거나, 쓸 수 있던 최근 갱년기톡이 남았는데 자유게시판 글이 자리를 가졌다 — 배분 결함 */
  allocationDefect: boolean
}

/**
 * 진단 — 배분이 **끝난 최종 목록**과 그 입력만 읽는다. 배분을 다시 계산하지 않는다.
 *
 *   slots-short      고정 갱년기톡 + 남은 자리 < 최소 — 고정 글이 자리를 차지했다
 *   eligible-short   노출 가능한 갱년기톡(나이 무관) < 최소 — 글 자체가 모자라다(공급)
 *   fresh-short      쓰지 못한 오래된 갱년기톡은 있는데 쓸 수 있는 최근 갱년기톡은 없고, 자유게시판 글이 자리를 가졌다
 *                    — 최근 공급이 끊겼다
 */
export function diagnoseMenopauseQuota<T extends ScorablePost>(
  { posts, pinned, rest, slots }: { posts: readonly T[]; pinned: readonly T[]; rest: readonly T[]; slots: number },
  { minimum, freshHours, now }: { minimum: number; freshHours: number; now: Date },
): MenopauseQuota {
  const isM = (p: ScorablePost) => p.boardType === GUARANTEED_BOARD
  const shownIds = new Set(posts.map((p) => p.id))
  const pinnedIds = new Set(pinned.map((p) => p.id))
  const pinnedM = pinned.filter(isM).length
  const restM = [...new Map(rest.filter(isM).map((p) => [p.id, p])).values()]
  const fresh = (p: ScorablePost) => isWithinFreshWindow(p, freshHours, now)

  const shown = posts.filter(isM).length
  const eligible = pinnedM + restM.length
  const freshEligible = restM.filter(fresh).length
  const deficit = Math.max(0, minimum - shown)
  const unusedFresh = restM.filter((p) => fresh(p) && !shownIds.has(p.id)).length
  const unusedStale = restM.filter((p) => !fresh(p) && !shownIds.has(p.id)).length
  const autoFree = posts.filter((p) => !pinnedIds.has(p.id) && !isM(p)).length

  const reasons: MenopauseShortReason[] = []
  if (deficit > 0) {
    if (eligible < minimum) reasons.push('eligible-short')
    if (unusedStale > 0 && unusedFresh === 0 && autoFree > 0) reasons.push('fresh-short')
    if (pinnedM + slots < minimum) reasons.push('slots-short')
  }
  const allocationDefect = deficit > 0 && ((unusedFresh > 0 && autoFree > 0) || reasons.length === 0)

  return { minimum, freshHours, shown, pinned: pinnedM, eligible, freshEligible, slots, deficit, reasons, allocationDefect }
}
