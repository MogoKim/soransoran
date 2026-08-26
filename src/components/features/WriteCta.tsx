import Link from 'next/link'
import { loginHref } from '@/lib/callback-url'

/**
 * 상세 하단 다음 액션 — 읽은 사람이 쓰는 사람이 되게 한다.
 *
 * 🔴 댓글 영역의 로그인 안내와 역할이 다르다.
 *    거기는 "이 글에 반응하기", 여기는 "내 글 쓰기"다. 그래서 문구에서
 *    '로그인' 을 앞세우지 않고 글쓰기로 말한다 — 같은 화면에 로그인 유도가
 *    두 번 있는 것처럼 읽히면 둘 다 힘을 잃는다.
 *
 * 🔴 목적지만 분기하고 버튼 문구는 같다.
 *    비로그인에게 다른 라벨을 주면 "나는 못 쓰는 사람" 으로 먼저 읽힌다.
 *    대신 눌렀을 때 로그인 화면이 나오는 것을 보조 문구로 미리 알린다.
 *
 * 로그인 여부는 서버에서 판정해 넘긴다 — 클라이언트 세션 훅을 쓰지 않는
 * 현재 구조(HeaderAuth) 와 같다. 비로그인 화면에는 HTML 자체가 다르게 나간다.
 */
export default function WriteCta({
  boardSlug,
  isLoggedIn,
}: {
  boardSlug: string
  isLoggedIn: boolean
}) {
  // FAB · U1 과 같은 규약이다. 여기서 형식을 새로 만들지 않는다.
  const writePath = `/write?board=${boardSlug}`
  // 비로그인은 로그인 뒤 이 글쓰기 화면으로 돌아온다 (callbackUrl 은 loginHref 가 거른다)
  const href = isLoggedIn ? writePath : loginHref(writePath)

  return (
    <section className="mt-10 rounded-lg bg-surface-page px-5 py-6 text-center">
      <p className="m-0 font-bold text-content-primary">당신의 이야기도 궁금합니다</p>

      {isLoggedIn ? null : (
        <p className="m-0 mt-1 text-sm text-content-muted">
          카카오로 시작하면 바로 쓸 수 있어요
        </p>
      )}

      <Link
        href={href}
        className="mt-4 inline-flex min-h-[52px] items-center rounded-lg bg-cta px-6 font-bold text-cta-text no-underline border border-cta-edge transition duration-150 hover:border-cta-hover hover:brightness-95 active:scale-95"
      >
        이야기 남기기
      </Link>
    </section>
  )
}
