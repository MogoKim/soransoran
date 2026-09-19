/**
 * SourceEssence — 🔴 **원문에 실제로 있던 것만 적는 sparse 구조**
 *
 * 🔴 **모든 칸을 채우지 않는다.** 갈등이 없는 글에는 갈등이 없고, 묻지 않는 글은
 *    묻지 않는다. 없는 것을 `null`·빈 목록으로 두는 것이 이 구조의 요점이다.
 *
 * 🔴 **보존 책임을 둘로 나눈다** (2026-09-19 실측 보정).
 *    앞판은 `anchor` 하나가 "글자 그대로"와 "의미"를 겸했다. 그래서 모델이
 *    **원문 문장 전체**를 `exact` 로 지정했고, 생성이 그대로 옮겨 적어
 *    3편 중 2편이 복제로 막혔다.
 *      · `protectedFacts` — 글자 자체를 지켜야 하는 **원자적 사실**만
 *      · `sourceBeats`   — 지켜야 하는 **의미**. 원문 문장은 생성에 보내지 않는다
 */
import type { EvidenceSpan, SourceEvidencePacket } from './evidence'
import type { ContextSufficiency, InsufficientReason } from './evidence'

export const ESSENCE_VERSION = 'essence-v2'

/** 어디서 왔는가 — 🔴 그 자리에 그 글자가 있어야 한다 */
export const EVIDENCE_REFS = ['title', 'head', 'tail'] as const
export type EvidenceRef = (typeof EVIDENCE_REFS)[number]

/**
 * 글자 자체를 지켜야 하는 **원자적 사실** — 🔴 문장·절·감정 표현·질문은 될 수 없다.
 *
 *    숫자+단위(`9명`) · 공개 프로그램·상품·장소 이름(`나는솔로`) · 관계(`시어머니`) ·
 *    검색 가치가 있는 핵심 용어(`갱년기`). 바꾸면 무슨 이야기인지 알 수 없어지는 것만이다.
 */
export const PROTECTED_FACT_KINDS = ['number', 'publicEntity', 'relation', 'searchTerm'] as const
export type ProtectedFactKind = (typeof PROTECTED_FACT_KINDS)[number]

export type ProtectedFact = {
  kind: ProtectedFactKind
  text: string
  evidenceRef: EvidenceRef
}

/** 지켜야 하는 **의미** — 🔴 `evidenceText` 는 검증용이고 생성에 보내지 않는다 */
export const BEAT_KINDS = ['situation', 'contrast', 'emotion', 'participation'] as const
export type BeatKind = (typeof BEAT_KINDS)[number]

export type SourceBeat = {
  /**
   * 🔴 **안정적인 이름** — 검수가 "어느 결이 사라졌는가" 를 가리킬 수 있게 한다
   *    (2026-09-19 보정). 앞판은 결에 이름이 없어서, 검수가 누락을 말하려면
   *    **원문 문구를 다시 써야** 했고 그 근거는 초안에 없으니 인정할 수 없었다.
   */
  id: string
  kind: BeatKind
  /** 🔴 생성이 받는 것은 이것뿐이다 — 원문 표현이 아니라 뜻이다 */
  meaning: string
  evidenceRef: EvidenceRef
  /** 🔴 검증 전용. 생성 payload 에 넣지 않는다 */
  evidenceText: string
}

export const CLOSING_INTENTS = ['ask', 'vent', 'share', 'none'] as const
export type ClosingIntent = (typeof CLOSING_INTENTS)[number]

export const TIME_SENSITIVITIES = ['evergreen', 'timeBound', 'unknown'] as const
export type TimeSensitivity = (typeof TIME_SENSITIVITIES)[number]

/** 이 글이 우리 게시판에서 하는 일 — 🔴 검수 기준이 여기에 따라 달라진다 */
export const CONTENT_ROLES = [
  'discoveryAnchor', 'conversationSpark', 'experienceResonance', 'usefulAnswer',
] as const
export type ContentRole = (typeof CONTENT_ROLES)[number]

export const CLAIM_FACTS = [
  'spouse', 'children', 'childAgeBand', 'parentCare', 'menopause', 'work', 'region', 'age',
] as const
export type ClaimFact = (typeof CLAIM_FACTS)[number]

export const CLAIM_FACT_LABEL: Readonly<Record<ClaimFact, string>> = {
  spouse: '현재 배우자', children: '자녀', childAgeBand: '자녀 나이대',
  parentCare: '부모 돌봄', menopause: '갱년기', work: '지금 하는 일',
  region: '사는 곳', age: '나이대',
}

/**
 * 1인칭으로 주장하려면 글쓴이에게 있어야 하는 사실.
 *
 * 🔴 **자유 문장을 자격 판정에 쓰지 않는다** (2026-09-19 실측 보정).
 *    앞판은 `detail` 한 칸이 사람 설명과 matcher 값을 겸했다. 그래서
 *    *"자녀 없이 주변 관찰로 쓴 글"* 이라는 **관점 설명**이 자녀 자격값으로 쓰였고,
 *    자녀 1명인 Persona 가 `SELF_EXPERIENCE` 로 갔다.
 *      · `requiredValue` — Persona 카드 값과 **그대로 견줄 수 있는 정규 값**
 *      · `selfClaim`     — 사람이 읽는 설명. matcher 는 보지 않는다
 */
export type ClaimRequirement = {
  /** 🔴 검수가 위반을 가리킬 수 있게 하는 식별자 */
  id: string
  fact: ClaimFact
  /** 🔴 카드 값과 견줄 정규 값 — 예: `있음` · `파트타임` · `수도권` · `중고등` */
  requiredValue: string
  /** 사람이 읽는 설명 — 🔴 자격 판정에 쓰지 않는다 */
  selfClaim: string
  stanceShiftable: boolean
  evidenceRef: EvidenceRef
  evidenceText: string
}

export type SourceEssence = {
  contextSufficiency: ContextSufficiency
  insufficientReasons: InsufficientReason[]
  coreMoment: string | null
  protectedFacts: ProtectedFact[]
  sourceBeats: SourceBeat[]
  participationHook: string | null
  participationConfidence: number | null
  closingIntent: ClosingIntent | null
  timeSensitivity: TimeSensitivity
  contentRoles: ContentRole[]
  claimRequirements: ClaimRequirement[]
  essenceVersion: string
}

export type DropReason =
  | 'notInEvidence' | 'personalInfo' | 'empty' | 'unknownKind' | 'unknownRef'
  /** 그 kind 로 증명할 수 있는 모양이 아니다 */
  | 'notProvable'
  /** 문장·절일 수 있어 글자를 강제할 수 없다 — 🔴 다른 칸으로 옮기지 않고 버린다 */
  | 'clauseLike'

export const DROP_REASON_LABEL: Readonly<Record<DropReason, string>> = {
  notInEvidence: '지목한 자리에 그 말이 없다',
  personalInfo: '개인정보다',
  empty: '비어 있다',
  unknownKind: '우리 종류가 아니다',
  notProvable: '그 종류로 증명할 수 있는 모양이 아니다 — 글자 그대로 지키라고 할 수 없다',
  clauseLike: '문장·절일 수 있다 — 🔴 원문 문구를 다른 칸으로 옮기지 않고 버린다',
  unknownRef: '어디서 왔는지 지목하지 못했다',
}

export type EssenceParse = {
  essence: SourceEssence | null
  dropped: { text: string; why: DropReason }[]
  schemaProblems: string[]
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** 🔴 **공백·줄바꿈 차이만 지운다.** 그 밖의 정규화는 하지 않는다 */
export function normalizeForProvenance(s: string): string {
  return s.replace(/\s+/g, '')
}

const PII_RE = /\[링크\]|\[메일\]|\[연락처\]|\[계정\]|https?:\/\/|[\w.+-]+@[\w-]+\.[\w.]+|\b01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}\b|\b\d{2,4}[-.\s]\d{3,4}[-.\s]\d{4}\b|@[A-Za-z0-9_]{2,}|\d+동\s*\d+호/

export function isPersonalInfo(text: string): boolean {
  return PII_RE.test(text)
}

/** 지목한 span 에 그 말이 있는가 — 🔴 공백·줄바꿈만 무시한다 */
export function foundInSpan(text: string, ref: EvidenceRef, spans: readonly EvidenceSpan[]): boolean {
  const span = spans.find((x) => x.kind === ref)
  if (span === undefined) return false
  return normalizeForProvenance(span.text).includes(normalizeForProvenance(text))
}

/**
 * 🔴 **kind 마다 "증명할 수 있는 것"만 받는다** (2026-09-19 실측 보정).
 *
 *    앞판은 서술 어미 목록으로 걸렀다. 그래서 *"남편이 집안일을 거의 돕지 않아서"* ·
 *    *"아들을 낳으면 안쓰럽게 보는 시선"* 이 **원자적 사실로 통과했다.**
 *    어미를 계속 추가하는 것은 땜질이다 — 대신 **kind 별로 확정할 수 있는 모양**만 받는다.
 */

/** 🔴 숫자 + 단위. 구조로 확정할 수 있다 — `9명` · `3시간` · `1200원` · `2주` */
const NUMBER_FACT_RE = /^\d{1,6}(?:[.,]\d{1,3})?\s?[가-힣A-Za-z%°]{0,4}$/

/**
 * 🔴 **허용된 관계 명칭** — 열거다. 유사도 사전이 아니다.
 *    v1 의 관계 정규식(`SPOUSE_RE` 등)은 module-private 이고, v1 파일은
 *    origin/main 과 0줄이어야 하므로 export 하지 않는다. 그래서 여기 한 벌 둔다.
 */
export const RELATION_NAMES: readonly string[] = [
  '남편', '신랑', '애들아빠', '아이아빠', '아내', '와이프',
  '시어머니', '시아버지', '시댁', '시누이', '친정', '장인', '장모', '처가',
  '아들', '딸', '애들', '아이들', '큰애', '작은애', '자식', '며느리', '사위', '손주',
  '엄마', '아빠', '부모님', '언니', '오빠', '누나', '형', '동생', '올케', '형님', '동서',
]

/** 문장·절인 것이 **확실한가** — 확실할 때만 낮춘다 */
export function looksLikeClause(text: string): boolean {
  const t = text.trim()
  return /[.!?…]/.test(t) || /[\r\n]/.test(t) || /\s/.test(t)
}

/**
 * 🔴 **증명하지 못하면 버린다. 다른 칸으로 옮기지 않는다** (2026-09-19 보정).
 *
 *    앞판은 문장으로 보이는 값을 `sourceBeat.meaning` 으로 **낮춰서** 남겼다.
 *    그런데 `meaning` 은 생성 프롬프트로 간다 — 그래서 *"왜 저희 애아빠는 안그럴까요"*
 *    같은 **원문 문구가 생성에 그대로 전달됐다.** "생성에 원문 조각을 보내지 않는다"
 *    계약을 내가 깬 것이다.
 *    🔴 같은 뜻이 필요하면 **모델이 따로 정리해 낸 `sourceBeats`** 만 쓴다.
 *       원문 문장을 자동으로 되살리지 않는다.
 */
export type FactVerdict =
  | { ok: true }
  /** 그 kind 로 확정할 수 있는 모양이 아니다 */
  | { ok: false; why: 'notProvable' }
  /** 문장·절일 수 있다 — 글자를 강제할 수 없다 */
  | { ok: false; why: 'clauseLike' }

/**
 * 🔴 이 값을 **글자 그대로 지키라고 해도 되는가.**
 *    긴 문구를 글자 그대로 쓰게 하면 그것이 곧 복제다.
 */
export function judgeProtectedFact(kind: ProtectedFactKind, text: string): FactVerdict {
  const t = text.trim()
  if (t === '') return { ok: false, why: 'notProvable' }
  switch (kind) {
    // 🔴 구조로 확정된다
    case 'number': return NUMBER_FACT_RE.test(t) ? { ok: true } : { ok: false, why: 'notProvable' }
    // 🔴 정본 목록에 있는 이름만
    case 'relation': return RELATION_NAMES.includes(t) ? { ok: true } : { ok: false, why: 'notProvable' }
    /**
     * 🔴 공개 이름 · 검색 용어는 **확정할 방법이 없다.** 문장·절이 아님이 확실할 때만
     *    글자를 강제하고, 아니면 **버린다** — 다른 칸으로 옮기지 않는다.
     */
    case 'publicEntity':
    case 'searchTerm':
      return looksLikeClause(t) ? { ok: false, why: 'clauseLike' } : { ok: true }
    default: return { ok: false, why: 'notProvable' }
  }
}

/**
 * 🔴 **Persona 카드가 실제로 가진 값들.** 여기서 어휘를 지어내지 않는다 —
 *    부르는 쪽이 정본 카드에서 읽어 넘긴다.
 */
export type ClaimVocabulary = {
  work: readonly string[]
  region: readonly string[]
  age: readonly string[]
  childAgeBand: readonly string[]
}

/** 있음/없음으로만 판정하는 축 */
const PRESENCE_FACTS: readonly ClaimFact[] = ['spouse', 'children', 'parentCare', 'menopause']

/**
 * 🔴 **`없음` 을 자격값으로 받는 축** (2026-09-19 실측 보정).
 *
 *    원문이 *"전 아직 자녀는 없지만"* 이라 모델이 `children="없음"` 을 냈고,
 *    앞판은 presence 축에서 `있음` 만 받아 **초안을 한 편도 만들지 못했다.**
 *    카드에 `childrenCount = 0` 이라는 **판정할 수 있는 값이 실제로 있는** 축이므로
 *    자격을 견줄 수 있다.
 *
 * 🔴 **나머지 presence 축에 기계적으로 `없음` 을 붙이지 않는다.**
 *    `spouse="없음"` (비혼·사별·이혼이 한 값으로 뭉갠다) · `parentCare="없음"` ·
 *    `menopause="없음"` 은 카드 값과 무엇을 견줄지가 이번에 확인되지 않았다.
 *    확인된 축만 고친다.
 */
const ABSENCE_ALLOWED_FACTS: readonly ClaimFact[] = ['children']

/**
 * 🔴 **자격 판정에 쓸 수 있는 값인가.**
 *
 *    앞판은 **비어 있지만 않으면** 통과시켰다. 그래서
 *    *"자녀 없이 주변 관찰로 쓴 글"* 이라는 **관점 설명**이 자녀 자격값이 됐다.
 *    이제 **카드가 실제로 가진 값**이어야 한다.
 */
export function claimValueAllowed(
  fact: ClaimFact, requiredValue: string, vocab: ClaimVocabulary,
): boolean {
  const v = requiredValue.trim()
  if (v === '') return false
  if (PRESENCE_FACTS.includes(fact)) {
    return v === '있음' || (v === '없음' && ABSENCE_ALLOWED_FACTS.includes(fact))
  }
  if (fact === 'work') return vocab.work.includes(v)
  if (fact === 'region') return vocab.region.includes(v)
  if (fact === 'age') return vocab.age.includes(v)
  if (fact === 'childAgeBand') return vocab.childAgeBand.includes(v)
  return false
}

export function parseEssence(
  raw: string, packet: SourceEvidencePacket, vocab: ClaimVocabulary,
): EssenceParse {
  let j: Record<string, unknown>
  try {
    const t = raw.trim()
    j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
  } catch {
    return { essence: null, dropped: [], schemaProblems: ['JSON 이 아니다'] }
  }
  const problems: string[] = []
  const dropped: { text: string; why: DropReason }[] = []
  const spans = packet.spans

  // ── protectedFacts — 증명 가능한 것만. 나머지는 사유만 남기고 버린다 ──
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
    if (!verdict.ok) {
      /**
       * 🔴 **사유만 남기고 버린다.** `sourceBeat.meaning` 으로 옮기지 않는다 —
       *    그 칸은 생성 프롬프트로 가고, 옮기는 순간 원문 문구가 생성에 전달된다.
       */
      dropped.push({ text, why: verdict.why })
      continue
    }
    facts.push({ kind: kind as ProtectedFactKind, text, evidenceRef: ref as EvidenceRef })
  }

  // ── sourceBeats — 의미. evidenceText 는 검증 전용 ──
  const beats: SourceBeat[] = []
  const usedBeatIds = new Set<string>()
  for (const [bi, x] of arr(j.sourceBeats).entries()) {
    const o = x as Record<string, unknown>
    const meaning = S(o.meaning)
    const evidenceText = S(o.evidenceText)
    if (meaning === '' || evidenceText === '') { dropped.push({ text: meaning, why: 'empty' }); continue }
    const kind = S(o.kind)
    if (!(BEAT_KINDS as readonly string[]).includes(kind)) {
      dropped.push({ text: meaning, why: 'unknownKind' }); continue
    }
    if (isPersonalInfo(meaning) || isPersonalInfo(evidenceText)) {
      dropped.push({ text: meaning, why: 'personalInfo' }); continue
    }
    const ref = S(o.evidenceRef)
    if (!(EVIDENCE_REFS as readonly string[]).includes(ref)) {
      dropped.push({ text: meaning, why: 'unknownRef' }); continue
    }
    if (!foundInSpan(evidenceText, ref as EvidenceRef, spans)) {
      dropped.push({ text: meaning, why: 'notInEvidence' }); continue
    }
    /**
     * 🔴 **이름은 우리가 정한다.** 모델이 준 이름이 비었거나 겹치면 자리 번호로 바꾼다 —
     *    겹친 이름은 "어느 결이 사라졌는지" 를 가리키지 못한다.
     */
    const given = S(o.id)
    const id = given !== '' && !usedBeatIds.has(given) ? given : `b${bi + 1}`
    if (usedBeatIds.has(id)) { dropped.push({ text: meaning, why: 'empty' }); continue }
    usedBeatIds.add(id)
    beats.push({ id, kind: kind as BeatKind, meaning, evidenceRef: ref as EvidenceRef, evidenceText })
  }

  const roles: ContentRole[] = []
  for (const r of arr(j.contentRoles)) {
    const v = S(r)
    if ((CONTENT_ROLES as readonly string[]).includes(v)) roles.push(v as ContentRole)
    else problems.push(`모르는 contentRole "${v}"`)
  }

  const claims: ClaimRequirement[] = []
  for (const [i, c] of arr(j.claimRequirements).entries()) {
    const o = c as Record<string, unknown>
    const fact = S(o.fact)
    const requiredValue = S(o.requiredValue)
    if (!(CLAIM_FACTS as readonly string[]).includes(fact)) {
      problems.push(`claim "${fact || '(이름 없음)'}" 는 우리 축이 아니다`)
      continue
    }
    if (!claimValueAllowed(fact as ClaimFact, requiredValue, vocab)) {
      problems.push(
        `claim "${fact}" 의 requiredValue "${requiredValue}" 는 카드가 가진 값이 아니다`
        + ' — 자격을 판정할 수 없다',
      )
      continue
    }
    const ref = S(o.evidenceRef)
    const evidenceText = S(o.evidenceText)
    if (!(EVIDENCE_REFS as readonly string[]).includes(ref)
      || evidenceText === '' || !foundInSpan(evidenceText, ref as EvidenceRef, spans)) {
      problems.push(`claim "${fact}" 이 원문 근거를 지목하지 못했다`)
      continue
    }
    claims.push({
      id: S(o.id) === '' ? `c${i + 1}` : S(o.id),
      fact: fact as ClaimFact,
      requiredValue,
      selfClaim: S(o.selfClaim),
      // 🔴 모르면 바꿀 수 없는 것으로 본다
      stanceShiftable: o.stanceShiftable === true,
      evidenceRef: ref as EvidenceRef,
      evidenceText,
    })
  }

  const conf = Number(j.participationConfidence ?? NaN)
  const closing = S(j.closingIntent)
  const time = S(j.timeSensitivity)

  return {
    essence: {
      // 🔴 근거 묶음이 이미 내린 판정이 우선이다 — 모델이 뒤집지 못한다
      contextSufficiency: packet.contextSufficiency,
      insufficientReasons: packet.insufficientReasons,
      coreMoment: S(j.coreMoment) === '' ? null : S(j.coreMoment),
      protectedFacts: facts,
      sourceBeats: beats,
      participationHook: S(j.participationHook) === '' ? null : S(j.participationHook),
      participationConfidence: Number.isFinite(conf) && conf >= 0 && conf <= 1 ? conf : null,
      closingIntent: (CLOSING_INTENTS as readonly string[]).includes(closing) ? (closing as ClosingIntent) : null,
      timeSensitivity: (TIME_SENSITIVITIES as readonly string[]).includes(time) ? (time as TimeSensitivity) : 'unknown',
      contentRoles: [...new Set(roles)],
      claimRequirements: claims,
      essenceVersion: ESSENCE_VERSION,
    },
    dropped,
    schemaProblems: problems,
  }
}

/**
 * 🔴 생성해도 되는가 — 확인 못 한 글은 만들지 않는다.
 *    🔴 자격을 판정할 수 없는 claim 이 하나라도 있으면 만들지 않는다.
 */
export function canGenerate(
  e: SourceEssence | null, schemaProblems: readonly string[] = [],
): { ok: boolean; why: string } {
  if (e === null) return { ok: false, why: '판정을 읽지 못했다' }
  const claimProblem = schemaProblems.find((x) => x.startsWith('claim '))
  if (claimProblem !== undefined) return { ok: false, why: claimProblem }
  if (e.contextSufficiency === 'insufficient') {
    return { ok: false, why: `무슨 이야기인지 확인하지 못했다 (${e.insufficientReasons.join('·')})` }
  }
  if (e.coreMoment === null) return { ok: false, why: '무슨 이야기인지 한 줄도 나오지 않았다' }
  return { ok: true, why: '' }
}

/** 🔴 초안에 글자 그대로 남아야 하는 것 */
export function missingProtectedFacts(e: SourceEssence, draftText: string): string[] {
  const d = normalizeForProvenance(draftText)
  return e.protectedFacts.filter((f) => !d.includes(normalizeForProvenance(f.text))).map((f) => f.text)
}
