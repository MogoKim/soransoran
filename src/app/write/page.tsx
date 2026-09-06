import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PostForm from '@/components/features/PostForm'
import { auth } from '@/lib/auth'
import { toInternalPath } from '@/lib/callback-url'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = {
  title: '글쓰기',
  // 비회원에게도 열리지만 검색 결과에 나올 내용은 없다. 빈 입력칸을 색인시킬 이유가 없고,
  // 글이 읽히는 곳은 상세 페이지다.
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function WritePage({
  searchParams,
}: {
  searchParams: { board?: string }
}) {
  const session = await auth()
  const isLoggedIn = Boolean(session?.user)

  // 로그인하고 오면 쓰려던 게시판 그대로 다시 연다.
  // board 가 없으면 붙이지 않는다 — 빈 파라미터가 남으면 목적지가 지저분해진다.
  const board = searchParams.board
  const writePath = board ? `/write?board=${encodeURIComponent(board)}` : '/write'

  /**
   * 🔴 가입을 안 끝낸 회원은 폼을 그리기 전에 온보딩으로 보낸다.
   *    저장은 createPost 가 막지만, 그건 다 쓰고 누른 뒤의 일이다.
   *    비회원과 다른 점은 여기다 — 비회원에게는 글을 다 쓴 뒤 물어볼 것(로그인)이
   *    남아 있어 폼이 쓸모가 있지만, 이쪽은 이미 로그인한 사람이라 물어볼 것이
   *    가입 마무리뿐이고 그걸 뒤로 미룰수록 쓴 글만 위태로워진다.
   *
   * 🔴 isOnboarded 만 본다 — 서버 액션 guard 와 같은 규칙이다.
   *    여기서 다른 기준으로 판정하면 화면은 보내는데 저장은 통과하는
   *    (또는 그 반대의) 상태가 생긴다.
   *
   * 🔴 돌아올 곳에 board 를 함께 싣는다.
   *    쓰다 만 글은 게시판별 키로 저장되므로, board 가 빠지면 가입을 마치고
   *    돌아와도 그 글이 복원되지 않는다.
   *
   * 🔴 회원을 못 찾은 것과 가입을 안 끝낸 것을 구분한다.
   *    User 행이 없으면 온보딩으로 보내도 거기서 할 수 있는 일이 없다 —
   *    다시 로그인할 일이지 가입을 마칠 일이 아니다. 그런 사람을 온보딩에
   *    세우면 아무것도 안 되는 화면을 오가게 된다.
   *    폼을 그대로 두고 createPost 가 MEMBER_NOT_FOUND 문구로 안내한다.
   */
  if (session?.user) {
    const member = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isOnboarded: true },
    })
    if (member && !member.isOnboarded) {
      const back = toInternalPath(writePath) ?? '/write'
      redirect(`/onboarding?callbackUrl=${encodeURIComponent(back)}`)
    }
  }

  /**
   * 🔴 비회원에게도 폼을 연다.
   *    로그인 CTA 를 먼저 세우면 아직 아무것도 쓰지 않은 사람에게 계정부터 요구하게 된다.
   *    글을 쓰고 나면 그 글이 로그인할 이유가 되지만, 쓰기 전에는 이유가 없다.
   *    장벽을 "쓰기 전" 에서 "등록할 때" 로 옮긴다 — 막아야 하는 것은 저장이지 작성이 아니다.
   *
   * 🔴 막는 자리는 그대로 서버에 있다. createPost 가 첫 줄에서 세션을 보고,
   *    /api/uploads 는 401 을 낸다. 이 화면이 여는 것은 입력칸이지 권한이 아니다.
   *
   * 🔴 회원·비회원 모두 PageShell 을 두르지 않는다.
   *    로고·게시판 아이콘·FAB·Footer 가 함께 있으면 "구경 중" 화면 안에
   *    폼이 끼어 있는 것처럼 보인다. 이 화면의 목적은 하나뿐이다.
   *    나가는 길과 끝내는 길은 PostForm 의 상단바가 진다.
   *    비회원만 머리·꼬리를 달면, 같은 글쓰기 화면이 사람에 따라 다르게 생기고
   *    로그인하고 돌아온 순간 화면이 바뀌어 쓰던 자리를 잃는다.
   */
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 pb-12 pt-[72px]">
      <PostForm defaultBoardSlug={searchParams.board} isLoggedIn={isLoggedIn} />
    </main>
  )
}
