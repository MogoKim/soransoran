import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import PostForm from '@/components/features/PostForm'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import KakaoSignInButton from '@/components/features/KakaoSignInButton'
import { toInternalPath } from '@/lib/callback-url'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = {
  title: '글쓰기',
  // 로그인해야 쓰는 기능 화면이다. 검색 결과에 나올 이유가 없다.
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function WritePage({
  searchParams,
}: {
  searchParams: { board?: string }
}) {
  const session = await auth()
  // 로그인하고 오면 쓰려던 게시판 그대로 다시 연다.
  // board 가 없으면 붙이지 않는다 — 빈 파라미터가 남으면 목적지가 지저분해진다.
  const board = searchParams.board
  const writePath = board ? `/write?board=${encodeURIComponent(board)}` : '/write'

  // 어느 게시판에 쓰려던 것인지 이름으로 되짚어 준다. 이름은 board-registry 가 정한다.
  //
  // 🔴 값이 확실할 때만 말한다.
  //    board 가 없거나 커뮤니티 게시판이 아니면 게시판 이름을 지어내지 않고 일반 문구로 간다.
  //    PostForm 은 잘못된 값을 COMMUNITY_BOARDS[0] 로 떨어뜨리는데, 그 fallback 을
  //    여기서 따라 적으면 규칙이 두 곳에 생긴다. 로그인 뒤 동작은 그대로 두고
  //    이 화면에서 단정만 하지 않는다.
  const targetBoard = board ? getBoardBySlug(board) : undefined
  const boardLabel = targetBoard?.isCommunity ? targetBoard.label : null

  /**
   * 🔴 가입을 안 끝낸 사람에게 폼을 그리지 않는다.
   *    저장은 createPost 가 막지만, 그건 다 쓰고 누른 뒤의 일이다.
   *    들어온 순간 보내는 편이 쓴 것을 잃지 않는다.
   *
   * 🔴 isOnboarded 만 본다 — 서버 액션 guard 와 같은 규칙이다.
   *    여기서 다른 기준으로 판정하면 화면은 보내는데 저장은 통과하는
   *    (또는 그 반대의) 상태가 생긴다.
   *
   * 🔴 돌아올 곳에 board 를 함께 싣는다.
   *    쓰다 만 글은 게시판별 키로 저장되므로, board 가 빠지면 가입을 마치고
   *    돌아와도 그 글이 복원되지 않는다.
   *
   * 🔴 비로그인은 여기 오지 않는다. 그쪽은 아래 카카오 CTA 가 그대로 맡는다.
   *
   * 🔴 회원을 못 찾은 것과 가입을 안 끝낸 것을 구분한다.
   *    User 행이 없으면 온보딩으로 보내도 거기서 할 수 있는 일이 없다 —
   *    다시 로그인할 일이지 가입을 마칠 일이 아니다. 그런 사람을 온보딩에
   *    세우면 아무것도 안 되는 화면을 오가게 된다.
   *    폼을 그대로 두고 createPost 가 "회원 정보를 찾을 수 없습니다" 로 안내한다.
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
   * 🔴 글을 쓰는 동안에는 PageShell 을 두르지 않는다.
   *    로고·게시판 아이콘·FAB·Footer 가 함께 있으면 "구경 중" 화면 안에
   *    폼이 끼어 있는 것처럼 보인다. 이 화면의 목적은 하나뿐이다.
   *    나가는 길과 끝내는 길은 PostForm 의 상단바가 진다.
   *
   * 🔴 로그인 전은 그대로 둔다. 그쪽은 아직 쓰는 화면이 아니라
   *    "들어오세요" 화면이라 평소의 머리·꼬리가 있는 편이 덜 낯설다.
   */
  if (session?.user) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-4 pb-12 pt-[72px]">
        <PostForm defaultBoardSlug={searchParams.board} />
      </main>
    )
  }

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-xl font-bold text-content-primary">글쓰기</h1>

        <EmptyState
          title={boardLabel ? `${boardLabel}에 이야기를 남겨보세요` : '이야기를 남겨보세요'}
          body="카카오로 시작하면 바로 이어서 쓸 수 있어요. 짧게 써도 괜찮습니다."
          action={
            /* callbackUrl 은 내부 경로만 넘긴다. */
            <KakaoSignInButton callbackUrl={toInternalPath(writePath) ?? '/'} />
          }
        />
      </main>
    </PageShell>
  )
}
