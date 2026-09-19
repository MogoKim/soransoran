/**
 * 검수 — 🔴 **기계가 확정할 수 있는 것과 사람이 정하는 것을 가른다**
 *
 * 🔴 **deterministic 이 맡는 것은 확정 가능한 것뿐이다**:
 *    개인정보 · 실질 복제 · 명확한 위해 표현 · schema · exact anchor 변조 ·
 *    확정 가능한 자기 나이 모순. 재미·자연스러움·가치는 여기서 재지 않는다.
 *
 * 🔴 **재미와 말투를 규칙으로 획일화하지 않는다.** 물음표 수 · 문장 길이 ·
 *    특정 낱말을 강제하면 모든 글이 같은 모양이 된다 (2026-09-13 실측).
 *
 * 🔴 **machine 판정은 READY 가 아니다.** 최종 READY/EDIT_REQUIRED/HOLD 는 사람이 정한다.
 */
import type { ClaimFact, ClaimRequirement, ContentRole, SourceBeat } from './essence'

export const REVIEW_VERSION = 'review-v4'

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
 * 의미 검수가 볼 축 — 🔴 **글의 역할에 따라 달라진다.**
 *    짧은 대화글을 "정보가 없다" 로, 정보글을 "묻지 않는다" 로 떨어뜨리지 않기 위해서다.
 */
export const SEMANTIC_AXES = [
  /**
   * 🔴 **편집 브리프 자체가 원문을 왜곡했는가** (2026-09-19 추가).
   *    앞판은 `meaning` 이 `evidenceText` 와 뜻이 달라도 통과했다 —
   *    "김치를 꺼냈다" 가 "김치 때문에 회사가 망했다" 가 될 수 있었다.
   *    deterministic 유사도로 풀 수 없으므로 **같은 검수 호출**이 함께 본다.
   */
  'briefDistortion',
  /**
   * 🔴 **`sourceFidelity` 를 여기서 없앴다** (2026-09-19 실측 보정).
   *    그 축은 "이야기를 잃었는가" 하나로 **누락과 창작을 겸했다.** 그래서 두 번째
   *    유료 실측에서 세 편 중 두 편이 `sourceFidelity` 로 멈췄는데,
   *    한 편은 *"원래 의도는 살았다"* 는 자기 주석과 함께 걸렸다 —
   *    무엇을 고쳐야 하는지 사람이 알 수 없었다.
   *    🔴 대신 **근거를 가진 두 구조**(`missingBeatIds` · `unsupportedAdditions`)가
   *       그 책임을 나눠 맡는다. 축을 늘린 것이 아니라 하나를 근거로 바꾼 것이다.
   */
  'personaClaimValidity',
  // 🔴 **말투 책임을 둘로 나눈다** (2026-09-19). 앞판 `voiceFidelity` 는 이름과 달리
  //    사건 유출만 봤다 — 선택한 Persona 의 말투인지는 아무도 보지 않았다.
  'voiceContentLeak', 'voiceMismatch',
  'naturalKorean', 'customerValue', 'harm',
] as const
export type SemanticAxis = (typeof SEMANTIC_AXES)[number]

export const SEMANTIC_AXIS_PROMPT: Readonly<Record<SemanticAxis, string>> = {
  briefDistortion: '아래 [정리한 뜻]이 [원문 근거]에 없는 뜻을 만들거나 방향을 뒤집었는가'
    + ' (초안이 아니라 **정리한 뜻 자체**를 본다)',
  personaClaimValidity: '글쓴이가 **가지지 않은 생활사**를 자기 일로 말하지 않았는가'
    + ' (혼인 · 자녀 수와 나이대 · 직업 · 사는 곳 · 형편 · 부모 돌봄 · 갱년기 · 나이대)',
  voiceContentLeak: '말투 참고 자료의 **사건**(가족·병원·직장 일 같은 것)을 이 글에 가져왔는가',
  voiceMismatch: '이 글이 **그 사람의 말투**로 읽히는가 — 리듬 · 말끝 · 줄바꿈. '
    + '🔴 이모티콘 개수 · 문장 길이 같은 정해진 몫을 세지 않는다',
  naturalKorean: '사람이 쓴 글로 읽히는가',
  customerValue: '40~60대 여성이 읽을 이유가 있는가',
  harm: '약·용량·진단·치료를 확정적으로 지시하거나 특정인을 해치지 않는가',
}

/** 🔴 역할별로 **묻지 않을 것** — 없는 것을 결함으로 세지 않는다 */
export const ROLE_EXEMPT: Readonly<Record<ContentRole, string[]>> = {
  discoveryAnchor: ['짧다는 이유로 막지 않는다'],
  conversationSpark: ['정보가 적다는 이유로 막지 않는다'],
  experienceResonance: ['묻지 않고 끝난다는 이유로 막지 않는다'],
  usefulAnswer: ['감정이 없다는 이유로 막지 않는다'],
}

/** 🔴 어느 주장을 어디서 위반했는가 — 초안 속 **실제 문장**을 가리켜야 한다 */
export type ClaimViolation = {
  claimId: string
  /** 초안에 실제로 있는 문장 */
  evidence: string
  why: string
}

/**
 * 🔴 **초안이 카드와 다른 생활사를 새로 주장했는가.**
 *    `claimViolations` 는 원천에서 뽑힌 claim 이 있을 때만 잡는다 —
 *    소재 판정이 claim 을 빠뜨리면 아무도 못 본다. 이쪽은 **카드 전체**와 견준다.
 */
export type LifeContradiction = {
  fact: ClaimFact
  /** 초안이 주장한 것 */
  drafted: string
  /** 카드가 가진 것 */
  card: string
  /** 초안에 실제로 있는 문장 */
  evidence: string
}

/**
 * 🔴 **원문·brief·Persona 카드 어디에도 없던 새 사건** (2026-09-19 추가).
 *    A 실측: 원문은 *"방송 속 남편들과 달라 답답하다"* 뿐인데 초안이
 *    *"주말에 밥 차려달라고 하면 난리가 나고, 아이들 학용품은 못 봤대요"* 를 지어냈다.
 *    C 실측: 원문은 시간을 옮겨 메운 것인데 초안이 *"휴가를 내고"* 로 바꿨다.
 */
export type UnsupportedAddition = {
  /** 🔴 초안에 **실제로 있는** 문장 — 없으면 인정하지 않는다 */
  evidence: string
  why: string
}

export type SemanticVerdict = {
  issues: SemanticAxis[]
  unknownIssues: string[]
  /**
   * 🔴 **초안에서 사라진 필수 결의 id.**
   *    C 실측: *"다른 직원 도움 없이 본인이 시간을 메꿨다"* 가 사라져 질문의 맥락이
   *    무너졌는데, 앞판은 그것을 가리킬 이름이 없었다.
   */
  missingBeatIds: string[]
  unsupportedAdditions: UnsupportedAddition[]
  lifeContradictions: LifeContradiction[]
  /**
   * 🔴 **낮춘 자리인데 자기 사실로 주장했는가.**
   *    앞판은 stance 를 프롬프트에만 주고 아무도 확인하지 않았다 —
   *    `QUESTION` 자리에서 *"제가 조정한 시간을…"* 이 그대로 통과했다.
   */
  claimViolations: ClaimViolation[]
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

/** 🔴 초안에 실제로 있는 문장만 근거로 인정한다 — 지어낸 근거로 막지 않는다 */
export function groundedLifeContradictions(
  raw: readonly LifeContradiction[], draftText: string,
): LifeContradiction[] {
  const flat = draftText.replace(/\s+/g, '')
  return raw.filter((v) => v.evidence.trim() !== '' && flat.includes(v.evidence.replace(/\s+/g, '')))
}


/**
 * 🔴 **우리가 실제로 건넨 결의 이름만 인정한다.** 모델이 지어낸 id 로 막지 않는다.
 */
export function groundedMissingBeatIds(
  raw: readonly string[], beats: readonly SourceBeat[],
): string[] {
  const ids = new Set(beats.map((b) => b.id))
  return [...new Set(raw.map((x) => x.trim()).filter((x) => ids.has(x)))]
}

/**
 * 🔴 **초안에 실제로 있는 문장만 새 사건의 근거로 인정한다.**
 *    지어낸 근거로 막으면 정상 글이 사라진다 — 과차단이 곧 공급 0이다.
 */
export function groundedAdditions(
  raw: readonly UnsupportedAddition[], draftText: string,
): UnsupportedAddition[] {
  const flat = draftText.replace(/\s+/g, '')
  return raw.filter((a) => a.evidence.trim() !== '' && flat.includes(a.evidence.replace(/\s+/g, '')))
}

export function groundedViolations(
  raw: readonly ClaimViolation[], draftText: string, claims: readonly ClaimRequirement[],
): { kept: ClaimViolation[]; ungrounded: ClaimViolation[] } {
  const ids = new Set(claims.map((c) => c.id))
  const flat = draftText.replace(/\s+/g, '')
  const kept: ClaimViolation[] = []
  const ungrounded: ClaimViolation[] = []
  for (const v of raw) {
    const ok = ids.has(v.claimId) && v.evidence.trim() !== ''
      && flat.includes(v.evidence.replace(/\s+/g, ''))
    if (ok) kept.push(v)
    else ungrounded.push(v)
  }
  return { kept, ungrounded }
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
  const violations: ClaimViolation[] = []
  for (const v of Array.isArray(j.claimViolations) ? j.claimViolations : []) {
    const o = v as Record<string, unknown>
    const claimId = typeof o.claimId === 'string' ? o.claimId.trim() : ''
    if (claimId === '') continue
    violations.push({
      claimId,
      evidence: typeof o.evidence === 'string' ? o.evidence.trim() : '',
      why: typeof o.why === 'string' ? o.why.slice(0, 120) : '',
    })
  }
  const missingBeatIds: string[] = []
  for (const v of Array.isArray(j.missingBeatIds) ? j.missingBeatIds : []) {
    const id = String(v).trim()
    if (id !== '') missingBeatIds.push(id)
  }
  const additions: UnsupportedAddition[] = []
  for (const v of Array.isArray(j.unsupportedAdditions) ? j.unsupportedAdditions : []) {
    const o = v as Record<string, unknown>
    const evidence = typeof o.evidence === 'string' ? o.evidence.trim() : ''
    if (evidence === '') continue
    additions.push({ evidence, why: typeof o.why === 'string' ? o.why.slice(0, 120) : '' })
  }
  const lifes: LifeContradiction[] = []
  for (const v of Array.isArray(j.lifeContradictions) ? j.lifeContradictions : []) {
    const o = v as Record<string, unknown>
    const fact = typeof o.fact === 'string' ? o.fact.trim() : ''
    if (fact === '') continue
    lifes.push({
      fact: fact as ClaimFact,
      drafted: typeof o.drafted === 'string' ? o.drafted.slice(0, 60) : '',
      card: typeof o.card === 'string' ? o.card.slice(0, 60) : '',
      evidence: typeof o.evidence === 'string' ? o.evidence.trim() : '',
    })
  }
  return {
    issues: [...new Set(issues)],
    unknownIssues: [...new Set(unknown)],
    missingBeatIds: [...new Set(missingBeatIds)],
    unsupportedAdditions: additions,
    lifeContradictions: lifes,
    claimViolations: violations,
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
  ageCompletion: ReviewCompletion
  ageConflict: boolean
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
  if (input.semantic === null) return { outcome: 'hold', reason: '의미 판정을 읽지 못했다' }
  if (input.semantic.issues.includes('harm')) return { outcome: 'drop', reason: '위해' }
  // 🔴 정리한 뜻 자체가 원문을 뒤집었다 — 초안을 볼 것도 없다
  if (input.semantic.issues.includes('briefDistortion')) {
    return { outcome: 'hold', reason: 'briefDistortion — 정리한 뜻이 원문과 다르다' }
  }
  /**
   * 🔴 **둘 중 하나라도 실질적이면 채택하지 않는다** (2026-09-19).
   *    여기 오는 값은 이미 근거가 확인된 것뿐이다 — 초안에 없는 문장,
   *    우리가 건네지 않은 결 이름은 부르는 쪽에서 이미 떨어졌다.
   */
  if (input.semantic.unsupportedAdditions.length > 0) {
    return {
      outcome: 'hold',
      reason: `원문에 없는 사건 ${input.semantic.unsupportedAdditions.length}건`
        + ` — ${input.semantic.unsupportedAdditions.map((a) => a.evidence).join(' / ')}`,
    }
  }
  if (input.semantic.missingBeatIds.length > 0) {
    return {
      outcome: 'hold',
      reason: `필수 결 누락 ${input.semantic.missingBeatIds.join(' · ')}`,
    }
  }
  // 🔴 카드에 없는 생활사를 새로 주장했다 (claim 이 없어도 잡는다)
  if (input.semantic.lifeContradictions.length > 0) {
    return {
      outcome: 'hold',
      reason: `생활사 모순 ${input.semantic.lifeContradictions.map((x) => x.fact).join(' · ')}`,
    }
  }
  // 🔴 낮춘 자리인데 자기 사실로 주장했다 — 하나라도 있으면 채택하지 않는다
  if (input.semantic.claimViolations.length > 0) {
    return {
      outcome: 'hold',
      reason: `자격 없는 주장 ${input.semantic.claimViolations.map((v) => v.claimId).join(' · ')}`,
    }
  }
  if (input.semantic.issues.length > 0) {
    return { outcome: 'hold', reason: input.semantic.issues.join(' · ') }
  }
  if (input.semantic.unknownIssues.length > 0) {
    return { outcome: 'hold', reason: '우리 축이 아닌 이름만 왔다' }
  }
  // 🔴 나이 검수는 **보조**다. 하지만 완주하지 못했으면 통과로 읽지 않는다
  if (!input.ageCompletion.complete) {
    return { outcome: 'hold', reason: `나이 검수를 완주하지 못했다 (${INCOMPLETE_LABEL[input.ageCompletion.reason ?? 'noResponse']})` }
  }
  if (input.ageConflict) return { outcome: 'hold', reason: '나이·가족이 어긋난다' }
  return { outcome: 'adopt', reason: '' }
}
