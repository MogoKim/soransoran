#!/usr/bin/env node
/**
 * 0023_original_post_match 적용 — 매칭 결과 컬럼 3개 + 인덱스 + FK
 *
 *   node scripts/apply-migration-0023.mjs            # dry-run (기본)
 *   node scripts/apply-migration-0023.mjs --apply    # 실제 적용
 *   node scripts/apply-migration-0023.mjs --check    # 반영 검증
 *
 * 🔴 prisma migrate · db push · db seed 를 쓰지 않는다 (/prisma-guide).
 *    pg 모듈로 직접 실행하고 information_schema 로 검증한다.
 *
 * 🔴 **0022 스크립트를 재사용하지 않는 이유**
 *    0022 는 "신규 테이블 밖 ALTER 금지" 가드를 쓴다 — 신규 생성만 하는 마이그레이션이었다.
 *    0023 은 **기존 테이블을 ALTER** 하므로 그 가드가 성립하지 않는다.
 *    가드를 느슨하게 고치는 것이 아니라, **대상 테이블을 못박은 스크립트를 따로** 만든다.
 *
 * 🔴 ALTER 는 OriginalPostApprovalQueue 하나만 허용한다.
 *    Persona 는 FK 로 참조만 한다 — ALTER 하지 않는다.
 * 🔴 기존 테이블 row count 가 하나라도 변하면 실패로 본다.
 * 🔴 --apply 없이는 어떤 쓰기도 하지 않는다.
 */
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = join(__dirname, '..', 'prisma', 'migrations', '0023_original_post_match', 'migration.sql')
const EXPECTED_PROJECT_REF = 'buougdxmfobjilgjonby'

/** 🔴 이 테이블 하나만 ALTER 한다 */
const TARGET_TABLE = 'OriginalPostApprovalQueue'
/** 🔴 FK 로 참조만 한다. ALTER 대상이 아니다 */
const REFERENCED_TABLE = 'Persona'

const NEW_COLUMNS = ['matchedPersonaId', 'matchedAt', 'matchMeta']
const NEW_INDEX = 'OriginalPostApprovalQueue_matchedPersonaId_matchedAt_idx'
const NEW_FK = 'OriginalPostApprovalQueue_matchedPersonaId_fkey'

/** 🔴 이 테이블들의 row count 는 변하면 안 된다 */
const PROTECTED_TABLES = [
  'User', 'Post', 'Comment', 'Persona',
  'MicroSeedRawContent', 'MicroSeedCandidate', 'OriginalPostApprovalQueue',
]

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
  const { rows: cols } = await client.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY column_name`, [TARGET_TABLE])
  const { rows: idx } = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`, [TARGET_TABLE])
  const { rows: fk } = await client.query(
    `SELECT conname, confdeltype FROM pg_constraint
      WHERE conrelid = to_regclass($1) AND contype='f' ORDER BY conname`, [`public."${TARGET_TABLE}"`])
  return { cols, idx, fk }
}

await client.connect()

// ── SQL 읽기 · 구문 가드 ──
const sql = readFileSync(SQL_PATH, 'utf-8')
const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

// 🔴 ALTER 대상이 하나뿐인가
const altered = [...body.matchAll(/ALTER TABLE\s+"([A-Za-z]+)"/g)].map((m) => m[1])
const badAlter = [...new Set(altered)].filter((t) => t !== TARGET_TABLE)
if (badAlter.length > 0) { await client.end(); fail(`${TARGET_TABLE} 밖 ALTER 가 있습니다: ${badAlter.join(', ')}`) }
// 🔴 Persona · Post · MicroSeedCandidate 는 이름만으로도 ALTER 대상에 없어야 한다
for (const t of [REFERENCED_TABLE, 'Post', 'MicroSeedCandidate', 'MicroSeedRawContent', 'User', 'Comment']) {
  if (new RegExp(`ALTER TABLE\\s+"${t}"`).test(body)) { await client.end(); fail(`🔴 ${t} 를 ALTER 합니다`) }
}
ok(`ALTER 대상 ${TARGET_TABLE} 하나뿐 · ${REFERENCED_TABLE} 는 참조만`)

// 🔴 허용 구문 화이트리스트 — DROP TABLE · TRUNCATE · DELETE · UPDATE · INSERT 가 섞이면 중단
const statements = body.split(';').map((s) => s.trim()).filter((s) => s !== '')
const ALLOWED = /^(ALTER TABLE|CREATE INDEX|CREATE UNIQUE INDEX)\b/i
const notAllowed = statements.filter((s) => !ALLOWED.test(s))
if (notAllowed.length > 0) {
  await client.end()
  fail(`허용 구문만(ALTER TABLE · CREATE INDEX) 사용할 수 있습니다 — ${notAllowed.length}건 발견`)
}
// 🔴 "DROP CONSTRAINT IF EXISTS" 는 멱등을 위한 것이고 파괴 구문이 아니다.
//    막아야 하는 것은 **구문의 시작**이 DROP TABLE · TRUNCATE · DELETE · UPDATE · INSERT 인 경우다.
const destructive = statements.filter((s) => /^(DROP\s+TABLE|TRUNCATE|DELETE|UPDATE|INSERT)\b/i.test(s))
if (destructive.length > 0) { await client.end(); fail(`파괴 구문이 있습니다: ${destructive.length}건`) }
// 🔴 DROP COLUMN 은 되돌릴 수 없다
if (/DROP\s+COLUMN/i.test(body)) { await client.end(); fail('DROP COLUMN 이 있습니다') }
ok(`구문 ${statements.length}건 · 전부 허용 구문 · 파괴 구문 0 · DROP COLUMN 0`)

// 🔴 원문 본문 컬럼을 만들지 않는가
if (/"(rawTitle|rawBody|sourceTexts|sourceUrl|authorName|originalTitle)"/i.test(body)) {
  await client.end()
  fail('원문 저장 컬럼이 SQL 에 있습니다 — sourceRawContentId 참조만 둡니다.')
}
// 🔴 발행을 만들지 않는가
if (/"(createdPostId|permanentNoindex|isMicroSeed)"/i.test(body)) {
  await client.end()
  fail('발행 관련 컬럼을 건드립니다 — 배정은 발행이 아닙니다.')
}
ok('원문 저장 컬럼 0 · 발행 컬럼 0')

// ── 선행 조건 ──
for (const t of [TARGET_TABLE, REFERENCED_TABLE]) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t])
  if (rows.length === 0) { await client.end(); fail(`${t} 테이블이 없습니다.`) }
}
ok(`선행 조건 — ${TARGET_TABLE} · ${REFERENCED_TABLE} 존재`)

const before = await state()
const beforeCounts = await counts()
const beforeCols = before.cols.map((c) => c.column_name)
console.log(`\n현재  컬럼 ${before.cols.length} · 인덱스 ${before.idx.length} · FK ${before.fk.length}`)
console.log(`      기존 row: ${Object.entries(beforeCounts).map(([k, v]) => `${k} ${v ?? '-'}`).join(' · ')}`)

// ══ --check ══
if (CHECK) {
  let failed = 0
  const good = (m) => ok(m)
  const bad = (m) => { console.log(`   ❌ ${m}`); failed++ }
  console.log('\n══ 검증 (--check) ══')

  const missing = NEW_COLUMNS.filter((c) => !beforeCols.includes(c))
  if (missing.length === 0) good(`컬럼 ${NEW_COLUMNS.length}/${NEW_COLUMNS.length} — ${NEW_COLUMNS.join(', ')}`)
  else bad(`컬럼 누락 ${missing.length}종: ${missing.join(', ')}`)

  // 🔴 nullable 이어야 한다. NOT NULL 이면 기존 7행이 막힌다
  for (const c of NEW_COLUMNS) {
    const col = before.cols.find((x) => x.column_name === c)
    if (col === undefined) continue
    if (col.is_nullable === 'YES') good(`  ${c} nullable · ${col.data_type}`)
    else bad(`🔴 ${c} 가 NOT NULL 입니다 — 기존 행이 막힙니다`)
  }

  const gotIdx = before.idx.map((i) => i.indexname)
  if (gotIdx.includes(NEW_INDEX)) good(`인덱스 ${NEW_INDEX}`)
  else bad(`인덱스 없음: ${NEW_INDEX}`)

  const gotFk = before.fk.find((f) => f.conname === NEW_FK)
  if (gotFk === undefined) bad(`FK 없음: ${NEW_FK}`)
  // confdeltype 'r' = RESTRICT
  else if (gotFk.confdeltype === 'r') good(`FK ${NEW_FK} · ON DELETE RESTRICT`)
  else bad(`🔴 FK 삭제 규칙이 RESTRICT 가 아닙니다: ${gotFk.confdeltype}`)

  // 🔴 기존 컬럼이 사라지지 않았는가
  const EXPECT_OLD = ['id', 'sourceRawContentId', 'status', 'draftTitle', 'draftBody', 'createdPostId', 'dedupKey']
  const lost = EXPECT_OLD.filter((c) => !beforeCols.includes(c))
  if (lost.length === 0) good('기존 컬럼 유실 0')
  else bad(`🔴 기존 컬럼 유실: ${lost.join(', ')}`)

  // 🔴 배정이 발행을 만들지 않았는가
  const { rows: pub } = await client.query(
    `SELECT COUNT(*)::int AS n FROM "${TARGET_TABLE}" WHERE "createdPostId" IS NOT NULL`)
  if (pub[0].n === 0) good('createdPostId 채워진 행 0')
  else bad(`🔴 createdPostId 가 ${pub[0].n}행 채워졌습니다`)

  await client.end()
  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 실패\n`)
  process.exit(failed === 0 ? 0 : 1)
}

// ── 중복 적용 ──
const already = NEW_COLUMNS.filter((c) => beforeCols.includes(c))
if (already.length === NEW_COLUMNS.length) {
  await client.end()
  fail(`이미 적용되어 있습니다 (컬럼 ${already.join(', ')}). --check 로 확인하세요.`)
}
if (already.length > 0) {
  // 🔴 절반만 있는 상태는 조용히 넘기지 않는다. 어쩌다 그렇게 됐는지 사람이 봐야 한다
  await client.end()
  fail(`컬럼이 일부만 있습니다 (${already.join(', ')}). 손으로 확인하세요.`)
}
ok('미적용 상태 — 적용 가능')

if (!APPLY) {
  await client.end()
  console.log('\n🟡 dry-run 입니다. DB 변경 0 · 적용하려면 --apply 를 붙이세요.\n')
  console.log(`   적용 예정: 컬럼 ${NEW_COLUMNS.join(' · ')} · 인덱스 1 · FK 1 (ON DELETE RESTRICT)`)
  console.log('   🔴 배정은 발행이 아닙니다. Post 는 만들지 않습니다.\n')
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
const afterCols = after.cols.map((c) => c.column_name)
console.log(`\n적용 후  컬럼 ${after.cols.length} · 인덱스 ${after.idx.length} · FK ${after.fk.length}`)

// 🔴 기존 테이블 row count 가 변했는가
const moved = Object.keys(beforeCounts).filter((k) => beforeCounts[k] !== afterCounts[k])
if (moved.length > 0) {
  await client.end()
  fail(`기존 테이블 row 가 변했습니다: ${moved.map((k) => `${k} ${beforeCounts[k]}→${afterCounts[k]}`).join(' · ')}`)
}
ok(`기존 테이블 row 불변 — ${Object.entries(afterCounts).map(([k, v]) => `${k} ${v ?? '-'}`).join(' · ')}`)

// 🔴 컬럼이 늘기만 했는가
const lostCols = beforeCols.filter((c) => !afterCols.includes(c))
if (lostCols.length > 0) { await client.end(); fail(`기존 컬럼이 사라졌습니다: ${lostCols.join(', ')}`) }
const addedCols = afterCols.filter((c) => !beforeCols.includes(c))
ok(`컬럼 ${beforeCols.length} → ${afterCols.length} (추가 ${addedCols.join(', ')} · 유실 0)`)

await client.end()
console.log('\n✅ 적용했습니다. --check 로 검증하세요.\n')
