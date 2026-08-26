import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'

export const metadata: Metadata = {
  title: '문의',
  description: '소란소란 운영팀에 불편한 일이나 궁금한 점을 알리는 방법',
  alternates: { canonical: '/contact' },
}

const CONTACT = 'soransoran.community@gmail.com'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold leading-relaxed text-content-primary">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 leading-relaxed text-content-primary">{children}</div>
    </section>
  )
}

export default function ContactPage() {
  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="pt-8 text-xl font-bold text-content-primary">문의</h1>

        <p className="mt-4 leading-relaxed text-content-primary">
          이용하시다 불편한 일이 있거나 궁금한 점이 생기면 아래 메일로 알려주세요.
        </p>

        <a
          href={`mailto:${CONTACT}`}
          className="mt-3 inline-flex min-h-[52px] items-center break-all text-link underline underline-offset-2"
        >
          {CONTACT}
        </a>

        <Section title="이렇게 적어주시면 빠릅니다">
          <ul className="flex flex-col gap-2">
            <li className="flex gap-2">
              <span aria-hidden>·</span>
              <span>어떤 일이 있었는지</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>·</span>
              <span>문제가 된 글이나 댓글의 주소</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>·</span>
              <span>답장 받으실 이메일 주소</span>
            </li>
          </ul>
          <p>메일 제목이나 형식은 자유롭게 쓰셔도 됩니다.</p>
        </Section>

        <Section title="답장에 대해">
          <p>
            받은 메일은 운영팀이 하나씩 확인합니다. 다만 사람이 직접 읽고 답하다 보니 며칠 걸릴 수
            있고, 모든 문의에 답장을 드리지 못할 때도 있습니다.
          </p>
        </Section>

        <Section title="글이나 댓글을 신고하실 때는">
          <p>
            불편한 글과 댓글은 화면 안의 신고 기능이 더 빠릅니다. 어떤 글이 가려질 수 있는지는{' '}
            <Link href="/rules" className="text-link underline underline-offset-2">
              커뮤니티 규칙
            </Link>
            에 적어 두었습니다.
          </p>
        </Section>
      </main>
    </PageShell>
  )
}
