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
  buildSourceEvidence, judgeSlotRelease, releaseStampOf, RELEASE_STAMP_KEY, SOURCE_EVIDENCE_KEY, SOURCE_STATS_METHOD,
  type ReleaseStamp, type SourceEvidenceRecord,
} from '../../src/lib/source-slot-release'

const H = 3_600_000

/**
 * 🔴 기준 시각 `at` 에서 **ageH 시간 전** 게시된 원문 · 반응 관측 · 원천 상대 표본 · 참여 동력이 있는 기록.
 *    기본 ageH=6 — 수집 = 게시 + 1.1h = 기준 − 4.9h.
 *    🔴 (2026-11-25 밤 4) 수집 뒤 6시간 만료 — 기본 기록은 **기준 시각 뒤 1.1시간까지만** eligible 이다(그 뒤 자리는
 *       `CAPTURED_TOO_OLD_AT_SLOT`). 하루 여러 자리를 한 기록이 덮는 모양은 이제 실제에 없다 — fixture 도 만들지 않는다.
 *       오래된 원문을 최근에 수집한 모양은 `capturedAt` 으로 준다(원문 나이 · 수집 나이를 따로 시험할 때).
 */
export function fakeSourceEvidence(at: Date, opts: {
  ageH?: number; site?: string; id?: string
  /** 🔴 원천 상대 댓글 백분위 — 순서를 시험할 때만 준다(기본 0.7) */
  commentsPct?: number
  /** 🔴 게시 시각을 직접 준다(주면 `ageH` 를 무시한다) · `null` 이면 게시 시각 모름 */
  postedAt?: Date | null
  /**
   * 🔴 수집 시각을 직접 준다 — 주면 목록 = 수집 − 0.1h · 초안 = 수집 + 0.9h(기본 기록과 같은 간격)다.
   *    게시 시각은 목록보다 앞이어야 한다(부르는 쪽이 지킨다 — 어기면 판정이 POSTED_AFTER_CAPTURE 로 막는다).
   */
  capturedAt?: Date
} = {}): SourceEvidenceRecord {
  const ageH = opts.ageH ?? 6
  const posted = opts.postedAt instanceof Date ? opts.postedAt : new Date(at.getTime() - ageH * H)
  const captured = opts.capturedAt ?? new Date(posted.getTime() + 1.1 * H)
  const listed = new Date(captured.getTime() - 0.1 * H)
  const drafted = new Date(captured.getTime() + 0.9 * H)
  const site = opts.site ?? 'navercafe:fixture'
  return buildSourceEvidence({
    postedAt: opts.postedAt === null ? null : posted.toISOString(), listedAt: listed.toISOString(), capturedAt: captured.toISOString(),
    sourceSite: site, sourceArticleId: opts.id ?? 'fixture', dedupKey: `${site}|${opts.id ?? 'fixture'}`,
    response: { views: 200, comments: 8, listRank: 2, listPage: 1, observedAt: listed.toISOString() },
    observations: [],
    sourceStats: {
      basis: 'list-artifacts', method: SOURCE_STATS_METHOD, sourceKey: site, bucket: '<3h', n: 10, commentsPct: opts.commentsPct ?? 0.7, viewsPct: 0.6,
      // 🔴 (Lane B) 스냅샷은 적재 때(초안 시각) 뜬다 — 판정 시각보다 미래일 수 없다. 앞판은 기준 시각 `at` 을 창 끝으로
      //    써서, `at` 보다 이른 시각에 판정하는 검사가 "미래 표본" 을 들고 있었다(이제 판정이 `windowTo:future` 로 닫는다)
      windowFrom: new Date(drafted.getTime() - 72 * H).toISOString(), windowTo: drafted.toISOString(),
    },
    participationDriver: '검사용 참여 동력',
    draftedAt: drafted.toISOString(),
  })
}

/** 🔴 `gateResults` 에 섞어 넣을 한 칸 — `{ ...gate, ...fakeEvidenceGate(at) }` */
export function fakeEvidenceGate(at: Date, opts: Parameters<typeof fakeSourceEvidence>[1] = {}): Record<string, unknown> {
  return { [SOURCE_EVIDENCE_KEY]: fakeSourceEvidence(at, opts) }
}

/**
 * 🔴 **검사용 release 도장 — 발행 트랜잭션과 같은 길로 만든다.** 트랜잭션은 `judgeSlotRelease({slotAt: txNow, now: txNow})`
 *    결과를 `releaseStampOf` 로 싣는다 — 여기서도 똑같이 부른다. 손으로 칸을 적은 도장(`slotAt:'x'`)은 쓰지 않는다.
 *    `gate` 의 원문 증거가 `publishEventAt` 에 eligible 이 아니면 던진다 — fixture 가 실제보다 강할 수 없다.
 */
export function fakeReleaseStamp(gate: Record<string, unknown>, publishEventAt: Date): ReleaseStamp {
  const v = judgeSlotRelease({
    gateResults: gate, slotAt: publishEventAt, now: publishEventAt,
    hardGates: { ok: true, codes: [] }, assignment: { ok: true }, tieBreak: 'fixture',
  })
  if (v.verdict !== 'eligible') throw new Error(`fixture 원문 증거가 발행 시각에 eligible 이 아니다: ${v.reasons.join(',')}`)
  return releaseStampOf(v)
}

/** 🔴 `{ ...gate, ...fakeReleaseStampGate(gate, at) }` — 발행 트랜잭션이 남기는 도장 한 칸 */
export function fakeReleaseStampGate(gate: Record<string, unknown>, publishEventAt: Date): Record<string, unknown> {
  return { [RELEASE_STAMP_KEY]: fakeReleaseStamp(gate, publishEventAt) }
}
