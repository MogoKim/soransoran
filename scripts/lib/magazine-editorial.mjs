/**
 * 편집 검사 — 자동 QA 가 보지 못하던 축을 기계로 본다 (M-AUTO-2)
 *
 * magazine-qa.mjs 는 금지어·길이·구조를 본다. 그 축은 통과하는데
 * 사람이 반려하는 글이 있었다 — 편집·화자·검색 의도 축이다.
 * 여기서 그중 **LLM 없이 판정 가능한 둘**을 맡는다.
 *
 *   D1  1인칭 화자      매거진은 편집팀 글이다. 개인 일기가 아니다
 *   D2  제목 형태       검색해서 들어오는 글의 제목은 검색 질의를 닮는다
 *   D4-A 진료 권고      건강 글은 병원으로 보내는 문장을 가져야 한다
 *   D5  진료과 단정      어느 과로 가라고 정해 주지 않는다
 *   D7  치료 권유·만류    치료를 권하지도 말리지도 않는다
 *   D8  비용 단정        진료비를 숫자로 말하지 않는다
 *
 * 🔴 D3(소재 중복)은 여기 없다. 폐기했다.
 *    문자 n-gram·명사 Jaccard 둘 다 실측에서 분리에 실패했다 —
 *    소재가 겹쳐도 문장을 새로 쓰면 유사도가 오르지 않는다.
 *    잘 쓴 재탕이 가장 안 잡힌다. 소재 중복은 LLM judge(J6) 로 옮겼다.
 *    ⚠️ 억지 임계값을 만들지 않는다. 오탐만 늘고 게이트 신뢰를 잃는다.
 *
 * 🔴 순수 함수만 둔다. 파일을 읽지 않고 쓰지 않는다.
 *    M-AUTO-3 의 PASS/FAIL/UNKNOWN 리포트가 같은 함수를 다시 쓴다 —
 *    magazine-qa.mjs 안에 인라인하면 그때 다시 빼내야 한다.
 *
 * 🔴 이 파일은 등록을 열지 않는다.
 *    AUTO_RISK · brief G5 · batch-qa 의 HIGH 차단은 그대로다.
 *    검사를 늘리는 것과 게이트를 여는 것은 다른 일이다.
 */

// ── 공용 ───────────────────────────────────────────────────

/** 문장 분리. 마침표 뒤 공백이거나 줄바꿈이면 문장이 끝난 것으로 본다 */
function splitSentences(text) {
  return String(text ?? '').split(/(?<=[.!?])\s+|\n/)
}

// ── D1 · 1인칭 화자 ────────────────────────────────────────

/**
 * 화자 대명사. **등록 25건 전부 0건**이라 이 자체가 신호다.
 *
 * 🔴 "나는" 과 "내가" 는 넣지 않는다. 실측에서 47건이 전부 오탐이었다.
 *      나는 → "땀이 나는" · "달아오르는"        (동사 활용, 대명사가 아니다)
 *      내가 → "그때의 내가" · "내가 받을 금액"  (화자가 아니라 **독자**를 가리킨다)
 *    어절 경계로도 걸러지지 않는다. 패턴에서 빼는 것이 유일한 해법이다.
 */
const SPEAKER_PATTERNS = [
  /(?<![가-힣])제가(?![가-힣])/g,
  /(?<![가-힣])저는(?![가-힣])/g,
  /(?<![가-힣])저도(?![가-힣])/g,
  /(?<![가-힣])저희(?![가-힣])/g,
  /(?<![가-힣])제\s[가-힣]/g,
]

/** 과거 경험을 1인칭으로 서술할 때 붙는 종결어미 */
const EXPERIENCE_ENDINGS = [
  '했습니다', '봤습니다', '았습니다', '었습니다', '였습니다', '뒀습니다',
  '났습니다', '왔습니다', '갔습니다', '줬습니다', '놨습니다', '졌습니다',
  '겼습니다', '췄습니다', '뻤습니다', '샀습니다', '팠습니다', '썼습니다',
]

/**
 * 임계 — 등록 25건 실측이 근거다.
 *   화자 대명사   최대 0건
 *   경험 종결어미 최대 1.57‰ (empty-nest-quiet, 2건/1275자)
 * 반려된 sleep-habit-two-weeks 는 화자 4건 · 22.84‰ 였다.
 *
 * ⚠️ 경험 종결어미 WARN 여유가 0.43‰ 로 얇다. 3인칭 회상이 잦은 글이
 *    들어오면 WARN 이 뜰 수 있다 — FAIL 이 아니므로 발행은 막지 않는다.
 */
export const D1_SPEAKER_FAIL = 3
export const D1_SPEAKER_WARN = 1
export const D1_EXPERIENCE_FAIL_PER_MILLE = 5.0
export const D1_EXPERIENCE_WARN_PER_MILLE = 2.0

/**
 * 따옴표 안은 화자 판정에서 뺀다 — 남의 말이다.
 * hot-flash-how-long 의 `"저는 저녁만 되면 그래요"` 가 이 처리 없이는 오탐이 된다.
 */
function withoutQuotes(text) {
  return String(text ?? '').replace(/"[^"]*"/g, ' ')
}

/**
 * 본문이 1인칭 경험담으로 쓰였는가.
 *
 * @param {string} bodyText 본문 텍스트 (제목·description 은 넣지 않는다)
 * @returns {{ level: 'FAIL'|'WARN'|null, speaker: number, experience: number,
 *             perMille: number, chars: number, reason: string|null }}
 */
export function checkFirstPerson(bodyText) {
  const text = withoutQuotes(bodyText)
  const chars = Math.max(1, text.replace(/\s/g, '').length)

  let speaker = 0
  for (const re of SPEAKER_PATTERNS) speaker += (text.match(re) ?? []).length

  let experience = 0
  for (const ending of EXPERIENCE_ENDINGS) experience += text.split(ending).length - 1
  const perMille = Number(((experience / chars) * 1000).toFixed(2))

  const base = { speaker, experience, perMille, chars }

  if (speaker >= D1_SPEAKER_FAIL || perMille >= D1_EXPERIENCE_FAIL_PER_MILLE) {
    return {
      ...base,
      level: 'FAIL',
      reason:
        `1인칭 경험담으로 읽힌다 — 화자 대명사 ${speaker}회 · 경험 종결어미 ${experience}회(${perMille}‰). ` +
        `매거진은 편집팀 글이다 (등록분 실측: 화자 0회 · 최대 1.57‰)`,
    }
  }
  if (speaker >= D1_SPEAKER_WARN || perMille >= D1_EXPERIENCE_WARN_PER_MILLE) {
    return {
      ...base,
      level: 'WARN',
      reason: `1인칭 기미 — 화자 대명사 ${speaker}회 · 경험 종결어미 ${experience}회(${perMille}‰)`,
    }
  }
  return { ...base, level: null, reason: null }
}

// ── D2 · 제목 형태 ─────────────────────────────────────────

/**
 * 제목이 검색 질의를 닮았는가.
 *
 * 🔴 brief 의 "검색 의도" 목록과 대조하지 않는다.
 *    그 목록은 제목을 이미 아는 사람이 쓴다 — 자기 참조라 검증력이 없다.
 *    실측에서 반려된 글이 정상 글 9건보다 높은 커버리지를 받았다.
 *    실데이터(Search Console)가 들어오는 M-AUTO-6 이전에는 쓰지 않는다.
 *
 * 대신 **말미 형태**를 본다. 등록 25건이 두 형태로 갈린다.
 *    질문형  ~나요 · ~까요 · ~한가요        9건
 *    상황형  ~때 · ~이유 · ~것 · ~법 · ~점  15건 (+ 조기수령 1건은 한가요)
 * 반려된 `잠자리 습관을 바꿔 본 2주` 만 어느 쪽도 아니다 — 후기 제목이다.
 */
const TITLE_FORMS = [
  // "가요" 로 묶어야 인가요·한가요·유리한가요가 함께 잡힌다.
  // 하나씩 나열하면 `나이 들면 … 정상인가요` 같은 변형에서 샌다 (실측으로 걸렸다).
  { name: '질문형', re: /(나요|까요|가요|는가|은가)\s*\??$/ },
  { name: '상황형', re: /(때|이유|것|법|점|중|뒤|후)\s*\??$/ },
]

/**
 * @param {string} title
 * @returns {{ level: 'FAIL'|null, form: string|null, reason: string|null }}
 */
export function checkTitleForm(title) {
  const value = String(title ?? '').trim()
  const hit = TITLE_FORMS.find((f) => f.re.test(value))
  if (hit) return { level: null, form: hit.name, reason: null }
  return {
    level: 'FAIL',
    form: null,
    reason:
      `제목이 검색 질의 형태가 아니다 — 질문형(~나요·~까요·~한가요) 또는 ` +
      `상황형(~때·~이유·~것) 으로 쓴다. 검색해서 들어오는 글이다`,
  }
}

/**
 * 제목이 본문과 같은 것을 말하는가 (2026-09-16 · 무인 운영).
 *
 * 🔴 **왜 필요했나.** `sleep-habit-two-weeks` 는 slug 와 제목이 "2주" 인데
 *    본문은 "며칠로 잘라 말하기 어렵다" 며 기간을 명시적으로 거부했다.
 *    "2주" 로 검색해 들어온 독자가 답을 못 얻는다. 형태 검사(`checkTitleForm`)는
 *    말미만 보므로 이것을 잡지 못한다.
 *
 * 🔴 **핵심어가 본문에 실제로 있는가**만 본다. 의미 판정을 하지 않는다 —
 *    기계가 "이 글이 제목에 답하는가" 를 판정하려 들면 오탐이 재고를 멈춘다.
 *    관문의 오탐은 막지 못하는 것보다 나쁘다(원고 관문과 같은 원칙).
 *
 * 🔴 조사·말미 형태소를 떼고 본다. "걷기" 와 "걷는" 을 다른 말로 세면 전부 걸린다.
 */

/** 제목에서 빼는 말 — 검색어가 아니라 문장을 잇는 조각이다 */
const TITLE_STOPWORDS = new Set([
  '그', '이', '저', '것', '때', '뒤', '후', '중', '점', '법', '이유',
  '무슨', '어떤', '어떻게', '얼마나', '언제', '왜', '몇', '하면', '해도', '하는',
  '있는', '없는', '되나요', '인가요', '한가요', '까요', '나요', '될까요', '할까요',
])

/** 비교용으로 줄기만 남긴다 — 조사·어미를 떼고 2자 이상만 */
function titleStems(text) {
  return String(text ?? '')
    .replace(/[^가-힣A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/(은|는|이|가|을|를|에|의|도|만|과|와|로|으로|에서|부터|까지)$/, ''))
    .filter((w) => w.length >= 2 && !TITLE_STOPWORDS.has(w))
}

/**
 * @param {string} title
 * @param {string} bodyText
 * @returns {{ level: 'FAIL'|'WARN'|null, missing: string[], coverage: number, reason: string|null }}
 */
export function checkTitleBodyMatch(title, bodyText) {
  const stems = [...new Set(titleStems(title))]
  const body = String(bodyText ?? '')
  if (stems.length === 0) return { level: null, missing: [], coverage: 1, reason: null }

  // 🔴 줄기 그대로 또는 앞 2자로 본다 — "걷기" 가 본문에 "걷는" 으로 나와도 같은 말이다
  const missing = stems.filter((s) => !body.includes(s) && !body.includes(s.slice(0, 2)))
  const coverage = (stems.length - missing.length) / stems.length

  // 🔴 하나도 안 걸리면 제목과 본문이 다른 글이다. 그것만 FAIL 로 둔다.
  if (coverage === 0) {
    return { level: 'FAIL', missing, coverage, reason: `제목의 핵심어가 본문에 하나도 없다 — ${missing.join(' · ')}` }
  }
  if (missing.length > 0 && coverage < 0.5) {
    return {
      level: 'WARN',
      missing,
      coverage,
      reason: `제목의 핵심어 절반 이상이 본문에 없다 — ${missing.join(' · ')} (검색해 들어온 독자가 답을 못 찾는다)`,
    }
  }
  return { level: null, missing, coverage, reason: null }
}

// ── D4-A · 진료 권고 문장 ──────────────────────────────────

/**
 * 건강 글에 병원으로 보내는 문장이 있는가 (전략 §4.4).
 *
 * §4.4 는 두 자리를 요구한다.
 *   본문 안   증상을 설명한 직후 — "증상이 오래가거나 심하면 병원에서 확인해 보세요"
 *   하단 고정 medical: true 면 MagazineBody 가 자동으로 붙인다
 * 자동으로 붙는 하단은 검사할 것이 없다. **본문 안 문장**만 본다.
 *
 * 🔴 배치는 검사하지 않는다 (D4-B 보류).
 *    M-AUTO-2 설계 초안은 "위험 신호가 앞쪽 h2 에 있어야 한다" 였다. 실측이 반대였다 —
 *    등록 18건의 권고 위치비가 중앙 0.6 이고 최빈도 0.6 이다. 앞쪽 절반을 임계로 걸면
 *    15건이 걸린다. §4.4 도 "앞쪽" 이 아니라 **"증상 설명 직후"** 라고만 한다.
 *    증상 설명이 2~3번째 h2 니까 0.6 이 정상이다.
 *
 *    다만 **응급 위험 신호**(흉통·호흡곤란·실신)는 다르다. 이탈 전에 읽혀야 하므로
 *    앞쪽이어야 한다. 그런데 그런 글이 코퍼스에 **0건**이라 임계를 실측으로 정할 수 없다.
 *    palpitations-menopause · dizziness-menopause 초안이 나온 뒤에 별도 규칙으로 만든다.
 *    ⚠️ 데이터 없이 임계를 지어내지 않는다 — D3 를 폐기한 것과 같은 이유다.
 *
 * 🔴 FAIL 이다. 선택 항목이 아니라 **필수 조건**이다.
 *    §4.4 는 건강 글에 이 문장을 "둔다" 고 하지 "두면 좋다" 고 하지 않는다.
 *    병원으로 가야 할 사람을 집에 머물게 하는 것이 이 검사가 막는 일이다.
 *
 *    처음에는 WARN 이었다. 이미 나간 글 두 건이 걸려 FAIL 로 두면 발행분이
 *    QA 실패 상태가 됐기 때문이다. 그 둘을 먼저 정리하고 승격했다.
 *      health-insurance-after-retire  medical: true 가 과했다 — 플래그를 뺐다
 *      less-sleep-with-age            진짜 누락이었다 — callout 에 주체를 넣었다
 *    지금 medical: true 18건 전부 이 문장을 갖췄다. 승격해도 회귀가 없다.
 *
 *    ⚠️ 순서가 중요했다. 게이트를 먼저 올리고 글을 고치면 그동안 발행분이
 *       FAIL 로 남는다. **오탐과 진짜 누락을 먼저 정리한 뒤 올린다.**
 */

/** 누구에게 가라는 것인가 */
const CARE_SUBJECTS = ['병원', '진료', '의료진', '전문가', '전문의', '의사', '진찰', '검사']

/** 가서 무엇을 하라는 것인가 */
const CARE_VERBS = ['상담', '확인', '받아', '가보', '가 보', '권합니다', '권해', '물어', '이야기해']

/**
 * 주체와 동사가 **같은 문장 안**에 있어야 한다.
 * 글 전체에 "병원" 과 "확인" 이 흩어져 있는 것은 권고가 아니다 —
 * "병원에 갈 정도는 아닙니다" 와 "혼자 확인해 보세요" 가 따로 있는 글도 통과해버린다.
 *
 * D4-A · D5 · D7 · D8 이 같은 판정을 쓴다. 넷 다 "무엇을 누구에게" 가 한 문장에
 * 모였을 때만 의미가 생긴다.
 *
 * @param {string} text
 * @param {(string|RegExp)[]} subjects 어절 경계가 필요한 어휘는 RegExp 로 준다 (g 플래그 금지)
 * @param {string[]} verbs
 * @returns {{ sentence: string, subject: string, verb: string }[]}
 */
function sentencesWith(text, subjects, verbs) {
  const hits = []
  for (const sentence of splitSentences(text)) {
    const subject = subjects.find((x) => (x instanceof RegExp ? x.test(sentence) : sentence.includes(x)))
    if (!subject) continue
    const verb = verbs.find((v) => sentence.includes(v))
    if (verb) hits.push({ sentence: sentence.trim(), subject: subject instanceof RegExp ? subject.source : subject, verb })
  }
  return hits
}

function hasCareSentence(text) {
  const [hit] = sentencesWith(text, CARE_SUBJECTS, CARE_VERBS)
  return hit ? hit.sentence : null
}

/**
 * @param {string} bodyText 본문 텍스트
 * @param {boolean} medical article.medical
 * @returns {{ level: 'FAIL'|null, sentence: string|null, reason: string|null }}
 */
export function checkCareAdvice(bodyText, medical) {
  if (!medical) return { level: null, sentence: null, reason: null }
  const sentence = hasCareSentence(bodyText)
  if (sentence) return { level: null, sentence, reason: null }
  return {
    level: 'FAIL',
    sentence: null,
    reason:
      'medical: true 인데 본문에 진료 권고 문장이 없다 — 전략 §4.4 의 필수 조건이다. ' +
      '하단 고정 문구는 자동으로 붙지만 그것만으로는 부족하다. ' +
      '"증상이 오래가거나 심하면 병원에서 확인해 보세요" 처럼 ' +
      '누구에게 가라는 주체를 한 문장 안에 넣어 증상 설명 직후에 둔다',
  }
}

// ── D5 · 진료과 단정 ───────────────────────────────────────

/**
 * 어느 과로 가라고 정해 주는가 (M-AUTO-2 · clinic 유형).
 *
 * 큐가 `which-clinic-menopause` 에 건 금지선이 이것이다 —
 * **"과 선택은 정보 제공까지만. 가야 한다 / 안 가도 된다를 판단해 주지 않는다."**
 *
 * 등록분 6건이 이 선을 지킨 형태의 baseline 이다.
 *   "무슨 과에 가야 할지 막막하다면 산부인과에서 먼저 상담하는 경우가 많습니다"
 *   "가까운 내과나 가정의학과에서 먼저 현재 겪는 변화를 이야기하고 안내를 받아도 됩니다"
 *   "여성 탈모는 피부과나 가정의학과에서 먼저 이야기해보시면 방향을 잡을 수 있다고 이야기됩니다"
 * 전부 **관찰형·허용형**이지 지시형이 아니다. 과를 말하는 것 자체는 정보다.
 * 막아야 하는 것은 **독자 대신 고르는 문장**이다.
 *
 * 🔴 어절 경계가 없으면 오탐이 난다. 실측으로 잡았다.
 *      walking-minutes-50s  "걷는 동안과 걷고 난 뒤"  →  "동안과" 의 '안과'
 *    2글자 과(내과·외과·안과)에서만 나는 문제라 `(?<![가-힣])` 로 막는다.
 *    D1 이 `나는`·`내가` 를 뺀 것과 같은 종류의 함정이다.
 *
 * 🔴 동사는 어미까지 고정한다.
 *      "무슨 과에 가야 할지 막막하다면"     통과해야 한다 (등록분 실문장)
 *      "산부인과에 가야 합니다"             FAIL 이어야 한다
 *    `가야` 로 뭉뚱그리면 앞 문장이 걸린다.
 *
 * 🔴 `정답` 은 단독으로 쓰지 않는다.
 *      "어느 과가 정답이라고 말하기는 어렵습니다"  ← 우리가 원하는 바로 그 문장이다
 *    `정답입니다` 로 좁혀야 이것이 살아남는다.
 */

/** 긴 이름부터 둔다 — 내분비내과가 '내과' 로 라벨되지 않게 한다 */
const DEPARTMENT_NAMES = [
  '정신건강의학과', '내분비내과', '류마티스내과', '소화기내과', '순환기내과', '호흡기내과',
  '가정의학과', '이비인후과', '비뇨의학과', '산부인과', '정형외과', '유방외과', '신경외과',
  '비뇨기과', '심장내과', '신경과', '피부과', '한의원', '한방병원', '내과', '외과', '안과', '치과',
]

const DEPARTMENT_SUBJECTS = DEPARTMENT_NAMES.map((name) => new RegExp(`(?<![가-힣])${name}`))

/** 독자 대신 고르는 말. 관찰("경우가 많습니다")·허용("받아도 됩니다")은 넣지 않는다 */
const DEPARTMENT_DIRECTIVES = [
  '가야 합니다', '가야 해요', '가야 됩니다', '가셔야 합니다', '가셔야 해요',
  '가세요', '가시면 됩니다', '가시는 게 맞', '가시는 편이 낫', '가보세요', '가 보세요',
  '정답입니다', '정답이에요', '추천합니다', '추천드립니다', '추천해 드립니다',
  '권합니다', '권해 드립니다', '권해드립니다', '부터 가',
]

/**
 * @param {string} bodyText 본문 텍스트
 * @returns {{ level: 'FAIL'|null, hits: object[], reason: string|null }}
 */
export function checkDepartmentDirective(bodyText) {
  const hits = sentencesWith(bodyText, DEPARTMENT_SUBJECTS, DEPARTMENT_DIRECTIVES)
  if (hits.length === 0) return { level: null, hits: [], reason: null }
  return {
    level: 'FAIL',
    hits,
    reason:
      `진료과를 정해 주는 문장이 ${hits.length}개 있다 — "${hits[0].sentence.slice(0, 60)}". ` +
      '어느 과로 갈지는 독자와 의료진이 정한다. ' +
      '"산부인과에서 먼저 상담하는 경우가 많습니다" 처럼 관찰형·허용형으로 쓴다',
  }
}

// ── D7 · 치료 권유·만류 ────────────────────────────────────

/**
 * 치료를 권하거나 말리는가 (M-AUTO-2 · clinic 유형).
 *
 * 큐가 `hormone-therapy-who` 에 건 금지선이다 —
 * **"치료를 권하거나 말리지 않는다. 적응증·부작용을 단정하지 않고 의료진 상담으로 연결한다."**
 * `which-clinic-menopause` 도 과를 이야기하다 보면 이 선에 닿는다.
 *
 * ⚠️ **코퍼스 검증이 없다.** 등록 29건에 치료 어휘가 한 번도 나오지 않는다.
 *    회귀 위험은 0 이지만 검출력은 합성 샘플로만 확인했다
 *    (`scripts/magazine-editorial-check.mjs`).
 *    `hormone-therapy-who`(day 40) 초안이 나오면 실데이터로 다시 본다.
 *
 *    D4-B 를 보류한 것과는 경우가 다르다. D4-B 는 **임계값**을 실측 없이 정할 수 없었지만,
 *    D7 은 임계가 아니라 **명시적 표현 목록**이라 지어내는 값이 없다.
 */

const TREATMENT_TERMS = [
  '호르몬 치료', '호르몬치료', '호르몬 요법', '호르몬요법', '약물 치료', '약물치료',
  '항우울제', '수면제', '신경안정제', '진통제', '영양제', '건강기능식품', '보조제',
  '한약', '시술', '수술', '주사',
]

/** 권유 · 만류 양쪽 다 막는다. "받으세요" 만큼 "위험합니다" 도 판단이다 */
const TREATMENT_DIRECTIVES = [
  '받으세요', '받으시길', '받아 보세요', '받아보세요', '받으시는 게 좋습니다',
  '드세요', '드시면 좋습니다', '복용하세요', '복용하시면',
  '권합니다', '권해 드립니다', '권해드립니다', '추천합니다', '추천드립니다',
  '위험합니다', '하지 마세요', '피하세요', '권하지 않습니다', '좋지 않습니다', '끊으세요',
]

/**
 * @param {string} bodyText 본문 텍스트
 * @returns {{ level: 'FAIL'|null, hits: object[], reason: string|null }}
 */
export function checkTreatmentDirective(bodyText) {
  const hits = sentencesWith(bodyText, TREATMENT_TERMS, TREATMENT_DIRECTIVES)
  if (hits.length === 0) return { level: null, hits: [], reason: null }
  return {
    level: 'FAIL',
    hits,
    reason:
      `치료를 권하거나 말리는 문장이 ${hits.length}개 있다 — "${hits[0].sentence.slice(0, 60)}". ` +
      '받을지 말지는 의료진과 정한다. 적응증·부작용을 단정하지 않고 상담으로 연결한다',
  }
}

// ── D8 · 비용 단정 ─────────────────────────────────────────

/**
 * 진료비를 숫자로 말하는가 (M-AUTO-2 · clinic 유형).
 *
 * 🔴 **money 축에는 걸지 않는다.** 돈 글에서 금액은 정보다.
 *    `irp-tax-benefit`(day 28) 은 세제 글이라 금액이 정당하게 나온다.
 *    전역으로 걸면 확실한 오탐이다 — `clinic` 이거나 `medical: true` 일 때만 본다.
 *
 * 🔴 `비용` 은 넣지 않는다. "비용이 부담된다고 이야기합니다" 같은 문장이 걸린다.
 *    `진료비`·`검사비` 처럼 의료비를 직접 가리키는 말만 둔다.
 *
 * 금액 정규식 뒤에 `(?![가-힣])` 를 붙여 "원인"·"원래" 를 뺀다.
 */

const CLINIC_MONEY_RE = /\d[\d,]*\s*(만\s*원|천\s*원|원)(?![가-힣])/g

const COST_TERMS = ['진료비', '검사비', '치료비', '수술비', '입원비']

const COST_CLAIM_VERBS = ['입니다', '이에요', '예요', '듭니다', '들어갑니다', '나옵니다', '정도']

/**
 * @param {string} bodyText 본문 텍스트
 * @param {{ cluster?: string, medical?: boolean }} article
 * @returns {{ level: 'FAIL'|null, amounts: string[], hits: object[], reason: string|null }}
 */
export function checkCostClaim(bodyText, article = {}) {
  const applies = article.cluster === 'clinic' || article.medical === true
  if (!applies) return { level: null, amounts: [], hits: [], reason: null }

  const amounts = [...String(bodyText ?? '').matchAll(CLINIC_MONEY_RE)].map((m) => m[0].trim())
  const hits = sentencesWith(bodyText, COST_TERMS, COST_CLAIM_VERBS)
  if (amounts.length === 0 && hits.length === 0) {
    return { level: null, amounts: [], hits: [], reason: null }
  }

  const what = amounts.length ? `금액 표기 ${amounts.length}개(${amounts.slice(0, 3).join(' · ')})` : ''
  const where = hits.length ? `진료비 단정 ${hits.length}개("${hits[0].sentence.slice(0, 40)}")` : ''
  return {
    level: 'FAIL',
    amounts,
    hits,
    reason:
      `건강 글에 비용을 단정했다 — ${[what, where].filter(Boolean).join(' · ')}. ` +
      '진료비는 병원·지역·보험 적용에 따라 달라진다. 숫자를 적으면 그 자체가 틀린 정보가 된다',
  }
}
