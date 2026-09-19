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
import type { ClaimFact, ClaimRequirement, SourceEssence } from './essence'

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

/** 🔴 자격을 판정할 때 보는 Persona 사실 — 카드에서 온 값만 */
export type SpeakerFacts = {
  code: string
  spouse?: boolean
  children?: number
  childAgeBands?: readonly string[]
  parentCare?: boolean
  menopause?: boolean
  work?: string | null
  region?: string | null
  ageBand?: string | null
}

export type SpeakerDecision = 'ok' | 'hold'

export type CoverageGap = {
  sourceArticleId: string
  /** 어떤 사실을 가진 사람이 없었나 */
  missing: { fact: ClaimFact; detail: string }[]
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

/** 한 사실을 이 사람이 가지고 있는가 — 🔴 모르면 **없는 것으로 본다** */
export function hasFact(p: SpeakerFacts, c: ClaimRequirement): boolean {
  switch (c.fact) {
    case 'spouse': return p.spouse === true
    case 'children': return (p.children ?? 0) > 0
    case 'childAgeBand': {
      const bands = p.childAgeBands
      if (bands === undefined || bands.length === 0) return false
      // detail 에 나이대 이름이 있으면 그것과 맞아야 한다
      const wanted = bands.filter((b) => c.detail.includes(b))
      return wanted.length > 0
    }
    case 'parentCare': return p.parentCare === true
    case 'menopause': return p.menopause === true
    case 'work': {
      const w = (p.work ?? '').trim()
      if (w === '') return false
      // 🔴 detail 이 말하는 일과 카드의 일이 **같은 말**일 때만 인정한다
      return c.detail.includes(w) || w.includes(c.detail.trim())
    }
    case 'region': {
      const r = (p.region ?? '').trim()
      return r !== '' && (c.detail.includes(r) || r.includes(c.detail.trim()))
    }
    case 'age': {
      const a = (p.ageBand ?? '').trim()
      return a !== '' && c.detail.includes(a)
    }
    default: return false
  }
}

export function unmetFor(p: SpeakerFacts, claims: readonly ClaimRequirement[]): ClaimRequirement[] {
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
  personas: readonly SpeakerFacts[]
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
        missing: unmet.map((c) => ({ fact: c.fact, detail: c.detail })),
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
        missing: unmet.map((c) => ({ fact: c.fact, detail: c.detail })),
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
  return plan.unmetClaims.map((c) => `${c.detail} — 자기 일로 말하지 않습니다`)
}
