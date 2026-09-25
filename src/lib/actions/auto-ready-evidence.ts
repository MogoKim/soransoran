'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { digestOf } from '@/lib/auto-ready-evidence'
import {
  recordHumanBatch, type BundleItem, type HumanBatchEntry, type HumanBatchResult,
} from '@/lib/auto-ready-evidence-store'
import { resolveHumanReviewer } from '@/lib/review-provenance'

/**
 * 🔴 **자동 READY 증거 — 사람 검토 기록의 유일한 서버 경계** (2026-09-25 마스터 P0-1)
 *
 *   · 누가 검토했나 — **로그인 세션**(`auth()`)과 관리자 판정(`requireAdmin`)으로 서버가 정한다.
 *     인증된 관리자는 `human:operator` 이고, 사람을 가르는 정본은 세션의 `User.id`(reviewerUserId)다.
 *   · 언제 검토했나 — **서버 시계**다.
 *   · 🔴 요청 본문의 `reviewer`·`reviewedAt` 은 **읽지 않는다.** 칸을 골라 받지 않는다 —
 *     아래에서 queueId · decision · declineReason · hardDefect · reasons 다섯 칸만 꺼낸다.
 *   · 인증되지 않았거나 관리자가 아니면 DB write 0.
 *   · 🔴 중대 결함을 비운 행은 **건너뛴다(DB write 0)** — 사람 기록은 yes·no 를 명시한 행만 쓴다.
 *
 * 🔴 이 경계가 쓰는 칸 — 큐의 `editDiff.evidenceReviews` 와, 결정 전 그림자에 한해
 *    정본 `completeReview` 가 쓰는 결정 칸(status · declineReason · decidedBy · decidedAt).
 *    Post · Persona · 발행은 건드리지 않는다.
 */

export type EvidenceBatchState = { error?: string; reviewer?: string; results?: HumanBatchResult[] }

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

export async function submitEvidenceBatch(input: { bundleText: string; entries: unknown }): Promise<EvidenceBatchState> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: '권한이 없습니다.' }
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (user === null) return { error: '사용자를 찾을 수 없습니다.' }
  // 🔴 requireAdmin 을 통과했다 = 관리자다. 누구인지는 세션의 User.id 가 정본이다
  const reviewer = resolveHumanReviewer({ isAdmin: true })
  if (reviewer === null) return { error: '검토자를 정할 수 없습니다.' }

  if (typeof input.bundleText !== 'string' || input.bundleText.length === 0) return { error: '검토 묶음이 없습니다.' }
  let parsed: unknown
  try { parsed = JSON.parse(input.bundleText) } catch { return { error: '검토 묶음이 JSON 이 아닙니다.' } }
  const items: BundleItem[] = []
  for (const it of Array.isArray(rec(parsed).items) ? rec(parsed).items as unknown[] : []) {
    const r = rec(it)
    const d = rec(r.draft)
    if (typeof r.queueId !== 'string' || typeof d.titleDigest !== 'string' || typeof d.bodyDigest !== 'string') continue
    items.push({ queueId: r.queueId, draftTitleDigest: d.titleDigest, draftBodyDigest: d.bodyDigest })
  }
  if (items.length === 0) return { error: '검토 묶음에 행이 없습니다.' }
  if (!Array.isArray(input.entries)) return { error: '입력이 배열이 아닙니다.' }
  // 🔴 다섯 칸만 꺼낸다 — reviewer · reviewedAt 이 들어와도 버려진다
  const entries: HumanBatchEntry[] = (input.entries as unknown[]).map((raw) => {
    const r = rec(raw)
    return {
      queueId: typeof r.queueId === 'string' ? r.queueId : '',
      decision: r.decision, declineReason: r.declineReason, hardDefect: r.hardDefect, reasons: r.reasons,
    }
  }).filter((e) => e.queueId !== '')

  const results = await recordHumanBatch(prisma, {
    actor: { userId, reviewer }, now: new Date(),
    bundle: { digest: digestOf(input.bundleText), items }, entries,
  })
  revalidatePath('/admin/auto-ready-evidence')
  return { reviewer, results }
}
