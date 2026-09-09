/**
 * Persona 댓글 **속도 제어** — 🔴 순수 함수. DB · 시계 · 네트워크 없음
 *
 * 🔴 **왜 따로 두는가.**
 *
 *    Persona 댓글은 "몇 개 만들 수 있는가" 가 아니라 **"커뮤니티가 몇 개를 견디는가"** 로 정한다.
 *    사람 댓글이 하루 1건인 곳에 봇 댓글이 하루 10건 붙으면, 그곳은 커뮤니티가 아니라 전시장이다.
 *    그래서 상한의 정본은 생성 능력이 아니라 **실사용자 댓글량**이다.
 *
 * 🔴 **글 발행량(d1/d3/d5/d10)과 묶지 않는다.**
 *    d10 이 되어 글이 하루 10개 나가도 댓글 상한은 그대로다.
 *    "새 글마다 댓글 하나" 는 편한 규칙이지만, 그 규칙이 곧 30% 를 넘긴다.
 *
 * 🔴 **모르면 0 이다.** 집계에 실패했거나 값이 손상됐으면 상한은 0 이다 —
 *    0 으로 보정해 열어 두면 감속 장치가 아니라 통과 장치가 된다.
 */

/** 🔴 전체 댓글 중 Persona 댓글이 차지해도 되는 최대 비율 */
export const PERSONA_RATIO_MAX = 0.30

/** 비율을 세는 창 */
export const RATIO_WINDOW_DAYS = 7

/**
 * 🔴 하루 기본 상한. ratio 와 **둘 중 작은 값**이 적용된다.
 *
 *    ratio 가 아무리 여유로워도 하루에 이보다 많이 달지 않는다 —
 *    비율이 맞아도 하루에 몰아 달면 그날의 타임라인은 봇으로 덮인다.
 */
export const DEFAULT_DAILY_CAP = 1

/**
 * rolling 창의 실측. 🔴 **셋 중 하나라도 못 셌으면 `measured: false`** 다.
 *
 * 🔴 `real` 은 **살아 있는** 실사용자 댓글이다. 삭제된 댓글은 커뮤니티에 없으므로
 *    분모에 넣지 않는다 — 넣으면 지워진 대화가 봇 예산을 만들어 준다.
 */
export type CommentWindow = {
  /** 집계에 성공했는가. 조회 실패·손상·미확정이면 false */
  measured: boolean
  /** 창 안의 살아 있는 실사용자(MEMBER + GUEST) 댓글 수 */
  real: number
  /** 창 안의 살아 있는 Persona 댓글 수 */
  persona: number
  /** 며칠 창인가 */
  windowDays: number
}

export type RatioVerdict = {
  /** 이 창에서 Persona 댓글을 몇 건 **더** 달 수 있는가 */
  headroom: number
  /** 지금 비율 — 셀 수 없으면 null */
  current: number | null
  reason: string
}

/** 🔴 DB count 가 될 수 있는 값인가 — NaN·Infinity·음수·소수·비-number 를 전부 막는다 */
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0

// ─────────────────────────────────────────────────────────
// 🔴 Comment 레인 분류 — 같은 행을 양쪽에 세지 않는다
// ─────────────────────────────────────────────────────────

/** 한 Comment 행에서 레인 판정에 필요한 것만 */
export type CommentLaneRow = {
  /** MEMBER · GUEST · PERSONA · MICRO_SEED_VERBATIM */
  commentOrigin: string
  /** 이 댓글을 쓴 Persona. 실회원 댓글은 null */
  personaId: string | null
}

export type Lane = 'real' | 'persona' | 'other' | 'contradiction'

/**
 * 🔴 **상호 배타적으로 가른다.**
 *
 *    옛 판은 `real` 을 `origin ∈ {MEMBER, GUEST}` 로, `persona` 를
 *    `origin === 'PERSONA' || personaId !== null` 로 셌다. 두 조건이 겹치는 행 —
 *    예컨대 `origin=MEMBER` 인데 `personaId` 가 붙은 행 — 은 **양쪽에 동시에 세어져**
 *    분모가 부풀고 상한이 열린다.
 *
 * 🔴 모순은 0 으로 보정하지 않는다. `PERSONA` 인데 `personaId` 가 없거나
 *    `MEMBER` 인데 `personaId` 가 있으면 데이터가 어긋난 것이고, 그 상태의 비율은 근거가 없다.
 */
export function classifyComment(row: CommentLaneRow): Lane {
  const isPersonaLane = row.commentOrigin === 'PERSONA'
  const hasPersona = row.personaId !== null && row.personaId !== undefined && row.personaId !== ''
  if (isPersonaLane && !hasPersona) return 'contradiction'
  if (!isPersonaLane && hasPersona) return 'contradiction'
  if (isPersonaLane) return 'persona'
  if (row.commentOrigin === 'MEMBER' || row.commentOrigin === 'GUEST') return 'real'
  // MICRO_SEED_VERBATIM 등 — 사람 댓글도 Persona 댓글도 아니다. 어느 쪽 분자도 되지 않는다
  return 'other'
}

/**
 * 🔴 행 목록에서 창을 만든다. **모순이 하나라도 있으면 `measured: false`** 다 —
 *    그 상태로 계산한 비율은 아무것도 보장하지 않는다.
 */
export function windowFromRows(rows: readonly CommentLaneRow[], windowDays: number): CommentWindow {
  let real = 0
  let persona = 0
  for (const r of rows) {
    const lane = classifyComment(r)
    if (lane === 'contradiction') {
      return { measured: false, real: 0, persona: 0, windowDays }
    }
    if (lane === 'real') real += 1
    else if (lane === 'persona') persona += 1
  }
  return { measured: true, real, persona, windowDays }
}

/**
 * 🔴 `persona / (persona + real) <= 0.30` 을 만족하는 최대 persona 수에서
 *    이미 쓴 만큼을 뺀다.
 *
 *    p/(p+r) <= 0.3  ⇔  p <= (0.3/0.7)·r
 *    **내림한다.** 0.42 건은 0 건이다 — 반올림하면 실사용자 1명에 봇 1개가 붙는다.
 */
export function judgeRatio(win: CommentWindow): RatioVerdict {
  if (win.measured !== true) {
    return { headroom: 0, current: null, reason: '댓글 집계에 실패했다 — 상한 0(fail-closed)' }
  }
  // 🔴 `Number.isFinite` 만으로는 부족하다. 3.7 건 같은 소수는 유한하지만 count 가 아니다 —
  //    조회가 어긋났다는 신호이고, 그 상태로 상한을 계산하면 근거 없는 숫자가 나온다.
  if (!isCount(win.real) || !isCount(win.persona)) {
    return { headroom: 0, current: null, reason: '댓글 수가 count 가 아니다(NaN·Infinity·음수·소수) — 상한 0(fail-closed)' }
  }
  // 🔴 창 길이가 계약과 다르면 비율의 뜻이 달라진다. 3일치로 7일 상한을 주면 2배 이상 열린다
  if (win.windowDays !== RATIO_WINDOW_DAYS) {
    return {
      headroom: 0, current: null,
      reason: `창 길이가 ${String(win.windowDays)}일이다 — ${RATIO_WINDOW_DAYS}일 계약과 다르면 상한 0(fail-closed)`,
    }
  }
  const total = win.real + win.persona
  const current = total === 0 ? null : win.persona / total
  if (win.real === 0) {
    // 🔴 실사용자 댓글이 0 이면 어떤 Persona 댓글도 30% 를 넘긴다(0/0 은 비율이 아니다)
    return { headroom: 0, current, reason: '실사용자 댓글이 0 이다 — Persona 댓글 상한 0' }
  }
  const allowed = Math.floor((PERSONA_RATIO_MAX / (1 - PERSONA_RATIO_MAX)) * win.real)
  const headroom = Math.max(0, allowed - win.persona)
  return {
    headroom,
    current,
    reason: `실사용자 ${win.real}건 → ${win.windowDays}일 상한 ${allowed}건 · 이미 ${win.persona}건 → 여유 ${headroom}건`,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 실행 모드 — 셋을 절대 섞지 않는다
// ─────────────────────────────────────────────────────────

/**
 * · `inspect` — 네트워크 0 · DB write 0. 무엇이 될지 보기만 한다
 * · `shadow`  — 후보 생성과 Gate 검증까지. 🔴 **공개 Comment write 0**
 * · `release` — 공개 write 가 가능한 유일한 모드. 별도 활성화가 있어야 들어온다
 */
export type RunMode = 'inspect' | 'shadow' | 'release'

export const RELEASE_ENV_KEY = 'SORAN_PERSONA_COMMENT_STAGE'

/**
 * 🔴 **기본은 shadow 다.** env 가 없거나 모르는 값이면 공개 write 로 가지 않는다.
 *    "설정을 안 했더니 발행이 시작됐다" 가 일어나지 않게 한다.
 */
export function readRunMode(env: Readonly<Record<string, string | undefined>>): {
  mode: RunMode; reason: string
} {
  const raw = (env[RELEASE_ENV_KEY] ?? '').trim()
  if (raw === '') return { mode: 'shadow', reason: `${RELEASE_ENV_KEY} 가 없다 — shadow(공개 write 0)` }
  if (raw === 'inspect' || raw === 'shadow') return { mode: raw, reason: `${RELEASE_ENV_KEY}=${raw}` }
  if (raw === 'release') return { mode: 'release', reason: `${RELEASE_ENV_KEY}=release — 🔴 공개 write 가능` }
  return { mode: 'shadow', reason: `${RELEASE_ENV_KEY}=${raw} 는 모르는 값이다 — shadow 로 내린다(fail-closed)` }
}

export type ReadinessFacts = {
  /** rolling 창 실측 */
  window: CommentWindow
  /** 이 모드에서 돌고 있는가 */
  mode: RunMode
  /** 오늘 이미 발행한 Persona 댓글 수 — 못 셌으면 null */
  publishedToday: number | null | undefined
  /** Persona 개인 cap 등 상위 계약이 준 하루 상한 */
  dailyCap?: number
  /** 안전 Gate·kill switch 가 열려 있는가. 모르면 null */
  killSwitchOff?: boolean | null | undefined
  /** 이번 회차에 만들어 볼 shadow 후보 수 상한을 낮추고 싶을 때 */
  shadowLimit?: number
}

export type ReadinessVerdict = {
  /** 🔴 **공개** Comment write 가 오늘 몇 건까지 가능한가 */
  publicAllowedToday: number
  /**
   * 🔴 **내부 shadow 로 몇 건까지 만들어 볼 것인가.**
   *
   *    ratio 는 **공개 댓글 상한**이지 사고 정지 버튼이 아니다.
   *    ratio 가 0 이어도 계획·생성·Gate·모델 비교는 계속 돌아야 한다 —
   *    그러지 않으면 실사용자 댓글이 늘어난 날 아무 준비 없이 공개를 켜게 된다.
   */
  shadowLimit: number
  /** 공개 write 가 가능한 상태인가 */
  canPublish: boolean
  /** 공개를 막은 이유들 */
  blockers: string[]
  detail: string
}

/**
 * 🔴 shadow 안전 상한. 공개와 무관하지만 **무제한은 아니다** —
 *    한 회차에 수십 건을 만들면 검토 부담을 사람에게 떠넘기고, 유료 호출도 그만큼 는다.
 */
export const DEFAULT_SHADOW_LIMIT = 10

/**
 * 🔴 **최종 상한 = min(일 cap, ratio 여유).** 그리고 어느 하나라도 모르면 0 이다.
 *
 *    준비도가 미달이면 막는 것이 아니라 **0/day 로 감속**한다 —
 *    스위치를 끄는 것과 속도를 0 으로 내리는 것은 운영상 다르다.
 *    전자는 사람이 다시 켜야 하고, 후자는 조건이 회복되면 저절로 돌아온다.
 */
export function judgeReadiness(f: ReadinessFacts): ReadinessVerdict {
  const blockers: string[] = []
  const ratio = judgeRatio(f.window)
  if (ratio.headroom === 0) blockers.push(ratio.reason)

  const cap = f.dailyCap ?? DEFAULT_DAILY_CAP
  const capOk = isCount(cap)
  if (!capOk) blockers.push('일 cap 값이 count 가 아니다 — 0 으로 본다(fail-closed)')

  // 🔴 `undefined` 와 `null` 을 같이 막는다. 필드를 아예 안 넘긴 호출부가
  //    "모른다" 가 아니라 "0 건 발행" 으로 읽히면 cap 이 통째로 열린다
  if (!isCount(f.publishedToday)) {
    blockers.push('오늘 발행 수를 세지 못했다(누락·NaN·음수·소수) — 상한 0(fail-closed)')
  }
  if (f.killSwitchOff === false) blockers.push('kill switch 가 켜져 있다 — 발행하지 않는다')
  if (f.killSwitchOff !== true && f.killSwitchOff !== false) {
    blockers.push('kill switch 상태를 읽지 못했다 — 상한 0(fail-closed)')
  }

  const capLeft = !capOk || !isCount(f.publishedToday)
    ? 0
    : Math.max(0, cap - f.publishedToday)
  const publicAllowedToday = blockers.length > 0 ? 0 : Math.min(capLeft, ratio.headroom)

  // 🔴 release 가 아니면 공개 write 는 언제나 불가다. 상한이 남아 있어도 마찬가지다
  const canPublish = f.mode === 'release' && publicAllowedToday > 0
  if (f.mode !== 'release') blockers.push(`${f.mode} 모드다 — 공개 댓글을 발행하지 않는다`)

  /**
   * 🔴 shadow 상한은 **ratio 와 무관하다.** 다만 `inspect` 는 아무것도 만들지 않는다 —
   *    그 모드는 "무엇이 될지 보기만" 하는 자리이기 때문이다.
   */
  const wanted = f.shadowLimit ?? DEFAULT_SHADOW_LIMIT
  const shadowLimit = f.mode === 'inspect'
    ? 0
    : Math.max(0, Math.min(isCount(wanted) ? wanted : 0, DEFAULT_SHADOW_LIMIT))

  return {
    publicAllowedToday,
    shadowLimit,
    canPublish,
    blockers,
    detail: `ratio 여유 ${ratio.headroom} · 일 cap 남음 ${capLeft}`
      + ` → 공개 ${publicAllowedToday}건 · shadow ${shadowLimit}건`,
  }
}
