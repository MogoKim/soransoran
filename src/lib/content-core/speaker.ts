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
 *      ③ requiredValue 를 **고른 사람의 정본 카드**가 실제로 충족하는가
 *      ④ 모르는 fact·값은 통과시키지 않는다
 *
 *    🔴 **카드 값은 코드가 정본에서 읽는다** (2026-09-20). 모델에게 옮겨 적게 하지
 *       않는다 — 그 계약은 값이 맞아도 표기가 다르면 생성 전에 멈췄다.
 *
 * 🔴 **검증에 실패하면 HOLD 한다** (2026-09-19 실측 보정).
 *
 *    앞판은 실패를 `QUESTION` 으로 **자동 강등**해서 그대로 생성했다. 그런데
 *    그렇게 만든 A·C 두 편이 초안에서 **다시 자기 경험을 말했다**
 *    ("우리 남편은…" · "3시간씩 일하는 알바를 하고 있는데").
 *    "자격 검증 실패" 를 "다른 자리로는 만들어도 됨" 으로 바꾸는 것은 fail-closed 가 아니다.
 *
 *    🔴 비자기 경험 글이 맞다고 보면 **모델이 처음부터 그 자리를 골라야 한다.**
 *      · SELF 선택 + 검증 성공 → 생성
 *      · SELF 선택 + 검증 실패 → **HOLD**
 *      · 처음부터 QUESTION/OBSERVATION/REFLECTION 선택 → 그 자리로 생성
 *
 * 🔴 `근거 없음 = SELF_EXPERIENCE 허가` 경로는 어디에도 없다.
 * 🔴 검증 실패 후 다른 Persona 를 조용히 고르지도 않는다.
 */
import type { PoolCard } from '../persona-pool-card'
import type { EvidenceSpan, SourceEvidencePacket } from './evidence'
import {
  CLAIM_FACTS, CLOSING_INTENTS, CONTENT_ROLES, EVIDENCE_REFS, PROTECTED_FACT_KINDS,
  foundInSpan, isPersonalInfo, judgeProtectedFact,
  type ClaimFact, type ClosingIntent, type ContentRole, type DropReason,
  type EvidenceRef, type ProtectedFact, type ProtectedFactKind,
} from './source-facts'
import { readSelfAgeClaim, OTHER_MARKERS } from '../persona-self-age'
import { AXIS_LABEL, type SpeakerRelativeAxis, type FactRole } from './speaker-relative-facts'

/**
 * 🔴 계획이 싣는 한 줄 — **무엇을 무엇으로 바꾸는가**.
 *    `personaText` 는 생성 직전에 채운다(그때 Persona 가 정해진다).
 */
export type SpeakerRelativeEntry = {
  axis: SpeakerRelativeAxis
  sourceText: string
  /** 원문에서 누구의 사실이었나 */
  sourceRole: 'self' | 'thirdParty' | 'invariant'
  evidenceRef: EvidenceRef
  materiality: FactRole
}

/**
 * 🔴 **v6 (2026-09-23)** — 파서 의미가 바뀌었다. `materiality` 미기재는 기본값이 아니라
 *    모양 오류이고, load-bearing 판정 자리가 `resolveLoadBearing` 으로 옮겨졌다.
 */
export const SPEAKER_PLAN_VERSION = 'speaker-plan-v6'

/**
 * 🔴 **아는 값만 통과시킨다** (2026-09-23). 카드에 적힐 수 있는 값을 **열거**한다 —
 *    "그 값이 아니면 전부 참" 으로 두면 빈 값·오타가 근거로 선다(fail-open).
 */
const MARITAL_SINGLE: readonly string[] = ['미혼', '비혼', '이혼', '사별', '별거']
const PARENT_CARE_YES: readonly string[] = ['간헐', '상시', '있음', '동거 간병']
const MENOPAUSE_YES: readonly string[] = ['중', '후', '진행', '완료']

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
 * 🔴 **이 원문에서 후보를 보여 줄 순서** (2026-09-21)
 *
 *    화자 계획 요청은 후보 목록을 **순서대로** 싣고, 모델은 앞쪽을 고르는 경향이 있다.
 *    그래서 순서는 **실제 provider 입력의 일부**다.
 *
 * 🔴 **왜 원천마다 다른가.** 순서를 코드순으로 고정하면 늘 같은 사람이 먼저 와서
 *    한 Persona 에 쏠린다. 앞판은 그 쏠림을 `맡은 수(load)` 로 막았는데, 그것은
 *    **그 회차 안에서만 존재하는 값**이라 계약에 담을 수도, 다음 회차가 다시 만들 수도
 *    없었다 — 같은 계약인데 실제로 보낸 것이 달랐다(2026-09-21 실측).
 *
 * 🔴 그래서 **원문 지문과 Persona 코드로** 순서를 정한다. 같은 원문이면 언제나 같은
 *    순서이고, 원문이 다르면 순서가 흩어진다. 회차 상태가 들어가지 않는다.
 */
export function personaOrderKey(sourceInputHash: string, code: string): string {
  const src = `${sourceInputHash}\u0001${code}`
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < src.length; i += 1) {
    const c = src.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b + c, 0x85ebca6b) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

/**
 * 🔴 **후보를 그 순서로 세운다.** 들어온 배열의 순서는 쓰지 않는다 —
 *    읽은 순서가 달라도 **실제로 보내는 것**이 같아야 한다.
 *    🔴 지문이 같은 두 사람이 있으면 코드로 가른다(안정).
 */
export function orderPersonasForSource<T extends { code: string }>(
  personas: readonly T[], sourceInputHash: string,
): T[] {
  return [...personas].sort((x, y) => {
    const kx = personaOrderKey(sourceInputHash, x.code)
    const ky = personaOrderKey(sourceInputHash, y.code)
    return kx < ky ? -1 : kx > ky ? 1 : x.code.localeCompare(y.code)
  })
}

/**
 * 🔴 **생성 계약에 들어가는 생활사 칸의 정본 순서** (2026-09-21).
 *
 *    이 값들은 화자 계획·생성·검수 프롬프트에 **그대로 실린다**. 하나라도 바뀌면
 *    같은 원문이라도 다른 글이 나온다. 그래서 생성 계약의 지문에 전부 들어가야 한다.
 *    🔴 앞판은 `code`·말투 토큰·말투 묶음 지문만 담아서, 나이대·형편·금지 소재를
 *    바꿔도 지난 결과가 "지금 계약의 결론" 으로 남았다(2026-09-21 실측 13/13).
 */
export const LIFE_CONTRACT_FIELDS = [
  'code', 'ageBand', 'region', 'maritalStatus', 'spouseRelationship',
  'childrenCount', 'childrenAgeBands', 'workStatus', 'economicStatus',
  'menopauseStatus', 'parentCare', 'personality', 'noGoTopics', 'noGoExpressions',
] as const satisfies readonly (keyof PersonaLifeContract)[]

/**
 * 🔴 **생활사 계약 한 줄.** 칸 순서는 위 목록으로 고정한다 — 객체 키 순서에 기대지 않는다.
 *
 * 🔴 **배열은 정렬하지 않는다.** 적힌 순서가 프롬프트에 그대로 실리기 때문이다.
 *    정렬해 버리면 순서만 바뀐 카드가 "같은 계약" 이 되어, 다른 프롬프트로 만든
 *    옛 결과를 그대로 쓰게 된다. 🔴 **댓글 원문은 담지 않는다** — 말투는 묶음 지문이 맡는다.
 */
export function lifeContractIdentity(p: PersonaLifeContract): string {
  return LIFE_CONTRACT_FIELDS.map((k) => {
    const v = p[k]
    const text = v === null || v === undefined ? '∅'
      : Array.isArray(v) ? v.map((x) => String(x)).join('\u0002')
        : String(v)
    return `${k}=${text}`
  }).join('\u0001')
}

/**
 * 🔴 **모델이 적어 내는 칸.** 카드 값은 **여기 없다** (2026-09-20 보정).
 *
 *    앞판은 고른 사람의 카드 값을 모델이 `cardValue` 로 **다시 적게** 하고,
 *    코드가 정본과 완전 일치하는지 견줬다. 정본을 이미 코드가 들고 있는데
 *    필사를 요구한 것이라, 값이 맞아도 표기가 다르면 생성 전에 멈췄다 —
 *    실측 449988 에서 `children` 이 `"1 (초등)"` 으로 와서 카드 `"1"` 과 어긋났다.
 *    사실은 맞았고 형식만 달랐다.
 *
 * 🔴 그래서 **책임을 나눈다.** 모델은 "원문이 어떤 자격을 요구하는가" 를 판단하고,
 *    그 사람이 그 자격을 **실제로 가졌는가** 는 코드가 정본 카드에서 읽어 판정한다.
 */
export type ClaimedWarrant = {
  fact: ClaimFact
  /** 🔴 카드 값과 견줄 정규 값 — 예: `있음` · `없음` · `파트타임` · `수도권` */
  requiredValue: string
  /** 🔴 원문 어디에 그 말이 있는가 */
  evidenceRef: EvidenceRef
  evidenceText: string
}

/**
 * 🔴 **검증을 통과한 근거 한 줄.** 자격 사실을 표현하는 구조는 저장소에 **이것 하나뿐이다.**
 *
 * 🔴 `verifiedCardValue` 는 **코드가 정본 카드에서 읽어 찍는다.** provider 가 준 값이
 *    아니다. `verifySelfWarrants` 를 지나지 않고는 이 값을 만들 수 없다 —
 *    타입이 그것을 강제한다.
 */
export type SpeakerWarrant = ClaimedWarrant & { verifiedCardValue: string }

/**
 * 🔴 **1인칭을 허가받은 방식** — 빈 배열과 구분되는 **명시적 결정**이어야 한다.
 *    `noLifeFactNeeded` 는 "확인 못 했다" 가 아니라
 *    "이 글은 특정 생활사 자격이 필요 없는 보편적 이야기다" 라는 **선언**이다.
 */
export const SELF_BASES = ['lifeFacts', 'noLifeFactNeeded'] as const
export type SelfBasis = (typeof SELF_BASES)[number]

/**
 * 🔴 `cardValueMismatch` 를 **뺐다** (2026-09-20). 카드 값을 모델이 적어 내지 않으므로
 *    "적어 낸 값이 카드와 다르다" 는 상태가 존재할 수 없다. 일어날 수 없는 사유를
 *    목록에 남겨 두면 사람이 그 코드를 찾아 헤맨다.
 */
export const WARRANT_REJECTIONS = [
  'unknownPersona', 'unknownFact', 'unknownStance', 'unknownBasis',
  'evidenceNotInSource', 'requiredValueUnmet',
  'emptyWarrants', 'warrantsWithoutNeed', 'noUniversalReason',
] as const
export type WarrantRejection = (typeof WARRANT_REJECTIONS)[number]

export const WARRANT_REJECTION_LABEL: Readonly<Record<WarrantRejection, string>> = {
  unknownPersona: '후보에 없는 사람을 골랐다',
  unknownFact: '우리 생활사 축이 아니다',
  unknownStance: '우리 자리 이름이 아니다',
  unknownBasis: '1인칭 허가 방식을 밝히지 않았다',
  evidenceNotInSource: '근거 문장이 원문에 없다',
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
  /**
   * 🔴 **원문 화자의 사실과 우리 쪽 대체값** (2026-09-23).
   *    `protectedFacts` 에서 빼기만 하면 **내용이 사라진다.** 무엇을 무엇으로 바꿀지
   *    여기 담아 **초안 프롬프트가 실제로 소비**한다.
   */
  speakerRelative: SpeakerRelativeEntry[]
  closingIntent: ClosingIntent | null
  contentRoles: ContentRole[]
  reason: string
  /** 🔴 1인칭이 거절된 이유 — 자리를 낮추거나 HOLD 한 근거 */
  rejection: WarrantRejection | null
  planVersion: string
}

/**
 * 🔴 **다시 물어도 같은 거절은 이것 하나다** (2026-09-21).
 *
 *    "그 사람의 카드가 이 값을 충족하지 않는다" 는 원문과 카드가 정하는 사실이라
 *    다시 물어도 같다 — 결론이다. 나머지 거절은 **모델이 이번에 잘못 답한 것**이다:
 *    후보에 없는 코드 · 우리 자리 이름이 아님 · 원문에 없는 근거 문장 · 빈 근거.
 *    그것을 결론으로 적으면 정상 원천이 영구 제외된다.
 */
export const QUALIFICATION_REJECTIONS = [
  'requiredValueUnmet',
] as const satisfies readonly WarrantRejection[]

/** 🔴 계획 응답이 JSON 조차 아니었다는 표시 — 문자열을 두 곳에 적지 않는다 */
export const UNPARSABLE_PLAN = 'JSON 이 아니다'
/**
 * 🔴 **계획이 화자 상대 사실의 materiality 를 답하지 않았다** (2026-09-23).
 *    기본값으로 통과시키지 않는다 — 모양 오류로 다시 묻는다.
 */
export const MATERIALITY_MISSING = '🔴 materiality 누락'

export type SpeakerPlanParse = {
  plan: SpeakerPlan
  dropped: { text: string; why: DropReason }[]
  schemaProblems: string[]
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * 🔴 **카드가 그 축에 대해 실제로 가진 글자.** 사람 검토용으로 근거 줄에 함께 적는다 —
 *    검토자가 Pool 문서를 열지 않고도 "이 사람이 정말 그런가" 를 볼 수 있게.
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
    /**
     * 🔴 **양방향으로 받는다** (2026-09-23). 앞판은 `'있음'` 만 받아
     *    "원문이 비혼·이혼·사별을 요구한다" 를 표현할 방법이 없었다.
     *    우리 풀에는 그런 Persona 가 **실제로 있는데도** 자격을 세울 수 없어
     *    `requiredValueUnmet` → `speakerUnqualified` → **비재시도 결론**으로 갔다.
     */
    case 'spouse': {
      // 🔴 **빈 값·모르는 값은 통과시키지 않는다** (2026-09-23 fail-open 보정).
      //    앞판은 `!married` 였다 — 카드가 비어 있어도 "없음" 근거가 섰다.
      const v = p.maritalStatus.trim()
      if (v === '') return false
      if (want === '있음') return v === '기혼'
      if (want === '없음') return MARITAL_SINGLE.includes(v)
      return false
    }
    /** 🔴 `없음` 도 견줄 수 있는 축이다 — 카드에 `childrenCount = 0` 이라는 판정값이 있다 */
    case 'children':
      return want === '있음' ? p.childrenCount > 0 : want === '없음' ? p.childrenCount === 0 : false
    case 'childAgeBand': return p.childrenAgeBands.some((b) => b.trim() === want)
    case 'parentCare': {
      const v = p.parentCare.trim()
      if (v === '') return false
      if (want === '있음') return PARENT_CARE_YES.includes(v)
      if (want === '없음') return v === '없음'
      return false
    }
    /** 🔴 `전` 은 아직 겪지 않았다는 뜻이다 — 경험 주장의 근거가 될 수 없다 */
    case 'menopause': {
      const v = p.menopauseStatus.trim()
      if (v === '') return false
      if (want === '있음') return MENOPAUSE_YES.includes(v)
      if (want === '없음') return v === '전'
      return false
    }
    // 🔴 빈 값은 통과시키지 않는다 — `eq` 는 빈 값끼리도 같다고 본다
    case 'work': return p.workStatus.trim() !== '' && eq(p.workStatus)
    case 'region': return p.region.trim() !== '' && eq(p.region)
    case 'age': return p.ageBand.trim() !== '' && eq(p.ageBand)
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
  warrants: readonly ClaimedWarrant[]
  universalReason: string
  spans: readonly EvidenceSpan[]
}): { ok: true; warrants: SpeakerWarrant[] } | { ok: false; why: WarrantRejection; detail: string } {
  const p = input.persona
  if (p === undefined) return { ok: false, why: 'unknownPersona', detail: '' }
  if (input.selfBasis === null) return { ok: false, why: 'unknownBasis', detail: '' }
  if (input.selfBasis === 'noLifeFactNeeded') {
    if (input.warrants.length > 0) {
      return { ok: false, why: 'warrantsWithoutNeed', detail: input.warrants.map((w) => w.fact).join(' · ') }
    }
    if (input.universalReason.trim() === '') return { ok: false, why: 'noUniversalReason', detail: '' }
    return { ok: true, warrants: [] }
  }
  // ── lifeFacts ──
  if (input.warrants.length === 0) return { ok: false, why: 'emptyWarrants', detail: '' }
  const verified: SpeakerWarrant[] = []
  for (const w of input.warrants) {
    if (!(CLAIM_FACTS as readonly string[]).includes(w.fact)) {
      return { ok: false, why: 'unknownFact', detail: w.fact }
    }
    if (!(EVIDENCE_REFS as readonly string[]).includes(w.evidenceRef)
      || w.evidenceText.trim() === ''
      || !foundInSpan(w.evidenceText, w.evidenceRef, input.spans)) {
      return { ok: false, why: 'evidenceNotInSource', detail: `${w.fact}: ${w.evidenceText}` }
    }
    /**
     * 🔴 **정본 카드가 이 값을 충족하는가.** 이것이 자격 판정의 전부다 —
     *    모델이 카드를 옮겨 적었는지는 더 이상 묻지 않는다.
     */
    if (!hasFact(p, w.fact, w.requiredValue)) {
      return { ok: false, why: 'requiredValueUnmet', detail: `${w.fact}=${w.requiredValue}` }
    }
    // 🔴 통과한 것에만 **코드가 읽은** 카드 값을 찍는다
    verified.push({ ...w, verifiedCardValue: cardValueText(p, w.fact) })
  }
  return { ok: true, warrants: verified }
}

const HOLD = (reason: string, rejection: WarrantRejection | null = null): SpeakerPlan => ({
  decision: 'hold', personaCode: null, stance: null, selfBasis: null, warrants: [],
  universalReason: '', protectedFacts: [], speakerRelative: [], closingIntent: null, contentRoles: [],
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
    return { plan: HOLD('계획을 읽지 못했다'), dropped: [], schemaProblems: [UNPARSABLE_PLAN] }
  }
  const problems: string[] = []
  const dropped: { text: string; why: DropReason }[] = []
  const spans = packet.spans

  // ── protectedFacts — 증명 가능한 것만 ──
  const facts: ProtectedFact[] = []
  const speakerRelative: SpeakerRelativeEntry[] = []
  /**
   * 🔴 계획이 적어 낸 화자 상대 사실 — **증거가 맞을 때만** 쓴다.
   *    같은 `sourceText` + `evidenceRef` 로 찾는다.
   */
  const claimed = new Map<string, FactRole>()
  for (const x of arr(j.speakerRelative)) {
    const o = x as Record<string, unknown>
    const t = S(o.sourceText)
    const r = S(o.evidenceRef)
    const m = S(o.materiality)
    if (t === '' || !(EVIDENCE_REFS as readonly string[]).includes(r)) continue
    if (m !== 'incidental' && m !== 'loadBearing') continue
    // 🔴 지목한 자리에 실제로 그 말이 있어야 한다 — 없으면 모델이 지어낸 것이다
    if (!foundInSpan(t, r as EvidenceRef, spans)) continue
    claimed.set(`${r}\u0001${t}`, m)
  }
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
    /**
     * 🔴 **원문 화자 자신의 사실은 지키지 않는다** (2026-09-23).
     *
     *    P02 실패: 모델이 `{kind:'number', text:'44'}` 를 냈고, 검증은 "증거에 있는가 ·
     *    개인정보인가 · kind 가 맞는가" 만 물어 **그대로 통과**했다. 그 44 가 초안에
     *    "제가 곧 44인데" 로 남았고 P02 정본(40대 후반)과 어긋났다.
     *
     *    🔴 **제3자의 나이는 걷어내지 않는다** — 그것은 원문 이야기의 일부다.
     */
    const selfAxis = speakerRelativeAxisOf({ text, ref: ref as EvidenceRef, spans })
    if (selfAxis !== null) {
      dropped.push({ text, why: 'speakerRelative' })
      // 🔴 **빼기만 하지 않는다.** 무엇을 바꿔야 하는지 남겨 프롬프트가 쓰게 한다
      /**
       * 🔴 **계획이 말한 materiality 를 받되, 코드가 증거를 검증한다** (2026-09-23).
       *    앞판은 전부 `incidental` 로 하드코딩해 `loadBearingMismatch` 가
       *    **운영상 죽은 경로**였다.
       *    🔴 모델 말을 그대로 믿지 않는다 — `sourceText`·`evidenceRef` 가
       *       실제 증거와 맞을 때만 그 값을 쓴다. 아니면 **안전한 쪽(loadBearing)**.
       */
      /**
       * 🔴 **답하지 않았으면 기본값으로 통과시키지 않는다** (2026-09-23 마스터 지적).
       *
       *    앞판은 계획이 `speakerRelative` 를 아예 안 쓰면 **검증되지 않은 자기 나이를
       *    `incidental` 로 간주해 adopt** 했다. artifact 에 경고를 남기는 것은
       *    안전 검증이 아니다 — 그 글은 그대로 발행 후보가 됐다.
       *    🔴 지금은 **모양 오류**로 처리한다. 같은 사람에게 다시 묻는 재시도이지
       *       결론이 아니므로 정상 원천이 영구 제외되지도 않는다.
       */
      const claimedRole = materialityFor(text, ref as EvidenceRef, claimed)
      if (claimedRole === null) {
        problems.push(MATERIALITY_MISSING
          + ` — ${AXIS_LABEL[selfAxis]} "${text}"(${ref}) 에 대한 materiality 가 없다`)
        continue
      }
      speakerRelative.push({
        axis: selfAxis, sourceText: text, sourceRole: 'self',
        evidenceRef: ref as EvidenceRef,
        materiality: claimedRole,
      })
      continue
    }
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
    protectedFacts: facts, speakerRelative, closingIntent, contentRoles: [...new Set(roles)],
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
  const warrants: ClaimedWarrant[] = arr(j.speakerWarrants).map((x) => {
    const o = x as Record<string, unknown>
    return {
      fact: S(o.fact) as ClaimFact, requiredValue: S(o.requiredValue),
      evidenceRef: S(o.evidenceRef) as EvidenceRef, evidenceText: S(o.evidenceText),
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
        // 🔴 **검증이 찍어 준 것만** 싣는다 — 모델이 준 배열을 그대로 쓰지 않는다
        warrants: v.warrants,
        universalReason: selfBasis === 'noLifeFactNeeded' ? universalReason : '',
        reason: selfBasis === 'lifeFacts' ? '원문 근거와 정본 카드로 1인칭을 허가했다'
          : '특정 생활사 자격이 필요 없는 글이다', rejection: null,
        ...base,
      }),
      dropped, schemaProblems: problems,
    }
  }
  /**
   * 🔴 **허가하지 않으면 만들지 않는다.**
   *    자리를 낮춰 생성하지 않는다 — 그렇게 만든 글이 다시 자기 경험을 말했다.
   *    다른 Persona 를 고르지도 않는다.
   */
  const why = `${WARRANT_REJECTION_LABEL[v.why]}${v.detail === '' ? '' : ` (${v.detail})`}`
  return {
    plan: withBase(HOLD(
      `1인칭 허가 실패 — ${why}. 🔴 자리를 낮춰 만들지 않는다`, v.why)),
    dropped, schemaProblems: problems,
  }
}

/**
 * 🔴 **이번 답의 모양이 어긋났는가.** 어긋났으면 결론이 아니라 재시도다 —
 *    같은 원문이라도 다음에는 제대로 온 답이 올 수 있다.
 *
 * 🔴 모르는 `contentRole` 처럼 **버리고 지나가는 흠**은 여기 해당하지 않는다.
 *    계획 자체를 세우지 못한 경우만이다.
 */
export function planSchemaFailed(parse: SpeakerPlanParse): boolean {
  if (parse.schemaProblems.includes(UNPARSABLE_PLAN)) return true
  /**
   * 🔴 **materiality 누락은 모양 오류다** (2026-09-23 마스터 지적).
   *    앞판은 기본값 `incidental` 로 통과시켜 **검증되지 않은 자기 나이**가
   *    발행 후보가 됐다. 다시 물으면 달라질 수 있으므로 결론이 아니라 재시도다.
   */
  if (parse.schemaProblems.some((x) => x.startsWith(MATERIALITY_MISSING))) return true
  const r = parse.plan.rejection
  return r !== null && !(QUALIFICATION_REJECTIONS as readonly string[]).includes(r)
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

/**
 * 🔴 **이 사실이 원문 화자 자신의 것인가.** 맞으면 축을, 아니면 `null`.
 *
 * 🔴 판정 계약을 새로 만들지 않는다 — 나이는 `readSelfAgeClaim` 정본이 본다.
 *    그 함수가 제3자·과거 시점·근사 표현 오탐을 이미 걸러 준다.
 */
export function speakerRelativeAxisOf(input: {
  text: string
  ref: EvidenceRef
  spans: readonly EvidenceSpan[]
}): SpeakerRelativeAxis | null {
  const host = input.spans.find((s) => s.kind === input.ref)?.text ?? ''
  if (host === '') return null
  for (const clause of host.split(/[\n.!?]|(?<=[다요죠])\s/)) {
    if (!clause.includes(input.text)) continue
    // 🔴 1인칭 표지가 뚜렷하면 정본이 바로 잡는다
    if (readSelfAgeClaim(clause) !== null) return 'age'
    /**
     * 🔴 **판정을 뒤집는다** (2026-09-23). 원문은 카페 글이라 1인칭 표지를 자주 생략한다 —
     *    실제 P02 원문이 *"낼44인데 아직도 어리단소리들어요"* 였고, 보수적 정본은
     *    주어가 없어 읽지 못했다.
     *
     *    🔴 **원문 화자의 나이를 지켜서 우리가 얻는 것은 없다.** 그래서 여기서는
     *       "자기 나이가 확실한가" 가 아니라 **"제3자 것이 확실한가"** 를 묻는다.
     *       제3자 표지가 없으면 화자 상대로 보고 걷어낸다 — 걷어내도 손해가 없고,
     *       남기면 P02 처럼 남의 나이가 우리 글에 박힌다.
     */
    if (AGE_LIKE.test(clause) && clause.includes(input.text)
      && !OTHER_MARKERS.some((w) => clause.includes(w))) return 'age'
    /**
     * 🔴 **관계·직업·지역·갱년기는 아직 켜지 않는다** (2026-09-23 마스터 판정).
     *
     *    걷어내기만 하고 **완전한 변환과 검증이 없으면 내용이 사라진다.**
     *    공통 타입(`SpeakerRelativeAxis`)은 두되, 미지원 축은 활성화하지 않는다.
     *    `relationAxisOf` 는 그 축들을 켤 때 쓸 자리로 남겨 둔다 — 지금은 부르지 않는다.
     */
    void relationAxisOf
  }
  return null
}

/** 🔴 나이로 읽히는 모양 — `80퍼` · `3일` 과 갈린다 */
const AGE_LIKE = /(?:^|[^0-9])([2-9][0-9])\s*(?:살|세|인데|이고|이라|예요|이에요|입니다|이면)/

/**
 * 🔴 **관계 낱말 → 화자 상대 축** (2026-09-23).
 *
 *    `남편`·`아들`·`시어머니` 는 **원문 화자의 가족**이다. 우리 화자의 가족이 아니다.
 *    이것을 `protectedFacts` 로 지키면 프롬프트가 "이 말들은 **그대로** 씁니다" 라고
 *    지시하고(`content-core-prompts.mts`), 이혼·무자녀 Persona 에게 남편·딸이 박힌다.
 *    그다음은 양쪽 다 막히는 협공이다 —
 *      · 원문 값을 쓰면 `lifeContradictions` → hold
 *      · 우리 값을 쓰면 `protectedFactMissing` → 실패
 *    그리고 그 hold 는 `terminal` 이라 **원천이 영구히 탄다**(`supply-workset.ts`).
 */
const RELATION_AXIS: ReadonlyArray<[SpeakerRelativeAxis, readonly string[]]> = [
  ['maritalStatus', ['남편', '신랑', '애들아빠', '아이아빠', '아내', '와이프',
    '시어머니', '시아버지', '시댁', '시누이', '장인', '장모', '처가', '며느리', '사위']],
  ['children', ['아들', '딸', '애들', '아이들', '큰애', '작은애', '자식', '손주']],
  ['parentCare', ['친정', '부모님']],
]

/**
 * 🔴 **제3자의 것인가.** 관계 낱말 **바로 앞**에 남을 가리키는 말이 붙으면 그 사람 것이다
 *    — "아는 분 남편" · "친구 아들". 그때는 원문 이야기의 일부이므로 지킨다.
 */
const THIRD_PARTY_OWNER = /(아는\s*[가-힣]{0,3}|친구|이웃|동료|옆집|주변\s*[가-힣]{0,3}|언니|오빠|형님|동서|올케)\s*$/

function relationAxisOf(clause: string, text: string): SpeakerRelativeAxis | null {
  for (const [axis, words] of RELATION_AXIS) {
    for (const w of words) {
      if (!text.includes(w)) continue
      const at = clause.indexOf(text)
      if (at < 0) continue
      // 🔴 바로 앞 12자만 본다 — 문장 전체를 보면 멀리 있는 낱말에 끌려간다
      if (THIRD_PARTY_OWNER.test(clause.slice(Math.max(0, at - 12), at))) return null
      return axis
    }
  }
  return null
}

/**
 * 🔴 **계획이 말한 값을 쓰되, 증거가 맞을 때만 쓴다.** 증거가 어긋난 주장은
 *    `claimed` 에 들어가지도 않는다 — 지어낸 계획을 통과시키지 않는다.
 *
 * 🔴 **없으면 `null` 이다. 기본값을 만들지 않는다** (2026-09-23 마스터 지적).
 *
 *    앞판은 계획이 답하지 않으면 `incidental` 로 두고 artifact 에 경고만 남겼다.
 *    경고는 안전 검증이 아니다 — 검증되지 않은 자기 나이가 그대로 발행 후보가 됐다.
 *    부르는 쪽이 `null` 을 **모양 오류**로 올려 다시 묻는다.
 */
export function materialityFor(
  text: string, ref: EvidenceRef, claimed: ReadonlyMap<string, FactRole>,
): FactRole | null {
  return claimed.get(`${ref}\u0001${text}`) ?? null
}
