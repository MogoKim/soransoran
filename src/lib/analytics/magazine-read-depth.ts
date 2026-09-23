/**
 * 연속 열람 깊이 — **이 방문에서 몇 번째로 이어 읽는가**.
 *
 * 왜 세나
 *   거미줄이 실제로 독자를 붙잡는지는 클릭 한 번이 아니라 **연속 열람**이 말한다.
 *   1편 읽고 나가는 것과 3편을 이어 읽는 것은 완전히 다른 결과인데,
 *   클릭 수만 보면 둘이 똑같이 보인다.
 *
 * 🔴 **개인을 식별하지 않는다.** 저장하는 것은 세 가지뿐이다 —
 *    다음에 올 것으로 예상한 slug · 지금 깊이 · 마지막 시각.
 *    userId·닉네임·방문 이력 목록은 **자리가 없다.**
 *
 * 🔴 **sessionStorage 를 쓴다.** 탭을 닫으면 사라진다. localStorage 를 쓰면
 *    며칠 뒤 방문이 같은 사슬로 이어져 "연속 열람" 이 거짓이 된다.
 *
 * 🔴 **끊긴 사슬은 1로 되돌린다.** 두 가지 경우다.
 *      ① 30분 넘게 조용했다 — 같은 탭이어도 다른 방문으로 본다
 *      ② 예상한 글이 아닌 곳에 도착했다 — 목록·검색·주소창으로 온 것이므로
 *         연관 글이 만든 이동이 아니다
 *
 * 🔴 **저장 실패가 이동을 막지 않는다.** 사생활 보호 모드나 저장소 차단에서는
 *    읽기·쓰기가 던진다. 전부 삼키고 깊이 1로 답한다 — 계측 하나 때문에
 *    독자가 다음 글로 못 가는 쪽이 훨씬 큰 손해다.
 */
import type { MagazineReadDepth } from '@/lib/analytics/events'

const KEY = 'soran-magazine-read-chain'

/** 🔴 30분. 같은 탭이어도 이만큼 조용했으면 다른 방문이다 */
export const CHAIN_TTL_MS = 30 * 60 * 1000

type Chain = {
  /** 다음에 도착할 것으로 예상한 글 */
  next: string
  /** 그 글에 도착했을 때의 깊이 */
  depth: number
  /** 마지막으로 손댄 시각 */
  at: number
}

/** 4 이상은 한 칸으로 묶는다 — 칸이 무한히 늘면 보고서에서 읽히지 않는다 */
export function toDepthBucket(depth: number): MagazineReadDepth {
  if (depth <= 1) return '1'
  if (depth === 2) return '2'
  if (depth === 3) return '3'
  return '4+'
}

function read(store: Storage | null): Chain | null {
  if (!store) return null
  try {
    const raw = store.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Chain>
    if (typeof v.next !== 'string' || typeof v.depth !== 'number' || typeof v.at !== 'number') {
      return null
    }
    return { next: v.next, depth: v.depth, at: v.at }
  } catch {
    // 🔴 깨진 값·차단된 저장소. 삼키고 사슬이 없는 것으로 본다
    return null
  }
}

function write(store: Storage | null, chain: Chain): void {
  if (!store) return
  try {
    store.setItem(KEY, JSON.stringify(chain))
  } catch {
    /* 🔴 삼킨다. 다음 클릭은 깊이 1로 세질 뿐 이동은 정상이다 */
  }
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    // 🔴 접근 자체가 던지는 브라우저 설정이 있다
    return null
  }
}

/**
 * 지금 이 글에 도착한 깊이를 읽는다.
 *
 * @param currentSlug 지금 보고 있는 글
 * @param now 지금 시각 (시험이 주입한다)
 */
export function currentDepth(
  currentSlug: string,
  now = Date.now(),
  store: Storage | null = storage(),
): number {
  const chain = read(store)
  if (!chain) return 1
  // 🔴 조용했던 시간이 길면 다른 방문이다
  if (now - chain.at > CHAIN_TTL_MS) return 1
  // 🔴 예상한 글이 아니면 연관 글이 만든 이동이 아니다
  if (chain.next !== currentSlug) return 1
  return chain.depth
}

/**
 * 연관 글을 눌렀다. 다음 글에서 읽을 깊이를 적어 둔다.
 *
 * @returns 이번 클릭에 실을 깊이 칸
 */
export function recordRelatedClick(
  fromSlug: string,
  targetSlug: string,
  now = Date.now(),
  store: Storage | null = storage(),
): MagazineReadDepth {
  const depth = currentDepth(fromSlug, now, store)
  write(store, { next: targetSlug, depth: depth + 1, at: now })
  return toDepthBucket(depth)
}

/** 시험과 진단용 — 사슬을 지운다 */
export function clearChain(store: Storage | null = storage()): void {
  if (!store) return
  try {
    store.removeItem(KEY)
  } catch {
    /* 삼킨다 */
  }
}
