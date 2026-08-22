import Header from '@/components/layouts/Header'
import IconMenu from '@/components/layouts/IconMenu'
import EmptyState from '@/components/layouts/EmptyState'
import { getBoardBySlug } from '@/lib/board-registry'

export const metadata = { title: '매거진' }

export default function MagazinePage() {
  const board = getBoardBySlug('magazine')!
  return (
    <>
      <Header />
      <IconMenu />
      <main className="mx-auto max-w-3xl px-4">
        <h1 className="py-6 text-xl font-bold text-content-primary">매거진</h1>
        {/* 매거진에는 글쓰기 버튼을 노출하지 않는다 (IA 정본) */}
        <EmptyState title={board.emptyTitle} body={board.emptyBody} />
      </main>
    </>
  )
}
