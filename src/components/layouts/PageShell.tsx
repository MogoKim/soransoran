import Header from '@/components/layouts/Header'
import IconMenu from '@/components/layouts/IconMenu'
import Footer from '@/components/layouts/Footer'
import FAB from '@/components/layouts/FAB'

/**
 * full = 헤더·게시판 메뉴 있음(기본) · minimal = 없음(관리자 등)
 *
 * showWriteFab 은 FAB 렌더 · 본문 아래 여백 · footer 보호를 함께 정한다.
 * 렌더된 FAB 은 그 뒤 현재 경로에 맞는 글쓰기 주소를 확인한다.
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
      <Header />
      {isFull ? <IconMenu /> : null}

      {/* 페이지가 각자 <main> 을 가지므로 여기서는 래퍼만 둔다.
          FAB 이 마지막 요소를 가리지 않게 비우고, 넓은 화면은 버튼이 글 옆에 놓여 되돌린다. */}
      <div className={hasWriteFab ? 'pb-[72px] lg:pb-0' : undefined}>
        {children}
      </div>

      {hasWriteFab ? <FAB /> : null}

      {/* footer 는 위 <div> 밖이라 그 여백이 닿지 않는다. 그래서 따로 알린다. */}
      <Footer avoidFloatingAction={hasWriteFab} />
    </>
  )
}
