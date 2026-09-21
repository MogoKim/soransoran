/**
 * D100 **재고·정합성·준비도 단일 정본** — 🔴 순수 함수. DB 도 파일도 읽지 않는다
 *
 * 🔴 **왜 생겼나** (2026-09-21 실측).
 *    같은 대상을 도구마다 다른 숫자로 불렀다:
 *      · Queue 전체 239 · 미발행 APPROVED 221
 *      · profile 이 맞는 것 4 · 사람 검토 완료 3
 *      · `supply:health` 는 재고 4 · `persona:capacity-planner` 는 3
 *      · `auto-publish` dry-run 은 "자동 발행 후보 4건" · health 는 "자동 대상 0건"
 *    숫자가 다른 것이 문제가 아니라, **무엇을 센 숫자인지 이름이 없던 것**이 문제다.
 *
 * 🔴 그래서 이름을 먼저 정한다. 각 도구는 이 타입의 칸을 골라 쓴다 —
 *    자기만의 "재고" 를 다시 세지 않는다.
 */

/**
 * 🔴 **재고 깔때기.** 위에서 아래로 좁아진다. 서로 다른 집합을 섞지 않는다.
 *
 *    queueTotal           큐에 있는 모든 행 (발행된 것 포함)
 *    unpublishedApproved  아직 발행되지 않은 APPROVED·EDITED
 *    legacyExcluded       이 레인이 만들지 않은 옛 행 — 🔴 usable 에 **절대** 들어가지 않는다
 *    profileCompatible    사람/기계 profile 을 통째로 만족한 행
 *    humanReviewed        기계 글 중 사람이 실제로 확인한 행
 *    fresh                TTL 을 넘기지 않은 행
 *    personaAssignable    지금 인원·간격으로 배정 가능한 행
 *    publishableNow       위 전부 + 지금 슬롯·상한까지 통과한 행
 *    readyStock           14일 재고로 세는 값 = `fresh` (배정·슬롯은 그날 사정이다)
 */
export type StockFunnel = {
  queueTotal: number
  unpublishedApproved: number
  legacyExcluded: number
  profileCompatible: number
  humanReviewed: number
  fresh: number
  personaAssignable: number
  publishableNow: number
  scheduledIn7Days: number
  scheduledIn14Days: number
  readyStock: number
}

export type FunnelProblem = { code: string; detail: string }

/**
 * 🔴 **깔때기가 말이 되는가.** 아래 칸이 위 칸보다 클 수 없다 —
 *    크면 두 도구가 서로 다른 집합을 세고 있다는 뜻이다.
 */
export function judgeFunnel(f: StockFunnel): FunnelProblem[] {
  const out: FunnelProblem[] = []
  const order: (keyof StockFunnel)[] = [
    'unpublishedApproved', 'profileCompatible', 'humanReviewed', 'fresh',
    'personaAssignable', 'publishableNow',
  ]
  let prevKey: keyof StockFunnel = 'queueTotal'
  for (const k of order) {
    if (f[k] > f[prevKey]) {
      out.push({ code: 'FUNNEL_WIDENS', detail: `${k} ${f[k]} > ${prevKey} ${f[prevKey]}` })
    }
    prevKey = k
  }
  // 🔴 legacy 가 usable 재고에 섞이면 그 자리에서 실패다
  if (f.legacyExcluded > 0 && f.profileCompatible + f.legacyExcluded > f.unpublishedApproved) {
    out.push({
      code: 'LEGACY_IN_STOCK',
      detail: `profileCompatible ${f.profileCompatible} + legacy ${f.legacyExcluded} > 미발행 ${f.unpublishedApproved}`,
    })
  }
  if (f.readyStock !== f.fresh) {
    out.push({ code: 'READY_STOCK_MISDEFINED', detail: `readyStock ${f.readyStock} ≠ fresh ${f.fresh}` })
  }
  return out
}

// ─────────────────────────────────────────────────────────
// ② Queue ↔ Post 정합 — 🔴 의도된 숨김과 끊어진 연결을 가른다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **네 가지를 분리한다** (2026-09-21 실측 보정).
 *
 *    앞판은 "PUBLISHED 인데 Post 가 PUBLISHED 가 아니다" 를 전부 `CRITICAL` 로 올렸다.
 *    실측에서 그 1건은 **사람이 내린 글**이었다(Post `cmu0sjyll…` HIDDEN ·
 *    `permanentNoindex=false` · `indexPromotionBlocked=false` — 즉 콘텐츠 결함 표식이
 *    아니라 운영 판단으로 숨긴 것). 그것을 데이터 손상처럼 부르면 진짜 손상이 묻힌다.
 *
 * 🔴 **경고를 숨기는 것이 아니다.** 숨긴 글은 계속 보고되고 재고에서도 빠진다 —
 *    다만 `CRITICAL` 은 **연결이 깨진 경우**에만 쓴다.
 */
export const LINK_STATES = [
  'visiblePublished', 'hiddenTakenDown', 'orphan', 'realMismatch',
] as const
export type LinkState = (typeof LINK_STATES)[number]

export type QueuePostLink = {
  queueId: string
  /** 큐가 가리키는 Post id — 없으면 `null` */
  createdPostId: string | null
  /** 그 Post 의 상태 — Post 자체가 없으면 `null` */
  postStatus: string | null
}

/**
 * 🔴 상태를 가른다.
 *    `orphan`        PUBLISHED 인데 가리킬 Post 가 없다 → **연결이 깨졌다**
 *    `realMismatch`  Post 는 있는데 우리가 아는 상태가 아니다 → **모르는 상태다**
 *    `hiddenTakenDown` 사람이 내린 글 → 정상 운영 결과
 *    `visiblePublished` 정상
 */
export function linkStateOf(l: QueuePostLink): LinkState {
  if (l.createdPostId === null || l.createdPostId === '' || l.postStatus === null) return 'orphan'
  if (l.postStatus === 'PUBLISHED') return 'visiblePublished'
  if (l.postStatus === 'HIDDEN' || l.postStatus === 'DELETED') return 'hiddenTakenDown'
  return 'realMismatch'
}

export type LinkSummary = Readonly<Record<LinkState, number>>

export function summarizeLinks(rows: readonly QueuePostLink[]): LinkSummary {
  const out: Record<LinkState, number> = {
    visiblePublished: 0, hiddenTakenDown: 0, orphan: 0, realMismatch: 0,
  }
  for (const r of rows) out[linkStateOf(r)] += 1
  return out
}

/** 🔴 **연결이 깨진 것만 CRITICAL 이다.** 숨긴 글은 CRITICAL 이 아니다 */
export function linkCriticalCount(s: LinkSummary): number {
  return s.orphan + s.realMismatch
}

// ─────────────────────────────────────────────────────────
// ③ runner·운영 상태 — 🔴 fail-closed. 모르면 준비되지 않은 것이다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **네 가지를 구분한다.**
 *    `ready`            돌 수 있다
 *    `disabledByPolicy` 사람이 일부러 꺼 두었다 — 손상이 아니다
 *    `notRegistered`    설치조차 되어 있지 않다
 *    `unloaded`         설치는 됐는데 내려가 있다
 *    `unhealthy`        올라가 있는데 정상이 아니다
 */
export const RUNNER_STATES = [
  'ready', 'disabledByPolicy', 'notRegistered', 'unloaded', 'unhealthy',
] as const
export type RunnerState = (typeof RUNNER_STATES)[number]

/** 🔴 돌 수 있는 상태는 하나뿐이다 */
export function runnerCanRun(s: RunnerState): boolean {
  return s === 'ready'
}

/** 🔴 데이터 손상으로 볼 상태 — 정책으로 꺼 둔 것은 여기 없다 */
export function runnerIsFault(s: RunnerState): boolean {
  return s === 'unhealthy'
}

export function runnerStateOf(input: {
  /** plist 가 설치되어 있는가 */
  installed: boolean
  /** launchctl 에 올라가 있는가 */
  loaded: boolean
  /** env 스위치가 켜져 있는가 — 스위치가 없는 job 은 `true` */
  enabled: boolean
  /** 올라가 있는데 최근 회차가 실패했는가 */
  failing?: boolean
}): RunnerState {
  if (!input.enabled) return 'disabledByPolicy'
  if (!input.installed) return 'notRegistered'
  if (!input.loaded) return 'unloaded'
  return input.failing === true ? 'unhealthy' : 'ready'
}

/** 🔴 능력 다섯 — 하나로 뭉쳐 GREEN 이라 말하지 않는다 */
export const CAPABILITIES = ['collect', 'generate', 'publish', 'comment', 'measure'] as const
export type Capability = (typeof CAPABILITIES)[number]

export type CapabilityReadiness = Readonly<Record<Capability, RunnerState>>

/**
 * 🔴 **전체가 준비됐다고 말할 수 있는 조건.** 하나라도 `ready` 가 아니면 아니다 —
 *    미등록·unloaded·정책으로 꺼짐을 GREEN 으로 표시하지 않는다.
 */
export function allCapabilitiesReady(c: CapabilityReadiness): boolean {
  return CAPABILITIES.every((k) => runnerCanRun(c[k]))
}

/** 🔴 왜 준비되지 않았나 — 능력마다 한 줄 */
export function capabilityBlockers(c: CapabilityReadiness): string[] {
  return CAPABILITIES.filter((k) => !runnerCanRun(c[k])).map((k) => `${k}: ${c[k]}`)
}

// ─────────────────────────────────────────────────────────
// ④ 측정되지 않은 값 — 🔴 0 으로 채우지 않는다
// ─────────────────────────────────────────────────────────

/** 🔴 측정값이 없으면 `null` 이고, 보고서는 `unmeasured` 라고 적는다 */
export type Measured = number | null

export const UNMEASURED = 'unmeasured' as const

export function showMeasured(v: Measured, unit = ''): string {
  return v === null ? UNMEASURED : `${v}${unit}`
}

/**
 * 🔴 **thin 수를 READY 순증가로 대체하지 않는다** (2026-09-21).
 *    앞판 보고서가 "신규 thin 80/day" 를 재고 증가로 읽어 "n일이면 찬다" 를 냈다.
 *    thin 은 READY 의 **상한**이지 같은 단위가 아니다.
 */
export function readyNetFromThin(_thinPerDay: number): Measured {
  return null
}
