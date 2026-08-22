import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import PostForm from '@/components/features/PostForm'
import { auth } from '@/lib/auth'

export const metadata = { title: '글쓰기' }
export const dynamic = 'force-dynamic'

export default async function WritePage({
  searchParams,
}: {
  searchParams: { board?: string }
}) {
  const session = await auth()

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-xl font-bold text-content-primary">글쓰기</h1>

        {session?.user ? (
          <PostForm defaultBoardSlug={searchParams.board} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-content-primary">글은 로그인한 회원만 쓸 수 있습니다.</p>
            <Link
              href="/login"
              className="inline-flex min-h-[52px] w-fit items-center rounded-lg bg-cta px-6 font-bold text-cta-text no-underline"
            >
              로그인하기
            </Link>
          </div>
        )}
      </main>
    </PageShell>
  )
}
