/**
 * 정기 공급 회차 계약 — 🔴 **시각은 바퀴 표(`cycle-schedule.ts`)에서 계산한다. 여기 다시 적지 않는다**
 *
 * 왜 이 파일이 있는가:
 *   공급 job 템플릿 · 정기 회차 판정 · 예산 배분 · 비용 증거가 "공급이 언제 도는가"를 각자 적으면
 *   한 곳만 바뀐 날 정기 회차가 손 실행으로 읽혀 유료 요청이 막힌다. 회차 시각 · 창 · 회차당 상한을
 *   여기 하나에 두고 나머지는 전부 여기서 읽는다.
 */
import { SUPPLY_CYCLE_MINUTES } from './cycle-schedule'

export type SupplyRunSlot = { readonly hour: number; readonly minute: number }

/** 🔴 정기 공급 회차 시각(KST) — 수집 바퀴마다 한 번(`SUPPLY_CYCLE_MINUTES`). launchd 템플릿이 이 값으로 생성된다 */
export const SUPPLY_RUN_SLOTS_KST: readonly SupplyRunSlot[] = Object.freeze(
  SUPPLY_CYCLE_MINUTES.map((m) => Object.freeze({ hour: Math.floor(m / 60), minute: m % 60 })),
)

export const SUPPLY_RUNS_PER_DAY = SUPPLY_RUN_SLOTS_KST.length

/**
 * 정기 회차 하나의 창 — 회차 시각부터 이만큼 안에 시작한 유료 요청만 그 회차의 것이다.
 * 막는 사고: 잠들었다 깨어난 회차가 다른 회차의 예산 몫으로 요청을 보낸다.
 * 🔴 가장 가까운 두 바퀴 사이(60분)에서 공급 지연(`SUPPLY_AFTER_COLLECT_MINUTES`)을 뺀 값 이하여야 창이 겹치지 않는다
 *    (`cycle:schedule-check` 가 본다).
 */
export const SUPPLY_RUN_WINDOW_MS = 45 * 60 * 1000

/**
 * 공급 회차 시작 시각을 정본 회차 창에 붙인다.
 *
 * 정각 문자열을 비교하지 않는다. launchd 지연으로 1분 늦게 시작한 회차도 같은 회차다.
 * 반대로 창 밖 시작은 가까운 회차로 추정하지 않고 `null`이다.
 */
export function supplyRunSlotMinuteOf(
  startMinute: number,
  slots: readonly SupplyRunSlot[] = SUPPLY_RUN_SLOTS_KST,
  windowMs: number = SUPPLY_RUN_WINDOW_MS,
): number | null {
  const windowMinutes = windowMs / 60_000
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= 24 * 60
    || !Number.isFinite(windowMinutes) || windowMinutes <= 0) return null
  const starts = slots.map((slot) => slot.hour * 60 + slot.minute).sort((a, b) => a - b)
  return starts.find((minute) => startMinute >= minute && startMinute < minute + windowMinutes) ?? null
}

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
 * 🔴 **10 → 20** (2026-10-28 D20 전환일 처리량). 원천 하나에 판정 1 · 생성 최대 4 이므로
 *    judge 20 · draft 80 · 합 100. 러너는 이 값을 **단계마다 자식 env 로** 싣는다
 *    (`SORAN_LLM_RUN_REQUEST_CAP` — 장부 회차 id 도 `-j`·`-d` 로 갈린다).
 * 🔴 정본 env 의 `SORAN_LLM_RUN_REQUEST_CAP`(운영 20)은 **손으로 부른 단독 실행**의 상한이다.
 *    공급 러너의 자식은 그 값을 보지 않는다 — 단계 env 가 덮는다. 그래서 env 값은 이 합 이하면 된다.
 */
export const SUPPLY_WORKSET_PER_RUN = 20
export const SUPPLY_JUDGE_REQUESTS_PER_RUN = 20
export const SUPPLY_DRAFT_REQUESTS_PER_RUN = 80
export const SUPPLY_REQUESTS_PER_RUN = 100

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
    '하루 비용 계약 천장은 날짜별 비용 계약(supply-cost-envelope)이 정한다 — 🔴 장부는 별도 운영 env 값으로 막는다(이 천장 이하)',
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
 *    그렇다고 그냥 여는 것도 아니다 — **차단 경고 없는 글**만, **측정된 정확도** 위에서 연다.
 */
export const AUTO_READY_CONTRACT = {
  /** 사람이 먼저 판정해 둔 표본 수 — 이보다 적으면 정확도를 말하지 않는다 */
  reviewSampleMin: 30,
  /** 사람이 **고치지 않고** READY 한 비율 */
  noEditAccuracyMin: 0.90,
  /** 🔴 중대 결함은 0 이어야 한다 — 비율로 넘기지 않는다 */
  hardDefectMax: 0,
  /** 자동 READY 를 열 수 있는 대상 — 🔴 안전·정합성 차단 경고가 하나라도 있으면 제외 */
  eligible: 'blockingWarningsZero',
  /** 열어도 사람 표본 감사는 계속한다 */
  sampledAuditRatio: 0.2,
} as const

/** 🔴 순서를 값으로 적는다 — "언젠가 자동화" 가 되지 않게 */
export const AUTO_READY_STEPS = [
  '① 정기 회차를 돌려 후보와 사람 READY 판정을 같은 창에서 쌓는다',
  '② 표본 30건이 모이면 무수정 READY 정확도와 중대 결함 수를 센다',
  '③ 정확도 90% 이상 · 중대 결함 0 이면 **차단 경고 없는 글**만 자동 READY 를 연다',
  '④ 연 뒤에도 20% 를 사람이 표본 감사한다 — 떨어지면 되돌린다',
  '🔴 ②를 건너뛰고 ③을 열지 않는다. 표본 없이 정확도를 말하지 않는다',
] as const
