/**
 * 페르소나 발화 상한(cap) — 🔴 순수 함수. DB · 세션 · 네트워크 없음
 *
 * 정본: docs/operations/2026-08-31-persona-db-model-design.md §7-1 · §7-2
 *       docs/operations/2026-08-30-persona-architecture-design.md §8
 *
 * 🔴 사용량을 Persona 행에 세지 않는다.
 *    카운터를 컬럼으로 두면 발화마다 그 행을 잠근다(0012_scrap 과 같은 판단).
 *    사용량의 정본은 PersonaActivityLog 이고, 여기는 그 실측값을 받아 판정만 한다.
 *
 * 🔴 실측하지 못한 값을 0 으로 보정하지 않는다 — throw 한다.
 *    0 으로 보정하면 cap 이 조용히 열린다. micro-seed 의 requireCapContext 가
 *    같은 이유로 같은 모양을 하고 있다(정본 §6-9-F).
 *
 * 🔴 cap 이 NULL 이면 "무제한" 이 아니라 "발행 금지" 다 (창업자 결정 5).
 *    상한을 정하지 않은 페르소나가 무제한으로 말하는 쪽이 훨씬 나쁘다.
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다.
 */

/** KST = UTC+9. 날짜 경계를 서버 로컬 시간대에 맡기지 않는다 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 최근 N일 창 — 주간 cap 은 달력 주가 아니라 롤링 7일이다 */
export const WEEK_WINDOW_DAYS = 7

/**
 * 그 시각이 속한 **KST 하루의 시작**을 절대 시각으로 낸다.
 *
 * 🔴 `new Date().setHours(0,0,0,0)` 을 쓰지 않는다 —
 *    서버가 UTC 로 돌면 한국 시간 오전 9시 이전이 전날로 세어진다.
 */
export function kstDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  const midnightKst = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  )
  return new Date(midnightKst - KST_OFFSET_MS)
}

/** 롤링 7일 창의 시작 */
export function weekWindowStart(now: Date): Date {
  return new Date(now.getTime() - WEEK_WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

/** 실측하지 못한 cap 컨텍스트로 발행을 시도했다는 뜻 */
export class CapContextNotMeasuredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapContextNotMeasuredError'
  }
}

/** PersonaActivityLog 에서 센 실측 사용량 */
export type CapContext = {
  /** KST 오늘 발행한 댓글 수 */
  usedToday: number
  /** 최근 7일 발행한 댓글 수 */
  usedWeek: number
}

/**
 * 실측값인지 확인한다. 🔴 보정하지 않는다 — 못 세었으면 발행을 멈춘다.
 */
export function requireCapContext(ctx: unknown): CapContext {
  if (!ctx || typeof ctx !== 'object') {
    throw new CapContextNotMeasuredError(
      'cap context 가 없다. usedToday · usedWeek 를 PersonaActivityLog 에서 실측해 넘긴다.',
    )
  }
  const { usedToday, usedWeek } = ctx as Partial<CapContext>

  if (!Number.isInteger(usedToday) || (usedToday as number) < 0) {
    throw new CapContextNotMeasuredError(
      `usedToday 를 실측하지 못했다 (${JSON.stringify(usedToday)}). 0 으로 보정하면 daily cap 이 조용히 열린다.`,
    )
  }
  if (!Number.isInteger(usedWeek) || (usedWeek as number) < 0) {
    throw new CapContextNotMeasuredError(
      `usedWeek 를 실측하지 못했다 (${JSON.stringify(usedWeek)}). 0 으로 보정하면 weekly cap 이 조용히 열린다.`,
    )
  }
  return { usedToday: usedToday as number, usedWeek: usedWeek as number }
}

/** Persona 행에 적힌 상한. 🔴 null 은 무제한이 아니라 미설정이다 */
export type CapLimits = {
  dailyCap: number | null
  weeklyCap: number | null
}

export type CapBlockCode =
  | 'DAILY_CAP_UNSET'
  | 'WEEKLY_CAP_UNSET'
  | 'DAILY_CAP_EXCEEDED'
  | 'WEEKLY_CAP_EXCEEDED'

export type CapBlock = { code: CapBlockCode; message: string }

export type CapPlan = {
  ok: boolean
  blocks: CapBlock[]
  /** 남은 건수. 상한이 미설정이면 null */
  remainingToday: number | null
  remainingWeek: number | null
}

/**
 * cap 판정.
 *
 * 🔴 "이번 1건" 을 포함해 계산한다 — used + 1 > cap 이면 막는다.
 *    used >= cap 으로 쓰면 cap 이 0 일 때 1건이 새어 나간다.
 */
export function planCap(limits: CapLimits, ctx: CapContext): CapPlan {
  const blocks: CapBlock[] = []

  if (limits.dailyCap === null) {
    blocks.push({
      code: 'DAILY_CAP_UNSET',
      message: 'dailyCap 이 설정되지 않았다 — 상한 없는 발화를 허용하지 않는다',
    })
  } else if (ctx.usedToday + 1 > limits.dailyCap) {
    blocks.push({
      code: 'DAILY_CAP_EXCEEDED',
      message: `오늘 ${ctx.usedToday}건 발행 — dailyCap ${limits.dailyCap} 초과`,
    })
  }

  if (limits.weeklyCap === null) {
    blocks.push({
      code: 'WEEKLY_CAP_UNSET',
      message: 'weeklyCap 이 설정되지 않았다 — 상한 없는 발화를 허용하지 않는다',
    })
  } else if (ctx.usedWeek + 1 > limits.weeklyCap) {
    blocks.push({
      code: 'WEEKLY_CAP_EXCEEDED',
      message: `최근 ${WEEK_WINDOW_DAYS}일 ${ctx.usedWeek}건 발행 — weeklyCap ${limits.weeklyCap} 초과`,
    })
  }

  return {
    ok: blocks.length === 0,
    blocks,
    remainingToday: limits.dailyCap === null ? null : Math.max(0, limits.dailyCap - ctx.usedToday),
    remainingWeek: limits.weeklyCap === null ? null : Math.max(0, limits.weeklyCap - ctx.usedWeek),
  }
}
