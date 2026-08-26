import type { Metadata } from 'next'
import PageShell from '@/components/layouts/PageShell'
import { SITE } from '@/lib/brand'

export const metadata: Metadata = {
  title: '커뮤니티 규칙',
  description: '소란소란에서 편하게 이야기하기 위한 몇 가지 약속',
  alternates: { canonical: '/rules' },
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

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden>·</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export default function RulesPage() {
  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="pt-8 text-xl font-bold text-content-primary">커뮤니티 규칙</h1>

        <p className="mt-4 leading-relaxed text-content-primary">
          {SITE.name}은 비슷한 시기를 지나는 또래끼리 이야기를 나누는 곳입니다. 잘 쓴 글이 아니어도
          괜찮아요. 아래 몇 가지만 지켜주시면 누구나 편하게 이야기를 꺼낼 수 있습니다.
        </p>

        <Section title="이런 이야기, 편하게 써주세요">
          <List
            items={[
              '요즘 몸이 예전 같지 않다는 이야기',
              '남편, 아이, 부모님과 지내며 생긴 마음',
              '일과 돈, 앞으로의 계획에 대한 고민',
              '오늘 있었던 사소한 일, 혼자 웃은 순간',
              '누군가에겐 별것 아니어도 나에겐 오래 담아둔 이야기',
            ]}
          />
          <p>정리되지 않은 글도 괜찮습니다. 여기서는 결론을 내지 않아도 돼요.</p>
        </Section>

        <Section title="서로를 판단하지 않아요">
          <p>같은 나이를 지나도 살아온 모습은 저마다 다릅니다.</p>
          <List
            items={[
              '나와 다른 선택을 한 사람에게 옳고 그름을 말하지 않아요',
              '“그 나이에”, “그러니까 그렇지” 같은 말은 하지 않아요',
              '조언은 물어봤을 때만, 그것도 내 경험으로 전해요',
            ]}
          />
          <p>읽다가 마음이 불편하면 댓글을 달지 않고 지나가셔도 괜찮습니다.</p>
        </Section>

        <Section title="건강과 돈 이야기는 내 경험으로">
          <List
            items={[
              '“나는 이렇게 해봤어요”는 언제든 좋습니다',
              '“이거 먹으면 낫는다”, “여기 넣으면 된다” 같은 단정은 삼가주세요',
              '특정 병원, 약, 상품을 정답처럼 권하지 않아요',
            ]}
          />
          <p>
            몸과 돈에 관한 결정은 사람마다 다릅니다. 이곳의 글은 회원들의 경험이지 진단이나 상담이
            아니에요. 중요한 결정은 꼭 전문가와 상의해 주세요.
          </p>
        </Section>

        <Section title="나와 다른 사람의 정보는 지켜요">
          <List
            items={[
              '실명, 전화번호, 주소, 직장 이름은 쓰지 않는 편이 안전해요',
              '다른 사람 이야기를 옮길 때는 알아볼 수 있는 부분을 지워주세요',
              '댓글로 연락처를 주고받거나 다른 곳으로 부르지 않아요',
              '올리는 사진에 얼굴이나 주소가 담기지 않았는지 한 번 봐주세요',
            ]}
          />
        </Section>

        <Section title="광고와 도배는 받지 않아요">
          <List
            items={[
              '물건이나 서비스를 팔거나 가입을 권하는 글',
              '같은 내용을 여러 게시판에 반복해 올리는 글',
              '대화 없이 링크나 홍보만 남기는 댓글',
            ]}
          />
        </Section>

        <Section title="이런 글은 가려지거나 지워질 수 있어요">
          <List
            items={[
              '욕설, 비방, 특정 집단을 깎아내리는 말',
              '다른 사람의 개인정보가 담긴 글',
              '광고, 도배, 같은 글 반복',
              '법에 어긋나는 내용',
            ]}
          />
          <p>
            불편한 글을 보시면 글과 댓글에 있는 신고 기능을 눌러주세요. 운영자가 직접 확인한 뒤
            조치합니다. 신고했다고 해서 글이 곧바로 사라지지는 않아요.
          </p>
          <p>내 글이 가려진 것이 억울하시다면 아래로 알려주세요. 다시 살펴보겠습니다.</p>
        </Section>

        <Section title="그래도 가장 중요한 건">
          <p>
            규칙을 다 외우지 않으셔도 됩니다. “내가 이 말을 들었다면 어떨까”만 한 번 생각해 주시면
            충분해요.
          </p>
          <p>
            궁금한 점이나 불편한 일이 있으면 언제든 알려주세요. {SITE.name} 운영팀 · {CONTACT}
          </p>
        </Section>
      </main>
    </PageShell>
  )
}
