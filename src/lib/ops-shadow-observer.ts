/**
 * 🔴 **ops shadow observer — 무엇을 관측할지 고르는 순수 함수** (2026-11-11 · Phase 2 · 권위 0)
 *
 *    launchd 가 60초마다 깨우는 observer 는 이 함수가 고른 회차만 관측해 감사 장부에 적는다.
 *    공급 · controller · 발행 · 댓글의 실행 · exit · 권위는 바꾸지 않는다(observer 는 그들을 부르지도 기다리지도 않는다).
 *
 *    🔴 **자연 회차 판단은 한 벌이다** — `SupplyRunView.naturalAt` 은 IO 가 정본 `naturalScheduledRunEvidenceAt` 으로 만든
 *       값이고, 여기와 Phase 1 `writerDueOf` 가 같은 칸을 쓴다. trigger 문자열을 다시 읽지 않는다.
 *    🔴 **열쇠는 회차다** — `naturalRunKeyOf(runId, completedAt)`. heartbeat 시각이 들어가지 않으므로 같은 회차를
 *       몇 번 보아도(1,440 tick · 동시 observer · 재부팅) 같은 cycle id 이고, 장부 sink 가 한 줄로 만든다.
 *    🔴 `status: done` 은 완료 관측일 뿐 공급 최종 exit 0 이 아니다 — 기록에 integrity unknown 으로 남긴다.
 */
import { cycleIdOf, naturalRunKeyOf, type SupplyRunView } from './ops-shadow-plan'
import { SUPPLY_RUN_WINDOW_MS } from './supply-schedule-contract'

/** 완료 뒤 이 안에 본 회차만 지금 상태를 관측한다(causal · 관측 시각은 tick). 넘으면 backfill marker 한 줄 — heartbeat 60초 + 여유 */
export const OBSERVER_CAUSAL_LAG_MS = 5 * 60_000
/** 이보다 오래 전에 끝난 회차는 보지 않는다 — 밀린 기록이 끝없이 쌓이지 않게(재부팅 · 잠자기 회복 범위) */
export const OBSERVER_LOOKBACK_MS = 3 * 86_400_000
/** 한 tick 에 관측할 회차 상한 — 남은 것은 다음 tick 이 결정적 순서대로 잇는다 */
export const OBSERVER_MAX_PER_TICK = 3
/** launchd 가 observer 를 깨우는 간격(초) — 템플릿이 이 값을 쓴다 */
export const OBSERVER_INTERVAL_SEC = 60

const KST_MS = 9 * 3_600_000
const kstDateOf = (ms: number): string => new Date(ms + KST_MS).toISOString().slice(0, 10)
const strictIsoMs = (v: string | null): number | null => {
  if (v === null) return null
  const t = Date.parse(v)
  return Number.isNaN(t) || new Date(t).toISOString() !== v ? null : t
}

export type ObserverWork = {
  runId: string
  completedAt: string
  /** 정본 자연 회차 증거 시각 — 기록 날짜(KST)를 정한다 */
  naturalAt: string
  kstDate: string
  key: string
  cycleId: string
  mode: 'causal' | 'backfill'
}

export type ObserverClass =
  | 'pending' | 'seen' | 'notNatural' | 'running' | 'stale' | 'badTimes' | 'future' | 'tooOld'

export type ObserverSelection = {
  /** 이번 tick 에 관측할 회차 — 완료 시각 → runId 순 · 상한까지 */
  work: ObserverWork[]
  /** 상한 때문에 다음 tick 으로 미룬 회차 수 */
  deferred: number
  /** 회차별 분류(진단) — 결정적 순서 */
  classes: { runId: string; cls: ObserverClass }[]
}

/**
 * 🔴 **이번 tick 에 무엇을 관측하나.**
 *    · 자연 회차가 아니면(`naturalAt` null) 제외 — manual · recovery · event · 손상 tag
 *    · `done` 이 아니면 시작 뒤 `SUPPLY_RUN_WINDOW_MS` 안은 running, 넘으면 stale(모름) — 둘 다 다른 회차를 막지 않는다
 *    · 시작 · 완료 시각이 엄격 ISO 가 아니거나 완료 < 시작이면 badTimes · 완료가 지금보다 미래면 future
 *    · 이미 장부에 같은 cycle id 가 있으면 seen
 *    · 완료 뒤 `OBSERVER_LOOKBACK_MS` 를 넘으면 tooOld(보지 않는다)
 *    · 나머지는 pending — 완료 뒤 `OBSERVER_CAUSAL_LAG_MS` 안이면 causal, 넘으면 backfill
 */
export function selectObserverWork(i: {
  now: Date
  runs: readonly SupplyRunView[]
  seenCycleIds: ReadonlySet<string>
  maxPerTick?: number
}): ObserverSelection {
  const nowMs = i.now.getTime()
  const max = i.maxPerTick ?? OBSERVER_MAX_PER_TICK
  const classes: { runId: string; cls: ObserverClass }[] = []
  const pending: ObserverWork[] = []
  const ordered = [...i.runs].sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0))
  for (const r of ordered) {
    const cls = ((): ObserverClass => {
      if (r.naturalAt === null) return 'notNatural'
      const start = strictIsoMs(r.startedAt)
      const natural = strictIsoMs(r.naturalAt)
      if (start === null || natural === null) return 'badTimes'
      if (r.status !== 'done') return nowMs - start < SUPPLY_RUN_WINDOW_MS ? 'running' : 'stale'
      const end = strictIsoMs(r.completedAt)
      if (end === null || end < start) return 'badTimes'
      if (end > nowMs) return 'future'
      if (nowMs - end > OBSERVER_LOOKBACK_MS) return 'tooOld'
      const key = naturalRunKeyOf(r.runId, r.completedAt!)
      const kstDate = kstDateOf(natural)
      const cycleId = cycleIdOf('cycle', kstDate, key)
      if (i.seenCycleIds.has(cycleId)) return 'seen'
      pending.push({
        runId: r.runId, completedAt: r.completedAt!, naturalAt: r.naturalAt, kstDate, key, cycleId,
        mode: nowMs - end <= OBSERVER_CAUSAL_LAG_MS ? 'causal' : 'backfill',
      })
      return 'pending'
    })()
    classes.push({ runId: r.runId, cls })
  }
  pending.sort((a, b) => (Date.parse(a.completedAt) - Date.parse(b.completedAt)) || (a.runId < b.runId ? -1 : 1))
  const take = Math.max(0, Math.floor(max))
  return { work: pending.slice(0, take), deferred: Math.max(0, pending.length - take), classes }
}
