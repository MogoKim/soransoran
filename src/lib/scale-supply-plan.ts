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
  /** 한 회차가 여는 최대 건수 — 템플릿 인자(`--max` / `--auto-max`) */
  maxPerRun: number
  /** 템플릿에 적힌 하루 회차 수 (StartCalendarInterval 슬롯 수) */
  runsPerDay: number
  /** 🔴 **launchctl 에 실제로 올라와 있는가** — 2026-09-08 `launchctl list` 실측 */
  loaded: boolean
  note: string
}

/**
 * 🔴 확정 수집원 셋. `loaded` 는 실측값이다 —
 *    82cook 은 템플릿이 있는데도 **올라와 있지 않다.** 그래서 지금 82cook 상세는
 *    supply-autopilot(21:10, 하루 1회) 안에서만 열린다.
 */
export const SOURCES: readonly SourcePlan[] = [
  {
    id: '82cook', template: 'com.soransoran.raw-collect-82cook.plist.template',
    maxPerRun: 30, runsPerDay: 10, loaded: false,
    note: '🔴 템플릿만 있고 launchctl 미등록 — 지금은 supply-autopilot 안에서만 열린다',
  },
  {
    id: 'navercafe:remonterrace', template: 'com.soransoran.navercafe-collect-remonterrace.plist.template',
    maxPerRun: 10, runsPerDay: 1, loaded: true, note: 'launchd 09:20 KST',
  },
  {
    id: 'navercafe:wgang', template: 'com.soransoran.navercafe-collect-wgang.plist.template',
    maxPerRun: 10, runsPerDay: 1, loaded: true, note: 'launchd 13:20 KST',
  },
]

/**
 * supply-autopilot 이 스스로 여는 몫 — 🔴 상한은 하위 스크립트 BATCH_CAP 이 정한다.
 *
 * 🔴 여기서 `supply-autopilot` 을 import 하지 않는다 — 그쪽이 이 파일의 `detailPerQueueItem`
 *    을 부르므로 순환이 된다. 대신 **fixture 가 `COLLECT_CAP` 과 같은지 대조**한다.
 */
export const AUTOPILOT_COLLECT = { maxPerRun: 50, runsPerDay: 1, note: 'launchd 21:10 KST' } as const

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

export type SupplyCapacity = {
  /** 🔴 지금 실제로 열리는 하루 상세 건수 */
  currentPerDay: number
  /** 🔴 준비된 템플릿을 전부 올렸을 때 */
  preparedPerDay: number
  perSource: { id: string; loaded: boolean; currentPerDay: number; preparedPerDay: number; note: string }[]
}

/** 🔴 능력 계산 — 현재와 준비를 **따로** 낸다 */
export function supplyCapacity(): SupplyCapacity {
  const perSource = SOURCES.map((s) => ({
    id: s.id, loaded: s.loaded, note: s.note,
    currentPerDay: s.loaded ? s.maxPerRun * s.runsPerDay : 0,
    preparedPerDay: s.maxPerRun * s.runsPerDay,
  }))
  const autopilot = AUTOPILOT_COLLECT.maxPerRun * AUTOPILOT_COLLECT.runsPerDay
  return {
    currentPerDay: perSource.reduce((n, s) => n + s.currentPerDay, 0) + autopilot,
    preparedPerDay: perSource.reduce((n, s) => n + s.preparedPerDay, 0) + autopilot,
    perSource,
  }
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
 * 🔴 병목 — **무엇이 먼저 막히는가.**
 *
 *    `limits` 를 넘기지 않으면 **실제 상수·실측 등록 상태**를 쓴다.
 *    fixture 가 손으로 넣은 숫자로만 돌면, 실제 상한이 바뀌어도 통과한다.
 */
export function findBottlenecks(plan: SupplyPlan, limits?: {
  collectCapMax: number
  runsPerDay: number
  registeredSources: number
}): Bottleneck[] {
  const cap = supplyCapacity()
  const collectCapacity = limits === undefined
    ? cap.currentPerDay
    : limits.collectCapMax * limits.runsPerDay
  const registered = limits?.registeredSources ?? SOURCES.filter((s) => s.loaded).length
  const out: Bottleneck[] = []

  if (plan.detailPerDay > collectCapacity) {
    out.push({
      stage: 'collect', severity: 'BLOCK',
      detail: `하루 ${plan.detailPerDay}건을 읽어야 하는데 지금 열리는 것은 ${collectCapacity}건`,
    })
  } else if (plan.detailPerDay > collectCapacity * 0.7) {
    out.push({ stage: 'collect', severity: 'WARN', detail: `수집 여유 30% 미만 (${plan.detailPerDay}/${collectCapacity})` })
  }
  if (registered < SOURCES.length) {
    const missing = SOURCES.filter((s) => !s.loaded).map((s) => s.id)
    out.push({
      stage: 'source', severity: 'WARN',
      detail: `수집원 ${registered}/${SOURCES.length} 등록 — 미등록: ${missing.join(', ')}`,
    })
  }
  // 🔴 통과율에 가정이 섞였으면 그것도 병목이다 — 숫자가 아니라 근거가 없다
  if (!plan.proven) {
    out.push({
      stage: 'yield', severity: 'WARN',
      detail: `통과율 실측 없음: ${plan.assumedStages.join(', ')} — 이 숫자로 READY 라고 말하지 않는다`,
    })
  }
  const perSource = Math.ceil(plan.detailPerDay / SOURCES.length)
  if (perSource > 200) {
    out.push({ stage: 'source', severity: 'WARN', detail: `수집원당 하루 ${perSource}건 — 세션·robots 부담` })
  }
  return out
}

/** 사람이 읽을 요약 */
export function describeSupply(plan: SupplyPlan): string {
  return `Queue ${plan.queuePerDay}/day ← draft ${plan.draftPerDay} ← judge ${plan.judgePerDay}`
    + ` ← 상세 ${plan.detailPerDay} ← 목록 ${plan.listPerDay} · LLM ${plan.llmCallsPerDay}회/day`
    + (plan.proven ? '' : ` · 🔴 통과율 가정 ${plan.assumedStages.length}건`)
}
