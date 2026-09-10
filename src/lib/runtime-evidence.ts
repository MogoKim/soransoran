/**
 * 예약 실행 증거 판정 — 🔴 **순수 함수. 파일·시계·프로세스를 건드리지 않는다**
 *
 * 🔴 **왜 떼어냈나** (2026-09-09 Codex 지적).
 *
 *    Wave C 준비도가 로그에서 `thin-detail.jsonl` **글자 수를 세고** 있었다. 그래서
 *      · 전환 **이전** 성공까지 세어 `succeeded=4` 가 나왔다 (실제 관찰 구간은 0회)
 *      · 같은 회차가 여러 줄에 찍히면 그만큼 부풀었다
 *      · "오늘" 만 세니 22:20 에 잠깐 PASS 했다가 **자정에 0 으로 되돌아갔다**
 *
 *    증거는 글자 수가 아니라 **회차(run)** 다. 그래서 runId 의 시각을 파싱해
 *    **전환 이후의 고유 성공 회차**를 세고, **예정 슬롯**에 하나씩 맞춘다.
 *    날짜가 바뀌어도 최근 슬롯의 증거는 그대로 남는다.
 */

/** 한 회차의 성공 증거 */
export type RunEvidence = {
  /** `20260909-092004` */
  runId: string
  /** runId 를 로컬 시각으로 읽은 epoch ms */
  at: number
}

/**
 * 🔴 **성공 줄만** 센다.
 *
 *    수집기는 얇은 사본을 남길 때만 `… .thin-detail.jsonl (N건 · run <id>)` 를 찍는다.
 *    "실제 수집 · run <id>" 는 **시작** 줄이라 세지 않는다 — 떠서 죽은 회차가 성공이 되면 안 된다.
 */
const SUCCESS_LINE = /\.thin-detail\.jsonl \(\d+건 · run (\d{8}-\d{6})\)/g

/**
 * `20260909-092004` → epoch ms (로컬 시각). 형식이 아니면 null
 *
 * 🔴 **없는 날짜를 굴려서 받아주지 않는다.** `new Date(2026, 8, 31)` 은 10월 1일이 된다 —
 *    그대로 두면 `20260931-092004` 같은 runId 가 하루 뒤 슬롯을 채우게 된다.
 *    그래서 되읽어서 넣은 값과 같은지 확인한다.
 */
export function runIdToMs(runId: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(runId)
  if (m === null) return null
  const [, y, mo, d, h, mi, s] = m
  const t = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (Number.isNaN(t.getTime())) return null
  // 🔴 되읽기 대조 — 굴러간 날짜(2/30 · 9/31 · 25시)를 걸러낸다
  if (t.getFullYear() !== Number(y) || t.getMonth() !== Number(mo) - 1 || t.getDate() !== Number(d)
    || t.getHours() !== Number(h) || t.getMinutes() !== Number(mi) || t.getSeconds() !== Number(s)) return null
  return t.getTime()
}

/** 🔴 같은 runId 가 여러 줄에 나와도 **한 회차**다 */
export function parseSuccessRuns(logBody: string): RunEvidence[] {
  const seen = new Map<string, RunEvidence>()
  for (const m of logBody.matchAll(SUCCESS_LINE)) {
    const runId = m[1]!
    if (seen.has(runId)) continue
    const at = runIdToMs(runId)
    if (at === null) continue
    seen.set(runId, { runId, at })
  }
  return [...seen.values()].sort((a, b) => a.at - b.at)
}

export type Slot = { hour: number; minute: number }

/**
 * `since` 이후 `now` 까지 **실제로 지나간** 예정 슬롯 시각들 — 오래된 것부터.
 *
 * 🔴 날짜를 넘어간다. 22:20 과 04:20 은 다른 날이지만 같은 계약의 슬롯이다.
 */
export function elapsedSlots(input: {
  slots: readonly Slot[]
  since: number
  now: number
  /** 안전장치 — 아무리 길어도 이 일수까지만 훑는다 */
  maxDays?: number
}): number[] {
  if (input.slots.length === 0 || input.now < input.since) return []
  const out: number[] = []
  const maxDays = input.maxDays ?? 14
  const start = new Date(input.since)
  const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  for (let d = 0; d <= maxDays; d += 1) {
    const base = new Date(day0 + d * 86_400_000)
    for (const s of input.slots) {
      const t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), s.hour, s.minute, 0).getTime()
      if (t >= input.since && t <= input.now) out.push(t)
    }
    if (day0 + d * 86_400_000 > input.now) break
  }
  return out.sort((a, b) => a - b)
}

export type SlotVerdict = {
  /** 맞춘 슬롯 수 */
  succeeded: number
  /** 요구 수 — 계약상 항상 같다 */
  expected: number
  /** 전환 이후 실제로 지나간 슬롯 수 */
  elapsed: number
  /**
   * 🔴 어느 회차가 어느 슬롯에 붙었는가.
   *    관측 처리량은 **이 회차들의 실제 산출 행 수**로 센다 —
   *    설정값에 성공 비율을 곱하면 그건 여전히 설정값의 그림자다.
   */
  matchedRunIds?: readonly string[]
  detail: string
}

/**
 * 🔴 **최근 `expected` 개 슬롯을 전부 성공해야 PASS.**
 *
 *    · 전환 이전 회차는 세지 않는다 (`since`)
 *    · 같은 runId 는 한 번만 센다 (`parseSuccessRuns`)
 *    · 아직 `expected` 개가 지나지 않았으면 **PASS 가 될 수 없다** — 증거가 모자란 것이다
 *    · 한 회차는 **슬롯 하나에만** 붙는다. 한 번 성공으로 네 칸을 채우지 못한다
 */
export function judgeSlotEvidence(input: {
  runs: readonly RunEvidence[]
  slots: readonly Slot[]
  since: number
  now: number
  expected?: number
  /** 슬롯 시각에서 이만큼 안에 시작한 회차를 그 슬롯의 것으로 본다 */
  toleranceMs?: number
}): SlotVerdict {
  const expected = input.expected ?? 4
  const tolerance = input.toleranceMs ?? 90 * 60_000
  const elapsed = elapsedSlots({ slots: input.slots, since: input.since, now: input.now })
  const recent = elapsed.slice(-expected)
  const usable = input.runs
    // 🔴 전환 이후 · **미래가 아닌** 회차만 쓴다. 로그의 runId 는 그냥 글자라서 앞당겨 쓸 수 있다
    .filter((r) => r.at >= input.since && r.at <= input.now)
    .sort((a, b) => a.at - b.at)
  const used = new Set<string>()
  /** 🔴 어느 회차가 어느 슬롯에 붙었는가 — 관측 처리량을 그 회차에서만 센다 */
  const matchedRunIds: string[] = []
  let succeeded = 0
  for (const slot of recent) {
    // 🔴 **슬롯 시각 이후**로 tolerance 안에 시작한 회차만 그 슬롯의 것이다.
    //
    //    양쪽으로 열어 두면 13:20 에 손으로 돌린 회차가 14:50 예약 슬롯을 채운다.
    //    예약이 돌았다는 증거를 손으로 만든 증거가 대신할 수 없다 —
    //    슬롯보다 **먼저** 끝난 회차는 그 슬롯이 돌았는지에 대해 아무것도 말해 주지 않는다.
    const hit = usable.find((r) => !used.has(r.runId) && r.at >= slot && r.at - slot <= tolerance)
    if (hit !== undefined) { used.add(hit.runId); matchedRunIds.push(hit.runId); succeeded += 1 }
  }
  return {
    succeeded,
    expected,
    elapsed: elapsed.length,
    matchedRunIds,
    detail: elapsed.length < expected
      ? `전환 이후 지나간 슬롯이 ${elapsed.length}개뿐이다 — ${expected}개가 지나야 판정할 수 있다`
      : `최근 ${expected}개 슬롯 중 ${succeeded}개 성공`,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 checkpoint 신선도 (P0-3)
// ─────────────────────────────────────────────────────────

export type CheckpointFacts = {
  status: string | null
  /** ISO 문자열 — 없으면 null */
  startedAt: string | null
  completedAt: string | null
  /** 그 회차가 어느 runtime SHA 에서 돌았는가. 옛 회차에는 없다 */
  runtimeSha?: string | null
}

export type CheckpointVerdict = { ok: boolean; reason: string }

/**
 * 🔴 **전환 이전의 `done` 은 Wave C 증거가 아니다.**
 *
 *    옛 코드로 돈 회차가 "done" 이라는 이유로 승격 조건을 채우면,
 *    우리는 **지금 돌고 있는 것과 다른 것**을 보고 공개 발행량을 3배로 올리게 된다.
 *
 * 🔴 막는 것 (전부 fail-closed)
 *    · checkpoint 가 없다 / status 가 done 이 아니다
 *    · `runtimeSha` 가 **없다** — 새 배포 뒤의 회차라면 반드시 있다.
 *      (전환 이전 회차는 `deployedAt` 에서 이미 걸러진다. "옛 회차엔 없을 수 있다" 는
 *       허용은 **없는 것을 통과시키는 구멍**이었다)
 *    · `runtimeSha !== manifest.sha` — 다른 코드에서 돈 회차다
 *    · 시각이 없다 / 손상됐다 / completedAt < startedAt / 미래다
 *    · **예약 슬롯의 회차가 아니다** — 손으로 돌린 회차를 정기 회차 증거로 쓰지 않는다
 */
export function judgeCheckpointFreshness(input: {
  cp: CheckpointFacts | null
  /** runtime 전환 시각 */
  deployedAt: number | null
  /** 지금 runtime 이 물고 있는 SHA (manifest.sha) */
  runtimeSha: string | null
  /** 지금 시각 — 미래 회차를 걸러내는 데 쓴다 */
  now?: number
  /** 🔴 이 회차가 붙어야 하는 예약 슬롯들. 주면 슬롯 대조까지 한다 */
  slots?: readonly Slot[]
  /** 슬롯 시각 이후 이만큼 안에 시작해야 그 슬롯의 회차다 (기본 90분) */
  slotToleranceMs?: number
}): CheckpointVerdict {
  if (input.deployedAt === null) {
    return { ok: false, reason: 'runtime 배포 시각 기록이 없다 — 무엇이 최신인지 판단할 수 없다' }
  }
  if (input.cp === null) return { ok: false, reason: '공급 회차 checkpoint 가 없다' }
  if (input.cp.status !== 'done') {
    return { ok: false, reason: `마지막 회차 checkpoint 가 ${input.cp.status ?? '알 수 없음'} 다 — done 이어야 한다` }
  }

  // ── 🔴 runtime SHA — 있어야 하고, 지금 것과 같아야 한다 ──
  const cpSha = input.cp.runtimeSha ?? null
  if (cpSha === null || cpSha === '') {
    return { ok: false, reason: 'checkpoint 에 runtimeSha 가 없다 — 어느 코드에서 돈 회차인지 증명할 수 없다(fail-closed)' }
  }
  if (input.runtimeSha === null) {
    return { ok: false, reason: '지금 runtime 의 SHA 를 읽지 못했다 — 대조할 수 없다(fail-closed)' }
  }
  if (cpSha !== input.runtimeSha) {
    return { ok: false, reason: `그 회차는 다른 runtime SHA(${cpSha.slice(0, 7)} ≠ ${input.runtimeSha.slice(0, 7)})에서 돌았다` }
  }

  // ── 🔴 시각 — 순서·미래·손상을 전부 본다 ──
  if (input.cp.startedAt === null) {
    return { ok: false, reason: 'checkpoint 에 startedAt 이 없다 — 언제 시작했는지 알 수 없다(fail-closed)' }
  }
  const started = Date.parse(input.cp.startedAt)
  if (Number.isNaN(started)) {
    return { ok: false, reason: 'checkpoint 의 startedAt 을 읽지 못했다(손상) — 통과시키지 않는다' }
  }
  if (input.cp.completedAt === null) {
    return { ok: false, reason: 'checkpoint 에 completedAt 이 없다 — done 인데 끝난 시각이 없다(fail-closed)' }
  }
  const ended = Date.parse(input.cp.completedAt)
  if (Number.isNaN(ended)) {
    return { ok: false, reason: 'checkpoint 의 completedAt 을 읽지 못했다(손상) — 통과시키지 않는다' }
  }
  if (ended < started) {
    return { ok: false, reason: 'checkpoint 의 completedAt 이 startedAt 보다 이르다(손상) — 통과시키지 않는다' }
  }
  if (started < input.deployedAt) {
    return { ok: false, reason: '마지막 done 회차가 runtime 전환 **이전**에 시작했다 — 지금 코드의 증거가 아니다' }
  }
  const now = input.now
  if (now !== undefined && ended > now) {
    return { ok: false, reason: 'checkpoint 시각이 미래다 — 통과시키지 않는다' }
  }

  // ── 🔴 예약 슬롯의 회차인가 ──
  if (input.slots !== undefined && input.slots.length > 0) {
    const tolerance = input.slotToleranceMs ?? 90 * 60_000
    const d = new Date(started)
    const hit = input.slots.some((sl) => {
      // 🔴 같은 날, **그리고 전날** 슬롯을 본다 — 00:30 회차는 전날 마지막 슬롯의 것일 수 있다
      for (const off of [-1, 0]) {
        const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate() + off, sl.hour, sl.minute, 0).getTime()
        if (started >= slot && started - slot <= tolerance) return true
      }
      return false
    })
    if (!hit) {
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      return {
        ok: false,
        reason: `그 회차(${hh}:${mm} 시작)는 예약 슬롯의 회차가 아니다 — 손으로 돌린 회차를 정기 회차 증거로 쓰지 않는다`,
      }
    }
  }

  return { ok: true, reason: `전환 이후 예약 회차가 done · runtime ${cpSha.slice(0, 7)}` }
}

// ─────────────────────────────────────────────────────────
// 🔴 격리 ≠ 최신 (promotion freshness)
// ─────────────────────────────────────────────────────────

export type FreshnessVerdict = {
  /** 승격해도 되는 최신 상태인가 */
  fresh: boolean
  /** origin/main 보다 몇 커밋 뒤인가 — 모르면 null */
  lag: number | null
  detail: string
}

/**
 * 🔴 **뒤처진 것과 격리가 깨진 것은 다르다.**
 *
 *    runtime 이 `origin/main` 보다 뒤에 있어도 격리는 성립한다(고정돼 있으니까).
 *    다만 **Wave C 승격**은 지금 main 이 배포된 뒤에만 허용한다 —
 *    올리는 순간의 코드가 무엇인지 모르는 채로 공개 발행량을 늘리지 않는다.
 */
export function judgePromotionFreshness(input: {
  runtimeSha: string | null
  originMainSha: string | null
  /** runtime..origin/main 커밋 수 */
  lag: number | null
}): FreshnessVerdict {
  if (input.runtimeSha === null || input.originMainSha === null) {
    return { fresh: false, lag: input.lag, detail: 'runtime 또는 origin/main SHA 를 읽지 못했다(fail-closed)' }
  }
  if (input.runtimeSha === input.originMainSha) {
    return { fresh: true, lag: 0, detail: 'runtime 이 지금 origin/main 과 같다' }
  }
  return {
    fresh: false,
    lag: input.lag,
    detail: `runtime 이 origin/main 보다 ${input.lag ?? '?'}커밋 뒤다 — 격리는 성립하지만 승격 전에 배포해야 한다`,
  }
}

/**
 * 🔴 **슬롯 증거를 건강도로 읽는다** (2026-09-10).
 *
 *    앞선 판은 `succeeded/expected` 숫자만 냈다. 그래서 "0/4" 가
 *    **아직 안 지나갔다**(정상)인지 **지나갔는데 다 실패했다**(고장)인지 구별되지 않았다.
 *
 *    실제로 그 구별이 필요했다 — Wave B 다회 수집은 등록 이후 8회 연속 실패했는데
 *    관제는 "슬롯 미달" 한 줄로만 말했고, 그 사이 "수집 능력 80건/day" 를 유지했다.
 *
 * 🔴 **판정을 다시 만들지 않는다.** `judgeSlotEvidence` 결과를 읽어 이름만 붙인다.
 */
export type SlotHealth =
  /** 전환 이후 지나간 슬롯이 없다 — 실패가 아니라 아직 볼 것이 없다 */
  | 'OBSERVATION_PENDING'
  /** 지나간 슬롯을 전부 성공했고 기대 수를 채웠다 */
  | 'OK'
  /** 지나간 만큼은 다 성공했지만 아직 기대 수에 못 미친다 */
  | 'ACCUMULATING'
  /** 일부 성공 일부 실패 */
  | 'DEGRADED'
  /** 지나간 슬롯이 있는데 성공이 0 이다 */
  | 'BROKEN'

export function judgeSlotHealth(v: SlotVerdict): { health: SlotHealth; reason: string } {
  if (v.elapsed === 0) {
    return {
      health: 'OBSERVATION_PENDING',
      reason: '전환 이후 지나간 슬롯이 없다 — 아직 판정할 증거가 없다(실패가 아니다)',
    }
  }
  if (v.succeeded === 0) {
    return {
      health: 'BROKEN',
      reason: `지나간 슬롯 ${v.elapsed}개가 **전부 실패**했다 — 등록돼 있어도 수집되지 않는다`,
    }
  }
  if (v.succeeded < v.elapsed) {
    return {
      health: 'DEGRADED',
      reason: `지나간 슬롯 ${v.elapsed}개 중 ${v.succeeded}개만 성공했다`,
    }
  }
  if (v.succeeded < v.expected) {
    return {
      health: 'ACCUMULATING',
      reason: `지나간 ${v.elapsed}개는 전부 성공했다 — ${v.expected}개까지 더 지나야 증명이 끝난다`,
    }
  }
  return { health: 'OK', reason: `최근 ${v.expected}개 슬롯 전부 성공` }
}

/**
 * 🔴 **등록은 능력이 아니다.**
 *
 *    `loaded` 슬롯 수 × 회차당 상세는 **configured**(설정된 능력)일 뿐이다.
 *    실제로 몇 건이 들어왔는지는 **성공한 회차**로만 알 수 있다.
 *    둘을 한 숫자로 내면 "job 을 올렸으니 40건/day" 가 되고, 그것이 이번 사고다.
 *
 * @param configuredPerDay 슬롯 수 × 회차당 상세 (기존 `currentCapacity`)
 * @param slot 그 source 의 슬롯 증거
 */
export function judgeObservedCapacity(input: {
  configuredPerDay: number
  slot: SlotVerdict
}): {
  configuredPerDay: number
  /** 🔴 지나간 슬롯 중 성공한 비율로 환산한 값. 증거가 없으면 `null` */
  observedPerDay: number | null
  health: SlotHealth
  reason: string
} {
  const h = judgeSlotHealth(input.slot)
  if (input.slot.elapsed === 0) {
    // 🔴 모르는 것을 configured 로 채우지 않는다
    return {
      configuredPerDay: input.configuredPerDay,
      observedPerDay: null,
      health: h.health,
      reason: `설정 ${input.configuredPerDay}건/day · 관측 아직 없음 — ${h.reason}`,
    }
  }
  const rate = input.slot.succeeded / input.slot.elapsed
  const observed = Math.round(input.configuredPerDay * rate * 10) / 10
  return {
    configuredPerDay: input.configuredPerDay,
    observedPerDay: observed,
    health: h.health,
    reason: `설정 ${input.configuredPerDay}건/day · 관측 ${observed}건/day`
      + ` (지나간 ${input.slot.elapsed}개 중 ${input.slot.succeeded}개 성공) — ${h.reason}`,
  }
}
