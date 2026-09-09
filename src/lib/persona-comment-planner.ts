/**
 * Persona 댓글 **분산 planner** — 🔴 순수 함수. DB · 시계 · 네트워크 없음
 *
 * 🔴 **무엇을 푸는가.**
 *
 *    공개 글 32건 중 27건에 댓글이 하나도 없다. 그 자리에 사람 대신 봇을 채우는 것이
 *    목적이 아니다 — 목적은 **말해도 되는 분위기**를 만드는 것이고, 그러려면
 *    ① 아무도 답하지 않은 글을 먼저 골라야 하고
 *    ② 같은 사람이 계속 나타나면 안 되고
 *    ③ 사람들끼리 대화가 붙은 자리에는 끼어들지 않아야 한다.
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
import { judgeRealMember, type RealMemberProbe } from './real-member-gate'
import { judgeTargetPost, MEMBER_COMMENT_LIMIT, type TargetPostFacts } from './persona-target-rules'

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
  /** 이 글을 대상으로 하는 Queue 가 이미 있는가 */
  hasOpenQueue: boolean
  /** 공개된 시각(epoch ms). 모르면 null — 🔴 null 은 제외 사유다 */
  publishedAtMs: number | null
  /** 지금 노출 대상에서 내려가 있는가(expired/hold 등). 모르면 null */
  onHold: boolean | null
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
  | 'POST_HAS_PERSONA_COMMENT'
  | 'POST_MEMBER_COMMENTS_FULL'
  | 'POST_HAS_OPEN_QUEUE'
  | 'POST_ON_HOLD'
  | 'POST_HOLD_UNKNOWN'
  | 'POST_PUBLISHED_AT_UNKNOWN'
  | 'POST_TOO_OLD'
  | 'PERSONA_NOT_ACTIVE'
  | 'PERSONA_HAS_ACCOUNT'
  | 'PERSONA_ACCOUNT_UNKNOWN'
  | 'PERSONA_SEED_INCOMPLETE'
  | 'PERSONA_OWN_POST'
  | 'PERSONA_LIFE_CONFLICT'
  | 'PERSONA_ROLE_FORBIDDEN'
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
 *    ② 회원 댓글이 적은 글
 *    그 안에서 최신 글이 먼저다 — 오래된 글에 붙는 댓글은 대화가 아니다.
 */
export function priorityOf(post: PlannerPost, nowMs: number): number {
  const total = post.memberComments + post.personaComments
  const ageDays = post.publishedAtMs === null ? 9_999 : (nowMs - post.publishedAtMs) / 86_400_000
  return total * 1_000 + Math.max(0, Math.floor(ageDays))
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

  if (post.hasOpenQueue) {
    blocks.push({ code: 'POST_HAS_OPEN_QUEUE', message: '이 글을 대상으로 하는 대기열이 이미 있다' })
  }
  if (post.onHold === null) {
    blocks.push({ code: 'POST_HOLD_UNKNOWN', message: '노출 보류 여부를 읽지 못했다 — 제외한다(fail-closed)' })
  } else if (post.onHold) {
    blocks.push({ code: 'POST_ON_HOLD', message: '지금 노출에서 내려가 있는 글이다' })
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
  return blocks
}

export type PlanInput = {
  posts: readonly PlannerPost[]
  personas: readonly PlannerPersona[]
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
 * 🔴 **한 Persona 는 한 회차에 한 번만** 나온다. 같은 얼굴이 연달아 나오면
 *    사람들은 그것이 사람이 아니라는 것을 먼저 알아차린다.
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

  const usedPersona = new Set<string>()
  const roleCount: Record<string, number> = { ...input.recentRoleCounts }

  for (const post of eligible) {
    if (items.length >= input.limit) break
    // 🔴 지금까지 **가장 적게 쓰인 역할**부터 시도한다
    const ordered = [...roles].sort(
      (a, b) => (roleCount[a] ?? 0) - (roleCount[b] ?? 0) || a.localeCompare(b),
    )
    // 🔴 최근에 적게 말한 Persona 를 먼저 — 같은 사람이 계속 나타나지 않게
    const candidates = [...input.personas].sort(
      (a, b) => a.recentComments - b.recentComments || a.code.localeCompare(b.code),
    )
    let picked: PlanItem | null = null
    const postBlocks: PlanBlock[] = []
    for (const role of ordered) {
      for (const persona of candidates) {
        if (usedPersona.has(persona.code)) continue
        const blocks = judgePlannerPersona(persona, post, role)
        if (blocks.length > 0) { postBlocks.push(...blocks); continue }
        picked = {
          postId: post.id, personaCode: persona.code, reactionRole: role,
          priority: priorityOf(post, input.nowMs),
          why: post.memberComments + post.personaComments === 0
            ? '아무도 답하지 않은 글이다'
            : `댓글 ${post.memberComments + post.personaComments}건 — ${MEMBER_COMMENT_LIMIT}건 미만이라 아직 자리가 있다`,
        }
        break
      }
      if (picked !== null) break
    }
    if (picked === null) {
      skipped.push({
        postId: post.id,
        blocks: postBlocks.length > 0 ? postBlocks
          : [{ code: 'NO_ELIGIBLE_PERSONA', message: '이 글에 붙일 수 있는 Persona 가 없다' }],
      })
      continue
    }
    items.push(picked)
    usedPersona.add(picked.personaCode)
    roleCount[picked.reactionRole] = (roleCount[picked.reactionRole] ?? 0) + 1
  }
  return { items, skipped }
}
