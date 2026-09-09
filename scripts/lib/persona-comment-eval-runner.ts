/**
 * 모델 비교 **실행기** — 🔴 provider 를 주입받는다
 *
 * 🔴 **왜 주입인가.**
 *
 *    옛 판의 `--call` 은 `callProvider` 를 한 번도 부르지 않고 `called: false` 를
 *    파일에 고정해 적었다. 부르지 않는 실행기는 실행기가 아니다.
 *    그렇다고 진짜 provider 를 붙들고 있으면 CI 가 그것을 시험할 수 없다 —
 *    호출 수 상한·비용 상한·중단 조건은 **행동으로** 확인해야 하는 것들이다.
 *    그래서 호출을 인터페이스로 빼고, CI 는 가짜를, 운영은 진짜를 넣는다.
 *
 * 🔴 **같은 입력·같은 Persona 로만 비교한다.** 모델마다 다른 글을 주면
 *    그것은 모델 비교가 아니라 글 비교다.
 *
 * 🔴 provider 오류에 재시도하지 않고, 다른 모델로 자동 대체하지 않는다.
 *    실패는 실패로 적는다 — 대체하면 "어느 모델이 답했는가" 를 잃는다.
 */
import type { CommentInput } from '../../src/lib/persona-comment-input'
import {
  estimateCost, judgeModelSelection, judgeSpend,
  type CostEstimate, type ModelPrice, type ModelVerdict,
} from '../../src/lib/persona-comment-cost'

/** 한 번의 호출 결과. 🔴 usage 는 provider 가 돌려준 실측이다 */
export type EvalCallResult = {
  ok: boolean
  /** 모델이 만든 원문 — 🔴 호출부가 파싱·Gate 로 넘긴다. artifact 에는 저장하지 않는다 */
  rawText: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number | null
  latencyMs: number
  errorCode: string | null
  errorMessage: string | null
}

/** 🔴 주입되는 호출자. CI 는 가짜, 운영은 `callProvider` 를 감싼 것 */
export type EvalCaller = (args: {
  model: string
  input: CommentInput
  index: number
}) => Promise<EvalCallResult>

/** 생성물 한 건에 대한 판정 — 호출부가 기존 파서·Gate 로 채운다 */
export type EvalJudged = {
  parseOk: boolean
  gateStatus: string | null
  gateHits: readonly string[]
  textLength: number | null
  /** 🔴 말투 지문 — 같은 모델이 계속 같은 문장을 내는지 본다 */
  textFingerprint: string | null
  failure: string | null
  /**
   * 🔴 **생성된 댓글 본문.** 사람이 7개 축을 채점하려면 결과물을 읽어야 한다 —
   *    지문과 통과율만으로는 "그 사람 목소리인가" 를 잴 수 없다.
   *    🔴 합성 입력의 생성물이므로 실회원 정보가 아니다.
   */
  text: string | null
  /** 9관문 전체 결과 — notRun 을 pass 로 세지 않기 위해 그대로 남긴다 */
  gateLines: readonly { gate: string; outcome: string }[]
  /** 필수 관문 중 돌지 않은 것 */
  missingRequired: readonly string[]
  /**
   * 🔴 **돌아간 관문만 봤을 때** pass 인가. `checkCommentCandidate.status` 다.
   *    이것만 보고 "Gate 통과" 로 세면 **보지 않은 관문을 통과로 세는 것**이 된다.
   */
  statusPass: boolean
  /** 🔴 필수 관문이 전부 돌았고 전부 pass 인가 — "9관문 통과" 는 이것뿐이다 */
  fullGatePass: boolean
  /** ⑧ 만 대조 표본이 없어 사람 승인 Queue 로 갈 수 있는가 */
  bootstrapReviewEligible: boolean
}

export type EvalJudge = (args: { rawText: string; input: CommentInput }) => EvalJudged

export type EvalSample = EvalJudged & {
  model: string
  personaCode: string
  reactionRole: string
  inputFingerprint: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number | null
  latencyMs: number
  /** 🔴 blind review 용 라벨. 사람이 모델명을 모르고 읽도록 */
  blindLabel: string
}

export type EvalModelResult = {
  model: string
  calls: number
  ok: number
  parseOk: number
  /**
   * 🔴 이름을 바꿨다. 옛 이름은 `gatePass` 였고, 호출부가 `status === 'pass'` 만 보고
   *    ⑧ 이 notRun 인 20표본을 전부 "Gate pass" 로 셌다(2026-09-09 실측).
   *    이름이 모호하면 세는 사람이 무엇을 세는지 모른다.
   */
  statusPassCount: number
  /** 🔴 필수 관문이 전부 돌았고 전부 pass 인 건수 — 진짜 "9관문 통과" */
  fullGatePassCount: number
  /** ⑧ 만 못 돈 건수 — 사람 승인 Queue 후보 */
  bootstrapCount: number
  /** 필수 관문이 돌지 않은 건수 */
  missingRequiredCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  latencyMsTotal: number
  /** 🔴 실측 usage 로 다시 계산한 비용 */
  actualUsd: number | null
  /** 같은 지문이 몇 번 반복됐는가 — 클수록 같은 말을 되풀이한 것이다 */
  duplicateTexts: number
  failures: string[]
}

export type EvalRunResult = {
  called: boolean
  totalCalls: number
  totalActualUsd: number | null
  perModel: EvalModelResult[]
  samples: EvalSample[]
  selection: ReturnType<typeof judgeModelSelection>
  stoppedReason: string | null
}

/** 🔴 실측 usage 로 비용을 다시 센다. 추정과 섞지 않는다 */
export function actualCost(price: ModelPrice | null, inputTokens: number, outputTokens: number): number | null {
  if (price === null) return null
  if (!Number.isFinite(price.inputPerMTok) || !Number.isFinite(price.outputPerMTok)) return null
  const usd = (inputTokens / 1_000_000) * price.inputPerMTok + (outputTokens / 1_000_000) * price.outputPerMTok
  return Math.round(usd * 1_000_000) / 1_000_000
}

/** 🔴 blind 라벨 — 모델명을 가린다. 순서가 곧 정답이 되지 않게 index 를 섞지 않는다 */
export const blindLabelOf = (modelIndex: number): string => String.fromCharCode(65 + modelIndex)

/** 아주 짧은 텍스트 지문 — 중복 판별용 */
export function textFingerprint(t: string): string {
  const norm = t.replace(/\s+/gu, ' ').trim()
  let h = 2166136261
  for (let i = 0; i < norm.length; i += 1) {
    h ^= norm.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * 🔴 **비교를 실제로 돌린다.**
 *
 *    · 지출 판정이 막으면 **한 번도 부르지 않는다**
 *    · 호출 수 상한에 닿으면 **거기서 멈춘다** (다음 모델로 넘어가지 않는다)
 *    · 실측 비용이 상한을 넘으면 **그 자리에서 멈춘다** — 추정이 틀릴 수 있기 때문이다
 */
export async function runEval(args: {
  models: readonly { label: string; price: ModelPrice | null }[]
  /** 🔴 모든 모델이 **같은** 입력을 받는다 */
  inputs: readonly CommentInput[]
  call: EvalCaller
  judge: EvalJudge
  keysReady: boolean | null
  maxCalls: number
  maxUsd: number
}): Promise<EvalRunResult> {
  const estimates = args.models.map((m) => estimateCost({ price: m.price, calls: args.inputs.length }))
  const spend = judgeSpend({
    estimates, keysReady: args.keysReady, maxCalls: args.maxCalls, maxUsd: args.maxUsd,
  })
  const perModel: EvalModelResult[] = args.models.map((m) => ({
    model: m.label, calls: 0, ok: 0, parseOk: 0,
    statusPassCount: 0, fullGatePassCount: 0, bootstrapCount: 0, missingRequiredCount: 0,
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0, latencyMsTotal: 0,
    actualUsd: null, duplicateTexts: 0, failures: [],
  }))
  const samples: EvalSample[] = []

  if (!spend.allowed) {
    return {
      called: false, totalCalls: 0, totalActualUsd: null, perModel, samples,
      // 🔴 점수가 하나도 없으면 winner 도 null 이어야 한다
      selection: judgeModelSelection({ verdicts: [] }),
      stoppedReason: spend.reason,
    }
  }

  let totalCalls = 0
  let totalUsd = 0
  let stoppedReason: string | null = null

  outer: for (const [mi, m] of args.models.entries()) {
    const seen = new Set<string>()
    for (const [ii, input] of args.inputs.entries()) {
      if (totalCalls >= args.maxCalls) { stoppedReason = `호출 상한 ${args.maxCalls}회에 닿아 멈췄다`; break outer }
      if (totalUsd > args.maxUsd) { stoppedReason = `실측 비용이 상한 $${args.maxUsd}를 넘어 멈췄다`; break outer }

      const res = await args.call({ model: m.label, input, index: ii })
      totalCalls += 1
      const row = perModel[mi]!
      row.calls += 1
      row.inputTokens += res.inputTokens
      row.outputTokens += res.outputTokens
      row.reasoningTokens += res.reasoningTokens ?? 0
      row.latencyMsTotal += res.latencyMs
      const spent = actualCost(m.price, res.inputTokens, res.outputTokens)
      if (spent !== null) totalUsd = Math.round((totalUsd + spent) * 1_000_000) / 1_000_000

      if (!res.ok) {
        // 🔴 재시도하지 않는다. 다른 모델로 대체하지 않는다
        row.failures.push(`${res.errorCode ?? 'UNKNOWN'}${res.errorMessage === null ? '' : `: ${res.errorMessage}`}`)
        continue
      }
      row.ok += 1
      const judged = args.judge({ rawText: res.rawText, input })
      if (judged.parseOk) row.parseOk += 1
      // 🔴 셋을 따로 센다. 하나로 세면 "보지 않은 것" 이 "통과" 에 섞인다
      if (judged.statusPass) row.statusPassCount += 1
      if (judged.fullGatePass) row.fullGatePassCount += 1
      if (judged.bootstrapReviewEligible) row.bootstrapCount += 1
      if (judged.missingRequired.length > 0) row.missingRequiredCount += 1
      if (judged.failure !== null) row.failures.push(judged.failure)
      if (judged.textFingerprint !== null) {
        if (seen.has(judged.textFingerprint)) row.duplicateTexts += 1
        seen.add(judged.textFingerprint)
      }
      samples.push({
        ...judged,
        model: m.label,
        personaCode: input.personaCode,
        reactionRole: input.reactionRole,
        inputFingerprint: input.fingerprint,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        reasoningTokens: res.reasoningTokens,
        latencyMs: res.latencyMs,
        blindLabel: blindLabelOf(mi),
      })
    }
  }

  for (const [mi, m] of args.models.entries()) {
    const row = perModel[mi]!
    row.actualUsd = actualCost(m.price, row.inputTokens, row.outputTokens)
  }

  /**
   * 🔴 **사람이 채점하기 전에는 confirmed 가 아니다.**
   *    parse 율·Gate 통과율은 안전 지표이지 "그 사람 목소리인가" 를 재지 못한다.
   *    축이 하나도 채워지지 않았으므로 `complete: false` 이고, 점수가 없으니 winner 는 null 이다.
   */
  const verdicts: ModelVerdict[] = perModel.map((r) => ({
    model: r.model, scores: {}, complete: false, samples: r.ok,
  }))
  const selection = samples.length === 0
    ? judgeModelSelection({ verdicts: [] })
    : judgeModelSelection({ verdicts })

  return {
    called: totalCalls > 0,
    totalCalls,
    totalActualUsd: Math.round(totalUsd * 1_000_000) / 1_000_000,
    perModel,
    samples,
    selection,
    stoppedReason,
  }
}

export type { CostEstimate }
