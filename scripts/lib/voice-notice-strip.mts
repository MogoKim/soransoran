/**
 * 카페 공지 문구 제거 — **side effect 가 없는 순수 함수만** 둔다
 *
 * 🔴 왜 필요한가
 *    우나어 본문 33,031행 중 1,575건(4.8%)에 카페 운영자 공지 문구가 딸려 들어왔다.
 *    VE-M3 분석 대상 9,411건 기준으로는 503건(5.34%)이다.
 *    창업자 판단 — **"카페 공지가 딸려온 것 같고 나머지는 좋다"**.
 *    즉 **글을 버리는 것이 아니라 문구만 잘라낸다.**
 *
 * 🔴 왜 이 정규식 하나인가 (실측)
 *    - `배려하는 마음으로 예쁜 글` 1,575건 · `💗` 로 감싼 형태 1,568건
 *    - **하트 없는 변형 0건** — 이 패턴 하나로 100% 포착된다
 *    - 위치는 앞 80자 내 1,452건(92%) · 뒤쪽 200자 내 1,220건(77%) — 글을 감싼다.
 *      그래서 위치 기반이 아니라 패턴 기반으로 지운다
 *
 * 🔴 왜 다른 이모지는 건드리지 않는가 (실측)
 *    ♡ ★ ✅ ✨ 등으로 감싼 블록은 104건인데 **85% 가 공지인지 강조인지 판정 불가**였다.
 *    ♡ · ♥ 18건 중 5건은 회원의 감정 표현이고, 학습 후보에 든 것은 **3건(0.25%)** 뿐이다.
 *    지우면 얻는 것은 없고 **회원 말투를 손상한다.**
 */

/**
 * 🔴 `{0,60}` 상한이 핵심이다.
 *    상한이 없으면 하트가 두 개 이상인 글에서 **본문 전체를 삼킨다.**
 *    실측 공지 블록 길이는 30~50자 범위라 60 이면 충분하다.
 *    fixture 가 이 상한을 검사한다.
 */
const CAFE_NOTICE = /💗[^💗]{0,60}💗/g

/** 제거 대상이 아닌 이모지 — fixture 가 "이것들은 남는가" 를 검사한다 */
export const NOT_STRIPPED_EMOJI = ['♡', '♥', '★', '☆', '✅', '✔', '✨', '➡', '☞', '♣'] as const

/**
 * 카페 공지 문구를 제거하고 앞뒤 공백을 정리한다.
 * 🔴 원문의 다른 부분은 한 글자도 바꾸지 않는다 — 오타 · 줄바꿈 · 이모티콘은 자산이다.
 */
export function stripCafeNotice(content: string): string {
  return content.replace(CAFE_NOTICE, '').trim()
}

/** 공지 문구가 들어 있는가 (제거하지 않고 판정만) */
export function hasCafeNotice(content: string): boolean {
  return /💗[^💗]{0,60}💗/.test(content)
}

/**
 * 제거 결과를 길이와 함께 돌려준다.
 * - `cleaned.length === 0` → 공지만 있던 글. **오염 제외**
 * - `cleaned.length < 300` → voice/style 후보에서 탈락 (story 는 200 기준)
 */
export function stripWithLength(content: string): { cleaned: string; originalLength: number; cleanedLength: number; hadNotice: boolean } {
  const hadNotice = hasCafeNotice(content)
  const cleaned = stripCafeNotice(content)
  return { cleaned, originalLength: content.length, cleanedLength: cleaned.length, hadNotice }
}
