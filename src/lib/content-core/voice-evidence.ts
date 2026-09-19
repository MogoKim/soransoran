/**
 * VoiceEvidence — 🔴 **말투만 담당한다. 사건·사실·길이·갈등을 만들지 않는다.**
 *
 * 🔴 길이·밀도·온도는 **소재가 정한다.** Voice 는 문장 호흡 · 말끝 · 감정 표현 ·
 *    줄바꿈만 담당한다. 참고 댓글이 길다고 글이 길어지면 그것은 Voice 가 아니라
 *    내용을 가져온 것이다.
 *
 * 🔴 **참고 댓글 속 사건을 새 글의 자기 경험으로 가져오면 안 된다.**
 *    다만 그 판정은 **deterministic 이 하지 않는다** — 같은 말을 쓴 것과
 *    가져온 것을 글자로 가를 수 없다. 의미 검수(`voiceFidelity`)와 사람이 본다.
 */
import type { SourceEssence } from './essence'

export const VOICE_EVIDENCE_VERSION = 'voice-evidence-v1'
/** 🔴 2~3개면 리듬은 보인다. 늘리면 내용이 새어 들어온다 */
export const VOICE_SAMPLE_MAX = 3

export type VoiceProvenance = {
  personaCode: string
  bundleDigest: string
  sourceDigest: string
  sampleCount: number
}

export type VoiceEvidence = {
  personaCode: string
  /** 🔴 카드 원문 그대로 — 여기서 밴드로 정규화하지 않는다 */
  voiceCore: string
  samples: string[]
  provenance: VoiceProvenance
  /** 사람이 blind 로 확인할 항목 — 🔴 기계가 점수 매기지 않는다 */
  blindCheckPoints: string[]
  voiceVersion: string
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function buildVoiceEvidence(input: {
  personaCode: string
  voiceCore: string
  samples: readonly string[]
  bundleDigest: string
  sourceDigest: string
}): VoiceEvidence {
  const samples = input.samples.map(S).filter((x) => x !== '').slice(0, VOICE_SAMPLE_MAX)
  return {
    personaCode: S(input.personaCode),
    voiceCore: S(input.voiceCore),
    samples,
    provenance: {
      personaCode: S(input.personaCode),
      bundleDigest: S(input.bundleDigest),
      sourceDigest: S(input.sourceDigest),
      sampleCount: samples.length,
    },
    blindCheckPoints: [
      '이 글이 어느 Persona 의 글인지 알아볼 수 있는가',
      '말끝·호흡이 참고와 같은 결인가 (내용이 아니라)',
      '참고에 있던 사건이 이 글에 들어오지 않았는가',
      '글 길이가 소재에 맞는가 (참고 길이를 따라가지 않았는가)',
    ],
    voiceVersion: VOICE_EVIDENCE_VERSION,
  }
}

/**
 * 🔴 **말투 참고의 사건 누수는 deterministic 이 막지 않는다** (2026-09-19 보정).
 *
 *    앞판은 "붙은 낱말 2개 + 관계·장소 낱말" 로 막았다. 그런데 원문이 *"배우자 은퇴"* 이고
 *    초안이 *"남편 퇴직"* 인데 참고 댓글에도 그 말이 있으면 **정상 글이 막혔다.**
 *    같은 말을 쓴 것과 참고에서 **가져온 것**을 글자만 보고 가를 수 없다.
 *
 * 🔴 그래서 이 판정은 **의미 검수(`voiceFidelity`)와 사람 검토**가 맡는다.
 *    deterministic 에는 확정 가능한 것만 남긴다 — 사전도 유사도 규칙도 만들지 않는다.
 */
