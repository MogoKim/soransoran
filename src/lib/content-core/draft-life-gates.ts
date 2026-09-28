/**
 * 초안 게이트 — 🔴 **다 쓴 초안이 우리 글·우리 화자와 맞는가** (2026-09-26 실측 4건)
 *
 * 🔴 **왜 있나.** 운영 기계 초안 4편이 semanticReview `clean` · machineOutcome `adopt` 로
 *    사람 검토 대기(APPROVED)까지 갔다. 의미 검수는 넷 다 "원문을 충실히 유지" 라고 답했다 —
 *    넷 다 **원문과는 맞고 우리와는 어긋났다.** 원문과 견주는 검수는 이것을 볼 자리가 없다.
 *
 *    ```
 *    P12  원문이 사진을 붙인 글 → 초안 "…생각나서 올려봐요" · "이런 스타일 …"   우리 글엔 사진이 없다
 *    P02  QUESTION · selfBasis=null → "부모님이 은퇴하셨는데 …"                 1인칭 허가 없이 자기 집안 사실
 *    P01  카드 자녀 중고등 → "애들이 중고등학생쯤 돼서 … 시기가 오면요"          지금 밴드를 미래로 말했다
 *    P14  카드 성인 자녀 1 · 은퇴 → "남편이 육아휴직 쓰고 초1 아이를 돌보기로"    지금 집안에 초1 아이가 있다
 *    ```
 *
 * 🔴 **새 사전을 만들지 않는다.** 세 게이트 모두 기존 정본 parser 의 소비자다:
 *    · 자료 의존      `evidence.ts` 의 `VISUAL` · `ASK_TO_SEE_RE` → `readMediaDependency`
 *    · 1인칭 허가     `original-post-persona-match` 의 문장·절·임자 규칙 → `readSelfClaims`
 *                     · 계획의 `selfBasis` · `warrants`
 *    · 지금 삶과 시제 같은 규칙 → `readSelfChildBands` · `readSelfClaims` · 정본 판정 `judgeLifeHistory`
 *                     · 정본 카드(`childrenAgeBands` · `childrenCount` · `maritalStatus`)
 *
 * 🔴 **확정할 수 있을 때만 막는다.** 임자가 모호하면(누군가 앞에 서 있다) 세지 않는다 —
 *    같은 extractor 의 보수적 규칙을 그대로 물려받는다. 과차단은 곧 공급 0 이다.
 * 🔴 **유료 호출이 늘지 않는다.** 문자열 판정이다. 의미 검수 요청 **앞**에서 막으므로 오히려 준다.
 * 🔴 **(quality-v2 · 2026-09-28) 생활 일관성 게이트 넷** — 혼인 · 돌봄·한집 · 자녀 삶의 단계 ·
 *    정신건강·질병. 확정 모순은 위 셋과 같이 막고(AUTO_HOLD), **모호하면 사람 검토**(`judgeDraftLife`
 *    의 `reviews` → 적재 `DRAFT_LIFE_REVIEW:<코드>` 경고)로 보낸다. 아래 「생활 일관성 게이트 넷」 참고.
 * 🔴 순수 함수다. DB · 네트워크 · 파일 IO 없음.
 */
import { readMediaDependency, CLOSING_RE } from './evidence'
/** 🔴 KST 하루 경계의 정본 — 발행 일일 상한과 같은 함수다 */
import { kstDayStart } from '../persona-cap'
import { RELATION_NAMES } from './source-facts'
/** 🔴 "다른 사람을 가리키는 말" 의 정본 — 여기서 목록을 다시 만들지 않는다 */
import { OTHER_MARKERS } from '../persona-self-age'
import type { PoolCard } from '../persona-pool-card'
import {
  CHILD_AGE_BANDS, judgeLifeHistory, readSelfChildBands, readSelfClaims,
  readClauseFrames, readSelfChildClauses,
  type ChildAgeBand, type ClauseFrame, type PersonaForMatch, type PostRequirements, type SelfClaimAxis,
} from '../original-post-persona-match'

/**
 * 🔴 **순서가 곧 대표 사유의 우선순위다** — 여럿이 걸리면 결과도 이 순서로 나온다.
 *    카드와 **어긋나는 사실**(C)이 가장 구체적이고, 자료 의존(A)은 글 자체가 성립하지 않으며,
 *    허가 없는 1인칭(B)은 계약 위반이다. 사람이 먼저 봐야 할 것부터 적는다.
 */
export const DRAFT_GATE_CODES = [
  /** 🔴 카드의 지금 삶을 미래·과거로 말하거나 카드와 다른 지금 집안을 말한다 */
  'lifeStageTenseConflict',
  /** 🔴 (v2) 카드의 혼인·부부 관계와 다른 1인칭 이혼·별거 경험 */
  'maritalStatusConflict',
  /** 🔴 (v2) 카드의 상시 돌봄·한집 살림과 다른 1인칭 연락 끊김·따로 삶 */
  'careHouseholdConflict',
  /** 🔴 (v2) 카드의 자녀 나이대·동거와 다른 자녀의 삶의 단계·경제 행동 */
  'childLifeStageConflict',
  /** 🔴 (v2) 근거·카드·계획 어디에도 없는 1인칭 정신건강·질병 경험 */
  'unsupportedHealthClaim',
  /** 🔴 (v3) 원문 시점에만 맞는 명절·실시간 현장 표현을 게시 시점의 지금처럼 말한다 */
  'staleTimeClaim',
  /** 🔴 (v3) 다른 커뮤니티에서 본 회원·글의 움직임을 이 곳 이야기처럼 말한다 */
  'externalCommunityClaim',
  /** 🔴 우리 글에 없는 사진·첨부에 기댄다 */
  'mediaDependentDraft',
  /** 🔴 (v3) 끝이 잘린 원문 뒤에 원문에 없는 결말을 지어 붙였다 */
  'truncatedSourceCompletion',
  /** 🔴 (v4) 받아칠 거리가 없는 하소연 — 계획이 대화 촉발 하나뿐인 vent 인데 묻는 말도 없다 */
  'thinVentDraft',
  /** 🔴 1인칭 허가(selfBasis) 없이 자기 생활사를 주장한다 */
  'unwarrantedSelfClaim',
] as const
export type DraftGateCode = (typeof DRAFT_GATE_CODES)[number]

/**
 * 🔴 **초안 게이트 판** (2026-09-27). 게이트의 판정이 바뀌면 올린다.
 *    2026-09-26 게이트 3종(d750b72)은 어떤 판 값도 올리지 않아, 수정 전·후 후보를 저장값으로
 *    가를 수 없었다. 이 값은 **품질 계약 digest**(`src/lib/quality-contract.ts`)에 들어간다 —
 *    올리면 자동 READY 증거 cohort 가 새로 시작한다. CI(`check:quality-contract`)가 이 파일의
 *    지문이 바뀌었는데 판도 확인도 그대로면 막는다.
 */
/**
 * 🔴 `draft-gates-v3.1` (2026-09-28) — 같은 날 시간 의존 문장도 사람 검토. 운영 v3 행이 0 이라 품질 계약 판 이름
 *    (`quality-v3`)은 그대로 두고 이 값으로 digest 를 바꾼다(`check:quality-contract -- --revise`).
 */
export const DRAFT_GATE_VERSION = 'draft-gates-v4'

/**
 * 🔴 **생활 일관성 게이트 넷** (2026-09-28 quality-v2) — 확정 모순은 `AUTO_HOLD`(적재 전),
 *    **모호하면 사람 검토**로 보낸다. 모호한 것을 통과시키지 않는다 — 적재는 되지만
 *    `gateResults.holds` 에 `DRAFT_LIFE_REVIEW:<코드>` 가 붙어 **자동 READY 에서 빠진다.**
 *
 *    quality-v1 cohort 30건 중 중대 결함 4건이 게이트 전부와 의미 검수(모순 0 · 추가 0)를 지나갔다:
 *    ```
 *    P05  카드 기혼(원만)       → 초안 "해마다 막말 싸움 · 이혼 얘기가 나왔다"
 *    P05  카드 시어머니 모심     → 초안 "연락도 안 드렸더니 전화가 오더라"
 *    P19  카드 · 계획에 없음     → 초안 "우울·불안이 심해져 정신건강의학과를 가 보려 한다"
 *    P01  카드 자녀 중고등 동거  → 초안 "딸은 봉투에 10만원 · 아들은 빈손으로 왔다 · 모처럼 모이니"
 *    ```
 *    넷 다 **원문과는 맞고 우리 화자와는 어긋났다** — 원문과 견주는 검수가 볼 자리가 없다.
 */
export const DRAFT_LIFE_REVIEW_CODES = [
  'maritalStatusConflict', 'careHouseholdConflict', 'childLifeStageConflict', 'unsupportedHealthClaim',
  /**
   * 🔴 (quality-v3 · 2026-09-28) 원천·시점과 대조하는 넷 — 확정할 수 없으면 같은 사람 검토 경고로 간다.
   *    경고 이름(`DRAFT_LIFE_REVIEW:<코드>`)은 v2 와 같다 — 적재기·자동 READY 가 이미 이 접두를 읽는다.
   */
  'staleTimeClaim', 'externalCommunityClaim', 'mediaDependentDraft', 'truncatedSourceCompletion',
  /** 🔴 (v3) 계획이 `noLifeFactNeeded` 인데 자기 가족사를 명시해 말한다 — `selfBasis=null` 은 여전히 확정(AUTO_HOLD)이다 */
  'unwarrantedSelfClaim',
  /** 🔴 (v4) 소프트 품질 — 확정하지 않는다(사람 검토로만) */
  'thinVentDraft',
] as const satisfies readonly DraftGateCode[]
export type DraftLifeReviewCode = (typeof DRAFT_LIFE_REVIEW_CODES)[number]
export type DraftLifeReview = { code: DraftLifeReviewCode; detail: string }

export const DRAFT_GATE_LABEL: Readonly<Record<DraftGateCode, string>> = {
  mediaDependentDraft: '🔴 우리 글에 없는 사진·첨부에 기댄다 — 읽는 사람이 무엇을 보라는지 모른다',
  unwarrantedSelfClaim: '🔴 1인칭 허가 없이 글쓴이 자신의 가족·집안·일을 사실로 말한다',
  lifeStageTenseConflict: '🔴 Persona 의 지금 삶(자녀 나이대·집안)을 미래·과거로 말하거나 다르게 말한다',
  maritalStatusConflict: '🔴 Persona 의 혼인·부부 관계와 다른 1인칭 이혼·별거 경험을 말한다',
  careHouseholdConflict: '🔴 Persona 가 늘 돌보거나 함께 사는 부모와 연락이 끊겼다·따로 산다고 말한다',
  childLifeStageConflict: '🔴 Persona 의 자녀 나이대·동거와 다른 자녀의 삶(돈을 건넴·입대·결혼·따로 삶)을 말한다',
  unsupportedHealthClaim: '🔴 근거·카드·계획 어디에도 없는 1인칭 정신건강·질병 경험을 말한다',
  staleTimeClaim: '🔴 원문이 올라온 날에만 맞는 명절·실시간 현장 표현을 게시 시점의 지금처럼 말한다',
  externalCommunityClaim: '🔴 다른 커뮤니티에서 본 회원·글의 움직임을 이 곳에서 본 것처럼 말한다',
  truncatedSourceCompletion: '🔴 끝이 잘린 원문 뒤에 원문에 없는 결말을 지어 붙였다',
  thinVentDraft: '🟡 받아칠 거리가 없는 짧은 하소연 — 공감·경험·답을 부르는 자리가 없다',
}

export type DraftGateFailure = { code: DraftGateCode; detail: string }

/** 🔴 계획에서 필요한 칸만 — 정본 `SpeakerPlan` · artifact `plan` 둘 다 이 모양을 가진다 */
export type DraftGatePlan = {
  selfBasis: string | null
  /** 🔴 `evidenceText` 는 코드가 원문에서 확인한 근거 문장이다(`verifySelfWarrants`) — 원문 근거는 이것뿐이다 */
  warrants: readonly { fact: string; evidenceText?: string }[]
  /**
   * 🔴 (v4) 계획이 정한 마무리와 글의 역할 — 소프트 품질(`thinVentDraft`)만 읽는다. 없으면 판정하지 않는다.
   *    정본 `SpeakerPlan` · artifact `plan` 둘 다 이 칸을 가진다.
   */
  closingIntent?: string | null
  contentRoles?: readonly string[]
}

/**
 * 🔴 정본 카드에서 필요한 칸만 — v2 가 다시 정의하지 않는다.
 *    생활 일관성 칸(부부 관계 · 돌봄 · 갱년기 · noGo · 집안 구성)은 **없을 수 있다** — 없으면
 *    그 축에서 무엇이 걸렸을 때 통과시키지 않고 **사람 검토**로 보낸다(모르는 것 = 모호).
 */
export type DraftGateCard = Pick<PoolCard, 'childrenCount' | 'childrenAgeBands' | 'maritalStatus'>
  & Partial<Pick<PoolCard, 'spouseRelationship' | 'parentCare' | 'menopauseStatus' | 'noGoTopics' | 'household' | 'ageBand'>>

/**
 * 🔴 자기 주장 축 → 계획이 허가할 수 있는 자격 축(`ClaimFact`).
 *    `parents` · `assets` 는 **허가 축이 없다** — 카드로 검증할 방법이 없으므로 언제나 무허가다.
 */
const WARRANT_OF: Readonly<Record<SelfClaimAxis, readonly string[]>> = {
  spouse: ['spouse'],
  children: ['children', 'childAgeBand'],
  parents: [],
  parentCare: ['parentCare'],
  menopause: ['menopause'],
  work: ['work'],
  assets: [],
}

/**
 * 🔴 **미래·과거로 말하는 절** — 절 안의 시간 틀만 본다. **조건·앞날을 여는 어미만** 넣는다.
 *    `커서` 는 넣지 않는다 — `다 커서 편해요` 는 이미 지난 일이다.
 *    `곧` 도 넣지 않는다 — `곧 고3인데` 는 지금 중고등이다.
 *    🔴 `돼서` · `되어서` 도 넣지 않는다 (2026-09-26 마스터 재검토) — **이미 된 까닭**이다.
 *       `애들이 중고등학생이 돼서 요즘 대화가 줄었어요` 는 지금이다. P01 반례가 막힌 것은
 *       같은 절의 `시기가 오면` 때문이지 `돼서` 때문이 아니다.
 */
const FUTURE_FRAME_RE = /되면|될\s*(?:때|즈음|무렵|쯤)|되고\s*나면|오면|크면|가면|갈\s*때|나중에|앞으로|언젠가/
const PAST_FRAME_RE = /였을\s*때|었을\s*때|이었을\s*때|던\s*(?:때|시절)|시절|적에|적엔/

const bandIdx = (b: string): number => (CHILD_AGE_BANDS as readonly string[]).indexOf(b)
/** 🔴 밴드 **이름 자체**로 말했는가 — `중고등학생쯤` 은 밴드, `고3` 은 그 안의 한 학년이다 */
const namesBand = (token: string, band: ChildAgeBand): boolean => token.includes(band.split('·')[0]!)

/**
 * 🔴 **화제 틀 어절** (2026-09-26 마스터 재검토 2차 · fail-open 수정).
 *    `지금은 남편이 …` 의 `지금은` 은 장면을 여는 화제이지 남편의 임자가 아니다 —
 *    앞판은 그것을 "누군가 앞에 섰다" 로 읽어 글쓴이 남편의 초1 아이가 두 게이트를 모두 지났다.
 *    `친구는 남편이 …` 의 `친구는` 은 임자다. 둘 다 `X은/는` 이라 모양으로는 못 가른다.
 *    🔴 시간 낱말 목록을 만들지 않는다. 기존 정본 `OTHER_MARKERS`(다른 사람을 가리키는 말)를
 *       담은 `은/는` 어절만 임자로 남기고, 나머지 `은/는` 어절은 화제 틀로 건너뛴다.
 *    🔴 목록 밖 사람(`시누는 남편이`)은 틀로 읽혀 **막는 쪽**으로 기운다 — 새는 쪽이 아니다.
 *    🔴 매칭 규칙 모듈에는 넣지 않는다(사람 명사 목록 금지 · fixture 강제). 판정을 넘겨 준다.
 */
const isTopicFrame = (w: string): boolean =>
  /(?:은|는)$/.test(w) && !OTHER_MARKERS.some((m) => w.includes(m))
const OWNER_OPTS = { isFrameWord: isTopicFrame } as const

/**
 * 🔴 **확정 게이트 전부를 한 번에**(v1 셋 + v2 생활 일관성의 확정 모순). 빈 배열이면 통과다.
 *    모호(사람 검토)까지 받으려면 `judgeDraftLife` 를 부른다.
 *    `plan` 이 없으면 B 를, `card` 가 없으면 C 를 **판정하지 않는다** — 모르는 것을
 *    결함으로 세지 않는다. 카드를 못 찾은 경우는 나이 판정(`judgeSelfAgeBasis`)이 이미 막는다.
 */
export function judgeDraftGates(input: DraftGateInput): DraftGateFailure[] {
  return judgeDraftLife(input).failures
}

export type DraftGateInput = {
  title: string
  body: string
  plan: DraftGatePlan | null
  card: DraftGateCard | null
  /**
   * 🔴 **원천과 판정 시각** (2026-09-28 quality-v3) — 필수다. 새 생성(`runContentCore`)과 캐시 채택(`pickV2`)이
   *    **같은 값**을 넘긴다. 빠뜨리면 컴파일이 깨진다 — 조용히 판정을 건너뛰는 호출부가 생기지 않는다.
   */
  context: DraftGateContext
}

/**
 * 🔴 **초안 밖에서 가져오는 사실** — 원천 글과 판정 시각. 모르는 것은 `null` 이다(지어내지 않는다).
 *    `source` 가 `null` 이면 원천을 모른다 — 시점·자료·잘림·출처 축에서 무엇이 걸렸을 때
 *    통과시키지 않고 **사람 검토**로 보낸다.
 */
export type DraftGateContext = {
  /** 🔴 판정 시각 — 회차 시각(`RUN_AT`)이다. 벽시계를 따로 읽지 않는다 */
  at: Date
  source: DraftGateSource | null
}
export type DraftGateSource = {
  /** 🔴 모델에 준 것과 같은 원문 — 마스킹된 제목 · `bodyHead` (근거 packet 을 만든 그 글자) */
  title: string
  body: string
  /** 🔴 원천 사이트(`navercafe:wgang` …) — 비어 있으면 모른다 */
  site: string
  /** 🔴 원문이 올라온 시각 · 우리가 가져온 시각. `capturedAt` 을 `postedAt` 대신 쓰지 않는다 */
  postedAt: Date | null
  capturedAt: Date | null
  /**
   * 🔴 **양수만 증거다.** 수집기 여럿이 이미지를 세지 않고 `0` 을 적는다(`micro-seed-collect-navercafe` ·
   *    thin 경로) — `0` 은 "없다" 가 아니라 "안 셌다" 다.
   */
  imageCount: number | null
}

/**
 * 🔴 **초안 게이트 전부 — 확정(`failures`)과 사람 검토(`reviews`)를 함께 낸다** (2026-09-28).
 *    `failures` 가 하나라도 있으면 채택하지 않는다(AUTO_HOLD). `reviews` 는 채택은 되지만
 *    자동 READY 에서 빠지는 경고다 — 🔴 **모호한 것을 통과로 뭉개지 않는다.**
 *    같은 코드가 둘 다에 있으면 `failures` 만 남긴다.
 */
export function judgeDraftLife(input: DraftGateInput): { failures: DraftGateFailure[]; reviews: DraftLifeReview[] } {
  const failures = judgeCoreGates(input)
  const life = input.card === null ? { hard: [], review: [] } : judgeLifeConsistency(input.title, input.body, input.plan, input.card)
  const ctx = judgeSourceContext(input.title, input.body, input.context)
  const basis = [
    ...judgeNoLifeFactClaims(input.title, input.body, input.plan),
    ...judgeThinVent(input.title, input.body, input.plan),
  ]
  const all = [...failures, ...life.hard, ...ctx.hard]
  const rank = (c: DraftGateCode): number => DRAFT_GATE_CODES.indexOf(c)
  const hardCodes = new Set(all.map((f) => f.code))
  return {
    failures: [...all].sort((a, b) => rank(a.code) - rank(b.code)),
    reviews: [...life.review, ...ctx.review, ...basis]
      .filter((r) => !hardCodes.has(r.code)).sort((a, b) => rank(a.code) - rank(b.code)),
  }
}

function judgeCoreGates(input: DraftGateInput): DraftGateFailure[] {
  const out: DraftGateFailure[] = []
  const { title, body } = input

  // ── A. 자료 의존 — 우리 글에는 사진·첨부가 없다 ──
  const media = readMediaDependency(`${title}\n${body}`)
  if (media !== null) {
    out.push({ code: 'mediaDependentDraft', detail: `${media.kind}: ${media.evidence}` })
  }

  // ── B. 1인칭 허가 없이 자기 생활사 ──
  /**
   * 🔴 **`selfBasis=null` 일 때만** 막는다 — 계획이 "1인칭이 아닌 자리" 를 골랐다는 뜻이다
   *    (`STANCE_LABEL`: 관찰·질문·생각은 *겪었다고 말하지 않는다*). 그 자리에서 자기 남편·
   *    부모·자녀를 사실로 말하면 **카드로 검증받지 않은 생활사**가 된다.
   *    🔴 `lifeFacts` 의 허가 밖 주장은 여기서 세지 않는다 — 카드 모순은 C 와 의미 검수가 본다.
   *    🔴 (quality-v3) 축 낱말 없이 글의 사정을 통째로 자기 집안 일로 두는 말(`우리 집도 그래요`)도 센다.
   *       `noLifeFactNeeded` 는 여기가 아니라 `judgeNoLifeFactClaims`(사람 검토)가 본다.
   */
  const claims = readSelfClaims(title, body, OWNER_OPTS)
  if (input.plan !== null && input.plan.selfBasis === null) {
    const warranted = new Set(input.plan.warrants.map((w) => w.fact))
    const bad: { axis: string; clause: string }[] = claims
      .filter((c) => !WARRANT_OF[c.axis].some((f) => warranted.has(f)))
    bad.push(...readSelfFamilyLikeTopic(title, body).map((clause) => ({ axis: 'family', clause })))
    if (bad.length > 0) {
      const axes = [...new Set(bad.map((c) => c.axis))]
      out.push({
        code: 'unwarrantedSelfClaim',
        detail: `${axes.join('·')} — ${[...new Set(bad.map((c) => c.clause))].slice(0, 3).join(' / ')}`,
      })
    }
  }

  // ── C. 카드의 지금 삶 vs 초안의 시제 ──
  const card = input.card
  if (card !== null) {
    const bands = card.childrenAgeBands.filter((b) => bandIdx(b) >= 0)
    const conflicts: string[] = []
    const present: ChildAgeBand[] = []
    const kids = card.childrenCount > 0 && bands.length > 0
    const minIdx = kids ? Math.min(...bands.map(bandIdx)) : -1
    const maxIdx = kids ? Math.max(...bands.map(bandIdx)) : -1
    for (const m of readSelfChildBands(title, body, OWNER_OPTS)) {
      /**
       * 🔴 **관계 명칭(`사위` · `며느리` · `손주`)은 나이 표기가 아니다** (2026-09-26 운영 초안 재측정).
       *    `사위가 돼서 자꾸 그러니까` 의 사위는 글쓴이 **남편**이다(친정 쪽에서 본 이름).
       *    관계 명칭은 누구 기준인지가 문장마다 달라, 명시된 1인칭(`우리 사위`)이 아니면
       *    임자를 확정할 수 없다 — 확정할 수 없으면 막지 않는다. 목록은 기존 `RELATION_NAMES` 그대로다.
       */
      if (RELATION_NAMES.includes(m.token) && m.owner !== 'explicit') continue
      const i = bandIdx(m.band)
      const exact = namesBand(m.token, m.band)
      if (FUTURE_FRAME_RE.test(m.clause)) {
        /**
         * 🔴 **가장 어린 아이가 이미 그 밴드이거나 지났다** — 아무도 그 밴드가 "될" 수 없다.
         *    같은 밴드는 **밴드 이름으로** 말했을 때만 센다: 중2 아이에게 `고3 되면` 은 맞는 미래다.
         */
        if (kids && (i < minIdx || (i === minIdx && exact))) {
          conflicts.push(`미래로 말한 ${m.band}(${m.token}) · 카드 지금 ${bands.join('·')} — ${m.clause}`)
        }
        continue
      }
      if (PAST_FRAME_RE.test(m.clause)) {
        // 🔴 가장 큰 아이도 아직 그 밴드에 닿지 않았다 — 지난 일로 말할 수 없다
        if (kids && (i > maxIdx || (i === maxIdx && exact))) {
          conflicts.push(`지난 일로 말한 ${m.band}(${m.token}) · 카드 지금 ${bands.join('·')} — ${m.clause}`)
        }
        continue
      }
      present.push(m.band)
    }
    /**
     * 🔴 **지금 집안** — 정본 판정 `judgeLifeHistory` 를 그대로 부른다. 입력만 좁힌다:
     *    · 자녀 나이대는 **지금으로 말한 것만** — `애들 초등 때는` 을 지금 초등 아이로 세면
     *      성인 자녀 Persona 의 회상이 전부 막힌다
     *    · 배우자·자녀는 **막는 쪽 임자 판정**(`readSelfClaims`)으로 — 매칭용 넓은 판정은
     *      일반론(`딸도 딸 나름이고`)까지 내 자녀로 읽는다
     */
    const req: PostRequirements = {
      needsCurrentSpouse: claims.some((c) => c.axis === 'spouse'),
      needsChildren: claims.some((c) => c.axis === 'children'),
      needsChildAgeBands: [...new Set(present)],
      needsParentCare: false, needsMenopauseExperience: false, labels: [],
    }
    const persona: PersonaForMatch = {
      code: '', status: 'active', providerId: null, accountCount: 0, noGoTopics: [],
      postsThisWeek: 0, daysSinceLastPost: null,
      childrenCount: card.childrenCount, childrenAgeBands: card.childrenAgeBands,
      maritalStatus: card.maritalStatus,
    }
    for (const b of judgeLifeHistory(persona, req, title, body)) {
      if (b.code === 'CHILD_AGE_CONFLICT' || b.code === 'NO_CHILDREN' || b.code === 'MARITAL_CONFLICT') {
        conflicts.push(`지금 집안 ${b.code} (${b.detail})`)
      }
    }
    if (conflicts.length > 0) {
      out.push({ code: 'lifeStageTenseConflict', detail: conflicts.slice(0, 3).join(' / ') })
    }
  }
  // 🔴 정본 순서로 돌려준다 — 계산 순서가 아니라 `DRAFT_GATE_CODES` 가 대표 사유를 정한다
  return [...out].sort((a, b) => DRAFT_GATE_CODES.indexOf(a.code) - DRAFT_GATE_CODES.indexOf(b.code))
}

// ─────────────────────────────────────────────────────────
// 🔴 생활 일관성 게이트 넷 (2026-09-28 quality-v2)
// ─────────────────────────────────────────────────────────
//
// 🔴 **낱말 하나로 막지 않는다.** 네 축 모두 같은 틀을 돈다:
//    ① 절 경계 · 세상 이야기 틀 · 묻는 문장은 정본 `readClauseFrames` 그대로 — 묻는 글은 주장이 아니다
//    ② **누가 겪었나** — 절 머리 주어가 다른 사람(`OTHER_MARKERS` 정본)이면 남의 일이다.
//       그 축의 **상대**(이혼의 남편 · 연락의 시어머니)는 남으로 세지 않는다 — 내 사건의 상대다
//    ③ 전언(`~대요`) · 가정(`~면`) · 지난 일(`예전에` · `~였을 때`)은 지금의 1인칭 경험이 아니다
//    ④ 카드(정본 파서)와 계획(`selfBasis` · 검증된 근거 문장)으로 **확정 모순 / 모호 / 뒷받침**을 가른다
//
// 🔴 **원문에 있다는 것은 허가가 아니다.** 원문 글쓴이의 이혼·병은 우리 화자의 것이 아니다 —
//    원문 근거는 계획이 코드로 확인한 근거 문장(`warrants[].evidenceText`)으로만 들어온다.

type LifeHit = { code: DraftLifeReviewCode; level: 'hard' | 'review'; detail: string }

const SPOUSE_WORDS: readonly string[] = ['남편', '신랑', '아내', '와이프', '애들아빠', '아이아빠']
const PARENT_WORDS: readonly string[] = [
  '시어머니', '시아버지', '시부모', '시댁', '친정', '엄마', '아빠', '어머니', '아버지', '부모',
]
/** 절 머리 주어 자리 — 주격·화제 조사로 끝나는 어절 */
const SUBJECT_END_RE = /(?:께서|이가|이|가|은|는)(?:도|만)?$/
const SELF_SUBJECT_RE = /^(?:제가|내가|저는|나는|저도|나도|저희가|우리가)$/
/** 🔴 전언 — 남에게 들은 말이다(`나왔대요`). `~더라고요` 는 넣지 않는다 — 내가 겪은 일에도 쓴다 */
const REPORTED_RE = /(?:대요|래요|다네요|라네요|했대|한대|다더라|라더라|다던데|라던데|답니다|랍니다|더래요)[.!~…ㅠㅜ\s]*$/
/** 🔴 가정 — 조건을 여는 어미(`드리면` · `이혼하면` · `할 거면`). `하면서` 는 절 경계가 이미 잘랐다 */
const CONDITIONAL_RE = /면(?![가-힣])/
/**
 * 🔴 **묻는 문장** — 물음표 없이 끝나는 의문 어미도 묻는 것이다(`말해야 하나요`).
 *    정본 틀(`ASKING_RE`)은 물음표만 본다 — 초안 제목은 물음표를 자주 뺀다.
 */
const QUESTION_END_RE = /(?:나요|까요|가요|는지요|던가요|습니까|을까|할까|는지)[.~…ㅠㅜ\s]*$/
/**
 * 🔴 **사람을 가리키는 말** — 정본 두 목록의 합이다(`OTHER_MARKERS` · `RELATION_NAMES`).
 *    `동서가` · `시누이가` 는 `OTHER_MARKERS` 에 없다 — 없으면 남의 일이 글쓴이 일로 읽힌다.
 */
const PERSON_WORDS: readonly string[] = [...new Set([...OTHER_MARKERS, ...RELATION_NAMES])]
/** 🔴 지난 일 — 지금의 경험이 아니다(`예전에 이혼 위기도 있었지만`) */
const PAST_CUE_RE = /예전에|옛날에|젊을\s*때|젊었을\s*때|신혼\s*(?:때|초)|결혼\s*초|한때|[0-9]+\s*년\s*전|몇\s*년\s*전|오래전|그땐|그때는/

/**
 * 🔴 **서술이 없는 절은 주장이 아니다** — 명사구 제목(`이혼 얘기` · `정신과`)은 화제일 뿐이다.
 *    끝 글자(기호·이모티콘을 뗀 마지막 음절)가 서술·이음 어미일 때만 사건을 말한 절로 본다.
 */
const PREDICATE_TAIL_RE = /[요다죠네데서고만니까더음함게지래야어아해와워셔봐줘걸께나며면]$/
const isPredicate = (clause: string): boolean => PREDICATE_TAIL_RE.test(clause.replace(/[^가-힣]+$/u, ''))

const bareOrSubject = (w: string): boolean => SUBJECT_END_RE.test(w) || !/[을를에의로과와랑도만께]$/.test(w)
/**
 * 🔴 어절 하나가 그 사람 말을 담았는가 — 목록 낱말이 **다른 낱말 속에** 든 것은 세지 않는다.
 *    `기분이` 는 `분이` 가 아니고 `형편이` 는 `형` 이 아니다(둘 다 세면 1인칭 경험이 남의 일로 샌다).
 *    · 조사가 붙은 표지(`분이` · `애가`)는 어절 전체가 같을 때만
 *    · 한 글자 표지(`딸` · `형`)는 조사를 뗀 말이 그 글자로 **끝날** 때만(`큰딸` · `막내딸`)
 *    · 나머지는 어절 안에 있으면(`친정엄마가` · `회사동료가`)
 */
const PARTICLE_TAIL_RE = /(?:께서|에게|한테|이랑|하고|이가|이|가|은|는|을|를|의|도|만|랑|과|와|께|네)+$/
const personIn = (w: string, m: string): boolean => {
  if (/(?:이|가|은|는|한테)$/.test(m) && m.length >= 2 && !RELATION_NAMES.includes(m)) return w === m
  if (m.length === 1) {
    const n = w.replace(PARTICLE_TAIL_RE, '')
    return n === m || n.endsWith(m)
  }
  return w.includes(m)
}
const otherIn = (w: string, counterpart: readonly string[]): boolean =>
  PERSON_WORDS.some((m) => personIn(w, m) && !counterpart.some((c) => c.includes(m) || w.includes(c)))

/** 🔴 절 머리 주어가 누구인가 — 나(1인칭 낱말 · 축의 상대) / 남(`OTHER_MARKERS`) / 모름 */
const personSubject = (clause: string, counterpart: readonly string[]): 'self' | 'other' | null => {
  const words = clause.split(/\s+/).filter((w) => w !== '').slice(0, 4)
  for (const w of words) {
    if (SELF_SUBJECT_RE.test(w)) return 'self'
    if (!SUBJECT_END_RE.test(w)) continue
    if (counterpart.some((c) => w.includes(c))) return 'self'
    if (otherIn(w, counterpart)) return 'other'
  }
  return null
}

/**
 * 🔴 **이 절의 이 사건은 글쓴이 자신의 지금 경험인가.** 모르면 `true` — 한국어는 1인칭을 생략한다.
 *    같은 문장 앞 절에서 남이 주어로 섰고 이 절에 주어가 없으면 그 사람의 일이다(`-고` 이음).
 */
const firstPersonNow = (
  frames: readonly ClauseFrame[], i: number, at: number, counterpart: readonly string[],
): boolean => {
  const f = frames[i]!
  if (f.general) return false
  const c = f.clause
  if (!isPredicate(c)) return false
  if (REPORTED_RE.test(c)) return false
  const before = c.slice(0, at)
  const after = c.slice(at)
  if (CONDITIONAL_RE.test(after.split(/\s+/).slice(0, 3).join(' '))) return false
  if (PAST_CUE_RE.test(c) || PAST_FRAME_RE.test(c)) return false
  // 🔴 사건 바로 앞 어절이 남이면(`친구 이혼 소식`) 그 사람 일이다
  const prev = before.trim().split(/\s+/).filter((w) => w !== '').pop()
  if (prev !== undefined && otherIn(prev, counterpart) && bareOrSubject(prev)) return false
  let subj = personSubject(c, counterpart)
  for (let k = i - 1; subj === null && k >= 0 && frames[k]!.sentence === f.sentence; k -= 1) {
    subj = personSubject(frames[k]!.clause, counterpart)
    if (PAST_CUE_RE.test(frames[k]!.clause)) return false
  }
  // 🔴 문장 끝이 전언이면 앞 절의 사건도 들은 말이다
  const last = [...frames].reverse().find((x) => x.sentence === f.sentence)
  if (last !== undefined && (REPORTED_RE.test(last.clause) || QUESTION_END_RE.test(last.clause))) return false
  return subj !== 'other'
}

/** 절마다 정규식이 처음 걸린 자리 */
const firstAt = (clause: string, re: RegExp): { at: number; token: string } | null => {
  const m = re.exec(clause)
  return m === null ? null : { at: m.index, token: m[0] }
}

// ── 1. 혼인·부부 관계 vs 1인칭 이혼·별거 ──
/** 🔴 **사건**으로 말할 때만 — `이혼 가정` 같은 명사구 화제는 경험이 아니다 */
const DIVORCE_EVENT_RE =
  /이혼(?:을|도|까지)?\s*(?:하|했|할|해|하자|얘기|이야기|말|서류|소송|위기|생각|결심|도장|숙려)|별거\s*(?:중|하|했|해)|갈라서|갈라설|사네\s*마네|졸혼/

function judgeMarital(frames: readonly ClauseFrame[], card: DraftGateCard): LifeHit[] {
  const out: LifeHit[] = []
  frames.forEach((f, i) => {
    const hit = firstAt(f.clause, DIVORCE_EVENT_RE)
    if (hit === null || !firstPersonNow(frames, i, hit.at, SPOUSE_WORDS)) return
    const m = card.maritalStatus.trim()
    // 🔴 카드가 이미 이혼·별거다 — 뒷받침된다
    if (m === '이혼' || m === '별거') return
    const rel = (card.spouseRelationship ?? '').trim()
    /**
     * 🔴 사별·비혼 · 기혼(원만) 은 확정 모순이다. 기혼(갈등·소원) · 관계 미상 · 모르는 혼인 상태는
     *    이혼 이야기가 나올 수는 있는 집이라 확정할 수 없다 → 사람 검토(통과가 아니다).
     */
    const level: 'hard' | 'review' = m === '사별' || m === '비혼' || (m === '기혼' && rel === '원만')
      ? 'hard' : 'review'
    out.push({ code: 'maritalStatusConflict', level, detail: `카드 ${m}${rel === '' ? '' : `(${rel})`} · "${f.clause}"` })
  })
  return out
}

/**
 * 🔴 (v4 · 창업자 gold #5) **결혼 전 연애 단계를 자기 일로** — `연상연하 커플인데요 … 남친의 누나 … 나중에 결혼하면`.
 *    50·60대 화자나 기혼 카드가 말하면 우리 또래 화자로 읽히지 않는다. 재혼·연애는 있을 수 있어 **사람 검토**다.
 *    🔴 남의 일(`딸이 남친을 데려왔어요`) · 전언 · 묻는 문장은 걸리지 않는다(정본 1인칭 판정).
 */
const DATING_SELF_RE =
  /연상연하|남친|남자\s*친구|여친|예비\s*(?:신랑|신부|시댁|시어머니)|연애\s*중|소개팅|썸\s*(?:타|남)|사귀는\s*중|나중에\s*결혼하면|결혼\s*(?:예정|날짜를?\s*잡)/
function judgeDatingStage(frames: readonly ClauseFrame[], card: DraftGateCard): LifeHit[] {
  const older = /^(?:50|60|70)대/.test((card.ageBand ?? '').trim())
  if (!older && card.maritalStatus.trim() !== '기혼') return []
  const out: LifeHit[] = []
  frames.forEach((f, i) => {
    const hit = firstAt(f.clause, DATING_SELF_RE)
    if (hit === null || !firstPersonNow(frames, i, hit.at, ['남친', '남자친구', '여친', '신랑', '신부'])) return
    out.push({ code: 'maritalStatusConflict', level: 'review', detail: `카드 ${card.ageBand ?? ''} ${card.maritalStatus} · 결혼 전 연애 단계를 자기 일로 · "${f.clause}"` })
  })
  return out
}

// ── 2. 돌봄·한집 살림 vs 1인칭 연락 끊김·따로 삶 ──
const NO_CONTACT_RE =
  /(?:연락|전화|안부)(?:도|를|을)?\s*(?:안|못)\s*(?:드리|드렸|드려|하|했|해)|(?:못|안)\s*(?:뵌|뵈|찾아뵈|찾아뵙)|찾아뵙지\s*(?:못|않)|발길(?:을)?\s*끊/
const SEPARATE_RE =
  /따로\s*(?:사시|살|지내)|멀리\s*(?:사시|계시)|(?:시댁|친정|시가)(?:에|엘)?\s*(?:가서|갔|간다|갈|가요|다녀|내려가|들르|들렀)|뵈러\s*(?:가|갔|다녀)|(?:시댁|친정)\s*(?:가는|갈|간)\s*(?:길|때|날)/
const INLAW_RE = /시부모|시어머니|시아버지|시댁|시엄마/
const MATERNAL_RE = /친정/

const sideOf = (text: string): '시댁' | '친정' | 'both' | null => {
  const a = INLAW_RE.test(text)
  const b = MATERNAL_RE.test(text)
  return a && b ? 'both' : a ? '시댁' : b ? '친정' : null
}

function judgeCare(frames: readonly ClauseFrame[], all: string, card: DraftGateCard): LifeHit[] {
  // 🔴 늘 돌보는 사람만 본다 — 간헐·없음 카드에게 연락 끊김은 모순이 아니다
  if ((card.parentCare ?? '').trim() !== '상시') return []
  const out: LifeHit[] = []
  const hh = card.household
  frames.forEach((f, i) => {
    const nc = firstAt(f.clause, NO_CONTACT_RE)
    const sp = firstAt(f.clause, SEPARATE_RE)
    const hit = nc ?? sp
    if (hit === null || !firstPersonNow(frames, i, hit.at, PARENT_WORDS)) return
    // 🔴 누구 쪽 이야기인가 — 절 → 문장 → 글 전체 순으로 좁은 곳을 먼저 본다
    const sentence = frames.filter((x) => x.sentence === f.sentence).map((x) => x.clause).join(' ')
    const side = sideOf(f.clause) ?? sideOf(sentence) ?? sideOf(all)
    const detail = (why: string): string => `카드 간병 상시 · ${why} · "${f.clause}"`
    if (hh === undefined || hh.careSide === null) {
      out.push({ code: 'careHouseholdConflict', level: 'review', detail: detail('돌보는 쪽 미상') })
      return
    }
    if (side === null || side === 'both') {
      out.push({ code: 'careHouseholdConflict', level: 'review', detail: detail('글이 어느 쪽 부모인지 모호') })
      return
    }
    // 🔴 돌보지 않는 쪽 부모 이야기다 — 모순이 아니다
    if (side !== hh.careSide) return
    if (nc !== null) {
      out.push({ code: 'careHouseholdConflict', level: 'hard', detail: detail(`${side} 쪽을 늘 돌보는데 연락이 끊겼다`) })
      return
    }
    if (hh.careCohabit === true) {
      out.push({ code: 'careHouseholdConflict', level: 'hard', detail: detail(`${side} 쪽과 한집인데 따로 산다`) })
    } else if (hh.careCohabit === null) {
      out.push({ code: 'careHouseholdConflict', level: 'review', detail: detail('한집 여부 미상') })
    }
  })
  return out
}

// ── 3. 1인칭 정신건강·질병 vs 근거·카드·계획 ──
const MENTAL_CLINICAL_RE =
  /우울증|불안\s*장애|공황(?:\s*장애)?|조울|정신건강의학과|정신과|신경정신과|항우울제|신경안정제|수면제|심리\s*상담|상담\s*치료|정신\s*치료/
const MENTAL_WORSE_RE = /(?:우울|불안)[가-힣\s]{0,12}(?:심해|악화|더해|못\s*견디|견디기\s*힘)/
const ILLNESS_RE =
  /암\s*(?:진단|수술|판정|이래|이라)|항암|입원(?:했|해|하|중)|수술(?:을|도)?\s*(?:받|했|하)|진단(?:을|도)?\s*받|당뇨|고혈압|갑상선|류마티스|대상포진/
const MENO_CONTEXT_RE = /갱년기|폐경|호르몬|안면홍조|열감/
const HEALTH_NOGO_RE = /병명|병원|약/

/** 🔴 계획이 코드로 확인한 근거 문장에 같은 말이 있는가 — 원문 근거는 이것뿐이다 */
const warranted = (plan: DraftGatePlan | null, token: string): boolean => {
  if (plan === null || plan.selfBasis !== 'lifeFacts') return false
  const stem = token.replace(/\s+/g, '').slice(0, 2)
  return plan.warrants.some((w) => (w.evidenceText ?? '').replace(/\s+/g, '').includes(stem))
}

function judgeHealth(frames: readonly ClauseFrame[], plan: DraftGatePlan | null, card: DraftGateCard): LifeHit[] {
  const out: LifeHit[] = []
  const menoOk = ['진행중', '후'].includes((card.menopauseStatus ?? '').trim())
  const noGoHealth = (card.noGoTopics ?? []).some((t) => HEALTH_NOGO_RE.test(t))
  frames.forEach((f, i) => {
    const clinical = firstAt(f.clause, MENTAL_CLINICAL_RE)
    const worse = firstAt(f.clause, MENTAL_WORSE_RE)
    const ill = firstAt(f.clause, ILLNESS_RE)
    const hit = clinical ?? worse ?? ill
    if (hit === null || !firstPersonNow(frames, i, hit.at, [])) return
    // 🔴 카드가 뒷받침한다 — 갱년기를 겪는 사람의 갱년기 증상
    if (menoOk && MENO_CONTEXT_RE.test(f.clause)) return
    // 🔴 계획이 원문 근거로 허가했다
    if (warranted(plan, hit.token)) return
    // 🔴 절 안에 다른 사람이 있으면(`엄마 모시고 정신과`) 누구 진료인지 확정할 수 없다 → 사람
    const someoneElse = f.clause.split(/\s+/).some((w) => otherIn(w, []))
    const level: 'hard' | 'review' = someoneElse ? 'review'
      : clinical !== null ? 'hard'
        : ill !== null && noGoHealth ? 'hard'
          : 'review'
    out.push({ code: 'unsupportedHealthClaim', level, detail: `"${hit.token}" · 카드·계획 근거 없음 · "${f.clause}"` })
  })
  return out
}

// ── 4. 자녀 나이대·동거 vs 자녀의 삶의 단계·경제 행동 ──
const MONEY_RE = /용돈|봉투|현금|[0-9]+\s*만\s*원|생활비|돈을?\s*(?:보내|부쳐|부쳤|드리|드렸|줬|주더)/
const GIVE_RE = /넣|드리|드렸|드려|보내|보냈|부쳐|부쳤|챙겨|쥐어|사\s*왔|사왔|사다\s*(?:줬|드|주)|주더|줬/
/** 🔴 자녀가 **받는** 쪽이면 어느 나이대든 있다(`딸이 용돈 올려 달래요`) */
const RECEIVE_RE = /달라|달래|받아|받았|받더|타\s*가|올려\s*달|더\s*달/
const CHILD_JOB_RE = /취직|취업|입사|첫\s*월급|월급(?:을|이|날|받)|회사\s*(?:다니|생활)|직장\s*(?:다니|생활)/
const MILITARY_RE = /군대|입대|전역|제대|훈련소|자대\s*배치|군\s*복무|군\s*휴가/
const WEDDING_RE = /결혼식|상견례|예식장|신혼집|혼수|예단|청첩장|결혼(?:을|도)?\s*(?:했|한다|해서|시켰|시킨)/
/** 🔴 자녀가 **따로 산다** — 방문(`빈손으로 왔다` · `다녀갔다`)·분가·자취 */
const CHILD_APART_RE = /빈손으로\s*(?:왔|오)|내려왔|올라왔|다녀갔|분가|독립(?:해서|했|한|하고)|자취/
/** 🔴 식구가 **모처럼** 모인다 — 누가 모였는지 절이 말하지 않으면 모호하다 */
const GATHER_RE = /(?:모처럼|오랜만에)\s*(?:다\s*)?(?:같이\s*|함께\s*)?(?:다\s*)?(?:모이|모여|얼굴\s*보)/

/** 🔴 (v4) 카드 자녀 나이대의 최소 나이 — 나이대 정본(`CHILD_AGE_BANDS`)의 아래 끝이다 */
const BAND_MIN_AGE: Readonly<Partial<Record<ChildAgeBand, number>>> = {
  '영유아': 0, '초등': 7, '중고등': 13, '대학·취준': 19, '성인': 20,
}
const SELF_PLURAL_KIDS_RE = /(?:우리|저희|울)\s*(?:아이들|애들|자식들|아이들이|애들이)/
/** 🔴 지금의 결혼 햇수 — `결혼 5년 만에 이혼했어요` 는 끝난 결혼의 길이라 세지 않는다 */
const MARRIAGE_YEARS_RE = /결혼\s*(?:한\s*지\s*)?(\d{1,2})\s*년(?!\s*만에)(?:차|째)?/
/** 🔴 학령기 학습 — 부모가 시키거나 봐 주는 쪽의 말만. `과외 선생님이에요`(자녀의 일)는 걸리지 않는다 */
const STUDENT_ACT_RE =
  /과외(?:를|도)?\s*(?:붙|시키|시켜|받|시작)|학원(?:에|을)?\s*(?:보내|보냈|다니|끊|등록)|숙제|채점|성적표|수행\s*평가|학부모\s*상담|등하교/
const BIRTH_ANCHOR_RE = /(?:아이|아기|애기|딸|아들|첫째|둘째|막내)(?:가|를|이|는)?\s*(?:태어나|낳|출산)|출산\s*(?:하고|후|뒤)/
const ELAPSED_YEARS_RE = /(\d{1,2})\s*년(?:째|이나|\s*(?:이\s*)?(?:지났|됐|되었|흘렀|넘었))/
/** 🔴 자녀 · 배우자는 이 축의 상대다 — 남으로 세지 않는다 */
const CHILD_WORDS: readonly string[] = ['아이', '아기', '애기', '딸', '아들', '첫째', '둘째', '막내', '남편', '신랑', '선생님']

function judgeChildren(
  title: string, body: string, frames: readonly ClauseFrame[], card: DraftGateCard, plan: DraftGatePlan | null,
): LifeHit[] {
  if (card.childrenCount <= 0) return []
  const out: LifeHit[] = []
  const bands = card.childrenAgeBands
  const has = (b: ChildAgeBand): boolean => bands.includes(b)
  const living = card.household?.childrenLiving ?? null
  const push = (level: 'hard' | 'review', why: string, clause: string): void => {
    out.push({ code: 'childLifeStageConflict', level, detail: `카드 자녀 ${bands.join('·') || '미상'}${living === null ? '' : `(${living})`} · ${why} · "${clause}"` })
  }
  const kids = readSelfChildClauses(title, body, OWNER_OPTS)
  for (const k of kids) {
    const c = k.clause
    // 🔴 지난 일·앞날은 지금 삶의 주장이 아니다(C 게이트와 같은 시간 틀)
    if (PAST_FRAME_RE.test(c) || PAST_CUE_RE.test(c)) continue
    const future = FUTURE_FRAME_RE.test(c)
    if (!isPredicate(c) || REPORTED_RE.test(c) || CONDITIONAL_RE.test(c) || QUESTION_END_RE.test(c)) continue
    if (bands.length === 0) {
      if (MONEY_RE.test(c) || CHILD_JOB_RE.test(c) || MILITARY_RE.test(c) || WEDDING_RE.test(c) || CHILD_APART_RE.test(c)) {
        push('review', '카드 자녀 나이대 미상', c)
      }
      continue
    }
    // ① 자녀가 부모에게 돈·봉투를 건넨다 — 벌이가 있는 자녀다
    if (k.childSubject && MONEY_RE.test(c) && GIVE_RE.test(c) && !RECEIVE_RE.test(c)) {
      if (!has('성인')) push(has('대학·취준') ? 'review' : 'hard', '자녀가 돈·봉투를 건넨다(벌이가 있는 자녀)', c)
    }
    // ② 취업·월급
    if (CHILD_JOB_RE.test(c) && !has('성인') && !has('대학·취준')) push(future ? 'review' : 'hard', '자녀의 취업·월급', c)
    // ③ 입대·전역
    if (MILITARY_RE.test(c) && !has('성인') && !has('대학·취준')) push(future ? 'review' : 'hard', '자녀의 군 복무', c)
    // ④ 결혼 — 앞날로 말하면(`나중에 결혼식 때`) 지금 삶의 주장이 아니다
    if (WEDDING_RE.test(c) && !future && !has('성인')) push(has('대학·취준') ? 'review' : 'hard', '자녀의 결혼', c)
    // ⑤ 따로 산다 — 카드는 자녀 모두 동거
    if (CHILD_APART_RE.test(c)) {
      if (living === '동거') push('hard', '카드는 자녀 동거인데 자녀가 따로 산다·다녀간다', c)
      else if (living === null) push('review', '자녀 동거 여부 미상', c)
    }
  }
  // ── (quality-v4 · 2026-09-28 창업자 gold #4 · #10 · #28) 카드의 자녀 수 · 나이와 초안의 숫자·행동 ──
  /**
   * 🔴 **이 글이 글쓴이 자기 자녀 이야기인가** — 정본 자녀 절(`readSelfChildClauses`) 또는 계획이 원문 근거로
   *    **자녀를 허가**했다(`lifeFacts` · `children`/`childAgeBand` 근거). 조사 없는 `좋아 죽겠다는 딸` 은 정본 절이
   *    세지 않지만 계획은 이미 "내 딸" 로 썼다(창업자 gold #28).
   */
  const ownChildPost = kids.length > 0 || (plan?.selfBasis === 'lifeFacts'
    && plan.warrants.some((w) => w.fact === 'children' || w.fact === 'childAgeBand'))
  const minAges = bands.map((b) => BAND_MIN_AGE[b]).filter((n): n is number => n !== undefined)
  const youngest = minAges.length === 0 ? null : Math.min(...minAges)
  const oldest = minAges.length === 0 ? null : Math.max(...minAges)
  frames.forEach((f, i) => {
    const c = f.clause
    // ⑦ 자녀 한 명 카드인데 명시적 `우리 아이들` — 수가 다르다(생략 1인칭 `애들` 은 세지 않는다)
    // 🔴 명시적 1인칭(`우리 아이들`)은 세상 이야기 틀(`세대` · `다들`)보다 세다 — 정본 임자 규칙과 같다
    if (card.childrenCount === 1 && SELF_PLURAL_KIDS_RE.test(c) && !REPORTED_RE.test(c)) {
      push('hard', '카드는 자녀 1명인데 "우리 아이들"', c)
    }
    // ⑧ 결혼 햇수 — 가장 큰 아이가 결혼보다 먼저 태어났다
    const my = MARRIAGE_YEARS_RE.exec(c)
    if (my !== null && oldest !== null && firstPersonNow(frames, i, my.index, SPOUSE_WORDS)) {
      const years = Number(my[1])
      if (oldest > years + 1) {
        push(card.maritalStatus.trim() === '기혼' ? 'hard' : 'review', `결혼 ${years}년인데 카드 자녀는 ${oldest}세 이상`, c)
      }
    }
    // ⑩ 성인 자녀만 있는 카드에서 학령기 학습 활동(과외를 붙였다 · 채점 · 숙제)
    const st = STUDENT_ACT_RE.exec(c)
    if (st !== null && ownChildPost && youngest !== null && youngest >= BAND_MIN_AGE['대학·취준']!
      && firstPersonNow(frames, i, st.index, CHILD_WORDS)) {
      push(has('대학·취준') ? 'review' : 'hard', '카드 자녀는 성인인데 학령기 학습(과외 · 채점 · 숙제)', c)
    }
  })
  // ⑨ 출생을 기준으로 지난 햇수 — `아이 태어나고 … 벌써 5년` 이면 그 아이는 다섯 살 안팎이다
  if (youngest !== null) {
    const sentences = [...new Set(frames.map((f) => f.sentence))].map((n) => frames.filter((f) => f.sentence === n))
    sentences.forEach((fs, si) => {
      const anchorAt = fs.findIndex((f) => BIRTH_ANCHOR_RE.test(f.clause))
      if (anchorAt < 0) return
      const idx = frames.indexOf(fs[anchorAt]!)
      if (!firstPersonNow(frames, idx, BIRTH_ANCHOR_RE.exec(fs[anchorAt]!.clause)!.index, CHILD_WORDS)) return
      const scope = [...fs, ...(sentences[si + 1] ?? [])].map((f) => f.clause).join(' ')
      const e = ELAPSED_YEARS_RE.exec(scope)
      if (e === null) return
      const n = Number(e[1])
      if (youngest > n + 3) push('hard', `출생 뒤 ${n}년 — 카드 가장 어린 자녀는 ${youngest}세 이상`, fs.map((f) => f.clause).join(' '))
      else if (youngest > n) push('review', `출생 뒤 ${n}년 — 카드 자녀 나이대와 어긋날 수 있다`, fs.map((f) => f.clause).join(' '))
    })
  }
  // ⑥ 식구가 모처럼 모인다 — 자녀 이야기인 글에서만, 누가 모였는지 모호하다 → 사람
  if (kids.length > 0 && living !== '분가' && living !== '일부') {
    frames.forEach((f, i) => {
      const g = firstAt(f.clause, GATHER_RE)
      if (g === null || !firstPersonNow(frames, i, g.at, [])) return
      push('review', '"모처럼 모인다" — 자녀가 따로 사는 집의 말', f.clause)
    })
  }
  return out
}

/** 🔴 넷을 한 번에 — 판정은 위 함수들이 하고 여기서는 모은다 */
export function judgeLifeConsistency(
  title: string, body: string, plan: DraftGatePlan | null, card: DraftGateCard,
): { hard: DraftLifeReview[]; review: DraftLifeReview[] } {
  const frames = readClauseFrames(title, body, OWNER_OPTS)
  const all = `${title}\n${body}`
  const hits: LifeHit[] = [
    ...judgeMarital(frames, card),
    ...judgeDatingStage(frames, card),
    ...judgeCare(frames, all, card),
    ...judgeChildren(title, body, frames, card, plan),
    ...judgeHealth(frames, plan, card),
  ]
  const fold = (level: 'hard' | 'review'): DraftLifeReview[] => {
    const by = new Map<DraftLifeReviewCode, string[]>()
    for (const h of hits.filter((x) => x.level === level)) by.set(h.code, [...(by.get(h.code) ?? []), h.detail])
    return [...by].map(([code, ds]) => ({ code, detail: [...new Set(ds)].slice(0, 3).join(' / ') }))
  }
  return { hard: fold('hard'), review: fold('review') }
}

// ─────────────────────────────────────────────────────────
// 🔴 원천·시점 대조 게이트 넷 (2026-09-28 quality-v3)
// ─────────────────────────────────────────────────────────
//
// 🔴 **왜 있나.** quality-v1 cohort 30건 중 사람이 고치거나 버려야 할 글 13건 가운데 아래 모양은
//    카드 게이트(v2)로도 잡히지 않았다 — 넷 다 **초안만 봐서는 틀린 곳이 없고, 원천·시각과 견줘야 보인다.**
//    ```
//    #8   원문 09-24 · "이제 집으로 퇴근하는 길이에요 · 다들 명절 잘 보내세요"     → 회차 09-28 에는 끝난 명절
//    #21  원문 09-24 · "지금 이승철 콘서트인데 박보검이 나왔어요"                   → 게시 때는 지금이 아니다
//    #9   원문 시각 미상 · 제목 "명절에…" + "이번에 … 가기로 했는데요"              → 이미 지났을 수 있는 계획
//    #18  원천 카페 · "자주 바꾸시는 분들이 꽤 보이네요"                            → 다른 카페 회원을 본 말
//    #19  원천 카페 · "요즘 비슷한 이야기들이 자주 보여"                            → 다른 카페 글을 본 말
//    #7   "한번 봐주세요 · 회원님들이 보시기엔 어떠신가요?"                        → 우리 글에는 볼 것이 없다
//    #2   원문 끝 "남편이 아침을 주니까 / 야" → 초안 "…챙겨주니 본체만체하네요."     → 없는 결말
//    ```
// 🔴 **낱말 하나로 막지 않는다.** 네 축 모두 **초안의 모양 + 원천의 사실(시각 · 사이트 · 사진 수 · 끝맺음)**
//    둘이 함께 있을 때만 걸린다. `요즘` · `이번에` · `오늘` 만으로는 걸리지 않는다.
// 🔴 **확정할 수 있을 때만 막는다(AUTO_HOLD).** 원천 사실을 모르거나 해석이 둘이면 사람 검토다 —
//    통과시키지 않는다.

/**
 * 🔴 **"우리 집도/만 그렇다"** — 축 낱말(남편 · 부모 …) 없이 글의 사정을 통째로 자기 집안 사실로 둔다.
 *    `readSelfClaims` 는 축 낱말이 있어야 센다 — #19 `우리 집만 그런 게 아니었구나` 는 축 낱말이 없다.
 *    🔴 전언(`~대요`)은 남의 집 이야기다.
 */
const FAMILY_LIKE_TOPIC_RE =
  /(?:우리|저희|울)\s*(?:집|집안|식구|친정|시댁)(?:도|만|이|은|이나)?\s*(?:그런|그래|그렇|마찬가지|똑같|비슷)/
function readSelfFamilyLikeTopic(title: string, body: string): string[] {
  return readClauseFrames(title, body, OWNER_OPTS)
    .filter((f) => FAMILY_LIKE_TOPIC_RE.test(f.clause) && !REPORTED_RE.test(f.clause))
    .map((f) => f.clause)
}

/**
 * 🔴 **`noLifeFactNeeded` 계획의 자기 가족사** (2026-09-28 quality-v3 · cohort #19) — 사람 검토.
 *    계획이 "생활사 없이 쓰는 보편 감정 글" 이라고 정했는데 초안이 `우리 집만 그런 게 아니었구나` 로
 *    자기 집안 사정을 사실로 뒀다. 생활사가 필요 없다고 한 계획은 **허가가 아니다**(근거도 비어 있다).
 *    🔴 확정(AUTO_HOLD)으로 두지 않는다 — 카드가 그 사실을 뒷받침할 수도 있다(P08 은 성인 자녀 둘이 있다).
 *       카드와 **어긋나면** C 게이트 · 생활 일관성 게이트가 따로 막는다.
 *    🔴 가족 축(배우자 · 자녀 · 부모 · 돌봄)만, 그리고 **명시된 1인칭**(`우리 남편` · `저희 애들`)만 센다 —
 *       생략된 1인칭은 일반론(`친정이나 처가는 친정댁이라고 안 부르잖아요` · cohort #26)까지 잡는다.
 *       집 · 일(`저희 아파트는` · cohort #12)은 가족사가 아니다.
 */
/**
 * 🔴 정본 파서는 `친정` 을 낱말 자체로 '내 것' 으로 읽는다 — 호칭 이야기(`친정이나 처가는 …`)까지 명시로 센다.
 *    사람 검토로 보내는 자리라 **1인칭 한정사가 절에 실제로 있을 때만** 센다.
 */
const SELF_OWNER_WORD_RE = /(?<![가-힣])(?:우리|저희|울|제|내)\s?[가-힣]/
const FAMILY_AXES: ReadonlySet<SelfClaimAxis> = new Set<SelfClaimAxis>(['spouse', 'children', 'parents', 'parentCare'])
/**
 * 🔴 (v4 · 창업자 gold #16) **1인칭 금융 행동** — `보험 싹 리모델링해서 바꿨거든요`. 계획이 생활사를 허가하지 않았는데
 *    자기 돈·계약 사정을 사실로 둔다. 소재(보험 영업 연락)는 좋다 — 막지 않고 사람 검토(질문형 최소 수정)로 보낸다.
 *    🔴 묻는 문장 · 전언 · 남의 일은 걸리지 않는다.
 */
const FINANCE_SELF_RE =
  /(?:보험|대출|적금|예금|주식|연금|펀드|청약|카드론)[^.!?\n]{0,15}?(?:가입했|가입해서|리모델링|해지했|해지해서|갈아탔|바꿨|바꾸었|넣었|들었|샀|팔았)/
function judgeFinanceSelf(title: string, body: string, plan: DraftGatePlan | null): string[] {
  if (plan === null || (plan.selfBasis !== null && plan.selfBasis !== 'noLifeFactNeeded')) return []
  const frames = readClauseFrames(title, body, OWNER_OPTS)
  const out: string[] = []
  frames.forEach((f, i) => {
    const hit = firstAt(f.clause, FINANCE_SELF_RE)
    if (hit !== null && firstPersonNow(frames, i, hit.at, [])) out.push(f.clause)
  })
  return out
}

/**
 * 🔴 (v4 · 창업자 gold #1 · 소프트 품질) **받아칠 거리가 없는 하소연.** 계획 스스로 마무리를 `vent` 로,
 *    역할을 대화 촉발(`conversationSpark`) **하나만** 골랐고(공감 경험 · 쓸 만한 답 · 발견 없음) 묻는 말도 없다.
 *    🔴 확정하지 않는다 — 사람 검토다. 공감 역할이 있는 하소연(`experienceResonance`)이나 묻는 글은 걸리지 않는다.
 *    🔴 계획에 이 칸이 없으면 판정하지 않는다(소프트 신호라 모름을 결함으로 세지 않는다).
 */
function judgeThinVent(title: string, body: string, plan: DraftGatePlan | null): DraftLifeReview[] {
  const roles = plan?.contentRoles
  if (plan === null || plan.closingIntent !== 'vent' || roles === undefined || roles.length === 0) return []
  if (!roles.every((r) => r === 'conversationSpark')) return []
  const asks = `${title}\n${body}`.split(/(?<=[.!?？。])\s+|\n+/).some((x) => /[?？]/.test(x) || QUESTION_END_RE.test(x.trim()))
  if (asks) return []
  return [{ code: 'thinVentDraft', detail: `계획 vent · 역할 ${roles.join('·')} · 묻는 말 없음` }]
}

function judgeNoLifeFactClaims(title: string, body: string, plan: DraftGatePlan | null): DraftLifeReview[] {
  const fin = judgeFinanceSelf(title, body, plan)
  const finReview: DraftLifeReview[] = fin.length === 0 ? []
    : [{ code: 'unwarrantedSelfClaim', detail: `계획 ${plan?.selfBasis ?? 'null'} · 1인칭 금융 행동 — ${fin.slice(0, 2).join(' / ')}` }]
  if (plan === null || plan.selfBasis !== 'noLifeFactNeeded') return finReview
  const clauses = [
    ...readSelfClaims(title, body, OWNER_OPTS)
      .filter((c) => FAMILY_AXES.has(c.axis) && c.owner === 'explicit' && SELF_OWNER_WORD_RE.test(c.clause))
      .map((c) => c.clause),
    ...readSelfFamilyLikeTopic(title, body),
  ]
  if (clauses.length === 0) return finReview
  return [...finReview, { code: 'unwarrantedSelfClaim', detail: `계획 noLifeFactNeeded · 자기 가족사 — ${[...new Set(clauses)].slice(0, 3).join(' / ')}` }]
}

type SourceDay = 'same' | 'before' | 'unknown'
/**
 * 🔴 **원문이 판정 시각과 같은 KST 날짜에 올라왔는가.**
 *    · `postedAt` 이 있으면 그것으로 가른다
 *    · 없으면 `capturedAt` 이 **앞 날짜일 때만** "앞" 이다 — 올라온 시각은 가져온 시각보다 늦을 수 없다.
 *      같은 날 가져왔으면 올라온 날은 모른다(며칠 전 글을 오늘 가져올 수 있다)
 *    🔴 `capturedAt` 을 `postedAt` 대신 쓰지 않는다 — 오래된 글을 오늘 다시 가져온 것이 오늘 글이 된다.
 */
const sourceDayOf = (ctx: DraftGateContext): SourceDay => {
  const s = ctx.source
  if (s === null) return 'unknown'
  const today = kstDayStart(ctx.at).getTime()
  if (s.postedAt !== null) return kstDayStart(s.postedAt).getTime() < today ? 'before' : 'same'
  if (s.capturedAt !== null && kstDayStart(s.capturedAt).getTime() < today) return 'before'
  return 'unknown'
}

// ── 5. 시점 — 원문 날에만 맞는 명절 · 실시간 현장 ──
/** 🔴 날짜가 정해진 명절 — 끝나면 "지금" 이 아니다. `제사` 는 넣지 않는다(집마다 날이 다르다) */
const HOLIDAY_RE = /명절|추석|한가위|설날|구정|설\s*연휴|연휴|차례|성묘|귀성|귀경/
/** 🔴 날짜가 정해진 공개 현장 — 게시 때 "지금 ○○ 중" 이면 거짓이 된다 */
const LIVE_EVENT_RE = /콘서트|공연|경기|생방송|생중계|중계|시상식|축제|뮤지컬|방송/
/** 🔴 **지금 이 순간** — 쓴 사람의 시계에 묶인 말. `이제` 는 홀로 넣지 않는다(`이제 애들 다 컸어요` 는 지금 삶이다) */
const NOW_RE = /지금|방금|이제\s*막|실시간|현재/
/**
 * 🔴 **하는 중** — 끝나지 않은 동작. 명절·현장 맥락에서만 본다.
 *    🔴 `길` 은 **서술로 끝날 때만**(`가는 길이에요`) — `오는 길에 꽃 사고` 는 다녀온 이야기다(운영 P07 송편 글).
 *    🔴 `중` 은 **동사 뒤에서만**(`만드는 중`) — `별거 중` · `치료 중` 같은 명사 뒤 `중` 은 이어지는 상태다.
 */
const IN_PROGRESS_RE =
  /(?:는|가는|오는|하는)\s*길(?:이에요|입니다|이네요|인데|이야|이다)|(?:는|하는|보는|가는|먹는)\s*중(?:이|입니다|이에요|인데|이네요)?/
/** 🔴 (v4) **다가오는 명절** — 앞으로 올 이번 명절을 가리키는 말 */
const UPCOMING_HOLIDAY_RE =
  /(?:이번|올해|다가오는|오는|앞둔)\s*(?:명절|추석|한가위|설|연휴)|(?:명절|추석|한가위|설)\s*(?:선물|앞두|코앞|며칠\s*안)|인사\s*(?:오는|가는)\s*(?:명절|추석|설)|첫\s*(?:명절|추석|설)/
/** 🔴 (v4) 습관 — `명절 때마다` · `해마다` 는 특정한 이번 명절이 아니다 */
const HABITUAL_RE = /마다|매년|매번|해마다|항상/
/** 🔴 **날짜에 묶인 말** — 명절·현장과 함께일 때만 본다 */
const DAY_RE = /오늘|어제|내일|엊그제|그저께|모레/
/** 🔴 명절이 **아직 오지 않은** 자리의 말 — 인사 · 계획 */
const HOLIDAY_GREETING_RE =
  /(?:잘|즐겁게|편안히|행복하게|건강하게|넉넉하게)\s*(?:보내세요|보내시길|보내시고|쇠세요|쉬세요)|(?:즐거운|행복한|풍성한|넉넉한|편안한)\s*(?:명절|추석|한가위|연휴)/
const PLAN_AHEAD_RE =
  /기로\s*(?:했|해|하)|려고\s*(?:해요|합니다|하는데|해서|하고)|예정이|(?:할|갈|올)\s*거(?:예요|에요|야|라|든)|앞두고|코앞|다가오/
/**
 * 🔴 **돌아보는 말** — 명절·현장이 끝난 자리에서 쓴 것이다(과거 회고는 통과).
 *    🔴 `왔어요` 같은 흔한 과거 어미는 넣지 않는다 — `지금 콘서트인데 박보검이 나왔어요` 의 `나왔어요` 는
 *       지금 무대 이야기다(cohort #21 을 앞판이 이렇게 놓쳤다). **끝남 · 지남 · 다녀옴**만 센다.
 */
const RETRO_RE = /지난|지나고|지나서|지났|끝나고|끝났|끝내고|쇠고|보냈|지냈|다녀왔|다녀온|치렀|했었|였었|었던|았던|했던|갔었|보고\s*왔/

type TimeHit = { strong: boolean; clause: string }

function readTimeClaims(frames: readonly ClauseFrame[]): TimeHit[] {
  const retro = (c: string): boolean => RETRO_RE.test(c) || PAST_CUE_RE.test(c) || PAST_FRAME_RE.test(c)
  // 🔴 이 글에서 명절이 **아직 끝나지 않은 것**으로 말해지는가 — 모든 명절 언급이 회고면 아니다
  /**
   * 🔴 (v4) **습관으로 말한 명절**(`명절 때마다` · `해마다`)은 지금의 명절이 아니다 — 살아 있는 명절에서 뺀다.
   */
  const habitual = (c: string): boolean => HABITUAL_RE.test(c)
  const holidayLive = frames.some((f) => HOLIDAY_RE.test(f.clause) && !retro(f.clause) && !habitual(f.clause))
  const sentenceOf = (f: ClauseFrame): string => frames.filter((x) => x.sentence === f.sentence).map((x) => x.clause).join(' ')
  const out: TimeHit[] = []
  for (const f of frames) {
    const c = f.clause
    // 🔴 들은 말(`~대요`)은 글쓴이의 지금이 아니다
    if (REPORTED_RE.test(c)) continue
    const live = LIVE_EVENT_RE.test(c)
    const holiday = HOLIDAY_RE.test(c)
    // ① 지금 현장에 있다 · 명절 한가운데 무엇을 하는 중이다 — 쓴 순간에만 참이다
    if (!retro(c) && ((NOW_RE.test(c) && live) || (IN_PROGRESS_RE.test(c) && (live || holidayLive)))) {
      out.push({ strong: true, clause: c })
      continue
    }
    // ② 날짜 말(`오늘` …)이 명절·현장에 붙었다 — 회고여도 그 날짜가 원문의 날이다
    // 🔴 (v4) 같은 글에 살아 있는 명절이 있으면 날짜 말도 그 명절의 날이다(창업자 gold #15 `오늘 할 일`)
    if (DAY_RE.test(c) && (holiday || live || holidayLive)) { out.push({ strong: false, clause: c }); continue }
    // ③ 아직 오지 않은 명절 — 인사 · 계획
    if (HOLIDAY_GREETING_RE.test(c) && HOLIDAY_RE.test(sentenceOf(f))) { out.push({ strong: false, clause: c }); continue }
    if (holidayLive && PLAN_AHEAD_RE.test(c) && !retro(c)) { out.push({ strong: false, clause: c }); continue }
    /**
     * ④ (v4) **다가오는 명절을 글쓴이 자기 일로** — `이번 추석에` · `추석 선물` · `처음 인사 오는 명절이라`(창업자 gold #22).
     *    명절 낱말만으로는 걸지 않는다 — `명절 음식 중에서도` · `어떤 친구가 추석 선물로 … 하더라고요`(남의 일)는 통과다.
     */
    const up = firstAt(c, UPCOMING_HOLIDAY_RE)
    if (up !== null && !retro(c) && !habitual(c) && firstPersonNow(frames, frames.indexOf(f), up.at, [])) {
      out.push({ strong: false, clause: c })
    }
  }
  return out
}

function judgeStaleTime(frames: readonly ClauseFrame[], ctx: DraftGateContext): LifeHit[] {
  const claims = readTimeClaims(frames)
  if (claims.length === 0) return []
  const day = sourceDayOf(ctx)
  /**
   * 🔴 **같은 날이어도 통과시키지 않는다** (2026-09-28 마스터 재리뷰). 초안이 발행되는 시각은 판정 시각이
   *    아니다 — `지금 콘서트 보는 중` · `오늘 추석 음식 만드는 중` 은 몇 시간 뒤에도 틀린다. 발행 신선도(TTL)에
   *    맡기지 않는다. 같은 날 · 시각 모름은 사람 검토, 앞 날짜의 강한 실시간 주장만 확정(AUTO_HOLD)이다.
   *    회고 · 시간 표현이 없는 글은 `readTimeClaims` 에서 이미 걸리지 않는다.
   */
  const posted = ctx.source?.postedAt?.toISOString() ?? '미상'
  const when = day === 'before' ? '앞 날짜' : day === 'same' ? '같은 날' : '시각 미상'
  return claims.map((t) => ({
    code: 'staleTimeClaim' as const,
    // 🔴 원문이 앞 날짜인데 "지금 ○○ 중" 이다 — 확정. 인사·계획·날짜 말은 명절이 아직일 수 있다 → 사람
    level: t.strong && day === 'before' ? 'hard' as const : 'review' as const,
    detail: `원문 ${when}(posted ${posted}) · ${t.strong ? '지금·하는 중' : '날짜·인사·계획'} · "${t.clause}"`,
  }))
}

// ── 6. 출처 — 다른 커뮤니티에서 본 움직임 ──
/**
 * 🔴 **회원·글의 움직임을 봤다** — `분들이 꽤 보이네요` · `비슷한 이야기들이 자주 보여` · `글이 많이 올라오네요`.
 *    우리 게시판에 올라가면 **이 곳의 움직임**을 말한 것이 된다. 원천이 다른 커뮤니티 글이면 그 움직임은
 *    그 커뮤니티의 것이다 — 없는 활동을 있는 것처럼 보이게 한다(활발한 척 금지).
 */
const ACTIVITY_SEEN_RE = new RegExp([
  '(?:분들|회원|글|이야기|얘기|사연|질문|후기)(?:들)?(?:이|가|도)?\\s*(?:꽤|많이|자주|종종|부쩍|계속|여기저기|은근)?\\s*(?:많이\\s*)?(?:보이|보여|보입|올라오|올라와|올라옵)',
  // 🔴 어순이 뒤집힌 모양 — `게시판에 올라오는 명절 글들을 보다 보면`(운영 P15)
  '(?:올라오는|올라온|자주\\s*보이는)\\s*(?:[가-힣]+\\s+)?(?:글|이야기|얘기|사연|질문|후기)',
].join('|'))
/** 🔴 **다른 곳을 말했다** — 길 · 동네 · 방송에서 본 것은 커뮤니티의 움직임이 아니다. `카페` 는 넣지 않는다 */
const ELSEWHERE_RE =
  /(?:길|밖|동네|마트|시장|거리|지하철|버스|공원|티비|TV|뉴스|방송|유튜브|드라마|주변|회사|직장|병원|학교|식당)(?:에서|에|엔|을|를|서)?(?![가-힣])/

function judgeExternalCommunity(frames: readonly ClauseFrame[], ctx: DraftGateContext): LifeHit[] {
  const out: LifeHit[] = []
  const site = (ctx.source?.site ?? '').trim()
  for (const f of frames) {
    const c = f.clause
    if (!ACTIVITY_SEEN_RE.test(c) || REPORTED_RE.test(c)) continue
    const sentence = frames.filter((x) => x.sentence === f.sentence).map((x) => x.clause).join(' ')
    if (ELSEWHERE_RE.test(sentence)) continue
    // 🔴 원천이 커뮤니티 글이다 — 그 움직임은 그 커뮤니티의 것이다(확정). 원천을 모르면 사람
    out.push({
      code: 'externalCommunityClaim', level: site === '' ? 'review' : 'hard',
      detail: `원천 ${site === '' ? '미상' : site} · "${c}"`,
    })
  }
  return out
}

// ── 7. 자료 — 보여 줄 것이 없는데 봐 달라 ──
/**
 * 🔴 **눈으로 보고 판단해 달라** — `한번 봐주세요` · `보시기엔 어떠신가요` · `어때 보이나요`.
 *    기존 `readMediaDependency` 는 자료 낱말(`사진` …)이 있어야 잡는다 — #7 은 자료 낱말 없이 봐 달라고 했다.
 *    🔴 `봐` 바로 앞이 한글이면 다른 말이다(`들어봐 주세요` · `읽어봐 주세요`).
 *    🔴 인사말(`예쁘게 봐주세요`)은 판단 요청이 아니다.
 */
const LOOK_ASK_RE =
  /(?<![가-힣])봐\s*주(?:세요|실래요|시겠어요|셔요|실\s*분|시면)|보시기(?:엔|에|에는)\s*(?:어떠|어때|괜찮|이상)|(?:어때|괜찮아|이상해|예뻐)\s*보이(?:나요|세요|는지|시나요|죠|나)/
const LOOK_COURTESY_RE = /(?:예쁘게|이쁘게|좋게|너그럽게|귀엽게|곱게)\s*봐\s*주/
/**
 * 🔴 **아는 사람에게 묻는 것**은 조언 요청이다 — `요리 잘 아시는 분들 좀 봐주세요` 는 글로 설명한 것을
 *    봐 달라는 말이다(cohort #16 · 권고 무수정). 모양을 보고 판단해 달라는 것이 아니다.
 */
const LOOK_ADVICE_RE = /(?:아시는|아는|경험\s*있으신|해\s*보신|써\s*보신|겪어\s*보신)\s*분/

function judgeLookAsk(title: string, body: string, ctx: DraftGateContext): LifeHit[] {
  const sentences = `${title}\n${body}`.split(/(?<=[.!?？。])\s+|\n+/).map((x) => x.trim()).filter((x) => x !== '')
  const ask = sentences.find((x) => LOOK_ASK_RE.test(x) && !LOOK_COURTESY_RE.test(x) && !LOOK_ADVICE_RE.test(x))
  if (ask === undefined) return []
  const images = ctx.source?.imageCount ?? null
  return [{
    code: 'mediaDependentDraft',
    // 🔴 원천에 사진이 **실제로 있었다** — 그 사진을 봐 달라는 글이다(확정). 모르면 사람이 본다
    level: images !== null && images > 0 ? 'hard' : 'review',
    detail: `원천 사진 ${images !== null && images > 0 ? `${images}장` : '미상'} · 우리 글엔 사진이 없다 · "${ask}"`,
  }]
}

// ── 8. 잘린 원문 — 없는 결말 ──
const HANGUL_WORD_RE = /[가-힣]{2,}/g
const stemOf = (w: string): string => w.replace(PARTICLE_TAIL_RE, '').slice(0, 2)
const squash = (s: string): string => s.replace(/\s+/g, '')

/**
 * 🔴 **원문 끝이 끝맺지 못했다** — 끝 줄이 정본 `CLOSING_RE` 를 지나지 못한다. 한두 글자 조각(`야`)은
 *    앞 줄에 붙여 본다. 🔴 **수집 반복**(본문 일부가 두 번 캡처돼 두 번째가 중간에 끊김)은 잘림이 아니다 —
 *    끝 줄이 본문 앞쪽에 이미 있으면 뒤는 되풀이다(운영 cohort #6 · #10 · #22).
 */
function openTailOf(sourceBody: string): string | null {
  const lines = sourceBody.split(/\n+/).map((x) => x.trim()).filter((x) => /[가-힣]/.test(x))
  if (lines.length === 0) return null
  let tail = lines[lines.length - 1]!
  if ((tail.match(/[가-힣]/g) ?? []).length <= 2 && lines.length >= 2) {
    const prev = lines[lines.length - 2]!
    /**
     * 🔴 앞 줄이 이미 끝맺었으면 **문장 경계에서** 잘린 것이다 — 조각(`우`)에는 이어 받을 내용이 없다
     *    (cohort #3 `…아주 가끔 드십니다. 우`). 앞 줄이 끝맺지 못했을 때만 붙여 본다(#2 `…주니까 / 야`).
     */
    if (CLOSING_RE.test(prev.split(/(?<=[.!?？。])\s+/).pop() ?? prev)) return null
    tail = `${prev} ${tail}`
  }
  if (CLOSING_RE.test(tail)) return null
  const all = squash(sourceBody)
  const t = squash(tail)
  if (all.indexOf(t) < all.lastIndexOf(t)) return null
  /**
   * 🔴 **끝맺지 못한 마지막 절만** 본다 — 마지막 문장 경계 뒤, 여덟 어절까지. 긴 줄 통째(기사 캡처의
   *    `… 공유하기` 같은 화면 글자)를 끝으로 보면 초안의 아무 문장이나 겹친다(운영 기사 글 과차단).
   */
  const open = (tail.split(/(?<=[.!?？。])\s+/).pop() ?? tail).trim().split(/\s+/).slice(-8).join(' ')
  return open === '' ? null : open
}

function judgeTruncatedCompletion(title: string, body: string, ctx: DraftGateContext): LifeHit[] {
  const src = ctx.source
  if (src === null) return []
  const tail = openTailOf(src.body)
  if (tail === null) return []
  const tailStems = [...new Set((tail.match(HANGUL_WORD_RE) ?? []).map(stemOf).filter((s) => s.length === 2))]
  const known = squash(`${src.title}\n${src.body}`)
  // 🔴 원문 끝 절을 이어 받은 초안 문장 — 겹치는 어절이 가장 많은 한 문장(둘 이상 겹칠 때만)
  let best: { words: string[]; last: number; n: number } | null = null
  for (const s of `${title}\n${body}`.split(/(?<=[.!?？。])\s+|\n+/)) {
    const words = s.trim().split(/\s+/).filter((w) => w !== '')
    const hits = words.map((w, i) => (tailStems.some((st) => w.includes(st)) ? i : -1)).filter((i) => i >= 0)
    if (hits.length >= 2 && (best === null || hits.length > best.n)) best = { words, last: hits[hits.length - 1]!, n: hits.length }
  }
  if (best === null) return []
  // 🔴 그 문장이 원문 끝 뒤로 **원문에 없는 말**을 더 이었는가 — 원문이 멈춘 자리 뒤는 우리가 모른다
  const novel = best.words.slice(best.last + 1)
    .flatMap((w) => w.match(HANGUL_WORD_RE) ?? [])
    .filter((w) => !known.includes(stemOf(w)))
  if (novel.length === 0) return []
  return [{
    code: 'truncatedSourceCompletion', level: 'review',
    detail: `원문 끝 "${tail}" · 초안이 이어 붙인 말 "${novel.join(' ')}"`,
  }]
}

/**
 * 🔴 **원천·시점 대조 넷을 한 번에.** 카드가 없어도 돈다 — 카드와 무관한 축이다.
 */
export function judgeSourceContext(
  title: string, body: string, ctx: DraftGateContext,
): { hard: DraftLifeReview[]; review: DraftLifeReview[] } {
  const frames = readClauseFrames(title, body, OWNER_OPTS)
  const hits: LifeHit[] = [
    ...judgeStaleTime(frames, ctx),
    ...judgeExternalCommunity(frames, ctx),
    ...judgeLookAsk(title, body, ctx),
    ...judgeTruncatedCompletion(title, body, ctx),
  ]
  const fold = (level: 'hard' | 'review'): DraftLifeReview[] => {
    const by = new Map<DraftLifeReviewCode, string[]>()
    for (const h of hits.filter((x) => x.level === level)) by.set(h.code, [...(by.get(h.code) ?? []), h.detail])
    return [...by].map(([code, ds]) => ({ code, detail: [...new Set(ds)].slice(0, 3).join(' / ') }))
  }
  return { hard: fold('hard'), review: fold('review') }
}
