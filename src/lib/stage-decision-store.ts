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
import type { StageDecision } from './stage-ladder'

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
export const DECISION_WRITER = 'controller' as const
export type DecisionWriter = typeof DECISION_WRITER
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
  | { ok: false; code: 'UNAVAILABLE'; reason: string }

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
  read: () => Promise<StageDecision | null>
  /** 🔴 읽은 행이 계약을 지키는가 — 깨졌으면 쓰지 않는다 */
  validate: (d: StageDecision) => { ok: true } | { ok: false; reason: string }
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
  if (row === null) {
    return {
      ok: false, code: 'NO_DECISION', fallback: 'safest',
      reason: '그날 결정이 없다 — 🔴 사후에 만들지 않는다. 가장 안전한 단계로 간다',
    }
  }
  const v = io.validate(row)
  if (!v.ok) {
    return { ok: false, code: 'BROKEN', fallback: 'safest', reason: `저장된 행이 깨졌다 — ${v.reason}` }
  }
  return { ok: true, decision: row }
}

/**
 * 🔴 **저장된 행을 읽을 때 검증한다.** 계약 판·날짜·enum·키·provenance 를 본다 —
 *    깨진 행은 `UNAVAILABLE` 로 처리하고 쓰지 않는다.
 */
export function validateStoredDecision(input: {
  row: StageDecision
  expectKstDate: string
  expectContractVersion: string
  allowedStages: readonly string[]
  allowedStates: readonly string[]
}): { ok: true } | { ok: false; reason: string } {
  const r = input.row
  if (r.contractVersion !== input.expectContractVersion) {
    return { ok: false, reason: `계약 판 ${r.contractVersion} ≠ ${input.expectContractVersion}` }
  }
  if (r.kstDate !== input.expectKstDate) {
    return { ok: false, reason: `날짜 ${r.kstDate} ≠ ${input.expectKstDate}` }
  }
  if (!input.allowedStages.includes(r.capacity) || !input.allowedStages.includes(r.release)) {
    return { ok: false, reason: `모르는 단계 — capacity=${r.capacity} release=${r.release}` }
  }
  if (!input.allowedStates.includes(r.state)) {
    return { ok: false, reason: `모르는 상태 ${r.state}` }
  }
  if (r.decidedAt.trim() === '' || Number.isNaN(Date.parse(r.decidedAt))) {
    return { ok: false, reason: `결정 시각을 읽을 수 없다 — "${r.decidedAt}"` }
  }
  return { ok: true }
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
  read: () => Promise<StageDecision | null>
  compute: () => StageDecision
  /** 🔴 unique 충돌이면 `'conflict'` 를 돌려준다 — 예외를 삼키지 않는다 */
  insert: (d: StageDecision) => Promise<'inserted' | 'conflict'>
  /** 🔴 controller 하나뿐이다 — 러너는 이 함수를 부르지 않는다 */
  by: DecisionWriter
}): Promise<EnsureOutcome> {
  const existing = await io.read()
  // ① 이미 있으면 그대로 쓴다 — 다시 계산하지 않는다
  if (existing !== null) return { ok: true, decision: existing, created: false, by: io.by }

  const fresh = io.compute()
  const r = await io.insert(fresh)
  if (r === 'inserted') return { ok: true, decision: fresh, created: true, by: io.by }

  // ③ 충돌 — 남이 먼저 만들었다. 🔴 덮지 않고 그 행을 읽는다
  const won = await io.read()
  if (won !== null) return { ok: true, decision: won, created: false, by: io.by }
  return {
    ok: false, code: 'UNAVAILABLE',
    reason: '유일키 충돌 뒤에도 행을 읽지 못했다 — 가장 안전한 단계로 간다',
  }
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
