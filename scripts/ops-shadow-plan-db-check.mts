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
 *
 *   SORAN_ISOLATED_DB=yes-throwaway · localhost · soran_test 가 아니면 즉시 멈춘다.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
  writeFileSync(join(dataDir, `supply-process-${runId}.run.json`), JSON.stringify({
    runId, startedAt: startUtc.toISOString(), status: 'done', completedAt: new Date(startUtc.getTime() + 600_000).toISOString(),
    jit: { slots: 1, readyFilled: 1, upTo: 0, paidSources: 0, paidBasis: 'noDemand', sourceYieldHigh: null },
    runTokenShadow: { trigger: 'scheduled' },
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
