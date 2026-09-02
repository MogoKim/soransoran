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

/**
 * 많이 공감한 댓글 — 위로 한 번 더 올려 보여줄 기준.
 *
 * 🔴 공감 1건을 "많이" 라고 부르지 않는다. 댓글이 적은 서비스에서 문턱을 1로 두면
 *    거의 모든 댓글이 올라와, 올려 보여주는 일 자체가 의미를 잃는다.
 */
export const POPULAR_COMMENT_MIN_LIKES = 3
/** 댓글이 몇 개는 쌓여야 "고를" 일이 생긴다. 셋 중 둘을 고르는 것은 고르는 게 아니다. */
export const POPULAR_COMMENT_MIN_COMMENTS = 5
export const POPULAR_COMMENT_TAKE = 2

/** 정렬을 고르게 할 최소 댓글 수. 둘뿐인데 탭이 있으면 탭이 댓글보다 커 보인다. */
export const COMMENT_SORT_TABS_MIN = 3

/** 지워진 부모 자리에 남는 말. 답글이 어디에 딸린 것인지 알려 주는 표시다. */
export const DELETED_COMMENT = '삭제된 댓글입니다.'
