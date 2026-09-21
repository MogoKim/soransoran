/**
 * Persona 24 → 180~200 **확장 계약** — 🔴 순수 함수
 *
 * 🔴 **카드만 늘린다고 READY 가 되지 않는다.** 이 파일이 그것을 타입과 판정으로 막는다.
 *    한 사람이 서려면 생활사 14축 · 말투 근거 · 활동 여력 · 자격이 전부 있어야 한다.
 *
 * 🔴 **이번 PR 은 Persona 를 만들지 않는다.** 필요 인원과 준비 상태만 계산한다.
 */
import { LIFE_CONTRACT_FIELDS } from './content-core/speaker'
import { d100Plan, D100_PERSONA_TARGET_MAX, type D100Stage } from './d100-capacity'

/** 🔴 생활사 축은 생성 계약과 **같은 목록**이다 — 여기서 다시 적지 않는다 */
export const PERSONA_LIFE_AXES = LIFE_CONTRACT_FIELDS

/** 🔴 말투 근거 최소치 — 이보다 적으면 그 사람의 말투라고 부를 수 없다 */
export const VOICE_MIN_COMMENTS = 3

/**
 * 🔴 **세 층을 가른다** (2026-09-21 2차 보정).
 *
 *    앞판은 `personaUsable` 하나가 전부를 판정했다. 그래서 "오늘 활동 상한을 다 쓴 사람"
 *    과 "생활사 카드가 비어 있는 사람" 이 같은 `usable=false` 로 뭉쳤다 — 앞은 **오늘만**
 *    못 쓰는 것이고 뒤는 **아직 만들어지지 않은 것**이다. 180명을 언제까지 채워야 하는지
 *    계획하려면 둘을 따로 세야 한다.
 *
 *    `card`        사람 자체가 완성됐는가 — 한 번 채우면 유지된다
 *    `pool`        지금 풀에 들어갈 수 있는가 — 말투 근거·퇴역·휴면
 *    `assignment`  **이번 회차에** 배정할 수 있는가 — 회차마다 달라진다
 */
export const CARD_BLOCK_CODES = ['lifeAxisMissing', 'noAgeBand', 'qualificationConflict'] as const
export const POOL_BLOCK_CODES = ['voiceEvidenceThin', 'retired', 'dormant'] as const
export const ASSIGNMENT_BLOCK_CODES = [
  'activityOverCap', 'consecutiveExposure', 'topicConcentrated', 'roleConcentrated', 'pairRepeat',
] as const

export const PERSONA_BLOCK_CODES = [
  ...CARD_BLOCK_CODES, ...POOL_BLOCK_CODES, ...ASSIGNMENT_BLOCK_CODES,
] as const
export type PersonaBlockCode = (typeof PERSONA_BLOCK_CODES)[number]

export const PERSONA_TIERS = ['card', 'pool', 'assignment'] as const
export type PersonaTier = (typeof PERSONA_TIERS)[number]

/** 🔴 코드마다 어느 층인지 하나로 정해 둔다 — 두 곳에서 다르게 세지 않게 */
export const PERSONA_BLOCK_TIER: Readonly<Record<PersonaBlockCode, PersonaTier>> = {
  lifeAxisMissing: 'card', noAgeBand: 'card', qualificationConflict: 'card',
  voiceEvidenceThin: 'pool', retired: 'pool', dormant: 'pool',
  activityOverCap: 'assignment', consecutiveExposure: 'assignment',
  topicConcentrated: 'assignment', roleConcentrated: 'assignment', pairRepeat: 'assignment',
}

export const PERSONA_BLOCK_LABEL: Readonly<Record<PersonaBlockCode, string>> = {
  lifeAxisMissing: '생활사 축이 비었다',
  voiceEvidenceThin: '말투 근거가 모자라다',
  noAgeBand: '나이대가 없다 — 글쓴이가 몇 살인지 모른다',
  topicConcentrated: '한 소재에 쏠렸다',
  roleConcentrated: '한 역할에 쏠렸다',
  activityOverCap: '글·댓글 합산 활동 상한을 넘겼다',
  consecutiveExposure: '연속으로 노출됐다',
  pairRepeat: '같은 조합이 반복됐다',
  dormant: '휴면이다',
  retired: '퇴역했다',
  qualificationConflict: '자격이 충돌한다',
}

/** 🔴 한 사람이 하루에 쓸 수 있는 글·댓글 합 — 사람처럼 보이는 상한이다 */
export const ACTIVITY_CAP_PER_DAY = 6
/** 🔴 한 사람이 연속으로 노출될 수 있는 횟수 */
export const CONSECUTIVE_EXPOSURE_CAP = 1
/** 🔴 같은 두 사람이 한 글에 다시 붙기까지 비워야 할 글 수 */
export const PAIR_REPEAT_GAP = 5
/** 🔴 이 기간 활동이 없으면 휴면 */
export const DORMANT_AFTER_DAYS = 30
/**
 * 🔴 **쏠림 상한** — 이 사람의 최근 활동 중 가장 많은 소재(역할) 하나가 차지하는 비율.
 *    절반을 넘으면 "무슨 얘기든 하는 사람" 이 아니라 "그 얘기만 하는 사람" 이고,
 *    그런 사람이 계속 나오면 커뮤니티가 아니라 봇 목록처럼 읽힌다.
 *
 * 🔴 앞판은 `topicConcentrated`·`roleConcentrated`·`pairRepeat` 세 코드를 **선언만 해 두고
 *    아무 데서도 내보내지 않았다.** 목록에 있으니 막고 있는 것처럼 보였지만 실제로는
 *    한 번도 걸린 적이 없다. 판정하거나 지우거나 둘 중 하나여야 한다 — 판정한다.
 */
export const TOPIC_SHARE_CAP = 0.5
export const ROLE_SHARE_CAP = 0.5

export type PersonaCandidate = {
  code: string
  /** 생활사 14축 중 값이 있는 축 */
  filledAxes: readonly string[]
  ageBand: string | null
  /** 말투 근거 댓글 수 */
  voiceComments: number
  /** 오늘 이미 한 글+댓글 */
  activityToday: number
  /** 바로 앞 글에 연속으로 나왔는가 */
  consecutiveExposures: number
  /** 마지막 활동 이후 지난 날 */
  daysSinceActive: number
  retired: boolean
  qualificationConflict: boolean
  /**
   * 🔴 이 사람의 최근 활동 중 **가장 많은 소재 하나**가 차지하는 비율(0~1).
   *    재지 않았으면 `null` 이다 — 0 으로 채우지 않는다.
   */
  topicShare: number | null
  /** 🔴 같은 뜻의 역할 쏠림 비율. 재지 않았으면 `null` */
  roleShare: number | null
  /**
   * 🔴 같은 상대와 마지막으로 한 글에 붙은 뒤 지나간 글 수.
   *    `'never'` = 아직 누구와도 겹친 적이 없다(막지 않는다) · `null` = 재지 않았다
   */
  postsSinceLastPairing: number | 'never' | null
}

export type TierVerdict = {
  ok: boolean
  blocked: PersonaBlockCode[]
  /** 🔴 **재지 않아 판단할 수 없는 것.** `blocked` 와 다르다 — 모르는 것은 통과가 아니다 */
  unmeasured: PersonaBlockCode[]
}

export type PersonaTierVerdict = Readonly<Record<PersonaTier, TierVerdict>>

/**
 * 🔴 **층별로 판정한다.** 어느 층에서 막혔는지가 "무엇을 하면 되는가" 를 정한다 —
 *    card 면 사람을 채워야 하고, pool 이면 자산을 모아야 하고,
 *    assignment 면 **오늘만** 못 쓰는 것이라 아무것도 만들 필요가 없다.
 */
export function personaTiers(p: PersonaCandidate): PersonaTierVerdict {
  const card: TierVerdict = { ok: true, blocked: [], unmeasured: [] }
  const pool: TierVerdict = { ok: true, blocked: [], unmeasured: [] }
  const assign: TierVerdict = { ok: true, blocked: [], unmeasured: [] }

  if (PERSONA_LIFE_AXES.some((a) => !p.filledAxes.includes(a))) card.blocked.push('lifeAxisMissing')
  if (p.ageBand === null || p.ageBand.trim() === '') card.blocked.push('noAgeBand')
  if (p.qualificationConflict) card.blocked.push('qualificationConflict')

  if (p.voiceComments < VOICE_MIN_COMMENTS) pool.blocked.push('voiceEvidenceThin')
  if (p.retired) pool.blocked.push('retired')
  if (p.daysSinceActive >= DORMANT_AFTER_DAYS) pool.blocked.push('dormant')

  if (p.activityToday >= ACTIVITY_CAP_PER_DAY) assign.blocked.push('activityOverCap')
  if (p.consecutiveExposures > CONSECUTIVE_EXPOSURE_CAP) assign.blocked.push('consecutiveExposure')
  if (p.topicShare === null) assign.unmeasured.push('topicConcentrated')
  else if (p.topicShare > TOPIC_SHARE_CAP) assign.blocked.push('topicConcentrated')
  if (p.roleShare === null) assign.unmeasured.push('roleConcentrated')
  else if (p.roleShare > ROLE_SHARE_CAP) assign.blocked.push('roleConcentrated')
  if (p.postsSinceLastPairing === null) assign.unmeasured.push('pairRepeat')
  else if (p.postsSinceLastPairing !== 'never' && p.postsSinceLastPairing < PAIR_REPEAT_GAP) {
    assign.blocked.push('pairRepeat')
  }

  for (const t of [card, pool, assign]) t.ok = t.blocked.length === 0 && t.unmeasured.length === 0
  return { card, pool, assignment: assign }
}

/** 🔴 사람 자체가 완성됐는가 — 이 층만 통과하면 "카드가 있다" 이지 "쓸 수 있다" 가 아니다 */
export function personaCardComplete(p: PersonaCandidate): boolean {
  return personaTiers(p).card.ok
}

/** 🔴 지금 풀에 들어가는가 — 카드까지 통과해야 한다 */
export function personaInPool(p: PersonaCandidate): boolean {
  const t = personaTiers(p)
  return t.card.ok && t.pool.ok
}

/** 🔴 **이번 회차에** 배정할 수 있는가 — 재지 않은 축이 있으면 배정하지 않는다 */
export function personaAssignableNow(p: PersonaCandidate): boolean {
  const t = personaTiers(p)
  return t.card.ok && t.pool.ok && t.assignment.ok
}

/** 🔴 이 사람을 막는 이유 전부 — 층 구분 없이 한 줄로 본다 */
export function personaBlockers(p: PersonaCandidate): PersonaBlockCode[] {
  const t = personaTiers(p)
  return [...t.card.blocked, ...t.pool.blocked, ...t.assignment.blocked]
}

/** 🔴 재지 않아 판단할 수 없는 축 — **통과가 아니다** */
export function personaUnmeasured(p: PersonaCandidate): PersonaBlockCode[] {
  const t = personaTiers(p)
  return [...t.card.unmeasured, ...t.pool.unmeasured, ...t.assignment.unmeasured]
}

/** 🔴 지금 이 회차에 실제로 쓸 수 있는가 */
export function personaUsable(p: PersonaCandidate): boolean {
  return personaAssignableNow(p)
}

export type PersonaScaleNeed = {
  stage: D100Stage
  target: number
  targetMax: number
  /** 전체 카드 수 */
  cards: number
  /** 🔴 사람 자체가 완성된 수 — 카드만 있는 것과 다르다 */
  cardComplete: number
  /** 🔴 지금 풀에 드는 수 — **이 값이 확장 계획의 기준이다** */
  poolReady: number
  /** 🔴 이번 회차에 배정 가능한 수 — 하루마다 달라진다. 확장 목표와 견주지 않는다 */
  assignableNow: number
  /** 🔴 카드는 있는데 풀에 못 드는 사람 */
  cardsOnly: number
  /** 🔴 배정 축을 재지 않아 판단할 수 없는 사람 수 */
  assignmentUnmeasured: number
  /** 🔴 확장 목표 대비 부족분 — **`poolReady` 기준**이다 */
  shortfall: number
  ready: boolean
  /** 층별로 몇 명이 무엇에 막혔는가 */
  blockedBy: Readonly<Record<PersonaBlockCode, number>>
}

/**
 * 🔴 **카드 수가 아니라 풀에 드는 사람 수로 센다.**
 *    카드만 180장 만들어도 `poolReady` 가 모자라면 READY 가 아니다.
 *
 * 🔴 **확장 목표는 `assignableNow` 로 재지 않는다.** 그 값은 오늘 활동 상한·연속 노출
 *    때문에 매일 출렁인다 — 그것으로 "180명 됐다/안 됐다" 를 말하면 하루 단위로 답이 바뀐다.
 */
export function judgePersonaScale(input: {
  stage: D100Stage
  candidates: readonly PersonaCandidate[]
}): PersonaScaleNeed {
  const plan = d100Plan(input.stage)
  const cardComplete = input.candidates.filter(personaCardComplete).length
  const poolReady = input.candidates.filter(personaInPool).length
  const assignableNow = input.candidates.filter(personaAssignableNow).length

  const blockedBy = Object.fromEntries(
    PERSONA_BLOCK_CODES.map((c) => [c, 0]),
  ) as Record<PersonaBlockCode, number>
  let assignmentUnmeasured = 0
  for (const p of input.candidates) {
    for (const c of personaBlockers(p)) blockedBy[c] += 1
    if (personaTiers(p).assignment.unmeasured.length > 0) assignmentUnmeasured += 1
  }

  return {
    stage: input.stage,
    target: plan.activePersonaTarget,
    targetMax: input.stage === 'd100' ? D100_PERSONA_TARGET_MAX : plan.activePersonaTarget,
    cards: input.candidates.length,
    cardComplete, poolReady, assignableNow,
    cardsOnly: input.candidates.length - poolReady,
    assignmentUnmeasured,
    shortfall: Math.max(0, plan.activePersonaTarget - poolReady),
    ready: poolReady >= plan.activePersonaTarget,
    blockedBy,
  }
}
