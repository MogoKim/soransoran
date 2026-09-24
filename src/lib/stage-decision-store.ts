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

/** 🔴 결정을 만드는 쪽 — 먼저 도착한 쪽이 만든다 */
export const DECISION_WRITERS = ['supply', 'publish'] as const
export type DecisionWriter = (typeof DECISION_WRITERS)[number]

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
  /** 이 러너가 처음 만들었다 */
  | { ok: true; decision: StageDecision; created: true; by: DecisionWriter }
  /** 이미 있어서 읽었다 — 🔴 다시 계산하지도 덮지도 않는다 */
  | { ok: true; decision: StageDecision; created: false; by: DecisionWriter }
  /**
   * 🔴 **만들지도 읽지도 못했다.** 두 러너는 **가장 안전한 단계**로 간다 —
   *    "모른다" 를 "어제 값" 으로 채우지 않는다.
   */
  | { ok: false; code: 'UNAVAILABLE'; reason: string }

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
 *   decidedBy       String   // supply|publish — 먼저 만든 쪽
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
