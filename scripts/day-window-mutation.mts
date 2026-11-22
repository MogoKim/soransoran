#!/usr/bin/env tsx
/**
 * 🔴 **24시간 공개(2026-11-23 · 11-19 승인 묶음 C) — 변이 시험**
 *
 *   npx tsx scripts/day-window-mutation.mts
 *
 *   하루 전체 발행 창 · 바퀴 비중 자리(`cycleSlots`) · 자정 넘는 댓글 회차 · 발행도 그날 결정 전에는 전날 결정으로 ·
 *   결정 기준 01:50 — 고친 줄을 하나씩 되돌리거나 바꾸면 그 계약을 재는 검사가 반드시 FAIL 해야 한다.
 *   한 변이라도 살아남으면 exit 1.
 *
 * 🔴 worktree 를 고치지 않는다. `src` · `scripts` 를 OS 임시 디렉터리에 복사하고 나머지는 symlink 로 잇는다.
 * 🔴 변이 지점은 정확히 한 곳이어야 한다 — 0 · 2 이상이면 멈춘다(지점이 사라진 죽은 변이를 통과로 세지 않는다).
 * 🔴 먼저 변이 없는 사본에서 쓰는 검사가 전부 PASS 하는지 본다 — 기준선이 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CYCLE = 'src/lib/cycle-schedule.ts'
const CATCHUP = 'src/lib/publish-slot-catchup.ts'
const GENERIC = 'src/lib/stage-ladder-generic.ts'
const STORE = 'src/lib/stage-decision-store.ts'
const EXEC = 'scripts/stage-consume-exec.mts'

/** 검사 실행 인자 — npm 스크립트와 같은 tsconfig 로 돈다 */
const CHECKS = {
  cycle: ['tsx', 'scripts/cycle-schedule-check.mts'],
  scheduler: ['tsx', '--tsconfig', 'tsconfig.ops.json', 'scripts/stage-scheduler-check.mts'],
  ladder: ['tsx', 'scripts/stage-ladder-check.mts'],
  loop: ['tsx', 'scripts/ops-loop-check.mts'],
} as const
type CheckName = keyof typeof CHECKS

type Mutation = { name: string; file: string; from: string; to: string; caughtBy: CheckName }
const M = (name: string, file: string, from: string, to: string, caughtBy: CheckName): Mutation => ({ name, file, from, to, caughtBy })
const MUTATIONS: Mutation[] = [
  // ① 바퀴 비중 자리 — 창 가운데 · 자정 감기 · 창 시작 · 몫 > 틱
  M('자리를 창 가운데가 아니라 창 시작 쪽에 몰아 둔다', CYCLE,
    'Math.floor(((2 * k + 1) * ticks) / (2 * q))', 'Math.floor((k * ticks) / q)', 'cycle'),
  M('자정을 넘는 자리를 그 달력일 앞자리로 감지 않는다', CYCLE,
    'minutes.push(m >= DAY_MINUTES ? m - DAY_MINUTES : m)', 'minutes.push(m)', 'cycle'),
  M('바퀴 공개 창이 공급 회차 뒤 첫 틱이 아니라 공급 분에서 시작한다', CYCLE,
    '(CYCLES[j]!.minute + SUPPLY_AFTER_COLLECT_MINUTES + HEARTBEAT_INTERVAL_MINUTES)', '(CYCLES[j]!.minute + SUPPLY_AFTER_COLLECT_MINUTES)', 'cycle'),
  M('몫이 틱보다 큰 바퀴를 막지 않는다(d100 이 담긴 척한다)', CYCLE, '    if (q > ticks) {', '    if (false) {', 'cycle'),
  // 하루 전체 창 · 자정 넘는 댓글 회차(R1)
  M('발행 창을 옛 08:00 시작으로 되돌린다', CATCHUP,
    'export const PUBLISH_WINDOW_START_MINUTE = 0', 'export const PUBLISH_WINDOW_START_MINUTE = 8 * 60', 'scheduler'),
  M('댓글 덮개가 자정 넘는 회차를 세지 않는다(23:30 자리 시도 1회)', GENERIC,
    '    .flatMap((c) => [c, c + DAY_MINUTES])\n', '', 'scheduler'),
  // ② 발행도 그날 결정 전에는 전날 결정으로
  M('발행은 그날 결정만 따른다(전날 결정을 잇지 않는다)', STORE,
    '  if (!head.ok) return head\n', "  if (by === 'publish') return { ok: false, reason: '발행은 그날 결정만 따른다' }\n  if (!head.ok) return head\n", 'ladder'),
  M('브레이크 날에는 발행도 잇지 않는다', STORE,
    "  if (by === 'comment' && head.braked) {", "  if ((by === 'comment' || by === 'publish') && head.braked) {", 'ladder'),
  M('발행 consumer 가 이어 가기 갈래를 건너뛴다', EXEC,
    "    if (!outcome.ok && outcome.code === 'NO_DECISION' && prisma !== null) {",
    "    if (BY !== 'publish' && !outcome.ok && outcome.code === 'NO_DECISION' && prisma !== null) {", 'ladder'),
  // ④ 결정 기준 01:50
  M('결정 기준을 옛 07:00 으로 되돌린다', CYCLE,
    'export const STAGE_DECISION_BASE_MINUTE = at(1, 50)', 'export const STAGE_DECISION_BASE_MINUTE = at(7, 0)', 'loop'),
]

const dir = mkdtempSync(join(tmpdir(), 'day-window-mut-'))
const run = (c: CheckName): { ok: boolean; tail: string } => {
  const r = spawnSync('npx', [...CHECKS[c]], { cwd: dir, encoding: 'utf-8', env: process.env, timeout: 300_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return { ok: r.status === 0, tail: out.trim().split('\n').slice(-1)[0] ?? '' }
}
let survived = 0
try {
  for (const e of readdirSync(root)) {
    if (e === 'src' || e === 'scripts' || e === '.git' || e === '.next') continue
    symlinkSync(join(root, e), join(dir, e))
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })

  console.log('\n══ 24시간 공개 변이 시험 (worktree 변경 0) ══')
  for (const c of new Set(MUTATIONS.map((m) => m.caughtBy))) {
    const base = run(c)
    console.log(`  ${base.ok ? '✅' : '🔴'} 변이 없는 사본 — ${c} ${base.ok ? 'PASS' : 'FAIL'} (${base.tail})`)
    if (!base.ok) throw new Error(`하네스 기준선 ${c} 가 FAIL 이다 — 변이 시험이 아무것도 증명하지 않는다`)
  }
  for (const m of MUTATIONS) {
    const path = join(dir, m.file)
    const orig = readFileSync(path, 'utf-8')
    const n = orig.split(m.from).length - 1
    if (n !== 1) throw new Error(`변이 대상이 정확히 한 곳이 아니다(${n}) — ${m.name}`)
    writeFileSync(path, orig.replace(m.from, m.to))
    try {
      const r = run(m.caughtBy)
      if (r.ok) { survived += 1; console.log(`  🔴 살아남음 ${m.name} (${m.caughtBy})`) } else console.log(`  ✅ 잡힘 ${m.name} (${m.caughtBy})`)
    } finally {
      writeFileSync(path, orig)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${survived === 0 ? '✅' : '🔴'} 변이 ${MUTATIONS.length - survived}/${MUTATIONS.length} 잡힘`)
process.exit(survived === 0 ? 0 : 1)
