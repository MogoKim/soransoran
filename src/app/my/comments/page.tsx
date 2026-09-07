import type { Metadata } from 'next'
import Link from 'next/link'
import { getMyComments } from '@/lib/queries/my'
import { getBoardByType } from '@/lib/board-registry'
import { formatRelativeTime } from '@/lib/date'
import PageShell from '@/components/layouts/PageShell'
import { requireMyUserId, BackToMy, EmptyNotice } from '@/components/features/my/shell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '내가 쓴 댓글',
  robots: { index: false, follow: false },
}

const PATH = '/my/comments'

/**
 * 🔴 댓글 행의 주 정보는 내가 쓴 말이고, 원글 제목은 그것이 어디에 붙었는지다.
 *    그래서 댓글을 크게, 원글을 메타로 둔다. 누르면 원글로 간다.
 */
export default async function MyCommentsPage() {
  const userId = await requireMyUserId(PATH)
  const comments = await getMyComments(userId)

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-3">
        <BackToMy />
        <h1 className="mt-2 text-xl font-bold text-content-primary">내가 쓴 댓글</h1>

        {comments.length === 0 ? (
          <EmptyNotice
            text="아직 남기신 댓글이 없어요. 마음이 가는 글에 한 마디 남겨보세요."
            cta="게시판 둘러보기"
            href="/community/free"
          />
        ) : (
          <ul className="mt-2 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
            {comments.map((comment) => {
              const board = getBoardByType(comment.post.boardType)
              if (!board) return null
              return (
                <li key={comment.id}>
                  <Link
                    href={`${board.href}/${comment.post.id}`}
                    className="group block py-3.5 no-underline"
                  >
                    <span className="line-clamp-2 break-keep leading-[1.5] text-content-primary transition-colors duration-150 group-hover:text-brand-strong group-active:text-brand-strong">
                      {comment.content}
                    </span>
                    <span className="mt-2.5 block line-clamp-1 text-meta text-content-muted">
                      {board.label} · {comment.post.title} · {formatRelativeTime(comment.createdAt)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </PageShell>
  )
}
