'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 이미 불러온 목록 안에서만 거른다 — 상태 칩 · 글자 찾기.
 *
 * 🔴 서버에 다시 묻지 않는다. 조회 · 정렬 · take 를 그대로 두고, 서버가 그린 줄에
 *    hidden 만 붙였다 뗀다. 그래서 데이터가 클라이언트로 더 넘어가지 않는다 —
 *    줄의 data-search 에는 이미 화면에 보이는 값(마스킹된 값은 마스킹된 채)만 들어 있다.
 *
 * 🔴 결과 줄에 "불러온 범위 안에서" 라고 함께 적는다(호출부의 AdminRangeNote).
 *    없으면 거른 결과가 "DB 전체에 없다" 로 읽힌다.
 *
 * 🔴 상태 거르기는 세그먼트 한 모양이다(Admin Golden Master · 데스크탑 · 모바일 같음).
 *    넘치면 세그먼트 줄 안에서만 옆으로 밀리고 페이지는 넘치지 않는다. 고른 칸은 보이는 자리로 옮긴다.
 *    mobileScroll 이면 모바일에서 오른쪽 끝을 흐려 "더 있다" 를 보인다.
 *
 * 줄 표시: data-admin-row · data-filter(공백으로 여러 값) · data-search — AdminUi 의 표 줄이 붙인다.
 */
export type FilterChip = { key: string; label: string; count?: number }

export default function AdminListFilter({
  chips,
  chipsLabel = '상태',
  searchLabel,
  searchPlaceholder,
  mobileScroll = false,
  emptyText = '조건에 맞는 항목이 없습니다. 불러온 범위 안에서만 찾았습니다.',
  children,
}: {
  chips?: FilterChip[]
  chipsLabel?: string
  /** 있으면 글자 찾기 칸을 그린다 */
  searchLabel?: string
  searchPlaceholder?: string
  mobileScroll?: boolean
  emptyText?: string
  children: React.ReactNode
}) {
  const [chip, setChip] = useState(chips?.[0]?.key ?? 'all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState<number | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const firstChip = chips?.[0]?.key ?? 'all'

  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-admin-row]'))
    const needle = q.trim().toLowerCase()
    let visible = 0
    for (const row of rows) {
      const keys = (row.dataset.filter ?? '').split(' ')
      const okChip = chip === firstChip || keys.includes(chip)
      const okText = needle === '' || (row.dataset.search ?? '').includes(needle)
      const on = okChip && okText
      row.hidden = !on
      if (on) visible += 1
    }
    setShown(visible)
    setTotal(rows.length)
  }, [chip, q, firstChip])

  function pick(key: string) {
    setChip(key)
    chipRefs.current.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const filtering = chip !== firstChip || q.trim() !== ''

  return (
    <div className="flex flex-col gap-3">
      {chips || searchLabel ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          {searchLabel ? (
            <label className="flex min-w-0 flex-col gap-1.5 lg:w-80">
              <span className="text-xs font-semibold text-content-secondary">{searchLabel}</span>
              <span className="relative block">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
                >
                  <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path d="m11 11 3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="min-h-[52px] w-full rounded-md border border-interactive bg-surface-card pl-9 pr-3 text-sm text-content-primary lg:min-h-[44px]"
                />
              </span>
            </label>
          ) : null}
          {chips ? (
            <div role="group" aria-label={chipsLabel} className="flex min-w-0 flex-col gap-1.5 lg:flex-1">
              <span aria-hidden="true" className="text-xs font-semibold text-content-secondary">
                {chipsLabel}
              </span>
              {/* 🔴 세그먼트 한 모양 — 데스크탑 · 모바일 같다(Admin Golden Master). 넘치면 이 줄 안에서만 밀린다. */}
              <div
                className={`flex max-w-full self-start overflow-x-auto rounded-md border border-interactive ${
                  mobileScroll ? '[mask-image:linear-gradient(to_right,black_82%,transparent)] lg:[mask-image:none]' : ''
                }`}
              >
                {chips.map((c) => {
                  const on = c.key === chip
                  return (
                    <button
                      key={c.key}
                      ref={(el) => {
                        if (el) chipRefs.current.set(c.key, el)
                        else chipRefs.current.delete(c.key)
                      }}
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick(c.key)}
                      className={`inline-flex min-h-[52px] shrink-0 items-center gap-1.5 whitespace-nowrap border-r border-subtle px-4 text-sm last:border-r-0 lg:min-h-[44px] ${
                        on
                          ? 'bg-surface-card font-bold text-content-primary shadow-[inset_0_-2px_0_var(--admin-accent)]'
                          : 'text-content-secondary hover:bg-surface-page'
                      }`}
                    >
                      {c.label}
                      {c.count !== undefined ? (
                        <span className="text-xs tabular-nums text-content-muted">{c.count}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {filtering && shown !== null && total !== null ? (
        <p role="status" className="m-0 text-xs text-content-muted">
          불러온 {total}건 중 <strong className="font-bold tabular-nums text-content-primary">{shown}</strong>건 표시
        </p>
      ) : null}

      <div ref={listRef}>{children}</div>

      {filtering && shown === 0 ? (
        <p className="m-0 border-y border-[color:var(--admin-divider)] px-4 py-8 text-sm text-content-secondary">
          {emptyText}
        </p>
      ) : null}
    </div>
  )
}
