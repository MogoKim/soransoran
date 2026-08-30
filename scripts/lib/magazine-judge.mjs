/**
 * PASS / FAIL / UNKNOWN 판정 (M-AUTO-3)
 *
 * §13.7 이 못 박은 것 — **판정은 셋이다. 둘이 아니다.**
 *
 *   PASS      기준을 만족한다고 기계가 말할 수 있다   → 자동 등록 후보
 *   FAIL      기준을 어겼다고 기계가 말할 수 있다     → 자동 보류
 *   UNKNOWN   기계가 말할 수 없다                     → 창업자 확인
 *
 * 🔴 **UNKNOWN 은 판정을 미루는 것이지 통과가 아니다.**
 *    하나라도 있으면 자동 등록 대상이 아니다. PASS 로 흘려보내지 않는다.
 *
 * 🔴 **의료 사실에 PASS 를 주지 않는다.**
 *    "산부인과가 폐경을 본다" 가 맞는지는 외부 근거의 영역이다. 이 파일은
 *    그 문장이 **있다는 것**만 찾아내고 판단은 사람에게 넘긴다.
 *    LLM 을 부르지 않고 검색도 하지 않는다.
 *
 * 🔴 **트리거를 좁게 잡는다.**
 *    UNKNOWN 이 글마다 아홉 개씩 나오면 창업자는 다시 전문을 읽게 된다.
 *    목표는 "글마다 2~3 개" 다. 조건이 실제로 걸릴 때만 낸다 —
 *    hedge 가 하나라도 있으면 묻지 않고, cluster 에 선례가 쌓이면 묻지 않는다.
 *
 * 🔴 이 파일은 등록을 열지 않는다. register·batch-qa 에 연결되어 있지 않다.
 */

import { MEDICAL_REQUIRED, MEDICAL_SUGGESTED } from '../magazine-qa.mjs'

export const VERDICT = { PASS: 'PASS', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN' }

/** 같은 cluster 글이 이만큼 쌓이면 소재 중복을 묻는다 */
export const CLUSTER_CROWDED = 5

const splitSentences = (t) => String(t ?? '').split(/(?<=[.!?])\s+|\n/)

/** 어절 경계를 지킨다 — "동안과" 의 '안과' 를 막은 것과 같은 이유다 (D5) */
const DEPARTMENT_NAMES = [
  '정신건강의학과', '내분비내과', '류마티스내과', '소화기내과', '순환기내과', '호흡기내과',
  '가정의학과', '이비인후과', '비뇨의학과', '산부인과', '정형외과', '유방외과', '신경외과',
  '비뇨기과', '심장내과', '신경과', '피부과', '내과', '외과', '안과', '치과',
]
const departmentsIn = (text) => {
  const found = new Set()
  for (const name of DEPARTMENT_NAMES) {
    if (new RegExp(`(?<![가-힣])${name}`).test(text)) found.add(name)
  }
  // 긴 이름이 잡히면 그 안에 든 짧은 이름은 뺀다 (내분비내과 ⊃ 내과)
  for (const long of [...found]) {
    for (const short of [...found]) {
      if (long !== short && long.includes(short)) found.delete(short)
    }
  }
  return [...found]
}

/** 그 진료과가 무엇을 보는 곳인지 서술한 문장 */
const ROLE_VERBS = ['살펴보', '보는 곳', '다루', '알려져 있', '진료 영역', '관련된 증상', '함께 봅']
/** 어디서 시작하면 되는지 안내한 문장 */
const PATH_VERBS = ['먼저', '시작', '안내를 받', '이야기하고']

/** 판단을 독자에게 남기는 표현 */
const HEDGES = [
  '사람마다', '개인차', '따라 다릅니다', '따라 달라', '상황에 따라', '경우에 따라',
  '다를 수 있습니다', '단정할 수 없', '정해져 있지 않', '일률적으로',
]

/**
 * 상호명으로 읽힐 수 있는 형태.
 *
 * 🔴 뒤에는 경계를 두지 않는다. "행복의원**에서**" 처럼 조사가 붙는 것이 정상이라
 *    `(?![가-힣])` 를 붙이면 실제 상호명을 놓친다 — 회귀 테스트에서 걸렸다.
 *    대신 아래 allow 목록으로 일반명사를 걷어낸다.
 */
const INSTITUTION_RE = /(?<![가-힣])[가-힣]{2,6}(병원|의원|클리닉|한의원)/g
/** 일반명사라 상호명이 아닌 것 */
const INSTITUTION_ALLOW = new Set([
  '대학병원', '종합병원', '동네병원', '가까운병원', '한방병원', '요양병원', '개인병원', '큰병원',
])

/** deterministic 으로는 오탐이 나던 지연 표현 (dry-skin-menopause 사례) */
const DELAY_HINTS = ['갈 정도는 아', '참아도', '참으셔도', '굳이 병원', '지켜봐도 됩니다', '기다려도 됩니다']

/**
 * 사람에게 물을 항목 하나를 만든다.
 * `where` 는 **본문에서 그대로 뽑은 문장**이다 — 창업자가 찾아 헤매지 않게 한다.
 */
const unknown = (id, question, where, why) => ({ id, verdict: VERDICT.UNKNOWN, question, where, why })

/**
 * @param {{ article: object, bodyText: string, published?: object[], queueItem?: object|null }} p
 * @returns {{ id, verdict, question, where, why }[]}
 */
export function collectUnknowns({ article, bodyText, published = [], queueItem = null }) {
  const out = []
  const text = String(bodyText ?? '')
  const sentences = splitSentences(text)
  const depts = departmentsIn(text)

  // ── J-과역할 · 외부 근거 ────────────────────────────────
  // 진료과가 무엇을 보는 곳인지 적은 문장은 사실선이 걸린다. 기계는 맞는지 모른다.
  const roleSentence = sentences.find(
    (s) => departmentsIn(s).length > 0 && ROLE_VERBS.some((v) => s.includes(v)),
  )
  if (roleSentence) {
    out.push(
      unknown(
        'J-과역할',
        `"${departmentsIn(roleSentence).join('·')}" 가 여기 적힌 범위를 실제로 다루는가`,
        roleSentence.trim(),
        '진료과가 무엇을 보는 곳인지는 외부 근거의 영역이다. 기계가 PASS 를 줄 수 없다',
      ),
    )
  }

  // ── J-내과경로 · 외부 근거 ──────────────────────────────
  // "어디서 먼저 이야기하면 된다" 는 경로 안내다. 실제로 가능한 경로인지 확인이 필요하다.
  // 후보 중 **가장 긴 문장**을 고른다. h2 제목("내과·가정의학과에서 시작하는 경우")도
  // 조건에는 맞지만 근거로는 빈약하다 — 창업자가 확인할 것은 본문의 서술이다.
  const pathSentence = sentences
    .filter((s) => departmentsIn(s).length > 0 && PATH_VERBS.some((v) => s.includes(v)) && s !== roleSentence)
    .sort((a, b) => b.length - a.length)[0]
  if (pathSentence && depts.length >= 2) {
    out.push(
      unknown(
        'J-내과경로',
        '여기 적은 대로 먼저 상담하고 다른 과 안내를 받는 경로가 실제로 가능한가',
        pathSentence.trim(),
        '진료 흐름은 병원 운영에 달렸다. 코퍼스에도 근거가 없다',
      ),
    )
  }

  // ── J-톤기준선 · 클러스터 첫 글 ─────────────────────────
  // 첫 글이 그 클러스터의 기준선이 된다. 뒤 글들이 이 톤을 따라 쓴다.
  const sameCluster = published.filter((a) => a.cluster === article.cluster && a.slug !== article.slug)
  if (sameCluster.length === 0 && article.cluster) {
    out.push(
      unknown(
        'J-톤기준선',
        `cluster "${article.cluster}" 의 첫 글이다. 뒤에 올 글들이 따라 쓸 톤으로 적절한가`,
        `등록분에 같은 cluster 글이 없다 (제목: ${article.title})`,
        '선례가 없으면 기계가 비교할 대상이 없다. 기준선은 사람이 정한다',
      ),
    )
  }

  // ── J-판단회피 (D6) · hedge 가 아예 없을 때만 ───────────
  // 🔴 하나라도 있으면 묻지 않는다. "사람마다" 한 단어로 통과되는 규칙을
  //    FAIL 로 걸면 낱말 강제가 되고, 매번 UNKNOWN 을 내면 소음이 된다.
  const hedges = HEDGES.filter((h) => text.includes(h))
  if (hedges.length === 0 && (MEDICAL_REQUIRED.has(article.cluster) || MEDICAL_SUGGESTED.has(article.cluster))) {
    out.push(
      unknown(
        'J-판단회피',
        '판단을 독자와 의료진에게 남기는 문장이 있는가 (단정으로 읽히지 않는가)',
        '본문에 "사람마다"·"상황에 따라" 류가 하나도 없다',
        'deterministic 으로는 낱말 강제가 된다 — 등록 20건 중 19건이 "사람마다" 한 단어에 의존한다',
      ),
    )
  }

  // ── J-기관명 ────────────────────────────────────────────
  const institutions = [...text.matchAll(INSTITUTION_RE)]
    .map((m) => m[0])
    .filter((v) => !INSTITUTION_ALLOW.has(v.replace(/\s/g, '')))
  if (institutions.length > 0) {
    out.push(
      unknown(
        'J-기관명',
        `"${[...new Set(institutions)].join('·')}" 가 특정 기관을 가리키는가`,
        sentences.find((s) => institutions.some((i) => s.includes(i)))?.trim() ?? institutions[0],
        '상호명은 열거할 수 없다. 일반명사와 고유명사를 기계가 가르지 못한다',
      ),
    )
  }

  // ── J-진료지연 ──────────────────────────────────────────
  const delaySentence = sentences.find((s) => DELAY_HINTS.some((d) => s.includes(d)))
  if (delaySentence) {
    out.push(
      unknown(
        'J-진료지연',
        '이 문장이 진료를 미루라는 뜻으로 읽히는가 (독자의 마음을 대변하는 도입이면 문제없다)',
        delaySentence.trim(),
        'deterministic 오탐이 확인됐다 — dry-skin-menopause 의 "병원에 갈 정도는 아닌 것 같고" 는 도입부다',
      ),
    )
  }

  // ── J-소재중복 · 같은 cluster 가 쌓였을 때만 ────────────
  // 🔴 D3(n-gram)은 폐기됐다. 잘 쓴 재탕이 가장 안 잡힌다.
  //
  // 임계를 5 로 둔 것은 소음 때문이다. 3 으로 잡으면 등록분 cluster 8 종 중 6 종이
  // 걸려 거의 매번 뜬다 — 매번 뜨는 질문은 아무도 읽지 않는다. 5 면 실제로 재탕
  // 위험이 큰 자리(menopause-symptom 6건 · sleep 5건)에만 묻는다.
  // ⚠️ 코퍼스가 커지면 이 값을 다시 본다. 지금은 등록 30건 기준이다.
  if (sameCluster.length >= CLUSTER_CROWDED) {
    out.push(
      unknown(
        'J-소재중복',
        `같은 cluster 글 ${sameCluster.length}건과 소재가 겹치지 않는가`,
        sameCluster.slice(0, 5).map((a) => a.title).join(' · '),
        '문자 n-gram·명사 Jaccard 둘 다 실측에서 분리에 실패했다 (D3 폐기)',
      ),
    )
  }

  return out
}

/**
 * 최종 판정. **UNKNOWN 은 PASS 로 흘러가지 않는다.**
 *
 * @param {{ qaFail: number, unknowns: any[] }} p
 */
export function decide({ qaFail, unknowns }) {
  if (qaFail > 0) return VERDICT.FAIL
  if (unknowns.length > 0) return VERDICT.UNKNOWN
  return VERDICT.PASS
}

/** 이 판정으로 자동 등록해도 되는가. PASS 하나뿐이다 */
export function autoRegisterable(verdict) {
  return verdict === VERDICT.PASS
}
