/**
 * VoiceEvidence — 🔴 **말투만 담당한다. 사건·사실·길이·갈등을 만들지 않는다.**
 *
 * 🔴 길이·밀도·온도는 **소재가 정한다.** Voice 는 문장 호흡 · 말끝 · 감정 표현 ·
 *    줄바꿈만 담당한다. 참고 댓글이 길다고 글이 길어지면 그것은 Voice 가 아니라
 *    내용을 가져온 것이다.
 *
 * 🔴 **참고 댓글 속 사건을 새 글의 자기 경험으로 가져오면 안 된다.**
 *    다만 그 판정은 **deterministic 이 하지 않는다** — 같은 말을 쓴 것과
 *    가져온 것을 글자로 가를 수 없다. 의미 검수(`voiceContentLeak`)와 사람이 본다.
 *
 * 🔴 **말투 기준은 정본 `PoolCard.voiceTokens` 에서만 만든다** (2026-09-19 보정).
 *    앞판은 `PersonaInput.voiceCore` 라는 **손으로 옮겨 적는 칸**을 따로 두었다.
 *    정본 카드에는 그런 칸이 없어서(`voiceTokens` 다) 부르는 쪽이 조용히 빈 문자열을
 *    넘겼고, **말투 기준 없이 생성·검수가 통과했다** (2026-09-19 두 번째 유료 실측).
 *    이제 변환은 `voiceStandardOf` 하나뿐이고, 비면 **묻기 전에 멈춘다.**
 */
export const VOICE_EVIDENCE_VERSION = 'voice-evidence-v2'
/** 🔴 2~3개면 리듬은 보인다. 늘리면 내용이 새어 들어온다 */
export const VOICE_SAMPLE_MAX = 3
/**
 * 🔴 **1건으로는 그 사람의 결인지 그 한 번의 우연인지 가를 수 없다.**
 *    blind 비교가 "이 사람 글로 읽히는가" 를 묻는 이상, 견줄 것이 둘은 있어야 한다.
 */
export const VOICE_SAMPLE_MIN = 2

export type VoiceProvenance = {
  personaCode: string
  bundleDigest: string
  sourceDigest: string
  sampleCount: number
  /** 🔴 기준이 실제로 몇 토큰에서 나왔는가 — 빈 기준이 조용히 지나가지 못하게 */
  voiceTokenCount: number
}

export type VoiceEvidence = {
  personaCode: string
  /** 🔴 정본 `voiceTokens` 에서 만든 **유일한** 말투 기준 문자열 */
  voiceStandard: string
  samples: string[]
  provenance: VoiceProvenance
  /** 사람이 blind 로 확인할 항목 — 🔴 기계가 점수 매기지 않는다 */
  blindCheckPoints: string[]
  voiceVersion: string
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * 🔴 **정본 → 말투 기준. 이 변환은 저장소에 하나뿐이다.**
 *    시험 harness 도 운영 runner 도 이것만 부른다. 손으로 조립하지 않는다.
 */
export function voiceStandardOf(voiceTokens: readonly string[]): string {
  return voiceTokens.map(S).filter((x) => x !== '').join(' · ')
}

export function buildVoiceEvidence(input: {
  personaCode: string
  /** 🔴 정본 카드 값 그대로 */
  voiceTokens: readonly string[]
  samples: readonly string[]
  bundleDigest: string
  sourceDigest: string
}): VoiceEvidence {
  const samples = input.samples.map(S).filter((x) => x !== '').slice(0, VOICE_SAMPLE_MAX)
  const tokens = input.voiceTokens.map(S).filter((x) => x !== '')
  return {
    personaCode: S(input.personaCode),
    voiceStandard: voiceStandardOf(tokens),
    samples,
    provenance: {
      personaCode: S(input.personaCode),
      bundleDigest: S(input.bundleDigest),
      sourceDigest: S(input.sourceDigest),
      sampleCount: samples.length,
      voiceTokenCount: tokens.length,
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
 * 🔴 **말투 없이 쓰지 않는다** — 묻기 전에 멈춘다.
 *    빈 기준으로 생성하면 그 글은 아무의 말투도 아니고, 그 사실이
 *    **검수에서도 드러나지 않는다** (검수 프롬프트도 같은 빈 값을 받으므로).
 */
export type VoiceReadiness = { ok: boolean; why: 'noVoiceStandard' | 'tooFewSamples' | null }

export const VOICE_READINESS_LABEL: Readonly<Record<'noVoiceStandard' | 'tooFewSamples', string>> = {
  noVoiceStandard: '말투 기준이 비어 있다 — 정본 카드의 voiceTokens 를 읽지 못했다',
  tooFewSamples: `말투 참고 자료가 ${VOICE_SAMPLE_MIN}건보다 적다`,
}

export function judgeVoiceReadiness(v: VoiceEvidence): VoiceReadiness {
  if (v.voiceStandard.trim() === '') return { ok: false, why: 'noVoiceStandard' }
  if (v.samples.length < VOICE_SAMPLE_MIN) return { ok: false, why: 'tooFewSamples' }
  return { ok: true, why: null }
}

/**
 * 🔴 **정말로 들어갔는지 값으로 본다.** 프롬프트를 만드는 쪽이 조건을 잘못 쓰면
 *    기준이 조용히 빠진다 — 그것이 이번 실측에서 실제로 일어난 일이다.
 *    부르는 쪽은 이 검사에 걸리면 **요청을 보내지 않는다.**
 */
export function voiceStandardMissingFrom(system: string, v: VoiceEvidence): boolean {
  const std = v.voiceStandard.trim()
  return std === '' || !system.includes(std)
}

/**
 * 🔴 **말투 참고의 사건 누수는 deterministic 이 막지 않는다** (2026-09-19 보정).
 *
 *    앞판은 "붙은 낱말 2개 + 관계·장소 낱말" 로 막았다. 그런데 원문이 *"배우자 은퇴"* 이고
 *    초안이 *"남편 퇴직"* 인데 참고 댓글에도 그 말이 있으면 **정상 글이 막혔다.**
 *    같은 말을 쓴 것과 참고에서 **가져온 것**을 글자만 보고 가를 수 없다.
 *
 * 🔴 그래서 이 판정은 **의미 검수(`voiceContentLeak`)와 사람 검토**가 맡는다.
 *    선택한 Persona 의 말투로 읽히는가는 `voiceMismatch` 가 따로 본다.
 *    deterministic 에는 확정 가능한 것만 남긴다 — 사전도 유사도 규칙도 만들지 않는다.
 */
