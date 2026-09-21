/**
 * 82cook **복구 계약** — 🔴 순수 함수. 네트워크도 파일도 읽지 않는다
 *
 * 🔴 **82cook 은 대체하거나 포기할 공급원이 아니다** (2026-09-21 창업자 정본).
 *    D100 을 위해 반드시 복구해야 하는 **필수 수집원**이다.
 *    대체 공급원을 기본안으로 제안하지 않는다.
 *
 * 🔴 **과거 실패 기록 — 실측** (`collect-guard-82cook.json`, 2026-09-14 07:00 KST)
 *      FORBIDDEN 0 · RATE_LIMIT 0 · **NETWORK 11 연속** · SERVER 0 · OTHER 0
 *      하루 예산은 1/400 만 썼다. 403·429 는 **한 번도 기록되지 않았다.**
 *      수집 실적: 09-07 50행 · 09-08 10행 · 09-09 50행 · 09-11 17행 · 09-12 9행 → 09-14 정지.
 *
 * 🔴 **원인 후보와 확정 원인을 구분한다.**
 *    쿠키 없음 · 상세 직접 접근 · 회차 50건 연속은 **후보**다.
 *    기록된 실패는 NETWORK 뿐이고 상대가 의도적으로 막았다는 직접 증거(403/429/CAPTCHA)는
 *    로그에 없다. IP·DNS·상대 서버 사정도 같은 무게로 남아 있다.
 *    🔴 D10 준비 canary 가 그 둘을 가를 **첫 관측**이다.
 *
 * 🔴 **현재 접근 가능하다는 창업자 확인을 기록한다** (2026-09-21).
 *
 * 🔴 **이번 Phase 0 에서는 실제 호출·등록·활성화를 하지 않는다.**
 */

/** 🔴 복구 단계 — 일정은 창업자가 정한 값이다 */
export const RECOVERY_PHASES = ['phase0', 'd10prep', 'd20prep', 'd30plus'] as const
export type RecoveryPhase = (typeof RECOVERY_PHASES)[number]

export type RecoveryStep = {
  phase: RecoveryPhase
  /** 창업자가 정한 기간 — 없으면 조건부 */
  window: string
  /** 그 단계에서 하는 일 */
  action: string
  /** 🔴 실제 82cook 요청을 보내는가 */
  sendsRequests: boolean
  /** 🔴 launchctl 에 등록하는가 */
  registersJob: boolean
}

export const RECOVERY_PLAN: readonly RecoveryStep[] = [
  {
    phase: 'phase0', window: 'Phase 0 ~ D5',
    action: '상태·과거 실패·예산·접근 방식만 확인한다',
    sendsRequests: false, registersJob: false,
  },
  {
    phase: 'd10prep', window: '2026-10-05 ~ 10-10',
    action: '동일 세션 · 동시성 1 · 아주 적은 페이지 · 충분한 간격으로 read-only canary',
    sendsRequests: true, registersJob: false,
  },
  {
    phase: 'd20prep', window: '2026-10-11 ~ 10-22',
    action: 'canary 가 여러 차례 문제없이 끝났을 때만 보수적 정기 수집 등록 · 실제 신규 detail/day 측정',
    sendsRequests: true, registersJob: true,
  },
  {
    phase: 'd30plus', window: 'D30 이상',
    action: '차단 없이 **관측된** 처리량을 근거로만 단계를 확대한다',
    sendsRequests: true, registersJob: true,
  },
] as const

/**
 * 🔴 **D10 준비 canary 의 초기 계약.** 지금 수집기 값(3~5초 · 회차 50건 · 예산 400)보다
 *    **훨씬 보수적으로** 시작한다. 관측 없이 이 값을 올리지 않는다.
 */
export const CANARY_CONTRACT = Object.freeze({
  /** 🔴 실제 브라우저 세션과 쿠키를 유지한다 — 가짜 쿠키·Referer 조작이 아니다 */
  realBrowserSession: true,
  concurrency: 1,
  maxDetailPerRun: 5,
  minGapMs: 8_000,
  maxGapMs: 15_000,
  minRestBetweenRunsMs: 4 * 3600_000,
  maxRequestsPerDay: 20,
  /** 목록 → 상세 순서를 따른다 */
  listBeforeDetail: true,
  /** 이미 읽은 id 와 목록 위치를 기록해 반복 요청을 줄인다 */
  resumeFromCheckpoint: true,
} as const)

/**
 * 🔴 **목록 요청도 예산에 든다** (2026-09-21 2차 보정).
 *
 *    앞판은 `maxRequestsPerDay: 20` 과 `maxDetailPerRun: 5` 를 나란히 두었을 뿐이라,
 *    읽는 사람마다 "하루 상세 20건" 으로도 "하루 요청 20번" 으로도 읽혔다.
 *    상대 서버가 세는 것은 **요청 수**다 — 목록 페이지도 요청이다.
 *    목록을 예산 밖에 두면 실제 요청이 계약의 두 배가 된다.
 */
export const COUNTS_LIST_REQUESTS_IN_BUDGET = true

/** 🔴 한 회차가 쓰는 요청 수 = 목록 페이지 + 상세 건수 */
export function requestsPerRun(listPages: number, detailCount: number): number {
  return (COUNTS_LIST_REQUESTS_IN_BUDGET ? listPages : 0) + detailCount
}

/**
 * 🔴 **하루 예산 안에서 실제로 열 수 있는 상세 건수.**
 *    "회차당 5건 × 4회 = 20건" 이 아니다 — 목록 요청이 먼저 빠진다.
 */
export function dailyDetailCeiling(input: {
  maxRequestsPerDay: number
  runsPerDay: number
  listPagesPerRun: number
  maxDetailPerRun: number
}): number {
  const listCost = COUNTS_LIST_REQUESTS_IN_BUDGET ? input.listPagesPerRun * input.runsPerDay : 0
  const left = input.maxRequestsPerDay - listCost
  if (left <= 0) return 0
  return Math.min(left, input.runsPerDay * input.maxDetailPerRun)
}

/**
 * 🔴 **네 가지 용량을 섞지 않는다** (2026-09-21 2차 보정).
 *
 *    앞판은 `CANARY_CONTRACT` 하나만 있었다. 그래서 "82cook 은 하루 20건" 처럼 읽혔는데,
 *    그 20 은 **첫 관측용 상한**이지 운영 값도, 관측된 실력도, 필요량도 아니다.
 *    네 값이 한 이름 아래 있으면 canary 를 통과한 날 곧바로 "이제 20건이면 된다" 가 된다.
 *
 *      `canary`     첫 관측에서만 쓰는 상한 — 🔴 **목표가 아니다**
 *      `observed`   실제로 무사히 관측된 처리량 — 🔴 재기 전에는 `null`
 *      `operating`  지금 운영해도 된다고 판단한 값 — 사다리의 현재 칸
 *      `required`   D100 이 요구하는 양 — 🔴 **우리 사정과 무관하다**
 */
export type CapacityKind = 'canary' | 'observed' | 'operating' | 'required'

export type Capacity82 = {
  kind: CapacityKind
  /** 회차당 상세 건수 — 모르면 `null` */
  detailPerRun: number | null
  /** 하루 상세 건수 — 모르면 `null` */
  detailPerDay: number | null
  /** 하루 요청 상한 — 모르면 `null` */
  requestsPerDay: number | null
  note: string
}

/**
 * 🔴 **확대 사다리 — 창업자 계약 그대로** (2026-09-21 3차 보정).
 *
 *      5건/회차  →  무사 3회  →  10건/회차  →  무사 3회  →  20건/회차
 *      →  **7일 무사고**  →  20~30건/회차 · 2~3회/day
 *
 * 🔴 **마지막 칸의 조건은 회차 수가 아니라 기간이다.** 앞판은 "무사 12회" 로 바꿔
 *    적었는데, 하루에 여러 회차를 몰아 돌리면 **반나절이면 12회**가 찬다.
 *    7일을 요구한 이유는 "여러 날에 걸쳐 아무 일도 없었다" 를 보려는 것이다 —
 *    회차 수로 대체하면 그 뜻이 통째로 사라진다.
 *
 * 🔴 각 칸은 **직전 칸에서** 조건을 채워야 들어간다. 1칸에서 무사 6회를 돌아도
 *    3칸으로 건너뛰지 않는다.
 */
export const ESCALATION_LADDER = [
  {
    step: 1, maxDetailPerRun: 5, maxRunsPerDay: 1,
    cleanRunsInPrevStep: 0, incidentFreeDaysInPrevStep: 0,
    note: '첫 관측 — canary 계약 그대로',
  },
  {
    step: 2, maxDetailPerRun: 10, maxRunsPerDay: 1,
    cleanRunsInPrevStep: 3, incidentFreeDaysInPrevStep: 0,
    note: '1칸에서 무사 3회를 채운 뒤',
  },
  {
    step: 3, maxDetailPerRun: 20, maxRunsPerDay: 1,
    cleanRunsInPrevStep: 3, incidentFreeDaysInPrevStep: 0,
    note: '2칸에서 무사 3회를 채운 뒤',
  },
  {
    step: 4, maxDetailPerRun: 30, maxRunsPerDay: 3,
    cleanRunsInPrevStep: 0, incidentFreeDaysInPrevStep: 7,
    note: '3칸에서 🔴 **7일 무사고** — 20~30건/회차 · 2~3회/day',
  },
] as const
export type EscalationStep = (typeof ESCALATION_LADDER)[number]

/** 🔴 사다리의 천장 — 이보다 위는 이 계약에 없다 */
export const LADDER_MAX_DETAIL_PER_RUN = 30
/** 🔴 마지막 칸의 하한 — 20~30 사이에서만 움직인다 */
export const LADDER_TOP_MIN_DETAIL_PER_RUN = 20
/** 🔴 마지막 칸에 들어가는 유일한 조건 */
export const TOP_STEP_INCIDENT_FREE_DAYS = 7

export type LadderObservation = {
  /** 지금 서 있는 칸 */
  currentStep: number
  /** 🔴 **이 칸에서** 무사히 끝난 회차 수 */
  cleanRunsInCurrentStep: number
  /** 🔴 **이 칸에서** 사고 없이 지난 날 수 */
  incidentFreeDaysInCurrentStep: number
  /** 마지막 회차에 중단 신호가 있었는가 */
  sawAbortSignal: boolean
}

export type LadderVerdict = {
  /** 지금 적용되는 칸 */
  step: EscalationStep
  /** 🔴 다음 칸으로 올라가도 되는가 — **자동으로 올라가지는 않는다** */
  mayProposeNext: boolean
  /** 다음 칸이 요구하는 것 중 아직 못 채운 것 */
  blocking: string[]
  /** 사고로 되돌아왔는가 */
  decelerated: boolean
}

function stepAt(n: number): EscalationStep {
  return ESCALATION_LADDER.find((s) => s.step === n) ?? ESCALATION_LADDER[0]
}

/**
 * 🔴 **자동 승격은 없다.** 이 함수는 "올릴 것을 사람에게 제안해도 되는가" 만 답한다 —
 *    실제 상향은 `operatingPolicy` 의 사람 승인을 거친다.
 * 🔴 사고를 보면 **직전 안전 칸으로 감속한다.** 1칸으로 떨어뜨리지 않는 이유는,
 *    그 칸까지는 이미 무사했다는 관측이 있기 때문이다 — 다만 1칸이면 더 갈 곳이 없다.
 */
export function judgeLadder(obs: LadderObservation): LadderVerdict {
  if (obs.sawAbortSignal) {
    const back = Math.max(1, obs.currentStep - 1)
    return {
      step: stepAt(back), mayProposeNext: false, decelerated: true,
      blocking: [`중단 신호를 봤다 — ${obs.currentStep}칸에서 ${back}칸으로 감속한다`],
    }
  }
  const cur = stepAt(obs.currentStep)
  const next = ESCALATION_LADDER.find((s) => s.step === obs.currentStep + 1)
  if (next === undefined) {
    return { step: cur, mayProposeNext: false, decelerated: false, blocking: ['마지막 칸이다'] }
  }
  const blocking: string[] = []
  if (obs.cleanRunsInCurrentStep < next.cleanRunsInPrevStep) {
    blocking.push(`이 칸 무사 ${obs.cleanRunsInCurrentStep}회 < 필요 ${next.cleanRunsInPrevStep}회`)
  }
  if (obs.incidentFreeDaysInCurrentStep < next.incidentFreeDaysInPrevStep) {
    // 🔴 회차 수로 대체할 수 없는 조건이다
    blocking.push(`이 칸 무사고 ${obs.incidentFreeDaysInCurrentStep}일 < 필요 ${next.incidentFreeDaysInPrevStep}일`)
  }
  return { step: cur, mayProposeNext: blocking.length === 0, decelerated: false, blocking }
}

/** 🔴 옛 이름 — 회차 수만 보던 판정이다. 새 코드는 `judgeLadder` 를 쓴다 */
export function ladderStepFor(input: {
  cleanRuns: number
  sawAbortSignal: boolean
}): EscalationStep {
  return judgeLadder({
    currentStep: 1, cleanRunsInCurrentStep: input.cleanRuns,
    incidentFreeDaysInCurrentStep: 0, sawAbortSignal: input.sawAbortSignal,
  }).step
}

/**
 * 🔴 **상대가 막았다는 직접 신호에는 자동 재시도를 하지 않는다.**
 *    NETWORK 는 우리 쪽·경로 문제일 수 있어 backoff 가 말이 되지만,
 *    403·429·CAPTCHA·로그인 요구는 **상대의 답**이다. 자동으로 다시 두드리는 것은
 *    우회 시도와 구분되지 않는다 — 사람이 보고 판단한다.
 */
export const NO_AUTO_RETRY_SIGNALS = ['http403', 'http429', 'captcha', 'loginRequired'] as const

export function mayAutoRetry(signal: AbortSignal82): boolean {
  return !(NO_AUTO_RETRY_SIGNALS as readonly string[]).includes(signal)
}

/**
 * 🔴 **쿠키는 있는지/언제 만든 것인지까지만 본다.** 값을 읽지도 적지도 않는다 —
 *    세션 쿠키 값은 계정 그 자체이고, 로그에 한 번 남으면 회수할 수 없다.
 */
export type CookieAudit = {
  /** 쿠키가 하나라도 있는가 */
  present: boolean
  /** 몇 개인가 — 🔴 이름도 값도 남기지 않는다 */
  count: number
  /** 언제 만든 세션인가 (일) — 모르면 `null` */
  ageDays: number | null
}

/** 🔴 값이 아니라 **사실**만 문자열로 낸다 */
export function describeCookieAudit(a: CookieAudit): string {
  if (!a.present) return '세션 쿠키 없음 — 🔴 canary 를 돌리지 않는다'
  const age = a.ageDays === null ? '만든 시점 모름' : `${a.ageDays}일 된 세션`
  return `세션 쿠키 ${a.count}개 · ${age} — 🔴 값은 읽지 않는다`
}

/** 🔴 하나라도 보이면 그 회차를 **즉시 중단**하고 차단기를 연다 */
export const ABORT_SIGNALS = [
  'http403', 'http429', 'captcha', 'loginRequired', 'bodyNotArticle', 'repeatedNetwork',
] as const
export type AbortSignal82 = (typeof ABORT_SIGNALS)[number]

/** 🔴 절대 하지 않는 것 — 우회는 계약 위반이다 */
export const NEVER = [
  'CAPTCHA 우회', '접근 제어 우회', '로그인 제한 우회',
  '가짜 쿠키·Referer 조작', '관측 없이 속도 상향', '대체 공급원을 기본안으로 제안',
] as const

/**
 * 🔴 **네 값을 한 번에 낸다.** 표로 나란히 놓여야 "canary 값 = 운영 값" 오독이 막힌다.
 *    `observed` 는 재기 전에는 전부 `null` 이다 — 0 이 아니다.
 */
export function capacities82(input: {
  /** 이 단계가 요구하는 **전체** 상세/day (모든 공급원 합) */
  requiredDetailPerDayAllSources: number
  /** 지금 사다리 판정 */
  ladder: LadderVerdict
  /** canary 한 회차가 여는 목록 페이지 수 */
  listPagesPerRun: number
  /** canary 하루 회차 수 */
  canaryRunsPerDay: number
  /** 🔴 실제로 관측된 값 — 재지 않았으면 `null` */
  observedDetailPerDay: number | null
  observedDetailPerRun: number | null
  /**
   * 🔴 **사람이 이 칸을 승인했는가.** 관측만으로 운영값이 되지 않는다 —
   *    자동 승격을 막는 마지막 자물쇠다.
   */
  operatingApprovedBy: string | null
}): Readonly<Record<CapacityKind, Capacity82>> {
  /**
   * 🔴 **운영값은 canary 상한을 물려받지 않는다** (2026-09-21 3차 보정).
   *
   *    앞판은 `operating` 이 `CANARY_CONTRACT.maxRequestsPerDay`(20)를 그대로 썼다.
   *    그러면 사다리를 4칸까지 올려도 하루 요청이 20에 묶여, 30건/회차 × 3회 를
   *    **영원히 낼 수 없다** — 첫 관측용 안전값이 운영의 천장이 되어 버린다.
   *    반대 방향으로도 나쁘다: canary 값을 올리면 운영값이 같이 올라간다.
   *
   * 🔴 그리고 운영값은 **관측 + 사람 승인** 전에는 아예 값이 아니다.
   */
  const approved = input.operatingApprovedBy !== null && input.operatingApprovedBy.trim() !== ''
  const observedOk = input.observedDetailPerDay !== null
  const operatingUsable = approved && observedOk && !input.ladder.decelerated

  return {
    canary: {
      kind: 'canary',
      detailPerRun: CANARY_CONTRACT.maxDetailPerRun,
      detailPerDay: dailyDetailCeiling({
        maxRequestsPerDay: CANARY_CONTRACT.maxRequestsPerDay,
        runsPerDay: input.canaryRunsPerDay,
        listPagesPerRun: input.listPagesPerRun,
        maxDetailPerRun: CANARY_CONTRACT.maxDetailPerRun,
      }),
      requestsPerDay: CANARY_CONTRACT.maxRequestsPerDay,
      note: '🔴 첫 관측용 상한이다 — 목표도 운영 값도 아니다',
    },
    observed: {
      kind: 'observed',
      detailPerRun: input.observedDetailPerRun,
      detailPerDay: input.observedDetailPerDay,
      requestsPerDay: null,
      note: observedOk ? '무사히 끝난 회차에서 관측된 값'
        : '🔴 아직 재지 않았다 — 0 이 아니라 unmeasured 다',
    },
    operating: operatingUsable
      ? {
          kind: 'operating',
          detailPerRun: input.ladder.step.maxDetailPerRun,
          // 🔴 **사다리 칸이 정한다.** canary 예산을 물려받지 않는다
          detailPerDay: input.ladder.step.maxDetailPerRun * input.ladder.step.maxRunsPerDay,
          requestsPerDay: requestsPerRun(
            input.listPagesPerRun, input.ladder.step.maxDetailPerRun,
          ) * input.ladder.step.maxRunsPerDay,
          note: `사다리 ${input.ladder.step.step}칸 · 승인 ${input.operatingApprovedBy}`
            + ` — ${input.ladder.step.note}`,
        }
      : {
          kind: 'operating',
          detailPerRun: null, detailPerDay: null, requestsPerDay: null,
          note: '🔴 미승인·미관측이다 — '
            + [
              approved ? null : '사람 승인이 없다',
              observedOk ? null : '관측값이 없다',
              input.ladder.decelerated ? '사고로 감속 중이다' : null,
            ].filter((x) => x !== null).join(' · '),
        },
    required: {
      kind: 'required',
      detailPerRun: null,
      detailPerDay: input.requiredDetailPerDayAllSources,
      requestsPerDay: null,
      note: '🔴 모든 공급원 합계다. 82cook 몫이 얼마인지는 아직 정하지 않았다'
        + ' — 관측 전에 비율을 적으면 그 숫자가 근거처럼 읽힌다',
    },
  }
}

export type CanaryPlanInput = {
  phase: RecoveryPhase
  /** 지금까지 무사히 끝난 canary 회차 수 */
  cleanRuns: number
  /** 차단기가 열려 있는가 */
  breakerOpen: boolean
  /** 실제 브라우저 세션 쿠키를 들고 있는가 */
  hasSession: boolean
}

export type CanaryVerdict = {
  mayRun: boolean
  mayRegisterJob: boolean
  blocking: string[]
}

/**
 * 🔴 **fail-closed.** 세션이 없거나 차단기가 열려 있으면 요청을 보내지 않는다.
 *    정기 등록은 canary 가 여러 차례 무사했을 때만이다.
 */
export const MIN_CLEAN_RUNS_BEFORE_JOB = 3

export function judgeCanary(input: CanaryPlanInput): CanaryVerdict {
  const step = RECOVERY_PLAN.find((s) => s.phase === input.phase)
  const blocking: string[] = []
  if (step === undefined) return { mayRun: false, mayRegisterJob: false, blocking: ['모르는 단계'] }
  if (!step.sendsRequests) blocking.push(`${step.phase} 는 요청을 보내지 않는 단계다`)
  if (input.breakerOpen) blocking.push('차단기가 열려 있다 — 사람이 확인해야 한다')
  if (!input.hasSession) blocking.push('실제 브라우저 세션이 없다 — 새로 만들지 않는다')
  const mayRun = blocking.length === 0
  const mayRegisterJob = mayRun && step.registersJob
    && input.cleanRuns >= MIN_CLEAN_RUNS_BEFORE_JOB
  if (step.registersJob && input.cleanRuns < MIN_CLEAN_RUNS_BEFORE_JOB) {
    blocking.push(`무사 회차 ${input.cleanRuns} < ${MIN_CLEAN_RUNS_BEFORE_JOB}`)
  }
  return { mayRun, mayRegisterJob, blocking }
}
