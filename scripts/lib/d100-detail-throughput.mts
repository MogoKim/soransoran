/**
 * 상세 수집 처리량 **실측** — 🔴 정본 회차 기록만 본다. DB 를 세지 않는다
 *
 * 🔴 **`MicroSeedRawContent` 전체를 세면 안 된다** (2026-09-21 3차 보정).
 *
 *    앞판은 `microSeedRawContent.count({ createdAt >= since })` 로 16.1/day 를 냈다.
 *    그 표에는 **합성 후보 행**이 함께 산다 — 외부 원문을 열지 않고 만든 행도
 *    같은 표에 들어오고, 사람이 손으로 넣은 seed 도 들어온다.
 *    그것을 "상세 수집량" 이라고 부르면 크롤러가 완전히 멎은 날에도 숫자가 오른다.
 *
 * 🔴 **정본은 회차 기록이다.** `collect-runs/*.jsonl` 은 회차마다
 *    "상세를 몇 번 열었고 본문을 몇 개 읽었고 **새로 몇 건이 들어왔는가**" 를 남긴다.
 *    `isDetailSuccess` 를 통과한 회차의 `newUniqueThinRows` 합이 실제 공급량이다.
 *
 * 🔴 기록이 없으면 `unmeasured` 다 — 0 이 아니다.
 */
import { isDetailSuccess, type CollectRunRecord } from '../../src/lib/collect-run-record'

/** 🔴 D100 이 쓰는 공급원. 82cook 은 **필수**지만 지금 회차 기록이 없다 */
export const DETAIL_SOURCES = ['navercafe:wgang', 'navercafe:remonterrace', '82cook'] as const
export type DetailSource = (typeof DETAIL_SOURCES)[number]

export type SourceThroughput = {
  source: DetailSource
  /** 창 안의 성공 회차 수 */
  successRuns: number
  /** 창 안의 실패 회차 수 */
  failedRuns: number
  /** 🔴 성공 회차가 **새로** 만든 상세 행 수. 반복분은 세지 않는다 */
  newDetailRows: number
  /** 🔴 하루 평균. 성공 회차가 하나도 없으면 `null` (unmeasured) */
  perDay: number | null
}

export type DetailThroughput = {
  windowDays: number
  bySource: SourceThroughput[]
  /** 🔴 전체 하루 평균. 한 공급원이라도 잴 수 없으면 그 몫은 0 이 아니라 빠진 것이다 */
  perDay: number | null
  /** 🔴 잴 수 없었던 공급원 */
  unmeasuredSources: DetailSource[]
}

/**
 * 🔴 **성공한 상세 회차의 신규 행만 센다.**
 *    `status:'started'` 기록(짝이 되는 종료가 없는 것)과 scout 회차는 공급이 아니다.
 */
export function detailThroughput(input: {
  windowDays: number
  now: Date
  recordsOf: (source: DetailSource) => readonly CollectRunRecord[]
}): DetailThroughput {
  const since = input.now.getTime() - input.windowDays * 86_400_000
  const bySource: SourceThroughput[] = []
  const unmeasured: DetailSource[] = []
  let total = 0
  let anyMeasured = false

  for (const source of DETAIL_SOURCES) {
    const rows = input.recordsOf(source).filter((r) => {
      const t = Date.parse(r.startedAt)
      return Number.isFinite(t) && t >= since
    })
    const ok = rows.filter(isDetailSuccess)
    const failed = rows.filter((r) => r.status === 'failed')
    const newRows = ok.reduce((n, r) => n + (typeof r.newUniqueThinRows === 'number' ? r.newUniqueThinRows : 0), 0)
    /**
     * 🔴 **회차 기록이 아예 없을 때만 `null` 이다** (2026-09-21 5차 보정).
     *
     *    · 기록 0건        → `null`. job 이 안 돌았는지 기록이 유실됐는지 알 수 없다
     *    · 기록은 있는데 성공 0 → **`0`**. 돌았고 한 건도 못 가져왔다는 **측정된 사실**이다
     *
     *    앞판은 둘을 모두 `null` 로 냈다. 그러면 수집이 계속 실패하는 상황이
     *    "아직 안 재 봤다" 로 보여, 고쳐야 할 것이 화면에서 사라진다.
     */
    const perDay = rows.length === 0
      ? null
      : Math.round((newRows / input.windowDays) * 10) / 10
    if (perDay === null) unmeasured.push(source)
    else { total += perDay; anyMeasured = true }
    bySource.push({ source, successRuns: ok.length, failedRuns: failed.length, newDetailRows: newRows, perDay })
  }

  return {
    windowDays: input.windowDays,
    bySource,
    // 🔴 하나도 재지 못했으면 합계도 `null` 이다
    perDay: anyMeasured ? Math.round(total * 10) / 10 : null,
    unmeasuredSources: unmeasured,
  }
}
