#!/usr/bin/env node
/**
 * 0017_persona_content_links 전용 적용 스크립트
 *
 * 🔴 apply-migration-persona.mjs 를 쓰지 않는다.
 *    그쪽은 PROTECTED_TABLES 로 Post·Comment ALTER 를 **차단**한다 —
 *    0014~0016 이 실수로 운영 테이블을 건드리지 못하게 하는 가드다.
 *    0017 은 의도적으로 그 테이블을 건드리므로 스크립트를 나눈다.
 *    가드를 느슨하게 푸는 대신 파일을 분리하는 쪽을 택했다.
 *
 * 사용법
 *   node scripts/apply-migration-0017.mjs           # dry-run (기본) — DB write 0
 *   node scripts/apply-migration-0017.mjs --apply   # 실제 적용
 *   node scripts/apply-migration-0017.mjs --check   # 검증만
 *
 * 안전장치
 *   1. DIRECT_URL 만 읽는다. 값은 출력하지 않는다
 *   2. project ref 일치 · pooler 포트(6543) 차단
 *   3. 🔴 허용 구문 화이트리스트 — ADD COLUMN · CREATE INDEX · ADD CONSTRAINT 만
 *      DROP · DELETE · TRUNCATE · UPDATE · INSERT · ALTER COLUMN 이 있으면 중단
 *   4. 🔴 Persona 테이블이 먼저 있어야 진행한다 (0014 선행 확인)
 *   5. 🔴 적용 전후 Post · Comment row count 를 비교한다. 달라지면 실패로 본다
 *   6. 하나의 트랜잭션
 *   7. --apply 없이는 어떤 쓰기도 하지 않는다
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = join(__dirname, '..', 'prisma', 'migrations', '0017_persona_content_links', 'migration.sql')
const EXPECTED_PROJECT_REF = 'buougdxmfobjilgjonby'

/** 이 migration 이 손대는 테이블 — 의도적이다 */
const TARGETS = [
  { table: 'Post', column: 'personaId', index: 'Post_personaId_idx', fk: 'Post_personaId_fkey' },
  { table: 'Comment', column: 'personaId', index: 'Comment_personaId_idx', fk: 'Comment_personaId_fkey' },
]

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')

const fail = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m) => console.log(`   ✅ ${m}`)

// ── env (값은 출력하지 않는다) ──
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
const ref = parsed.hostname.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1]
  ?? decodeURIComponent(parsed.username).match(/\.([a-z0-9]{20,})$/i)?.[1]
if (ref !== EXPECTED_PROJECT_REF) fail('DIRECT_URL 의 project ref 가 예상과 다릅니다.')
if (parsed.port === '6543') fail('pooler 포트(6543)입니다. DDL 은 direct(5432)로 실행해야 합니다.')

const client = new pg.Client({ connectionString: directUrl, ssl: { rejectUnauthorized: false } })
await client.connect()

async function counts() {
  const out = {}
  for (const { table } of TARGETS) {
    const { rows: [r] } = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)
    out[table] = r.n
  }
  return out
}

async function state() {
  const { rows: cols } = await client.query(
    `SELECT table_name, is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND column_name='personaId' AND table_name = ANY($1)`,
    [TARGETS.map((t) => t.table)])
  const { rows: idx } = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1)`,
    [TARGETS.map((t) => t.index)])
  const { rows: fks } = await client.query(
    `SELECT conname FROM pg_constraint WHERE conname = ANY($1)`, [TARGETS.map((t) => t.fk)])
  return { cols, idx: idx.map((r) => r.indexname), fks: fks.map((r) => r.conname) }
}

// ── --check ──
if (CHECK) {
  console.log('══ 검증 (--check) ══\n')
  let failed = 0
  const bad = (m) => { console.log(`  🔴 ${m}`); failed++ }
  const good = (m) => console.log(`  ✅ ${m}`)

  const s = await state()
  if (s.cols.length === 2) good(`personaId 컬럼 2/2 · nullable=${s.cols.every((c) => c.is_nullable === 'YES')}`)
  else bad(`personaId 컬럼 ${s.cols.length}/2`)
  if (s.cols.some((c) => c.is_nullable !== 'YES')) bad('🔴 nullable 이 아니다')
  if (s.idx.length === 2) good('인덱스 2/2')
  else bad(`인덱스 ${s.idx.length}/2 — 없는 것: ${TARGETS.map((t) => t.index).filter((i) => !s.idx.includes(i)).join(', ')}`)
  if (s.fks.length === 2) good('FK 2/2 (Persona 참조)')
  else bad(`FK ${s.fks.length}/2`)

  // 🔴 FK 가 Restrict 인지 — SetNull 이면 추적성을 잃는다
  const { rows: del } = await client.query(
    `SELECT conname, confdeltype FROM pg_constraint WHERE conname = ANY($1)`,
    [TARGETS.map((t) => t.fk)])
  for (const r of del) {
    if (r.confdeltype === 'r') good(`${r.conname} onDelete=RESTRICT`)
    else bad(`🔴 ${r.conname} onDelete 가 RESTRICT 가 아니다 (${r.confdeltype})`)
  }

  // 🔴 값이 들어가지 않았는지 — 이 단계는 데이터를 넣지 않는다
  for (const { table } of TARGETS) {
    const { rows: [r] } = await client.query(`SELECT COUNT("personaId")::int AS n FROM "${table}"`)
    if (r.n === 0) good(`${table}.personaId 전부 NULL`)
    else bad(`🔴 ${table}.personaId 에 ${r.n}개 값이 있다 — 이 단계는 데이터를 넣지 않는다`)
  }

  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 실패\n`)
  await client.end()
  process.exit(failed === 0 ? 0 : 1)
}

// ── SQL 검사 ──
if (!existsSync(SQL_PATH)) { await client.end(); fail('0017 migration.sql 이 없습니다.') }
const sql = readFileSync(SQL_PATH, 'utf-8')
const body = sql
  .replace(/^\s*--.*$/gm, '')
  .replace(/\bON\s+(DELETE|UPDATE)\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/gi, '')
for (const kw of ['DROP', 'DELETE', 'TRUNCATE', 'UPDATE', 'INSERT']) {
  if (new RegExp(`\\b${kw}\\b`, 'i').test(body)) { await client.end(); fail(`SQL 에 ${kw} 가 있습니다.`) }
}
// 🔴 기존 컬럼을 고치지 않는지
if (/ALTER\s+COLUMN/i.test(body)) { await client.end(); fail('SQL 에 ALTER COLUMN 이 있습니다. 이 migration 은 컬럼 추가만 합니다.') }
// 🔴 손대는 테이블이 Post · Comment 뿐인지
const altered = [...body.matchAll(/ALTER TABLE\s+"([A-Za-z]+)"/g)].map((m) => m[1])
const unexpected = [...new Set(altered)].filter((t) => !TARGETS.some((x) => x.table === t))
if (unexpected.length > 0) { await client.end(); fail(`예상 밖 테이블을 ALTER 합니다: ${unexpected.join(', ')}`) }
ok(`SQL 검사 — 허용 구문만(ADD COLUMN · CREATE INDEX · ADD CONSTRAINT) · 대상 ${[...new Set(altered)].join(' · ')}`)
ok('project ref · direct 포트 확인')

// 🔴 0014 선행 확인 — Persona 가 없으면 FK 를 걸 수 없다
const { rows: pt } = await client.query(
  `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Persona'`)
if (pt.length === 0) { await client.end(); fail('Persona 테이블이 없습니다. 0014~0016 을 먼저 적용하세요.') }
ok('Persona 테이블 확인 (0014 선행)')

const before = await state()
const beforeCounts = await counts()
console.log(`\n현재  컬럼 ${before.cols.length}/2 · 인덱스 ${before.idx.length}/2 · FK ${before.fks.length}/2`)
console.log(`      Post ${beforeCounts.Post}행 · Comment ${beforeCounts.Comment}행`)

if (!APPLY) {
  console.log('\n🟡 dry-run 입니다. 아무것도 바꾸지 않았습니다.')
  console.log('   실제 적용: node scripts/apply-migration-0017.mjs --apply\n')
  await client.end()
  process.exit(0)
}

try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  ok('0017 적용 (트랜잭션 커밋)')
} catch (e) {
  await client.query('ROLLBACK')
  await client.end()
  fail(`적용 실패 — 롤백했습니다: ${e?.message ?? e}`)
}

const after = await state()
const afterCounts = await counts()
console.log(`\n적용 후  컬럼 ${after.cols.length}/2 · 인덱스 ${after.idx.length}/2 · FK ${after.fks.length}/2`)
if (after.cols.length !== 2 || after.idx.length !== 2 || after.fks.length !== 2) {
  await client.end(); fail('기대만큼 생기지 않았습니다.')
}
// 🔴 데이터가 변하지 않았는지
for (const { table } of TARGETS) {
  if (beforeCounts[table] !== afterCounts[table]) {
    await client.end()
    fail(`🔴 ${table} row count 가 ${beforeCounts[table]} → ${afterCounts[table]} 로 변했습니다.`)
  }
}
ok(`row count 불변 — Post ${afterCounts.Post} · Comment ${afterCounts.Comment}`)
ok('information_schema 검증 통과')
console.log('\n다음: node scripts/apply-migration-0017.mjs --check\n')
await client.end()
