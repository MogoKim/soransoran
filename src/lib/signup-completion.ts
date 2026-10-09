import 'server-only'

import type { PrismaClient } from '@prisma/client'
import type { SignupFunnelKey } from '@/lib/signup-funnel'
import { signupFunnelGate, type SignupFunnelEnv } from '@/lib/signup-funnel-gate'
import { parseAuthMarker } from '@/lib/signup-prompt-storage'

/**
 * 가입 완료 — 최초 온보딩 전환의 원자성과 ⑤ signup_complete 기록.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-4 · §8-5 · §8-7.
 *
 * 🔴 server action 파일에서 꺼낸 이유: 'use server' 파일에서 내보낸 함수는 브라우저가 부를 수 있는 action 이 된다.
 *    회원 id 를 받는 이 함수들을 그곳에 두면 안 된다. DB 를 주입받아 격리 DB 로 시험할 수 있게 둔다.
 */

export type FirstOnboardingInput = {
  userId: string
  nickname: string
  agreedAt: Date
  marketing: boolean
  agreements: ReadonlyArray<{ type: string; version: string }>
}

/**
 * 최초 온보딩 전환 — 한 interactive transaction.
 *
 * 🔴 1회 보장의 근거는 `isOnboarded: false` 를 조건으로 건 updateMany 의 count 하나다.
 *    먼저 읽고 나중에 쓰는 방식은 동시 요청 둘을 모두 통과시킨다. Postgres 는 같은 행을 잠그고 두 번째 요청의
 *    조건을 다시 평가하므로 count 가 1 인 요청은 하나뿐이다.
 * 🔴 count 0(이미 마침 · 동시 요청의 패자)이면 약관 행을 쓰지도 갱신하지도 않는다.
 * 🔴 약관 행은 전환을 성공시킨 같은 transaction 안에서 쓴다. 하나라도 실패하면 전부 되돌린다 — 부분 저장 0.
 * 🔴 광고성 정보 수신은 동의했을 때만 시각을 찍는다(기존 의미 그대로).
 */
export async function commitFirstOnboarding(
  db: Pick<PrismaClient, '$transaction'>,
  input: FirstOnboardingInput,
): Promise<'onboarded' | 'already'> {
  const { userId, nickname, agreedAt, marketing, agreements } = input
  return db.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId, isOnboarded: false },
      data: { nickname, isOnboarded: true, ...(marketing ? { marketingConsentAt: agreedAt } : {}) },
    })
    if (updated.count !== 1) return 'already'

    // 같은 판본에 두 번 동의한 것으로 쌓이지 않는다. 다시 왔으면 시각만 새로 쓴다.
    for (const { type, version } of agreements) {
      await tx.agreement.upsert({
        where: { userId_type_version: { userId, type, version } },
        create: { userId, type, version, agreedAt },
        update: { agreedAt },
      })
    }
    return 'onboarded'
  })
}

export type SignupCompleteDeps = {
  env: SignupFunnelEnv
  now: () => Date
  /** 관리자·운영 allowlist·가입 allowlist 계정인가 — 기존 판정 규칙을 그대로 부른다 */
  isExcluded: () => Promise<boolean>
  increment: (key: SignupFunnelKey, now: Date) => Promise<void>
}

/**
 * ⑤ signup_complete — 최초 전환이 commit 된 **뒤에만** 부른다. 결과는 가입에 영향을 주지 않는다.
 *
 * 🔴 순서: 귀속 표식 서버 재검증 → 수집 gate → 제외 판정 → upsert 한 번 await.
 *    표식이 무효이거나 gate 가 닫혀 있으면 제외 판정도 집계 DB 도 부르지 않는다.
 * 🔴 제외 판정이 실패하면 숫자를 오염시키지 않도록 기록하지 않는다. 집계 실패는 삼킨다.
 * 🔴 집계 key 는 서버 KST 날짜 · signup_complete · 표식의 contentType · entryPoint 뿐이다. 회원 값은 없다.
 */
export async function recordSignupComplete(attribution: unknown, deps: SignupCompleteDeps): Promise<'recorded' | 'skipped'> {
  const now = deps.now()
  const marker = parseAuthMarker(attribution, now.getTime())
  if (!marker) return 'skipped'

  const gate = signupFunnelGate(deps.env, now)
  if (!gate.active) return 'skipped'

  try {
    if (await deps.isExcluded()) return 'skipped'
  } catch {
    return 'skipped'
  }

  try {
    await deps.increment(
      { day: gate.today, step: 'signup_complete', contentType: marker.contentType, entryPoint: marker.entryPoint },
      now,
    )
    return 'recorded'
  } catch {
    return 'skipped'
  }
}
