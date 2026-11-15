#!/usr/bin/env tsx
/**
 * ManualPersonaThreadLog 배포 선행 조건 — read-only schema probe.
 *
 * migration 적용 뒤, 애플리케이션 배포 전에 새 Prisma Client가 전용 원장을 실제로
 * 읽을 수 있는지만 확인한다. 행 내용은 출력하지 않고 write도 하지 않는다.
 */
import { PrismaClient } from '@prisma/client'

if ((process.env.SORAN_MANUAL_THREAD_SCHEMA_PROBE ?? '').trim() !== 'yes-read-only') {
  console.error('🔴 SORAN_MANUAL_THREAD_SCHEMA_PROBE=yes-read-only가 필요합니다.')
  process.exit(2)
}
if ((process.env.DATABASE_URL ?? '').trim() === '') {
  console.error('🔴 DATABASE_URL이 없습니다.')
  process.exit(2)
}

const prisma = new PrismaClient()
try {
  const count = await prisma.manualPersonaThreadLog.count()
  console.log(`✅ ManualPersonaThreadLog schema probe PASS · 현재 ${count}건 · write 0`)
} catch (error) {
  console.error(`🔴 ManualPersonaThreadLog schema probe FAIL · ${(error as Error).message}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
