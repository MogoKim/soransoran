/**
 * VE-M3 프롬프트 payload 빌더 (VE-M3-2)
 *
 * 정본: docs/operations/2026-08-27-voice-m3-llm-experiment-contract.md §C
 *
 * 🔴 이 파일은 LLM 을 부르지 않는다
 *    payload 를 **만들기만** 한다. SDK · 네트워크가 없다.
 *    실제 호출은 VE-M3-3 이고, 그전까지 비용은 0원이다.
 *
 * 🔴 원문이 지나가지만 남지 않는다
 *    payload 안에는 본문과 댓글이 들어간다 — LLM 이 판단하려면 봐야 하기 때문이다.
 *    그러나 **요약(`PromptSummary`)에는 길이 · 해시 · 개수만** 담긴다.
 *    보고와 로그는 요약만 쓴다.
 *
 *    이 구분이 VE-M3 의 핵심 위험 지점이다(계약 §C):
 *      원문 → LLM 입력으로 쓴다              ✅
 *      원문 → 출력 · 로그 · DB 에 저장한다     🔴 금지
 */
import { createHash } from 'node:crypto'
import {
  M3_TASK_VERSION, M3_PROMPT_VERSION, M3_OUTPUT_SCHEMA_VERSION,
  M3_OUTPUT_SCHEMA, M3_SIGNAL_KEYS, M3_ALLOWED_ADDRESS_TERMS, M3_FORBIDDEN_ADDRESS_TERMS,
  TOKENS_PER_CHAR,
} from './voice-m3-contract.mjs'

/** LLM 에게 줄 입력. 🔴 이 객체는 payload 이지 저장 대상이 아니다 */
export type M3PromptPayload = {
  taskVersion: string
  promptVersion: string
  outputSchemaVersion: string
  /** 지시문. 원문이 아니라 우리가 쓴 문장이다 */
  instruction: string
  /** LLM 이 지켜야 할 출력 모양 */
  outputSchema: typeof M3_OUTPUT_SCHEMA
  /** 🔴 원문 · 댓글. 판단 재료이며 저장 대상이 아니다 */
  source: {
    body: string
    comments: string[]
  }
  /** 소란소란이 이미 계산해 둔 신호 — 재계산 비용 0 */
  derivedSignals: Record<string, unknown>
  /** 우나어가 매긴 라벨 */
  legacyLabels: Record<string, unknown>
  /** 댓글 반응 분포 (본문 없음) */
  commentSignalSummary: Record<string, number>
}

/** 🔴 로그 · 보고에 쓰는 것. 본문 · 댓글 · 닉네임이 없다 */
export type PromptSummary = {
  sourceRef: string
  bodyLength: number
  bodyHash: string
  commentCount: number
  commentCharTotal: number
  derivedSignalKeys: string[]
  legacyLabelKeys: string[]
  /** payload 전체를 문자로 폈을 때의 길이 — 토큰 추정 입력 */
  payloadChars: number
  estimatedInputTokens: number
}

/**
 * 🔴 판단 대상 7종과 **하지 말아야 할 것**을 함께 적는다.
 *
 * 금지어를 프롬프트에 직접 넣는 이유: 원문에 `우리 또래분들` 이 실제로 존재한다
 * (VE-M2 전량에서 7건). 모델이 그것을 보고 따라 쓸 수 있다.
 * 출력 검사(§H)만으로 막지 않고 **입력에서 먼저 막는다** — 두 겹이다.
 */
export function buildInstruction(): string {
  return [
    '당신은 한국 커뮤니티 글의 문체를 판정한다. 글을 새로 쓰지 않는다.',
    '',
    '아래 원문과 이미 계산된 신호를 보고 7개 축을 0~100 정수로 매긴다.',
    ...M3_SIGNAL_KEYS.map((k) => `  - ${k}`),
    '',
    '지켜야 할 것:',
    '  - 판단 근거(notes)에 원문을 인용하지 않는다. 20자 이상 연속 일치는 거부된다.',
    '  - 닉네임을 출력하지 않는다.',
    `  - 호칭을 제안한다면 다음만 쓴다: ${M3_ALLOWED_ADDRESS_TERMS.join(' · ')}`,
    `  - 다음 표현은 원문에 있더라도 절대 생성하지 않는다: ${M3_FORBIDDEN_ADDRESS_TERMS.slice(0, 8).join(' · ')} 등 타겟 설명어`,
    '    (커뮤니티 안에서 사람들은 서로를 설명하지 않는다. 그냥 부른다.)',
    '  - overSanitizedRisk 와 overMimicryRisk 는 서로 반대 방향이다. 둘 다 높게 주지 않는다.',
    '',
    '출력은 JSON 하나. 다른 문장을 덧붙이지 않는다.',
  ].join('\n')
}

export type BuildPayloadInput = {
  sourceRef: string
  body: string
  comments: string[]
  derivedSignals: Record<string, unknown>
  legacyLabels: Record<string, unknown>
  commentSignalSummary: Record<string, number>
  model?: string
}

/**
 * payload 와 요약을 함께 만든다.
 *
 * 🔴 호출부는 **요약만 로그로 쓴다.** payload 를 그대로 찍으면 원문이 터미널과
 *    CI 로그에 남는다 — 우리가 통제하지 못하는 곳이다.
 */
export function buildPromptPayload(input: BuildPayloadInput): {
  payload: M3PromptPayload
  summary: PromptSummary
} {
  const payload: M3PromptPayload = {
    taskVersion: M3_TASK_VERSION,
    promptVersion: M3_PROMPT_VERSION,
    outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
    instruction: buildInstruction(),
    outputSchema: M3_OUTPUT_SCHEMA,
    source: { body: input.body, comments: input.comments },
    derivedSignals: input.derivedSignals,
    legacyLabels: input.legacyLabels,
    commentSignalSummary: input.commentSignalSummary,
  }
  const payloadChars = JSON.stringify(payload).length
  const commentCharTotal = input.comments.reduce((a, c) => a + c.length, 0)
  return {
    payload,
    summary: {
      sourceRef: input.sourceRef,
      bodyLength: input.body.length,
      // 🔴 본문이 아니라 "그때 그 본문이었다" 의 증거
      bodyHash: `sha256:${createHash('sha256').update(input.body, 'utf8').digest('hex')}`,
      commentCount: input.comments.length,
      commentCharTotal,
      derivedSignalKeys: Object.keys(input.derivedSignals),
      legacyLabelKeys: Object.keys(input.legacyLabels),
      payloadChars,
      estimatedInputTokens: Math.round(payloadChars * TOKENS_PER_CHAR),
    },
  }
}

/**
 * 요약을 사람이 읽을 한 줄로.
 * 🔴 여기에 본문이 들어갈 자리가 없다 — 전부 수치와 키 이름이다.
 */
export function formatSummaryLine(s: PromptSummary): string {
  return (
    `${s.sourceRef}  본문 ${String(s.bodyLength).padStart(4)}자 · ` +
    `댓글 ${String(s.commentCount).padStart(3)}개(${s.commentCharTotal}자) · ` +
    `신호 ${s.derivedSignalKeys.length}종 · 라벨 ${s.legacyLabelKeys.length}종 · ` +
    `payload ${s.payloadChars}자 ≈ ${s.estimatedInputTokens} tok`
  )
}
