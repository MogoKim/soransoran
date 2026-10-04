/**
 * D100 공급 **관측 baseline · thin 유량 보고** — 🔴 순수 함수. DB · 시계 · 네트워크 없음
 *
 * 🔴 **이 파일은 보고용이다.** `npm run supply:d100-plan` 화면만 읽는다 — 공급 러너 · 적재기 ·
 *    단계 판정은 이 파일을 읽지 않는다(`supply-d100-plan-check` 가 import 그래프로 잠근다).
 *
 * 🔴 **지운 옛 정본 (2026-09-30 · D100 canon "one loop")** — 📜 HISTORICAL
 *    · `STOCK_BANDS`(100/300/700) · `judgeStockBand`(700 미만 수집 · 이상 no-op) · `stockEta`(재고선 도달 일수)
 *    정본은 완성 글 재고를 성공 기준으로 두지 않는다 — 공급 수요는 `judgeJitDemand`(다가오는 슬롯 − eligible READY)
 *    하나가 정하고, 준비도는 `judgeNextPreflight` 하나가 본다. 700 은 이 화면에서도 더는 눈금이 아니다.
 */

/**
 * 🔴 **D100 READY 생산 계획 범위 — 비권위 용량 계획값** (2026-10-04 · canon §3.1 · C-01).
 *    하루 **생산량** 어림이지 쌓아 둘 재고량도, 단계 판정 문턱도 아니다. 120 은 옛 고정 20% 할증에서 온 상단이다 —
 *    canon 단계 표는 더 이상 READY/day 를 두지 않고, 필요 READY 는 단계 preflight(목표 + 실측 손실)가 정한다.
 *    thin 관측과 단위가 다르다는 것을 보고할 때만 쓴다(이 파일은 판정 경로가 import 하지 않는다).
 */
export const APPROVED_PER_DAY_FLOOR = 100
export const APPROVED_PER_DAY_TARGET = 120

// ─────────────────────────────────────────────────────────
// 🔴 source 별 관측 — **날짜 없는 수는 쓰지 않는다**
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **영구 상수가 아니라 `observedAt` 이 붙은 baseline 이다.**
 *
 *    앞선 판은 `freshPerDay: 8 · 11 · 5` 를 리터럴로 박아 두었다. 그 셋은
 *    **24시간 한 창의 관측**이었고, 82cook 의 5 는 심지어 "하루에 새로 생기는 글" 이
 *    아니라 **이미 쌓인 목록에서 지금 열 수 있는 잔여 대상 수**였다.
 *    그것을 `freshPerDay` 라고 부르는 순간 계획 전체가 거짓 위에 선다.
 *
 * 🔴 지금 값이 궁금하면 `npm run supply:d100-plan` 이 **회차 원장과 DB 에서 다시 센다.**
 *    이 baseline 은 원장이 없을 때의 마지막 관측치일 뿐이다.
 */
export type SourceBaseline = {
  id: string
  /** 🔴 언제 관측했는가. 없는 수는 두지 않는다 */
  observedAt: string
  /** 관측 창 */
  window: string
  /** 목록 한 페이지의 행 수. 모르면 null */
  listRowsPerPage: number | null
  /** 지금 여는 목록 깊이(페이지). 모르면 null */
  pages: number | null
  /** 하루 회차 수 */
  runsPerDay: number
  /** 한 회차가 여는 상세 요청 상한 */
  detailPerRun: number
  /**
   * 🔴 **관측 창에서 새로 나타난 고유 thin 행 수** — 🔴 **`pages` 조건에서의 관측치다.**
   *
   *    앞선 판은 이것을 "이 source 가 하루에 만들어 내는 양이고, 페이지를 깊이 읽어도
   *    늘지 않는다" 고 적었다. 그렇게 단정할 근거가 없었다 — 그 관측은 전부
   *    **목록 1페이지만 읽던 회차**의 것이다. 1페이지 밖의 글은 관측될 기회조차 없었다.
   *    "안 보였다" 와 "없다" 는 다르다.
   *
   *    🔴 이 값은 **source 전체 유량의 상한이 아니다.** `BOARD_TARGETS` 범위를 실제로
   *    열어 본 회차가 나온 뒤에야 유량을 말할 수 있다.
   *    🔴 **관측하지 못했으면 `null`.** 0 도 아니고 추정치도 아니다.
   */
  thinNewPerDay: number | null
  /**
   * 🔴 **이미 쌓인 목록에서 지금 열 수 있는 대상 수** — 1회성이다.
   *    `thinNewPerDay` 와 절대 더하지 않는다. 이것은 재고이고 저것은 유량이다.
   */
  eligibleBacklog: number | null
  /**
   * 🔴 **`detailToApproved` 를 지웠다** (2026-09-11).
   *
   *    상세 1건이 APPROVED 한 줄이 되는 비율이라고 이름 붙여 두고 값은 `1.0` 이었다.
   *    그 1.0 은 "7일 Raw 30건 : Queue 30건" 이라는 **생성 건수 비**에서 나온 것이지
   *    승인 전환율이 아니다. 그런데 능력 계산이 그 값을 곱하고 있었으므로,
   *    **측정되지 않은 전환율이 1.0 인 척하며 thin 수를 APPROVED 수로 바꿔 놓았다.**
   *
   *    🔴 APPROVED 순증가는 상태별 시점 스냅숏이 있어야 나온다. 지금은 없다 —
   *    그래서 이 타입은 thin 만 말하고, APPROVED 는 [[APPROVED_NET_PER_DAY]] 가
   *    `null` 로 말한다. 모르는 것에 1.0 을 곱하지 않는다.
   */
  evidence: string
  /** 🔴 지금 실제로 등록돼 돌고 있는가 */
  scheduled: boolean
}

/** 🔴 2026-09-11 관측. **이 날짜를 지우고 쓰지 않는다** */
export const BASELINE_OBSERVED_AT = '2026-09-11'

export const SOURCE_BASELINE: readonly SourceBaseline[] = Object.freeze([
  {
    id: 'navercafe:remonterrace',
    observedAt: BASELINE_OBSERVED_AT, window: '24h',
    listRowsPerPage: 23, pages: 1, runsPerDay: 4, detailPerRun: 10,
    thinNewPerDay: 8, eligibleBacklog: null, scheduled: true,
    evidence: '24h · 🔴 목록 1p 만 읽던 회차의 관측이다 — 신규 thin 8. '
      + '🔴 이 8 은 1p 조건의 관측이지 source 유량의 상한이 아니다. '
      + 'BOARD_TARGETS(jjong 2~16p · humor 1p)를 실제로 연 회차가 나오면 다시 잰다',
  },
  {
    id: 'navercafe:wgang',
    observedAt: BASELINE_OBSERVED_AT, window: '24h',
    listRowsPerPage: 21, pages: 1, runsPerDay: 4, detailPerRun: 10,
    thinNewPerDay: 11, eligibleBacklog: null, scheduled: true,
    evidence: '24h · 🔴 목록 1p 만 읽던 회차의 관측이다 — 신규 thin 11. '
      + '🔴 이 11 은 1p 조건의 관측이지 source 유량의 상한이 아니다. '
      + 'BOARD_TARGETS(all 1~5p)를 실제로 연 회차가 나오면 다시 잰다',
  },
  {
    id: '82cook',
    observedAt: BASELINE_OBSERVED_AT, window: '1회차(21:10)',
    listRowsPerPage: null, pages: null, runsPerDay: 1, detailPerRun: 50,
    /**
     * 🔴 **하루 신규를 관측하지 못했다.** 회차가 하루 1번뿐이고 그 회차가
     *    `ECONNREFUSED` 로 실패했다 — 유량을 잴 표본이 없다.
     */
    thinNewPerDay: null,
    /** 🔴 목록 1,367행 중 열 수 있는 잔여 대상. **유량이 아니라 재고다** */
    eligibleBacklog: 5,
    scheduled: false,
    evidence: '🔴 전용 job 미등록 — 얇은 상세 job(com.soransoran.supply-collect-82cook-thin)이 '
      + '템플릿까지만 있고 launchctl 에 올라와 있지 않다. 등록 전까지 82cook 상세는 0 이다. '
      + '목록 1,367행 중 열 대상 5건(979 네이버 · 241 댓글<5 · 110 이미 읽음). '
      + '🔴 이 5 는 **잔여 목록**이지 하루 신규가 아니다 — 하루 신규는 미관측',
  },
])

/**
 * 🔴 **APPROVED 순증가는 측정되지 않았다.** 타입이 `null` 로 말한다 —
 *    상태별 시점 스냅숏(언제 어떤 status 가 몇 건이었나)이 있어야 순증가가 나오는데,
 *    지금 있는 것은 Queue 의 **생성 건수**뿐이다. 생성은 순증가가 아니다.
 *
 * 🔴 값이 `null` 인 동안 어떤 계산도 이 자리에 수를 끼워 넣지 않는다.
 *    실제 스냅숏이 쌓이면 그때 타입을 `number` 로 바꾼다.
 */
export const APPROVED_NET_PER_DAY: null = null

export type SourceCapacity = {
  id: string
  /**
   * 🔴 **관측된 하루 신규 thin 수**다. "승인 가능 글/day" 가 아니다.
   *
   *    옛 판은 이 값을 APPROVED/day 라고 불렀다. thin 은 아직 DB 에 들어가지도
   *    않은 수집물이고, 그 사이에 adapt·judge·draft·fill 이 있다.
   *    두 수를 같은 이름으로 부르면 공급이 멈춘 날에도 능력이 있다고 적힌다.
   */
  thinPerDay: number | null
  /**
   * 🔴 이 source 의 **APPROVED 순증가/day** — 항상 `null` 이다(미측정).
   *    이름을 두는 이유는 하나다: 표에 빈칸이 아니라 **"미측정"** 이 찍히게 하려고.
   */
  approvedPerDay: null
  /** 1회성으로 건질 수 있는 잔여분 */
  backlogOnce: number
  /** 지금 회차·상한이 관측된 유량을 감당하는가. 관측이 없으면 null */
  throttled: boolean | null
  reason: string
}

/**
 * 🔴 **모르는 것을 0 으로도 추정치로도 바꾸지 않는다.**
 *    `null` 은 표에서 "미확인" 으로 남고, 합계에 들어가지 않는다.
 */
export function capacityOf(m: SourceBaseline): SourceCapacity {
  const backlogOnce = m.eligibleBacklog ?? 0
  if (m.thinNewPerDay === null) {
    return {
      id: m.id, thinPerDay: null, approvedPerDay: APPROVED_NET_PER_DAY, backlogOnce, throttled: null,
      reason: '🔴 하루 신규 thin 을 관측하지 못했다 — 능력으로 세지 않는다'
        + (backlogOnce > 0 ? ` (잔여 목록 ${backlogOnce}건은 1회성이다)` : ''),
    }
  }
  const perDayOpenable = m.runsPerDay * m.detailPerRun
  return {
    id: m.id,
    // 🔴 thin 수 그대로다. 전환율을 곱하지 않는다 — 그 값은 측정되지 않았다
    thinPerDay: Math.min(m.thinNewPerDay, perDayOpenable),
    approvedPerDay: APPROVED_NET_PER_DAY,
    backlogOnce,
    throttled: perDayOpenable < m.thinNewPerDay,
    reason: perDayOpenable < m.thinNewPerDay
      ? `🔴 회차 ${m.runsPerDay} × 상세 ${m.detailPerRun} = ${perDayOpenable}`
        + ` < 관측 신규 thin ${m.thinNewPerDay} — 상한이 병목이다`
      : `관측 신규 thin ${m.thinNewPerDay}/day (열 수 있는 몫 ${perDayOpenable})`
        + ` · 🔴 목록 ${m.pages ?? '?'}p 조건의 관측이다`,
  }
}

export type SupplyGap = {
  /** 등록돼 돌고 있고 **관측된** source 의 신규 thin 합 */
  thinScheduledPerDay: number
  /** 관측된 전 source 의 신규 thin 합 (미등록 포함) */
  thinAllPerDay: number
  /**
   * 🔴 **APPROVED 순증가/day — 항상 `null`(미측정)이다.**
   *    목표(`wantPerDay`)는 APPROVED 단위인데 관측은 thin 단위다. 두 수를 나란히 두되
   *    **같은 수로 부르지 않는다.**
   */
  approvedPerDay: null
  /** 🔴 능력을 모르는 source 들 — 합계에 넣지 않는다 */
  unconfirmed: readonly string[]
  /** 1회성 잔여분 합 */
  backlogOnce: number
  /** 🔴 APPROVED 단위 목표다 */
  wantPerDay: number
  /**
   * 🔴 **APPROVED 부족분의 하한**이다 — 정확한 부족분이 아니다.
   *
   *    전환율은 측정되지 않았지만 **1 을 넘을 수는 없다**(thin 한 줄이 APPROVED 두 줄이
   *    되지 않는다). 그러므로 `thin/day` 는 `APPROVED/day` 의 상한이고,
   *    `목표 − thin` 은 실제 부족분보다 **작거나 같다.**
   *    "최소 이만큼은 모자란다" 로 읽어야 하고, "이만큼만 채우면 된다" 로 읽으면 안 된다.
   */
  thinShortfallFloorPerDay: number
  perSource: readonly SourceCapacity[]
  reason: string
}

export function judgeSupplyGap(
  baseline: readonly SourceBaseline[] = SOURCE_BASELINE,
  want = APPROVED_PER_DAY_TARGET,
): SupplyGap {
  const perSource = baseline.map(capacityOf)
  const sum = (xs: readonly SourceCapacity[]): number =>
    xs.reduce((a, c) => a + (c.thinPerDay ?? 0), 0)
  const scheduledIds = new Set(baseline.filter((m) => m.scheduled).map((m) => m.id))
  const thinAll = sum(perSource)
  const unconfirmed = perSource.filter((c) => c.thinPerDay === null).map((c) => c.id)
  return {
    thinScheduledPerDay: sum(perSource.filter((c) => scheduledIds.has(c.id))),
    thinAllPerDay: thinAll,
    approvedPerDay: APPROVED_NET_PER_DAY,
    unconfirmed,
    backlogOnce: perSource.reduce((a, c) => a + c.backlogOnce, 0),
    wantPerDay: want,
    thinShortfallFloorPerDay: Math.max(0, want - thinAll),
    perSource,
    reason: `🔴 관측은 신규 thin ${thinAll}/day 이고, 목표 ${want}/day 는 APPROVED 단위다`
      + ' — 전환율이 측정되지 않아 같은 수로 비교할 수 없다. '
      + (thinAll >= want
        ? `thin 만으로는 목표치를 넘는다(전환율에 따라 달라진다)`
        : `thin 은 APPROVED 의 상한이므로 **최소 ${want - thinAll}건** 모자란다`)
      + (unconfirmed.length > 0 ? ` · 유량 미확인 ${unconfirmed.length}종(합계에 넣지 않았다)` : ''),
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 관측에서 역산한 요청량
// ─────────────────────────────────────────────────────────

export type SourceRequestPlan = {
  id: string
  runsPerDay: number
  detailPerRun: number | null
  /** 🔴 **관측된 신규 thin 기준**이다. APPROVED/day 가 아니다 */
  coversThinPerDay: number | null
  reason: string
}

/**
 * 🔴 **역산은 관측된 유량을 놓치지 않는 선까지만 한다.**
 *
 *    목표가 120 이라고 회차를 120 에 맞춰 늘리면, 같은 목록을 하루 수십 번 여는 꼴이 된다 —
 *    그것은 공급이 아니라 차단당하는 길이다.
 *
 * 🔴 **"페이지·회차로는 더 늘릴 수 없다" 고 단정하지 않는다.**
 *    앞선 판이 그렇게 적었는데, 그때 관측값은 **1페이지만 읽던 회차**의 것이었다.
 *    `BOARD_TARGETS` 범위(jjong 2~16p 등)를 실제로 열어 본 뒤에야 유량을 말할 수 있다.
 *
 * 🔴 관측이 없으면 역산하지 않는다. 없는 수로 계획을 세우면 그 계획이 근거가 된다.
 */
export function planSourceRequests(m: SourceBaseline): SourceRequestPlan {
  if (m.thinNewPerDay === null) {
    return {
      id: m.id, runsPerDay: m.runsPerDay, detailPerRun: null, coversThinPerDay: null,
      reason: '🔴 하루 신규 thin 미관측 — 역산하지 않는다. 먼저 회차를 성공시켜 표본을 만든다',
    }
  }
  /** 🔴 여유 1.5배는 회차 실패(관측 5회 중 1회)를 흡수한다 */
  const wantDetail = Math.ceil(m.thinNewPerDay * 1.5)
  const runsPerDay = Math.max(1, m.runsPerDay)
  const detailPerRun = Math.max(1, Math.ceil(wantDetail / runsPerDay))
  return {
    id: m.id, runsPerDay, detailPerRun,
    // 🔴 thin 을 thin 으로 센다. 전환율(미측정)을 곱해 APPROVED 로 바꾸지 않는다
    coversThinPerDay: Math.min(m.thinNewPerDay, runsPerDay * detailPerRun),
    reason: `관측 신규 thin ${m.thinNewPerDay}/day(목록 ${m.pages ?? '?'}p 조건) × 여유 1.5`
      + ` → 상세 ${wantDetail}건/day ÷ ${runsPerDay}회 = 회차당 ${detailPerRun}건`,
  }
}

/**
 * 🔴 **밀린 것을 한 번에 쓸어 담지 않는다.**
 *    페이지를 깊이 읽으면 밀린 글을 가져올 수 있다. 그러나 하루에 전부 열면
 *    그 자체가 비정상 트래픽이다. 며칠에 나눠 여는 **1회성 계획**을 낸다.
 */
export function planBacklogSweep(input: {
  m: SourceBaseline
  toPages: number
  overDays: number
}): { pages: number; rows: number; perDay: number; days: number; reason: string } {
  const from = input.m.pages ?? 0
  const rowsPerPage = input.m.listRowsPerPage ?? 0
  const pages = Math.max(from, Math.floor(input.toPages))
  const rows = Math.max(0, (pages - from) * rowsPerPage)
  const days = Math.max(1, Math.floor(input.overDays))
  return {
    pages, rows, days, perDay: Math.ceil(rows / days),
    reason: rows === 0
      ? '목록 깊이를 모르거나 더 내려갈 페이지가 없다'
      : `${from}p → ${pages}p = 밀린 목록 ${rows}행 · ${days}일에 나눠 하루 ${Math.ceil(rows / days)}행`,
  }
}
