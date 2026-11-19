/**
 * Gate ③ 식별 디테일 — 판정부
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md §3
 *
 * 🔴 순수 함수다. DB · LLM · 파일 IO · 네트워크 없음.
 * 🔴 반환값에 원문 조각을 담지 않는다. 걸린 값을 그대로 담으면 그것이 곧 식별 정보다 — 카테고리 코드 · 개수만이다.
 */

export type IdentStatus = 'pass' | 'review' | 'regenerate'

// ══ ③ 식별 디테일 ═══════════════════════════════════
//
// 🔴 단일 카테고리는 허용한다. "집 근처 병원" · "50대 초반" 은 특정되지 않는다.
//    위험한 것은 **결합**이다 — 2개 review · 3개 이상 regenerate(§3-③).

export type IdentCategory =
  | 'REGION'    // 시·구·동·읍·면
  | 'HOSPITAL'  // 병원 · 의원 · 한의원
  | 'SCHOOL'    // 학교 · 대학
  | 'COMPANY'   // 회사 · 지점
  | 'DATE'      // 구체 날짜
  | 'AGE_EXACT' // 정확한 나이 · 년생
  | 'MONEY'     // 금액
  | 'FAMILY'    // 가족 특이 조합
  | 'DISEASE'   // 병명

export type IdentVerdict = {
  status: IdentStatus
  /** 🔴 카테고리 코드만. 걸린 값은 담지 않는다 */
  categories: IdentCategory[]
  detail: string
}

/** 🔴 "50대 초반" 같은 밴드는 통과시킨다 — 그건 특정되지 않는다 */
const IDENT_PATTERNS: ReadonlyArray<{ cat: IdentCategory; re: RegExp }> = [
  { cat: 'REGION', re: /[가-힣]{2,4}(시|구|동|읍|면)(\s|$|[.,)·])/u },
  { cat: 'HOSPITAL', re: /(병원|의원|한의원|보건소)/u },
  { cat: 'SCHOOL', re: /(초등학교|중학교|고등학교|대학교|\b대학\b)/u },
  { cat: 'COMPANY', re: /(회사|지점|본사|공장)/u },
  { cat: 'DATE', re: /([0-9]{1,2}\s*월\s*[0-9]{1,2}\s*일|[0-9]{4}\s*년\s*[0-9]{1,2}\s*월)/u },
  { cat: 'AGE_EXACT', re: /([0-9]{2}\s*세(?![대기])|[0-9]{2,4}\s*년생)/u },
  { cat: 'MONEY', re: /([0-9,]+\s*(원|만원|억|천만))/u },
  { cat: 'FAMILY', re: /((첫째|둘째|셋째)\s*(딸|아들|애)|시어머니|시아버지|며느리|사위)/u },
  { cat: 'DISEASE', re: /(당뇨|고혈압|갑상선|류마티스|우울증|치매|골다공증|디스크|협심증|뇌졸중|백내장|녹내장|공황장애|암\b)/u },
]

export function checkIdentifyingDetail(candidateText: string): IdentVerdict {
  const text = candidateText ?? ''
  const categories = IDENT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.cat)
  const n = categories.length
  const status: IdentStatus = n >= 3 ? 'regenerate' : n === 2 ? 'review' : 'pass'
  return {
    status, categories,
    // 🔴 카테고리 이름만. 매치한 문자열은 절대 담지 않는다
    detail: n === 0 ? '식별 디테일 없음' : `${n}개 결합 — ${categories.join(' · ')}`,
  }
}
