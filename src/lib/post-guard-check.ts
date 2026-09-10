/**
 * 글 하나를 콘텐츠 가드로 재는 **단 하나의 순서**.
 *
 * 🔴 서버와 화면이 같은 함수를 부른다.
 *    한쪽만 제목을 먼저 보거나, 한쪽만 본문을 빼먹으면 "버튼은 열렸는데 서버는 막는"
 *    (또는 그 반대의) 상태가 된다. 순서까지 여기 한 곳에 둔다 — 제목 다음 본문이다.
 *
 * 🔴 문구도 여기서 만든다. 서버가 만든 문장과 화면이 만든 문장이 다르면
 *    같은 위반을 두 가지로 말하게 된다.
 *
 * 🔴 검사할 **평문은 부르는 쪽이 준다.**
 *    서버는 postContentToText(HTML) 을, 화면은 에디터가 준 글자를 넘긴다.
 *    두 값이 완전히 같지는 않다(블록 사이 공백 처리가 다르다) — 그래서
 *    화면 검사는 **미리 알려주는 편의**이고, 저장을 막는 최종 판정은 서버다.
 *    화면이 통과시켜도 서버가 다시 보고, 그 결과가 다시 이 모양으로 화면에 붙는다.
 */
import {
  checkContent,
  hasAdCombo,
  hasOutboundChannel,
  type ContentGuardIssue,
} from '@/lib/content-guard'
import { postGuardMessage, type PostField } from '@/lib/post-guard-message'

export type PostGuardBlock = {
  field: PostField
  code: ContentGuardIssue['code']
  message: string
  /** 실제로 걸린 표현. 차단 표현일 때만 온다 */
  matchedText?: string
  /** 넘긴 문자열 기준 위치 — 제목은 이 값으로 구간을 선택한다 */
  start?: number
  end?: number
}

function toBlock(field: PostField, issue: ContentGuardIssue): PostGuardBlock {
  return {
    field,
    code: issue.code,
    message: postGuardMessage(field, issue),
    ...(issue.code === 'BLOCKED_EXPRESSION'
      ? { matchedText: issue.matchedText, start: issue.start, end: issue.end }
      : {}),
    ...(issue.code === 'EXCESSIVE_REPEAT' ? { start: issue.start, end: issue.end } : {}),
  }
}

/**
 * 제목과 본문을 이을 때 끼우는 구분자.
 *
 * 🔴 그냥 붙이면 제목 끝 글자와 본문 첫 글자가 한 낱말이 된다 —
 *    제목 "…코인" + 본문 "리딩방…" 이 "코인리딩방" 으로 읽혀 없던 위반이 생긴다.
 * 🔴 공백이나 줄바꿈으로는 부족하다. `수익\s*보장` 처럼 `\s*` 를 품은 패턴이
 *    그것을 그대로 건너뛰어 제목 끝 "수익" 과 본문 첫 "보장" 을 이어 붙인다.
 *    그래서 **공백이 아닌 글자**를 끼운다.
 */
const FIELD_SEPARATOR = '\n—\n'

/**
 * 막을 것이 있으면 **첫 번째 하나**를 돌려준다. 없으면 null.
 *
 * 🔴 둘 다 보고하지 않는다. 사람은 한 번에 한 군데를 고친다 —
 *    제목과 본문을 함께 띄우면 어디부터 손대야 할지 고르는 일이 하나 더 는다.
 *    하나를 고치면 다음 것이 그 자리에 나타난다.
 */
export function checkPostContent({
  title,
  text,
}: {
  title: string
  text: string
}): PostGuardBlock | null {
  const titleGuard = checkContent(title, { isTitle: true, audience: 'user' })
  if (!titleGuard.ok && titleGuard.issue) return toBlock('title', titleGuard.issue)

  const contentGuard = checkContent(text, { audience: 'user' })
  if (!contentGuard.ok && contentGuard.issue) return toBlock('content', contentGuard.issue)

  /**
   * 🔴 광고 조합만은 **글 한 편 전체**를 다시 본다.
   *    칸마다 따로 보면 세 신호가 한 번도 같이 서지 않아 그대로 새어 나갔다 —
   *      제목 "리딩방 가입 안내"  ③판 + ②모집만 있다 (제목에는 링크를 못 넣는다)
   *      본문 "https://spam.example"  ①통로만 있다
   *    사람 눈에는 명백한 한 편의 광고인데 기계는 두 조각으로 나눠 보고 있었다.
   *
   * 🔴 나머지 규칙은 칸마다 그대로 둔다. 제목 링크 금지·본문 링크 상한·연락처·도배는
   *    "이 칸이 지금 이렇다" 는 판정이라 이어 붙이면 뜻이 바뀐다
   *    (본문 2개 + 제목 0개를 합쳐 3개로 세는 식이 된다).
   */
  if (hasAdCombo(`${title}${FIELD_SEPARATOR}${text}`)) {
    /**
     * 🔴 어느 칸을 말해 줄지 — **통로가 있는 칸**이다.
     *    조합을 깨는 가장 확실한 손질이 링크·오픈채팅을 지우는 일이고,
     *    그것이 실제로 놓인 자리가 고칠 자리다. 제목에는 링크를 아예 넣을 수 없으니
     *    통로가 제목에 서는 경우는 오픈채팅 언급뿐이고, 그 밖에는 언제나 본문이다.
     */
    const field: PostField = hasOutboundChannel(text) ? 'content' : 'title'
    return toBlock(field, { code: 'AD_COMBO' })
  }

  return null
}
