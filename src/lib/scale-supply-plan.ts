/**
 * 규모별 공급 능력 계산 — 🔴 **순수 함수. 네트워크·LLM·DB 0**
 *
 * 목표 발행량에서 **내부 생산량**(수집 → 판정 → 초안 → Queue)을 역산하고,
 * 지금 실제로 도는 수집 능력과 대조한다.
 *
 * 🔴 **세 가지를 반드시 나눈다** (2026-09-08 — 섞어 쓰다 100/day 를 READY 로 잘못 적었다).
 *      현재(current)  = launchctl 에 **올라와 있는** job 이 실제로 여는 건수
 *      준비(prepared) = 템플릿까지 만들어 뒀지만 **아직 올리지 않은** 것까지 포함한 건수
 *      필요(required) = 목표를 채우려면 있어야 하는 건수
 *    "템플릿이 있다" 는 "돌고 있다" 가 아니다. 그 둘을 한 숫자로 합치면
 *    아무도 등록하지 않은 job 을 능력으로 세게 된다.
 *
 * 🔴 **통과율은 근거와 숫자가 일치해야 한다.** 근거 없이 채운 값은 `assumed` 로 표시하고,
 *    하나라도 assumed 면 이 계산은 READY 판정에 쓸 수 없다(`proven === false`).
 */

import { derive, type ScaleProfile } from './scale-profile'
import {
  RUNS_PER_DAY, SOURCE_FACTS, effectiveDetailPerDay, effectiveDetailPerDayOf,
  factsOf, theoreticalDetailPerDay, thin82cookCapPerRun, verifySchedule,
  type Phase, type SourceId,
} from './collect-schedule'
import { BREAKER, FAILURE_CLASSES, breakerOf, budgetOf, type GuardState } from './collect-guard'
import {
  JOB_LABELS, currentCapacity, inventoryMismatches, preparedCapacity, runsPlannedMulti,
  type InventoryMismatch, type ObservedJob,
} from './collect-inventory'

// ─────────────────────────────────────────────────────────
// ① 통과율 — 🔴 근거를 함께 적고, 비율은 근거에서 **계산한다**
// ─────────────────────────────────────────────────────────

export type YieldStage = 'listToDetail' | 'detailToJudge' | 'judgePass' | 'draftPass'

export type YieldEvidence = {
  stage: YieldStage
  label: string
  /** 🔴 실측. `n / of` 가 곧 비율이다 — 비율을 따로 적지 않는다 */
  observed: { n: number; of: number; when: string; note: string } | null
  /** 🔴 실측이 없을 때만. 왜 이 값인지 적는다 */
  assumed: { rate: number; why: string } | null
}

/**
 * 🔴 근거표. **비율을 손으로 적지 않는다** — `rateOf` 가 `n / of` 로 계산한다.
 *    예전에는 `listToDetail: 0.05` 라고 적어 두고 주석에는 1,147→10 이라고 썼다.
 *    1,147→10 은 0.87% 다. 주석과 숫자가 6배 달랐고, 그 위에서 100/day 를 계산했다.
 */
export const YIELD_EVIDENCE: readonly YieldEvidence[] = [
  {
    stage: 'listToDetail',
    label: '목록 → 본문을 읽을 대상',
    observed: {
      n: 10, of: 1147, when: '2026-09-07 82cook 목록 수집',
      note: '제외 1,137건은 대부분 "82cook 이 아니다"·"댓글 5개 미만"·"이미 읽음"',
    },
    assumed: null,
  },
  {
    stage: 'detailToJudge',
    label: '읽은 본문 → 의미 판정 대상',
    observed: {
      n: 12, of: 16, when: '2026-09-07 adapt→judge',
      note: '상세 16건 중 4건은 deterministic 으로 끝나 모델을 부르지 않는다',
    },
    assumed: null,
  },
  {
    stage: 'judgePass',
    label: '의미 판정 통과',
    observed: null,
    assumed: { rate: 0.5, why: '🔴 회차별 실측을 아직 모으지 않았다 — 절반으로 둔다(보수적)' },
  },
  {
    stage: 'draftPass',
    label: '초안 품질 게이트 통과',
    observed: null,
    assumed: { rate: 0.7, why: '🔴 회차별 실측을 아직 모으지 않았다 — 7할로 둔다' },
  },
]

/** 🔴 비율은 여기서만 나온다. 실측이 있으면 실측이 이긴다 */
export function rateOf(e: YieldEvidence): number {
  if (e.observed !== null) {
    if (e.observed.of <= 0) return 0
    return e.observed.n / e.observed.of
  }
  return e.assumed?.rate ?? 0
}

export const YIELD: Readonly<Record<YieldStage, number>> = Object.freeze(
  Object.fromEntries(YIELD_EVIDENCE.map((e) => [e.stage, rateOf(e)])) as Record<YieldStage, number>,
)

/** 🔴 근거가 없는 단계 — 하나라도 있으면 이 계산은 READY 판정 근거가 되지 못한다 */
export const ASSUMED_STAGES: readonly YieldStage[] =
  YIELD_EVIDENCE.filter((e) => e.observed === null).map((e) => e.stage)

/** 🔴 LLM 호출 — judge 1회 + draft 1회. 재시도는 세지 않는다(있으면 그만큼 더다) */
export const LLM_CALLS = { perJudge: 1, perDraft: 1 } as const

// ─────────────────────────────────────────────────────────
// ② 수집원 — 🔴 템플릿 값이 정본. fixture 가 실제 plist 와 대조한다
// ─────────────────────────────────────────────────────────

export type SourcePlan = {
  id: string
  /** launchd 템플릿 파일명 (fixture 가 이 파일을 읽어 아래 값을 대조한다) */
  template: string
  /**
   * 한 회차가 여는 최대 상세 건수.
   * 🔴 82cook 은 템플릿 인자(`--auto-max`)에서 온다.
   * 🔴 네이버 두 카페는 인자에 없다 — runner 가 `BOARD_TARGETS` 와 하루 요청 상한에서
   *    역산한 회차당 상세 몫이다(fixture 가 `planCafeRun` 과 대조한다).
   */
  maxPerRun: number
  /** 템플릿에 적힌 하루 회차 수 (StartCalendarInterval 슬롯 수) */
  runsPerDay: number
  /** 🔴 **launchctl 에 실제로 올라와 있는가** — 2026-09-11 `launchctl list` 실측 */
  loaded: boolean
  note: string
}

/**
 * 🔴 확정 수집원 셋. `loaded` 는 실측값이다 —
 *    82cook 은 두 job(raw · 얇은 상세) 다 템플릿이 있는데도 **올라와 있지 않다.**
 *    올라오기 전까지 82cook 이 여는 상세는 0 이다. 조건부로 열리던 옛 몫은 없다.
 *
 * 🔴 **네이버 두 카페의 정본은 `-multi` job 이다** (2026-09-11 실측).
 *    1회판 job 과 그 템플릿은 없다 — 옛 09:20/13:20 · 하루 1회는 역사이지 현재가 아니다.
 */
export const SOURCES: readonly SourcePlan[] = [
  {
    id: '82cook', template: 'com.soransoran.raw-collect-82cook.plist.template',
    maxPerRun: 30, runsPerDay: 10, loaded: false,
    note: '🔴 템플릿만 있고 launchctl 미등록 — 등록 전까지 82cook 상세는 0 이다',
  },
  {
    id: 'navercafe:remonterrace',
    template: 'com.soransoran.navercafe-collect-remonterrace-multi.plist.template',
    maxPerRun: 12, runsPerDay: 4, loaded: true,
    note: 'launchd -multi 4회/day (04:20 · 10:20 · 16:20 · 22:20 KST) · 회차당 상세 12건(jjong 10 + humor 2)',
  },
  {
    id: 'navercafe:wgang',
    template: 'com.soransoran.navercafe-collect-wgang-multi.plist.template',
    maxPerRun: 10, runsPerDay: 4, loaded: true,
    note: 'launchd -multi 4회/day (02:50 · 08:50 · 14:50 · 20:50 KST) · 회차당 상세 10건(all)',
  },
]

/**
 * 🔴 **원천 하나가 큐 한 줄이 되지 않는다.** 몇 배를 열어야 하는가.
 *
 *    예전에는 `shortfall * 4` 라고 코드에 4 를 적어 두었다. 그 4 는 통과율의 역수인데,
 *    통과율이 바뀌어도 4 는 그대로였다 — 두 곳이 어긋나도 아무도 몰랐다.
 *    이제 통과율에서 계산한다: 상세 → Queue = detailToJudge × judgePass × draftPass.
 */
export function detailPerQueueItem(): number {
  const rate = YIELD.detailToJudge * YIELD.judgePass * YIELD.draftPass
  return rate > 0 ? Math.ceil(1 / rate) : 0
}

/**
 * 🔴 **`supplyCapacity()` 를 없앴다** (2026-09-08).
 *
 *    이 파일에는 능력 계산이 **두 벌** 있었다.
 *      · 관측 기반 `currentCapacity(observed)` = 20/day  (collect-inventory)
 *      · 정적 `SOURCES[].loaded` 기반 `supplyCapacity()` = 60/day  (여기)
 *    `findBottlenecks` 는 뒤엣것을 썼다 — 아무도 등록하지 않은 job 과
 *    조건부로만 도는 몫이 **지금 열리는 능력**으로 세어졌다.
 *
 *    이제 current 의 정본은 **관측 하나뿐**이다(`collect-inventory.currentCapacity`).
 *    `SOURCES[].loaded` 는 문서용 메모로만 남기고 판정에 쓰지 않는다.
 */

/**
 * 🔴 **82cook 얇은 상세 job 의 몫** (2026-09-11).
 *
 *    2026-09-11 이전에는 이 몫이 중앙 러너 안의 **조건부 수집**이었다 — 재고가 목표에
 *    못 미칠 때만 열렸다. 그래서 "재고가 찼을 때는 0인 능력" 이 상시 능력으로 세어졌고,
 *    화면은 초록인데 실제 신규는 며칠씩 0 이었다.
 *
 *    지금은 **예약 job** 이다. 조건이 없으므로 따로 셀 이유도 없다 —
 *    `currentCapacity` 가 보는 관측에 그대로 들어간다. 이 함수는 그 job 하나만 본다.
 */
export const THIN_82COOK_JOB = 'com.soransoran.supply-collect-82cook-thin'

export function thin82cookDetailPerDay(observed: readonly ObservedJob[]): number {
  const hit = observed.find((o) => o.loaded && o.label === THIN_82COOK_JOB)
  if (hit === undefined) return 0
  // 🔴 회차 수는 **실제 슬롯 수**다 — 계획한 수가 아니라 올라와 있는 수를 센다
  return thin82cookCapPerRun() * hit.slots.length * factsOf('82cook').detailSuccessRate.value
}

// ─────────────────────────────────────────────────────────
// ③ 역산
// ─────────────────────────────────────────────────────────

export type SupplyPlan = {
  dailyTarget: number
  stockTarget: number
  queuePerDay: number
  draftPerDay: number
  judgePerDay: number
  detailPerDay: number
  listPerDay: number
  llmCallsPerDay: number
  /** 🔴 밖으로 나가는 상세 요청 수 = detailPerDay (남의 서버를 두드리는 횟수) */
  externalDetailRequestsPerDay: number
  /** 🔴 통과율에 가정이 섞였는가. true 면 이 숫자로 READY 라고 말하지 않는다 */
  proven: boolean
  assumedStages: readonly YieldStage[]
}

/**
 * 🔴 목표 → 내부 생산량. **역산은 여기 하나뿐이다.**
 *    `internalDailyTarget` 은 공개 발행과 별개다 — 공개 10/day 라도 내부는 100/day 를 돌릴 수 있다.
 */
export function planSupply(p: ScaleProfile, internalDailyTarget?: number): SupplyPlan {
  const d = derive(p)
  const queuePerDay = internalDailyTarget ?? p.dailyTarget
  const draftPerDay = Math.ceil(queuePerDay / YIELD.draftPass)
  const judgePerDay = Math.ceil(draftPerDay / YIELD.judgePass)
  const detailPerDay = Math.ceil(judgePerDay / YIELD.detailToJudge)
  const listPerDay = Math.ceil(detailPerDay / YIELD.listToDetail)
  return {
    dailyTarget: p.dailyTarget,
    stockTarget: d.stockTarget,
    queuePerDay, draftPerDay, judgePerDay, detailPerDay, listPerDay,
    llmCallsPerDay: judgePerDay * LLM_CALLS.perJudge + draftPerDay * LLM_CALLS.perDraft,
    externalDetailRequestsPerDay: detailPerDay,
    proven: ASSUMED_STAGES.length === 0,
    assumedStages: ASSUMED_STAGES,
  }
}

/** 🔴 목표를 채우려면 각 수집원이 하루 몇 회차 돌아야 하는가 */
export type RunRequirement = {
  id: string
  maxPerRun: number
  runsNow: number
  /** 이 수집원 하나로 필요량을 감당하려면 */
  runsNeededAlone: number
  /** 지금 등록돼 있는가 */
  loaded: boolean
}

export function requiredRuns(plan: SupplyPlan): RunRequirement[] {
  return SOURCES.map((s) => ({
    id: s.id, maxPerRun: s.maxPerRun, loaded: s.loaded,
    runsNow: s.loaded ? s.runsPerDay : 0,
    runsNeededAlone: Math.ceil(plan.detailPerDay / s.maxPerRun),
  }))
}

// ─────────────────────────────────────────────────────────
// ④ 비용 — 🔴 단가를 모르면 **계산하지 않는다**
// ─────────────────────────────────────────────────────────

export const COST_ENV = {
  perJudge: 'SORAN_LLM_COST_PER_JUDGE_USD',
  perDraft: 'SORAN_LLM_COST_PER_DRAFT_USD',
  dailyBudget: 'SORAN_LLM_DAILY_BUDGET_USD',
} as const

export type Pricing = { perJudgeUsd: number; perDraftUsd: number; dailyBudgetUsd: number | null }

/** 🔴 환경에서 단가를 읽는다. 하나라도 없거나 숫자가 아니면 `null` — 추정하지 않는다 */
export function readPricing(env: Readonly<Record<string, string | undefined>>): Pricing | null {
  const num = (v: string | undefined): number | null => {
    if (v === undefined || v.trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const j = num(env[COST_ENV.perJudge])
  const d = num(env[COST_ENV.perDraft])
  if (j === null || d === null) return null
  return { perJudgeUsd: j, perDraftUsd: d, dailyBudgetUsd: num(env[COST_ENV.dailyBudget]) }
}

export type CostEstimate = {
  known: boolean
  dailyUsd: number | null
  /** 🔴 예산이 허용하는 하루 최대 Queue 적재 수 — 안전 상한 */
  safeQueuePerDay: number | null
  reason: string
}

export function estimateCost(plan: SupplyPlan, pricing: Pricing | null): CostEstimate {
  if (pricing === null) {
    return {
      known: false, dailyUsd: null, safeQueuePerDay: null,
      reason: `단가 미설정 — ${COST_ENV.perJudge} · ${COST_ENV.perDraft} 를 넣어야 계산한다 (추정하지 않는다)`,
    }
  }
  const dailyUsd = plan.judgePerDay * pricing.perJudgeUsd + plan.draftPerDay * pricing.perDraftUsd
  if (pricing.dailyBudgetUsd === null) {
    return { known: true, dailyUsd, safeQueuePerDay: null, reason: `예산 미설정 (${COST_ENV.dailyBudget}) — 안전 상한 없음` }
  }
  // 🔴 Queue 1건당 비용으로 나눈다. 0 이면 나눌 수 없다 — 상한 없음으로 둔다
  const perQueue = plan.queuePerDay > 0 ? dailyUsd / plan.queuePerDay : 0
  const safeQueuePerDay = perQueue > 0 ? Math.floor(pricing.dailyBudgetUsd / perQueue) : null
  return {
    known: true, dailyUsd, safeQueuePerDay,
    reason: safeQueuePerDay === null
      ? '건당 비용 0 — 상한 없음'
      : `예산 $${pricing.dailyBudgetUsd}/day ÷ 건당 $${perQueue.toFixed(4)} = ${safeQueuePerDay}건/day`,
  }
}

// ─────────────────────────────────────────────────────────
// ⑤ 병목
// ─────────────────────────────────────────────────────────

export type Bottleneck = { stage: string; severity: 'BLOCK' | 'WARN'; detail: string }

/**
 * 🔴 **수집 여유 기준 — 이 상수 하나가 정본이다** (기존 "여유 30% 미만" 규칙).
 *
 *    필요량이 능력의 70% 를 넘으면 여유가 30% 미만이다. 회차·성공률이 조금만 흔들려도
 *    그날 큐가 마르므로, 준비 완료라고 부르려면 **능력 ≥ 필요량 ÷ 0.7** 이어야 한다.
 *    여기 한 곳에서만 정한다 — 병목 판정과 준비도 판정이 서로 다른 여유를 쓰면
 *    한 화면은 경고를 띄우고 다른 화면은 READY 라고 적는다.
 */
export const COLLECT_MARGIN_RATIO = 0.7

/** 🔴 이 필요량을 여유까지 갖춰 감당하려면 능력이 얼마여야 하는가 */
export function requiredCapacityWithMargin(detailPerDay: number): number {
  return Math.ceil(detailPerDay / COLLECT_MARGIN_RATIO)
}

/**
 * 🔴 병목 — **무엇이 먼저 막히는가.**
 *
 *    `limits` 를 넘기지 않으면 **실제 상수·실측 등록 상태**를 쓴다.
 *    fixture 가 손으로 넣은 숫자로만 돌면, 실제 상한이 바뀌어도 통과한다.
 */
export function findBottlenecks(plan: SupplyPlan, limits?: {
  collectCapMax: number
  runsPerDay: number
  registeredSources: number
}, observed: readonly ObservedJob[] = []): Bottleneck[] {
  /**
   * 🔴 **current 는 관측에서만 나온다.** 정적 `loaded` 를 쓰던 예전 판은
   *    미등록 job 과 조건부 수집 몫까지 세어 60건이라고 말했다(실제 20건).
   */
  const cur = currentCapacity(observed)
  const collectCapacity = limits === undefined
    ? cur.effectivePerDay
    : limits.collectCapMax * limits.runsPerDay
  const registered = limits?.registeredSources ?? cur.perSource.filter((s) => s.registered).length
  const out: Bottleneck[] = []

  if (plan.detailPerDay > collectCapacity) {
    out.push({
      stage: 'collect', severity: 'BLOCK',
      detail: `하루 ${plan.detailPerDay}건을 읽어야 하는데 지금 열리는 것은 ${Math.round(collectCapacity)}건`,
    })
  } else if (plan.detailPerDay > collectCapacity * COLLECT_MARGIN_RATIO) {
    out.push({
      stage: 'collect', severity: 'WARN',
      detail: `수집 여유 ${Math.round((1 - COLLECT_MARGIN_RATIO) * 100)}% 미만`
        + ` (${plan.detailPerDay}/${Math.round(collectCapacity)})`,
    })
  }
  if (registered < SOURCE_FACTS.length) {
    const missing = cur.perSource.filter((s) => !s.registered).map((s) => s.id)
    out.push({
      stage: 'source', severity: 'WARN',
      detail: `수집원 ${registered}/${SOURCE_FACTS.length} 등록 — 미등록: ${missing.join(', ')}`,
    })
  }
  // 🔴 통과율에 가정이 섞였으면 그것도 병목이다 — 숫자가 아니라 근거가 없다
  if (!plan.proven) {
    out.push({
      stage: 'yield', severity: 'WARN',
      detail: `통과율 실측 없음: ${plan.assumedStages.join(', ')} — 이 숫자로 READY 라고 말하지 않는다`,
    })
  }
  const perSource = Math.ceil(plan.detailPerDay / SOURCE_FACTS.length)
  if (perSource > 200) {
    out.push({ stage: 'source', severity: 'WARN', detail: `수집원당 하루 ${perSource}건 — 세션·robots 부담` })
  }
  return out
}

// ─────────────────────────────────────────────────────────
// ⑥ 수집 준비도 — 🔴 **모자라면 BLOCKED 다. "근접한다" 는 판정이 아니다** (2026-09-08)
//
//    예전 fixture 는 `detailPerDay('start') >= 380` 이라고 적어 두고 통과했다.
//    필요량은 382 였다. 즉 **필요량보다 작은 수를 손으로 낮춘 문턱에 맞춰 통과시킨 것**이다.
//    게다가 380 은 성공률을 곱하지 않은 이론 최대였다.
//
//    준비도는 세 가지를 모두 요구한다.
//      ① 계획이 성립하는가 — 간격·부하·겹침, 그리고 **놓침 상한을 계산할 수 있는가**
//      ② 보호장치가 붙어 있는가 — 예산 · 지수 backoff · 분류별 차단기
//      ③ 유효 처리량이 필요량을 **여유(30%)까지 포함해** 넘는가
// ─────────────────────────────────────────────────────────

export type ReadinessStatus = 'READY' | 'BLOCKED'

export type SourceReadiness = {
  id: SourceId
  status: ReadinessStatus
  reasons: string[]
  /** 🔴 **설정된** 하루 상세 처리량 (슬롯 × 상한). `current` 가 아니다 */
  configuredPerDay: number
  /** 🔴 다회 계획대로 올렸을 때 (템플릿 · 계획) */
  preparedPerDay: number
  /** 계획한 다회 job 이 실제로 올라와 있는가 */
  multiRegistered: boolean
  /** 지금 올라와 있는 job 의 label — 없으면 null */
  currentLabel: string | null
}

/**
 * 🔴 소스 하나의 준비도.
 *
 *    **세 가지를 모두 요구한다.**
 *      ① 계획이 성립하는가 — 간격·부하·겹침, 그리고 놓침 상한을 계산할 수 있는가
 *      ② 보호장치가 붙어 있는가 — 없으면 BLOCKED. "아직 안 붙였다" 를 "문제 없다" 로 읽지 않는다
 *      ③ **계획한 다회 job 이 실제로 등록돼 있는가** — 1회판이 도는 것은 준비 완료가 아니다
 *
 *    🔴 `nowMs` 는 **필수**다. 예전 판은 `Date.parse(guard.budgetDay)`(그날 자정)를
 *       차단기 판정에 넘겼다 — 같은 상태가 관제 화면에서는 half-open, 준비도에서는 open 으로
 *       갈렸다. 두 화면이 다른 시각을 보면 어느 쪽도 믿을 수 없다.
 */
export function sourceReadiness(input: {
  id: SourceId
  phase: Phase
  nowMs: number
  guard: GuardState | null
  observed: readonly ObservedJob[]
}): SourceReadiness {
  const { id, phase, nowMs, guard } = input
  const f = factsOf(id)
  const reasons: string[] = []

  for (const p of verifySchedule(id, phase)) reasons.push(`계획: ${p}`)
  if (f.newPerHourFloor === null) reasons.push('신규 유입 실측이 없다 — 얼마나 자주 봐야 놓치지 않는지 모른다')

  // 🔴 ③ 등록 상태 — **관측이 정본이다.** 정적 loaded 플래그를 쓰지 않는다
  const cur = currentCapacity(input.observed).perSource.find((x) => x.id === id)!
  const multiOk = runsPlannedMulti(input.observed, id, phase)
  if (!multiOk) {
    reasons.push(cur.registered
      ? `계획한 다회 job(${JOB_LABELS[id].multi} · ${RUNS_PER_DAY[id][phase]}회)이 아니다`
        + ` — 지금은 ${cur.label} ${cur.runsPerDay}회`
      : `${JOB_LABELS[id].multi} 미등록 — 템플릿만 있고 돌지 않는다`)
  }

  if (guard === null) {
    reasons.push('보호장치 상태가 없다 — 예산·backoff·차단기가 붙지 않았거나 아직 한 번도 돌지 않았다')
  } else {
    const b = budgetOf(guard)
    if (b.exhausted) reasons.push(`하루 요청 예산 소진 (${b.used}/${b.limit})`)
    for (const cls of FAILURE_CLASSES) {
      // 🔴 **실제 지금 시각**으로 본다 — 관제 화면과 같은 값이어야 한다
      if (breakerOf(guard, cls, nowMs) === 'open') {
        reasons.push(`${cls} 차단기가 열려 있다${BREAKER[cls].requiresHuman ? ' — 사람이 확인해야 닫힌다' : ''}`)
      }
    }
  }
  const prep = preparedCapacity(phase).perSource.find((x) => x.id === id)!
  return {
    id, status: reasons.length === 0 ? 'READY' : 'BLOCKED', reasons,
    configuredPerDay: cur.effectivePerDay,
    preparedPerDay: prep.effectivePerDay,
    multiRegistered: multiOk,
    currentLabel: cur.label,
  }
}

export type CollectReadiness = {
  status: ReadinessStatus
  phase: Phase
  /** 필요한 하루 상세 건수 (역산값) */
  requiredPerDay: number
  /** 여유까지 갖추려면 있어야 하는 능력 */
  requiredWithMargin: number
  /**
   * 🔴 **설정된** 처리량 — `loaded` 슬롯 수 × 회차당 상세.
   *
   *    이름이 `currentPerDay` 였을 때 "지금 실제로 나오는 양" 으로 읽혔다.
   *    그 job 이 8회 연속 죽어 있어도 80건/day 라고 말했다 —
   *    등록은 능력이 아니다. 실제 산출은 회차 기록의 `observed` 가 답한다.
   */
  configuredPerDay: number
  /** 🔴 다회 계획대로 올렸을 때 */
  preparedPerDay: number
  /** 이론 최대 — 🔴 판정에 쓰지 않는다. 둘의 차이를 보여주려고 적는다 */
  theoreticalPerDay: number
  /** 등록 상태와 계획이 어긋나는 지점 */
  mismatches: InventoryMismatch[]
  perSource: SourceReadiness[]
  reasons: string[]
}

/**
 * 🔴 계획 전체의 수집 준비도. **하나라도 BLOCKED 면 전체가 BLOCKED 다.**
 *    "두 소스는 괜찮다" 는 위안이지 준비 완료가 아니다.
 *
 * 🔴 **current 와 prepared 를 각각 필요량과 견준다.**
 *      · current 가 모자라면 → 지금 못 돌린다 (등록이 필요하다)
 *      · prepared 가 모자라면 → 올려도 못 돌린다 (계획 자체가 모자라다)
 *    둘을 한 숫자로 합치면 "템플릿을 만들었으니 능력이 늘었다" 가 된다.
 */
export function collectReadiness(input: {
  phase: Phase
  plan: SupplyPlan
  nowMs: number
  observed: readonly ObservedJob[]
  guards?: Partial<Record<SourceId, GuardState>>
}): CollectReadiness {
  const guards = input.guards ?? {}
  const perSource = SOURCE_FACTS.map((f) => sourceReadiness({
    id: f.id, phase: input.phase, nowMs: input.nowMs,
    guard: guards[f.id] ?? null, observed: input.observed,
  }))
  const cur = currentCapacity(input.observed)
  const prep = preparedCapacity(input.phase)
  const required = input.plan.detailPerDay
  const withMargin = requiredCapacityWithMargin(required)
  const reasons: string[] = []

  if (cur.effectivePerDay < required) {
    reasons.push(`설정된 것 ${Math.round(cur.effectivePerDay)}건/day < 필요량 ${required}건/day`
      + ` — ${required - Math.round(cur.effectivePerDay)}건 모자란다 (등록된 job 기준 · 🔴 실제 산출이 아니다)`)
  }
  if (prep.effectivePerDay < required) {
    reasons.push(`준비된 계획 ${Math.round(prep.effectivePerDay)}건/day < 필요량 ${required}건/day`
      + ` — 전부 올려도 ${required - Math.round(prep.effectivePerDay)}건 모자란다`)
  } else if (prep.effectivePerDay < withMargin) {
    reasons.push(`준비된 계획 ${Math.round(prep.effectivePerDay)}건/day 는 필요량 ${required}건은 넘지만`
      + ` 여유 ${Math.round((1 - COLLECT_MARGIN_RATIO) * 100)}% 기준(${withMargin}건)에 못 미친다`)
  }
  // 🔴 통과율에 가정이 섞였으면 이 숫자 자체가 근거가 못 된다
  if (!input.plan.proven) {
    reasons.push(`통과율 실측 없음: ${input.plan.assumedStages.join(', ')} — 이 숫자로 READY 라고 말하지 않는다`)
  }
  for (const s of perSource) {
    if (s.status === 'BLOCKED') reasons.push(`${s.id}: ${s.reasons.join(' / ')}`)
  }
  return {
    status: reasons.length === 0 ? 'READY' : 'BLOCKED',
    phase: input.phase,
    requiredPerDay: required,
    requiredWithMargin: withMargin,
    configuredPerDay: cur.effectivePerDay,
    preparedPerDay: prep.effectivePerDay,
    theoreticalPerDay: theoreticalDetailPerDay(input.phase),
    mismatches: inventoryMismatches(input.observed, input.phase),
    perSource, reasons,
  }
}

/** 사람이 읽을 요약 */
export function describeSupply(plan: SupplyPlan): string {
  return `Queue ${plan.queuePerDay}/day ← draft ${plan.draftPerDay} ← judge ${plan.judgePerDay}`
    + ` ← 상세 ${plan.detailPerDay} ← 목록 ${plan.listPerDay} · LLM ${plan.llmCallsPerDay}회/day`
    + (plan.proven ? '' : ` · 🔴 통과율 가정 ${plan.assumedStages.length}건`)
}
