/**
 * 페르소나 댓글 후보 — Gate 파이프라인 (판정부)
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md
 *       docs/operations/2026-08-30-m3-reaction-map-design.md §4-8 AI 티 태그
 *
 * 🔴 이 파일은 **생성하지 않는다.** 이미 만들어진 후보 텍스트를 받아 판정만 한다.
 *    생성(LLM 호출)은 별도이고, 이 단계에서는 연결하지 않는다 —
 *    Gate 설계 §1 이 "생성기보다 가드를 먼저 만든다" 고 정한 순서다.
 *
 * 🔴 순수 함수다. DB · LLM · 파일 IO · 네트워크 없음.
 *    대조 집합과 source 텍스트는 인자로 받는다.
 *
 * 🔴 반환값에 원문 조각을 담지 않는다.
 *    후보 텍스트 자체는 호출부가 이미 갖고 있고, 판정 결과에는 코드·개수만 남는다.
 *
 * 🔴 반환 gates 는 입력과 무관하게 **항상 ①~⑨ 각 1개씩 9개**다.
 *    관문 하나가 근거를 여럿 가질 수는 있어도 관문 수는 늘지 않는다 —
 *    분모가 후보마다 달라지면 통과율 집계가 성립하지 않는다. orderGates 가 강제한다.
 *      ① 20자 유출        assertNoSourceLeak 재사용
 *      ② 고유 표현        checkUniqueExpression — 코퍼스 빈도 조회를 인자로 받는다
 *      ③ 식별 디테일      checkIdentifyingDetail — 단일 허용 · 결합이 위험
 *      ④ 구조 과복제      checkStructureCopy — ① 은 문자열, ④ 는 전개 순서
 *      ⑤ 금지 호칭 + §5 조언 제한  🔴 근거는 둘이지만 관문은 하나다
 *      ⑥-A 닉네임 혼입    author/회원 닉네임이 본문에 섞였는가
 *      ⑧ 하위 축(일부)    구조화 나열 · 마크다운 — 코퍼스 없이도 확정적으로 잡힌다
 *      ⑨ 출처 marker      checkSourceMarker
 *    ⑦ identity 대조 · ⑧ 반복 패턴은 identity·코퍼스가 있어야 해서 아직 못 돈다.
 *    🔴 "돌지 않았다" 를 pass 로 보고하지 않는다 — notRun 으로 분리한다.
 */
import { assertNoSourceLeak, M3_LEAK_RUN_MIN } from './voice-m3-contract.mjs'
import { checkForbiddenAddress } from './persona-gate-forbidden-address.mjs'
import { checkSourceMarker } from './persona-gate-source-marker.mjs'
import { classifyReaction, type ReactionType } from './voice-comment-signals.mjs'
import {
  checkUniqueExpression, checkIdentifyingDetail, checkStructureCopy,
  type FrequencyLookup,
} from './persona-gate-234.mjs'

export type GateCode = '①' | '②' | '③' | '④' | '⑤' | '⑥' | '⑦' | '⑧' | '⑨'
export type GateOutcome = 'pass' | 'review' | 'regenerate' | 'reject' | 'notRun'

export type GateResult = {
  gate: GateCode
  outcome: GateOutcome
  /** 🔴 원문 조각 없이 코드·개수만 */
  detail: string
}

/** §4-8 AI 티 태그 */
export type AiToneTag =
  | 'TONE_REPEAT'        // 말투 반복
  | 'TOO_TIDY'           // 너무 정리됨
  | 'OVER_EMPATHY'       // 과도한 공감
  | 'NO_LIFE_MARKS'      // 생활감 부족
  | 'IDENTITY_CONFLICT'  // 정체성 모순
  | 'STRUCTURE_COPY'     // 원문 구조 과복제
  | 'SEED_TOO_CLOSE'     // 원문 댓글과 유사
  | 'ADVICE_RISK'        // 조언 위험
  | 'SOURCE_TRACE'       // 외부 커뮤니티 흔적

export type CandidateVerdict = {
  personaCode: string
  reactionType: ReactionType
  /** 가장 엄격한 관문 결과 */
  status: Exclude<GateOutcome, 'notRun'>
  gates: GateResult[]
  aiToneTags: AiToneTag[]
  /** ① 결과 — 🔴 유출은 별도로 드러낸다 */
  sourceLeak: boolean
  charLength: number
  /** 🔴 원문 조각 없이 관문 코드만 */
  reason: string
}

export type CandidateInput = {
  personaCode: string
  /** 후보 댓글 본문 — 🔴 판정에만 쓰고 반환값에 담지 않는다 */
  text: string
  /** ① 대조용 source 텍스트 (원문 본문 · 원댓글) */
  sourceTexts: readonly string[]
  /** ⑥-A 대조용 — 회원 표시명 · 크롤 author 원문 (있으면) */
  knownNames?: readonly string[]
  /** 페르소나가 맡지 않는 역할 — forbiddenReactionRoles */
  forbiddenRoles?: readonly string[]
  /** 조언이 금지된 글 유형인가 (건강 · 돈 등) */
  adviceForbidden?: boolean
  /** 출처가 카페 운영/공지 문맥인가 — ⑨ 로 넘긴다 */
  sourceIsCafeOperational?: boolean
  /**
   * ② 코퍼스 빈도 조회. 🔴 없으면 ② 는 notRun 이다 — pass 로 세지 않는다.
   *    댓글 생성물에는 **댓글 코퍼스**를 붙여야 한다(§3-②).
   */
  frequencyLookup?: FrequencyLookup
  /** ② 로그용 — 어느 코퍼스로 쟀는지 */
  corpusName?: string
}

const SEVERITY: Record<GateOutcome, number> = {
  notRun: -1, pass: 0, review: 1, regenerate: 2, reject: 3,
}

/** 🔴 근거가 둘일 때 더 엄격한 쪽을 남긴다 — pass < review < regenerate < reject */
const stricter = (a: GateOutcome, b: GateOutcome): GateOutcome => (SEVERITY[a] >= SEVERITY[b] ? a : b)

const GATE_ORDER: readonly GateCode[] = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

/**
 * 🔴 9관문은 입력과 무관하게 항상 ①~⑨ 각 1개씩이다.
 *    관문이 빠지면 "돌지 않은 것" 이 집계에서 사라지고,
 *    중복되면 같은 관문이 두 번 세어져 통과율이 왜곡된다.
 *    호출부가 아니라 판정부가 막는다 — 이건 반환값의 계약이다.
 */
function orderGates(gates: readonly GateResult[]): GateResult[] {
  const out: GateResult[] = []
  for (const code of GATE_ORDER) {
    const hit = gates.filter((g) => g.gate === code)
    const only = hit[0]
    if (hit.length !== 1 || only === undefined) {
      throw new Error(`판정부 결함 — Gate ${code} 가 ${hit.length}개다 (기대 1개)`)
    }
    out.push(only)
  }
  if (gates.length !== GATE_ORDER.length) {
    throw new Error(`판정부 결함 — gates ${gates.length}개 (기대 ${GATE_ORDER.length}개)`)
  }
  return out
}

/** 🔴 구어 표지 — 없으면 "생활감 부족" 태그 */
const LIFE_MARKS = /(ㅋ|ㅎ|\.\.\.|~|!|\?|요\b|네요|더라구|거든요|아요|어요)/u
/** 🔴 구조화 나열 — 마크다운 · 번호 목록은 사람 댓글에 드물다 */
const TIDY_MARKS = /(^|\n)\s*([-*•]|\d+[.)])\s|\*\*|##/u

/**
 * 🔴 조언 위험 — Gate §5 조언 제한 정책의 금지 유형을 문구로 본다.
 *    reactionType 에만 기대면 놓친다: classifyReaction 은 VE-M2 계약이라
 *    "병원 가서 검사받으셔야 합니다" 를 other 로 분류한다.
 *    태그는 판정이 아니라 운영자에게 보내는 힌트다(§4-8).
 */
const ADVICE_MARKS =
  /(병원\s*(가|가서|가보|다녀)|검사\s*(받|해보)|약\s*(드시|먹|복용)|처방|진단|수술)/u

/**
 * 🔴 단정형 — "판단을 내려주는" 형태다.
 *    Gate §5 가 "경계는 단정이다. 경험을 나누는 것과 판단을 내려주는 것은 다르다" 로 정했다.
 */
const ADVICE_ASSERTIVE =
  /(하셔야\s*(합니다|해요|됩니다|돼요)|받으셔야|드셔야|가셔야|해야\s*(합니다|돼요|됩니다)|\b꼭\s*(하|가|드)|반드시)/u

/** 후보 하나를 판정한다. 🔴 순수 함수 */
export function checkCommentCandidate(input: CandidateInput): CandidateVerdict {
  const text = (input.text ?? '').trim()
  const gates: GateResult[] = []
  const tags: AiToneTag[] = []

  // ── ① 20자 연속 유출 — 🔴 완화하지 않는다 ──
  //    🔴 assertNoSourceLeak 은 이름과 달리 throw 하지 않는다.
  //       { ok, leaked } 를 돌려준다 — try/catch 로 감싸면 유출을 전부 놓친다.
  //    🔴 sourceTexts 가 비면 검사가 성립하지 않는다.
  //       assertNoSourceLeak 은 hay 가 짧으면 { leaked: false } 를 돌려주는데,
  //       그것은 "유출이 없다" 가 아니라 "볼 게 없었다" 다.
  //       검사 불가를 pass 로 세면 통과율이 거짓이 된다 → regenerate 로 되돌린다.
  const hasSource = input.sourceTexts.some((t) => t.trim() !== '')
  let leaked = false
  if (!hasSource) {
    gates.push({ gate: '①', outcome: 'regenerate', detail: '검사 불가 — sourceTexts 없음' })
  } else {
    leaked = assertNoSourceLeak(text, input.sourceTexts).leaked
    gates.push(
      leaked
        ? { gate: '①', outcome: 'regenerate', detail: `${M3_LEAK_RUN_MIN}자 이상 연속 일치` }
        : { gate: '①', outcome: 'pass', detail: `연속 일치 < ${M3_LEAK_RUN_MIN}자` },
    )
    if (leaked) tags.push('SEED_TOO_CLOSE')
  }

  // ── ⑥-A 닉네임 혼입 — 🔴 이름 하나가 아니라 본문을 본다 (⑥-B 와 다른 갈래) ──
  const nameHits = (input.knownNames ?? []).filter((n) => n.trim() !== '' && text.includes(n.trim()))
  gates.push({
    gate: '⑥',
    outcome: nameHits.length > 0 ? 'regenerate' : 'pass',
    // 🔴 어떤 이름인지 담지 않는다. 개수만
    detail: nameHits.length > 0 ? `닉네임 혼입 ${nameHits.length}건` : '닉네임 혼입 없음',
  })

  // ── ⑨ 출처 커뮤니티 marker ──
  const nine = checkSourceMarker(text, {
    ...(input.sourceIsCafeOperational !== undefined
      ? { sourceIsCafeOperational: input.sourceIsCafeOperational }
      : {}),
  })
  gates.push({ gate: '⑨', outcome: nine.status, detail: nine.reason })
  if (nine.hits.length > 0) tags.push('SOURCE_TRACE')

  // ── ⑧ Voice Fingerprint ──
  //    🔴 반복 패턴 · n-gram 점유율은 코퍼스가 있어야 본다.
  //       그러나 구조화 나열 · 마크다운은 코퍼스 없이 확정적으로 잡힌다 —
  //       사람이 쓴 커뮤니티 댓글에 "- 첫째" · "**꼭**" 는 나오지 않는다.
  //       확정적으로 잡을 수 있는 것을 태그로만 두면 통과해 버린다.
  const tidy = TIDY_MARKS.test(text)
  if (tidy) tags.push('TOO_TIDY')
  // 🔴 생활감 부족은 태그만이다 — 짧은 댓글은 원래 표지가 없을 수 있다
  if (!LIFE_MARKS.test(text)) tags.push('NO_LIFE_MARKS')
  gates.push(
    tidy
      ? { gate: '⑧', outcome: 'regenerate', detail: '구조화 나열 · 마크다운' }
      : { gate: '⑧', outcome: 'notRun', detail: '반복 패턴은 코퍼스 필요 — 구조 검사만 통과' },
  )

  // ── 반응 역할 ──
  const reactionType = classifyReaction(text)
  const forbidden = input.forbiddenRoles ?? []
  if (forbidden.includes(reactionType)) {
    gates.push({ gate: '⑦', outcome: 'regenerate', detail: `금지 역할 ${reactionType}` })
    tags.push('IDENTITY_CONFLICT')
  } else {
    // 🔴 identity·memory 대조는 아직 못 한다. 역할 금지만 본다
    gates.push({ gate: '⑦', outcome: 'notRun', detail: 'identity 대조 미구현 — 역할 금지만 확인' })
  }
  // ── ⑤ 금지 호칭 + §5 조언 제한 — 🔴 근거는 둘, 관문은 하나다 ──
  //    호칭 위반과 조언 위반은 이유가 다르지만 둘 다 Gate ⑤ 다.
  //    각각 push 하면 후보에 따라 gates 가 9개가 되기도 10개가 되기도 한다 —
  //    관문 수가 입력에 따라 흔들리면 "9관문 중 몇 종" 이라는 집계 자체가 성립하지 않는다.
  //    🔴 둘 다 걸리면 더 엄격한 쪽을 남긴다 (pass < review < regenerate < reject)
  //      단정형("~하셔야 합니다")   regenerate — 판단을 내려주고 있다
  //      그 외 조언 신호            review     — 사람이 본다
  const five = checkForbiddenAddress(text)
  let fiveOutcome: GateOutcome = five.status
  const fiveWhy: string[] = []
  if (five.status !== 'pass') {
    if (five.targetDescriptors.length > 0) fiveWhy.push(`타겟 설명어 ${five.targetDescriptors.length}`)
    if (five.brandBannedWords.length > 0) fiveWhy.push(`브랜드 금지어 ${five.brandBannedWords.length}`)
    if (fiveWhy.length === 0) fiveWhy.push('금지 호칭 위반')
  }
  if (input.adviceForbidden === true) {
    const assertive = ADVICE_ASSERTIVE.test(text)
    if (assertive || ADVICE_MARKS.test(text) || reactionType === 'information') {
      tags.push('ADVICE_RISK')
      fiveOutcome = stricter(fiveOutcome, assertive ? 'regenerate' : 'review')
      fiveWhy.push(assertive ? '§5 단정형 조언' : '§5 조언 신호')
    }
  }
  gates.push({
    gate: '⑤',
    outcome: fiveOutcome,
    // 🔴 값이 아니라 코드 · 개수 · 정책명만 남긴다
    detail: fiveWhy.length > 0 ? fiveWhy.join(' · ') : '금지 호칭 없음',
  })
  if (reactionType === 'empathy' && text.length < 15) tags.push('OVER_EMPATHY')

  // ── ② 고유 표현 / 특이 조어 ──
  //    🔴 코퍼스 빈도 조회가 없으면 판정이 성립하지 않는다. notRun 이다.
  if (input.frequencyLookup === undefined) {
    gates.push({ gate: '②', outcome: 'notRun', detail: '코퍼스 빈도 조회 없음' })
  } else if (!hasSource) {
    gates.push({ gate: '②', outcome: 'notRun', detail: '검사 불가 — sourceTexts 없음' })
  } else {
    const two = checkUniqueExpression(
      text, input.sourceTexts, input.frequencyLookup, input.corpusName ?? 'comment',
    )
    gates.push({ gate: '②', outcome: two.status, detail: two.detail })
    if (two.status !== 'pass') tags.push('SEED_TOO_CLOSE')
  }

  // ── ③ 식별 디테일 — 🔴 단일은 허용, 결합이 위험하다 ──
  const three = checkIdentifyingDetail(text)
  gates.push({ gate: '③', outcome: three.status, detail: three.detail })

  // ── ④ 구조 과복제 — 🔴 ① 과 역할이 다르다 ──
  //    ① 은 문자열, ④ 는 전개 순서. 표현이 전부 달라도 ④ 는 걸릴 수 있다
  if (!hasSource) {
    gates.push({ gate: '④', outcome: 'notRun', detail: '검사 불가 — sourceTexts 없음' })
  } else {
    const four = checkStructureCopy(text, input.sourceTexts)
    gates.push({ gate: '④', outcome: four.status, detail: four.detail })
    if (four.status !== 'pass') tags.push('STRUCTURE_COPY')
  }

  // 🔴 집계보다 먼저 관문 수를 확정한다 — 9개가 아니면 여기서 멈춘다
  const ordered = orderGates(gates)
  const ran = ordered.filter((g) => g.outcome !== 'notRun')
  const worst = ran.reduce<Exclude<GateOutcome, 'notRun'>>(
    (acc, g) => (SEVERITY[g.outcome] > SEVERITY[acc] ? (g.outcome as Exclude<GateOutcome, 'notRun'>) : acc),
    'pass',
  )

  const failed = ran.filter((g) => g.outcome !== 'pass')
  return {
    personaCode: input.personaCode,
    reactionType,
    status: worst,
    gates: ordered,
    // 🔴 중복 제거 — ① 과 ② 가 같은 태그를 붙일 수 있다.
    //    운영자 화면에서 같은 태그가 두 번 보이면 근거가 둘인지 버그인지 알 수 없다
    aiToneTags: [...new Set(tags)],
    sourceLeak: leaked,
    charLength: [...text].length,
    reason: failed.length === 0
      ? `관문 ${ran.length}종 통과 · 미실행 ${ordered.length - ran.length}종`
      : failed.map((g) => `${g.gate}:${g.outcome}`).join(' · '),
  }
}

/** 집계 — 🔴 본문을 담지 않는다 */
export function summarizeCandidates(list: readonly CandidateVerdict[]): {
  total: number
  byStatus: Record<Exclude<GateOutcome, 'notRun'>, number>
  byReaction: Record<string, number>
  tagCounts: Record<string, number>
  sourceLeak: number
} {
  const byStatus = { pass: 0, review: 0, regenerate: 0, reject: 0 }
  const byReaction: Record<string, number> = {}
  const tagCounts: Record<string, number> = {}
  let sourceLeak = 0
  for (const v of list) {
    byStatus[v.status]++
    byReaction[v.reactionType] = (byReaction[v.reactionType] ?? 0) + 1
    for (const t of v.aiToneTags) tagCounts[t] = (tagCounts[t] ?? 0) + 1
    if (v.sourceLeak) sourceLeak++
  }
  return { total: list.length, byStatus, byReaction, tagCounts, sourceLeak }
}
