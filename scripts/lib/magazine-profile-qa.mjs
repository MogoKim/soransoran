/**
 * 프로필별 **결정론적 QA** — 코드가 명확히 확인할 수 있는 것만 본다.
 *
 * 🔴 **문장 의미를 AI 가 다시 심사하지 않는다.**
 *    범위·출처·금지사항은 Claude brief 가 주고, 원고는 ChatGPT 가 쓴다.
 *    여기서는 **패턴과 존재 여부**처럼 기계가 틀림없이 판정할 수 있는 것만 확인한다.
 *    새 AI API 를 부르지 않는다.
 *
 * 🔴 실패는 **코드와 문장**을 함께 남긴다 — 재생성 패킷이 그 두 개를 쓴다.
 */

/** 금지 패턴 — 프로필마다 다르다 */
const FORBIDDEN = {
  MEDICAL: [
    { code: 'MED_DIAGNOSIS', label: '진단 확정', re: /(으로|로|이라고) 진단(입니다|됩니다|할 수 있습니다|된다|됩|하면)|진단명은|진단됩니다/ },
    { code: 'MED_TREATMENT', label: '치료·복용 지시', re: /복용하세요|처방받으세요|드시면 됩니다|치료하세요|\d+\s*(mg|밀리그램|정|알)\s*(씩|을|를)?\s*(복용|섭취)/ },
    { code: 'MED_DURATION', label: '치료 기간 지시', re: /(\d+\s*(주|개월|일))\s*(동안)?\s*(복용|치료|드시)/ },
    { code: 'MED_NORMAL_RANGE', label: '정상·비정상 판정', re: /정상 ?(범위|수치)(입니다|이다)|이면 정상(입니다|이다)|비정상(입니다|이다)/ },
    { code: 'MED_GUARANTEE', label: '효과 보장', re: /반드시 (좋아|나아)|완치(됩니다|된다)|100\s*% ?(효과|낫)/ },
  ],
  FINANCIAL: [
    { code: 'FIN_RETURN_GUARANTEE', label: '수익·원금 보장', re: /(수익|원금)(을|이) ?보장|무조건 (이익|수익)|손해 ?(는)? ?없습니다/ },
    { code: 'FIN_AMOUNT_CERTAIN', label: '수령액·세액 단정', re: /(수령액|세액|연금액|환급액)(은|이) ?(정확히|반드시|무조건)|받게 됩니다/ },
    { code: 'FIN_PRODUCT_PUSH', label: '특정 상품 정답화', re: /이 (상품|펀드|보험|카드)(을|를) (드세요|추천|가입하세요)|(가장|제일) 유리한 (상품|펀드)은/ },
    { code: 'FIN_RATE_PROMISE', label: '수익률 제시', re: /연\s*\d+(\.\d+)?\s*%\s*(수익|이자)|수익률(은|이)\s*\d/ },
  ],
  SENSITIVE: [
    { code: 'SEN_EXPLICIT', label: '노골적 묘사', re: /(체위|삽입|애무|전희|오르가|성기)/ },
    { code: 'SEN_NORMALITY', label: '정상·비정상 판정', re: /정상(입니다|이다|이에요)|비정상(입니다|이다)|이면 (정상|비정상)/ },
    { code: 'SEN_BLAME', label: '배우자 비난', re: /남편(이|은) (문제|잘못|나쁜)|아내(가|는) (문제|잘못|나쁜)/ },
    { code: 'SEN_FREQUENCY', label: '빈도 강요', re: /(주에|한 달에)\s*\d+\s*(회|번)(은|이나|정도는)\s*(해야|하는 게)/ },
  ],
  STANDARD: [],
}

/** 공통 금지 — 모든 프로필 */
const COMMON_FORBIDDEN = [
  { code: 'AGE_WORDING', label: '연령 표기', re: /(노인|시니어|어르신|실버)/ },
  { code: 'BRAND_LEAK', label: '타 브랜드 문자열', re: /(우나어|age-doesnt-matter|unao-)/ },
]

/** 있어야 하는 문장 */
const REQUIRED = {
  MEDICAL: [
    /**
     * 🔴 **좁은 규칙은 벽이 된다.** 앞판은 `지속|계속|오래|심하` 가 진료 낱말 **앞 40자 안에**
     *    있어야 통과시켰다. 실제 원고는 "진료에서 먼저 물어보셔도 됩니다" 처럼 쓰는데
     *    그 형태가 전부 막혔다 — gate 를 통과한 3건이 모두 여기서 걸렸다.
     *    요구하는 것은 "독자를 진료로 보내는 문장이 있는가" 하나다.
     */
    { code: 'MED_CARE_LINE', label: '진료·의료진 안내',
      re: /(진료|병원|의료진|전문가|응급)[\s\S]{0,40}(받|가|물어|확인|상담|도움)|(받아보|가 보|물어보|상담해)[\s\S]{0,20}(진료|병원|의료진)/ },
    { code: 'MED_VARIES_LINE', label: '개인차 문장', re: /개인차|사람마다|다를 수 있/ },
  ],
  FINANCIAL: [
    { code: 'FIN_AUTHORITY_LINE', label: '소관 기관 확인 안내',
      re: /(공단|국세청|고용센터|금융감독원|소관 기관|해당 기관|홈택스|정부24)[\s\S]{0,40}(확인|문의|알아보|조회)/ },
    { code: 'FIN_CONDITION_LINE', label: '조건에 따라 다르다', re: /(조건|상황|가입 기간|납입 이력)에 따라|경우에 따라 다르/ },
  ],
  SENSITIVE: [
    { code: 'SEN_VARIES_LINE', label: '경험 차이 문장', re: /사람마다|저마다|다를 수 있|정답(은|이) 없/ },
    { code: 'SEN_NO_PUSH_LINE', label: '강요하지 않는다는 문장', re: /강요|해야 한다고 (말하지|보지) 않|권하지 않/ },
  ],
  STANDARD: [],
}

/**
 * 🔴 **근거 없는 수치 단정** — 재생성 대상이다.
 *
 *    앞판은 여기서 `sources` 를 요구했다. 그런데 `article-draft.ts` 에도
 *    `review.ts` 에도 **`sources` 필드가 없다.** 원고가 아무리 잘 쓰여도
 *    구조적으로 채울 수 없는 것을 요구했고, 그래서 모든 의료·재정 글이
 *    `SOURCE_REQUIRED` 로 막혔다. **충족 불가능한 검사는 관문이 아니라 벽이다.**
 *
 *    🔴 고른 길: **출처 스키마를 새로 만들지 않는다.** (새 AI API·새 필드 0)
 *       대신 "기댈 데 없는 수치 단정" 자체를 **고쳐 쓸 대상**으로 본다.
 *       글이 숫자를 단정하지 않고 "기관마다 다르다 · 확인해 보세요" 로 쓰면 통과한다.
 *       그것이 우리가 독자에게 하려던 말이기도 하다.
 *
 *    ① `SOURCE_TRIGGER` 가 잡는 문장에
 *    ② `HEDGED` 완충이 **같은 문장 안에** 없으면
 *    → `UNSUPPORTED_NUMERIC_CLAIM` (재생성 대상)
 */
const SOURCE_TRIGGER = {
  /**
   * 🔴 **수치가 있을 때만 본다.** `기준(은|이)` 같은 낱말만으로 잡으면
   *    "이 목록은 … 판단하기 위한 **기준이** 아니라 …" 같은 평범한 문장이 걸린다
   *    (실측 오탐). 제도·지침도 **숫자와 함께** 나올 때만 출처가 필요하다.
   */
  MEDICAL: /\d+\s*(%|퍼센트|세|살|개월|주|년|mg|밀리그램|회)/,
  FINANCIAL: /\d+\s*(원|만원|억|%|퍼센트)|(공제|한도|세율)[^\n]{0,12}\d/,
  SENSITIVE: null,
  STANDARD: null,
}
/** 그 문장이 스스로 "단정이 아니다" 라고 말하는가 */
/**
 * 🔴 `확인해`·`문의` 는 뺐다. 그 둘은 **안내**이지 수치를 누그러뜨리는 말이 아니다.
 *    `"50세부터 2년마다 권고되니 의료진에게 **확인해** 보세요"` 가 통과하던 자리다.
 */
const HEDGED = /(다를 수|다르|사람마다|기관마다|경우에 따라|상황에 따라|바뀔 수|달라질|알려져|정도로|가량|안팎)/
/**
 * 🔴 **진료를 권하는 문장**인가. 그 자체로 면제되지는 않는다 — 아래 ③ 참고.
 */
const REFERRAL = /(진료|병원|의료진|전문가|응급|상담)[^\n]{0,30}(받|권|가 ?보|문의)|(받아보|받아 보|가 보|권합니다|권해)/

/**
 * 🔴 **숫자 하나하나의 역할을 본다.**
 *
 *    앞판은 "진료를 권하는 문장" 이면 **문장 전체**를 빼 줬다. 그래서 이것이 통과했다:
 *
 *      "50세부터 2년마다 검사를 받아야 하므로 병원에서 진료를 받아보세요."
 *
 *    뒤에 "병원에 가 보세요" 를 붙이기만 하면 어떤 기준도 단정할 수 있었다.
 *    면제되는 것은 **문장**이 아니라 **그 숫자**다.
 *
 *      허용  증상이 얼마나 이어지면 진료를 보라는 **기간 조건**
 *            예) `3주 넘게 이어지면` · `2주 이상 지속되면`
 *      금지  검사 나이·주기·치료·복용 **기준 제시**
 *            예) `50세부터` · `2년마다` · `하루 2회` · `500mg`
 */
const DURATION_UNIT = '일|주|개월|달|년'
/** 그 숫자가 "이만큼 이어지면" 이라는 조건인가 */
const durationThreshold = (sentence, token) => {
  const i = sentence.indexOf(token)
  if (i < 0) return false
  const after = sentence.slice(i + token.length, i + token.length + 24)
  const before = sentence.slice(Math.max(0, i - 24), i)
  if (!new RegExp(`^(${DURATION_UNIT})`).test(token.replace(/^[\d,.]+\s*/, ''))) {
    // 토큰 단위가 기간이 아니면 (세·살·회·mg 등) 조건이 될 수 없다
    if (!new RegExp(`\\d+\\s*(${DURATION_UNIT})`).test(token)) return false
  }
  // 🔴 "부터 · 마다" 는 기준 제시다. 조건이 아니다.
  if (/^\s*(부터|마다|째|간격)/.test(after)) return false
  const cond = /(넘게|이상|이어지|지속|계속|동안|넘어가|가까이)/
  return cond.test(after) || cond.test(before)
}
/** 증상·상태가 이어지는 맥락인가 */
const SYMPTOM_CONTEXT = /(증상|통증|불편|어지럼|두근|무기력|출혈|가려움|건조|피로|열감|부기|이런 상태|같은 상태)/

const SENTENCES = (t) => String(t ?? '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean)

/**
 * 원고 하나를 프로필 규칙으로 검사한다.
 *
 * @param {{profile:string, title?:string, bodyText:string, sources?:Array}} p
 * @returns {{ok:boolean, profile:string, failures:Array<{code,label,sentence}>, checked:string[]}}
 */
export function runProfileQA({ profile, title = '', bodyText = '' }) {
  const failures = []
  const checked = []
  const body = `${title}\n${bodyText}`
  const sentences = SENTENCES(body)
  const add = (code, label, sentence) => failures.push({ code, label, sentence: String(sentence ?? '').slice(0, 120) })

  if (!VALID.has(profile)) {
    add('PROFILE_UNKNOWN', '모르는 프로필', String(profile))
    return { ok: false, profile, failures, checked }
  }

  // ① 금지 패턴 — 공통 + 프로필
  for (const rule of [...COMMON_FORBIDDEN, ...(FORBIDDEN[profile] ?? [])]) {
    const hit = sentences.find((s) => rule.re.test(s))
    if (hit) add(rule.code, rule.label, hit)
  }
  checked.push(`금지 ${COMMON_FORBIDDEN.length + (FORBIDDEN[profile] ?? []).length}종 대조`)

  // ② 있어야 하는 문장
  for (const rule of REQUIRED[profile] ?? []) {
    if (!rule.re.test(body)) add(rule.code, `${rule.label} 없음`, '(본문 전체)')
  }
  if ((REQUIRED[profile] ?? []).length) checked.push(`필수 문장 ${REQUIRED[profile].length}종 확인`)

  // ③ 🔴 기댈 데 없는 수치 단정 — 재생성 대상
  const trigger = SOURCE_TRIGGER[profile]
  if (trigger) {
    /**
     * 🔴 문장 안의 **숫자 토큰마다** 본다.
     *    ① 완충 표현이 있으면 그 문장은 단정이 아니다
     *    ② 진료 권유 + 증상 기간 조건인 숫자는 허용한다
     *    ③ 그 밖의 숫자는 **하나라도 있으면** 단정이다 — 뒤에 "병원 가 보세요" 를
     *       붙였다고 면제되지 않는다
     */
    const numbersIn = (x) => [...String(x).matchAll(/\d[\d,.]*\s*(?:%|퍼센트|세|살|개월|달|주|년|일|회|mg|밀리그램|원|만원|억)/g)].map((m) => m[0])
    const risky = sentences.filter((sent) => {
      if (!trigger.test(sent) || HEDGED.test(sent)) return false
      const tokens = numbersIn(sent)
      if (!tokens.length) return false
      const referral = REFERRAL.test(sent)
      const symptom = SYMPTOM_CONTEXT.test(sent)
      // 🔴 모든 숫자가 "증상이 이만큼 이어지면 진료를 보라" 는 조건일 때만 면제된다
      return !tokens.every((t) => referral && symptom && durationThreshold(sent, t))
    })
    for (const s of risky.slice(0, 3)) {
      add('UNSUPPORTED_NUMERIC_CLAIM', '수치·제도를 단정한다 — 가변성을 밝히거나 빼야 한다', s)
    }
    const softened = sentences.filter((s) => trigger.test(s) && HEDGED.test(s)).length
    if (!risky.length) checked.push(`수치·제도 문장 ${softened}개 전부 가변성을 밝힘`)
  }

  /**
   * 🔴 **중복 문장 검사를 뺐다** (2026-09-24 실측).
   *    실제 원고 3건이 전부 여기 걸렸는데, 걸린 문장은 **커뮤니티 CTA 질문**이었다.
   *    그 질문은 본문 끝과 CTA 블록에 **일부러 두 번** 놓는 구조다.
   *    형식 중복은 프로필의 관심사가 아니고, 여기서 보면 정상 구조를 결함으로 만든다.
   */

  return { ok: failures.length === 0, profile, failures, checked }
}

const VALID = new Set(['STANDARD', 'MEDICAL', 'FINANCIAL', 'SENSITIVE'])

/** 🔴 검사 목록을 밖에서도 읽을 수 있게 — brief 가 같은 목록을 원고 지시서에 싣는다 */
export const PROFILE_RULES = { FORBIDDEN, COMMON_FORBIDDEN, REQUIRED, SOURCE_TRIGGER }
