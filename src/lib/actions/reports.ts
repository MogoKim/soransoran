'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { VALID_REPORT_REASONS, type ReportReason } from '@/lib/report-reasons'
import { requireOnboarded } from '@/lib/onboarding-guard'

/** 신고: 사용자당 10분에 5건 — 신고 자체가 괴롭힘 수단이 되지 않게 제한한다 */
const REPORT_LIMIT = 5
const REPORT_WINDOW_MS = 10 * 60 * 1000

/**
 * 🔴 needsOnboarding 은 optional 이다.
 *    지금 화면들은 error 만 읽는다. 필수로 두면 기존 반환 경로가 전부 깨진다.
 *    O3-B 에서 화면이 이 값으로 온보딩 안내를 띄울지 정한다.
 *
 * 🔴 already 도 같은 이유로 optional 이다.
 *    done 만 읽던 화면은 그대로 동작하고, 읽는 화면만 최초와 중복을 가른다.
 */
export type ReportActionState = {
  error?: string
  done?: boolean
  already?: true
  needsOnboarding?: true
}

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

  // 🔴 저장 전에 막는다. 여기서 통과해야 아래 어떤 write 도 일어나지 않는다.
  const blocked = await requireOnboarded(userId)
  if (blocked) return blocked

  const postId = String(formData.get('postId') ?? '') || null
  const commentId = String(formData.get('commentId') ?? '') || null
  const reason = String(formData.get('reason') ?? '')
  const detail = String(formData.get('detail') ?? '').trim() || null

  if (!postId && !commentId) return { error: '신고 대상을 찾을 수 없습니다.' }
  if (!VALID_REPORT_REASONS.has(reason)) return { error: '신고 사유를 선택해 주세요.' }

  const limited = checkActionRateLimit('report', userId, REPORT_LIMIT, REPORT_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  // 같은 대상을 중복 신고해도 한 건만 남긴다
  const existing = await prisma.report.findFirst({
    where: { reporterId: userId, postId, commentId },
    select: { id: true },
  })
  /**
   * 🔴 여기서는 새 row 가 생기지 않는다. 그러니 화면이 최초 신고와 같은 말을 하면 안 된다.
   *    `already` 를 함께 돌려주는 것은 그 한 가지 때문이다.
   *
   * 🔴 이번에는 기존 신고의 reason·detail 을 갱신하지 않는다.
   *    사유를 덮어쓰는 것은 운영자가 이미 보고 있을 수 있는 접수 건을 바꾸는 일이다 —
   *    DB write 경로가 달라지므로 별도 판단으로 남긴다.
   */
  if (existing) return { done: true, already: true }

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
