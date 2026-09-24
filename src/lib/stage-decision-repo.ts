/**
 * 🔴 **StageDecision 저장 adapter — `create` 와 `read` 뿐이다** (2026-09-25)
 *
 * 🔴 **불변(immutable)은 app-level 계약이다.** Postgres 는 이 표를 append-only 로
 *    알지 못한다 — `UPDATE`·`DELETE` 는 그대로 돈다. `updatedAt` 칼럼을 두지 않은 것은
 *    그 계약의 **표시**이지 강제가 아니다.
 *    🔴 실제로 지키는 것은 **이 파일이 그 경로를 아예 내주지 않는 것**이다.
 *    `update`·`upsert`·`updateMany`·`delete`·`deleteMany` 를 여기서 부르지 않는다.
 *    `stage:ladder-check` 가 이 파일에서 그 호출이 0 인지 본다.
 *
 * 🔴 **왜 덮어쓰지 않는가.** 아침에 d5 로 낸 글이 낮의 d3 결정 아래에서 상한 초과가
 *    된다. 하루 결정은 최초 확정 뒤 바뀌지 않는다.
 *
 * 🔴 **JSON 칼럼은 `NOT NULL` 이고, 값이 없으면 JSON `null` 이다.**
 *    Prisma 는 `DbNull`(칼럼이 SQL NULL)과 `JsonNull`(값이 JSON `null`)을 구분한다.
 *    계약은 "키는 언제나 있고, 값이 없으면 JSON `null`" 이므로 **`JsonNull` 하나만** 쓴다.
 *    🔴 `DbNull` 은 이제 **DB 가 거절한다**(`JSONB NOT NULL`) — app 을 우회해도 못 들어간다.
 *    🔴 읽을 때 `undefined` 를 `null` 로 **메우지 않는다**. 메우면 select 가 칼럼을
 *       빠뜨린 행이 "값 없음" 으로 통과한다(fail-open).
 *
 * 🔴 이 파일은 아직 **아무도 부르지 않는다.** `STAGE_CONTROLLER_ENABLED` 가 꺼져 있고
 *    controller job·supply·publish 배선은 승인되지 않았다.
 *    검사가 이 파일을 import 하는 production 파일이 0개임을 잠근다.
 *
 * 🔴 **되돌리기는 flag OFF 다(runtime rollback).** 표를 지우는 것(schema rollback)은
 *    결정 이력을 잃는 별개의 일이고, 평소에는 할 이유가 없다.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

import {
  validateStoredDecision,
  type StageDecision, type ValidatedStageDecision, type ValidateResult,
} from './stage-decision-contract'

/** 🔴 이 표를 쓰는 데 필요한 최소 면 — 전체 `PrismaClient` 를 요구하지 않는다 */
export type StageDecisionDb = Pick<PrismaClient, 'stageDecision'>

/** 🔴 DB 행 → validator 입력. `decidedAt` 은 DateTime 이라 되돌려 찍는다 */
export function rowToValidatorInput(row: {
  kstDate: string
  contractVersion: string
  capacity: string
  release: string
  state: string
  reasons: Prisma.JsonValue
  blocks: Prisma.JsonValue
  dayPinned: boolean
  supply: Prisma.JsonValue | null
  transition: Prisma.JsonValue | null
  decidedBy: string
  decidedAt: Date
}): unknown {
  return {
    kstDate: row.kstDate,
    contractVersion: row.contractVersion,
    capacity: row.capacity,
    release: row.release,
    state: row.state,
    reasons: row.reasons,
    blocks: row.blocks,
    dayPinned: row.dayPinned,
    /**
     * 🔴 **`undefined` 를 `null` 로 메우지 않는다** (2026-09-25 · 스스로 되돌림).
     *
     *    처음엔 `?? null` 로 정규화했다. 그러면 **select 에서 칼럼이 빠진 행**이
     *    "supply 가 없는 정상 행" 으로 통과한다 — fail-open 이다.
     *    빠진 칼럼과 "값이 없음" 은 다른 사실이고, 앞쪽은 읽기가 잘못된 것이다.
     *    🔴 그대로 넘겨 validator 가 **필수 키 누락**으로 거절하게 둔다.
     *    정상 경로(`findUnique`)는 JSON `null` 을 `null` 로 주므로 아무것도 깨지지 않는다.
     */
    supply: row.supply,
    transition: row.transition,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt.toISOString(),
  }
}

/**
 * 🔴 **검증된 값만 저장 입력으로 만든다** (2026-09-25 마스터 지적).
 *    앞판은 `StageDecision` 을 받았다 — 계산만 하고 검증을 지나지 않은 객체도
 *    그대로 저장 입력이 됐다. 저장은 되돌릴 수 없다(immutable). 경계를 좁힌다.
 *
 * 🔴 `supply`·`transition` 이 `null` 이면 **`Prisma.JsonNull`** 로 쓴다 —
 *    `DbNull` 은 칼럼을 SQL NULL 로 만들고, 그 칼럼은 `NOT NULL` 이라 DB 가 거절한다.
 */
export function decisionToCreateInput(d: ValidatedStageDecision): Prisma.StageDecisionCreateInput {
  return {
    kstDate: d.kstDate,
    contractVersion: d.contractVersion,
    capacity: d.capacity,
    release: d.release,
    state: d.state,
    reasons: d.reasons as unknown as Prisma.InputJsonValue,
    blocks: d.blocks as unknown as Prisma.InputJsonValue,
    dayPinned: d.dayPinned,
    supply: d.supply === null
      ? Prisma.JsonNull
      : (d.supply as unknown as Prisma.InputJsonValue),
    transition: d.transition === null
      ? Prisma.JsonNull
      : (d.transition as unknown as Prisma.InputJsonValue),
    decidedBy: d.decidedBy,
    decidedAt: new Date(d.decidedAt),
  }
}

/** 🔴 유일키 충돌 — 남이 먼저 만들었다는 뜻이다 */
const isUniqueConflict = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

/**
 * 🔴 **읽기.** 행이 없으면 `null`, 있으면 **검증한 값**을 돌려준다.
 *    읽은 원본을 그대로 흘리지 않는다 — validator 가 새 객체를 만들고 깊게 언다.
 */
export async function readStageDecision(
  db: StageDecisionDb, kstDate: string,
): Promise<{ found: false } | { found: true; result: ValidateResult }> {
  const row = await db.stageDecision.findUnique({ where: { kstDate } })
  if (row === null) return { found: false }
  return { found: true, result: validateStoredDecision({ row: rowToValidatorInput(row), expectKstDate: kstDate }) }
}

/**
 * 🔴 **저장 경계다.** 나가는 길은 여기 하나뿐이고, 여기서 막히면 DB 에 닿지 않는다.
 */
export type CreateOutcome =
  /** 새 행을 만들었다 */
  | 'inserted'
  /** 유일키 충돌 — 남이 먼저 만들었다. 부르는 쪽이 승자 행을 다시 읽는다 */
  | 'conflict'
  /** 🔴 계약을 지키지 않는 값이다 — **`create` 를 부르지 않았다** */
  | 'rejected'

/**
 * 🔴 **만들기 — `create` 뿐이다. `upsert` 를 쓰지 않는다.**
 *    `upsert` 는 기존 행을 덮어쓴다. 그것이 정확히 막으려는 일이다.
 *
 * 🔴 **타입은 실수를 막을 뿐 공격을 막지 못한다** — assertion 으로 brand 를 통과시킬 수
 *    있다. 그래서 저장 직전에 **정본 validator 를 한 번 더** 지난다. 통과하지 못하면
 *    `create` 를 **부르지 않고** `'rejected'` 를 낸다. 저장은 되돌릴 수 없으므로
 *    "일단 넣고 나중에 고친다" 가 없다.
 */
export async function createStageDecision(
  db: StageDecisionDb, d: ValidatedStageDecision,
): Promise<CreateOutcome> {
  const v = validateStoredDecision({ row: d, expectKstDate: d.kstDate })
  if (!v.ok) return 'rejected'
  try {
    // 🔴 검증기가 만든 **불변 사본**을 넣는다 — 들어온 객체를 그대로 쓰지 않는다
    await db.stageDecision.create({ data: decisionToCreateInput(v.decision) })
    return 'inserted'
  } catch (e) {
    if (isUniqueConflict(e)) return 'conflict'
    throw e
  }
}

/**
 * 🔴 **`ensureStageDecision` 이 쓰는 입출력 묶음.** 저장 계약(순서)은
 *    `stage-decision-store` 에 있고, 이 파일은 그 계약에 Prisma 를 끼워 넣기만 한다.
 *    🔴 `validate` 는 정본 하나다 — controller 와 consumer 가 같은 함수를 쓴다.
 */
export function stageDecisionIo(db: StageDecisionDb, kstDate: string): {
  read: () => Promise<unknown>
  /** 🔴 **검증된 값만 받는다** — 계산만 한 객체는 타입에서 막힌다 */
  insert: (d: ValidatedStageDecision) => Promise<CreateOutcome>
  validate: (row: unknown) => ValidateResult
} {
  return {
    read: async () => {
      const row = await db.stageDecision.findUnique({ where: { kstDate } })
      return row === null ? null : rowToValidatorInput(row)
    },
    insert: (d) => createStageDecision(db, d),
    validate: (row) => validateStoredDecision({ row, expectKstDate: kstDate }),
  }
}
