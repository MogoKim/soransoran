/**
 * 수집 보호장치 — 🔴 **순수 함수. 네트워크·DB·파일·시각 조회 0** (2026-09-08)
 *
 * 🔴 왜 필요한가.
 *    지금 수집기는 하루 1~3회 돈다. 회차를 열 배로 늘리면 **실패의 성격이 달라진다.**
 *    한 번 막혔을 때 그대로 계속 두드리면, 그 다음에 오는 것은 느려짐이 아니라 **차단**이다.
 *    남의 서버 이야기이기도 하고, 차단되면 우리 공급이 통째로 멈춘다.
 *
 * 🔴 세 가지를 나눈다 — **대응이 서로 다르기 때문이다.**
 *
 *      403 FORBIDDEN    우리를 알아보고 막았다. 재시도가 상황을 악화시킨다
 *                       → 즉시 열고(1회) **오래 닫아 두고 사람을 부른다**
 *      429 RATE_LIMIT   속도가 문제다. 기다리면 풀린다
 *                       → 지수 backoff 로 물러난다. 짧게 닫는다
 *      TCP  NETWORK     연결 자체가 안 됐다. 우리 쪽 네트워크일 수도 있다
 *                       → 몇 번은 봐준다. 짧게 닫고 다시 본다
 *
 *    셋을 한 임계로 묶으면 403 을 다섯 번 맞을 때까지 계속 두드리게 된다.
 *
 * 🔴 상태는 인자로 받고 새 상태를 돌려준다. 저장은 호출부의 책임이다 —
 *    그래야 fixture 가 시각·파일 없이 같은 결과를 재현한다.
 */

import { MAX_REQUESTS_PER_DAY, type SourceId } from './collect-schedule'

// 🔴 호출부가 한 곳에서 import 하도록 그대로 내보낸다 — 소스 목록의 정본은 collect-schedule 이다
export type { SourceId }

// ─────────────────────────────────────────────────────────
// ① 실패 분류
// ─────────────────────────────────────────────────────────

export type FailureClass = 'FORBIDDEN' | 'RATE_LIMIT' | 'NETWORK' | 'SERVER' | 'OTHER'

/** 🔴 TCP 계열 오류 코드 — Node 가 그대로 준다 */
const NETWORK_CODES: readonly string[] = [
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]

/**
 * 🔴 무엇이 우리를 막았는가.
 *
 *    · HTTP 응답이 있으면 상태 코드가 정본이다
 *    · 응답이 없으면(연결 실패) 오류 코드를 본다
 *    · 어느 쪽도 모르면 `OTHER` — **`NETWORK` 로 넘기지 않는다.**
 *      모르는 것을 "네트워크가 잠깐 그랬다" 로 읽으면 임계가 가장 느슨한 칸에 쌓인다
 */
export function classifyFailure(input: { status?: number | null; code?: string | null }): FailureClass {
  const s = input.status ?? null
  if (s === 403) return 'FORBIDDEN'
  if (s === 429) return 'RATE_LIMIT'
  if (s !== null && s >= 500 && s <= 599) return 'SERVER'
  if (s !== null) return 'OTHER'
  const code = (input.code ?? '').toUpperCase()
  if (code !== '' && NETWORK_CODES.some((c) => code.includes(c))) return 'NETWORK'
  return 'OTHER'
}

// ─────────────────────────────────────────────────────────
// ② 지수 backoff
// ─────────────────────────────────────────────────────────

/** 🔴 분류마다 다르다 — 429 는 오래 물러나고, TCP 는 짧게 다시 본다 */
export type BackoffPolicy = { baseMs: number; capMs: number; maxAttempts: number }

export const BACKOFF: Readonly<Record<FailureClass, BackoffPolicy>> = {
  // 🔴 403 은 재시도하지 않는다 — 두드릴수록 나빠진다
  FORBIDDEN: { baseMs: 0, capMs: 0, maxAttempts: 0 },
  RATE_LIMIT: { baseMs: 30_000, capMs: 900_000, maxAttempts: 4 },
  NETWORK: { baseMs: 5_000, capMs: 120_000, maxAttempts: 3 },
  SERVER: { baseMs: 10_000, capMs: 300_000, maxAttempts: 3 },
  OTHER: { baseMs: 10_000, capMs: 120_000, maxAttempts: 2 },
}

/**
 * 🔴 `attempt` 번째 재시도까지 기다릴 시간. **결정적이다** — 난수를 쓰지 않는다.
 *
 *    지수는 2배씩이고 `capMs` 에서 멈춘다. 지터는 `seed` 에서 만든다 —
 *    난수를 쓰면 fixture 가 같은 입력에 다른 답을 내고, 그러면 이 계산을 검증할 수 없다.
 */
export function backoffMs(cls: FailureClass, attempt: number, seed = 0): number {
  const p = BACKOFF[cls]
  if (attempt < 1 || p.maxAttempts < 1) return 0
  const raw = Math.min(p.capMs, p.baseMs * 2 ** (attempt - 1))
  // 지터 ±12.5% — 여러 job 이 같은 초에 재시도해 몰리지 않게 한다
  const jitter = ((seed % 9) - 4) / 32
  return Math.max(0, Math.round(raw * (1 + jitter)))
}

/** 🔴 이 분류에서 재시도를 더 해도 되는가 */
export function canRetry(cls: FailureClass, attempt: number): boolean {
  return attempt < BACKOFF[cls].maxAttempts
}

// ─────────────────────────────────────────────────────────
// ③ circuit breaker — 분류별
// ─────────────────────────────────────────────────────────

export type BreakerPolicy = {
  /** 몇 번 연속 실패하면 연다 */
  threshold: number
  /** 열린 뒤 얼마나 닫아 두는가 */
  cooldownMs: number
  /** 🔴 사람이 확인해야 다시 여는가 — 쿨다운만으로 풀지 않는다 */
  requiresHuman: boolean
}

export const BREAKER: Readonly<Record<FailureClass, BreakerPolicy>> = {
  // 🔴 403 은 **한 번이면 연다.** 알아보고 막은 것이라 반복이 근거를 더해 주지 않는다
  FORBIDDEN: { threshold: 1, cooldownMs: 24 * 3600_000, requiresHuman: true },
  RATE_LIMIT: { threshold: 2, cooldownMs: 3600_000, requiresHuman: false },
  NETWORK: { threshold: 5, cooldownMs: 600_000, requiresHuman: false },
  SERVER: { threshold: 5, cooldownMs: 1800_000, requiresHuman: false },
  OTHER: { threshold: 3, cooldownMs: 1800_000, requiresHuman: false },
}

export type BreakerStatus = 'closed' | 'open' | 'half-open'

/**
 * 🔴 **half-open 시험 요청은 한 건이다.** 그 한 건이 끝나기 전에는 다시 보내지 않는다.
 *    시험이 끝나지 않은 채 프로세스가 죽으면 그 표시가 영원히 남으므로 시효를 둔다.
 */
export const PROBE_TIMEOUT_MS = 5 * 60_000

/** 분류 하나의 상태 */
export type FailureState = {
  /** 연속 실패 수 (성공하면 0) */
  consecutive: number
  /**
   * 열린 시각 (epoch ms). 닫혀 있으면 null.
   *
   * 🔴 **실패할 때마다 갱신된다.** 예전 판은 `prev.openedAt ?? nowMs` 라 첫 실패 시각을
   *    끝까지 들고 있었다 — half-open 에서 시험 요청이 실패해도 `now - openedAt` 이
   *    여전히 쿨다운을 넘어 **계속 half-open** 이었고, 막힌 상대를 무한히 두드렸다.
   */
  openedAt: number | null
  /**
   * 🔴 half-open 시험 요청을 **보낸 시각**. 결과가 나오면 지운다.
   *    이것이 있는 동안은 그 분류가 열린 것으로 본다 — 두 번째 시험을 보내지 않기 위해서다.
   */
  probeStartedAt: number | null
  /** 🔴 사람이 풀었는가 — `requiresHuman` 분류는 이것이 있어야 닫힌다 */
  clearedByHumanAt: number | null
}

export type GuardState = {
  source: SourceId
  /** KST 날짜 `YYYY-MM-DD` — 바뀌면 예산이 갈린다 */
  budgetDay: string
  /** 그날 보낸 요청 수 */
  requestsToday: number
  failures: Record<FailureClass, FailureState>
}

const FRESH: FailureState = { consecutive: 0, openedAt: null, probeStartedAt: null, clearedByHumanAt: null }

export function newGuardState(source: SourceId, budgetDay: string): GuardState {
  return {
    source, budgetDay, requestsToday: 0,
    failures: {
      FORBIDDEN: { ...FRESH }, RATE_LIMIT: { ...FRESH }, NETWORK: { ...FRESH },
      SERVER: { ...FRESH }, OTHER: { ...FRESH },
    },
  }
}

export const FAILURE_CLASSES: readonly FailureClass[] =
  ['FORBIDDEN', 'RATE_LIMIT', 'NETWORK', 'SERVER', 'OTHER']

/**
 * 🔴 분류 하나의 지금 상태.
 *
 *    `half-open` 은 "쿨다운은 지났지만 아직 성공을 못 봤다" 는 뜻이다 —
 *    한 건만 보내 보고, 그것이 실패하면 곧바로 다시 연다.
 */
export function breakerOf(state: GuardState, cls: FailureClass, nowMs: number): BreakerStatus {
  const f = state.failures[cls]
  if (f.openedAt === null) return 'closed'
  const p = BREAKER[cls]
  if (p.requiresHuman) {
    // 🔴 쿨다운만으로 풀리지 않는다. 사람이 푼 기록이 열린 뒤에 있어야 한다
    return f.clearedByHumanAt !== null && f.clearedByHumanAt >= f.openedAt ? 'closed' : 'open'
  }
  // 🔴 쿨다운이 아직이면 열려 있다
  if (nowMs - f.openedAt < p.cooldownMs) return 'open'
  /**
   * 🔴 쿨다운은 지났다. 그런데 **시험 요청이 이미 나가 있으면 또 보내지 않는다** —
   *    그것이 "한 건만 시험한다" 는 계약이다. 시효가 지난 표시는 버려진 시험으로 본다
   *    (프로세스가 죽어 결과를 남기지 못한 경우).
   */
  if (f.probeStartedAt !== null && nowMs - f.probeStartedAt < PROBE_TIMEOUT_MS) return 'open'
  return 'half-open'
}

/** 🔴 지금 요청을 보내도 되는가 — **예산과 차단기를 함께 본다** */
export function canRequest(state: GuardState, nowMs: number, budgetLimit?: number): {
  ok: boolean
  reason: string
  /** 막은 것이 무엇인가 */
  blockedBy: 'budget' | FailureClass | null
} {
  const limit = budgetLimit ?? MAX_REQUESTS_PER_DAY[state.source]
  if (state.requestsToday >= limit) {
    return { ok: false, blockedBy: 'budget', reason: `하루 요청 예산 소진 (${state.requestsToday}/${limit})` }
  }
  for (const cls of FAILURE_CLASSES) {
    if (breakerOf(state, cls, nowMs) === 'open') {
      const p = BREAKER[cls]
      const f = state.failures[cls]
      const probing = !p.requiresHuman && f.probeStartedAt !== null
        && nowMs - f.probeStartedAt < PROBE_TIMEOUT_MS
      return {
        ok: false, blockedBy: cls,
        reason: `${cls} 차단기가 열려 있다 (연속 ${f.consecutive}회)`
          + (p.requiresHuman ? ' — 🔴 사람이 확인해야 닫힌다'
            : probing ? ' — 🔴 half-open 시험 요청이 이미 나가 있다 (한 건만 시험한다)'
              : ` — 쿨다운 ${Math.round(p.cooldownMs / 60000)}분`),
      }
    }
  }
  return { ok: true, blockedBy: null, reason: '예산·차단기 모두 통과' }
}

/**
 * 요청 하나를 보냈다 — 🔴 성패와 무관하게 예산을 쓴다.
 *
 * 🔴 이때 **half-open 이던 분류를 "시험 중" 으로 표시한다.** 표시하지 않으면
 *    같은 순간에 두 프로세스가 각자 시험 요청을 보낸다 — 막힌 상대에게 두 배로 두드리는 셈이다.
 */
export function recordRequest(state: GuardState, nowMs: number): GuardState {
  const failures = { ...state.failures }
  for (const cls of FAILURE_CLASSES) {
    if (breakerOf(state, cls, nowMs) === 'half-open') {
      failures[cls] = { ...failures[cls], probeStartedAt: nowMs }
    }
  }
  return { ...state, requestsToday: state.requestsToday + 1, failures }
}

/** 성공 — 🔴 **그 분류만** 0 으로 돌린다. 다른 분류의 이력을 지우지 않는다 */
export function recordSuccess(state: GuardState): GuardState {
  const failures = { ...state.failures }
  for (const cls of FAILURE_CLASSES) {
    // 🔴 사람 확인이 필요한 분류는 성공 한 번으로 닫지 않는다 — 우연히 한 건 통과할 수 있다
    if (BREAKER[cls].requiresHuman && failures[cls].openedAt !== null) {
      // 🔴 그래도 시험 표시는 지운다 — 결과가 나왔으므로 매달아 두지 않는다
      failures[cls] = { ...failures[cls], probeStartedAt: null }
      continue
    }
    failures[cls] = { ...failures[cls], consecutive: 0, openedAt: null, probeStartedAt: null }
  }
  return { ...state, failures }
}

/**
 * 실패 — 분류를 세고, 임계에 닿으면 그 분류의 차단기를 연다.
 *
 * 🔴 **`openedAt` 은 실패할 때마다 갱신된다 = 쿨다운이 그 시각부터 다시 시작한다.**
 *    예전 판은 `prev.openedAt ?? nowMs` 로 첫 실패 시각을 유지했다. 그래서
 *    half-open 에서 시험 요청이 실패해도 `now - openedAt` 이 여전히 쿨다운을 넘어
 *    **계속 half-open** 이었고, 물러나야 할 때 오히려 계속 두드렸다.
 */
export function recordFailure(state: GuardState, cls: FailureClass, nowMs: number): GuardState {
  const prev = state.failures[cls]
  const consecutive = prev.consecutive + 1
  const openedAt = consecutive >= BREAKER[cls].threshold ? nowMs : prev.openedAt
  return {
    ...state,
    // 🔴 시험 표시를 지운다 — 결과가 나왔다. 다음 시험은 새 쿨다운 뒤다
    failures: { ...state.failures, [cls]: { ...prev, consecutive, openedAt, probeStartedAt: null } },
  }
}

/** 🔴 사람이 확인하고 풀었다 — `requiresHuman` 분류를 닫는 유일한 경로 */
export function clearByHuman(state: GuardState, cls: FailureClass, nowMs: number): GuardState {
  return {
    ...state,
    failures: {
      ...state.failures,
      [cls]: { consecutive: 0, openedAt: null, probeStartedAt: null, clearedByHumanAt: nowMs },
    },
  }
}

/** 🔴 날이 바뀌면 예산만 초기화한다 — **차단기는 넘어간다.** 차단은 하루로 잊을 일이 아니다 */
export function rollBudgetDay(state: GuardState, kstDay: string): GuardState {
  return state.budgetDay === kstDay ? state : { ...state, budgetDay: kstDay, requestsToday: 0 }
}

export type BudgetView = { used: number; limit: number; remaining: number; ratio: number; exhausted: boolean }

export function budgetOf(state: GuardState, budgetLimit?: number): BudgetView {
  const limit = budgetLimit ?? MAX_REQUESTS_PER_DAY[state.source]
  const used = state.requestsToday
  return {
    used, limit, remaining: Math.max(0, limit - used),
    ratio: limit > 0 ? used / limit : 1,
    exhausted: used >= limit,
  }
}

/** 🔴 관제 화면·JSON 이 같이 읽는 요약 */
export function describeGuard(state: GuardState, nowMs: number): string {
  const b = budgetOf(state)
  const open = FAILURE_CLASSES
    .filter((c) => breakerOf(state, c, nowMs) !== 'closed')
    .map((c) => `${c}:${breakerOf(state, c, nowMs)}`)
  return `${state.source} — 예산 ${b.used}/${b.limit}`
    + ` · 차단기 ${open.length === 0 ? '전부 closed' : open.join(' · ')}`
}

/** 🔴 JSON 으로 내보내는 모양 — 화면과 같은 값을 쓴다 */
export function guardSnapshot(state: GuardState, nowMs: number): {
  source: SourceId
  budget: BudgetView
  breakers: {
    cls: FailureClass; status: BreakerStatus; consecutive: number; requiresHuman: boolean
    /** 열린 시각 — 🔴 실패할 때마다 갱신된다 */
    openedAt: number | null
    /** 🔴 half-open 시험 요청이 나가 있는가 */
    probing: boolean
    /** 다시 시험해 볼 수 있는 시각 (requiresHuman 이면 null — 사람만 연다) */
    retryAt: number | null
  }[]
  healthy: boolean
  /** 🔴 사람이 확인해야만 닫히는 차단기가 열려 있는가 */
  needsHuman: FailureClass[]
} {
  const breakers = FAILURE_CLASSES.map((cls) => {
    const f = state.failures[cls]
    const p = BREAKER[cls]
    return {
      cls, status: breakerOf(state, cls, nowMs),
      consecutive: f.consecutive,
      requiresHuman: p.requiresHuman,
      openedAt: f.openedAt,
      probing: !p.requiresHuman && f.probeStartedAt !== null
        && nowMs - f.probeStartedAt < PROBE_TIMEOUT_MS,
      retryAt: f.openedAt === null || p.requiresHuman ? null : f.openedAt + p.cooldownMs,
    }
  })
  return {
    source: state.source,
    budget: budgetOf(state),
    breakers,
    healthy: breakers.every((b) => b.status === 'closed') && !budgetOf(state).exhausted,
    needsHuman: breakers.filter((b) => b.requiresHuman && b.status !== 'closed').map((b) => b.cls),
  }
}
