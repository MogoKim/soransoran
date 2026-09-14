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
  EXPECTED_CONSTRAINTS,
  EXPECTED_PRIMARY_KEY,
  INDEX_COMMON_CONTRACT,
  IGNORED_CONSTRAINT_TYPES,
  judgeMigration0025ApplyState,
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
  datetime_precision?: number | null
}

/** 계약 그대로인 컬럼 16개. 테스트마다 한 곳만 어긋뜨린다. */
function goodColumns(): ColumnMeta[] {
  return EXPECTED_COLUMNS.map((c) => ({
    column_name: c.name,
    data_type: c.dataType,
    udt_name: c.udtName ?? c.dataType,
    is_nullable: c.nullable ? 'YES' : 'NO',
    datetime_precision: c.datetimePrecision,
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
    /**
     * 🔴 네 인덱스가 모두 지켜야 하는 성질을 **통째로** 펼친다.
     *    개별 나열이면 계약에 값이 늘 때마다 fixture 가 낡는다 —
     *    실제로 isValid·isReady·isLive 를 더했을 때 그 일이 났다.
     */
    ...INDEX_COMMON_CONTRACT,
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

/** 제약 관측값 — 🔴 PK 1 + FK 2, 정확히 셋. */
function goodConstraints() {
  return EXPECTED_CONSTRAINTS.map((c) => ({ name: c.name, type: c.type, validated: true }))
}

/**
 * PostgreSQL 18 이 `pg_constraint` 에 함께 내놓는 NOT NULL 행.
 * 🔴 17 이하에는 없다. 둘 다 같은 판정이 나와야 한다.
 */
function pg18NotNullConstraints() {
  return EXPECTED_COLUMNS
    .filter((c) => !c.nullable)
    .map((c) => ({ name: `HeroBanner_${c.name}_not_null`, type: 'n' }))
}

/** 완전히 적용된 상태. `over` 로 한 부분만 바꿔 실패 사례를 만든다. */
function applied(over: Record<string, unknown> = {}) {
  return {
    table: NEW_TABLE,
    enumLabels: [...ENUM_LABELS],
    columns: goodColumns(),
    indexes: goodIndexes(),
    foreignKeys: goodForeignKeys(),
    constraints: goodConstraints(),
    rowCount: 0,
    ...over,
  }
}

const NOTHING = {
  table: null, enumLabels: null, columns: null,
  indexes: null, foreignKeys: null, constraints: null, rowCount: null,
}

const state = (input: unknown): string =>
  judgeMigration0025State(input as Parameters<typeof judgeMigration0025State>[0]).state

/** 🔴 적용 직후 전용 판정 — 스키마 위에 "빈 테이블" 까지 요구한다 */
const applyState = (input: unknown): string =>
  judgeMigration0025ApplyState(input as Parameters<typeof judgeMigration0025ApplyState>[0]).state

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
// 🔴 결함 D 정정 — "빈 테이블" 은 적용 직후에만 참인 조건이라 apply 전용 판정으로 옮겼다
check('🔴 적용 직후 판정은 행이 있으면 잡는다 — 이 마이그레이션은 행을 만들지 않는다',
  applyState(applied({ rowCount: 1 })) === 'PARTIAL_OR_INVALID')
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
// 🔴 적용 경로는 **apply 전용** 판정을 주입한다 — 빈 테이블까지 요구하는 쪽이다
check('🔴 CLI 가 적용 경로에 apply 전용 판정을 주입한다',
  /judge:\s*judgeMigration0025ApplyState/.test(cliCode))
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
    judge: judgeMigration0025ApplyState as never,
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
// 🔴 이제 관측 단계에서 걸린다 — 남의 테이블 인덱스를 우리 것으로 셀 수 없다
check('🔴 다른 테이블의 인덱스가 섞이면 관측 실패다',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name === 'HeroBanner_endsAt_idx' ? { ...i, table: 'User' } : i),
  })) === 'OBSERVATION_FAILED')
check('🔴 예상 밖 인덱스가 있으면 잡는다',
  state(applied({
    indexes: [...goodIndexes(),
      { name: 'HeroBanner_name_idx', table: NEW_TABLE, columns: ['name'],
        isPrimary: false, isUnique: false, ...INDEX_COMMON_CONTRACT }],
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
check('rowCount 1 은 적용 직후 판정에서 PARTIAL_OR_INVALID',
  applyState(applied({ rowCount: 1 })) === 'PARTIAL_OR_INVALID')
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
    judge: judgeMigration0025ApplyState as never,
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



// ══════════════════════════════════════════════════════════
// 🔴 Codex [1] 2차 검증이 잡은 차단 결함 4건 (2026-09-14)
// ══════════════════════════════════════════════════════════

// ── ㉑ 결함 A — CREATE TABLE 내부가 열려 있었다 ──
console.log('── ㉑ 결함 A · CREATE TABLE 내부 계약')

check('🔴 실제 0025 SQL 이 내부 계약까지 통과한다', judgeMigration0025Sql(realSql).ok)

/** 실제 SQL 의 한 조각을 바꿔 계약이 실제로 그 값을 보는지 확인한다 */
const mutate = (from: string, to: string): boolean =>
  judgeMigration0025Sql(realSql.replace(from, to)).ok

check('🔴 CHECK (false) 를 끼워 넣으면 막는다 — 어떤 INSERT 도 통과하지 못하게 된다',
  !mutate('"alt" TEXT NOT NULL,',
          '"alt" TEXT NOT NULL, CONSTRAINT "HeroBanner_never_insert" CHECK (false),'))
check('🔴 UNIQUE 제약을 더하면 막는다',
  !mutate('"name" TEXT NOT NULL,',
          '"name" TEXT NOT NULL, CONSTRAINT "HeroBanner_name_key" UNIQUE ("name"),'))
check('🔴 TIMESTAMP(3) → TIMESTAMP(6) 을 막는다',
  !mutate('"startsAt" TIMESTAMP(3)', '"startsAt" TIMESTAMP(6)'))
check('🔴 createdAt 의 precision 변조도 막는다',
  !mutate('"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
          '"createdAt" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP'))
check('🔴 컬럼 하나를 지우면 막는다',
  !judgeMigration0025Sql(realSql.replace('    "linkUrl" TEXT,\n', '')).ok)
check('🔴 NOT NULL 을 떼면 막는다', !mutate('"name" TEXT NOT NULL,', '"name" TEXT,'))
check('🔴 nullable 컬럼에 NOT NULL 을 붙이면 막는다',
  !mutate('"mobileImageKey" TEXT,', '"mobileImageKey" TEXT NOT NULL,'))
check('🔴 linkKind 의 DEFAULT 를 떼면 막는다',
  !mutate(`"linkKind" "HeroBannerLinkKind" NOT NULL DEFAULT 'NONE',`,
          '"linkKind" "HeroBannerLinkKind" NOT NULL,'))
check('🔴 isActive 의 DEFAULT 가 true 면 막는다 — 만들자마자 노출된다',
  !mutate('"isActive" BOOLEAN NOT NULL DEFAULT false,', '"isActive" BOOLEAN NOT NULL DEFAULT true,'))
check('🔴 타입을 바꾸면 막는다 (sortOrder INTEGER → TEXT)',
  !mutate('"sortOrder" INTEGER NOT NULL,', '"sortOrder" TEXT NOT NULL,'))
check('🔴 예상 밖 컬럼을 더하면 막는다',
  !mutate('"alt" TEXT NOT NULL,', '"alt" TEXT NOT NULL, "campaignId" TEXT,'))
check('🔴 PK 컬럼을 바꾸면 막는다', !mutate('PRIMARY KEY ("id")', 'PRIMARY KEY ("name")'))
check('🔴 PK 이름을 바꾸면 막는다',
  !mutate('CONSTRAINT "HeroBanner_pkey" PRIMARY KEY', 'CONSTRAINT "HeroBanner_pk" PRIMARY KEY'))
check('PK 계약이 id 한 컬럼이다',
  EXPECTED_PRIMARY_KEY.columns.length === 1 && EXPECTED_PRIMARY_KEY.columns[0] === 'id')
check('컬럼마다 SQL 표기가 정의돼 있다',
  EXPECTED_COLUMNS.every((c) => typeof c.sqlType === 'string' && c.sqlType.length > 0))
check('timestamp 컬럼 5개에 precision 3 이 정의돼 있다',
  EXPECTED_COLUMNS.filter((c) => c.datetimePrecision === 3).length === 5)

// ── ㉒ 결함 B — DB 관측이 제약·precision 을 놓쳤다 ──
console.log('── ㉒ 결함 B · 실제 DB metadata')

check('제약 계약은 정확히 3개다', EXPECTED_CONSTRAINTS.length === 3)
check('PK 1개 · FK 2개다',
  EXPECTED_CONSTRAINTS.filter((c) => c.type === 'p').length === 1 &&
  EXPECTED_CONSTRAINTS.filter((c) => c.type === 'f').length === 2)

check('🔴 관측에 constraints 가 없으면 OBSERVATION_FAILED',
  state(applied({ constraints: undefined })) === 'OBSERVATION_FAILED')
check('constraints 가 배열이 아니면 OBSERVATION_FAILED',
  state(applied({ constraints: 'none' })) === 'OBSERVATION_FAILED')
check('제약 metadata 모양이 아니면 OBSERVATION_FAILED',
  state(applied({ constraints: [{ name: 'x' }] })) === 'OBSERVATION_FAILED')
check('🔴 예상 밖 CHECK 제약이 있으면 PARTIAL_OR_INVALID',
  state(applied({ constraints: [...goodConstraints(), { name: 'HeroBanner_never', type: 'c', validated: true }] })) === 'PARTIAL_OR_INVALID')
check('🔴 예상 밖 UNIQUE 제약이 있으면 PARTIAL_OR_INVALID',
  state(applied({ constraints: [...goodConstraints(), { name: 'HeroBanner_name_key', type: 'u', validated: true }] })) === 'PARTIAL_OR_INVALID')
check('제약이 빠지면 PARTIAL_OR_INVALID',
  state(applied({ constraints: goodConstraints().slice(0, 2) })) === 'PARTIAL_OR_INVALID')
check('제약 종류가 다르면 PARTIAL_OR_INVALID',
  state(applied({ constraints: goodConstraints().map((c) => c.name === 'HeroBanner_pkey' ? { ...c, type: 'u' } : c) })) === 'PARTIAL_OR_INVALID')
check('그때 사유에 "CHECK (false)" 경고가 남는다',
  verdictOf(applied({ constraints: [...goodConstraints(), { name: 'x', type: 'c', validated: true }] })).summary.includes('INSERT'))

const bendPrecision = (name: string, value: unknown) =>
  goodColumns().map((c) => (c.column_name === name ? { ...c, datetime_precision: value } : c))
for (const col of ['startsAt', 'endsAt', 'archivedAt', 'createdAt', 'updatedAt']) {
  check(`🔴 ${col} 의 precision 이 6 이면 잡는다`,
    state(applied({ columns: bendPrecision(col, 6) })) === 'PARTIAL_OR_INVALID')
}
check('🔴 precision 이 없으면 잡는다',
  state(applied({ columns: bendPrecision('startsAt', undefined) })) === 'PARTIAL_OR_INVALID')
check('precision 이 문자열이면 잡는다',
  state(applied({ columns: bendPrecision('startsAt', '3') })) === 'PARTIAL_OR_INVALID')
check('precision 이 null 이면 잡는다',
  state(applied({ columns: bendPrecision('endsAt', null) })) === 'PARTIAL_OR_INVALID')
check('timestamp 가 아닌 컬럼의 precision 은 보지 않는다',
  state(applied({ columns: bendPrecision('name', 99) })) === 'APPLIED_AND_VALID')

// ── ㉓ 결함 C — 인덱스 metadata 누락을 기본값으로 통과시켰다 ──
console.log('── ㉓ 결함 C · 인덱스 metadata 엄격')

const dropField = (field: string) =>
  goodIndexes().map((i) => {
    const copy: Record<string, unknown> = { ...i }
    delete copy[field]
    return copy
  })

check('🔴 table 이 없으면 OBSERVATION_FAILED (앞선 판은 APPLIED_AND_VALID 였다)',
  state(applied({ indexes: dropField('table') })) === 'OBSERVATION_FAILED')
check('🔴 isPrimary 가 없으면 OBSERVATION_FAILED',
  state(applied({ indexes: dropField('isPrimary') })) === 'OBSERVATION_FAILED')
check('🔴 isUnique 가 없으면 OBSERVATION_FAILED',
  state(applied({ indexes: dropField('isUnique') })) === 'OBSERVATION_FAILED')
check('columns 가 없으면 OBSERVATION_FAILED',
  state(applied({ indexes: dropField('columns') })) === 'OBSERVATION_FAILED')
check('name 이 없으면 OBSERVATION_FAILED',
  state(applied({ indexes: dropField('name') })) === 'OBSERVATION_FAILED')
check('🔴 isUnique 가 문자열 "false" 면 OBSERVATION_FAILED — boolean 이어야 한다',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, isUnique: 'false' })) })) === 'OBSERVATION_FAILED')
check('isPrimary 가 0 이면 OBSERVATION_FAILED',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, isPrimary: 0 })) })) === 'OBSERVATION_FAILED')
check('🔴 columns 에 문자열 아닌 값이 섞이면 OBSERVATION_FAILED',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, columns: [1, 'x'] })) })) === 'OBSERVATION_FAILED')
check('🔴 대상 테이블이 다르면 OBSERVATION_FAILED',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, table: 'User' })) })) === 'OBSERVATION_FAILED')
check('table 이 숫자면 OBSERVATION_FAILED',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, table: 1 })) })) === 'OBSERVATION_FAILED')
// 🔴 주석은 그 fallback 이 왜 없어졌는지 설명하므로, **실행되는 줄**만 본다
check('관대한 fallback 이 코드에서 사라졌다', (() => {
  const src = readFileSync('scripts/lib/migration-0025-state.mjs', 'utf-8')
  const code = src.split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n')
  return !code.includes('got.table ?? NEW_TABLE')
})())

// ── ㉔ 결함 D — 스키마 판정과 "빈 테이블" 을 섞었다 ──
console.log('── ㉔ 결함 D · schema check 와 apply postcondition 분리')

check('🔴 스키마 판정은 배너가 1건 있어도 APPLIED_AND_VALID',
  state(applied({ rowCount: 1 })) === 'APPLIED_AND_VALID')
check('🔴 배너가 99건 있어도 스키마는 정상',
  state(applied({ rowCount: 99 })) === 'APPLIED_AND_VALID')
check('스키마 판정은 exit 0', verdictOf(applied({ rowCount: 5 })).exitCode === 0)
check('🔴 적용 직후 판정은 1건만 있어도 실패',
  applyState(applied({ rowCount: 1 })) === 'PARTIAL_OR_INVALID')
check('적용 직후 판정은 0행이면 통과',
  applyState(applied({ rowCount: 0 })) === 'APPLIED_AND_VALID')
check('적용 직후 판정의 exit 도 1',
  judgeMigration0025ApplyState(applied({ rowCount: 3 }) as never).exitCode === 1)
check('적용 직후 판정도 스키마가 깨지면 그 사유를 먼저 말한다',
  applyState(applied({ rowCount: 0, foreignKeys: [] })) === 'PARTIAL_OR_INVALID')
check('적용 직후 판정도 관측 실패를 그대로 전한다',
  applyState(applied({ rowCount: null })) === 'OBSERVATION_FAILED')
check('🔴 optional flag 가 아니라 별도 함수다 — 인자를 빠뜨려 약해질 수 없다',
  typeof judgeMigration0025ApplyState === 'function' &&
  judgeMigration0025ApplyState.length === 1)

/** 트랜잭션 안에서 행이 있으면 되돌리는가 */
const rowsPresent = await runFake({ observed: applied({ rowCount: 1 }) })
check('🔴 적용 중 행이 1건이면 COMMIT 0 · ROLLBACK 1',
  !rowsPresent.ok && rowsPresent.committed === 0 && rowsPresent.rolledBack === 1)
check('그때 상태가 PARTIAL_OR_INVALID', rowsPresent.state === 'PARTIAL_OR_INVALID')

// ── ㉕ CLI 배선 (2차) ──
console.log('── ㉕ CLI 배선 (2차)')
check('🔴 --check 는 일반 스키마 판정을 쓴다',
  /const verdict = judgeMigration0025State\(before\)/.test(cliCode))
check('🔴 COMMIT 뒤 최종 확인은 apply 전용 판정을 쓴다',
  /judgeMigration0025ApplyState\(await state\(\)\)/.test(cliCode))
check('🔴 컬럼 조회가 datetime_precision 을 읽는다', cliCode.includes('datetime_precision'))
check('🔴 제약 전체를 관측한다', /FROM pg_constraint[\s\S]{0,200}conrelid = to_regclass/.test(cliCode))
check('제약 관측이 contype 을 읽는다', cliCode.includes('contype AS type'))
check('state() 가 constraints 를 넘긴다', /constraints: cons,/.test(cliCode))
check('테이블이 없을 때도 constraints 자리를 채운다', /constraints: null/.test(cliCode))
check('SQL 검사가 여전히 DB 연결보다 먼저다', (() => {
  const sqlAt = cliCode.indexOf('judgeMigration0025Sql(')
  const connectAt = cliCode.indexOf('client.connect()')
  return sqlAt > 0 && connectAt > sqlAt
})())



// ══════════════════════════════════════════════════════════
// 🔴 Codex [1] 3차 검증이 잡은 차단 결함 3건 (2026-09-14)
// ══════════════════════════════════════════════════════════

// ── ㉖ 결함 A — 컬럼 정의 뒤 절이 DEFAULT 에 삼켜졌다 ──
console.log('── ㉖ 결함 A · 컬럼 내부 제약 우회')

check('🔴 실제 SQL 은 여전히 통과한다', judgeMigration0025Sql(realSql).ok)

check('🔴 DEFAULT false CHECK (false) 를 막는다 — 어떤 INSERT 도 통과하지 못하게 된다',
  !mutate('"isActive" BOOLEAN NOT NULL DEFAULT false,',
          '"isActive" BOOLEAN NOT NULL DEFAULT false CHECK (false),'))
check("🔴 DEFAULT 'NONE' UNIQUE 를 막는다",
  !mutate(`"linkKind" "HeroBannerLinkKind" NOT NULL DEFAULT 'NONE',`,
          `"linkKind" "HeroBannerLinkKind" NOT NULL DEFAULT 'NONE' UNIQUE,`))
check('🔴 DEFAULT CURRENT_TIMESTAMP CHECK (false) 를 막는다',
  !mutate('"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,',
          '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (false),'))
check('🔴 컬럼에 REFERENCES 를 붙이면 막는다',
  !mutate('"linkUrl" TEXT,', '"linkUrl" TEXT REFERENCES "User"("id"),'))
check('🔴 컬럼에 COLLATE 를 붙이면 막는다',
  !mutate('"name" TEXT NOT NULL,', '"name" TEXT NOT NULL COLLATE "C",'))
check('🔴 컬럼에 GENERATED 를 붙이면 막는다',
  !mutate('"sortOrder" INTEGER NOT NULL,',
          '"sortOrder" INTEGER NOT NULL GENERATED ALWAYS AS (1) STORED,'))
check('🔴 닫는 괄호 뒤 table option 을 막는다',
  !mutate('  CONSTRAINT "HeroBanner_pkey" PRIMARY KEY ("id")\n);',
          '  CONSTRAINT "HeroBanner_pkey" PRIMARY KEY ("id")\n) WITH (fillfactor=10);'))
check('🔴 닫는 괄호 뒤 TABLESPACE 를 막는다',
  !mutate('  CONSTRAINT "HeroBanner_pkey" PRIMARY KEY ("id")\n);',
          '  CONSTRAINT "HeroBanner_pkey" PRIMARY KEY ("id")\n) TABLESPACE fast;'))
check('🔴 DEFAULT 값 자체가 바뀌면 막는다 (false → true)',
  !mutate('DEFAULT false,', 'DEFAULT true,'))
check("🔴 DEFAULT 값이 바뀌면 막는다 ('NONE' → 'EXTERNAL')",
  !mutate(`DEFAULT 'NONE',`, `DEFAULT 'EXTERNAL',`))
check('🔴 DEFAULT 를 now() 로 바꾸면 막는다',
  !mutate('DEFAULT CURRENT_TIMESTAMP,', 'DEFAULT now(),'))

console.log('   — 주석·공백 차이는 허용한다 (hash 비교가 아니다)')
check('주석을 한 줄 더해도 통과한다',
  judgeMigration0025Sql(`-- 설명을 덧붙인다\n${realSql}`).ok)
check('컬럼 줄의 들여쓰기가 달라도 통과한다',
  mutate('    "name" TEXT NOT NULL,', '        "name"    TEXT   NOT NULL,'))
check('줄바꿈이 섞여도 통과한다',
  mutate('"sortOrder" INTEGER NOT NULL,', '"sortOrder"\n      INTEGER\n      NOT NULL,'))
check('세 가지 DEFAULT 가 모두 통과한다',
  EXPECTED_COLUMNS.filter((c) => c.sqlDefault !== null).length === 3 && judgeMigration0025Sql(realSql).ok)

// ── ㉗ 결함 B — 표현식·부분 인덱스를 관측조차 못 했다 ──
console.log('── ㉗ 결함 B · 표현식·부분 인덱스')

check('인덱스 공통 계약이 btree 다', INDEX_COMMON_CONTRACT.accessMethod === 'btree')
check('인덱스 공통 계약이 predicate·expression·INCLUDE 를 모두 금지한다',
  INDEX_COMMON_CONTRACT.hasPredicate === false &&
  INDEX_COMMON_CONTRACT.isExpression === false &&
  INDEX_COMMON_CONTRACT.hasIncludedColumns === false)

const bendIndex = (name: string, patch: Record<string, unknown>) =>
  goodIndexes().map((i) => (i.name === name ? { ...i, ...patch } : i))

check('🔴 기대 인덱스에 부분 조건이 붙으면 PARTIAL_OR_INVALID — 조건 밖 행을 덮지 않는다',
  state(applied({ indexes: bendIndex('HeroBanner_startsAt_idx', { hasPredicate: true }) })) === 'PARTIAL_OR_INVALID')
check('🔴 기대 인덱스가 표현식 인덱스면 PARTIAL_OR_INVALID',
  state(applied({ indexes: bendIndex('HeroBanner_endsAt_idx', { isExpression: true }) })) === 'PARTIAL_OR_INVALID')
check('🔴 access method 가 hash 면 PARTIAL_OR_INVALID — 범위 조회를 못 탄다',
  state(applied({ indexes: bendIndex('HeroBanner_startsAt_idx', { accessMethod: 'hash' }) })) === 'PARTIAL_OR_INVALID')
check('gin 도 막는다',
  state(applied({ indexes: bendIndex('HeroBanner_endsAt_idx', { accessMethod: 'gin' }) })) === 'PARTIAL_OR_INVALID')
check('🔴 INCLUDE 컬럼이 붙으면 PARTIAL_OR_INVALID',
  state(applied({ indexes: bendIndex('HeroBanner_isActive_archivedAt_sortOrder_idx', { hasIncludedColumns: true }) })) === 'PARTIAL_OR_INVALID')
check('PK 에 부분 조건이 붙어도 막는다',
  state(applied({ indexes: bendIndex('HeroBanner_pkey', { hasPredicate: true }) })) === 'PARTIAL_OR_INVALID')

/** 🔴 표현식 인덱스가 **추가로** 있는 경우 — 관측에서 사라지면 안 된다 */
const exprIndex = {
  name: 'HeroBanner_lower_name_idx', table: NEW_TABLE, columns: [],
  isPrimary: false, isUnique: false, ...INDEX_COMMON_CONTRACT, isExpression: true,
}
check('🔴 추가 표현식 인덱스는 예상 밖으로 잡힌다 (컬럼이 비어도 관측된다)',
  state(applied({ indexes: [...goodIndexes(), exprIndex] })) === 'PARTIAL_OR_INVALID')
const partialIndex = {
  name: 'HeroBanner_active_partial_idx', table: NEW_TABLE, columns: ['isActive'],
  isPrimary: false, isUnique: false, ...INDEX_COMMON_CONTRACT, hasPredicate: true,
}
check('🔴 추가 부분 인덱스도 예상 밖으로 잡힌다',
  state(applied({ indexes: [...goodIndexes(), partialIndex] })) === 'PARTIAL_OR_INVALID')

console.log('   — 관측값이 없으면 판정하지 않는다')
for (const field of ['accessMethod', 'hasPredicate', 'isExpression', 'hasIncludedColumns']) {
  check(`🔴 ${field} 가 없으면 OBSERVATION_FAILED`,
    state(applied({ indexes: dropField(field) })) === 'OBSERVATION_FAILED')
}
check('accessMethod 가 boolean 이면 OBSERVATION_FAILED',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, accessMethod: true })) })) === 'OBSERVATION_FAILED')
check('hasPredicate 가 문자열이면 OBSERVATION_FAILED',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, hasPredicate: 'false' })) })) === 'OBSERVATION_FAILED')
check('isExpression 이 0 이면 OBSERVATION_FAILED',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, isExpression: 0 })) })) === 'OBSERVATION_FAILED')

console.log('   — 관측 쿼리가 한 행도 빠뜨리지 않는가')
/**
 * 🔴 **인덱스 조회 블록 안에서만** 본다.
 *    FK 조회도 `JOIN pg_attribute` 를 쓰는데 그쪽은 제약의 컬럼 이름을 읽는
 *    정상 조인이다 — 파일 전체를 훑으면 그것까지 위반으로 잡힌다.
 */
const indexQuery = /FROM pg_index[\s\S]*?ORDER BY c\.relname/.exec(cliCode)?.[0] ?? ''
check('인덱스 조회 블록을 찾았다', indexQuery.length > 0)
check('🔴 인덱스 조회가 INNER JOIN pg_attribute 를 쓰지 않는다 — 표현식 인덱스가 사라진다',
  !/\bJOIN pg_attribute\b/.test(indexQuery.replace(/LEFT JOIN pg_attribute/g, '')))
check('🔴 LEFT JOIN 으로 인덱스 행을 보존한다', /LEFT JOIN pg_attribute a/.test(cliCode))
check('indkey 0(표현식)을 컬럼 조인에서 제외한다', /k\.attnum <> 0/.test(cliCode))
check('컬럼이 없어도 빈 배열로 남긴다', /FILTER \(WHERE a\.attname IS NOT NULL\)/.test(cliCode))
check('access method 를 읽는다', /JOIN pg_am\s+am ON am\.oid = c\.relam/.test(cliCode))
check('부분 조건을 읽는다', /i\.indpred\s+IS NOT NULL/.test(cliCode))
check('표현식 여부를 읽는다', /i\.indexprs\s+IS NOT NULL/.test(cliCode))
check('INCLUDE 컬럼을 읽는다', /i\.indnatts > i\.indnkeyatts/.test(cliCode))

// ── ㉘ 결함 C — 잘못된 row 요약 ──
console.log('── ㉘ 결함 C · row 요약')

for (const n of [0, 1, 99]) {
  const v = verdictOf(applied({ rowCount: n }))
  check(`🔴 rowCount ${n} · 스키마 판정은 APPLIED_AND_VALID`, v.state === 'APPLIED_AND_VALID')
  check(`🔴 rowCount ${n} · summary 가 실제 행 수를 말한다`, v.summary.includes(`${n}행`))
}
check('🔴 99행일 때 summary 가 "0행" 이라고 말하지 않는다',
  !verdictOf(applied({ rowCount: 99 })).summary.includes('· 0행'))
check('apply 전용 판정만 0행을 요구한다',
  judgeMigration0025ApplyState(applied({ rowCount: 0 }) as never).summary.includes('0행') &&
  judgeMigration0025ApplyState(applied({ rowCount: 1 }) as never).state === 'PARTIAL_OR_INVALID')
check('apply 전용 판정의 실패 사유가 행 수를 말한다',
  judgeMigration0025ApplyState(applied({ rowCount: 7 }) as never).summary.includes('7행'))



// ══════════════════════════════════════════════════════════
// 🔴 Codex [1] 4차 검증 — 임시 PostgreSQL 18 실측이 잡은 것 (2026-09-14)
// ══════════════════════════════════════════════════════════

// ── ㉙ PostgreSQL 18 의 NOT NULL 제약 ──
console.log('── ㉙ PostgreSQL 18 호환')

check('NOT NULL 컬럼은 8개다', EXPECTED_COLUMNS.filter((c) => !c.nullable).length === 8)
check('🔴 세지 않는 제약 종류는 n 하나뿐이다',
  IGNORED_CONSTRAINT_TYPES.length === 1 && IGNORED_CONSTRAINT_TYPES[0] === 'n')

check('🔴 pg17 — 제약 3개만 있으면 APPLIED_AND_VALID',
  state(applied({ constraints: goodConstraints() })) === 'APPLIED_AND_VALID')
check('🔴 pg18 — 제약 3개 + NOT NULL 8개도 APPLIED_AND_VALID',
  state(applied({ constraints: [...goodConstraints(), ...pg18NotNullConstraints()] })) === 'APPLIED_AND_VALID')
check('pg18 관측이 11행이다', [...goodConstraints(), ...pg18NotNullConstraints()].length === 11)
check('NOT NULL 이 하나만 와도 통과한다',
  state(applied({ constraints: [...goodConstraints(), { name: 'HeroBanner_id_not_null', type: 'n' }] })) === 'APPLIED_AND_VALID')
check('NOT NULL 행에 validated 가 없어도 관측 실패가 아니다',
  state(applied({ constraints: [...goodConstraints(), ...pg18NotNullConstraints()] })) !== 'OBSERVATION_FAILED')

console.log('   — 그래도 막아야 하는 것은 그대로 막는다')
for (const [label, type] of [['CHECK', 'c'], ['UNIQUE', 'u'], ['EXCLUDE', 'x'], ['constraint trigger', 't']] as [string, string][]) {
  check(`🔴 추가 ${label}(${type}) 는 pg18 에서도 차단된다`,
    state(applied({
      constraints: [...goodConstraints(), ...pg18NotNullConstraints(),
        { name: `HeroBanner_extra_${type}`, type, validated: true }],
    })) === 'PARTIAL_OR_INVALID')
}
check('🔴 예상 밖 FK 도 차단된다',
  state(applied({ constraints: [...goodConstraints(), { name: 'HeroBanner_x_fkey', type: 'f', validated: true }] })) === 'PARTIAL_OR_INVALID')
check('🔴 예상 밖 PK 도 차단된다',
  state(applied({ constraints: [...goodConstraints(), { name: 'HeroBanner_x_pkey', type: 'p', validated: true }] })) === 'PARTIAL_OR_INVALID')

// ── ㉚ 제약과 인덱스의 실제 유효 상태 ──
console.log('── ㉚ 유효 상태')

check('🔴 FK 가 NOT VALID 면 PARTIAL_OR_INVALID — 기존 행을 검사하지 않는다',
  state(applied({ constraints: goodConstraints().map((c) => (c.type === 'f' ? { ...c, validated: false } : c)) })) === 'PARTIAL_OR_INVALID')
check('🔴 PK 가 NOT VALID 면 PARTIAL_OR_INVALID',
  state(applied({ constraints: goodConstraints().map((c) => (c.type === 'p' ? { ...c, validated: false } : c)) })) === 'PARTIAL_OR_INVALID')
check('🔴 계약 제약에 validated 가 없으면 OBSERVATION_FAILED',
  state(applied({ constraints: goodConstraints().map(({ validated, ...r }) => r) })) === 'OBSERVATION_FAILED')
check('validated 가 문자열이면 OBSERVATION_FAILED',
  state(applied({ constraints: goodConstraints().map((c) => ({ ...c, validated: 'true' })) })) === 'OBSERVATION_FAILED')

check('인덱스 공통 계약이 valid·ready·live 를 요구한다',
  INDEX_COMMON_CONTRACT.isValid === true &&
  INDEX_COMMON_CONTRACT.isReady === true &&
  INDEX_COMMON_CONTRACT.isLive === true)
for (const field of ['isValid', 'isReady', 'isLive']) {
  check(`🔴 ${field}=false 면 PARTIAL_OR_INVALID — 이름은 맞는데 플래너가 쓰지 않는다`,
    state(applied({ indexes: goodIndexes().map((i) => ({ ...i, [field]: false })) })) === 'PARTIAL_OR_INVALID')
  check(`🔴 ${field} 가 없으면 OBSERVATION_FAILED`,
    state(applied({ indexes: dropField(field) })) === 'OBSERVATION_FAILED')
  check(`${field} 가 문자열이면 OBSERVATION_FAILED`,
    state(applied({ indexes: goodIndexes().map((i) => ({ ...i, [field]: 'true' })) })) === 'OBSERVATION_FAILED')
}
check('PK 만 죽어 있어도 잡는다',
  state(applied({ indexes: goodIndexes().map((i) => (i.isPrimary ? { ...i, isValid: false } : i)) })) === 'PARTIAL_OR_INVALID')

console.log('   — CLI 조회가 그 값들을 읽는가')
check('🔴 인덱스 조회가 indisvalid 를 읽는다', /i\.indisvalid\s+AS "isValid"/.test(cliCode))
check('🔴 인덱스 조회가 indisready 를 읽는다', /i\.indisready\s+AS "isReady"/.test(cliCode))
check('🔴 인덱스 조회가 indislive 를 읽는다', /i\.indislive\s+AS "isLive"/.test(cliCode))
check('세 값이 GROUP BY 에 들어 있다',
  /GROUP BY[\s\S]{0,300}i\.indisvalid, i\.indisready, i\.indislive/.test(cliCode))
check('🔴 제약 조회가 convalidated 를 읽는다', /convalidated AS validated/.test(cliCode))
check('🔴 제약 조회는 NOT NULL 도 다 읽는다 — 거르는 일은 판정이 한다',
  !/contype\s*(<>|!=)\s*'n'/.test(cliCode) && !/contype IN \(/.test(cliCode))

// ── ㉛ apply summary 중복 ──
console.log('── ㉛ apply summary')

const applySummary = judgeMigration0025ApplyState(applied({ rowCount: 0 }) as never).summary
check('🔴 "0행" 이 한 번만 나온다', (applySummary.match(/0행/g) ?? []).length === 1)
check('apply summary 가 스키마 요약을 그대로 쓴다',
  applySummary === verdictOf(applied({ rowCount: 0 })).summary)
check('스키마 판정 summary 는 그대로 1회', (verdictOf(applied({ rowCount: 0 })).summary.match(/0행/g) ?? []).length === 1)
check('행이 있을 때 apply 실패 사유는 중복되지 않는다',
  (judgeMigration0025ApplyState(applied({ rowCount: 5 }) as never).summary.match(/5행/g) ?? []).length === 1)

// ── ㉜ 실제 SQL 을 적용한 뒤의 관측을 재현한다 ──
console.log('── ㉜ 적용 후 관측 재현 (pg17 · pg18 양쪽)')

/**
 * 🔴 **실제 DB 에 연결하지 않는다.** migration SQL 이 만들 스키마를 계약에서
 *    되짚어 조립하고, 그것을 판정에 넣는다 — 임시 DB 에서 읽은 metadata 와
 *    같은 모양이다. Codex [1] 의 임시 PostgreSQL 실측이 이 fixture 와 맞는지를
 *    재검증에서 대조한다.
 */
const afterApply = (pg18: boolean) => applied({
  rowCount: 0,
  constraints: pg18 ? [...goodConstraints(), ...pg18NotNullConstraints()] : goodConstraints(),
})
check('🔴 pg17 적용 직후 — 스키마 판정 APPLIED_AND_VALID',
  state(afterApply(false)) === 'APPLIED_AND_VALID')
check('🔴 pg18 적용 직후 — 스키마 판정 APPLIED_AND_VALID',
  state(afterApply(true)) === 'APPLIED_AND_VALID')
check('🔴 pg17 적용 직후 — apply 전용 판정도 APPLIED_AND_VALID',
  applyState(afterApply(false)) === 'APPLIED_AND_VALID')
check('🔴 pg18 적용 직후 — apply 전용 판정도 APPLIED_AND_VALID',
  applyState(afterApply(true)) === 'APPLIED_AND_VALID')
check('두 판정의 exit 가 0 이다',
  verdictOf(afterApply(true)).exitCode === 0 &&
  judgeMigration0025ApplyState(afterApply(true) as never).exitCode === 0)
check('SQL 계약과 적용 후 관측이 같은 컬럼 수를 말한다',
  EXPECTED_COLUMNS.length === afterApply(true).columns.length)
check('SQL 계약과 적용 후 관측이 같은 인덱스 수를 말한다',
  EXPECTED_INDEX_SPECS.length === afterApply(true).indexes.length)



// ══════════════════════════════════════════════════════════
// 🔴 production --apply 실패의 확정 원인 (2026-09-14)
//
//    `pg_attribute.attname` 은 PostgreSQL 의 `name` 타입이다.
//    캐스팅 없이 집계하면 결과가 name[](OID 1003)이 되고,
//    Node `pg` 드라이버는 그 OID 에 배열 파서를 등록하지 않아
//    문자열 "{endsAt}" 를 그대로 돌려준다.
//    판정기의 Array.isArray 검사가 그것을 잡아 COMMIT 전에 ROLLBACK 했다.
//
//    🔴 기존 추정("같은 트랜잭션이라 아직 안 보였다")은 폐기됐다 —
//       PGlite 트랜잭션 안에서 인덱스 4개가 전부 보인다(§7 통합 검증).
//
//    두 검사는 서로 다른 문제를 담당한다:
//      · pg types 파서 재현  → 드라이버의 OID decoding (여기)
//      · PGlite 트랜잭션 검증 → 트랜잭션 안 visibility (scratchpad 통합 검증)
// ══════════════════════════════════════════════════════════
console.log('── ㉝ pg 배열 decoding (production 실패 원인)')

// ── A. 실제 pg 타입 파서 재현 — 저장소의 실제 pg 모듈을 쓴다 ──
const { types: pgTypes } = (await import('pg')).default
const NAME_ARRAY_OID = 1003
const TEXT_ARRAY_OID = 1009

const decodeAs = (oid: number, raw: string): unknown =>
  pgTypes.getTypeParser(oid, 'text')(raw)

const asName = decodeAs(NAME_ARRAY_OID, '{endsAt}')
const asText = decodeAs(TEXT_ARRAY_OID, '{endsAt}')

check('🔴 name[](OID 1003) 은 배열이 아니다 — 이것이 production 실패 원인',
  !Array.isArray(asName))
check('🔴 name[] 은 문자열 "{endsAt}" 로 온다', asName === '{endsAt}')
check('🔴 text[](OID 1009) 는 JavaScript 배열이다', Array.isArray(asText))
check('🔴 text[] 는 ["endsAt"] 로 온다',
  JSON.stringify(asText) === JSON.stringify(['endsAt']))

const multiName = decodeAs(NAME_ARRAY_OID, '{isActive,archivedAt,sortOrder}')
const multiText = decodeAs(TEXT_ARRAY_OID, '{isActive,archivedAt,sortOrder}')
check('복합 인덱스도 name[] 이면 문자열이다', !Array.isArray(multiName))
check('🔴 복합 인덱스는 text[] 에서 값과 순서가 그대로다',
  JSON.stringify(multiText) === JSON.stringify(['isActive', 'archivedAt', 'sortOrder']))
check('빈 배열도 text[] 면 배열이다', Array.isArray(decodeAs(TEXT_ARRAY_OID, '{}')))
check('빈 배열 text[] 는 길이 0', (decodeAs(TEXT_ARRAY_OID, '{}') as unknown[]).length === 0)
check('원소가 전부 문자열이다',
  (decodeAs(TEXT_ARRAY_OID, '{a,b}') as unknown[]).every((x) => typeof x === 'string'))

// ── B. 쿼리 계약 ──
console.log('── ㉞ 인덱스 쿼리 계약')

check('🔴 a.attname::text 로 캐스팅한다', /array_agg\(a\.attname::text ORDER BY k\.ord\)/.test(cliCode))
check('🔴 빈 배열도 ARRAY[]::text[] 다', /ARRAY\[\]::text\[\]/.test(cliCode))
check('🔴 ARRAY[]::name[] 잔존 0', !/ARRAY\[\]::name\[\]/.test(cliCode))
check('🔴 cast 없는 array_agg(a.attname ORDER BY ...) 잔존 0',
  !/array_agg\(a\.attname ORDER BY/.test(cliCode))
check('ORDER BY k.ord 로 컬럼 순서를 유지한다', /array_agg\([^)]*ORDER BY k\.ord\)/.test(cliCode))
check('FILTER (WHERE a.attname IS NOT NULL) 을 유지한다',
  /FILTER \(WHERE a\.attname IS NOT NULL\)/.test(cliCode))
check('표현식 인덱스 관측을 유지한다 (LEFT JOIN · attnum <> 0)',
  /LEFT JOIN pg_attribute a/.test(cliCode) && /k\.attnum <> 0/.test(cliCode))
check('부분 인덱스 관측을 유지한다', /i\.indpred\s+IS NOT NULL/.test(cliCode))
check('access method 관측을 유지한다', /am\.amname\s+AS "accessMethod"/.test(cliCode))
check('INCLUDE 관측을 유지한다', /i\.indnatts > i\.indnkeyatts/.test(cliCode))
check('valid·ready·live 관측을 유지한다',
  /i\.indisvalid/.test(cliCode) && /i\.indisready/.test(cliCode) && /i\.indislive/.test(cliCode))

// ── C. 판정 강도 유지 — 🔴 문자열 fallback 을 만들지 않았다 ──
console.log('── ㉟ 판정 강도 (fallback 금지)')

check('정상 string[] 은 통과한다', state(applied()) === 'APPLIED_AND_VALID')
check('🔴 문자열 "{endsAt}" 은 OBSERVATION_FAILED — 허용하지 않는다',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name === 'HeroBanner_endsAt_idx' ? { ...i, columns: '{endsAt}' } : i),
  })) === 'OBSERVATION_FAILED')
check('🔴 복합 인덱스의 문자열 표기도 OBSERVATION_FAILED',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name.includes('isActive') ? { ...i, columns: '{isActive,archivedAt,sortOrder}' } : i),
  })) === 'OBSERVATION_FAILED')
check('숫자 배열은 OBSERVATION_FAILED',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, columns: [1, 2] })) })) === 'OBSERVATION_FAILED')
check('혼합 배열은 OBSERVATION_FAILED',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, columns: ['a', 2] })) })) === 'OBSERVATION_FAILED')
/**
 * 🔴 **DB 관측 판정 영역만** 본다.
 *    SQL 텍스트 계약(judgeMigration0025Sql 이하)은 `CREATE INDEX ... (a, b)` 를
 *    읽으려고 당연히 split 을 쓴다 — 그것은 파일을 파싱하는 일이지
 *    드라이버가 준 관측값을 문자열로 받아 주는 fallback 이 아니다.
 */
check('🔴 관측 판정기가 columns 문자열을 split 하지 않는다', (() => {
  const src = readFileSync('scripts/lib/migration-0025-state.mjs', 'utf-8')
  const cut = src.indexOf('export function judgeMigration0025Sql')
  const judgeArea = (cut > 0 ? src.slice(0, cut) : src)
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n')
  return !/\.columns[^\n]*\.split\(/.test(judgeArea) && !/typeof i\.columns === 'string'/.test(judgeArea)
})())
check('🔴 판정기가 여전히 Array.isArray 로 막는다', (() => {
  const src = readFileSync('scripts/lib/migration-0025-state.mjs', 'utf-8')
  return /!Array\.isArray\(i\.columns\)/.test(src)
})())

console.log('   — 나머지 판정 강도가 그대로인가')
check('컬럼 순서가 다르면 PARTIAL_OR_INVALID',
  state(applied({
    indexes: goodIndexes().map((i) =>
      i.name.includes('isActive') ? { ...i, columns: ['archivedAt', 'isActive', 'sortOrder'] } : i),
  })) === 'PARTIAL_OR_INVALID')
check('표현식 인덱스 차단 유지',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, isExpression: true })) })) === 'PARTIAL_OR_INVALID')
check('부분 인덱스 차단 유지',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, hasPredicate: true })) })) === 'PARTIAL_OR_INVALID')
check('hash 인덱스 차단 유지',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, accessMethod: 'hash' })) })) === 'PARTIAL_OR_INVALID')
check('INCLUDE 차단 유지',
  state(applied({ indexes: goodIndexes().map((i) => ({ ...i, hasIncludedColumns: true })) })) === 'PARTIAL_OR_INVALID')
for (const f of ['isValid', 'isReady', 'isLive']) {
  check(`${f}=false 차단 유지`,
    state(applied({ indexes: goodIndexes().map((i) => ({ ...i, [f]: false })) })) === 'PARTIAL_OR_INVALID')
}


console.log(`\n  ${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('  🔴 이 검사는 DB 에 연결하지 않았다 — 연결 0 · write 0\n')
process.exit(fail === 0 ? 0 : 1)
