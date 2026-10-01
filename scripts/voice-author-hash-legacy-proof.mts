#!/usr/bin/env tsx
/**
 * 작가 해시 v1 사슬 원본 대조 증명 — 🔴 **read-only** (2026-10-01 author-hash v2)
 *
 *   npm run voice:author-hash-legacy-proof
 *
 * 묻는 것: 저장된 `VoiceSource.authorHash`(v1) 가 정말 정본 helper 의 v1 사슬로 만들어졌는가.
 *   `VoiceSource`(unao_cafe) 를 sourceRef 순으로 세워 등간격 결정적 표본 200행을 뽑고,
 *   그 sourceRef(= 우나어 CafePost.id) 의 **원본 작가명**을 우나어 read-only 에서 읽어 다시 계산해 대조한다.
 *
 * 판정: PROVEN = 대조 ≥ 100 · 원본 해시 전부 일치 · 정규화 해시 전부 일치. 그 밖은 전부 **UNKNOWN 으로 중단**(exit 3).
 *       PROVEN 이 아니면 전환 도구(`voice:author-hash-migrate -- --apply`)도 감싸지 않는다 — 사람 확인으로 대신하지 않는다.
 *
 * 🔴 소란소란 DB 는 쓰기 차단 클라이언트로 읽는다(쓰기 · raw 실행은 호출 시점에 던진다).
 * 🔴 이름 · 해시 · key · sourceRef · 접속 주소를 출력하지 않는다. 표본 수와 일치 수만.
 */
import { PrismaClient } from '@prisma/client'

import { readLegacyDomainProof } from './lib/voice-author-hash-migration.mjs'
import { withUnaoAuthorFetcher } from './lib/voice-author-hash-unao.mjs'

const WRITES = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany',
  '$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe', '$runCommandRaw',
])

async function main(): Promise<number> {
  const base = new PrismaClient()
  let writeAttempts = 0
  const ro = base.$extends({ query: { async $allOperations({ operation, args, query }) {
    if (WRITES.has(operation)) { writeAttempts += 1; throw new Error(`read-only 증명: ${operation} 차단`) }
    return query(args)
  } } }) as unknown as PrismaClient
  try {
    const proof = await withUnaoAuthorFetcher((fetchAuthors) => readLegacyDomainProof(ro, fetchAuthors))
    console.log('══ 작가 해시 v1 사슬 원본 대조 (read-only · DB write 0) ══')
    console.log(`  표본           ${proof.sample}행 (VoiceSource unao_cafe · sourceRef 순 등간격 · 결정적)`)
    console.log(`  원본 해시      대조 ${proof.compared} · 일치 ${proof.matched}`)
    console.log(`  정규화 해시    대조 ${proof.normCompared} · 일치 ${proof.normMatched}`)
    console.log(`  판정           ${proof.status} — ${proof.reason}`)
    console.log(`  쓰기 시도 ${writeAttempts}`)
    return proof.status === 'PROVEN' ? 0 : 3
  } catch (e) {
    // 🔴 접속 실패도 증명 실패다 — 우회하지 않는다. 메시지에 주소가 섞일 수 있어 이름만 낸다
    console.error(`  판정           UNKNOWN — 대조를 끝내지 못했다(${e instanceof Error ? e.name : 'unknown'}) · 쓰기 시도 ${writeAttempts}`)
    return 3
  } finally {
    await base.$disconnect()
  }
}

process.exit(await main())
