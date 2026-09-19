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

export type VoiceLeak = { leaked: boolean; phrases: string[] }

/**
 * 🔴 **사건을 가리키는 말** — 관계 · 장소 · 기관. 여기 닿지 않으면 deterministic 은 막지 않는다.
 *
 *    말투 표현(`저도` · `비슷하게` · `느꼈어요`)은 **가져와도 되는 것**이다.
 *    앞판은 낱말 하나만 겹쳐도 누수로 잡아 정상 말투를 막았다.
 */
const EVENT_MARKERS: readonly RegExp[] = [
  /남편|아내|시어머니|시아버지|시댁|친정|장인|장모|처가|아들|딸|손주|며느리|사위|올케|형님|동서/,
  /병원|한의원|약국|응급실|요양원|장례식장|학교|학원|회사|직장|가게|시장|마트|교회|절/,
  /수술|입원|퇴원|진단|장례|이사|결혼|이혼|취업|퇴직|입학|졸업/,
]

function looksLikeEvent(text: string): boolean {
  return EVENT_MARKERS.some((re) => re.test(text))
}

/** 참고 문장에서 **붙어 있는 낱말 2개 이상**을 뽑는다 */
function adjacentPhrases(text: string): string[] {
  const out: string[] = []
  for (const chunk of text.split(/[.!?…\n]+/)) {
    const ws = contentTokens(chunk)
    for (let n = 2; n <= Math.min(4, ws.length); n += 1) {
      for (let i = 0; i + n <= ws.length; i += 1) out.push(ws.slice(i, i + n).join(' '))
    }
  }
  return [...new Set(out)]
}

/** 띄어쓰기를 무시하고 들어 있는가 — 초안이 조사를 붙여 써도 잡는다 */
function containsLoose(haystack: string, phrase: string): boolean {
  const parts = phrase.split(' ')
  let from = 0
  for (const p of parts) {
    const i = haystack.indexOf(p, from)
    if (i < 0) return false
    // 🔴 붙어 있어야 한다 — 글 전체에 흩어져 있는 것은 같은 이야기가 아니다
    if (from > 0 && i - from > 12) return false
    from = i + p.length
  }
  return true
}

/**
 * 🔴 **참고 댓글의 사건이 초안에 들어왔는가** — 확실한 것만 잡는다.
 *
 *    셋을 모두 만족할 때만 누수다:
 *      ① 참고에서 **붙어 있던 낱말 2개 이상**이 초안에도 붙어서 나온다
 *      ② 그 말이 **관계 · 장소 · 기관**을 가리킨다 (말투 표현이 아니다)
 *      ③ 원문 근거에도 소재 판정에도 없다
 *
 * 🔴 애매한 것은 여기서 막지 않는다 — 의미 검수(`voiceFidelity`)와 사람이 본다.
 *    deterministic 이 애매한 것을 막으면 정상 말투가 통째로 사라진다.
 */
export function voiceLeak(input: {
  draftText: string
  samples: readonly string[]
  evidenceText: string
  essence: SourceEssence | null
}): VoiceLeak {
  const known = [
    input.evidenceText,
    input.essence?.coreMoment ?? '',
    ...(input.essence?.anchors ?? []).map((a) => a.text),
    input.essence?.participationHook ?? '',
  ].join(' ')
  const found: string[] = []
  for (const sample of input.samples) {
    for (const phrase of adjacentPhrases(sample)) {
      if (!looksLikeEvent(phrase)) continue
      if (!containsLoose(input.draftText, phrase)) continue
      if (containsLoose(known, phrase)) continue
      found.push(phrase)
    }
  }
  const phrases = [...new Set(found)]
  return { leaked: phrases.length > 0, phrases }
}
