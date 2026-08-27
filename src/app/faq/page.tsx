import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'

export const metadata: Metadata = {
  title: '자주 묻는 질문',
  description: '소란소란에 처음 오신 분들이 자주 묻는 다섯 가지',
  alternates: { canonical: '/faq' },
}

const LINK = 'text-link underline underline-offset-2'

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: '글은 누가 볼 수 있나요?',
    a: (
      <>
        <p>
          로그인하지 않은 분도 읽을 수 있는 열린 게시판입니다. 인터넷 검색으로 찾아오는 분도 있어요.
          알려지면 곤란한 이야기는 이름이나 지명을 빼고 적어주세요.
        </p>
        <p>
          내가 쓴 글과 댓글은 언제든 직접 고치거나 지울 수 있습니다. 글은 글을 연 화면 아래쪽에서,
          댓글은 내 댓글 옆에서 수정을 누르시면 됩니다.
        </p>
      </>
    ),
  },
  {
    q: '어떤 이야기를 써도 되나요?',
    a: (
      <>
        <p>
          몸과 마음, 가족, 일과 돈, 오늘 있었던 사소한 일까지 편하게 쓰셔도 됩니다. 갱년기 이야기는
          갱년기톡에, 그 밖의 이야기는 자유게시판에 올려주세요.
        </p>
        <p>
          하지 않았으면 하는 것은{' '}
          <Link href="/rules" className={LINK}>
            커뮤니티 규칙
          </Link>
          에 적어 두었습니다.
        </p>
      </>
    ),
  },
  {
    q: '댓글은 어떻게 남기나요?',
    a: (
      <>
        <p>
          글 아래 칸에 쓰고 등록을 누르면 됩니다. 댓글은 로그인한 뒤에 쓸 수 있어요. 카카오로
          로그인하면 읽던 글로 다시 돌아옵니다.
        </p>
        <p>글과 댓글 모두 지금은 글자만 올릴 수 있습니다. 사진이나 동영상은 아직 올릴 수 없어요.</p>
      </>
    ),
  },
  {
    q: '불편한 글이나 댓글을 보면 어떻게 하나요?',
    a: (
      <>
        <p>
          로그인하시면 다른 회원의 글과 댓글 옆에 신고가 보입니다. 눌러주시면 운영자가 직접 읽고
          확인합니다. 신고했다고 해서 글이 곧바로 사라지지는 않고, 확인에 시간이 걸릴 수 있어요.
        </p>
        <p>
          급한 일이라면{' '}
          <Link href="/contact" className={LINK}>
            문의
          </Link>
          로도 알려주실 수 있습니다.
        </p>
      </>
    ),
  },
  {
    q: '내 정보가 공개되나요?',
    a: (
      <>
        <p>
          화면에 보이는 것은 카카오 프로필 이름(닉네임) 하나입니다. 이메일이나 전화번호는 다른
          회원에게 보이지 않아요.
        </p>
        <p>
          어떤 정보를 받고 어떻게 다루는지는{' '}
          <Link href="/privacy" className={LINK}>
            개인정보처리방침
          </Link>
          에 적어 두었습니다.
        </p>
      </>
    ),
  },
]

export default function FaqPage() {
  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="pt-8 text-xl font-bold text-content-primary">자주 묻는 질문</h1>

        <p className="mt-4 leading-relaxed text-content-primary">
          처음 오신 분들이 많이 물어보시는 다섯 가지를 모았습니다.
        </p>

        {FAQS.map((faq) => (
          <section key={faq.q} className="mt-10">
            <h2 className="text-lg font-bold leading-relaxed text-content-primary">{faq.q}</h2>
            <div className="mt-3 flex flex-col gap-3 leading-relaxed text-content-primary">
              {faq.a}
            </div>
          </section>
        ))}
      </main>
    </PageShell>
  )
}
