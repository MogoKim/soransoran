/**
 * 슬롯 → 발행 스케줄 렌더 — 🔴 **순수 함수. 파일도 네트워크도 읽지 않는다**
 *
 * 🔴 왜 필요한가 (2026-09-08).
 *    프로필의 슬롯과 `.github/workflows/auto-publish.yml` 의 cron 은 **각자 손으로** 적혀 있었다.
 *    d3 로 올리면서 프로필만 고치면 워크플로우는 그대로 하루 한 번 돈다 —
 *    "3/day 로 올렸다" 고 적어 두고 실제로는 1건만 나간다. 그 어긋남을 아무도 못 본다.
 *
 * 🔴 그래서 **프로필이 정본**이고, 워크플로우는 여기서 렌더한 결과와 같아야 한다.
 *    fixture 가 실제 yml 을 읽어 대조한다 — 어긋나면 CI 가 먼저 막는다.
 *
 * 🔴 시각 표현은 **분 단위**다. 시(hour) 정수 배열로는 지금 도는 `00:05 KST` 를 적을 수 없었다.
 */

import { minuteOfDay, slotCronUtc, slotLabel, type ScaleProfile, type Slot } from './scale-profile'

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
