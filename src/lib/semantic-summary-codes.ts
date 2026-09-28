/**
 * 🔴 **의미 검수 요약 — 칸 이름과 경고 코드의 정본** (2026-09-27 · 의존 없는 파일)
 *
 * 적재(`micro-seed-supply-autofill`) · 자동 READY 판정(`auto-ready-v2`) · 품질 계약 digest
 * (`quality-contract`)가 같은 값을 읽는다. 셋이 서로를 부르는 순환 안에서 모듈 로드 때 값을
 * 읽으면 비어 있다(실측: `Cannot access 'SEMANTIC_SUMMARY_KEY' before initialization`).
 * 그래서 아무것도 import 하지 않는 이 파일에 둔다. 값은 옮기기 전과 한 글자도 같다.
 *
 * 🔴 요약 파서(`semanticSummaryOf` · `semanticHoldsOf`)도 여기 있다 (2026-09-27 P1) — complete ·
 *    deterministic · 개수 판정이 자동 READY 표본 적격을 정하므로 품질 계약 CI 지문이 이 파일을 본다.
 *    `micro-seed-supply-autofill` 에서 옮겼고 판정은 한 글자도 같다. 그 파일은 다시 내보낸다.
 */
export const SEMANTIC_SUMMARY_KEY = 'semanticReview'

/** 🔴 경고 코드 — 사람 화면과 자동 판정이 **같은 이름**을 읽는다 */
export const SEMANTIC_HOLD_CODES = {
  unsupportedAdditions: 'SEMANTIC_UNSUPPORTED_ADDITION',
  lifeContradictions: 'SEMANTIC_LIFE_CONTRADICTION',
  droppedFromSource: 'SEMANTIC_DROPPED_FROM_SOURCE',
  incomplete: 'SEMANTIC_REVIEW_INCOMPLETE',
} as const

/** 🔴 적재가 싣는 의미 검수 요약 — 문장이 아니라 **수와 완전성**이다 */
export type SemanticSummary = {
  /** 판정이 끝까지 돌았는가. `false` 면 **재지 못한 것**이다 */
  complete: boolean
  /** 규칙 검사 통과 여부 */
  deterministicPass: boolean
  unsupportedAdditions: number
  lifeContradictions: number
  droppedFromSource: number
  /** 0~1. 🔴 **이 값만으로 READY 를 정하지 않는다** — 참고 수치다 */
  confidence: number | null
}

/** artifact 의 review 블록 → 적재가 실을 요약. 모양이 아니면 `null` 이다 */
export function semanticSummaryOf(review: unknown): SemanticSummary | null {
  if (review === null || typeof review !== 'object') return null
  const r = review as Record<string, unknown>
  const sem = (r.semantic !== null && typeof r.semantic === 'object')
    ? r.semantic as Record<string, unknown> : null
  if (sem === null) return null
  /**
   * 🔴 두 모양을 다 받는다 — artifact 는 **배열**로, 후보가 나르는 요약은 **수**로 온다.
   *    한쪽만 보면 나르는 도중에 값이 0 으로 바뀐다.
   */
  const n = (k: string): number => {
    const v = sem[k] ?? r[k]
    if (Array.isArray(v)) return v.length
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  }
  const det = (r.deterministic !== null && typeof r.deterministic === 'object')
    ? (r.deterministic as Record<string, unknown>).pass === true : false
  const comp = (r.semanticCompletion !== null && typeof r.semanticCompletion === 'object')
    ? (r.semanticCompletion as Record<string, unknown>).complete === true : false
  const conf = typeof sem.confidence === 'number' ? sem.confidence : null
  return {
    complete: comp,
    deterministicPass: det,
    unsupportedAdditions: n('unsupportedAdditions'),
    lifeContradictions: n('lifeContradictions'),
    droppedFromSource: n('droppedFromSource'),
    confidence: conf,
  }
}

/**
 * 🔴 요약 → 경고 목록. **판정 기록이 없으면 그것도 경고다** — 재지 못한 것을
 *    "이상 없음" 으로 읽지 않는다.
 */
export function semanticHoldsOf(sum: SemanticSummary | null): string[] {
  if (sum === null) return [SEMANTIC_HOLD_CODES.incomplete]
  const out: string[] = []
  if (!sum.complete || !sum.deterministicPass) out.push(SEMANTIC_HOLD_CODES.incomplete)
  if (sum.unsupportedAdditions > 0) {
    out.push(`${SEMANTIC_HOLD_CODES.unsupportedAdditions}:${sum.unsupportedAdditions}`)
  }
  if (sum.lifeContradictions > 0) {
    out.push(`${SEMANTIC_HOLD_CODES.lifeContradictions}:${sum.lifeContradictions}`)
  }
  if (sum.droppedFromSource > 0) {
    out.push(`${SEMANTIC_HOLD_CODES.droppedFromSource}:${sum.droppedFromSource}`)
  }
  return out
}

/**
 * 🔴 **생활 일관성 게이트의 사람 검토 경고** (2026-09-28 quality-v2).
 *
 *    초안 게이트(`content-core/draft-life-gates.ts`)가 **모호하다**고 본 축 — 혼인 · 돌봄·한집 ·
 *    자녀 삶의 단계 · 정신건강·질병 — 은 채택은 되지만 자동 READY 에서 빠져야 한다.
 *    후보 봉투가 `lifeReview`(코드 배열)로 나르고, 적재기가 `gateResults.holds` 에
 *    `DRAFT_LIFE_REVIEW:<코드>` 로 싣는다. `SEMANTIC_` 접두가 아니라 요약 대조와 섞이지 않는다.
 *
 *    🔴 **칸이 없거나 모양이 다르면 그것도 경고다** — 판정을 싣지 않은 후보를 "모호함 없음" 으로
 *       읽지 않는다(`DRAFT_LIFE_REVIEW:unread`). 이 파일은 아무것도 import 하지 않는다 —
 *       코드 이름의 정본은 게이트 파일이고, 여기서는 **모양**만 본다.
 */
export const DRAFT_LIFE_REVIEW_HOLD = 'DRAFT_LIFE_REVIEW'
export const DRAFT_LIFE_REVIEW_UNREAD = `${DRAFT_LIFE_REVIEW_HOLD}:unread`

export function lifeReviewHoldsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [DRAFT_LIFE_REVIEW_UNREAD]
  if (!v.every((x) => typeof x === 'string' && /^[A-Za-z]+$/.test(x))) return [DRAFT_LIFE_REVIEW_UNREAD]
  return [...new Set(v as string[])].sort().map((c) => `${DRAFT_LIFE_REVIEW_HOLD}:${c}`)
}
