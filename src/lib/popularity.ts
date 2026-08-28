import type { BoardType } from '@prisma/client'

/**
 * 홈 인기글 점수 · 게시판 배분.
 * DB 를 모르는 순수 함수로 둔다 — 표본 데이터만으로 확인할 수 있어야 한다.
 */

/** 점수 계산에 필요한 최소 입력. 목록 렌더용 필드까지 요구하지 않는다. */
export type ScorablePost = {
  id: string
  boardType: BoardType
  createdAt: Date
  _count: { comments: number }
}

/**
 * 점수 = (댓글 수 + 1) / (경과시간h + 4)^0.8
 *
 *   +1    댓글 0 인 글도 최신성으로 겨루게 한다. 없으면 전부 0 이 되어 정렬이 죽는다.
 *   +4h   방금 올라온 글의 점수가 치솟는 것을 막는다.
 *   0.8   하루 지난 글은 살아남고, 한 달 전 글은 댓글이 많아도 내려가는 기울기다.
 *
 * 조회수·좋아요는 늘어나는 경로가 없어 넣지 않는다. 항상 0 인 값은 순서를 바꾸지 못한다.
 */
const DECAY_OFFSET_HOURS = 4
const DECAY_EXPONENT = 0.8

export function popularityScore(post: ScorablePost, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - post.createdAt.getTime()) / 3_600_000)
  return (post._count.comments + 1) / Math.pow(ageHours + DECAY_OFFSET_HOURS, DECAY_EXPONENT)
}

/** 최소 노출을 보장받는 게시판. 서비스의 정체성이라 사라지면 다른 서비스로 보인다. */
const GUARANTEED_BOARD: BoardType = 'MENOPAUSE'

type Scored<T> = { post: T; score: number }

function byScore<T extends ScorablePost>(a: Scored<T>, b: Scored<T>): number {
  // 점수가 같으면 최신 글을 위로 둔다. 순서가 매 요청마다 흔들리지 않게 하는 장치이기도 하다.
  return b.score - a.score || b.post.createdAt.getTime() - a.post.createdAt.getTime()
}

/**
 * 점수순을 기본으로 하되, 갱년기톡 최소 노출을 위해 필요한 경우
 * 자유게시판 하위 글을 갱년기톡 후보로 교체한다. 선택된 최종 목록은 다시 점수순으로 정렬한다.
 *
 * 자유게시판 독식만 막는다 — 갱년기톡이 전부를 차지하는 것은 막지 않는다.
 * 후보가 모자라면 모자란 대로 돌려준다.
 */
export function pickHomePopular<T extends ScorablePost>({
  menopause,
  free,
  take,
  minMenopause,
  now,
}: {
  menopause: readonly T[]
  free: readonly T[]
  take: number
  minMenopause: number
  now: Date
}): T[] {
  const limit = Math.max(0, Math.trunc(take))
  if (limit === 0) return []

  // 같은 글이 두 묶음에 들어와도 한 번만 싣는다.
  const seen = new Set<string>()
  const all: Scored<T>[] = []
  for (const post of [...menopause, ...free]) {
    if (seen.has(post.id)) continue
    seen.add(post.id)
    all.push({ post, score: popularityScore(post, now) })
  }
  all.sort(byScore)

  const isGuaranteed = (entry: Scored<T>) => entry.post.boardType === GUARANTEED_BOARD
  const selected = all.slice(0, limit)

  const guaranteedTotal = all.filter(isGuaranteed).length
  const quota = Math.min(Math.max(0, minMenopause), guaranteedTotal, limit)

  const selectedIds = new Set(selected.map((e) => e.post.id))
  // 이미 점수순이라 앞에서부터 꺼내면 차순위가 나온다.
  const waiting = all.filter((e) => isGuaranteed(e) && !selectedIds.has(e.post.id))
  let filled = selected.filter(isGuaranteed).length

  while (filled < quota && waiting.length > 0) {
    // 점수가 가장 낮은 다른 게시판 글을 뒤에서부터 찾아 자리를 내준다.
    let swapAt = -1
    for (let i = selected.length - 1; i >= 0; i -= 1) {
      if (!isGuaranteed(selected[i])) {
        swapAt = i
        break
      }
    }
    if (swapAt === -1) break

    const next = waiting.shift()
    if (!next) break
    selected[swapAt] = next
    filled += 1
  }

  // 교체로 흐트러진 자리를 되돌린다. 화면에는 언제나 점수순으로 나간다.
  selected.sort(byScore)
  return selected.map((e) => e.post)
}
