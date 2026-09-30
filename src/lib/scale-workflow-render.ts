/**
 * 슬롯 → 발행 스케줄 렌더 — 🔴 **순수 함수. 파일도 네트워크도 읽지 않는다**
 *
 * 🔴 왜 필요한가 (2026-09-08).
 *    프로필의 슬롯과 `.github/workflows/auto-publish.yml` 의 cron 은 **각자 손으로** 적혀 있었다.
 *    d3 로 올리면서 프로필만 고치면 워크플로우는 그대로 하루 한 번 돈다 —
 *    "3/day 로 올렸다" 고 적어 두고 실제로는 1건만 나간다. 그 어긋남을 아무도 못 본다.
 *
 * 🔴 그래서 **프로필이 정본**이고, 예약은 여기서 렌더한 결과와 같아야 한다.
 *    🔴 (2026-09-30) 발행 예약의 주인은 launchd 러너 하나다 — GitHub 예약은 지웠다(맨 아래 절).
 *    fixture 가 러너 plist 의 예약을 cron 표현으로 읽어 대조한다 — 어긋나면 CI 가 먼저 막는다.
 *
 * 🔴 시각 표현은 **분 단위**다. 시(hour) 정수 배열로는 `09:30`·`08:10` 같은 슬롯을 적을 수 없다.
 */

import {
  minuteOfDay, slotCronUtc, slotLabel, PROFILES, RELEASE_STAGES,
  type ReleaseStage, type ScaleProfile, type Slot,
} from './scale-profile'

/** GitHub Actions cron 은 UTC 다. KST = UTC+9 */
export const KST_OFFSET_HOURS = 9

export type RenderedSlot = {
  /** KST 표기 `HH:MM` */
  kst: string
  /** UTC cron `m h * * *` */
  cron: string
  /** 이 회차가 낼 건수 */
  count: number
}

/** 🔴 슬롯을 cron 으로. 계산은 `slotCronUtc` 하나뿐이다 */
export function renderSlots(p: ScaleProfile): RenderedSlot[] {
  return [...p.slots]
    .sort((a, b) => minuteOfDay(a) - minuteOfDay(b))
    .map((s) => ({ kst: slotLabel(s), cron: slotCronUtc(s), count: s.count }))
}

/** yml 에 넣을 cron 목록 (중복 제거 — 같은 시각에 두 번 예약하지 않는다) */
export function cronLines(p: ScaleProfile): string[] {
  return [...new Set(renderSlots(p).map((r) => r.cron))]
}

/**
 * 🔴 워크플로우 텍스트에서 cron 을 읽는다.
 *    주석(`#`) 뒤는 무시한다 — 설명문에 적힌 예시를 스케줄로 세지 않기 위해서다.
 */
export function parseCronLines(yml: string): string[] {
  const out: string[] = []
  for (const raw of yml.split('\n')) {
    const line = raw.split('#')[0] ?? ''
    const m = /-\s*cron:\s*['"]([^'"]+)['"]/.exec(line)
    if (m?.[1] !== undefined) out.push(m[1].trim())
  }
  return out
}

export type RenderMismatch = { kind: 'missing' | 'extra' | 'count'; detail: string }

/**
 * 🔴 프로필과 워크플로우가 같은 말을 하는가.
 *    `missing` = 프로필에는 있는데 yml 에 없다 (그 회차는 영원히 돌지 않는다)
 *    `extra`   = yml 에만 있다 (아무도 계획하지 않은 회차가 돈다)
 */
export function compareWorkflow(p: ScaleProfile, yml: string): RenderMismatch[] {
  const want = cronLines(p)
  const have = parseCronLines(yml)
  const out: RenderMismatch[] = []
  for (const c of want) if (!have.includes(c)) out.push({ kind: 'missing', detail: `프로필 슬롯 ${c} 가 워크플로우에 없다` })
  for (const c of have) if (!want.includes(c)) out.push({ kind: 'extra', detail: `워크플로우 cron ${c} 가 프로필에 없다` })
  const wantTotal = p.slots.reduce((n, s) => n + s.count, 0)
  if (wantTotal !== p.dailyTarget) {
    out.push({ kind: 'count', detail: `슬롯 합 ${wantTotal} ≠ 목표 ${p.dailyTarget}` })
  }
  return out
}

/**
 * 🔴 **하루 상한은 슬롯이 지키지 않는다.**
 *
 *    같은 슬롯이 두 번 돌아도(재시도 · GitHub 중복 실행) 러너가 KST 자정 기준으로 센
 *    `PersonaActivityLog` 가 상한을 지킨다. 이 함수는 그 사실을 계산으로 확인한다 —
 *    "슬롯 수 × 회차당 건수" 가 아니라 **하루 상한**이 답이다.
 */
export function dailyCeiling(p: ScaleProfile, runsPerSlot = 1): number {
  const naive = p.slots.reduce((n, s) => n + s.count, 0) * Math.max(1, runsPerSlot)
  return Math.min(naive, p.dailyTarget)
}

/** yml 에 붙여 넣을 블록 — 사람이 옮겨 적을 때 실수하지 않게 */
export function renderCronBlock(p: ScaleProfile): string {
  return renderSlots(p)
    .map((r) => `    # ${r.kst} KST · ${r.count}건\n    - cron: '${r.cron}'`)
    .join('\n')
}

/** 🔴 슬롯 하나가 표현 가능한가 — 분 단위 범위 밖이면 렌더할 수 없다 */
export function verifySlotRenderable(s: Slot): string[] {
  const out: string[] = []
  if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23) out.push(`hour ${s.hour} 가 0~23 밖이다`)
  if (!Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59) out.push(`minute ${s.minute} 가 0~59 밖이다`)
  if (!Number.isInteger(s.count) || s.count < 1) out.push(`count ${s.count} 가 1 이상 정수가 아니다`)
  return out
}

// ─────────────────────────────────────────────────────────
// 🔴 **워크플로우는 모든 단계의 슬롯을 예약하고, 러너가 자기 단계만 고른다** (2026-09-12)
//
//    옛 판은 yml 에 cron 이 **하나**(00:05 KST)뿐이었다. 그래서 `SORAN_RELEASE_STAGE` 를
//    d3·d5·d10 으로 올려도 워크플로우는 하루 한 번만 러너를 불렀고, 러너는 호출당 1건이므로
//    **실제로는 언제나 1건/day** 였다. 설정은 d10 인데 나가는 건 1건 —
//    그 어긋남이 로그 어디에도 실패로 남지 않았다.
//
//    🔴 왜 "단계별 yml" 이 아니라 "합집합 + 러너 판정" 인가.
//       GitHub Actions 의 cron 은 파일에 고정이고 변수로 바꿀 수 없다. 단계를 바꿀 때마다
//       yml 을 고쳐 배포해야 한다면 "설정만으로 확대" 가 성립하지 않는다.
//       합집합을 예약해 두고 **러너가 자기 단계의 슬롯인지 판정**하면, 단계 변경은 변수 하나다.
//
//    🔴 하루 상한은 이것이 지키지 않는다. 슬롯 판정은 "이 회차가 내 단계 것인가" 만 답한다.
//       총량은 여전히 러너의 DB 카운트(dailyCap)가 지킨다 — 이중이라서 재실행·중복에도 안전하다.
// ─────────────────────────────────────────────────────────

/** 🔴 모든 단계 슬롯의 합집합 — yml 이 예약해야 할 전부 */
export function allStageSlots(): Slot[] {
  const byMinute = new Map<number, Slot>()
  for (const stage of RELEASE_STAGES) {
    for (const s of PROFILES[stage].slots) {
      const m = minuteOfDay(s)
      // 🔴 같은 시각은 한 번만 예약한다 — count 는 그 시각의 최대치를 쓴다
      const had = byMinute.get(m)
      if (had === undefined || s.count > had.count) byMinute.set(m, { ...s })
    }
  }
  return [...byMinute.values()].sort((a, b) => minuteOfDay(a) - minuteOfDay(b))
}

/** yml 에 들어갈 cron 전체 (KST 시각순) */
export function allStageCronLines(): string[] {
  return allStageSlots().map(slotCronUtc)
}

export type SupersetMismatch = { kind: 'missing' | 'unplanned' | 'count'; detail: string }

/**
 * 🔴 **워크플로는 모든 단계의 합집합이어야 한다** (2026-09-21 실측 보정).
 *
 *    앞판은 `compareWorkflow(활성 단계 프로필, yml)` 로 견줬다. 그런데 yml 은
 *    **설계상** 합집합이다(위 주석이 그 이유를 적어 두었다) — 단계를 바꿀 때마다
 *    yml 을 고쳐 배포하지 않으려고 합집합을 예약하고 러너가 자기 슬롯인지 판정한다.
 *    그래서 d1 에서 실측하면 10개 중 9개가 `extra` 로 잡혔다. **거짓 경보다.**
 *
 * 🔴 **느슨하게 만든 것이 아니다.** 두 가지는 여전히 실패다:
 *      `missing`    어떤 단계의 슬롯이 yml 에 없다 → 그 단계는 영원히 돌지 않는다
 *      `unplanned`  yml 에만 있는 cron → 아무도 계획하지 않은 회차가 돈다
 */
export function compareWorkflowSuperset(yml: string): SupersetMismatch[] {
  const want = allStageCronLines()
  const have = parseCronLines(yml)
  const out: SupersetMismatch[] = []
  for (const c of want) {
    if (!have.includes(c)) out.push({ kind: 'missing', detail: `단계 슬롯 ${c} 가 워크플로우에 없다` })
  }
  for (const c of have) {
    if (!want.includes(c)) out.push({ kind: 'unplanned', detail: `워크플로우 cron ${c} 는 어느 단계 슬롯도 아니다` })
  }
  return out
}

/**
 * 🔴 **합집합을 예약했으면 러너가 반드시 걸러야 한다.**
 *    거르지 않으면 d1 인데 하루 10번 발행을 시도한다 — 상한이 막아 주더라도
 *    그것은 두 번째 방어선이지 설계가 아니다.
 *
 * 🔴 문자열 포함 검사 하나로 끝내지 않는다 — 부르는 쪽이 **행동 fixture** 로
 *    "d1 에서 d10 슬롯이 실제로 걸러지는가" 를 값으로 확인한다.
 */
export function stageGatingPresent(runnerSrc: string): boolean {
  /**
   * 🔴 합집합을 **정본 함수에서** 가져오는가. 손으로 적은 슬롯 목록이면
   *    단계를 올릴 때 조용히 어긋난다.
   */
  return /allStageSlots\(\)/.test(runnerSrc)
}

/**
 * 🔴 UTC cron → KST 슬롯. `slotCronUtc` 의 역함수다.
 *    `m h * * *` 만 받는다 — 목록(`1,2`) · 범위(`0-5`) · 스텝 표기는 슬롯이 아니다.
 */
export function slotOfCron(cron: string): { hour: number; minute: number } | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string]
  if (dom !== '*' || mon !== '*' || dow !== '*') return null
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(h)) return null
  const minute = Number.parseInt(m, 10)
  const utcHour = Number.parseInt(h, 10)
  if (minute > 59 || utcHour > 23) return null
  return { hour: (utcHour + KST_OFFSET_HOURS) % 24, minute }
}

export type SlotVerdict = {
  /** 이 회차가 지금 단계의 슬롯인가 */
  run: boolean
  /** KST 표기 — 판정 못 하면 null */
  kst: string | null
  reason: string
}

/**
 * 🔴 **이 회차를 돌려야 하는가** — 판정 근거는 GitHub 이 준 예약 cron 하나다.
 *
 *    🔴 **wall clock 을 보지 않는다.** GitHub Actions 는 수십 분 늦게 시작한다.
 *       시계로 "지금 09:20 쯤이니 d3 슬롯" 이라고 추측하면, 40분 늦은 00:05 회차가
 *       다른 슬롯으로 둔갑하거나 아무 슬롯도 아니게 된다.
 *       `github.event.schedule` 은 **어느 예약이 이 run 을 띄웠는지**를 그대로 말해 준다.
 *
 *    🔴 cron 을 모르면(수동 실행 · 값 누락) `run: false` 다. 모를 때 내보내지 않는다.
 */
export function judgeSlotRun(input: { stage: ReleaseStage; cron: string | null }): SlotVerdict {
  const raw = (input.cron ?? '').trim()
  if (raw === '') {
    return { run: false, kst: null, reason: '예약 cron 을 받지 못했다 — 어느 회차인지 모르면 내보내지 않는다' }
  }
  const slot = slotOfCron(raw)
  if (slot === null) {
    return { run: false, kst: null, reason: `예약 cron "${raw}" 를 슬롯으로 읽을 수 없다` }
  }
  const kst = slotLabel(slot)
  const mine = PROFILES[input.stage].slots.some((s) => minuteOfDay(s) === minuteOfDay(slot))
  return mine
    ? { run: true, kst, reason: `${kst} KST 는 ${input.stage} 의 슬롯이다` }
    : { run: false, kst, reason: `${kst} KST 는 ${input.stage} 의 슬롯이 아니다 — 이 회차는 쉰다` }
}

/** 🔴 그 단계가 yml 로부터 실제로 하루 몇 번 불리는가 */
export function scheduledRunsPerDay(stage: ReleaseStage, yml: string): number {
  return parseCronLines(yml).filter((c) => judgeSlotRun({ stage, cron: c }).run).length
}

/**
 * 🔴 그 단계가 **실제로** 하루 몇 건 낼 수 있는가 — yml 을 근거로.
 *    호출 1회당 1건이므로 `min(예약 회차 수, 하루 상한)` 이다.
 */
export function actualDailyPublishable(stage: ReleaseStage, yml: string): number {
  return Math.min(scheduledRunsPerDay(stage, yml), PROFILES[stage].dailyTarget)
}

// ─────────────────────────────────────────────────────────
// 🔴 **발행 예약의 정본은 launchd 러너다** (2026-09-30 · 단일 실행 authority)
//
//    GitHub `auto-publish.yml` 의 cron 합집합은 지웠다 — 두 번째 schedule owner 였다(2026-09-22~24 에
//    자기 변수로 11건을 따로 발행). 합집합 슬롯(`allStageSlots`)은 이제 launchd 러너 plist 의
//    `StartCalendarInterval` 이 예약한다. 위의 cron 도구들은 **그 예약을 같은 모양으로 읽기 위한 표현**으로 남는다.
// ─────────────────────────────────────────────────────────

/** 🔴 KST 슬롯 목록 → cron 줄 텍스트 — launchd 예약을 위 판정 함수(`scheduledRunsPerDay` 등)에 그대로 넣는다 */
export function scheduleTextOfSlots(slots: readonly { hour: number; minute: number }[]): string {
  return slots.map((s) => `    - cron: '${slotCronUtc(s)}'`).join('\n')
}

/**
 * 🔴 **발행 워크플로에 예약이 되살아났는가.** 한 줄이라도 있으면 두 번째 발행 schedule owner 다.
 *    (전체 판정 — consumer 우회 · 옛 변수 · 중복 owner — 은 `scripts/lib/stage-authority-graph` 가 한다.)
 */
export function retiredPublishWorkflowProblems(yml: string): string[] {
  const crons = parseCronLines(yml)
  return crons.length === 0 ? [] : [`auto-publish.yml 에 예약 ${crons.length}줄이 되살아났다 — 발행 schedule owner 는 launchd 러너 하나다`]
}
