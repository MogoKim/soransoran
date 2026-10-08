/**
 * Persona **creative 생성 실행기** — 🔴 provider 호출은 주입받는다 (2026-10-06)
 *
 *   운영   `callProvider`(voice-m3-provider · 유료 경로 하나) — `persona-autogen --generate-creative` 만 넘긴다
 *   검사   가짜 호출 함수 — 네트워크 0
 *
 * 🔴 지키는 것
 *    · 후보 수가 `CREATIVE_MAX_CANDIDATES` 를 넘으면 **한 번도 부르지 않는다**
 *    · 호출 **전** 최악 예약액(입력 상한 = UTF-8 바이트 수 · 출력 상한 = max_tokens)을 더해
 *      `CREATIVE_COST_CAP_USD` 를 넘으면 그 후보와 뒤 후보를 부르지 않는다
 *    · 사용량을 못 읽으면 실제 비용을 모른다 — 그 뒤로는 부르지 않는다(상한을 지킬 근거가 없다)
 *    · 재시도 0 — 실패 · 형식 위반은 그 후보의 creative 가 없는 것으로 끝난다
 *    · 나가는 글에 이 후보 묶음의 댓글 원문이 실렸으면 부르지 않는다(`payloadLeaks`)
 */
import { costOf, reserveOf } from '../../src/lib/llm-pricing'
import {
  CREATIVE_COST_CAP_USD, CREATIVE_MAX_CANDIDATES, CREATIVE_MAX_OUTPUT_TOKENS, CREATIVE_MODEL, CREATIVE_SYSTEM_PROMPT,
  CREATIVE_TIMEOUT_MS, creativeKeyOf, creativePeerOf, creativeUserPayload, parseProviderCreative, payloadLeaks,
  CREATIVE_BATCH_COST_CAP_USD, CREATIVE_BATCH_MAX_OUTPUT_TOKENS, CREATIVE_BATCH_SYSTEM_PROMPT, CREATIVE_BATCH_TIMEOUT_MS,
  creativeBatchPayload, parseCreativeBatch,
  type CompactPeer, type CreativeBrief, type CreativePeer,
} from '../../src/lib/persona-creative'
import type { PersonaCreative } from '../../src/lib/persona-autogen'
import type { LlmRequest, LlmResponse } from './voice-m3-provider.mjs'

export type CreativeCall = (req: LlmRequest) => Promise<LlmResponse>

export type CreativeOutcome = {
  code: string
  /**
   * generated      형식 검증을 통과한 creative — 🔴 판정은 아직이다(`judgeAutogenBatch`)
   * invalid        응답은 왔으나 엄격한 형식 · 중복 검사를 통과하지 못했다
   * call-failed    provider 실패 · 잘림 — 재시도하지 않는다
   * budget-blocked 부르기 전에 상한에 막혔다 (호출 0)
   * leak-blocked   나가는 글에 원문이 실려 부르지 않았다 (호출 0)
   */
  status: 'generated' | 'invalid' | 'call-failed' | 'budget-blocked' | 'leak-blocked'
  problems: string[]
  creative: PersonaCreative | null
  usd: number | null
}

export type CreativeLedger = {
  calls: number
  inputTokens: number
  outputTokens: number
  /** 🔴 실제 비용 합 — 한 건이라도 모르면 null */
  usd: number | null
  /**
   * 🔴 부른 호출 중 **가장 큰 1회 최악 예약액**. 상한 판정은 `지금까지 실제 지출 + 다음 1회 최악 예약 ≤ 상한` 이다 —
   *    예약액을 더한 합은 상한 판정에 쓰이지 않고 상한보다 크게 보여 오해를 낳아 지웠다
   */
  maxReserveUsd: number
  capUsd: number
}

export type CreativeRun =
  | { ok: true; outcomes: CreativeOutcome[]; ledger: CreativeLedger }
  | { ok: false; reason: string; ledger: CreativeLedger }

const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf-8')

/**
 * 🔴 **한 실행.** 브리프는 코드순으로 한 번씩만 부른다. 앞서 생성된 creative 는 뒤 후보의 피할 대상에 더한다.
 *    `forbiddenTextsOf` — 그 후보 말투 묶음의 댓글 원문(나가는 글 대조용 · 밖으로 나가지 않는다).
 *    `avoid` — 기존 Persona 카드 + 앞 실행에서 보존한 creative(전체 칸). 이번 실행의 생성분은 여기에 이어 붙는다.
 */
export async function generateCreatives(input: {
  briefs: readonly CreativeBrief[]
  avoid: readonly CreativePeer[]
  forbiddenTextsOf: (code: string) => readonly string[]
  call: CreativeCall
  capUsd?: number
  maxCandidates?: number
}): Promise<CreativeRun> {
  const cap = input.capUsd ?? CREATIVE_COST_CAP_USD
  const max = input.maxCandidates ?? CREATIVE_MAX_CANDIDATES
  const ledger: CreativeLedger = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, maxReserveUsd: 0, capUsd: cap }
  if (input.briefs.length > max) {
    return { ok: false, reason: `후보 ${input.briefs.length}명 > 상한 ${max}명 — 한 번도 부르지 않았다`, ledger }
  }
  if (new Set(input.briefs.map((b) => b.code)).size !== input.briefs.length) {
    return { ok: false, reason: '같은 코드가 두 번 있다 — 한 번도 부르지 않았다', ledger }
  }
  const briefs = [...input.briefs].sort((a, b) => a.code.localeCompare(b.code))
  const avoid: CreativePeer[] = [...input.avoid]
  const seen = new Set<string>()
  const outcomes: CreativeOutcome[] = []
  let stopped: string | null = null

  for (const brief of briefs) {
    const blocked = (status: CreativeOutcome['status'], why: string): void => {
      outcomes.push({ code: brief.code, status, problems: [why], creative: null, usd: null })
    }
    if (stopped !== null) { blocked('budget-blocked', stopped); continue }

    const userPayload = creativeUserPayload(brief, avoid)
    const leaks = payloadLeaks(userPayload, input.forbiddenTextsOf(brief.code))
    if (leaks > 0) { blocked('leak-blocked', `나가는 글에 댓글 원문 ${leaks}건 — 부르지 않았다`); continue }

    // 🔴 호출 전 최악 예약 — 입력은 UTF-8 바이트 수(토큰 수 이상) · 출력은 max_tokens(넘을 수 없다)
    const reserve = reserveOf({
      model: CREATIVE_MODEL, countedInputTokens: utf8Bytes(CREATIVE_SYSTEM_PROMPT) + utf8Bytes(userPayload),
      maxOutputTokens: CREATIVE_MAX_OUTPUT_TOKENS, headroomMultiplier: 1,
    })
    if (!reserve.known) { stopped = `예약액을 계산하지 못했다 — ${reserve.reason}`; blocked('budget-blocked', stopped); continue }
    const spent = ledger.usd ?? Number.POSITIVE_INFINITY
    if (spent + reserve.usd > cap) {
      stopped = `지출 $${spent.toFixed(4)} + 다음 최악 예약 $${reserve.usd.toFixed(4)} > 상한 $${cap.toFixed(2)}`
      blocked('budget-blocked', stopped)
      continue
    }

    ledger.calls += 1
    ledger.maxReserveUsd = Math.max(ledger.maxReserveUsd, reserve.usd)
    const res = await input.call({
      model: CREATIVE_MODEL, systemPrompt: CREATIVE_SYSTEM_PROMPT, userPayload,
      maxOutputTokens: CREATIVE_MAX_OUTPUT_TOKENS, timeoutMs: CREATIVE_TIMEOUT_MS,
    })
    const cost = res.usageKnown
      ? costOf({ model: CREATIVE_MODEL, usage: {
        inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        cacheWriteTokens: res.cacheWriteTokens, cacheReadTokens: res.cacheReadTokens,
      } })
      : null
    const usd = cost !== null && cost.known ? cost.usd : null
    if (usd === null) {
      ledger.usd = null
      // 🔴 비용을 모르면 상한을 지킬 수 없다 — 뒤 후보는 부르지 않는다
      stopped = '앞 호출의 사용량 · 비용을 읽지 못했다 — 상한을 지킬 근거가 없다'
    } else {
      ledger.inputTokens += res.inputTokens
      ledger.outputTokens += res.outputTokens
      if (ledger.usd !== null) ledger.usd += usd
    }

    if (!res.ok || res.maxTokensReached) {
      outcomes.push({ code: brief.code, status: 'call-failed', creative: null, usd,
        problems: [res.maxTokensReached ? '출력 상한에 닿았다(잘림)' : `${res.errorCode ?? 'ERROR'}`] })
      continue
    }
    // 🔴 provider 출력 계약(말버릇 글자만) → 정본 형식 — batch 와 같은 파서
    const parsed = parseProviderCreative(res.rawText)
    if (!parsed.ok) { outcomes.push({ code: brief.code, status: 'invalid', creative: null, usd, problems: parsed.problems }); continue }
    const key = creativeKeyOf(parsed.creative)
    if (seen.has(key)) {
      outcomes.push({ code: brief.code, status: 'invalid', creative: null, usd, problems: ['앞 후보와 글자까지 같은 creative'] })
      continue
    }
    seen.add(key)
    avoid.push(creativePeerOf(brief.code, parsed.creative))
    outcomes.push({ code: brief.code, status: 'generated', creative: parsed.creative, usd, problems: [] })
  }
  return { ok: true, outcomes, ledger }
}

/** 🔴 생성 실패를 판정 코드로 — `LLM_STEP_UNIMPLEMENTED`(돌지 않았다)와 가른다 */
export const CREATIVE_BLOCK_OF = {
  invalid: 'CREATIVE_INVALID',
  'call-failed': 'CREATIVE_CALL_FAILED',
  'budget-blocked': 'CREATIVE_BUDGET_BLOCKED',
  'leak-blocked': 'CREATIVE_LEAK_BLOCKED',
} as const

// ─────────────────────────────────────────────────────────
// 🔴 batch — 후보 전원을 **provider 호출 정확히 1회**로 함께 설계한다 (2026-10-06)
// ─────────────────────────────────────────────────────────

export type CreativeBatchRun =
  | {
    ok: true
    /** 구조 · 후보 형식이 전부 맞았는가 — 아니면 batch invalid(통과한 후보만 결과 파일에 남는다) */
    status: 'parsed' | 'invalid' | 'call-failed'
    creatives: Record<string, PersonaCreative>
    problems: string[]
    ledger: CreativeLedger
    /**
     * 🔴 **실패 진단용 provider 응답 글** — 형식 · 품질 실패를 사후에 볼 수 있게 남긴다.
     *    입력에 댓글 원문 · 화자 · 회원 · 표시명 칸이 없으므로 응답에도 없다 — 그래도 이 후보들 묶음의 댓글 원문이
     *    하나라도 그대로 들어 있으면 남기지 않는다(`null` · `providerTextWithheld`).
     */
    providerText: string | null
    providerTextWithheld: string | null
  }
  | { ok: false; reason: string; ledger: CreativeLedger }

export async function generateCreativeBatch(input: {
  briefs: readonly CreativeBrief[]
  avoid: readonly CompactPeer[]
  forbiddenTextsOf: (code: string) => readonly string[]
  call: CreativeCall
  capUsd?: number
  maxCandidates?: number
}): Promise<CreativeBatchRun> {
  const cap = Math.min(input.capUsd ?? CREATIVE_BATCH_COST_CAP_USD, CREATIVE_BATCH_COST_CAP_USD)
  const max = input.maxCandidates ?? CREATIVE_MAX_CANDIDATES
  const ledger: CreativeLedger = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, maxReserveUsd: 0, capUsd: cap }
  const codes = input.briefs.map((b) => b.code).sort()
  if (codes.length === 0) return { ok: false, reason: '후보가 없다 — 부르지 않았다', ledger }
  if (codes.length > max) return { ok: false, reason: `후보 ${codes.length}명 > 상한 ${max}명 — 부르지 않았다`, ledger }
  if (new Set(codes).size !== codes.length) return { ok: false, reason: '같은 코드가 두 번 있다 — 부르지 않았다', ledger }

  const briefs = [...input.briefs].sort((a, b) => a.code.localeCompare(b.code))
  const userPayload = creativeBatchPayload(briefs, input.avoid)
  const leaks = codes.reduce((n, c) => n + payloadLeaks(userPayload, input.forbiddenTextsOf(c)), 0)
  if (leaks > 0) return { ok: false, reason: `나가는 글에 댓글 원문 ${leaks}건 — 부르지 않았다`, ledger }

  // 🔴 호출 전 최악 예약 — 입력 UTF-8 바이트(토큰 수 이상) + 출력 상한. 상한을 넘으면 호출 0
  const reserve = reserveOf({
    model: CREATIVE_MODEL,
    countedInputTokens: Buffer.byteLength(CREATIVE_BATCH_SYSTEM_PROMPT, 'utf-8') + Buffer.byteLength(userPayload, 'utf-8'),
    maxOutputTokens: CREATIVE_BATCH_MAX_OUTPUT_TOKENS, headroomMultiplier: 1,
  })
  if (!reserve.known) return { ok: false, reason: `예약액을 계산하지 못했다 — ${reserve.reason}`, ledger }
  if (reserve.usd > cap) {
    return { ok: false, reason: `최악 예약 $${reserve.usd.toFixed(4)} > batch 상한 $${cap.toFixed(4)} — 부르지 않았다`, ledger }
  }

  ledger.calls = 1
  ledger.maxReserveUsd = reserve.usd
  const res = await input.call({
    model: CREATIVE_MODEL, systemPrompt: CREATIVE_BATCH_SYSTEM_PROMPT, userPayload,
    maxOutputTokens: CREATIVE_BATCH_MAX_OUTPUT_TOKENS, timeoutMs: CREATIVE_BATCH_TIMEOUT_MS,
  })
  const cost = res.usageKnown
    ? costOf({ model: CREATIVE_MODEL, usage: {
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      cacheWriteTokens: res.cacheWriteTokens, cacheReadTokens: res.cacheReadTokens,
    } })
    : null
  if (cost !== null && cost.known) {
    ledger.usd = cost.usd
    ledger.inputTokens = res.inputTokens
    ledger.outputTokens = res.outputTokens
  } else ledger.usd = null

  const leaked = codes.reduce((n, c) => n + payloadLeaks(res.rawText, input.forbiddenTextsOf(c)), 0)
  const providerText = leaked === 0 ? res.rawText : null
  const providerTextWithheld = leaked === 0 ? null : `응답에 댓글 원문 ${leaked}건이 그대로 있어 남기지 않았다`
  const keep = { providerText, providerTextWithheld }

  // 🔴 재시도 0 — 실패 · 잘림은 batch 전체가 creative 0 으로 끝난다
  if (!res.ok || res.maxTokensReached) {
    return { ok: true, status: 'call-failed', creatives: {}, ledger, ...keep,
      problems: [res.maxTokensReached ? '출력 상한에 닿았다(잘림)' : `${res.errorCode ?? 'ERROR'}`] }
  }
  const parsed = parseCreativeBatch(res.rawText, codes)
  if (!parsed.structuralOk) return { ok: true, status: 'invalid', creatives: {}, ledger, problems: parsed.problems, ...keep }
  const problems = Object.entries(parsed.invalid).map(([c, ps]) => `${c}: ${ps.join(' / ')}`)
  // 같은 batch 안 글자까지 같은 creative — 뒤 코드를 버린다
  const seen = new Map<string, string>()
  const creatives: Record<string, PersonaCreative> = {}
  for (const [c, cr] of Object.entries(parsed.creatives).sort(([a], [b]) => a.localeCompare(b))) {
    const k = creativeKeyOf(cr)
    if (seen.has(k)) { problems.push(`${c}: ${seen.get(k)} 와 글자까지 같은 creative`); continue }
    seen.set(k, c)
    creatives[c] = cr
  }
  return { ok: true, status: problems.length === 0 ? 'parsed' : 'invalid', creatives, problems, ledger, ...keep }
}

/**
 * 🔴 batch 결과 → 후보별 결과(`CreativeOutcome`) — 판정 매핑 · 보고 · 결과 파일이 개별 경로와 **같은 코드**를 쓰게.
 *    부르지 못한 batch(상한 · 유출 · 후보 수)는 전원 그 사유로 막힌다.
 */
export function outcomesOfBatch(run: CreativeBatchRun, codes: readonly string[]): CreativeOutcome[] {
  if (!run.ok) {
    const status: CreativeOutcome['status'] = /원문/.test(run.reason) ? 'leak-blocked' : 'budget-blocked'
    return codes.map((code) => ({ code, status, problems: [run.reason], creative: null, usd: null }))
  }
  return codes.map((code) => {
    const c = run.creatives[code]
    if (c !== undefined) return { code, status: 'generated', problems: [], creative: c, usd: null }
    const mine = run.problems.filter((p) => p.startsWith(`${code}:`))
    return { code, status: run.status === 'call-failed' ? 'call-failed' : 'invalid', creative: null, usd: null,
      problems: mine.length > 0 ? mine : run.problems }
  })
}
