/**
 * 🔴 **입력 수리 반례의 큐 행 — 고정 fixture** (2026-10-12 · PR #690 CI 실패).
 *
 *    앞판 검사는 반례의 큐 행을 **실제** `drafts/magazine/topic-queue.ts` 에서 찾았다.
 *    10/12 회차가 gray·autumn 을 정상 등록해 큐에서 지우자 등록 PR(#690)의 CI 가 이 검사에서 깨졌다 —
 *    제품 실패가 아니라 변하는 운영 큐에 시험이 묶인 구조적 결함이다. 같은 결합으로
 *    ⑩ 의 정상 글 두 행은 이미 큐에 없어 "대상이 아니다" 가 저절로 참인 죽은 단언이었다.
 *
 *    이제 반례는 이 파일의 행 **원문**을 쓴다 — 같은 파서(`parseQueueSource`)로 읽는다. 실제 큐가 바뀌어도 반례는 그대로다.
 *    출처: 아래 `REPAIR_QUEUE_SOURCES` (main 348c200 의 큐 · 이미 등록된 행은 등록 직전 커밋의 큐 · 바이트 그대로).
 *    실제 큐와의 정합은 검사가 따로 본다 — 실제 큐에 **남아 있는** 행만 fixture 와 같아야 한다 (비파괴).
 *
 *    🔴 **바이트 예외 하나** (2026-10-22 · ArticlePlan PR C). gray-hair-leave-as-is · cold-weather-joint-pain 행의
 *       G8 v1 `g8ManifestHash` 줄만 뺐다. 계약상 해시만 있는 행은 `G8_ROW_NOT_DIRECT` 로 모든 자동 경로에서 막힌다
 *       (G8 v2 는 큐를 쓰지 않고, 운영 큐에 이런 행은 0개다). 이 반례들이 보려는 것은 legacy brief 입력 수리이므로
 *       `intentId` 만 남긴 legacy 행으로 둔다 — 해시 단독 행이 막히는 것은 source 관문 검사(P0-2 g8-withdrawn)가 따로 본다.
 */
import { parseQueueSource } from '../../lib/magazine-load.mjs'

export const REPAIR_QUEUE_BLOCKS = Object.freeze({
  'gray-hair-leave-as-is': `  {
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
  },
`,
  'cold-weather-joint-pain': `  {
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
`,
  'autumn-low-mood': `  {
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
`,
  'palpitations-menopause': `  {
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
`,
  'dizziness-menopause': `  {
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
`,
  'breast-exam-interval': `  {
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
`,
  'clinic-or-wait': `  {
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
`,
  'how-much-talk-with-husband': `  {
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
`,
  'retirement-prep-status': `  {
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
`,
  'dinner-change-two-weeks': `  {
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
`,
  'restart-exercise-menopause': `  {
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
`,
  'job-credentials': `  {
    day: 64,
    slug: 'job-credentials',
    title: '내세울 스펙이 없다고 느낄 때',
    contentType: 'EVERGREEN',
    intent: '질문',
    cluster: 'money-work',
    target: '40대 중반~60대 중반',
    validationProfile: 'STANDARD',
    riskLevel: 'LOW',
    reviewMode: 'SUMMARY_ONLY',
    imageMode: 'REQUIRED',
    autoEligible: true,
    ctaBoard: '/community/free',
    internalLinks: ['back-to-work-homemaker'],
    whyNow: '갈래 열림 3 · 여성 커뮤니티 제목 0 · 증거 3건·관측 9회. 자동 검증 프로필 STANDARD 로 생성·검증한다',
    notes: '고소득 직업 주장 · 자격증 영업',
    intentId: 'I-T6-13',
  },
`,
  'hardest-part-of-menopause': `  {
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
`,
})
export const REPAIR_QUEUE_SOURCES = Object.freeze({
  'gray-hair-leave-as-is': 'main 348c200',
  'cold-weather-joint-pain': 'main 348c200',
  'autumn-low-mood': 'main 348c200',
  'palpitations-menopause': 'main 348c200',
  'dizziness-menopause': 'main 348c200',
  'breast-exam-interval': 'main 348c200',
  'clinic-or-wait': 'main 348c200',
  'how-much-talk-with-husband': 'main 348c200',
  'retirement-prep-status': 'main 348c200',
  'dinner-change-two-weeks': 'main 348c200',
  'restart-exercise-menopause': 'main 348c200',
  'job-credentials': 'd98baa4~1 (10/08 등록 직전)',
  'hardest-part-of-menopause': 'main 348c200',
})
/** 수리 대상 세 글 (10/10~10/11 자연 회차) */
export const REPAIR_SLUGS = Object.freeze(['gray-hair-leave-as-is', 'cold-weather-joint-pain', 'autumn-low-mood'])
/** 전송불명 HOLD 6건 — 어떤 수리도 하지 않는다 */
export const HOLD_SLUGS = Object.freeze(['palpitations-menopause', 'dizziness-menopause', 'breast-exam-interval', 'clinic-or-wait', 'how-much-talk-with-husband', 'retirement-prep-status'])
/** 회차 상한(3) 반례에 더하는 두 글 */
export const EXTRA_SLUGS = Object.freeze(['dinner-change-two-weeks', 'restart-exercise-menopause'])
/** ⑩ 정상 brief 행 · 정상 draft 행 (둘 다 자동 레인 대상이어야 "대상이 아니다" 가 판정의 결과다) */
export const NORMAL_BRIEF_SLUG = 'job-credentials'
export const NORMAL_DRAFT_SLUG = 'hardest-part-of-menopause'

/** 이 fixture 의 행 원문들 → 큐 행 객체 (실제 큐와 같은 파서) */
export function fixtureQueue(slugs = Object.keys(REPAIR_QUEUE_BLOCKS)) {
  return parseQueueSource(`export const TOPIC_QUEUE = [\n${slugs.map((s) => blockOf(s)).join('')}]\n`, 'repair-queue-rows.mjs')
}
function blockOf(slug) {
  const b = REPAIR_QUEUE_BLOCKS[slug]
  if (!b) throw new Error(`고정 큐 fixture 에 ${slug} 행이 없다`)
  return b
}

/**
 * **시험 사본** 큐 원문에 빠진 fixture 행만 원문 그대로 넣는다 — 있는 행은 건드리지 않는다.
 * 🔴 실제 저장소·runtime 의 topic-queue.ts 에 쓰지 않는다. 호출부가 임시 사본에만 쓴다.
 * @returns {{src:string, added:string[]}}
 */
export function withFixtureRows(src, slugs) {
  const have = new Set(parseQueueSource(src, 'topic-queue.ts').map((q) => q.slug))
  const added = slugs.filter((s) => !have.has(s))
  if (!added.length) return { src, added }
  const end = src.lastIndexOf('\n]')
  if (end < 0) throw new Error('큐 배열 끝을 찾지 못했다')
  return { src: `${src.slice(0, end + 1)}${added.map(blockOf).join('')}${src.slice(end + 1)}`, added }
}
