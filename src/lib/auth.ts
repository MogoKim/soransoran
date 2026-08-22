import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './prisma'
import { authConfig } from './auth.config'

/**
 * session 전략은 JWT 를 유지하되 PrismaAdapter 를 함께 연결한다.
 *
 *   JWT      매 요청 DB 조회 없이 세션을 복원한다 (응답이 빠르다)
 *   Adapter  로그인 시 User·Account 를 DB 에 저장한다
 *
 * Adapter 가 없으면 로그인해도 User row 가 생기지 않아
 * Post.authorId(필수 FK)를 만들 수 없다 — 글쓰기가 구조적으로 불가능해진다.
 *
 * Session 테이블은 JWT 전략에서 사용하지 않는다(비어 있는 것이 정상).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  ...authConfig,
})
