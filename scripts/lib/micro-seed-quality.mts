/**
 * Micro Seed 품질 플래그 — 후보 선별 보조 (Q-1 · M2 Source Quality Engine v0)
 *
 * 정본: docs/operations/2026-08-26-soransoran-milestones.md §2 M2
 *
 * 🔴 이것은 **거부 엔진이 아니라 선별 보조 엔진**이다.
 *    플래그는 사람이 고르는 것을 돕는다. 플래그가 붙었다고 후보가 버려지지 않는다.
 *    정치성 · 실명 · 낮은 댓글수 · 낚시성 제목 · 짧은 본문은 **자동 거부하지 않는다** —
 *    조용히 버려진 글은 아무도 모르고, 오탐이 좋은 글을 같이 데려간다.
 *
 * 🔴 네트워크 · LLM · DB · Sheet · 난수를 쓰지 않는다.
 *    문자열을 받아 객체를 돌려줄 뿐이라 fixture 가 전부 검증한다.
 *    LLM 판단은 M4(Voice Engine)의 일이다 — 여기서 비용을 만들지 않는다.
 *
 * 🔴 source 중립이다.
 *    82cook 을 모른다. 제목 · 댓글수 · 본문만 받는다.
 *    네이버 카페를 붙일 때 이 파일을 고치지 않고 그대로 쓴다 (M6).
 *
 * ⚠️ 한국어에는 단어 경계(\b)가 없다.
 *    부분 문자열 매칭이 오탐을 만든다 — `전세계` 안의 `전세` 가 실측 사례다.
 *    어휘를 넓히는 대신 **좁고 확실한 형태**로 적고, 오탐은 fixture 로 잠근다.
 */

// ─────────────────────────────────────────────────────────
// 임계값 — 🔴 1차값이다
// ─────────────────────────────────────────────────────────
//
// 근거는 실측이지만 표본이 목록 25건 · 상세 4건뿐이다.
// **후보 50건이 누적되면 재조정한다.** 지금 이 값을 정본으로 굳히지 않는다.

/** 댓글이 이만큼 달렸으면 사람들이 반응한 글이다. 실측 상위 24% 지점 */
export const HIGH_ENGAGEMENT_MIN = 5
/** 이보다 짧으면 읽을 것이 적다. 발행분 최소 236자 / 미발행분 62자 사이 */
export const SHORT_BODY_MAX = 150
/** 본문 글자 중 URL 비중. 미발행분 65% / 발행분 최대 6% 사이 */
export const LINK_HEAVY_RATIO = 0.3
/** 이보다 짧은 제목은 맥락이 없다 */
export const SHORT_TITLE_MAX = 8
/** 이미지에 기댄 글의 텍스트 잔량 — 본문이 거의 없고 줄도 없다 */
export const IMAGE_LIKELY_BODY_MAX = 50
export const IMAGE_LIKELY_LINE_MAX = 2

export type QualityFlag =
  // 목록 단계 — 본문 없이 판정한다
  | 'lowEngagement'
  | 'highEngagement'
  | 'politicalOrPublicFigure'
  | 'clickbaitTitle'
  | 'shortTitle'
  | 'titleTruncated'
  | 'targetLikely'
  // 상세 단계 — 본문을 읽어야 판정한다
  | 'shortBody'
  | 'linkHeavyBody'
  | 'imageLikelyBody'
  | 'personalExperienceLikely'
  | 'practicalConcernLikely'

/** 본문을 읽어야만 판정할 수 있는 플래그. 목록 단계에서는 **매기지 않는다** */
export const DETAIL_ONLY_FLAGS: readonly QualityFlag[] = [
  'shortBody', 'linkHeavyBody', 'imageLikelyBody', 'personalExperienceLikely', 'practicalConcernLikely',
]

export type QualityStage = 'list' | 'detail'

export type QualitySignals = {
  commentCount: number
  titleLength: number
  /** 🔴 목록 단계에서는 0 이다. "본문이 없다" 와 "본문이 짧다" 는 다른 것이다 */
  bodyLength: number
  bodyLineCount: number
  /** 본문 글자 중 URL 이 차지하는 비율 (0~1). 본문이 없으면 0 */
  linkCharRatio: number
  /** 🔴 어떤 어휘가 걸렸는지 남긴다 — 플래그를 사람이 검증할 수 있어야 한다 */
  matched: Record<string, string[]>
}

export type QualityAssessment = {
  stage: QualityStage
  flags: QualityFlag[]
  signals: QualitySignals
}

// ─────────────────────────────────────────────────────────
// 제목 말줄임 — 판정보다 먼저 벗긴다
// ─────────────────────────────────────────────────────────

/**
 * 목록 제목은 잘린다. 82cook 실측 25건 중 5건(20%)이 `..` · `…` · `&q` 로 끝났다.
 *
 * 🔴 말줄임을 낚시성으로 오독하면 안 된다.
 *    `초등 저학년 교육 시간 확대?…` 는 낚시가 아니라 **목록 표시 한계**다.
 *    그래서 clickbait 판정 전에 꼬리를 벗기고, 벗겼다는 사실 자체를 플래그로 남긴다.
 *
 * 🔴 `&q` 는 `&quot;` 가 중간에서 잘린 것이다. 엔티티가 안 풀린 채 남는다.
 *    꼬리가 겹쳐 붙는 경우(`…&q..`)가 있어 더 벗길 것이 없을 때까지 반복한다.
 */
const TRUNCATION_TAIL = /(\.\.\.?|…|&[a-zA-Z]{1,6})$/

export function stripTruncationTail(title: string): { truncated: boolean; stem: string } {
  let stem = title.trim()
  let truncated = false
  // 꼬리가 겹쳐 붙는다 — `넘어서길&q..` 는 `..` 를 벗겨야 `&q` 가 드러난다
  for (let i = 0; i < 4; i += 1) {
    const next = stem.replace(TRUNCATION_TAIL, '').trimEnd()
    if (next === stem) break
    stem = next
    truncated = true
  }
  return { truncated, stem }
}

// ─────────────────────────────────────────────────────────
// 어휘 — 좁고 확실한 형태로만 적는다
// ─────────────────────────────────────────────────────────

/**
 * 정치 소재. 🔴 이 플래그는 **거부하지 않는다** — 보여주고 사람이 고른다.
 *
 * `정부` 처럼 넓은 낱말은 넣지 않는다. 실측에서 단독으로 쓰인 예가 없고,
 * 넣는 순간 무관한 글이 딸려 온다.
 */
const POLITICS =
  /(대통령|국회의원|장관|여당|야당|민주당|국민의힘|친명|친윤|검찰|공수처|총선|대선|탄핵|관저|청와대|의원)/g

/**
 * 한자 성 약칭. 언론 제목이 쓰는 형태다 — `李대통령` · `유시민 '李 저격'`.
 * 한글 본문에 홀로 서는 일이 거의 없어 신호가 강하다.
 */
const HANJA_NAME = /[李尹文朴安韓黃曺洪崔鄭姜趙張林]/g

/**
 * 이름 + 직함이 **붙어 있는** 형태 — `유시민작가` · `홍길동의원`.
 *
 * 🔴 공백을 허용하면 `교회 목사` 의 `교회` 를 이름으로 읽는다(실측 오탐).
 *    붙여쓰기로 좁히고, `목사` 처럼 일반명사와 붙어 다니는 직함은 아예 뺀다.
 */
const NAME_WITH_TITLE = /[가-힣]{2,4}(작가|의원|장관|대통령|검사|판사|아나운서|기자)/g

/**
 * 직함이 **앞에** 오는 형태 — `가수 채연` · `배우 아무개`.
 * 이쪽은 직함이 먼저라 일반명사를 이름으로 오인할 여지가 적다.
 */
const TITLE_THEN_NAME = /(가수|배우|작가|감독|아나운서|의원|장관)\s+[가-힣]{2,4}/g

/**
 * 낚시성 제목. 🔴 말줄임을 벗긴 **stem** 에만 적용한다.
 *    `도와주..` 를 낚시로 읽으면 실제 발행된 글이 걸린다(실측).
 */
const CLICKBAIT = /(충격|경악|소름|대박|헉|실화|레알|미쳤|경악|\?{2,}|!{2,}|;;)/g

/**
 * 40대 후반~60대 초반 여성의 생활감.
 *
 * ⚠️ `전세` 를 넣었더니 `전세계` 가 걸렸다(실측 오탐). 좁은 형태로만 적는다.
 * ⚠️ `딸` 은 `딸기` 를 데려온다 — lookahead 로 막는다.
 */
const TARGET_LIFE =
  /(세안|피부|화장품|갱년기|남편|시댁|친정|딸(?!기)|아들|손주|며느리|사위|살림|요리|반찬|김치|장보기|청소|건강|병원|치과|무릎|허리|보험|연금|노후|이삿짐|전세금|전셋집|퇴직|알바|학원|등록금|졸업|결혼|추천해|어디가|하나요|할까요|괜찮을까|좋은가요)/g

/** 1인칭 경험 서술 — 남의 이야기 전달이 아니라 본인이 겪은 것 */
const PERSONAL_EXPERIENCE =
  /(제가|저는|저희|우리집|우리 집|했어요|였어요|봤어요|같아요|싶어요|해왔어요|다녀온|다녀왔|지났어요|겪었|당했)/g

/** 건강 · 돈 · 가족 · 일상의 실제 고민 */
const PRACTICAL_CONCERN =
  /(증상|이물감|통증|아프|아파|병원|치과|약을|보험|연금|대출|월세|전세금|학원|등록금|취업|퇴직|알바|살림|반찬|청소|이사하|전과|진로|수술|검사받)/g

/** 정규식 전역 매칭 결과를 중복 없이 모은다 */
function collect(re: RegExp, text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(re)) out.add(m[0])
  return [...out]
}

/**
 * 본문에서 URL 이 차지하는 글자 비중.
 *
 * ⚠️ `\S+` 로 잡으면 URL 뒤에 공백 없이 이어지는 한글까지 URL 로 센다(fixture ⑲가 잡았다).
 *    `https://example.com/aaa` 뒤에 한글 본문이 바로 붙으면 비중이 100% 로 나온다.
 *    한글이 시작되는 지점에서 끊는다 — 과대평가보다 과소평가가 안전하다.
 *    linkHeavyBody 는 플래그일 뿐이지만, 근거가 틀리면 사람이 룰을 못 고친다.
 */
const URL_RE = /https?:\/\/[^\s가-힣]+/g

export function linkCharRatioOf(body: string): number {
  if (!body.length) return 0
  const urls = body.match(URL_RE) ?? []
  const urlChars = urls.reduce((sum, u) => sum + u.length, 0)
  return urlChars / body.length
}

// ─────────────────────────────────────────────────────────
// 판정
// ─────────────────────────────────────────────────────────

export type QualityInput = {
  originalTitle: string
  sourceCommentCount: number
  /** 🔴 목록 단계에서는 빈 문자열이다. 그때는 본문 플래그를 매기지 않는다 */
  rawBody: string
}

/**
 * 후보 1건의 품질 플래그를 매긴다. 순수 함수 — 같은 입력이면 항상 같은 결과다.
 *
 * 🔴 여기서 아무것도 거부하지 않는다. 플래그와 근거만 돌려준다.
 */
export function assessCandidate(input: QualityInput): QualityAssessment {
  const title = (input.originalTitle ?? '').trim()
  const body = input.rawBody ?? ''
  const commentCount = Number.isFinite(input.sourceCommentCount) ? input.sourceCommentCount : 0
  const stage: QualityStage = body.trim() ? 'detail' : 'list'

  const flags: QualityFlag[] = []
  const matched: Record<string, string[]> = {}
  const note = (key: string, hits: string[]) => {
    if (hits.length) matched[key] = hits
  }

  // ── 제목 ────────────────────────────────────────────
  const { truncated, stem } = stripTruncationTail(title)
  if (truncated) {
    flags.push('titleTruncated')
    note('titleTruncated', [title.slice(-4)])
  }

  const politics = collect(POLITICS, title)
  const hanja = collect(HANJA_NAME, title)
  const nameTitle = collect(NAME_WITH_TITLE, title)
  const titleName = collect(TITLE_THEN_NAME, title)
  const publicFigure = [...politics, ...hanja, ...nameTitle, ...titleName]
  if (publicFigure.length) {
    flags.push('politicalOrPublicFigure')
    note('politicalOrPublicFigure', publicFigure)
  }

  // 🔴 stem 에 적용한다 — 말줄임은 낚시가 아니다
  const clickbait = collect(CLICKBAIT, stem)
  if (clickbait.length) {
    flags.push('clickbaitTitle')
    note('clickbaitTitle', clickbait)
  }

  if (stem.length < SHORT_TITLE_MAX) flags.push('shortTitle')

  const target = collect(TARGET_LIFE, title)
  if (target.length) {
    flags.push('targetLikely')
    note('targetLikely', target)
  }

  // ── 댓글수 ──────────────────────────────────────────
  //    ⚠️ 이 값은 **수집 시점의 스냅샷**이다. 최신 글일수록 0 에 가깝다.
  //       lowEngagement 를 거부 근거로 쓰면 아직 시간이 안 지난 글을 버린다.
  if (commentCount === 0) flags.push('lowEngagement')
  if (commentCount >= HIGH_ENGAGEMENT_MIN) flags.push('highEngagement')

  // ── 본문 (상세 단계에서만) ──────────────────────────
  const bodyLength = body.length
  const bodyLineCount = body.split('\n').filter((l) => l.trim()).length
  const linkCharRatio = linkCharRatioOf(body)

  if (stage === 'detail') {
    if (bodyLength < SHORT_BODY_MAX) flags.push('shortBody')
    if (linkCharRatio >= LINK_HEAVY_RATIO) flags.push('linkHeavyBody')
    if (bodyLength < IMAGE_LIKELY_BODY_MAX && bodyLineCount <= IMAGE_LIKELY_LINE_MAX) {
      flags.push('imageLikelyBody')
    }
    const personal = collect(PERSONAL_EXPERIENCE, body)
    if (personal.length) {
      flags.push('personalExperienceLikely')
      note('personalExperienceLikely', personal.slice(0, 6))
    }
    const practical = collect(PRACTICAL_CONCERN, body)
    if (practical.length) {
      flags.push('practicalConcernLikely')
      note('practicalConcernLikely', practical.slice(0, 6))
    }
  }

  return {
    stage,
    flags,
    signals: { commentCount, titleLength: title.length, bodyLength, bodyLineCount, linkCharRatio, matched },
  }
}

// ─────────────────────────────────────────────────────────
// 정렬 — 창업자가 먼저 볼 것을 위로
// ─────────────────────────────────────────────────────────

/**
 * 선별 점수. 🔴 **순서를 정할 뿐 거부하지 않는다.** 점수가 낮아도 목록에 남는다.
 *
 * 실측 근거: 이 정렬로 25건을 세우면 창업자가 실제로 고른 3건이 전부 상위에 온다.
 * 댓글수만으로 정렬하면 1순위가 `제주도관광 망하겠어요`(댓글 9) 인데,
 * 그 글은 fetch 까지 하고 **발행하지 않았다** — 본문 62자에 URL 이 65% 였다.
 */
export function selectionScore(a: QualityAssessment): number {
  let score = 0
  if (a.flags.includes('targetLikely')) score += 40
  if (a.flags.includes('personalExperienceLikely')) score += 15
  if (a.flags.includes('practicalConcernLikely')) score += 15
  if (a.flags.includes('highEngagement')) score += 20
  else if (!a.flags.includes('lowEngagement')) score += 8

  if (a.flags.includes('politicalOrPublicFigure')) score -= 45
  if (a.flags.includes('clickbaitTitle')) score -= 10
  if (a.flags.includes('shortTitle')) score -= 10
  if (a.flags.includes('shortBody')) score -= 15
  if (a.flags.includes('linkHeavyBody')) score -= 25
  if (a.flags.includes('imageLikelyBody')) score -= 25
  return score
}
