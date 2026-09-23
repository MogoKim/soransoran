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
import type { SoranEventName } from './analytics/events'

/**
 * 🔴 **실제 계측 정의와 잇는다** (2026-09-21 2차 보정).
 *
 *    앞판은 "없는 이벤트 3종" 을 **손으로 적어 둔 상수**였다. 그래서 누군가
 *    `session_start` 를 `events.ts` 에 실제로 추가해도 이 목록은 그대로였고,
 *    계기판은 영원히 "재방문을 셀 수 없다" 라고 말했을 것이다 — 반대로 목록에서
 *    지우기만 하면 이벤트 없이도 "잴 수 있다" 가 됐을 것이다. 둘 다 거짓이다.
 *
 *    이제 **있는 것**을 적고 **없는 것은 계산한다.** 아래 목록은 `SoranEventName`
 *    전수여야 하며, `events.ts` 에 이벤트가 하나라도 늘면 컴파일이 깨진다.
 */
export const EXISTING_ANALYTICS_EVENTS = [
  'write_login_prompt', 'write_auth_start', 'sign_up',
  'write_draft_restored', 'post_publish', 'comment_publish',
  /**
   * 🔴 매거진 연관 글 이동. **North Star 가 아니다** — 수단이다.
   *    검색으로 들어온 사람이 두 번째 글로 갔는지를 볼 뿐,
   *    "다른 날 또 와서 글이나 댓글을 썼는가" 는 여전히 아래 세 이벤트가 있어야 센다.
   */
  'magazine_related_click',
  /** 🔴 클릭률의 분모. 이것도 North Star 가 아니라 수단이다 */
  'magazine_related_impression',
] as const satisfies readonly SoranEventName[]

/** 🔴 전수 확인 — `events.ts` 에 새 이벤트가 생기면 여기서 컴파일이 멈춘다 */
type UncoveredEvent = Exclude<SoranEventName, (typeof EXISTING_ANALYTICS_EVENTS)[number]>
const _allEventsCovered: UncoveredEvent extends never ? true : never = true
void _allEventsCovered

/**
 * 🔴 **재방문을 계산하려면 이 세 가지가 필요하다.**
 *    지금 있는 6종은 전부 **행동 시점** 이벤트다 — "같은 사람이 다른 날 또 왔는가" 는
 *    세션 시작과 회원 여부 없이 셀 수 없다.
 */
export const NORTH_STAR_REQUIRED_EVENTS = [
  'session_start', 'engaged_session', 'return_visit',
] as const
export type NorthStarMissingEvent = (typeof NORTH_STAR_REQUIRED_EVENTS)[number]

/** 🔴 **필요한 것 중 아직 없는 것** — 순수 함수라 fixture 로 직접 시험할 수 있다 */
export function missingEvents(
  required: readonly NorthStarMissingEvent[], existing: readonly string[],
): NorthStarMissingEvent[] {
  return required.filter((e) => !existing.includes(e))
}

/** 🔴 **계산한다.** 손으로 적지 않는다 — 그래야 이벤트를 붙이면 저절로 줄어든다 */
export const NORTH_STAR_MISSING_EVENTS: readonly NorthStarMissingEvent[] =
  missingEvents(NORTH_STAR_REQUIRED_EVENTS, EXISTING_ANALYTICS_EVENTS)

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
 * 🔴 **누가 한 행동인가** (2026-09-21 2차 보정).
 *
 *    앞판은 `NorthStarInput` 에 "Persona 칸이 없다" 는 것으로 오염을 막는다고 적었다.
 *    그건 막은 게 아니다 — 집계하는 쪽이 Persona 활동을 `returningUsers` 에 더해 넘기면
 *    타입은 아무 말도 하지 않는다. 숫자를 넣는 자리에 **누구인지**를 같이 받아야 막힌다.
 */
export const ACTOR_TYPES = ['member', 'guest', 'persona', 'bot', 'operator'] as const
export type ActorType = (typeof ACTOR_TYPES)[number]

/**
 * 🔴 **양성 허용목록이다.** "이것들은 빼라" 가 아니라 "이것들만 센다" 로 적는다 —
 *    제외 목록은 새 actor 가 생기면 조용히 통과시킨다(그것이 앞판의 결함이었다).
 *
 * 🔴 `guest` 는 센다. 비회원도 사람이고 댓글을 쓴다(`comment_publish.member_type`).
 *    `operator` 는 우리다 — 우리가 들어온 것은 커뮤니티가 산 증거가 아니다.
 */
export const NORTH_STAR_COUNTED_ACTORS = ['member', 'guest'] as const
export type CountedActor = (typeof NORTH_STAR_COUNTED_ACTORS)[number]

/** 🔴 모르는 actor 는 **세지 않는다** — fail-closed */
export function countsTowardNorthStar(actor: string): boolean {
  return (NORTH_STAR_COUNTED_ACTORS as readonly string[]).includes(actor)
}

export type ActorCounts = Readonly<Record<string, number>>

/**
 * 🔴 **집계 입력.** actor 별로 받는다 —
 *    합쳐 온 숫자 하나를 받으면 무엇이 섞였는지 영영 알 수 없다.
 */
export type NorthStarInput = {
  /** 이번 주 서로 다른 날 2회 이상 방문한 수 — actor 별 */
  returningByActor: ActorCounts
  /** 그중 글 또는 댓글을 1회 이상 쓴 수 — actor 별 */
  returningEngagedByActor: ActorCounts
  /** 🔴 측정되지 않았으면 `null` — 0 으로 채우지 않는다 */
  measuredWeeks: number | null
}

export type NorthStarValue =
  | {
      measured: true
      weeklyReturningEngagedUsers: number
      /** 🔴 **세지 않고 버린 것** — 0 이어도 적는다. 무엇을 뺐는지가 보여야 한다 */
      excluded: Readonly<Record<string, number>>
    }
  | { measured: false; reason: string }

export type ActorSum = { total: number; excluded: Record<string, number> }

/**
 * 🔴 허용목록에 든 actor 만 더한다. 모르는 키가 하나라도 있으면 집계를 **멈춘다**
 *    (문자열 = 멈춘 이유). 🔴 export 하는 이유: 이벤트가 없어 `northStar` 가 먼저
 *    unmeasured 를 내는 지금도 **이 방어가 실제로 도는지** 따로 시험하려고.
 */
export function sumCountedActors(counts: ActorCounts): ActorSum | string {
  let total = 0
  const excluded: Record<string, number> = {}
  for (const [actor, n] of Object.entries(counts)) {
    if (!(ACTOR_TYPES as readonly string[]).includes(actor)) {
      return `모르는 actor "${actor}" 가 들어왔다 — 세지 않고 멈춘다`
    }
    if (n < 0) return `actor "${actor}" 수가 음수다`
    if (countsTowardNorthStar(actor)) total += n
    else excluded[actor] = n
  }
  return { total, excluded }
}

/**
 * 🔴 **모르면 모른다고 답한다.** 측정 주가 없거나 참여자가 방문자보다 많으면
 *    숫자를 내지 않는다 — 틀린 숫자가 없는 숫자보다 나쁘다.
 */
export function northStar(input: NorthStarInput): NorthStarValue {
  if (NORTH_STAR_MISSING_EVENTS.length > 0) {
    return {
      measured: false,
      reason: `재방문을 셀 이벤트가 아직 없다 (${NORTH_STAR_MISSING_EVENTS.join('·')})`,
    }
  }
  if (input.measuredWeeks === null || input.measuredWeeks < 1) {
    return { measured: false, reason: '측정한 주가 없다' }
  }
  const visits = sumCountedActors(input.returningByActor)
  if (typeof visits === 'string') return { measured: false, reason: visits }
  const engaged = sumCountedActors(input.returningEngagedByActor)
  if (typeof engaged === 'string') return { measured: false, reason: engaged }

  if (engaged.total > visits.total) {
    return { measured: false, reason: '참여자가 방문자보다 많다 — 집계가 어긋났다' }
  }
  return {
    measured: true,
    weeklyReturningEngagedUsers: engaged.total,
    excluded: { ...visits.excluded },
  }
}

/**
 * 🔴 **North Star 로 셀 수 있는 이름은 이것뿐이다** (양성 허용목록).
 *    앞판은 제외 목록(`NOT_NORTH_STAR`)이었고, 목록에 없는 이름은 전부 통과했다 —
 *    새 지표를 만들 때마다 목록에 적어야 막히는 구조라 실제로는 막지 못한다.
 */
export const NORTH_STAR_METRICS = ['weeklyReturningEngagedUsers'] as const

export function isNorthStarMetric(name: string): boolean {
  return (NORTH_STAR_METRICS as readonly string[]).includes(name)
}

/**
 * 🔴 **수단 지표.** North Star 가 아니다 — 보고서에서 옆에 더하지 않는다.
 *    판정은 위 허용목록이 한다. 이 목록은 자주 헷갈리는 이름을 적어 둔 것이다.
 */
export const NOT_NORTH_STAR = [
  'publicPostsPerDay', 'personaComments', 'personaActiveCount',
  'shadowDrafts', 'queueStock', 'crawlThroughput',
] as const
