/**
 * **자기 경험 주장** 판정 정본 — 🔴 순수 함수. 생성 계획과 후보 검증이 **이것 하나**를 쓴다
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-10, 창업자 판정 P0-1).
 *
 *    앞선 판은 `reactionRole === 'experience'` 일 때만 경험 근거를 물었다.
 *    그런데 회차 `20260910-165632` 18건 중 **10건에 근거 없는 자기 경험**이 있었고,
 *    그중 **7건이 `gateStatus=pass`** 였다. 역할이 `empathy` · `question` 이었기 때문이다.
 *
 *      "저도 계단이 참 힘들어요"          ← question · pass · 통증을 자기 것으로 주장
 *      "저도 한두 개 사 놓고 보니까"       ← empathy · pass · 과거 행동
 *      "우리 집도 요즘 자꾸 양을 줄이게"    ← question · 가족 상황
 *
 *    역할은 **무엇을 쓸지**를 정할 뿐, **무엇을 주장해도 되는지**를 정하지 않는다.
 *    그래서 판정을 역할에서 떼어 낸다.
 *
 * 🔴 **금지 문구 목록을 늘리는 방식을 쓰지 않는다.**
 *    문구를 막으면 모델은 같은 주장을 다른 문구로 한다 —
 *    이 저장소가 이미 두 번 겪은 실패다(어절 → 첫 글자 → 생활 장면).
 *    **구조**를 본다: *1인칭 화자가 새 사실을 주장하는가.*
 *
 * 🔴 **참고 댓글은 말투 근거이지 인생 사실의 근거가 아니다.**
 *    참고 댓글에 "저는 무릎이 아파요" 가 있다고 해서 이 Persona 의 무릎이 아픈 것은 아니다.
 */

/**
 * 1인칭 화자 표지 — 🔴 이것이 없으면 자기 주장이 아니다.
 *
 * 🔴 **맨 `저`·`나`·`내`·`제` 를 뺐다** (2026-09-10, 실측 오탐).
 *    한국어에서 `저` 는 1인칭이자 **지시사**다 — `저 아이가` · `저 길을` 의 `저` 는
 *    "나" 가 아니라 "저기 그" 다. 회차 `20260910-180719` 의 S009 가 그렇게 걸렸다.
 *    **조사가 붙은 형태만** 1인칭으로 본다. 조사 없이 홀로 선 `저` 는 판정하지 않는다 —
 *    모르는 것을 주장으로 세지 않는다.
 *
 * 🔴 **구어 변이형을 함께 본다** (2026-09-10, 실측으로 발견).
 *    앞선 판은 `저도` 는 잡고 **`저두` 는 놓쳤다** — 조사 자리에 `두` 가 없었기 때문이다.
 *    회차 `20260910-172838` 의 S001 이 그 구멍으로 통과했다.
 *    🔴 이것은 문구 목록이 아니라 **같은 낱말의 표기 변이**다. 늘어나지 않는다.
 */
const FIRST_PERSON =
  /(^|[\s,."'({[])(저도요|저두요|나도요|저두|나두|저도|나도|저는|나는|저를|나를|저의|제가|내가|저희|우리)([\s은는이가을를도의에]|$)/u

/**
 * 🔴 **순수 맞장구** — 새 사실을 주장하지 않는 동의 표현.
 *
 *    "저도요" · "그러게요" · "저도 그래요" 는 상대 말에 동의할 뿐
 *    자기에 대한 **새로운 사실**을 보태지 않는다. 이것은 막지 않는다 —
 *    막으면 사람이 가장 많이 쓰는 반응이 사라진다.
 */
const AGREEMENT_ONLY = /^(저도요?|저두요?|그러게요?|맞아요?|그쵸|그죠|저도\s*(그래요|그렇네요|그렇습니다|같아요))[\s.!?~ㅋㅎㅠㅜ^]*$/u

/**
 * 🔴 **입장 표명 vs 사실 주장** — 이것이 판정의 축이다.
 *
 *    앞선 판은 겪음 어미(`-더라고요` · `-았/었-`)를 나열했다. 그러나
 *    *"저도 계단이 참 힘들어요"* 는 현재형이라 그 목록을 통과했다(실측 3건 누락).
 *    어미를 더 적는 것은 **문구 목록을 다시 만드는 일**이다 —
 *    이 저장소가 이미 두 번 실패한 방식이다.
 *
 *    그래서 축을 바꾼다. 1인칭 화자가 자기에 대해 **내용을 붙였는가**를 본다.
 *      · 내용이 없다        → 맞장구        `저도요` · `그러게요`
 *      · 상대·감상만 있다    → 입장 표명      `저도 궁금하네요` · `부럽네요`
 *      · 자기 사실이 붙는다  → **주장**       `저도 계단이 힘들어요`
 *
 * 🔴 아래는 **닫힌 집합**이다. 낱말을 막는 목록이 아니라
 *    "이것만 내용 없는 반응으로 친다" 는 화이트리스트라 늘어나지 않는다.
 */
const STANCE_WORDS = [
  '그래', '그렇', '그러', '맞아', '맞네', '맞습', '같아', '같네',
  '궁금', '공감', '이해', '알아', '알겠', '알것', '모르겠',
  '반갑', '대단', '부럽', '좋겠', '힘들겠', '힘드시', '고생', '수고',
  '감사', '축하', '응원', '위로', '어떠', '어때', '어떻',
] as const

/** 조사·어미를 걷어낸 **내용 낱말** 후보 */
const contentWordsOf = (s: string): string[] =>
  (s.match(/[가-힣]{2,}/gu) ?? [])
    .filter((w) => !STANCE_WORDS.some((sw) => w.startsWith(sw)))

/** 🔴 주장의 **종류** — 창업자가 지목한 다섯 갈래 */
export const CLAIM_KINDS = [
  'HEALTH',      // 질병 · 통증
  'FAMILY',      // 가족 상황
  'PAST_ACTION', // 과거 행동
  'VISIT',       // 방문 · 이용 경험
  'FEELING',     // 감정의 지속
  'OTHER',
] as const
export type ClaimKind = (typeof CLAIM_KINDS)[number]

/**
 * 🔴 **종류는 분류일 뿐 판정 기준이 아니다.**
 *    `OTHER` 로 떨어져도 자기 사실 주장이면 똑같이 근거를 요구한다 —
 *    분류에 없는 갈래가 통과하는 구멍을 두지 않는다.
 */
const KIND_HINTS: readonly { kind: ClaimKind; re: RegExp }[] = [
  { kind: 'HEALTH', re: /(아프|아파|시큰|욱신|찌릿|통증|무릎|허리|어깨|병원|약|갱년기|불면|저리)/u },
  { kind: 'FAMILY', re: /(남편|아내|아들|딸|아이|애들|자식|손주|시어머니|친정|우리\s*집|저희\s*집|식구)/u },
  { kind: 'VISIT', re: /(다녀|들르|가\s*보|가게\s*되|방문|다니)/u },
  { kind: 'FEELING', re: /(마음이|기분이|서럽|허전|몽글|울컥|후련|외로)/u },
  { kind: 'PAST_ACTION', re: /(샀|사\s*놓|만들|담그|줄였|시작했|해\s*봤|바꿨|끊었|배웠)/u },
]

export type ExperienceClaim = {
  /** 주장이 담긴 문장 (판정 근거를 사람이 볼 수 있게) */
  sentence: string
  kind: ClaimKind
}

/** 문장 단위로 쪼갠다 — 🔴 줄바꿈도 문장 경계다 */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/**
 * 🔴 **후보 본문에서 자기 사실 주장을 찾는다.**
 *
 *    조건 둘을 **모두** 만족해야 주장이다:
 *      ① 1인칭 화자 표지가 있다
 *      ② 그 문장에 **입장 표명이 아닌 내용 낱말**이 있다
 *
 *    ①만 있으면 맞장구(`저도요`)이고, ②만 있으면 상대 이야기다.
 *
 * 🔴 종류(`kind`)는 **분류일 뿐 판정 기준이 아니다.** 어느 갈래에도 안 들어가면
 *    `OTHER` 로 남고 똑같이 근거를 요구한다 — 분류에 없는 갈래가 통과하는 구멍을 두지 않는다.
 */
export function findExperienceClaims(text: string): ExperienceClaim[] {
  const out: ExperienceClaim[] = []
  for (const s of sentencesOf(text)) {
    if (AGREEMENT_ONLY.test(s)) continue
    if (!FIRST_PERSON.test(s)) continue
    // 🔴 1인칭 표지 자체는 내용이 아니다
    const body = s.replace(/(저희|우리|저도|저두|나두|저는|저를|제가|내가|나도|나는)/gu, ' ')
    if (contentWordsOf(body).length === 0) continue
    const hit = KIND_HINTS.find((k) => k.re.test(s))
    out.push({ sentence: s, kind: hit?.kind ?? 'OTHER' })
  }
  return out
}

/**
 * 🔴 **Persona 가 들고 있는 사실.**
 *    `identity` 의 자유 서술과 `memory` 요약에서 **문자열만** 모은다 —
 *    무엇이 근거가 되는지는 Persona 자료가 정하지 코드가 정하지 않는다.
 */
export function groundingTextOf(input: {
  identity: unknown
  memory: { has: boolean; summary?: string }
}): string {
  const parts: string[] = []
  if (input.memory.has && typeof input.memory.summary === 'string'
    && input.memory.summary.trim() !== '') {
    parts.push(input.memory.summary)
  }
  /**
   * 🔴 **identity 의 아무 문자열이나 근거로 세지 않는다** (2026-09-10 정정).
   *
   *    앞선 판은 identity 전체를 훑었다. 그러면 `{ job: '합성', note: '시험' }` 같은
   *    **설정 값**이 "겪은 일" 로 들어가 프롬프트가
   *    *"아래는 당신이 실제로 겪은 일입니다: 합성 시험"* 이라고 말하게 된다.
   *    검증부는 그 문자열과 겹치지 않아 막는데, 생성부는 근거가 있다고 믿는다 —
   *    **두 곳이 갈린 상태**이고 이 파일이 없애려던 바로 그 문제다.
   *
   *    그래서 **겪은 일을 담기로 약속된 자리**만 읽는다.
   */
  const walk = (v: unknown, depth = 0): void => {
    if (depth > 3) return
    if (typeof v === 'string') { if (v.trim() !== '') parts.push(v); return }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    if (v !== null && typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1)
    }
  }
  if (input.identity !== null && typeof input.identity === 'object') {
    const o = input.identity as Record<string, unknown>
    for (const key of EXPERIENCE_KEYS) if (o[key] !== undefined) walk(o[key])
  }
  return parts.join(' ')
}

/** 🔴 겪은 일을 담기로 약속된 자리 — 설정 값(`job` · `note`)은 여기 없다 */
export const EXPERIENCE_KEYS: readonly string[] = [
  'experiences', 'episodes', 'history', 'lifeEvents', 'stories', 'memories',
]

export type GroundingVerdict = {
  /** 주장을 해도 되는가 */
  ok: boolean
  claims: ExperienceClaim[]
  /** 근거 없는 주장 */
  ungrounded: ExperienceClaim[]
  reason: string
}

/**
 * 🔴 **주장마다 근거를 묻는다.**
 *
 *    근거는 Persona 의 `memory` 또는 `identity` 안에 있어야 한다.
 *    🔴 **참고 댓글은 근거가 아니다** — 이 함수는 참고 댓글을 받지도 않는다.
 *
 *    근거 판정은 **낱말 겹침**으로 한다. 느슨해 보이지만 방향이 안전하다 —
 *    근거가 아예 없는 Persona(지금 합성 9종이 그렇다)에서는 무엇도 통과하지 못한다.
 */
export function judgeExperienceGrounding(input: {
  text: string
  grounding: string
}): GroundingVerdict {
  const claims = findExperienceClaims(input.text)
  if (claims.length === 0) {
    return { ok: true, claims, ungrounded: [], reason: '자기 사실 주장 없음 — 맞장구·질문·원글 반응' }
  }
  const ground = input.grounding.trim()
  if (ground === '') {
    return {
      ok: false, claims, ungrounded: claims,
      reason: `자기 사실 주장 ${claims.length}건인데 Persona 에 근거가 없다`
        + ` (${[...new Set(claims.map((c) => c.kind))].join(' · ')})`
        + ' — 🔴 참고 댓글은 말투 근거이지 인생 사실의 근거가 아니다',
    }
  }
  /** 근거 문자열과 **의미 낱말**이 겹치는가 (조사·2자 미만은 신호가 아니다) */
  const tokensOf = (s: string): Set<string> =>
    new Set((s.match(/[가-힣]{2,}/gu) ?? []).map((w) => w.slice(0, 3)))
  const g = tokensOf(ground)
  const ungrounded = claims.filter((c) => {
    const t = tokensOf(c.sentence)
    for (const w of t) if (g.has(w)) return false
    return true
  })
  return {
    ok: ungrounded.length === 0,
    claims,
    ungrounded,
    reason: ungrounded.length === 0
      ? `자기 사실 주장 ${claims.length}건 전부 Persona 근거와 이어진다`
      : `근거 없는 자기 사실 주장 ${ungrounded.length}/${claims.length}건`
        + ` (${[...new Set(ungrounded.map((c) => c.kind))].join(' · ')})`,
  }
}
