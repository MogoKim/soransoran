/**
 * Persona 코드 — 🔴 **형식 · 순서의 단일 정본** (2026-10-13)
 *
 * 🔴 왜 한 곳인가.
 *    앞판은 형식 상한(P50 · P99)을 정규식 다섯 곳에, 순서를 문자열 정렬(`.sort()` · `localeCompare`) 열 곳에
 *    따로 적었다. 문자열 정렬은 `P10 < P100 < P11` 이라 세 자리 코드가 섞이는 순간 기존 Persona 의
 *    말투 고정 배정 순번이 밀린다. 300명 이상을 받으려면 둘 다 숫자로 봐야 한다.
 *
 * 🔴 **두 자리 코드끼리는 숫자순 = 사전순이다.** `P01`~`P99` 는 같은 길이 · 같은 접두라 두 순서가 언제나 같다 —
 *    그래서 이 파일로 바꿔도 지금 운영 30명(P01~P32)의 순서 · 배정 · 지문은 그대로다(`persona-code-check` 가
 *    P01~P99 모든 쌍으로 확인한다).
 *
 * 🔴 정본 표기: `P01`~`P99` 는 두 자리(0 채움), `P100` 부터는 0 을 채우지 않는다. `P1` · `P001` 은 코드가 아니다 —
 *    같은 사람을 두 글자로 부르면 중복 검사가 뚫린다.
 */

/**
 * 🔴 **코드 번호 상한 — 단계 확장은 이 값 하나로 연다.** D100 지속 목표(300 이상)에 탈락 · 폐기 코드 여유를 둔다.
 *    올릴 때 바꿀 곳은 여기뿐이다 — 정규식은 표기(0 채움)만 보고 자릿수로 막지 않는다. 상한은 이 값만 정한다.
 */
export const PERSONA_CODE_MAX = 999

const CANONICAL = /^P(0[1-9]|[1-9]\d+)$/

/** `P34` → 34 · Persona 코드 모양(P + 숫자)이 아니면 null — 🔴 정본 표기가 아니어도 번호는 읽는다(비교용) */
export function personaCodeNumber(code: string): number | null {
  const m = /^P(\d+)$/.exec(code)
  return m === null ? null : Number(m[1])
}

/** 🔴 정본 표기이고 1 ~ `PERSONA_CODE_MAX` 안인가 */
export function isPersonaCode(code: string): boolean {
  if (!CANONICAL.test(code)) return false
  const n = personaCodeNumber(code)!
  return n >= 1 && n <= PERSONA_CODE_MAX
}

/** 34 → `P34` · 7 → `P07` · 120 → `P120` */
export function personaCodeOf(n: number): string {
  return `P${String(n).padStart(2, '0')}`
}

/**
 * 🔴 **코드 순서 — 숫자순.** 코드가 아닌 값은 코드 뒤에 사전순으로 둔다(정렬이 깨지지 않게).
 *    같은 번호(`P2` · `P02`)는 문자열로 한 번 더 갈라 결정적으로 만든다.
 */
export function comparePersonaCodes(a: string, b: string): number {
  const x = personaCodeNumber(a)
  const y = personaCodeNumber(b)
  if (x !== null && y !== null) return x - y || (a < b ? -1 : a > b ? 1 : 0)
  if (x !== null) return -1
  if (y !== null) return 1
  return a.localeCompare(b)
}

/** 🔴 새 배열을 돌려준다 — 입력을 바꾸지 않는다 */
export function sortPersonaCodes(codes: Iterable<string>): string[] {
  return [...codes].sort(comparePersonaCodes)
}
