/**
 * Seed Originality 소스 검수 — 🔴 **순수 판정·계약 모듈. I/O 를 하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AD
 *
 * 🔴 **이 화면이 무엇을 고르는가.**
 *    **초안이 아니라 소재**다. "이 원문이 좋은가" 가 아니라
 *    **"이 소재를 우리 질문으로 바꿀 수 있나"** 를 묻는다(§4-AD ④).
 *
 * 🔴 **SRN 승인 화면과 섞지 않는다.**
 *    SRN 의 `APPROVE` 는 *"원문 그대로 noindex 로 낸다"* 는 뜻이다(§4-Z ②).
 *    그 버튼이 여기 보이면, 한 번 잘못 눌러 **재가공해야 할 글이 원문 그대로**
 *    발행 후보가 된다. 화면을 섞는 비용은 코드가 아니라 **오판**으로 돌아온다.
 *    그래서 이 모듈에는 `APPROVE` 도 `ADOPT` 도 없다.
 *
 * 🔴 **DB · Sheet · LLM · 발행 · noindex · Raw Vault · 네이버 · 82cook 없음.**
 */

/** 🔴 이 화면이 다루는 유일한 축 */
export const SOURCE_AXIS = 'seedOriginality'

/** 🔴 화면·export 어디에나 그대로 박히는 문구 — 한 곳에서만 정의한다 */
export const NOT_PUBLISH_NOTE = '발행 아님 · 소재 승인 파일만 생성'

/**
 * 사람이 누를 수 있는 것 — 🔴 **셋뿐이다** (§4-AD ⑥).
 *
 *    `ADOPT` 를 쓰지 않는다 — 그것은 **초안 검수 단계**의 말이다(§4-AB · §4-AC ②).
 *    `APPROVE` 도 쓰지 않는다 — 그것은 SRN 의 *"원문 그대로 낸다"* 다(§4-Z ②).
 *    같은 낱말을 두 단계에 쓰면 export 를 나중에 볼 때
 *    **어느 단계의 판정인지 알 수 없게 된다.**
 */
export const SOURCE_DECISIONS: readonly (readonly [string, string])[] = [
  ['SEED', '소재로 쓸 만하다 — 초안 생성 입력이 된다'],
  ['HOLD', '보류 — 전문이 필요하거나 애매하다'],
  ['DROP', '소재로 못 쓴다'],
] as const

export const SOURCE_DECISION_KEYS: readonly string[] = SOURCE_DECISIONS.map(([k]) => k)

/** `.detail.jsonl` 한 행 */
export type DetailRecord = {
  runId?: string
  axis?: string
  access?: string
  sourceSite?: string
  sourceArticleId?: string
  url?: string
  score?: number
  lane?: string
  bodyLength?: number
  lengthBasis?: string
  imageCount?: number
  commentCount?: number
  safetyVerdict?: string
  safetyReasons?: string
  assetAxes?: string
  reason?: string
  title?: string
}

/** 🔴 후보에서 빠진 이유 — 조용히 사라지지 않게 코드로 남긴다 */
export type RejectCode = 'notSourceAxis' | 'notAccessible' | 'unsafe' | 'noArticleId' | 'emptyBody'

export type SourceReject = { articleId: string; axis: string; code: RejectCode; why: string }

export type SourceCard = {
  articleId: string
  detailRunId: string
  title: string
  sourceSite: string
  url: string
  score: number
  lane: string
  /** 🟡 길이만 안다 — 본문은 저장되지 않는다 (§4-Z ⑥) */
  bodyLength: number
  imageCount: number
  commentCount: number
  assetAxes: string
  safetyVerdict: string
  safetyReasons: string
  reason: string
}

/**
 * 후보 선별 — 🔴 **네 관문을 전부 통과한 것만** 화면에 오른다 (§4-AD ③).
 *
 * SRN 화면과 **같은 구조**다(§4-Z ②) — 축만 다르다.
 * `axis` 는 판정 **결과**라, 결과만 믿으면 판정기가 바뀌는 날 화면이 조용히 따라 바뀐다.
 */
export function selectSources(records: readonly DetailRecord[]): {
  cards: SourceCard[]
  rejected: SourceReject[]
} {
  const cards: SourceCard[] = []
  const rejected: SourceReject[] = []
  const seen = new Set<string>()

  for (const r of records) {
    const axis = String(r.axis ?? '')
    const id = String(r.sourceArticleId ?? '')
    const push = (code: RejectCode, why: string): void => {
      rejected.push({ articleId: id, axis, code, why })
    }

    // ① 🔴 축 — 이 화면은 seedOriginality 하나만 다룬다
    if (axis !== SOURCE_AXIS) { push('notSourceAxis', `축이 ${axis || '(없음)'}`); continue }
    if (!id) { push('noArticleId', '식별자 없음'); continue }

    // ② 🔴 읽지 못한 글은 판단 대상이 아니다 (§4-S)
    if (String(r.access ?? '') !== 'ok') { push('notAccessible', `access=${r.access ?? '(없음)'}`); continue }

    // ③ 🔴 안전이 소재보다 먼저다 (§4-Y ⑤)
    const sv = String(r.safetyVerdict ?? '')
    if (sv !== 'pass') { push('unsafe', `safety=${sv || '(없음)'}`); continue }

    // ④ 🟡 본문 길이가 0 이면 읽을 것이 없었다는 뜻이다
    const len = Number(r.bodyLength ?? 0)
    if (!Number.isFinite(len) || len <= 0) { push('emptyBody', `본문 ${len}자`); continue }

    if (seen.has(id)) continue // 같은 글이 여러 회차에 있으면 첫 행만
    seen.add(id)

    cards.push({
      articleId: id,
      detailRunId: String(r.runId ?? ''),
      title: String(r.title ?? ''),
      sourceSite: String(r.sourceSite ?? ''),
      url: String(r.url ?? ''),
      score: Number(r.score ?? 0),
      lane: String(r.lane ?? ''),
      bodyLength: len,
      imageCount: Number(r.imageCount ?? 0),
      commentCount: Number(r.commentCount ?? 0),
      assetAxes: String(r.assetAxes ?? ''),
      safetyVerdict: sv,
      safetyReasons: String(r.safetyReasons ?? ''),
      reason: String(r.reason ?? ''),
    })
  }

  cards.sort((a, b) => b.score - a.score)
  return { cards, rejected }
}

/**
 * export 계약 — 🔴 컬럼 순서를 바꾸지 않는다. 뒤에만 추가한다.
 *    §4-AD ⑦ 의 최소 필드를 그대로 따른다 —
 *    **행 하나만 떼어 봐도 출처와 시각을 안다**(§4-AC ③ 과 같은 원칙).
 */
export const SOURCE_COLUMNS: readonly string[] = [
  'decision', 'sourceArticleId', 'sourceSite', 'url', 'score', 'lane',
  'bodyLength', 'imageCount', 'commentCount', 'assetAxes',
  'safetyVerdict', 'safetyReasons', 'title', 'memo',
  'detailRunId', 'reviewedAt', 'note',
] as const

export type DecisionState = { v?: string; memo?: string }

export type SourceRow = {
  decision: string; sourceArticleId: string; sourceSite: string; url: string
  score: number; lane: string
  bodyLength: number; imageCount: number; commentCount: number; assetAxes: string
  safetyVerdict: string; safetyReasons: string; title: string; memo: string
  detailRunId: string; reviewedAt: string; note: string
}

/**
 * 검수 결과 행 — 🔴 **사람이 누른 것만** 나간다.
 *    누르지 않은 후보를 기본값으로 채우면 '검수' 가 사람의 행위가 아니게 된다.
 */
export function sourceRows(
  cards: readonly SourceCard[],
  state: Readonly<Record<string, DecisionState>>,
  /**
   * 🔴 **사람이 export 한 시각**이다 (§4-AD ⑦).
   *    한 export 안의 모든 행이 같은 값을 쓴다 — 파일 하나가 한 번의 검수다.
   */
  reviewedAt: string = new Date().toISOString(),
): SourceRow[] {
  const out: SourceRow[] = []
  for (const c of cards) {
    const st = state[c.articleId]
    const v = st?.v ?? ''
    if (!v) continue
    out.push({
      decision: v,
      sourceArticleId: c.articleId,
      sourceSite: c.sourceSite,
      url: c.url,
      score: c.score,
      lane: c.lane,
      bodyLength: c.bodyLength,
      imageCount: c.imageCount,
      commentCount: c.commentCount,
      assetAxes: c.assetAxes,
      safetyVerdict: c.safetyVerdict,
      safetyReasons: c.safetyReasons,
      title: c.title,
      memo: st?.memo ?? '',
      detailRunId: c.detailRunId,
      reviewedAt,
      note: NOT_PUBLISH_NOTE,
    })
  }
  return out
}

/**
 * 🟡 SEED 로 고른 행 — **이후 `micro-seed:seed-originality` 입력 후보**가 된다 (§4-AD ⑧).
 *    HOLD · DROP 은 넘어가지 않는다.
 */
export function seedDecisions(rows: readonly SourceRow[]): SourceRow[] {
  return rows.filter((r) => r.decision === 'SEED')
}

/** 🟡 HOLD 로 쌓인 것 — 전문이 필요하면 **재접속을 따로 요청**한다 (§4-AD ⑤) */
export function heldForReread(rows: readonly SourceRow[]): SourceRow[] {
  return rows.filter((r) => r.decision === 'HOLD')
}

const cell = (v: unknown): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

export function sourceTsv(rows: readonly SourceRow[]): string {
  const lines = [SOURCE_COLUMNS.join('\t')]
  for (const r of rows) {
    lines.push(SOURCE_COLUMNS.map((k) => cell((r as unknown as Record<string, unknown>)[k])).join('\t'))
  }
  return lines.join('\n')
}
