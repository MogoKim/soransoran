/**
 * 공급 Autopilot v1 — 통합 러너 (§4-AU)
 *
 * 82cook 원천 → thin 수집 → 검수용 변환 → 자동 판정 → 초안 생성 → 안전성 재검증
 * → Queue 재고 보충. **사람이 후보 파일을 만들지도, 명령을 다섯 번 치지도 않는다.**
 *
 * 🔴 이 러너는 **발행하지 않는다.** Post · persona 배정 · ActivityLog 를 만들지 않는다.
 *    발행은 auto-publish 가 매일 00:05 KST 에 한다.
 *
 * 🔴 **새 판정도 새 생성도 여기 없다.** 기존 스크립트를 순서대로 부를 뿐이다 —
 *    robots · 요청 간격 · 상한 · 저장 계약 · 안전성 게이트는 그 안에 이미 있다.
 *
 *   인자 없음   재고만 읽고 계획을 찍는다 — 네트워크 0 · LLM 0 · 파일 write 0 · DB write 0
 *   --live      실제 실행. 🔴 SORAN_SUPPLY_AUTOPILOT_ENABLED=true 가 함께 있어야 한다
 *
 *   재고 ≥ 14 면 --live 라도 아무것도 하지 않는다 (no-op).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

import type { PrismaClient } from '@prisma/client'

import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import {
  AUTOPILOT_KILL_SWITCH_ENV, CHILD_KILL_SWITCH_ENV, LOCK_FILE, LOCK_TTL_MS,
  judgeRun, planStages, lockDecision, verifyRun, fmtCount, collectCapFor,
  resumeDecision, stageInputArgs, missingArtifacts, newFiles, runStages, supersedes, adaptKeyOf,
  planStaleLock, applyStaleLockPlan,
  mayWriteRunState,
  STAGE_LABEL,
  type Checkpoint, type ExecResult, type LockRecord, type Stage, type StockSnapshot,
} from '../src/lib/supply-autopilot'
import { STOCK_TARGET, readStock, type StockLimits } from '../src/lib/micro-seed-supply-autofill'
import { installFromEnv, describeScale } from '../src/lib/scale-runtime'
import { derive as deriveProfile } from '../src/lib/scale-profile'

/**
 * 🔴 **내부 공급은 capacity 단계를 따른다** (2026-09-08).
 *    공개 발행이 1/day 여도 재고는 capacity 만큼 쌓아 둔다 — 그것이 준비다.
 *    🔴 준비도 판정은 넘기지 않는다. 준비도 감속은 **공개 발행**을 낮추는 장치이지
 *       내부 재고를 줄이는 장치가 아니다 (줄이면 영원히 준비되지 않는다).
 */
let CAPACITY_LIMITS: StockLimits | undefined

const DATA_DIR = '.microseed-data'
const argv = process.argv.slice(2)
const LIVE = argv.includes('--live')
/**
 * 🔴 **dry-run 전용 모의 재고.** 재고가 차 있는 날에도 "부족하면 무엇을 할지" 를 볼 수 있어야 한다.
 *    --live 와 함께 쓰면 거부한다 — 모의한 수를 근거로 남의 서버를 두드리지 않는다.
 */
const SIM = ((): number | null => {
  const hit = argv.find((a) => a.startsWith('--simulate-stock='))
  if (hit === undefined) return null
  const n = Number(hit.slice('--simulate-stock='.length))
  return Number.isInteger(n) && n >= 0 ? n : null
})()
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : String(v ?? '').trim())

/** 단계 → 실제 스크립트. 🔴 여기 없는 것은 이 러너가 부르지 않는다 */
const STAGE_SCRIPT: Record<string, string> = {
  collect: 'scripts/micro-seed-82cook-thin-detail.mts',
  cafeThin: 'scripts/micro-seed-navercafe-thin.mts',
  adapt: 'scripts/micro-seed-82cook-thin-adapt.mts',
  judge: 'scripts/micro-seed-auto-judge.mts',
  draft: 'scripts/micro-seed-auto-draft.mts',
  fill: 'scripts/micro-seed-supply-autofill.mts',
}

const runIdOf = (d: Date): string =>
  `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}`

/** 🔴 임시로 쓰고 rename 한다 — 반쯤 쓰인 checkpoint 를 다음 회차가 읽지 않게 */
function writeAtomic(path: string, body: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, body, 'utf-8')
  renameSync(tmp, path)
}

function readLock(path: string): LockRecord | null {
  if (!existsSync(path)) return null
  try {
    const j = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LockRecord>
    return { runId: S(j.runId), pid: Number(j.pid ?? 0), startedAt: S(j.startedAt) }
  } catch {
    // 🔴 못 읽는 lock 은 stale 로 취급되도록 시각이 없는 기록을 돌려준다
    return { runId: '', pid: 0, startedAt: '' }
  }
}

/** 프로세스가 살아 있는지 — signal 0 은 죽이지 않고 존재만 묻는다 */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * 하위 스크립트를 그대로 돌린다 — stdout 은 감추지 않는다.
 *
 * 🔴 **error 를 받지 않으면 Promise 가 영원히 안 끝난다.** 실행 파일이 없거나
 *    프로세스가 뜨지 못하면 close 가 오지 않는다 — 그러면 lock 을 쥔 채 매달리고,
 *    다음 회차는 90분 동안 "앞 회차가 돈다" 는 이유로 막힌다.
 */
function run(script: string, args: readonly string[]): Promise<{ code: number | null; out: string; spawnError: string }> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: { code: number | null; out: string; spawnError: string }): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    let out = ''
    try {
      const p = spawn('npx', ['tsx', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
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

/** DATA_DIR 의 파일 목록 — 단계 전후를 비교해 그 단계가 만든 것을 알아낸다 */
function dataFiles(): string[] {
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR).map((f) => join(DATA_DIR, f)).sort()
}

/**
 * 🔴 **아직 adapt 되지 않은 얇은 파일** — 정확한 파일 identity 로 판단한다.
 *
 * 시간축이 어긋나 있다: 네이버는 09:20 · 13:20 에 launchd 가 긁어 `*.thin-detail.jsonl` 을
 * 만들고, 이 러너는 21:10 에 돈다. 그 파일들은 러너가 시작하기 **전에** 이미 있으므로
 * "실행 중 새로 생긴 파일" 로는 잡히지 않는다 — 그대로 두면 영영 adapt 되지 않는다.
 *
 * 처리 여부는 runId 가 아니라 **입력 파일에서 유도한 키**로 본다.
 * 09:20 remonterrace 와 13:20 wgang 이 같은 runId 를 가질 수 있고,
 * 그때 runId 로 판단하면 한쪽이 다른 쪽을 "이미 했다" 로 막는다.
 */
function pendingThinFiles(): string[] {
  if (!existsSync(DATA_DIR)) return []
  const files = readdirSync(DATA_DIR)
  // 이미 사본이 있는 키 — adapt 산출물 이름에서 뽑는다
  const done = new Set<string>()
  for (const f of files.filter((x) => x.startsWith('82cook-adapt-'))) {
    const m = /^82cook-adapt-(.+?)\./.exec(f)
    if (m !== null) done.add(m[1])
  }
  return files
    .filter((f) => f.endsWith('.thin-detail.jsonl'))
    .filter((f) => !done.has(adaptKeyOf(f)))
    .sort().map((f) => join(DATA_DIR, f))
}

/** 아직 얇게 바꾸지 않은 **역사 raw** 수집물 — cafeThin 이 처리할 몫이다 */
function pendingRawCafeFiles(): number {
  if (!existsSync(DATA_DIR)) return 0
  const files = readdirSync(DATA_DIR)
  const thinKeys = new Set(files
    .filter((f) => /^navercafe-thin-.*\.thin-detail\.jsonl$/.test(f))
    .map((f) => adaptKeyOf(f)))
  return files.filter((f) => {
    const m = /^navercafe-([a-z0-9]+)-(.+)\.jsonl$/i.exec(f)
    if (m === null || f.includes('.list.') || f.includes('-thin-')) return false
    // 🔴 소스까지 붙여 본다 — 같은 runId 의 다른 카페가 서로를 막지 않는다
    return !thinKeys.has(`${m[1]}-${m[2]}`)
  }).length
}

/**
 * 미완료 회차 — 🔴 **가장 최근의 running 하나만** 본다.
 * 여러 개가 남아 있으면 최신 것을 잇고 나머지는 화면에 알린다.
 */
function findUnfinished(): { path: string; cp: Checkpoint } | null {
  if (!existsSync(DATA_DIR)) return null
  const files = readdirSync(DATA_DIR)
    .filter((f) => /^supply-autopilot-.*\.state\.json$/.test(f))
    .sort().reverse().map((f) => join(DATA_DIR, f))
  for (const f of files) {
    try {
      const cp = JSON.parse(readFileSync(f, 'utf-8')) as Checkpoint
      if (cp.status === 'running') return { path: f, cp }
    } catch {
      // 🔴 못 읽는 checkpoint 는 없는 것으로 본다. 다만 조용히 넘어가지 않는다
      console.log(`   🟡 checkpoint 를 읽지 못했다 — ${f}`)
    }
  }
  return null
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
  prisma: PrismaClient,
): Promise<{ stock: StockSnapshot; post: number; legacy: number }> {
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
  const st = readStock(mapped, CAPACITY_LIMITS)
  const liveRows = mapped.filter((r) =>
    (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''))
  return {
    stock: { usable: st.usable, human: st.human, machine: st.machine, shortfall: st.shortfall },
    post: await prisma.post.count(),
    // 🔴 legacy 는 세기만 한다. 후보에도 재고에도 발행 대상에도 넣지 않는다
    legacy: liveRows.length - st.usable,
  }
}

async function main(): Promise<void> {
  await loadEnvLocal()
  // 🔴 `loadEnvLocal()` **뒤에** 설치한다 — import 시점에 읽으면 .env.local 이 반영되지 않는다
  const scale = installFromEnv(process.env)
  const capD = deriveProfile(scale.capacityProfile)
  CAPACITY_LIMITS = { warn: capD.stockWarn, min: capD.stockMin, target: capD.stockTarget }
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  const killOpen = S(process.env[AUTOPILOT_KILL_SWITCH_ENV]) === 'true'
  const childKillOpen = S(process.env[CHILD_KILL_SWITCH_ENV]) === 'true'
  const now = new Date()
  const runId = runIdOf(now)

  console.log(`\n══ 공급 Autopilot v1 — ${LIVE ? '🔴 live' : 'dry-run (네트워크 0 · LLM 0 · DB write 0)'} ══\n`)
  console.log(`  runId ${runId}`)
  console.log(`  규모 설정 ${describeScale(scale)}`)
  for (const n of scale.notes) console.log(`     · ${n}`)
  console.log(`  목표 재고 ${CAPACITY_LIMITS.target}건 (capacity=${scale.capacityStage} 기준)`
    + ` · 순서 수집 → 변환 → 판정 → 초안 → 보충`)
  console.log('  🔴 이 러너는 발행하지 않는다 — Post · persona 배정 · ActivityLog 0')
  console.log(`  스위치  ${AUTOPILOT_KILL_SWITCH_ENV}=${killOpen ? 'true' : '없음'}`
    + ` · ${CHILD_KILL_SWITCH_ENV}=${childKillOpen ? 'true' : '없음'}\n`)

  const canWriteState = mayWriteRunState({ live: LIVE, killOpen, childKillOpen })
  if (canWriteState && !existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const lockPath = join(DATA_DIR, LOCK_FILE)

  // ── ① lock ──
  const existing = readLock(lockPath)
  let decision = lockDecision(existing, now)
  // 🔴 시간이 안 지났어도 프로세스가 죽었으면 stale 이다 — 90분을 헛되이 기다리지 않는다
  if (decision === 'busy' && existing !== null && !pidAlive(existing.pid)) decision = 'stale'
  if (decision === 'stale' && existing !== null) {
    // 🔴 **lock 과 checkpoint 는 다른 것이다.** 죽은 lock 은 걷어내되 미완료 checkpoint 는 둔다.
    //    판단은 planStaleLock 이 한다 — 러너를 돌리지 않고도 검사할 수 있도록 떼어 뒀다.
    const lockPlan = planStaleLock({
      stale: true, canWrite: canWriteState,
      runId: existing.runId, pid: existing.pid,
    })
    for (const line of lockPlan.lines) console.log(line)
    applyStaleLockPlan(lockPlan, () => { rmSync(lockPath, { force: true }) })
  } else if (decision === 'busy') {
    console.log('① lock  🔴 앞 회차가 아직 돈다 — 이번 회차는 돌지 않는다')
  } else {
    console.log('① lock  🟢 비어 있다')
  }

  // ── ② 재고 ──
  const before = await snapshot(prisma)
  console.log(`\n② 재고  발행 러너가 먹을 수 있는 것 ${before.stock.usable}건`
    + ` (사람 ${before.stock.human} · 기계 ${before.stock.machine})`)
  console.log(`   legacy ${before.legacy}건 — 🔴 재고에도 후보에도 넣지 않는다`)
  console.log(`   Post ${before.post}건`)

  // ── ②-b 미완료 회차 — 🔴 새 수집보다 이것이 먼저다 ──
  const unfinished = findUnfinished()
  const planForResume = unfinished === null ? [] : planStages({
    collectCap: unfinished.cp.collectCap, shortfall: unfinished.cp.shortfall,
  })
  const resume = resumeDecision({ checkpoint: unfinished?.cp ?? null, plan: planForResume })
  if (unfinished === null) {
    console.log('\n②-b 미완료 회차  없다 — 새로 시작한다')
  } else {
    console.log(`\n②-b 미완료 회차  ${unfinished.cp.runId}`)
    console.log(`   끝난 단계  ${unfinished.cp.stages.filter((x) => x.status === 'ok').map((x) => x.stage).join(' · ') || '(없음)'}`)
    console.log(`   판정      ${resume.reason}`)
    if (resume.kind === 'resume') {
      const miss = missingArtifacts({
        from: resume.from, artifacts: unfinished.cp.artifacts, exists: (f) => existsSync(f),
      })
      console.log(`   이어받을 것 ${miss.length === 0 ? '✅ 다 있다' : `🔴 ${miss.length}건 없다 — fail closed`}`)
      for (const m of miss) console.log(`      · ${m}`)
    }
  }

  // ── ③ 판정 ──
  if (SIM !== null && LIVE) fail('--simulate-stock 은 dry-run 전용이다 — 모의 재고로 밖에 나가지 않는다')
  const judged = SIM === null ? before.stock
    : { ...before.stock, usable: SIM, shortfall: Math.max(0, CAPACITY_LIMITS.target - SIM) }
  if (SIM !== null) console.log(`\n   🟡 모의 재고 ${SIM}건으로 계획만 본다 (실측 ${before.stock.usable}건)`)
  const verdict = judgeRun({
    live: LIVE, killOpen, childKillOpen,
    stock: judged, lock: decision === 'stale' ? 'free' : decision,
    // 🔴 capacity 기준 목표를 주입한다 — 모듈 상수(안전값)로 판정하지 않는다
    target: CAPACITY_LIMITS.target,
  })
  // 🔴 유지보수 단계가 실패하면 조용히 exit 0 으로 넘어가지 않는다 —
  //    launchd 는 exit status 로만 성패를 안다. 0 이면 아무도 실패를 모른다.
  let maintenanceFailed = false
  if (!verdict.ok) {
    console.log(`\n③ 돌지 않는다 — ${verdict.reason}`)
    if (verdict.code === 'NOOP_STOCK_OK') {
      console.log('   🟢 정상 no-op. 네트워크 0 · LLM 0 · DB write 0 · Post 0')
      // 🔴 DB 가 먼저 목표를 채웠는데 미완료 회차가 남아 있으면 **종결한다.**
      //    이어서 돌면 목표를 넘겨 적재하고, 그냥 두면 영구 running 기록이 된다.
      //    산출물은 지우지 않는다 — 다음 회차가 다시 쓸 수 있다.
      // 🔴 **재고가 차 있어도 수집물을 방치하지 않는다.**
      //    launchd 가 09:20·13:20 에 네이버를 계속 긁어 오는데 재고가 차 있다는 이유로
      //    변환을 미루면, 그 파일들은 아무도 안 보는 채로 쌓이기만 한다.
      //    이 단계는 네트워크 0 · LLM 0 · DB 0 이라 미뤄 둘 이유가 없다.
      // 🔴 재고가 차 있어도 수집물을 방치하지 않는다. 다만 **dry-run 은 아무것도 쓰지 않는다** —
      //    인자 없는 실행이 파일을 만들면 "계획만" 이라는 화면이 거짓말이 된다.
      if (SIM === null) {
        const pendingRaw = pendingRawCafeFiles()
        const pendingThin = pendingThinFiles()
        if (pendingRaw > 0 || pendingThin.length > 0) {
          console.log(`\n   🟡 밀린 것 — 역사 수집물 ${pendingRaw}개 · 미처리 얇은 파일 ${pendingThin.length}개`)
          for (const f of pendingThin) console.log(`      · ${f}`)
          // 🔴 **`--live` 하나만 보면 안 된다.** judgeRun 은 재고가 차 있으면 스위치를 보기
          //    전에 NOOP_STOCK_OK 를 돌려준다 — 재고가 먼저인 것은 옳지만, 그 뒤에 오는
          //    유지보수 경로가 --live 만 보면 **kill switch 를 내렸는데도 파일을 쓴다.**
          //    쓰는 자격은 언제나 세 게이트가 모두 열렸을 때뿐이다 (canWriteState 정본).
          if (!canWriteState) {
            console.log('      🟡 쓰지 않는다 — 예정 파일만 보여준다 (subprocess 0 · 파일 write 0)')
            const why: string[] = []
            if (!LIVE) why.push('--live 없음')
            if (!killOpen) why.push(`${AUTOPILOT_KILL_SWITCH_ENV} 닫힘`)
            if (!childKillOpen) why.push(`${CHILD_KILL_SWITCH_ENV} 닫힘`)
            console.log(`         막힌 이유: ${why.join(' · ')}`)
          } else {
            // 🔴 세 게이트가 다 열렸다. 그래도 여기서 하는 일은 파일 변환뿐이다 —
            //    네트워크 0 · LLM 0 · DB 0. 판정·생성·적재는 재고가 모자랄 때만 돈다.
            if (pendingRaw > 0) {
              const r = await run(STAGE_SCRIPT.cafeThin, ['--apply'])
              console.log(r.code === 0 ? '   ✅ 얇은 변환 완료' : `   🔴 얇은 변환 실패 (exit ${String(r.code)})`)
              if (r.code !== 0) maintenanceFailed = true
            }
            const after = pendingThinFiles()
            if (after.length > 0) {
              const r2 = await run(STAGE_SCRIPT.adapt, ['--apply', `--input=${after.join(',')}`])
              console.log(r2.code === 0
                ? '   ✅ 검수용 변환 완료 — 다음 회차가 이어받는다'
                : `   🔴 검수용 변환 실패 (exit ${String(r2.code)}) — 다음 회차가 다시 시도한다`)
              if (r2.code !== 0) maintenanceFailed = true
            }
          }
        }
      }
      if (unfinished !== null && SIM === null && supersedes({ usable: before.stock.usable })) {
        if (canWriteState) {
          const closed: Checkpoint = {
            ...unfinished.cp, status: 'superseded', completedAt: new Date().toISOString(),
          }
          writeAtomic(unfinished.path, `${JSON.stringify(closed, null, 2)}\n`)
          console.log(`   🟡 미완료 회차 ${unfinished.cp.runId} 를 superseded 로 종결했다`)
          console.log('      재고를 다른 경로가 먼저 채웠다 — 네트워크로 나가지 않는다')
        } else {
          console.log(`   🟡 미완료 회차 ${unfinished.cp.runId} 는 live 실행에서 superseded 로 종결할 예정이다`)
          console.log('      dry-run 또는 닫힌 스위치 — checkpoint 파일은 바꾸지 않는다')
        }
      }
    }
    // 🔴 막혔더라도 "돌면 무엇을 할지" 는 보여준다. 계획을 감추면 dry-run 이 아니다
    if (verdict.code !== 'NOOP_STOCK_OK' && judged.shortfall > 0) {
      const would = planStages({ collectCap: collectCapFor(judged.shortfall), shortfall: judged.shortfall })
      console.log(`\n   돌았다면 — 부족 ${judged.shortfall}건 · 열 원천 ${collectCapFor(judged.shortfall)}건`)
      for (const p of would) {
        console.log(`   ${p.stage.padEnd(8)} ${p.label} · npx tsx ${STAGE_SCRIPT[p.stage]} ${p.args.join(' ')}`)
      }
      // 🔴 어떤 파일이 adapt 입력이 될지 미리 보여준다 — 실행하지는 않는다
      const pre = pendingThinFiles()
      if (pre.length > 0) {
        console.log(`\n   돌았다면 adapt 가 이어받을 미처리 얇은 파일 ${pre.length}개`)
        for (const f of pre) console.log(`      · ${f}`)
      }
      console.log('   🟡 네트워크 0 · LLM 0 · 파일 write 0 · DB write 0')
    }
    console.log()
    await prisma.$disconnect()
    if (maintenanceFailed) {
      console.error('🔴 유지보수 변환이 실패했다 — exit 1\n')
      process.exit(1)
    }
    process.exit(0)
  }

  // 계획은 **앞 회차 것을 그대로** 쓴다. 재개하면서 부족분을 다시 세면 --limit 이 달라진다
  const plan = unfinished === null
    ? planStages({ collectCap: verdict.collectCap, shortfall: verdict.shortfall })
    : planStages({ collectCap: unfinished.cp.collectCap, shortfall: unfinished.cp.shortfall })

  let cpPath: string
  let cp: Checkpoint
  if (resume.kind === 'resume' && unfinished !== null) {
    cpPath = unfinished.path
    cp = unfinished.cp
    console.log(`\n③ 이어서 돈다 — ${resume.reason}`)
    console.log(`   앞 회차 계획을 그대로 쓴다 — 부족 ${cp.shortfall}건 · 열 원천 ${cp.collectCap}건`)
    console.log(`   끝난 단계 ${cp.stages.filter((x) => x.status === 'ok').map((x) => x.stage).join(' · ') || '(없음)'}`)
    // 🔴 이어받을 파일이 없으면 **fail closed.** 조용히 새 수집으로 넘어가지 않는다
    const missing = missingArtifacts({
      from: resume.from, artifacts: cp.artifacts, exists: (f) => existsSync(f),
    })
    if (missing.length > 0) {
      cp.status = 'failed'
      cp.completedAt = new Date().toISOString()
      writeAtomic(cpPath, `${JSON.stringify(cp, null, 2)}\n`)
      console.error(`\n🔴 ${resume.from} 이 이어받을 산출물이 없다:`)
      for (const m of missing) console.error(`     · ${m}`)
      console.error('   🔴 새 수집으로 넘어가지 않는다 — 이어서 돈 것처럼 보이면 안 된다.')
      console.error(`   사람이 ${cpPath} 를 확인한 뒤 지우면 다음 회차가 새로 시작한다.\n`)
      await prisma.$disconnect()
      process.exit(1)
    }
    // 🔴 lock 은 실제로 돌기 직전에 잡는다
    writeAtomic(lockPath, `${JSON.stringify({ runId, pid: process.pid, startedAt: now.toISOString() })}\n`)
  } else {
    console.log(`\n③ 돈다 — 부족 ${verdict.shortfall}건 · 이번에 열 원천 ${verdict.collectCap}건`)
    if (unfinished !== null) console.log(`   ${resume.reason}`)
    for (const p of plan) {
      console.log(`   ${p.stage.padEnd(8)} ${p.label} · npx tsx ${STAGE_SCRIPT[p.stage]} ${p.args.join(' ')}`)
    }
    writeAtomic(lockPath, `${JSON.stringify({ runId, pid: process.pid, startedAt: now.toISOString() })}\n`)
    cpPath = join(DATA_DIR, `supply-autopilot-${runId}.state.json`)
    // 🔴 회차 시작 **전에** 이미 있던 미처리 얇은 파일을 붙잡아 둔다.
    //    정기 수집(09:20 · 13:20)이 만든 것은 실행 중 "새로 생긴 파일" 로 잡히지 않는다.
    //    checkpoint 에 박아 두면 재개할 때도 같은 파일을 쓴다.
    const preexisting = pendingThinFiles()
    if (preexisting.length > 0) {
      console.log(`   이미 있던 미처리 얇은 파일 ${preexisting.length}개 — 이번 회차 adapt 입력에 넣는다`)
      for (const f of preexisting) console.log(`      · ${f}`)
    }
    cp = {
      runId, startedAt: now.toISOString(), status: 'running', completedAt: null,
      shortfall: verdict.shortfall, collectCap: verdict.collectCap,
      stock: { before: before.stock, after: null }, stages: [],
      artifacts: preexisting.length > 0 ? { preexisting } : {},
    }
  }
  const saveCp = (): void => { writeAtomic(cpPath, `${JSON.stringify(cp, null, 2)}\n`) }
  saveCp()

  // ── ④ 단계 ──
  const tally = {
    collected: null as number | null, fetch404: null as number | null,
    seeds: null as number | null, hold: null as number | null, drop: null as number | null,
    adopt: null as number | null, queued: null as number | null,
    llmCall: null as number | null, cacheHit: null as number | null,
  }
  console.log(`\n④ 단계 실행 — checkpoint ${cpPath}`)
  if (cp.stages.some((x) => x.status === 'failed')) {
    console.log('   🟡 앞 회차의 실패 기록이 있다 — 감사 기록으로 남기고, 이번 실행 결과로만 판정한다')
  }
  const loop = await runStages({
    plan, checkpoint: cp, save: saveCp,
    now: () => new Date().toISOString(),
    onStage: (stage, args) => {
      console.log(`\n──── ${stage} · ${STAGE_LABEL[stage]} ────`)
      const passed = args.filter((a) => a.startsWith('--input='))
      if (passed.length > 0) console.log(`   이어받는 입력  ${passed.join(' ')}`)
    },
    exec: async (stage, args): Promise<ExecResult> => {
      const seenBefore = dataFiles()
      const r = await run(STAGE_SCRIPT[stage], args)
      // 🔴 이 단계가 만든 것만 기록한다. 하위 스크립트가 자기 runId 를 쓰므로 전후 차이로 안다
      const made = newFiles(seenBefore, dataFiles())
        .filter((f) => !f.endsWith('.state.json') && !f.endsWith(LOCK_FILE))
      // 🔴 화면에서 수치를 되읽는다. 못 읽으면 null 로 남기고 '—' 로 찍는다
      if (stage === 'collect') {
        tally.collected = num(r.out, /읽었다\s+(\d+)건/) ?? num(r.out, /성공\s+(\d+)건/)
        tally.fetch404 = num(r.out, /404\s+(\d+)건/)
      } else if (stage === 'judge') {
        tally.seeds = num(r.out, /AUTO_SEED\s+(\d+)건/)
        tally.hold = num(r.out, /AUTO_HOLD\s+(\d+)건/)
        tally.drop = num(r.out, /AUTO_DROP\s+(\d+)건/)
        tally.cacheHit = num(r.out, /캐시\s+(\d+)건/)
        tally.llmCall = num(r.out, /호출\s+(\d+)건/)
      } else if (stage === 'draft') {
        tally.adopt = num(r.out, /채택\s+(\d+)건/)
      } else if (stage === 'fill') {
        tally.queued = num(r.out, /보충\s+(\d+)건/)
      }
      const ok = r.code === 0 && r.spawnError === ''
      if (!ok) {
        console.log(`\n🔴 ${stage} 실패 (exit ${String(r.code)}) — 뒤 단계를 돌리지 않는다`)
        console.log(`   🟢 다음 회차는 ${stage} 부터 잇는다 — 앞 단계를 다시 돌리지 않는다`)
      }
      return { ok, exitCode: r.code, spawnError: r.spawnError, made }
    },
  })

  // ── ⑤ 정합 ──
  const after = await snapshot(prisma)
  cp.stock.after = after.stock
  saveCp()
  rmSync(lockPath, { force: true })

  // 🔴 이번 실행에서 실패한 단계만 본다. 과거 실패는 감사 기록이다
  const failedStage = loop.failedStage
  const queuedMachine = after.stock.machine - before.stock.machine
  const queuedNonMachine = (after.stock.usable - before.stock.usable) - queuedMachine
  const v = verifyRun({
    postBefore: before.post, postAfter: after.post,
    stockBefore: before.stock, stockAfter: after.stock,
    queuedMachine, queuedNonMachine,
  })

  console.log('\n⑤ 관제')
  console.log(`   재고     ${before.stock.usable} → ${after.stock.usable} (목표 ${CAPACITY_LIMITS.target})`)
  console.log(`   구성     사람 ${after.stock.human} · 기계 ${after.stock.machine} · legacy ${after.legacy}`)
  console.log(`   수집     열림 ${fmtCount(tally.collected)} · 404 ${fmtCount(tally.fetch404)}`)
  console.log(`   판정     SEED ${fmtCount(tally.seeds)} · HOLD ${fmtCount(tally.hold)} · DROP ${fmtCount(tally.drop)}`)
  console.log(`   생성     채택 ${fmtCount(tally.adopt)} · 적재 ${fmtCount(tally.queued)}`)
  console.log(`   LLM      호출 ${fmtCount(tally.llmCall)} · 캐시 ${fmtCount(tally.cacheHit)}`)
  console.log(`   Post     ${before.post} → ${after.post} ${after.post === before.post ? '✅ 불변' : '🔴 변했다'}`)
  for (const s of cp.stages) {
    console.log(`   ${s.status === 'ok' ? '✅' : '🔴'} ${s.stage.padEnd(8)} exit ${String(s.exitCode)} ${s.note}`)
  }
  if (failedStage !== null) {
    console.log(`\n   🔴 실패 단계 ${failedStage} — 다음 회차가 이어서 돈다`)
    console.log('      🟢 재시도 가능: 각 단계는 이미 처리한 원천을 다시 열지 않는다 (멱등)')
  }
  console.log(`\n⑥ 정합 ${v.ok ? '✅ 통과' : '🔴 이상'}`)
  for (const p of v.problems) console.log(`   ${p}`)
  console.log('\n   🔴 발행하지 않았다. 발행은 auto-publish 가 00:05 KST 에 한다.\n')

  await prisma.$disconnect()
  console.log(`   checkpoint ${cp.status}${cp.status === 'done' ? ' ✅' : ''}`)
  process.exit(v.ok && loop.exitCode === 0 ? 0 : 1)
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
