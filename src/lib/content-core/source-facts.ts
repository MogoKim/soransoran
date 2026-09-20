/**
 * 원천 사실의 원시값 — 🔴 **글자 그대로 지켜야 하는 것과 그것을 증명하는 방법.**
 *
 * 🔴 **이 파일은 판단하지 않는다.** 화자 자격 판정은 `speaker.ts` 가,
 *    글의 품질 판정은 `review.ts` 가 한다. 여기 있는 것은 그 둘이 함께 쓰는 원시값이다.
 *
 * 🔴 **`claimRequirements` 중간 전달 구조를 없앴다** (2026-09-19, 대안 D).
 *
 *    앞판은 `원문 → claimRequirements → 코드 매칭` 이었다. 매칭하는 쪽이
 *    **원문을 본 적이 없었다.** 그래서 4차 실측에서 같은 알바 원문에
 *    3차는 `work=파트타임` 을, 4차는 `[]` 를 냈고, 빈 목록이 곧
 *    *"모두가 자격 있음"* 이 되어 **전업 Persona 가 1인칭으로 알바를 했다.**
 *
 *    🔴 이제 계획 호출 하나가 **마스킹된 원문과 실제 Persona 카드를 함께** 보고
 *       화자·자리를 고르며, 코드는 그 결정의 **근거를 검증한다**
 *       (`src/lib/content-core/speaker.ts`).
 *       자격 사실을 표현하는 구조는 `SpeakerWarrant` **하나뿐이다.**
 */
import type { EvidenceSpan } from './evidence'

export const SOURCE_FACTS_VERSION = 'source-facts-v1'

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

/** 1인칭으로 주장하려면 글쓴이에게 있어야 하는 생활사 축 */
export const CLAIM_FACTS = [
  'spouse', 'children', 'childAgeBand', 'parentCare', 'menopause', 'work', 'region', 'age',
] as const
export type ClaimFact = (typeof CLAIM_FACTS)[number]

export const CLAIM_FACT_LABEL: Readonly<Record<ClaimFact, string>> = {
  spouse: '현재 배우자', children: '자녀', childAgeBand: '자녀 나이대',
  parentCare: '부모 돌봄', menopause: '갱년기', work: '지금 하는 일',
  region: '사는 곳', age: '나이대',
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
  | { ok: false; why: 'notProvable' }
  | { ok: false; why: 'clauseLike' }

/**
 * 🔴 이 값을 **글자 그대로 지키라고 해도 되는가.**
 *    긴 문구를 글자 그대로 쓰게 하면 그것이 곧 복제다.
 */
export function judgeProtectedFact(kind: ProtectedFactKind, text: string): FactVerdict {
  const t = text.trim()
  if (t === '') return { ok: false, why: 'notProvable' }
  switch (kind) {
    case 'number': return NUMBER_FACT_RE.test(t) ? { ok: true } : { ok: false, why: 'notProvable' }
    case 'relation': return RELATION_NAMES.includes(t) ? { ok: true } : { ok: false, why: 'notProvable' }
    /** 🔴 공개 이름·검색 용어는 확정할 방법이 없다 — 문장·절이 아님이 확실할 때만 */
    case 'publicEntity':
    case 'searchTerm':
      return looksLikeClause(t) ? { ok: false, why: 'clauseLike' } : { ok: true }
    default: return { ok: false, why: 'notProvable' }
  }
}

/** 🔴 초안에 글자 그대로 남아야 하는 것 */
export function missingProtectedFacts(
  facts: readonly ProtectedFact[], draftText: string,
): string[] {
  const d = normalizeForProvenance(draftText)
  return facts.filter((f) => !d.includes(normalizeForProvenance(f.text))).map((f) => f.text)
}
