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
import { readStock, queueProfileOf } from '../src/lib/micro-seed-supply-autofill'
import { LOCK_FILE, LOCK_TTL_MS, RUN_FILE_RE, adaptKeyOf } from '../src/lib/supply-process'
// 🔴 완료 판정은 러너·어댑터와 **같은 함수**를 쓴다. 여기서 정규식을 다시 쓰지 않는다
import { completedAdaptKeys } from '../src/lib/micro-seed-82cook-thin-adapt'
/** 🔴 잠금 판정 정본 하나 — 관제도 러너와 같은 함수로 본다 */
import { lockAnomaly as processLockAnomaly } from './lib/collect-lock.mjs'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'
import { describeScale } from '../src/lib/scale-runtime'
import { minuteOfDay, slotLabel } from '../src/lib/scale-profile'
import { SOURCE_FACTS, THIN_82COOK_SLOTS, planSlots, type SourceId, type Phase } from '../src/lib/collect-schedule'

/** 🔴 지금 운영 중인 단계. 시각 정본이 단계별 표를 갖고 있으므로 어느 단계인지 한 번만 적는다 */
const COLLECT_PHASE: Phase = 'start'

/** 🔴 예약이 올라와 있지 않아 판정에서 뺀 레인 — **조용히 빼지 않고 화면에 적는다** */
const NOT_REGISTERED: SourceId[] = []
import { guardSnapshot, rollBudgetDay, type GuardState } from '../src/lib/collect-guard'
import { guardPath, kstDayOf } from './lib/collect-guard-store.mjs'
import { planSupply, collectReadiness } from '../src/lib/scale-supply-plan'
import { currentCapacity, preparedCapacity, describeInventory } from '../src/lib/collect-inventory'
import { observeJobsSafe } from './lib/launchd-observe.mjs'
import { describePrepared } from '../src/lib/supply-candidates'
import { retiredPublishWorkflowProblems } from '../src/lib/scale-workflow-render'
import { nextScheduleAt, kstStamp } from '../src/lib/supply-capacity-forecast'
import { loadStockClassification, describeStockClassification, jitCoverageOf } from './lib/publishable-stock.mjs'
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
 *
 * 🔴 **슬롯을 여기 적지 않는다** (2026-09-13 정정).
 *
 *    옛 판은 네이버 두 카페의 슬롯을 손으로 적어 두고 있었다 —
 *    `remonterrace [[4,20],[10,20],[16,20],[22,20]]` · `wgang [[2,50],[8,50],[14,50],[20,50]]`.
 *    실제로 도는 시각은 `remonterrace 07:30·10:30·13:30·16:30·21:30`(5회) ·
 *    `wgang 09:30·11:30·15:30·20:30`(4회) 다. **한 자리도 맞지 않았다.**
 *    그래서 관제는 "돌아야 할 시각" 을 틀리게 알고 있었고,
 *    2026-09-11~12 24시간 관측에서 82cook 6회 실패를 화면이 잡지 못했다.
 *
 *    시각 정본은 `collect-schedule.ts` 의 `SLOTS` 하나다. 여기서는 파생만 한다.
 *
 * 🔴 **`onDemand` 는 실측이다** (2026-09-13 정정).
 *    옛 판은 82cook 얇은 상세를 "아직 등록 안 됨" 으로 못박아 두고 stale 판정에서
 *    통째로 건너뛰었다(`continue`). 그 job 은 2026-09-11 에 등록돼 5회/day 로 돌고 있다.
 *    등록 여부를 상수로 적으면 등록한 날 관제가 눈을 감는다 —
 *    **plist 존재를 실제로 본다.**
 */
const SOURCES: {
  id: SourceId; filePrefix: string; logName: string; slots: [number, number][]
}[] = [
  {
    id: '82cook', filePrefix: '82cook-thin-', logName: 'supply-collect-82cook-thin',
    // 🔴 목록 슬롯의 40분 뒤 — 정본이 그렇게 파생시킨다
    slots: THIN_82COOK_SLOTS.map((x) => [x.hour, x.minute] as [number, number]),
  },
  {
    id: 'navercafe:remonterrace', filePrefix: 'navercafe-thin-remonterrace-',
    logName: 'navercafe-collect-remonterrace-multi',
    slots: planSlots('navercafe:remonterrace', COLLECT_PHASE).map((x) => [x.hour, x.minute] as [number, number]),
  },
  {
    id: 'navercafe:wgang', filePrefix: 'navercafe-thin-wgang-',
    logName: 'navercafe-collect-wgang-multi',
    slots: planSlots('navercafe:wgang', COLLECT_PHASE).map((x) => [x.hour, x.minute] as [number, number]),
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

/** 🔴 job 이름 → launchd label. 한 줄이지만 두 곳이 각자 지으면 갈라진다 */
const labelOf = (logName: string): string => `com.soransoran.${logName}`

/** job 이 등록된 시각 — plist mtime. 없으면 null(등록 안 됨) */
function jobRegisteredAt(label: string): Date | null {
  const p = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
  return existsSync(p) ? statSync(p).mtime : null
}

/**
 * 아직 adapt 되지 않은 얇은 파일 수 — 🔴 **공급 러너와 같은 함수로 센다.**
 *
 * 🔴 옛 판은 `/^82cook-adapt-(.+?)\./` 정규식을 여기서 다시 썼다.
 *    그 정규식은 `detail` 한쪽만 있어도 "완료" 로 봤다 — 2026-09-11 Codex 리뷰가
 *    러너 쪽에서 같은 결함을 잡아 `completedAdaptKeys` 로 고쳤는데,
 *    관제는 옛 판정을 그대로 들고 있어서 **러너는 밀렸다고 보는 것을 관제는 끝났다고 봤다.**
 */
function pendingThinCount(): number {
  const files = dataFiles()
  const done = completedAdaptKeys(files)
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
    // 🔴 **등록되지 않은 job 의 슬롯으로 "왜 안 도느냐" 를 묻지 않는다.**
    //    다만 등록 여부는 상수가 아니라 plist 실측이다 — 등록한 날 눈을 감지 않게.
    if (jobRegisteredAt(labelOf(s.logName)) === null) {
      NOT_REGISTERED.push(s.id)
      continue
    }
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
    /**
     * 🔴 job 이 방금 등록됐다면 첫 예정 시각이 아직 안 왔을 수 있다.
     *
     * 🔴 **그 레인 자신의 job 을 본다** (2026-09-13 정정).
     *    옛 판은 82cook **얇은 상세** 레인의 등록 여부를 `raw-collect-82cook`(목록 job)
     *    의 plist 로 물었다. 둘은 다른 job 이고 다른 날 등록됐다 —
     *    한쪽이 죽어도 다른 쪽 plist 가 있으면 "등록됨" 으로 보였다.
     */
    const registered = jobRegisteredAt(labelOf(s.logName))
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
        lockStale: registered ? lockAnomaly(LOCK_PATH, now.getTime(), LOCK_MAX_AGE_MS) : null,
        // 🔴 그 source 의 실제 슬롯 간격에서 파생한다 — 상수를 쓰지 않는다
        now, staleAfterMs: staleAfterFromSlots(registered ? s.slots : []),
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

  /**
   * ── ③-b 🔴 **발행 러너와 같은 조립 · 같은 판정** (2026-09-30 · source-slot-v1) ──
   *    앞판은 여기서 Queue · Persona 를 **따로** 조립했다(`matchedAt` 이력 · workStatus 등 null · window 무시) —
   *    러너와 다른 입력으로 재고(21) · 예측(14일) · 필요 인원 · 14일 준비도를 따로 판정했다(A2 P5 · 2.2).
   *    🔴 이제 **러너와 같은 함수**(`loadStockClassification` → 정본 `judgeSlotRelease` · `planPublishBatch`)와
   *       **공급 러너와 같은 JIT 수요**(`jitCoverageOf`)만 보여 준다. 여기서 판정을 새로 만들지 않는다.
   *    🔴 지운 옛 화면: `forecastPublishing` 14일 예측 · `judgeCapacity` · `personasNeededFor` · `simulateAllStages`
   *       14일 준비도 · 승격 표(`promotionPlan`) · 재고 눈금(capacity ×14 · ×5 · ×3).
   */
  const view = await loadStockClassification(prisma, process.env, now)
  const resolved = view.resolved.scale
  const prepared = view.plan.prepared
  const jit = jitCoverageOf(view, now)
  const RELEASE_DAILY_CAP = resolved.releaseProfile.dailyTarget
  const RELEASE_CAPS = view.resolved.caps

  /**
   * 🔴 **오늘의 첫 발행 예정 시각 + 유예.** 기준은 지금 적용된 profile 의 **가장 이른 슬롯**이다.
   */
  const firstSlotMin = Math.min(
    ...resolved.releaseProfile.slots.map(minuteOfDay),
  )
  const scheduledPublishAt = new Date(dayStart.getTime() + firstSlotMin * 60_000)
  const graceUntil = new Date(scheduledPublishAt.getTime() + PUBLISH_GRACE_MS)

  // ── ③-d 판정 — 🔴 재고 눈금이 아니라 **다가오는 슬롯을 eligible READY 가 덮는가** 다 ──
  const stock = readStock(mapped)
  const legacyExcluded = live.length - stock.usable
  const supply = judgeSupply({
    // 🔴 공급 러너와 같은 JIT 수요 재료(`jitCoverageOf`) — 완성 글 재고 눈금 없음
    jit, human: stock.human, machine: stock.machine, legacyExcluded,
    pendingThin: pendingThinCount(), historicRawNoop: historicRawNoop(),
    runningCheckpoints: cp.running, failedCheckpoints: cp.failed,
    lock: lockState(now), lastSupplyOkAt: cp.lastOkAt, now, staleAfterMs: SUPPLY_STALE_MS,
  })
  const publish = judgePublish({
    todayCount, dailyCap: RELEASE_DAILY_CAP,
    afterPublishGrace: now.getTime() >= graceUntil.getTime(),
    // 🔴 연결이 깨진 행만 CRITICAL 이다 — 숨겨진 글은 따로 센다
    mismatched: verdict.bad.length, hiddenPost: verdict.hiddenPost.length,
    legacyPublishedToday, historicUnknownProfile,
    candidates: view.classification.counts.publishableNow,
    recoveryBroken: view.plan.brokenRecovery, now,
  })
  const startAt = nextScheduleAt({ now, publishedToday: todayCount, profile: resolved.releaseProfile })

  await prisma.$disconnect()

  const report: HealthReport = buildReport({ sources, supply, publish })

  /**
   * 🔴 규모 설정 — **한 번만 계산해 화면과 JSON 이 같은 객체를 읽는다.** 단계는 결정(env) 그대로다.
   */
  const scale = {
    capacityStage: resolved.capacityStage,
    releaseStage: resolved.releaseStage,
    requestedRelease: resolved.requestedRelease,
    throttledByCapacity: resolved.throttledByCapacity,
    notes: resolved.notes,
    summary: describeScale(resolved),
    release: {
      dailyCap: RELEASE_DAILY_CAP,
      weeklyCap: RELEASE_CAPS.postsPerWeek,
      minDaysBetween: RELEASE_CAPS.minDaysBetween,
    },
    configMismatch: resolved.source === 'default-safest'
      ? `규모 설정이 설치되지 않았다 — 안전 기본값(${DAILY_PUBLISH_CAP}/day)으로 돈다`
      : null,
    /**
     * 🔴 **발행 예약의 정본은 launchd 러너 하나다** (2026-09-30 · 단일 실행 authority).
     *    GitHub 발행 워크플로에 예약이 되살아나면 두 번째 schedule owner 다 — 그것을 불일치로 적는다.
     *    (앞판은 yml 이 모든 단계 슬롯의 합집합인지 견줬다 — GitHub 이 발행하던 시절의 계약이다.)
     */
    workflowMismatch: (() => {
      const f = join(process.cwd(), '.github/workflows/auto-publish.yml')
      if (!existsSync(f)) return []
      return retiredPublishWorkflowProblems(readFileSync(f, 'utf-8'))
    })(),
    slots: resolved.releaseProfile.slots.map((x) => slotLabel(x)),
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
      // 🔴 화면 ④-c 와 같은 값이다 — 러너가 세는 것과 같은 자동 대상 · 판정 제외(source-slot-v1)
      candidates: {
        auto: prepared.auto.map((c) => c.queueId),
        held: prepared.held,
        summary: describePrepared(prepared),
      },
      /** 🔴 공급 러너와 같은 JIT 수요 재료 — 다가오는 슬롯 · eligible READY 가 덮은 슬롯 */
      jit: { ...jit, demand: Math.max(0, jit.slots - jit.readyFilled), nextScheduleAtKst: kstStamp(startAt) },
      numbers: {
        formatRows: stock.usable, human: stock.human, machine: stock.machine, legacyExcluded,
        publishableNow: view.classification.counts.publishableNow,
        todayPublished: todayCount, dailyCap: RELEASE_DAILY_CAP,
      },
      classification: view.classification.counts,
    }, null, 2))
    process.exit(report.exitCode)
  }

  const mark = (x: Finding): string =>
    x.level === 'CRITICAL' ? '🔴' : x.level === 'WARNING' ? '🟡' : x.level === 'INFO' ? '·' : '🟢'

  console.log(`\n══ 콘텐츠 공급 관제 — ${report.level} ══\n`)
  console.log('  🔴 read-only — DB write 0 · 네트워크 0 · LLM 0 · 수집 0 · 발행 0\n')

  console.log('① 수집원')
  // 🔴 **판정에서 뺀 레인을 조용히 빼지 않는다.** 안 보이면 "정상" 으로 읽힌다
  for (const id of NOT_REGISTERED) {
    console.log(`   🟡 ${id} — 예약 job 이 등록돼 있지 않다. 슬롯 판정에서 뺐다`)
  }
  for (const s of report.sources) {
    for (const x of s.findings) console.log(`   ${mark(x)} ${x.message}`)
  }
  for (const x of report.rollUp) console.log(`   ${mark(x)} ${x.message}`)

  console.log('\n② 공급')
  for (const x of report.supply) console.log(`   ${mark(x)} ${x.message}`)

  console.log('\n③ 발행')
  for (const x of report.publish) console.log(`   ${mark(x)} ${x.message}`)

  console.log('\n③-b 다가오는 슬롯 (JIT — 공급 러너와 같은 함수)')
  console.log(`   다음 예약     ${kstStamp(startAt)}`)
  console.log(`   다가오는 슬롯 ${jit.slots}개 (오늘 남은 + 다음 증명일 전체) · eligible READY 가 덮은 슬롯 ${jit.readyFilled}개`)
  console.log(`   생성 수요     ${Math.max(0, jit.slots - jit.readyFilled)}건 — 🔴 완성 글 재고 목표(700 · ×14)는 없다`)
  for (const line of describeStockClassification(view.classification)) console.log(`   ${line}`)

  // ── ④ 🔴 규모 설정 — JSON `scale` 과 **같은 객체**를 읽는다 ──
  console.log('\n④ 규모 설정')
  console.log(`   ${scale.summary} · 슬롯 ${scale.slots.join(' ')}`)
  console.log(`   준비 단계(다음 증명 ${scale.capacityStage}) — 공급 수요(JIT) 눈금`)
  console.log(`   공개 발행(release ${scale.releaseStage})   일 ${scale.release.dailyCap}건`
    + ` · 주 ${scale.release.weeklyCap}건 · 최소 ${scale.release.minDaysBetween}일`)
  for (const n of scale.notes) console.log(`   · ${n}`)
  if (scale.configMismatch !== null) console.log(`   🔴 설정 불일치 — ${scale.configMismatch}`)
  for (const m of scale.workflowMismatch) console.log(`   🔴 워크플로우 불일치 — ${m}`)
  console.log('   🔴 단계는 StageDecision(consumer env) 그대로다 — 이 화면은 준비도로 단계를 다시 판정하지 않는다')

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

  // ── ④-c 🔴 공개 판정 — **러너와 같은 목록을 센다** ──
  console.log('\n④-c 발행 후보 준비 (러너와 같은 함수 · source-slot-v1)')
  console.log(`   ${describePrepared(prepared)}`)
  for (const h of prepared.held) console.log(`   ⌛ ${h.queueId}  [${h.hold}]${h.expires ? ' 만료 예정' : ''}`)
  console.log('   🔴 제외 행은 사람이 살리는 칸이 아니다 — 발행 트랜잭션이 만나면 EXPIRED 로 옮긴다(일괄 정리는 계획만)')

  console.log(`\n⑤ 판정 ${report.level}${report.exitCode === 1 ? ' — exit 1' : ''}`)
  console.log('   🔴 CRITICAL 만 exit 1 이다. WARNING 은 사람이 보고 판단한다\n')
  process.exit(report.exitCode)
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
