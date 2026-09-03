import Link from 'next/link'
import StatIcon from '@/components/icons/StatIcon'
import { formatRelativeTime } from '@/lib/date'
import { toPreview } from '@/lib/post-html'
import { displayName } from '@/lib/display-name'

export type PostCardData = {
  id: string
  title: string
  content: string
  createdAt: Date
  viewCount: number
  author: { name: string | null; nickname: string | null }
  _count: { comments: number }
}

type PostCardProps = {
  post: PostCardData
  boardHref: string
}

export default function PostCard({ post, boardHref }: PostCardProps) {
  const preview = toPreview(post.content)
  const commentCount = post._count.comments

  return (
    /* 구분선은 목록이 `[&>li+li]` 로 긋는다. 이 <a> 는 <li> 의 유일한 자식이라
       `last:` 가 항상 참이 되어, 여기 두면 선이 한 줄도 그려지지 않는다.

       🔴 hover 는 면을 만들지 않는다 — 제목만 브랜드색으로 반응한다.

       가로 여백은 <main> 의 px-4 가 준다 — 여기서 또 주면 글자가 안쪽으로 밀린다. */
    <Link
      href={`${boardHref}/${post.id}`}
      className="group block py-3.5 no-underline"
    >
      <h3 className="line-clamp-2 break-keep font-medium leading-[1.5] text-content-primary transition-colors duration-150 group-hover:text-brand-ink group-active:text-brand-ink">
        {post.title}
      </h3>

      {/* 🔴 위계는 크기가 아니라 굵기와 색이 만든다 —
          제목(body/500 primary) · 미리보기(caption/400 secondary) · 메타(caption muted).
          제목을 본문 크기에 둔다: 목록은 훑는 화면이라 한 화면에 들어오는 줄 수가
          제목 한 급 키우는 것보다 낫다. 굵기와 색만으로도 제목이 먼저 잡힌다.
          답답함은 행을 줄여서가 아니라 덩어리를 갈라서 푼다 — 그래서 여백은 오히려 늘렸다.

          🔴 굵기·행간은 홈 "지금 뜨는 이야기"(PostListItem)와 같은 값이다 (2026-09-03 · S1-C).
             같은 글이 홈에서는 medium/1.5, 게시판에서는 bold/1.35 로 보이던 것을 맞췄다.
             크기 클래스를 떼어 본문(--text-body)을 그대로 상속한다 — 정본 §12-4.
             ⚠️ 시안 검증용 1차다. 매거진 24px 계열은 손대지 않았다(§12-9). */}
      {preview ? (
        <p className="mt-2 line-clamp-2 break-keep text-xs text-content-secondary">
          {preview}
        </p>
      ) : null}

      {/* 메타는 한 줄이다 — 두 줄이면 행 안에 덩어리가 하나 더 생겨 오히려 빽빽해진다.
          작성자·시간을 한 span 으로 묶어, 줄이 바뀌어도 "누가"와 "언제"가 갈라지지 않게 한다.
          작성자에만 굵기를 줘 "누가 썼는지"가 통계 숫자보다 먼저 잡히게 한다. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-content-muted">
        <span className="flex items-center gap-1.5 font-medium">
          {displayName(post.author)}
          <span aria-hidden>·</span>
          {formatRelativeTime(post.createdAt)}
        </span>
        <span className="flex items-center gap-1">
          <StatIcon name="comment" /> {commentCount}
        </span>
        <span className="flex items-center gap-1">
          <StatIcon name="eye" /> {post.viewCount}
        </span>
      </div>
    </Link>
  )
}
