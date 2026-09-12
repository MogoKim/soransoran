/**
 * 콘텐츠 공급 관제 v1 — 순수 판정 (§4-AW)
 *
 * 🔴 **여기에 새 판정이 없다.** 재고는 `readStock`, profile 은 `queueProfileOf`,
 *    KST 하루 경계는 `kstDayStart`, lock 은 `lockDecision` 이 이미 정한다.
 *    이 파일이 하는 일은 그 결과들을 모아 **한 줄로 요약**하는 것뿐이다.
 *
 * 왜 필요한가: 3개 수집원 → 판정 → 생성 → Queue → 발행이 무인으로 돌기 시작했다.
 * 무언가 멈추면 사람이 로그 네 개와 DB 를 번갈아 뒤져야 알 수 있다 —
 * 그 사이 큐는 비어가고, 비었다는 사실조차 늦게 안다.
 *
 * 🔴 등급은 셋뿐이다. **CRITICAL 만 exit 1** 이다 — WARNING 이 종료 코드를 바꾸면
 *    사람이 곧 무시하게 되고, 그러면 CRITICAL 도 같이 묻힌다.
 */


export type Level = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'INFO'

/** 🔴 코드가 서로 달라야 사람이 무엇을 볼지 안다. 같은 등급이라도 대응이 다르다 */
export type FindingCode =
  /**
   * 🔴 회차 기록 기반 코드 — 서로 다른 조치를 요구하는 것은 서로 다른 코드다.
   *    `RUN_SESSION_FILE_MISSING`(env 를 고친다)과 `RUN_AUTH_EXPIRED`(사람이 재로그인)는
   *    옛 판에서 `SOURCE_SESSION_EXPIRED` 하나로 뭉개져 있었다.
   */
  | 'RUN_OK'
  | 'RUN_NO_RECORD'
  | 'RUN_SESSION_FILE_MISSING'
  | 'RUN_AUTH_MISSING'
  | 'RUN_AUTH_EXPIRED'
  | 'RUN_SELECTOR'
  | 'RUN_NETWORK'
  | 'RUN_OTHER'
  | 'RUN_NO_NEW'
  | 'RUN_LOCK_BUSY'
  | 'RUN_LOCK_STALE'
  | 'COLLECT_LOCK_STALE'
  | 'RUN_RUNTIME_DEPENDENCY'
  | 'MANUAL_PREFLIGHT_OK'
  | 'RUN_LEGACY_RECORD'
  | 'RUN_UNKNOWN_LEGACY'
  | 'RUN_IN_PROGRESS'
  | 'RUN_STALE_STARTED'
  | 'DETAIL_BODY_EMPTY'
  | 'DETAIL_NO_NEW'
  | 'SCHEDULED_OK'
  | 'SCHEDULED_BROKEN'
  | 'SCHEDULED_DEGRADED'
  | 'SCHEDULED_ACCUMULATING'
  | 'SCHEDULED_OBSERVATION_PENDING'
  // 수집
  | 'SOURCE_OK'
  | 'SOURCE_PENDING_FIRST_RUN'
  | 'SOURCE_STALE'
  | 'SOURCE_NO_ARTIFACT'
  | 'SOURCE_LEAKED_BODY'
  | 'SOURCE_SESSION_EXPIRED'
  | 'SOURCE_SELECTOR_FAIL'
  | 'SOURCE_JOB_FAILED'
  // 공급
  | 'STOCK_OK'
  | 'STOCK_LOW'
  | 'STOCK_CRITICAL'
  | 'PENDING_THIN'
  | 'CHECKPOINT_RUNNING'
  | 'CHECKPOINT_FAILED'
  | 'LOCK_STALE'
  | 'LOCK_BUSY'
  | 'SUPPLY_STALE'
  | 'HISTORIC_RAW_NOOP'
  // 발행
  | 'PUBLISH_OK'
  | 'PUBLISH_NONE_TODAY'
  | 'PUBLISH_OVER_CAP'
  | 'PUBLISH_LEGACY'
  | 'PUBLISH_MISMATCH'
  | 'PUBLISH_NO_CANDIDATE'
  | 'PUBLISH_HISTORIC_UNKNOWN'
  // 발행 여력 (§4-AW ③-b)
  | 'CAPACITY_OK'
  | 'NEXT_NOT_ASSIGNABLE'
  | 'FORECAST_EMPTY'
  | 'PERSONA_SHORTFALL'
  | 'FORECAST_LOW'
  /**
   * 🔴 기존 배정이 쓸 수 없는 persona 를 가리킨다 — 없는 사람 · 비활성 · 실계정.
   *    러너가 fail-closed 로 멈추므로 **아무것도 나가지 않는다.**
   *    다른 수치가 초록이어도 이 하나면 레인은 멈춘 것이다.
   */
  | 'RECOVERY_BROKEN'

/**
 * 🔴 **안전 불변 위반과 가용성 실패는 다른 것이다.**
 *
 * 전문이 샜다 = 소스 하나라도 그러면 레인 전체가 잘못됐다 → 전체 CRITICAL.
 * 세션이 끊겼다 = 그 소스만 못 돈다. 82cook 이 살아 있으면 큐는 찬다 → 전체 WARNING.
 * 둘을 같은 규칙으로 굴리면 하나가 다른 하나를 가린다.
 */
export type FindingKind = 'safety' | 'availability' | 'plain'

export type Finding = {
  level: Level
  code: FindingCode
  kind?: FindingKind
  /** 사람이 읽을 한 줄. 🔴 원문 · 세션 · 키 값을 담지 않는다 */
  message: string
}

const f = (level: Level, code: FindingCode, message: string, kind: FindingKind = 'plain'): Finding =>
  ({ level, code, message, kind })

/** 🔴 등급 순서. 하나라도 CRITICAL 이면 전체가 CRITICAL 이다 */
const RANK: Record<Level, number> = { INFO: 0, HEALTHY: 1, WARNING: 2, CRITICAL: 3 }

export function worstOf(findings: readonly Finding[]): Level {
  let worst: Level = 'HEALTHY'
  for (const x of findings) {
    // INFO 는 등급을 올리지 않는다 — 알리기만 한다
    if (x.level === 'INFO') continue
    if (RANK[x.level] > RANK[worst]) worst = x.level
  }
  return worst
}

// ══════════════════════════════════════════════════════════════════
// A. 수집원
// ══════════════════════════════════════════════════════════════════

/** 로그 파일 하나 — 🔴 그 파일의 내용과 그 파일의 시각만 짝지어 본다 */
export type LogFacts = {
  /** 'stdout' | 'stderr' 같은 이름. 화면에 쓰지 않고 구분만 한다 */
  name: string
  hint: 'none' | 'session' | 'selector' | 'other'
  /** 🔴 **그 파일 자신이** 마지막 산출물보다 최신인가 */
  newerThanArtifact: boolean
}

export type SourceInput = {
  sourceId: string
  /** 마지막 thin 산출물 시각. 없으면 null */
  lastArtifactAt: Date | null
  lastArtifactRows: number
  /** 그 파일에 전문 키가 있었는가 — 🔴 있으면 그것만으로 CRITICAL 이다 */
  leakedKeys: readonly string[]
  /**
   * 이 소스가 **다음에 돌기로 되어 있던** 시각. 그 시각이 아직 안 왔으면
   * 산출물이 없어도 실패가 아니다 — 오늘 등록한 job 을 죽었다고 하면 안 된다.
   */
  firstScheduledAt: Date | null
  /**
   * 로그 파일 하나하나의 판정 — 🔴 **내용과 시각을 섞지 않는다.**
   *
   * 첫 판은 stdout 과 stderr 을 한 덩어리로 합치고 mtime 은 둘 중 최신 하나를 썼다.
   * 그러면 **오래된 stderr 의 오류 + 최신 stdout 의 성공**이
   * "최신 장애" 로 읽힌다 — 어제 끊겼다가 오늘 복구된 소스가 계속 빨갛게 남는다.
   *
   * 🔴 exit status 는 읽지 않는다. `launchctl` 을 부르지 않기로 했으므로 알 방법이 없다 —
   *    모르는 것을 0 으로 추정해 "정상" 이라고 말하면 화면이 거짓말을 한다.
   */
  logs: readonly LogFacts[]
  now: Date
  /** 이 시간을 넘겨 산출물이 없으면 오래된 것으로 본다 */
  staleAfterMs: number
  /**
   * 🔴 **회차 기록으로 판정한 현재 상태** (2026-09-10).
   *
   *    이것이 있으면 로그 글자(`logs`)보다 **이것을 먼저** 믿는다.
   *    append-only stderr 의 옛 낱말로 현재를 말하던 것이 사고였다 —
   *    세션을 고친 뒤에도 `세션` 이라는 글자가 남아 "만료" 가 계속 나왔다.
   *    쿠키는 3주 뒤까지 유효했다.
   */
  /**
   * 🔴 **공통 운영 판정 결과** (`judgeSourceOperations`).
   *
   *    이것이 있으면 로그 글자(`logs`)보다 **이것을 먼저** 믿는다.
   *    supply:health 와 wave-c 가 **같은 함수**의 결과를 쓴다 —
   *    앞선 판은 각자 판정해 같은 시점에 HEALTHY 와 BROKEN 을 동시에 냈다.
   */
  ops?: {
    level: Level
    codes: readonly string[]
    reason: string
    scheduled: { health: string; succeeded: number; expected: number; elapsed: number }
    latestRun: { level: Level; code: string; reason: string; runId: string | null }
    detail: string
    manual: { ok: boolean; detail: string }
  } | null
  /**
   * 🔴 **남아 있는 죽은 수집 락** — 회차 기록과 무관하게 관측된다.
   *    자동 회수를 하지 않으므로, 관제가 내지 않으면 조용히 멈춘 채로 남는다.
   */
  lockStale?: { path: string; ageMs: number | null; detail: string } | null
}

/**
 * 🔴 **stale 임계를 슬롯 간격에서 파생시킨다** (2026-09-10).
 *
 *    앞선 판은 30시간 상수였다. 하루 4회(6시간 간격) 도는 job 이 22시간째
 *    아무것도 못 내놓아도 `SOURCE_OK` 였다 — 실제로 그 22시간 동안
 *    8회 연속 실패하고 있었다. 하루 1~2회 시절의 상수가 그대로 남은 것이다.
 *
 *    "얼마나 오래되면 이상한가" 는 그 job 이 **얼마나 자주 도는가**에서 나온다.
 *
 * 🔴 **옛 상수보다 느슨해지지 않는다.** 상한을 30시간으로 둔다 —
 *    하루 1회 도는 레인에서 48시간이 나오면 그건 개선이 아니라 후퇴다.
 *
 * @param slots 그 source 의 하루 슬롯 (KST 시·분). 예약 job 이 없는 on-demand 레인은 빈 배열
 * @param graceFactor 슬롯 간격의 몇 배까지 봐주는가
 * @param floorMs 아무리 짧아도 이보다 짧게 잡지 않는다
 */
export const STALE_CEILING_MS = 30 * 3_600_000

export function staleAfterFromSlots(
  slots: readonly (readonly [number, number])[],
  graceFactor = 2,
  floorMs = 3 * 3_600_000,
): number {
  // 🔴 예약 job 이 없으면 슬롯에서 파생할 것이 없다 — 하루 단위 상한을 쓴다
  if (slots.length === 0) return STALE_CEILING_MS
  if (slots.length === 1) return Math.min(STALE_CEILING_MS, Math.max(floorMs, 24 * 3_600_000 * graceFactor))
  const mins = [...slots].map(([h, m]) => h * 60 + m).sort((a, b) => a - b)
  let maxGap = mins[0]! + 24 * 60 - mins[mins.length - 1]!
  for (let i = 1; i < mins.length; i += 1) maxGap = Math.max(maxGap, mins[i]! - mins[i - 1]!)
  return Math.min(STALE_CEILING_MS, Math.max(floorMs, maxGap * 60_000 * graceFactor))
}

export function judgeSource(input: SourceInput): Finding[] {
  const out: Finding[] = []
  const id = input.sourceId

  // 🔴 전문이 새면 다른 무엇보다 먼저다
  if (input.leakedKeys.length > 0) {
    out.push(f('CRITICAL', 'SOURCE_LEAKED_BODY',
      `${id} 산출물에 전문 필드가 있다 (${input.leakedKeys.join(' · ')})`, 'safety'))
  }

  /**
   * 🔴 **회차 기록이 있으면 그것이 현재 상태다** (2026-09-10).
   *
   *    로그 글자는 보조다. 구조적 종료 기록의 **최신 것**이 무엇을 말하는지가 먼저다 —
   *    과거 실패 뒤 성공이 있으면 과거는 과거이고, 성공 뒤 실패가 있으면 최신이 이긴다.
   *    그리고 `SESSION_FILE_MISSING`(경로 없음)을 "세션 만료" 라고 말하지 않는다.
   */
  if (input.ops != null) {
    const o = input.ops
    /**
     * 🔴 **예약 수집 상태가 등급을 정한다.** 수동 성공이 이것을 덮지 못한다 —
     *    같은 시점에 wave-c 가 BROKEN 이라고 말하는데
     *    여기서 HEALTHY 를 내던 것이 이번 모순이었다.
     */
    out.push(f(o.level, `SCHEDULED_${o.scheduled.health}` as FindingCode,
      `${id} ${o.reason}`
      + ` [예약 ${o.scheduled.succeeded}/${o.scheduled.expected} · 지나간 슬롯 ${o.scheduled.elapsed}]`,
      o.level === 'HEALTHY' ? undefined : 'availability'))

    // 🔴 최신 회차 상태는 따로 낸다 — legacy 는 성공이 아니다
    if (o.latestRun.code !== 'RUN_OK') {
      out.push(f(o.latestRun.level, o.latestRun.code as FindingCode,
        `${id} ${o.latestRun.reason}${o.latestRun.runId === null ? '' : ` (run ${o.latestRun.runId})`}`))
    }
    if (o.detail === 'BODY_EMPTY') {
      out.push(f('CRITICAL', 'DETAIL_BODY_EMPTY',
        `${id} 상세를 열었지만 본문을 읽지 못했다 — 성공으로 세지 않는다`, 'availability'))
    } else if (o.detail === 'NO_NEW') {
      out.push(f('INFO', 'DETAIL_NO_NEW', `${id} 새 후보가 없어 상세를 열지 않았다 — 공급 0 (고장 아님)`))
    }
    // 🔴 수동은 INFO 로만 남는다. 등급을 올리지 않는다
    if (o.manual.ok) out.push(f('INFO', 'MANUAL_PREFLIGHT_OK', `${id} ${o.manual.detail}`))
    /**
     * 🔴 **남은 죽은 락은 사람이 봐야 한다.**
     *    "다음 회차가 자동으로 치운다" 가 아니다 — 자동 회수를 하지 않기로 했다.
     */
    if (input.lockStale != null) {
      const mins = input.lockStale.ageMs === null ? '?' : Math.round(input.lockStale.ageMs / 60_000)
      out.push(f('CRITICAL', 'COLLECT_LOCK_STALE',
        `${id} 죽은 수집 락이 ${mins}분째 남아 있다 (${input.lockStale.path})`
        + ' — 🔴 자동 회수하지 않는다 · 사람 확인 필요'
        + ' (실행 중 프로세스가 없음을 확인한 뒤에만 지운다)', 'availability'))
    }

    // 🔴 예약이 정상일 때만 로그의 옛 낱말을 건너뛴다
    if (o.level === 'HEALTHY') return finishSource(out, input, id)
    return out
  }

  // 🔴 로그가 말하는 실패는 산출물 유무보다 구체적이다.
  //    단 **그 파일 자신이 최신일 때만** — 옛 실패가 오늘의 성공을 덮지 않는다.
  //    파일별로 따로 본다. 한 파일의 내용과 다른 파일의 시각을 섞지 않는다.
  const fresh = input.logs.filter((l) => l.hint !== 'none' && l.newerThanArtifact)
  const stale = input.logs.filter((l) => l.hint !== 'none' && !l.newerThanArtifact)
  const worstHint = fresh.some((l) => l.hint === 'session') ? 'session'
    : fresh.some((l) => l.hint === 'selector') ? 'selector'
      : fresh.some((l) => l.hint === 'other') ? 'other' : 'none'

  if (worstHint === 'session') {
    out.push(f('CRITICAL', 'SOURCE_SESSION_EXPIRED',
      `${id} 세션이 만료됐거나 거부됐다 — 재발급이 필요하다`, 'availability'))
  } else if (worstHint === 'selector') {
    out.push(f('CRITICAL', 'SOURCE_SELECTOR_FAIL',
      `${id} 목록·본문 셀렉터가 맞지 않는다 — 사이트 구조가 바뀌었을 수 있다`, 'availability'))
  } else if (worstHint === 'other') {
    out.push(f('WARNING', 'SOURCE_JOB_FAILED',
      `${id} 최신 로그에 오류가 있다 (exit status 는 확인하지 않는다)`, 'availability'))
  } else if (stale.length > 0) {
    out.push(f('INFO', 'SOURCE_OK',
      `${id} 로그에 지난 오류 흔적이 있으나 그 뒤 산출물이 나왔다 — 지난 일이다`))
  }

  return finishSource(out, input, id)
}

/** 🔴 산출물 신선도 — 회차 기록 경로와 로그 경로가 **같은 함수**를 쓴다 */
function finishSource(out: Finding[], input: SourceInput, id: string): Finding[] {
  // 🔴 아직 첫 예정 시각이 오지 않았으면 없는 게 정상이다
  const beforeFirstRun = input.firstScheduledAt !== null
    && input.now.getTime() < input.firstScheduledAt.getTime()

  if (input.lastArtifactAt === null) {
    out.push(beforeFirstRun
      ? f('INFO', 'SOURCE_PENDING_FIRST_RUN', `${id} 아직 첫 예정 시각 전이다 — 산출물이 없는 것이 정상이다`)
      : f('WARNING', 'SOURCE_NO_ARTIFACT', `${id} 산출물이 하나도 없다`))
    return out
  }

  const ageMs = input.now.getTime() - input.lastArtifactAt.getTime()
  if (ageMs > input.staleAfterMs && !beforeFirstRun) {
    out.push(f('WARNING', 'SOURCE_STALE',
      `${id} 마지막 산출물이 ${Math.floor(ageMs / 3_600_000)}시간 전이다 (${input.lastArtifactRows}행)`))
  } else if (!out.some((x) => x.level !== 'INFO')) {
    out.push(f('HEALTHY', 'SOURCE_OK',
      `${id} 최근 산출물 ${input.lastArtifactRows}행 · ${Math.floor(ageMs / 60_000)}분 전`))
  }
  return out
}

/**
 * 🔴 **소스 하나가 죽은 것과 공급 전체가 멈춘 것은 다르다.**
 * 82cook 이 살아 있으면 큐는 계속 찬다 — 네이버 한쪽이 막혔다고 CRITICAL 로 올리면
 * 진짜 전면 중단과 구분되지 않는다.
 */
export function rollUpSources(perSource: readonly { sourceId: string; findings: Finding[] }[]): Finding[] {
  const out: Finding[] = []
  const has = (s: { findings: Finding[] }, kind: FindingKind): boolean =>
    s.findings.some((x) => x.level === 'CRITICAL' && x.kind === kind)

  // 🔴 ① 안전 불변 — **하나라도** 어긋나면 레인 전체가 잘못됐다.
  //    "다른 소스는 멀쩡하다" 는 위안이 되지 않는다. 전문이 샌 파일은 이미 디스크에 있다.
  const leaked = perSource.filter((s) => has(s, 'safety'))
  if (leaked.length > 0) {
    out.push(f('CRITICAL', 'SOURCE_LEAKED_BODY',
      `전문이 새어 나온 소스 ${leaked.length}개 (${leaked.map((d) => d.sourceId).join(' · ')}) — 소스 하나여도 레인 전체 문제다`,
      'safety'))
  }

  // 🔴 ② 가용성 — 일부만 막히면 나머지가 큐를 채운다. 전부 막혀야 공급이 끊긴다
  const down = perSource.filter((s) => has(s, 'availability'))
  const up = perSource.filter((s) => !has(s, 'availability'))
  if (down.length > 0 && up.length === 0) {
    out.push(f('CRITICAL', 'SOURCE_JOB_FAILED',
      `수집원 ${down.length}개가 모두 막혔다 — 공급이 끊긴다`, 'availability'))
  } else if (down.length > 0) {
    out.push(f('WARNING', 'SOURCE_JOB_FAILED',
      `수집원 ${down.length}개가 막혔다 (${down.map((d) => d.sourceId).join(' · ')}) · ${up.length}개는 살아 있다`,
      'availability'))
  }

  // 🔴 ③ 소스별 WARNING 은 전체 등급에 반영된다 — 소스 화면에만 두면 요약이 초록으로 남는다
  const warned = perSource.filter((s) => s.findings.some((x) => x.level === 'WARNING'))
  if (warned.length > 0 && out.every((x) => x.level !== 'CRITICAL')) {
    out.push(f('WARNING', 'SOURCE_STALE',
      `주의가 필요한 소스 ${warned.length}개 (${warned.map((d) => d.sourceId).join(' · ')})`))
  }
  return out
}

// ══════════════════════════════════════════════════════════════════
// B. 공급
// ══════════════════════════════════════════════════════════════════

export type SupplyInput = {
  usable: number
  human: number
  machine: number
  legacyExcluded: number
  pendingThin: number
  /** 역사 raw — 🔴 변환해도 결과 0건이라 계속 남는다. 장애가 아니다 */
  historicRawNoop: number
  runningCheckpoints: number
  failedCheckpoints: number
  lock: 'free' | 'busy' | 'stale'
  lastSupplyOkAt: Date | null
  now: Date
  /** 마지막 성공이 이보다 오래되면 경고 */
  staleAfterMs: number
  /**
   * 🔴 **재고 기준선을 주입받는다** (2026-09-08, Codex P1).
   *    모듈 상수(가장 안전한 d1 값)를 쓰면 `capacity=d10` 인데 "재고 14/14 정상" 이라고
   *    말하게 된다 — 관제가 준비 부족을 초록으로 보여 주는 것이 가장 나쁜 실패다.
   *    내부 공급 기준이므로 **capacity 프로필**에서 만들어 넘긴다.
   */
  stockMin: number
  stockTarget: number
}

export function judgeSupply(input: SupplyInput): Finding[] {
  const out: Finding[] = []

  if (input.usable === 0) {
    out.push(f('CRITICAL', 'STOCK_CRITICAL', '발행 가능한 재고가 0건이다 — 다음 회차에 내보낼 것이 없다'))
  } else if (input.usable < input.stockMin) {
    out.push(f('WARNING', 'STOCK_LOW',
      `재고 ${input.usable}건 — 최소 ${input.stockMin}건 아래다 (사람 ${input.human} · 기계 ${input.machine})`))
  } else {
    out.push(f('HEALTHY', 'STOCK_OK',
      `재고 ${input.usable}/${input.stockTarget}건 (사람 ${input.human} · 기계 ${input.machine} · legacy ${input.legacyExcluded} 제외)`))
  }

  if (input.failedCheckpoints > 0) {
    out.push(f('WARNING', 'CHECKPOINT_FAILED',
      `실패로 끝난 회차 ${input.failedCheckpoints}건 — 사람이 확인해야 한다`))
  }
  if (input.runningCheckpoints > 0) {
    out.push(f('WARNING', 'CHECKPOINT_RUNNING',
      `미완료 회차 ${input.runningCheckpoints}건 — 다음 회차가 이어받는다`))
  }
  if (input.lock === 'stale') {
    out.push(f('WARNING', 'LOCK_STALE', '죽은 lock 이 남아 있다 — 다음 live 회차가 걷어낸다'))
  } else if (input.lock === 'busy') {
    out.push(f('INFO', 'LOCK_BUSY', '지금 공급 회차가 도는 중이다'))
  }
  if (input.pendingThin > 0) {
    out.push(f('INFO', 'PENDING_THIN', `아직 검수용으로 바뀌지 않은 얇은 파일 ${input.pendingThin}개`))
  }
  // 🔴 이것은 장애가 아니다. 매일 로그에 뜨지만 아무것도 잘못되지 않았다
  if (input.historicRawNoop > 0) {
    out.push(f('INFO', 'HISTORIC_RAW_NOOP',
      `역사 수집물 ${input.historicRawNoop}개가 매 회차 재검사된다 — 변환 결과가 0건이라 완료 표시가 남지 않는다 (장애 아님)`))
  }
  if (input.lastSupplyOkAt === null) {
    out.push(f('INFO', 'SUPPLY_STALE', '성공한 공급 회차 기록이 아직 없다'))
  } else if (input.now.getTime() - input.lastSupplyOkAt.getTime() > input.staleAfterMs) {
    const h = Math.floor((input.now.getTime() - input.lastSupplyOkAt.getTime()) / 3_600_000)
    out.push(f('WARNING', 'SUPPLY_STALE', `마지막 공급 성공이 ${h}시간 전이다`))
  }
  return out
}

// ══════════════════════════════════════════════════════════════════
// C. 발행
// ══════════════════════════════════════════════════════════════════

/**
 * 🔴 발행 예정 시각을 넘긴 뒤 **얼마나 기다렸다가** 경고할 것인가.
 *
 * GitHub Actions cron 은 정시를 보장하지 않는다 — 예약이 수십 분 밀린다.
 * 유예 없이 경고하면 매일 거짓 경보가 뜨고, 며칠이면 사람이 화면을 믿지 않는다.
 *
 * 🔴 **기준 시각은 지금 적용된 release profile 의 첫 슬롯**이다(관제가 그것을 넘긴다).
 *    옛 판은 `00:05` 고정이라, 슬롯을 09:30 으로 옮긴 뒤에도 01:05 부터 경고가 떴다.
 */
export const PUBLISH_GRACE_MS = 60 * 60 * 1000

export type PublishInput = {
  /** KST 오늘 발행된 수 */
  todayCount: number
  dailyCap: number
  /**
   * 예정 시각 + **유예**가 지났는가.
   *
   * 🔴 GitHub Actions cron 은 정시에 돌지 않는다. 예약이 수십 분 늦는 일이 흔하다 —
   *    첫 슬롯 직후 바로 경고하면 **정상 지연을 장애로 부른다.**
   *    그래서 예정 시각과 경고 시각을 나눈다 (`PUBLISH_GRACE_MS`).
   *    🔴 예정 시각은 호출부가 **profile 의 첫 슬롯**에서 만든다 — 여기에 상수를 두지 않는다.
   */
  afterPublishGrace: boolean
  /** 큐에서 PUBLISHED 인데 Post 가 없는 것 등 정합이 깨진 수 */
  mismatched: number
  /**
   * 🔴 **오늘(KST) 발행분 중** profile 이 없는 것.
   *
   * 과거 기록 전체에서 세면 안 된다 — 이 저장소에는 옛 판(`gemini-3.7-flash`)으로
   * 발행된 역사 행이 2건 있고, 그것을 세면 **매일 CRITICAL 이 뜬다.**
   * 며칠이면 사람이 이 화면을 믿지 않게 된다.
   * 관제가 볼 것은 "지금 잘못되고 있나" 이지 "과거에 무엇이 있었나" 가 아니다.
   */
  legacyPublishedToday: number
  /** 과거에 이 레인이 만들지 않은 발행 기록 — 🔴 알리기만 한다 */
  historicUnknownProfile: number
  /** 다음에 나갈 수 있는 후보 수 */
  candidates: number
  now: Date
}

export function judgePublish(input: PublishInput): Finding[] {
  const out: Finding[] = []

  if (input.legacyPublishedToday > 0) {
    out.push(f('CRITICAL', 'PUBLISH_LEGACY',
      `오늘 profile 없는 글이 ${input.legacyPublishedToday}건 발행됐다 — 발행 대상이 아니다`))
  }
  if (input.historicUnknownProfile > 0) {
    out.push(f('INFO', 'PUBLISH_HISTORIC_UNKNOWN',
      `이 레인이 만들지 않은 과거 발행 기록 ${input.historicUnknownProfile}건 (옛 판 산출물 · 장애 아님)`))
  }
  if (input.mismatched > 0) {
    out.push(f('CRITICAL', 'PUBLISH_MISMATCH',
      `Queue 와 Post 가 어긋난 행이 ${input.mismatched}건 있다`))
  }
  if (input.todayCount > input.dailyCap) {
    out.push(f('CRITICAL', 'PUBLISH_OVER_CAP',
      `오늘 ${input.todayCount}건 발행 — 상한 ${input.dailyCap}건을 넘었다`))
  }
  if (input.candidates === 0) {
    out.push(f('WARNING', 'PUBLISH_NO_CANDIDATE', '다음에 내보낼 후보가 0건이다'))
  }
  // 🔴 예정 시각 + 유예까지 지났는데 0건이면 러너가 돌지 않은 것이다.
  //    유예 안이면 늦는 중일 뿐이다 — GitHub Actions cron 은 정시에 돌지 않는다.
  if (input.todayCount === 0 && input.afterPublishGrace) {
    out.push(f('WARNING', 'PUBLISH_NONE_TODAY',
      `예정 시각 + 유예 ${PUBLISH_GRACE_MS / 60_000}분이 지났는데 오늘 발행이 0건이다 — 러너가 돌지 않았을 수 있다`))
  }
  // 🔴 **정상 요약은 항상 낸다.** INFO 가 하나 있다고 숫자가 사라지면
  //    사람이 "오늘 몇 건 나갔나" 를 다시 어딘가에서 찾아야 한다
  out.push(f(out.some((x) => x.level !== 'INFO') ? 'INFO' : 'HEALTHY', 'PUBLISH_OK',
    `오늘 ${input.todayCount}/${input.dailyCap}건 · 다음 후보 ${input.candidates}건`))
  return out
}

// ══════════════════════════════════════════════════════════════════
// 전체
// ══════════════════════════════════════════════════════════════════

export type HealthReport = {
  level: Level
  sources: { sourceId: string; findings: Finding[] }[]
  supply: Finding[]
  publish: Finding[]
  rollUp: Finding[]
  /** 🔴 CRITICAL 만 1 이다 */
  exitCode: 0 | 1
}

export function buildReport(input: {
  sources: { sourceId: string; findings: Finding[] }[]
  supply: Finding[]
  publish: Finding[]
}): HealthReport {
  // 🔴 소스별 CRITICAL 을 그대로 올리지 않는다 — rollUp 이 안전/가용성을 나눠 다시 판단한다.
  //    다만 소스별 **WARNING** 은 rollUp 이 승격시켜 여기로 온다.
  const rollUp = rollUpSources(input.sources)
  const level = worstOf([...input.supply, ...input.publish, ...rollUp])
  return {
    level, sources: input.sources, supply: input.supply, publish: input.publish, rollUp,
    exitCode: level === 'CRITICAL' ? 1 : 0,
  }
}

/** 🔴 산출물에 있으면 안 되는 키 */
export const FORBIDDEN_BODY_KEYS: readonly string[] = [
  'rawBody', 'body', 'content', 'html', 'rawHtml', 'text',
] as const

/**
 * 로그에서 오류 성격만 뽑는다 — 🔴 **내용은 담지 않는다.**
 *
 * 🔴 **개별 글 실패와 소스 전체 실패는 다르다.**
 *
 * 네이버 수집기는 글 하나를 못 읽으면 이렇게 찍고 **다음 글로 넘어간다**:
 *
 *   ⚠️ 447520 — 본문 셀렉터가 터졌다(건너뛴다): ...
 *   ⚠️ 447521 — 본문이 비었다. 셀렉터가 안 맞거나 접근이 막혔다(건너뛴다)
 *
 * 20건 중 1건을 건너뛰고 19건을 정상 저장해도 이 줄은 로그에 남는다.
 * 그것을 소스 전체 장애로 읽으면 **정상 회차가 매번 CRITICAL 로 뜬다.**
 *
 * 소스가 실제로 멈추는 것은 **terminal** 오류뿐이다 (수집기 실측 계약):
 *   · `fail()` → `🛑 <사유>` — 세션 · 락 · 인자 · 카페 미상
 *   · **최상위 catch → `❌ <message>`** — 실행 timeout · 브라우저 실행 실패 · 권한 오류 등
 *     (`main().catch((e) => console.error(`❌ ${e.message}`))` — 실측 계약)
 *   · `throw new Error('목록이 비었다 [...]')` 는 그 catch 를 거쳐 `❌ 목록이 비었다 [...]` 로 나온다
 */

/** 🔴 개별 글을 건너뛴 줄 — 소스는 계속 돌았다 */
function isPerItemSkip(line: string): boolean {
  return /⚠️/.test(line) && /건너뛴다/.test(line)
}

/**
 * 🔴 실행을 멈춘 줄만 본다.
 *
 * `❌` 는 최상위 catch 의 표시다 — 이것을 놓치면 **실행 timeout · 브라우저 실행 실패 ·
 * 권한 오류가 전부 "정상" 으로 읽힌다.** 소스가 며칠째 안 도는데 화면은 초록이다.
 *
 * 🔴 `🔴 전문을 저장하지 않았다` 같은 **정상 안내**는 terminal 이 아니다 —
 *    빨간 이모지가 붙었다고 오류인 것은 아니다.
 */
function isTerminal(line: string): boolean {
  return /❌/.test(line) || /🛑/.test(line) || /\bError:/.test(line) || /목록이 비었다/.test(line)
}

export function logHintOf(log: string): 'none' | 'session' | 'selector' | 'other' {
  // 🔴 줄 단위로 본다. 덩어리로 정규식을 걸면 개별 skip 한 줄이 전체를 물들인다
  const terminal = log.split('\n').filter((l) => !isPerItemSkip(l)).filter(isTerminal)
  if (terminal.length === 0) return 'none'
  const joined = terminal.join('\n')
  if (/세션|session|로그인|login|storage-state|인증/i.test(joined)) return 'session'
  if (/목록이 비었다|셀렉터|selector/i.test(joined)) return 'selector'
  return 'other'
}

/** 개별 글을 몇 건 건너뛰었는가 — 🔴 장애가 아니라 참고 수치다 */
export function perItemSkipCount(log: string): number {
  return log.split('\n').filter(isPerItemSkip).length
}
