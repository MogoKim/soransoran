/**
 * 네이버 카페 **회차 계획 정본** — 🔴 순수 함수. 네트워크 0 · DB 0 · 파일 0
 *
 * 🔴 **왜 생겼나** (2026-09-11).
 *
 *    `BOARD_TARGETS` 에는 이미 읽기로 정한 게시판과 페이지 범위가 있었다 —
 *    `remonterrace:jjong` 2~16p · `remonterrace:humor` 1p · `wgang:all` 1~5p.
 *    그런데 **launchd 는 그것을 쓰지 않았다.** 등록된 인자는
 *    `--cafe=remonterrace --pages=1 --max=10` 이었고, 계획은 코드에만 있고
 *    운영은 1페이지만 읽었다. 계획과 실행이 두 벌이면 계획 쪽이 죽는다.
 *
 * 🔴 **숫자를 여기 다시 적지 않는다.** 게시판·페이지는 `BOARD_TARGETS`,
 *    회차는 `RUNS_PER_DAY`, 일 상한은 `MAX_REQUESTS_PER_DAY`,
 *    한 실행 상세 상한은 `SLOT_QUOTA` 가 정본이다. 이 파일은 그것들을 곱하고 나눌 뿐이다.
 */
import {
  MAX_REQUESTS_PER_DAY, RUNS_PER_DAY, type Phase, type SourceId,
} from '../../src/lib/collect-schedule'
import { BOARD_TARGETS, pagesOf, slotQuota, sourceSiteOf, type BoardTarget } from './micro-seed-navercafe.mjs'

export type BoardSlice = {
  key: string
  label: string
  startPage: number
  endPage: number
  /** 목록 요청 수 = 페이지 수 */
  pages: number
  /** 🔴 이 게시판이 한 회차에 열 상세 상한 */
  detailMax: number
}

export type CafeRunPlan = {
  cafeId: string
  source: SourceId
  phase: Phase
  runsPerDay: number
  boards: BoardSlice[]
  /** 한 회차의 목록 요청 수 */
  listPerRun: number
  /** 한 회차의 상세 상한 합 */
  detailPerRun: number
  /** 하루 총 요청 (목록 + 상세) */
  requestsPerDay: number
  /**
   * 🔴 회차 시작 전 카페 홈 회원 확인 — 게시판 프로세스마다 1회 (2026-10-07).
   *    목록·상세와 같은 보호장치·예산을 쓴다. `requestsPerDay` 와 따로 두고 상한 판정에 더한다.
   */
  memberCheckPerDay: number
  /** 이 source 의 하루 요청 상한 */
  limitPerDay: number
  /** 🔴 상한 안에 드는가 — `false` 면 실행하지 않는다 */
  withinLimit: boolean
  reason: string
}

/** 🔴 한 실행의 상세 상한 — 네이버는 막히면 **계정**이라 슬롯 quota 를 넘지 않는다 */
export const perBoardCeiling = (cafeId: string): number => slotQuota(cafeId)

/**
 * 🔴 **하루 요청 상한 안에서 목록과 상세를 나눈다.**
 *
 *    목록은 게시판·페이지가 정하므로 먼저 빠지고, 남은 몫이 상세다.
 *    상세를 게시판에 나눌 때는 **페이지 수에 비례**시키되 슬롯 quota 를 넘지 않는다 —
 *    깊은 게시판이 많은 후보를 내므로 그쪽에 더 주는 것이 맞다.
 *
 * 🔴 모르는 카페면 던지지 않고 빈 계획을 낸다. 조용한 0건을 만들지 않기 위해
 *    `withinLimit: false` 와 사유를 함께 낸다.
 */
export function planCafeRun(input: { cafeId: string; phase?: Phase }): CafeRunPlan {
  const phase: Phase = input.phase ?? 'start'
  const source = sourceSiteOf(input.cafeId) as SourceId
  const targets = BOARD_TARGETS.filter((b: BoardTarget) => b.cafeId === input.cafeId)
  const limitPerDay = MAX_REQUESTS_PER_DAY[source]
  const runsPerDay = RUNS_PER_DAY[source]?.[phase] ?? 0

  if (targets.length === 0 || limitPerDay === undefined || runsPerDay === 0) {
    return {
      cafeId: input.cafeId, source, phase, runsPerDay, boards: [],
      listPerRun: 0, detailPerRun: 0, requestsPerDay: 0, memberCheckPerDay: 0,
      limitPerDay: limitPerDay ?? 0, withinLimit: false,
      reason: `🔴 계획을 세울 수 없다 — 게시판 ${targets.length}개 · 회차 ${runsPerDay} · 상한 ${String(limitPerDay)}`,
    }
  }

  const pageCounts = targets.map((t) => pagesOf(t).length)
  const listPerRun = pageCounts.reduce((a, b) => a + b, 0)
  const listPerDay = listPerRun * runsPerDay
  /** 🔴 게시판마다 수집기 프로세스가 따로 돌고, 각자 카페 홈을 한 번 확인한다 */
  const memberCheckPerDay = targets.length * runsPerDay
  /** 🔴 남은 몫이 상세다. 목록·회원 확인이 상한을 이미 먹었으면 상세는 0 이다 */
  const detailBudgetPerRun = Math.max(0, Math.floor((limitPerDay - listPerDay - memberCheckPerDay) / runsPerDay))
  const ceiling = perBoardCeiling(input.cafeId)

  let left = detailBudgetPerRun
  const boards: BoardSlice[] = targets.map((t, i) => {
    const pages = pageCounts[i]!
    const share = Math.ceil((detailBudgetPerRun * pages) / listPerRun)
    const detailMax = Math.max(0, Math.min(ceiling, share, left))
    left -= detailMax
    return {
      key: t.key, label: t.label, startPage: t.startPage, endPage: t.endPage, pages, detailMax,
    }
  })

  const detailPerRun = boards.reduce((a, b) => a + b.detailMax, 0)
  const requestsPerDay = (listPerRun + detailPerRun) * runsPerDay
  const withinLimit = requestsPerDay + memberCheckPerDay <= limitPerDay && detailPerRun > 0
  return {
    cafeId: input.cafeId, source, phase, runsPerDay, boards,
    listPerRun, detailPerRun, requestsPerDay, memberCheckPerDay, limitPerDay, withinLimit,
    reason: detailPerRun === 0
      ? `🔴 상세 몫이 0 이다 — 목록 ${listPerDay}건이 상한 ${limitPerDay}건을 거의 다 먹었다`
      : `목록 ${listPerRun}×${runsPerDay}=${listPerDay} + 상세 ${detailPerRun}×${runsPerDay}=${detailPerRun * runsPerDay}`
        + ` + 회원 확인 ${memberCheckPerDay} = ${requestsPerDay + memberCheckPerDay}건/day ≤ 상한 ${limitPerDay}건`,
  }
}

/** 🔴 실제로 넘길 인자 — 여기서 만들지 않으면 호출부가 즉흥으로 짓는다 */
export function collectArgsFor(b: BoardSlice, opts: { live: boolean; thin: boolean }): string[] {
  return [
    `--board=${b.key}`,
    `--max=${b.detailMax}`,
    ...(opts.thin ? ['--thin'] : []),
    ...(opts.live ? ['--live'] : []),
  ]
}
