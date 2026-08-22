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

export type GuardResult = { ok: true } | { ok: false; reason: string }

const OK: GuardResult = { ok: true }

/** URL 개수 — 링크 도배 판정용 */
function countUrls(text: string): number {
  return (text.match(/https?:\/\/|www\./gi) ?? []).length
}

/** 같은 문자가 과도하게 반복되는지 (ㅋㅋㅋㅋ… 같은 정상 표현은 허용 범위를 넉넉히 둔다) */
function hasExcessiveRepeat(text: string): boolean {
  return /(.)\1{19,}/.test(text)
}

export function checkContent(text: string, { isTitle = false } = {}): GuardResult {
  const value = text.trim()
  if (!value) return OK

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(value)) {
      return { ok: false, reason: '사용할 수 없는 표현이 있습니다. 다시 적어주세요.' }
    }
  }

  for (const pattern of CONTACT_PATTERNS) {
    if (pattern.test(value)) {
      return {
        ok: false,
        reason: '연락처나 외부 대화방 주소는 남길 수 없습니다.',
      }
    }
  }

  if (countUrls(value) >= (isTitle ? 1 : 3)) {
    return { ok: false, reason: '링크가 너무 많습니다.' }
  }

  if (hasExcessiveRepeat(value)) {
    return { ok: false, reason: '같은 글자가 너무 많이 반복됩니다.' }
  }

  return OK
}
