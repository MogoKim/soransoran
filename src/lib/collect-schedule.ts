/**
 * 수집원 다회 운영 스케줄 — 🔴 **순수 함수. 네트워크·DB·파일 0** (2026-09-08)
 *
 * 🔴 왜 이 파일이 필요한가.
 *    d10 은 하루 상세 40건, 내부 100/day 목표면 **382건**을 읽어야 한다(`planSupply` 역산).
 *
 *    🔴 지금 열리는 것은 카페 `-multi` job 둘뿐이다. 82cook 은 두 job(`raw-collect-82cook` ·
 *       `supply-collect-82cook-thin`) 다 **템플릿만 있고 미등록**이라 0 이다.
 *       🔴 **조건부 몫을 능력에 합치지 않는다.** 2026-09-11 이전에는 `supply-autopilot` 이
 *       "재고가 모자랄 때만" 82cook 상세를 열었고, 그 몫이 능력으로 세어져 며칠씩 0 인 날에도
 *       화면은 초록이었다. 지금 82cook 몫은 **예약 job 의 슬롯**에서 그대로 읽힌다.
 *       정본 구분은 `collect-inventory`(current) · `preparedCapacity`(prepared) 다.
 *    회차를 늘려야 하는데, **아무 때나 더 돌리면 두 가지가 깨진다.**
 *
 *      ① 남의 서버 부담 — 같은 시각에 몰리면 한 세션이 연속으로 긁는 모양이 된다
 *      ② 놓침 — 카페 목록 1페이지는 21건뿐이다(82cook 은 25건 × 회차당 3페이지).
 *         회차 간격이 그 범위가 넘어가는 시간보다 길면 그 사이 글을 **영원히 못 본다**
 *
 * 🔴 그래서 회차 수가 아니라 **간격**이 계약이다. 아래 `verifySchedule` 이 그것을 본다.
 *
 * 🔴 이 파일은 계획만 만든다. 실제 job 등록은 사람이 한다(`docs/operations/launchd/README.md`).
 */

// 🔴 한 회차 상한의 정본은 얇은 수집기 쪽이다 — 여기 숫자를 다시 적지 않는다
import { BATCH_CAP } from './micro-seed-82cook-thin'

export type SourceId = '82cook' | 'navercafe:remonterrace' | 'navercafe:wgang'

/**
 * 🔴 **모르는 것을 숫자로 적지 않는다** (2026-09-08 정정).
 *
 *    예전 판은 82cook 의 `listPageSize` 에 **1,147** 을 넣었다. 1,147 은 목록 한 페이지가
 *    아니라 하루치 목록을 훑어 모은 **표본 전체**다(`listToDetail = 10/1,147` 의 분모).
 *    그 값을 페이지 크기로 쓰면 "페이지가 넘어가는 데 57시간" 이 되어, 실제로는 한 시간에도
 *    넘어갈 수 있는 게시판을 하루 열 번만 봐도 안전하다고 말하게 된다.
 *
 *    그래서 값마다 **근거를 함께 들고 다닌다.** 근거가 없으면 `null` 이고,
 *    `null` 이면 그 소스의 계획은 **성립하지 않는다**(BLOCKED). 추정치로 메우지 않는다.
 */
export type Evidence<T> = { value: T; when: string; how: string }

/**
 * 🔴 **실측값이다** (2026-09-08 로그·목록 파일 read-only 조사).
 *
 *    카페: `~/Library/Logs/soransoran/navercafe-collect-*.log`
 *      목록 1p → 21건 · 정치 제외 1 · 고정 슬롯 제외 5 · 자동 선별 6 · 상세 성공 6/6
 *      에러 로그 0B — **세션 오류 0**
 *    신규 유입: 목록 JSONL 을 회차별로 대조
 *      remonterrace  09-07 17:55 → 09-08 09:20 (15.4h) 신규 16/21 → 약 1.0건/h
 *      wgang         09-07 17:56 → 09-08 13:20 (19.4h) 신규 15/21 → 약 0.8건/h
 *      🔴 긴 간격에서는 페이지1(21건)이 넘쳐 **하한**만 알 수 있다. 보수적으로 쓴다
 *    82cook 목록 페이지: `.microseed-data/82cook.list.jsonl` 의 회차 경계(글번호가 다시
 *      커지는 지점)로 회차를 나누면 25 · 125 · 150 · 75 건 — **전부 25의 배수**이고
 *      `82cook-verify.list.jsonl`(`--pages=1`)이 정확히 25건이다 → **1페이지 = 25건**
 *    82cook 신규 유입: 🔴 **미측정.** 회차별 목록 스냅숏을 시각과 함께 남긴 적이 없다
 *    82cook 상세 성공률: **8/10** (창업자 실측 보고 2026-09-08) — 카페와 달리 100% 가 아니다
 */
export type SourceFacts = {
  id: SourceId
  /** 목록 한 페이지가 담는 건수 */
  listPageSize: Evidence<number>
  /** 🔴 한 회차가 **몇 페이지**를 읽는가 — 템플릿 인자(`--pages`). 놓침 창은 이만큼 넓어진다 */
  listPagesPerRun: Evidence<number>
  /**
   * 한 회차가 여는 상세 최대 건수 (템플릿 인자).
   * 🔴 목록 전용 job 은 **0** 이다 — 상세를 열지 않는다.
   */
  detailPerRun: number
  /**
   * 🔴 **한 회차가 실제로 보내는 요청 수 — `requestsPerRunOf()` 가 계산한다.**
   *    손으로 적지 않는다. 템플릿 인자가 바뀌면 이 수도 따라 바뀌어야 한다.
   */
  readonly requestsPerRun?: never
  /** 🔴 새 글 유입 (건/시간). **모르면 null** — 놓침 상한을 계산할 수 없다는 뜻이다 */
  newPerHourFloor: Evidence<number> | null
  /** 목록 요청 간격 ms (실측) */
  listPaceMs: number
  /** 상세 요청 간격 ms (실측) */
  detailPaceMs: number
  /** 🔴 상세 성공률 (실측). 이론 최대가 아니라 **이 값을 곱한 것**이 유효 처리량이다 */
  detailSuccessRate: Evidence<number>
  /** 세션 오류 건수 (실측) */
  sessionErrors: number
  /** 🔴 launchctl 에 올라와 있는가 */
  loaded: boolean
  note: string
}

export const SOURCE_FACTS: readonly SourceFacts[] = [
  {
    id: '82cook',
    listPageSize: {
      value: 25, when: '2026-09-08',
      how: '.microseed-data/82cook.list.jsonl 회차 경계 25·125·150·75 (전부 25배수)'
        + ' + 82cook-verify.list.jsonl(--pages=1) 25건',
    },
    listPagesPerRun: { value: 3, when: '2026-09-08', how: 'raw-collect-82cook.plist.template 의 --pages=3' },
    /**
     * 🔴 **0 이다** (2026-09-14). raw job 은 목록 전용으로 바뀌었다 —
     *    템플릿 인자는 `--list --pages=3 --live` 뿐이고 `--auto --auto-max=30` 은 없다.
     *    그런데 여기만 `30` 으로 남아 하루 요청을 33×5 로 보고했다.
     *    실제는 robots 1 + 목록 3 = 4 회/회차다.
     */
    detailPerRun: 0,
    // 🔴 **미측정이다.** 예전 판의 `20건/h` 는 "페이지 3장(약 120건)" 이라는 어림에서 나온 값이고
    //    근거가 없었다. 근거 없는 수로 안전 간격을 계산하면 그 계산 전체가 거짓이다
    newPerHourFloor: null,
    listPaceMs: 4000, detailPaceMs: 3000,
    detailSuccessRate: { value: 0.8, when: '2026-09-08', how: '상세 8/10 성공 (창업자 실측 보고)' },
    sessionErrors: 0, loaded: false,
    note: '🔴 템플릿(10회/day)은 있으나 launchctl 미등록 · 신규 유입 미측정 · 상세 성공률 0.8',
  },
  {
    id: 'navercafe:remonterrace',
    listPageSize: { value: 21, when: '2026-09-08', how: 'navercafe-collect-remonterrace.log "목록 1p → 누적 21건"' },
    listPagesPerRun: { value: 1, when: '2026-09-08', how: '템플릿 인자 --pages=1' },
    detailPerRun: 10,
    newPerHourFloor: { value: 1.0, when: '2026-09-08', how: '목록 JSONL 대조 09-07 17:55→09-08 09:20 신규 16/21 (하한)' },
    listPaceMs: 4000, detailPaceMs: 3000,
    detailSuccessRate: { value: 1, when: '2026-09-08', how: '상세 6/6 성공 · 에러 로그 0B' },
    sessionErrors: 0, loaded: true,
    note: 'launchd -multi 5회/day (07:30·10:30·13:30·16:30·21:30 KST) · 상세 6/6 성공(2026-09-08) · 세션 오류 0',
  },
  {
    id: 'navercafe:wgang',
    listPageSize: { value: 21, when: '2026-09-08', how: 'navercafe-collect-wgang.log "목록 1p → 누적 21건"' },
    listPagesPerRun: { value: 1, when: '2026-09-08', how: '템플릿 인자 --pages=1' },
    detailPerRun: 10,
    newPerHourFloor: { value: 0.8, when: '2026-09-08', how: '목록 JSONL 대조 09-07 17:56→09-08 13:20 신규 15/21 (하한)' },
    listPaceMs: 4000, detailPaceMs: 3000,
    detailSuccessRate: { value: 1, when: '2026-09-08', how: '상세 6/6 성공 · 에러 로그 0B' },
    sessionErrors: 0, loaded: true,
    note: 'launchd -multi 4회/day (09:30·11:30·15:30·20:30 KST) · 상세 6/6 성공(2026-09-08) · 세션 오류 0',
  },
]

export function factsOf(id: SourceId): SourceFacts {
  return SOURCE_FACTS.find((s) => s.id === id)!
}

/**
 * 🔴 **목록이 넘어가는 시간.** 회차 간격이 이보다 길면 그 사이 글을 놓친다.
 *    유입이 하한값이므로 이 시간은 **상한**이다 — 보수적으로 절반만 쓴다(`SAFETY_RATIO`).
 *
 *    🔴 한 회차가 여러 페이지를 읽으면 그만큼 뒤까지 본다 — `pageSize × pagesPerRun` 이다.
 *    🔴 유입을 **모르면 `null`** 이다. 무한대로 두면 "아무리 드물게 봐도 안전" 이 된다.
 */
export const SAFETY_RATIO = 0.5

export function pageWindowHours(f: SourceFacts): number | null {
  if (f.newPerHourFloor === null || f.newPerHourFloor.value <= 0) return null
  return (f.listPageSize.value * f.listPagesPerRun.value) / f.newPerHourFloor.value
}

/** 🔴 놓치지 않는 최대 회차 간격 (시간). 유입 미측정이면 `null` — 계산할 수 없다 */
export function maxSafeGapHours(f: SourceFacts): number | null {
  const w = pageWindowHours(f)
  return w === null ? null : w * SAFETY_RATIO
}

/** 🔴 소스별 하루 요청 상한 — 남의 서버 부담의 천장이다 */
export const MAX_REQUESTS_PER_DAY: Readonly<Record<SourceId, number>> = {
  '82cook': 400,
  'navercafe:remonterrace': 150,
  'navercafe:wgang': 150,
}

export type Phase = 'start' | 'stable'

/**
 * 🔴 **회차 수는 `SLOTS` 에서 나온다** (2026-09-11 운영 일정 확정).
 *    여기 적힌 수는 그 길이와 반드시 같아야 한다 — `verifySchedule` 이 대조한다.
 *
 * 🔴 **안정 단계(stable)를 아직 늘리지 않았다.** 늘릴 시각이 정해지지 않았는데
 *    수만 키우면 `planSlots` 가 없는 일정을 지어내게 된다. 정해지면 `SLOTS.stable` 에
 *    시각을 적고 이 수를 함께 고친다.
 */
export const RUNS_PER_DAY: Readonly<Record<SourceId, Record<Phase, number>>> = {
  '82cook': { start: 5, stable: 5 },
  'navercafe:remonterrace': { start: 5, stable: 5 },
  'navercafe:wgang': { start: 4, stable: 4 },
}

/**
 * 🔴 **82cook 얇은 상세 수집의 독립 job 몫** (2026-09-11).
 *
 *    82cook 은 두 job 으로 나뉜다. `raw-collect-82cook` 은 목록과 Raw Vault 용 상세를 열고,
 *    `supply-collect-82cook-thin` 은 **D100 공급 레인이 먹는 얇은 상세**를 연다.
 *    둘은 같은 서버를 두드리므로 **하루 상한(`MAX_REQUESTS_PER_DAY`)을 나눠 쓴다.**
 *
 *    🔴 옛 구조에서는 이 몫이 `supply-autopilot` 안의 **조건부 수집**이었다 —
 *       재고가 모자랄 때만 열려서, 관제는 "능력이 있다" 고 말하는데 실제로는 며칠씩 0 이었다.
 *       예약 job 으로 바꾸면 열리는 양이 스케줄에서 바로 읽힌다.
 *
 *    🔴 회차 수는 `THIN_82COOK_SLOTS` 의 길이와 같아야 한다 — fixture 가 대조한다.
 */
export const THIN_82COOK_RUNS_PER_DAY = 5

/**
 * 🔴 **한 회차 상한은 17 로 고정한다** (2026-09-11).
 *
 *    앞선 판은 "하루 상한에서 raw 몫을 빼고 회차로 나눈다" 로 **역산**했다.
 *    그때는 raw 가 10회여서 (400 − 330) / 4 = 17 이 나왔다.
 *    일정이 raw 5회로 바뀌면 같은 산식이 (400 − 165) / 5 = **47** 을 낸다 —
 *    하루 요청이 33×5 + 47×5 = **400**, 상한에 딱 붙어 여유가 0 이 된다.
 *
 *    🔴 **일정이 바뀔 때마다 상한이 따라 커지는 것은 안전장치가 아니다.**
 *       관측(82cook 하루 신규 유입)이 아직 없으므로 **보수적으로 유지**한다:
 *       thin 은 17건/회차를 유지한다. 늘리려면 유입 관측을 근거로 들고 이 수 하나를 고친다.
 *
 * 🔴 **하루 요청은 여기 적지 않는다** (2026-09-14). `requests82cookPerDay()` 가
 *    실제 인자에서 파생한다 — 문서에 적어 두면 인자가 바뀔 때 한쪽만 낡는다.
 *    실제로 `--auto` 를 뗀 뒤에도 `33×5 + 17×5 = 250` 이 남아 있었다.
 */
export const THIN_82COOK_CAP_PER_RUN = 17

export function thin82cookCapPerRun(): number {
  // 🔴 하위 스크립트의 한 회차 상한(BATCH_CAP)을 넘지 않는다 — 그쪽도 다시 막지만 계획이 거짓이면 안 된다
  return Math.max(0, Math.min(BATCH_CAP, THIN_82COOK_CAP_PER_RUN))
}

/** 🔴 82cook 두 job 이 하루에 보내는 요청 합 — 상한 안에 드는지는 fixture 가 본다 */
/**
 * 🔴 **robots 요청을 뺀 계산은 거짓이다** (2026-09-14).
 *    두 job 모두 **실행마다** robots.txt 를 한 번 읽는다
 *    (`micro-seed-collect-82cook.mts` · `micro-seed-82cook-thin-detail.mts`).
 *    그 요청도 같은 도메인으로 나가고 같은 예산을 쓴다.
 */
export const ROBOTS_REQUESTS_PER_RUN = 1

/**
 * 🔴 **한 회차 요청 수를 실제 인자에서 파생한다.** 손으로 적은 수를 믿지 않는다 —
 *    `--auto` 를 뗐는데 `requestsPerRun=33` 이 남아 하루 250 을 보고하던 일이 있었다.
 */
export function requestsPerRunOf(id: SourceId): number {
  const f = factsOf(id)
  return ROBOTS_REQUESTS_PER_RUN + f.listPagesPerRun.value + f.detailPerRun
}

/** 🔴 thin 한 회차 요청 수 — robots + 상세 cap */
export function thin82cookRequestsPerRun(): number {
  return ROBOTS_REQUESTS_PER_RUN + thin82cookCapPerRun()
}

export function requests82cookPerDay(): number {
  return requestsPerRunOf('82cook') * RUNS_PER_DAY['82cook'].start
    + thin82cookRequestsPerRun() * THIN_82COOK_RUNS_PER_DAY
}

export type Slot = { hour: number; minute: number }

/**
 * 🔴 **한 source 안에서 분(minute)은 하나로 고정한다** — 이제 **검증용**이다.
 *
 *    시각은 `SLOTS` 가 정한다. 이 표는 "그 안에서 분이 섞이지 않았는가" 를 본다 —
 *    분이 섞이면 사람이 손으로 고치다 흘린 것이다.
 *    🔴 레인마다 분을 달리 두는 이유는 그대로다: 같은 분에 겹치면 한 세션이 두 곳을
 *    연속으로 긁는 모양이 되고, 차단은 그 모양을 본다.
 */
export const SOURCE_MINUTE: Readonly<Record<SourceId, number>> = {
  '82cook': 0,
  'navercafe:remonterrace': 30,
  'navercafe:wgang': 30,
}

const at = (hour: number, minute: number): Slot => ({ hour, minute })

/**
 * 🔴 **운영 일정 정본 — 전부 KST** (2026-09-11 확정).
 *
 *    앞선 판은 `24 / 회차` 로 하루에 **고르게** 폈다. 그러면 02:50 · 04:20 처럼
 *    **노트북이 꺼져 있는 새벽**에 슬롯이 놓인다 — 예약은 있는데 회차는 돌지 않는다.
 *    실제로 그 구간의 회차가 통째로 비었다.
 *
 *    🔴 그래서 **사람이 노트북을 켜 두는 시간(07:00~22:30)** 안에 배치한다.
 *       균등하지 않다. 균등함은 목표가 아니었다 — 도는 것이 목표다.
 *
 *    🔴 **분(minute)을 레인마다 다르게 준다.** 같은 분에 겹치면 한 세션이 두 곳을
 *       연속으로 긁는 모양이 되고, 차단은 그 모양을 본다.
 *       82cook 목록 :00 → 본문 :40(40분 뒤, 목록이 쌓인 뒤에 연다) ·
 *       remonterrace :30 · wgang :30 (시(hour)가 겹치지 않아 실제 시각은 안 겹친다)
 *
 *    🔴 `stable` 은 아직 `start` 와 같다. 증설 시각이 정해지지 않았다.
 */
export const SLOTS: Readonly<Record<SourceId, Readonly<Record<Phase, readonly Slot[]>>>> = {
  '82cook': {
    start: [at(7, 0), at(10, 0), at(13, 0), at(16, 0), at(19, 0)],
    stable: [at(7, 0), at(10, 0), at(13, 0), at(16, 0), at(19, 0)],
  },
  'navercafe:remonterrace': {
    start: [at(7, 30), at(10, 30), at(13, 30), at(16, 30), at(21, 30)],
    stable: [at(7, 30), at(10, 30), at(13, 30), at(16, 30), at(21, 30)],
  },
  'navercafe:wgang': {
    start: [at(9, 30), at(11, 30), at(15, 30), at(20, 30)],
    stable: [at(9, 30), at(11, 30), at(15, 30), at(20, 30)],
  },
}

/**
 * 🔴 **82cook 본문(얇은 상세) 수집 슬롯** — 목록 슬롯의 **40분 뒤**.
 *    목록이 먼저 쌓여야 열 대상이 생긴다. 같은 분에 두면 빈 목록을 보고 0건으로 끝난다.
 */
export const THIN_82COOK_SLOTS: readonly Slot[] =
  SLOTS['82cook'].start.map((s) => at(s.hour, s.minute + 40))

/** 🔴 공급 처리(drain) 슬롯 — 수집 결과를 비운다. 수집 레인과 분이 겹치지 않게 :15 */
export const SUPPLY_PROCESS_SLOTS: readonly Slot[] =
  [at(8, 15), at(12, 15), at(14, 15), at(17, 15), at(21, 15), at(22, 15)]

/** 🔴 계획은 **정본 테이블 그대로**다. 여기서 시각을 계산하지 않는다 */
export function planSlots(id: SourceId, phase: Phase): Slot[] {
  return SLOTS[id][phase].map((s) => ({ ...s }))
}

export type ScheduleProblem = string

/** 🔴 계획이 성립하는가 — 간격·부하·겹침을 **전부** 본다 */
export function verifySchedule(id: SourceId, phase: Phase): ScheduleProblem[] {
  const f = factsOf(id)
  const slots = planSlots(id, phase)
  const out: ScheduleProblem[] = []
  if (slots.length !== RUNS_PER_DAY[id][phase]) out.push(`회차 수가 ${slots.length} 다 (${RUNS_PER_DAY[id][phase]} 이어야 한다)`)

  // ① 놓침 — 가장 긴 간격이 안전 상한을 넘는가
  const mins = slots.map((s) => s.hour * 60 + s.minute).sort((a, b) => a - b)
  const gaps = mins.map((m, i) => (i === 0 ? m + 1440 - mins[mins.length - 1]! : m - mins[i - 1]!))
  const maxGapH = Math.max(...gaps) / 60
  const limit = maxSafeGapHours(f)
  // 🔴 **모르면 통과가 아니라 미달이다.** 유입을 모르면 이 계획이 놓치는지 알 수 없다
  if (limit === null) {
    out.push('신규 유입이 미측정이라 놓침 상한을 계산할 수 없다'
      + ' — 회차별 목록 스냅숏을 시각과 함께 남겨 유입을 재야 한다')
  } else if (maxGapH > limit) {
    out.push(`최대 간격 ${maxGapH.toFixed(1)}h 가 안전 상한 ${limit.toFixed(1)}h 를 넘는다`
      + ` — 목록 ${f.listPageSize.value * f.listPagesPerRun.value}건이 ${pageWindowHours(f)!.toFixed(1)}h 만에 넘어간다`)
  }
  // ② 부하 — 하루 요청 수
  const perDay = slots.length * requestsPerRunOf(f.id)
  if (perDay > MAX_REQUESTS_PER_DAY[id]) {
    out.push(`하루 요청 ${perDay}건이 상한 ${MAX_REQUESTS_PER_DAY[id]}건을 넘는다`)
  }
  // ③ 같은 소스 안에서 시각이 겹치는가
  if (new Set(mins).size !== mins.length) out.push('같은 시각 슬롯이 두 번 있다')
  // ④ 분 규칙
  if (slots.some((s) => s.minute !== SOURCE_MINUTE[id])) out.push(`분이 ${SOURCE_MINUTE[id]} 이 아닌 슬롯이 있다`)
  return out
}

/** 🔴 소스 사이에 같은 시각이 없는가 — 세 소스를 한 번에 본다 */
export function verifyNoCrossOverlap(phase: Phase): ScheduleProblem[] {
  const seen = new Map<number, SourceId>()
  const out: ScheduleProblem[] = []
  for (const f of SOURCE_FACTS) {
    for (const s of planSlots(f.id, phase)) {
      const key = s.hour * 60 + s.minute
      const prev = seen.get(key)
      if (prev !== undefined) out.push(`${prev} 와 ${f.id} 가 같은 시각(${s.hour}:${String(s.minute).padStart(2, '0')})에 돈다`)
      else seen.set(key, f.id)
    }
  }
  return out
}

/**
 * 🔴 **한 소스가 죽어도 나머지는 돈다.**
 *    launchd job 을 소스마다 따로 두는 이유가 이것이다 — 한 프로세스가 실패해도
 *    다른 job 의 exit status 에 영향이 없다. 여기서는 그 계약을 계산으로 확인한다.
 */
export function isolationOf(down: readonly SourceId[]): {
  alive: SourceId[]
  lostDetailPerDay: number
  aliveDetailPerDay: number
  isolated: boolean
} {
  const alive = SOURCE_FACTS.filter((f) => !down.includes(f.id))
  // 🔴 격리 보고도 **유효 처리량**으로 적는다 — 이론 최대로 적으면 남은 능력을 부풀린다
  const per = (f: SourceFacts): number => effectiveDetailPerDayOf(f, 'start')
  return {
    alive: alive.map((f) => f.id),
    lostDetailPerDay: SOURCE_FACTS.filter((f) => down.includes(f.id)).reduce((n, f) => n + per(f), 0),
    aliveDetailPerDay: alive.reduce((n, f) => n + per(f), 0),
    // 🔴 살아 있는 소스가 하나라도 있으면 격리된 것이다 — 전면 중단이 아니다
    isolated: alive.length > 0,
  }
}

/**
 * 🔴 **이론 최대**다 — 회차 × 회차당 상한. 요청이 전부 성공했을 때의 수다.
 *    🔴 공급 능력 판정에 이 값을 쓰지 않는다. 아래 `effectiveDetailPerDay` 가 정본이다.
 */
export function theoreticalDetailPerDay(phase: Phase): number {
  return SOURCE_FACTS.reduce((n, f) => n + detailPerDayOf(f, phase), 0)
}

/** 소스 하나의 **유효** 하루 상세 처리량 — 성공률을 곱한다 */
/**
 * 🔴 **하루에 여는 상세 건수 — 상세를 실제로 여는 job 을 전부 센다** (2026-09-14).
 *
 *    82cook 은 raw 목록 job 이 상세를 열지 않는다(`detailPerRun: 0`).
 *    대신 **thin 상세 job** 이 회차마다 `thin82cookCapPerRun()` 건을 연다.
 *    옛 계산은 raw 의 죽은 상세(30×5)를 세고 thin 을 빼서 두 번 틀렸다 —
 *    없는 처리량을 보고하고, 있는 처리량은 보고하지 않았다.
 *
 * 🔴 이론값과 유효값이 **같은 함수**에서 갈린다. 두 군데에 적으면 한쪽만 낡는다.
 */
export function detailPerDayOf(f: SourceFacts, phase: Phase): number {
  const own = f.detailPerRun * RUNS_PER_DAY[f.id][phase]
  return f.id === '82cook' ? own + thin82cookCapPerRun() * THIN_82COOK_RUNS_PER_DAY : own
}

export function effectiveDetailPerDayOf(f: SourceFacts, phase: Phase): number {
  return detailPerDayOf(f, phase) * f.detailSuccessRate.value
}

/**
 * 🔴 **계획 전체의 유효 하루 상세 처리량** (2026-09-08).
 *
 *    예전 판은 `detailPerRun × runs` 만 더해 "하루 380건" 이라고 적었다. 그것은
 *    **한 건도 실패하지 않았을 때**의 수다. 82cook 상세는 8/10 이 성공한다 —
 *    그 두 건은 계획에서 사라지지 않고, 큐가 채워지지 않는 형태로 나중에 드러난다.
 *    그래서 능력은 처음부터 성공률을 곱한 값으로 말한다.
 */
export function effectiveDetailPerDay(phase: Phase): number {
  return SOURCE_FACTS.reduce((n, f) => n + effectiveDetailPerDayOf(f, phase), 0)
}

/** 🔴 cron 문자열 (KST). launchd 템플릿과 대조한다 */
export function describeSlots(id: SourceId, phase: Phase): string {
  return planSlots(id, phase).map((s) => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`).join(' ')
}
