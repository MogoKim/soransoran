/**
 * 🔴 **품질 계약 — 기계 후보가 어떤 생성·검수·게이트 계약으로 만들어졌는가** (2026-09-27)
 *
 * 왜 있나 — 2026-09-26 초안 게이트 3종(d750b72)은 판 값을 하나도 올리지 않았다.
 * 그래서 DB 에 저장된 어떤 칸으로도 "수정 전 세대" 와 "수정 후 세대" 를 가를 수 없었고,
 * 옛 세대의 실패(중대 결함)가 새 세대의 자동 READY 판정을 영원히 닫았다.
 *
 * 🔴 **값은 코드 상수에서만 온다.** env · 호출자 · 후보 파일 · 요청 본문이 이 값을 정하지 못한다.
 *    · 적재기(`buildQueuePayload`)가 `gateResults.qualityContract` 에 **이 파일의 값**을 적는다
 *    · 후보 파일의 digest 는 저장원이 아니라 **대조 대상**이다 — 다르면 적재하지 않는다(SkipCode CONTRACT)
 *    · 판정(증거 cohort · 도장 · 발행 재검증)은 **그 시점의 이 상수**와 다시 견준다
 * 🔴 **말투 자산·Persona 풀 지문은 넣지 않는다.** Persona 를 고칠 때마다 cohort 가 새로 시작하면
 *    30건 표본이 영영 차지 않는다. 결과를 바꾸는 **규칙**만 넣는다.
 * 🔴 **값을 모듈 로드 때 계산하지 않는다.** 이 파일은 `micro-seed-supply-autofill` ↔ `auto-ready-v2`
 *    순환 안에 있다. 부를 때 계산하고 한 번만 기억한다.
 * 🔴 판을 올리는 규율 — 게이트·검수 소스가 바뀌면 `QUALITY_CONTRACT_VERSION` 을 올리거나,
 *    행동 불변을 `quality-contract.fingerprint.json` 의 확인으로 갱신해야 CI 가 통과한다.
 *
 * 🔴 **마스터 확정 (2026-09-27)** — 기준 30건 · 무수정 27건 이상 · 유효 중대 결함 0 은 낮추지 않는다.
 *    Q1 legacy(표식 없음) 행은 열림 판정 · 자동 도장 · 자동 발행 재검증에서 빠진다. legacy 기록은 지우거나 고치지 않는다
 *    Q2 cohort 수열은 자동 적격(경고 0) 행이다
 *    Q3 digest 에 말투 자산 · Persona 풀 지문을 넣지 않고, 생성 캐시 key 에도 넣지 않는다
 *    Q4 cohort 어디서든(창 밖 포함) 사람 결함 yes 가 있으면 그 계약은 실패다
 *    Q5 수정 · 폐기도 표본이다(무수정만 27건에 센다)
 *    Q6 봉투 digest 가 없거나 다른 후보 파일은 적재하지 않는다(SkipCode CONTRACT)
 *    Q7 CI 지문 가드 — 판정 소스가 바뀌면 판을 올리거나 행동 불변을 명시해야 통과한다
 *    🔴 후보는 날짜나 수동 ID 목록으로 고르지 않는다 — createdAt → id 순서의 처음 30건뿐이다
 */
import { createHash } from 'node:crypto'

import {
  CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION, STAGE_MODEL, STAGE_MAX_OUTPUT_LABEL,
} from './content-core/pipeline'
import { REVIEW_VERSION, DETERMINISTIC_CODES } from './content-core/review'
import { ARTIFACT_VERSION } from './content-core/artifact'
import { SPEAKER_PLAN_VERSION } from './content-core/speaker'
import { DRAFT_GATE_CODES, DRAFT_GATE_VERSION } from './content-core/draft-life-gates'
import { DRAFT_RULE_VERSION } from './micro-seed-auto-draft'
import { SOURCE_TITLE_CHECK_VERSION } from './draft-originality'
import { SEMANTIC_HOLD_CODES } from './semantic-summary-codes'
import { JUDGE_CONTRACT_DIGEST } from './auto-ready-v2'

/**
 * 🔴 **품질 계약 판** — 게이트·검수의 판정이 바뀌면 올린다.
 *    `quality-v1` = 초안 게이트 3종(사진 의존 · 1인칭 허가 없는 생활사 · 카드의 지금 삶과 시제)을 포함한 첫 계약.
 */
export const QUALITY_CONTRACT_VERSION = 'quality-v1'

/** 🔴 `gateResults` 안의 칸 이름 */
export const QUALITY_CONTRACT_KEY = 'qualityContract'

export type QualityContractMark = { version: string; digest: string }

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

/** 🔴 digest 에 들어가는 것 — 전부 코드 상수다. 부를 때마다 새로 조립한다(값은 같다) */
export function qualityContractComponents(): Record<string, unknown> {
  return {
    version: QUALITY_CONTRACT_VERSION,
    pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
    promptVersion: CONTENT_CORE_PROMPT_VERSION,
    speakerPlanVersion: SPEAKER_PLAN_VERSION,
    stageModels: STAGE_MODEL,
    stageMaxOutput: STAGE_MAX_OUTPUT_LABEL,
    reviewVersion: REVIEW_VERSION,
    deterministicCodes: DETERMINISTIC_CODES,
    artifactVersion: ARTIFACT_VERSION,
    draftRuleVersion: DRAFT_RULE_VERSION,
    draftGateVersion: DRAFT_GATE_VERSION,
    draftGateCodes: DRAFT_GATE_CODES,
    sourceTitleCheckVersion: SOURCE_TITLE_CHECK_VERSION,
    semanticHoldCodes: SEMANTIC_HOLD_CODES,
    judgeContractDigest: JUDGE_CONTRACT_DIGEST,
  }
}

let memo: string | null = null
/** 🔴 **지금 코드의 품질 계약 digest** (sha256 hex 64). 인자가 없다 — 바꿀 수 있는 입력이 없다 */
export function qualityContractDigest(): string {
  if (memo === null) memo = createHash('sha256').update(stableJson(qualityContractComponents()), 'utf8').digest('hex')
  return memo
}

/** 🔴 적재기가 저장할 표식 — 지금 코드의 값 그대로다 */
export function currentQualityContract(): QualityContractMark {
  return { version: QUALITY_CONTRACT_VERSION, digest: qualityContractDigest() }
}

const HEX64 = /^[0-9a-f]{64}$/

/** 🔴 저장된 표식을 읽는다 — 모양이 하나라도 어긋나면 `null`(표식 없음 = legacy) */
export function readQualityContract(gateResults: unknown): QualityContractMark | null {
  if (gateResults === null || typeof gateResults !== 'object' || Array.isArray(gateResults)) return null
  const m = (gateResults as Record<string, unknown>)[QUALITY_CONTRACT_KEY]
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return null
  const r = m as Record<string, unknown>
  if (typeof r.version !== 'string' || r.version === '' || typeof r.digest !== 'string' || !HEX64.test(r.digest)) return null
  return { version: r.version, digest: r.digest }
}

/**
 * 🔴 **이 행이 지금 품질 계약으로 만들어졌는가** — 판정할 때마다 **지금 코드 상수**와 다시 견준다.
 *    표식이 없거나(legacy) 다른 판이면 false 다.
 */
export function isCurrentQualityContract(gateResults: unknown): boolean {
  const m = readQualityContract(gateResults)
  return m !== null && m.version === QUALITY_CONTRACT_VERSION && m.digest === qualityContractDigest()
}
