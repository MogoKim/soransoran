#!/usr/bin/env tsx
/**
 * 🔴 D20 공급 비용 envelope 변이 시험.
 *
 * 현재 worktree를 고치지 않고 OS 임시 사본에서 핵심 불변 조건을 하나씩 깨뜨린다.
 * 문법·적재 오류는 검출로 세지 않고, 해당 정본 검사가 판정 FAIL을 남겨야 통과다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CALL = 'scripts/lib/supply-llm-call.mts'
const LEDGER = 'src/lib/llm-ledger.ts'
const ENVELOPE = 'src/lib/supply-cost-envelope.ts'
const SIGNALS = 'scripts/lib/ops-signals.mts'
const FATE = 'src/lib/ready-fate.ts'
const RESERVE_CHECK = 'scripts/supply-scheduled-reserve-check.mts'
const EVIDENCE_CHECK = 'scripts/stage-evidence-check.mts'
const OPS_CHECK = 'scripts/ops-loop-check.mts'
const JIT_CHECK = 'scripts/supply-jit-contract-check.mts'

type Mutation = { name: string; file: string; from: string; to: string; check: string }
const mutations: readonly Mutation[] = [
  {
    name: '시행일 전에도 45분 producer gate를 켠다',
    file: CALL,
    from: 'this.scheduledWindowGuardActive = usesSupplyCostEnvelope(kstDateString(originAt ?? this.createdAt))',
    to: 'this.scheduledWindowGuardActive = true',
    check: RESERVE_CHECK,
  },
  {
    name: '시행일부터 45분 producer gate를 껐다',
    file: CALL,
    from: 'this.scheduledWindowGuardActive = usesSupplyCostEnvelope(kstDateString(originAt ?? this.createdAt))',
    to: 'this.scheduledWindowGuardActive = false',
    check: RESERVE_CHECK,
  },
  {
    name: '21:15·22:15 준비 슬롯을 당일 proof에 다시 넣었다',
    file: LEDGER,
    from: `  const lateMinutes = new Set([...scheduledMinutes].filter((minute) => !proofMinutes.has(minute)))
  const proofStartMinute = Math.min(...proofMinutes)
  const proofEndMinute = Math.max(...proofMinutes) + 45`,
    to: `  const lateMinutes = new Set<number>()
  const proofStartMinute = Math.min(...proofMinutes)
  const proofEndMinute = Math.max(...scheduledMinutes) + 45`,
    check: EVIDENCE_CHECK,
  },
  {
    name: '알려진 예산 초과를 UNKNOWN으로 완화했다',
    file: ENVELOPE,
    from: 'if (positive(input.riskUsd) && positive(input.budgetUsd) && input.riskUsd > input.budgetUsd) {',
    to: 'if (false) {',
    check: EVIDENCE_CHECK,
  },
  {
    name: '늦은 회차의 whole-day 예산 초과를 무시했다',
    file: SIGNALS,
    from: 'const wholeDayOverBudget = wholeDayCap !== null && wholeDayRisk > wholeDayCap + 1e-9',
    to: 'const wholeDayOverBudget = false',
    check: OPS_CHECK,
  },
  {
    name: '종결 쓰기 전에 열린 예약을 지웠다',
    file: CALL,
    from: `    this.io.withLock(this.dir, () => {
      this.write(path, entry)
      this.io.clearOpen(this.dir, attemptId)
    })`,
    to: `    this.io.withLock(this.dir, () => {
      this.io.clearOpen(this.dir, attemptId)
      this.write(path, entry)
    })`,
    check: RESERVE_CHECK,
  },
  {
    name: '시행일 전 사람 마감을 자연 preflight 표본으로 인정했다',
    file: FATE,
    from: 'if (manuallyResolved && belongsToCohort) {',
    to: 'if (false) {',
    check: JIT_CHECK,
  },
]

// 🔴가 포함된 통과 항목 이름이 있으므로 단어 검색을 하면 거짓 검출이 된다.
// 각 정본 검사가 마지막에 남기는 `N pass · M fail` 집계에서 실제 실패 개수만 읽는다.
const FAIL_SUMMARY = /(?:✅|🔴)\s+\d+\s+pass\s+·\s+([1-9]\d*)\s+fail/m
const dir = mkdtempSync(join(tmpdir(), 'supply-cost-envelope-mut-'))
const run = (check: string): { code: number; judged: boolean; tail: string } => {
  const r = spawnSync('npx', ['tsx', check], {
    cwd: dir, encoding: 'utf-8', env: process.env, timeout: 300_000,
  })
  const stdout = r.stdout ?? ''
  const output = `${stdout}${r.stderr ?? ''}`
  return {
    code: r.status ?? 99,
    judged: FAIL_SUMMARY.test(stdout),
    tail: output.trim().split('\n').slice(-1)[0] ?? '',
  }
}

let failed = 0
try {
  for (const entry of readdirSync(root)) {
    if (entry === 'src' || entry === 'scripts' || entry === '.git' || entry === '.next') continue
    symlinkSync(join(root, entry), join(dir, entry))
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })

  console.log('\n══ D20 공급 비용 envelope 변이 시험 (worktree 변경 0) ══')
  for (const check of [...new Set(mutations.map((mutation) => mutation.check))]) {
    const result = run(check)
    console.log(`  ${result.code === 0 ? '✅' : '🔴'} 기준선 ${check} — exit ${result.code} (${result.tail})`)
    if (result.code !== 0) throw new Error(`기준선이 FAIL이다 — ${check}`)
  }

  for (const mutation of mutations) {
    const path = join(dir, mutation.file)
    const original = readFileSync(path, 'utf-8')
    const matches = original.split(mutation.from).length - 1
    if (matches !== 1) {
      failed += 1
      console.log(`  🔴 변이 자리 ${matches}곳(정확히 1곳이어야 함) — ${mutation.name}`)
      continue
    }
    writeFileSync(path, original.replace(mutation.from, mutation.to))
    try {
      const result = run(mutation.check)
      if (result.code === 0) {
        failed += 1
        console.log(`  🔴 살아남음 — ${mutation.name}`)
      } else if (!result.judged) {
        failed += 1
        console.log(`  🔴 로드 실패(검출 아님) — ${mutation.name} · ${result.tail}`)
      } else {
        console.log(`  ✅ 검출 — ${mutation.name}`)
      }
    } finally {
      writeFileSync(path, original)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? '✅ PASS' : `🔴 FAIL ${failed}건`} — 변이 ${mutations.length}개`)
process.exit(failed === 0 ? 0 : 1)
