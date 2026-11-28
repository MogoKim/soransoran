import Image from 'next/image'
import { Fragment } from 'react'
import { BRAND_NAME } from '@/lib/brand-name'
import { TOUCH_MIN } from '@/lib/spacing'
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
          {/* 🔴 이 CTA 는 라벨이 길다. "크게" 에서 한 줄에 안 들어가므로 두 줄을 허용한다 —
                 문구를 줄이지 않고 높이가 자라게 둔다(min-h 52px 는 하한일 뿐이다).
                 items-center 만으로는 두 줄이 왼쪽으로 몰려 보여 가운데 정렬을 함께 건다. */}
          {/* 이 주소는 GET 요청을 게시판 이동으로 기록하므로 클릭할 때 탐색하는 일반 링크를 쓴다. */}
          <a
            href={ctaHref(articleSlug, block.href)}
            className={`mt-3 inline-flex ${TOUCH_MIN} items-center justify-center rounded-lg bg-cta px-6 py-2 text-center text-lg font-bold leading-snug text-cta-content no-underline transition duration-150 hover:brightness-95 active:scale-95`}
          >
            {block.label}
          </a>
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

function MagazineBrandBanner({ src }: { src: string }) {
  return (
    <aside aria-label={`${BRAND_NAME} 소개`} className="my-7 overflow-hidden rounded-xl border border-subtle bg-surface-soft sm:flex">
      <div className="relative aspect-[3/1] sm:aspect-auto sm:w-1/3">
        <Image src={src} alt="" fill sizes="(min-width: 640px) 220px, 100vw" className="object-cover" />
      </div>
      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <p className="break-keep text-lg font-bold leading-snug text-content-primary">자매처럼 편하게, 속마음까지 {BRAND_NAME}.</p>
        <p className="mt-2 break-keep text-content-primary">고민과 일상을 눈치 보지 않고 나눠요.</p>
        <Link href="/" className={`mt-3 inline-flex ${TOUCH_MIN} items-center justify-center rounded-lg bg-cta px-5 py-2 text-center text-lg font-bold text-cta-content`}>
          {BRAND_NAME} 둘러보기
        </Link>
      </div>
    </aside>
  )
}

/** 첫 CTA 앞에서 중간에 가장 가까운 절을 고른다. 짧은 글이나 이미지가 없는 글에는 넣지 않는다. */
function bannerIndex(body: MagazineBlock[]) {
  const firstCta = body.findIndex(block => block.type === 'cta')
  const length = firstCta < 0 ? body.length : firstCta
  if (length < 2) return -1
  const mid = length / 2
  let best = -1
  for (let i = 1; i < length; i++) {
    if (body[i].type === 'h2' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i
  }
  if (best >= 0) return best
  for (let i = Math.ceil(mid); i < length; i++) {
    if (body[i - 1].type !== 'h2' && body[i - 1].type !== 'h3') return i
  }
  return -1
}

export default function MagazineBody({ article }: { article: MagazineArticle }) {
  const bannerAt = article.heroImage ? bannerIndex(article.body) : -1
  return (
    <div>
      {article.body.map((block, index) => (
        <Fragment key={`${block.type}-${index}`}>
          {index === bannerAt && article.heroImage ? <MagazineBrandBanner src={article.heroImage.src} /> : null}
          <Block block={block} articleSlug={article.slug} />
        </Fragment>
      ))}

      {article.medical ? (
        <p className="mt-8 border-t border-subtle pt-4 text-sm text-content-muted">
          {MEDICAL_NOTICE}
        </p>
      ) : null}
    </div>
  )
}
