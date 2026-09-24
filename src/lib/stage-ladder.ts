/**
 * 🔴 **단계 결정은 정본이 이미 갖고 있다 — 새 규율을 만들지 않는다** (2026-09-24 재작성)
 *
 *   앞판(088b134)은 `STAGE_REQUIREMENTS`(재고 1/6/15/40 · 화자 1/3/5/8 · 연속 0/2/3/5일)와
 *   전역 감속(하드 차단 1건이면 전체 감속 · 검토 적체면 전체 감속)을 **새로 만들었다.**
 *   승인되지 않은 규율이었고, 검사 42건은 *그 새 규칙이 자기 자신과 맞는다*는 것만 증명했다.
 *
 * 🔴 **정본 경로를 그대로 쓴다.**
 *   ```
 *   simulateStage → judgeReadiness → stageVerdicts   (실제 배정 시뮬레이션)
 *        └ forecastPublishing 안에서 TTL · 주 cap · 최소 간격 · 생활사 · Persona 배정
 *   safeStageFor(requested, verdicts)                (감속 — 기존 계약)
 *   ```
 *   이 파일이 더하는 것은 **`requested` 를 사람 env 가 아니라 판정에서 고르는 것** 하나다.
 *
 * 🔴 **공급 가용성과 발행 배정 가능성을 합치지 않는다** (2026-09-24 실측).
 *   같은 날 공급 생성 가능 화자는 **1명**(P14)이었는데 발행은 **P10·P06·P02** 가 가능했고
 *   P10 은 실제로 15:49 에 나갔다. 공급 여력은 `max(0, openDays − readyCount)` 로
 *   *앞으로 7일 안에 더 만들 수 있는가* 를 묻고, 발행은 *지금 재고에서 낼 수 있는가* 를 묻는다.
 *   🔴 공급 부족은 **단계를 내리는 근거가 아니다** — 재고가 줄면 정본 판정이 알아서 내린다.
 */
import {
  PROFILES, RELEASE_STAGES, SAFEST_STAGE, safeStageFor, stageRank,
  type ReleaseStage, type StageVerdict,
} from './scale-profile'

/** 🔴 이 결정이 어느 계약으로 내려졌나 — 저장된 결정을 뒤에 읽을 때 필요하다 */
export const STAGE_DECISION_VERSION = 'stage-decision-v1'

/**
 * 🔴 **공급 쪽 신호.** 단계를 바꾸지 않는다 — 사람이 병목을 보라고 싣는다.
 *    `planSpeakerAvailability` 가 내는 값을 그대로 옮긴다.
 */
export type SupplySignal = {
  /** 이 회차에 **새로 만들 수 있는** 화자 수 */
  eligibleSpeakers: number
  /** 제외된 화자를 사유별로 — 값이다. 문구를 파싱하지 않는다 */
  excluded: { reason: 'noOpenDay' | 'holdingStock'; codes: string[] }[]
}

export type StageInputs = {
  /** 판정 기준 KST 날짜 */
  kstDate: string
  /** 지금 지속 단계 */
  currentStage: ReleaseStage
  /**
   * 🔴 **정본 `stageVerdicts` 결과 그대로.** 이 파일은 재고도 화자도 직접 세지 않는다 —
   *    세면 정본과 두 벌이 되고, 한쪽이 낡는다.
   */
  verdicts: readonly StageVerdict[]
  /** 그날 이미 낸 편수 */
  publishedToday: number
  /** 🔴 보고용 신호. 결정에 쓰지 않는다 */
  supply?: SupplySignal
  /** 결정 시각 (ISO) */
  decidedAt: string
}

export const STAGE_DIRECTIONS = ['up', 'hold', 'down'] as const
export type StageDirection = (typeof STAGE_DIRECTIONS)[number]

/**
 * 🔴 **공급과 발행이 함께 소비하는 하나의 결정.**
 *    날짜·단계·근거·시각·계약 판을 담는다 — 이 값 하나만 보면 그날 무엇으로 돌았는지 안다.
 */
export type StageDecision = {
  kstDate: string
  /** 내부 생산 눈금 */
  capacity: ReleaseStage
  /** 공개 눈금 — 현재 계약상 capacity 를 넘지 못한다 */
  release: ReleaseStage
  direction: StageDirection
  /** 판정 근거 — 정본이 낸 문구를 그대로 옮긴다 */
  reasons: string[]
  /** 그날 이미 낸 편수 때문에 내리지 못했는가 */
  dayPinned: boolean
  /** 🔴 결정에 쓰이지 않은 참고 신호 */
  supply: SupplySignal | null
  decidedAt: string
  contractVersion: typeof STAGE_DECISION_VERSION
}

const next = (s: ReleaseStage): ReleaseStage | null => {
  const i = RELEASE_STAGES.indexOf(s)
  return i < 0 || i + 1 >= RELEASE_STAGES.length ? null : RELEASE_STAGES[i + 1]!
}

/**
 * 🔴 **다음 단계를 정한다 — 정본 판정만 본다.**
 *
 *    ① 한 칸 위가 `ready` 면 그것을 `requested` 로 삼는다. 아니면 지금 단계다.
 *       🔴 한 칸씩만 올리는 이유: 올린 단계를 하루 버티는 것을 보고 다음 칸으로 간다.
 *          정본 `safeStageFor` 는 **감속**만 하므로, 승격 폭은 부르는 쪽이 정한다.
 *    ② `safeStageFor` 에 맡긴다 — 감속 규칙은 기존 계약 그대로다.
 *    ③ 그날 이미 낸 편수가 내리려는 단계 상한을 넘으면 **그날 단계를 고정**한다.
 *       (기존 `resolveScale` 과 같은 계약 — 내리면 이미 낸 글이 상한 초과가 된다)
 *
 * 🔴 **하드 차단·검토 적체로 전체 단계를 내리지 않는다.** 후보 하나의 결함을
 *    생산 전체 중단으로 키우지 않는다 — 그것은 기존 kill switch 와 정산 fail-closed 의 일이다.
 */
export function planStageDecision(input: StageInputs): StageDecision {
  const base = {
    kstDate: input.kstDate,
    supply: input.supply ?? null,
    decidedAt: input.decidedAt,
    contractVersion: STAGE_DECISION_VERSION,
  } as const

  /**
   * 🔴 **판정이 비었을 때를 여기서 다시 처리하지 않는다** (2026-09-24 변이 시험에서 확인).
   *    정본 `safeStageFor` 가 `unknown: true` 로 `requested` 를 그대로 돌려준다 —
   *    같은 일을 두 번 적으면 한쪽이 낡고, 어느 쪽이 결정했는지 알 수 없게 된다.
   *    아래 `safe.unknown` 가 그 사실을 근거로 남긴다.
   */
  const up = next(input.currentStage)
  const byStage = new Map(input.verdicts.map((v) => [v.stage, v]))
  const upReady = up !== null && byStage.get(up)?.ready === true
  const requested = upReady ? up! : input.currentStage

  const safe = safeStageFor(requested, input.verdicts)
  const reasons: string[] = []
  if (upReady) reasons.push(`🟢 ${up} 가 정본 판정에서 ready 다 — 한 칸 올려 본다`)
  if (safe.reason !== null) reasons.push(safe.reason)
  if (safe.unknown) reasons.push('🔴 판정을 받지 못했다 — `chosenReady` 를 신뢰하지 않는다')

  let stage = safe.stage
  let dayPinned = false
  /**
   * 🔴 **그날 이미 낸 편수가 새 단계 상한을 넘으면 내리지 않는다.**
   *    아침에 4건 내고 낮에 d3 로 내려가면 그 4건이 상한 초과가 된다.
   */
  if (stageRank(stage) < stageRank(input.currentStage)
    && input.publishedToday > PROFILES[stage].dailyTarget) {
    reasons.push(
      `🔴 오늘 이미 ${input.publishedToday}건 냈다 — ${stage} 로 내리면 상한 초과가 된다. `
      + `오늘은 ${input.currentStage} 를 고정한다`,
    )
    stage = input.currentStage
    dayPinned = true
  }

  const direction: StageDirection = stageRank(stage) > stageRank(input.currentStage) ? 'up'
    : stageRank(stage) < stageRank(input.currentStage) ? 'down' : 'hold'
  if (direction === 'hold' && reasons.length === 0) {
    reasons.push(`${input.currentStage} 를 유지한다 — 한 칸 위(${up ?? '없음'})가 아직 ready 가 아니다`)
  }

  /**
   * 🔴 **release 는 capacity 를 넘지 못한다** — 기존 `resolveScale` ① 과 같은 계약이다.
   *    이 판정은 내부 생산 눈금(capacity)을 정하고, 공개 눈금은 그 이하다.
   */
  return { ...base, capacity: stage, release: stage, direction, dayPinned, reasons }
}

/** 🔴 아무것도 읽지 못했을 때 — 가장 안전한 단계. 이 값도 날짜와 시각을 갖는다 */
export function safestDecision(kstDate: string, decidedAt: string): StageDecision {
  return {
    kstDate, capacity: SAFEST_STAGE, release: SAFEST_STAGE,
    direction: 'hold', dayPinned: false, supply: null, decidedAt,
    contractVersion: STAGE_DECISION_VERSION,
    reasons: [`🔴 단계 입력을 읽지 못했다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다`],
  }
}
