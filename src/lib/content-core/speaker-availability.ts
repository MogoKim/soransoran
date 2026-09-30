/**
 * 화자 여력 계획 — 🔴 **생성 전에** 누가 쓸 수 있는지 정한다 (2026-09-22)
 *
 * 🔴 **무엇이 문제였나.**
 *
 *    생성 계획(`speakerPlan`)은 말투 근거·나이대가 선 화자 **전원**을 후보로 받아
 *    원천마다 독립적으로 한 명을 골랐다. 그래서 한 회차가
 *    **같은 화자에게 여러 편**을 몰아줄 수 있었다 — 실측(2026-09-21 회차):
 *    새 후보 2건이 **둘 다 P01** 이었다.
 *
 *    발행 쪽은 한 화자가 이틀 안에 두 번 쓰지 못한다(`minDaysBetween`).
 *    그래서 9/23 예측이 `CAPACITY_WAIT` 로 2/3 에 멈췄다 — 그날 쓸 수 있는
 *    화자가 20명이나 있었는데도. **글이 모자란 게 아니라 화자가 겹쳤다.**
 *
 *    러너 주석이 남긴 앞판 기록: "이미 쓴 화자 수" 를 다음 요청에 실었더니
 *    **계약에 담기지 않아** 같은 계약인데 실제 요청이 달랐다. 그래서 제거됐고
 *    지금은 보고용 집계로만 남아 있다. 🔴 그 교훈을 지킨다 —
 *    이 계획은 **결정을 바꾸는 값이므로 계약에 실린다**(`identity`).
 *
 * 🔴 **하지 않는 것.**
 *    · 자격 없는 화자를 끼워 넣지 않는다 — 좁히기만 한다
 *    · 발행 때 다른 이름을 붙이지 않는다 (이 파일은 발행을 모른다)
 *    · 콘텐츠 규칙을 느슨하게 하지 않는다 — 생활사 판정은 그대로 뒤에서 돈다
 *    · 배정할 화자가 없으면 **그 원천을 보류**한다. 억지로 주지 않는다
 */

/** 화자 하나의 여력 근거 — 🔴 전부 실측값이다 */
export type SpeakerCapacity = {
  code: string
  /** 지평 안에서 이 화자가 배정 가능한 날 수 */
  openDays: number
  /** 이미 READY 재고에 있는 이 화자의 글 수 */
  readyCount: number
}

export type SpeakerSlot = {
  /** 원천 식별자 — 정렬된 입력 순서 그대로 */
  sourceKey: string
  /** 이 원천이 고를 수 있는 화자. 🔴 회차 안에서 서로 겹치지 않는다 */
  codes: readonly string[]
}

export type AvailabilityPlan = {
  slots: readonly SpeakerSlot[]
  /** 여력이 남은 화자 — 배분 전 */
  eligible: readonly string[]
  /** 🔴 계약에 실을 한 줄. 이 값이 바뀌면 캐시가 저절로 miss 된다 */
  identity: string
  /** 사람이 읽는 근거 */
  notes: readonly string[]
}

/**
 * 🔴 **남은 여력** = 지평 안에서 쓸 수 있는 날 수 − 이미 가진 READY 수.
 *    음수가 되지 않게 0 에서 멈춘다. 🔴 0 이면 이 회차에서 그 화자는 빠진다 —
 *    이미 그만큼 재고를 들고 있어서 더 만들어도 같은 날 못 나간다.
 */
export function remainingCapacity(c: SpeakerCapacity): number {
  return Math.max(0, c.openDays - c.readyCount)
}

/**
 * 🔴 **원천마다 서로 겹치지 않는 화자 묶음을 준다.**
 *
 *    나누는 방법은 stride 분배다 — 여력이 많은 사람부터 줄을 세우고
 *    `eligible[i], eligible[i+N], eligible[i+2N] …` 을 i 번째 원천에 준다.
 *    🔴 겹치지 않으므로 한 회차가 같은 화자에게 두 편을 몰아줄 수 없다.
 *    🔴 각 원천은 여전히 **자기 묶음 안에서** 생활사 자격으로 고른다 —
 *       이 함수가 누구를 쓸지 정하지 않는다.
 *
 *    묶음이 비면 그 원천은 보류다(`codes: []`). 억지로 주지 않는다.
 */
export function planSpeakerAvailability(input: {
  /** 🔴 이 회차가 처리할 원천 — 호출부가 정렬해 넘긴다 */
  sourceKeys: readonly string[]
  /** 화자별 여력 근거 */
  capacities: readonly SpeakerCapacity[]
}): AvailabilityPlan {
  const notes: string[] = []
  const withRemaining = input.capacities
    .map((c) => ({ code: c.code, remaining: remainingCapacity(c), openDays: c.openDays, readyCount: c.readyCount }))
  const eligible = withRemaining
    .filter((c) => c.remaining > 0)
    // 🔴 여력이 많은 사람부터. 같으면 코드 순 — 같은 입력이면 같은 결과다
    .sort((a, b) => (b.remaining - a.remaining) || a.code.localeCompare(b.code))
    .map((c) => c.code)

  const dropped = withRemaining.filter((c) => c.remaining === 0)
  if (dropped.length > 0) {
    notes.push(`여력 0 으로 제외 ${dropped.length}명: `
      + dropped.map((c) => `${c.code}(열린날 ${c.openDays}·재고 ${c.readyCount})`).join(' · '))
  }

  const n = input.sourceKeys.length
  /**
   * 🔴 **여력은 사람 수가 아니라 사람-날 수다** (2026-09-22 보정).
   *
   *    처음에는 화자 한 명을 원천 하나에만 줬다. 그러면 원천이 화자보다 많을 때
   *    나머지가 통째로 보류된다 — 공급이 멎는다(실측: 여러 fixture 가 그렇게 굶었다).
   *    🔴 여력이 3일인 사람은 **다른 날에** 세 편까지 쓸 수 있다. 그 수만큼 펴 놓고 나눈다.
   *    🔴 여력이 1일이면 여전히 한 원천에만 간다 — 같은 날 두 편이 되지 않는다.
   */
  const byCode = new Map(withRemaining.map((c) => [c.code, c.remaining]))
  /**
   * 🔴 **가능한 한 편다. 겹치는 것은 사람이 모자랄 때뿐이다.**
   *    사람이 넉넉하면 한 사람이 한 원천만 맡는다 — 여력이 7일이라고 해서
   *    한 회차의 다섯 편을 혼자 가져가면 그것이 바로 고치려던 상태다.
   *    🔴 몫은 `ceil(원천 수 / 여력 있는 사람 수)` 이고, 그 사람의 여력을 넘지 않는다.
   */
  const share = eligible.length === 0 ? 0 : Math.ceil(n / eligible.length)
  const pool: string[] = []
  for (const code of eligible) {
    const take = Math.min(byCode.get(code) ?? 0, Math.max(1, share))
    for (let k = 0; k < take; k += 1) pool.push(code)
  }
  const slots: SpeakerSlot[] = input.sourceKeys.map((sourceKey, i) => {
    const codes = n === 0 ? [] : [...new Set(pool.filter((_, j) => j % n === i))]
    return { sourceKey, codes }
  })
  const empty = slots.filter((s) => s.codes.length === 0)
  if (empty.length > 0) {
    notes.push(`🔴 배정할 화자가 없어 보류 ${empty.length}건: ${empty.map((s) => s.sourceKey).join(' · ')}`)
  }
  if (eligible.length > 0 && n > 0 && eligible.length < n) {
    notes.push(`🔴 여력 있는 화자 ${eligible.length}명 < 원천 ${n}건 — 일부 원천은 이 회차에 만들지 않는다`)
  }

  /**
   * 🔴 **결정을 바꾸는 값만 담는다.** 원천 순서와 각 원천의 후보 묶음이다 —
   *    재고나 이력이 바뀌어 묶음이 달라지면 캐시가 miss 되고 다시 계획한다.
   */
  const identity = slots.map((s) => `${s.sourceKey}:${s.codes.join(',')}`).join('|')
  return { slots, eligible, identity, notes }
}

/**
 * 🔴 **지평의 하루하루를 실제로 채워 본다** (2026-09-22 보정)
 *
 * 🔴 **무엇이 틀렸나.** 앞판은 날마다
 *    `availablePersonasAt(...).slice(0, dailyTarget)` 을 썼다.
 *    그 목록은 **코드순으로 정렬**돼 있어서, d1(하루 1편) 7일이면
 *    **P01 이 7일을 다 가져가고** 나머지는 0 이었다 — 주간 상한도 최소 간격도
 *    그 사람에게 실제로는 걸리는데, 자리를 세는 쪽이 그것을 몰랐다.
 *
 * 🔴 **고친 방법.** 그날 자리를 고를 때마다 **그 사람의 이력에 그날을 더한다.**
 *    그러면 다음 날 `availablePersonasAt` 이 최소 간격·주간 상한으로 그 사람을 뺀다 —
 *    자리가 저절로 퍼진다. 🔴 **이미 예정된 배정도 같은 이력에 들어 있다.**
 *
 * 🔴 고르는 순서는 **덜 쓴 사람 먼저**다. 같으면 코드순 — 같은 입력이면 같은 결과다.
 */
export type OpenDayPlan = {
  /** 화자별 열린 날 수 */
  openDays: ReadonlyMap<string, number>
  /** 날짜별로 누가 어느 자리를 받았는가 — 사람이 읽고 검사가 단정한다 */
  byDate: readonly { date: string; codes: readonly string[] }[]
}

export function planOpenDays(input: {
  /** 지평의 각 날 (KST 기준 시각) */
  days: readonly Date[]
  /** 그날의 하루 상한과 cap — 날짜마다 다를 수 있다(canary) */
  profileOf: (at: Date) => { dailyTarget: number; postsPerWeek: number; minDaysBetween: number }
  /** 🔴 이미 예정·완료된 배정을 담은 이력 — 여기에 계획을 쌓아 간다 */
  history: readonly { code: string; matchedAts: readonly Date[] }[]
  /** 🔴 발행 정본이 판정한다 — 여기서 규칙을 다시 적지 않는다 */
  availableAt: (
    hist: readonly { code: string; matchedAts: readonly Date[] }[],
    at: Date,
    caps: { postsPerWeek: number; minDaysBetween: number },
  ) => string[]
  /** KST 날짜 문자열 */
  dateLabel: (at: Date) => string
  /**
   * 🔴 **그날 자리를 받을 수 있는 화자인가 — 주입한다** (PR2 KEEP · 2026-09-30).
   *    말투 근거(reference)가 없는 화자는 기계 초안을 받을 수 없다. 그런데 "덜 쓴 사람 먼저" 규칙이
   *    그들을 **먼저** 집어 하루 자리를 차지했다(진단 B: capacity d10 70칸 중 17칸 · P20~P25).
   *    🔴 주지 않으면 앞판과 같다(전원). 누가 말투를 가졌는지는 여기서 판정하지 않는다 — 부르는 쪽이 넘긴다.
   */
  canTakeSlot?: (code: string) => boolean
}): OpenDayPlan {
  const canTake = input.canTakeSlot ?? ((): boolean => true)
  // 🔴 호출자의 배열을 바꾸지 않는다
  const hist = input.history.map((h) => ({ code: h.code, matchedAts: [...h.matchedAts] }))
  const openDays = new Map<string, number>()
  const byDate: { date: string; codes: string[] }[] = []

  for (const at of input.days) {
    const p = input.profileOf(at)
    const caps = { postsPerWeek: p.postsPerWeek, minDaysBetween: p.minDaysBetween }
    const picked: string[] = []
    for (let slot = 0; slot < p.dailyTarget; slot += 1) {
      const free = input.availableAt(hist, at, caps).filter((c) => !picked.includes(c) && canTake(c))
      if (free.length === 0) break
      /**
       * 🔴 **덜 쓴 사람 먼저.** 코드순으로 집으면 앞자리 사람이 지평을 독식한다 —
       *    그것이 정확히 이 보정이 고치는 결함이다.
       */
      const next = [...free].sort((a, b) =>
        ((openDays.get(a) ?? 0) - (openDays.get(b) ?? 0)) || a.localeCompare(b))[0]!
      picked.push(next)
      openDays.set(next, (openDays.get(next) ?? 0) + 1)
      // 🔴 **그날을 이력에 더한다** — 다음 날 판정이 이 사람을 빼도록
      const row = hist.find((h) => h.code === next)
      if (row !== undefined) row.matchedAts.push(at)
    }
    byDate.push({ date: input.dateLabel(at), codes: picked })
  }
  return { openDays, byDate }
}

// ─────────────────────────────────────────────────────────
// 🔴 WIP 칸 — 원천 가치가 사라진 행은 화자 칸을 막지 않는다 (PR2 KEEP · 2026-09-30)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **화자별 WIP 수 — 칸에서 뺄 행은 주입받는다.**
 *
 *    발행 분류는 사람 검토 대기(`humanReviewPending`) · 자동 READY 닫힘 행을 WIP 로 센다. 그러면 **원천 가치가
 *    이미 사라져 자동으로는 영영 못 나가는 초안**이 그 화자의 칸을 영구히 막는다(진단 B: 말투 있는 18명 중 11명 여력 0).
 *    🔴 이 함수는 가치를 판정하지 않는다 — "칸에서 뺄 행" 판정(`releasesSlot`)을 **입력으로 받을 뿐**이다.
 *       정기 경로는 정본 `judgeSlotRelease` 가 만료 사유를 낸 행을 넘긴다. 주지 않으면 앞판과 같다(전부 점유).
 *    🔴 화자를 모르는 행(`code: null`)은 누구의 칸도 막지 않는다 — 따로 센다.
 */
export function wipCountsBySpeaker(input: {
  wip: readonly { id: string; code: string | null }[]
  releasesSlot?: (id: string) => boolean
}): { byCode: ReadonlyMap<string, number>; released: readonly string[]; unattributed: number } {
  const byCode = new Map<string, number>()
  const released: string[] = []
  let unattributed = 0
  for (const w of input.wip) {
    if (input.releasesSlot?.(w.id) === true) { released.push(w.id); continue }
    if (w.code === null || w.code.trim() === '') { unattributed += 1; continue }
    byCode.set(w.code, (byCode.get(w.code) ?? 0) + 1)
  }
  return { byCode, released, unattributed }
}
