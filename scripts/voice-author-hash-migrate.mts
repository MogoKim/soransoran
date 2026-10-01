#!/usr/bin/env tsx
/**
 * 작가 해시 v1 → v2 전환 CLI — 🔴 **기본은 계획(read-only)이다** (2026-10-01 author-hash v2)
 *
 *   npm run voice:author-hash-migrate                       계획만 — 세대 집계 · 상태 · v1 사슬 증명 · 감쌀 행 수 (DB write 0)
 *   npm run voice:author-hash-migrate -- --apply            적용 — 🔴 창업자 승인 뒤에만. 적용 직전에 v1 사슬 원본 대조
 *                                                           (`voice:author-hash-legacy-proof` 와 같은 함수)를 다시 돌려 PROVEN 일 때만 감싼다.
 *                                                           UNKNOWN 이면 중단 — 사람 확인으로 대신하는 옵션은 없다
 *   npm run voice:author-hash-migrate -- --rollback=<백업 파일>
 *                                                           되돌리기 — 적용 때 남긴 백업으로 v1 복원
 *
 * 🔴 key 는 정본 env 의 `VOICE_AUTHOR_HASH_SALT` 하나다(정본 helper `readAuthorHashKey`). 없으면 계획만 하고 적용을 거절한다.
 * 🔴 계획은 쓰기 차단 클라이언트로 읽는다 — 쓰기 · raw 실행은 호출 시점에 던진다.
 * 🔴 해시 · 이름 · key 를 출력하지 않는다. 수와 상태 · 사유만.
 * 🔴 되돌리기 백업(v1 값)은 `~/Library/Application Support/soransoran/author-hash-rollback/` 에 0600 으로 남는다 —
 *    보존 · 삭제 시점은 창업자 결정이다(runbook `docs/operations/2026-10-01-author-hash-v2-runbook.md`).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { readAuthorHashKey } from './lib/voice-author-hash.mjs'
import { applyMigration, describePlan, planMigration, readLegacyDomainProof, rollbackMigration } from './lib/voice-author-hash-migration.mjs'
import { withUnaoAuthorFetcher } from './lib/voice-author-hash-unao.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const ROLLBACK = argv.find((a) => a.startsWith('--rollback='))?.slice('--rollback='.length) ?? null
const APP = join(homedir(), 'Library', 'Application Support', 'soransoran')
const BACKUP_DIR = join(APP, 'author-hash-rollback')
const LOCK = join(APP, 'author-hash-migrate.lock')

const WRITES = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany',
  '$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe', '$runCommandRaw',
])

async function main(): Promise<number> {
  if (APPLY && ROLLBACK !== null) { console.error('❌ --apply 와 --rollback 은 같이 쓰지 않는다'); return 1 }
  const keyRead = readAuthorHashKey()
  const base = new PrismaClient()
  try {
    if (ROLLBACK !== null) {
      const r = await rollbackMigration(base, { keyRead, backupFile: ROLLBACK, lockPath: LOCK })
      console.log(r.ok ? `✅ 되돌리기 — ${r.restoredRows}행 v1 복원` : `❌ 되돌리기 거절 [${r.code}] ${r.reason} · DB 변경 0`)
      return r.ok ? 0 : 1
    }
    if (!APPLY) {
      // 🔴 계획 — 쓰기 차단 클라이언트
      let writeAttempts = 0
      const ro = base.$extends({ query: { async $allOperations({ operation, args, query }) {
        if (WRITES.has(operation)) { writeAttempts += 1; throw new Error(`read-only 계획: ${operation} 차단`) }
        return query(args)
      } } }) as unknown as PrismaClient
      const plan = await planMigration(ro, keyRead)
      console.log('══ 작가 해시 v1 → v2 계획 (read-only · DB write 0) ══')
      for (const l of describePlan(plan)) console.log(`  ${l}`)
      console.log(`  쓰기 시도 ${writeAttempts}`)
      return 0
    }
    if (!keyRead.ok) { console.error(`❌ 적용 거절 [REFUSED] ${keyRead.reason} · DB 변경 0`); return 1 }
    // 🔴 적용 직전 원본 대조 — 접속 실패 · UNKNOWN 이면 감싸지 않는다(applyMigration 이 다시 확인한다)
    let legacyProof = null
    try {
      legacyProof = await withUnaoAuthorFetcher((fetchAuthors) => readLegacyDomainProof(base, fetchAuthors))
    } catch (e) {
      console.error(`❌ 적용 거절 [LEGACY_DOMAIN_UNPROVEN] 원본 대조를 끝내지 못했다(${e instanceof Error ? e.name : 'unknown'}) · DB 변경 0`)
      return 1
    }
    console.log(`  원본 대조 ${legacyProof.status} — 대조 ${legacyProof.compared} · 일치 ${legacyProof.matched}`)
    const r = await applyMigration(base, { keyRead, backupDir: BACKUP_DIR, lockPath: LOCK, legacyProof, now: new Date() })
    if (!r.ok) {
      console.error(`❌ 적용 거절 [${r.code}] ${r.reason} · DB 변경 0`)
      return 1
    }
    if (r.kind === 'noop') { console.log('✅ 이미 전부 지금 key 의 v2 — 할 일 없음(재실행 idempotent)'); return 0 }
    console.log(`✅ 전환 — ${r.wrappedRows}행 v2 · B2 충돌 수 전후 ${r.b2HitsBefore} = ${r.b2HitsAfter} · 되돌리기 백업 ${r.backupFile}`)
    return 0
  } finally {
    await base.$disconnect()
  }
}

process.exit(await main())
