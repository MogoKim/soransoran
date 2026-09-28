/**
 * 정기 공급 회차 계약 — 🔴 **수치는 정본 하나에서만 온다** (2026-09-22)
 *
 * 🔴 **왜 이 파일이 있는가.** 보고에서 "하루 2회" 라고 적었는데 실제 launchd
 *    템플릿은 **6회**였다. 문서와 값이 갈리면 승인받은 것과 도는 것이 달라진다.
 *    회차·상한·한계를 여기 하나에 두고, 검사가 템플릿과 대조한다.
 */

/** 🔴 `com.soransoran.supply-process.plist.template` 의 실제 슬롯 (KST) */
export const SUPPLY_RUN_SLOTS_KST = [
  { hour: 8, minute: 15 }, { hour: 12, minute: 15 }, { hour: 14, minute: 15 },
  { hour: 17, minute: 15 }, { hour: 21, minute: 15 }, { hour: 22, minute: 15 },
] as const

/** 🔴 **6회다.** 다른 수로 부르지 않는다 */
export const SUPPLY_RUNS_PER_DAY = SUPPLY_RUN_SLOTS_KST.length

/**
 * 🔴 **예산 env 세 개.** 없으면 장부가 fail-closed 로 유료 요청을 보류하고,
 *    회차는 돌지만 **후보가 0건**이다.
 *
 * 🔴 **어디에 넣는가 — plist 가 아니다** (2026-09-22 정정).
 *    앞판 주석은 "등록 전에 plist 에 들어가야 한다" 고 적었다. **틀렸다.**
 *    러너는 `loadEnvLocal()` 로 `process.cwd()/.env.local` 을 읽고,
 *    plist 의 `WorkingDirectory` 가 runtime 작업트리이며 그곳의 `.env.local` 은
 *    운영 정본 `~/Library/Application Support/soransoran/env.local` 로 걸린
 *    심볼릭 링크다. 그러니 **정본 env 파일 한 곳**에 넣는다.
 *    plist 에 또 넣으면 두 곳이 갈라지고, 갈라진 순간 어느 쪽이 도는지 알 수 없다.
 *    🔴 plist 에는 `PATH` 만 있으면 된다(nvm 경로) — 그것이 지금 모습이고 맞다.
 */
export const SUPPLY_BUDGET_ENV_NAMES = [
  'SORAN_LLM_DAILY_BUDGET_USD',
  'SORAN_LLM_RUN_REQUEST_CAP',
  'SORAN_LLM_RESERVE_HEADROOM',
] as const

/**
 * 회차당 상한 — 🔴 정본(`supply-workset`)과 같은 값이어야 한다 (검사가 대조한다).
 *
 * 🔴 **5 → 10** (2026-09-28 공급 가속 P0). 원천 하나에 판정 1 · 생성 3 이므로
 *    judge 10 · draft 30 · 합 40. 러너는 이 값을 **단계마다 자식 env 로** 싣는다
 *    (`SORAN_LLM_RUN_REQUEST_CAP` — 장부 회차 id 도 `-j`·`-d` 로 갈린다).
 * 🔴 정본 env 의 `SORAN_LLM_RUN_REQUEST_CAP`(운영 20)은 **손으로 부른 단독 실행**의 상한이다.
 *    공급 러너의 자식은 그 값을 보지 않는다 — 단계 env 가 덮는다. 그래서 env 값은 이 합 이하면 된다.
 */
export const SUPPLY_WORKSET_PER_RUN = 10
export const SUPPLY_JUDGE_REQUESTS_PER_RUN = 10
export const SUPPLY_DRAFT_REQUESTS_PER_RUN = 30
export const SUPPLY_REQUESTS_PER_RUN = 40

/**
 * 🔴 **창업자 승인값 $0.30/day** (2026-09-22 승인).
 *
 *    근거 — 장부 실측(9/19~9/22, 유료 4건 이상인 회차 21개):
 *      회차당 정산 **중앙 $0.0265 · 최대 $0.0535** (5원천 꽉 채운 회차 SHADOW5B)
 *      → 꽉 찬 회차 기준 하루 약 5.6회분. 6회 전부가 꽉 차면 $0.32 로 상한에 닿고,
 *        그때는 장부가 마지막 회차를 **막는다**(fail-closed). 그것이 의도한 동작이다.
 *
 * 🔴 **하루 총액이다** — 공급·판정·초안·댓글이 **같은 장부**를 쓴다.
 *    그날 이미 정산된 액수가 이 상한에 함께 든다.
 * 🔴 승인값이 `null` 이면 어떤 회차도 돌지 않는다(`NO_BUDGET`).
 */
/**
 * 🔴 **계약 천장 $0.50/day** (2026-09-28 공급 가속 P0). 위 $0.30 근거는 그대로 남긴다 —
 *    천장은 "여기까지 허용한다" 이지 "이만큼 쓴다" 가 아니다.
 *
 *    🔴 **운영 env(`SORAN_LLM_DAILY_BUDGET_USD`)는 0.30 그대로다** — 이 PR 은 env 를 바꾸지 않는다.
 *       장부는 env 값으로 막는다. 묶음 10 에서 하루 기대 지출(`estimateSupplySpend`)이 0.30 에
 *       가까우므로, 무거운 날에는 **늦은 회차(21:15 · 22:15)가 `DAILY_EXHAUSTED` 로 보류될 수 있다**
 *       (fail-closed · 입력은 남고 다음 날 첫 회차가 집는다). env 를 올릴지는 사람이 정한다 — 이 값 이하로만.
 */
export const SUPPLY_DAILY_USD_PROPOSED = 0.50
export const SUPPLY_DAILY_USD_APPROVED: number | null = 0.50

/**
 * 🔴 **실측 단가** — 장부(`llm-ledger/2026-09-24~27.jsonl`) 정산액을 공급 회차별로 모은 값.
 *    묶음 5 인 23회차(유료 판정 111건 · 생성 70건). 추정에만 쓴다 — 막는 것은 장부다.
 *      판정 1회 평균 $0.002020 (최대 $0.002386) · 생성 1회 평균 $0.003695 (최대 $0.004317)
 *      원천당 판정 0.974회 · 생성 0.722회 (평균)
 */
export const SUPPLY_MEASURED = Object.freeze({
  window: '2026-09-24~27 · 23 runs · workset 5',
  judgeUsdPerCall: 0.002020,
  judgeUsdPerCallMax: 0.002386,
  draftUsdPerCall: 0.003695,
  draftUsdPerCallMax: 0.004317,
  judgeCallsPerSource: 0.974,
  draftCallsPerSource: 0.722,
} as const)

export type SupplySpendEstimate = {
  /** 실측 평균 호출 수 × 평균 단가 */
  expectedPerRun: number
  expectedPerDay: number
  /** 🔴 상한을 **전부** 쓰고 최대 단가일 때 — judge N · draft 3N */
  capPerRun: number
  capPerDay: number
  /** 하루 예산이 주어졌을 때 기대 지출로 **다 돌 수 있는 회차 수** (정수 · 최대 하루 회차 수) */
  expectedRunsWithin: (dailyUsd: number) => number
}

/** 🔴 **묶음 크기 → 하루 지출 추정.** 순수 함수 — 검사와 PR 문구가 같은 값을 쓴다 */
export function estimateSupplySpend(limit: number, runsPerDay: number = SUPPLY_RUNS_PER_DAY): SupplySpendEstimate {
  const m = SUPPLY_MEASURED
  const expectedPerRun = limit * (m.judgeCallsPerSource * m.judgeUsdPerCall + m.draftCallsPerSource * m.draftUsdPerCall)
  const capPerRun = limit * (1 * m.judgeUsdPerCallMax + 3 * m.draftUsdPerCallMax)
  return {
    expectedPerRun,
    expectedPerDay: expectedPerRun * runsPerDay,
    capPerRun,
    capPerDay: capPerRun * runsPerDay,
    expectedRunsWithin: (dailyUsd) => Math.min(runsPerDay, Math.floor(dailyUsd / expectedPerRun)),
  }
}

/**
 * 🔴 **예약 여유 배수.** 입력 토큰 추정치에만 곱한다 — 출력은 `maxOutputTokens` 라
 *    요청 body 에 실려 나가는 **확정 한도**이고 그보다 많이 과금될 수 없다.
 *    그래서 1.2 로 충분하다. 실측 52건에서 실제가 예약을 넘은 건 **0건**이고
 *    정산/예약 최대 비율은 0.717 이었다 (2026-09-21~22).
 */
export const SUPPLY_RESERVE_HEADROOM = 1.2

/**
 * 🔴 **정본 env 파일.** 여기 한 곳에만 예산 값을 적는다.
 *    runtime 작업트리의 `.env.local` 이 이 파일로 걸린 심볼릭 링크다.
 */
export const SUPPLY_ENV_FILE_REL = 'Library/Application Support/soransoran/env.local'

/** 🔴 공급 처리 회차를 켜는 스위치 — 이것이 없으면 `--live` 가 무시된다 */
export const SUPPLY_ENABLE_ENV = 'SORAN_SUPPLY_PROCESS_ENABLED'

/**
 * 🔴 **감지하지 못하는 것.** 적어 두지 않으면 "자동화됐다" 로 읽힌다.
 *
 *    launchd 는 `RunAtLoad: false` 이고 기계가 꺼진 시각의 슬롯은 **건너뛴다.**
 *    깨어난 뒤 밀린 회차를 대신 돌지 않고, **건너뛴 사실도 남지 않는다.**
 *    🔴 회차 감사 파일의 "예상 N회 중 실제 M회" 비교만이 이것을 드러낸다.
 */
export const SUPPLY_UNDETECTED_LIMITS = [
  '노트북 종료 중에는 그 시각의 회차가 실행되지 않는다 (RunAtLoad=false)',
  '깨어난 뒤 밀린 회차를 대신 돌지 않는다 — catch-up 이 없다',
  '건너뛴 사실이 로그에도 장부에도 남지 않는다 — 감사 파일 대조로만 드러난다',
] as const

/** 사람이 읽는 한 줄 — 🔴 승인 전에는 그 사실을 함께 말한다 */
export function describeSupplySchedule(): string {
  const slots = SUPPLY_RUN_SLOTS_KST.map((s) => `${s.hour}:${String(s.minute).padStart(2, '0')}`).join(' · ')
  return [
    `회차 ${SUPPLY_RUNS_PER_DAY}회/day — ${slots} KST`,
    `회차당 원천 ${SUPPLY_WORKSET_PER_RUN} · 요청 ${SUPPLY_REQUESTS_PER_RUN}`
      + ` (judge ${SUPPLY_JUDGE_REQUESTS_PER_RUN} · draft ${SUPPLY_DRAFT_REQUESTS_PER_RUN})`,
    SUPPLY_DAILY_USD_APPROVED === null
      ? `🔴 하루 비용 상한 **미승인** — 제안값 $${SUPPLY_DAILY_USD_PROPOSED.toFixed(2)}`
      : `하루 비용 계약 천장 $${SUPPLY_DAILY_USD_APPROVED.toFixed(2)} — 🔴 장부는 env 값으로 막는다(운영 0.30 · 이 천장 이하)`,
    `예산 env ${SUPPLY_BUDGET_ENV_NAMES.join(' · ')} — 🔴 정본 env 파일(~/${SUPPLY_ENV_FILE_REL}) 한 곳에 둔다`,
    `여유 배수 ${SUPPLY_RESERVE_HEADROOM} (입력 추정치에만 곱한다 · 출력은 확정 한도)`,
    `🔴 스위치 ${SUPPLY_ENABLE_ENV} 가 true 여야 --live 가 산다`,
    ...SUPPLY_UNDETECTED_LIMITS.map((x) => `🔴 ${x}`),
  ].join('\n')
}

// ─────────────────────────────────────────────────────────
// 🔴 ④ 후보 수와 **사람 검토 후 READY 순증가**는 다른 값이다
// ─────────────────────────────────────────────────────────

export type ProductionTally = {
  /** 회차가 적재한 후보 수 — 🔴 재고가 아니다 */
  candidates: number
  /** 🔴 사람이 READY 로 정한 뒤 **화자별로** 늘어난 수 */
  readyNetByCode: Readonly<Record<string, number>>
  /** 관측한 정기 회차 수 — 0 이면 생산율은 unmeasured 다 */
  scheduledRuns: number
}

export type ProductionRate = {
  candidatesPerDay: number | null
  /** 🔴 `null` 은 0 이 아니라 **재지 않았다** 는 뜻이다 */
  readyNetPerDay: number | null
  distinctSpeakers: number
  note: string
}

/**
 * 🔴 **정기 회차를 보기 전에는 생산율을 말하지 않는다.**
 *    손으로 돌린 회차의 수를 하루로 나눈 값은 정기 생산율이 아니다 —
 *    그 회차는 사람이 고른 시각에, 사람이 고른 입력으로 돌았다.
 */
export function judgeProductionRate(t: ProductionTally, days: number): ProductionRate {
  const codes = Object.keys(t.readyNetByCode).filter((c) => (t.readyNetByCode[c] ?? 0) > 0)
  const sum = codes.reduce((n, c) => n + (t.readyNetByCode[c] ?? 0), 0)
  if (t.scheduledRuns === 0 || days <= 0) {
    return {
      candidatesPerDay: null, readyNetPerDay: null, distinctSpeakers: codes.length,
      note: '🔴 unmeasured — 정기 회차를 아직 보지 않았다. 손으로 돌린 회차로 생산율을 말하지 않는다',
    }
  }
  return {
    candidatesPerDay: t.candidates / days,
    readyNetPerDay: sum / days,
    distinctSpeakers: codes.length,
    note: `정기 회차 ${t.scheduledRuns}회 · ${days}일 관측 — 🔴 후보 수와 READY 순증가는 다른 값이다`,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 ⑥ 자동 READY 시험 계약 — 사람의 영구 승인을 최종 상태로 두지 않는다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **글마다 사람이 승인하는 것은 지금의 안전장치이지 목표가 아니다.**
 *    D20 이상에서 하루 수십 편을 사람이 다 보는 것은 성립하지 않는다.
 *    그렇다고 그냥 여는 것도 아니다 — **경고 없는 글**만, **측정된 정확도** 위에서 연다.
 */
export const AUTO_READY_CONTRACT = {
  /** 사람이 먼저 판정해 둔 표본 수 — 이보다 적으면 정확도를 말하지 않는다 */
  reviewSampleMin: 30,
  /** 사람이 **고치지 않고** READY 한 비율 */
  noEditAccuracyMin: 0.90,
  /** 🔴 중대 결함은 0 이어야 한다 — 비율로 넘기지 않는다 */
  hardDefectMax: 0,
  /** 자동 READY 를 열 수 있는 대상 — 🔴 경고가 하나라도 있으면 제외 */
  eligible: 'warningsZero',
  /** 열어도 사람 표본 감사는 계속한다 */
  sampledAuditRatio: 0.2,
} as const

/** 🔴 순서를 값으로 적는다 — "언젠가 자동화" 가 되지 않게 */
export const AUTO_READY_STEPS = [
  '① 정기 회차를 돌려 후보와 사람 READY 판정을 같은 창에서 쌓는다',
  '② 표본 30건이 모이면 무수정 READY 정확도와 중대 결함 수를 센다',
  '③ 정확도 90% 이상 · 중대 결함 0 이면 **경고 없는 글**만 자동 READY 를 연다',
  '④ 연 뒤에도 20% 를 사람이 표본 감사한다 — 떨어지면 되돌린다',
  '🔴 ②를 건너뛰고 ③을 열지 않는다. 표본 없이 정확도를 말하지 않는다',
] as const
