import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import MagazineCard from '@/components/features/MagazineCard'
import { buildMagazineListHref, MAGAZINE_ALL_CLUSTER } from '@/lib/list-query'
import type { MagazineListCluster } from '@/lib/magazine'
import { MAGAZINE_CLUSTER_LABELS, type MagazineArticle } from '@/content/magazine/types'

type MagazineListProps = {
  /** 지금 쪽에 실을 글. 거르기·자르기는 resolveMagazineList 가 이미 끝냈다 */
  articles: MagazineArticle[]
  /** 칩으로 세울 분류 — 공개 글 전체 기준이다 */
  clusters: MagazineListCluster[]
  /** 지금 고른 분류. 정규화된 값이라 칩에 없는 분류가 오지 않는다 */
  activeCluster: MagazineListCluster
  /** 매거진 목록 주소. board-registry 의 href 를 그대로 받는다 */
  basePath: string
}

/**
 * 매거진 목록 — 분류 칩과 글 목록.
 *
 * 🔴 **칩은 링크다.** 예전에는 `useState` 로 고른 분류를 컴포넌트 안에 들고 있었다.
 *    화면은 바뀌는데 주소는 그대로라 고른 분류를 **주고받을 수도, 새로고침할 수도,
 *    뒤로 돌아갈 수도 없었다.** 쪽 이동이 붙으면 그 결함이 더 커진다 —
 *    분류는 state 이고 쪽은 주소이면 둘이 따로 놀아 "수면 2쪽" 이라는 상태를
 *    주소 하나로 표현할 수 없다. 그래서 분류도 주소로 올렸다.
 *
 * 🔴 그 결과 이 컴포넌트는 **서버 컴포넌트**다. 고르는 일이 이동이라 브라우저에서
 *    다시 그릴 것이 없다. 매거진 본문 배열이 client 번들로 갈 경로도 함께 사라졌다.
 *
 * 🔴 분류를 바꾸면 쪽이 떨어진다. `buildMagazineListHref` 에 page 를 넘기지 않는 것이
 *    그 방법이다 — 3쪽에서 수면을 눌렀을 때 3쪽에 머무르면 방금 고른 분류의
 *    맨 앞을 보지 못한 채 전혀 다른 글 묶음이 나온다.
 */
export default function MagazineList({
  articles,
  clusters,
  activeCluster,
  basePath,
}: MagazineListProps) {
  return (
    <>
      {clusters.length > 1 ? (
        <nav
          aria-label="분류"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {[MAGAZINE_ALL_CLUSTER as MagazineListCluster, ...clusters].map((key) => {
            const active = key === activeCluster
            return (
              <Link
                key={key}
                href={buildMagazineListHref(basePath, { cluster: key })}
                /* 🔴 'page' 가 아니라 'true' 다. 'page' 는 "여러 쪽 중 지금 쪽" 을 뜻하고
                   그 집합은 아래 쪽 이동이다. 여기는 분류의 집합이다. */
                aria-current={active ? 'true' : undefined}
                /* 🔴 바탕이 밝아지면서 흰 면만으로는 칩 모양이 서지 않는다 — 바탕과 1.04:1 이다.
                   그래서 쉬는 칩에만 실선을 준다. 한 줄로 늘어선 알약이라 격자로는 읽히지 않는다.
                   고른 칩은 면으로 서니 선을 얹지 않는다 — 선과 면을 겹쳐 두 번 강조하지 않는다. */
                className={`inline-flex ${TOUCH_MIN} shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm no-underline transition duration-150 active:scale-[0.98] ${
                  active
                    ? 'bg-surface-soft font-bold text-brand-strong'
                    : 'border border-subtle bg-surface-card font-medium text-content-primary hover:bg-surface-soft'
                }`}
              >
                {key === MAGAZINE_ALL_CLUSTER ? '전체' : MAGAZINE_CLUSTER_LABELS[key]}
              </Link>
            )
          })}
        </nav>
      ) : null}

      <ul className="flex list-none flex-col gap-3 p-0">
        {articles.map((article) => (
          <li key={article.slug}>
            <MagazineCard article={article} />
          </li>
        ))}
      </ul>
    </>
  )
}
