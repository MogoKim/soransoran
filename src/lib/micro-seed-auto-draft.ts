/**
 * 기계 초안 채택 판정 — 🔴 **사람의 ADOPT 를 사칭하지 않는다** (§4-AS)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AS
 *
 * AUTO_SEED 로 살아남은 소재에서 **템플릿 초안을 만들고**, 그중 하나를 고른다.
 * 초안 생성 자체는 기존 `expandSeed`(소재 사전 + 템플릿, LLM 아님)가 하고,
 * 이 파일은 **무엇을 채택할지**만 정한다.
 *
 * 🔴 **결정 값은 `AUTO_ADOPT` · `AUTO_HOLD` · `AUTO_DROP` 이다.**
 *    사람이 검수 화면에서 찍는 `ADOPT` · `SAVE` 와 한 글자도 겹치지 않는다.
 *    자동 발행(§4-AL)이 "사람이 고른 글" 이라는 전제 위에 서 있으므로,
 *    기계 채택이 같은 값으로 기록되면 **어느 글이 사람 손을 거쳤는지 알 수 없게 된다.**
 *
 * 🔴 **원천 하나당 최종 초안은 하나다.** 템플릿이 둘을 만들어도 하나만 남긴다 —
 *    같은 소재에서 나온 두 글이 연달아 나가면 결이 겹쳐 보인다(§4-AN 형제 검사와 같은 이유).
 */

export const AUTO_DRAFT_DECISIONS = ['AUTO_ADOPT', 'AUTO_HOLD', 'AUTO_DROP'] as const
export type AutoDraftDecision = (typeof AUTO_DRAFT_DECISIONS)[number]

/** 🔴 사람이 쓰는 값 — 기계가 내면 안 된다 */
export const HUMAN_DRAFT_DECISIONS = ['ADOPT', 'SAVE', 'REVISE', 'HOLD', 'DROP'] as const
export const HUMAN_DRAFT_PROVENANCE = ['human-curated', 'founder'] as const

// 🔴 v2 — 템플릿 + LLM fallback + semantic 품질 판정
// 🔴 v3 — 존댓말 · 실제 질문 검사 추가. v2 캐시와 섞이지 않는다
export const DRAFT_RULE_VERSION = 'auto-draft-v3'
/** 생성 프롬프트 판 — 반말 금지 예시를 넣으면서 올렸다 */
export const DRAFT_PROMPT_VERSION = 'draft-gen-v3'
/** 🔴 품질 판정 프롬프트 판 — **생성과 따로 센다**. 판정만 바뀔 때 생성을 다시 하지 않기 위해서다 */
export const QUALITY_PROMPT_VERSION = 'draft-quality-v2'
/** 🔴 사람 것과 겹치지 않는다. 기계가 **만든** 글이라는 표시 */
export const DRAFT_PROVENANCE = 'machine-generated'
/** 초안을 어디서 만들었나 */
export const DRAFT_SOURCES = ['template', 'llm'] as const
export type DraftSource = (typeof DRAFT_SOURCES)[number]
/** 원천 하나당 만들 초안 상한 */
export const MAX_DRAFTS_PER_SOURCE = 2

/** 🔴 원문과 이만큼 이어 붙으면 베낀 것으로 본다. 기존 상수와 같은 값이다 */
export const MAX_OVERLAP = 6

/** 🔴 제품 금지어 — CLAUDE.md 규칙. 초안에 있으면 버린다 */
export const BANNED_WORDS: readonly string[] = ['시니어', '어르신', '노인', '실버'] as const

export type DraftReason =
  | 'ok'
  | 'noDraft' | 'emptyTitle' | 'emptyBody'
  | 'safetyNotPass' | 'bannedWord' | 'overlapTooLong'
  | 'duplicateTitle' | 'duplicateBody'
  | 'titleBodyMismatch' | 'sourceAlreadyUsed'
  | 'notAutoSeed' | 'laneRisk'
  | 'repetitiveWording' | 'titleEchoedInBody' | 'genericWithoutSourceAngle'
  | 'informalSpeech' | 'missingAnswerableQuestion'
  | 'semanticUnavailable' | 'semanticHold' | 'semanticDrop' | 'lowConfidence'

export const DRAFT_REASON_LABEL: Record<DraftReason, string> = {
  ok: '통과',
  noDraft: '템플릿이 초안을 만들지 못했다 (소재를 못 찾음)',
  emptyTitle: '제목이 비었다',
  emptyBody: '본문이 비었다',
  safetyNotPass: 'safety 가 pass 가 아니다',
  bannedWord: '🔴 금지어가 들어갔다 (시니어 · 어르신 · 노인 · 실버)',
  overlapTooLong: `🔴 원문과 ${MAX_OVERLAP}자 이상 이어 붙는다 — 베낀 것이다`,
  duplicateTitle: '같은 제목이 이미 있다',
  duplicateBody: '같은 본문이 이미 있다',
  titleBodyMismatch: '🔴 제목과 본문이 서로 다른 이야기다',
  sourceAlreadyUsed: '이 원천에서 이미 하나를 골랐다',
  notAutoSeed: '🔴 AUTO_SEED 가 아니다 — 판정을 통과한 소재만 초안화한다',
  laneRisk: '🔴 연예 · 정치 · 의료 레인 위험이 남아 있다',
  repetitiveWording: '🔴 제목에서 같은 낱말이 반복된다 ("여행 가면 여행 어떻게")',
  titleEchoedInBody: '🔴 제목을 본문 끝에 그대로 되풀이한다',
  genericWithoutSourceAngle: '🔴 소재가 사라진 일반론이다',
  informalSpeech: '🔴 반말이다 — 우리 게시판은 존댓말이다',
  missingAnswerableQuestion: '🔴 본문 마지막이 물음표로 끝나지 않는다 — 답할 질문이 없다',
  semanticUnavailable: '품질 판정을 받지 못했다',
  semanticHold: '품질 판정이 사람에게 넘겼다',
  semanticDrop: '🔴 품질 판정이 버리라고 했다',
  lowConfidence: '모델이 확신하지 못했다',
}

/** 🔴 판정 단계에서 이 위험이 붙었으면 초안화하지 않는다 */
export const BLOCKING_RISKS: readonly string[] = [
  'celebrityOrBroadcast', 'politicsOrPublicFigure', 'medicalAdvice',
  'healthScheduleOrMedicalAdvice', 'hostilityOrConflictBait', 'personalSpecificity',
] as const

export type DraftCandidate = {
  sourceArticleId: string
  draftNo: number
  title: string
  body: string
  safetyVerdict: string
  overlap: number
  generatedAt: string
}

export type Judgement = {
  sourceArticleId: string
  decision: string
  semanticRisks?: readonly string[]
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 공백을 지운 비교용 문자열 — 같은 글을 띄어쓰기만 바꿔 두 번 내지 않는다 */
export function normalize(s: string): string {
  return S(s).replace(/\s+/g, '')
}

/**
 * 제목과 본문이 같은 이야기인가 — 🔴 **템플릿이 어긋나게 조합될 수 있다.**
 *
 * 소재 낱말이 제목에만 있고 본문에 없으면, 읽는 사람은 "제목과 다른 글" 로 느낀다.
 * 완벽한 판정은 못 하지만 **소재 낱말이 양쪽에 다 있는지**는 볼 수 있다.
 */
export function titleMatchesBody(title: string, body: string, material: string): boolean {
  const m = normalize(material)
  // 🔴 **소재를 모르면 통과가 아니다.** v1 은 여기서 `true` 를 돌려줬는데,
  //    그건 "검사를 안 한다" 가 아니라 "검사를 통과했다" 가 되어 버렸다.
  //    소재를 모르는 글은 semantic 품질 판정을 받아야 한다 — 여기서 통과시키지 않는다.
  if (m === '') return false
  return normalize(title).includes(m) && normalize(body).includes(m)
}

/** 낱말로 쪼갠다 — 조사·기호를 떼고 2자 이상만 본다 */
export function words(s: string): string[] {
  return S(s)
    .replace(/[?!.,~…"'"'()\[\]]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/(을|를|이|가|은|는|에|에서|으로|로|와|과|도|만|의)$/, ''))
    .filter((w) => w.length >= 2)
}

/**
 * 🔴 **제목에서 같은 낱말이 되풀이되는가.**
 *
 * 2026-09-07 에 템플릿이 "여행 가면 여행 어떻게 고르세요?" 를 만들었다.
 * 소재 낱말이 템플릿 자리 둘에 동시에 들어가면 이렇게 된다.
 * 사람은 한 번 보면 아는데 기계는 안 막으면 그대로 내보낸다.
 */
export function hasRepetitiveWording(title: string): boolean {
  const ws = words(title)
  const seen = new Map<string, number>()
  for (const w of ws) seen.set(w, (seen.get(w) ?? 0) + 1)
  return [...seen.values()].some((n) => n >= 2)
}

/**
 * 🔴 **제목을 본문 끝에 그대로 되풀이하는가.**
 *
 * 템플릿이 "…? 다들 어떠세요?" 처럼 제목을 본문 마지막에 붙이면
 * 같은 문장을 두 번 읽게 된다.
 */
export function echoesTitleAtEnd(title: string, body: string): boolean {
  const t = normalize(title).replace(/[?!.]$/, '')
  if (t.length < 6) return false
  const tail = normalize(body).slice(-Math.max(t.length + 10, 20))
  return tail.includes(t)
}

/**
 * 따옴표 안을 지운다 — 🔴 **인용문은 반말이어도 된다.**
 *
 * "내 단점을 솔직하게 말해 줄 수 있어?" 처럼 남이 한 말을 옮긴 것은
 * 글쓴이가 반말을 쓴 것이 아니다.
 */
export function stripQuoted(text: string): string {
  return S(text)
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/「[^」]*」/g, ' ')
}

/** 문장으로 쪼갠다 — 종결부호와 줄바꿈 기준 */
export function sentences(text: string): string[] {
  return stripQuoted(text)
    .split(/[.!?。\n]+/)
    .map((x) => x.trim())
    .filter((x) => x !== '')
}

/**
 * 🔴 **존댓말 종결인가.**
 *
 * 우리 게시판은 존댓말이다. 2026-09-07 에 반말 초안 3건이 통과했다 —
 * "신기하네" · "말이야" · "몰라" · "영향을 주는 걸까?".
 * 모델에게 문체를 일러도 원문 말투를 따라간다. 그래서 기계가 직접 잰다.
 */
export function isPoliteEnding(sentence: string): boolean {
  const t = sentence.trim().replace(/[~…\s]+$/, '')
  if (t === '') return true
  return /(요|죠|니다|랍니다|습니다|십시오|세요|어요|아요|네요|가요|까요|은가요|나요|더라고요|거든요)$/.test(t)
}

/**
 * 🔴 **본문에 사람에게 직접 하는 반말이 있는가.**
 *
 * 제목은 명사형("돌담 아래서 마신 맥주")이 자연스러우므로 제목은 보지 않는다.
 * 본문 문장 중 하나라도 존댓말 종결이 아니면 반말로 본다 — 보수적으로 잡는다.
 */
export function hasInformalSpeech(body: string): boolean {
  const ss = sentences(body)
  if (ss.length === 0) return false
  return ss.some((x) => !isPoliteEnding(x))
}

/**
 * 🔴 **본문 마지막에 답할 질문이 있는가.**
 *
 * 이 레인의 계약은 "본문 마지막에 답하기 쉬운 질문 하나" 다.
 * `intendedQuestion` 필드가 있다고 본문에 질문이 있는 것이 아니다 —
 * 448113 은 그 필드만 있고 본문은 회고뿐이었다.
 */
export function endsWithQuestion(body: string): boolean {
  const t = S(body).replace(/[\s]+$/, '')
  if (t === '') return false
  // 🔴 **물음표를 요구한다.** "궁금해요." 는 완곡한 표현이지 질문이 아니다 —
  //    2026-09-07 에 그 글이 통과했고, 읽는 사람은 무엇을 답해야 할지 알 수 없었다.
  //    이 레인의 계약은 "마지막에 답하기 쉬운 **질문** 하나" 다.
  const q = t.lastIndexOf('?')
  if (q < 0) return false
  // 물음표 뒤에 남은 것이 마침표·따옴표 정도면 마지막 문장이 질문이다
  return /^["'"'.\s]*$/.test(t.slice(q + 1))
}

/** 원문과 가장 길게 이어 붙는 조각 — 🔴 기존 `longestOverlap` 과 같은 뜻이다 */
export function overlapOk(overlap: number): boolean {
  return overlap < MAX_OVERLAP
}

export function hasBannedWord(text: string): boolean {
  return BANNED_WORDS.some((w) => text.includes(w))
}

/** 🔴 초안 품질 축 — auto-judge 의 위험 축과 **분리돼 있다** (거기는 소재, 여기는 글) */
export const DRAFT_QUALITY_AXES = [
  'informalSpeech',
  'naturalKorean',
  'titleBodyCoherence',
  'communityFit4050',
  'answerableQuestion',
  'repetitiveWording',
  'genericWithoutSourceAngle',
  'medicalOrConflictRisk',
] as const
export type DraftQualityAxis = (typeof DRAFT_QUALITY_AXES)[number]

/** 🔴 이게 붙으면 버린다 */
export const QUALITY_DROP: readonly DraftQualityAxis[] = ['medicalOrConflictRisk'] as const
/** 🟡 이게 붙으면 사람에게 넘긴다 — 글이 나빴을 뿐 소재는 살아 있다 */
export const QUALITY_HOLD: readonly DraftQualityAxis[] = [
  // 🔴 informalSpeech 가 맨 앞이다 — 2026-09-07 에 반말 3건이 통과했다
  'informalSpeech',
  'naturalKorean', 'titleBodyCoherence', 'communityFit4050',
  'answerableQuestion', 'repetitiveWording', 'genericWithoutSourceAngle',
] as const

export const DRAFT_MIN_CONFIDENCE = 0.7

export type DraftQualityVerdict = {
  decision: AutoDraftDecision
  confidence: number
  issues: DraftQualityAxis[]
}

/**
 * 모델 응답을 읽는다 — 🔴 **모르는 것은 통과가 아니다.**
 */
export function parseQuality(rawText: string): DraftQualityVerdict | null {
  let j: Record<string, unknown>
  try {
    const t = rawText.trim()
    j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
  } catch { return null }
  const d = String(j.decision ?? '')
  if (!(AUTO_DRAFT_DECISIONS as readonly string[]).includes(d)) return null
  const c = Number(j.confidence ?? NaN)
  if (!Number.isFinite(c) || c < 0 || c > 1) return null
  const raw = Array.isArray(j.issues) ? j.issues.map(String)
    : Array.isArray(j.axes) ? j.axes.map(String) : []
  const issues: DraftQualityAxis[] = []
  for (const x of raw) {
    // 🔴 모르는 축 이름은 버리지 않고 "일반론" 으로 읽는다 — 통과시키지는 않는다
    if ((DRAFT_QUALITY_AXES as readonly string[]).includes(x)) issues.push(x as DraftQualityAxis)
    else issues.push('genericWithoutSourceAngle')
  }
  return { decision: d as AutoDraftDecision, confidence: c, issues: [...new Set(issues)] }
}

/**
 * 품질 판정을 결정으로 옮긴다 — 🔴 **정책이 모델 답을 이긴다** (§4-AR 과 같은 원칙).
 *
 * 모델이 통과라 해도 축이 붙어 있으면 통과가 아니고,
 * 모델이 버리라 해도 버릴 축이 없으면 사람에게 넘긴다.
 */
export function applyQuality(v: DraftQualityVerdict | null): DraftReason {
  if (v === null) return 'semanticUnavailable'
  if (v.issues.some((x) => QUALITY_DROP.includes(x))) return 'semanticDrop'
  if (v.issues.some((x) => QUALITY_HOLD.includes(x))) return 'semanticHold'
  if (v.decision === 'AUTO_DROP' || v.decision === 'AUTO_HOLD') return 'semanticHold'
  if (v.confidence < DRAFT_MIN_CONFIDENCE) return 'lowConfidence'
  return 'ok'
}

export type PickInput = {
  judgement: Judgement
  drafts: readonly DraftCandidate[]
  material: string
  /** 이미 채택된 제목·본문 (정규화된 것) */
  seenTitles: ReadonlySet<string>
  seenBodies: ReadonlySet<string>
  /** 이미 이 원천에서 하나를 골랐는가 */
  sourceUsed: boolean
  /** 초안별 품질 판정 — 🔴 없으면 통과시키지 않는다 */
  quality?: ReadonlyMap<number, DraftQualityVerdict | null>
}

export type Pick = {
  sourceArticleId: string
  decision: AutoDraftDecision
  draftNo: number | null
  reason: DraftReason
  /** 초안별로 왜 떨어졌는지 — 조용히 사라지지 않게 */
  rejected: { draftNo: number; reason: DraftReason }[]
  ruleVersion: string
  provenance: string
  decidedAt: string
}

/**
 * 초안 하나를 고른다 — 🔴 **막는 것부터 본다. 통과가 마지막이다.**
 *
 * 🔴 판정 단계에서 붙은 위험(연예·정치·의료…)은 여기서 다시 확인한다.
 *    앞 단계가 이미 걸렀더라도, 두 파일 사이에 시간이 흐르는 동안 무엇이 바뀔지 모른다.
 */
export function pickDraft(input: PickInput, now: string): Pick {
  const id = S(input.judgement.sourceArticleId)
  const base = {
    sourceArticleId: id, ruleVersion: DRAFT_RULE_VERSION,
    provenance: DRAFT_PROVENANCE, decidedAt: now,
  }
  const no = (decision: AutoDraftDecision, reason: DraftReason): Pick =>
    ({ ...base, decision, draftNo: null, reason, rejected: [] })

  // ① 판정을 통과한 소재만 초안화한다
  if (S(input.judgement.decision) !== 'AUTO_SEED') return no('AUTO_DROP', 'notAutoSeed')
  const risks = input.judgement.semanticRisks ?? []
  if (risks.some((r) => BLOCKING_RISKS.includes(String(r)))) return no('AUTO_DROP', 'laneRisk')
  // ② 원천당 하나
  if (input.sourceUsed) return no('AUTO_HOLD', 'sourceAlreadyUsed')
  if (input.drafts.length === 0) return no('AUTO_HOLD', 'noDraft')

  const rejected: { draftNo: number; reason: DraftReason }[] = []
  // 🔴 draftNo 순으로 본다 — 입력 순서가 달라도 같은 것을 고른다
  const ordered = [...input.drafts].sort((a, b) => a.draftNo - b.draftNo)
  for (const d of ordered) {
    const why = checkDraft(d, input)
    if (why !== 'ok') { rejected.push({ draftNo: d.draftNo, reason: why }); continue }
    return { ...base, decision: 'AUTO_ADOPT', draftNo: d.draftNo, reason: 'ok', rejected }
  }
  // 🔴 전부 떨어졌다. 버리지 않고 사람에게 남긴다 — 초안이 나빴을 뿐 소재는 살아 있다
  return { ...base, decision: 'AUTO_HOLD', draftNo: null, reason: rejected[0]?.reason ?? 'noDraft', rejected }
}

/** 초안 하나가 통과하는가 — 🔴 순서가 곧 우선순위다 */
export function checkDraft(d: DraftCandidate, input: PickInput): DraftReason {
  // ── ① deterministic — 🔴 모델이 이걸 뒤집을 수 없다 ──
  if (S(d.title) === '') return 'emptyTitle'
  if (S(d.body) === '') return 'emptyBody'
  if (S(d.safetyVerdict) !== 'pass') return 'safetyNotPass'
  if (hasBannedWord(d.title) || hasBannedWord(d.body)) return 'bannedWord'
  if (!overlapOk(d.overlap)) return 'overlapTooLong'
  if (hasRepetitiveWording(d.title)) return 'repetitiveWording'
  if (echoesTitleAtEnd(d.title, d.body)) return 'titleEchoedInBody'
  // 🔴 2026-09-07 에 반말 3건 · 질문 없는 글 1건이 통과했다. 기계가 직접 잰다
  if (hasInformalSpeech(d.body)) return 'informalSpeech'
  if (!endsWithQuestion(d.body)) return 'missingAnswerableQuestion'
  if (input.seenTitles.has(normalize(d.title))) return 'duplicateTitle'
  if (input.seenBodies.has(normalize(d.body))) return 'duplicateBody'

  // ── ② 소재를 아는 경우에만 낱말 일치를 본다 ──
  //    🔴 모르면 통과가 아니라 semantic 판정으로 넘어간다(아래). 여기서 true 를 주지 않는다
  if (S(input.material) !== '' && !titleMatchesBody(d.title, d.body, input.material)) {
    return 'titleBodyMismatch'
  }

  // ── ③ semantic 품질 — 🔴 판정을 못 받았으면 통과가 아니다 ──
  if (input.quality === undefined) return 'semanticUnavailable'
  return applyQuality(input.quality.get(d.draftNo) ?? null)
}

/** 🔴 기록 직전 관문 — 사람 값을 사칭하지 않았는지 */
export function violatesDraftProvenance(row: Record<string, unknown>): string[] {
  const bad: string[] = []
  const d = String(row.decision ?? '')
  if (!(AUTO_DRAFT_DECISIONS as readonly string[]).includes(d)) {
    bad.push(`🔴 decision ${d} 은 AUTO_ 값이 아니다`)
  }
  if ((HUMAN_DRAFT_DECISIONS as readonly string[]).includes(d)) {
    bad.push(`🔴 decision ${d} 은 사람이 쓰는 값이다 — 사칭이다`)
  }
  const p = String(row.provenance ?? '')
  if ((HUMAN_DRAFT_PROVENANCE as readonly string[]).includes(p) && p !== DRAFT_PROVENANCE) {
    bad.push(`🔴 provenance ${p} 은 사람 것이다`)
  }
  if (p !== DRAFT_PROVENANCE) bad.push(`🔴 provenance 가 ${DRAFT_PROVENANCE} 가 아니다`)
  for (const k of ['ruleVersion', 'decidedAt', 'sourceArticleId'] as const) {
    if (String(row[k] ?? '') === '') bad.push(`🔴 ${k} 가 비었다`)
  }
  return bad
}

export type DraftSummary = {
  total: number
  AUTO_ADOPT: number
  AUTO_HOLD: number
  AUTO_DROP: number
  byReason: Record<string, number>
}

export function summarizeDrafts(picks: readonly Pick[]): DraftSummary {
  const byReason: Record<string, number> = {}
  for (const p of picks) {
    byReason[p.reason] = (byReason[p.reason] ?? 0) + 1
    for (const r of p.rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1
  }
  return {
    total: picks.length,
    AUTO_ADOPT: picks.filter((p) => p.decision === 'AUTO_ADOPT').length,
    AUTO_HOLD: picks.filter((p) => p.decision === 'AUTO_HOLD').length,
    AUTO_DROP: picks.filter((p) => p.decision === 'AUTO_DROP').length,
    byReason,
  }
}
