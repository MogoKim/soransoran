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
 * 🔴 **자식 프로세스에 실려야 하는 예산 env.**
 *    지금 템플릿에는 `PATH` 하나뿐이다 — 이 셋이 없으면 장부가 fail-closed 로
 *    유료 요청을 보류하고, 회차는 돌지만 **후보가 0건**이다.
 *    🔴 등록 전에 이 이름들이 plist 에 들어가야 한다.
 */
export const SUPPLY_BUDGET_ENV_NAMES = [
  'SORAN_LLM_DAILY_BUDGET_USD',
  'SORAN_LLM_RUN_REQUEST_CAP',
  'SORAN_LLM_RESERVE_HEADROOM',
] as const

/** 회차당 상한 — 🔴 정본(`supply-workset`)과 같은 값이어야 한다 */
export const SUPPLY_WORKSET_PER_RUN = 5
export const SUPPLY_REQUESTS_PER_RUN = 20

/**
 * 🔴 **미승인 제안값이다.** 사람이 승인하기 전에는 어떤 회차도 이 값을 쓰지 않는다.
 *    근거: 2026-09-22 실측 회차당 $0.0223~$0.0288 → 6회 ≈ $0.15. 여유 2배.
 */
export const SUPPLY_DAILY_USD_PROPOSED = 0.30
export const SUPPLY_DAILY_USD_APPROVED: number | null = null

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
    `회차당 원천 ${SUPPLY_WORKSET_PER_RUN} · 요청 ${SUPPLY_REQUESTS_PER_RUN}`,
    SUPPLY_DAILY_USD_APPROVED === null
      ? `🔴 하루 비용 상한 **미승인** — 제안값 $${SUPPLY_DAILY_USD_PROPOSED.toFixed(2)}`
      : `하루 비용 상한 $${SUPPLY_DAILY_USD_APPROVED.toFixed(2)}`,
    `🔴 예산 env ${SUPPLY_BUDGET_ENV_NAMES.join(' · ')} 가 plist 에 실려야 한다`,
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
