/**
 * Persona **No-Go 판정 하나** — 🔴 순수 함수 (2026-10-01 · Phase 2B)
 *
 *   카드 파서 · 카드 검증 · 생성 프롬프트 · 댓글 Gate(⑦⑧) · 글 배정 Gate(`hardFilter`)가 **이 파일만** 부른다.
 *
 * 🔴 왜 하나인가. 카드는 말버릇을 `"우리 때는"` · `"요즘 애들" 류` 처럼 따옴표와 `류` 를 붙여 적고,
 *    DB 에는 그 표기가 그대로 들어간 사람(7명)과 벗겨진 사람(2명)이 섞여 있다. Gate 는 `text.includes(값)` 로
 *    봤기 때문에 따옴표 붙은 값은 본문에 따옴표가 없으면 **한 번도 걸리지 않았다**(죽은 게이트 · 2026-10-01 실측).
 *    🔴 저장값은 바꾸지 않는다. 비교할 때만 같은 열쇠로 바꾼다.
 *
 * 🔴 **전원 공통 금지(Pool §7-2)는 여기서 강제한다** — 사람마다 복제 저장하지 않는다.
 *    그래서 개인 `noGoExpressions` 가 빈 Persona 도 공통 금지에는 똑같이 걸린다.
 *    §7-2 의 나머지 — 브랜드 금지어 · 타겟 설명어(Gate ⑤ `persona-gate-forbidden-address`) ·
 *    외부 커뮤니티 호칭(Gate ⑨ `persona-gate-source-marker`)은 그 Gate 가 이미 막는다. 여기서 다시 적지 않는다.
 *    "과도한 존댓말 일관성 · 이모지 남용" 은 판정 규칙이 정본에 없다 — 수치를 지어내지 않는다.
 */

/** 🔴 카드 `noGo` 줄의 항목이 말버릇(표현)인가 — 따옴표로 감싼 것만 표현이다. 나머지는 소재다 */
export function isNoGoExpressionItem(item: string): boolean {
  return /["“”]/.test(item)
}

/**
 * 🔴 **말버릇 비교 열쇠** — 바깥 따옴표와 끝의 `류`(= 비슷한 말 포함)를 벗긴다.
 *    `"우리 때는"` · `우리 때는` · `"요즘 애들" 류` → `우리 때는` · `우리 때는` · `요즘 애들`
 */
export function noGoExpressionKey(e: string): string {
  return e.trim().replace(/\s*류$/, '').replace(/^["“”']+|["“”']+$/g, '').trim()
}

/** 🔴 Pool §7-2 전원 공통 — 글자 그대로 나오면 안 되는 말 */
export const COMMON_NO_GO_PHRASES: readonly string[] = Object.freeze(['추천드립니다', '도움이 되셨으면 좋겠습니다'])

/**
 * 🔴 Pool §7-2 전원 공통 — 정리된 문서 모양(불릿 · 번호 · 마크다운 · 먼저/다음으로/마지막으로 구조화).
 *    사람의 수다는 줄머리에 기호를 달지 않는다. 순서말은 **둘 이상**이 함께 나올 때만 구조화로 본다 —
 *    `먼저` 하나는 일상 말이다.
 */
const STRUCTURE_LINE: readonly { code: string; re: RegExp }[] = [
  { code: 'bullet', re: /^\s*[-*•·]\s+\S/m },
  { code: 'numbered', re: /^\s*\d{1,2}[.)]\s+\S/m },
  { code: 'heading', re: /^\s*#{1,6}\s+\S/m },
  { code: 'bold', re: /\*\*[^*\n]+\*\*/ },
]
const SEQUENCE_WORDS = ['먼저', '다음으로', '마지막으로'] as const

export function commonNoGoHits(text: string): string[] {
  const hits: string[] = []
  for (const p of COMMON_NO_GO_PHRASES) if (text.includes(p)) hits.push(`phrase:${p}`)
  for (const s of STRUCTURE_LINE) if (s.re.test(text)) hits.push(`structure:${s.code}`)
  if (SEQUENCE_WORDS.filter((w) => text.includes(w)).length >= 2) hits.push('structure:sequence')
  return hits
}

export type NoGoHits = { topics: string[]; expressions: string[]; common: string[] }

/**
 * 🔴 **본문 No-Go 판정** — 소재는 적힌 그대로, 말버릇은 열쇠로, 공통은 언제나 본다.
 *    빈 값은 건너뛴다(빈 문자열은 모든 본문에 들어 있다).
 */
export function noGoHits(text: string, persona: { noGoTopics?: readonly string[]; noGoExpressions?: readonly string[] }): NoGoHits {
  const topics = (persona.noGoTopics ?? []).map((t) => t.trim()).filter((t) => t !== '' && text.includes(t))
  const expressions = (persona.noGoExpressions ?? []).map(noGoExpressionKey).filter((k) => k !== '' && text.includes(k))
  return { topics, expressions, common: commonNoGoHits(text) }
}

export const anyNoGo = (h: NoGoHits): boolean => h.topics.length + h.expressions.length + h.common.length > 0

/**
 * 🔴 **프롬프트에 싣는 말버릇** — 개인(열쇠) + 공통 문구. 중복 없이 적힌 순서대로.
 *    구조 금지(불릿 · 번호 · 마크다운)는 프롬프트의 형식 규칙이 따로 말한다.
 */
export function promptNoGoExpressions(personal: readonly string[]): string[] {
  return [...new Set([...personal.map(noGoExpressionKey).filter((k) => k !== ''), ...COMMON_NO_GO_PHRASES])]
}
