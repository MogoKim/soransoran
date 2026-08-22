#!/usr/bin/env node
/**
 * migration SQL 적용 스크립트
 *
 * 이 프로젝트는 Prisma CLI 마이그레이션(migrate deploy / db push / db seed)을 쓰지 않는다.
 * migration.sql 을 pg 로 직접 실행하고 information_schema 로 결과를 검증한다.
 *
 * 사용법
 *   node scripts/apply-migration.mjs            # dry-run (기본) — 검사만 하고 아무것도 바꾸지 않는다
 *   node scripts/apply-migration.mjs --apply    # 실제 적용
 *
 * 안전장치
 *   1. DIRECT_URL 만 읽는다. 값은 화면에 출력하지 않는다
 *   2. 접속 URL 의 project ref 가 EXPECTED_PROJECT_REF 와 일치해야 진행한다
 *   3. pooler 포트(6543)면 중단한다 — DDL 은 direct(5432)로 실행해야 한다
 *   4. public 스키마에 테이블이 이미 있으면 중단한다 (빈 DB 에만 적용)
 *   5. 전체를 하나의 트랜잭션으로 감싼다 — 중간 실패 시 전부 롤백된다
 *   6. --apply 없이는 어떤 쓰기도 하지 않는다
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = join(__dirname, '..', 'prisma', 'migrations', '0001_init', 'migration.sql')

/** 창업자가 확인한 소란소란 Supabase 프로젝트 ref */
const EXPECTED_PROJECT_REF = 'buougdxmfobjilgjnnby'

const EXPECTED_TABLES = [
  'Account', 'Comment', 'Like', 'Post', 'Report', 'Session', 'User', 'UserBlock',
]
const EXPECTED_ENUMS = ['AuthorSource', 'BoardType', 'PostStatus', 'ReportStatus']

const APPLY = process.argv.includes('--apply')

function fail(message) {
  console.error(`\n🔴 중단: ${message}\n`)
  process.exit(1)
}

function ok(message) {
  console.log(`   ✅ ${message}`)
}

// ── 1. 접속 정보 검사 (값은 출력하지 않는다) ──────────────────
const directUrl = process.env.DIRECT_URL?.trim()
if (!directUrl) fail('DIRECT_URL 이 설정되지 않았습니다.')

let parsed
try {
  parsed = new URL(directUrl)
} catch {
  fail('DIRECT_URL 형식이 올바르지 않습니다.')
}

// Supabase 호스트는 db.<ref>.supabase.co 또는 pooler 형태다.
const refFromHost = parsed.hostname.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1]
const refFromUser = decodeURIComponent(parsed.username).match(/\.([a-z0-9]{20,})$/i)?.[1]
const projectRef = refFromHost ?? refFromUser

console.log('\n═══ 접속 대상 검사 ═══')
console.log(`   host      ${parsed.hostname}`)
console.log(`   port      ${parsed.port || '(기본)'}`)
console.log(`   database  ${parsed.pathname.replace(/^\//, '') || '(기본)'}`)
console.log(`   ref       ${projectRef ?? '(판별 실패)'}`)

if (!projectRef) fail('project ref 를 판별할 수 없습니다. DIRECT_URL 을 확인하세요.')
if (projectRef !== EXPECTED_PROJECT_REF) {
  fail(
    `project ref 불일치.\n   기대: ${EXPECTED_PROJECT_REF}\n   실제: ${projectRef}\n` +
      '   🔴 다른 데이터베이스(우나어 등)에 실행될 위험이 있습니다.',
  )
}
ok(`project ref 일치 (${EXPECTED_PROJECT_REF})`)

if (parsed.port === '6543') {
  fail('pooler 포트(6543)입니다. DDL 은 direct 포트(5432)로 실행해야 합니다.')
}
ok('direct 포트 확인')

// ── 2. SQL 파일 검사 ────────────────────────────────────────
const sql = readFileSync(SQL_PATH, 'utf8')
const destructive = sql.match(/^\s*(DROP|TRUNCATE|DELETE)\b/gim) ?? []
console.log('\n═══ SQL 검사 ═══')
console.log(`   파일      ${SQL_PATH.replace(process.cwd() + '/', '')}`)
console.log(`   길이      ${sql.split('\n').length}행`)
console.log(`   CREATE TABLE  ${(sql.match(/^CREATE TABLE/gim) ?? []).length}`)
console.log(`   CREATE TYPE   ${(sql.match(/^CREATE TYPE/gim) ?? []).length}`)
console.log(`   CREATE INDEX  ${(sql.match(/^CREATE (UNIQUE )?INDEX/gim) ?? []).length}`)
if (destructive.length) fail(`파괴적 구문 ${destructive.length}건이 있습니다: ${destructive.join(', ')}`)
ok('파괴적 구문 0건')

// ── 3. 연결 · 사전 상태 확인 ────────────────────────────────
const client = new pg.Client({
  connectionString: directUrl,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 60_000,
})

async function listTables() {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  )
  return rows.map((r) => r.table_name)
}

async function listEnums() {
  const { rows } = await client.query(
    `SELECT t.typname FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typtype = 'e' AND n.nspname = 'public'
     ORDER BY t.typname`,
  )
  return rows.map((r) => r.typname)
}

async function main() {
  await client.connect()

  console.log('\n═══ 사전 상태 ═══')
  const before = await listTables()
  const enumsBefore = await listEnums()
  console.log(`   public 테이블  ${before.length}개 ${before.length ? '→ ' + before.join(', ') : ''}`)
  console.log(`   public enum    ${enumsBefore.length}개`)

  if (before.length > 0) {
    fail(
      `대상 DB 가 비어 있지 않습니다 (테이블 ${before.length}개).\n` +
        '   빈 DB 에만 적용하도록 설계된 스크립트입니다.',
    )
  }
  ok('빈 DB 확인')

  if (!APPLY) {
    console.log('\n═══ DRY-RUN 종료 ═══')
    console.log('   아무것도 변경하지 않았습니다.')
    console.log('   실제 적용하려면: node scripts/apply-migration.mjs --apply\n')
    return
  }

  // ── 4. 적용 (단일 트랜잭션) ──────────────────────────────
  console.log('\n═══ 적용 ═══')
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    ok('트랜잭션 COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    fail(`실행 실패로 ROLLBACK 했습니다.\n   ${err.message}`)
  }

  // ── 5. 사후 검증 ────────────────────────────────────────
  console.log('\n═══ 사후 검증 ═══')
  const after = await listTables()
  const enumsAfter = await listEnums()

  const missingTables = EXPECTED_TABLES.filter((t) => !after.includes(t))
  const extraTables = after.filter((t) => !EXPECTED_TABLES.includes(t) && t !== '_prisma_migrations')
  const missingEnums = EXPECTED_ENUMS.filter((e) => !enumsAfter.includes(e))

  console.log(`   테이블  ${after.length}개 → ${after.join(', ')}`)
  console.log(`   enum    ${enumsAfter.length}개 → ${enumsAfter.join(', ')}`)

  if (missingTables.length) fail(`누락 테이블: ${missingTables.join(', ')}`)
  if (missingEnums.length) fail(`누락 enum: ${missingEnums.join(', ')}`)
  if (extraTables.length) console.log(`   ⚠️ 예상 밖 테이블: ${extraTables.join(', ')}`)
  ok(`테이블 ${EXPECTED_TABLES.length}개 · enum ${EXPECTED_ENUMS.length}개 전부 생성 확인`)

  // 행 수는 전부 0이어야 한다 (seed 하지 않는다)
  for (const t of EXPECTED_TABLES) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)
    if (rows[0].n !== 0) fail(`${t} 에 데이터가 ${rows[0].n}행 있습니다. seed 는 하지 않습니다.`)
  }
  ok('전 테이블 0행 확인 (seed 없음)')

  console.log('\n✅ 완료\n')
}

main()
  .catch((err) => fail(err.message))
  .finally(() => client.end().catch(() => {}))
