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
import type { SourceEssence, ContentRole } from './essence'
import { exactAnchors } from './essence'

export const REVIEW_VERSION = 'review-v1'

export const DETERMINISTIC_CODES = [
  'personalInfo', 'copiedFromSource', 'bannedWord', 'schemaInvalid',
  'exactAnchorAltered', 'selfAgeConflict',
  // 🔴 `voiceContentLeak` 을 뺐다 (2026-09-19) — 글자만 보고 "같은 말" 과 "가져온 것" 을
  //    가를 수 없다. 의미 검수(`voiceFidelity`)와 사람이 본다.
] as const
export type DeterministicCode = (typeof DETERMINISTIC_CODES)[number]

export const DETERMINISTIC_LABEL: Readonly<Record<DeterministicCode, string>> = {
  personalInfo: '개인정보가 들어 있다',
  copiedFromSource: '원문을 실질적으로 옮겼다',
  bannedWord: '쓰지 않기로 한 낱말이 있다',
  schemaInvalid: '형식이 맞지 않는다',
  exactAnchorAltered: '그대로 남기기로 한 말이 바뀌었다',
  selfAgeConflict: '글쓴이 나이와 어긋난다',
}

export type DeterministicFailure = { code: DeterministicCode; detail: string }
export type DeterministicResult = { pass: boolean; failures: DeterministicFailure[] }

/**
 * 🔴 **exact anchor 가 그대로 남았는가.**
 *    사람 이름 · 프로그램 이름 · 숫자처럼 바꾸면 무슨 이야기인지 알 수 없어지는 것만
 *    `exact` 로 온다. 나머지(`semantic`)는 여기서 재지 않는다.
 */
export function alteredExactAnchors(e: SourceEssence, draftText: string): string[] {
  return exactAnchors(e).filter((a) => !draftText.includes(a.text)).map((a) => a.text)
}

/**
 * 의미 검수가 볼 축 — 🔴 **글의 역할에 따라 달라진다.**
 *    짧은 대화글을 "정보가 없다" 로, 정보글을 "묻지 않는다" 로 떨어뜨리지 않기 위해서다.
 */
export const SEMANTIC_AXES = [
  'sourceFidelity', 'personaClaimValidity', 'voiceFidelity',
  'naturalKorean', 'customerValue', 'harm',
] as const
export type SemanticAxis = (typeof SEMANTIC_AXES)[number]

export const SEMANTIC_AXIS_PROMPT: Readonly<Record<SemanticAxis, string>> = {
  sourceFidelity: '원문의 이야기가 남아 있는가 — 어느 원문에나 붙는 일반 글이 되지 않았는가',
  personaClaimValidity: '글쓴이가 가지지 않은 사실을 자기 일로 말하지 않았는가',
  voiceFidelity: '말투 참고의 **사건**을 가져오지 않았는가 (리듬만 빌렸는가)',
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

export type SemanticVerdict = {
  issues: SemanticAxis[]
  unknownIssues: string[]
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
  return {
    issues: [...new Set(issues)],
    unknownIssues: [...new Set(unknown)],
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
