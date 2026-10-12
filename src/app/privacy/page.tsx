import type { Metadata } from 'next'
import PageShell from '@/components/layouts/PageShell'
import { SITE } from '@/lib/brand'
import { CONTACT_EMAIL } from '@/lib/public-site-info'

export const metadata: Metadata = {
  title: '개인정보처리방침',
  description: `${SITE.name} 개인정보처리방침`,
  alternates: { canonical: '/privacy' },
}

/**
 * 🔴 항목·목적이 바뀌면 이 날짜도 함께 바꾼다. 실제 Production 배포일부터 시행하며 소급하지 않는다.
 *
 * 변경 공개 방식은 12항이 정한다 — 이 방침에 변경 내용과 시행일을 공개하고, 법령상 사전 고지가
 * 필요한 경우에는 그 법령이 정한 기간과 방법을 따른다.
 *
 * 🔴 광고 고지(5 · 7 · 9항)는 S-MON 정본(docs/operations/MONETIZATION-CANON.md) §7 을 따른다.
 *    이 방침을 배포했다고 광고가 켜지지 않는다. 광고 요청은 광고 gate(src/lib/ads/gate.ts)가 정한다.
 */
const EFFECTIVE_DATE = '2026년 10월 12일'

function Article({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-content-primary">{title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-content-primary">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="pt-8 text-xl font-bold text-content-primary">개인정보처리방침</h1>
        <p className="mt-2 text-sm text-content-muted">시행일: {EFFECTIVE_DATE}</p>

        <p className="mt-4 text-content-primary">
          {SITE.name}(이하 &ldquo;서비스&rdquo;)은 이용자의 개인정보를 중요하게 생각하며, 관련
          법령을 준수합니다. 이 방침은 서비스가 어떤 개인정보를 어떤 목적으로 처리하는지 알려드리기
          위한 것입니다.
        </p>

        <Article title="1. 개인정보의 처리 목적">
          <p>서비스는 다음 목적으로만 개인정보를 처리합니다.</p>
          <p>1. 회원 식별 및 로그인 유지</p>
          <p>2. 게시글·댓글 작성자 표시 및 본인 게시물 관리</p>
          <p>3. 신고 접수 및 처리, 부정 이용 방지</p>
          <p>4. 서비스 오류 확인 및 안정적인 운영</p>
          <p>5. 문의에 대한 회신</p>
          <p>6. 커뮤니티 가입 자격 확인 및 서비스 대상 연령대 확인</p>
          <p>7. 회원 본인 확인과 중복·부정 가입 방지</p>
          <p>8. 서비스 이용 현황 분석 및 품질 개선</p>
          <p>9. 광고 게재, 광고 빈도 관리, 광고 성과 집계 및 무효 트래픽 방지</p>
        </Article>

        <Article title="2. 처리하는 개인정보 항목">
          <p className="font-bold">가. 카카오 로그인 시 제공받는 정보</p>
          <p>
            아래 항목은 카카오 로그인 동의 화면에서 이용자가 동의한 범위에서 제공받습니다. 필수
            항목에 동의하지 않으시면 회원가입과 서비스 이용이 어렵습니다.
          </p>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-subtle py-2 pr-3 text-left font-bold text-content-primary">
                    항목
                  </th>
                  <th className="border-b border-subtle py-2 pr-3 text-left font-bold text-content-primary">
                    구분
                  </th>
                  <th className="border-b border-subtle py-2 text-left font-bold text-content-primary">
                    수집·이용 목적
                  </th>
                </tr>
              </thead>
              <tbody className="align-top text-content-primary">
                <tr>
                  <td className="border-b border-subtle py-2 pr-3">카카오 계정 식별자</td>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">필수</td>
                  <td className="border-b border-subtle py-2">회원 식별 및 로그인 유지</td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3">프로필 이름(닉네임)</td>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">필수</td>
                  <td className="border-b border-subtle py-2">
                    게시글·댓글 작성자 표시
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3">이메일</td>
                  <td className="border-b border-subtle py-2 pr-3">선택</td>
                  <td className="border-b border-subtle py-2">
                    계정 관련 안내 및 문의 회신. 카카오 계정에 이메일이 없거나 동의하지 않으신
                    경우에는 제공받지 않으며, 서비스 이용에 제한이 없습니다
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3">성별</td>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">필수</td>
                  <td className="border-b border-subtle py-2">
                    여성을 위한 커뮤니티라는 서비스 성격에 따른 가입 자격 확인
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3">출생연도</td>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">필수</td>
                  <td className="border-b border-subtle py-2">
                    서비스 대상 연령대 확인 및 커뮤니티 운영 기준 적용
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3">전화번호</td>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">필수</td>
                  <td className="border-b border-subtle py-2">
                    회원 본인 확인, 중복·부정 가입 방지, 신고·분쟁 처리 시 필요한 연락
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">프로필 이미지</td>
                  <td className="py-2 pr-3">선택</td>
                  <td className="py-2">
                    회원 프로필 표시. 동의하지 않으셔도 서비스 이용에 제한이 없습니다
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-sm text-content-muted">
            전화번호는 위에 적은 목적으로만 사용하며, 광고나 홍보 정보를 보내는 데 쓰지 않습니다.
            광고성 정보를 받아 보시려면 별도의 수신 동의가 필요하며, 서비스는 현재 그 동의를 받고
            있지 않습니다.
          </p>

          <p className="mt-2 font-bold">나. 서비스 이용 과정에서 생성·수집되는 정보</p>
          <p>· 이용자가 작성한 게시글, 댓글, 신고 내용</p>
          <p>· 접속 로그, IP 주소, 브라우저 정보(User-Agent), 접속 일시</p>
          <p>· 페이지 조회, 스크롤, 클릭 등 서비스 이용 통계</p>
          <p>· 서비스 이용 설정을 위한 쿠키 및 브라우저 저장 정보</p>
          <p>· 광고가 표시되는 경우 광고 표시·상호작용 정보와 광고용 쿠키 또는 유사 식별자(9항)</p>
          <p className="mt-2 text-sm text-content-muted">
            서비스는 주민등록번호, 계좌정보, 결제정보 등 민감한 정보를 수집하지 않습니다.
          </p>
        </Article>

        <Article title="3. 개인정보의 보유 및 이용 기간">
          <p>
            1. 회원의 계정 정보는 회원 탈퇴 시 지체 없이 파기하는 것을 원칙으로 합니다.
          </p>
          <p>
            2. 다만 관계 법령에 따라 보존이 필요한 경우 또는 분쟁 처리·부정 이용 방지를 위해 필요한
            경우, 해당 목적에 필요한 범위에서 일정 기간 보관할 수 있습니다.
          </p>
          <p>
            3. 성별, 출생연도, 전화번호는 회원 자격과 본인 확인을 위한 정보이므로 회원 자격이
            유지되는 동안 보관하며, 탈퇴 시 다른 계정 정보와 함께 파기합니다.
          </p>
          <p>
            4. 이용자가 작성한 게시글과 댓글의 처리 방식은 6항(개인정보의 파기 절차 및 방법)에서
            정한 바에 따릅니다.
          </p>
        </Article>

        <Article title="4. 개인정보의 제3자 제공">
          <p>
            서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 특별한 규정이
            있거나 수사기관이 적법한 절차에 따라 요청하는 경우에는 예외로 합니다.
          </p>
        </Article>

        <Article title="5. 개인정보 처리의 위탁">
          <p>서비스는 안정적인 운영을 위해 아래와 같이 개인정보 처리를 위탁하고 있습니다.</p>
          <p>· Vercel Inc. — 웹 서비스 호스팅 및 실행 로그</p>
          <p>· Supabase Inc. — 데이터베이스 및 회원 인증 데이터 저장</p>
          <p>· 주식회사 카카오 — 카카오 계정 로그인 인증</p>
          <p>· Google LLC (Google Analytics) — 서비스 이용 통계 분석 및 품질 개선</p>
          <p>
            · Google LLC (Google AdSense) — 비맞춤형·문맥 기반 광고 제공, 광고 빈도 관리, 광고 성과
            집계, 부정 이용 및 무효 트래픽 방지
          </p>
          <p className="mt-2 text-sm text-content-muted">
            위탁 업체가 변경되는 경우 이 방침을 통해 알려드립니다.
          </p>
        </Article>

        <Article title="6. 개인정보의 파기 절차 및 방법">
          <p>
            1. 서비스는 보유기간이 경과하거나 처리 목적이 달성된 경우, 회원이 탈퇴한 경우, 또는
            이용자가 삭제를 요청한 경우 해당 개인정보를 지체 없이 파기합니다.
          </p>
          <p>
            2. 전자적 파일 형태로 저장된 개인정보는 복구하거나 재생할 수 없는 방법으로 삭제합니다.
            출력물 등 그 밖의 기록물이 있는 경우 분쇄하거나 소각합니다.
          </p>
          <p>
            3. 관계 법령에 따라 보존해야 하거나 분쟁 대응을 위해 보관이 필요한 정보는, 다른
            개인정보와 분리하여 저장하거나 접근 권한을 제한한 상태로 해당 기간 동안만 보관한 뒤
            파기합니다.
          </p>
          <p>
            4. 이용자가 작성한 게시글과 댓글은 커뮤니티의 대화 맥락이 유지되어야 하므로 탈퇴 후에도
            서비스에 남을 수 있습니다. 이 경우 작성자를 식별할 수 있는 정보는 익명 또는 일반 회원
            표기로 대체됩니다. 게시물 자체의 삭제를 원하는 경우 탈퇴 전에 직접 삭제하거나{' '}
            {CONTACT_EMAIL} 으로 요청해 주시기 바랍니다.
          </p>
        </Article>

        <Article title="7. 개인정보의 국외 이전">
          <p>
            서비스는 해외 사업자의 클라우드 인프라를 이용하고 있으며, 이에 따라 개인정보가 국외로
            이전됩니다. 이전 내역은 다음과 같습니다.
          </p>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-subtle py-2 text-left font-bold text-content-primary">
                    구분
                  </th>
                  <th className="border-b border-subtle py-2 text-left font-bold text-content-primary">
                    Vercel Inc.
                  </th>
                  <th className="border-b border-subtle py-2 text-left font-bold text-content-primary">
                    Supabase Inc.
                  </th>
                  <th className="border-b border-subtle py-2 text-left font-bold text-content-primary">
                    Google LLC (Google Analytics)
                  </th>
                  <th className="border-b border-subtle py-2 text-left font-bold text-content-primary">
                    Google LLC (Google AdSense)
                  </th>
                </tr>
              </thead>
              <tbody className="align-top text-content-primary">
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">이전받는 자</td>
                  <td className="border-b border-subtle py-2 pr-3">Vercel Inc.</td>
                  <td className="border-b border-subtle py-2 pr-3">Supabase Inc.</td>
                  <td className="border-b border-subtle py-2 pr-3">Google LLC</td>
                  <td className="border-b border-subtle py-2">Google LLC</td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">이전 국가</td>
                  <td className="border-b border-subtle py-2 pr-3">
                    미국 등 해당 사업자가 인프라를 운영하는 국가
                  </td>
                  <td className="border-b border-subtle py-2 pr-3">
                    미국 등 해당 사업자가 인프라를 운영하는 국가
                  </td>
                  <td className="border-b border-subtle py-2 pr-3">
                    미국 등 해당 사업자가 서비스를 운영하는 국가
                  </td>
                  <td className="border-b border-subtle py-2">
                    미국 등 해당 사업자가 서비스를 운영하는 국가
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">이전 항목</td>
                  <td className="border-b border-subtle py-2 pr-3">
                    접속 로그, IP 주소, 브라우저 정보(User-Agent), 요청 처리 과정에서 전달되는
                    게시글·댓글·신고 내용
                  </td>
                  <td className="border-b border-subtle py-2 pr-3">
                    카카오 계정 식별자, 이름(닉네임), 이메일(제공되는 경우), 성별, 출생연도,
                    전화번호, 프로필 이미지(동의한 경우), 게시글, 댓글, 신고 내용
                  </td>
                  <td className="border-b border-subtle py-2 pr-3">
                    접속 로그, IP 주소, 브라우저 정보(User-Agent), 접속 일시, 페이지 조회와
                    사이트 이용 이벤트
                  </td>
                  <td className="border-b border-subtle py-2">
                    IP 주소, 브라우저·기기 정보, 접속 일시, 방문 페이지 URL, 광고 표시·상호작용
                    정보, 쿠키 또는 유사 식별자
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">이전 목적</td>
                  <td className="border-b border-subtle py-2 pr-3">
                    웹 서비스 호스팅 및 실행, 장애 대응
                  </td>
                  <td className="border-b border-subtle py-2 pr-3">
                    데이터베이스 저장, 회원 인증·세션 처리, 장애 대응
                  </td>
                  <td className="border-b border-subtle py-2 pr-3">
                    서비스 이용 통계 분석 및 품질 개선
                  </td>
                  <td className="border-b border-subtle py-2">
                    비맞춤형·문맥 기반 광고 제공, 광고 빈도 관리, 광고 성과 집계, 부정 이용 및
                    무효 트래픽 방지
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">이전 시점 및 방법</td>
                  <td className="border-b border-subtle py-2 pr-3" colSpan={4}>
                    이용자가 서비스를 이용하는 시점에, 정보통신망을 통해 각 사업자의 서버로 전송되는
                    방식으로 이전됩니다. Google AdSense 는 광고가 표시되는 페이지를 이용하는 시점에
                    이용자의 브라우저에서 Google 의 서버로 직접 전송됩니다.
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-bold">보유 및 이용 기간</td>
                  <td className="py-2" colSpan={4}>
                    회원 탈퇴 또는 처리 목적 달성 시까지. Google Analytics 이용 통계는 Google
                    Analytics 데이터 보관 설정에 따르고, Google AdSense 관련 정보는 Google 의
                    개인정보처리방침과 광고 관련 정책(policies.google.com/technologies/ads)에서 정한
                    기간에 따릅니다. 다만 관계 법령에 따른 보존 의무가 있거나 분쟁 대응을 위해 필요한
                    경우 해당 기간 동안 보관합니다.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3">
            이용자는 개인정보의 국외 이전을 거부할 수 있습니다. Vercel Inc.와 Supabase Inc.로의 이전은
            서비스 제공에 필수적인 처리이므로, 거부하는 경우 회원가입 및 서비스 이용이 제한될 수
            있습니다. 거부 의사는 {CONTACT_EMAIL} 으로 알려주시기 바랍니다.
          </p>
          <p>
            Google Analytics 관련 쿠키 사용은 브라우저의 쿠키·개인정보 설정을 통해 제한할 수
            있습니다. Google AdSense 관련 처리는 브라우저 쿠키 설정, Google 광고 설정 및 적용 지역의
            Google 동의 관리 화면에서 관리할 수 있습니다(9항). 이러한 설정을 하더라도 글 읽기와
            커뮤니티 이용 등 기본 서비스는 그대로 이용할 수 있으며, 이용 통계의 정확도나 광고 표시
            방식·빈도가 달라질 수 있습니다.
          </p>
        </Article>

        <Article title="8. 정보주체의 권리와 행사 방법">
          <p>이용자는 언제든지 다음 권리를 행사할 수 있습니다.</p>
          <p>1. 개인정보 열람 요구</p>
          <p>2. 오류가 있는 경우 정정 요구</p>
          <p>3. 삭제 요구</p>
          <p>4. 처리정지 요구</p>
          <p>5. 동의 철회 및 회원 탈퇴</p>
          <p className="mt-2">
            권리 행사는 {CONTACT_EMAIL} 으로 요청하실 수 있으며, 서비스는 지체 없이 확인 후 조치합니다.
            본인 확인이 필요한 경우 추가 확인을 요청할 수 있습니다.
          </p>
        </Article>

        <Article title="9. 쿠키 등 자동 수집 장치의 사용">
          <p>
            1. 서비스는 로그인 상태 유지와 화면 설정(글자 크기 등)을 위해 쿠키 및 브라우저 저장소를
            사용합니다.
          </p>
          <p>
            2. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있습니다. 다만 이 경우 로그인 등
            일부 기능의 이용이 제한될 수 있습니다.
          </p>
          <p>
            3. 서비스는 이용 현황 분석과 품질 개선을 위해 Google Analytics 를 사용할 수 있으며,
            이 과정에서 쿠키 등 자동 수집 장치가 사용될 수 있습니다.
          </p>
          <p>
            4. 서비스는 광고 게재를 위해 Google AdSense 를 사용할 수 있습니다. 광고가 표시되는
            페이지에서는 Google 등 제3자 광고 사업자가 쿠키 또는 유사 기술을 사용해 광고를 제공할 수
            있습니다.
          </p>
          <p>
            5. 서비스는 최초 광고 운영에서 모든 지역에 비맞춤형 광고를 우선 요청합니다. 비맞춤형
            광고는 이용자의 과거 방문 기록에 따라 광고를 고르지 않고, 지금 보고 있는 페이지의 내용과
            대략적인 위치 등을 바탕으로 광고를 고릅니다. 다만 비맞춤형 광고도 광고 빈도 관리, 광고 성과
            집계, 부정 이용 및 무효 트래픽 방지를 위해 쿠키 또는 유사 기술을 사용할 수 있습니다.
            맞춤형 광고를 사용하게 되는 경우에는 이 방침을 개정해 알립니다.
          </p>
          <p>
            6. 유럽경제지역(EEA)·영국·스위스에서 접속하는 이용자에게는 Google 이 제공하는 인증된
            동의 관리 도구(CMP)를 통해 광고 관련 쿠키 사용에 대한 선택을 요청하며, 이용자는 그 화면에서
            선택하거나 바꿀 수 있습니다.
          </p>

          <p className="mt-2 font-bold">가. 광고 관련 행태정보의 처리</p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <tbody className="align-top text-content-primary">
                <tr>
                  <td className="w-28 border-b border-subtle py-2 pr-3 font-bold">수집·처리 주체</td>
                  <td className="border-b border-subtle py-2">
                    Google LLC (Google AdSense). 서비스는 광고 표시를 위해 Google 이 이용자의 브라우저에서
                    정보를 수집하도록 허용합니다.
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">항목</td>
                  <td className="border-b border-subtle py-2">
                    방문 페이지 URL, 광고 표시·클릭 등 광고 상호작용 정보, 접속 일시, IP 주소,
                    브라우저·기기 정보, 쿠키 또는 유사 식별자
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">수집 방법</td>
                  <td className="border-b border-subtle py-2">
                    광고가 표시되는 페이지를 이용할 때 Google 광고 스크립트와 쿠키 또는 유사 기술을 통해
                    자동으로 수집됩니다.
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">이용 목적</td>
                  <td className="border-b border-subtle py-2">
                    비맞춤형·문맥 기반 광고 제공, 광고 빈도 관리, 광고 성과 집계, 부정 이용 및 무효
                    트래픽 방지
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">보유·처리 기준</td>
                  <td className="border-b border-subtle py-2">
                    Google 의 개인정보처리방침과 광고 관련 정책(policies.google.com/technologies/ads)에서
                    정한 기간과 기준에 따릅니다. Google 이 파트너 사이트에서 얻은 정보를 사용하는 방식은
                    policies.google.com/technologies/partner-sites 에서 확인할 수 있습니다.
                  </td>
                </tr>
                <tr>
                  <td className="border-b border-subtle py-2 pr-3 font-bold">거부 방법</td>
                  <td className="border-b border-subtle py-2">
                    · 브라우저 설정의 쿠키·개인정보 메뉴에서 쿠키 저장을 차단하거나 저장된 쿠키를 삭제할 수
                    있습니다.
                    <br />· Google 광고 설정(myadcenter.google.com)에서 광고 개인 최적화를 관리할 수
                    있습니다.
                    <br />· 유럽경제지역(EEA)·영국·스위스 이용자는 Google 동의 관리 화면에서 선택을 바꿀
                    수 있습니다.
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-bold">거부 시 영향</td>
                  <td className="py-2">
                    글 읽기와 커뮤니티 이용 등 기본 서비스는 그대로 이용할 수 있습니다. 광고 표시 방식이나
                    빈도가 달라질 수 있습니다.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Article>

        <Article title="10. 개인정보의 안전성 확보 조치">
          <p>1. 개인정보에 접근할 수 있는 인원을 운영에 필요한 최소한으로 제한합니다.</p>
          <p>2. 서비스 구간은 HTTPS 로 암호화하여 전송합니다.</p>
          <p>3. 데이터베이스는 접근 권한이 통제된 환경에서 운영합니다.</p>
          <p>
            4. 도배·스팸 등 부정 이용을 막기 위해 게시 횟수 제한 등 기술적 조치를 적용하고 있습니다.
          </p>
        </Article>

        <Article title="11. 개인정보 보호책임자">
          <p>
            서비스는 개인정보 처리에 관한 업무를 총괄하고 이용자의 문의를 처리하기 위해 아래와 같이
            책임자를 지정하고 있습니다.
          </p>
          <p>· 담당: {SITE.name} 운영팀</p>
          <p>· 연락처: {CONTACT_EMAIL}</p>
          <p className="mt-2 text-sm text-content-muted">
            개인정보 침해에 대한 신고나 상담이 필요한 경우 개인정보침해신고센터(privacy.kisa.or.kr,
            국번 없이 118), 개인정보 분쟁조정위원회(kopico.go.kr, 1833-6972)에 문의하실 수 있습니다.
          </p>
        </Article>

        <Article title="12. 개인정보처리방침의 변경">
          <p>
            방침이 변경되는 경우 변경 내용과 시행일을 이 방침을 통해 공개합니다. 법령상 사전 고지가
            필요한 경우에는 해당 법령에서 정한 기간과 방법에 따라 안내합니다.
          </p>
        </Article>

        <p className="mt-10 text-sm text-content-muted">
          이 개인정보처리방침은 {EFFECTIVE_DATE}부터 시행합니다.
        </p>
      </main>
    </PageShell>
  )
}
