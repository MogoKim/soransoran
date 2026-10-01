/**
 * Persona 댓글 **분산 planner** — 🔴 순수 함수. DB · 시계 · 네트워크 없음
 *
 * 🔴 **무엇을 푸는가.**
 *
 *    공개 글 32건 중 27건에 댓글이 하나도 없다. 그 자리에 사람 대신 봇을 채우는 것이
 *    목적이 아니다 — 목적은 **말해도 되는 분위기**를 만드는 것이고, 그러려면
 *    ① 아무도 답하지 않은 글을 먼저 골라야 하고
 *    ② 같은 사람이 같은 글에 두 번 나타나면 안 되고
 *    ③ 사람들끼리 대화가 붙은 자리에는 끼어들지 않아야 한다.
 *
 * 🔴 한 글에 붙는 Persona 댓글은 **1~5건**이다(`PERSONA_COMMENTS_PER_POST_MAX`).
 *    억지로 5건을 채우지 않는다 — 붙일 수 있는 사람이 하나면 1건이고 그것으로 끝이다.
 *
 * 🔴 **판정에 필요한 값이 없으면 그 글·그 Persona 를 뺀다.** 채우지 않는다.
 *    모르는 것을 0 으로 보정하면 가장 위험한 대상이 가장 먼저 뽑힌다.
 *
 * 🔴 여기는 **고르기만** 한다. 생성도 Gate 도 발행도 하지 않는다.
 *    상한은 `persona-comment-governor.ts` 가 따로 정한다 — 고르는 일과
 *    "몇 개까지" 를 한 함수에 두면 상한을 늘리려 할 때 선정 규칙이 함께 흔들린다.
 */

import {
  judgeLifeHistory, readPostRequirements, type PersonaForMatch,
} from './original-post-persona-match'
import { COMMENT_REACTION_ROLES } from './persona-reaction-roles'
import { roleRoundVerdict, type RoleHistory } from './persona-reserve'
import { judgeRealMember, type RealMemberProbe } from './real-member-gate'
import {
  judgeTargetPost, PERSONA_COMMENTS_PER_POST_MAX, type TargetPostFacts,
} from './persona-target-rules'

/** 대상 후보 글의 실측 */
export type PlannerPost = {
  id: string
  /** PUBLISHED / HIDDEN / DELETED */
  status: string
  /** 이 글을 쓴 Persona. 실회원 글이면 null */
  authorPersonaCode: string | null
  /** 살아 있는 회원(+비회원) 댓글 수 */
  memberComments: number
  /** 살아 있는 Persona 댓글 수 */
  personaComments: number
  /**
   * 🔴 이 글에 **이미 댓글을 단** Persona 들. 같은 사람이 두 번 달지 않게 한다.
   *
   *    `personaComments` 는 "몇 자리 찼나" 이고 이것은 "누가 찼나" 다.
   *    수만 보면 같은 Persona 가 다시 뽑혀 한 사람이 여럿인 척하게 된다.
   */
  personaCodesOnPost: readonly string[]
  /**
   * 🔴 이 글을 대상으로 **열려 있는 Queue 의 Persona** 들.
   *
   *    옛 판은 `hasOpenQueue: boolean` 하나였고, 열린 것이 하나라도 있으면
   *    글을 통째로 뺐다 — 글당 1건 계약의 잔재다. 지금은 자리를 **차지**할 뿐이다.
   */
  openQueuePersonaCodes: readonly string[]
  /** 공개된 시각(epoch ms). 모르면 null — 🔴 null 은 제외 사유다 */
  publishedAtMs: number | null
  /** 지금 노출 대상에서 내려가 있는가(expired/hold 등). 모르면 null */
  onHold: boolean | null
  /**
   * 🔴 **창업자가 운영용 이름으로 직접 쓴 글인가** (2026-09-17). 모르면 null.
   *
   *    `onHold` 로 대신하지 않는다. 저 값은 "지금 내려가 있다" 는 뜻이고 이 값은
   *    "다른 레인의 글이다" 는 뜻이다 — 한 값에 두 뜻을 담으면 관제가 제외 사유를
   *    읽고도 무슨 일이 있었는지 알 수 없다.
   *
   * 🔴 **왜 제외하는가.** 수동 작성이 자동 배정을 움직이지 않게 하기 위해서다.
   *    운영자 글을 대상에 넣으면 창업자가 글 하나를 쓴 것만으로 그날의 자동 후보
   *    분배가 달라진다. 제외하면 **수동 작성 전후의 배정이 같다** — 그것이
   *    두 레인이 분리됐다는 증명이다.
   *
   * 🔴 이 결정은 되돌릴 수 있다. 창업자가 "내 글에도 댓글이 붙었으면 한다" 고 정하면
   *    여기 한 줄을 풀면 되고, 그때 바뀌는 것이 무엇인지도 이 주석이 말해 준다.
   */
  operatorWritten: boolean | null
  /**
   * 🔴 생활사 판정에 쓰는 글의 제목·본문.
   *
   *    옛 판은 `conflictingPostIds: []` 를 **실행 코드에서 고정**해 두었다 —
   *    생활사 충돌 판정이 fixture 에서만 살아 있고 실제로는 한 번도 돌지 않았다.
   *    판정하려면 본문이 있어야 한다. 그래서 여기로 받는다.
   */
  title: string
  body: string
}

/** 후보 Persona 의 실측 */
export type PlannerPersona = {
  code: string
  /** active 만 쓴다 */
  status: string
  /**
   * 🔴 실회원 판별 **입력**. 판정은 `judgeRealMember` 하나가 한다.
   *
   *    옛 판은 여기서 `accountCount > 0` 을 직접 비교했다. 그러면 `NaN > 0 === false` 라
   *    조회가 깨진 값이 **조용히 통과한다**. 정본을 두고도 옆에서 다시 세면
   *    한쪽만 고쳐지는 날이 온다.
   */
  realMember: RealMemberProbe
  /** identity·voiceCore·lifeStage 가 모두 있는가 */
  seedComplete: boolean
  /** 이 Persona 가 맡지 않는 반응 역할 */
  forbiddenReactionRoles: readonly string[]
  /** 최근 창에서 이 Persona 가 단 댓글 수 */
  recentComments: number
  /**
   * 🔴 **이 사람의 최근 역할 이력 — 필수다** (2026-10-01 · C9 보정). 판정은 `roleRoundVerdict` 하나.
   *    `null` = 읽지 못했다 → 이번 회차에서 이 사람을 뺀다(fail-closed). 이력 0 은 `{ roleCounts: {}, unresolvedRoleEvents: 0 }`.
   *    선택으로 두면 호출부가 안 넘겨도 조용히 통과한다 — 그래서 타입으로 막는다.
   */
  recentRoles: RoleHistory | null
  /**
   * 🔴 생활사 판정 입력. `judgeLifeHistory` 가 이것으로 판단한다.
   *
   *    글 발행 cadence(`WEEKLY_CAP` · `TOO_SOON`)는 **댓글에 적용하지 않는다** —
   *    글을 이번 주에 다 쓴 사람이 댓글도 못 다는 것은 이 규칙의 뜻이 아니다.
   *    그래서 `hardFilter` 전체가 아니라 생활사 부분만 부른다.
   */
  life: Omit<PersonaForMatch, 'code' | 'status' | 'accountCount' | 'providerId' | 'postsThisWeek' | 'daysSinceLastPost'>
}

export type PlanBlockCode =
  | 'POST_NOT_PUBLISHED'
  | 'POST_PERSONA_COMMENTS_FULL'
  | 'POST_MEMBER_COMMENTS_FULL'
  | 'POST_SLOTS_FULL'
  | 'POST_ON_HOLD'
  | 'POST_HOLD_UNKNOWN'
  | 'POST_OPERATOR_WRITTEN'
  | 'POST_OPERATOR_UNKNOWN'
  | 'POST_PUBLISHED_AT_UNKNOWN'
  | 'POST_TOO_OLD'
  | 'PERSONA_NOT_ACTIVE'
  | 'PERSONA_HAS_ACCOUNT'
  | 'PERSONA_ACCOUNT_UNKNOWN'
  | 'PERSONA_SEED_INCOMPLETE'
  | 'PERSONA_OWN_POST'
  | 'PERSONA_LIFE_CONFLICT'
  | 'PERSONA_ROLE_FORBIDDEN'
  | 'PERSONA_ROLE_CONCENTRATED'
  | 'PERSONA_ROLE_HISTORY_UNKNOWN'
  | 'PERSONA_ALREADY_ON_POST'
  | 'NO_ELIGIBLE_PERSONA'
  | 'LIMIT_EXHAUSTED'

export type PlanBlock = { code: PlanBlockCode; message: string }

/** 🔴 너무 오래된 글에는 달지 않는다 — 지금 대화가 아니라 발굴이 된다 */
export const FRESHNESS_MAX_DAYS = 30

export type PlanItem = {
  postId: string
  personaCode: string
  reactionRole: string
  /** 왜 이 글이 먼저인가 */
  priority: number
  why: string
}

export type PlanResult = {
  items: PlanItem[]
  /** 뽑히지 못한 글과 그 이유 — 🔴 조용히 사라지지 않게 한다 */
  skipped: { postId: string; blocks: PlanBlock[] }[]
}

/**
 * 🔴 우선순위. **작을수록 먼저**다.
 *
 *    ① 댓글이 하나도 없는 글  (아무도 답하지 않은 자리)
 *    ② 댓글이 적은 글
 *    그 안에서 최신 글이 먼저다 — 오래된 글에 붙는 댓글은 대화가 아니다.
 *
 * 🔴 **나이를 신선도 상한으로 자른다.** 자르지 않으면 아주 오래된 글의 나이 점수가
 *    댓글 한 칸(1_000)을 넘어 **댓글 1건짜리 글이 댓글 0건짜리 글보다 먼저** 뽑힌다.
 *    실제로 그 글들은 `POST_TOO_OLD` 로 이미 걸러지지만, 정렬이 그 사실에 기대면
 *    상한이 바뀌는 날 조용히 뒤집힌다.
 */
export function priorityOf(post: PlannerPost, nowMs: number): number {
  const total = post.memberComments + post.personaComments
  const ageDays = post.publishedAtMs === null
    ? FRESHNESS_MAX_DAYS
    : (nowMs - post.publishedAtMs) / 86_400_000
  return total * 1_000 + Math.min(FRESHNESS_MAX_DAYS, Math.max(0, Math.floor(ageDays)))
}

/**
 * 🔴 **이 글에 지금 몇 자리가 남았는가.**
 *
 *    이미 달린 댓글과 **열려 있는 대기열**이 함께 자리를 먹는다.
 *    대기열을 세지 않으면 승인 대기 중인 4건 위에 또 5건을 계획하게 된다.
 */
export function postSlotsOf(post: PlannerPost): number {
  return Math.max(
    0,
    PERSONA_COMMENTS_PER_POST_MAX - post.personaComments - post.openQueuePersonaCodes.length,
  )
}

/** 글 쪽 자격 — 🔴 `judgeTargetPost` 정본을 재사용하고 planner 만의 조건을 더한다 */
export function judgePlannerPost(post: PlannerPost, nowMs: number): PlanBlock[] {
  const facts: TargetPostFacts = {
    status: post.status,
    personaComments: post.personaComments,
    memberComments: post.memberComments,
  }
  // 🔴 어드민 화면과 같은 규칙을 쓴다. 두 벌이면 한쪽이 조용히 낡는다
  const blocks: PlanBlock[] = judgeTargetPost(facts).blocks.map((b) => ({
    code: b.code as PlanBlockCode, message: b.message,
  }))

  // 🔴 대기열까지 세고도 자리가 없으면 이번 회차 대상이 아니다
  if (postSlotsOf(post) === 0) {
    blocks.push({
      code: 'POST_SLOTS_FULL',
      message: `댓글 ${post.personaComments}건 + 대기열 ${post.openQueuePersonaCodes.length}건`
        + ` — ${PERSONA_COMMENTS_PER_POST_MAX}자리가 찼다`,
    })
  }
  if (post.onHold === null) {
    blocks.push({ code: 'POST_HOLD_UNKNOWN', message: '노출 보류 여부를 읽지 못했다 — 제외한다(fail-closed)' })
  } else if (post.onHold) {
    blocks.push({ code: 'POST_ON_HOLD', message: '지금 노출에서 내려가 있는 글이다' })
  }
  if (post.operatorWritten === null) {
    blocks.push({
      code: 'POST_OPERATOR_UNKNOWN',
      message: '운영자 직접 글인지 읽지 못했다 — 제외한다(fail-closed)',
    })
  } else if (post.operatorWritten) {
    blocks.push({
      code: 'POST_OPERATOR_WRITTEN',
      message: '창업자가 직접 쓴 글이다 — 자동 배정 대상이 아니다',
    })
  }
  if (post.publishedAtMs === null) {
    blocks.push({ code: 'POST_PUBLISHED_AT_UNKNOWN', message: '공개 시각을 읽지 못했다 — 제외한다(fail-closed)' })
  } else if ((nowMs - post.publishedAtMs) / 86_400_000 > FRESHNESS_MAX_DAYS) {
    blocks.push({ code: 'POST_TOO_OLD', message: `공개된 지 ${FRESHNESS_MAX_DAYS}일이 넘었다` })
  }
  return blocks
}

/** Persona 쪽 자격 */
export function judgePlannerPersona(
  persona: PlannerPersona, post: PlannerPost, reactionRole: string,
): PlanBlock[] {
  const blocks: PlanBlock[] = []
  if (persona.status !== 'active') {
    blocks.push({ code: 'PERSONA_NOT_ACTIVE', message: `${persona.code} 는 active 가 아니다 (${persona.status})` })
  }
  /**
   * 🔴 실회원 판별은 **`judgeRealMember` 하나**가 한다.
   *    `real === true` 면 막는다 — `unknown` 이어도 `real` 이 true 라 함께 막힌다(fail-closed).
   */
  const real = judgeRealMember(persona.realMember)
  if (real.real) {
    blocks.push({
      code: real.unknown ? 'PERSONA_ACCOUNT_UNKNOWN' : 'PERSONA_HAS_ACCOUNT',
      message: `${persona.code} — ${real.reason}`,
    })
  }
  if (!persona.seedComplete) {
    blocks.push({ code: 'PERSONA_SEED_INCOMPLETE', message: `${persona.code} 의 seed·voice 가 불완전하다` })
  }
  if (post.authorPersonaCode !== null && post.authorPersonaCode === persona.code) {
    // 🔴 자기 글에 자기가 댓글을 달면 그것은 대화가 아니라 연출이다
    blocks.push({ code: 'PERSONA_OWN_POST', message: `${persona.code} 자신의 글이다` })
  }
  /**
   * 🔴 **같은 Persona 가 같은 글에 두 번 달지 않는다.**
   *
   *    글당 5건을 연 대가로 반드시 지켜야 하는 쪽이 이것이다.
   *    막아야 할 것은 "여럿이 말하는 것" 이 아니라 **"한 사람이 여럿인 척하는 것"** 이다.
   *    이미 발행된 댓글과 **열려 있는 대기열**을 둘 다 본다 — 대기열을 빼면
   *    승인을 기다리는 사이에 같은 사람이 한 번 더 계획된다.
   */
  if (post.personaCodesOnPost.includes(persona.code)) {
    blocks.push({
      code: 'PERSONA_ALREADY_ON_POST',
      message: `${persona.code} 는 이 글에 이미 댓글을 달았다`,
    })
  }
  if (post.openQueuePersonaCodes.includes(persona.code)) {
    blocks.push({
      code: 'PERSONA_ALREADY_ON_POST',
      message: `${persona.code} 는 이 글에 열린 대기열이 있다`,
    })
  }
  // 🔴 생활사·noGo — 글 매칭과 **같은 함수**를 부른다. 복붙하면 한쪽만 고쳐진다
  const req = readPostRequirements(post.title, post.body)
  const lifeBlocks = judgeLifeHistory(
    // 🔴 운영 조건·리듬은 위에서 따로 본다. 여기 넘기는 값은 판정에 쓰이지 않는 자리다
    {
      ...persona.life, code: persona.code,
      status: 'active', accountCount: 0, providerId: null, postsThisWeek: 0, daysSinceLastPost: null,
    },
    req, post.title, post.body,
  )
  for (const b of lifeBlocks) {
    blocks.push({ code: 'PERSONA_LIFE_CONFLICT', message: `${persona.code} — ${b.code}: ${b.detail}` })
  }
  if (persona.forbiddenReactionRoles.includes(reactionRole)) {
    blocks.push({ code: 'PERSONA_ROLE_FORBIDDEN', message: `${persona.code} 는 ${reactionRole} 역할을 맡지 않는다` })
  }
  /**
   * 🔴 **역할 쏠림은 회차 조건이다** (2026-10-01 · C9 보정). 지속 자격(contract-valid)은 그대로 두고,
   *    최근 창에서 한 역할이 절반을 넘은 사람에게는 **그 역할만** 이번 회차에 주지 않는다.
   *    역할 이력을 모르면 이번 회차에서 이 사람을 뺀다(fail-closed). 다른 사람 · 다른 역할로 회차는 이어진다.
   */
  const rr = roleRoundVerdict(persona.recentRoles)
  if (rr.status === 'unknown') {
    blocks.push({ code: 'PERSONA_ROLE_HISTORY_UNKNOWN', message: `${persona.code} — ${rr.reason}` })
  } else if (rr.blockedRoles.includes(reactionRole)) {
    blocks.push({ code: 'PERSONA_ROLE_CONCENTRATED', message: `${persona.code} 는 최근 ${reactionRole} 에 쏠렸다 (${rr.evidence})` })
  }
  return blocks
}

export type PlanInput = {
  posts: readonly PlannerPost[]
  personas: readonly PlannerPersona[]
  /**
   * 🔴 **이 조합으로 실제 입력을 만들 수 있는가** (2026-09-15).
   *
   *    planner 는 "누가 어느 역할로 말할 자격이 있는가" 만 안다. 그런데 자격이 있어도
   *    **입력을 만들 수 없는 조합**이 있다 — 겪은 일을 들려주는 역할인데 그 사람에게
   *    들려줄 근거가 없는 경우가 그렇다. 🔴 그 규칙은 입력 생성기가 갖는다.
   *    여기에 이름조차 적지 않는다 — 적는 순간 규칙이 두 곳에 생긴다.
   *
   *    🔴 실측(2026-09-15): 관리형 글 1편이 1순위로 뽑혔는데, 역할 분산이 그 자리에
   *       `experience` 를 놓았고 근거가 없어 입력이 0건이 됐다. planner 는 그 사실을
   *       모른 채 **그 글을 통째로 포기**했다 — 같은 글에 가능한 다른 조합이 있었는데도.
   *
   *    🔴 그래서 "만들 수 있는가" 를 **고르는 순간에** 묻는다. 규칙을 여기 복제하지 않는다 —
   *       판정은 부르는 쪽이 실제 입력 생성기로 하고, 그 결과만 넘긴다.
   *    🔴 생략하면 옛 동작 그대로다(전부 가능하다고 본다).
   */
  feasible?: (combo: { postId: string; personaCode: string; reactionRole: string }) => PlanBlock[]
  /**
   * 붙일 수 있는 반응 역할들. 🔴 생략하면 정본(`COMMENT_REACTION_ROLES`)을 쓴다 —
   * 호출부가 제 낱말을 지어내면 생성기가 그것을 거부한다(`share` 사례).
   */
  reactionRoles?: readonly string[]
  /** 🔴 governor 가 정한 오늘 상한. 이보다 많이 뽑지 않는다 */
  limit: number
  nowMs: number
  /**
   * 🔴 최근 창에서 각 역할이 몇 번 쓰였는가 — **필수다.**
   *
   *    선택으로 두었더니 호출부가 넘기지 않아도 조용히 돌았다. 그러면 프로세스가
   *    새로 뜰 때마다 `empathy` 부터 다시 고르고, 회차가 바뀌어도 같은 역할만 나간다 —
   *    커뮤니티는 응원봇 하나를 보게 된다.
   *
   *    fixture 로는 이 누락을 잡을 수 없다(순수 함수는 호출부를 보지 못한다).
   *    그래서 **타입으로 막는다** — 빠뜨리면 typecheck 가 실패한다.
   *    읽지 못했으면 `{}` 를 명시적으로 넘긴다. "못 읽었다" 와 "안 넘겼다" 는 다르다.
   */
  recentRoleCounts: Readonly<Record<string, number>>
}

/**
 * 🔴 **같은 Persona 가 같은 글에 두 번 달지 않는다** (2026-09-11 계약 교체).
 *
 *    옛 판은 "한 Persona 는 **한 회차에** 한 번만" 이었다. 글당 1건 시절에는
 *    그 둘이 같은 뜻이었지만, 글당 5건을 열고 나면 완전히 다른 규칙이 된다 —
 *    Persona 가 24명인데 회차당 1회씩만 쓰면 하루 24건이 천장이 되고,
 *    글 100편 × 5자리(=500)는 영원히 닿지 못하는 수가 된다.
 *
 *    그래서 제약을 **글 단위**로 옮긴다. 한 사람이 여러 글에 말하는 것은 커뮤니티이고,
 *    한 사람이 한 글에 두 번 말하는 것은 여럿인 척하는 것이다. 막을 것은 뒤엣것이다.
 *
 * 🔴 **댓글 0개 글이 항상 먼저다.** 라운드로빈으로 한 바퀴에 글마다 한 건씩 붙인다 —
 *    한 글을 5건까지 채우고 다음 글로 가면, 상한이 걸리는 순간
 *    **댓글 5건짜리 글 하나와 댓글 0건짜리 글 아흔아홉**이 남는다.
 *
 * 🔴 역할도 고르게 쓴다 — 전부 `empathy` 면 커뮤니티가 아니라 응원봇이 된다.
 */
export function planCommentDistribution(input: PlanInput): PlanResult {
  const items: PlanItem[] = []
  const skipped: { postId: string; blocks: PlanBlock[] }[] = []
  const roles = input.reactionRoles ?? COMMENT_REACTION_ROLES

  // ① 글 자격을 먼저 거른다
  //
  // 🔴 상한이 0 이어도 **여기까지는 돈다.** 상한 0 에서 곧바로 빠져나가면
  //    "왜 하나도 안 뽑혔는가" 를 물었을 때 대답이 사라진다 —
  //    상한 때문인지 대상이 없어서인지 운영자가 구분할 수 없게 된다.
  const eligible: PlannerPost[] = []
  for (const post of input.posts) {
    const blocks = judgePlannerPost(post, input.nowMs)
    if (blocks.length > 0) skipped.push({ postId: post.id, blocks })
    else eligible.push(post)
  }
  if (input.limit <= 0 || roles.length === 0) {
    for (const p of eligible) {
      skipped.push({
        postId: p.id,
        blocks: [{ code: 'LIMIT_EXHAUSTED', message: '자격은 있지만 오늘 상한이 0 이다' }],
      })
    }
    return { items, skipped }
  }
  // ② 댓글 0개 · 최신 순
  eligible.sort((a, b) => priorityOf(a, input.nowMs) - priorityOf(b, input.nowMs) || a.id.localeCompare(b.id))

  /** 이번 회차에 이 글에 배정한 Persona 들 */
  const takenByPost = new Map<string, Set<string>>()
  /** 이번 회차에 이 Persona 를 몇 번 썼는가 — 🔴 적게 쓴 사람부터 고른다 */
  const assigned = new Map<string, number>()
  const roleCount: Record<string, number> = { ...input.recentRoleCounts }
  /** 글별로 "왜 못 붙였나" 를 모은다 — 조용히 사라지지 않게 한다 */
  const whyNot = new Map<string, PlanBlock[]>()

  /** 🔴 이 글에 한 건 붙여 본다. 붙일 수 없으면 사유를 모아 null 을 돌려준다 */
  const pickOne = (post: PlannerPost): PlanItem | null => {
    const taken = takenByPost.get(post.id) ?? new Set<string>()
    // 🔴 지금까지 **가장 적게 쓰인 역할**부터 시도한다
    const orderedRoles = [...roles].sort(
      (a, b) => (roleCount[a] ?? 0) - (roleCount[b] ?? 0) || a.localeCompare(b),
    )
    // 🔴 이번 회차에 적게 말한 사람 → 최근 창에서 적게 말한 사람 순
    const candidates = [...input.personas].sort(
      (a, b) => (assigned.get(a.code) ?? 0) - (assigned.get(b.code) ?? 0)
        || a.recentComments - b.recentComments
        || a.code.localeCompare(b.code),
    )
    const blocks: PlanBlock[] = []
    for (const role of orderedRoles) {
      for (const persona of candidates) {
        // 🔴 이번 회차에 이 글에 이미 배정한 사람은 다시 고르지 않는다
        if (taken.has(persona.code)) continue
        const personaBlocks = judgePlannerPersona(persona, post, role)
        if (personaBlocks.length > 0) { blocks.push(...personaBlocks); continue }
        /**
         * 🔴 **자격이 있어도 만들 수 없으면 고르지 않는다.**
         *    순서는 그대로다 — 분산 규칙이 정한 차례대로 물어보고,
         *    만들 수 없는 조합만 건너뛴다. 같은 글의 **다음 조합**으로 이어진다.
         *    🔴 안전장치를 무르지 않는다. 막힌 조합을 **고르지 않을** 뿐이다.
         */
        const notBuildable = input.feasible?.({
          postId: post.id, personaCode: persona.code, reactionRole: role,
        }) ?? []
        if (notBuildable.length > 0) { blocks.push(...notBuildable); continue }
        const total = post.memberComments + post.personaComments
        return {
          postId: post.id, personaCode: persona.code, reactionRole: role,
          priority: priorityOf(post, input.nowMs),
          why: total === 0 && taken.size === 0
            ? '아무도 답하지 않은 글이다'
            : `댓글 ${total + taken.size}건 — 글당 ${PERSONA_COMMENTS_PER_POST_MAX}건 미만이라 아직 자리가 있다`,
        }
      }
    }
    const prior = whyNot.get(post.id) ?? []
    whyNot.set(post.id, [...prior, ...blocks])
    return null
  }

  /**
   * ③ 🔴 **라운드로빈.** 한 바퀴에 글마다 한 건씩, 최대 `PERSONA_COMMENTS_PER_POST_MAX` 바퀴.
   *    바퀴 수가 유한하고 한 바퀴가 유한하므로 무한 루프는 없다.
   */
  outer: for (let pass = 0; pass < PERSONA_COMMENTS_PER_POST_MAX; pass += 1) {
    let progressed = false
    for (const post of eligible) {
      if (items.length >= input.limit) break outer
      const taken = takenByPost.get(post.id) ?? new Set<string>()
      // 🔴 이미 찬 자리에는 더 넣지 않는다 (기존 댓글 + 열린 대기열 + 이번 회차 배정)
      if (taken.size >= postSlotsOf(post)) continue
      const picked = pickOne(post)
      if (picked === null) continue
      items.push(picked)
      taken.add(picked.personaCode)
      takenByPost.set(post.id, taken)
      assigned.set(picked.personaCode, (assigned.get(picked.personaCode) ?? 0) + 1)
      roleCount[picked.reactionRole] = (roleCount[picked.reactionRole] ?? 0) + 1
      progressed = true
    }
    // 🔴 한 바퀴를 돌고도 하나도 못 붙였으면 더 돌아도 같다
    if (!progressed) break
  }

  // ④ 🔴 **한 건도 못 붙인 글만** skipped 에 남긴다. 일부라도 붙은 글은 성공이다
  for (const post of eligible) {
    if ((takenByPost.get(post.id)?.size ?? 0) > 0) continue
    const blocks = whyNot.get(post.id) ?? []
    skipped.push({
      postId: post.id,
      blocks: blocks.length > 0 ? blocks
        : [{ code: 'NO_ELIGIBLE_PERSONA', message: '이 글에 붙일 수 있는 Persona 가 없다' }],
    })
  }
  return { items, skipped }
}
