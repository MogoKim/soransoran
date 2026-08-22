/** 댓글 입력 정책. 서버 액션과 입력 폼이 같은 값을 본다. */
export const MIN_COMMENT_LENGTH = 2
export const MAX_COMMENT_LENGTH = 500

export const COMMENT_PLACEHOLDER = '댓글을 남겨보세요.'
export const COMMENT_TOO_SHORT = '댓글을 조금만 더 적어주세요.'
export const COMMENT_TOO_LONG = `댓글은 ${MAX_COMMENT_LENGTH}자까지 쓸 수 있어요.`

/** 입력창 자동 확장 상한(px). 넘으면 내부 스크롤. */
export const COMMENT_TEXTAREA_MAX_HEIGHT = 160

export const COMMENT_CREATED = '댓글이 등록됐어요.'

/** 글자수는 상한이 가까워질 때만 보여준다. */
export const COMMENT_COUNTER_FROM = 400
export const COMMENT_COUNTER_WARN_FROM = 480
