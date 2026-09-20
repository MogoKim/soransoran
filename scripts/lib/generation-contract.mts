/**
 * 🔴 **지금 생성 계약이 무엇인가** — 한 곳에서만 만든다 (2026-09-20)
 *
 *    생성 러너는 artifact 에 이 값을 적고, 공급 러너는 "지난 HOLD 가 **지금 계약의**
 *    결론인가" 를 이 값으로 판단한다. 두 곳이 따로 조립하면 한쪽이 낡는다.
 *
 * 🔴 `sourceInputHash` 는 여기서 채우지 않는다 — 원천마다 다르다. 부르는 쪽이 넣는다.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import {
  CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION, STAGE_MODEL,
  type ContractBase,
} from '../../src/lib/content-core/pipeline'
import { loadCanonAsset } from './persona-reference-store.mjs'

/** 🔴 지문 길이는 저장소가 쓰는 값과 같다 */
export const digest16 = (s: string): string =>
  createHash('sha256').update(s).digest('hex').slice(0, 16)

/** 🔴 Persona 정본 카드 문서 — 생성 러너가 읽는 그 경로다 */
export const PERSONA_POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'

/**
 * 🔴 **원천과 무관한 칸들.** 말투 자산 판과 Persona 카드 판을 **실제 파일에서** 읽는다 —
 *    상수를 적지 않는다. 읽지 못하면 빈 문자열이고, 그러면 어떤 옛 artifact 와도
 *    같지 않다(= 다시 평가한다). 🔴 조용히 "같다" 로 넘어가지 않는다.
 */
export function currentContractBase(): ContractBase {
  let voiceAssetDigest = ''
  try {
    const asset = loadCanonAsset()
    voiceAssetDigest = asset.ok ? (asset.sourceDigest ?? '') : ''
  } catch { voiceAssetDigest = '' }
  let personaCardDigest = ''
  try { personaCardDigest = digest16(readFileSync(PERSONA_POOL_DOC, 'utf-8')) } catch { /* 빈 값 */ }
  return {
    pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
    promptVersion: CONTENT_CORE_PROMPT_VERSION,
    stageModels: STAGE_MODEL,
    voiceAssetDigest,
    personaCardDigest,
  }
}
