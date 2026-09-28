/**
 * 🔴 **하루 StageDecision 저장 — 계약과 순서** (2026-09-25 갱신)
 *
 *   이 파일은 **순서만** 정의한다: 읽고 · 없으면 계산하고 · 넣고 · 충돌이면 다시 읽는다.
 *   Prisma 는 `stage-decision-repo` 가 끼워 넣고, 검증은 `stage-decision-contract` 가 한다.
 *
 * 🔴 **지금 상태** (2026-09-28 read-only 확인) — 운영 DB 에 `StageDecision` 표가 **있고 행은 0** 이다.
 *    controller(`scripts/stage-controller.mts`) · consumer 감싸기(`scripts/stage-consume-exec.mts`)가
 *    이 순서를 부른다. 🔴 `STAGE_CONTROLLER_ENABLED` 는 정본 env 에 없다(꺼짐) — 켜기 전까지
 *    controller 는 저장하지 않고 consumer 는 legacy 로 그대로 통과한다.
 *
 * 🔴 **왜 저장이 필요한가.** 공급(로컬 launchd)과 발행(GitHub Actions)은 서로 다른
 *    env 원천을 읽는다. 2026-09-24 에 canonical d3 · GitHub d5 로 갈려 하루가 갔다.
 *    두 러너가 **같은 행 하나**를 읽어야 그 일이 다시 나지 않는다.
 *
 * 🔴 **하루 결정은 최초 확정 뒤 바뀌지 않는다(immutable) — app-level 계약이다.**
 *    DB 가 막아 주지 않는다. 저장 adapter 가 create/read 만 내주는 것으로 지킨다.
 *    바뀌면 아침에 d5 로 낸 글이 낮의 d3 결정 아래에서 상한 초과가 된다.
 *    그래서 갱신·덮어쓰기가 없다 — `ensureStageDecision` 은 **만들거나 읽거나** 둘뿐이다.
 */
/**
 * 🔴 **검증은 계약 정본 한 벌뿐이다** (2026-09-24 7차).
 *    앞판은 이 파일이 validator 를 들고 있었다 — 그래서 `stage-ladder` 가 그것을
 *    부를 수 없었고(순환 import), 사다리는 자기만의 얕은 검사를 따로 했다.
 *    지금은 양쪽이 `stage-decision-contract` 를 향한다.
 */
import {
  DECISION_WRITER, STAGE_DECISION_VERSION, validateStoredDecision,
  type StageDecision, type ValidatedStageDecision, type ValidateResult, type DecisionWriter,
} from './stage-decision-contract'


export { DECISION_WRITER, STAGE_DECISION_VERSION, validateStoredDecision }
export type { DecisionWriter, ValidatedStageDecision, ValidateResult }

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
 * 🔴 **유일키는 KST 날짜 하나다** (2026-09-24 7차 · 마스터 지적).
 *
 *    앞판은 `(kstDate, contractVersion)` 이었다. 그러면 **같은 날 판을 올리는 순간
 *    두 번째 행이 만들어진다** — 하루 결정이 둘이 되고, 아침에 옛 판으로 낸 글과
 *    낮에 새 판으로 낸 글이 서로 다른 상한 아래 놓인다. immutable 이 깨지는 것이다.
 *    🔴 하루에 결정은 하나다. 같은 날 판이 달라지면 **두 번째 행을 만들지 않고**
 *    fail-closed(`BROKEN`) 로 간다 — 그러면 consumer 는 legacy/가장 안전한 단계로 간다.
 */
export type DecisionKey = { kstDate: string }

export const decisionKeyOf = (d: StageDecision): DecisionKey => ({ kstDate: d.kstDate })

export type EnsureOutcome =
  /** controller 가 그날 결정을 만들었다 */
  | { ok: true; decision: ValidatedStageDecision; created: true; by: DecisionWriter }
  /** 이미 있어서 읽었다 — 🔴 다시 계산하지도 덮지도 않는다 */
  | { ok: true; decision: ValidatedStageDecision; created: false; by: DecisionWriter }
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
  | { ok: true; decision: ValidatedStageDecision }
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
 *    배선 전에도 이 순서를 검사가 잠근다.
 */
export async function ensureStageDecision(io: {
  /** 🔴 **`unknown` 이다** — 저장소가 무엇을 돌려줄지 약속하지 않는다 */
  read: () => Promise<unknown>
  compute: () => StageDecision
  /**
   * 🔴 **검증된 값만 받는다** (2026-09-25 마스터 지적).
   *    앞판은 `StageDecision` 을 받았고, 이 함수는 **검증 전 원본 `fresh`** 를 넘겼다 —
   *    validator 가 만든 불변 사본이 아니라 계산기가 들고 있던 그 객체였다.
   *    계산기가 나중에 그 객체를 바꾸면 저장된 값과 갈린다.
   * 🔴 unique 충돌이면 `'conflict'`, 계약 위반이면 `'rejected'` 를 돌려준다 —
   *    예외를 삼키지 않는다.
   */
  insert: (d: ValidatedStageDecision) => Promise<'inserted' | 'conflict' | 'rejected'>
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

  /**
   * 🔴 **`fresh` 가 아니라 `fv.decision` 을 넣는다** (2026-09-25 마스터 지적).
   *    앞판은 검증 전 원본을 넘겼다. 그 객체는 계산기가 여전히 참조를 들고 있고
   *    얼어 있지도 않다 — 저장된 값과 검증한 값이 **다른 객체**였다.
   *    `fv.decision` 은 검증기가 검증한 필드만으로 새로 만들어 깊게 언 값이다.
   */
  const r = await io.insert(fv.decision)
  if (r === 'rejected') return broken('저장 직전 다시 검증한', '저장 경계가 거절했다')
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
 * 🔴 **구현된 모델** (`prisma/schema.prisma` · migration `0028_stage_decision`)
 *
 *   🔴 아래는 **정본이 아니라 읽기용 사본**이다. 정본은 `schema.prisma` 이고,
 *      검사가 그 파일을 직접 읽어 칸이 빠지지 않았는지 본다.
 *
 *   🔴 **validator 가 요구하는 값을 손실 없이 담는다.** 앞판 제안에는
 *      `dayPinned`·`supply`·`transition` 칸이 없었다 — 그 모델로 저장하면
 *      다시 읽을 때 `validateStoredDecision` 이 **전부 거절**한다.
 *      저장할 수 없는 계약은 계약이 아니다.
 *
 * ```prisma
 * model StageDecision {
 *   /// 🔴 유일키다 — 하루에 결정은 하나뿐이다
 *   kstDate         String   @id
 *   contractVersion String
 *   capacity        String   // 승인 천장 그대로 (d1|d3|d5|d10)
 *   release         String   // 🔴 release rank <= capacity rank
 *   state           String   // SUSTAIN|TRIAL|PREPARE|HOLD
 *   reasons         Json     // string[]
 *   blocks          Json     // { code: BlockCode, reason: string }[]
 *   /// 🔴 그날 단계를 고정했는가 — 없으면 읽을 때 검증이 막힌다
 *   dayPinned       Boolean
 *   /// 🔴 **필수 칼럼이다.** 값이 없으면 JSON `null` — SQL NULL 은 DB 가 거절한다
 *   supply          Json
 *   /// 🔴 필수 칼럼. TRIAL/SUSTAIN 이면 구조가 있고 나머지는 JSON `null`
 *   transition      Json
 *   decidedBy       String   // 🔴 언제나 'controller'
 *   decidedAt       DateTime // 🔴 그 KST 날짜 안이어야 한다
 *   createdAt       DateTime @default(now())
 * }
 * ```
 *
 * 🔴 **유일키가 `@@unique([kstDate, contractVersion])` 이 아니다.**
 *    그 키는 **같은 날 판을 올리면 두 번째 행**을 허용한다. 그러면 하루 결정이 둘이 되고,
 *    아침에 옛 판으로 낸 글과 낮에 새 판으로 낸 글이 서로 다른 상한 아래 놓인다.
 *    🔴 `kstDate` 를 기본키로 둬 **KST 날짜당 하나**를 DB 가 강제한다.
 *    같은 날 판이 달라지면 두 번째 행을 만들지 않는다 — 읽은 행의 판이 현재 판과
 *    다르므로 `validateStoredDecision` 이 거절하고, `ensureStageDecision` 은 `BROKEN`,
 *    consumer 는 legacy 또는 가장 안전한 단계로 간다(fail-closed).
 *
 * 🔴 **JSON 왕복이 검증을 통과해야 한다.** `decidedAt` 은 DateTime 이므로 읽을 때
 *    `toISOString()` 으로 되돌린다 — 그 문자열의 KST 날짜가 `kstDate` 와 같아야 한다.
 *    격리 DB 에서 실제로 왕복시켜 값 손실 0 을 확인했다(`stage:db-check`).
 *
 * 🔴 **불변은 app-level 계약이다 — 칼럼을 안 두는 것으로 지켜지지 않는다**
 *    (2026-09-25 마스터 정정). 앞판은 "`updatedAt` 이 없어서 immutable" 이라고 적었다.
 *    **사실이 아니다.** `updatedAt` 이 없어도 `UPDATE`·`upsert`·`deleteMany` 는 그대로
 *    돈다. Postgres 는 이 표를 append-only 로 알지 못한다.
 *    🔴 실제로 불변을 지키는 것은 **저장 adapter 가 create/read 만 제공하는 것**이다:
 *      · `stage-decision-repo` 에 `update`·`upsert`·`delete*` 경로가 **하나도 없다**
 *      · 검사가 그 파일에서 해당 호출을 찾아 0 인지 본다(변이로 확인)
 *      · `kstDate` 기본키가 **같은 날 두 번째 행**을 DB 수준에서 막는다
 *    `revision`·`updatedAt` 칼럼을 두지 않는 것은 그 계약의 **표시**이지 강제가 아니다.
 * 🔴 **보존 기간 규칙을 두지 않는다.** 지울 근거가 아직 없다.
 * 🔴 **rollback 은 `STAGE_CONTROLLER_ENABLED=off`** 다 — 행을 지우거나 판을 되돌리지 않는다.
 */
export const PROPOSED_MODEL_NAME = 'StageDecision'

/**
 * 🔴 **저장 ↔ 검증 왕복.** 모델이 값을 잃지 않는지 코드로 고정한다 —
 *    주석으로만 적으면 칸 하나가 빠져도 아무도 모른다.
 */
export const STORED_COLUMNS = [
  'kstDate', 'contractVersion', 'capacity', 'release', 'state',
  'reasons', 'blocks', 'dayPinned', 'supply', 'transition', 'decidedBy', 'decidedAt',
] as const

/** 🔴 DB 행 모양 → 검증 입력. `decidedAt` 은 DateTime 이라 되돌려 찍는다 */
export function rowToDecisionInput(row: {
  kstDate: string; contractVersion: string; capacity: string; release: string; state: string
  reasons: unknown; blocks: unknown; dayPinned: boolean; supply: unknown; transition: unknown
  decidedBy: string; decidedAt: Date
}): unknown {
  return { ...row, decidedAt: row.decidedAt.toISOString() }
}

/** 🔴 결정 → DB 행 모양. 칸이 빠지면 왕복 검사가 빨개진다 */
export function decisionToRow(d: StageDecision): {
  kstDate: string; contractVersion: string; capacity: string; release: string; state: string
  reasons: unknown; blocks: unknown; dayPinned: boolean; supply: unknown; transition: unknown
  decidedBy: string; decidedAt: Date
} {
  return {
    kstDate: d.kstDate, contractVersion: d.contractVersion,
    capacity: d.capacity, release: d.release, state: d.state,
    reasons: d.reasons, blocks: d.blocks, dayPinned: d.dayPinned,
    supply: d.supply, transition: d.transition,
    decidedBy: d.decidedBy, decidedAt: new Date(d.decidedAt),
  }
}
