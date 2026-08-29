/**
 * 편집 검사 — 자동 QA 가 보지 못하던 축을 기계로 본다 (M-AUTO-2)
 *
 * magazine-qa.mjs 는 금지어·길이·구조를 본다. 그 축은 통과하는데
 * 사람이 반려하는 글이 있었다 — 편집·화자·검색 의도 축이다.
 * 여기서 그중 **LLM 없이 판정 가능한 둘**을 맡는다.
 *
 *   D1  1인칭 화자      매거진은 편집팀 글이다. 개인 일기가 아니다
 *   D2  제목 형태       검색해서 들어오는 글의 제목은 검색 질의를 닮는다
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
