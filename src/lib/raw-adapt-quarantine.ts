/**
 * 🔴 **적응 레인 격리 — 상한 · 기한 · 순서** (2026-09-29 · `raw-adapt-v1` 보강)
 *
 * 🔴 **왜 있나.** 긴 사연 적응 초안은 창업자 gold 에 표본이 한 건도 없다. 앞판(#627 ece8e27)은 그 행을
 *    "사람 검토 전용" 으로 적재했다 — 그러면 매 회차 적응 행이 **창업자 검토 대기열**에 쌓이고,
 *    아무도 보지 않으면 그 수가 곧 창업자의 밀린 일이 된다. 사람 손을 없애려고 만든 공급이 사람 손을 늘린다.
 *
 * 🔴 **그래서 적응 행은 내부 실험 격리다** (`raw-adapt-lane.ts` · `carriesRawAdaptMark`):
 *    ① 창업자 대기열 0 — 사람 검토 목록(`publish:machine-review`) · 어드민 대기열 · 재고 칸 `humanReviewPending`
 *       어디에도 없다. selector 는 사람 검토 판정보다 **먼저** 격리로 뺀다(HUMAN_REVIEW_REQUIRED 가 아니다)
 *    ② Persona WIP 0 — 화자 여력 · 주간 사용량 · 수동 배정에서 뺀다
 *    ③ 양을 묶는다 — 아래 상한(회차 · 하루 · 생성 회차)
 *    ④ 기한이 지나면 만료 — 읽을 때 빼고(`isRawAdaptExpired`), 쓰는 청소는 `--apply` 뒤에만 있다(예약 없음)
 *    ⑤ 자동 발행 0 — 자동 도장 · selector · 발행 재검증 세 곳이 막는다(그대로)
 *
 * 🔴 **seed 공급을 굶기지 않는다** — 적응은 **자기 몫**만 쓴다.
 *    · 판정 묶음: raw 자리 상한 2/10 은 그대로다(`worksetAxisQuota` — 이 파일은 그 값을 바꾸지 않는다)
 *    · 생성: seed 원천이 **먼저** 화자·예산을 받고, 적응 원천은 뒤에서 회차당 상한까지만 간다
 *    · 적재: seed 후보가 **먼저** 자리를 받고, 적응 후보는 회차·하루 상한까지만 간다
 *    · 상한에 걸린 적응 후보는 `cut`(이월 대상)이 아니라 **건너뜀**이다 — 이월 파일 자리를 차지하지 않는다
 *
 * 🔴 순수하다. DB · 네트워크 · 파일 · LLM 없음.
 */
import { requiredRouteOf, RAW_ADAPTATION_VERSION } from './raw-adaptation'
import { carriesRawAdaptMark, RAW_ADAPT_QUARANTINE_STATE } from './raw-adapt-lane'

// ─────────────────────────────────────────────────────────
// 🔴 상한 — 이름 붙은 상수 하나씩. 근거를 같이 적는다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **한 회차에 적재하는 적응 행 상한 = 2.**
 *    판정 묶음의 raw 자리 상한(기본 상한 10 → raw ≤ 2, `worksetAxisCaps`)과 같은 값이다 —
 *    한 회차가 판정할 수 있는 raw 원천보다 많이 싣는 일은 정상 경로에서 없다. 이월 파일이 얹혀도 이 값을 넘지 않는다.
 */
export const RAW_ADAPT_LOAD_CAP_PER_RUN = 2

/**
 * 🔴 **하루(KST)에 적재하는 적응 행 상한 = 4.**
 *    정기 회차는 하루 6회(`SUPPLY_RUNS_PER_DAY`)라 회차 상한만 두면 하루 12건까지 쌓인다.
 *    적응 행은 실험 표본이다 — 판단에 쓸 표본은 하루 몇 건이면 되고, 기한(7일) 안에 살아 있는 행을
 *    **최대 28건**(4 × 7)으로 묶는다. 이 수를 넘는 적응 행은 누구도 보지 않을 재고일 뿐이다.
 */
export const RAW_ADAPT_LOAD_CAP_PER_DAY = 4

/**
 * 🔴 **한 생성 회차에서 초안을 만드는 적응 원천 상한 = 2** — 유료 호출의 몫이다.
 *    생성 러너는 판정 파일 여러 개를 읽으므로(이월 · 앞 회차) 판정 묶음 상한만으로는 적응 원천 수가 묶이지 않는다.
 *    판정 묶음 raw 자리와 같은 값으로 두어 **회차당 적응 유료 호출 = 원천 2개 몫**을 넘지 않게 한다.
 */
export const RAW_ADAPT_DRAFT_CAP_PER_RUN = 2

/**
 * 🔴 **격리 기한 = 7일.** 적재 시각(`createdAt` — DB 가 적은 값)에서 7일이 지나면 만료다.
 *    원천 신선도(TTL)보다 길 이유가 없고, 일주일 안에 쓰지 않은 실험 표본은 다음 판 규칙의 표본이 되지 못한다.
 */
export const RAW_ADAPT_QUARANTINE_TTL_DAYS = 7
const DAY_MS = 864e5
export const RAW_ADAPT_QUARANTINE_TTL_MS = RAW_ADAPT_QUARANTINE_TTL_DAYS * DAY_MS

// ─────────────────────────────────────────────────────────
// 🔴 격리 표식 — 적재기가 싣는 값
// ─────────────────────────────────────────────────────────

export type RawAdaptQuarantineMark = {
  state: typeof RAW_ADAPT_QUARANTINE_STATE
  lane: string
  /** 🔴 창업자 대기열에 올리지 않는다 — 값으로 적어 두어 표식만 봐도 알 수 있게 한다 */
  founderQueue: false
  ttlDays: number
  queuedAt: string
}

/** 🔴 적재기가 적응 행에 싣는 격리 표식 — 기한 판정은 이 값이 아니라 DB `createdAt` 으로 한다 */
export function rawAdaptQuarantineMark(nowIso: string): RawAdaptQuarantineMark {
  return {
    state: RAW_ADAPT_QUARANTINE_STATE, lane: RAW_ADAPTATION_VERSION, founderQueue: false,
    ttlDays: RAW_ADAPT_QUARANTINE_TTL_DAYS, queuedAt: nowIso,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 창업자 대기열 — 격리 행을 뺀다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **창업자 · 사람이 보는 대기열의 행** — 적응 레인 격리 행을 뺀다(판정은 `carriesRawAdaptMark` 하나).
 *    사람 검토 목록(`publish:machine-review`) · 어드민 초안 대기열이 이 함수를 쓴다. 순서는 그대로다.
 */
export function founderQueueRowsOf<T extends { gateResults?: unknown }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !carriesRawAdaptMark(r.gateResults))
}

// ─────────────────────────────────────────────────────────
// 🔴 기한 — 읽을 때 뺀다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **기한이 지났는가** — DB 가 적은 적재 시각(`createdAt`)으로만 잰다. 표식 안의 시각은 믿지 않는다.
 *    시각을 모르면(null · 못 읽는 값) **만료로 본다**(fail-closed) — 모르는 행을 살아 있다고 하지 않는다.
 */
export function isRawAdaptExpired(createdAt: Date | null | undefined, now: Date): boolean {
  if (createdAt === null || createdAt === undefined) return true
  const t = createdAt.getTime()
  if (Number.isNaN(t)) return true
  return now.getTime() - t >= RAW_ADAPT_QUARANTINE_TTL_MS
}

export type QuarantineRowFacts = {
  id: string
  status: string
  createdPostId: string | null
  decidedBy: string | null
  gateResults: unknown
  createdAt: Date | null
}

/**
 * 🔴 **격리 행을 읽는다 — 기한이 지난 행은 살아 있는 쪽에서 뺀다(읽기 배제).**
 *    격리 행이 아닌 것은 어느 쪽에도 넣지 않는다.
 */
export function quarantineViewOf<T extends QuarantineRowFacts>(rows: readonly T[], now: Date): { live: T[]; expired: T[] } {
  const live: T[] = []
  const expired: T[] = []
  for (const r of rows) {
    if (!carriesRawAdaptMark(r.gateResults)) continue
    ;(isRawAdaptExpired(r.createdAt, now) ? expired : live).push(r)
  }
  return { live, expired }
}

/**
 * 🔴 **청소 대상** — 기한이 지난 **검토되지 않은** 격리 행만 (`EXPIRED` 로 보낼 행).
 *    · 격리 흔적이 있다 · 기한이 지났다 · `APPROVED` 다 · 발행되지 않았다 · 결정자가 `machine:*` 다
 *    🔴 사람·자동 도장이 있는 행 · 발행된 행 · 다른 상태는 건드리지 않는다. 판정만 한다 — 쓰기는 부르는 쪽이 `--apply` 로.
 */
export function planRawAdaptSweep<T extends QuarantineRowFacts>(rows: readonly T[], now: Date): T[] {
  return quarantineViewOf(rows, now).expired.filter((r) =>
    r.status === 'APPROVED'
    && (r.createdPostId === null || r.createdPostId === '')
    && (r.decidedBy ?? '').startsWith('machine:'))
}

// ─────────────────────────────────────────────────────────
// 🔴 적재 상한 — seed 먼저 · 적응은 회차·하루 상한까지
// ─────────────────────────────────────────────────────────

/** 🔴 KST 자정 — 하루 상한은 KST 하루로 센다(공급 회차 · 발행 하루와 같은 눈금) */
export function kstDayStartOf(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000)
}

/** 🔴 오늘(KST) 적재된 격리 행 수 — DB `createdAt` 으로 센다. 기한 · 상태와 무관하다(만료돼도 오늘 쓴 몫이다) */
export function quarantineLoadedToday(rows: readonly { gateResults: unknown; createdAt: Date | null }[], now: Date): number {
  const start = kstDayStartOf(now).getTime()
  return rows.filter((r) => carriesRawAdaptMark(r.gateResults)
    && r.createdAt !== null && r.createdAt.getTime() >= start).length
}

export type AdaptLoadPlan<T> = {
  /** 🔴 seed 후보가 먼저(원래 순서 그대로) · 그 뒤에 적응 후보가 상한까지 */
  ordered: T[]
  /** 🔴 상한에 걸려 이번에 싣지 않는 적응 후보 — 건너뜀(이월 대상 아님) */
  capped: T[]
  /** 이번 회차에 적응 후보가 가질 수 있는 자리 */
  room: number
}

/**
 * 🔴 **적재 순서와 적응 상한** — 적재기(`judgeApply` 앞)가 부른다.
 *    · seed 후보는 **하나도 빠지지 않고 원래 순서 그대로 앞에 선다** — 적응이 없으면 입력과 같은 배열이다
 *    · 적응 후보는 `min(회차 상한, 하루 상한 − 오늘 적재 수)` 까지만 뒤에 선다
 */
export function planAdaptLoads<T>(input: {
  targets: readonly T[]
  isAdapt: (t: T) => boolean
  loadedToday: number
  perRun?: number
  perDay?: number
}): AdaptLoadPlan<T> {
  const perRun = input.perRun ?? RAW_ADAPT_LOAD_CAP_PER_RUN
  const perDay = input.perDay ?? RAW_ADAPT_LOAD_CAP_PER_DAY
  const room = Math.max(0, Math.min(perRun, perDay - Math.max(0, input.loadedToday)))
  const seed = input.targets.filter((t) => !input.isAdapt(t))
  const adapt = input.targets.filter((t) => input.isAdapt(t))
  return { ordered: [...seed, ...adapt.slice(0, room)], capped: adapt.slice(room), room }
}

// ─────────────────────────────────────────────────────────
// 🔴 생성 순서 — seed 먼저 · 적응은 회차 상한까지
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **생성 러너의 원천 순서와 적응 상한.** 화자 여력 계획 · 공동 호출 예산 · 회차 장부가 이 순서로 쓰인다 —
 *    seed 원천이 **먼저** 화자와 예산을 받는다. 적응 원천은 회차 상한까지만 이번에 가고, 나머지는 판정 그대로
 *    다음 회차로 남는다(끝난 원천이 아니다).
 *    🔴 경로는 판정 값에서 읽는다(`requiredRouteOf`) — `AUTO_RAW` 가 적응이다. seed 만 있으면 입력과 같은 배열이다.
 */
export function planAdaptDrafts<T extends { decision: string }>(
  judgements: readonly T[], cap: number = RAW_ADAPT_DRAFT_CAP_PER_RUN,
): { ordered: T[]; deferred: T[] } {
  const isAdapt = (j: T): boolean => requiredRouteOf(j.decision) === 'adapt'
  const seed = judgements.filter((j) => !isAdapt(j))
  const adapt = judgements.filter(isAdapt)
  const n = Math.max(0, cap)
  return { ordered: [...seed, ...adapt.slice(0, n)], deferred: adapt.slice(n) }
}
