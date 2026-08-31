#!/usr/bin/env node
/**
 * 0013_author_hash_norm 전용 적용 스크립트
 *
 * 🔴 scripts/apply-migration.mjs 를 쓰지 않는다.
 *    그쪽은 0001_init 경로가 하드코딩돼 있고 "테이블이 이미 있으면 중단" 한다.
 *    빈 DB 에 최초 스키마를 세우는 도구라, 이미 운영 중인 DB 의 컬럼 추가에는 맞지 않는다.
 *
 * 이 프로젝트는 Prisma CLI 마이그레이션(migrate deploy / db push / db seed)을 쓰지 않는다.
 * migration.sql 을 pg 로 직접 실행하고 information_schema 로 결과를 검증한다.
 *
 * 사용법
 *   node scripts/apply-migration-0013.mjs           # dry-run (기본) — 아무것도 바꾸지 않는다
 *   node scripts/apply-migration-0013.mjs --apply   # 실제 적용
 *
 * 안전장치
 *   1. DIRECT_URL 만 읽는다. 값은 화면에 출력하지 않는다
 *   2. project ref 가 EXPECTED_PROJECT_REF 와 일치해야 진행한다
 *   3. pooler 포트(6543)면 중단한다 — DDL 은 direct(5432)로 실행해야 한다
 *   4. SQL 에 DROP · DELETE · TRUNCATE · UPDATE 가 있으면 중단한다
 *   5. 대상 테이블 두 개가 실제로 있어야 진행한다
 *   6. 전체를 하나의 트랜잭션으로 감싼다
 *   7. --apply 없이는 어떤 쓰기도 하지 않는다
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = join(__dirname, '..', 'prisma', 'migrations', '0013_author_hash_norm', 'migration.sql')

/**
 * 소란소란 Supabase 프로젝트 ref — 🔴 실측값이다.
 *
 * scripts/apply-migration.mjs 에 적힌 값은 현재 DIRECT_URL 과 한 글자 다르다.
 * 그 파일은 0001_init 이후 쓰이지 않아 드러나지 않았다. 여기서는 실측값을 쓴다.
 * (그쪽 파일은 이 PR 에서 고치지 않는다 — 0001 전용이고 범위 밖이다)
 */
const EXPECTED_PROJECT_REF = 'buougdxmfobjilgjonby'

const TARGETS = [
  { table: 'VoiceSource', column: 'authorHashNorm' },
  { table: 'VoiceCommentSignal', column: 'authorHashNorm' },
]

const APPLY = process.argv.includes('--apply')

function fail(message) {
  console.error(`\n🔴 중단: ${message}\n`)
  process.exit(1)
}
const ok = (m) => console.log(`   ✅ ${m}`)

// ── 1. .env.local 로드 (값은 출력하지 않는다) ──
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

const directUrl = process.env.DIRECT_URL?.trim()
if (!directUrl) fail('DIRECT_URL 이 설정되지 않았습니다.')

let parsed
try { parsed = new URL(directUrl) } catch { fail('DIRECT_URL 형식이 올바르지 않습니다.') }

const refFromHost = parsed.hostname.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1]
const refFromUser = decodeURIComponent(parsed.username).match(/\.([a-z0-9]{20,})$/i)?.[1]
const ref = refFromHost ?? refFromUser
if (ref !== EXPECTED_PROJECT_REF) fail('DIRECT_URL 의 project ref 가 예상과 다릅니다.')
ok('project ref 확인')

if (parsed.port === '6543') fail('pooler 포트(6543)입니다. DDL 은 direct(5432)로 실행해야 합니다.')
ok('direct 포트 확인')

// ── 2. SQL 내용 검사 ──
const sql = readFileSync(SQL_PATH, 'utf-8')
const body = sql.replace(/^\s*--.*$/gm, '')
for (const bad of ['DROP', 'DELETE', 'TRUNCATE', 'UPDATE', 'INSERT']) {
  if (new RegExp(`\\b${bad}\\b`, 'i').test(body)) fail(`SQL 에 ${bad} 가 있습니다. 이 migration 은 컬럼 추가만 합니다.`)
}
const addCount = (body.match(/ADD COLUMN IF NOT EXISTS/gi) ?? []).length
if (addCount !== TARGETS.length) fail(`ADD COLUMN IF NOT EXISTS 가 ${TARGETS.length}개여야 하는데 ${addCount}개입니다.`)
ok(`SQL 검사 — 컬럼 추가 ${addCount}개 · 파괴적 구문 없음`)

// ── 3. 접속 · 현재 상태 확인 ──
const client = new pg.Client({ connectionString: directUrl, ssl: { rejectUnauthorized: false } })
await client.connect()

const { rows: tables } = await client.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_name = ANY($1)`,
  [TARGETS.map((t) => t.table)],
)
if (tables.length !== TARGETS.length) {
  await client.end()
  fail(`대상 테이블이 없습니다. 있어야 할 것: ${TARGETS.map((t) => t.table).join(', ')}`)
}
ok('대상 테이블 확인')

async function columnState() {
  const { rows } = await client.query(
    `SELECT table_name, column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema='public' AND column_name = $1 AND table_name = ANY($2)`,
    ['authorHashNorm', TARGETS.map((t) => t.table)],
  )
  return rows
}

const before = await columnState()
console.log(`\n현재 authorHashNorm 컬럼: ${before.length}/${TARGETS.length}`)
for (const r of before) console.log(`   ${r.table_name}.${r.column_name}  ${r.data_type}  nullable=${r.is_nullable}`)

// ── 4. 적용 ──
if (!APPLY) {
  console.log('\n🟡 dry-run 입니다. 아무것도 바꾸지 않았습니다.')
  console.log('   실제 적용: node scripts/apply-migration-0013.mjs --apply\n')
  await client.end()
  process.exit(0)
}

try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  await client.end()
  fail(`적용 실패 — 롤백했습니다: ${e?.message ?? e}`)
}
ok('적용 완료 (트랜잭션 커밋)')

const after = await columnState()
console.log(`\n적용 후 authorHashNorm 컬럼: ${after.length}/${TARGETS.length}`)
for (const r of after) console.log(`   ${r.table_name}.${r.column_name}  ${r.data_type}  nullable=${r.is_nullable}`)
if (after.length !== TARGETS.length) { await client.end(); fail('컬럼이 기대만큼 생기지 않았습니다.') }
if (after.some((r) => r.is_nullable !== 'YES')) { await client.end(); fail('컬럼이 nullable 이 아닙니다.') }
ok('information_schema 검증 통과')

console.log('\n다음: node scripts/author-hash-norm-backfill.mjs   (dry-run)\n')
await client.end()
