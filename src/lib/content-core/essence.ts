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
  | 'notInEvidence' | 'personalInfo' | 'empty' | 'unknownKind' | 'notAtomic' | 'unknownRef'

export const DROP_REASON_LABEL: Readonly<Record<DropReason, string>> = {
  notInEvidence: '지목한 자리에 그 말이 없다',
  personalInfo: '개인정보다',
  empty: '비어 있다',
  unknownKind: '우리 종류가 아니다',
  notAtomic: '문장·절·질문이다 — 글자 그대로 지킬 원자적 사실이 아니다',
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
 * 🔴 **원자적인가** — 문장·절·질문을 글자 그대로 지키라고 하면 복제가 된다.
 *
 *    셋 중 하나라도 걸리면 원자적이지 않다:
 *      ① 문장 부호(`. ? ! …`)가 있다  ② 줄이 바뀐다  ③ 서술 어미로 끝난다
 *    🔴 글자 수로 재지 않는다. 사전도 쓰지 않는다.
 */
const PREDICATE_TAIL_RE = /(?:요|다|죠|네|까|군|거든|는데|니까|어요|아요|습니다|잖아)$/

export function isAtomicFact(text: string): boolean {
  const t = text.trim()
  if (t === '') return false
  if (/[.!?…]/.test(t)) return false
  if (/[\r\n]/.test(t)) return false
  if (PREDICATE_TAIL_RE.test(t)) return false
  return true
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
  if (PRESENCE_FACTS.includes(fact)) return v === '있음'
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

  // ── protectedFacts — 원자적 사실만 ──
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
    if (!isAtomicFact(text)) { dropped.push({ text, why: 'notAtomic' }); continue }
    const ref = S(o.evidenceRef)
    if (!(EVIDENCE_REFS as readonly string[]).includes(ref)) {
      dropped.push({ text, why: 'unknownRef' }); continue
    }
    if (!foundInSpan(text, ref as EvidenceRef, spans)) {
      dropped.push({ text, why: 'notInEvidence' }); continue
    }
    facts.push({ kind: kind as ProtectedFactKind, text, evidenceRef: ref as EvidenceRef })
  }

  // ── sourceBeats — 의미. evidenceText 는 검증 전용 ──
  const beats: SourceBeat[] = []
  for (const x of arr(j.sourceBeats)) {
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
    beats.push({ kind: kind as BeatKind, meaning, evidenceRef: ref as EvidenceRef, evidenceText })
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
