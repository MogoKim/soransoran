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
  const slots: SpeakerSlot[] = input.sourceKeys.map((sourceKey, i) => {
    const codes = n === 0 ? [] : eligible.filter((_, j) => j % n === i)
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
