import type { Metadata } from 'next'
import { TOUCH_MIN } from '@/lib/spacing'
import PageShell from '@/components/layouts/PageShell'
import { requireMyUserId, BackToMy } from '@/components/features/my/shell'
import { CONTACT_EMAIL } from '@/lib/public-site-info'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '탈퇴 안내',
  robots: { index: false, follow: false },
}

const PATH = '/my/withdrawal'

/**
 * 🔴 여기서 계정을 지우지 않는다. 버튼을 두면 누른 순간 끝났다고 읽힌다 —
 *    탈퇴는 사람이 확인한 뒤 처리한다. 그래서 안내와 메일 링크만 둔다.
 */
export default async function WithdrawalPage() {
  await requireMyUserId(PATH)

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-3">
        <BackToMy />
        <h1 className="mt-2 text-xl font-bold text-content-primary">탈퇴 안내</h1>

        <p className="mt-4 leading-relaxed text-content-primary">
          이 화면에서 바로 탈퇴되지는 않습니다. 문의로 요청해 주시면 확인 후 처리해 드립니다.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-content-secondary">
          탈퇴하셔도 이미 쓰신 글과 댓글은 대화 맥락을 위해 남을 수 있습니다. 지우고 싶은 글이
          있으시면 탈퇴 전에 글 화면에서 직접 지워주세요.
        </p>

        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className={`mt-6 inline-flex ${TOUCH_MIN} items-center rounded-lg border border-interactive px-4 font-bold text-brand-strong no-underline transition duration-150 hover:bg-surface-soft active:scale-[0.98]`}
        >
          문의로 탈퇴 요청하기
        </a>
      </main>
    </PageShell>
  )
}
