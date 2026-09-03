import type { Metadata } from 'next'
import Link from 'next/link'
import { getMyScraps } from '@/lib/queries/my'
import { getBoardByType } from '@/lib/board-registry'
import { formatRelativeTime } from '@/lib/date'
import PageShell from '@/components/layouts/PageShell'
import { requireMyUserId, BackToMy } from '@/components/features/my/shell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '스크랩한 글',
  robots: { index: false, follow: false },
}

const PATH = '/my/scraps'

/**
 * 🔴 해제 버튼을 여기 두지 않는다. 행을 누르면 글 화면으로 가고,
 *    담고 푸는 일은 거기 더보기가 맡는다 — 푸는 곳이 둘이면 규칙도 둘이 된다.
 */
export default async function MyScrapsPage() {
  const userId = await requireMyUserId(PATH)
  const scraps = await getMyScraps(userId)

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-3">
        <BackToMy />
        <h1 className="mt-2 text-xl font-bold text-content-primary">스크랩한 글</h1>

        {scraps.length === 0 ? (
          <p className="py-10 leading-relaxed text-content-muted">
            아직 담아 두신 글이 없어요. 글 아래 더보기에서 스크랩하면 여기 모입니다.
          </p>
        ) : (
          <ul className="mt-2 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
            {scraps.map((scrap) => {
              const board = getBoardByType(scrap.post.boardType)
              if (!board) return null
              return (
                <li key={scrap.id}>
                  <Link
                    href={`${board.href}/${scrap.post.id}`}
                    className="group block py-3.5 no-underline"
                  >
                    <span className="line-clamp-2 break-keep text-lg font-bold leading-[1.35] text-content-primary transition-colors duration-150 group-hover:text-brand-ink group-active:text-brand-ink">
                      {scrap.post.title}
                    </span>
                    <span className="mt-2.5 block text-meta text-content-muted">
                      {board.label} · {formatRelativeTime(scrap.post.createdAt)}
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
