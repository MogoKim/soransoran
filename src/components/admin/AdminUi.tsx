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
    <header className={backHref ? 'pt-2' : 'pt-8'}>
      {backHref ? (
        <Link href={backHref} className="inline-flex min-h-[52px] items-center text-link">
          {backLabel}
        </Link>
      ) : null}
      <h1 className="m-0 break-words text-xl font-bold text-content-primary">{title}</h1>
      {badges ? <div className="mt-2 flex flex-wrap items-center gap-2">{badges}</div> : null}
      {description ? <p className="mt-1 text-sm text-content-muted">{description}</p> : null}
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
  return (
    <section className={className}>
      <h2 className="m-0 text-sm font-bold text-content-primary">{title}</h2>
      {description ? <p className="mt-1 text-sm text-content-muted">{description}</p> : null}
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
  return <p className="py-8 text-center text-sm text-content-muted">{children}</p>
}

type BadgeTone = 'muted' | 'danger' | 'brand'

/** 상태 한 조각. tone 은 세 가지뿐이다 — 색이 늘면 의미가 흐려진다. */
export function AdminBadge({
  tone = 'muted',
  children,
}: {
  tone?: BadgeTone
  children: React.ReactNode
}) {
  const skin =
    tone === 'danger'
      ? 'font-bold text-state-danger'
      : tone === 'brand'
        ? 'font-bold text-brand-ink'
        : 'text-content-muted'
  return (
    <span className={`rounded-md bg-surface-soft px-2 py-1 text-xs ${skin}`}>{children}</span>
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
  const base = `rounded-lg border border-subtle bg-surface-card p-4 ${className}`
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
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="mt-3">
      <p className="m-0 text-xs font-bold text-content-muted">{label}</p>
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
