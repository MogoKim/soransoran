/**
 * 생성 말투 ↔ 발행 Persona 연결 — 🔴 순수 판정. DB · 네트워크 · 파일 IO 없음
 *
 * 🔴 **왜 생겼나** (2026-09-13).
 *
 *    자동 초안이 Persona 의 말투 근거로 글을 쓰기 시작했는데,
 *    그 사실이 후보 파일에 적히기만 하고 아무도 읽지 않았다 —
 *    반말 중심 말투로 쓴 글이 존댓말 중심 Persona 이름으로 나갈 수 있었다.
 *
 * 🔴 **첫 판의 두 구멍을 막았다** (2026-09-13 2차).
 *
 *    ① `voice` 가 없으면 `NO_VOICE` 로 **통과**시켰다. 사람이 쓴 글을 막지 않으려던 것인데,
 *       기계 후보도 같은 문으로 지나갔다 — voice 를 잃어버린 기계 글이 아무 이름으로나 나갈 수 있었다.
 *       `voice === null` 하나로 사람과 기계를 뭉갠 것이 원인이다.
 *       이제 **profile 로 가른다**: 기계는 voice 가 필수, 사람은 없어도 된다.
 *
 *    ② 길이 밴드만 같으면 다른 Persona 를 허용했다(`COMPATIBLE_BAND`).
 *       길이가 같다고 말투가 같지 않다 — 반말로 짧게 쓰는 사람과 존댓말로 짧게 쓰는 사람은
 *       다른 사람이다. 그 경로를 **없앴다.** 기계 글은 **쓴 사람 본인만** 낸다.
 *       못 내면 이번 회차에 보류한다. 남에게 넘기지 않는다.
 *
 * 🔴 **말투를 제한하는 규칙이 아니다.** 반말·존댓말·혼합은 그대로 자유다.
 *    여기서 정하는 것은 "누구 이름으로 나가는가" 하나다.
 */

/**
 * 🔴 생성 시점에 남긴 말투 근거 — 텍스트도 작성자도 담지 않는다.
 *
 * 🔴 길이 밴드를 담지 않는다 — 밴드로 남을 대신 세우던 경로가 사라졌으므로
 *    담아 두면 아무도 읽지 않는 값이 된다.
 */
export type VoiceProvenance = {
  personaCode: string
  comments: number
  bundleDigest: string
  sourceDigest: string | null
}

/** 🔴 이 후보를 누가 만들었는가 — `voice` 유무로 추측하지 않는다 */
export type CandidateProfile = 'machine' | 'human'

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 파일·DB 에서 읽은 값을 되돌린다 — 🔴 모양이 아니면 `null` 이다 */
export function readVoiceProvenance(v: unknown): VoiceProvenance | null {
  if (v === null || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const code = S(o.personaCode)
  const digest = S(o.bundleDigest)
  if (code === '' || digest === '') return null
  const n = Number(o.comments)
  if (!Number.isFinite(n) || n <= 0) return null
  return {
    personaCode: code, comments: n, bundleDigest: digest,
    sourceDigest: S(o.sourceDigest) === '' ? null : S(o.sourceDigest),
  }
}

/** 큐 행의 `gateResults` 에서 말투 근거를 꺼낸다 — 🔴 없으면 `null` 이다 */
export function voiceOfGateResults(gate: unknown): VoiceProvenance | null {
  if (gate === null || typeof gate !== 'object') return null
  const g = (gate as Record<string, unknown>).autoDraft
  if (g === null || typeof g !== 'object') return null
  return readVoiceProvenance((g as Record<string, unknown>).voice)
}

export const VOICE_MATCH_CODES = ['SAME_PERSONA', 'HUMAN_NO_VOICE', 'VOICE_MISSING', 'OTHER_PERSONA'] as const
export type VoiceMatchCode = (typeof VOICE_MATCH_CODES)[number]

export const VOICE_MATCH_LABEL: Record<VoiceMatchCode, string> = {
  SAME_PERSONA: '🟢 글을 쓴 말투의 Persona 그대로다',
  HUMAN_NO_VOICE: '🟢 사람이 쓴 글이다 — 말투 근거로 거르지 않는다',
  VOICE_MISSING: '🔴 기계가 만든 글인데 말투 근거가 없거나 깨졌다',
  OTHER_PERSONA: '🔴 이 글을 쓴 사람이 아니다 — 남의 이름으로 내지 않는다',
}

/**
 * 이 Persona 로 이 글을 내도 되는가 — 🔴 **누가 썼는가만 본다.**
 *    생활사·여력·활성은 기존 `hardFilter` 와 `planBatch` 가 따로 본다.
 */
export function judgeVoiceMatch(input: {
  voice: VoiceProvenance | null
  personaCode: string
  profile: CandidateProfile
}): { ok: boolean; code: VoiceMatchCode } {
  if (input.voice === null) {
    // 🔴 **사람과 기계를 가르는 것은 profile 이다.** voice 유무가 아니다
    return input.profile === 'human'
      ? { ok: true, code: 'HUMAN_NO_VOICE' }
      : { ok: false, code: 'VOICE_MISSING' }
  }
  return input.voice.personaCode === input.personaCode
    ? { ok: true, code: 'SAME_PERSONA' }
    : { ok: false, code: 'OTHER_PERSONA' }
}

/**
 * 이 글을 쓸 수 있는 Persona 만 남긴다 — 🔴 **없으면 빈 배열이다.**
 *    임의의 Persona 로 채우지 않는다. 이번 회차에 안 나가는 편이 낫다.
 */
export function filterByVoice<T extends { code: string }>(
  voice: VoiceProvenance | null, profile: CandidateProfile, personas: readonly T[],
): T[] {
  return personas.filter((p) => judgeVoiceMatch({ voice, personaCode: p.code, profile }).ok)
}
