import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import { BRAND_NAME_WITH_TOPIC } from '@/lib/brand-name'

/**
 * 가입 안내 — 카카오 계정의 성별 정보로 가입이 제한된 경우.
 *
 * 🔴 카카오 CTA 를 다시 두지 않는다.
 *    같은 버튼을 또 누르게 되고, 눌러도 같은 자리로 돌아온다.
 *
 * 🔴 "권한이 없습니다" 같은 말을 쓰지 않는다.
 *    찾아온 사람에게 잘못을 돌리는 문장이다. 우리 쪽 사정으로 설명하고,
 *    성별 정보가 없거나 실제와 다를 수 있는 경우의 길을 함께 둔다.
 *
 * 🔴 로그인 화면과 같은 카드 안에 산다 (bg-surface-card · 화면 전체 높이).
 *    헤더·푸터가 없는 화면이라 나가는 길을 이 안에 두어야 한다.
 */
export default function SignupBlockedNotice() {
  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col bg-surface-card sm:min-h-0 sm:h-[86vh] sm:max-h-[760px] sm:max-w-[420px] sm:rounded-2xl">
      <nav className="shrink-0 px-4 pt-[max(10px,env(safe-area-inset-top))]">
        <Link
          href="/"
          className={`inline-flex ${TOUCH_MIN} items-center gap-1 px-2 font-bold text-content-primary no-underline transition duration-150 hover:text-brand-ink active:scale-[0.98]`}
        >
          <span className="text-2xl leading-none" aria-hidden>
            ‹
          </span>
          <span>홈으로</span>
        </Link>
      </nav>

      <div className="flex flex-1 flex-col justify-center gap-6 px-6 py-8">
        <div>
          <h1 className="break-keep text-2xl font-bold leading-snug text-content-primary">
            가입 안내
          </h1>
          <p className="mt-3 break-keep text-lg leading-relaxed text-content-primary">
            {`${BRAND_NAME_WITH_TOPIC} 여성을 위한 커뮤니티로 운영되고 있어요.`}
          </p>
          <p className="mt-2 break-keep leading-relaxed text-content-secondary">
            그래서 카카오 계정의 성별 정보를 기준으로 가입이 제한될 수 있습니다. 찾아와 주셨는데
            도와드리지 못해 죄송합니다.
          </p>
        </div>

        <div className="rounded-2xl bg-surface-page p-5">
          <p className="break-keep leading-relaxed text-content-primary">
            성별 정보가 없거나 실제와 다르게 되어 있다면 알려주세요. 함께 살펴보고 도와드리겠습니다.
          </p>
        </div>
      </div>

      {/* 🔴 코랄 fill 을 쓰지 않는다. 여기서 권하는 것은 "다시 시도" 가 아니라 "문의" 다 */}
      <div className="shrink-0 px-6 pb-[max(24px,env(safe-area-inset-bottom))]">
        <Link
          href="/contact"
          className={`inline-flex ${TOUCH_MIN} w-full items-center justify-center rounded-lg border border-interactive px-6 font-bold text-brand-ink no-underline transition duration-150 hover:bg-surface-soft active:scale-[0.98]`}
        >
          문의하기
        </Link>
      </div>
    </div>
  )
}
