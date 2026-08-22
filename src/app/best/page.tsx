import Header from '@/components/layouts/Header'
import IconMenu from '@/components/layouts/IconMenu'
import EmptyState from '@/components/layouts/EmptyState'
import { getBoardBySlug } from '@/lib/board-registry'

export const metadata = { title: '베스트' }

export default function BestPage() {
  const board = getBoardBySlug('best')!
  return (
    <>
      <Header />
      <IconMenu />
      <main className="mx-auto max-w-3xl px-4">
        <h1 className="py-6 text-xl font-bold text-content-primary">베스트</h1>
        {/* 베스트는 모아보기 영역이다. 글쓰기 진입점을 두지 않는다. */}
        <EmptyState title={board.emptyTitle} body={board.emptyBody} />
      </main>
    </>
  )
}
