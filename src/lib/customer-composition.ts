/**
 * 고객 구성 — 순수 판정. 🔴 Prisma 도 auth 도 부르지 않는다.
 *
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §11.
 * 대상 조건과 DB 집계는 src/lib/queries/customer-composition.ts 가 한다 — 이 파일은 그 결과를
 * "몇 세 구간인가 · 7일 관측이 끝났는가 · 그 창 안의 활동인가" 로 나누기만 한다.
 *
 * 🔴 연령 구간을 DB 에 저장하지 않는다. 원본 birthyear 를 읽을 때마다 여기서 계산한다.
 * 🔴 "만 나이" 가 아니다. 출생연도만으로는 생일 전후를 알 수 없다 — 화면에서도 **분석연령** 이라 부른다.
 */
import { kstDateString } from '@/lib/release-canary'

/** 분석 구간. 순서가 곧 화면 순서다 */
export const AGE_BANDS = [
  { key: 'under45', label: '45세 미만', min: null, max: 44 },
  { key: '45-49', label: '45~49세', min: 45, max: 49 },
  { key: '50-54', label: '50~54세', min: 50, max: 54 },
  { key: '55-59', label: '55~59세', min: 55, max: 59 },
  { key: '60-64', label: '60~64세', min: 60, max: 64 },
  { key: '65-69', label: '65~69세', min: 65, max: 69 },
  { key: '70plus', label: '70세 이상', min: 70, max: null },
] as const

export type KnownAgeBandKey = (typeof AGE_BANDS)[number]['key']
export type AgeBandKey = KnownAgeBandKey | 'unknown'

export const UNKNOWN_AGE_LABEL = '연령 미확인'

/** 50대 요약 — 50~54 + 55~59. 상세 구간과 함께 보여 준다 */
export const FIFTIES_BANDS: readonly KnownAgeBandKey[] = ['50-54', '55-59']

/** 화면 표 순서 — 알려진 구간 다음에 미확인 */
export const AGE_BAND_ORDER: readonly AgeBandKey[] = [...AGE_BANDS.map((b) => b.key), 'unknown']

export function ageBandLabel(key: AgeBandKey): string {
  if (key === 'unknown') return UNKNOWN_AGE_LABEL
  return AGE_BANDS.find((b) => b.key === key)?.label ?? UNKNOWN_AGE_LABEL
}

/**
 * KST 기준연도.
 *
 * 🔴 UTC 연도를 쓰지 않는다. 1월 1일 00:00~08:59 KST 에는 UTC 가 아직 전년도라
 *    모든 회원이 한 살 어리게 계산된다. KST 날짜 헬퍼를 새로 만들지 않고 기존 것을 쓴다.
 */
export function kstBaseYear(now: Date): number {
  return Number(kstDateString(now).slice(0, 4))
}

/**
 * 출생연도 원문 → 연도 숫자. 쓸 수 없으면 null(= 연령 미확인).
 *
 * 🔴 저장 경로가 형식을 검사하지 않는다(kakao-profile.ts — 빈 문자열만 거른다).
 *    그래서 읽는 이 자리가 유일한 검사다. 데이터 문제를 숨기지 않도록 고쳐 쓰지 않고 미확인으로 돌린다.
 *      null · 빈 문자열 · 숫자 아님 · 네 자리 아님(19750) · 0000 · 앞자리 0(0999) · 기준연도보다 미래
 * 🔴 Number() 로 바로 바꾸지 않는다. Number('') = 0 · Number(' 1975 ') = 1975 · Number('1e3') = 1000 이다.
 */
export function parseBirthyear(raw: string | null | undefined, baseYear: number): number | null {
  if (typeof raw !== 'string') return null
  if (!/^[1-9]\d{3}$/.test(raw)) return null
  const year = Number(raw)
  if (year > baseYear) return null
  return year
}

/** 분석연령 = 기준연도 − 출생연도. 출생연도를 쓸 수 없으면 null */
export function analysisAge(raw: string | null | undefined, baseYear: number): number | null {
  const year = parseBirthyear(raw, baseYear)
  return year === null ? null : baseYear - year
}

export function ageBandOfAge(age: number | null): AgeBandKey {
  if (age === null || !Number.isInteger(age) || age < 0) return 'unknown'
  for (const band of AGE_BANDS) {
    const aboveMin = band.min === null || age >= band.min
    const belowMax = band.max === null || age <= band.max
    if (aboveMin && belowMax) return band.key
  }
  return 'unknown'
}

export function ageBandOf(raw: string | null | undefined, baseYear: number): AgeBandKey {
  return ageBandOfAge(analysisAge(raw, baseYear))
}

/**
 * 저장된 성별 → 집계 분류.
 *
 * 🔴 female 과 male 만 확인된 값이다(kakao-profile.ts KakaoGender). 그 밖의 값과 null 은
 *    여성으로 추정하지 않고 **미확인** 으로 둔다.
 */
export type GenderClass = 'female' | 'male' | 'unknown'

export function genderClass(raw: string | null | undefined): GenderClass {
  if (raw === 'female') return 'female'
  if (raw === 'male') return 'male'
  return 'unknown'
}

export type AgeCounts = Record<AgeBandKey, number>

export function emptyAgeCounts(): AgeCounts {
  return Object.fromEntries(AGE_BAND_ORDER.map((k) => [k, 0])) as AgeCounts
}

/**
 * 출생연도별 인원 → 연령 구간별 인원.
 *
 * 🔴 입력은 groupBy 결과(출생연도 원문 · 인원)다. 회원 한 명씩이 아니다.
 */
export function bucketByAge(
  rows: readonly { birthyear: string | null; count: number }[],
  baseYear: number,
): AgeCounts {
  const out = emptyAgeCounts()
  for (const row of rows) out[ageBandOf(row.birthyear, baseYear)] += row.count
  return out
}

export function sumBands(counts: AgeCounts, keys: readonly AgeBandKey[]): number {
  return keys.reduce((acc, k) => acc + counts[k], 0)
}

export function totalOf(counts: AgeCounts): number {
  return sumBands(counts, AGE_BAND_ORDER)
}

// ─────────── 가입 후 7일 내 참여 ───────────

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 7일 관측 상태.
 *
 *   no_basis   가입 완료 근거(최초 약관 동의 시각)가 없다 — 임의 날짜로 보정하지 않는다
 *   observing  완료 뒤 7일이 아직 지나지 않았다 — 미참여로 세지 않는다
 *   complete   7일 창이 닫혔다 — 7일 내 참여율의 분모
 *
 * 🔴 정확히 완료+7일인 순간부터 complete 다. 창은 [완료, 완료+7일) 이라 그 순간 이후의 활동은
 *    어차피 창 밖이다 — 창이 닫힌 뒤에만 분모에 넣는다.
 */
export type SevenDayStatus = 'no_basis' | 'observing' | 'complete'

export function sevenDayStatus(completedAt: Date | null, now: Date): SevenDayStatus {
  if (!completedAt) return 'no_basis'
  return now.getTime() >= completedAt.getTime() + SEVEN_DAYS_MS ? 'complete' : 'observing'
}

/** 활동이 [완료, 완료+7일) 안에 있는가. 정확히 7일 뒤는 밖이다 */
export function isWithinSevenDays(completedAt: Date, activityAt: Date): boolean {
  const start = completedAt.getTime()
  const at = activityAt.getTime()
  return at >= start && at < start + SEVEN_DAYS_MS
}

/** 7일 창 — DB 조회 조건으로 그대로 쓴다 */
export function sevenDayWindow(completedAt: Date): { gte: Date; lt: Date } {
  return { gte: completedAt, lt: new Date(completedAt.getTime() + SEVEN_DAYS_MS) }
}

// ─────────── 표시 ───────────

/**
 * 비율 표기 — 🔴 퍼센트만 내보내지 않는다. 항상 분자/분모를 함께 쓴다.
 * 분모가 0 이면 퍼센트를 만들지 않는다(0% 와 "셀 대상이 없다" 는 다르다).
 */
export function formatShare(numerator: number, denominator: number): string {
  if (denominator <= 0) return `${numerator} / 0`
  const pct = Math.round((numerator / denominator) * 1000) / 10
  return `${numerator} / ${denominator} (${pct}%)`
}

// ─────────── 운영·시험 계정 목록 ───────────

/**
 * 쉼표 목록 환경변수 → 소문자 항목.
 *
 * 🔴 admin.ts(getAdminEmails) · signup-policy.ts(isAllowlisted) 와 같은 규칙으로 읽는다 —
 *    trim · 소문자 · 빈 항목 버림. 두 파일의 판정 함수는 "한 사람이 통과하나" 만 답하고 목록을
 *    내놓지 않아, 고객 구성은 목록을 DB 조건으로 바꾸기 위해 같은 규칙을 여기서 한 번 더 읽는다.
 */
export function parseEnvList(raw: string | undefined): string[] {
  if (!raw) return []
  return [
    ...new Set(
      raw
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
}

/**
 * 고객 지표에서 뺄 운영·시험 계정 식별자.
 *
 *   emails             SORAN_ADMIN_EMAILS 전부 + SIGNUP_ALLOWLIST 전부 (이메일로 비교)
 *   providerAccountIds SIGNUP_ALLOWLIST 전부 (카카오 회원번호로 비교)
 *
 * 🔴 SIGNUP_ALLOWLIST 는 한 목록에 회원번호와 이메일이 섞여 있다(signup-policy.ts).
 *    어느 항목이 어느 종류인지 가르지 않고 **두 비교에 모두** 쓴다 — 회원번호는 이메일과,
 *    이메일은 회원번호와 우연히 같을 수 없으므로 잘못 빠지는 사람이 없다.
 */
export function operatorExclusions(env: Record<string, string | undefined>): {
  emails: string[]
  providerAccountIds: string[]
} {
  const admins = parseEnvList(env.SORAN_ADMIN_EMAILS)
  const allowlist = parseEnvList(env.SIGNUP_ALLOWLIST)
  return {
    emails: [...new Set([...admins, ...allowlist])],
    providerAccountIds: allowlist,
  }
}
