'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { OPS_NAV, isCurrent } from '@/components/admin/AdminOpsNav'
import { TABS as MEMBER_TABS } from '@/components/admin/MemberAdminTabs'

/**
 * 운영 메뉴 — 데스크탑 사이드바와 모바일 전체 화면 메뉴가 같은 목록(NAV)을 쓴다.
 *
 * 🔴 목록은 두 곳에서 온다 — 운영 묶음 7개는 AdminOpsNav(OPS_NAV), 자동 운영은 아래 AUTO_NAV.
 *
 * 🔴 묶음은 셋이다 (Admin Console V2 · 2026-10-20 창업자 확정 IA).
 *      개요 · 운영(남이 쓴 것과 회원을 다루는 일) · 자동 운영(페르소나 · 후보 · 자동 READY)
 *    자동 운영 화면은 예전에 이 메뉴 밖의 "별도 화면" 이었다. 메뉴에 없으니 주소를 외워야
 *    들어갈 수 있었고(결함 신고 · 증거 검토 · 글 초안은 들어오는 링크가 0이었다),
 *    고객 셸을 빌려 써서 고객 글자 크기를 따라 흔들렸다. 같은 셸 · 같은 메뉴로 합쳤다.
 *    업무의 분리는 묶음 이름이 맡는다 — 셸을 갈라서 분리하지 않는다.
 *
 * 🔴 지금 어디인지 세 겹으로 표시한다: 주황 왼쪽 선 + 굵은 글씨 + aria-current="page".
 *    조치 뒤 router.refresh() 로 화면이 다시 그려지는데, 표시가 약하면
 *    "눌렀는데 아무 일도 없었나" 하고 같은 버튼을 또 누른다.
 *
 * 🔴 하위 메뉴는 16px 들여쓰고 왼쪽 세로 안내선으로 묶는다. 상위 항목을 칠하지 않는다 —
 *    현재 표시가 두 군데 생기면 어느 것이 지금 화면인지 흐려진다. 상위는 굵기만 올린다.
 *
 * 🔴 상세 화면은 메뉴에 두지 않는다. 상세에 있을 때는 그 목록 항목이 켜진다.
 *
 * 아이콘 라이브러리를 새로 넣지 않는다(저장소에 없다). 글자만으로 세운다.
 */
type NavLeaf = { href: string; label: string }
type NavItem = {
  /** 없으면 링크가 아닌 묶음 이름이다(하위 메뉴만 링크) */
  href?: string
  label: string
  hint: string
  subs?: readonly NavLeaf[]
}
type NavGroup = { group: string; items: readonly NavItem[] }

/** 자동 운영 묶음 — 운영 묶음(OPS_NAV · 7개)과 따로 센다 */
const AUTO_NAV: readonly NavItem[] = [
  { href: '/admin/personas', label: '페르소나 관제', hint: '상태 · 전체 중지 스위치' },
  { href: '/admin/persona-candidates', label: '댓글 후보 대기열', hint: '결정 · 대상 지정 · 발행' },
  { href: '/admin/original-post-candidates', label: '글 초안 대기열', hint: '읽기 전용 검수' },
  {
    label: '자동 READY 품질',
    hint: '표본 검토 · 결함 신고',
    subs: [
      { href: '/admin/auto-ready-evidence', label: '정확도 표본 검토' },
      { href: '/admin/auto-ready-defects', label: '중대 결함 신고' },
    ],
  },
]

/** 「회원」 의 하위 메뉴는 회원 화면의 공통 하위 탭과 같은 목록이다(MemberAdminTabs · 회원가입 전환 정본 §10) */
const withSubs = (it: (typeof OPS_NAV)[number]): NavItem =>
  it.href === '/admin/members' ? { ...it, subs: MEMBER_TABS.map(({ href, label }) => ({ href, label })) } : it

const NAV: readonly NavGroup[] = [
  { group: '개요', items: OPS_NAV.filter((it) => it.href === '/admin') },
  { group: '운영', items: OPS_NAV.filter((it) => it.href !== '/admin').map(withSubs) },
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

const MARK_ON = 'border-l-[3px] border-brand bg-surface-card font-bold text-content-primary'
const MARK_OFF = 'border-l-[3px] border-transparent text-content-secondary hover:bg-surface-page'

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
  return (
    <div className="flex flex-col gap-6">
      {NAV.map((g) => (
        <div key={g.group} className="flex flex-col gap-1">
          <p className="m-0 px-4 pb-1 text-xs font-bold text-content-muted">{g.group}</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {g.items.map((it) => {
              const subActive = it.subs?.some((s) => s.href === cur) ?? false
              const leafOn = !it.subs && it.href === cur
              const rowH = sheet ? 'min-h-[60px]' : 'min-h-[52px]'
              const head = (
                <>
                  <span className={`text-base ${leafOn || subActive ? 'font-bold text-content-primary' : ''}`}>
                    {it.label}
                  </span>
                  <span className="text-xs font-normal text-content-muted">{it.hint}</span>
                </>
              )
              return (
                <li key={it.label}>
                  {it.href && !it.subs ? (
                    <Link
                      href={it.href}
                      onClick={onNavigate}
                      aria-current={leafOn ? 'page' : undefined}
                      className={`flex ${rowH} flex-col justify-center rounded-r-lg px-4 py-1.5 text-left no-underline transition-colors ${leafOn ? MARK_ON : MARK_OFF}`}
                    >
                      {head}
                    </Link>
                  ) : (
                    <p
                      className={`m-0 flex ${rowH} flex-col justify-center border-l-[3px] border-transparent px-4 py-1.5 text-content-secondary`}
                    >
                      {head}
                    </p>
                  )}
                  {it.subs ? (
                    /* 🔴 16px 들여쓰기 + 왼쪽 세로 안내선 */
                    <ul className="m-0 ml-4 flex list-none flex-col gap-0.5 border-l border-interactive p-0 pl-2">
                      {it.subs.map((s) => {
                        const on = s.href === cur
                        return (
                          <li key={s.href}>
                            <Link
                              href={s.href}
                              onClick={onNavigate}
                              aria-current={on ? 'page' : undefined}
                              className={`flex ${sheet ? 'min-h-[52px]' : 'min-h-[44px]'} items-center rounded-r-lg px-3 text-left text-sm no-underline transition-colors ${on ? MARK_ON : MARK_OFF}`}
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
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** 데스크탑 왼쪽 사이드바 */
export function AdminSidebarNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="운영 메뉴">
      <NavList pathname={pathname} variant="sidebar" />
    </nav>
  )
}

/**
 * 모바일 상단 줄 + 전체 화면 메뉴.
 *
 * 🔴 모든 문구를 왼쪽에 붙인다. 가운데 정렬은 줄마다 시작점이 달라 훑기 어렵다.
 * 🔴 메뉴가 열리면 본문 스크롤을 잠근다 — 메뉴를 내리다 뒤의 본문이 따라 밀리지 않게.
 * 🔴 항목을 고르면 닫힌다. 주소가 바뀌어도 닫힌다(뒤로가기 포함).
 * 🔴 열면 닫기 버튼에 초점이 가고, 닫으면 메뉴 버튼으로 돌아온다. Esc 로 닫힌다.
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

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-subtle bg-surface-card py-2 pl-4 pr-2 text-left">
        <div className="flex min-w-0 flex-col pt-1.5">
          {/* 🔴 링크로 두지 않는다 — 두 줄 머리 안에서 52px 터치를 줄 자리가 없고, 운영 홈은 메뉴에 있다 */}
          <p className="m-0 text-sm font-bold text-content-primary">소란소란 운영</p>
          {here ? (
            <p className="m-0 truncate text-sm text-content-muted">
              {here.group} › <span className="font-bold text-content-primary">{here.label}</span>
            </p>
          ) : null}
        </div>
        <button
          ref={openBtn}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="admin-mobile-menu"
          className="inline-flex min-h-[52px] min-w-[72px] shrink-0 items-center justify-center rounded-lg border border-interactive bg-surface-card px-4 text-base font-bold text-content-primary"
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
          className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-surface-card text-left"
        >
          <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-subtle bg-surface-card py-2 pl-4 pr-2">
            <p className="m-0 text-lg font-bold text-content-primary">운영 메뉴</p>
            <button
              ref={closeBtn}
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-[52px] min-w-[72px] items-center justify-center rounded-lg border border-interactive bg-surface-card px-4 text-base font-bold text-content-primary"
            >
              닫기
            </button>
          </div>
          <nav aria-label="운영 메뉴" className="py-4 pr-4">
            <NavList pathname={pathname} variant="sheet" onNavigate={() => setOpen(false)} />
          </nav>
          <p className="m-0 border-t border-subtle px-4 py-4">
            <Link href="/" className="inline-flex min-h-[52px] items-center text-sm text-link">
              고객 화면 열기
            </Link>
          </p>
        </div>
      ) : null}
    </>
  )
}
