/**
 * 🔴 **지금 생성 계약이 무엇인가** — 한 곳에서만 만든다 (2026-09-20)
 *
 *    생성 러너는 artifact 에 이 값을 적고 **캐시 key 도 이 값으로 만든다**.
 *    공급 러너는 "지난 HOLD 가 **지금 계약의** 결론인가" 를 같은 값으로 판단한다.
 *    두 곳이 따로 조립하면 한쪽이 낡는다 — 실제로 낡아 있었다(2026-09-20).
 *
 * 🔴 `sourceInputHash` 는 여기서 채우지 않는다 — 원천마다 다르다. 부르는 쪽이 넣는다.
 */
import {
  CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION, STAGE_MAX_OUTPUT_LABEL, STAGE_MODEL,
  type ContractBase,
} from '../../src/lib/content-core/pipeline'
import { REVIEW_VERSION } from '../../src/lib/content-core/review'
import { SPEAKER_PLAN_VERSION } from '../../src/lib/content-core/speaker'
import { buildSpeakerPlanSystemPrompt } from './content-core-prompts.mjs'
import { digest16, loadVoice } from './voice-runtime.mjs'

/**
 * 🔴 **원천과 무관한 칸들.** 말투 자산 판과 Persona 후보 풀 판을 **실제 파일에서**
 *    읽는다 — 상수를 적지 않는다. 읽지 못하면 빈 문자열이고, 그러면 어떤 옛 artifact 와도
 *    같지 않다(= 다시 평가한다). 🔴 조용히 "같다" 로 넘어가지 않는다.
 */
/**
 * 🔴 **회차 시각을 받는다** (2026-09-23). 주지 않으면 후보 풀 지문에 나이가 빠져
 *    (`age=∅`) 생일이 지나도 옛 artifact 가 그대로 재사용된다.
 *    🔴 부모(공급 회차)와 자식(초안 생성)이 **같은 값**을 써야 한다 —
 *    각자 `new Date()` 를 부르면 KST 자정·생일 경계에서 갈린다.
 */
export function currentContractBase(runAt?: Date): ContractBase {
  let voiceAssetDigest = ''
  let personaPoolDigest = ''
  try {
    const v = loadVoice(runAt)
    voiceAssetDigest = v.sourceDigest
    personaPoolDigest = v.poolDigest
  } catch { /* 빈 값 — 어떤 옛 계약과도 같지 않다 */ }
  return {
    pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
    promptVersion: CONTENT_CORE_PROMPT_VERSION,
    speakerPlanVersion: SPEAKER_PLAN_VERSION,
    reviewVersion: REVIEW_VERSION,
    planPromptDigest: digest16(buildSpeakerPlanSystemPrompt()),
    stageModels: STAGE_MODEL,
    stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL,
    voiceAssetDigest,
    personaPoolDigest,
  }
}
