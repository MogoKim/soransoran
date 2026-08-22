/** 글쓰기 정책. 서버 액션과 글쓰기 폼이 같은 값을 본다. */
export const MIN_POST_TITLE_LENGTH = 2
export const MAX_POST_TITLE_LENGTH = 120
export const MIN_POST_CONTENT_LENGTH = 10
export const MAX_POST_CONTENT_LENGTH = 5000

export const POST_TITLE_PLACEHOLDER = '어떤 이야기인가요?'
export const POST_CONTENT_PLACEHOLDER = '짧게 써도 괜찮습니다.'

export const POST_TITLE_TOO_SHORT = '제목을 조금만 더 적어주세요.'
export const POST_TITLE_TOO_LONG = `제목은 ${MAX_POST_TITLE_LENGTH}자까지 쓸 수 있어요.`
export const POST_CONTENT_TOO_SHORT = '내용을 조금만 더 적어주세요.'
export const POST_CONTENT_TOO_LONG = `내용은 ${MAX_POST_CONTENT_LENGTH}자까지 쓸 수 있어요.`
