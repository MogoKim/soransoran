/**
 * 페르소나 **말투 근거(reference bundle)** — 🔴 순수 판정. 파일·DB·네트워크 없음
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-10, Wave E · 창업자 판정).
 *
 *    유료 비교 회차 `20260909-181515` 는 두 모델 모두 공개 품질 미달이었다.
 *    채점 메모가 원인을 그대로 가리킨다 —
 *    *"빨래 개다 말고 문득 생각나서 ← 이딴 거 왜 있는 거야"*,
 *    *"억지 상황으로 조짐"*, *"ai 티내고 싶어서"*.
 *
 *    그 문장은 모델이 지어낸 것이 아니라 **프롬프트가 시킨 것**이다.
 *    옛 `buildPrompt` 는 세 가지를 동시에 요구했다:
 *      ① 원글 상황으로 여는 것을 **금지**하고
 *      ② 대신 "지금 내 자리의 생활 장면" 으로 열라고 **예시까지** 주고
 *         (`설거지하다 말고` · `창밖 보다가` · `커피 식는 줄도 모르고`)
 *      ③ 120자 안에 **한두 문장**으로 끝내라고 했다.
 *    맥락을 막고 장면을 요구하고 길이를 조이면 남는 답은 하나뿐이다 —
 *    **원글과 무관한 생활 장면 한 줄.** 그게 20건 내내 반복된 이유다.
 *
 * 🔴 **고치는 방향은 규칙 추가가 아니다.**
 *    규칙을 더 얹으면 모델은 남은 흔한 자리로 옮겨 갈 뿐이다(옛 주석이 그 과정을
 *    스스로 기록하고 있다 — 어절을 막으니 글자가 같아졌고, 글자를 막으니 장면이 같아졌다).
 *    **실제 사람이 쓴 댓글을 근거로 준다.** 추상적인 설정만 보고 창작하게 두지 않는다.
 *
 * 🔴 **이 파일은 본문을 모른다.** 원글 본문은 reference 에 들어갈 수 없다 —
 *    창업자의 법률 판단은 **댓글**에 관한 것이고, 원글 본문 외부 전송 권한으로
 *    확대 해석하지 않는다. `judgeReferenceBundle` 이 그 경계를 fail-closed 로 잠근다.
 *
 * 🔴 **닉네임을 담지 않는다.** reference 는 텍스트만이다.
 */

/** 🔴 작성자도 출처 URL 도 없다. 말투 근거로 쓸 문장 하나뿐이다 */
export type ReferenceComment = { text: string }

export type LengthProfile = {
  count: number
  min: number
  p25: number
  median: number
  p75: number
  p90: number
  max: number
}

export type VoiceReferenceBundle = {
  personaCode: string
  comments: readonly ReferenceComment[]
  /** 🔴 이 묶음의 **실제** 길이 분포. 목표 길이가 아니라 관찰값이다 */
  lengths: LengthProfile
}

/**
 * 🔴 **운영 상한.** 목표가 아니다 — `MAX_COMMENT_LENGTH` 와 같은 뜻의 절대 한계다.
 *    reference 에 이보다 긴 것이 섞이면 그것은 댓글이 아니라 본문일 가능성이 높다.
 */
export const REFERENCE_MAX_CHARS = 500
/** 🔴 너무 짧은 것은 말투 근거가 되지 못한다 (`ㅎㅎ` · `👍`) */
export const REFERENCE_MIN_CHARS = 5
/** 🔴 묶음 하나가 말투를 대표하려면 최소 이만큼은 있어야 한다 */
export const REFERENCE_MIN_COUNT = 8

const charLen = (s: string): number => [...s].length

/** 🔴 백분위는 **관찰값**이다. 반올림해 만들어 내지 않는다 */
export function lengthProfile(texts: readonly string[]): LengthProfile {
  const lens = texts.map(charLen).sort((a, b) => a - b)
  if (lens.length === 0) {
    return { count: 0, min: 0, p25: 0, median: 0, p75: 0, p90: 0, max: 0 }
  }
  const at = (q: number): number => lens[Math.min(lens.length - 1, Math.floor(lens.length * q))]!
  return {
    count: lens.length,
    min: lens[0]!,
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
    p90: at(0.9),
    max: lens[lens.length - 1]!,
  }
}

export type ReferenceBlockCode =
  | 'REFERENCE_EMPTY'
  | 'REFERENCE_TOO_FEW'
  | 'REFERENCE_TOO_LONG'
  | 'REFERENCE_TOO_SHORT'
  | 'REFERENCE_DUPLICATED'
  | 'REFERENCE_LOOKS_LIKE_POST_BODY'

export type ReferenceVerdict =
  | { ok: true; bundle: VoiceReferenceBundle; blocks: [] }
  | { ok: false; blocks: { code: ReferenceBlockCode; message: string }[] }

/**
 * 🔴 **본문이 섞였는지 본다.** — 판정은 **길이**로만 한다.
 *
 * 🔴 **줄·문단 규칙을 버린 이유** (2026-09-10, 실측).
 *    앞선 판은 "문단 2개 이상 또는 줄 5개 이상이면 본문" 으로 봤다.
 *    실제 자산으로 재보니 그 규칙이 댓글 **111건**을 잡았는데,
 *    자산의 원글 본문 168건과 대조한 결과 **그중 진짜 본문은 0건**이었다.
 *    오탐률 100% 다 — 사람은 댓글도 여러 줄로 쓴다(16줄짜리 166자 댓글이 있었다).
 *    잡히면 Persona 10종 중 3종만 근거를 얻어 회차가 서지 못했다.
 *
 * 🔴 **길이는 실제로 갈린다.** 같은 자산에서
 *      원글 본문  최소 200자 · p10 327 · 중앙 571 · 최대 2,730
 *      댓글       최대 200자
 *    두 분포가 겹치는 것은 정확히 1건(200자에서 잘린 본문)뿐이다.
 *    상한은 우리 제품 자신의 댓글 정의(`MAX_COMMENT_LENGTH` 500자)를 쓴다 —
 *    그보다 긴 것은 이 서비스에서 애초에 댓글이 아니다.
 */
export function looksLikePostBody(text: string): boolean {
  return charLen(text.trim()) > REFERENCE_MAX_CHARS
}

/**
 * 🔴 **묶음이 말투 근거로 쓸 만한가.** 아니면 만들지 않는다 —
 *    빈 묶음을 통과시키면 프롬프트는 다시 "설정만 보고 창작" 으로 돌아간다.
 */
export function judgeReferenceBundle(input: {
  personaCode: string
  texts: readonly string[]
}): ReferenceVerdict {
  const blocks: { code: ReferenceBlockCode; message: string }[] = []
  const trimmed = input.texts.map((t) => (t ?? '').trim()).filter((t) => t !== '')

  if (trimmed.length === 0) {
    return {
      ok: false,
      blocks: [{ code: 'REFERENCE_EMPTY', message: `${input.personaCode}: 말투 근거가 하나도 없다` }],
    }
  }
  const body = trimmed.filter(looksLikePostBody)
  if (body.length > 0) {
    // 🔴 몇 건인지만 말한다. 본문 조각을 메시지에 담지 않는다
    blocks.push({
      code: 'REFERENCE_LOOKS_LIKE_POST_BODY',
      message: `${input.personaCode}: 본문으로 보이는 항목 ${body.length}건 — 댓글만 넣는다`,
    })
  }
  const tooShort = trimmed.filter((t) => charLen(t) < REFERENCE_MIN_CHARS)
  if (tooShort.length > 0) {
    blocks.push({
      code: 'REFERENCE_TOO_SHORT',
      message: `${input.personaCode}: ${REFERENCE_MIN_CHARS}자 미만 ${tooShort.length}건 — 말투 근거가 되지 못한다`,
    })
  }
  const unique = [...new Set(trimmed)]
  if (unique.length !== trimmed.length) {
    blocks.push({
      code: 'REFERENCE_DUPLICATED',
      message: `${input.personaCode}: 중복 ${trimmed.length - unique.length}건`,
    })
  }
  if (unique.length < REFERENCE_MIN_COUNT) {
    blocks.push({
      code: 'REFERENCE_TOO_FEW',
      message: `${input.personaCode}: ${unique.length}건 — ${REFERENCE_MIN_COUNT}건 이상이어야 한다`,
    })
  }
  if (blocks.length > 0) return { ok: false, blocks }

  return {
    ok: true,
    blocks: [],
    bundle: {
      personaCode: input.personaCode,
      comments: unique.map((text) => ({ text })),
      lengths: lengthProfile(unique),
    },
  }
}

/**
 * 🔴 **Persona 마다 근거가 실제로 다른가.**
 *
 *    옛 비교는 `voiceCore` 의 어미·존댓말 차이만으로 Persona 가 다르다고 했다.
 *    그것은 설정이 다른 것이지 **말투 자산이 다른 것이 아니다** —
 *    같은 근거에서 나온 문장은 어미만 바꿔 달아도 같은 문장이다.
 *    묶음이 겹치면 여기서 실패로 낸다.
 */
export function bundlesAreDistinct(bundles: readonly VoiceReferenceBundle[]): {
  distinct: boolean
  maxOverlap: number
  detail: string
} {
  let maxOverlap = 0
  let worst = ''
  for (let i = 0; i < bundles.length; i += 1) {
    for (let j = i + 1; j < bundles.length; j += 1) {
      const a = new Set(bundles[i]!.comments.map((c) => c.text))
      const b = bundles[j]!.comments.map((c) => c.text)
      const shared = b.filter((t) => a.has(t)).length
      if (shared > maxOverlap) {
        maxOverlap = shared
        worst = `${bundles[i]!.personaCode} ↔ ${bundles[j]!.personaCode}`
      }
    }
  }
  return {
    distinct: maxOverlap === 0,
    maxOverlap,
    detail: maxOverlap === 0
      ? `묶음 ${bundles.length}개가 서로 한 건도 겹치지 않는다`
      : `${worst} 가 ${maxOverlap}건 겹친다 — 같은 근거에서 나온 말투는 다르지 않다`,
  }
}

/**
 * 🔴 **후보가 근거를 통째로 베꼈는가.**
 *
 *    창업자는 "짧은 표현이나 말버릇을 가깝게 재사용" 을 허용했다.
 *    그러나 통째로 옮기는 것은 말투를 배운 것이 아니라 복사한 것이다.
 *    Gate ① 은 **원글** 대조라 이 자리를 보지 않는다 — 새 표면이므로 따로 본다.
 */
export const REFERENCE_COPY_RUN_MIN = 25

export function findReferenceCopy(candidate: string, bundle: VoiceReferenceBundle): {
  copied: boolean
  runLength: number
} {
  const c = candidate.replace(/\s+/gu, '')
  let longest = 0
  for (const { text } of bundle.comments) {
    const r = text.replace(/\s+/gu, '')
    // 🔴 연속 일치 최댓값을 본다 — 낱말 단위로 세면 어미만 바꿔 붙인 것을 놓친다
    for (let i = 0; i < r.length; i += 1) {
      for (let j = i + longest + 1; j <= r.length; j += 1) {
        if (!c.includes(r.slice(i, j))) break
        longest = Math.max(longest, j - i)
      }
    }
  }
  return { copied: longest >= REFERENCE_COPY_RUN_MIN, runLength: longest }
}
