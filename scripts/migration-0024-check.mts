#!/usr/bin/env tsx
/**
 * 0024 마이그레이션 **계약 검사** — 🔴 DB 연결 0 · write 0 · 네트워크 0
 *
 * 🔴 **왜 DB 없이 도는가.**
 *    CI 에서 production DB 를 열지 않는다. 그런데 "적용됨 / 일부만 / 못 읽음" 을
 *    한 번도 시험하지 않으면, 실제로 적용하는 날에 처음 돌려 보게 된다.
 *
 *    판정이 순수 함수라서 가짜 metadata 로 네 상태를 전부 시험할 수 있다.
 *    이 스크립트는 그 판정과 **CLI 의 계약**을 함께 잠근다.
 *
 * 🔴 현재 DB 는 미적용이다. 그래서 실제 실행(`--check`)의 기대는 `NOT_APPLIED` +
 *    controlled exit 1 이고, 그 확인은 사람이 로컬에서 한다 — CI 는 DB 를 보지 않는다.
 */
import { readFileSync } from 'node:fs'

import {
  applyWithVerification, judgeMigrationState, judgeProjectRef,
  BASELINE_COLUMNS, BASELINE_INDEXES, MIGRATION_ID,
  MIGRATION_STATES, NEW_COLUMNS, NEW_INDEX, TARGET_TABLE,
} from './lib/migration-0024-state.mjs'

let pass = 0
let fail = 0
const check = (label: string, okv: boolean): void => {
  if (okv) { pass += 1; return }
  fail += 1
  console.log(`  🔴 FAIL  ${label}`)
}

console.log(`\n══ ${MIGRATION_ID} 계약 검사 (🔴 DB 연결 0 · write 0) ══\n`)

const col = (name: string, nullable = 'YES', type = 'text'): {
  column_name: string; data_type: string; is_nullable: string
} => ({ column_name: name, data_type: type, is_nullable: nullable })
const baseCols = BASELINE_COLUMNS.map((c) => col(c, 'NO'))
const baseIdx = [...BASELINE_INDEXES]
const newCols = NEW_COLUMNS.map((c) => col(c))

// ── ① 네 상태가 전부 나온다 ──
const states = {
  NOT_APPLIED: judgeMigrationState({ table: TARGET_TABLE, columns: baseCols, indexes: baseIdx }),
  APPLIED_AND_VALID: judgeMigrationState({
    table: TARGET_TABLE, columns: [...baseCols, ...newCols], indexes: [...baseIdx, NEW_INDEX],
  }),
  PARTIAL_OR_INVALID: judgeMigrationState({
    table: TARGET_TABLE, columns: [...baseCols, col('generatedModel')], indexes: [...baseIdx, NEW_INDEX],
  }),
  OBSERVATION_FAILED: judgeMigrationState({
    table: 'MicroSeedCandidate', columns: baseCols, indexes: baseIdx,
  }),
}
for (const [want, verdict] of Object.entries(states)) {
  check(`${want} 를 그대로 판정한다 (얻은 값 ${verdict.state})`, verdict.state === want)
}
check('네 상태 말고 다른 것을 만들지 않는다',
  Object.values(states).every((v) => (MIGRATION_STATES as readonly string[]).includes(v.state)))

// ── ② exit code 계약 ──
check('적용 완료만 exit 0 이다', states.APPLIED_AND_VALID.exitCode === 0)
check('미적용은 controlled exit 1 이다', states.NOT_APPLIED.exitCode === 1)
check('일부 적용은 exit 1 이다', states.PARTIAL_OR_INVALID.exitCode === 1)
check('관측 실패는 exit 1 이다', states.OBSERVATION_FAILED.exitCode === 1)

// ── ③ 기존 스키마 불변 ──
check('적용 후에도 기존 컬럼 불변을 PASS 한다',
  states.APPLIED_AND_VALID.findings.filter((f) => f.code.startsWith('BASELINE')).every((f) => f.ok))
check('기존 컬럼이 사라지면 잡는다',
  judgeMigrationState({
    table: TARGET_TABLE,
    columns: [...baseCols.filter((c) => c.column_name !== 'dedupKey'), ...newCols],
    indexes: [...baseIdx, NEW_INDEX],
  }).state === 'PARTIAL_OR_INVALID')
check('nullable 이 아니면 잡는다',
  judgeMigrationState({
    table: TARGET_TABLE,
    columns: [...baseCols, ...NEW_COLUMNS.map((c) => col(c, 'NO'))],
    indexes: [...baseIdx, NEW_INDEX],
  }).state === 'PARTIAL_OR_INVALID')
check('인덱스가 없으면 잡는다',
  judgeMigrationState({
    table: TARGET_TABLE, columns: [...baseCols, ...newCols], indexes: baseIdx,
  }).state === 'PARTIAL_OR_INVALID')

/**
 * 🔴 **다른 테이블의 컬럼 이름이 섞이지 않았는가.**
 *    0023(`MicroSeedCandidate`) 스크립트에서 베낀 이름을 기존 컬럼으로 검사하다
 *    없는 컬럼을 조회했고, PostgreSQL 42703 으로 잡히지 않은 채 죽었다.
 */
for (const alien of ['sourceRawContentId', 'draftTitle', 'draftBody', 'createdPostId']) {
  check(`기존 컬럼 목록에 ${alien} 가 없다`, !BASELINE_COLUMNS.includes(alien))
}

// ── ④ 프로젝트 판별 fail-closed ──
const REF = 'buougdxmfobjilgjonby'
check('host 에서 ref 를 읽는다',
  judgeProjectRef({ hostname: `db.${REF}.supabase.co`, username: 'postgres' }, REF).ok)
check('pooler 사용자 이름에서도 읽는다',
  judgeProjectRef({
    hostname: 'aws-0-ap-northeast-2.pooler.supabase.com', username: `postgres.${REF}`,
  }, REF).ok)
const cantRead = judgeProjectRef({ hostname: 'localhost', username: 'postgres' }, REF)
check('둘 다 못 읽으면 fail-closed 다', !cantRead.ok && cantRead.ref === null)
// 🔴 "다른 프로젝트다" 로 뭉개지 않는다 — 조치가 다르다
check('그때 사유가 "판별하지 못했다" 다', cantRead.reason.includes('fail-closed'))
check('다른 프로젝트면 막는다',
  !judgeProjectRef({ hostname: 'db.other.supabase.co', username: 'postgres' }, REF).ok)

// ── ⑤ CLI 계약 — 🔴 소스를 실행하지 않고 분기만 본다 ──
const cli = readFileSync('scripts/apply-migration-0024.mjs', 'utf-8')
const cliCode = cli.split('\n')
  .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
  .join('\n')
check('CLI 가 판정을 스스로 다시 적지 않는다', cliCode.includes('judgeMigrationState('))
check('CLI 가 프로젝트 판별을 정본에 맡긴다', cliCode.includes('judgeProjectRef('))
check('CLI 가 없는 컬럼을 조회하지 않는다', !cli.includes('"createdPostId" IS NOT NULL'))
check('CLI 가 잡히지 않은 오류로 끝나지 않게 한다', cliCode.includes('unhandledRejection'))
check('--apply 없이는 어떤 쓰기도 하지 않는다', (() => {
  // 🔴 트랜잭션은 `applyWithVerification` 안에만 있다. CLI 는 그것을 APPLY 뒤에만 부른다
  const applyAt = cliCode.indexOf('if (!APPLY)')
  const txAt = cliCode.indexOf('applyWithVerification(')
  return applyAt > 0 && txAt > applyAt
})())
check('--check 는 판정 뒤 곧바로 끝난다 (적용 경로로 흘러가지 않는다)',
  /if \(CHECK\)[\s\S]{0,2000}process\.exit\(verdict\.exitCode\)/.test(cliCode))

// ── ⑥ SQL 이 additive 인가 ──
const sql = readFileSync(
  `prisma/migrations/${MIGRATION_ID}/migration.sql`, 'utf-8',
)
check('SQL 이 DROP COLUMN 을 하지 않는다', !/DROP\s+COLUMN/i.test(sql))
check('SQL 이 대상 테이블만 ALTER 한다',
  [...sql.matchAll(/ALTER TABLE\s+"([A-Za-z]+)"/g)].every((m) => m[1] === TARGET_TABLE))
check('SQL 이 세 컬럼을 전부 더한다', NEW_COLUMNS.every((c) => sql.includes(`"${c}"`)))
check('SQL 이 NOT NULL 을 붙이지 않는다', !/ADD COLUMN[^;]*NOT NULL/i.test(sql))
check('SQL 이 인덱스를 만든다', sql.includes(NEW_INDEX))


// ── ⑦ 적용 트랜잭션 — 🔴 COMMIT 전 검증 (가짜 client · 실제 DB 0) ──
/**
 * 🔴 **성공은 "SQL 이 실행됐다" 가 아니라 "COMMIT 전에 postcondition 이 검증됐다" 다.**
 *    옛 순서(`BEGIN → SQL → COMMIT → 검증`)는 검증이 실패해도 되돌릴 수 없었다.
 *    호출 순서와 commit/rollback 횟수를 **행동으로** 센다 — 소스 문자열이 아니라.
 */
type FakeOpts = {
  after?: { table: string | null; columns: unknown; indexes: unknown }
  afterCounts?: Record<string, number | null>
  before?: Record<string, number | null>
  failOn?: string
  observeThrows?: boolean
  countThrows?: boolean
}

const okAfter = {
  table: TARGET_TABLE,
  columns: [...baseCols, ...newCols],
  indexes: [...baseIdx, NEW_INDEX],
}
const COUNTS = { User: 28, Post: 42, Comment: 26, PersonaApprovalQueue: 4 }

const runTx = async (o: FakeOpts = {}): Promise<{
  ok: boolean; committed: number; rolledBack: number; state: string | null
  reason: string; calls: string[]; execed: string[]
}> => {
  const execed: string[] = []
  const r = await applyWithVerification({
    exec: async (text: string, label: string) => {
      execed.push(label)
      if (o.failOn === label) throw new Error(`${label} 실패(가짜)`)
      return {}
    },
    sql: 'ALTER TABLE "PersonaApprovalQueue" ADD COLUMN IF NOT EXISTS "generatedModel" TEXT;',
    observe: async () => {
      if (o.observeThrows === true) throw new Error('관측 실패(가짜)')
      return o.after ?? okAfter
    },
    countTables: async () => {
      if (o.countThrows === true) throw new Error('집계 실패(가짜)')
      return o.afterCounts ?? COUNTS
    },
    beforeCounts: o.before ?? COUNTS,
  })
  return { ...r, execed }
}

// A. 정상 — BEGIN → SQL → 검증 → COMMIT
const txA = await runTx()
check('A 정상: COMMIT 1 · ROLLBACK 0', txA.ok && txA.committed === 1 && txA.rolledBack === 0)
check('A 정상: 순서가 BEGIN → SQL → OBSERVE → COUNT → COMMIT',
  txA.calls.join(',') === 'BEGIN,SQL,OBSERVE,COUNT,COMMIT')
check('A 정상: 검증이 COMMIT 앞에 있다',
  txA.calls.indexOf('OBSERVE') < txA.calls.indexOf('COMMIT')
  && txA.calls.indexOf('COUNT') < txA.calls.indexOf('COMMIT'))
check('A 정상: 상태가 APPLIED_AND_VALID 다', txA.state === 'APPLIED_AND_VALID')

// B. 신규 인덱스 누락 → ROLLBACK
const txB = await runTx({ after: { ...okAfter, indexes: [...baseIdx] } })
check('B 인덱스 누락: COMMIT 0 · ROLLBACK 1',
  !txB.ok && txB.committed === 0 && txB.rolledBack === 1)
check('B 인덱스 누락: COMMIT 을 아예 부르지 않았다', !txB.execed.includes('COMMIT'))
check('B 인덱스 누락: 상태가 PARTIAL_OR_INVALID 다', txB.state === 'PARTIAL_OR_INVALID')

// C. 신규 컬럼 모양 오류(NOT NULL) → ROLLBACK
const txC = await runTx({
  after: { ...okAfter, columns: [...baseCols, ...NEW_COLUMNS.map((c) => col(c, 'NO'))] },
})
check('C 모양 오류: COMMIT 0 · ROLLBACK 1',
  !txC.ok && txC.committed === 0 && txC.rolledBack === 1)
check('C 모양 오류: 사유에 NOT NULL 이 있다', txC.reason.includes('NOT NULL'))

// D. row count 변경 → ROLLBACK
const txD = await runTx({ afterCounts: { ...COUNTS, Comment: 27 } })
check('D row 변경: COMMIT 0 · ROLLBACK 1',
  !txD.ok && txD.committed === 0 && txD.rolledBack === 1)
check('D row 변경: 무엇이 변했는지 말한다', txD.reason.includes('Comment 26→27'))
check('D row 변경: 검증은 통과했지만 COMMIT 하지 않는다', txD.state === 'APPLIED_AND_VALID')

// E. 검증 query 실패 → ROLLBACK
const txE = await runTx({ observeThrows: true })
const txE2 = await runTx({ countThrows: true })
check('E 관측 실패: COMMIT 0 · ROLLBACK 1',
  !txE.ok && txE.committed === 0 && txE.rolledBack === 1)
check('E 관측 실패: OBSERVATION_FAILED 로 남긴다', txE.state === 'OBSERVATION_FAILED')
// 🔴 관측 실패를 빈 metadata 로 바꿔치기하면 사유가 뭉개진다 — 조치가 달라지므로 구별한다
check('E 관측 실패: "검증 관측 실패" 라고 말한다', txE.reason.includes('검증 관측 실패'))
check('E 집계 실패도 같은 사유로 남긴다', txE2.reason.includes('검증 관측 실패'))
check('E 집계 실패도 ROLLBACK', !txE2.ok && txE2.committed === 0 && txE2.rolledBack === 1)

// F. SQL 실패 → ROLLBACK · 관측까지 가지 않는다
const txF = await runTx({ failOn: 'SQL' })
check('F SQL 실패: COMMIT 0 · ROLLBACK 1',
  !txF.ok && txF.committed === 0 && txF.rolledBack === 1)
check('F SQL 실패: 검증을 시도하지 않는다', !txF.calls.includes('OBSERVE'))

// G. COMMIT 실패 → 성공 보고 0
const txG = await runTx({ failOn: 'COMMIT' })
check('G COMMIT 실패: 성공으로 보고하지 않는다', !txG.ok && txG.committed === 0)
check('G COMMIT 실패: 되돌리기를 시도한다', txG.rolledBack === 1)
check('G COMMIT 실패: 사유를 말한다', txG.reason.includes('COMMIT 실패'))

// 🔴 BEGIN 조차 못 열면 되돌릴 것이 없다
const txBegin = await runTx({ failOn: 'BEGIN' })
check('BEGIN 실패: COMMIT 0 · ROLLBACK 0',
  !txBegin.ok && txBegin.committed === 0 && txBegin.rolledBack === 0)
check('BEGIN 실패: SQL 을 실행하지 않는다', !txBegin.execed.includes('SQL'))

// 🔴 ROLLBACK 자체가 실패해도 그 위에서 죽지 않는다
const txRb = await (async () => {
  const execed: string[] = []
  return applyWithVerification({
    exec: async (text: string, label: string) => {
      execed.push(label)
      if (label === 'SQL' || label === 'ROLLBACK') throw new Error(`${label} 실패(가짜)`)
      return {}
    },
    sql: 'ALTER TABLE "x" ADD COLUMN "y" TEXT;',
    observe: async () => okAfter,
    countTables: async () => COUNTS,
    beforeCounts: COUNTS,
  })
})()
check('ROLLBACK 실패해도 예외로 죽지 않는다',
  !txRb.ok && txRb.committed === 0 && txRb.calls.includes('ROLLBACK_FAILED'))

// H. --check · dry-run 은 BEGIN/SQL/COMMIT 이 전부 0 이다
check('H --check·dry-run 은 트랜잭션을 열지 않는다', (() => {
  const applyGate = cliCode.indexOf('if (!APPLY)')
  const txAt = cliCode.indexOf('applyWithVerification(')
  const checkExit = cliCode.indexOf('process.exit(verdict.exitCode)')
  // 🔴 --check 종료와 dry-run 종료가 **둘 다** 트랜잭션 앞에 있다
  return checkExit > 0 && applyGate > 0 && txAt > applyGate && txAt > checkExit
})())
check('H CLI 가 BEGIN/COMMIT 을 직접 쓰지 않는다', (() => {
  // 🔴 트랜잭션 제어는 검증 함수 한 곳에만 있다 — 두 곳이면 순서가 갈린다
  return !/client\.query\('BEGIN'\)/.test(cliCode) && !/client\.query\('COMMIT'\)/.test(cliCode)
})())
check('H 적용 경로가 COMMIT 뒤 검증으로 돌아가지 않았다', (() => {
  const txAt = cliCode.indexOf('applyWithVerification(')
  const tail = cliCode.slice(txAt)
  // 🔴 COMMIT 뒤에 남는 것은 read-only 최종 확인뿐이다
  return !tail.includes("client.query('BEGIN')") && tail.includes('COMMIT 전 검증')
})())

// ── ⑧ 기존 인덱스 기준선이 실측과 같은가 ──
const REAL_INDEXES = [
  'PersonaApprovalQueue_dedupKey_key',
  'PersonaApprovalQueue_personaId_createdAt_idx',
  'PersonaApprovalQueue_pkey',
  'PersonaApprovalQueue_publishedCommentId_key',
  'PersonaApprovalQueue_status_createdAt_idx',
]
check(`기존 인덱스 기준선이 실측 5개와 같다 (${BASELINE_INDEXES.length}개)`,
  BASELINE_INDEXES.length === REAL_INDEXES.length
  && REAL_INDEXES.every((i) => BASELINE_INDEXES.includes(i)))
/**
 * 🔴 **하나씩 빼 본다.** 목록에 적어 두기만 하고 판정이 안 보면 소용없다 —
 *    앞선 판은 조회용 인덱스 둘이 사라져도 "그대로" 라고 말했다.
 */
for (const gone of REAL_INDEXES) {
  const verdict = judgeMigrationState({
    table: TARGET_TABLE,
    columns: [...baseCols, ...newCols],
    indexes: [...baseIdx, NEW_INDEX].filter((i) => i !== gone),
  })
  check(`${gone} 가 사라지면 PARTIAL_OR_INVALID`, verdict.state === 'PARTIAL_OR_INVALID')
}

console.log(`\n  ${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('  🔴 이 검사는 DB 에 연결하지 않았다 — 연결 0 · write 0\n')
process.exit(fail === 0 ? 0 : 1)
