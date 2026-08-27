import Link from 'next/link'

/**
 * 가입 자격 안내 — 카카오 계정 성별이 남성으로 확인된 경우.
 *
 * 🔴 로그인 화면을 다시 보여주지 않는다.
 *    같은 버튼을 또 누르게 되고, 눌러도 같은 자리로 돌아온다.
 *
 * 🔴 "권한이 없습니다" 같은 문장을 쓰지 않는다.
 *    찾아온 사람에게 잘못을 돌리는 말이다. 우리 쪽 사정으로 설명하고
 *    성별 정보가 실제와 다를 수 있는 경우의 길을 함께 둔다.
 */
const CONTACT = 'soransoran.community@gmail.com'

export default function SignupBlockedNotice() {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center sm:min-h-0">
      <span
        className="flex h-18 w-18 items-center justify-center rounded-full bg-surface-soft text-4xl"
        aria-hidden
      >
        🌿
      </span>

      <div>
        <h1 className="break-keep text-2xl font-bold leading-snug text-content-primary">
          소란소란은 여성 회원을 위한 커뮤니티예요
        </h1>
        <p className="mt-3 break-keep leading-relaxed text-content-secondary">
          카카오 계정의 성별이 남성으로 확인되어 지금은 가입이 어렵습니다. 찾아와 주셨는데
          도와드리지 못해 죄송합니다.
        </p>
      </div>

      <div className="w-full rounded-2xl bg-surface-page p-5 text-left">
        <p className="break-keep text-sm leading-relaxed text-content-muted">
          성별 정보가 실제와 다르게 되어 있다면 카카오 계정 정보를 확인해 주세요. 확인이
          어려우시면 아래로 알려주시면 함께 살펴보겠습니다.
        </p>
        <a
          href={`mailto:${CONTACT}`}
          className="mt-2 inline-flex min-h-[52px] items-center break-all text-sm text-link underline underline-offset-2"
        >
          {CONTACT}
        </a>
      </div>

      {/* 🔴 코랄 fill 을 쓰지 않는다. 여기서 권하는 것은 "다시 시도" 가 아니라 "돌아가기" 다 */}
      <Link
        href="/"
        className="inline-flex min-h-[52px] w-full items-center justify-center rounded-lg border border-interactive px-6 font-bold text-brand-ink no-underline transition duration-150 hover:bg-surface-soft active:scale-[0.98]"
      >
        홈으로 돌아가기
      </Link>
    </div>
  )
}
