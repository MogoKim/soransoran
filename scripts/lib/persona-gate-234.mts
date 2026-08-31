/**
 * Gate ② 고유 표현 · ③ 식별 디테일 · ④ 구조 과복제 — 판정부
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md §3
 *
 * 🔴 순수 함수다. DB · LLM · 파일 IO · 네트워크 없음.
 *    ② 의 코퍼스 빈도는 **인자로 받는다** — 조회는 호출부의 책임이다.
 *
 * 🔴 반환값에 원문 조각을 담지 않는다. 코드 · 개수 · 길이만이다.
 *    ③ 은 특히 위험하다 — 걸린 값을 그대로 담으면 그것이 곧 식별 정보다.
 */

export type Gate234Status = 'pass' | 'review' | 'regenerate'

// ══ ② 고유 표현 / 특이 조어 ══════════════════════════
//
// 🔴 20자 룰(①)로 못 잡는 것을 잡는다. "남의편" 은 3글자라 ① 을 통과하지만
//    그 사람의 말버릇이면 복제해서는 안 된다.
//
// 🔴 코퍼스는 생성물 종류에 따라 다르다(§3-②).
//    댓글 생성물을 본문 코퍼스로 재면 "고생하셨어요"(댓글 69건 · 본문 0건)가
//    고유 표현으로 잡힌다. 그래서 빈도 조회를 인자로 받고,
//    어느 코퍼스인지도 함께 받아 로그에 남긴다.

/** n-gram 하나의 코퍼스 빈도를 돌려준다. 🔴 호출부가 댓글 코퍼스를 붙인다 */
export type FrequencyLookup = (ngram: string) => number

export type RarityBand = 'rare' | 'mid' | 'common'

/** §3-② 판정 3단 — 0~1 rare · 2~5 mid · 6+ common */
export function rarityOf(freq: number): RarityBand {
  if (freq <= 1) return 'rare'
  if (freq <= 5) return 'mid'
  return 'common'
}

export type UniqueExpressionVerdict = {
  status: Gate234Status
  /** source 와 겹치는 n-gram 중 희귀도별 개수 — 🔴 문자열이 아니라 개수다 */
  rare: number
  mid: number
  common: number
  /** 검사한 n-gram 수. 0 이면 판정이 성립하지 않는다 */
  checked: number
  corpus: string
  detail: string
}

const NGRAM_MIN = 3
const NGRAM_MAX = 10

/** 공백 제거 후 n-gram 집합 — ① 과 같은 정규화를 쓴다 */
function ngramsOf(text: string, min = NGRAM_MIN, max = NGRAM_MAX): Set<string> {
  const flat = [...text.replace(/\s+/g, '')]
  const out = new Set<string>()
  for (let n = min; n <= max; n++) {
    for (let i = 0; i + n <= flat.length; i++) out.add(flat.slice(i, i + n).join(''))
  }
  return out
}

/**
 * ② 판정 — source 와 후보가 **공유하는** n-gram 만 본다.
 *
 * 🔴 후보 전체의 희귀 표현을 보는 것이 아니다. 그러면 페르소나의 고유한 말투까지
 *    잡힌다. 잡아야 할 것은 "source 에서 가져온 희귀 표현" 이다.
 */
export function checkUniqueExpression(
  candidateText: string,
  sourceTexts: readonly string[],
  lookup: FrequencyLookup,
  corpus = 'comment',
): UniqueExpressionVerdict {
  const cand = ngramsOf(candidateText)
  const src = ngramsOf(sourceTexts.join('\n'))
  const shared: string[] = []
  for (const g of cand) if (src.has(g)) shared.push(g)

  // 🔴 짧은 것이 긴 것에 포함되면 긴 쪽만 센다 — 같은 표현을 여러 번 세지 않는다
  const maximal = shared
    .sort((a, b) => b.length - a.length)
    .filter((g, i, arr) => !arr.slice(0, i).some((longer) => longer.includes(g)))

  let rare = 0, mid = 0, common = 0
  for (const g of maximal) {
    const band = rarityOf(lookup(g))
    if (band === 'rare') rare++
    else if (band === 'mid') mid++
    else common++
  }

  const status: Gate234Status = rare > 0 ? 'regenerate' : mid > 0 ? 'review' : 'pass'
  return {
    status, rare, mid, common, checked: maximal.length, corpus,
    // 🔴 n-gram 문자열을 담지 않는다 — 그것이 곧 원문 조각이다
    detail: maximal.length === 0
      ? 'source 와 공유하는 표현 없음'
      : `공유 ${maximal.length} (희귀 ${rare} · 중간 ${mid} · 일반 ${common}) · ${corpus} 코퍼스`,
  }
}

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
  status: Gate234Status
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
  const status: Gate234Status = n >= 3 ? 'regenerate' : n === 2 ? 'review' : 'pass'
  return {
    status, categories,
    // 🔴 카테고리 이름만. 매치한 문자열은 절대 담지 않는다
    detail: n === 0 ? '식별 디테일 없음' : `${n}개 결합 — ${categories.join(' · ')}`,
  }
}

// ══ ④ 구조 과복제 ═══════════════════════════════════
//
// 🔴 ① 과 역할이 다르다.
//      ①  문자열이 그대로 남았는가        (연속 20자)
//      ④  문장을 다 바꿔도 순서가 같은가  (전개 단위)
//    ④ 는 표현이 전부 달라도 걸릴 수 있고, ① 은 순서가 달라도 걸린다.
//
// 🔴 흔한 구조는 막지 않는다. "병원 갔다 → 검사했다 → 기다린다" 는
//    누가 써도 비슷하다. 막으면 아무 글도 못 쓴다(§3-④).

export type StructureVerdict = {
  status: Gate234Status
  /** 순서까지 같은 전개 단위 수 */
  matchedSteps: number
  /** 그중 일반 구조로 걸러진 수 */
  commonSteps: number
  detail: string
}

/** 🔴 일반 구조 사전 — 여기 있는 전개는 순서가 같아도 세지 않는다 */
const COMMON_STEPS: readonly RegExp[] = [
  /병원.*(가|갔|다녀)/u, /검사/u, /기다/u, /속상|힘들|답답/u,
  /시간이\s*지나/u, /괜찮아지/u, /걱정/u, /고민/u,
]

/** 전개 단위 추출 — 문장 부호와 줄바꿈으로 자른다 */
function stepsOf(text: string): string[] {
  return text
    .split(/[.!?\n]|(?<=다)\s+(?=[가-힣])/u)
    .map((s) => s.trim())
    .filter((s) => [...s].length >= 4)
}

/** 두 전개 단위가 같은 사건을 가리키는가 — 어절 겹침으로 본다 */
function sameStep(a: string, b: string): boolean {
  const wa = new Set(a.split(/\s+/).filter((w) => [...w].length >= 2))
  const wb = new Set(b.split(/\s+/).filter((w) => [...w].length >= 2))
  if (wa.size === 0 || wb.size === 0) return false
  let hit = 0
  for (const w of wa) if (wb.has(w)) hit++
  return hit / Math.min(wa.size, wb.size) >= 0.5
}

export function checkStructureCopy(
  candidateText: string,
  sourceTexts: readonly string[],
): StructureVerdict {
  const cand = stepsOf(candidateText)
  const src = stepsOf(sourceTexts.join('\n'))
  if (cand.length === 0 || src.length === 0) {
    return { status: 'pass', matchedSteps: 0, commonSteps: 0, detail: '전개 단위 부족 — 판정 생략' }
  }

  // 🔴 순서를 지키며 매칭한다. 순서가 다르면 구조 복제가 아니다
  let si = 0
  let matched = 0
  let common = 0
  for (const c of cand) {
    for (let j = si; j < src.length; j++) {
      if (sameStep(c, src[j])) {
        // 🔴 흔한 전개는 세지 않는다
        if (COMMON_STEPS.some((re) => re.test(c))) common++
        else matched++
        si = j + 1
        break
      }
    }
  }

  const status: Gate234Status = matched >= 4 ? 'regenerate' : matched >= 3 ? 'review' : 'pass'
  return {
    status, matchedSteps: matched, commonSteps: common,
    detail: matched === 0
      ? `고유 전개 일치 없음${common > 0 ? ` (일반 구조 ${common} 제외)` : ''}`
      : `고유 전개 ${matched}개가 같은 순서${common > 0 ? ` · 일반 구조 ${common} 제외` : ''}`,
  }
}
