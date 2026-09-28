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
import { DRAFT_GATE_CODES, DRAFT_GATE_VERSION, DRAFT_LIFE_REVIEW_CODES } from './content-core/draft-life-gates'
import { DRAFT_RULE_VERSION } from './micro-seed-auto-draft'
import { SOURCE_TITLE_CHECK_VERSION } from './draft-originality'
import { SEMANTIC_HOLD_CODES, DRAFT_LIFE_REVIEW_HOLD, DRAFT_LIFE_REVIEW_UNREAD } from './semantic-summary-codes'
import { JUDGE_CONTRACT_DIGEST } from './auto-ready-v2'
import { FOUNDER_GOLD_VERSION, FOUNDER_GOLD_PINNED_DIGEST, FOUNDER_GOLD_SHAPE } from './founder-gold'

/**
 * 🔴 **품질 계약 판** — 게이트·검수의 판정이 바뀌면 올린다.
 *    `quality-v1` = 초안 게이트 3종(사진 의존 · 1인칭 허가 없는 생활사 · 카드의 지금 삶과 시제)을 포함한 첫 계약.
 *    `quality-v2` (2026-09-28) = 생활 일관성 게이트 4종(혼인 · 돌봄·한집 · 자녀 삶의 단계 · 정신건강·질병) —
 *      확정 모순은 적재 전 AUTO_HOLD, 모호하면 `DRAFT_LIFE_REVIEW:<코드>` 경고로 사람 검토.
 *      v1 cohort 30건 중 중대 결함 4건이 게이트를 전부 지나갔다. v1 행은 digest 가 달라 legacy 가 된다
 *      — 🔴 v1 행을 고치거나 지우지 않는다.
 *    `quality-v3` (2026-09-28) = 원천·시점 대조 게이트 4종(끝난 명절·실시간 현장 · 다른 커뮤니티 움직임 ·
 *      사진 없이 봐 달라 · 잘린 원문 뒤 없는 결말) + `noLifeFactNeeded` 계획의 자기 가족사 사람 검토.
 *      v1 cohort 가 사람 손이 필요하다고 권고된 13건 중 v2 가 막지 못한 모양이다. 원천(시각 · 사이트 · 사진 수)을
 *      게이트 입력으로 받는다 — 새 생성 · 캐시 채택이 같은 값을 넘긴다. v2 는 운영 행이 없는 채로 대체된다
 *      (배포 전 판). 🔴 v1 행을 고치거나 지우지 않는다.
 *    `quality-v4` (2026-09-28 창업자 결정) = **후속 계약**. v3 는 첫 30건 사람 검토에서 실패했다(무수정 22 · 중대 결함 3) —
 *      그 기록은 그대로 둔다. v4 는 ① 초안 게이트 보정(카드 자녀 수·결혼 햇수·출생 경과·성인 자녀 학령기 학습 확정 ·
 *      다가오는 명절 · 1인칭 금융 행동 · 결혼 전 연애 단계 · 받아칠 거리 없는 하소연 사람 검토) ② **열림 근거를 창업자 gold
 *      재생으로** 바꾼다(`QUALITY_EVIDENCE_BASIS`) — 새 30건 사람 검토를 요구하지 않는다. 감사 결함 · 재시도 가능 실패 ·
 *      판정 대기 시한 · 글 유실 · 사람 중대 결함은 그대로 닫는다. 🔴 v3 행을 고치거나 지우지 않는다.
 */
export const QUALITY_CONTRACT_VERSION = 'quality-v4'

/**
 * 🔴 **열림 근거** (quality-v4) — `founderGold`: 창업자 gold 재생(`founder-gold.ts`)이 30/30 이고 지금 계약 행에
 *    사람 중대 결함이 없어야 연다. `humanCohort`: v1~v3 의 첫 30건 사람 표본. 판정 정본은 `evidenceFromDb` 하나다.
 */
export const QUALITY_EVIDENCE_BASIS: 'humanCohort' | 'founderGold' = 'founderGold'

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
    // 🔴 (v2) 모호 → 사람 검토로 보내는 축과 그 경고 이름 — 바뀌면 자동 READY 표본의 적격이 바뀐다
    //    (v3) 원천·시점 축 넷과 `noLifeFactNeeded` 가족사가 이 목록에 더해졌다
    draftLifeReviewCodes: DRAFT_LIFE_REVIEW_CODES,
    draftLifeReviewHold: { prefix: DRAFT_LIFE_REVIEW_HOLD, unread: DRAFT_LIFE_REVIEW_UNREAD },
    // 🔴 (v4) 열림 근거와 창업자 gold — gold 를 한 글자라도 바꾸면 이 digest 가 바뀌어 판을 올려야 한다
    evidenceBasis: QUALITY_EVIDENCE_BASIS,
    founderGold: { version: FOUNDER_GOLD_VERSION, digest: FOUNDER_GOLD_PINNED_DIGEST, shape: FOUNDER_GOLD_SHAPE },
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
