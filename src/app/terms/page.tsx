import type { Metadata } from 'next'
import PageShell from '@/components/layouts/PageShell'
import { SITE } from '@/lib/brand'

export const metadata: Metadata = {
  title: '이용약관',
  description: '소란소란 이용약관',
  alternates: { canonical: '/terms' },
}

const EFFECTIVE_DATE = '2026년 8월 22일'
const CONTACT = 'soransoran.community@gmail.com'

function Article({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-content-primary">{title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-content-primary">{children}</div>
    </section>
  )
}

export default function TermsPage() {
  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="pt-8 text-xl font-bold text-content-primary">이용약관</h1>
        <p className="mt-2 text-sm text-content-muted">시행일: {EFFECTIVE_DATE}</p>

        <Article title="제1조 (목적)">
          <p>
            이 약관은 {SITE.name}(이하 &ldquo;서비스&rdquo;)이 제공하는 인터넷 커뮤니티 서비스의
            이용조건과 절차, 회원과 서비스의 권리·의무 및 책임사항을 정하는 것을 목적으로 합니다.
          </p>
        </Article>

        <Article title="제2조 (용어의 정의)">
          <p>1. &ldquo;서비스&rdquo;란 {SITE.name}이 웹을 통해 제공하는 커뮤니티 서비스를 말합니다.</p>
          <p>
            2. &ldquo;회원&rdquo;이란 카카오 계정으로 로그인하여 서비스를 이용하는 사람을 말합니다.
          </p>
          <p>
            3. &ldquo;게시물&rdquo;이란 회원이 서비스에 올린 글, 댓글, 그 밖의 정보를 말합니다.
          </p>
          <p>4. &ldquo;운영자&rdquo;란 서비스를 관리·운영하는 자를 말합니다.</p>
        </Article>

        <Article title="제3조 (약관의 게시와 변경)">
          <p>1. 이 약관은 서비스 내 화면에 게시하여 회원이 언제든지 확인할 수 있도록 합니다.</p>
          <p>
            2. 운영자는 관련 법령을 위반하지 않는 범위에서 이 약관을 변경할 수 있으며, 변경 시
            적용일과 변경 내용을 서비스 내에 공지합니다.
          </p>
          <p>
            3. 회원이 변경된 약관에 동의하지 않는 경우 이용을 중단하고 탈퇴할 수 있습니다. 변경
            공지 후에도 서비스를 계속 이용하는 경우 변경에 동의한 것으로 봅니다.
          </p>
        </Article>

        <Article title="제4조 (서비스의 내용)">
          <p>서비스는 40대·50대 여성을 중심으로 한 커뮤니티이며, 다음 기능을 제공합니다.</p>
          <p>1. 게시판(갱년기톡, 자유게시판)에서의 글 작성 및 열람</p>
          <p>2. 게시물에 대한 댓글 작성 및 열람</p>
          <p>3. 게시물·댓글에 대한 신고</p>
          <p>4. 카카오 계정을 이용한 로그인</p>
          <p>
            5. 매거진 등 운영자가 제공하는 읽기 전용 콘텐츠 영역(제공 여부와 범위는 달라질 수
            있습니다)
          </p>
        </Article>

        <Article title="제5조 (회원가입 및 계정)">
          <p>
            1. 회원가입은 카카오 계정을 이용한 로그인으로 이루어지며, 별도의 아이디·비밀번호를
            생성하지 않습니다.
          </p>
          <p>
            2. 회원은 자신의 계정을 제3자에게 이용하게 해서는 안 되며, 계정 관리 책임은 회원에게
            있습니다.
          </p>
          <p>
            3. 운영자는 다른 사람의 명의를 이용하거나, 이 약관을 위반한 이력이 있는 경우 이용을
            제한할 수 있습니다.
          </p>
        </Article>

        <Article title="제6조 (회원의 의무)">
          <p>1. 회원은 관련 법령과 이 약관, 서비스 내 공지사항을 준수해야 합니다.</p>
          <p>2. 회원은 서비스의 정상적인 운영을 방해하는 행위를 해서는 안 됩니다.</p>
          <p>
            3. 회원은 다른 회원의 개인정보를 수집·저장·공개하거나 서비스 밖으로 유도하는 행위를
            해서는 안 됩니다.
          </p>
        </Article>

        <Article title="제7조 (금지 행위)">
          <p>회원은 다음 행위를 해서는 안 됩니다.</p>
          <p>1. 욕설, 비방, 차별·혐오 표현</p>
          <p>2. 타인의 개인정보(이름, 연락처, 주소 등) 무단 게시</p>
          <p>3. 광고, 홍보, 스팸, 도배, 반복 게시</p>
          <p>4. 불법 정보의 게시 또는 불법 행위의 권유</p>
          <p>5. 타인의 저작권 등 권리를 침해하는 게시물 등록</p>
          <p>
            6. 자동화된 수단을 이용한 대량 등록·수집 등 서비스 운영을 방해하는 행위
          </p>
          <p>7. 그 밖에 관련 법령 또는 이 약관에 위반되는 행위</p>
        </Article>

        <Article title="제8조 (게시물의 관리)">
          <p>
            1. 게시물의 내용에 대한 권리와 책임은 이를 작성한 회원에게 있습니다. 운영자는 회원이
            작성한 게시물의 내용을 보증하지 않습니다.
          </p>
          <p>
            2. 게시물이 제7조에 해당하거나 관련 법령을 위반하는 경우, 운영자는 해당 게시물을
            숨기거나 삭제할 수 있고 작성자의 이용을 제한할 수 있습니다.
          </p>
          <p>
            3. 운영자는 서비스의 운영·개선을 위해 필요한 범위에서 게시물을 서비스 내에 노출·배치할
            수 있습니다.
          </p>
        </Article>

        <Article title="제9조 (신고 및 운영 조치)">
          <p>
            1. 회원은 다른 회원의 게시물이 제7조에 해당한다고 판단되는 경우 서비스 내 신고 기능을
            이용해 신고할 수 있습니다.
          </p>
          <p>
            2. 신고는 접수 후 운영자가 확인하며, 확인 결과에 따라 게시물 숨김·삭제, 이용 제한 등의
            조치를 할 수 있습니다. 신고가 곧바로 자동 조치로 이어지지는 않습니다.
          </p>
          <p>3. 허위 신고나 신고 기능의 남용은 이용 제한 사유가 될 수 있습니다.</p>
        </Article>

        <Article title="제10조 (서비스의 중단·변경)">
          <p>
            1. 운영자는 서비스의 전부 또는 일부를 변경하거나 중단할 수 있으며, 이 경우 사전에
            공지합니다. 다만 시스템 장애 등 부득이한 사유가 있는 경우 사후에 공지할 수 있습니다.
          </p>
          <p>
            2. 서비스 점검, 설비 교체, 통신 장애 등의 사유로 서비스 제공이 일시 중지될 수 있습니다.
          </p>
        </Article>

        <Article title="제11조 (탈퇴 및 게시물의 처리)">
          <p>1. 회원은 언제든지 탈퇴를 요청할 수 있습니다.</p>
          <p>
            2. 탈퇴하더라도 회원이 이미 작성한 게시물은 다른 회원의 이용을 위해 서비스에 남을 수
            있습니다. 이 경우 작성자 표시는 익명 또는 일반 회원 표기로 대체될 수 있습니다.
          </p>
          <p>
            3. 게시물의 삭제를 원하는 경우 탈퇴 전에 직접 삭제하거나 {CONTACT} 으로 요청할 수
            있습니다.
          </p>
        </Article>

        <Article title="제12조 (면책)">
          <p>
            1. 서비스에 게시된 내용은 회원들의 경험과 의견이며, <strong>의료·법률·금융에 관한
            전문적인 조언이 아닙니다.</strong> 건강, 법률, 금융 문제는 반드시 해당 분야의 전문가와
            상담하시기 바랍니다.
          </p>
          <p>
            2. 운영자는 회원 간 또는 회원과 제3자 간에 게시물을 매개로 발생한 분쟁에 대해 개입할
            의무가 없으며, 그로 인한 손해에 대해 책임을 지지 않습니다.
          </p>
          <p>
            3. 천재지변, 통신 장애 등 운영자의 합리적인 통제를 벗어난 사유로 서비스를 제공할 수 없는
            경우 그 책임이 면제됩니다.
          </p>
        </Article>

        <Article title="제13조 (분쟁의 해결)">
          <p>
            1. 서비스 이용과 관련해 분쟁이 발생한 경우, 운영자와 회원은 원만한 해결을 위해 성실히
            협의합니다.
          </p>
          <p>
            2. 협의가 이루어지지 않는 경우 관련 법령 및 상관례에 따르며, 소송이 필요한 경우 민사소송법에
            따른 관할 법원에 제기합니다.
          </p>
        </Article>

        <Article title="제14조 (문의처)">
          <p>서비스 이용과 관련한 문의는 아래로 보내주시기 바랍니다.</p>
          <p>{SITE.name} 운영팀 · {CONTACT}</p>
        </Article>

        <p className="mt-10 text-sm text-content-muted">
          이 약관은 {EFFECTIVE_DATE}부터 시행합니다.
        </p>
      </main>
    </PageShell>
  )
}
