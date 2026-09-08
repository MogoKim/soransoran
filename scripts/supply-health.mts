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
  PUBLISH_GRACE_MS, type Finding, type HealthReport, type LogFacts,
} from '../src/lib/supply-health'
import { STOCK_TARGET, readStock, queueProfileOf } from '../src/lib/micro-seed-supply-autofill'
import { LOCK_FILE, LOCK_TTL_MS, adaptKeyOf, lockDecision } from '../src/lib/supply-autopilot'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'
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
const JSON_OUT = argv.includes('--json')
const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : String(v ?? '').trim())

/** 🔴 이 시간을 넘겨 산출물이 없으면 오래된 것으로 본다 */
const SOURCE_STALE_MS = 30 * 60 * 60 * 1000   // 30시간 — 하루 1~2회 도는 job 의 여유
const SUPPLY_STALE_MS = 30 * 60 * 60 * 1000

/**
 * 확정 수집원 셋 — 🔴 §4-AV 와 같은 목록이다.
 *
 * 🔴 **슬롯은 배열이다.** 82cook 은 하루 10번 돈다 — 07:10 하나만 보면
 *    "다음 실행" 을 09:10 이 아니라 내일 07:10 으로 잡아 12시간을 헛기다린다.
 */
const SOURCES: { id: string; filePrefix: string; logName: string; slots: [number, number][] }[] = [
  {
    id: '82cook', filePrefix: '82cook-thin-', logName: 'raw-collect-82cook',
    slots: [7, 9, 11, 13, 15, 17, 19, 21, 23, 1].map((h) => [h, 10] as [number, number]),
  },
  {
    id: 'navercafe:remonterrace', filePrefix: 'navercafe-thin-remonterrace-',
    logName: 'navercafe-collect-remonterrace', slots: [[9, 20]],
  },
  {
    id: 'navercafe:wgang', filePrefix: 'navercafe-thin-wgang-',
    logName: 'navercafe-collect-wgang', slots: [[13, 20]],
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

function checkpoints(): CheckpointSummary {
  let running = 0
  let failed = 0
  let lastOkAt: Date | null = null
  for (const x of dataFiles().filter((y) => /^supply-autopilot-.*\.state\.json$/.test(y))) {
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

function lockState(now: Date): 'free' | 'busy' | 'stale' {
  const p = join(DATA_DIR, LOCK_FILE)
  if (!existsSync(p)) return 'free'
  try {
    const rec = JSON.parse(readFileSync(p, 'utf-8')) as { runId: string; pid: number; startedAt: string }
    return lockDecision(rec, now, LOCK_TTL_MS)
  } catch {
    return 'stale'
  }
}

type QueueRow = {
  status: string; createdPostId: string | null
  promptVersion: string; model: string; gateResults: unknown
  rawContent: { sourceSite: string } | null
}

async function main(): Promise<void> {
  await loadEnvLocal()
  const now = new Date()

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
        now, staleAfterMs: SOURCE_STALE_MS,
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
  const stock = readStock(mapped)
  const live = mapped.filter((r) =>
    (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''))
  const legacyExcluded = live.length - stock.usable

  const cp = checkpoints()
  const supply = judgeSupply({
    usable: stock.usable, human: stock.human, machine: stock.machine, legacyExcluded,
    pendingThin: pendingThinCount(), historicRawNoop: historicRawNoop(),
    runningCheckpoints: cp.running, failedCheckpoints: cp.failed,
    lock: lockState(now), lastSupplyOkAt: cp.lastOkAt, now, staleAfterMs: SUPPLY_STALE_MS,
  })

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
  const publish = judgePublish({
    todayCount, dailyCap: DAILY_PUBLISH_CAP,
    afterPublishGrace: now.getTime() >= graceUntil.getTime(),
    mismatched: verdict.bad.length, legacyPublishedToday, historicUnknownProfile,
    candidates: stock.usable, now,
  })

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
      rawContent: { select: { sourceSite: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
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

  // 🔴 오늘 이미 상한을 채웠으면 다음 예약은 **내일** 00:05 KST 다
  const startAt = nextScheduleAt({ now, publishedToday: todayCount, dailyCap: DAILY_PUBLISH_CAP })
  // 🔴 **이미 배정된 행은 기존 배정이 정본이다** — 러너와 같아야 한다.
  //    이것을 넘기지 않으면 예측이 그 행을 새로 매칭해 **다른 사람**에게 주고,
  //    화면이 보여준 필자와 실제로 나갈 필자가 달라진다.
  //    배정된 persona 를 못 찾으면 빈 값이 아니라 **모르는 코드**를 넘긴다 —
  //    forecast 가 fail-closed(RECOVERY_BROKEN)로 잡아야 하기 때문이다
  const codeOfPersonaId = new Map(personaRows.map((r) => [r.id, r.code]))
  const forecastQueue = autoTargets.map((t) => ({
    queueId: t.id, title: t.title, body: t.body, gateVerdict: t.gateVerdict, createdAt: 0,
    assignedPersonaCode: t.matchedPersonaId === null
      ? null
      : (codeOfPersonaId.get(t.matchedPersonaId) ?? `__unknown:${t.matchedPersonaId}`),
  }))

  const fc = forecastPublishing({
    queue: forecastQueue,
    personas: personas as never, history, startAt, days: 14, dailyCap: DAILY_PUBLISH_CAP,
  })

  // 🔴 매칭률은 **조합 단위**로 센다 — 후보 × persona. 사유 개수가 아니다.
  //    한 조합에 사유가 여러 개여도 한 번만 센다.
  const blockedCombos: string[][] = []
  {
    const { planBatch } = await import('../src/lib/original-post-persona-match')
    // 🔴 예측과 **같은 입력**이다. 여기서만 기존 배정을 빼면 두 수치가 갈린다
    const b = planBatch(forecastQueue, personas as never)
    for (const a of b.assignments) {
      for (const x of a.blocked) blockedCombos.push(x.reasons.map((r) => r.code))
    }
  }
  const rates = blockRatesByCombination({
    candidates: autoTargets.length, personas: personas.length, blockedCombos,
  })
  const cap = capacityOf({ activePersonas: personas.length, lifeBlockRate: rates.lifeRate })
  const need = personasNeededFor({
    targetPerDay: DAILY_PUBLISH_CAP, lifeBlockRate: rates.lifeRate, activePersonas: personas.length,
  })
  const capacity = judgeCapacity({
    stockUsable: stock.usable, in7: fc.in7, nextWillPublish: fc.nextScheduleWillPublish,
    nextCandidates: fc.nextPersonaCandidates.length, shortfallMin: need.shortfallMin,
    dailyCap: DAILY_PUBLISH_CAP,
    // 🔴 기존 배정이 깨졌으면 이것 하나로 CRITICAL 이다 — 다른 수치는 의미를 잃는다
    recoveryBroken: fc.recoveryBroken,
  })

  await prisma.$disconnect()

  const report: HealthReport = buildReport({ sources, supply, publish: [...publish, ...capacity] })

  if (JSON_OUT) {
    console.log(JSON.stringify({
      level: report.level, checkedAt: now.toISOString(),
      sources: report.sources, supply: report.supply, publish: report.publish, rollUp: report.rollUp,
      numbers: {
        stock: stock.usable, human: stock.human, machine: stock.machine, legacyExcluded,
        target: STOCK_TARGET, todayPublished: todayCount, dailyCap: DAILY_PUBLISH_CAP,
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
  console.log(`   목표 ${DAILY_PUBLISH_CAP}/day 에 필요한 persona ${need.min}~${need.max}명`
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

  console.log(`\n④ 판정 ${report.level}${report.exitCode === 1 ? ' — exit 1' : ''}`)
  console.log('   🔴 CRITICAL 만 exit 1 이다. WARNING 은 사람이 보고 판단한다\n')
  process.exit(report.exitCode)
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
