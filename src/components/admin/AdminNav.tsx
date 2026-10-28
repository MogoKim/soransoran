'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { OPS_NAV, isCurrent } from '@/components/admin/AdminOpsNav'
import { TABS as MEMBER_TABS } from '@/components/admin/MemberAdminTabs'

/**
 * 운영 메뉴 — 데스크탑 딥 사이드바와 모바일 전체 화면 메뉴가 같은 목록(GROUPS) · 같은 위계를 쓴다.
 *
 * 🔴 업무 중심 단일 아코디언 (Admin Golden Master · 2026-10-22 창업자 확정 B안).
 *    운영 홈(단독) · 콘텐츠 운영 · 회원 · 노출·작성 · 자동 운영. 최대 2단계다.
 *    한 번에 한 묶음만 펼친다 — 다른 묶음을 열면 지금 묶음이 접힌다.
 *    처음에는 지금 화면이 속한 묶음이 펼쳐져 있다. 주소가 바뀌면 다시 맞춘다.
 *
 * 🔴 목록은 세 곳에서 온다. 항목을 여기서 새로 적지 않는다.
 *    - 운영 항목 7개 · 현재 위치 판정: AdminOpsNav(OPS_NAV · isCurrent)
 *    - 회원 하위 메뉴: 회원 화면의 공통 하위 탭(MemberAdminTabs.TABS)
 *    - 자동 운영: 아래 AUTO_NAV
 *
 * 🔴 상태 넷을 서로 다르게 그린다(사이드바 대비는 globals.css .admin-shell 주석).
 *    hover 면 · 누르는 중(active) 더 진한 면 · 선택(옅은 면 + 왼쪽 코랄선 + 흰 굵은 글자 + aria-current) ·
 *    focus 밝은 중립 외곽선(.admin-nav 의 --focus-ring). focus 에 코랄을 쓰지 않는다.
 *
 * 🔴 메뉴마다 설명 문구를 붙이지 않는다. 아이콘은 묶음에만 둔다 — 이 파일의 단순 SVG 이고
 *    아이콘 라이브러리를 새로 넣지 않는다.
 */
type NavLeaf = { href: string; label: string }
type IconName = 'home' | 'content' | 'members' | 'expose' | 'auto'
type NavGroup =
  | { key: string; label: string; icon: IconName; href: string; items?: undefined }
  | { key: string; label: string; icon: IconName; href?: undefined; items: readonly NavLeaf[] }

/** 자동 운영 묶음 — 운영 항목(OPS_NAV · 7개)과 따로 센다. 목적지 · 주소는 그대로다 */
const AUTO_NAV: readonly NavLeaf[] = [
  { href: '/admin/personas', label: '페르소나 관제' },
  { href: '/admin/persona-candidates', label: '댓글 후보 대기열' },
  { href: '/admin/original-post-candidates', label: '글 초안 대기열' },
  { href: '/admin/auto-ready-evidence', label: '정확도 표본 검토' },
  { href: '/admin/auto-ready-defects', label: '중대 결함 신고' },
]

/** OPS_NAV 에서 주소로 골라 온다 — 순서는 OPS_NAV 순서를 따른다 */
const ops = (...hrefs: string[]): NavLeaf[] => OPS_NAV.filter((it) => hrefs.includes(it.href))

const GROUPS: readonly NavGroup[] = [
  { key: 'home', label: '운영 홈', icon: 'home', href: '/admin' },
  { key: 'content', label: '콘텐츠 운영', icon: 'content', items: ops('/admin/reports', '/admin/content') },
  /* 「회원」 의 하위 메뉴는 회원 화면의 공통 하위 탭과 같은 목록이다(MemberAdminTabs · 회원가입 전환 정본 §10) */
  { key: 'members', label: '회원', icon: 'members', items: MEMBER_TABS.map(({ href, label }) => ({ href, label })) },
  { key: 'expose', label: '노출·작성', icon: 'expose', items: ops('/admin/home', '/admin/banners', '/admin/compose') },
  { key: 'auto', label: '자동 운영', icon: 'auto', items: AUTO_NAV },
]

const leaves = (g: NavGroup): readonly NavLeaf[] => (g.items ? g.items : [{ href: g.href, label: g.label }])

/**
 * 지금 화면에 해당하는 링크 하나를 고른다.
 * 🔴 가장 긴 주소가 이긴다. 고객 구성 화면에서 '회원 관리'(/admin/members)와
 *    '고객 구성'이 함께 켜지지 않게 한다. 회원 상세(/admin/members/:id)는 '회원 관리'가 켜진다.
 */
function currentHref(pathname: string): string | null {
  let best: string | null = null
  for (const g of GROUPS) {
    for (const leaf of leaves(g)) {
      if (isCurrent(pathname, leaf.href) && (best === null || leaf.href.length > best.length)) best = leaf.href
    }
  }
  return best
}

const groupOf = (cur: string | null): NavGroup | null =>
  cur === null ? null : (GROUPS.find((g) => leaves(g).some((l) => l.href === cur)) ?? null)

/** 모바일 위 줄의 「지금 어디」 — 묶음 › 화면. 운영 홈은 이름 하나 */
function locate(pathname: string): { group: string | null; label: string } | null {
  const cur = currentHref(pathname)
  const g = groupOf(cur)
  if (cur === null || g === null) return null
  if (!g.items) return { group: null, label: g.label }
  const leaf = g.items.find((l) => l.href === cur)
  return leaf ? { group: g.label, label: leaf.label } : null
}

const ICON_PATH: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  content: (
    <>
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M8.5 12.5h7M8.5 16h7" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.8 2.5 3 5.2" />
    </>
  ),
  expose: <path d="M4 9v6h3l6 4V5L7 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />,
  auto: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M9 12h.01M15 12h.01M9.5 15.5h5" />
    </>
  ),
}

/** 묶음 아이콘 — 지금 화면이 속한 묶음이면 코랄(현재 위치 표시) */
function GroupIcon({ name, here }: { name: IconName; here: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${here ? 'text-[color:var(--admin-nav-active-bar)]' : 'text-[color:var(--admin-nav-label)]'}`}
    >
      {ICON_PATH[name]}
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`ml-auto shrink-0 text-[color:var(--admin-nav-label)] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    >
      <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 선택 — 옅은 중립 면 + 왼쪽 코랄선 + 흰 굵은 글자 */
const ROW_ON =
  'bg-[color:var(--admin-nav-active-bg)] font-bold text-[color:var(--admin-nav-active-text)] shadow-[inset_3px_0_0_var(--admin-nav-active-bar)]'
/** hover 면 · 누르는 중 더 진한 면 */
const ROW_OFF = 'hover:bg-[color:var(--admin-nav-hover)] active:bg-[color:var(--admin-nav-pressed)]'

function NavList({
  pathname,
  variant,
  onNavigate,
}: {
  pathname: string
  variant: 'sidebar' | 'sheet'
  onNavigate?: () => void
}) {
  const cur = currentHref(pathname)
  const here = groupOf(cur)
  const sheet = variant === 'sheet'
  const uid = useId()

  /* 🔴 단일 아코디언 — 열린 묶음은 하나(또는 없음). 주소가 바뀌면 지금 묶음으로 다시 맞춘다. */
  const [openKey, setOpenKey] = useState<string | null>(here?.items ? here.key : null)
  useEffect(() => {
    setOpenKey(here?.items ? here.key : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 주소가 바뀔 때만 다시 맞춘다
  }, [cur])

  /* 🔴 행 높이 — 데스크탑 상위 · 하위 모두 44 · 모바일 52. 글자 상위 15/600 · 하위 14/400(모바일 16 · 15) */
  const row = sheet ? 'min-h-[52px] text-base' : 'min-h-[44px] text-[15px]'
  const kid = sheet ? 'min-h-[52px] text-[15px]' : 'min-h-[44px] text-xs'

  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 px-2.5">
      {GROUPS.map((g) => {
        const isHere = here?.key === g.key
        if (!g.items) {
          const on = g.href === cur
          return (
            <li key={g.key} className="border-b border-[color:var(--admin-nav-line)] pb-2 mb-1.5">
              <Link
                href={g.href}
                onClick={onNavigate}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 font-semibold no-underline ${row} ${on ? ROW_ON : `text-[color:var(--admin-nav-text)] ${ROW_OFF}`}`}
              >
                <GroupIcon name={g.icon} here={isHere} />
                {g.label}
              </Link>
            </li>
          )
        }
        const open = openKey === g.key
        const listId = `${uid}-${g.key}`
        return (
          <li key={g.key}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpenKey(open ? null : g.key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 text-left font-semibold ${row} ${isHere ? 'text-[color:var(--admin-nav-active-text)]' : 'text-[color:var(--admin-nav-text)]'} ${ROW_OFF}`}
            >
              <GroupIcon name={g.icon} here={isHere} />
              <span>{g.label}</span>
              <Chevron open={open} />
            </button>
            {open ? (
              /* 🔴 하위 메뉴: 세로 안내선 + 들여쓰기 · 상위보다 한 단계 작고 가벼운 글자 */
              <ul
                id={listId}
                className="m-0 mb-2 ml-[21px] mt-0.5 flex list-none flex-col gap-0.5 border-l border-[color:var(--admin-nav-guide)] p-0"
              >
                {g.items.map((leaf) => {
                  const on = leaf.href === cur
                  return (
                    <li key={leaf.href}>
                      <Link
                        href={leaf.href}
                        onClick={onNavigate}
                        aria-current={on ? 'page' : undefined}
                        className={`-ml-px flex items-center rounded-r-lg pl-[18px] pr-3 no-underline ${kid} ${on ? ROW_ON : `text-[color:var(--admin-nav-text-sub)] ${ROW_OFF}`}`}
                      >
                        {leaf.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/** 콘솔 이름 — 로고 이미지는 Logo.tsx 단일 진입점 규칙이 있어 여기서는 글자만 쓴다 */
function ConsoleTitle() {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-base font-extrabold text-[color:var(--admin-nav-text)]">소란소란 운영</span>
      <span className="text-xs text-[color:var(--admin-nav-label)]">운영 콘솔</span>
    </span>
  )
}

/** 바닥 고정 영역 — 고객 화면으로 나가는 길 */
function NavFooter({ sheet = false }: { sheet?: boolean }) {
  return (
    <div className="border-t border-[color:var(--admin-nav-line)] bg-[color:var(--admin-nav-bg-strong)] px-5 py-3">
      <Link
        href="/"
        className={`flex items-center gap-2 font-semibold text-[color:var(--admin-nav-text)] no-underline hover:underline ${sheet ? 'min-h-[52px] text-base' : 'min-h-[44px] text-[15px]'}`}
      >
        고객 화면 열기 <span aria-hidden="true">↗</span>
      </Link>
    </div>
  )
}

/** 데스크탑 딥 사이드바 — 248px 독립 색면 · 머리 · 메뉴 · 바닥 */
export function AdminSidebarNav() {
  const pathname = usePathname()
  return (
    <div className="admin-nav flex h-full flex-col bg-[color:var(--admin-nav-bg)]">
      <Link
        href="/admin"
        aria-label="운영 콘솔 홈"
        className="block border-b border-[color:var(--admin-nav-line)] bg-[color:var(--admin-nav-bg-strong)] px-5 py-5 no-underline"
      >
        <ConsoleTitle />
      </Link>
      <nav aria-label="운영 메뉴" className="min-h-0 flex-1 overflow-y-auto py-3">
        <NavList pathname={pathname} variant="sidebar" />
      </nav>
      <NavFooter />
    </div>
  )
}

/**
 * 모바일 딥 상단 줄 + 전체 화면 메뉴.
 *
 * 🔴 모든 문구를 왼쪽에 붙인다. 가운데 정렬은 줄마다 시작점이 달라 훑기 어렵다.
 * 🔴 메뉴가 열리면 본문 스크롤을 잠근다 — 메뉴를 내리다 뒤의 본문이 따라 밀리지 않게.
 * 🔴 항목을 고르면 닫힌다. 주소가 바뀌어도 닫힌다(뒤로가기 포함).
 * 🔴 열면 닫기 버튼에 초점이 가고, 닫으면 메뉴 버튼으로 돌아온다. Esc 로 닫힌다.
 * 🔴 메뉴 · 닫기 버튼은 밝은 면 + 차콜 글자다 — 짙은 바탕에서 누를 자리가 바로 보이게.
 */
export function AdminMobileNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const openBtn = useRef<HTMLButtonElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const here = locate(pathname)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openBtn.current?.focus()
      wasOpen.current = false
      return
    }
    wasOpen.current = true
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const lightBtn =
    'inline-flex min-h-[52px] min-w-[72px] shrink-0 items-center justify-center rounded-lg bg-[color:var(--admin-nav-text)] px-4 text-base font-bold text-[color:var(--admin-nav-bg)]'

  return (
    <div className="admin-nav">
      <div className="flex min-h-[64px] items-center justify-between gap-3 bg-[color:var(--admin-nav-bg)] py-1.5 pl-4 pr-2 text-left">
        <div className="flex min-w-0 flex-col">
          {/* 🔴 링크로 두지 않는다 — 두 줄 머리 안에서 52px 터치를 줄 자리가 없고, 운영 홈은 메뉴에 있다 */}
          <p className="m-0 text-base font-extrabold text-[color:var(--admin-nav-text)]">소란소란 운영</p>
          {here ? (
            <p className="m-0 truncate text-xs text-[color:var(--admin-nav-label)]">
              {here.group ? `${here.group} › ` : null}
              <span className="font-bold text-[color:var(--admin-nav-text)]">{here.label}</span>
            </p>
          ) : null}
        </div>
        <button
          ref={openBtn}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="admin-mobile-menu"
          className={lightBtn}
        >
          메뉴
        </button>
      </div>

      {open ? (
        <div
          id="admin-mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="운영 메뉴"
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-[color:var(--admin-nav-bg)] text-left"
        >
          <div className="sticky top-0 z-10 flex min-h-[64px] items-center justify-between gap-3 border-b border-[color:var(--admin-nav-line)] bg-[color:var(--admin-nav-bg-strong)] py-1.5 pl-4 pr-2">
            <ConsoleTitle />
            <button ref={closeBtn} type="button" onClick={() => setOpen(false)} className={lightBtn}>
              닫기
            </button>
          </div>
          <nav aria-label="운영 메뉴" className="flex-1 py-3">
            <NavList pathname={pathname} variant="sheet" onNavigate={() => setOpen(false)} />
          </nav>
          <NavFooter sheet />
        </div>
      ) : null}
    </div>
  )
}
