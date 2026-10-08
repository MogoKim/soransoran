import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { SIGNUP_FUNNEL_CONTENT_TYPES, SIGNUP_FUNNEL_STEPS } from '@/lib/signup-funnel'
import { buildConversionCounts, type ConversionCounts } from '@/lib/signup-funnel-admin'
import { signupFunnelGate, type SignupFunnelEnv, type SignupFunnelGate } from '@/lib/signup-funnel-gate'

/**
 * 가입 전환 어드민 reader — 수집 시작일부터 오늘(KST)까지의 content_end 누계.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-7 · §10.
 *
 * 🔴 writer 와 같은 gate 를 본다. gate 가 닫혀 있으면 SignupFunnelDaily 를 읽지 않는다(Preview·개발·수집 전).
 * 🔴 열려 있으면 groupBy 한 번이다. 허용된 다섯 단계 · 두 유형 · content_end 만 묻는다.
 * 🔴 숫자만 돌려준다. 회원·콘텐츠 값은 이 표에 없다.
 */
export type SignupConversionReport = { gate: SignupFunnelGate; counts: ConversionCounts | null }

export async function loadSignupConversion(
  db: Pick<PrismaClient, 'signupFunnelDaily'>,
  env: SignupFunnelEnv,
  now: Date,
): Promise<SignupConversionReport> {
  const gate = signupFunnelGate(env, now)
  if (!gate.active) return { gate, counts: null }

  const groups = await db.signupFunnelDaily.groupBy({
    by: ['step', 'contentType'],
    where: {
      day: { gte: gate.startDay, lte: gate.today },
      entryPoint: 'content_end',
      step: { in: [...SIGNUP_FUNNEL_STEPS] },
      contentType: { in: [...SIGNUP_FUNNEL_CONTENT_TYPES] },
    },
    _sum: { count: true },
  })

  return {
    gate,
    counts: buildConversionCounts(groups.map((g) => ({ step: g.step, contentType: g.contentType, count: g._sum.count ?? 0 }))),
  }
}
