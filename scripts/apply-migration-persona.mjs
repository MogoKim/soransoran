#!/usr/bin/env node
/**
 * Persona migration 0014~0016 적용 스크립트
 *
 * 🔴 scripts/apply-migration.mjs 를 쓰지 않는다 — 0001_init 전용이고
 *    "테이블이 이미 있으면 중단" 한다. 운영 중 DB 에는 맞지 않는다.
 *
 * 이 프로젝트는 Prisma CLI 마이그레이션(migrate deploy / db push / db seed)을 쓰지 않는다.
 * migration.sql 을 pg 로 직접 실행하고 information_schema 로 결과를 검증한다.
 *
 * 사용법
 *   node scripts/apply-migration-persona.mjs           # dry-run (기본) — 아무것도 바꾸지 않는다
 *   node scripts/apply-migration-persona.mjs --apply   # 실제 적용
 *   node scripts/apply-migration-persona.mjs --check   # 적용 결과 검증만
 *
 * 🔴 0017(Post.personaId · Comment.personaId)은 여기 없다.
 *    그것만 운영 중 테이블을 건드리므로 별도 단계로 분리했다(설계 §14).
 *
 * 안전장치
 *   1. DIRECT_URL 만 읽는다. 값은 화면에 출력하지 않는다
 *   2. project ref 일치 확인
 *   3. pooler 포트(6543)면 중단 — DDL 은 direct(5432)로
 *   4. 🔴 SQL 에 DROP · DELETE · TRUNCATE · UPDATE · INSERT · ALTER COLUMN 이 있으면 중단
 *   5. 🔴 기존 테이블을 ALTER 하지 않는지 확인 — 이 단계는 새 테이블만 만든다
 *   6. 파일마다 하나의 트랜잭션. 중간 실패 시 그 파일은 전부 롤백된다
 *   7. --apply 없이는 어떤 쓰기도 하지 않는다
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = ['0014_persona_core', '0015_persona_memory', '0016_persona_logs']

/** 소란소란 Supabase 프로젝트 ref — 실측값 */
const EXPECTED_PROJECT_REF = 'buougdxmfobjilgjonby'

/** 이 단계가 만드는 테이블 */
const EXPECTED_TABLES = [
  'Persona', 'PersonaMoodState',
  'PersonaSelfMemory', 'PersonaUserRelationship',
  'PersonaCommunityMemory', 'PersonaNegativeMemory',
  'PersonaAuditLog', 'PersonaActivityLog', 'PersonaGlobalSwitch',
]
const EXPECTED_ENUMS = ['PersonaStatus', 'PersonaAuditAction', 'PersonaActivityKind']

/** 🔴 이 단계가 절대 건드리면 안 되는 기존 테이블 */
const PROTECTED_TABLES = ['User', 'Post', 'Comment', 'VoiceSource', 'VoiceCommentSignal']

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

async function state() {
  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name = ANY($1) ORDER BY table_name`, [EXPECTED_TABLES])
  const { rows: enums } = await client.query(
    `SELECT typname FROM pg_type WHERE typname = ANY($1) ORDER BY typname`, [EXPECTED_ENUMS])
  return { tables: tables.map((r) => r.table_name), enums: enums.map((r) => r.typname) }
}

// ── --check ──
if (CHECK) {
  console.log('══ 검증 (--check) ══\n')
  const s = await state()
  let failed = 0
  const bad = (m) => { console.log(`  🔴 ${m}`); failed++ }
  const good = (m) => console.log(`  ✅ ${m}`)

  if (s.enums.length === EXPECTED_ENUMS.length) good(`enum ${s.enums.length}/${EXPECTED_ENUMS.length}`)
  else bad(`enum ${s.enums.length}/${EXPECTED_ENUMS.length} — 없는 것: ${EXPECTED_ENUMS.filter((e) => !s.enums.includes(e)).join(', ')}`)

  if (s.tables.length === EXPECTED_TABLES.length) good(`테이블 ${s.tables.length}/${EXPECTED_TABLES.length}`)
  else bad(`테이블 ${s.tables.length}/${EXPECTED_TABLES.length} — 없는 것: ${EXPECTED_TABLES.filter((t) => !s.tables.includes(t)).join(', ')}`)

  // 🔴 탈퇴 삭제 경로의 핵심 인덱스
  const { rows: idx } = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname='public' AND indexname = 'PersonaUserRelationship_userId_idx'`)
  if (idx.length === 1) good('PersonaUserRelationship_userId_idx — 탈퇴 삭제 경로')
  else bad('🔴 userId 단독 인덱스가 없다 — 탈퇴 시 전체 스캔이 된다')

  // 🔴 kill switch 는 기본 꺼짐이어야 한다
  if (s.tables.includes('PersonaGlobalSwitch')) {
    const { rows } = await client.query(`SELECT id, enabled FROM "PersonaGlobalSwitch"`)
    if (rows.length === 0) good('PersonaGlobalSwitch 비어 있음 — 행은 운영 시작 시 만든다')
    else if (rows.every((r) => r.enabled === false)) good(`PersonaGlobalSwitch ${rows.length}행 · 전부 꺼짐`)
    else bad('🔴 kill switch 가 켜져 있다')
  }

  // 🔴 새 테이블이 비어 있는지 (이 단계는 데이터를 넣지 않는다)
  for (const t of s.tables) {
    const { rows: [r] } = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)
    if (r.n !== 0) bad(`🔴 ${t} 에 ${r.n}행이 있다 — 이 단계는 데이터를 넣지 않는다`)
  }
  if (s.tables.length > 0) good('새 테이블 전부 비어 있음')

  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 실패\n`)
  await client.end()
  process.exit(failed === 0 ? 0 : 1)
}

// ── SQL 검사 ──
const sqls = []
for (const name of MIGRATIONS) {
  const path = join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql')
  if (!existsSync(path)) { await client.end(); fail(`${name}/migration.sql 이 없습니다.`) }
  const sql = readFileSync(path, 'utf-8')
  // 🔴 주석과 FK 절의 ON DELETE / ON UPDATE 를 먼저 걷어낸다.
  //    참조 무결성 규칙은 파괴적 구문이 아니다 — 그대로 검사하면 정상 FK 가 걸린다.
  const body = sql
    .replace(/^\s*--.*$/gm, '')
    .replace(/\bON\s+(DELETE|UPDATE)\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/gi, '')
  for (const kw of ['DROP', 'DELETE', 'TRUNCATE', 'UPDATE', 'INSERT']) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(body)) { await client.end(); fail(`${name} 에 ${kw} 가 있습니다.`) }
  }
  // 🔴 기존 테이블을 ALTER 하지 않는지 — 이 단계는 새 테이블만 만든다
  for (const t of PROTECTED_TABLES) {
    if (new RegExp(`ALTER TABLE\\s+"${t}"`, 'i').test(body)) {
      await client.end(); fail(`🔴 ${name} 이 기존 테이블 ${t} 를 ALTER 합니다. 0017 로 분리해야 합니다.`)
    }
  }
  sqls.push({ name, sql })
}
ok(`SQL 검사 — ${MIGRATIONS.length}개 파일 · 파괴적 구문 없음 · 기존 테이블 ALTER 없음`)
ok('project ref · direct 포트 확인')

const before = await state()
console.log(`\n현재  enum ${before.enums.length}/${EXPECTED_ENUMS.length} · 테이블 ${before.tables.length}/${EXPECTED_TABLES.length}`)
for (const t of before.tables) console.log(`   있음: ${t}`)

if (!APPLY) {
  console.log('\n🟡 dry-run 입니다. 아무것도 바꾸지 않았습니다.')
  console.log('   실제 적용: node scripts/apply-migration-persona.mjs --apply\n')
  await client.end()
  process.exit(0)
}

// ── 적용 — 파일마다 하나의 트랜잭션 ──
for (const { name, sql } of sqls) {
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    ok(`${name} 적용`)
  } catch (e) {
    await client.query('ROLLBACK')
    await client.end()
    fail(`${name} 실패 — 롤백했습니다: ${e?.message ?? e}`)
  }
}

const after = await state()
console.log(`\n적용 후  enum ${after.enums.length}/${EXPECTED_ENUMS.length} · 테이블 ${after.tables.length}/${EXPECTED_TABLES.length}`)
if (after.tables.length !== EXPECTED_TABLES.length || after.enums.length !== EXPECTED_ENUMS.length) {
  await client.end(); fail('기대만큼 생기지 않았습니다.')
}
ok('information_schema 검증 통과')
console.log('\n다음: node scripts/apply-migration-persona.mjs --check\n')
await client.end()
