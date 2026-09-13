/**
 * Seed Originality 초안 검수 — 🔴 **순수 판정·계약 모듈. I/O 를 하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AA · §4-AB
 *
 * 🔴 **이 모듈이 지키는 경계**
 *    ① 검수 대상은 **초안**이지 원문이 아니다. 원문은 여기 오지 않는다.
 *    ② 채택은 **발행이 아니다.** publish · noindex 경로가 없다.
 *    ③ 한 원천에서 여러 개 채택할 수 있다. 다만 **권장은 1개**다 —
 *       같은 소재로 여러 글을 한꺼번에 올리면 커뮤니티가 도배로 읽는다.
 *
 * 🔴 **DB · Sheet · LLM · 발행 · noindex · Raw Vault · 네이버 · 82cook 없음.**
 */
import { describeOriginality, readMeasure } from '../../src/lib/draft-originality'

/** 🔴 잰 값이 없을 때의 자리 — "0" 이지 "통과" 가 아니다. 판정은 `judgeCopy` 가 따로 한다 */
const ZERO_MEASURE = { runWords: 0, runChars: 0, coverRatio: 0 }

/** 사람이 누를 수 있는 것 — 🔴 여기에 '발행' 이 없다는 것이 계약이다 */
export const REVIEW_DECISIONS: readonly (readonly [string, string])[] = [
  ['ADOPT', '채택 — 이대로 쓸 만하다 (발행은 별도)'],
  ['REVISE', '수정 필요 — 소재는 좋은데 손봐야 한다'],
  ['DROP', '버림'],
] as const

export const REVIEW_DECISION_KEYS: readonly string[] = REVIEW_DECISIONS.map(([k]) => k)

export const NOT_PUBLISH_NOTE = '발행 아님 · 초안 검수 파일만 생성'

/** 한 원천에서 이보다 많이 채택하면 화면이 경고한다 — 막지는 않는다 */
export const RECOMMENDED_ADOPT_PER_SOURCE = 1

// ── 입력 (dry-run 산출물의 모양) ──────────────────────────
export type DraftIn = {
  draftNo?: number
  title?: string
  body?: string
  bodyLength?: number
  safety?: { verdict?: string; reasons?: { code?: string }[]; summary?: string }
  /** 🔴 잰 값. 판정은 `draft-originality.ts` 가 한다 */
  originality?: unknown
  leakedTokens?: string[]
  bannedHonorifics?: string[]
  ok?: boolean
  /** 🔴 초안을 만든 시각 — §4-AC ③ */
  generatedAt?: string
}

export type ExpansionIn = {
  sourceArticleId?: string
  /** 🔴 어느 카페에서 왔는가 — §4-AC ③ */
  sourceSite?: string
  sourceTitle?: string
  topic?: string
  topicLabel?: string
  material?: string
  matched?: string
  generalized?: string
  direction?: string
  drafts?: DraftIn[]
  needsHuman?: boolean
}

// ── 화면 카드 ────────────────────────────────────────────
export type DraftCard = {
  /** 🔴 한 화면에 여러 원천이 섞이므로 초안 하나를 가리키는 키가 필요하다 */
  key: string
  sourceArticleId: string
  draftNo: number
  title: string
  body: string
  bodyLength: number
  /** 🔴 초안이 만들어진 시각 — 행마다 따라다닌다 */
  generatedAt: string
  safetyVerdict: string
  safetyReasons: string
  safetySummary: string
  /** 🔴 원문 복붙 금지 검증 결과 — 화면이 그대로 보여준다 */
  originality: string
  /** 🔴 권장 초안을 고를 때 쓰는 잰 값 — 낮을수록 원문에서 멀다 */
  originalityRunChars: number
  leakedTokens: string[]
  bannedHonorifics: string[]
  /** 🟢 위 셋이 모두 깨끗한가 */
  clean: boolean
  /** 🟡 이 그룹에서 권장하는 하나인가 */
  recommended: boolean
}

export type SourceGroup = {
  sourceArticleId: string
  sourceSite: string
  sourceTitle: string
  topic: string
  topicLabel: string
  material: string
  matched: string
  generalized: string
  direction: string
  drafts: DraftCard[]
  needsHuman: boolean
}

export const draftKey = (articleId: string, draftNo: number): string => `${articleId}#${draftNo}`

/**
 * 권장 1개 고르기 — 🔴 **결정적이어야 한다.**
 *
 *    사람이 다시 열었을 때 권장이 바뀌면 그 표시를 믿을 수 없다.
 *    ① 검증이 깨끗한 것만 후보다(복붙·유출·금지 호칭 없음, safety pass).
 *    ② 그중 **원문 겹침이 가장 작은 것** — 원문에서 가장 멀리 온 초안이다.
 *    ③ 동률이면 draftNo 가 작은 것. 무작위를 쓰지 않는다.
 *    깨끗한 것이 하나도 없으면 **권장하지 않는다** — 억지로 하나 고르지 않는다.
 */
export function pickRecommended(drafts: readonly DraftCard[]): string | null {
  const clean = drafts.filter((d) => d.clean)
  if (clean.length === 0) return null
  let best = clean[0]!
  for (const d of clean.slice(1)) {
    if (d.originalityRunChars < best.originalityRunChars) best = d
    else if (d.originalityRunChars === best.originalityRunChars && d.draftNo < best.draftNo) best = d
  }
  return best.key
}

/** dry-run 산출물 → 화면 그룹 */
export function toGroups(expansions: readonly ExpansionIn[]): SourceGroup[] {
  const groups: SourceGroup[] = []
  for (const e of expansions) {
    const id = String(e.sourceArticleId ?? '')
    if (!id) continue
    const drafts: DraftCard[] = (e.drafts ?? []).map((d) => {
      const no = Number(d.draftNo ?? 0)
      const leaked = (d.leakedTokens ?? []).map(String).filter((x) => x.length > 0)
      const banned = (d.bannedHonorifics ?? []).map(String).filter((x) => x.length > 0)
      const verdict = String(d.safety?.verdict ?? '')
      return {
        key: draftKey(id, no),
        sourceArticleId: id,
        draftNo: no,
        title: String(d.title ?? ''),
        body: String(d.body ?? ''),
        bodyLength: Number(d.bodyLength ?? 0),
        generatedAt: String(d.generatedAt ?? ''),
        safetyVerdict: verdict,
        safetyReasons: (d.safety?.reasons ?? []).map((r) => String(r.code ?? '')).filter(Boolean).join('/'),
        safetySummary: String(d.safety?.summary ?? ''),
        originality: describeOriginality(readMeasure(d.originality) ?? ZERO_MEASURE),
        originalityRunChars: (readMeasure(d.originality) ?? ZERO_MEASURE).runChars,
        leakedTokens: leaked,
        bannedHonorifics: banned,
        clean: verdict === 'pass' && leaked.length === 0 && banned.length === 0 && d.ok === true,
        recommended: false,
      }
    })
    const rec = pickRecommended(drafts)
    for (const d of drafts) d.recommended = d.key === rec
    groups.push({
      sourceArticleId: id,
      sourceSite: String(e.sourceSite ?? ''),
      sourceTitle: String(e.sourceTitle ?? ''),
      topic: String(e.topic ?? ''),
      topicLabel: String(e.topicLabel ?? ''),
      material: String(e.material ?? ''),
      matched: String(e.matched ?? ''),
      generalized: String(e.generalized ?? ''),
      direction: String(e.direction ?? ''),
      drafts,
      needsHuman: e.needsHuman === true,
    })
  }
  return groups
}

// ── export 계약 ──────────────────────────────────────────
/** 🔴 컬럼 순서를 바꾸지 않는다. 뒤에만 추가한다 */
export const REVIEW_COLUMNS: readonly string[] = [
  'decision', 'sourceArticleId', 'draftNo', 'topic', 'material', 'generalized', 'direction',
  'title', 'body', 'bodyLength',
  'safetyVerdict', 'safetyReasons', 'originality', 'leakedTokens', 'clean', 'recommended',
  'memo', 'note',
  // 🔴 §4-AC 간극 보강 (2026-09-05). **앞 18개 위치는 그대로.**
  //    이 셋이 있어야 export 파일 한 줄만으로 출처·시각을 추적할 수 있다.
  'sourceSite', 'generatedAt', 'reviewedAt',
] as const

export type DecisionState = { v?: string; memo?: string }

export type ReviewRow = {
  decision: string; sourceArticleId: string; draftNo: number
  topic: string; material: string; generalized: string; direction: string
  title: string; body: string; bodyLength: number
  safetyVerdict: string; safetyReasons: string; originality: string
  leakedTokens: string; clean: string; recommended: string
  memo: string; note: string
  sourceSite: string; generatedAt: string; reviewedAt: string
}

/**
 * 검수 결과 행 — 🔴 **사람이 누른 것만** 나간다.
 *    누르지 않은 초안을 기본값으로 채워 내보내면 '검수' 가 사람의 행위가 아니게 된다.
 */
export function reviewRows(
  groups: readonly SourceGroup[],
  state: Readonly<Record<string, DecisionState>>,
  /**
   * 🔴 **사람이 export 한 시각**이다 (§4-AC ③).
   *    초안을 만든 시각(generatedAt)과 다르다 — 둘 사이가 검수에 걸린 시간이다.
   *    한 export 안의 모든 행은 같은 값을 쓴다. 파일 하나가 한 번의 검수다.
   */
  reviewedAt: string = new Date().toISOString(),
): ReviewRow[] {
  const out: ReviewRow[] = []
  for (const g of groups) {
    for (const d of g.drafts) {
      const st = state[d.key]
      const v = st?.v ?? ''
      if (!v) continue
      out.push({
        decision: v,
        sourceArticleId: g.sourceArticleId,
        draftNo: d.draftNo,
        topic: g.topic,
        material: g.material,
        generalized: g.generalized,
        direction: g.direction,
        title: d.title,
        body: d.body,
        bodyLength: d.bodyLength,
        safetyVerdict: d.safetyVerdict,
        safetyReasons: d.safetyReasons,
        originality: d.originality,
        leakedTokens: d.leakedTokens.join('/'),
        clean: d.clean ? 'clean' : 'check',
        recommended: d.recommended ? 'recommended' : '',
        memo: st?.memo ?? '',
        note: NOT_PUBLISH_NOTE,
        sourceSite: g.sourceSite,
        generatedAt: d.generatedAt,
        reviewedAt,
      })
    }
  }
  return out
}

/** 🟡 한 원천에서 권장(1개)보다 많이 채택한 곳 — 막지 않고 알린다 */
export function overAdopted(
  groups: readonly SourceGroup[],
  state: Readonly<Record<string, DecisionState>>,
): { sourceArticleId: string; adopted: number }[] {
  const out: { sourceArticleId: string; adopted: number }[] = []
  for (const g of groups) {
    const n = g.drafts.filter((d) => state[d.key]?.v === 'ADOPT').length
    if (n > RECOMMENDED_ADOPT_PER_SOURCE) out.push({ sourceArticleId: g.sourceArticleId, adopted: n })
  }
  return out
}

const cell = (v: unknown): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

export function reviewTsv(rows: readonly ReviewRow[]): string {
  const lines = [REVIEW_COLUMNS.join('\t')]
  for (const r of rows) {
    lines.push(REVIEW_COLUMNS.map((k) => cell((r as unknown as Record<string, unknown>)[k])).join('\t'))
  }
  return lines.join('\n')
}
