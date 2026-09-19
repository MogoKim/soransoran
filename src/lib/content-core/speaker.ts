/**
 * Persona 와 stance 를 **함께** 고른다 — 🔴 자격이 없으면 자리를 낮춘다
 *
 * 🔴 **v1 의 `noLifeFit → 모든 Persona 후보` fallback 은 여기서 금지다.**
 *    그 줄 때문에 전업인 Persona 가 *"제가 일하는 곳이 편의점 알바인데"* 를 썼다
 *    (2026-09-19 유료 실측). 맞는 사람이 없으면 **아무나 주는 것이 아니라**
 *    글이 1인칭으로 주장하지 않게 자리를 바꾼다.
 *
 * 🔴 **직업·지역·혼인·자녀·돌봄·갱년기·나이는 그 자체로 차단 축이 아니다.**
 *    글이 그 사실을 **1인칭으로 주장할 때만** 자격 조건이 된다 —
 *    곁에서 본 이야기 · 읽고 든 생각 · 궁금해서 묻는 글에는 필요하지 않다.
 */
import type { PoolCard } from '../persona-pool-card'
import type { ClaimFact, ClaimRequirement, ClaimVocabulary, SourceEssence } from './essence'

export const SPEAKER_PLAN_VERSION = 'speaker-v1'

/** 화자가 서는 자리 — 🔴 코드가 정한다. 프롬프트에 떠넘기지 않는다 */
export const STANCES = ['SELF_EXPERIENCE', 'OBSERVATION', 'REFLECTION', 'QUESTION'] as const
export type Stance = (typeof STANCES)[number]

export const STANCE_LABEL: Readonly<Record<Stance, string>> = {
  SELF_EXPERIENCE: '내가 겪은 일로 쓴다',
  OBSERVATION: '곁에서 본 일로 쓴다 — 내 일로 말하지 않는다',
  REFLECTION: '읽고 든 생각으로 쓴다 — 겪었다고 말하지 않는다',
  QUESTION: '궁금해서 묻는 글로 쓴다 — 겪었다고 말하지 않는다',
}

/**
 * 🔴 **정본 카드에서 가져온다 — v2 전용으로 다시 정의하지 않는다** (2026-09-19).
 *
 *    앞판은 `SpeakerFacts` 라는 축소판을 따로 두었다. 그래서 생성도 검수도
 *    **선택된 사람의 생활사 전부**를 보지 못했고, 초안이 새로 지어낸 직업·자녀·
 *    혼인·지역·형편을 검사할 근거가 없었다.
 *    🔴 정본은 `PoolCard` 다. 여기서는 **필요한 칸만 고른다.**
 */
export type PersonaLifeContract = Pick<PoolCard,
  | 'code' | 'ageBand' | 'region' | 'maritalStatus' | 'spouseRelationship'
  | 'childrenCount' | 'childrenAgeBands' | 'workStatus' | 'economicStatus'
  | 'menopauseStatus' | 'parentCare' | 'personality' | 'noGoTopics' | 'noGoExpressions'>

/** 🔴 카드가 실제로 가진 값들 — 자격 어휘를 여기서 짓지 않는다 */
export function vocabularyOf(cards: readonly PersonaLifeContract[]): ClaimVocabulary {
  const uniq = (xs: readonly string[]): string[] =>
    [...new Set(xs.map((x) => x.trim()).filter((x) => x !== ''))].sort()
  return {
    work: uniq(cards.map((c) => c.workStatus)),
    region: uniq(cards.map((c) => c.region)),
    age: uniq(cards.map((c) => c.ageBand)),
    childAgeBand: uniq(cards.flatMap((c) => c.childrenAgeBands)),
  }
}

export type SpeakerDecision = 'ok' | 'hold'

export type CoverageGap = {
  sourceArticleId: string
  /** 어떤 사실을 가진 사람이 없었나 */
  missing: { fact: ClaimFact; requiredValue: string }[]
  /** 🔴 관점을 낮출 수 없던 이유 */
  why: 'coreIsOwnExperience' | 'noPersona'
}

export type SpeakerPlan = {
  decision: SpeakerDecision
  personaCode: string | null
  stance: Stance | null
  /** 이 Persona 가 채우지 못한 주장 — 🔴 생성이 이것을 1인칭으로 쓰지 못한다 */
  unmetClaims: ClaimRequirement[]
  coverageGap: CoverageGap | null
  reason: string
  planVersion: string
}

/**
 * 한 사실을 이 사람이 가지고 있는가 — 🔴 **정규 값끼리만 견준다.**
 *
 *    앞판은 자유 문장 `detail` 로 `includes` 를 했다. `'전업'.includes('')` 가 참이라
 *    빈 값이 모든 사람을 충족시켰고, *"자녀 없이 주변 관찰로 쓴 글"* 같은 **관점 설명**이
 *    자녀 자격값으로 쓰였다. 이제 `requiredValue` 만 본다.
 */
const eq = (a: string | null | undefined, b: string): boolean =>
  (a ?? '').trim() !== '' && (a ?? '').trim() === b.trim()

export function hasFact(p: PersonaLifeContract, c: ClaimRequirement): boolean {
  const want = c.requiredValue.trim()
  if (want === '') return false
  switch (c.fact) {
    case 'spouse': return want === '있음' ? p.maritalStatus.trim() === '기혼' : false
    /**
     * 🔴 **`없음` 도 견줄 수 있는 축이다** (2026-09-19 실측 보정).
     *    카드에 `childrenCount = 0` 이라는 판정 가능한 값이 실제로 있다.
     *    원문이 *"전 아직 자녀는 없지만"* 일 때 자녀 0인 사람이 1인칭으로 쓸 수 있다.
     */
    case 'children':
      return want === '있음' ? p.childrenCount > 0 : want === '없음' ? p.childrenCount === 0 : false
    case 'childAgeBand': return p.childrenAgeBands.some((b) => b.trim() === want)
    case 'parentCare': return want === '있음' ? p.parentCare.trim() !== '없음' : false
    // 🔴 `전` 은 아직 겪지 않았다는 뜻이다 — 경험 주장의 근거가 될 수 없다
    case 'menopause': return want === '있음' ? p.menopauseStatus.trim() !== '전' : false
    // 🔴 카드 값과 **그대로** 같아야 한다 — 부분 일치를 쓰지 않는다
    case 'work': return eq(p.workStatus, want)
    case 'region': return eq(p.region, want)
    case 'age': return eq(p.ageBand, want)
    default: return false
  }
}

export function unmetFor(p: PersonaLifeContract, claims: readonly ClaimRequirement[]): ClaimRequirement[] {
  return claims.filter((c) => !hasFact(p, c))
}

/**
 * 🔴 **관점을 낮춰도 이야기가 살아남는가.**
 *    남은 주장이 하나라도 "바꿀 수 없다" 면 당사자 경험이 알맹이라는 뜻이다.
 *    그리고 이 글의 역할이 **경험 공감 하나뿐**이면, 관찰로 바꾸는 순간 알맹이가 없어진다.
 */
export function stanceKeepsEssence(e: SourceEssence, unmet: readonly ClaimRequirement[]): boolean {
  if (unmet.some((c) => !c.stanceShiftable)) return false
  const roles = e.contentRoles
  if (roles.length === 1 && roles[0] === 'experienceResonance') return false
  return true
}

/** 자격을 채우지 못했을 때 어느 자리로 내려갈까 — 🔴 원문이 닫는 방식을 따른다 */
export function fallbackStance(e: SourceEssence): Stance {
  if (e.closingIntent === 'ask') return 'QUESTION'
  if (e.contentRoles.includes('experienceResonance')) return 'OBSERVATION'
  return 'REFLECTION'
}

/**
 * Persona 와 stance 를 함께 고른다.
 *
 * 🔴 **부하가 적은 사람을 고르는 것은 자격을 채운 사람들 안에서만 한다.**
 *    자격 밖으로 넓히지 않는다.
 */
export function planSpeaker(input: {
  sourceArticleId: string
  essence: SourceEssence
  personas: readonly PersonaLifeContract[]
  /** 이번 회차에 이미 맡은 수 */
  load?: Readonly<Record<string, number>>
}): SpeakerPlan {
  const base = { unmetClaims: [] as ClaimRequirement[], coverageGap: null, planVersion: SPEAKER_PLAN_VERSION }
  const personas = [...input.personas].sort((a, b) => a.code.localeCompare(b.code))
  const load = input.load ?? {}
  const leastLoaded = (codes: readonly string[]): string | null => {
    if (codes.length === 0) return null
    let best = codes[0]!
    for (const c of codes) if ((load[c] ?? 0) < (load[best] ?? 0)) best = c
    return best
  }

  if (personas.length === 0) {
    return {
      ...base, decision: 'hold', personaCode: null, stance: null,
      reason: '쓸 수 있는 Persona 가 없다',
      coverageGap: { sourceArticleId: input.sourceArticleId, missing: [], why: 'noPersona' },
    }
  }

  const claims = input.essence.claimRequirements
  // ── ① 1인칭으로 다 말할 수 있는 사람 ──
  const fullyQualified = personas.filter((p) => unmetFor(p, claims).length === 0).map((p) => p.code)
  const self = leastLoaded(fullyQualified)
  if (self !== null) {
    return { ...base, decision: 'ok', personaCode: self, stance: 'SELF_EXPERIENCE', reason: '자격을 다 채웠다' }
  }

  /**
   * ── ② 자격이 모자라다 — 자리를 낮춰도 이야기가 사는가 ──
   *
   * 🔴 **전환 가능성은 "고른 그 사람" 으로 판정한다.**
   *    앞판은 후보 한 명으로 전환 가능성을 보고, 그 뒤 **전체에서 다른 사람**을 골랐다.
   *    그래서 파트타임 경험이 필요한 글에 전업 Persona 가 뽑힐 수 있었다 —
   *    검사한 사람과 고른 사람이 달랐다.
   */
  const shiftable = personas.filter((p) => stanceKeepsEssence(input.essence, unmetFor(p, claims)))
  const code = leastLoaded(shiftable.map((p) => p.code))
  if (code === null) {
    // 🔴 누구로도 자리를 낮출 수 없다 — 가장 적게 모자란 사람의 부족분을 근거로 남긴다
    const closest = [...personas].sort((a, b) =>
      unmetFor(a, claims).length - unmetFor(b, claims).length || a.code.localeCompare(b.code))[0]!
    const unmet = unmetFor(closest, claims)
    return {
      ...base, decision: 'hold', personaCode: null, stance: null, unmetClaims: unmet,
      reason: '당사자 경험이 이 글의 알맹이다 — 자리를 바꾸면 이야기가 사라진다',
      coverageGap: {
        sourceArticleId: input.sourceArticleId,
        missing: unmet.map((c) => ({ fact: c.fact, requiredValue: c.requiredValue })),
        why: 'coreIsOwnExperience',
      },
    }
  }
  const pick = personas.find((p) => p.code === code)!
  const unmet = unmetFor(pick, claims)
  // 🔴 **고른 사람으로 다시 확인한다.** 검사한 사람과 고른 사람이 같아야 한다
  if (!stanceKeepsEssence(input.essence, unmet)) {
    return {
      ...base, decision: 'hold', personaCode: null, stance: null, unmetClaims: unmet,
      reason: '고른 사람으로 다시 보니 자리를 낮출 수 없다',
      coverageGap: {
        sourceArticleId: input.sourceArticleId,
        missing: unmet.map((c) => ({ fact: c.fact, requiredValue: c.requiredValue })),
        why: 'coreIsOwnExperience',
      },
    }
  }
  return {
    ...base, decision: 'ok', personaCode: code,
    stance: fallbackStance(input.essence),
    unmetClaims: unmet,
    reason: '1인칭 자격이 없어 자리를 낮췄다',
  }
}

/** 🔴 생성이 절대 1인칭으로 쓰면 안 되는 사실 — 프롬프트가 이 목록을 받는다 */
export function forbiddenClaimLines(plan: SpeakerPlan): string[] {
  if (plan.stance === 'SELF_EXPERIENCE' || plan.unmetClaims.length === 0) return []
  return plan.unmetClaims.map((c) => `${c.selfClaim} — 자기 일로 말하지 않습니다`)
}
