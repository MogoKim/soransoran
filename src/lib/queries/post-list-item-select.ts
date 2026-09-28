/**
 * PostListItem 이 그리는 한 줄에 필요한 만큼만. 홈 인기글 · 베스트 · 이어읽기가 쓴다.
 *
 * 이 줄은 미리보기도 작성자도 그리지 않는다. 게시판 목록용 select 를 그대로 쓰면
 * 본문과 작성자를 후보 수만큼 읽어 전부 버리게 된다.
 *
 * 댓글 수는 화면 표시와 홈 인기 점수가 함께 쓰므로 뺄 수 없다.
 * (/best 순위는 이 숫자를 쓰지 않는다 — Persona 댓글이 섞여 있다. best-ranking.ts)
 *
 * 🔴 따로 떼어 둔 이유: queries/posts.ts 는 auth 를 가져온다. queries/best.ts 는
 *    격리 DB 검사 스크립트가 직접 부르므로 이 select 만 가볍게 가져가야 한다.
 */
export const POST_LIST_ITEM_SELECT = {
  id: true,
  title: true,
  boardType: true,
  createdAt: true,
  viewCount: true,
  _count: { select: { comments: { where: { isDeleted: false } } } },
} as const
