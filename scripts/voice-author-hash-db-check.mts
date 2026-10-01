#!/usr/bin/env tsx
/**
 * 작가 해시 v1 → v2 전환 격리 DB 검사 — 🔴 운영 DB 에 붙지 않는다 (2026-10-01 author-hash v2)
 *
 *   DATABASE_URL=postgresql://soran@localhost:<port>/soran_test SORAN_ISOLATED_DB=yes-throwaway \
 *     npm run voice:author-hash-db-check
 *
 * 보는 것 (전부 실제 Postgres · 실제 트랜잭션)
 *   ① 계획은 write 0 — 쓰기 차단 클라이언트로 돌고, 전 행 스냅샷 불변
 *   ② key 없음 · 짧은 key · lock 점유 · 섞인 세대 → 거절 · DB 변경 0 · 백업 0
 *   ③ 중간 실패(failAfterPairs) → 전체 롤백 · DB 변경 0 · lock 해제
 *   ④ 적용 → 전부 지금 key 의 v2 · 행 수 불변 · null 은 null · B2 충돌 수 전후 같음 · Gate ⑥-B 가 v2-ready 로 연다 ·
 *      백업 0600 + checksum
 *   ⑤ 재실행 → noop(이중 HMAC 없음) · 다른 key 로 재실행 → 거절(key-mismatch)
 *   ⑥ 되돌리기 — 다른 key · 변조 백업 → 거절 · DB 변경 0 / 맞는 key → 원래 v1 로 정확히 복원
 *   ⑦ v1 사슬 원본 대조(가짜 우나어 작가명) — 공개 사슬 → PROVEN · 다른 salt · 한 행 어긋남 · 정규화만 어긋남 · 원본 없음 · 표본 99 →
 *      UNKNOWN · UNKNOWN 이나 대조 없음이면 적용 거절(사람 확인 우회 없음)
 *   ⑧ 서로 다른 lock 의 두 프로세스 동시 적용 → 전환은 정확히 한 번 · 결과 값 = 한 번 감싼 값
 *   ⑨ CLI 기본 실행은 계획만 — 쓰기 시도 0 · 해시 · 이름 · key 출력 0 · `--apply` 도 key 없으면 exit 1 · DB 변경 0
 *
 * 🔴 이름은 전부 지어낸 합성 문자열이다. key 도 시험 전용이다.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL = process.env.DATABASE_URL ?? ''
{
  const problems: string[] = []
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
  if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
  if (problems.length > 0) {
    console.error('🔴 격리 DB 가 아니다. 멈춘다.')
    for (const p of problems) console.error(`   · ${p}`)
    process.exit(2)
  }
}

const { PrismaClient } = await import('@prisma/client')
const { authorHashKeyOf, authorGateOf, wrapV1, V1_PREFIX } = await import('./lib/voice-author-hash.mjs')
const { applyMigration, planMigration, readLegacyDomainProof, rollbackMigration } = await import('./lib/voice-author-hash-migration.mjs')
type LegacyDomainProof = import('./lib/voice-author-hash.mjs').LegacyDomainProof
const { normalizeN2 } = await import('./lib/persona-gate-name-collision.mjs')

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const KEY_A_SECRET = 'author-hash-db-check-key-A-0123456789abcdef'
const KEY_B_SECRET = 'author-hash-db-check-key-B-fedcba9876543210'
const KEY_A = authorHashKeyOf(KEY_A_SECRET)
const KEY_B = authorHashKeyOf(KEY_B_SECRET)
if (!KEY_A.ok || !KEY_B.ok) throw new Error('test key')

const prisma = new PrismaClient()


let pass = 0
const failures: string[] = []
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failures.push(name); console.log(`  ❌ ${name}`) }
}

/** 🔴 v1 을 검사 쪽에서 독립으로 계산한다(옛 저장값 계산식) — 검사 파일은 정적 잠금의 예외다 */
const v1Of = (value: string): string =>
  `${V1_PREFIX}${createHash('sha256').update(`soransoran-voice-v1::${value}`, 'utf8').digest('hex')}`
const v1OtherSaltOf = (value: string): string =>
  `${V1_PREFIX}${createHash('sha256').update(`some-private-salt::${value}`, 'utf8').digest('hex')}`

// 🔴 합성 이름
const MEMBER_A = '봄뜰하나'
const MEMBER_B = '겨울숲둘'
const CRAWL_ONLY = '가을바다셋'
/** 원본 대조 최소 표본(100)을 넘기기 위한 합성 작가 글 수 */
const BULK = 120

/** 🔴 가짜 우나어 원본 — sourceRef → 작가명. 운영 커넥터 대신 같은 모양의 함수를 준다(SELECT 결과와 같은 Map) */
const authorOfRef = (ref: string): string | null => {
  if (ref === 's1' || ref === 's2') return MEMBER_A
  if (ref === 's3') return CRAWL_ONLY
  const m = /^b(\d+)$/.exec(ref)
  return m ? `합성작가${m[1]}` : null
}
const fakeUnao = async (refs: string[]): Promise<Map<string, string | null>> => new Map(refs.map((r) => [r, authorOfRef(r)]))

// ── ⑧ 자식 프로세스 모드 — 다른 lock 으로 같은 DB 에 동시에 적용한다 ──
if (process.env.AUTHOR_HASH_DB_CHECK_CHILD !== undefined) {
  const [lockPath, backupDir] = process.env.AUTHOR_HASH_DB_CHECK_CHILD.split('|') as [string, string]
  const legacyProof = await readLegacyDomainProof(prisma, fakeUnao)
  const r = await applyMigration(prisma, { keyRead: KEY_A, backupDir, lockPath, legacyProof, now: new Date() })
  console.log(`CHILD_RESULT ${r.ok ? r.kind : r.code}`)
  await prisma.$disconnect()
  process.exit(0)
}
const SPACED_B = '겨울 숲 둘'

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany', '$executeRaw', '$executeRawUnsafe'])

type Snap = string
async function snapshot(): Promise<Snap> {
  const s = await prisma.voiceSource.findMany({ select: { id: true, authorHash: true, authorHashNorm: true }, orderBy: { id: 'asc' } })
  const c = await prisma.voiceCommentSignal.findMany({ select: { id: true, authorHash: true, authorHashNorm: true }, orderBy: { id: 'asc' } })
  return JSON.stringify({ s, c, users: await prisma.user.count() })
}
async function allValues(): Promise<string[]> {
  const s = await prisma.voiceSource.findMany({ select: { authorHash: true, authorHashNorm: true } })
  const c = await prisma.voiceCommentSignal.findMany({ select: { authorHash: true, authorHashNorm: true } })
  return [...s, ...c].flatMap((r) => [r.authorHash, r.authorHashNorm]).filter((v): v is string => v !== null)
}

/**
 * 🔴 전환은 **표 전체**를 대상으로 한다 — 같은 격리 DB 를 쓰는 다른 검사가 남긴 voice 행이 있으면 판정이 섞인다.
 *    그래서 voice 두 표는 통째로 비운다(격리 DB 가드를 통과한 throwaway DB 에서만 돈다).
 */
async function cleanup(): Promise<void> {
  await prisma.voiceCommentSignal.deleteMany({})
  await prisma.voiceSource.deleteMany({})
  await prisma.user.deleteMany({ where: { nickname: { in: [MEMBER_A, MEMBER_B] } } })
}

/** v1 세대 fixture — 글 4(같은 작가 2 · 다른 작가 1 · 작가 없음 1) + 합성 작가 글 120 · 댓글 3(띄어쓴 이름 · 같은 작가 · 작가 없음) */
async function seed(hash: (v: string) => string, withMembers: boolean): Promise<void> {
  await cleanup()
  if (withMembers) {
    await prisma.user.create({ data: { nickname: MEMBER_A } })
    await prisma.user.create({ data: { nickname: MEMBER_B } })
  }
  const src = (ref: string, author: string | null) => prisma.voiceSource.create({ data: {
    origin: 'unao_cafe', sourceRef: ref, sourceSite: 'navercafe:fixture', sourceUrl: `https://example.invalid/${ref}`,
    capturedAt: new Date(0),
    authorHash: author === null ? null : hash(author), authorHashNorm: author === null ? null : hash(normalizeN2(author)),
  } })
  const s1 = await src('s1', MEMBER_A)
  await src('s2', MEMBER_A)
  await src('s3', CRAWL_ONLY)
  await src('s4', null)
  await prisma.voiceSource.createMany({ data: Array.from({ length: BULK }, (_, i) => {
    const ref = `b${String(i).padStart(3, '0')}`
    const a = authorOfRef(ref)!
    return { origin: 'unao_cafe', sourceRef: ref, sourceSite: 'navercafe:fixture', sourceUrl: `https://example.invalid/${ref}`,
      capturedAt: new Date(0), authorHash: hash(a), authorHashNorm: hash(normalizeN2(a)) }
  }) })
  let ordinal = 0
  for (const author of [SPACED_B, MEMBER_A, null]) {
    await prisma.voiceCommentSignal.create({ data: {
      voiceSourceId: s1.id, ordinal: ordinal++, contentLength: 10, capturedAt: new Date(0),
      authorHash: author === null ? null : hash(author), authorHashNorm: author === null ? null : hash(normalizeN2(author)),
    } })
  }
}
const NON_NULL_ROWS = 5 + BULK // 글 3 + 댓글 2 + 합성 글 120
const SOURCE_ROWS = 4 + BULK

const TMP = mkdtempSync(join(tmpdir(), 'author-hash-db-check-'))
const BACKUP = join(TMP, 'backup')
const LOCK = join(TMP, 'migrate.lock')
const backups = (): string[] => existsSync(BACKUP) ? readdirSync(BACKUP).filter((f) => f.endsWith('.jsonl')) : []
const base = { backupDir: BACKUP, lockPath: LOCK, legacyProof: null as LegacyDomainProof | null, now: new Date('2026-10-01T00:00:00Z'), txTimeoutMs: 60_000 }

function runTsx(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn('npx', ['tsx', ...args], { cwd: join(HERE, '..'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d: Buffer) => { out += d.toString() })
    p.stderr.on('data', (d: Buffer) => { out += d.toString() })
    p.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

console.log('\n══ 작가 해시 v1 → v2 전환 — 격리 DB ══\n')
try {
  await seed(v1Of, true)
  const original = await snapshot()

  // ── ① 계획 write 0 ──
  let writeAttempts = 0
  const ro = prisma.$extends({ query: { async $allOperations({ operation, args, query }) {
    if (WRITES.has(operation)) { writeAttempts += 1; throw new Error('blocked') }
    return query(args)
  } } }) as unknown as InstanceType<typeof PrismaClient>
  const plan = await planMigration(ro, KEY_A)
  check('계획 — 쓰기 시도 0 · 스냅샷 불변', writeAttempts === 0 && original === await snapshot())
  check(`계획 — needs-migration · migrate · 감쌀 행 ${NON_NULL_ROWS} (${plan.state} ${plan.action} ${plan.rowsToWrap})`,
    plan.state === 'needs-migration' && plan.action === 'migrate' && plan.rowsToWrap === NON_NULL_ROWS)
  check(`계획 — 갱신 문장 = 고유 (hash, norm) 쌍 ${4 + BULK} (같은 작가 2행은 1문장) (${plan.updateStatements})`, plan.updateStatements === 4 + BULK)

  // ── ①-b v1 사슬 원본 대조 — 적용 전제 ──
  const proof = await readLegacyDomainProof(ro, fakeUnao)
  check(`원본 대조 — 공개 사슬로 만든 저장값 → PROVEN (대조 ${proof.compared} · 일치 ${proof.matched} · 정규화 ${proof.normMatched}/${proof.normCompared})`,
    proof.status === 'PROVEN' && proof.compared === 3 + BULK && proof.matched === proof.compared && proof.normMatched === proof.normCompared && writeAttempts === 0)
  check('원본 대조 결과에 이름 · 해시가 없다(수와 사유만)',
    !/[0-9a-f]{12,}/.test(JSON.stringify(proof)) && ![MEMBER_A, CRAWL_ONLY, '합성작가'].some((n) => JSON.stringify(proof).includes(n)))
  const noProof = await applyMigration(prisma, { ...base, keyRead: KEY_A })
  check('원본 대조 없이 적용 → LEGACY_DOMAIN_UNPROVEN · DB 변경 0', !noProof.ok && noProof.code === 'LEGACY_DOMAIN_UNPROVEN' && original === await snapshot())
  base.legacyProof = proof
  check(`계획 — v1 사슬 증명(알려진 이름 일치 ${plan.legacyDomain.hits})`, plan.legacyDomain.status === 'proven' && plan.legacyDomain.hits === 2)
  const planNoKey = await planMigration(ro, authorHashKeyOf(undefined))
  check('계획 — key 없음 → refuse · 사유 · 세대 집계는 그대로 보인다',
    planNoKey.action === 'refuse' && planNoKey.refuseReason !== null && planNoKey.state === 'needs-migration' && planNoKey.tables.voiceSource.census.v1 === (3 + BULK) * 2)

  // ── ② 거절 경로 ──
  const noKey = await applyMigration(prisma, { ...base, keyRead: authorHashKeyOf(undefined) })
  check('적용 — key 없음 → REFUSED · DB 변경 0 · 백업 0', !noKey.ok && noKey.code === 'REFUSED' && original === await snapshot() && backups().length === 0)
  const shortKey = await applyMigration(prisma, { ...base, keyRead: authorHashKeyOf('short-0123') })
  check('적용 — 짧은 key → REFUSED · DB 변경 0', !shortKey.ok && shortKey.code === 'REFUSED' && original === await snapshot())
  writeFileSync(LOCK, '')
  const locked = await applyMigration(prisma, { ...base, keyRead: KEY_A })
  check('적용 — lock 점유 → LOCKED · DB 변경 0 · 남의 lock 을 지우지 않는다',
    !locked.ok && locked.code === 'LOCKED' && original === await snapshot() && existsSync(LOCK))
  rmSync(LOCK)
  {
    const one = await prisma.voiceSource.findFirstOrThrow({ where: { sourceRef: 's3' } })
    await prisma.voiceSource.update({ where: { id: one.id }, data: { authorHash: wrapV1(one.authorHash!, KEY_A.key), authorHashNorm: wrapV1(one.authorHashNorm!, KEY_A.key) } })
    const mixedSnap = await snapshot()
    const mixed = await applyMigration(prisma, { ...base, keyRead: KEY_A })
    check(`적용 — v1 · v2 섞임 → REFUSED · DB 변경 0 (${mixed.ok ? mixed.kind : mixed.code} ${mixed.ok ? '' : mixed.plan?.state})`,
      !mixed.ok && mixed.code === 'REFUSED' && mixed.plan?.state === 'mixed' && mixedSnap === await snapshot())
    await prisma.voiceSource.update({ where: { id: one.id }, data: { authorHash: one.authorHash, authorHashNorm: one.authorHashNorm } })
    check('섞임 fixture 원복', original === await snapshot())
  }

  // ── ③ 중간 실패 → 전체 롤백 ──
  const injected = await applyMigration(prisma, { ...base, keyRead: KEY_A, failAfterPairs: 2 })
  check(`적용 — 2쌍 갱신 뒤 실패 → TX_FAILED · DB 변경 0 · lock 해제 (${injected.ok ? injected.kind : injected.code})`,
    !injected.ok && injected.code === 'TX_FAILED' && original === await snapshot() && !existsSync(LOCK))
  for (const f of readdirSync(BACKUP)) rmSync(join(BACKUP, f))

  // ── ③-b 읽은 뒤 · 트랜잭션 전에 한 행이 다른 작가로 바뀜 → 쌍별 갱신 수가 어긋나 전체 롤백 ──
  //    (바뀐 행도 v1 이라 사후 검증만으로는 못 잡는다 — 백업과 DB 가 달라져 되돌리기가 깨진다)
  {
    const s2 = await prisma.voiceSource.findFirstOrThrow({ where: { sourceRef: 's2' } })
    const raced = await applyMigration(prisma, { ...base, keyRead: KEY_A, beforeTx: async () => {
      await prisma.voiceSource.update({ where: { id: s2.id }, data: { authorHash: v1Of(CRAWL_ONLY), authorHashNorm: v1Of(normalizeN2(CRAWL_ONLY)) } })
    } })
    const racedSnap = await snapshot()
    check(`적용 — 읽은 뒤 바뀐 행 → TX_FAILED(CONCURRENT_CHANGE) · 전환 0 (${raced.ok ? raced.kind : `${raced.code} ${raced.reason}`})`,
      !raced.ok && raced.code === 'TX_FAILED' && /CONCURRENT_CHANGE/.test(raced.reason) && (await allValues()).every((v) => v.startsWith('sha256:')))
    await prisma.voiceSource.update({ where: { id: s2.id }, data: { authorHash: s2.authorHash, authorHashNorm: s2.authorHashNorm } })
    check('경합 fixture 원복', original === await snapshot() && racedSnap !== original)
    for (const f of readdirSync(BACKUP)) rmSync(join(BACKUP, f))
  }

  // ── ④ 적용 ──
  const applied = await applyMigration(prisma, { ...base, keyRead: KEY_A })
  const afterApply = await snapshot()
  check(`적용 — migrated ${applied.ok && applied.kind === 'migrated' ? applied.wrappedRows : '-'}행`,
    applied.ok && applied.kind === 'migrated' && applied.wrappedRows === NON_NULL_ROWS)
  const vals = await allValues()
  check('적용 후 — 모든 값이 지금 key 의 v2', vals.length === NON_NULL_ROWS * 2 && vals.every((v) => v.startsWith(`hmac-v2:${KEY_A.key.kid}:`)))
  check('적용 후 — 한 번 감싼 값과 같다(원문 없이 같은 사람)',
    vals.includes(wrapV1(v1Of(MEMBER_A), KEY_A.key)!) && vals.includes(wrapV1(v1Of(normalizeN2(SPACED_B)), KEY_A.key)!))
  check('적용 후 — 행 수 불변 · 작가 없는 행은 null 그대로',
    await prisma.voiceSource.count() === SOURCE_ROWS && await prisma.voiceCommentSignal.count() === 3
      && await prisma.voiceSource.count({ where: { authorHash: null } }) === 1 && await prisma.voiceCommentSignal.count({ where: { authorHash: null } }) === 1)
  check(`적용 후 — B2 충돌 수 전후 같음 (${applied.ok && applied.kind === 'migrated' ? `${applied.b2HitsBefore}=${applied.b2HitsAfter}` : '-'})`,
    applied.ok && applied.kind === 'migrated' && applied.b2HitsBefore === 2 && applied.b2HitsAfter === 2)
  {
    const hs = await prisma.voiceSource.findMany({ select: { authorHash: true, authorHashNorm: true } })
    const cs = await prisma.voiceCommentSignal.findMany({ select: { authorHash: true, authorHashNorm: true } })
    const sets = {
      authorHashes: new Set([...hs, ...cs].map((r) => r.authorHash).filter((v): v is string => v !== null)),
      authorHashNorms: new Set([...hs, ...cs].map((r) => r.authorHashNorm).filter((v): v is string => v !== null)),
    }
    const gate = authorGateOf(KEY_A, sets)
    check('적용 후 — Gate ⑥-B 가 v2-ready 로 연다 · 회원 이름이 크롤 작가와 걸린다',
      gate.ok && sets.authorHashes.has(gate.hashOf(MEMBER_A)) && sets.authorHashNorms.has(gate.hashOf(normalizeN2(MEMBER_B))))
    const gateB = authorGateOf(KEY_B, sets)
    check('적용 후 — 다른 key 로는 Gate 가 열리지 않는다(key-mismatch)', !gateB.ok && gateB.code === 'key-mismatch')
  }
  const files = backups()
  const backupFile = applied.ok && applied.kind === 'migrated' ? applied.backupFile : ''
  check('백업 — 1개 · 0600 · checksum 파일 0600',
    files.length === 1 && (statSync(backupFile).mode & 0o777) === 0o600 && (statSync(`${backupFile}.sha256`).mode & 0o777) === 0o600)
  check('lock 해제', !existsSync(LOCK))

  // ── ⑤ 재실행 ──
  const again = await applyMigration(prisma, { ...base, keyRead: KEY_A })
  check('재실행 — noop · 값 불변(이중 HMAC 없음) · 새 백업 0', again.ok && again.kind === 'noop' && afterApply === await snapshot() && backups().length === 1)
  const otherKey = await applyMigration(prisma, { ...base, keyRead: KEY_B })
  check('다른 key 로 재실행 — REFUSED(key-mismatch) · 값 불변',
    !otherKey.ok && otherKey.code === 'REFUSED' && otherKey.plan?.state === 'key-mismatch' && afterApply === await snapshot())

  // ── ⑥ 되돌리기 ──
  const rbWrongKey = await rollbackMigration(prisma, { keyRead: KEY_B, backupFile, lockPath: LOCK, txTimeoutMs: 60_000 })
  check('되돌리기 — 다른 key → 실패 · DB 변경 0', !rbWrongKey.ok && afterApply === await snapshot())
  const rbNoKey = await rollbackMigration(prisma, { keyRead: authorHashKeyOf(undefined), backupFile, lockPath: LOCK })
  check('되돌리기 — key 없음 → KEY · DB 변경 0', !rbNoKey.ok && rbNoKey.code === 'KEY' && afterApply === await snapshot())
  const tampered = join(TMP, 'tampered.jsonl')
  copyFileSync(backupFile, tampered)
  copyFileSync(`${backupFile}.sha256`, `${tampered}.sha256`)
  writeFileSync(tampered, '{"t":"voiceSource","id":"x","h":null,"n":null}\n', { flag: 'a' })
  const rbTampered = await rollbackMigration(prisma, { keyRead: KEY_A, backupFile: tampered, lockPath: LOCK })
  check('되돌리기 — 변조 백업 → BACKUP_INVALID · DB 변경 0', !rbTampered.ok && rbTampered.code === 'BACKUP_INVALID' && afterApply === await snapshot())
  const rb = await rollbackMigration(prisma, { keyRead: KEY_A, backupFile, lockPath: LOCK, txTimeoutMs: 60_000 })
  check(`되돌리기 — 원래 v1 로 정확히 복원 (${rb.ok ? rb.restoredRows : rb.code})`, rb.ok && rb.restoredRows === NON_NULL_ROWS && original === await snapshot())
  const rbTwice = await rollbackMigration(prisma, { keyRead: KEY_A, backupFile, lockPath: LOCK, txTimeoutMs: 60_000 })
  check('되돌리기 두 번 → 실패 · 값 불변(v1 을 다시 건드리지 않는다)', !rbTwice.ok && original === await snapshot())

  // ── ⑦ v1 사슬 원본 대조 UNKNOWN → 중단(우회 없음) ──
  await seed(v1OtherSaltOf, true)
  const otherSnap = await snapshot()
  const otherProof = await readLegacyDomainProof(prisma, fakeUnao)
  check(`다른 salt 로 만든 저장값 → UNKNOWN (대조 ${otherProof.compared} · 일치 ${otherProof.matched})`,
    otherProof.status === 'UNKNOWN' && otherProof.compared === 3 + BULK && otherProof.matched === 0)
  const otherApply = await applyMigration(prisma, { ...base, keyRead: KEY_A, legacyProof: otherProof })
  check(`UNKNOWN 증명으로 적용 → LEGACY_DOMAIN_UNPROVEN · DB 변경 0 (${otherApply.ok ? otherApply.kind : otherApply.code})`,
    !otherApply.ok && otherApply.code === 'LEGACY_DOMAIN_UNPROVEN' && otherSnap === await snapshot())
  const members = await planMigration(prisma, KEY_A)
  check('회원 이름 probe 도 unproven(0 일치) — 참고값이지 적용 근거가 아니다',
    members.legacyDomain.status === 'unproven' && members.legacyDomain.hits === 0 && members.legacyDomain.probeNames >= 2)
  await seed(v1Of, true)
  {
    const one = await prisma.voiceSource.findFirstOrThrow({ where: { sourceRef: 'b007' } })
    await prisma.voiceSource.update({ where: { id: one.id }, data: { authorHash: v1Of('다른사람') } })
    const partial = await readLegacyDomainProof(prisma, fakeUnao)
    check(`한 행만 어긋남 → UNKNOWN (일치 ${partial.matched}/${partial.compared}) — 부분 일치를 증명으로 읽지 않는다`,
      partial.status === 'UNKNOWN' && partial.matched === partial.compared - 1)
    const partialNorm = await (async () => {
      await prisma.voiceSource.update({ where: { id: one.id }, data: { authorHash: v1Of('합성작가007'), authorHashNorm: v1Of('다른사람') } })
      return readLegacyDomainProof(prisma, fakeUnao)
    })()
    check(`정규화 해시만 어긋남 → UNKNOWN (${partialNorm.normMatched}/${partialNorm.normCompared})`, partialNorm.status === 'UNKNOWN' && partialNorm.matched === partialNorm.compared)
  }
  const gone = await readLegacyDomainProof(prisma, async () => new Map())
  check(`원본이 사라짐(작가명 0) → UNKNOWN (대조 ${gone.compared})`, gone.status === 'UNKNOWN' && gone.compared === 0)
  const thin = await readLegacyDomainProof(prisma, async (refs) => new Map(refs.slice(0, 99).map((r) => [r, authorOfRef(r)])))
  check(`대조 99 < 100 → UNKNOWN (대조 ${thin.compared} · 일치 ${thin.matched})`, thin.status === 'UNKNOWN' && thin.compared === 99 && thin.matched === 99)

  // ── ⑧ 두 프로세스 동시 적용(다른 lock = 다른 호스트) ──
  await seed(v1Of, true)
  const seeded = await snapshot()
  const [c1, c2] = await Promise.all([
    runTsx([SELF], { AUTHOR_HASH_DB_CHECK_CHILD: `${join(TMP, 'l1.lock')}|${join(TMP, 'b1')}` }),
    runTsx([SELF], { AUTHOR_HASH_DB_CHECK_CHILD: `${join(TMP, 'l2.lock')}|${join(TMP, 'b2')}` }),
  ])
  const results = [c1, c2].map((c) => /CHILD_RESULT (\S+)/.exec(c.out)?.[1] ?? `exit${c.code}`)
  const migratedN = results.filter((r) => r === 'migrated').length
  const vals2 = await allValues()
  check(`동시 적용 — 전환은 정확히 한 번 (${results.join(' · ')})`,
    migratedN === 1 && results.every((r) => r === 'migrated' || r === 'noop' || r === 'TX_FAILED' || r === 'REFUSED'))
  check('동시 적용 — 결과 값 = 한 번 감싼 값(이중 HMAC 0)', seeded !== await snapshot()
    && vals2.length === NON_NULL_ROWS * 2 && vals2.includes(wrapV1(v1Of(MEMBER_A), KEY_A.key)!) && vals2.every((v) => v.startsWith(`hmac-v2:${KEY_A.key.kid}:`)))

  // ── ⑨ CLI — 기본은 계획만 ──
  await seed(v1Of, true)
  const cliSnap = await snapshot()
  const home = join(TMP, 'home')
  const envDir = join(home, 'Library', 'Application Support', 'soransoran')
  const cliNoKey = await runTsx(['scripts/voice-author-hash-migrate.mts'], { HOME: home })
  check('CLI 기본(정본 env 없음) — exit 0 · 쓰기 시도 0 · refuse · DB 변경 0',
    cliNoKey.code === 0 && /쓰기 시도 0/.test(cliNoKey.out) && /refuse/.test(cliNoKey.out) && cliSnap === await snapshot())
  const cliApplyNoKey = await runTsx(['scripts/voice-author-hash-migrate.mts', '--apply'], { HOME: home })
  check('CLI --apply(key 없음) — exit 1 · DB 변경 0', cliApplyNoKey.code === 1 && cliSnap === await snapshot())
  const { mkdirSync } = await import('node:fs')
  mkdirSync(envDir, { recursive: true })
  writeFileSync(join(envDir, 'env.local'), `VOICE_AUTHOR_HASH_SALT=${KEY_A_SECRET}\n`, { mode: 0o600 })
  const cliPlan = await runTsx(['scripts/voice-author-hash-migrate.mts'], { HOME: home })
  check('CLI 기본(key 있음) — 계획만 · migrate · 쓰기 시도 0 · DB 변경 0',
    cliPlan.code === 0 && /할 일\s+migrate/.test(cliPlan.out) && /쓰기 시도 0/.test(cliPlan.out) && cliSnap === await snapshot())
  const leaked = [cliNoKey.out, cliApplyNoKey.out, cliPlan.out].some((o) =>
    /[0-9a-f]{12,}/.test(o) || [MEMBER_A, MEMBER_B, CRAWL_ONLY].some((n) => o.includes(n)) || o.includes(KEY_A_SECRET) || o.includes(KEY_A.key.kid))
  check('CLI 출력에 해시 · kid · 이름 · key 없음', !leaked)
} finally {
  await cleanup()
  await prisma.$disconnect()
  rmSync(TMP, { recursive: true, force: true })
}

console.log(`\n작가 해시 전환 격리 DB: ${pass} pass · ${failures.length} fail`)
for (const f of failures) console.log(`  ❌ ${f}`)
process.exit(failures.length === 0 ? 0 : 1)
