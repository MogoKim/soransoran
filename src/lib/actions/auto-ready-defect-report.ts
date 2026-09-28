'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { recordAdminDefectReport, type AdminDefectResult } from '@/lib/auto-ready-audit-store'

/**
 * 🔴 **자동 READY 운영자 결함 신고 — 유일한 서버 경계** (2026-09-27)
 *
 *   · 누가 신고했나 — 로그인 세션(`auth()`)과 관리자 판정(`requireAdmin`)으로 **서버가** 정한다.
 *   · 언제 — 서버 시계다.
 *   · 🔴 요청 본문에서 꺼내는 칸은 `postId` · `reasons` **둘뿐**이다. reviewer · auditor · userId ·
 *     judgedAt 이 들어와도 읽지 않는다.
 *   · 인증되지 않았거나 관리자가 아니면 DB write 0.
 *   · 기록은 `recordAdminDefectReport` 하나 — auto-ready:v1 글만 · 중대 결함 yes · 뽑히지 않은 글이면
 *     지금 글·도장에 묶어 감사 행을 만든다 · 기록 즉시 다음 자동 회차가 닫힌다.
 * 🔴 CLI 는 사람 기록을 만들 수 없다 — 이 경계 밖에서 `recordAdminDefectReport` 를 부르는 운영 스크립트가
 *    없음을 `auto-ready:audit-check` 가 본다.
 */
export type DefectReportState = { error?: string; result?: AdminDefectResult }

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

export async function reportAutoReadyDefect(input: unknown): Promise<DefectReportState> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: '권한이 없습니다.' }
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }
  // 🔴 두 칸만 꺼낸다 — 나머지는 버린다
  const r = rec(input)
  const postId = typeof r.postId === 'string' ? r.postId.trim() : ''
  if (postId === '') return { error: '글을 고르지 않았습니다.' }
  const result = await recordAdminDefectReport(prisma, { actor: { userId }, postId, reasons: r.reasons, now: new Date() })
  revalidatePath('/admin/auto-ready-defects')
  return { result }
}
