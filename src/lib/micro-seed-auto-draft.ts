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
/** 🔴 사람 것과 겹치지 않는다. 기계가 **만든** 글이라는 표시 */
export const DRAFT_PROVENANCE = 'machine-generated'

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
 */










/**
 * 모델 응답을 읽는다 — 🔴 **모르는 것은 통과가 아니다.**
 */


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
 */

/**
 * 🔴 **한 원천에 대해 생성을 시작해도 되는가** — 순수 판정 (2026-09-16).
 *
 *    정본 §4 는 위기 소재를 **④ Draft Generation 을 시작하지 않는다** 로 못박았다.
 *    러너는 이 함수를 **생성 캐시 조회보다도 먼저** 부른다 — 그래야 옛 AUTO 판정이나
 *    캐시가 있어도 새 안전 검사를 건너뛰지 못한다.
 */
/**
 * 🔴 **나이 모순 실측 기록** — 다른 레인(`original-post-machine-review`)이 읽는다.
 *    v2 에서 별도 나이 검수 호출은 없앴지만, *"3/3 잡는 모델이 없다"* 는 실측 사실과
 *    그래서 **사람 확인이 필요하다**는 정책은 그대로다.
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
export const AGE_CHECK_QUALIFIED_MODEL: string | null = null

export const MACHINE_AGE_HUMAN_REVIEW_REQUIRED = true
export const MACHINE_AGE_HUMAN_REVIEW_NOTE =
  '🔴 나이·세대 모순을 3/3 잡는 모델이 없다(2026-09-14 실측). 나이 검수는 보조 탐지이고,'
  + ' 기계 생성 글은 **자동 발행 전 사람 확인**이 필요하다.'

export type SourceGate = { generate: boolean; reason: 'crisisSignal' | null }
export function judgeSourceGate(input: { title: string; bodyHead: string }): SourceGate {
  const crisis = judgeCrisisSignal({ title: input.title, body: input.bodyHead })
  return crisis === null ? { generate: true, reason: null } : { generate: false, reason: 'crisisSignal' }
}

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
 * 🔴 **Content Core v2 초안 한 편을 기존 Pick 계약으로 옮긴다** (2026-09-20).
 *
 *    v2 의 `machineOutcome` 은 **READY 가 아니다.** 여기서도 아니다 —
 *    `AUTO_ADOPT` 는 *"기계가 골랐다"* 일 뿐이고 사람 승인은 그대로 남는다.
 *
 * 🔴 **기계가 adopt 라고 해도 기존 정본 검사를 다시 건다**:
 *    제목 복제 · 중복 · 안전 · 위기 신호. 모델 말을 믿지 않는다.
 */
export type PickV2Input = {
  judgement: Judgement
  draft: DraftCandidate
  seenTitles: ReadonlySet<string>
  seenBodies: ReadonlySet<string>
  sourceUsed: boolean
  machineOutcome: 'adopt' | 'hold' | 'drop'
  machineReason: string
  sourceTitleCopied: boolean
  crisisStop: 'crisisSignal' | null
}

export function pickV2(input: PickV2Input, now: string): Pick {
  const d = input.draft
  const base = {
    sourceArticleId: input.judgement.sourceArticleId,
    ruleVersion: DRAFT_RULE_VERSION,
    provenance: DRAFT_PROVENANCE,
    decidedAt: now,
  }
  /** 🔴 사유 이름을 새로 만들지 않는다 — 기존 정본 어휘를 쓴다 */
  const DROP: readonly DraftReason[] = ['generatedHarm', 'bannedWord', 'semanticDrop']
  const held = (reason: DraftReason): Pick => ({
    ...base, decision: DROP.includes(reason) ? 'AUTO_DROP' : 'AUTO_HOLD',
    draftNo: null, reason, rejected: [{ draftNo: d.draftNo, reason }],
  })
  // 🔴 위기 신호가 먼저다 — 정상 초안이 함께 있어도 채택하지 않는다 (정본 §4)
  if (input.crisisStop !== null) return held('semanticHold')
  if (input.machineOutcome === 'drop') return held('generatedHarm')
  if (input.machineOutcome === 'hold') return held('semanticHold')
  // ── 기계가 adopt — 여기서 기존 정본 검사를 다시 건다 ──
  const own = checkDraft(d, {
    judgement: input.judgement, drafts: [d],
    seenTitles: input.seenTitles, seenBodies: input.seenBodies,
    sourceUsed: input.sourceUsed,
  })
  if (own !== 'ok') return held(own)
  if (input.sourceTitleCopied) return held('copiedFromSource')
  return { ...base, decision: 'AUTO_ADOPT', draftNo: d.draftNo, reason: 'ok', rejected: [] }
}

export type PickInput = {
  judgement: Judgement
  drafts: readonly DraftCandidate[]
  /** 이미 채택된 제목·본문 (정규화된 것) */
  seenTitles: ReadonlySet<string>
  seenBodies: ReadonlySet<string>
  /** 이미 이 원천에서 하나를 골랐는가 */
  sourceUsed: boolean
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

  /**
   * 🔴 **의미 판정은 여기서 하지 않는다** (2026-09-20, Content Core v2 전환).
   *    v2 의 통합 검수가 `machineOutcome` 으로 이미 판정했고, `pickV2` 가 그것을
   *    먼저 본다. 여기 남은 것은 **deterministic 만**이다 —
   *    같은 판정을 두 곳에서 하면 한쪽이 낡는다.
   */
  return 'ok'
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
