#!/usr/bin/env tsx
/**
 * 공급 처리(drain) 러너 — 🔴 **수집하지 않는다. 이미 생긴 입력만 비운다** (§4-AU)
 *
 * 수집은 source 마다 **독립 job** 이 한다.
 *
 *   82cook                  `com.soransoran.supply-collect-82cook-thin` (얇은 상세)
 *   navercafe:remonterrace  `com.soransoran.navercafe-collect-remonterrace-multi`
 *   navercafe:wgang         `com.soransoran.navercafe-collect-wgang-multi`
 *
 * 이 러너는 그중 **누가 성공했는지 묻지 않는다.** 디스크에 남은 미처리 입력을
 * source 별로 훑어 변환 → 판정 → 초안 → 적재까지 흘려보낼 뿐이다.
 *
 * 🔴 **이 러너는 발행하지 않는다.** Post · persona 배정 · ActivityLog 를 만들지 않는다.
 *    발행은 auto-publish 가 그 단계의 예약 슬롯에 한다 (`PROFILES` 가 정본).
 *
 * 🔴 **새 판정도 새 생성도 여기 없다.** 기존 스크립트를 순서대로 부를 뿐이다 —
 *    저장 계약 · 안전성 게이트 · dedup 은 그 안에 이미 있다.
 *
 *   인자 없음   무엇이 밀려 있는지 읽고 계획만 찍는다 — 네트워크 0 · LLM 0 · 파일 write 0 · DB write 0
 *   --live      실제 실행. 🔴 SORAN_SUPPLY_PROCESS_ENABLED=true 가 함께 있어야 한다
 *
 *   미처리 입력이 없으면 --live 라도 아무것도 하지 않는다 (정상 no-op).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

import type { PrismaClient } from '@prisma/client'

import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import {
  PROCESS_KILL_SWITCH_ENV, LOCK_FILE, LOCK_TTL_MS, SUPPLY_SOURCES,
  fmtCount, hasWork, judgeBuffer, judgeProcessRun,
  mayWriteRunState, planBoundedCommonPhase, planCommonPhase, planPending, planSourcePhase, ledgerRunIdOf, type WorksetGate,
  runCommonPhase, runSourcePhase, runFileName, runStatusOf, verifyRun,
  type LockView, type ProcessRun, type ProcessStage, type StagePlan, type StageGate,
} from '../src/lib/supply-process'
/**
 * 🔴 **잠금은 검증된 계약 하나만 쓴다** (2026-09-11).
 *    `wx` 획득 · token 대조 해제 · 자동 회수 없음. 여기서 새 프로토콜을 만들지 않는다.
 */
import { acquireLock, lockAnomaly, releaseLock, type LockHandle } from './lib/collect-lock.mjs'
import { STOCK_BANDS, judgeStockBand } from '../src/lib/supply-stock-plan'
/**
 * 🔴 **생성 전 큐 스냅샷** (2026-09-17) — 판정 규칙은 여기서 만들지 않는다.
 *    정본은 `micro-seed-supply-autofill.hasPendingSibling` · `baseArticleId` 이고,
 *    스냅샷은 그 정본이 만든 집합을 파일로 옮기기만 한다.
 */
import { buildQueueSnapshot, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
/** 🔴 작업 묶음 정본 — 모양·상한·선택 규칙은 전부 저기 하나에 있다 */
import {
  judgeStageBudget, selectWorkset, terminalSourceIds, worksetFileName,
  WORKSET_DEFAULT_LIMIT, WORKSET_DROP_LABEL, type WorksetRow,
} from '../src/lib/supply-workset'
import { mergeJudgeRows } from '../src/lib/micro-seed-auto-judge'
import { artifactRetryable } from '../src/lib/content-core/review'
import { readStock, type StockLimits } from '../src/lib/micro-seed-supply-autofill'
import { installFromEnv, describeScale } from '../src/lib/scale-runtime'
import { derive as deriveProfile } from '../src/lib/scale-profile'
import { DATA_DIR_NAME } from '../src/lib/micro-seed-82cook-thin-adapt'

/** 🔴 정본은 lib 하나다 — 여기서 문자열을 다시 쓰지 않는다 */
const DATA_DIR = DATA_DIR_NAME
const argv = process.argv.slice(2)
/**
 * 🔴 **이번 회차가 끝까지 보낼 원천 수.** 기본은 정본 값이다 —
 *    올리면 유료 요청도 그만큼 는다(judge N · draft 3N · 전체 4N).
 */
const WORKSET_LIMIT = ((): number => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--workset-limit='))
  if (hit === undefined) return WORKSET_DEFAULT_LIMIT
  const n = Number.parseInt(hit.slice('--workset-limit='.length), 10)
  return Number.isInteger(n) && n > 0 ? n : -1
})()

/**
 * 🔴 상세 파일을 **판정기와 같은 정규화**로 읽는다 (`mergeJudgeRows`).
 *    `detail` 의 `access` 와 `raw-detail` 의 `accessStatus` 를 정본이 맞춘다 —
 *    여기서 손으로 파싱하면 raw 행이 정상 원천을 덮어쓴다.
 * 🔴 **파싱에 실패하면 `null`** — 부르는 쪽이 fail-closed 한다.
 */
function worksetRows(paths: readonly string[]): WorksetRow[] | null {
  const entries: { kind: 'detail' | 'raw-detail'; row: Record<string, unknown> }[] = []
  /** 정렬에 쓰는 칸 — 🔴 판정 입력에는 없는 값이라 따로 모은다 */
  const meta = new Map<string, { site: string; posted: string; listed: string }>()
  const S2 = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  for (const f of paths) {
    const kind: 'detail' | 'raw-detail' = f.endsWith('.raw-detail.jsonl') ? 'raw-detail' : 'detail'
    let raw: string
    try { raw = readFileSync(f, 'utf-8') } catch { return null }
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (t === '') continue
      let r: Record<string, unknown>
      // 🔴 한 줄이라도 깨져 있으면 조용히 건너뛰지 않는다 — 고를 대상이 달라진다
      try { r = JSON.parse(t) as Record<string, unknown> } catch { return null }
      entries.push({ kind, row: r })
      const id = S2(r.sourceArticleId)
      if (id === '') continue
      const prev = meta.get(id)
      meta.set(id, {
        site: S2(r.sourceSite) !== '' ? S2(r.sourceSite) : prev?.site ?? '',
        posted: S2(r.sourcePostedAt) !== '' ? S2(r.sourcePostedAt) : prev?.posted ?? '',
        listed: S2(r.sourceListedAt) !== '' ? S2(r.sourceListedAt) : prev?.listed ?? '',
      })
    }
  }
  return mergeJudgeRows(entries).map((input): WorksetRow => {
    const id = String(input.sourceArticleId ?? '')
    const m = meta.get(id)
    return {
      sourceArticleId: id, sourceSite: m?.site ?? '',
      commentCount: Number(input.commentCount ?? 0),
      sourcePostedAt: m?.posted ?? '', sourceListedAt: m?.listed ?? '',
      input,
    }
  })
}

/**
 * 🔴 **앞 회차가 끝낸 원천** — 판정 파일과 artifact 에서 모은다. 새 파일을 만들지 않는다.
 *    예산·상한에 막힌 것은 재시도 대상이라 빼지 않는다.
 */
function terminalIds(): Set<string> {
  const judgements: { sourceArticleId: string; decision: string; semanticStatus: string }[] = []
  const artifacts: { sourceArticleId: string; retryable: boolean; outcome: string }[] = []
  for (const f of readdirSync(DATA_DIR)) {
    if (f.endsWith('.shadow.jsonl')) {
      let raw: string
      try { raw = readFileSync(join(DATA_DIR, f), 'utf-8') } catch { continue }
      for (const line of raw.split('\n')) {
        const t = line.trim()
        if (t === '') continue
        try {
          const j = JSON.parse(t) as Record<string, unknown>
          judgements.push({
            sourceArticleId: String(j.sourceArticleId ?? ''),
            decision: String(j.decision ?? ''),
            semanticStatus: String(j.semanticStatus ?? ''),
          })
        } catch { /* 못 읽는 줄은 건너뛴다 — 끝난 것으로 세지 않는 쪽이 안전하다 */ }
      }
      continue
    }
    if (!/^auto-draft-.*\.artifacts\.json$/.test(f)) continue
    try {
      const rows = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')) as unknown
      if (!Array.isArray(rows)) continue
      for (const a of rows) {
        const o = a as Record<string, unknown>
        const rv = (o.review ?? {}) as Record<string, unknown>
        artifacts.push({
          sourceArticleId: String(o.sourceArticleId ?? ''),
          outcome: String(rv.machineOutcome ?? ''),
          retryable: artifactRetryable(rv),
        })
      }
    } catch { /* 같은 이유로 건너뛴다 */ }
  }
  return terminalSourceIds({ judgements, artifacts })
}

/** 🔴 사람이 이미 판정한 원천 — 판정기와 **같은 파일들**을 본다 */
function humanDecidedIds(): Set<string> {
  const out = new Set<string>()
  for (const pre of ['seed-originality-source-approvals-', 'srn-approvals', 'raw-originality-approvals-']) {
    for (const f of readdirSync(DATA_DIR).filter((x) => x.startsWith(pre) && x.endsWith('.json'))) {
      try {
        const j = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')) as Record<string, unknown>
        const rows = Array.isArray(j.decisions) ? j.decisions : []
        for (const r of rows) {
          const id = (r as Record<string, unknown>).sourceArticleId
          if (typeof id === 'string' && id.trim() !== '') out.add(id.trim())
        }
      } catch { /* 못 읽는 파일은 건너뛴다 — 판정기와 같은 태도다 */ }
    }
  }
  return out
}

const LIVE = argv.includes('--live')
/**
 * 🔴 **dry-run 전용 모의 재고.** 재고가 차 있는 날에도 "부족하면 무엇을 할지" 를 볼 수 있어야 한다.
 *    --live 와 함께 쓰면 거부한다 — 모의한 수를 근거로 DB 에 쓰지 않는다.
 */
const SIM = ((): number | null => {
  const hit = argv.find((a) => a.startsWith('--simulate-stock='))
  if (hit === undefined) return null
  const n = Number(hit.slice('--simulate-stock='.length))
  return Number.isInteger(n) && n >= 0 ? n : null
})()
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : String(v ?? '').trim())

/** 단계 → 실제 스크립트. 🔴 여기 없는 것은 이 러너가 부르지 않는다 — **수집 스크립트는 없다** */
const STAGE_SCRIPT: Record<ProcessStage, string> = {
  cafeThin: 'scripts/micro-seed-navercafe-thin.mts',
  adapt: 'scripts/micro-seed-82cook-thin-adapt.mts',
  judge: 'scripts/micro-seed-auto-judge.mts',
  draft: 'scripts/micro-seed-auto-draft.mts',
  fill: 'scripts/micro-seed-supply-autofill.mts',
}

const runIdOf = (d: Date): string =>
  `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}`

/** 🔴 임시로 쓰고 rename 한다 — 반쯤 쓰인 기록을 관제가 읽지 않게 */
function writeAtomic(path: string, body: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, body, 'utf-8')
  renameSync(tmp, path)
}

/**
 * 하위 스크립트를 그대로 돌린다 — stdout 은 감추지 않는다.
 *
 * 🔴 **error 를 받지 않으면 Promise 가 영원히 안 끝난다.** 실행 파일이 없거나
 *    프로세스가 뜨지 못하면 close 가 오지 않는다 — 그러면 lock 을 쥔 채 매달린다.
 */
function run(
  script: string, args: readonly string[], env?: Readonly<Record<string, string>>,
): Promise<{ code: number | null; out: string; spawnError: string }> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: { code: number | null; out: string; spawnError: string }): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    let out = ''
    try {
      const p = spawn('npx', ['tsx', script, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        // 🔴 단계 env 는 **이 자식에게만** 실린다 — 운영 env 파일은 바뀌지 않는다
        ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
      })
      p.stdout.on('data', (b: Buffer) => { const t = b.toString(); out += t; process.stdout.write(t) })
      p.stderr.on('data', (b: Buffer) => { const t = b.toString(); out += t; process.stderr.write(t) })
      p.on('error', (e: Error) => {
        const msg = `프로세스를 시작하지 못했다 — ${e.message}`
        console.error(`   🔴 ${msg}`)
        done({ code: null, out, spawnError: msg })
      })
      p.on('close', (code) => { done({ code, out, spawnError: '' }) })
    } catch (e) {
      const msg = `spawn 이 던졌다 — ${e instanceof Error ? e.message : String(e)}`
      console.error(`   🔴 ${msg}`)
      done({ code: null, out, spawnError: msg })
    }
  })
}

function dataFiles(): string[] {
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR).sort()
}

/** 🔴 화면에 찍힌 수를 되읽는다. 못 찾으면 0 이 아니라 null 이다 — 모르는 것을 안다고 하지 않는다 */
function num(out: string, re: RegExp): number | null {
  const m = re.exec(out)
  return m === null ? null : Number(m[1])
}

type QueueRow = {
  status: string; createdPostId: string | null
  promptVersion: string; model: string; gateResults: unknown
  rawContent: { sourceSite: string } | null
}

async function snapshot(
  prisma: PrismaClient, limits: StockLimits,
): Promise<{ usable: number; human: number; machine: number; post: number; legacy: number }> {
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
  const st = readStock(mapped, limits)
  const liveRows = mapped.filter((r) =>
    (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''))
  return {
    usable: st.usable, human: st.human, machine: st.machine,
    post: await prisma.post.count(),
    // 🔴 legacy 는 세기만 한다. 후보에도 재고에도 발행 대상에도 넣지 않는다
    legacy: liveRows.length - st.usable,
  }
}

/**
 * 🔴 **내 lock 은 내가 푼다 — 모든 경로에서.**
 *    `finally` 로 풀고, 그래도 빠져나가는 경로(신호·예외 밖)를 위해 `exit` 훅도 건다.
 *    `releaseLock` 은 **내 token 일 때만** 지우므로 두 번 불려도 남의 락을 건드리지 않는다.
 */
let lockHandle: LockHandle | null = null
/** 🔴 prisma 는 ③에서 만들어진다 — 만들어졌을 때만 끊는다 */
const teardown: { disconnect: (() => Promise<void>) | null } = { disconnect: null }
function releaseHeldLock(): void {
  if (lockHandle === null) return
  const r = releaseLock(lockHandle)
  lockHandle = null
  // 🔴 내 것이 아니거나 이미 없으면 **지우지 않는다.** 그 사실을 화면에 남긴다
  if (r !== 'RELEASED') console.error(`   🟡 lock 해제 — ${r} (남의 락은 건드리지 않는다)`)
}
process.on('exit', releaseHeldLock)

async function main(): Promise<number> {
  await loadEnvLocal()
  // 🔴 `loadEnvLocal()` **뒤에** 설치한다 — import 시점에 읽으면 .env.local 이 반영되지 않는다
  const scale = installFromEnv(process.env)
  const capD = deriveProfile(scale.capacityProfile)
  /** 🔴 경고·최소선은 capacity 프로필 눈금이다. **버퍼 목표는 `STOCK_BANDS.target` 하나다** */
  const limits: StockLimits = { warn: capD.stockWarn, min: capD.stockMin, target: STOCK_BANDS.target }

  const killOpen = S(process.env[PROCESS_KILL_SWITCH_ENV]) === 'true'
  const now = new Date()
  const runId = runIdOf(now)

  console.log(`\n══ 공급 처리(drain) — ${LIVE ? '🔴 live' : 'dry-run (네트워크 0 · LLM 0 · DB write 0)'} ══\n`)
  console.log(`  runId ${runId}`)
  console.log(`  규모 설정 ${describeScale(scale)}`)
  for (const n of scale.notes) console.log(`     · ${n}`)
  console.log('  🔴 이 러너는 **수집하지 않는다** — 수집은 source 마다 독립 job 이 한다')
  console.log(`  버퍼 목표 ${STOCK_BANDS.target}건 (APPROVED 재고)`
    + ` · capacity 목표 ${capD.stockTarget}건(${scale.capacityStage} — 발행 쪽 눈금)`)
  console.log('  순서 source 별 (얇은 변환 → 검수용 변환) → 공통 (판정 → 초안 → 보충)')
  console.log('  🔴 발행 0 — Post · persona 배정 · ActivityLog 를 만들지 않는다')
  console.log(`  스위치  ${PROCESS_KILL_SWITCH_ENV}=${killOpen ? 'true' : '없음'}\n`)

  const canWrite = mayWriteRunState({ live: LIVE, killOpen })
  if (canWrite && !existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const lockPath = join(DATA_DIR, LOCK_FILE)

  /**
   * ── ① lock — 🔴 **획득은 `wx` 한 번, 해제는 내 token 대조 삭제 하나뿐** ──
   *
   *    자동 stale 회수를 하지 않는다. 뺏는 순간 관측→조작 창이 열리고
   *    그 창이 두 회차를 동시에 들여보낸다(2026-09-09 PR #483 결론).
   *
   * 🔴 **dry-run 은 잡지 않고 관측만 한다.** 계획만 보는 실행이 잠금 파일을 만들면
   *    "파일 write 0" 이 거짓말이 된다.
   */
  let lockView: LockView = 'free'
  if (!canWrite) {
    const anomaly = lockAnomaly(lockPath, now.getTime(), LOCK_TTL_MS)
    lockView = anomaly !== null ? 'stale-held' : existsSync(lockPath) ? 'held' : 'free'
    console.log(`① lock  🟡 관측만 한다 (게이트가 닫혀 있다) — ${lockView}`)
  } else {
    const acq = acquireLock(lockPath, now.getTime(), LOCK_TTL_MS)
    if (acq.ok) {
      lockHandle = acq.handle
      console.log('① lock  🟢 잡았다')
    } else {
      lockView = acq.kind === 'HELD' ? 'held' : acq.kind === 'STALE_HELD' ? 'stale-held' : 'unreadable'
      console.log(`① lock  🔴 잡지 못했다 — ${acq.reason}`)
    }
  }

  // ── ② 미처리 입력 ──
  const pending = planPending(dataFiles())
  console.log('\n② 미처리 입력')
  for (const s of SUPPLY_SOURCES) {
    const raw = pending.rawCafe[s] ?? []
    const thin = pending.thin[s] ?? []
    console.log(`   ${s.padEnd(24)} 카페 수집물 ${String(raw.length).padStart(3)}개`
      + ` · 얇은 파일 ${String(thin.length).padStart(3)}개`)
    for (const f of thin) console.log(`      · ${f}`)
  }
  console.log(`   공통 입력  검수용 ${pending.detail.length}개`
    + ` · 판정 ${pending.shadow.length}개 · 후보 ${pending.candidates.length}개`)

  // ── ③ 재고 → 버퍼 정책 (🔴 회차를 막는 게이트가 아니다) ──
  if (SIM !== null && LIVE) {
    // 🔴 `process.exit` 을 쓰지 않는다 — finally 를 건너뛰면 잡은 lock 이 남는다
    throw new Error('--simulate-stock 은 dry-run 전용이다 — 모의 재고로 DB 에 쓰지 않는다')
  }
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  teardown.disconnect = async (): Promise<void> => { await prisma.$disconnect() }
  let before: Awaited<ReturnType<typeof snapshot>> | null = null
  if (SIM === null) {
    try {
      before = await snapshot(prisma, limits)
    } catch (e) {
      console.log(`\n③ 재고  🔴 읽지 못했다 — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const usable = SIM ?? before?.usable ?? null
  const policy = judgeBuffer(usable)
  console.log('\n③ 재고')
  if (SIM !== null) console.log(`   🟡 모의 재고 ${SIM}건으로 계획만 본다 (DB 를 읽지 않았다)`)
  else if (before !== null) {
    console.log(`   발행 러너가 먹을 수 있는 것 ${before.usable}건`
      + ` (사람 ${before.human} · 기계 ${before.machine})`)
    console.log(`   legacy ${before.legacy}건 — 🔴 재고에도 후보에도 넣지 않는다`)
    console.log(`   Post ${before.post}건`)
  }
  if (usable !== null) console.log(`   구간 ${judgeStockBand(usable).band}`)
  console.log(`   버퍼 ${policy.reason}`)

  // ── ④ 판정 ──
  const verdict = judgeProcessRun({ live: LIVE, killOpen, lock: lockView, hasWork: hasWork(pending) })
  const sourcePlans = planSourcePhase(pending)
  /**
   * 🔴 **미리보기다.** 아직 큐를 읽지 않았으므로 draft 를 계획에 넣지 않는다 —
   *    "돌았다면" 목록에 유료 단계를 적어 두면 실제와 다른 그림이 된다.
   */
  const commonPlan = planCommonPhase(pending, policy, {
    kind: 'hold', reason: '미리보기 — 큐 스냅샷은 실행 국면에서 만든다', runId,
  })

  if (!verdict.ok) {
    console.log(`\n④ 돌지 않는다 — ${verdict.reason}`)
    if (verdict.code === 'NO_INPUT') {
      console.log('   🟢 정상 no-op. 네트워크 0 · LLM 0 · DB write 0 · Post 0')
      console.log('   🔴 수집 job 은 이 판정과 무관하게 자기 스케줄로 돈다')
    } else {
      console.log('\n   돌았다면 —')
      for (const sp of sourcePlans) {
        for (const p of sp.stages) {
          console.log(`   ${sp.source.padEnd(24)} ${p.stage.padEnd(9)} npx tsx ${STAGE_SCRIPT[p.stage]} ${p.args.join(' ')}`)
        }
      }
      for (const p of commonPlan) {
        console.log(`   ${'(공통)'.padEnd(24)} ${p.stage.padEnd(9)} npx tsx ${STAGE_SCRIPT[p.stage]} ${p.args.join(' ')}`)
      }
      if (!policy.llm) console.log('   🟡 모델 단계는 계획에 없다 — 버퍼 정책이 파일 단계까지만 허용한다')
      else if (commonPlan.length === 0 && sourcePlans.length > 0) {
        // 🔴 **없는 것이 아니라 아직 입력이 없는 것이다.** adapt 가 검수용 파일을 만든 뒤에 정해진다 —
        //    계획을 미리 굳혀 두면 방금 만든 입력을 놓친다. 실행 때는 국면 사이에 다시 센다.
        console.log('   🟡 공통 단계(판정→초안→보충)는 source 단계가 입력을 만든 뒤에 정해진다')
      }
      console.log('   🟡 네트워크 0 · LLM 0 · 파일 write 0 · DB write 0')
    }
    console.log()
    return 0
  }

  // ── ⑤ 실행 — 🔴 잠금은 ①에서 이미 잡았다. 여기서 다시 만들지 않는다 ──
  const runPath = join(DATA_DIR, runFileName(runId))
  const record: ProcessRun = {
    runId,
    runtimeSha: ((): string | undefined => {
      try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim() } catch { return undefined }
    })(),
    startedAt: now.toISOString(),
    status: 'running', completedAt: null,
    buffer: { usable, upTo: policy.upTo, reason: policy.reason },
    sources: [], stages: [],
  }
  const save = (): void => { writeAtomic(runPath, `${JSON.stringify(record, null, 2)}\n`) }
  save()

  const tally = {
    seeds: null as number | null, hold: null as number | null, drop: null as number | null,
    adopt: null as number | null, queued: null as number | null,
    llmCall: null as number | null, cacheHit: null as number | null,
  }
  const exec = async (plan: StagePlan): Promise<{ ok: boolean; exitCode: number | null; spawnError: string }> => {
    // 🔴 단계별 env 는 **자식 프로세스에만** 실린다. 운영 env 파일은 건드리지 않는다
    const r = await run(STAGE_SCRIPT[plan.stage], plan.args, plan.env)
    if (plan.stage === 'judge') {
      tally.seeds = num(r.out, /AUTO_SEED\s+(\d+)건/)
      tally.hold = num(r.out, /AUTO_HOLD\s+(\d+)건/)
      tally.drop = num(r.out, /AUTO_DROP\s+(\d+)건/)
      tally.cacheHit = num(r.out, /캐시\s+(\d+)건/)
      tally.llmCall = num(r.out, /호출\s+(\d+)건/)
    } else if (plan.stage === 'draft') {
      tally.adopt = num(r.out, /채택\s+(\d+)건/)
    } else if (plan.stage === 'fill') {
      tally.queued = num(r.out, /보충\s+(\d+)건/)
    }
    return { ok: r.code === 0 && r.spawnError === '', exitCode: r.code, spawnError: r.spawnError }
  }
  const onStage = (plan: StagePlan): void => {
    console.log(`\n──── ${plan.source ?? '공통'} · ${plan.stage} · ${plan.label} ────`)
    console.log(`   npx tsx ${STAGE_SCRIPT[plan.stage]} ${plan.args.join(' ')}`)
  }
  const nowIso = (): string => new Date().toISOString()

  console.log(`\n⑤ 실행 — 기록 ${runPath}`)

  // ⑤-a source 국면 — 🔴 한 source 가 실패해도 다음 source 는 돈다
  const phase1 = await runSourcePhase({ plans: sourcePlans, exec, now: nowIso, onStage })
  record.sources = phase1.sources
  record.stages = [...phase1.outcomes]
  save()

  // 🔴 **국면 사이에 다시 센다.** 방금 adapt 가 만든 검수용 파일이 공통 국면의 입력이다
  const after1 = planPending(dataFiles())
  /**
   * ── 🔴 **생성 전 큐 스냅샷** (2026-09-17) ──
   *
   *    12:15 회차 실측: 유료로 266건을 만들어 183건을 채택했는데 적재는 10건이었고,
   *    빠진 이유 1위가 `SIBLING` 161건 — *"같은 원문의 형제가 아직 큐에서 안 나갔다"* 였다.
   *    그 판정은 **원문 id 와 큐 상태만 있으면 생성 전에 알 수 있다.**
   *
   * 🔴 생성기는 DB 를 읽지 않는다(레인 계약). 그래서 **러너가 읽어 파일로 건넨다.**
   * 🔴 못 읽으면 **draft 를 보류한다.** 입력은 그대로 두고 다음 회차가 다시 집는다.
   */
  /**
   * ── 🔴 **생성 전 큐 스냅샷** (2026-09-17) ──
   *
   *    12:15 회차 실측: 유료로 266건을 만들어 183건을 채택했는데 적재는 10건이었고,
   *    빠진 이유 1위가 `SIBLING` 161건 — *"같은 원문의 형제가 아직 큐에서 안 나갔다"* 였다.
   *    그 판정은 **원문 id 와 큐 상태만 있으면 생성 전에 알 수 있다.**
   *
   * 🔴 생성기는 DB 를 읽지 않는다(레인 계약). 그래서 **러너가 읽어 파일로 건넨다.**
   * 🔴 **`draft` 를 돌리기 직전에** 뜬다. 계획 시점에 뜨면 그 사이 `judge` 가 도는 만큼
   *    낡는다 — 실측으로 `judge` 가 12분 걸린 회차가 있다. TTL 을 늘려 덮지 않는다.
   * 🔴 못 읽거나 못 쓰면 **draft 를 보류한다.** 입력은 그대로 두고 다음 회차가 다시 집는다.
   */
  const snapPath = join(DATA_DIR, queueSnapshotFileName(runId))

  /**
   * ── 🔴 **작업 묶음** — adapt 뒤, **AI 를 부르기 전에** 코드가 정한다 (2026-09-20) ──
   *
   *    2026-09-20 canary: adapt 가 3일치 backlog 를 609건으로 펼쳤고 judge 가
   *    공동 상한 15회를 전부 써 draft 는 0회였다. 후보 0건에 $0.029949.
   *    🔴 이제 N 건만 골라 **그 N 건만** 판정→생성→적재까지 세로로 보낸다.
   *    고르지 않은 것은 지우지도 판정하지도 않는다 — 다음 회차가 집는다.
   */
  const budget = judgeStageBudget(WORKSET_LIMIT)
  if (!budget.ok) {
    console.error(`\n🔴 중단: ${budget.reason}\n`)
    return 1
  }
  const wsPath = join(DATA_DIR, worksetFileName(runId))
  // 🔴 파일 이름은 **파이프라인 회차 id** 로 짓는다 — 세 단계가 같은 값으로 이어진다
  const shadowPath = join(DATA_DIR, `auto-judge-${runId}.shadow.jsonl`)
  const candPath = join(DATA_DIR, `auto-draft-${runId}.candidates.json`)

  /**
   * 🔴 큐 스냅샷을 **묶음을 고르기 전에** 뜬다 — 같은 원문의 미발행 형제를
   *    AI 호출 전에 빼야 한다. 생성 직전에도 다시 쓰이므로 한 번만 뜬다.
   */
  let queuePending = new Set<string>()
  let snapOk = false
  try {
    const qrows = await prisma.originalPostApprovalQueue.findMany({
      select: { createdPostId: true, rawContent: { select: { sourceArticleId: true, sourceSite: true } } },
    })
    const snap = buildQueueSnapshot({
      runId, takenAt: new Date(),
      rows: qrows.map((r) => ({
        sourceArticleId: r.rawContent?.sourceArticleId ?? '',
        sourceSite: r.rawContent?.sourceSite ?? '',
        createdPostId: r.createdPostId,
      })),
    })
    // 🔴 이 파일은 **묶음을 고르는 데만** 쓴다 — 생성 직전에 다시 뜬다
    writeAtomic(snapPath, `${JSON.stringify(snap, null, 2)}\n`)
    queuePending = new Set(snap.pendingSourceIds)
    snapOk = true
    console.log(`\n   🟢 큐 스냅샷(묶음 선택용) ${snap.pendingSourceIds.length}건 미발행 원문`)
  } catch (e) {
    console.log(`\n   🔴 큐 스냅샷 실패 — ${e instanceof Error ? e.message : String(e)}`)
  }

  let workset: WorksetGate | undefined
  if (snapOk && policy.llm) {
    const rows = worksetRows(after1.detail.map((f) => join(DATA_DIR, f)))
    if (rows === null) {
      console.error('\n🔴 중단: 상세 입력을 읽지 못해 작업 묶음을 만들 수 없다 — 유료 단계 0회\n')
      return 1
    }
    const plan = selectWorkset({
      rows, humanDecided: humanDecidedIds(), queuePending, terminal: terminalIds(),
      limit: WORKSET_LIMIT, runId, takenAt: new Date(),
    })
    writeAtomic(wsPath, `${JSON.stringify(plan.workset, null, 2)}\n`)
    workset = {
      manifestPath: wsPath, shadowPath, candidatesPath: candPath,
      limit: WORKSET_LIMIT, perStage: budget.perStage,
    }
    console.log(`   🔴 작업 묶음 ${plan.picked.length}건 / 상한 ${WORKSET_LIMIT} — ${wsPath}`)
    console.log(`      단계 상한  judge ${budget.perStage.judge}회 · draft ${budget.perStage.draft}회`
      + ` · 회차 전체 ${budget.total}회 (🔴 단계마다 따로 — 앞 단계가 뒤 단계를 굶기지 못한다)`)
    const dropNote = (Object.keys(plan.dropped) as (keyof typeof plan.dropped)[])
      .filter((k) => plan.dropped[k] > 0)
      .map((k) => `${WORKSET_DROP_LABEL[k]} ${plan.dropped[k]}`)
    console.log(`      제외 ${dropNote.length === 0 ? '없음' : dropNote.join(' · ')}`)
    console.log(`      🔴 이번에 안 고른 ${plan.deferred}건은 **그대로 남는다** — 다음 회차가 집는다`)
    for (const r of plan.picked) {
      console.log(`      · ${r.sourceArticleId} · ${r.sourceSite} · 댓글 ${r.commentCount}`)
    }
  }

  /**
   * 🔴 **묶음 없이 live 를 돌리지 않는다** (2026-09-20 보정).
   *    앞판은 `workset` 이 `undefined` 면 옛 전체 스캔으로 넘어갔다 —
   *    그것이 canary 에서 backlog 609건을 판정하게 만든 길이다.
   */
  if (workset === undefined) {
    console.error('\n🔴 중단: 작업 묶음을 만들지 못했다 — judge · draft · fill 0회\n')
    record.status = 'failed'
    record.completedAt = nowIso()
    save()
    return 1
  }
  const common = planBoundedCommonPhase(after1, policy, {
    kind: 'ready', snapshotPath: snapPath, runId,
  }, workset)
  /**
   * 🔴 **스냅샷을 두 번 뜬다** (2026-09-20).
   *    ① 묶음을 고르기 전 — 같은 원문의 형제를 **AI 호출 전에** 빼려면 필요하다
   *    ② `draft` 직전 — 그 사이 `judge` 가 도는 만큼 ①이 낡는다. 실측으로 12분 걸린
   *       회차가 있었다. TTL 을 늘려 덮지 않는다. **생성이 보는 것은 ②다.**
   */
  const beforeStage = async (plan: StagePlan): Promise<StageGate> => {
    if (plan.stage !== 'draft') return { ok: true }
    try {
      const qrows = await prisma.originalPostApprovalQueue.findMany({
        // 🔴 적재의 queueForSibling 과 **같은 세 칸**만 읽는다. 제목도 본문도 가져오지 않는다
        select: {
          createdPostId: true,
          rawContent: { select: { sourceArticleId: true, sourceSite: true } },
        },
      })
      const snap = buildQueueSnapshot({
        runId, takenAt: new Date(),
        rows: qrows.map((r) => ({
          sourceArticleId: r.rawContent?.sourceArticleId ?? '',
          sourceSite: r.rawContent?.sourceSite ?? '',
          createdPostId: r.createdPostId,
        })),
      })
      writeAtomic(snapPath, `${JSON.stringify(snap, null, 2)}\n`)
      console.log(`   🟢 큐 스냅샷 ${snap.pendingSourceIds.length}건 미발행 원문 — ${snapPath}`)
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`   🔴 큐 스냅샷 실패 — ${msg}`)
      return { ok: false, reason: `큐 스냅샷을 만들지 못해 초안 생성을 보류했다 (${msg})` }
    }
  }
  const phase2 = await runCommonPhase({ plan: common, exec, now: nowIso, onStage, beforeStage })
  record.stages = [...record.stages, ...phase2.outcomes]
  record.status = runStatusOf(record.stages)
  record.completedAt = nowIso()
  save()

  // ── ⑥ 정합 ──
  console.log('\n⑥ 관제')
  for (const s of record.sources) {
    console.log(`   ${s.status === 'ok' ? '✅' : '🔴'} ${s.source.padEnd(24)} ${s.note}`)
  }
  for (const s of record.stages) {
    const mark = s.status === 'ok' ? '✅' : s.status === 'skipped' ? '🟡' : '🔴'
    console.log(`   ${mark} ${(s.source ?? '공통').padEnd(24)} ${s.stage.padEnd(9)}`
      + ` exit ${String(s.exitCode)} ${s.note}`)
  }
  console.log(`   판정     SEED ${fmtCount(tally.seeds)} · HOLD ${fmtCount(tally.hold)} · DROP ${fmtCount(tally.drop)}`)
  console.log(`   생성     채택 ${fmtCount(tally.adopt)} · 적재 ${fmtCount(tally.queued)}`)
  console.log(`   LLM      호출 ${fmtCount(tally.llmCall)} · 캐시 ${fmtCount(tally.cacheHit)}`)

  let ok = record.status === 'done'
  if (before !== null) {
    const after = await snapshot(prisma, limits)
    const queuedMachine = after.machine - before.machine
    const queuedNonMachine = (after.usable - before.usable) - queuedMachine
    const v = verifyRun({
      postBefore: before.post, postAfter: after.post,
      stockBefore: before.usable, stockAfter: after.usable,
      machineBefore: before.machine, machineAfter: after.machine,
      queuedMachine, queuedNonMachine,
    })
    console.log(`   재고     ${before.usable} → ${after.usable} (버퍼 목표 ${STOCK_BANDS.target})`)
    console.log(`   Post     ${before.post} → ${after.post} ${after.post === before.post ? '✅ 불변' : '🔴 변했다'}`)
    console.log(`\n⑦ 정합 ${v.ok ? '✅ 통과' : '🔴 이상'}`)
    for (const p of v.problems) console.log(`   ${p}`)
    ok = ok && v.ok
  }
  console.log('\n   🔴 발행하지 않았다. 발행은 auto-publish 가 예약 슬롯에 한다.\n')

  console.log(`   회차 ${record.status}${record.status === 'done' ? ' ✅' : ''}`)
  return ok ? 0 : 1
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  let code = 1
  try {
    code = await main()
  } catch (e) {
    console.error(`\n🔴 중단: ${e instanceof Error ? e.message : String(e)}\n`)
    code = 1
  } finally {
    /**
     * 🔴 **성공·실패·예외 어느 경로로 나가든 여기를 지난다.**
     *    잡은 lock 을 풀지 않고 죽으면 다음 회차가 `STALE_HELD` 로 멈추고,
     *    자동 회수를 하지 않으므로 사람이 올 때까지 공급이 선다.
     */
    releaseHeldLock()
    if (teardown.disconnect !== null) await teardown.disconnect()
  }
  process.exit(code)
}
