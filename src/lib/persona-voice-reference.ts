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
  /**
   * 🔴 **anchor 근거** (2026-09-10, P0-4).
   *
   *    묶음은 **한 작성자(anchor)의 댓글**을 중심으로 만든다.
   *    한 사람의 말투를 배우게 하려는 것이지, 여러 사람을 섞으면 다시 평균이 된다.
   *
   * 🔴 **작성자 식별자는 여기 담지 않는다.** 묶는 일은 로컬에서만 하고,
   *    provider 로 나가는 것은 `comments[].text` 뿐이다.
   *    담는 것은 **몇 건이 anchor 에서 왔는가** 라는 숫자뿐이다.
   */
  anchorCount: number
  /** anchor 가 모자라 문체로 보완한 건수 */
  supplementCount: number
  /** anchor 비중 — 낮으면 그 묶음은 "한 사람의 말투" 가 아니다 */
  anchorRatio: number
  /**
   * 🔴 **이 화자의 실제 관측 총수** (2026-10-01 · Phase F) — 원문으로 싣는 댓글 + style-only 관측.
   *    계약의 말투 근거 수(`VOICE_MIN_COMMENTS`)는 이 값이다. 원문 수가 아니다.
   */
  observedCount: number
  /** 🔴 경험형이라 원문을 싣지 않고 **문체 좌표·길이 분포에만** 쓴 관측 수 */
  styleOnlyCount: number
  /** 이 묶음의 문체 좌표 (관찰값 — style-only 관측 포함) */
  style: StyleVector
}

/**
 * 🔴 **문체 좌표** — 낱말이 아니라 **말버릇의 모양**을 잰다.
 *
 *    "댓글이 겹치지 않는다" 는 말투가 다르다는 증거가 아니다(P0-4).
 *    서로 다른 댓글 열두 개를 모아도 전부 `~해요` 로 끝나면 같은 말투다.
 *    그래서 **겹침이 아니라 이 좌표의 거리**를 근거로 쓴다.
 *
 * 🔴 전부 0~1 로 정규화한다. 축 하나가 커서 거리를 독점하지 않게 한다.
 */
export type StyleVector = {
  /** 평균 길이 (200자 기준 정규화) */
  len: number
  /** 물음표로 끝나는 비율 */
  question: number
  /** ㅋ·ㅎ·ㅠ·ㅜ 자모 웃음/울음 비율 */
  jamo: number
  /** ^^ · ~ · ! · ... 같은 꾸밈 비율 */
  deco: number
  /** `요` 로 끝나는 비율 (존댓말 기울기) */
  yo: number
  /** 문장 수 (4문장 기준 정규화) */
  sentences: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 🔴 한 댓글의 좌표. 순수 계산 — 사전도 모델도 쓰지 않는다 */
export function styleOf(text: string): StyleVector {
  const t = text.trim()
  const n = charLen(t)
  const sentences = Math.max(1, (t.match(/[.!?…\n]+/gu) ?? []).length)
  const stripped = t.replace(/[\s.!?~^…]+$/u, '')
  return {
    len: clamp01(n / 200),
    question: /\?/u.test(t) ? 1 : 0,
    jamo: clamp01((t.match(/[ㅋㅎㅠㅜ]/gu) ?? []).length / 4),
    deco: clamp01(((t.match(/\^\^|~|!|\.\.\.|♡|💕/gu) ?? []).length) / 3),
    yo: /요$/u.test(stripped) ? 1 : 0,
    sentences: clamp01(sentences / 4),
  }
}

export const STYLE_AXES: readonly (keyof StyleVector)[] =
  ['len', 'question', 'jamo', 'deco', 'yo', 'sentences']

export function styleCentroid(texts: readonly string[]): StyleVector {
  const vs = texts.map(styleOf)
  const out = {} as Record<keyof StyleVector, number>
  for (const ax of STYLE_AXES) {
    out[ax] = vs.length === 0 ? 0 : vs.reduce((a, v) => a + v[ax], 0) / vs.length
  }
  return out as StyleVector
}

/** 🔴 두 좌표의 거리 — 축 개수로 나눠 0~1 로 둔다 */
export function styleDistance(a: StyleVector, b: StyleVector): number {
  return STYLE_AXES.reduce((acc, ax) => acc + Math.abs(a[ax] - b[ax]), 0) / STYLE_AXES.length
}

/**
 * 🔴 **운영 상한.** 목표가 아니다 — `MAX_COMMENT_LENGTH` 와 같은 뜻의 절대 한계다.
 *    reference 에 이보다 긴 것이 섞이면 그것은 댓글이 아니라 본문일 가능성이 높다.
 */
export const REFERENCE_MAX_CHARS = 500
/** 🔴 너무 짧은 것은 말투 근거가 되지 못한다 (`ㅎㅎ` · `👍`) */
export const REFERENCE_MIN_CHARS = 5
/**
 * 🔴 묶음 하나가 말투를 대표하려면 최소 이만큼은 있어야 한다.
 *
 * 🔴 **8 에서 3 으로 내렸다** (2026-09-10). 낮춘 것이 아니라 **기준을 바로잡은 것**이다 —
 *    앞선 판은 8건을 맞추려고 **다른 화자 댓글로 채웠고**, 그래서 묶음의 과반이
 *    남의 말이었다. 한 화자의 말만 쓰기로 한 이상, 그 사람이 3건밖에 없으면
 *    묶음도 3건이다. 모자란 것을 남의 말로 가리지 않는다.
 *    3건 미만은 `REFERENCE_MISSING` 이다.
 */
export const REFERENCE_MIN_COUNT = 3
/**
 * 🔴 **provider 로 나가는 안전 원문의 최소치** (2026-10-01 · Phase F).
 *    관측 3건은 그대로 요구한다(`REFERENCE_MIN_COUNT`). 다만 경험형 댓글은 **원문을 싣지 않고**
 *    문체·길이 관측으로만 센다 — 그래서 원문 예시는 이 수 이상, 관측 총수는 3 이상이다.
 */
export const REFERENCE_MIN_SAFE_TEXTS = 2

/**
 * 🔴 **한 화자의 말투 근거가 서는가 — 정본 판정 하나** (2026-10-01 · Phase F).
 *    화자 배정(`planBundles`) · 묶음 판정(`judgeReferenceBundle`) · 자동 생성(`persona-autogen`)이 이것을 부른다.
 *
 *    observed   같은 화자의 실제 관측 총수(경험형 포함 · 중복 제거)  ≥ REFERENCE_MIN_COUNT
 *    safeTexts  그중 provider 로 원문을 보낼 수 있는 안전 댓글 수     ≥ REFERENCE_MIN_SAFE_TEXTS
 */
export function judgeVoiceEvidence(input: { observed: number; safeTexts: number }): { ok: boolean; reason: string } {
  const why: string[] = []
  if (input.observed < REFERENCE_MIN_COUNT) why.push(`관측 ${input.observed}건 < ${REFERENCE_MIN_COUNT}`)
  if (input.safeTexts < REFERENCE_MIN_SAFE_TEXTS) why.push(`안전 원문 ${input.safeTexts}건 < ${REFERENCE_MIN_SAFE_TEXTS}`)
  return why.length === 0
    ? { ok: true, reason: `관측 ${input.observed}건 · 안전 원문 ${input.safeTexts}건` }
    : { ok: false, reason: why.join(' · ') }
}

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
  /** 🔴 그중 anchor 작성자에게서 온 건수. 모르면 전부 anchor 로 본다(단위 시험) */
  anchorCount?: number
  /**
   * 🔴 **같은 화자의 style-only 관측** (2026-10-01 · Phase F) — 경험형이라 원문을 싣지 않는 댓글.
   *    관측 수 · 문체 좌표 · 길이 분포에만 들어가고 `comments` 에는 **절대 들어가지 않는다.**
   */
  styleOnlyTexts?: readonly string[]
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
  // 🔴 style-only 관측은 원문과 겹치지 않게 센다 — 같은 문장을 두 번 세면 관측이 부풀려진다
  const styleOnly = [...new Set((input.styleOnlyTexts ?? []).map((t) => (t ?? '').trim()))]
    .filter((t) => t !== '' && !unique.includes(t) && !looksLikePostBody(t) && charLen(t) >= REFERENCE_MIN_CHARS)
  const observed = [...unique, ...styleOnly]
  const evidence = judgeVoiceEvidence({ observed: observed.length, safeTexts: unique.length })
  if (!evidence.ok) {
    blocks.push({ code: 'REFERENCE_TOO_FEW', message: `${input.personaCode}: ${evidence.reason}` })
  }
  if (blocks.length > 0) return { ok: false, blocks }

  const anchorCount = Math.min(input.anchorCount ?? unique.length, unique.length)
  return {
    ok: true,
    blocks: [],
    bundle: {
      personaCode: input.personaCode,
      comments: unique.map((text) => ({ text })),
      // 🔴 길이·문체는 **숫자 관찰값**이다 — style-only 관측까지 반영하되 원문은 싣지 않는다
      lengths: lengthProfile(observed),
      anchorCount,
      supplementCount: unique.length - anchorCount,
      anchorRatio: unique.length === 0 ? 0 : anchorCount / unique.length,
      observedCount: observed.length,
      styleOnlyCount: styleOnly.length,
      style: styleCentroid(observed),
    },
  }
}

/**
 * 🔴 **겹침 검사는 위생이지 증거가 아니다** (2026-09-10 강등, P0-4).
 *
 *    앞선 판은 "묶음이 한 건도 겹치지 않는다" 를 **말투가 다르다는 증거**로 보고했다.
 *    그것은 틀렸다 — 서로 다른 댓글 열두 개를 모아도 전부 `~해요` 로 끝나면 같은 말투다.
 *    같은 자산을 길이순으로 갈라 담았을 뿐인데 "다르다" 고 말한 셈이다.
 *
 *    겹치지 않는 것은 **같은 문장을 두 번 쓰지 않았다**는 뜻일 뿐이다.
 *    말투가 다르다는 근거는 `judgeVoiceSeparation` 이 문체 좌표 거리로 낸다.
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
      // 🔴 "그러므로 말투가 다르다" 로 읽히지 않게 문구에서 못을 박는다
      ? `묶음 ${bundles.length}개가 같은 문장을 두 번 쓰지 않았다`
        + ' (🔴 위생 검사일 뿐 · 말투가 다르다는 증거가 아니다)'
      : `${worst} 가 ${maxOverlap}건 겹친다 — 같은 문장을 두 묶음이 나눠 썼다`,
  }
}

/**
 * 🔴 **말투가 실제로 갈리는가** — 문체 좌표의 거리로 답한다.
 *
 *    묶음마다 좌표를 내고 **가장 가까운 두 묶음**의 거리를 본다.
 *    가장 가까운 쌍이 붙어 있으면, 나머지가 아무리 멀어도 그 둘은 같은 말투다.
 *
 * 🔴 임계값을 넘겼다고 "충분히 다르다" 고 말하지 않는다 — 관찰값을 그대로 낸다.
 *    판단은 사람이 한다.
 */
export function judgeVoiceSeparation(bundles: readonly VoiceReferenceBundle[]): {
  pairs: number
  minDistance: number
  closestPair: string
  perBundle: { personaCode: string; nearest: string; distance: number }[]
} {
  const perBundle: { personaCode: string; nearest: string; distance: number }[] = []
  let minDistance = Number.POSITIVE_INFINITY
  let closestPair = ''
  let pairs = 0
  for (let i = 0; i < bundles.length; i += 1) {
    let best = Number.POSITIVE_INFINITY
    let bestCode = ''
    for (let j = 0; j < bundles.length; j += 1) {
      if (i === j) continue
      const d = styleDistance(bundles[i]!.style, bundles[j]!.style)
      if (j > i) pairs += 1
      if (d < best) { best = d; bestCode = bundles[j]!.personaCode }
      if (d < minDistance) { minDistance = d; closestPair = `${bundles[i]!.personaCode} ↔ ${bundles[j]!.personaCode}` }
    }
    perBundle.push({ personaCode: bundles[i]!.personaCode, nearest: bestCode, distance: best })
  }
  return {
    pairs,
    minDistance: Number.isFinite(minDistance) ? minDistance : 0,
    closestPair,
    perBundle,
  }
}

/**
 * 🔴 **참고 댓글의 사실을 Persona 경험으로 가져오지 못하게 한다** (P0-5).
 *
 *    reference 는 **어휘·호흡·길이·질문 방식**의 근거다. 겪은 일의 근거가 아니다.
 *    새 회차에서 실제로 이런 문장이 나왔다 —
 *      *"저도 저번에 진짜 오랜만에 친구 봤는데 … 목 쉴 때까지 한참 떠들다 헤어졌어요"*
 *    그 Persona 에게는 그런 기억이 없다. 참고 댓글에 있던 장면을 자기 것으로 옮긴 것이다.
 *
 *    그래서 **`experience` 역할은 근거가 있을 때만 배정한다.**
 *    memory 도 identity 도 비어 있으면 들려줄 자기 이야기가 없는 것이다.
 */
export const EXPERIENCE_ROLE = 'experience'

export function judgeExperienceEligibility(input: {
  reactionRole: string
  hasMemory: boolean
  /** identity 에 이 글과 이어질 만한 생활 근거가 있는가 */
  hasLifeGround: boolean
}): { allowed: boolean; reason: string } {
  if (input.reactionRole !== EXPERIENCE_ROLE) {
    return { allowed: true, reason: `${input.reactionRole} 는 자기 경험을 요구하지 않는다` }
  }
  if (input.hasMemory || input.hasLifeGround) {
    return {
      allowed: true,
      reason: `경험 근거 있음 (memory ${input.hasMemory ? '있음' : '없음'}`
        + ` · 생활 근거 ${input.hasLifeGround ? '있음' : '없음'})`,
    }
  }
  return {
    allowed: false,
    reason: 'memory 도 생활 근거도 없다 — 없는 경험을 지어내게 된다'
      + ' (🔴 참고 댓글의 장면을 자기 것으로 옮기는 길이다)',
  }
}

/**
 * 🔴 **25자 연속 일치 일괄 차단을 폐기했다** (2026-09-10, 창업자 결정 P0-2).
 *
 *    창업자는 변호사 확인을 거쳐 *"맥락과 사실이 맞으면 참고 댓글의 짧은 표현뿐 아니라
 *    문장 구조와 표현을 상당히 가깝게 재사용해도 된다"* 고 정했다.
 *    그런데 앞선 판은 **연속 25자**만 넘으면 무조건 잡았다 —
 *    저작권 회피를 이유로 억지 재작성을 시키는 장치였고,
 *    그것이 이 Wave 가 없애려던 "자연스러움을 규칙으로 깎는" 바로 그 방식이다.
 *
 * 🔴 **대신 막아야 할 것은 넷뿐이다.**
 *      ① 참고 댓글의 **개인 경험**을 Persona 경험으로 전환
 *         → `persona-experience-grounding.ts` 가 역할과 무관하게 본다
 *      ② 대상 글 **원문 유출**            → Gate ①(`assertNoSourceLeak`)
 *      ③ 작성자 식별자·개인정보 유출        → 정본 자산에 speakerId 만 있다
 *      ④ **현재 글과 맞지 않는 사실 복사**  → 아래 `findContextMismatch`
 *
 *    길이는 그중 무엇도 재지 못한다. 그래서 길이로 막지 않는다.
 */

/**
 * 🔴 **현재 글과 맞지 않는 사실을 옮겨 왔는가** (④).
 *
 *    참고 댓글의 표현을 가깝게 써도 좋지만, 그 댓글이 **다른 글**에 달린 것이라
 *    지금 글에 없는 소재가 딸려 오면 그건 맥락이 어긋난 복사다.
 *    예: 도서관 글에 "김장" 이 나오는 경우.
 *
 * 🔴 낱말이 아니라 **출처**로 판정한다 — 후보에 있고, 참고 댓글에 있고,
 *    지금 글(제목·요약)에는 없는 **구체 명사**를 찾는다.
 */
export function findContextMismatch(input: {
  candidate: string
  referenceTexts: readonly string[]
  postContext: string
}): { mismatched: string[]; ok: boolean } {
  const nouns = (s: string): Set<string> =>
    new Set((s.match(/[가-힣]{2,}/gu) ?? []).map((w) => w.slice(0, 3)))
  const cand = nouns(input.candidate)
  const ctx = nouns(input.postContext)
  const ref = nouns(input.referenceTexts.join(' '))
  const mismatched = [...cand].filter((w) => ref.has(w) && !ctx.has(w))
  // 🔴 겹치는 낱말이 조금 있는 것은 말투를 가져온 흔적이다. 판정은 부르는 쪽이 한다
  return { mismatched, ok: true }
}
