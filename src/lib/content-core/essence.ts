/**
 * SourceEssence — 🔴 **화자 자격을 정하기 위한 판정.** 생성의 재료가 아니다.
 *
 * 🔴 **왜 좁혔나** (2026-09-19, 세 번의 유료 실측 뒤).
 *
 *    앞판은 이 구조가 **생성이 보는 유일한 진실**이었다. 생성 모델은 원문을 보지 못하고
 *    여기 적힌 `coreMoment` 와 `sourceBeats` 만 받았다. 복제를 막으려고 원문을 숨긴 것인데,
 *    그 대가가 컸다:
 *      · 원문의 *"안쓰럽게"* 가 세 번 연속 다른 뜻으로 바뀌었다
 *        ("덜 쓸모 있다" → "덜 소중하게" → "덜 바라는")
 *      · B 는 `sourceBeats` 가 **0개**로 나왔고, 생성은 빈자리를 **새 장면으로 채웠다**
 *      · 사후 검수와 호출만 늘고 사람 READY 는 0/3 이었다
 *
 * 🔴 **이제 생성은 마스킹된 원문 근거를 직접 본다.** 복제는 원문을 숨겨서가 아니라
 *    생성 지시와 `draft-originality` 의 어절·글자 연속·덮인 비율로 막는다.
 *
 * 🔴 그래서 이 파일이 남기는 것은 **생성에 건네는 뜻이 아니라**:
 *      · `claimRequirements` — 누가 1인칭으로 쓸 수 있는가 (화자 자격)
 *      · `protectedFacts`    — 글자 그대로 남아야 하는 원자적 사실 (숫자·관계·이름)
 *      · `closingIntent` · `contentRoles` — 자리를 낮출 때 무엇이 남는가
 *      · `coreMoment`        — 🔴 **사람이 목록에서 알아보는 한 줄. 생성에 가지 않는다**
 */
import type { EvidenceSpan, SourceEvidencePacket } from './evidence'
import type { ContextSufficiency, InsufficientReason } from './evidence'

export const ESSENCE_VERSION = 'essence-v3'

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

export const CLOSING_INTENTS = ['ask', 'vent', 'share', 'none'] as const
export type ClosingIntent = (typeof CLOSING_INTENTS)[number]

/** 이 글이 우리 게시판에서 하는 일 — 🔴 자리를 낮춰도 되는지가 여기에 달렸다 */
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
 * 🔴 **자유 문장을 자격 판정에 쓰지 않는다.**
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
  /** 🔴 **사람이 목록에서 알아보는 한 줄.** 생성 payload 에 넣지 않는다 */
  coreMoment: string | null
  protectedFacts: ProtectedFact[]
  closingIntent: ClosingIntent | null
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
  clauseLike: '문장·절일 수 있다 — 글자를 강제할 수 없다',
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
 * 🔴 **kind 마다 "증명할 수 있는 것"만 받는다.**
 *    서술 어미 목록으로 거르면 *"남편이 집안일을 거의 돕지 않아서"* 가 원자적 사실로 통과한다.
 */

/** 🔴 숫자 + 단위. 구조로 확정할 수 있다 — `9명` · `3시간` · `1200원` · `2주` */
const NUMBER_FACT_RE = /^\d{1,6}(?:[.,]\d{1,3})?\s?[가-힣A-Za-z%°]{0,4}$/

/**
 * 🔴 **허용된 관계 명칭** — 열거다. 유사도 사전이 아니다.
 *    v1 의 관계 정규식은 module-private 이고, v1 파일은 origin/main 과 0줄이어야 하므로
 *    export 하지 않는다. 그래서 여기 한 벌 둔다.
 */
export const RELATION_NAMES: readonly string[] = [
  '남편', '신랑', '애들아빠', '아이아빠', '아내', '와이프',
  '시어머니', '시아버지', '시댁', '시누이', '친정', '장인', '장모', '처가',
  '아들', '딸', '애들', '아이들', '큰애', '작은애', '자식', '며느리', '사위', '손주',
  '엄마', '아빠', '부모님', '언니', '오빠', '누나', '형', '동생', '올케', '형님', '동서',
]

/** 문장·절인 것이 **확실한가** — 확실할 때만 버린다 */
export function looksLikeClause(text: string): boolean {
  const t = text.trim()
  return /[.!?…]/.test(t) || /[\r\n]/.test(t) || /\s/.test(t)
}

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
 */
const ABSENCE_ALLOWED_FACTS: readonly ClaimFact[] = ['children']

/** 🔴 **자격 판정에 쓸 수 있는 값인가** — 카드가 실제로 가진 값이어야 한다 */
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
    if (!verdict.ok) { dropped.push({ text, why: verdict.why }); continue }
    facts.push({ kind: kind as ProtectedFactKind, text, evidenceRef: ref as EvidenceRef })
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

  const closing = S(j.closingIntent)

  return {
    essence: {
      // 🔴 근거 묶음이 이미 내린 판정이 우선이다 — 모델이 뒤집지 못한다
      contextSufficiency: packet.contextSufficiency,
      insufficientReasons: packet.insufficientReasons,
      coreMoment: S(j.coreMoment) === '' ? null : S(j.coreMoment),
      protectedFacts: facts,
      closingIntent: (CLOSING_INTENTS as readonly string[]).includes(closing) ? (closing as ClosingIntent) : null,
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
 *
 * 🔴 **`coreMoment` 를 조건으로 두지 않는다** (2026-09-19). 그것은 사람이 읽는 한 줄이고,
 *    생성은 원문 근거를 직접 본다 — 요약 한 줄이 비었다고 원문이 사라지는 것이 아니다.
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
  return { ok: true, why: '' }
}

/** 🔴 초안에 글자 그대로 남아야 하는 것 */
export function missingProtectedFacts(e: SourceEssence, draftText: string): string[] {
  const d = normalizeForProvenance(draftText)
  return e.protectedFacts.filter((f) => !d.includes(normalizeForProvenance(f.text))).map((f) => f.text)
}
