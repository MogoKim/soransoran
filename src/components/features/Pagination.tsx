'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { TOUCH_MIN } from '@/lib/spacing'
import { buildListHref, type ListKeepParams } from '@/lib/list-query'

type PaginationProps = {
  currentPage: number
  totalPages: number
  /** 목록 주소. 예: '/community/free' · '/magazine' */
  basePath: string
  /**
   * 쪽을 옮겨도 따라가는 축. 게시판은 정렬, 매거진은 분류다.
   *
   * 🔴 함수가 아니라 **문자열 지도**를 받는다. 목록 화면은 서버 컴포넌트이고 이쪽은
   *    client 라 주소를 만드는 함수를 prop 으로 넘길 수 없다. 값만 넘기고 주소는
   *    여기서 `buildListHref` 로 만든다 — 규칙이 한 곳에 남는다.
   *
   * 🔴 무엇이 기본값인지는 이 컴포넌트가 모른다.
   *    `boardListKeep` · `magazineListKeep` 이 기본값 축을 이미 `undefined` 로 지워서 준다.
   */
  keep?: ListKeepParams
}

/**
 * 현재 페이지 둘레의 번호. 현재±1 로 **3개**, `[1, total]` 안으로 민다.
 *
 * 🔴 현재 페이지를 먼저 범위 안으로 클램프한다.
 *    우나어는 이것을 하지 않아 `/best?page=50`(총 6페이지)에서 창이 4·5·6 으로 잡히고
 *    현재 페이지가 그 안에 없어 **강조 표시가 통째로 사라졌다**(2026-09-21 실측).
 *    소란소란은 범위를 넘긴 요청을 404 로 막지만, 이 함수가 혼자서도 맞아야 한다 —
 *    호출부가 하나 늘어날 때 같은 구멍이 다시 열린다.
 */
function nearbyPages(current: number, total: number): number[] {
  const safeCurrent = Math.min(Math.max(current, 1), total)
  const start = Math.min(Math.max(safeCurrent - 1, 1), Math.max(1, total - 2))
  const pages: number[] = []
  for (let i = 0; i < 3 && start + i <= total; i += 1) pages.push(start + i)
  return pages
}

/** 묶음 이동 폭. 번호 3개를 건너뛰어 창이 겹치지 않고 다음 묶음으로 넘어간다. */
const BUNCH = 3

/**
 * 게시판 목록 페이지 이동.
 *
 *   1줄  (이전) (맨앞) [현재 쪽 입력] (이동) (다음)
 *   2줄  ‹묶음  현재±1 번호 3개  묶음›
 *
 * 🔴 불가능한 동작은 **숨긴다**. 흐린 버튼을 남기면 누를 수 있는 것처럼 보이고,
 *    눌러도 아무 일이 없으면 고장으로 읽힌다.
 *
 * 🔴 "맨뒤" 는 없다. 끝으로 가려면 쪽 번호를 직접 넣는다 —
 *    버튼이 하나 늘면 한 줄이 넘치고, 마지막 페이지를 찾는 일 자체가 드물다.
 *
 * 🔴 현재 페이지는 **링크가 아니다**(`<span>`). 지금 있는 자리로 가는 링크는
 *    스크린리더에서 "링크, 4 페이지" 로 읽혀 이동할 수 있는 것처럼 들린다.
 *
 * 🔴 `aria-current="page"` 는 **이 nav 안에 정확히 하나**다. 여기가 "쪽의 집합" 이라
 *    그 값을 쓸 자리다. 다른 nav(상단 메뉴·정렬 탭)가 자기 집합의 현재 항목을
 *    따로 표시하는 것은 충돌이 아니다 — 보조기술은 묶음 단위로 읽는다.
 *    검사: `npm run check:pagination` 이 이 파일에서 그 개수를 센다.
 *
 * ⚠️ 알려진 겹침 — FAB 과 오른쪽 끝 버튼.
 *    화면을 굴리다 이 줄이 뷰포트 맨 아래에 걸리는 순간, 고정 FAB(`bottom-6 right-5`·56px)이
 *    맨 오른쪽 버튼(보통 `›`)을 덮는다. 390px 실측: FAB x 314–370 · `›` x 293–345.
 *    쪽 이동 쪽에서는 풀 수 없다 — 가운데 정렬을 깨거나 FAB 동작을 바꿔야 하고,
 *    `FAB.tsx` 는 모든 화면 공유다. **이번 범위 밖의 별도 UX 과제로 남긴다.**
 *
 * 🔴 간격은 고정 px 다. rem 이면 글자를 키울 때 간격까지 함께 커져 줄이 넘친다.
 *    그래도 넘칠 수 있으므로 두 줄 모두 `flex-wrap` 을 연다 —
 *    우나어는 `shrink-0` 고정이라 가장 큰 글자·360px 에서 실제로 4px 넘쳤다
 *    (2026-09-21 실측). 소란소란의 "크게"(24px)가 우나어의 가장 큰 단계와 같은 값이라
 *    한 단계만 올려도 같은 일이 난다.
 */
export default function Pagination({ currentPage, totalPages, basePath, keep }: PaginationProps) {
  const router = useRouter()
  const [jump, setJump] = useState(String(currentPage))

  // 페이지를 옮기면 입력칸도 지금 쪽을 가리켜야 한다.
  useEffect(() => {
    setJump(String(currentPage))
  }, [currentPage])

  if (totalPages <= 1) return null

  const hrefFor = (page: number) => buildListHref(basePath, { page, keep })

  const isFirst = currentPage <= 1
  const isLast = currentPage >= totalPages
  const pages = nearbyPages(currentPage, totalPages)
  const hasPrevBunch = pages[0] > 1
  const hasNextBunch = pages[pages.length - 1] < totalPages

  function handleJump(event: FormEvent) {
    event.preventDefault()
    const parsed = Number.parseInt(jump, 10)
    if (!Number.isFinite(parsed)) return
    router.push(hrefFor(Math.min(Math.max(parsed, 1), totalPages)))
  }

  /* 누르는 것의 모양 — 흰 카드 위 옅은 블록(--surface-page)에 장식 테두리.
     우나어의 연회색 소프트칩을 소란소란의 웜 뉴트럴로 옮긴 것이다.
     연한 주황(--surface-soft)은 쓰지 않는다 — 버튼이 5~9개라 화면이 주황으로 덮인다.
     hover 는 면이 아니라 테두리가 진다(--border-interactive, 3.72:1). */
  const control = `inline-flex ${TOUCH_MIN} items-center justify-center rounded-lg border border-subtle bg-surface-page text-base font-medium text-content-primary no-underline transition duration-150 hover:border-interactive active:scale-[0.98]`
  /* 글자 버튼은 좌우 여백으로, 번호는 정사각으로. 번호는 세 자리가 되어도 눌리도록
     고정 폭이 아니라 최소 폭이다 — 하루 100건이면 100쪽은 곧 온다. */
  const labelBox = 'px-[11px]'
  const squareBox = 'w-[52px]'
  const numberBox = 'min-w-[52px] px-2'

  return (
    <nav
      aria-label="페이지 이동"
      /* 목록은 바탕 위에 면 없이 얹혀 있다. 조작부만 흰 카드로 세워 "여기부터 조작" 을 알린다.
         면이 아니라 테두리가 세운다 — 흰 카드는 이 바탕 위에서 1.04:1 이다(globals.css §표면).
         카드 안이라야 버튼의 옅은 블록(1.12:1)도 실제로 보인다. */
      className="mt-8 rounded-2xl border border-subtle bg-surface-card px-2 py-4"
    >
      <form onSubmit={handleJump} className="flex flex-wrap items-center justify-center gap-x-[3px] gap-y-2">
        {!isFirst && (
          <Link href={hrefFor(currentPage - 1)} rel="prev" className={`${control} ${labelBox}`}>
            이전
          </Link>
        )}

        {!isFirst && (
          <Link href={hrefFor(1)} aria-label="맨 앞 페이지로" className={`${control} ${labelBox}`}>
            맨앞
          </Link>
        )}

        {/* 🔴 TOUCH_MIN 을 쓰지 않는다. 입력칸은 "쓰는 곳" 이라 터치 상수의 대상이 아니다
            (src/lib/spacing.ts). 높이가 같은 것은 한 줄로 서기 위해서다. */}
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={jump}
          onChange={(event) => setJump(event.target.value.replace(/[^0-9]/g, ''))}
          aria-label={`이동할 페이지 번호 (1부터 ${totalPages}). 현재 ${currentPage} 페이지`}
          className="h-[52px] w-[52px] rounded-lg border border-subtle bg-surface-card text-center text-base font-medium text-content-primary transition duration-150 focus:border-interactive"
        />

        <button type="submit" className={`${control} ${labelBox}`}>
          이동
        </button>

        {!isLast && (
          <Link href={hrefFor(currentPage + 1)} rel="next" className={`${control} ${labelBox}`}>
            다음
          </Link>
        )}
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-[10px] gap-y-2">
        {hasPrevBunch && (
          <Link
            href={hrefFor(Math.max(1, currentPage - BUNCH))}
            aria-label="이전 페이지 묶음"
            className={`${control} ${squareBox}`}
          >
            <span aria-hidden className="text-xl leading-none">
              ‹
            </span>
          </Link>
        )}

        {pages.map((page) =>
          page === currentPage ? (
            /* 🔴 지금 쪽만 브랜드 면이다. 흰 글씨는 이 면 위에서 3.53:1 이라
                  큰 글씨 기준(3:1)으로만 선다 — text-lg + font-bold 가 그 계약이다
                  (globals.css §고객 primary CTA 내용색). 크기를 내리면 대비가 깨진다. */
            <span
              key={page}
              aria-current="page"
              className={`inline-flex ${TOUCH_MIN} ${numberBox} items-center justify-center rounded-lg bg-cta text-lg font-bold text-cta-content`}
            >
              {page}
            </span>
          ) : (
            <Link
              key={page}
              href={hrefFor(page)}
              aria-label={`${page} 페이지`}
              className={`${control} ${numberBox}`}
            >
              {page}
            </Link>
          ),
        )}

        {hasNextBunch && (
          <Link
            href={hrefFor(Math.min(totalPages, currentPage + BUNCH))}
            aria-label="다음 페이지 묶음"
            className={`${control} ${squareBox}`}
          >
            <span aria-hidden className="text-xl leading-none">
              ›
            </span>
          </Link>
        )}
      </div>
    </nav>
  )
}
