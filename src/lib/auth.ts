import NextAuth from 'next-auth'
import { authConfig } from './auth.config'

/**
 * scaffold 단계에서는 adapter 를 붙이지 않는다.
 * DB 연결(Supabase) 확정 후 PrismaAdapter 를 연결한다.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
