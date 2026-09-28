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
import { readMediaDependency } from './evidence'
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
  /** 🔴 우리 글에 없는 사진·첨부에 기댄다 */
  'mediaDependentDraft',
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
export const DRAFT_GATE_VERSION = 'draft-gates-v2'

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
}

export type DraftGateFailure = { code: DraftGateCode; detail: string }

/** 🔴 계획에서 필요한 칸만 — 정본 `SpeakerPlan` · artifact `plan` 둘 다 이 모양을 가진다 */
export type DraftGatePlan = {
  selfBasis: string | null
  /** 🔴 `evidenceText` 는 코드가 원문에서 확인한 근거 문장이다(`verifySelfWarrants`) — 원문 근거는 이것뿐이다 */
  warrants: readonly { fact: string; evidenceText?: string }[]
}

/**
 * 🔴 정본 카드에서 필요한 칸만 — v2 가 다시 정의하지 않는다.
 *    생활 일관성 칸(부부 관계 · 돌봄 · 갱년기 · noGo · 집안 구성)은 **없을 수 있다** — 없으면
 *    그 축에서 무엇이 걸렸을 때 통과시키지 않고 **사람 검토**로 보낸다(모르는 것 = 모호).
 */
export type DraftGateCard = Pick<PoolCard, 'childrenCount' | 'childrenAgeBands' | 'maritalStatus'>
  & Partial<Pick<PoolCard, 'spouseRelationship' | 'parentCare' | 'menopauseStatus' | 'noGoTopics' | 'household'>>

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
  const all = [...failures, ...life.hard]
  const rank = (c: DraftGateCode): number => DRAFT_GATE_CODES.indexOf(c)
  const hardCodes = new Set(all.map((f) => f.code))
  return {
    failures: [...all].sort((a, b) => rank(a.code) - rank(b.code)),
    reviews: life.review.filter((r) => !hardCodes.has(r.code)).sort((a, b) => rank(a.code) - rank(b.code)),
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
   */
  const claims = readSelfClaims(title, body, OWNER_OPTS)
  if (input.plan !== null && input.plan.selfBasis === null) {
    const warranted = new Set(input.plan.warrants.map((w) => w.fact))
    const bad = claims
      .filter((c) => !WARRANT_OF[c.axis].some((f) => warranted.has(f)))
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

function judgeChildren(title: string, body: string, frames: readonly ClauseFrame[], card: DraftGateCard): LifeHit[] {
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
    ...judgeCare(frames, all, card),
    ...judgeChildren(title, body, frames, card),
    ...judgeHealth(frames, plan, card),
  ]
  const fold = (level: 'hard' | 'review'): DraftLifeReview[] => {
    const by = new Map<DraftLifeReviewCode, string[]>()
    for (const h of hits.filter((x) => x.level === level)) by.set(h.code, [...(by.get(h.code) ?? []), h.detail])
    return [...by].map(([code, ds]) => ({ code, detail: [...new Set(ds)].slice(0, 3).join(' / ') }))
  }
  return { hard: fold('hard'), review: fold('review') }
}
