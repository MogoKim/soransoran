/**
 * 60일 주제 캘린더 (v2)
 *
 * 이 파일은 drafts 전용이다. 런타임에서 import 하지 않는다.
 * 행이 들어오는 길은 둘이다 — 기존 행(사람이 만들었다)과 G8 편입기
 * (`scripts/magazine-g8-promote.mjs`)가 M-GRAPH 연구 정본에서 옮긴 행(`intentId`·`g8ManifestHash` 를 단다).
 * 어느 쪽도 AI 가 주제를 새로 지어내지 않는다 — 편입기는 조사·판정이 끝난 의도만 옮기고
 * 필수 필드가 정본에 없으면 넣지 않는다. 행마다 사람이 승인하는 단계는 없다 (M-GRAPH 헌장 §3-B).
 *
 * 🔴 매거진은 SEO 글 생산기가 아니라 커뮤니티 성장 엔진이다.
 *    North Star 는 4050/5060 여성이 소란소란에서 자기 이야기를 남긴 횟수다.
 *    모든 항목은 "이 글이 회원이 글·댓글을 쓰게 만드는가"를 통과해야 한다.
 *
 * v1 → v2 변경
 *   · 27건 → 60건 (producer 가 소비할 재료를 51일분으로 늘린다)
 *   · 필드명 정리: searchIntent→intent · targetReader→target
 *                  imageNeeded→imageMode · ctaTarget→ctaBoard
 *   · 추가: contentType · season · calendarEvent · publishWindow · autoEligible
 *   · PUBLISHED_SLUGS 제거 — 아무도 읽지 않는 죽은 export 였다.
 *     발행분 대조는 magazine-qa.mjs 가 articles.ts 를 직접 읽어서 한다(그쪽이 정본).
 *
 * day 번호는 큐 안에서만 쓰는 고유번호다. 발행하면 그 항목을 지우고 재번호하지 않는다.
 * 언제 공개할지는 day 가 아니라 publishWindow 와 재고(scripts/magazine-inventory.mjs)가 정한다.
 *
 * 읽기용 요약본: docs/operations/2026-08-23-soransoran-magazine-seo-production-strategy.md §7·§8
 * 검수 깊이 정의: docs/operations/2026-08-23-soransoran-magazine-strategy.md 원칙 5 · §5.1
 */
import type { MagazineCluster } from '@/content/magazine/types'

/** 검수 깊이를 정한다. 등급을 낮출 수 없는 조건은 매거진 전략 §5.2. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

/** riskLevel 에서 파생되지만, 자동 QA FAIL 이면 FULL_REVIEW 로 승격된다. */
export type ReviewMode = 'SUMMARY_ONLY' | 'RISK_SENTENCES' | 'FULL_REVIEW'

/** hero 가 없으면 og:image 키가 생략되고 twitter:card 가 summary 로 떨어진다. */
export type ImageMode = 'REQUIRED' | 'OPTIONAL' | 'NO_IMAGE'

export type SearchIntent = '질문' | '방법' | '비교' | '계산' | '상황'

/** 내부 경로만 쓴다. 외부 링크는 본문에도 큐에도 두지 않는다. */
export type CtaBoard = '/community/menopause' | '/community/free'

/**
 * 전략 §7.1 비율 — EVERGREEN 60% · SEASONAL 25% · COMMUNITY 15%
 *   EVERGREEN  언제 검색해도 유효한 질문. 유입의 기반
 *   SEASONAL   특정 시기에 수요가 몰린다. publishWindow 를 반드시 둔다
 *   COMMUNITY  게시판에 실제로 올라온 질문에서 뽑는다
 */
export type ContentType = 'EVERGREEN' | 'SEASONAL' | 'COMMUNITY'

export type Season = '봄' | '여름' | '가을' | '겨울' | '환절기'

/**
 * 계절 주제가 철을 놓치지 않게 하는 창.
 * after  이 날짜 전에는 예약하지 않는다 (너무 일찍 내면 검색이 아직 없다)
 * before 이 날짜가 지나면 건너뛴다 (철 지난 글이 나가는 사고를 데이터가 거부한다)
 * 전략 §7.4 — 검색은 이벤트 당일이 아니라 준비하는 기간에 일어난다. 2~4주 전에 발행한다.
 */
export type PublishWindow = { after: string; before: string }

export type TopicQueueItem = {
  /** 큐 안에서만 쓰는 고유번호. 날짜가 아니다 */
  day: number
  /** 영문 kebab-case. 발행 시 articles.ts 의 레코드 key 가 된다 */
  slug: string
  title: string
  contentType: ContentType
  intent: SearchIntent
  cluster: MagazineCluster
  target: string
  /**
   * 🔴 **검증 강도** (M3-A). 발행 차단 등급이 아니다.
   *    신규 항목은 이 값을 **반드시** 달고 온다.
   *    기존 26건은 값이 없어도 `scripts/lib/magazine-validation-profile.mjs` 의
   *    호환 표가 받는다 — 그 표에 새 주제를 추가하지 않는다.
   */
  validationProfile?: 'STANDARD' | 'MEDICAL' | 'FINANCIAL' | 'SENSITIVE'
  riskLevel: RiskLevel
  reviewMode: ReviewMode
  imageMode: ImageMode
  /**
   * 🔴 **호환 필드다** (M3-A). 아무 판정에도 쓰이지 않는다 — 값이 무엇이든
   *    자동 진행·등록·공개는 달라지지 않는다. 판정은 `validationProfile` 과
   *    결정론적 QA 가 한다. 기존 26행의 값을 보존하려고 남겨 둔 것뿐이다.
   */
  autoEligible: boolean
  /** 없으면 단발 글 */
  seriesId?: string
  /** 같은 seriesId 안에서 유일 */
  seriesOrder?: number
  season?: Season
  /** 추석·건강검진·김장·연말정산 같은 구체 이벤트 */
  calendarEvent?: string
  /** SEASONAL 은 반드시 둔다 */
  publishWindow?: PublishWindow
  ctaBoard: CtaBoard
  /** 본문·하단에서 이을 대상. 메뉴 링크가 아니라 contextual 링크다 */
  internalLinks: string[]
  whyNow: string
  notes: string
  /**
   * M-GRAPH 의도 식별자. G8 편입기(`scripts/magazine-g8-promote.mjs`)가 넣은 행에만 있다.
   * intentId ↔ slug 는 영구 1:1 이다 (연구 contract/m3-slug-manifest.json).
   */
  intentId?: string
  /** 이 행을 만든 G8 manifest 해시. 그래프 장부(m3-state.jsonl) ADMITTED 행과 같은 값이어야 한다 */
  g8ManifestHash?: string
}

export const TOPIC_QUEUE: TopicQueueItem[] = [
  {
    day: 22,
    slug: 'palpitations-menopause',
    title: '갱년기 심장이 두근거릴 때',
    contentType: 'EVERGREEN',
    intent: '상황',
    cluster: 'menopause-symptom',
    target: '40대 후반~50대 중반',
    riskLevel: 'HIGH',
    reviewMode: 'FULL_REVIEW',
    imageMode: 'REQUIRED',
    autoEligible: false,
    ctaBoard: '/community/menopause',
    internalLinks: ['which-clinic-menopause'],
    whyNow: '심장 걱정으로 검색이 몰리는 증상이다',
    notes: 'HIGH — 최고 위험. 위험 신호(흉통·호흡곤란·실신) 안내를 반드시 넣는다',
  },
  {
    day: 27,
    slug: 'dinner-change-two-weeks',
    title: '저녁 식사를 바꿔 본 2주',
    contentType: 'EVERGREEN',
    intent: '방법',
    cluster: 'daily',
    target: '40대 후반~50대',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    seriesId: 'body-change',
    seriesOrder: 4,
    ctaBoard: '/community/menopause',
    internalLinks: ['belly-fat-menopause'],
    whyNow: '경험 기록형. 식단 처방을 피하면서 실천을 다룰 수 있다',
    notes: '특정 식단을 처방하지 않는다. 영양제는 언급조차 하지 않는다',
  },
  {
    day: 30,
    slug: 'restart-exercise-menopause',
    title: '갱년기에 운동을 다시 시작하며',
    contentType: 'EVERGREEN',
    intent: '방법',
    cluster: 'daily',
    target: '40대 후반~50대',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    seriesId: 'body-change',
    seriesOrder: 5,
    ctaBoard: '/community/menopause',
    internalLinks: ['walking-minutes-50s', 'menopause-joint-pain-exercise'],
    whyNow: 'body-change 완결. 30일 큐를 커뮤니티 전환으로 닫는다',
    notes: '운동 프로그램을 제시하지 않는다. 다시 시작하는 마음까지가 범위다',
  },
  {
    day: 35,
    slug: 'cold-weather-joint-pain',
    title: '날씨 쌀쌀해지면 무릎이 시린 이유',
    contentType: 'SEASONAL',
    intent: '질문',
    cluster: 'menopause-symptom',
    target: '40대 후반~60대 중반',
    riskLevel: 'MEDIUM',
    reviewMode: 'RISK_SENTENCES',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    season: '환절기',
    publishWindow: { after: '2026-09-01', before: '2026-11-20' },
    ctaBoard: '/community/menopause',
    internalLinks: ['menopause-joint-pain-exercise', 'after-menopause-body'],
    whyNow: '기온이 떨어지는 10~11월 검색 상승 구간',
    notes: '관절염으로 단정하지 않는다. 날씨와 통증의 관계를 인과로 확정하지 않는다',
  },
  {
    day: 36,
    slug: 'dizziness-menopause',
    title: '갱년기에 어지럼증이 생기는 이유',
    contentType: 'EVERGREEN',
    intent: '질문',
    cluster: 'menopause-symptom',
    target: '40대 후반~60대 중반',
    riskLevel: 'HIGH',
    reviewMode: 'FULL_REVIEW',
    imageMode: 'OPTIONAL',
    autoEligible: false,
    ctaBoard: '/community/menopause',
    internalLinks: ['palpitations-menopause'],
    whyNow: '어지럼증은 검색량이 크지만 감별이 필요해 신중히 다룬다',
    notes: 'HIGH — 빈혈·이석증·심혈관 등 감별이 필요하다. 원인을 갱년기로 단정하지 않고, 진료를 권하는 문장을 반드시 둔다',
  },
  {
    day: 38,
    slug: 'autumn-low-mood',
    title: '가을만 되면 마음이 가라앉는 이유',
    contentType: 'SEASONAL',
    intent: '질문',
    cluster: 'emotion',
    target: '40대 중반~60대 중반',
    riskLevel: 'MEDIUM',
    reviewMode: 'RISK_SENTENCES',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    season: '가을',
    publishWindow: { after: '2026-09-01', before: '2026-11-15' },
    ctaBoard: '/community/menopause',
    internalLinks: ['menopause-tears', 'no-motivation-50s'],
    whyNow: '일조량이 줄기 시작하는 9~10월 진입',
    notes: '계절성 우울장애로 단정하지 않는다. 진단명을 붙이지 않는다',
  },
  {
    day: 41,
    slug: 'hardest-part-of-menopause',
    title: '갱년기에 제일 힘든 건 무엇일까',
    contentType: 'COMMUNITY',
    intent: '상황',
    cluster: 'menopause-symptom',
    target: '40대 후반~60대 중반',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    ctaBoard: '/community/menopause',
    internalLinks: ['menopause-tears'],
    whyNow: '증상 나열이 아니라 경험을 부르는 형태. 댓글 전환이 높다',
    notes: '발행 전 갱년기톡에서 유사 글을 확인한다. 증상 심각도를 비교하거나 서열화하지 않는다',
  },
  {
    day: 43,
    slug: 'kimjang-back-pain-prep',
    title: '김장 앞두고 허리가 걱정될 때',
    contentType: 'SEASONAL',
    intent: '상황',
    cluster: 'family',
    target: '50대~60대 중반',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    season: '겨울',
    calendarEvent: '김장',
    publishWindow: { after: '2026-10-15', before: '2026-12-05' },
    ctaBoard: '/community/free',
    internalLinks: ['after-holiday-body-ache'],
    whyNow: '김장 준비는 11월 검색이 몰린다. 2~4주 전 발행',
    notes: '김장을 해야 한다고 전제하지 않는다. 안 하는 선택도 자연스럽게 둔다',
  },
  {
    day: 44,
    slug: 'things-not-told-to-children',
    title: '자식한테는 말 못 하는 이야기',
    contentType: 'COMMUNITY',
    intent: '상황',
    cluster: 'family',
    target: '50대~60대 중반',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    ctaBoard: '/community/free',
    internalLinks: ['empty-nest-quiet'],
    whyNow: '소란소란이 왜 필요한지를 그대로 보여주는 주제',
    notes: '발행 전 자유게시판에서 유사 글을 확인한다. 가족 관계를 문제로 규정하지 않는다',
  },
  {
    day: 47,
    slug: 'national-pension-voluntary',
    title: '전업주부도 국민연금을 넣을 수 있나요?',
    contentType: 'SEASONAL',
    intent: '질문',
    cluster: 'money-work',
    target: '40대 중반~60대 중반',
    riskLevel: 'MEDIUM',
    reviewMode: 'RISK_SENTENCES',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    season: '겨울',
    calendarEvent: '연말 돈 정리',
    publishWindow: { after: '2026-10-20', before: '2027-01-31' },
    ctaBoard: '/community/free',
    internalLinks: ['health-insurance-after-retire'],
    whyNow: '연말에 노후 준비를 점검하는 흐름과 맞는다',
    notes: '가입을 권하지 않는다. 금액·수령액을 계산해 제시하지 않고 제도 개요까지만 둔다',
  },
  {
    day: 49,
    slug: 'heating-sleep-waking',
    title: '난방 켜고 자면 왜 더 자주 깰까요?',
    contentType: 'SEASONAL',
    intent: '질문',
    cluster: 'sleep',
    target: '40대 후반~60대 중반',
    riskLevel: 'MEDIUM',
    reviewMode: 'RISK_SENTENCES',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    season: '겨울',
    publishWindow: { after: '2026-10-25', before: '2027-02-20' },
    ctaBoard: '/community/menopause',
    internalLinks: ['night-sweats-waking', 'what-not-to-do-when-cant-sleep'],
    whyNow: '난방 시작 시기. 갱년기 열감과 겹쳐 검색이 는다',
    notes: '실내 온도를 숫자로 단정하지 않는다. 수면제·보조제를 권하지 않는다',
  },
  {
    day: 50,
    slug: 'breast-exam-interval',
    title: '유방 검진은 몇 년마다 받나요?',
    contentType: 'EVERGREEN',
    intent: '질문',
    cluster: 'clinic',
    target: '40대 중반~60대 중반',
    riskLevel: 'HIGH',
    reviewMode: 'FULL_REVIEW',
    imageMode: 'OPTIONAL',
    autoEligible: false,
    ctaBoard: '/community/free',
    internalLinks: ['checkup-items-50s', 'national-checkup-eligibility'],
    whyNow: '검진 주기는 검색 의도가 명확하고 신뢰 형성에 유리하다',
    notes: 'HIGH — 주기를 단정하지 않는다. 국가검진 기준과 개인 상황을 섞지 않고, 판단은 의료진에게 남긴다',
  },
  {
    day: 51,
    slug: 'clinic-or-wait',
    title: '병원에 가야 할지 참아야 할지 고민될 때',
    contentType: 'COMMUNITY',
    intent: '상황',
    cluster: 'clinic',
    target: '40대 중반~60대 중반',
    riskLevel: 'MEDIUM',
    reviewMode: 'RISK_SENTENCES',
    imageMode: 'OPTIONAL',
    autoEligible: false,
    ctaBoard: '/community/menopause',
    internalLinks: ['which-clinic-menopause'],
    whyNow: '진료를 미루는 마음은 게시판에서 자주 보이는 주제',
    notes: '자동 예약 제외 — 진료 여부 판단을 다루므로 창업자 확인이 필요하다. 참으라는 방향으로 읽히지 않게 쓴다',
  },
  {
    day: 53,
    slug: 'how-much-talk-with-husband',
    title: '요즘 남편과 하루에 몇 마디 하시나요',
    contentType: 'COMMUNITY',
    intent: '상황',
    cluster: 'relationship',
    target: '50대~60대 중반',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    ctaBoard: '/community/free',
    internalLinks: ['husband-doesnt-understand'],
    whyNow: '수치가 아니라 경험을 묻는 형태. 댓글이 붙기 쉽다',
    notes: '발행 전 자유게시판에서 유사 글을 확인한다. 부부 관계를 평가하지 않는다',
  },
  {
    day: 55,
    slug: 'year-end-loneliness',
    title: '연말이 되면 유독 허전한 마음',
    contentType: 'SEASONAL',
    intent: '상황',
    cluster: 'emotion',
    target: '40대 중반~60대 중반',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    season: '겨울',
    calendarEvent: '송년',
    publishWindow: { after: '2026-11-20', before: '2026-12-31' },
    ctaBoard: '/community/free',
    internalLinks: ['no-motivation-50s'],
    whyNow: '12월 진입 2~4주 전 발행',
    notes: '우울로 단정하지 않는다. 혼자가 아니라는 감각까지가 범위다',
  },
  {
    day: 56,
    slug: 'year-end-tax-medical',
    title: '연말정산에서 의료비는 어떻게 챙기나요?',
    contentType: 'SEASONAL',
    intent: '방법',
    cluster: 'money-work',
    target: '40대 중반~60대 중반',
    riskLevel: 'HIGH',
    reviewMode: 'FULL_REVIEW',
    imageMode: 'OPTIONAL',
    autoEligible: false,
    season: '겨울',
    calendarEvent: '연말정산',
    publishWindow: { after: '2026-11-01', before: '2027-01-25' },
    ctaBoard: '/community/free',
    internalLinks: ['irp-tax-benefit'],
    whyNow: '연말정산 준비는 11월부터 검색이 오른다',
    notes: 'HIGH — 공제 금액·요건을 단정하지 않는다. 개인 상황에 따라 달라진다는 전제를 두고 국세청 확인으로 연결한다',
  },
  {
    day: 57,
    slug: 'retirement-prep-status',
    title: '노후 준비, 어디까지 하셨나요',
    contentType: 'COMMUNITY',
    intent: '상황',
    cluster: 'money-work',
    target: '50대~60대 중반',
    riskLevel: 'MEDIUM',
    reviewMode: 'RISK_SENTENCES',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    ctaBoard: '/community/free',
    internalLinks: ['national-pension-voluntary', 'health-insurance-after-retire'],
    whyNow: '비교가 아니라 현황을 나누는 형태로 두면 대화가 열린다',
    notes: '발행 전 자유게시판에서 유사 글을 확인한다. 금액을 비교하거나 목표액을 제시하지 않는다',
  },
  {
    day: 59,
    slug: 'year-end-gathering-reluctance',
    title: '송년 모임에 가기 싫을 때',
    contentType: 'SEASONAL',
    intent: '방법',
    cluster: 'relationship',
    target: '40대 중반~60대 중반',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    season: '겨울',
    calendarEvent: '송년',
    publishWindow: { after: '2026-11-15', before: '2026-12-28' },
    ctaBoard: '/community/free',
    internalLinks: ['avoiding-gatherings', 'fewer-friends-50s'],
    whyNow: '12월 모임 시즌 직전',
    notes: '관계를 끊으라는 방향으로 쓰지 않는다. 거절도 선택지로 둔다',
  },
  {
    day: 61,
    slug: 'looking-back-on-the-year',
    title: '올 한 해 뭐 했나 싶을 때',
    contentType: 'SEASONAL',
    intent: '상황',
    cluster: 'emotion',
    target: '40대 중반~60대 중반',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'OPTIONAL',
    autoEligible: true,
    season: '겨울',
    calendarEvent: '송년',
    publishWindow: { after: '2026-11-25', before: '2026-12-31' },
    ctaBoard: '/community/free',
    internalLinks: ['year-end-loneliness', 'no-motivation-50s'],
    whyNow: '12월 마지막 주 검색·감정 흐름',
    notes: '성취를 기준으로 한 해를 평가하지 않는다',
  },
  {
    day: 66,
    slug: 'gray-hair-leave-as-is',
    title: '흰머리를 그대로 두면 어떻게 되는지',
    contentType: 'EVERGREEN',
    intent: '질문',
    cluster: 'daily',
    target: '40대 중반~60대 중반',
    validationProfile: 'STANDARD',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'REQUIRED',
    autoEligible: true,
    ctaBoard: '/community/free',
    internalLinks: [],
    whyNow: '갈래 열림 3 · 여성 커뮤니티 제목 0 · 증거 3건·관측 9회. 자동 검증 프로필 STANDARD 로 생성·검증한다',
    notes: '염색약 추천 · 미용실 가격',
    intentId: 'I-T8-38',
    g8ManifestHash: '3b6eb1cb0ffc82e03c974cdbade5001858701ca52f614887ade1b1c77edcb504',
  },
]
