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

export const REVIEW_VERSION = 'review-v7'

export const DETERMINISTIC_CODES = [
  'personalInfo', 'copiedFromSource', 'bannedWord', 'schemaInvalid',
  'selfAgeConflict', 'protectedFactMissing',
  /**
   * 🔴 **결론을 만드는 조건이 최종 글에서 사라지거나 뒤바뀌었다** (2026-09-23).
   *    의미 검수가 `clean` 이라 답해도 이 결함은 그 답으로 드러나지 않는다.
   */
  'loadBearingLost',
] as const
export type DeterministicCode = (typeof DETERMINISTIC_CODES)[number]

export const DETERMINISTIC_LABEL: Readonly<Record<DeterministicCode, string>> = {
  personalInfo: '개인정보가 들어 있다',
  copiedFromSource: '원문을 실질적으로 옮겼다',
  bannedWord: '쓰지 않기로 한 낱말이 있다',
  schemaInvalid: '형식이 맞지 않는다',
  selfAgeConflict: '글쓴이 나이와 어긋난다',
  protectedFactMissing: '글자 그대로 지켜야 할 사실이 사라졌다',
  loadBearingLost: '🔴 글의 결론을 만드는 조건이 사라지거나 뒤바뀌었다',
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

/**
 * 🔴 검수가 **완주했는가** — 잘림·미응답·파싱 실패·사용량 미상은 통과가 아니다.
 *
 * 🔴 **`notRun` 을 더했다** (2026-09-20 보정). 앞판은 의미 검수를 **부르지도 않은**
 *    조기 종료가 전부 `budgetBlocked` 로 적혔다. 실측 449988 은 예산 $0.0956 과
 *    요청 3회가 남은 상태에서 화자 자격 때문에 멈췄는데, artifact 에는
 *    "예산·상한에 막혀 묻지 못했다" 로 남았다 — **사실이 아닌 기록**이다.
 *    사람이 원인을 잘못 짚는다. 두 상태를 가른다.
 */
export const INCOMPLETE_REASONS = [
  'truncated', 'noResponse', 'parseFailed', 'usageUnknown', 'budgetBlocked', 'notRun',
] as const
export type IncompleteReason = (typeof INCOMPLETE_REASONS)[number]

/**
 * 🔴 **왜 그렇게 됐는가 — 값으로 적는다** (2026-09-20 보정).
 *
 *    앞판은 `notRun` 하나만 남기고, 재시도인지 결론인지는 `machineReason` **문구를
 *    찾아서** 갈랐다. 문구는 사람이 읽으라고 있는 것이다 — 한 글자만 고쳐도
 *    예산에 막힌 회차가 "결론" 이 되어 영구 제외된다.
 *
 * 🔴 앞 절반은 **다시 물으면 달라질 수 있는 것**, 뒤 절반은 **다시 물어도 같은 것**이다.
 */
export const INCOMPLETE_CAUSES = [
  /**
   * 🔴 **다시 물으면 달라질 수 있는 것.** `parseFailed` 가 여기 있는 이유는
   *    모델이 이번에 형식을 어겼다는 뜻이기 때문이다 — 같은 입력이라도 다음에는
   *    제대로 온다. 이것을 결론으로 적으면 정상 원천이 영구 제외된다(2026-09-21 실측).
   */
  'budgetBlocked', 'noResponse', 'truncated', 'usageUnknown', 'parseFailed',
  /**
   * 🔴 **좁힌 후보 묶음 탓에 못 쓴 것** (2026-09-22).
   *
   *    화자 여력 계획이 원천마다 후보를 나누면서, "이 원문에 맞는 사람이
   *    **이번 묶음에** 없었다" 는 실패가 생겼다. 그것은 **결론이 아니다** —
   *    다음 회차에 다른 묶음을 받으면 쓸 수 있다.
   *    🔴 `speakerUnqualified`(전체 후보에서도 자격이 없다)와 **다른 값**이다.
   *       섞으면 정상 원천이 영구 제외된다 — `parseFailed` 가 그랬던 것과 같다.
   */
  'speakerSlotNarrowed',
  /**
   * 🔴 **화자 상대 사실을 우리 값으로 바꾸지 못했다** (2026-09-23).
   *    같은 원천이라도 **다른 Persona** 면 바꿀 수 있으므로 결론이 아니다.
   */
  'personaTransformFailed',
  /**
   * 🔴 **load-bearing 은 한 덩어리가 아니다** (2026-09-23 마스터 지적).
   *
   *    앞판은 `loadBearingMismatch` 하나로 뭉뚱그렸다. 그런데 `planAxisMapping` 은
   *    load-bearing 이면 **Persona 를 보기도 전에** 실패했다 — 사람을 바꿔도 성공
   *    가능성이 0 인데 세 명을 차례로 태웠다. 재계획이 아니라 유료 반복이었다.
   *    🔴 **다음 시도에 무엇이 달라지는가**로 나눈다.
   */
  // 🔴 그 조건을 만족하는 **다른 후보가 있다** → 그 사람으로 다시 계획한다
  'loadBearingMismatch',
  // 🔴 만족하는 후보가 없다 → **SELF 가 아닌 stance** 로 다시 계획한다 (사람은 그대로)
  'loadBearingSelfImpossible',
  // 결론이다 — 같은 입력·같은 계약이면 또 같다
  'contextInsufficient', 'evidenceBudgetViolated', 'speakerUnqualified', 'voiceUnready',
  'wiringBroken', 'deterministicFailed',
  /**
   * 🔴 **어떤 Persona·stance 로도 의미가 보존되지 않는다** — 한 번에 결론이다.
   *    여기까지 오면 다시 물어도 같다. 세 번 태우지 않는다.
   */
  'meaningUnpreservable',
] as const
export type IncompleteCause = (typeof INCOMPLETE_CAUSES)[number]

export const RETRYABLE_CAUSES = [
  'budgetBlocked', 'noResponse', 'truncated', 'usageUnknown', 'parseFailed',
  // 🔴 다음 회차에 다른 묶음을 받으면 달라진다
  'speakerSlotNarrowed',
  /**
   * 🔴 **다른 Persona 면 될 수 있다** (2026-09-23). 앞판은 `complete` 인 HOLD 를
   *    **전부** 결론으로 봤다 — 자동으로 고칠 수 있는 불일치 하나가 원천을 영구히 태웠다.
   */
  /**
   * 🔴 셋 다 **다음 시도에 실제로 달라지는 것이 있다.**
   *    · personaTransformFailed — 다른 Persona 면 바꿀 값이 있다
   *    · loadBearingMismatch     — 그 조건을 만족하는 후보가 실제로 있다
   *    · loadBearingSelfImpossible — SELF 를 버리고 다른 stance 로 갈 수 있다
   *    🔴 `meaningUnpreservable` 은 여기 없다 — 다시 물어도 같다.
   */
  'personaTransformFailed', 'loadBearingMismatch', 'loadBearingSelfImpossible',
] as const satisfies readonly IncompleteCause[]

/**
 * 🔴 **유료 단계가 직접 실패했을 때 쓰는 사유.** 이때 `reason` 과 `cause` 는 **같은 값**이다 —
 *    다르면 둘 중 하나가 거짓이다.
 */
export const DIRECT_REASONS = [
  'budgetBlocked', 'noResponse', 'truncated', 'usageUnknown', 'parseFailed',
] as const satisfies readonly IncompleteReason[]

/**
 * 🔴 **`notRun` 이 달고 올 수 있는 원인.** 검수를 부르기 전에 멈춘 경로가 실제로
 *    내는 값만이다. 여기 없는 값이 `notRun` 과 함께 오면 모양이 깨진 것이다.
 */
export const NOT_RUN_CAUSES = [
  // 앞 유료 단계가 완주하지 못해 그 원인을 물려받은 것
  'budgetBlocked', 'noResponse', 'truncated', 'usageUnknown', 'parseFailed',
  // 묻기 전에 구조로 멈춘 것
  'contextInsufficient', 'evidenceBudgetViolated', 'speakerUnqualified', 'voiceUnready',
  'wiringBroken', 'deterministicFailed',
  // 🔴 좁힌 묶음 탓 — 결론이 아니다
  'speakerSlotNarrowed',
  // 🔴 화자 상대 사실 변환을 묻기 전에 멈춘 것 — 다른 Persona·stance 면 될 수 있다
  'personaTransformFailed', 'loadBearingMismatch', 'loadBearingSelfImpossible',
  // 🔴 어떤 길로도 안 되는 것 — 결론이다
  'meaningUnpreservable',
] as const satisfies readonly IncompleteCause[]

export const INCOMPLETE_CAUSE_LABEL: Readonly<Record<IncompleteCause, string>> = {
  budgetBlocked: '예산·상한에 막혀 묻지 못했다',
  noResponse: '답이 오지 않았다',
  truncated: '답이 잘렸다',
  usageUnknown: '사용량을 알 수 없다',
  parseFailed: '답을 읽지 못했다',
  contextInsufficient: '무슨 이야기인지 확인하지 못했다',
  evidenceBudgetViolated: '원문 근거 예산을 넘겼다 — 근거를 만드는 쪽이 어긋났다',
  speakerUnqualified: '이 원문을 1인칭으로 쓸 사람이 없다',
  speakerSlotNarrowed: '이번 묶음에 맞는 사람이 없었다 — 다음 회차에 다시 본다',
  voiceUnready: '말투 근거가 서지 않았다',
  wiringBroken: '요청 배선이 어긋났다',
  personaTransformFailed: '🔴 원문 화자의 사실을 우리 Persona 값으로 바꾸지 못했다 — 다른 사람이면 될 수 있다',
  loadBearingMismatch: '🔴 그 사실이 글의 결론을 바꾼다 — **그 조건을 만족하는 다른 사람**으로 다시 계획한다',
  loadBearingSelfImpossible:
    '🔴 그 조건을 만족하는 사람이 없다 — 1인칭을 버리고 **다른 자리(관찰·질문)** 로 다시 계획한다',
  meaningUnpreservable:
    '🔴 어떤 사람·자리로도 원문의 뜻이 보존되지 않는다 — 결론이다. 다시 묻지 않는다',
  deterministicFailed: '확정 가능한 결함이 있다',
}

export type ReviewCompletion = {
  complete: boolean
  /** 왜 완주하지 못했나 */
  reason: IncompleteReason | null
  /** 🔴 **문구가 아니라 값.** 완주했으면 `null` 이다 */
  cause: IncompleteCause | null
}

/**
 * 🔴 **artifact 의 검수 칸이 읽을 수 있는 모양인가.**
 *    `machineOutcome` 만 있고 완주 기록이 없거나 깨졌으면 **결론으로 세지 않는다** —
 *    부분 artifact 하나가 원천을 영구 제외하면 안 된다.
 */
export function reviewShapeOk(review: unknown): boolean {
  if (typeof review !== 'object' || review === null) return false
  const r = review as Record<string, unknown>
  const outcome = String(r.machineOutcome ?? '')
  if (!(MACHINE_OUTCOMES as readonly string[]).includes(outcome)) return false
  const c = r.semanticCompletion
  if (typeof c !== 'object' || c === null) return false
  const cc = c as Record<string, unknown>
  if (typeof cc.complete !== 'boolean') return false
  // 🔴 완주했으면 사유도 원인도 없다 — 하나라도 있으면 둘 중 하나가 거짓이다
  if (cc.complete) return cc.reason === null && cc.cause === null
  const reason = String(cc.reason ?? '')
  const cause = String(cc.cause ?? '')
  if (!(INCOMPLETE_REASONS as readonly string[]).includes(reason)) return false
  if (!(INCOMPLETE_CAUSES as readonly string[]).includes(cause)) return false
  // 🔴 단계가 직접 실패했으면 사유와 원인이 같아야 한다
  if ((DIRECT_REASONS as readonly string[]).includes(reason) && reason !== cause) return false
  // 🔴 `notRun` 은 검수를 부르기 전에 멈춘 경로가 내는 원인만 달 수 있다
  if (reason === 'notRun' && !(NOT_RUN_CAUSES as readonly string[]).includes(cause)) return false
  /**
   * 🔴 **완주하지 못한 회차는 채택이 아니다.** 결론은 `hold` 다 —
   *    딱 하나, 초안에 개인정보·금지 낱말이 있어 **묻기 전에 버린** 경우만 `drop` 이다.
   *    그 판정은 코드가 확정한 것이라 다시 물어도 같다.
   */
  if (outcome === 'adopt') return false
  return outcome === 'hold' || cause === 'deterministicFailed'
}

export const INCOMPLETE_LABEL: Readonly<Record<IncompleteReason, string>> = {
  truncated: '답이 잘렸다',
  noResponse: '답이 오지 않았다',
  parseFailed: '답을 읽지 못했다',
  usageUnknown: '사용량을 알 수 없다',
  budgetBlocked: '예산·상한에 막혀 묻지 못했다',
  notRun: '앞 단계에서 멈춰 의미 검수를 부르지 않았다',
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
/** 🔴 기계가 낼 수 있는 결론 — 정본 하나. 다른 파일이 목록을 다시 적지 않는다 */
export const MACHINE_OUTCOMES = ['adopt', 'hold', 'drop'] as const
export type MachineOutcome = (typeof MACHINE_OUTCOMES)[number]

/**
 * 🔴 **사람에게 넘길 것과 기계가 막을 것을 가른다** (2026-09-20 실측 보정).
 *
 *    `unsupportedAdditions` · `droppedFromSource` 는 **경고**다. 막지 않는다.
 *    SHADOW5B 5편은 사람이 전부 READY 로 봤는데 이 둘이 두 편을 막았고,
 *    **같은 원문·같은 초안이 회차마다 ADOPT/HOLD 를 오갔다** —
 *    "원문에 있는 사건인가" · "뜻이 남았는가" 는 모델이 회차마다 다르게 읽는 판단이다.
 *    그것으로 사람이 READY 라고 본 글을 막으면, 막은 쪽이 틀린 횟수가 더 많다.
 *
 * 🔴 **그래도 지우지 않는다.** 근거는 artifact 에 그대로 남고 사람 검토 화면에 뜬다 —
 *    판정을 **사람에게 넘기는 것**이지 검사를 없애는 것이 아니다.
 *
 * 🔴 **확정할 수 있는 결함은 그대로 막는다**: deterministic 실패 · 개인정보 · 복제 ·
 *    금지어 · 보호 사실 누락 · harm · lifeContradictions · voice 누수·불일치 ·
 *    미완료 · 잘림 · 파싱 실패 · 사용량 미상.
 * 🔴 **완주하지 못한 검수는 절대 adopt 가 아니다.**
 *    예산이 모자랄수록 검수가 느슨해지는 구조를 만들지 않는다.
 * 🔴 adopt 는 **후보로 보낸다**는 뜻일 뿐이다. 사람 검토 없는 발행은 그대로 막혀 있다.
 */
/**
 * 🔴 **다시 물어보면 답이 달라질 수 있는 사유들.** 결론이 아니라 "못 물어봤다" 이다.
 *    🔴 `notRun` 은 **여기 없다** — 앞 단계가 왜 멈췄는지에 따라 갈린다.
 *       사유 문구(`machineReason`)에 아래 낱말이 있으면 일시 실패다.
 */
/**
 * 🔴 **이 회차 결과를 다시 시도해야 하는가 — 값 하나로 가른다.**
 *
 *    앞판은 `machineReason` 문구에서 정본 라벨을 찾았다. 문구가 바뀌면 판정이
 *    바뀌는 구조였다. 이제 `semanticCompletion.cause` **값**만 본다.
 *
 * 🔴 읽지 못한 모양은 `null` 이다 — 재시도도 결론도 아니다. 부르는 쪽이 `unknown` 으로 둔다.
 */
export function artifactRetryable(review: unknown): boolean | null {
  if (!reviewShapeOk(review)) return null
  const c = (review as { semanticCompletion: { complete: boolean; cause: IncompleteCause | null } })
    .semanticCompletion
  if (c.complete) return false
  return (RETRYABLE_CAUSES as readonly string[]).includes(c.cause ?? '')
}

export const REVIEW_WARNING_AXES = ['unsupportedAdditions', 'droppedFromSource'] as const
export type ReviewWarningAxis = (typeof REVIEW_WARNING_AXES)[number]

/**
 * 🔴 **사람이 판정할 자리 한 줄씩.** 기계가 막지 않고 넘긴 것이 무엇인지 적는다 —
 *    빈 배열이면 넘길 것이 없다는 뜻이다.
 */
export function reviewWarnings(s: SemanticVerdict | null): string[] {
  if (s === null) return []
  return [
    ...(s.unsupportedAdditions.length > 0
      ? [`원문에 없어 보이는 것 ${s.unsupportedAdditions.length}건`
        + ` — ${s.unsupportedAdditions.map((a) => a.evidence).join(' / ')}`]
      : []),
    ...(s.droppedFromSource.length > 0
      ? [`원문에서 사라져 보이는 것 ${s.droppedFromSource.length}건`
        + ` — ${s.droppedFromSource.map((a) => a.evidence).join(' / ')}`]
      : []),
  ]
}

export function judgeMachine(input: {
  deterministic: DeterministicResult
  semantic: SemanticVerdict | null
  semanticCompletion: ReviewCompletion
}): { outcome: MachineOutcome; reason: string; warnings: string[] } {
  const hard = input.deterministic.failures
  const none: string[] = []
  if (hard.some((f) => f.code === 'personalInfo' || f.code === 'bannedWord')) {
    return { outcome: 'drop', reason: DETERMINISTIC_LABEL[hard[0]!.code], warnings: none }
  }
  if (!input.deterministic.pass) {
    return {
      outcome: 'hold', warnings: none,
      reason: hard.map((f) => DETERMINISTIC_LABEL[f.code]).join(' · '),
    }
  }
  if (!input.semanticCompletion.complete) {
    return {
      outcome: 'hold', warnings: none,
      reason: `의미 검수를 완주하지 못했다 (${INCOMPLETE_LABEL[input.semanticCompletion.reason ?? 'noResponse']})`,
    }
  }
  const s = input.semantic
  if (s === null) return { outcome: 'hold', reason: '의미 판정을 읽지 못했다', warnings: none }
  if (s.issues.includes('harm')) return { outcome: 'drop', reason: '위해', warnings: none }
  /**
   * 🔴 **여기서부터가 경고다.** 근거는 이미 원문·초안에서 확인된 것뿐이고,
   *    artifact 와 사람 검토 화면에 그대로 남는다. 막지는 않는다.
   */
  const warnings = reviewWarnings(s)
  if (s.lifeContradictions.length > 0) {
    return {
      outcome: 'hold', warnings,
      reason: `생활사 모순 ${s.lifeContradictions.map((x) => x.fact).join(' · ')}`,
    }
  }
  if (s.issues.length > 0) return { outcome: 'hold', reason: s.issues.join(' · '), warnings }
  if (s.unknownIssues.length > 0) return { outcome: 'hold', reason: '우리 축이 아닌 이름만 왔다', warnings }
  return { outcome: 'adopt', reason: '', warnings }
}
