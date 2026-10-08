/**
 * Persona **자동 확장 후보** — 🔴 순수 함수. DB · 파일 · 네트워크 · LLM 없음 (2026-09-29, Track C)
 *
 * 🔴 **이름만 늘리지 않는다.** 후보 한 명은 네 덩어리가 전부 있어야 선다.
 *
 *      life      생활사 골격 — 나이대·생일·지역·혼인·자녀·일·형편·주거·갱년기·돌봄
 *                🟢 여기서 **결정론으로** 만든다(얇은 축을 메우는 조합을 고른다)
 *      voice     말투 근거 — **아직 아무에게도 배정되지 않은 정본 코퍼스 화자** 한 명의 묶음
 *                🟢 코퍼스에서 **결정론으로** 꺼낸다(부르는 쪽 `scripts/lib/persona-autogen.mts`)
 *      creative  제목·성격·noGo 소재·noGo 표현·variation — **그 사람을 사람으로 만드는 글자**
 *                🔴 결정론으로 만들 수 없다. LLM(또는 사람) 단계다 — `--generate-creative`(`persona-creative`)
 *                   또는 `--supplement`. 둘 다 없으면 `LLM_STEP_UNIMPLEMENTED`. 빈칸을 기본값으로 채우면
 *                   그것이 곧 이름만 늘린 사람이다.
 *      cadence   활동 상한·리듬 — 운영 중인 Persona 의 **최빈값**을 읽어 온다(없으면 모른다)
 *
 * 🔴 판정은 여기서 만들지 않는다. 카드 파서 · seed 검증 · 3계층 · 배정 판정은
 *    **운영이 쓰는 그 함수**를 부르는 쪽이 부른다(`scripts/lib/persona-autogen.mts`).
 *    여기 있는 것은 골격 생성 · 말투 관찰값 · 카드 렌더러 · seed 조립뿐이다.
 */
import { CHILD_AGE_BANDS, type ChildAgeBand } from './original-post-persona-match'
import { ANCHOR_BASE_DATE, checkLifeConsistency, exactAgeOn, bandOfAge } from './persona-birth-anchor'
import { coverageOf, gainOf, THIN_THRESHOLD, type AxisSubject } from './persona-axis-coverage'
import { MARITAL_VALUES } from './persona-card-verify'
import type { PoolCard } from './persona-pool-card'
import type { VoiceReferenceBundle } from './persona-voice-reference'

// ─────────────────────────────────────────────────────────
// 코드 · 판정 코드
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **자동 후보가 쓰는 코드 범위** — P26 ~ P50.
 *    실제 발급은 이 범위 안에서 **high-water mark 뒤에서만** 한다(`nextAutogenCodes` · append-only) —
 *    정본 카드 · 운영 DB 행 · 폐기 코드(`RETIRED_AUTOGEN_CODES`) 중 가장 큰 번호 아래 빈 번호는 다시 쓰지 않는다.
 *    상한 P50 은 `isPoolCode` · `verifyManifest` 의 정규식과 같은 값이다.
 */
export const AUTOGEN_CODE_FIRST = 26
export const AUTOGEN_CODE_LAST = 50

export const autogenCodeOf = (n: number): string => `P${String(n).padStart(2, '0')}`

/**
 * 🔴 **폐기 코드 — 영구 재사용 금지** (2026-10-08).
 *
 *    Persona 코드는 감사 가능한 식별자이므로 한 번 발급된 코드는 탈락해도 재사용하지 않고,
 *    신규 코드는 기존 high-water mark 뒤에서만 발급한다.
 *
 *    🔴 `persona-cohort.EXCLUDED_CODES`(P09) 와 다른 뜻이다. P09 는 **카드가 있는** Persona 를
 *       cohort 에서 뺀 것이고, 여기는 **발급됐다가 탈락해 카드가 없는** 코드다. 섞지 않는다.
 *    🔴 빈 번호를 다시 채우면 그 코드가 운영 코드 사이에 끼어 코드순 말투 배정(`voicePoolFor`)이
 *       기존 production Persona 의 묶음을 바꾼다(2026-10-08 실측: P31 후보 → P32 배정 변동).
 */
export const RETIRED_AUTOGEN_CODES: Readonly<Record<string, string>> = {
  P31: '2026-10-08 실제 생성(persona30 original batch)에서 VOICE_TOO_CLOSE 로 탈락 — 발급된 코드',
  P33: '2026-10-08 실제 생성(persona30 original batch)에서 VOICE_TOO_CLOSE 로 탈락 — 발급된 코드',
}

/** `P34` → 34 · Persona 코드 모양이 아니면 null — 🔴 문자열 사전순이 아니라 숫자로 비교한다 */
export const personaCodeNumber = (code: string): number | null => {
  const m = /^P(\d+)$/.exec(code)
  return m === null ? null : Number(m[1])
}

export type NextAutogenCodes = {
  codes: string[]
  /** 이미 쓰인 가장 큰 번호 — 카드 · 운영 DB · 폐기 코드 전부 */
  highWater: number
  /** 🔴 null 이 아니면 후보 0 — 부르는 쪽은 provider 호출 전에 멈춘다 */
  problem: string | null
}

/**
 * 🔴 **다음 자동 후보 코드 — append-only.** high-water mark(카드 · 운영 DB · 폐기 코드의 최대 번호)
 *    **뒤에서만** 발급한다. 그 아래 빈 번호는 채우지 않는다. 상한(P50)까지 자리가 없으면 후보 0.
 */
export function nextAutogenCodes(input: { usedCodes: Iterable<string>; count: number }): NextAutogenCodes {
  const nums = [...input.usedCodes, ...Object.keys(RETIRED_AUTOGEN_CODES)]
    .map(personaCodeNumber).filter((n): n is number => n !== null)
  const highWater = Math.max(AUTOGEN_CODE_FIRST - 1, ...nums)
  const codes: string[] = []
  for (let n = highWater + 1; n <= AUTOGEN_CODE_LAST && codes.length < input.count; n += 1) codes.push(autogenCodeOf(n))
  return {
    codes,
    highWater,
    problem: codes.length > 0 ? null
      : `발급할 코드가 없다 — high-water ${autogenCodeOf(highWater)} · 상한 ${autogenCodeOf(AUTOGEN_CODE_LAST)}`,
  }
}

/**
 * 🔴 **격리 사유 코드.** 한 후보에 여럿이 붙을 수 있다 — 무엇을 채워야 서는지가 여기서 나온다.
 *
 *    `NAME_ONLY`               코드·이름뿐이다 — 격리가 아니라 **거부**한다
 *    `LLM_STEP_UNIMPLEMENTED`  creative 칸이 없다 — 생성을 돌리지 않았고 보충 파일도 없다
 *    `CREATIVE_*`              생성을 돌렸으나 creative 가 서지 않았다(형식 위반 · 호출 실패 · 상한 · 원문 유출 차단)
 *    `*_UNMEASURED`            재지 못했다 — 🔴 모르는 것은 통과가 아니다
 */
export const AUTOGEN_BLOCK_CODES = [
  'NAME_ONLY',
  'CODE_INVALID', 'CODE_TAKEN',
  'LIFE_AXIS_MISSING', 'LIFE_INCONSISTENT', 'NO_AGE_BAND',
  'NO_VOICE_EVIDENCE', 'VOICE_EVIDENCE_THIN', 'VOICE_SPEAKER_DUPLICATE', 'VOICE_LENGTH_UNREADABLE',
  'VOICE_ASSIGNMENT_DRIFT',
  'REAL_MEMBER_COLLISION', 'REAL_MEMBER_UNMEASURED',
  'CADENCE_UNMEASURED',
  'LLM_STEP_UNIMPLEMENTED',
  // 🔴 creative 생성(2026-10-06 · `persona-creative`) — 돌렸으나 서지 않았다. 기본값으로 메우지 않는다
  'CREATIVE_INVALID', 'CREATIVE_CALL_FAILED', 'CREATIVE_BUDGET_BLOCKED', 'CREATIVE_LEAK_BLOCKED',
  'CARD_PARSE_FAILED', 'SEED_INVALID',
  'POST_INELIGIBLE', 'COMMENT_INELIGIBLE',
  // 🔴 4상태 계약(`persona-reserve` `contractAxes`) — 운영 계기판과 같은 판정이 막은 것
  'QUALIFICATION_CONFLICT', 'CONTRACT_INVALID',
  // 🔴 이름만 다른 사람 — 후보·정본 카드와 성격·관점·noGo·말투가 겹친다
  'NEAR_DUPLICATE_PERSONA', 'VOICE_TOO_CLOSE', 'VOICE_SEPARATION_UNMEASURED',
] as const
export type AutogenBlockCode = (typeof AUTOGEN_BLOCK_CODES)[number]

// ─────────────────────────────────────────────────────────
// 후보의 네 덩어리
// ─────────────────────────────────────────────────────────

export type LifeSkeleton = {
  ageBand: string
  /** 🔴 내부 생일 — 카드에 적히는 순간 정본이 된다. 이후 규칙이 바뀌어도 다시 만들지 않는다 */
  birthDate: string
  region: string
  maritalStatus: string
  /** 기혼만 `원만·소원·갈등` — 그 밖은 `해당없음` */
  spouseRelationship: string
  childrenCount: number
  childrenAgeBands: ChildAgeBand[]
  /** 자녀가 없으면 null */
  childrenLiving: '동거' | '분가' | null
  workStatus: string
  economicStatus: string
  housing: string
  menopauseStatus: string
  parentCare: string
}

/**
 * 🔴 **LLM(또는 사람) 단계가 채울 칸.** 결정론으로 만들 수 없는 것만 여기 둔다.
 *    `null` 이면 그 단계가 돌지 않은 것이다 — 기본값으로 채우지 않는다.
 */
export type PersonaCreative = {
  title: string
  personality: string[]
  noGoTopics: string[]
  /** 🔴 따옴표로 감싼 말버릇 — 카드 파서가 따옴표로 소재와 가른다 */
  noGoExpressions: string[]
  /** 5~8개 (`VARIATION_MIN`~`VARIATION_MAX`) */
  variations: string[]
}

export type VoiceEvidence = {
  bundle: VoiceReferenceBundle
  /**
   * 🔴 이 묶음의 댓글이 **몇 개의 묶음에** 들어 있는가 — 운영 `referenceSeedShareCount` 의 값.
   *    1 이면 이 화자는 이 후보만 쓴다. 2 이상이면 다른 Persona 의 말투를 빌린 것이다.
   *    `null` = 세지 못했다.
   */
  seedShareCount: number | null
}

export type Cadence = {
  dailyCap: number
  weeklyCap: number
  silenceRate: number
  activityRhythm: { activeHours: number[][]; burstiness: number; weekdayBias: number }
}

/**
 * 🔴 **새 Persona 가 붙을 User** — 자동 후보는 언제나 새 User 를 만든다(기존 User 재사용 금지).
 *    판정 입력은 `judgeRealMember` 와 같은 모양이다. `undefined`·`null` 은 **모른다**다.
 */
export type UserBinding = { accountCount: number | null | undefined; providerId: string | null }

export type DisplayNameCheck = {
  name: string
  /** Gate ⑥-B 결과 — `pass` 만 통과다. 재지 못했으면 `null` */
  gate: 'pass' | 'review' | 'regenerate' | 'reject' | null
}

export type AutogenCandidate = {
  code: string
  life: LifeSkeleton | null
  creative: PersonaCreative | null
  voice: VoiceEvidence | null
  cadence: Cadence | null
  binding: UserBinding
  displayName: DisplayNameCheck | null
}

// ─────────────────────────────────────────────────────────
// 생활사 골격 — 🟢 결정론
// ─────────────────────────────────────────────────────────

/** 🔴 나이대 → 그 나이대에서 **모순 없는** 갱년기 단계. `checkLifeConsistency` 가 다시 본다 */
const MENOPAUSE_BY_AGE: Readonly<Record<string, string>> = {
  '40대 중반': '전', '40대 후반': '전', '50대 초반': '진행중', '50대 후반': '후', '60대 초반': '후',
}
export const AUTOGEN_AGE_BANDS = Object.keys(MENOPAUSE_BY_AGE)

/** 🔴 자녀 구성 후보 — 매칭이 아는 밴드(`CHILD_AGE_BANDS`)만 쓴다 */
const KID_PROFILES: ReadonlyArray<{ count: number; bands: ChildAgeBand[] }> = [
  { count: 0, bands: [] },
  { count: 1, bands: ['초등'] },
  { count: 1, bands: ['중고등'] },
  { count: 2, bands: ['중고등', '초등'] },
  { count: 1, bands: ['대학·취준'] },
  { count: 2, bands: ['대학·취준', '중고등'] },
  { count: 2, bands: ['성인'] },
  { count: 2, bands: ['성인', '대학·취준'] },
]
const WORKS = ['전업', '파트타임', '직장', '자영업', '은퇴'] as const
const ECONOMY = ['빠듯', '보통', '여유'] as const
const HOUSING = ['자가', '전세', '월세'] as const
const CARE = ['없음', '간헐', '상시'] as const
export const AUTOGEN_REGIONS = ['수도권', '광역시', '중소도시', '읍면'] as const
const SPOUSE_REL = ['원만', '소원', '갈등'] as const

/** 🔴 나이대 안쪽 나이 — 초반 +2 · 중반 +5 · 후반 +8. 생일이 기준일 뒤면 한 살 적다(여전히 같은 밴드) */
const AGE_OFFSET: Readonly<Record<string, number>> = { 초반: 2, 중반: 5, 후반: 8 }

/**
 * 🔴 **생일 — 코드 번호로 달·일을 고른다.** 해시가 아니다: 같은 코드는 언제나 같은 날이다.
 *    한 번 카드에 적히면 그 뒤로는 카드가 정본이다(여기서 다시 계산하지 않는다).
 */
export function birthDateFor(ageBand: string, codeNumber: number): string | null {
  const m = /^([4-6]0)대 (초반|중반|후반)$/.exec(ageBand)
  if (m === null) return null
  const age = Number(m[1]) + AGE_OFFSET[m[2]!]!
  const year = Number(ANCHOR_BASE_DATE.slice(0, 4)) - age
  const month = (codeNumber % 12) + 1
  const day = ((codeNumber * 7) % 28) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const subjectOfLife = (code: string, l: LifeSkeleton): AxisSubject => ({
  code,
  childrenAgeBands: l.childrenAgeBands,
  childrenCount: l.childrenCount,
  maritalStatus: l.maritalStatus,
  parentCare: l.parentCare,
  menopauseStatus: l.menopauseStatus,
  workStatus: l.workStatus,
  economicStatus: l.economicStatus,
  housing: l.housing,
  // 🔴 반응·문체 축은 골격이 정하지 않는다 — 생활사 축만 센다
  forbiddenReactionRoles: [],
  voiceLength: null,
})

export const subjectOfCard = (c: PoolCard): AxisSubject => ({
  code: c.code,
  childrenAgeBands: c.childrenAgeBands,
  childrenCount: c.childrenCount,
  maritalStatus: c.maritalStatus,
  parentCare: c.parentCare,
  menopauseStatus: c.menopauseStatus,
  workStatus: c.workStatus,
  economicStatus: c.economicStatus,
  housing: c.housing,
  forbiddenReactionRoles: c.forbiddenReactionRoles,
  voiceLength: c.voiceLength,
})

const lifeKey = (l: LifeSkeleton): string => [
  l.ageBand, l.maritalStatus, l.childrenAgeBands.join('/'), l.workStatus,
  l.economicStatus, l.housing, l.parentCare,
].join('|')

/**
 * 🔴 **골격 한 장이 스스로 모순 없는가** — 정본 `checkLifeConsistency` 로 본다.
 *    생일에서 나온 나이가 나이대 밖이면 그것도 모순이다.
 */
export function lifeProblems(l: LifeSkeleton): string[] {
  const age = exactAgeOn(l.birthDate, ANCHOR_BASE_DATE)
  if (age === null) return [`birthDate 를 읽지 못했다: ${l.birthDate}`]
  const out = checkLifeConsistency({
    age, ageBand: l.ageBand, childrenAgeBands: l.childrenAgeBands, childrenCount: l.childrenCount,
    maritalStatus: l.maritalStatus, menopauseStatus: l.menopauseStatus,
    parentCare: l.parentCare, workStatus: l.workStatus,
  }).map((p) => `${p.axis}: ${p.reason}`)
  if (bandOfAge(age) !== l.ageBand) out.push(`ageBand: 생일 나이 ${age}세는 ${bandOfAge(age)} 다 (${l.ageBand} 아님)`)
  // 🔴 은퇴는 60대 이전에 드물다 — 골격이 스스로 이상한 사람을 만들지 않게 한다
  if (l.workStatus === '은퇴' && age < 58) out.push(`work: ${age}세인데 은퇴다`)
  // 🔴 성인 자녀는 화자가 적어도 45세여야 자연스럽다(터울 20)
  if (l.childrenAgeBands.includes('성인') && age < 45) out.push(`children: ${age}세인데 성인 자녀다`)
  if ((l.childrenCount === 0) !== (l.childrenAgeBands.length === 0)) out.push('children: 수와 나이대가 어긋난다')
  // 🔴 운영 비혼 카드(P15·P20·P24)는 전원 무자녀다 — 골격이 드문 조합을 "얇은 축" 이라며 만들지 않게 한다
  if (l.maritalStatus === '비혼' && l.childrenCount > 0) out.push('children: 비혼인데 자녀가 있다')
  if (!(MARITAL_VALUES as readonly string[]).includes(l.maritalStatus)) out.push(`maritalStatus=${l.maritalStatus}`)
  for (const b of l.childrenAgeBands) {
    if (!(CHILD_AGE_BANDS as readonly string[]).includes(b)) out.push(`모르는 자녀 나이대: ${b}`)
  }
  return out
}

/** 🔴 닮음 벌점 — 칸 하나가 같을 때마다 깎는 양 */
export const SIMILARITY_PENALTY = 0.3

/** 두 골격이 같은 값을 가진 칸 수 (나이대·혼인·자녀·일·형편·주거·돌봄) */
export function sameFields(a: LifeSkeleton, b: LifeSkeleton): number {
  return [
    a.ageBand === b.ageBand, a.maritalStatus === b.maritalStatus,
    a.childrenAgeBands.join('/') === b.childrenAgeBands.join('/'), a.workStatus === b.workStatus,
    a.economicStatus === b.economicStatus, a.housing === b.housing, a.parentCare === b.parentCare,
  ].filter(Boolean).length
}

function leastHeld<T extends string>(options: readonly T[], held: readonly string[]): T {
  let best = options[0]!
  let bestN = Number.POSITIVE_INFINITY
  for (const o of options) {
    const n = held.filter((h) => h === o).length
    if (n < bestN) { best = o; bestN = n }
  }
  return best
}

/**
 * 🔴 **얇은 축을 메우는 골격을 결정론으로 고른다.**
 *
 *    ① 전 조합(나이대 × 혼인 × 자녀 × 일 × 형편 × 주거 × 돌봄)을 편다
 *    ② `lifeProblems` 가 빈 것만 남긴다 — 모순 있는 사람을 만들지 않는다
 *    ③ 이미 있는 카드 + 앞서 고른 골격을 기준으로, **얇은 축을 가장 많이 두텁게 하는** 것을 고른다
 *       (정본 `gainOf` 의 `fixed` 수 → 희소 축 가중 합 → 조합 키 사전순)
 *    ④ 같은 조합을 두 번 고르지 않는다 — 이미 있는 카드와 같은 조합도 고르지 않는다
 *
 * 🔴 무작위 없음. 같은 입력이면 언제나 같은 골격이다.
 */
export function proposeLifeSkeletons(input: {
  existing: readonly PoolCard[]
  codes: readonly string[]
}): { code: string; life: LifeSkeleton }[] {
  const subjects: AxisSubject[] = input.existing.map(subjectOfCard)
  const regions: string[] = input.existing.map((c) => c.region)
  const spouseRels: string[] = input.existing
    .map((c) => c.spouseRelationship ?? '').filter((s) => s !== '')
  const takenKeys = new Set(input.existing.map((c) => lifeKey({
    ageBand: c.ageBand, birthDate: c.birthDate, region: c.region, maritalStatus: c.maritalStatus,
    spouseRelationship: c.spouseRelationship ?? '해당없음', childrenCount: c.childrenCount,
    childrenAgeBands: c.childrenAgeBands, childrenLiving: null, workStatus: c.workStatus,
    economicStatus: c.economicStatus, housing: c.housing, menopauseStatus: c.menopauseStatus,
    parentCare: c.parentCare,
  })))

  const out: { code: string; life: LifeSkeleton }[] = []
  for (const code of input.codes) {
    const n = Number(code.slice(1))
    let best: { life: LifeSkeleton; fixed: number; rarity: number; key: string } | null = null
    const cov = new Map(coverageOf(subjects).map((c) => [c.axis, c.holders.length]))
    for (const ageBand of AUTOGEN_AGE_BANDS) {
      const birthDate = birthDateFor(ageBand, n)
      if (birthDate === null) continue
      for (const maritalStatus of MARITAL_VALUES) {
        for (const kids of KID_PROFILES) {
          for (const workStatus of WORKS) {
            for (const economicStatus of ECONOMY) {
              for (const housing of HOUSING) {
                for (const parentCare of CARE) {
                  const life: LifeSkeleton = {
                    ageBand, birthDate, region: '', maritalStatus,
                    spouseRelationship: maritalStatus === '기혼' ? '' : '해당없음',
                    childrenCount: kids.count, childrenAgeBands: [...kids.bands],
                    childrenLiving: kids.count === 0 ? null
                      : kids.bands.every((b) => b === '성인') ? '분가' : '동거',
                    workStatus, economicStatus, housing,
                    menopauseStatus: MENOPAUSE_BY_AGE[ageBand]!, parentCare,
                  }
                  const key = lifeKey(life)
                  if (takenKeys.has(key)) continue
                  if (lifeProblems(life).length > 0) continue
                  const after = [...subjects, subjectOfLife(code, life)]
                  const fixed = gainOf(subjects, after).filter((g) => g.fixed).length
                  // 🔴 희소 축 가중 — 두께가 얇은 축을 가질수록 크다
                  const mine = coverageOf([subjectOfLife(code, life)])
                    .filter((c) => c.kind === 'life' && c.holders.length > 0)
                  // 🔴 앞서 고른 골격과 닮을수록 깎는다 — 같은 희소 값만 되풀이하면 한 사람을 여럿 만드는 것이다
                  const rarity = mine.reduce((a, c) => a + 1 / (1 + (cov.get(c.axis) ?? 0)), 0)
                    - SIMILARITY_PENALTY * Math.max(0, ...out.map((o) => sameFields(o.life, life)))
                  if (best === null || fixed > best.fixed
                    || (fixed === best.fixed && rarity > best.rarity + 1e-9)
                    || (fixed === best.fixed && Math.abs(rarity - best.rarity) <= 1e-9 && key < best.key)) {
                    best = { life, fixed, rarity, key }
                  }
                }
              }
            }
          }
        }
      }
    }
    if (best === null) continue
    const life: LifeSkeleton = {
      ...best.life,
      region: leastHeld(AUTOGEN_REGIONS, regions),
      spouseRelationship: best.life.maritalStatus === '기혼' ? leastHeld(SPOUSE_REL, spouseRels) : '해당없음',
    }
    regions.push(life.region)
    if (life.maritalStatus === '기혼') spouseRels.push(life.spouseRelationship)
    takenKeys.add(best.key)
    subjects.push(subjectOfLife(code, life))
    out.push({ code, life })
  }
  return out
}

/** 🔴 두께 요약 — 얇은 축 수가 줄었는지 숫자로 본다 */
export function thinLifeAxisCount(subjects: readonly AxisSubject[]): number {
  return coverageOf(subjects).filter((c) => c.kind === 'life' && c.holders.length < THIN_THRESHOLD).length
}

export { subjectOfLife }

// ─────────────────────────────────────────────────────────
// 파생 칸 — 🟢 결정론 (규칙표는 운영 seed 에서 읽은 값이다)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **lifeStage — 운영 seed 24명이 쓰는 어휘 그대로.**
 *    (무자녀 · 양육기 · 자녀 독립 준비 · 자녀 독립기 · 부모 돌봄기) — 2026-09-29 실측
 */
export function lifeStageOf(l: LifeSkeleton): string {
  if (l.childrenCount === 0) return '무자녀'
  if (l.childrenAgeBands.some((b) => b === '영유아' || b === '초등' || b === '중고등')) return '양육기'
  if (l.childrenAgeBands.includes('대학·취준')) return '자녀 독립 준비'
  if (l.parentCare === '상시') return '부모 돌봄기'
  return '자녀 독립기'
}

/**
 * 🔴 **금지 역할 — 정책 최소치.** 조언·주의 전면 금지(`FORBIDDEN_REACTION_ROLES`) + 정보 제공.
 *    운영 카드 24장 중 이 셋을 모두 금지하지 않는 카드는 없다(실측) — 더 좁히는 것은 creative 단계다.
 */
export const AUTOGEN_FORBIDDEN_ROLES: readonly string[] = ['advice', 'caution', 'information']

/**
 * 🔴 **말투 칸 — 이 화자의 실제 댓글에서 잰다.** 지어내지 않는다.
 *
 *    length   묶음 중앙 길이 — ≤25자 `짧은 문장` · ≤70자 `중간 길이` · 그 위 `길게`
 *             (🔴 `readLengthBand` 가 읽는 표현만 쓴다)
 *    register `요` 로 끝나는 비율 ≥ 0.5 → `존댓말`, 아니면 `구어체`
 *    ending   🔴 **만들지 않는다**(Phase F 보정) — 고정 말끝은 카드가 따옴표로 명시할 때만 존재한다.
 *             관측 비율에서 `~요` · `말끝 짧게` 를 합성하던 옛 경로를 지웠다(새 근거 생성 금지)
 *    emoji    자모 웃음·꾸밈 비율 > 0.3 → `가끔`, 아니면 `없음`
 */
export const VOICE_LENGTH_SHORT_MAX = 25
export const VOICE_LENGTH_MEDIUM_MAX = 70

/** 🔴 seed 의 voiceCore — `ending` 은 **선택형**이다. 카드가 명시한 말끝이 있을 때만 들어간다 */
export type SeedVoiceCore = { length: string; register: string; ending?: string; emoji: string }

export function voiceCoreFromBundle(b: VoiceReferenceBundle): SeedVoiceCore {
  // 🔴 묶음의 문체 좌표 — style-only 관측까지 반영한 관찰값이다(원문은 안전 댓글뿐)
  const c = b.style
  const med = b.lengths.median
  const length = med <= VOICE_LENGTH_SHORT_MAX ? '짧은 문장' : med <= VOICE_LENGTH_MEDIUM_MAX ? '중간 길이' : '길게'
  const polite = c.yo >= 0.5
  return {
    length,
    register: polite ? '존댓말' : '구어체',
    emoji: c.jamo + c.deco > 0.3 ? '가끔' : '없음',
  }
}

/**
 * 🔴 **운영 cadence 의 최빈값.** 운영 Persona 가 실제로 쓰는 값에서만 온다 —
 *    입력이 비면 `null` 이다(모르는 것을 기본값으로 채우지 않는다).
 */
export function modeCadence(rows: readonly Cadence[]): Cadence | null {
  if (rows.length === 0) return null
  const counts = new Map<string, { n: number; c: Cadence }>()
  for (const r of rows) {
    const k = JSON.stringify([r.dailyCap, r.weeklyCap, r.silenceRate, r.activityRhythm])
    const cur = counts.get(k)
    counts.set(k, { n: (cur?.n ?? 0) + 1, c: r })
  }
  return [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0]![1].c
}

// ─────────────────────────────────────────────────────────
// 카드 렌더러 · seed — 🔴 운영 파서가 다시 읽는다
// ─────────────────────────────────────────────────────────

const NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'] as const

/**
 * 🔴 **정본 Pool 카드 형식(§5)으로 적는다.** 이 글자를 `parsePoolDoc` 이 다시 읽어
 *    운영과 같은 `PoolCard` 가 나와야 한다 — 렌더러와 파서가 어긋나면 검사가 잡는다.
 *    creative 가 없으면 적지 않는다(`null`) — 빈칸 카드를 만들지 않는다.
 */
export function renderPoolCardBlock(input: {
  code: string
  life: LifeSkeleton
  creative: PersonaCreative
  voiceTokens: readonly string[]
  forbiddenReactionRoles: readonly string[]
}): string {
  const { code, life: l, creative: c } = input
  const marital = l.maritalStatus === '기혼' ? `기혼(${l.spouseRelationship})` : l.maritalStatus
  const kids = l.childrenCount === 0 ? '자녀 없음'
    : `자녀 ${l.childrenCount}(${l.childrenAgeBands.join('·')}${l.childrenLiving === null ? '' : `, ${l.childrenLiving}`})`
  const vars = c.variations.map((v, i) => `${NUM[i] ?? `(${i + 1})`} ${v}`).join(' ')
  return [
    `### ${code} — ${c.title}`,
    '',
    '```',
    `ageBand ${l.ageBand} · ${l.region} · ${marital} · ${kids}`,
    `birthDate ${l.birthDate}   · 🔴 내부 값이다. 글에 쓰지 않는다 — 계산된 나이만 쓴다`,
    `${l.workStatus} · ${l.economicStatus} · ${l.housing} · 갱년기 ${l.menopauseStatus} · 간병 ${l.parentCare}`,
    `성격    ${c.personality.join(' · ')}`,
    `voiceCore  ${input.voiceTokens.join(' · ')}`,
    `variation  ${vars}`,
    `noGo ${[...c.noGoTopics, ...c.noGoExpressions].join(' · ')}`,
    `금지 ${input.forbiddenReactionRoles.join(' · ')}`,
    '```',
    '',
  ].join('\n')
}

/**
 * 🔴 **seed — `persona-cohort-run --step=seed` 가 받는 모양과 같다.**
 *    값은 **파서가 다시 읽은 카드**에서 가져온다(렌더 전 입력이 아니다) — 문서와 seed 가 한 벌이 되게.
 */
export function seedFromCard(input: {
  card: PoolCard
  life: LifeSkeleton
  voiceCore: SeedVoiceCore
  variations: readonly string[]
  cadence: Cadence
}): Record<string, unknown> {
  const { card, cadence } = input
  return {
    ageBand: card.ageBand,
    region: card.region,
    lifeStage: lifeStageOf(input.life),
    identity: {
      maritalStatus: card.maritalStatus,
      spouseRelationship: card.spouseRelationship ?? '해당없음',
      childrenCount: card.childrenCount,
      childrenAgeBands: card.childrenAgeBands,
      parentCare: card.parentCare,
      menopauseStatus: card.menopauseStatus,
      workStatus: card.workStatus,
      economicStatus: card.economicStatus,
      housing: card.housing,
      personality: card.personality,
    },
    // 🔴 길이는 카드의 토큰 그대로 — `verifySeedCard` 가 정본과 같은지 본다
    voiceCore: { ...input.voiceCore, length: card.voiceLength ?? input.voiceCore.length },
    voiceVariations: [...input.variations],
    activityRhythm: cadence.activityRhythm,
    noGoTopics: card.noGoTopics,
    noGoExpressions: card.noGoExpressions,
    forbiddenReactionRoles: card.forbiddenReactionRoles,
    dailyCap: cadence.dailyCap,
    weeklyCap: cadence.weeklyCap,
    silenceRate: cadence.silenceRate,
  }
}

/**
 * 🔴 **이름만 있는 후보** — 생활사·말투·creative 가 **전부** 없다.
 *    격리해서 나중에 채울 대상이 아니라 애초에 후보가 아니다. 거부한다.
 */
export function isNameOnly(c: AutogenCandidate): boolean {
  const creativeEmpty = c.creative === null
    || (c.creative.personality.length === 0 && c.creative.noGoTopics.length === 0
      && c.creative.noGoExpressions.length === 0)
  return c.life === null && c.voice === null && creativeEmpty
}

// ─────────────────────────────────────────────────────────
// 이름만 다른 사람 — 🔴 성격 · 관점 · noGo · 생활사 겹침 (2026-09-30)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **비교 대상 한 사람** — 정본 카드도, 이번 배치의 후보도 같은 모양으로 본다.
 *    `title` 은 카드 제목 = 이 사람이 세상을 보는 **관점** 한 줄이다(예: "시어머니 모시는 맏며느리").
 */
export type DistinctSubject = {
  code: string
  title: string
  personality: readonly string[]
  noGoTopics: readonly string[]
  noGoExpressions: readonly string[]
  life: {
    ageBand: string; maritalStatus: string; childrenAgeBands: readonly string[]
    workStatus: string; economicStatus: string; housing: string; parentCare: string
  }
}

/**
 * 🔴 **겹침 상한** — 성격어(또는 noGo) 집합이 **절반을 넘게** 같으면 같은 성격이다.
 *    역할 쏠림 상한(`ROLE_SHARE_CAP` 0.5)과 같은 뜻: 절반을 넘으면 "그 사람만의 것" 이 아니다.
 */
export const DISTINCT_OVERLAP_MAX = 0.5
/** 🔴 생활사 7칸 중 이 수 이하만 다르면 생활사가 "거의 같다" — 한 칸 차이 */
export const LIFE_NEAR_DIFF_MAX = 1

const norm = (s: string): string => s.replace(/["'“”‘’\s·,.()~]/g, '').replace(/류$/, '')
const jaccard = (a: readonly string[], b: readonly string[]): number => {
  const A = new Set(a.map(norm).filter((x) => x !== ''))
  const B = new Set(b.map(norm).filter((x) => x !== ''))
  if (A.size === 0 && B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return inter / (A.size + B.size - inter)
}
const lifeDiff = (a: DistinctSubject['life'], b: DistinctSubject['life']): number => [
  a.ageBand !== b.ageBand, a.maritalStatus !== b.maritalStatus,
  a.childrenAgeBands.join('/') !== b.childrenAgeBands.join('/'), a.workStatus !== b.workStatus,
  a.economicStatus !== b.economicStatus, a.housing !== b.housing, a.parentCare !== b.parentCare,
].filter(Boolean).length

export const distinctSubjectOfCard = (c: PoolCard): DistinctSubject => ({
  code: c.code, title: c.title, personality: c.personality,
  noGoTopics: c.noGoTopics, noGoExpressions: c.noGoExpressions,
  life: {
    ageBand: c.ageBand, maritalStatus: c.maritalStatus, childrenAgeBands: c.childrenAgeBands,
    workStatus: c.workStatus, economicStatus: c.economicStatus, housing: c.housing, parentCare: c.parentCare,
  },
})

/**
 * 🔴 **이 후보가 누군가와 이름만 다른 사람인가** — 겹친 상대마다 한 줄. 비어 있으면 다른 사람이다.
 *
 *    관점     제목이 (기호를 뺀 뒤) 같다                          → 같은 관점의 사람
 *    복제     성격 집합과 noGo 집합이 **둘 다** 상한을 넘게 겹친다  → 생활사가 달라도 같은 사람
 *    근접     생활사가 한 칸 이하로 다르고 성격 또는 noGo 가 상한을 넘게 겹친다
 *
 * 🔴 **생활사 한 칸 차이만으로는 막지 않는다.** 같은 또래 여성은 생활사가 많이 겹치는 것이
 *    자연스럽다 — 사람을 가르는 것은 성격·관점·금기·말투다. 그것까지 겹칠 때만 막는다.
 */
export function judgeDistinctness(c: DistinctSubject, peers: readonly DistinctSubject[]): string[] {
  const out: string[] = []
  for (const p of peers) {
    if (p.code === c.code) continue
    const pers = jaccard(c.personality, p.personality)
    const nogo = jaccard([...c.noGoTopics, ...c.noGoExpressions], [...p.noGoTopics, ...p.noGoExpressions])
    const diff = lifeDiff(c.life, p.life)
    if (norm(c.title) !== '' && norm(c.title) === norm(p.title)) out.push(`${p.code}: 관점(제목)이 같다`)
    else if (pers > DISTINCT_OVERLAP_MAX && nogo > DISTINCT_OVERLAP_MAX) {
      out.push(`${p.code}: 성격 ${pers.toFixed(2)} · noGo ${nogo.toFixed(2)} 겹침 — 생활사만 다른 같은 사람`)
    } else if (diff <= LIFE_NEAR_DIFF_MAX && (pers > DISTINCT_OVERLAP_MAX || nogo > DISTINCT_OVERLAP_MAX)) {
      out.push(`${p.code}: 생활사 ${diff}칸 차이 · 성격 ${pers.toFixed(2)} · noGo ${nogo.toFixed(2)}`)
    }
  }
  return out
}
