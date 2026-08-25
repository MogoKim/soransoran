'use client'

import { useEffect, useState } from 'react'
import {
  FONT_SIZE_LABELS,
  FONT_SIZE_STORAGE_KEY,
  isFontSize,
  type FontSize,
} from '@/lib/font-size'

/** '가' 세 개의 크기 차이가 그대로 미리보기가 된다. */
const PREVIEW_CLASS: Record<FontSize, string> = {
  SMALL: 'text-xs',
  NORMAL: 'text-lg',
  LARGE: 'text-xl',
}

const OPTIONS: readonly FontSize[] = ['SMALL', 'NORMAL', 'LARGE']

function readCurrent(): FontSize {
  const attr = document.documentElement.getAttribute('data-font-size')
  return isFontSize(attr) && attr !== 'NORMAL' ? attr : 'NORMAL'
}

function persist(value: FontSize) {
  try {
    if (value === 'NORMAL') localStorage.removeItem(FONT_SIZE_STORAGE_KEY)
    else localStorage.setItem(FONT_SIZE_STORAGE_KEY, value)
  } catch {
    /* 저장이 막혀도 이번 방문에는 적용된다 */
  }
}

/** header = 상단 아이콘 버튼 하나로 순환 · panel = 세 개를 늘어놓는 기본형 */
export default function FontSizeToggle({ variant = 'panel' }: { variant?: 'panel' | 'header' }) {
  const [current, setCurrent] = useState<FontSize>('NORMAL')

  // 첫 페인트는 layout.tsx 의 인라인 스크립트가 이미 끝냈다. 여기서는 그 결과를 읽기만 한다.
  useEffect(() => {
    setCurrent(readCurrent())
  }, [])

  function apply(value: FontSize) {
    const root = document.documentElement
    if (value === 'NORMAL') root.removeAttribute('data-font-size')
    else root.setAttribute('data-font-size', value)
    persist(value)
    setCurrent(value)
  }

  if (variant === 'header') {
    const next = OPTIONS[(OPTIONS.indexOf(current) + 1) % OPTIONS.length]
    return (
      <button
        type="button"
        onClick={() => apply(next)}
        aria-label={`글씨 크기 — 지금 ${FONT_SIZE_LABELS[current]}, 누르면 ${FONT_SIZE_LABELS[next]}`}
        className="inline-flex min-h-[52px] min-w-[52px] items-center justify-center rounded-xl text-content-muted"
      >
        <span className="text-lg font-bold leading-none">가</span>
        <span className="text-xs leading-none">+</span>
      </button>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="글씨 크기 조절"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-xs text-content-muted">글씨 크기</span>
      {OPTIONS.map((value) => {
        const selected = current === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`글씨 ${FONT_SIZE_LABELS[value]}`}
            onClick={() => apply(value)}
            className={`inline-flex min-h-[52px] min-w-[52px] items-center justify-center rounded-lg border ${
              selected
                ? 'border-interactive bg-surface-soft font-bold text-content-primary'
                : 'border-subtle text-content-muted'
            }`}
          >
            <span className={`leading-none ${PREVIEW_CLASS[value]}`}>가</span>
          </button>
        )
      })}
    </div>
  )
}
