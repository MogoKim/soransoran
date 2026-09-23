import RelatedMagazineLink from '@/components/features/RelatedMagazineLink'
import { SLOT_LABEL, type RelatedMagazineItem } from '@/lib/magazine-graph'

/**
 * 🔴 그림을 싣지 않는다 — 연관 글은 같은 분류에서 오고, 그림이 없는 글이 섞인다.
 * 🔴 목록 카드를 쓰지 않는다 — 본문이 이미 흰 면 위에 있다. 카드 안에 카드를 넣지 않는다.
 *
 * 🔴 화면은 그래프를 모른다. 무엇을 왜 골랐는지는 resolver 가 정하고,
 *    여기는 받은 순서대로 그린다. 그래야 그래프를 꺼도 이 파일이 그대로 산다.
 *
 * 🔴 **목록 공통 graphVersion 을 받지 않는다.** 한 목록에 지정 관계와 보충이 섞이므로
 *    공통값을 모든 클릭에 붙이면 보충 클릭이 그래프 성과로 잡힌다.
 *
 * 🔴 **서버 컴포넌트로 남는다.** 계측은 줄 하나(RelatedMagazineLink)만 클라이언트다.
 *    목록 전체를 내리면 글 데이터가 통째로 브라우저까지 간다.
 */
export default function RelatedMagazineList({
  items,
  fromSlug,
}: {
  items: RelatedMagazineItem[]
  fromSlug: string
}) {
  if (items.length === 0) return null
  return (
    <section className="mt-8 border-t border-subtle pt-6">
      <h2 className="text-lg font-bold text-content-primary">함께 읽어보세요</h2>
      <ul className="mt-2 flex flex-col [&>li+li]:border-t [&>li+li]:border-subtle">
        {items.map(({ article, relationType, surface, slot, reason, source, position, graphVersion }) => (
          <li key={article.slug}>
            <RelatedMagazineLink
              slug={article.slug}
              title={article.title}
              cluster={article.cluster}
              publishedAt={article.publishedAt}
              fromSlug={fromSlug}
              relationType={relationType}
              surface={surface}
              slot={slot}
              /* 🔴 보충에는 슬롯 문구를 주지 않는다 — 슬롯인 척하면 화면이 거짓말을 한다 */
              slotLabel={slot ? SLOT_LABEL[slot] : null}
              reason={reason}
              source={source}
              position={position}
              /* 🔴 목록 공통값이 아니라 **이 줄의** 버전이다 */
              graphVersion={graphVersion}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
