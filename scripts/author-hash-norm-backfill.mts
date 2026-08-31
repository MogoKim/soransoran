/**
 * authorHashNorm backfill — N2 정규화 해시를 채운다
 *
 * 정본: docs/operations/2026-08-31-persona-gate6-nickname-collision-design.md §4-3 · §6-4
 *
 * 사용법
 *   npx tsx scripts/author-hash-norm-backfill.mts           # dry-run (기본) — DB write 0
 *   npx tsx scripts/author-hash-norm-backfill.mts --apply   # 실제 UPDATE
 *   npx tsx scripts/author-hash-norm-backfill.mts --check   # 적용 결과 검증만
 *
 * 🔴 원문 author 는 우나어 read-only 에서만 읽는다. 소란소란 DB 에 원문을 쓰지 않는다.
 * 🔴 author 원문 · 닉네임 · sourceRef 실제 값을 출력하지 않는다. 사유 코드와 집계만.
 * 🔴 기존 authorHash 를 원문 재해시로 먼저 검증한다. 불일치면 그 row 는 건너뛴다 —
 *    원문이 바뀐 경우이므로 정규화 해시만 새로 쓰면 두 컬럼이 서로 다른 시점을 가리킨다.
 * 🔴 authorHash 는 절대 UPDATE 하지 않는다. 이 스크립트가 쓰는 컬럼은 authorHashNorm 뿐이다.
 */
import pg from 'pg'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { loadUnaoReadonlyUrl } from './lib/voice-unao-readonly.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')

const AUTHOR_SALT_ENV = 'VOICE_AUTHOR_HASH_SALT'
const DEFAULT_SALT = 'soransoran-voice-v1'

/** 정규화 N2 — trim + NFC + 소문자 + 공백·기호 제거 (설계 §5-1) */
export function normalizeN2(raw: string): string {
  return raw
    .trim()
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s._\-~·♡★☆!@#$%^&*()+=|\\/[\]{}<>?,;:'"`]/g, '')
}

function hashOf(value: string, salt: string): string {
  return `sha256:${createHash('sha256').update(`${salt}::${value}`, 'utf8').digest('hex')}`
}

/** topComments 항목에서 author 를 뽑는다 — toCommentSignals 와 같은 키 우선순위 */
function pickAuthor(item: Record<string, unknown>): string | null {
  for (const key of ['author', 'nickname', 'writer', 'name']) {
    const v = item[key]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return null
}

/** skip 사유 코드 — 🔴 원문을 담지 않는다 */
type SkipCode =
  | 'NO_SOURCE_MATCH'   // 우나어 원문 레코드를 찾지 못했다
  | 'NO_AUTHOR'         // 원문에 author 가 없다
  | 'HASH_MISMATCH'     // 재해시가 저장된 authorHash 와 다르다 (원문 변경)
  | 'EMPTY_AFTER_N2'    // N2 결과가 빈 문자열이다
  | 'NO_ORDINAL'        // topComments 에 해당 ordinal 이 없다

/**
 * `--check` 가 보는 `authorHashNorm <> authorHash` 비율의 기대 범위.
 *
 * 🔴 이 값은 **row 기준 · 소란소란 적재분 기준**이다. 둘 다 중요하다.
 *
 *    row 기준       고유 author 기준이 아니라 테이블의 행 수로 센다.
 *                   공백·기호를 가진 author 가 평균보다 많이 쓰면 row 비율이 더 높다.
 *    적재분 기준     우나어 전체가 아니라 소란소란에 적재된 고품질 코퍼스의 author 다.
 *                   모집단이 다르면 비율도 다르다.
 *
 * 실측 (2026-08-31 · backfill 직후 전량):
 *    VoiceSource         14.4%  (1,396 / 9,674)
 *    VoiceCommentSignal  15.7%  (9,324 / 59,252)
 *
 * 🔴 설계 문서 §6-4 의 10.0% / 9.5% 는 **우나어 전체 · 고유 author 기준**이라
 *    이 검사의 기준이 아니다. 처음 이 값으로 임계를 잡았다가 정상 데이터를
 *    실패로 판정했다. 같은 실수를 막으려고 기준을 여기 적어 둔다.
 *
 * 임계를 넓히는 것이 아니라 **맞는 모집단의 값으로 바꾼 것**이다.
 * 데이터 정확성은 별도로 증명했다 — 68,926 건 전량이 hash(N2(원문)) 와 일치한다.
 */
const DIFF_PCT_MIN = 13
const DIFF_PCT_MAX = 17

const BATCH = 500

type Counter = Record<SkipCode, number>
const newCounter = (): Counter => ({
  NO_SOURCE_MATCH: 0, NO_AUTHOR: 0, HASH_MISMATCH: 0, EMPTY_AFTER_N2: 0, NO_ORDINAL: 0,
})
const skipTotal = (c: Counter) => Object.values(c).reduce((a, b) => a + b, 0)

function reportSkips(label: string, c: Counter): void {
  const total = skipTotal(c)
  console.log(`  skip ${total}`)
  if (total === 0) return
  for (const [code, n] of Object.entries(c)) if (n > 0) console.log(`    ${code.padEnd(16)} ${n}`)
}

// ─────────────────────────────────────────────────────────────
async function runCheck(prisma: PrismaClient): Promise<void> {
  console.log('══ 검증 (--check) ══\n')
  let failed = 0
  const bad = (m: string) => { console.log(`  🔴 ${m}`); failed++ }
  const good = (m: string) => console.log(`  ✅ ${m}`)

  // 1. 컬럼 존재
  const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; is_nullable: string }>>`
    SELECT table_name, column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'authorHashNorm'
      AND table_name IN ('VoiceSource', 'VoiceCommentSignal')`
  if (cols.length === 2) good(`컬럼 2개 존재 · nullable=${cols.every((c) => c.is_nullable === 'YES')}`)
  else bad(`컬럼이 ${cols.length}/2 개다 — migration 0013 이 적용되지 않았다`)
  if (cols.length === 0) { console.log('\n검증을 계속할 수 없다.'); process.exit(1) }

  // 2. 🔴 원문 author 컬럼이 추가되지 않았는지
  const raw = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('VoiceSource', 'VoiceCommentSignal')
      AND lower(column_name) IN ('author', 'nickname', 'writer', 'authorname', 'authornickname')`
  if (raw.length === 0) good('원문 author · nickname 컬럼 없음')
  else bad(`🔴 원문 컬럼이 추가됐다: ${raw.map((r) => `${r.table_name}.${r.column_name}`).join(', ')}`)

  // 3. 테이블별 지표
  for (const table of ['VoiceSource', 'VoiceCommentSignal'] as const) {
    const [row] = await prisma.$queryRawUnsafe<Array<{
      total: bigint; has_hash: bigint; has_norm: bigint; both: bigint; bad_format: bigint; differs: bigint
    }>>(`
      SELECT COUNT(*)::bigint AS total,
             COUNT("authorHash")::bigint AS has_hash,
             COUNT("authorHashNorm")::bigint AS has_norm,
             COUNT(*) FILTER (WHERE "authorHash" IS NOT NULL AND "authorHashNorm" IS NOT NULL)::bigint AS both,
             COUNT(*) FILTER (WHERE "authorHashNorm" IS NOT NULL
                              AND "authorHashNorm" !~ '^sha256:[0-9a-f]{64}$')::bigint AS bad_format,
             COUNT(*) FILTER (WHERE "authorHash" IS NOT NULL AND "authorHashNorm" IS NOT NULL
                              AND "authorHashNorm" <> "authorHash")::bigint AS differs
      FROM "${table}"`)
    const n = (v: bigint) => Number(v)
    console.log(`\n  [${table}]`)
    console.log(`    총 ${n(row.total)}  authorHash ${n(row.has_hash)}  authorHashNorm ${n(row.has_norm)}`)

    const missing = n(row.has_hash) - n(row.both)
    if (missing === 0) good(`    NULL 없음 — authorHash 가 있는 행은 전부 채워졌다`)
    else bad(`    authorHashNorm 이 비어 있는 행 ${missing}`)

    if (n(row.bad_format) === 0) good('    sha256 형식 전부 정상')
    else bad(`    형식이 틀린 행 ${n(row.bad_format)}`)

    if (n(row.both) > 0) {
      const pct = n(row.differs) / n(row.both) * 100
      const inRange = pct >= DIFF_PCT_MIN && pct <= DIFF_PCT_MAX
      const msg = `    authorHashNorm <> authorHash  ${n(row.differs)}  (${pct.toFixed(1)}%)`
      if (inRange) good(`${msg}  — 예상 ${DIFF_PCT_MIN}~${DIFF_PCT_MAX}% 범위`)
      else bad(`${msg}  — 🔴 예상 ${DIFF_PCT_MIN}~${DIFF_PCT_MAX}% 를 벗어났다 (0% 면 N2 미적용 · 과다면 잘못된 정규화)`)
    }
  }

  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 실패\n`)
  if (failed > 0) process.exit(1)
}

// ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await loadEnvLocal()
  const prisma = new PrismaClient()

  if (CHECK) { await runCheck(prisma); await prisma.$disconnect(); return }

  const salt = (process.env[AUTHOR_SALT_ENV] ?? DEFAULT_SALT).trim()
  console.log(`══ authorHashNorm backfill ${APPLY ? '(--apply)' : '(dry-run · DB write 0)'} ══\n`)

  const hasColumn = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'authorHashNorm'
      AND table_name IN ('VoiceSource', 'VoiceCommentSignal')`
  const columnReady = Number(hasColumn[0].n) === 2
  if (!columnReady) {
    // 🔴 컬럼이 없어도 dry-run 계산은 막지 않는다.
    //    migration 을 적용하기 전에 "무엇이 몇 건 갱신될지" 를 볼 수 있어야
    //    적용 여부를 판단할 수 있다. 막는 것은 --apply 뿐이다.
    console.log('🟡 authorHashNorm 컬럼이 아직 없다 (migration 0013 미적용).')
    console.log('   계산은 그대로 진행한다. --apply 는 컬럼이 생긴 뒤에만 동작한다.\n')
    if (APPLY) {
      console.log('🔴 --apply 는 실행할 수 없다. migration 0013 을 먼저 적용한다.')
      await prisma.$disconnect()
      process.exit(1)
    }
  }

  const unao = new pg.Client({ connectionString: loadUnaoReadonlyUrl(), ssl: { rejectUnauthorized: false } })
  await unao.connect()

  // ── VoiceSource ──
  const sources = await prisma.voiceSource.findMany({
    where: { authorHash: { not: null } },
    select: { id: true, sourceRef: true, authorHash: true },
  })
  const { rows: posts } = await unao.query<{ id: string; author: string | null; topComments: unknown }>(
    'SELECT id, author, "topComments" FROM "CafePost" WHERE id = ANY($1)',
    [sources.map((s) => s.sourceRef)],
  )
  const postByRef = new Map(posts.map((p) => [p.id, p]))

  const srcSkips = newCounter()
  const srcUpdates: Array<{ id: string; norm: string }> = []
  for (const s of sources) {
    const post = postByRef.get(s.sourceRef)
    if (!post) { srcSkips.NO_SOURCE_MATCH++; continue }
    const author = post.author?.trim()
    if (!author) { srcSkips.NO_AUTHOR++; continue }
    if (hashOf(author, salt) !== s.authorHash) { srcSkips.HASH_MISMATCH++; continue }
    const norm = normalizeN2(author)
    if (norm === '') { srcSkips.EMPTY_AFTER_N2++; continue }
    srcUpdates.push({ id: s.id, norm: hashOf(norm, salt) })
  }
  console.log(`[VoiceSource] 대상 ${sources.length}`)
  console.log(`  갱신 예정 ${srcUpdates.length}`)
  reportSkips('VoiceSource', srcSkips)

  // ── VoiceCommentSignal ──
  const signals = await prisma.voiceCommentSignal.findMany({
    where: { authorHash: { not: null } },
    select: { id: true, voiceSourceId: true, ordinal: true, authorHash: true },
  })
  const refBySourceId = new Map(sources.map((s) => [s.id, s.sourceRef]))

  const sigSkips = newCounter()
  const sigUpdates: Array<{ id: string; norm: string }> = []
  for (const sig of signals) {
    const ref = refBySourceId.get(sig.voiceSourceId)
    const post = ref ? postByRef.get(ref) : undefined
    if (!post) { sigSkips.NO_SOURCE_MATCH++; continue }
    let arr: unknown = post.topComments
    if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { sigSkips.NO_ORDINAL++; continue } }
    const item = Array.isArray(arr) ? arr[sig.ordinal] : undefined
    if (!item || typeof item !== 'object') { sigSkips.NO_ORDINAL++; continue }
    const author = pickAuthor(item as Record<string, unknown>)
    if (!author) { sigSkips.NO_AUTHOR++; continue }
    if (hashOf(author, salt) !== sig.authorHash) { sigSkips.HASH_MISMATCH++; continue }
    const norm = normalizeN2(author)
    if (norm === '') { sigSkips.EMPTY_AFTER_N2++; continue }
    sigUpdates.push({ id: sig.id, norm: hashOf(norm, salt) })
  }
  console.log(`\n[VoiceCommentSignal] 대상 ${signals.length}`)
  console.log(`  갱신 예정 ${sigUpdates.length}`)
  reportSkips('VoiceCommentSignal', sigSkips)

  const totalTarget = sources.length + signals.length
  const totalUpdate = srcUpdates.length + sigUpdates.length
  console.log(`\n합계  대상 ${totalTarget}  갱신 예정 ${totalUpdate}  skip ${skipTotal(srcSkips) + skipTotal(sigSkips)}`)

  if (!APPLY) {
    console.log('\n🟡 dry-run 이다. DB write 0.')
    console.log('   실제 적용: npx tsx scripts/author-hash-norm-backfill.mts --apply\n')
    await unao.end(); await prisma.$disconnect()
    return
  }

  // ── 적용 — 🔴 authorHashNorm 만 쓴다 ──
  let done = 0
  for (const [table, updates] of [
    ['VoiceSource', srcUpdates], ['VoiceCommentSignal', sigUpdates],
  ] as const) {
    for (let i = 0; i < updates.length; i += BATCH) {
      const chunk = updates.slice(i, i + BATCH)
      await prisma.$transaction(
        chunk.map((u) =>
          prisma.$executeRawUnsafe(`UPDATE "${table}" SET "authorHashNorm" = $1 WHERE id = $2`, u.norm, u.id),
        ),
      )
      done += chunk.length
      console.log(`  ${table} ${done}/${totalUpdate}`)
    }
  }
  console.log(`\n✅ 갱신 ${done}건`)
  console.log('   검증: npx tsx scripts/author-hash-norm-backfill.mts --check\n')

  await unao.end(); await prisma.$disconnect()
}

main().catch((e) => { console.error(`🔴 실패: ${e?.message ?? e}`); process.exit(1) })
