/**
 * 🔴 **검사용 원천 증거 기록** (2026-09-30 · source-slot-v1) — 격리 DB · 순수 검사가 같은 모양을 쓴다.
 *
 *   발행 선택기 · 발행 트랜잭션은 이제 `gateResults.sourceEvidence` 가 없으면 행을 eligible 로 보지 않는다
 *   (EVIDENCE_MISSING → 만료 사유). 옛 fixture 는 이 칸이 없어 전부 만료된다 — 그래서 **정상 행 fixture 는
 *   기준 시각 `at` 에 eligible 인 기록**을 이 함수로 싣는다.
 *
 * 🔴 **fixture 가 실제보다 강하지 않게** — 게시 · 목록 · 수집 · 초안 시각을 서로 다른 값으로 둔다
 *    (게시 < 목록 < 수집 < 초안). 게시 시각이 수집 · 초안 시각과 겹치면 적재 시각이 게시 시각으로 새는 회귀를 못 잡는다.
 * 🔴 원문 URL · 제목 · 본문 · 닉네임 없음.
 */
import {
  buildSourceEvidence, SOURCE_EVIDENCE_KEY,
  type SourceEvidenceRecord,
} from '../../src/lib/source-slot-release'

const H = 3_600_000

/**
 * 🔴 기준 시각 `at` 에서 **ageH 시간 전** 게시된 원문 · 반응 관측 · 원천 상대 표본 · 참여 동력이 있는 기록.
 *    기본 ageH=6 — 하루 안 여러 슬롯에서 eligible 로 남는다(72h 전까지).
 */
export function fakeSourceEvidence(at: Date, opts: {
  ageH?: number; site?: string; id?: string
  /** 🔴 원천 상대 댓글 백분위 — 순서를 시험할 때만 준다(기본 0.7) */
  commentsPct?: number
  /** 🔴 게시 시각을 직접 준다(주면 `ageH` 를 무시한다) · `null` 이면 게시 시각 모름 */
  postedAt?: Date | null
} = {}): SourceEvidenceRecord {
  const ageH = opts.ageH ?? 6
  const posted = opts.postedAt instanceof Date ? opts.postedAt : new Date(at.getTime() - ageH * H)
  const listed = new Date(posted.getTime() + 1 * H)
  const captured = new Date(posted.getTime() + 1.1 * H)
  const drafted = new Date(posted.getTime() + 2 * H)
  const site = opts.site ?? 'navercafe:fixture'
  return buildSourceEvidence({
    postedAt: opts.postedAt === null ? null : posted.toISOString(), listedAt: listed.toISOString(), capturedAt: captured.toISOString(),
    sourceSite: site, sourceArticleId: opts.id ?? 'fixture', dedupKey: `${site}|${opts.id ?? 'fixture'}`,
    response: { views: 200, comments: 8, listRank: 2, listPage: 1, observedAt: listed.toISOString() },
    observations: [],
    sourceStats: {
      basis: 'list-artifacts', sourceKey: site, bucket: '<3h', n: 10, commentsPct: opts.commentsPct ?? 0.7, viewsPct: 0.6,
      windowFrom: new Date(at.getTime() - 72 * H).toISOString(), windowTo: at.toISOString(),
    },
    participationDriver: '검사용 참여 동력',
    draftedAt: drafted.toISOString(),
  })
}

/** 🔴 `gateResults` 에 섞어 넣을 한 칸 — `{ ...gate, ...fakeEvidenceGate(at) }` */
export function fakeEvidenceGate(at: Date, opts: Parameters<typeof fakeSourceEvidence>[1] = {}): Record<string, unknown> {
  return { [SOURCE_EVIDENCE_KEY]: fakeSourceEvidence(at, opts) }
}
