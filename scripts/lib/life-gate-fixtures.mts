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
import type { DraftGateCode, DraftLifeReviewCode } from '../../src/lib/content-core/draft-life-gates'
import type { GateFixture } from './draft-gate-fixtures.mjs'

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

export const LIFE_FIXTURES: readonly LifeFixture[] = [
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
