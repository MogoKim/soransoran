/**
 * Persona cohort — 🔴 **버전이 붙은 대상 목록이 정본이다** (2026-09-08)
 *
 * 🔴 왜 cohort 인가.
 *    Wave 2 는 세 명을 스크립트에 못박아 처리했다. 그 방식은 안전했지만,
 *    남은 11명을 켜려면 스크립트를 또 만들어야 한다 — 회차마다 파일이 늘어난다.
 *    대신 **manifest 를 버전으로 관리**하고 도구는 하나만 둔다.
 *
 * 🔴 그래도 `--code` 인자는 받지 않는다. 대상은 manifest 에 있고,
 *    manifest 를 고치는 것은 커밋으로 남는다 — CLI 한 줄로 아무나 켜지 않는다.
 *
 * 🔴 순수 함수·상수만. DB 도 파일도 읽지 않는다.
 */

export type CohortId = 'wave1-mvp' | 'wave2' | 'wave3-scale' | 'wave4-depth'

export type CohortManifest = {
  id: CohortId
  /** 사람이 읽을 한 줄 */
  purpose: string
  /** 🔴 이 회차의 대상. 순서는 코드순으로 고정한다 */
  codes: readonly string[]
  /** 이미 켜져 있어야 하는 선행 cohort */
  requires: readonly CohortId[]
}

/**
 * 🔴 **cohort 정본.** 새 회차는 여기에 추가한다 — 스크립트를 새로 만들지 않는다.
 *
 *    `wave3-scale` 은 Pool 20장 중 아직 없는 유효 카드 전부다.
 *    `P09` 는 빠져 있다 — Pool §7-1 의 어느 길이 목록에도 없고 카드에도 표현이 없어
 *    `readLengthBand` 가 읽지 못한다. 근거 없는 값을 사람이 채우면 그 카드는 추정값 위에 선다.
 */
export const COHORTS: Readonly<Record<CohortId, CohortManifest>> = {
  'wave1-mvp': {
    id: 'wave1-mvp',
    purpose: 'MVP 5명 — 최초 운영',
    codes: ['P05', 'P07', 'P10', 'P15', 'P17'],
    requires: [],
  },
  'wave2': {
    id: 'wave2',
    purpose: '1/day 안정화 — planner 364조합 전수 근거',
    codes: ['P01', 'P02', 'P11'],
    requires: ['wave1-mvp'],
  },
  'wave3-scale': {
    id: 'wave3-scale',
    purpose: '10/day 확장 — Pool 20장 중 남은 유효 카드 전부 (P09 제외)',
    codes: ['P03', 'P04', 'P06', 'P08', 'P12', 'P13', 'P14', 'P16', 'P18', 'P19', 'P20'],
    requires: ['wave1-mvp', 'wave2'],
  },
  /**
   * 🔴 **얇은 축 보강 회차** (2026-09-08).
   *    19명으로는 d10 이 139/140 이었다 — 여유가 없다. 그런데 인원을 아무나 늘리면
   *    이미 두터운 축만 더 두터워진다. 그래서 `persona-axis-coverage` 가 **측정한**
   *    얇은 축(별거 1 · 이혼 2 · 사별 2 · 비혼 2 · 자녀 초등 2 · 자녀 대학·취준 2 · 일:직장 2)을
   *    메우도록 P21~P25 를 설계했다 (Pool §5-0).
   */
  'wave4-depth': {
    id: 'wave4-depth',
    purpose: '얇은 축 보강 — 총 24명. 별거·이혼·사별·비혼·초등·대학취준·직장 축을 두텁게',
    codes: ['P21', 'P22', 'P23', 'P24', 'P25'],
    requires: ['wave1-mvp', 'wave2', 'wave3-scale'],
  },
}

/** 🔴 P09 를 뺀 이유 — 코드에 적어 둔다. 다음 사람이 "왜 없지" 하고 채우지 않게 */
export const EXCLUDED_CODES: Readonly<Record<string, string>> = {
  P09: 'Pool §7-1 길이 목록 어디에도 없고 카드 voiceCore 에도 길이 표현이 없다 — readLengthBand 가 읽지 못한다. 근거 없이 채우지 않는다',
}

/**
 * 🔴 **production Persona 정본 universe** (2026-09-10).
 *
 *    cohort 넷의 codes 를 합친 것이다. **여기서 파생시킨다** —
 *    24명 목록을 어딘가에 다시 적으면 한쪽만 고쳐지는 날이 온다.
 *    `P09` 는 `EXCLUDED_CODES` 에 이유와 함께 빠져 있다.
 *
 * 🔴 순서를 **코드순으로 고정**한다. reference 배정이 이 순서에 의존하므로
 *    순서가 흔들리면 같은 Persona 가 다른 묶음을 받는다.
 */
export const PRODUCTION_PERSONA_CODES: readonly string[] = Object.freeze(
  [...new Set(Object.values(COHORTS).flatMap((c) => c.codes))].sort(),
)

/** 🔴 이 코드가 정본 universe 에 있는가. 밖이면 임의로 채우지 않는다 */
export function isProductionPersonaCode(code: string): boolean {
  return PRODUCTION_PERSONA_CODES.includes(code)
}

export function cohortOf(id: string): CohortManifest | null {
  return (COHORTS as Record<string, CohortManifest>)[id] ?? null
}

/** 🔴 manifest 자체가 성립하는가 */
export function verifyManifest(m: CohortManifest): string[] {
  const out: string[] = []
  if (m.codes.length === 0) out.push('codes 가 비었다')
  // 🔴 **P01~P50 까지 받는다** (2026-09-08). Pool 은 50명까지 늘릴 계획이고,
  //    다음 회차에서 총 24명까지 가야 한다 — 그때 이 정규식을 고치게 하지 않는다.
  //    범위를 넓혀도 안전한 이유: 실행 도구가 **정본 Pool 문서에 카드가 없는 코드를 거부**한다.
  const bad = m.codes.filter((c) => !/^P(0[1-9]|[1-4][0-9]|50)$/.test(c))
  if (bad.length > 0) out.push(`정본 형식(P01~P50)이 아닌 코드: ${bad.join(', ')}`)
  const dupes = [...new Set(m.codes.filter((c, i) => m.codes.indexOf(c) !== i))]
  if (dupes.length > 0) out.push(`중복 코드: ${dupes.join(', ')}`)
  const sorted = [...m.codes].sort()
  if (sorted.join(',') !== m.codes.join(',')) out.push('codes 가 코드순이 아니다 — 순서를 고정해야 dry-run 이 재현된다')
  const excluded = m.codes.filter((c) => EXCLUDED_CODES[c] !== undefined)
  if (excluded.length > 0) out.push(`제외 대상이 들어 있다: ${excluded.map((c) => `${c}(${EXCLUDED_CODES[c]})`).join(' / ')}`)
  return out
}

/** 🔴 cohort 사이에 같은 사람이 두 번 들어가면 어느 회차 것인지 말할 수 없다 */
export function verifyAllCohorts(): string[] {
  const out: string[] = []
  const seen = new Map<string, CohortId>()
  for (const m of Object.values(COHORTS)) {
    out.push(...verifyManifest(m).map((x) => `${m.id}: ${x}`))
    for (const c of m.codes) {
      const prev = seen.get(c)
      if (prev !== undefined) out.push(`${c} 가 ${prev} 와 ${m.id} 에 모두 있다`)
      else seen.set(c, m.id)
    }
  }
  return out
}

export type CohortStage = 'absent' | 'draft-no-seed' | 'draft-seeded' | 'active'

export type CohortMemberState = {
  code: string
  exists: boolean
  status: string | null
  hasNickname: boolean
  seeded: boolean
  accountCount: number | null
  providerId: string | null
}

export function stageOf(s: CohortMemberState): CohortStage {
  if (!s.exists) return 'absent'
  if (s.status === 'active') return 'active'
  return s.seeded && s.hasNickname ? 'draft-seeded' : 'draft-no-seed'
}

/**
 * 🔴 **선행 cohort 가 전부 active 여야 한다.**
 *    앞 회차가 반쯤 켜진 채로 다음 회차를 켜면, 어느 회차가 실패했는지 뒤엉킨다.
 */
export function judgePrerequisites(
  m: CohortManifest,
  activeCodesByCohort: ReadonlyMap<CohortId, readonly string[]>,
): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  for (const req of m.requires) {
    const want = COHORTS[req].codes
    const have = activeCodesByCohort.get(req) ?? []
    const missing = want.filter((c) => !have.includes(c))
    if (missing.length > 0) problems.push(`선행 cohort ${req} 미완: ${missing.join(', ')} 가 active 가 아니다`)
  }
  return { ok: problems.length === 0, problems }
}

/** 🔴 단계별 게이트 — Wave 2 와 같은 계약이다 */
export function judgeCreate(states: readonly CohortMemberState[], m: CohortManifest): { ok: boolean; problems: string[] } {
  const problems = states.filter((s) => s.exists).map((s) => `${s.code}: 이미 있다 (status=${s.status ?? '—'})`)
  const missing = m.codes.filter((c) => !states.some((s) => s.code === c))
  if (missing.length > 0) problems.push(`대상이 빠졌다: ${missing.join(', ')}`)
  return { ok: problems.length === 0, problems }
}

export function judgeSeed(states: readonly CohortMemberState[], m: CohortManifest): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  for (const s of states) {
    if (!s.exists) { problems.push(`${s.code}: 아직 만들지 않았다 — 생성이 먼저다`); continue }
    if (s.status !== 'draft') problems.push(`${s.code}: status=${s.status ?? '—'} — seed 는 draft 에만 적용한다`)
  }
  const missing = m.codes.filter((c) => !states.some((s) => s.code === c))
  if (missing.length > 0) problems.push(`대상이 빠졌다: ${missing.join(', ')}`)
  return { ok: problems.length === 0, problems }
}

export function judgeActivate(states: readonly CohortMemberState[], m: CohortManifest): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  for (const s of states) {
    const st = stageOf(s)
    if (st === 'absent') { problems.push(`${s.code}: 없다 — 생성이 먼저다`); continue }
    if (st === 'active') { problems.push(`${s.code}: 이미 active 다`); continue }
    if (s.status !== 'draft') { problems.push(`${s.code}: status=${s.status ?? '—'} — draft 에서만 켠다`); continue }
    if (!s.hasNickname) problems.push(`${s.code}: 닉네임이 없다`)
    if (!s.seeded) problems.push(`${s.code}: seed 가 비었다`)
  }
  const missing = m.codes.filter((c) => !states.some((s) => s.code === c))
  if (missing.length > 0) problems.push(`대상이 빠졌다: ${missing.join(', ')}`)
  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 **멈추기는 비상 조치다** (2026-09-08, Codex P1-1).
 *
 *    pause 는 "위험한 사람을 지금 유통에서 빼는" 동작이다. 그러므로
 *    **Account 가 붙었다거나 seed 가 불완전하다는 이유로 막히면 안 된다** —
 *    막히는 순간, 정확히 그 위험한 사람을 멈출 수 없게 된다.
 *
 *    pause 가 요구하는 것은 넷뿐이다: 대상이 있고 · status=active 이고 ·
 *    actor 와 reason 이 있고 · 조건부 write 로 감사 기록이 남는 것.
 *    create · seed · activate 의 실회원 차단은 **그대로 유지**한다.
 */
export function judgePause(states: readonly CohortMemberState[]): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  for (const s of states) {
    if (!s.exists) problems.push(`${s.code}: 없다`)
    else if (s.status !== 'active') problems.push(`${s.code}: status=${s.status ?? '—'} — active 만 멈춘다`)
  }
  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 실행 게이트 — 의도(`--apply`)와 범위(`--limit`)를 **둘 다** 요구한다.
 *    `--limit` 은 cohort 인원과 정확히 같아야 한다 — 일부만 켜지 않는다.
 */
export function judgeArgs(input: {
  apply: boolean
  limit: number | null
  actorUserId: string | null
  reason: string | null
  cohortSize: number
  /** 활성화·pause 는 actor 와 reason 을 요구한다. 생성·seed 는 아니다 */
  requireActor: boolean
}): { ok: boolean; reason: string } {
  if (!input.apply) return { ok: false, reason: 'dry-run — --apply 가 없다' }
  if (input.limit !== input.cohortSize) {
    return { ok: false, reason: `--limit 은 ${input.cohortSize} 이어야 한다 (받은 값 ${input.limit ?? '없음'}) — 일부만 처리하지 않는다` }
  }
  if (input.requireActor) {
    if ((input.actorUserId ?? '').trim() === '') return { ok: false, reason: 'ACTOR_USER_ID 가 없다' }
    if ((input.reason ?? '').trim() === '') return { ok: false, reason: '--reason 이 없다' }
  }
  return { ok: true, reason: '' }
}

// ─────────────────────────────────────────────────────────
// 🔴 실행 도구 계약 (2026-09-08) — 도구는 하나, 대상은 manifest 가 정한다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **CLI 가 열 수 있는 cohort 는 이 목록뿐이다.**
 *
 *    `--cohort` 를 자유 문자열로 받으면 manifest 에 있는 **끝난 회차까지** 다시 만질 수 있다.
 *    이미 켜진 wave1·wave2 를 대상으로 `--apply` 를 돌리는 실수를 막으려면
 *    "지금 열려 있는 회차" 를 코드로 좁혀야 한다. 다음 회차는 여기에 추가한다 — 커밋으로 남는다.
 */
export const RUNNABLE_COHORTS: readonly CohortId[] = ['wave3-scale', 'wave4-depth']

/** 🔴 이미 끝난 회차 — 도구가 다시 만지지 않는다 */
export const CLOSED_COHORTS: readonly CohortId[] = ['wave1-mvp', 'wave2']

/**
 * 🔴 **최종 목표 인원** — wave1 5 + wave2 3 + wave3 11 + wave4 5 = 24.
 *    Pool 25장에서 P09(길이 미상)를 뺀 수와 같아야 한다. fixture 가 대조한다.
 */
export const TARGET_PERSONA_COUNT = 24

/** 🔴 회차 전용 입력 파일. gitignored 이며 다른 회차 파일을 덮어쓰지 않는다 */
export function displayNamePathOf(id: CohortId): string { return `tmp/persona-${id}-displayname.json` }
export function seedPathOf(id: CohortId): string { return `tmp/persona-${id}-seed.json` }

/**
 * 🔴 `--cohort` 인자 판정 — **allowlist 밖이면 fail-closed.**
 *    오타 · 끝난 회차 · 존재하지 않는 id 를 전부 여기서 막는다.
 */
export function judgeCohortArg(raw: string | null): { ok: boolean; id: CohortId | null; reason: string } {
  if (raw === null || raw.trim() === '') {
    return { ok: false, id: null, reason: `--cohort 가 없다 — 열려 있는 회차: ${RUNNABLE_COHORTS.join(', ')}` }
  }
  const v = raw.trim()
  if (cohortOf(v) === null) {
    return { ok: false, id: null, reason: `알 수 없는 cohort "${v}" — 열려 있는 회차: ${RUNNABLE_COHORTS.join(', ')}` }
  }
  const id = v as CohortId
  if (CLOSED_COHORTS.includes(id)) {
    return { ok: false, id: null, reason: `${id} 는 이미 끝난 회차다 — 이 도구로 다시 만지지 않는다` }
  }
  if (!RUNNABLE_COHORTS.includes(id)) {
    return { ok: false, id: null, reason: `${id} 는 아직 열려 있지 않다 — RUNNABLE_COHORTS 에 추가해야 한다(커밋으로 남는다)` }
  }
  return { ok: true, id, reason: '' }
}

/**
 * 🔴 입력 파일이 **정확히 이 회차 전원**인가.
 *    모자라면 일부만 만들게 되고, 넘치면 승인받지 않은 사람이 섞인다.
 */
export function checkCohortKeys(m: CohortManifest, keys: readonly string[]): string[] {
  const problems: string[] = []
  const missing = m.codes.filter((c) => !keys.includes(c))
  const extra = keys.filter((k) => !m.codes.includes(k))
  if (missing.length > 0) problems.push(`없는 코드: ${missing.join(', ')}`)
  if (extra.length > 0) problems.push(`대상 밖 코드: ${extra.join(', ')} — 이 회차는 ${m.codes.join('·')} 만 다룬다`)
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))]
  if (dupes.length > 0) problems.push(`중복 코드: ${dupes.join(', ')}`)
  return problems
}

/** 🔴 단계 — 도구가 받는 명령. `check` 는 언제나 read-only 다 */
export const COHORT_STEPS = ['create', 'seed', 'activate', 'pause', 'check'] as const
export type CohortStep = (typeof COHORT_STEPS)[number]

export function judgeStepArg(raw: string | null): { ok: boolean; step: CohortStep | null; reason: string } {
  if (raw === null || raw.trim() === '') {
    return { ok: false, step: null, reason: `--step 이 없다 — ${COHORT_STEPS.join(' | ')}` }
  }
  const v = raw.trim()
  if (!(COHORT_STEPS as readonly string[]).includes(v)) {
    return { ok: false, step: null, reason: `알 수 없는 단계 "${v}" — ${COHORT_STEPS.join(' | ')}` }
  }
  return { ok: true, step: v as CohortStep, reason: '' }
}

/** 🔴 `activate` · `pause` 만 actor 와 reason 을 요구한다 */
export function requiresActor(step: CohortStep): boolean {
  return step === 'activate' || step === 'pause'
}
