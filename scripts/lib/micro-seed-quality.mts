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
import { findCjkIdeograph } from '../../src/lib/cjk-ideograph'

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
  /** 🔴 실제 한자 문자 — 언어 핏(정치 아님). 제목은 목록 단계, 본문은 상세 단계 */
  | 'hanjaLanguageFit'
  // 목록 단계 — 본문 없이 판정한다
  | 'lowEngagement'
  | 'highEngagement'
  | 'politicalFigure'
  | 'politicalTopicLikely'
  | 'clickbaitTitle'
  | 'shortTitle'
  | 'titleTruncated'
  | 'targetLikely'
  // 제목 · 본문 어디서든 — 있는 텍스트만 본다
  | 'medicalOrAdLikely'
  | 'quotedOrMediaLikely'
  // 상세 단계 — 본문을 읽어야 판정한다
  | 'shortBody'
  | 'linkHeavyBody'
  | 'imageLikelyBody'
  | 'personalExperienceLikely'
  | 'practicalConcernLikely'
  | 'politicalFigureMention'

/**
 * 본문을 읽어야만 판정할 수 있는 플래그. 목록 단계에서는 **매기지 않는다**.
 *
 * 🔴 `medicalOrAdLikely` · `quotedOrMediaLikely` 는 여기 없다.
 *    둘은 제목에서도 드러나기 때문이다 — `눈썹거상은 얼마정도 할까요?` 는 제목만으로 충분하고
 *    `인간극장에 나왔던…` 도 그렇다. **있는 텍스트만 보는 것**은 억지 계산이 아니다.
 *    반대로 `politicalFigureMention` 은 본문 전용이다. 제목 쪽은 `politicalFigure` 가 맡는다.
 */
export const DETAIL_ONLY_FLAGS: readonly QualityFlag[] = [
  'shortBody', 'linkHeavyBody', 'imageLikelyBody', 'personalExperienceLikely', 'practicalConcernLikely',
  'politicalFigureMention',
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
  /(대통령|국회의원|장관|여당|야당|민주당|국민의힘|친명|친윤|검찰|공수처|총선|대선|탄핵|관저|청와대|(?<![한과치])의원(?!\s*(원장|진료|예약|추천))|한덕수|김민석|우원식|오세훈|홍준표|김문수|안철수|유승민|이준석|나경원|원희룡|추미애|조국|이낙연|김동연|정청래|박찬대|장동혁|권성동|송언석|김기현|주호영|천하람|이언주|용혜인|황교안|심상정|김남국|최강욱|명태균|김정숙|최서원|최순실|노무현|김대중|전두환|박정희|이승만|김정은|김여정|김용현|노상원|여인형|곽종근|조희대)/g

/**
 * 정치 · 이념 **주제**. 🔴 `POLITICS` 와 목적이 다르다.
 *
 * `politicalFigure` 는 **정치 인물** 탐지다 — 누가 언급됐는가를 본다(2026-10-04 P0-3 — 연예인 · 방송인은 보지 않는다).
 * 그래서 `나라별 극우의 특징`(4234894, 2026-09-03 실측)을 놓쳤다.
 * 사람 이름도 직함도 없고 **주제만 정치**인 글이다.
 *
 * 🔴 두 축을 한 플래그로 합치지 않는다.
 *    합치면 "실명이 없으니 안전하다" 와 "정치 주제가 아니다" 가 같은 뜻이 되고,
 *    그 순간 이 사례가 다시 새어 나간다.
 *
 * 🔴 **2026-09-03 실측 보강 (PR-S2-b-7)**: 제목에 `정치` 가 그대로 든 행을 놓쳤다.
 *    `정치\s*성향` · `정치\s*글` 만 보고 **단독 `정치` 를 안 봤기** 때문이다.
 *    창업자 결정(정치·진영은 어디로도 가지 않는다)에 맞춰 단독 어휘를 넣었다:
 *    `정치` · `진영` · `이념` · `정당` · `대통령` · `국회` · `여당` · `야당` · `공직자` · `정치인`.
 *    🔴 `선거` 는 넣지 않았다 — 반장 선거 · 동대표 선거가 생활글에 정상적으로 나온다.
 *    (제목 단위 최종 차단은 judgePoliticsTitle 이 `선거` 까지 포함해 따로 본다)
 *
 * 🔴 최소 어휘로 시작한다 — 과차단이 더 나쁘다.
 *    `보수` 는 넣지 않는다(보수공사 · 보수적). `진보` 도 넣지 않는다(진보한다).
 *    `시위` · `집회` · `노조` · `파업` 도 뺐다 — 생활글에서 정상적으로 쓰인다.
 *    이념 진영을 직접 가리키는 말만 남긴다. 후보가 쌓이면 실측으로 넓힌다.
 *
 * 🟢 제목만으로 판정된다 — 그래서 목록 단계 자동 선별이 쓸 수 있다.
 *    이것이 `medicalOrAdLikely` 와 다른 점이다(§DETAIL_ONLY_FLAGS 주석).
 */
const POLITICAL_TOPIC_TERMS = [
  // 2024.12~2026
  '비상계엄', '계엄령', '계엄', '내란수괴', '내란동조', '내란특검', '내란', '체포조', '포고령',
    // 🔴 `파면` 을 뺐다 — "땅을 파면" · "깊이 파면" 이 걸린다.
    //    대통령 파면 맥락은 `탄핵`·`헌재`·`헌법재판소`·`권한대행` 이 이미 잡는다.
  '국회 봉쇄', '무장계엄군', '김건희특검', '채상병특검', '순직해병', '채해병', '헌법재판소', '헌재',
  '권한대행', '조기대선', '6·3 대선', '무기징역', '항소심', '코트패킹', '대법관 증원', '검찰개혁',
  '중수청', '공소청', '검경수사권', '공공기관 지방이전',
  // 인물
  '한덕수', '김민석', '우원식', '오세훈', '홍준표', '김문수', '안철수', '유승민', '이준석', '나경원',
  '원희룡', '추미애', '조국', '이낙연', '김동연', '정청래', '박찬대', '장동혁', '권성동', '송언석',
  '김기현', '주호영', '천하람', '이언주', '용혜인', '황교안', '심상정', '김남국', '최강욱', '명태균',
  '김정숙', '최서원', '최순실', '노무현', '김대중', '전두환', '박정희', '이승만', '김정은', '김여정',
  '김용현', '노상원', '여인형', '곽종근', '조희대',
  // 진영 멸칭·은어
  '태극기부대', '극우유튜브', '좌빨', '빨갱이', '종북', '주사파', '수꼴', '토착왜구', '국짐', '굥', '쥴리',
    // 🔴 **낱말이 짧을수록 일상어를 함께 잡는다** (2026-09-06 실측). `찢` 한 글자는
    //    "바지가 찢어졌어요" 를 정치로 만든다 — 실제로 254자 생활글이 이 한 글자로 hardExclude 됐다.
    //    `수박` 은 여름 생활글에 그대로 나온다. 은어로 쓰인 예보다 과일이 압도적이라 뺐다.
    //    은어를 포기하는 게 아니라 **은어일 때만** 잡는다.
  '이죄명', '찢재명', '찢죄명', '문죄인', '대깨문', '개딸', '문파', '명팔이', '닭근혜', '쥐박이', '틀딱보수',
  '정치병', '기레기', '갈라치기', '선동질', '댓글부대', '댓글매크로',
  // 파벌·계파
    // 🔴 계파명일 때만 잡는다 — 아니면 "남친이랑" · "비명을 질렀어요" 가 정치가 된다.
    //    실측에서 originalRaw 제목 hit 3건 중 2건이 "남친이" 였다.
    //    `586` 도 숫자만으로는 옛 컴퓨터·번호와 부딪혀 `586세대` 로 좁힌다.
  '강성지지층', '팬덤정치', '친문', '친박', '비박', '친이계', '비명계', '반윤', '친한', '친조', '86세대', '586세대',
  '친윤', '친명', '특검', '탄핵',
  '운동권',
  // 사건·의혹
  '조국 자녀 입시', '도이치모터스', '양평고속도로', '대장동', '백현동', '성남FC', '쌍방울', '대북송금',
  '위증교사', '법인카드', '사법리스크', '주가조작', '디올백', '명품백', '국정농단', '블랙리스트', '드루킹',
  '사법농단', '양승태', '라임', '옵티머스', '정경심', '박원순', '안희정', '오거돈',
  // 국회 절차어
  '재의요구권', '필리버스터', '패스트트랙', '방탄국회', '불체포특권', '체포동의안', '안건조정위', '상임위',
  '법사위', '예결위', '대정부질문', '시정연설', '본회의 통과', '직권상정', '거부권',
  // 선거·여론
  '지방선거', '재보궐', '보궐선거', '전당대회', '당대표', '원내대표', '최고위원', '비례대표', '위성정당',
  '컷오프', '단일화', '출구조사', '국정지지율', '정당지지율', '정당 지지율', '정당 정치', '정당 대표', '리얼미터', '부동층', '스윙보터', '갤럽', 'NBS',
    // 🔴 `텃밭`·`험지` 를 뺐다 — 선거 은어이기 전에 **밭이고 산길**이다("텃밭 가꿔요").
    //    단독으로 정치를 가리키는 경우는 위 지지율·선거 어휘와 늘 함께 나온다.
  // 정당
  '더불어민주연합', '통합진보당', '민주노동당', '기본소득당', '사회민주당', '자유통일당', '민주당',
  '더불어민주당', '국민의힘', '조국혁신당', '개혁신당', '정의당', '진보당', '새누리당', '한나라당',
    // 🔴 단독 `정당` 을 뺐다 — "정당한 요구" · "정당방위" 가 걸린다.
    //    개별 정당명이 위에 전부 있고 `정당지지율`·`위성정당` 도 따로 있다.
    '열린우리당', '국민의미래',
  // 정책·법안
  '중대재해처벌법', '임대차3법', '양곡관리법', '상법개정', '배임죄', '방송3법', '언론중재법', '최저임금',
  '주52시간', '전세사기', '재초환', '탈원전', '원전', '4대강', '간호법', '김영란법', '부자감세',
  '세수결손', '지역화폐', '기본소득', '상속세', '유류세', '전공의', '의료대란', '의협', '추경',
  '연금개혁', '금투세', '종부세', '의대증원', '노란봉투법',
  // 외교·안보
  '한미연합훈련', '방위비분담금', '9·19 군사합의', '우크라이나 파병', '반도체 관세', '후쿠시마오염수',
  '한미동맹', '전작권', '주한미군', '강제징용', '제3자 변제', '독도', '욱일기', '반일', '친일', '죽창가',
  '반중', '친중', '대북전단', '오물풍선', '무인기', '트럼프', '상호관세', '북핵문제', '북핵', '사드',
  '대북', '한일관계', '위안부',
  // 기관·언론
  '중앙선관위', '가로세로연구소', '사랑제일교회', '선관위', '감사원', '국정원', '방첩사', '수방사',
  '특전사', '방통위', '방심위', '인권위', '권익위', '뉴스공장', '서울의소리', '신의한수', '나꼼수',
  '주진우', '김용민', '최배근', '전한길', '서정욱', '배승희', '전광훈', '언론장악', '공영방송',
  '가짜뉴스', '여론조사',
  // 집회·이념 기본축
  '촛불집회', '태극기집회', '광화문집회', '탄핵집회', '단식농성', '서초동', '삭발',
  '극우', '극좌', '좌파', '우파', '수구', '친일파', '태극기 부대', '진영 논리', '정치 성향', '이념 갈등',
  '정치 글', '정치', '진영', '이념', '선거', '대선', '대통령', '국회', '의원직', '여당', '야당', '공직자', '정치인',
] as const

const POLITICAL_TOPIC_SPECIAL_SOURCES: Partial<Record<(typeof POLITICAL_TOPIC_TERMS)[number], string>> = {
  // 우나어 실측 회귀: "감사드립니다/사드릴까"의 `사드` 오탐 차단.
  '사드': String.raw`(?<![가-힣])사드(?![리려렸립린릴림])`,
  // "깍깍대선"류 오탐 차단. 조기대선/대선후보 같은 복합어는 별도 키워드가 잡는다.
  '대선': String.raw`(?<![가-힣])대선(?![가-힣])`,
  // 선거 자체는 정치 신호지만 반장/동대표 선거는 생활 문맥이라 통과시킨다.
  '선거': String.raw`(?<!반장)(?<!반장\s)(?<!동대표)(?<!동대표\s)선거`,
  // 🔴 `친한` 단독 매칭은 **생활 표현을 정치로 오인한다** (2026-09-05 실측 정정).
  //    "정말친한친구와 수다떠시나요" 가 politics hardExclude 됐다 — 레테·우갱·82cook
  //    생활글이 통째로 제외될 수 있다.
  //    친한계·친한파(親韓)는 정치어가 맞으므로 **정치 맥락에서만** 잡는다.
  //    🟢 통과: 친한 친구 · 친한 언니 · 친한 동생 · 친한 엄마 · 친한 지인 · 친한 사이
  //    🔴 차단: 친한계 · 친한파 · 친한동훈 · 친한 후보/의원/인사/지도부/세력
  '친한': String.raw`친한[계파](?![가-힣])|친한\s?(?:동훈|후보|의원|인사|지도부|세력|측근|주자|당대표|원내대표)`,
  // 🔴 `친윤` · `친명` 은 앞에 한글이 붙으면 생활 표현일 수 있다 (2026-09-05 실측).
  //    "모친명의로 된 집" · "모친명절 준비" 가 친명으로 잡혔다 —
  //    이 커뮤니티는 상속·부동산·명절 글이 많아 실제 위험이다.
  //    🟢 통과: 모친명의 · 모친명절 · 절친윤아
  //    🔴 차단: 친윤계 · 친윤파 · 친윤 의원 · 친명계 · 친명 후보 (앞이 공백/문두)
  '친윤': String.raw`(?<![가-힣])친윤`,
  '친명': String.raw`(?<![가-힣])친명`,
  // 🔴 `조국` 은 일반명사다 — "내 조국을 떠나 살면서" · "조국에 돌아가고 싶어요" 는 생활글이다(2026-10-04 창업자 확정).
  //    사람 문맥(전 장관 · 대표 · 의원 · 후보 …)에서만 정치 인물이다. `조국혁신당` · `조국 자녀 입시` 는 따로 있다.
  '조국': String.raw`조국(?=\s*(?:전\s*)?(?:장관|대표|의원|후보|교수|일가))`,
  // 🔴 `특검사` 는 검사(檢査) 맥락이다 — "건강검진 특검사" 가 잡혔다.
  //    다만 "특검사건" 은 정치이므로 살린다.
  '특검': String.raw`특검(?!사(?!건))`,
}

function escapedKeywordSource(term: string): string {
  return term
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, String.raw`\s*`)
}

const POLITICAL_TOPIC = new RegExp(
  POLITICAL_TOPIC_TERMS
    .map((term) => POLITICAL_TOPIC_SPECIAL_SOURCES[term] ?? escapedKeywordSource(term))
    .join('|'),
  'g',
)

/**
 * 🔴 **생활에도 쓰이는 정책 낱말 — 단독으로는 정치 근거가 아니다** (2026-10-04 창업자 확정 · P0-3 최종).
 *    창업자 목록(`POLITICAL_TOPIC_TERMS` 정책·법안 묶음)에 그대로 남는다. 다만 **이 낱말만** 있는 제목 · 본문은
 *    월급 · 전세 · 세금 · 연금 · 병원 이야기다 — 정치인 · 정당 · 후보 · 선거 · 유세 · 캠페인 같은 다른 정치 신호가 함께
 *    있을 때만 정치다(그때는 그 신호가 판정한다). 의미 판정의 `politicalCampaigning` 은 따로 막는다.
 */
export const POLICY_CONTEXT_TERMS: readonly string[] = [
  '최저임금', '주52시간', '전세사기', '상속세', '유류세', '연금개혁', '종부세', '의료대란', '전공의', '의대증원',
]

/** 🔴 정치 주제 판정 — 창업자 목록 하나. 생활 정책 낱말만 걸리면 `null` */
export function findPoliticalTopicHit(text: string): string | null {
  return collect(POLITICAL_TOPIC, text).find((h) => !POLICY_CONTEXT_TERMS.includes(h)) ?? null
}

/**
 * 📜 **`HANJA_NAME`(한자 성 한 글자 = 정치인)을 지웠다** (2026-10-04 P0-3 최종). `朴나래` 를 정치인으로 읽었다.
 *    실제 한자가 든 글은 정치가 아니라 언어 핏으로 막는다(`cjk-ideograph.findCjkIdeograph` · `hanjaLanguageFit`).
 */

/**
 * 이름 + 직함이 **붙어 있는** 형태 — `유시민작가` · `홍길동의원`.
 *
 * 🔴 공백을 허용하면 `교회 목사` 의 `교회` 를 이름으로 읽는다(실측 오탐).
 *    붙여쓰기로 좁히고, `목사` 처럼 일반명사와 붙어 다니는 직함은 아예 뺀다.
 */
const NAME_WITH_TITLE = /[가-힣]{2,4}(?<![한과치])(의원|장관|대통령)/g

/**
 * 직함이 **앞에** 오는 형태 — `가수 채연` · `배우 아무개`.
 * 이쪽은 직함이 먼저라 일반명사를 이름으로 오인할 여지가 적다.
 */
const TITLE_THEN_NAME = /((?<![한과치])의원(?!\s*(원장|진료|예약|추천))|장관)\s+[가-힣]{2,4}/g

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
  /(세안|피부|화장품|갱년기|남편|시댁|친정|딸(?!기)|아들|손주|며느리|사위|살림|요리|반찬|김치|장보기|청소|건강검진|건강|약국|약값|영양제|비타민|관절|병원|치과|무릎|허리|보험|연금|노후|이삿짐|전세금|전셋집|퇴직|알바|학원|등록금|졸업|결혼|추천해|어디가|하나요|할까요|괜찮을까|좋은가요)/g

/**
 * 1인칭 경험 서술 — 남의 이야기 전달이 아니라 본인이 겪은 것.
 *
 * ⚠️ `제가` 는 **어절 앞에서만** 1인칭이다.
 *    `영양제가` · `문제가` · `형제가` 안에도 `제가` 가 들어 있다(fixture ㉙ 가 잡았다).
 *    한국어에는 단어 경계(\b)가 없으므로 앞 글자가 한글이 아닐 때만 센다.
 *    `저는` · `저희` 도 같은 이유로 함께 막는다.
 */
const PERSONAL_EXPERIENCE =
  /((?<![가-힣])(제가|저는|저희)|우리집|우리 집|했어요|였어요|봤어요|같아요|싶어요|해왔어요|다녀온|다녀왔|지났어요|겪었|당했)/g

/** 건강 · 돈 · 가족 · 일상의 실제 고민 */
const PRACTICAL_CONCERN =
  /(증상|이물감|통증|아프|아파|병원|치과|약을|보험|연금|대출|월세|전세금|학원|등록금|취업|퇴직|알바|살림|반찬|청소|이사하|전과|진로|수술|검사받)/g

// ─────────────────────────────────────────────────────────
// 본문 위험 신호 (Q-1 보강)
//
// 🔴 이 셋도 **거부하지 않는다.** 4232047 이 계기다 —
//    제목만으로는 깨끗해 보여 score 75 로 상위권이었는데,
//    본문 첫 줄이 "장영란이 눈썹거상했다면서요" 였고 피부과와 가격 문의가 이어졌다.
//    사람이 본문을 읽어야만 걸러졌다. 그 판단을 플래그로 앞당긴다.
// ─────────────────────────────────────────────────────────

/** 의료 시설 */
const MEDICAL_FACILITY =
  /(성형외과|피부과|정형외과|산부인과|안과|이비인후과|한의원|치과|클리닉|의원|병원)/g

/** 시술 · 수술 이름 */
const MEDICAL_PROCEDURE =
  /(거상|리프팅|보톡스|필러|임플란트|레이저|시술|성형|쌍꺼풀|지방흡입|스케일링|교정|주사|수술)/g

/** 가격을 묻거나 밝히는 표현 */
const PRICE_ASK = /(얼마|비용|가격|견적|시술비|수술비|\d[\d,]*\s*만원)/g

/**
 * 상업 유도. 🔴 이건 **단독으로도** 신호다 — 가격 질문 없이도 광고에 가깝다.
 */
const COMMERCIAL_PROMO = /(할인|쿠폰|공구|협찬|프로모션|이벤트\s*참여|구매\s*링크|주문\s*링크|체험단)/g

/**
 * 전언 · 인용 · 방송 소재.
 *
 * 🔴 personalExperienceLikely 와 **분리해서** 표시한다.
 *    "장영란이 …했다면서요" 도 "저는 …싶어요" 도 한 글에 같이 나온다.
 *    남 이야기로 시작해 내 고민으로 이어지는 글은 흔하다 — 어느 한쪽으로 뭉개면 판단이 흐려진다.
 *
 * ⚠️ `더라구요` 는 넣지 않는다. "가봤더니 좋더라구요" 처럼 본인 경험에도 쓰여 오탐이 난다.
 *    대신 **명시적으로 경험이 아니라고 말하는 표현**만 넣는다.
 */
const QUOTED_MEDIA =
  /(라면서요|다면서요|라던데|다던데|나왔다던데|나왔던|나왔다는|기사에|뉴스에|방송에|인간극장|유튜브에서|카더라|들은\s*얘기|들었는데|가보진\s*않|안\s*가봤|해보진\s*않|본\s*적은\s*없)/g

/**
 * 정치 인물 이름 사전 — 🔴 **불완전하다.** (2026-10-04 P0-3: 실측 연예 · 방송 이름 `장영란` · `박수홍` · `채연` · `헬마우스` 는 뺐다 —
 * 공인 이름은 막을 사유가 아니다. 정치 인물만 남긴다)
 *
 * 이름 단독(`장영란` · `박수홍` · `유시민`)은 사전 없이 정규식으로 잡을 수 없다.
 * 실측에서 실제로 나온 이름만 넣는다. 여기 없는 이름은 **못 잡는다** —
 * 그래서 이 플래그가 비어 있다고 "실명이 없다"로 읽으면 안 된다.
 * 근본 해결은 M4(Voice Engine) 영역이고, 여기서는 반복 등장하는 것만 앞당겨 잡는다.
 */
const KNOWN_POLITICAL_FIGURES =
  /(유시민|이재명|이준석|김민석|인요한|조성은)/g

/**
 * 🔴 **정치 인물 탐지 — 수집기 · 안전 필터 · 82cook · 네이버카페가 이 함수 하나를 쓴다** (2026-10-04 P0-3).
 *    정치인 · 정당 · 직함(의원 · 장관 · 대통령) · 실측 정치 인물만 본다(한자 약칭은 언어 핏이 막는다).
 *    🔴 연예인 · 배우 · 가수 · 방송인 · 작가 · 감독 · 아나운서 · 기자는 보지 않는다 — 공인 이름은 위해가 아니라 소재다.
 *       위해(루머 단정 · 명예훼손 · 사생활 · 가족 공격 · 괴롭힘 · 혐오 · 위협)는 안전 필터 · 의미 판정의 별도 hard gate 가 본다.
 *    🔴 `한의원` · `피부과의원` · `치과의원` 은 병원이다 — 직함 `의원` 으로 읽지 않는다.
 */
export function findPoliticalFigureHits(text: string): string[] {
  // 🔴 창업자 주제 목록(`POLITICAL_TOPIC_TERMS`)과 겹치는 낱말(친명 · 친윤 · 대선 · 민주당 …)은 **주제 판정이 정본**이다 —
  //    그 목록은 생활 오탐 경계(`모친명의` · `깍깍대선`)를 이미 다듬었다. 여기서 거친 부분 문자열로 다시 잡지 않는다.
  const topicTerms = POLITICAL_TOPIC_TERMS as readonly string[]
  return [...new Set([
    ...collect(POLITICS, text).filter((h) => !topicTerms.includes(h)),
    ...collect(NAME_WITH_TITLE, text), ...collect(TITLE_THEN_NAME, text), ...collect(KNOWN_POLITICAL_FIGURES, text),
  ])]
}

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

  // 🔴 정치 인물만 — 연예인 · 방송인 이름은 플래그가 아니다(P0-3)
  const politicalFigure = findPoliticalFigureHits(title)
  if (politicalFigure.length) {
    flags.push('politicalFigure')
    note('politicalFigure', politicalFigure)
  }

  // 🔴 공인·실명과 **별도 축**이다. 제목만 본다 — 목록 단계 자동 선별이 쓸 수 있어야 한다
  // 🔴 정치 판정 authority 하나(`findPoliticalTopicHit`) — 생활 정책 낱말만 걸리면 플래그가 아니다. 근거에는 걸린 낱말 전부를 남긴다
  const politicalTopic = findPoliticalTopicHit(title) === null ? [] : collect(POLITICAL_TOPIC, title)
  if (politicalTopic.length) {
    flags.push('politicalTopicLikely')
    note('politicalTopicLikely', politicalTopic)
  }

  // 🔴 stem 에 적용한다 — 말줄임은 낚시가 아니다
  const clickbait = collect(CLICKBAIT, stem)
  if (clickbait.length) {
    flags.push('clickbaitTitle')
    note('clickbaitTitle', clickbait)
  }

  // 🔴 언어 핏 — 사용자에게 보이는 제목 · 본문의 실제 한자 문자(정치 판정과 별개 · shared helper 하나)
  const hanja = findCjkIdeograph(title) ?? findCjkIdeograph(body)
  if (hanja !== null) {
    flags.push('hanjaLanguageFit')
    note('hanjaLanguageFit', [hanja])
  }

  if (stem.length < SHORT_TITLE_MAX) flags.push('shortTitle')

  const target = collect(TARGET_LIFE, title)
  if (target.length) {
    flags.push('targetLikely')
    note('targetLikely', target)
  }

  // ── 제목 + 본문 공통 ────────────────────────────────
  //    있는 텍스트만 본다. 목록 단계에서는 제목뿐이고, 그것이 억지 계산은 아니다.
  const both = `${title}\n${body}`

  // 🔴 시설·시술만으로는 붙이지 않는다.
  //    `턱관절치과 다녀온후…` 는 실제로 발행한 좋은 후보였다 — 그런 글까지 위험으로 칠하면
  //    플래그가 소음이 되고, 소음이 되면 사람이 안 본다.
  //    가격을 묻는 순간 성격이 달라진다(4232047). 상업 유도는 그 자체로 신호다.
  const facility = collect(MEDICAL_FACILITY, both)
  const procedure = collect(MEDICAL_PROCEDURE, both)
  const price = collect(PRICE_ASK, both)
  const promo = collect(COMMERCIAL_PROMO, both)
  const medicalWithPrice = (facility.length > 0 || procedure.length > 0) && price.length > 0
  if (medicalWithPrice || promo.length) {
    flags.push('medicalOrAdLikely')
    note('medicalOrAdLikely', [...facility, ...procedure, ...price, ...promo].slice(0, 6))
  }

  const quoted = collect(QUOTED_MEDIA, both)
  if (quoted.length) {
    flags.push('quotedOrMediaLikely')
    note('quotedOrMediaLikely', quoted.slice(0, 6))
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

    // 🔴 제목이 깨끗해도 본문에 사람 이름이 있다 — 4232047 이 그랬다.
    //    politicalFigure 는 제목만 본다. 본문 쪽은 여기서 따로 센다 — 정치 인물만(P0-3)
    const bodyFigure = findPoliticalFigureHits(body)
    if (bodyFigure.length) {
      flags.push('politicalFigureMention')
      note('politicalFigureMention', bodyFigure.slice(0, 6))
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

  if (a.flags.includes('politicalFigure')) score -= 45
  // 🔴 실명이 없어도 정치 주제면 우리 커뮤니티 글이 아니다 (4234894 실측)
  if (a.flags.includes('politicalTopicLikely')) score -= 45
  // 🔴 제목이 깨끗해도 본문에 이름이 나오면 성격이 달라진다 (4232047)
  if (a.flags.includes('politicalFigureMention')) score -= 30
  if (a.flags.includes('medicalOrAdLikely')) score -= 25
  // 남 이야기는 우리 회원의 경험담이 아니다. 버리지는 않되 뒤로 민다
  if (a.flags.includes('quotedOrMediaLikely')) score -= 10
  if (a.flags.includes('clickbaitTitle')) score -= 10
  if (a.flags.includes('shortTitle')) score -= 10
  if (a.flags.includes('shortBody')) score -= 15
  if (a.flags.includes('linkHeavyBody')) score -= 25
  if (a.flags.includes('imageLikelyBody')) score -= 25
  return score
}
