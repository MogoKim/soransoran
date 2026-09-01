/**
 * 홈 노출 예외 — 순수 규칙.
 *
 * 🔴 DB 를 모른다. 표본 데이터만으로 확인할 수 있어야 한다(popularity.ts 와 같은 원칙).
 *    조회는 queries 가, 저장은 actions 가 한다. 여기는 계산만 한다.
 *
 * 🔴 자동 점수를 대체하지 않는다. 예외는 그 결과에 얹는 한 겹이다.
 */

/** 만료 선택지. 늘리지 않는다 — 고를 것이 많아지면 아무도 고르지 않는다. */
export type ExpiryChoice = 'FOUR_HOURS' | 'TODAY_KST' | 'MANUAL'

export const EXPIRY_CHOICES: { value: ExpiryChoice; label: string }[] = [
  { value: 'FOUR_HOURS', label: '4시간' },
  { value: 'TODAY_KST', label: '오늘 자정까지' },
  { value: 'MANUAL', label: '수동 해제까지' },
]

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * 만료 시각을 UTC Date 로 계산한다. 수동 해제는 null 이다.
 *
 * 🔴 "오늘 자정 KST" 는 서버 시간대와 무관하게 계산해야 한다.
 *    서버가 UTC 로 도는데 new Date().setHours(23,59,59) 를 쓰면 UTC 자정이 되어
 *    한국 시간으로는 오전 8시 59분에 꺼진다 — 아침에 조용히 사라지는 고정이 된다.
 *    그래서 +9h 를 더해 한국 날짜를 구한 뒤, 그 날짜의 23:59:59 KST 를 다시 UTC 로 되돌린다.
 */
export function resolveExpiresAt(choice: ExpiryChoice, now: Date = new Date()): Date | null {
  if (choice === 'MANUAL') return null
  if (choice === 'FOUR_HOURS') return new Date(now.getTime() + FOUR_HOURS_MS)

  // KST 로 옮겨 한국 날짜(YYYY-MM-DD)를 읽는다
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  const y = kst.getUTCFullYear()
  const m = kst.getUTCMonth()
  const d = kst.getUTCDate()
  // 그 날짜의 23:59:59.999 KST — UTC 로는 9시간 앞이다
  const endOfKstDayAsUtc = Date.UTC(y, m, d, 23, 59, 59, 999) - KST_OFFSET_MS
  return new Date(endOfKstDayAsUtc)
}

/** 지금 살아 있는 예외인가. 만료된 행은 지우지 않고 여기서 무시한다. */
export function isOverrideActive(
  o: { isActive: boolean; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!o.isActive) return false
  if (o.expiresAt === null) return true
  return o.expiresAt.getTime() > now.getTime()
}

export type OverrideRow = {
  postId: string
  action: 'PIN' | 'HIDE'
  position: number | null
  isActive: boolean
  expiresAt: Date | null
}

/**
 * 자동 후보에 예외를 얹는다.
 *
 * 순서
 *   ① 활성 HIDE 를 뺀다
 *   ② 활성 PIN 을 position 오름차순으로 앞에 세운다
 *   ③ 나머지를 자동 순서대로 채운다
 *   ④ take 만큼 자른다
 *
 * 🔴 PIN 글은 `pinnedPosts` 로 따로 받는다.
 *    자동 후보(candidates) 안에서만 찾으면, 점수가 낮아 후보에 못 든 글은
 *    고정해도 홈에 뜨지 않는다 — 운영자가 "고정했는데 안 보인다" 를 겪는다.
 *    PIN 은 자동 점수를 이겨야 한다.
 *
 * 🔴 그러나 노출 안전 규칙은 이기지 않는다.
 *    pinnedPosts 는 호출부가 discovery 조건(PUBLISHED · isMicroSeed=false ·
 *    permanentNoindex=false · indexPromotionBlocked=false · 차단 회원 제외 ·
 *    MENOPAUSE/FREE)으로 조회해 넘긴 것만 들어온다. 조건을 못 지나면 애초에
 *    목록에 없고, 여기서도 나가지 않는다.
 *
 * 🔴 PIN 이 HIDE 를 이기지 않는다. 같은 글에 둘 다 걸리면 빠진다 —
 *    내리라는 지시와 올리라는 지시가 부딪히면 안 보이는 쪽이 안전하다.
 *
 * 🔴 HIDE 때문에 자리가 줄지 않는다.
 *    자동 후보를 넉넉히 받아 뒤 후보로 채운다(호출부가 여유를 두고 조회한다).
 */
export function applyHomeExposure<T extends { id: string }>({
  candidates,
  pinnedPosts = [],
  overrides,
  take,
  now = new Date(),
}: {
  candidates: readonly T[]
  /**
   * PIN 대상 글. 자동 후보에 없을 수도 있다.
   * 🔴 호출부가 discovery 조건으로 조회한 것만 넘긴다 — 여기서 다시 검사하지 않는다.
   */
  pinnedPosts?: readonly T[]
  overrides: readonly OverrideRow[]
  take: number
  now?: Date
}): T[] {
  const limit = Math.max(0, Math.trunc(take))
  if (limit === 0) return []

  const active = overrides.filter((o) => isOverrideActive(o, now))
  const hidden = new Set(active.filter((o) => o.action === 'HIDE').map((o) => o.postId))

  // 후보와 PIN 목록 양쪽에서 글을 찾는다. 같은 id 는 후보 쪽을 먼저 쓴다.
  const byId = new Map<string, T>()
  for (const p of pinnedPosts) byId.set(p.id, p)
  for (const c of candidates) byId.set(c.id, c)

  const pins = active
    .filter((o) => o.action === 'PIN' && !hidden.has(o.postId))
    // position 이 없으면 뒤로 보낸다. 같은 값이면 들어온 순서를 지킨다.
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
    )

  const pinned: T[] = []
  const seen = new Set<string>()
  for (const pin of pins) {
    if (seen.has(pin.postId)) continue
    const post = byId.get(pin.postId)
    // 🔴 discovery 조건을 못 지난 글은 어느 목록에도 없다 — 그래서 나가지 않는다
    if (!post) continue
    seen.add(pin.postId)
    pinned.push(post)
  }

  const rest = candidates.filter((c) => !hidden.has(c.id) && !seen.has(c.id))

  return [...pinned, ...rest].slice(0, limit)
}
