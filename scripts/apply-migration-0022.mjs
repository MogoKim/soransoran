#!/usr/bin/env node
/**
 * 0022_original_post_queue 적용 — 오리지널 초안 검수 대기열 테이블 1개 + enum 1개
 *
 *   node scripts/apply-migration-0022.mjs            # dry-run (기본)
 *   node scripts/apply-migration-0022.mjs --apply    # 실제 적용
 *   node scripts/apply-migration-0022.mjs --check    # 반영 검증
 *
 * 🔴 prisma migrate · db push · db seed 를 쓰지 않는다 (/prisma-guide).
 *    pg 모듈로 직접 실행하고 information_schema 로 검증한다.
 *
 * 🔴 이 마이그레이션은 **신규 생성만** 한다.
 *    기존 테이블을 ALTER 하는 구문이 하나라도 있으면 중단한다.
 * 🔴 기존 테이블 row count 가 하나라도 변하면 실패로 본다.
 * 🔴 --apply 없이는 어떤 쓰기도 하지 않는다.
 */
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = join(__dirname, '..', 'prisma', 'migrations', '0022_original_post_queue', 'migration.sql')
const EXPECTED_PROJECT_REF = 'buougdxmfobjilgjonby'

const NEW_TABLE = 'OriginalPostApprovalQueue'
const NEW_ENUM = 'OriginalPostCandidateStatus'
/** 🔴 이 테이블들의 row count 는 변하면 안 된다 */
const PROTECTED_TABLES = ['User', 'Post', 'Comment', 'Persona', 'MicroSeedRawContent', 'MicroSeedCandidate']

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')

const fail = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m) => console.log(`   ✅ ${m}`)

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
const directUrl = process.env.DIRECT_URL?.trim()
if (!directUrl) fail('DIRECT_URL 이 없습니다.')

// 🔴 다른 프로젝트에 쏘지 않는다
const parsed = new URL(directUrl)
const ref = parsed.hostname.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1]
if (ref !== undefined && ref !== EXPECTED_PROJECT_REF) {
  fail(`예상과 다른 Supabase 프로젝트입니다 (${ref})`)
}

const client = new pg.Client({ connectionString: directUrl, ssl: { rejectUnauthorized: false } })

async function counts() {
  const out = {}
  for (const t of PROTECTED_TABLES) {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t])
    if (rows.length === 0) { out[t] = null; continue }
    const { rows: c } = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)
    out[t] = c[0].n
  }
  return out
}

async function state() {
  const { rows: tbl } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [NEW_TABLE])
  const { rows: enm } = await client.query(`SELECT 1 FROM pg_type WHERE typname=$1`, [NEW_ENUM])
  const { rows: cols } = await client.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY column_name`, [NEW_TABLE])
  const { rows: idx } = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`, [NEW_TABLE])
  const { rows: fk } = await client.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = to_regclass($1) AND contype='f'`, [`public."${NEW_TABLE}"`])
  return { table: tbl.length > 0, enumExists: enm.length > 0, cols, idx, fk }
}

await client.connect()

// ── SQL 읽기 · 구문 가드 ──
const sql = readFileSync(SQL_PATH, 'utf-8')
const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

// 🔴 기존 테이블을 건드리는 구문이 있는가
const altered = [...body.matchAll(/ALTER TABLE\s+"([A-Za-z]+)"/g)].map((m) => m[1])
const badAlter = [...new Set(altered)].filter((t) => t !== NEW_TABLE)
if (badAlter.length > 0) { await client.end(); fail(`신규 테이블 밖 ALTER 가 있습니다: ${badAlter.join(', ')}`) }

// 🔴 허용 구문 화이트리스트 — DROP · TRUNCATE · UPDATE · DELETE 가 섞이면 중단
const statements = body.split(';').map((s) => s.trim()).filter((s) => s !== '')
const ALLOWED = /^(CREATE TYPE|CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|ALTER TABLE)\b/i
const notAllowed = statements.filter((s) => !ALLOWED.test(s))
if (notAllowed.length > 0) {
  await client.end()
  fail(`허용 구문만(CREATE TYPE · CREATE TABLE · CREATE INDEX · ALTER TABLE) 사용할 수 있습니다 — ${notAllowed.length}건 발견`)
}
ok(`구문 ${statements.length}건 · 전부 허용 구문 · 신규 테이블 밖 ALTER 0`)

// 🔴 원문 **본문**을 만들지 않는가.
//    sourceRawContentId 는 FK 라 정상이다 — 막는 것은 원문을 복사해 담는 컬럼이다.
if (/"(rawTitle|rawBody|sourceTexts|sourceUrl|authorName|originalTitle)"/i.test(body)) {
  await client.end()
  fail('원문 저장 컬럼이 SQL 에 있습니다 — sourceRawContentId 참조만 둡니다.')
}
ok('원문 저장 컬럼 없음 (rawTitle · rawBody · sourceTexts · sourceUrl · authorName)')

// ── 선행 조건 ──
const { rows: pt } = await client.query(
  `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='MicroSeedRawContent'`)
if (pt.length === 0) { await client.end(); fail('MicroSeedRawContent 테이블이 없습니다.') }
ok('선행 조건 — MicroSeedRawContent 존재')

const before = await state()
const beforeCounts = await counts()
console.log(`\n현재  테이블 ${before.table ? '있음' : '없음'} · enum ${before.enumExists ? '있음' : '없음'} · 컬럼 ${before.cols.length}`)
console.log(`      기존 row: ${Object.entries(beforeCounts).map(([k, v]) => `${k} ${v ?? '-'}`).join(' · ')}`)

// ══ --check ══
if (CHECK) {
  let failed = 0
  const good = (m) => ok(m)
  const bad = (m) => { console.log(`   ❌ ${m}`); failed++ }
  console.log('\n══ 검증 (--check) ══')
  if (before.enumExists) good(`enum ${NEW_ENUM}`)
  else bad(`enum ${NEW_ENUM} 없음`)
  if (before.table) good(`테이블 ${NEW_TABLE}`)
  else bad(`테이블 ${NEW_TABLE} 없음`)

  const EXPECT_COLS = [
    'id', 'sourceRawContentId', 'status', 'draftTitle', 'draftBody',
    'editedTitle', 'editedBody', 'editDiff', 'gateVerdict', 'gateResults',
    'promptVersion', 'model', 'regenCount', 'declineReason', 'decidedBy',
    'decidedAt', 'createdPostId', 'dedupKey', 'createdAt', 'updatedAt',
  ]
  const got = before.cols.map((c) => c.column_name)
  const missing = EXPECT_COLS.filter((c) => !got.includes(c))
  if (missing.length === 0) good(`컬럼 ${EXPECT_COLS.length}/${EXPECT_COLS.length}`)
  else bad(`컬럼 누락 ${missing.length}종: ${missing.join(', ')}`)

  // 🔴 원문 컬럼이 생기지 않았는가
  const leaked = got.filter((c) => /rawTitle|rawBody|sourceText|sourceUrl|author|originalTitle/i.test(c))
  if (leaked.length === 0) good('원문 컬럼 0')
  else bad(`원문 컬럼 ${leaked.length}종: ${leaked.join(', ')}`)

  const EXPECT_IDX = [
    'OriginalPostApprovalQueue_pkey',
    'OriginalPostApprovalQueue_dedupKey_key',
    'OriginalPostApprovalQueue_createdPostId_key',
    'OriginalPostApprovalQueue_status_createdAt_idx',
    'OriginalPostApprovalQueue_sourceRawContentId_createdAt_idx',
  ]
  const gotIdx = before.idx.map((i) => i.indexname)
  const missIdx = EXPECT_IDX.filter((i) => !gotIdx.includes(i))
  if (missIdx.length === 0) good(`인덱스 ${EXPECT_IDX.length}/${EXPECT_IDX.length}`)
  else bad(`인덱스 누락 ${missIdx.length}종: ${missIdx.join(', ')}`)

  if (before.fk.length === 1) good(`FK 1개 (sourceRawContentId → MicroSeedRawContent)`)
  else bad(`FK ${before.fk.length}개`)

  await client.end()
  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 실패\n`)
  process.exit(failed === 0 ? 0 : 1)
}

// ── 중복 적용 ──
if (before.table || before.enumExists) {
  await client.end()
  fail(`이미 적용되어 있습니다 (테이블 ${before.table} · enum ${before.enumExists}). --check 로 확인하세요.`)
}
ok('미적용 상태 — 적용 가능')

if (!APPLY) {
  await client.end()
  console.log('\n🟡 dry-run 입니다. DB 변경 0 · 적용하려면 --apply 를 붙이세요.\n')
  process.exit(0)
}

// ══ 적용 — 🔴 하나의 트랜잭션 ══
console.log('\n══ 적용 ══')
try {
  await client.query('BEGIN')
  await client.query(body)
  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  await client.end()
  fail(`적용 실패 — 롤백했습니다: ${e.message}`)
}
ok('적용 완료')

const after = await state()
const afterCounts = await counts()
console.log(`\n적용 후  테이블 ${after.table ? '있음' : '없음'} · enum ${after.enumExists ? '있음' : '없음'} · 컬럼 ${after.cols.length} · 인덱스 ${after.idx.length} · FK ${after.fk.length}`)

// 🔴 기존 테이블 row count 가 변했는가
const moved = Object.keys(beforeCounts).filter((k) => beforeCounts[k] !== afterCounts[k])
if (moved.length > 0) {
  await client.end()
  fail(`기존 테이블 row 가 변했습니다: ${moved.map((k) => `${k} ${beforeCounts[k]}→${afterCounts[k]}`).join(' · ')}`)
}
ok(`기존 테이블 row 불변 — ${Object.entries(afterCounts).map(([k, v]) => `${k} ${v ?? '-'}`).join(' · ')}`)

const { rows: n } = await client.query(`SELECT COUNT(*)::int AS n FROM "${NEW_TABLE}"`)
ok(`${NEW_TABLE} ${n[0].n}행 (빈 테이블)`)

await client.end()
console.log('\n✅ 적용했습니다. --check 로 검증하세요.\n')
