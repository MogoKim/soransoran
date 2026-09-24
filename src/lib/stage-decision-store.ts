/**
 * 🔴 **하루 StageDecision 저장 설계 — 아직 구현하지 않는다** (2026-09-24)
 *
 *   이 파일은 **계약과 순서만** 정의한다. Prisma 모델도 migration 도 DB write 도 없다.
 *   승인 뒤에 이 계약대로 구현한다.
 *
 * 🔴 **왜 저장이 필요한가.** 공급(로컬 launchd)과 발행(GitHub Actions)은 서로 다른
 *    env 원천을 읽는다. 2026-09-24 에 canonical d3 · GitHub d5 로 갈려 하루가 갔다.
 *    두 러너가 **같은 행 하나**를 읽어야 그 일이 다시 나지 않는다.
 *
 * 🔴 **하루 결정은 최초 확정 뒤 바뀌지 않는다(immutable).**
 *    바뀌면 아침에 d5 로 낸 글이 낮의 d3 결정 아래에서 상한 초과가 된다.
 *    그래서 갱신·덮어쓰기가 없다 — `ensureStageDecision` 은 **만들거나 읽거나** 둘뿐이다.
 */
import {
  DECISION_WRITER, STAGE_DECISION_VERSION, RELEASE_STAGES_FOR_DECISION,
  TRANSITION_STATES, nextStage, kstDateOfIso,
  type StageDecision, type DecisionWriter,
} from './stage-ladder'

export { DECISION_WRITER }
export type { DecisionWriter }

/**
 * 🔴 **writer 는 하나다** (2026-09-24 마스터 지적 · first-writer 구조 폐기).
 *
 *    앞판은 supply/publish 중 **먼저 INSERT 한 쪽**이 그날 결정을 고정했다.
 *    상호 배제는 **입력이 같다는 것을 증명하지 않는다** — 두 러너는 서로 다른 시각에
 *    서로 다른 DB 스냅샷을 읽는다. 먼저 온 쪽의 스냅샷이 하루를 지배하면
 *    "왜 오늘 이 단계인가" 를 아무도 설명할 수 없다.
 *
 * 🔴 **전용 daily controller 하나만 쓴다.** 첫 공급·첫 발행보다 **먼저** 돈다.
 *    supply 와 publish 는 저장된 결정을 **읽기만** 한다(consumer).
 */
export const DECISION_CONSUMERS = ['supply', 'publish'] as const
export type DecisionConsumer = (typeof DECISION_CONSUMERS)[number]

/**
 * 🔴 **kill switch.** rollback 은 `contractVersion` 되돌리기가 아니다 —
 *    그것은 옛 결정을 되살려 더 헷갈리게 만든다.
 *    이 값이 꺼지면 두 러너는 **기존 env/canary 경로**로 그대로 돌아간다.
 */
export const CONTROLLER_ENV = 'STAGE_CONTROLLER_ENABLED'

export function controllerEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env[CONTROLLER_ENV] ?? '').trim().toLowerCase() === 'on'
}

/**
 * 🔴 **유일키는 (KST 날짜 + 계약 판)** 이다.
 *    계약 판이 바뀌면 그날의 옛 결정을 재사용하지 않는다 — 판이 다르면 뜻이 다르다.
 */
export type DecisionKey = { kstDate: string; contractVersion: string }

export const decisionKeyOf = (d: StageDecision): DecisionKey =>
  ({ kstDate: d.kstDate, contractVersion: d.contractVersion })

export type EnsureOutcome =
  /** controller 가 그날 결정을 만들었다 */
  | { ok: true; decision: StageDecision; created: true; by: DecisionWriter }
  /** 이미 있어서 읽었다 — 🔴 다시 계산하지도 덮지도 않는다 */
  | { ok: true; decision: StageDecision; created: false; by: DecisionWriter }
  /**
   * 🔴 **만들지도 읽지도 못했다.** 부르는 쪽은 **기존 경로 또는 가장 안전한 단계**로 간다 —
   *    "모른다" 를 "어제 값" 으로 채우지 않는다.
   */
  | { ok: false; code: 'UNAVAILABLE' | 'BROKEN'; reason: string }

/**
 * 🔴 **consumer 가 결정을 읽는다. 없으면 사후 생성하지 않는다** (마스터 지적).
 *
 *    첫 발행 전에 행이 없다는 것은 controller 가 돌지 않았다는 뜻이다.
 *    그때 발행 러너가 **높은 단계를 사후에 만들어** 내보내면, 아무도 판단하지 않은
 *    양이 나간다. 기존 env/canary 경로로 가거나 가장 안전한 단계로 간다.
 */
export type ConsumeOutcome =
  | { ok: true; decision: StageDecision }
  | { ok: false; code: 'NO_DECISION' | 'BROKEN'; reason: string; fallback: 'legacy' | 'safest' }

export async function consumeStageDecision(io: {
  /** 🔴 **`unknown` 이다** — 저장소가 무엇을 돌려줄지 약속하지 않는다 */
  read: () => Promise<unknown>
  /** 🔴 controller 와 **같은** validator 여야 한다 — 양쪽이 다르면 한쪽만 통과한다 */
  validate: (row: unknown) => ValidateResult
  /** kill switch 가 꺼져 있으면 기존 경로로 간다 */
  controllerOn: boolean
  by: DecisionConsumer
}): Promise<ConsumeOutcome> {
  void io.by
  if (!io.controllerOn) {
    return {
      ok: false, code: 'NO_DECISION', fallback: 'legacy',
      reason: `${CONTROLLER_ENV} 가 켜져 있지 않다 — 기존 env/canary 경로로 간다`,
    }
  }
  const row = await io.read()
  if (row === null || row === undefined) {
    return {
      ok: false, code: 'NO_DECISION', fallback: 'safest',
      reason: '그날 결정이 없다 — 🔴 사후에 만들지 않는다. 가장 안전한 단계로 간다',
    }
  }
  const v = io.validate(row)
  if (!v.ok) {
    return { ok: false, code: 'BROKEN', fallback: 'safest', reason: `저장된 행이 깨졌다 — ${v.reason}` }
  }
  // 🔴 검증을 통과한 값만 나간다 — 읽은 원본을 그대로 흘리지 않는다
  return { ok: true, decision: v.decision }
}

/**
 * 🔴 **저장된 행 검증 — 입력은 `unknown` 이다** (2026-09-24 6차 · 마스터 지적).
 *
 *    앞판은 `row: StageDecision` 을 받았다. 그 타입은 **저장소에서 읽은 값에 대한
 *    약속이 아니라 희망**이다 — JSON 칼럼이 깨졌거나 판이 다른 행을 읽으면
 *    `r.decidedAt.trim()` 에서 그대로 **throw** 했고, consumer 가 죽었다.
 *    🔴 이 함수는 어떤 입력에도 던지지 않는다. 모르는 것은 전부 `ok:false` 다.
 *
 * 🔴 **문구를 파싱해 상태를 검증하지 않는다.** `state` 는 구조화된
 *    `transition` 값과 대조한다(`TRIAL` → `release === nextStage(trialBase)`).
 */
export type ValidateResult = { ok: true; decision: StageDecision } | { ok: false; reason: string }

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const rank = (s: string): number => RELEASE_STAGES_FOR_DECISION.indexOf(s)

export function validateStoredDecision(input: {
  row: unknown
  expectKstDate: string
  expectContractVersion: string
  allowedStages?: readonly string[]
  allowedStates?: readonly string[]
}): ValidateResult {
  const stages = input.allowedStages ?? RELEASE_STAGES_FOR_DECISION
  const states = input.allowedStates ?? (TRANSITION_STATES as readonly string[])
  const no = (reason: string): ValidateResult => ({ ok: false, reason })

  if (!isRec(input.row)) return no(`행이 객체가 아니다 — ${typeof input.row}`)
  const r = input.row

  const contractVersion = str(r.contractVersion)
  if (contractVersion !== input.expectContractVersion) {
    return no(`계약 판 ${String(r.contractVersion)} ≠ ${input.expectContractVersion}`)
  }
  const kstDate = str(r.kstDate)
  if (kstDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(kstDate)) {
    return no(`날짜 형식이 아니다 — ${String(r.kstDate)}`)
  }
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
  if (!Array.isArray(r.blocks)
    || r.blocks.some((b) => !isRec(b) || typeof b.code !== 'string' || typeof b.reason !== 'string')) {
    return no('blocks 모양이 깨졌다 — {code, reason} 배열이어야 한다')
  }
  if (typeof r.dayPinned !== 'boolean') return no(`dayPinned 가 boolean 이 아니다 — ${typeof r.dayPinned}`)
  if (r.supply !== null && r.supply !== undefined) {
    const sp = r.supply
    if (!isRec(sp) || typeof sp.eligibleSpeakers !== 'number' || !Array.isArray(sp.excluded)) {
      return no('supply 모양이 깨졌다 — {eligibleSpeakers, excluded[]} 이거나 null 이어야 한다')
    }
  }

  /** ── 🔴 상태와 전이 근거의 대조 — **문구가 아니라 구조화된 값** ── */
  const t = r.transition
  if (state === 'TRIAL') {
    if (!isRec(t) || t.kind !== 'TRIAL') return no('TRIAL 인데 구조화된 시험 근거가 없다')
    const base = str(t.trialBase)
    const target = str(t.target)
    const prevDate = str(t.previousKstDate)
    if (base === null || !stages.includes(base)) return no(`시험 기반이 정본이 아니다 — ${String(t.trialBase)}`)
    if (prevDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(prevDate)) {
      return no(`시험 근거의 이전 결정 날짜가 없다 — ${String(t.previousKstDate)}`)
    }
    const up = nextStage(base as never)
    if (up === null || release !== up) {
      return no(`TRIAL 공개 ${release} 가 기반 ${base} 의 바로 다음 칸(${String(up)})이 아니다`)
    }
    if (target !== release) return no(`시험 대상 ${String(target)} ≠ 공개 ${release}`)
  } else if (state === 'SUSTAIN') {
    if (!isRec(t) || t.kind !== 'SUSTAIN') return no('SUSTAIN 인데 구조화된 승격 근거가 없다')
    const from = str(t.from)
    const to = str(t.to)
    if (from === null || !stages.includes(from)) return no(`승격 출발이 정본이 아니다 — ${String(t.from)}`)
    if (to === null || to !== release) return no(`승격 도착 ${String(t.to)} ≠ 공개 ${release}`)
    const up = nextStage(from as never)
    if (up === null || to !== up) return no(`승격 ${from}→${to} 가 바로 다음 칸(${String(up)})이 아니다`)
  } else {
    if (t !== null && t !== undefined) return no(`${state} 인데 전이 근거가 붙어 있다`)
    /**
     * 🔴 **PREPARE 는 천장이 공개보다 높다는 뜻이다.** 같거나 낮으면 그 상태일 수 없다 —
     *    쌓을 다음 칸이 없는데 "쌓는 중" 이라고 적힌 행이다.
     */
    if (state === 'PREPARE' && rank(capacity) <= rank(release)) {
      return no(`PREPARE 인데 천장 ${capacity} 가 공개 ${release} 보다 높지 않다`)
    }
  }
  return { ok: true, decision: r as unknown as StageDecision }
}

/**
 * 🔴 **두 러너가 부르는 한 경로.**
 *
 *    ```
 *    ① 읽는다 — 있으면 그대로 쓴다 (계산하지 않는다)
 *    ② 없으면 계산해서 만든다
 *    ③ 만들다 unique 충돌 — 남이 먼저 만들었다는 뜻이다
 *       🔴 **다시 계산하지도 덮지도 않는다. 그 행을 다시 읽어 쓴다.**
 *    ④ 읽기도 실패하면 `UNAVAILABLE` — 부르는 쪽이 가장 안전한 단계로 간다
 *    ```
 *
 * 🔴 **동시 시작에서 누가 이기는가**: 먼저 INSERT 에 성공한 쪽이다. 진 쪽은
 *    자기 계산을 버리고 이긴 행을 읽는다 — 그래야 두 러너가 같은 값을 본다.
 */
export type EnsureSteps = readonly ['read', 'compute', 'insert', 'reread']
export const ENSURE_STEPS: EnsureSteps = ['read', 'compute', 'insert', 'reread']

/**
 * 🔴 **순수 뼈대.** DB 는 부르는 쪽이 넣는다 — 이 파일은 순서만 강제한다.
 *    구현 전에도 이 순서를 검사가 잠근다.
 */
export async function ensureStageDecision(io: {
  /** 🔴 **`unknown` 이다** — 저장소가 무엇을 돌려줄지 약속하지 않는다 */
  read: () => Promise<unknown>
  compute: () => StageDecision
  /** 🔴 unique 충돌이면 `'conflict'` 를 돌려준다 — 예외를 삼키지 않는다 */
  insert: (d: StageDecision) => Promise<'inserted' | 'conflict'>
  /**
   * 🔴 **consumer 와 같은 validator 다** (2026-09-24 6차 · 마스터 지적).
   *    앞판은 controller 가 읽은 행을 **검증 없이** `ok:true` 로 돌려줬다 —
   *    그래서 깨진 행 하나가 그날 결정으로 그대로 쓰였고, 같은 행을 consumer 는
   *    `BROKEN` 으로 거절했다. 두 경로가 서로 다른 답을 냈다는 뜻이다.
   */
  validate: (row: unknown) => ValidateResult
  /** 🔴 controller 하나뿐이다 — 러너는 이 함수를 부르지 않는다 */
  by: DecisionWriter
}): Promise<EnsureOutcome> {
  const broken = (where: string, reason: string): EnsureOutcome =>
    ({ ok: false, code: 'BROKEN', reason: `${where} 행이 계약을 지키지 않는다 — ${reason}` })

  // ① 이미 있으면 그대로 쓴다 — 🔴 다만 **검증한 뒤**다
  const existing = await io.read()
  if (existing !== null && existing !== undefined) {
    const v = io.validate(existing)
    if (!v.ok) return broken('기존', v.reason)
    return { ok: true, decision: v.decision, created: false, by: io.by }
  }

  // ② 계산한다 — 🔴 **넣기 전에** 검증한다. 깨진 값을 저장하면 immutable 이라 되돌릴 수 없다
  const fresh = io.compute()
  const fv = io.validate(fresh)
  if (!fv.ok) return broken('계산한', fv.reason)

  const r = await io.insert(fresh)
  if (r === 'inserted') return { ok: true, decision: fv.decision, created: true, by: io.by }

  // ③ 충돌 — 남이 먼저 만들었다. 🔴 덮지 않고 그 행을 읽고, **그 행도 검증한다**
  const won = await io.read()
  if (won === null || won === undefined) {
    return {
      ok: false, code: 'UNAVAILABLE',
      reason: '유일키 충돌 뒤에도 행을 읽지 못했다 — 가장 안전한 단계로 간다',
    }
  }
  const wv = io.validate(won)
  if (!wv.ok) return broken('충돌 뒤 읽은', wv.reason)
  return { ok: true, decision: wv.decision, created: false, by: io.by }
}

/**
 * 🔴 **제안하는 최소 모델** (구현 전 · migration 없음)
 *
 * ```prisma
 * model StageDecision {
 *   kstDate         String
 *   contractVersion String
 *   capacity        String   // 승인 천장 그대로
 *   release         String
 *   state           String   // SUSTAIN|TRIAL|PREPARE|HOLD
 *   reasons         Json
 *   blocks          Json
 *   decidedBy       String   // 🔴 언제나 'controller' — 러너는 쓰지 않는다
 *   decidedAt       DateTime
 *   createdAt       DateTime @default(now())
 *   @@unique([kstDate, contractVersion])
 * }
 * ```
 * 🔴 **갱신 칼럼이 없다.** immutable 이므로 `revision` 도 `updatedAt` 도 두지 않는다 —
 *    두면 누군가 갱신할 수 있게 되고, 그 순간 하루 결정이 흔들린다.
 * 🔴 **보존 기간 규칙을 두지 않는다.** 지울 근거가 아직 없다 —
 *    근거 없는 삭제 규칙은 나중에 이력을 잃는 쪽으로만 작동한다.
 * 🔴 **rollback 은 `STAGE_CONTROLLER_ENABLED=off`** 다. 그러면 두 러너가
 *    기존 env/canary 경로로 그대로 돌아간다 — 행을 지우거나 판을 되돌리지 않는다.
 */
export const PROPOSED_MODEL_NAME = 'StageDecision'
