import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMyProfile } from '@/lib/queries/my'
import { loginHref } from '@/lib/callback-url'
import PageShell from '@/components/layouts/PageShell'
import NicknameForm from '@/components/features/my/NicknameForm'
import { requireMyUserId, BackToMy } from '@/components/features/my/shell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '닉네임 변경',
  robots: { index: false, follow: false },
}

const PATH = '/my/nickname'

export default async function NicknamePage() {
  const userId = await requireMyUserId(PATH)
  const profile = await getMyProfile(userId)
  if (!profile) redirect(loginHref(PATH))

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-3">
        <BackToMy />
        <h1 className="mt-2 text-xl font-bold text-content-primary">닉네임 변경</h1>
        <p className="mt-2 text-sm leading-relaxed text-content-muted">
          글과 댓글에 이 이름으로 보입니다.
        </p>
        <NicknameForm current={profile.nickname ?? ''} />
      </main>
    </PageShell>
  )
}
