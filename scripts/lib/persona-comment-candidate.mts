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
 * 🔴 9관문 중 이 단계에서 자동 판정 가능한 것만 돈다.
 *      ① 20자 유출        assertNoSourceLeak 재사용
 *      ⑤ 금지 호칭        checkForbiddenAddress
 *      ⑥-A 닉네임 혼입    author/회원 닉네임이 본문에 섞였는가
 *      ⑨ 출처 marker      checkSourceMarker
 *      ⑧ 하위 축(일부)    구조화 나열 · 구어 표지 부재 — AI 티 태그로만
 *    ②③④⑦ 은 코퍼스·identity·LLM 판정이 필요해 여기서 돌리지 않는다.
 *    🔴 "돌지 않았다" 를 pass 로 보고하지 않는다 — notRun 으로 분리한다.
 */
import { assertNoSourceLeak, M3_LEAK_RUN_MIN } from './voice-m3-contract.mjs'
import { checkForbiddenAddress } from './persona-gate-forbidden-address.mjs'
import { checkSourceMarker } from './persona-gate-source-marker.mjs'
import { classifyReaction, type ReactionType } from './voice-comment-signals.mjs'

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
}

const SEVERITY: Record<GateOutcome, number> = {
  notRun: -1, pass: 0, review: 1, regenerate: 2, reject: 3,
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
  /(병원\s*(가|가서|가보|다녀)|검사\s*(받|해보)|약\s*(드시|먹|복용)|처방|진단|수술|\b해야\s*(합니다|해요|됩니다)|하셔야)/u

/** 후보 하나를 판정한다. 🔴 순수 함수 */
export function checkCommentCandidate(input: CandidateInput): CandidateVerdict {
  const text = (input.text ?? '').trim()
  const gates: GateResult[] = []
  const tags: AiToneTag[] = []

  // ── ① 20자 연속 유출 — 🔴 완화하지 않는다 ──
  //    🔴 assertNoSourceLeak 은 이름과 달리 throw 하지 않는다.
  //       { ok, leaked } 를 돌려준다 — try/catch 로 감싸면 유출을 전부 놓친다.
  const leak = assertNoSourceLeak(text, input.sourceTexts)
  const leaked = leak.leaked
  gates.push(
    leaked
      ? { gate: '①', outcome: 'regenerate', detail: `${M3_LEAK_RUN_MIN}자 이상 연속 일치` }
      : { gate: '①', outcome: 'pass', detail: `연속 일치 < ${M3_LEAK_RUN_MIN}자` },
  )
  if (leaked) tags.push('SEED_TOO_CLOSE')

  // ── ⑤ 금지 호칭 / 브랜드 금칙어 ──
  const five = checkForbiddenAddress(text)
  gates.push({
    gate: '⑤',
    outcome: five.status,
    detail: five.status === 'pass'
      ? '금지 호칭 없음'
      : `타겟 설명어 ${five.targetDescriptors.length} · 브랜드 금지어 ${five.brandBannedWords.length}`,
  })

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

  // ── ⑧ Voice Fingerprint 하위 축 — 🔴 태그만. 판정은 하지 않는다 ──
  //    반복 패턴 · 정체성은 코퍼스와 identity 가 있어야 판정할 수 있다
  if (TIDY_MARKS.test(text)) tags.push('TOO_TIDY')
  if (!LIFE_MARKS.test(text)) tags.push('NO_LIFE_MARKS')
  gates.push({ gate: '⑧', outcome: 'notRun', detail: '코퍼스 필요 — 태그만 산출' })

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
  if (input.adviceForbidden === true && (reactionType === 'information' || ADVICE_MARKS.test(text))) {
    tags.push('ADVICE_RISK')
  }
  if (reactionType === 'empathy' && text.length < 15) tags.push('OVER_EMPATHY')

  // ── 돌지 않은 관문 — 🔴 pass 로 보고하지 않는다 ──
  for (const g of ['②', '③', '④'] as const) {
    gates.push({ gate: g, outcome: 'notRun', detail: '코퍼스 · 판정부 미구현' })
  }

  const ran = gates.filter((g) => g.outcome !== 'notRun')
  const worst = ran.reduce<Exclude<GateOutcome, 'notRun'>>(
    (acc, g) => (SEVERITY[g.outcome] > SEVERITY[acc] ? (g.outcome as Exclude<GateOutcome, 'notRun'>) : acc),
    'pass',
  )

  const failed = ran.filter((g) => g.outcome !== 'pass')
  return {
    personaCode: input.personaCode,
    reactionType,
    status: worst,
    gates: gates.sort((a, b) => a.gate.localeCompare(b.gate)),
    aiToneTags: tags,
    sourceLeak: leaked,
    charLength: [...text].length,
    reason: failed.length === 0
      ? `관문 ${ran.length}종 통과 · 미실행 ${gates.length - ran.length}종`
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
