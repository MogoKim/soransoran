/**
 * 글쓰기 화면이 사람에게 하는 말 — 어디가, 왜, 무엇을 고쳐야 하는가.
 *
 * 🔴 content-guard 의 reason 을 그대로 쓰지 않는다.
 *    "사용할 수 없는 표현이 있습니다" 하나로는 제목인지 본문인지도, 어떤 말을 바꿔야
 *    하는지도 알 수 없다. 고객은 글 전체를 눈으로 훑으며 짐작해야 했다.
 *    사유(code)와 자리(field)를 받아 문장을 여기서 만든다.
 *
 * 🔴 문구를 파싱해 사유를 되짚는 코드를 만들지 않는다.
 *    이 파일은 code → 문장 **한 방향**이다. 반대로 가는 길을 열면
 *    문구를 고치는 날 로직이 조용히 끊긴다.
 *
 * 🔴 금칙어 목록을 알려주지 않는다.
 *    지금 입력에서 실제로 걸린 표현 하나만 말한다. 목록을 보여주면 우회하는 법을
 *    같이 알려주는 셈이고, 애초에 고객이 알아야 할 것은 "이 말을 바꾸면 된다" 뿐이다.
 *
 * 🔴 연락처는 걸린 값을 되풀이하지 않는다.
 *    전화번호·카톡 아이디를 화면에 다시 띄우면 지우라고 하면서 한 번 더 노출한다.
 *    종류와 자리를 말하는 것으로 충분하다.
 */
import { MAX_BODY_LINKS, type ContentGuardIssue } from '@/lib/content-guard'

/** 글쓰기 화면에서 막힐 수 있는 자리 */
export type PostField = 'title' | 'content'

const FIELD_LABEL: Record<PostField, string> = {
  title: '제목',
  content: '본문',
}

/**
 * 받침 유무로 '이/가' 를 고른다.
 *
 * 🔴 '지랄이' 와 '좆이' 는 맞지만 아무 말에나 '이' 를 붙이면 어색해진다.
 *    걸리는 표현이 늘어날 수 있으므로 글자로 판정한다 — 목록을 손으로 관리하지 않는다.
 */
function subjectParticle(word: string): '이' | '가' {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  // 한글 음절이 아니면(숫자·영문·기호) 받침이 있는 것으로 읽히는 쪽이 덜 어색하다
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return '이'
  return (code - 0xac00) % 28 === 0 ? '가' : '이'
}

/**
 * 화면에 띄울 문장.
 *
 * @param field 제목인가 본문인가 — 반드시 말해 준다. 이것이 이번 작업의 핵심이다.
 */
export function postGuardMessage(field: PostField, issue: ContentGuardIssue): string {
  const where = FIELD_LABEL[field]

  switch (issue.code) {
    case 'BLOCKED_EXPRESSION': {
      const word = issue.matchedText
      return `${where}에서 사용할 수 없는 표현 ‘${word}’${subjectParticle(word)} 발견됐어요. 해당 표현을 바꿔 주세요.`
    }
    /* 🔴 걸린 번호를 문장에 되풀이하지 않는다. 지우라고 하면서 한 번 더 노출하는 일이 된다 */
    case 'CONTACT_PHONE':
      return `${where}에 전화번호가 포함되어 있어요. 전화번호를 지워 주세요.`
    /* 🔴 걸린 아이디도 마찬가지다. 종류와 자리만 말한다 */
    case 'CONTACT_EXTERNAL_ID':
      return `${where}에 외부 연락처 ID는 입력할 수 없어요. 해당 정보를 지워 주세요.`
    case 'TOO_MANY_LINKS':
      return field === 'title'
        ? '제목에는 링크를 넣을 수 없어요. 링크를 지워 주세요.'
        : `본문에는 링크를 ${MAX_BODY_LINKS}개까지만 넣을 수 있어요. 링크를 줄여 주세요.`
    case 'EXCESSIVE_REPEAT':
      return `${where}에 같은 글자가 너무 많이 반복된 부분이 있어요. 해당 부분을 줄여 주세요.`
    /**
     * 🔴 무엇이 걸렸는지 낱말로 짚지 않는다.
     *    막은 것은 '리딩방' 이라는 낱말이 아니라 **가입 안내 + 밖으로 나가는 통로** 의 조합이다.
     *    낱말을 짚으면 "그 단어를 빼면 되는구나" 로 읽혀 실제로는 광고가 그대로 남는다.
     */
    case 'AD_COMBO':
      return `${where}에 광고성 가입·충전 안내와 외부 링크·연락처를 함께 넣을 수 없어요.`
  }
}
