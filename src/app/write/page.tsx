import type { Metadata } from 'next'
import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import PostForm from '@/components/features/PostForm'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { loginHref } from '@/lib/callback-url'

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

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-xl font-bold text-content-primary">글쓰기</h1>

        {session?.user ? (
          <PostForm defaultBoardSlug={searchParams.board} />
        ) : (
          <EmptyState
            title={boardLabel ? `${boardLabel}에 이야기를 남겨보세요` : '이야기를 남겨보세요'}
            body="카카오로 시작하면 바로 이어서 쓸 수 있어요. 짧게 써도 괜찮습니다."
            ctaLabel="카카오로 시작하기"
            ctaHref={loginHref(writePath)}
          />
        )}
      </main>
    </PageShell>
  )
}
