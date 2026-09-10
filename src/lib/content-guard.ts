/**
 * 최소 콘텐츠 가드 — 금칙어 · 스팸 패턴
 *
 * 목적은 완벽한 차단이 아니라 D-day 최소 방어선이다.
 * 오탐으로 실회원의 첫 글을 막는 것이 스팸 몇 건보다 손해이므로,
 * 확실한 것만 막고 애매한 것은 통과시킨다.
 */

/** 서비스 표현 금지어 — 브랜드 규칙 (사용자 글에는 적용하지 않는다) */
export const BRAND_BANNED_WORDS = ['시니어', '어르신', '노인', '실버'] as const

/** 사용자 글에서 차단할 표현 — 욕설·혐오·노골적 광고 */
const BLOCKED_PATTERNS: RegExp[] = [
  // 욕설 (자모 분리·반복 우회 일부 포함)
  /시\s*발|씨\s*발|시\s*팔|병\s*신|개\s*새\s*끼|좆|썅|지\s*랄/i,
  // 성인/불법 광고
  /카\s*지\s*노|바\s*카\s*라|토\s*토\s*사\s*이\s*트|먹\s*튀|조\s*건\s*만\s*남/i,
  // 대출·투자 스팸
  /대\s*출\s*문\s*의|신\s*용\s*불\s*량|작\s*업\s*대\s*출|코\s*인\s*리\s*딩|리\s*딩\s*방/i,
]

/** 연락처 유도 — 커뮤니티 밖으로 빼내려는 시도 */
const CONTACT_PATTERNS: RegExp[] = [
  /카\s*톡\s*[:：]?\s*[a-z0-9_-]{3,}/i,
  /오\s*픈\s*카\s*톡/i,
  /텔\s*레\s*[:：]?\s*@?[a-z0-9_]{4,}/i,
  /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/,
]

/** 본문에 넣을 수 있는 링크 수. 제목은 0개다 */
export const MAX_BODY_LINKS = 2

/**
 * 무엇 때문에 막혔는가 — 화면이 **문구를 읽지 않고** 판단할 수 있게 하는 값.
 *
 * 🔴 문구를 파싱해 사유를 추론하지 않게 하려고 둔다.
 *    한때 화면이 '로그인이 필요합니다.' 같은 문장을 비교해 분기했고,
 *    서버 문구가 바뀌는 날 그 연결이 조용히 끊겼다(PostActionBar 에 같은 기록이 있다).
 *    사유는 code 로, 사람에게 할 말은 message 로 나눈다.
 *
 * 🔴 matchedText 는 **차단 표현일 때만** 준다. 연락처는 주지 않는다 —
 *    전화번호·카톡 아이디를 화면과 로그에 다시 흘리는 일이 된다.
 */
export type ContentGuardIssue =
  | {
      code: 'BLOCKED_EXPRESSION'
      /** 실제로 걸린 문자열. 공백 우회('지 랄')면 그 모양 그대로다 */
      matchedText: string
      /** 넘겨받은 원본 문자열 기준 위치 */
      start: number
      end: number
    }
  | { code: 'CONTACT_INFO' }
  | { code: 'TOO_MANY_LINKS'; count: number; allowed: number }
  | { code: 'EXCESSIVE_REPEAT'; start: number; end: number }

/**
 * 🔴 issue 는 optional 이다.
 *    micro-seed-guard 처럼 `{ ok:false, reason }` 만 만들어 돌려주는 기존 소비자가 있다.
 *    필수로 두면 그쪽이 전부 깨진다 — 넓히는 변경만 하고 기존 계약은 건드리지 않는다.
 */
export type GuardResult =
  | { ok: true }
  | { ok: false; reason: string; issue?: ContentGuardIssue }

const OK: GuardResult = { ok: true }

/** URL 개수 — 링크 도배 판정용 */
function countUrls(text: string): number {
  return (text.match(/https?:\/\/|www\./gi) ?? []).length
}

/**
 * 정규식이 **실제로 문 문자열**과 그 위치를 돌려준다.
 *
 * 🔴 test() 로 걸러 낸 뒤 indexOf 로 다시 찾지 않는다.
 *    패턴은 `지\s*랄` 처럼 공백을 건너뛰므로 원문에는 '지랄' 이라는 연속 문자열이 없다 —
 *    다시 찾으면 못 찾거나 엉뚱한 자리를 가리킨다. exec() 가 이미 답을 들고 있다.
 *
 * 🔴 패턴에 /g 를 붙이지 않는다. lastIndex 가 호출 사이에 남아
 *    같은 입력이 한 번은 걸리고 한 번은 통과하는 상태가 생긴다.
 */
function firstMatch(patterns: RegExp[], value: string): RegExpExecArray | null {
  for (const pattern of patterns) {
    const m = pattern.exec(value)
    if (m) return m
  }
  return null
}

/** 같은 문자가 과도하게 반복되는 자리 (ㅋㅋㅋㅋ… 같은 정상 표현은 허용 범위를 넉넉히 둔다) */
const EXCESSIVE_REPEAT = /(.)\1{19,}/

/**
 * 사용자 글 검사.
 *
 * 🔴 위치는 **넘겨받은 원본** 기준으로 돌려준다.
 *    내부에서 trim() 한 문자열로 재면 앞 공백만큼 어긋나, 화면이 그 값으로
 *    제목 입력칸을 선택했을 때 한 글자씩 밀린 자리를 잡는다.
 *
 * 🔴 reason 문구는 바꾸지 않는다.
 *    댓글·비회원 댓글·인사말·어드민·Micro Seed 가 같은 함수를 쓰고 그 문구를 화면과
 *    보고서에 그대로 띄운다. 이번 작업의 범위는 글쓰기 화면이므로, 더 친절한 문장은
 *    issue 를 받은 쪽이 만든다(post-guard-message.ts).
 */
export function checkContent(text: string, { isTitle = false } = {}): GuardResult {
  const value = text.trim()
  if (!value) return OK

  // trim 으로 잘려 나간 앞쪽 길이. 위치를 원본 기준으로 되돌리는 데 쓴다.
  const offset = text.indexOf(value)

  const blocked = firstMatch(BLOCKED_PATTERNS, value)
  if (blocked) {
    return {
      ok: false,
      reason: '사용할 수 없는 표현이 있습니다. 다시 적어주세요.',
      issue: {
        code: 'BLOCKED_EXPRESSION',
        matchedText: blocked[0],
        start: offset + blocked.index,
        end: offset + blocked.index + blocked[0].length,
      },
    }
  }

  if (firstMatch(CONTACT_PATTERNS, value)) {
    // 🔴 걸린 문자열을 싣지 않는다. 전화번호·카톡 아이디가 화면·로그로 다시 나간다.
    return {
      ok: false,
      reason: '연락처나 외부 대화방 주소는 남길 수 없습니다.',
      issue: { code: 'CONTACT_INFO' },
    }
  }

  const allowed = isTitle ? 0 : MAX_BODY_LINKS
  const count = countUrls(value)
  if (count > allowed) {
    return {
      ok: false,
      reason: '링크가 너무 많습니다.',
      issue: { code: 'TOO_MANY_LINKS', count, allowed },
    }
  }

  const repeat = EXCESSIVE_REPEAT.exec(value)
  if (repeat) {
    return {
      ok: false,
      reason: '같은 글자가 너무 많이 반복됩니다.',
      issue: {
        code: 'EXCESSIVE_REPEAT',
        start: offset + repeat.index,
        end: offset + repeat.index + repeat[0].length,
      },
    }
  }

  return OK
}
