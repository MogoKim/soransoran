import { PrismaClient } from '@prisma/client'

/**
 * PrismaClient 싱글턴
 *
 * Next.js 개발 모드는 hot reload 마다 모듈을 다시 평가한다.
 * 매번 new PrismaClient() 를 만들면 커넥션이 누적되어 Supabase pooler 가 고갈된다.
 * globalThis 에 캐싱해 인스턴스를 하나로 유지한다.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
