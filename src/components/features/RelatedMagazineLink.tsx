'use client'

/**
 * 연관 글 한 줄 — 마크업은 예전 그대로고, 본 사실과 누른 사실만 덧붙여 센다.
 *
 * 🔴 이 파일이 따로 있는 이유는 계측 하나 때문이다.
 *    목록(RelatedMagazineList)은 서버 컴포넌트로 남는다. 계측을 위해 목록 전체를
 *    클라이언트로 내리면 글 데이터가 통째로 브라우저까지 내려간다.
 *
 * 🔴 그래서 **글 객체를 받지 않는다.** 화면에 그리는 값만 받는다.
 *    MagazineArticle 을 그대로 넘기면 body 블록 배열까지 RSC 페이로드에 직렬화된다 —
 *    보이지도 않는 본문 세 편을 매 요청 실어 나르는 일이다.
 *
 * 🔴 계측이 이동을 막지 않는다.
 *    · trackEvent 는 gtag 가 없으면 아무 일도 안 하고, 전송이 던져도 안에서 삼킨다
 *    · IntersectionObserver 가 없는 브라우저면 노출을 세지 않을 뿐 화면은 그대로다
 *    · sessionStorage 가 막혀도 깊이만 1로 세질 뿐 이동은 정상이다
 *    · preventDefault 를 쓰지 않으므로 Link 의 이동은 계측과 무관하게 일어난다
 */
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import type { MagazineRecommendationSlot } from '@/content/magazine/graph/types'
import { MAGAZINE_CLUSTER_LABELS, type MagazineCluster } from '@/content/magazine/types'
import type { MagazineRelatedParams } from '@/lib/analytics/events'
import { shouldSendImpression } from '@/lib/analytics/magazine-impression-log'
import { recordRelatedClick } from '@/lib/analytics/magazine-read-depth'
import { trackEvent } from '@/lib/analytics/track'
import { formatMagazinePublishedDate } from '@/lib/magazine-date'
import type {
  MagazineRelationSurface,
  MagazineRelationType,
  RelatedMagazineSource,
} from '@/lib/magazine-graph'
import { TITLE_CARD } from '@/lib/typography'

export type RelatedLinkProps = {
  slug: string
  title: string
  cluster: MagazineCluster
  publishedAt: string
  fromSlug: string
  relationType: MagazineRelationType
  surface: MagazineRelationSurface
  /** 🔴 그래프가 고른 줄만 슬롯을 갖는다. 보충은 null */
  slot: MagazineRecommendationSlot | null
  /** 슬롯 문구. 보충은 null — 슬롯인 척하지 않는다 */
  slotLabel: string | null
  /** 🔴 검증된 그래프 문구. 런타임에서 만들지 않는다. 보충은 null */
  reason: string | null
  source: RelatedMagazineSource
  position: number
  /** 🔴 **이 줄의** 버전이다. 목록 공통값이 아니다 — 보충은 'none' */
  graphVersion: string
}

export default function RelatedMagazineLink({
  slug,
  title,
  cluster,
  publishedAt,
  fromSlug,
  relationType,
  surface,
  slot,
  slotLabel,
  reason,
  source,
  position,
  graphVersion,
}: RelatedLinkProps) {
  const ref = useRef<HTMLAnchorElement | null>(null)

  const params: MagazineRelatedParams = {
    slug: fromSlug,
    target_slug: slug,
    relation_type: relationType,
    surface,
    recommendation_slot: slot ?? 'none',
    recommendation_source: source,
    position,
    graph_version: graphVersion,
  }

  /**
   * 🔴 **화면에 실제로 들어왔을 때만** 센다.
   *    렌더되자마자 세면 스크롤을 내리지 않은 사람까지 분모에 들어가
   *    클릭률이 실제보다 낮게 나온다.
   *
   * 🔴 **중복 제거는 sessionStorage 가 한다** (magazine-impression-log).
   *    여기 지역 변수로만 막으면 재마운트·뒤로가기·재방문에서 전부 뚫린다.
   *    관측을 끊는 것은 같은 인스턴스 안의 재발화를 줄이는 최적화일 뿐,
   *    "세션당 1회" 를 지키는 것은 저장소다.
   */
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') return // 🔴 없으면 세지 않는다. 화면은 그대로다

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          io.disconnect()
          // 🔴 저장소가 막혀도 true 를 준다 — fail-open. 렌더·이동을 막지 않는다.
          if (
            shouldSendImpression({
              graphVersion: params.graph_version,
              fromSlug: params.slug,
              targetSlug: params.target_slug,
              source: params.recommendation_source,
              slot: params.recommendation_slot,
            })
          ) {
            trackEvent('magazine_related_impression', params)
          }
        }
      },
      // 절반이 보여야 "봤다" 로 센다 — 가장자리에 1px 걸친 것은 본 게 아니다
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => io.disconnect()
    // params 는 렌더마다 새 객체지만 값은 같다. 항목이 바뀌면 key 가 바뀌어 다시 마운트된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Link
      ref={ref}
      href={`/magazine/${slug}`}
      className="group flex min-h-[72px] items-center gap-3 py-3 no-underline"
      onClick={() =>
        trackEvent('magazine_related_click', {
          ...params,
          // 🔴 누른 그 순간에 깊이를 계산하고 다음 글의 깊이를 적어 둔다
          depth: recordRelatedClick(fromSlug, slug),
        })
      }
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span
          className={`line-clamp-2 break-keep ${TITLE_CARD} text-content-primary transition-colors duration-150 group-hover:text-brand-strong group-active:text-brand-strong`}
        >
          {title}
        </span>
        {/* 🔴 그래프가 고른 줄만 이유를 보여 준다. 보충에는 붙이지 않는다 */}
        {reason ? (
          <span className="line-clamp-2 break-keep text-meta text-content-muted">{reason}</span>
        ) : null}
        <span className="flex flex-wrap items-center gap-x-1.5 text-meta text-content-muted">
          {/* 🔴 슬롯 문구가 있으면 분류 앞에 둔다. 보충은 예전과 똑같이 분류만 보인다 */}
          {slotLabel ? (
            <>
              <span
                className={
                  slot === 'BRIDGE_DISCOVERY'
                    ? // 🔴 발견은 직접 연관과 **약하게** 구분한다. 색을 달리하지 않고 무게만 낮춘다
                      'font-normal text-content-muted'
                    : 'font-bold text-brand-strong'
                }
              >
                {slotLabel}
              </span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span className="font-bold text-brand-strong">{MAGAZINE_CLUSTER_LABELS[cluster]}</span>
          <span aria-hidden>·</span>
          {formatMagazinePublishedDate(publishedAt)}
        </span>
      </span>
      <span aria-hidden className="ml-auto shrink-0 text-content-muted">
        →
      </span>
    </Link>
  )
}
