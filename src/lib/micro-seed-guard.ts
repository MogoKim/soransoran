import { checkContent, BRAND_BANNED_WORDS, type GuardResult } from './content-guard'

/**
 * Micro Seed 전용 콘텐츠 가드
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-9-B · §6-2
 *
 * 🔴 왜 checkContent 로 부족한가
 *    checkContent 는 **회원이 쓴 글**을 검사한다. 브랜드 금지어(시니어·어르신·노인·실버)를
 *    보지 않는데, 그건 의도다 — 회원이 자기 말로 "어르신" 이라고 쓰는 것까지 막으면
 *    오탐으로 첫 글을 잃는다(content-guard.ts 주석 참조).
 *
 *    Micro Seed 는 다르다. **원문을 그대로 우리 이름으로 발행한다**(§6-2).
 *    §6-9-B 는 "발행 주체가 우리이므로 우리 기준을 적용한다. 원문이 그랬다는 것은
 *    근거가 되지 않는다" 고 못박는다. 그래서 여기서만 브랜드 규칙을 더한다.
 *
 * 🔴 checkContent 를 재구현하지 않는다 (C-2)
 *    금칙어 패턴의 유일한 지점은 content-guard.ts 다. 여기서는 그 결과를 받아
 *    **감싸기만** 한다. 패턴을 베껴 두면 두 곳이 갈라져 "한쪽은 통과, 한쪽은 차단" 이 된다.
 *
 * 🔴 content-guard.ts 를 수정하지 않는다
 *    수정하면 posts.ts · comments.ts 의 사용자 글 경로가 함께 바뀐다.
 *    적용 범위를 넓히는 것은 이 파일이 존재하는 이유 자체를 무너뜨린다.
 */

/** 브랜드 금지어에 걸린 사유 문구 — 창업자 holdReason 으로 들어간다 */
export function brandBannedReason(word: string): string {
  return `브랜드 금지어가 있습니다: "${word}". 우리 이름으로 나가는 글이므로 원문 그대로 쓸 수 없습니다.`
}

/**
 * Micro Seed 후보용 검사 = 사용자 글 검사 + 브랜드 금지어.
 *
 * 적용 대상은 발행될 값이다 — founderTitle 과 rawBody(본문).
 * 원문 제목(originalTitle)은 발행되지 않으므로 검사하지 않는다.
 *
 * @param text    검사할 문자열
 * @param isTitle 제목이면 링크 허용 개수가 달라진다 (checkContent 규칙)
 */
export function checkMicroSeedContent(
  text: string,
  { isTitle = false }: { isTitle?: boolean } = {},
): GuardResult {
  // ① 사용자 글과 같은 기준을 먼저 통과해야 한다. 여기서 걸리면 그대로 돌려준다 —
  //    사유를 다시 쓰면 같은 위반이 두 가지 문구로 보고된다.
  const base = checkContent(text, { isTitle })
  if (!base.ok) return base

  // ② 브랜드 금지어 (§6-9-B).
  //    🔴 단순 포함 검사다. content-guard 의 욕설 패턴처럼 `\s*` 우회 방어를 넣지 않는다 —
  //       원문 작성자가 우리 브랜드 규칙을 우회할 이유가 없고, 과한 패턴은 오탐만 늘린다.
  const value = text.trim()
  for (const word of BRAND_BANNED_WORDS) {
    if (value.includes(word)) {
      return { ok: false, reason: brandBannedReason(word) }
    }
  }

  return { ok: true }
}

/**
 * 후보 하나를 검사해 validator 의 `contentGuard` 입력을 만든다.
 *
 * 제목과 본문 중 **먼저 걸린 것**을 돌려준다. 둘 다 보고할 필요가 없다 —
 * 하나라도 걸리면 G-B 가 HOLD 이고, 창업자는 걸린 지점부터 고치면 된다.
 */
export function guardMicroSeedCandidate({
  founderTitle,
  content,
}: {
  founderTitle?: string | null
  content?: string | null
}): GuardResult {
  if (typeof founderTitle === 'string' && founderTitle.trim()) {
    const titleGuard = checkMicroSeedContent(founderTitle, { isTitle: true })
    if (!titleGuard.ok) return titleGuard
  }

  if (typeof content === 'string' && content.trim()) {
    const bodyGuard = checkMicroSeedContent(content)
    if (!bodyGuard.ok) return bodyGuard
  }

  return { ok: true }
}
