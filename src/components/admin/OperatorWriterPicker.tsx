'use client'

import { useMemo, useState } from 'react'

import { AdminNotice } from '@/components/admin/AdminUi'
import type { WriterOption } from '@/lib/queries/operator-compose'

/**
 * 운영자 이름 고르기 — 90명 안팎에서 빨리, 헷갈리지 않게 고른다.
 *
 * 🔴 기본 선택창(select)을 그대로 쓴다 — 접근성·모바일 기본 선택기. 검색칸은 목록을 좁히기만 한다.
 * 🔴 "최근 쓴 이름" 5개를 위에 둔다(OperatorWriteLog 기준 — 서버가 recentIds 로 넘긴다).
 * 🔴 소개(note)의 앞 두 토막을 옵션에 같이 보인다 — 고르기 전에 사람을 구별한다. note 는 고객에게 보이지 않는다.
 * 🔴 이 글에 이미 쓴 이름은 표시만 한다(막지 않는다) — 같은 글에서 한 이름이 두 사람인 척하는 실수를 줄인다.
 * 🔴 검색이 고른 이름을 빠뜨려도 고른 값은 맨 위에 남긴다 — 선택이 조용히 바뀌지 않게.
 * 🔴 writerId 입력은 폼(OperatorComposeForm)에 있다. 이 컴포넌트는 값을 고르기만 한다.
 */
const norm = (s: string) => s.normalize('NFC').toLowerCase()

export default function OperatorWriterPicker({
  writers,
  recentIds,
  usedWriterIds,
  value,
  onChange,
}: {
  writers: WriterOption[]
  recentIds: string[]
  /** 댓글 모드에서 대상 글에 이미 쓴 운영 작성자 — 글 모드에서는 빈 배열 */
  usedWriterIds: string[]
  value: string
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const used = useMemo(() => new Set(usedWriterIds), [usedWriterIds])

  const { recent, rest } = useMemo(() => {
    const q = norm(query.trim())
    const hit = (w: WriterOption) => q === '' || norm(`${w.name} ${w.code} ${w.note ?? ''}`).includes(q)
    const recentSet = new Set(recentIds)
    const recentList = recentIds.map((id) => writers.find((w) => w.id === id)).filter((w): w is WriterOption => w !== undefined && hit(w))
    const restList = writers.filter((w) => !recentSet.has(w.id) && hit(w))
    return { recent: recentList, rest: restList }
  }, [writers, recentIds, query])

  const selected = writers.find((w) => w.id === value) ?? null
  const selectedHidden = selected !== null && !recent.some((w) => w.id === value) && !rest.some((w) => w.id === value)

  const label = (w: WriterOption) => {
    const brief = (w.note ?? '').split('·').slice(0, 2).map((t) => t.trim()).filter(Boolean).join(' · ')
    return `${used.has(w.id) ? '● 이 글에 씀 · ' : ''}${w.name}${brief ? ` · ${brief}` : ''} (${w.code})`
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">누구 이름으로 쓸까요</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 · 코드 · 소개로 찾기"
          className="min-h-[52px] rounded-md border border-interactive bg-surface-card px-3 text-content-primary lg:min-h-[44px]"
        />
      </label>
      <select
        aria-label="운영자 이름"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[52px] rounded-md border border-interactive bg-surface-card px-3 text-content-primary lg:min-h-[44px]"
      >
        {selectedHidden && selected ? <option value={selected.id}>{label(selected)}</option> : null}
        {recent.length > 0 ? (
          <optgroup label="최근 쓴 이름">
            {recent.map((w) => (
              <option key={w.id} value={w.id}>
                {label(w)}
              </option>
            ))}
          </optgroup>
        ) : null}
        <optgroup label="전체">
          {rest.map((w) => (
            <option key={w.id} value={w.id}>
              {label(w)}
            </option>
          ))}
        </optgroup>
      </select>
      {selected?.note ? <span className="text-xs text-content-muted">{selected.note}</span> : null}
      {selected && used.has(selected.id) ? (
        <AdminNotice tone="warning" title="이 글에 이미 이 이름으로 쓴 글이나 댓글이 있습니다">
          같은 사람이 이어 말하는 것인지 확인하세요.
        </AdminNotice>
      ) : null}
    </div>
  )
}
