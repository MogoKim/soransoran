'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { OPS_NAV, isCurrent } from '@/components/admin/AdminOpsNav'
import { TABS as MEMBER_TABS } from '@/components/admin/MemberAdminTabs'

/**
 * 운영 메뉴 — 데스크탑 딥 사이드바와 모바일 전체 화면 메뉴가 같은 목록(NAV) · 같은 위계를 쓴다.
 *
 * 🔴 목록은 두 곳에서 온다 — 운영 묶음 7개는 AdminOpsNav(OPS_NAV), 자동 운영은 아래 AUTO_NAV.
 *    회원의 하위 메뉴는 회원 화면의 공통 하위 탭(MemberAdminTabs.TABS)을 그대로 쓴다.
 *
 * 🔴 묶음은 셋이다 — 개요 · 운영 · 자동 운영 (Admin Console V2 · 2026-10-20 창업자 확정 IA).
 *    묶음은 접고 펼친다. 처음에는 지금 화면이 속한 묶음만 펼쳐 둔다 — 메뉴가 길어
 *    아래쪽 항목이 화면 밖으로 밀리던 문제(사이드바 안 스크롤)를 줄인다.
 *    하위 메뉴가 있는 항목(회원 · 자동 READY 품질)은 화살표로 알리고, 같은 규칙으로 펼친다.
 *
 * 🔴 지금 어디인지: 행 전체 면 + 흰 굵은 글자 + 왼쪽 코랄선 + aria-current="page"
 *    (창업자 확정 B안 · 딥 사이드바). 얇은 선 하나만으로는 짙은 바탕에서 눈에 걸리지 않았다.
 *
 * 🔴 메뉴마다 붙던 작은 설명은 뺐다 — 탐색할 때 읽을 글자만 늘렸다.
 *
 * 🔴 색은 .admin-shell 의 --admin-nav-* 토큰만 쓴다(globals.css). 고객 토큰과 무관하다.
 *    아이콘 라이브러리를 새로 넣지 않는다 — 화살표는 이 파일의 단순 SVG 하나다.
 */
type NavLeaf = { href: string; label: string }
type NavItem = {
  /** 하위 메뉴가 없는 항목의 주소. 하위 메뉴가 있으면 항목 자체는 펼치기 버튼이다 */
  href?: string
  label: string
  subs?: readonly NavLeaf[]
}
type NavGroup = { group: string; items: readonly NavItem[] }

/** 자동 운영 묶음 — 운영 묶음(OPS_NAV · 7개)과 따로 센다 */
const AUTO_NAV: readonly NavItem[] = [
  { href: '/admin/personas', label: '페르소나 관제' },
  { href: '/admin/persona-candidates', label: '댓글 후보 대기열' },
  { href: '/admin/original-post-candidates', label: '글 초안 대기열' },
  {
    label: '자동 READY 품질',
    subs: [
      { href: '/admin/auto-ready-evidence', label: '정확도 표본 검토' },
      { href: '/admin/auto-ready-defects', label: '중대 결함 신고' },
    ],
  },
]

/** 「회원」 의 하위 메뉴는 회원 화면의 공통 하위 탭과 같은 목록이다(MemberAdminTabs · 회원가입 전환 정본 §10) */
const toItem = (it: (typeof OPS_NAV)[number]): NavItem =>
  it.href === '/admin/members'
    ? { label: it.label, subs: MEMBER_TABS.map(({ href, label }) => ({ href, label })) }
    : { href: it.href, label: it.label }

const NAV: readonly NavGroup[] = [
  { group: '개요', items: OPS_NAV.filter((it) => it.href === '/admin').map(toItem) },
  { group: '운영', items: OPS_NAV.filter((it) => it.href !== '/admin').map(toItem) },
  { group: '자동 운영', items: AUTO_NAV },
]

/**
 * 지금 화면에 해당하는 링크 하나를 고른다.
 * 🔴 가장 긴 주소가 이긴다. 고객 구성 화면에서 '회원 관리'(/admin/members)와
 *    '고객 구성'이 함께 켜지지 않게 한다. 회원 상세(/admin/members/:id)는 '회원 관리'가 켜진다.
 */
function currentHref(pathname: string): string | null {
  let best: string | null = null
  for (const g of NAV) {
    for (const it of g.items) {
      const hrefs = it.subs ? it.subs.map((s) => s.href) : it.href ? [it.href] : []
      for (const h of hrefs) {
        if (isCurrent(pathname, h) && (best === null || h.length > best.length)) best = h
      }
    }
  }
  return best
}

const holds = (it: NavItem, cur: string | null) =>
  it.subs ? it.subs.some((s) => s.href === cur) : it.href === cur

function locate(pathname: string): { group: string; label: string } | null {
  const cur = currentHref(pathname)
  if (cur === null) return null
  for (const g of NAV) {
    for (const it of g.items) {
      const sub = it.subs?.find((s) => s.href === cur)
      if (sub) return { group: `${g.group} › ${it.label}`, label: sub.label }
      if (!it.subs && it.href === cur) return { group: g.group, label: it.label }
    }
  }
  return null
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      className={`shrink-0 text-[color:var(--admin-nav-label)] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    >
      <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 행 모양 — 선택 행은 면 + 흰 굵은 글자 + 왼쪽 코랄선 */
const ROW_ON =
  'bg-[color:var(--admin-nav-active-bg)] font-bold text-[color:var(--admin-nav-active-text)] shadow-[inset_3px_0_0_var(--admin-nav-active-bar)]'
const ROW_OFF = 'hover:bg-[color:var(--admin-nav-hover)]'

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
  const sheet = variant === 'sheet'
  const uid = useId()

  /* 처음에는 지금 화면이 속한 묶음 · 하위 메뉴만 펼친다. 주소가 바뀌면 다시 맞춘다. */
  const initial = () => {
    const open: Record<string, boolean> = {}
    for (const g of NAV) {
      open[g.group] = g.items.some((it) => holds(it, cur))
      for (const it of g.items) if (it.subs) open[`${g.group}/${it.label}`] = holds(it, cur)
    }
    return open
  }
  const [open, setOpen] = useState<Record<string, boolean>>(initial)
  useEffect(() => {
    setOpen(initial())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 주소가 바뀔 때만 다시 맞춘다
  }, [cur])
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  /* 🔴 상위 · 하위 글자는 관리자 글자 토큰 한 단계 차이 — 데스크탑 16/14 · 모바일 17/16 */
  const top = sheet ? 'min-h-[52px] text-base' : 'min-h-[44px] text-sm'
  const sub = sheet ? 'min-h-[52px] text-sm' : 'min-h-[40px] text-xs'

  return (
    <div className="flex flex-col gap-1">
      {NAV.map((g) => {
        const gOpen = open[g.group] ?? false
        const gId = `${uid}-${g.group}`
        return (
          <div key={g.group}>
            <button
              type="button"
              aria-expanded={gOpen}
              aria-controls={gId}
              onClick={() => toggle(g.group)}
              className={`flex w-full items-center justify-between rounded-lg px-5 text-left text-xs font-bold tracking-wide text-[color:var(--admin-nav-label)] hover:bg-[color:var(--admin-nav-hover)] ${sheet ? 'min-h-[52px]' : 'min-h-[40px]'}`}
            >
              <span>{g.group}</span>
              <Chevron open={gOpen} />
            </button>
            {gOpen ? (
              <ul id={gId} className="m-0 flex list-none flex-col gap-0.5 px-2.5 pb-2 pt-0.5">
                {g.items.map((it) => {
                  if (it.subs) {
                    const key = `${g.group}/${it.label}`
                    const sOpen = open[key] ?? false
                    const sId = `${uid}-${key}`
                    const inside = holds(it, cur)
                    return (
                      <li key={it.label}>
                        <button
                          type="button"
                          aria-expanded={sOpen}
                          aria-controls={sId}
                          onClick={() => toggle(key)}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 text-left ${top} ${inside ? 'font-bold' : 'font-medium'} text-[color:var(--admin-nav-text)] ${ROW_OFF}`}
                        >
                          <span>{it.label}</span>
                          <Chevron open={sOpen} />
                        </button>
                        {sOpen ? (
                          /* 🔴 하위 메뉴: 22px 들여쓰기 + 세로 안내선 · 상위보다 한 단계 작은 글자 */
                          <ul
                            id={sId}
                            className="m-0 mb-1.5 ml-[22px] mt-0.5 flex list-none flex-col gap-0.5 border-l border-[color:var(--admin-nav-guide)] p-0 pl-2"
                          >
                            {it.subs.map((s) => {
                              const on = s.href === cur
                              return (
                                <li key={s.href}>
                                  <Link
                                    href={s.href}
                                    onClick={onNavigate}
                                    aria-current={on ? 'page' : undefined}
                                    className={`flex items-center rounded-lg px-3 no-underline ${sub} ${on ? ROW_ON : `text-[color:var(--admin-nav-text-sub)] ${ROW_OFF}`}`}
                                  >
                                    {s.label}
                                  </Link>
                                </li>
                              )
                            })}
                          </ul>
                        ) : null}
                      </li>
                    )
                  }
                  const on = it.href === cur
                  return (
                    <li key={it.label}>
                      <Link
                        href={it.href ?? '/admin'}
                        onClick={onNavigate}
                        aria-current={on ? 'page' : undefined}
                        className={`flex items-center rounded-lg px-3 no-underline ${top} ${on ? ROW_ON : `font-medium text-[color:var(--admin-nav-text)] ${ROW_OFF}`}`}
                      >
                        {it.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        )
      })}
    </div>
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
        className={`flex items-center gap-2 font-semibold text-[color:var(--admin-nav-text)] no-underline hover:underline ${sheet ? 'min-h-[52px] text-base' : 'min-h-[44px] text-sm'}`}
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
 * 🔴 메뉴 · 닫기 버튼은 밝은 면 + 먹색 글자다 — 짙은 바탕에서 누를 자리가 바로 보이게(13.5:1).
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
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--admin-nav-line)] bg-[color:var(--admin-nav-bg)] py-2 pl-4 pr-2 text-left">
        <div className="flex min-w-0 flex-col">
          {/* 🔴 링크로 두지 않는다 — 두 줄 머리 안에서 52px 터치를 줄 자리가 없고, 운영 홈은 메뉴에 있다 */}
          <p className="m-0 text-sm font-extrabold text-[color:var(--admin-nav-text)]">소란소란 운영</p>
          {here ? (
            <p className="m-0 truncate text-sm text-[color:var(--admin-nav-label)]">
              {here.group} › <span className="font-bold text-[color:var(--admin-nav-text)]">{here.label}</span>
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
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[color:var(--admin-nav-line)] bg-[color:var(--admin-nav-bg-strong)] py-2 pl-4 pr-2">
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
