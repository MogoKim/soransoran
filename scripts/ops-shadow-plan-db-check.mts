#!/usr/bin/env tsx
/**
 * 🔴 **ops shadow 격리 DB A-to-Z** (2026-11-11) — 실제 CLI 를 격리 Postgres 에 대고 돌린다.
 *
 *   ① 모든 Prisma 모델의 행 수가 shadow 실행 전후 같다(DB 쓰기 0)
 *   ② 임시 HOME 아래에 감사 장부 한 파일만 생긴다 · 데이터 디렉터리는 바뀌지 않는다
 *   ③ 마지막 자연 공급 회차가 끝났으면 cycle + dayClose 두 줄 · 다시 돌려도 dayClose 는 한 줄(멱등)
 *   ④ 읽기 전용 프록시로 실제 Prisma 에 쓰기를 시도하면 던지고 행 수는 그대로다
 *   ⑤ 결정이 없으면 기록 0 · 실패 코드(봉투 상한을 모르면 쓰지 않는다)
 *   ⑥ 시각 — 실제로 지난 날(어제 KST)을 주입 시각(`--now`)으로 재생한다. 회차 시작 전 시각 · 마지막 슬롯의 깨진
 *      회차 기록이면 dayClose 0 (writer fail-closed)
 *   ⑦ observer(Phase 2) — 같은 격리 DB · 임시 장부 디렉터리에서 실제 observer CLI 를 돌린다.
 *      자연 회차 하나 = cycle 한 줄(회차 열쇠) · 관측 시각 = tick(완료 시각은 출처로만) · 재실행 · 동시 3개 ·
 *      늦은 tick(backfill)은 결정 · 장부 · DB 없이 marker 한 줄 · dayClose 0(결정 없는 날도 marker) · trigger-only 가짜 tag 0 ·
 *      손 실행 dayClose 와 causal dayClose 가 같은 id · DB 행 수 · 데이터 digest 그대로
 *
 *   SORAN_ISOLATED_DB=yes-throwaway · localhost · soran_test 가 아니면 즉시 멈춘다.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { Prisma, PrismaClient } from '@prisma/client'

import { kstDateString } from '../src/lib/release-canary'
import { DECISION_WRITER, previousKstDate, STAGE_DECISION_VERSION, validateStoredDecision } from '../src/lib/stage-decision-contract'
import { createStageDecision } from '../src/lib/stage-decision-repo'
import { requireIsolatedDb } from './lib/auto-ready-audit-fixtures.mjs'
import { readOnlyDb, REPO_ROOT } from './lib/ops-shadow-io.mjs'

requireIsolatedDb()

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}

const prisma = new PrismaClient()
type Counter = { count: () => Promise<number> }
const delegates = Prisma.dmmf.datamodel.models.map((m) => m.name[0]!.toLowerCase() + m.name.slice(1))
const countAll = async (): Promise<Record<string, number>> => {
  const out: Record<string, number> = {}
  for (const d of delegates) out[d] = await ((prisma as unknown as Record<string, Counter>)[d]!).count()
  return out
}
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

const tmp = mkdtempSync(join(tmpdir(), 'ops-shadow-db-'))
const home = join(tmp, 'home')
const dataDir = join(tmp, 'data')
mkdirSync(home, { recursive: true })
mkdirSync(dataDir, { recursive: true })
// 🔴 실제로 지난 날 — 어제 KST. 주입 시각은 그날 밤(과거)이다
const prev = previousKstDate(kstDateString(new Date()))
if (prev === null) throw new Error('어제 KST 날짜를 계산하지 못했다')
const D: string = prev
const AT = (hhmm: string): string => new Date(`${D}T${hhmm}:00+09:00`).toISOString()
const digest = (): string[] => walk(dataDir).map((f) => `${relative(dataDir, f)}:${createHash('sha256').update(readFileSync(f)).digest('hex')}`).sort()
const runShadow = (nowIso: string = AT('23:00')): ReturnType<typeof spawnSync> => spawnSync(join(REPO_ROOT, 'node_modules/.bin/tsx'),
  [join(REPO_ROOT, 'scripts/ops-shadow-plan.mts'), `--data-dir=${dataDir}`, `--now=${nowIso}`], {
    cwd: REPO_ROOT, encoding: 'utf-8',
    env: { ...process.env, HOME: home, NODE_OPTIONS: '' },
  })

try {
  await prisma.stageDecision.deleteMany({ where: { kstDate: D } })

  console.log('\n⑤ 결정이 없으면 기록 0')
  const before0 = await countAll()
  const r0 = runShadow()
  check('결정 없음 → 실패 코드 · 감사 장부 0', r0.status === 3 && walk(home).length === 0, `${String(r0.status)} ${String(r0.stderr).slice(0, 200)}`)
  check('결정 없음 → 행 수 그대로', JSON.stringify(await countAll()) === JSON.stringify(before0))

  // ── 오늘 결정(평상 HOLD) · 마지막 자연 공급 회차 완료 기록 ──
  const row = {
    kstDate: D, capacity: 'd10', release: 'd1', state: 'HOLD', reasons: ['fixture'], blocks: [], dayPinned: false, supply: null,
    decidedAt: new Date(`${D}T07:00:00+09:00`).toISOString(), contractVersion: STAGE_DECISION_VERSION,
    decidedBy: DECISION_WRITER, transition: null,
  }
  const v = validateStoredDecision({ row, expectKstDate: D })
  if (!v.ok) throw new Error(`fixture 결정이 깨졌다 — ${v.reason}`)
  await createStageDecision(prisma, v.decision)
  const startUtc = new Date(`${D}T22:15:05+09:00`)
  const runId = startUtc.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  // 🔴 완전한 tag — 자연 회차 판정은 정본 `naturalScheduledRunEvidenceAt` 하나다(trigger 만 있는 가짜 tag 는 자연이 아니다)
  const fullTag = (budgetWindow: string): Record<string, unknown> => ({
    ok: true, code: null, tokenId: 'fixture-token-db', trigger: 'scheduled', launchTrigger: 'scheduled',
    absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow,
  })
  const completedIso = new Date(startUtc.getTime() + 600_000).toISOString()
  writeFileSync(join(dataDir, `supply-process-${runId}.run.json`), JSON.stringify({
    runId, startedAt: startUtc.toISOString(), status: 'done', completedAt: completedIso,
    jit: { slots: 1, readyFilled: 1, upTo: 0, paidSources: 0, paidBasis: 'noDemand', sourceYieldHigh: null },
    runTokenShadow: fullTag(`${D} 22:15`),
  }))
  const dataBefore = digest()

  console.log('\n⑥ 시각 — 회차 시작 전 주입 시각이면 dayClose 0')
  const rEarly = runShadow(AT('21:00'))
  const earlyLines = walk(home).flatMap((f) => readFileSync(f, 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { kind: string; clock: string }))
  check('🔴 21:00 관측 — 22:15 회차는 아직 미래 · cycle 한 줄 · dayClose 0 · clock injected', rEarly.status === 0
    && earlyLines.length === 1 && earlyLines[0]!.kind === 'cycle' && earlyLines[0]!.clock === 'injected', `${String(rEarly.status)} ${String(rEarly.stderr).slice(0, 200)}`)
  check('미래 주입 시각은 거부한다', runShadow(new Date(Date.now() + 3_600_000).toISOString()).status === 2)
  rmSync(join(home, 'Library'), { recursive: true, force: true })

  console.log('\n① · ② · ③ 실제 CLI — DB 쓰기 0 · 감사 장부만')
  const before = await countAll()
  const r1 = runShadow()
  const after = await countAll()
  check('🔴 CLI 정상 종료', r1.status === 0, `${String(r1.status)} ${String(r1.stderr).slice(0, 300)}`)
  check(`🔴 모든 모델(${delegates.length}개) 행 수가 전후 같다`, JSON.stringify(before) === JSON.stringify(after),
    delegates.filter((d) => before[d] !== after[d]).join(','))
  const files = walk(home).map((f) => relative(home, f))
  check('🔴 임시 HOME 아래 감사 장부 한 파일만', files.length === 1 && files[0] === join('Library', 'Application Support', 'soransoran', 'ops-shadow', `${D}.jsonl`), files.join(','))
  const lines = files.length === 1 ? readFileSync(join(home, files[0]!), 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>) : []
  check('🔴 cycle + dayClose 두 줄 · 권위 none · 실행 false', lines.length === 2 && lines.every((l) => l.authority === 'none')
    && lines[0]!.kind === 'cycle' && (lines[0]!.deficit as { executed: boolean }).executed === false && lines[1]!.kind === 'dayClose',
    lines.map((l) => l.kind).join(','))
  check('기록에 사이클 id · KST 날짜 · 입력 해시 · runtime SHA 칸 · 계획 · 결과', lines.length === 2
    && lines.every((l) => typeof l.cycleId === 'string' && l.kstDate === D && /^[0-9a-f]{64}$/.test(String(l.inputHash)) && 'runtimeSha' in l && l.plan !== null)
    && (lines[1]!.outcome as { publishHardCap: number }).publishHardCap === 1)
  check('🔴 데이터 디렉터리 내용 digest 가 같다', JSON.stringify(digest()) === JSON.stringify(dataBefore))
  const r2 = runShadow()
  const lines2 = readFileSync(join(home, files[0]!), 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { kind: string })
  check('🔴 같은 주입 시각으로 다시 돌리면 같은 관측 — 두 줄 그대로(cycle · dayClose 멱등)', r2.status === 0 && lines2.length === 2)
  const r3 = runShadow(AT('23:05'))
  const lines3 = readFileSync(join(home, files[0]!), 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { kind: string })
  check('🔴 다른 관측 시각 — cycle 한 줄 추가 · dayClose 는 여전히 한 줄', r3.status === 0
    && lines3.filter((l) => l.kind === 'dayClose').length === 1 && lines3.filter((l) => l.kind === 'cycle').length === 2)
  check('재실행도 DB 쓰기 0', JSON.stringify(await countAll()) === JSON.stringify(after))

  console.log('\n⑦ observer — 자연 회차 하나 = 한 줄 · 관측 시각 = tick · backfill 은 marker 만 · 재실행 · 동시 · 가짜 tag 0')
  // trigger-only 가짜 tag(옛 fixture 모양) — 21:15 슬롯 자리. 자연이 아니므로 observer 는 보지 않는다
  const fakeStart = new Date(`${D}T21:15:04+09:00`)
  const fakeId = fakeStart.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  writeFileSync(join(dataDir, `supply-process-${fakeId}.run.json`), JSON.stringify({
    runId: fakeId, startedAt: fakeStart.toISOString(), status: 'done', completedAt: new Date(fakeStart.getTime() + 300_000).toISOString(),
    jit: { slots: 1, readyFilled: 1, upTo: 0, paidSources: 0, paidBasis: 'noDemand', sourceYieldHigh: null },
    runTokenShadow: { trigger: 'scheduled' },
  }))
  // 결정 행이 **없는** 전날(D-1)의 자연 회차 — backfill 이 결정을 읽지 않는다는 반례(읽으면 DECISION_MISSING 으로 0줄)
  const D2 = previousKstDate(D)
  if (D2 === null) throw new Error('D-1 을 계산하지 못했다')
  await prisma.stageDecision.deleteMany({ where: { kstDate: D2 } })
  const oldStart = new Date(`${D2}T22:15:07+09:00`)
  const oldId = oldStart.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  writeFileSync(join(dataDir, `supply-process-${oldId}.run.json`), JSON.stringify({
    runId: oldId, startedAt: oldStart.toISOString(), status: 'done', completedAt: new Date(oldStart.getTime() + 600_000).toISOString(),
    jit: { slots: 1, readyFilled: 1, upTo: 0, paidSources: 0, paidBasis: 'noDemand', sourceYieldHigh: null },
    runTokenShadow: fullTag(`${D2} 22:15`),
  }))
  const obsData = digest()
  const obsArgs = (outDir: string, nowIso: string | null): string[] => [join(REPO_ROOT, 'scripts/ops-shadow-observer.mts'),
    `--data-dir=${dataDir}`, `--out-dir=${outDir}`, ...(nowIso === null ? [] : [`--now=${nowIso}`])]
  const obsEnv = { ...process.env, HOME: home, NODE_OPTIONS: '' }
  const tsxBin = join(REPO_ROOT, 'node_modules/.bin/tsx')
  const runObserver = (outDir: string, nowIso: string | null): ReturnType<typeof spawnSync> =>
    spawnSync(tsxBin, obsArgs(outDir, nowIso), { cwd: REPO_ROOT, encoding: 'utf-8', env: obsEnv })
  const runObserverAsync = (outDir: string, nowIso: string | null): Promise<number | null> => new Promise((res) => {
    const c = spawn(tsxBin, obsArgs(outDir, nowIso), { cwd: REPO_ROOT, env: obsEnv, stdio: 'ignore' })
    c.on('exit', (code) => res(code))
  })
  type ObsLine = { kind: string; cycleId: string; kstDate: string; clock: string; at: string
    envelope: unknown; plan: unknown; observation: unknown; deficit: unknown; outcome: unknown; writer: unknown
    source: { kind: string; runId?: string; completedAt?: string; mode?: string; integrity?: string } }
  const linesOf = (dir: string): ObsLine[] => {
    try { return walk(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(f, 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as ObsLine)) } catch { return [] }
  }
  const ofRun = (ls: ObsLine[], id: string): ObsLine[] => ls.filter((l) => l.source.runId === id && l.kind === 'cycle')
  const isMarker = (l: ObsLine | undefined): boolean => l !== undefined && l.kind === 'cycle' && l.source.mode === 'backfill'
    && [l.envelope, l.plan, l.observation, l.deficit, l.outcome, l.writer].every((v) => v === null)
  const obsBefore = await countAll()
  const TICK = AT('22:27')

  // ── causal — 완료 2분 뒤 tick ──
  const causalDir = join(tmp, 'obs-causal', 'ops-shadow')
  const o1 = runObserver(causalDir, TICK)
  const c1 = linesOf(causalDir)
  const c1Run = ofRun(c1, runId)
  const c1Close = c1.filter((l) => l.kind === 'dayClose')
  check('🔴 causal — 자연 회차 cycle 한 줄 + dayClose 한 줄 · 관측 시각 = tick(완료 시각 아님) · 시계 injected · 완료 시각은 출처로만',
    o1.status === 0 && c1Run.length === 1 && c1Close.length === 1 && c1Run[0]!.source.mode === 'causal' && c1Run[0]!.source.integrity === 'unknown'
    && c1Run[0]!.at === TICK && c1Run[0]!.clock === 'injected' && c1Run[0]!.source.completedAt === completedIso
    && c1Run[0]!.observation !== null && c1Run[0]!.envelope !== null && c1Close[0]!.at === TICK && c1Close[0]!.kstDate === D,
    `${String(o1.status)} ${String(o1.stderr).slice(0, 300)} ${c1.map((l) => `${l.kind}:${l.source.mode ?? '-'}`).join(',')}`)
  check('🔴 어떤 줄도 회차 완료 시각을 관측 시각으로 적지 않는다', c1.length > 0 && c1.every((l) => l.at !== completedIso && l.at === TICK))
  check('🔴 같은 tick 의 결정 없는 전날 회차 → backfill marker 한 줄(결정 · 장부 · DB 0) · 그날 dayClose 0',
    isMarker(ofRun(c1, oldId)[0]) && ofRun(c1, oldId).length === 1 && !c1.some((l) => l.kstDate === D2 && l.kind === 'dayClose'))
  check('🔴 trigger-only 가짜 tag 회차는 기록 0', c1.length === 3 && !c1.some((l) => l.source.runId === fakeId))
  const o2 = runObserver(causalDir, AT('22:28'))
  check('🔴 다음 tick 재실행 → 줄 추가 0(seen)', o2.status === 0 && linesOf(causalDir).length === 3, String(o2.stdout).slice(-300))

  // ── 동시 3개 ──
  const concDir = join(tmp, 'obs-concurrent', 'ops-shadow')
  const codes = await Promise.all([0, 1, 2].map(() => runObserverAsync(concDir, TICK)))
  const cc = linesOf(concDir)
  check('🔴 observer 동시 3개 → 회차마다 cycle 한 줄 · dayClose 한 줄(장부 잠금 + 회차 열쇠)', codes.every((c) => c === 0)
    && ofRun(cc, runId).length === 1 && ofRun(cc, oldId).length === 1 && cc.filter((l) => l.kind === 'dayClose').length === 1 && cc.length === 3,
    `${codes.join(',')} ${cc.length}`)
  check('🔴 동시 실행과 단독 실행의 cycle id 집합이 같다(빈 집합 아님 · 회차가 열쇠)',
    cc.length === 3 && c1.length === 3 && JSON.stringify(cc.map((l) => l.cycleId).sort()) === JSON.stringify(c1.map((l) => l.cycleId).sort()))

  // ── backfill — 실제 시각 tick(완료 뒤 한참) ──
  const backDir = join(tmp, 'obs-backfill', 'ops-shadow')
  const tickStart = Date.now()
  const o3 = runObserver(backDir, null)
  const b1 = linesOf(backDir)
  const bRun = ofRun(b1, runId)[0]
  check('🔴 늦은 tick → backfill marker 한 줄 · 봉투 · 계획 · 관측 · 부족분 · 결과 · writer 전부 null', o3.status === 0
    && isMarker(bRun) && ofRun(b1, runId).length === 1, `${String(o3.status)} ${String(o3.stderr).slice(0, 300)}`)
  check('🔴 늦은 tick → dayClose 0(지금 DB 결과로 하루를 닫지 않는다)', b1.length > 0 && !b1.some((l) => l.kind === 'dayClose'))
  check('🔴 backfill 관측 시각 = 실제 tick 시각 · 시계 real · 완료 시각은 출처로만', bRun !== undefined && bRun.clock === 'real'
    && Date.parse(bRun.at) >= tickStart && bRun.at !== completedIso && bRun.source.completedAt === completedIso)
  check('🔴 backfill marker 와 causal 기록은 같은 cycle id(회차 열쇠 · 먼저 쓴 한 줄만 남는다)',
    bRun !== undefined && c1Run[0] !== undefined && bRun.cycleId === c1Run[0].cycleId)
  check('🔴 causal 이 이미 쓴 장부에서 늦은 tick 은 줄 추가 0', runObserver(causalDir, null).status === 0 && linesOf(causalDir).length === 3)

  // ── 경계 경합 — 완료 +4:59 causal 이 잠금을 쥔 동안 +5:01 tick 이 온다 ──
  const edgeDir = join(tmp, 'obs-edge', 'ops-shadow')
  mkdirSync(edgeDir, { recursive: true })
  const plus = (ms: number): string => new Date(Date.parse(completedIso) + ms).toISOString()
  // 진행 중인 causal observer 를 이 검사 프로세스(살아 있는 다른 pid)로 대신한다
  writeFileSync(join(edgeDir, '.observer.lock'), JSON.stringify({ pid: process.pid, at: plus(299_000) }))
  const eBusy = runObserver(edgeDir, plus(301_000))
  check('🔴 경계 — causal 이 쥔 동안 +5:01 tick 은 backfill marker 를 쓰지 않는다(0줄 · exit 0)',
    eBusy.status === 0 && linesOf(edgeDir).length === 0, `${String(eBusy.status)} ${String(eBusy.stderr).slice(0, 200)}`)
  rmSync(join(edgeDir, '.observer.lock'))
  const eCausal = runObserver(edgeDir, plus(299_000))
  const eLate = runObserver(edgeDir, plus(301_000))
  const eRun = ofRun(linesOf(edgeDir), runId)
  check('🔴 경계 — causal 이 끝난 뒤의 +5:01 tick 은 seen · 남는 것은 causal 한 줄(관측 있음 · marker 아님)',
    eCausal.status === 0 && eLate.status === 0 && eRun.length === 1 && eRun[0]!.source.mode === 'causal' && eRun[0]!.observation !== null
    && eRun[0]!.at === plus(299_000) && !existsSync(join(edgeDir, '.observer.lock')))

  const manualClose = lines3.find((l) => l.kind === 'dayClose') as unknown as { cycleId: string } | undefined
  check('🔴 손 실행 dayClose 와 causal observer dayClose 는 같은 id(같은 마지막 자연 회차 열쇠)',
    manualClose !== undefined && c1Close[0] !== undefined && manualClose.cycleId === c1Close[0].cycleId)
  check('🔴 observer 전 구간 DB 행 수 그대로', JSON.stringify(await countAll()) === JSON.stringify(obsBefore))
  check('🔴 observer 전 구간 데이터 디렉터리 digest 그대로', JSON.stringify(digest()) === JSON.stringify(obsData))
  rmSync(join(dataDir, `supply-process-${fakeId}.run.json`))
  rmSync(join(dataDir, `supply-process-${oldId}.run.json`))

  console.log('\n⑥-b 마지막 슬롯의 깨진 회차 기록이면 dayClose 0')
  rmSync(join(home, 'Library'), { recursive: true, force: true })
  const badStart = new Date(`${D}T22:20:00+09:00`)
  const badId = badStart.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  writeFileSync(join(dataDir, `supply-process-${badId}.run.json`), '{ broken')
  const rBad = runShadow()
  const badLines = walk(home).flatMap((f) => readFileSync(f, 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { kind: string; writer: { due: boolean } }))
  check('🔴 깨진 마지막 슬롯 기록 → writer due 아님 · dayClose 0', rBad.status === 0 && badLines.length === 1
    && badLines[0]!.kind === 'cycle' && badLines[0]!.writer.due === false)
  check('깨진 기록이 있어도 DB 쓰기 0', JSON.stringify(await countAll()) === JSON.stringify(after))

  console.log('\n④ 읽기 전용 프록시 — 실제 Prisma')
  const ro = readOnlyDb(prisma)
  let blocked = false
  try { await ro.stageDecision.create({ data: {} as never }) } catch (e) { blocked = /DB_WRITE_BLOCKED/.test(String(e)) }
  let rawBlocked = false
  try { await ro.$executeRawUnsafe('SELECT 1') } catch (e) { rawBlocked = /DB_BLOCKED/.test(String(e)) }
  check('🔴 쓰기 · raw 가 던진다 · 읽기는 된다', blocked && rawBlocked && (await ro.stageDecision.count()) === after.stageDecision)
  check('시도 뒤에도 행 수 그대로', JSON.stringify(await countAll()) === JSON.stringify(after))
} finally {
  await prisma.stageDecision.deleteMany({ where: { kstDate: D } })
  await prisma.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
