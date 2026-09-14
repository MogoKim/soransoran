#!/usr/bin/env tsx
/**
 * 0025 마이그레이션 **계약 검사** — 🔴 DB 연결 0 · write 0 · 네트워크 0
 *
 * 🔴 **왜 DB 없이 도는가.**
 *    CI 에서 production DB 를 열지 않는다. 그런데 "적용됨 / 일부만 / 못 읽음" 을
 *    한 번도 시험하지 않으면, 실제로 적용하는 날에 처음 돌려 보게 된다.
 *
 *    판정이 순수 함수라서 가짜 metadata 로 네 상태를 전부 시험할 수 있다.
 *    트랜잭션도 가짜 client 로 돌려 COMMIT·ROLLBACK 횟수를 **행동으로** 센다.
 *
 * 🔴 0025 는 **테이블 자체를 만든다.** 그래서 0024 와 결정적으로 다른 것이 하나 있다 —
 *    테이블이 없는 것이 오류가 아니라 `NOT_APPLIED` 라는 정상 상태다.
 *    그리고 enum 만 있거나 테이블만 있는 **반쪽 상태**가 실제로 존재할 수 있다.
 *    그 구분을 이 파일이 잠근다.
 *
 * 🔴 현재 DB 는 미적용이다. 실제 실행(`--check`)의 기대는 `NOT_APPLIED` +
 *    controlled exit 1 이고, 그 확인은 사람이 로컬에서 한다 — CI 는 DB 를 보지 않는다.
 */
import { readFileSync } from 'node:fs'

import { applyWithVerification, judgeProjectRef } from './lib/migration-0024-state.mjs'
import {
  ENUM_LABELS,
  EXPECTED_COLUMNS,
  EXPECTED_FOREIGN_KEYS,
  EXPECTED_INDEXES,
  EXPECTED_INDEX_SPECS,
  MIGRATION_ID,
  MIGRATION_STATES,
  NEW_ENUM,
  NEW_TABLE,
  PROTECTED_TABLES,
  SQL_CREATE_INDEX_SPECS,
  judgeMigration0025Sql,
  judgeMigration0025State,
  judgeProtectedCounts,
} from './lib/migration-0025-state.mjs'

let pass = 0
let fail = 0
const check = (label: string, okv: boolean): void => {
  if (okv) { pass += 1; return }
  fail += 1
  console.log(`  🔴 FAIL  ${label}`)
}

console.log(`\n══ ${MIGRATION_ID} 계약 검사 (🔴 DB 연결 0 · write 0) ══\n`)

// ─────────── 가짜 metadata 만들기 ───────────

type ColumnMeta = {
  column_name: string
  data_type: string
  udt_name?: string
  is_nullable: string
  column_default: string | null
}

/** 계약 그대로인 컬럼 16개. 테스트마다 한 곳만 어긋뜨린다. */
function goodColumns(): ColumnMeta[] {
  return EXPECTED_COLUMNS.map((c) => ({
    column_name: c.name,
    data_type: c.dataType,
    udt_name: c.udtName ?? c.dataType,
    is_nullable: c.nullable ? 'YES' : 'NO',
    column_default:
      c.defaultContains === null
        ? null
        : c.name === 'linkKind'
          ? `'NONE'::"HeroBannerLinkKind"`
          : c.name === 'isActive'
            ? 'false'
            : 'CURRENT_TIMESTAMP',
  }))
}

/**
 * 인덱스 관측값 — 🔴 이름뿐 아니라 컬럼·순서·primary·unique 까지.
 *    앞선 판은 이름 문자열 배열이었다. 그래서 같은 이름·다른 컬럼이 통과했다.
 */
function goodIndexes() {
  return EXPECTED_INDEX_SPECS.map((i) => ({
    name: i.name,
    table: NEW_TABLE,
    columns: [...i.columns],
    isPrimary: i.primary,
    isUnique: i.unique,
  }))
}

function goodForeignKeys() {
  return EXPECTED_FOREIGN_KEYS.map((f) => ({
    conname: f.name,
    column: f.column,
    referencedTable: f.referencedTable,
    referencedColumn: f.referencedColumn,
    confdeltype: f.onDelete,
    confupdtype: f.onUpdate,
  }))
}

/** 완전히 적용된 상태. `over` 로 한 부분만 바꿔 실패 사례를 만든다. */
function applied(over: Record<string, unknown> = {}) {
  return {
    table: NEW_TABLE,
    enumLabels: [...ENUM_LABELS],
    columns: goodColumns(),
    indexes: goodIndexes(),
    foreignKeys: goodForeignKeys(),
    rowCount: 0,
    ...over,
  }
}

const NOTHING = {
  table: null, enumLabels: null, columns: null,
  indexes: null, foreignKeys: null, rowCount: null,
}

const state = (input: unknown): string =>
  judgeMigration0025State(input as Parameters<typeof judgeMigration0025State>[0]).state

// ── ① 네 상태가 전부 나온다 ──
console.log('── ① 네 상태')
check('상태 목록이 넷이다', MIGRATION_STATES.length === 4)
check('아무것도 없으면 NOT_APPLIED', state(NOTHING) === 'NOT_APPLIED')
check('전부 있으면 APPLIED_AND_VALID', state(applied()) === 'APPLIED_AND_VALID')
check('관측값이 없으면 OBSERVATION_FAILED', state(null) === 'OBSERVATION_FAILED')
check('다른 테이블이면 OBSERVATION_FAILED',
  state({ ...NOTHING, table: 'Post' }) === 'OBSERVATION_FAILED')
check('테이블은 있는데 컬럼을 못 읽으면 OBSERVATION_FAILED',
  state(applied({ columns: null })) === 'OBSERVATION_FAILED')
check('테이블은 있는데 컬럼이 0개면 OBSERVATION_FAILED',
  state(applied({ columns: [] })) === 'OBSERVATION_FAILED')
check('컬럼 metadata 모양이 아니면 OBSERVATION_FAILED',
  state(applied({ columns: [{ nope: 1 }] })) === 'OBSERVATION_FAILED')

// ── ② 반쪽 상태를 뭉개지 않는다 ──
console.log('── ② 반쪽 상태 (🔴 0025 의 핵심)')
check('🔴 enum 만 있으면 PARTIAL_OR_INVALID (NOT_APPLIED 아님)',
  state({ ...NOTHING, enumLabels: [...ENUM_LABELS] }) === 'PARTIAL_OR_INVALID')
check('🔴 테이블만 있고 enum 이 없으면 PARTIAL_OR_INVALID',
  state(applied({ enumLabels: null })) === 'PARTIAL_OR_INVALID')
check('enum 만 있는 상태를 "이미 적용됨" 으로 보지 않는다',
  state({ ...NOTHING, enumLabels: [...ENUM_LABELS] }) !== 'APPLIED_AND_VALID')

// ── ③ 컬럼 16개 ──
console.log('── ③ 컬럼 16개')
check('🔴 계약 컬럼은 정확히 16개다', EXPECTED_COLUMNS.length === 16)
check('컬럼 이름이 중복되지 않는다',
  new Set(EXPECTED_COLUMNS.map((c) => c.name)).size === EXPECTED_COLUMNS.length)
for (const c of EXPECTED_COLUMNS) {
  check(`컬럼 하나(${c.name})가 빠지면 PARTIAL_OR_INVALID`,
    state(applied({ columns: goodColumns().filter((g) => g.column_name !== c.name) })) === 'PARTIAL_OR_INVALID')
}
check('예상 밖 컬럼이 있으면 PARTIAL_OR_INVALID',
  state(applied({ columns: [...goodColumns(), { column_name: 'campaignId', data_type: 'text', udt_name: 'text', is_nullable: 'YES', column_default: null }] })) === 'PARTIAL_OR_INVALID')

// ── ④ 잘못된 타입·nullable·default ──
console.log('── ④ 컬럼 모양')
const bend = (name: string, patch: Partial<ColumnMeta>) =>
  goodColumns().map((c) => (c.column_name === name ? { ...c, ...patch } : c))

check('sortOrder 가 text 면 잡는다',
  state(applied({ columns: bend('sortOrder', { data_type: 'text', udt_name: 'text' }) })) === 'PARTIAL_OR_INVALID')
check('🔴 name 이 nullable 이면 잡는다',
  state(applied({ columns: bend('name', { is_nullable: 'YES' }) })) === 'PARTIAL_OR_INVALID')
check('🔴 mobileImageKey 가 NOT NULL 이면 잡는다 — 초안 저장이 막힌다',
  state(applied({ columns: bend('mobileImageKey', { is_nullable: 'NO' }) })) === 'PARTIAL_OR_INVALID')
check('isActive 의 default 가 없으면 잡는다',
  state(applied({ columns: bend('isActive', { column_default: null }) })) === 'PARTIAL_OR_INVALID')
check('🔴 isActive 의 default 가 true 면 잡는다 — 만들자마자 노출된다',
  state(applied({ columns: bend('isActive', { column_default: 'true' }) })) === 'PARTIAL_OR_INVALID')
check('createdAt 의 default 가 없으면 잡는다',
  state(applied({ columns: bend('createdAt', { column_default: null }) })) === 'PARTIAL_OR_INVALID')
check('linkKind 가 enum 이 아니면 잡는다',
  state(applied({ columns: bend('linkKind', { data_type: 'text', udt_name: 'text' }) })) === 'PARTIAL_OR_INVALID')
check('linkKind 의 udt 이름이 다르면 잡는다',
  state(applied({ columns: bend('linkKind', { udt_name: 'OtherEnum' }) })) === 'PARTIAL_OR_INVALID')
check('🔴 linkKind 의 default 가 NONE 이 아니면 잡는다',
  state(applied({ columns: bend('linkKind', { column_default: `'EXTERNAL'::"HeroBannerLinkKind"` }) })) === 'PARTIAL_OR_INVALID')
check('default 에 캐스팅이 붙어 있어도 통과한다 (Postgres 표기)',
  state(applied()) === 'APPLIED_AND_VALID')
check('archivedAt 이 timestamp 가 아니면 잡는다',
  state(applied({ columns: bend('archivedAt', { data_type: 'text', udt_name: 'text' }) })) === 'PARTIAL_OR_INVALID')

// ── ⑤ enum 값과 순서 ──
console.log('── ⑤ enum')
check('enum 라벨이 셋이다', ENUM_LABELS.length === 3)
check('enum 값이 모자라면 잡는다',
  state(applied({ enumLabels: ['NONE', 'INTERNAL'] })) === 'PARTIAL_OR_INVALID')
check('enum 에 없는 값이 섞이면 잡는다',
  state(applied({ enumLabels: ['NONE', 'INTERNAL', 'POPUP'] })) === 'PARTIAL_OR_INVALID')
check('🔴 enum 순서가 다르면 잡는다 — 정렬 결과가 달라진다',
  state(applied({ enumLabels: ['INTERNAL', 'NONE', 'EXTERNAL'] })) === 'PARTIAL_OR_INVALID')

// ── ⑥ 인덱스 4개 (PK 포함) ──
console.log('── ⑥ 인덱스')
check('🔴 인덱스 계약은 PK 포함 4개다', EXPECTED_INDEXES.length === 4)
check('PK 가 목록에 있다', EXPECTED_INDEXES.includes('HeroBanner_pkey'))
for (const i of EXPECTED_INDEXES) {
  check(`인덱스 하나(${i})가 없으면 PARTIAL_OR_INVALID`,
    state(applied({ indexes: goodIndexes().filter((x) => x.name !== i) })) === 'PARTIAL_OR_INVALID')
}

// ── ⑦ FK 2개 · 참조와 삭제 동작 ──
console.log('── ⑦ FK')
check('FK 계약은 2개다', EXPECTED_FOREIGN_KEYS.length === 2)
check('두 FK 모두 User.id 를 본다',
  EXPECTED_FOREIGN_KEYS.every((f) => f.referencedTable === 'User' && f.referencedColumn === 'id'))
check('FK 가 하나만 있으면 잡는다',
  state(applied({ foreignKeys: goodForeignKeys().slice(0, 1) })) === 'PARTIAL_OR_INVALID')
check('FK 가 없으면 잡는다',
  state(applied({ foreignKeys: [] })) === 'PARTIAL_OR_INVALID')
check('🔴 ON DELETE 가 CASCADE 면 잡는다 — 운영자 탈퇴가 배너를 지운다',
  state(applied({ foreignKeys: goodForeignKeys().map((f) => ({ ...f, confdeltype: 'c' })) })) === 'PARTIAL_OR_INVALID')
check('ON DELETE 가 RESTRICT 여도 잡는다',
  state(applied({ foreignKeys: goodForeignKeys().map((f) => ({ ...f, confdeltype: 'r' })) })) === 'PARTIAL_OR_INVALID')
check('ON UPDATE 가 CASCADE 가 아니면 잡는다',
  state(applied({ foreignKeys: goodForeignKeys().map((f) => ({ ...f, confupdtype: 'a' })) })) === 'PARTIAL_OR_INVALID')
check('🔴 다른 테이블을 참조하면 잡는다',
  state(applied({ foreignKeys: goodForeignKeys().map((f) => ({ ...f, referencedTable: 'Post' })) })) === 'PARTIAL_OR_INVALID')
check('예상 밖 FK 가 있으면 잡는다',
  state(applied({ foreignKeys: [...goodForeignKeys(), { conname: 'HeroBanner_postId_fkey', column: 'postId', referencedTable: 'Post', referencedColumn: 'id', confdeltype: 'n', confupdtype: 'c' }] })) === 'PARTIAL_OR_INVALID')

// ── ⑧ 빈 테이블로 만들어졌는가 ──
console.log('── ⑧ 행 수')
check('0행이면 통과', state(applied({ rowCount: 0 })) === 'APPLIED_AND_VALID')
check('🔴 행이 있으면 잡는다 — 이 마이그레이션은 행을 만들지 않는다',
  state(applied({ rowCount: 1 })) === 'PARTIAL_OR_INVALID')
check('행 수를 못 읽으면 OBSERVATION_FAILED',
  state(applied({ rowCount: 'many' })) === 'OBSERVATION_FAILED')

// ── ⑨ exit code 계약 ──
console.log('── ⑨ exit code')
const verdictOf = (input: unknown) =>
  judgeMigration0025State(input as Parameters<typeof judgeMigration0025State>[0])
check('APPLIED_AND_VALID 는 exit 0', verdictOf(applied()).exitCode === 0)
check('🔴 NOT_APPLIED 도 exit 0 이 아니다', verdictOf(NOTHING).exitCode === 1)
check('PARTIAL_OR_INVALID 는 exit 1',
  verdictOf(applied({ foreignKeys: [] })).exitCode === 1)
check('OBSERVATION_FAILED 는 exit 1', verdictOf(null).exitCode === 1)
check('실패한 사유가 요약에 남는다',
  verdictOf(applied({ indexes: [] })).summary.includes('HeroBanner_pkey'))

// ── ⑩ 프로젝트 판별 fail-closed ──
console.log('── ⑩ 프로젝트 판별')
const REF = 'buougdxmfobjilgjonby'
check('host 에서 ref 를 읽는다',
  judgeProjectRef({ hostname: `db.${REF}.supabase.co`, username: 'postgres' }, REF).ok)
check('pooler 사용자 이름에서도 읽는다',
  judgeProjectRef({ hostname: 'aws-0-ap-northeast-2.pooler.supabase.com', username: `postgres.${REF}` }, REF).ok)
const cantRead = judgeProjectRef({ hostname: 'localhost', username: 'postgres' }, REF)
check('🔴 둘 다 못 읽으면 막는다', !cantRead.ok)
check('그때 사유가 "판별하지 못했다" 다', cantRead.reason.includes('fail-closed'))
check('다른 프로젝트면 막는다',
  !judgeProjectRef({ hostname: 'db.other.supabase.co', username: 'postgres' }, REF).ok)

// ── ⑪ CLI 계약 — 🔴 소스를 실행하지 않고 분기만 본다 ──
console.log('── ⑪ CLI 계약')
const cli = readFileSync('scripts/apply-migration-0025.mjs', 'utf-8')
const cliCode = cli.split('\n')
  .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
  .join('\n')
check('CLI 가 판정을 스스로 다시 적지 않는다', cliCode.includes('judgeMigration0025State('))
check('CLI 가 프로젝트 판별을 정본에 맡긴다', cliCode.includes('judgeProjectRef('))
check('CLI 가 트랜잭션 제어를 정본에 맡긴다', cliCode.includes('applyWithVerification('))
check('🔴 CLI 가 BEGIN·COMMIT 을 직접 쓰지 않는다',
  !/client\.query\(\s*['"`](BEGIN|COMMIT|ROLLBACK)/i.test(cliCode))
check('🔴 CLI 가 0025 판정을 주입한다', /judge:\s*judgeMigration0025State/.test(cliCode))
check('CLI 가 잡히지 않은 오류로 끝나지 않게 한다', cliCode.includes('unhandledRejection'))
check('--apply 없이는 어떤 쓰기도 하지 않는다', (() => {
  const applyAt = cliCode.indexOf('if (!APPLY)')
  const txAt = cliCode.indexOf('applyWithVerification(')
  return applyAt > 0 && txAt > applyAt
})())
check('--check 는 판정 뒤 곧바로 끝난다 (적용 경로로 흘러가지 않는다)',
  /if \(CHECK\)[\s\S]{0,2500}process\.exit\(verdict\.exitCode\)/.test(cliCode))
check('🔴 알 수 없는 인자를 거부한다', cliCode.includes('알 수 없는 인자'))
check('🔴 --check 와 --apply 를 함께 쓰지 못한다', /APPLY && CHECK/.test(cliCode))
check('🔴 NOT_APPLIED 가 아니면 적용하지 않는다',
  /verdict\.state !== 'NOT_APPLIED'/.test(cliCode))
check('이미 적용된 상태를 따로 말한다', /APPLIED_AND_VALID'\)[\s\S]{0,200}이미 적용/.test(cliCode))
check('🔴 URL 원문을 출력하지 않는다', !/console\.log\([^)]*directUrl/.test(cliCode))
check('COMMIT 뒤 최종 확인을 한다', /COMMIT 뒤|finalVerdict/.test(cliCode))

// ── ⑫ SQL 화이트리스트 ──
console.log('── ⑫ SQL')
const sqlText = readFileSync(`prisma/migrations/${MIGRATION_ID}/migration.sql`, 'utf-8')
const sqlBody = sqlText.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const stmts = sqlBody.split(';').map((s) => s.trim()).filter((s) => s !== '')
check('실행 구문이 전부 허용 목록이다',
  stmts.every((s) => /^(CREATE TYPE|CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|ALTER TABLE)\b/i.test(s)))
check('🔴 DROP 이 없다', !/\bDROP\b/i.test(sqlBody))
check('🔴 TRUNCATE·INSERT·UPDATE·DELETE FROM 이 없다',
  !/\b(TRUNCATE|INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM)\b/i.test(sqlBody))
check('ALTER 대상이 HeroBanner 뿐이다',
  [...sqlBody.matchAll(/ALTER TABLE\s+"([A-Za-z]+)"/g)].every((m) => m[1] === NEW_TABLE))
check('🔴 기존 테이블을 ALTER 하지 않는다',
  !PROTECTED_TABLES.some((t) => new RegExp(`ALTER TABLE\\s+"${t}"`).test(sqlBody)))
check('SQL 이 enum 을 만든다', sqlBody.includes(`CREATE TYPE "${NEW_ENUM}"`))
check('SQL 이 테이블을 만든다', sqlBody.includes(`CREATE TABLE "${NEW_TABLE}"`))
check('SQL 이 컬럼 16개를 전부 만든다',
  EXPECTED_COLUMNS.every((c) => new RegExp(`"${c.name}"\\s`).test(sqlBody)))
check('SQL 이 인덱스 3개를 만든다 (PK 는 제약으로 생긴다)',
  (sqlBody.match(/CREATE INDEX "HeroBanner_/g) ?? []).length === 3)
check('SQL 이 FK 2개를 SET NULL 로 만든다',
  (sqlBody.match(/ON DELETE SET NULL/g) ?? []).length === 2)
check('🔴 공개 URL 컬럼이 없다', !/"(mobileImageUrl|desktopImageUrl|imageUrl)"/i.test(sqlBody))
check('🔴 popup type 컬럼이 없다', !/"(type|bannerType)"\s/i.test(sqlBody))
check('🔴 campaignId 컬럼이 없다', !/"campaignId"/i.test(sqlBody))

// ── ⑬ 적용 트랜잭션 — 🔴 COMMIT 전 검증 (가짜 client · 실제 DB 0) ──
console.log('── ⑬ 트랜잭션 (가짜 client)')

type FakeOpts = {
  failOn?: string
  observeThrows?: boolean
  observed?: unknown
  afterCounts?: Record<string, number | null>
}

const BEFORE_COUNTS: Record<string, number | null> = Object.fromEntries(
  PROTECTED_TABLES.map((t) => [t, 10]),
)

async function runFake(opts: FakeOpts = {}) {
  const calls: string[] = []
  const result = await applyWithVerification({
    exec: async (_sql: string, label: string) => {
      calls.push(label)
      if (opts.failOn === label) throw new Error(`fake ${label} 실패`)
      return undefined
    },
    sql: 'CREATE TABLE "HeroBanner" ();',
    observe: async () => {
      if (opts.observeThrows === true) throw new Error('fake 관측 실패')
      return (opts.observed ?? applied()) as never
    },
    countTables: async () => opts.afterCounts ?? { ...BEFORE_COUNTS },
    beforeCounts: { ...BEFORE_COUNTS },
    judge: judgeMigration0025State as never,
  })
  return { ...result, execCalls: calls }
}

const good = await runFake()
check('정상: ok', good.ok)
check('🔴 정상: COMMIT 정확히 1회', good.committed === 1)
check('정상: ROLLBACK 0회', good.rolledBack === 0)
check('🔴 정상: 순서가 BEGIN→SQL→OBSERVE→COUNT→COMMIT',
  good.calls.join(',') === 'BEGIN,SQL,OBSERVE,COUNT,COMMIT')
check('정상: 판정 상태가 APPLIED_AND_VALID', good.state === 'APPLIED_AND_VALID')

const sqlFail = await runFake({ failOn: 'SQL' })
check('SQL 실패: ok=false', !sqlFail.ok)
check('🔴 SQL 실패: COMMIT 0회', sqlFail.committed === 0)
check('SQL 실패: ROLLBACK 1회', sqlFail.rolledBack === 1)

const beginFail = await runFake({ failOn: 'BEGIN' })
check('BEGIN 실패: ok=false', !beginFail.ok)
check('🔴 BEGIN 실패: COMMIT 0 · ROLLBACK 0 (열리지도 않았다)',
  beginFail.committed === 0 && beginFail.rolledBack === 0)

const observeFail = await runFake({ observeThrows: true })
check('🔴 관측 실패: ROLLBACK — 됐는지 말할 수 없으면 되돌린다',
  !observeFail.ok && observeFail.committed === 0 && observeFail.rolledBack === 1)
check('관측 실패 상태가 OBSERVATION_FAILED', observeFail.state === 'OBSERVATION_FAILED')

const partialFail = await runFake({ observed: applied({ foreignKeys: [] }) })
check('🔴 FK 가 안 생겼으면 COMMIT 하지 않는다',
  !partialFail.ok && partialFail.committed === 0 && partialFail.rolledBack === 1)
check('그때 상태가 PARTIAL_OR_INVALID', partialFail.state === 'PARTIAL_OR_INVALID')

const enumOnly = await runFake({ observed: { ...NOTHING, enumLabels: [...ENUM_LABELS] } })
check('🔴 enum 만 생겼으면 COMMIT 하지 않는다',
  !enumOnly.ok && enumOnly.committed === 0 && enumOnly.rolledBack === 1)

const idxFail = await runFake({ observed: applied({ indexes: goodIndexes().slice(0, 1) }) })
check('🔴 인덱스가 덜 생겼으면 COMMIT 하지 않는다',
  !idxFail.ok && idxFail.committed === 0 && idxFail.rolledBack === 1)

const rowMoved = await runFake({ afterCounts: { ...BEFORE_COUNTS, Post: 11 } })
check('🔴 기존 row 가 변하면 ROLLBACK',
  !rowMoved.ok && rowMoved.committed === 0 && rowMoved.rolledBack === 1)
check('그때 사유에 어느 테이블인지 남는다', rowMoved.reason.includes('Post'))

const commitFail = await runFake({ failOn: 'COMMIT' })
check('🔴 COMMIT 이 실패하면 성공으로 보고하지 않는다', !commitFail.ok)
check('COMMIT 실패: committed 0', commitFail.committed === 0)

// ── ⑭ 0024 무회귀 — 판정을 주지 않으면 예전 그대로 ──
console.log('── ⑭ 0024 무회귀')
const shared = readFileSync('scripts/lib/migration-0024-state.mjs', 'utf-8')
check('🔴 judge 를 안 주면 0024 판정이 기본이다',
  /io\.judge \?\? judgeMigrationState/.test(shared))
check('0024 판정 함수가 그대로 export 된다', shared.includes('export function judgeMigrationState('))
check('트랜잭션 제어가 여전히 한 곳뿐이다',
  (shared.match(/export async function applyWithVerification/g) ?? []).length === 1)
check('0025 state 모듈이 트랜잭션을 복제하지 않았다',
  !readFileSync('scripts/lib/migration-0025-state.mjs', 'utf-8').includes('BEGIN'))

// ── ⑮ 판정 모듈이 순수한가 ──
console.log('── ⑮ 순수성')
const stateSrc = readFileSync('scripts/lib/migration-0025-state.mjs', 'utf-8')
check('🔴 판정 모듈이 DB 를 import 하지 않는다', !/from 'pg'|require\('pg'\)/.test(stateSrc))
check('🔴 판정 모듈이 파일을 읽지 않는다', !/readFileSync|node:fs/.test(stateSrc))
check('🔴 판정 모듈이 네트워크를 쓰지 않는다', !/fetch\(|node:http/.test(stateSrc))
check('판정이 같은 입력에 같은 답을 준다',
  state(applied()) === state(applied()) && state(NOTHING) === state(NOTHING))


// ══════════════════════════════════════════════════════════
// 🔴 Codex [1] 검증이 잡은 차단 결함 4건 (2026-09-14)
// ══════════════════════════════════════════════════════════

// ── ⑯ 결함 A — SQL 대상이 열려 있었다 ──
console.log('── ⑯ 결함 A · SQL 계약')

const realSql = readFileSync(`prisma/migrations/${MIGRATION_ID}/migration.sql`, 'utf-8')
check('🔴 실제 0025 SQL 이 계약을 통과한다', judgeMigration0025Sql(realSql).ok)
check('SQL 계약 요약이 실행문 수를 말한다', judgeMigration0025Sql(realSql).summary.includes('7개'))
check('SQL 을 못 읽으면 실패', !judgeMigration0025Sql('').ok)
check('문자열이 아니면 실패', !judgeMigration0025Sql(null as never).ok)

/** 실제 SQL 에 한 줄 덧붙여 차단되는지 본다 — 🔴 migration SQL 자체는 고치지 않는다 */
const plus = (extra: string): boolean => judgeMigration0025Sql(`${realSql}\n${extra}`).ok

check('🔴 추가 CREATE TABLE 을 막는다',
  !plus('CREATE TABLE "Evil" ("id" TEXT NOT NULL);'))
check('🔴 추가 CREATE TYPE 을 막는다',
  !plus(`CREATE TYPE "OtherEnum" AS ENUM ('A');`))
check('🔴 User 대상 CREATE INDEX 를 막는다',
  !plus('CREATE INDEX "User_email_idx" ON "User"("email");'))
check('🔴 HeroBanner 에 예상 밖 인덱스를 더해도 막는다',
  !plus('CREATE INDEX "HeroBanner_name_idx" ON "HeroBanner"("name");'))
check('🔴 추가 ALTER TABLE 을 막는다',
  !plus('ALTER TABLE "User" ADD COLUMN "x" TEXT;'))
check('🔴 8번째 문장이면 막는다 — 개수 자체가 계약이다',
  !plus('CREATE INDEX "HeroBanner_alt_idx" ON "HeroBanner"("alt");'))
check('🔴 INSERT 를 막는다', !plus(`INSERT INTO "HeroBanner" ("id") VALUES ('x');`))
check('🔴 DROP 을 막는다', !plus('DROP TABLE "HeroBanner";'))
check('🔴 GRANT 같은 허용 밖 구문을 막는다', !plus('GRANT ALL ON "HeroBanner" TO PUBLIC;'))

/** 실제 SQL 의 한 조각을 바꿔치기해 계약이 실제로 값을 보는지 확인한다 */
const swapped = (from: string, to: string): boolean =>
  judgeMigration0025Sql(realSql.replace(from, to)).ok

check('🔴 enum 이름이 바뀌면 막는다',
  !swapped('CREATE TYPE "HeroBannerLinkKind"', 'CREATE TYPE "OtherKind"'))
check('🔴 enum 라벨 순서가 바뀌면 막는다',
  !swapped(`ENUM ('NONE', 'INTERNAL', 'EXTERNAL')`, `ENUM ('INTERNAL', 'NONE', 'EXTERNAL')`))
check('🔴 테이블 이름이 바뀌면 막는다',
  !swapped('CREATE TABLE "HeroBanner"', 'CREATE TABLE "HeroBanners"'))
check('🔴 복합 인덱스 컬럼 순서가 바뀌면 막는다',
  !swapped('("isActive", "archivedAt", "sortOrder")', '("archivedAt", "isActive", "sortOrder")'))
check('🔴 인덱스 대상 테이블이 바뀌면 막는다',
  !swapped('ON "HeroBanner"("startsAt")', 'ON "User"("startsAt")'))
check('🔴 FK 가 CASCADE 로 바뀌면 막는다 — 운영자 탈퇴가 배너를 지운다',
  !swapped('REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;\n\nALTER TABLE "HeroBanner"\n  ADD CONSTRAINT "HeroBanner_updatedByUserId_fkey"',
           'REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;\n\nALTER TABLE "HeroBanner"\n  ADD CONSTRAINT "HeroBanner_updatedByUserId_fkey"'))
check('🔴 FK 참조 테이블이 바뀌면 막는다',
  !swapped('FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")',
           'FOREIGN KEY ("createdByUserId") REFERENCES "Post"("id")'))
check('SQL 계약이 CREATE INDEX 를 3개로 센다 (PK 는 제약이 만든다)',
  SQL_CREATE_INDEX_SPECS.length === 3)

// ── ⑰ 결함 B — 인덱스를 이름만 봤다 ──
console.log('── ⑰ 결함 B · 인덱스 컬럼과 순서')

check('🔴 이름 문자열 배열은 이제 관측 실패다 — 컬럼을 볼 수 없다',
  state(applied({ indexes: [...EXPECTED_INDEXES] })) === 'OBSERVATION_FAILED')
check('🔴 같은 이름·다른 컬럼이면 잡는다',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name === 'HeroBanner_isActive_archivedAt_sortOrder_idx' ? { ...i, columns: ['sortOrder'] } : i),
  })) === 'PARTIAL_OR_INVALID')
check('🔴 복합 인덱스 컬럼 순서가 다르면 잡는다',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name === 'HeroBanner_isActive_archivedAt_sortOrder_idx'
        ? { ...i, columns: ['archivedAt', 'isActive', 'sortOrder'] } : i),
  })) === 'PARTIAL_OR_INVALID')
check('🔴 PK 가 일반 인덱스면 잡는다',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name === 'HeroBanner_pkey' ? { ...i, isPrimary: false, isUnique: false } : i),
  })) === 'PARTIAL_OR_INVALID')
check('🔴 일반 인덱스가 unique 면 잡는다',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name === 'HeroBanner_startsAt_idx' ? { ...i, isUnique: true } : i),
  })) === 'PARTIAL_OR_INVALID')
check('🔴 PK 가 다른 컬럼이면 잡는다',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name === 'HeroBanner_pkey' ? { ...i, columns: ['name'] } : i),
  })) === 'PARTIAL_OR_INVALID')
check('🔴 다른 테이블의 인덱스가 섞이면 잡는다',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name === 'HeroBanner_endsAt_idx' ? { ...i, table: 'User' } : i),
  })) === 'PARTIAL_OR_INVALID')
check('🔴 예상 밖 인덱스가 있으면 잡는다',
  state(applied({
    indexes: [...goodIndexes(),
      { name: 'HeroBanner_name_idx', table: NEW_TABLE, columns: ['name'], isPrimary: false, isUnique: false }],
  })) === 'PARTIAL_OR_INVALID')
check('인덱스 metadata 모양이 아니면 OBSERVATION_FAILED',
  state(applied({ indexes: [{ name: 'x' }] })) === 'OBSERVATION_FAILED')

// ── ⑱ 결함 C — rowCount null 이 통과했다 ──
console.log('── ⑱ 결함 C · rowCount')

check('🔴 rowCount:null 은 관측 실패다 (앞선 판은 APPLIED_AND_VALID 였다)',
  state(applied({ rowCount: null })) === 'OBSERVATION_FAILED')
check('🔴 그때 exit 가 0 이 아니다',
  verdictOf(applied({ rowCount: null })).exitCode === 1)
check('rowCount:undefined 도 관측 실패',
  state(applied({ rowCount: undefined })) === 'OBSERVATION_FAILED')
check('rowCount 가 문자열이면 관측 실패',
  state(applied({ rowCount: '0' })) === 'OBSERVATION_FAILED')
check('🔴 rowCount 가 음수면 관측 실패',
  state(applied({ rowCount: -1 })) === 'OBSERVATION_FAILED')
check('rowCount 가 소수면 관측 실패',
  state(applied({ rowCount: 0.5 })) === 'OBSERVATION_FAILED')
check('rowCount 0 은 정상', state(applied({ rowCount: 0 })) === 'APPLIED_AND_VALID')
check('rowCount 1 은 PARTIAL_OR_INVALID', state(applied({ rowCount: 1 })) === 'PARTIAL_OR_INVALID')
check('테이블이 없으면 rowCount:null 이어도 NOT_APPLIED 다',
  state(NOTHING) === 'NOT_APPLIED')

// ── ⑲ 결함 D — 보호 테이블 누락 ──
console.log('── ⑲ 결함 D · 보호 테이블')

const fullCounts = Object.fromEntries(PROTECTED_TABLES.map((t) => [t, 3]))
check('전부 읽으면 통과', judgeProtectedCounts(fullCounts).ok)
check('🔴 보호 테이블이 하나 빠지면 실패', (() => {
  const { User: _omit, ...rest } = fullCounts
  return !judgeProtectedCounts(rest).ok
})())
check('🔴 행 수가 null 이면 실패 — 앞선 판은 "변경 없음" 으로 통과했다',
  !judgeProtectedCounts({ ...fullCounts, User: null }).ok)
check('행 수가 문자열이면 실패',
  !judgeProtectedCounts({ ...fullCounts, Post: '3' as never }).ok)
check('행 수가 음수면 실패', !judgeProtectedCounts({ ...fullCounts, Post: -1 }).ok)
check('counts 자체가 null 이면 실패', !judgeProtectedCounts(null as never).ok)
check('실패 사유에 어느 테이블인지 남는다',
  judgeProtectedCounts({ ...fullCounts, Comment: null }).reason.includes('Comment'))
check('보호 목록이 9개다', PROTECTED_TABLES.length === 9)

/** 트랜잭션 안에서 count 가 던지면 ROLLBACK 인가 */
async function runCountFail() {
  const callsSeen: string[] = []
  return applyWithVerification({
    exec: async (_sql: string, label: string) => { callsSeen.push(label); return undefined },
    sql: 'CREATE TABLE "HeroBanner" ();',
    observe: async () => applied() as never,
    countTables: async () => { throw new Error('보호 테이블 User 가 없다') },
    beforeCounts: { ...BEFORE_COUNTS },
    judge: judgeMigration0025State as never,
  })
}
const countFail = await runCountFail()
check('🔴 트랜잭션 안 count 실패 → COMMIT 0 · ROLLBACK 1',
  !countFail.ok && countFail.committed === 0 && countFail.rolledBack === 1)
check('그때 상태가 OBSERVATION_FAILED', countFail.state === 'OBSERVATION_FAILED')

// ── ⑳ CLI 가 새 계약을 실제로 쓰는가 ──
console.log('── ⑳ CLI 배선')
check('🔴 CLI 가 SQL 계약을 순수 함수에 맡긴다', cliCode.includes('judgeMigration0025Sql('))
check('🔴 CLI 가 SQL 검사를 DB 연결보다 먼저 한다', (() => {
  const sqlAt = cliCode.indexOf('judgeMigration0025Sql(')
  const connectAt = cliCode.indexOf('client.connect()')
  return sqlAt > 0 && connectAt > sqlAt
})())
check('🔴 SQL 이 틀리면 연결하지 않는다고 말한다', cliCode.includes('DB 에 연결하지 않았습니다'))
check('🔴 CLI 가 보호 테이블 판정을 순수 함수에 맡긴다', cliCode.includes('judgeProtectedCounts('))
check('🔴 counts 가 null 을 넣지 않는다', !/out\[t\] = null/.test(cliCode))
check('🔴 counts 가 없는 테이블에서 던진다', /보호 테이블 \$\{t\} 가 없다/.test(cliCode))
check('🔴 인덱스를 이름만 읽지 않는다', !/indexes: idx\.map\(\(i\) => i\.indexname\)/.test(cliCode))
check('인덱스 조회가 컬럼 순서를 읽는다', /ORDER BY k\.ord/.test(cliCode))
check('인덱스 조회가 primary·unique 를 읽는다',
  cliCode.includes('indisprimary') && cliCode.includes('indisunique'))
check('CLI 가 인라인 화이트리스트를 다시 적지 않는다', !/const ALLOWED = /.test(cliCode))


console.log(`\n  ${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('  🔴 이 검사는 DB 에 연결하지 않았다 — 연결 0 · write 0\n')
process.exit(fail === 0 ? 0 : 1)
