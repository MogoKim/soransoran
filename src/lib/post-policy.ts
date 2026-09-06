/** 글쓰기 정책. 서버 액션과 글쓰기 폼이 같은 값을 본다. */
export const MIN_POST_TITLE_LENGTH = 2
export const MAX_POST_TITLE_LENGTH = 120
export const MIN_POST_CONTENT_LENGTH = 10
export const MAX_POST_CONTENT_LENGTH = 5000

export const POST_TITLE_PLACEHOLDER = '제목을 입력해 주세요'
export const POST_CONTENT_PLACEHOLDER = '어떤 이야기를 나누고 싶으세요?'

export const POST_TITLE_TOO_SHORT = '제목을 조금만 더 적어주세요.'
export const POST_TITLE_TOO_LONG = `제목은 ${MAX_POST_TITLE_LENGTH}자까지 쓸 수 있어요.`
export const POST_CONTENT_TOO_SHORT = '내용을 조금만 더 적어주세요.'
export const POST_CONTENT_TOO_LONG = `내용은 ${MAX_POST_CONTENT_LENGTH}자까지 쓸 수 있어요.`

/**
 * 글이 그 자리에 없을 때 — 공감·스크랩·댓글·수정·삭제가 모두 이 한 문장을 쓴다.
 *
 * 🔴 사유별로 가르지 않는다. 없는 글 · 내려간 글 · 지운 글 · 게시판이 다른 글이
 *    전부 같은 문장이어야 한다 — 다르게 말하면 **무엇이 존재하는지 알려주는 통로**가 된다
 *    (`actions/posts.ts` 의 같은 판단을 문구 쪽에서 지킨다).
 *    "이미 지워졌어요" 가 더 정확한 자리(`actions/delete.ts`)에서도 이 문장을 쓴다.
 *
 * 🔴 "찾을 수 없다" 로 끝내지 않는다. 막힌 자리에 **갈 곳**이 있어야 한다 (정본 §12-20).
 */
export const POST_NOT_FOUND = '글을 찾을 수 없어요. 목록으로 돌아가 다시 확인해 주세요.'

/**
 * 왜 아직 올릴 수 없는가 — 화면이 사람에게 하는 말.
 *
 * 🔴 잠긴 버튼만 두면 고장으로 읽힌다. 무엇이 모자란지 그 자리에서 말한다.
 * 🔴 서버가 되돌려 주는 문장(POST_*_TOO_SHORT)과 다른 자리다.
 *    저쪽은 "보냈는데 안 됐다", 이쪽은 "아직 보낼 수 없다" 다.
 */
export const POST_BLOCK_UPLOADING = '사진을 올리는 중이에요'
export const POST_BLOCK_TITLE = '제목을 입력해 주세요'
export const POST_BLOCK_CONTENT = `내용을 ${MIN_POST_CONTENT_LENGTH}자 이상 입력해 주세요`
export const POST_BLOCK_CONTENT_LONG = POST_CONTENT_TOO_LONG

export type PostSubmitBlock =
  | 'UPLOADING'
  | 'TITLE'
  | 'CONTENT'
  | 'CONTENT_LONG'

const BLOCK_MESSAGE: Record<PostSubmitBlock, string> = {
  UPLOADING: POST_BLOCK_UPLOADING,
  TITLE: POST_BLOCK_TITLE,
  CONTENT: POST_BLOCK_CONTENT,
  CONTENT_LONG: POST_BLOCK_CONTENT_LONG,
}

export function postBlockMessage(block: PostSubmitBlock): string {
  return BLOCK_MESSAGE[block]
}

/**
 * 올릴 수 있는가. 없으면 무엇 때문인가.
 *
 * 🔴 규칙을 여기 하나만 둔다. 새 글 폼과 고치기 폼이 각자 적으면
 *    언젠가 한쪽만 고쳐진다 — 서버(actions/posts.ts)와도 같은 순서로 본다.
 *
 * 🔴 사진만 올린 글도 보낼 수 있다. 글자가 짧아도 할 말을 한 것이다.
 *    단 사진 판정은 서버와 같아야 한다 — 올리는 중인 blob: 미리보기는
 *    사진으로 세지 않는다. 그걸 세면 "버튼은 열렸는데 서버가 막는" 상태가 된다.
 */
export function postSubmitBlock(input: {
  uploading: boolean
  title: string
  textLength: number
  hasImage: boolean
}): PostSubmitBlock | null {
  if (input.uploading) return 'UPLOADING'
  if (input.title.trim().length < MIN_POST_TITLE_LENGTH) return 'TITLE'
  if (!input.hasImage && input.textLength < MIN_POST_CONTENT_LENGTH) return 'CONTENT'
  if (input.textLength > MAX_POST_CONTENT_LENGTH) return 'CONTENT_LONG'
  return null
}

/** 본문 입력창 자동 확장 상한(px). 넘으면 내부 스크롤. */
export const POST_TEXTAREA_MAX_HEIGHT = 360

/** 본문 글자수는 상한이 가까워질 때만 보여준다. */
export const POST_CONTENT_COUNTER_FROM = 4000
export const POST_CONTENT_COUNTER_WARN_FROM = 4800
