/**
 * Persona Safety Gate ⑤ — 금지 호칭 / 브랜드 금칙어 판정부
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md §3-⑤
 *
 * 🔴 이 판정부는 **두 갈래**를 본다. 하나가 아니다.
 *
 *    갈래 1  TARGET_DESCRIPTOR_TERMS (15) = M3_FORBIDDEN_ADDRESS_TERMS
 *            "우리 또래분들" · "50대 여성" 같은 **타겟 설명어**.
 *            커뮤니티 안에서 사람들은 서로를 설명하지 않는다 — 그냥 부른다.
 *
 *    갈래 2  BRAND_BANNED_WORDS (4)
 *            "시니어" · "어르신" · "노인" · "실버". **브랜드가 쓰지 않는 말**이다.
 *
 *    🔴 갈래 2 는 갈래 1 에 들어 있지 않다. 문서가 오래 하나로 적어 왔고,
 *       그대로 구현하면 페르소나가 "어르신" 이라고 써도 통과한다(PR #214 정정).
 *
 * 🔴 두 갈래를 하나의 배열로 합치지 않는다.
 *    조치는 둘 다 regenerate 로 같지만 **원인이 다르다**:
 *      갈래 1 실패 → 타겟을 설명했다.        프롬프트에서 호칭 지침을 고친다
 *      갈래 2 실패 → 브랜드 금지어를 썼다.    프롬프트에서 어휘를 막는다
 *    합치면 실패 로그만 보고 어느 쪽인지 알 수 없다.
 *
 * 🔴 회원 글의 예외를 건드리지 않는다.
 *    src/lib/micro-seed-guard.ts 는 **회원이 자기 말로 "어르신" 이라 쓰는 것**을
 *    막지 않는다. 그건 의도된 예외이고 그대로 둔다.
 *    이 파일은 **페르소나 생성물** 전용이다 — 운영 생성물이지 회원의 말이 아니다.
 *
 * 🔴 이 파일이 하지 않는 것
 *      · 생성 파이프라인 연결 (판정부일 뿐이다)
 *      · DB 접근 · LLM/API 호출 · 파일 IO · 네트워크
 *      · ⑨ Source Community Marker 판정 — 그건 출처 흔적이고 여기는 브랜드 정책이다
 */
import { TARGET_DESCRIPTOR_TERMS } from './voice-style-signals.mjs'
// 🔴 상수만 가져온다. content-guard.ts 는 수정하지 않는다.
import { BRAND_BANNED_WORDS } from '../../src/lib/content-guard'

/** ⑤ 의 조치는 두 가지뿐이다. 애매한 중간(review)이 없다 — 브랜드 규칙은 협상 대상이 아니다 */
export type ForbiddenAddressStatus = 'pass' | 'regenerate'

export type ForbiddenAddressVerdict = {
  status: ForbiddenAddressStatus
  /** 갈래 1 적중 — 타겟 설명어 */
  targetDescriptors: string[]
  /** 갈래 2 적중 — 브랜드 금지어. 🔴 갈래 1 과 합치지 않는다 */
  brandBannedWords: string[]
  /**
   * 로그용 한 줄. 🔴 **원문 조각을 담지 않는다.**
   * 적중한 상수 항목만 적는다 — Gate 로그가 새 유출 경로가 되면 안 된다.
   */
  reason: string
}

/**
 * 긴 항목부터 찾고, 이미 잡힌 긴 항목에 포함되는 짧은 항목은 건너뛴다.
 *
 * 🔴 없으면 "우리 또래분들" 하나가 "우리 또래" 로도 잡혀 두 건이 된다.
 *    computeCommunityRegister() 가 '82님들' · '82님' 에 쓰는 것과 같은 규칙이다.
 */
function matchLongestFirst(text: string, terms: readonly string[]): string[] {
  const hits: string[] = []
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    if (hits.some((h) => h.includes(term))) continue
    if (text.includes(term)) hits.push(term)
  }
  return hits
}

/**
 * 페르소나 생성물이 ⑤ 를 통과하는지 판정한다.
 *
 * 🔴 순수 함수다. 입력은 문자열 하나뿐이고 부수효과가 없다.
 */
export function checkForbiddenAddress(outputText: string): ForbiddenAddressVerdict {
  const text = outputText ?? ''
  const targetDescriptors = matchLongestFirst(text, TARGET_DESCRIPTOR_TERMS)
  const brandBannedWords = matchLongestFirst(text, BRAND_BANNED_WORDS)

  const parts: string[] = []
  if (targetDescriptors.length > 0) parts.push(`타겟 설명어 ${targetDescriptors.join(' · ')}`)
  if (brandBannedWords.length > 0) parts.push(`브랜드 금지어 ${brandBannedWords.join(' · ')}`)

  return {
    status: parts.length > 0 ? 'regenerate' : 'pass',
    targetDescriptors,
    brandBannedWords,
    reason: parts.length > 0 ? parts.join(' / ') : '금칙어 없음',
  }
}

/** 판정에 쓰인 상수 규모 — 리포트에서 "둘 다 보고 있는가" 를 확인할 때 쓴다 */
export const FORBIDDEN_ADDRESS_LANES = {
  targetDescriptors: TARGET_DESCRIPTOR_TERMS.length,
  brandBannedWords: BRAND_BANNED_WORDS.length,
} as const
