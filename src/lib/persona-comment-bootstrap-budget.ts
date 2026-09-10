/**
 * bootstrap 댓글 **예산** — 🔴 순수 함수. DB · 시계 · 네트워크 없음
 *
 * 🔴 **왜 30% 를 쓰지 않는가** (2026-09-11).
 *
 *    `judgeRatio` 는 "전체 댓글 중 Persona 가 30% 를 넘지 않는다" 로 예산을 만든다.
 *    그 규칙은 **사람이 이미 말하고 있는 곳**을 지키는 규칙이다.
 *    그런데 초기에는 실회원 댓글이 0 이고, 0 에 30% 를 곱하면 언제나 0 이다 —
 *    즉 **아무도 없으니 아무것도 만들지 않는다**가 되고, 그러면 영원히 아무도 없다.
 *
 *    초기 단계의 질문은 "사람 대비 몇 %인가" 가 아니라
 *    **"오늘 내보낸 글이 대화가 시작된 것처럼 보이는가"** 다.
 *    그래서 예산의 정본을 **오늘 관리형 공개 글에 남은 댓글 자리 수**로 잡는다.
 *
 * 🔴 **30% 는 지우지 않는다.** `organic` 단계로 내려가 그대로 살아 있다.
 *    초기 단계가 끝나면 다시 그 규칙이 예산을 만든다.
 *
 * 🔴 **coverage 50% 는 폐기했다** (2026-09-11). 옛 판은 "절반은 댓글 0 으로 남긴다" 였다.
 *    그 규칙이 지키려던 것은 "자동 응답기처럼 보이지 않기" 였는데, 실제로 남긴 것은
 *    **댓글이 하나도 없는 글이 절반**이라는 상태였다. 사람이 글을 열었을 때
 *    아무도 없으면 그 사람도 쓰지 않는다 — 그것이 지금 막고 있는 바로 그 일이다.
 *    지금 정본은 **모든 관리형 글에 자리를 열고, 댓글 0 인 글을 먼저 채운다**.
 */

import { PERSONA_COMMENTS_PER_POST_MAX } from './persona-target-rules'

/**
 * 🔴 하루 절대 상한 — 글이 아무리 많아도 이보다 많이 달지 않는다.
 *
 *    공개 글 100/day · 글당 최대 5건이 지금의 단기 정본이고, 그 곱이 500 이다.
 *    상한을 곱보다 작게 두면 "글당 1~5" 계약이 상한에 잘려 조용히 깨진다.
 */
export const BOOTSTRAP_DAILY_MAX = 500

/**
 * 한 글이 bootstrap 대상이 될 수 있는가를 판정하는 데 필요한 것만.
 * 🔴 본문도 제목도 받지 않는다 — 여기서 개인정보를 다루지 않는다.
 */
export type ManagedPostFacts = {
  /** `judgePostAuthor` 가 답한 작성자 유형 */
  authorKind: 'persona' | 'admin' | 'automated' | 'member' | 'unknown'
  /** 본문이 외부 커뮤니티에서 온 것인가. 모르면 null */
  externalSourced: boolean | null
  /**
   * 🔴 이 글에 **이미 있는 Persona 댓글 수**. 모르면 null — 그 글만 뺀다.
   *
   *    옛 판은 `hasPersonaComment: boolean` 이었다. 있으면 글을 통째로 뺐기 때문에
   *    "4건 있으니 1자리 남았다" 를 말할 수 없었다 — 글당 1건 계약의 잔재다.
   */
  personaCommentCount: number | null
}

export type ManagedCount = {
  /** 댓글 자리가 하나라도 남은 글 수 */
  eligible: number
  /** 🔴 **오늘 열려 있는 댓글 자리 총합** — 예산의 정본이다 */
  openSlots: number
  /** 왜 빠졌는가 — 🔴 회차를 죽이지 않고 **그 글만** 뺀다 */
  excluded: Readonly<Record<string, number>>
}

/** 🔴 DB count 가 될 수 있는 값인가 — NaN·Infinity·음수·소수·비-number 를 전부 막는다 */
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0

/**
 * 🔴 **하나가 이상하다고 회차 전체를 죽이지 않는다.**
 *
 *    출처를 못 읽은 글 한 편 때문에 오늘 예산이 0 이 되면,
 *    운영자는 원인을 찾는 대신 검사를 끄게 된다. 그 글만 빼고 나머지로 센다.
 *    단, **빠진 이유는 반드시 센다** — 조용히 줄어드는 것이 가장 나쁘다.
 */
export function countManagedPosts(rows: readonly ManagedPostFacts[]): ManagedCount {
  const excluded: Record<string, number> = {}
  const drop = (why: string): void => { excluded[why] = (excluded[why] ?? 0) + 1 }
  let eligible = 0
  let openSlots = 0
  for (const r of rows) {
    if (r.externalSourced === null) { drop('출처 불명'); continue }
    if (r.externalSourced) { drop('외부 커뮤니티 원문'); continue }
    if (r.authorKind === 'member') { drop('실회원 글'); continue }
    if (r.authorKind === 'unknown') { drop('작성자 유형 불명'); continue }
    if (!isCount(r.personaCommentCount)) { drop('기존 Persona 댓글 수 불명'); continue }
    const slots = PERSONA_COMMENTS_PER_POST_MAX - r.personaCommentCount
    if (slots <= 0) { drop(`Persona 댓글 ${PERSONA_COMMENTS_PER_POST_MAX}건이 이미 찼다`); continue }
    eligible += 1
    openSlots += slots
  }
  return { eligible, openSlots, excluded }
}

export type BootstrapBudgetFacts = {
  /** `countManagedPosts` 가 답한 오늘의 열린 댓글 자리 수 */
  openSlots: number
  /** 오늘 이미 발행한 Persona 댓글 수. 못 셌으면 null */
  publishedToday: number | null | undefined
  /** kill switch 가 꺼져 있는가(=발행해도 되는가). 모르면 null */
  killSwitchOff: boolean | null | undefined
}

export type BootstrapBudget = {
  /** 오늘 총 상한 */
  cap: number
  /** 오늘 이미 쓴 수 */
  used: number
  /** 🔴 남은 수량 */
  remaining: number
  blockers: readonly string[]
  reason: string
}

/**
 * 🔴 **글 1편이면 최대 5건, 100편이면 500건이다.**
 *
 *    글 1 → 5 · 10 → 50 · 100 → 500 · 200 → 500(절대 상한).
 *
 * 🔴 **오늘 발행 수를 두 번 빼지 않는다** (2026-09-11 정정).
 *
 *    `openSlots` 는 이미 **기존 Persona 댓글을 뺀 남은 자리**다. 오늘 발행한 댓글은
 *    그 글의 `personaCommentCount` 로 이미 반영돼 자리에서 빠져 있다.
 *    그런데 옛 산식은 `cap = min(500, openSlots)` 를 잡고 거기서 `publishedToday` 를
 *    **다시** 뺐다 — 한 건 나갈 때마다 예산이 **2씩** 줄었다.
 *    실측: 글 1편이 5건이 아니라 **3건**에서, 글 100편이 500건이 아니라
 *    **250건**에서 멈췄다. 절반이 조용히 사라지고 있었다.
 *
 *    남은 수량은 **남은 자리**와 **하루 절대 상한에서 오늘 쓴 만큼을 뺀 값** 중
 *    작은 쪽이다. 자리는 자리대로, 일 상한은 일 상한대로 한 번씩만 센다.
 *
 * 🔴 `cap` 은 여전히 **총 상한**(= 남은 + 쓴)이다. 발행 트랜잭션이
 *    `allowanceCap - publishedTodayInTx` 로 다시 빼서 자리를 확인하기 때문이다 —
 *    그 재검증은 그대로 두고, 여기서 미리 빼지 않는다.
 *
 * 🔴 이것은 **상한**이지 목표가 아니다. 실제로 몇 건이 나가는지는 planner 가
 *    붙일 수 있는 Persona 수와 Gate 가 정한다 — 상한을 채우려 하지 않는다.
 */
export function judgeBootstrapBudget(f: BootstrapBudgetFacts): BootstrapBudget {
  const blockers: string[] = []
  if (!isCount(f.openSlots)) {
    blockers.push('열린 댓글 자리 수가 count 가 아니다 — 상한 0(fail-closed)')
  }
  if (!isCount(f.publishedToday)) {
    blockers.push('오늘 발행 수를 세지 못했다 — 상한 0(fail-closed)')
  }
  if (f.killSwitchOff === false) blockers.push('kill switch 가 켜져 있다 — 발행하지 않는다')
  if (f.killSwitchOff !== true && f.killSwitchOff !== false) {
    blockers.push('kill switch 상태를 읽지 못했다 — 상한 0(fail-closed)')
  }

  const slots = isCount(f.openSlots) ? f.openSlots : 0
  const used = isCount(f.publishedToday) ? f.publishedToday : 0
  // 🔴 하루 절대 상한에서 오늘 쓴 만큼을 뺀다 — **여기서만** 뺀다
  const dayLeft = Math.max(0, BOOTSTRAP_DAILY_MAX - used)
  // 🔴 남은 수량 = min(남은 자리, 일 상한의 잔량). 자리에서 `used` 를 또 빼지 않는다
  const remaining = blockers.length > 0 ? 0 : Math.min(slots, dayLeft)
  // 🔴 총 상한 = 남은 + 쓴. 트랜잭션이 `cap - used` 로 다시 빼도 같은 값이 나온다
  const cap = blockers.length > 0 ? 0 : remaining + used
  return {
    cap, used, remaining, blockers,
    reason: blockers.length > 0
      ? blockers[0]!
      : `열린 댓글 자리 ${slots}개(글당 최대 ${PERSONA_COMMENTS_PER_POST_MAX})`
        + ` · 오늘 ${used}건 발행 → 일 상한 잔량 ${dayLeft}건(절대 ${BOOTSTRAP_DAILY_MAX})`
        + ` → 남은 ${remaining}건`,
  }
}
