'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'

/** 신고: 사용자당 10분에 5건 — 신고 자체가 괴롭힘 수단이 되지 않게 제한한다 */
const REPORT_LIMIT = 5
const REPORT_WINDOW_MS = 10 * 60 * 1000

export const REPORT_REASONS = [
  { value: 'SPAM', label: '광고·스팸' },
  { value: 'ABUSE', label: '욕설·비방' },
  { value: 'ADULT', label: '선정적 내용' },
  { value: 'PRIVACY', label: '개인정보 노출' },
  { value: 'ETC', label: '기타' },
] as const

type ReportReason = (typeof REPORT_REASONS)[number]['value']

const VALID_REASONS = new Set<string>(REPORT_REASONS.map((r) => r.value))

export type ReportActionState = { error?: string; done?: boolean }

/**
 * 신고 접수
 *
 * D-day 최소 보호장치다. 접수만 하고 자동 조치는 하지 않는다.
 * 처리는 운영자가 Report.status 로 확인한다.
 */
export async function createReport(
  _prev: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  const postId = String(formData.get('postId') ?? '') || null
  const commentId = String(formData.get('commentId') ?? '') || null
  const reason = String(formData.get('reason') ?? '')
  const detail = String(formData.get('detail') ?? '').trim() || null

  if (!postId && !commentId) return { error: '신고 대상을 찾을 수 없습니다.' }
  if (!VALID_REASONS.has(reason)) return { error: '신고 사유를 선택해 주세요.' }

  const limited = checkActionRateLimit('report', userId, REPORT_LIMIT, REPORT_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  // 같은 대상을 중복 신고해도 한 건만 남긴다
  const existing = await prisma.report.findFirst({
    where: { reporterId: userId, postId, commentId },
    select: { id: true },
  })
  if (existing) return { done: true }

  await prisma.report.create({
    data: {
      reporterId: userId,
      postId,
      commentId,
      reason: reason as ReportReason,
      detail,
    },
  })

  return { done: true }
}
