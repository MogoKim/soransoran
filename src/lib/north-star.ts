/**
 * North Star **계측 계약** — 🔴 순수 함수. 네트워크도 GA4 도 부르지 않는다
 *
 * 🔴 **North Star 는 "주간 재방문 참여 실사용자" 하나다** (창업자 정본).
 *    재방문 = 서로 다른 날 2회 이상 방문 · 참여 = 글 또는 댓글 1회 이상 ·
 *    실사용자 = **사람**. Persona·봇·운영자는 들어가지 않는다.
 *
 * 🔴 **발행량과 Persona 활동은 North Star 가 아니다.** 그것은 수단이다 —
 *    이 파일이 타입으로 막는다(`NorthStarInput` 에 그 칸이 없다).
 *
 * 🔴 **개인정보를 보내지 않는다.** 여기 있는 것은 전부 익명 집계 단위다 —
 *    userId·postId·commentId·닉네임·이메일이 타입에 자리가 없다.
 *
 * 🔴 **이 PR 은 GA4 송신을 켜지 않는다.** 계약과 검사까지다.
 */

/**
 * 🔴 **지금 6종으로는 재방문을 계산할 수 없다** (2026-09-21 실측).
 *    `write_login_prompt` · `write_auth_start` · `sign_up` ·
 *    `write_draft_restored` · `post_publish` · `comment_publish` —
 *    전부 **행동 시점** 이벤트다. "같은 사람이 다른 날 또 왔는가" 를 세려면
 *    세션 시작과 회원 여부가 필요하다.
 */
export const NORTH_STAR_MISSING_EVENTS = [
  'session_start', 'engaged_session', 'return_visit',
] as const
export type NorthStarMissingEvent = (typeof NORTH_STAR_MISSING_EVENTS)[number]

/**
 * 🔴 더해야 할 이벤트와 그 파라미터. **값 타입까지 좁힌다** —
 *    자유 문자열을 두면 언젠가 제목이나 닉네임이 실린다.
 */
export type NorthStarEventMap = {
  /** 세션이 시작됐다 — 하루 단위 재방문의 기준점 */
  session_start: { member_type: 'member' | 'guest'; entry: 'search' | 'direct' | 'internal' | 'other' }
  /** 그 세션이 실제로 읽었다 (체류·스크롤 기준은 클라이언트가 정한다) */
  engaged_session: { member_type: 'member' | 'guest'; read_depth: 'shallow' | 'deep' }
  /** 이전에 방문한 적이 있는 사람이 다시 왔다 */
  return_visit: { member_type: 'member' | 'guest'; days_since_last: '1' | '2-7' | '8-30' | '31+' }
}

export type NorthStarEventName = keyof NorthStarEventMap

/**
 * 🔴 **집계 입력.** 전부 **사람** 수다. Persona·봇 칸이 없다 —
 *    넣고 싶어도 타입에 자리가 없다.
 */
export type NorthStarInput = {
  /** 이번 주 서로 다른 날 2회 이상 방문한 사람 수 */
  returningUsers: number
  /** 그중 글 또는 댓글을 1회 이상 쓴 사람 수 */
  returningEngagedUsers: number
  /** 🔴 측정되지 않았으면 `null` — 0 으로 채우지 않는다 */
  measuredWeeks: number | null
}

export type NorthStarValue =
  | { measured: true; weeklyReturningEngagedUsers: number }
  | { measured: false; reason: string }

/**
 * 🔴 **모르면 모른다고 답한다.** 측정 주가 없거나 참여자가 방문자보다 많으면
 *    숫자를 내지 않는다 — 틀린 숫자가 없는 숫자보다 나쁘다.
 */
export function northStar(input: NorthStarInput): NorthStarValue {
  if (input.measuredWeeks === null || input.measuredWeeks < 1) {
    return { measured: false, reason: '재방문을 셀 이벤트가 아직 없다' }
  }
  if (input.returningEngagedUsers > input.returningUsers) {
    return { measured: false, reason: '참여자가 방문자보다 많다 — 집계가 어긋났다' }
  }
  return { measured: true, weeklyReturningEngagedUsers: input.returningEngagedUsers }
}

/**
 * 🔴 **이 값들은 North Star 가 아니다.** 보고서가 실수로 섞지 않게 이름을 적어 둔다.
 *    수단 지표는 따로 보고, North Star 옆에 더하지 않는다.
 */
export const NOT_NORTH_STAR = [
  'publicPostsPerDay', 'personaComments', 'personaActiveCount',
  'shadowDrafts', 'queueStock', 'crawlThroughput',
] as const

export function isNorthStarMetric(name: string): boolean {
  return !(NOT_NORTH_STAR as readonly string[]).includes(name)
}
