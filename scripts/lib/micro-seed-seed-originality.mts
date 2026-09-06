/**
 * Seed Originality 초안 생성 — 🔴 **순수 로직. I/O 도 LLM 도 없다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-U · §4-X · §4-AA
 *
 * 🔴 **LLM 을 부르지 않는다. 그래서 이렇게 만든다.**
 *    ① 원문 **제목에서만** 소재(무엇을 묻는 글인가)를 찾는다 — 키워드 사전.
 *    ② 그 키워드를 **일반화된 소재어**로 바꾼다 (리조트·호텔·펜션 → "숙소").
 *    ③ 소재어를 템플릿에 끼워 **커뮤니티 질문·공감형** 초안을 만든다.
 *    분류하지 못하면 **초안을 만들지 않는다** — 그럴듯한 문장을 지어내지 않는다.
 *
 * 🔴 **원문 문장을 쓰지 않는다 — 계약으로 강제한다.**
 *    제목의 낱말은 두 갈래다.
 *      · **소재 낱말**: 사전에 걸린 것. 초안에 써도 된다(그게 소재니까).
 *      · **나머지 낱말**: 지역명·브랜드명·학년 표현·사람 이름 등. **초안에 나오면 안 된다.**
 *    후자를 하나하나 분류하려 들지 않는다 — 분류가 틀리면 새어 나간다.
 *    "소재로 인정된 것 말고는 전부 버린다" 가 더 좁고 확실하다.
 *
 * 🔴 **DB · Sheet · LLM · 발행 · noindex · Raw Vault · 네이버 · 82cook 없음.**
 */
import { safetyFilter, type SafetyResult } from './micro-seed-safety-filter.mjs'

/** 🔴 브랜드 규칙 — 이 낱말들은 어디에도 쓰지 않는다 */
export const BANNED_HONORIFICS: readonly string[] = ['시니어', '어르신', '노인', '실버'] as const

/** 🔴 원문 제목과 이만큼 연속으로 겹치면 '소재만 가져왔다' 가 아니다 */
export const MAX_SOURCE_OVERLAP = 6

/**
 * 🔴 원천 하나당 만드는 초안 수 — **2개다** (2026-09-06, 3개에서 줄였다).
 *
 *    1·2회차 실측: REVISE 8건 중 **4건이 "구조·소재 중복"** 이었다.
 *    토픽당 템플릿이 3개 고정이라, 한 원천에서 3개를 뽑으면 그중 하나는 거의 항상 겹쳤다.
 *    수정 필요 53.3% 는 초안 품질이 아니라 **"3개 중 1개는 중복" 이라는 구조**가 만든 숫자였다.
 *    그래서 §4-AC ⑥ 숫자를 손대기 전에 **만드는 수를 먼저 줄인다** —
 *    기준을 데이터에 맞추는 것보다 데이터를 만드는 구조를 고치는 것이 먼저다.
 */
export const DRAFTS_PER_SOURCE = 2

export type TopicKey =
  | 'travelFood' | 'travelStay' | 'household' | 'family' | 'moneyLater' | 'bodyHealth' | 'mindTies'
  | 'careParent' | 'morningBite'

export const TOPIC_LABEL: Record<TopicKey, string> = {
  travelFood: '여행 · 먹거리',
  travelStay: '여행 · 숙소',
  household: '살림 · 주방',
  family: '가족 · 자녀 · 손주',
  moneyLater: '돈 · 노후',
  bodyHealth: '몸 · 건강',
  mindTies: '관계 · 마음',
  careParent: '간병 · 부모 돌봄',
  morningBite: '아침 · 간식',
}

/**
 * 소재 사전 — 🔴 **매치된 낱말이 아니라 `material`(일반화된 말) 을 초안에 쓴다.**
 *    "핀일로 후라이팬" 이 걸려도 초안에 들어가는 것은 `후라이팬` 이다.
 *    브랜드 일반화가 별도 단계가 아니라 **사전 구조 자체**로 이뤄진다.
 */
type Rule = { re: RegExp; material: string; topic: TopicKey }

export const TOPIC_RULES: readonly Rule[] = [
  // 여행 · 먹거리 — 🔴 '맛집' 은 지역과 붙어 다니지만 지역은 소재가 아니다
  { re: /맛집|먹을\s?곳|밥집|먹거리/, material: '맛집', topic: 'travelFood' },
  // 여행 · 숙소 — 리조트·호텔·펜션은 전부 '숙소' 로 모은다
  { re: /리조트|호텔|펜션|숙소|민박/, material: '숙소', topic: 'travelStay' },
  // 살림 · 주방
  { re: /후라이팬|프라이팬/, material: '후라이팬', topic: 'household' },
  { re: /냄비|압력솥/, material: '냄비', topic: 'household' },
  { re: /그릇|접시|밥그릇/, material: '그릇', topic: 'household' },
  { re: /청소기|세탁기|건조기|식기세척기/, material: '가전', topic: 'household' },
  // 🔴 '요리' 단독은 넣지 않는다 — "요리 못해요" 같은 글까지 물어 너무 넓어진다
  { re: /조미료|양념|간\s?맞추/, material: '조미료', topic: 'household' },
  // 가족
  { re: /손주|손자|손녀/, material: '손주', topic: 'family' },
  // 🔴 '가족' 자체도 잡는다 — material 이 '가족' 인데 그 낱말을 못 잡으면 사전에 구멍이 난다
  //    (2026-09-05 fixture 가 잡아냈다: "가족 얘기" 가 분류되지 않았다)
  { re: /사위|며느리|시어머니|친정|가족|자녀|딸|아들/, material: '가족', topic: 'family' },
  // 돈 · 노후
  { re: /연금|노후|생활비|용돈/, material: '노후 준비', topic: 'moneyLater' },
  { re: /보험|적금|예금/, material: '목돈 관리', topic: 'moneyLater' },
  // 몸 · 건강 — 🔴 제외하지 않는다. 단정하지 않을 뿐이다 (§4-J)
  { re: /갱년기/, material: '갱년기', topic: 'bodyHealth' },
  { re: /무릎|허리|어깨/, material: '관절', topic: 'bodyHealth' },
  { re: /운동|걷기|산책/, material: '운동', topic: 'bodyHealth' },
  { re: /잠|불면|수면/, material: '잠', topic: 'bodyHealth' },
  // 🔴 간병 · 부모 돌봄 — **좁게 잡는다.**
  //    '요양' 단독은 요양원 홍보글까지 물어서 뺐다. '입원' 도 뺐다 —
  //    의료 상황 자체를 소재로 삼으면 진단·치료 얘기로 흐른다(§4-J).
  //    여기서 다루는 것은 **돌보는 사람의 마음과 부담**이지 환자의 병이 아니다.
  { re: /간병|병간호|요양보호|돌봄/, material: '간병', topic: 'careParent' },
  // 🔴 아침 · 간식 — 특정 식품·브랜드가 걸려도 초안에 나가는 것은 '아침' 뿐이다
  { re: /아침\s?식사|아침밥|아침에\s?먹|간식|견과류/, material: '아침', topic: 'morningBite' },
  // 관계 · 마음
  { re: /친구|모임/, material: '친구', topic: 'mindTies' },
  { re: /남편|부부/, material: '부부', topic: 'mindTies' },
  // 🔴 '전화' 단독은 넣지 않는다 — "전화기 고장" 까지 물어 소재가 아니게 된다
  { re: /전화\s?수다|통화/, material: '통화', topic: 'mindTies' },
  // 여행 자체는 맨 뒤 — 위 소재가 더 구체적이면 그쪽을 쓴다
  { re: /여행|나들이|휴가/, material: '여행', topic: 'travelFood' },
]

type Template = { title: (m: string) => string; body: (m: string) => string }

/**
 * 커뮤니티 질문 · 공감형 템플릿 — 🔴 정보글 · SEO글 · 뉴스글이 아니다.
 *
 *    셋 다 **답이 아니라 질문으로 끝난다.** 우리가 알려주는 글이 아니라
 *    회원이 자기 얘기를 꺼내게 하는 글이라서다 (North Star: 주간 재방문 참여).
 */
/**
 * 받침이 있는가 — 한글 음절만 본다.
 *
 * 유니코드에서 한글 음절은 (초성·중성·종성) 이 하나의 코드로 합쳐져 있다.
 * `(code - 0xAC00) % 28` 이 종성 자리이고, 0 이면 받침이 없다.
 * 한글이 아닌 글자(영문·숫자)는 판별할 수 없으므로 **없음**으로 둔다 — 조사를 붙이는 쪽이
 * 어색해지는 게, 있는 척했다가 "조미료은" 같은 비문을 내는 것보다 낫다.
 */
export function hasBatchim(word: string): boolean {
  const last = word.trim().slice(-1)
  if (last === '') return false
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return false
  return (code - 0xac00) % 28 !== 0
}

/**
 * 소재어 뒤에 붙는 조사를 고른다 — 🔴 **템플릿에 조사를 직접 쓰지 않는다**.
 *
 * 한 슬롯에 여러 소재가 들어온다. `${m}은` 이라고 박아두면 "후라이팬은" 은 맞지만
 * **"조미료은"** 이 된다 — 3회차 초안에서 실제로 나왔고 REVISE 사유가 됐다(2026-09-06).
 * 슬롯을 쓰는 문장에서 조사가 필요하면 반드시 이 함수를 거친다.
 *
 *   josa('조미료', '은', '는')  // '는'
 *   josa('후라이팬', '은', '는') // '은'
 */
export function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  return hasBatchim(word) ? withBatchim : withoutBatchim
}

export const TEMPLATES: Record<TopicKey, readonly Template[]> = {
  travelFood: [
    // 🔴 3번째 템플릿을 뺐다 (2026-09-06) — "여행 가면 꼭 챙기는 게 있나요?" — 제목은 챙기는 것인데 본문은 시장 방문이라 묻는 것이 어긋났다
    {
      title: (m) => `여행 가면 ${m} 어떻게 고르세요?`,
      body: (m) =>
        '이번에 오랜만에 며칠 다녀오는데 갈 곳만 정해놓고 나머지는 아직이에요.\n' +
        '검색하면 광고글이 반이라 뭘 믿어야 할지 모르겠더라고요.\n\n' +
        `다들 낯선 동네 가면 ${m} 어떻게 고르세요?\n` +
        '저는 그냥 사람 많은 데로 가는 편인데, 그게 제일 나은 건지 모르겠어요.',
    },
    {
      title: () => '여행 가서 후회한 한 끼, 있으세요?',
      body: () =>
        '줄 서서 먹었는데 그냥 그랬던 적이 있어요.\n' +
        '반대로 지나가다 아무 생각 없이 들어갔는데 아직 생각나는 데도 있고요.\n\n' +
        '여행 가서 "여기서 이걸 먹지 말걸" 했던 적 있으세요?\n' +
        '다음엔 안 그러려면 뭘 봐야 하는지 배우고 싶어서요.',
    },
  ],
  travelStay: [
    // 🔴 3번째 템플릿을 뺐다 (2026-09-06) — "온 가족 여행에서 제일 어려운 게 뭐예요?" — 막연해서 답이 흩어진다
    {
      title: (m) => `아이랑 같이 갈 ${m}, 뭐 보고 고르세요?`,
      body: (m) =>
      // 🔴 "아이가 끼니" 를 뺐다 (2026-09-06). "끼니까" 의 축약이지만 숙소 이야기
      //    안에서는 **"아이 끼니(식사)"** 로도 읽힌다 — 한 문장이 두 가지로 읽히면
      //    댓글이 엉뚱한 데로 간다. 첫 줄의 "거기서" 도 없앴다.
        '온 가족이 같이 움직이기로 했는데 잘 데를 못 정하고 있어요.\n' +
        '어른끼리면 아무 데나 괜찮은데, 아이가 같이 가니 볼 게 많아지더라고요.\n\n' +
        `다들 아이나 손주랑 같이 갈 때 ${m}에서 뭘 제일 보세요?`,
    },
    {
      title: (m) => `가족 여행 ${m}, 비싼 데가 정답일까요?`,
      body: () =>
        '다 같이 가는 거라 좋은 데로 하자니 사람 수가 있어서 부담이고,\n' +
        '아끼자니 괜히 미안해지고 그래요.\n\n' +
        '결국 비싼 데가 정답이던가요?\n' +
        '돈 쓴 만큼 좋았다 싶었던 적 있으세요?',
    },
  ],
  household: [
    // 🔴 3번째 템플릿을 뺐다 (2026-09-06) — "살림 도구, 비싼 게 오래 가던가요?" — 2번과 "오래 쓰는 것" 축이 겹친다
    {
      title: (m) => `${m} 언제 바꾸세요?`,
      // 🔴 "낡았다" 를 전제하지 않는다 — 후라이팬에는 맞지만 조미료에는 안 맞는다.
      //    한 슬롯에 여러 소재가 들어오므로 **본문은 소재를 가리지 않는 말**로 둔다.
      body: (m) =>
        '늘 쓰던 걸 그대로 쓰게 되더라고요.\n' +
        '바꿔볼까 싶다가도 손에 익은 게 편해서 그냥 두게 되고요.\n\n' +
        // 🔴 제목이 이미 "언제 바꾸세요?" 다. 본문 끝에서 같은 말을 되풀이하면
        //    두 번 물어놓고 아무것도 더 묻지 않은 글이 된다. **한 걸음 더 들어간다.**
        `${m}${josa(m, '은', '는')} 몇 년쯤 쓰면 바꾸시나요?\n` +
        '아니면 못 쓰게 될 때까지 두시는 편인가요?',
    },
    {
      // 🔴 **슬롯을 비워두지 않는다** (2026-09-06).
      //    전에는 m 을 한 번도 쓰지 않는 문장이었다 — 그러니 조미료 원천에서도
      //    "주방에서 제일 오래 쓴 물건" 이라는 **살림 일반론**이 나왔다. 어느 글에서 왔는지
      //    초안만 보고는 알 수 없고, 다른 원천에서 온 초안과도 글자 그대로 같아진다(3회차 REVISE).
      //    소재를 드러내되 1번(교체 시점)과는 축을 달리한다 — 이쪽은 **고르는 기준**이다.
      title: (m) => `${m}, 고를 때 뭘 보세요?`,
      body: (m) =>
        '한번 정하고 나면 계속 그걸로 가게 되더라고요.\n' +
        '그래서 처음 고를 때가 오히려 더 어려운 것 같아요.\n\n' +
        // 🔴 여기도 제목("고를 때 뭘 보세요?")과 겹쳤다. 무엇으로 정했는지를 묻는다.
        `${m}, 다들 어떤 걸로 정하셨어요?\n` +
        '값을 보고 고르시는지, 쓰던 걸 그냥 다시 사시는지 궁금해서요.',
    },
  ],
  family: [
    // 🔴 3번째 템플릿을 뺐다 (2026-09-06) — 실측 없음 — 원천당 2개 정책에 맞춰 3번째를 뺐다
    {
      title: (m) => `${m} 얘기, 어디까지 하세요?`,
      body: () =>
        '좋은 일도 속상한 일도 밖에서 말하기가 애매할 때가 있어요.\n' +
        '자랑 같아 보일까 봐, 흉보는 것 같아 보일까 봐요.\n\n' +
        '다들 이런 얘기 어디까지 하세요?',
    },
    {
      title: () => '가족한테 서운했던 거, 말하는 편이세요?',
      body: () =>
        '말하면 분위기 나빠질까 봐 그냥 넘긴 적이 많아요.\n' +
        '그런데 안 하고 넘긴 게 쌓이더라고요.\n\n' +
        '다들 서운한 건 그때그때 말하는 편이세요?',
    },
  ],
  moneyLater: [
    // 🔴 3번째 템플릿을 뺐다 (2026-09-06) — 실측 없음 — 위와 같다
    {
      title: (m) => `${m}, 언제부터 챙기셨어요?`,
      body: () =>
        '해야 한다는 건 아는데 자꾸 미루게 되더라고요.\n' +
        '지금이라도 늦지 않았나 싶기도 하고요.\n\n' +
        '다들 언제부터 챙기기 시작하셨어요?',
    },
    {
      title: () => '한 달에 나가는 돈, 어떻게 관리하세요?',
      body: () =>
        '적어보면 줄겠지 싶어 시작했다가 며칠 만에 그만뒀어요.\n' +
        '그래도 안 하니까 어디로 새는지를 모르겠고요.\n\n' +
        '다들 어떻게 관리하세요?',
    },
  ],
  bodyHealth: [
    // 🔴 3번째 템플릿을 뺐다 (2026-09-06) — 실측 없음 — 위와 같다
    {
      title: (m) => `${m} 때문에 달라진 게 있으세요?`,
      body: () =>
        '전에는 아무렇지 않던 게 요즘은 신경 쓰이더라고요.\n' +
        '나만 그런가 싶어서 여쭤봐요.\n\n' +
        '다들 어떻게 지내세요?',
    },
    {
      title: () => '몸이 예전 같지 않다고 느낀 순간이 언제였어요?',
      body: () =>
        '별것 아닌 일에서 문득 느낄 때가 있어요.\n' +
        '서운하다기보다 그냥 그렇구나 싶고요.\n\n' +
        '다들 언제 그런 걸 느끼세요?',
    },
  ],
  careParent: [
    // 🔴 3번째 템플릿을 뺐다 (2026-09-06) — "혼자 감당하기 버거울 때 누구한테 기대세요?" — 2번과 구조가 겹치고 제목에 소재가 없어 범용 문장이 된다
    {
      // 🔴 "간병인 추천해주세요" 류를 만들지 않는다 — 그건 알선이지 우리 글이 아니다
      title: (m) => `${m}, 하시는 분들 제일 힘든 게 뭐예요?`,
      body: () =>
        '부모님 일로 오가다 보면 몸보다 마음이 먼저 지치더라고요.\n' +
        '괜찮은 척하다가 혼자 있을 때 울컥할 때가 있어요.\n\n' +
        '다들 제일 힘든 게 뭐였어요?',
    },
    {
      title: () => '부모님 일로 마음 무거울 때, 어떻게 버티세요?',
      body: () =>
        '해도 해도 부족한 것 같고, 형제들과도 말이 조심스러워지네요.\n' +
        '누구 탓도 아닌데 마음만 무거워요.\n\n' +
        '다들 그럴 때 어떻게 버티세요?',
    },
  ],
  morningBite: [
    // 🔴 2번째 템플릿을 뺐다 (2026-09-06) — "아침 챙겨 드시는 편이세요?" — 1번과 묻는 것이 사실상 같다. 🔴 여기만 3번이 아니라 2번을 뺐다(3번은 채택된 초안이다)
    {
      // 🔴 특정 제품·브랜드를 묻지 않는다 — material 은 '아침' 하나뿐이다
      title: (m) => `${m}에 뭐 드세요?`,
      // 🔴 마지막이 "다들 뭐 드세요?" 였다 — 제목에서 떨어져 나오면 **무엇에 대한
      //    질문인지 사라진다.** 목록에서 제목만 보고 들어온 사람에게는 더 그렇다.
      //    소재를 한 번 더 붙이고, 답하기 쉬운 갈래를 준다.
      body: (m) =>
        '차려 먹자니 시간이 없고 거르자니 속이 허해서 늘 고민이에요.\n' +
        '간단히 집어 먹을 걸 두고 먹는 편인데 늘 비슷하네요.\n\n' +
        `다들 ${m}${josa(m, '은', '는')} 어떻게 하세요?\n` +
        '거르는 편이세요, 뭐라도 챙기는 편이세요?',
    },
    {
      title: () => '집에 늘 두고 드시는 간식이 있으세요?',
      body: () =>
        '떨어지면 허전해서 꼭 다시 사두게 되는 게 하나쯤 있더라고요.\n' +
        '저는 손 가는 대로 집어 먹다가 양 조절이 안 되는 게 문제예요.\n\n' +
        '다들 늘 두고 드시는 게 있으세요?',
    },
  ],
  mindTies: [
    // 🔴 3번째 템플릿을 뺐다 (2026-09-06) — 실측 없음 — 위와 같다
    {
      // 🔴 슬롯을 쓰지 않는다. `${m} 사이` 는 친구·부부에는 맞지만
      //    "통화 사이" 는 비문이다(2026-09-06 실측). 셋 다 이어지는 말로 둔다.
      title: () => '요즘 누구랑 가장 자주 이야기하세요?',
      body: () =>
        '나이 들수록 자주 보는 사람만 보게 되더라고요.\n' +
        '연락 끊긴 사람도 늘고요.\n\n' +
        // 🔴 제목을 그대로 되풀이하지 않는다 (2026-09-06). 제목이 이미 물었으니
        //    본문 끝은 **한 걸음 더 들어간 것**을 묻는다.
        '그분하고는 주로 무슨 얘기 하세요?\n' +
        '멀어진 쪽은 다시 이어보신 적 있으세요?',
    },
    {
      title: () => '먼저 연락하는 편이세요?',
      body: () =>
        '늘 제가 먼저 하는 것 같아 괜히 서운할 때가 있어요.\n' +
        '그렇다고 안 하면 그대로 멀어지고요.\n\n' +
        // 🔴 여기도 제목과 겹쳤다.
        '한번 기다려보신 적 있으세요?\n' +
        '그러고 나서 어떻게 되던가요?',
    },
  ],
}

/** 🔴 소재 낱말이 아니어서 버려진 것 — 지역명·브랜드명·학년 표현이 여기로 온다 */
export type Material = {
  topic: TopicKey | null
  /** 초안에 쓰는 **일반화된** 소재어 */
  material: string | null
  /** 원문에서 실제로 걸린 낱말 (일반화 전) */
  matched: string | null
  /** 🔴 초안에 나오면 안 되는 원문 낱말 */
  dropped: string[]
}

/** 낱말 쪼개기 — 한글·영숫자 덩어리만 본다 */
export function tokenize(s: string): string[] {
  return (s.match(/[가-힣]+|[A-Za-z0-9]+/g) ?? []).filter((t) => t.length >= 2)
}

/**
 * 조사를 떼어낸다 — "아이랑" 과 "아이" 를 같은 말로 보기 위해서다.
 *
 * 🔴 **가장 긴 조사 하나만 떼면 안 된다.** "아이랑" 에서 "이랑" 을 떼면 "아" 한 글자가 되고,
 *    그러면 원형으로 되돌아가 일상어 목록에 걸리지 않는다(2026-09-05 실제로 걸렸다).
 *    그래서 **떼어낼 수 있는 후보를 전부** 만들어 하나라도 맞으면 같은 말로 본다.
 */
const PARTICLES: readonly string[] = [
  '이랑', '에서', '으로', '에게', '한테', '까지', '부터',
  '랑', '은', '는', '이', '가', '을', '를', '에', '와', '과', '의', '로', '도', '나', '만',
]

export function stems(token: string): string[] {
  const out = [token]
  for (const p of PARTICLES) {
    if (!token.endsWith(p)) continue
    const t = token.slice(0, -p.length)
    if (t.length >= 2) out.push(t)
  }
  return out
}

/**
 * 🟡 일상어 — **버릴 낱말에서 뺀다.**
 *
 * 🔴 이 규칙이 막으려는 것은 **지역명·브랜드명·학년 표현 같은 특정 식별어**다.
 *    한국어 흔한 말까지 막으면 "아이랑 같이 갈 숙소" 같은 정상 문장이 걸린다.
 *    실제로 걸렸고(2026-09-05), 그래서 좁혔다.
 *
 * 🔴 이 목록은 **좁게 유지한다.** 넓히면 브랜드명이 여기 섞여 새어 나간다.
 *    특정 가게·제품·지역을 가리킬 수 있는 말은 절대 넣지 않는다.
 */
export const COMMON_WORDS: readonly string[] = [
  '아이', '아이들', '가족', '남편', '엄마', '아빠', '친구', '사람', '우리', '저희',
  '여행', '추천', '부탁', '요즘', '오늘', '어제', '내일', '주말', '방학',
  '아침', '점심', '저녁',
  '어때요', '어떤', '어디', '언제', '무엇', '뭐가', '같이', '함께', '정말', '너무',
  '갈만한', '괜찮은', '좋은', '많은', '조금', '그냥', '혹시', '다들',
] as const

/**
 * 소재 찾기 — 🔴 **사전에 걸린 것만 소재다. 나머지는 전부 버린다.**
 *
 *    지역명·브랜드명·학년 표현을 각각 알아내려 하지 않는다.
 *    그런 분류는 틀리는 날 새어 나간다. "인정된 것 말고 전부 버린다" 가 더 좁다.
 */
export function findMaterial(title: string): Material {
  // 🔴 **memo 를 보지 않는다.** 인자로 받지도 않는다 — 타입에 없으면 실수로도 못 넘긴다.
  //    2026-09-05 사고: 검수자가 memo 에 "남의 가족 사정이 있다" 고 적었는데
  //    그 "가족" 이 소재 사전에 걸려, 간병 글이 가족 일반론 초안 3건으로 바뀌었다.
  //    memo 는 **왜 그렇게 판정했나** 를 적는 칸이지 소재가 아니다.
  const hay = title
  for (const rule of TOPIC_RULES) {
    const m = hay.match(rule.re)
    if (!m) continue
    const matched = m[0]
    // 🔴 소재로 인정된 것 + 일상어를 뺀 나머지 = 초안에 나오면 안 되는 낱말
    const dropped = tokenize(title).filter((t) => {
      if (t.includes(matched) || matched.includes(t) || rule.material.includes(t)) return false
      return !stems(t).some((x) => COMMON_WORDS.includes(x))
    })
    return { topic: rule.topic, material: rule.material, matched, dropped }
  }
  return {
    topic: null, material: null, matched: null,
    dropped: tokenize(title).filter((t) => !stems(t).some((x) => COMMON_WORDS.includes(x))),
  }
}

const norm = (s: string): string => s.replace(/\s+/g, '')

/** 원문 제목과 가장 길게 연속으로 겹치는 조각 */
export function longestOverlap(draft: string, sourceTitle: string): { len: number; frag: string } {
  const A = norm(draft)
  const B = norm(sourceTitle)
  let best = { len: 0, frag: '' }
  for (let i = 0; i < A.length; i++) {
    for (let j = i + best.len + 1; j <= A.length; j++) {
      const f = A.slice(i, j)
      if (!B.includes(f)) break
      if (f.length > best.len) best = { len: f.length, frag: f }
    }
  }
  return best
}

export type Draft = {
  draftNo: number
  title: string
  body: string
  bodyLength: number
  /**
   * 🔴 이 초안을 **언제 만들었는가** — 행마다 남긴다 (§4-AC ③).
   *    파일 최상위에만 두면 행을 골라 옮기는 순간(그럴 일이 반드시 생긴다)
   *    시각이 떨어져 나간다. TSV 한 줄만 떼어 봐도 알 수 있어야 한다.
   */
  generatedAt: string
  safety: SafetyResult
  overlap: number
  overlapFragment: string
  /** 🔴 버려야 할 원문 낱말이 초안에 남았는가 — 남으면 초안이 아니라 복붙이다 */
  leakedTokens: string[]
  bannedHonorifics: string[]
  ok: boolean
}

export type Expansion = {
  sourceArticleId: string
  /**
   * 🟡 이 소재가 **어느 승인 파일에서 왔나** (§4-AD ⑧).
   *    입력이 둘이 되면서, 나중에 "이 초안 어디서 왔냐" 를 물을 자리가 생겼다.
   *    🔴 **소재 분류에 쓰지 않는다** — memo 가 분류를 오염시킨 사고(⑨)와 같은 이유다.
   */
  sourceInput: string
  /** 🟡 그 파일에서의 판정 — 언제나 `SEED` 다. 다른 판정은 여기까지 오지 않는다 */
  sourceDecision: string
  /**
   * 🔴 어느 카페에서 왔는가 — articleId 만으로는 원천을 추적할 수 없다 (§4-AC ③).
   *    SRN 승인 export 에는 있는데 여기로 옮기지 않아 유실됐던 필드다.
   */
  sourceSite: string
  sourceTitle: string
  topic: TopicKey | null
  topicLabel: string
  material: string | null
  matched: string | null
  /** 🟡 무엇을 일반화했는가 — 사람이 읽는 한 줄 */
  generalized: string
  direction: string
  drafts: Draft[]
  /** 🔴 분류하지 못했다 — 사람이 써야 한다. 지어내지 않는다 */
  needsHuman: boolean
}

const DIRECTION: Record<TopicKey, string> = {
  travelFood: '목록이 아니라 고르는 방법과 실패담을 나누는 쪽으로 — 정보글이 되면 우리 얘기가 아니다',
  travelStay: '추천 목록이 아니라 같이 가는 사람에 따라 뭐가 달라지는가로',
  household: '제품 리뷰가 아니라 바꾸는 시점과 살림 습관을 묻는 쪽으로',
  family: '조언이 아니라 각자 어디까지 말하는지를 나누는 쪽으로',
  moneyLater: '재테크 정보가 아니라 미루게 되는 마음을 나누는 쪽으로',
  bodyHealth: '진단·처방이 아니라 달라진 것을 서로 확인하는 쪽으로 (§4-J)',
  mindTies: '해법이 아니라 비슷한 마음을 확인하는 쪽으로',
  careParent: '간병인 알선이 아니라 돌보는 사람의 마음과 부담을 나누는 쪽으로 — 병·치료는 다루지 않는다',
  morningBite: '특정 제품 추천이 아니라 아침을 어떻게 때우는지 나누는 쪽으로',
}

/**
 * SEED 한 행 → 초안 2~3개.
 *
 * 🔴 원문 body 가 없어도 동작한다 — **title 만** 쓴다.
 * 🔴 memo 는 받지 않는다 — 검수 메모가 소재 분류를 오염시킨 사고가 있었다(2026-09-05).
 *    (SRN export 는 SEED 행의 body 를 비워서 내보낸다. 그게 정상이다)
 */
export function expandSeed(
  row: {
    sourceArticleId: string; sourceSite?: string; title: string
    /** 🔴 아래 둘은 **기록용**이다. findMaterial 은 title 만 본다 */
    sourceInput?: string; sourceDecision?: string
  },
  generatedAt: string = new Date().toISOString(),
): Expansion {
  const title = String(row.title ?? '')
  const site = String(row.sourceSite ?? '')
  const mat = findMaterial(title)

  if (!mat.topic || !mat.material) {
    return {
      sourceArticleId: String(row.sourceArticleId ?? ''),
      sourceInput: String(row.sourceInput ?? ''),
      sourceDecision: String(row.sourceDecision ?? ''),
      sourceSite: site,
      sourceTitle: title,
      topic: null, topicLabel: '(분류 못 함)',
      material: null, matched: null,
      generalized: '소재를 찾지 못했다',
      direction: '🔴 사람이 직접 써야 한다 — 그럴듯한 문장을 지어내지 않는다',
      drafts: [],
      needsHuman: true,
    }
  }

  const m = mat.material
  const drafts: Draft[] = TEMPLATES[mat.topic].map((t, i) => {
    const dTitle = t.title(m)
    const dBody = t.body(m)
    const full = `${dTitle}\n${dBody}`
    const ov = longestOverlap(full, title)
    const safety = safetyFilter({
      title: dTitle, body: dBody, comments: [], qualityFlags: [], imageCount: 0, accessStatus: 'ok',
    })
    // 🔴 조사가 달라도 같은 말이면 샌 것이다 — 어간으로 본다
    const leaked = mat.dropped.filter((t2) => stems(t2).some((x) => full.includes(x)))
    const banned = BANNED_HONORIFICS.filter((w) => full.includes(w))
    return {
      draftNo: i + 1,
      title: dTitle, body: dBody, bodyLength: [...dBody].length,
      generatedAt,
      safety, overlap: ov.len, overlapFragment: ov.frag,
      leakedTokens: leaked, bannedHonorifics: banned,
      ok: safety.verdict === 'pass' && ov.len < MAX_SOURCE_OVERLAP && leaked.length === 0 && banned.length === 0,
    }
  })

  return {
    sourceArticleId: String(row.sourceArticleId ?? ''),
    sourceInput: String(row.sourceInput ?? ''),
    sourceDecision: String(row.sourceDecision ?? ''),
    sourceSite: site,
    sourceTitle: title,
    topic: mat.topic,
    topicLabel: TOPIC_LABEL[mat.topic],
    material: m,
    matched: mat.matched,
    generalized: mat.matched === m
      ? `버린 낱말 ${mat.dropped.length}개 (지역·브랜드·학년 표현 등)`
      : `"${mat.matched}" → "${m}" 로 일반화 · 버린 낱말 ${mat.dropped.length}개`,
    direction: DIRECTION[mat.topic],
    drafts,
    needsHuman: false,
  }
}

/** 산출물 컬럼 — 🔴 순서를 바꾸지 않는다. 뒤에만 추가한다 */
export const DRY_RUN_COLUMNS: readonly string[] = [
  'sourceArticleId', 'sourceTitle', 'topic', 'material', 'matched', 'generalized', 'direction',
  'draftNo', 'title', 'body', 'bodyLength',
  'safetyVerdict', 'safetyReasons', 'maxOverlapWithSourceTitle', 'leakedTokens', 'ok', 'note',
  // 🔴 §4-AC 간극 보강 (2026-09-05). **앞 17개 위치는 그대로** —
  //    TSV 를 위치로 읽는 쪽이 있어서 중간 삽입은 조용한 오독이 된다.
  'sourceSite', 'generatedAt',
  // 🔴 §4-AD ⑧ 입력이 둘이 됨 (2026-09-06). 역시 **맨 뒤에만** 붙인다.
  'sourceInput', 'sourceDecision',
] as const

export const DRY_RUN_NOTE = '발행 아님 · 초안일 뿐 · 사람 확인 전 사용 금지'
