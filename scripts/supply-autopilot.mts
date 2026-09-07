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
  resumeDecision, stageInputArgs, missingArtifacts, newFiles, runStages, supersedes,
  STAGE_LABEL,
  type Checkpoint, type ExecResult, type LockRecord, type Stage, type StockSnapshot,
} from '../src/lib/supply-autopilot'
import { STOCK_TARGET, readStock } from '../src/lib/micro-seed-supply-autofill'

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
  const st = readStock(mapped)
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
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  const killOpen = S(process.env[AUTOPILOT_KILL_SWITCH_ENV]) === 'true'
  const childKillOpen = S(process.env[CHILD_KILL_SWITCH_ENV]) === 'true'
  const now = new Date()
  const runId = runIdOf(now)

  console.log(`\n══ 공급 Autopilot v1 — ${LIVE ? '🔴 live' : 'dry-run (네트워크 0 · LLM 0 · DB write 0)'} ══\n`)
  console.log(`  runId ${runId}`)
  console.log(`  목표 재고 ${STOCK_TARGET}건 · 순서 수집 → 변환 → 판정 → 초안 → 보충`)
  console.log('  🔴 이 러너는 발행하지 않는다 — Post · persona 배정 · ActivityLog 0')
  console.log(`  스위치  ${AUTOPILOT_KILL_SWITCH_ENV}=${killOpen ? 'true' : '없음'}`
    + ` · ${CHILD_KILL_SWITCH_ENV}=${childKillOpen ? 'true' : '없음'}\n`)

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const lockPath = join(DATA_DIR, LOCK_FILE)

  // ── ① lock ──
  const existing = readLock(lockPath)
  let decision = lockDecision(existing, now)
  // 🔴 시간이 안 지났어도 프로세스가 죽었으면 stale 이다 — 90분을 헛되이 기다리지 않는다
  if (decision === 'busy' && existing !== null && !pidAlive(existing.pid)) decision = 'stale'
  if (decision === 'stale' && existing !== null) {
    // 🔴 **lock 과 checkpoint 는 다른 것이다.** lock 은 "지금 누가 돌고 있나" 이고
    //    checkpoint 는 "어디까지 됐나" 다. 죽은 lock 은 걷어내되 미완료 checkpoint 는 그대로 둔다 —
    //    함께 지우면 앞 회차의 수집분과 판정 결과가 주인을 잃는다.
    console.log(`① lock  🟡 죽은 lock 을 걷어낸다 (runId ${existing.runId || '?'} · pid ${existing.pid})`)
    console.log('        🔴 checkpoint 는 지우지 않는다 — 재개 근거다')
    rmSync(lockPath, { force: true })
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
    : { ...before.stock, usable: SIM, shortfall: Math.max(0, STOCK_TARGET - SIM) }
  if (SIM !== null) console.log(`\n   🟡 모의 재고 ${SIM}건으로 계획만 본다 (실측 ${before.stock.usable}건)`)
  const verdict = judgeRun({
    live: LIVE, killOpen, childKillOpen,
    stock: judged, lock: decision === 'stale' ? 'free' : decision,
  })
  if (!verdict.ok) {
    console.log(`\n③ 돌지 않는다 — ${verdict.reason}`)
    if (verdict.code === 'NOOP_STOCK_OK') {
      console.log('   🟢 정상 no-op. 네트워크 0 · LLM 0 · DB write 0 · Post 0')
      // 🔴 DB 가 먼저 목표를 채웠는데 미완료 회차가 남아 있으면 **종결한다.**
      //    이어서 돌면 목표를 넘겨 적재하고, 그냥 두면 영구 running 기록이 된다.
      //    산출물은 지우지 않는다 — 다음 회차가 다시 쓸 수 있다.
      if (unfinished !== null && SIM === null && supersedes({ usable: before.stock.usable })) {
        const closed: Checkpoint = {
          ...unfinished.cp, status: 'superseded', completedAt: new Date().toISOString(),
        }
        writeAtomic(unfinished.path, `${JSON.stringify(closed, null, 2)}\n`)
        console.log(`   🟡 미완료 회차 ${unfinished.cp.runId} 를 superseded 로 종결했다`)
        console.log('      재고를 다른 경로가 먼저 채웠다 — 네트워크로 나가지 않는다')
      }
    }
    // 🔴 막혔더라도 "돌면 무엇을 할지" 는 보여준다. 계획을 감추면 dry-run 이 아니다
    if (verdict.code !== 'NOOP_STOCK_OK' && judged.shortfall > 0) {
      const would = planStages({ collectCap: collectCapFor(judged.shortfall), shortfall: judged.shortfall })
      console.log(`\n   돌았다면 — 부족 ${judged.shortfall}건 · 열 원천 ${collectCapFor(judged.shortfall)}건`)
      for (const p of would) {
        console.log(`   ${p.stage.padEnd(8)} ${p.label} · npx tsx ${STAGE_SCRIPT[p.stage]} ${p.args.join(' ')}`)
      }
      console.log('   🟡 네트워크 0 · LLM 0 · 파일 write 0 · DB write 0')
    }
    console.log()
    await prisma.$disconnect()
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
    cp = {
      runId, startedAt: now.toISOString(), status: 'running', completedAt: null,
      shortfall: verdict.shortfall, collectCap: verdict.collectCap,
      stock: { before: before.stock, after: null }, stages: [], artifacts: {},
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
  console.log(`   재고     ${before.stock.usable} → ${after.stock.usable} (목표 ${STOCK_TARGET})`)
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
