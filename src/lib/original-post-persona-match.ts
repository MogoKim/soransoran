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
 * 🔴 **최고점을 뽑지 않는다.** 단건 추천은 상위 3명 중 가중 무작위다(아키텍처 §9) —
 *    배치 배정(`planBatch`)은 그 3명을 **우선 선호**하되 자리가 겹치면 전체 `eligible` 까지 내려간다.
 *    두 규칙이 다른 이유는 §9 표에 적어 두었다 —
 *    항상 최고점을 뽑으면 특정 페르소나에 활동이 몰리고, 그것이 "같은 사람이 쓴 티" 의 원인이다.
 *    다만 **queueId 로 seed 를 고정**한다. dry-run 은 사람이 읽는 것이라 매번 답이 달라지면 안 된다.
 *
 * 🔴 이 파일은 고객 경로에서 import 되지 않는다. import 가 하나도 없다(fixture 가 강제).
 */

import { judgeRealMember } from './real-member-gate'
import { effectiveWeeklyCap, SAFEST_PROFILE } from './scale-profile'

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
/**
 * 🔴 **가장 안전한 기본값이다** (2026-09-08 개정). 실제 값은 러너가 `caps` 로 주입한다 —
 *    module-load 시점에 env 를 읽으면 `loadEnvLocal()` 보다 먼저 굳어 설정이 반영되지 않는다.
 *    주입을 잊으면 여기로 떨어진다(주 1건 · 5일). 조용히 느슨해지지 않는다.
 */
export const POST_CAP_PER_WEEK = effectiveWeeklyCap(SAFEST_PROFILE.postsPerWeek, SAFEST_PROFILE.minDaysBetween)
/** 🔴 같은 사람이 사흘 걸러 글을 쓰면 티가 난다 */
export const MIN_DAYS_BETWEEN_POSTS = SAFEST_PROFILE.minDaysBetween

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
  /**
   * 🔴 **방어적 보조 지표다 — 정본이 아니다** (2026-09-08).
   *
   *    `User.providerId` 는 NextAuth adapter 가 채우지 않는다 (`src/lib/auth.ts` §signIn).
   *    실제로 실회원 판별은 **`Account` 행이 있는가**로 한다 — 카카오 로그인이 만드는 것은
   *    `Account` 이지 `User.providerId` 가 아니다.
   *    실측(2026-09-08): User 9명 전원 `providerId=null` 이라 이 검사만으로는 아무도 못 막는다.
   *
   *    그래도 남겨 둔다. 누군가 수동으로 채워 둔 값이 있으면 그것도 막아야 한다.
   */
  providerId: string | null
  /**
   * 🔴 **실회원 판별 정본** — 이 persona 의 User 에 연결된 `Account` 행 수.
   *
   *    하나라도 있으면 로그인 수단이 붙은 계정이므로 **실회원**이다.
   *    운영 persona 는 로그인하지 않으므로 항상 0 이다 (실측: active 5명 전원 0).
   *
   *    🔴 `null` 은 **"모른다"** 이고 fail-closed 로 막는다 — 조회에 실패했거나
   *    생산 경로가 이 필드를 넘기지 않았다는 뜻이다. 모르는 채로 남의 이름으로 발행하느니 멈춘다.
   */
  accountCount: number | null
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
  REAL_MEMBER: '🔴 실회원 계정이다 (Account 연결 또는 판별 불가)',
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
/**
 * 🔴 규모 프로필 주입 — 기본은 운영 프로필이다.
 *    시뮬레이션(10/day 계획 등)이 다른 cap 으로 돌 수 있어야 하되,
 *    **운영 경로는 아무것도 넘기지 않아 항상 가장 안전한 기본값 을 쓴다.**
 */
export type BatchCaps = { postsPerWeek?: number; minDaysBetween?: number }

export function hardFilter(
  p: PersonaForMatch,
  req: PostRequirements,
  postTitle: string,
  postBody: string,
  /** 🔴 시뮬레이션용 cap. 운영은 넘기지 않아 가장 안전한 기본값 을 쓴다 */
  caps: BatchCaps = {},
): Blocked[] {
  const out: Blocked[] = []

  // ── 운영 조건 ──
  if (p.status !== 'active') out.push({ code: 'NOT_ACTIVE', detail: `status=${p.status}` })
  // 🔴 실회원 이름으로 발행되면 신뢰 사고다. 되돌리기 어렵다.
  //    정본은 `Account` 다 — 카카오 로그인이 만드는 것은 Account 이지 User.providerId 가 아니다.
  //    `providerId` 검사는 방어적으로 남긴다(수동으로 채워 둔 값도 막는다).
  //    🔴 판정은 `judgeRealMember` 하나뿐이다 — 여기서 다시 쓰면 한쪽만 고쳐지는 날이 온다
  const real = judgeRealMember({ accountCount: p.accountCount, providerId: p.providerId })
  if (real.real) out.push({ code: 'REAL_MEMBER', detail: real.reason })

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
  const weekCap = caps.postsPerWeek ?? POST_CAP_PER_WEEK
  const minGap = caps.minDaysBetween ?? MIN_DAYS_BETWEEN_POSTS
  if (p.postsThisWeek >= weekCap) {
    out.push({ code: 'WEEKLY_CAP', detail: `이번 주 ${p.postsThisWeek} / ${weekCap}` })
  }
  if (p.daysSinceLastPost !== null && p.daysSinceLastPost < minGap) {
    out.push({ code: 'TOO_SOON', detail: `${p.daysSinceLastPost}일 전 · 최소 ${minGap}일` })
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
  /** 🔴 상위 3명. **단건 추천**은 여기서만 뽑는다 (배치는 선호 순서로만 쓴다) */
  top: Candidate[]
  /** 🔴 최고점이 아니라 상위 3명 중 가중 무작위 (seed 고정) — **단건 추천 전용** */
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
  /** 🔴 시뮬레이션용 cap. 운영은 넘기지 않아 가장 안전한 기본값 을 쓴다 */
  caps?: BatchCaps
}

export function planMatch(input: MatchInput): MatchPlan {
  const req = readPostRequirements(input.title, input.body)
  const chars = [...input.body].length

  const eligible: Candidate[] = []
  const blocked: MatchPlan['blocked'] = []

  for (const p of input.personas) {
    const reasons = hardFilter(p, req, input.title, input.body, input.caps ?? {})
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
 * 🔴 **최대 매칭이다. 선착순이 아니다** (2026-09-07 교체)
 *
 *    이전에는 "후보가 적은 초안부터 한 명씩 집어 간다"는 탐욕법이었다.
 *    그 방식은 **쓸 수 있는 persona 를 늘렸는데 배정 수가 줄어드는** 일을 허용한다 —
 *    실측: 5명 + N01 N02 N03 은 14일 13건인데, 여기에 N04 를 더하면 10건으로 **줄었다.**
 *    N04 가 나쁜 것이 아니다. persona 가 하나 늘면 각 초안의 `eligible` 수가 달라지고,
 *    그러면 처리 순서가 통째로 뒤집혀 앞선 초안이 희소한 persona 를 먼저 먹어버린다.
 *
 *    그래서 순서로 답을 정하지 않는다. **이분 그래프의 최대 매칭**을 구한다
 *    (증가 경로 · Kuhn). persona 를 더하면 그래프에 정점과 간선만 늘어나므로
 *    최대 매칭 크기는 **수학적으로 줄어들 수 없다.** 이것이 단조성의 근거다.
 *
 * 🔴 처리 순서는 "누가 먼저 보장받는가" 만 정한다
 *
 *    증가 경로는 이미 매칭된 초안을 매칭에서 빼지 않는다. 그래서 먼저 처리한 초안은
 *    **매칭 가능하기만 하면 반드시 배정된다.** 오래 기다린 글부터 처리하는 이유다.
 *    크기는 어느 순서로 돌려도 최대이므로, 순서는 공정성만 정하고 총량은 건드리지 않는다.
 *
 * 🔴 `top` 3명은 **선호이지 제약이 아니다**
 *
 *    경쟁이 없으면 단건 추천과 똑같이 상위 3명 중 시드로 뽑은 사람이 간다. 경쟁이 생겼을 때만
 *    그 아래 `eligible` 로 내려간다. 여기서 top 밖을 잘라내면 persona 를 늘렸을 때
 *    남의 top 구성이 바뀌며 기존 간선이 사라져 **다시 단조성이 깨진다.**
 *    `eligible` 은 전원 hardFilter 를 통과한 사람이므로 내려가도 안전하다.
 */
export type BatchDraft = {
  queueId: string
  title: string
  body: string
  gateVerdict: string
  createdAt: number
  /**
   * 🔴 **이전 회차가 이미 배정한 persona code** — 있으면 그것이 정본이다 (2026-09-07).
   *
   * 배정을 저장한 뒤 발행 전에 죽으면 이 상태로 남는다. 그때 새 매칭을 돌려
   * 다른 사람에게 넘기면, 화면이 보여준 사람과 실제로 글을 쓴 사람이 달라진다.
   * 그래서 이 행은 **매칭에 넣지 않고 그대로 둔다.**
   *
   * 여력도 다시 빼지 않는다 — `matchedAt` 이 이미 남아 있어 `postsThisWeek` 에 세어졌다.
   * 여기서 또 빼면 한 건이 두 번 센 것이 된다.
   */
  assignedPersonaCode?: string | null
}

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
  /** 🔴 이전 회차가 배정만 하고 발행하지 못한 행인가 — 그렇다면 재배정 대상이 아니다 */
  recovery: boolean
  /**
   * 🔴 기존 배정이 **쓸 수 없는 persona** 를 가리킨다 — 없는 사람 · 비활성 · 실회원.
   *    조용히 다른 사람으로 바꾸지 않는다. 부르는 쪽이 멈춰야 한다.
   */
  recoveryProblem: string | null
}

export type BatchPlan = {
  assignments: BatchAssignment[]
  /** 페르소나별 이번 배치 배정 수 */
  load: Record<string, number>
}

/**
 * 🔴 정렬은 **전부 결정적**이어야 한다. 하나라도 흔들리면 dry-run 이 재현되지 않는다.
 *
 *    ① 후보 적은 순  ② gate PASS 먼저  ③ createdAt  ④ queueId
 *
 * 🔴 최대 매칭에서 이 순서는 **총량을 정하지 않는다.** 크기는 어느 순서로 돌려도 최대다.
 *    순서가 정하는 것은 "누가 먼저 자리를 보장받는가" 뿐이다. 그래서 후보가 1명뿐인 글
 *    (예: 자녀 중고등 글) 을 앞에 두어 그 1명을 지킨다 — 예전처럼 순서로 총량이
 *    흔들리지는 않으므로, `eligibleCount` 가 persona 추가로 변해도 발행량은 줄지 않는다.
 *
 * 🔴 발행 순서와는 다른 이야기다. 실제로 나갈 한 건은 `pickPublishTarget` 이
 *    **가장 오래 기다린 배정 가능 글**로 따로 고른다.
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

/**
 * 이분 최대 매칭 — 🔴 증가 경로(Kuhn). 외부 라이브러리를 쓰지 않는다.
 *
 * 후보 수십 · persona 수십 규모라 O(V·E) 로 충분하다. 라이브러리를 들이면
 * 이 판정이 우리 것이 아니게 되고, 버전이 바뀌면 배정이 조용히 달라진다.
 *
 * `prefOf` 는 **선호 순서**다. 앞에 있는 자리를 먼저 시도하므로 경쟁이 없으면 1순위가 간다.
 * 결과는 입력 순서와 무관하고 같은 입력에 항상 같다.
 */
function maxMatch(order: readonly string[], prefOf: ReadonlyMap<string, readonly string[]>): Map<string, string> {
  /** 자리 → 그 자리를 쓰는 초안 */
  const owner = new Map<string, string>()
  /** 초안 → 배정된 자리 */
  const seat = new Map<string, string>()

  const augment = (key: string, seen: Set<string>): boolean => {
    for (const slot of prefOf.get(key) ?? []) {
      if (seen.has(slot)) continue
      seen.add(slot)
      const held = owner.get(slot)
      // 🔴 빈 자리거나, 그 자리 주인이 다른 자리로 옮겨갈 수 있으면 이 초안이 앉는다
      if (held === undefined || augment(held, seen)) {
        owner.set(slot, key)
        seat.set(key, slot)
        return true
      }
    }
    return false
  }

  // 🔴 앞에서 처리한 초안은 이후에도 매칭에서 빠지지 않는다 — 증가 경로의 성질이다
  for (const key of order) augment(key, new Set())
  return seat
}

export function planBatch(
  drafts: readonly BatchDraft[],
  personas: readonly PersonaForMatch[],
  caps: BatchCaps = {},
): BatchPlan {
  const weekCap = caps.postsPerWeek ?? POST_CAP_PER_WEEK
  // ── ① 여력 — 주간 상한에서 이미 쓴 만큼을 뺀다 ──
  const capacity = new Map<string, number>()
  for (const p of personas) capacity.set(p.code, Math.max(0, weekCap - p.postsThisWeek))
  const byCode = new Map(personas.map((p) => [p.code, p]))

  // ── ①-b 🔴 이미 배정된 행은 **매칭에 넣지 않는다.** 기존 배정이 정본이다 ──
  //    여력도 다시 빼지 않는다 — matchedAt 이 이미 postsThisWeek 에 세어져 있다
  const pinnedCodeOf = (d: BatchDraft): string | null => {
    const c = (d.assignedPersonaCode ?? '').trim()
    return c === '' ? null : c
  }
  /** 🔴 그 배정을 지금도 쓸 수 있는가. 못 쓰면 **멈춘다** — 말없이 다른 사람으로 바꾸지 않는다 */
  const recoveryProblemOf = (code: string): string | null => {
    const p = byCode.get(code)
    if (p === undefined) return `배정된 persona ${code} 를 찾을 수 없다`
    if (p.status !== 'active') return `배정된 persona ${code} 가 active 가 아니다 (${p.status})`
    // 🔴 복구도 같은 판정을 쓴다. 배정 때 통과했더라도 그 사이에 계정이 붙을 수 있고,
    //    모르면 막는다 — 우회해서 다른 글을 내면 멈춘 레인이 도는 것처럼 보인다
    const real = judgeRealMember({ accountCount: p.accountCount, providerId: p.providerId })
    if (real.real) return `배정된 persona ${code} — ${real.reason}`
    return null
  }

  const pinned = drafts.filter((d) => pinnedCodeOf(d) !== null)
  const fresh = drafts.filter((d) => pinnedCodeOf(d) === null)

  // ── ② 각 초안의 후보를 먼저 구한다 (여력 무시) ──
  const base = fresh.map((d) => ({
    draft: d,
    plan: planMatch({ queueId: d.queueId, title: d.title, body: d.body, personas, caps }),
  }))

  // ── ③ 🔴 희소한 글부터 자리를 보장한다. 총량은 최대 매칭이 정하므로 순서로 흔들리지 않는다 ──
  const ordered = [...base].sort((x, y) =>
    batchOrder(
      { eligibleCount: x.plan.eligible.length, gateVerdict: x.draft.gateVerdict, createdAt: x.draft.createdAt, queueId: x.draft.queueId },
      { eligibleCount: y.plan.eligible.length, gateVerdict: y.draft.gateVerdict, createdAt: y.draft.createdAt, queueId: y.draft.queueId },
    ),
  )

  // ── ④ 자리(slot) 를 편다 — 주 상한이 2 이상이면 한 사람이 자리를 여러 개 갖는다 ──
  const slotsOf = (code: string): string[] =>
    Array.from({ length: capacity.get(code) ?? 0 }, (_, i) => `${code}#${i}`)

  const prefOf = new Map<string, string[]>()
  const topOf = new Map<string, Candidate[]>()
  const deferredOf = new Map<string, string[]>()

  for (const { draft, plan } of ordered) {
    // 🔴 여력이 남은 후보만. 점수는 다시 계산하지 않는다 —
    //    같은 글에 대해 두 개의 점수가 생기면 어느 것이 진실인지 모른다
    const alive = plan.eligible.filter((c) => (capacity.get(c.code) ?? 0) > 0)

    const top = alive.slice(0, TOP_CANDIDATES)
    topOf.set(draft.queueId, top)

    // 🔴 1순위는 단건 추천과 같은 사람이다 — 상위 3명 중 시드로 뽑는다.
    //    그 뒤에 나머지 eligible 을 붙여, **자리 경쟁이 있을 때만** 아래로 내려가게 한다
    const pickedAt = top.length === 0 ? 0 : seededPick(draft.queueId, top.map((c) => c.score.total))
    const preferred = top.length === 0 ? [] : [...top.slice(pickedAt), ...top.slice(0, pickedAt)]
    const pref = [...preferred, ...alive.slice(TOP_CANDIDATES)]
    prefOf.set(draft.queueId, pref.flatMap((c) => slotsOf(c.code)))
  }

  // ── ⑤ 🔴 최대 매칭 ──
  const seat = maxMatch(ordered.map((o) => o.draft.queueId), prefOf)

  const load: Record<string, number> = {}
  for (const slot of seat.values()) {
    const code = slot.slice(0, slot.lastIndexOf('#'))
    load[code] = (load[code] ?? 0) + 1
  }
  // 🔴 기존 배정도 부하로 센다 — 화면이 "이번 주 누가 몇 건" 을 말할 때 빠지면 안 된다.
  //    여력(capacity)은 이미 반영돼 있으므로 여기서만 더한다
  for (const d of pinned) {
    const code = pinnedCodeOf(d)!
    if (recoveryProblemOf(code) === null) load[code] = (load[code] ?? 0) + 1
  }

  // 🔴 "여력이 없어 밀렸다" 는 **매칭이 끝난 뒤**에야 알 수 있다.
  //    탐욕법에서는 차감해 가며 알 수 있었지만, 최대 매칭은 자리를 한꺼번에 정한다.
  //    그래서 남은 자리로 판단한다 — 처음부터 여력 0 인 사람과 이번 배치에서 자리를 다 내준 사람이 함께 잡힌다
  const freeSeats = (code: string): number => (capacity.get(code) ?? 0) - (seatLoad(code))
  function seatLoad(code: string): number {
    let n = 0
    for (const slot of seat.values()) if (slot.slice(0, slot.lastIndexOf('#')) === code) n += 1
    return n
  }

  const out = new Map<string, BatchAssignment>()
  for (const { draft, plan } of ordered) {
    const slot = seat.get(draft.queueId)
    const assigned = slot === undefined ? null : slot.slice(0, slot.lastIndexOf('#'))
    out.set(draft.queueId, {
      queueId: draft.queueId,
      assigned,
      standalone: plan.recommended,
      eligible: plan.eligible,
      top: topOf.get(draft.queueId) ?? [],
      blocked: plan.blocked,
      requirements: plan.requirements,
      deferredBy: plan.eligible.filter((c) => c.code !== assigned && freeSeats(c.code) <= 0).map((c) => c.code),
      recovery: false,
      recoveryProblem: null,
    })
  }

  // ── ⑥ 🔴 기존 배정 행 — 재계산하지 않는다. 요건만 읽어 화면에 보여준다 ──
  for (const d of pinned) {
    const code = pinnedCodeOf(d)!
    const problem = recoveryProblemOf(code)
    out.set(d.queueId, {
      queueId: d.queueId,
      // 🔴 쓸 수 없는 배정이면 null 이다. 다른 사람을 넣지 않는다 — 부르는 쪽이 멈춘다
      assigned: problem === null ? code : null,
      standalone: null,
      eligible: [],
      top: [],
      blocked: [],
      requirements: readPostRequirements(d.title, d.body),
      deferredBy: [],
      recovery: true,
      recoveryProblem: problem,
    })
  }

  // 🔴 입력 순서로 돌려준다. 처리 순서는 내부 사정이고, 읽는 사람은 원래 순서를 기대한다
  return { assignments: drafts.map((d) => out.get(d.queueId)!), load }
}
