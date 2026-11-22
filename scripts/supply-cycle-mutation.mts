#!/usr/bin/env tsx
/**
 * 🔴 **바퀴마다 공급 — 변이 시험**
 *
 *   npx tsx scripts/supply-cycle-mutation.mts
 *
 *   공급 지연 상수 · 회차 파생 · 예산 배분 · 비용 표본 · 원자적 쓰기 · 결정 예약의 막는 줄을 하나씩 바꾸면
 *   `supply-cycle-check` 가 반드시 FAIL 해야 한다. 한 변이라도 살아남으면 exit 1.
 *
 * 🔴 worktree 를 고치지 않는다. `src` · `scripts` 를 OS 임시 디렉터리에 복사하고 나머지는 symlink 로 잇는다.
 * 🔴 먼저 변이 없는 사본이 PASS 하는지 본다 — 기준선이 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CYCLE = 'src/lib/cycle-schedule.ts'
const CONTRACT = 'src/lib/supply-schedule-contract.ts'
const RESERVE = 'src/lib/supply-scheduled-reserve.ts'
const ENVELOPE = 'src/lib/supply-cost-envelope.ts'
const LEDGER = 'src/lib/llm-ledger.ts'
const ATOMIC = 'scripts/lib/atomic-jsonl.mts'
const LOOP = 'scripts/lib/ops-loop-templates.ts'
const CHECK = 'scripts/supply-cycle-check.mts'

type Mutation = { name: string; file: string; from: string; to: string }
const M = (name: string, file: string, from: string, to: string): Mutation => ({ name, file, from, to })
const MUTATIONS: Mutation[] = [
  // 시각 — 수집 뒤 · 다음 수집 전 · 창이 겹치지 않는다
  M('공급이 수집과 같은 분에 뜬다', CYCLE, 'export const SUPPLY_AFTER_COLLECT_MINUTES = 15', 'export const SUPPLY_AFTER_COLLECT_MINUTES = 0'),
  M('공급 지연이 다음 바퀴를 넘긴다', CYCLE, 'export const SUPPLY_AFTER_COLLECT_MINUTES = 15', 'export const SUPPLY_AFTER_COLLECT_MINUTES = 65'),
  M('공급 지연이 커서 첫 공급 회차의 유료 창 뒤에 미룰 결정 예약이 남지 않는다', CYCLE, 'export const SUPPLY_AFTER_COLLECT_MINUTES = 15', 'export const SUPPLY_AFTER_COLLECT_MINUTES = 50'),
  M('새벽 바퀴에는 공급 회차가 없다', CONTRACT, 'SUPPLY_CYCLE_MINUTES.map((m) => Object.freeze(', 'SUPPLY_CYCLE_MINUTES.slice(2).map((m) => Object.freeze('),
  M('회차 창을 두 시간으로 늘린다', CONTRACT, 'export const SUPPLY_RUN_WINDOW_MS = 45 * 60 * 1000', 'export const SUPPLY_RUN_WINDOW_MS = 120 * 60 * 1000'),
  // 그날 결정 — 공급을 기다릴 예약(기준 01:50 + 오프셋)
  M('결정 예약에서 가운데 재시도를 뺀다', LOOP,
    'const STAGE_CONTROLLER_OFFSETS: readonly number[] = [0, 20, 40, FINAL_DECISION_OFFSET_MINUTES, FINAL_DECISION_OFFSET_MINUTES + 3]',
    'const STAGE_CONTROLLER_OFFSETS: readonly number[] = [0, FINAL_DECISION_OFFSET_MINUTES, FINAL_DECISION_OFFSET_MINUTES + 3]'),
  M('최종 판정을 첫 공급 회차의 유료 창 안으로 당긴다', LOOP, 'const FINAL_DECISION_OFFSET_MINUTES = 55', 'const FINAL_DECISION_OFFSET_MINUTES = 5'),
  // 예산 — 남은 예산 ÷ 남은 회차
  M('회차가 남은 예산 전부를 자기 몫으로 본다', RESERVE, 'const shareUsd = k === 0 ? 0 : basisUsd / k', 'const shareUsd = basisUsd'),
  M('끝난 회차 · 손 실행이 쓴 금액을 남은 예산에서 빼지 않는다', RESERVE, 'const basisUsd = Math.max(0, cap - (used - pendingSpent))', 'const basisUsd = cap'),
  M('정기 회차가 자기 몫까지 남긴다', RESERVE, '    .filter((s) => s.label !== input.ownSlot)\n', ''),
  M('손 실행이 남은 회차 몫을 남기지 않는다', RESERVE, '    .reduce((sum, s) => sum + s.claimUsd, 0)\n  return { basisUsd,', '    .reduce((sum, s) => sum + (input.ownSlot === null ? 0 : s.claimUsd), 0)\n  return { basisUsd,'),
  M('회차가 이미 쓴 것을 자기 몫에서 빼지 않는다', RESERVE, 'claimUsd: Math.max(0, shareUsd - spentUsd) }', 'claimUsd: shareUsd }'),
  // 비용 증거 — 기록된 회차 표식끼리의 정합
  M('회차 id 가 표식 창 안인지 보지 않는다', ENVELOPE, '  if (!Number.isFinite(slotStartMs) || utcMs < slotStartMs || utcMs >= slotStartMs + SUPPLY_RUN_WINDOW_MS) return null\n', ''),
  M('요청이 회차 창 밖에서 시작해도 인정한다', ENVELOPE, '  return startedMs >= slotStartMs && startedMs < slotStartMs + SUPPLY_RUN_WINDOW_MS', '  return startedMs >= slotStartMs'),
  M('귀속을 증명 못 한 요청을 표본에 넣는다', LEDGER, '    if (!currentMetadata) {', '    if (false) {'),
  M('예약액을 넘은 정산을 세지 않는다', LEDGER,
    "      out.settledUsd += e.settledUsd\n      if (e.reservedUsd !== null && e.settledUsd > e.reservedUsd) out.overrunRequests += 1\n      continue\n    }\n    if (e.status === 'usageUnknown' && e.reservedUsd !== null) {\n      out.usageUnknownRequests += 1",
    "      out.settledUsd += e.settledUsd\n      continue\n    }\n    if (e.status === 'usageUnknown' && e.reservedUsd !== null) {\n      out.usageUnknownRequests += 1"),
  // 겹침 — 쓰는 중인 파일
  M('임시 파일 이름이 공급 입력 이름 모양이다', ATOMIC, 'return join(dirname(path), `.${basename(path)}.partial-${pid}`)',
    "return join(dirname(path), basename(path).replace('.thin-detail.jsonl', `-p${pid}.thin-detail.jsonl`))"),
  M('쓰기 실패 뒤 임시 파일을 남긴다', ATOMIC, '    rmSync(tmp, { force: true })\n    throw e', '    return'),
]

const dir = mkdtempSync(join(tmpdir(), 'supply-cycle-mut-'))
const run = (): { ok: boolean; tail: string } => {
  const r = spawnSync('npx', ['tsx', CHECK], { cwd: dir, encoding: 'utf-8', env: process.env, timeout: 300_000 })
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

  console.log('\n══ 바퀴마다 공급 변이 시험 (worktree 변경 0) ══')
  const base = run()
  console.log(`  ${base.ok ? '✅' : '🔴'} 변이 없는 사본 — 검사 ${base.ok ? 'PASS' : 'FAIL'} (${base.tail})`)
  if (!base.ok) throw new Error('하네스 기준선이 FAIL 이다 — 변이 시험이 아무것도 증명하지 않는다')
  for (const m of MUTATIONS) {
    const path = join(dir, m.file)
    const orig = readFileSync(path, 'utf-8')
    const n = orig.split(m.from).length - 1
    if (n !== 1) throw new Error(`변이 대상이 정확히 한 곳이 아니다(${n}) — ${m.name}`)
    writeFileSync(path, orig.replace(m.from, m.to))
    try {
      const r = run()
      if (r.ok) { survived += 1; console.log(`  🔴 살아남음 ${m.name}`) } else console.log(`  ✅ 잡힘 ${m.name}`)
    } finally {
      writeFileSync(path, orig)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${survived === 0 ? '✅' : '🔴'} 변이 ${MUTATIONS.length - survived}/${MUTATIONS.length} 잡힘`)
process.exit(survived === 0 ? 0 : 1)
