/**
 * 발행 후보 파일 계약 — 🔴 **발행이 아니다. 후보를 한곳에 모을 뿐이다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AH
 *
 * 🔴 **이 파일이 무엇이 아닌지부터.**
 *    발행이 아니다. DB write 가 아니다. 발행 큐가 아니다. 자동 라우팅이 아니다.
 *    두 레인에서 **사람이 고른 글**을 한 파일로 모아, 다음 결정을 사람이 내릴 수 있게 할 뿐이다.
 *
 * 🔴 **원문이 들어가지 않는다.** `body` 는 **사람이 고른 글**이다 —
 *    Seed 는 템플릿으로 만든 초안, Raw 는 사람이 다시 쓴 글이다.
 *    원문 `bodyHead` 는 두 입력 어디에서도 가져오지 않는다.
 */

/** 🔴 SRN(APPROVE)은 이 파일에 오지 않는다 — noindex 정책이 달라 경로가 따로다(§4-AH ③) */
export type CandidateType = 'seedOriginality' | 'rawOriginality'

export const PUBLISH_NOTE = '발행 아님 · 발행 후보일 뿐 · 사람 확인 전 사용 금지'

/**
 * 컬럼 — 🔴 언제나 맨 뒤에만 더한다. TSV 를 위치로 읽는 쪽이 있다.
 * 🔴 `bodyHead`·`sourceBody` 는 없다. `body` 는 **사람이 고른 글**이다.
 */
export const PUBLISH_COLUMNS: readonly string[] = [
  'candidateType', 'sourceArticleId', 'sourceSite', 'sourceInput', 'sourceDecision',
  'title', 'body', 'safetyVerdict', 'maxOverlap', 'leakedTokens',
  'reviewedAt', 'writtenAt', 'provenanceNote',
] as const

export type PublishCandidate = {
  candidateType: CandidateType
  sourceArticleId: string
  sourceSite: string
  /** 어느 파일에서 왔나 */
  sourceInput: string
  /** 그 파일에서 사람이 누른 것 — `ADOPT` 또는 `SAVE` */
  sourceDecision: string
  title: string
  /** 🔴 사람이 고른 글이다. 원문이 아니다 */
  body: string
  safetyVerdict: string
  maxOverlap: number
  leakedTokens: string
  reviewedAt: string
  writtenAt: string
  provenanceNote: string
}

/**
 * 같은 글인가를 가르는 키 — 🔴 **`sourceArticleId` 만으로는 안 된다.**
 *
 * Seed 는 한 원천에서 초안이 여러 개 나오고, **그중 둘 이상이 채택될 수 있다.**
 * 실측(2026-09-06): ADOPT 10건의 고유 `sourceArticleId` 는 5개였고,
 * `34999239` 는 "후라이팬 언제 바꾸세요?" 와 "주방에서 제일 오래 쓴 물건이 뭐예요?" 로
 * **서로 다른 두 글**이 채택돼 있었다. id 로만 묶으면 하나가 조용히 사라진다.
 *
 * 🔴 `draftNo` 도 키가 될 수 없다. `DRAFTS_PER_SOURCE` 를 3에서 2로 줄이면서
 *    번호가 밀렸다 — 같은 제목이 r2 에서는 #3, r3 에서는 #2 다.
 *    **번호는 회차마다 뜻이 달라진다. 제목은 그렇지 않다.**
 */
export function candidateKey(articleId: string, title: string): string {
  return `${articleId} ${title.replace(/\s+/g, ' ').trim()}`
}

/** 시각 비교 — 빈 값은 항상 진다 */
function isNewer(a: string, b: string): boolean {
  if (b === '') return true
  if (a === '') return false
  return a > b
}

/**
 * 중복을 정리한다 — 🔴 **같은 글이면 최신 `reviewedAt` 이 이긴다.**
 *
 * 같은 초안이 회차를 넘어 두 번 검수될 수 있다(§4-AE 재탕). 그때 남길 것은
 * **나중 판단**이다 — 사람이 다시 봤다면 그쪽이 최신 의사다.
 */
export function dedupe(rows: readonly PublishCandidate[]): {
  kept: PublishCandidate[]
  dropped: { key: string; keptFrom: string; droppedFrom: string }[]
} {
  const best = new Map<string, PublishCandidate>()
  const dropped: { key: string; keptFrom: string; droppedFrom: string }[] = []
  for (const r of rows) {
    const k = candidateKey(r.sourceArticleId, r.title)
    const cur = best.get(k)
    if (!cur) { best.set(k, r); continue }
    if (isNewer(r.reviewedAt, cur.reviewedAt)) {
      dropped.push({ key: k, keptFrom: r.sourceInput, droppedFrom: cur.sourceInput })
      best.set(k, r)
    } else {
      dropped.push({ key: k, keptFrom: cur.sourceInput, droppedFrom: r.sourceInput })
    }
  }
  const kept = [...best.values()].sort((a, b) =>
    a.candidateType.localeCompare(b.candidateType)
    || a.sourceArticleId.localeCompare(b.sourceArticleId)
    || a.title.localeCompare(b.title))
  return { kept, dropped }
}

const cell = (v: unknown): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

export function toTsv(rows: readonly PublishCandidate[]): string {
  return [
    PUBLISH_COLUMNS.join('\t'),
    ...rows.map((r) => PUBLISH_COLUMNS
      .map((c) => cell((r as unknown as Record<string, unknown>)[c])).join('\t')),
  ].join('\n') + '\n'
}
