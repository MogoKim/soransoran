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
const LADDER = 'src/lib/stage-ladder-generic.ts'
const FACTS = 'scripts/lib/stage-preflight-facts.mts'
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
    name: '정기 회차 귀속을 증명하지 못한 유료 요청을 귀속 불명으로 닫지 않고 조용히 뺐다',
    file: LEDGER,
    from: `    const currentMetadata = expected !== null && supplyCostRequestMetadataEligible(e, kstDate)
    if (!currentMetadata) {
      out.ineligibleRequests += 1
      continue
    }`,
    to: `    const currentMetadata = expected !== null && supplyCostRequestMetadataEligible(e, kstDate)
    if (!currentMetadata) continue`,
    check: EVIDENCE_CHECK,
  },
  {
    name: '밤(21시 이후) 회차 요청을 그날 비용 표본에서 다시 뺐다',
    file: LEDGER,
    from: `    const currentMetadata = expected !== null && supplyCostRequestMetadataEligible(e, kstDate)
`,
    to: `    if (new Date(started.getTime() + 9 * 3_600_000).getUTCHours() >= 21) continue
    const currentMetadata = expected !== null && supplyCostRequestMetadataEligible(e, kstDate)
`,
    check: EVIDENCE_CHECK,
  },
  {
    name: '밤(21시 이후) 회차 요청을 그날 비용 표본에서 다시 뺐다 — 장부 파일 왕복',
    file: LEDGER,
    from: `    const currentMetadata = expected !== null && supplyCostRequestMetadataEligible(e, kstDate)
`,
    to: `    if (new Date(started.getTime() + 9 * 3_600_000).getUTCHours() >= 21) continue
    const currentMetadata = expected !== null && supplyCostRequestMetadataEligible(e, kstDate)
`,
    check: OPS_CHECK,
  },
  {
    name: '회차 표식과 runId 의 창 정합을 보지 않았다',
    file: ENVELOPE,
    from: 'if (!Number.isFinite(slotStartMs) || utcMs < slotStartMs || utcMs >= slotStartMs + SUPPLY_RUN_WINDOW_MS) return null',
    to: 'if (!Number.isFinite(slotStartMs)) return null',
    check: EVIDENCE_CHECK,
  },
  {
    name: '표식 회차보다 먼저 뜬 runId 를 그 회차로 인정했다',
    file: ENVELOPE,
    from: 'if (!Number.isFinite(slotStartMs) || utcMs < slotStartMs || utcMs >= slotStartMs + SUPPLY_RUN_WINDOW_MS) return null',
    to: 'if (!Number.isFinite(slotStartMs) || utcMs >= slotStartMs + SUPPLY_RUN_WINDOW_MS) return null',
    check: EVIDENCE_CHECK,
  },
  {
    name: '회차 창 끝 시각의 runId 를 창 안으로 인정했다',
    file: ENVELOPE,
    from: 'if (!Number.isFinite(slotStartMs) || utcMs < slotStartMs || utcMs >= slotStartMs + SUPPLY_RUN_WINDOW_MS) return null',
    to: 'if (!Number.isFinite(slotStartMs) || utcMs < slotStartMs || utcMs > slotStartMs + SUPPLY_RUN_WINDOW_MS) return null',
    check: EVIDENCE_CHECK,
  },
  {
    name: '지금 시각표에 없는 회차 표식(옛 14:15)을 정합이어도 거절했다',
    file: ENVELOPE,
    from: '  return { kstDate, minute: slotHour * 60 + slotMinuteOfHour }',
    to: `  if (slotHour * 60 + slotMinuteOfHour === 14 * 60 + 15) return null
  return { kstDate, minute: slotHour * 60 + slotMinuteOfHour }`,
    check: EVIDENCE_CHECK,
  },
  {
    name: '회차 창 밖에서 시작한 유료 요청을 그 회차 표본으로 인정했다',
    file: ENVELOPE,
    from: `    && scheduled !== null && scheduled.kstDate === kstDate
    && supplyCostRequestStartedInScheduledWindow(i)`,
    to: '    && scheduled !== null && scheduled.kstDate === kstDate',
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
    name: 'whole-day 총위험이 기록 예산을 넘은 것을 무시했다',
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
  {
    name: '결과 1편짜리 표본의 예산 초과를 FAIL로 확정했다',
    file: ENVELOPE,
    from: 'if (!resultSampleShort) {',
    to: 'if (true) {',
    check: JIT_CHECK,
  },
  {
    name: '결과 최소 표본 미달을 모름으로 닫지 않았다',
    file: ENVELOPE,
    from: '(!count(sample.results) || !count(sample.minimum) || sample.results < sample.minimum)',
    to: '(!count(sample.results) || !count(sample.minimum))',
    check: JIT_CHECK,
  },
  {
    name: '현재 표본이 충분해도 창 전체 비용을 승계했다',
    file: LADDER,
    from: 'const carry = c !== null && currentResults < costSampleMin ? facts.supplyCostCarryover ?? null : null',
    to: 'const carry = c !== null ? facts.supplyCostCarryover ?? null : null',
    check: JIT_CHECK,
  },
  {
    name: '현재 표본이 부족해도 창 전체 비용을 승계하지 않았다',
    file: LADDER,
    from: 'const carry = c !== null && currentResults < costSampleMin ? facts.supplyCostCarryover ?? null : null',
    to: 'const carry = c !== null && currentResults >= costSampleMin ? facts.supplyCostCarryover ?? null : null',
    check: JIT_CHECK,
  },
  {
    name: '72시간 창 밖 묶음의 품질 계약을 승계 대상에 넣었다',
    file: FACTS,
    from: 'const scanned = [...(scanJitWorksets(dataDir, fromMs, toMs) ?? [])]',
    to: 'const scanned = [...(scanJitWorksets(dataDir, 0, toMs) ?? [])]',
    check: JIT_CHECK,
  },
  {
    name: '옛 품질 계약의 대기 READY를 비용 결과로 셌다',
    file: FACTS,
    from: 'scheduled: i.current.fates.scheduled }',
    to: 'scheduled: i.current.fates.scheduled + i.prior.reduce((n, p) => n + p.fates.scheduled, 0) }',
    check: JIT_CHECK,
  },
  {
    name: '승계 표본을 READY 수율·처리량의 현재 cohort에 섞었다',
    file: FACTS,
    from: 'sources: worksetSources, ...fates,',
    to: 'sources: worksetSources, ...fates, published: supplyCostCarryover?.results ?? fates.published,',
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
