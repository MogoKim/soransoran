import Header from '@/components/layouts/Header'
import IconMenu from '@/components/layouts/IconMenu'
import Footer from '@/components/layouts/Footer'
import FAB from '@/components/layouts/FAB'

/**
 * full = 헤더·게시판 메뉴 있음(기본) · minimal = 없음(관리자 등)
 *
 * 🔴 글쓰기 버튼은 화면이 스스로 밝힌다.
 *    버튼이 뜨는 곳은 홈과 게시판 목록뿐인데, 그 판정은 FAB 안에서
 *    현재 경로를 보고 내린다. 이 껍데기는 서버에서 그려지므로 경로를 모른다.
 *    그래서 예전에는 full 이기만 하면 아래 여백 72px 을 깔았고,
 *    버튼이 없는 화면(매거진·상세·약관 등 12곳)에서 그 자리가 그냥 비어 있었다.
 *
 *    경로를 여기서 다시 읽지 않는다 — 두 곳이 각자 판정하면 언젠가 어긋난다.
 *    버튼을 띄우는 화면이 showWriteFab 으로 말하고, 그 한 마디가
 *    여백 · 버튼 · 아래 영역 보호까지 함께 정한다.
 */
type PageShellProps = {
  children: React.ReactNode
  chrome?: 'full' | 'minimal'
  showWriteFab?: boolean
}

/** Header / 본문 / FAB / Footer 를 한 곳에서 조립한다. */
export default function PageShell({
  children,
  chrome = 'full',
  showWriteFab = false,
}: PageShellProps) {
  const isFull = chrome === 'full'
  const hasWriteFab = isFull && showWriteFab

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
          FAB 이 마지막 요소를 가리지 않도록 버튼이 뜨는 화면에만 하단 여백을 준다.
          넓은 화면에서는 글이 가운데로 모여 버튼이 그 옆 여백에 놓이므로 되돌린다. */}
      <div id="main-content" className={hasWriteFab ? 'pb-[72px] lg:pb-0' : undefined}>
        {children}
      </div>

      {hasWriteFab ? <FAB /> : null}

      {/* 이 여백은 위 <div> 밖이라 그 보호를 받지 못한다 — 아래 끝까지 내리면
          버튼이 마지막 줄 위에 그대로 떠 있었다. 그래서 따로 알린다. */}
      <Footer avoidFloatingAction={hasWriteFab} />
    </>
  )
}
