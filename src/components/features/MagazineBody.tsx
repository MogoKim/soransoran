import Image from 'next/image'
import Link from 'next/link'
import type { MagazineArticle, MagazineBlock } from '@/content/magazine/types'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'

/** 커뮤니티 상세 본문과 같은 가독성 기준 */
const TEXT_CLASS = 'break-keep leading-[1.85] text-content-primary [overflow-wrap:anywhere]'

const MEDICAL_NOTICE =
  '이 글은 정보 제공을 위한 것이며 의학적 진단이나 치료를 대신하지 않습니다. 증상이 있다면 의료진과 상담하세요.'

/**
 * CTA 목적지를 클릭 진단선(/api/go/...)으로 바꾼다.
 *
 * 원고 데이터(articles.ts)의 href 는 '/community/menopause' 그대로 둔다.
 * 여기서 렌더할 때만 감싸므로, 되돌릴 일이 생기면 이 함수 하나만 지우면 된다.
 *
 * 🔴 href 를 문자열로 쪼개지 않는다.
 *    보드 레지스트리(SSoT)의 href 와 정확히 일치하는 항목만 찾는다.
 *    일치하지 않으면 원래 href 를 그대로 쓰지 않고 매거진으로 되돌린다 —
 *    알 수 없는 목적지를 CTA 로 내보내는 쪽이 더 위험하다.
 */
function ctaHref(articleSlug: string, rawHref: string): string {
  const board = COMMUNITY_BOARDS.find((b) => b.href === rawHref)
  if (!board) return '/magazine'
  return `/api/go/${articleSlug}/${board.slug}`
}

function Block({ block, articleSlug }: { block: MagazineBlock; articleSlug: string }) {
  switch (block.type) {
    case 'h2':
      return <h2 className="mt-8 text-xl font-bold text-content-primary">{block.text}</h2>
    case 'h3':
      return <h3 className="mt-6 text-lg font-bold text-content-primary">{block.text}</h3>
    case 'list':
      return block.ordered ? (
        <ol className={`mt-3 flex list-decimal flex-col gap-2 pl-5 ${TEXT_CLASS}`}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className={`mt-3 flex list-disc flex-col gap-2 pl-5 ${TEXT_CLASS}`}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )
    case 'callout':
      return <p className={`mt-4 rounded-lg bg-surface-soft p-4 ${TEXT_CLASS}`}>{block.text}</p>
    case 'cta':
      return (
        <div className="mt-8 border-t border-subtle pt-6">
          {block.text ? <p className={TEXT_CLASS}>{block.text}</p> : null}
          <Link
            href={ctaHref(articleSlug, block.href)}
            className="mt-3 inline-flex min-h-[52px] items-center rounded-lg bg-cta px-6 font-bold text-cta-text no-underline"
          >
            {block.label}
          </Link>
        </div>
      )
    case 'image':
      return (
        <Image
          src={block.image.src}
          alt={block.image.alt}
          width={block.image.width}
          height={block.image.height}
          className="mt-5 h-auto w-full rounded-lg"
        />
      )
    default:
      return <p className={`mt-4 ${TEXT_CLASS}`}>{block.text}</p>
  }
}

export default function MagazineBody({ article }: { article: MagazineArticle }) {
  return (
    <div>
      {article.body.map((block, index) => (
        <Block key={`${block.type}-${index}`} block={block} articleSlug={article.slug} />
      ))}

      {article.medical ? (
        <p className="mt-8 border-t border-subtle pt-4 text-sm text-content-muted">
          {MEDICAL_NOTICE}
        </p>
      ) : null}
    </div>
  )
}
