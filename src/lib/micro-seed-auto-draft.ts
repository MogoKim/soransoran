/**
 * 기계 초안 채택 판정 — 🔴 **사람의 ADOPT 를 사칭하지 않는다** (§4-AS)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AS
 *
 * AUTO_SEED 로 살아남은 소재에서 **템플릿 초안을 만들고**, 그중 하나를 고른다.
 * 초안 생성 자체는 기존 `expandSeed`(소재 사전 + 템플릿, LLM 아님)가 하고,
 * 이 파일은 **무엇을 채택할지**만 정한다.
 *
 * 🔴 **결정 값은 `AUTO_ADOPT` · `AUTO_HOLD` · `AUTO_DROP` 이다.**
 *    사람이 검수 화면에서 찍는 `ADOPT` · `SAVE` 와 한 글자도 겹치지 않는다.
 *    자동 발행(§4-AL)이 "사람이 고른 글" 이라는 전제 위에 서 있으므로,
 *    기계 채택이 같은 값으로 기록되면 **어느 글이 사람 손을 거쳤는지 알 수 없게 된다.**
 *
 * 🔴 **원천 하나당 최종 초안은 하나다.** 템플릿이 둘을 만들어도 하나만 남긴다 —
 *    같은 소재에서 나온 두 글이 연달아 나가면 결이 겹쳐 보인다(§4-AN 형제 검사와 같은 이유).
 */

import {
  judgeCopy, COPY_REASON_LABEL,
  type OriginalityMeasure, type CopyReason,
} from './draft-originality'
// 🔴 위해 축의 정본은 판정 단계다. 초안 단계가 목록을 따로 갖지 않는다
import { SEMANTIC_DROP, DRAFT_HARM_AXES } from './micro-seed-auto-judge'
// 🔴 위기 판정의 정본은 안전 신호 모듈 하나다 — 여기서 규칙을 다시 쓰지 않는다
import { judgeCrisisSignal } from './micro-seed-safety-signals'
import type { PersonaForMatch } from './original-post-persona-match'

export const AUTO_DRAFT_DECISIONS = ['AUTO_ADOPT', 'AUTO_HOLD', 'AUTO_DROP'] as const
export type AutoDraftDecision = (typeof AUTO_DRAFT_DECISIONS)[number]

/** 🔴 사람이 쓰는 값 — 기계가 내면 안 된다 */
export const HUMAN_DRAFT_DECISIONS = ['ADOPT', 'SAVE', 'REVISE', 'HOLD', 'DROP'] as const
export const HUMAN_DRAFT_PROVENANCE = ['human-curated', 'founder'] as const

// 🔴 v2 — 템플릿 + LLM fallback + semantic 품질 판정
// 🔴 v3 — 존댓말 · 실제 질문 검사 추가. v2 캐시와 섞이지 않는다
// 🔴 v5 — **판 값만 올리는 것으로는 부족했다** (2026-09-13).
//    v4 는 voiceSamples 를 새로 넣었는데 `draft-gen-v4` 를 그대로 뒀다.
//    cache key 가 판 값만 봤으므로 **말투 근거 없이 만든 옛 결과가 그대로 hit** 됐고,
//    반말을 막던 옛 품질 판정도 같은 이유로 재사용됐다.
//    이제 key 가 **실제 프롬프트와 실제 본문의 digest** 를 담는다 —
//    판 값을 올리는 것을 잊어도 프롬프트가 바뀌면 자동으로 miss 다.
// 🔴 v4 — **형식 강제를 걷어낸다** (2026-09-13).
//    v3 은 존댓말 · 2~4문장 · 마지막 물음표를 하드 게이트로 세웠다.
//    그 셋을 다 지키면 나오는 글은 한 종류뿐이다 — 실제로 한 종류만 나왔다.
//    말투와 길이와 맺음은 **원문이 정한다**(source-profile). 기계는 안전만 잰다.
//    독창성도 `6자 겹침` 에서 실질 복제 판정으로 바뀐다 → draft-originality.ts
export const DRAFT_RULE_VERSION = 'auto-draft-v5'
/**
 * 🔴 생성 프롬프트 판.
 *    v6 — **글쓴이의 나이대를 넘긴다** (2026-09-14). v5 는 나이를 보지 못해
 *    40대 후반 Persona 가 `우리 언니(30~32)` 라는 없는 관계를 지어냈다.
 *    🔴 v5 캐시를 재사용하지 않는다 — key 는 판 값과 **실제 프롬프트 digest** 를 함께 본다.
 */
export const DRAFT_PROMPT_VERSION = 'draft-gen-v6'
/**
 * 🔴 품질 판정 프롬프트 판 — **생성과 따로 센다**. 판정만 바뀔 때 생성을 다시 하지 않기 위해서다.
 *    v5 — 같은 `lifeConflict` 축에서 **나이·세대 모순**을 함께 본다. v4 캐시를 재사용하지 않는다.
 */
export const QUALITY_PROMPT_VERSION = 'draft-quality-v5'
/** 🔴 사람 것과 겹치지 않는다. 기계가 **만든** 글이라는 표시 */
export const DRAFT_PROVENANCE = 'machine-generated'
/** 초안을 어디서 만들었나 */
export const DRAFT_SOURCES = ['template', 'llm'] as const
export type DraftSource = (typeof DRAFT_SOURCES)[number]
/** 원천 하나당 만들 초안 상한 */
export const MAX_DRAFTS_PER_SOURCE = 2

/** 🔴 제품 금지어 — CLAUDE.md 규칙. 초안에 있으면 버린다 */
export const BANNED_WORDS: readonly string[] = ['시니어', '어르신', '노인', '실버'] as const

export type DraftReason =
  | 'ok'
  | 'noDraft' | 'emptyTitle' | 'emptyBody'
  | 'safetyNotPass' | 'bannedWord' | 'copiedFromSource'
  | 'duplicateTitle' | 'duplicateBody'
  | 'sourceAlreadyUsed'
  | 'notAutoSeed' | 'laneRisk'
  | 'titleEchoedInBody' | 'genericWithoutSourceAngle'
  | 'semanticUnavailable' | 'semanticHold' | 'semanticDrop' | 'lowConfidence'
  | 'qualitySchemaMismatch'
  /** 🔴 다 쓴 글이 그 Persona 의 삶과 명백히 어긋난다 — 다시 써도 그대로였다 */
  | 'lifeHistoryConflict' | 'generatedHarm'

export const DRAFT_REASON_LABEL: Record<DraftReason, string> = {
  lifeHistoryConflict: '글쓴이의 삶과 어긋나는 1인칭 경험',
  ok: '통과',
  noDraft: '템플릿이 초안을 만들지 못했다 (소재를 못 찾음)',
  emptyTitle: '제목이 비었다',
  emptyBody: '본문이 비었다',
  safetyNotPass: 'safety 가 pass 가 아니다',
  bannedWord: '🔴 금지어가 들어갔다 (시니어 · 어르신 · 노인 · 실버)',
  copiedFromSource: '🔴 원문을 실질적으로 옮겼다',
  duplicateTitle: '같은 제목이 이미 있다',
  duplicateBody: '같은 본문이 이미 있다',
  sourceAlreadyUsed: '이 원천에서 이미 하나를 골랐다',
  notAutoSeed: '🔴 AUTO_SEED 가 아니다 — 판정을 통과한 소재만 초안화한다',
  laneRisk: '🔴 위해 판정이 남아 있다 (개인 특정 · 명예훼손 · 위협 · 위험한 의료 지시 · 정치 선동)',
  titleEchoedInBody: '🔴 제목을 본문 끝에 그대로 되풀이한다',
  genericWithoutSourceAngle: '🔴 소재가 사라진 일반론이다',
  semanticUnavailable: '품질 판정을 받지 못했다',
  semanticHold: '품질 판정이 사람에게 넘겼다',
  semanticDrop: '🔴 품질 판정이 버리라고 했다',
  lowConfidence: '모델이 확신하지 못했다',
  qualitySchemaMismatch: '🔴 품질 판정이 우리 축이 아닌 이름만 돌려줬다 — 다시 물어도 같았다',
  generatedHarm: '🔴 생성된 글에 위해가 있다 (개인 특정 · 명예훼손 · 위협 · 위험한 의료 지시)',
}

/** 왜 복제로 봤는지 한 줄 — 🔴 사유 이름을 여기서 다시 적지 않는다 */
export const copyReasonLabel = (r: CopyReason): string => COPY_REASON_LABEL[r]

/**
 * 🔴 판정 단계에서 이 위험이 붙었으면 초안화하지 않는다.
 *
 * 🔴 **소재가 아니라 위해다** (2026-09-13). 목록의 정본은 `micro-seed-auto-judge` 의
 *    `SEMANTIC_DROP` 이다 — 여기서 다시 적으면 두 단계의 기준이 갈라진다.
 *    실제로 갈라져 있었다: judge 는 연예 소재를 HOLD 로 보존했는데
 *    draft 는 같은 축을 DROP 으로 버렸다.
 */
export const BLOCKING_RISKS: readonly string[] = SEMANTIC_DROP

export type DraftCandidate = {
  sourceArticleId: string
  draftNo: number
  title: string
  body: string
  safetyVerdict: string
  /** 🔴 원문과 얼마나 겹치는지 **잰 값**. 통과선은 draft-originality.ts 가 갖는다 */
  originality: OriginalityMeasure
  generatedAt: string
}

export type Judgement = {
  sourceArticleId: string
  decision: string
  semanticRisks?: readonly string[]
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 공백을 지운 비교용 문자열 — 같은 글을 띄어쓰기만 바꿔 두 번 내지 않는다 */
export function normalize(s: string): string {
  return S(s).replace(/\s+/g, '')
}

/**
 * 🔴 **제목·본문 일치를 낱말 포함으로 재지 않는다** (2026-09-13 제거).
 *
 *    옛 `titleMatchesBody` 는 "소재 낱말이 제목과 본문 양쪽에 **문자열로** 있는가" 를 봤다.
 *    같은 이야기를 다른 말로 풀면 — 사람이 늘 그렇게 쓴다 — 이 검사는 떨어진다.
 *    실측(2026-09-11~12)에서 초안 최종 HOLD 15건 중 7건이 이 사유였고,
 *    읽어 보면 제목과 본문이 어긋난 글이 아니었다.
 *    제목·본문이 정말 다른 이야기인지는 품질 축 `titleBodyCoherence` 가 본다.
 */

/**
 * 🔴 **제목 낱말 반복을 하드 게이트로 막지 않는다** (2026-09-13 제거).
 *
 *    "여행 가면 여행 어떻게 고르세요?" 같은 템플릿 사고를 막으려고 넣은 것인데,
 *    사람이 쓴 자연스러운 제목도 낱말을 되풀이한다("김치 담글 때 김치통 뭐 쓰세요").
 *    어색한 되풀이인지 아닌지는 품질 축 `repetitiveWording` 이 본다.
 */

/**
 * 🔴 **제목을 본문 끝에 그대로 되풀이하는가.**
 *
 * 템플릿이 "…? 다들 어떠세요?" 처럼 제목을 본문 마지막에 붙이면
 * 같은 문장을 두 번 읽게 된다.
 */
export function echoesTitleAtEnd(title: string, body: string): boolean {
  const t = normalize(title).replace(/[?!.]$/, '')
  if (t.length < 6) return false
  const tail = normalize(body).slice(-Math.max(t.length + 10, 20))
  return tail.includes(t)
}

/**
 * 🔴 **말투·맺음을 기계가 강제하지 않는다** (2026-09-13 제거).
 *
 *    v3 은 세 가지를 하드 게이트로 세웠다 —
 *      · `hasInformalSpeech`  본문 모든 문장이 존댓말 종결이어야 한다
 *      · `endsWithQuestion`   본문 마지막 글자가 물음표여야 한다
 *      · 생성 프롬프트의 "본문 2~4문장"
 *    셋을 동시에 지키면 나올 수 있는 글은 한 종류뿐이다.
 *    그리고 실제로 한 종류만 나왔다 — 그것이 "AI 티" 의 정체였다.
 *
 *    커뮤니티에는 반말도 있고, 존댓말과 반말이 섞인 글도 있고,
 *    묻지 않고 그냥 털어놓고 끝나는 글도 있다. 그게 사람이 쓴 게시판이다.
 *    **무엇으로 닫을지는 원문이 정한다** — `source-profile.ts` 의 `closingIntent`.
 *
 * 🔴 대신 남긴 것: 개인정보 · 금지어 · 실질 복제 · 안전성. 그것이 전부다.
 */

export function hasBannedWord(text: string): boolean {
  return BANNED_WORDS.some((w) => text.includes(w))
}

/** 🔴 초안 품질 축 — auto-judge 의 위험 축과 **분리돼 있다** (거기는 소재, 여기는 글) */
/**
 * 🔴 **선택된 Persona 의 생활사** — 생성과 검수가 **같은 것**을 본다 (2026-09-13).
 *
 *    정본은 Pool 카드다(`persona-pool-card.parsePoolDoc` → `cardToPersona`).
 *    여기서 복제본을 만들지 않는다 — 기존 `PersonaForMatch` 에서 필요한 칸만 고른다.
 *
 * 🔴 **왜 필요한가.** 원문에서 생활사를 읽어 후보를 좁히는 방식(`readPostRequirements`)은
 *    한국어의 생략 때문에 반드시 샌다. `어제 남편이 늦게 들어왔어요` 에는 임자가 없어
 *    조건이 서지 않는다. 그리고 발행 직전 `hardFilter` 는 **같은 함수의 출력**을 받으므로
 *    거기서 다시 잡히지도 않는다 — "발행 때 걸린다" 는 말은 사실이 아니었다.
 *    막을 수 있는 자리는 하나뿐이다: **글을 쓰는 사람에게 자기가 누구인지 알려 주는 것**,
 *    그리고 **다 쓴 글이 그 사람의 삶과 어긋나는지 보는 것**.
 */
// 🔴 이 파일에는 `Pick` 이라는 지역 타입이 따로 있다 — 내장 `Pick` 을 쓸 수 없다.
//    그래서 필요한 칸만 **`PersonaForMatch` 의 필드 타입 그대로** 적는다 (복제 상수 아님).
export type PersonaLifeHistory = {
  code: PersonaForMatch['code']
  /** 🔴 나이대 — Pool 카드/운영 Persona 의 기존 정본 값이다. 새 상수를 만들지 않는다 */
  ageBand?: PersonaForMatch['ageBand']
  maritalStatus?: PersonaForMatch['maritalStatus']
  childrenCount?: PersonaForMatch['childrenCount']
  childrenAgeBands?: PersonaForMatch['childrenAgeBands']
  parentCare?: PersonaForMatch['parentCare']
  menopauseStatus?: PersonaForMatch['menopauseStatus']
  /**
   * 🔴 **직업 — 안 넘겨서 지킬 수 없는 지시가 됐다** (2026-09-17 실측).
   *
   *    프롬프트는 *"직업 · 사는 곳 · 병력 · 가족 구성은 지어내지 않습니다"* 라고 하면서
   *    **직업을 알려주지 않았다.** 소재가 직장 이야기면 모델은 버리거나 지어낼 수밖에 없는데,
   *    바로 위 줄이 *"소재를 버리지 말고 자리를 바꿔 씁니다"* 다 — 양쪽을 다 지킬 수 없다.
   *    실측: 카드가 `은퇴` 인 P14 가 *"우리 직장도 그런데"* 를 쓰고 그대로 통과했다.
   */
  workStatus?: PersonaForMatch['workStatus']
  /** 🔴 사는 곳 — `우리 지역` 류 1인칭 진술의 근거다. 같은 이유로 넘긴다 */
  region?: PersonaForMatch['region']
  /**
   * 🔴 **형편 — 생활사 *참고*다. 본문에 드러내지 않는다** (창업자 지정).
   *
   *    그래서 `lifeHistoryLines` 에 **넣지 않는다.** 그 줄은 검수도 함께 읽는데,
   *    검수는 글에 쓰지 않은 형편이 맞는지 확인할 방법이 없다 — 없는 것을 근거로 막게 된다.
   *    생성 쪽 참고 줄(`lifeReferenceLines`)로만 간다.
   */
  economicStatus?: PersonaForMatch['economicStatus']
  /** 🔴 카드가 정한 회피 **소재**. 표현(말버릇)이 아니다 — `PoolCard.noGoTopics` 그대로다 */
  noGoTopics?: PersonaForMatch['noGoTopics']
}

/**
 * 🔴 사람이 읽는 문장으로 — 생성 프롬프트와 검수 프롬프트가 **같은 줄**을 본다
 *
 * 🔴 **여기 있는 것은 검수도 확인할 수 있는 사실뿐이다.** 형편·회피 소재는 들어가지 않는다 —
 *    형편은 본문에 드러내지 않기로 한 값이고, 회피 소재는 사실이 아니라 지시다.
 *    둘을 여기 넣으면 검수가 *글에 없는 것*을 근거로 충돌을 세운다.
 */
export function lifeHistoryLines(p: PersonaLifeHistory): string[] {
  const kids = p.childrenCount ?? null
  const bands = p.childrenAgeBands ?? null
  return [
    // 🔴 **맨 앞이다.** 뒤에 두면 모델이 혼인·자녀만 맞추고 나이를 흘린다(실측 결함)
    `- 나이대: ${p.ageBand ?? '알려지지 않음'}`,
    `- 혼인: ${p.maritalStatus ?? '알려지지 않음'}`,
    `- 자녀: ${kids === null ? '알려지지 않음' : kids === 0 ? '없음'
      : `${kids}명${bands !== null && bands.length > 0 ? ` (${[...new Set(bands)].join(' · ')})` : ''}`}`,
    `- 부모 돌봄: ${p.parentCare ?? '알려지지 않음'}`,
    `- 갱년기: ${p.menopauseStatus ?? '알려지지 않음'}`,
    `- 하는 일: ${p.workStatus ?? '알려지지 않음'}`,
    `- 사는 곳: ${p.region ?? '알려지지 않음'}`,
  ]
}

/**
 * 🔴 **생성 쪽만 보는 참고 줄** — 검수는 읽지 않는다.
 *
 *    형편은 글에 **드러내지 않기로** 한 값이다(창업자 지정). 그래서
 *    ① 생성에는 배경으로 주고 ② 본문에 쓰지 말라고 못박고 ③ 검수에는 주지 않는다.
 *    검수에 주면 "형편이 안 드러났다" 를 충돌로 셀 길이 생긴다 — 그건 거꾸로다.
 *
 * 🔴 **막는 것은 "내 형편을 말하는 것" 하나다** (2026-09-17 보정).
 *
 *    앞선 판은 여기서 *"금액·수입·재산을 적지 않습니다"* 라고 **모든 Persona 에게**
 *    말했다. 그러면 장 본 값 · 생활비 · 물가 이야기가 통째로 막힌다 —
 *    그것은 우리 고객이 실제로 쓰는 이야기이고 `NORTH-STAR.md` 가 허용한 소재다.
 *    카드의 `여유` · `빠듯` 은 **그 사람을 설명하는 말**이지 금액 금지령이 아니다.
 *
 *    금액 자체를 피해야 하는 사람은 **그 카드의 `noGoTopics` 가 말한다**
 *    (P03 · P10 · P16 의 `금액 언급`). 그 판단은 `noGoAvoidLines` 가 한다 —
 *    여기서 일괄로 걸면 카드마다 다른 규칙이 한 줄로 뭉개진다.
 */
export function lifeReferenceLines(p: PersonaLifeHistory): string[] {
  const e = (p.economicStatus ?? '').trim()
  if (e === '') return []
  return [
    `🔴 **형편(참고): ${e}** — 배경으로만 압니다.`,
    '   **자기 형편을 본문에 드러내지 않습니다.** "우리는 여유가 있어서" ·',
    '   "형편이 빠듯해서" 처럼 **자기 살림살이를 밝히는 말**을 쓰지 않습니다.',
    '   수입·재산 규모를 밝히지 않습니다. 고르는 소재와 말의 결에만 남습니다.',
    '',
    '   🔴 **돈 이야기를 못 한다는 뜻이 아닙니다.** 다음은 전부 자연스럽습니다 —',
    '    · 장 본 값 · 물가 · 생활비 · 요금제 · 중고 거래 값 · 가격 비교',
    '    · "얼마쯤 하나요" 하고 묻는 글 · 남의 지출 이야기를 읽고 드는 생각',
    '   (단, 아래 「피하는 소재」에 금액이 적혀 있으면 그 사람은 금액을 피합니다.)',
  ]
}

/**
 * 🔴 **카드가 정한 회피 소재** — 생성 쪽만 본다.
 *
 *    `PoolCard.noGoTopics` 는 소재 목록이다(`남의 형편 비교` · `금액 언급` · `이혼 권유`).
 *    발행 쪽 `hardFilter` 는 이것을 **글자 그대로 포함하는지**만 보므로(`all.includes`)
 *    다른 말로 풀어 쓰면 통과한다 — 막을 수 있는 자리는 **쓰기 전** 하나뿐이다.
 *
 * 🔴 **소재를 통째로 막지 않는다.** 그 소재로 글을 쓰지 말라는 것이지,
 *    그 낱말이 스치기만 해도 버리라는 뜻이 아니다.
 */
export function noGoAvoidLines(p: PersonaLifeHistory): string[] {
  const topics = (p.noGoTopics ?? []).map((x) => x.trim()).filter((x) => x !== '')
  if (topics.length === 0) return []
  return [
    `🔴 **이 사람이 피하는 소재**: ${topics.join(' · ')}`,
    '   이 소재를 글의 중심으로 삼지 않습니다. 스치듯 지나가는 것까지 막지는 않습니다.',
    /**
     * 🔴 **이 목록은 카드마다 다르다** (2026-09-17). 여기 `금액 언급` 이 있는 사람만
     *    금액을 피한다. 없는 사람은 장 본 값도 생활비도 그대로 쓴다 —
     *    형편(`여유`·`빠듯`)은 금액 금지령이 아니다.
     */
    '   🔴 위 목록에 **금액이 있으면 이 사람만** 금액을 피합니다.',
    '      목록에 없으면 「형편(참고)」가 무엇이든 값·생활비 이야기를 그대로 씁니다.',
  ]
}

/**
 * 🔴 **근거는 글에 실제로 있어야 한다** (2026-09-13).
 *
 *    옛 판은 `conflict=true` 와 빈 문자열이 아닌 `evidence` 만 보면 막았다.
 *    모델이 초안에 없는 문장을 지어내도 그것이 차단 근거가 됐다 —
 *    실측: 초안이 `오늘 김치를 담갔어요` 여도 `"우리 남편이 어제 술 먹고"` 라는
 *    지어낸 근거로 `lifeHistoryConflict` 가 섰다.
 *
 * 🔴 **공백과 흔한 문장부호만 턴다.** 그 이상 손대면 서로 다른 문장이 같아진다.
 */
export function evidenceFoundIn(evidence: string, draftText: string): boolean {
  const flat = (x: string): string => x.replace(/\s+/g, '')
    .replace(/[.,!?;:'"()\[\]{}·…~\-—‘’“”`]/g, '')
  const e = flat(evidence)
  return e !== '' && flat(draftText).includes(e)
}

/** 🔴 다 쓴 글이 그 사람의 삶과 **명백히** 어긋나는가 — 근거를 함께 받는다 */
export type LifeConflict = { conflict: boolean; evidence: string }

/**
 * 🔴 **나이 검수를 따로 부르고, 결과는 같은 칸에 합친다** (2026-09-14).
 *
 *    🔴 왜 큰 품질 프롬프트에 넣지 않는가 — **넣어 봤고 안 됐다.**
 *       실측 결함(`우리 언니가 그 나이대에… 서른 하나 둘` · P03 40대 후반)을
 *       기준만 적었을 때도, 세는 순서를 적었을 때도 모델이 **2/2 통과**시켰다.
 *       프롬프트가 길어질수록 뒤에 붙인 지시는 묻히고 토큰만 는다.
 *
 *    🔴 그래서 **짧고 집중된 호출 하나**를 따로 둔다. 그 호출은 나이·가족·세대만 본다.
 *       결과는 **새 축이 아니라** 기존 `lifeConflict` 칸에 합쳐진다 —
 *       판정·재생성·HOLD 경로는 하나 그대로다.
 *
 * 🔴 **둘 중 하나라도 근거가 확인된 충돌이면 충돌이다.** 근거 없는 주장은 세지 않는다
 *    (`applyQuality` 가 `evidence !== ''` 를 요구하는 계약 그대로다).
 */
/**
 * 🔴 **나이 검수 모델 실측 — 통과한 모델이 없다** (2026-09-14).
 *
 *    같은 집중 프롬프트로 세 모델을 같은 결함·허용 경계에 걸었다.
 *    합격선은 **결함 3/3 검출 + 허용 3/3 통과**였고, **아무도 넘지 못했다.**
 *
 *      claude-haiku-4.5   결함 1/3 · 허용 3/3
 *      gpt-5-mini         결함 0/3 · 허용 3/3
 *      gemini-3.7-flash   결함 2/3 · 허용 3/3   ← 가장 나았지만 합격은 아니다
 *
 *    세 모델이 **공통으로 놓친 것**은 실측 결함 그 자체다 —
 *    `우리 언니가 요즘 그 나이대에 결혼 준비 중` (나이는 제목의 `30 32` 를 받는 지시어).
 *
 * 🔴 **그래서 프롬프트를 더 덧붙이지 않는다.** 두 번 덧붙였고 두 번 다 통과되지 않았다.
 *    길이를 늘리면 토큰만 늘고 뒤에 붙인 지시는 묻힌다.
 */
export const AGE_CHECK_MODEL_TRIAL = Object.freeze({
  ranAt: '2026-09-14',
  bar: '결함 3/3 검출 + 허용 3/3 통과',
  results: Object.freeze([
    Object.freeze({ model: 'claude-haiku-4.5', defects: 1, allows: 3 }),
    Object.freeze({ model: 'gpt-5-mini', defects: 0, allows: 3 }),
    Object.freeze({ model: 'gemini-3.7-flash', defects: 2, allows: 3 }),
  ]),
})

/** 🔴 합격한 모델이 없다. `null` 은 "아직 고르지 않았다" 가 아니라 **"없다"** 다 */
export const AGE_CHECK_QUALIFIED_MODEL: string | null = null

/**
 * 🔴 **그러므로 기계 생성 글은 자동 발행 전에 사람이 본다.**
 *
 *    나이 검수 호출은 **보조 탐지**다 — 게이트가 아니다.
 *    잡으면 재생성으로 잇고(기존 `lifeConflict` 경로), 못 잡아도 통과시키는 것이
 *    아니라 **사람 승인 단계가 남아 있다**는 뜻이다.
 *
 * 🔴 이 값은 새 차단 축이 아니다. 운영자가 읽는 **사실 기록**이고,
 *    러너가 회차마다 이 문장을 찍는다.
 */
export const MACHINE_AGE_HUMAN_REVIEW_REQUIRED = true
export const MACHINE_AGE_HUMAN_REVIEW_NOTE =
  '🔴 나이·세대 모순을 3/3 잡는 모델이 없다(2026-09-14 실측). 나이 검수는 보조 탐지이고,'
  + ' 기계 생성 글은 **자동 발행 전 사람 확인**이 필요하다.'

export function mergeLifeConflict(
  base: LifeConflict | null,
  age: LifeConflict | null,
): LifeConflict | null {
  const real = (x: LifeConflict | null): boolean => x !== null && x.conflict && x.evidence !== ''
  if (real(base)) return base
  if (real(age)) return age
  // 🔴 둘 다 충돌이 아니다 — **판정을 받은 쪽**을 남긴다. 둘 다 없으면 null(모른다)
  return base ?? age
}

/** 🔴 schema 불일치 사유 — 콘텐츠 결함이 아니라 **답을 못 받은 것**이다 */
export const LIFE_CONFLICT_MISSING = 'lifeConflict:missing'
export const LIFE_EVIDENCE_NOT_FOUND = 'lifeConflict:evidenceNotFound'

export const DRAFT_QUALITY_AXES = [
  // 🔴 `informalSpeech` · `answerableQuestion` 을 뺐다 (2026-09-13).
  //    반말도 우리 게시판의 말이고, 묻지 않고 끝나는 글도 게시판 글이다.
  //    그 둘을 축으로 두면 모델이 매번 같은 모양으로 수렴한다.
  'naturalKorean',
  'titleBodyCoherence',
  'communityFit4050',
  'repetitiveWording',
  'genericWithoutSourceAngle',
  'medicalOrConflictRisk',
] as const
export type DraftQualityAxis = (typeof DRAFT_QUALITY_AXES)[number]

/**
 * 🔴 **품질 프롬프트를 이 표에서 만든다** (2026-09-13).
 *
 *    옛 판은 프롬프트 문자열과 축 목록이 **따로** 있었다. 그래서 축에서
 *    `informalSpeech` · `answerableQuestion` 을 뺐는데 프롬프트는 그대로 남아,
 *    모델이 프롬프트가 시킨 대로 `informalSpeech` 를 돌려주면
 *    parser 가 그것을 `genericWithoutSourceAngle` 로 바꿔 HOLD 시켰다.
 *    **반말 허용이 코드에만 있고 실제 경로에는 없었다.**
 *
 *    이제 프롬프트는 이 표를 순회해 만든다. 사람이 두 목록을 따로 적을 자리가 없다.
 */
export const DRAFT_QUALITY_AXIS_PROMPT: Record<DraftQualityAxis, string> = {
  naturalKorean: '한국어가 어색하다 · 번역투 · 기계가 쓴 티가 난다',
  titleBodyCoherence: '제목과 본문이 **정말로** 다른 이야기다 (말만 다르게 푼 것은 해당하지 않는다)',
  communityFit4050: '40~60대 여성이 읽을 이야기가 아니다',
  repetitiveWording: '같은 말이 **읽기 어려울 만큼** 되풀이된다',
  genericWithoutSourceAngle: '소재가 사라진 일반론이다 — 어떤 글을 읽고 썼는지 알 수 없다',
  medicalOrConflictRisk: '약 · 용량 · 진단 · 치료를 **확정적으로 지시**한다 (경험담은 해당하지 않는다)',
}

/** 🔴 이게 붙으면 버린다 */
export const QUALITY_DROP: readonly DraftQualityAxis[] = ['medicalOrConflictRisk'] as const
/** 🟡 이게 붙으면 사람에게 넘긴다 — 글이 나빴을 뿐 소재는 살아 있다 */
export const QUALITY_HOLD: readonly DraftQualityAxis[] = [
  'naturalKorean', 'titleBodyCoherence', 'communityFit4050',
  'repetitiveWording', 'genericWithoutSourceAngle',
] as const

export const DRAFT_MIN_CONFIDENCE = 0.7

export type DraftQualityVerdict = {
  /** 🔴 선택 Persona 의 생활사와 어긋나는가 — 검수 프롬프트가 함께 답한다 */
  lifeConflict: LifeConflict | null
  decision: AutoDraftDecision
  confidence: number
  issues: DraftQualityAxis[]
  /**
   * 🔴 **우리 축이 아닌 이름.** 판정에 쓰지 않고 **그대로 드러낸다** (2026-09-13).
   *
   *    옛 판은 이것을 `genericWithoutSourceAngle` 로 바꿨다. 그래서
   *    모델이 `informalSpeech` 라고 답하면 화면에는 "소재가 사라진 일반론" 이 찍혔다 —
   *    사람이 로그를 읽어도 진짜 이유를 알 수 없었고, 반말 초안이 조용히 막혔다.
   *    schema 불일치는 schema 불일치로 남긴다.
   */
  unknownIssues: string[]
  /**
   * 🔴 **생성된 글 자체의 위해** (2026-09-13).
   *
   *    판정 단계(`auto-judge`)는 **원문**의 위해를 본다. 그런데 모델은
   *    원문에 없던 것을 지어낼 수 있다 — 실측(재현)에서
   *    "확인 안 된 불륜 단정" 과 "비공개 개인 특정" 이 `safetyFilter` 를 그대로 통과해
   *    `AUTO_ADOPT` 까지 갔다. deterministic 정규식만으로는 못 잡는다.
   *
   * 🔴 **새 안전 목록을 만들지 않는다.** 축 이름은 `SEMANTIC_DROP` 정본 그대로다.
   */
  harms: string[]
}

/**
 * 모델 응답을 읽는다 — 🔴 **모르는 것은 통과가 아니다.**
 */
/**
 * 🔴 검수 응답을 **무엇을 물었는지와 함께** 읽는다 (2026-09-13).
 *    Persona 를 넘겨 물었으면 `lifeConflict` 는 **필수 답**이다.
 *    빠졌거나 형식이 다르면 "충돌 없음" 이 아니라 **schema 불일치** 다 —
 *    물어본 적 없는 것처럼 통과시키지 않는다.
 */
export type QualityAskContext = {
  /** 이 글을 쓴 사람의 생활사. 넘겼으면 `lifeConflict` 를 반드시 받아야 한다 */
  persona?: PersonaLifeHistory
  /** 판정 대상 초안 — 🔴 근거가 **이 글에** 있는지 대조한다 */
  draftText?: string
}

export function parseQuality(rawText: string, ctx: QualityAskContext = {}): DraftQualityVerdict | null {
  let j: Record<string, unknown>
  try {
    const t = rawText.trim()
    j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
  } catch { return null }
  const d = String(j.decision ?? '')
  if (!(AUTO_DRAFT_DECISIONS as readonly string[]).includes(d)) return null
  const c = Number(j.confidence ?? NaN)
  if (!Number.isFinite(c) || c < 0 || c > 1) return null
  const raw = Array.isArray(j.issues) ? j.issues.map(String)
    : Array.isArray(j.axes) ? j.axes.map(String) : []
  const issues: DraftQualityAxis[] = []
  const unknownIssues: string[] = []
  for (const x of raw) {
    // 🔴 **모르는 축을 다른 축으로 바꾸지 않는다.** 축은 우리가 정한다 —
    //    우리 축이 아닌 이름은 판정 근거가 아니고, 그렇다고 숨기지도 않는다
    if ((DRAFT_QUALITY_AXES as readonly string[]).includes(x)) issues.push(x as DraftQualityAxis)
    else unknownIssues.push(x)
  }
  // 🔴 위해 축은 **판정 단계 정본**으로만 읽는다. 모르는 이름은 위해로 세지 않는다
  const rawHarm = Array.isArray(j.harms) ? j.harms.map(String) : []
  // 🔴 안전 신호 축도 **정상 사유**로 읽는다 — 모르는 이름으로 밀어내지 않는다 (2026-09-16)
  const harms = rawHarm.filter((x) => (DRAFT_HARM_AXES as readonly string[]).includes(x))
  const unknownHarm = rawHarm.filter((x) => !(DRAFT_HARM_AXES as readonly string[]).includes(x))
  // 🔴 **모르면 null 이다.** 모델이 답하지 않은 것을 "충돌 없음" 으로 읽지 않는다
  const lc = j.lifeConflict
  let lifeConflict: LifeConflict | null =
    lc !== null && typeof lc === 'object' && typeof (lc as Record<string, unknown>).conflict === 'boolean'
      ? {
          conflict: (lc as { conflict: boolean }).conflict,
          evidence: String((lc as Record<string, unknown>).evidence ?? '').trim(),
        }
      : null
  // 🔴 Persona 를 넘겨 물었는데 답이 없다 — 판정을 받은 것이 아니다
  if (ctx.persona !== undefined && lifeConflict === null) {
    unknownIssues.push(LIFE_CONFLICT_MISSING)
  }
  /**
   * 🔴 **지어낸 근거로 막지 않는다.** 초안에 없는 문장은 판정 근거가 아니다.
   *    콘텐츠 사유(`lifeHistoryConflict`)로 둔갑시키지 않고 schema 불일치로 남긴다 —
   *    `askQuality` 가 형식을 한 번 다시 일러 주고, 그래도 없으면 기술적 HOLD 다.
   */
  if (lifeConflict !== null && lifeConflict.conflict && ctx.draftText !== undefined
    && !evidenceFoundIn(lifeConflict.evidence, ctx.draftText)) {
    unknownIssues.push(LIFE_EVIDENCE_NOT_FOUND)
    lifeConflict = { conflict: false, evidence: '' }
  }
  return {
    lifeConflict,
    decision: d as AutoDraftDecision, confidence: c,
    issues: [...new Set(issues)],
    unknownIssues: [...new Set([...unknownIssues, ...unknownHarm])],
    harms: [...new Set(harms)],
  }
}

/**
 * 품질 판정을 결정으로 옮긴다 — 🔴 **정책이 모델 답을 이긴다** (§4-AR 과 같은 원칙).
 *
 * 모델이 통과라 해도 축이 붙어 있으면 통과가 아니고,
 * 모델이 버리라 해도 버릴 축이 없으면 사람에게 넘긴다.
 */
/**
 * 품질 판정을 결정으로 옮긴다 — 🔴 **정책이 모델 답을 이긴다**.
 *
 * 🔴 **모르는 축을 통과시키지 않는다** (2026-09-13 정정).
 *
 *    앞선 판은 모르는 축을 **다른 품질 사유로 바꿨고**(둔갑), 그것을 고치면서
 *    이번에는 **무시**했다 — 그래서 `issues: ["bannedTopic"]` 만 온 응답이
 *    `AUTO_ADOPT/ok` 까지 갔다. 둘 다 틀렸다.
 *    schema 불일치는 **schema 불일치로 막는다.** 콘텐츠 결함으로 위장하지 않는다.
 *    다시 물어보는 것은 부르는 쪽(`askQuality`)이 한 번만 한다.
 */
/**
 * 🔴 **생활사 재생성이 실제로 확인됐는가** — 집계 정본 (2026-09-13).
 *
 *    옛 판은 `verdict !== null` 이면 확인한 것으로 쳤다. 그래서
 *    `lifeConflict` 가 빠졌거나(schema 불일치) 모델이 근거를 지어낸 결과까지
 *    **"고쳐졌다"(fixed)** 로 셌다 — 확인한 적이 없는 것을 성공으로 보고한 것이다.
 *
 * 🔴 **이것은 집계일 뿐 채택 판정이 아니다.** 채택은 `applyQuality` 가
 *    지금처럼 fail-closed 로 막는다. 여기서는 "생활사가 풀렸는지" 만 센다 —
 *    생활사가 풀렸어도 위해·품질로 HOLD 되는 글은 있다. 두 숫자를 섞지 않는다.
 */
export type LifeRetryOutcome = 'fixed' | 'held' | 'unverified'

/**
 * 🔴 **생활사 축 하나만 읽는다** — `applyQuality` 를 부르지 않는다 (2026-09-14).
 *
 *    `applyQuality` 는 **위해를 먼저** 돌려준다. 그래서 위해가 함께 있는
 *    명백한 생활사 충돌이 `generatedHarm` 으로 덮여 집계에서 `unverified` 가 됐다 —
 *    확인한 것을 확인 못 한 것으로 센 셈이다. 채택 판정과 축별 집계는 다른 일이다.
 */
const lifeAxisOf = (v: DraftQualityVerdict): 'clear' | 'conflict' | 'unknown' => {
  // 🔴 생활사 축의 schema 문제 — 답이 없거나 근거가 초안에 없었다
  if (v.lifeConflict === null) return 'unknown'
  if (v.unknownIssues.includes(LIFE_CONFLICT_MISSING)) return 'unknown'
  if (v.unknownIssues.includes(LIFE_EVIDENCE_NOT_FOUND)) return 'unknown'
  return v.lifeConflict.conflict ? 'conflict' : 'clear'
}

export function judgeLifeRetry(
  verdicts: readonly (DraftQualityVerdict | null)[],
): LifeRetryOutcome {
  const axes = verdicts.filter((v): v is DraftQualityVerdict => v !== null).map(lifeAxisOf)
  // ① 하나라도 **명시적으로** "어긋나지 않았다" 를 받았으면 풀린 것이다
  if (axes.includes('clear')) return 'fixed'
  // ② 유효하게 판정받은 것이 있고, 그것들이 전부 근거 확인된 충돌이면 막힌 것이다
  //    🔴 위해·품질 축은 여기 끼어들지 않는다. 채택은 `applyQuality` 가 따로 막는다
  const judged = axes.filter((a) => a !== 'unknown')
  if (judged.length > 0 && judged.every((a) => a === 'conflict')) return 'held'
  // ③ 그 밖은 전부 **확인하지 못한 것**이다 —
  //    응답 없음 · lifeConflict 누락 · 지어낸 근거 · 생활사 schema 불일치
  return 'unverified'
}

/**
 * 🔴 **한 원천에 대해 생성을 시작해도 되는가** — 순수 판정 (2026-09-16).
 *
 *    정본 §4 는 위기 소재를 **④ Draft Generation 을 시작하지 않는다** 로 못박았다.
 *    러너는 이 함수를 **생성 캐시 조회보다도 먼저** 부른다 — 그래야 옛 AUTO 판정이나
 *    캐시가 있어도 새 안전 검사를 건너뛰지 못한다.
 */
export type SourceGate = { generate: boolean; reason: 'crisisSignal' | null }
export function judgeSourceGate(input: { title: string; bodyHead: string }): SourceGate {
  const crisis = judgeCrisisSignal({ title: input.title, body: input.bodyHead })
  return crisis === null ? { generate: true, reason: null } : { generate: false, reason: 'crisisSignal' }
}

/**
 * 🔴 **생성 결과를 받고 나서 — 다시 써도 되는가 · 채택해도 되는가** (2026-09-16).
 *
 *    결정론이 잡은 위기와 **모델이 잡은 위기**를 함께 본다.
 *    위기면 복제 재생성 · 생활사 재생성 · 자동 채택 · 적재를 전부 멈춘다(§4 · §8).
 */
export type DraftGate = { regenerate: boolean; adopt: boolean; reason: 'crisisSignal' | null }
export function judgeDraftGate(input: {
  drafts: readonly { title: string; body: string }[]
  /** 🔴 의미 판정이 돌려준 위해 — deterministic 이 놓친 것을 모델이 말했을 수 있다 */
  qualityHarms?: readonly (readonly string[])[]
  /** 생활사가 전부 어긋났는가 — 원래 재생성을 부르는 조건이다 */
  allLifeConflict: boolean
}): DraftGate {
  const deterministic = input.drafts.some((d) =>
    judgeCrisisSignal({ title: d.title, body: d.body }) !== null)
  const semantic = (input.qualityHarms ?? []).some((h) => h.includes('crisisSignal'))
  if (deterministic || semantic) return { regenerate: false, adopt: false, reason: 'crisisSignal' }
  return { regenerate: input.allLifeConflict, adopt: true, reason: null }
}

/**
 * 🔴 **위기로 멈춘 회차는 채택하지 않는다** — 정상 초안이 함께 있어도 마찬가지다.
 *
 *    같은 회차의 다른 초안으로 채택을 이어 가면, 위기 소재에서 나온 글이
 *    그대로 Queue 에 올라간다. 회차 전체를 멈추는 것이 §4 다.
 *    🔴 러너가 부르는 채택 입구는 여기 하나다.
 */
export function pickDraftGated(
  input: PickInput & { crisisStop: 'crisisSignal' | null },
  nowIso: string,
): Pick {
  if (input.crisisStop !== null) return pickDraft({ ...input, drafts: [] }, nowIso)
  return pickDraft(input, nowIso)
}

/**
 * 🔴 **의미 판정으로만 감지된 위기** — deterministic 이 놓친 것을 모델이 말했을 때다.
 *    재생성 금지는 이 경우에도 걸려야 한다(§4 · §8).
 */
export function hasCrisisSignal(v: DraftQualityVerdict | null): boolean {
  return v !== null && v.harms.includes('crisisSignal')
}

export function applyQuality(v: DraftQualityVerdict | null): DraftReason {
  if (v === null) return 'semanticUnavailable'
  /**
   * 🔴 **위해가 먼저다.** 품질보다 앞이고 모델의 decision 보다 앞이다.
   *
   * 🔴 **버리는 축과 넘기는 축을 가른다** (2026-09-16). 정책은 정본이 정한다 —
   *    `SEMANTIC_DROP` 에 있으면 버리고, 안전 신호 축은 사람에게 넘긴다(§4).
   *    여기서 이름을 다시 나열하지 않는다.
   */
  if (v.harms.some((x) => (SEMANTIC_DROP as readonly string[]).includes(x))) return 'generatedHarm'
  if (v.harms.length > 0) return 'semanticHold'
  /**
   * 🔴 **명백한 1인칭 생활사 모순** — 근거 문장이 함께 왔을 때만 센다 (2026-09-13).
   *    근거가 없으면 판정을 받은 것이 아니므로 막지 않는다. 애매한 표현은 차단하지 않는다.
   *    러너는 이 사유를 받으면 **예산 안에서 한 번 다시 쓰게 한다** — 소재는 멀쩡하다.
   */
  if (v.lifeConflict !== null && v.lifeConflict.conflict && v.lifeConflict.evidence !== '') {
    return 'lifeHistoryConflict'
  }
  if (v.issues.some((x) => QUALITY_DROP.includes(x))) return 'semanticDrop'
  if (v.issues.some((x) => QUALITY_HOLD.includes(x))) return 'semanticHold'
  // 🔴 우리 축이 하나도 없는데 모르는 이름만 왔다 — 판정을 받은 것이 아니다
  if (v.unknownIssues.length > 0) return 'qualitySchemaMismatch'
  if (v.decision === 'AUTO_DROP' || v.decision === 'AUTO_HOLD') return 'semanticHold'
  if (v.confidence < DRAFT_MIN_CONFIDENCE) return 'lowConfidence'
  return 'ok'
}

export type PickInput = {
  judgement: Judgement
  drafts: readonly DraftCandidate[]
  /** 이미 채택된 제목·본문 (정규화된 것) */
  seenTitles: ReadonlySet<string>
  seenBodies: ReadonlySet<string>
  /** 이미 이 원천에서 하나를 골랐는가 */
  sourceUsed: boolean
  /** 초안별 품질 판정 — 🔴 없으면 통과시키지 않는다 */
  quality?: ReadonlyMap<number, DraftQualityVerdict | null>
}

export type Pick = {
  sourceArticleId: string
  decision: AutoDraftDecision
  draftNo: number | null
  reason: DraftReason
  /** 초안별로 왜 떨어졌는지 — 조용히 사라지지 않게 */
  rejected: { draftNo: number; reason: DraftReason }[]
  ruleVersion: string
  provenance: string
  decidedAt: string
}

/**
 * 초안 하나를 고른다 — 🔴 **막는 것부터 본다. 통과가 마지막이다.**
 *
 * 🔴 판정 단계에서 붙은 위험(연예·정치·의료…)은 여기서 다시 확인한다.
 *    앞 단계가 이미 걸렀더라도, 두 파일 사이에 시간이 흐르는 동안 무엇이 바뀔지 모른다.
 */
export function pickDraft(input: PickInput, now: string): Pick {
  const id = S(input.judgement.sourceArticleId)
  const base = {
    sourceArticleId: id, ruleVersion: DRAFT_RULE_VERSION,
    provenance: DRAFT_PROVENANCE, decidedAt: now,
  }
  const no = (decision: AutoDraftDecision, reason: DraftReason): Pick =>
    ({ ...base, decision, draftNo: null, reason, rejected: [] })

  // ① 판정을 통과한 소재만 초안화한다
  if (S(input.judgement.decision) !== 'AUTO_SEED') return no('AUTO_DROP', 'notAutoSeed')
  const risks = input.judgement.semanticRisks ?? []
  if (risks.some((r) => BLOCKING_RISKS.includes(String(r)))) return no('AUTO_DROP', 'laneRisk')
  // ② 원천당 하나
  if (input.sourceUsed) return no('AUTO_HOLD', 'sourceAlreadyUsed')
  if (input.drafts.length === 0) return no('AUTO_HOLD', 'noDraft')

  const rejected: { draftNo: number; reason: DraftReason }[] = []
  // 🔴 draftNo 순으로 본다 — 입력 순서가 달라도 같은 것을 고른다
  const ordered = [...input.drafts].sort((a, b) => a.draftNo - b.draftNo)
  for (const d of ordered) {
    const why = checkDraft(d, input)
    if (why !== 'ok') { rejected.push({ draftNo: d.draftNo, reason: why }); continue }
    return { ...base, decision: 'AUTO_ADOPT', draftNo: d.draftNo, reason: 'ok', rejected }
  }
  // 🔴 전부 떨어졌다. 버리지 않고 사람에게 남긴다 — 초안이 나빴을 뿐 소재는 살아 있다
  return { ...base, decision: 'AUTO_HOLD', draftNo: null, reason: rejected[0]?.reason ?? 'noDraft', rejected }
}

/** 초안 하나가 통과하는가 — 🔴 순서가 곧 우선순위다 */
export function checkDraft(d: DraftCandidate, input: PickInput): DraftReason {
  // ── ① deterministic — 🔴 모델이 이걸 뒤집을 수 없다 ──
  if (S(d.title) === '') return 'emptyTitle'
  if (S(d.body) === '') return 'emptyBody'
  if (S(d.safetyVerdict) !== 'pass') return 'safetyNotPass'
  if (hasBannedWord(d.title) || hasBannedWord(d.body)) return 'bannedWord'
  // 🔴 실질 복제 — 기준은 draft-originality.ts 하나다. 여기서 숫자를 적지 않는다
  if (judgeCopy(d.originality).copied) return 'copiedFromSource'
  if (echoesTitleAtEnd(d.title, d.body)) return 'titleEchoedInBody'
  if (input.seenTitles.has(normalize(d.title))) return 'duplicateTitle'
  if (input.seenBodies.has(normalize(d.body))) return 'duplicateBody'

  // ── ② semantic 품질 — 🔴 판정을 못 받았으면 통과가 아니다 ──
  if (input.quality === undefined) return 'semanticUnavailable'
  return applyQuality(input.quality.get(d.draftNo) ?? null)
}

/** 🔴 기록 직전 관문 — 사람 값을 사칭하지 않았는지 */
export function violatesDraftProvenance(row: Record<string, unknown>): string[] {
  const bad: string[] = []
  const d = String(row.decision ?? '')
  if (!(AUTO_DRAFT_DECISIONS as readonly string[]).includes(d)) {
    bad.push(`🔴 decision ${d} 은 AUTO_ 값이 아니다`)
  }
  if ((HUMAN_DRAFT_DECISIONS as readonly string[]).includes(d)) {
    bad.push(`🔴 decision ${d} 은 사람이 쓰는 값이다 — 사칭이다`)
  }
  const p = String(row.provenance ?? '')
  if ((HUMAN_DRAFT_PROVENANCE as readonly string[]).includes(p) && p !== DRAFT_PROVENANCE) {
    bad.push(`🔴 provenance ${p} 은 사람 것이다`)
  }
  if (p !== DRAFT_PROVENANCE) bad.push(`🔴 provenance 가 ${DRAFT_PROVENANCE} 가 아니다`)
  for (const k of ['ruleVersion', 'decidedAt', 'sourceArticleId'] as const) {
    if (String(row[k] ?? '') === '') bad.push(`🔴 ${k} 가 비었다`)
  }
  return bad
}

export type DraftSummary = {
  total: number
  AUTO_ADOPT: number
  AUTO_HOLD: number
  AUTO_DROP: number
  byReason: Record<string, number>
}

export function summarizeDrafts(picks: readonly Pick[]): DraftSummary {
  const byReason: Record<string, number> = {}
  for (const p of picks) {
    byReason[p.reason] = (byReason[p.reason] ?? 0) + 1
    for (const r of p.rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1
  }
  return {
    total: picks.length,
    AUTO_ADOPT: picks.filter((p) => p.decision === 'AUTO_ADOPT').length,
    AUTO_HOLD: picks.filter((p) => p.decision === 'AUTO_HOLD').length,
    AUTO_DROP: picks.filter((p) => p.decision === 'AUTO_DROP').length,
    byReason,
  }
}
