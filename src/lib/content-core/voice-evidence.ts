/**
 * VoiceEvidence — 🔴 **말투만 담당한다. 사건·사실·길이·갈등을 만들지 않는다.**
 *
 * 🔴 길이·밀도·온도는 **소재가 정한다.** Voice 는 문장 호흡 · 말끝 · 감정 표현 ·
 *    줄바꿈만 담당한다. 참고 댓글이 길다고 글이 길어지면 그것은 Voice 가 아니라
 *    내용을 가져온 것이다.
 *
 * 🔴 **참고 댓글 속 사건을 새 글의 자기 경험으로 가져오지 못한다.**
 *    이 파일의 `voiceLeak` 이 그것을 잰다 — 참고에만 있고 원문 근거에도
 *    소재 판정에도 없는 말이 초안에 나타나면 가져온 것이다.
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

/** 낱말로 쪼갠다 — 🔴 2자 이상 한글·영숫자만. 조사·기호는 버린다 */
export function contentTokens(text: string): string[] {
  return text
    .split(/[^가-힣A-Za-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
}

export type VoiceLeak = { leaked: boolean; tokens: string[] }

/**
 * 🔴 **참고 댓글의 사건이 초안에 들어왔는가.**
 *
 *    참고에만 있고 — 원문 근거에도, 소재 판정의 보존 요소에도 없는 말이
 *    초안에 나타나면 **말투가 아니라 내용을 가져온 것**이다.
 */
export function voiceLeak(input: {
  draftText: string
  samples: readonly string[]
  evidenceText: string
  essence: SourceEssence | null
}): VoiceLeak {
  const draft = new Set(contentTokens(input.draftText))
  const evidence = new Set(contentTokens(input.evidenceText))
  const fromEssence = new Set(
    contentTokens([
      input.essence?.coreMoment ?? '',
      ...(input.essence?.anchors ?? []).map((a) => a.text),
      input.essence?.participationHook ?? '',
    ].join(' ')),
  )
  const leaked: string[] = []
  for (const s of input.samples) {
    for (const t of contentTokens(s)) {
      if (!draft.has(t)) continue
      if (evidence.has(t) || fromEssence.has(t)) continue
      leaked.push(t)
    }
  }
  const tokens = [...new Set(leaked)]
  return { leaked: tokens.length > 0, tokens }
}
