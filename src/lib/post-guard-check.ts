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
import { checkContent, type ContentGuardIssue } from '@/lib/content-guard'
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

  return null
}
