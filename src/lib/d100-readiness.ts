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
  /** 🔴 실제 예측기가 낸 7일 전망. **재지 못했으면 `null`** — 0 이 아니다 */
  scheduledIn7Days: Measured
  scheduledIn14Days: Measured
  readyStock: number
}

export type FunnelProblem = { code: string; detail: string }

// ─────────────────────────────────────────────────────────
// ①-b 🔴 **행 집합으로 증명한다** — count 산술로는 legacy 혼입을 못 잡는다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **같은 총계라도 다른 행이면 다른 집합이다** (2026-09-21 보정).
 *    앞판은 숫자만 견줬다 — legacy 4건이 빠지고 current 4건이 들어와도 통과했다.
 *    이제 단계마다 **행 id 집합**을 들고 다니고, 다음 단계가 이전 단계의
 *    **부분집합**인지 값으로 확인한다.
 */
export type FunnelStage =
  | 'all' | 'unpublishedApproved' | 'nonLegacy' | 'profileCompatible'
  | 'humanReviewed' | 'fresh' | 'personaAssignable' | 'publishableNow'

export const FUNNEL_ORDER: readonly FunnelStage[] = [
  'all', 'unpublishedApproved', 'nonLegacy', 'profileCompatible',
  'humanReviewed', 'fresh', 'personaAssignable', 'publishableNow',
] as const

/** 🔴 단계마다 그 단계에 남은 **행 id** */
export type FunnelSets = Readonly<Record<FunnelStage, readonly string[]>>

/** 🔴 legacy 로 판정된 행 id — 이것이 뒤 단계에 하나라도 있으면 실패다 */
export type FunnelRowsInput = { sets: FunnelSets; legacyIds: readonly string[] }

export function judgeFunnelRows(input: FunnelRowsInput): FunnelProblem[] {
  const out: FunnelProblem[] = []
  const legacy = new Set(input.legacyIds)
  for (let i = 1; i < FUNNEL_ORDER.length; i += 1) {
    const prevKey = FUNNEL_ORDER[i - 1]!
    const key = FUNNEL_ORDER[i]!
    const prev = new Set(input.sets[prevKey])
    const escaped = input.sets[key].filter((id) => !prev.has(id))
    if (escaped.length > 0) {
      out.push({
        code: 'NOT_SUBSET',
        detail: `${key} 에 ${prevKey} 에 없던 행 ${escaped.length}건 (${escaped.slice(0, 3).join(',')})`,
      })
    }
  }
  // 🔴 legacy 는 `profileCompatible` 이후 어디에도 있으면 안 된다
  for (const key of FUNNEL_ORDER.slice(FUNNEL_ORDER.indexOf('profileCompatible'))) {
    const bad = input.sets[key].filter((id) => legacy.has(id))
    if (bad.length > 0) {
      out.push({
        code: 'LEGACY_IN_STAGE',
        detail: `${key} 에 legacy 행 ${bad.length}건 (${bad.slice(0, 3).join(',')})`,
      })
    }
  }
  return out
}

/** 🔴 행 집합 → 숫자. 숫자를 따로 세지 않는다 — 같은 집합에서 만든다 */
export function funnelFromRows(input: FunnelRowsInput & {
  /** 🔴 예측기가 낸 값. 입력이 없으면 `null` 이다 — 0 을 넣지 않는다 */
  scheduledIn7Days: Measured
  scheduledIn14Days: Measured
}): StockFunnel {
  const n = (k: FunnelStage): number => input.sets[k].length
  return {
    queueTotal: n('all'),
    unpublishedApproved: n('unpublishedApproved'),
    legacyExcluded: n('unpublishedApproved') - n('nonLegacy'),
    profileCompatible: n('profileCompatible'),
    humanReviewed: n('humanReviewed'),
    fresh: n('fresh'),
    personaAssignable: n('personaAssignable'),
    publishableNow: n('publishableNow'),
    scheduledIn7Days: input.scheduledIn7Days,
    scheduledIn14Days: input.scheduledIn14Days,
    readyStock: n('fresh'),
  }
}

/**
 * 🔴 **DB 를 읽지 못하면 0 이 아니라 실패다** (fail-closed).
 *    0 으로 채우면 "재고가 없다" 와 "못 읽었다" 가 같은 화면이 된다.
 */
export type FunnelRead =
  | { ok: true; rows: FunnelRowsInput; funnel: StockFunnel }
  | { ok: false; reason: 'readFailed'; detail: string }

/**
 * 🔴 **깔때기가 말이 되는가.** 아래 칸이 위 칸보다 클 수 없다 —
 *    크면 두 도구가 서로 다른 집합을 세고 있다는 뜻이다.
 */
export function judgeFunnel(f: StockFunnel): FunnelProblem[] {
  const out: FunnelProblem[] = []
  /**
   * 🔴 **세는 칸만 견준다.** 예약 전망은 `Measured`(null 가능)이고 깔때기 칸이 아니다 —
   *    같은 목록에 넣으면 "전망이 재고보다 크다" 같은 뜻 없는 비교가 생긴다.
   */
  type CountKey = 'queueTotal' | 'unpublishedApproved' | 'profileCompatible'
    | 'humanReviewed' | 'fresh' | 'personaAssignable' | 'publishableNow'
  const order: CountKey[] = [
    'unpublishedApproved', 'profileCompatible', 'humanReviewed', 'fresh',
    'personaAssignable', 'publishableNow',
  ]
  let prevKey: CountKey = 'queueTotal'
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
 *    실측에서 그 1건은 Post 가 HIDDEN 이었다(`cmu0sjyll…` · `permanentNoindex=false` ·
 *    `indexPromotionBlocked=false` — 콘텐츠 결함 표식이 아니다). 연결은 멀쩡하다.
 *    그것을 데이터 손상처럼 부르면 진짜 손상이 묻힌다.
 *
 * 🔴 **`hiddenTakenDown` 이라고 부르지 않는다** (2026-09-21 2차 보정).
 *
 *    "takedown" 은 *사람이 의도적으로 내렸다* 는 주장이다. 우리가 실제로 아는 것은
 *    **Post.status 가 HIDDEN·DELETED 라는 사실 하나뿐**이다 — 누가 왜 그렇게 했는지는
 *    이 조회로 알 수 없다. 자동 처리·마이그레이션 사고·버그로도 같은 값이 된다.
 *    감사 기록으로 확인하지 않은 의도를 이름에 넣으면, 그 이름 때문에 아무도 더 안 본다.
 *    그래서 상태 이름은 관측한 사실 그대로 `hiddenPost` 다.
 *
 * 🔴 **경고를 숨기는 것이 아니다.** 숨겨진 글은 계속 보고되고 재고에서도 빠진다 —
 *    다만 `CRITICAL` 은 **연결이 깨진 경우**에만 쓴다.
 */
export const LINK_STATES = [
  'visiblePublished', 'hiddenPost', 'orphan', 'realMismatch',
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
 *    `hiddenPost`    Post 가 숨겨져 있다 → 🔴 **연결은 정상이다.** 왜 숨겨졌는지는 모른다
 *    `visiblePublished` 정상
 */
export function linkStateOf(l: QueuePostLink): LinkState {
  if (l.createdPostId === null || l.createdPostId === '' || l.postStatus === null) return 'orphan'
  if (l.postStatus === 'PUBLISHED') return 'visiblePublished'
  if (l.postStatus === 'HIDDEN' || l.postStatus === 'DELETED') return 'hiddenPost'
  return 'realMismatch'
}

export type LinkSummary = Readonly<Record<LinkState, number>>

export function summarizeLinks(rows: readonly QueuePostLink[]): LinkSummary {
  const out: Record<LinkState, number> = {
    visiblePublished: 0, hiddenPost: 0, orphan: 0, realMismatch: 0,
  }
  for (const r of rows) out[linkStateOf(r)] += 1
  return out
}

/** 🔴 **연결이 깨진 것만 CRITICAL 이다.** 숨겨진 글 자체는 CRITICAL 이 아니다 */
export function linkCriticalCount(s: LinkSummary): number {
  return s.orphan + s.realMismatch
}

/**
 * 🔴 **숨겨진 글도 조사 대상이다.** CRITICAL 로 올리지 않는 것과
 *    "확인하지 않아도 된다" 는 다르다. 왜 숨겨졌는지는 감사 기록을 봐야 알 수 있고,
 *    이 조회는 그 기록을 읽지 않는다 — 그러니 **모른다**고 적는다.
 */
export function hiddenPostNote(s: LinkSummary): string | null {
  if (s.hiddenPost === 0) return null
  return `숨겨진 글 ${s.hiddenPost}건 — 🔴 연결은 정상이다.`
    + ' 사람이 내린 것인지 자동 처리인지는 이 조회로 알 수 없다(감사 기록 확인 필요)'
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

/**
 * 🔴 **한 라벨로는 부족하다** (2026-09-21 2차 보정).
 *
 *    `runnerStateOf` 는 다섯 중 하나를 고르느라 사실을 버린다. `disabledByPolicy` 를
 *    받으면 "설치는 되어 있나 · 올라가 있나 · 최근에 실패했나" 를 알 수 없고,
 *    `ready` 를 받으면 "이 단계에 필요한 만큼 도는가" 를 알 수 없다 — d10 이 필요한데
 *    하루 한 번 도는 job 도 `ready` 다.
 *
 * 🔴 그래서 **관측한 사실을 전부 들고 다닌다.** 라벨은 그 사실에서 파생된 요약일 뿐이다.
 */
export type RunnerFacts = {
  /** plist 가 설치되어 있는가 */
  installed: boolean
  /** launchctl 에 올라가 있는가 */
  loaded: boolean
  /** env 스위치가 켜져 있는가 — 스위치가 없는 job 은 `true` */
  enabled: boolean
  /** 🔴 올라가 있는데 최근 회차가 실패했는가. **모르면 `null`** — false 로 채우지 않는다 */
  failing: boolean | null
  /** 🔴 지금 돌 수 있는가 */
  canRun: boolean
  /**
   * 🔴 **이 단계에 필요한 만큼 도는가.** 측정하지 않았으면 `null` 이다 —
   *    `false` 와 `null` 은 다르다(못 한다 / 모른다).
   */
  capacitySatisfied: boolean | null
  /** 파생 라벨 — 사람이 읽는 요약 */
  state: RunnerState
  /** 🔴 왜 이 판정인지. `canRun` 이고 용량도 채우면 `null` */
  reason: string | null
}

export function runnerFactsOf(input: {
  installed: boolean
  loaded: boolean
  enabled: boolean
  failing?: boolean | null
  /** 이 단계가 요구하는 하루치 — 요구가 없으면 생략한다 */
  requiredPerDay?: number
  /** 🔴 실제로 관측한 하루치. 재지 않았으면 `null` */
  observedPerDay?: number | null
}): RunnerFacts {
  const failing = input.failing ?? null
  const state = runnerStateOf({
    installed: input.installed, loaded: input.loaded, enabled: input.enabled,
    failing: failing === true,
  })
  const canRun = runnerCanRun(state)

  let capacitySatisfied: boolean | null = null
  let capacityReason: string | null = null
  if (input.requiredPerDay !== undefined) {
    const seen = input.observedPerDay ?? null
    if (seen === null) {
      capacitySatisfied = null
      capacityReason = `필요 ${input.requiredPerDay}/day 인데 실측이 없다 — unmeasured`
    } else {
      capacitySatisfied = seen >= input.requiredPerDay
      if (!capacitySatisfied) capacityReason = `실측 ${seen}/day < 필요 ${input.requiredPerDay}/day`
    }
  }

  const reasons: string[] = []
  if (!canRun) reasons.push(RUNNER_STATE_REASON[state])
  if (capacityReason !== null) reasons.push(capacityReason)
  return {
    installed: input.installed, loaded: input.loaded, enabled: input.enabled,
    failing, canRun, capacitySatisfied, state,
    reason: reasons.length === 0 ? null : reasons.join(' · '),
  }
}

/** 🔴 라벨 하나마다 사람이 읽을 이유가 있다 */
export const RUNNER_STATE_REASON: Readonly<Record<RunnerState, string>> = {
  ready: '돌 수 있다',
  disabledByPolicy: '사람이 일부러 꺼 두었다 — 손상이 아니다',
  notRegistered: 'plist 가 설치되어 있지 않다',
  unloaded: '설치는 됐는데 launchctl 에 올라가 있지 않다',
  unhealthy: '올라가 있는데 최근 회차가 실패했다',
}

/** 🔴 능력 전체가 준비됐는가 — **용량이 unmeasured 면 준비된 것이 아니다** */
export function capabilityFactsReady(f: RunnerFacts): boolean {
  if (!f.canRun) return false
  // 🔴 용량 요구가 아예 없는 job 은 canRun 이면 준비된 것이다.
  //    요구가 있는데 재지 않았으면 `reason` 이 남아 있고, 그것은 준비가 아니다
  if (f.capacitySatisfied === null) return f.reason === null
  return f.capacitySatisfied
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
