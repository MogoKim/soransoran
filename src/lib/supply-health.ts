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

import { STOCK_TARGET, STOCK_MIN } from './micro-seed-supply-autofill'

export type Level = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'INFO'

/** 🔴 코드가 서로 달라야 사람이 무엇을 볼지 안다. 같은 등급이라도 대응이 다르다 */
export type FindingCode =
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
}

export function judgeSource(input: SourceInput): Finding[] {
  const out: Finding[] = []
  const id = input.sourceId

  // 🔴 전문이 새면 다른 무엇보다 먼저다
  if (input.leakedKeys.length > 0) {
    out.push(f('CRITICAL', 'SOURCE_LEAKED_BODY',
      `${id} 산출물에 전문 필드가 있다 (${input.leakedKeys.join(' · ')})`, 'safety'))
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
}

export function judgeSupply(input: SupplyInput): Finding[] {
  const out: Finding[] = []

  if (input.usable === 0) {
    out.push(f('CRITICAL', 'STOCK_CRITICAL', '발행 가능한 재고가 0건이다 — 다음 회차에 내보낼 것이 없다'))
  } else if (input.usable < STOCK_MIN) {
    out.push(f('WARNING', 'STOCK_LOW',
      `재고 ${input.usable}건 — 최소 ${STOCK_MIN}건 아래다 (사람 ${input.human} · 기계 ${input.machine})`))
  } else {
    out.push(f('HEALTHY', 'STOCK_OK',
      `재고 ${input.usable}/${STOCK_TARGET}건 (사람 ${input.human} · 기계 ${input.machine} · legacy ${input.legacyExcluded} 제외)`))
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
 * GitHub Actions cron 은 정시를 보장하지 않는다 — 00:05 예약이 수십 분 밀린다.
 * 유예 없이 경고하면 매일 새벽 거짓 경보가 뜨고, 며칠이면 사람이 화면을 믿지 않는다.
 */
export const PUBLISH_GRACE_MS = 60 * 60 * 1000

export type PublishInput = {
  /** KST 오늘 발행된 수 */
  todayCount: number
  dailyCap: number
  /**
   * 예정 시각 + **유예**가 지났는가.
   *
   * 🔴 GitHub Actions cron 은 정시에 돌지 않는다. 00:05 KST 예약이 수십 분 늦는 일이 흔하다 —
   *    00:05 직후 바로 경고하면 **정상 지연을 장애로 부른다.**
   *    그래서 예정 시각과 경고 시각을 나눈다 (`PUBLISH_GRACE_MS`).
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
