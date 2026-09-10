/**
 * Persona 댓글 **모델·비용 원장** — 🔴 순수 함수. 네트워크 · DB 없음
 *
 * 🔴 **왜 한 곳에 모으는가.**
 *
 *    모델 이름과 단가가 코드 여기저기에 흩어지면, 어느 순간 "얼마 안 나온다" 는 말이
 *    근거 없이 돌아다닌다. 실제로 이 저장소는 내부 라벨을 그대로 API 에 보내
 *    30건이 전부 404 로 죽은 적이 있다(2026-08-27). 이름과 값은 한 곳에서만 읽는다.
 *
 * 🔴 단가의 정본은 `scripts/lib/voice-m3-contract.mts` 의 `M3_MODEL_CANDIDATES` 다.
 *    여기서 숫자를 **다시 적지 않는다** — 두 벌이 되면 한쪽이 조용히 낡는다.
 *    이 파일은 그 표를 받아 **댓글 작업의 호출량·비용**을 계산한다.
 *
 * 🔴 가격은 바뀐다. 실행 직전에 정본 표의 `checkedAt` 을 사람이 한 번 더 본다.
 */

/** 정본 표에서 받아 오는 모양. 🔴 숫자를 여기 하드코딩하지 않는다 */
export type ModelPrice = {
  /** 내부 라벨 — 보고·비교의 축 */
  label: string
  /** 🔴 provider 요청 body.model 전용. 내부 라벨과 다를 수 있다 */
  apiModelId: string
  inputPerMTok: number
  outputPerMTok: number
  source: string
  checkedAt: string
}

/** 한 번 호출할 때의 토큰 추정 */
export type CallShape = {
  inputTokens: number
  outputTokens: number
}

/**
 * 🔴 댓글 한 건의 토큰 규모(추정).
 *
 *    system(페르소나 설정 + 말투 근거) + user(글 요약 + 기존 댓글 문맥) 를 합친 값이다.
 *    실제 호출에서 usage 가 돌아오면 그 값으로 대체한다 — 추정은 추정이라고 적는다.
 */
export const COMMENT_CALL_SHAPE: CallShape = { inputTokens: 1_400, outputTokens: 220 }

export type CostEstimate = {
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  usd: number
  /** 실측인가 추정인가 — 🔴 섞어서 보고하지 않는다 */
  basis: 'estimated' | 'measured'
}

/** 🔴 단가를 못 읽으면 계산하지 않는다. 0 으로 보고하면 "공짜" 로 읽힌다 */
export function estimateCost(input: {
  price: ModelPrice | null
  calls: number
  shape?: CallShape
  basis?: 'estimated' | 'measured'
}): { ok: true; estimate: CostEstimate } | { ok: false; reason: string } {
  if (input.price === null) {
    return { ok: false, reason: '모델 단가를 읽지 못했다 — 비용을 계산할 수 없다' }
  }
  const { inputPerMTok, outputPerMTok } = input.price
  if (!Number.isFinite(inputPerMTok) || !Number.isFinite(outputPerMTok)
    || inputPerMTok < 0 || outputPerMTok < 0) {
    return { ok: false, reason: `${input.price.label} 의 단가가 손상됐다` }
  }
  if (!Number.isFinite(input.calls) || input.calls < 0) {
    return { ok: false, reason: '호출 수가 손상됐다' }
  }
  const shape = input.shape ?? COMMENT_CALL_SHAPE
  const inputTokens = shape.inputTokens * input.calls
  const outputTokens = shape.outputTokens * input.calls
  const usd = (inputTokens / 1_000_000) * inputPerMTok + (outputTokens / 1_000_000) * outputPerMTok
  return {
    ok: true,
    estimate: {
      model: input.price.label,
      calls: input.calls,
      inputTokens,
      outputTokens,
      // 🔴 센트 단위로 반올림하지 않는다. $0.004 가 $0.00 으로 보이면 안 된다
      usd: Math.round(usd * 1_000_000) / 1_000_000,
      basis: input.basis ?? 'estimated',
    },
  }
}

/** 🔴 유료 실험의 상한. 창업자가 정한 값이다 */
export const EVAL_MAX_CALLS = 30
export const EVAL_MAX_USD = 3

export type SpendVerdict = {
  allowed: boolean
  reason: string
  totalUsd: number | null
}

/**
 * 🔴 **비용을 계산할 수 없으면 호출하지 않는다.**
 *
 *    "얼마인지 모르지만 적을 것이다" 로 유료 API 를 부르지 않는다.
 *    key 가 없거나 provider 상태가 불명확할 때도 마찬가지다 —
 *    그럴 때는 harness 까지만 만들고 멈춘다.
 */
export function judgeSpend(input: {
  estimates: readonly ({ ok: true; estimate: CostEstimate } | { ok: false; reason: string })[]
  /** provider key 가 준비됐는가. 모르면 null */
  keysReady: boolean | null
  maxCalls?: number
  maxUsd?: number
}): SpendVerdict {
  const maxCalls = input.maxCalls ?? EVAL_MAX_CALLS
  const maxUsd = input.maxUsd ?? EVAL_MAX_USD

  const failed = input.estimates.filter((e) => !e.ok)
  if (failed.length > 0) {
    return {
      allowed: false,
      totalUsd: null,
      reason: `비용을 계산하지 못한 모델이 있다 — 호출하지 않는다: ${failed.map((f) => (f as { reason: string }).reason).join(' / ')}`,
    }
  }
  if (input.keysReady === null) {
    return { allowed: false, totalUsd: null, reason: 'provider key 상태가 불명확하다 — 호출하지 않는다(fail-closed)' }
  }
  if (!input.keysReady) {
    return { allowed: false, totalUsd: null, reason: 'provider key 가 없다 — harness 까지만 만들고 호출하지 않는다' }
  }
  const ok = input.estimates as { ok: true; estimate: CostEstimate }[]
  const calls = ok.reduce((a, e) => a + e.estimate.calls, 0)
  const usd = Math.round(ok.reduce((a, e) => a + e.estimate.usd, 0) * 1_000_000) / 1_000_000
  if (calls > maxCalls) {
    return { allowed: false, totalUsd: usd, reason: `총 호출 ${calls}회 — 상한 ${maxCalls}회를 넘는다` }
  }
  if (usd > maxUsd) {
    return { allowed: false, totalUsd: usd, reason: `예상 총비용 $${usd} — 상한 $${maxUsd}를 넘는다` }
  }
  return { allowed: true, totalUsd: usd, reason: `총 ${calls}회 · 예상 $${usd} — 상한 안이다` }
}

// ─────────────────────────────────────────────────────────
// 🔴 모델 비교 채점
// ─────────────────────────────────────────────────────────

/** 평가 축. 🔴 비용·latency 는 품질과 **따로** 본다 — 싸다고 좋은 것이 아니다 */
export const EVAL_AXES = [
  'personaIdentity',
  'voiceSimilarity',
  'contextFit',
  'clicheAvoidance',
  'noOverAdvice',
  'noImpersonation',
  'koreanNaturalness',
] as const
export type EvalAxis = (typeof EVAL_AXES)[number]

export type EvalScore = Partial<Record<EvalAxis, number>>

/**
 * 🔴 **사람이 공개 불가로 본 이유** (2026-09-10, Wave E).
 *
 *    옛 채점기는 1~5 밖에 없었다. 형편없는 후보에도 숫자를 줘야 했고,
 *    그래서 **절대 품질 탈락을 표현할 방법이 아예 없었다** —
 *    창업자 채점 메모가 *"판단할 수 없을정도로 최악의 댓글"* 이라고 적었는데
 *    파일에는 `2점` 으로 남았다. 2점은 "조금 나쁨" 으로 읽힌다.
 *    그 차이가 평균을 만들고, 평균이 winner 를 만든다.
 */
export const REJECT_REASONS = [
  /** 매번 같은 AI 도입부 (`빨래 개다 말고 문득 생각나서`) */
  'REPEATED_AI_OPENER',
  /** 원글에 없는 생활 장면·개인 경험을 지어냄 */
  'FABRICATED_SCENE',
  /** 지나치게 정돈된 완결 문장 — 사람이 쓴 것으로 읽히지 않음 */
  'OVER_POLISHED',
  /** 원글 맥락과 어긋남 */
  'OFF_CONTEXT',
  'OTHER',
] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

export type ModelVerdict = {
  model: string
  /** 축별 평균 — 못 잰 축은 빠진다 */
  scores: EvalScore
  /** 모든 축을 쟀는가. 🔴 하나라도 못 쟀으면 확정하지 않는다 */
  complete: boolean
  samples: number
  /** 🔴 사람이 **공개 불가**로 판정한 후보 수. 점수와 별개 축이다 */
  rejected?: number
  /** 사유별 건수 — 무엇이 반복됐는지 남긴다 */
  rejectReasons?: Partial<Record<RejectReason, number>>
}

/**
 * 🔴 **절대 품질 기준.** 상대 비교보다 먼저 온다.
 *
 *    이 비율을 넘게 공개 불가가 나오면 그 모델은 **비교 대상이 아니다** —
 *    다른 모델보다 나아도 공개할 수 없는 것은 공개할 수 없다.
 */
export const ABSOLUTE_REJECT_MAX_RATIO = 0.2

export type AbsoluteQuality =
  | { pass: true; rejected: number; ratio: number; reason: string }
  | { pass: false; rejected: number; ratio: number; reason: string }

/**
 * 🔴 **Gate 통과는 사람 품질 통과가 아니다.**
 *    9관문은 안전·유출·설정 모순을 본다. "사람이 쓴 것처럼 읽히는가" 는 보지 않는다.
 *    `20260909-181515` 는 gateStatus 가 전부 `pass` 였고 사람 판정은 전부 미달이었다.
 */
export function judgeAbsoluteQuality(v: ModelVerdict): AbsoluteQuality {
  const rejected = v.rejected ?? 0
  const ratio = v.samples > 0 ? rejected / v.samples : 0
  if (v.samples === 0) {
    return { pass: false, rejected, ratio, reason: `${v.model}: 표본이 없다` }
  }
  if (ratio > ABSOLUTE_REJECT_MAX_RATIO) {
    const top = Object.entries(v.rejectReasons ?? {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, n]) => `${k} ${n}건`).join(' · ')
    return {
      pass: false, rejected, ratio,
      reason: `${v.model}: 공개 불가 ${rejected}/${v.samples}`
        + ` (${Math.round(ratio * 100)}% · 상한 ${Math.round(ABSOLUTE_REJECT_MAX_RATIO * 100)}%)`
        + (top === '' ? '' : ` — ${top}`),
    }
  }
  return {
    pass: true, rejected, ratio,
    reason: `${v.model}: 공개 불가 ${rejected}/${v.samples} — 절대 기준 안이다`,
  }
}

/**
 * 🔴 **부족한 비교로 모델을 확정하지 않는다.**
 *
 *    축이 비었거나 표본이 모자라면 `provisional` 이다. 그 상태를 감추고 하나를 고르면
 *    나중에 "그때 정했다" 는 근거 없는 기준이 남는다.
 */
export function judgeModelSelection(input: {
  verdicts: readonly ModelVerdict[]
  /** 확정에 필요한 최소 표본 수 */
  minSamples?: number
}): {
  status: 'confirmed' | 'provisional' | 'none'
  winner: string | null
  reason: string
  /** 🔴 절대 품질에서 떨어진 모델 — 상대 비교에 들어가지 못한다 */
  rejectedModels?: string[]
} {
  const minSamples = input.minSamples ?? 20
  if (input.verdicts.length === 0) {
    return { status: 'none', winner: null, reason: '비교 결과가 없다' }
  }
  /**
   * 🔴 **절대 품질을 먼저 본다.**
   *    상대 비교는 "공개할 수 있는 것들 중 무엇이 나은가" 다.
   *    전부 공개할 수 없으면 비교 자체가 성립하지 않는다 — winner 는 null 이다.
   */
  const quality = input.verdicts.map((v) => ({ v, q: judgeAbsoluteQuality(v) }))
  const survivors = quality.filter((x) => x.q.pass).map((x) => x.v)
  const droppedModels = quality.filter((x) => !x.q.pass).map((x) => x.v.model)
  if (survivors.length === 0) {
    return {
      status: 'none',
      winner: null,
      rejectedModels: droppedModels,
      reason: '🔴 모든 모델이 절대 품질 기준에 미달했다 — 우세를 말하지 않는다 · '
        + quality.map((x) => x.q.reason).join(' / '),
    }
  }
  if (droppedModels.length > 0) {
    // 🔴 떨어진 모델은 아예 빼고 남은 것끼리만 본다
    input = { ...input, verdicts: survivors }
  }
  /**
   * 🔴 **점수가 하나도 없으면 winner 도 null 이다.**
   *
   *    옛 판은 축이 전부 비어 평균이 0 이어도 정렬 첫 번째를 winner 로 적었다.
   *    그것은 "지금까지 앞선 모델" 이 아니라 **목록의 첫 줄**이다.
   *    아무도 채점하지 않은 것을 우세로 보고하면, 다음 사람이 그 이름을 근거로 읽는다.
   */
  const anyScored = input.verdicts.some((v) => EVAL_AXES.some((ax) => v.scores[ax] !== undefined))
  if (!anyScored) {
    return {
      status: 'provisional',
      winner: null,
      rejectedModels: droppedModels,
      reason: '채점된 축이 하나도 없다 — 우세한 모델을 말할 수 없다(provisional · winner 없음)',
    }
  }
  /** 🔴 절대 기준을 통과한 것이 하나뿐이면 "비교" 가 아니다 */
  if (survivors.length === 1) {
    return {
      status: 'provisional',
      winner: null,
      rejectedModels: droppedModels,
      reason: `비교 대상이 ${survivors[0]!.model} 하나뿐이다 — 상대 비교가 성립하지 않는다`
        + `(탈락: ${droppedModels.join(' · ')})`,
    }
  }
  const scored = input.verdicts.map((v) => ({
    v,
    mean: EVAL_AXES.reduce((a, ax) => a + (v.scores[ax] ?? 0), 0) / EVAL_AXES.length,
  })).sort((a, b) => b.mean - a.mean)
  const top = scored[0]!
  const enough = input.verdicts.every((v) => v.complete && v.samples >= minSamples)
  if (!enough) {
    return {
      status: 'provisional',
      winner: top.v.model,
      rejectedModels: droppedModels,
      reason: `표본 ${minSamples}건·전 축 채점을 채우지 못했다 — provisional 로 둔다`,
    }
  }
  return {
    status: 'confirmed', winner: top.v.model, rejectedModels: droppedModels,
    reason: `${top.v.model} 가 평균 ${top.mean.toFixed(2)} 로 앞섰다`,
  }
}
