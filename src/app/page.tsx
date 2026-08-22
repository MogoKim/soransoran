import Link from 'next/link'
import Header from '@/components/layouts/Header'
import IconMenu from '@/components/layouts/IconMenu'
import Logo from '@/components/brand/Logo'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'

/**
 * 홈 — 첫 화면 3초 브랜드 신호 4개 (정본 §10)
 *   1 워드마크
 *   2 한 줄 정의 — SEO title 과 같은 문장을 화면에도 노출한다
 *   3 갱년기톡 최상단
 *   4 글쓰기 진입 (FAB)
 *
 * 🔴 접속자 수 / 실시간 배지 / 게시글 수를 넣지 않는다.
 */
export default function HomePage() {
  return (
    <>
      <Header />
      <IconMenu />

      <main className="mx-auto max-w-3xl px-4 pb-24">
        <section className="py-10 text-center">
          <Logo className="text-4xl" />
          <p className="mt-3 text-lg text-content-primary">
            40대 50대 여성이 이야기하는 곳
          </p>
          <p className="mt-1 text-sm text-content-muted">
            갱년기, 몸과 마음, 사는 이야기
          </p>
        </section>

        <section className="flex flex-col gap-3">
          {COMMUNITY_BOARDS.map((board) => (
            <Link
              key={board.type}
              href={board.href}
              className="rounded-lg border border-subtle bg-surface-card p-5 no-underline"
            >
              <p className="font-bold text-brand-ink">{board.label}</p>
              <p className="mt-1 text-sm text-content-muted">{board.emptyTitle}</p>
            </Link>
          ))}
        </section>
      </main>

      {/* FAB — 여기가 "쓰는 곳"임을 보여준다 */}
      <Link
        href="/write"
        className="fixed bottom-6 right-5 inline-flex min-h-[56px] items-center rounded-full bg-cta px-6 font-bold text-cta-text no-underline shadow-lg hover:bg-cta-hover"
      >
        ✏️ 글쓰기
      </Link>
    </>
  )
}
