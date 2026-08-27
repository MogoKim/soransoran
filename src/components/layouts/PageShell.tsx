import Header from '@/components/layouts/Header'
import IconMenu from '@/components/layouts/IconMenu'
import Footer from '@/components/layouts/Footer'
import FAB from '@/components/layouts/FAB'

/** full = FAB 노출(기본) · minimal = FAB 없음(관리자·로그인 등) */
type PageShellProps = {
  children: React.ReactNode
  chrome?: 'full' | 'minimal'
}

/** Header / 본문 / FAB / Footer 를 한 곳에서 조립한다. */
export default function PageShell({ children, chrome = 'full' }: PageShellProps) {
  const isFull = chrome === 'full'

  return (
    <>
      {/* 건너뛰기 링크 (WCAG 2.4.1 Bypass Blocks) — 지우지 않는다.
          헤더와 게시판 메뉴를 매번 지나치지 않고 본문으로 바로 갈 수 있는 유일한 경로다.

          🔴 노출 조건은 focus 가 아니라 focus-visible 이다.
             Next.js App Router 는 클라이언트 라우팅이 끝나면 접근성 목적으로
             문서의 첫 포커서블 요소에 **프로그래밍 방식 포커스**를 준다.
             그 요소가 바로 이 링크라, 마우스로 메뉴를 누를 때마다 :focus 가 참이 되어
             좌측 상단에 버튼이 튀어나왔다. 포커스가 남아 있으니 스크롤해도 사라지지 않았다.

             실측(2026-08-27, 로컬 프로덕션 빌드):
               로드 직후          :focus false / :focus-visible false → 숨김
               마우스 클릭 라우팅 후 :focus TRUE  / :focus-visible false → 노출(폭 161px)
               Tab               :focus TRUE  / :focus-visible TRUE  → 노출

             focus-visible 은 "키보드로 도달했는가"를 브라우저가 판정한다.
             프로그래밍 포커스에서는 거짓이고 Tab·Shift+Tab 에서는 참이므로,
             마우스 경로만 정확히 걸러지고 키보드 경로는 그대로 남는다. */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-2 focus-visible:top-2 focus-visible:z-[60] focus-visible:rounded-lg focus-visible:bg-cta-edge focus-visible:px-4 focus-visible:py-2 focus-visible:font-bold focus-visible:text-cta-text"
      >
        본문으로 건너뛰기
      </a>

      <Header />
      {isFull ? <IconMenu /> : null}

      {/* 페이지가 각자 <main> 을 가지므로 여기서는 래퍼만 둔다.
          FAB 이 마지막 요소를 가리지 않도록 full 일 때만 하단 여백을 준다. */}
      <div id="main-content" className={isFull ? 'pb-[72px] lg:pb-0' : undefined}>
        {children}
      </div>

      {isFull ? <FAB /> : null}

      <Footer />
    </>
  )
}
