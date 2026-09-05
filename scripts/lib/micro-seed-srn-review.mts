/**
 * Short Raw Noindex 승인 화면 — 🔴 **순수 판정·계약 모듈. I/O 를 하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-Y · §4-Z
 *
 * 🔴 **이 모듈이 지키는 경계**
 *    ① 후보는 `axis === 'shortRawNoindex'` 하나뿐이다.
 *       seedOriginality · rawOriginality · hold · drop · access 는 **화면에 섞이지 않는다**.
 *       섞이면 사람이 "승인" 을 누르는 대상이 바뀐다 — 그게 이 화면의 유일한 사고 경로다.
 *    ② 길이는 **본문(body) 기준**이다 (§4-Y ④ 확정).
 *       `title+body` 는 **참고값**으로만 계산해 보여준다. 자격 판정에 쓰지 않는다.
 *    ③ 승인은 **발행이 아니다**. 이 모듈에는 publish · noindex 배포 경로가 없다.
 *
 * 🔴 **DB · Sheet · LLM · live fetch · Raw Vault 적재 · 82cook adapter 없음.**
 *    import 도 하지 않는다 — 판정 상수 하나만 detail-classify 에서 가져온다.
 */
import { SHORT_RAW_MAX, type LengthBasis } from './micro-seed-detail-classify.mjs'

export { SHORT_RAW_MAX }

/** 🔴 이 화면이 다루는 유일한 축 */
export const SRN_AXIS = 'shortRawNoindex'

/** 🔴 화면·CLI·export 어디에나 그대로 박히는 문구 — 한 곳에서만 정의한다 */
export const NOT_PUBLISH_NOTE = '발행 아님 · noindex 배포 아님 · 사람 승인 파일만 생성'

/** `.detail.jsonl` 한 행 — fetch 산출물의 모양이다 */
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
  /**
   * 🟡 본문 원문 — **100자 미만일 때만** fetch 가 남긴다 (§4-Z).
   *    없을 수도 있다(본문 보존 이전 회차). 없으면 화면이 "본문 미보존" 으로 표시한다.
   */
  body?: string
  note?: string
  recordedAt?: string
}

/** 사람이 누를 수 있는 것 — 🔴 여기에 '발행' 이 없다는 것이 이 화면의 계약이다 */
export const SRN_DECISIONS: readonly (readonly [string, string])[] = [
  ['APPROVE', '승인 — noindex 원문 그대로 (발행은 별도)'],
  ['SEED', 'Seed Originality 로 이동 — 우리 말투로 확장'],
  ['HOLD', '보류'],
  ['DROP', '버림'],
] as const

export const SRN_DECISION_KEYS: readonly string[] = SRN_DECISIONS.map(([k]) => k)

/** 후보에서 빠진 이유 — 🔴 조용히 사라지지 않게 코드로 남긴다 */
export type RejectCode =
  | 'notSrnAxis'      // 다른 축이다
  | 'notAccessible'   // 읽지 못한 글
  | 'notBodyBasis'    // body 기준으로 재지 않았다 → 본문 길이를 모른다
  | 'notShort'        // 본문 100자 이상
  | 'emptyBody'       // 본문 0자
  | 'unsafe'          // 안전·브랜드 필터가 pass 가 아니다
  | 'noArticleId'     // 식별자가 없다

export type SrnReject = { articleId: string; axis: string; code: RejectCode; why: string }

export type SrnCard = {
  articleId: string
  runId: string
  title: string
  /** 🟢 자격 판정 길이 — 본문 기준 (§4-Y ④) */
  bodyLength: number
  lengthBasis: LengthBasis
  /** 🟡 참고값일 뿐이다. 자격 판정에 쓰지 않는다 */
  titleBodyRefLength: number
  /** 🟡 없을 수 있다 — 본문 보존 이전 회차 */
  body: string | null
  sourceSite: string
  url: string
  score: number
  lane: string
  imageCount: number
  commentCount: number
  safetyVerdict: string
  safetyReasons: string
  reason: string
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
const charLen = (s: string): number => [...norm(s)].length

/**
 * 🟡 참고값 — 제목 + 본문 길이.
 *
 * 🔴 이것으로 자격을 판정하지 않는다. §4-Y ④ 가 본문 기준으로 확정했고,
 *    그 이유는 **제목은 운영자가 바꿀 수 있기 때문**이다.
 *    고쳐 쓸 수 있는 글자가 기준에 들어가면 기준이 기준이 아니게 된다.
 */
export function titleBodyRefLength(title: string, bodyLength: number): number {
  const t = charLen(title)
  return t > 0 ? t + 1 + bodyLength : bodyLength
}

/**
 * 후보 선별 — 🔴 **다섯 관문을 전부 통과한 것만** 화면에 오른다.
 *
 * 축 하나만 보고 끝내지 않는 이유: `axis` 는 판정 **결과**다.
 * 결과만 믿으면 판정기가 바뀌는 날 화면이 조용히 따라 바뀐다.
 * 승인 화면은 사람이 원문을 그대로 내보내겠다고 누르는 곳이라
 * 근거(접근·기준·길이·안전)를 여기서 다시 확인한다.
 */
export function selectSrn(records: readonly DetailRecord[]): {
  cards: SrnCard[]
  rejected: SrnReject[]
} {
  const cards: SrnCard[] = []
  const rejected: SrnReject[] = []
  const seen = new Set<string>()

  for (const r of records) {
    const axis = String(r.axis ?? '')
    const id = String(r.sourceArticleId ?? '')
    const push = (code: RejectCode, why: string): void => {
      rejected.push({ articleId: id, axis, code, why })
    }

    // ① 🔴 축 — 이 화면은 SRN 하나만 다룬다
    if (axis !== SRN_AXIS) { push('notSrnAxis', `축이 ${axis || '(없음)'}`); continue }
    if (!id) { push('noArticleId', '식별자 없음'); continue }

    // ② 🔴 읽지 못한 글은 승인 대상이 아니다 — Access 는 판정이 아니다 (§4-S)
    if (String(r.access ?? '') !== 'ok') { push('notAccessible', `access=${r.access ?? '(없음)'}`); continue }

    // ③ 🔴 안전·브랜드가 길이보다 먼저다 (§4-Y ⑤)
    const sv = String(r.safetyVerdict ?? '')
    if (sv !== 'pass') { push('unsafe', `safety=${sv || '(없음)'}`); continue }

    // ④ 🔴 body 기준으로 재지 않았으면 본문 길이를 모른다 — 추정하지 않는다
    const basis = String(r.lengthBasis ?? '')
    if (basis !== 'body') { push('notBodyBasis', `lengthBasis=${basis || '(없음)'}`); continue }

    // ⑤ 🟢 본문 100자 미만 (§4-Y ④)
    const len = Number(r.bodyLength ?? 0)
    if (!Number.isFinite(len) || len <= 0) { push('emptyBody', `본문 ${len}자`); continue }
    if (len >= SHORT_RAW_MAX) { push('notShort', `본문 ${len}자 ≥ ${SHORT_RAW_MAX}`); continue }

    if (seen.has(id)) continue // 같은 글이 여러 회차에 있으면 첫 행만
    seen.add(id)

    const title = String(r.title ?? '')
    // 🔴 본문은 100자 미만일 때만 보존된다. 그보다 길면 애초에 SRN 이 아니다.
    const body = typeof r.body === 'string' && r.body.length > 0 ? norm(r.body) : null

    cards.push({
      articleId: id,
      runId: String(r.runId ?? ''),
      title,
      bodyLength: len,
      lengthBasis: 'body',
      titleBodyRefLength: titleBodyRefLength(title, len),
      body,
      sourceSite: String(r.sourceSite ?? ''),
      url: String(r.url ?? ''),
      score: Number(r.score ?? 0),
      lane: String(r.lane ?? ''),
      imageCount: Number(r.imageCount ?? 0),
      commentCount: Number(r.commentCount ?? 0),
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
 *    (TSV 를 읽는 쪽이 위치로 읽는다 — 중간 삽입은 조용한 오독이 된다)
 */
export const EXPORT_COLUMNS: readonly string[] = [
  'decision', 'axis', 'sourceArticleId', 'sourceSite', 'url', 'score', 'lane',
  'bodyLength', 'lengthBasis', 'titleBodyRefLength', 'imageCount', 'commentCount',
  'safetyVerdict', 'safetyReasons', 'title', 'memo', 'note',
] as const

export type DecisionState = { v?: string; memo?: string }

export type ExportRow = {
  decision: string; axis: string; sourceArticleId: string; sourceSite: string
  url: string; score: number; lane: string
  bodyLength: number; lengthBasis: string; titleBodyRefLength: number
  imageCount: number; commentCount: number
  safetyVerdict: string; safetyReasons: string; title: string; memo: string; note: string
}

/**
 * 승인 결과 행 — 🔴 **사람이 누른 것만** 나간다.
 *    누르지 않은 후보를 기본값으로 채워 내보내면 "승인" 이 사람의 행위가 아니게 된다.
 */
export function exportRows(
  cards: readonly SrnCard[],
  state: Readonly<Record<string, DecisionState>>,
): ExportRow[] {
  const out: ExportRow[] = []
  for (const c of cards) {
    const st = state[c.articleId]
    const v = st?.v ?? ''
    if (!v) continue
    out.push({
      decision: v,
      axis: SRN_AXIS,
      sourceArticleId: c.articleId,
      sourceSite: c.sourceSite,
      url: c.url,
      score: c.score,
      lane: c.lane,
      bodyLength: c.bodyLength,
      lengthBasis: c.lengthBasis,
      titleBodyRefLength: c.titleBodyRefLength,
      imageCount: c.imageCount,
      commentCount: c.commentCount,
      safetyVerdict: c.safetyVerdict,
      safetyReasons: c.safetyReasons,
      title: c.title,
      memo: st?.memo ?? '',
      note: NOT_PUBLISH_NOTE,
    })
  }
  return out
}

const cell = (v: unknown): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

export function exportTsv(rows: readonly ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join('\t')]
  for (const r of rows) {
    lines.push(EXPORT_COLUMNS.map((k) => cell((r as unknown as Record<string, unknown>)[k])).join('\t'))
  }
  return lines.join('\n')
}
