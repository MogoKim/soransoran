/**
 * 🔴 **StageDecision 계약 정본 — 검증은 여기 한 벌뿐이다** (2026-09-24 7차)
 *
 * 🔴 **왜 파일을 나눴나.** 앞판은 `stage-ladder` 가 결정을 만들고
 *    `stage-decision-store` 가 그것을 검증했다. 그래서 **사다리는 저장 검증을
 *    부를 수 없었다**(부르면 순환 import 다). 결과가 실측 반례다:
 *    ```
 *    전날 결정  capacity=d1 · release=d3 · decidedAt=2020-01-01
 *    오늘       daily=d5
 *    → TRIAL d5 · blocks=[]      🔴 저장 검증이라면 즉시 거절할 행이다
 *    ```
 *    사다리는 날짜·판·writer·release **넷만** 보고 기반으로 삼았다.
 *
 * 🔴 **그래서 `ValidatedStageDecision` 은 brand 타입이다.**
 *    `validateStoredDecision` 만이 그 타입을 만들 수 있다 —
 *    `planStageDecision` 은 그 타입만 받는다. 검증을 건너뛴 값은 **타입이 맞지 않아
 *    들어오지 못한다.** 검증 로직을 두 벌로 복제하지 않고 게이트를 하나로 만든 것이다.
 *
 * 🔴 이 파일은 `scale-profile`(단계 enum 정본) 외에 아무것도 import 하지 않는다.
 *    사다리도 저장소도 이 파일을 향하고, 이 파일은 아무 쪽도 향하지 않는다.
 */
import { RELEASE_STAGES, type ReleaseStage } from './scale-profile'

export const STAGE_DECISION_VERSION = 'stage-decision-v4'

/**
 * 🔴 **결정을 쓰는 주체는 하나다** — 전용 daily controller 뿐이다.
 *    `decidedBy` 가 이 값인 행만 기반·소비 대상이 된다.
 */
export const DECISION_WRITER = 'controller' as const
export type DecisionWriter = typeof DECISION_WRITER

export const TRANSITION_STATES = ['SUSTAIN', 'TRIAL', 'PREPARE', 'HOLD'] as const
export type TransitionState = (typeof TRANSITION_STATES)[number]

/** 🔴 왜 막혔나 — 문구가 아니라 코드다 */
export const BLOCK_CODES = [
  'CEILING', 'PROVENANCE_CURRENT', 'PROVENANCE_NEXT', 'PROVENANCE_STAGE', 'STALE_DAILY',
  /** 🔴 시험 기반을 **전날 실제 결정**에서 못 가져왔다 */
  'PROVENANCE_PREVIOUS',
] as const
export type BlockCode = (typeof BLOCK_CODES)[number]

export type StageBlock = { code: BlockCode; reason: string }

/** 🔴 보고용 신호 — 결정에 쓰지 않는다 */
export const SUPPLY_EXCLUDE_REASONS = ['noOpenDay', 'holdingStock'] as const
export type SupplyExcludeReason = (typeof SUPPLY_EXCLUDE_REASONS)[number]
export type SupplySignal = {
  eligibleSpeakers: number
  excluded: { reason: SupplyExcludeReason; codes: string[] }[]
}

/**
 * 🔴 **왜 그 상태가 됐는가 — 문구가 아니라 구조화된 값이다.**
 *    저장된 행을 검증할 때 `reasons` 문자열을 파싱하지 않으려면 이것이 있어야 한다.
 */
export type TransitionProvenance =
  | {
    kind: 'TRIAL'
    /** 🔴 전날 결정의 `release` — 이것이 기반의 정본이다 */
    trialBase: ReleaseStage
    /** 그 결정의 KST 날짜 — 🔴 `kstDate` 의 **정확한 직전 날짜**여야 한다 */
    previousKstDate: string
    /** 오늘 시험 대상 — `nextStage(trialBase)` 여야 한다 */
    target: ReleaseStage
  }
  | { kind: 'SUSTAIN'; from: ReleaseStage; to: ReleaseStage }

export type StageDecision = {
  kstDate: string
  /** 🔴 승인 천장 그대로 — 어떤 판정도 이 값을 올리지 않는다 */
  capacity: ReleaseStage
  release: ReleaseStage
  state: TransitionState
  reasons: string[]
  blocks: StageBlock[]
  dayPinned: boolean
  supply: SupplySignal | null
  decidedAt: string
  contractVersion: typeof STAGE_DECISION_VERSION
  /** 🔴 누가 썼나 — controller 하나뿐이다 */
  decidedBy: string
  /** 🔴 `TRIAL`·`SUSTAIN` 이면 반드시 있고, 나머지 상태에서는 `null` 이다 */
  transition: TransitionProvenance | null
}

/**
 * 🔴 **brand.** 이 심볼은 export 하지 않는다 — 그래서 **이 파일 밖에서는
 *    `ValidatedStageDecision` 을 만들어 낼 수 없다.** 캐스팅으로 우회하려면
 *    `as unknown as` 를 써야 하고, 그것은 검사가 잡는다.
 */
declare const VALIDATED: unique symbol
export type ValidatedStageDecision = StageDecision & { readonly [VALIDATED]: true }

/** 🔴 ISO 시각의 KST 날짜 — 정본과 같은 경계다 */
export function kstDateOfIso(iso: string): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)
}

/**
 * 🔴 **달력에 실제로 있는 날인가** — 정규식만으로는 모자란다.
 *    `2026-02-30` 은 `\d{4}-\d{2}-\d{2}` 를 만족하지만 달력에 없다.
 *    되돌려 찍어(canonical round-trip) 같은 글자가 나오는지 본다.
 */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const ms = Date.parse(`${v}T00:00:00Z`)
  if (!Number.isFinite(ms)) return false
  return new Date(ms).toISOString().slice(0, 10) === v
}

/** 🔴 KST 기준 바로 전날 — 달력에 없는 날이면 `null` */
export function previousKstDate(kstDate: string): string | null {
  if (!isCalendarDate(kstDate)) return null
  return new Date(Date.parse(`${kstDate}T00:00:00Z`) - 864e5).toISOString().slice(0, 10)
}

/** 🔴 다음 칸 — 여기가 정본이다. 다른 파일이 다시 적지 않는다 */
export function nextStage(s: ReleaseStage): ReleaseStage | null {
  const i = RELEASE_STAGES.indexOf(s)
  return i < 0 || i + 1 >= RELEASE_STAGES.length ? null : RELEASE_STAGES[i + 1]!
}

export type ValidateResult =
  | { ok: true; decision: ValidatedStageDecision }
  | { ok: false; reason: string }

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const rank = (s: string): number => (RELEASE_STAGES as readonly string[]).indexOf(s)
const nonNegInt = (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v) && v >= 0

/**
 * 🔴 **저장된 행 검증 — 입력은 `unknown` 이고, 어떤 입력에도 던지지 않는다.**
 *
 *    통과하면 `ValidatedStageDecision` 이 나온다. 그 타입만이 사다리의
 *    `previousDecision` 자리에 들어갈 수 있다 — 검증을 건너뛴 값은 타입이 막는다.
 *
 * 🔴 **문구를 파싱해 상태를 검증하지 않는다.** `state` 는 구조화된 `transition` 과 대조한다.
 */
export function validateStoredDecision(input: {
  row: unknown
  expectKstDate: string
  /** 🔴 생략하면 현재 판이다. 무엇을 넘기든 **현재 판이 아닌 행은 통과하지 못한다** */
  expectContractVersion?: string
  allowedStages?: readonly string[]
  allowedStates?: readonly string[]
}): ValidateResult {
  const stages = input.allowedStages ?? (RELEASE_STAGES as readonly string[])
  const states = input.allowedStates ?? (TRANSITION_STATES as readonly string[])
  const wantVersion = input.expectContractVersion ?? STAGE_DECISION_VERSION
  const no = (reason: string): ValidateResult => ({ ok: false, reason })

  if (!isRec(input.row)) return no(`행이 객체가 아니다 — ${typeof input.row}`)
  const r = input.row

  const contractVersion = str(r.contractVersion)
  /**
   * 🔴 **caller 가 무엇을 기대한다고 말하든, 현재 판이 아니면 통과하지 못한다.**
   *    기대값만 보면 `expectContractVersion: 'old'` 로 옛 행을 승인시킬 수 있다 —
   *    그러면 brand 가 아무것도 보장하지 않는다.
   */
  if (contractVersion !== STAGE_DECISION_VERSION) {
    return no(`계약 판 ${String(r.contractVersion)} ≠ ${STAGE_DECISION_VERSION}`)
  }
  if (contractVersion !== wantVersion) return no(`계약 판 ${contractVersion} ≠ ${wantVersion}`)

  if (!isCalendarDate(r.kstDate)) return no(`달력에 없는 날짜다 — ${String(r.kstDate)}`)
  const kstDate = r.kstDate
  if (kstDate !== input.expectKstDate) return no(`날짜 ${kstDate} ≠ ${input.expectKstDate}`)

  const decidedAt = str(r.decidedAt)
  if (decidedAt === null || decidedAt.trim() === '' || !Number.isFinite(Date.parse(decidedAt))) {
    return no(`결정 시각을 읽을 수 없다 — ${String(r.decidedAt)}`)
  }
  /** 🔴 라벨과 실제 시각이 어긋난 행을 받지 않는다 — 날짜 칸만 고쳐 넣는 것을 막는다 */
  const decidedDate = kstDateOfIso(decidedAt)
  if (decidedDate !== kstDate) {
    return no(`decidedAt 의 KST 날짜 ${String(decidedDate)} ≠ kstDate ${kstDate}`)
  }
  if (str(r.decidedBy) !== DECISION_WRITER) {
    return no(`쓴 것이 ${String(r.decidedBy)} 다 — ${DECISION_WRITER} 만 쓴다`)
  }

  const capacity = str(r.capacity)
  const release = str(r.release)
  if (capacity === null || !stages.includes(capacity)) return no(`모르는 천장 — ${String(r.capacity)}`)
  if (release === null || !stages.includes(release)) return no(`모르는 공개 단계 — ${String(r.release)}`)
  /** 🔴 공개가 승인 천장을 넘은 행은 쓰지 않는다 — 승인되지 않은 양이 나간다 */
  if (rank(release) > rank(capacity)) {
    return no(`공개 ${release} 가 승인 천장 ${capacity} 를 넘는다`)
  }

  const state = str(r.state)
  if (state === null || !states.includes(state)) return no(`모르는 상태 — ${String(r.state)}`)

  if (!Array.isArray(r.reasons) || r.reasons.some((x) => typeof x !== 'string')) {
    return no('reasons 모양이 깨졌다 — 문자열 배열이어야 한다')
  }
  /** 🔴 `blocks.code` 는 정본 enum 만이다 — 모르는 코드로 분기하면 아무도 못 읽는다 */
  if (!Array.isArray(r.blocks)) return no('blocks 가 배열이 아니다')
  for (const b of r.blocks) {
    if (!isRec(b) || typeof b.reason !== 'string') return no('blocks 항목이 {code, reason} 이 아니다')
    if (!(BLOCK_CODES as readonly string[]).includes(String(b.code))) {
      return no(`모르는 block 코드 — ${String(b.code)}`)
    }
  }
  if (typeof r.dayPinned !== 'boolean') return no(`dayPinned 가 boolean 이 아니다 — ${typeof r.dayPinned}`)

  if (r.supply !== null && r.supply !== undefined) {
    const sp = r.supply
    if (!isRec(sp)) return no('supply 가 객체가 아니다')
    if (!nonNegInt(sp.eligibleSpeakers)) {
      return no(`supply.eligibleSpeakers 가 유한한 비음수 정수가 아니다 — ${String(sp.eligibleSpeakers)}`)
    }
    if (!Array.isArray(sp.excluded)) return no('supply.excluded 가 배열이 아니다')
    for (const e of sp.excluded) {
      if (!isRec(e)) return no('supply.excluded 항목이 객체가 아니다')
      if (!(SUPPLY_EXCLUDE_REASONS as readonly string[]).includes(String(e.reason))) {
        return no(`모르는 supply 제외 사유 — ${String(e.reason)}`)
      }
      if (!Array.isArray(e.codes) || e.codes.some((c) => typeof c !== 'string')) {
        return no('supply.excluded[].codes 가 문자열 배열이 아니다')
      }
    }
  }

  /** ── 🔴 상태와 전이 근거의 대조 — **문구가 아니라 구조화된 값** ── */
  const t = r.transition
  if (state === 'TRIAL') {
    if (!isRec(t) || t.kind !== 'TRIAL') return no('TRIAL 인데 구조화된 시험 근거가 없다')
    const tBase = str(t.trialBase)
    const target = str(t.target)
    if (tBase === null || !stages.includes(tBase)) return no(`시험 기반이 정본이 아니다 — ${String(t.trialBase)}`)
    /**
     * 🔴 **직전 날짜여야 한다** (2026-09-24 7차 실측 반례).
     *    앞판은 `\d{4}-\d{2}-\d{2}` 만 봤다 — 그래서 `1999-01-01` 이 통과했다.
     */
    const want = previousKstDate(kstDate)
    if (!isCalendarDate(t.previousKstDate) || t.previousKstDate !== want) {
      return no(`시험 근거의 이전 결정 날짜 ${String(t.previousKstDate)} ≠ 직전 날짜 ${String(want)}`)
    }
    const up = nextStage(tBase as ReleaseStage)
    if (up === null || release !== up) {
      return no(`TRIAL 공개 ${release} 가 기반 ${tBase} 의 바로 다음 칸(${String(up)})이 아니다`)
    }
    if (target !== release) return no(`시험 대상 ${String(target)} ≠ 공개 ${release}`)
  } else if (state === 'SUSTAIN') {
    if (!isRec(t) || t.kind !== 'SUSTAIN') return no('SUSTAIN 인데 구조화된 승격 근거가 없다')
    const from = str(t.from)
    const to = str(t.to)
    if (from === null || !stages.includes(from)) return no(`승격 출발이 정본이 아니다 — ${String(t.from)}`)
    if (to === null || to !== release) return no(`승격 도착 ${String(t.to)} ≠ 공개 ${release}`)
    const up = nextStage(from as ReleaseStage)
    if (up === null || to !== up) return no(`승격 ${from}→${to} 가 바로 다음 칸(${String(up)})이 아니다`)
  } else {
    if (t !== null && t !== undefined) return no(`${state} 인데 전이 근거가 붙어 있다`)
    /** 🔴 PREPARE 는 천장이 공개보다 높다는 뜻이다 — 같거나 낮으면 그 상태일 수 없다 */
    if (state === 'PREPARE' && rank(capacity) <= rank(release)) {
      return no(`PREPARE 인데 천장 ${capacity} 가 공개 ${release} 보다 높지 않다`)
    }
  }
  return { ok: true, decision: r as unknown as ValidatedStageDecision }
}
