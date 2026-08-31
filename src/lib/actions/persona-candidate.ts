'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import {
  planDecision, type CandidateDecision, type CandidateStatus,
} from '@/lib/persona-candidate-rules'

/**
 * 승인 대기열 결정 — 🔴 이 파일이 유일한 write 경로다
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §13
 *
 * 🔴 write 대상은 PersonaApprovalQueue 한 테이블뿐이다.
 *    Post · Comment · User · Persona · PersonaActivityLog 를 건드리지 않는다.
 *
 * 🔴 승인은 발행이 아니다. APPROVED 에 머문다.
 *    PUBLISHED 는 이 파일에서 도달할 수 없다 — 발행 성공을 확인한 경로만
 *    설정할 수 있다(MicroSeedCandidate 와 같은 원칙).
 *
 * 🔴 LLM 을 부르지 않는다. status(Persona) 를 바꾸지 않는다. active 전환 없음.
 *
 * 🔴 반환값에 후보 본문 · 원문 · sourceUrl · sourceRef · author 를 담지 않는다.
 *    실패 사유 문구만 돌려준다.
 *
 * 🔴 전이 규칙은 여기 있지 않다 — persona-candidate-rules.ts 의 순수 함수다.
 *    DB 없이 fixture 로 전수 검증하기 위해서다.
 */

export type DecisionState = { error?: string; nextStatus?: string }

export async function decidePersonaCandidate(
  id: string,
  decision: CandidateDecision,
  declineReason?: string,
): Promise<DecisionState> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: '권한이 없습니다.' }

  const session = await auth()
  const actorId = session?.user?.id
  if (!actorId) return { error: '로그인이 필요합니다.' }

  const target = (id ?? '').trim()
  if (target === '') return { error: '대상을 찾을 수 없습니다.' }

  // 🔴 status 만 읽는다. 본문을 읽어 올 이유가 없다
  const row = await prisma.personaApprovalQueue.findUnique({
    where: { id: target },
    select: { id: true, status: true },
  })
  if (row === null) return { error: '대상을 찾을 수 없습니다.' }

  const plan = planDecision({
    status: row.status as CandidateStatus,
    decision,
    ...(declineReason !== undefined ? { declineReason } : {}),
  })
  if (!plan.ok) return { error: plan.error }

  try {
    // 🔴 조건부 UPDATE 다. 읽은 뒤 결정하는 사이에 다른 사람이 먼저 눌렀으면
    //    여기서 0건이 되어 덮어쓰지 않는다 — PENDING 을 WHERE 에 넣는 이유다.
    const res = await prisma.personaApprovalQueue.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: {
        status: plan.nextStatus,
        declineReason: plan.declineReason,
        decidedBy: actorId,
        decidedAt: new Date(),
      },
    })
    if (res.count === 0) return { error: '이미 처리된 후보입니다. 새로고침해 주세요.' }
  } catch {
    // 🔴 예외 원문을 화면에 싣지 않는다
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  revalidatePath('/admin/persona-candidates')
  revalidatePath(`/admin/persona-candidates/${row.id}`)
  return { nextStatus: plan.nextStatus }
}
