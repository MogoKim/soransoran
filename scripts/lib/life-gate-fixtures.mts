/**
 * 생활 일관성 게이트 fixture — 🔴 **quality-v1 cohort 중대 결함 4건** (2026-09-28 · quality-v2)
 *
 *   운영 큐 행 4건(queueId 는 사람이 찾아갈 열쇠)의 **실패 모양만** 남겼다:
 *     · 원문은 옮기지 않았다 — 같은 상황을 **다른 말로 짧게** 다시 썼다(개인 원문 전문 0).
 *     · 초안은 게이트가 봐야 하는 **문장만** 남기고 줄였다(기계가 쓴 글 · 말투만 유지).
 *     · 계획은 운영 계획 모양 그대로(`stance` · `selfBasis` · 근거 축). 근거 문장은 이 원문에서 고른다.
 *     · 🔴 카드는 **정본 문서를 파서로 읽은 값**이다 — fixture 가 카드를 지어내지 않는다.
 *     · 의미 검수는 운영에서 실제로 돌아온 `clean` — 넷 다 모순 0 · 추가 0 이었다.
 *
 *   대조군 — 결함마다 **막으면 안 되는 글**: 남의 일 · 묻는 글 · 지난 일 · 카드가 뒷받침하는 사람.
 *   사람 검토군 — 모호한 글: 채택은 되고 `lifeReview` 에 축이 남아 적재 때 경고가 된다.
 *
 *   🔴 순수 데이터다. DB · 네트워크 · provider 0.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePoolDoc, type PoolCard } from '../../src/lib/persona-pool-card'
import type { DraftGateCode, DraftLifeReviewCode, DraftGateSource } from '../../src/lib/content-core/draft-life-gates'
import { FIXTURE_NOW, type GateFixture } from './draft-gate-fixtures.mjs'

export type LifeFixture = GateFixture & {
  /** 🔴 채택은 되지만 사람 검토로 가야 하는 축. 없으면 `[]` — 모호함 없음 */
  expectReview: DraftLifeReviewCode[]
}

const POOL_DOC = join(process.cwd(), 'docs/operations/2026-08-30-persona-pool-design.md')
const POOL = parsePoolDoc(readFileSync(POOL_DOC, 'utf-8')).cards
/** 🔴 정본 카드 — 없으면 멈춘다(지어내지 않는다) */
export const realCard = (code: string): PoolCard => {
  const c = POOL.find((x) => x.code === code)
  if (c === undefined) throw new Error(`정본 카드 ${code} 가 없다`)
  return c
}

const planOf = (o: Record<string, unknown>): Record<string, unknown> => ({
  decision: 'ok', closingIntent: 'ask', contentRoles: ['conversationSpark'],
  speakerWarrants: [], protectedFacts: [], universalReason: '', ...o,
})

const hold = (codes: DraftGateCode[]): { expect: DraftGateCode[]; expectReview: DraftLifeReviewCode[] } =>
  ({ expect: codes, expectReview: [] })
const pass = { expect: [] as DraftGateCode[], expectReview: [] as DraftLifeReviewCode[] }
const review = (codes: DraftLifeReviewCode[]): { expect: DraftGateCode[]; expectReview: DraftLifeReviewCode[] } =>
  ({ expect: [], expectReview: codes })

// ── 원문(다시 쓴 것) ──
const SRC_FIGHT = {
  title: '부부싸움 끝에 친정엄마 말씀이 더 아프네요',
  body: '해마다 한두 번은 크게 붙는데 이번에도 막말이 오갔어요. 친정엄마는 헤어질 거면 아이들은 두고 나오라시네요. '
    + '아들 둘을 혼자는 못 키운다고요.',
}
const SRC_INLAW = {
  title: '시부모님 생신 챙기기 어렵네요',
  body: '시부모님 생신마다 봉투를 드리는 게 맞는지 모르겠어요. 우리 애들 생일은 챙겨 주신 적이 없거든요. '
    + '깜빡하고 넘어간 해엔 곧장 전화가 왔고요.',
}
const SRC_CLINIC = {
  title: '처음 진료 볼 때 사연까지 다 말하나요',
  body: '마음이 계속 가라앉고 초조해서 처음으로 정신건강의학과 진료를 보려는데 원인이 된 일까지 '
    + '의사 선생님께 다 털어놔야 하는지 궁금해요.',
}
const SRC_KIDS = {
  title: '딸이랑 아들이 명절에 이렇게 다르네요',
  body: '딸은 봉투에 건강식품까지 들고 왔는데 아들은 그냥 왔어요. 아들 생일이 코앞이라 제가 봉투를 줬고요. '
    + '한 살 차이인데 참 달라요. 그래도 다 같이 갈비 구워 먹으니 좋았어요.',
}

const V2_FIXTURES: readonly LifeFixture[] = [
  // ───────────── 운영 회귀 4건 (quality-v1 cohort) ─────────────
  {
    queueId: 'cmukm6tek00012ygnkf0onego', label: '🔴 #6 P05 기혼(원만) · 초안 "싸우다 이혼 얘기가 나왔다"',
    source: { id: 'fx-v2-6', ...SRC_FIGHT },
    draft: {
      title: '친정엄마가 이혼할 거면 애들은 두고 하라네요',
      body: '남편이랑 사네마네 크게 싸웠어요.\n해마다 한두 번씩 막말을 하는데 정이 떨어지네요.\n'
        + '너무 힘들어서 이혼 얘기까지 나왔는데\n친정엄마는 이혼할 거면 애들은 두고 나오래요.',
    },
    plan: planOf({
      personaCode: 'P05', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [
        { fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '아들 둘을 혼자는 못 키운다고요' },
      ],
    }),
    card: realCard('P05'), ...hold(['maritalStatusConflict']),
  },
  {
    queueId: 'cmukma5nd00032y4j89bz7b3w', label: '🔴 #10 P05 시어머니 모심·간병 상시 · 초안 "연락도 안 드렸더니 전화가 오더라"',
    source: { id: 'fx-v2-10', ...SRC_INLAW },
    draft: {
      title: '시부모님 생신 꼭 챙겨야 할까요?',
      body: '저희 애들 생일은 한 번도 안 챙겨 주셨는데요..\n생신마다 돈 챙겨 드리는 게 맞나 싶네요.\n'
        + '저번엔 날짜를 착각해서 연락도 안 드리고 돈도 안 보냈더니 바로 전화가 오더라고요.',
    },
    plan: planOf({
      personaCode: 'P05', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [
        { fact: 'spouse', requiredValue: '있음', evidenceRef: 'head', evidenceText: '시부모님 생신마다' },
        { fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '우리 애들 생일은' },
      ],
    }),
    card: realCard('P05'), ...hold(['careHouseholdConflict']),
  },
  {
    queueId: 'cmukme8qd00032yl039pjjyys', label: '🔴 #20 P19 카드·계획에 없는 "우울·불안이 심해져 정신건강의학과"',
    source: { id: 'fx-v2-20', ...SRC_CLINIC },
    draft: {
      title: '정신건강의학과 갈 때 사정을 다 말해야 하나요',
      body: '요즘 우울하고 불안한 게 더 심해져서\n정신건강의학과를 한번 가볼까 하는데요\n'
        + '한 번도 안 가 봐서 잘 모르겠네요\n다들 어떻게 상담 받으시나요',
    },
    plan: planOf({
      personaCode: 'P19', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded',
      universalReason: '첫 진료를 앞둔 사람이 누구나 하는 질문이다',
      protectedFacts: [{ kind: 'searchTerm', text: '정신건강의학과', evidenceRef: 'head' }],
    }),
    card: realCard('P19'), ...hold(['unsupportedHealthClaim']),
  },
  {
    queueId: 'cmukme8uo00072yl0bsdq244f', label: '🔴 #22 P01 자녀 중고등 동거 · 초안 "딸은 봉투에 10만원 · 아들은 빈손으로 왔다"',
    source: { id: 'fx-v2-22', ...SRC_KIDS },
    draft: {
      title: '딸이랑 아들이 참 달라요',
      body: '명절에 딸은 봉투에 10만원 넣고 건강식품까지 사 왔는데\n아들은 빈손으로 왔어요.\n'
        + '한 살 차이인데 어쩜 이리 다른지...\n모처럼 다 같이 모여서 갈비 구워 먹으니 좋긴 하네요.',
    },
    plan: planOf({
      personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [
        { fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '딸은 봉투에 건강식품까지' },
      ],
    }),
    card: realCard('P01'), ...hold(['childLifeStageConflict']),
  },

  // ───────────── 대조 — 결함마다 막으면 안 되는 글 (러너 경로 · 적재까지) ─────────────
  {
    queueId: 'control-v2-6-divorced-card', label: '🟢 #6 대조 · P03 카드가 이혼 — 이혼 이야기는 뒷받침된다',
    source: { id: 'fx-v2-c6a', ...SRC_FIGHT },
    draft: {
      title: '이혼하고 애들 키우는 얘기',
      body: '이혼하고 아들 둘 혼자 키우느라 정신이 없어요.\n그래도 애들 보면 힘이 나네요.\n다들 어떻게 버티세요?',
    },
    plan: planOf({
      personaCode: 'P03', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [
        { fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '아들 둘을 혼자는 못 키운다고요' },
      ],
    }),
    card: realCard('P03'), ...pass,
  },
  {
    queueId: 'control-v2-6-third-party', label: '🟢 #6 대조 · P05 남의 집 이혼 이야기(전언)',
    source: { id: 'fx-v2-c6b', ...SRC_FIGHT },
    draft: {
      title: '친구네 부부싸움 이야기',
      body: '친구가 남편이랑 싸우다가 이혼 얘기까지 나왔대요.\n옆에서 듣기만 해도 마음이 무겁네요.\n'
        + '이럴 때 친구한테 뭐라고 해 주면 좋을까요?',
    },
    plan: planOf({ personaCode: 'P05', stance: 'OBSERVATION', selfBasis: null }),
    card: realCard('P05'), ...pass,
  },
  {
    queueId: 'control-v2-10-other-side', label: '🟢 #10 대조 · P05 돌보지 않는 쪽(친정) 연락',
    source: { id: 'fx-v2-c10a', ...SRC_INLAW },
    draft: {
      title: '친정엄마 생신을 깜빡했어요',
      body: '친정엄마 생신을 깜빡해서 연락을 못 드렸어요.\n저녁에 전화드렸더니 괜찮다 하시는데 마음이 쓰이네요.',
    },
    plan: planOf({ personaCode: 'P05', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded', universalReason: '가족 생일을 깜빡한 흔한 일이다' }),
    card: realCard('P05'), ...pass,
  },
  {
    queueId: 'control-v2-10-near-card', label: '🟢 #10 대조 · P12 친정 어머니 곁(따로 삶) — 뵈러 가는 길',
    source: { id: 'fx-v2-c10b', ...SRC_INLAW },
    draft: {
      title: '엄마 뵈러 가는 길',
      body: '오늘도 친정엄마 뵈러 가는 길이에요.\n반찬 몇 가지 챙겨 가는데 좋아하실지 모르겠네요.',
    },
    plan: planOf({ personaCode: 'P12', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded', universalReason: '부모님 댁에 반찬을 챙겨 가는 흔한 일이다' }),
    card: realCard('P12'), ...pass,
  },
  {
    queueId: 'control-v2-20-question', label: '🟢 #20 대조 · P19 묻는 글(1인칭 증상 없음)',
    source: { id: 'fx-v2-c20a', ...SRC_CLINIC },
    draft: {
      title: '정신건강의학과 처음 가면 뭘 물어보나요?',
      body: '정신건강의학과 처음 가면 사연까지 다 말해야 하나요?\n가 보신 분들 이야기 궁금해요.',
    },
    plan: planOf({ personaCode: 'P19', stance: 'QUESTION', selfBasis: null }),
    card: realCard('P19'), ...pass,
  },
  {
    queueId: 'control-v2-20-menopause-card', label: '🟢 #20 대조 · P07 갱년기 진행중 — 갱년기 우울증',
    source: { id: 'fx-v2-c20b', ...SRC_CLINIC },
    draft: {
      title: '갱년기 우울 어떻게 버티세요',
      body: '갱년기 우울증이 와서 요즘 많이 가라앉네요.\n다들 어떻게 버티시는지 궁금해요.',
    },
    plan: planOf({ personaCode: 'P07', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded', universalReason: '갱년기 우울은 흔한 이야기다' }),
    card: realCard('P07'), ...pass,
  },
  {
    queueId: 'control-v2-22-adult-card', label: '🟢 #22 대조 · P19 성인 자녀 분가 — 같은 명절 봉투 이야기',
    source: { id: 'fx-v2-c22a', ...SRC_KIDS },
    draft: {
      title: '명절에 보니 딸이랑 아들이 참 다르네요',
      body: '명절에 딸은 봉투에 10만원 넣고 건강식품까지 사 왔는데\n아들은 빈손으로 왔어요.\n'
        + '모처럼 다 같이 모여서 갈비 구워 먹으니 좋긴 하네요.',
    },
    plan: planOf({
      personaCode: 'P19', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [
        { fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '딸은 봉투에 건강식품까지' },
      ],
    }),
    card: realCard('P19'), ...pass,
  },
  {
    queueId: 'control-v2-22-question', label: '🟢 #22 대조 · P01 묻는 글(자녀 봉투를 받으시나요)',
    source: { id: 'fx-v2-c22b', ...SRC_KIDS },
    draft: {
      title: '자녀가 명절에 봉투 주면 받으시나요?',
      body: '다 큰 자녀가 명절에 봉투를 주면 다들 받으시나요?\n저는 아직 먼 얘기지만 궁금하네요.',
    },
    plan: planOf({ personaCode: 'P01', stance: 'QUESTION', selfBasis: null }),
    card: realCard('P01'), ...pass,
  },

  // ───────────── 사람 검토 — 모호하다(채택 · 자동 READY 제외) ─────────────
  {
    queueId: 'review-v2-6-strained-card', label: '🟡 #6 모호 · P06 기혼(갈등) — 이혼 얘기는 사람이 본다',
    source: { id: 'fx-v2-r6', ...SRC_FIGHT },
    draft: {
      title: '또 크게 싸웠네요',
      body: '남편이랑 또 크게 싸웠네요...\n너무 지쳐서 이혼 얘기까지 나왔는데 마음이 복잡해요...',
    },
    plan: planOf({
      personaCode: 'P06', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [
        { fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '아들 둘을 혼자는 못 키운다고요' },
      ],
    }),
    card: realCard('P06'), ...review(['maritalStatusConflict']),
  },
  {
    queueId: 'review-v2-22-student-card', label: '🟡 #22 모호 · P22 대학생 자녀 — 자녀가 용돈을 건넸다',
    source: { id: 'fx-v2-r22', ...SRC_KIDS },
    draft: {
      title: '딸이 알바비로 용돈을 줬어요',
      body: '딸이 알바비 받았다고 저한테 용돈을 줬어요.\n괜히 코끝이 찡하네요.',
    },
    plan: planOf({
      personaCode: 'P22', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [
        { fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '딸은 봉투에 건강식품까지' },
      ],
    }),
    card: realCard('P22'), ...review(['childLifeStageConflict']),
  },
]

// ═════════════════════════════════════════════════════════
// 🔴 quality-v3 — 원천·시점 대조 (2026-09-28 · v1 cohort 권고 13건 중 v2 가 못 막은 7건)
// ═════════════════════════════════════════════════════════
//
//   원문은 **같은 상황을 다른 말로** 다시 썼다(개인 원문 전문 0). 원천 사실(올라온 시각 · 사이트 · 사진 수)은
//   운영 candidates 파일에서 읽은 **모양** 그대로다 — #8 은 회차 나흘 전 · #9 는 시각 없음 · #21 은 닷새 전.
//   회차 시각은 `FIXTURE_NOW`(09-26 12:00 KST)다. 날짜는 그에 맞춰 옮겼다(간격만 같다).

/** 🔴 회차보다 앞 날짜에 올라온 원문 — 운영 #8 · #21 의 간격(나흘 · 닷새)과 같은 모양 */
const BEFORE = new Date(FIXTURE_NOW.getTime() - 3 * 24 * 60 * 60 * 1000)
/** 🔴 올라온 시각을 모른다 — 운영 #9 · #7 · #19 의 candidates 는 세 시각이 비어 있다 */
const UNKNOWN_TIME = { postedAt: null, capturedAt: null } as const

const SRC_DOG = {
  title: '우리 개의 한밤 만찬 고발합니다',
  body: '베란다 열어 둔 채로 잠들었더니 녀석이 쓰레기봉투를 뒤져 매운 양념뼈를 죄다 씹어 놨어요\n\n'
    + '안방 러그 위에까지 뼈다귀가 굴러다니고\n\n남편이 새벽 산책 다녀와 사료를 주니까\n\n야',
}
const SRC_SCARF = {
  title: '뜨개 완성작 평가 부탁해요',
  body: '겨울 대비해서 아들 거 하나 짰어요\n끝장식은 까만색으로 하려다 실이 모자라 흰색 계열로 마무리\n'
    + '솜씨 어떤지 다들 봐주세요',
}
const SRC_RITE = {
  title: '맏며느리 명절 음식 끝',
  body: '오늘 시가에서 차례 음식 다 하고 집에 가는 중이에요\n동그랑땡 동태전 호박전 부쳤어요\n다들 명절 잘 보내세요',
}
const SRC_RELATIVE = {
  title: '연휴에 시댁 쪽 먼 친척 모임 편하신가요',
  body: '남편 사촌 어른 댁에서 식사 자리가 잡혔어요\n며느리로선 얼굴도 잘 모르는 분들이라 어색할 듯해서요\n솔직히 부담스럽지 않으세요?',
}
const SRC_NICK = {
  title: '닉네임 자주 바꾸는 이유',
  body: '한두 번은 그렇구나 하는데 서너 번씩 바꾸는 우갱님들이 많아 보여서요\n1 지겨워서 2 재미로 3 추적이 싫어서 4 이유 없음',
}
const SRC_ESTATE = {
  title: '아들한테 재산 준다는 집 많아서 위로가 되네요',
  body: '최근에 레테에 비슷한 글 많네요\n우리집만 그런 게 아니네\n재산은 아들 주고 병원은 딸이 모시고 다니고\n'
    + '그 시절 어른들은 다 그런가 봐요',
}
const SRC_CONCERT = {
  title: '지금 콘서트에 배우가 나왔어요',
  body: '노래도 어쩜 저리 잘하는지 광대가 안 내려가요\n뉘 집 아들인지 참 잘났네요\n관객들 반응도 재밌어요',
}
const SRC_HUSBAND = {
  title: '나이 든 남자들 좀 달라지던가요',
  body: '나이 먹으면 남자들도 달라진다던데 쓰레기 버리기라도 거들고 고맙단 말은 하는지요\n우리 집 양반은 전혀 안 변하네요',
}
const SRC_WEDDING = {
  title: '동창 혼사 피로연까지 있어야 하나요',
  body: '수도권 사는데 경남에서 동창 혼사가 있어요\n정오 예식 끝나면 곧장 열차를 타야 하거든요\n피로연까지 있다 가는 게 도리일까요?',
}

const V3_FIXTURES: readonly LifeFixture[] = [
  // ───────────── 운영 회귀 7건 (quality-v1 cohort · 권고 EDIT/REJECT) ─────────────
  {
    queueId: 'cmujs8lwh00032ytq1zwll71f', label: '🟡 #2 P04 원문 끝 "밥을 챙겨 주니까 / 야" → 초안이 "본체만체하네요" 결말을 붙였다',
    source: { id: 'fx-v3-2', ...SRC_DOG },
    draft: {
      title: '밤새 갈비 파티를 벌인 우리 강아지',
      body: '문을 깜빡하고 안 닫고 잤더니 사달이 났네요.\n강아지가 봉투에서 갈비를 꺼내 밤새 뜯어 놨더라고요.\n'
        + '남편이 아침 산책 다녀와서 밥을 챙겨 주니 본체만체하네요.',
    },
    plan: planOf({
      personaCode: 'P04', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'spouse', requiredValue: '있음', evidenceRef: 'head', evidenceText: '남편이 새벽 산책 다녀와' }],
    }),
    card: realCard('P04'), ...review(['truncatedSourceCompletion']),
  },
  {
    queueId: 'cmukm6tjc00052ygn59ocvt4w', label: '🟡 #7 P10 사진 없이 "한번 봐주세요 · 보시기엔 어떠신가요" (원천 사진 수 미상)',
    source: { id: 'fx-v3-7', ...SRC_SCARF },
    sourceMeta: { imageCount: 0 },
    draft: {
      title: '아들 목도리 다 떴는데 한번 봐주세요',
      body: '끝에 술을 검정으로 달아 주고 싶었는데 남은 실이 아이보리뿐이네요.\n'
        + '아들은 이대로도 예쁘다고 하는데 회원님들이 보시기엔 어떠신가요?',
    },
    plan: planOf({
      personaCode: 'P10', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '아들 거 하나 짰어요' }],
    }),
    card: realCard('P10'), ...review(['mediaDependentDraft']),
  },
  {
    queueId: 'cmukm6tlg00072ygnkmh7heoh', label: '🔴 #8 P01 원문 사흘 전 · "이제 집으로 가는 길이에요 · 명절 잘 보내세요"',
    source: { id: 'fx-v3-8', ...SRC_RITE },
    sourceMeta: { postedAt: BEFORE, capturedAt: BEFORE },
    draft: {
      title: '차례 음식 다 하고 집으로 가요',
      body: '시가 가서 차례 음식 다 부치고\n이제 집으로 가는 길이에요.\n\n다들 명절 잘 보내세요.',
    },
    plan: planOf({
      personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'spouse', requiredValue: '있음', evidenceRef: 'head', evidenceText: '오늘 시가에서 차례 음식' }],
    }),
    card: realCard('P01'), ...hold(['staleTimeClaim']),
  },
  {
    queueId: 'cmukma5l200012y4j1adoopkz', label: '🟡 #9 P04 원문 시각 모름 · 제목 명절 + "이번에 … 가기로 했는데요"',
    source: { id: 'fx-v3-9', ...SRC_RELATIVE },
    sourceMeta: UNKNOWN_TIME,
    draft: {
      title: '명절에 남편 친척분 댁 가는 거 다들 어떠신가요?',
      body: '이번에 남편 친척분 댁에 밥 먹으러 가기로 했는데요.\n며느리 입장에선 거의 남이라 불편할 것 같아서요.',
    },
    plan: planOf({
      personaCode: 'P04', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'spouse', requiredValue: '있음', evidenceRef: 'head', evidenceText: '남편 사촌 어른 댁에서' }],
    }),
    card: realCard('P04'), ...review(['staleTimeClaim']),
  },
  {
    queueId: 'cmukmcbtq00092ycolaijrn8o', label: '🔴 #18 P13 원천 카페 회원을 본 말 "자주 바꾸시는 분들이 꽤 보이네요"',
    source: { id: 'fx-v3-18', ...SRC_NICK },
    draft: {
      title: '닉네임 자주 바꾸시는 이유가 궁금해요',
      body: '한두 번은 그러려니 하는데\n서너 번 넘게 자주 바꾸시는 분들이 꽤 보이네요~\n다들 어떤 이유세요?',
    },
    plan: planOf({ personaCode: 'P13', stance: 'QUESTION', selfBasis: null }),
    card: realCard('P13'), ...hold(['externalCommunityClaim']),
  },
  {
    queueId: 'cmukme8nr00012yl0vi02d16v', label: '🔴 #19 P08 원천 카페 글을 본 말 + 🟡 계획 noLifeFactNeeded 인데 "우리 집만 그런 게 아니었구나"',
    source: { id: 'fx-v3-19', ...SRC_ESTATE },
    sourceMeta: UNKNOWN_TIME,
    draft: {
      title: '재산은 아들, 병원은 딸... 다들 비슷하신가 봐요',
      body: '요즘 비슷한 이야기들이 자주 보여\n묘하게 위로가 되네요.\n\n우리 집만 그런 게 아니었구나 싶고요.\n'
        + '재산은 아들 몫이고 병원 모시는 건 딸 몫이고.',
    },
    plan: planOf({
      personaCode: 'P08', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded',
      universalReason: '부모님의 아들 편중 상속에 대한 보편적인 씁쓸함이다',
    }),
    card: realCard('P08'), expect: ['externalCommunityClaim'], expectReview: ['unwarrantedSelfClaim'],
  },
  {
    queueId: 'cmukme8sk00052yl0v1l7903m', label: '🔴 #21 P15 원문 사흘 전 · "지금 콘서트인데 배우가 나왔어요"',
    source: { id: 'fx-v3-21', ...SRC_CONCERT },
    sourceMeta: { postedAt: BEFORE, capturedAt: BEFORE },
    draft: {
      title: '콘서트에 배우가 나왔네요',
      body: '지금 콘서트인데 배우가 게스트로 나왔어요.\n노래도 참 잘하고 광대가 안 내려가네요.',
    },
    plan: planOf({
      personaCode: 'P15', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded',
      universalReason: '공연 감상은 누구나 하는 이야기다',
    }),
    card: realCard('P15'), ...hold(['staleTimeClaim']),
  },

  // ───────────── 정상 대조 — 막으면 안 되는 글 ─────────────
  {
    queueId: 'control-v3-5-husbands-question', label: '🟢 #5 대조 · P02 "50대 후반 남편분들" 은 다른 집 남편에게 묻는 말',
    source: { id: 'fx-v3-c5', ...SRC_HUSBAND },
    draft: {
      title: '50대 후반 남편분들은 좀 가정적인 편이신가요?',
      body: '나이 들면 성격도 유해진다는데 다른 집 남편분들은 어떤지 궁금해서요.\n'
        + '저희 집은 분리수거 한 번을 안 도와주는 것 같아요.\n다들 어떻게 지내세요?',
    },
    plan: planOf({
      personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'spouse', requiredValue: '있음', evidenceRef: 'head', evidenceText: '우리 집 양반은 전혀 안 변하네요' }],
    }),
    card: realCard('P02'), ...pass,
  },
  {
    queueId: 'control-v3-15-friend-wedding', label: '🟢 #15 대조 · P12 친구 결혼식 — 50대에게 결혼하는 친구가 있을 수 있다',
    source: { id: 'fx-v3-c15', ...SRC_WEDDING },
    draft: {
      title: '친구 결혼식 식만 보고 와도 서운해할까요?',
      body: '서울에서 지방까지 친구 결혼식을 가는데요.\n12시 식이 끝나면 바로 기차를 타야 해서요.\n'
        + '밥 먹을 때까지 있다 오는 게 맞을까요?',
    },
    plan: planOf({
      personaCode: 'P12', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'region', requiredValue: '수도권', evidenceRef: 'head', evidenceText: '수도권 사는데' }],
    }),
    card: realCard('P12'), ...pass,
  },
  {
    queueId: 'control-v3-past-holiday', label: '🟢 대조 · 원문 사흘 전 · 지난 명절 회고("지난 추석엔 … 부치느라")',
    source: { id: 'fx-v3-cpast', ...SRC_RITE },
    sourceMeta: { postedAt: BEFORE, capturedAt: BEFORE },
    draft: {
      title: '지난 추석 전 부치느라 허리가 끊어질 뻔했어요',
      body: '지난 추석엔 시가에서 전 부치느라 허리가 끊어지는 줄 알았어요.\n다들 명절 끝나고 몸은 좀 괜찮으세요?',
    },
    plan: planOf({
      personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'spouse', requiredValue: '있음', evidenceRef: 'head', evidenceText: '오늘 시가에서 차례 음식' }],
    }),
    card: realCard('P01'), ...pass,
  },
  {
    queueId: 'review-v3-same-day-live', label: '🟡 원문이 회차와 같은 날이어도 "지금 콘서트 보는 중" 은 사람 검토(발행 때는 지금이 아니다)',
    source: { id: 'fx-v3-clive', ...SRC_CONCERT },
    draft: {
      title: '콘서트 보다가 잠깐 올려요',
      body: '지금 콘서트 보는 중인데 배우가 게스트로 나왔어요.\n노래도 참 잘하네요.',
    },
    plan: planOf({
      personaCode: 'P15', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded',
      universalReason: '공연 감상은 누구나 하는 이야기다',
    }),
    card: realCard('P15'), ...review(['staleTimeClaim']),
  },
  {
    queueId: 'control-v3-photo-source', label: '🟢 대조 · 원천에 사진 3장 — 초안은 글로 설명하고 봐 달라지 않는다',
    source: { id: 'fx-v3-cphoto', ...SRC_SCARF },
    sourceMeta: { imageCount: 3 },
    draft: {
      title: '아들 목도리 술 색깔 고민이에요',
      body: '아이보리 목도리에 술을 검정으로 달지, 남은 아이보리로 달지 고민이에요.\n'
        + '한 볼을 더 사자니 아깝고요. 다들 어떤 쪽이 나을까요?',
    },
    plan: planOf({
      personaCode: 'P10', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '아들 거 하나 짰어요' }],
    }),
    card: realCard('P10'), ...pass,
  },
  {
    queueId: 'control-v3-selfbasis-own', label: '🟢 대조 · 계획 lifeFacts(배우자 근거) · "우리 남편도 똑같아요"',
    source: { id: 'fx-v3-cself', ...SRC_HUSBAND },
    draft: {
      title: '남편들 집안일 다들 좀 하시나요?',
      body: '우리 남편도 똑같아요.\n분리수거 한 번 부탁하면 한참 걸리네요.\n다들 어떻게 부탁하세요?',
    },
    plan: planOf({
      personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'spouse', requiredValue: '있음', evidenceRef: 'head', evidenceText: '우리 집 양반은 전혀 안 변하네요' }],
    }),
    card: realCard('P02'), ...pass,
  },
  {
    queueId: 'review-v3-nolifefact-family', label: '🟡 같은 글 · 계획 noLifeFactNeeded — 자기 가족사는 사람이 본다',
    source: { id: 'fx-v3-rself', ...SRC_HUSBAND },
    draft: {
      title: '남편들 분리수거 다들 좀 하시나요?',
      body: '우리 남편도 똑같아요.\n분리수거 한 번 부탁하면 한참 걸리네요.\n다들 어떻게 부탁하세요?',
    },
    plan: planOf({
      personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded',
      universalReason: '남편 집안일 불만은 흔한 이야기다',
    }),
    card: realCard('P02'), ...review(['unwarrantedSelfClaim']),
  },
  {
    queueId: 'control-v3-teen-card', label: '🟢 대조 · P01 중고생 카드 · 중고생 행동("중2 아들 시험 기간")',
    source: { id: 'fx-v3-cteen', title: '중학생 시험 기간 다들 어떠세요', body: '중2 아들이 시험 기간인데 폰만 봐요\n다들 어떻게 하세요?' },
    draft: {
      title: '중2 아들 시험 기간인데 폰만 보네요',
      body: '우리 아들이 중2인데 시험 기간에도 폰만 봐요.\n다들 어떻게 공부시키세요?',
    },
    plan: planOf({
      personaCode: 'P01', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '중2 아들이 시험 기간인데' }],
    }),
    card: realCard('P01'), ...pass,
  },
  {
    queueId: 'control-v3-songpyeon-trip', label: '🟢 과차단 반례 · 원문 앞 날짜 · "오는 길에 꽃 사고" 는 다녀온 이야기(운영 P07 송편 글)',
    source: { id: 'fx-v3-csong', title: '떡집 다녀왔어요', body: '추석 맞이 떡집에 다녀왔는데 줄이 길었어요\n귀가하다 꽃가게 앞을 지나며 국화 한 다발 들고 왔고요' },
    sourceMeta: { postedAt: BEFORE, capturedAt: BEFORE },
    draft: {
      title: '송편 사러 나갔다 왔네요',
      body: '추석이라 송편 사러 나갔다 왔어요.\n오는 길에 꽃집 보여서 꽃도 한 단 샀네요.',
    },
    plan: planOf({ personaCode: 'P07', stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded', universalReason: '장 보러 다녀온 일상이다' }),
    card: realCard('P07'), ...pass,
  },
]

export const LIFE_FIXTURES: readonly LifeFixture[] = [...V2_FIXTURES, ...V3_FIXTURES]

/**
 * 🔴 **원천·시점 문장 대조표** (quality-v3) — 게이트 정본만 돈다. 원천 사실을 줄마다 바꾼다.
 *    기대는 `hold:<코드>` · `review:<코드>` · `pass`. 기본 원천은 "회차와 같은 날 · 커뮤니티 · 사진 수 미상 · 본문 없음".
 */
export type SourcePhrase = {
  card: string
  title: string
  body: string
  plan?: { selfBasis: string | null; warrants: { fact: string; evidenceText?: string }[] }
  source?: Partial<DraftGateSource>
  want: string
}
const Q = { selfBasis: null, warrants: [] }
export const SOURCE_PHRASES: readonly SourcePhrase[] = [
  // 5 시점 — 명절·현장 × 원문 시각
  { card: 'P01', title: '명절', body: '이제 시댁에서 집으로 가는 길이에요. 다들 명절 잘 보내세요.', source: { postedAt: BEFORE }, want: 'hold:staleTimeClaim' },
  // 🔴 같은 날이어도 시간 의존 문장은 사람 검토 — 발행 시각은 판정 시각이 아니다(TTL 에 맡기지 않는다)
  { card: 'P01', title: '명절', body: '이제 시댁에서 집으로 가는 길이에요. 다들 명절 잘 보내세요.', want: 'review:staleTimeClaim' },
  { card: 'P15', title: '콘서트', body: '지금 콘서트 보는 중인데 게스트가 나왔어요.', want: 'review:staleTimeClaim' },
  { card: 'P01', title: '추석', body: '오늘 추석 음식 만드는 중이에요.', want: 'review:staleTimeClaim' },
  { card: 'P01', title: '추석', body: '오늘 추석 음식 만드는 중이에요.', source: { postedAt: BEFORE }, want: 'hold:staleTimeClaim' },
  { card: 'P15', title: '공연', body: '지난 공연을 보고 왔는데 여운이 길어요.', want: 'pass' },
  { card: 'P15', title: '공연', body: '지난 공연을 보고 왔는데 여운이 길어요.', source: { postedAt: BEFORE }, want: 'pass' },
  { card: 'P01', title: '요즘', body: '요즘 애들 시험 기간이라 저녁을 일찍 먹어요.', want: 'pass' },
  { card: 'P01', title: '명절', body: '이제 시댁에서 집으로 가는 길이에요. 다들 명절 잘 보내세요.', source: { postedAt: null, capturedAt: null }, want: 'review:staleTimeClaim' },
  // 🔴 가져온 날이 앞 날짜면 올라온 날도 앞 날짜다 — capturedAt 만으로 "앞" 을 확정한다
  { card: 'P01', title: '명절', body: '이제 시댁에서 집으로 가는 길이에요.\n명절 잘 보내세요.', source: { postedAt: null, capturedAt: BEFORE }, want: 'hold:staleTimeClaim' },
  // 🔴 같은 날 가져왔으면 올라온 날은 모른다
  { card: 'P01', title: '명절', body: '이제 시댁에서 집으로 가는 길이에요.\n명절 잘 보내세요.', source: { postedAt: null, capturedAt: FIXTURE_NOW }, want: 'review:staleTimeClaim' },
  { card: 'P15', title: '콘서트', body: '지금 콘서트 중인데 게스트가 나왔어요.', source: { postedAt: BEFORE }, want: 'hold:staleTimeClaim' },
  { card: 'P15', title: '중계', body: '방금 생중계로 경기 보는데 너무 떨려요.', source: { postedAt: BEFORE }, want: 'hold:staleTimeClaim' },
  { card: 'P04', title: '추석', body: '추석 연휴에 친정 가기로 했어요.', source: { postedAt: BEFORE }, want: 'review:staleTimeClaim' },
  { card: 'P04', title: '인사', body: '다들 즐거운 추석 보내세요.', source: { postedAt: BEFORE }, want: 'review:staleTimeClaim' },
  { card: 'P15', title: '콘서트', body: '오늘 콘서트 다녀왔는데 너무 좋았어요.', source: { postedAt: BEFORE }, want: 'review:staleTimeClaim' },
  { card: 'P01', title: '지난 명절', body: '지난 명절에 시댁 다녀왔는데 너무 피곤했어요.', source: { postedAt: BEFORE }, want: 'pass' },
  { card: 'P01', title: '명절 끝', body: '명절 끝나고 나니 살이 쪘네요.', source: { postedAt: BEFORE }, want: 'pass' },
  { card: 'P15', title: '콘서트', body: '예전에 갔던 콘서트 생각이 나네요.', source: { postedAt: BEFORE }, want: 'pass' },
  { card: 'P15', title: '콘서트', body: '콘서트에 배우가 게스트로 나왔더라고요.', source: { postedAt: BEFORE }, want: 'pass' },
  // 🔴 `요즘` · `이번에` · `오늘` 만으로는 막지 않는다 — 명절·현장이 없다
  { card: 'P04', title: '요즘', body: '요즘 날씨가 부쩍 쌀쌀하네요.', source: { postedAt: BEFORE }, want: 'pass' },
  { card: 'P04', title: '김장', body: '이번에 김장은 조금만 하기로 했어요.', source: { postedAt: null, capturedAt: null }, want: 'pass' },
  { card: 'P04', title: '병원', body: '지금 병원 가는 길이에요.', source: { postedAt: BEFORE }, want: 'pass' },
  { card: 'P04', title: '오늘', body: '오늘 저녁은 김치찌개 끓였어요.', source: { postedAt: BEFORE }, want: 'pass' },
  { card: 'P12', title: '명절', body: '친구가 지금 시댁 가는 길이래요.', source: { postedAt: BEFORE }, want: 'pass' },
  // 6 출처 — 다른 커뮤니티 움직임
  { card: 'P13', title: '닉네임', body: '닉네임 자주 바꾸시는 분들이 꽤 보이네요.', plan: Q, want: 'hold:externalCommunityClaim' },
  { card: 'P13', title: '비슷한 글', body: '요즘 비슷한 글들이 자주 올라오네요.', plan: Q, want: 'hold:externalCommunityClaim' },
  { card: 'P15', title: '게시판', body: '게시판에 올라오는 명절 글들을 보다 보면 마음이 복잡해요.', plan: Q, want: 'hold:externalCommunityClaim' },
  { card: 'P13', title: '닉네임', body: '닉네임 자주 바꾸시는 분들이 꽤 보이네요.', plan: Q, source: { site: '' }, want: 'review:externalCommunityClaim' },
  { card: 'P13', title: '반팔', body: '요즘 길에서 반팔 입은 분들이 많이 보이네요.', plan: Q, want: 'pass' },
  { card: 'P13', title: '뉴스', body: '뉴스에 비슷한 이야기가 자주 나오더라고요.', plan: Q, want: 'pass' },
  { card: 'P13', title: '친구', body: '친구가 그런 글을 자주 본대요.', plan: Q, want: 'pass' },
  { card: 'P13', title: '질문', body: '닉네임 자주 바꾸시는 편이세요? 이유가 궁금해요.', plan: Q, want: 'pass' },
  // 7 자료 — 봐 달라 × 원천 사진 수
  { card: 'P10', title: '목도리', body: '다 떴는데 한번 봐주세요.', source: { imageCount: 2 }, want: 'hold:mediaDependentDraft' },
  { card: 'P10', title: '목도리', body: '다 떴는데 한번 봐주세요.', want: 'review:mediaDependentDraft' },
  { card: 'P10', title: '머리', body: '어제 자른 머리인데 다들 보시기엔 어떠세요?', source: { imageCount: 0 }, want: 'review:mediaDependentDraft' },
  { card: 'P03', title: '다짐육', body: '색이 회색인데 요리 잘 아시는 분들 좀 봐주세요.', source: { imageCount: 0 }, want: 'pass' },
  { card: 'P03', title: '첫 글', body: '처음 써 보는 글이라 서툴러도 예쁘게 봐주세요.', want: 'pass' },
  { card: 'P03', title: '하소연', body: '제 얘기 좀 들어봐 주세요.', want: 'pass' },
  { card: 'P10', title: '목도리', body: '술을 검정으로 달지 아이보리로 달지 고민이에요.', source: { imageCount: 3 }, want: 'pass' },
  // 8 잘린 원문 — 없는 결말
  { card: 'P04', title: '강아지', body: '남편이 아침 산책 다녀와서 밥을 챙겨 주니 본체만체하네요.',
    source: { title: '강아지 사고', body: '강아지가 밤새 갈비를 뜯었어요\n아침에 산책 다녀와서 남편이 밥을 챙겨 주니까\n야' },
    want: 'review:truncatedSourceCompletion' },
  // 🔴 원문이 끝맺었으면 같은 초안도 통과
  { card: 'P04', title: '강아지', body: '남편이 아침 산책 다녀와서 밥을 챙겨 주니 본체만체하네요.',
    source: { title: '강아지 사고', body: '강아지가 밤새 갈비를 뜯었어요\n아침에 산책 다녀와서 남편이 밥을 챙겨 주니까 본체만체하네요' },
    want: 'pass' },
  // 🔴 잘린 끝을 초안이 버렸다
  { card: 'P04', title: '강아지', body: '강아지가 밤새 갈비를 뜯어 놨어요. 다들 이런 적 있으세요?',
    source: { title: '강아지 사고', body: '강아지가 밤새 갈비를 뜯었어요\n아침에 산책 다녀와서 남편이 밥을 챙겨 주니까\n야' },
    want: 'pass' },
  // 🔴 끝맺은 문장 뒤 한 글자 조각(cohort #3) · 수집 반복(cohort #22) · 기사 화면 글자
  { card: 'P10', title: '양갱', body: '엄마도 당 때문에 아주 가끔 드시는데 말이죠.',
    source: { title: '양갱', body: '양갱은 엄마가 좋아하시는 간식이죠\n그것도 요즘은 당 때문에 아주 가끔 드십니다.\n우' }, want: 'pass' },
  { card: 'P19', title: '명절', body: '모처럼 다 같이 갈비도 구워 먹고 김밥도 싸 먹었어요.',
    source: { title: '명절', body: '그래도 모처럼 모이니 갈비도 구워 먹고 김밥도 해서 먹으니 좋네요\n그래도 모처럼 모이니\n갈비도 구워 먹고' }, want: 'pass' },
  { card: 'P01', title: '기사', body: '가수 부녀 인터뷰 기사 보셨나요? 마음이 안 좋더라고요.',
    source: { title: '기사', body: '[단독] 가수 부녀 인터뷰 마음 안좋더라 입력 2026.09.21. 오후 3:33 기사원문 공감 텍스트 음성 변환 서비스 글자 크기 변경 공유하기' }, want: 'pass' },
  // 9 noLifeFactNeeded 가족사 — 사람 검토 · 과차단 반례
  { card: 'P08', title: '재산', body: '우리 집만 그런 게 아니었구나 싶네요.', plan: { selfBasis: 'noLifeFactNeeded', warrants: [] }, want: 'review:unwarrantedSelfClaim' },
  { card: 'P08', title: '재산', body: '우리 집만 그런 게 아니었구나 싶네요.', plan: Q, want: 'hold:unwarrantedSelfClaim' },
  { card: 'P08', title: '재산', body: '우리 집만 그런 게 아니었구나 싶네요.', plan: { selfBasis: 'lifeFacts', warrants: [{ fact: 'children' }] }, want: 'pass' },
  { card: 'P07', title: '관리비', body: '저희 아파트는 여름마다 관리비를 좀 깎아 줘요.', plan: { selfBasis: 'noLifeFactNeeded', warrants: [] }, want: 'pass' },
  { card: 'P14', title: '호칭', body: '친정이나 처가는 친정댁, 처가댁이라고 안 부르잖아요.', plan: { selfBasis: 'noLifeFactNeeded', warrants: [] }, want: 'pass' },
  { card: 'P08', title: '재산', body: '친구네도 그런대요. 친구 집만 그런 게 아니래요.', plan: { selfBasis: 'noLifeFactNeeded', warrants: [] }, want: 'pass' },
]

/**
 * 🔴 **문장 대조표** — 게이트 정본만 돈다(러너 경로 없이). 결함마다 반례·대조를 함께 둔다.
 *    `[카드, 제목, 본문, 기대]` — 기대는 `hold:<코드>` · `review:<코드>` · `pass`.
 */
export const LIFE_PHRASES: readonly [string, string, string, string][] = [
  // 1 혼인
  ['P05', '부부싸움', '너무 힘들어서 이혼 얘기가 나왔는데 막막해요.', 'hold:maritalStatusConflict'],
  ['P08', '부부싸움', '너무 힘들어서 이혼 얘기가 나왔는데 막막해요.', 'hold:maritalStatusConflict'],
  ['P20', '부부싸움', '남편이랑 별거 중이라 명절이 힘들어요.', 'hold:maritalStatusConflict'],
  ['P06', '부부싸움', '너무 힘들어서 이혼 얘기가 나왔는데 막막해요.', 'review:maritalStatusConflict'],
  ['P05', '부부싸움', '친구가 남편이랑 싸우고 이혼 얘기까지 나왔대요.', 'pass'],
  ['P05', '이혼', '이혼 얘기 나오면 다들 어떻게 하세요?', 'pass'],
  ['P05', '신혼 때', '신혼 때 이혼 얘기까지 나왔었는데 지금은 잘 지내요.', 'pass'],
  ['P05', '만약에', '만약 이혼하면 애들은 어떻게 될지 생각만 해봤어요.', 'pass'],
  ['P03', '혼자 키우기', '이혼하고 애들 둘 키우느라 정신이 없네요.', 'pass'],
  ['P16', '별거', '별거 중인데 명절이 제일 힘들어요.', 'pass'],
  ['P05', '드라마', '드라마 보니까 이혼 가정 아이들 이야기가 나오더라고요.', 'pass'],
  ['P05', '요즘', '요즘 이혼 얘기가 부쩍 많이 나온대요.', 'pass'],
  // 2 돌봄·한집
  ['P05', '시댁', '시어머니께 한동안 연락도 못 드렸어요.', 'hold:careHouseholdConflict'],
  ['P05', '시댁', '시댁에 다녀오는 길인데 차가 막히네요.', 'hold:careHouseholdConflict'],
  ['P12', '친정', '친정엄마께 한 달째 연락을 못 드렸어요.', 'hold:careHouseholdConflict'],
  ['P05', '연락', '한동안 연락을 못 드렸더니 서운해하시네요.', 'review:careHouseholdConflict'],
  ['P05', '동서', '동서가 시어머니께 연락도 안 드렸더니 난리가 났어요.', 'pass'],
  ['P05', '시어머니', '시어머니랑 같이 사는데 연락 안 드리면 서운해하실까요?', 'pass'],
  ['P05', '친정', '친정엄마한테 한동안 연락을 못 드렸어요.', 'pass'],
  ['P12', '친정', '친정엄마 뵈러 가는 길이에요.', 'pass'],
  ['P01', '시댁', '시어머니께 한동안 연락을 못 드렸어요.', 'pass'],
  ['P05', '시댁', '시댁에 연락 안 드리면 어떻게 될까 싶어요.', 'pass'],
  // 3 정신건강·질병
  ['P19', '기분', '기분이 너무 우울해서 정신과 가보려고요.', 'hold:unsupportedHealthClaim'],
  ['P12', '진단', '지난달에 당뇨 진단을 받았어요.', 'hold:unsupportedHealthClaim'],
  ['P19', '우울', '우울한 게 점점 심해져요.', 'review:unsupportedHealthClaim'],
  ['P02', '진단', '지난달에 당뇨 진단을 받았어요.', 'review:unsupportedHealthClaim'],
  ['P19', '언니', '언니가 우울증으로 정신과 다닌대요.', 'pass'],
  ['P19', '정신과', '정신과 처음 가면 뭘 물어보나요?', 'pass'],
  ['P19', '예전', '예전에 공황장애로 치료받은 적 있어요.', 'pass'],
  ['P07', '갱년기', '갱년기라 불면증이 심해져서 수면제를 먹어요.', 'pass'],
  ['P19', '기분', '요즘 좀 우울하네요.', 'pass'],
  ['P02', '허리', '허리 아파서 정형외과 다녀왔어요.', 'pass'],
  // 4 자녀 삶의 단계
  ['P01', '용돈', '딸이 첫 월급 받았다고 용돈을 보내 줬어요.', 'hold:childLifeStageConflict'],
  ['P01', '자취', '아들이 자취를 시작했어요.', 'hold:childLifeStageConflict'],
  ['P01', '결혼식', '딸 결혼식 준비하느라 바빠요.', 'hold:childLifeStageConflict'],
  ['P02', '군대', '아들이 지난주에 입대했어요.', 'hold:childLifeStageConflict'],
  ['P22', '알바', '딸이 알바비로 용돈을 줬어요.', 'review:childLifeStageConflict'],
  ['P01', '친구딸', '친구 딸은 첫 월급 받아서 봉투를 줬대요.', 'pass'],
  ['P01', '용돈', '딸이 용돈 올려 달래요.', 'pass'],
  ['P01', '꽃', '딸이 어버이날 꽃을 사왔어요.', 'pass'],
  ['P01', '군대', '아들이 나중에 군대 가면 어쩌나 싶어요.', 'pass'],
  ['P11', '명절', '큰애가 명절에 내려왔어요.', 'pass'],
  ['P14', '결혼식', '딸 결혼식 준비하느라 바빠요.', 'pass'],
]
