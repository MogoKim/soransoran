#!/usr/bin/env node
/**
 * 0024_persona_comment_provenance 적용 — 생성 근거 컬럼 3개 + 인덱스 (FK 없음)
 *
 *   node scripts/apply-migration-0024.mjs            # dry-run (기본)
 *   node scripts/apply-migration-0024.mjs --apply    # 실제 적용
 *   node scripts/apply-migration-0024.mjs --check    # 반영 검증
 *
 * 🔴 prisma migrate · db push · db seed 를 쓰지 않는다 (/prisma-guide).
 *    pg 모듈로 직접 실행하고 information_schema 로 검증한다.
 *
 * 🔴 **0022 스크립트를 재사용하지 않는 이유**
 *    0022 는 "신규 테이블 밖 ALTER 금지" 가드를 쓴다 — 신규 생성만 하는 마이그레이션이었다.
 *    0023 은 **기존 테이블을 ALTER** 하므로 그 가드가 성립하지 않는다.
 *    가드를 느슨하게 고치는 것이 아니라, **대상 테이블을 못박은 스크립트를 따로** 만든다.
 *
 * 🔴 ALTER 는 PersonaApprovalQueue 하나만 허용한다.
 *    Persona 는 FK 로 참조만 한다 — ALTER 하지 않는다.
 * 🔴 기존 테이블 row count 가 하나라도 변하면 실패로 본다.
 * 🔴 --apply 없이는 어떤 쓰기도 하지 않는다.
 *
 * 🔴 **2026-09-09 정정 — 다른 테이블의 컬럼 이름을 검사하고 있었다.**
 *    0023(`MicroSeedCandidate`) 스크립트를 베끼면서 `sourceRawContentId` ·
 *    `draftTitle` · `draftBody` · `createdPostId` 를 기존 컬럼 목록으로 남겼다.
 *    `PersonaApprovalQueue` 에는 없는 이름들이라 `--check` 는 늘 "유실 4종" 을
 *    보고했고, 이어서 없는 컬럼을 조회하다 **42703 으로 잡히지 않고 죽었다.**
 *    지금 기존 컬럼 정본은 `scripts/lib/migration-0024-state.mjs` 의
 *    `BASELINE_COLUMNS`(information_schema 실측 22개)다.
 */
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import {
  applyWithVerification, judgeMigrationState, judgeProjectRef,
  BASELINE_COLUMNS, MIGRATION_ID, NEW_COLUMNS as CANON_NEW_COLUMNS, NEW_INDEX as CANON_NEW_INDEX,
  TARGET_TABLE as CANON_TARGET_TABLE,
} from './lib/migration-0024-state.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = join(__dirname, '..', 'prisma', 'migrations', '0024_persona_comment_provenance', 'migration.sql')
const EXPECTED_PROJECT_REF = 'buougdxmfobjilgjonby'

/** 🔴 이 테이블 하나만 ALTER 한다 — 이름도 판정 정본에서 가져온다 */
const TARGET_TABLE = CANON_TARGET_TABLE
/**
 * 🔴 ALTER 대상이 아니다. 0024 는 FK 도 만들지 않는다 —
 *    이 이름은 "건드리지 않는 테이블" 을 확인하는 자리에만 쓴다.
 */
const REFERENCED_TABLE = 'Persona'

/**
 * 🔴 컬럼·인덱스 이름을 여기서 다시 적지 않는다.
 *    두 벌이면 갈리고, 갈리면 검증이 딴 것을 본다.
 */
const NEW_COLUMNS = CANON_NEW_COLUMNS
const NEW_INDEX = CANON_NEW_INDEX
/**
 * 🔴 **0024 에는 FK 가 없다.** 세 컬럼은 전부 자유 텍스트다 —
 *    `canonRunId` 는 회차 이름이고 우리 DB 안의 행을 가리키지 않는다.
 *    0023 스크립트를 베끼면서 FK 검사를 남기면 "없는 것" 을 찾다가 항상 실패한다.
 */
const NEW_FK = null

/** 🔴 이 테이블들의 row count 는 변하면 안 된다 */
const PROTECTED_TABLES = [
  'User', 'Post', 'Comment', 'Persona',
  'MicroSeedRawContent', 'MicroSeedCandidate', 'PersonaApprovalQueue',
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

/**
 * 🔴 **다른 프로젝트에 쏘지 않는다 — 못 알아보면 멈춘다.**
 *    앞선 판은 host 패턴이 안 맞으면 조용히 통과했다. 실제 `DIRECT_URL` 은
 *    pooler 호스트라 늘 그 길로 빠졌다 — 어느 프로젝트인지 모른 채 돌았다.
 */
const parsed = new URL(directUrl)
const refVerdict = judgeProjectRef(parsed, EXPECTED_PROJECT_REF)
if (!refVerdict.ok) fail(`${refVerdict.reason} [OBSERVATION_FAILED]`)
ok(refVerdict.reason)

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

/**
 * 🔴 **어떤 경로에서도 raw stack trace 로 끝나지 않는다.**
 *    앞선 판은 없는 컬럼을 조회하다 PostgreSQL 42703 으로 죽었다 —
 *    운영자가 본 것은 판정이 아니라 `parse_relation.c` 였다.
 */
process.on('unhandledRejection', (e) => {
  console.error(`\n🔴 중단: 예상하지 못한 오류 [OBSERVATION_FAILED] — ${e?.message ?? e}\n`)
  process.exit(1)
})

try {
  await client.connect()
} catch (e) {
  fail(`DB 에 연결하지 못했습니다 [OBSERVATION_FAILED] — ${e.message}`)
}

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
const beforeCols = before.cols.map((c) => c.column_name)
console.log(`\n현재  컬럼 ${before.cols.length} · 인덱스 ${before.idx.length} · FK ${before.fk.length}`)
console.log(`      기존 row: ${Object.entries(beforeCounts).map(([k, v]) => `${k} ${v ?? '-'}`).join(' · ')}`)

// ══ --check ══
if (CHECK) {
  /**
   * 🔴 **판정은 순수 함수가 한다.** 여기서는 metadata 만 넘긴다 —
   *    그래야 적용됨·일부만·못 읽음을 production 에 쓰지 않고 시험할 수 있다.
   */
  const verdict = judgeMigrationState({
    table: TARGET_TABLE,
    columns: before.cols,
    indexes: before.idx.map((i) => i.indexname),
  })

  console.log(`\n══ 검증 (--check) — ${MIGRATION_ID} ══`)
  for (const f of verdict.findings) console.log(`   ${f.ok ? '✅' : '❌'} ${f.detail}`)
  console.log(`\n상태  ${verdict.state}`)
  console.log(`      ${verdict.summary}`)
  if (verdict.state === 'NOT_APPLIED') {
    console.log('\n   🟡 아직 적용하지 않았습니다. 적용은 창업자 승인 뒤 --apply 로만 합니다.')
  }
  console.log('')

  await client.end()
  // 🔴 미적용도 통과가 아니다 — 확인했다는 뜻이지 준비됐다는 뜻이 아니다
  process.exit(verdict.exitCode)
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
  console.log(`   적용 예정: 컬럼 ${NEW_COLUMNS.join(' · ')} · 인덱스 1 · FK 0`)
  console.log('   🔴 additive 만 합니다. 기존 행은 전부 null 이고, null 인 후보는 자동 발행 대상이 아닙니다.\n')
  process.exit(0)
}

// ══ 적용 — 🔴 **COMMIT 전에 검증한다** ══
/**
 * 🔴 **2026-09-10 정정 — 검증이 COMMIT 뒤에 있었다.**
 *
 *    옛 순서는 `BEGIN → SQL → COMMIT → 검증` 이었다. 검증이 실패해도
 *    이미 COMMIT 한 뒤라 되돌릴 방법이 없다 — 스크립트는 "적용 실패" 라고
 *    말하면서 DB 는 바뀐 채로 남는다. 가장 나쁜 결말이다.
 *
 *    지금은 같은 트랜잭션 안에서 다시 관측하고, `APPLIED_AND_VALID` 이며
 *    기존 row 가 하나도 안 변했을 때만 COMMIT 한다.
 *    관측 자체가 안 되면 — 됐는지 말할 수 없으므로 — ROLLBACK 이다.
 *
 * 🔴 순서·commit/rollback 횟수는 `applyWithVerification` 이 돌려주고,
 *    `check:migration-0024` 가 가짜 client 로 그 횟수를 행동으로 확인한다.
 */
console.log('\n══ 적용 (🔴 COMMIT 전 검증) ══')
const applied = await applyWithVerification({
  exec: async (text) => client.query(text),
  sql: body,
  observe: async () => {
    const st = await state()
    return { table: TARGET_TABLE, columns: st.cols, indexes: st.idx.map((i) => i.indexname) }
  },
  countTables: counts,
  beforeCounts,
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
const finalState = await (async () => {
  try {
    const st = await state()
    return judgeMigrationState({
      table: TARGET_TABLE, columns: st.cols, indexes: st.idx.map((i) => i.indexname),
    })
  } catch (e) {
    return null
  }
})()
if (finalState === null) {
  await client.end().catch(() => {})
  fail('COMMIT 은 됐는데 최종 확인을 관측하지 못했습니다 [OBSERVATION_FAILED] — --check 로 확인하세요.')
}
console.log(`\n최종 확인  ${finalState.state}`)
for (const f of finalState.findings) console.log(`   ${f.ok ? '✅' : '❌'} ${f.detail}`)
if (finalState.state !== 'APPLIED_AND_VALID') {
  await client.end().catch(() => {})
  fail(`COMMIT 뒤 상태가 ${finalState.state} 입니다 — ${finalState.summary}`)
}

await client.end()
console.log('\n✅ 적용했습니다. COMMIT 전 검증 통과 · 최종 확인 APPLIED_AND_VALID\n')
