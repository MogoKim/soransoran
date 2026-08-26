import Link from 'next/link'
import { loginHref } from '@/lib/callback-url'

/**
 * 홈 참여 유도 카드 — 비로그인에게만 보인다.
 *
 * 🔴 로그인 사용자에게는 HTML 자체가 나가지 않는다.
 *    서버에서 판정해 null 을 돌려준다. 클라이언트에서 숨기면 잠깐 보였다 사라지고,
 *    무엇보다 이미 회원인 사람에게 가입 문구를 보내는 응답 자체가 어색하다.
 *
 * 🔴 FAB 과 역할을 나눈다.
 *    FAB 은 "지금 쓰기" 라는 상시 액션이고, 이 카드는 "왜 여기 있어야 하는가" 를
 *    한 번 말한다. 그래서 목적지도 다르다 — 카드는 가입(로그인 후 홈)이고
 *    글쓰기는 FAB 과 상세 CTA 가 맡는다.
 *
 * 상세 CTA(WriteCta) 는 중성 배경이고 이 카드는 bg-surface-soft 다.
 * 둘이 같은 화면에 있지는 않지만, 성격이 다른 블록을 같은 옷으로 두지 않는다.
 */
export default function HomeJoinCta({ isLoggedIn }: { isLoggedIn: boolean }) {
  if (isLoggedIn) return null

  return (
    <section className="border-t-4 border-surface-page px-4 py-5">
      <div className="rounded-lg bg-surface-soft px-5 py-6 text-center">
        <p className="m-0 font-bold text-content-primary">
          같은 시기를 지나는 사람들이 있어요
        </p>
        <p className="m-0 mt-1 text-sm text-content-muted">
          카카오로 시작하면 글과 댓글을 남길 수 있어요
        </p>

        <Link
          href={loginHref('/')}
          className="mt-4 inline-flex min-h-[52px] items-center rounded-lg bg-cta px-6 font-bold text-cta-text no-underline border border-cta-edge transition duration-150 hover:border-cta-hover hover:brightness-95 active:scale-95"
        >
          카카오로 시작하기
        </Link>
      </div>
    </section>
  )
}
