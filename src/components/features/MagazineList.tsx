'use client'

import { useMemo, useState } from 'react'
import MagazineCard from '@/components/features/MagazineCard'
import {
  MAGAZINE_CLUSTER_LABELS,
  type MagazineArticle,
  type MagazineCluster,
} from '@/content/magazine/types'

const ALL = 'all' as const

/**
 * 매거진 목록 — 분류 칩과 목록을 함께 둔다.
 *
 * 🔴 칩은 실제 글이 있는 분류만 만든다. 여덟 개를 다 세우면
 *    눌러서 빈 화면을 보는 칩이 생긴다.
 *
 * 거르는 일은 이미 받아 온 배열 안에서 끝난다 — 서버를 다시 부르지 않는다.
 */
export default function MagazineList({ articles }: { articles: MagazineArticle[] }) {
  const [cluster, setCluster] = useState<MagazineCluster | typeof ALL>(ALL)

  const clusters = useMemo(() => {
    const seen = new Set<MagazineCluster>()
    for (const article of articles) seen.add(article.cluster)
    return [...seen]
  }, [articles])

  const shown = cluster === ALL ? articles : articles.filter((a) => a.cluster === cluster)

  return (
    <>
      {clusters.length > 1 ? (
        <div
          role="group"
          aria-label="분류"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {[ALL, ...clusters].map((key) => {
            const active = key === cluster
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setCluster(key)}
                /* 🔴 바탕이 밝아지면서 흰 면만으로는 칩 모양이 서지 않는다 — 바탕과 1.04:1 이다.
                   그래서 쉬는 칩에만 실선을 준다. 한 줄로 늘어선 알약이라 격자로는 읽히지 않는다.
                   고른 칩은 면으로 서니 선을 얹지 않는다 — 선과 면을 겹쳐 두 번 강조하지 않는다. */
                className={`inline-flex min-h-[52px] shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm transition duration-150 active:scale-[0.98] ${
                  active
                    ? 'bg-surface-soft font-bold text-brand-ink'
                    : 'border border-subtle bg-surface-card font-medium text-content-primary hover:bg-surface-soft'
                }`}
              >
                {key === ALL ? '전체' : MAGAZINE_CLUSTER_LABELS[key]}
              </button>
            )
          })}
        </div>
      ) : null}

      <ul className="flex list-none flex-col gap-3 p-0">
        {shown.map((article) => (
          <li key={article.slug}>
            <MagazineCard article={article} />
          </li>
        ))}
      </ul>
    </>
  )
}
