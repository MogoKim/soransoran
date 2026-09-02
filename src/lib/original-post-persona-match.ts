/**
 * Original Post ↔ Persona 매칭 규칙 — 🔴 순수 함수. DB · 세션 · 네트워크 · 파일 IO 없음
 *
 * 정본: [Original Post 레인 §5](../../docs/operations/2026-09-02-original-post-lane-strategy.md) ·
 *       [Persona 아키텍처 §9](../../docs/operations/2026-08-30-persona-architecture-design.md)
 *
 * 파이프라인에서 이 파일이 채우는 자리
 *   … → ⑤ Founder Decision → **⑥ Persona Matching** → ⑦ Persona Publish
 *                                    ↑ 여기
 *
 * 🔴 **핵심은 점수가 아니라 모순이다.**
 *    "과거에 30살 딸이 있다고 한 페르소나가 고3 딸 이야기를 쓰면 안 된다."
 *    한 번 어긋나면 그 페르소나의 **모든 과거 글이 함께 거짓**이 된다.
 *    그래서 생활사 축은 감점이 아니라 **하드 필터**다.
 *
 * 🔴 **모르는 것을 통과시키지 않는다.**
 *    자녀가 있는데 나이대가 기재되지 않았으면 `CHILD_AGE_UNKNOWN` 으로 **막는다.**
 *    "아마 맞겠지" 로 배정하는 것이 이 파일이 막으려는 바로 그 사고다.
 *
 * 🔴 **최고점을 뽑지 않는다.** 상위 3명 중 가중 무작위다(아키텍처 §9) —
 *    항상 최고점을 뽑으면 특정 페르소나에 활동이 몰리고, 그것이 "같은 사람이 쓴 티" 의 원인이다.
 *    다만 **queueId 로 seed 를 고정**한다. dry-run 은 사람이 읽는 것이라 매번 답이 달라지면 안 된다.
 *
 * 🔴 이 파일은 고객 경로에서 import 되지 않는다. import 가 하나도 없다(fixture 가 강제).
 */

// ─────────────────────────────────────────────────────────
// 자녀 나이대 — 🔴 밴드만. 정확한 나이 금지 (헌법 §9-3)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 정확한 나이를 쓰지 않는 이유는 두 가지다.
 *    ① 헌법 §9-3 — 정확한 나이는 그 자체로 식별 정보다.
 *    ② 나이는 해가 바뀌면 틀린다. 밴드는 훨씬 천천히 틀린다.
 */
export const CHILD_AGE_BANDS = ['영유아', '초등', '중고등', '대학·취준', '성인'] as const
export type ChildAgeBand = (typeof CHILD_AGE_BANDS)[number]

const BAND_SET: ReadonlySet<string> = new Set(CHILD_AGE_BANDS)
export const isChildAgeBand = (v: unknown): v is ChildAgeBand =>
  typeof v === 'string' && BAND_SET.has(v)

// ─────────────────────────────────────────────────────────
// 발행 리듬 — 창업자 결정 (2026-09-02)
// ─────────────────────────────────────────────────────────

/** 🔴 댓글 cap(dailyCap 3)을 재사용하지 않는다. 글은 성격이 다르다 */
export const POST_CAP_PER_WEEK = 1
/** 🔴 같은 사람이 사흘 걸러 글을 쓰면 티가 난다 */
export const MIN_DAYS_BETWEEN_POSTS = 5

// ─────────────────────────────────────────────────────────
// ① 글이 요구하는 정체성 조건
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **현재형 배우자**만 센다.
 *    "전남편" · "남편이었던" 은 이혼한 페르소나도 쓸 수 있는 말이다.
 *    이것을 구분하지 않으면 P10(이혼)이 자기 이야기를 못 쓰게 된다 — 과차단도 사고다.
 */
const EX_SPOUSE_RE = /전남편|옛남편|헤어진 남편|이혼한 남편|남편이었/g
const SPOUSE_RE = /남편|신랑|애들아빠|아이아빠/g

const CHILDREN_RE = /딸|아들|애들|아이들|큰애|작은애|자식|우리 애/g
const PARENT_CARE_RE = /친정|엄마가|아버지가|어머니가|요양|치매|병간호|모시고/g
const MENOPAUSE_RE = /갱년기|폐경|호르몬|열이 확|안면홍조/g

/** 글에 나온 말 → 자녀 나이대 밴드 */
const CHILD_AGE_TOKENS: { re: RegExp; band: ChildAgeBand }[] = [
  { re: /어린이집|유치원|기저귀/g, band: '영유아' },
  { re: /초등|초딩/g, band: '초등' },
  { re: /중학생|중딩|고등학생|고딩|고1|고2|고3|수능|야자|입시/g, band: '중고등' },
  { re: /대학생|대학교|복학|취준|재수|스무살|스물|신입생/g, band: '대학·취준' },
  { re: /서른|시집|장가|결혼시키|사위|며느리 볼|손주/g, band: '성인' },
]

export type PostRequirements = {
  /** 🔴 현재형 배우자가 필요한가 */
  needsCurrentSpouse: boolean
  needsChildren: boolean
  /** 🔴 비어 있지 않으면 이 중 하나에 해당하는 자녀가 있어야 한다 */
  needsChildAgeBands: ChildAgeBand[]
  needsParentCare: boolean
  needsMenopauseExperience: boolean
  /** 사람이 읽을 한 줄 */
  labels: string[]
}

const has = (text: string, re: RegExp): boolean => (text.match(re) ?? []).length > 0

/** 🔴 판정만 한다. 원문도 초안도 저장하지 않는다 */
export function readPostRequirements(title: string, body: string): PostRequirements {
  const t = `${title}\n${body}`

  // 🔴 전남편 언급을 먼저 지운다. 지우지 않으면 "전남편" 의 "남편" 이 현재형으로 잡힌다
  const withoutEx = t.replace(EX_SPOUSE_RE, ' ')
  const needsCurrentSpouse = has(withoutEx, SPOUSE_RE)

  const bands = CHILD_AGE_TOKENS.filter((x) => has(t, x.re)).map((x) => x.band)
  const needsChildAgeBands = [...new Set(bands)]
  const needsChildren = has(t, CHILDREN_RE) || needsChildAgeBands.length > 0
  const needsParentCare = has(t, PARENT_CARE_RE)
  const needsMenopauseExperience = has(t, MENOPAUSE_RE)

  const labels: string[] = []
  if (needsCurrentSpouse) labels.push('기혼(현재형 배우자)')
  if (needsChildren) labels.push('자녀 있음')
  if (needsChildAgeBands.length > 0) labels.push(`자녀 나이대: ${needsChildAgeBands.join('·')}`)
  if (needsParentCare) labels.push('부모 돌봄 경험')
  if (needsMenopauseExperience) labels.push('갱년기 경험')

  return {
    needsCurrentSpouse, needsChildren, needsChildAgeBands,
    needsParentCare, needsMenopauseExperience, labels,
  }
}

// ─────────────────────────────────────────────────────────
// ② 페르소나 입력 — 🔴 판정에 필요한 최소치만
// ─────────────────────────────────────────────────────────

export type PersonaForMatch = {
  code: string
  status: string
  /** 🔴 카카오 실회원 판별 기준. null 이 아니면 실회원이다 */
  providerId: string | null
  maritalStatus?: string | null
  childrenCount?: number | null
  /** 🔴 undefined 와 [] 는 다르다. undefined = 미기재(모름) · [] = 무자녀(앎) */
  childrenAgeBands?: ChildAgeBand[] | null
  parentCare?: string | null
  menopauseStatus?: string | null
  workStatus?: string | null
  economicStatus?: string | null
  region?: string | null
  noGoTopics: readonly string[]
  /**
   * `voiceCore.length` **원문**. 🔴 밴드가 아니라 자유 문장이다 (`"짧고 툭툭"` · `"중간"`).
   *    readLengthBand 가 밴드로 읽는다 — 여기서 정규화하지 않는다.
   */
  voiceLength?: string | null
  /** 최근 7일 글 수 · 마지막 글 시각 — 부르는 쪽이 ActivityLog 에서 읽어 넣는다 */
  postsThisWeek: number
  daysSinceLastPost: number | null
}

export const BLOCK_CODES = [
  'NOT_ACTIVE',
  'REAL_MEMBER',
  'NO_CHILDREN',
  'CHILD_AGE_CONFLICT',
  'CHILD_AGE_UNKNOWN',
  'MARITAL_CONFLICT',
  'NO_PARENT_CARE',
  'MENOPAUSE_NOT_YET',
  'NOGO_TOPIC',
  'WEEKLY_CAP',
  'TOO_SOON',
] as const
export type BlockCode = (typeof BLOCK_CODES)[number]

export const BLOCK_LABEL: Record<BlockCode, string> = {
  NOT_ACTIVE: 'active 가 아니다',
  REAL_MEMBER: '🔴 실회원 계정이다',
  NO_CHILDREN: '자녀가 없는데 자녀 글이다',
  CHILD_AGE_CONFLICT: '🔴 자녀 나이대가 어긋난다',
  CHILD_AGE_UNKNOWN: '🔴 자녀 나이대가 기재되지 않아 판정할 수 없다',
  MARITAL_CONFLICT: '기혼이 아닌데 현재형 배우자 글이다',
  NO_PARENT_CARE: '돌봄 경험이 없는데 돌봄 글이다',
  MENOPAUSE_NOT_YET: '갱년기 전인데 갱년기 글이다',
  NOGO_TOPIC: 'noGo 소재다',
  WEEKLY_CAP: '이번 주 글 상한을 채웠다',
  TOO_SOON: `직전 글에서 ${MIN_DAYS_BETWEEN_POSTS}일이 지나지 않았다`,
}

// ─────────────────────────────────────────────────────────
// ③ 하드 필터 — 🔴 점수 이전에 탈락
// ─────────────────────────────────────────────────────────

export type Blocked = { code: BlockCode; detail: string }

/**
 * 🔴 모순은 감점이 아니라 탈락이다.
 *    그리고 **모르는 것도 탈락이다** — 통과시키면 나중에 두 글이 함께 거짓이 된다.
 */
export function hardFilter(
  p: PersonaForMatch,
  req: PostRequirements,
  postTitle: string,
  postBody: string,
): Blocked[] {
  const out: Blocked[] = []

  // ── 운영 조건 ──
  if (p.status !== 'active') out.push({ code: 'NOT_ACTIVE', detail: `status=${p.status}` })
  // 🔴 실회원 이름으로 발행되면 신뢰 사고다. 되돌리기 어렵다
  if (p.providerId !== null) out.push({ code: 'REAL_MEMBER', detail: 'providerId 가 있다' })

  // ── 생활사 ──
  const kids = p.childrenCount ?? 0
  if (req.needsChildren && kids === 0) {
    out.push({ code: 'NO_CHILDREN', detail: `childrenCount=${kids}` })
  }
  if (req.needsChildAgeBands.length > 0 && kids > 0) {
    const bands = p.childrenAgeBands
    if (bands === undefined || bands === null) {
      // 🔴 여기가 이 파일의 존재 이유다. 모르면 막는다
      out.push({
        code: 'CHILD_AGE_UNKNOWN',
        detail: `요구 ${req.needsChildAgeBands.join('·')} · identity.childrenAgeBands 미기재`,
      })
    } else if (!req.needsChildAgeBands.some((b) => bands.includes(b))) {
      out.push({
        code: 'CHILD_AGE_CONFLICT',
        detail: `요구 ${req.needsChildAgeBands.join('·')} · 보유 ${bands.length === 0 ? '(무자녀)' : bands.join('·')}`,
      })
    }
  }
  if (req.needsCurrentSpouse && p.maritalStatus !== '기혼') {
    out.push({ code: 'MARITAL_CONFLICT', detail: `maritalStatus=${p.maritalStatus ?? '—'}` })
  }
  if (req.needsParentCare && (p.parentCare === '없음' || p.parentCare === undefined || p.parentCare === null)) {
    out.push({ code: 'NO_PARENT_CARE', detail: `parentCare=${p.parentCare ?? '—'}` })
  }
  // 🔴 '전' 만 막는다. '진행중' · '후' 는 경험이 있다
  if (req.needsMenopauseExperience && p.menopauseStatus === '전') {
    out.push({ code: 'MENOPAUSE_NOT_YET', detail: 'menopauseStatus=전' })
  }

  // ── noGo ──
  const all = `${postTitle}\n${postBody}`
  const hitTopics = p.noGoTopics.filter((topic) => topic.trim() !== '' && all.includes(topic))
  if (hitTopics.length > 0) {
    out.push({ code: 'NOGO_TOPIC', detail: `${hitTopics.length}종 일치` })
  }

  // ── 리듬 ──
  if (p.postsThisWeek >= POST_CAP_PER_WEEK) {
    out.push({ code: 'WEEKLY_CAP', detail: `이번 주 ${p.postsThisWeek} / ${POST_CAP_PER_WEEK}` })
  }
  if (p.daysSinceLastPost !== null && p.daysSinceLastPost < MIN_DAYS_BETWEEN_POSTS) {
    out.push({ code: 'TOO_SOON', detail: `${p.daysSinceLastPost}일 전 · 최소 ${MIN_DAYS_BETWEEN_POSTS}일` })
  }

  return out
}

// ─────────────────────────────────────────────────────────
// ④ 점수 — 🔴 하드 필터를 통과한 사람만
// ─────────────────────────────────────────────────────────

/** 아키텍처 §9 의 가중치를 그대로 쓴다 */
export const SCORE_WEIGHTS = {
  topicFit: 35,
  lifeConsistency: 25,
  voiceFit: 15,
  activitySpread: 15,
  interest: 10,
} as const

export type ScoreBreakdown = { topicFit: number; lifeConsistency: number; voiceFit: number; activitySpread: number; interest: number }
export type Scored = { total: number; breakdown: ScoreBreakdown }

/**
 * 말투 길이 밴드.
 *
 * 🔴 어휘는 설계 문서(persona-architecture-design §5 `lengthBand`)를 따른다 — `짧게 / 보통 / 길게`.
 *    E-1 에서 `'short' | 'medium' | 'long'` 을 지어냈는데, DB 의 `voiceCore.length` 는
 *    `"짧고 툭툭"` 같은 한국어 문장이라 **한 번도 일치하지 않았다.**
 *    그 결과 voiceFit 이 5/15 로 고정돼 축이 통째로 죽어 있었다(실측: P05 총점 90 = 35+25+**5**+15+10).
 *    🔴 영어 어휘는 남기지 않는다 — 호환 경로를 두면 죽은 축이 조용히 되살아난다.
 */
export const LENGTH_BANDS = ['짧게', '보통', '길게'] as const
export type LengthBand = (typeof LENGTH_BANDS)[number]

const LENGTH_BAND_SET: ReadonlySet<string> = new Set(LENGTH_BANDS)
export const isLengthBand = (v: unknown): v is LengthBand =>
  typeof v === 'string' && LENGTH_BAND_SET.has(v)

/** 초안 길이 → 말투 길이 밴드 */
export function lengthBandOf(chars: number): LengthBand {
  if (chars < 250) return '짧게'
  if (chars <= 500) return '보통'
  return '길게'
}

/**
 * `voiceCore.length` 자유 문장 → 밴드.
 *
 * 🔴 DB 를 고치지 않는다. `voiceCore` 는 **생성 프롬프트가 읽는 값**이라
 *    `"짧고 툭툭"` 이라는 표현 자체가 자산이다 — 매칭기가 거기서 밴드만 읽어 간다.
 *    noGoTopics 를 "제약 문장" 으로 남기기로 한 결정과 같은 원칙이다.
 *
 * 🔴 순서가 규칙이다. `보통` 을 먼저 본다 —
 *    `"중간 길이"` 는 `길` 을 품고 있어 뒤에 두면 `길게` 로 새어 나간다.
 *
 * 🔴 못 읽으면 null 이다. **하드 차단하지 않는다** — 말투는 모순이 아니라 취향이라
 *    모른다고 배정을 막을 이유가 없다. 부르는 쪽이 중립 점수를 준다.
 */
const LENGTH_ALIASES: readonly { band: LengthBand; keys: readonly string[] }[] = [
  { band: '보통', keys: ['중간', '보통'] },
  { band: '짧게', keys: ['짧'] },
  { band: '길게', keys: ['길'] },
]

export function readLengthBand(raw: string | null | undefined): LengthBand | null {
  const v = (raw ?? '').trim()
  if (v === '') return null
  if (isLengthBand(v)) return v
  for (const a of LENGTH_ALIASES) {
    if (a.keys.some((k) => v.includes(k))) return a.band
  }
  return null
}

/**
 * 축별 적합도 0~1.
 *
 * 🔴 all-or-nothing 을 쓰지 않는다.
 *    `간헐` 은 돌봄 경험이 **있는데도** 0점을 받았다. 하드 필터를 통과했다는 것은
 *    이미 "경험이 있다" 는 뜻인데, 점수에서 없는 사람 취급하면 격차가 인위적으로 벌어진다.
 *    실측: 돌봄 글에서 P07(간헐) 55점 vs P05(상시) 90점 — 35점이 통째로 갈렸다.
 *
 * 🔴 `없음` · `전` 은 여기 없다. 하드 필터에서 이미 탈락한다 —
 *    점수에 0 으로 두면 "통과했는데 0점" 과 구분되지 않는다.
 */
export const CARE_FIT: Record<string, number> = { 상시: 1.0, 간헐: 0.6 }
export const MENOPAUSE_FIT: Record<string, number> = { 진행중: 1.0, 후: 0.7 }

/**
 * 🔴 하드 필터를 통과한 뒤에만 부른다.
 *    생활사 정합성이 만점인 것은 "모순이 없어서" 다 — 모순이 있으면 이미 탈락했다.
 */
export function scoreMatch(p: PersonaForMatch, req: PostRequirements, draftChars: number): Scored {
  // ── 소재 적합성 — 글이 요구한 축을 이 페르소나가 **얼마나** 갖고 있나 ──
  //
  // 🔴 needsCurrentSpouse · needsChildren 은 여기 없다.
  //    하드 필터가 이미 보장해 통과자는 **전원 만점**이 된다 — 변별력이 0 인 죽은 축이다.
  //    죽은 축을 평균에 넣으면 살아 있는 축의 차이를 희석한다.
  const axes: number[] = []
  if (req.needsParentCare) axes.push(CARE_FIT[p.parentCare ?? ''] ?? 0)
  if (req.needsMenopauseExperience) axes.push(MENOPAUSE_FIT[p.menopauseStatus ?? ''] ?? 0)
  // 🔴 조건이 없는 글은 누구나 쓸 수 있다 — 소재 적합성으로 우열을 가리지 않는다
  const topicFit = axes.length === 0
    ? SCORE_WEIGHTS.topicFit
    : Math.round((axes.reduce((a, b) => a + b, 0) / axes.length) * SCORE_WEIGHTS.topicFit)

  // ── 생활사 정합성 — 통과했으므로 만점 ──
  const lifeConsistency = SCORE_WEIGHTS.lifeConsistency

  // ── 말투 적합성 ──
  // 🔴 자유 문장을 밴드로 읽어서 비교한다. 원문끼리 비교하면 언제나 어긋난다
  const want = lengthBandOf(draftChars)
  const got = readLengthBand(p.voiceLength)
  const voiceFit = got === null
    // 🔴 못 읽으면 중립이다. 말투는 모순이 아니라 취향이라 모른다고 벌점을 주지 않는다
    ? Math.round(SCORE_WEIGHTS.voiceFit / 2)
    : got === want ? SCORE_WEIGHTS.voiceFit : Math.round(SCORE_WEIGHTS.voiceFit / 3)

  // ── 활동 분산 — 🔴 최근에 많이 썼으면 감점 ──
  const d = p.daysSinceLastPost
  const activitySpread = d === null
    ? SCORE_WEIGHTS.activitySpread
    : Math.min(SCORE_WEIGHTS.activitySpread, Math.round((d / 14) * SCORE_WEIGHTS.activitySpread))

  // ── 관심사 — 조건 없는 글에서 우열을 가르는 유일한 축 ──
  const interest = req.labels.length === 0 ? Math.round(SCORE_WEIGHTS.interest / 2) : SCORE_WEIGHTS.interest

  return {
    total: topicFit + lifeConsistency + voiceFit + activitySpread + interest,
    breakdown: { topicFit, lifeConsistency, voiceFit, activitySpread, interest },
  }
}

// ─────────────────────────────────────────────────────────
// ⑤ 선택 — 🔴 최고점 고정이 아니다
// ─────────────────────────────────────────────────────────

/** 🔴 seed 를 고정한다. dry-run 은 사람이 읽는 것이라 매번 답이 달라지면 안 된다 */
function seededPick(seed: string, weights: number[]): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // xorshift32
  h ^= h << 13; h ^= h >>> 17; h ^= h << 5
  const r = ((h >>> 0) % 100000) / 100000
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return 0
  let acc = 0
  for (let i = 0; i < weights.length; i += 1) {
    acc += weights[i]! / total
    if (r < acc) return i
  }
  return weights.length - 1
}

export const TOP_CANDIDATES = 3

export type Candidate = { code: string; score: Scored }
export type MatchPlan = {
  requirements: PostRequirements
  /** 하드 필터 통과자 — 점수 내림차순 */
  eligible: Candidate[]
  /** 🔴 상위 3명. 여기서 추천을 뽑는다 */
  top: Candidate[]
  /** 🔴 최고점이 아니라 상위 3명 중 가중 무작위 (seed 고정) */
  recommended: string | null
  blocked: { code: string; reasons: Blocked[] }[]
  /** 🔴 후보가 없으면 발행하지 않는다. 억지로 배정하지 않는다 */
  publishable: boolean
}

export type MatchInput = {
  /** seed. 같은 글은 언제 돌려도 같은 추천이 나온다 */
  queueId: string
  title: string
  body: string
  personas: readonly PersonaForMatch[]
}

export function planMatch(input: MatchInput): MatchPlan {
  const req = readPostRequirements(input.title, input.body)
  const chars = [...input.body].length

  const eligible: Candidate[] = []
  const blocked: MatchPlan['blocked'] = []

  for (const p of input.personas) {
    const reasons = hardFilter(p, req, input.title, input.body)
    if (reasons.length > 0) { blocked.push({ code: p.code, reasons }); continue }
    eligible.push({ code: p.code, score: scoreMatch(p, req, chars) })
  }

  // 🔴 동점이면 code 순 — 정렬이 흔들리면 dry-run 이 재현되지 않는다
  eligible.sort((a, b) => b.score.total - a.score.total || a.code.localeCompare(b.code))
  const top = eligible.slice(0, TOP_CANDIDATES)
  const recommended = top.length === 0
    ? null
    : top[seededPick(input.queueId, top.map((c) => c.score.total))]!.code

  return { requirements: req, eligible, top, recommended, blocked, publishable: top.length > 0 }
}

// ─────────────────────────────────────────────────────────
// ⑥ 배치 순차 할당 — 🔴 여러 건을 한 번에 볼 때
// ─────────────────────────────────────────────────────────

/**
 * 🔴 왜 필요한가
 *
 *    planMatch 는 한 건을 본다. 7건을 각각 부르면 **같은 사람이 계속 뽑힌다** —
 *    실측에서 P07 이 6건 중 4건을 가져갔다. 주간 상한이 있는데도 그렇다.
 *    가드가 없어서가 아니라, **배치 안에서 소비되지 않아서**다.
 *
 * 🔴 처리 순서가 규칙이다
 *
 *    후보가 적은 초안을 **먼저** 배정한다. 조건 없는 글(후보 5명)을 먼저 돌리면
 *    후보 1명뿐인 글(예: 고3 자녀 글)의 그 1명이 이미 소진돼 발행 불가가 된다.
 *    희소한 쪽을 먼저 지키는 것이 전체 배정 수를 늘린다.
 */
export type BatchDraft = { queueId: string; title: string; body: string; gateVerdict: string; createdAt: number }

export type BatchAssignment = {
  queueId: string
  /** 🔴 배치 여력을 반영한 최종 배정. 없으면 이 배치에서 발행하지 않는다 */
  assigned: string | null
  /** 여력을 무시했을 때의 추천 — 비교용 */
  standalone: string | null
  eligible: Candidate[]
  top: Candidate[]
  blocked: MatchPlan['blocked']
  requirements: PostRequirements
  /** 🔴 후보는 있었는데 여력이 없어 밀린 것 — 발행 불가와 구분한다 */
  deferredBy: string[]
}

export type BatchPlan = {
  assignments: BatchAssignment[]
  /** 페르소나별 이번 배치 배정 수 */
  load: Record<string, number>
}

/**
 * 🔴 정렬은 **전부 결정적**이어야 한다. 하나라도 흔들리면 dry-run 이 재현되지 않는다.
 *    ① 후보 적은 순  ② gate PASS 먼저  ③ createdAt  ④ queueId
 */
export function batchOrder(
  a: { eligibleCount: number; gateVerdict: string; createdAt: number; queueId: string },
  b: { eligibleCount: number; gateVerdict: string; createdAt: number; queueId: string },
): number {
  if (a.eligibleCount !== b.eligibleCount) return a.eligibleCount - b.eligibleCount
  const rank = (v: string): number => (v === 'PASS' ? 0 : 1)
  if (rank(a.gateVerdict) !== rank(b.gateVerdict)) return rank(a.gateVerdict) - rank(b.gateVerdict)
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.queueId.localeCompare(b.queueId)
}

export function planBatch(drafts: readonly BatchDraft[], personas: readonly PersonaForMatch[]): BatchPlan {
  // ── ① 여력 — 주간 상한에서 이미 쓴 만큼을 뺀다 ──
  const remaining = new Map<string, number>()
  for (const p of personas) remaining.set(p.code, Math.max(0, POST_CAP_PER_WEEK - p.postsThisWeek))

  // ── ② 각 초안의 후보를 먼저 구한다 (여력 무시) ──
  const base = drafts.map((d) => ({
    draft: d,
    plan: planMatch({ queueId: d.queueId, title: d.title, body: d.body, personas }),
  }))

  // ── ③ 🔴 후보 적은 순으로 처리한다 ──
  const ordered = [...base].sort((x, y) =>
    batchOrder(
      { eligibleCount: x.plan.eligible.length, gateVerdict: x.draft.gateVerdict, createdAt: x.draft.createdAt, queueId: x.draft.queueId },
      { eligibleCount: y.plan.eligible.length, gateVerdict: y.draft.gateVerdict, createdAt: y.draft.createdAt, queueId: y.draft.queueId },
    ),
  )

  const out = new Map<string, BatchAssignment>()
  const load: Record<string, number> = {}

  for (const { draft, plan } of ordered) {
    // 🔴 여력이 남은 후보만 다시 추린다. 점수는 다시 계산하지 않는다 —
    //    같은 글에 대해 두 개의 점수가 생기면 어느 것이 진실인지 모른다
    const alive = plan.eligible.filter((c) => (remaining.get(c.code) ?? 0) > 0)
    const deferredBy = plan.eligible.filter((c) => (remaining.get(c.code) ?? 0) <= 0).map((c) => c.code)
    const top = alive.slice(0, TOP_CANDIDATES)
    const assigned = top.length === 0
      ? null
      : top[seededPick(draft.queueId, top.map((c) => c.score.total))]!.code

    if (assigned !== null) {
      remaining.set(assigned, (remaining.get(assigned) ?? 0) - 1)
      load[assigned] = (load[assigned] ?? 0) + 1
    }

    out.set(draft.queueId, {
      queueId: draft.queueId,
      assigned,
      standalone: plan.recommended,
      eligible: plan.eligible,
      top,
      blocked: plan.blocked,
      requirements: plan.requirements,
      deferredBy,
    })
  }

  // 🔴 입력 순서로 돌려준다. 처리 순서는 내부 사정이고, 읽는 사람은 원래 순서를 기대한다
  return { assignments: drafts.map((d) => out.get(d.queueId)!), load }
}
