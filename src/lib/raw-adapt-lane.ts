/**
 * 🔴 **적응 레인 계약 — 긴 사연(raw) 적응 초안은 품질 계약(quality-v4) 밖이다** (2026-09-29 · `raw-adapt-v1`)
 *
 * 왜 따로 있나 — 앞판(#627 b44e773)은 적응 경로를 품질 계약에 넣고 판을 `quality-v5` 로 올렸다.
 *    그러면 digest 가 바뀌어 **지금 자동 READY 재고(quality-v4 · AUTO_DECIDER 도장) 전부가 legacy** 가 되고
 *    (`isCurrentQualityContract` = false) 자동 도장 · 자동 발행 재검증이 전부 멈춘다.
 *    적응 초안은 창업자 gold 에 표본이 한 건도 없어 **어차피 자동 READY 대상이 아니다** —
 *    그러니 v4 계약을 흔들 이유가 없다. 적응 초안은 **자기 계약 표식**을 따로 갖는다.
 *
 * 🔴 **규칙**
 *    · 적재기(`buildQueuePayload`)는 적응 후보에 품질 계약 표식(`qualityContract`)을 **적지 않는다.**
 *      대신 `gateResults.rawAdaptContract` 에 이 파일의 값을 적는다 → v4 cohort · 도장 · 발행 재검증 대상이 아니다
 *    · 적응 표식이 **어떤 모양으로든** 남아 있으면(키 · 사람 검토 경고) 자동 레인이 아니다(`carriesRawAdaptMark`)
 *      — 품질 계약 표식이 잘못 함께 실려도 자동 도장 · selector · 발행 재검증이 막는다(fail-closed)
 *    · 적응 행은 `machine:*` 결정으로 들어가 **사람 검토(HUMAN_REVIEW_REQUIRED)로만** 나간다
 *    · 사람이 적응 행에서 결함을 찾아도 v4 cohort 를 닫지 않는다 — 표식이 달라 v4 표본이 아니다
 * 🔴 **값은 코드 상수에서만 온다.** 후보 파일의 값은 대조 대상이다 — 다르면 적재하지 않는다.
 * 🔴 순수하다. DB · 네트워크 · 파일 · LLM 없음. 값은 부를 때 계산한다(순환 import 안전).
 */
import { createHash } from 'node:crypto'

import { isCurrentQualityContract } from './quality-contract'
import {
  RAW_ADAPTATION_VERSION, RAW_ADAPTATION_RULES_DIGEST, RAW_ADAPTATION_CODES, RAW_ADAPTATION_REVIEW_CODE,
} from './raw-adaptation'
import { DRAFT_LIFE_REVIEW_HOLD } from './semantic-summary-codes'

/** 🔴 `gateResults` 안의 칸 이름 — 품질 계약 칸(`qualityContract`)과 다르다 */
export const RAW_ADAPT_CONTRACT_KEY = 'rawAdaptContract'

/** 🔴 이 레인이 갈 수 있는 곳 — 사람 검토뿐이다. 값으로 적어 두어 표식만 봐도 알 수 있게 한다 */
export const RAW_ADAPT_LANE = 'humanReviewOnly'

/** 🔴 적응 행이 반드시 싣는 사람 검토 경고 — `eligibilityOf` 가 경고 0 을 요구하므로 자동 적격이 아니다 */
export const RAW_ADAPT_REVIEW_HOLD = `${DRAFT_LIFE_REVIEW_HOLD}:${RAW_ADAPTATION_REVIEW_CODE}`

export type RawAdaptContractMark = { version: string; digest: string; lane: typeof RAW_ADAPT_LANE }

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

/** 🔴 digest 에 들어가는 것 — 전부 코드 상수다. 적응 규칙(지시문 · 표지 · 코드)이 바뀌면 digest 가 바뀐다 */
export function rawAdaptContractComponents(): Record<string, unknown> {
  return {
    version: RAW_ADAPTATION_VERSION,
    rulesDigest: RAW_ADAPTATION_RULES_DIGEST,
    codes: RAW_ADAPTATION_CODES,
    reviewCode: RAW_ADAPTATION_REVIEW_CODE,
    lane: RAW_ADAPT_LANE,
  }
}

let memo: string | null = null
/** 🔴 **지금 코드의 적응 레인 계약 digest** (sha256 hex 64) */
export function rawAdaptContractDigest(): string {
  if (memo === null) memo = createHash('sha256').update(stableJson(rawAdaptContractComponents()), 'utf8').digest('hex')
  return memo
}

/** 🔴 적재기 · 후보 봉투가 싣는 표식 — 지금 코드의 값 그대로다 */
export function currentRawAdaptContract(): RawAdaptContractMark {
  return { version: RAW_ADAPTATION_VERSION, digest: rawAdaptContractDigest(), lane: RAW_ADAPT_LANE }
}

const HEX64 = /^[0-9a-f]{64}$/

/** 🔴 표식 하나를 읽는다 — 모양이 하나라도 어긋나면 `null` */
export function readRawAdaptMark(m: unknown): RawAdaptContractMark | null {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return null
  const r = m as Record<string, unknown>
  if (typeof r.version !== 'string' || r.version === '' || typeof r.digest !== 'string' || !HEX64.test(r.digest)) return null
  if (r.lane !== RAW_ADAPT_LANE) return null
  return { version: r.version, digest: r.digest, lane: RAW_ADAPT_LANE }
}

/** 🔴 그 표식이 **지금 적응 규칙**의 것인가 — 적재 직전 대조에 쓴다 */
export function isCurrentRawAdaptMark(m: unknown): boolean {
  const x = readRawAdaptMark(m)
  return x !== null && x.version === RAW_ADAPTATION_VERSION && x.digest === rawAdaptContractDigest()
}

const recOf = (v: unknown): Record<string, unknown> | null =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)

/**
 * 🔴 **적응 레인의 흔적이 있는가** — 모양을 따지지 않는다(fail-closed).
 *    · `rawAdaptContract` 칸이 **있기만** 해도(깨진 모양 포함)
 *    · 또는 holds 에 적응 사람 검토 경고(`DRAFT_LIFE_REVIEW:rawAdaptation`)가 있으면
 *    자동 레인이 아니다. 흔적 하나만 지워져도 다른 하나가 막는다.
 */
export function carriesRawAdaptMark(gateResults: unknown): boolean {
  const g = recOf(gateResults)
  if (g === null) return false
  if (Object.prototype.hasOwnProperty.call(g, RAW_ADAPT_CONTRACT_KEY)) return true
  const holds = Array.isArray(g.holds) ? g.holds.map(String) : []
  return holds.includes(RAW_ADAPT_REVIEW_HOLD)
}

/**
 * 🔴 **자동 레인(자동 도장 · selector · 발행 재검증)이 받을 수 있는 계약인가** — 지금 품질 계약이고
 *    적응 흔적이 없어야 한다. 품질 계약 판정 자체는 정본 `isCurrentQualityContract` 가 한다(여기서 다시 적지 않는다).
 */
export function autoLaneContractOk(gateResults: unknown): boolean {
  return isCurrentQualityContract(gateResults) && !carriesRawAdaptMark(gateResults)
}

/**
 * 🔴 **후보 한 건이 적응 레인인가** — 후보 파일의 신호 셋 중 **하나라도** 있으면 적응이다(fail-closed).
 *    `draftRoute: 'adapt'` · `rawAdaptContract` 칸 · `lifeReview` 의 `rawAdaptation`.
 *    적응인데 표식이 지금 규칙이 아니면 적재기가 싣지 않는다.
 */
export function isRawAdaptCandidate(c: unknown): boolean {
  const r = recOf(c)
  if (r === null) return false
  if (r.draftRoute === 'adapt') return true
  if (Object.prototype.hasOwnProperty.call(r, RAW_ADAPT_CONTRACT_KEY)) return true
  return Array.isArray(r.lifeReview) && r.lifeReview.some((x) => x === RAW_ADAPTATION_REVIEW_CODE)
}
