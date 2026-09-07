'use client'

import { useRouter } from 'next/navigation'
import { TOUCH_MIN } from '@/lib/spacing'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import AgreementCheck from '@/components/features/onboarding/agreement-check'
import NicknameField, {
  type NicknameStatus,
} from '@/components/features/onboarding/nickname-field'
import { AGREEMENT_TYPE, REQUIRED_AGREEMENTS } from '@/lib/agreement-policy'
import { checkNickname, completeOnboarding } from '@/lib/actions/onboarding'
import { NICKNAME_AVAILABLE, NICKNAME_TAKEN, validateNicknameFormat } from '@/lib/nickname'
import { BRAND_NAME } from '@/lib/brand-name'
import { cn } from '@/lib/utils'

/** 손을 멈춘 뒤에 물어본다. 글자마다 부르면 1분 30건 제한에 금방 닿는다 */
const CHECK_DELAY_MS = 450

type AgreementKey = keyof typeof AGREEMENT_TYPE

type AgreementItem = {
  key: AgreementKey
  label: string
  href?: string
}

/**
 * 🔴 무엇이 필수인지 여기서 정하지 않는다.
 *    REQUIRED_AGREEMENTS 가 정본이다. 화면에 required: true 를 따로 적어 두면
 *    정책이 바뀐 날 서버는 막는데 화면은 [선택] 이라고 말하는 상태가 된다.
 */
const AGREEMENTS: AgreementItem[] = [
  { key: 'terms', label: '이용약관 동의', href: '/terms' },
  { key: 'privacy', label: '개인정보처리방침 동의', href: '/privacy' },
  { key: 'marketing', label: '마케팅 수신 동의' },
]

const REQUIRED_TYPES: readonly string[] = REQUIRED_AGREEMENTS

function isRequired(key: AgreementKey): boolean {
  return REQUIRED_TYPES.includes(AGREEMENT_TYPE[key])
}

const CTA_CLASS =
  `${TOUCH_MIN} w-full rounded-xl bg-cta px-5 font-bold text-cta-text transition duration-150 enabled:hover:brightness-95 enabled:active:scale-95 disabled:opacity-60`

const BACK_CLASS =
  `${TOUCH_MIN} w-full rounded-xl border border-interactive px-5 font-bold text-content-primary transition duration-150 hover:bg-surface-soft active:scale-[0.98]`

/**
 * 가입 마무리 — 닉네임을 정하고 약관에 동의한다.
 *
 * 🔴 두 단계로 나눈다.
 *    입력칸과 동의 네 줄을 한 화면에 쌓으면 320px 에서 스크롤이 길어지고,
 *    무엇 때문에 시작 버튼이 안 눌리는지 알기 어려워진다.
 *
 * 🔴 상태는 전부 여기 있다. 아래 두 컴포넌트는 받아서 보여주기만 한다.
 *    입력 판정이 화면마다 흩어지면 어느 쪽이 진짜인지 알 수 없게 된다.
 *
 * 🔴 destination 은 page 가 거른 값을 그대로 쓴다. 여기서 다시 정하지 않는다.
 */
export default function OnboardingForm({ destination }: { destination: string }) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)

  const [nickname, setNickname] = useState('')
  const [status, setStatus] = useState<NicknameStatus>('idle')
  const [message, setMessage] = useState('')

  const [agreed, setAgreed] = useState<Record<AgreementKey, boolean>>({
    terms: false,
    privacy: false,
    // 🔴 마케팅 수신은 꺼진 채로 시작한다. 미리 켜 두고 받는 동의는 동의가 아니다.
    marketing: false,
  })

  const [submitError, setSubmitError] = useState('')
  const [isPending, startTransition] = useTransition()
  /** '다음' 을 누른 뒤 중복을 보는 동안. 실시간 확인(status) 과는 다른 축이다 */
  const [checkingNext, setCheckingNext] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 한글은 조합이 끝나야 글자가 된다. 조합 중에는 묻지 않는다 */
  const composingRef = useRef(false)
  /** 늦게 도착한 답이 최신 입력을 덮어쓰지 않게 하는 순번 */
  const requestRef = useRef(0)

  const runCheck = useCallback(async (value: string) => {
    const seq = ++requestRef.current
    setStatus('checking')
    setMessage('')

    const result = await checkNickname(value)
    // 기다리는 사이 더 친 글자가 있으면 이 답은 버린다.
    if (seq !== requestRef.current) return

    if (result.available) {
      setStatus('valid')
      setMessage(NICKNAME_AVAILABLE)
      return
    }
    setStatus('error')
    setMessage(result.error ?? NICKNAME_TAKEN)
  }, [])

  const handleChange = useCallback(
    (value: string) => {
      setNickname(value)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (composingRef.current) return

      // 값이 바뀌었으니 진행 중인 확인의 답은 더 이상 이 값의 것이 아니다.
      requestRef.current += 1

      if (!value) {
        setStatus('idle')
        setMessage('')
        return
      }

      /**
       * 🔴 trim 하지 않은 값으로 본다.
       *    양옆 공백을 먼저 잘라내면 "띄어쓰기는 넣을 수 없어요" 를 만나지 못하고,
       *    사람은 자기가 뭘 잘못 쳤는지 모른 채 같은 실수를 반복한다.
       *
       * 🔴 형식이 틀린 값으로는 서버를 부르지 않는다.
       */
      const formatError = validateNicknameFormat(value)
      if (formatError) {
        setStatus('error')
        setMessage(formatError)
        return
      }

      setStatus('idle')
      setMessage('')
      timerRef.current = setTimeout(() => void runCheck(value), CHECK_DELAY_MS)
    },
    [runCheck],
  )

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    requestRef.current += 1
    setStatus('idle')
    setMessage('')
  }, [])

  const handleCompositionEnd = useCallback(
    (value: string) => {
      composingRef.current = false
      handleChange(value)
    },
    [handleChange],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const allChecked = AGREEMENTS.every((item) => agreed[item.key])
  const requiredDone = AGREEMENTS.filter((item) => isRequired(item.key)).every(
    (item) => agreed[item.key],
  )

  /**
   * 1단계 → 2단계.
   *
   * 🔴 실시간 중복 확인을 기다리지 않는다.
   *    그 확인은 미리 알려주는 편의이지 방어가 아니다 — 저장 직전에
   *    completeOnboarding 이 다시 보고, 확인과 저장 사이에 누가 이름을
   *    가져갔는지도 거기서만 알 수 있다. 편의 장치를 문으로 쓰면
   *    한글을 다 치고도 조합이 끝나기를, 서버가 답하기를 기다리게 된다.
   *
   * 🔴 이미 valid 로 답이 와 있으면 다시 묻지 않는다.
   *    같은 값을 두 번 확인할 이유가 없고, 그만큼 사람이 더 기다린다.
   *
   * 🔴 눌린 뒤 값이 바뀌었으면 그 답을 버린다.
   *    느린 응답이 도착하는 사이 사용자가 이름을 고쳤을 수 있다.
   */
  function handleNext() {
    if (checkingNext) return

    const value = nickname.trim()
    const formatError = validateNicknameFormat(value)
    if (formatError) {
      setStatus('error')
      setMessage(formatError)
      return
    }

    if (status === 'valid') {
      setStep(2)
      return
    }

    setCheckingNext(true)
    const seq = ++requestRef.current

    void checkNickname(value)
      .then((result) => {
        if (seq !== requestRef.current) return
        if (result.available) {
          setStatus('valid')
          setMessage(NICKNAME_AVAILABLE)
          setStep(2)
          return
        }
        setStatus('error')
        setMessage(result.error ?? NICKNAME_TAKEN)
      })
      .catch(() => {
        if (seq !== requestRef.current) return
        setStatus('error')
        setMessage('이름을 확인하지 못했어요. 잠시 뒤 다시 눌러주세요.')
      })
      .finally(() => setCheckingNext(false))
  }

  function toggleAll() {
    const next = !allChecked
    setAgreed({ terms: next, privacy: next, marketing: next })
  }

  function toggle(key: AgreementKey) {
    setAgreed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleSubmit() {
    if (!requiredDone || isPending) return
    setSubmitError('')

    startTransition(async () => {
      const result = await completeOnboarding(nickname, agreed)
      if (result.error) {
        setSubmitError(result.error)
        return
      }
      // 🔴 replace 다. 뒤로 가기로 다 끝낸 가입 화면에 돌아오지 않게 한다.
      router.replace(destination)
    })
  }

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-surface-card sm:min-h-0 sm:max-h-[86vh] sm:max-w-[440px] sm:rounded-2xl sm:shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-[max(32px,env(safe-area-inset-top))]">
        {/* 두 칸짜리 진행 표시 — 지금 어디쯤인지, 얼마나 남았는지 */}
        <div className="mb-8 flex gap-2" aria-hidden>
          <span className="h-1 flex-1 rounded-full bg-brand" />
          <span
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              step === 2 ? 'bg-brand' : 'bg-surface-page',
            )}
          />
        </div>
        <p className="sr-only" aria-live="polite">
          2단계 중 {step}단계
        </p>

        {step === 1 ? (
          <>
            <div className="mb-8 text-center">
              <span className="mb-4 block text-5xl" aria-hidden>
                👋
              </span>
              <h1 className="mb-2 break-keep text-2xl font-bold leading-snug text-content-primary">
                반가워요!
              </h1>
              <p className="break-keep leading-relaxed text-content-secondary">
                {`${BRAND_NAME}에서 쓰실 닉네임을 정해 주세요`}
              </p>
            </div>

            <NicknameField
              value={nickname}
              status={status}
              message={message}
              onChange={handleChange}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
          </>
        ) : (
          <>
            <div className="mb-8 text-center">
              <span className="mb-4 block text-5xl" aria-hidden>
                📋
              </span>
              <h1 className="mb-2 break-keep text-2xl font-bold leading-snug text-content-primary">
                약관 동의
              </h1>
              <p className="break-keep leading-relaxed text-content-secondary">
                서비스 이용을 위해 약관에 동의해 주세요
              </p>
            </div>

            {submitError ? (
              <p
                role="alert"
                className="mb-4 rounded-xl bg-surface-soft p-4 break-keep font-bold leading-relaxed text-state-danger"
              >
                {submitError}
              </p>
            ) : null}

            <div className="mb-8">
              <AgreementCheck
                id="agree-all"
                label="전체 동의"
                checked={allChecked}
                onToggle={toggleAll}
                variant="summary"
              />

              <div className="mt-4 flex flex-col gap-1">
                {AGREEMENTS.map((item) => (
                  <AgreementCheck
                    key={item.key}
                    id={`agree-${item.key}`}
                    label={item.label}
                    checked={agreed[item.key]}
                    onToggle={() => toggle(item.key)}
                    badge={isRequired(item.key) ? 'required' : 'optional'}
                    href={item.href}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-subtle px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-4">
        {step === 1 ? (
          <button
            type="button"
            onClick={handleNext}
            /**
             * 🔴 형식만 본다. 서버 응답을 문으로 쓰지 않는다.
             *    한글은 조합이 끝나야 글자가 되고 확인은 서버를 한 번 다녀온다 —
             *    둘을 다 기다리게 하면 다 쓰고도 버튼이 닫혀 있다.
             *    중복은 눌렀을 때 보고, 저장 직전에 한 번 더 본다.
             */
            disabled={validateNicknameFormat(nickname.trim()) !== null || checkingNext}
            className={CTA_CLASS}
          >
            {checkingNext ? '확인하는 중…' : '다음'}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!requiredDone || isPending}
              className={CTA_CLASS}
            >
              {isPending ? '시작하는 중...' : '시작하기'}
            </button>
            <button type="button" onClick={() => setStep(1)} className={BACK_CLASS}>
              이전
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
