import type { BoardType } from '@prisma/client'

/**
 * 홈 인기글 점수 · 게시판 배분.
 * DB 를 모르는 순수 함수로 둔다 — 표본 데이터만으로 확인할 수 있어야 한다.
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
 */
const DECAY_OFFSET_HOURS = 4
const DECAY_EXPONENT = 0.8

export function popularityScore(post: ScorablePost, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - post.createdAt.getTime()) / 3_600_000)
  return (post.realReactions + 1) / Math.pow(ageHours + DECAY_OFFSET_HOURS, DECAY_EXPONENT)
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

/** 갱년기톡 최소 노출이 최종 목록에서 어떻게 됐는가. 부족하면 왜 부족한지 숨기지 않는다 */
export type MenopauseQuota = {
  /** 정책 최소 — 호출부가 넘긴 값 */
  minimum: number
  /** 이번에 지킬 수 있는 수 = min(최소, 노출 가능한 갱년기톡, PIN 갱년기톡 + 남은 자동 자리) */
  target: number
  /** 최종 목록의 갱년기톡 수(PIN 포함) */
  shown: number
  /** PIN 으로 들어간 갱년기톡 수 */
  pinned: number
  /** 최소에서 모자란 수. 0 이면 정상 */
  deficit: number
  /**
   * 모자란 원인. 비어 있으면 deficit 도 0 이다.
   *   eligible-short  숨김·차단·discovery 조건을 지난 갱년기톡 글이 최소보다 적다
   *   slots-short     PIN 이 자리를 차지해 남은 자동 자리로는 최소를 채울 수 없다
   */
  reasons: ('eligible-short' | 'slots-short')[]
}

/**
 * 홈 자동 자리 채우기 — applyHomeExposure 의 fillAuto 로 넘긴다.
 *
 * 🔴 갱년기톡 최소 노출은 **최종 목록**에서 성립해야 한다. 예전에는 여유분(take×2)을 고를 때 보장하고
 *    applyHomeExposure 가 take 로 다시 잘라, 점수가 낮은 갱년기톡이 전부 잘려 나갈 수 있었다
 *    (운영 replay: 홈 20 이 전부 자유게시판). 지금은 PIN 을 세운 **뒤** 남은 자리 수로 배분한다.
 *
 *   PIN 갱년기톡은 최소에 포함한다. 자동 자리에서 채울 몫 = min(최소, 노출 가능 수) − PIN 갱년기톡.
 *   그 몫을 pickHomePopular 에 넘긴다 — 점수순을 기본으로, 모자라면 가장 낮은 자유게시판 글과만 바꾼다.
 *   HIDE 는 rest 에 이미 없다 — 숨긴 글을 보장 수 때문에 되살리지 않는다.
 *
 * fill 이 한 번 불린 뒤 diagnosis(최종 목록) 가 MenopauseQuota 를 돌려준다.
 * 🔴 deficit > 0 인데 reasons 가 비었다면 배분 결함이다 — 어드민이 그대로 "배분 결함" 이라고 보여준다.
 */
export function createHomeAutoFill<T extends ScorablePost>({
  minMenopause,
  now,
}: {
  minMenopause: number
  now: Date
}): {
  fill: (rest: readonly T[], ctx: { slots: number; pinned: readonly { boardType: BoardType }[] }) => T[]
  diagnosis: (finalPosts: readonly { boardType: BoardType }[]) => MenopauseQuota
} {
  const minimum = Math.max(0, Math.trunc(minMenopause))
  const isMeno = (p: { boardType: BoardType }) => p.boardType === GUARANTEED_BOARD
  // fill 이 불렸을 때만 채워진다(applyHomeExposure 는 자리가 0 이어도 부른다). 안 불렸다 = take 0.
  let seen: { pinnedMeno: number; poolMeno: number; slots: number } | null = null

  return {
    fill(rest, { slots, pinned }) {
      const ids = new Set<string>()
      const unique = rest.filter((p) => (ids.has(p.id) ? false : (ids.add(p.id), true)))
      const menopause = unique.filter(isMeno)
      const pinnedMeno = pinned.filter(isMeno).length
      seen = { pinnedMeno, poolMeno: menopause.length, slots }
      const need = Math.max(0, Math.min(minimum, pinnedMeno + menopause.length) - pinnedMeno)
      return pickHomePopular({
        menopause,
        free: unique.filter((p) => !isMeno(p)),
        take: slots,
        minMenopause: need,
        now,
      })
    },
    diagnosis(finalPosts) {
      // 🔴 shown 은 최종 목록에서 센다 — 배분이 의도한 수가 아니라 실제로 나간 수다
      const shown = finalPosts.filter(isMeno).length
      const pinned = seen ? seen.pinnedMeno : shown
      const eligible = pinned + (seen ? seen.poolMeno : 0)
      const slots = seen ? seen.slots : 0
      const target = Math.min(minimum, eligible, pinned + slots)
      const reasons: MenopauseQuota['reasons'] = []
      if (shown < minimum) {
        if (eligible < minimum) reasons.push('eligible-short')
        if (pinned + slots < minimum) reasons.push('slots-short')
      }
      return { minimum, target, shown, pinned, deficit: Math.max(0, minimum - shown), reasons }
    },
  }
}
