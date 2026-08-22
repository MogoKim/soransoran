import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * 관리자 판정
 *
 * 두 경로를 모두 인정한다.
 *   1) User.isAdmin — DB 플래그 (정식 경로)
 *   2) SORAN_ADMIN_EMAILS — 쉼표로 구분한 이메일 allowlist (초기 운영용)
 *
 * 초기에는 DB 플래그를 직접 켜기 번거로우므로 env allowlist 를 함께 둔다.
 * env 가 비어 있으면 allowlist 는 아무도 통과시키지 않는다.
 */
function getAdminEmails(): Set<string> {
  const raw = process.env.SORAN_ADMIN_EMAILS?.trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  )
}

export type AdminCheck = { ok: boolean }

export async function requireAdmin(): Promise<AdminCheck> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { ok: false }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, email: true },
  })
  if (!user) return { ok: false }

  if (user.isAdmin) return { ok: true }

  const allowlist = getAdminEmails()
  if (user.email && allowlist.has(user.email.toLowerCase())) return { ok: true }

  return { ok: false }
}
