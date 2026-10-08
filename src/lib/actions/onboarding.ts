'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkAdminForUser } from '@/lib/admin'
import { isAllowlisted } from '@/lib/signup-policy'
import { commitFirstOnboarding, recordSignupComplete } from '@/lib/signup-completion'
import { incrementSignupFunnel } from '@/lib/signup-funnel-store'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { NICKNAME_TAKEN, validateNicknameFormat } from '@/lib/nickname'
import {
  AGREEMENT_TYPE,
  AGREEMENT_VERSION,
  REQUIRED_AGREEMENTS,
} from '@/lib/agreement-policy'

/** 닉네임 확인: 사용자당 1분에 30건. 입력하면서 부르는 경로라 넉넉히 둔다 */
const NICKNAME_CHECK_LIMIT = 30
const NICKNAME_CHECK_WINDOW_MS = 60 * 1000

/** 이미 마친 사람이 다시 불렀을 때. 실패가 아니라 할 일이 없다는 뜻이다 */
const ALREADY_ONBOARDED = '이미 가입이 끝났어요.'

export type NicknameCheck = { available: boolean; error?: string }
export type OnboardingState = { error?: string; ok?: true }

/**
 * 닉네임을 쓸 수 있는지 본다.
 *
 * 🔴 형식 검사를 먼저 한다. 형식이 틀린 값으로 DB 를 두드리지 않는다.
 * 🔴 이 결과를 믿고 저장하지 않는다. 확인과 저장 사이에 다른 사람이 같은 이름을
 *    가져갈 수 있어, completeOnboarding 이 저장 직전에 다시 본다.
 */
export async function checkNickname(nickname: string): Promise<NicknameCheck> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { available: false, error: '로그인이 필요합니다.' }

  const trimmed = nickname.trim()
  const formatError = validateNicknameFormat(trimmed)
  if (formatError) return { available: false, error: formatError }

  const limited = checkActionRateLimit(
    'nickname-check',
    userId,
    NICKNAME_CHECK_LIMIT,
    NICKNAME_CHECK_WINDOW_MS,
  )
  if (!limited.ok) return { available: false, error: retryMessage(limited.retryAfterSec) }

  const taken = await prisma.user.findUnique({
    where: { nickname: trimmed },
    select: { id: true },
  })
  // 자기 이름을 다시 확인하는 것은 중복이 아니다
  if (taken && taken.id !== userId) return { available: false, error: NICKNAME_TAKEN }

  return { available: true }
}

/**
 * 회원가입 전환 ⑤ 제외 계정인가 — 관리자(isAdmin · 관리자 allowlist)와 가입 allowlist.
 * 🔴 판정 규칙은 기존 함수 그대로다. 필요한 최소 값(이메일 · 카카오 회원번호)만 읽는다.
 */
async function isExcludedFromSignupMetrics(userId: string): Promise<boolean> {
  if ((await checkAdminForUser(userId)).ok) return true
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, accounts: { where: { provider: 'kakao' }, select: { providerAccountId: true } } },
  })
  if (!user) return true
  if (isAllowlisted(undefined, user.email)) return true
  return user.accounts.some((account) => isAllowlisted(account.providerAccountId, null))
}

/**
 * 온보딩 완료 — 닉네임과 동의를 한 번에 저장한다.
 *
 * 🔴 한 트랜잭션으로 쓴다(commitFirstOnboarding).
 *    닉네임만 저장되고 동의가 빠지거나, 그 반대가 남으면
 *    다음 로그인에서 무엇을 다시 물어야 할지 알 수 없다.
 *
 * 🔴 최초 1회의 근거는 transaction 안의 조건부 전환(isOnboarded: false → true) 하나다.
 *    아래 선행 확인은 이미 마친 사람에게 먼저 안내하는 용도일 뿐, 동시 요청을 막지 못한다.
 *
 * 🔴 회원가입 전환 ⑤ 는 가입이 commit 된 뒤에만, 이 요청이 최초 전환을 성공시켰을 때만 판정한다.
 *    attribution 은 브라우저가 넘긴 귀속 표식이라 서버가 다시 검증한다. 계측이 실패해도 가입 결과는 성공이다.
 *
 * 🔴 isOnboarded 가 온보딩 완료의 유일한 진실이다.
 *    닉네임 모양이나 다른 필드로 완료 여부를 다시 판정하지 않는다 —
 *    판정이 두 곳이 되면 언젠가 서로 어긋난다.
 *
 * 🔴 광고성 정보 수신은 동의했을 때만 기록한다.
 *    거절한 사람에게 marketingConsentAt 을 찍거나 MARKETING 행을 남기면
 *    받지 않은 동의를 받은 것으로 만드는 일이다.
 */
export async function completeOnboarding(
  nickname: string,
  agreed: { terms: boolean; privacy: boolean; marketing: boolean },
  attribution?: unknown,
): Promise<OnboardingState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  if (!agreed.terms || !agreed.privacy) {
    return { error: '이용약관과 개인정보처리방침에 동의해 주셔야 시작할 수 있어요.' }
  }

  // 🔴 온보딩은 최초 1회다.
  //    이미 마친 사람이 다시 부르면 닉네임도 동의 이력도 덮어쓰지 않는다.
  //    이 자리를 열어 두면 닉네임 변경 통로가 되어 버리는데,
  //    그것은 정책도 이력 관리도 다른 일이다 (마이페이지에서 따로 다룬다).
  //    여기서는 안내만 한다 — 실제로 막는 것은 저장 transaction 의 조건부 전환이다.
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { isOnboarded: true },
  })
  if (!current) return { error: '회원 정보를 찾을 수 없어요. 다시 로그인해 주세요.' }
  if (current.isOnboarded) return { error: ALREADY_ONBOARDED }

  const trimmed = nickname.trim()
  const formatError = validateNicknameFormat(trimmed)
  if (formatError) return { error: formatError }

  // 확인과 저장 사이에 누가 가져갔을 수 있다. 저장 직전에 다시 본다.
  const check = await checkNickname(trimmed)
  if (!check.available) return { error: check.error ?? NICKNAME_TAKEN }

  const agreedAt = new Date()
  const rows = [
    ...REQUIRED_AGREEMENTS.map((type) => ({ type, version: AGREEMENT_VERSION[type] })),
    ...(agreed.marketing
      ? [
          {
            type: AGREEMENT_TYPE.marketing,
            version: AGREEMENT_VERSION[AGREEMENT_TYPE.marketing],
          },
        ]
      : []),
  ]

  let outcome: 'onboarded' | 'already'
  try {
    outcome = await commitFirstOnboarding(prisma, {
      userId,
      nickname: trimmed,
      agreedAt,
      marketing: agreed.marketing,
      agreements: rows,
    })
  } catch (error) {
    // 🔴 어느 계정인지 남기지 않는다.
    console.error('[onboarding] save failed:', (error as Error).message)
    return { error: '가입 처리 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' }
  }
  if (outcome === 'already') return { error: ALREADY_ONBOARDED }

  // 가입은 이미 commit 됐다. 아래 계측은 결과를 바꾸지 않는다.
  try {
    await recordSignupComplete(attribution, {
      env: {
        VERCEL_ENV: process.env.VERCEL_ENV,
        SIGNUP_FUNNEL_COLLECTION_START: process.env.SIGNUP_FUNNEL_COLLECTION_START,
      },
      now: () => new Date(),
      isExcluded: () => isExcludedFromSignupMetrics(userId),
      increment: (key, now) => incrementSignupFunnel(prisma, key, now),
    })
  } catch {
    // 계측 실패는 가입 실패가 아니다
  }

  return { ok: true }
}
