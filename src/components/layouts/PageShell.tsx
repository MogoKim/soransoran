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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-cta focus:px-4 focus:py-2 focus:font-bold focus:text-cta-text"
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
