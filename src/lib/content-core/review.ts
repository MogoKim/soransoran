/**
 * 검수 — 🔴 **기계가 확정할 수 있는 것과 사람이 정하는 것을 가른다**
 *
 * 🔴 **deterministic 이 맡는 것은 확정 가능한 것뿐이다**:
 *    개인정보 · 실질 복제 · 금지 낱말 · schema · 지켜야 할 원자적 사실의 소실 ·
 *    확정 가능한 자기 나이 모순. 재미·자연스러움·가치는 여기서 재지 않는다.
 *
 * 🔴 **의미 검수는 원문과 초안을 직접 견준다** (2026-09-19 구조 단순화).
 *    앞판은 앞 AI 가 만든 `정리한 뜻` 을 기준으로 삼아, 그 요약이 원문을 왜곡했는지를
 *    따로 묻는 축(`briefDistortion`)까지 두었다. 요약을 없애니 그 축도 함께 사라졌다.
 *
 * 🔴 **판정 근거는 원문 또는 초안에 실제 있는 문장이어야 한다.**
 *    지어낸 근거로 막으면 정상 글이 사라지고, 과차단은 곧 공급 0 이다.
 *
 * 🔴 **한국어 낱말 사전·정규식을 만들지 않는다.** 목록은 반드시 낡고,
 *    낡은 목록이 정상 문장을 막는다.
 *
 * 🔴 **machine 판정은 READY 가 아니다.** 최종 READY/EDIT_REQUIRED/HOLD 는 사람이 정한다.
 */
import { CLAIM_FACTS } from './source-facts'

export const REVIEW_VERSION = 'review-v6'

export const DETERMINISTIC_CODES = [
  'personalInfo', 'copiedFromSource', 'bannedWord', 'schemaInvalid',
  'selfAgeConflict', 'protectedFactMissing',
] as const
export type DeterministicCode = (typeof DETERMINISTIC_CODES)[number]

export const DETERMINISTIC_LABEL: Readonly<Record<DeterministicCode, string>> = {
  personalInfo: '개인정보가 들어 있다',
  copiedFromSource: '원문을 실질적으로 옮겼다',
  bannedWord: '쓰지 않기로 한 낱말이 있다',
  schemaInvalid: '형식이 맞지 않는다',
  selfAgeConflict: '글쓴이 나이와 어긋난다',
  protectedFactMissing: '글자 그대로 지켜야 할 사실이 사라졌다',
}

export type DeterministicFailure = { code: DeterministicCode; detail: string }
export type DeterministicResult = { pass: boolean; failures: DeterministicFailure[] }

/**
 * 의미 검수가 볼 축 — 🔴 **구조로 근거를 받을 수 없는 것만 남는다.**
 *
 *    사라진 원문 · 새로 지어낸 사건 · 생활사 모순은 **문장을 가리킬 수 있으므로**
 *    축이 아니라 구조(`droppedFromSource` · `unsupportedAdditions` ·
 *    `lifeContradictions`)로 받는다. 여기 남는 셋은 문장 하나로 가리키기 어렵다.
 */
export const SEMANTIC_AXES = ['voiceContentLeak', 'voiceMismatch', 'harm'] as const
export type SemanticAxis = (typeof SEMANTIC_AXES)[number]

export const SEMANTIC_AXIS_PROMPT: Readonly<Record<SemanticAxis, string>> = {
  voiceContentLeak: '말투 참고 자료의 **사건**(가족·병원·직장 일 같은 것)을 이 글에 가져왔는가',
  voiceMismatch: '이 글이 **그 사람의 말투**와 크게 어긋나는가 — 리듬 · 말끝 · 줄바꿈. '
    + '🔴 이모티콘 개수 · 문장 길이 같은 정해진 몫을 세지 않는다',
  harm: '약·용량·진단·치료를 확정적으로 지시하거나 특정인을 해치지 않는가',
}

/** 🔴 **원문에 있었는데 초안에서 사라진 핵심 상황·질문** — 근거는 **원문** 문장이다 */
export type DroppedFromSource = {
  /** 🔴 원문 근거에 **실제로 있는** 문장 */
  evidence: string
  why: string
}

/**
 * 🔴 **원문에 없던 것을 새로 넣었는가** — 근거는 **초안** 문장이다.
 *
 * 🔴 **Persona 카드가 가진 사실이라는 이유로 면제하지 않는다** (2026-09-19 보정).
 *    앞판은 카드의 직업·자녀·지역·형편을 통째로 면제했다. 그런데 생성 계약은
 *    *"생활사는 화자 자격이지 글의 재료가 아니다"* 라고 말한다 — 두 계약이 어긋났다.
 *    그래서 **원문이 요구하지 않은 생활사**(`ClaimRequirement` 에 없는 것)를
 *    초안이 구체적으로 말하면, 그 사람이 실제로 가진 사실이어도 **새로 넣은 것**이다.
 *    *"저는 수도권에 살고 형편이 빠듯해서요"* 는 원문이 부르지 않았으면 장식이다.
 */
export type UnsupportedAddition = {
  /** 🔴 초안에 **실제로 있는** 문장 */
  evidence: string
  why: string
}

/**
 * 🔴 **초안이 카드와 다른 생활사를 자기 일로 주장했는가.**
 *
 *    나이·가족 나이 모순도 여기서 본다 (`fact: 'age'` · `'childAgeBand'`) —
 *    카드의 나이대와 자녀 나이대가 이미 검수 프롬프트에 들어가 있고,
 *    근거도 똑같이 **초안 속 문장**이다. 그래서 나이만 따로 묻는 호출을 두지 않는다.
 */
/**
 * 🔴 **생활사 모순으로 말할 수 있는 축** — `ClaimFact` 보다 넓다 (2026-09-19 보정).
 *
 *    `ClaimFact` 는 **원천이 1인칭 자격으로 요구하는 축**이라 카드 값과 정규 값으로
 *    견줄 수 있는 것만 담는다. 그런데 검수 프롬프트에는 `lifeContractLines` 가
 *    **형편과 배우자 관계까지** 실어 보낸다 — 건네 놓고 그 모순은 말할 수 없었다.
 *    🔴 자격 축과 억지로 합치지 않고 **여기서 따로 넓힌다.**
 */
export const LIFE_CONTRADICTION_FACTS = [
  ...CLAIM_FACTS, 'economicStatus', 'spouseRelationship',
] as const
export type LifeContradictionFact = (typeof LIFE_CONTRADICTION_FACTS)[number]

export type LifeContradiction = {
  fact: LifeContradictionFact
  /** 초안이 주장한 것 */
  drafted: string
  /** 카드가 가진 것 */
  card: string
  /** 초안에 실제로 있는 문장 */
  evidence: string
}

export type SemanticVerdict = {
  issues: SemanticAxis[]
  unknownIssues: string[]
  droppedFromSource: DroppedFromSource[]
  unsupportedAdditions: UnsupportedAddition[]
  lifeContradictions: LifeContradiction[]
  confidence: number
  note: string
}

/** 🔴 검수가 **완주했는가** — 잘림·미응답·파싱 실패·사용량 미상은 통과가 아니다 */
export type ReviewCompletion = {
  complete: boolean
  /** 왜 완주하지 못했나 */
  reason: 'truncated' | 'noResponse' | 'parseFailed' | 'usageUnknown' | 'budgetBlocked' | null
}

export const INCOMPLETE_LABEL: Readonly<Record<NonNullable<ReviewCompletion['reason']>, string>> = {
  truncated: '답이 잘렸다',
  noResponse: '답이 오지 않았다',
  parseFailed: '답을 읽지 못했다',
  usageUnknown: '사용량을 알 수 없다',
  budgetBlocked: '예산·상한에 막혀 묻지 못했다',
}

/** 🔴 공백·줄바꿈만 지우고 견준다 */
const flat = (s: string): string => s.replace(/\s+/g, '')

/** 🔴 **초안에 실제로 있는 문장만 인정한다** — 지어낸 근거로 막지 않는다 */
export function groundedInDraft<T extends { evidence: string }>(
  raw: readonly T[], draftText: string,
): T[] {
  const d = flat(draftText)
  return raw.filter((x) => x.evidence.trim() !== '' && d.includes(flat(x.evidence)))
}

/** 🔴 **원문 근거에 실제로 있는 문장만 인정한다** */
export function groundedInSource<T extends { evidence: string }>(
  raw: readonly T[], sourceText: string,
): T[] {
  const s = flat(sourceText)
  return raw.filter((x) => x.evidence.trim() !== '' && s.includes(flat(x.evidence)))
}

export function parseSemanticReview(raw: string): SemanticVerdict | null {
  let j: Record<string, unknown>
  try {
    const t = raw.trim()
    j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
  } catch { return null }
  const conf = Number(j.confidence ?? NaN)
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) return null
  const raws = Array.isArray(j.issues) ? j.issues.map(String) : []
  const issues: SemanticAxis[] = []
  const unknown: string[] = []
  for (const x of raws) {
    if ((SEMANTIC_AXES as readonly string[]).includes(x)) issues.push(x as SemanticAxis)
    else unknown.push(x)
  }
  const evidenced = (key: string): { evidence: string; why: string }[] => {
    const out: { evidence: string; why: string }[] = []
    for (const v of Array.isArray(j[key]) ? (j[key] as unknown[]) : []) {
      const o = v as Record<string, unknown>
      const evidence = typeof o.evidence === 'string' ? o.evidence.trim() : ''
      if (evidence === '') continue
      out.push({ evidence, why: typeof o.why === 'string' ? o.why.slice(0, 120) : '' })
    }
    return out
  }
  const lifes: LifeContradiction[] = []
  for (const v of Array.isArray(j.lifeContradictions) ? j.lifeContradictions : []) {
    const o = v as Record<string, unknown>
    const fact = typeof o.fact === 'string' ? o.fact.trim() : ''
    if (fact === '') continue
    /**
     * 🔴 **모르는 축 이름을 조용히 버리지 않는다.** 버리면 실제 모순이 사라진다.
     *    우리 이름이 아니면 `unknownIssues` 로 올려 **채택하지 않게** 한다.
     */
    if (!(LIFE_CONTRADICTION_FACTS as readonly string[]).includes(fact)) {
      unknown.push(`lifeContradiction:${fact}`)
      continue
    }
    lifes.push({
      fact: fact as LifeContradictionFact,
      drafted: typeof o.drafted === 'string' ? o.drafted.slice(0, 60) : '',
      card: typeof o.card === 'string' ? o.card.slice(0, 60) : '',
      evidence: typeof o.evidence === 'string' ? o.evidence.trim() : '',
    })
  }
  return {
    issues: [...new Set(issues)],
    unknownIssues: [...new Set(unknown)],
    droppedFromSource: evidenced('droppedFromSource'),
    unsupportedAdditions: evidenced('unsupportedAdditions'),
    lifeContradictions: lifes,
    confidence: conf,
    note: typeof j.note === 'string' ? j.note.slice(0, 200) : '',
  }
}

/** 기계가 낼 수 있는 값 — 🔴 `adopt` 는 **READY 가 아니다** */
export type MachineOutcome = 'adopt' | 'hold' | 'drop'

/**
 * 🔴 **완주하지 못한 검수는 절대 adopt 가 아니다.**
 *    예산이 모자랄수록 검수가 느슨해지는 구조를 만들지 않는다.
 */
export function judgeMachine(input: {
  deterministic: DeterministicResult
  semantic: SemanticVerdict | null
  semanticCompletion: ReviewCompletion
}): { outcome: MachineOutcome; reason: string } {
  const hard = input.deterministic.failures
  if (hard.some((f) => f.code === 'personalInfo' || f.code === 'bannedWord')) {
    return { outcome: 'drop', reason: DETERMINISTIC_LABEL[hard[0]!.code] }
  }
  if (!input.deterministic.pass) {
    return { outcome: 'hold', reason: hard.map((f) => DETERMINISTIC_LABEL[f.code]).join(' · ') }
  }
  if (!input.semanticCompletion.complete) {
    return { outcome: 'hold', reason: `의미 검수를 완주하지 못했다 (${INCOMPLETE_LABEL[input.semanticCompletion.reason ?? 'noResponse']})` }
  }
  const s = input.semantic
  if (s === null) return { outcome: 'hold', reason: '의미 판정을 읽지 못했다' }
  if (s.issues.includes('harm')) return { outcome: 'drop', reason: '위해' }
  // 🔴 여기 오는 값은 이미 원문·초안에서 근거가 확인된 것뿐이다
  if (s.unsupportedAdditions.length > 0) {
    return {
      outcome: 'hold',
      reason: `원문에 없는 사건 ${s.unsupportedAdditions.length}건`
        + ` — ${s.unsupportedAdditions.map((a) => a.evidence).join(' / ')}`,
    }
  }
  if (s.droppedFromSource.length > 0) {
    return {
      outcome: 'hold',
      reason: `원문의 핵심이 사라졌다 ${s.droppedFromSource.length}건`
        + ` — ${s.droppedFromSource.map((a) => a.evidence).join(' / ')}`,
    }
  }
  if (s.lifeContradictions.length > 0) {
    return { outcome: 'hold', reason: `생활사 모순 ${s.lifeContradictions.map((x) => x.fact).join(' · ')}` }
  }
  if (s.issues.length > 0) return { outcome: 'hold', reason: s.issues.join(' · ') }
  if (s.unknownIssues.length > 0) return { outcome: 'hold', reason: '우리 축이 아닌 이름만 왔다' }
  return { outcome: 'adopt', reason: '' }
}
