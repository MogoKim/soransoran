import Link from 'next/link'

/**
 * 어드민 공통 조각 — 실제로 중복된 것만 모은다.
 *
 * 🔴 컴포넌트를 새로 만드는 것이 목적이 아니다. 화면들이 헤더·섹션·배지·빈 상태를
 *    각자 적고 있어서 한 곳을 고쳐도 나머지가 따라오지 않았다. 그것만 없앤다.
 *
 * 🔴 서버 컴포넌트로 둔다. 상태를 갖지 않으므로 'use client' 가 필요 없다 —
 *    조치 버튼(AdminActionButton 등)과 목록 거르기(AdminListFilter)만 클라이언트다.
 *
 * 🔴 카드 안에 카드를 넣지 않는다. AdminCard 는 목록의 한 줄에만 쓰고,
 *    그 안에서는 배경만 다른 인용 블록(AdminQuote)을 쓴다.
 *
 * 🔴 Admin Console V2 (2026-10-20) — 창업자 확정 B Calm Spacious 체계.
 *    색·간격·크기는 이 파일과 AdminButton 만 정한다. 화면은 prop 과 레이아웃 클래스만 쓴다.
 *    표 한 줄 56px · 모바일 행 72px 이상 · 터치 52px.
 */

/**
 * 화면 맨 위 — 어디에 있고 무엇을 하는 곳인지.
 *
 * 상세 화면은 backHref 를 준다. 뒤로 가는 길이 없으면 브라우저 뒤로가기에 기대게 되는데,
 * 조치 후 refresh 된 화면에서는 그것이 엉뚱한 곳으로 간다.
 *
 * group 은 메뉴의 상위 묶음 이름이다(운영 · 자동 운영). 메뉴와 같은 말을 쓴다.
 */
export function AdminPageHeader({
  title,
  description,
  backHref,
  backLabel = '← 목록으로',
  badges,
  group,
}: {
  title: string
  description?: React.ReactNode
  backHref?: string
  backLabel?: string
  badges?: React.ReactNode
  group?: string
}) {
  return (
    <header className="flex flex-col gap-1 pt-1">
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex min-h-[52px] lg:min-h-[44px] items-center self-start text-sm text-link"
        >
          {backLabel}
        </Link>
      ) : group ? (
        <p className="m-0 text-xs text-content-muted">{group}</p>
      ) : null}
      <h1 className="m-0 break-words text-xl font-bold leading-snug text-content-primary">{title}</h1>
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
  className = 'mt-10',
  id,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
  id?: string
}) {
  return (
    <section className={className} aria-labelledby={id}>
      <h2 id={id} className="m-0 text-lg font-bold leading-snug text-content-primary">
        {title}
      </h2>
      {description ? <p className="m-0 mt-1.5 text-sm text-content-muted">{description}</p> : null}
      {children}
    </section>
  )
}

/** 흰 면 하나. 폼·요약·조치 묶음을 담는다. 🔴 패널 안에 패널을 넣지 않는다. */
export function AdminPanel({
  children,
  className = '',
  tone = 'default',
}: {
  children: React.ReactNode
  className?: string
  /** emphasis = 지금 할 일(굵은 테두리) · locked = 아직 열리지 않은 단계(점선) */
  tone?: 'default' | 'emphasis' | 'locked'
}) {
  const skin =
    tone === 'emphasis'
      ? 'border-2 border-content-primary bg-surface-card'
      : tone === 'locked'
        ? 'border border-dashed border-interactive bg-surface-page'
        : 'border border-subtle bg-surface-card'
  return <div className={`rounded-[10px] p-4 lg:p-6 ${skin} ${className}`}>{children}</div>
}

/**
 * 비어 있을 때.
 *
 * 🔴 "없습니다" 로 끝내지 않는다. 비어 있는 것이 정상인지 아닌지를 함께 적는다 —
 *    운영자가 "내가 못 찾은 건가" 를 의심하며 화면을 다시 뒤지게 된다.
 */
export function AdminEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 rounded-[10px] border border-dashed border-interactive px-4 py-6 text-sm text-content-muted">
      {children}
    </p>
  )
}

type NoticeTone = 'info' | 'warning' | 'danger'

/**
 * 화면 위 안내 한 줄 — 읽기 전용 · 위험 조치처럼 화면의 성격을 먼저 알려야 할 때.
 *
 * 🔴 색만으로 말하지 않는다. 아이콘 모양(정보 ⓘ · 경고 △)과 문구가 함께 간다.
 */
export function AdminNotice({
  tone = 'info',
  title,
  children,
}: {
  tone?: NoticeTone
  title?: React.ReactNode
  children?: React.ReactNode
}) {
  const skin =
    tone === 'danger'
      ? 'border-state-danger bg-[color:var(--admin-danger-soft)]'
      : tone === 'warning'
        ? 'border-state-warning bg-[color:var(--admin-warning-soft)]'
        : 'border-state-info bg-[color:var(--admin-info-soft)]'
  const iconColor =
    tone === 'danger' ? 'text-state-danger' : tone === 'warning' ? 'text-state-warning' : 'text-state-info'
  return (
    <div role="note" className={`flex items-start gap-3 rounded-[10px] border px-4 py-3 ${skin}`}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        aria-hidden="true"
        className={`mt-0.5 shrink-0 ${iconColor}`}
      >
        {tone === 'info' ? (
          <>
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 9v5M10 6.2v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M10 2.5 18.5 17H1.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M10 8v4.2M10 14.6v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
      </svg>
      <div className="flex min-w-0 flex-col gap-1 text-sm text-content-primary">
        {title ? <p className="m-0 font-bold">{title}</p> : null}
        {children}
      </div>
    </div>
  )
}

/**
 * 지금 불러온 범위를 알린다 — "전체 312건 중 최신 100건".
 *
 * 🔴 목록에 상한(take)이 있는 화면은 이 한 줄을 반드시 둔다. 없으면 걸러 낸 결과가
 *    "DB 전체에 없다" 로 읽힌다. 페이지 버튼은 실제로 연결될 때까지 그리지 않는다.
 */
export function AdminRangeNote({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-xs text-content-muted">{children}</p>
}

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success' | 'brand'

const BADGE_SKIN: Record<BadgeTone, string> = {
  neutral: 'bg-surface-page text-content-secondary',
  info: 'bg-[color:var(--admin-info-soft)] font-bold text-state-info',
  warning: 'bg-[color:var(--admin-warning-soft)] font-bold text-state-warning',
  danger: 'bg-[color:var(--admin-danger-soft)] font-bold text-state-danger',
  success: 'bg-[color:var(--admin-success-soft)] font-bold text-state-success',
  brand: 'bg-brand-soft font-bold text-brand-strong',
}

/** 배지 className — 요소를 바꿀 수 없는 자리(D100 컴포넌트)에서 쓴다 */
export function adminBadgeClass(tone: BadgeTone = 'neutral'): string {
  return `inline-flex min-h-[24px] items-center whitespace-nowrap rounded px-2 text-xs ${BADGE_SKIN[tone]}`
}

/**
 * 상태 한 조각.
 *
 * 🔴 기본은 뉴트럴이다. 예전에는 모든 배지가 코랄 바탕(--surface-soft)이라
 *    화면이 온통 분홍이었고 "정말 위험한 것" 이 묻혔다.
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
  return <span className={adminBadgeClass(tone)}>{children}</span>
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
 *
 * 🔴 데스크탑에서는 줄 전체를 흰 면 한 장에 올린다. hover 가 있는 행을 바탕 위에
 *    직접 두면 hover 색이 바탕과 가까워 아무 일도 일어나지 않는다(globals.css §표면).
 *    overflow-hidden 은 쓰지 않는다 — 키보드 focus 외곽선이 잘린다.
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
    <div className="mt-3 lg:rounded-[10px] lg:border lg:border-subtle lg:bg-surface-card">
      <div
        className={`hidden min-h-[44px] items-center rounded-t-[10px] border-b border-subtle bg-surface-page px-4 text-xs font-bold text-content-secondary lg:grid lg:gap-4 ${columns}`}
      >
        {head}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:gap-0">{children}</ul>
    </div>
  )
}

/**
 * data-admin-row · data-filter · data-search 는 AdminListFilter 가 읽는다.
 * 🔴 searchText 에는 이미 화면에 보이는 값만 넣는다 — 마스킹된 값은 마스킹된 채로.
 */
function rowData(filterKey?: string, searchText?: string) {
  return {
    'data-admin-row': '',
    ...(filterKey !== undefined ? { 'data-filter': filterKey } : {}),
    ...(searchText !== undefined ? { 'data-search': searchText.toLowerCase() } : {}),
  }
}

/** 줄의 배치 — 모바일 카드 72px · 데스크탑 표 56px */
const ROW_LAYOUT =
  'flex min-h-[72px] flex-col justify-center gap-1.5 px-4 py-3 lg:grid lg:min-h-[56px] lg:items-center lg:gap-4 lg:py-2'

/** 줄의 면 — 모바일은 카드 한 장, 데스크탑은 표 면 위 아랫줄만 */
const ROW_CARD =
  'rounded-[10px] border border-subtle bg-surface-card lg:rounded-none lg:border-x-0 lg:border-t-0 lg:bg-transparent'

/**
 * 왼쪽 강조선.
 * 🔴 테두리가 아니라 안쪽 그림자로 그린다. 데스크탑에서 lg:border-x-0 이 왼쪽 테두리까지
 *    지워 강조선이 사라졌다(2026-10-20 발견) — 그림자는 테두리 규칙과 부딪히지 않는다.
 */
function accentEdge(accent?: 'muted' | 'danger' | 'warning'): string {
  if (accent === 'danger') return 'shadow-[inset_3px_0_0_var(--state-danger)]'
  if (accent === 'warning') return 'shadow-[inset_3px_0_0_var(--state-warning)]'
  if (accent === 'muted') return 'shadow-[inset_3px_0_0_var(--border-interactive)]'
  return ''
}

export function AdminTableRow({
  href,
  columns,
  children,
  accent,
  filterKey,
  searchText,
}: {
  href: string
  columns: string
  children: React.ReactNode
  /** 왼쪽 얇은 선으로만 구분한다 — 행 전체를 칠하지 않는다 */
  accent?: 'muted' | 'danger' | 'warning'
  filterKey?: string
  searchText?: string
}) {
  return (
    <li {...rowData(filterKey, searchText)} className="lg:last:[&>a]:border-b-0">
      <Link
        href={href}
        className={`${ROW_LAYOUT} ${ROW_CARD} no-underline hover:bg-surface-page ${accentEdge(accent)} ${columns}`}
      >
        {children}
      </Link>
    </li>
  )
}

/** 링크가 아닌 표 한 줄 — 줄 안에 조치·펼치기가 있는 화면용 */
export function AdminTableItem({
  columns,
  children,
  accent,
  filterKey,
  searchText,
  below,
}: {
  columns: string
  children: React.ReactNode
  accent?: 'muted' | 'danger' | 'warning'
  filterKey?: string
  searchText?: string
  /** 줄 아래에 붙는 펼침·확인 영역 — 같은 면 안에 둔다 */
  below?: React.ReactNode
}) {
  return (
    <li {...rowData(filterKey, searchText)} className={`${ROW_CARD} lg:last:border-b-0 ${accentEdge(accent)}`}>
      <div className={`${ROW_LAYOUT} ${columns}`}>{children}</div>
      {below ? <div className="px-4 pb-4">{below}</div> : null}
    </li>
  )
}

/**
 * 표 안의 한 칸. 모바일에서는 라벨을 함께 보여 줘야 무슨 값인지 알 수 있다.
 *
 * 🔴 사람이 실제로 읽는 값(작성자·게시판·이메일)과 곁다리로 보는 값(날짜)을 가른다.
 *      value — 16px · --text-secondary
 *      meta  — 14px · --text-muted
 *    크기로 가르고 색은 통과 범위 안에서만 움직인다.
 *
 * 🔴 모바일 라벨은 값보다 작고 흐리게 둔다. 라벨과 값이 같은 모양이면
 *    "게시판 자유게시판" 이 한 덩어리로 읽혀 라벨이 값을 잡아먹는다.
 */
export function AdminCell({
  label,
  children,
  className = '',
  tone = 'value',
}: {
  label?: string
  children: React.ReactNode
  className?: string
  /** value = 읽는 값(기본) · meta = 날짜처럼 곁다리로 보는 값 */
  tone?: 'value' | 'meta'
}) {
  const skin = tone === 'meta' ? 'text-xs text-content-muted' : 'text-sm text-content-secondary'
  return (
    <span className={`min-w-0 ${skin} ${className}`}>
      {label ? <span className="text-xs text-content-muted lg:hidden">{label} </span> : null}
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
  const base = `rounded-[10px] border border-subtle bg-surface-card p-4 ${className}`
  if (!href) return <div className={base}>{children}</div>
  return (
    <Link href={href} className={`flex min-h-[52px] flex-col gap-1 no-underline hover:bg-surface-page ${base}`}>
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
    <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-page p-3 text-base text-content-primary">
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
          ? 'mt-6 rounded-[10px] border border-subtle bg-surface-page p-4'
          : 'mt-6'
      }
    >
      <p className="m-0 text-sm font-bold text-content-secondary">{label}</p>
      {hint ? <p className="mt-1 text-sm text-content-muted">{hint}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
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

export function AdminField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-subtle py-3 first:border-t-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-sm text-content-muted sm:w-40">{label}</dt>
      <dd className="m-0 break-all text-base text-content-primary">{value}</dd>
    </div>
  )
}
