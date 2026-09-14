#!/usr/bin/env node
/**
 * 0025_hero_banner 적용 — 신규 enum 1개 + 신규 테이블 1개 (+ 인덱스 4 · FK 2)
 *
 *   node scripts/apply-migration-0025.mjs            # dry-run (기본 · read-only)
 *   node scripts/apply-migration-0025.mjs --check    # 상태 확인 (read-only)
 *   node scripts/apply-migration-0025.mjs --apply    # 실제 적용 (유일한 write 경로)
 *
 * 🔴 prisma migrate · db push · db seed 를 쓰지 않는다.
 *    pg 모듈로 직접 실행하고 information_schema · pg_catalog 로 검증한다.
 *
 * 🔴 **0022 를 재사용하지 않는 이유** — 성격은 같지만(신규 생성) 두 가지가 다르다.
 *      ① 0022 는 **COMMIT 뒤에** 검증한다. 검증이 실패해도 되돌릴 수 없다 —
 *         0024 가 "가장 나쁜 결말" 이라며 고친 바로 그 순서다.
 *      ② 0022 의 프로젝트 판별은 host 가 `db.<ref>.supabase.co` 가 아니면
 *         **조용히 통과**한다. 실제 DIRECT_URL 은 pooler 라 늘 그 길로 빠진다.
 *    그래서 0024 의 `judgeProjectRef` 와 `applyWithVerification` 을 쓴다.
 *
 * 🔴 판정은 `judgeMigration0025State` — 순수 함수다. 여기서는 metadata 만 넘긴다.
 *    그래야 네 상태를 production 에 쓰지 않고 시험할 수 있다.
 *
 * 🔴 **`--apply` 는 정확히 `NOT_APPLIED` 에서만 된다.**
 *    enum 만 있거나 테이블만 있는 상태에서 다시 CREATE 를 걸면
 *    트랜잭션이 통째로 깨진다. 그 상태는 사람이 봐야 한다.
 */
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyWithVerification, judgeProjectRef } from './lib/migration-0024-state.mjs'
import {
  EXPECTED_COLUMNS,
  EXPECTED_FOREIGN_KEYS,
  EXPECTED_INDEX_SPECS,
  MIGRATION_ID,
  NEW_ENUM,
  NEW_TABLE,
  PROTECTED_TABLES,
  judgeMigration0025ApplyState,
  judgeMigration0025Sql,
  judgeMigration0025State,
  judgeProtectedCounts,
} from './lib/migration-0025-state.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = join(__dirname, '..', 'prisma', 'migrations', '0025_hero_banner', 'migration.sql')

/** 🔴 0022 · 0024 와 같은 프로젝트다. 값을 따로 두지 않는다 */
const EXPECTED_PROJECT_REF = 'buougdxmfobjilgjonby'

const fail = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m) => console.log(`   ✅ ${m}`)

// ══ 인자 — 🔴 모르는 것은 통과시키지 않는다 ══
/**
 * 🔴 `--aply` 같은 오타가 dry-run 으로 조용히 떨어지면,
 *    운영자는 적용했다고 믿고 화면을 기다린다. 모르는 인자는 즉시 실패다.
 */
const ARGS = process.argv.slice(2)
const KNOWN = new Set(['--check', '--apply'])
const unknown = ARGS.filter((a) => !KNOWN.has(a))
if (unknown.length > 0) fail(`알 수 없는 인자입니다: ${unknown.join(' ')} — 쓸 수 있는 것은 --check · --apply 뿐입니다.`)

const APPLY = ARGS.includes('--apply')
const CHECK = ARGS.includes('--check')
if (APPLY && CHECK) fail('--check 와 --apply 를 함께 쓸 수 없습니다. 확인이 먼저입니다.')

// ── env ──
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
// ══ SQL 계약 — 🔴 **DB 에 연결하기 전에 본다** ══
/**
 * 🔴 순서가 계약이다. 잘못된 SQL 때문에 production DB 에 **연결조차 하지 않는다** —
 *    연결한 뒤에 보면, 그 사이에 무엇이 열렸는지를 설명해야 한다.
 *
 * 🔴 구문의 *시작*만 보지 않는다. 앞선 판의 화이트리스트는 `^CREATE TABLE` 인지만
 *    봐서 `CREATE TABLE "Evil"` 도, `CREATE INDEX ... ON "User"` 도 통과했다.
 *    판정은 순수 함수(judgeMigration0025Sql)가 하고, fixture 가 차단 경로를 시험한다.
 */
const sql = readFileSync(SQL_PATH, 'utf-8')
const sqlVerdict = judgeMigration0025Sql(sql)
for (const f of sqlVerdict.findings) {
  if (!f.ok) console.error(`   ❌ ${f.detail}`)
}
if (!sqlVerdict.ok) fail(`${sqlVerdict.summary}\n   🔴 DB 에 연결하지 않았습니다.`)
ok(sqlVerdict.summary)

const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const directUrl = process.env.DIRECT_URL?.trim()
if (!directUrl) fail('DIRECT_URL 이 없습니다.')

/**
 * 🔴 **다른 프로젝트에 쏘지 않는다 — 못 알아보면 멈춘다.**
 *    host 와 pooler 사용자 이름 양쪽을 본다. 둘 다 못 읽으면 fail-closed 다.
 * 🔴 URL 원문과 자격증명은 출력하지 않는다 — 판별 결과만 말한다.
 */
let parsed
try {
  parsed = new URL(directUrl)
} catch {
  fail('DIRECT_URL 을 주소로 읽지 못했습니다 [OBSERVATION_FAILED]')
}
const refVerdict = judgeProjectRef(parsed, EXPECTED_PROJECT_REF)
if (!refVerdict.ok) fail(`${refVerdict.reason} [OBSERVATION_FAILED]`)
ok(refVerdict.reason)

const client = new pg.Client({ connectionString: directUrl, ssl: { rejectUnauthorized: false } })

/**
 * 🔴 **어떤 경로에서도 raw stack trace 로 끝나지 않는다.**
 *    운영자가 볼 것은 판정이지 `parse_relation.c` 가 아니다.
 */
process.on('unhandledRejection', (e) => {
  console.error(`\n🔴 중단: 예상하지 못한 오류 [OBSERVATION_FAILED] — ${e?.message ?? e}\n`)
  process.exit(1)
})

/**
 * 보호 테이블의 행 수 — 🔴 **하나라도 못 읽으면 던진다** (결함 D 정정).
 *
 *    앞선 판은 테이블이 없으면 `null` 을 넣었다. 그러면 적용 전후가 **둘 다 null**
 *    이라 "변하지 않았다" 로 통과한다 — 실제로는 그 테이블을 한 번도 못 본 것이다.
 *    보호하겠다고 적어 둔 목록이 보호를 하지 않는 상태였다.
 *
 * 🔴 `User` · `Post` 는 반드시 있다. 없다면 다른 DB 를 보고 있거나 권한이 없는 것이고,
 *    둘 다 진행하면 안 되는 상황이다 — 조용히 넘기지 않고 멈춘다.
 *
 * 🔴 던지는 것이 계약이다. 트랜잭션 **안**에서 불릴 때는 이 throw 가 곧 ROLLBACK 이다
 *    (applyWithVerification 이 관측 실패를 되돌림으로 다룬다).
 */
async function counts() {
  const out = {}
  for (const t of PROTECTED_TABLES) {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t])
    if (rows.length === 0) {
      throw new Error(`보호 테이블 ${t} 가 없다 — 다른 DB 를 보고 있거나 권한이 없다`)
    }
    const { rows: c } = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)
    out[t] = c[0]?.n
  }
  // 🔴 판정은 순수 함수가 한다 — fixture 가 같은 규칙을 DB 없이 시험할 수 있어야 한다
  const verdict = judgeProtectedCounts(out)
  if (!verdict.ok) throw new Error(verdict.reason)
  return out
}

/**
 * 🔴 **없는 것을 "못 읽었다" 로 만들지 않는다.**
 *    테이블이 없으면 컬럼 조회는 빈 배열을 돌려주는데, 그때는 `columns: null` 로
 *    넘겨 판정이 "테이블 없음" 을 곧바로 읽게 한다.
 */
async function state() {
  const { rows: tbl } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [NEW_TABLE])
  const hasTable = tbl.length > 0

  // enum 라벨 — 🔴 정의 순서 그대로 (enumsortorder)
  const { rows: labels } = await client.query(
    `SELECT e.enumlabel AS label
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = $1
      ORDER BY e.enumsortorder`, [NEW_ENUM])
  const enumLabels = labels.length > 0 ? labels.map((r) => r.label) : null

  if (!hasTable) {
    return { table: null, enumLabels, columns: null, indexes: null, foreignKeys: null, constraints: null, rowCount: null }
  }

  const { rows: cols } = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default,
            datetime_precision
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY column_name`, [NEW_TABLE])
  /**
   * 인덱스 — 🔴 **이름만 읽지 않는다** (결함 B 정정).
   *
   *    `pg_indexes.indexname` 만 보면 같은 이름으로 **다른 컬럼**에 걸린 인덱스가
   *    통과한다. 이름은 맞는데 홈 조회가 그 인덱스를 타지 못해 조용히 느려진다.
   *
   * 🔴 컬럼 순서는 `ORDER BY k.ord` 로 인덱스 정의 순서 그대로 읽는다 —
   *    복합 인덱스는 앞 컬럼부터 쓰이므로 순서가 곧 성능이다.
   */
  const { rows: idx } = await client.query(
    `SELECT c.relname                          AS name,
            t.relname                          AS "table",
            i.indisprimary                     AS "isPrimary",
            i.indisunique                      AS "isUnique",
            array_agg(a.attname ORDER BY k.ord) AS columns
       FROM pg_index i
       JOIN pg_class c   ON c.oid = i.indexrelid
       JOIN pg_class t   ON t.oid = i.indrelid
       JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indrelid = to_regclass($1)
      GROUP BY c.relname, t.relname, i.indisprimary, i.indisunique
      ORDER BY c.relname`, [`public."${NEW_TABLE}"`])

  // FK — 🔴 참조 대상과 ON DELETE / ON UPDATE 동작까지 읽는다
  const { rows: fks } = await client.query(
    `SELECT c.conname,
            a.attname                          AS column,
            rel.relname                        AS "referencedTable",
            ra.attname                         AS "referencedColumn",
            c.confdeltype, c.confupdtype
       FROM pg_constraint c
       JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
       JOIN pg_class     rel ON rel.oid = c.confrelid
       JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
      WHERE c.conrelid = to_regclass($1) AND c.contype='f'
      ORDER BY c.conname`, [`public."${NEW_TABLE}"`])

  /**
   * 🔴 **모든 제약을 읽는다** (결함 B 정정).
   *    FK 만 보면 나중에 손으로 붙인 `CHECK (false)` 를 못 본다 —
   *    스키마 검사는 "정상" 인데 운영자는 배너를 한 건도 저장할 수 없다.
   */
  const { rows: cons } = await client.query(
    `SELECT conname AS name, contype AS type
       FROM pg_constraint
      WHERE conrelid = to_regclass($1)
      ORDER BY conname`, [`public."${NEW_TABLE}"`])

  const { rows: n } = await client.query(`SELECT COUNT(*)::int AS n FROM "${NEW_TABLE}"`)

  return {
    table: NEW_TABLE,
    enumLabels,
    columns: cols,
    indexes: idx,
    foreignKeys: fks,
    constraints: cons,
    rowCount: n[0]?.n,
  }
}

try {
  await client.connect()
} catch (e) {
  fail(`DB 에 연결하지 못했습니다 [OBSERVATION_FAILED] — ${e.message}`)
}

// 🔴 SQL 계약은 연결 전에 이미 통과했다 (위 §SQL 계약). 여기서 다시 보지 않는다.

// ── 관측 ──
const observed = await (async () => {
  try {
    return { st: await state(), ct: await counts() }
  } catch (e) {
    // 🔴 못 읽은 것을 "없다" 로 읽지 않는다
    await client.end().catch(() => {})
    fail(`스키마를 관측하지 못했습니다 [OBSERVATION_FAILED] — ${e.message}`)
    return null
  }
})()
const before = observed.st
const beforeCounts = observed.ct

console.log(`\n현재  enum ${before.enumLabels ? '있음' : '없음'} · 테이블 ${before.table ? '있음' : '없음'} · 컬럼 ${before.columns?.length ?? 0} · 인덱스 ${before.indexes?.length ?? 0} · FK ${before.foreignKeys?.length ?? 0}`)
console.log(`      기존 row: ${Object.entries(beforeCounts).map(([k, v]) => `${k} ${v ?? '-'}`).join(' · ')}`)

const verdict = judgeMigration0025State(before)

// ══ --check ══
if (CHECK) {
  console.log(`\n══ 검증 (--check) — ${MIGRATION_ID} ══`)
  for (const f of verdict.findings) console.log(`   ${f.ok ? '✅' : '❌'} ${f.detail}`)
  console.log(`\n상태  ${verdict.state}`)
  console.log(`      ${verdict.summary}`)
  if (verdict.state === 'NOT_APPLIED') {
    console.log('\n   🟡 아직 적용하지 않았습니다. 적용은 창업자 승인 뒤 --apply 로만 합니다.')
  }
  if (verdict.state === 'PARTIAL_OR_INVALID') {
    console.log('\n   🔴 손으로 확인하세요. --apply 는 이 상태에서 돌지 않습니다.')
  }
  console.log('')
  await client.end()
  // 🔴 미적용도 통과가 아니다 — 확인했다는 뜻이지 준비됐다는 뜻이 아니다
  process.exit(verdict.exitCode)
}

// ══ 적용 자격 ══
if (verdict.state === 'APPLIED_AND_VALID') {
  await client.end()
  fail('이미 적용되어 있습니다. --check 로 확인하세요.')
}
if (verdict.state !== 'NOT_APPLIED') {
  await client.end()
  // 🔴 enum 만 있거나 테이블만 있는 상태 — 뭉개지 않고 사람에게 넘긴다
  fail(`${verdict.state} 입니다 — ${verdict.summary}. 손으로 확인하세요.`)
}
ok('미적용 상태 — 적용 가능')

if (!APPLY) {
  await client.end()
  console.log('\n🟡 dry-run 입니다. DB 변경 0 · 적용하려면 --apply 를 붙이세요.\n')
  console.log(`   적용 예정: enum ${NEW_ENUM} 1개 · 테이블 ${NEW_TABLE} 1개`)
  console.log(`             컬럼 ${EXPECTED_COLUMNS.length}개 · 인덱스 ${EXPECTED_INDEX_SPECS.length}개(PK 포함) · FK ${EXPECTED_FOREIGN_KEYS.length}개(SET NULL)`)
  console.log('   🔴 신규 생성만 합니다. 기존 테이블은 어떤 것도 ALTER 하지 않습니다.\n')
  process.exit(0)
}

// ══ 적용 — 🔴 **COMMIT 전에 검증한다** ══
/**
 * 🔴 순서·commit/rollback 횟수는 `applyWithVerification` 한 곳이 정한다.
 *    CLI 는 BEGIN·COMMIT 을 직접 쓰지 않는다 — 두 곳이면 순서가 갈린다.
 * 🔴 판정 함수를 주입한다. 그러지 않으면 0024 판정이 0025 스키마를 보게 된다.
 */
console.log('\n══ 적용 (🔴 COMMIT 전 검증) ══')
const applied = await applyWithVerification({
  exec: async (text) => client.query(text),
  sql: body,
  observe: state,
  countTables: counts,
  beforeCounts,
  // 🔴 적용 직후에는 **빈 테이블까지** 요구한다 — 행이 있으면 이번 실행의 결과가 아니다
  judge: judgeMigration0025ApplyState,
})

console.log(`   호출 순서  ${applied.calls.join(' → ')}`)
console.log(`   COMMIT ${applied.committed} · ROLLBACK ${applied.rolledBack}`)

if (!applied.ok) {
  await client.end().catch(() => {})
  // 🔴 COMMIT 하지 않았다. 스키마는 적용 전 그대로다
  fail(`${applied.reason} [${applied.state ?? 'FAILED'}] · COMMIT ${applied.committed}`)
}
ok(applied.reason)

// ── 🔴 COMMIT 뒤 read-only 최종 확인 ──
const finalVerdict = await (async () => {
  try {
    return judgeMigration0025ApplyState(await state())
  } catch {
    return null
  }
})()
if (finalVerdict === null) {
  await client.end().catch(() => {})
  fail('COMMIT 은 됐는데 최종 확인을 관측하지 못했습니다 [OBSERVATION_FAILED] — --check 로 확인하세요.')
}
console.log(`\n최종 확인  ${finalVerdict.state}`)
for (const f of finalVerdict.findings) console.log(`   ${f.ok ? '✅' : '❌'} ${f.detail}`)
if (finalVerdict.state !== 'APPLIED_AND_VALID') {
  await client.end().catch(() => {})
  fail(`COMMIT 뒤 상태가 ${finalVerdict.state} 입니다 — ${finalVerdict.summary}`)
}

await client.end()
console.log('\n✅ 적용했습니다. COMMIT 전 검증 통과 · 최종 확인 APPLIED_AND_VALID\n')
