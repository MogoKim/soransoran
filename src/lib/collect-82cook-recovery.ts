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
