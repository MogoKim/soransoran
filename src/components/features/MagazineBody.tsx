import Image from 'next/image'
import Link from 'next/link'
import type { MagazineArticle, MagazineBlock } from '@/content/magazine/types'

/** 커뮤니티 상세 본문과 같은 가독성 기준 */
const TEXT_CLASS = 'break-keep leading-[1.85] text-content-primary [overflow-wrap:anywhere]'

const MEDICAL_NOTICE =
  '이 글은 정보 제공을 위한 것이며 의학적 진단이나 치료를 대신하지 않습니다. 증상이 있다면 의료진과 상담하세요.'

function Block({ block }: { block: MagazineBlock }) {
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
            href={block.href}
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
        <Block key={`${block.type}-${index}`} block={block} />
      ))}

      {article.medical ? (
        <p className="mt-8 border-t border-subtle pt-4 text-sm text-content-muted">
          {MEDICAL_NOTICE}
        </p>
      ) : null}
    </div>
  )
}
