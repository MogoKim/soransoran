import { notFound, redirect } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import PostEditForm from '@/components/features/PostEditForm'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { loginHref } from '@/lib/callback-url'
import { getPostDetail } from '@/lib/queries/posts'

export const dynamic = 'force-dynamic'

/**
 * 글 수정 화면 — 본인 글만
 *
 * 🔴 metadata 를 두지 않는다.
 *    비로그인은 로그인으로 보내고 남의 글은 notFound 라, 크롤러에게는
 *    이 주소가 애초에 열리지 않는다. 색인될 몸통이 없는데 robots 를 적으면
 *    관리해야 할 노출면만 하나 늘어난다.
 *
 * 🔴 남의 글에 "권한이 없습니다" 를 보여주지 않는다.
 *    그 문장은 "그 글이 있다" 는 사실을 알려준다. 없는 것처럼 닫는다.
 *
 * 🔴 조회 쿼리를 새로 만들지 않고 getPostDetail 을 쓴다.
 *    댓글까지 같이 읽어 오는 것은 낭비지만, 노출 판정(3축·차단 회원)이
 *    상세 화면과 한 지점에서 갈린다. 여기만 따로 조건을 적으면 언젠가 어긋난다.
 */
export default async function PostEditPage({
  params,
}: {
  params: { boardSlug: string; postId: string }
}) {
  const board = getBoardBySlug(params.boardSlug)
  if (!board || !board.isCommunity) notFound()

  const detail = await getPostDetail(params.postId)
  if (!detail || detail.post.boardType !== board.type) notFound()

  const { post } = detail
  const session = await auth()

  const editHref = `${board.href}/${post.id}/edit`
  // 로그인하고 오면 고치던 화면으로 그대로 돌아온다
  if (!session?.user) redirect(loginHref(editHref))
  if (session.user.id !== post.author.id) notFound()

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-xl font-bold text-content-primary">글 수정</h1>
        <PostEditForm
          boardSlug={board.slug}
          postId={post.id}
          initialTitle={post.title}
          initialContent={post.content}
          cancelHref={`${board.href}/${post.id}`}
        />
      </main>
    </PageShell>
  )
}
