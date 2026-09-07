import type { Metadata } from 'next'
import Link from 'next/link'
import { getMyPosts } from '@/lib/queries/my'
import { getBoardByType } from '@/lib/board-registry'
import { formatRelativeTime } from '@/lib/date'
import PageShell from '@/components/layouts/PageShell'
import { requireMyUserId, BackToMy, EmptyNotice } from '@/components/features/my/shell'
import { TITLE_CARD } from '@/lib/typography'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '내가 쓴 글',
  robots: { index: false, follow: false },
}

const PATH = '/my/posts'

/**
 * 🔴 지우는 버튼을 여기 두지 않는다. 행을 누르면 글 화면으로 가고,
 *    지우는 일은 거기 있는 본인 흐름이 맡는다 — 지우는 곳이 둘이면 규칙도 둘이 된다.
 */
export default async function MyPostsPage() {
  const userId = await requireMyUserId(PATH)
  const posts = await getMyPosts(userId)

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-3">
        <BackToMy />
        <h1 className="mt-2 text-xl font-bold text-content-primary">내가 쓴 글</h1>

        {posts.length === 0 ? (
          <EmptyNotice
            text="아직 쓰신 글이 없어요. 편할 때 한 줄 남겨보세요."
            cta="글쓰러 가기"
            href="/write"
          />
        ) : (
          <ul className="mt-2 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
            {posts.map((post) => {
              const board = getBoardByType(post.boardType)
              if (!board) return null
              return (
                <li key={post.id}>
                  <Link href={`${board.href}/${post.id}`} className="group block py-3.5 no-underline">
                    <h2 className={`line-clamp-2 break-keep ${TITLE_CARD} text-content-primary transition-colors duration-150 group-hover:text-brand-strong group-active:text-brand-strong`}>
                      {post.title}
                    </h2>
                    <span className="mt-2.5 block text-meta text-content-muted">
                      {board.label} · {formatRelativeTime(post.createdAt)}
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
