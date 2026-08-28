'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
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
 * 온보딩 완료 — 닉네임과 동의를 한 번에 저장한다.
 *
 * 🔴 한 트랜잭션으로 쓴다.
 *    닉네임만 저장되고 동의가 빠지거나, 그 반대가 남으면
 *    다음 로그인에서 무엇을 다시 물어야 할지 알 수 없다.
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

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          nickname: trimmed,
          isOnboarded: true,
          ...(agreed.marketing ? { marketingConsentAt: agreedAt } : {}),
        },
      }),
      // 같은 판본에 두 번 동의한 것으로 쌓이지 않는다. 다시 왔으면 시각만 새로 쓴다.
      ...rows.map(({ type, version }) =>
        prisma.agreement.upsert({
          where: { userId_type_version: { userId, type, version } },
          create: { userId, type, version, agreedAt },
          update: { agreedAt },
        }),
      ),
    ])
  } catch (error) {
    // 🔴 어느 계정인지 남기지 않는다.
    console.error('[onboarding] save failed:', (error as Error).message)
    return { error: '가입 처리 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' }
  }

  return { ok: true }
}
