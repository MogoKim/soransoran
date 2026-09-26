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
 * 🔴 순수 함수다. DB · 네트워크 · 파일 IO 없음.
 */
import { readMediaDependency } from './evidence'
import { RELATION_NAMES } from './source-facts'
import type { PoolCard } from '../persona-pool-card'
import {
  CHILD_AGE_BANDS, judgeLifeHistory, readSelfChildBands, readSelfClaims,
  type ChildAgeBand, type PersonaForMatch, type PostRequirements, type SelfClaimAxis,
} from '../original-post-persona-match'

/**
 * 🔴 **순서가 곧 대표 사유의 우선순위다** — 여럿이 걸리면 결과도 이 순서로 나온다.
 *    카드와 **어긋나는 사실**(C)이 가장 구체적이고, 자료 의존(A)은 글 자체가 성립하지 않으며,
 *    허가 없는 1인칭(B)은 계약 위반이다. 사람이 먼저 봐야 할 것부터 적는다.
 */
export const DRAFT_GATE_CODES = [
  /** 🔴 카드의 지금 삶을 미래·과거로 말하거나 카드와 다른 지금 집안을 말한다 */
  'lifeStageTenseConflict',
  /** 🔴 우리 글에 없는 사진·첨부에 기댄다 */
  'mediaDependentDraft',
  /** 🔴 1인칭 허가(selfBasis) 없이 자기 생활사를 주장한다 */
  'unwarrantedSelfClaim',
] as const
export type DraftGateCode = (typeof DRAFT_GATE_CODES)[number]

export const DRAFT_GATE_LABEL: Readonly<Record<DraftGateCode, string>> = {
  mediaDependentDraft: '🔴 우리 글에 없는 사진·첨부에 기댄다 — 읽는 사람이 무엇을 보라는지 모른다',
  unwarrantedSelfClaim: '🔴 1인칭 허가 없이 글쓴이 자신의 가족·집안·일을 사실로 말한다',
  lifeStageTenseConflict: '🔴 Persona 의 지금 삶(자녀 나이대·집안)을 미래·과거로 말하거나 다르게 말한다',
}

export type DraftGateFailure = { code: DraftGateCode; detail: string }

/** 🔴 계획에서 필요한 칸만 — 정본 `SpeakerPlan` · artifact `plan` 둘 다 이 모양을 가진다 */
export type DraftGatePlan = {
  selfBasis: string | null
  warrants: readonly { fact: string }[]
}

/** 🔴 정본 카드에서 필요한 칸만 — v2 가 다시 정의하지 않는다 */
export type DraftGateCard = Pick<PoolCard, 'childrenCount' | 'childrenAgeBands' | 'maritalStatus'>

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
 * 🔴 **세 게이트를 한 번에.** 빈 배열이면 통과다.
 *    `plan` 이 없으면 B 를, `card` 가 없으면 C 를 **판정하지 않는다** — 모르는 것을
 *    결함으로 세지 않는다. 카드를 못 찾은 경우는 나이 판정(`judgeSelfAgeBasis`)이 이미 막는다.
 */
export function judgeDraftGates(input: {
  title: string
  body: string
  plan: DraftGatePlan | null
  card: DraftGateCard | null
}): DraftGateFailure[] {
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
  const claims = readSelfClaims(title, body)
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
    for (const m of readSelfChildBands(title, body)) {
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
