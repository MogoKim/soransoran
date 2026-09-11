/**
 * 콘텐츠 공급 관제 v1 (§4-AW)
 *
 * 🔴 **read-only 다.** DB write 0 · 네트워크 0 · LLM 0 · 수집 0 · 적재 0 · 발행 0 ·
 *    launchctl 0 · 파일 write 0. DB 는 **읽기만** 한다.
 *
 * 3개 수집원 → 판정 → 생성 → Queue → 발행이 무인으로 돌기 시작했다.
 * 무언가 멈추면 사람이 로그 넷과 DB 를 번갈아 뒤져야 알 수 있고,
 * 그 사이 큐는 비어간다 — 비었다는 사실조차 늦게 안다.
 * 이 명령 하나로 그것을 본다.
 *
 *   npm run supply:health          사람이 읽는 화면
 *   npm run supply:health -- --json  기계가 읽는 한 덩어리
 *
 * 🔴 **CRITICAL 만 exit 1** 이다. WARNING 이 종료 코드를 바꾸면 사람이 곧 무시하고,
 *    그러면 CRITICAL 도 같이 묻힌다.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

import type { PrismaClient } from '@prisma/client'

import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import {
  FORBIDDEN_BODY_KEYS, buildReport, judgePublish, judgeSource, judgeSupply, logHintOf,
  staleAfterFromSlots,
  PUBLISH_GRACE_MS, type Finding, type HealthReport, type LogFacts,
} from '../src/lib/supply-health'
import { STOCK_TARGET, readStock, queueProfileOf } from '../src/lib/micro-seed-supply-autofill'
import { LOCK_FILE, LOCK_TTL_MS, RUN_FILE_RE, adaptKeyOf } from '../src/lib/supply-process'
/** 🔴 잠금 판정 정본 하나 — 관제도 러너와 같은 함수로 본다 */
import { lockAnomaly as processLockAnomaly } from './lib/collect-lock.mjs'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'
import { installFromEnv, describeScale } from '../src/lib/scale-runtime'
import { PROFILES, derive as deriveProfile, effectiveWeeklyCap, slotLabel } from '../src/lib/scale-profile'
import { simulateAllStages, promotionPlan, highestReady, horizonMismatches } from '../src/lib/scale-readiness'
import { SOURCE_FACTS, THIN_82COOK_SLOTS, type SourceId } from '../src/lib/collect-schedule'
import { guardSnapshot, rollBudgetDay, type GuardState } from '../src/lib/collect-guard'
import { guardPath, kstDayOf } from './lib/collect-guard-store.mjs'
import { planSupply, collectReadiness } from '../src/lib/scale-supply-plan'
import { currentCapacity, preparedCapacity, describeInventory } from '../src/lib/collect-inventory'
import { observeJobsSafe } from './lib/launchd-observe.mjs'
import { prepareCandidates, describePrepared, type QueueCandidate } from '../src/lib/supply-candidates'
import { compareWorkflow } from '../src/lib/scale-workflow-render'
import { selectAutoTargets } from '../src/lib/original-post-auto-publish'
import {
  forecastPublishing, nextScheduleAt, capacityOf, personasNeededFor,
  blockRatesByCombination, kstStamp, judgeCapacity,
  type PersonaHistory,
} from '../src/lib/supply-capacity-forecast'
import { verifyPublishedRows } from '../src/lib/original-post-publish-verify'
import { kstDayStart } from '../src/lib/persona-cap'
// 🔴 3축 판정은 정본 게이트 함수가 한다 (노출 게이트 C-2 · C-4)
import { isSearchIndexable, isDiscoveryEligible } from '../src/lib/post-visibility'

const DATA_DIR = '.microseed-data'
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'soransoran')
const argv = process.argv.slice(2)
import { judgeOperationalReadiness, judgeSourceOperations } from '../src/lib/collect-operations'
import { lockAnomaly } from './lib/collect-lock.mjs'
import { LOCK_PATH, LOCK_MAX_AGE_MS } from './lib/micro-seed-navercafe.mjs'
import { readRunRecords } from './lib/collect-run-store.mjs'

/** 🔴 슬롯 × 회차당 상한 — **설정값**이다. `current` 가 아니다 */
const CONFIGURED_PER_DAY: Readonly<Record<string, number>> = {
  'navercafe:remonterrace': 40,
  'navercafe:wgang': 40,
}
const MANIFEST_FILE = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'runtime-manifest.json',
)

const JSON_OUT = argv.includes('--json')
const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : String(v ?? '').trim())

/**
 * 🔴 산출물 stale 임계는 **슬롯 간격에서 파생**한다 (`staleAfterFromSlots`).
 *    상수 30시간을 쓰던 옛 판은 하루 4회 도는 job 이 22시간 죽어 있어도
 *    `SOURCE_OK` 라고 말했다 — 그 22시간 동안 8회 연속 실패하고 있었다.
 */
const SUPPLY_STALE_MS = 30 * 60 * 60 * 1000

/**
 * 확정 수집원 셋 — 🔴 §4-AV 와 같은 목록이다.
 *
 * 🔴 **슬롯은 배열이다.** 첫 슬롯 하나만 보면 "다음 실행" 을 내일로 잡아 헛기다린다.
 */
const SOURCES: {
  id: string; filePrefix: string; logName: string; slots: [number, number][]
  /** 🔴 예약 job 이 아직 올라와 있지 않은 레인인가 — 돌지 않는 슬롯으로 stale 을 묻지 않는다 */
  onDemand?: boolean
}[] = [
  {
    /**
     * 🔴 **82cook 얇은 상세 job 은 아직 등록돼 있지 않다.** 아래 슬롯은 *계획*(prepared)이다 —
     *    그래서 stale 임계를 이 슬롯에서 파생시키지 않는다. 돌지 않는 슬롯으로
     *    "왜 안 도느냐" 를 물으면 화면이 늘 빨갛고, 그러면 진짜 장애가 그 안에 묻힌다.
     *    🔴 등록되면 `onDemand` 를 내린다 — 그때부터는 슬롯이 실제 약속이다.
     */
    id: '82cook', filePrefix: '82cook-thin-', logName: 'supply-collect-82cook-thin',
    // 🔴 시각 정본은 `collect-schedule` 하나다 — 여기 숫자를 다시 적지 않는다
    slots: THIN_82COOK_SLOTS.map((x) => [x.hour, x.minute] as [number, number]),
    onDemand: true,
  },
  {
    /**
     * 🔴 **Wave B 이후 다회 job 이 정본이다** (2026-09-10 정정).
     *    옛 판은 1회 슬롯(`[[9,20]]`)과 1회판 로그 이름을 보고 있었다 —
     *    실제로 도는 `-multi` job 의 로그를 **한 번도 읽지 않았고**,
     *    그래서 8회 연속 `SESSION_FILE_MISSING` 을 놓쳤다.
     */
    id: 'navercafe:remonterrace', filePrefix: 'navercafe-thin-remonterrace-',
    logName: 'navercafe-collect-remonterrace-multi',
    slots: [[4, 20], [10, 20], [16, 20], [22, 20]],
  },
  {
    id: 'navercafe:wgang', filePrefix: 'navercafe-thin-wgang-',
    logName: 'navercafe-collect-wgang-multi',
    slots: [[2, 50], [8, 50], [14, 50], [20, 50]],
  },
]

function dataFiles(): string[] {
  return existsSync(DATA_DIR) ? readdirSync(DATA_DIR) : []
}

function jsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim() !== '')
    .map((l) => { try { return JSON.parse(l) as Record<string, unknown> } catch { return {} } })
}

/**
 * 소스별 산출물 — 🔴 파일 내용은 **키만** 본다. 본문을 읽지 않는다.
 *
 * 🔴 전문 유출은 **디스크에 남은 전부**를 본다. 마지막 파일만 보면
 *    어제 샌 전문이 오늘 파일에 가려진다 — 그 파일은 여전히 디스크에 있다.
 */
function lastArtifact(prefix: string): {
  at: Date | null; rows: number; leaked: string[]
} {
  const hits = dataFiles()
    .filter((x) => x.startsWith(prefix) && x.endsWith('.thin-detail.jsonl'))
    .sort()
  if (hits.length === 0) return { at: null, rows: 0, leaked: [] }
  const leaked = new Set<string>()
  for (const h of hits) {
    for (const r of jsonl(join(DATA_DIR, h))) {
      for (const k of FORBIDDEN_BODY_KEYS) if (k in r) leaked.add(k)
    }
  }
  const last = hits[hits.length - 1]
  const path = join(DATA_DIR, last)
  return { at: statSync(path).mtime, rows: jsonl(path).length, leaked: [...leaked] }
}

/**
 * 로그 — 🔴 **파일마다 따로** 오류 성격과 시각을 본다.
 *
 * 합치면 오래된 stderr 의 오류가 최신 stdout 의 성공과 섞여 "최신 장애" 로 읽힌다.
 * 🔴 exit status 는 읽지 않는다. `launchctl` 을 부르지 않으므로 알 방법이 없고,
 *    모르는 것을 0 으로 추정하면 화면이 거짓말을 한다.
 */
function logFacts(name: string, artifactAt: Date | null): LogFacts[] {
  const out: LogFacts[] = []
  for (const [kind, file] of [
    ['stdout', `${name}.log`], ['stderr', `${name}-error.log`],
  ] as const) {
    const p = join(LOG_DIR, file)
    if (!existsSync(p)) continue
    const at = statSync(p).mtime
    out.push({
      name: kind,
      hint: logHintOf(readFileSync(p, 'utf-8').slice(-4000)),
      // 🔴 **그 파일 자신이** 산출물보다 최신인가
      newerThanArtifact: artifactAt === null || at.getTime() > artifactAt.getTime(),
    })
  }
  return out
}

/**
 * 다음 예정 시각 — 🔴 **슬롯 전체에서** 가장 이른 것을 고른다.
 * 아직 안 왔으면 산출물이 없어도 실패가 아니다.
 */
function nextScheduled(slots: readonly [number, number][], now: Date): Date {
  const start = kstDayStart(now)
  const cands = slots.map(([h, m]) => {
    const at = new Date(start.getTime() + (h * 60 + m) * 60_000)
    return at.getTime() > now.getTime() ? at : new Date(at.getTime() + 24 * 3_600_000)
  })
  return cands.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b))
}

/** job 이 등록된 시각 — plist mtime. 없으면 null(등록 안 됨) */
function jobRegisteredAt(label: string): Date | null {
  const p = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
  return existsSync(p) ? statSync(p).mtime : null
}

/** 아직 adapt 되지 않은 얇은 파일 수 — 🔴 공급 러너와 같은 키로 센다 */
function pendingThinCount(): number {
  const files = dataFiles()
  const done = new Set<string>()
  for (const x of files.filter((y) => y.startsWith('82cook-adapt-'))) {
    const m = /^82cook-adapt-(.+?)\./.exec(x)
    if (m !== null) done.add(m[1])
  }
  return files.filter((x) => x.endsWith('.thin-detail.jsonl')).filter((x) => !done.has(adaptKeyOf(x))).length
}

/** 역사 raw — 변환해도 결과 0건이라 계속 남는다. 🔴 장애가 아니다 */
function historicRawNoop(): number {
  const files = dataFiles()
  const thinKeys = new Set(files
    .filter((x) => /^navercafe-thin-.*\.thin-detail\.jsonl$/.test(x)).map((x) => adaptKeyOf(x)))
  return files.filter((x) => {
    const m = /^navercafe-([a-z0-9]+)-(.+)\.jsonl$/i.exec(x)
    if (m === null || x.includes('.list.') || x.includes('-thin-')) return false
    return !thinKeys.has(`${m[1]}-${m[2]}`)
  }).length
}

type CheckpointSummary = { running: number; failed: number; lastOkAt: Date | null }

/**
 * 공급 처리 회차 기록 — 🔴 **관제용이지 재개 근거가 아니다.**
 *    `running` 인 채로 남은 것은 "처리기가 도중에 죽었다" 는 뜻이고,
 *    다음 회차는 그 기록과 무관하게 **남아 있는 입력에서** 다시 시작한다.
 */
function checkpoints(): CheckpointSummary {
  let running = 0
  let failed = 0
  let lastOkAt: Date | null = null
  for (const x of dataFiles().filter((y) => RUN_FILE_RE.test(y))) {
    try {
      const cp = JSON.parse(readFileSync(join(DATA_DIR, x), 'utf-8')) as {
        status?: string; completedAt?: string | null
      }
      if (cp.status === 'running') running += 1
      else if (cp.status === 'failed') failed += 1
      else if (cp.status === 'done' && S(cp.completedAt) !== '') {
        const t = new Date(S(cp.completedAt))
        if (lastOkAt === null || t > lastOkAt) lastOkAt = t
      }
    } catch { failed += 1 }
  }
  return { running, failed, lastOkAt }
}

/**
 * 🔴 **관제가 보는 잠금.** 판정 정본은 러너와 같은 `collect-lock` 하나다.
 *
 *    처리기는 죽은 잠금을 **자동으로 회수하지 않는다**(뺏으면 두 회차가 같이 들어간다).
 *    그래서 남은 잠금은 조용히 풀리지 않고, 관제가 내지 않으면 공급이 멈춘 채로 남는다 —
 *    `stale` 은 **사람이 봐야 할 운영 이상**이다.
 */
function lockState(now: Date): 'free' | 'busy' | 'stale' {
  const p = join(DATA_DIR, LOCK_FILE)
  if (!existsSync(p)) return 'free'
  return processLockAnomaly(p, now.getTime(), LOCK_TTL_MS) !== null ? 'stale' : 'busy'
}

type QueueRow = {
  status: string; createdPostId: string | null
  promptVersion: string; model: string; gateResults: unknown
  rawContent: { sourceSite: string } | null
}

async function main(): Promise<void> {
  await loadEnvLocal()
  const now = new Date()

  /**
   * 🔴 **운영 판정은 `judgeSourceOperations` 하나가 한다** (2026-09-10 Codex 지적).
   *
   *    앞선 판은 supply:health 와 wave-c 가 각자 판정해 같은 시점에
   *    `HEALTHY / RUN_OK` 와 `BROKEN 0/4` 를 동시에 냈다.
   *    판정이 두 곳에 있으면 언젠가 갈린다 — 그래서 한 함수를 부른다.
   */
  const manifestSha = ((): { at: number | null } => {
    try {
      const m = JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8')) as { deployedAt?: string }
      return { at: m.deployedAt === undefined ? null : Date.parse(m.deployedAt) }
    } catch { return { at: null } }
  })()
  const OPS: Record<string, ReturnType<typeof judgeSourceOperations>> = {}
  for (const s of SOURCES) {
    if (s.onDemand === true) continue
    OPS[s.id] = judgeSourceOperations({
      sourceId: s.id,
      records: readRunRecords(s.id),
      slots: s.slots.map(([hour, minute]) => ({ hour, minute })),
      // 🔴 배포 기록이 없으면 아무 회차도 인정하지 않는다 — 언제부터인지 모른다
      since: manifestSha.at ?? Number.MAX_SAFE_INTEGER,
      now: now.getTime(),
      expected: s.slots.length,
      configuredPerDay: CONFIGURED_PER_DAY[s.id] ?? 0,
    })
  }

  // ── A. 수집원 ──
  const sources = SOURCES.map((s) => {
    const art = lastArtifact(s.filePrefix)
    const logs = logFacts(s.logName, art.at)
    // 🔴 job 이 방금 등록됐다면 첫 예정 시각이 아직 안 왔을 수 있다
    const label = s.id === '82cook' ? 'com.soransoran.raw-collect-82cook'
      : `com.soransoran.navercafe-collect-${s.id.replace('navercafe:', '')}`
    const registered = jobRegisteredAt(label)
    const firstScheduledAt = registered === null ? null : nextScheduled(s.slots, registered)
    return {
      sourceId: s.id,
      findings: judgeSource({
        sourceId: s.id, lastArtifactAt: art.at, lastArtifactRows: art.rows,
        leakedKeys: art.leaked, firstScheduledAt, logs,
        /**
         * 🔴 **공통 판정 결과를 그대로 넘긴다.** 여기서 다시 세지 않는다 —
         *    두 곳에서 세면 두 숫자가 갈린다(그것이 이번 모순이었다).
         */
        ops: OPS[s.id] ?? null,
        /**
         * 🔴 **남은 죽은 락은 회차 기록과 별개로 관측한다.**
         *    회차가 아예 못 돌아 기록이 없을 수도 있다 — 그때도 사람이 알아야 한다.
         */
        lockStale: s.onDemand === true ? null : lockAnomaly(LOCK_PATH, now.getTime(), LOCK_MAX_AGE_MS),
        // 🔴 그 source 의 실제 슬롯 간격에서 파생한다 — 상수를 쓰지 않는다
        now, staleAfterMs: staleAfterFromSlots(s.onDemand === true ? [] : s.slots),
      }),
    }
  })

  // ── B·C. DB 를 읽는다 (🔴 읽기만 한다) ──
  const { PrismaClient } = await import('@prisma/client')
  const prisma: PrismaClient = new PrismaClient()

  const rows: QueueRow[] = await prisma.originalPostApprovalQueue.findMany({
    select: {
      status: true, createdPostId: true, promptVersion: true, model: true,
      gateResults: true, rawContent: { select: { sourceSite: true } },
    },
  })
  const mapped = rows.map((r) => ({
    status: r.status, createdPostId: r.createdPostId,
    promptVersion: r.promptVersion, model: r.model,
    sourceSite: r.rawContent?.sourceSite ?? '', gateResults: r.gateResults,
  }))
  /**
   * 🔴 **여기서 판정하지 않는다** (2026-09-08, Codex P1).
   *    재고 판정은 **capacity 프로필**을 알아야 하고, 그 프로필은 준비도 시뮬레이션 뒤에 정해진다.
   *    예전에는 여기서 안전 상수(d1)로 먼저 판정하고 나중에 설정을 설치했다 —
   *    그래서 `capacity=d10` 인데 `numbers.target=14` · `level=HEALTHY` 인 모순이 나왔다.
   *    입력만 모아 두고, 판정은 규모가 확정된 뒤 ③-c 에서 한 번에 한다.
   */
  const live = mapped.filter((r) =>
    (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''))
  const cp = checkpoints()

  // ── C. 발행 ──
  const dayStart = kstDayStart(now)
  // 🔴 **cap 은 발행 러너와 같은 것을 센다.** 오늘 만들어진 모든 Post 를 세면
  //    사용자 글과 내려간 글까지 자동 발행 상한에 들어간다 — 사람이 5개 쓰면 cap 초과가 된다.
  //    러너가 보는 것은 페르소나 활동 기록이다.
  const todayCount = await prisma.personaActivityLog.count({
    where: { kind: 'post', createdAt: { gte: dayStart } },
  })

  // 🔴 정합은 **공용 정본**이 판단한다 — publish-live --check 와 같은 함수다
  const linked = await prisma.originalPostApprovalQueue.findMany({
    where: { OR: [{ status: 'PUBLISHED' }, { NOT: { createdPostId: null } }] },
    select: {
      id: true, status: true, createdPostId: true,
      matchedPersona: { select: { id: true } },
      promptVersion: true, model: true, gateResults: true,
      rawContent: { select: { sourceSite: true } },
    },
  })
  const linkedPostIds = linked.map((r) => S(r.createdPostId)).filter((x) => x !== '')
  const posts = linkedPostIds.length === 0 ? [] : await prisma.post.findMany({
    where: { id: { in: linkedPostIds } },
    select: {
      id: true, status: true, source: true, boardType: true, personaId: true, createdAt: true,
      isMicroSeed: true, permanentNoindex: true, indexPromotionBlocked: true,
      sourceUrl: true, sourceArticleId: true, sheetCandidateId: true,
    },
  })
  const postById = new Map(posts.map((p) => [p.id, p]))
  const logCounts = new Map<string, number>()
  for (const r of linked) {
    const pid = S(r.createdPostId)
    if (pid === '') continue
    logCounts.set(pid, await prisma.personaActivityLog.count({
      where: { personaId: r.matchedPersona?.id ?? '', kind: 'post', targetId: pid },
    }))
  }
  const verdict = verifyPublishedRows(linked.map((r) => {
    const pid = S(r.createdPostId)
    const post = pid === '' ? null : postById.get(pid) ?? null
    return {
      queueId: r.id, queueStatus: r.status, createdPostId: r.createdPostId,
      queuePersonaId: r.matchedPersona?.id ?? null,
      post: post === null ? null : {
        status: post.status, source: post.source, boardType: post.boardType,
        personaId: post.personaId,
        // 🔴 3축 판정은 post-visibility 정본 함수가 한다
        searchIndexable: isSearchIndexable(post), discoveryEligible: isDiscoveryEligible(post),
        sourceUrl: post.sourceUrl, sourceArticleId: post.sourceArticleId,
        sheetCandidateId: post.sheetCandidateId,
      },
      activityLogCount: logCounts.get(pid) ?? 0,
    }
  }))

  // 🔴 profile 은 발행 러너와 **같은 함수**로 본다
  const noProfile = linked.filter((r) => S(r.createdPostId) !== '' && queueProfileOf({
    promptVersion: r.promptVersion, model: r.model,
    sourceSite: r.rawContent?.sourceSite ?? '', gateResults: r.gateResults,
  }) === null)
  // 🔴 **오늘 나간 것만** 장애로 센다. 과거 기록까지 세면 매일 CRITICAL 이 뜨고,
  //    며칠이면 사람이 이 화면을 믿지 않게 된다
  const legacyPublishedToday = noProfile.filter((r) => {
    const p = postById.get(S(r.createdPostId))
    return p !== undefined && p.createdAt >= dayStart
  }).length
  const historicUnknownProfile = noProfile.length - legacyPublishedToday

  // 🔴 00:05 KST + 유예. cron 은 정시에 돌지 않는다 — 유예 없이 경고하면 거짓 경보다
  const scheduledPublishAt = new Date(dayStart.getTime() + 5 * 60_000)
  const graceUntil = new Date(scheduledPublishAt.getTime() + PUBLISH_GRACE_MS)
  // 🔴 발행 판정도 규모 확정 뒤로 미룬다 — 상한이 release 프로필에서 나온다

  // ── ③-b 발행 여력 — 🔴 재고가 있어도 사람이 없으면 나가지 못한다 ──
  //    러너와 **같은 함수**를 날짜만 밀어 가며 부른다. 새 판정을 만들지 않는다.
  const queueRows = await prisma.originalPostApprovalQueue.findMany({
    where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
    select: {
      id: true, status: true, createdPostId: true, gateVerdict: true, matchedAt: true,
      draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
      promptVersion: true, model: true, matchedPersonaId: true, gateResults: true,
      // 🔴 러너와 **같은 필드**를 읽는다 — compareAutoRow 가 decidedAt·createdAt 으로 정렬한다
      decidedAt: true, createdAt: true,
      // 🔴 freshness 근거도 러너와 같은 필드다. 없으면 나이를 모르므로 hold 로 간다
      rawContent: { select: { sourceSite: true, sourceCapturedAt: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  // 🔴 queueId → 원문 확인 시각. 러너의 `capturedAtOf` 와 같은 값이다
  const capturedAtOfHealth = new Map<string, Date | null>(
    queueRows.map((r) => [r.id, r.rawContent?.sourceCapturedAt ?? null]),
  )
  // 🔴 legacy 를 여기서 뺀다 — selectAutoTargets 가 발행 러너와 같은 기준으로 거른다
  const { targets: autoTargets } = selectAutoTargets(
    queueRows.map((r) => ({
      id: r.id, status: r.status, createdPostId: r.createdPostId,
      gateVerdict: r.gateVerdict, matchedAt: r.matchedAt,
      title: S(r.editedTitle) !== '' ? S(r.editedTitle) : S(r.draftTitle),
      body: S(r.editedBody) !== '' ? S(r.editedBody) : S(r.draftBody),
      promptVersion: r.promptVersion, model: r.model,
      matchedPersonaId: r.matchedPersonaId, gateResults: r.gateResults,
      decidedAt: r.decidedAt, createdAt: r.createdAt,
      sourceSite: r.rawContent?.sourceSite ?? '',
    })) as never,
    (t: string, b: string) => safetyFilter({ title: t, body: b }).verdict,
  )

  const personaRows = await prisma.persona.findMany({
    where: { status: 'active' },
    select: {
      id: true, code: true, status: true, identity: true, voiceCore: true, noGoTopics: true,
      user: { select: { providerId: true, _count: { select: { accounts: true } } } },
    },
  })
  const history: PersonaHistory[] = []
  const personas = []
  for (const r of personaRows) {
    const id = (r.identity ?? {}) as Record<string, unknown>
    const vc = (r.voiceCore ?? {}) as Record<string, unknown>
    const past = await prisma.originalPostApprovalQueue.findMany({
      where: { matchedPersona: { code: r.code }, NOT: { matchedAt: null } },
      select: { matchedAt: true },
    })
    const ats = past.map((x) => x.matchedAt as Date)
    history.push({ code: r.code, matchedAts: ats })
    // 🔴 매칭률 집계는 **지금 시점의 실제 여력**으로 봐야 한다.
    //    0 으로 넣으면 WEEKLY_CAP·TOO_SOON 이 한 번도 안 잡혀 생활사 비율이 100% 로 왜곡된다.
    const weekAgoNow = new Date(now.getTime() - 7 * 86_400_000)
    const usedNow = ats.filter((d) => d.getTime() >= weekAgoNow.getTime()).length
    const lastNow = ats.length === 0 ? null : ats.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
    personas.push({
      code: r.code, status: r.status, providerId: r.user?.providerId ?? null,
    // 🔴 실회원 판별 정본. 넘기지 않으면 hardFilter 가 fail-closed 로 막는다
    accountCount: r.user?._count.accounts ?? null,
      ageBand: typeof id.ageBand === 'string' ? id.ageBand : null,
      maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
      // 🔴 auto-publish 와 **같은 필드**를 넘긴다 — 빠지면 전원 무자녀로 판정된다 (#468)
      childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
      ...(Array.isArray(id.childrenAgeBands) ? { childrenAgeBands: id.childrenAgeBands as never } : {}),
      parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
      menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
      workStatus: null, economicStatus: null, region: null,
      noGoTopics: r.noGoTopics,
      voiceLength: typeof vc.length === 'string' ? vc.length : null,
      postsThisWeek: usedNow,
      daysSinceLastPost: lastNow === null ? null
        : Math.floor((now.getTime() - lastNow.getTime()) / 86_400_000),
    })
  }

  // 🔴 **이미 배정된 행은 기존 배정이 정본이다** — 러너와 같아야 한다.
  //    이것을 넘기지 않으면 예측이 그 행을 새로 매칭해 **다른 사람**에게 주고,
  //    화면이 보여준 필자와 실제로 나갈 필자가 달라진다.
  //    배정된 persona 를 못 찾으면 빈 값이 아니라 **모르는 코드**를 넘긴다 —
  //    forecast 가 fail-closed(RECOVERY_BROKEN)로 잡아야 하기 때문이다
  const codeOfPersonaId = new Map(personaRows.map((r) => [r.id, r.code]))
  /**
   * 🔴 **러너와 같은 준비 함수를 부른다** (2026-09-08).
   *
   *    예전에는 여기서 필터 전 Queue 를 그대로 세어 재고·예측·준비도를 냈다.
   *    러너만 freshness hold 를 적용하니 화면이 READY 라 적은 날 실제 발행이 모자랐다.
   *    자동 대상 id · hold 사유 · 순서가 이제 러너와 **글자 그대로 같다**.
   */
  const queueCandidates: QueueCandidate[] = autoTargets.map((t, i) => ({
    queueId: t.id, title: t.title, body: t.body, gateVerdict: t.gateVerdict, createdAt: i,
    assignedPersonaCode: t.matchedPersonaId === null
      ? null
      : (codeOfPersonaId.get(t.matchedPersonaId) ?? `__unknown:${t.matchedPersonaId}`),
    // 🔴 나이를 굳히지 않는다 — 예측이 매일 다시 잰다
    capturedAt: capturedAtOfHealth.get(t.id) ?? null,
  }))
  const prepared = prepareCandidates({ candidates: queueCandidates, personas: personas as never, at: now })
  /**
   * 🔴 **예측에는 거르지 않은 후보를 넘긴다.** 예측기가 날짜마다 나이를 다시 재고
   *    그날 hold 를 다시 판정한다 — 오늘 통과한 글이 8일 뒤에는 빠질 수 있다.
   */
  const forecastQueue = queueCandidates

  /**
   * ── ③-c 🔴 **규모를 여기서 확정한다.** 이 아래의 모든 판정이 이 값을 쓴다 ──
   *
   *    ① 지금 큐·지금 사람으로 각 단계가 14일을 버티는지 시뮬레이션하고
   *    ② 그 판정을 넘겨 release 를 실제로 낮춘다.
   *    🔴 준비도 지평은 **다음 KST 운영일 0시부터 완전한 하루 14일**이고 네 단계가 공유한다.
   *       다음 발행 슬롯을 시작점으로 쓰면 오늘 낸 몫 위에 그 단계의 하루 상한이 통째로
   *       다시 얹히고(d10 · 오늘 3건 → 오늘 13건), 단계마다 창이 달라 비교가 성립하지 않는다.
   */
  const scaleRows = simulateAllStages({
    queue: forecastQueue, personas: personas as never, history,
    // 🔴 러너와 **같은 시간축**이다 — 단계별 시작점은 lib 이 만든다
    axis: { now, publishedToday: todayCount }, days: 14,
  })
  const resolved = installFromEnv(process.env, { readiness: scaleRows.map((x) => x.verdict) })
  const capDerived = deriveProfile(resolved.capacityProfile)
  /** 🔴 내부 공급 기준 — capacity 프로필 */
  const CAPACITY_LIMITS = { warn: capDerived.stockWarn, min: capDerived.stockMin, target: capDerived.stockTarget }
  /** 🔴 공개 발행 기준 — release 프로필 */
  const RELEASE_DAILY_CAP = resolved.releaseProfile.dailyTarget
  const RELEASE_CAPS = {
    postsPerWeek: effectiveWeeklyCap(resolved.releaseProfile.postsPerWeek, resolved.releaseProfile.minDaysBetween),
    minDaysBetween: resolved.releaseProfile.minDaysBetween,
  }

  // ── ③-d 규모가 정해진 뒤에 판정한다 ──
  const stock = readStock(mapped, CAPACITY_LIMITS)
  const legacyExcluded = live.length - stock.usable
  const supply = judgeSupply({
    usable: stock.usable, human: stock.human, machine: stock.machine, legacyExcluded,
    pendingThin: pendingThinCount(), historicRawNoop: historicRawNoop(),
    runningCheckpoints: cp.running, failedCheckpoints: cp.failed,
    lock: lockState(now), lastSupplyOkAt: cp.lastOkAt, now, staleAfterMs: SUPPLY_STALE_MS,
    // 🔴 capacity 기준이다 — 모듈 안전 상수를 운영 숫자로 다시 쓰지 않는다
    stockMin: CAPACITY_LIMITS.min, stockTarget: CAPACITY_LIMITS.target,
  })
  const publish = judgePublish({
    todayCount, dailyCap: RELEASE_DAILY_CAP,
    afterPublishGrace: now.getTime() >= graceUntil.getTime(),
    mismatched: verdict.bad.length, legacyPublishedToday, historicUnknownProfile,
    candidates: stock.usable, now,
  })

  // 🔴 오늘 이미 상한을 채웠으면 다음 예약은 **내일** 00:05 KST 다
  const startAt = nextScheduleAt({ now, publishedToday: todayCount, dailyCap: RELEASE_DAILY_CAP })
  const fc = forecastPublishing({
    queue: forecastQueue,
    personas: personas as never, history, startAt, days: 14,
    dailyCap: RELEASE_DAILY_CAP, caps: RELEASE_CAPS,
  })

  // 🔴 매칭률은 **조합 단위**로 센다 — 후보 × persona. 사유 개수가 아니다.
  //    한 조합에 사유가 여러 개여도 한 번만 센다.
  const blockedCombos: string[][] = []
  {
    const { planBatch } = await import('../src/lib/original-post-persona-match')
    // 🔴 예측과 **같은 입력**이다. 여기서만 기존 배정을 빼면 두 수치가 갈린다
    const b = planBatch(forecastQueue, personas as never, RELEASE_CAPS)
    for (const a of b.assignments) {
      for (const x of a.blocked) blockedCombos.push(x.reasons.map((r) => r.code))
    }
  }
  const rates = blockRatesByCombination({
    candidates: autoTargets.length, personas: personas.length, blockedCombos,
  })
  const cap = capacityOf({
    activePersonas: personas.length, lifeBlockRate: rates.lifeRate, weeklyCap: RELEASE_CAPS.postsPerWeek,
  })
  const need = personasNeededFor({
    targetPerDay: RELEASE_DAILY_CAP, lifeBlockRate: rates.lifeRate, activePersonas: personas.length,
    weeklyCap: RELEASE_CAPS.postsPerWeek,
  })
  const capacity = judgeCapacity({
    stockUsable: stock.usable, in7: fc.in7, nextWillPublish: fc.nextScheduleWillPublish,
    nextCandidates: fc.nextPersonaCandidates.length, shortfallMin: need.shortfallMin,
    dailyCap: RELEASE_DAILY_CAP,
    // 🔴 기존 배정이 깨졌으면 이것 하나로 CRITICAL 이다 — 다른 수치는 의미를 잃는다
    recoveryBroken: fc.recoveryBroken,
  })

  await prisma.$disconnect()

  const report: HealthReport = buildReport({ sources, supply, publish: [...publish, ...capacity] })

  /**
   * 🔴 규모 설정 — **한 번만 계산해 화면과 JSON 이 같은 객체를 읽는다** (2026-09-08).
   *    설정(env)과 실제 달성 가능성이 어긋나면 여기서 감속 사유가 나온다.
   */
  // 🔴 규모는 위 ③-c 에서 이미 확정했다 — 여기서 다시 계산하지 않는다
  const scale = {
    capacityStage: resolved.capacityStage,
    releaseStage: resolved.releaseStage,
    requestedRelease: resolved.requestedRelease,
    throttledByCapacity: resolved.throttledByCapacity,
    notes: resolved.notes,
    summary: describeScale(resolved),
    throttledByReadiness: resolved.throttledByReadiness,
    readinessApplied: resolved.readinessApplied,
    /** 🔴 고른 단계가 실제로 달성 가능한가 — 화면 색은 이 값이 정한다 */
    chosenReady: resolved.chosenReady,
    /**
     * 🔴 **내부 공급은 capacity, 공개 발행은 release.**
     *    한 프로필로 둘을 다루면 `capacity=d10 · release=d1` 에서 재고 목표가 14가 된다.
     */
    capacity: {
      stockTarget: CAPACITY_LIMITS.target, stockMin: CAPACITY_LIMITS.min, stockWarn: CAPACITY_LIMITS.warn,
      internalDailyTarget: resolved.capacityProfile.dailyTarget,
    },
    release: {
      dailyCap: RELEASE_DAILY_CAP,
      weeklyCap: RELEASE_CAPS.postsPerWeek,
      minDaysBetween: RELEASE_CAPS.minDaysBetween,
    },
    // 🔴 설정과 러너 상수가 어긋났는가 — 어긋나면 화면이 말하는 값과 실제가 다르다
    /**
     * 🔴 설치된 release 와 **모듈 안전 상수**가 다른 것은 정상이다(주입이 그 일을 한다).
     *    문제가 되는 것은 설치가 아예 일어나지 않은 경우다 — 그때는 `source` 가 default 다.
     */
    configMismatch: resolved.source === 'default-safest'
      ? `규모 설정이 설치되지 않았다 — 안전 기본값(${DAILY_PUBLISH_CAP}/day)으로 돈다`
      : null,
    /**
     * 🔴 **프로필을 올려도 워크플로우가 그대로면 글은 안 나간다** — 그 어긋남을 여기서 본다.
     *    yml 을 못 읽는 경우도 사유로 남긴다(조용히 통과시키지 않는다).
     */
    workflowMismatch: (() => {
      const f = join(process.cwd(), '.github/workflows/auto-publish.yml')
      if (!existsSync(f)) return ['auto-publish.yml 을 찾지 못했다 — 스케줄을 확인할 수 없다']
      return compareWorkflow(resolved.releaseProfile, readFileSync(f, 'utf-8')).map((m) => m.detail)
    })(),
    slots: resolved.releaseProfile.slots.map((x) => slotLabel(x)),
    /** 🔴 무엇이 채워지면 올라가는가 — 감속 조건은 이 표의 뒤집음이다 */
    promotion: promotionPlan(scaleRows),
    highestReady: highestReady(scaleRows),
    /** 🔴 네 단계가 **같은 창**을 봤는가 — 하나라도 다르면 단계 비교가 성립하지 않는다 */
    horizon: {
      startKst: kstStamp(scaleRows[0]!.sim.horizonStartAt),
      days: scaleRows[0]!.sim.horizonDays,
      mismatches: horizonMismatches(scaleRows),
    },
    stages: scaleRows.map(({ sim, verdict }) => ({
      stage: sim.stage, dailyTarget: PROFILES[sim.stage].dailyTarget,
      in14: sim.in14, want14: sim.want14, gaps: sim.gaps, recoveryBroken: sim.recoveryBroken,
      ready: verdict.ready, reasons: verdict.reasons,
      personasNeededArithmetic: verdict.arithmeticPersonas,
      // 🔴 준비도 창과 **다음 발행 슬롯은 다른 값**이다. 둘을 같이 보여 준다
      nextSlotKst: kstStamp(sim.nextSlotAt),
    })),
  }

  /**
   * ── 🔴 **수집 보호장치와 수집 준비도** (2026-09-08) ──
   *
   *    ① 소스마다 예산·차단기가 지금 어떤 상태인가 (상태 파일 read-only)
   *    ② 다회 계획의 **유효 처리량**(성공률 반영)이 필요량을 여유 30% 까지 포함해 넘는가
   *    🔴 하나라도 막히면 BLOCKED 다. "두 소스는 괜찮다" 는 준비 완료가 아니다.
   */
  const collect = (() => {
    const guards: Partial<Record<SourceId, GuardState>> = {}
    const snapshots: ReturnType<typeof guardSnapshot>[] = []
    for (const f of SOURCE_FACTS) {
      const path = guardPath(f.id)
      if (!existsSync(path)) continue
      try {
        const st = rollBudgetDay(JSON.parse(readFileSync(path, 'utf-8')) as GuardState, kstDayOf(now))
        guards[f.id] = st
        snapshots.push(guardSnapshot(st, now.getTime()))
      } catch {
        // 🔴 읽지 못한 상태를 "정상" 으로 세지 않는다 — 아래 준비도가 보호장치 없음으로 잡는다
      }
    }
    // 🔴 내부 공급 목표는 **capacity 프로필의 하루 목표**다. 공개 발행량(release)이 아니고,
    //    문서에 적힌 100/day 같은 최대 시나리오도 아니다 — 지금 설정된 값으로 판정한다
    const plan = planSupply(resolved.capacityProfile)
    /**
     * 🔴 **등록 상태는 관측에서만 나온다** — 코드의 `loaded: true` 를 쓰지 않는다.
     *    관측에 실패하면 "없다" 가 아니라 **모른다**로 남겨 준비도가 BLOCKED 로 떨어진다.
     */
    const { observed, problem: observeProblem } = observeJobsSafe()
    // 🔴 한 번만 센다 — 같은 판정을 두 번 부르면 두 값이 갈릴 자리가 생긴다
    const startReadiness = collectReadiness({
      phase: 'start', plan, nowMs: now.getTime(), observed, guards,
    })
    const cur = currentCapacity(observed)
    const prep = preparedCapacity('start')
    return {
      internalDailyTarget: plan.queuePerDay,
      guards: snapshots,
      guardsMissing: SOURCE_FACTS.filter((f) => guards[f.id] === undefined).map((f) => f.id),
      observeProblem,
      // 🔴 셋을 **따로** 낸다. 합치면 "템플릿을 만들었으니 능력이 늘었다" 가 된다
      capacity: {
        configuredPerDay: cur.effectivePerDay,
        preparedPerDay: prep.effectivePerDay,
        requiredPerDay: plan.detailPerDay,
        perSource: cur.perSource,
        summary: describeInventory(observed, 'start'),
      },
      start: startReadiness,
      stable: collectReadiness({ phase: 'stable', plan, nowMs: now.getTime(), observed, guards }),
      /**
       * 🔴 **등록만으로 READY 를 내지 않는다.**
       *    설정 준비도(job 이 올라와 있는가)와 운영 준비도(그 job 이 실제로 도는가)를
       *    나눈다 — 앞선 판은 8회 연속 죽은 job 을 두고도 설정만 보고 판정했다.
       *    🔴 `collectReadiness` 를 다시 부르지 않는다 — 같은 값을 두 번 세지 않는다.
       */
      operational: judgeOperationalReadiness({
        configurationReady: startReadiness.status === 'READY',
        configurationReasons: [],
        perSource: Object.values(OPS),
      }),
    }
  })()

  if (JSON_OUT) {
    console.log(JSON.stringify({
      level: report.level, checkedAt: now.toISOString(),
      sources: report.sources, supply: report.supply, publish: report.publish, rollUp: report.rollUp,
      // 🔴 화면 ⑤ 와 같은 객체다 — 두 번 계산하지 않는다
      scale,
      // 🔴 화면 ④-b 와 같은 객체다 — 보호장치 상태와 수집 준비도
      collect,
      // 🔴 화면 ④-c 와 같은 값이다 — 러너가 세는 것과 같은 자동 대상·hold
      candidates: {
        auto: prepared.auto.map((c) => c.queueId),
        held: prepared.held,
        summary: describePrepared(prepared),
      },
      numbers: {
        stock: stock.usable, human: stock.human, machine: stock.machine, legacyExcluded,
        // 🔴 적용값이다 — 재고 목표는 capacity, 발행 상한은 release
        target: CAPACITY_LIMITS.target, todayPublished: todayCount, dailyCap: RELEASE_DAILY_CAP,
      },
      // 🔴 화면과 같은 결과다 — 두 번 계산하지 않는다
      capacity: {
        nextScheduleAtKst: kstStamp(startAt),
        nextQueueId: fc.nextQueueId,
        nextPersonaCandidates: fc.nextPersonaCandidates,
        nextScheduleWillPublish: fc.nextScheduleWillPublish,
        in7: fc.in7, in14: fc.in14,
        gapDates7: fc.gapDates7, gapDates14: fc.gapDates14,
        nextBlockReason: fc.nextBlockReason,
        days: fc.days.map((d) => ({
          date: d.date,
          // 🔴 배열이다 — dailyCap 이 2 이상이면 하루에 여러 건이 나간다
          published: d.published,
          blocked: d.blockedReason, blockedQueueId: d.blockedQueueId,
          available: d.availableCodes,
        })),
        theoreticalPerWeek: cap.theoreticalPerWeek,
        theoreticalPerDay: cap.theoreticalPerDay,
        effectivePerDay: cap.effectivePerDay,
        activePersonas: personas.length,
        personasNeeded: { min: need.min, max: need.max },
        shortfall: { min: need.shortfallMin, max: need.shortfallMax },
        // 🔴 조합 단위 — 사유 개수가 아니다
        combinations: {
          total: rates.total, eligible: rates.eligible,
          lifeBlocked: rates.lifeBlocked, capacityBlocked: rates.capacityBlocked,
          lifeRate: rates.lifeRate, capacityRate: rates.capacityRate,
        },
        autoCandidates: autoTargets.length,
      },
    }, null, 2))
    process.exit(report.exitCode)
  }

  const mark = (x: Finding): string =>
    x.level === 'CRITICAL' ? '🔴' : x.level === 'WARNING' ? '🟡' : x.level === 'INFO' ? '·' : '🟢'

  console.log(`\n══ 콘텐츠 공급 관제 — ${report.level} ══\n`)
  console.log('  🔴 read-only — DB write 0 · 네트워크 0 · LLM 0 · 수집 0 · 발행 0\n')

  console.log('① 수집원')
  for (const s of report.sources) {
    for (const x of s.findings) console.log(`   ${mark(x)} ${x.message}`)
  }
  for (const x of report.rollUp) console.log(`   ${mark(x)} ${x.message}`)

  console.log('\n② 공급')
  for (const x of report.supply) console.log(`   ${mark(x)} ${x.message}`)

  console.log('\n③ 발행')
  for (const x of report.publish) console.log(`   ${mark(x)} ${x.message}`)

  console.log('\n③-b 발행 여력 (KST 기준)')
  const REASON_LABEL: Record<string, string> = {
    NONE: '', DAILY_CAP_DONE: '오늘 상한을 채웠다',
    LIFE_BLOCKED: '🔴 생활사로 영구 매칭 불가 — persona 를 늘려야 풀린다',
    CAPACITY_WAIT: '🟡 맞는 persona 는 있으나 cap·간격으로 일시 대기',
    BATCH_EXHAUSTED: '🟡 배치 배정에서 여력이 소진됨',
    NO_CANDIDATE: '🔴 후보가 없다',
  }
  console.log(`   다음 예약     ${kstStamp(startAt)}`)
  console.log(`   다음 대상     ${fc.nextQueueId ?? '(없음)'}`)
  console.log(`   배정 가능     ${fc.nextPersonaCandidates.length}명`
    + `${fc.nextPersonaCandidates.length > 0 ? ` (${fc.nextPersonaCandidates.join(' ')})` : ''}`)
  console.log(`   다음 예약 발행 ${fc.nextScheduleWillPublish ? '🟢 가능' : '🔴 불가'}`
    + `${fc.nextScheduleWillPublish ? '' : ` — ${REASON_LABEL[fc.nextBlockReason] ?? fc.nextBlockReason}`}`)
  console.log(`   향후 7일      ${fc.in7}건 · 공백 ${fc.gapDates7.length}일`
    + `${fc.gapDates7.length > 0 ? ` (${fc.gapDates7.join(' ')})` : ''}`)
  console.log(`   향후 14일     ${fc.in14}건`)
  console.log(`   이론 capacity ${cap.theoreticalPerWeek}건/주 = ${cap.theoreticalPerDay.toFixed(2)}/day`
    + ` · 실매칭 반영 ${cap.effectivePerDay.toFixed(2)}/day`)
  console.log(`   목표 ${RELEASE_DAILY_CAP}/day 에 필요한 persona ${need.min}~${need.max}명`
    + ` · 현재 ${personas.length}명 · 부족 ${need.shortfallMin}~${need.shortfallMax}명`)
  console.log(`   매칭 조합     후보 ${autoTargets.length} × persona ${personas.length} = ${rates.total}개`)
  console.log(`     가능        ${rates.eligible}개`)
  console.log(`     생활사 영구  ${rates.lifeBlocked}개 (${(rates.lifeRate * 100).toFixed(1)}%)`)
  console.log(`     cap·간격 임시 ${rates.capacityBlocked}개 (${(rates.capacityRate * 100).toFixed(1)}%)`)
  console.log('   🔴 표본이 작다 — persona 권장 수는 범위로 읽는다')
  for (const d of fc.days.slice(0, 7)) {
    const who = d.published.length === 0 ? '—' : d.published.map((x) => x.persona).join(' ')
    const why = d.published.length > 0 ? ''
      : `  ${REASON_LABEL[d.blockedReason] ?? d.blockedReason}`
        + `${d.blockedQueueId === null ? '' : ` (${d.blockedQueueId.slice(0, 12)})`}`
    console.log(`     ${d.date}  ${who}${why}`)
  }

  // ── ④ 🔴 규모 설정 — JSON `scale` 과 **같은 객체**를 읽는다 ──
  console.log('\n④ 규모 설정')
  console.log(`   ${scale.summary} · 슬롯 ${scale.slots.join(' ')}`)
  console.log(`   내부 공급(capacity ${scale.capacityStage})  재고 목표 ${scale.capacity.stockTarget}건`
    + ` · 최소 ${scale.capacity.stockMin} · 경고 ${scale.capacity.stockWarn}`)
  console.log(`   공개 발행(release ${scale.releaseStage})   일 ${scale.release.dailyCap}건`
    + ` · 주 ${scale.release.weeklyCap}건 · 최소 ${scale.release.minDaysBetween}일`)
  for (const n of scale.notes) console.log(`   · ${n}`)
  if (scale.configMismatch !== null) console.log(`   🔴 설정 불일치 — ${scale.configMismatch}`)
  for (const m of scale.workflowMismatch) console.log(`   🔴 워크플로우 불일치 — ${m}`)
  for (const r of scale.stages) {
    console.log(`   ${r.ready ? '🟢' : '🔴'} ${r.stage.padEnd(4)} ${String(r.dailyTarget).padStart(3)}/day`
      + ` → 14일 ${r.in14}/${r.want14} · 공백 ${r.gaps}일`
      + `${r.ready ? '' : `  ${r.reasons[0] ?? ''}`}`)
  }
  if (scale.throttledByReadiness) {
    // 🔴 표시가 아니라 **실제로 적용된 값**이다 — 러너가 쓰는 상한이 아래 숫자다
    console.log(`   🔴 자동 감속 적용됨 — 요청 ${scale.requestedRelease} → 실제 ${scale.releaseStage}`
      + ` (공개 ${scale.release.dailyCap}건/day)`)
  } else if (!scale.readinessApplied) {
    console.log('   🟡 준비도 판정이 없어 감속이 적용되지 않았다')
  } else if (!scale.chosenReady) {
    // 🔴 더 내려갈 곳이 없어 감속은 안 됐지만 **그 단계도 미달**이다. 초록으로 쓰지 않는다
    console.log(`   🔴 NOT_READY — ${scale.releaseStage} 를 유지하지만 그 단계도 지금 큐·인원으로는 미달이다`)
  } else {
    console.log(`   🟢 ${scale.releaseStage} 는 지금 큐·인원으로 달성 가능하다`)
  }
  console.log('   🔴 산술 인원은 참고값이다 — 판정은 위 14일 실측이 한다')
  // 🔴 **승격·감속 조건** — 무엇을 채우면 올라가는지 숫자로 적는다
  console.log(`   지금 올릴 수 있는 최고 단계: ${scale.highestReady ?? '없음'}`)
  for (const pl of scale.promotion) {
    if (pl.ready) { console.log(`     🟢 ${pl.stage.padEnd(4)} 승격 가능`); continue }
    console.log(`     🔴 ${pl.stage.padEnd(4)} 승격 조건 — ${pl.missing.join(' · ')}`)
  }
  console.log('   🔴 감속 조건은 같은 표의 뒤집음이다 — ready 였던 단계가 아니게 되면 내려간다')
  console.log(`   준비도 지평 ${scale.horizon.startKst} 부터 ${scale.horizon.days}일 — 네 단계가 같은 창을 본다`)
  for (const m of scale.horizon.mismatches) console.log(`   🔴 지평 불일치 — ${m}`)

  // ── ④-b 🔴 수집 보호장치와 수집 준비도 — JSON `collect` 와 **같은 객체**를 읽는다 ──
  console.log('\n④-b 수집 보호장치 · 준비도')
  if (collect.guards.length === 0) {
    console.log('   ⚪ 보호장치 상태 파일이 아직 없다 — 다회 수집이 한 번도 돌지 않았다는 뜻이다')
  }
  for (const g of collect.guards) {
    const open = g.breakers.filter((b) => b.status !== 'closed')
    console.log(`   ${g.healthy ? '🟢' : '🔴'} ${g.source}  예산 ${g.budget.used}/${g.budget.limit}`
      + ` · 차단기 ${open.length === 0 ? '전부 closed' : open.map((b) => `${b.cls}:${b.status}`).join(' · ')}`)
  }
  if (collect.guardsMissing.length > 0) {
    console.log(`   🔴 보호장치 상태 없음: ${collect.guardsMissing.join(' · ')}`)
  }
  if (collect.observeProblem !== null) console.log(`   🔴 ${collect.observeProblem}`)
  // 🔴 **현재 · 준비 · 필요를 한 줄에 나란히** 적는다. 합치지 않는다
  console.log(`   수집 능력  설정 ${Math.round(collect.capacity.configuredPerDay)}건/day`
    + ` · 준비 ${Math.round(collect.capacity.preparedPerDay)}건/day`
    + ` · 필요 ${collect.capacity.requiredPerDay}건/day`)
  for (const s2 of collect.capacity.perSource) {
    console.log(`      ${s2.registered ? '🟢' : '⚪'} ${s2.id}  ${s2.label ?? '미등록'}`
      + ` · ${s2.runsPerDay}회/day(${s2.kind ?? '—'}) → ${Math.round(s2.effectivePerDay)}건`)
  }
  for (const m of collect.start.mismatches) console.log(`   🔴 ${m.code} — ${m.detail}`)
  for (const phase of [collect.start, collect.stable]) {
    console.log(`   [${phase.phase}] ${phase.status === 'READY' ? '🟢 READY' : '🔴 BLOCKED'}`
      + ` — 설정 ${Math.round(phase.configuredPerDay)} · 준비 ${Math.round(phase.preparedPerDay)}`
      + ` · 필요 ${phase.requiredPerDay} · 여유 기준 ${phase.requiredWithMargin}`
      + ` (이론 ${phase.theoreticalPerDay})`)
    for (const r of phase.reasons) console.log(`      🔴 ${r}`)
  }
  console.log('   🔴 이론 최대가 아니라 성공률을 곱한 유효 처리량으로 판정한다')
  console.log('   🔴 템플릿이 있다는 것은 "준비" 다. "현재" 는 launchctl 에 올라온 것만 센다')

  // ── ④-c 🔴 freshness — **러너·예측·준비도가 같은 목록을 센다** ──
  console.log('\n④-c 발행 후보 준비 (러너와 같은 함수)')
  console.log(`   ${describePrepared(prepared)}`)
  for (const h of prepared.held) console.log(`   ⏸️  ${h.queueId}  [${h.hold}] ${h.reason}`)
  console.log('   🔴 hold 는 자동 발행에서만 빠진다 — 큐에 그대로 있고 삭제·재배정하지 않는다')

  console.log(`\n⑤ 판정 ${report.level}${report.exitCode === 1 ? ' — exit 1' : ''}`)
  console.log('   🔴 CRITICAL 만 exit 1 이다. WARNING 은 사람이 보고 판단한다\n')
  process.exit(report.exitCode)
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
