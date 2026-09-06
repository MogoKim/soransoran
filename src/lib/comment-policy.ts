/** 댓글 입력 정책. 서버 액션과 입력 폼이 같은 값을 본다. */
export const MIN_COMMENT_LENGTH = 2
export const MAX_COMMENT_LENGTH = 500

export const COMMENT_PLACEHOLDER = '댓글을 남겨보세요.'
export const COMMENT_TOO_SHORT = '댓글을 조금만 더 적어주세요.'
export const COMMENT_TOO_LONG = `댓글은 ${MAX_COMMENT_LENGTH}자까지 쓸 수 있어요.`

/** 입력창 자동 확장 상한(px). 넘으면 내부 스크롤. */
export const COMMENT_TEXTAREA_MAX_HEIGHT = 160

/**
 * 성공 안내 문구 — 🔴 컴포넌트에 리터럴로 흩뿌리지 않는다.
 *    톤을 고칠 때 호출부를 전부 찾아다니게 된다.
 *    말투는 '-어요' 로 맞추고, '완료' 같은 기계적인 말을 쓰지 않는다.
 */
export const COMMENT_CREATED = '댓글이 등록됐어요.'
export const REPLY_CREATED = '답글이 등록됐어요.'
export const COMMENT_UPDATED = '댓글을 고쳤어요.'
export const REPORT_RECEIVED = '신고가 접수됐어요.'
/**
 * 신고 폼이 사라진 자리에 남는 한 줄.
 * 🔴 토스트와 같은 말을 반복하지 않는다 — 접수됐다는 사실은 토스트가 이미 알렸다.
 *    여기 남는 것은 '이 폼은 끝났다' 는 상태 표시다.
 */
export const REPORT_REVIEW_HINT = '운영자가 확인할게요.'
/**
 * 이미 신고한 대상을 다시 신고했을 때.
 *
 * 🔴 `REPORT_RECEIVED` 를 쓰지 않는다. 중복 신고는 **새 접수를 만들지 않는다** —
 *    저장되지 않은 일을 접수됐다고 말하면 신고 기능 자체를 못 믿게 된다.
 * 🔴 알리는 것은 **본인의 중복**뿐이다. 다른 사람이 이 글을 신고했는지는 말하지 않는다.
 */
export const REPORT_ALREADY = '이미 신고하셨어요. 운영자가 확인하고 있어요.'

/**
 * 댓글이 그 자리에 없을 때 — 공감·수정·삭제·답글·비회원 경로가 모두 이 한 문장을 쓴다.
 *
 * 🔴 사유별로 가르지 않는다. 없는 댓글 · 지운 댓글 · 글이 내려간 댓글 · 주소가 어긋난 댓글이
 *    전부 같은 문장이어야 한다 — 다르게 말하면 무엇이 존재하는지 알려주는 통로가 된다.
 * 🔴 다음 행동은 "새로고침" 이다. 댓글은 글 안에 있으므로 목록으로 보내지 않는다
 *    (`POST_NOT_FOUND` 와 다음 행동이 갈리는 이유).
 */
export const COMMENT_NOT_FOUND = '댓글을 찾을 수 없어요. 글을 새로고침한 뒤 다시 시도해 주세요.'

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
