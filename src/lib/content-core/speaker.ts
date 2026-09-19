/**
 * 화자 계획 — 🔴 **한 호출이 원문과 실제 카드를 함께 보고 고르고, 코드가 근거를 검증한다**
 *
 * 🔴 **왜 합쳤나** (2026-09-19, 대안 D).
 *    앞판은 `원문 → claimRequirements → 코드 매칭` 이었다. 매칭하는 쪽이 원문을 본 적이
 *    없어서, 같은 알바 원문에 3차는 `work=파트타임` 을 4차는 `[]` 를 냈고,
 *    **빈 목록이 곧 "모두 자격 있음"** 이 되어 전업 Persona 가 1인칭으로 알바를 했다
 *    (`[].filter()` 가 모든 사람에게 빈 배열을 돌려준다).
 *
 * 🔴 **그렇다고 "모델이 직접 봤으니 맞을 것" 으로 믿지 않는다.**
 *    `SELF_EXPERIENCE` 는 코드가 확인할 수 있는 **허가 근거**가 있어야 한다:
 *      ① 고른 personaCode 가 실제 후보에 있는가
 *      ② 근거 문장이 지목한 원문 span 에 실제로 있는가
 *      ③ 모델이 적은 카드 값이 **그 카드의 진짜 값**과 같은가
 *      ④ requiredValue 를 그 카드가 실제로 충족하는가
 *      ⑤ 모르는 fact·값은 통과시키지 않는다
 *
 * 🔴 **검증에 실패하면 다른 Persona 를 조용히 고르지 않는다.**
 *    관찰·생각·물음으로 소재가 살면 **같은 사람으로 자리를 낮추고**,
 *    당사자 경험이 알맹이면 HOLD 한다.
 *
 * 🔴 `근거 없음 = SELF_EXPERIENCE 허가` 경로는 어디에도 없다.
 */
import type { PoolCard } from '../persona-pool-card'
import type { EvidenceSpan, SourceEvidencePacket } from './evidence'
import {
  CLAIM_FACTS, CLOSING_INTENTS, CONTENT_ROLES, EVIDENCE_REFS, PROTECTED_FACT_KINDS,
  foundInSpan, isPersonalInfo, judgeProtectedFact, normalizeForProvenance,
  type ClaimFact, type ClosingIntent, type ContentRole, type DropReason,
  type EvidenceRef, type ProtectedFact, type ProtectedFactKind,
} from './source-facts'

export const SPEAKER_PLAN_VERSION = 'speaker-plan-v2'

/** 화자가 서는 자리 */
export const STANCES = ['SELF_EXPERIENCE', 'OBSERVATION', 'REFLECTION', 'QUESTION'] as const
export type Stance = (typeof STANCES)[number]

export const STANCE_LABEL: Readonly<Record<Stance, string>> = {
  SELF_EXPERIENCE: '내가 겪은 일로 쓴다',
  OBSERVATION: '곁에서 본 일로 쓴다 — 내 일로 말하지 않는다',
  REFLECTION: '읽고 든 생각으로 쓴다 — 겪었다고 말하지 않는다',
  QUESTION: '궁금해서 묻는 글로 쓴다 — 겪었다고 말하지 않는다',
}

/**
 * 🔴 **정본 카드에서 가져온다 — v2 전용으로 다시 정의하지 않는다.**
 *    `PoolCard` 가 정본이고 여기서는 필요한 칸만 고른다.
 */
export type PersonaLifeContract = Pick<PoolCard,
  | 'code' | 'ageBand' | 'region' | 'maritalStatus' | 'spouseRelationship'
  | 'childrenCount' | 'childrenAgeBands' | 'workStatus' | 'economicStatus'
  | 'menopauseStatus' | 'parentCare' | 'personality' | 'noGoTopics' | 'noGoExpressions'>

/**
 * 🔴 **1인칭 허가의 근거 한 줄.** 자격 사실을 표현하는 구조는 저장소에 **이것 하나뿐이다.**
 */
export type SpeakerWarrant = {
  fact: ClaimFact
  /** 🔴 카드 값과 견줄 정규 값 — 예: `있음` · `없음` · `파트타임` · `수도권` */
  requiredValue: string
  /** 🔴 원문 어디에 그 말이 있는가 */
  evidenceRef: EvidenceRef
  evidenceText: string
  /** 🔴 모델이 읽었다고 주장하는 **카드의 실제 값** — 코드가 카드와 대조한다 */
  cardValue: string
}

/**
 * 🔴 **1인칭을 허가받은 방식** — 빈 배열과 구분되는 **명시적 결정**이어야 한다.
 *    `noLifeFactNeeded` 는 "확인 못 했다" 가 아니라
 *    "이 글은 특정 생활사 자격이 필요 없는 보편적 이야기다" 라는 **선언**이다.
 */
export const SELF_BASES = ['lifeFacts', 'noLifeFactNeeded'] as const
export type SelfBasis = (typeof SELF_BASES)[number]

export const WARRANT_REJECTIONS = [
  'unknownPersona', 'unknownFact', 'unknownStance', 'unknownBasis',
  'evidenceNotInSource', 'cardValueMismatch', 'requiredValueUnmet',
  'emptyWarrants', 'warrantsWithoutNeed', 'noUniversalReason',
] as const
export type WarrantRejection = (typeof WARRANT_REJECTIONS)[number]

export const WARRANT_REJECTION_LABEL: Readonly<Record<WarrantRejection, string>> = {
  unknownPersona: '후보에 없는 사람을 골랐다',
  unknownFact: '우리 생활사 축이 아니다',
  unknownStance: '우리 자리 이름이 아니다',
  unknownBasis: '1인칭 허가 방식을 밝히지 않았다',
  evidenceNotInSource: '근거 문장이 원문에 없다',
  cardValueMismatch: '적어 낸 카드 값이 그 카드의 실제 값과 다르다',
  requiredValueUnmet: '그 사람의 카드가 이 값을 충족하지 않는다',
  emptyWarrants: '생활사 자격이 필요하다면서 근거를 하나도 대지 않았다',
  warrantsWithoutNeed: '자격이 필요 없다면서 자격 근거를 댔다',
  noUniversalReason: '왜 자격이 필요 없는지 말하지 않았다',
}

export type SpeakerPlan = {
  decision: 'ok' | 'hold'
  personaCode: string | null
  stance: Stance | null
  /** 🔴 `SELF_EXPERIENCE` 일 때만 값이 있다 */
  selfBasis: SelfBasis | null
  /** 🔴 **검증을 통과한 것만** 남는다 */
  warrants: SpeakerWarrant[]
  /** 자격이 필요 없다고 본 이유 — `noLifeFactNeeded` 일 때만 */
  universalReason: string
  protectedFacts: ProtectedFact[]
  closingIntent: ClosingIntent | null
  contentRoles: ContentRole[]
  reason: string
  /** 🔴 1인칭이 거절된 이유 — 자리를 낮추거나 HOLD 한 근거 */
  rejection: WarrantRejection | null
  planVersion: string
}

export type SpeakerPlanParse = {
  plan: SpeakerPlan
  dropped: { text: string; why: DropReason }[]
  schemaProblems: string[]
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const same = (a: string, b: string): boolean =>
  normalizeForProvenance(a) !== '' && normalizeForProvenance(a) === normalizeForProvenance(b)

/**
 * 🔴 **카드가 그 축에 대해 실제로 가진 글자.** 모델이 적어 낸 `cardValue` 를 이것과 견준다 —
 *    카드를 읽지 않고 지어낸 값을 잡는다.
 */
export function cardValueText(p: PersonaLifeContract, fact: ClaimFact): string {
  switch (fact) {
    case 'spouse': return p.maritalStatus
    case 'children': return String(p.childrenCount)
    case 'childAgeBand': return p.childrenAgeBands.join('·')
    case 'parentCare': return p.parentCare
    case 'menopause': return p.menopauseStatus
    case 'work': return p.workStatus
    case 'region': return p.region
    case 'age': return p.ageBand
    default: return ''
  }
}

/**
 * 한 사실을 이 사람이 **정말로** 가지고 있는가 — 🔴 정규 값끼리만 견준다.
 *    자유 문장으로 `includes` 를 하면 빈 값이 모든 사람을 충족시킨다.
 */
export function hasFact(p: PersonaLifeContract, fact: ClaimFact, requiredValue: string): boolean {
  const want = requiredValue.trim()
  if (want === '') return false
  const eq = (a: string | null | undefined): boolean =>
    (a ?? '').trim() !== '' && (a ?? '').trim() === want
  switch (fact) {
    case 'spouse': return want === '있음' ? p.maritalStatus.trim() === '기혼' : false
    /** 🔴 `없음` 도 견줄 수 있는 축이다 — 카드에 `childrenCount = 0` 이라는 판정값이 있다 */
    case 'children':
      return want === '있음' ? p.childrenCount > 0 : want === '없음' ? p.childrenCount === 0 : false
    case 'childAgeBand': return p.childrenAgeBands.some((b) => b.trim() === want)
    case 'parentCare': return want === '있음' ? p.parentCare.trim() !== '없음' : false
    /** 🔴 `전` 은 아직 겪지 않았다는 뜻이다 — 경험 주장의 근거가 될 수 없다 */
    case 'menopause': return want === '있음' ? p.menopauseStatus.trim() !== '전' : false
    case 'work': return eq(p.workStatus)
    case 'region': return eq(p.region)
    case 'age': return eq(p.ageBand)
    default: return false
  }
}

/**
 * 🔴 **1인칭을 허가해도 되는가.** 하나라도 어긋나면 허가하지 않는다.
 *    실패해도 **다른 사람을 고르지 않는다** — 부르는 쪽이 자리를 낮추거나 HOLD 한다.
 */
export function verifySelfWarrants(input: {
  persona: PersonaLifeContract | undefined
  selfBasis: SelfBasis | null
  warrants: readonly SpeakerWarrant[]
  universalReason: string
  spans: readonly EvidenceSpan[]
}): { ok: true } | { ok: false; why: WarrantRejection; detail: string } {
  const p = input.persona
  if (p === undefined) return { ok: false, why: 'unknownPersona', detail: '' }
  if (input.selfBasis === null) return { ok: false, why: 'unknownBasis', detail: '' }
  if (input.selfBasis === 'noLifeFactNeeded') {
    if (input.warrants.length > 0) {
      return { ok: false, why: 'warrantsWithoutNeed', detail: input.warrants.map((w) => w.fact).join(' · ') }
    }
    if (input.universalReason.trim() === '') return { ok: false, why: 'noUniversalReason', detail: '' }
    return { ok: true }
  }
  // ── lifeFacts ──
  if (input.warrants.length === 0) return { ok: false, why: 'emptyWarrants', detail: '' }
  for (const w of input.warrants) {
    if (!(CLAIM_FACTS as readonly string[]).includes(w.fact)) {
      return { ok: false, why: 'unknownFact', detail: w.fact }
    }
    if (!(EVIDENCE_REFS as readonly string[]).includes(w.evidenceRef)
      || w.evidenceText.trim() === ''
      || !foundInSpan(w.evidenceText, w.evidenceRef, input.spans)) {
      return { ok: false, why: 'evidenceNotInSource', detail: `${w.fact}: ${w.evidenceText}` }
    }
    if (!same(w.cardValue, cardValueText(p, w.fact))) {
      return {
        ok: false, why: 'cardValueMismatch',
        detail: `${w.fact}: 적어 낸 "${w.cardValue}" · 카드 "${cardValueText(p, w.fact)}"`,
      }
    }
    if (!hasFact(p, w.fact, w.requiredValue)) {
      return { ok: false, why: 'requiredValueUnmet', detail: `${w.fact}=${w.requiredValue}` }
    }
  }
  return { ok: true }
}

/**
 * 🔴 **자리를 낮춰도 이야기가 살아남는가.**
 *    이 글의 역할이 경험 공감 하나뿐이면 관찰로 바꾸는 순간 알맹이가 없어진다.
 */
export function stanceKeepsStory(roles: readonly ContentRole[]): boolean {
  return !(roles.length === 1 && roles[0] === 'experienceResonance')
}

/** 자격을 못 채웠을 때 어느 자리로 내려갈까 — 🔴 원문이 닫는 방식을 따른다 */
export function fallbackStance(
  closingIntent: ClosingIntent | null, roles: readonly ContentRole[],
): Stance {
  if (closingIntent === 'ask') return 'QUESTION'
  if (roles.includes('experienceResonance')) return 'OBSERVATION'
  return 'REFLECTION'
}

const HOLD = (reason: string, rejection: WarrantRejection | null = null): SpeakerPlan => ({
  decision: 'hold', personaCode: null, stance: null, selfBasis: null, warrants: [],
  universalReason: '', protectedFacts: [], closingIntent: null, contentRoles: [],
  reason, rejection, planVersion: SPEAKER_PLAN_VERSION,
})

/**
 * 계획 응답을 읽고 **검증한다.**
 *
 * 🔴 load 는 모델에게 **입력으로만** 준다. 코드는 자격을 검증할 뿐,
 *    검증에 실패했다고 load 로 다른 사람을 다시 고르지 않는다.
 */
export function parseSpeakerPlan(
  raw: string, packet: SourceEvidencePacket, personas: readonly PersonaLifeContract[],
): SpeakerPlanParse {
  let j: Record<string, unknown>
  try {
    const t = raw.trim()
    j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
  } catch {
    return { plan: HOLD('계획을 읽지 못했다'), dropped: [], schemaProblems: ['JSON 이 아니다'] }
  }
  const problems: string[] = []
  const dropped: { text: string; why: DropReason }[] = []
  const spans = packet.spans

  // ── protectedFacts — 증명 가능한 것만 ──
  const facts: ProtectedFact[] = []
  for (const x of arr(j.protectedFacts)) {
    const o = x as Record<string, unknown>
    const text = S(o.text)
    if (text === '') { dropped.push({ text: '', why: 'empty' }); continue }
    const kind = S(o.kind)
    if (!(PROTECTED_FACT_KINDS as readonly string[]).includes(kind)) {
      dropped.push({ text, why: 'unknownKind' }); continue
    }
    if (isPersonalInfo(text)) { dropped.push({ text, why: 'personalInfo' }); continue }
    const ref = S(o.evidenceRef)
    if (!(EVIDENCE_REFS as readonly string[]).includes(ref)) {
      dropped.push({ text, why: 'unknownRef' }); continue
    }
    if (!foundInSpan(text, ref as EvidenceRef, spans)) {
      dropped.push({ text, why: 'notInEvidence' }); continue
    }
    const verdict = judgeProtectedFact(kind as ProtectedFactKind, text)
    if (!verdict.ok) { dropped.push({ text, why: verdict.why }); continue }
    facts.push({ kind: kind as ProtectedFactKind, text, evidenceRef: ref as EvidenceRef })
  }

  const roles: ContentRole[] = []
  for (const r of arr(j.contentRoles)) {
    const v = S(r)
    if ((CONTENT_ROLES as readonly string[]).includes(v)) roles.push(v as ContentRole)
    else problems.push(`모르는 contentRole "${v}"`)
  }
  const closing = S(j.closingIntent)
  const closingIntent = (CLOSING_INTENTS as readonly string[]).includes(closing)
    ? (closing as ClosingIntent) : null
  const base = {
    protectedFacts: facts, closingIntent, contentRoles: [...new Set(roles)],
    planVersion: SPEAKER_PLAN_VERSION,
  }
  const withBase = (p: SpeakerPlan): SpeakerPlan => ({ ...p, ...base })

  if (personas.length === 0) {
    return { plan: withBase(HOLD('쓸 수 있는 Persona 가 없다')), dropped, schemaProblems: problems }
  }
  if (S(j.decision) === 'hold') {
    return {
      plan: withBase(HOLD(S(j.holdReason) === '' ? '계획이 만들지 말자고 했다' : S(j.holdReason))),
      dropped, schemaProblems: problems,
    }
  }

  const personaCode = S(j.personaCode)
  const persona = personas.find((p) => p.code === personaCode)
  const stanceRaw = S(j.stance)
  const stance = (STANCES as readonly string[]).includes(stanceRaw) ? (stanceRaw as Stance) : null
  const basisRaw = S(j.selfBasis)
  const selfBasis = (SELF_BASES as readonly string[]).includes(basisRaw) ? (basisRaw as SelfBasis) : null
  const universalReason = S(j.universalReason)
  const warrants: SpeakerWarrant[] = arr(j.speakerWarrants).map((x) => {
    const o = x as Record<string, unknown>
    return {
      fact: S(o.fact) as ClaimFact, requiredValue: S(o.requiredValue),
      evidenceRef: S(o.evidenceRef) as EvidenceRef, evidenceText: S(o.evidenceText),
      cardValue: S(o.cardValue),
    }
  })

  if (persona === undefined) {
    return {
      plan: withBase(HOLD(
        `${WARRANT_REJECTION_LABEL.unknownPersona} — "${personaCode}"`, 'unknownPersona')),
      dropped, schemaProblems: problems,
    }
  }
  if (stance === null) {
    return {
      plan: withBase(HOLD(`${WARRANT_REJECTION_LABEL.unknownStance} — "${stanceRaw}"`, 'unknownStance')),
      dropped, schemaProblems: problems,
    }
  }

  // ── 자리를 낮춰서 고른 경우 — 1인칭이 아니므로 허가 근거가 필요 없다 ──
  if (stance !== 'SELF_EXPERIENCE') {
    return {
      plan: withBase({
        decision: 'ok', personaCode, stance, selfBasis: null, warrants: [],
        universalReason: '', reason: '1인칭이 아닌 자리로 썼다', rejection: null,
        ...base,
      }),
      dropped, schemaProblems: problems,
    }
  }

  // ── 🔴 1인칭 — 코드가 근거를 검증한다 ──
  const v = verifySelfWarrants({ persona, selfBasis, warrants, universalReason, spans })
  if (v.ok) {
    return {
      plan: withBase({
        decision: 'ok', personaCode, stance: 'SELF_EXPERIENCE', selfBasis,
        warrants: selfBasis === 'lifeFacts' ? warrants : [],
        universalReason: selfBasis === 'noLifeFactNeeded' ? universalReason : '',
        reason: selfBasis === 'lifeFacts' ? '원문 근거와 카드 값으로 1인칭을 허가했다'
          : '특정 생활사 자격이 필요 없는 글이다', rejection: null,
        ...base,
      }),
      dropped, schemaProblems: problems,
    }
  }
  /**
   * 🔴 **허가하지 않는다. 다른 사람을 고르지도 않는다.**
   *    관찰·생각·물음으로 소재가 살면 **같은 사람으로** 자리를 낮추고,
   *    당사자 경험이 알맹이면 HOLD 한다.
   */
  const why = `${WARRANT_REJECTION_LABEL[v.why]}${v.detail === '' ? '' : ` (${v.detail})`}`
  if (!stanceKeepsStory(base.contentRoles)) {
    return {
      plan: withBase(HOLD(`1인칭 허가 실패 — ${why}. 당사자 경험이 알맹이라 자리를 낮출 수 없다`, v.why)),
      dropped, schemaProblems: problems,
    }
  }
  return {
    plan: withBase({
      decision: 'ok', personaCode, stance: fallbackStance(closingIntent, base.contentRoles),
      selfBasis: null, warrants: [], universalReason: '',
      reason: `1인칭 허가 실패 — ${why}. 같은 사람으로 자리를 낮췄다`, rejection: v.why,
      ...base,
    }),
    dropped, schemaProblems: problems,
  }
}

/** 🔴 생성해도 되는가 — 확인 못 한 글은 만들지 않는다 */
export function canGenerate(
  packet: SourceEvidencePacket, plan: SpeakerPlan,
): { ok: boolean; why: string } {
  if (packet.contextSufficiency === 'insufficient') {
    return { ok: false, why: `무슨 이야기인지 확인하지 못했다 (${packet.insufficientReasons.join('·')})` }
  }
  if (plan.decision === 'hold' || plan.personaCode === null || plan.stance === null) {
    return { ok: false, why: plan.reason }
  }
  return { ok: true, why: '' }
}
