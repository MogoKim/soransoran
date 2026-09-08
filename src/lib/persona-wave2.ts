/**
 * Persona 확장 2차 — 🔴 **대상을 코드에 못박는다** (2026-09-08)
 *
 * 🔴 왜 인자로 받지 않는가.
 *    `persona-activate.mts` 가 이미 그 이유를 적어 두었다 —
 *    *"인자로 code 를 받으면 그때그때 다른 페르소나를 켜는 도구가 된다."*
 *    한 번 그런 도구가 되면, 승인받지 않은 사람이 승인받은 사람과 같은 명령으로 켜진다.
 *    대상이 바뀌면 **스크립트를 새로 만든다.**
 *
 * 🔴 순수 상수·순수 함수만 둔다. DB 도 파일도 읽지 않는다.
 */

/**
 * 🔴 이번 회차 대상 — 창업자가 확정한 3명이다.
 *
 *    근거: `persona-capacity-planner` 가 364조합을 전수 탐색해 7일 7건 · 14일 14건 · 공백 0을
 *    만드는 최소 인원이 3명임을 확인했고, 그중 이 조합이 확정됐다.
 */
export const WAVE2_CODES = ['P01', 'P02', 'P11'] as const
export type Wave2Code = (typeof WAVE2_CODES)[number]

/** 🔴 이미 운영 중인 사람 — 이 도구의 대상이 **아니다** */
export const MVP_CODES = ['P05', 'P07', 'P10', 'P15', 'P17'] as const

/** 🔴 켤 수 있는 출발 상태는 `draft` 뿐이다 */
export const ACTIVATABLE_FROM = 'draft'

/** 🔴 전용 입력 파일 — gitignored. MVP 5명 파일을 덮어쓰지 않는다 */
export const WAVE2_DISPLAYNAME_PATH = 'tmp/persona-wave2-displayname.json'
export const WAVE2_SEED_PATH = 'tmp/persona-wave2-seed.json'

export function isWave2Code(code: string): code is Wave2Code {
  return (WAVE2_CODES as readonly string[]).includes(code)
}

/**
 * 🔴 입력 파일이 **정확히 이 세 명**인가.
 *    모자라면 일부만 만들게 되고, 넘치면 승인받지 않은 사람이 섞인다.
 */
export function checkWave2Keys(keys: readonly string[]): string[] {
  const problems: string[] = []
  const missing = WAVE2_CODES.filter((c) => !keys.includes(c))
  const extra = keys.filter((k) => !isWave2Code(k))
  if (missing.length > 0) problems.push(`없는 코드: ${missing.join(', ')}`)
  if (extra.length > 0) problems.push(`대상 밖 코드: ${extra.join(', ')} — 이 도구는 ${WAVE2_CODES.join('·')} 만 다룬다`)
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))]
  if (dupes.length > 0) problems.push(`중복 코드: ${dupes.join(', ')}`)
  return problems
}

// ─────────────────────────────────────────────────────────
// 🔴 단계 순서 — 어기면 fail-closed
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **생성 → seed → 검증 → 활성화.** 순서를 어기면 막는다.
 *
 *    seed 없이 켜면 매칭이 그 사람을 **기본값으로 잘못 판정**한다 —
 *    `childrenCount` 가 비면 전원 무자녀로 처리된 #468 이 그것이다.
 *    닉네임 없이 켜면 글에 이름이 붙지 않는다.
 */
export type Wave2Stage = 'absent' | 'draft-no-seed' | 'draft-seeded' | 'active'

export type Wave2State = {
  code: string
  exists: boolean
  status: string | null
  hasNickname: boolean
  /** 매칭이 반드시 읽는 축이 전부 채워졌는가 */
  seeded: boolean
  /** 🔴 실회원 판별 — 운영 persona 는 0 이어야 한다 */
  accountCount: number | null
  providerId: string | null
}

export function stageOf(s: Wave2State): Wave2Stage {
  if (!s.exists) return 'absent'
  if (s.status === 'active') return 'active'
  return s.seeded && s.hasNickname ? 'draft-seeded' : 'draft-no-seed'
}

/** 🔴 지금 생성해도 되는가 — 이미 있으면 안 된다 */
export function judgeCreate(states: readonly Wave2State[]): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  for (const s of states) {
    if (s.exists) problems.push(`${s.code}: 이미 있다 (status=${s.status ?? '—'}) — 이 도구는 새로 만들기만 한다`)
  }
  const missing = WAVE2_CODES.filter((c) => !states.some((s) => s.code === c))
  if (missing.length > 0) problems.push(`대상이 빠졌다: ${missing.join(', ')}`)
  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 지금 seed 를 적용해도 되는가 — **`draft` 뿐이다.**
 *
 *    `paused` · `retired` 도 거부한다. 멈춘 사람과 은퇴한 사람의 정체성을 조용히 바꾸면,
 *    다시 켰을 때 예전과 다른 사람이 된다 — 그 사람 이름으로 이미 나간 글과 어긋난다.
 */
export function judgeSeed(states: readonly Wave2State[]): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  for (const s of states) {
    if (!s.exists) { problems.push(`${s.code}: 아직 만들지 않았다 — 생성이 먼저다`); continue }
    if (s.status !== ACTIVATABLE_FROM) {
      problems.push(`${s.code}: status=${s.status ?? '—'} — seed 는 ${ACTIVATABLE_FROM} 에만 적용한다`
        + (s.status === 'active' ? ' (켜진 사람의 seed 를 바꾸지 않는다)' : ''))
    }
  }
  const missing = WAVE2_CODES.filter((c) => !states.some((s) => s.code === c))
  if (missing.length > 0) problems.push(`대상이 빠졌다: ${missing.join(', ')}`)
  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 지금 켜도 되는가 — **네 가지가 전부** 맞아야 한다.
 *    하나라도 어긋나면 **전부 멈춘다.** 일부만 켜면 그 회차 배정이 절반만 반영된다.
 */
export function judgeActivate(states: readonly Wave2State[]): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  for (const s of states) {
    const st = stageOf(s)
    if (st === 'absent') { problems.push(`${s.code}: 없다 — 생성이 먼저다`); continue }
    if (st === 'active') { problems.push(`${s.code}: 이미 active 다`); continue }
    if (s.status !== ACTIVATABLE_FROM) { problems.push(`${s.code}: status=${s.status ?? '—'} — ${ACTIVATABLE_FROM} 에서만 켠다`); continue }
    if (!s.hasNickname) problems.push(`${s.code}: 닉네임이 없다`)
    if (!s.seeded) problems.push(`${s.code}: seed 가 비었다 — 켜면 매칭이 기본값으로 잘못 판정한다`)
    // 🔴 실회원 판별은 `judgeRealMember` 정본이 한다. 여기서는 그 결과만 받는다
  }
  const missing = WAVE2_CODES.filter((c) => !states.some((s) => s.code === c))
  if (missing.length > 0) problems.push(`대상이 빠졌다: ${missing.join(', ')}`)
  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 실행 게이트 — `--apply` 하나로는 열리지 않는다.
 *    두 스위치 원칙: 의도(`--apply`)와 범위(`--limit`)를 **둘 다** 요구한다.
 */
export function judgeActivateArgs(input: {
  apply: boolean
  limit: number | null
  actorUserId: string | null
  reason: string | null
}): { ok: boolean; reason: string } {
  if (!input.apply) return { ok: false, reason: 'dry-run — --apply 가 없다' }
  if (input.limit !== WAVE2_CODES.length) {
    return { ok: false, reason: `--limit 은 ${WAVE2_CODES.length} 이어야 한다 (받은 값 ${input.limit ?? '없음'}) — 일부만 켜지 않는다` }
  }
  if ((input.actorUserId ?? '').trim() === '') {
    return { ok: false, reason: 'ACTOR_USER_ID 가 없다 — 누가 켰는지 남지 않는 활성화는 하지 않는다' }
  }
  if ((input.reason ?? '').trim() === '') return { ok: false, reason: '--reason 이 없다' }
  return { ok: true, reason: '' }
}
