/**
 * SourceEssence — 🔴 **원문에 실제로 있던 것만 적는 sparse 구조**
 *
 * 🔴 **모든 칸을 채우지 않는다.** 갈등이 없는 글에는 갈등이 없고, 묻지 않는 글은
 *    묻지 않는다. 없는 것을 `null`·빈 목록으로 두는 것이 이 구조의 요점이다 —
 *    억지로 채우면 짧은 일상글이 장문 상담문이 되고, 그것이 지금 실패의 모양이다.
 *
 * 🔴 **옛 `readSourceProfile` 의 규칙·사전·배타 분류를 정본으로 쓰지 않는다.**
 *    그쪽은 제목에서 유형을 하나 골라 긴 지시문을 만들어 낸다. 여기서는
 *    **모델이 읽은 것**을 받아 **근거가 있는 것만** 남긴다.
 *
 * 🔴 물음표 · 특정 낱말 · 숫자를 **강제하지 않는다.** 그런 규칙은 모든 글을
 *    같은 모양으로 수렴시킨다(2026-09-13 실측: 템플릿 90행이 100% 물음표 종결).
 */
import type { SourceEvidencePacket } from './evidence'
import { evidenceText, type ContextSufficiency, type InsufficientReason } from './evidence'

export const ESSENCE_VERSION = 'essence-v1'

/** 보존할 요소의 종류 — 🔴 없는 종류를 만들어 채우지 않는다 */
export const ANCHOR_KINDS = [
  'publicEntity', 'number', 'situation', 'contrast', 'emotion',
  'participationIntent', 'discoverabilityTerm', 'other',
] as const
export type AnchorKind = (typeof ANCHOR_KINDS)[number]

/** exact = 글자 그대로 남긴다 · semantic = 같은 것을 가리키면 된다 */
export const ANCHOR_PRESERVE = ['exact', 'semantic'] as const
export type AnchorPreserve = (typeof ANCHOR_PRESERVE)[number]

/** 어디서 왔는가 — 🔴 `derived` 는 원문에 그 글자가 없다는 뜻이다 */
export const EVIDENCE_REFS = ['title', 'head', 'tail', 'derived'] as const
export type EvidenceRef = (typeof EVIDENCE_REFS)[number]

export type EssenceAnchor = {
  kind: AnchorKind
  text: string
  preserve: AnchorPreserve
  evidenceRef: EvidenceRef
}

/** 원문이 어떻게 닫는가 — 🔴 `none` 은 결함이 아니다 */
export const CLOSING_INTENTS = ['ask', 'vent', 'share', 'none'] as const
export type ClosingIntent = (typeof CLOSING_INTENTS)[number]

export const TIME_SENSITIVITIES = ['evergreen', 'timeBound', 'unknown'] as const
export type TimeSensitivity = (typeof TIME_SENSITIVITIES)[number]

/**
 * 이 글이 우리 게시판에서 어떤 일을 하는가 — 🔴 **검수 기준이 여기에 따라 달라진다.**
 *    짧은 대화글을 "정보가 없다" 로, 정보글을 "묻지 않는다" 로 떨어뜨리지 않기 위해서다.
 */
export const CONTENT_ROLES = [
  'discoveryAnchor', 'conversationSpark', 'experienceResonance', 'usefulAnswer',
] as const
export type ContentRole = (typeof CONTENT_ROLES)[number]

/** 1인칭으로 주장하려면 글쓴이에게 있어야 하는 사실 */
export const CLAIM_FACTS = [
  'spouse', 'children', 'childAgeBand', 'parentCare', 'menopause', 'work', 'region', 'age',
] as const
export type ClaimFact = (typeof CLAIM_FACTS)[number]

export const CLAIM_FACT_LABEL: Readonly<Record<ClaimFact, string>> = {
  spouse: '현재 배우자', children: '자녀', childAgeBand: '자녀 나이대',
  parentCare: '부모 돌봄', menopause: '갱년기', work: '지금 하는 일',
  region: '사는 곳', age: '나이대',
}

export type ClaimRequirement = {
  fact: ClaimFact
  /** 무엇을 1인칭으로 말하게 되는가 — 한 줄 */
  detail: string
  /**
   * 🔴 **관점을 바꾸면 이 주장 없이도 쓸 수 있는가.**
   *    `false` 면 당사자 경험이 이 글의 알맹이라는 뜻이고, 그때는 사람에게 넘긴다.
   */
  stanceShiftable: boolean
}

export type SourceEssence = {
  contextSufficiency: ContextSufficiency
  insufficientReasons: InsufficientReason[]
  /** 실제로 무슨 이야기인지 — 확인 못 했으면 null */
  coreMoment: string | null
  anchors: EssenceAnchor[]
  /** 사람이 답하고 싶어지는 지점 — 없으면 null */
  participationHook: string | null
  participationConfidence: number | null
  closingIntent: ClosingIntent | null
  timeSensitivity: TimeSensitivity
  contentRoles: ContentRole[]
  claimRequirements: ClaimRequirement[]
  essenceVersion: string
}

/** 🔴 검증에서 떨어진 것 — 조용히 버리지 않고 사람이 본다 */
export type EssenceParse = {
  essence: SourceEssence | null
  droppedAnchors: { text: string; why: DropReason }[]
  schemaProblems: string[]
}

export type DropReason = 'notInEvidence' | 'personalInfo' | 'empty' | 'unknownKind' | 'derivedExact'

export const DROP_REASON_LABEL: Readonly<Record<DropReason, string>> = {
  notInEvidence: '근거로 담은 글에 없는 말이다',
  derivedExact: '원문에 없는 말을 글자 그대로 남기라고 했다 — 지어낸 것이다',
  personalInfo: '개인정보다 — anchor 가 될 수 없다',
  empty: '비어 있다',
  unknownKind: '우리 종류가 아니다',
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * 🔴 **개인정보는 anchor 가 될 수 없다.**
 *    입력은 이미 마스킹돼 있지만, 모델이 `derived` 로 지어낼 수 있다.
 *    마스킹 표식과 남은 원시 패턴을 **둘 다** 본다.
 */
const PII_RE = /\[링크\]|\[메일\]|\[연락처\]|\[계정\]|https?:\/\/|[\w.+-]+@[\w-]+\.[\w.]+|\b01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}\b|\b\d{2,4}[-.\s]\d{3,4}[-.\s]\d{4}\b|@[A-Za-z0-9_]{2,}|\d+동\s*\d+호/

export function isPersonalInfoAnchor(text: string): boolean {
  return PII_RE.test(text)
}

/**
 * 근거로 담은 글에 실제로 있는 말인가 — 🔴 **`derived` 를 통과권으로 두지 않는다.**
 *
 *    앞판은 `evidenceRef === 'derived'` 면 무조건 통과시켰다. 그러면 모델이
 *    *"직원 99명"* 을 `derived` + `exact` 로 만들어 낼 수 있고, 그 뒤 대조 검사가
 *    **없던 숫자를 초안에 넣으라고 요구**하게 된다. 지어낸 사실이 계약이 되는 길이다.
 *
 * 🔴 **exact 는 근거 span 에 글자 그대로 있어야 한다.** `derived` 는 exact 가 될 수 없다.
 * 🔴 **semantic derived** 도 어디서 나왔는지 닿는 곳이 있어야 한다 —
 *    낱말 하나도 근거에 없으면 도출이 아니라 창작이다.
 */
export function anchorGrounded(a: EssenceAnchor, evidence: string): boolean {
  if (a.preserve === 'exact') {
    // 🔴 derived + exact 는 있을 수 없다
    if (a.evidenceRef === 'derived') return false
    return evidence.includes(a.text)
  }
  // 🔴 semantic — 글자 그대로가 아니어도 되지만 **낱말 하나는 닿아야** 한다 (derived 포함)
  const words = a.text.split(/\s+/).map((w) => w.replace(/[^가-힣A-Za-z0-9]/g, '')).filter((w) => w.length >= 2)
  return words.length === 0 ? false : words.some((w) => evidence.includes(w))
}

/**
 * 모델 응답 → SourceEssence — 🔴 **근거 없는 것은 남기지 않는다.**
 *
 * 🔴 모르는 값이 오면 통째로 버리지 않고 **그 칸만** 비운다.
 *    전부 버리면 짧은 글이 계속 탈락한다.
 */
export function parseEssence(raw: string, packet: SourceEvidencePacket): EssenceParse {
  let j: Record<string, unknown>
  try {
    const t = raw.trim()
    j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
  } catch {
    return { essence: null, droppedAnchors: [], schemaProblems: ['JSON 이 아니다'] }
  }
  const problems: string[] = []
  const dropped: { text: string; why: DropReason }[] = []
  const evidence = evidenceText(packet)

  const anchors: EssenceAnchor[] = []
  for (const x of arr(j.anchors)) {
    const o = x as Record<string, unknown>
    const text = S(o.text)
    if (text === '') { dropped.push({ text: '', why: 'empty' }); continue }
    const kind = S(o.kind) as AnchorKind
    if (!(ANCHOR_KINDS as readonly string[]).includes(kind)) {
      dropped.push({ text, why: 'unknownKind' }); continue
    }
    if (isPersonalInfoAnchor(text)) { dropped.push({ text, why: 'personalInfo' }); continue }
    const preserve = (ANCHOR_PRESERVE as readonly string[]).includes(S(o.preserve))
      ? (S(o.preserve) as AnchorPreserve) : 'semantic'
    const ref = (EVIDENCE_REFS as readonly string[]).includes(S(o.evidenceRef))
      ? (S(o.evidenceRef) as EvidenceRef) : 'derived'
    const a: EssenceAnchor = { kind, text, preserve, evidenceRef: ref }
    if (!anchorGrounded(a, evidence)) {
      dropped.push({ text, why: a.preserve === 'exact' && a.evidenceRef === 'derived' ? 'derivedExact' : 'notInEvidence' })
      continue
    }
    anchors.push(a)
  }

  const roles: ContentRole[] = []
  for (const r of arr(j.contentRoles)) {
    const v = S(r)
    if ((CONTENT_ROLES as readonly string[]).includes(v)) roles.push(v as ContentRole)
    else problems.push(`모르는 contentRole "${v}"`)
  }

  const claims: ClaimRequirement[] = []
  for (const c of arr(j.claimRequirements)) {
    const o = c as Record<string, unknown>
    const fact = S(o.fact)
    if (!(CLAIM_FACTS as readonly string[]).includes(fact)) {
      problems.push(`모르는 claim fact "${fact}"`); continue
    }
    claims.push({
      fact: fact as ClaimFact,
      detail: S(o.detail),
      // 🔴 **모르면 바꿀 수 없는 것으로 본다.** 모르는 채로 관점을 낮추면 알맹이가 사라진다
      stanceShiftable: o.stanceShiftable === true,
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
      anchors,
      participationHook: S(j.participationHook) === '' ? null : S(j.participationHook),
      participationConfidence: Number.isFinite(conf) && conf >= 0 && conf <= 1 ? conf : null,
      closingIntent: (CLOSING_INTENTS as readonly string[]).includes(closing) ? (closing as ClosingIntent) : null,
      timeSensitivity: (TIME_SENSITIVITIES as readonly string[]).includes(time) ? (time as TimeSensitivity) : 'unknown',
      contentRoles: [...new Set(roles)],
      claimRequirements: claims,
      essenceVersion: ESSENCE_VERSION,
    },
    droppedAnchors: dropped,
    schemaProblems: problems,
  }
}

/** 🔴 생성해도 되는가 — 확인 못 한 글은 만들지 않는다 */
export function canGenerate(e: SourceEssence | null): { ok: boolean; why: string } {
  if (e === null) return { ok: false, why: '판정을 읽지 못했다' }
  if (e.contextSufficiency === 'insufficient') {
    return { ok: false, why: `무슨 이야기인지 확인하지 못했다 (${e.insufficientReasons.join('·')})` }
  }
  if (e.coreMoment === null) return { ok: false, why: '무슨 이야기인지 한 줄도 나오지 않았다' }
  return { ok: true, why: '' }
}

/** 🔴 글자 그대로 남겨야 하는 것만 — deterministic 대조가 이것을 본다 */
export function exactAnchors(e: SourceEssence): EssenceAnchor[] {
  return e.anchors.filter((a) => a.preserve === 'exact')
}
