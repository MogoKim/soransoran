/**
 * Persona 24 → 300+ **확장 계약** — 🔴 순수 함수
 *
 * 🔴 **목표는 두 개다** (2026-09-29) — canary 하한(하루 시험) · 지속 다양성 목표(계속 운영).
 *    정본은 `d100-capacity` 의 `PERSONA_CANARY_FLOOR` · `PERSONA_SUSTAINED_TARGET` 이다.
 *
 * 🔴 **카드만 늘린다고 READY 가 되지 않는다.** 이 파일이 그것을 타입과 판정으로 막는다.
 *    한 사람이 서려면 생활사 14축 · 말투 근거 · 활동 여력 · 자격이 전부 있어야 한다.
 *
 * 🔴 **이번 PR 은 Persona 를 만들지 않는다.** 필요 인원과 준비 상태만 계산한다.
 */
import { LIFE_CONTRACT_FIELDS } from './content-core/speaker'
import {
  d100Plan, D100_PERSONA_TARGET_MAX, PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET, type D100Stage,
} from './d100-capacity'

/**
 * 🔴 **생활사 계약 축** — 생성 계약(`LIFE_CONTRACT_FIELDS`)에서 개인 `noGoExpressions` 하나만 뺀다 (2026-10-01 · C8).
 *    개인 말버릇은 **없어도 되는 칸**이다 — 정본 카드 25장 중 15장이 비어 있고, 전원 공통 금지(Pool §7-2)는
 *    `persona-no-go` 가 생성 · 검사에서 언제나 강제한다. 비었다고 막으면 같은 사람을 두 판정이 다르게 본다
 *    (`verifySeedCard` · 생성 프롬프트는 빈 목록을 정상으로 읽었다).
 *    🔴 생성 계약 지문(`lifeContractIdentity`)에는 그대로 남는다 — 값이 바뀌면 다른 사람이다.
 *    🔴 소재 경계(`noGoTopics`)는 그대로 필수다.
 */
export const PERSONA_LIFE_AXES: readonly (typeof LIFE_CONTRACT_FIELDS)[number][] =
  LIFE_CONTRACT_FIELDS.filter((k) => k !== 'noGoExpressions')

/** 🔴 말투 근거 최소치 — 이보다 적으면 그 사람의 말투라고 부를 수 없다 */
export const VOICE_MIN_COMMENTS = 3

/**
 * 🔴 **세 층을 가른다** (2026-09-21 2차 보정).
 *
 *    앞판은 `personaUsable` 하나가 전부를 판정했다. 그래서 "오늘 활동 상한을 다 쓴 사람"
 *    과 "생활사 카드가 비어 있는 사람" 이 같은 `usable=false` 로 뭉쳤다 — 앞은 **오늘만**
 *    못 쓰는 것이고 뒤는 **아직 만들어지지 않은 것**이다. 180명을 언제까지 채워야 하는지
 *    계획하려면 둘을 따로 세야 한다.
 *
 *    `card`        사람 자체가 완성됐는가 — 한 번 채우면 유지된다
 *    `pool`        지금 풀에 들어갈 수 있는가 — 말투 근거·퇴역·휴면
 *    `assignment`  **이번 회차에** 배정할 수 있는가 — 회차마다 달라진다
 */
/**
 * 🔴 **층 배치를 창업자 정본에 맞춘다** (2026-09-21 4차 보정).
 *
 *      카드     생활사 · 나이 · Voice · 퇴역 · 자격 충돌  — 사람 자체가 서는가
 *      Pool     (비어 있다 — 2026-10-01 C9: 역할 쏠림은 회차로 옮기고, 라벨 없는 소재 쏠림은 지웠다)
 *      회차 배정 활동 상한 · 연속 노출 · pair repeat · 역할 쏠림 — 이번 회차에 쓸 수 있는가
 *
 * 🔴 앞판은 말투 근거를 Pool 에 두었다. 그런데 말투가 없으면 **그 사람이 아직 안 만들어진 것**이지
 *    "풀 구성이 문제" 가 아니다 — 할 일이 다르다(자산을 모은다 / 사람을 바꾼다).
 * 🔴 `dormant` 는 카드에 둔다. 퇴역과 같이 **그 사람의 지금 상태**이고,
 *    회차가 바뀐다고 달라지지 않는다.
 */
export const CARD_BLOCK_CODES = [
  'lifeAxisMissing', 'noAgeBand', 'voiceEvidenceThin', 'retired', 'dormant', 'qualificationConflict',
] as const
/**
 * 🔴 **Pool 층은 지금 비어 있다** (2026-10-01 · C9). 역할 쏠림은 회차로 옮겼고, 소재 쏠림은 지웠다 —
 *    소재 라벨이 어느 표에도 없어 영원히 "모름" 인 축은 판정이 아니라 쓰일수록 막는 함정이었다.
 *    소재 다양성은 새 분류표 없이 **배정 근거**로 본다: 같은 Persona 의 주간 글 상한 · 최소 간격(`hardFilter`)과
 *    증명일 자동 글의 글쓴이가 서로 달라야 한다는 단계 증거(`stage-evidence` `PERSONA_REPEAT`, canon §6-3).
 */
export const POOL_BLOCK_CODES = [] as const
export const ASSIGNMENT_BLOCK_CODES = [
  'activityOverCap', 'consecutiveExposure', 'pairRepeat', 'roleConcentrated',
] as const

export const PERSONA_BLOCK_CODES = [
  ...CARD_BLOCK_CODES, ...POOL_BLOCK_CODES, ...ASSIGNMENT_BLOCK_CODES,
] as const
export type PersonaBlockCode = (typeof PERSONA_BLOCK_CODES)[number]

export const PERSONA_TIERS = ['card', 'pool', 'assignment'] as const
export type PersonaTier = (typeof PERSONA_TIERS)[number]

/** 🔴 코드마다 어느 층인지 하나로 정해 둔다 — 두 곳에서 다르게 세지 않게 */
export const PERSONA_BLOCK_TIER: Readonly<Record<PersonaBlockCode, PersonaTier>> = {
  lifeAxisMissing: 'card', noAgeBand: 'card', voiceEvidenceThin: 'card',
  retired: 'card', dormant: 'card', qualificationConflict: 'card',
  activityOverCap: 'assignment', consecutiveExposure: 'assignment', pairRepeat: 'assignment', roleConcentrated: 'assignment',
}

export const PERSONA_BLOCK_LABEL: Readonly<Record<PersonaBlockCode, string>> = {
  lifeAxisMissing: '생활사 축이 비었다',
  voiceEvidenceThin: '말투 근거가 모자라다',
  noAgeBand: '나이대가 없다 — 글쓴이가 몇 살인지 모른다',
  roleConcentrated: '한 역할에 쏠렸다',
  activityOverCap: '글·댓글 합산 활동 상한을 넘겼다',
  consecutiveExposure: '연속으로 노출됐다',
  pairRepeat: '같은 조합이 반복됐다',
  dormant: '휴면이다',
  retired: '퇴역했다',
  qualificationConflict: '자격이 충돌한다',
}

/** 🔴 한 사람이 하루에 쓸 수 있는 글·댓글 합 — 사람처럼 보이는 상한이다 */
export const ACTIVITY_CAP_PER_DAY = 6
/** 🔴 한 사람이 연속으로 노출될 수 있는 횟수 */
export const CONSECUTIVE_EXPOSURE_CAP = 1
/** 🔴 같은 두 사람이 한 글에 다시 붙기까지 비워야 할 글 수 */
export const PAIR_REPEAT_GAP = 5
/** 🔴 이 기간 활동이 없으면 휴면 */
export const DORMANT_AFTER_DAYS = 30
/**
 * 🔴 **역할 쏠림 상한** — 이 사람의 최근 댓글 중 가장 많은 역할 하나가 차지하는 비율. **회차 조건**이다(C9).
 *    절반을 넘으면 "무슨 얘기든 하는 사람" 이 아니라 "그 얘기만 하는 사람" 이고,
 *    그런 사람이 계속 나오면 커뮤니티가 아니라 봇 목록처럼 읽힌다.
 *
 * 🔴 앞판은 `topicConcentrated`·`roleConcentrated`·`pairRepeat` 세 코드를 **선언만 해 두고
 *    아무 데서도 내보내지 않았다.** 목록에 있으니 막고 있는 것처럼 보였지만 실제로는
 *    한 번도 걸린 적이 없다. 판정하거나 지우거나 둘 중 하나여야 한다 — 판정한다.
 */
export const ROLE_SHARE_CAP = 0.5

export type PersonaCandidate = {
  code: string
  /** 생활사 14축 중 값이 있는 축 */
  filledAxes: readonly string[]
  ageBand: string | null
  /** 말투 근거 댓글 수 */
  voiceComments: number
  /** 오늘 이미 한 글+댓글 */
  activityToday: number
  /**
   * 🔴 바로 앞 글에 연속으로 나왔는가. **재지 않았으면 `null`** —
   *    0 을 넣으면 "연속으로 나오지 않았다" 가 되고, 그 거짓이 배정을 열어 준다.
   */
  consecutiveExposures: number | null
  /** 마지막 활동 이후 지난 날 */
  daysSinceActive: number
  retired: boolean
  /**
   * 🔴 자격 충돌 — **재지 않았으면 `null`**. `false` 는 "확인했고 문제없다" 는 뜻이라
   *    확인한 적이 없는 것을 그렇게 적으면 감사 없이 통과시키는 것이 된다.
   */
  qualificationConflict: boolean | null
  /** 🔴 최근 댓글의 역할 쏠림 비율(0~1) — **회차 조건**. 재지 않았으면 `null` */
  roleShare: number | null
  /**
   * 🔴 같은 상대와 마지막으로 한 글에 붙은 뒤 지나간 글 수.
   *    `'never'` = 아직 누구와도 겹친 적이 없다(막지 않는다) · `null` = 재지 않았다
   */
  postsSinceLastPairing: number | 'never' | null
}

export type TierVerdict = {
  ok: boolean
  blocked: PersonaBlockCode[]
  /** 🔴 **재지 않아 판단할 수 없는 것.** `blocked` 와 다르다 — 모르는 것은 통과가 아니다 */
  unmeasured: PersonaBlockCode[]
}

export type PersonaTierVerdict = Readonly<Record<PersonaTier, TierVerdict>>

/**
 * 🔴 **층별로 판정한다.** 어느 층에서 막혔는지가 "무엇을 하면 되는가" 를 정한다 —
 *    card 면 사람을 채워야 하고, pool 이면 자산을 모아야 하고,
 *    assignment 면 **오늘만** 못 쓰는 것이라 아무것도 만들 필요가 없다.
 */
export function personaTiers(p: PersonaCandidate): PersonaTierVerdict {
  const card: TierVerdict = { ok: true, blocked: [], unmeasured: [] }
  const pool: TierVerdict = { ok: true, blocked: [], unmeasured: [] }
  const assign: TierVerdict = { ok: true, blocked: [], unmeasured: [] }

  // ── 카드 — 사람 자체가 서는가 ──
  if (PERSONA_LIFE_AXES.some((a) => !p.filledAxes.includes(a))) card.blocked.push('lifeAxisMissing')
  if (p.ageBand === null || p.ageBand.trim() === '') card.blocked.push('noAgeBand')
  if (p.voiceComments < VOICE_MIN_COMMENTS) card.blocked.push('voiceEvidenceThin')
  if (p.retired) card.blocked.push('retired')
  if (p.daysSinceActive >= DORMANT_AFTER_DAYS) card.blocked.push('dormant')
  // 🔴 모르면 통과가 아니다 — 감사 없이 "문제없다" 고 적지 않는다
  if (p.qualificationConflict === null) card.unmeasured.push('qualificationConflict')
  else if (p.qualificationConflict) card.blocked.push('qualificationConflict')

  // ── 회차 배정 — 이번 회차에 쓸 수 있는가 ──
  /**
   * 🔴 **역할 쏠림은 회차 조건이다 — 지속 자격(Pool)이 아니다** (2026-10-01 · C9).
   *    앞판은 Pool 층에 두었다. 그러면 최근 창의 비율이 문턱을 넘는 순간 계약 유효에서 빠졌다 —
   *    많이 쓰인 사람일수록 용량에서 사라졌다. 쏠림은 "이번에 이 역할을 더 주지 말라" 는 뜻이지
   *    "이 사람은 화자가 아니다" 가 아니다. 🔴 문턱(0.5)과 표본 하한은 그대로다 — 모르면 이번 회차에 배정하지 않는다.
   */
  if (p.roleShare === null) assign.unmeasured.push('roleConcentrated')
  else if (p.roleShare > ROLE_SHARE_CAP) assign.blocked.push('roleConcentrated')
  if (p.activityToday >= ACTIVITY_CAP_PER_DAY) assign.blocked.push('activityOverCap')
  // 🔴 모르면 통과가 아니다
  if (p.consecutiveExposures === null) assign.unmeasured.push('consecutiveExposure')
  else if (p.consecutiveExposures > CONSECUTIVE_EXPOSURE_CAP) assign.blocked.push('consecutiveExposure')
  if (p.postsSinceLastPairing === null) assign.unmeasured.push('pairRepeat')
  else if (p.postsSinceLastPairing !== 'never' && p.postsSinceLastPairing < PAIR_REPEAT_GAP) {
    assign.blocked.push('pairRepeat')
  }

  for (const t of [card, pool, assign]) t.ok = t.blocked.length === 0 && t.unmeasured.length === 0
  return { card, pool, assignment: assign }
}

/** 🔴 사람 자체가 완성됐는가 — 이 층만 통과하면 "카드가 있다" 이지 "쓸 수 있다" 가 아니다 */
export function personaCardComplete(p: PersonaCandidate): boolean {
  return personaTiers(p).card.ok
}

/** 🔴 지금 풀에 들어가는가 — 카드까지 통과해야 한다 */
export function personaInPool(p: PersonaCandidate): boolean {
  const t = personaTiers(p)
  return t.card.ok && t.pool.ok
}

/** 🔴 **이번 회차에** 배정할 수 있는가 — 재지 않은 축이 있으면 배정하지 않는다 */
export function personaAssignableNow(p: PersonaCandidate): boolean {
  const t = personaTiers(p)
  return t.card.ok && t.pool.ok && t.assignment.ok
}

/** 🔴 이 사람을 막는 이유 전부 — 층 구분 없이 한 줄로 본다 */
export function personaBlockers(p: PersonaCandidate): PersonaBlockCode[] {
  const t = personaTiers(p)
  return [...t.card.blocked, ...t.pool.blocked, ...t.assignment.blocked]
}

/** 🔴 재지 않아 판단할 수 없는 축 — **통과가 아니다** */
export function personaUnmeasured(p: PersonaCandidate): PersonaBlockCode[] {
  const t = personaTiers(p)
  return [...t.card.unmeasured, ...t.pool.unmeasured, ...t.assignment.unmeasured]
}

/** 🔴 지금 이 회차에 실제로 쓸 수 있는가 */
export function personaUsable(p: PersonaCandidate): boolean {
  return personaAssignableNow(p)
}

export type PersonaScaleNeed = {
  stage: D100Stage
  /** 🔴 **canary 하한** — 하루 시험을 켤 수 있는 최소 인원 (`PERSONA_CANARY_FLOOR`) */
  canaryFloor: number
  /** 🔴 canary 하한의 범위 상한 — D100 만 180~200 범위다 */
  canaryFloorMax: number
  /** 🔴 **지속 다양성 목표** (`PERSONA_SUSTAINED_TARGET`) — D100 은 하한 300 이다 */
  sustainedTarget: number
  /** 전체 카드 수 */
  cards: number
  /** 🔴 사람 자체가 완성된 수 — 카드만 있는 것과 다르다 */
  cardComplete: number
  /** 🔴 지금 풀에 드는 수 — **이 값이 확장 계획의 기준이다** */
  poolReady: number
  /** 🔴 이번 회차에 배정 가능한 수 — 하루마다 달라진다. 확장 목표와 견주지 않는다 */
  assignableNow: number
  /** 🔴 카드는 있는데 풀에 못 드는 사람 */
  cardsOnly: number
  /** 🔴 배정 축을 재지 않아 판단할 수 없는 사람 수 */
  assignmentUnmeasured: number
  /** 🔴 canary 하한 대비 부족분 — **`poolReady` 기준**이다 */
  canaryShortfall: number
  /** 🔴 하루 시험을 켤 인원인가 */
  canaryReady: boolean
  /** 🔴 지속 목표 대비 부족분 — **`poolReady` 기준**이다 */
  sustainedShortfall: number
  /** 🔴 계속 돌릴 인원인가 — 🔴 canary 하한을 채웠다고 참이 되지 않는다 */
  sustainedReady: boolean
  /** 층별로 몇 명이 무엇에 막혔는가 */
  blockedBy: Readonly<Record<PersonaBlockCode, number>>
}

/**
 * 🔴 **층마다 따로 답한다** — ready / blocking / unmeasured.
 *    한 층이라도 `ready` 가 아니면 Persona 준비도는 아니다.
 */
export type TierReadiness = {
  tier: PersonaTier
  ready: boolean
  /** 그 층을 통과한 사람 수 — 🔴 재지 못한 축이 있으면 그 사람은 통과가 아니다 */
  passed: number
  /**
   * 🔴 **재지 못한 축을 빼고 세면 몇 명인가** (2026-09-21 6차 보정).
   *
   *    "0명" 이 두 가지 뜻으로 읽힌다: **실제로 쓸 사람이 없다**와
   *    **감사 항목을 재지 않아 완전 인증이 0명이다**. 할 일이 정반대다 —
   *    앞은 사람을 만들어야 하고, 뒤는 재는 방법을 만들어야 한다.
   */
  passedIgnoringUnmeasured: number
  /** 대상 인원 */
  total: number
  /**
   * 🔴 목표 인원 — **canary 하한**이다 (카드 층에만 뜻이 있다).
   *    이 층의 `ready` 는 이 값으로 잰다 — 하루 시험을 켤 수 있는가.
   */
  target: number | null
  /**
   * 🔴 **지속 다양성 목표** (카드 층에만 뜻이 있다). `ready` 에 넣지 않는다 —
   *    보고만 한다. canary 하한을 채운 카드 층이 지속 준비라고 읽히지 않게 따로 든다.
   */
  sustainedTarget: number | null
  /** 🔴 카드 층 통과 인원이 지속 목표를 채웠는가 — 카드 층 밖에서는 `null` */
  sustainedMet: boolean | null
  /** 코드별 막힌 사람 수 */
  blocking: Readonly<Record<string, number>>
  /** 🔴 재지 못해 판단할 수 없는 코드별 사람 수 */
  unmeasured: Readonly<Record<string, number>>
  reason: string | null
}

/** 🔴 층별 판정 — 계기판이 이 값을 그대로 찍는다 */
export function personaTierReadiness(input: {
  stage: D100Stage
  candidates: readonly PersonaCandidate[]
}): TierReadiness[] {
  // 🔴 카드 층의 `ready` 는 **canary 하한**으로 잰다. 지속 목표는 따로 보고만 한다
  const target = PERSONA_CANARY_FLOOR[input.stage]
  const sustained = PERSONA_SUSTAINED_TARGET[input.stage]
  const total = input.candidates.length
  const out: TierReadiness[] = []

  for (const tier of PERSONA_TIERS) {
    const blocking: Record<string, number> = {}
    const unmeasured: Record<string, number> = {}
    let passed = 0
    let passedIgnoringUnmeasured = 0
    for (const p of input.candidates) {
      const v = personaTiers(p)[tier]
      for (const c of v.blocked) blocking[c] = (blocking[c] ?? 0) + 1
      for (const c of v.unmeasured) unmeasured[c] = (unmeasured[c] ?? 0) + 1
      if (v.ok) passed += 1
      // 🔴 **막힌 것**만 본다 — 재지 못한 축은 없는 셈 치고 센 수다
      if (v.blocked.length === 0) passedIgnoringUnmeasured += 1
    }
    /**
     * 🔴 카드·풀 층은 **목표 인원**을 채워야 한다. 배정 층은 회차마다 달라지므로
     *    목표와 견주지 않고 "전원이 판정 가능한가" 만 본다 —
     *    재지 못한 축이 하나라도 있으면 그 층은 ready 가 아니다.
     */
    const hasUnmeasured = Object.keys(unmeasured).length > 0
    /**
     * 🔴 카드 층만 **목표 인원**을 요구한다 — 몇 명을 만들어야 하는가가 그 층의 질문이다.
     *    Pool·배정 층은 있는 사람 전원이 판정 가능하고 통과해야 한다 (인원 목표가 아니다).
     */
    const ready = tier === 'card'
      ? !hasUnmeasured && passed >= target
      : !hasUnmeasured && passed === total && total > 0
    const reason = ready ? null
      : hasUnmeasured
        ? `재지 못한 축이 있다 (${Object.keys(unmeasured).join('·')})`
          + ` — 🔴 그 축을 빼고 세면 ${passedIgnoringUnmeasured}명이다`
        : tier === 'card' ? `${passed}명 < canary 하한 ${target}명`
          : `${total - passed}명이 이 층을 통과하지 못한다`
    out.push({
      tier, ready, passed, passedIgnoringUnmeasured, total,
      target: tier === 'card' ? target : null,
      sustainedTarget: tier === 'card' ? sustained : null,
      sustainedMet: tier === 'card' ? !hasUnmeasured && passed >= sustained : null,
      blocking, unmeasured, reason,
    })
  }
  return out
}

/** 🔴 **한 층이라도 아니면 Persona 준비도는 아니다** */
export function personaReadinessOk(tiers: readonly TierReadiness[]): boolean {
  return tiers.length === PERSONA_TIERS.length && tiers.every((t) => t.ready)
}

/**
 * 🔴 **카드 수가 아니라 풀에 드는 사람 수로 센다.**
 *    카드만 180장 만들어도 `poolReady` 가 모자라면 READY 가 아니다.
 *
 * 🔴 **확장 목표는 `assignableNow` 로 재지 않는다.** 그 값은 오늘 활동 상한·연속 노출
 *    때문에 매일 출렁인다 — 그것으로 "180명 됐다/안 됐다" 를 말하면 하루 단위로 답이 바뀐다.
 */
export function judgePersonaScale(input: {
  stage: D100Stage
  candidates: readonly PersonaCandidate[]
}): PersonaScaleNeed {
  const plan = d100Plan(input.stage)
  const cardComplete = input.candidates.filter(personaCardComplete).length
  const poolReady = input.candidates.filter(personaInPool).length
  const assignableNow = input.candidates.filter(personaAssignableNow).length

  const blockedBy = Object.fromEntries(
    PERSONA_BLOCK_CODES.map((c) => [c, 0]),
  ) as Record<PersonaBlockCode, number>
  let assignmentUnmeasured = 0
  for (const p of input.candidates) {
    for (const c of personaBlockers(p)) blockedBy[c] += 1
    if (personaTiers(p).assignment.unmeasured.length > 0) assignmentUnmeasured += 1
  }

  return {
    stage: input.stage,
    canaryFloor: plan.personaCanaryFloor,
    canaryFloorMax: input.stage === 'd100' ? D100_PERSONA_TARGET_MAX : plan.personaCanaryFloor,
    sustainedTarget: plan.personaSustainedTarget,
    cards: input.candidates.length,
    cardComplete, poolReady, assignableNow,
    cardsOnly: input.candidates.length - poolReady,
    assignmentUnmeasured,
    canaryShortfall: Math.max(0, plan.personaCanaryFloor - poolReady),
    canaryReady: poolReady >= plan.personaCanaryFloor,
    sustainedShortfall: Math.max(0, plan.personaSustainedTarget - poolReady),
    sustainedReady: poolReady >= plan.personaSustainedTarget,
    blockedBy,
  }
}
