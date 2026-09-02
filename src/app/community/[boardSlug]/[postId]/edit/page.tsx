import { notFound, redirect } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import PostEditForm from '@/components/features/PostEditForm'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { loginHref } from '@/lib/callback-url'
import { prisma } from '@/lib/prisma'
import { getPostDetail } from '@/lib/queries/posts'
import { toEditorHtml } from '@/lib/post-content-format'

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

  /**
   * 🔴 가입을 안 끝낸 사람에게 폼을 그리지 않는다.
   *    저장은 updatePost 가 막지만, 그건 다 고치고 누른 뒤의 일이다.
   *    들어온 순간 보내는 편이 고쳐 쓴 것을 잃지 않는다.
   *
   * 🔴 isOnboarded 만 본다 — 서버 액션의 guard 와 같은 규칙이다.
   *    여기서 다른 기준으로 판정하면 화면은 보내는데 저장은 통과하는
   *    (또는 그 반대의) 상태가 생긴다.
   */
  const member = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isOnboarded: true },
  })
  if (!member?.isOnboarded) {
    redirect(`/onboarding?callbackUrl=${encodeURIComponent(editHref)}`)
  }

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-xl font-bold text-content-primary">글 수정</h1>
        {/*
          🔴 평문을 그대로 에디터에 넣지 않는다.
             Tiptap 은 HTML 을 파싱하므로 문자열 안의 \n 은 공백처럼 취급되어
             한 문단으로 접힌다. 옛 글은 대부분 평문이고 줄바꿈이 많다 —
             "고치기" 만 눌렀다가 저장하면 줄이 통째로 사라진다.
             화면에 넣기 전에 <br> 로 바꿔 둔다. 이미 HTML 인 글은 손대지 않는다.
        */}
        <PostEditForm
          boardSlug={board.slug}
          postId={post.id}
          initialTitle={post.title}
          initialContent={toEditorHtml(post.content)}
          cancelHref={`${board.href}/${post.id}`}
        />
      </main>
    </PageShell>
  )
}
