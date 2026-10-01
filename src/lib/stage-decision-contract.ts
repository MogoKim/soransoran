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
import { RUNTIME_STAGES, SAFEST_STAGE, type RuntimeStage } from './scale-profile'

/**
 * 🔴 **결정 판 v5 — 원천 기회 → 슬롯 계약(`source-slot-v1`)으로 운영한 결정** (2026-09-30).
 *    판을 올리는 이유는 행 모양이 아니라 **증거 계약**이다: 그 이전(v4) 결정은 약한 release 계약 아래에서
 *    나왔고, 그 위의 PASS · 지속 단계 · 이어진 계획은 승급 근거가 될 수 없다(정본: old proof cannot open
 *    a higher stage after the contract changes). 그래서 v4 행은 **읽기만** 한다 — 검증은 통과하지만
 *    `sustainedReleaseOf` · `trialPlanOf` 가 바닥(d1)에서 다시 증명하게 만든다(`isLegacyDecision`).
 */
export const STAGE_DECISION_VERSION = 'stage-decision-v5'
/** 🔴 읽기만 하는 옛 판 — 새로 쓰지 않는다 · 근거로 쓰지 않는다 */
export const LEGACY_STAGE_DECISION_VERSIONS = ['stage-decision-v4'] as const
export type StageDecisionVersion = typeof STAGE_DECISION_VERSION | (typeof LEGACY_STAGE_DECISION_VERSIONS)[number]

/**
 * 🔴 **결정을 쓰는 주체는 하나다** — 전용 daily controller 뿐이다.
 *    `decidedBy` 가 이 값인 행만 기반·소비 대상이 된다.
 */
export const DECISION_WRITER = 'controller' as const
export type DecisionWriter = typeof DECISION_WRITER

/**
 * 🔴 **`REPROVE` — 지금 단계를 증명일로 다시 돈다** (2026-09-29 generic scheduler 배선).
 *    다음 칸이 승인 천장 안인데 오늘 시험이 열리지 않은 날(전날 증거가 없거나 PASS 가 아니다 ·
 *    다음 칸 preflight 가 막았다)에 쓴다. 공개 단계는 **올라가지 않는다** — 그날 자동 target 이
 *    목표 슬롯을 먼저 채워(`stage-proof-day`) 내일 판정할 운영 증거를 만든다.
 *    🔴 앞판에는 이 상태가 없어 PASS 뒤 하루라도 HOLD 가 끼면 그 뒤 증거가 전부
 *       `DECISION_NOT_TRANSITION` 이 되어 **다시는 올라가지 못했다**(지속 승격 밖 영구 정체).
 *    🔴 판(contractVersion)을 올리지 않는다 — 옛 행은 이 상태를 쓰지 않았을 뿐 전부 그대로 유효하다.
 */
export const TRANSITION_STATES = ['SUSTAIN', 'TRIAL', 'PREPARE', 'HOLD', 'REPROVE'] as const
export type TransitionState = (typeof TRANSITION_STATES)[number]

/** 🔴 왜 막혔나 — 문구가 아니라 코드다 */
export const BLOCK_CODES = [
  'CEILING', 'PROVENANCE_CURRENT', 'PROVENANCE_NEXT', 'PROVENANCE_STAGE', 'STALE_DAILY',
  /** 🔴 시험 기반을 **전날 실제 결정**에서 못 가져왔다 */
  'PROVENANCE_PREVIOUS',
  /**
   * 🔴 D20 이상 시험 관문 (2026-09-29 generic scheduler 배선) —
   *    `PREFLIGHT_FAIL`·`PREFLIGHT_UNKNOWN` 다음 칸 preflight(재고 · Persona canary 하한 · 비용 · 러너 용량) ·
   *    `LATE_START` 그 단계 첫 슬롯이 controller 실행 전에 지났다(조각 하루로 시험하지 않는다)
   */
  'PREFLIGHT_FAIL', 'PREFLIGHT_UNKNOWN', 'LATE_START',
] as const
export type BlockCode = (typeof BLOCK_CODES)[number]

export type StageBlock = { readonly code: BlockCode; readonly reason: string }

/** 🔴 보고용 신호 — 결정에 쓰지 않는다 */
export const SUPPLY_EXCLUDE_REASONS = ['noOpenDay', 'holdingStock'] as const
export type SupplyExcludeReason = (typeof SUPPLY_EXCLUDE_REASONS)[number]
export type SupplySignal = {
  readonly eligibleSpeakers: number
  readonly excluded: readonly {
    readonly reason: SupplyExcludeReason
    readonly codes: readonly string[]
  }[]
}

/**
 * 🔴 **시험을 연 근거** (2026-09-29 P0 · 운영 증거 게이트).
 *    · `PASS`   전날 기반 단계가 운영 PASS 였다 — 그래서 한 칸 올린다
 *    · `RETEST` 전날 같은 단계 시험이 PASS 가 아니었다 — 같은 단계를 다시 시험한다
 *    · `FLOOR`  기반이 바닥(d1)이다 — 증명할 아래 칸이 없다
 *    🔴 바닥 위 기반(d3 이상)에서의 시험은 `PASS`·`RETEST` 만이다 — **날짜만으로 올라가지 않는다.**
 *    이 칸이 없는 옛 행은 기반이 바닥일 때만 받는다(09-29 TRIAL d3 · 기반 d1 이 그 모양이다).
 */
export const TRIAL_BASES = ['PASS', 'RETEST', 'FLOOR'] as const
export type TrialBasis = (typeof TRIAL_BASES)[number]

/**
 * 🔴 **왜 그 상태가 됐는가 — 문구가 아니라 구조화된 값이다.**
 *    저장된 행을 검증할 때 `reasons` 문자열을 파싱하지 않으려면 이것이 있어야 한다.
 */
export type TransitionProvenance =
  | {
    readonly kind: 'TRIAL'
    /** 🔴 전날 결정의 `release` — 이것이 기반의 정본이다 */
    readonly trialBase: RuntimeStage
    /** 그 결정의 KST 날짜 — 🔴 `kstDate` 의 **정확한 직전 날짜**여야 한다 */
    readonly previousKstDate: string
    /** 오늘 시험 대상 — `nextStage(trialBase)` 여야 한다 */
    readonly target: RuntimeStage
    /** 🔴 시험을 연 근거 — 바닥 위 기반이면 필수다(`TRIAL_BASES`) */
    readonly basis?: TrialBasis
  }
  | { readonly kind: 'SUSTAIN'; readonly from: RuntimeStage; readonly to: RuntimeStage }

/**
 * 🔴 **deeply readonly 다** (2026-09-24 8차 · 마스터 지적).
 *    앞판은 배열·중첩 객체가 전부 mutable 이었고, `validateStoredDecision` 은
 *    **입력 객체를 그대로 cast** 해 돌려줬다. 그래서 검증이 끝난 뒤 원본 row 의
 *    `capacity`·`blocks[0].code`·`supply.excluded[0].codes` 를 바꾸면
 *    **검증된 결정이 함께 바뀌었다**(실측). 검증은 한 순간의 사진이어야 한다.
 */
export type StageDecision = {
  readonly kstDate: string
  /** 🔴 승인 천장 그대로 — 어떤 판정도 이 값을 올리지 않는다 */
  readonly capacity: RuntimeStage
  readonly release: RuntimeStage
  readonly state: TransitionState
  readonly reasons: readonly string[]
  readonly blocks: readonly StageBlock[]
  readonly dayPinned: boolean
  /** 🔴 **필수 키다.** `null` 이거나 완전한 구조다 — `undefined`·키 누락은 거절한다 */
  readonly supply: SupplySignal | null
  readonly decidedAt: string
  /** 🔴 새 결정은 언제나 v5 다 — v4 는 저장된 옛 행을 읽을 때만 나온다 */
  readonly contractVersion: StageDecisionVersion
  /** 🔴 누가 썼나 — controller 하나뿐이다 */
  readonly decidedBy: string
  /** 🔴 **필수 키다.** `TRIAL`·`SUSTAIN` 이면 구조가 있고, 나머지 상태에서는 `null` */
  readonly transition: TransitionProvenance | null
}

/**
 * 🔴 **어떤 block 이 그 전이를 무효로 만드는가** (2026-09-24 8차).
 *    `planStageDecision` 이 실제로 만드는 결과를 기준으로 확정했다:
 *    · 하루 판정은 `STALE_DAILY`·`PROVENANCE_STAGE`·`PROVENANCE_PREVIOUS` 에서 버려진다
 *    · `CEILING` 은 선택된 TRIAL·SUSTAIN 을 HOLD 로 되돌린다
 *    · 승격 판정은 `PROVENANCE_CURRENT`·`PROVENANCE_NEXT` 에서 버려진다
 * 🔴 **PREPARE·HOLD 는 block 이 있어도 정상이다** — 그 상태를 무효로 만드는 block 이
 *    없기 때문이다. "blocks 가 비었는가" 로 보면 정상 결과를 거절하게 된다.
 */
export const TRANSITION_FATAL_BLOCKS: Readonly<Record<'TRIAL' | 'SUSTAIN', readonly BlockCode[]>> =
  Object.freeze({
    TRIAL: Object.freeze(
      ['CEILING', 'STALE_DAILY', 'PROVENANCE_STAGE', 'PROVENANCE_PREVIOUS',
        'PREFLIGHT_FAIL', 'PREFLIGHT_UNKNOWN', 'LATE_START'] as const,
    ),
    SUSTAIN: Object.freeze(['CEILING', 'PROVENANCE_CURRENT', 'PROVENANCE_NEXT'] as const),
  })

/**
 * 🔴 **brand 는 실수를 막을 뿐 공격을 막지 못한다** (2026-09-24 8차 · 마스터 정정).
 *
 *    앞판 주석은 "이 파일 밖에서는 만들어 낼 수 없다" 고 적었다. **사실이 아니다.**
 *    TypeScript 의 assertion(`as unknown as ValidatedStageDecision`)은 brand 를
 *    그대로 통과한다. 타입은 컴파일 시간에만 있고 런타임에는 없다.
 *
 * 🔴 **그래서 진짜 안전 경계는 타입이 아니라 값이다.**
 *    `validateStoredDecision` 은 검증한 필드만으로 **새 객체를 만들고 깊게 얼린다**
 *    (`deepFreeze`). 그 값은 입력과 참조를 공유하지 않으므로
 *    ① 나중에 원본을 바꿔도 따라 바뀌지 않고
 *    ② 받은 쪽이 고치려 해도 얼어 있어 바뀌지 않는다.
 *    brand 는 "검증을 잊었다" 는 **실수**를 컴파일 시간에 잡는 보조 장치다.
 *
 * 🔴 production 에서 이 타입으로의 직접 cast·이중 cast 는 검사가 금지한다.
 */
/** 🔴 저장 행이 반드시 들고 있어야 하는 키 — 하나라도 빠지면 거절한다 */
export const REQUIRED_KEYS = [
  'kstDate', 'capacity', 'release', 'state', 'reasons', 'blocks',
  'dayPinned', 'supply', 'decidedAt', 'contractVersion', 'decidedBy', 'transition',
] as const

declare const VALIDATED: unique symbol
export type ValidatedStageDecision = StageDecision & { readonly [VALIDATED]: true }

/**
 * 🔴 **이 결정이 지금 증거 계약 이전의 것인가** — 그렇다면 그 위의 지속 단계 · 계획 · PASS 를 근거로 쓰지 않는다.
 *    (행은 유효하다 — 모양은 같다. 쓰지 않는 것은 **그 결정이 증명한 것**이다.)
 */
export function isLegacyDecision(d: { contractVersion: string }): boolean {
  return d.contractVersion !== STAGE_DECISION_VERSION
}

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

/**
 * 🔴 다음 칸 — 여기가 정본이다. 다른 파일이 다시 적지 않는다.
 *    러너 단계(`RUNTIME_STAGES`) 위의 다음 칸이다 — d10 다음은 d20, d50 다음은 없다(D100 은 러너 밖).
 *    🔴 다음 칸이 있다고 열리는 것이 아니다 — 승인 천장이 막는다(사다리 `CEILING`).
 */
export function nextStage(s: RuntimeStage): RuntimeStage | null {
  const i = RUNTIME_STAGES.indexOf(s)
  return i < 0 || i + 1 >= RUNTIME_STAGES.length ? null : RUNTIME_STAGES[i + 1]!
}

export type ValidateResult =
  | { ok: true; decision: ValidatedStageDecision }
  | { ok: false; reason: string }

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const rank = (s: string): number => (RUNTIME_STAGES as readonly string[]).indexOf(s)
const nonNegInt = (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v) && v >= 0
const isStage = (v: unknown): v is RuntimeStage =>
  typeof v === 'string' && (RUNTIME_STAGES as readonly string[]).includes(v)
const isState = (v: unknown): v is TransitionState =>
  typeof v === 'string' && (TRANSITION_STATES as readonly string[]).includes(v)
const isBlockCode = (v: unknown): v is BlockCode =>
  typeof v === 'string' && (BLOCK_CODES as readonly string[]).includes(v)

/** 🔴 받은 쪽이 고치려 해도 바뀌지 않게 — 중첩까지 전부 얼린다 */
function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v
  for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x)
  if (Array.isArray(v)) for (const x of v) deepFreeze(x)
  return Object.freeze(v)
}

/**
 * 🔴 **저장된 행 검증 — 입력은 `unknown` 이고, 어떤 입력에도 던지지 않는다.**
 *
 * 🔴 **호출자가 정본을 주입할 수 없다** (2026-09-24 8차 · 마스터 지적).
 *    앞판은 `allowedStages`·`allowedStates`·`expectContractVersion` 을 받았다.
 *    그래서 아래가 **통과했다**(실측):
 *    ```
 *    allowedStages: ['d1','evil'] · release: 'evil'   → ok:true
 *    allowedStates: ['EVIL']      · state:   'EVIL'   → ok:true
 *    ```
 *    검증기가 자기 정본을 호출자에게서 받으면 그것은 검증이 아니다.
 *    🔴 이제 단계·상태·계약 판은 **이 파일의 상수**뿐이다. 매개변수로 못 바꾼다.
 *
 * 🔴 **입력 객체를 그대로 돌려주지 않는다.** 검증한 필드만으로 새 객체를 만들고
 *    깊게 얼린다 — 검증 뒤 원본을 바꿔도 따라 바뀌지 않는다.
 *
 * 🔴 **문구를 파싱해 상태를 검증하지 않는다.** `state` 는 구조화된 `transition` 과
 *    `blocks` 코드로 대조한다.
 */
export function validateStoredDecision(input: {
  row: unknown
  /** 🔴 어느 날의 결정을 기대하는가 — 이것만이 호출자가 정하는 값이다 */
  expectKstDate: string
}): ValidateResult {
  const no = (reason: string): ValidateResult => ({ ok: false, reason })

  if (!isRec(input.row)) return no(`행이 객체가 아니다 — ${typeof input.row}`)
  const r = input.row

  /**
   * 🔴 **필수 키가 전부 있는가.** DB select 에서 칼럼 하나가 빠진 행을 받지 않는다.
   *
   * 🔴 **정직하게 적는다: 이 루프만이 막는 입력은 없다.** 아래 칸별 규칙이 전부
   *    `undefined` 를 이미 거절한다(12/12 실측). 남겨 두는 이유는 **메시지**다 —
   *    루프를 빼면 `transition` 누락이 "HOLD 인데 전이 근거가 **붙어 있다**" 로 나온다.
   *    없는 것을 있다고 말하는 메시지는 사람을 엉뚱한 칼럼으로 보낸다.
   *    그래서 검사도 "거절하는가" 가 아니라 **"빠진 칸 이름을 맞게 말하는가"** 를 본다.
   */
  for (const k of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(r, k)) return no(`필수 키가 없다 — ${k}`)
    if (r[k] === undefined) return no(`필수 키가 undefined 다 — ${k}`)
  }

  const version = r.contractVersion
  if (version !== STAGE_DECISION_VERSION
    && !(LEGACY_STAGE_DECISION_VERSIONS as readonly unknown[]).includes(version)) {
    return no(`계약 판 ${String(r.contractVersion)} ≠ ${STAGE_DECISION_VERSION}`)
  }
  const contractVersion = version as StageDecisionVersion
  if (!isCalendarDate(r.kstDate)) return no(`달력에 없는 날짜다 — ${String(r.kstDate)}`)
  const kstDate = r.kstDate
  if (!isCalendarDate(input.expectKstDate)) {
    return no(`기대 날짜가 달력에 없다 — ${String(input.expectKstDate)}`)
  }
  if (kstDate !== input.expectKstDate) return no(`날짜 ${kstDate} ≠ ${input.expectKstDate}`)

  const decidedAt = str(r.decidedAt)
  if (decidedAt === null || decidedAt.trim() === '' || !Number.isFinite(Date.parse(decidedAt))) {
    return no(`결정 시각을 읽을 수 없다 — ${String(r.decidedAt)}`)
  }
  /** 🔴 라벨과 실제 시각이 어긋난 행을 받지 않는다 — 날짜 칸만 고쳐 넣는 것을 막는다 */
  if (kstDateOfIso(decidedAt) !== kstDate) {
    return no(`decidedAt 의 KST 날짜 ${String(kstDateOfIso(decidedAt))} ≠ kstDate ${kstDate}`)
  }
  if (r.decidedBy !== DECISION_WRITER) {
    return no(`쓴 것이 ${String(r.decidedBy)} 다 — ${DECISION_WRITER} 만 쓴다`)
  }

  if (!isStage(r.capacity)) return no(`모르는 천장 — ${String(r.capacity)}`)
  if (!isStage(r.release)) return no(`모르는 공개 단계 — ${String(r.release)}`)
  const capacity = r.capacity
  const release = r.release
  /** 🔴 공개가 승인 천장을 넘은 행은 쓰지 않는다 — 승인되지 않은 양이 나간다 */
  if (rank(release) > rank(capacity)) {
    return no(`공개 ${release} 가 승인 천장 ${capacity} 를 넘는다`)
  }
  if (!isState(r.state)) return no(`모르는 상태 — ${String(r.state)}`)
  const state = r.state

  if (!Array.isArray(r.reasons) || r.reasons.some((x) => typeof x !== 'string')) {
    return no('reasons 모양이 깨졌다 — 문자열 배열이어야 한다')
  }
  const reasons: string[] = [...(r.reasons as string[])]

  /** 🔴 `blocks.code` 는 정본 enum 만이다 — 모르는 코드로 분기하면 아무도 못 읽는다 */
  if (!Array.isArray(r.blocks)) return no('blocks 가 배열이 아니다')
  const blocks: StageBlock[] = []
  for (const b of r.blocks) {
    if (!isRec(b) || typeof b.reason !== 'string') return no('blocks 항목이 {code, reason} 이 아니다')
    if (!isBlockCode(b.code)) return no(`모르는 block 코드 — ${String(b.code)}`)
    blocks.push({ code: b.code, reason: b.reason })
  }
  if (typeof r.dayPinned !== 'boolean') return no(`dayPinned 가 boolean 이 아니다 — ${typeof r.dayPinned}`)
  const dayPinned = r.dayPinned

  let supply: SupplySignal | null = null
  if (r.supply !== null) {
    const sp = r.supply
    if (!isRec(sp)) return no('supply 가 객체도 null 도 아니다')
    if (!nonNegInt(sp.eligibleSpeakers)) {
      return no(`supply.eligibleSpeakers 가 유한한 비음수 정수가 아니다 — ${String(sp.eligibleSpeakers)}`)
    }
    if (!Array.isArray(sp.excluded)) return no('supply.excluded 가 배열이 아니다')
    const excluded: { reason: SupplyExcludeReason; codes: string[] }[] = []
    for (const e of sp.excluded) {
      if (!isRec(e)) return no('supply.excluded 항목이 객체가 아니다')
      const reason = e.reason
      if (typeof reason !== 'string'
        || !(SUPPLY_EXCLUDE_REASONS as readonly string[]).includes(reason)) {
        return no(`모르는 supply 제외 사유 — ${String(e.reason)}`)
      }
      if (!Array.isArray(e.codes) || e.codes.some((c) => typeof c !== 'string')) {
        return no('supply.excluded[].codes 가 문자열 배열이 아니다')
      }
      excluded.push({ reason: reason as SupplyExcludeReason, codes: [...(e.codes as string[])] })
    }
    supply = { eligibleSpeakers: sp.eligibleSpeakers as number, excluded }
  }

  /** ── 🔴 상태와 전이 근거의 대조 — **문구가 아니라 구조화된 값** ── */
  const t = r.transition
  let transition: TransitionProvenance | null = null
  if (state === 'TRIAL') {
    if (!isRec(t) || t.kind !== 'TRIAL') return no('TRIAL 인데 구조화된 시험 근거가 없다')
    if (!isStage(t.trialBase)) return no(`시험 기반이 정본이 아니다 — ${String(t.trialBase)}`)
    /**
     * 🔴 **직전 날짜여야 한다.** 앞판은 `\d{4}-\d{2}-\d{2}` 만 봤다 —
     *    그래서 `1999-01-01` 이 통과했다(실측).
     */
    const want = previousKstDate(kstDate)
    if (!isCalendarDate(t.previousKstDate) || t.previousKstDate !== want) {
      return no(`시험 근거의 이전 결정 날짜 ${String(t.previousKstDate)} ≠ 직전 날짜 ${String(want)}`)
    }
    const up = nextStage(t.trialBase)
    if (up === null || release !== up) {
      return no(`TRIAL 공개 ${release} 가 기반 ${t.trialBase} 의 바로 다음 칸(${String(up)})이 아니다`)
    }
    if (t.target !== release) return no(`시험 대상 ${String(t.target)} ≠ 공개 ${release}`)
    /**
     * 🔴 **바닥 위 기반의 시험은 증거 근거가 있어야 한다** (2026-09-29 P0).
     *    `d3 → d5` 를 근거 칸 없이 적은 행은 "날짜만으로 올린" 행이다 — 받지 않는다.
     *    `FLOOR` 는 기반이 바닥일 때만 말이 된다.
     */
    const basisRaw: unknown = t.basis
    if (basisRaw !== undefined && !(TRIAL_BASES as readonly unknown[]).includes(basisRaw)) {
      return no(`모르는 시험 근거 — ${String(basisRaw)}`)
    }
    const basis = basisRaw as TrialBasis | undefined
    if (t.trialBase !== SAFEST_STAGE && basis !== 'PASS' && basis !== 'RETEST') {
      return no(`기반 ${t.trialBase} 위의 시험인데 운영 증거 근거(PASS·RETEST)가 없다 — ${String(basis)}`)
    }
    transition = {
      kind: 'TRIAL', trialBase: t.trialBase,
      previousKstDate: t.previousKstDate, target: release,
      ...(basis === undefined ? {} : { basis }),
    }
  } else if (state === 'SUSTAIN') {
    /**
     * 🔴 **v5 는 SUSTAIN 을 쓰지 않는다** (2026-09-30 · source-slot-v1). 지속 단계는 전날 TRIAL 결정 + 그 증거
     *    PASS 에서만 나온다(`sustainedReleaseOf`) — 날짜 · 연속 일수로 올리는 승격 경로(`judgePromotion`)를 지웠다.
     *    옛 v4 행은 읽되 `isLegacyDecision` 이 지속 d1 · 시험 계획 FLOOR 로 다룬다.
     */
    if (contractVersion === STAGE_DECISION_VERSION) return no('v5 결정은 SUSTAIN 을 쓰지 않는다 — 지속 승격 경로를 지웠다')
    if (!isRec(t) || t.kind !== 'SUSTAIN') return no('SUSTAIN 인데 구조화된 승격 근거가 없다')
    if (!isStage(t.from)) return no(`승격 출발이 정본이 아니다 — ${String(t.from)}`)
    if (t.to !== release) return no(`승격 도착 ${String(t.to)} ≠ 공개 ${release}`)
    const up = nextStage(t.from)
    if (up === null || release !== up) {
      return no(`승격 ${t.from}→${release} 가 바로 다음 칸(${String(up)})이 아니다`)
    }
    transition = { kind: 'SUSTAIN', from: t.from, to: release }
  } else {
    /** 🔴 REPROVE 는 올라가지 않는 날이다 — HOLD·PREPARE 처럼 전이 근거가 없다 */
    if (t !== null) return no(`${state} 인데 전이 근거가 붙어 있다`)
    /** 🔴 PREPARE 는 천장이 공개보다 높다는 뜻이다 — 같거나 낮으면 그 상태일 수 없다 */
    if (state === 'PREPARE' && rank(capacity) <= rank(release)) {
      return no(`PREPARE 인데 천장 ${capacity} 가 공개 ${release} 보다 높지 않다`)
    }
  }

  /**
   * ── 🔴 **선택된 전이를 무효로 만드는 block 이 붙어 있으면 거절** ──
   *    실측 반례: `state=TRIAL · release=d5 · blocks=[PROVENANCE_PREVIOUS]` 가
   *    `ok:true` 였고 consumer 가 그대로 d5 를 썼다. "막았다" 고 적힌 행으로
   *    시험이 열린 것이다.
   * 🔴 **blocks 가 비었는지 보지 않는다** — PREPARE·HOLD 는 block 이 있어도 정상이다.
   */
  if (state === 'TRIAL' || state === 'SUSTAIN') {
    const fatal = TRANSITION_FATAL_BLOCKS[state]
    const hit = blocks.find((b) => fatal.includes(b.code))
    if (hit !== undefined) {
      return no(`${state} 인데 그 전이를 무효로 만드는 block 이 있다 — ${hit.code}`)
    }
  }

  /** 🔴 **검증한 값만으로 새로 만든다.** 입력과 참조를 공유하지 않는다 */
  const decision: StageDecision = {
    kstDate, capacity, release, state, reasons, blocks, dayPinned, supply,
    decidedAt, contractVersion, decidedBy: DECISION_WRITER, transition,
  }
  return { ok: true, decision: deepFreeze(decision) as ValidatedStageDecision }
}
