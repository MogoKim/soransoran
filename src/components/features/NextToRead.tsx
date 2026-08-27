import PostListItem, { type PostListItemData } from '@/components/features/PostListItem'

/** 이어읽기에 최대 몇 건을 보여줄지. 더 길면 댓글에서 시선이 멀어진다. */
const TAKE = 3

/**
 * 상세 하단 이어읽기 — 글 하나를 읽고 끝나지 않게 다음 이야기로 잇는다.
 *
 * 🔴 pool 은 discovery 표면이다.
 *    후보 조회는 getRecentDiscoveryPosts(= DISCOVERY_ELIGIBLE_WHERE)를 쓴다.
 *    post-visibility.ts 가 related 를 discovery 표면으로 명시한다 — 게시판 목록과 달리
 *    Micro Seed 는 여기 올라오지 않는다.
 *
 * 🔴 현재 글 제외는 여기서 한다.
 *    쿼리에 제외 인자를 더하지 않고 넉넉히 받아 걸러낸다. 쿼리를 고치면
 *    홈까지 같이 바뀌고, 이 화면 하나 때문에 공용 쿼리를 건드리게 된다.
 *
 * 🔴 추천 사유 라벨("같은 주제" 류)을 붙이지 않는다.
 *    소란소란에는 추천 엔진도 이벤트 트래킹도 없다. 근거가 없는데 이유를 적으면
 *    그 말이 거짓이 된다. 최신 글을 그대로 잇고, 그 사실만 제목으로 말한다.
 */
export default function NextToRead({
  posts,
  currentPostId,
}: {
  posts: PostListItemData[]
  currentPostId: string
}) {
  const next = posts.filter((p) => p.id !== currentPostId).slice(0, TAKE)
  // 보여줄 글이 없으면 빈 제목만 남는다. 아예 렌더하지 않는다.
  if (next.length === 0) return null

  return (
    <section className="mt-10 border-t border-subtle pt-6">
      <h2 className="text-lg font-bold text-content-primary">이어서 읽어보세요</h2>

      {/* 🔴 흰 카드 위에 올린다.
          상세 <main> 은 바탕(회색)이라 여기에 행을 직접 놓으면
          hover 색이 바탕색과 같아져 아무 일도 일어나지 않는다 (globals.css 표면 규칙).
          가로 여백은 행이 자기 px-4 로 가진다. */}
      <ol className="m-0 mt-2 flex list-none flex-col overflow-hidden rounded-2xl border border-subtle bg-surface-card p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
        {next.map((post, index) => (
          <li key={post.id}>
            <PostListItem post={post} rank={index + 1} />
          </li>
        ))}
      </ol>
    </section>
  )
}
