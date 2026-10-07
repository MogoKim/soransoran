import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { isSignupFunnelKey, type SignupFunnelKey } from '@/lib/signup-funnel'

/**
 * 회원가입 전환 일별 집계 저장 — SignupFunnelDaily 에 쓰는 **유일한** 자리.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-8.
 *
 * 🔴 DB 는 인자로 받는다. 이 파일이 prisma 싱글턴을 직접 부르지 않는다 —
 *    시험에서 "호출되면 실패하는" 대역을 넣어 gate 비활성 시 DB 접근 0 을 증명할 수 있어야 한다(정본 §8-13).
 *
 * 🔴 날짜 계산 · gate · env · 인증을 여기서 하지 않는다. 그 판정은 부르는 쪽이 끝낸 뒤에 이 함수를 부른다.
 *
 * 🔴 실패를 여기서 삼키지 않는다. 계측 실패가 사용자 흐름을 막지 않게 하는 일(정본 §8-5 · §8-11)은
 *    부르는 쪽이 정한다 — 여기서 삼키면 어떤 호출부도 실패를 알 수 없다.
 */
export type SignupFunnelDb = Pick<PrismaClient, 'signupFunnelDaily'>

/**
 * 한 칸을 +1 한다. 행이 없으면 1 로 만든다.
 *
 * 🔴 Prisma upsert + increment 하나로 한다. 읽고 더해 쓰지 않는다 — 동시 요청에서 한쪽이 사라진다.
 *    Raw SQL 을 쓰지 않는다.
 * 🔴 updatedAt 은 부르는 쪽이 준 시각으로 쓴다. 이 함수가 시계를 읽지 않는다.
 */
export async function incrementSignupFunnel(db: SignupFunnelDb, key: SignupFunnelKey, now: Date): Promise<void> {
  if (!isSignupFunnelKey(key)) throw new TypeError('signup funnel key 가 계약 밖의 값이다')

  const { day, step, contentType, entryPoint } = key
  await db.signupFunnelDaily.upsert({
    where: { day_step_contentType_entryPoint: { day, step, contentType, entryPoint } },
    create: { day, step, contentType, entryPoint, count: 1, updatedAt: now },
    update: { count: { increment: 1 }, updatedAt: now },
  })
}
