/**
 * 🔴 **긴 사연(raw) → AI 원작 글 — 경계가 정해진 적응 경로** (2026-09-29 · `raw-adapt-v1`)
 *
 * 🔴 **왜 있나 — 실측 (2026-09-29, 운영 산출물 읽기 전용).**
 *    `rawOriginality` 축(본문 400자 이상 + 사연 축) 원천은 판정 395건 → 초안 **0건**이었다
 *    (09-22 이후만 봐도 121건 → 0건). 길은 둘 다 막다른 곳이었다:
 *      · 모델이 통과 라벨로 `AUTO_SEED` 를 말하면 정책이 `axisMismatch` HOLD 로 바꿨다(204건).
 *        그 판정은 **위험 0 · 확신 0.7 이상**이었다 — 판정 프롬프트는 SEED 와 RAW 를 정의하지도 않는다.
 *      · `AUTO_RAW` 가 나오면(83건) 받아 쓰는 레인이 없었다.
 *    버려진 원천은 댓글이 더 많았다(중앙값 raw 17 · 채택된 seed 10). 반응이 큰 글일수록 빠졌다.
 *
 * 🔴 **raw 를 seed 로 그냥 넘기지 않는다.** 같은 생성 경로(Content Core v2)를 타되 세 가지가 다르다:
 *    ① **화자 자리** — 1인칭 경험(`SELF_EXPERIENCE`)으로 쓰지 않는다. 긴 사연은 **한 회원의 삶**이다.
 *       우리 화자가 그것을 자기 일로 옮기면 사연이 새어 나간 것이다. 쟁점을 **관찰·생각·물음**으로 꺼낸다.
 *    ② **쟁점 보존** — 원문 제목의 주제 낱말이 하나 이상 남아야 하고, 원문에 논쟁 표지(서운 · 누가 맞나 ·
 *       어떻게 생각하세요 …)가 있으면 초안에도 하나 이상 남아야 한다. 불편한 소재(남녀·부부·시댁 갈등 ·
 *       연예인 · 돈 · 흔한 건강 궁금증 · 거친 의견)를 **순하게 만들어 반응 거리를 없애는 것**을 막는다.
 *    ③ **사람 검토** — 적응 초안은 창업자 gold 에 표본이 한 건도 없다. 자동 READY 로 가지 않는다
 *       (`DRAFT_LIFE_REVIEW:rawAdaptation` 경고). 적응 초안의 자동 READY 는 gold 에 적응 표본이 생긴 뒤 다시 증명한다.
 *
 * 🔴 **그대로인 것** — 실질 복제 · 원문 제목 복제 · 개인정보 · 금지어 · 위해(개인 특정 · 단정 명예훼손 ·
 *    괴롭힘 · 위험한 의료 지시) · 위기 신호 · 초안 게이트 · 의미 검수. 전부 기존 정본을 그대로 지난다.
 *    여기서 그 판정을 다시 쓰지 않는다.
 *
 * 🔴 순수하다. DB · 네트워크 · 파일 · LLM 없음.
 */
import { createHash } from 'node:crypto'

import { RAW_AXIS } from './micro-seed-auto-judge'

/** 🔴 적응 경로의 판 — 규칙·지시문이 바뀌면 올린다. 품질 계약 digest 에 들어간다 */
export const RAW_ADAPTATION_VERSION = 'raw-adapt-v1'

/** 🔴 초안 경로 둘 — `seed` 는 기존 그대로, `adapt` 는 위 세 가지를 더 지킨다 */
export const DRAFT_ROUTES = ['seed', 'adapt'] as const
export type DraftRoute = (typeof DRAFT_ROUTES)[number]

/**
 * 🔴 **판정 + 원천 축 → 초안 경로.** raw 축과 판정이 어긋나면 `null` — 초안을 만들지 않는다.
 *    · `AUTO_RAW`  → raw 축일 때만 `adapt`
 *    · `AUTO_SEED` → `seed` — 🔴 **단 raw 축이면 `null`** 이다. 긴 사연을 적응 없이 seed 로 흘리는 길을 닫는다
 *    판정 v4 는 축이 결정을 정하므로 정상 입력에서 어긋날 일이 없다. 어긋났다면 옛 판정이거나 입력이 섞인 것이다.
 *    🔴 seed 경로에 축 일치를 새로 요구하지 않는다 — 앞판(축을 보지 않았다)의 seed 동작을 그대로 둔다.
 */
export function draftRouteOf(decision: string, axis: string): DraftRoute | null {
  if (decision === 'AUTO_RAW') return axis === RAW_AXIS ? 'adapt' : null
  if (decision === 'AUTO_SEED') return axis === RAW_AXIS ? null : 'seed'
  return null
}

/**
 * 🔴 **판정 값만으로 요구되는 경로.** 채택 자리(`pickV2`)가 러너가 넘긴 경로를 믿지 않고
 *    판정에서 다시 읽는다 — `AUTO_RAW` 인데 적응 검사 입력이 없으면 채택하지 않는다.
 */
export function requiredRouteOf(decision: string): DraftRoute | null {
  if (decision === 'AUTO_SEED') return 'seed'
  if (decision === 'AUTO_RAW') return 'adapt'
  return null
}

/** 🔴 적응 경로의 결정적 실패 — 이름은 결정적 검사 정본(`DETERMINISTIC_CODES`)에 그대로 들어간다 */
export const RAW_ADAPTATION_CODES = ['adaptSelfExperience', 'adaptTopicLost', 'adaptDebateLost'] as const
export type RawAdaptationCode = (typeof RAW_ADAPTATION_CODES)[number]

export const RAW_ADAPTATION_LABEL: Readonly<Record<RawAdaptationCode, string>> = {
  adaptSelfExperience: '🔴 긴 사연을 화자의 1인칭 경험으로 옮기려 했다 — 한 회원의 삶을 우리 화자의 일로 만들지 않는다',
  adaptTopicLost: '🔴 원문 제목의 주제 낱말이 초안에 하나도 없다 — 반응을 부른 소재가 사라졌다',
  adaptDebateLost: '🔴 원문의 논쟁·물음이 초안에서 사라졌다 — 불편하다고 순하게 만들지 않는다',
}

/**
 * 🔴 **사람 검토 경고 이름** — 후보 봉투의 `lifeReview` 로 나르고 적재기가 `DRAFT_LIFE_REVIEW:rawAdaptation`
 *    으로 싣는다. 경고가 있으면 자동 READY 표본이 아니다(`eligibilityOf` 가 경고 0 을 요구한다).
 */
export const RAW_ADAPTATION_REVIEW_CODE = 'rawAdaptation'

// ─────────────────────────────────────────────────────────
// 🔴 주제 낱말 — 원문 **제목**에서만 뽑는다 (본문은 한 회원의 사연이라 낱말을 옮기라고 하지 않는다)
// ─────────────────────────────────────────────────────────

/** 끝에 붙은 조사 — 긴 것부터 본다. 🔴 떼고 남는 것이 2자 미만이면 떼지 않는다("나이" 를 "나" 로 만들지 않는다) */
const JOSA: readonly string[] = [
  '에서는', '에게서', '한테서', '으로는', '이라도', '이라서', '이랑은',
  '에서', '에게', '한테', '께서', '으로', '이랑', '하고', '까지', '부터', '처럼', '보다', '마저', '조차', '마다',
  '이나', '이고', '은요', '는요',
  '은', '는', '이', '가', '을', '를', '에', '의', '도', '로', '와', '과', '랑', '만',
] as const

/** 🔴 뜻이 없는 낱말 — 제목마다 흔히 붙는다. 주제가 아니다 */
const STOP: ReadonlySet<string> = new Set([
  '요즘', '진짜', '정말', '너무', '그냥', '다들', '여러분', '혹시', '어떻게', '어떤', '이런', '그런', '저런',
  '이거', '그거', '저거', '이게', '그게', '제가', '저는', '저희', '우리', '내가', '나는', '오늘', '어제', '내일',
  '이번', '지난', '생각', '궁금', '질문', '고민', '이야기', '얘기', '문의', '조언', '부탁', '도움', '정도', '때문',
  '하나', '가지', '모두', '다른', '같은', '많이', '조금', '계속', '자꾸', '벌써', '아직', '이제', '갑자기',
  '먼저', '나중', '항상', '매번', '맨날', '결국', '역시', '완전', '제일', '가장',
])

/** 🔴 서술어 끝 — 주제 낱말이 아니다. `하는데` · `가자고` · `궁금해요` 를 걸러 낸다 */
const PREDICATE_END = /(요|죠|까|니다|다|네|데|지|고|서|면|게|래|음|함|됨|듯|ㅠ|ㅋ|ㅎ)$/

/** 🔴 한 글자지만 주제인 낱말 — 돈 이야기가 이 한 글자로 온다 */
const ONE_CHAR_TOPICS: ReadonlySet<string> = new Set(['돈', '빚', '술', '약', '딸', '집'])

const stripJosa = (w: string): string => {
  for (const j of JOSA) {
    if (w.endsWith(j) && [...w].length - [...j].length >= 2) return w.slice(0, w.length - j.length)
  }
  return w
}

/**
 * 🔴 **원문 제목의 주제 낱말 → 대조 열쇠(앞 2자).** 앞 2자로 보는 이유: 활용·높임이 바뀌어도 줄기는 남는다
 *    (`시어머니` ↔ `시어머님`, `싸웠어` ↔ `싸웠다`). 열쇠가 하나도 없으면 빈 배열 — **잴 수 없는 것**이다.
 */
export function topicAnchorsOf(title: string): string[] {
  const out = new Set<string>()
  for (const raw of title.normalize('NFKC').split(/[^0-9A-Za-z가-힣]+/)) {
    if (raw === '') continue
    const w = stripJosa(raw)
    const n = [...w].length
    if (n === 1) { if (ONE_CHAR_TOPICS.has(w)) out.add(w); continue }
    if (STOP.has(w) || STOP.has(raw)) continue
    if (PREDICATE_END.test(w)) continue
    out.add([...w].slice(0, 2).join(''))
  }
  return [...out]
}

/** 🔴 초안(제목+본문)에 주제 열쇠가 하나라도 있는가 — 공백을 지우고 본다 */
export function keepsTopic(anchors: readonly string[], text: string): boolean {
  const t = text.normalize('NFKC').replace(/\s+/g, '')
  return anchors.some((a) => t.includes(a))
}

// ─────────────────────────────────────────────────────────
// 🔴 논쟁 표지 — **막는 목록이 아니라 남았는지 보는 목록**이다
//    원문에 이 중 하나라도 있으면(서운함 · 다툼 · 억울함 · 누가 맞나 · 어떻게 생각하나)
//    그 글이 반응을 부른 이유가 거기 있다. 초안이 그것을 전부 지우면 쟁점이 사라진 것이다.
// ─────────────────────────────────────────────────────────
export const DEBATE_MARKERS: readonly string[] = [
  // 다툼·서운함
  '싸우', '싸웠', '싸움', '다투', '다퉜', '다툼', '갈등', '서운', '섭섭', '속상', '억울', '답답',
  '화가', '화나', '화났', '열받', '짜증', '어이없', '어이가없', '황당', '기가막', '괘씸', '얄밉', '뻔뻔', '배신',
  '너무하', '무례', '예의', '갑질', '편애', '차별', '불공평', '눈치', '욕먹', '참아야', '따지', '따져',
  '이해가안', '이해안', '이해를못', '이해못',
  // 누가 맞나 · 의견을 묻는다
  '맞나요', '맞는건가', '맞는걸까', '정상인가', '이상한가', '예민한가', '제가이상', '내가이상', '제가예민', '내가예민',
  '누가맞', '누가잘못', '누구잘못', '잘못인가', '잘못한건가', '어떻게생각', '어떻게들생각', '의견',
  '여러분이라면', '여러분같으면', '나라면', '저라면', '어느쪽', '해야하나', '말아야', '해야할까', '할까요말까요',
] as const

/** 🔴 글에 있는 논쟁 표지 — 공백을 지우고 본다(띄어쓰기가 달라도 같은 말이다) */
export function debateMarkersOf(text: string): string[] {
  const t = text.normalize('NFKC').replace(/\s+/g, '')
  return DEBATE_MARKERS.filter((m) => t.includes(m))
}

export type RawAdaptationFailure = { code: RawAdaptationCode; detail: string }

/**
 * 🔴 **적응 초안의 결정적 판정** — 생성 직후(`runContentCore`, 유료 검수 앞)와 채택 자리(`pickV2`,
 *    캐시 artifact 포함)가 **이 함수 하나**를 부른다.
 *
 * 🔴 **잴 수 없으면 막지 않는다.** 원문 제목에서 주제 열쇠가 하나도 안 나오면 주제 대조를 하지 않고,
 *    원문에 논쟁 표지가 없으면 논쟁 대조를 하지 않는다 — 모르는 것을 결함으로 세지 않는다.
 *    화자 자리는 언제나 잰다 — 계획이 값으로 들고 있다.
 */
export function judgeRawAdaptation(input: {
  stance: string | null
  sourceTitle: string
  sourceBody: string
  draftTitle: string
  draftBody: string
}): RawAdaptationFailure[] {
  const out: RawAdaptationFailure[] = []
  if (input.stance === 'SELF_EXPERIENCE') {
    out.push({ code: 'adaptSelfExperience', detail: 'stance=SELF_EXPERIENCE' })
  }
  const draft = `${input.draftTitle}\n${input.draftBody}`
  const anchors = topicAnchorsOf(input.sourceTitle)
  if (anchors.length > 0 && !keepsTopic(anchors, draft)) {
    out.push({ code: 'adaptTopicLost', detail: `주제 열쇠 ${anchors.length}개 중 0개` })
  }
  const srcDebate = debateMarkersOf(`${input.sourceTitle}\n${input.sourceBody}`)
  if (srcDebate.length > 0 && debateMarkersOf(draft).length === 0) {
    out.push({ code: 'adaptDebateLost', detail: `원문 논쟁 표지 ${srcDebate.length}개 · 초안 0개` })
  }
  return out
}

// ─────────────────────────────────────────────────────────
// 🔴 지시문 — 계획 · 생성 · 검수가 **같은 뜻**을 읽는다. 문구의 정본은 여기 하나다
// ─────────────────────────────────────────────────────────

/** 🔴 계획 요청에 싣는 금지 — 1인칭 경험 자리를 고르지 않는다 */
export const ADAPT_PLAN_RULE =
  `🔴 (${RAW_ADAPTATION_VERSION}) 이 원문은 한 회원의 긴 사연입니다. stance 를 SELF_EXPERIENCE 로 쓰지 마십시오 — `
  + 'OBSERVATION · QUESTION · REFLECTION 중에서 고르고 selfBasis 는 비웁니다. 사연 속 경험은 화자의 것이 아닙니다.'

/** 🔴 생성 지시 — 사연을 옮기지 않고 쟁점을 꺼낸다. 🔴 반응을 부른 이유 다섯을 살린다 */
export const ADAPT_DRAFT_RULES: readonly string[] = [
  `## 🔴 이 원문은 한 회원의 긴 사연입니다 — 사연을 옮기지 않고 쟁점을 꺼냅니다 (${RAW_ADAPTATION_VERSION})`,
  '- 원문 작성자의 사연(누가 · 언제 · 어디서 · 무슨 말을 했는지)을 순서대로 다시 들려주지 않습니다.',
  '- 그 사연이 사람들을 붙잡은 **쟁점 · 물음**을 당신의 자리(관찰 · 생각 · 물음)에서 새로 꺼냅니다.',
  '- 🔴 원문 제목의 주제 낱말(사람 · 관계 · 대상 · 돈 · 몸)을 그대로 살립니다.',
  '- 🔴 반응을 부른 이유를 살립니다: 논쟁(누가 맞나) · 공감(서운함 · 억울함) · 시의성(요즘 일) · 실용(어떻게 하나) · 궁금함.',
  '- 🔴 쟁점을 순하게 만들지 않습니다. 남녀 · 부부 · 시댁 갈등, 연예인, 돈, 흔한 건강 궁금증, 거친 의견도 우리 이야기입니다.',
  '- 🔴 가족 호칭(남편 · 시댁 · 친정 · 자녀)을 **당신 집 이야기로 서술하지 않습니다.** "남편이 ~해요" "친정은 ~예요" 처럼 쓰면',
  '  당신 가족의 사실이 됩니다. 묻는 문장("시댁 먼저 vs 친정 먼저, 어느 쪽이 맞을까요?")이나 "부부 사이" "며느리 입장" 같은',
  '  누구 집인지 정하지 않는 말로 씁니다.',
  '  "어느 쪽이 맞나요", "여러분이라면 어떻게 하세요" 같은 물음이 살아 있어야 합니다.',
  '- 🔴 그래도 하지 않습니다: 특정인을 알아볼 수 있게 쓰기 · 확인되지 않은 일을 사실로 단정하기 · '
    + '특정인을 공격하기 · 약·용량·진단·치료를 지시하기 · 원문 문장 옮겨 적기.',
] as const

/** 🔴 검수 지시 — 사연 세부가 빠진 것은 결함이 아니다. 쟁점·물음이 빠졌을 때만 적는다 */
export const ADAPT_REVIEW_RULES: readonly string[] = [
  `## 🔴 이 초안은 긴 사연에서 쟁점만 꺼낸 글이다 (${RAW_ADAPTATION_VERSION})`,
  '   · 원문 작성자의 구체 사연(장면 · 대사 · 순서)이 빠진 것은 droppedFromSource 가 **아니다.**',
  '   · 원문의 **쟁점 · 물음**이 사라졌을 때만 droppedFromSource 에 적는다.',
  '   · 초안이 원문 사연 속 경험을 자기 일로 말하면 lifeContradictions 다.',
] as const

// ─────────────────────────────────────────────────────────
// 🔴 적응 경로의 생성 계약 — seed 계약과 **한 칸**이 다르다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **적응 지시 전체의 지문** — 판(`RAW_ADAPTATION_VERSION`)을 잊고 문구·표지만 바꿔도 계약이 바뀐다.
 *    그러면 옛 적응 artifact 가 캐시·"지난 결론" 으로 재사용되지 않는다.
 */
export const RAW_ADAPTATION_RULES_DIGEST = createHash('sha256')
  .update([
    RAW_ADAPTATION_VERSION, ADAPT_PLAN_RULE, ...ADAPT_DRAFT_RULES, ...ADAPT_REVIEW_RULES,
    ...RAW_ADAPTATION_CODES, ...DEBATE_MARKERS,
  ].join('\n'), 'utf8')
  .digest('hex').slice(0, 16)

const ADAPT_MARK = `+${RAW_ADAPTATION_VERSION}:${RAW_ADAPTATION_RULES_DIGEST}`

/**
 * 🔴 **적응 경로의 생성 계약** — seed 계약에서 `planPromptDigest` 한 칸만 바꾼다.
 *
 *    적응 경로의 계획 요청은 seed 계획 지시문 + 적응 규칙(`ADAPT_PLAN_RULE`)이다 — 그래서 "계획 지시 지문" 칸이
 *    그 둘을 함께 가리키게 한다. 🔴 **seed 계약은 한 글자도 바뀌지 않는다** — 옛 seed artifact · 캐시 ·
 *    "지난 결론" 판정이 그대로 산다. 적응 artifact 는 seed 계약과 같을 수 없다(캐시가 섞이지 않는다).
 *    🔴 `promptVersion` 칸은 건드리지 않는다 — 봉투·적재·증거 대조가 그 칸을 정본 판 값과 견준다.
 */
export function adaptationContractOf<T extends { planPromptDigest: string }>(c: T): T {
  return { ...c, planPromptDigest: `${c.planPromptDigest}${ADAPT_MARK}` }
}

/** 🔴 이 계약이 **지금 적응 규칙**으로 만든 것인가 — 옛 적응 판이면 false 다 */
export function isAdaptationContract(c: { planPromptDigest?: unknown } | null | undefined): boolean {
  return c !== null && c !== undefined && typeof c.planPromptDigest === 'string' && c.planPromptDigest.endsWith(ADAPT_MARK)
}
