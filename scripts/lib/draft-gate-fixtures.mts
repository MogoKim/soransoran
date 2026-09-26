/**
 * 초안 게이트 fixture — 🔴 **운영 기계 초안 실측 6편** (2026-09-26 · read-only 로 옮겨 적음)
 *
 *   반례 4 · 대조 2. 원문은 마스킹된 수집물에서 **이 실패 모양을 재현하는 만큼만** 옮겼다
 *   (중복 수집된 뒷부분 · 폭 없는 공백은 뺐다). 초안 · 계획 · 카드 값은 운영 artifact 그대로다.
 *
 *   🔴 **fixture 가 실제보다 강하지 않게** — 계획은 운영 계획 모양 그대로(`selfBasis` · 근거 문장 ·
 *      protectedFacts), 카드는 정본 카드 값 그대로, 의미 검수는 운영에서 실제로 돌아온 `clean` 이다.
 *      의미 검수가 이 넷을 못 잡았다는 사실까지 재현해야 게이트가 무엇을 막는지 보인다.
 *
 *   🔴 이 파일은 순수 데이터 + 러너 경로 조립이다. DB · 네트워크 · provider 0.
 */
import { randomUUID } from 'node:crypto'
import type { PoolCard } from '../../src/lib/persona-pool-card'
import type { ChildAgeBand } from '../../src/lib/original-post-persona-match'
import type { DraftGateCode } from '../../src/lib/content-core/draft-life-gates'
import { pickV2, type DraftCandidate, type Pick } from '../../src/lib/micro-seed-auto-draft'
import { measureOriginality, copiesSourceTitle } from '../../src/lib/draft-originality'
import { SPEAKER_PLAN_VERSION } from '../../src/lib/content-core/speaker'
import { REVIEW_VERSION } from '../../src/lib/content-core/review'
import {
  CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION, STAGE_MAX_OUTPUT_LABEL,
} from '../../src/lib/content-core/pipeline'
import type { HumanReviewArtifact } from '../../src/lib/content-core/artifact'
import { materializePersonaAt } from '../../src/lib/persona-birth-anchor'
import {
  runContentCore, personaInputOf, STAGE_MODEL, type Ask, type AskResult,
} from './content-core-run.mjs'
import { safetyFilter } from './micro-seed-safety-filter.mjs'

export type GateFixture = {
  /** 운영 큐 id — 🔴 어느 실측인지 사람이 찾아갈 열쇠. 원문에서 유도한 값이 아니다 */
  queueId: string
  label: string
  source: { id: string; title: string; body: string }
  draft: { title: string; body: string }
  /** 🔴 계획 응답 — provider 가 돌려준 모양 그대로(`speakerWarrants`) */
  plan: Record<string, unknown>
  card: PoolCard
  /** 🔴 막혀야 하는 구조화 사유. 빈 배열이면 대조군 — 채택까지 가야 한다 */
  expect: DraftGateCode[]
}

const card = (o: Omit<PoolCard, 'forbiddenReactionRoles' | 'variationCount' | 'voiceLength'>
  & { voiceLength?: string | null }): PoolCard => ({
  forbiddenReactionRoles: [], variationCount: 6, voiceLength: o.voiceLength ?? null, ...o,
})
const bands = (...b: ChildAgeBand[]): ChildAgeBand[] => b

export const P12 = card({
  code: 'P12', title: '자녀 독립, 친정 어머니 곁에', ageBand: '50대 후반', birthDate: '1967-12-06',
  region: '수도권', maritalStatus: '기혼', spouseRelationship: '원만', childrenCount: 2,
  childrenAgeBands: bands('성인'), workStatus: '전업', economicStatus: '보통', housing: '자가',
  menopauseStatus: '후', parentCare: '상시', personality: ['차분함', '잘 들음'],
  noGoTopics: ['병명', '약'], noGoExpressions: [],
  voiceTokens: ['중간 길이', '"~더라고요"', '존댓말', '이모티콘 없음'], voiceLength: '중간 길이',
})
export const P02 = card({
  code: 'P02', title: '아이 하나, 남편과 소원', ageBand: '40대 후반', birthDate: '1979-06-20',
  region: '광역시', maritalStatus: '기혼', spouseRelationship: '소원', childrenCount: 1,
  childrenAgeBands: bands('초등'), workStatus: '전업', economicStatus: '보통', housing: '자가',
  menopauseStatus: '전', parentCare: '없음', personality: ['조심스러움', '관찰형'],
  noGoTopics: ['남편 흉보기에 동조', '이혼 권유'], noGoExpressions: [],
  voiceTokens: ['중간 길이', '말끝 흐림("~같아요" "~더라고요")', '존댓말 강함'], voiceLength: '중간 길이',
})
export const P01 = card({
  code: 'P01', title: '아이 키우며 파트타임', ageBand: '40대 후반', birthDate: '1977-11-04',
  region: '수도권', maritalStatus: '기혼', spouseRelationship: '원만', childrenCount: 2,
  childrenAgeBands: bands('중고등'), workStatus: '파트타임', economicStatus: '빠듯', housing: '전세',
  menopauseStatus: '전', parentCare: '간헐', personality: ['부지런함', '현실적'],
  noGoTopics: ['남의 형편 비교'], noGoExpressions: [],
  voiceTokens: ['짧은 문장', '"~해요" 기본', '이모티콘 거의 없음'], voiceLength: '짧은 문장',
})
export const P14 = card({
  code: 'P14', title: '자녀 결혼시키고 한숨 돌린', ageBand: '50대 후반', birthDate: '1967-11-14',
  region: '중소도시', maritalStatus: '기혼', spouseRelationship: '원만', childrenCount: 1,
  childrenAgeBands: bands('성인'), workStatus: '은퇴', economicStatus: '여유', housing: '자가',
  menopauseStatus: '후', parentCare: '없음', personality: ['여유로움', '유머'],
  noGoTopics: ['형편 언급', '자랑'], noGoExpressions: [],
  voiceTokens: ['중간 길이', '"ㅎㅎ"', '이모티콘 가끔', '존댓말 부드러움'], voiceLength: '중간 길이',
})
export const P13 = card({
  code: 'P13', title: '성인 자녀 둘, 남편과 부딪히며', ageBand: '50대 후반', birthDate: '1969-07-02',
  region: '광역시', maritalStatus: '기혼', spouseRelationship: '갈등', childrenCount: 2,
  childrenAgeBands: bands('성인'), workStatus: '파트타임', economicStatus: '빠듯', housing: '전세',
  menopauseStatus: '후', parentCare: '없음', personality: ['할 말 하는 편', '정 많음'],
  noGoTopics: ['남편 험담 동조', '이혼 권유'], noGoExpressions: [],
  voiceTokens: ['길게(아주 길지는 않은 편)', '느낌표', '"진짜" 자주'], voiceLength: '길게',
})
export const P19 = card({
  code: 'P19', title: '셋 키워 다 보내고', ageBand: '60대 초반', birthDate: '1965-11-18',
  region: '중소도시', maritalStatus: '기혼', spouseRelationship: '소원', childrenCount: 3,
  childrenAgeBands: bands('성인'), workStatus: '은퇴', economicStatus: '보통', housing: '자가',
  menopauseStatus: '후', parentCare: '간헐', personality: ['무던함', '성실'],
  noGoTopics: ['병명', '약 언급'], noGoExpressions: ['"우리 때는"'],
  voiceTokens: ['짧음', '툭툭', '"~네요"', '이모티콘 없음'], voiceLength: '짧음',
})

const planOf = (o: Record<string, unknown>): Record<string, unknown> => ({
  decision: 'ok', closingIntent: 'ask', contentRoles: ['conversationSpark'],
  speakerWarrants: [], protectedFacts: [], universalReason: '', ...o,
})

export const FIXTURES: readonly GateFixture[] = [
  {
    queueId: 'cmue2ge8l00012yov9j1d27xn', label: 'P12 사진 의존 (원문 사진 · 우리 글엔 없음)',
    source: {
      id: 'fx-p12', title: '남편이 이 머리했을때 어울린다 했었는데 ㅋㅋ 넘나 촌시럽고 웃기죠',
      body: '2-3년전에 긴생머리가\n\n질려서 도전해 봤어요\n\n전 아렇게 펌한뒤\n\n엄청 웃었네요\n\n촌티나서요\n\n'
        + '근데 남편은 귀엽다 하더라구요\n\n<빈말일수도 있지만요>\n\n이머리 소화 가능한분 있나요????',
    },
    draft: {
      title: '예전에 했던 파마머리 생각나서 올려봐요',
      body: '2-3년 전쯤에 늘 하던 긴생머리가 지겨워서 파마를 한번 해본 적이 있었어요.\n\n'
        + '머리하고 거울을 보는데 제 눈에는 너무 촌스럽고 웃기더라고요.\n'
        + '근데 남편은 빈말인지 몰라도 귀엽다고 어울린다고 하더라고요.\n\n'
        + '이런 스타일 잘 소화하시는 분들도 계실까요?',
    },
    plan: planOf({
      personaCode: 'P12', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'spouse', requiredValue: '있음', evidenceRef: 'title', evidenceText: '남편이' }],
      protectedFacts: [{ kind: 'relation', text: '남편', evidenceRef: 'title' }],
    }),
    card: P12, expect: ['mediaDependentDraft'],
  },
  {
    queueId: 'cmuge1hw100012yurrubvszeh', label: 'P02 QUESTION · selfBasis=null 인데 자기 부모·자산',
    source: {
      id: 'fx-p02', title: '서울집팔고 경기도가는 거 후회할까요?',
      body: '부모님 은퇴하셔서요\n\n큰 수익은 없으세요\n\n재건축아파트사시고 시세차익은 좀 났지만\n\n'
        + '큰 은퇴자금은 없으시구요.\n\n재건축분담금보니 저 돈내고 새 집 필요없다고 반대시고요.\n\n'
        + '지금 집 팔고\n\n경기도 매수하면 12억정도 현금이 남아요.\n\n그걸로 은퇴자금할까하는데 \n\n무조건 서울인가요?',
    },
    draft: {
      title: '부모님 서울 집 정리하고 경기도로 가시는 거 어떨까요',
      body: '부모님이 은퇴하셨는데 따로 큰 수익이나 은퇴자금이 있는 건 아니시거든요.\n\n'
        + '지금 서울에 재건축 아파트 하나 갖고 계신데, 시세차익은 좀 봤지만 분담금 낼 생각 하니 '
        + '굳이 그렇게까지 새집에 살 필요 없다고 반대하시네요.\n\n'
        + '차라리 지금 집 팔아서 경기도 쪽으로 집 매수하고 나면 12억 정도 현금이 남는다고 하더라고요.\n'
        + '그 돈으로 은퇴 생활비 하시는 게 나을지 싶으면서도, 다들 무조건 서울이어야 한다고들 하니까 고민이 되네요.\n\n'
        + '서울 집 정리하고 경기도로 내려가는 선택, 나중에 많이 후회할까요?',
    },
    plan: planOf({
      personaCode: 'P02', stance: 'QUESTION', selfBasis: null,
      protectedFacts: [
        { kind: 'relation', text: '부모님', evidenceRef: 'head' },
        { kind: 'number', text: '12억', evidenceRef: 'head' },
      ],
    }),
    card: P02, expect: ['unwarrantedSelfClaim'],
  },
  {
    queueId: 'cmuiexffr00012y20uili19gp', label: 'P01 카드 자녀 중고등 · 초안은 "중고등 돼서 … 오면"',
    source: {
      id: 'fx-p01', title: '애들 중고등 정도 되면 남편과 어떤가요?',
      body: '애들이 엄마아빠랑 심적으로 멀어지는 나이 되면 \n\n남편이랑 둘이 다니기 되게 어색할 것 같은..ㅋ '
        + '뭔가 허전하고 심심할 것 같아요ㅠ\n\n지금은 뭐든 애들과 함께니까~ 남편과 그냥 친구처럼 동지처럼 '
        + '지내는데 나중에 어떨지 궁금하네요',
    },
    draft: {
      title: '애들 크고 나면 남편이랑 둘만 어떠신가요?',
      body: '애들이 중고등학생쯤 돼서 부모랑 심적으로 멀어지는 시기가 오면요.\n\n'
        + '남편이랑 둘만 다니기 되게 어색하거나 허전하지는 않으신가요? ㅠ\n\n'
        + '지금은 늘 애들이랑 다 같이 움직이니까 남편하고도 그냥 동지처럼 친구처럼 지내는데...\n'
        + '나중에 둘만 남으면 심심할 것 같기도 하고 어떨지 궁금해요.\n\n선배님들은 어떠셨나요?',
    },
    plan: planOf({ personaCode: 'P01', stance: 'QUESTION', selfBasis: null }),
    card: P01, expect: ['lifeStageTenseConflict'],
  },
  {
    queueId: 'cmuf9bpui00012yigxgmo9yxz', label: 'P14 성인 자녀·은퇴 · 초안은 "남편이 육아휴직 · 초1 아이"',
    source: {
      id: 'fx-p14', title: '육아휴직 중인 남편이 차린 아이 아침밥',
      body: '어제 치킨배달로 왔다가 남은 치즈스틱에 단무지 넣어서 김밥싸줬다라고요. 저는 몸에 좋은 재료가 '
        + '너무 없고 가공식품 위주라 별로인 것 같은데 어떻게 보세요? 참고로 남편이 육아휴직 쓰고 초1 아이 '
        + '케어하기로 한 상황입니다.',
    },
    draft: {
      title: '육아휴직 중인 남편이 만든 김밥,, 어떻게 보시나요?',
      body: '남편이 육아휴직 쓰고 초1 아이를 돌보기로 했다는데요,\n\n'
        + '아침밥으로 어제 치킨 시켜 먹고 남은 치즈스틱에 단무지 넣어서 김밥 싸줬다고 하네요.\n\n'
        + '가공식품 위주이고 몸에 좋은 재료가 너무 없어 보여서 별로인 것 같기도 한데,,\n'
        + '회원님들은 어떻게 보시나요? 궁금하네요^^',
    },
    plan: planOf({
      personaCode: 'P14', stance: 'QUESTION', selfBasis: null,
      protectedFacts: [
        { kind: 'searchTerm', text: '육아휴직', evidenceRef: 'title' },
        { kind: 'searchTerm', text: '치즈스틱', evidenceRef: 'head' },
        { kind: 'searchTerm', text: '단무지', evidenceRef: 'head' },
        { kind: 'searchTerm', text: '김밥', evidenceRef: 'head' },
        { kind: 'searchTerm', text: '초1', evidenceRef: 'head' },
      ],
    }),
    card: P14, expect: ['lifeStageTenseConflict'],
  },
  {
    queueId: 'cmuf2vwb000012y160uuh91lv', label: '🟢 대조 P13 처가 사위 (1인칭 허가 · 카드 일치)',
    source: {
      id: 'fx-p13', title: '처가가면 사위가 누워있는 경우 흔한가요?',
      body: '오자마자 1살 아기는 거실에 풀어놓고 방들어가서 사위가 4-5시간 누워서 폰하다 자고 형수가 '
        + '음식사오니깐 나오는데 원래 사위들은 다 그런가요??\n\n먹은거 설거지는 저희 남편이 하고 여자들이 '
        + '뒷정리 하고 본인은 치우는 척만 하다가 방들어가서 짐챙겨서 집 갈 채비하는데요..\n\n저희 남편\n좀 당황스러워서요.',
    },
    draft: {
      title: '처가 와서 누워만 있는 사위 흔한가요?',
      body: '처가에 와가지고는 1살 아기는 거실에 그냥 두고\n방에 쏙 들어가서 4~5시간을 누워서 폰 보고 자더라고요!\n\n'
        + '음식 사오니까 그제야 슬그머니 나오는데\n진짜 다들 이러는지 당황스럽네요.\n\n'
        + '다 먹고 나서는 저희 남편이 설거지하고 여자들이 뒷정리 다 하는데\n'
        + '치우는 척 찔끔 하더니 또 방에 쏙 들어가서 갈 짐 챙기네요..\n\n원래 사위들은 처가가면 다 이러나요??',
    },
    plan: planOf({
      personaCode: 'P13', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
      speakerWarrants: [{ fact: 'spouse', requiredValue: '있음', evidenceRef: 'head', evidenceText: '저희 남편' }],
      protectedFacts: [
        { kind: 'relation', text: '사위', evidenceRef: 'title' },
        { kind: 'number', text: '1살', evidenceRef: 'head' },
        { kind: 'relation', text: '남편', evidenceRef: 'head' },
      ],
    }),
    card: P13, expect: [],
  },
  {
    queueId: 'cmuidrbe500012y0g6et30492', label: '🟢 대조 P19 명절 음식 (성인 자녀 셋 · 지금으로 말함)',
    source: {
      id: 'fx-p19', title: '차례는 안지내는데 이건 당최',
      body: '군대간 막둥이 휴가 나오고\n\n타지에 직장 다니는 큰딸 큰아들 식구 다 모이니 안할수가 없더이다 ...'
        + '사놓은건 귀신같이 알아  엄마게 맛있어 하는 놈들  오며가며 먹으라 넉넉히 한다 했는데 뭐 더 할거 없나 '
        + '찾아보는 애미여라 ㅎ\n\n근데 차례 안지내면 편할 줄 알았는데 당최 이건 뭐...등갈비찜 먹고싶다는 놈\n'
        + '조금 쉬었다 동그랑땡 등갈비찜 소갈비찜 하려구요 ㄷㄷ',
    },
    draft: {
      title: '차례는 안 지내도 명절은 명절이네요',
      body: '차례 안 지내면 편할 줄 알았는데 꼭 그렇지만도 않네요.\n\n군대 간 막내 휴가 나오고\n'
        + '타지서 직장 다니는 큰딸에 큰아들 식구까지 다 모이니 음식을 안 할 수가 없더군요.\n'
        + '사놓은 건 귀신같이 알고 엄마 음식이 제일 맛있다고들 하니 원.\n'
        + '오며 가며 먹으라고 넉넉하게 준비했는데도 뭐 더 해줄 거 없나 자꾸 찾아보게 되네요.\n\n'
        + '등갈비찜 먹고 싶다는 녀석도 있어서\n조금 쉬었다가 동그랑땡 부치고 등갈비찜이랑 소갈비찜 하려고요.\n'
        + '몸은 힘든데 애들 입에 들어갈 생각 하니 또 즐겁게 하게 되네요.\n\n다들 즐겁고 풍요로운 명절 보내세요.',
    },
    plan: planOf({
      personaCode: 'P19', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts', closingIntent: 'share',
      speakerWarrants: [
        { fact: 'children', requiredValue: '있음', evidenceRef: 'head',
          evidenceText: '군대간 막둥이 휴가 나오고\n\n타지에 직장 다니는 큰딸 큰아들' },
        { fact: 'childAgeBand', requiredValue: '성인', evidenceRef: 'head',
          evidenceText: '타지에 직장 다니는 큰딸 큰아들' },
      ],
      protectedFacts: [
        { kind: 'searchTerm', text: '등갈비찜', evidenceRef: 'head' },
        { kind: 'searchTerm', text: '동그랑땡', evidenceRef: 'head' },
        { kind: 'searchTerm', text: '소갈비찜', evidenceRef: 'head' },
      ],
    }),
    card: P19, expect: [],
  },
]

/** 🔴 운영에서 실제로 돌아온 의미 검수 — 넷 다 `clean` 이었다 */
export const CLEAN_REVIEW = {
  issues: [], droppedFromSource: [], unsupportedAdditions: [], lifeContradictions: [],
  confidence: 0.95, note: '원문의 핵심을 충실히 유지했다',
}

export const FIXTURE_NOW = new Date('2026-09-26T03:00:00.000Z')
const SAMPLES = ['그러게요 저도 비슷하게 느꼈어요', '맞아요 저도 같은 생각이에요', '저희도 그랬어요']

/** 🔴 요청 수를 센다 — 게이트가 유료 검수 **앞**에서 막는지 값으로 본다 */
export type AskLog = { stage: string }[]

const ok = (text: string): AskResult => ({
  ok: true, rawText: text, truncated: false, usageKnown: true,
  inputTokens: 100, outputTokens: 20, thoughtsTokens: null, usd: 0.0001, blocked: false,
})
const cannedAsk = (fx: GateFixture, log: AskLog): Ask => async (stage) => {
  log.push({ stage })
  return ok(JSON.stringify(stage === 'speakerPlan' ? fx.plan : stage === 'draftGen' ? fx.draft : CLEAN_REVIEW))
}

export type PathResult = {
  art: HumanReviewArtifact
  pick: Pick | null
  /** 🔴 채택 판정이 본 후보 — 러너가 봉투에 싣는 안전·독창성 값 그대로 */
  cand: DraftCandidate | null
  asks: AskLog
}

/**
 * 🔴 **러너와 같은 순서로 돈다** — `runContentCore` → 안전·독창성 재측정 → `pickV2`(초안 게이트 입력 포함).
 *    `micro-seed-auto-draft.mts` 의 채택 루프가 넘기는 값과 같은 칸을 같은 함수로 만든다.
 *    🔴 `cachedAdopt` 는 **옛 캐시 artifact** 를 흉내 낸다 — 새 deterministic 을 거치지 않고
 *       `adopt` 로 저장된 한 장이 채택 자리에 왔을 때도 막히는지 본다.
 */
export async function runFixturePath(fx: GateFixture, opt: { cachedAdopt?: boolean } = {}): Promise<PathResult> {
  const asks: AskLog = []
  const persona = personaInputOf(fx.card, { samples: SAMPLES, bundleDigest: `bundle-${fx.card.code}` })
  let art = await runContentCore({
    artifactId: randomUUID().replace(/-/g, ''),
    sourceArticleId: fx.source.id, title: fx.source.title, maskedBody: fx.source.body,
    personas: [persona], personaPoolSize: 1, voiceSourceDigest: 'asset000000000',
    ask: cannedAsk(fx, asks), now: FIXTURE_NOW, callCap: 6,
    contract: {
      sourceInputHash: `fx-${fx.card.code}`, pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
      promptVersion: CONTENT_CORE_PROMPT_VERSION, speakerPlanVersion: SPEAKER_PLAN_VERSION,
      reviewVersion: REVIEW_VERSION, planPromptDigest: 'plan000000000000', stageModels: STAGE_MODEL,
      stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL, voiceAssetDigest: 'asset000000000',
      personaPoolDigest: 'pool0000000000',
    },
  })
  if (opt.cachedAdopt === true && art.draft !== null) {
    art = { ...art, review: { ...art.review, machineOutcome: 'adopt', machineReason: '' } }
  }
  if (art.draft === null) return { art, pick: null, cand: null, asks }
  const nowIso = FIXTURE_NOW.toISOString()
  const cand: DraftCandidate = {
    sourceArticleId: fx.source.id, draftNo: 1,
    title: art.draft.title, body: art.draft.body,
    safetyVerdict: safetyFilter({ title: art.draft.title, body: art.draft.body }).verdict,
    originality: measureOriginality(`${art.draft.title}\n${art.draft.body}`, `${fx.source.title}\n${fx.source.body}`),
    generatedAt: nowIso,
  }
  const pick = pickV2({
    judgement: { sourceArticleId: fx.source.id, decision: 'AUTO_SEED', semanticRisks: [] },
    draft: cand, seenTitles: new Set<string>(), seenBodies: new Set<string>(), sourceUsed: false,
    machineOutcome: art.review.machineOutcome, machineReason: art.review.machineReason,
    sourceTitleCopied: copiesSourceTitle(fx.source.title, cand.title), crisisStop: null,
    ageFact: {
      ageBand: fx.card.ageBand, selfBasis: art.plan?.selfBasis ?? null,
      // 🔴 러너와 같다 — 그날 나이
      personaExactAge: (() => {
        const v = materializePersonaAt({
          card: { code: fx.card.code, birthDate: fx.card.birthDate, ageBand: fx.card.ageBand }, now: FIXTURE_NOW,
        })
        return v.ok ? v.at.exactAge : null
      })(),
    },
    draftGate: { plan: art.plan ?? null, card: fx.card },
  }, nowIso)
  return { art, pick, cand, asks }
}
