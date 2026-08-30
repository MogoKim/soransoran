import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { loginHref, onboardingHref } from '@/lib/callback-url'
import { requireOnboarded } from '@/lib/onboarding-guard'
import { getMyPageData } from '@/lib/queries/my'
import { getBoardByType } from '@/lib/board-registry'
import { displayName } from '@/lib/display-name'
import { formatRelativeTime } from '@/lib/date'
import PageShell from '@/components/layouts/PageShell'
import SignOutButton from '@/components/features/SignOutButton'
import NicknameForm from '@/components/features/my/NicknameForm'

export const dynamic = 'force-dynamic'

/** 내 계정 화면은 검색 결과에 있을 이유가 없다 */
export const metadata: Metadata = {
  title: '내 정보',
  robots: { index: false, follow: false },
}

const MY_PATH = '/my'
const CONTACT = 'soransoran.community@gmail.com'

const GUIDE_LINKS = [
  { href: '/rules', label: '커뮤니티 규칙' },
  { href: '/faq', label: '자주 묻는 질문' },
  { href: '/contact', label: '문의' },
  { href: '/terms', label: '이용약관' },
  { href: '/privacy', label: '개인정보처리방침' },
] as const

function joinedOn(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 가입`
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-sm text-content-muted">{children}</p>
}

export default async function MyPage() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) redirect(loginHref(MY_PATH))

  const blocked = await requireOnboarded(userId)
  if (blocked?.needsOnboarding) redirect(onboardingHref(MY_PATH))
  // 회원 정보가 없으면 세션만 남은 상태다. 다시 로그인시킨다.
  if (blocked) redirect(loginHref(MY_PATH))

  const { profile, posts, comments } = await getMyPageData(userId)
  if (!profile) redirect(loginHref(MY_PATH))

  const shownName = displayName(profile)

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        <h1 className="text-xl font-bold text-content-primary">내 정보</h1>

        <section className="mt-4" aria-labelledby="my-account">
          <h2 id="my-account" className="sr-only">
            계정
          </h2>
          <p className="text-lg font-bold text-content-primary">{shownName}</p>
          <p className="mt-1 text-sm text-content-muted">
            {joinedOn(profile.createdAt)} · 카카오 로그인
          </p>
          <NicknameForm current={profile.nickname ?? ''} />
        </section>

        <section className="mt-8" aria-labelledby="my-posts">
          <h2 id="my-posts" className="text-lg font-bold text-content-primary">
            내가 쓴 글
          </h2>
          {posts.length === 0 ? (
            <EmptyLine>아직 쓰신 글이 없어요. 편할 때 한 줄 남겨보세요.</EmptyLine>
          ) : (
            <ul className="mt-1 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
              {posts.map((post) => {
                const board = getBoardByType(post.boardType)
                if (!board) return null
                return (
                  <li key={post.id}>
                    <Link
                      href={`${board.href}/${post.id}`}
                      className="group block py-3.5 no-underline"
                    >
                      <span className="line-clamp-2 break-keep font-semibold leading-[1.5] text-content-primary transition-colors duration-150 group-hover:text-brand-ink group-active:text-brand-ink">
                        {post.title}
                      </span>
                      <span className="mt-1.5 block text-xs text-content-muted">
                        {board.label} · {formatRelativeTime(post.createdAt)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="mt-8" aria-labelledby="my-comments">
          <h2 id="my-comments" className="text-lg font-bold text-content-primary">
            내가 쓴 댓글
          </h2>
          {comments.length === 0 ? (
            <EmptyLine>아직 남기신 댓글이 없어요.</EmptyLine>
          ) : (
            <ul className="mt-1 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
              {comments.map((comment) => {
                const board = getBoardByType(comment.post.boardType)
                if (!board) return null
                return (
                  <li key={comment.id}>
                    <Link
                      href={`${board.href}/${comment.post.id}`}
                      className="group block py-3.5 no-underline"
                    >
                      <span className="line-clamp-2 break-keep leading-[1.5] text-content-primary transition-colors duration-150 group-hover:text-brand-ink group-active:text-brand-ink">
                        {comment.content}
                      </span>
                      <span className="mt-1.5 block text-xs text-content-muted">
                        {board.label} · {comment.post.title} ·{' '}
                        {formatRelativeTime(comment.createdAt)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="mt-8" aria-labelledby="my-guide">
          <h2 id="my-guide" className="text-lg font-bold text-content-primary">
            안내
          </h2>
          <ul className="mt-1 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
            {GUIDE_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-[52px] items-center text-content-primary no-underline transition-colors duration-150 hover:text-brand-ink"
                >
                  {link.label}
                  {/* 줄만 있으면 읽을거리인지 눌러 갈 곳인지 구분되지 않는다 — 목록 행과 같은 표시를 쓴다 */}
                  <span aria-hidden className="ml-auto shrink-0 text-content-muted">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {/* 🔴 여기서 계정을 지우지 않는다. 버튼처럼 보이면 누른 순간 끝났다고 읽힌다 —
                탈퇴는 사람이 확인한 뒤 처리한다. 그래서 문단으로 두고 메일로만 연결한다. */}
          <div className="mt-6 rounded-lg border border-subtle p-4">
            <p className="font-bold text-content-primary">탈퇴 안내</p>
            <p className="mt-2 text-sm leading-relaxed text-content-secondary">
              탈퇴를 원하시면 문의로 요청해 주세요. 확인 후 처리해 드립니다. 이 화면에서 바로
              탈퇴되지는 않습니다.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-content-secondary">
              탈퇴하셔도 이미 쓰신 글과 댓글은 대화 맥락을 위해 남을 수 있습니다. 지우고 싶은 글이
              있으시면 탈퇴 전에 글 화면에서 직접 지워주세요.
            </p>
            <a
              href={`mailto:${CONTACT}`}
              className="mt-3 inline-flex min-h-[52px] items-center text-link underline underline-offset-2"
            >
              문의로 탈퇴 요청하기
            </a>
          </div>
        </section>

        <div className="mt-8 flex justify-center">
          <SignOutButton />
        </div>
      </main>
    </PageShell>
  )
}
