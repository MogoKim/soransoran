/**
 * 수집 **회차 기록** — 🔴 순수 판정. 파일을 읽지도 쓰지도 않는다
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-10).
 *
 *    관제가 append-only stderr 의 **글자**로 현재 상태를 판정했다(`logHintOf`).
 *    그 파일에는 옛 `SESSION_FILE_MISSING` 이 남아 있어서, 세션을 고친 뒤에도
 *    `세션` 이라는 낱말이 걸려 **`SOURCE_SESSION_EXPIRED`** 가 계속 나왔다.
 *    쿠키(NID_AUT·NID_SES)는 3주 뒤까지 유효한데도 "만료" 라고 말한 것이다.
 *
 *    게다가 **경로가 없다**(`SESSION_FILE_MISSING`)와 **인증이 만료됐다**(`AUTH_EXPIRED`)는
 *    조치가 전혀 다른데 한 코드로 뭉개졌다 — 앞엣것은 env 를 고치는 일이고
 *    뒤엣것은 사람이 다시 로그인하는 일이다.
 *
 *    로그를 지우거나 잘라서 통과시키는 것은 답이 아니다(그것도 거짓말이다).
 *    회차마다 **구조적 종료 기록**을 남기고, 그 기록의 **최신 것**으로 판정한다.
 *
 * 🔴 이 파일은 쿠키 값을 다루지 않는다. 이름과 만료 시각만 본다.
 */

/** 🔴 서로 다른 조치를 요구하는 것은 서로 다른 코드다 */
export type CollectFailureCode =
  /** env 가 가리키는 경로에 파일이 없다 — 설정 문제 */
  | 'SESSION_FILE_MISSING'
  /** 파일은 있는데 인증 쿠키가 없다 */
  | 'AUTH_MISSING'
  /** 인증 쿠키가 있는데 만료됐다 — 사람이 다시 로그인한다 */
  | 'AUTH_EXPIRED'
  /**
   * 🔴 **로그인은 됐는데 카페가 회원으로 인정하지 않는다** (2026-10-04~07 실측).
   *    본문 자리에 가입 안내가 나온다. 쿠키 검사는 통과한다 — 회원 계정으로 다시 발급한다.
   */
  | 'MEMBER_GATE'
  /** 🔴 카페 홈에서 회원·비회원 신호를 모두 못 찾았다 — 성공으로 진행하지 않는다 */
  | 'MEMBER_STATUS_UNKNOWN'
  /**
   * 🔴 **상세를 열었는데 본문 0건** (2026-10-07 15:30 실측 — 로그아웃 세션, 상세 16 · 본문 0 이 ok 였다).
   *    원인을 인증으로 단정하지 않는다 — 로그아웃 · 셀렉터 · 접근 제한 모두 이 모양이다.
   */
  | 'BODY_EMPTY'
  /** 목록·본문 셀렉터가 맞지 않는다 */
  | 'SELECTOR'
  /** 다른 실행이 락을 쥐고 있다 — 일시적이다. 다음 회차에 저절로 풀린다 */
  | 'LOCK_BUSY'
  /**
   * 🔴 **죽은 것으로 보이는 락이 남아 있다.**
   *    자동으로 회수하지 않는다(뺏으면 두 회차가 같이 들어간다) —
   *    사람이 확인하고 치울 때까지 이 source 는 멈춘다.
   */
  | 'LOCK_STALE'
  /** Playwright·브라우저 등 실행 의존성을 못 갖췄다 */
  | 'RUNTIME_DEPENDENCY'
  /** 네트워크·차단 */
  | 'NETWORK'
  | 'OTHER'

export type RunTrigger = 'schedule' | 'manual'
export type RunMode = 'scout' | 'detail'
export type RunStatus = 'started' | 'ok' | 'failed'

export type CollectRunRecord = {
  runId: string
  source: string
  trigger: RunTrigger
  mode: RunMode
  status: RunStatus
  /** ISO */
  startedAt: string
  endedAt: string | null
  code: CollectFailureCode | null
  /** 목록에서 읽은 행 수 */
  listRows: number
  /** 🔴 **상세를 실제로 몇 번 열었는가.** scout 는 0 이다 */
  detailRequests: number
  /**
   * 🔴 **본문을 실제로 읽어 낸 수.**
   *
   *    상세를 10번 열고도 셀렉터가 다 터지면 `bodyRows` 는 0 이다.
   *    요청 수만 보면 그것이 성공으로 읽힌다 — 열었다는 것과 읽었다는 것은 다르다.
   */
  bodyRows: number
  /** 상세를 읽어 만든 thin 산출 행 수 (반복분 포함) */
  thinRows: number
  /** 🔴 이미 본 글이라 상세를 열지 않고 건너뛴 수 */
  skippedSeen: number
  /** 🔴 상세까지 열었는데 이미 있던 글이었던 수 */
  repeatedRows: number
  /**
   * 🔴 **신규 고유 산출 행 수 — 공급량은 이것이다.**
   *
   *    같은 글을 네 회차가 반복해 담으면 `thinRows` 합은 4 지만
   *    새로 들어온 공급은 1 건이다. 재고를 이 값으로 센다.
   */
  newUniqueThinRows: number
}

/**
 * 🔴 **예약 회차인가 손으로 돌린 회차인가.**
 *
 *    launchd 가 띄운 프로세스는 `XPC_SERVICE_NAME` 이 job label 이다.
 *    사람이 터미널에서 돌리면 그 값이 없거나 다른 것이다.
 *    이 구별이 없으면 **수동 preflight 가 예약 슬롯 증거를 채운다** —
 *    "예약이 돌았다" 를 손으로 만든 증거가 대신하게 된다.
 */
export function judgeTrigger(env: Record<string, string | undefined>): RunTrigger {
  const label = env.XPC_SERVICE_NAME ?? ''
  return label.startsWith('com.soransoran.') ? 'schedule' : 'manual'
}

/**
 * 🔴 **상세를 연 회차만 예약 경로의 성공이다.**
 *
 *    `--scout` 는 목록만 읽고 상세 요청이 0 이다. 그것을 성공으로 세면
 *    "예약 수집이 돈다" 는 증거가 되지 못한다 — 예약 job 은 상세를 연다.
 */
export function isDetailSuccess(r: CollectRunRecord): boolean {
  // 🔴 열었다는 것과 읽었다는 것은 다르다 — 본문이 0이면 성공이 아니다
  // 🔴 옛 형식 기록(bodyRows 없음)은 **모른다** — 성공으로 세지 않는다(fail-closed)
  return r.status === 'ok' && r.mode === 'detail'
    && r.detailRequests > 0 && typeof r.bodyRows === 'number' && r.bodyRows > 0
}

/**
 * 🔴 **신규 후보가 없어 상세 요청이 0인 회차는 고장이 아니다.**
 *
 *    예약이 돌았고, 목록을 읽었고, 볼 만한 새 글이 없었다 —
 *    그것을 `BROKEN` 으로 세면 잘 도는 레인을 고치려 들게 된다.
 *    다만 **공급은 0** 이므로 yield 와는 분명히 나눈다.
 */
export function isNoNewRun(r: CollectRunRecord): boolean {
  return r.status === 'ok' && r.mode === 'detail'
    && r.detailRequests === 0 && r.listRows > 0
}

/** 🔴 예약이 돌았다는 증거 — 상세 성공이거나 NO_NEW 다 */
export function isScheduledAlive(r: CollectRunRecord): boolean {
  return isDetailSuccess(r) || isNoNewRun(r)
}

export type DetailHealth = 'OK' | 'NO_NEW' | 'BODY_EMPTY' | 'NOT_RUN' | 'UNKNOWN_LEGACY'

/**
 * 🔴 상세 경로가 사는가 — liveness·yield 와 **다른 질문**이다.
 *
 * 🔴 **옛 형식 기록을 실패로 읽지 않는다.** `bodyRows` 필드가 생기기 전 회차는
 *    본문을 읽었는지 **알 수 없다** — 그것을 `BODY_EMPTY`(셀렉터가 터졌다)로 말하면
 *    멀쩡한 회차를 고장으로 보고하는 셈이다. 모르는 것은 모른다고 한다.
 */
export function judgeDetailHealth(r: CollectRunRecord | null): DetailHealth {
  if (r === null || r.status !== 'ok' || r.mode !== 'detail') return 'NOT_RUN'
  if (typeof r.bodyRows !== 'number') return 'UNKNOWN_LEGACY'
  if (r.detailRequests === 0) return r.listRows > 0 ? 'NO_NEW' : 'NOT_RUN'
  return r.bodyRows > 0 ? 'OK' : 'BODY_EMPTY'
}

/**
 * 🔴 **기술적 성공과 공급 산출 성공을 나눈다.**
 *    상세를 열었는데 전부 걸러져 thin 이 0건일 수 있다 —
 *    그건 실패가 아니지만 재고를 늘리지도 않는다. 둘을 한 숫자로 세지 않는다.
 */
export function isYieldSuccess(r: CollectRunRecord): boolean {
  // 🔴 공급은 **신규 고유 행**이다. 반복해 담은 같은 글은 공급이 아니다
  return isDetailSuccess(r) && r.newUniqueThinRows > 0
}

/** 같은 runId 의 마지막 기록만 남긴다 — `started` 뒤에 terminal 이 온다 */
export function collapseByRunId(records: readonly CollectRunRecord[]): CollectRunRecord[] {
  const byId = new Map<string, CollectRunRecord>()
  for (const r of records) {
    const prev = byId.get(r.runId)
    // 🔴 terminal 이 started 를 이긴다. 같은 등급이면 나중 것이 이긴다
    if (prev === undefined) { byId.set(r.runId, r); continue }
    if (prev.status === 'started' && r.status !== 'started') { byId.set(r.runId, r); continue }
    if (prev.status !== 'started' && r.status === 'started') continue
    if (Date.parse(r.startedAt) >= Date.parse(prev.startedAt)) byId.set(r.runId, r)
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
}

/** 🔴 끝난 회차 중 **가장 최근 것** — 이것이 현재 상태를 말한다 */
export function latestTerminal(records: readonly CollectRunRecord[]): CollectRunRecord | null {
  const done = collapseByRunId(records).filter((r) => r.status !== 'started')
  return done.length === 0 ? null : done[done.length - 1]!
}

export type RunHealth = {
  level: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'INFO'
  code: string
  reason: string
  /** 판정 근거가 된 회차 */
  runId: string | null
}

/**
 * 🔴 **최신 종료 회차 하나가 현재 상태다.**
 *
 *    · 과거 실패 뒤 성공이 있으면 → 과거 오류로 내린다
 *    · 성공 뒤 실패가 있으면 → 최신 실패를 올린다
 *    · 실패 원인이 경로 없음이면 "세션 만료" 라고 말하지 않는다
 */
export function judgeRunHealth(
  records: readonly CollectRunRecord[],
  opts?: { nowMs?: number; runTimeoutMs?: number },
): RunHealth {
  const all = collapseByRunId(records)
  const latestAny = all.length === 0 ? null : all[all.length - 1]!
  /**
   * 🔴 **최신 `started` 가 있으면 옛 성공으로 되돌아가지 않는다** (2026-09-10).
   *
   *    terminal 저장에 실패했거나 아직 도는 중인데, 그 앞의 성공을 현재 상태로
   *    말하면 "지금 정상" 이 된다 — 실제로는 결말을 모르는 상태다.
   */
  if (latestAny !== null && latestAny.status === 'started') {
    const now = opts?.nowMs ?? Date.now()
    const timeout = opts?.runTimeoutMs ?? 15 * 60_000
    const age = now - Date.parse(latestAny.startedAt)
    return age <= timeout
      ? {
        level: 'INFO',
        code: 'RUN_IN_PROGRESS',
        reason: `회차가 아직 돌고 있다 (${Math.round(age / 60_000)}분째)`,
        runId: latestAny.runId,
      }
      : {
        // 🔴 마감이 지났는데 결말이 없다 — 모르는 것을 정상으로 보지 않는다
        level: 'CRITICAL',
        code: 'RUN_STALE_STARTED',
        reason: `회차가 시작만 되고 끝나지 않았다 (${Math.round(age / 60_000)}분 경과)`
          + ' — 종료 기록을 남기지 못했거나 죽었다',
        runId: latestAny.runId,
      }
  }
  const latest = latestTerminal(records)
  if (latest === null) {
    return { level: 'INFO', code: 'RUN_NO_RECORD', reason: '끝난 회차 기록이 아직 없다', runId: null }
  }
  if (latest.status === 'ok') {
    const past = collapseByRunId(records).filter((r) => r.status === 'failed').length
    /** 🔴 없는 값을 `undefined` 로 찍지 않는다 — 모르면 "미상" 이라고 쓴다 */
    const n = (v: unknown): string => (typeof v === 'number' ? String(v) : '미상')
    const legacy = typeof latest.bodyRows !== 'number'
    const shape = `상세 ${n(latest.detailRequests)}건 · 본문 ${n(latest.bodyRows)}행`
      + ` · 신규 ${n(latest.newUniqueThinRows)}행`
    const who = latest.trigger === 'manual' ? '수동 회차' : '예약 회차'
    /**
     * 🔴 **legacy 기록을 `RUN_OK` 로 내지 않는다** (2026-09-10 Codex 지적).
     *    `bodyRows` 가 없는 회차는 본문을 읽었는지 **알 수 없다**.
     *    모르는 것을 성공이라고 말하면 관제가 거짓말을 한다.
     */
    if (legacy) {
      return {
        level: 'INFO',
        code: 'RUN_UNKNOWN_LEGACY',
        reason: `최신 ${who}가 옛 형식이다 — 본문 판독 수를 알 수 없다 (${shape})`,
        runId: latest.runId,
      }
    }
    return {
      level: 'HEALTHY',
      code: 'RUN_OK',
      reason: past === 0
        ? `최신 ${who} 성공 (${shape})`
        // 🔴 과거 실패는 사실로 남기되 현재 상태로 올리지 않는다
        : `최신 ${who} 성공 — 과거 실패 ${past}회는 지난 일이다 (${shape})`,
      runId: latest.runId,
    }
  }
  const code = latest.code ?? 'OTHER'
  const map: Record<CollectFailureCode, { level: RunHealth['level']; reason: string }> = {
    SESSION_FILE_MISSING: {
      level: 'CRITICAL',
      // 🔴 만료가 아니다. env 가 가리키는 자리에 파일이 없다는 뜻이다
      reason: '세션 파일을 찾지 못했다 — 경로 설정 문제다(재로그인이 아니라 env 를 고친다)',
    },
    AUTH_MISSING: { level: 'CRITICAL', reason: '세션에 인증 쿠키가 없다 — 사람이 headed 로 재발급한다' },
    AUTH_EXPIRED: { level: 'CRITICAL', reason: '인증 쿠키가 만료됐다 — 사람이 headed 로 재발급한다' },
    MEMBER_GATE: {
      level: 'CRITICAL',
      // 🔴 쿠키는 유효하다. 만료가 아니라 "이 계정이 카페 회원이 아니다" 다
      reason: '본문 대신 카페 가입 안내가 나왔다 — 카페 회원 계정으로 세션을 재발급한다(쿠키는 유효해도 회원이 아니다)',
    },
    MEMBER_STATUS_UNKNOWN: {
      level: 'CRITICAL',
      reason: '카페 홈에서 회원 상태를 확인하지 못해 상세를 열지 않았다 — 로그아웃·화면 변경·차단을 사람이 확인한다',
    },
    BODY_EMPTY: {
      level: 'CRITICAL',
      reason: '상세를 열었지만 본문을 하나도 읽지 못했다 — 로그아웃(비밀번호 변경 등)·셀렉터 변경·접근 제한을 확인한다',
    },
    LOCK_BUSY: { level: 'WARNING', reason: '다른 실행이 락을 쥐고 있어 건너뛰었다 — 겹침 방지가 동작했다(일시적)' },
    LOCK_STALE: {
      level: 'CRITICAL',
      // 🔴 "다음 회차가 치운다" 고 말하지 않는다. 치우는 것은 사람이다
      reason: '죽은 것으로 보이는 락이 남아 있다 — 🔴 자동 회수하지 않는다 · 사람 확인 필요'
        + ' (실행 중 프로세스가 없음을 확인한 뒤에만 지운다)',
    },
    RUNTIME_DEPENDENCY: {
      level: 'CRITICAL',
      reason: '실행 의존성을 갖추지 못했다(브라우저·모듈) — 배포·설치 문제다',
    },
    SELECTOR: { level: 'CRITICAL', reason: '목록·본문 셀렉터가 맞지 않는다 — 사이트 구조가 바뀌었을 수 있다' },
    NETWORK: { level: 'WARNING', reason: '네트워크·차단으로 끝났다' },
    OTHER: { level: 'WARNING', reason: '최신 회차가 실패로 끝났다' },
  }
  const m = map[code as CollectFailureCode] ?? map.OTHER
  return { level: m.level, code: `RUN_${code}`, reason: m.reason, runId: latest.runId }
}

/**
 * 🔴 **예약 슬롯 증거는 예약 회차에서만 나온다.**
 *    수동 preflight 는 상세를 열어 성공해도 여기 들어오지 않는다.
 */
export function scheduledDetailRuns(
  records: readonly CollectRunRecord[],
): { runId: string; at: number }[] {
  // 🔴 예약이 **돌았다**는 증거다 — 신규가 없어 상세 0인 회차도 여기 들어온다
  return collapseByRunId(records)
    .filter((r) => r.trigger === 'schedule' && isScheduledAlive(r))
    .map((r) => ({ runId: r.runId, at: Date.parse(r.startedAt) }))
}

/**
 * 🔴 **수동 preflight 는 예약 증거가 아니다.**
 *    상세까지 성공해도 `MANUAL_PREFLIGHT_OK` 로만 표시하고 4/4 를 채우지 않는다.
 */
export function manualPreflightOk(records: readonly CollectRunRecord[]): {
  ok: boolean; runId: string | null; detail: string
} {
  const hits = collapseByRunId(records)
    .filter((r) => r.trigger === 'manual' && isDetailSuccess(r))
  if (hits.length === 0) return { ok: false, runId: null, detail: '수동 상세 성공 기록 없음' }
  const last = hits[hits.length - 1]!
  return {
    ok: true,
    runId: last.runId,
    detail: `MANUAL_PREFLIGHT_OK — 상세 ${last.detailRequests}건 · 본문 ${last.bodyRows}행`
      + ` · 신규 ${last.newUniqueThinRows}행 (🔴 예약 4/4 를 채우지 않는다)`,
  }
}

/**
 * 🔴 **관측 처리량은 실제 산출 행 수다.**
 *
 *    앞선 판은 `configured × 성공 회차 비율` 이었다 — 그것은 여전히 **설정값의 그림자**다.
 *    회차가 실제로 몇 행을 만들었는지는 그 회차의 기록에 있다.
 *
 * @param matchedRunIds 예약 슬롯에 붙은 회차 id (`judgeSlotEvidence` 가 고른 것)
 */
export function observedRows(
  records: readonly CollectRunRecord[],
  matchedRunIds: readonly string[],
): { rows: number; runs: number; repeated: number; skippedSeen: number } {
  const want = new Set(matchedRunIds)
  const hits = collapseByRunId(records).filter((r) => want.has(r.runId))
  return {
    // 🔴 **신규 고유 행**이다. thinRows 합이 아니다 —
    //    같은 글을 4회 반복해 담아도 새로 들어온 공급은 1건이다
    rows: hits.reduce((n, r) => n + r.newUniqueThinRows, 0),
    runs: hits.length,
    repeated: hits.reduce((n, r) => n + r.repeatedRows, 0),
    skippedSeen: hits.reduce((n, r) => n + r.skippedSeen, 0),
  }
}

/**
 * 🔴 **인증 쿠키 상태 — 이름과 시각만 본다.** 값은 어떤 반환에도 담지 않는다.
 */
export const AUTH_COOKIE_NAMES: readonly string[] = ['NID_AUT', 'NID_SES']

export type AuthVerdict =
  | { ok: true; reason: string }
  | { ok: false; code: 'AUTH_MISSING' | 'AUTH_EXPIRED'; reason: string }

export function judgeAuthCookies(
  cookies: readonly { name: string; expires?: number }[],
  nowMs: number,
): AuthVerdict {
  const missing = AUTH_COOKIE_NAMES.filter((n) => !cookies.some((c) => c.name === n))
  if (missing.length > 0) {
    return { ok: false, code: 'AUTH_MISSING', reason: `인증 쿠키 없음: ${missing.join(' · ')}` }
  }
  const nowSec = nowMs / 1000
  const expired = AUTH_COOKIE_NAMES.filter((n) => {
    const c = cookies.find((x) => x.name === n)!
    // 🔴 세션 쿠키(-1·없음)는 만료 시각이 없다 — 만료로 보지 않는다
    return typeof c.expires === 'number' && c.expires > 0 && c.expires <= nowSec
  })
  if (expired.length > 0) {
    return { ok: false, code: 'AUTH_EXPIRED', reason: `인증 쿠키 만료: ${expired.join(' · ')}` }
  }
  return { ok: true, reason: `인증 쿠키 ${AUTH_COOKIE_NAMES.length}종 유효 (값 미출력)` }
}
