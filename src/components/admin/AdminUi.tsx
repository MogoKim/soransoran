import Link from 'next/link'

/**
 * 어드민 공통 조각 — 실제로 중복된 것만 모은다.
 *
 * 🔴 컴포넌트를 새로 만드는 것이 목적이 아니다. 7 개 화면이 헤더·섹션·배지·빈 상태를
 *    각자 적고 있어서 한 곳을 고쳐도 나머지가 따라오지 않았다. 그것만 없앤다.
 *
 * 🔴 서버 컴포넌트로 둔다. 상태를 갖지 않으므로 'use client' 가 필요 없다 —
 *    조치 버튼(AdminActionButton 등)만 클라이언트다.
 *
 * 🔴 카드 안에 카드를 넣지 않는다. AdminCard 는 목록의 한 줄에만 쓰고,
 *    그 안에서는 배경만 다른 인용 블록(AdminQuote)을 쓴다.
 */

/**
 * 화면 맨 위 — 어디에 있고 무엇을 하는 곳인지.
 *
 * 상세 화면은 backHref 를 준다. 뒤로 가는 길이 없으면 브라우저 뒤로가기에 기대게 되는데,
 * 조치 후 refresh 된 화면에서는 그것이 엉뚱한 곳으로 간다.
 */
export function AdminPageHeader({
  title,
  description,
  backHref,
  backLabel = '← 목록으로',
  badges,
}: {
  title: string
  description?: string
  backHref?: string
  backLabel?: string
  badges?: React.ReactNode
}) {
  return (
    <header className={backHref ? '' : 'pt-1'}>
      {backHref ? (
        <Link href={backHref} className="inline-flex min-h-[44px] items-center text-sm text-link">
          {backLabel}
        </Link>
      ) : null}
      <h1 className="m-0 break-words text-xl font-bold text-content-primary">{title}</h1>
      {badges ? <div className="mt-1 flex flex-wrap items-center gap-2">{badges}</div> : null}
      {description ? <p className="m-0 mt-1 text-sm text-content-muted">{description}</p> : null}
    </header>
  )
}

/** 화면 안의 한 덩어리. 제목과 부연을 같은 간격으로 붙인다. */
export function AdminSection({
  title,
  description,
  children,
  className = 'mt-6',
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  // 제목·부연·본문 사이 리듬을 /admin/home 과 같게 둔다
  return (
    <section className={className}>
      <h2 className="m-0 text-base font-bold text-content-primary">{title}</h2>
      {description ? <p className="m-0 mt-1 text-sm text-content-muted">{description}</p> : null}
      {children}
    </section>
  )
}

/**
 * 비어 있을 때.
 *
 * 🔴 "없습니다" 로 끝내지 않는다. 비어 있는 것이 정상인지 아닌지를 함께 적는다 —
 *    운영자가 "내가 못 찾은 건가" 를 의심하며 화면을 다시 뒤지게 된다.
 */
export function AdminEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 rounded-lg border border-dashed border-subtle px-3 py-4 text-sm text-content-muted">
      {children}
    </p>
  )
}

type BadgeTone = 'neutral' | 'warning' | 'danger' | 'success' | 'brand'

/**
 * 상태 한 조각.
 *
 * 🔴 기본은 뉴트럴이다. 예전에는 모든 배지가 코랄 바탕(--surface-soft)이라
 *    화면이 온통 분홍이었고 "정말 위험한 것" 이 묻혔다.
 *    운영 콘솔의 --surface-soft 는 회색으로 바뀌어 있다(globals.css .admin-shell).
 *
 * 🔴 brand 는 아껴 쓴다 — 신고 사유처럼 "이 카드가 왜 여기 있는가" 한 조각에만.
 */
export function AdminBadge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone
  children: React.ReactNode
}) {
  const skin =
    tone === 'danger'
      ? 'bg-surface-soft font-bold text-state-danger'
      : tone === 'warning'
        ? 'bg-surface-soft font-bold text-state-warning'
        : tone === 'success'
          ? 'bg-surface-soft font-bold text-state-success'
          : tone === 'brand'
            ? 'bg-brand-soft font-bold text-brand-ink'
            : 'bg-surface-soft text-content-muted'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${skin}`}>
      {children}
    </span>
  )
}

/**
 * 상태 배지 — 라벨과 색을 이 파일 한 곳에서 정한다.
 *
 * 🔴 화면마다 STATUS_LABEL 맵을 다시 적지 않는다. 실제로 세 화면이 각자 적고 있었고
 *    한 곳은 enum 을 영문 그대로 내보였다 — 같은 상태가 화면마다 달리 불린다.
 *
 * 🔴 위험(빨강)은 "운영자가 지금 손대야 하는 것" 에만 쓴다.
 *    미처리 신고 · 가려진 글 · 차단된 회원. 색이 흔해지면 아무것도 눈에 안 띈다.
 */
export function AdminStatusBadge({
  kind,
  value,
}: {
  kind: 'report' | 'post' | 'override'
  value: string
}) {
  if (kind === 'report') {
    const label = value === 'PENDING' ? '미처리' : value === 'REVIEWED' ? '확인함' : '처리 완료'
    // 미처리는 "아직 안 한 일" 이지 사고가 아니다 — warning. 빨강은 이미 가려진 것에 쓴다.
    return <AdminBadge tone={value === 'PENDING' ? 'warning' : 'neutral'}>{label}</AdminBadge>
  }
  if (kind === 'post') {
    // 삭제는 이미 끝난 상태라 조용히 둔다. 숨김만 운영자가 되돌릴 수 있어 눈에 걸어 둔다.
    if (value === 'HIDDEN') return <AdminBadge tone="danger">숨김</AdminBadge>
    if (value === 'DELETED') return <AdminBadge tone="neutral">삭제됨</AdminBadge>
    return <AdminBadge tone="neutral">공개</AdminBadge>
  }
  // PIN 은 운영자가 의도해 올린 것이라 위험이 아니다. HIDE 는 무언가를 가린 상태다.
  return value === 'PIN' ? (
    <AdminBadge tone="brand">고정</AdminBadge>
  ) : (
    <AdminBadge tone="danger">홈에서 숨김</AdminBadge>
  )
}

/**
 * 데스크탑 표 · 모바일 카드.
 *
 * 🔴 진짜 <table> 을 쓰지 않는다. 좁은 화면에서 가로 스크롤이 생기고,
 *    그 스크롤은 페이지 전체를 흔든다. 같은 grid 템플릿을 머리줄과 각 줄에 주고
 *    모바일에서는 1열로 떨어뜨린다 — 표처럼 정렬되면서 카드로도 읽힌다.
 *
 * 🔴 columns 는 호출부가 정해 머리줄과 줄에 같이 넘긴다.
 *    한 곳에서 만들어 감추면 화면마다 다른 열 폭을 줄 수 없다.
 */
export function AdminTable({
  columns,
  head,
  children,
}: {
  columns: string
  head: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mt-2">
      <div
        className={`hidden border-b border-subtle px-2 pb-1.5 text-xs text-content-muted lg:grid lg:gap-3 ${columns}`}
      >
        {head}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:gap-0">{children}</ul>
    </div>
  )
}

export function AdminTableRow({
  href,
  columns,
  children,
  accent,
}: {
  href: string
  columns: string
  children: React.ReactNode
  /** 왼쪽 얇은 선으로만 구분한다 — 행 전체를 칠하지 않는다 */
  accent?: 'muted' | 'danger'
}) {
  const edge =
    accent === 'danger'
      ? 'border-l-2 border-l-state-danger'
      : accent === 'muted'
        ? 'border-l-2 border-l-interactive'
        : ''
  return (
    <li>
      <Link
        href={href}
        className={`flex min-h-[52px] flex-col gap-1 rounded-lg border border-subtle bg-surface-card p-3 no-underline lg:grid lg:min-h-[44px] lg:items-center lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-2 lg:py-1.5 lg:hover:bg-surface-soft ${edge} ${columns}`}
      >
        {children}
      </Link>
    </li>
  )
}

/** 표 안의 한 칸. 모바일에서는 라벨을 함께 보여 줘야 무슨 값인지 알 수 있다. */
export function AdminCell({
  label,
  children,
  className = '',
}: {
  label?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={`min-w-0 text-sm text-content-muted ${className}`}>
      {label ? <span className="lg:hidden">{label} </span> : null}
      {children}
    </span>
  )
}

/** 목록의 한 줄. 전체가 링크인 경우와 아닌 경우를 같은 모양으로 맞춘다. */
export function AdminCard({
  href,
  children,
  className = '',
}: {
  href?: string
  children: React.ReactNode
  className?: string
}) {
  const base = `rounded-lg border border-subtle bg-surface-card p-3 ${className}`
  if (!href) return <div className={base}>{children}</div>
  return (
    <Link href={href} className={`flex min-h-[52px] flex-col gap-1 no-underline ${base}`}>
      {children}
    </Link>
  )
}

/**
 * 남의 글을 그대로 옮긴 자리 — 신고 대상 본문·댓글 원문.
 *
 * 🔴 break-words 를 넣는다. 띄어쓰기 없는 긴 URL 이나 자모 반복이 들어오면
 *    모바일에서 카드 밖으로 넘쳐 옆 정보를 덮는다.
 */
export function AdminQuote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-soft p-2 text-sm text-content-primary">
      {children}
    </p>
  )
}

/**
 * 조치 묶음.
 *
 * 🔴 위험한 조치(가리기·차단)를 안전한 조치(상태 표시 바꾸기) 와 한 줄에 섞지 않는다.
 *    급할수록 손이 먼저 나가는 자리라 순서와 구분이 곧 안전장치다.
 */
export function AdminActionGroup({
  label,
  children,
  hint,
  danger = false,
}: {
  label: string
  children: React.ReactNode
  hint?: string
  /** 되돌리기 어려운 조치 묶음 — 바탕을 떼어 단순 상태 변경과 섞이지 않게 한다 */
  danger?: boolean
}) {
  return (
    <div
      className={
        danger
          ? 'mt-3 rounded-lg border border-subtle bg-surface-page p-2'
          : 'mt-3'
      }
    >
      <p className="m-0 text-xs font-bold uppercase tracking-wide text-content-muted">{label}</p>
      {hint ? <p className="mt-1 text-xs text-content-muted">{hint}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/**
 * 이름표와 값이 줄줄이 오는 자리 — 회원 가입 정보처럼.
 *
 * 🔴 값에 break-all 을 준다. 이메일·전화번호·cuid 는 띄어쓰기가 없어
 *    모바일에서 가로 스크롤을 만들고 옆 칸을 덮는다.
 */
export function AdminFieldList({ children }: { children: React.ReactNode }) {
  return <dl className="mt-2 flex flex-col">{children}</dl>
}

export function AdminField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-subtle py-3 first:border-t-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-sm text-content-muted sm:w-40">{label}</dt>
      <dd className="m-0 break-all text-sm text-content-primary">{value}</dd>
    </div>
  )
}
