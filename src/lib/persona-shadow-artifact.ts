/**
 * shadow eval **artifact 계약** — 🔴 순수 판정. 파일·DB·네트워크 없음
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-10).
 *
 *    앞선 회차에서 **저장된 artifact 와 보고한 숫자가 달랐다.**
 *      저장  statusPass 18/18 · Gate ②⑦⑧ notRun 18/18
 *      보고  statusPass 8/18 · ② regenerate 10 · ⑦ pass 18
 *    보고 쪽이 맞았지만, 그 숫자는 **콘솔에서 한 번 다시 계산한 것**이었다.
 *    저장된 것과 말한 것이 다르면 나중에 누가 무엇을 믿어야 할지 알 수 없다.
 *
 * 🔴 그래서 갈래를 둘로 나눈다.
 *      · **raw**        provider 가 준 그대로. 한 번 쓰면 바뀌지 않는다
 *      · **judgement**  Gate 재판정. 판정 규칙이 바뀌면 판을 올려 새로 쓴다
 *    보고는 **judgement 를 다시 읽어** 출력한다. 콘솔 재계산을 증거로 쓰지 않는다.
 */

/** 🔴 판정 규칙이 바뀌면 올린다. 옛 판으로 낸 수치와 섞이지 않게 */
export const EVALUATOR_VERSION = 'v1'

export type RawRow = {
  personaCode: string
  role: string
  postId: string
  /** provider 원문. `null` 이면 실패 */
  text: string | null
  ok: boolean
  errorCode: string | null
  latencyMs: number
  inputTokens: number
  outputTokens: number
}

export type RawArtifact = {
  kind: 'raw'
  runId: string
  model: string
  canonRunId: string
  ranAt: string
  /** 🔴 무엇을 넣어 만든 결과인가 */
  inputDigest: string
  actualUsd: number
  rows: RawRow[]
}

export type GateLine = { gate: string; outcome: string }

export type JudgedRow = {
  personaCode: string
  role: string
  postId: string
  /** 🔴 이 Persona 설정이 어디서 왔는가 — 합성인지 정본인지 */
  personaSource: string
  bundleComments: number
  textLength: number
  gateStatus: string | null
  statusPass: boolean
  fullGatePass: boolean
  gateLines: GateLine[]
  notRunGates: string[]
  ungrounded: number
  ungroundedSentences: string[]
}

export type JudgementSummary = {
  rows: number
  statusPass: number
  fullGatePass: number
  ungroundedTotal: number
  gateTally: Record<string, Record<string, number>>
  minStyleDistance: number
  closestPair: string
}

export type JudgementArtifact = {
  kind: 'judgement'
  evaluatorVersion: string
  runId: string
  judgedAt: string
  /** 🔴 어느 raw 를 읽고 판정했는가 */
  rawSha: string
  inputDigest: string
  rows: JudgedRow[]
  /** 🔴 **보고는 이것을 읽는다.** 콘솔에서 다시 세지 않는다 */
  summary: JudgementSummary
}

/** 🔴 판정 행에서 집계를 낸다 — 집계를 손으로 적지 않는다 */
export function summarize(input: {
  rows: readonly JudgedRow[]
  minStyleDistance: number
  closestPair: string
}): JudgementSummary {
  const gateTally: Record<string, Record<string, number>> = {}
  for (const r of input.rows) {
    for (const g of r.gateLines) {
      gateTally[g.gate] = gateTally[g.gate] ?? {}
      gateTally[g.gate]![g.outcome] = (gateTally[g.gate]![g.outcome] ?? 0) + 1
    }
  }
  return {
    rows: input.rows.length,
    statusPass: input.rows.filter((r) => r.statusPass).length,
    fullGatePass: input.rows.filter((r) => r.fullGatePass).length,
    ungroundedTotal: input.rows.reduce((a, r) => a + r.ungrounded, 0),
    gateTally,
    minStyleDistance: input.minStyleDistance,
    closestPair: input.closestPair,
  }
}

export type ArtifactBlockCode =
  | 'SUMMARY_MISMATCH'
  | 'EVALUATOR_VERSION_STALE'
  | 'RAW_SHA_MISMATCH'
  | 'INPUT_DIGEST_MISMATCH'
  | 'ROW_COUNT_MISMATCH'

/**
 * 🔴 **저장된 집계가 저장된 행과 맞는가.**
 *
 *    맞지 않으면 그 artifact 는 스스로 모순이다 — 보고가 어느 쪽을 읽든 틀린다.
 *    CI 가 이것으로 막는다.
 */
export function verifyJudgement(input: {
  judgement: JudgementArtifact
  /** 지금 다시 잰 raw digest. 주면 대조한다 */
  actualRawSha?: string
  /** 지금 다시 낸 input digest. 주면 대조한다 */
  actualInputDigest?: string
}): { ok: boolean; blocks: { code: ArtifactBlockCode; message: string }[] } {
  const blocks: { code: ArtifactBlockCode; message: string }[] = []
  const j = input.judgement

  if (j.evaluatorVersion !== EVALUATOR_VERSION) {
    blocks.push({
      code: 'EVALUATOR_VERSION_STALE',
      message: `판정 판이 다르다 — artifact ${j.evaluatorVersion} · 현재 ${EVALUATOR_VERSION}`,
    })
  }
  if (input.actualRawSha !== undefined && input.actualRawSha !== j.rawSha) {
    blocks.push({
      code: 'RAW_SHA_MISMATCH',
      message: `raw SHA 가 다르다 — artifact ${j.rawSha} · 지금 ${input.actualRawSha}`,
    })
  }
  if (input.actualInputDigest !== undefined && input.actualInputDigest !== j.inputDigest) {
    blocks.push({
      code: 'INPUT_DIGEST_MISMATCH',
      message: `input digest 가 다르다 — artifact ${j.inputDigest} · 지금 ${input.actualInputDigest}`,
    })
  }
  /** 🔴 행에서 다시 낸 집계와 저장된 집계를 대조한다 */
  const recomputed = summarize({
    rows: j.rows,
    minStyleDistance: j.summary.minStyleDistance,
    closestPair: j.summary.closestPair,
  })
  if (recomputed.rows !== j.summary.rows) {
    blocks.push({
      code: 'ROW_COUNT_MISMATCH',
      message: `행 수가 다르다 — 저장 ${j.summary.rows} · 실제 ${recomputed.rows}`,
    })
  }
  for (const k of ['statusPass', 'fullGatePass', 'ungroundedTotal'] as const) {
    if (recomputed[k] !== j.summary[k]) {
      blocks.push({
        code: 'SUMMARY_MISMATCH',
        message: `${k} 가 행과 맞지 않는다 — 저장 ${j.summary[k]} · 행에서 ${recomputed[k]}`,
      })
    }
  }
  if (JSON.stringify(recomputed.gateTally) !== JSON.stringify(j.summary.gateTally)) {
    blocks.push({
      code: 'SUMMARY_MISMATCH',
      message: 'Gate 집계가 행과 맞지 않는다',
    })
  }
  return { ok: blocks.length === 0, blocks }
}
