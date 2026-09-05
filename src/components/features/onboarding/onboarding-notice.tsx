import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'

/**
 * 가입을 마쳐야 쓸 수 있다는 안내와 그리로 가는 길.
 *
 * 🔴 문구를 여기서 짓지 않는다.
 *    서버 액션이 돌려준 message 를 그대로 보여준다. 화면이 제 말을 지어내면
 *    정책이 바뀐 날 서버와 화면이 서로 다른 말을 하게 된다.
 *
 * 🔴 빨간 오류로 그리지 않는다.
 *    잘못한 것이 아니라 아직 안 끝난 것이다. 붉은 글씨는 "당신이 틀렸다" 로 읽힌다.
 *    같은 자리에 서되 면과 색을 달리해 "여기서 이어가면 된다" 로 보이게 한다.
 *
 * 🔴 role="alert" 를 유지한다.
 *    누르고 나서야 나타나는 안내라, 스크린리더가 그 자리에서 읽어 주어야
 *    무엇이 막았는지 알 수 있다.
 *
 * 🔴 CTA 는 전폭이다.
 *    320px 에서 문구와 나란히 두면 버튼이 눌려 두 글자가 접힌다.
 */
export default function OnboardingNotice({
  message,
  callbackUrl,
}: {
  /** 서버 액션이 돌려준 안내 문구 */
  message: string
  /** 가입을 마친 뒤 돌아올 내부 경로 */
  callbackUrl: string
}) {
  return (
    <div role="alert" className="rounded-xl bg-surface-soft p-4">
      <p className="break-keep leading-relaxed text-content-primary">{message}</p>

      {/* 🔴 거르는 곳은 /onboarding 하나다. 여기서 규칙을 다시 만들지 않는다 —
            서버가 toInternalPath 로 다시 본다. */}
      <Link
        href={`/onboarding?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        className={`mt-3 inline-flex ${TOUCH_MIN} w-full items-center justify-center rounded-lg bg-cta px-5 font-bold text-cta-text no-underline transition duration-150 hover:brightness-95 active:scale-95`}
      >
        가입 마저 하기
      </Link>
    </div>
  )
}
